/* The website's map, drawn by Mapbox GL.
 *
 * The same eleven methods the canvas map offers, so app.js does not know or
 * care which one it is talking to. That matters because there are two, and
 * deliberately: this one needs the network, and the Android app has no
 * INTERNET permission and exists precisely to answer a question at a border
 * post with the phone in flight mode. Real tiles on the website, drawn
 * coastline in the app, one program above both.
 *
 * Every entry point is defensive. If the library does not load, if the token
 * is refused, if a style fails, create() returns null and app.js falls back to
 * the canvas — which is a complete, working map, not a placeholder. There is no
 * failure here that should cost a reader their route.
 */

const MapboxView = (() => {
  const STYLE = {
    dark: 'mapbox://styles/mapbox/dark-v11',
    light: 'mapbox://styles/mapbox/light-v11',
  }

  /* Line styling per mode, matching the canvas map: solid rail, dashed sea,
   * dotted road. The distinction is carried by the dash pattern as well as the
   * hue, so a journey's shape survives both themes and colour blindness. */
  const DASH = { rail: null, ferry: [2, 1.4], road: [0.4, 1.6] }

  const paletteFrom = root => {
    const cs = getComputedStyle(root)
    const get = n => cs.getPropertyValue(n).trim()
    return {
      rail: get('--rail'),
      ferry: get('--ferry'),
      road: get('--road'),
      idle: get('--idle-line'),
      landmark: get('--landmark'),
      alert: get('--alert'),
      ink: get('--ink'),
      panel: get('--panel-solid') || get('--panel'),
    }
  }

  const isDark = () => {
    const set = document.documentElement.getAttribute('data-theme')
    if (set) return set === 'dark'
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  }

  /** A ferry's arc, sampled — Mapbox draws line strings, not curves. */
  function bow(a, b, steps = 24) {
    const mx = (a[0] + b[0]) / 2
    const my = (a[1] + b[1]) / 2
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const len = Math.hypot(dx, dy) || 1
    const lift = Math.min(1.2, len * 0.16)
    const cx = mx - (dy / len) * lift
    const cy = my + (dx / len) * lift
    const out = []
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      const u = 1 - t
      out.push([
        u * u * a[0] + 2 * u * t * cx + t * t * b[0],
        u * u * a[1] + 2 * u * t * cy + t * t * b[1],
      ])
    }
    return out
  }

  function create(wrap, network, landmarks = [], rails = {}, opts = {}) {
    if (!opts.token || typeof mapboxgl === 'undefined') return null
    /* mapboxgl.supported() existed in v1 and v2 and was removed in v3. Asking
     * for it optionally and negating the answer therefore reads "unsupported"
     * on every modern build — which would have left the website silently on the
     * drawn map with the token set and no sign of why. Only consulted when it
     * is actually there. */
    if (typeof mapboxgl.supported === 'function' && !mapboxgl.supported()) return null

    const at = id => {
      const s = network.stations[id]
      return [s.lon, s.lat]
    }

    /** The drawn shape of one station-to-station hop, in lon/lat. */
    function geometry(from, to, mode) {
      const track = rails[`${from}|${to}`]
      if (track) return track
      const a = at(from)
      const b = at(to)
      return mode === 'ferry' ? bow(a, b) : [a, b]
    }

    const lineFeature = leg => ({
      type: 'Feature',
      properties: { mode: leg.mode },
      geometry: {
        type: 'LineString',
        coordinates: geometry(leg.from, leg.to, leg.mode),
      },
    })

    /* A leg of a route is not a leg of the network.
     *
     * The planner merges consecutive hops into one leg per vehicle — the point
     * of mergeSegments — so what arrives here has steps and no endpoints of its
     * own. Reading from and to off it gives undefined, which is what a station
     * lookup then chokes on. Its shape is its steps, laid end to end. */
    const routeFeature = (leg, dim) => ({
      type: 'Feature',
      properties: { mode: leg.mode, dim: !!dim },
      geometry: {
        type: 'LineString',
        coordinates: leg.steps.flatMap((step, i) => {
          const part = geometry(step.from, step.to, step.mode || leg.mode)
          // The end of one hop is the start of the next; keep it once.
          return i ? part.slice(1) : part
        }),
      },
    })

    /** Every station-to-station hop the route uses, so the lattice can skip it. */
    const stepKeys = r => {
      const keys = new Set()
      for (const entry of r ? r.legs : []) {
        for (const step of entry.leg.steps) keys.add(`${step.from}|${step.to}`)
      }
      return keys
    }

    const collection = features => ({ type: 'FeatureCollection', features })

    /* Everything that never changes, built once. */
    const allLegs = collection(network.legs.map(lineFeature))
    const stationPoints = collection(
      Object.entries(network.stations).map(([id, s]) => ({
        type: 'Feature',
        properties: {
          id,
          name: s.city === s.name ? s.name : `${s.city} — ${s.name}`,
          rank: s.hub ? 0 : s.minor ? 2 : 1,
        },
        geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
      }))
    )
    const landmarkPoints = collection(
      landmarks
        .filter(lm => network.stations[lm.station])
        .map(lm => {
          const s = network.stations[lm.station]
          return {
            type: 'Feature',
            properties: { name: lm.name, station: lm.station },
            geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
          }
        })
    )

    const bounds = (() => {
      const lons = Object.values(network.stations).map(s => s.lon)
      const lats = Object.values(network.stations).map(s => s.lat)
      return [
        [Math.min(...lons) - 1, Math.min(...lats) - 1],
        [Math.max(...lons) + 1, Math.max(...lats) + 1],
      ]
    })()

    let map
    let host
    try {
      host = document.createElement('div')
      host.id = 'mapgl'
      host.className = 'mapgl'
      wrap.appendChild(host)

      mapboxgl.accessToken = opts.token
      map = new mapboxgl.Map({
        container: host,
        style: isDark() ? STYLE.dark : STYLE.light,
        bounds,
        fitBoundsOptions: { padding: 24 },
        attributionControl: true,
        // The reader's own gestures, not ours: Mapbox owns pan, pinch and
        // rotate here, which is why app.js leaves its canvas handlers off.
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
        maxZoom: 12,
        minZoom: 2,
      })
      map.touchZoomRotate?.disableRotation()
    } catch (e) {
      if (host && host.parentNode) host.parentNode.removeChild(host)
      return null
    }

    let inset = { left: 0, right: 0, top: 0, bottom: 0 }
    let applied = isDark() ? STYLE.dark : STYLE.light
    let route = null
    let focused = null
    let ready = false

    const padding = () => ({
      top: inset.top + 24,
      bottom: inset.bottom + 24,
      left: inset.left + 24,
      right: inset.right + 24,
    })

    /* Sources and layers are lost on every setStyle, so adding them is a
     * function rather than a step — the theme toggle calls it again. */
    function install() {
      const pal = paletteFrom(document.documentElement)
      if (!map.getSource('idle')) map.addSource('idle', { type: 'geojson', data: allLegs })
      if (!map.getSource('route')) {
        map.addSource('route', { type: 'geojson', data: collection([]) })
      }
      if (!map.getSource('stations')) {
        map.addSource('stations', { type: 'geojson', data: stationPoints })
      }
      if (!map.getSource('landmarks')) {
        map.addSource('landmarks', { type: 'geojson', data: landmarkPoints })
      }

      for (const mode of ['road', 'ferry', 'rail']) {
        const idleId = `idle-${mode}`
        if (!map.getLayer(idleId)) {
          map.addLayer({
            id: idleId,
            type: 'line',
            source: 'idle',
            filter: ['==', ['get', 'mode'], mode],
            layout: { 'line-cap': DASH[mode] ? 'butt' : 'round', 'line-join': 'round' },
            paint: {
              'line-color': pal.idle,
              'line-width': mode === 'rail' ? 1.6 : 1.2,
              'line-opacity': 0.75,
              ...(DASH[mode] ? { 'line-dasharray': DASH[mode] } : {}),
            },
          })
        }
        const routeId = `route-${mode}`
        if (!map.getLayer(routeId)) {
          map.addLayer({
            id: routeId,
            type: 'line',
            source: 'route',
            filter: ['==', ['get', 'mode'], mode],
            layout: { 'line-cap': DASH[mode] ? 'butt' : 'round', 'line-join': 'round' },
            paint: {
              'line-color': pal[mode],
              'line-width': mode === 'rail' ? 4 : 3,
              // Set as a property by focusLeg, so read as one here.
              'line-opacity': ['case', ['boolean', ['get', 'dim'], false], 0.3, 1],
            },
          })
        }
      }

      if (!map.getLayer('landmark-dots')) {
        map.addLayer({
          id: 'landmark-dots',
          type: 'circle',
          source: 'landmarks',
          minzoom: 4.2,
          paint: {
            'circle-radius': 4,
            'circle-color': 'transparent',
            'circle-stroke-color': pal.landmark,
            'circle-stroke-width': 1.6,
          },
        })
      }

      if (!map.getLayer('station-dots')) {
        map.addLayer({
          id: 'station-dots',
          type: 'circle',
          source: 'stations',
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['get', 'rank'], 0, 5, 2, 2.6],
            'circle-color': pal.panel,
            'circle-stroke-color': pal.idle,
            'circle-stroke-width': 1.4,
          },
        })
      }

      if (!map.getLayer('station-names')) {
        map.addLayer({
          id: 'station-names',
          type: 'symbol',
          source: 'stations',
          minzoom: 4.6,
          layout: {
            'text-field': ['get', 'name'],
            'text-size': 11,
            'text-offset': [0, 1.1],
            'text-anchor': 'top',
            'text-allow-overlap': false,
          },
          paint: {
            'text-color': pal.ink,
            'text-halo-color': pal.panel,
            'text-halo-width': 1.4,
          },
        })
      }

      if (route) applyRoute()
      ready = true
    }

    function applyRoute() {
      const src = map.getSource('route')
      if (src) {
        src.setData(
          collection(
            route
              ? route.legs.map((e, i) =>
                  routeFeature(e.leg, focused !== null && i !== focused)
                )
              : []
          )
        )
      }
      /* And take the route's own hops out of the lattice underneath it, or the
       * itinerary is drawn on top of a faint copy of itself. */
      const idle = map.getSource('idle')
      if (!idle) return
      const used = stepKeys(route)
      idle.setData(
        collection(
          network.legs
            .filter(l => !used.has(`${l.from}|${l.to}`))
            .map(lineFeature)
        )
      )
    }

    map.on('load', () => {
      try {
        install()
      } catch (e) {
        /* A style that will not take our layers is still a map. Better a plain
           basemap than a blank frame. */
      }
    })
    map.on('style.load', () => {
      ready = false
      try {
        install()
      } catch (e) {
        /* as above */
      }
    })

    /* A click on a station or a sight is the same event the canvas map raises
     * from its own hit testing, so app.js can answer it the same way. */
    if (opts.onPick) {
      map.on('click', e => {
        const found = map.queryRenderedFeatures(e.point, {
          layers: ['station-dots', 'landmark-dots'].filter(l => map.getLayer(l)),
        })
        if (!found.length) return opts.onPick(null, e.point.x, e.point.y)
        const f = found[0]
        if (f.layer.id === 'station-dots') {
          opts.onPick({ type: 'station', id: f.properties.id }, e.point.x, e.point.y)
        } else {
          const lm = landmarks.find(l => l.name === f.properties.name)
          if (lm) opts.onPick({ type: 'landmark', landmark: lm }, e.point.x, e.point.y)
        }
      })
      for (const layer of ['station-dots', 'landmark-dots']) {
        map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'))
        map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''))
      }
    }

    return {
      /** Which renderer this is, so the page can say so and tests can tell. */
      kind: 'mapbox',

      resize() {
        map.resize()
      },

      locate(lon, lat) {
        const p = map.project([lon, lat])
        const box = host.getBoundingClientRect()
        if (p.x < 0 || p.y < 0 || p.x > box.width || p.y > box.height) return null
        return { x: p.x, y: p.y }
      },

      viewSignature() {
        const c = map.getCenter()
        return [map.getZoom(), c.lng, c.lat].map(n => Math.round(n * 100) / 100).join(',')
      },

      setInset(next) {
        inset = { left: 0, right: 0, top: 0, bottom: 0, ...next }
      },

      setRoute(next) {
        route = next
        focused = null
        if (ready) applyRoute()
        if (!next || !next.stationIds.length) return
        const pts = next.stationIds.map(id => at(id))
        const box = pts.reduce(
          (acc, p) => [
            [Math.min(acc[0][0], p[0]), Math.min(acc[0][1], p[1])],
            [Math.max(acc[1][0], p[0]), Math.max(acc[1][1], p[1])],
          ],
          [[Infinity, Infinity], [-Infinity, -Infinity]]
        )
        map.fitBounds(box, { padding: padding(), maxZoom: 9, duration: 900 })
      },

      /* Dim everything but the leg being pointed at. Feature state rather than
       * a filter, so the others stay drawn and merely recede. */
      focusLeg(index) {
        if (focused === index) return
        focused = index
        if (!ready || !route) return
        const src = map.getSource('route')
        if (!src) return
        // The layers already read `dim`; setting the data is the whole change.
        src.setData(
          collection(
            route.legs.map((e, i) => routeFeature(e.leg, index !== null && i !== index))
          )
        )
      },

      panBy(dx, dy) {
        map.panBy([-dx, -dy], { duration: 0 })
        return { dx, dy }
      },

      zoomAt(x, y, factor) {
        map.easeTo({
          zoom: map.getZoom() + Math.log2(factor),
          around: map.unproject([x, y]),
          duration: 0,
        })
      },

      resetView() {
        map.fitBounds(bounds, { padding: padding(), duration: 600 })
      },

      /* The canvas map hit-tests for app.js; here Mapbox does it, and the
       * answer arrives through onPick instead. Kept so the interface matches. */
      pick() {
        return null
      },

      /* The canvas map redraws for anything — a theme change, the fonts
       * arriving, a resize. Here a redraw means throwing the entire style away
       * and fetching it again, so it happens only when the answer would
       * actually differ. */
      redraw() {
        if (!ready) return
        const want = isDark() ? STYLE.dark : STYLE.light
        if (want === applied) return
        applied = want
        try {
          map.setStyle(want)
        } catch (e) {
          /* keep the style we have */
        }
      },
    }
  }

  return { create }
})()
