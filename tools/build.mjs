#!/usr/bin/env node
/* Assembles the sources into one self-contained page.
 *
 * No bundler and no dependencies: the modules are plain scripts that publish a
 * single namespace each, concatenated in dependency order inside one IIFE. The
 * data files and the subset fonts are inlined, so the finished page makes no
 * network requests at all — which is both what the Artifact CSP requires and
 * what you want on a train in Laos.
 *
 * Two outputs from the same sources:
 *   index.html          a complete document you can open from disk
 *   dist/planner.html   the same page as a fragment, for publishing
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = p => readFileSync(join(root, p), 'utf8')

/* The phrase people search leads; the brand follows.
 *
 * "Overland SEA" is worth nothing as a search term until people already know
 * it, and a title that opens with an unknown brand spends its most valuable
 * characters on a word nobody types. The route pages already do this the right
 * way round — "Bangkok to Singapore by train — Overland SEA" — and the
 * homepage was the one page still doing it backwards. */
const TITLE = 'Southeast Asia overland by train and ferry — Overland SEA'
const DESCRIPTION =
  'Plan a Southeast Asian journey that stays on rails as far as the rails go, ' +
  'bridges the gaps by sea, and tells you what happens at every border.'

/* Absolute URLs are required for canonical, og:url and the sitemap.
 *
 * This was left unset while there was no domain, because a canonical pointing
 * at a host you do not own is worse than none — it tells a crawler to index a
 * page that is not there. The domain exists now, so it is the default, and
 * SITE_ORIGIN still overrides it for preview deployments, which must not
 * canonicalise themselves to production. */
// `??` not `||`: SITE_ORIGIN='' is an explicit "I do not know the host,
// emit nothing absolute", and an empty string is falsy. With `||` that
// instruction silently became the production domain.
const ORIGIN = (process.env.SITE_ORIGIN ?? 'https://slowasia.com').replace(/\/$/, '')

const headMeta = () => {
  const ld = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: 'Overland SEA',
    applicationCategory: 'TravelApplication',
    operatingSystem: 'Any browser',
    description: DESCRIPTION,
    ...(ORIGIN ? { url: ORIGIN, '@id': ORIGIN } : {}),
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    featureList: [
      'Rail-first routing across ten countries',
      'Border mechanics and connection buffers',
      'Frequency estimates for trains, buses and ferries',
      'Lodging costs along the route',
    ],
  })
  return [
    ORIGIN
      ? `<link rel="canonical" href="${ORIGIN}/">`
      : '<!-- no canonical: SITE_ORIGIN was not set at build time -->',
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="Overland SEA">`,
    `<meta property="og:title" content="${TITLE}">`,
    `<meta property="og:description" content="${DESCRIPTION}">`,
    ORIGIN ? `<meta property="og:url" content="${ORIGIN}/">` : '',
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${TITLE}">`,
    `<meta name="twitter:description" content="${DESCRIPTION}">`,
    `<meta name="theme-color" content="#0a191f" media="(prefers-color-scheme: dark)">`,
    `<meta name="theme-color" content="#d7e3e5" media="(prefers-color-scheme: light)">`,
    `<script type="application/ld+json">${ld}</script>`,
  ]
    .filter(Boolean)
    .join('\n')
}

// Order matters: each module reads the ones above it.
const SCRIPTS = [
  'data/network.js',
  'data/landmarks.js',
  'data/guides.js',
  'data/partners.js',
  'src/proj.js',
  'src/router.js',
  'src/plan.js',
  'src/scene.js',
  'src/photos.js',
  'src/ask.js',
  'src/map.js',
  'src/ui.js',
  'src/app.js',
]

/* Photographs, if tools/fetch-photos.mjs has been run.
 *
 * They were originally all inlined, which is what let the page work offline and
 * survive the Artifact CSP with no asset pipeline. That stopped scaling: the
 * set is now larger than any sane single file, so the budget below decides how
 * much travels inside the page and the rest is linked to data/photos/.
 *
 * The two outputs therefore differ, deliberately:
 *   index.html          inlined + linked. Ships beside data/photos/, so the
 *                       links resolve both off disk and on the deployed site.
 *   dist/planner.html   inlined only. It is published as one file with nothing
 *                       beside it, and a link that cannot resolve would mean a
 *                       failed request for every photograph over the budget. */
/* How much photography travels inside dist/planner.html, and only that.
 *
 * The website links every photograph instead. Inlining them there was costing
 * 3970 KB of a 4914 KB document — base64 in the HTML is the worst delivery
 * there is: it blocks the parser, it cannot be cached separately from the page
 * or from each other, it is re-downloaded on every visit, and base64 adds a
 * third to the bytes on top. A linked file is fetched only if it is actually
 * shown, cached on its own, and never blocks first paint.
 *
 * The fragment is different because it is published as a single file with
 * nothing beside it, so a link there has nothing to resolve against. */
const PHOTO_BUDGET_KB = Number(process.env.PHOTO_BUDGET_KB || 3000)

function loadPhotos() {
  const manifestPath = join(root, 'data/photos.json')
  const empty = { embedded: {}, linked: {}, skipped: 0, kb: 0 }
  if (!existsSync(manifestPath)) return empty

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const embedded = {}
  const linked = {}
  let bytes = 0
  let skipped = 0

  /* The fetcher is supposed to reject an attribution licence with no author,
   * but the page is what actually publishes the image, so it refuses too. A
   * CC BY photograph credited to nobody is a licence breach whatever put it in
   * the manifest. */
  // Placeholder, not "no Latin letters" — plenty of these credits are in Thai,
  // Vietnamese or Chinese, and an earlier version of this check threw one away.
  const nameless = t =>
    !String(t).trim() ||
    /^unknown( author)?$/i.test(String(t).trim()) ||
    /^no machine-readable author/i.test(String(t).trim())
  const unattributed = Object.entries(manifest).filter(
    ([, e]) => /^cc[ -]by/i.test(e.licence || '') && nameless(e.credit)
  )
  for (const [id, e] of unattributed) {
    console.warn(`photos             DROPPED ${id}: ${e.licence} credited to "${e.credit}"`)
  }
  const dropped = new Set(unattributed.map(([id]) => id))

  /* Smallest first. The budget is going to cut somewhere; spending it on the
   * cheapest photographs buys the most destinations, and it makes the cut
   * deterministic instead of "whatever the manifest happened to list first". */
  const entries = Object.entries(manifest)
    .filter(([id, e]) => !dropped.has(id) && existsSync(join(root, 'data/photos', e.file)))
    .sort((a, b) => (a[1].bytes ?? 0) - (b[1].bytes ?? 0))
  skipped += Object.keys(manifest).length - entries.length

  for (const [id, entry] of entries) {
    const file = join(root, 'data/photos', entry.file)
    const buf = readFileSync(file)
    const fits = (bytes + buf.length) / 1024 <= PHOTO_BUDGET_KB
    const mime = entry.file.endsWith('.png') ? 'image/png' : entry.file.endsWith('.webp') ? 'image/webp' : 'image/jpeg'

    const meta = {
      station: entry.station,
      landmark: entry.landmark,
      credit: entry.credit,
      licence: entry.licence,
      licenceUrl: entry.licenceUrl,
      source: entry.source,
    }
    linked[id] = { href: `data/photos/${entry.file}`, ...meta }
    if (fits) {
      bytes += buf.length
      embedded[id] = { src: `data:${mime};base64,${buf.toString('base64')}`, ...meta }
    }
  }
  return { embedded, linked, skipped, kb: bytes / 1024 }
}

const photoJs = set => `const PHOTOS = ${JSON.stringify(set)};`

/* The Android build.
 *
 * Same program, different package. It drops the photographs — 93 of them, and
 * about 22 of the app's 46 MB — because a phone that has already installed a
 * journey planner does not need it to carry a picture library it cannot use
 * offline anyway once the budget cuts in. The drawn scene art is already the
 * fallback for a station with no photograph, so this is a path the page
 * takes every day rather than an untested branch.
 *
 * It also marks the document, which is how the page knows to leave out the
 * parts that only make sense on a website. */
const APP = process.env.APP === '1'

const photos = APP ? { embedded: {}, linked: {}, skipped: 0, kb: 0 } : loadPhotos()

const basemap = readFileSync(join(root, 'data/basemap.json'), 'utf8').trim()
const rails = readFileSync(join(root, 'data/rails.json'), 'utf8').trim()
const fonts = read('src/fonts.css')
const css = read('src/app.css')
const shell = read('src/shell.html')

/* Affiliate ids come from the environment, never from the repo. An empty id
 * still produces a working link — it just earns nothing — so a clone without
 * the accounts set up builds and behaves identically. */
const partnerIds =
  `PARTNERS.booking.id = ${JSON.stringify(process.env.BOOKING_AID || '')};\n` +
  `PARTNERS.insurance.id = ${JSON.stringify(process.env.SAFETYWING_REF || '')};`

const sources =
  SCRIPTS.map(p => `\n/* ===== ${p} ===== */\n${read(p)}`).join('\n') +
  `\n/* ===== affiliate ids (build-time) ===== */\n${partnerIds}\n`

const bodyWith = photoSet => `${shell}
<style>
${fonts}
${css}</style>
<script>
(function(){
"use strict";
/* Built by tools/build.mjs — edit the files in src/ and data/, not this. */
const BASEMAP = ${basemap};
const RAILS = ${rails};
${photoJs(photoSet)}
${sources}
})();
</script>`

mkdirSync(join(root, 'dist'), { recursive: true })

const htmlDoc = (photoSet, app) => `<!doctype html>
<html lang="en"${app ? ' data-app="true"' : ''}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${TITLE}</title>
<meta name="description" content="${DESCRIPTION}">
${app ? '' : headMeta()}
</head>
<body>
${bodyWith(photoSet)}
</body>
</html>
`

if (APP) {
  /* Written on its own, and nothing else is. Sharing the index.html output
   * would mean an Android build silently leaves a photograph-less page behind
   * for the website to deploy. */
  writeFileSync(join(root, 'dist/app.html'), htmlDoc({}, true))
} else {
  // Fragment for publishing: the host supplies doctype, html, head and body.
  writeFileSync(
    join(root, 'dist/planner.html'),
    `<title>${TITLE}</title>\n<meta name="description" content="${DESCRIPTION}">\n${bodyWith(photos.embedded)}\n`
  )

  /* Standalone document for opening off disk, and what the site deploys.
   * Every photograph linked, none inlined. */
  writeFileSync(join(root, 'index.html'), htmlDoc(photos.linked, false))
}

const kb = p => (readFileSync(join(root, p)).length / 1024).toFixed(0)
const embeddedCount = Object.keys(photos.embedded).length
const linkedCount = Object.keys(photos.linked).length
console.log(
  embeddedCount || linkedCount
    ? `photos             ${embeddedCount} inlined (${photos.kb.toFixed(0)} KB), ` +
      `${linkedCount} linked from index.html only` +
      (photos.skipped ? `, ${photos.skipped} missing from disk` : '')
    : 'photos             none — destinations fall back to drawn illustrations'
)
if (APP) {
  console.log(`dist/app.html      ${kb('dist/app.html')} KB`)
} else {
  console.log(`dist/planner.html  ${kb('dist/planner.html')} KB`)
  console.log(`index.html         ${kb('index.html')} KB`)
}
