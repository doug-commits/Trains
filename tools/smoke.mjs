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
  check('preset chips render', (await page.locator('.chip').count()) === 6)
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
  await page.locator('.chip', { hasText: 'Laos → Malaysia' }).click()
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

  // Nothing may overflow the panel horizontally.
  const overflow = await page.evaluate(() => {
    const p = document.querySelector('#panel')
    return p.scrollWidth - p.clientWidth
  })
  check('panel does not scroll sideways', overflow <= 1, `${overflow}px`)

  await page.screenshot({ path: join(outDir, '02-route-dark.png') })
  await context.close()
}

/* ---------------------------------------------- no rail answer at all */
{
  const { page, context } = await newPage()
  await page.goto(url)
  await page.waitForFunction(() => document.querySelector('#panel h1'))
  await page.locator('.chip', { hasText: 'Bangkok → Hanoi' }).click()
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
  await page.locator('.chip', { hasText: 'Bangkok → Hanoi' }).click()
  await page.waitForFunction(() => document.querySelector('.route tbody tr'))
  // Drive it the way a user does — via the label, not the hidden input.
  await page.locator('.toggle-text b').click()
  await page.waitForTimeout(700)

  check('toggle actually flipped', await page.locator('#railonly').isChecked())
  const text = await page.textContent('#panel')
  check('rail-only refuses rather than stretches', /rails do not go this way/i.test(text))
  await page.screenshot({ path: join(outDir, '04-rail-only-refusal.png') })
  await context.close()
}

/* --------------------------------------------------------- light theme */
{
  const { page, context } = await newPage({ colorScheme: 'light' })
  await page.goto(url)
  await page.waitForFunction(() => document.querySelector('#panel h1'))
  await page.locator('.chip', { hasText: 'Singapore → Bali' }).click()
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
  await page.locator('.chip', { hasText: 'Bangkok → Singapore' }).click()
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
