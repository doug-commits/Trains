#!/usr/bin/env node
/* Browser smoke test: loads the built page, drives the real controls, and
 * fails on any console error or unhandled rejection. Also writes screenshots
 * so the layout can be eyeballed rather than assumed.
 *
 *   node tools/build.mjs && node tools/smoke.mjs [outDir]
 */

import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
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
  check('myths render', (await page.locator('.myths li').count()) === 7)

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

  // Illustrations are canvases; a blank one is a silent failure.
  const art = await page.evaluate(() =>
    [...document.querySelectorAll('canvas.scene')].map(c => {
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
      const seen = new Set()
      for (let i = 0; i < d.length; i += 800) seen.add(`${d[i]},${d[i + 1]},${d[i + 2]}`)
      return seen.size
    })
  )
  check('destination art renders on every card', art.length >= 6 && art.every(n => n > 5),
    `${art.length} drawn, min ${Math.min(...art)} colours`)

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
  check('nonsense is refused, not guessed at', /Not sure what you mean/.test(await page.textContent('#asknote')))

  await page.screenshot({ path: join(outDir, '16-ask-answer.png') })
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
