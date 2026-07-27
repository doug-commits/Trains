#!/usr/bin/env node
/* Static route pages, so there is something to index.
 *
 * The planner is one URL. Every itinerary it can produce lives in the hash,
 * and a fragment is not a separate document to a crawler — so "Bangkok to
 * Singapore by train", which is the thing people actually search for, was
 * invisible no matter how good the answer behind it was.
 *
 * Router, Plan and UI are pure string-building, so the same code that answers
 * the question in the browser answers it here at build time and the answer
 * ships as real HTML. The pages are not a summary of the app; they are the
 * app's own output, rendered early.
 *
 *   node tools/build-pages.mjs
 *   SITE_ORIGIN=https://example.com node tools/build-pages.mjs
 *
 * Without SITE_ORIGIN there is no canonical, no og:url and no sitemap. A
 * canonical pointing at the wrong host is worse than none at all — it tells
 * Google to index a page that does not exist.
 */

import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = p => readFileSync(join(root, p), 'utf8')

const ORIGIN = (process.env.SITE_ORIGIN || '').replace(/\/$/, '')

/* Photographs by absolute path rather than inlined. These pages are served
 * from a host that also serves data/photos, and a static page has no reason to
 * carry three megabytes of base64 in its markup — a crawler would have to
 * download all of it before reaching a word of the itinerary. */
const linkedPhotos = Object.fromEntries(
  Object.entries(JSON.parse(readFileSync(join(root, 'data/photos.json'), 'utf8'))).map(
    ([id, e]) => [id, { ...e, href: `/data/photos/${e.file}` }]
  )
)
const OUT = join(root, 'public')

/* The pure half of the app, evaluated once. Nothing here touches a DOM. */
const sandbox = new Function(`
  ${read('data/network.js')}
  ${read('data/landmarks.js')}
  const PHOTOS = ${JSON.stringify(linkedPhotos)};
  ${read('src/photos.js')}
  ${read('data/guides.js')}
  ${read('src/proj.js')}
  ${read('src/router.js')}
  ${read('src/plan.js')}
  ${read('src/ui.js')}
  return { NETWORK, LANDMARKS, GUIDES, Proj, Router, Plan, UI, Photos }
`)()
const { NETWORK, GUIDES: ROUTES, Router, Plan, UI } = sandbox
const esc = UI.esc


const TITLE_SUFFIX = 'Overland SEA'
const SITE_NAME = 'Overland SEA'

/* ------------------------------------------------------------------ page */

const nights = plan =>
  plan.totals.days === 1 ? 'a single day' : `${plan.totals.days} days`

/* Shift every heading down one level, deepest first so h2→h3 does not then get
 * caught by h1→h2 on the same pass. h5 is the floor; nothing here nests that
 * far, and clamping beats emitting an h7 that does not exist. */
function demote(html) {
  for (const n of [5, 4, 3, 2, 1]) {
    html = html
      .split(`<h${n}`).join(`<h${Math.min(6, n + 1)}`)
      .split(`</h${n}>`).join(`</h${Math.min(6, n + 1)}>`)
  }
  return html
}

function description(r, plan) {
  const t = plan.totals
  const modes = []
  if (t.railHours) modes.push('rail')
  if (t.ferryHours) modes.push('sea')
  if (t.roadHours) modes.push('road')
  return (
    `${r.h1}: ${t.legs} legs by ${modes.join(', ')} over ${nights(plan)}, ` +
    `${t.borders} border${t.borders === 1 ? '' : 's'}, about $${Math.round(t.totalUsd)} all in. ` +
    `Every crossing, connection buffer and booking route spelled out.`
  ).slice(0, 300)
}

/* Schema.org. TouristTrip is the closest fit for "a journey with an itinerary",
 * and the itemList carries the legs in order so the structure a reader sees is
 * the structure a crawler gets. */
function jsonLd(r, plan, url) {
  const st = id => NETWORK.stations[id]
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'TouristTrip',
    name: r.h1,
    description: description(r, plan),
    ...(url ? { url, '@id': url } : {}),
    touristType: 'Overland and rail travellers',
    itinerary: {
      '@type': 'ItemList',
      numberOfItems: plan.legs.length,
      itemListElement: plan.legs.map((entry, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        item: {
          '@type': 'TouristDestination',
          name: st(entry.toId) ? st(entry.toId).city : entry.toId,
          ...(st(entry.toId)
            ? { geo: { '@type': 'GeoCoordinates', latitude: st(entry.toId).lat, longitude: st(entry.toId).lon } }
            : {}),
        },
      })),
    },
    estimatedCost: {
      '@type': 'MonetaryAmount',
      currency: 'USD',
      value: Math.round(plan.totals.totalUsd),
    },
  })
}

/* Every page links to every other. Sixteen pages is small enough that a full
 * mesh is honest rather than a link farm, and it means a crawler landing on
 * any one of them can reach the whole set in a single hop. */
function related(current, pages) {
  const others = pages.filter(p => p.slug !== current.slug)
  return (
    `<nav class="more" aria-label="Other routes"><h2>Other routes on this network</h2><ul>` +
    others
      .map(p => `<li><a href="/${p.slug}">${esc(p.h1)}</a> <span>${esc(p.summary)}</span></li>`)
      .join('') +
    `</ul></nav>`
  )
}

function page({ r, plan, pages, css }) {
  const url = ORIGIN ? `${ORIGIN}/${r.slug}` : null
  const title = `${r.h1} — ${TITLE_SUFFIX}`
  const desc = description(r, plan)
  const t = plan.totals

  /* The app's own itinerary markup, rendered here instead of in a browser.
   *
   * In the app the panel is the whole document and its title is the h1. Here
   * the page has its own h1 above it, so every heading the panel emits drops
   * one level — two h1s on a page is a broken outline, and the one a search
   * engine would pick is not the one that names the route. */
  const body = demote(
    UI.itinerary(NETWORK, plan, r.from, r.to, {
      railOnly: false,
      date: '',
      nationality: '',
      stay: 'room',
      labels: null,
    })
  )

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
${url ? `<link rel="canonical" href="${esc(url)}">` : '<!-- no canonical: SITE_ORIGIN was not set at build time -->'}
<meta property="og:type" content="article">
<meta property="og:site_name" content="${esc(SITE_NAME)}">
<meta property="og:title" content="${esc(r.h1)}">
<meta property="og:description" content="${esc(desc)}">
${url ? `<meta property="og:url" content="${esc(url)}">` : ''}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(r.h1)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="theme-color" content="#0a191f" media="(prefers-color-scheme: dark)">
<meta name="theme-color" content="#d7e3e5" media="(prefers-color-scheme: light)">
<script type="application/ld+json">${jsonLd(r, plan, url)}</script>
<style>${css}</style>
</head>
<body class="doc">
<header class="topbar">
  <a class="brand" href="/"><span class="mark" aria-hidden="true"></span>
    <span class="brandtext">Overland<b>SEA</b></span></a>
  <p class="tagline">Rail-first journey planning across Southeast Asia</p>
</header>

<main class="docwrap">
  <article>
    <h1>${esc(r.h1)}</h1>
    <p class="lede">${esc(r.intent)}</p>
    <p class="facts">
      <b>${t.legs}</b> legs · <b>${t.days}</b> day${t.days === 1 ? '' : 's'} ·
      <b>${t.borders}</b> border${t.borders === 1 ? '' : 's'} ·
      about <b>$${Math.round(t.totalUsd)}</b> all in
    </p>
    <p class="plan-cta">
      <a class="cta" href="/#from=${esc(r.from)}&amp;to=${esc(r.to)}">Open this route in the planner</a>
      <span>Change the pace, the beds or the passport and the numbers follow.</span>
    </p>

    <div class="panel doc-panel">${body}</div>

    <p class="plan-cta">
      <a class="cta" href="/#from=${esc(r.from)}&amp;to=${esc(r.to)}">Plan your own version of this route</a>
    </p>
  </article>

  ${related(r, pages)}
</main>

<footer class="docfoot">
  <p>Overland SEA plans journeys that stay on rails as far as the rails go,
  put a boat where the land ends, and use a road vehicle only where neither
  exists. <a href="/">Open the planner</a>.</p>
</footer>
</body>
</html>
`
}

/* ------------------------------------------------------------------- run */

mkdirSync(OUT, { recursive: true })
const css = read('src/app.css') + '\n' + read('src/doc.css')

const built = []
const failed = []

// First pass: route everything, so each page can describe its neighbours.
for (const r of ROUTES) {
  const routed = Router.route(NETWORK, r.from, r.to, {})
  if (!routed) {
    failed.push([r.slug, 'no route'])
    continue
  }
  const plan = Plan.build(NETWORK, routed, {})
  built.push({
    ...r,
    plan,
    summary: `${plan.totals.legs} legs · ${plan.totals.days}d · $${Math.round(plan.totals.totalUsd)}`,
  })
}

for (const r of built) {
  writeFileSync(join(OUT, `${r.slug}.html`), page({ r, plan: r.plan, pages: built, css }))
}

/* robots.txt — the Sitemap line needs an absolute URL, so it only appears
 * when we actually know the host. */
writeFileSync(
  join(OUT, 'robots.txt'),
  `User-agent: *\nAllow: /\n${ORIGIN ? `\nSitemap: ${ORIGIN}/sitemap.xml\n` : ''}`
)

if (!ORIGIN) {
  // A sitemap left over from a build that did know the host would keep
  // advertising URLs on it long after this build stopped claiming them.
  rmSync(join(OUT, 'sitemap.xml'), { force: true })
} else {
  const urls = ['', ...built.map(r => r.slug)]
  writeFileSync(
    join(OUT, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
      urls
        .map(
          u =>
            `  <url><loc>${ORIGIN}/${u}</loc>` +
            `<changefreq>monthly</changefreq>` +
            `<priority>${u === '' ? '1.0' : '0.8'}</priority></url>`
        )
        .join('\n') +
      `\n</urlset>\n`
  )
}

console.log(`pages              ${built.length} route pages -> public/`)
if (failed.length) for (const [slug, why] of failed) console.log(`   skipped ${slug}: ${why}`)
console.log(
  ORIGIN
    ? `sitemap            ${built.length + 1} urls at ${ORIGIN}/sitemap.xml`
    : 'sitemap            skipped — set SITE_ORIGIN to emit canonical tags and a sitemap'
)
