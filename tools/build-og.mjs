#!/usr/bin/env node
/* Share cards: one per written page, each a map of that actual journey.
 *
 * Every page on this site declared `twitter:card = summary_large_image` and
 * carried no image at all, so every share of it — X, LinkedIn, Facebook,
 * WhatsApp, Slack, Discord, Reddit — rendered as a blank rectangle with a
 * headline under it. That is the worst possible state: the markup promises a
 * picture and then supplies nothing, so the card is not merely plain, it looks
 * broken, and a broken card is not shared onward. Shares are how a site with no
 * backlinks earns its first ones, so this was the cheapest large thing left
 * undone.
 *
 * The card is the route drawn on the chart. Not a logo, not a stock photograph
 * of a train: the one picture this site can make that nobody else can, and the
 * one that answers the question the headline asks. "Bangkok to Singapore by
 * train" with a line down the Malay peninsula beside it is a different
 * proposition from the same words on their own.
 *
 * Rendered by driving the real planner rather than by reimplementing the map,
 * so a card cannot show a route the site would not. The titles and the numbers
 * are read out of the rendered page for the same reason — if the itinerary
 * changes, the card changes with it, and neither can quietly drift from the
 * other.
 *
 * Committed rather than generated at deploy time. The Vercel build has no
 * browser and should not grow one for this; these change when the network
 * changes, which is a few times a year.
 *
 *   node tools/build-og.mjs            # all of them
 *   node tools/build-og.mjs bangkok    # only slugs containing "bangkok"
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, join, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(root, 'data/og')

/* Facebook and X both want exactly 1200×630, and this writes exactly that.
 *
 * The first cut rendered at device-scale 2, which produces a 2400×1260 file
 * while the meta tags go on declaring 1200×630 — a card whose stated size is
 * not its real size, which the two networks then crop differently. Truthful
 * dimensions matter more here than supersampling does: this is line art seen
 * at about 500px in a feed. */
const W = 1200
const H = 630

const only = process.argv[2] || ''

if (!existsSync(join(root, 'index.html')) || !existsSync(join(root, 'app.js'))) {
  console.error('og                 build the page first — node tools/build.mjs')
  process.exit(1)
}

/* The written routes, read from the same file the pages are built from. Only
 * the endpoints and the slug are needed; everything else on the card comes off
 * the rendered page. */
const GUIDES = new Function(
  `${readFileSync(join(root, 'data/guides.js'), 'utf8')}\nreturn GUIDES`
)()

/* The network too, for one purpose: to know what the itinerary will call the
 * place each card ends at, so the card can be checked against it. Guessed from
 * the station id it does not work — `klsentral` is titled "Kuala Lumpur" and
 * shares not one word with it. */
const NETWORK = new Function(
  `${readFileSync(join(root, 'data/network.js'), 'utf8')}\nreturn NETWORK`
)()

/* The planner is one directory of static files, so this is all the server it
 * needs. It exists because file:// treats every absolute path as filesystem
 * root, and the page asks for /app.js. */
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.svg': 'image/svg+xml',
}
const server = createServer((req, res) => {
  const path = decodeURIComponent(req.url.split('?')[0].split('#')[0])
  const file = join(root, path === '/' ? 'index.html' : path)
  if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) {
    res.writeHead(404).end('no')
    return
  }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' })
  res.end(readFileSync(file))
})
await new Promise(r => server.listen(0, r))
const origin = `http://127.0.0.1:${server.address().port}`

mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch()

/* Injected before the app runs, not after.
 *
 * The map frames a route inside whatever the overlays leave visible, and it
 * measures that once, when the route is set. Hiding the panel afterwards left
 * the journey fitted to a strip on the left of a card that was now full width.
 * Hidden from the first frame, the inset measures zero and the route is framed
 * against the whole card. */
const STRIP = `
  .topbar, .sheet, .mapfoot, .appbanner, .intro { display: none !important; }
  .stage { inset: 0 !important; }
  .mapwrap { position: absolute !important; inset: 0 !important; }
  html, body, .app { background: var(--sea); }
`

/* Bumped per card so each navigation is a real one.
 *
 * Changing only the fragment is not a navigation: the browser keeps the
 * document and fires hashchange. Reusing one tab, that meant every card after
 * the first kept the first card's route, the first card's numbers, and the
 * first card's overlay stacked underneath its own — forty-eight files that all
 * showed Bangkok to Singapore under someone else's headline. A query string
 * that differs forces the load the fragment did not. */
let nav = 0

const card = async (page, { hash, title, sub, expect }) => {
  await page.goto(`${origin}/index.html?c=${nav++}${hash}`, { waitUntil: 'load' })
  // The route animates in; the settle frame is the one that draws the coastal
  // glow and the shelf, so the card has to wait for it.
  await page.waitForTimeout(3200)

  /* And then check it, because the failure above was silent. Every one of
     those forty-eight files was a valid JPEG of a real route; nothing short of
     looking at them said which route. The itinerary's own heading has to name
     the place the card claims to end at. */
  if (expect) {
    const heading = await page.evaluate(
      () => document.querySelector('.panel h1')?.textContent || ''
    )
    if (!heading.toLowerCase().includes(expect.toLowerCase())) {
      throw new Error(`card asked for "${expect}" and the page routed "${heading.trim()}"`)
    }
  }

  const stats = await page.evaluate(() =>
    [...document.querySelectorAll('.stat')]
      .slice(0, 4)
      .map(s => [s.querySelector('b')?.textContent || '', s.querySelector('span')?.textContent || ''])
  )

  await page.evaluate(
    ({ title, sub, stats }) => {
      document.getElementById('og-card')?.remove()
      const el = document.createElement('div')
      el.id = 'og-card'
      const line = stats.map(([v, l]) => `<b>${v}</b>&nbsp;${l}`).join('<i>·</i>')
      el.innerHTML = `
        <div class="og-scrim"></div>
        <div class="og-mark">OVERLAND<b>SEA</b></div>
        <div class="og-foot">
          <h1>${title}</h1>
          ${sub ? `<p class="og-sub">${sub}</p>` : ''}
          ${line ? `<p class="og-stats">${line}</p>` : ''}
        </div>`
      document.body.appendChild(el)
    },
    { title, sub, stats }
  )

  await page.addStyleTag({
    content: `
      #og-card { position: fixed; inset: 0; z-index: 99; pointer-events: none;
        font-family: BarlowCond, system-ui, sans-serif; }
      /* Scrim under the type only — a wash over the whole card would flatten
         the chart, which is the reason anyone is looking at it. It has to be
         opaque enough to take a route line running straight through the
         headline, which on a north-south journey it always does.

         The children are positioned so they paint above it. An absolutely
         positioned ::before paints above static in-flow siblings whatever the
         source order says, so the first version drew the scrim over its own
         title and the headline came out grey. */
      #og-card .og-scrim { position: absolute; left: 0; right: 0; bottom: 0; height: 62%;
        background: linear-gradient(to top,
          var(--sea) 0%,
          color-mix(in srgb, var(--sea) 97%, transparent) 34%,
          color-mix(in srgb, var(--sea) 74%, transparent) 62%,
          transparent 100%); }
      #og-card .og-foot > * { position: relative; }
      #og-card .og-mark { position: absolute; top: 40px; left: 56px;
        font-size: 24px; font-weight: 500; letter-spacing: 0.3em;
        color: color-mix(in srgb, var(--ink) 72%, transparent); }
      #og-card .og-mark b { font-weight: 700; color: var(--rail); }
      #og-card .og-foot { position: absolute; left: 56px; right: 56px; bottom: 48px; }
      #og-card h1 { margin: 0; font-size: 68px; line-height: 0.98; font-weight: 700;
        letter-spacing: -0.02em; color: var(--ink); text-wrap: balance; }
      #og-card .og-sub { margin: 14px 0 0; font-size: 27px; line-height: 1.3;
        font-weight: 400; color: var(--ink-soft); max-width: 24em; }
      #og-card .og-stats { margin: 22px 0 0; font-size: 25px; font-weight: 500;
        letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); }
      #og-card .og-stats b { font-size: 30px; font-weight: 700; color: var(--ink); }
      #og-card .og-stats i { font-style: normal; padding: 0 14px;
        color: color-mix(in srgb, var(--muted) 50%, transparent); }
    `,
  })
  await page.waitForTimeout(350)
  return page.screenshot({ type: 'jpeg', quality: 86 })
}

const page = await browser.newPage({
  viewport: { width: W, height: H },
  deviceScaleFactor: 1,
  colorScheme: 'dark',
})
await page.addInitScript(css => {
  const put = () => {
    const s = document.createElement('style')
    s.textContent = css
    document.head.appendChild(s)
  }
  if (document.head) put()
  else document.addEventListener('DOMContentLoaded', put, { once: true })
}, STRIP)

const wanted = GUIDES.filter(g => !only || g.slug.includes(only))
let made = 0

// What the itinerary heading will call this station.
const placeName = id => (NETWORK.stations[id] || {}).city || id

for (const g of wanted) {
  const shot = await card(page, {
    hash: `#from=${encodeURIComponent(g.from)}&to=${encodeURIComponent(g.to)}`,
    title: g.h1,
    sub: g.intent,
    expect: placeName(g.to),
  })
  writeFileSync(join(OUT, `${g.slug}.jpg`), shot)
  made++
  process.stdout.write(`\rog                 ${made}/${wanted.length} ${g.slug.padEnd(42)}`)
}

/* One card for everything that is not a route: the planner, the index, and the
 * two support documents. The Spine is on it because it is the journey this
 * whole network is arranged around. */
if (!only) {
  const shot = await card(page, {
    hash: '#from=kunming&to=singapore',
    title: 'Southeast Asia without flying',
    sub: 'Rail while there is land, a boat where it ends, and the border mechanics for every crossing in between.',
  })
  writeFileSync(join(OUT, 'default.jpg'), shot)
  made++
}

await browser.close()
server.close()

const bytes = readdirSync(OUT).reduce((n, f) => n + statSync(join(OUT, f)).size, 0)
process.stdout.write('\r' + ' '.repeat(78) + '\r')
console.log(`og                 ${made} cards, ${(bytes / 1024 / 1024).toFixed(1)} MB -> data/og/`)
