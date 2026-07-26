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

/* Photographs, if tools/fetch-photos.mjs has been run. They are inlined so the
 * page stays a single self-contained file — which is what lets it work offline,
 * survive the Artifact CSP, and deploy without an asset pipeline.
 *
 * That only holds while the set is small. The budget below is the tripwire: if
 * you blow past it, stop inlining and serve data/photos/ as static assets
 * instead, adding them to the Vercel output directory alongside index.html. */
const PHOTO_BUDGET_KB = Number(process.env.PHOTO_BUDGET_KB || 3000)

function loadPhotos() {
  const manifestPath = join(root, 'data/photos.json')
  if (!existsSync(manifestPath)) return { js: 'const PHOTOS = {};', used: 0, skipped: 0, kb: 0 }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const out = {}
  let bytes = 0
  let skipped = 0

  for (const [id, entry] of Object.entries(manifest)) {
    const file = join(root, 'data/photos', entry.file)
    if (!existsSync(file)) {
      skipped++
      continue
    }
    const buf = readFileSync(file)
    if ((bytes + buf.length) / 1024 > PHOTO_BUDGET_KB) {
      skipped++
      continue
    }
    bytes += buf.length
    const mime = entry.file.endsWith('.png') ? 'image/png' : entry.file.endsWith('.webp') ? 'image/webp' : 'image/jpeg'
    out[id] = {
      src: `data:${mime};base64,${buf.toString('base64')}`,
      station: entry.station,
      landmark: entry.landmark,
      credit: entry.credit,
      licence: entry.licence,
      licenceUrl: entry.licenceUrl,
      source: entry.source,
    }
  }
  return {
    js: `const PHOTOS = ${JSON.stringify(out)};`,
    used: Object.keys(out).length,
    skipped,
    kb: bytes / 1024,
  }
}

const photos = loadPhotos()

const basemap = readFileSync(join(root, 'data/basemap.json'), 'utf8').trim()
const fonts = read('src/fonts.css')
const css = read('src/app.css')
const shell = read('src/shell.html')

const js = [
  '/* Built by tools/build.mjs — edit the files in src/ and data/, not this. */',
  `const BASEMAP = ${basemap};`,
  photos.js,
  ...SCRIPTS.map(p => `\n/* ===== ${p} ===== */\n${read(p)}`),
].join('\n')

const body = `${shell}
<style>
${fonts}
${css}</style>
<script>
(function(){
"use strict";
${js}
})();
</script>`

mkdirSync(join(root, 'dist'), { recursive: true })

// Fragment for publishing: the host supplies doctype, html, head and body.
writeFileSync(
  join(root, 'dist/planner.html'),
  `<title>${TITLE}</title>\n<meta name="description" content="${DESCRIPTION}">\n${body}\n`
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
${body}
</body>
</html>
`
)

const kb = p => (readFileSync(join(root, p)).length / 1024).toFixed(0)
console.log(
  photos.used
    ? `photos             ${photos.used} inlined, ${photos.kb.toFixed(0)} KB` +
      (photos.skipped ? `, ${photos.skipped} skipped (over budget or missing)` : '')
    : 'photos             none — destinations fall back to drawn illustrations'
)
console.log(`dist/planner.html  ${kb('dist/planner.html')} KB`)
console.log(`index.html         ${kb('index.html')} KB`)
