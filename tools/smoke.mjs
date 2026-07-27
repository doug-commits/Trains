#!/usr/bin/env node
/* Browser smoke test: loads the built page, drives the real controls, and
 * fails on any console error or unhandled rejection. Also writes screenshots
 * so the layout can be eyeballed rather than assumed.
 *
 *   node tools/build.mjs && node tools/smoke.mjs [outDir]
 */

import { chromium } from 'playwright'
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/* The page bundles its sources into a closure, so nothing is reachable on
 * window. Where an assertion needs a count from the data rather than a literal
 * that rots on the next edit, read the data file here instead. */
const NETWORK = new Function(
  readFileSync(join(root, 'data/network.js'), 'utf8') + '; return NETWORK'
)()
const outDir = resolve(process.argv[2] || join(root, 'shots'))
mkdirSync(outDir, { recursive: true })

const url = 'file://' + join(root, 'index.html')
const problems = []

const browser = await chromium.launch()

async function newPage(opts = {}) {
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 2,
    colorScheme: 'dark',
    ...opts,
  })
  const page = await context.newPage()
  page.on('console', m => {
    if (m.type() === 'error') problems.push(`console.error: ${m.text()}`)
  })
  page.on('pageerror', e => problems.push(`pageerror: ${e.message}`))
  return { page, context }
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
  check('no affiliate links claimed', /No affiliate links/.test(await page.textContent('#panel')))

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

  // Picking a route should still carry you down to the answer.
  await page.locator('.corridor').first().click()
  await page.waitForFunction(() => document.querySelector('.route tbody tr'))
  await page.waitForTimeout(1400)
  check('choosing a route still scrolls to it',
    (await page.evaluate(() => window.scrollY)) > 200)
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

await browser.close()

console.log('')
if (problems.length) {
  console.log(`${problems.length} problem(s):`)
  for (const p of problems) console.log('  - ' + p)
  process.exit(1)
}
console.log(`All checks passed. Screenshots in ${outDir}`)
