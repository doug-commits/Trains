/* Turning a sentence into two stations.
 *
 * "How do I get from Angkor Wat to Ha Long Bay?" has to become sisophon →
 * catba, and the traveller has to be able to see that is what happened —
 * because Angkor is a two-hour drive from the nearest track and silently
 * routing them to Sisophon without saying so would be a trap.
 *
 * No network and no model: a gazetteer plus scored fuzzy matching. That keeps
 * the answer identical offline, on a Vercel deploy, and on a train in Laos.
 */

const Ask = (() => {
  /* Vietnamese and Lao names are full of diacritics that nobody types, and đ
   * is a distinct letter rather than a combining mark, so it needs its own rule. */
  function norm(s) {
    return String(s)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\u0111/g, 'd')
      .replace(/['’`]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
  }

  const COUNTRY_LABEL = {
    cn: 'China', la: 'Laos', th: 'Thailand', kh: 'Cambodia', vn: 'Vietnam',
    my: 'Malaysia', sg: 'Singapore', bn: 'Brunei', id: 'Indonesia', ph: 'Philippines', mm: 'Myanmar',
  }

  /* Phrases people wrap the actual question in. Stripped before matching so
   * "i want to go from X to Y by train" leaves just X and Y. */
  const LEAD = [
    'how do i get', 'how do you get', 'how to get', 'how do i travel', 'how can i get',
    'whats the best way', 'what is the best way', 'best way', 'can i take a train',
    'can you take a train', 'can i get', 'is there a train', 'i want to go', 'i want to travel',
    'i need to get', 'travel', 'route', 'getting', 'going', 'go',
  ]
  const TAIL = [
    'by train', 'by rail', 'by land', 'overland', 'without flying', 'without a flight',
    'no flights', 'by boat', 'by ferry', 'on the ground', 'please', 'thanks',
  ]

  function build(network, landmarks, countryHub) {
    const entries = []
    /* Ties are common — "Singapore" is a city on two stations. Bias toward the
     * one a traveller actually means: the hub over the border post, a named
     * landmark over a bare station name. */
    const add = (label, key, stationId, kind, extra) => {
      const st = network.stations[stationId]
      const bias =
        (kind === 'landmark' ? 6 : 0) + (st && st.hub ? 4 : 0) + (st && st.minor ? -4 : 0)
      // Coordinates travel with the entry so `match` can ask how far apart two
      // near-identical spellings actually are, without needing the network.
      entries.push({
        label, key: norm(key), stationId, kind, bias,
        lat: st ? st.lat : null, lon: st ? st.lon : null,
        ...extra,
      })
    }

    for (const lm of landmarks) {
      add(lm.name, lm.name, lm.station, 'landmark', { landmark: lm })
      for (const alias of lm.aka || []) {
        /* An alias that is simply the city or station name is not a landmark
         * reference — someone typing "bangkok" means Bangkok, and answering
         * them with "Grand Palace" reads as a non-sequitur. */
        const st = network.stations[lm.station]
        const a = norm(alias)
        if (st && a === norm(st.city)) add(st.city, alias, lm.station, 'city')
        else if (st && a === norm(st.name)) add(st.city, alias, lm.station, 'city')
        else add(lm.name, alias, lm.station, 'landmark', { landmark: lm })
      }
    }
    for (const [id, s] of Object.entries(network.stations)) {
      add(s.name, s.name, id, 'station')
      if (norm(s.city) !== norm(s.name)) add(s.city, s.city, id, 'city')
    }
    for (const [code, label] of Object.entries(COUNTRY_LABEL)) {
      if (countryHub[code]) add(label, label, countryHub[code], 'country')
    }
    return entries
  }

  /* Optimal string alignment distance — Levenshtein plus transposition, which
   * matters here because the commonest typo in these names is a swap: "hanio",
   * "siem riep", "bankok". Bails out as soon as the whole row exceeds `max`, so
   * comparing a query against two hundred keys stays cheap.
   *
   * Not a general fuzzy search. It runs only after the exact, prefix and
   * substring tiers have failed, and only within a distance the length of the
   * word justifies — see TYPO_BUDGET. */
  function editDistance(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1
    let prev2 = null
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
    for (let i = 1; i <= a.length; i++) {
      const row = new Array(b.length + 1)
      row[0] = i
      let best = row[0]
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1
        let v = Math.min(row[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
          v = Math.min(v, prev2[j - 2] + 1)
        }
        row[j] = v
        if (v < best) best = v
      }
      if (best > max) return max + 1
      prev2 = prev
      prev = row
    }
    return prev[b.length]
  }

  /* How wrong a spelling is allowed to be, by length. One slip in a short word
   * is already most of it — "pai" and "pak" are different places — so the
   * budget only opens up as the word gets long enough for a typo to be
   * unambiguous. */
  function typoBudget(len) {
    if (len < 5) return 0
    if (len < 8) return 1
    if (len < 13) return 2
    return 3
  }

  const NO = { s: 0 }

  /* Deliberately conservative. A wrong confident match is worse than asking
   * again, because the traveller has no way to tell it guessed.
   *
   * Returns {s, fuzzy, loose}. `fuzzy` means the tier that matched was a
   * spelling guess rather than a real hit — the caller has to say so out loud,
   * because "Rayong" and "Ranong" are one letter and eight hundred kilometres
   * apart and the traveller is the only one who knows which they meant. */
  function score(query, entry) {
    const q = query
    const k = entry.key
    if (!q || !k) return NO
    if (q === k) return { s: 100 }
    if (k.startsWith(q) || q.startsWith(k)) {
      return { s: 84 - Math.min(20, Math.abs(k.length - q.length)) }
    }
    if (q.length >= 4 && k.includes(q)) return { s: 66 }
    if (k.length >= 4 && q.includes(k)) return { s: 62 }

    // People type "danang" for "Đà Nẵng" and "hochiminh" for "Ho Chi Minh".
    const qj = q.replace(/ /g, '')
    const kj = k.replace(/ /g, '')
    if (qj === kj) return { s: 96 }
    if (kj.startsWith(qj) || qj.startsWith(kj)) {
      return { s: 78 - Math.min(20, Math.abs(kj.length - qj.length)) }
    }
    if (qj.length >= 5 && kj.includes(qj)) return { s: 58 }

    /* Misspellings. Compared without spaces so a missing or extra one is free —
     * "kohsamui", "koh samui" and "ko samui" are the same guess. Scored high
     * enough to beat a chance token overlap, because "kuala lumper" meant Kuala
     * Lumpur and used to come back Taman Negara on the strength of "kuala". */
    const budget = typoBudget(Math.max(qj.length, kj.length))
    if (budget) {
      const d = editDistance(qj, kj, budget)
      if (d <= budget) return { s: 74 - 7 * d, fuzzy: true, distance: d }
    }

    /* A key can also be one typo'd word inside a longer name — "phnom pen" for
     * "Phnom Penh", "chiangmai" for "Chiang Mai (station)". */
    const qw = q.split(' ').filter(w => w.length > 3)
    const kw = k.split(' ').filter(w => w.length > 3)
    if (qw.length && kw.length && qw.length <= kw.length) {
      let matched = 0
      for (const word of qw) {
        const b = typoBudget(word.length)
        if (kw.some(other => other === word || (b && editDistance(word, other, b) <= b))) matched++
      }
      if (matched === qw.length && matched >= Math.min(2, kw.length)) return { s: 64, fuzzy: true, distance: 1 }
    }

    const qt = new Set(q.split(' ').filter(w => w.length > 2))
    const kt = k.split(' ').filter(w => w.length > 2)
    if (!qt.size || !kt.length) return NO
    const hits = kt.filter(w => qt.has(w)).length
    if (!hits) return NO
    return { s: 30 * (hits / Math.max(qt.size, kt.length)) + 12 * hits, loose: true }
  }

  /* Far enough apart that picking the wrong one is a different holiday.
   * Ranong and Rayong are 700 km; Bangkok's terminals are five. */
  const AMBIGUITY_KM = 150

  function farApart(a, b) {
    if (a.lat == null || b.lat == null) return true
    // Rough equirectangular distance — exact enough for a 150 km threshold.
    const dLat = (a.lat - b.lat) * 111
    const dLon = (a.lon - b.lon) * 111 * Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180))
    return Math.hypot(dLat, dLon) > AMBIGUITY_KM
  }

  function match(entries, raw) {
    const q = norm(raw)
    if (!q) return null
    const ranked = entries
      .map(e => {
        const r = score(q, e)
        return { entry: e, ...r, s: r.s > 0 ? r.s + e.bias : 0 }
      })
      .filter(r => r.s > 0)
      .sort((a, b) => b.s - a.s || a.entry.label.length - b.entry.label.length)
    if (!ranked.length) return null

    // Collapse duplicates that resolve to the same station.
    const seen = new Set()
    const unique = []
    for (const r of ranked) {
      const id = r.entry.stationId
      if (seen.has(id)) continue
      seen.add(id)
      unique.push(r)
      if (unique.length >= 5) break
    }
    const best = unique[0]

    /* Two different places spelled almost the same is the case that must not
     * be answered confidently. Ranong and Rayong, Koh Chang and Pak Chong: if
     * the query is an equally good guess at a second station, the planner has
     * no basis for choosing and the traveller does.
     *
     * Measured in kilometres rather than by station id, because Bangkok has
     * three stations and Manila three terminals — landing on a different one
     * of those is not an ambiguity, it is the same trip. */
    const rival = unique.find(
      r =>
        r !== best &&
        r.fuzzy &&
        (r.distance ?? 9) <= (best.distance ?? 0) &&
        farApart(best.entry, r.entry)
    )
    const ambiguous = !!best.fuzzy && !!rival

    return {
      stationId: best.entry.stationId,
      label: best.entry.label,
      kind: best.entry.kind,
      landmark: best.entry.landmark || null,
      confident: best.s >= 60 && !ambiguous,
      // A guess at a misspelling, to be shown as one rather than applied quietly.
      corrected: !!best.fuzzy,
      // Nothing but a shared common word — "son" in "Mae Hong Son" also being
      // in "Son Doong". Never worth offering back as a suggestion.
      loose: !!best.loose,
      ambiguous,
      alternatives: unique.slice(1, 4).map(r => ({
        label: r.entry.label,
        stationId: r.entry.stationId,
      })),
    }
  }

  function strip(text) {
    let t = norm(text)
    let changed = true
    while (changed) {
      changed = false
      for (const p of LEAD) {
        if (t.startsWith(p + ' ')) {
          t = t.slice(p.length + 1)
          changed = true
        }
      }
      for (const p of TAIL) {
        if (t.endsWith(' ' + p)) {
          t = t.slice(0, -(p.length + 1))
          changed = true
        }
      }
    }
    return t.trim()
  }

  /** Split a question into its two endpoints. */
  function split(text) {
    const t = strip(text)
    let m = t.match(/^from\s+(.+?)\s+to\s+(.+)$/)
    if (m) return [m[1], m[2]]
    m = t.match(/^(.+?)\s+to\s+(.+)$/)
    if (m) return [m[1], m[2]]
    m = t.match(/^(.+?)\s+(?:then|until|till|then on to|onto)\s+(.+)$/)
    if (m) return [m[1], m[2]]
    // "X - Y" only when both halves look substantial, so hyphenated place
    // names such as Ho-Chi-Minh survive.
    const parts = String(text).split(/\s+[-–—>]+\s+|\s*→\s*/)
    if (parts.length === 2 && parts.every(p => strip(p).length > 2)) {
      return [strip(parts[0]), strip(parts[1])]
    }
    return null
  }

  function ask(network, entries, text) {
    const pair = split(text)
    if (!pair) {
      return {
        ok: false,
        reason: 'Say where you are starting and where you want to end up — "Angkor Wat to Ha Long Bay".',
      }
    }
    const [rawFrom, rawTo] = pair
    const from = match(entries, rawFrom)
    const to = match(entries, rawTo)

    /* Three different failures, and telling them apart is most of the value.
     * "We do not cover that" is a fact about the network; "did you mean one of
     * these" is a spelling problem; and a place we have never heard of should
     * not be answered with the nearest string in the gazetteer. */
    const sides = [
      { raw: rawFrom, m: from },
      { raw: rawTo, m: to },
    ].filter(x => !x.m || !x.m.confident)

    if (sides.length) {
      const ambiguous = sides.filter(x => x.m && x.m.ambiguous)
      const quoted = xs => xs.map(x => `“${x.raw}”`).join(' or ')

      if (ambiguous.length) {
        return {
          ok: false,
          reason: `${quoted(ambiguous)} could be more than one place. Pick the one you meant.`,
          suggestions: ambiguous.flatMap(x => [x.m.label, ...x.m.alternatives.map(a => a.label)]).slice(0, 5),
        }
      }
      /* A match on nothing but a shared common word is not a near miss, it is
       * noise. Offering it back — "did you mean Phong Nha caves?" for "Mae Hong
       * Son" — makes the planner look like it is guessing, which it was. */
      const nothing = sides.filter(x => !x.m || x.m.loose)
      if (nothing.length) {
        return {
          ok: false,
          reason: `${quoted(nothing)} is not on this network — either it is spelled differently here, or nothing overland reaches it.`,
          suggestions: [],
        }
      }
      // Matched, but not well enough to act on. Offer what it nearly matched.
      return {
        ok: false,
        reason: `Not sure what you mean by ${quoted(sides)}.`,
        suggestions: sides
          .flatMap(x => [x.m.label, ...x.m.alternatives.map(a => a.label)])
          .slice(0, 5),
      }
    }
    if (from.stationId === to.stationId) {
      return { ok: false, reason: `Those both resolve to ${from.label}. Pick two different places.` }
    }
    // Keep what was actually typed, so a corrected spelling can be shown as a
    // correction rather than silently swapped in.
    return { ok: true, from: { ...from, typed: rawFrom }, to: { ...to, typed: rawTo } }
  }

  /** How the answer explains itself, including the gap it cannot cover by rail. */
  function explain(network, side) {
    const station = network.stations[side.stationId]
    const bits = []
    if (side.kind === 'landmark' && side.landmark) {
      bits.push(`${side.label} → ${station.name}`)
      if (side.landmark.last) bits.push(side.landmark.last)
    } else if (side.kind === 'country') {
      bits.push(`${side.label} → ${station.name}`)
    } else {
      bits.push(station.name)
    }
    // Say the correction out loud, after the answer rather than instead of it.
    // Someone who typed "Ranong" and got Rayong needs to see that happen while
    // they can still object to it.
    if (side.corrected && side.typed && norm(side.typed) !== norm(side.label)) {
      bits.push(`read “${side.typed}” as ${side.label}`)
    }
    return bits
  }

  /* ------------------------------------------- describing a place by hand */

  /* "The market where the train goes through the stalls." "That island with
   * the full moon party." People often know a place by what happens there and
   * not by its name, and a spelling-tolerant name matcher cannot help them —
   * there is no spelling of "umbrella market" that is close to "Maeklong".
   *
   * So this indexes what the dataset already says about each place: aliases,
   * the warnings on its station, the notes on the services that call there,
   * how you cover the last mile to it, and any myth that names it. About four
   * and a half thousand words, which is enough to find most descriptions.
   *
   * Everything is scored offline. The page makes no network requests, which is
   * what lets it work at a border post with no signal, and asking a model to
   * resolve this would cost that — see the note in the panel. */

  /* Ordinary English, dropped before scoring. "can" earns its place here the
   * hard way: accents fold, so "Cần Thơ" indexes as "can tho", and a query
   * containing the word "can" was answering "a beach you can only reach by
   * boat" with a floating market in the Mekong delta. */
  const STOP = new Set([
    'the', 'a', 'an', 'that', 'this', 'these', 'those', 'with', 'where',
    'which', 'what', 'who', 'when', 'how', 'is', 'are', 'was', 'were', 'be',
    'in', 'on', 'at', 'to', 'of', 'and', 'or', 'for', 'from', 'but', 'not',
    'it', 'its', 'you', 'your', 'i', 'im', 'my', 'we', 'they', 'them',
    'place', 'places', 'somewhere', 'anywhere', 'thing', 'things', 'one',
    'go', 'goes', 'going', 'get', 'gets', 'there', 'here', 'near', 'by',
    'has', 'have', 'had', 'can', 'could', 'would', 'should', 'will', 'just',
    'only', 'very', 'some', 'any', 'all', 'also', 'about', 'like', 'want',
    'looking', 'find', 'know', 'called', 'name', 'named', 'called',
  ])

  const terms = text =>
    norm(text)
      .split(/[^a-z0-9]+/)
      .filter(w => w.length > 2 && !STOP.has(w))

  let index = null

  function buildIndex(network, landmarks) {
    /* One document per place, with the source of each phrase kept so a result
     * can say why it matched. A hit you cannot explain is a guess. */
    const docs = new Map()
    const doc = (id, kind, label, stationId) => {
      if (!docs.has(id)) docs.set(id, { id, kind, label, stationId, bag: new Map(), why: [] })
      return docs.get(id)
    }
    const feed = (d, text, source) => {
      if (!text || typeof text !== 'string') return
      const ws = terms(text)
      if (!ws.length) return
      for (const w of ws) d.bag.set(w, (d.bag.get(w) || 0) + 1)
      d.why.push({ text, source, words: new Set(ws) })
    }

    for (const lm of landmarks) {
      const d = doc(`lm:${lm.name}`, 'landmark', lm.name, lm.station)
      feed(d, lm.name, 'name')
      for (const a of lm.aka || []) feed(d, a, 'also known as')
      if (lm.last) feed(d, lm.last, 'getting there')
      const st = network.stations[lm.station]
      if (st) feed(d, `${st.city} ${COUNTRY_LABEL[lm.country] || ''}`, 'where')
    }

    for (const [id, s] of Object.entries(network.stations)) {
      const d = doc(`st:${id}`, 'station', s.city === s.name ? s.name : `${s.city} — ${s.name}`, id)
      feed(d, `${s.city} ${s.name}`, 'name')
      feed(d, COUNTRY_LABEL[s.country], 'country')
      if (s.warn) feed(d, s.warn, 'about this station')
    }

    // A service note describes both ends of the leg it runs on.
    for (const leg of network.legs) {
      for (const end of [leg.from, leg.to]) {
        const d = docs.get(`st:${end}`)
        if (!d) continue
        if (leg.note) feed(d, leg.note, 'on this route')
        if (leg.service) feed(d, leg.service, 'service')
      }
    }

    // Myths name places directly, and they are the most quotable text here.
    for (const m of network.myths || []) {
      const text = `${m.belief} ${m.reality}`
      const ws = new Set(terms(text))
      for (const d of docs.values()) {
        const nameWords = terms(d.label)
        if (nameWords.length && nameWords.every(w => ws.has(w))) feed(d, m.reality, 'worth knowing')
      }
    }

    /* Rarity weighting. "Island" appears everywhere and settles nothing;
     * "umbrella" appears once and settles it completely. */
    const seen = new Map()
    for (const d of docs.values()) for (const w of d.bag.keys()) seen.set(w, (seen.get(w) || 0) + 1)
    const n = docs.size
    const idf = new Map()
    for (const [w, count] of seen) idf.set(w, Math.log(1 + n / count))

    return { docs: [...docs.values()], idf }
  }

  /** Rank places by how well a free-text description fits what we know. */
  function describe(network, landmarks, query, limit = 6) {
    if (!index) index = buildIndex(network, landmarks)
    const ws = terms(query)
    if (!ws.length) return []

    const scored = []
    for (const d of index.docs) {
      let score = 0
      const matched = new Set()
      for (const w of ws) {
        const tf = d.bag.get(w)
        if (!tf) continue
        matched.add(w)
        score += (index.idf.get(w) || 1) * Math.min(tf, 3)
      }
      if (!matched.size) continue
      // Half the words matching is a coincidence; most of them is an answer.
      score *= matched.size / ws.length
      if (d.kind === 'landmark') score *= 1.15

      // The phrase that did the most work, so the result can show its evidence.
      let best = null
      let bestHits = 0
      for (const w of d.why) {
        const hits = [...matched].filter(m => w.words.has(m)).length
        if (hits > bestHits) {
          bestHits = hits
          best = w
        }
      }
      scored.push({
        id: d.id,
        kind: d.kind,
        label: d.label,
        stationId: d.stationId,
        score,
        matched: [...matched],
        why: best ? { text: best.text, source: best.source } : null,
      })
    }

    scored.sort((a, b) => b.score - a.score)
    // A long tail of one-weak-word matches is noise, not a shortlist.
    const top = scored.filter(s => s.score >= scored[0].score * 0.25)
    return top.slice(0, limit)
  }

  return { build, ask, match, split, explain, describe, norm, COUNTRY_LABEL }
})()
