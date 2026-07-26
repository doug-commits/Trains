#!/usr/bin/env node
/* Fabricate placeholder images so the photo pipeline can be exercised without
 * network access — useful when Wikimedia is unreachable, and how the loader was
 * verified in the first place.
 *
 *   node tools/make-fixture-photos.mjs   # write fixtures
 *   node tools/build.mjs                 # inline them
 *   rm -rf data/photos data/photos.json  # put it back
 *
 * The images say FIXTURE across the middle on purpose. Nothing generated here
 * should ever be committed or deployed.
 */

import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'

const FIXTURES = [
  ['angkor-wat', 'sisophon', 'Angkor Wat', '#8a6a3b', '#241a10'],
  ['ha-long-bay', 'catba', 'Ha Long Bay', '#2f6f74', '#0d2830'],
  ['marina-bay-sands', 'singapore', 'Marina Bay Sands', '#4d5a86', '#101528'],
  ['petronas-towers', 'klsentral', 'Petronas Towers', '#6f7fae', '#161a2c'],
]
mkdirSync('data/photos', { recursive: true })
const b = await chromium.launch()
const p = await b.newPage()
const manifest = {}
for (const [id, station, label, a, c] of FIXTURES) {
  const dataUrl = await p.evaluate(([a, c, label]) => {
    const cv = document.createElement('canvas')
    cv.width = 1200; cv.height = 800
    const x = cv.getContext('2d')
    const g = x.createLinearGradient(0, 0, 0, 800)
    g.addColorStop(0, a); g.addColorStop(1, c)
    x.fillStyle = g; x.fillRect(0, 0, 1200, 800)
    x.fillStyle = 'rgba(255,255,255,.85)'
    x.font = 'bold 64px sans-serif'; x.textAlign = 'center'
    x.fillText(label, 600, 420)
    x.font = '28px sans-serif'
    x.fillText('FIXTURE — not a real photograph', 600, 480)
    return cv.toDataURL('image/jpeg', 0.8)
  }, [a, c, label])
  const bytes = Buffer.from(dataUrl.split(',')[1], 'base64')
  writeFileSync(`data/photos/${id}.jpg`, bytes)
  manifest[id] = {
    file: `${id}.jpg`, station, landmark: label,
    credit: 'A. Photographer', licence: 'CC BY-SA 4.0',
    licenceUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    source: 'https://commons.wikimedia.org/wiki/File:Example.jpg',
    width: 1200, height: 800, bytes: bytes.length,
  }
  console.log(`  ${id}: ${(bytes.length/1024).toFixed(0)} KB`)
}
writeFileSync('data/photos.json', JSON.stringify(manifest, null, 2) + '\n')
await b.close()
