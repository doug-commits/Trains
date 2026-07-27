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

  /** Zoom about a fixed screen point, so the pixel under the cursor stays put. */
  function zoomAt(view, x, y, factor, minZoom = 1, maxZoom = 14) {
    const target = view.scale * factor
    const lo = view.baseScale * minZoom
    const hi = view.baseScale * maxZoom
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
   * canvas, so there is never a drag that loses the map. */
  function clamp(view, bbox) {
    const left = bbox.west * view.scale + view.dx
    const right = bbox.east * view.scale + view.dx
    const top = screenY(bbox.north) * view.scale + view.dy
    const bottom = screenY(bbox.south) * view.scale + view.dy

    // Once the region is smaller than the canvas it may sit anywhere inside it;
    // beyond that it must not be dragged clear of the centre.
    const cx = view.w / 2
    const cy = view.h / 2
    let dx = view.dx
    let dy = view.dy
    if (right - left <= view.w) {
      if (left < 0) dx += -left
      if (right > view.w) dx -= right - view.w
    } else {
      if (left > cx) dx -= left - cx
      if (right < cx) dx += cx - right
    }
    if (bottom - top <= view.h) {
      if (top < 0) dy += -top
      if (bottom > view.h) dy -= bottom - view.h
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
