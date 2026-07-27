#!/usr/bin/env node
// Matches each rail leg in data/network.js to the real track it runs on, using
// Natural Earth 10m railroads. Run once; the output is committed so the app
// keeps its zero-network build.
//
//   curl -sSL -o /tmp/rails.geojson \
//     https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_railroads.geojson
//   node tools/build-rails.mjs /tmp/rails.geojson data/rails.json
//
// Coverage is deliberately partial. Natural Earth's railway data predates the
// Laos–China Railway, so the whole Boten–Vientiane spine has no geometry here
// and comes back unmatched. That is the correct answer: the app draws those
// legs as straight lines, which is honest about knowing the endpoints and not
// the route. Inventing a plausible alignment would be the one thing this
// project spends its time refusing to do.

import { readFileSync, writeFileSync } from 'node:fs'

const [, , inPath, outPath] = process.argv
if (!inPath || !outPath) {
  console.error('usage: build-rails.mjs <ne_10m_railroads.geojson> <out.json>')
  process.exit(1)
}

const BBOX = { west: 92, east: 127, south: -12, north: 29 }

// Vertices this close together are the same place, which is what joins one
// line's end to the next line's start into a single traversable network.
const QUANT = 0.0015 // degrees, ~165 m
// How far a station may sit from the nearest track and still be considered on
// it. Generous, because station coordinates here are only good to ~1 km and
// some termini are genuinely a walk from the running line.
const SNAP_KM = 12
// A matched route may wander this much further than the straight line before
// we call it a wrong match rather than a scenic one.
const DETOUR = 2.1
const SIMPLIFY = 0.006 // degrees, ~660 m

const inBox = ([x, y]) =>
  x >= BBOX.west && x <= BBOX.east && y >= BBOX.south && y <= BBOX.north

function km(a, b) {
  const dy = (a[1] - b[1]) * 111
  const dx = (a[0] - b[0]) * 111 * Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180)
  return Math.hypot(dx, dy)
}

/* ------------------------------------------------------------------ graph */

const key = p => `${Math.round(p[0] / QUANT)},${Math.round(p[1] / QUANT)}`
const nodes = new Map() // key -> {p, adj: Map(key -> km)}

function node(p) {
  const k = key(p)
  let n = nodes.get(k)
  if (!n) nodes.set(k, (n = { k, p, adj: new Map() }))
  return n
}

function link(a, b) {
  if (a === b) return
  const d = km(a.p, b.p)
  // Keep the shorter of any duplicate edge — the same track often appears in
  // more than one source line.
  if (!(a.adj.get(b.k) <= d)) {
    a.adj.set(b.k, d)
    b.adj.set(a.k, d)
  }
}

const geo = JSON.parse(readFileSync(inPath, 'utf8'))
let lineCount = 0
for (const f of geo.features) {
  const g = f.geometry
  if (!g) continue
  const lines =
    g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : []
  for (const line of lines) {
    // Clip to the bbox by breaking the line wherever it leaves — a segment
    // that re-enters is a new run, not a shortcut across the outside.
    let prev = null
    for (const p of line) {
      if (!inBox(p)) {
        prev = null
        continue
      }
      const n = node(p)
      if (prev) link(prev, n)
      prev = n
    }
    lineCount++
  }
}
console.log(`graph      ${nodes.size} nodes from ${lineCount} source lines`)

/* ------------------------------------------------------------- shortest path */

const all = [...nodes.values()]

function nearest(lon, lat) {
  let best = null
  let bestD = Infinity
  for (const n of all) {
    const d = km(n.p, [lon, lat])
    if (d < bestD) {
      bestD = d
      best = n
    }
  }
  return { node: best, distKm: bestD }
}

/** Dijkstra with a binary heap, stopping the moment the target settles. */
function route(startK, goalK) {
  const dist = new Map([[startK, 0]])
  const prev = new Map()
  const heap = [[0, startK]]
  const done = new Set()

  const push = item => {
    heap.push(item)
    let i = heap.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (heap[p][0] <= heap[i][0]) break
      ;[heap[p], heap[i]] = [heap[i], heap[p]]
      i = p
    }
  }
  const pop = () => {
    const top = heap[0]
    const last = heap.pop()
    if (heap.length) {
      heap[0] = last
      let i = 0
      for (;;) {
        const l = i * 2 + 1
        const r = l + 1
        let s = i
        if (l < heap.length && heap[l][0] < heap[s][0]) s = l
        if (r < heap.length && heap[r][0] < heap[s][0]) s = r
        if (s === i) break
        ;[heap[s], heap[i]] = [heap[i], heap[s]]
        i = s
      }
    }
    return top
  }

  while (heap.length) {
    const [d, k] = pop()
    if (done.has(k)) continue
    done.add(k)
    if (k === goalK) break
    for (const [nk, w] of nodes.get(k).adj) {
      if (done.has(nk)) continue
      const nd = d + w
      if (nd < (dist.get(nk) ?? Infinity)) {
        dist.set(nk, nd)
        prev.set(nk, k)
        push([nd, nk])
      }
    }
  }
  if (!done.has(goalK)) return null

  const path = []
  for (let k = goalK; k !== undefined; k = prev.get(k)) {
    path.push(nodes.get(k).p)
    if (k === startK) break
  }
  return { points: path.reverse(), km: dist.get(goalK) }
}

/* --------------------------------------------------------------- simplify */

function simplify(pts, eps) {
  if (pts.length < 3) return pts
  const keep = new Uint8Array(pts.length)
  keep[0] = keep[pts.length - 1] = 1
  const stack = [[0, pts.length - 1]]
  while (stack.length) {
    const [lo, hi] = stack.pop()
    let far = -1
    let farD = eps
    const [x1, y1] = pts[lo]
    const [x2, y2] = pts[hi]
    const dx = x2 - x1
    const dy = y2 - y1
    const len = Math.hypot(dx, dy) || 1
    for (let i = lo + 1; i < hi; i++) {
      const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + x2 * y1 - y2 * x1) / len
      if (d > farD) {
        farD = d
        far = i
      }
    }
    if (far > 0) {
      keep[far] = 1
      stack.push([lo, far], [far, hi])
    }
  }
  return pts.filter((_, i) => keep[i])
}

const round = p => [Math.round(p[0] * 1e4) / 1e4, Math.round(p[1] * 1e4) / 1e4]

/* ------------------------------------------------------------------ match */

const netSrc = readFileSync(new URL('../data/network.js', import.meta.url), 'utf8')
const NETWORK = eval(`${netSrc}; NETWORK`)

// One entry per distinct station pair, since several legs run over the same
// track and the answer is identical for all of them.
const pairs = new Map()
for (const leg of NETWORK.legs) {
  if (leg.mode !== 'rail') continue
  pairs.set(`${leg.from}|${leg.to}`, [leg.from, leg.to])
}

const snapCache = new Map()
const snapOf = id => {
  if (!snapCache.has(id)) {
    const s = NETWORK.stations[id]
    snapCache.set(id, nearest(s.lon, s.lat))
  }
  return snapCache.get(id)
}

const out = {}
const skipped = []
for (const [id, [fromId, toId]] of pairs) {
  const A = snapOf(fromId)
  const B = snapOf(toId)
  const from = NETWORK.stations[fromId]
  const to = NETWORK.stations[toId]
  const straight = km([from.lon, from.lat], [to.lon, to.lat])

  if (A.distKm > SNAP_KM || B.distKm > SNAP_KM) {
    skipped.push([id, `no track within ${SNAP_KM} km (${Math.max(A.distKm, B.distKm).toFixed(0)} km)`])
    continue
  }
  const r = route(A.node.k, B.node.k)
  if (!r) {
    skipped.push([id, 'endpoints not connected in this data'])
    continue
  }
  if (r.km > straight * DETOUR + 25) {
    skipped.push([id, `route wanders ${(r.km / Math.max(straight, 1)).toFixed(1)}x the straight line`])
    continue
  }

  // Anchor to the station dots so the drawn line meets the markers, then
  // simplify — the anchors are endpoints and survive it.
  const pts = [[from.lon, from.lat], ...r.points, [to.lon, to.lat]]
  const thin = simplify(pts, SIMPLIFY).map(round)
  if (thin.length > 2) out[id] = thin
}

const matched = Object.keys(out).length
const vertices = Object.values(out).reduce((n, p) => n + p.length, 0)
writeFileSync(outPath, JSON.stringify(out))

console.log(`matched    ${matched} of ${pairs.size} rail pairs, ${vertices} vertices`)
console.log(`unmatched  ${skipped.length} — drawn straight, which is the honest shape`)
for (const [id, why] of skipped) console.log(`   ${id.padEnd(30)} ${why}`)
