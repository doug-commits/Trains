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

const TITLE = 'Overland SEA — rail-first Southeast Asia planner'
const DESCRIPTION =
  'Plan a Southeast Asian journey that stays on rails as far as the rails go, ' +
  'bridges the gaps by sea, and tells you what happens at every border.'

// Order matters: each module reads the ones above it.
const SCRIPTS = [
  'data/network.js',
  'data/landmarks.js',
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

  /* Smallest first. The budget is going to cut somewhere; spending it on the
   * cheapest photographs buys the most destinations, and it makes the cut
   * deterministic instead of "whatever the manifest happened to list first". */
  const entries = Object.entries(manifest)
    .filter(([, e]) => existsSync(join(root, 'data/photos', e.file)))
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
    if (fits) {
      bytes += buf.length
      embedded[id] = { src: `data:${mime};base64,${buf.toString('base64')}`, ...meta }
    } else {
      linked[id] = { href: `data/photos/${entry.file}`, ...meta }
    }
  }
  return { embedded, linked, skipped, kb: bytes / 1024 }
}

const photoJs = set => `const PHOTOS = ${JSON.stringify(set)};`

const photos = loadPhotos()

const basemap = readFileSync(join(root, 'data/basemap.json'), 'utf8').trim()
const fonts = read('src/fonts.css')
const css = read('src/app.css')
const shell = read('src/shell.html')

const sources = SCRIPTS.map(p => `\n/* ===== ${p} ===== */\n${read(p)}`).join('\n')

const bodyWith = photoSet => `${shell}
<style>
${fonts}
${css}</style>
<script>
(function(){
"use strict";
/* Built by tools/build.mjs — edit the files in src/ and data/, not this. */
const BASEMAP = ${basemap};
${photoJs(photoSet)}
${sources}
})();
</script>`

mkdirSync(join(root, 'dist'), { recursive: true })

// Fragment for publishing: the host supplies doctype, html, head and body.
writeFileSync(
  join(root, 'dist/planner.html'),
  `<title>${TITLE}</title>\n<meta name="description" content="${DESCRIPTION}">\n${bodyWith(photos.embedded)}\n`
)

// Standalone document for opening off disk.
writeFileSync(
  join(root, 'index.html'),
  `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${TITLE}</title>
<meta name="description" content="${DESCRIPTION}">
</head>
<body>
${bodyWith({ ...photos.embedded, ...photos.linked })}
</body>
</html>
`
)

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
console.log(`dist/planner.html  ${kb('dist/planner.html')} KB`)
console.log(`index.html         ${kb('index.html')} KB`)
