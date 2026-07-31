# Play Store listing

The text of the listing, kept with the graphics it goes next to. Play has no
API in this project's build, so this is copied into the Console by hand — which
is exactly why it needs to live somewhere it can be reviewed and corrected
rather than being retyped from memory every release.

Every number below comes from `data/network.js`. If the network grows, these
change with it.

---

## App name (30 characters max)

```
Overland SEA
```

Matches `strings.xml`, so the launcher and the listing agree. 12 characters,
with room to spare — a name padded out to the limit with keywords is the
oldest tell in the store.

---

## Short description (80 characters max)

```
Southeast Asia by train and ferry, without flying. Works with no signal.
```

72 characters. This is the line that shows under the icon in search results,
so it says what the app is and the one thing that separates it from a website:
it works where you will be using it.

---

## Full description (4000 characters max)

```
Every mainstream journey planner optimises for speed, so it answers "Vientiane to Kuala Lumpur" with a flight. Overland SEA optimises for continuity on the ground: it keeps you on rails as far as the rails go, puts a boat where the land ends, and uses a road vehicle only where neither exists.

Pick two places. You get the legs in order, the operator running each one, how often it runs, roughly what it costs, and — the part that actually strands people — exactly what happens at every border in between.

WHAT YOU GET

• The route leg by leg: operator, service name, typical running time, indicative fare, and the stops along the way.
• How often each service runs. A missed connection on a train that goes eight times a day costs an hour. On one that runs twice a week it costs three days. That number is on every leg.
• Every border crossing in detail — where immigration is, whether you stay on the train, whether your luggage comes with you, what the queue depends on, what cash you need on the far side, and the traps. Padang Besar sits on two clocks: read both operators' sites and you will build a connection exactly one hour out, in the direction that makes you miss it.
• Where the route breaks, ranked by what actually ends trips rather than by probability, with what to do about each one.
• Connection buffers that hold, instead of the ones that merely look like they connect.
• What the journey costs against what the flight costs, said plainly. Sometimes the plane wins, and the app says so.
• Where you sleep, including the nights the route chooses for you and the ones you already paid for in a sleeper fare.
• Detours worth the extra days, when you have them.

IT WORKS WITH NO SIGNAL

The whole network is inside the app. It does not request internet permission at all — so it cannot phone home even by accident, and it works in full at a border post, on a ferry, or in a carriage somewhere between Chumphon and Hat Yai with no bars showing. The moment you most need to know whether a connection holds is the moment you have no way to look it up.

Nothing is collected. No account, no sign-in, no analytics, no advertising, no third-party SDK of any kind. It has no way to send anything anywhere.

WHAT IT COVERS

203 stations, piers and border posts across Thailand, Malaysia, Singapore, Laos, Cambodia, Vietnam, Indonesia, Myanmar, Brunei, the Philippines and southern China — 232 legs and 17 international crossings.

There is exactly one long continuous passenger rail spine in mainland Southeast Asia: Kunming to Vientiane, a taxi across Vientiane, then Nong Khai to Bangkok to Hat Yai to Padang Besar to Kuala Lumpur to JB Sentral to Singapore. Everything else is a branch or an island. Cambodia hangs off that spine at Aranyaprathet. Vietnam is a self-contained north-south line touching no neighbour's network. Indonesia is reachable only by sea. Myanmar is isolated. The app knows this, and will tell you when the honest answer is that there is no way through.

WHAT IT DELIBERATELY DOES NOT DO

It does not give departure times. SRT, KTMB, the Laos-China Railway, Vietnam Railways and KAI publish nothing in a common format, and a remembered departure is the fastest way to miss a train. You get the legs, the frequency and the operator's own booking page, and you read the real clock there.

It does not sell tickets. Each leg links to the operator who does.

Fares are indicative and the network carries the date it was last reviewed, so you can see for yourself how fresh the answer is.

Also at slowasia.com.
```

3,542 characters against a 4,000 limit, and the part people actually read —
what it is, and that it works with no signal — is in the first two paragraphs.

---

## Graphics

| Asset | File | Size |
| --- | --- | --- |
| Icon | `icon-512.png` | 512×512 |
| Feature graphic | `feature-graphic.png` | 1024×500 |
| Phone screenshots | `screenshot-1-map.png` … `screenshot-8-dark.png` | 1080×1920 |
| 7-inch tablet screenshots | `tablet7-1-map.png` … `tablet7-8-dark.png` | 1200×1920 |
| 10-inch tablet screenshots | `tablet10-1-map.png` … `tablet10-8-dark.png` | 2560×1600 |

All regenerated by `node tools/store-assets.mjs` (and `tools/store-icons.mjs`
for the icon) from the app itself, so they cannot drift from what someone
installs. Both stores' icons come out of that one command, from the geometry
in `tools/icon-art.mjs` — the Android launcher icon, this 512, and the App
Store's 1024 are one drawing rather than three.

Order matters — Play shows the first two or three in search results:

1. **map** — the app as it opens on an answer, route drawn across the region
2. **answer** — the headline and the four numbers: days, legs, borders, cost
3. **itinerary** — the legs, operators, running times, fares, changes
4. **borders** — Padang Besar in full, including the two-clock trap
5. **risks** — where this breaks, and what to do about it
6. **costs** — the total, and the honest comparison against flying
7. **sea** — Bangkok to Bali, rail and ferry end to end
8. **dark** — night mode, on the landing screen

Both tablet sets are the same eight, in the same order, each taken in the
layout that size of device actually gets.

**7-inch** — 600×960 dp at 2×, a Nexus 7. That is under the app's 60rem
breakpoint, so a 7-inch tablet in portrait gets the same full-screen map and
pull-up sheet a phone does.

**10-inch** — 1280×800 dp at 2×, landscape, which is how a tablet that size is
held. Over the breakpoint, so this is the app's other layout entirely: the map
across the frame with the itinerary in a column beside it rather than a sheet
over it. Worth its own pass — a stretched phone screenshot in that slot is the
usual reason a tablet listing looks like an afterthought.

---

## Data safety declaration

The app collects nothing and transmits nothing, and the manifest is the proof:
no `android.permission.INTERNET`. In the Console's Data safety form that is:

- Does your app collect or share any of the required user data types? **No**
- Is all of the user data collected by your app encrypted in transit? **N/A** —
  nothing is transmitted
- Do you provide a way for users to request that their data be deleted? **N/A** —
  nothing is held

Privacy policy URL: `https://slowasia.com/privacy`

## Category and contact

- Category: Travel & Local
- Contact email: `doug@mukbangshow.ae`
- Website: `https://slowasia.com`
