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
 * Overlays are polylines throughout, including the station dots: a symbol on a
 * one-point line keeps a fixed pixel size at every zoom and needs no Map ID,
 * where Circle is sized in metres and AdvancedMarkerElement requires one.
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
    map.addListener('zoom_changed', () => opts.onMove && opts.onMove())
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

    // A fixed-pixel dot at one point, as a symbol on a one-point line.
    function dot(at, { fill, stroke, scale, z, id, shape }) {
      const p = new g.Polyline({
        path: [at, { lat: at.lat + 1e-7, lng: at.lng }],
        map,
        strokeOpacity: 0,
        clickable: Boolean(id),
        zIndex: z,
        icons: [{
          icon: {
            path: shape || g.SymbolPath.CIRCLE,
            fillColor: fill,
            fillOpacity: 1,
            strokeColor: stroke,
            strokeWeight: stroke ? 1.6 : 0,
            scale,
          },
          offset: '0',
        }],
      })
      if (id) {
        p.addListener('click', e => {
          const at = toPixel(e.latLng)
          const de = e.domEvent || {}
          const touch = de.pointerType === 'touch' || String(de.type || '').startsWith('touch')
          opts.onStation && opts.onStation(id, at ? at.x : 0, at ? at.y : 0, touch)
        })
      }
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
        idle.push(dot(ll(s), { fill: tok('--idle-dot'), scale: s.hub ? 3.6 : 2.6, z: 3, id }))
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
              fill: tok('--alert'), stroke: tok('--sea'), scale: 5.5, z: 9,
              shape: 'M 0,-1 1,0 0,1 -1,0 z',
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
        if (ends.has(id)) {
          drawn.push(dot(ll(s), { fill: tok('--rail'), stroke: tok('--sea'), scale: 7, z: 10, id }))
        } else if (stops.has(id)) {
          drawn.push(dot(ll(s), { fill: tok('--sea'), stroke: tok('--rail'), scale: 5, z: 8, id }))
        } else {
          // Passed through without stopping: still a station, still tappable.
          drawn.push(dot(ll(s), { fill: tok('--rail'), scale: 2.6, z: 7, id }))
        }
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
      you.push(dot(at, { fill: c, stroke: '#ffffff', scale: 7, z: 12 }))
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
