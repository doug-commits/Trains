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

  function create(canvas, network, basemap, landmarks = []) {
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
    // The controls and the itinerary panel overlay the map on wide screens, so
    // a route fitted to the full canvas ends up half-hidden behind them.
    let inset = { left: 0, right: 0 }

    /** Fit into the strip the overlays leave visible, then shift it into place. */
    function fitVisible(rect, fit) {
      const strip = Math.max(240, rect.width - inset.left - inset.right)
      const fitted = fit(strip)
      return {
        ...fitted,
        w: rect.width,
        h: rect.height,
        dx: fitted.dx + inset.left,
      }
    }

    function baseView(rect) {
      const pad = rect.width < 700 ? 12 : 28
      return fitVisible(rect, strip => Proj.create(basemap.bbox, strip, rect.height, pad))
    }

    function size() {
      const rect = canvas.getBoundingClientRect()
      const dpr = Math.min(3, window.devicePixelRatio || 1)
      canvas.width = Math.max(1, Math.round(rect.width * dpr))
      canvas.height = Math.max(1, Math.round(rect.height * dpr))
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

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

    /* Darkens the corners so the eye settles in the middle where the route is.
     * Drawn on the ground rather than over everything, so it never dims a leg. */
    function drawVignette() {
      const g = ctx.createRadialGradient(
        view.w / 2, view.h / 2, Math.min(view.w, view.h) * 0.32,
        view.w / 2, view.h / 2, Math.max(view.w, view.h) * 0.78
      )
      g.addColorStop(0, 'rgba(0,0,0,0)')
      g.addColorStop(1, colors.seaDeep)
      ctx.save()
      ctx.globalAlpha = 0.5
      ctx.fillStyle = g
      ctx.fillRect(0, 0, view.w, view.h)
      ctx.restore()
    }

    function drawBasemap() {
      // A sea that deepens toward the bottom of the frame. One flat fill across
      // two thirds of the viewport is the least interesting thing a map can do.
      const sky = ctx.createLinearGradient(0, 0, 0, view.h)
      sky.addColorStop(0, colors.sea)
      sky.addColorStop(1, colors.seaDeep)
      ctx.fillStyle = sky
      ctx.fillRect(0, 0, view.w, view.h)

      drawGraticule()
      drawVignette()

      ctx.lineJoin = 'round'

      /* All the land as one path, filled once with a soft shadow so the glow
       * lands in the water and not along every internal frontier. The country
       * outlines are stroked separately afterwards. */
      const all = new Path2D()
      const paths = []
      for (const country of basemap.countries) {
        const path = new Path2D()
        for (const ring of country.rings) {
          for (let i = 0; i < ring.length; i++) {
            const p = Proj.project(view, ring[i][0], ring[i][1])
            if (i === 0) path.moveTo(p.x, p.y)
            else path.lineTo(p.x, p.y)
          }
          path.closePath()
        }
        paths.push(path)
        all.addPath(path)
      }

      ctx.save()
      ctx.shadowColor = colors.coast
      ctx.shadowBlur = 16
      ctx.fillStyle = colors.land
      ctx.fill(all)
      ctx.restore()
      // Again without the shadow, so the interior is the flat land colour.
      ctx.fillStyle = colors.land
      ctx.fill(all)

      ctx.strokeStyle = colors.landEdge
      ctx.lineWidth = 0.8
      for (const path of paths) ctx.stroke(path)
    }

    /** Ferries arc; land legs run straight between stations. */
    function pathFor(leg) {
      const a = P(leg.from)
      const b = P(leg.to)
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
      ctx.moveTo(p.a.x, p.a.y)
      if (p.ctrl) ctx.quadraticCurveTo(p.ctrl.x, p.ctrl.y, p.b.x, p.b.y)
      else ctx.lineTo(p.b.x, p.b.y)
      ctx.stroke()
      ctx.restore()
    }

    function drawIdleNetwork(usedLegs) {
      for (const leg of network.legs) {
        if (usedLegs.has(leg)) continue
        const p = pathFor(leg)
        strokePath(p, STYLE[leg.mode], colors.idle, leg.mode === 'rail' ? 1.6 : 1.2, 1)
      }
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
          const p = pathFor(step)
          const end =
            partial >= 1
              ? p
              : {
                  a: p.a,
                  ctrl: p.ctrl,
                  b: {
                    x: p.a.x + (p.b.x - p.a.x) * partial,
                    y: p.a.y + (p.b.y - p.a.y) * partial,
                  },
                }
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
        draw()
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
      setInset(next) {
        inset = { left: 0, right: 0, ...next }
      },
      setRoute(route, animate = true) {
        state.route = route
        state.focusLeg = null
        if (route && route.stationIds.length) {
          const pts = route.stationIds.map(id => network.stations[id])
          const rect = canvas.getBoundingClientRect()
          const pad = rect.width < 700 ? 40 : 70
          view = fitVisible(rect, strip =>
            Proj.fitPoints({ ...view, w: strip }, pts, pad)
          )
        }
        if (animate) animateIn()
        else {
          state.progress = 1
          draw()
        }
      },
      focusLeg(index) {
        if (state.focusLeg === index) return
        state.focusLeg = index
        draw()
      },
      panBy(dx, dy) {
        view = Proj.pan(view, dx, dy)
        draw()
      },
      zoomAt(x, y, factor) {
        view = Proj.zoomAt(view, x, y, factor)
        draw()
      },
      resetView() {
        view = baseView(canvas.getBoundingClientRect())
        draw()
      },
      pick,
      redraw: draw,
    }
  }

  return { create, STYLE }
})()
