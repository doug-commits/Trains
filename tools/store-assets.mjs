#!/usr/bin/env node
/* Play Store listing graphics, rendered from the running app.
 *
 *   node tools/build.mjs && node tools/store-assets.mjs
 *   → android/play/screenshot-*.png   1080×1920, phone
 *   → android/play/feature-graphic.png  1024×500
 *
 * Screenshots are the app, not a mock-up of it. Play's own guidance is that a
 * screenshot should show actual app content, and there is a harder reason
 * here: a listing drawn by hand starts lying the first time the interface
 * changes, and nobody re-draws it. These are captured by driving the real
 * controls — plan a route, open the sheet, scroll to the section — so they are
 * wrong only if the app is.
 *
 * The feature graphic is the same map, rendered wide, with the wordmark over
 * it. Play crops it in some placements, so nothing that has to be read goes
 * near an edge.
 */

import { chromium } from 'playwright'
import { mkdirSync, existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'android/play')
mkdirSync(out, { recursive: true })

const app = join(root, 'dist/app.html')
const site = join(root, 'index.html')
if (!existsSync(app)) {
  console.error('dist/app.html missing — run APP=1 node tools/build.mjs first')
  process.exit(1)
}

const browser = await chromium.launch()

/* The two shapes Play asks for, each one a device that exists.
 *
 * Phone: 432×768 at 2.5 is 1080×1920 — exactly 9:16, and a roomier layout than
 * the 360-wide viewport that also gets there.
 *
 * 7-inch tablet: 600×960 at 2 is 1200×1920, which is a Nexus 7 and is still
 * the shape that slot means. 600 CSS pixels is under the app's 60rem
 * breakpoint, so a 7-inch tablet in portrait gets the same full-screen map and
 * pull-up sheet a phone does — which is the right layout for it, and is what
 * these screenshots therefore show. Nothing is staged: this is what installs
 * on that device. */
const DEVICES = {
  phone: {
    prefix: 'screenshot',
    viewport: { width: 432, height: 768 },
    deviceScaleFactor: 2.5,
    isMobile: true,
    hasTouch: true,
  },
  tablet7: {
    prefix: 'tablet7',
    viewport: { width: 600, height: 960 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  },
}

async function screen(device, colorScheme = 'light') {
  const { prefix, ...opts } = DEVICES[device]
  const context = await browser.newContext({ ...opts, colorScheme })
  const page = await context.newPage()
  page.on('pageerror', e => console.error(`  pageerror (${device}):`, e.message))
  return { page, context }
}

/* The launch screen removes itself; everything below would otherwise be
 * photographed through it. */
const ready = page =>
  page.waitForFunction(() => !document.getElementById('intro') &&
    document.querySelector('#panel h1'))

const open = (page, hash = '') => page.goto('file://' + app + hash)

// The grip cycles half → full → peek → half. Clicking to a named snap beats
// synthesising a drag, and it is the same code path a thumb takes.
async function snapTo(page, want) {
  for (let i = 0; i < 4; i++) {
    if (await page.evaluate(() => document.querySelector('#sheet').dataset.snap) === want) return
    await page.locator('#grip').click()
    await page.waitForTimeout(420)
  }
  throw new Error(`could not reach snap ${want}`)
}

const shot = (page, device, name) =>
  page.screenshot({ path: join(out, `${DEVICES[device].prefix}-${name}.png`) })

const shots = { phone: [], tablet7: [] }

/* Scroll a named section of the itinerary to the top of the sheet. Matched on
 * the heading the app itself writes, so a renamed section fails loudly here
 * rather than silently producing two screenshots of the same thing — which is
 * what happened when this matched on substrings. */
async function toSection(page, title) {
  const ok = await page.evaluate(t => {
    const box = document.querySelector('#sheet-scroll')
    const h = [...document.querySelectorAll('#panel .block > h2')]
      .find(e => e.textContent.trim().toLowerCase() === t.toLowerCase())
    if (!h) return false
    box.scrollTop += h.getBoundingClientRect().top - box.getBoundingClientRect().top - 16
    return true
  }, title)
  if (!ok) throw new Error(`no section titled "${title}" — the itinerary changed`)
  await page.waitForTimeout(400)
}

/* Past the search controls to the answer itself — the headline and the four
 * numbers under it.
 *
 * Only ever at the sheet's full height: the app promotes a half-open sheet to
 * full the moment its contents scroll, so doing this any lower produces a
 * screenshot of a sheet that has swallowed the map. */
async function toAnswer(page) {
  await page.evaluate(() => {
    const box = document.querySelector('#sheet-scroll')
    // .head, not h1 — the headline, the four numbers under it and the
    // timezone warning are one block, and the block is the screenshot.
    const h = document.querySelector('#panel .head')
    box.scrollTop += h.getBoundingClientRect().top - box.getBoundingClientRect().top - 14
  })
  await page.waitForTimeout(500)
}

/* One route, photographed from several places. Bangkok → Singapore because it
 * is the journey the whole network is built around and the one people arrive
 * having been told is impossible. */
const SPINE = '#from=bkk_aphiwat&to=singapore'

/* Every shot is taken on both devices from the same script. Two hand-kept
 * lists would drift, and the one that drifts is always the tablet — nobody
 * looks at that tab of the Console twice. */
async function capture(name, hash, prepare, colorScheme = 'light') {
  for (const device of Object.keys(DEVICES)) {
    const { page, context } = await screen(device, colorScheme)
    await open(page, hash)
    await ready(page)
    await page.waitForTimeout(1400)
    await prepare(page)
    await shot(page, device, name)
    shots[device].push(name)
    await context.close()
  }
}

/* 1 — the hero. A real journey drawn across the region, with the summary of it
 * under the map.
 *
 * At the sheet's half height, which is where the app opens an answer. Pulling
 * the sheet down first shows more sea and not more map: the route is fitted to
 * the space above the sheet at the moment it is computed, so a lower sheet just
 * adds empty water under a drawing that has already decided how big it is. */
await capture('1-map', SPINE, async page => {
  await snapTo(page, 'half')
  await page.waitForTimeout(600)
})

/* 2 — the answer. The headline, and the four numbers everyone wants before
 * they read a single leg: days, legs, borders, all-in cost. */
await capture('2-answer', SPINE, async page => {
  await snapTo(page, 'full')
  await page.waitForTimeout(500)
  await toAnswer(page)
})

/* 2 — the itinerary. What the app is for: numbered legs, named operators,
 * running times, fares, and the change between each pair. */
await capture('3-itinerary', SPINE, async page => {
  await snapTo(page, 'full')
  await page.waitForTimeout(500)
  await page.evaluate(() => {
    const box = document.querySelector('#sheet-scroll')
    const t = document.querySelector('.route')
    box.scrollTop += t.getBoundingClientRect().top - box.getBoundingClientRect().top - 8
  })
  await page.waitForTimeout(400)
})

/* 3 — the border mechanics. The part no mainstream planner carries and the
 * part that actually strands people. */
await capture('4-borders', SPINE, async page => {
  await snapTo(page, 'full')
  await page.waitForTimeout(500)
  await toSection(page, 'Border crossings')
})

/* 4 — where the route is fragile. An itinerary that only lists the happy path
 * is the thing this app exists to replace. */
await capture('5-risks', SPINE, async page => {
  await snapTo(page, 'full')
  await page.waitForTimeout(500)
  await toSection(page, 'Where this breaks')
})

/* 5 — the money. The other question everyone arrives with. */
await capture('6-costs', SPINE, async page => {
  await snapTo(page, 'full')
  await page.waitForTimeout(500)
  await toSection(page, 'Costs')
})

/* 6 — a sea crossing. "Rail as far as the rails go, then a boat" is the whole
 * thesis, and Singapore → Bali is where it shows. */
await capture('7-sea', '#from=bkk_aphiwat&to=denpasar', async page => {
  await snapTo(page, 'half')
  await page.waitForTimeout(600)
})

/* 7 — dark, on the landing page. Says there is a night mode without spending
 * a whole screenshot on saying it. */
await capture('8-dark', '', async page => {
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
  await page.waitForTimeout(700)
  await page.evaluate(() => window.OverlandMap && window.OverlandMap.redraw())
  await snapTo(page, 'full')
  await page.waitForTimeout(500)
}, 'dark')

/* ---------------------------------------------------------- the feature */

/* 1024×500 is a letterbox, and a phone-shaped map stretched into it is a
 * different picture — so the map is rendered at the graphic's own size and
 * shape, by the same program, from the same data.
 *
 * The route is fitted into the right-hand strip using the app's own inset
 * mechanism: the same code that keeps an itinerary out from under the panel
 * keeps this one out from under the wordmark. No cropping and hoping. */
const PANEL = 452 // where the text ends and the map is allowed to be seen

const mapPng = await (async () => {
  const context = await browser.newContext({
    viewport: { width: 1024, height: 500 },
    deviceScaleFactor: 2,
    colorScheme: 'dark',
  })
  const page = await context.newPage()
  await page.goto('file://' + site + '#from=bkk_aphiwat&to=singapore')
  await page.waitForFunction(() => document.querySelector('#panel h1'))
  await page.waitForTimeout(2000)
  await page.evaluate(left => {
    // Interface out of the way. The screenshots above are where the app gets
    // shown; here the drawing is the subject.
    for (const sel of ['.topbar', '.sheet', '.mapfoot', '#tip']) {
      const el = document.querySelector(sel)
      if (el) el.style.display = 'none'
    }
    document.querySelector('.stage').style.paddingTop = '0'
    const map = window.OverlandMap
    // A right inset too: without it the fit puts Singapore's label on
    // the last pixel, and Play crops the edges of this image in some
    // placements. Nothing that has to be read goes near the frame.
    map.setInset({ left, right: 74, top: 0, bottom: 0 })
    map.resize()
  }, PANEL)
  await page.waitForTimeout(300)
  // Re-fit against the inset: setRoute is what does the fitting, so ask the
  // app to answer the same question again now the shape has changed.
  await page.evaluate(() => {
    document.querySelector('#swap').click()
    document.querySelector('#swap').click()
  })
  await page.waitForTimeout(1400)
  const clip = await page.evaluate(() => {
    const r = document.querySelector('#map').getBoundingClientRect()
    return { x: r.x, y: r.y, width: r.width, height: r.height }
  })
  const buf = await page.screenshot({ clip })
  await context.close()
  return buf.toString('base64')
})()

{
  const context = await browser.newContext({
    viewport: { width: 1024, height: 500 },
    deviceScaleFactor: 1,
  })
  const page = await context.newPage()
  /* The site's own faces, inlined as they are in the built page. Without them
     the wordmark falls back to whatever the render host has and the graphic
     stops looking like the app it is advertising. */
  await page.setContent(`<style>
    ${readFileSync(join(root, 'src/fonts.css'), 'utf8')}
    html, body { margin: 0; width: 1024px; height: 500px; overflow: hidden; }
    .g { position: relative; width: 1024px; height: 500px; background: #061217; }
    .g img { position: absolute; inset: 0; width: 100%; height: 100%; }

    /* The wordmark gets ground of its own rather than a wash over the map:
       at the size Play shows this, type competing with coastline and station
       labels loses. The seam is a soft fade, not an edge. */
    .panel {
      position: absolute; left: 0; top: 0; bottom: 0; width: ${PANEL + 90}px;
      background: linear-gradient(100deg,
        #12303c 0%, #0a1f28 42%, rgba(6,18,23,0.97) ${(PANEL / (PANEL + 90)) * 100}%,
        rgba(6,18,23,0) 100%);
    }
    /* And a little weight at the foot, so the letterbox has a floor. */
    .floor {
      position: absolute; inset: 0;
      background: linear-gradient(to top, rgba(6,18,23,0.55), rgba(6,18,23,0) 38%);
    }

    .t {
      position: absolute; left: 64px; top: 50%; transform: translateY(-50%);
      width: 372px;
      font-family: BarlowCond, system-ui, sans-serif;
      color: #e7efea;
    }
    .word {
      margin: 0; font-size: 54px; font-weight: 500; line-height: 1;
      letter-spacing: 0.13em; text-transform: uppercase; color: #8ca9b0;
    }
    .word b { color: #f2f6f4; font-weight: 600; }
    .rule { width: 84px; height: 4px; border-radius: 2px; background: #e9a63e; margin: 20px 0; }
    .line {
      margin: 0; font-size: 30px; font-weight: 500; line-height: 1.22;
      color: #e7efea; letter-spacing: 0.01em; text-wrap: balance;
    }
    .sub {
      margin: 16px 0 0; font-size: 20px; line-height: 1.4; color: #8ca9b0;
      letter-spacing: 0.02em;
    }
  </style>
  <div class="g">
    <img src="data:image/png;base64,${mapPng}" alt="">
    <div class="floor"></div>
    <div class="panel"></div>
    <div class="t">
      <p class="word">Overland<b>SEA</b></p>
      <div class="rule"></div>
      <p class="line">Southeast Asia by train and ferry, without flying.</p>
      <p class="sub">203 stations across 11 countries. Every border crossing spelled out. Works with no signal.</p>
    </div>
  </div>`)
  await page.waitForTimeout(600)
  await page.screenshot({ path: join(out, 'feature-graphic.png') })
  await context.close()
}

await browser.close()

console.log(`phone              ${shots.phone.length} screenshots at 1080×1920 -> android/play/`)
console.log(`7-inch tablet      ${shots.tablet7.length} screenshots at 1200×1920 -> android/play/`)
console.log('feature graphic    1024×500 -> android/play/feature-graphic.png')
