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
 *   SITE_ORIGIN=https://preview.example.com node tools/build-pages.mjs
 *
 * The origin defaults to the live domain. Override it for preview builds — a
 * preview that canonicalises itself to production is telling Google to index
 * a page it did not just crawl, and a canonical pointing at the wrong host is
 * worse than none at all. Setting it empty drops canonical and sitemap
 * entirely, which is the right answer when the host is genuinely unknown.
 */

import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = p => readFileSync(join(root, p), 'utf8')

// `??` not `||`: SITE_ORIGIN='' is an explicit "I do not know the host,
// emit nothing absolute", and an empty string is falsy. With `||` that
// instruction silently became the production domain.
const ORIGIN = (process.env.SITE_ORIGIN ?? 'https://slowasia.com').replace(/\/$/, '')

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

/* Shared by every page here, so the privacy policy is reachable from anywhere
 * on the site rather than only from the Play listing that is obliged to carry
 * a link to it. */
const DOCFOOT = `<footer class="docfoot">
  <p>Overland SEA plans journeys that stay on rails as far as the rails go,
  put a boat where the land ends, and use a road vehicle only where neither
  exists. <a href="/">Open the planner</a> · <a href="/privacy">Privacy</a>.</p>
</footer>`

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

${DOCFOOT}
</body>
</html>
`
}

/* ------------------------------------------------------- privacy policy */

/* Play will not take a submission without one of these at a public URL, which
 * is why it exists — but the reason it can be this short is that the app was
 * built without a network permission in the first place. Everything below is
 * checkable against the repository rather than a promise: the manifest, the
 * dependency list and the two storage keys are all in the source, and
 * tools/smoke.mjs fails the build if the page starts claiming something the
 * code stopped doing.
 *
 * Dates are written out rather than taken from the clock: a policy whose
 * effective date silently moves on every deploy is a policy nobody can cite. */
const PRIVACY_UPDATED = '29 July 2026'

function privacyPage(css) {
  const url = ORIGIN ? `${ORIGIN}/privacy` : null
  const title = `Privacy — ${TITLE_SUFFIX}`
  const desc =
    'Overland SEA collects nothing. The Android app has no internet permission ' +
    'at all; the website sets no cookies and runs no analytics. What is stored, ' +
    'where, and the few exceptions — in full.'

  const body = `
  <section class="block">
    <h2>The short version</h2>
    <p>There is no account to make, no form that submits anywhere, and no
    server behind the planner to submit to. Where you are going, when, and
    which passport you carry are worked out on the device you typed them
    into. We do not know who you are and have not built anything capable of
    finding out.</p>
    <p>The rest of this page is the long version, because "we value your
    privacy" is what every page says and the only useful form of the claim is
    the checkable one.</p>
  </section>

  <section class="block">
    <h2>The Android app</h2>

    <div class="callout">
      <h3>It has no internet permission</h3>
      <p>Not "we choose not to send anything" — the app does not request
      <code>android.permission.INTERNET</code>, so Android will not let it open
      a network connection at all, including by accident and including if a
      future bug tried to. The rail network, the map, the photographs and the
      routing are all inside the installed package. That is also why it works
      in flight mode at a border with no signal, which is the point of it.</p>
    </div>

    <p>What it keeps on your phone: two settings — whether you chose the light
    or dark theme, and whether you left the search panel folded. They are
    written to the app's own local storage on the device, are never sent
    anywhere, and go when you uninstall the app or clear its data.</p>

    <p>What it does not have: any account or sign-in, your email address, your
    location, your contacts, an advertising identifier, an analytics library,
    or a crash-reporting library. Its only dependencies are two of Google's own
    AndroidX components, WebView and AppCompat. There is no third-party SDK in
    the build.</p>

    <p>When you tap an operator's booking site or "open in maps", the app hands
    that address to whichever browser or maps app you have and stops being
    involved. From that moment you are on someone else's site under their
    policy.</p>

    <p>One thing that is not ours to switch off: if you have left Google Play's
    automatic crash reporting on at the system level, Android may send Google a
    crash or ANR report for any app on your phone, this one included. We did not
    build that channel and cannot see into it. What reaches us is the aggregate
    view in the Play Console — stack traces and device models, with no identity
    attached to them.</p>
  </section>

  <section class="block">
    <h2>The website</h2>

    <p>No analytics, no tag manager, no advertising pixel, no consent banner —
    because there is nothing to consent to. The site sets no cookies of any
    kind.</p>

    <p>It stores the same two settings the app does, in your browser's local
    storage, and nothing else. Clearing site data for slowasia.com removes
    them.</p>

    <p>Fonts and photographs are served from slowasia.com itself rather than
    from Google Fonts or a CDN, so opening a page here does not announce your
    visit to a third party as a side effect of loading the design.</p>

    <p>The route you plan lives in the part of the address after the
    <code>#</code>. Browsers do not send that fragment to the server, so an
    itinerary link you share carries the journey and reaches only the person
    you send it to.</p>

    <p>The site is hosted on Vercel, and like any web server its edge records
    requests as they arrive: IP address, time, the address requested, the
    browser's user-agent string. That is what serving a page and absorbing
    abuse requires. We do not build profiles from those logs, do not use them
    for advertising, and do not combine them with anything else. Vercel handles
    them as our hosting provider under its own privacy terms.</p>
  </section>

  <section class="block">
    <h2>What you type into the planner</h2>
    <p>The origin and destination, the departure date, the passport
    nationality, the pace and the choice of beds are all read by code running
    on your own device and are used to pick which legs, which visa notes and
    which prices to show you. None of it is transmitted, because there is no
    endpoint to transmit it to — the planner is a static document. The passport
    field in particular exists only to decide which border notes apply to you,
    and never leaves the device.</p>
  </section>

  <section class="block">
    <h2>Links to other people</h2>
    <p>Operator booking sites, Seat61 and Google Maps are ordinary links. Your
    browser tells those sites what it tells every site you visit; we pass them
    nothing about you.</p>
    <p>Two links are affiliate links, marked as such in the page's own markup
    with <code>rel="sponsored"</code>: accommodation search on Booking.com, and
    travel insurance from SafetyWing. If you follow one, that company can tell
    the referral came from Overland SEA, and if you go on to buy something they
    may pay us a commission. We are not told who you are, what you booked or
    what you paid — a commission report is a number, not a name. Nothing about
    the itinerary changes if you ignore them, and it costs you nothing either
    way.</p>
  </section>

  <section class="block">
    <h2>Things we do not do</h2>
    <ul class="warns">
      <li>Sell, rent or share personal data. There is none to sell.</li>
      <li>Build a profile of you, on this site or across others.</li>
      <li>Show you advertising, or let anyone else show you advertising here.</li>
      <li>Track you between the app and the website. They do not know about
      each other.</li>
      <li>Email you. There is no mailing list and no box to join one.</li>
    </ul>
  </section>

  <section class="block">
    <h2>Children</h2>
    <p>This is a travel planner, not directed at children. It collects nothing
    from anybody, which includes collecting nothing from them.</p>
  </section>

  <section class="block">
    <h2>Your rights, and the honest version of them</h2>
    <p>Data protection law — the GDPR, the UK GDPR, the CCPA and their
    equivalents — gives you the right to ask what a company holds about you, to
    have it corrected, and to have it deleted. We hold nothing about you, so
    there is nothing for such a request to return. That is not a way of
    declining: it is what "collects nothing" means when you follow it to the
    end.</p>
    <p>The two settings on your device are yours and are removed by uninstalling
    the app, clearing its data in Android's app settings, or clearing site data
    for slowasia.com in your browser.</p>
  </section>

  <section class="block">
    <h2>Changes</h2>
    <p>If the app ever gains the ability to send something — it has no plans
    to, and gaining one would mean adding a permission you would see at
    install time — this page changes before that release ships, and the date
    below changes with it. There is no mailing list, so this page is the
    notice.</p>
    <p>Last updated ${PRIVACY_UPDATED}.</p>
  </section>

  <section class="block">
    <h2>Contact</h2>
    <p>Questions about any of this, including anything above you would like
    shown rather than asserted: <a href="mailto:doug@mukbangshow.ae">doug@mukbangshow.ae</a>.</p>
  </section>`

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
<meta property="og:title" content="Privacy">
<meta property="og:description" content="${esc(desc)}">
${url ? `<meta property="og:url" content="${esc(url)}">` : ''}
<meta name="theme-color" content="#0a191f" media="(prefers-color-scheme: dark)">
<meta name="theme-color" content="#d7e3e5" media="(prefers-color-scheme: light)">
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
    <h1>Privacy</h1>
    <p class="lede">Overland SEA collects nothing about you. Here is what that
    means in each place the name appears, and where the edges of the claim
    are.</p>
    <p class="facts">
      <b>No</b> accounts · <b>No</b> analytics · <b>No</b> cookies ·
      <b>No</b> internet permission in the app
    </p>

    <div class="panel doc-panel">${body}</div>
  </article>
</main>

${DOCFOOT}
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

writeFileSync(join(OUT, 'privacy.html'), privacyPage(css))

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
  // Privacy last and lowest: it belongs in the sitemap because it is a real
  // page a crawler should be able to find, not because anyone searches for it.
  const urls = ['', ...built.map(r => r.slug), 'privacy']
  const priority = u => (u === '' ? '1.0' : u === 'privacy' ? '0.3' : '0.8')
  writeFileSync(
    join(OUT, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
      urls
        .map(
          u =>
            `  <url><loc>${ORIGIN}/${u}</loc>` +
            `<changefreq>monthly</changefreq>` +
            `<priority>${priority(u)}</priority></url>`
        )
        .join('\n') +
      `\n</urlset>\n`
  )
}

console.log(`pages              ${built.length} route pages + privacy -> public/`)
if (failed.length) for (const [slug, why] of failed) console.log(`   skipped ${slug}: ${why}`)
console.log(
  ORIGIN
    ? `sitemap            ${built.length + 1} urls at ${ORIGIN}/sitemap.xml`
    : 'sitemap            skipped — set SITE_ORIGIN to emit canonical tags and a sitemap'
)
