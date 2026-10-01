/* The website's map, on Google Maps.
 *
 * The canvas map in map.js draws everything itself, which is what lets the app
 * run with no network at all. On a phone browser that came at a cost readers
 * noticed: a schematic coastline and small canvas labels, panned by our own
 * gesture code rather than by a map engine that has spent fifteen years on
 * exactly that. This gives the website Google's basemap and Google's gestures
 * and draws the network on top of it.
 *
 * It implements the same interface as MapView — setRoute, focusLeg, setInset,
 * zoomCentre, resetView and the rest — so app.js does not need to know which
 * one it is talking to. The canvas map is still there underneath: it paints
 * first, it is what the app ships, and it is what the site falls back to when
 * Google cannot load. A blank grey rectangle where the map should be is the
 * one outcome worse than either map.
 *
 * Lines are Google polylines. Dots — stations, crossings, the reader — are
 * page elements on one OverlayView of our own. They began as symbols on a
 * one-point polyline, which keeps a fixed pixel size and needs no Map ID, and
 * on a real phone nobody could see them: a line a centimetre long is below a
 * pixel at any zoom a reader uses, Google drops it, and its symbol goes with
 * it. Where one did survive, the thing that took the tap was that centimetre
 * of line, not the dot. An element is drawn because we drew it, is exactly
 * as big as we say, and its tap target is a size a finger can find.
 */

const GoogleMapView = (() => {
  const MODES = {
    rail: { weight: 4 },
    ferry: { weight: 3, dash: '12px' },
    road: { weight: 3, dot: '8px' },
  }

  function create(container, network, rails, opts = {}) {
    const g = google.maps
    const tok = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim()
    const ll = s => ({ lat: s.lat, lng: s.lon })

    let inset = { top: 0, right: 0, bottom: 0, left: 0 }
    let route = null
    let focus = null
    let idle = []
    let drawn = []
    let legLines = []
    let user = null
    let you = []

    const everywhere = new g.LatLngBounds()
    for (const s of Object.values(network.stations)) everywhere.extend(ll(s))

    /* Colours come from the page's own tokens, read at draw time, so the map
       follows the theme toggle and the two themes cannot drift from the CSS. */
    function styles() {
      const land = tok('--land')
      const sea = tok('--sea')
      const edge = tok('--land-edge')
      const muted = tok('--muted')
      const ink = tok('--ink-soft')
      const halo = tok('--label-halo') || sea
      return [
        { elementType: 'geometry', stylers: [{ color: land }] },
        { elementType: 'labels.text.fill', stylers: [{ color: muted }] },
        { elementType: 'labels.text.stroke', stylers: [{ color: halo }, { weight: 3 }] },
        { featureType: 'water', elementType: 'geometry', stylers: [{ color: sea }] },
        { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: muted }] },
        // Places are what a reader navigates by; everything else is clutter
        // competing with the route.
        { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: ink }] },
        { featureType: 'administrative.country', elementType: 'geometry.stroke', stylers: [{ color: edge }, { weight: 1.2 }] },
        { featureType: 'administrative.country', elementType: 'labels.text.fill', stylers: [{ color: ink }] },
        { featureType: 'poi', stylers: [{ visibility: 'off' }] },
        { featureType: 'road', elementType: 'geometry', stylers: [{ color: edge }, { visibility: 'simplified' }] },
        { featureType: 'road', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
        { featureType: 'road.local', stylers: [{ visibility: 'off' }] },
        { featureType: 'transit', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
        { featureType: 'transit.line', elementType: 'geometry', stylers: [{ color: edge }] },
      ]
    }

    const map = new g.Map(container, {
      disableDefaultUI: true,
      // One finger pans. "cooperative" would demand two on a phone, which is
      // the opposite of the smoothness this exists for.
      gestureHandling: 'greedy',
      // Google's own place popups would compete with ours.
      clickableIcons: false,
      backgroundColor: tok('--sea'),
      styles: styles(),
      minZoom: 3,
      maxZoom: 16,
    })

    // Container pixels from lat/lng: the same space as the canvas's offsetX/Y,
    // because #gmap sits exactly over the canvas.
    const overlay = new g.OverlayView()
    overlay.onAdd = overlay.draw = overlay.onRemove = () => {}
    overlay.setMap(map)
    const toPixel = latLng => {
      const proj = overlay.getProjection()
      if (!proj) return null
      const p = proj.fromLatLngToContainerPixel(latLng)
      return p ? { x: p.x, y: p.y } : null
    }

    /* The dots' layer. Google moves its panes with the map while it pans, so
       the elements only need placing again when the projection changes —
       which is when Google calls draw. overlayMouseTarget is the pane that
       receives pointer events, and it sits above every polyline. */
    const pins = new Set()
    const layer = document.createElement('div')
    layer.className = 'gpins'
    layer.setAttribute('aria-hidden', 'true')
    const pinLayer = new g.OverlayView()
    const place = pin => {
      const proj = pinLayer.getProjection()
      const p = proj && proj.fromLatLngToDivPixel(new g.LatLng(pin.at.lat, pin.at.lng))
      if (p) pin.el.style.transform = `translate(${p.x}px,${p.y}px)`
    }
    /* How big the station badges are depends on how far out the map is: at
       the whole-region view two hundred full badges would be a carpet with
       Bangkok buried under it, so the small stations shrink to dots and only
       the hubs keep their pictogram. */
    const setScale = () => {
      const z = map.getZoom() || 5
      const band = z <= 4 ? 'region' : z <= 5 ? 'far' : z <= 7 ? 'mid' : 'near'
      if (layer.dataset.z === band) return
      layer.dataset.z = band
      for (const p of pins) if (p.el.dataset.tier) sizeBadge(p)
    }
    setScale()
    pinLayer.onAdd = () => pinLayer.getPanes().overlayMouseTarget.appendChild(layer)
    pinLayer.draw = () => pins.forEach(place)
    pinLayer.onRemove = () => layer.remove()
    pinLayer.setMap(map)

    /* The inset app.js reports is measured against the full stage, as the
       canvas needs. This map's box already stops short of the panel and the
       sheet, so whatever of the inset its own edges already exclude is not
       subtracted twice — otherwise a route would be fitted into a strip half
       the width it actually has. */
    const padding = () => {
      const host = container.getBoundingClientRect()
      const wrap = (container.parentElement || container).getBoundingClientRect()
      const coverR = Math.max(0, wrap.right - host.right)
      const coverB = Math.max(0, wrap.bottom - host.bottom)
      return {
        top: inset.top + 24,
        left: inset.left + 24,
        right: Math.max(0, inset.right - coverR) + 24,
        bottom: Math.max(0, inset.bottom - coverB) + 24,
      }
    }

    let touched = false
    map.addListener('dragstart', () => {
      touched = true
      opts.onMove && opts.onMove()
    })
    map.addListener('zoom_changed', () => {
      setScale()
      opts.onMove && opts.onMove()
    })
    map.addListener('click', () => opts.onEmpty && opts.onEmpty())

    /* The real alignment where the data has one, in whichever direction it is
       stored; a straight line where it does not, which says plainly that we
       know the endpoints and not the route. */
    function pathOf(from, to) {
      const a = network.stations[from]
      const b = network.stations[to]
      const fwd = rails[`${from}|${to}`]
      if (fwd) return fwd.map(([lng, lat]) => ({ lat, lng }))
      const back = rails[`${to}|${from}`]
      if (back) return back.slice().reverse().map(([lng, lat]) => ({ lat, lng }))
      return [ll(a), ll(b)]
    }

    function line(path, mode, color, weight, opacity, z) {
      const m = MODES[mode] || MODES.road
      const o = { path, map, clickable: false, zIndex: z, strokeColor: color, strokeOpacity: opacity, strokeWeight: weight }
      if (m.dash) {
        o.strokeOpacity = 0
        o.icons = [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: opacity, strokeColor: color, strokeWeight: weight, scale: weight }, offset: '0', repeat: m.dash }]
      } else if (m.dot) {
        o.strokeOpacity = 0
        o.icons = [{ icon: { path: g.SymbolPath.CIRCLE, fillColor: color, fillOpacity: opacity, strokeOpacity: 0, scale: weight * 0.55 }, offset: '0', repeat: m.dot }]
      }
      return new g.Polyline(o)
    }

    /* One element on the map at one point, placed and kept placed by the
       layer. With an id it is a station: a button that a tap, a click or a
       hover reaches the planner through, with a target at least 32px across
       whatever is drawn inside it. */
    function pin(at, { z, id, inner, hit, cls = '', data = {} }) {
      const el = document.createElement(id ? 'button' : 'span')
      el.className = 'gpin' + (cls ? ' ' + cls : '')
      const size = id ? Math.max(32, hit || 0) : hit
      el.style.cssText = `width:${size}px;height:${size}px;margin:${-size / 2}px 0 0 ${-size / 2}px;z-index:${z}`
      for (const [k, v] of Object.entries(data)) el.dataset[k] = v
      el.appendChild(inner)
      const p = { el, at, setMap: m => { if (!m) { pins.delete(p); el.remove() } } }

      if (id) {
        const s = network.stations[id]
        el.type = 'button'
        el.tabIndex = -1
        el.dataset.id = id
        el.setAttribute('aria-label', s ? s.name : id)
        // The map's own click would read this as a tap on empty ground and
        // close the popup the tap has just opened.
        if (g.OverlayView.preventMapHitsFrom) g.OverlayView.preventMapHitsFrom(el)
        let down = null
        const where = () => toPixel(new g.LatLng(at.lat, at.lng)) || { x: 0, y: 0 }
        el.addEventListener('pointerdown', e => {
          down = { x: e.clientX, y: e.clientY, touch: e.pointerType !== 'mouse' }
        })
        el.addEventListener('click', e => {
          e.stopPropagation()
          // A drag that began on a station is a pan, not a choice.
          if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8) return
          const q = where()
          opts.onStation && opts.onStation(id, q.x, q.y, down ? down.touch : false)
          down = null
        })
        // A mouse gets the popup on hover, as it does on the canvas map.
        el.addEventListener('pointerenter', e => {
          if (e.pointerType !== 'mouse' || !opts.onHover) return
          const q = where()
          opts.onHover(id, q.x, q.y)
        })
      }
      pins.add(p)
      layer.appendChild(el)
      place(p)
      return p
    }

    /* A plain fixed-pixel mark: the reader's position, a border crossing.
       `scale` is its radius, as it was for the map symbol it replaced. */
    function dot(at, { fill, stroke, scale, z, shape }) {
      const mark = document.createElement('i')
      // A diamond's points are `scale` from its centre, so its sides are
      // shorter by root two before it is turned.
      const d = shape === 'diamond' ? (scale * 2) / Math.SQRT2 : scale * 2
      mark.style.cssText =
        `width:${d}px;height:${d}px;background:${fill};` +
        (stroke ? `box-shadow:0 0 0 1.6px ${stroke};` : '') +
        (shape === 'diamond' ? 'border-radius:1px;transform:rotate(45deg)' : '')
      return pin(at, { z, inner: mark, hit: scale * 2 + 4 })
    }

    const kind = Badges.kinds(network)

    /* A station as a small transit sign (badges.js). `role` is where it
       stands relative to the route on screen; its size follows the zoom, so
       it is set here and again whenever the zoom band changes. */
    function sizeBadge(p) {
      const { tier, role } = p.el.dataset
      const band = layer.dataset.z
      const px = Badges.size(tier, role, band)
      const b = p.el.firstElementChild
      b.style.setProperty('--s', px + 'px')
      p.el.hidden = !px
      b.classList.toggle('plain', Badges.plain(tier, role, band))
    }

    function badge(id, role) {
      const st = network.stations[id]
      const k = kind[id] || 'rail'
      const bg = tok(`--${k}`) || tok('--rail')
      const ink = Badges.inkFor(bg, tok('--sea'))
      const ring = Badges.ringFor(tok('--land'), tok('--sea'))
      const b = document.createElement('i')
      b.className = 'gst'
      b.style.cssText = `background:${bg};--ring:${ring}`
      b.innerHTML = Badges.svg(k, ink, bg)
      const tier = Badges.tierOf(st)
      const z = { end: 10, stop: 8, pass: 7, idle: 3, dim: 2 }[role] + (tier === 'hub' ? 0.5 : tier === 'minor' ? -0.5 : 0)
      const p = pin(ll(st), {
        id,
        z: Math.round(z * 2),
        hit: role === 'end' ? 40 : 32,
        cls: 'gpin-st',
        inner: b,
        data: { tier, role, kind: k },
      })
      sizeBadge(p)
      return p
    }

    const clear = list => {
      for (const o of list) o.setMap(null)
      list.length = 0
    }

    function drawIdle() {
      clear(idle)
      const used = new Set(route ? route.legs.map(e => e.leg) : [])
      for (const leg of network.legs) {
        if (used.has(leg)) continue
        idle.push(line(pathOf(leg.from, leg.to), leg.mode, tok('--idle-line'), 1.6, 0.55, 1))
      }
      const on = new Set(route ? route.stationIds : [])
      for (const [id, s] of Object.entries(network.stations)) {
        if (on.has(id)) continue
        idle.push(badge(id, route ? 'dim' : 'idle'))
      }
    }

    function drawRoute() {
      clear(drawn)
      legLines = []
      if (!route) return
      route.legs.forEach((entry, i) => {
        const leg = entry.leg
        const color = tok(`--${leg.mode}`) || tok('--rail')
        const w = (MODES[leg.mode] || MODES.road).weight
        const lit = focus === i
        const dim = focus != null && !lit
        const mine = []
        for (const step of leg.steps) {
          const path = pathOf(step.from, step.to)
          // A casing in the sea colour under every line, so the route reads
          // against busy terrain the way it reads against the canvas ground.
          mine.push(new g.Polyline({ path, map, clickable: false, zIndex: 5, strokeColor: tok('--sea'), strokeOpacity: dim ? 0.3 : 0.85, strokeWeight: w + 4 }))
          mine.push(line(path, leg.mode, color, lit ? w + 2 : w, dim ? 0.35 : 1, 6))
          if (step.border) {
            const a = network.stations[step.from]
            const b = network.stations[step.to]
            mine.push(dot({ lat: (a.lat + b.lat) / 2, lng: (a.lon + b.lon) / 2 }, {
              fill: tok('--alert'), stroke: tok('--sea'), scale: 5.5, z: 17,
              shape: 'diamond',
            }))
          }
        }
        drawn.push(...mine)
        legLines[i] = mine
      })
      const stops = new Set(route.stopIds || route.stationIds)
      const ends = new Set([route.stationIds[0], route.stationIds[route.stationIds.length - 1]])
      for (const id of route.stationIds) {
        const s = network.stations[id]
        if (!s) continue
        drawn.push(badge(id, ends.has(id) ? 'end' : stops.has(id) ? 'stop' : 'pass'))
      }
    }

    /* The reader's own position: the blue dot, and a disc for how sure the
       phone is. Circle is sized in metres, which is exactly what an accuracy
       radius is, so it stays true at every zoom without any arithmetic. */
    function drawUser() {
      clear(you)
      if (!user) return
      const at = { lat: user.lat, lng: user.lon }
      const c = tok('--you') || '#1a73e8'
      if ((user.accuracy || 0) > 15) {
        you.push(new g.Circle({
          map, center: at, radius: user.accuracy, clickable: false, zIndex: 11,
          fillColor: c, fillOpacity: 0.14, strokeColor: c, strokeOpacity: 0.45, strokeWeight: 1,
        }))
      }
      you.push(dot(at, { fill: c, stroke: '#ffffff', scale: 7, z: 30 }))
    }

    function fitRoute() {
      if (!route || !route.stationIds.length) return
      const b = new g.LatLngBounds()
      for (const e of route.legs) {
        for (const step of e.leg.steps) for (const p of pathOf(step.from, step.to)) b.extend(p)
      }
      map.fitBounds(b, padding())
    }

    map.fitBounds(everywhere, padding())
    drawIdle()

    return {
      engine: 'google',
      map,
      resize() {},
      locate(lon, lat) {
        const p = toPixel(new g.LatLng(lat, lon))
        if (!p) return null
        const d = container.getBoundingClientRect()
        if (p.x < 0 || p.y < 0 || p.x > d.width || p.y > d.height) return null
        return p
      },
      viewSignature() {
        const c = map.getCenter()
        return c ? [map.getZoom(), c.lat().toFixed(4), c.lng().toFixed(4)].join(',') : 'none'
      },
      setInset(next) {
        inset = { top: 0, right: 0, bottom: 0, left: 0, ...next }
      },
      setRoute(next) {
        route = next
        focus = null
        touched = false
        drawIdle()
        drawRoute()
        if (route) fitRoute()
      },
      focusLeg(index) {
        if (focus === index) return
        focus = index
        drawRoute()
      },
      panBy(dx, dy) {
        map.panBy(-dx, -dy)
        return { dx, dy }
      },
      // Whole steps: Google's raster zoom is integral, and a button that moved
      // a third of a level would look like it had done nothing.
      zoomCentre(factor) {
        map.setZoom((map.getZoom() || 4) + (factor >= 1 ? 1 : -1))
      },
      zoomAt(x, y, factor) {
        map.setZoom((map.getZoom() || 4) + (factor >= 1 ? 1 : -1))
      },
      setUser(u) {
        user = u
        drawUser()
      },
      // The reader and their station together; maxZoom keeps two points a few
      // metres apart from zooming to the pavement.
      frame(points) {
        const b = new g.LatLngBounds()
        for (const p of points) b.extend({ lat: p.lat, lng: p.lon })
        map.fitBounds(b, padding())
      },
      resetView() {
        touched = false
        if (route) fitRoute()
        else map.fitBounds(everywhere, padding())
      },
      // Google hit-tests its own overlays; taps arrive through onStation.
      pick() {
        return null
      },
      redraw() {
        map.setOptions({ styles: styles(), backgroundColor: tok('--sea') })
        drawIdle()
        drawRoute()
        drawUser()
      },
      get touched() {
        return touched
      },
    }
  }

  /* Loads the Maps script once, and gives up rather than hanging. A key that
     is wrong, unbilled or not authorised for this domain does not fail the
     script load — Google calls gm_authFailure instead — so that is caught too,
     and either way the caller keeps the canvas map. */
  function load(key, timeoutMs = 8000) {
    if (window.google && window.google.maps && window.google.maps.Map) return Promise.resolve()
    return new Promise((resolve, reject) => {
      const done = (fn, v) => {
        clearTimeout(timer)
        delete window.__overlandGmapReady
        fn(v)
      }
      const timer = setTimeout(() => done(reject, new Error('google maps: timed out')), timeoutMs)
      window.gm_authFailure = () => done(reject, new Error('google maps: key rejected'))
      window.__overlandGmapReady = () => done(resolve)
      const s = document.createElement('script')
      s.async = true
      s.src =
        'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(key) +
        '&v=weekly&loading=async&callback=__overlandGmapReady'
      s.onerror = () => done(reject, new Error('google maps: script failed to load'))
      document.head.appendChild(s)
    })
  }

  return { create, load }
})()
