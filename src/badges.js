/* Station signs, shared by both maps.
 *
 * A station is drawn as a small transit sign: a rounded square in its mode's
 * colour with a train, a boat or a bus on it — the shape every map app has
 * taught people to read as "you can board here". The Google map draws these
 * as SVG inside page elements; the canvas map, which is what the apps ship,
 * stamps them from pre-rendered sprites. Both read the pictograms and the
 * sizing rules from here, so the website and the apps cannot draw two
 * different maps.
 */

const Badges = (() => {
  // Rounded rectangle and circle as path data, so one description serves
  // both SVG and Path2D.
  const rr = (x, y, w, h, r) =>
    `M${x + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}a${r} ${r} 0 0 1 ${-r} ${r}` +
    `h${-(w - 2 * r)}a${r} ${r} 0 0 1 ${-r} ${-r}v${-(h - 2 * r)}a${r} ${r} 0 0 1 ${r} ${-r}z`
  const circ = (cx, cy, r) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0z`

  /* Pictograms on a 24 grid. `ink` parts are the drawing; `bg` parts are cut
     in the badge's own colour so windows read as glass rather than as more
     shape; `line` parts are stroked in ink. */
  const ICONS = {
    rail: [
      ['ink', rr(5, 2.5, 14, 15, 3.5)],
      ['bg', rr(7.3, 5.3, 9.4, 5, 1.2)],
      ['bg', circ(8.6, 14, 1.25)],
      ['bg', circ(15.4, 14, 1.25)],
      ['line', 'M8.5 18 6.2 21.5M15.5 18l2.3 3.5', 1.9],
    ],
    ferry: [
      ['ink', 'M8 5.5h6.5l1.5 4.5H8z'],
      ['ink', 'M2.8 11.2h18.4l-2.6 5.6a2 2 0 0 1-1.8 1.2H7.2a2 2 0 0 1-1.8-1.2z'],
      ['line', 'M3 21c1.5 0 1.5-1 3-1s1.5 1 3 1 1.5-1 3-1 1.5 1 3 1 1.5-1 3-1 1.5 1 3 1', 1.5],
    ],
    road: [
      ['ink', rr(4.5, 3, 15, 15.5, 2.8)],
      ['bg', rr(6.6, 5.8, 10.8, 5.4, 1)],
      ['bg', circ(8.3, 14.8, 1.2)],
      ['bg', circ(15.7, 14.8, 1.2)],
      ['ink', rr(6.2, 18, 2.6, 3, 0.8)],
      ['ink', rr(15.2, 18, 2.6, 3, 0.8)],
    ],
  }

  /* What a station is, so its sign can say it: a railway station has a
     gauge; a stop with none is a pier if a boat leaves from it and a road
     stop otherwise — a border town, a bus station, the end of a transfer. */
  function kinds(network) {
    const kind = {}
    for (const [id, st] of Object.entries(network.stations)) kind[id] = st.gauge ? 'rail' : 'road'
    for (const leg of network.legs) {
      if (leg.mode !== 'ferry') continue
      for (const id of [leg.from, leg.to]) if (kind[id] === 'road') kind[id] = 'ferry'
    }
    return kind
  }

  const tierOf = st => (st.hub ? 'hub' : st.minor ? 'minor' : 'std')

  /* Sizes in CSS pixels, by how far out the map is and how much the station
     matters. At the whole-region view two hundred full signs are a carpet
     with Bangkok buried under it, so out there only the fourteen hubs keep a
     pictogram, ordinary stations are dots and the minor ones wait for the
     reader to come closer. A route's ends are the largest thing on the map
     and its stops come next, at any zoom; the stations off it shrink to dots
     until the map is close enough for them not to compete. 0 is not drawn. */
  const SIZES = {
    region: { hub: 16, std: 7, minor: 0 },
    far: { hub: 20, std: 14, minor: 9 },
    mid: { hub: 22, std: 18, minor: 14 },
    near: { hub: 26, std: 22, minor: 18 },
  }
  function size(tier, role, band) {
    if (role === 'end') return 28
    if (role === 'stop') return 20
    if (role === 'dim') return band === 'near' ? SIZES.near.minor : band === 'region' ? (tier === 'minor' ? 0 : 6) : 8
    return SIZES[band][tier]
  }
  // A dot rather than a sign: too small for a pictogram to be anything but
  // a smudge.
  const plain = (tier, role, band) =>
    role !== 'end' && role !== 'stop' && size(tier, role, band) < 12

  // Light sign colours (the dark theme's) take dark ink; dark ones white.
  function light(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim())
    if (!m) return false
    const n = parseInt(m[1], 16)
    return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) > 150
  }
  const inkFor = (bg, sea) => (light(bg) ? sea || '#0a191f' : '#ffffff')
  const ringFor = (land, sea) => (light(land) ? '#ffffff' : sea || '#0a191f')

  function svg(kind, ink, bg) {
    const parts = ICONS[kind] || ICONS.rail
    return (
      '<svg viewBox="0 0 24 24" aria-hidden="true">' +
      parts
        .map(([role, d, w]) =>
          role === 'line'
            ? `<path d="${d}" fill="none" stroke="${ink}" stroke-width="${w}" stroke-linecap="round"/>`
            : `<path d="${d}" fill="${role === 'bg' ? bg : ink}"/>`
        )
        .join('') +
      '</svg>'
    )
  }

  /* The canvas map's signs, rendered once per look and stamped with
     drawImage. Two hundred sets of paths, a shadow and a ring on every frame
     of a pan would be the slowest thing on the map; a sprite is one copy. */
  const sprites = new Map()
  function sprite({ kind, px, bg, ink, ring, ringW, round, scale }) {
    const key = [kind, px, bg, ink, ring, ringW, round, scale].join('|')
    let c = sprites.get(key)
    if (c) return c
    const pad = Math.ceil(ringW + 5)
    const box = px + pad * 2
    c = document.createElement('canvas')
    c.width = c.height = Math.ceil(box * scale)
    const g = c.getContext('2d')
    g.scale(scale, scale)
    const r = round ? px / 2 : px * 0.28
    const shape = new Path2D(rr(pad - ringW, pad - ringW, px + ringW * 2, px + ringW * 2, r + ringW))
    g.save()
    g.shadowColor = 'rgba(0,0,0,0.35)'
    g.shadowBlur = 3
    g.shadowOffsetY = 1
    g.fillStyle = ring
    g.fill(shape)
    g.restore()
    g.fillStyle = bg
    g.fill(new Path2D(rr(pad, pad, px, px, r)))
    if (!round) {
      const k = (px * 0.78) / 24
      g.translate(pad + px * 0.11, pad + px * 0.11)
      g.scale(k, k)
      for (const [role, d, w] of ICONS[kind] || ICONS.rail) {
        const p = new Path2D(d)
        if (role === 'line') {
          g.strokeStyle = ink
          g.lineWidth = w
          g.lineCap = 'round'
          g.stroke(p)
        } else {
          g.fillStyle = role === 'bg' ? bg : ink
          g.fill(p)
        }
      }
    }
    c.box = box
    if (sprites.size > 400) sprites.clear()
    sprites.set(key, c)
    return c
  }

  return { kinds, tierOf, size, plain, inkFor, ringFor, svg, sprite, light }
})()
