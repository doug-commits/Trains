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
 * NOTE: this has never completed a real run. The environment it was written in
 * blocks outbound access to Wikimedia — the attempt returns 403 at the network
 * edge, with or without the proxy. The request shape follows the documented
 * MediaWiki API, but treat your first run as the thing that proves it. It
 * preflights the connection and reports what it accepted and rejected per
 * landmark so that run is readable rather than a wall of failures.
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

class NetworkError extends Error {}

async function api(params) {
  const url = new URL('https://commons.wikimedia.org/w/api.php')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  let res
  try {
    res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } })
  } catch (err) {
    throw new NetworkError(`cannot reach commons.wikimedia.org (${err.message})`)
  }
  // 403 here is almost always an egress filter or a blocked User-Agent, not a
  // problem with the landmark — worth distinguishing so it is not chased as one.
  if (res.status === 403 || res.status === 429 || res.status >= 500) {
    throw new NetworkError(`Commons API ${res.status} ${res.statusText}`)
  }
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

    return {
      ok: true,
      title: page.title,
      thumburl: info.thumburl,
      width: info.thumbwidth,
      height: info.thumbheight,
      credit: stripHtml(meta.Artist?.value) || 'Unknown',
      licence,
      licenceUrl: stripHtml(meta.LicenseUrl?.value) || '',
      source: info.descriptionurl || '',
      rejected,
    }
  }
  return { ok: false, rejected }
}

async function download(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`download ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

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
        await sleep(350)
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
    await sleep(350) // be a good citizen of a free API
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
