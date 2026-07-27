#!/usr/bin/env node
/* Fetch destination photographs from Wikimedia Commons.
 *
 *   node tools/fetch-photos.mjs            # fetch everything missing
 *   node tools/fetch-photos.mjs --force    # refetch even what exists
 *   node tools/fetch-photos.mjs --only angkor-wat,borobudur
 *
 * Writes data/photos/<slug>.jpg and data/photos.json. Both are committed, so
 * this only needs running when landmarks change or an image is replaced.
 *
 * Why Commons rather than a stock library: the licences are actually usable,
 * and the API returns the author and licence alongside the file, so the
 * attribution the licence requires can be generated rather than hand-kept.
 *
 *   node tools/fetch-photos.mjs --dry-run  # show what it would take, fetch nothing
 *
 * NOTE: this does not run in the development sandbox — outbound access to
 * Wikimedia is refused at the network edge with 403, with or without the proxy.
 * It runs on CI instead (.github/workflows/fetch-photos.yml) and commits what
 * it gets. It preflights the connection so that failure is reported as the
 * network problem it is rather than as a wall of missing landmarks.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(root, 'data/photos')
const MANIFEST = join(root, 'data/photos.json')

/* Wikimedia asks for a descriptive User-Agent that identifies the tool and a
 * contact. Anonymous or browser-spoofing agents get rate-limited or blocked. */
const UA = 'OverlandSEA/1.0 (https://github.com/doug-commits/trains; rail planner) node-fetch'

/* Only licences that permit redistribution with attribution. Anything else —
 * non-commercial, no-derivatives, fair use — is rejected outright rather than
 * quietly used, because this page gets deployed and shared. */
const ALLOWED = [
  /^cc0/i, /^public domain/i, /^pd/i,
  /^cc[ -]by(-sa)?([ -][0-9.]+)?$/i,
  /^cc[ -]by[ -]sa[ -][0-9.]+/i,
  /^cc[ -]by[ -][0-9.]+/i,
]

/* Commons resizes server-side, so nothing is processed here — but the width
 * asked for decides whether the whole set fits in the page. At 1200 the files
 * ran 300–700 KB and half of them fell out of tools/build.mjs's inline budget,
 * which is a silent, arbitrary loss: whichever landmarks happened to sort first
 * got a photograph. 800 is wide enough for a card that renders about 400 CSS
 * pixels across on a 2x screen, and it roughly halves the bytes. */
const WIDTH = 800

/* Pace between landmarks. Each one costs a search plus a download, so this is
 * roughly half the real request rate. Slow enough to stay under Commons' limit
 * for an unauthenticated client, which is cheaper than being throttled. */
const PACE = 700

const args = process.argv.slice(2)
const force = args.includes('--force')
const dryRun = args.includes('--dry-run')
const onlyArg = args.indexOf('--only')
const only = onlyArg >= 0 ? (args[onlyArg + 1] || '').split(',').filter(Boolean) : null

const slug = name =>
  name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

/** Landmarks are a plain JS file; read the array without importing a module. */
function loadLandmarks() {
  const src = readFileSync(join(root, 'data/landmarks.js'), 'utf8')
  const fn = new Function(src + '; return LANDMARKS')
  return fn()
}

function stripHtml(s) {
  return String(s || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

function licenceOk(name) {
  return ALLOWED.some(rx => rx.test(String(name || '').trim()))
}

/** CC BY and CC BY-SA oblige us to name the author. CC0 and public domain do not. */
function needsAuthor(licence) {
  return /^cc[ -]by/i.test(String(licence || '').trim())
}

/* Commons fills an empty author field with boilerplate rather than leaving it
 * blank, and rendering "No machine-readable author provided. Foo assumed (based
 * on copyright claims)." under a photograph looks like a bug. Recover the name
 * it is guessing at; give up if there is not one. */
function cleanAuthor(raw) {
  const s = stripHtml(raw)
  const guessed = s.match(/^No machine-readable author provided\.?\s*([^,]+?)\s+assumed/i)
  if (guessed) return guessed[1].trim()

  const nameless = t => /^no machine-readable author/i.test(t) || /^unknown( author)?$/i.test(t)
  if (nameless(s)) return ''

  /* Some author templates emit the text twice — a visible copy and one for
   * screen readers — and stripping the tags welds them into
   * "Unknown authorUnknown author". Only unweld when doing so reveals a
   * placeholder; halving a real name that happens to repeat would be worse
   * than leaving it alone. */
  const half = s.length / 2
  if (s.length % 2 === 0 && s.slice(0, half) === s.slice(half) && nameless(s.slice(0, half))) {
    return ''
  }
  return s
}

class NetworkError extends Error {}

const sleep = ms => new Promise(r => setTimeout(r, ms))

/* Two failures wear the same clothes and need opposite handling.
 *
 * 403 means the request is not going to be allowed — an egress filter, a
 * blocked User-Agent — and retrying is just a slower way to fail.
 *
 * 429 and 5xx mean "not right now". Commons rate-limits an unauthenticated
 * client somewhere north of forty requests in a minute, which is exactly where
 * a run over this many landmarks lands. Treating that as fatal is what made the
 * first two runs stop dead partway down the list and look like Commons had
 * nothing for the second half of the world. Back off and carry on instead. */
const BACKOFF = [2000, 5000, 12000, 30000]

async function request(url, headers) {
  for (let attempt = 0; ; attempt++) {
    let res
    try {
      res = await fetch(url, { headers })
    } catch (err) {
      throw new NetworkError(`cannot reach commons.wikimedia.org (${err.message})`)
    }
    if (res.status === 403) throw new NetworkError(`Commons ${res.status} ${res.statusText}`)
    if (res.status === 429 || res.status >= 500) {
      if (attempt >= BACKOFF.length) {
        throw new NetworkError(`Commons ${res.status} ${res.statusText} after ${attempt} retries`)
      }
      // Retry-After is authoritative when Commons sends it.
      const after = Number(res.headers.get('retry-after')) * 1000
      const wait = Number.isFinite(after) && after > 0 ? after : BACKOFF[attempt]
      console.log(`      ${res.status} from Commons — waiting ${Math.round(wait / 1000)}s`)
      await sleep(wait)
      continue
    }
    return res
  }
}

async function api(params) {
  const url = new URL('https://commons.wikimedia.org/w/api.php')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const res = await request(url, { 'User-Agent': UA, Accept: 'application/json' })
  if (!res.ok) throw new Error(`Commons API ${res.status} ${res.statusText}`)
  return res.json()
}

/** One request before the loop, so a blocked network fails in two seconds. */
async function preflight() {
  try {
    await api({ action: 'query', format: 'json', formatversion: '2', meta: 'siteinfo' })
    return true
  } catch (err) {
    console.error(`\nCannot reach Wikimedia Commons: ${err.message}\n`)
    console.error('This is a network problem, not a data problem. Usually one of:')
    console.error('  · the machine sits behind an egress filter or corporate proxy')
    console.error('  · commons.wikimedia.org is not on an allowlist')
    console.error('  · the User-Agent was rejected — Wikimedia requires a descriptive one')
    console.error('\nCheck with:')
    console.error('  curl -A "OverlandSEA/1.0 (contact@example.com)" \\')
    console.error('    "https://commons.wikimedia.org/w/api.php?action=query&format=json&meta=siteinfo"')
    console.error('\nNothing was written. Destinations keep their drawn illustrations.')
    return false
  }
}

/** Search Commons for a usable photograph of one landmark. */
async function findImage(term) {
  const data = await api({
    action: 'query',
    format: 'json',
    formatversion: '2',
    generator: 'search',
    gsrsearch: `filetype:bitmap ${term}`,
    gsrnamespace: '6', // File:
    gsrlimit: '8',
    prop: 'imageinfo',
    iiprop: 'url|extmetadata|size|mime',
    iiurlwidth: String(WIDTH),
  })

  const pages = data?.query?.pages || []
  const rejected = []

  for (const page of pages) {
    const info = page.imageinfo?.[0]
    if (!info) continue
    const meta = info.extmetadata || {}
    const licence = stripHtml(meta.LicenseShortName?.value)

    if (!/^image\/(jpeg|png|webp)$/.test(info.mime || '')) {
      rejected.push(`${page.title}: mime ${info.mime}`)
      continue
    }
    // Skip diagrams, maps and flags — they search well and photograph badly.
    if (/\b(map|diagram|flag|logo|coat of arms|chart)\b/i.test(page.title)) {
      rejected.push(`${page.title}: not a photograph`)
      continue
    }
    if (!licenceOk(licence)) {
      rejected.push(`${page.title}: licence "${licence}"`)
      continue
    }
    if (!info.thumburl) {
      rejected.push(`${page.title}: no thumbnail`)
      continue
    }
    // An attribution licence with nobody to attribute is not a licence we can
    // satisfy. Take the next candidate rather than shipping "Unknown".
    const author = cleanAuthor(meta.Artist?.value)
    if (!author && needsAuthor(licence)) {
      rejected.push(`${page.title}: ${licence} with no named author`)
      continue
    }

    return {
      ok: true,
      title: page.title,
      thumburl: info.thumburl,
      width: info.thumbwidth,
      height: info.thumbheight,
      credit: author || 'Author not recorded on Commons',
      licence,
      licenceUrl: stripHtml(meta.LicenseUrl?.value) || '',
      source: info.descriptionurl || '',
      rejected,
    }
  }
  return { ok: false, rejected }
}

async function download(url) {
  const res = await request(new URL(url), { 'User-Agent': UA })
  if (!res.ok) throw new Error(`download ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

async function main() {
  if (!(await preflight())) process.exit(2)

  mkdirSync(OUT_DIR, { recursive: true })
  const landmarks = loadLandmarks()
  const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : {}

  const targets = landmarks.filter(l => !only || only.includes(slug(l.name)))
  let got = 0
  let skipped = 0
  let failed = 0

  for (const lm of targets) {
    const id = slug(lm.name)
    const file = `${id}.jpg`
    // Refetch when WIDTH changes, otherwise raising or lowering it only affects
    // landmarks added afterwards and the set ends up a mix of two sizes.
    const current = manifest[id]?.req === WIDTH
    if (!force && current && existsSync(join(OUT_DIR, file))) {
      skipped++
      continue
    }

    // The landmark name is usually the best query; `commons` overrides it where
    // the name is ambiguous or too generic to search well.
    const term = lm.commons || `${lm.name} ${lm.country === 'th' ? 'Thailand' : ''}`.trim()

    try {
      const found = await findImage(term)
      if (!found.ok) {
        failed++
        console.log(`  ✗ ${lm.name}\n      no usable image for "${term}"`)
        for (const r of found.rejected.slice(0, 3)) console.log(`      rejected ${r}`)
        continue
      }
      if (dryRun) {
        console.log(`  · ${lm.name} — would take ${found.title} (${found.licence}, ${found.credit})`)
        skipped++
        await sleep(PACE)
        continue
      }
      const bytes = await download(found.thumburl)
      writeFileSync(join(OUT_DIR, file), bytes)
      manifest[id] = {
        file,
        station: lm.station,
        landmark: lm.name,
        credit: found.credit,
        licence: found.licence,
        licenceUrl: found.licenceUrl,
        source: found.source,
        width: found.width,
        height: found.height,
        req: WIDTH, // what was asked for; `width` is what Commons could give
        bytes: bytes.length,
      }
      got++
      console.log(`  ✓ ${lm.name} — ${(bytes.length / 1024).toFixed(0)} KB, ${found.licence}, ${found.credit}`)
    } catch (err) {
      failed++
      console.log(`  ✗ ${lm.name}: ${err.message}`)
      // A network failure mid-run will repeat for every remaining landmark.
      if (err instanceof NetworkError) {
        console.error('\nStopping — the connection dropped rather than the search failing.')
        console.error('Anything already fetched is kept; re-run to continue where it left off.')
        break
      }
    }
    await sleep(PACE)
  }

  // Drop manifest entries whose file has gone missing.
  for (const [id, entry] of Object.entries(manifest)) {
    if (!existsSync(join(OUT_DIR, entry.file))) delete manifest[id]
  }

  if (dryRun) {
    console.log('\nDry run — nothing written.')
    return
  }
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n')

  const total = Object.keys(manifest).length
  const disk = readdirSync(OUT_DIR)
    .filter(f => f.endsWith('.jpg'))
    .reduce((n, f) => n + readFileSync(join(OUT_DIR, f)).length, 0)
  console.log(
    `\n${got} fetched, ${skipped} already had, ${failed} failed. ` +
      `${total} in manifest, ${(disk / 1024 / 1024).toFixed(1)} MB on disk.`
  )
  if (failed) console.log('Re-run with --only <slug> after adding a `commons` term to that landmark.')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
