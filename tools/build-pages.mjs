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

import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = p => readFileSync(join(root, p), 'utf8')

// `??` not `||`: SITE_ORIGIN='' is an explicit "I do not know the host,
// emit nothing absolute", and an empty string is falsy. With `||` that
// instruction silently became the production domain.
const ORIGIN = (process.env.SITE_ORIGIN ?? 'https://slowasia.com').replace(/\/$/, '')

/* The fingerprint of the certificate Play signs the app with — not the upload
 * key, and not in this repository: it is printed in the Play Console under
 * Setup → App integrity. In the environment, like the affiliate ids, because
 * it belongs to the account rather than to a checkout.
 *
 * Checked here, before a single page is written, because the alternative is
 * finding out at the end of a build that is otherwise finished. */
const PLAY_SHA256 = (process.env.PLAY_SHA256 || '').trim().toUpperCase()
if (PLAY_SHA256 && !/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(PLAY_SHA256)) {
  console.error(
    `assetlinks         PLAY_SHA256 is not a SHA-256 fingerprint: ${PLAY_SHA256}\n` +
      '                   expected 32 hex pairs joined by colons, as the Play' +
      ' Console prints it'
  )
  process.exit(1)
}

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
  exists. <a href="/">Open the planner</a> · <a href="/support">Support</a> ·
  <a href="/privacy">Privacy</a>.</p>
</footer>`

/* The crossings a route passes through, linked out to their own pages.
 *
 * The itinerary already contains the full briefing for each one, so this is
 * not there to inform — it is there because "Poipet border crossing" is a
 * question people ask on its own, the answer has its own URL, and the pages
 * that ought to point at it are exactly the ones whose journeys go through
 * it. Built from the routed plan, so it cannot list a crossing the itinerary
 * above does not actually make. */
function crossingsOn(plan) {
  const on = plan.borders.filter(x => NETWORK.borders[x.id] && legsAcross(x.id).length)
  if (!on.length) return ''
  return `<nav class="more" aria-label="Border crossings on this route">
    <h2>The crossings on this route, in detail</h2><ul>` +
    on
      .map(x => `<li><a href="/${BORDER_SLUG(x.id)}">${esc(x.name)}</a>
        <span>${esc(x.countries)} · about ${x.minutes} min</span></li>`)
      .join('') +
    `</ul></nav>`
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
  /* The other ways round, costed here the same as in the planner.
   *
   * These pages are most of what anyone reads — a search lands on one of them,
   * not on the planner — so a feature that only existed behind the JavaScript
   * was a feature most readers never saw. The difference is what a choice can
   * do: this page is written around the recommended routing and cannot rewrite
   * itself, so each alternative links into the planner with the routing already
   * selected rather than offering a button nothing would answer. */
  const ways = [
    { plan, worseBy: 1, index: 0, current: true },
    ...Router.alternatives(NETWORK, r.from, r.to, {}, 2).map((alt, i) => ({
      plan: Plan.build(NETWORK, alt, {}),
      worseBy: alt.worseBy,
      index: i + 1,
      current: false,
    })),
  ]

  const body = demote(
    UI.itinerary(
      NETWORK,
      plan,
      r.from,
      r.to,
      {
        railOnly: false,
        date: '',
        nationality: '',
        stay: 'room',
        labels: null,
        planHref: `/#from=${encodeURIComponent(r.from)}&to=${encodeURIComponent(r.to)}`,
      },
      ways
    )
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
<link rel="manifest" href="/site.webmanifest">
<meta name="theme-color" content="#0a191f" media="(prefers-color-scheme: dark)">
<meta name="theme-color" content="#d7e3e5" media="(prefers-color-scheme: light)">
<script type="application/ld+json">${jsonLd(r, plan, url)}</script>
<style>${css}</style>
</head>
<body class="doc">
${APPBANNER}
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

  ${crossingsOn(plan)}
  ${related(r, pages)}
</main>

${DOCFOOT}
</body>
</html>
`
}

/* -------------------------------------------------------------- support */

/* Both stores want a support URL, and Apple will reject a placeholder or a
 * page that is obviously the privacy policy wearing a hat. Which is fair: a
 * support URL is a promise that somebody is at the other end of it.
 *
 * It is also the page that ought to exist anyway. This app answers questions
 * about a network that changes, and the two things a reader most often wants
 * — "why will it not tell me the departure time" and "this leg is wrong, who
 * do I tell" — have real answers that are nowhere else on the site. Half of
 * what follows is written specifically to turn a one-star review into an
 * email, which is the cheapest trade in the store.
 *
 * The reviewed date comes from the network rather than being typed, so the
 * page cannot claim the data is fresher than it is.
 */
function supportPage(css) {
  const url = ORIGIN ? `${ORIGIN}/support` : null
  const title = `Support — ${TITLE_SUFFIX}`
  const desc =
    'Help with Overland SEA: why it gives frequencies rather than departure ' +
    'times, how to report a leg that has changed, how current the network is, ' +
    'and how to get in touch.'
  const EMAIL = 'doug@mukbangshow.ae'

  const faqs = [
    ['It will not give me a departure time',
     `Deliberately, and it is the hardest thing to explain about the app.
      SRT, KTMB, the Laos–China Railway, Vietnam Railways and KAI publish
      nothing in a common format, and several of them change a timetable
      without announcing it. A departure time carried inside an app is a
      remembered time, and a remembered time is the fastest way to miss a
      train.
      <br><br>What you get instead is the thing that actually decides whether
      a plan survives: how often each service runs. A missed connection on a
      train that goes eight times a day costs an hour. On one that runs twice
      a week it costs three days. Take the legs to the operator's own booking
      page — linked on each one — and read the real clock there.`],

    ['Something is out of date, or plainly wrong',
     `Please tell me. This is a hand-built network and the corrections that
      arrive from people who have just made the journey are worth more than
      anything I can check from a desk.
      <br><br>The most useful report says which two stations, what the app
      claimed, what you found, and roughly when you were there. A photograph
      of a departure board or a ticket settles almost anything.
      <a href="mailto:${EMAIL}">${EMAIL}</a>.`],

    ['How current is this?',
     `The network was last reviewed <b>${esc(NETWORK.reviewed)}</b>, and the app
      shows that date at the foot of every itinerary rather than hiding it.
      <br><br>Every leg also carries how much it should be trusted.
      <b>Structural</b> means a physical or administrative fact — where a
      station is, which gauge, who stamps passports where — and those are
      stable for years. <b>Reported</b> means it agrees across the operator's
      own pages and the usual reliable sources. <b>Verify</b> means volatile or
      known to suspend, and those are the ones to confirm before you build a
      plan around them.`],

    ['Does it work without a signal?',
     `Entirely. The network, the map, the routing and every border briefing are
      inside the app; nothing is fetched while you use it. It works in flight
      mode at a frontier post, which is the situation it was built for.
      <br><br>The only things that need a connection are the outbound links —
      an operator's booking page, or a location in a maps app — and those open
      in your browser rather than in the app.`],

    ['Can I buy tickets in it?',
     `No, and it will not try to. Each leg links to whoever actually sells that
      ticket, which is usually the operator's own site. Where an operator
      genuinely cannot be booked from abroad, an aggregator is offered instead
      — and it is labelled as one.`],

    ['The prices look wrong',
     `They are indicative, and the app says so on every itinerary. Fares in the
      region move with fuel, season and class, and several operators price the
      same seat differently depending on where you buy it. Use the totals to
      compare one journey against another and against a flight; use the
      operator's site for what you will actually pay.`],

    ['It says there is no way through',
     `That is an answer rather than a failure. Myanmar has no through rail to
      Thailand. Vietnam's network touches no neighbour's. Indonesia is
      reachable only by sea. When the honest answer is that a journey cannot be
      made overland, the app says so and tells you where the gap is, instead of
      inventing a leg to fill it.`],

    ['The app and the website are not identical',
     `Correct, in two ways. The app leaves out the photographs, because the
      library is most of the download and the drawn artwork is the same
      artwork the site falls back to anyway. And it leaves out the links to
      the written-up route pages, which are separate documents on the website
      and would be dead ends inside a single bundled file. Every itinerary the
      two produce is the same itinerary — it is the same program.`],
  ]

  const body = `
  <section class="block">
    <h2>Getting in touch</h2>
    <p>One address, read by a person:
    <a href="mailto:${EMAIL}">${EMAIL}</a>. There is no ticket system and no
    form — it is a small project, and an email reaches me faster than either
    would.</p>
    <p>Corrections to the network are the most welcome kind of mail there is.
    If you have just crossed a border or ridden a leg and found it different
    from what the app said, that is worth more than any amount of desk
    research.</p>
  </section>

  <section class="block">
    <h2>Questions that come up</h2>
    ${faqs
      .map(
        ([q, a]) => `<article class="crossing">
          <header><h3>${esc(q)}</h3></header>
          <p>${a}</p>
        </article>`
      )
      .join('')}
  </section>

  <section class="block">
    <h2>Privacy</h2>
    <p>Nothing is collected — no account, no analytics, no advertising, and on
    Android no permission to reach the network at all. The
    <a href="/privacy">privacy policy</a> sets out exactly what that means on
    each platform, including the places the claim is weaker than it sounds.</p>
  </section>`

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
${url ? `<link rel="canonical" href="${esc(url)}">` : '<!-- no canonical: SITE_ORIGIN was not set at build time -->'}
<meta property="og:type" content="article">
<meta property="og:site_name" content="${esc(SITE_NAME)}">
<meta property="og:title" content="Support">
<meta property="og:description" content="${esc(desc)}">
${url ? `<meta property="og:url" content="${esc(url)}">` : ''}
<link rel="manifest" href="/site.webmanifest">
<meta name="theme-color" content="#0a191f" media="(prefers-color-scheme: dark)">
<meta name="theme-color" content="#d7e3e5" media="(prefers-color-scheme: light)">
<style>${css}</style>
</head>
<body class="doc">
${APPBANNER}
<header class="topbar">
  <a class="brand" href="/"><span class="mark" aria-hidden="true"></span>
    <span class="brandtext">Overland<b>SEA</b></span></a>
  <p class="tagline">Rail-first journey planning across Southeast Asia</p>
</header>

<main class="docwrap">
  <article>
    <h1>Support</h1>
    <p class="lede">Help with the app and the planner, and the answers to the
    questions that arrive most often — including the two that sound like faults
    and are not.</p>
    <p class="facts">
      Network reviewed <b>${esc(NETWORK.reviewed)}</b> ·
      <b>${Object.keys(NETWORK.stations).length}</b> stations ·
      <b>${Object.keys(NETWORK.borders).length}</b> crossings
    </p>

    <div class="panel doc-panel">${body}</div>
  </article>
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
const PRIVACY_UPDATED = '31 July 2026'

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

    <p>What it keeps on your phone: whether you chose the light or dark theme,
    whether you left the search panel folded, and the journey you last planned
    — the two stations and the trip settings beside them, so that closing the
    app and opening it again on a train with no signal returns you to what you
    were looking at rather than to the start. On the website only, it also
    remembers if you dismissed the strip offering the Android app, so that it
    does not ask twice.</p>

    <p>All of it is written to local storage on the device, none of it is sent
    anywhere, and it goes when you uninstall the app or clear its data. A
    journey is two station names and your own routing preferences; it is not a
    record of where you went, because nothing here knows where you went.</p>

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
    <h2>The iPhone and iPad app</h2>

    <p>Same program, same bundled data, the same handful of settings kept on
    the device, same absence of accounts, analytics, advertising identifiers
    and third-party code. What differs is one sentence of the guarantee above, and it differs
    enough to be worth spelling out rather than quietly reusing.</p>

    <div class="callout">
      <h3>iOS has no permission to withhold</h3>
      <p>Android lets an app decline the network outright, and the operating
      system then enforces it. iOS has no equivalent: an app either has network
      access or the platform assumes it might. So the promise here is one level
      down and narrower. The app makes no network calls of its own, and the web
      view it is built around runs under a WebKit content rule that refuses
      every load except from the app's own bundle — a tracking pixel or a
      remote font that somehow got into the page could not fetch, and neither
      could anything injected into it. That is enforced by WebKit rather than
      by the kernel. It is a good guarantee and it is not the same guarantee,
      and you should hold it as the weaker one.</p>
    </div>

    <p>Everything else reads across. Nothing is collected. Tapping an operator's
    booking site hands the address to Safari and the app stops being involved.
    And as on Android there is a channel that is not ours: if you have left
    Apple's analytics sharing on, iOS may send Apple crash reports for any app
    on the device. What we can see of that is aggregate stack traces in App
    Store Connect, with no identity attached.</p>
  </section>

  <section class="block">
    <h2>The website</h2>

    <p>No analytics, no tag manager, no advertising pixel, no consent banner —
    because there is nothing to consent to. The site sets no cookies of any
    kind.</p>

    <p>It stores the same theme and panel settings the app does, in your
    browser's local storage, plus a note of whether you dismissed the strip
    offering the Android app. It does not keep your last journey — the website
    holds that in the address bar, where your own history and bookmarks already
    keep it. Clearing site data for slowasia.com removes all of it.</p>

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
    <p>What is stored on your device is yours and is removed by uninstalling
    the app, clearing its data in Android's app settings, or clearing site data
    for slowasia.com in your browser.</p>
  </section>

  <section class="block">
    <h2>Changes</h2>
    <p>If either app ever gains the ability to send something — neither has
    any plans to — this page changes before that release ships, and the date
    below changes with it. On Android you would also see it: the permission
    appears at install time. On iOS you would not, which is the practical
    consequence of the difference described above and another reason to state
    it here rather than leave it implied. There is no mailing list, so this
    page is the notice.</p>
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
<link rel="manifest" href="/site.webmanifest">
<meta name="theme-color" content="#0a191f" media="(prefers-color-scheme: dark)">
<meta name="theme-color" content="#d7e3e5" media="(prefers-color-scheme: light)">
<style>${css}</style>
</head>
<body class="doc">
${APPBANNER}
<header class="topbar">
  <a class="brand" href="/"><span class="mark" aria-hidden="true"></span>
    <span class="brandtext">Overland<b>SEA</b></span></a>
  <p class="tagline">Rail-first journey planning across Southeast Asia</p>
</header>

<main class="docwrap">
  <article>
    <h1>Privacy</h1>
    <p class="lede">Overland SEA collects nothing about you. Here is what that
    means in each of the three places the name appears — the Android app, the
    iPhone app and the website — and where the edges of the claim are.</p>
    <p class="facts">
      <b>No</b> accounts · <b>No</b> analytics · <b>No</b> cookies ·
      <b>No</b> network access asked for, on either app
    </p>

    <div class="panel doc-panel">${body}</div>
  </article>
</main>

${DOCFOOT}
</body>
</html>
`
}

/* ------------------------------------------------------ border crossings */

/* The one thing this site holds that nobody else has written down in a
 * comparable form.
 *
 * "Is there a train through the Padang Besar border" and "Poipet scam" are
 * asked constantly and answered mostly by forum posts from 2016 and by blogs
 * that crossed once. The data behind these pages is the same briefing the
 * planner puts inside an itinerary — where immigration physically is, whether
 * you stay aboard, whether your luggage does, what the queue depends on, what
 * cash the far side wants and what the specific trap is — and it is worth its
 * own URL because that is the question people actually type.
 *
 * Not a template with the names swapped: every field is different per
 * crossing, and the surrounding material is computed — which services cross
 * here, who runs them, and which written-up journeys pass through. A crossing
 * with nothing but its own name would be a thin page, so one is not emitted.
 */

const COUNTRY = NETWORK.countryNames

// The planner's own rule, so the list it renders on the homepage and the files
// written here cannot disagree about where a crossing lives.
const BORDER_SLUG = UI.borderSlug

/* Whichever legs actually cross, in both directions. A crossing with no
 * service on it is a line on a map, not a journey. */
const legsAcross = id => NETWORK.legs.filter(l => l.border === id)

function borderPage({ id, b, uses, css }) {
  const url = ORIGIN ? `${ORIGIN}/${BORDER_SLUG(id)}` : null
  const [a, z] = String(b.countries).split('↔').map(s => s.trim())
  const h1 = `${b.name}: the ${a} to ${z} border crossing`
  const title = `${b.name} border crossing — ${TITLE_SUFFIX}`
  const desc = (
    `${b.name}, ${b.countries}. Where immigration is, whether you stay on board, ` +
    `luggage, visas, cash on the far side and about ${b.minutes} minutes of ` +
    `formalities — plus the trap that catches people here.`
  ).slice(0, 300)

  const crossing = legsAcross(id)
  const station = sid => NETWORK.stations[sid] || { name: sid }
  const opOf = k => NETWORK.operators[k] || { name: k }

  const rows = [
    ['Where', b.at],
    ['On the train?', b.stayOnTrain],
    ['Luggage', b.luggage],
    ['Visa', b.visa],
    ['Cash on the far side', b.cash],
    ['Time cost', `About ${b.minutes} minutes of formalities`],
  ]

  const legRow = l => {
    const op = opOf(l.op)
    return `<tr>
      <td><b>${esc(station(l.from).name)}</b> → <b>${esc(station(l.to).name)}</b>
        ${l.service ? `<em>${esc(l.service)}</em>` : ''}</td>
      <td>${esc(op.name)}</td>
      <td class="num-col">${UI.hours(l.hours)}</td>
      <td class="num-col">${UI.money(l.usd)}</td>
    </tr>`
  }

  const table = (legs, caption) => `<div class="table-wrap"><table class="route">
      <thead><tr><th>${caption}</th><th>Operator</th>
        <th class="num-col">Time</th><th class="num-col">Fare</th></tr></thead>
      <tbody>${legs.map(legRow).join('')}</tbody></table></div>`

  /* Operators on the crossing itself: how to buy, and whether the ticket is
     the hard part. On several of these it is — the frontier is trivial and the
     seat is not. */
  const opKeys = [...new Set(crossing.map(l => l.op))]
  const booking = opKeys
    .map(k => [k, opOf(k)])
    .filter(([, op]) => op.bookNote || op.punctual)
    .map(([, op]) => `<p><b>${esc(op.name)}.</b> ${esc(op.bookNote || '')}${
      op.punctual ? ` Punctuality: ${esc(op.punctual)}.` : ''}</p>`)
    .join('')

  const scarce = NETWORK.scarcity
    .filter(x => opKeys.includes(x.op))
    .map(x => `<div class="callout"><h3>${esc(x.service || opOf(x.op).name)} sells out</h3>
      <p>${esc(x.why)} <b>Booking window:</b> ${esc(x.window)}</p></div>`)
    .join('')

  /* An advisory attaches to the leg, not the frontier — the Sungai Kolok
     crossing is unremarkable in itself and the provinces it sits in are not. */
  const advisories = [...new Set(crossing.map(l => l.advisory).filter(Boolean))]
    .map(k => `<div class="callout alert"><h3>Security advisory</h3>
      <p>${esc(NETWORK.advisories[k])}</p></div>`)
    .join('')

  /* Each side of the frontier, and how you reach it. "How do I get to Padang
     Besar" is the other half of the question and is nowhere on this site
     otherwise — the itinerary pages answer it only for the journeys that
     happen to be written up. */
  const sides = [...new Set(crossing.flatMap(l => [l.from, l.to]))]
    .map(sid => {
      const st = station(sid)
      const feeders = NETWORK.legs
        .filter(l => (l.from === sid || l.to === sid) && l.border !== id)
        // The long-distance services first: those are the ones you plan around.
        .sort((x, y) => y.hours - x.hours)
        .slice(0, 6)
      return `<article class="crossing">
        <header>
          <h3>${esc(st.name)}</h3>
          <span class="countries">${esc(COUNTRY[st.country] || st.country || '')}</span>
        </header>
        ${st.warn ? `<p class="trap"><b>Worth knowing.</b> ${esc(st.warn)}</p>` : ''}
        ${feeders.length
          ? table(feeders, 'Reached by')
          : '<p>Nothing else on this network serves it directly.</p>'}
      </article>`
    })
    .join('')

  const journeys = uses.length
    ? `<ul>${uses
        .map(r => `<li><a href="/${r.slug}">${esc(r.h1)}</a> <span>${esc(r.summary)}</span></li>`)
        .join('')}</ul>`
    : `<p>No written-up journey on this site crosses here yet — but the planner
       will route you through it.</p>`

  const body = `
  <section class="block">
    <h2>How the crossing works</h2>
    <article class="crossing${b.hard ? ' hard' : ''}">
      <header>
        <h3>${esc(b.name)}</h3>
        <span class="countries">${esc(b.countries)}</span>
      </header>
      <dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
      <p class="trap"><b>The trap.</b> ${esc(b.trap)}</p>
    </article>
    ${b.hard
      ? `<p class="sub">This is one of the crossings marked hard on this network:
         it defeats people often enough that the router treats it as a real
         obstacle rather than a formality, and it usually defeats them on
         documents rather than on logistics.</p>`
      : ''}
    ${b.verify
      ? `<p class="sub">The position here moves. Confirm it against the operator
         and your own government's current advice before you book anything that
         depends on it.</p>`
      : ''}
    ${advisories}
  </section>

  <section class="block">
    <h2>What crosses here</h2>
    ${crossing.length
      ? table(crossing, 'Service') +
        `<p class="sub">Typical scheduled running time for the crossing leg itself,
         which does not include the ${b.minutes} minutes of formalities above.
         Allow for both when you are working out whether a connection holds.
         Fares are indicative.</p>`
      : '<p>Nothing scheduled crosses here on this network.</p>'}
    ${booking}
    ${scarce}
  </section>

  <section class="block">
    <h2>Getting to each side</h2>
    <p class="sub">The frontier is rarely the problem. Reaching it on a day when
    something onward is still running usually is.</p>
    ${sides}
  </section>

  <section class="block">
    <h2>Journeys through ${esc(b.name)}</h2>
    <p class="sub">Written up in full, each with this crossing in its proper place
    in the itinerary rather than as a footnote.</p>
    ${journeys}
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
<meta property="og:title" content="${esc(h1)}">
<meta property="og:description" content="${esc(desc)}">
${url ? `<meta property="og:url" content="${esc(url)}">` : ''}
<link rel="manifest" href="/site.webmanifest">
<meta name="theme-color" content="#0a191f" media="(prefers-color-scheme: dark)">
<meta name="theme-color" content="#d7e3e5" media="(prefers-color-scheme: light)">
<style>${css}</style>
</head>
<body class="doc">
${APPBANNER}
<header class="topbar">
  <a class="brand" href="/"><span class="mark" aria-hidden="true"></span>
    <span class="brandtext">Overland<b>SEA</b></span></a>
  <p class="tagline">Rail-first journey planning across Southeast Asia</p>
</header>

<main class="docwrap">
  <article>
    <h1>${esc(h1)}</h1>
    <p class="lede">${esc(b.stayOnTrain.startsWith('No')
      ? `You change here rather than crossing aboard, and you should budget about ${b.minutes} minutes for the formalities on top of the journey either side.`
      : `About ${b.minutes} minutes of formalities between ${a} and ${z}, and this is one of the frontiers you can cross without abandoning your seat.`)}</p>
    <p class="facts">
      <b>${esc(b.countries)}</b> · about <b>${b.minutes}</b> minutes ·
      <b>${crossing.length}</b> service${crossing.length === 1 ? '' : 's'} ·
      <b>${uses.length}</b> written-up journey${uses.length === 1 ? '' : 's'}
    </p>

    <div class="panel doc-panel">${body}</div>

    <p class="plan-cta">
      <a class="cta" href="/">Plan a journey through it</a>
      <span>Pick two places and the crossing appears in the itinerary, with the
      buffer it needs.</span>
    </p>
  </article>

  <nav class="more" aria-label="Other border crossings">
    <h2>Every crossing on this network</h2>
    <ul>${CROSSINGS.filter(c => c.id !== id)
      .map(c => `<li><a href="/${BORDER_SLUG(c.id)}">${esc(c.b.name)}</a>
        <span>${esc(c.b.countries)}</span></li>`)
      .join('')}</ul>
  </nav>
</main>

${DOCFOOT}
</body>
</html>
`
}

/* ------------------------------------------------------------------- run */

mkdirSync(OUT, { recursive: true })
const css = read('src/app.css') + '\n' + read('src/doc.css')

/* The same strip the planner carries, and these pages are where it matters
 * more: a guide page is where a search lands, and someone reading how the
 * Nong Khai crossing works on a phone is exactly who wants it offline. */
const APPBANNER = read('src/appbanner.html')

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

/* A crossing earns a page if there is something to say beyond its name: a
 * service that actually runs across it, and a trap worth warning about. Every
 * one of the seventeen currently clears that, but the rule is the point — the
 * moment a frontier is added to the network with a stub of a briefing, it
 * should not quietly become a page. */
const CROSSINGS = Object.entries(NETWORK.borders)
  .filter(([id, b]) => b.trap && legsAcross(id).length)
  .map(([id, b]) => ({
    id,
    b,
    // Which written-up journeys pass through here. Read off the routed plans
    // rather than a hand-kept list, so a new guide appears on the crossings it
    // uses without anyone remembering to add it.
    uses: built.filter(r => r.plan.borders.some(x => x.id === id)),
  }))

for (const c of CROSSINGS) {
  writeFileSync(join(OUT, `${BORDER_SLUG(c.id)}.html`), borderPage({ ...c, css }))
}

writeFileSync(join(OUT, 'support.html'), supportPage(css))
writeFileSync(join(OUT, 'privacy.html'), privacyPage(css))

/* ------------------------------------------------ the app, from the site */

/* Two files that exist for one question: is the Android app already on this
 * phone? Without them the install strip asks everybody, including the people
 * who already said yes — which is the fastest way to make a useful offer feel
 * like an advertisement.
 *
 * navigator.getInstalledRelatedApps() answers it, and only answers it when the
 * site and the app each vouch for the other. This is the site's half:
 *
 *   site.webmanifest          names the app the site claims as its own
 *   .well-known/assetlinks.json   names the app allowed to claim the site
 *
 * The app's half is in android/app/src/main/res/values/strings.xml. Both
 * halves, or the browser reports nothing and the strip simply carries on
 * asking — which is the failure this degrades to, and it is the harmless one. */

const PLAY_PACKAGE = 'com.overlandsoutheastasia'

writeFileSync(
  join(OUT, 'site.webmanifest'),
  JSON.stringify(
    {
      name: SITE_NAME,
      short_name: 'Overland SEA',
      description: 'Rail-first journey planning across Southeast Asia.',
      start_url: '/',
      /* Not "standalone". A manifest is being added here to answer one
         question, not to turn the site into an installable web app: there is
         no service worker, so an installed copy would be a browser window with
         the address bar taken away and no offline story — which is the app's
         whole point and would be a worse version of it. */
      display: 'browser',
      theme_color: '#0a191f',
      background_color: '#0a191f',
      icons: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      ],
      related_applications: [
        {
          platform: 'play',
          id: PLAY_PACKAGE,
          url: `https://play.google.com/store/apps/details?id=${PLAY_PACKAGE}`,
        },
      ],
      // Says which one to offer if a browser ever offers either. It is the
      // native app: it holds the whole network offline and the site cannot.
      prefer_related_applications: true,
    },
    null,
    2
  ) + '\n'
)

cpSync(join(root, 'web/icon-192.png'), join(OUT, 'icon-192.png'))
cpSync(join(root, 'web/icon-512.png'), join(OUT, 'icon-512.png'))

/* The fingerprint is of the certificate Play signs the app with, which is not
 * the upload key and is not in this repository — it is printed in the Play
 * Console under App integrity. It goes in the environment, like the affiliate
 * ids, because it is per-account rather than per-checkout.
 *
 * Unset, no file is written. Google caches a rejected assetlinks.json, so a
 * placeholder would be worse than an absence: the absence degrades to "the
 * strip asks everybody", and a wrong fingerprint degrades to the same thing
 * plus a cache to wait out. Malformed is a build failure rather than a warning
 * for exactly that reason — it is not a mistake worth deploying. */
const wellKnown = join(OUT, '.well-known')
let assetLinks = 'not written — PLAY_SHA256 is not set'
if (PLAY_SHA256) {
  mkdirSync(wellKnown, { recursive: true })
  writeFileSync(
    join(wellKnown, 'assetlinks.json'),
    JSON.stringify(
      [
        {
          /* Only this one relation. `handle_all_urls` is what App Links use to
             let an app open the site's URLs instead of the browser, and this
             app has no intent filter that claims them — so nothing about
             tapping a slowasia.com link changes. The statement is here to be
             the association, not to redirect anyone. */
          relation: ['delegate_permission/common.handle_all_urls'],
          target: {
            namespace: 'android_app',
            package_name: PLAY_PACKAGE,
            sha256_cert_fingerprints: [PLAY_SHA256],
          },
        },
      ],
      null,
      2
    ) + '\n'
  )
  assetLinks = `${PLAY_PACKAGE} ${PLAY_SHA256.slice(0, 11)}…`
} else {
  // A stale one from a build that did have the fingerprint would keep
  // vouching for a signing key this build cannot confirm.
  rmSync(wellKnown, { recursive: true, force: true })
}

// Declared out here only so the summary below can count what was written
// rather than recomputing it and drifting — which it had, silently.
let urls = []

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
  urls = [
    '',
    ...built.map(r => r.slug),
    ...CROSSINGS.map(c => BORDER_SLUG(c.id)),
    'support',
    'privacy',
  ]
  const priority = u => (u === '' ? '1.0' : u === 'privacy' || u === 'support' ? '0.3' : '0.8')
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

console.log(`pages              ${built.length} route pages, ${CROSSINGS.length} crossings, support + privacy -> public/`)
if (failed.length) for (const [slug, why] of failed) console.log(`   skipped ${slug}: ${why}`)
console.log(
  ORIGIN
    ? `sitemap            ${urls.length} urls at ${ORIGIN}/sitemap.xml`
    : 'sitemap            skipped — set SITE_ORIGIN to emit canonical tags and a sitemap'
)
console.log(`manifest           site.webmanifest, related app ${PLAY_PACKAGE}`)
console.log(`assetlinks         ${assetLinks}`)
