#!/usr/bin/env node
/* The Play listing's 512×512 icon, rendered from the same geometry as the
 * launcher icon rather than drawn again beside it. Two files that are supposed
 * to be the same picture and are maintained separately end up not being.
 *
 *   node tools/play-icon.mjs   →  android/play/icon-512.png
 *
 * The store asset is not an adaptive icon: it is one flat square, and Play
 * rounds it itself. So this renders what a launcher actually shows — the
 * middle 72 of the 108 canvas, which is the window every mask leaves visible —
 * rather than the full canvas, which would come out looking like the mark had
 * shrunk.
 */

import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'android/play/icon-512.png')
mkdirSync(dirname(out), { recursive: true })

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="18 18 72 72" width="512" height="512">
  <defs>
    <linearGradient id="g" x1="54" y1="0" x2="54" y2="108" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#12303C"/>
      <stop offset="0.55" stop-color="#0A191F"/>
      <stop offset="1" stop-color="#061217"/>
    </linearGradient>
  </defs>
  <rect x="18" y="18" width="72" height="72" fill="url(#g)"/>
  <g fill="#8CA9B0">
    <rect x="38" y="27.5" width="32" height="5" rx="1"/>
    <rect x="38" y="37.5" width="32" height="5" rx="1"/>
    <rect x="38" y="47.5" width="32" height="5" rx="1"/>
    <rect x="38" y="57.5" width="32" height="5" rx="1"/>
  </g>
  <rect x="49" y="24" width="10" height="42" rx="1" fill="#E9A63E"/>
  <g fill="#57B6C8">
    <rect x="49" y="71" width="10" height="6" rx="1"/>
    <rect x="49" y="81" width="10" height="4" rx="1"/>
  </g>
</svg>`

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 512, height: 512 } })
await page.setContent(
  `<style>html,body{margin:0;background:#061217}svg{display:block}</style>${svg}`
)
/* Nothing is transparent — the SVG paints the whole square — and Chromium
   drops the alpha channel when nothing uses it, so this comes out as a plain
   24-bit PNG. Play takes that; it takes JPEG too, which has no alpha at all. */
await page.screenshot({ path: out, omitBackground: true })
await browser.close()
console.log(`android/play/icon-512.png`)
