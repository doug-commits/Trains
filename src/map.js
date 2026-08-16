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
      inkSoft: get('--ink-soft'),
      panel: get('--panel'),
      seaDeep: get('--sea-deep'),
      grid: get('--grid'),
      halo: get('--label-halo'),
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
      /* `step` drops points on the way past.
       *
       * A second, coarser copy of the same coastline is built for the frames
       * where the map is moving. Filling a path costs both the area it covers
       * and the edges it is made of, and at a third of the edges the shape is
       * the same shape — at half resolution, under a moving thumb, nobody has
       * ever seen the difference. The full one goes back the moment it stops. */
      const ring = (path, pts, step = 1) => {
        let started = false
        for (let i = 0; i < pts.length; i += step) {
          const x = pts[i][0]
          const y = Proj.screenY(pts[i][1])
          if (!started) {
            path.moveTo(x, y)
            started = true
          } else path.lineTo(x, y)
        }
        path.closePath()
      }

      const COARSE = 3
      const all = new Path2D()
      const rough = new Path2D()
      const outlines = []
      for (const country of basemap.countries) {
        const path = new Path2D()
        for (const r of country.rings) {
          ring(path, r)
          ring(rough, r, COARSE)
        }
        outlines.push(path)
        all.addPath(path)
      }

      /* The small islands, which are land without being any country's outline.
       * They come from their own dataset because several places this network
       * calls at — Koh Tao, Phi Phi, Samet, the Gilis, Boracay — are absent
       * from the country polygons at every resolution, which left ferry
       * terminals floating in open water. */
      const isles = new Path2D()
      for (const r of basemap.islands || []) {
        ring(isles, r)
        ring(rough, r, COARSE)
      }
      outlines.push(isles)
      all.addPath(isles)

      return { all, rough, outlines }
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
      // The baked sea, vignette and shelf are sized in device pixels, so they
      // are no longer the right size. Each rebuilds on its own key.
      backdrop = null
      shelf = null
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
    let shelf = null
    // Outlives the backdrop it is stamped into: the noise does not depend on
    // the palette or the canvas size, so a resize or a theme flip has no
    // reason to roll sixteen thousand new pixels.
    let grainTile = null

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

      /* A dither laid over the sea gradient.
       *
       * A gradient this shallow — two close blues across nine hundred pixels —
       * has fewer distinct values in it than it has rows to fill, so an 8-bit
       * display quantises it into visible bands, and the bands sit across the
       * open water where there is nothing else to look at. A pixel of noise
       * under half a level breaks the boundary between one band and the next
       * and the ramp reads as smooth. It is the same trick that makes a
       * printed photograph continuous, and it is why the water now looks like
       * paper rather than like a fill.
       *
       * Tiled from one small square rather than generated across the whole
       * canvas: at this amplitude the repeat is not findable, and the honest
       * version was four million random numbers on every resize. */
      const GRAIN = 128
      const grain = g => {
        if (!grainTile) {
          const t = document.createElement('canvas')
          t.width = t.height = GRAIN
          const tg = t.getContext('2d')
          const img = tg.createImageData(GRAIN, GRAIN)
          for (let i = 0; i < img.data.length; i += 4) {
            const v = (Math.random() * 255) | 0
            img.data[i] = img.data[i + 1] = img.data[i + 2] = v
            img.data[i + 3] = 255
          }
          tg.putImageData(img, 0, 0)
          grainTile = t
        }
        g.save()
        // Overlay keeps the mid grey of the noise neutral, so the dither lands
        // as texture rather than as a wash lightening or darkening the water.
        g.globalCompositeOperation = 'overlay'
        g.globalAlpha = 0.035
        g.fillStyle = g.createPattern(grainTile, 'repeat')
        g.fillRect(0, 0, view.w, view.h)
        g.restore()
      }

      // A sea that deepens toward the bottom of the frame. One flat fill across
      // two thirds of the viewport is the least interesting thing a map can do.
      const sea = layer()
      const sky = sea.g.createLinearGradient(0, 0, 0, view.h)
      sky.addColorStop(0, colors.sea)
      sky.addColorStop(1, colors.seaDeep)
      sea.g.fillStyle = sky
      sea.g.fillRect(0, 0, view.w, view.h)
      grain(sea.g)

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

    /* Bathymetry: the shallows, drawn as bands stepping out from every coast.
     *
     * This is the difference between a map and a chart. A single flat fill
     * across two thirds of the frame says "here is water" and nothing else; a
     * shelf says where the water gets deep, which is the first thing a real
     * chart tells you and the reason the Malacca Strait and the Java Sea look
     * like different places rather than the same blue.
     *
     * Three passes of a blurred silhouette, widest and faintest first, then the
     * land knocked back out so what remains is only what fell in the water.
     * shadowBlur rather than ctx.filter because filter on a canvas is Safari 17
     * and this app supports iOS 15 — a blur that silently does nothing on a
     * fifth of the phones is worse than no blur at all.
     *
     * Baked against the view rather than the canvas, because it moves with the
     * coastline, and skipped entirely while a gesture is in flight — thirteen
     * thousand points blurred three times is the most expensive thing on the
     * map by a distance, and nobody has ever studied the continental shelf on a
     * map that is sliding under their thumb. */
    /* Two bands, not three. The third sat between the other two and cost a
       third of the layer to say something they had already said — visible in a
       difference blend and nowhere else. Radii are in the small canvas's own
       pixels and get multiplied by the scale-up, so these are roughly 70 and 24
       once they land. */
    const SHELF_BANDS = [
      [24, 0.52],
      [8, 0.46],
    ]

    /* Half resolution, and the coarse coastline.
     *
     * Both are free here in a way they are nowhere else on this map. The
     * narrowest band is a six pixel blur; at half scale that is three, and
     * scaling the result back up blurs it again. Nothing in a picture whose
     * every edge is already soft survives being sharpened, so there is nothing
     * to lose. A blurred picture drawn small and scaled up is the same blurred
     * picture; drawn at full size it was eighty milliseconds on the frame a
     * gesture settles on, against eighty-eight for everything else on the map
     * put together. */
    const SHELF_SCALE = 0.34

    function shelfLayer() {
      const key = [
        canvas.width, canvas.height,
        Math.round(view.dx), Math.round(view.dy), view.scale.toFixed(3),
        colors.coast,
      ].join('|')
      if (shelf && shelf.key === key) return shelf.c

      const c = document.createElement('canvas')
      c.width = Math.max(1, Math.round(canvas.width * SHELF_SCALE))
      c.height = Math.max(1, Math.round(canvas.height * SHELF_SCALE))
      const g = c.getContext('2d')
      g.scale(c.width / view.w, c.height / view.h)

      for (const [blur, alpha] of SHELF_BANDS) {
        g.save()
        g.globalAlpha = alpha
        g.shadowColor = colors.coast
        g.shadowBlur = blur
        /* The shape itself is painted opaque and removed below; only its
           shadow is wanted. Offsetting the shape off-canvas would be the
           cheaper trick and gives a shadow on one side only, which is a
           drop shadow and not a shelf. */
        g.fillStyle = '#000'
        g.transform(view.scale, 0, 0, view.scale, view.dx, view.dy)
        g.fill(world.rough)
        g.restore()
      }

      /* Knocked out with the full-resolution coastline even though the bands
         were cast by the coarse one. The edge where the shelf meets the land is
         the one place the difference between the two paths would show, because
         it is the only hard edge in the layer. */
      g.save()
      g.globalCompositeOperation = 'destination-out'
      g.transform(view.scale, 0, 0, view.scale, view.dx, view.dy)
      g.fill(world.all)
      g.restore()

      shelf = { key, c }
      return c
    }

    function drawBasemap() {
      const baked = backdrops()
      ctx.drawImage(baked.sea, 0, 0, view.w, view.h)

      if (!moving) ctx.drawImage(shelfLayer(), 0, 0, view.w, view.h)

      drawGraticule()

      /* Lighter than it was. The vignette used to be the only thing giving the
         water any shape, so it had to be heavy enough to be seen and turned the
         corners of the frame into a void. The shelf does that job properly now,
         and a vignette's real job is to settle the eye in the middle rather
         than to be noticed. */
      ctx.save()
      ctx.globalAlpha = 0.32
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
        ctx.fill(world.rough)
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

      /* And light on the land, from the north-west.
       *
       * Flat fill to flat fill across a continent reads as paper, not ground.
       * This is not terrain — there is no elevation data in this project and
       * inventing some would be a lie told in pixels — it is a single raking
       * gradient over the whole landmass, which is enough to stop the interior
       * reading as a hole cut in the sea. Clipped to the land so not a pixel of
       * it touches the water the shelf just spent three passes describing. */
      if (!moving) {
        ctx.save()
        ctx.transform(view.scale, 0, 0, view.scale, view.dx, view.dy)
        ctx.clip(world.all)

        /* The strand: a pale band just inside every coast, the mirror of the
         * shelf just outside it.
         *
         * This is what makes land read as land rather than as the shape left
         * over when you cut the sea out. In the dark theme the two fills are
         * four points apart in value and Sumatra was arriving as a hole; a lit
         * rim along its edge is the whole difference. Stroked rather than
         * blurred because the clip already does the hard edge on one side and
         * a wide soft stroke does the rest — the shelf can afford a blur
         * because it is baked once, and this cannot because it is not. */
        for (const width of [11, 5]) {
          ctx.strokeStyle = colors.landEdge
          ctx.globalAlpha = width > 8 ? 0.1 : 0.16
          ctx.lineWidth = width / view.scale
          for (const path of world.outlines) ctx.stroke(path)
        }
        ctx.globalAlpha = 1

        /* And a rake of light across the whole landmass, north-west to
         * south-east. Not terrain: there is no elevation data in this project
         * and inventing some would be a lie told in pixels. It is one gradient,
         * and it is enough to stop a continent reading as flat paper. */
        ctx.setTransform(backing, 0, 0, backing, 0, 0)
        const lit = ctx.createLinearGradient(0, 0, view.w * 0.55, view.h)
        lit.addColorStop(0, 'rgba(255,255,255,0.075)')
        lit.addColorStop(0.55, 'rgba(255,255,255,0)')
        lit.addColorStop(1, 'rgba(0,0,0,0.14)')
        ctx.fillStyle = lit
        ctx.fillRect(0, 0, view.w, view.h)
        ctx.restore()
      }
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

    /* A scale bar, because a map without one is a picture of a map.
     *
     * It is also the honest answer to a question this planner otherwise dodges.
     * The itinerary talks in hours and dollars and never in kilometres, on the
     * grounds that nobody boards a train because it is 1,400km — but the map is
     * the one place where distance is the whole point, and "Bangkok to
     * Singapore looks about twice Bangkok to Hanoi" is a thing a reader should
     * be able to get from it.
     *
     * Measured across the middle of the frame rather than computed from the
     * scale, because Mercator stretches with latitude and a bar derived from
     * the transform would be right at the equator and wrong at Kunming. */
    const NICE_KM = [10, 20, 50, 100, 200, 500, 1000, 2000]

    /* The names of the places themselves, as distinct from the names of the
     * stations on them.
     *
     * This is the thing that separated the chart from a diagram of a network
     * drawn over a silhouette. Half of Southeast Asia is water, and unnamed
     * water is just a dark hole in the middle of the frame; naming it is what
     * every printed chart does with that space, and it costs one draw call.
     *
     * `rank` is the zoom at which a name has earned its room. Everything is
     * placed by hand, because a polygon centroid puts VIETNAM in the South
     * China Sea and INDONESIA somewhere in the Java Sea — the country is a
     * crescent and an archipelago respectively, and neither contains its own
     * average.
     *
     * `angle` is in degrees and only the straits use it: a strait is a
     * diagonal channel, and a horizontal word laid across one reads as
     * belonging to neither shore. */
    const PLACES = [
      // Land. Upright, tracked wide, in the colour of the coastline.
      { name: 'MYANMAR', lon: 96.1, lat: 21.2, rank: 0 },
      { name: 'THAILAND', lon: 101.4, lat: 16.4, rank: 0 },
      { name: 'LAOS', lon: 103.2, lat: 19.6, rank: 0.9 },
      { name: 'VIETNAM', lon: 107.9, lat: 14.4, rank: 0, angle: 62 },
      { name: 'CAMBODIA', lon: 104.8, lat: 12.7, rank: 0.9 },
      { name: 'MALAYSIA', lon: 114.2, lat: 3.2, rank: 0 },
      // The peninsula is narrower than its own name, so the word runs down it
      // rather than across it and out into the South China Sea.
      { name: 'MALAYSIA', lon: 102.5, lat: 4.2, rank: 1.2, angle: 72 },
      { name: 'BRUNEI', lon: 114.7, lat: 4.6, rank: 3.4 },
      { name: 'SUMATRA', lon: 98.6, lat: 2.8, rank: 2.4, angle: -38 },
      { name: 'BORNEO', lon: 113.6, lat: -1.4, rank: 0.9 },
      { name: 'JAVA', lon: 110.6, lat: -7.3, rank: 1.6 },
      { name: 'SULAWESI', lon: 120.6, lat: -2.4, rank: 1.6 },
      /* Down Sumatra's own axis, not in the Java Sea where the country's
         centroid falls — Indonesia is an archipelago and does not contain its
         average — and not across Sumatra either, because tracked out to a
         country name the word is wider than the island and half of it ends up
         in open water. */
      { name: 'INDONESIA', lon: 102.4, lat: -2.4, rank: 0, angle: -38 },
      { name: 'PHILIPPINES', lon: 121.5, lat: 12.4, rank: 0 },
      { name: 'LUZON', lon: 121.2, lat: 16.4, rank: 1.8 },
      { name: 'MINDANAO', lon: 124.8, lat: 7.8, rank: 1.8 },
      { name: 'CHINA', lon: 106.4, lat: 24.2, rank: 0 },

      // Water. Italic and quieter, which is the convention that tells you at a
      // glance which names you could stand on.
      { name: 'SOUTH CHINA SEA', lon: 114.5, lat: 13.6, rank: 0, sea: true },
      { name: 'PHILIPPINE SEA', lon: 128.4, lat: 14.5, rank: 0.8, sea: true },
      { name: 'ANDAMAN SEA', lon: 95.4, lat: 10.6, rank: 0, sea: true },
      { name: 'BAY OF BENGAL', lon: 89.6, lat: 15.4, rank: 0.8, sea: true },
      { name: 'GULF OF THAILAND', lon: 101.9, lat: 9.4, rank: 0.7, sea: true },
      { name: 'GULF OF TONKIN', lon: 107.9, lat: 19.4, rank: 1.6, sea: true },
      { name: 'JAVA SEA', lon: 112.4, lat: -5.2, rank: 0.7, sea: true },
      { name: 'CELEBES SEA', lon: 121.4, lat: 3.8, rank: 1, sea: true },
      { name: 'SULU SEA', lon: 119.8, lat: 8.6, rank: 1.2, sea: true },
      { name: 'BANDA SEA', lon: 126.8, lat: -5.6, rank: 1.2, sea: true },
      { name: 'FLORES SEA', lon: 120.2, lat: -7.4, rank: 2, sea: true },
      { name: 'STRAIT OF MALACCA', lon: 99.4, lat: 4.6, rank: 1.1, sea: true, angle: -40 },
      { name: 'MAKASSAR STRAIT', lon: 118.4, lat: -1.6, rank: 2, sea: true, angle: 74 },
      { name: 'INDIAN OCEAN', lon: 97.5, lat: -6.5, rank: 0, sea: true },
    ]

    function drawPlaces(zoom) {
      // The scale bar's corner is spoken for. Seeded as an occupied box rather
      // than checked separately, so it goes through the same collision test as
      // every other name and a toponym simply loses that corner.
      const bar = scaleBar()
      const boxes = bar ? [bar.box] : []
      /* Names grow with the map, but far more slowly than it does — a fourth
         root, so eight times the magnification is one and a half times the
         type. A country name that scaled with the land would be a headline by
         the third zoom step; one that never grew at all would be lost on a
         continent. */
      const grow = Math.pow(Math.max(zoom, 0.5), 0.25)

      for (const place of PLACES) {
        if (zoom < place.rank) continue
        const p = Proj.project(view, place.lon, place.lat)
        const size = (place.sea ? 11.5 : 13) * grow
        if (p.x < -60 || p.x > view.w + 60 || p.y < -30 || p.y > view.h + 30) continue

        ctx.save()
        ctx.font = `${place.sea ? 'italic 400' : '600'} ${size}px BarlowCond, system-ui, sans-serif`
        ctx.letterSpacing = `${place.sea ? 0.24 : 0.3}em`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        const w = ctx.measureText(place.name).width

        /* Overlap is measured on the unrotated box, which is wrong for the two
           angled straits and not wrong enough to matter: they sit in open
           water with nothing to collide with, and the alternative is a
           separating-axis test to place fourteen words. */
        const box = { x: p.x - w / 2, y: p.y - size * 0.7, w, h: size * 1.4 }
        const clash = boxes.some(
          b => box.x < b.x + b.w && box.x + box.w > b.x && box.y < b.y + b.h && box.y + box.h > b.y
        )
        /* Half of PHILIPPINES spent its first draft behind the itinerary
           panel. A station name that will not fit is dropped rather than
           truncated, and a country name has to be held to the same rule — the
           angled ones are exempt because their box is not their footprint. */
        const clipped =
          !place.angle && (box.x < 6 || box.x + box.w > view.w - inset.right - 6)
        if (clash || clipped) {
          ctx.restore()
          continue
        }
        boxes.push(box)

        ctx.translate(p.x, p.y)
        if (place.angle) ctx.rotate((place.angle * Math.PI) / 180)
        /* Quiet on purpose. These are the ground the route is drawn on, and a
           toponym that competes with a station name has misunderstood its job:
           you should have to look for them, and find them when you do. */
        // Centring is by the box, so the trailing letter-space has to come off
        // the middle or every name sits a nudge to the right of its anchor.
        const x = -size * (place.sea ? 0.12 : 0.15)

        /* A name this size will cross a coastline sooner or later — the ones
           that do not are the ones on countries wide enough to hold them, and
           this region has three of those. Without the halo the letters that
           land on water and the letters that land on the shore are two
           different colours against two different grounds, and the word stops
           being a word. */
        ctx.lineWidth = Math.max(2, size * 0.22)
        ctx.lineJoin = 'round'
        ctx.strokeStyle = colors.halo || colors.sea
        ctx.globalAlpha = place.sea ? 0.3 : 0.38
        ctx.strokeText(place.name, x, 0)

        ctx.globalAlpha = place.sea ? 0.4 : 0.5
        ctx.fillStyle = place.sea ? colors.muted : colors.coast || colors.muted
        ctx.fillText(place.name, x, 0)
        ctx.restore()
      }
    }

    /* Where the scale bar will go, worked out before anything is drawn.
     *
     * Separated from the drawing because the toponyms need it too: they are
     * painted first and knew nothing about it, so BORNEO ran straight into
     * "500 km" in the corner. One geometry, two readers — the alternative is
     * two copies of the same arithmetic that drift apart the first time either
     * is touched. */
    function scaleBar() {
      const y = view.h / 2
      const a = Proj.unproject(view, view.w * 0.4, y)
      const b = Proj.unproject(view, view.w * 0.6, y)
      const kmPerPx = Proj.haversine(a, b) / (view.w * 0.2)
      if (!isFinite(kmPerPx) || kmPerPx <= 0) return null

      // The widest round number that still fits the space allowed for it.
      const maxPx = Math.min(150, view.w * 0.22)
      let km = NICE_KM[0]
      for (const n of NICE_KM) if (n / kmPerPx <= maxPx) km = n
      const px = km / kmPerPx
      if (px < 30) return null

      /* Bottom right of the *visible* map, which is not the bottom right of the
         canvas: the store runs the full width of the stage and the itinerary
         panel sits on top of its right-hand end. `inset` is what the panel
         covers and every other placement on this map already respects it —
         this one did not, and the bar spent its first draft underneath the
         panel where nobody would ever have seen it.

         The right-hand end is the one corner nothing else claims: the search
         card is top left and the legend bottom left. */
      const x = view.w - inset.right - px - 22
      const by = view.h - inset.bottom - 26
      // The bar, its ticks and the figure sitting above it.
      return { km, px, x, by, box: { x: x - 6, y: by - 26, w: px + 12, h: 34 } }
    }

    function drawScaleBar() {
      const bar = scaleBar()
      if (!bar) return
      const { km, px, x, by } = bar

      ctx.save()
      ctx.globalAlpha = 0.85
      ctx.lineWidth = 1.5
      ctx.strokeStyle = colors.muted
      ctx.lineCap = 'butt'

      // A bar with a tick down at each end and one in the middle, which is the
      // form every printed chart uses and the reason it reads as a scale
      // rather than as a stray rule.
      ctx.beginPath()
      ctx.moveTo(x, by - 5)
      ctx.lineTo(x, by)
      ctx.lineTo(x + px, by)
      ctx.lineTo(x + px, by - 5)
      ctx.moveTo(x + px / 2, by)
      ctx.lineTo(x + px / 2, by - 3.5)
      ctx.stroke()

      ctx.font = '500 11px BarlowCond, system-ui, sans-serif'
      ctx.letterSpacing = '0.06em'
      ctx.textAlign = 'right'
      ctx.textBaseline = 'alphabetic'
      const text = km >= 1000 ? `${km / 1000}000 km` : `${km} km`
      ctx.lineWidth = 3
      ctx.strokeStyle = colors.halo
      ctx.strokeText(text, x + px, by - 9)
      ctx.fillStyle = colors.muted
      ctx.fillText(text, x + px, by - 9)
      ctx.restore()
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
        const base = c.priority === 0 ? 16 : c.priority === 1 ? 14 : 13
        /* Barely smaller on a phone, not two points smaller. A place name at
         * ten pixels in a condensed face is a smudge, and the phone is where
         * this map is actually read. */
        const fontSize = view.w < 520 ? base - 1 : base
        ctx.font = `${weight} ${fontSize}px BarlowCond, system-ui, sans-serif`
        /* The word space in this face is 0.167em — two pixels at twelve — and
         * the halo was three and a half wide, so the halo of one word's last
         * letter met the next word's first and "Phnom Penh" arrived as one
         * word. Open the spaces rather than thin the halo, which is doing a
         * job of its own. */
        ctx.wordSpacing = '0.14em'
        ctx.letterSpacing = '0.01em'
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
        /* Enough to separate the letters from the ground and no more. A
         * quarter of the type size sounded proportionate and is far too much
         * on a condensed face: the stroke runs half its width inside the
         * glyph, and at four pixels on sixteen it closes the counters of a
         * and e and the whole word thickens into a blot. */
        ctx.lineWidth = Math.min(3, Math.max(2, fontSize * 0.17))
        ctx.lineJoin = 'round'
        ctx.lineCap = 'round'
        ctx.strokeStyle = colors.halo || colors.sea
        ctx.globalAlpha = onRoute ? 0.95 : 0.85
        ctx.strokeText(text, box.x + 3, p.y)
        ctx.globalAlpha = 1
        // Soft ink rather than muted: these were the labels being complained
        // about, and half the problem was that they were barely there.
        ctx.fillStyle = onRoute ? colors.ink : colors.inkSoft || colors.muted
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
      drawPlaces(zoom)
      drawIdleNetwork(used)
      drawLandmarks(zoom)
      drawIdleStations(routeSet)
      drawRoute()
      drawRouteStations()
      drawLabels()
      drawScaleBar()
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
        view = Proj.clamp(Proj.pan(view, dx, dy), reach, inset)
        schedule()
        return { dx: view.dx - fromX, dy: view.dy - fromY }
      },
      /* Zoom about the middle of the visible map, for the +/- buttons.
       *
       * A pinch or a wheel has a point the reader is pointing at, and that
       * point should stay put. A button has none, so it used the centre of the
       * canvas — which is behind the itinerary panel's half of the stage, and
       * so drifted whatever was being looked at rightwards, under the panel, a
       * little further with every press. */
      zoomCentre(factor) {
        if (!view) return
        const x = (inset.left + (view.w - inset.right)) / 2
        const y = (inset.top + (view.h - inset.bottom)) / 2
        view = Proj.clamp(Proj.zoomAt(view, x, y, factor), reach, inset)
        schedule()
      },
      zoomAt(x, y, factor) {
        view = Proj.clamp(Proj.zoomAt(view, x, y, factor), reach, inset)
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
