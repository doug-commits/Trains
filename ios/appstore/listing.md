# App Store listing

The twin of `android/play/listing.md`, and different where the two stores are
different rather than where I felt like writing it differently. Apple asks for
a subtitle and keywords that Play does not, caps the description at the same
4,000, and reads a review note that Play has no equivalent of — and that note
is the most load-bearing text in this file. See the last section.

Every number below comes from `data/network.js`.

---

## App name (30 characters max)

```
Overland SEA
```

Matches `CFBundleDisplayName`, the Android listing, and the wordmark. Twelve
characters. The store search algorithm weights the name heavily and the
temptation is to pad it to "Overland SEA: Train & Ferry" — but a padded name
is the oldest tell there is, and the subtitle and keyword fields exist for
exactly that job without spending the name on it.

---

## Subtitle (30 characters max)

```
Southeast Asia without flying
```

29 characters. Shown under the name in search results and on the product page,
and indexed for search alongside the name — so it earns its place twice.

---

## Promotional text (170 characters max)

```
Rail as far as the rails go, a boat where the land ends. 203 stations, 17 border crossings, every one spelled out. Works in flight mode, which is where you need it.
```

166 characters. This is the one field Apple lets you change without submitting
a new build, which makes it the right home for anything seasonal or newly
added — a new corridor, a railway that opened. Keep the durable claims in the
description below.

---

## Keywords (100 characters max, comma-separated, no spaces after commas)

```
train,rail,ferry,sleeper,backpacking,thailand,vietnam,laos,malaysia,cambodia,indonesia,border,slow
```

98 characters. Rules that are easy to get wrong and cost nothing to obey:
never repeat a word already in the name or subtitle (they are indexed anyway,
and a repeat wastes the budget); singular only, since Apple stems them; no
spaces after the commas, which count.

---

## Description (4000 characters max)

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

IT WORKS IN FLIGHT MODE

The whole thing is inside the app — the network, the map, the routing, the border briefings. Nothing is fetched while you use it, so it works in full at a frontier post, on a ferry, or in a carriage somewhere between Chumphon and Hat Yai with no bars showing. The moment you most need to know whether a connection holds is the moment you have no way to look it up.

Nothing is collected. No account, no sign-in, no analytics, no advertising, no third-party SDK of any kind.

WHAT IT COVERS

203 stations, piers and border posts across Thailand, Malaysia, Singapore, Laos, Cambodia, Vietnam, Indonesia, Myanmar, Brunei, the Philippines and southern China — 232 legs and 17 international crossings.

There is exactly one long continuous passenger rail spine in mainland Southeast Asia: Kunming to Vientiane, a taxi across Vientiane, then Nong Khai to Bangkok to Hat Yai to Padang Besar to Kuala Lumpur to JB Sentral to Singapore. Everything else is a branch or an island. Cambodia hangs off that spine at Aranyaprathet. Vietnam is a self-contained north-south line touching no neighbour's network. Indonesia is reachable only by sea. Myanmar is isolated. The app knows this, and will tell you when the honest answer is that there is no way through.

WHAT IT DELIBERATELY DOES NOT DO

It does not give departure times. SRT, KTMB, the Laos-China Railway, Vietnam Railways and KAI publish nothing in a common format, and a remembered departure is the fastest way to miss a train. You get the legs, the frequency and the operator's own booking page, and you read the real clock there.

It does not sell tickets. Each leg links to the operator who does.

Fares are indicative and the network carries the date it was last reviewed, so you can see for yourself how fresh the answer is.

Also at slowasia.com.
```

---

## URLs and metadata

- **Privacy policy:** `https://slowasia.com/privacy`
- **Support URL:** `https://slowasia.com/privacy` — Apple requires a support URL
  and will reject a placeholder. The privacy page carries a contact address, so
  it satisfies the requirement honestly until there is a page worth pointing at.
- **Marketing URL:** `https://slowasia.com`
- **Primary category:** Travel
- **Secondary category:** Navigation
- **Age rating:** 4+. No user-generated content, no ads, no purchases, no
  location, and the only outbound links are to transport operators.
- **Copyright:** the year and the entity that owns the account.
- **Contact:** `doug@mukbangshow.ae`

## App Privacy ("Data Not Collected")

Apple's questionnaire is answered in one click here, and it is the true answer
rather than the convenient one: **Data Not Collected**, for every category.

The app has no account, no analytics, no advertising identifier, no third-party
SDK, and makes no network requests. If you have left Apple's own analytics
sharing on at the system level, iOS may send Apple crash reports for any app on
your device — that is Apple's channel, not ours, and it is explicitly outside
the scope of this questionnaire.

## Encryption

`ITSAppUsesNonExemptEncryption` is already `false` in `Info.plist`, so the
export-compliance question does not appear on every upload. That is accurate:
the app uses no encryption at all, not even HTTPS, because it makes no requests.

---

## Screenshots

| Slot | Files | Size |
| --- | --- | --- |
| iPhone 6.9" | `ios-iphone-1-map.png` … `ios-iphone-8-dark.png` | 1320×2868 |
| iPad 13" | `ios-ipad-1-map.png` … `ios-ipad-8-dark.png` | 2064×2752 |

Both required; Apple derives the smaller sizes from these unless you override
them. Rendered by `node tools/store-assets.mjs` from the running app, the same
pass that produces the Play sets, so the two stores cannot end up showing
different products.

The iPad set is the wide layout — map across the frame with the itinerary in a
column beside it — because at 1032 points that is genuinely what an iPad shows.
A stretched iPhone screenshot in that slot is the usual reason an iPad listing
looks like an afterthought.

Order, and why: the first two or three are what appear in search results.

1. **map** — the app as it opens on an answer, route drawn across the region
2. **answer** — the headline and the four numbers: days, legs, borders, cost
3. **itinerary** — the legs, operators, running times, fares, changes
4. **borders** — Padang Besar in full, including the two-clock trap
5. **risks** — where this breaks, and what to do about it
6. **costs** — the total, and the honest comparison against flying
7. **sea** — Bangkok to Bali, rail and ferry end to end
8. **dark** — night mode, on the landing screen

## Icon

`ios/Overland/Resources/Assets.xcassets/AppIcon.appiconset/icon-1024.png`,
rendered by `node tools/store-icons.mjs` from the same geometry as the Android
launcher icon. No alpha channel, which Apple rejects; nothing is transparent, so
there is none to strip.

---

## Notes for App Review

The most important text here, and the one nobody reads until a rejection
arrives. Paste this into the "Notes" field of the submission.

The risk is **Guideline 4.2 — Minimum Functionality**, which exists to keep
repackaged websites out of the store, and which a WKWebView-based app will be
looked at for. The defence is not a plea, it is a fact about the binary, and it
is checkable in about thirty seconds by the reviewer:

```
This app is not a wrapper around a website. The entire product — the rail and
ferry network, the map, the routing engine, the border briefings and the
costings — is compiled into the binary. It makes no network requests at all.

The quickest way to confirm this: put the device in Airplane Mode and use the
app normally. Plan Bangkok to Singapore, open the itinerary, read the border
crossing detail, change the pace and the passport and watch the numbers
recompute. Everything works, because nothing is being fetched.

The web view is an implementation detail of the rendering, not a browser
pointed at a server. It loads from a custom URL scheme served out of the app
bundle, and a WebKit content rule list blocks every load that does not come
from that bundle — so it cannot reach the network even if something in the
page tried to.

The only outbound links are to transport operators' own booking pages (State
Railway of Thailand, KTMB, Vietnam Railways and so on) and to Apple Maps or a
browser for a location. Those open in Safari rather than in the app, so it is
always clear whose site the traveller is on.

The offline behaviour is the product. This is used at land border crossings and
on overnight trains across Southeast Asia, which is precisely where there is no
signal and where a website is useless.
```

Two further things worth knowing before the first submission:

- Apple's review looks for the app to be useful without an account. It has no
  account, so this is free.
- There is no sign-in, no purchase and no subscription, so none of the
  associated review requirements apply. The demo-account fields stay empty.
