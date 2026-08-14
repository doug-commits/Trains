#!/usr/bin/env node
/* Browser smoke test: loads the built page, drives the real controls, and
 * fails on any console error or unhandled rejection. Also writes screenshots
 * so the layout can be eyeballed rather than assumed.
 *
 *   node tools/build.mjs && node tools/smoke.mjs [outDir]
 */

import { chromium } from 'playwright'
import { mkdirSync, readFileSync, existsSync, statSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/* The page bundles its sources into a closure, so nothing is reachable on
 * window. Where an assertion needs a count from the data rather than a literal
 * that rots on the next edit, read the data file here instead. */
const NETWORK = new Function(
  readFileSync(join(root, 'data/network.js'), 'utf8') + '; return NETWORK'
)()
const RAILS = JSON.parse(readFileSync(join(root, 'data/rails.json'), 'utf8'))
const outDir = resolve(process.argv[2] || join(root, 'shots'))
mkdirSync(outDir, { recursive: true })

const url = 'file://' + join(root, 'index.html')
const problems = []

const browser = await chromium.launch()

/* Several checks below read the built app bundle and the built guide pages
 * rather than the sources they came from, which is the point — a bundle is
 * where a build mistake shows up. But it also means a stale one passes for the
 * source it no longer matches, and passing for the wrong reason is worse than
 * failing. So: refuse to run against an output older than its inputs.
 *
 * `npm test` builds all three first and never trips this. Running this file on
 * its own after an edit will. */
{
  // This file is not an input to any of them, and counting it meant every edit
  // to a check invalidated every build and demanded a rebuild that changed
  // nothing.
  const self = fileURLToPath(import.meta.url)
  const newest = dirs =>
    dirs.flatMap(d => readdirSync(join(root, d)).map(f => join(root, d, f)))
      .filter(f => f !== self && statSync(f).isFile())
      .reduce((n, f) => Math.max(n, statSync(f).mtimeMs), 0)

  const sources = newest(['src', 'data', 'tools'])
  for (const [what, built, how] of [
    ['the website', 'index.html', 'node tools/build.mjs'],
    ['the app bundle', 'dist/app.html', 'APP=1 node tools/build.mjs'],
    ['the guide pages', 'public/sitemap.xml', 'node tools/build-pages.mjs'],
  ]) {
    const at = join(root, built)
    if (!existsSync(at)) {
      console.error(`\n${what} has not been built. Run: ${how}\n`)
      process.exit(1)
    }
    if (statSync(at).mtimeMs < sources) {
      console.error(
        `\n${what} (${built}) is older than the sources it was built from, so the\n` +
          `checks below would be testing something nobody is shipping.\n\n  ${how}\n\n` +
          `or simply: npm test\n`
      )
      process.exit(1)
    }
  }
}


async function newPage({ ignore, ...opts } = {}) {
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 2,
    colorScheme: 'dark',
    ...opts,
  })
  const page = await context.newPage()
  /* Chromium will not fetch a web manifest from a file:// document at all —
     the origin is opaque, so the request is cross-origin by definition. These
     pages are opened off disk rather than served, so every one of them logs it
     and the log is where real errors are supposed to stand out.
     Suppressed by name, and the anonymous ERR_FAILED that follows only when
     the named one came first, so nothing else wearing that message is hidden.
     Over https, which is the only place the manifest does anything, none of
     this happens. */
  let manifestBlocked = false
  page.on('console', m => {
    if (m.type() !== 'error') return
    const text = m.text()
    if (/site\.webmanifest/.test(text)) {
      manifestBlocked = true
      return
    }
    if (manifestBlocked && /Failed to load resource: net::ERR_FAILED/.test(text)) return
    // Narrow and stated at the call site, never a blanket mute: the point of
    // collecting these is that nobody has to read the log.
    if (ignore && ignore.test(text)) return
    problems.push(`console.error: ${text}`)
  })
  page.on('pageerror', e => problems.push(`pageerror: ${e.message}`))
  return { page, context }
}

/* Put the pointer on a real place. Sweeping the canvas for a hit meant tens of
 * thousands of synthetic moves, each running the full pick over three hundred
 * targets — minutes, for something the map can answer directly. */
/* Wheel in on a place, the way a reader would before picking between two
 * things that are close together on the ground. */
async function zoomOn(page, lon, lat, steps) {
  for (let i = 0; i < steps; i++) {
    const at = await page.evaluate(
      ([lo, la]) => {
        const p = window.OverlandMap.locate(lo, la)
        if (!p) return null
        const r = document.querySelector('#map').getBoundingClientRect()
        return { x: r.left + p.x, y: r.top + p.y }
      },
      [lon, lat]
    )
    if (!at) return
    await page.mouse.move(at.x, at.y)
    await page.mouse.wheel(0, -240)
    await page.waitForTimeout(90)
  }
  await page.waitForTimeout(250)
}

async function hover(page, lon, lat) {
  const at = await page.evaluate(
    ([lo, la]) => {
      const p = window.OverlandMap.locate(lo, la)
      if (!p) return null
      const r = document.querySelector('#map').getBoundingClientRect()
      return { x: r.left + p.x, y: r.top + p.y }
    },
    [lon, lat]
  )
  if (!at) return null
  await page.mouse.move(at.x, at.y)
  await page.waitForTimeout(90)
  if (!(await page.locator('#tip.live').isVisible())) return null
  return { ...at, text: (await page.locator('#tip').textContent()).replace(/\s+/g, ' ').trim() }
}

function check(label, condition, detail = '') {
  console.log(`${condition ? '  ok  ' : ' FAIL '} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!condition) problems.push(`${label} ${detail}`)
}

/* ---------------------------------------------------------- idle state */
{
  const { page, context } = await newPage()
  await page.goto(url)
  await page.waitForFunction(() => document.querySelector('#panel h1'))
  await page.waitForTimeout(500)

  const h1 = await page.textContent('#panel h1')
  check('idle headline renders', /Southeast Asia/.test(h1), h1.replace(/\s+/g, ' ').trim())
  // Count comes from the preset list, not a magic number that rots on edit.
  const chips = await page.locator('.corridor').count()
  check('corridor cards render', chips >= 6, `${chips} cards`)
  // Again from the data, not a literal — the last one of these rotted the first
  // time a myth was added.
  check('myths render', (await page.locator('.myths li').count()) === NETWORK.myths.length,
    `${NETWORK.myths.length} myths`)

  // The canvas must actually have painted something, not just be sized.
  const painted = await page.evaluate(() => {
    const c = document.querySelector('#map')
    const ctx = c.getContext('2d')
    const d = ctx.getImageData(0, 0, c.width, c.height).data
    const seen = new Set()
    for (let i = 0; i < d.length; i += 4000) seen.add(`${d[i]},${d[i + 1]},${d[i + 2]}`)
    return seen.size
  })
  check('map paints multiple colours', painted > 3, `${painted} distinct samples`)

  /* The sea used to be one flat fill across two thirds of the viewport. It now
   * carries a gradient, a graticule and a vignette, so open water sampled at
   * different heights must not come back identical. */
  const water = await page.evaluate(() => {
    const c = document.querySelector('#map')
    const ctx = c.getContext('2d')
    const at = (fx, fy) => {
      const d = ctx.getImageData(Math.round(c.width * fx), Math.round(c.height * fy), 1, 1).data
      return `${d[0]},${d[1]},${d[2]}`
    }
    // Down the left edge, which is open ocean at every zoom this opens at.
    return [at(0.02, 0.1), at(0.02, 0.5), at(0.02, 0.92)]
  })
  check('the sea has depth rather than one flat fill',
    new Set(water).size > 1, water.join('  '))

  /* The homepage is where a crawler lands, and both sets of pages have to be
     one hop from it. The route list has been there since those pages existed;
     the crossings were not, and were reachable only from the routes that used
     them — which left the eight nobody routes through two hops deep behind a
     page that does not mention them. */
  const hub = await page.evaluate(() =>
    [...document.querySelectorAll('#panel a')].map(a => a.getAttribute('href')))
  const crossingIds = Object.keys(NETWORK.borders)
  const off = crossingIds.filter(id => !hub.includes(`/${id}-border-crossing`))
  check('the homepage links every border crossing page', off.length === 0, off.join(', '))
  check('and every route written up in full',
    hub.filter(h => /^\/[a-z0-9-]+$/.test(h)).length >= crossingIds.length + 16,
    `${hub.filter(h => /^\/[a-z0-9-]+$/.test(h)).length} links`)

  /* A support page that does not give you a way to ask for support is exactly
     what Apple is looking for when it checks that URL. */
  {
    const sp = readFileSync(join(root, 'public/support.html'), 'utf8')
    check('the support page offers a way to reach a person',
      /mailto:[^"]+@[^"]+/.test(sp))
    check('and answers the questions that sound like faults',
      /departure time/i.test(sp) && /out of date/i.test(sp) &&
        /no way through/i.test(sp))
    check('and dates the network rather than implying it is current',
      sp.includes(NETWORK.reviewed), NETWORK.reviewed)
  }

  /* The launch screen belongs to the app. A website that draws a curtain over
     itself before showing anything is a website nobody waits for — and this
     one paints in well under the time the curtain would have been up for. */
  check('the website shows no launch screen',
    (await page.evaluate(() => getComputedStyle(document.getElementById('intro')).display)) === 'none')

  await page.screenshot({ path: join(outDir, '01-idle-dark.png') })
  await context.close()
}

/* ------------------------------------------------------ a planned route */
{
  const { page, context } = await newPage()
  await page.goto(url)
  await page.waitForFunction(() => document.querySelector('#panel h1'))
  await page.locator('.corridor', { hasText: 'Laos → Malaysia' }).click()
  await page.waitForFunction(() => document.querySelector('.route tbody tr'))
  await page.waitForTimeout(1100)

  const heading = await page.textContent('#panel h1')
  check('itinerary headline', /Luang Prabang/.test(heading) && /Kuala Lumpur/.test(heading), heading.replace(/\s+/g, ' ').trim())

  const legs = await page.locator('tr.leg').count()
  const borders = await page.locator('.crossing').count()
  const risks = await page.locator('.risk').count()
  check('legs present', legs > 4, `${legs} legs`)
  check('border briefings present', borders >= 2, `${borders} crossings`)
  check('risks present', risks > 0, `${risks} risks`)

  const padang = await page.textContent('body')
  check('Padang Besar timezone trap surfaced', /UTC\+7/.test(padang) && /UTC\+8/.test(padang))
  check('Vientiane gauge break surfaced', /15 km/.test(padang))
  check('booking sequence present', (await page.locator('.booking li').count()) > 0)

  // Every leg must offer some route to a ticket: an operator link, an
  // aggregator fallback, or an honest "pay at the counter".
  const bookless = await page.evaluate(
    () => [...document.querySelectorAll('tr.leg')].filter(r => !r.querySelector('.book-leg')).length
  )
  check('every leg has a way to book it', bookless === 0, `${bookless} without`)
  check('operator plates render', (await page.locator('tr.leg .plate').count()) === legs)
  /* The promise narrowed when hotels and insurance started paying, and the
   * narrower version has to stay exactly true: transport links earn nothing,
   * and the operator-first ordering is not for sale. */
  const panelText = await page.textContent('#panel')
  check('transport links are still declared unpaid',
    /No affiliate links on transport/.test(panelText))
  check('and where it does earn is stated plainly',
    /Where it does earn/.test(panelText) && /pay a commission/.test(panelText))

  // A paid link that is not marked is a link-scheme violation, and would cost
  // far more in rankings than it earns.
  const paid = await page.locator('a.stay-book').evaluateAll(a =>
    a.map(x => ({ rel: x.rel, host: new URL(x.href).host }))
  )
  check('paid links exist on a route with hotel nights', paid.length > 0, `${paid.length} links`)
  check('every paid link is marked sponsored',
    paid.every(l => /sponsored/.test(l.rel) && /nofollow/.test(l.rel)),
    paid.filter(l => !/sponsored/.test(l.rel)).map(l => l.host).join(' ') || 'all marked')

  // The reverse: nothing on a transport leg may be a paid link.
  const legLinks = await page.locator('tr.leg a').evaluateAll(a =>
    a.map(x => ({ rel: x.rel, cls: x.className }))
  )
  check('no booking link on a leg is paid',
    legLinks.every(l => !/sponsored/.test(l.rel)),
    `${legLinks.length} leg links checked`)

  // Nothing may overflow the panel horizontally.
  const overflow = await page.evaluate(() => {
    const p = document.querySelector('#panel')
    return p.scrollWidth - p.clientWidth
  })
  check('panel does not scroll sideways', overflow <= 1, `${overflow}px`)

  await page.screenshot({ path: join(outDir, '02-route-dark.png') })
  await context.close()
}

/* ------------------------------------- boats the rails cannot replace */
{
  const { page, context } = await newPage()
  await page.goto(url)
  await page.waitForFunction(() => document.querySelector('#panel h1'))
  await page.locator('.corridor', { hasText: 'The Mekong slow boat' }).click()
  await page.waitForFunction(() => document.querySelector('.route tbody tr'))
  await page.waitForTimeout(1100)

  const modes = await page.locator('.mode-dot.ferry').count()
  check('slow boat routed by water', modes >= 2, `${modes} sea legs`)

  const text = await page.textContent('#panel')
  check('Mekong boat named, not a generic ferry', /Mekong slow boat/.test(text))
  check('speedboat safety flagged', /safety record/.test(text))
  check('Huay Xai border briefed', /Huay Xai/.test(text))

  // It must not backtrack down the whole Thai network to reach Laos by rail.
  const legs = await page.locator('tr.leg').count()
  check('route does not detour via Bangkok', !/Krung Thep/.test(text), `${legs} legs`)

  await page.screenshot({ path: join(outDir, '11-mekong-slow-boat.png') })
  await context.close()
}

/* ---------------------------------------------- no rail answer at all */
{
  const { page, context } = await newPage()
  await page.goto(url)
  await page.waitForFunction(() => document.querySelector('#panel h1'))
  await page.locator('.corridor', { hasText: 'Bangkok → Hanoi' }).click()
  await page.waitForFunction(() => document.querySelector('.route tbody tr'))
  await page.waitForTimeout(900)

  const text = await page.textContent('#panel')
  check('bus named honestly', /no railway/i.test(text))
  const roadLegs = await page.locator('.mode-dot.road').count()
  check('road leg drawn as road', roadLegs > 0, `${roadLegs} road legs`)

  await page.screenshot({ path: join(outDir, '03-no-rail-answer.png') })
  await context.close()
}

/* ------------------------------------------------ hard rail-only mode */
{
  const { page, context } = await newPage()
  await page.goto(url)
  await page.waitForFunction(() => document.querySelector('#panel h1'))
  await page.locator('.corridor', { hasText: 'Bangkok → Hanoi' }).click()
  await page.waitForFunction(() => document.querySelector('.route tbody tr'))
  // Secondary options live behind a disclosure now; open it, then click the
  // label rather than the visually hidden input.
  await page.locator('.details > summary').click()
  await page.locator('.toggle-text b').click()
  await page.waitForTimeout(700)

  check('toggle actually flipped', await page.locator('#railonly').isChecked())
  const text = await page.textContent('#panel')
  check('rail-only refuses rather than stretches', /rails do not go this way/i.test(text))
  await page.screenshot({ path: join(outDir, '04-rail-only-refusal.png') })
  await context.close()
}

/* ------------------------------------------- asking in plain language */
{
  const { page, context } = await newPage()
  await page.goto(url)
  await page.waitForFunction(() => document.querySelector('#panel h1'))
  await page.waitForTimeout(500)

  /* Every corridor card carries art — a photograph or a drawing, whichever the
   * build had room for. Counting canvases alone broke the moment photographs
   * started displacing them, so ask the real question: does each slot show
   * something? A blank canvas and an image that never loaded both fail. */
  const art = await page.evaluate(() =>
    [...document.querySelectorAll('.corridor-art')].map(slot => {
      const img = slot.querySelector('img.photo')
      if (img) return img.complete && img.naturalWidth > 0 ? 'photo' : 'broken image'
      const c = slot.querySelector('canvas.scene')
      if (!c) return 'nothing'
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
      const seen = new Set()
      for (let i = 0; i < d.length; i += 800) seen.add(`${d[i]},${d[i + 1]},${d[i + 2]}`)
      return seen.size > 5 ? 'drawing' : 'blank canvas'
    })
  )
  const good = art.filter(a => a === 'photo' || a === 'drawing')
  check('destination art renders on every card', art.length >= 6 && good.length === art.length,
    `${art.filter(a => a === 'photo').length} photographed, ${
      art.filter(a => a === 'drawing').length
    } drawn${good.length === art.length ? '' : `, BAD: ${art.filter(a => !good.includes(a))}`}`)

  await page.fill('#askbox', 'how do I get from Angkor Wat to Ha Long Bay')
  await page.click('#askgo')
  await page.waitForFunction(() => document.querySelector('.route tbody tr'))
  await page.waitForTimeout(900)

  const h1 = (await page.textContent('#panel h1')).replace(/\s+/g, ' ').trim()
  check('answered in the words that were asked', /Angkor Wat/.test(h1) && /Ha Long Bay/.test(h1), h1)
  check('railheads still shown', /Sisophon/.test(await page.textContent('.eyebrow')))

  const note = await page.textContent('#asknote')
  check('the road gap to Angkor is disclosed', /two hours by road/i.test(note))
  check('selects reflect the reading', (await page.locator('#from').inputValue()) === 'sisophon')

  await page.fill('#askbox', 'from mordor to gondor')
  await page.click('#askgo')
  await page.waitForTimeout(400)
  const nonsense = await page.textContent('#asknote')
  check('nonsense is refused, not guessed at', /not on this network/i.test(nonsense), nonsense.trim())
  check('and nothing is offered back as a near miss',
    (await page.locator('#asknote .ask-sug').count()) === 0)

  /* Spelling. The gazetteer is full of names nobody spells right first time,
   * and until this existed "kuala lumper" came back Taman Negara. */
  await page.fill('#askbox', 'bankok to singpore')
  await page.click('#askgo')
  await page.waitForFunction(() => document.querySelector('.route tbody tr'))
  await page.waitForTimeout(700)
  const fixed = await page.textContent('#asknote')
  check('a misspelling still finds the place', /Bangkok/.test(fixed) && /Singapore/.test(fixed))
  check('and the correction is shown, not applied silently',
    /read “bankok” as Bangkok/.test(fixed), fixed.replace(/\s+/g, ' ').trim())

  /* One letter apart and 700 km apart. Guessing here is worse than asking. */
  await page.fill('#askbox', 'ranyong to bangkok')
  await page.click('#askgo')
  await page.waitForTimeout(500)
  const ambiguous = await page.textContent('#asknote')
  check('an ambiguous spelling asks instead of guessing',
    /more than one place/i.test(ambiguous), ambiguous.replace(/\s+/g, ' ').trim())
  const sugs = await page.locator('#asknote .ask-sug').allTextContents()
  check('and offers both real candidates', sugs.includes('Rayong') && sugs.includes('Ranong'), sugs.join(', '))

  // Clicking one resolves it without making anyone retype the question.
  await page.locator('#asknote .ask-sug', { hasText: 'Rayong' }).click()
  await page.waitForFunction(() => document.querySelector('.route tbody tr'))
  await page.waitForTimeout(700)
  check('clicking a suggestion routes it', /Rayong/.test(await page.textContent('#panel h1')),
    (await page.textContent('#panel h1')).replace(/\s+/g, ' ').trim())

  // The reported bug: a real station that was simply missing from the network.
  await page.fill('#askbox', 'pattaya to hanoi')
  await page.click('#askgo')
  await page.waitForFunction(() => document.querySelector('.route tbody tr'))
  await page.waitForTimeout(700)
  const h1b = (await page.textContent('#panel h1')).replace(/\s+/g, ' ').trim()
  check('Pattaya to Hanoi returns a route', /Pattaya/.test(h1b) && /Hanoi/.test(h1b), h1b)

  await page.screenshot({ path: join(outDir, '16-ask-answer.png') })
  await context.close()
}

/* ---------------------------------------------- frequency and the day plan
 * The nearest thing to a timetable this project will produce, and the point of
 * the exercise is what it refuses to say. A frequency and a last sailing are
 * structural; a departure time is a date-specific fact nobody here publishes,
 * and stating one would be the single most dangerous thing on the page. */
{
  const { page, context } = await newPage()
  await page.goto(url)
  await page.waitForFunction(() => document.querySelector('#panel h1'))

  // A route with a once-or-twice-a-day boat and a hard last sailing.
  await page.fill('#askbox', 'bangkok to koh samet')
  await page.click('#askgo')
  await page.waitForFunction(() => document.querySelector('.route tbody tr'))
  await page.waitForTimeout(900)

  const freqs = await page.locator('.route .freq').count()
  const legs = await page.locator('.route tr.leg').count()
  check('every leg says how often it runs', freqs === legs, `${freqs} of ${legs}`)
  check('nothing is left as "not recorded"',
    (await page.locator('.route .freq.none').count()) === 0)

  const lastCalls = await page.locator('.route .freq .last').allTextContents()
  check('the last sailing is called out', lastCalls.length > 0, lastCalls.join(', '))

  const panelText = await page.textContent('#panel')
  check('and it is still not pretending to be a timetable',
    /not departures/i.test(panelText) && /publish nothing in common/i.test(panelText))

  // The day plan must agree with the day count in the headline stats.
  const dayCards = await page.locator('.days .day').count()
  const statDays = await page.evaluate(() => {
    const stat = [...document.querySelectorAll('.stat')].find(s => /days?/.test(s.textContent))
    return stat ? Number(stat.querySelector('b').textContent) : null
  })
  check('the day plan agrees with the day count', dayCards === statDays, `${dayCards} cards, ${statDays} in stats`)
  check('every day but the last says where the night goes',
    (await page.locator('.days .night').count()) === dayCards)

  await page.screenshot({ path: join(outDir, '25-schedule.png'), fullPage: false })
  await context.close()
}

/* ------------------------------------------------------- art, and where it starts
 * Three corridors finish in Singapore, so taking the picture from each card's
 * terminus put the same photograph on adjacent cards. Adjacent identical images
 * read as a broken page, which is a cheap way to lose the reader's trust in
 * everything else. */
{
  const { page, context } = await newPage()
  await page.goto(url)
  await page.waitForFunction(() => document.querySelector('.corridor'))
  await page.waitForTimeout(1000)

  const art = await page.evaluate(() =>
    [...document.querySelectorAll('.corridor')].map(c => {
      const img = c.querySelector('img.photo')
      if (img) return 'photo:' + img.getAttribute('src').slice(-48)
      const cv = c.querySelector('canvas.scene')
      return 'drawn:' + (cv ? cv.dataset.scene + '/' + cv.dataset.seed : 'none')
    })
  )
  const repeated = art.filter((a, i) => art.indexOf(a) !== i)
  check('no two corridor cards share a picture', repeated.length === 0,
    repeated.length ? repeated.join(', ') : `${art.length} distinct`)
}

/* On a phone the search box is the first thing anyone needs, and the idle state
 * used to scroll it off the top of the screen before they had typed in it. */
{
  const { page, context } = await newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  })
  await page.goto(url)
  await page.waitForFunction(() => document.querySelector('#panel h1'))
  await page.waitForTimeout(900)

  const box = await page.locator('#askbox').boundingBox()
  check('the search box is on screen when the page opens',
    !!box && box.y >= 0 && box.y < 844, box ? `y=${Math.round(box.y)}` : 'not found')

  /* Picking a route should still carry you to the answer — but the page no
     longer scrolls on a phone. The map holds the screen and the itinerary is
     a sheet over it, so "go to the result" means the sheet comes up. */
  // The grip cycles half → full → peek, so two taps put it out of the way.
  await page.evaluate(() => document.querySelector('#grip').click())
  await page.waitForTimeout(400)
  await page.evaluate(() => document.querySelector('#grip').click())
  await page.waitForTimeout(500)
  const down = await page.evaluate(() => document.querySelector('#sheet').dataset.snap)

  await page.locator('.corridor').first().click()
  await page.waitForFunction(() => document.querySelector('.route tbody tr'))
  await page.waitForTimeout(1400)
  check('choosing a route brings the answer up',
    down === 'peek' &&
      (await page.evaluate(() => document.querySelector('#sheet').dataset.snap)) !== 'peek',
    `${down} → ${await page.evaluate(() => document.querySelector('#sheet').dataset.snap)}`)

  check('and nothing behind the map scrolls any more',
    (await page.evaluate(
      () => document.documentElement.scrollHeight - window.innerHeight
    )) <= 0)
  await context.close()
}

/* ------------------------------------------------------------ the sights
 * 89 landmarks sat in the data with photographs attached and none of them
 * appeared on the map. They are drawn where they actually are, not on the
 * railhead that serves them — Angkor is a hundred kilometres from Sisophon,
 * and putting it on top of the station would be the lie this table exists to
 * prevent. */
{
  const LANDMARKS = new Function(
    readFileSync(join(root, 'data/landmarks.js'), 'utf8') + '; return LANDMARKS'
  )()
  const placed = LANDMARKS.filter(l => l.lat != null && l.lon != null)
  check('every landmark has a position', placed.length === LANDMARKS.length,
    `${placed.length} of ${LANDMARKS.length}`)

  // Sanity on the coordinates themselves: a sight should be near the station
  // that serves it, and inside the map's own bounds.
  const km = (a, b) =>
    Math.hypot((a.lat - b.lat) * 111, (a.lon - b.lon) * 111 * Math.cos((a.lat * Math.PI) / 180))
  const strays = placed
    .map(l => ({ name: l.name, d: Math.round(km(l, NETWORK.stations[l.station])) }))
    .filter(x => x.d > 150)
  check('no landmark is implausibly far from its railhead', strays.length === 0,
    strays.map(x => `${x.name} ${x.d}km`).join(', ') || 'furthest is under 150 km')

  const { page, context } = await newPage({ viewport: { width: 1440, height: 900 } })
  await page.goto(url)
  await page.waitForFunction(() => document.querySelector('#panel h1'))
  await page.waitForTimeout(1100)

  /* Angkor is the case this table exists for: a hundred kilometres from the
   * nearest railhead, and the sight everybody actually asks for. It sits six
   * kilometres from the Siem Reap terminal, which at the opening zoom is the
   * same pixel — and stations deliberately win that tie — so zoom in first,
   * exactly as a reader would. */
  const angkor = LANDMARKS.find(l => l.name === 'Angkor Wat')
  /* Fold the controls first. Zooming here means wheeling with the pointer on
   * the target, and as the view tightens Angkor drifts left until it is behind
   * the panel — at which point the wheel is scrolling a form, not the map, and
   * the zoom silently stops short. A reader looking closely at Cambodia would
   * fold it away for the same reason. */
  await page.click('#fold')
  await page.waitForTimeout(400)
  await zoomOn(page, angkor.lon, angkor.lat, 18)
  const sightHit = await hover(page, angkor.lon, angkor.lat)
  const sight = sightHit && sightHit.text
  check('a sight on the map opens its own popup', !!sight, sight || 'nothing there')
  check('and it names the railhead rather than pretending to be one',
    !!sight && /railhead Sisophon/.test(sight), sight || '')
  check('with the road gap stated', !!sight && /Two hours by road/.test(sight))

  if (sight) {
    await page.locator('#tip .tip-go').first().click()
    await page.waitForTimeout(400)
    const from = await page.locator('#from').inputValue()
    check('routing from a sight targets its railhead', from === 'sisophon', from)
  }

  /* Out to the real map for the last mile, which is the one thing the chart
   * cannot show. By name, because the stored coordinates are only good to about
   * a kilometre — but never qualified by the railhead's town, because across a
   * road gap the railhead is two hours from the sight. */
  await hover(page, angkor.lon, angkor.lat)
  const links = (
    await page.locator('#tip .tip-map').evaluateAll(a => a.map(x => x.href))
  ).map(decodeURIComponent)
  check('a sight links out to the real map', links.some(h => /maps\/search/.test(h)), links.length + ' links')

  const search = links.find(h => /maps\/search/.test(h))
  check('a sight is searched by its own name', /query=Angkor Wat, Cambodia/.test(search), search)
  check('and is not mislabelled with a railhead two hours away',
    !/Sisophon/.test(search), search)

  const dir = links.find(h => /maps\/dir/.test(h))
  check('and offers directions across the road gap, starting at the railhead',
    !!dir &&
      /origin=Sisophon railway station, Sisophon, Cambodia/.test(dir) &&
      /destination=Angkor Wat, Cambodia/.test(dir),
    dir || 'no directions link')

  check('the legend explains the new mark',
    (await page.locator('.legend .lmark').count()) === 1)
  await context.close()
}

/* -------------------------------------------------- directions from a point
 * Hovering a station offers the two things anyone wants from a point on a map:
 * start here, or end here. The hard part is not the popup — it is that the
 * pointer has to cross ordinary map to reach the buttons, and a naive "no hit
 * means hide" snatches them away mid-reach. */
{
  const { page, context } = await newPage({ viewport: { width: 1440, height: 900 } })
  await page.goto(url)
  await page.waitForFunction(() => document.querySelector('#panel h1'))
  await page.waitForTimeout(1100)

  const bangkok = NETWORK.stations.bkk_aphiwat
  const first = await hover(page, bangkok.lon, bangkok.lat)
  check('hovering a station opens a popup', !!first, first ? `at ${first.x},${first.y}` : 'none found')

  /* By name, not by coordinate. Station coordinates are stored to two decimal
   * places — about a kilometre — so a dropped pin lands near the station and
   * labelled nothing, which is exactly the bug this replaced. */
  const stationLink = decodeURIComponent(
    await page.locator('#tip .tip-map').first().getAttribute('href')
  )
  check('a station links out by name, not by a kilometre-wide coordinate',
    /query=Krung Thep Aphiwat railway station, Bangkok, Thailand/.test(stationLink),
    stationLink)
  check('and no maps link ships a bare lat,lon',
    !/query=-?\d+\.\d+,-?\d+\.\d+/.test(stationLink), stationLink)

  const actions = await page.locator('#tip .tip-go').allTextContents()
  check('it offers both directions', actions.length === 2 && /from here/i.test(actions[0]) && /to here/i.test(actions[1]),
    actions.join(' | '))

  // The reach test: travel from the marker to the button and it must survive.
  const tip = await page.locator('#tip').boundingBox()
  await page.mouse.move(tip.x + tip.width / 2, tip.y + tip.height - 14, { steps: 14 })
  await page.waitForTimeout(220)
  check('the popup survives the reach for its buttons',
    await page.locator('#tip.live').isVisible())

  await page.locator('#tip .tip-go').first().click()
  await page.waitForTimeout(400)
  const from = await page.locator('#from').inputValue()
  check('"from here" sets the origin', !!from, from)

  // The second station should now offer to finish the route, by name.
  const kl = NETWORK.stations.klsentral
  const second = await hover(page, kl.lon, kl.lat)
  check('a second station offers to complete it', !!second)
  const labelled = await page.locator('#tip .tip-go').nth(1).textContent()
  check('and names the origin it would run from', /→ end here/.test(labelled), labelled.trim())

  await page.locator('#tip .tip-go').nth(1).click()
  await page.waitForFunction(() => document.querySelector('.route tbody tr'))
  await page.waitForTimeout(800)
  check('choosing it routes', (await page.locator('tr.leg').count()) > 0,
    (await page.textContent('#panel h1')).replace(/\s+/g, ' ').trim())

  // An endpoint of the live route states its role rather than re-offering it.
  await page.mouse.move(10, 10)
  await page.waitForTimeout(200)
  await hover(page, bangkok.lon, bangkok.lat)
  const onRoute = await page.locator('#tip .tip-go.on').count()
  check('an endpoint says it is one, rather than offering again', onRoute >= 1, `${onRoute} marked`)

  await page.screenshot({ path: join(outDir, '28-station-popup.png') })
  await context.close()
}

/* ------------------------------------------------------------- what beds cost
 * The whole point of pricing per place rather than per region: a flat average
 * hides that one night on this route costs more than the other four together. */
{
  const { page, context } = await newPage()
  await page.goto(url)
  await page.waitForFunction(() => document.querySelector('#panel h1'))
  await page.locator('.corridor', { hasText: 'The Spine' }).click()
  await page.waitForFunction(() => document.querySelector('.route tbody tr'))
  await page.waitForTimeout(900)

  const nights = await page.locator('.stays > li').count()
  check('nights are listed where they are actually spent', nights > 0, `${nights} nights`)
  check('each night shows all three bands',
    (await page.locator('.stays .bands').count()) === nights)

  // The listed nights must add up to the figure in the cost table.
  const sums = await page.evaluate(() => {
    const each = [...document.querySelectorAll('.stays .stay-price')]
      .map(e => Number(e.textContent.replace(/[^0-9.]/g, '')))
    const row = [...document.querySelectorAll('.costs tr')].find(r => /Accommodation/.test(r.textContent))
    return { each, total: row ? Number(row.lastElementChild.textContent.replace(/[^0-9.]/g, '')) : null }
  })
  const listed = sums.each.reduce((a, b) => a + b, 0)
  check('the nights add up to the accommodation total',
    Math.abs(listed - sums.total) <= 1, `${listed} listed vs ${sums.total} charged`)

  // Changing the band must move the money, or the control is decoration.
  const totalAt = async tier => {
    await page.selectOption('#stay', tier)
    await page.waitForTimeout(600)
    return Number((await page.textContent('.costs .total')).replace(/[^0-9.]/g, ''))
  }
  await page.locator('.details > summary').click()
  const dorm = await totalAt('dorm')
  const comfort = await totalAt('comfort')
  check('the beds setting changes the total', comfort > dorm, `$${dorm} hostel vs $${comfort} mid-range`)

  await context.close()
}

/* Singapore is the single most expensive night anywhere on this map, and the
 * planner should say so where someone can still act on it. */
{
  const { page, context } = await newPage()
  await page.goto(url)
  await page.waitForFunction(() => document.querySelector('#panel h1'))
  await page.locator('.corridor', { hasText: 'Singapore → Bali' }).click()
  await page.waitForFunction(() => document.querySelector('.route tbody tr'))
  await page.waitForTimeout(900)

  const sgRate = NETWORK.lodging.byStation.singapore.room
  const jbRate = NETWORK.lodging.byStation.jbsentral.room
  check('Singapore is priced far above its neighbour', sgRate > jbRate * 3,
    `$${sgRate} vs $${jbRate} in Johor Bahru`)

  await page.screenshot({ path: join(outDir, '26-lodging.png') })
  await context.close()
}

/* --------------------------------------------- nothing is fetched at runtime
 * The premise the whole thing rests on: it works at a border post with no
 * signal, and inside a strict-CSP artifact. Linking out to Google Maps is fine;
 * loading it would end both. This is the guard on that decision. */
{
  const { page, context } = await newPage()
  const external = []
  page.on('request', r => {
    const u = r.url()
    if (!u.startsWith('file:') && !u.startsWith('data:') && !u.startsWith('blob:')) external.push(u)
  })
  await page.goto(url)
  await page.waitForFunction(() => document.querySelector('#panel h1'))
  await page.locator('.corridor').first().click()
  await page.waitForFunction(() => document.querySelector('.route tbody tr'))
  await page.waitForTimeout(1000)
  check('the page fetches nothing from the network', external.length === 0,
    external.slice(0, 3).join(', ') || 'zero requests')

  // Every external host in the page must be a link, never a loaded resource.
  const linked = await page.evaluate(() =>
    [...new Set([...document.querySelectorAll('a[href^="http"]')].map(a => new URL(a.href).host))]
  )
  check('external hosts appear only as links', linked.length > 0, `${linked.length} linked hosts`)
  await context.close()
}

/* --------------------------------- the fragment, which has no assets beside it
 * dist/planner.html is published as one file. Any photograph the build linked
 * rather than embedded cannot resolve there, so every one of them must come
 * back as a drawing — not as a broken image frame, and not still carrying the
 * photographer's credit for a picture nobody can see. */
{
  const { page, context } = await newPage()
  await page.goto('file://' + join(root, 'dist/planner.html'))
  await page.waitForFunction(() => document.querySelector('#panel h1'))
  await page.waitForTimeout(1200)

  const art = await page.evaluate(() =>
    [...document.querySelectorAll('.corridor-art')].map(slot => {
      const img = slot.querySelector('img.photo')
      if (img) return img.complete && img.naturalWidth > 0 ? 'photo' : 'broken image'
      return slot.querySelector('canvas.scene') ? 'drawing' : 'nothing'
    })
  )
  check('the assetless fragment shows no broken images',
    art.length > 0 && art.every(a => a === 'photo' || a === 'drawing'), art.join(', '))

  const orphanCredits = await page.evaluate(
    () => [...document.querySelectorAll('.corridor-art')]
      .filter(s => !s.querySelector('img.photo') && s.querySelector('.photo-credit')).length
  )
  check('no credit left behind by a photo that did not load', orphanCredits === 0)
  await context.close()
}

/* ------------------------------------------------------ the Maeklong line */
{
  const { page, context } = await newPage()
  await page.goto(url)
  await page.waitForFunction(() => document.querySelector('#panel h1'))

  // The line is two stubs with a river between them. If this ever comes back
  // without a boat in the middle, someone has quietly bridged the Tha Chin.
  await page.fill('#askbox', 'bangkok to maeklong railway market')
  await page.click('#askgo')
  await page.waitForFunction(() => document.querySelector('.route tbody tr'))
  await page.waitForTimeout(900)

  const text = await page.textContent('#panel')
  check('the umbrella market resolves to its own station', /Maeklong/.test(text))
  check('the river crossing survives merging — it is a boat, not a train',
    /Tha Chin/.test(text))
  check('and the four-train constraint is stated', /four a day|Four trains/i.test(text))

  await page.screenshot({ path: join(outDir, '19-maeklong.png') })
  await context.close()
}

/* ------------------------------------------------------- the Philippines */
{
  const { page, context } = await newPage()
  await page.goto(url)
  await page.waitForFunction(() => document.querySelector('#panel h1'))

  // The overland answer to a route everybody flies. If this ever comes back as
  // a single leg, a boat has been invented somewhere.
  await page.locator('.corridor', { hasText: 'Manila → Boracay' }).click()
  await page.waitForFunction(() => document.querySelector('.route tbody tr'))
  await page.waitForTimeout(900)

  const text = await page.textContent('#panel')
  const legs = await page.locator('.route tbody tr').count()
  check('Boracay reached without flying', legs >= 4, `${legs} legs`)
  check('the jetty crossing is named', /Caticlan/.test(text))
  check('Philippine operators named, not "ferry"', /Montenegro/.test(text))

  await page.screenshot({ path: join(outDir, '17-manila-boracay.png') })

  // Asking for a route into the archipelago must explain the world, not
  // report a missing edge.
  await page.fill('#askbox', 'how do I get from Bangkok to Manila')
  await page.click('#askgo')
  await page.waitForTimeout(900)
  const cut = await page.textContent('#panel')
  check('the sea gap is explained, not shrugged at', /Not a gap in the map/.test(cut))
  check('the suspended Sandakan ferry is named', /Sandakan/.test(cut))
  check('and the country is not written off as railless', /PNR|Bicol/.test(cut))

  await page.screenshot({ path: join(outDir, '18-philippines-unreachable.png') })
  await context.close()
}

/* ------------------------------------------------- getting back to home */
{
  const { page, context } = await newPage()
  await page.goto(url)
  await page.waitForFunction(() => document.querySelector('#panel h1'))
  check('start over hidden until there is a route',
    !(await page.locator('#startover').isVisible()))

  await page.locator('.corridor', { hasText: 'Bangkok → Singapore' }).click()
  await page.waitForFunction(() => document.querySelector('.route tbody tr'))
  await page.waitForTimeout(900)
  check('start over appears with a route', await page.locator('#startover').isVisible())
  check('route is shareable via the url', /from=bkk_aphiwat/.test(page.url()))

  await page.locator('#startover').click()
  await page.waitForTimeout(600)
  check('start over returns to the corridor list', (await page.locator('.corridor').count()) >= 6)
  check('start over clears the url', !/from=/.test(page.url()))
  check('start over clears the pair', (await page.locator('#from').inputValue()) === '')

  // The wordmark is the other way home, and must work the same.
  await page.locator('.corridor', { hasText: 'Laos → Malaysia' }).click()
  await page.waitForFunction(() => document.querySelector('.route tbody tr'))
  await page.locator('#home').click()
  await page.waitForTimeout(600)
  check('wordmark goes home too', (await page.locator('.corridor').count()) >= 6)

  await page.screenshot({ path: join(outDir, '14-home.png') })
  await context.close()
}

/* --------------------------------------------------------- light theme */
{
  const { page, context } = await newPage({ colorScheme: 'light' })
  await page.goto(url)
  await page.waitForFunction(() => document.querySelector('#panel h1'))
  await page.locator('.corridor', { hasText: 'Singapore → Bali' }).click()
  await page.waitForFunction(() => document.querySelector('.route tbody tr'))
  await page.waitForTimeout(1100)
  await page.screenshot({ path: join(outDir, '05-route-light.png') })

  // The viewer's toggle stamps data-theme; it must beat the media query.
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
  await page.waitForTimeout(400)
  const bg = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--sea').trim()
  )
  check('data-theme overrides prefers-color-scheme', bg === '#0a191f', bg)
  await context.close()
}

/* ------------------------------------------------------- the theme control
 * Three states, because the stylesheet already honours prefers-color-scheme
 * and a two-way switch would throw that away. The map is a canvas, so it does
 * not inherit the palette — it has to actually repaint. */
{
  const { page, context } = await newPage({ colorScheme: 'dark' })
  await page.goto(url)
  await page.waitForFunction(() => document.querySelector('#panel h1'))
  await page.waitForTimeout(700)

  const readTheme = () =>
    page.evaluate(() => ({
      mode: document.querySelector('#theme').dataset.mode,
      attr: document.documentElement.getAttribute('data-theme'),
      sea: getComputedStyle(document.documentElement).getPropertyValue('--sea').trim(),
      label: document.querySelector('#theme').getAttribute('aria-label'),
      // Top-left of the canvas is open sea on every view.
      pixel: (() => {
        const c = document.querySelector('#map')
        const d = c.getContext('2d').getImageData(4, 4, 1, 1).data
        return `${d[0]},${d[1]},${d[2]}`
      })(),
    }))

  const start = await readTheme()
  check('opens following the system', start.mode === 'auto' && start.attr === null, start.mode)

  const seen = [start]
  for (let i = 0; i < 3; i++) {
    await page.click('#theme')
    await page.waitForTimeout(450)
    seen.push(await readTheme())
  }
  check('the button cycles auto → light → dark → auto',
    seen.map(x => x.mode).join(' → ') === 'auto → light → dark → auto',
    seen.map(x => x.mode).join(' → '))
  check('light actually changes the palette', seen[1].sea !== seen[0].sea,
    `${seen[0].sea} → ${seen[1].sea}`)
  check('and the map canvas repaints with it', seen[1].pixel !== seen[0].pixel,
    `${seen[0].pixel} → ${seen[1].pixel}`)
  check('the button says what it will do next', /switch to/i.test(seen[0].label), seen[0].label)

  // A choice has to survive a reload, or it is not a preference.
  await page.click('#theme')
  await page.waitForTimeout(300)
  await page.reload()
  await page.waitForFunction(() => document.querySelector('#panel h1'))
  await page.waitForTimeout(700)
  const after = await readTheme()
  check('the choice survives a reload', after.mode === 'light' && after.attr === 'light', after.mode)

  await page.screenshot({ path: join(outDir, '27-theme-light.png') })
  await context.close()
}

/* -------------------------------------------------------------- mobile */
{
  const { page, context } = await newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  })
  await page.goto(url)
  await page.waitForFunction(() => document.querySelector('#panel h1'))
  await page.locator('.corridor', { hasText: 'Bangkok → Singapore' }).click()
  await page.waitForFunction(() => document.querySelector('.route tbody tr'))
  await page.waitForTimeout(1100)

  const bodyOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  )
  check('page body does not scroll sideways on mobile', bodyOverflow <= 1, `${bodyOverflow}px`)

  await page.screenshot({ path: join(outDir, '06-mobile.png'), fullPage: false })
  await context.close()
}

/* -------------------------------------------- describing a place you can't name */
{
  const { page, context } = await newPage()
  await page.goto(url)
  await page.waitForFunction(() => document.querySelector('#panel h1'))
  await page.click('.describe summary')
  await page.waitForTimeout(200)

  const ask = async q => {
    await page.fill('#describebox', q)
    await page.waitForTimeout(350)
    return page.locator('#describe-out .d-name').allTextContents()
  }

  /* The case a spelling-tolerant matcher cannot reach: there is no spelling of
   * "umbrella market" close to "Maeklong". */
  const market = await ask('the market the train drives through')
  check('a described place resolves without its name',
    /Maeklong/.test(market[0] || ''), market[0] || 'nothing')

  const beach = await ask('a beach you can only reach by boat')
  check('and so does one described by how you get there',
    /Railay/.test(beach[0] || ''), beach[0] || 'nothing')

  const moon = await ask('island with the full moon party')
  check('and one described by what happens there',
    /Full Moon/.test(moon[0] || ''), moon[0] || 'nothing')

  // The evidence matters as much as the hit: a match you cannot check is a guess.
  check('each result shows the sentence that earned it',
    (await page.locator('#describe-out .d-why').count()) > 0)
  check('and the words you typed are marked in it',
    (await page.locator('#describe-out .d-why b').count()) > 0)

  // Picking one has to actually plan from it.
  await ask('the market the train drives through')
  await page.locator('#describe-out button[data-pick="from"]').first().click()
  await page.waitForTimeout(700)
  check('picking a described place sets the route',
    (await page.inputValue('#from')) === 'maeklong', await page.inputValue('#from'))

  const nothing = await ask('xyzzy quux flurble')
  check('a miss says so instead of guessing', nothing.length === 0)
  check('and suggests a better way to ask',
    /what happens at the place/i.test(await page.textContent('#describe-out')))

  await page.screenshot({ path: join(outDir, '23-describe.png') })
  await context.close()
}

/* ------------------------------------------------- the islands are drawn */
{
  const bm = JSON.parse(readFileSync(join(root, 'data/basemap.json'), 'utf8'))
  check('the small islands are in the basemap', (bm.islands || []).length > 300,
    `${(bm.islands || []).length} islands`)

  // A ferry terminal drawn in open water reads as a bug. Most of these are on
  // land now; the count is the guard against a rebuild quietly losing them.
  const rings = [...bm.countries.flatMap(c => c.rings), ...(bm.islands || [])]
  const inRing = (p, r) => {
    let c = false
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i]
      const [xj, yj] = r[j]
      if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c
    }
    return c
  }
  const onLand = Object.values(NETWORK.stations).filter(s =>
    rings.some(r => inRing([s.lon, s.lat], r))
  ).length
  check('stations sit on drawn land', onLand >= 183,
    `${onLand} of ${Object.keys(NETWORK.stations).length}`)

  // Islands Natural Earth's country polygons do not have at any resolution.
  const near = (lon, lat) =>
    rings.some(r => r.some(v => Math.abs(v[0] - lon) < 0.2 && Math.abs(v[1] - lat) < 0.2))
  check('Koh Tao is on the map at last', near(99.84, 10.1))
  check('and so are the Gilis and Boracay', near(116.04, -8.35) && near(121.93, 11.95))
}

/* ------------------------------------------- getting the panel out of the way */
{
  /* Narrower than the suite's default on purpose. Whether the panel covers
   * northwest Thailand depends on how wide the window is — at 1600 it clears
   * it, on a 13-inch laptop it does not, and the laptop is where the complaint
   * came from. */
  const { page, context } = await newPage({ viewport: { width: 1280, height: 900 } })
  await page.goto(url)
  await page.waitForFunction(() => document.querySelector('#panel h1'))
  await page.waitForTimeout(1100)

  // Northwest Thailand sits under the controls at the default view: Chiang Mai,
  // Chiang Rai and Pai are all behind the panel.
  const covered = async () =>
    page.evaluate(() =>
      [[98.98, 18.79], [99.88, 19.91], [98.44, 19.36]].filter(([lo, la]) => {
        const q = window.OverlandMap.locate(lo, la)
        if (!q) return false
        const b = document.querySelector('#map').getBoundingClientRect()
        const el = document.elementFromPoint(b.left + q.x, b.top + q.y)
        return !!(el && el.closest('.controls'))
      }).length
    )

  check('the panel does cover northwest Thailand', (await covered()) === 3,
    `${await covered()} of 3 hidden`)

  await page.click('#fold')
  await page.waitForTimeout(700)
  check('folding it gives that corner back', (await covered()) === 0,
    `${await covered()} of 3 still hidden`)
  check('and the map is told its room changed',
    (await page.getAttribute('.controls', 'data-collapsed')) === 'true')

  // Folded, it still says where you are going — otherwise the route vanishes
  // from the controls along with the panel.
  await page.click('#fold')
  await page.waitForTimeout(400)
  await page.locator('.corridor', { hasText: 'Bangkok → Singapore' }).click()
  await page.waitForFunction(() => document.querySelector('.route tbody tr'))
  await page.click('#fold')
  await page.waitForTimeout(500)
  check('the folded bar still names the route',
    /Bangkok → Singapore/.test(await page.textContent('.fold-what')),
    await page.textContent('.fold-what'))

  check('the button says what it will do next',
    /Show the search panel/.test(await page.textContent('#fold-label')))

  await page.reload()
  await page.waitForFunction(() => document.querySelector('#panel h1'))
  await page.waitForTimeout(900)
  check('the choice survives a reload',
    (await page.getAttribute('.controls', 'data-collapsed')) === 'true')

  await page.click('#fold')
  await page.waitForTimeout(400)
  check('and unfolding brings the controls back',
    await page.locator('#askbox').isVisible())

  await page.screenshot({ path: join(outDir, '22-folded.png') })
  await context.close()
}

/* ------------------------------------------------ something to actually index */
{
  const { execFileSync } = await import('node:child_process')
  const { existsSync, readdirSync } = await import('node:fs')

  // Build the pages against a known origin so the absolute-URL work is real.
  execFileSync('node', [join(root, 'tools/build-pages.mjs')], {
    cwd: root,
    env: { ...process.env, SITE_ORIGIN: 'https://example.test' },
    stdio: 'pipe',
  })

  const pub = join(root, 'public')
  const pages = readdirSync(pub).filter(f => f.endsWith('.html') && f !== 'index.html')
  check('routes are written out as real pages', pages.length >= 10, `${pages.length} pages`)

  const html = readFileSync(join(pub, 'bangkok-to-singapore-by-train.html'), 'utf8')
  const textOnly = html
    .replace(/<(style|script)[^>]*>[\s\S]*?<\/\1>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  // The point of the exercise: a crawler that runs no JavaScript still gets
  // the whole itinerary, not an empty shell waiting for a script.
  check('a page carries its itinerary without running any script',
    textOnly.length > 5000, `${textOnly.length} chars of text`)
  check('and the border mechanics come with it', /Padang Besar/.test(textOnly))
  check('and the operators are named', /KTMB|SRT/.test(textOnly))

  const h1s = html.match(/<h1[\s>]/g) || []
  check('exactly one h1, and it names the route', h1s.length === 1, `${h1s.length} found`)
  check('the h1 is the route, not the brand',
    /<h1>Bangkok to Singapore by train<\/h1>/.test(html))

  check('canonical points at the configured origin',
    html.includes('<link rel="canonical" href="https://example.test/bangkok-to-singapore-by-train">'))
  /* Titles lead with what people search and close with the brand. An unknown
   * brand in the first characters is spending the most valuable string on the
   * page on a word nobody types. */
  const homeTitle = readFileSync(join(root, 'index.html'), 'utf8').match(/<title>([^<]*)<\/title>/)[1]
  check('the homepage title leads with the search phrase, not the brand',
    /^Southeast Asia/.test(homeTitle) && /Overland SEA$/.test(homeTitle), homeTitle)
  check('and stays inside what a result actually shows',
    homeTitle.length <= 62, `${homeTitle.length} chars`)
  check('route page titles do the same',
    /^Bangkok to Singapore by train — Overland SEA$/.test(
      html.match(/<title>([^<]*)<\/title>/)[1]
    ))

  check('social cards are filled in',
    /og:title/.test(html) && /og:description/.test(html) && /twitter:card/.test(html))

  const ld = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1])
  check('structured data describes the trip', ld['@type'] === 'TouristTrip', ld['@type'])
  check('and lists the legs in order',
    ld.itinerary.itemListElement.length > 3 &&
      ld.itinerary.itemListElement[0].position === 1,
    `${ld.itinerary.itemListElement.length} stops`)

  /* Crawl reachability: every route page links to every other, so one landing
     page is enough to find the whole set.

     Route pages only. The crossing pages are a second, smaller mesh that links
     to itself and is reached from the routes that use it — a full mesh across
     both would put fifty links in the footer of every page, which is the point
     at which a helpful index starts reading as a link farm. */
  const linked = new Set([...html.matchAll(/href="\/([a-z0-9-]+)"/g)].map(m => m[1]))
  const slugs = pages
    .map(f => f.replace(/\.html$/, ''))
    .filter(s => !s.endsWith('-border-crossing') && s !== 'privacy')
  const missing = slugs.filter(s => s !== 'bangkok-to-singapore-by-train' && !linked.has(s))
  check('every other route is one hop away', missing.length === 0,
    missing.join(' ') || 'all reachable')

  check('sitemap lists every page',
    existsSync(join(pub, 'sitemap.xml')) &&
      slugs.every(s => readFileSync(join(pub, 'sitemap.xml'), 'utf8').includes(`/${s}<`)))
  check('robots points at the sitemap',
    /Sitemap: https:\/\/example\.test\/sitemap\.xml/.test(readFileSync(join(pub, 'robots.txt'), 'utf8')))

  // The honest half: with the origin explicitly cleared, nothing wrong is
  // emitted. This is what a build on an unknown host should do.
  execFileSync('node', [join(root, 'tools/build-pages.mjs')], {
    cwd: root,
    env: { ...process.env, SITE_ORIGIN: '' },
    stdio: 'pipe',
  })
  const bare = readFileSync(join(pub, 'bangkok-to-singapore-by-train.html'), 'utf8')
  check('a cleared origin emits no canonical rather than a wrong one',
    !/<link rel="canonical"/.test(bare) && !existsSync(join(pub, 'sitemap.xml')))

  /* And the default is the live domain, so a normal build needs no environment
   * at all. A preview overriding SITE_ORIGIN must not canonicalise itself to
   * production — that tells Google to index a page it did not just crawl. */
  execFileSync('node', [join(root, 'tools/build-pages.mjs')], { cwd: root, stdio: 'pipe' })
  const live = readFileSync(join(pub, 'bangkok-to-singapore-by-train.html'), 'utf8')
  check('a plain build canonicalises to the real domain',
    live.includes('<link rel="canonical" href="https://slowasia.com/bangkok-to-singapore-by-train">'))
  check('and the sitemap lists it there',
    readFileSync(join(pub, 'sitemap.xml'), 'utf8').includes('https://slowasia.com/'))
}

/* ------------------------------------------------- finding a station by typing */
{
  const { page, context } = await newPage()
  await page.goto(url)
  await page.waitForFunction(() => document.querySelector('#panel h1'))

  // Station rows only — the country headings are list items too.
  const rows = () => page.locator('#from-list li[data-i]').allTextContents()
  const groups = () => page.locator('#from-list .combo-group').allTextContents()

  await page.click('#from-q')
  await page.waitForTimeout(150)
  const everything = await rows()
  check('focusing the box offers the whole list',
    everything.length === Object.keys(NETWORK.stations).length,
    `${everything.length} of ${Object.keys(NETWORK.stations).length} stations`)

  /* Grouped, and down the map rather than down the alphabet: the countries run
     in the order the railway does, which is the order someone planning this
     already has in their head. */
  const order = await groups()
  check('and groups them by country', order.length === 11, order.join(' → '))
  check('in the order the railway runs',
    order[0] === 'China' && order[1] === 'Laos' &&
    order.indexOf('Malaysia') < order.indexOf('Singapore') &&
    order.indexOf('Singapore') < order.indexOf('Indonesia'),
    order.join(' → '))

  // The case a native select cannot do: the platform name, not the city.
  await page.fill('#from-q', 'gubeng')
  await page.waitForTimeout(150)
  const gubeng = await rows()
  check('typing a station name finds it, not just the city',
    gubeng.length === 1 && /Surabaya/.test(gubeng[0]), gubeng.join(' | '))

  // Accents folded, because the keyboard in front of you may not have them.
  await page.fill('#from-q', 'da nang')
  await page.waitForTimeout(150)
  const danang = await rows()
  check('accents fold, so "da nang" reaches Đà Nẵng',
    danang.length === 1 && /Nẵng/.test(danang[0]), danang.join(' | '))

  // Where a city has several stations, the one people mean leads.
  await page.fill('#from-q', 'sing')
  await page.waitForTimeout(150)
  check('the main terminal outranks the border post',
    /HarbourFront/.test((await rows())[0]), (await rows())[0])

  // Three letters and Enter, with nothing highlighted, takes the best match.
  await page.fill('#from-q', 'suraba')
  await page.waitForTimeout(150)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(400)
  check('Enter takes the top match', (await page.inputValue('#from')) === 'surabaya',
    await page.inputValue('#from'))

  // Arrow keys move, and the box reads back what was chosen.
  await page.fill('#to-q', 'jakar')
  await page.waitForTimeout(150)
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(600)
  check('arrow keys pick too', (await page.inputValue('#to')) === 'jakarta',
    await page.inputValue('#to'))
  check('and the box shows the station it chose',
    /Jakarta/.test(await page.inputValue('#to-q')), await page.inputValue('#to-q'))

  // Not rows(): a miss has no station rows, which is the whole point of it.
  await page.fill('#from-q', 'zzzz')
  await page.waitForTimeout(150)
  check('a miss says so rather than showing nothing',
    /Nothing matches/.test(await page.textContent('#from-list')) && (await rows()).length === 0)

  // A choice made anywhere else has to read back into the box, or the two
  // disagree about where you are going.
  await page.click('#startover')
  await page.waitForFunction(() => document.querySelector('.corridor'))
  await page.locator('.corridor', { hasText: 'Bangkok → Singapore' }).click()
  await page.waitForFunction(() => document.querySelector('.route tbody tr'))
  await page.waitForTimeout(600)
  const shown = await page.inputValue('#from-q')
  check('a corridor card fills the boxes too', /Bangkok|Krung Thep/.test(shown), shown)

  await page.screenshot({ path: join(outDir, '21-station-search.png') })
  await context.close()
}

/* --------------------------------------------- the track is the real track */
{
  const railPairs = new Set(
    NETWORK.legs.filter(l => l.mode === 'rail').map(l => `${l.from}|${l.to}`)
  )
  const matched = Object.keys(RAILS)

  check('rail legs carry real alignments', matched.length > 60,
    `${matched.length} of ${railPairs.size} pairs`)
  check('every alignment belongs to a rail leg that exists',
    matched.every(k => railPairs.has(k)),
    matched.filter(k => !railPairs.has(k)).join(' ') || 'all accounted for')
  check('and each is a polyline, not two points',
    matched.every(k => RAILS[k].length > 2))

  /* The honest half. Natural Earth's railway data predates the Laos–China
   * Railway, so we have no geometry for it — and a straight line saying "we
   * know the endpoints, not the route" is the right answer. If a future data
   * refresh ever fills these in, this flips, and it should be a deliberate
   * change rather than a surprise. */
  const lcr = ['kunming|mohan', 'mohan|boten', 'boten|nateuy', 'phonhong|vte_banthen']
  check('the Laos–China Railway is left straight, not invented',
    lcr.every(k => !RAILS[k]),
    lcr.filter(k => RAILS[k]).join(' ') || 'none faked')

  // A matched alignment must actually start and end at its two stations,
  // or the drawn line would float away from the markers it connects.
  const off = matched.filter(k => {
    const [a, b] = k.split('|').map(id => NETWORK.stations[id])
    const p = RAILS[k]
    const near = (pt, s) => Math.abs(pt[0] - s.lon) < 0.02 && Math.abs(pt[1] - s.lat) < 0.02
    return !(near(p[0], a) && near(p[p.length - 1], b))
  })
  check('every alignment is anchored to its own two stations', off.length === 0,
    off.slice(0, 3).join(' ') || 'all anchored')
}

/* ------------------------------------------------------- the wheel zooms */
{
  const { page, context } = await newPage()
  await page.goto(url)
  await page.waitForFunction(() => document.querySelector('#panel h1'))
  await page.locator('.corridor', { hasText: 'Bangkok → Singapore' }).click()
  await page.waitForFunction(() => document.querySelector('.route tbody tr'))
  await page.waitForTimeout(1100)

  const sig = () => page.evaluate(() => window.OverlandMap.viewSignature())
  const box = await page.locator('#map').boundingBox()
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  await page.mouse.move(cx, cy)

  // No modifier. The app fills the viewport and the document does not scroll,
  // so there is no page scroll for the map to steal.
  const before = await sig()
  await page.mouse.wheel(0, -300)
  await page.waitForTimeout(300)
  const zoomedIn = await sig()
  check('the wheel zooms in with nothing held', zoomedIn !== before, `${before} → ${zoomedIn}`)

  await page.mouse.wheel(0, 300)
  await page.waitForTimeout(300)
  check('and back out the other way', (await sig()) !== zoomedIn)

  check('there is no page scroll for it to have stolen',
    (await page.evaluate(
      () => document.documentElement.scrollHeight - window.innerHeight
    )) <= 0)

  // The buttons work without any gesture at all.
  const beforeBtn = await sig()
  await page.click('#zoomout')
  await page.waitForTimeout(300)
  check('the zoom buttons work on their own', (await sig()) !== beforeBtn)

  /* Every touch reaches the map, including the vertical ones the browser
     would otherwise scroll with. Not the map claiming the gesture — it is
     what lets app.js give the map the part of a drag it can use and pass the
     remainder to the page. The phone section below tests both halves. */
  check('the map is given the whole touch to divide up',
    (await page.evaluate(
      () => getComputedStyle(document.querySelector('#map')).touchAction
    )) === 'none')

  await page.screenshot({ path: join(outDir, '20-wheel-zoom.png') })
  await context.close()
}

/* ------------------------------------ the map holds still unless you mean it */
{
  const { page, context } = await newPage()
  await page.goto(url)
  await page.waitForFunction(() => document.querySelector('#panel h1'))
  await page.locator('.corridor', { hasText: 'Bangkok → Singapore' }).click()
  await page.waitForFunction(() => document.querySelector('.route tbody tr'))
  await page.waitForTimeout(1100)

  const sig = () => page.evaluate(() => window.OverlandMap.viewSignature())
  const box = await page.locator('#map').boundingBox()
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2

  // A click with a shaky hand. The wobble covers ground without going
  // anywhere, which is exactly what a path-length threshold would misread.
  const steady = await sig()
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  for (const [dx, dy] of [[2, 1], [3, -1], [1, 2], [4, 0], [2, 3], [5, 1]]) {
    await page.mouse.move(cx + dx, cy + dy)
  }
  await page.mouse.up()
  await page.waitForTimeout(200)
  check('a wobbly click does not nudge the map', (await sig()) === steady, steady)

  // A deliberate drag still pans.
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  for (let i = 1; i <= 10; i++) await page.mouse.move(cx + i * 12, cy + i * 6)
  await page.mouse.up()
  await page.waitForTimeout(200)
  check('a deliberate drag still pans', (await sig()) !== steady)

  // And no drag can throw the network off the screen.
  for (let r = 0; r < 8; r++) {
    await page.mouse.move(cx, cy)
    await page.mouse.down()
    for (let i = 1; i <= 12; i++) await page.mouse.move(cx + i * 70, cy + i * 45)
    await page.mouse.up()
  }
  await page.waitForTimeout(300)
  const reachable = await page.evaluate(() =>
    [[100.54, 13.8], [103.85, 1.29], [105.84, 21.02], [120.98, 14.6], [101.69, 3.14]]
      .filter(c => window.OverlandMap.locate(c[0], c[1])).length
  )
  check('the map cannot be dragged away and lost', reachable > 0, `${reachable}/5 cities on screen`)

  // The whole point of the threshold: picking a station must still work.
  await page.click('#reset')
  await page.waitForTimeout(700)
  const was = await page.inputValue('#from')
  const at = await page.evaluate(() => {
    const q = window.OverlandMap.locate(100.54, 13.8)
    const r = document.querySelector('#map').getBoundingClientRect()
    return q && { x: r.left + q.x, y: r.top + q.y }
  })
  await page.mouse.move(at.x, at.y)
  await page.mouse.down()
  await page.mouse.move(at.x + 3, at.y + 2)
  await page.mouse.up()
  await page.waitForTimeout(500)
  check('and a station still picks under a shaky click',
    (await page.inputValue('#from')) !== was)

  await context.close()
}

/* ----------------------------------------------------------- on a phone */

/* Everything above drives a mouse on a desktop-shaped window, which is how two
 * faults shipped that made the Android build barely usable: a dropdown that
 * could not be tapped, and a map that panned at three frames a second. Neither
 * is visible without a touch pointer and a phone-sized viewport. */
{
  const phone = {
    viewport: { width: 412, height: 915 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  }
  const { page, context } = await newPage(phone)
  await page.goto(url)
  await page.waitForFunction(() => document.querySelector('#panel h1'))
  await page.waitForTimeout(600)

  /* A finger, not a mouse. The list scrolls, so the browser withholds the
   * touch until it knows the gesture is not a scroll, and a tap with any
   * wobble in it is withdrawn before pointerdown is ever delivered — which is
   * every real tap. Selecting on pointerdown therefore worked under every
   * mouse and under no thumb. */
  await page.locator('#from-q').tap()
  await page.locator('#from-q').fill('bangkok')
  await page.waitForTimeout(250)
  const rows = await page.locator('#from-list li[data-i]').count()
  check('the station list opens under a thumb', rows > 0, `${rows} rows`)

  await page.locator('#from-list li[data-i]').first().tap()
  await page.waitForTimeout(250)
  const picked = await page.inputValue('#from')
  check('and a tap on a row actually chooses it', picked !== '', picked)

  /* The soft keyboard takes half the screen the moment the field is focused,
   * and the list drops out of an input that is now near the bottom of what is
   * left. Android shrinks the window for it, so a shorter viewport is what it
   * looks like from in here. */
  await page.locator('#to-q').tap()
  await page.setViewportSize({ width: 412, height: 440 })
  await page.waitForTimeout(300)
  await page.locator('#to-q').fill('singapore')
  await page.waitForTimeout(300)
  const fit = await page.evaluate(() => {
    const b = document.querySelector('#to-list').getBoundingClientRect()
    return { top: Math.round(b.top), bottom: Math.round(b.bottom), h: window.innerHeight }
  })
  check('the list stays on screen with the keyboard up',
    fit.top >= 0 && fit.bottom <= fit.h,
    `${fit.top}–${fit.bottom} of ${fit.h}`)

  const kbRows = await page.locator('#to-list li[data-i]').count()
  await page.locator('#to-list li[data-i]').first().tap()
  await page.waitForTimeout(250)
  check('and can still be tapped there', (await page.inputValue('#to')) !== '',
    `${kbRows} rows offered`)

  await page.setViewportSize(phone.viewport)
  await page.waitForTimeout(400)

  /* A frame budget, not a benchmark. The threshold is deliberately loose —
   * this ran at 365ms a frame before the basemap was cached and the sea was
   * baked, so anything near it means a per-frame rebuild has crept back in,
   * and no CI machine is slow enough to fail it otherwise. */
  const frame = await page.evaluate(async () => {
    const c = document.querySelector('#map')
    const b = c.getBoundingClientRect()
    const cx = b.left + b.width / 2
    const cy = b.top + b.height / 2
    const send = (t, x, y, id) => c.dispatchEvent(new PointerEvent(t, {
      pointerId: id, pointerType: 'touch', bubbles: true, cancelable: true,
      clientX: x, clientY: y,
    }))
    send('pointerdown', cx - 40, cy, 1)
    send('pointerdown', cx + 40, cy, 2)
    const gaps = []
    let last = performance.now()
    for (let i = 0; i < 30; i++) {
      const d = (i % 20) - 10
      send('pointermove', cx - 40 + d, cy + d * 0.5, 1)
      send('pointermove', cx + 40 + d, cy + d * 0.5, 2)
      await new Promise(r => requestAnimationFrame(r))
      const now = performance.now()
      gaps.push(now - last)
      last = now
    }
    send('pointerup', cx, cy, 1)
    send('pointerup', cx, cy, 2)
    const s = gaps.slice(5).sort((a, b) => a - b)
    return Math.round(s[Math.floor(s.length / 2)])
  })
  check('a two-finger pan keeps up with the finger', frame < 120, `${frame}ms a frame`)

  /* The sheet is what a hand is on while it reads directions, so it is the
     one that has to be perfect. It was 45ms a frame at four times throttle,
     because the drag moved the sheet by writing a CSS custom property — and
     changing a variable restyles everything that could inherit it, which here
     is the whole itinerary. Setting the transform on the element instead is a
     compositor operation and touches nothing else. */
  const dragFrame = await page.evaluate(async () => {
    const g = document.querySelector('#grip')
    const r = g.getBoundingClientRect()
    const x = r.left + r.width / 2
    const y0 = r.top + r.height / 2
    const ev = (t, y, target) => target.dispatchEvent(new PointerEvent(t, {
      pointerId: 4, pointerType: 'touch', bubbles: true, cancelable: true,
      clientX: x, clientY: y,
    }))
    ev('pointerdown', y0, g)
    const gaps = []
    let last = performance.now()
    for (let i = 0; i < 30; i++) {
      ev('pointermove', y0 - (i % 15) * 14, window)
      await new Promise(r => requestAnimationFrame(r))
      const now = performance.now()
      gaps.push(now - last)
      last = now
    }
    ev('pointerup', y0, window)
    const s = gaps.slice(4).sort((a, b) => a - b)
    return Math.round(s[Math.floor(s.length / 2)])
  })
  check('and the sheet tracks the thumb that drags it', dragFrame < 34,
    `${dragFrame}ms a frame`)

  /* Which is only true while the transform is set on the element. A variable
     put back here would pass the timing above on a fast machine and be 45ms on
     a phone, so the mechanism is asserted too. */
  const drivenBy = await page.evaluate(() => ({
    inline: /translateY/.test(document.querySelector('#sheet').style.transform || ''),
    variable: (document.querySelector('#sheet').style.getPropertyValue('--sheet-y') || '') !== '',
  }))
  check('because the transform is on the element, not in a variable',
    drivenBy.inline && !drivenBy.variable)

  await page.screenshot({ path: join(outDir, '21-phone.png') })
  await context.close()
}

/* ------------------------------------------ the map is big enough to read */
{
  /* How close you may get should be a real-world scale, not a multiple of how
   * far out you happened to start. Tied to the fitted view it was the latter,
   * and the phone — starting further out because its canvas is smaller — was
   * capped at a third of the desktop's closest approach. */
  const closest = {}
  for (const [name, opts] of [
    ['desktop', {}],
    ['phone', { viewport: { width: 412, height: 915 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }],
  ]) {
    const { page, context } = await newPage(opts)
    await page.goto(url)
    await page.waitForFunction(() => document.querySelector('#panel h1'))
    await page.waitForTimeout(400)
    for (let i = 0; i < 45; i++) await page.click('#zoomin')
    await page.waitForTimeout(400)
    closest[name] = Number((await page.evaluate(() =>
      window.OverlandMap.viewSignature())).split(',')[0])
    await context.close()
  }
  check('a phone can zoom in as far as a desktop',
    Math.abs(closest.phone - closest.desktop) < 1,
    `${(closest.phone / 111).toFixed(2)} vs ${(closest.desktop / 111).toFixed(2)} px/km`)
}

/* ------------------------------------------- the map is the page on a phone */

/* Not a letterbox with the route scrolling beneath it. The map holds the whole
 * screen and the itinerary rides over it on a sheet you drag — three positions,
 * because a glance at the next departure and reading the whole itinerary are
 * different jobs and one "open" cannot be both. */
{
  const { page, context } = await newPage({
    viewport: { width: 412, height: 915 }, deviceScaleFactor: 3,
    isMobile: true, hasTouch: true,
  })
  await page.goto(url)
  await page.waitForFunction(() => document.querySelector('#panel h1'))
  await page.locator('.corridor', { hasText: 'Bangkok → Singapore' }).click()
  await page.waitForFunction(() => document.querySelector('.route tbody tr'))
  await page.waitForTimeout(1400)

  const shape = () => page.evaluate(() => {
    const m = document.querySelector('#map').getBoundingClientRect()
    const s = document.querySelector('#sheet').getBoundingClientRect()
    return {
      map: [Math.round(m.width), Math.round(m.height)],
      snap: document.querySelector('#sheet').dataset.snap,
      sheetTop: Math.round(s.top),
      page: document.documentElement.scrollHeight - window.innerHeight,
    }
  })

  const opened = await shape()
  check('the map fills the screen from the start',
    opened.map[0] === 412 && opened.map[1] === 915, opened.map.join('x'))
  check('and there is no page behind it to scroll', opened.page <= 0)
  check('the sheet opens half way up', opened.snap === 'half',
    `top ${opened.sheetTop} of 915`)

  /* Dragging the handle moves it, and a release lands on the nearest of the
     three rather than wherever the finger stopped. */
  const dragGrip = to => page.evaluate(to => {
    const g = document.querySelector('#grip')
    const r = g.getBoundingClientRect()
    const x = r.left + r.width / 2
    const from = r.top + r.height / 2
    const ev = (t, y, target) => target.dispatchEvent(new PointerEvent(t, {
      pointerId: 1, pointerType: 'touch', bubbles: true, cancelable: true,
      clientX: x, clientY: y,
    }))
    ev('pointerdown', from, g)
    for (let i = 1; i <= 12; i++) ev('pointermove', from + ((to - from) * i) / 12, window)
    ev('pointerup', to, window)
  }, to)

  await dragGrip(40)
  await page.waitForTimeout(500)
  const up = await shape()
  check('dragging the handle up opens the itinerary', up.snap === 'full',
    `top ${up.sheetTop}`)
  check('and the map is still the full height behind it',
    up.map[1] === 915, up.map.join('x'))

  await dragGrip(890)
  await page.waitForTimeout(500)
  const down = await shape()
  check('dragging it down gets out of the way of the map', down.snap === 'peek',
    `top ${down.sheetTop} of 915`)

  /* The itinerary scrolls inside the sheet, and only when the sheet is fully
     up — below that a drag on the contents moves the sheet, which is what a
     hand reaching for it expects. */
  await dragGrip(40)
  await page.waitForTimeout(500)
  const scrolled = await page.evaluate(() => {
    const el = document.querySelector('#sheet-scroll')
    el.scrollTop = 400
    return el.scrollTop
  })
  check('the itinerary scrolls inside the sheet', scrolled > 0, `${scrolled}px`)

  /* Scrolling is not the same as being able to reach the end.
   *
   * The sheet is a full-height box slid down the screen, so at half its lower
   * 500px hang below the viewport — and the scroller inside it used to be that
   * whole height. It reported itself scrollable and scrolled quite happily, and
   * the last line of an itinerary still finished 455px under the bottom of the
   * screen, because the container considered itself done while a third of it
   * was off the glass. Scrolled fully down, the end of every route was
   * unreachable at anything but full.
   *
   * The invariant is the container, not the scrolling: no part of the scroller
   * may sit below the screen, at any height the sheet stops at. Tested that way
   * because scrolling it is no longer a way to find out — reading on raises the
   * sheet to full, so a test that scrolls measures full three times. */
  for (let i = 0; i < 3; i++) {
    const box = await page.evaluate(() => {
      const el = document.querySelector('#sheet-scroll')
      const r = el.getBoundingClientRect()
      return {
        snap: document.querySelector('#sheet').dataset.snap,
        bottom: Math.round(r.bottom),
        height: Math.round(r.height),
        viewport: window.innerHeight,
      }
    })
    check(`the scroller fits the screen at ${box.snap}`,
      box.bottom <= box.viewport + 2,
      `${box.height}px ending at ${box.bottom} of ${box.viewport}`)
    await page.evaluate(() => document.querySelector('#grip').click())
    await page.waitForTimeout(450)
  }

  /* --------------------------------------------------- reading the labels */

/* Place names on the map were unreadable on a phone, and the size was only
 * half of it. The word space in Barlow Condensed is 0.167em — two pixels at
 * twelve — and the halo behind the lettering was three and a half wide, so the
 * halo of one word's last letter reached the next word's first and "Phnom
 * Penh" arrived as one word. */
{
  const shrunk = await page.evaluate(() => {
    const c = document.createElement('canvas').getContext('2d')
    c.font = '500 12px BarlowCond, system-ui, sans-serif'
    return {
      space: +c.measureText(' ').width.toFixed(2),
      joined: c.measureText('PhnomPenh').width,
      spaced: c.measureText('Phnom Penh').width,
    }
  })
  check('the map opens its word spaces, which this face barely has',
    shrunk.spaced - shrunk.joined >= shrunk.space,
    `space is ${shrunk.space}px at 12px`)

  /* The light theme is written twice — once for the system preference and once
     for the attribute the toggle sets — and the app sets the attribute. A
     variable added to one and not the other is therefore invisible in every
     browser whose system already agrees, and wrong on every phone whose does
     not. --label-halo went in under the media query alone and map lettering
     came out with a black halo on pale land. The two must declare the same
     names; only the mechanism differs, never the palette. */
  {
    const css = readFileSync(join(root, 'src/app.css'), 'utf8')
    const declared = start => {
      let i = css.indexOf('{', css.indexOf(start)) + 1
      let depth = 1
      let j = i
      while (depth && j < css.length) {
        if (css[j] === '{') depth++
        else if (css[j] === '}') depth--
        j++
      }
      return new Set([...css.slice(i, j).matchAll(/(--[a-z0-9-]+)\s*:/g)].map(m => m[1]))
    }
    const viaMedia = declared('@media (prefers-color-scheme: light)')
    const viaAttr = declared(":root[data-theme='light']")
    const missing = [...viaMedia].filter(v => !viaAttr.has(v))
    const extra = [...viaAttr].filter(v => !viaMedia.has(v))
    check('both ways of asking for the light theme define the same palette',
      missing.length === 0 && extra.length === 0,
      [...missing.map(v => `${v} only under the media query`),
       ...extra.map(v => `${v} only on the attribute`)].join(', ') || 'identical')
  }

  /* And the invariant that failing test protects: whatever the system says,
     the halo has to be on the opposite side of the ink or it is not a halo. */
  {
    const lum = hex => {
      const h = hex.replace('#', '')
      const n = h.length === 3 ? [...h].map(c => c + c) : h.match(/../g)
      const [r, g, b] = n.map(v => parseInt(v, 16) / 255)
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    for (const theme of ['light', 'dark']) {
      const got = await page.evaluate(t => {
        document.documentElement.setAttribute('data-theme', t)
        const cs = getComputedStyle(document.documentElement)
        return {
          halo: cs.getPropertyValue('--label-halo').trim(),
          ink: cs.getPropertyValue('--ink').trim(),
          land: cs.getPropertyValue('--land').trim(),
        }
      }, theme)
      const contrasts =
        Math.abs(lum(got.halo) - lum(got.ink)) > 0.4 &&
        Math.abs(lum(got.halo) - lum(got.land)) < 0.35
      check(`the ${theme} halo lifts the lettering rather than smothering it`,
        contrasts, `halo ${got.halo}, ink ${got.ink}, land ${got.land}`)
    }
    await page.evaluate(() => document.documentElement.removeAttribute('data-theme'))
  }

  /* And a halo colour that suits both grounds. It was drawn in the sea colour
     over land as well as sea, which on the pale land of the light theme was a
     grey smear across the letters rather than a lift under them. */
  const halo = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement)
    return {
      halo: cs.getPropertyValue('--label-halo').trim(),
      sea: cs.getPropertyValue('--sea').trim(),
      land: cs.getPropertyValue('--land').trim(),
    }
  })
  check('and letters are haloed in their own colour, not the sea',
    !!halo.halo && halo.halo !== halo.sea && halo.halo !== halo.land,
    `${halo.halo} against sea ${halo.sea} and land ${halo.land}`)
}

/* ------------------------------------------------ the palette does a job */

/* The map draws rail amber, sea teal and road grey. The itinerary drew all
 * three in the same grey with a seven-pixel dot to tell them apart, which is
 * why the interface read as colourless: the colour existed and meant something
 * and was almost nowhere. A leg now carries its mode down its edge, in the
 * colour the same journey is drawn in above it. */
{
  const modes = await page.evaluate(() => {
    const seen = {}
    for (const tr of document.querySelectorAll('tr.leg')) {
      const mode = tr.dataset.mode
      const cell = tr.querySelector('td.num')
      if (!mode || !cell) continue
      seen[mode] = getComputedStyle(cell).borderLeftColor
    }
    const cs = getComputedStyle(document.documentElement)
    return { seen, count: Object.keys(seen).length,
             edge: cs.getPropertyValue('--panel-edge').trim() }
  })
  check('every leg carries its mode as colour, not just a dot',
    modes.count > 0 && Object.values(modes.seen).every(c => c && c !== 'rgba(0, 0, 0, 0)'),
    Object.entries(modes.seen).map(([m, c]) => `${m}=${c}`).join('  '))

  /* The four numbers a reader came for. The cost takes the accent and the
     per-mode times take their mode's colour, which is only worth doing if it
     is keyed to meaning rather than to position — it used to be :last-child,
     and the last tile stops being the cost the moment a route has road hours. */
  const tiles = await page.evaluate(() => {
    const q = c => document.querySelector(c)
    const colourOf = el => (el ? getComputedStyle(el.querySelector('b')).color : null)
    return {
      cost: colourOf(q('.stat.is-cost')),
      rail: colourOf(q('.stat.is-rail')),
      plain: colourOf(q('.stat:not([class*=" is-"]):not(.is-cost)')),
      label: q('.stat.is-cost') ? q('.stat.is-cost').querySelector('span').textContent : '',
    }
  })
  check('and the accent lands on the cost, by name not by position',
    tiles.cost && tiles.cost !== tiles.plain && /all in/i.test(tiles.label),
    `${tiles.label} is ${tiles.cost}, the plain ones are ${tiles.plain}`)
}

/* ---------------------------------------- a real thumb on the itinerary */

  /* Synthetic pointer events are not a scroll.
   *
   * Every check above dispatches PointerEvents, and a page can answer those
   * perfectly while being completely immovable under a finger — scrolling is
   * decided in the compositor, from touch input, before any of them are seen.
   * A recording of the app showed the itinerary frozen while all of these
   * passed. This one drives the browser's own touch pipeline through CDP,
   * which is the only thing here that scrolls anything.
   *
   * What it caught: .panel carries overflow-y: auto, because on a wide screen
   * it is the right-hand column and scrolls itself. Inside the sheet that made
   * a scroller nested in a scroller, with nothing to scroll — its height is its
   * content — and Chromium still aimed the gesture at it. Touches on the search
   * controls above scrolled the sheet; every touch on the itinerary was
   * swallowed by a container that could not move. */
  {
    const cdp = await context.newCDPSession(page)
    const swipe = async y => {
      const T = (type, at) =>
        cdp.send('Input.dispatchTouchEvent', {
          type,
          touchPoints: type === 'touchEnd' ? [] : [{ x: 206, y: at }],
        })
      await T('touchStart', y)
      for (let i = 1; i <= 12; i++) await T('touchMove', y - i * 18)
      await T('touchEnd', y - 216)
      await page.waitForTimeout(600)
      return page.evaluate(() => document.querySelector('#sheet-scroll').scrollTop)
    }

    for (const want of ['full', 'half']) {
      for (let i = 0; i < 4; i++) {
        if ((await page.evaluate(() => document.querySelector('#sheet').dataset.snap)) === want) break
        await page.evaluate(() => document.querySelector('#grip').click())
        await page.waitForTimeout(400)
      }
      await page.evaluate(() => { document.querySelector('#sheet-scroll').scrollTop = 0 })
      const box = await page.evaluate(() => {
        const r = document.querySelector('#sheet-scroll').getBoundingClientRect()
        return { top: r.top, h: r.height }
      })
      // Inside the screen, not merely inside the element — the scroller can
      // reach past the bottom of the viewport and a touch there hits nothing.
      const y = Math.round(Math.min(box.top + box.h * 0.5, 915 - 140))
      const moved = await swipe(y)
      check(`a real touch scrolls the itinerary at ${want}`, moved > 40,
        `moved ${moved}px from a touch at y=${y}`)
    }

  }

  /* ------------------------------------------------- with the keyboard up */

  /* A recording of the app showed the itinerary frozen: a route planned, the
   * keyboard still covering half the screen, and nothing moving however much it
   * was swiped. Three faults compounded, and all three are checked here. */
  {
    await page.setViewportSize({ width: 412, height: 915 })
    await page.waitForTimeout(400)
    await page.locator('#from-q').tap()
    await page.locator('#from-q').fill('luang prabang')
    await page.waitForTimeout(250)
    await page.locator('#from-list li[data-i]').first().tap()
    await page.waitForTimeout(250)

    /* The keyboard has to go when a station is chosen. The field is kept
       focused through the tap on purpose, so nothing releases it otherwise —
       and it was sitting over the answer to what had just been typed. */
    check('choosing a station lets the keyboard go',
      (await page.evaluate(() => document.activeElement && document.activeElement.id)) !== 'from-q')

    await page.locator('#to-q').tap()
    await page.setViewportSize({ width: 412, height: 440 }) // the keyboard
    await page.waitForTimeout(400)
    await page.locator('#to-q').fill('muang nga')
    await page.waitForTimeout(250)
    await page.locator('#to-list li[data-i]').first().tap()
    await page.waitForFunction(() => document.querySelector('.route tbody tr'))
    await page.waitForTimeout(900)

    /* The sheet is placed and sized against the window height, and the keyboard
       changes it. Placed for a tall screen and sized for a short one, the
       bottom of the scroller ended up below the glass again. */
    const fit = await page.evaluate(() => {
      const r = document.querySelector('#sheet-scroll').getBoundingClientRect()
      return { bottom: Math.round(r.bottom), viewport: window.innerHeight }
    })
    check('and the sheet re-fits the screen the keyboard left',
      fit.bottom <= fit.viewport + 2, `ends at ${fit.bottom} of ${fit.viewport}`)

    /* The freeze itself. Every press on the contents resized the scroller, so
       that a press which became a drag had room to move into — but a press is
       usually the start of a scroll, and resizing a scroll container as the
       touch lands makes the browser abandon it. The list never moved, scrollTop
       stayed at zero, and the next swipe was abandoned the same way. */
    await page.setViewportSize({ width: 412, height: 915 })
    await page.waitForTimeout(400)
    // From half, where the sheet is short: a press that opened it to full
    // height would change the number, which at full it would not.
    for (let i = 0; i < 4; i++) {
      if ((await page.evaluate(() => document.querySelector('#sheet').dataset.snap)) === 'half') break
      await page.evaluate(() => document.querySelector('#grip').click())
      await page.waitForTimeout(400)
    }
    check('the sheet can be put back to half', (await page.evaluate(
      () => document.querySelector('#sheet').dataset.snap)) === 'half')

    const onPress = await page.evaluate(() => {
      const el = document.querySelector('#sheet-scroll')
      el.scrollTop = 0
      const before = el.style.maxHeight
      el.dispatchEvent(new PointerEvent('pointerdown', {
        pointerId: 11, pointerType: 'touch', bubbles: true, cancelable: true,
        clientX: 200, clientY: el.getBoundingClientRect().top + 60,
      }))
      const after = el.style.maxHeight
      window.dispatchEvent(new PointerEvent('pointerup', {
        pointerId: 11, pointerType: 'touch', bubbles: true, cancelable: true,
      }))
      return { before, after }
    })
    check('and a touch on the itinerary does not resize it out from under itself',
      onPress.before === onPress.after, `${onPress.before} became ${onPress.after}`)
  }

  /* One finger moves the map, both ways. Nothing scrolls behind it to be
     protected, which is what the split axes were working around. */
  const sig = () => page.evaluate(() => window.OverlandMap.viewSignature())
  await dragGrip(890)
  await page.waitForTimeout(500)
  const swipe = (dx, dy) => page.evaluate(([dx, dy]) => {
    const c = document.querySelector('#map')
    const r = c.getBoundingClientRect()
    const send = (t, x, y) => c.dispatchEvent(new PointerEvent(t, {
      pointerId: 1, pointerType: 'touch', bubbles: true, cancelable: true,
      clientX: r.left + x, clientY: r.top + y,
    }))
    send('pointerdown', 200, 300)
    for (let i = 1; i <= 15; i++) send('pointermove', 200 + (dx * i) / 15, 300 + (dy * i) / 15)
    send('pointerup', 200 + dx, 300 + dy)
  }, [dx, dy])

  const before = await sig()
  await swipe(120, 0)
  await page.waitForTimeout(300)
  check('one finger moves the map left and right', (await sig()) !== before)

  /* The station popup, tapped rather than clicked.
   *
   * Everything about this worked with a mouse and nothing about it worked with
   * a finger: a touch pointer ceases to exist at pointerup, so pointerleave
   * arrives before the click, and dismissing the popup there removed the
   * button from the layout in the gap between the two. The click was never
   * dispatched. Both the routing buttons and the Google Maps links did
   * nothing, silently, on every tap. */
  {
    /* Whichever station is currently somewhere a thumb can actually reach —
       the checks above have panned and zoomed, and hard-coding a city means
       tapping open sea and blaming the popup. Below the legend, above the
       sheet, clear of both edges. */
    // Coordinates come from the data file: the page keeps the network inside a
    // closure and exposes only the map.
    const at = await page.evaluate(points => {
      const r = document.querySelector('#map').getBoundingClientRect()
      const sheetTop = document.querySelector('#sheet').getBoundingClientRect().top
      const legend = document.querySelector('.mapfoot')
      const legendBottom = legend ? legend.getBoundingClientRect().bottom : 0
      for (const [id, lon, lat] of points) {
        const pt = window.OverlandMap.locate(lon, lat)
        if (!pt) continue
        const x = r.left + pt.x
        const y = r.top + pt.y
        if (x > 60 && x < r.right - 60 && y > legendBottom + 30 && y < sheetTop - 40) {
          return { x, y, id }
        }
      }
      return null
    }, Object.entries(NETWORK.stations).map(([id, st]) => [id, st.lon, st.lat]))
    if (!at) {
      check('a tapped station offers the popup', false, 'no station in reach')
    } else {
      await page.touchscreen.tap(at.x, at.y)
      await page.waitForTimeout(350)
      const btn = await page.evaluate(() => {
        const b = document.querySelector('#tip .tip-go')
        if (!b || document.querySelector('#tip').hidden) return null
        const r = b.getBoundingClientRect()
        return { x: r.x + r.width / 2, y: r.y + r.height / 2, label: b.textContent.trim() }
      })
      check('a tapped station offers the popup', !!btn, btn ? btn.label : 'no popup')
      if (btn) {
        await page.touchscreen.tap(btn.x, btn.y)
        await page.waitForTimeout(500)
        const chosen = await page.evaluate(() => document.querySelector('#from').value)
        check('and tapping its button actually routes from there', !!chosen,
          chosen || 'nothing happened')
      }
    }
  }

  const afterX = await sig()
  await swipe(0, 120)
  await page.waitForTimeout(300)
  check('and up and down as well', (await sig()) !== afterX)

  await page.screenshot({ path: join(outDir, '22-sheet.png') })
  await context.close()
}

/* ------------------------------------------------- what the page weighs */

/* The landing page is the whole audience's first impression and most of them
 * are on a phone on a Southeast Asian mobile network. It went out at 5276 KB:
 * 3970 KB of photographs base64'd into the HTML, and nine more fetched at 960
 * pixels wide to be displayed at 402. Both are the sort of thing that comes
 * back quietly, so both are measured here. */
{
  const html = readFileSync(join(root, 'index.html'), 'utf8')
  const inlined = [...html.matchAll(/data:image\/[a-z+]+;base64,/g)].length
  check('no photographs are base64d into the page', inlined === 0,
    `${inlined} found`)

  const kb = Math.round(statSync(join(root, 'index.html')).size / 1024)
  check('and the document stays small', kb < 300, `${kb} KB`)

  /* The program is beside the page rather than inside it. Inline, it was 758
     KB the parser had to finish before the document was done, and it came down
     again on every visit because HTML cannot be cached like a static file.
     Deferred: FCP 156ms to 112ms, DOM interactive 812ms to 333ms, and a repeat
     visit gets a 304 with no body. */
  check('the program is deferred rather than parsed inline',
    /<script defer src="app\.js"><\/script>/.test(html) && !/<script>\n\(function\(\)/.test(html))
  check('and it is actually there to load',
    existsSync(join(root, 'app.js')) &&
      statSync(join(root, 'app.js')).size > 100000)

  /* Vercel copies both. Losing app.js from the build command would deploy a
     page that renders nothing at all, and nothing here would otherwise say so. */
  const vercel = readFileSync(join(root, 'vercel.json'), 'utf8')
  check('and the deploy carries it', /cp index\.html app\.js public\//.test(vercel))

  const { page, context } = await newPage({ viewport: { width: 412, height: 915 } })
  let bytes = 0
  let images = 0
  page.on('response', async r => {
    try {
      bytes += (await r.body()).length
      if (/\.(jpe?g|png|webp)(\?|$)/i.test(r.url())) images++
    } catch {
      /* a response with no retrievable body is not part of the weight */
    }
  })
  await page.goto(url)
  await page.waitForFunction(() => document.querySelector('#panel h1'))
  await page.waitForTimeout(2000)

  /* Nine corridor cards, drawn rather than photographed. They are the first
     thing on the page, before the reader has asked for anything. */
  check('nothing is fetched to decorate the landing page', images === 0,
    `${images} images`)
  check('the cards are drawn instead',
    (await page.locator('.corridor canvas').count()) === 9)
  check('so the first visit costs well under what it did',
    bytes / 1024 < 1200, `${Math.round(bytes / 1024)} KB, was 5276`)

  /* The photography is not gone — it arrives on a route you asked for. */
  await page.locator('.corridor', { hasText: 'Bangkok → Singapore' }).click()
  await page.waitForFunction(() => document.querySelector('.route tbody tr'))
  await page.waitForTimeout(1800)
  check('a route you planned still gets its photograph',
    (await page.locator('#panel img.photo').count()) > 0 && images === 1,
    `${images} image fetched`)

  await context.close()
}

/* --------------------------------------------------- the Android build */

/* A second artefact that can drift from the site without anyone noticing,
 * because nobody opens it in a browser. Built by tools/build-android.mjs from
 * the same sources with APP=1; what follows is the whole of what should
 * differ. */
{
  const appFile = join(root, 'dist/app.html')
  if (!existsSync(appFile)) {
    check('the app build exists', false, 'run tools/build-android.mjs')
  } else {
    const { page, context } = await newPage({
      viewport: { width: 412, height: 915 },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
      colorScheme: 'dark', // the system says dark; the app should not care
    })
    await page.goto('file://' + appFile)

    /* The launch screen, checked before anything else because it is only on
       the screen for a moment and everything below waits longer than that.
       It has to cover — a splash you can see the boot happening through is
       worse than none — and it has to be gone, which is the half of it that
       can actually break: it is drawn by CSS whatever happens, and removed
       only if the program got far enough to remove it. */
    const splash = await page.evaluate(() => {
      const i = document.getElementById('intro')
      if (!i) return null
      const r = i.getBoundingClientRect()
      const s = getComputedStyle(i)
      return {
        covers: r.width >= innerWidth && r.height >= innerHeight,
        opaque: s.opacity === '1' && /gradient/.test(s.backgroundImage),
        above: Number(s.zIndex) > 40, // the topbar, which it has to cover
        mark: !!document.querySelector('.intro-rail'),
      }
    })
    check('the app opens on a launch screen', splash && splash.covers && splash.opaque &&
      splash.above && splash.mark, JSON.stringify(splash))

    const cleared = await page
      .waitForFunction(() => !document.getElementById('intro'), null, { timeout: 8000 })
      .then(() => true, () => false)
    check('and takes it away by itself', cleared)

    await page.waitForFunction(() => document.querySelector('#panel h1'))
    await page.waitForTimeout(700)

    /* Removed, not left transparent over the map: an invisible full-screen
       layer still swallows every touch on the thing underneath it. */
    check('leaving the map on top where it belongs',
      (await page.evaluate(() =>
        document.elementFromPoint(innerWidth / 2, innerHeight / 3)?.id)) === 'map')

    /* The program is a separate file here too, and a missing subresource is
       the app's quietest possible failure: WebView reports nothing for one, so
       it would open, draw the shell and sit there. */
    check('the app loads its program as a deferred file',
      existsSync(join(root, 'dist/app.js')) &&
        statSync(join(root, 'dist/app.js')).size > 500_000 &&
        /<script defer src="app\.js"><\/script>/.test(readFileSync(appFile, 'utf8')))
    check('and it actually ran', (await page.evaluate(() => !!window.OverlandMap)))

    /* Opens light whatever the system says. The website still follows it —
       checked by every other block in this file, which runs in dark. */
    check('the app opens in day mode',
      (await page.evaluate(() => document.documentElement.getAttribute('data-theme'))) === 'light')

    /* Play wants the policy on the listing; a reader wants it in the app.
       Absolute, because inside the package a root-relative link resolves
       against the internal asset host and lands on nothing. */
    const policy = await page.evaluate(() =>
      [...document.querySelectorAll('#panel a')]
        .map(a => a.getAttribute('href'))
        .filter(h => /privacy/.test(h)))
    check('the app links out to the privacy policy',
      policy.length === 1 && policy[0] === 'https://slowasia.com/privacy', policy.join(' '))

    /* The written-up routes are separate pages on the site. Inside one file
       every one of those links is a dead end, so they are not offered. */
    const deadEnds = await page.evaluate(() =>
      [...document.querySelectorAll('.block-web')]
        .filter(e => getComputedStyle(e).display !== 'none').length)
    check('and leaves out the links to pages it does not carry', deadEnds === 0)

    // 22 MB of photographs, against a page that is 0.9 MB without them.
    const size = Math.round(statSync(appFile).size / 1024)
    check('the app page is a fraction of the website\'s', size < 1600, `${size} KB`)
    check('because it carries no photographs',
      (await page.evaluate(() => document.querySelectorAll('#panel img').length)) === 0)

    // And still answers, with the drawn art the page already falls back to.
    await page.locator('.corridor', { hasText: 'Bangkok → Singapore' }).click()
    await page.waitForFunction(() => document.querySelector('.route tbody tr'))
    await page.waitForTimeout(1200)
    const legs = await page.locator('.route tbody tr').count()
    check('and routes exactly as the website does', legs > 0, `${legs} rows`)
    check('with drawn art where a photograph would have been',
      (await page.locator('#panel canvas').count()) > 0)

    /* The itinerary has to scroll at every sheet height. Locking it below full
       made a route at half a picture of a route: the sheet held the press and
       would not move, and the list could not scroll either. */
    const gestures = await page.evaluate(() => {
      const el = document.querySelector('#sheet-scroll')
      const r = el.getBoundingClientRect()
      const x = r.left + r.width / 2
      const y0 = r.top + 120
      const fire = (t, y, target) => {
        const ev = new PointerEvent(t, {
          pointerId: 1, pointerType: 'touch', bubbles: true,
          cancelable: true, clientX: x, clientY: y,
        })
        target.dispatchEvent(ev)
        return ev.defaultPrevented
      }
      fire('pointerdown', y0, el)
      const up = [1, 2, 3, 4, 5, 6].map(i => fire('pointermove', y0 - i * 20, window))
      fire('pointerup', y0 - 120, window)
      fire('pointerdown', y0, el)
      const down = [1, 2, 3, 4, 5, 6].map(i => fire('pointermove', y0 + i * 20, window))
      fire('pointerup', y0 + 120, window)
      return {
        snap: document.querySelector('#sheet').dataset.snap,
        overflow: getComputedStyle(el).overflowY,
        upSwallowed: up.some(Boolean),
        downTaken: down.some(Boolean),
      }
    })
    check('the itinerary scrolls at half height', gestures.overflow === 'auto',
      `snap=${gestures.snap}`)
    check('and reading up it is not swallowed by the sheet', !gestures.upSwallowed)
    check('while pulling down from the top still lowers it', gestures.downTaken)

    await page.screenshot({ path: join(outDir, '23-app.png') })
    await context.close()
  }
}

/* ------------------------------------------------- the privacy policy */

/* A privacy policy is a set of claims about the code, and the code is what
 * changes. Everything the page asserts that can be checked is checked here,
 * so adding a permission, an SDK, an analytics tag or a third storage key
 * fails the build instead of quietly turning the page into a false statement.
 * That is the whole reason the page was written in checkable terms. */
{
  const file = join(root, 'public/privacy.html')
  if (!existsSync(file)) {
    check('the privacy policy is built', false, 'run tools/build-pages.mjs')
  } else {
    const html = readFileSync(file, 'utf8')
    const manifest = readFileSync(join(root, 'android/app/src/main/AndroidManifest.xml'), 'utf8')
    const gradle = readFileSync(join(root, 'android/app/build.gradle.kts'), 'utf8')

    /* The load-bearing claim. Everything else on the page is a promise about
       conduct; this one is enforced by the operating system, and it is only
       true while the line is absent from the manifest. */
    check('the app still has no internet permission, as the policy says',
      !/android\.permission\.INTERNET/.test(manifest))
    check('and the policy still says it',
      /android\.permission\.INTERNET/.test(html) && /no internet permission/i.test(html))

    /* "There is no third-party SDK in the build." Everything declared has to
       be Google's own or the language's. */
    const deps = [...gradle.matchAll(/implementation\((?:platform\()?"([^"]+)"/g)].map(m => m[1])
    const ours = deps.filter(d => !/^(androidx\.|com\.google\.android\.|org\.jetbrains\.kotlin)/.test(d))
    check('no third-party SDK has appeared in the app', ours.length === 0,
      deps.length ? deps.join(', ') : 'none declared')

    /* The policy enumerates what is kept on the device, so anything stored
       that it does not name makes a published legal document wrong.
       
       Every source, not just src/app.js. The earlier version read that one
       file, so the key the app-install strip writes — which lives in
       src/appbanner.html — was invisible to it, and the policy said "two
       settings" for three commits while the site stored three. A check that
       reads one of the places a thing can happen is a check that reports the
       absence of evidence. */
    const keys = [...new Set(
      readdirSync(join(root, 'src'))
        .map(f => readFileSync(join(root, 'src', f), 'utf8'))
        .flatMap(text => [...text.matchAll(/'(overlandsea:[a-z-]+)'/g)].map(m => m[1]))
    )].sort()
    const named = 'overlandsea:app overlandsea:folded overlandsea:theme overlandsea:trip'
    check('the app stores only what the privacy policy names', keys.join(' ') === named,
      keys.join(' ') || 'none')

    /* And the policy has to describe each of them. Naming the count was what
       let this drift: "two settings" stays true-looking while the list under
       it grows. */
    const policy = readFileSync(join(root, 'public/privacy.html'), 'utf8')
    for (const [key, said] of [
      ['theme', /light or dark theme/],
      ['fold', /search panel folded/],
      ['trip', /journey you last planned/],
      ['app strip', /dismissed the strip/],
    ]) {
      check(`and the policy says what it keeps — ${key}`, said.test(policy))
    }
    check('and no longer claims a count it would have to keep correcting',
      !/two settings/.test(policy))

    /* "No analytics, no tag manager, no advertising pixel." The deployed page
       loads one script, its own, and that is asserted elsewhere — here it is
       the absence of the usual names, in every built artefact. */
    const anywhere = ['index.html', 'app.js', 'dist/app.html']
      .filter(p => existsSync(join(root, p)))
      .map(p => readFileSync(join(root, p), 'utf8'))
      .join('\n')
    const trackers = ['googletagmanager', 'google-analytics', 'gtag(', 'connect.facebook',
      'plausible.io', 'segment.com', 'sentry.io', 'hotjar']
      .filter(t => anywhere.includes(t))
    check('nothing that measures readers has been added', trackers.length === 0,
      trackers.join(', '))

    const { page, context } = await newPage({ viewport: { width: 900, height: 1200 } })
    await page.goto('file://' + file)

    // "The site sets no cookies of any kind."
    check('the site sets no cookies',
      (await page.evaluate(() => document.cookie)) === '' &&
        (await context.cookies()).length === 0)

    check('the policy is a readable document, not a wall',
      (await page.locator('.docwrap h2').count()) >= 8,
      `${await page.locator('.docwrap h2').count()} sections`)
    check('and it is reachable from the foot of every page',
      (await page.locator('.docfoot a[href="/privacy"]').count()) === 1)
    check('with a working way to ask about it',
      (await page.locator('a[href^="mailto:"]').count()) >= 1)
    // Long permission strings on a narrow screen are the obvious way for this
    // page to break, and it is the one page nobody will look at again.
    await page.setViewportSize({ width: 360, height: 780 })
    check('the policy fits a narrow phone',
      (await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0)

    await page.screenshot({ path: join(outDir, '24-privacy.png') })
    await context.close()
  }
}

/* ------------------------------------------------------------ the site */

/* The published pages, as a set rather than one at a time.
 *
 * These are generated — a guide added to data/guides.js becomes a page, a
 * crossing in the network becomes a page, and both get linked from the other.
 * The failures that costs you are structural and silent: a link to a page the
 * generator did not emit, a page nothing points at, a page missing from the
 * sitemap. None of them show up when you open one page and look at it. */
{
  const dir = join(root, 'public')
  if (!existsSync(join(dir, 'sitemap.xml'))) {
    check('the site is built', false, 'run tools/build-pages.mjs')
  } else {
    const files = readdirSync(dir).filter(f => f.endsWith('.html'))
    const slugs = new Set(files.map(f => f.replace(/\.html$/, '')))
    const html = Object.fromEntries(
      files.map(f => [f.replace(/\.html$/, ''), readFileSync(join(dir, f), 'utf8')])
    )

    const crossings = [...slugs].filter(s => s.endsWith('-border-crossing'))
    const withLegs = Object.keys(NETWORK.borders)
      .filter(id => NETWORK.borders[id].trap && NETWORK.legs.some(l => l.border === id))
    check('every crossing worth a page has one',
      crossings.length === withLegs.length, `${crossings.length} of ${withLegs.length}`)

    /* An internal link to a page that was never emitted is the generator's
       characteristic failure: the list it was built from and the list that
       was written come from different places. */
    const broken = []
    for (const [slug, body] of Object.entries(html)) {
      for (const m of body.matchAll(/href="\/([a-z0-9-]*)"/g)) {
        if (m[1] !== '' && !slugs.has(m[1])) broken.push(`${slug} -> /${m[1]}`)
      }
    }
    check('no page links to one that does not exist', broken.length === 0,
      broken.slice(0, 3).join('; '))

    /* And nothing is published that cannot be reached. An orphan page is one
       Google finds in the sitemap, crawls, and reasonably concludes the site
       does not care about. */
    const linked = new Set()
    for (const body of Object.values(html)) {
      for (const m of body.matchAll(/href="\/([a-z0-9-]+)"/g)) linked.add(m[1])
    }
    const orphans = [...slugs].filter(s => !linked.has(s))
    check('no page is orphaned', orphans.length === 0, orphans.join(', '))

    // Every crossing page must be reachable from the journeys that use it,
    // not only from its siblings — that is the link that carries any weight.
    const fromRoutes = crossings.filter(c =>
      Object.entries(html).some(([slug, body]) =>
        !slug.endsWith('-border-crossing') && slug !== 'privacy' &&
        body.includes(`href="/${c}"`)))
    /* A crossing page earns its place by being the detail behind a journey
       somebody can actually take, and that link is the only one pointing at it
       that carries any topical weight. One unused frontier is tolerable — the
       page says so plainly rather than pretending — but a drift towards a set
       of pages that only cite each other is exactly the shape of a link farm,
       so the slack is one. */
    check('and crossings are linked from the routes that use them',
      fromRoutes.length >= crossings.length - 1,
      `${fromRoutes.length} of ${crossings.length}`)

    const sitemap = readFileSync(join(dir, 'sitemap.xml'), 'utf8')
    const listed = new Set(
      [...sitemap.matchAll(/<loc>[^<]*?\/([a-z0-9-]*)<\/loc>/g)].map(m => m[1])
    )
    const unlisted = [...slugs].filter(s => !listed.has(s))
    check('the sitemap lists every page that was built', unlisted.length === 0,
      unlisted.join(', '))
    const ghosts = [...listed].filter(s => s !== '' && !slugs.has(s))
    check('and lists nothing that was not', ghosts.length === 0, ghosts.join(', '))

    /* Thin pages are the real risk with a generator: it will happily emit a
       hundred of them. Word counts are crude, but a page that drops under
       this is one nobody wrote enough for. */
    const thin = Object.entries(html)
      .map(([slug, body]) => [slug, body.split('<main')[1]
        .replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().split(' ').length])
      .filter(([, words]) => words < 400)
    check('no page is thin', thin.length === 0,
      thin.map(([s, w]) => `${s}: ${w}w`).join(', '))

    // Duplicate titles and descriptions are how a generated set gets treated
    // as one page repeated.
    const titles = Object.values(html).map(b => (b.match(/<title>([^<]*)<\/title>/) || [])[1])
    check('every page has its own title',
      new Set(titles).size === titles.length, `${new Set(titles).size} of ${titles.length}`)
    const descs = Object.values(html)
      .map(b => (b.match(/<meta name="description" content="([^"]*)"/) || [])[1])
    check('and its own description',
      new Set(descs).size === descs.length, `${new Set(descs).size} of ${descs.length}`)
  }
}

/* ----------------------------------------------------------- the iOS app */

/* Nothing here compiles a line of Swift.
 *
 * Xcode only exists on macOS and this does not run there, so the iOS build is
 * checked by CI and not by this file — which means everything that CAN be
 * checked from here should be, because the alternative is finding it out on a
 * macOS runner ten minutes at a time. What is checkable is the shape: that the
 * project spec, the plist, the sources and the icon agree with each other and
 * with the claims the privacy policy makes on the app's behalf. */
{
  const has = p => existsSync(join(root, p))
  const src = p => (has(p) ? readFileSync(join(root, p), 'utf8') : '')

  check('the iOS project exists',
    has('ios/project.yml') && has('ios/Overland/Info.plist') &&
      has('ios/Overland/Sources/PlannerViewController.swift'))

  const plist = src('ios/Overland/Info.plist')
  const project = src('ios/project.yml')
  const bundleId = (project.match(/PRODUCT_BUNDLE_IDENTIFIER:\s*(\S+)/) || [])[1]

  /* The workflow names the bundle id in its export options, and a build signed
     for one identifier and exported for another fails late, on a macOS runner,
     with a message about provisioning that does not mention either. */
  const workflow = src('.github/workflows/ios.yml')
  check('the workflow exports the identifier the project builds',
    !!bundleId && workflow.includes(bundleId), bundleId)

  /* Both stores reject a repeated build number, so both are derived from the
     same clock. If these ever stop matching, one of the two apps starts
     failing at upload for a reason that looks like nothing. */
  const androidTicks = src('tools/build-android.mjs').match(/Date\.now\(\) - EPOCH\) \/ (\d+)/)
  const iosTicks = src('tools/build-ios.mjs').match(/Date\.now\(\) - EPOCH\) \/ (\d+)/)
  check('both stores get build numbers from the same clock',
    androidTicks && iosTicks && androidTicks[1] === iosTicks[1],
    `${androidTicks?.[1]} vs ${iosTicks?.[1]}`)

  /* The plist reads these by name from the xcconfig that build-ios.mjs writes.
     Hard-code either and the version silently stops moving. */
  check('the version is stamped rather than written in',
    /\$\(MARKETING_VERSION\)/.test(plist) && /\$\(CURRENT_PROJECT_VERSION\)/.test(plist))

  /* Every one of these is a way to ask for something the privacy policy says
     the app does not do. A usage description appearing here without a matching
     change to that page means one of the two is lying. */
  const asks = ['NSLocationWhenInUseUsageDescription', 'NSCameraUsageDescription',
    'NSContactsUsageDescription', 'NSPhotoLibraryUsageDescription',
    'NSMicrophoneUsageDescription', 'NSUserTrackingUsageDescription']
    .filter(k => plist.includes(k))
  check('the iOS app asks for no permissions, as the policy says', asks.length === 0,
    asks.join(', '))

  /* Play refuses an update whose target is more than a year behind the newest
     Android, and moves the line every year. The number lives in the gradle
     file and nothing else reads it, so it goes stale in silence and announces
     itself as a rejected upload months later. */
  const gradleApp = src('android/app/build.gradle.kts')
  const target = Number((gradleApp.match(/targetSdk = (\d+)/) || [])[1])
  const compile = Number((gradleApp.match(/compileSdk = (\d+)/) || [])[1])
  check('the Android target is one Play still accepts', target >= 36, `targetSdk ${target}`)
  check('and it is compiled against at least what it targets',
    compile >= target, `compileSdk ${compile}`)

  /* From targetSdk 35 the platform ignores the bar colours, and from 36 there
     is no opting out of edge-to-edge — so a build that sets them and handles
     no insets draws its own top bar underneath the clock. */
  const activity = src('android/app/src/main/java/com/slowasia/overland/MainActivity.java')
  check('and it insets itself for the bars it now draws under',
    /setOnApplyWindowInsetsListener/.test(activity) &&
      /setDecorFitsSystemWindows/.test(activity))
  const themes = src('android/app/src/main/res/values/themes.xml') +
    src('android/app/src/main/res/values-night/themes.xml')
  check('without setting bar colours the platform stopped reading',
    !/statusBarColor|navigationBarColor/.test(themes))

  /* The claim the policy actually makes for iOS. Android's is enforced by the
     kernel and this one is not, so the code that enforces it has to be there
     for the sentence to be true. */
  const vc = src('ios/Overland/Sources/PlannerViewController.swift')
  check('and blocks every remote load in the web view',
    /compileContentRuleList/.test(vc) && /"type":\s*"block"/.test(vc))
  check('and hands outside links to Safari rather than opening them inside',
    /UIApplication\.shared\.open/.test(vc) && /createWebViewWith/.test(vc))

  /* Every outbound link in the itinerary carries target="_blank", and a web
     view with no UI delegate does nothing at all with those — the tap
     registers and no booking page opens, which looks like the app working. */
  check('with the delegate that makes target=_blank work at all',
    /WKUIDelegate/.test(vc) && /uiDelegate\s*=\s*self/.test(vc))

  /* file:// gets an opaque origin in WKWebView and an opaque origin has no
     localStorage — the theme and the fold would be forgotten on every launch
     with no error to explain it. Same reason Android serves over https. */
  check('and serves the bundle from a real origin, not file://',
    /setURLSchemeHandler/.test(vc) && !/loadFileURL/.test(vc))

  /* The other half of the theme fix. Android hears about a theme change over a
     WebMessageListener; iOS hears about it over a script message handler, and
     the page calls one name on both. Without the shim the page's OverlandShell
     is undefined here, tellTheShell() returns early, and the status bar keeps
     whatever it decided at load — which the Info.plist claims it does not. */
  check('and repaints the status bar when the reader changes theme, not only on load',
    /addUserScript/.test(vc) && /window\.OverlandShell/.test(vc) &&
      /WKScriptMessageHandler/.test(vc) && /name:\s*"OverlandShell"/.test(vc))

  /* WKUserContentController retains its handlers, and the handler retaining the
     view controller closes a loop through the configuration that nothing opens.
     Registering `self` is the obvious way to write this and it leaks. */
  check('without the retain cycle that registering self would make',
    !/controller\.add\(self,/.test(vc) && /weak var owner/.test(vc))

  const icon = 'ios/Overland/Resources/Assets.xcassets/AppIcon.appiconset/icon-1024.png'
  if (!has(icon)) {
    check('the App Store icon exists', false, icon)
  } else {
    const b = readFileSync(join(root, icon))
    // Apple rejects an icon with an alpha channel. PNG colour type 6 is RGBA.
    check('the App Store icon is 1024×1024 with no alpha',
      b.readUInt32BE(16) === 1024 && b.readUInt32BE(20) === 1024 && b[25] !== 6,
      `${b.readUInt32BE(16)}×${b.readUInt32BE(20)}, colour type ${b[25]}`)
  }

  const files = has('ios/appstore') ? readdirSync(join(root, 'ios/appstore')) : []
  for (const [label, prefix, w, h] of [
    ['iPhone 6.9"', 'ios-iphone-69', 1320, 2868],
    ['iPhone 6.5"', 'ios-iphone-65', 1242, 2688],
    ['iPad 13"', 'ios-ipad', 2064, 2752],
  ]) {
    const shots = [1, 2, 3, 4, 5, 6, 7, 8]
      .map(n => files.find(f => f.startsWith(`${prefix}-${n}-`)))
    check(`there are eight ${label} screenshots`, shots.every(Boolean),
      `${shots.filter(Boolean).length} of 8`)
    const wrong = shots.filter(Boolean).map(f => {
      const b = readFileSync(join(root, 'ios/appstore', f))
      return [f, b.readUInt32BE(16), b.readUInt32BE(20)]
    }).filter(([, gw, gh]) => gw !== w || gh !== h)
    check(`and every ${label} one is ${w}×${h}`, wrong.length === 0,
      wrong.map(([f, gw, gh]) => `${f}: ${gw}×${gh}`).join(', '))
  }

  const listing = src('ios/appstore/listing.md')
  const blocks = [...listing.matchAll(/```\n([\s\S]*?)\n```/g)].map(m => m[1])
  const [name, subtitle, promo, keywords, description] = blocks
  for (const [label, text, max] of [
    ['name', name, 30], ['subtitle', subtitle, 30], ['promotional text', promo, 170],
    ['keywords', keywords, 100], ['description', description, 4000],
  ]) {
    check(`the App Store ${label} fits Apple's ${max}`, text && text.length <= max,
      `${text?.length} chars`)
  }
  // Apple indexes the name and subtitle already; a keyword repeated from
  // either is budget spent on nothing.
  const named = new Set(`${name} ${subtitle}`.toLowerCase().split(/[^a-z]+/).filter(Boolean))
  const wasted = keywords.split(',').filter(k => named.has(k.toLowerCase()))
  check('and no keyword repeats the name or subtitle', wasted.length === 0, wasted.join(', '))
  check('and the keyword list has no spaces to waste',
    !/,\s/.test(keywords))

  check('the review note answers the minimum-functionality guideline',
    /4\.2/.test(listing) && /Airplane Mode/i.test(listing))

  /* Every screenshot slot the listing claims to fill has to have files behind
     it, and every set of files has to be claimed. A folder full of PNGs nobody
     documented is how the wrong set gets uploaded to the wrong slot. */
  const prefixes = [...new Set(files.filter(f => f.endsWith('.png'))
    .map(f => f.replace(/-\d+-[a-z]+\.png$/, '')))]
  const undocumented = prefixes.filter(p => !listing.includes(p))
  check('the listing accounts for every set of screenshots in the folder',
    undocumented.length === 0, undocumented.join(', '))

  /* Apple rejects a support URL that is a placeholder or obviously another
     page reused, and the listing has to point at one that exists. */
  const supportUrl = (listing.match(/\*\*Support URL:\*\* `([^`]+)`/) || [])[1]
  check('the listing names a support URL', !!supportUrl, supportUrl)
  if (supportUrl) {
    const slug = supportUrl.replace(/^https?:\/\/[^/]+\//, '')
    check('and the page behind it is built',
      existsSync(join(root, `public/${slug}.html`)), slug)
    check('and it is not the privacy policy under another name',
      slug !== 'privacy', slug)
  }

  /* Both apps are described by one privacy page, and the sentence that is true
     of Android is not true of iOS. The page has to say which is which. */
  if (existsSync(join(root, 'public/privacy.html'))) {
    const policy = readFileSync(join(root, 'public/privacy.html'), 'utf8')
    check('the privacy policy covers the iOS app separately',
      /iPhone and iPad app/i.test(policy) &&
        /no permission to withhold|has no equivalent/i.test(policy))
    check('and does not claim iOS withholds a permission it cannot',
      !/iOS[^.]*no internet permission/i.test(policy))
  }
}

/* ------------------------------------------------------- the store listing */

/* The listing quotes the network back at people — how many stations, how many
 * legs, how many crossings — and those are the first numbers to go stale when
 * the data grows. Nobody re-reads a store description looking for arithmetic,
 * so the build does it. Same reason the privacy page is checked above: text
 * that makes claims about the code has to be held to them. */
{
  const file = join(root, 'android/play/listing.md')
  if (!existsSync(file)) {
    check('the store listing is written', false, 'android/play/listing.md missing')
  } else {
    const md = readFileSync(file, 'utf8')
    const blocks = [...md.matchAll(/```\n([\s\S]*?)\n```/g)].map(m => m[1])
    const [name, short, full] = blocks

    check('the store name fits and matches the app', name && name.length <= 30 &&
      readFileSync(join(root, 'android/app/src/main/res/values/strings.xml'), 'utf8')
        .includes(`>${name}<`), name)
    check('the short description fits Play\'s 80', short && short.length <= 80,
      `${short?.length} chars`)
    check('and the full one fits 4000', full && full.length <= 4000, `${full?.length} chars`)

    const stations = Object.keys(NETWORK.stations).length
    const legs = NETWORK.legs.length
    const borders = Object.keys(NETWORK.borders).length
    check('the listing counts the stations the network has',
      full.includes(`${stations} stations`), `data says ${stations}`)
    check('and the legs', full.includes(`${legs} legs`), `data says ${legs}`)
    check('and the crossings', full.includes(`${borders} international crossings`),
      `data says ${borders}`)

    // Every country named in the listing has to actually be in the network,
    // and every country in the network has to be named. Adding Timor-Leste
    // and forgetting the description is exactly the kind of miss this catches.
    const NAMES = {
      th: 'Thailand', my: 'Malaysia', sg: 'Singapore', la: 'Laos', kh: 'Cambodia',
      vn: 'Vietnam', id: 'Indonesia', mm: 'Myanmar', bn: 'Brunei',
      ph: 'the Philippines', cn: 'China',
    }
    const inData = [...new Set(Object.values(NETWORK.stations).map(s => s.country))]
    const missing = inData.filter(c => !NAMES[c] || !full.includes(NAMES[c]))
    check('and names every country it actually reaches', missing.length === 0,
      missing.join(', '))

    // The graphics Play will not accept a submission without.
    for (const [label, rel, w, h] of [
      ['the icon', 'android/play/icon-512.png', 512, 512],
      ['the feature graphic', 'android/play/feature-graphic.png', 1024, 500],
    ]) {
      const p = join(root, rel)
      if (!existsSync(p)) { check(`${label} exists`, false, rel); continue }
      // PNG: width and height are big-endian 32-bit at byte 16 of the IHDR.
      const b = readFileSync(p)
      const got = [b.readUInt32BE(16), b.readUInt32BE(20)]
      check(`${label} is the size Play asks for`, got[0] === w && got[1] === h,
        `${got[0]}×${got[1]}`)
    }

    /* Both device sets, because the tablet tab of the Console is the one
       nobody opens twice — a set that quietly went missing or came out the
       wrong size there would not be noticed until a submission is rejected. */
    const files = readdirSync(join(root, 'android/play'))
    for (const [label, prefix, w, h] of [
      ['phone', 'screenshot', 1080, 1920],
      ['7-inch tablet', 'tablet7', 1200, 1920],
      ['10-inch tablet', 'tablet10', 2560, 1600],
    ]) {
      const screens = [1, 2, 3, 4, 5, 6, 7, 8]
        .map(n => [n, files.find(f => f.startsWith(`${prefix}-${n}-`))])
      const gaps = screens.filter(([, f]) => !f).map(([n]) => n)
      check(`there are eight ${label} screenshots, in order`, gaps.length === 0,
        gaps.length ? `missing ${gaps.join(', ')}` : '')
      const wrong = screens.filter(([, f]) => f).map(([n, f]) => {
        const b = readFileSync(join(root, 'android/play', f))
        return [n, b.readUInt32BE(16), b.readUInt32BE(20)]
      }).filter(([, gw, gh]) => gw !== w || gh !== h)
      check(`and every ${label} one is ${w}×${h}`, wrong.length === 0,
        wrong.map(([n, gw, gh]) => `${n}: ${gw}×${gh}`).join(', '))
      // Play takes anything between 16:9 and 9:16; both of these sit inside
      // it, but the arithmetic is worth keeping if the shapes ever change.
      const ratio = h / w
      check(`and the ${label} shape is one Play accepts`,
        ratio >= 9 / 16 && ratio <= 16 / 9, `${w}×${h}`)
    }

    // Both sets tell the same story in the same order, so a screenshot added
    // to one and forgotten in the other shows up here rather than in the
    // Console.
    const named = pre => files.filter(f => f.startsWith(pre + '-'))
      .map(f => f.replace(/^[a-z0-9]+-\d-/, '').replace(/\.png$/, '')).sort()
    const sets = ['screenshot', 'tablet7', 'tablet10'].map(named)
    check('all three sets show the same eight things',
      sets.every(set => set.join(' ') === sets[0].join(' ')),
      sets.map(set => set.length).join('/'))
  }
}

/* --------------------------------------------------- the other ways round */

/* The reported bug and the feature it produced. A reader in Batam was being
   sent up Sumatra by coach because the network had no edge for the ship that
   sails to Jakarta — and could not see that any other way existed. */
{
  const { page, context } = await newPage()
  await page.goto(url + '#from=batam&to=jakarta')
  await page.waitForFunction(() => document.querySelector('#panel h1'))
  await page.waitForTimeout(400)

  const first = await page.evaluate(() =>
    [...document.querySelectorAll('tr.leg .svc')].map(e => e.textContent).join(' | '))
  check('Batam to Jakarta sails rather than taking three days of buses',
    /Pelni/.test(first), first.slice(0, 90))

  const cards = await page.evaluate(() => [...document.querySelectorAll('.way')].length)
  check('and the coach route is still offered as the other way round', cards >= 2, `${cards} cards`)

  /* The one that mattered: adopting an alternative has to rebuild the page,
     not swap the table. A route's cost, nights and borders are all downstream
     of which way it goes, and showing one route's legs against another's
     totals would be worse than not offering the choice. */
  const before = await page.evaluate(() => ({
    stats: document.querySelector('.stats').textContent,
    legs: document.querySelectorAll('tr.leg').length,
  }))
  await page.locator('.way-go').first().click()
  await page.waitForTimeout(400)
  const after = await page.evaluate(() => ({
    stats: document.querySelector('.stats').textContent,
    legs: document.querySelectorAll('tr.leg').length,
    marked: document.querySelector('.way.on .way-head b')?.textContent.trim(),
    hash: location.hash,
  }))
  check('choosing one rebuilds the whole itinerary',
    after.stats !== before.stats && after.legs !== before.legs,
    `${before.legs} legs -> ${after.legs}`)
  check('and marks the one being shown', /Alternative/.test(after.marked || ''), after.marked)
  // So that "the long way through Sumatra" is a link somebody else can open.
  check('and puts it in the url', /way=1/.test(after.hash), after.hash)
  await context.close()
}

{
  const { page, context } = await newPage()
  /* Half an hour on the Singapore MRT. Before the ceiling this offered three
     days through Sumatra at twenty-five times the cost, which is the failure
     mode of every k-shortest-path implementation that does not have one. */
  await page.goto(url + '#from=woodlands&to=singapore')
  await page.waitForFunction(() => document.querySelector('#panel h1'))
  await page.waitForTimeout(400)
  check('a short hop is not offered a three-day detour',
    await page.evaluate(() => !document.querySelector('.ways')))

  /* Nor the same journey twice with one station moved — the other way this
     goes wrong, and the reason the overlap test is on travelling time rather
     than on the list of stops. */
  await page.goto('about:blank')
  await page.goto(url + '#from=singapore&to=klsentral')
  await page.waitForFunction(() => document.querySelector('#panel h1'))
  await page.waitForTimeout(400)
  check('nor the same route with a station swapped',
    await page.evaluate(() => !document.querySelector('.ways')))
  await context.close()
}

/* Every guide page's meta description, which is the snippet Google may show
   and the only 155 characters most people ever read of a page.

   Checked because `t.ferryHours` — a field that does not exist, the real one
   being `seaHours` — meant "sea" had never once appeared in a description,
   including on the routes that are mostly boat. It stayed invisible for as
   long as every written route had a train on it and the sentence still read. */
{
  const pages = readdirSync(join(root, 'public')).filter(f => f.endsWith('.html'))
  const descs = pages
    .map(f => [f, readFileSync(join(root, 'public', f), 'utf8')])
    .map(([f, h]) => [f, (h.match(/name="description" content="([^"]*)"/) || [])[1] || ''])
    .filter(([f]) => !/privacy|support|border-crossing/.test(f))

  check('every guide page has a description', descs.every(([, d]) => d.length > 60),
    descs.filter(([, d]) => d.length <= 60).map(([f]) => f).join(' ') || 'all present')

  /* The two shapes the bug produced: an empty mode list, and a count that
     never learned to be singular. */
  const broken = descs.filter(([, d]) => / by  |by , | 1 legs /.test(d))
  check('and none of them says "1 legs" or "by  "', !broken.length,
    broken.map(([f]) => f).join(' '))

  /* And a route that is entirely boat says so. This is the assertion the old
     field name would have failed. */
  const ferry = descs.find(([f]) => f === 'cebu-to-bohol-by-ferry.html')
  check('a crossing made only of sea is described as sea', ferry && / by sea /.test(ferry[1]),
    ferry ? ferry[1].slice(0, 60) : 'page missing')

  /* Nothing announces a border count of zero. It is a fact about nothing,
     spent out of the only characters anyone reads. */
  check('and no page advertises having no borders', !descs.some(([, d]) => /0 borders/.test(d)))
}

/* The guide pages are most of what anyone reads — a search lands on one of
   them, not on the planner — so an alternative that only exists behind the
   JavaScript is one most readers never see. */
{
  const pages = readdirSync(join(root, 'public')).filter(f => f.endsWith('.html'))
  const withWays = pages.filter(f =>
    /Other ways round/.test(readFileSync(join(root, 'public', f), 'utf8')))
  check('the guide pages carry the alternatives too', withWays.length > 0,
    `${withWays.length} pages`)

  /* Bangkok to Singapore down the east coast is the case that made the
     difference test absolute rather than proportional. If it is missing, the
     filter has gone back to measuring share. */
  const bkk = readFileSync(join(root, 'public/bangkok-to-singapore-by-train.html'), 'utf8')
  check('including the Jungle Railway against the west coast',
    /Other ways round/.test(bkk) && /Jungle Railway|Wakaf|Gua Musang|Kuala Lipis/.test(bkk))

  /* A static page cannot rebuild itself, so the choice has to be a link into
     the planner with the routing already picked — not a button nothing is
     listening for. */
  const one = withWays.map(f => readFileSync(join(root, 'public', f), 'utf8')).find(h => /way-go/.test(h))
  check('and offer it as a link into the planner rather than a dead button',
    one && /class="way-go" href="\/#from=[^"]*&amp;way=\d"/.test(one) &&
      !/<button[^>]*class="way-go"/.test(one))
}

/* And the app carries all of it.
 *
 * The app is the same program in a different package — same src/, same
 * dist/app.js — so in principle this cannot diverge. In practice the app build
 * drops the photographs and every website-only section, and "in principle it
 * cannot" is how a section ends up missing from the half of the audience that
 * installed it. Checked against the bundle Android and iOS actually ship. */
{
  const { page, context } = await newPage({
    viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true,
  })
  const bundle = 'file://' + join(root, 'dist/app.html')
  await page.goto(bundle + '#from=singapore&to=denpasar')
  await page.waitForFunction(() => document.querySelector('#panel h1'))
  await page.waitForTimeout(500)

  check('the app is the app', await page.evaluate(() => document.documentElement.dataset.app === 'true'))
  const cards = await page.evaluate(() => document.querySelectorAll('.way').length)
  check('and offers the other ways round as well', cards >= 2, `${cards} cards`)
  check('and says what stops running', await page.evaluate(() => !!document.querySelector('.clockblock')))

  /* A button, not a link. The guide pages send a reader to the planner because
     they cannot rebuild themselves; the app is the planner and must not send
     anyone anywhere — it has no network to send them over. */
  check('with a control the app can answer itself',
    await page.evaluate(() => {
      const el = document.querySelector('.way-go')
      return !!el && el.tagName === 'BUTTON' && !el.getAttribute('href')
    }))

  // And it has to work under a finger, which is the only way anyone will use it.
  const before = await page.evaluate(() => document.querySelectorAll('tr.leg').length)
  await page.locator('.way-go').first().scrollIntoViewIfNeeded()
  await page.locator('.way-go').first().tap()
  await page.waitForTimeout(500)
  const after = await page.evaluate(() => ({
    legs: document.querySelectorAll('tr.leg').length,
    on: document.querySelector('.way.on .way-head b')?.textContent.trim(),
  }))
  check('and a tap rebuilds the itinerary around it', after.legs !== before && /Alternative/.test(after.on || ''),
    `${before} legs -> ${after.legs}, showing ${after.on}`)
  await context.close()
}

/* The app remembers what you were planning.
 *
 * The website keeps the route in the hash, where the tab, the history and a
 * bookmark all hold it. The app cold-starts at its launch URL with no hash, so
 * without this a traveller who planned on the hostel wifi and got on a train
 * found the start screen — the wrong failure for a program whose promise is
 * that the phone stops needing a signal. */
{
  const bundle = 'file://' + join(root, 'dist/app.html')
  const { page, context } = await newPage({
    viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true,
  })
  const head = () => page.evaluate(() => document.querySelector('#panel h1')?.textContent.trim() || '')
  /* about:blank between each, because a goto that only changes the fragment
     does not reload — and a check that never reloaded would pass by reading
     the page it was already on. */
  const relaunch = async hash => {
    await page.goto('about:blank')
    await page.goto(bundle + (hash || ''))
    await page.waitForTimeout(700)
  }

  await relaunch('#from=bkk_aphiwat&to=singapore')
  const planned = await head()
  await relaunch()
  check('the app opens where the traveller left off', (await head()) === planned, planned)

  /* A link into a specific journey is a stronger instruction than what
     somebody happened to be looking at last time. */
  await relaunch('#from=singapore&to=denpasar')
  check('but a link still names the journey', /Bali/.test(await head()), await head())

  // Start over has to mean start over, or the next launch undoes it.
  await relaunch()
  const idleFirst = planned
  await page.locator('#startover').click()
  await page.waitForTimeout(300)
  const idle = await head()
  check('Start over returns to the front screen', idle !== idleFirst, idle)
  await relaunch()
  check('and the next launch does not undo it', (await head()) === idle, await head())
  await context.close()
}

{
  /* The website keeps its front door. Restoring there would mean a returning
     reader never sees the page that explains what this is. */
  const { page, context } = await newPage({
    viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true,
  })
  await page.goto(url + '#from=bkk_aphiwat&to=singapore')
  await page.waitForFunction(() => document.querySelector('#panel h1'))
  await page.waitForTimeout(400)
  const routed = await page.evaluate(() => document.querySelector('#panel h1').textContent.trim())
  await page.goto('about:blank')
  await page.goto(url)
  await page.waitForTimeout(700)
  const front = await page.evaluate(() => document.querySelector('#panel h1').textContent.trim())
  check('the website still opens on the front door', front !== routed, front)
  await context.close()
}

/* A service that does not run every day, and the fact that the totals above it
 * are running times rather than trip length. Sharpened by the Pelni ships:
 * Batam to Jakarta is one 32-hour leg and reads as two days, which is true of
 * the voyage and can be most of a week wrong about the trip. */
{
  const { page, context } = await newPage()
  await page.goto(url + '#from=batam&to=jakarta')
  await page.waitForFunction(() => document.querySelector('#panel h1'))
  await page.waitForTimeout(400)
  const warned = await page.evaluate(() =>
    [...document.querySelectorAll('#panel')].map(e => e.textContent).join(' '))
  check('a weekly sailing says so where the totals can be seen',
    /does not run every day/.test(warned) && /length of the trip/.test(warned))

  /* And nowhere else. A frequency warning on a service running every twenty
     minutes is how a reader learns to skip the risk box — which is what the
     first version of the test did, by matching "0–2" inside "every 10–20 min". */
  await page.goto('about:blank')
  await page.goto(url + '#from=klsentral&to=singapore')
  await page.waitForFunction(() => document.querySelector('#panel h1'))
  await page.waitForTimeout(400)
  check('and a daily corridor is left alone',
    !/does not run every day/.test(
      await page.evaluate(() => document.querySelector('#panel').textContent)))
  await context.close()
}

/* ------------------------------------------------ what stops running, when */

{
  const { page, context } = await newPage()
  await page.goto(url + '#from=chiangmai&to=luangprabang')
  await page.waitForFunction(() => document.querySelector('#panel h1'))
  await page.waitForTimeout(400)

  const clock = await page.evaluate(() => {
    const el = document.querySelector('.clockblock')
    if (!el) return null
    return {
      binds: el.querySelector('.clock-binds')?.textContent.replace(/\s+/g, ' ').trim() || null,
      rows: document.querySelectorAll('table.clock tbody tr').length,
      marked: document.querySelectorAll('table.clock tr.binds').length,
    }
  })
  check('the route says what stops running and when', !!clock, clock ? `${clock.rows} legs` : 'missing')
  /* One boat a day, leaving at nine and not waiting. If any route on this map
     should name the door that closes first, it is this one. */
  check('and names the one to plan backwards from',
    clock && /09:30/.test(clock.binds || ''), clock?.binds?.slice(0, 70))
  check('and marks the same row the sentence points at', clock && clock.marked === 1)

  /* The other half of the rule. A shuttle running every half hour until 23:45
     is a true answer to "what closes first" and a useless one, and a box that
     says something useless is a box people learn to skip. */
  await page.goto('about:blank')
  await page.goto(url + '#from=bkk_aphiwat&to=singapore')
  await page.waitForFunction(() => document.querySelector('#panel h1'))
  await page.waitForTimeout(400)
  check('but does not tell anyone to plan backwards from a midnight shuttle',
    await page.evaluate(() =>
      !!document.querySelector('.clockblock') && !document.querySelector('.clock-binds')))
  await context.close()
}

/* -------------------------------------------- the strip that offers the app */

/* The one piece of the site that is an advertisement, which is exactly why it
 * gets checked hardest: for who it is shown to, for what happens to a no, and
 * for whether it covers anything. Google demotes a mobile page that hides its
 * own content behind an app promotion, and it should. */
{
  const ANDROID =
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/126 Mobile Safari/537.36'
  const IPHONE =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 ' +
    '(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
  const phone = ua => ({
    userAgent: ua, viewport: { width: 412, height: 915 },
    deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  })

  const strip = async (at, opts) => {
    const { page, context } = await newPage(opts)
    await page.goto(at)
    await page.waitForTimeout(400)
    const seen = await page.evaluate(() => {
      const el = document.querySelector('.appbanner')
      if (!el || getComputedStyle(el).display === 'none') return null
      const bar = document.querySelector('.topbar')
      const no = el.querySelector('.appbanner-no').getBoundingClientRect()
      return {
        box: el.getBoundingClientRect().toJSON(),
        topbar: bar ? bar.getBoundingClientRect().toJSON() : null,
        href: el.querySelector('.appbanner-go').getAttribute('href'),
        dismiss: [no.width, no.height],
      }
    })
    return { page, context, seen }
  }

  /* Not shown where there is nothing to install, and — the one that would be
     embarrassing — not shown inside the app it is offering. */
  for (const [what, at, opts] of [
    ['an iPhone', url, phone(IPHONE)],
    ['a desktop browser', url, {}],
    ['the app itself', 'file://' + join(root, 'dist/app.html'), phone(ANDROID)],
  ]) {
    const { context, seen } = await strip(at, opts)
    check(`the install strip stays out of the way on ${what}`, seen === null,
      seen ? 'it is showing' : '')
    await context.close()
  }

  {
    const { page, context, seen } = await strip(url, phone(ANDROID))
    check('and offers itself on an Android phone', !!seen)
    if (seen) {
      check('and points at the app that is actually published',
        seen.href === 'https://play.google.com/store/apps/details?id=com.overlandsoutheastasia',
        seen.href)
      /* Fixed over a full-bleed map, so nothing here is stacked by the
         document — the top bar is moved by a variable, and a wrong one puts
         the strip over the brand. */
      check('and sits above the top bar rather than over it',
        seen.topbar && seen.box.bottom <= seen.topbar.top + 0.5,
        `strip ends ${seen.box.bottom.toFixed(0)}, bar starts ${seen.topbar?.top.toFixed(0)}`)
      /* A dismiss smaller than a thumb is a dismiss that opens the Play Store
         by accident — the one failure this strip must not have. */
      check('with a no big enough to hit', Math.min(...seen.dismiss) >= 44,
        seen.dismiss.map(n => n.toFixed(0)).join('×'))

      /* Full open clears the top bar today; it has to still clear it with the
         strip above, or the sheet swallows both. */
      const clears = await page.evaluate(() => {
        const el = document.querySelector('.appbanner')
        return Math.round(window.innerHeight * 0.06) + el.offsetHeight
          >= el.getBoundingClientRect().bottom
      })
      check('and the itinerary at full height stops below it', clears)

      await page.locator('.appbanner-no').tap()
      await page.waitForTimeout(150)
      const gone = await page.evaluate(() =>
        getComputedStyle(document.querySelector('.appbanner')).display === 'none')
      check('a no takes it away', gone)
      await page.reload()
      await page.waitForTimeout(400)
      const stillGone = await page.evaluate(() =>
        getComputedStyle(document.querySelector('.appbanner')).display === 'none')
      check('and it is not asked again', stillGone)
    }
    await context.close()
  }

  /* ---------------------------------------------- asking only once, ever */

  /* The strip must not ask someone who already installed it. That answer comes
     from navigator.getInstalledRelatedApps(), which the browser only answers
     when the site names the app and the app names the site back — so the two
     halves are checked as well as the behaviour. */

  const PACKAGE = 'com.overlandsoutheastasia'
  const src = p => readFileSync(join(root, p), 'utf8')

  {
    const manifest = JSON.parse(src('public/site.webmanifest'))
    const related = manifest.related_applications || []
    check('the manifest names the app the site claims',
      related.some(a => a.platform === 'play' && a.id === PACKAGE),
      JSON.stringify(related))
    /* Three files have to agree on one string, and they are in three
       languages. A rename that misses one gives a strip that offers an app
       nobody can install, or an install check that never fires. */
    const gradle = src('android/app/build.gradle.kts')
    check('and it is the id the app is actually published under',
      new RegExp(`applicationId\\s*=\\s*"${PACKAGE}"`).test(gradle) &&
        src('src/appbanner.html').includes(`id=${PACKAGE}`))
    /* Deliberately not an installable web app: there is no service worker, so
       an installed copy would be a browser with the address bar removed and no
       offline story — which is the whole of what the real app offers. */
    check('and does not offer the site as a web app instead',
      manifest.display === 'browser' && manifest.prefer_related_applications === true)
    check('and the pages link it', /rel="manifest"/.test(src('index.html')) &&
      /rel="manifest"/.test(src(join('public', readdirSync(join(root, 'public'))
        .find(f => f.endsWith('.html'))))))
  }

  {
    const strings = src('android/app/src/main/res/values/strings.xml')
    const manifest = src('android/app/src/main/AndroidManifest.xml')
    check('and the app names the site back',
      /asset_statements/.test(strings) && /slowasia\.com/.test(strings) &&
        /android:name="asset_statements"/.test(manifest))
    /* An association, not a claim on the URLs. autoVerify here would take
       every slowasia.com link on the phone away from the browser and open it
       in the app — which is a different feature nobody asked for. */
    check('without taking the site\'s links away from the browser',
      !/autoVerify/.test(manifest) && !/android\.intent\.category\.BROWSABLE/.test(manifest))
  }

  {
    const say = async (label, stub, expect) => {
      const { page, context } = await newPage(phone(ANDROID))
      await context.addInitScript(stub)
      await page.goto(url)
      await page.waitForTimeout(400)
      const shown = await page.evaluate(() =>
        getComputedStyle(document.querySelector('.appbanner')).display !== 'none')
      check(label, shown === expect, shown ? 'showing' : 'hidden')
      await context.close()
    }
    await say('and having the app already is a reason not to ask',
      `navigator.getInstalledRelatedApps = () => Promise.resolve(
         [{ platform: 'play', id: '${PACKAGE}' }])`, false)
    /* Every way the question can fail to be answered ends the same way: keep
       asking. A browser without the API, an association that does not verify,
       somebody else's app — none of them are evidence that this one is
       installed, and treating them as such hides the strip from everyone. */
    await say('but a browser that cannot answer is not a yes',
      'delete navigator.getInstalledRelatedApps', true)
    await say('nor is an association that does not verify',
      `navigator.getInstalledRelatedApps = () => Promise.reject(new Error('no'))`, true)
    await say('nor is somebody else\'s app',
      `navigator.getInstalledRelatedApps = () => Promise.resolve(
         [{ platform: 'play', id: 'com.someone.else' }])`, true)
  }

  /* The guide pages carry it too, and they are where it matters more: a guide
     page is where a search lands. They stack in the document rather than
     floating, so the same rule would park it over their own header. */
  {
    const guide = readdirSync(join(root, 'public')).find(f => f.endsWith('.html'))
    /* Its photographs are referenced from the site root, which is right on the
       site and unreachable over file://. Everything this block looks at is
       above the first photograph. */
    const { context, seen } = await strip('file://' + join(root, 'public', guide),
      { ...phone(ANDROID), ignore: /ERR_FILE_NOT_FOUND/ })
    check('the guide pages carry it as well', !!seen, guide)
    if (seen) {
      check('and there it pushes the header down instead of covering it',
        seen.topbar && seen.box.bottom <= seen.topbar.top + 0.5,
        `strip ends ${seen.box.bottom.toFixed(0)}, header starts ${seen.topbar?.top.toFixed(0)}`)
    }
    await context.close()
  }
}

await browser.close()

console.log('')
if (problems.length) {
  console.log(`${problems.length} problem(s):`)
  for (const p of problems) console.log('  - ' + p)
  process.exit(1)
}
console.log(`All checks passed. Screenshots in ${outDir}`)
