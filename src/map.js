/* Canvas map. The route is the hero, so everything else is drawn to sit under
 * it: coastline as a quiet ground, the unused network as a faint lattice, and
 * the chosen itinerary on top in the three modes.
 *
 * Modes are distinguished by line style as well as hue — solid rail, dashed
 * sea, dotted road — so the shape of a journey survives both themes and any
 * kind of colour blindness.
 */

const MapView = (() => {
  const STYLE = {
    rail: { dash: [], width: 3.4 },
    ferry: { dash: [7, 5], width: 2.6 },
    road: { dash: [1.5, 4], width: 2.6 },
  }

  function themeColors(root) {
    const cs = getComputedStyle(root)
    const get = n => cs.getPropertyValue(n).trim()
    return {
      sea: get('--sea'),
      land: get('--land'),
      landEdge: get('--land-edge'),
      landmark: get('--landmark'),
      idle: get('--idle-line'),
      idleDot: get('--idle-dot'),
      rail: get('--rail'),
      ferry: get('--ferry'),
      road: get('--road'),
      alert: get('--alert'),
      ink: get('--ink'),
      muted: get('--muted'),
      panel: get('--panel'),
      seaDeep: get('--sea-deep'),
      grid: get('--grid'),
      coast: get('--coast'),
    }
  }

  function create(canvas, network, basemap, landmarks = [], rails = {}) {
    const ctx = canvas.getContext('2d')
    let view = null
    let hit = { stations: [], segments: [] }
    let state = {
      route: null, // {legs:[{leg,fromId,toId}], stationIds:[]}
      progress: 1,
      hover: null,
      focusLeg: null,
    }
    let colors = themeColors(document.documentElement)
    let raf = null
    /* True while a pan or a pinch is still arriving. It is a quality dial, not
     * a mode: the coastal glow and the coastline hairline sit it out, and the
     * frame the gesture settles on puts them back. */
    let moving = false
    let pending = null
    let quality = null
    let moves = 0
    // The controls and the itinerary panel overlay the map on wide screens, so
    // a route fitted to the full canvas ends up half-hidden behind them.
    let inset = { left: 0, right: 0, top: 0, bottom: 0 }

    /* What a drag is not allowed to lose. The basemap box runs well past the
     * network on every side, so clamping to it still lets the map be dragged
     * until only empty sea is left. The stations are what people navigate by,
     * so they are what has to stay reachable. */
    const reach = (() => {
      const pts = Object.values(network.stations)
      const lons = pts.map(s => s.lon)
      const lats = pts.map(s => s.lat)
      return {
        west: Math.min(...lons) - 1,
        east: Math.max(...lons) + 1,
        south: Math.min(...lats) - 1,
        north: Math.max(...lats) + 1,
      }
    })()

    /* The coastline, built once, in world coordinates.
     *
     * Projection is a pure affine map — x = lon*scale + dx, y = screenY(lat)*
     * scale + dy — so a path laid out in (lon, screenY(lat)) can be handed to
     * the canvas transform and drawn without touching a single coordinate.
     * Rebuilding it per frame meant thirteen thousand projections and four
     * hundred Path2D allocations for every pixel of a pan, which is what made
     * the map unusable on a phone: 93ms a frame, so about ten. */
    const world = (() => {
      const ring = (path, pts) => {
        for (let i = 0; i < pts.length; i++) {
          const x = pts[i][0]
          const y = Proj.screenY(pts[i][1])
          if (i === 0) path.moveTo(x, y)
          else path.lineTo(x, y)
        }
        path.closePath()
      }

      const all = new Path2D()
      const outlines = []
      for (const country of basemap.countries) {
        const path = new Path2D()
        for (const r of country.rings) ring(path, r)
        outlines.push(path)
        all.addPath(path)
      }

      /* The small islands, which are land without being any country's outline.
       * They come from their own dataset because several places this network
       * calls at — Koh Tao, Phi Phi, Samet, the Gilis, Boracay — are absent
       * from the country polygons at every resolution, which left ferry
       * terminals floating in open water. */
      const isles = new Path2D()
      for (const r of basemap.islands || []) ring(isles, r)
      outlines.push(isles)
      all.addPath(isles)

      return { all, outlines }
    })()

    /* Fit into the window the overlays leave visible, then shift it into place.
     *
     * Vertical as well as horizontal, because on a phone the itinerary is a
     * sheet over the bottom of the map rather than a column beside it — a
     * route fitted to the whole canvas would put half of itself underneath. */
    function fitVisible(rect, fit) {
      const strip = Math.max(240, rect.width - inset.left - inset.right)
      const tall = Math.max(200, rect.height - inset.top - inset.bottom)
      const fitted = fit(strip, tall)
      return {
        ...fitted,
        w: rect.width,
        h: rect.height,
        dx: fitted.dx + inset.left,
        dy: fitted.dy + inset.top,
      }
    }

    function baseView(rect) {
      const pad = rect.width < 700 ? 12 : 28
      return fitVisible(rect, (strip, tall) => Proj.create(basemap.bbox, strip, tall, pad))
    }

    /* Capped at 2 rather than 3. A phone reporting 3 asks for 1.3 million
     * backing pixels for a strip of map barely 400 points wide, and every fill,
     * stroke and blur pays for all of them. The map is line art on a flat
     * ground; at 2 the difference is invisible and the frame is less than half
     * the cost. */
    const SHARP = () => Math.min(2, window.devicePixelRatio || 1)

    /* And 1 while the map is moving.
     *
     * What is left in a frame after the caching is raster: filling the land and
     * stroking the network, both of which cost exactly what they cover. Halving
     * the resolution quarters the pixels, and quartering the pixels is the only
     * thing that moves a number made of area. The map is a little soft under a
     * moving thumb and sharp the moment it stops, which is the trade every map
     * that feels smooth has already made. */
    const SOFT = 1

    let backing = null

    function setBacking(dpr) {
      if (backing === dpr) return
      backing = dpr
      const rect = canvas.getBoundingClientRect()
      canvas.width = Math.max(1, Math.round(rect.width * dpr))
      canvas.height = Math.max(1, Math.round(rect.height * dpr))
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      // The baked sea and vignette are sized in device pixels, so they are no
      // longer the right size. backdrops() rebuilds on its own key.
      backdrop = null
    }

    function size() {
      const rect = canvas.getBoundingClientRect()
      backing = null // the element's own size changed; force the store to follow
      setBacking(SHARP())

      if (!view) {
        view = baseView(rect)
      } else {
        // Preserve the centre and zoom factor across a resize.
        const zoom = view.scale / view.baseScale
        const centre = Proj.unproject(view, view.w / 2, view.h / 2)
        const fresh = baseView(rect)
        fresh.scale = fresh.baseScale * zoom
        fresh.dx = rect.width / 2 - centre.lon * fresh.scale
        fresh.dy = rect.height / 2 - Proj.screenY(centre.lat) * fresh.scale
        view = fresh
      }
      return rect
    }

    const P = id => {
      const s = network.stations[id]
      return Proj.project(view, s.lon, s.lat)
    }

    /* Cities with more than one station get labelled by station name even when
     * zoomed out. Two dots both reading "Vientiane" looks like a rendering bug
     * rather than what it is — the single most important fact on this map. */
    const sharedCities = (() => {
      const counts = new Map()
      for (const s of Object.values(network.stations)) {
        counts.set(s.city, (counts.get(s.city) ?? 0) + 1)
      }
      return new Set([...counts].filter(([, n]) => n > 1).map(([city]) => city))
    })()

    /* ------------------------------------------------------------ drawing */

    /* Meridians and parallels every five degrees. The cheapest thing that makes
     * a chart look like a chart rather than a diagram — it gives the empty sea
     * a scale, and it moves under a pan, which is what tells you the map is a
     * real projection and not a picture. */
    function drawGraticule() {
      const nw = Proj.unproject(view, 0, 0)
      const se = Proj.unproject(view, view.w, view.h)
      // Coarser lines as you zoom out, so the grid never turns into a screen.
      const span = Math.abs(se.lon - nw.lon)
      const step = span > 60 ? 10 : span > 25 ? 5 : span > 10 ? 2 : 1

      ctx.save()
      ctx.strokeStyle = colors.grid
      ctx.lineWidth = 0.6
      ctx.globalAlpha = 0.55
      ctx.beginPath()
      const first = n => Math.ceil(n / step) * step
      for (let lon = first(nw.lon); lon <= se.lon; lon += step) {
        const a = Proj.project(view, lon, nw.lat)
        const b = Proj.project(view, lon, se.lat)
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
      }
      for (let lat = first(se.lat); lat <= nw.lat; lat += step) {
        const a = Proj.project(view, nw.lon, lat)
        const b = Proj.project(view, se.lon, lat)
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
      }
      ctx.stroke()
      ctx.restore()
    }

    /* The sea and the vignette that darkens its corners, baked once.
     *
     * Neither moves with the map: both are painted in screen space and depend
     * only on the size of the canvas and the palette. Evaluating two gradient
     * ramps across every pixel of the viewport, sixty times a second, to arrive
     * at the identical image each time, cost more than everything else on the
     * map put together — a third of the frame. Painted once into a bitmap and
     * blitted, they cost a copy. */
    let backdrop = null

    function backdrops() {
      const key = [canvas.width, canvas.height, colors.sea, colors.seaDeep].join('|')
      if (backdrop && backdrop.key === key) return backdrop

      const layer = () => {
        const c = document.createElement('canvas')
        c.width = canvas.width
        c.height = canvas.height
        const g = c.getContext('2d')
        g.scale(canvas.width / view.w, canvas.height / view.h)
        return { c, g }
      }

      // A sea that deepens toward the bottom of the frame. One flat fill across
      // two thirds of the viewport is the least interesting thing a map can do.
      const sea = layer()
      const sky = sea.g.createLinearGradient(0, 0, 0, view.h)
      sky.addColorStop(0, colors.sea)
      sky.addColorStop(1, colors.seaDeep)
      sea.g.fillStyle = sky
      sea.g.fillRect(0, 0, view.w, view.h)

      /* Darkens the corners so the eye settles in the middle where the route
       * is. Drawn on the ground rather than over everything, so it never dims
       * a leg. */
      const vig = layer()
      const rg = vig.g.createRadialGradient(
        view.w / 2, view.h / 2, Math.min(view.w, view.h) * 0.32,
        view.w / 2, view.h / 2, Math.max(view.w, view.h) * 0.78
      )
      rg.addColorStop(0, 'rgba(0,0,0,0)')
      rg.addColorStop(1, colors.seaDeep)
      vig.g.fillStyle = rg
      vig.g.fillRect(0, 0, view.w, view.h)

      backdrop = { key, sea: sea.c, vignette: vig.c }
      return backdrop
    }

    function drawBasemap() {
      const baked = backdrops()
      ctx.drawImage(baked.sea, 0, 0, view.w, view.h)

      drawGraticule()

      ctx.save()
      ctx.globalAlpha = 0.5
      ctx.drawImage(baked.vignette, 0, 0, view.w, view.h)
      ctx.restore()

      ctx.lineJoin = 'round'

      /* The cached world-space coastline, projected by the canvas rather than
       * by hand. Line widths are divided by the scale because the transform
       * multiplies them back up; shadowBlur is not, because the canvas keeps
       * blur radii in device pixels whatever the matrix says. */
      ctx.save()
      ctx.transform(view.scale, 0, 0, view.scale, view.dx, view.dy)

      /* All the land filled once with a soft shadow, so the glow lands in the
       * water and not along every internal frontier. The glow is the single
       * most expensive thing on the map — a blur over the whole coast — so a
       * gesture in progress goes without it and picks it up on the frame it
       * settles. Nobody can see a coastal halo on a map that is moving. */
      ctx.fillStyle = colors.land
      if (moving) {
        ctx.fill(world.all)
      } else {
        ctx.shadowColor = colors.coast
        ctx.shadowBlur = 16
        ctx.fill(world.all)
        ctx.shadowBlur = 0
        // Again, so the interior is the flat land colour rather than whatever
        // the glow spilled onto it. Only worth doing if there was a glow: the
        // second fill of a thirteen-thousand-point path was costing a quarter
        // of every frame of a drag to paint the identical shape twice.
        ctx.fill(world.all)
      }

      /* The hairline along every coast and frontier — thirteen thousand points
       * of it, and the most expensive stroke on the map by a wide margin. Like
       * the glow it waits for the frame the gesture settles on. The land is a
       * filled shape either way, so what goes missing mid-drag is the crispness
       * of its edge, on a map that is sliding under a thumb. */
      if (!moving) {
        ctx.strokeStyle = colors.landEdge
        ctx.lineWidth = 0.8 / view.scale
        for (const path of world.outlines) ctx.stroke(path)
      }
      ctx.restore()
    }

    /** Ferries arc; land legs run straight between stations. */
    function pathFor(leg) {
      const a = P(leg.from)
      const b = P(leg.to)

      /* Where we have the real alignment, draw the real alignment. The Death
       * Railway follows the Kwai because that is where it goes; the spine bends
       * through Isan for the same reason. Legs with no geometry — the whole
       * Laos–China Railway, which postdates this data — stay straight, which
       * says plainly that we know the endpoints and not the route. */
      const track = rails[`${leg.from}|${leg.to}`]
      if (track) {
        return { a, b, ctrl: null, via: track.map(([lon, lat]) => Proj.project(view, lon, lat)) }
      }

      if (leg.mode !== 'ferry') return { a, b, ctrl: null }
      const mx = (a.x + b.x) / 2
      const my = (a.y + b.y) / 2
      const dx = b.x - a.x
      const dy = b.y - a.y
      const len = Math.hypot(dx, dy) || 1
      const bow = Math.min(26, len * 0.16)
      return { a, b, ctrl: { x: mx - (dy / len) * bow, y: my + (dx / len) * bow } }
    }

    function strokePath(p, style, color, width, alpha = 1) {
      ctx.save()
      ctx.globalAlpha = alpha
      ctx.strokeStyle = color
      ctx.lineWidth = width
      ctx.lineCap = style.dash.length ? 'butt' : 'round'
      ctx.setLineDash(style.dash.map(d => d * (width / 3)))
      ctx.beginPath()
      if (p.via) {
        ctx.moveTo(p.via[0].x, p.via[0].y)
        for (let i = 1; i < p.via.length; i++) ctx.lineTo(p.via[i].x, p.via[i].y)
      } else {
        ctx.moveTo(p.a.x, p.a.y)
        if (p.ctrl) ctx.quadraticCurveTo(p.ctrl.x, p.ctrl.y, p.b.x, p.b.y)
        else ctx.lineTo(p.b.x, p.b.y)
      }
      ctx.stroke()
      ctx.restore()
    }

    /* Cut a path off partway along, for the route's draw-in animation. A
     * polyline has to be walked by length rather than lerped end to end, or a
     * winding leg would animate at a wildly different speed from a straight
     * one and arrive early. */
    function truncate(p, frac) {
      if (frac >= 1) return p
      if (!p.via) {
        return {
          a: p.a,
          ctrl: p.ctrl,
          b: { x: p.a.x + (p.b.x - p.a.x) * frac, y: p.a.y + (p.b.y - p.a.y) * frac },
        }
      }
      const seg = []
      let total = 0
      for (let i = 1; i < p.via.length; i++) {
        const d = Math.hypot(p.via[i].x - p.via[i - 1].x, p.via[i].y - p.via[i - 1].y)
        seg.push(d)
        total += d
      }
      let want = total * frac
      const out = [p.via[0]]
      for (let i = 0; i < seg.length; i++) {
        if (want >= seg[i]) {
          out.push(p.via[i + 1])
          want -= seg[i]
          continue
        }
        const t = seg[i] ? want / seg[i] : 0
        out.push({
          x: p.via[i].x + (p.via[i + 1].x - p.via[i].x) * t,
          y: p.via[i].y + (p.via[i + 1].y - p.via[i].y) * t,
        })
        break
      }
      return { a: p.a, b: out[out.length - 1], ctrl: null, via: out }
    }

    /* The unused network, as three paths instead of two hundred and thirty-two.
     *
     * It is static geometry — every leg not on the current route — so like the
     * coastline it can be laid out once in world coordinates and projected by
     * the canvas. Drawn leg by leg it was a save, a restore, a setLineDash, a
     * beginPath and a stroke apiece, every frame of every drag, to produce the
     * same lattice each time. Rebuilt only when the route changes, which is
     * when the set of unused legs actually changes. */
    let lattice = null

    function idleLattice(usedLegs) {
      if (lattice && lattice.for === state.route) return lattice
      const paths = { rail: new Path2D(), ferry: new Path2D(), road: new Path2D() }
      const wx = id => network.stations[id].lon
      const wy = id => Proj.screenY(network.stations[id].lat)

      for (const leg of network.legs) {
        if (usedLegs.has(leg)) continue
        const path = paths[leg.mode] || paths.road
        const track = rails[`${leg.from}|${leg.to}`]
        if (track) {
          path.moveTo(track[0][0], Proj.screenY(track[0][1]))
          for (let i = 1; i < track.length; i++) {
            path.lineTo(track[i][0], Proj.screenY(track[i][1]))
          }
          continue
        }
        const ax = wx(leg.from)
        const ay = wy(leg.from)
        const bx = wx(leg.to)
        const by = wy(leg.to)
        path.moveTo(ax, ay)
        if (leg.mode !== 'ferry') {
          path.lineTo(bx, by)
          continue
        }
        /* The ferry's bow, in degrees rather than pixels. Its cap used to be 26
         * screen pixels, which made the arc flatten as you zoomed in; in world
         * units it keeps its shape, which is the more honest drawing of a route
         * that does not change when you look closer. */
        const dx = bx - ax
        const dy = by - ay
        const len = Math.hypot(dx, dy) || 1
        const bow = Math.min(26 / (view.baseScale || 1), len * 0.16)
        path.quadraticCurveTo(
          (ax + bx) / 2 - (dy / len) * bow,
          (ay + by) / 2 + (dx / len) * bow,
          bx,
          by
        )
      }
      lattice = { for: state.route, paths }
      return lattice
    }

    function drawIdleNetwork(usedLegs) {
      const { paths } = idleLattice(usedLegs)
      ctx.save()
      ctx.transform(view.scale, 0, 0, view.scale, view.dx, view.dy)
      ctx.strokeStyle = colors.idle
      for (const mode of ['rail', 'ferry', 'road']) {
        const style = STYLE[mode]
        const width = mode === 'rail' ? 1.6 : 1.2
        // Divided by the scale, so a hairline stays a hairline and a dash stays
        // the same length on the glass however far in the map is zoomed.
        ctx.lineWidth = width / view.scale
        ctx.lineCap = style.dash.length ? 'butt' : 'round'
        ctx.setLineDash(style.dash.map(d => (d * (width / 3)) / view.scale))
        ctx.stroke(paths[mode])
      }
      ctx.setLineDash([])
      ctx.restore()
    }

    /* The sights, drawn where they actually are rather than on the railhead
     * that serves them. Angkor is a hundred kilometres from Sisophon and Lake
     * Toba is a hundred from Medan; putting either on top of its station would
     * be the same lie the rest of this project spends its time refusing.
     *
     * A hollow diamond, so it never reads as a station — the whole point is
     * that these are places you go, not places a train stops. */
    function drawLandmarks(zoom) {
      if (!landmarks.length) return
      const r = zoom < 1.6 ? 2.6 : 3.4
      ctx.save()
      ctx.strokeStyle = colors.landmark
      ctx.lineWidth = 1.3
      ctx.globalAlpha = zoom < 1.3 ? 0.7 : 1
      for (const lm of landmarks) {
        if (lm.lat == null) continue
        const p = Proj.project(view, lm.lon, lm.lat)
        if (p.x < -20 || p.x > view.w + 20 || p.y < -20 || p.y > view.h + 20) continue
        ctx.beginPath()
        ctx.moveTo(p.x, p.y - r)
        ctx.lineTo(p.x + r, p.y)
        ctx.lineTo(p.x, p.y + r)
        ctx.lineTo(p.x - r, p.y)
        ctx.closePath()
        ctx.stroke()
      }
      ctx.restore()
    }

    function drawIdleStations(routeSet) {
      const zoom = view.scale / view.baseScale
      for (const [id, s] of Object.entries(network.stations)) {
        if (routeSet.has(id)) continue
        if (s.minor && zoom < 2.2) continue
        const p = Proj.project(view, s.lon, s.lat)
        ctx.beginPath()
        ctx.arc(p.x, p.y, s.hub ? 3 : 2, 0, Math.PI * 2)
        ctx.fillStyle = colors.idleDot
        ctx.fill()
      }
    }

    /** Partial-length drawing so the route can animate in along its own length. */
    function drawRoute() {
      if (!state.route) return
      const legs = state.route.legs
      const total = legs.reduce((n, e) => n + e.leg.hours, 0) || 1
      let drawn = 0
      const target = state.progress * total

      legs.forEach((entry, i) => {
        const leg = entry.leg
        if (drawn >= target) return
        const frac = Math.min(1, (target - drawn) / leg.hours)
        drawn += leg.hours

        const color = colors[leg.mode]
        const style = STYLE[leg.mode]
        const focused = state.focusLeg === i
        const dim = state.focusLeg != null && !focused

        // One leg is one vehicle but several segments of track, so it draws as
        // a polyline through the stations it calls at.
        const steps = leg.steps
        const cut = frac * steps.length
        steps.forEach((step, k) => {
          if (k >= cut) return
          const partial = Math.min(1, cut - k)
          const end = truncate(pathFor(step), partial)
          // Halo keeps the line legible where it crosses a coastline.
          strokePath(end, style, colors.sea, style.width + 4, dim ? 0.35 : 0.9)
          strokePath(end, style, color, focused ? style.width + 1.6 : style.width, dim ? 0.35 : 1)
        })
      })
    }

    function drawRouteStations() {
      if (!state.route) return
      const stops = state.route.stopIds || state.route.stationIds

      // Intermediate calls get a plain dot; the stations where you actually
      // change vehicles get a ring, because those are the decisions.
      for (const id of state.route.stationIds) {
        if (stops.includes(id)) continue
        const s = network.stations[id]
        const p = Proj.project(view, s.lon, s.lat)
        ctx.beginPath()
        ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2)
        ctx.fillStyle = colors.rail
        ctx.fill()
      }

      stops.forEach((id, i) => {
        const s = network.stations[id]
        const p = Proj.project(view, s.lon, s.lat)
        const terminal = i === 0 || i === stops.length - 1
        const r = terminal ? 6.5 : 4.5

        ctx.beginPath()
        ctx.arc(p.x, p.y, r + 2.5, 0, Math.PI * 2)
        ctx.fillStyle = colors.sea
        ctx.fill()

        ctx.beginPath()
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
        ctx.fillStyle = terminal ? colors.rail : colors.panel
        ctx.fill()
        ctx.lineWidth = 2
        ctx.strokeStyle = colors.rail
        ctx.stroke()
      })

      // Border markers sit on top of everything, because they are the thing
      // most likely to end the journey.
      for (const entry of state.route.legs) {
        for (const step of entry.leg.steps) {
          if (!step.border) continue
          drawBorderMark(P(step.from), P(step.to))
        }
      }
    }

    function drawBorderMark(a, b) {
      const size = 5
      ctx.save()
      ctx.translate((a.x + b.x) / 2, (a.y + b.y) / 2)
      ctx.rotate(Math.PI / 4)
      ctx.fillStyle = colors.alert
      ctx.strokeStyle = colors.sea
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.rect(-size, -size, size * 2, size * 2)
      ctx.stroke()
      ctx.fill()
      ctx.restore()
    }

    function drawLabels() {
      const zoom = view.scale / view.baseScale
      const placed = []
      const overlaps = box =>
        placed.some(
          b =>
            box.x < b.x + b.w && box.x + box.w > b.x && box.y < b.y + b.h && box.y + box.h > b.y
        )

      const routeIds = state.route ? state.route.stopIds || state.route.stationIds : []
      const candidates = []

      routeIds.forEach((id, i) => {
        candidates.push({ id, priority: i === 0 || i === routeIds.length - 1 ? 0 : 1 })
      })
      for (const [id, s] of Object.entries(network.stations)) {
        if (routeIds.includes(id)) continue
        if (s.hub) candidates.push({ id, priority: 2 })
        else if (zoom > 2.6 && !s.minor) candidates.push({ id, priority: 3 })
      }
      candidates.sort((a, b) => a.priority - b.priority)

      for (const c of candidates) {
        const s = network.stations[c.id]
        const p = Proj.project(view, s.lon, s.lat)
        if (p.x < -40 || p.x > view.w + 40 || p.y < -20 || p.y > view.h + 20) continue

        const onRoute = c.priority <= 1
        const weight = c.priority === 0 ? 600 : 500
        const base = c.priority === 0 ? 15 : c.priority === 1 ? 13 : 12
        const fontSize = view.w < 520 ? base - 2 : base
        ctx.font = `${weight} ${fontSize}px BarlowCond, system-ui, sans-serif`
        const text = c.priority <= 1 || sharedCities.has(s.city) ? s.name : s.city
        const w = ctx.measureText(text).width
        const h = fontSize + 4
        const right = { x: p.x + 10, y: p.y - fontSize / 2 - 2, w: w + 6, h }
        const left = { x: p.x - w - 14, y: right.y, w: w + 6, h }

        // Prefer the right of the dot, fall back to the left, and skip the
        // label entirely rather than let it run off the canvas.
        const fits = box => box.x >= 4 && box.x + box.w <= view.w - 4 && !overlaps(box)
        const box = fits(right) ? right : fits(left) ? left : null
        if (!box) continue
        placed.push(box)

        ctx.save()
        ctx.textBaseline = 'middle'
        ctx.lineWidth = 3.5
        ctx.strokeStyle = colors.sea
        ctx.globalAlpha = onRoute ? 0.95 : 0.7
        ctx.strokeText(text, box.x + 3, p.y)
        ctx.fillStyle = onRoute ? colors.ink : colors.muted
        ctx.fillText(text, box.x + 3, p.y)
        ctx.restore()
      }
    }

    function buildHitTargets() {
      hit = { stations: [], segments: [], landmarks: [] }
      for (const [id, s] of Object.entries(network.stations)) {
        const p = Proj.project(view, s.lon, s.lat)
        hit.stations.push({ id, x: p.x, y: p.y, station: s })
      }
      for (const lm of landmarks) {
        if (lm.lat == null) continue
        const p = Proj.project(view, lm.lon, lm.lat)
        hit.landmarks.push({ x: p.x, y: p.y, landmark: lm })
      }
      if (state.route) {
        state.route.legs.forEach((entry, i) => {
          for (const step of entry.leg.steps) {
            hit.segments.push({ index: i, a: P(step.from), b: P(step.to), entry })
          }
        })
      }
    }

    function draw() {
      if (!view) return
      if (pending) {
        cancelAnimationFrame(pending)
        pending = null
      }
      setBacking(moving ? SOFT : SHARP())
      colors = themeColors(document.documentElement)
      const used = new Set(state.route ? state.route.legs.map(e => e.leg) : [])
      const routeSet = new Set(state.route ? state.route.stationIds : [])

      const zoom = view.scale / view.baseScale
      drawBasemap()
      drawIdleNetwork(used)
      drawLandmarks(zoom)
      drawIdleStations(routeSet)
      drawRoute()
      drawRouteStations()
      drawLabels()
      buildHitTargets()
    }

    /* One draw per displayed frame, not one per event.
     *
     * A finger dragging across a phone screen produces pointermove far faster
     * than the display refreshes — and Chrome coalesces several into one event
     * that still arrives as one call. Drawing on each of them spends the whole
     * frame budget rendering pictures nobody sees, and the queue only grows,
     * so the map falls further behind the finger the longer you drag. */
    function schedule() {
      moves++
      moving = true
      if (pending) return
      pending = requestAnimationFrame(() => {
        pending = null
        const seq = moves
        draw()

        /* Settling is decided by whether anything moved, not by a stopwatch.
         *
         * A timer has to be given a length, and there is no length that is
         * right: pick 90ms and on a phone drawing at eight frames a second the
         * timer expires between every pair of frames, so the expensive pass
         * runs on all of them — the machine that can least afford the full
         * quality frame is the only one that always draws it. Waiting one frame
         * and asking "did the finger move?" costs nothing and is right at every
         * speed. */
        if (quality) cancelAnimationFrame(quality)
        quality = requestAnimationFrame(() => {
          quality = null
          if (moves !== seq) return // still going; the next frame asks again
          moving = false
          draw()
        })
      })
    }

    /* Anything that reads what is on screen has to see the frame that is owed,
     * not the one before it. */
    function flush() {
      if (!pending) return
      cancelAnimationFrame(pending)
      pending = null
      draw()
    }

    /** A draw that is not part of a gesture, and so is never the cheap one. */
    function drawNow() {
      moving = false
      draw()
    }

    /* ---------------------------------------------------------- animation */

    function animateIn() {
      if (raf) cancelAnimationFrame(raf)
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        state.progress = 1
        draw()
        return
      }
      state.progress = 0
      const start = performance.now()
      const duration = 900
      const step = now => {
        const t = Math.min(1, (now - start) / duration)
        // easeOutCubic: quick commitment, gentle arrival
        state.progress = 1 - Math.pow(1 - t, 3)
        draw()
        if (t < 1) raf = requestAnimationFrame(step)
        else raf = null
      }
      raf = requestAnimationFrame(step)
    }

    /* ------------------------------------------------------------ hit test */

    function distToSegment(px, py, a, b) {
      const dx = b.x - a.x
      const dy = b.y - a.y
      const len2 = dx * dx + dy * dy
      if (!len2) return Math.hypot(px - a.x, py - a.y)
      let t = ((px - a.x) * dx + (py - a.y) * dy) / len2
      t = Math.max(0, Math.min(1, t))
      return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy))
    }

    /* Whichever is actually nearer, with a few pixels of preference for the
     * station. An absolute station-first rule made Angkor unreachable at any
     * sane zoom — the Siem Reap terminal sits six kilometres away, which is
     * inside the station's own radius until you are zoomed almost to the cap,
     * and Angkor is the single sight people most want to point at. The bias
     * keeps the station winning when the two are genuinely on the same pixel
     * and you cannot be aiming at either in particular. */
    const STATION_BIAS = 5

    function pick(x, y) {
      // Hit targets are a by-product of drawing, so a frame still owed would
      // have this testing against where things were, not where they are.
      flush()
      let bestStation = null
      let bestD = 14
      for (const s of hit.stations) {
        const d = Math.hypot(x - s.x, y - s.y)
        if (d < bestD) {
          bestD = d
          bestStation = s
        }
      }

      let bestLm = null
      let bestLmD = 12
      for (const l of hit.landmarks) {
        const d = Math.hypot(x - l.x, y - l.y)
        if (d < bestLmD) {
          bestLmD = d
          bestLm = l
        }
      }

      if (bestStation && (!bestLm || bestD <= bestLmD + STATION_BIAS)) {
        return { type: 'station', ...bestStation }
      }
      if (bestLm) return { type: 'landmark', ...bestLm }

      let bestSeg = null
      let bestSegD = 10
      for (const s of hit.segments) {
        const d = distToSegment(x, y, s.a, s.b)
        if (d < bestSegD) {
          bestSegD = d
          bestSeg = s
        }
      }
      if (bestSeg) return { type: 'leg', ...bestSeg }
      return null
    }

    /* ------------------------------------------------------------- public */

    return {
      resize() {
        size()
        drawNow()
      },
      /* Where a lon/lat currently sits on screen, in CSS pixels, or null if it
       * is off the canvas. The map is the only thing that knows the live view,
       * so anything that needs to point at a place — a test driving the real
       * pointer, a future "show me this on the map" link — has to ask it. */
      locate(lon, lat) {
        if (!view) return null
        const p = Proj.project(view, lon, lat)
        if (p.x < 0 || p.y < 0 || p.x > view.w || p.y > view.h) return null
        return { x: p.x, y: p.y }
      },
      /* A short string that changes whenever the view pans or zooms. Cheaper to
       * compare than the view itself, and it is what tells a test whether a
       * scroll moved the map when it should have moved the page. */
      viewSignature() {
        if (!view) return 'none'
        return [view.scale, view.dx, view.dy].map(n => Math.round(n * 100) / 100).join(',')
      },
      setInset(next) {
        inset = { left: 0, right: 0, top: 0, bottom: 0, ...next }
      },
      setRoute(route, animate = true) {
        state.route = route
        state.focusLeg = null
        if (route && route.stationIds.length) {
          const pts = route.stationIds.map(id => network.stations[id])
          const rect = canvas.getBoundingClientRect()
          const pad = rect.width < 700 ? 40 : 70
          view = fitVisible(rect, (strip, tall) =>
            Proj.fitPoints({ ...view, w: strip, h: tall }, pts, pad)
          )
        }
        if (animate) animateIn()
        else {
          state.progress = 1
          drawNow()
        }
      },
      focusLeg(index) {
        if (state.focusLeg === index) return
        state.focusLeg = index
        drawNow()
      },
      /* Returns how much of the drag the map actually took. The clamp can
       * refuse some or all of it, and the caller needs to know what is left
       * over — on a phone the page behind the map is what gets the remainder,
       * so a finger that runs the map into its own edge carries on scrolling
       * the itinerary instead of dying against it. */
      panBy(dx, dy) {
        const fromX = view.dx
        const fromY = view.dy
        view = Proj.clamp(Proj.pan(view, dx, dy), reach)
        schedule()
        return { dx: view.dx - fromX, dy: view.dy - fromY }
      },
      zoomAt(x, y, factor) {
        view = Proj.clamp(Proj.zoomAt(view, x, y, factor), reach)
        schedule()
      },
      resetView() {
        view = baseView(canvas.getBoundingClientRect())
        drawNow()
      },
      pick,
      redraw: drawNow,
    }
  }

  return { create, STYLE }
})()
