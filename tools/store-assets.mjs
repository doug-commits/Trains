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
/* Each store keeps its own assets beside its own listing text. One shared
 * folder was fine while there was one store; with two it becomes a place where
 * you have to already know which files Apple wants. */
const OUT = { play: join(root, 'android/play'), appstore: join(root, 'ios/appstore') }
for (const dir of Object.values(OUT)) mkdirSync(dir, { recursive: true })
const out = OUT.play  // the feature graphic is Play's alone

const app = join(root, 'dist/app.html')
const site = join(root, 'index.html')
if (!existsSync(app)) {
  console.error('dist/app.html missing — run APP=1 node tools/build.mjs first')
  process.exit(1)
}

const browser = await chromium.launch()

/* The three shapes Play asks for, each one a device that exists, and each one
 * photographed in the layout that device actually gets.
 *
 * Phone — 432×768 at 2.5 is 1080×1920, exactly 9:16, and a roomier layout than
 * the 360-wide viewport that also gets there.
 *
 * 7-inch tablet — 600×960 at 2 is 1200×1920, which is a Nexus 7. 600 CSS
 * pixels is under the app's 60rem breakpoint, so this gets the same
 * full-screen map and pull-up sheet a phone does.
 *
 * 10-inch tablet — 1280×800 at 2 is 2560×1600, landscape, which is how a
 * tablet that size is held. 1280 CSS pixels is over the breakpoint, so this is
 * the app's other layout entirely: the map across the frame with the itinerary
 * in a column beside it rather than a sheet over it. Worth the extra pass —
 * it is the layout a tablet owner will actually see, and a stretched phone
 * screenshot in that slot is the usual reason a tablet listing looks like an
 * afterthought.
 *
 * Nothing here is staged. Each set is what installs on that device. */
const DEVICES = {
  phone: {
    prefix: 'screenshot',
    store: 'play',
    layout: 'sheet',
    viewport: { width: 432, height: 768 },
    deviceScaleFactor: 2.5,
    isMobile: true,
    hasTouch: true,
  },
  tablet7: {
    prefix: 'tablet7',
    store: 'play',
    layout: 'sheet',
    viewport: { width: 600, height: 960 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  },
  tablet10: {
    prefix: 'tablet10',
    store: 'play',
    layout: 'panel',
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2,
    isMobile: false,
    hasTouch: true,
  },

  /* Apple asks for its own two, at its own sizes, and will not take Play's.
   *
   * iphone69 — 440×956 at 3 is 1320×2868, the 6.9-inch display, which is the
   * one size App Store Connect requires; everything smaller is derived from it
   * unless you override it. Under the 60rem breakpoint, so the sheet layout,
   * same as every phone.
   *
   * ipad13 — 1032×1376 at 2 is 2064×2752, the 13-inch iPad, the other required
   * size. Portrait, because that is the orientation Apple's own frame uses in
   * the listing. At 1032 CSS pixels this is over the breakpoint, so it gets the
   * wide layout — map across the frame with the itinerary in a column beside
   * it — which is genuinely what an iPad shows. */
  /* iphone65 — 414×896 at 3 is 1242×2688, an iPhone 11 Pro Max. App Store
     Connect still offers this slot beside the 6.9-inch one and will not scale
     one into the other, so it gets its own pass rather than a resize: a
     screenshot stretched between two aspect ratios shows it. */
  iphone65: {
    prefix: 'ios-iphone-65',
    store: 'appstore',
    layout: 'sheet',
    viewport: { width: 414, height: 896 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  },
  iphone69: {
    prefix: 'ios-iphone-69',
    store: 'appstore',
    layout: 'sheet',
    viewport: { width: 440, height: 956 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  },
  ipad13: {
    prefix: 'ios-ipad',
    store: 'appstore',
    layout: 'panel',
    viewport: { width: 1032, height: 1376 },
    deviceScaleFactor: 2,
    isMobile: false,
    hasTouch: true,
  },
}

async function screen(device, colorScheme = 'light') {
  const { prefix, layout, store, ...opts } = DEVICES[device]
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

const shot = (page, device, name) =>
  page.screenshot({
    path: join(OUT[DEVICES[device].store], `${DEVICES[device].prefix}-${name}.png`),
  })

const shots = Object.fromEntries(Object.keys(DEVICES).map(d => [d, []]))

/* The same instructions, spoken to whichever layout is on screen.
 *
 * The two are genuinely different mechanisms rather than the same one at two
 * sizes: a sheet is dragged to a height and scrolls inside itself, a panel is
 * always open and scrolls as a column. Writing each shot twice would mean
 * maintaining two lists that quietly stop agreeing. */
function controls(page, device) {
  const sheet = DEVICES[device].layout === 'sheet'
  // Where the itinerary scrolls. On a wide screen the sheet is display:contents
  // and the panel is the scroller; scrolling #sheet-scroll there does nothing
  // at all, silently.
  const box = sheet ? '#sheet-scroll' : '#panel'

  const scrollTo = async (selector, gap, what) => {
    const ok = await page.evaluate(([b, sel, g]) => {
      const scroller = document.querySelector(b)
      const el = document.querySelector(sel)
      if (!scroller || !el) return false
      scroller.scrollTop += el.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top - g
      return true
    }, [box, selector, gap])
    if (!ok) throw new Error(`could not reach ${what} on ${device}`)
    await page.waitForTimeout(450)
  }

  return {
    page,
    wait: ms => page.waitForTimeout(ms),
    to: scrollTo,

    /* The grip cycles half → full → peek → half. Clicking to a named snap
       beats synthesising a drag, and it is the same code path a thumb takes.
       On the wide layout there is no sheet and nothing to do — the itinerary
       is already beside the map. */
    async snapTo(want) {
      if (!sheet) return
      for (let i = 0; i < 4; i++) {
        if (await page.evaluate(() =>
          document.querySelector('#sheet').dataset.snap) === want) return
        await page.locator('#grip').click()
        await page.waitForTimeout(420)
      }
      throw new Error(`could not reach snap ${want}`)
    },

    /* Past the search controls to the answer itself — the headline, the four
       numbers under it and the timezone warning, which are one block.

       On a phone only ever at the sheet's full height: the app promotes a
       half-open sheet to full the moment its contents scroll, so doing this
       any lower produces a screenshot of a sheet that has swallowed the map. */
    toAnswer: () => scrollTo('#panel .head', 14, 'the summary'),

    /* A named section of the itinerary, matched on the heading the app itself
       writes — so a renamed section fails loudly here rather than silently
       producing two screenshots of the same thing, which is what happened
       when this matched on substrings. */
    async toSection(title) {
      const found = await page.evaluate(t =>
        [...document.querySelectorAll('#panel .block > h2')]
          .findIndex(e => e.textContent.trim().toLowerCase() === t.toLowerCase()),
        title)
      if (found < 0) throw new Error(`no section titled "${title}" — the itinerary changed`)
      await scrollTo(`#panel .block:nth-of-type(${found + 1})`, 16, title)
    },
  }
}

/* One route, photographed from several places. Bangkok → Singapore because it
 * is the journey the whole network is built around and the one people arrive
 * having been told is impossible. */
const SPINE = '#from=bkk_aphiwat&to=singapore'

/* Every shot is taken on every device from the same script. */
async function capture(name, hash, prepare, colorScheme = 'light') {
  for (const device of Object.keys(DEVICES)) {
    const { page, context } = await screen(device, colorScheme)
    await open(page, hash)
    await ready(page)
    await page.waitForTimeout(1400)
    await prepare(controls(page, device))
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
await capture('1-map', SPINE, async ui => {
  await ui.snapTo('half')
  await ui.wait(600)
})

/* 2 — the answer. The headline, and the four numbers everyone wants before
 * they read a single leg: days, legs, borders, all-in cost. */
await capture('2-answer', SPINE, async ui => {
  await ui.snapTo('full')
  await ui.wait(500)
  await ui.toAnswer()
})

/* 3 — the itinerary. What the app is for: numbered legs, named operators,
 * running times, fares, and the change between each pair. */
await capture('3-itinerary', SPINE, async ui => {
  await ui.snapTo('full')
  await ui.wait(500)
  // The table, not the section heading above it. The paragraph in between is
  // worth reading in the app and is dead weight in a store screenshot.
  await ui.to('#panel .route', 8, 'the leg table')
})

/* 4 — the border mechanics. The part no mainstream planner carries and the
 * part that actually strands people. */
await capture('4-borders', SPINE, async ui => {
  await ui.snapTo('full')
  await ui.wait(500)
  await ui.toSection('Border crossings')
})

/* 5 — where the route is fragile. An itinerary that only lists the happy path
 * is the thing this app exists to replace. */
await capture('5-risks', SPINE, async ui => {
  await ui.snapTo('full')
  await ui.wait(500)
  await ui.toSection('Where this breaks')
})

/* 6 — the money. The other question everyone arrives with. */
await capture('6-costs', SPINE, async ui => {
  await ui.snapTo('full')
  await ui.wait(500)
  await ui.toSection('Costs')
})

/* 7 — a sea crossing. "Rail as far as the rails go, then a boat" is the whole
 * thesis, and Bangkok → Bali is where it shows end to end. */
await capture('7-sea', '#from=bkk_aphiwat&to=denpasar', async ui => {
  await ui.snapTo('half')
  await ui.wait(600)
})

/* 8 — dark, on the landing page. Says there is a night mode without spending
 * a whole screenshot on saying it. */
await capture('8-dark', '', async ui => {
  await ui.page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
  await ui.wait(700)
  await ui.page.evaluate(() => window.OverlandMap && window.OverlandMap.redraw())
  await ui.snapTo('full')
  await ui.wait(500)
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

for (const [device, { prefix, store, viewport, deviceScaleFactor }] of Object.entries(DEVICES)) {
  const px = `${viewport.width * deviceScaleFactor}×${viewport.height * deviceScaleFactor}`
  const dir = store === 'play' ? 'android/play' : 'ios/appstore'
  console.log(`${device.padEnd(18)} ${shots[device].length} at ${px} -> ${dir}/${prefix}-*.png`)
}
console.log('feature graphic    1024×500 -> android/play/feature-graphic.png')
