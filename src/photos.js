/* Real photographs, where we have them.
 *
 * `PHOTOS` is emitted by tools/build.mjs from data/photos.json — it is empty
 * unless tools/fetch-photos.mjs has been run. Everything here degrades to the
 * drawn illustration in src/scene.js when a destination has no photograph, so
 * the page looks finished either way and a half-populated photo set is not a
 * broken build.
 *
 * Attribution is not decorative. These images are used under CC licences that
 * require the author, the licence, and a route back to the source, so the
 * credit travels with the image and a full list is rendered in the itinerary.
 */

const Photos = (() => {
  const have = typeof PHOTOS !== 'undefined' && PHOTOS ? PHOTOS : {}

  const byStation = (() => {
    const map = {}
    for (const [id, entry] of Object.entries(have)) {
      // First photo wins when several landmarks share a railhead.
      if (!map[entry.station]) map[entry.station] = { id, ...entry }
    }
    return map
  })()

  const esc = s =>
    String(s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    )

  function forStation(stationId) {
    return byStation[stationId] || null
  }

  /** A specific photograph by manifest id, for callers that pick their own. */
  function forId(id) {
    return have[id] ? { id, ...have[id] } : null
  }

  function count() {
    return Object.keys(have).length
  }

  /** The image itself, plus the credit the licence obliges us to show.
   *
   * Photographs past the inline budget carry `href` instead of `src` — a path
   * to a file beside the page rather than the bytes. That resolves on the
   * deployed site and off disk, and not in the single-file published fragment,
   * so a linked image also carries the illustration that should replace it if
   * it fails to load. src/app.js does the swap. */
  function figure(entry, alt, fallback) {
    if (!entry) return ''
    const linked = !entry.src && entry.href
    const swap =
      linked && fallback
        ? ` data-fallback="${esc(fallback.kind)}" data-seed="${esc(fallback.seed)}"`
        : ''
    return (
      `<img class="photo" src="${esc(entry.src || entry.href)}" alt="${esc(
        alt || entry.landmark
      )}" loading="lazy" decoding="async"${swap}>` +
      `<span class="photo-credit">${esc(entry.credit)}` +
      (entry.licence ? ` · ${esc(entry.licence)}` : '') +
      `</span>`
    )
  }

  /** Every photograph used on this route, for the attribution block. */
  function creditsFor(stationIds) {
    const seen = new Set()
    const out = []
    for (const id of stationIds) {
      const p = forStation(id)
      if (!p || seen.has(p.id)) continue
      seen.add(p.id)
      out.push(p)
    }
    return out
  }

  function creditBlock(stationIds) {
    const used = creditsFor(stationIds)
    if (!used.length) return ''
    const items = used
      .map(p => {
        const licence = p.licenceUrl
          ? `<a href="${esc(p.licenceUrl)}" target="_blank" rel="noopener noreferrer">${esc(p.licence)}</a>`
          : esc(p.licence)
        const source = p.source
          ? `<a href="${esc(p.source)}" target="_blank" rel="noopener noreferrer">Wikimedia Commons</a>`
          : 'Wikimedia Commons'
        return `<li><b>${esc(p.landmark)}</b> — ${esc(p.credit)}, ${licence}, via ${source}</li>`
      })
      .join('')
    return `<div class="credits"><h3>Photography</h3><ul>${items}</ul></div>`
  }

  return { forStation, forId, figure, creditBlock, creditsFor, count }
})()
