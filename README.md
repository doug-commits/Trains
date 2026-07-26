# Overland SEA

A rail-first journey planner for Southeast Asia, drawn on a map.

Every mainstream trip planner optimises for **speed**, so it answers "how do I get
from Vientiane to Kuala Lumpur?" with a flight. This one optimises for
**continuity on the ground**: it keeps you on rails as far as the rails go, puts
a boat where the land ends, and uses a road vehicle only where neither exists.

Open `index.html` in a browser. There is no server, no build step needed to run
it, and no network request at runtime — the map geometry, the network data and
the typefaces all travel inside the page.

---

## What it actually does

The routing is the easy part. The graph of Southeast Asian railways is small
enough to hold in your head, and Dijkstra over a hundred and fifty edges is not
an achievement. The work is in **feasibility** — the reasons a route that looks
fine on a map fails in reality:

- **Connection buffers.** Every junction is measured against the rulebook in
  `src/plan.js`. A gap smaller than the minimum is not a connection, it is a
  missed train with a plausible-looking timetable behind it.
- **Border mechanics.** Which side stamps you, whether you stay on the train,
  whether your luggage comes off, what the visa position is, what cash you need
  on the far side, and the specific trap at each frontier.
- **The Padang Besar timezone trap.** SRT publishes departures there in Thai
  time; KTMB publishes the same platform in Malaysian time. Read both operators'
  sites and you build a connection exactly one hour different from reality.
- **Gauge breaks and city transfers.** Vientiane has two stations, 15 km apart,
  on two gauges, serving opposite directions. Getting this wrong ends trips.
- **Seasonality.** Songkran, Chinese New Year, Eid, Tết and the two monsoons
  make sleepers genuinely unobtainable rather than merely expensive.
- **Booking order.** Scarcest inventory first, not chronological. The shortest
  leg on the whole spine — five minutes across the Johor Strait — sells out
  before anything else.

### What it deliberately does not do

**It never gives you a departure time.** SRT, KTMB, LCR, DSVN and KAI publish
nothing in a common machine-readable format; there is no GTFS for most of this
network. A planner that recited remembered departure times would be confidently
wrong on a regular basis, and being confidently wrong is how someone ends up
stranded at Padang Besar overnight. So it gives you legs, operators, running
times, buffers and booking links, and tells you to read the real clock on the
operator's site.

Every leg carries a confidence label — **structural** (gauges, which stations
exist, who stamps where), **reported** (consistent across operator pages, Seat61
and Richard Barrow's Thai train guide), or **verify** (volatile, or known to
suspend). The third label is a feature. An itinerary that flags its two uncertain
legs is worth more than one that presents everything with false confidence.

---

## Layout

```
data/network.js      Stations, legs, borders, seasons, booking windows.
                     This is the product; everything else is plumbing.
data/basemap.json    Simplified SE Asia coastline, generated, committed.
src/proj.js          Web Mercator with a fitted, pannable viewport.
src/router.js        Rail-first Dijkstra. The cost function is the thesis.
src/plan.js          Feasibility: leg merging, buffers, risks, costs, booking order.
src/map.js           Canvas rendering.
src/ui.js            The itinerary document.
src/app.js           Controls, map interaction, URL state.
src/app.css          Styles.
src/fonts.css        Subset typefaces as data URIs, generated.
src/shell.html       Markup.
tools/               Build and data-generation scripts.
```

### Three ideas worth knowing before you edit

**A leg is one vehicle, not one hop.** The graph stores station-to-station
segments; `mergeSegments` in `src/plan.js` collapses consecutive segments that
share an operator and a service into the leg you actually book. Padang Besar to
KL Sentral is one ETS ticket, not five. Getting this wrong invents four
connections that do not exist and buries the two that do. If you add legs, set
`service` to the same string across everything that is genuinely one train.

**Substitute road time is charged at 3.5×, connectors at 1.5×.**
`src/router.js` weights road legs above their clock time, which is why the
planner will happily spend six extra hours on a train to avoid two on a coach.
But legs marked `essential` — a taxi across Vientiane, the bus to a pier, a
shuttle over a frontier bridge — are charged far less, because they are part of
the rail journey rather than an alternative to it. Get this wrong and the router
sends someone eight hundred kilometres the wrong way down a railway to dodge a
two-hour minivan. `essential` legs also survive hard rail-only mode, for the
same reason: excluding them would not route around the gap, it would just make
the journey impossible.

**Operator first, never an affiliate.** Every leg carries a booking route, and
`bookLine` in `src/ui.js` resolves it in one order: the operator's own site if
one genuinely exists and works from abroad, an aggregator only where it does
not, and an honest "pay at the pier" where there is nothing to book. There are
no affiliate links in this project and the output says so. If that ever changes
it has to be disclosed in the page, not just in a commit message.

`operators` in `data/network.js` covers named ferry and bus companies as well as
the railways — Lomprayah, ASDP, Giant Ibis, Green Bus and so on — because
"Ferry" in an operator column tells a traveller nothing. Each carries a `mono`
and a `livery` colour that render as a plate beside the leg. **These are our own
marks, not the operators' logos**: the logos are trademarks and redistributing
them inside a published page is not ours to do.

Never invent a booking URL to fill the column. `book: null` with a `bookNote`
saying how the ticket is really bought is worth more than a link that 404s, and
the smoke test enforces that every leg resolves to one of the three outcomes.

---

## Building

`index.html` and `dist/planner.html` are both generated. Edit the sources.

```sh
node tools/build.mjs      # sources -> index.html + dist/planner.html
node tools/smoke.mjs      # drive it in a real browser, write screenshots
```

The smoke test needs Playwright and fails on any console error, so run it before
committing. Screenshots land in `shots/`.

### Regenerating the data files

Both outputs are committed, so you only need these when the inputs change.

```sh
curl -sSL -o /tmp/world.geojson \
  https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson
node tools/build-basemap.mjs /tmp/world.geojson data/basemap.json

pip install fonttools brotli
python3 tools/build-fonts.py <dir-of-ttfs> src/fonts.css
```

---

## Sources and licences

Timetable and border facts are assembled per operator and cross-checked against
[Seat61](https://www.seat61.com/asia-trains.htm) and Richard Barrow's
[Thai Train Guide](https://www.thaitrainguide.com). Coastlines are
[Natural Earth](https://www.naturalearthdata.com) (public domain). Typefaces are
Barlow Condensed, Spectral and IBM Plex Mono, all SIL Open Font License 1.1.

Fares are indicative. Network last reviewed 2026-07. Verify anything
time-critical before booking — the `verify`-flagged legs first.
