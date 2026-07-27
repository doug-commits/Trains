#!/usr/bin/env node
// Extracts a simplified Southeast Asia basemap from Natural Earth 50m country
// polygons. Run once; the output is committed so the app has no build-time
// network dependency.
//
//   curl -sSL -o /tmp/world.geojson \
//     https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson
//   node tools/build-basemap.mjs /tmp/world.geojson data/basemap.json

import { readFileSync, writeFileSync } from 'node:fs'

const [, , inPath, outPath] = process.argv
if (!inPath || !outPath) {
  console.error('usage: build-basemap.mjs <ne_50m_countries.geojson> <out.json>')
  process.exit(1)
}

// Everything the network touches, plus enough neighbours that the map reads as
// a map rather than a set of floating shapes.
const KEEP = new Map([
  ['THA', 'th'], ['LAO', 'la'], ['MYS', 'my'], ['SGP', 'sg'], ['KHM', 'kh'],
  ['VNM', 'vn'], ['MMR', 'mm'], ['IDN', 'id'], ['BRN', 'bn'], ['CHN', 'cn'],
  ['PHL', 'ph'], ['TLS', 'tl'], ['BGD', 'bd'], ['IND', 'in'],
])

// East to 127 so the Philippines is whole. Clipped at 122 — where this sat
// until the archipelago was added — Luzon lost its tail and Samar, Leyte,
// Bohol and eastern Mindanao fell off the edge entirely.
const BBOX = { west: 92, east: 127, south: -12, north: 29 }
// Degrees. At 50m and ~4 km this map read as a diagram; the ferry network
// calls at islands that were being simplified into blobs or away entirely.
// ~1.1 km is the point where Phi Phi is a shape rather than a dot and the
// Mergui and Riau archipelagos come back, without the file getting silly.
const TOLERANCE = 0.01
// Drop specks that would render as sub-pixel dust. ~0.0015 sq degrees is
// around 18 km² — an island you could walk across in an afternoon, which is
// exactly the size of several this network calls at.
const MIN_AREA = 0.0015

// --- Sutherland-Hodgman clip against each bbox edge ------------------------

const INSIDE = {
  west: p => p[0] >= BBOX.west,
  east: p => p[0] <= BBOX.east,
  south: p => p[1] >= BBOX.south,
  north: p => p[1] <= BBOX.north,
}

function intersect(a, b, edge) {
  const [x1, y1] = a
  const [x2, y2] = b
  if (edge === 'west' || edge === 'east') {
    const x = edge === 'west' ? BBOX.west : BBOX.east
    return [x, y1 + ((y2 - y1) * (x - x1)) / (x2 - x1)]
  }
  const y = edge === 'south' ? BBOX.south : BBOX.north
  return [x1 + ((x2 - x1) * (y - y1)) / (y2 - y1), y]
}

function clipRing(ring, edge) {
  const out = []
  const test = INSIDE[edge]
  for (let i = 0; i < ring.length; i++) {
    const cur = ring[i]
    const prev = ring[(i + ring.length - 1) % ring.length]
    const curIn = test(cur)
    const prevIn = test(prev)
    if (curIn) {
      if (!prevIn) out.push(intersect(prev, cur, edge))
      out.push(cur)
    } else if (prevIn) {
      out.push(intersect(prev, cur, edge))
    }
  }
  return out
}

function clip(ring) {
  let r = ring
  for (const edge of ['west', 'east', 'south', 'north']) {
    r = clipRing(r, edge)
    if (r.length < 3) return []
  }
  return r
}

// --- Douglas-Peucker ------------------------------------------------------

function perpDist(p, a, b) {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  if (dx === 0 && dy === 0) return Math.hypot(p[0] - a[0], p[1] - a[1])
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)
  const cx = a[0] + Math.max(0, Math.min(1, t)) * dx
  const cy = a[1] + Math.max(0, Math.min(1, t)) * dy
  return Math.hypot(p[0] - cx, p[1] - cy)
}

/* Iterative rather than recursive: at 10m the Sumatran coast is one ring of
 * tens of thousands of points, and the recursive form recurses once per kept
 * vertex — deep enough to blow the stack on exactly the coastlines this map
 * exists to draw. */
function simplify(points, tol) {
  if (points.length < 3) return points
  const keep = new Uint8Array(points.length)
  keep[0] = keep[points.length - 1] = 1
  const stack = [[0, points.length - 1]]
  while (stack.length) {
    const [lo, hi] = stack.pop()
    if (hi - lo < 2) continue
    let maxD = tol
    let idx = -1
    for (let i = lo + 1; i < hi; i++) {
      const d = perpDist(points[i], points[lo], points[hi])
      if (d > maxD) {
        maxD = d
        idx = i
      }
    }
    if (idx > 0) {
      keep[idx] = 1
      stack.push([lo, idx], [idx, hi])
    }
  }
  return points.filter((_, i) => keep[i])
}

function ringArea(ring) {
  let a = 0
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i]
    const [x2, y2] = ring[(i + 1) % ring.length]
    a += x1 * y2 - x2 * y1
  }
  return Math.abs(a / 2)
}

// --- Run ------------------------------------------------------------------

const world = JSON.parse(readFileSync(inPath, 'utf8'))
const countries = []

for (const feature of world.features) {
  const code = feature.properties.ADM0_A3 || feature.properties.SOV_A3
  const id = KEEP.get(code)
  if (!id) continue

  const polygons =
    feature.geometry.type === 'Polygon'
      ? [feature.geometry.coordinates]
      : feature.geometry.coordinates

  const rings = []
  for (const poly of polygons) {
    // Outer ring only. Holes in this region are lakes small enough to ignore
    // at this scale, and keeping them doubles the path data for no legibility.
    const clipped = clip(poly[0])
    if (clipped.length < 3) continue
    const simplified = simplify(clipped, TOLERANCE)
    if (simplified.length < 3) continue
    if (ringArea(simplified) < MIN_AREA) continue
    rings.push(simplified.map(([x, y]) => [+x.toFixed(3), +y.toFixed(3)]))
  }

  if (!rings.length) continue
  countries.push({ id, name: feature.properties.NAME, rings })
}

countries.sort((a, b) => a.id.localeCompare(b.id))

const out = { bbox: BBOX, countries }
writeFileSync(outPath, JSON.stringify(out))

const points = countries.reduce(
  (n, c) => n + c.rings.reduce((m, r) => m + r.length, 0),
  0
)
console.log(
  `${countries.length} countries, ${points} points, ` +
    `${(JSON.stringify(out).length / 1024).toFixed(1)} KB -> ${outPath}`
)
