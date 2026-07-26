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

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
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
  'src/proj.js',
  'src/router.js',
  'src/plan.js',
  'src/map.js',
  'src/ui.js',
  'src/app.js',
]

const basemap = readFileSync(join(root, 'data/basemap.json'), 'utf8').trim()
const fonts = read('src/fonts.css')
const css = read('src/app.css')
const shell = read('src/shell.html')

const js = [
  '/* Built by tools/build.mjs — edit the files in src/ and data/, not this. */',
  `const BASEMAP = ${basemap};`,
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
console.log(`dist/planner.html  ${kb('dist/planner.html')} KB`)
console.log(`index.html         ${kb('index.html')} KB`)
