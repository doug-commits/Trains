/* Web Mercator projection with a fitted, pannable, zoomable viewport.
 *
 * Mercator rather than equirectangular because the region spans 40 degrees of
 * latitude and the equirectangular squash makes Java look wrong next to Yunnan.
 */

const Proj = (() => {
  const DEG = Math.PI / 180

  /* Mercator y, expressed in the same degree units as longitude so a single
   * scale factor applies to both axes. Leaving y in radians while x is in
   * degrees squashes the map by a factor of 57. */
  function mercY(lat) {
    const clamped = Math.max(-85, Math.min(85, lat))
    return Math.log(Math.tan(Math.PI / 4 + (clamped * DEG) / 2)) / DEG
  }

  /* Mercator y grows northward; screen y grows downward. Negating once here
   * keeps scale positive everywhere else — the alternative is a negative scale
   * that silently mirrors the whole map. */
  const screenY = lat => -mercY(lat)
  const invScreenY = y => (2 * Math.atan(Math.exp(-y * DEG)) - Math.PI / 2) / DEG

  /** A view maps lon/lat to CSS pixels within a w x h box. */
  function create(bbox, w, h, padding = 0) {
    const x0 = bbox.west
    const x1 = bbox.east
    const y0 = screenY(bbox.north) // top
    const y1 = screenY(bbox.south) // bottom, and greater than y0

    const iw = Math.max(1, w - padding * 2)
    const ih = Math.max(1, h - padding * 2)
    const scale = Math.min(iw / (x1 - x0), ih / (y1 - y0))

    return {
      w,
      h,
      scale,
      // Centre the fitted content in the box.
      dx: padding + (iw - (x1 - x0) * scale) / 2 - x0 * scale,
      dy: padding + (ih - (y1 - y0) * scale) / 2 - y0 * scale,
      baseScale: scale,
    }
  }

  function project(view, lon, lat) {
    return {
      x: lon * view.scale + view.dx,
      y: screenY(lat) * view.scale + view.dy,
    }
  }

  function unproject(view, x, y) {
    return {
      lon: (x - view.dx) / view.scale,
      lat: invScreenY((y - view.dy) / view.scale),
    }
  }

  /* How far in you may go, in pixels per degree of longitude — a real-world
   * scale, not a multiple of how far out you started.
   *
   * A ceiling of "fourteen times the fitted view" sounds device-independent and
   * is the opposite: the fitted view is whatever squeezes the whole region into
   * the canvas, so a phone starts four times further out than a desktop and its
   * ceiling is four times weaker. It could reach 0.96 pixels per kilometre
   * against the desktop's 2.64, on the screen with the least room to spare —
   * you could never get close enough to read a border crossing.
   *
   * 320 is about where this data stops being able to answer: the coastline is
   * simplified to 0.01 degrees and the rail alignments to 0.006, so past here
   * the map would be drawing its own approximations at a size that invites them
   * to be read as detail. */
  const MAX_PX_PER_DEGREE = 320

  /** Zoom about a fixed screen point, so the pixel under the cursor stays put. */
  function zoomAt(view, x, y, factor, minZoom = 1, maxZoom = MAX_PX_PER_DEGREE) {
    const target = view.scale * factor
    const lo = view.baseScale * minZoom
    // Never below the fitted scale, however small the canvas is.
    const hi = Math.max(lo, maxZoom)
    const scale = Math.max(lo, Math.min(hi, target))
    const k = scale / view.scale
    return {
      ...view,
      scale,
      dx: x - (x - view.dx) * k,
      dy: y - (y - view.dy) * k,
    }
  }

  function pan(view, dx, dy) {
    return { ...view, dx: view.dx + dx, dy: view.dy + dy }
  }

  /* Keep the region on screen. Without this the map can be dragged into empty
   * ocean until nothing is left to navigate by, and the only way back is Reset
   * view. The rule: the projected bbox must always cover the middle of the
   * visible map, so there is never a drag that loses it.
   *
   * Visible, not the canvas. The canvas runs the full width of the stage with
   * the itinerary panel drawn on top of its right-hand end, so its middle is
   * not the middle of anything anyone can see — on a 1400px window the canvas
   * centre is 700 and the panel starts at 928, which puts the anchor two
   * thirds of the way across the strip the reader actually has.
   *
   * That is why the Philippines could not be reached. Dragging east moves the
   * region left until its eastern edge hits the anchor and stops; anchored at
   * the canvas centre, the stop came 236px short, and the last islands stayed
   * under the panel with no drag left to recover them. Every other placement
   * on this map already respects the inset — this one did not. */
  function clamp(view, bbox, inset = { left: 0, right: 0, top: 0, bottom: 0 }) {
    const left = bbox.west * view.scale + view.dx
    const right = bbox.east * view.scale + view.dx
    const top = screenY(bbox.north) * view.scale + view.dy
    const bottom = screenY(bbox.south) * view.scale + view.dy

    // The window the overlays leave, and its middle.
    const vx0 = inset.left
    const vx1 = Math.max(vx0 + 1, view.w - inset.right)
    const vy0 = inset.top
    const vy1 = Math.max(vy0 + 1, view.h - inset.bottom)
    const cx = (vx0 + vx1) / 2
    const cy = (vy0 + vy1) / 2

    // Once the region is smaller than that window it may sit anywhere inside
    // it; beyond that it must not be dragged clear of the centre.
    let dx = view.dx
    let dy = view.dy
    if (right - left <= vx1 - vx0) {
      if (left < vx0) dx += vx0 - left
      if (right > vx1) dx -= right - vx1
    } else {
      if (left > cx) dx -= left - cx
      if (right < cx) dx += cx - right
    }
    if (bottom - top <= vy1 - vy0) {
      if (top < vy0) dy += vy0 - top
      if (bottom > vy1) dy -= bottom - vy1
    } else {
      if (top > cy) dy -= top - cy
      if (bottom < cy) dy += cy - bottom
    }
    return dx === view.dx && dy === view.dy ? view : { ...view, dx, dy }
  }

  /** Fit a set of {lon,lat} points into the box, respecting a zoom ceiling. */
  function fitPoints(view, points, padding, maxZoom = 9) {
    if (!points.length) return view
    let west = Infinity
    let east = -Infinity
    let north = -Infinity
    let south = Infinity
    for (const p of points) {
      west = Math.min(west, p.lon)
      east = Math.max(east, p.lon)
      north = Math.max(north, p.lat)
      south = Math.min(south, p.lat)
    }
    // A single-point or near-degenerate extent would divide by ~zero.
    const padLon = Math.max(0.6, (east - west) * 0.08)
    const padLat = Math.max(0.6, (north - south) * 0.08)
    const box = {
      west: west - padLon,
      east: east + padLon,
      north: north + padLat,
      south: south - padLat,
    }
    const fitted = create(box, view.w, view.h, padding)
    const capped = Math.min(fitted.scale, view.baseScale * maxZoom)
    if (capped === fitted.scale) return { ...fitted, baseScale: view.baseScale }

    // Re-centre at the capped scale.
    const cx = (box.west + box.east) / 2
    const cy = (screenY(box.north) + screenY(box.south)) / 2
    return {
      ...view,
      scale: capped,
      dx: view.w / 2 - cx * capped,
      dy: view.h / 2 - cy * capped,
      baseScale: view.baseScale,
    }
  }

  /** Great-circle distance in km — used for the honest flight comparison. */
  function haversine(a, b) {
    const R = 6371
    const dLat = (b.lat - a.lat) * DEG
    const dLon = (b.lon - a.lon) * DEG
    const s =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.sin(dLon / 2) ** 2
    return 2 * R * Math.asin(Math.sqrt(s))
  }

  return { create, project, unproject, zoomAt, pan, clamp, fitPoints, haversine, screenY }
})()
