/* Destination artwork, drawn rather than photographed.
 *
 * Photographs would be better, and they are not available: every image host is
 * unreachable from the build environment, stock libraries carry licences this
 * page cannot honour, and hotlinking would break the moment a third party moved
 * a file. So each destination gets an original illustration composed from the
 * landform that actually characterises it — karst towers for Hạ Long, a cone
 * for Bromo, stepped terraces for Borobudur.
 *
 * These are deliberately illustrations and not fake photographs. They are drawn
 * as a set of plates: one hour of one day, one sun, one palette, the way a
 * guidebook's colour plates are all clearly by the same hand. That family
 * resemblance is doing more work than any single picture — ten unrelated
 * illustrations read as clip art, ten plates read as a commission.
 *
 * They carry their own light rather than reading the theme's custom properties
 * the way the map does. Two reasons. A printed plate does not change colour
 * with the paper it is pasted onto, and half-lighting one on a cream panel
 * would read as a rendering fault rather than as a light mode. And a plate that
 * did follow the theme would have to be repainted on every toggle — the map
 * gets that repaint from app.js, this does not, and a canvas that silently goes
 * stale is worse than one that was never theme-aware. What the plates do take
 * from the page is its palette in spirit: the same teal-and-slate marine ground,
 * the same single warm accent, so they sit in the chrome rather than on it.
 *
 * Composition is built around a constraint the art cannot see: the panel fades
 * the bottom half of the banner into itself. So the horizon sits high, the
 * subject peaks in the top third, and everything below the midline is there to
 * anchor the picture rather than to be looked at.
 *
 * Everything is deterministic: the same place draws the same picture every
 * time, seeded from its station id.
 */

const Scene = (() => {
  /* Mulberry32 — small, fast, and stable across engines, which matters because
   * a destination that redrew differently on each visit would feel broken. */
  function rng(seedStr) {
    let h = 1779033703 ^ seedStr.length
    for (let i = 0; i < seedStr.length; i++) {
      h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353)
      h = (h << 13) | (h >>> 19)
    }
    let a = h >>> 0
    return () => {
      a |= 0
      a = (a + 0x6d2b79f5) | 0
      let t = Math.imul(a ^ (a >>> 15), 1 | a)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }

  /* ------------------------------------------------------------------ light
   *
   * One sun, in the same place in every plate, a little right of centre and
   * low. Fixing it is the cheapest thing that makes a set look art-directed:
   * every crest lights on the same side, every water surface throws its
   * glitter down the same column, and the eye reads ten pictures as one
   * afternoon rather than ten separate accidents.
   *
   * Low rather than high, because a low sun back-lights: subjects go to
   * silhouette, which is what survives at 200px tall behind a headline. A
   * high sun would want modelled, mid-value forms, and those turn to mud. */
  const LIGHT = { x: 0.72, y: 0.4 }

  /* ---------------------------------------------------------------- palette
   *
   * Every plate is built from four colours and mixes everything else between
   * them, which is what keeps the set in one key:
   *
   *   top / mid   the sky, high and low
   *   glow        the sun's colour, and the horizon's
   *   haze        the value distance sits at — the far ridge tends to this
   *   ink         the value the nearest land sits at
   *   water       present only where the scene has a surface to reflect in
   *   accent      lamplight and ember; the one warm note, spent sparingly
   *
   * The hues sit in the marine-chart family the rest of the page uses — teal
   * and slate ground, one warm accent — so the art belongs to the chrome
   * around it instead of arriving from some other product. Kinds differ by
   * a few degrees of hue and a little warmth at the horizon, no more. */
  const PALETTE = {
    karst:   { top: '#08181f', mid: '#11414c', glow: '#d8c08a', haze: '#6b9ba2', ink: '#081d24', water: '#123c47' },
    volcano: { top: '#10151f', mid: '#3a3247', glow: '#e0a06a', haze: '#79708c', ink: '#100f18', accent: '#e9a63e' },
    temple:  { top: '#0b1a24', mid: '#37414a', glow: '#e6b978', haze: '#96968c', ink: '#0f1a1c', accent: '#e9a63e' },
    skyline: { top: '#08141f', mid: '#26374f', glow: '#c9b190', haze: '#6d8095', ink: '#08151d', water: '#12293a', accent: '#e9a63e' },
    coast:   { top: '#07202a', mid: '#1c5560', glow: '#e2c69a', haze: '#7fb0b4', ink: '#082228', water: '#18525f' },
    hills:   { top: '#0a1e22', mid: '#2b4a48', glow: '#d8c288', haze: '#7ea094', ink: '#0d211d' },
    forest:  { top: '#0a1d1f', mid: '#274c43', glow: '#cbc287', haze: '#7ba189', ink: '#0c2019' },
    river:   { top: '#0a1a22', mid: '#2c4450', glow: '#d5bf93', haze: '#82989c', ink: '#0c1d21', water: '#1d414c' },
    paddy:   { top: '#0d1e1e', mid: '#3b4c3c', glow: '#dfc584', haze: '#93a586', ink: '#101f18', water: '#4a5f47' },
    market:  { top: '#0d141c', mid: '#3a3038', glow: '#e0a463', haze: '#8f7d76', ink: '#0d1114', accent: '#f2b45c' },
  }

  const DEFAULT_BY_COUNTRY = {
    th: 'temple', la: 'karst', kh: 'temple', vn: 'karst',
    my: 'forest', sg: 'skyline', id: 'volcano', cn: 'karst', bn: 'coast', ph: 'coast', mm: 'hills',
  }

  /** Which illustration a station should carry. */
  function kindFor(network, landmarks, stationId) {
    const lm = landmarks.find(l => l.station === stationId)
    if (lm) return lm.scene
    const st = network.stations[stationId]
    if (!st) return 'hills'
    if (st.hub) return 'skyline'
    if (!st.gauge) return 'coast' // pier or island — it is reached by water
    return DEFAULT_BY_COUNTRY[st.country] || 'hills'
  }

  /* ----------------------------------------------------------------- colour */

  const CACHE = {}
  function chan(hex) {
    let v = CACHE[hex]
    if (!v) {
      const n = parseInt(hex.slice(1), 16)
      v = CACHE[hex] = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    }
    return v
  }

  /** Blend two palette colours. Everything in a plate is one of these, which
   *  is why nothing in it can fall out of key. */
  function mix(a, b, t, alpha = 1) {
    const x = chan(a)
    const y = chan(b)
    const c = i => Math.round(x[i] + (y[i] - x[i]) * t)
    return `rgba(${c(0)},${c(1)},${c(2)},${alpha})`
  }
  const at = (hex, alpha) => mix(hex, hex, 0, alpha)

  /* Atmospheric perspective in one line: everything far tends to the colour of
   * the air between us and it. `depth` 0 is underfoot, 1 is the horizon. The
   * curve is not linear because haze is not — most of the value is lost in the
   * first few miles, and a linear ramp leaves the middle distance too pale to
   * separate from the far one. */
  const layer = (pal, depth) => mix(pal.ink, pal.haze, Math.pow(depth, 0.6) * 0.9)

  /* ------------------------------------------------------------- primitives */

  function sky(ctx, w, h, pal) {
    const g = ctx.createLinearGradient(0, 0, 0, h)
    g.addColorStop(0, pal.top)
    g.addColorStop(0.3, mix(pal.top, pal.mid, 0.68))
    g.addColorStop(0.52, mix(pal.mid, pal.glow, 0.28))
    g.addColorStop(0.72, mix(pal.mid, pal.glow, 0.66))
    g.addColorStop(1, mix(pal.mid, pal.glow, 0.74))
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)

    // The sun's own light, spilling into the sky around it. A disc alone reads
    // as a sticker; the spill is what puts it behind the air.
    const sx = w * LIGHT.x
    const sy = h * LIGHT.y
    const rg = ctx.createRadialGradient(sx, sy, 0, sx, sy, Math.max(w, h) * 0.62)
    rg.addColorStop(0, mix(pal.glow, '#ffffff', 0.4, 0.5))
    rg.addColorStop(0.22, mix(pal.glow, '#ffffff', 0.1, 0.2))
    rg.addColorStop(0.6, at(pal.glow, 0.05))
    rg.addColorStop(1, at(pal.glow, 0))
    ctx.fillStyle = rg
    ctx.fillRect(0, 0, w, h)
  }

  /** The disc itself. Small — a big sun is a poster, and this is a plate. */
  function sun(ctx, w, h, pal, alpha = 0.62) {
    ctx.save()
    ctx.globalAlpha = alpha
    ctx.fillStyle = mix(pal.glow, '#ffffff', 0.55)
    ctx.beginPath()
    ctx.arc(w * LIGHT.x, h * LIGHT.y, h * 0.052, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  /* Cloud bars, flattened and stacked toward the horizon the way real ones
   * foreshorten. They are drawn in the sky's own colours — a cloud that is
   * lighter than the sky it sits in reads as a hole punched in the plate. */
  function clouds(ctx, w, h, pal, r, n = 4) {
    ctx.save()
    for (let i = 0; i < n; i++) {
      const t = i / n
      const y = h * (0.08 + t * 0.28 + r() * 0.04)
      const cx = w * (r() * 1.2 - 0.1)
      const rx = w * (0.14 + r() * 0.2)
      const ry = h * (0.012 + (1 - t) * 0.022)
      // Lit on the sun's side, shadowed away from it — the same rule the land
      // obeys two layers down.
      const near = 1 - Math.min(1, Math.abs(cx / w - LIGHT.x) * 1.7)
      ctx.fillStyle = mix(pal.mid, pal.glow, 0.15 + near * 0.55, 0.1 + near * 0.16)
      ctx.beginPath()
      ctx.ellipse(cx, y, rx, ry, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.beginPath()
      ctx.ellipse(cx + rx * 0.3, y + ry * 1.4, rx * 0.6, ry * 0.7, 0, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
  }

  /* A ridgeline as points. Two sines with seeded phase and frequency, not a
   * random walk per point: a walk gives noise, and a range is not noise — it
   * is two or three large landforms with smaller ones riding on them. The
   * seeded phases are what make two hill scenes different hills. */
  function crest(w, baseY, amp, r, steps = 14) {
    const p1 = r() * 6.283
    const p2 = r() * 6.283
    const f1 = 0.5 + r() * 0.8
    const f2 = 1.9 + r() * 2.2
    const tilt = (r() - 0.5) * amp * 0.9
    const pts = []
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      const y =
        baseY -
        amp * (0.6 + 0.46 * Math.sin(p1 + t * 6.283 * f1) + 0.24 * Math.sin(p2 + t * 6.283 * f2)) -
        tilt * (t - 0.5)
      pts.push([w * t, y])
    }
    return pts
  }

  /** Trace a point list as a smooth curve — quadratics through the midpoints,
   *  so the ridge has shoulders rather than corners. */
  function trace(ctx, pts) {
    ctx.moveTo(pts[0][0], pts[0][1])
    for (let i = 1; i < pts.length - 1; i++) {
      const [x, y] = pts[i]
      const [nx, ny] = pts[i + 1]
      ctx.quadraticCurveTo(x, y, (x + nx) / 2, (y + ny) / 2)
    }
    const last = pts[pts.length - 1]
    ctx.lineTo(last[0], last[1])
  }

  /* A crest, filled to the bottom of the frame and lit. The rim is a hairline
   * along the top edge, brightest where it faces the sun and gone by the far
   * side — the single cheapest cue that these are lit rather than cut out. */
  function landform(ctx, w, h, pts, pal, depth, opt = {}) {
    ctx.beginPath()
    trace(ctx, pts)
    ctx.lineTo(w, h)
    ctx.lineTo(0, h)
    ctx.closePath()
    ctx.fillStyle = opt.color || layer(pal, depth)
    ctx.fill()

    // Away from the sun the slopes fall into shade. One gradient across the
    // shape does what an hour of hand-shading would, and never fights the type.
    if (opt.shade !== false) {
      ctx.save()
      ctx.clip()
      const g = ctx.createLinearGradient(0, 0, w, 0)
      g.addColorStop(0, at(pal.ink, 0.24 * (1 - depth * 0.7)))
      g.addColorStop(LIGHT.x, at(pal.ink, 0))
      g.addColorStop(1, at(pal.ink, 0.1 * (1 - depth * 0.7)))
      ctx.fillStyle = g
      ctx.fillRect(0, 0, w, h)
      ctx.restore()
    }

    if (opt.rim !== false) {
      ctx.save()
      ctx.beginPath()
      trace(ctx, pts)
      ctx.lineWidth = Math.max(0.8, h * 0.006)
      ctx.strokeStyle = rimGrad(ctx, w, pal, (opt.rimAlpha ?? 0.5) * (1 - depth * 0.45))
      ctx.stroke()
      ctx.restore()
    }
    return pts
  }

  function rimGrad(ctx, w, pal, alpha) {
    const g = ctx.createLinearGradient(0, 0, w, 0)
    const c = mix(pal.glow, '#ffffff', 0.35, alpha)
    const off = mix(pal.glow, '#ffffff', 0.35, 0)
    g.addColorStop(0, off)
    g.addColorStop(Math.max(0.001, LIGHT.x - 0.5), off)
    g.addColorStop(LIGHT.x, c)
    g.addColorStop(Math.min(0.999, LIGHT.x + 0.26), off)
    g.addColorStop(1, off)
    return g
  }

  /* Air, pooling at the foot of a range. Distance in a landscape is mostly
   * read from these bands: without one, two ridges of different value still
   * look like two flat cut-outs stacked on a table. */
  function mist(ctx, w, h, pal, y, band, alpha) {
    const g = ctx.createLinearGradient(0, y - band, 0, y + band * 0.35)
    g.addColorStop(0, at(pal.haze, 0))
    g.addColorStop(0.72, at(pal.haze, alpha))
    g.addColorStop(1, at(pal.haze, alpha * 0.5))
    ctx.fillStyle = g
    ctx.fillRect(0, y - band, w, band * 1.35)
  }

  /* Water. The glitter column under the sun is the whole illusion — flat fill
   * plus a scatter of dashes reads as a floor, and the column is what turns it
   * into a surface with a light on it. Density falls toward the horizon
   * because the dashes there are foreshortened into nothing. */
  function water(ctx, w, h, pal, topY, r, opt = {}) {
    if (!pal.water) return
    const depth = h - topY
    // `lift` is for water seen up a channel rather than out to sea: a river
    // running away from you is nearly all sky-reflection and almost no water.
    const lift = opt.lift || 0
    const g = ctx.createLinearGradient(0, topY, 0, h)
    g.addColorStop(0, mix(pal.water, pal.glow, 0.42 + lift))
    g.addColorStop(0.25, mix(pal.water, pal.glow, 0.14 + lift * 0.9))
    g.addColorStop(1, mix(pal.water, pal.ink, 0.55 - lift))
    ctx.fillStyle = g
    ctx.fillRect(0, topY, w, depth)

    const sx = w * LIGHT.x
    ctx.save()
    for (let i = 0; i < 26; i++) {
      const t = Math.pow(i / 26, 0.75)
      const y = topY + depth * (0.02 + t * 0.98)
      const spread = w * (0.012 + t * 0.1)
      const len = w * (0.01 + t * 0.05) * (0.4 + r())
      const x = sx + (r() - 0.5) * spread * 2 - len / 2
      ctx.fillStyle = mix(pal.glow, '#ffffff', 0.4, 0.42 * (1 - t * 0.55))
      ctx.fillRect(x, y, len, Math.max(0.7, h * (0.003 + t * 0.006)))
    }
    // Chop away from the column, in the water's own colour rather than white:
    // white speckle on water reads as dust on the plate.
    for (let i = 0; i < 22; i++) {
      const t = Math.pow(r(), 0.6)
      const y = topY + depth * (0.05 + t * 0.95)
      const x = w * r()
      const len = w * (0.02 + t * 0.06)
      ctx.fillStyle = mix(pal.water, i % 3 ? pal.haze : pal.ink, 0.4, 0.16 + t * 0.14)
      ctx.fillRect(x - len / 2, y, len, Math.max(0.7, h * 0.004))
    }
    ctx.restore()

    if (opt.shore !== false) {
      ctx.fillStyle = mix(pal.glow, '#ffffff', 0.3, 0.28)
      ctx.fillRect(0, topY, w, Math.max(0.7, h * 0.004))
    }
  }

  /** Mirror whatever `body` draws into the water below `y`, broken up by a few
   *  horizontal slices so it wobbles rather than mirrors like a bathroom. */
  function reflect(ctx, w, h, pal, y, alpha, body) {
    ctx.save()
    ctx.globalAlpha = alpha
    ctx.translate(0, y * 2)
    ctx.scale(1, -1)
    body()
    ctx.restore()
    ctx.save()
    ctx.globalCompositeOperation = 'source-over'
    for (let i = 0; i < 7; i++) {
      const yy = y + (h - y) * (i / 7) + (h - y) * 0.02
      ctx.fillStyle = mix(pal.water, pal.glow, 0.1, 0.3)
      ctx.fillRect(0, yy, w, Math.max(0.8, (h - y) * 0.03))
    }
    ctx.restore()
  }

  /* A palm. Three of these place a picture in the tropics faster than any
   * amount of correct landform does, and they give the eye something of known
   * size to measure the rest against.
   *
   * The frond is the whole tree: it leaves the crown rising, turns over, and
   * falls past the horizontal — draw it as a straight ray and you get a
   * sunburst, which is the failure mode of every procedural palm. So each one
   * is a curve whose tip is below its own control point, and the crown leans
   * away from the trunk's lean rather than sitting square on it. */
  function palm(ctx, x, y, size, color, r) {
    const lean = (r() - 0.5) * size * 0.4
    ctx.save()
    ctx.strokeStyle = color
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.lineWidth = Math.max(1, size * 0.045)
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.quadraticCurveTo(x + lean * 0.2, y - size * 0.62, x + lean, y - size)
    ctx.stroke()
    const tx = x + lean
    const ty = y - size
    const n = 5 + Math.floor(r() * 3)
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1)
      const a = Math.PI * (0.08 + t * 0.84) + (r() - 0.5) * 0.2
      const len = size * (0.4 + r() * 0.22)
      const dx = Math.cos(a) * len
      const lift = Math.sin(a) * len * 0.5 + len * 0.1
      ctx.lineWidth = Math.max(0.8, size * (0.05 - Math.abs(t - 0.5) * 0.03))
      ctx.beginPath()
      ctx.moveTo(tx, ty)
      ctx.quadraticCurveTo(tx + dx * 0.42, ty - lift, tx + dx, ty - lift * 0.25 + len * 0.34)
      ctx.stroke()
    }
    ctx.restore()
  }

  /* A boat, at the size a boat actually is against a headland — which is to
   * say almost nothing. It is here for scale, not for interest. */
  function boat(ctx, x, y, size, color) {
    ctx.save()
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.moveTo(x - size, y)
    ctx.quadraticCurveTo(x, y + size * 0.42, x + size, y)
    ctx.closePath()
    ctx.fill()
    ctx.beginPath()
    ctx.moveTo(x - size * 0.1, y - size * 0.05)
    ctx.quadraticCurveTo(x + size * 0.35, y - size * 0.9, x + size * 0.1, y - size * 1.5)
    ctx.quadraticCurveTo(x + size * 0.05, y - size * 0.7, x + size * 0.7, y - size * 0.1)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  }

  /** A warm point of light with the halo it would throw. */
  function lamp(ctx, x, y, radius, color) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, radius * 6)
    g.addColorStop(0, mix(color, '#ffffff', 0.5, 0.9))
    g.addColorStop(0.16, at(color, 0.5))
    g.addColorStop(1, at(color, 0))
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(x, y, radius * 6, 0, Math.PI * 2)
    ctx.fill()
  }

  /* ------------------------------------------------------------ scene kinds */

  const DRAW = {
    /* Limestone towers standing in flat water. The read depends on the
     * profile: vertical sides, undercut at the waterline, and a crown that
     * rolls over rather than points — a pointed one is a mountain, and Hạ Long
     * is emphatically not mountains. */
    karst(ctx, w, h, pal, r) {
      const sea = h * 0.58
      sun(ctx, w, h, pal)
      clouds(ctx, w, h, pal, r, 3)
      landform(ctx, w, h, crest(w, h * 0.52, h * 0.06, r, 10), pal, 0.95, { rimAlpha: 0.3 })
      mist(ctx, w, h, pal, h * 0.54, h * 0.09, 0.24)

      /* The profile: sides that go up rather than in, an undercut where the
       * sea has eaten the base, and a crown that rolls over. A pointed top
       * would be a mountain, and Hạ Long is emphatically not mountains. */
      const tower = (cx, tw, th, baseY) => {
        ctx.beginPath()
        ctx.moveTo(cx - tw, baseY)
        ctx.quadraticCurveTo(cx - tw * 1.18, baseY - th * 0.12, cx - tw * 0.92, baseY - th * 0.3)
        ctx.quadraticCurveTo(cx - tw * 0.82, baseY - th * 0.78, cx - tw * 0.55, baseY - th * 0.95)
        ctx.quadraticCurveTo(cx - tw * 0.2, baseY - th * 1.04, cx + tw * 0.34, baseY - th * 0.9)
        ctx.quadraticCurveTo(cx + tw * 0.86, baseY - th * 0.74, cx + tw * 0.9, baseY - th * 0.34)
        ctx.quadraticCurveTo(cx + tw * 1.16, baseY - th * 0.1, cx + tw, baseY)
        ctx.closePath()
        ctx.fill()
      }

      // Three ranks, back to front. Overlap is what makes them stand in water
      // rather than sit in a row, so the ranks are deliberately interleaved.
      const ranks = [
        { n: 4, depth: 0.74, base: sea - h * 0.02, hi: 0.18, lo: 0.1, wide: 0.34 },
        { n: 3, depth: 0.42, base: sea + h * 0.01, hi: 0.32, lo: 0.18, wide: 0.3 },
        { n: 2, depth: 0.08, base: sea + h * 0.06, hi: 0.44, lo: 0.28, wide: 0.26 },
      ]
      const drawn = []
      for (const rank of ranks) {
        for (let i = 0; i < rank.n; i++) {
          const cx = w * ((i + 0.5) / rank.n + (r() - 0.5) * 0.24)
          const th = h * (rank.lo + r() * (rank.hi - rank.lo))
          // Width tracks height loosely, not tightly: a rank of towers all in
          // the same proportion reads as a picket fence.
          const tw = th * rank.wide * (0.7 + r() * 0.8)
          drawn.push({ cx, tw, th, base: rank.base, depth: rank.depth })
          ctx.fillStyle = layer(pal, rank.depth)
          tower(cx, tw, th, rank.base)
          // A lit edge down the sunward flank, not just along the top: these
          // are vertical cliffs and the light rakes across them.
          ctx.save()
          ctx.beginPath()
          tower(cx, tw, th, rank.base)
          ctx.clip()
          const g = ctx.createLinearGradient(cx - tw, 0, cx + tw, 0)
          g.addColorStop(0, at(pal.ink, 0.3))
          g.addColorStop(0.62, at(pal.ink, 0))
          g.addColorStop(1, mix(pal.glow, '#ffffff', 0.4, 0.3 * (1 - rank.depth)))
          ctx.fillStyle = g
          ctx.fillRect(cx - tw * 1.2, rank.base - th * 1.1, tw * 2.4, th * 1.2)
          // Fissures. Limestone weathers in vertical runs, and two lines of it
          // are the difference between a rock and a lozenge.
          if (rank.depth < 0.5) {
            ctx.strokeStyle = at(pal.ink, 0.3)
            ctx.lineWidth = Math.max(0.7, h * 0.004)
            for (let k = 0; k < 2; k++) {
              const fx = cx + (r() - 0.5) * tw * 1.2
              ctx.beginPath()
              ctx.moveTo(fx, rank.base - th * (0.82 - r() * 0.2))
              ctx.lineTo(fx + tw * 0.12, rank.base - th * 0.1)
              ctx.stroke()
            }
          }
          ctx.restore()
        }
      }

      water(ctx, w, h, pal, sea, r)
      reflect(ctx, w, h, pal, sea, 0.3, () => {
        for (const t of drawn) {
          if (t.base > sea + h * 0.02) continue
          ctx.fillStyle = layer(pal, t.depth)
          tower(t.cx, t.tw * 0.96, t.th * 0.7, t.base)
        }
      })
      boat(ctx, w * (0.12 + r() * 0.18), sea + h * 0.13, h * 0.035, at(pal.ink, 0.75))
    },

    /* A cone. The profile is the entire subject, so it is drawn as two
     * concave curves rather than straight sides — a straight-sided triangle is
     * a party hat, and the slack in a real volcano's flanks is what says this
     * thing was poured rather than built. */
    volcano(ctx, w, h, pal, r) {
      sun(ctx, w, h, pal, 0.4)
      clouds(ctx, w, h, pal, r, 3)
      landform(ctx, w, h, crest(w, h * 0.66, h * 0.06, r, 9), pal, 0.95, { rimAlpha: 0.25 })

      const cx = w * (0.38 + r() * 0.24)
      const baseY = h * 0.78
      const peakY = h * (0.17 + r() * 0.07)
      const half = w * (0.26 + r() * 0.08)
      const rimW = half * 0.13
      const cone = (k = 1) => {
        ctx.beginPath()
        ctx.moveTo(cx - half * k, baseY)
        ctx.quadraticCurveTo(cx - half * 0.34 * k, baseY - (baseY - peakY) * 0.52, cx - rimW * k, peakY)
        ctx.lineTo(cx + rimW * 0.6 * k, peakY + (baseY - peakY) * 0.035)
        ctx.quadraticCurveTo(cx + half * 0.36 * k, baseY - (baseY - peakY) * 0.5, cx + half * k, baseY)
        ctx.closePath()
      }

      // A smaller neighbour, always to the shaded side, so the main cone keeps
      // the light. Bromo has one; so does almost every caldera worth drawing.
      const sib = cx - half * (0.9 + r() * 0.3)
      ctx.fillStyle = layer(pal, 0.62)
      ctx.beginPath()
      ctx.moveTo(sib - half * 0.42, baseY)
      ctx.quadraticCurveTo(sib - half * 0.14, baseY - h * 0.16, sib, h * 0.44)
      ctx.quadraticCurveTo(sib + half * 0.16, baseY - h * 0.15, sib + half * 0.44, baseY)
      ctx.closePath()
      ctx.fill()

      ctx.fillStyle = layer(pal, 0.3)
      cone()
      ctx.fill()

      // Ash on the flanks, in gullies running down from the rim. Radial, not
      // vertical: they follow the cone, which is what stops it reading flat.
      ctx.save()
      cone()
      ctx.clip()
      for (let i = 0; i < 5; i++) {
        const t = (i + 0.5) / 5
        const x0 = cx + (t - 0.5) * rimW * 1.6
        const x1 = cx + (t - 0.5) * half * 2.1
        const startY = peakY + (baseY - peakY) * (0.25 + r() * 0.2)
        ctx.strokeStyle = mix(pal.ink, pal.glow, x1 > cx ? 0.22 : 0.04, 0.16)
        ctx.lineWidth = Math.max(0.7, h * (0.004 + r() * 0.006))
        ctx.beginPath()
        ctx.moveTo(x0 + (x1 - x0) * 0.25, startY)
        ctx.quadraticCurveTo((x0 + x1) / 2, (startY + baseY) / 2, x1, baseY)
        ctx.stroke()
      }
      const g = ctx.createLinearGradient(cx - half, 0, cx + half, 0)
      g.addColorStop(0, at(pal.ink, 0.45))
      g.addColorStop(0.7, at(pal.ink, 0))
      g.addColorStop(1, mix(pal.glow, '#ffffff', 0.3, 0.16))
      ctx.fillStyle = g
      ctx.fillRect(cx - half, peakY, half * 2, baseY - peakY)
      ctx.restore()

      // Crater glow and plume. The plume leans, always downwind of the same
      // wind, and thins as it rises — a solid puff reads as a cartoon.
      const ember = pal.accent || '#e9a63e'
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      lamp(ctx, cx - rimW * 0.2, peakY + h * 0.005, h * 0.012, ember)
      ctx.restore()
      const lean = w * (0.1 + r() * 0.12)
      for (let i = 0; i < 5; i++) {
        const t = (i + 1) / 5
        ctx.fillStyle = mix(pal.haze, pal.glow, 0.2, 0.2 * (1 - t * 0.6))
        ctx.beginPath()
        ctx.ellipse(
          cx + lean * t * t,
          peakY - h * (0.03 + t * 0.13),
          w * (0.035 + t * 0.075),
          h * (0.022 + t * 0.045),
          -0.2,
          0,
          Math.PI * 2
        )
        ctx.fill()
      }

      /* The ash plain the cone stands on, and then the rim of the caldera we
       * are standing on ourselves. Both are needed: a far ridge fills to the
       * bottom of the frame, so without them the ground under our feet is
       * painted the colour of the horizon, and the whole plate goes flat. */
      mist(ctx, w, h, pal, h * 0.79, h * 0.08, 0.22)
      landform(ctx, w, h, crest(w, h * 0.86, h * 0.03, r, 7), pal, 0.22, { rim: false })
      landform(ctx, w, h, crest(w, h * 1.0, h * 0.06, r, 8), pal, 0.02, { rim: false, shade: false })
    },

    /* A stepped plinth carrying towers. Angkor, Borobudur and Wat Arun are not
     * the same building, but at 200px they share one silhouette: a wide base
     * that steps in, and a bundle of tapering towers with the tallest at the
     * centre. Drawing that silhouette well beats drawing three buildings badly. */
    temple(ctx, w, h, pal, r) {
      sun(ctx, w, h, pal, 0.5)
      clouds(ctx, w, h, pal, r, 4)
      landform(ctx, w, h, crest(w, h * 0.6, h * 0.05, r, 9), pal, 0.95, { rimAlpha: 0.25 })
      mist(ctx, w, h, pal, h * 0.6, h * 0.08, 0.26)
      // The plain the compound sits on, so the ground is not painted the
      // colour of the far horizon.
      landform(ctx, w, h, crest(w, h * 0.78, h * 0.02, r, 6), pal, 0.42, { rim: false })

      const cx = w * (0.46 + (r() - 0.5) * 0.12)
      const ground = h * 0.8
      const ink = layer(pal, 0.16)

      /* A prang: shrinking bands, then a spire. The bands are what make it
       * read as carved rather than moulded, and they cost four lines. */
      const prang = (x, base, tall, wide) => {
        const tiers = 5
        ctx.fillStyle = ink
        for (let i = 0; i < tiers; i++) {
          const t = i / tiers
          const bw = wide * (1 - t * 0.62)
          const by = base - tall * (t * 0.62)
          const bh = tall * 0.14
          ctx.beginPath()
          ctx.moveTo(x - bw, by)
          ctx.lineTo(x - bw * 0.86, by - bh)
          ctx.lineTo(x + bw * 0.86, by - bh)
          ctx.lineTo(x + bw, by)
          ctx.closePath()
          ctx.fill()
        }
        const sy = base - tall * 0.62
        ctx.beginPath()
        ctx.moveTo(x - wide * 0.38, sy)
        ctx.quadraticCurveTo(x - wide * 0.16, sy - tall * 0.22, x - wide * 0.05, sy - tall * 0.38)
        ctx.lineTo(x, sy - tall * 0.44)
        ctx.lineTo(x + wide * 0.05, sy - tall * 0.38)
        ctx.quadraticCurveTo(x + wide * 0.16, sy - tall * 0.22, x + wide * 0.38, sy)
        ctx.closePath()
        ctx.fill()
        // The one lit edge. Everything else about this shape is a silhouette.
        ctx.save()
        ctx.strokeStyle = mix(pal.glow, '#ffffff', 0.4, 0.34)
        ctx.lineWidth = Math.max(0.8, h * 0.005)
        ctx.beginPath()
        ctx.moveTo(x + wide * 0.05, sy - tall * 0.38)
        ctx.quadraticCurveTo(x + wide * 0.16, sy - tall * 0.22, x + wide * 0.38, sy)
        ctx.stroke()
        ctx.restore()
      }

      // The plinth: three courses, each stepping in and up, each a shade
      // darker than the one below so the stack reads as stone in the round.
      const plW = w * (0.3 + r() * 0.05)
      for (let i = 0; i < 3; i++) {
        const t = i / 3
        const bw = plW * (1 - t * 0.3)
        const by = ground - i * h * 0.055
        ctx.fillStyle = layer(pal, 0.2 - i * 0.05)
        ctx.fillRect(cx - bw, by - h * 0.058, bw * 2, h * 0.058)
      }
      // A lit top edge on each course, which is where the stone reads.
      ctx.save()
      ctx.strokeStyle = mix(pal.glow, '#ffffff', 0.35, 0.2)
      ctx.lineWidth = Math.max(0.7, h * 0.004)
      for (let i = 0; i < 3; i++) {
        const t = i / 3
        const bw = plW * (1 - t * 0.3)
        const by = ground - i * h * 0.055 - h * 0.058
        ctx.beginPath()
        ctx.moveTo(cx - bw, by)
        ctx.lineTo(cx + bw, by)
        ctx.stroke()
      }
      ctx.restore()

      const top = ground - h * 0.166
      const tall = h * (0.32 + r() * 0.08)
      const spread = plW * (0.46 + r() * 0.12)
      prang(cx, top, tall, w * 0.036)
      prang(cx - spread, top, tall * 0.6, w * 0.026)
      prang(cx + spread, top, tall * 0.62, w * 0.026)
      if (r() > 0.45) {
        prang(cx - spread * 1.7, top, tall * 0.42, w * 0.02)
        prang(cx + spread * 1.7, top, tall * 0.44, w * 0.02)
      }

      // Trees at the compound's edge, dark and near. They put the temple at a
      // distance, which a temple drawn alone never is.
      const dark = layer(pal, 0.02)
      palm(ctx, w * (0.06 + r() * 0.06), h * 0.9, h * 0.34, dark, r)
      palm(ctx, w * (0.16 + r() * 0.05), h * 0.94, h * 0.28, dark, r)
      palm(ctx, w * (0.9 + r() * 0.06), h * 0.92, h * 0.32, dark, r)
      ctx.fillStyle = dark
      ctx.fillRect(0, ground + h * 0.03, w, h)
    },

    /* A city from across its water. Towers are boxes, so the interest has to
     * come from the skyline's profile and from the light in the windows — the
     * two things that actually distinguish a city from a bar chart. */
    skyline(ctx, w, h, pal, r) {
      const sea = h * 0.78
      sun(ctx, w, h, pal, 0.45)
      clouds(ctx, w, h, pal, r, 4)

      const accent = pal.accent || '#e9a63e'
      const rows = [
        { depth: 0.66, base: h * 0.72, max: h * 0.34, gap: 0.006, lit: 0.12 },
        { depth: 0.34, base: h * 0.76, max: h * 0.46, gap: 0.008, lit: 0.2 },
        { depth: 0.08, base: sea, max: h * 0.4, gap: 0.012, lit: 0.3 },
      ]
      for (const row of rows) {
        let x = -w * 0.04
        ctx.fillStyle = layer(pal, row.depth)
        while (x < w * 1.02) {
          const bw = w * (0.025 + r() * 0.055)
          const bh = row.max * (0.3 + r() * 0.7)
          const y = row.base - bh
          const kind = r()
          ctx.fillStyle = layer(pal, row.depth)
          ctx.fillRect(x, y, bw, bh)
          // Tops: a setback, a mast, or nothing. Three profiles is enough to
          // stop the row reading as a comb; more and it reads as novelty.
          if (kind > 0.78) {
            ctx.fillRect(x + bw * 0.2, y - bh * 0.16, bw * 0.6, bh * 0.16)
            ctx.fillRect(x + bw * 0.42, y - bh * 0.3, bw * 0.16, bh * 0.15)
          } else if (kind > 0.6) {
            ctx.fillRect(x + bw * 0.44, y - h * 0.07, Math.max(1, bw * 0.09), h * 0.07)
          }
          // Windows: a sparse grid, warmer and denser low down where the
          // streets are. Never a full grid — a lit tower is a lightbox.
          if (r() < 0.85) {
            const cols = Math.max(1, Math.floor(bw / (w * 0.014)))
            const cellH = h * 0.026
            const rowsN = Math.floor(bh / cellH)
            const uw = Math.max(0.8, bw / cols * 0.34)
            const uh = Math.max(0.8, cellH * 0.32)
            for (let cxi = 0; cxi < cols; cxi++) {
              for (let ry = 0; ry < rowsN; ry++) {
                const low = ry / Math.max(1, rowsN - 1)
                if (r() > row.lit + low * 0.22) continue
                ctx.fillStyle = mix(accent, '#ffffff', 0.25, 0.24 + r() * 0.5)
                ctx.fillRect(
                  x + ((cxi + 0.5) * bw) / cols - uw / 2,
                  y + (ry + 0.5) * cellH - uh / 2,
                  uw,
                  uh
                )
              }
            }
          }
          x += bw + w * row.gap
        }
        // The air between this rank and the next.
        mist(ctx, w, h, pal, row.base + h * 0.01, h * 0.13, 0.26 - row.depth * 0.1)
      }

      water(ctx, w, h, pal, sea, r)
      // The city's light, running down the water toward us in a broken column.
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      for (let i = 0; i < 16; i++) {
        const t = i / 16
        const x = w * r()
        const y = sea + (h - sea) * Math.pow(r(), 0.7)
        ctx.fillStyle = at(accent, 0.16 * (1 - t * 0.4))
        ctx.fillRect(x, y, w * (0.004 + r() * 0.01), Math.max(0.7, h * 0.004))
      }
      ctx.restore()
    },

    /* Sea, a headland, and something in the middle distance to look at. The
     * horizon sits high here — on a coast the sea is the subject, and a low
     * horizon turns the plate into a study of the sky. */
    coast(ctx, w, h, pal, r) {
      const sea = h * 0.46
      sun(ctx, w, h, pal)
      clouds(ctx, w, h, pal, r, 4)

      // Islands, stacked in depth. Each one nearer is darker and taller, which
      // is the whole of aerial perspective in three shapes.
      const isles = 3 + Math.floor(r() * 2)
      for (let i = 0; i < isles; i++) {
        const depth = 0.9 - i * 0.14
        const cx = w * (0.06 + r() * 0.84)
        const iw = w * (0.09 + r() * 0.14)
        const ih = h * (0.05 + r() * 0.08)
        ctx.fillStyle = layer(pal, depth)
        ctx.beginPath()
        ctx.moveTo(cx - iw, sea)
        ctx.quadraticCurveTo(cx - iw * 0.4, sea - ih * 1.4, cx + iw * 0.12, sea - ih)
        ctx.quadraticCurveTo(cx + iw * 0.6, sea - ih * 0.7, cx + iw, sea)
        ctx.closePath()
        ctx.fill()
      }
      mist(ctx, w, h, pal, sea + h * 0.005, h * 0.04, 0.22)

      water(ctx, w, h, pal, sea, r)

      /* The headland, running in from one side and out into the water. It is
       * the frame: without it the picture is a horizon line, and a horizon
       * line is a placeholder, not an illustration.
       *
       * Its crest has to break the skyline — a cape that stays below the
       * horizon reads as a stain on the water rather than as land. */
      const left = r() > 0.45
      const sx = left ? 0 : w
      const dir = left ? 1 : -1
      const reach = w * (0.4 + r() * 0.16)
      const capeY = h * (0.3 + r() * 0.06)
      const cape = () => {
        ctx.beginPath()
        ctx.moveTo(sx, h)
        ctx.lineTo(sx, capeY)
        ctx.quadraticCurveTo(sx + dir * reach * 0.34, capeY - h * 0.05, sx + dir * reach * 0.66, capeY + h * 0.13)
        ctx.quadraticCurveTo(sx + dir * reach * 0.92, capeY + h * 0.24, sx + dir * reach, sea + h * 0.03)
        ctx.lineTo(sx + dir * reach * 0.74, h)
        ctx.closePath()
      }
      ctx.fillStyle = layer(pal, 0.06)
      cape()
      ctx.fill()
      ctx.save()
      cape()
      ctx.clip()
      const g = ctx.createLinearGradient(sx, 0, sx + dir * reach, 0)
      g.addColorStop(0, at(pal.ink, left ? 0.34 : 0.06))
      g.addColorStop(1, mix(pal.glow, '#ffffff', 0.3, left ? 0.16 : 0.03))
      ctx.fillStyle = g
      ctx.fillRect(Math.min(sx, sx + dir * reach), 0, reach, h)
      ctx.restore()
      ctx.save()
      ctx.strokeStyle = rimGrad(ctx, w, pal, 0.4)
      ctx.lineWidth = Math.max(0.8, h * 0.006)
      ctx.beginPath()
      ctx.moveTo(sx, capeY)
      ctx.quadraticCurveTo(sx + dir * reach * 0.34, capeY - h * 0.05, sx + dir * reach * 0.66, capeY + h * 0.13)
      ctx.quadraticCurveTo(sx + dir * reach * 0.92, capeY + h * 0.24, sx + dir * reach, sea + h * 0.03)
      ctx.stroke()
      ctx.restore()

      /* Palms standing on the cape's own skyline. Their feet are solved onto
       * the crest curve rather than guessed at a height — guessed, they float,
       * and a floating tree is the first thing anyone notices. */
      const dark = layer(pal, 0.03)
      const crestAt = t => {
        const u = 1 - t
        return [
          u * u * sx + 2 * u * t * (sx + dir * reach * 0.34) + t * t * (sx + dir * reach * 0.66),
          u * u * capeY + 2 * u * t * (capeY - h * 0.05) + t * t * (capeY + h * 0.13),
        ]
      }
      for (let i = 0; i < 3; i++) {
        const [pxx, pyy] = crestAt(0.24 + i * 0.26 + r() * 0.08)
        palm(ctx, pxx, pyy + h * 0.01, h * (0.16 + r() * 0.07), dark, r)
      }

      /* A near shore across the bottom, with the swash line the sea leaves on
       * it. That one bright curve is what says beach — without it the dark
       * band along the bottom is just a border. */
      ctx.fillStyle = dark
      ctx.beginPath()
      ctx.moveTo(0, h)
      ctx.lineTo(w, h)
      ctx.lineTo(w, h * 0.9)
      ctx.quadraticCurveTo(w * 0.5, h * 0.8, 0, h * 0.94)
      ctx.closePath()
      ctx.fill()
      ctx.save()
      ctx.strokeStyle = mix(pal.glow, '#ffffff', 0.5, 0.3)
      ctx.lineWidth = Math.max(0.9, h * 0.005)
      ctx.beginPath()
      ctx.moveTo(0, h * 0.94)
      ctx.quadraticCurveTo(w * 0.5, h * 0.8, w, h * 0.9)
      ctx.stroke()
      ctx.restore()
      boat(ctx, sx + dir * w * (0.62 + r() * 0.2), sea + h * 0.09, h * 0.03, at(pal.ink, 0.7))
    },

    /* Ranges, one behind another, with the air between them doing the work.
     * The whole subject is the interval — four ridges of the same colour would
     * be one grey shape, and four ridges with mist between them is a country. */
    hills(ctx, w, h, pal, r) {
      sun(ctx, w, h, pal)
      clouds(ctx, w, h, pal, r, 5)
      const bands = [
        { base: 0.4, amp: 0.16, depth: 0.95, band: 0.07, mistA: 0.3 },
        { base: 0.53, amp: 0.15, depth: 0.6, band: 0.07, mistA: 0.22 },
        { base: 0.68, amp: 0.15, depth: 0.28, band: 0.07, mistA: 0.14 },
        { base: 0.88, amp: 0.14, depth: 0.05, band: 0.06, mistA: 0.08 },
      ]
      for (const b of bands) {
        const pts = landform(ctx, w, h, crest(w, h * b.base, h * b.amp, r, 12), pal, b.depth)
        // Hatching on the nearest range only, and only on its shaded flank.
        // Everywhere else it would read as noise at this size.
        if (b.depth < 0.2) {
          ctx.save()
          ctx.beginPath()
          trace(ctx, pts)
          ctx.lineTo(w, h)
          ctx.lineTo(0, h)
          ctx.closePath()
          ctx.clip()
          ctx.strokeStyle = at(pal.haze, 0.09)
          ctx.lineWidth = Math.max(0.7, h * 0.004)
          for (let x = -h; x < w; x += h * 0.035) {
            ctx.beginPath()
            ctx.moveTo(x, h)
            ctx.lineTo(x + h * 0.5, h * 0.4)
            ctx.stroke()
          }
          ctx.restore()

          /* A treeline along the nearest crest. Hill country in this part of
           * the world is forested to the top, and a bare rolling ridge reads
           * as downland — English, not Lao. Tufts rather than trees: at this
           * size a drawn tree is a smudge, and a broken edge is the thing the
           * eye actually reads as forest. */
          ctx.fillStyle = layer(pal, 0)
          for (let i = 1; i < pts.length - 1; i++) {
            const [tx, ty] = pts[i]
            const n = 3
            for (let k = 0; k < n; k++) {
              const jx = tx + (k - 1) * (w / pts.length) * 0.34 + (r() - 0.5) * w * 0.01
              const jh = h * (0.012 + r() * 0.022)
              ctx.beginPath()
              ctx.moveTo(jx - jh * 0.45, ty + h * 0.012)
              ctx.quadraticCurveTo(jx - jh * 0.3, ty - jh * 0.7, jx, ty - jh)
              ctx.quadraticCurveTo(jx + jh * 0.3, ty - jh * 0.7, jx + jh * 0.45, ty + h * 0.012)
              ctx.closePath()
              ctx.fill()
            }
          }
        }
        mist(ctx, w, h, pal, h * (b.base + b.amp * 0.5), h * b.band, b.mistA)
      }
    },

    /* Canopy. A forest at this size is not trees, it is a texture with a
     * profile — so the crowns are drawn as a broken edge, and the only
     * individual trees are the emergents standing a head above it, which is
     * exactly how a rainforest reads from a train window. */
    forest(ctx, w, h, pal, r) {
      sun(ctx, w, h, pal, 0.35)
      clouds(ctx, w, h, pal, r, 4)
      landform(ctx, w, h, crest(w, h * 0.42, h * 0.12, r, 10), pal, 0.95, { rimAlpha: 0.3 })
      mist(ctx, w, h, pal, h * 0.47, h * 0.1, 0.3)

      const bands = [
        { base: 0.56, depth: 0.48, size: 0.05, mistA: 0.2 },
        { base: 0.72, depth: 0.2, size: 0.07, mistA: 0.12 },
        { base: 0.94, depth: 0.02, size: 0.1, mistA: 0 },
      ]
      for (const b of bands) {
        ctx.fillStyle = layer(pal, b.depth)
        let x = -w * 0.05
        const crowns = []
        while (x < w * 1.06) {
          const rad = w * b.size * (0.5 + r() * 1.1)
          const cy = h * b.base - rad * (0.1 + r() * 0.55)
          crowns.push([x, cy, rad])
          /* Each crown gets a shoulder on one side and sits lower than it is
           * wide. A run of clean half-circles reads as a row of bubbles; a
           * broad, lopsided crown reads as a tree seen from a long way off,
           * which is what it is. */
          const skew = (r() - 0.5) * 0.6
          const dome = () => {
            ctx.beginPath()
            ctx.moveTo(x - rad, h)
            ctx.lineTo(x - rad, cy + rad * 0.15)
            ctx.bezierCurveTo(
              x - rad * (0.85 + skew), cy - rad * (0.5 + skew * 0.5),
              x + rad * (0.7 - skew), cy - rad * (0.9 - skew * 0.4),
              x + rad, cy + rad * 0.1
            )
            ctx.lineTo(x + rad, h)
            ctx.closePath()
          }
          dome()
          ctx.fill()
          // Light on the top of this crown, drawn now rather than in a second
          // pass: a rim laid over the whole band afterwards floats on top of
          // the crowns in front of it, which reads as scratches on the plate.
          ctx.save()
          ctx.strokeStyle = rimGrad(ctx, w, pal, 0.34 * (1 - b.depth * 0.4))
          ctx.lineWidth = Math.max(0.8, h * 0.005)
          ctx.beginPath()
          ctx.moveTo(x - rad * 0.92, cy - rad * 0.05)
          ctx.bezierCurveTo(
            x - rad * (0.8 + skew), cy - rad * (0.55 + skew * 0.5),
            x + rad * (0.65 - skew), cy - rad * (0.95 - skew * 0.4),
            x + rad * 0.92, cy + rad * 0.02
          )
          ctx.stroke()
          ctx.restore()
          x += rad * (0.7 + r() * 0.5)
        }
        // Emergents: one or two per band, taller and narrower, breaking the
        // line. Without them a canopy is a hedge.
        if (b.depth > 0.1) {
          ctx.fillStyle = layer(pal, b.depth)
          for (let i = 0; i < 2; i++) {
            const c = crowns[Math.floor(r() * crowns.length)]
            if (!c) continue
            const eh = h * (0.09 + r() * 0.07)
            ctx.beginPath()
            ctx.moveTo(c[0] - c[2] * 0.42, c[1])
            ctx.bezierCurveTo(c[0] - c[2] * 0.36, c[1] - eh * 0.95, c[0] + c[2] * 0.36, c[1] - eh * 0.95, c[0] + c[2] * 0.42, c[1])
            ctx.closePath()
            ctx.fill()
          }
        }
        if (b.mistA) mist(ctx, w, h, pal, h * b.base, h * 0.08, b.mistA)
      }
    },

    /* A river running away from us. The banks converge, and the water is the
     * lightest thing in the plate because it is a mirror of the brightest
     * thing above it — that inversion is what makes a river read as a river
     * and not as a road. */
    river(ctx, w, h, pal, r) {
      const bend = w * (0.42 + r() * 0.16)
      const mouth = h * 0.44
      sun(ctx, w, h, pal)
      clouds(ctx, w, h, pal, r, 4)
      landform(ctx, w, h, crest(w, h * 0.44, h * 0.11, r, 11), pal, 0.95, { rimAlpha: 0.3 })
      mist(ctx, w, h, pal, h * 0.46, h * 0.07, 0.24)

      // The channel, opening toward us out of the haze. It is the lightest
      // thing in the plate, because it is a mirror held up to the brightest.
      water(ctx, w, h, pal, mouth, r, { shore: false, lift: 0.3 })
      ctx.fillStyle = mix(pal.glow, '#ffffff', 0.4, 0.22)
      ctx.fillRect(0, mouth, w, Math.max(0.8, h * 0.005))

      /* Banks. The near one is a plain dark mass because that is what stops
       * the eye at the front; the far one keeps a lit waterline, which is
       * where a river's edge actually shows from downstream. */
      for (const side of [-1, 1]) {
        const depth = side < 0 ? 0.2 : 0.02
        const edge = () => {
          ctx.beginPath()
          ctx.moveTo(side < 0 ? 0 : w, mouth + h * 0.1)
          ctx.quadraticCurveTo(bend + side * w * 0.34, h * 0.55, bend + side * w * 0.055, mouth + h * 0.005)
        }
        ctx.fillStyle = layer(pal, depth)
        edge()
        ctx.quadraticCurveTo(bend + side * w * 0.3, h * 0.7, side < 0 ? w * 0.06 : w * 0.94, h)
        ctx.lineTo(side < 0 ? 0 : w, h)
        ctx.closePath()
        ctx.fill()
        ctx.save()
        ctx.strokeStyle = mix(pal.glow, '#ffffff', 0.4, side < 0 ? 0.26 : 0.12)
        ctx.lineWidth = Math.max(0.8, h * 0.005)
        edge()
        ctx.stroke()
        ctx.restore()
      }

      /* A spur running out from one bank across the head of the reach. Without
       * it the two banks meet in a point and the river reads as a road
       * vanishing to a horizon; with it the water comes round a bend out of
       * the haze, which is what rivers do and roads do not. */
      const spur = r() > 0.5 ? -1 : 1
      ctx.fillStyle = layer(pal, 0.58)
      ctx.beginPath()
      ctx.moveTo(bend + spur * w * 0.34, mouth - h * 0.01)
      ctx.quadraticCurveTo(bend + spur * w * 0.12, mouth + h * 0.005, bend - spur * w * 0.1, mouth + h * 0.035)
      ctx.lineTo(bend + spur * w * 0.4, mouth + h * 0.06)
      ctx.closePath()
      ctx.fill()
      mist(ctx, w, h, pal, mouth + h * 0.05, h * 0.06, 0.3)

      const dark = layer(pal, 0.02)
      palm(ctx, w * (0.1 + r() * 0.08), h * 0.96, h * 0.34, dark, r)
      palm(ctx, w * (0.86 + r() * 0.1), h * 0.99, h * 0.4, dark, r)
      // A longtail, small, on the light. Boats sit in the glitter column
      // because that is where a boat is visible from the bank.
      const bx = w * (LIGHT.x - 0.06 + r() * 0.1)
      boat(ctx, bx, mouth + h * 0.14, h * 0.032, at(pal.ink, 0.8))
    },

    /* Terraces. The subject is the contour lines, and the thing that makes
     * them read is that each riser holds standing water catching the sky — so
     * every band gets a bright lip and a dark face under it. */
    paddy(ctx, w, h, pal, r) {
      sun(ctx, w, h, pal, 0.5)
      clouds(ctx, w, h, pal, r, 4)
      landform(ctx, w, h, crest(w, h * 0.34, h * 0.11, r, 11), pal, 0.95, { rimAlpha: 0.34 })
      mist(ctx, w, h, pal, h * 0.38, h * 0.07, 0.24)

      /* Terraces read as a stack of curves, so the spacing has to open up
       * toward us — evenly spaced bands read as a corrugated roof. Each band
       * is a dark face with a lit lip on top of it: the lip is standing water
       * catching the sky, and it is the only reason a paddy looks wet. */
      /* The bands alternate flooded and planted rather than stepping evenly
       * through one green. That alternation is the picture: a hillside of
       * terraces at this hour is a stack of bright water and dark crop, and a
       * smooth ramp of six greens reads as a printing fault instead. */
      const bands = 7
      const sag = w * (0.34 + r() * 0.32)
      for (let i = 0; i < bands; i++) {
        const t = i / (bands - 1)
        const y = h * (0.36 + Math.pow(t, 1.3) * 0.56)
        const bow = h * (0.06 + t * 0.09) * (0.8 + r() * 0.5)
        const wet = i % 2 === 0
        const face = h * (0.05 + t * 0.09)
        const lip = () => {
          ctx.beginPath()
          ctx.moveTo(-w * 0.02, y + bow)
          ctx.quadraticCurveTo(sag, y - bow, w * 1.02, y + bow * 0.7)
        }
        ctx.fillStyle = wet
          ? mix(pal.water, pal.glow, 0.5 + (1 - t) * 0.2, 0.85)
          : layer(pal, Math.max(0.02, 0.72 - t * 0.7))
        lip()
        ctx.lineTo(w * 1.02, y + bow * 0.7 + face)
        ctx.quadraticCurveTo(sag, y - bow + face, -w * 0.02, y + bow + face)
        ctx.closePath()
        ctx.fill()
        // The bund holding the water in, lit along its top.
        ctx.save()
        ctx.strokeStyle = mix(pal.ink, pal.glow, wet ? 0.5 : 0.2, 0.4)
        ctx.lineWidth = Math.max(1, h * (0.005 + t * 0.007))
        lip()
        ctx.stroke()
        ctx.restore()
      }

      const dark = layer(pal, 0.02)
      palm(ctx, w * (0.1 + r() * 0.06), h * 0.66, h * 0.26, dark, r)
      palm(ctx, w * (0.18 + r() * 0.05), h * 0.7, h * 0.2, dark, r)
      palm(ctx, w * (0.92 + r() * 0.05), h * 0.72, h * 0.24, dark, r)
    },

    /* Rows of awnings closing over a track. The gap down the middle is the
     * whole point of these places — it is exactly one train wide, and the
     * lamps hanging over it are the only warm thing in the set that is allowed
     * to be bright. */
    market(ctx, w, h, pal, r) {
      const horizon = h * 0.4
      const vpx = w * (0.48 + (r() - 0.5) * 0.08)
      sky(ctx, w, h, pal)
      const accent = pal.accent || '#f2b45c'

      /* The far end of the alley. Not a skyline — a market street closes, and
       * what you see at the end of it is one bright slot of daylight with
       * everything else stacked around it. That slot is where the eye goes,
       * which is why the track is aimed at it. A strip of sky is left above
       * the roofline: seal the top and the plate stops being outdoors. */
      ctx.save()
      const slot = ctx.createLinearGradient(vpx, horizon - h * 0.36, vpx, horizon + h * 0.06)
      slot.addColorStop(0, at(pal.glow, 0))
      slot.addColorStop(1, mix(pal.glow, '#ffffff', 0.45, 0.55))
      ctx.fillStyle = slot
      ctx.fillRect(vpx - w * 0.1, horizon - h * 0.36, w * 0.2, h * 0.42)
      ctx.restore()

      /* The shophouses the awnings hang off. Kept low and close in value:
       * they are the walls of the alley, not the subject, and a tall dark
       * block either side turns the plate into a canyon. */
      for (const side of [-1, 1]) {
        let bx = vpx + side * w * 0.07
        while (side < 0 ? bx > -w * 0.1 : bx < w * 1.1) {
          const bw = w * (0.05 + r() * 0.07)
          const away = Math.min(1, Math.abs(bx - vpx) / (w * 0.45))
          const bh = h * (0.08 + r() * 0.08 + away * 0.16)
          ctx.fillStyle = layer(pal, 0.72 - away * 0.56)
          ctx.fillRect(Math.min(bx, bx + side * bw), horizon - bh, bw, bh + h * 0.2)
          // A shallow roof on some of them, so the roofline is not a bar chart.
          if (r() > 0.5) {
            ctx.beginPath()
            ctx.moveTo(Math.min(bx, bx + side * bw), horizon - bh)
            ctx.lineTo(Math.min(bx, bx + side * bw) + bw * 0.5, horizon - bh - h * 0.03)
            ctx.lineTo(Math.min(bx, bx + side * bw) + bw, horizon - bh)
            ctx.closePath()
            ctx.fill()
          }
          // A window, warm, on maybe one in three. It is what stops this from
          // being a hoarding.
          if (r() > 0.6) {
            ctx.fillStyle = mix(accent, '#ffffff', 0.2, 0.22 + r() * 0.2)
            ctx.fillRect(
              Math.min(bx, bx + side * bw) + bw * 0.3,
              horizon - bh * (0.5 + r() * 0.3),
              bw * 0.26,
              h * 0.02
            )
          }
          bx += side * (bw + w * 0.006)
        }
      }
      mist(ctx, w, h, pal, horizon + h * 0.04, h * 0.12, 0.3)

      /* The track. Sleepers before rails, spacing tightening toward the
       * vanishing point — the rhythm of the sleepers is what says railway,
       * where two converging lines alone would say road. */
      const trackAt = t => w * (0.012 + t * 0.16) // half-width of the gauge
      ctx.save()
      // The ballast is the darkest thing in the plate. Only the rails are
      // allowed to be bright, or the track becomes a lit ramp running at you.
      ctx.fillStyle = layer(pal, 0.04)
      ctx.beginPath()
      ctx.moveTo(vpx - trackAt(0) * 2, horizon)
      ctx.lineTo(vpx + trackAt(0) * 2, horizon)
      ctx.lineTo(vpx + trackAt(1) * 1.8, h)
      ctx.lineTo(vpx - trackAt(1) * 1.8, h)
      ctx.closePath()
      ctx.fill()
      for (let i = 0; i < 14; i++) {
        const t = Math.pow(i / 13, 1.9)
        const y = horizon + (h - horizon) * t
        const g = trackAt(t)
        ctx.fillStyle = mix(pal.ink, pal.haze, 0.4, 0.16)
        ctx.fillRect(vpx - g * 1.25, y, g * 2.5, Math.max(0.7, h * (0.003 + t * 0.008)))
      }
      ctx.strokeStyle = mix(pal.glow, '#ffffff', 0.45, 0.55)
      ctx.lineWidth = Math.max(0.9, h * 0.006)
      for (const side of [-1, 1]) {
        ctx.beginPath()
        ctx.moveTo(vpx + side * trackAt(0), horizon)
        ctx.lineTo(vpx + side * trackAt(1), h)
        ctx.stroke()
      }
      ctx.restore()

      /* Each side of the alley as one receding wall rather than a stack of
       * separate roofs: what reads at this size is the long diagonal closing
       * in on the track, with a scalloped awning edge along it. Individually
       * modelled stalls disappear into mush by the third row.
       *
       * The near end is deliberately steep. A true projection would put it off
       * the bottom of a 200px frame, which is exactly where the panel's own
       * fade is already eating the picture. */
      const rows = 9
      for (const side of [-1, 1]) {
        const edge = []
        for (let i = 0; i <= rows; i++) {
          const t = i / rows
          const y = horizon + (h - horizon) * (0.06 + t * t * 0.94)
          edge.push([vpx + side * (trackAt(t) + w * (0.02 + t * 0.06)), y])
        }
        // The stall mass, dark, running off the outside of the frame.
        ctx.fillStyle = layer(pal, side < 0 ? 0.16 : 0.1)
        ctx.beginPath()
        ctx.moveTo(edge[0][0], edge[0][1])
        for (const [ex, ey] of edge) ctx.lineTo(ex, ey)
        ctx.lineTo(side < 0 ? -w * 0.05 : w * 1.05, h)
        ctx.lineTo(side < 0 ? -w * 0.05 : w * 1.05, horizon)
        ctx.closePath()
        ctx.fill()

        // The awning: a valance of scallops hung along that edge, each one
        // bigger as it comes toward us.
        for (let i = 0; i < rows; i++) {
          const t = i / rows
          const [x0, y0] = edge[i]
          const [x1, y1] = edge[i + 1]
          const sagY = h * (0.014 + t * 0.04)
          ctx.fillStyle = mix(layer(pal, Math.max(0.03, 0.34 - t * 0.3)), accent, 0.12)
          ctx.beginPath()
          ctx.moveTo(x0, y0 - sagY * 1.6)
          ctx.quadraticCurveTo((x0 + x1) / 2 - side * sagY, (y0 + y1) / 2 - sagY * 0.2, x1, y1 - sagY * 1.6)
          ctx.lineTo(x1, y1)
          ctx.lineTo(x0, y0)
          ctx.closePath()
          ctx.fill()
          ctx.save()
          ctx.strokeStyle = mix(accent, '#ffffff', 0.4, 0.24 + t * 0.34)
          ctx.lineWidth = Math.max(0.8, h * 0.005)
          ctx.beginPath()
          ctx.moveTo(x0, y0 - sagY * 1.6)
          ctx.quadraticCurveTo((x0 + x1) / 2 - side * sagY, (y0 + y1) / 2 - sagY * 0.2, x1, y1 - sagY * 1.6)
          ctx.stroke()
          ctx.restore()
        }

        /* Bulbs strung under the awnings. These are the only genuinely bright
         * things in the whole set, and they are allowed to be, because a
         * market is the one destination here that is lit from inside. */
        for (let i = 2; i < rows; i += 2) {
          const t = i / rows
          const [x0, y0] = edge[i]
          ctx.save()
          ctx.globalCompositeOperation = 'lighter'
          lamp(ctx, x0 - side * w * 0.012, y0 - h * (0.015 + t * 0.05), Math.max(0.9, h * (0.004 + t * 0.011)), accent)
          ctx.restore()
        }
      }
    },
  }

  /* Paper. One tile of seeded noise, laid over the finished plate in overlay
   * so it darkens and lightens rather than fogging. It is the difference
   * between a picture and a gradient: flat vector fills at this size look
   * printed by a machine, and a plate should look printed on something.
   *
   * Built once and shared — the noise is the same on every plate, which is
   * correct, because it is the paper, not the picture. */
  let paper = null
  function grain(ctx, w, h, alpha) {
    if (!paper) {
      const c = document.createElement('canvas')
      c.width = c.height = 72
      const g = c.getContext('2d')
      const img = g.createImageData(72, 72)
      const n = rng('paper')
      for (let i = 0; i < img.data.length; i += 4) {
        const v = 118 + Math.floor(n() * 74)
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v
        img.data[i + 3] = 255
      }
      g.putImageData(img, 0, 0)
      paper = c
    }
    ctx.save()
    ctx.globalAlpha = alpha
    ctx.globalCompositeOperation = 'overlay'
    ctx.fillStyle = ctx.createPattern(paper, 'repeat')
    ctx.fillRect(0, 0, w, h)
    ctx.restore()
  }

  /* A plate is darker at its edges than at its light. This is barely visible
   * on its own and it is what stops the corners from competing with the
   * headline sitting over them. */
  function vignette(ctx, w, h, pal) {
    const g = ctx.createRadialGradient(
      w * LIGHT.x, h * LIGHT.y, Math.min(w, h) * 0.35,
      w * LIGHT.x, h * LIGHT.y, Math.max(w, h) * 0.85
    )
    g.addColorStop(0, at(pal.top, 0))
    g.addColorStop(1, at(pal.top, 0.24))
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
  }

  /** Paint one canvas from its data attributes. */
  function paint(canvas) {
    const kind = canvas.dataset.scene
    const pal = PALETTE[kind] || PALETTE.hills
    const draw = DRAW[kind] || DRAW.hills
    const rect = canvas.getBoundingClientRect()
    const cssW = rect.width || canvas.clientWidth || 320
    const cssH = rect.height || canvas.clientHeight || 84
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = Math.round(cssW * dpr)
    canvas.height = Math.round(cssH * dpr)
    const ctx = canvas.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, cssW, cssH)
    const r = rng(canvas.dataset.seed || kind)
    // The market paints its own sky, because its light comes from inside the
    // scene rather than from the horizon.
    if (kind !== 'market') sky(ctx, cssW, cssH, pal)
    draw(ctx, cssW, cssH, pal, r)
    vignette(ctx, cssW, cssH, pal)
    grain(ctx, cssW, cssH, 0.05)
    canvas.dataset.painted = '1'
  }

  function paintAll(root) {
    root.querySelectorAll('canvas.scene').forEach(paint)
  }

  return { paint, paintAll, kindFor, PALETTE }
})()
