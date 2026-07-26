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

const BBOX = { west: 92, east: 122, south: -12, north: 29 }
const TOLERANCE = 0.035 // degrees; ~4 km — plenty for a 1000px-wide map
const MIN_AREA = 0.02 // drop specks that would render as sub-pixel dust

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

function simplify(points, tol) {
  if (points.length < 3) return points
  let maxD = 0
  let idx = 0
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpDist(points[i], points[0], points[points.length - 1])
    if (d > maxD) {
      maxD = d
      idx = i
    }
  }
  if (maxD <= tol) return [points[0], points[points.length - 1]]
  return [
    ...simplify(points.slice(0, idx + 1), tol).slice(0, -1),
    ...simplify(points.slice(idx), tol),
  ]
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
