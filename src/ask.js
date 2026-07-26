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
    my: 'Malaysia', sg: 'Singapore', bn: 'Brunei', id: 'Indonesia', mm: 'Myanmar',
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
      entries.push({ label, key: norm(key), stationId, kind, bias, ...extra })
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

  /* Deliberately conservative. A wrong confident match is worse than asking
   * again, because the traveller has no way to tell it guessed. */
  function score(query, entry) {
    const q = query
    const k = entry.key
    if (!q || !k) return 0
    if (q === k) return 100
    if (k.startsWith(q) || q.startsWith(k)) {
      return 84 - Math.min(20, Math.abs(k.length - q.length))
    }
    if (q.length >= 4 && k.includes(q)) return 66
    if (k.length >= 4 && q.includes(k)) return 62

    // People type "danang" for "Đà Nẵng" and "hochiminh" for "Ho Chi Minh".
    const qj = q.replace(/ /g, '')
    const kj = k.replace(/ /g, '')
    if (qj === kj) return 96
    if (kj.startsWith(qj) || qj.startsWith(kj)) {
      return 78 - Math.min(20, Math.abs(kj.length - qj.length))
    }
    if (qj.length >= 5 && kj.includes(qj)) return 58

    const qt = new Set(q.split(' ').filter(w => w.length > 2))
    const kt = k.split(' ').filter(w => w.length > 2)
    if (!qt.size || !kt.length) return 0
    const hits = kt.filter(w => qt.has(w)).length
    if (!hits) return 0
    return 30 * (hits / Math.max(qt.size, kt.length)) + 12 * hits
  }

  function match(entries, raw) {
    const q = norm(raw)
    if (!q) return null
    const ranked = entries
      .map(e => ({ entry: e, s: score(q, e) + (score(q, e) > 0 ? e.bias : 0) }))
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
    return {
      stationId: best.entry.stationId,
      label: best.entry.label,
      kind: best.entry.kind,
      landmark: best.entry.landmark || null,
      confident: best.s >= 60,
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

    const missing = []
    if (!from || !from.confident) missing.push(rawFrom)
    if (!to || !to.confident) missing.push(rawTo)
    if (missing.length) {
      const near = [from, to].filter(x => x && x.alternatives)
      return {
        ok: false,
        reason: `Not sure what you mean by ${missing.map(m => `“${m}”`).join(' or ')}.`,
        suggestions: near.flatMap(x => [x.label, ...x.alternatives.map(a => a.label)]).slice(0, 5),
      }
    }
    if (from.stationId === to.stationId) {
      return { ok: false, reason: `Those both resolve to ${from.label}. Pick two different places.` }
    }
    return { ok: true, from, to }
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
    return bits
  }

  return { build, ask, match, explain, norm, COUNTRY_LABEL }
})()
