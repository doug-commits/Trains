/* Destination artwork, drawn rather than photographed.
 *
 * Photographs would be better, and they are not available: every image host is
 * unreachable from the build environment, stock libraries carry licences this
 * page cannot honour, and hotlinking would break the moment a third party moved
 * a file. So each destination gets an original illustration composed from the
 * landform that actually characterises it — karst towers for Hạ Long, a cone
 * for Bromo, stepped terraces for Borobudur.
 *
 * These are deliberately illustrations and not fake photographs. They commit to
 * one dusk palette so the set reads as a single hand, the way a guidebook's
 * plates do, and they sit on their own sky so they work on either theme.
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

  /* sky: [top, horizon]  far / mid / near: silhouette layers  water: reflection */
  const PALETTE = {
    karst:   { sky: ['#12313d', '#2f6f74'], far: '#22525a', mid: '#153c46', near: '#0d2830', water: '#2a6068' },
    volcano: { sky: ['#2a1c33', '#8a4a3c'], far: '#5a3040', mid: '#38202f', near: '#1d1220', water: null, ember: '#e8934a' },
    temple:  { sky: ['#243043', '#c08a4e'], far: '#6a5137', mid: '#3d3122', near: '#221b14', water: null },
    skyline: { sky: ['#141d33', '#4d5a86'], far: '#2b3557', mid: '#1b2340', near: '#101528', water: '#232c4a', lit: '#e9a63e' },
    coast:   { sky: ['#153744', '#6fa7a3'], far: '#2f6a6a', mid: '#1d4a50', near: '#123037', water: '#3d8189' },
    hills:   { sky: ['#1a3436', '#7f9a63'], far: '#3f6448', mid: '#2a4732', near: '#182a1f', water: null },
    forest:  { sky: ['#17362f', '#83b06d'], far: '#417049', mid: '#2a5636', near: '#173425', water: null },
    river:   { sky: ['#1b2d3d', '#8b8f74'], far: '#40584f', mid: '#2a3c39', near: '#18242a', water: '#456070' },
    paddy:   { sky: ['#1d3330', '#a7a860'], far: '#5c7146', mid: '#3b4f30', near: '#22301f', water: '#6d7f4a' },
  }

  const DEFAULT_BY_COUNTRY = {
    th: 'temple', la: 'karst', kh: 'temple', vn: 'karst',
    my: 'forest', sg: 'skyline', id: 'volcano', cn: 'karst', bn: 'coast', mm: 'hills',
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

  /* ------------------------------------------------------------- primitives */

  function sky(ctx, w, h, pal) {
    const g = ctx.createLinearGradient(0, 0, 0, h)
    g.addColorStop(0, pal.sky[0])
    g.addColorStop(1, pal.sky[1])
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
  }

  function sun(ctx, w, h, pal, r) {
    const x = w * (0.2 + r() * 0.6)
    const y = h * 0.62
    ctx.save()
    ctx.globalAlpha = 0.35
    ctx.fillStyle = '#ffe9c4'
    ctx.beginPath()
    ctx.arc(x, y, h * 0.13, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  /** A rolling ridgeline, drawn as a closed shape down to the base. */
  function ridge(ctx, w, h, baseY, amp, color, r, steps = 9) {
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.moveTo(0, h)
    ctx.lineTo(0, baseY)
    for (let i = 0; i <= steps; i++) {
      const x = (w * i) / steps
      const y = baseY - Math.sin((i / steps) * Math.PI * (1 + r())) * amp * (0.55 + r() * 0.6)
      ctx.lineTo(x, y)
    }
    ctx.lineTo(w, h)
    ctx.closePath()
    ctx.fill()
  }

  /* ------------------------------------------------------------ scene kinds */

  const DRAW = {
    karst(ctx, w, h, pal, r) {
      ridge(ctx, w, h, h * 0.56, h * 0.12, pal.far, r, 6)
      // Steep-sided limestone towers with rounded crowns.
      const n = 4 + Math.floor(r() * 3)
      for (let i = 0; i < n; i++) {
        const cx = w * ((i + 0.5) / n) + (r() - 0.5) * (w / n) * 0.7
        const tw = w * (0.05 + r() * 0.05)
        const th = h * (0.3 + r() * 0.34)
        const baseY = h * 0.8
        ctx.fillStyle = i % 2 ? pal.mid : pal.near
        ctx.beginPath()
        ctx.moveTo(cx - tw, baseY)
        ctx.quadraticCurveTo(cx - tw * 0.92, baseY - th * 0.72, cx - tw * 0.34, baseY - th)
        ctx.quadraticCurveTo(cx, baseY - th * 1.1, cx + tw * 0.4, baseY - th * 0.94)
        ctx.quadraticCurveTo(cx + tw * 0.95, baseY - th * 0.6, cx + tw, baseY)
        ctx.closePath()
        ctx.fill()
      }
      water(ctx, w, h, pal, 0.8)
    },

    volcano(ctx, w, h, pal, r) {
      ridge(ctx, w, h, h * 0.6, h * 0.09, pal.far, r, 7)
      const cx = w * (0.35 + r() * 0.3)
      const baseY = h * 0.86
      const peak = h * 0.14
      const halfW = w * 0.3
      ctx.fillStyle = pal.mid
      ctx.beginPath()
      ctx.moveTo(cx - halfW, baseY)
      ctx.lineTo(cx - w * 0.045, peak)
      ctx.lineTo(cx + w * 0.05, peak + h * 0.03)
      ctx.lineTo(cx + halfW, baseY)
      ctx.closePath()
      ctx.fill()
      // Plume, leaning with the wind.
      ctx.save()
      ctx.globalAlpha = 0.4
      ctx.fillStyle = pal.ember || '#e8934a'
      const lean = (r() - 0.5) * w * 0.18
      ctx.beginPath()
      ctx.ellipse(cx + lean, peak - h * 0.06, w * 0.09, h * 0.07, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
      ridge(ctx, w, h, h * 0.9, h * 0.05, pal.near, r, 5)
    },

    temple(ctx, w, h, pal, r) {
      ridge(ctx, w, h, h * 0.6, h * 0.08, pal.far, r, 6)
      // A stepped platform carrying spires.
      const cx = w * 0.5
      const baseY = h * 0.82
      const tiers = 4
      ctx.fillStyle = pal.mid
      for (let i = 0; i < tiers; i++) {
        const tw = w * (0.42 - i * 0.075)
        const ty = baseY - i * (h * 0.1)
        ctx.fillRect(cx - tw, ty - h * 0.1, tw * 2, h * 0.1)
      }
      ctx.fillStyle = pal.near
      const spires = [0, -1, 1]
      for (const s of spires) {
        const sx = cx + s * w * 0.13
        const sh = s === 0 ? h * 0.3 : h * 0.2
        const sy = baseY - tiers * (h * 0.1)
        ctx.beginPath()
        ctx.moveTo(sx - w * 0.028, sy)
        ctx.quadraticCurveTo(sx - w * 0.012, sy - sh * 0.7, sx, sy - sh)
        ctx.quadraticCurveTo(sx + w * 0.012, sy - sh * 0.7, sx + w * 0.028, sy)
        ctx.closePath()
        ctx.fill()
      }
      ctx.fillStyle = pal.near
      ctx.fillRect(0, baseY, w, h - baseY)
    },

    skyline(ctx, w, h, pal, r) {
      sun(ctx, w, h, pal, r)
      let x = 0
      const rows = [
        { color: pal.far, base: h * 0.84, max: h * 0.5 },
        { color: pal.mid, base: h * 0.9, max: h * 0.66 },
      ]
      for (const row of rows) {
        x = -w * 0.05
        while (x < w) {
          const bw = w * (0.04 + r() * 0.07)
          const bh = row.max * (0.35 + r() * 0.65)
          ctx.fillStyle = row.color
          ctx.fillRect(x, row.base - bh, bw, bh)
          // The occasional lit window, which is what makes it read as a city.
          if (r() > 0.55) {
            ctx.fillStyle = pal.lit || '#e9a63e'
            ctx.globalAlpha = 0.5
            ctx.fillRect(x + bw * 0.3, row.base - bh + h * 0.06, bw * 0.16, h * 0.05)
            ctx.globalAlpha = 1
          }
          x += bw + w * 0.012
        }
      }
      water(ctx, w, h, pal, 0.9)
    },

    coast(ctx, w, h, pal, r) {
      sun(ctx, w, h, pal, r)
      ridge(ctx, w, h, h * 0.46, h * 0.18, pal.far, r, 5)
      // A headland running out from one side.
      const fromLeft = r() > 0.5
      ctx.fillStyle = pal.mid
      ctx.beginPath()
      ctx.moveTo(fromLeft ? 0 : w, h * 0.78)
      ctx.quadraticCurveTo(w * (fromLeft ? 0.3 : 0.7), h * 0.56, w * (fromLeft ? 0.52 : 0.48), h * 0.8)
      ctx.lineTo(fromLeft ? 0 : w, h * 0.8)
      ctx.closePath()
      ctx.fill()
      water(ctx, w, h, pal, 0.72)
    },

    hills(ctx, w, h, pal, r) {
      sun(ctx, w, h, pal, r)
      ridge(ctx, w, h, h * 0.44, h * 0.2, pal.far, r, 5)
      ridge(ctx, w, h, h * 0.62, h * 0.18, pal.mid, r, 6)
      ridge(ctx, w, h, h * 0.82, h * 0.14, pal.near, r, 7)
    },

    forest(ctx, w, h, pal, r) {
      ridge(ctx, w, h, h * 0.48, h * 0.12, pal.far, r, 5)
      // Canopy: overlapping crowns rather than a ridgeline.
      for (const [color, base, size] of [[pal.mid, 0.62, 0.1], [pal.near, 0.8, 0.13]]) {
        let x = -w * 0.04
        while (x < w * 1.05) {
          const rad = w * size * (0.5 + r() * 0.7)
          ctx.fillStyle = color
          ctx.beginPath()
          ctx.arc(x, h * base - rad * 0.35, rad, Math.PI, 0)
          ctx.fill()
          ctx.fillRect(x - rad, h * base - rad * 0.35, rad * 2, h)
          x += rad * (0.7 + r() * 0.5)
        }
      }
    },

    river(ctx, w, h, pal, r) {
      ridge(ctx, w, h, h * 0.44, h * 0.13, pal.far, r, 6)
      // Two banks converging toward a vanishing point.
      const vpx = w * (0.4 + r() * 0.2)
      for (const side of [-1, 1]) {
        ctx.fillStyle = side < 0 ? pal.mid : pal.near
        ctx.beginPath()
        ctx.moveTo(side < 0 ? 0 : w, h * 0.72)
        ctx.quadraticCurveTo(vpx + side * w * 0.22, h * 0.7, vpx + side * w * 0.03, h * 0.62)
        ctx.lineTo(side < 0 ? 0 : w, h * 0.62)
        ctx.closePath()
        ctx.fill()
        ctx.beginPath()
        ctx.moveTo(side < 0 ? 0 : w, h)
        ctx.lineTo(side < 0 ? 0 : w, h * 0.72)
        ctx.quadraticCurveTo(vpx + side * w * 0.22, h * 0.74, vpx + side * w * 0.04, h * 0.63)
        ctx.lineTo(vpx, h)
        ctx.closePath()
        ctx.fill()
      }
      ctx.fillStyle = pal.water
      ctx.globalAlpha = 0.5
      ctx.beginPath()
      ctx.moveTo(vpx, h * 0.62)
      ctx.lineTo(w * 0.78, h)
      ctx.lineTo(w * 0.22, h)
      ctx.closePath()
      ctx.fill()
      ctx.globalAlpha = 1
    },

    paddy(ctx, w, h, pal, r) {
      ridge(ctx, w, h, h * 0.5, h * 0.13, pal.far, r, 5)
      // Terraces: stacked arcs stepping down the slope.
      const bands = 6
      for (let i = 0; i < bands; i++) {
        const y = h * (0.4 + (i / bands) * 0.56)
        const bow = w * (0.3 + r() * 0.4)
        ctx.fillStyle = i % 2 ? pal.mid : pal.near
        ctx.beginPath()
        ctx.moveTo(0, y + h * 0.07)
        ctx.quadraticCurveTo(bow, y - h * 0.06, w, y + h * 0.06)
        ctx.lineTo(w, y + h * 0.2)
        ctx.quadraticCurveTo(w * 0.5, y + h * 0.09, 0, y + h * 0.21)
        ctx.closePath()
        ctx.fill()
        // A lit lip on each riser: standing water catching the last of the sky.
        ctx.save()
        ctx.globalAlpha = 0.5
        ctx.strokeStyle = pal.water
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.moveTo(0, y + h * 0.07)
        ctx.quadraticCurveTo(bow, y - h * 0.06, w, y + h * 0.06)
        ctx.stroke()
        ctx.restore()
      }
    },
  }

  function water(ctx, w, h, pal, from) {
    if (!pal.water) return
    ctx.save()
    ctx.fillStyle = pal.water
    ctx.fillRect(0, h * from, w, h * (1 - from))
    ctx.globalAlpha = 0.25
    ctx.fillStyle = '#ffffff'
    for (let i = 0; i < 5; i++) {
      const y = h * from + (h * (1 - from) * (i + 0.5)) / 5
      ctx.fillRect(w * (0.08 + i * 0.14), y, w * (0.1 + i * 0.03), 1)
    }
    ctx.restore()
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
    sky(ctx, cssW, cssH, pal)
    draw(ctx, cssW, cssH, pal, r)
    canvas.dataset.painted = '1'
  }

  function paintAll(root) {
    root.querySelectorAll('canvas.scene').forEach(paint)
  }

  return { paint, paintAll, kindFor, PALETTE }
})()
