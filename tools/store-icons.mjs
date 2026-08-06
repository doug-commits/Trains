#!/usr/bin/env node
/* The square store icons, rendered from the shared geometry rather than drawn
 * again beside it.
 *
 *   node tools/store-icons.mjs
 *   → android/play/icon-512.png              Play listing
 *   → ios/Overland/Resources/Assets.xcassets/AppIcon.appiconset/icon-1024.png
 *
 * Neither store shows an adaptive icon: both want one flat square and round it
 * themselves. So this renders what a launcher actually shows — the middle 72 of
 * the 108-unit canvas, which is the window every mask leaves visible — rather
 * than the full canvas, which would come out looking like the mark had shrunk.
 *
 * Apple rejects an icon with an alpha channel. Nothing here is transparent (the
 * gradient covers every pixel) and Chromium drops the channel when nothing uses
 * it, so both come out as plain 24-bit PNGs — which is what each store wants.
 */

import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { iconSvg, INK } from './icon-art.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const TARGETS = [
  { size: 512, out: 'android/play/icon-512.png', label: 'Play listing' },
  /* The web manifest's, and committed rather than built on the deploy: Vercel
   * runs the two page builders and nothing that needs a browser, so anything
   * drawn by Chromium has to already be in the repository by then. */
  { size: 192, out: 'web/icon-192.png', label: 'web manifest' },
  { size: 512, out: 'web/icon-512.png', label: 'web manifest' },
  {
    size: 1024,
    out: 'ios/Overland/Resources/Assets.xcassets/AppIcon.appiconset/icon-1024.png',
    label: 'App Store',
  },
]

const browser = await chromium.launch()
for (const { size, out, label } of TARGETS) {
  const path = join(root, out)
  mkdirSync(dirname(path), { recursive: true })

  const page = await browser.newPage({ viewport: { width: size, height: size } })
  await page.setContent(
    `<style>html,body{margin:0;background:${INK.skyFoot}}svg{display:block}</style>` +
      iconSvg({ size })
  )
  await page.screenshot({ path, omitBackground: true })
  await page.close()
  console.log(`${label.padEnd(14)} ${size}×${size} -> ${out}`)
}
await browser.close()

/* Xcode's single-size app icon, supported since Xcode 14: one 1024 image and
 * the toolchain derives the rest. The fifteen-entry version of this file was
 * fifteen more chances to ship a stale size. */
writeFileSync(
  join(root, 'ios/Overland/Resources/Assets.xcassets/AppIcon.appiconset/Contents.json'),
  JSON.stringify(
    {
      images: [
        { filename: 'icon-1024.png', idiom: 'universal', platform: 'ios', size: '1024x1024' },
      ],
      info: { author: 'overland-sea', version: 1 },
    },
    null,
    2
  ) + '\n'
)
