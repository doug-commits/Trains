/* Wiring: controls, map interaction, and keeping the panel and the map in sync.
 * The route is held in the URL hash so a plan can be sent to someone else.
 */

;(function () {
  const COUNTRY_NAME = {
    cn: 'China', la: 'Laos', th: 'Thailand', kh: 'Cambodia', vn: 'Vietnam',
    my: 'Malaysia', sg: 'Singapore', bn: 'Brunei', id: 'Indonesia', ph: 'Philippines', mm: 'Myanmar',
  }
  const COUNTRY_ORDER = ['cn', 'la', 'th', 'kh', 'vn', 'my', 'sg', 'bn', 'id', 'ph', 'mm']

  const PRESETS = [
    { label: 'The Spine', from: 'kunming', to: 'singapore', note: 'Kunming to Singapore — the only continuous rail corridor in the region' },
    { label: 'Bangkok → Singapore', from: 'bkk_aphiwat', to: 'singapore', note: 'The classic, and materially easier than every pre-2026 guide says' },
    { label: 'Laos → Malaysia', from: 'luangprabang', to: 'klsentral', note: 'The common ask. Pure spine, southbound' },
    { label: 'Singapore → Bali', from: 'singapore', to: 'denpasar', note: 'Land and sea the whole way. The flagship' },
    { label: 'Bangkok → Hanoi', from: 'bkk_aphiwat', to: 'hanoi', note: 'There is no rail answer. See what the honest one looks like' },
    { label: 'The Jungle Railway', from: 'klsentral', to: 'wakafbaharu', note: 'Slow, scenic, cult status — the journey as the point' },
    { label: 'The Mekong slow boat', from: 'chiangmai', to: 'luangprabang', note: 'Two days downriver into Laos, with a night at Pakbeng' },
    { label: 'Manila → Davao', from: 'manila', to: 'davao', note: 'The length of the Philippines without flying. Two nights at sea and a mountain bus' },
    { label: 'Manila → Boracay', from: 'manila', to: 'boracay', note: 'Everyone flies. You do not have to, and this is what the alternative costs' },
  ]

  /* Links out to Google Maps, rather than loading it.
   *
   * The built page fetches nothing at runtime, which is what lets it work at
   * Padang Besar with no signal and inside a strict-CSP artifact. Embedding a
   * map would cost all of that, plus a client-side API key and metered billing.
   * A link costs nothing and shows up at the two moments the real map actually
   * helps: where exactly is this place, and how do I cover the last mile the
   * railway does not.
   *
   * By name, not by coordinate. Every station here is stored to two decimal
   * places, which is ample for drawing a map of ten countries and hopeless for
   * dropping a pin: it is about a kilometre of slop, so the marker lands in a
   * field near the station and Google labels it nothing at all. A name Google
   * can geocode puts you on the actual place, with its actual card.
   *
   * The name alone is not enough — there are three Liloans on this map — so
   * every query carries its city and country. That is what makes it exact. */
  const placeQuery = (...parts) => {
    const seen = []
    for (const p of parts) if (p && !seen.includes(p)) seen.push(p)
    return encodeURIComponent(seen.join(', '))
  }

  /* "Maeklong" is a river, a district and a market before it is a platform, so
   * a rail station says that it is one — unless its name already does. Ferry
   * piers and bus stands keep their names as written; they are what Google has
   * them filed under. */
  const SAYS_WHAT_IT_IS = /station|junction|terminal|sentral|central|halt|pier|port|airport/i
  const stationQuery = s =>
    placeQuery(
      s.gauge && !SAYS_WHAT_IT_IS.test(s.name) ? `${s.name} railway station` : s.name,
      s.city,
      COUNTRY_NAME[s.country]
    )

  /* A sight is named in its own right, so it leads. Its railhead's town only
   * qualifies it when the two are the same place — where there is a gap the
   * railhead is somewhere else entirely, and "Angkor Wat, Sisophon" would send
   * Google looking two hours down the road from Angkor Wat. */
  const landmarkQuery = lm => {
    const st = NETWORK.stations[lm.station]
    return placeQuery(lm.name, !lm.last && st ? st.city : null, COUNTRY_NAME[lm.country])
  }

  const MAPS = {
    at: query => `https://www.google.com/maps/search/?api=1&query=${query}`,
    between: (from, to) =>
      `https://www.google.com/maps/dir/?api=1&origin=${from}` +
      `&destination=${to}&travelmode=driving`,
  }
  const mapsLink = (href, text) =>
    `<a class="tip-map" href="${UI.esc(href)}" target="_blank" rel="noopener noreferrer">${text}</a>`

  const $ = sel => document.querySelector(sel)
  const app = document.querySelector('.app')
  const canvas = $('#map')
  const panel = $('#panel')
  const tooltip = $('#tip')

  const map = MapView.create(canvas, NETWORK, BASEMAP, LANDMARKS, RAILS)
  // The only handle the page offers on the live view. Used by tools/smoke.mjs
  // to point the real pointer at a real place instead of sweeping the canvas.
  window.OverlandMap = map

  const state = {
    from: null,
    to: null,
    railOnly: false,
    date: '',
    nationality: '',
    pace: 'standard',
    stay: 'room',
    plan: null,
    // Set only when the question named places rather than stations, so the
    // answer can be headlined in the words that were actually used.
    labels: null,
  }

  /* Real numbers on the corridor cards, so the choice is informed before the
     click. One Dijkstra run per corridor over ~200 edges — cheap at boot. */
  function withStats(presets) {
    /* Several corridors end in the same place — three of these finish in
     * Singapore — so taking the art from the terminus put the identical
     * photograph on adjacent cards, which reads as a broken page rather than a
     * coincidence. Each card claims its picture, and a card whose first choice
     * is taken walks back down its own route until it finds one nobody else has
     * used. Photographs first, drawings as the fallback, both deduplicated. */
    const usedPhotos = new Set()
    const usedScenes = new Set()
    const havePhotos = typeof Photos !== 'undefined'

    return presets.map(p => {
      const routed = Router.route(NETWORK, p.from, p.to, {})
      if (!routed) return p
      const plan = Plan.build(NETWORK, routed, {})
      const t = plan.totals

      // Walk from the destination backwards: the terminus is the best answer,
      // and the places just short of it are the next best.
      const candidates = [...plan.stationIds].reverse()

      let photoId = null
      if (havePhotos) {
        for (const id of candidates) {
          const photo = Photos.forStation(id)
          if (photo && !usedPhotos.has(photo.id)) {
            photoId = photo.id
            usedPhotos.add(photo.id)
            break
          }
        }
      }

      let scene = Scene.kindFor(NETWORK, LANDMARKS, p.to)
      let seed = p.to
      if (!photoId && usedScenes.has(scene)) {
        const along = candidates
          .map(id => ({ id, kind: Scene.kindFor(NETWORK, LANDMARKS, id) }))
          .find(x => !usedScenes.has(x.kind))
        if (along) {
          scene = along.kind
          seed = along.id
        }
      }
      if (!photoId) usedScenes.add(scene)

      return {
        ...p,
        photoId,
        scene,
        sceneSeed: `${seed}-${p.from}`,
        stats: { days: t.days, legs: t.legs, borders: t.borders, usd: t.totalUsd },
      }
    })
  }
  const CORRIDORS = withStats(PRESETS)

  /* ------------------------------------------------------------- controls */

  function stationOptions(selectedId) {
    const byCountry = {}
    for (const [id, s] of Object.entries(NETWORK.stations)) {
      ;(byCountry[s.country] ??= []).push({ id, s })
    }
    return COUNTRY_ORDER.filter(c => byCountry[c])
      .map(c => {
        const opts = byCountry[c]
          .sort((a, b) => a.s.city.localeCompare(b.s.city) || a.s.name.localeCompare(b.s.name))
          .map(
            ({ id, s }) =>
              `<option value="${id}"${id === selectedId ? ' selected' : ''}>${UI.esc(
                s.city === s.name ? s.name : `${s.city} — ${s.name}`
              )}</option>`
          )
          .join('')
        return `<optgroup label="${UI.esc(COUNTRY_NAME[c])}">${opts}</optgroup>`
      })
      .join('')
  }

  const PACE_LABEL = { relaxed: 'Relaxed', standard: 'Standard', fast: 'Hard running' }
  const STAY_LABEL = { dorm: 'Hostel beds', room: 'Private rooms', comfort: 'Mid-range hotels' }

  function renderDetailSummary() {
    const bits = [state.railOnly ? 'Hard rail-only' : 'Pragmatic routing']
    if (state.pace !== 'standard') bits.push(PACE_LABEL[state.pace])
    if (state.stay !== 'room') bits.push(STAY_LABEL[state.stay])
    if (state.date) bits.push(state.date)
    if (state.nationality) bits.push(state.nationality)
    $('#detail-summary').textContent = bits.join(' · ')
  }

  function renderControls() {
    $('#from').innerHTML = `<option value="">Choose a station…</option>${stationOptions(state.from)}`
    $('#to').innerHTML = `<option value="">Choose a station…</option>${stationOptions(state.to)}`
    $('#railonly').checked = state.railOnly
    $('#date').value = state.date
    $('#nationality').value = state.nationality
    $('#pace').value = state.pace
    $('#stay').value = state.stay
    renderDetailSummary()
  }

  /* ----------------------------------------------------------------- plan */

  function compute() {
    if (!state.from || !state.to || state.from === state.to) {
      state.plan = null
      map.setRoute(null, false)
      app.dataset.active = 'false'
      panel.innerHTML = UI.idle(NETWORK, CORRIDORS)
      resetScroll(false)
      paintScenes()
      return
    }

    const opts = {
      railOnly: state.railOnly,
      date: state.date,
      nationality: state.nationality,
      pace: state.pace,
      stay: state.stay,
      labels: state.labels,
    }
    const routed = Router.route(NETWORK, state.from, state.to, opts)

    if (!routed) {
      state.plan = null
      map.setRoute(null, false)
      const reach = Router.reachable(NETWORK, state.from, opts)
      app.dataset.active = 'true'
      panel.innerHTML = UI.unreachable(NETWORK, state.from, state.to, reach, opts)
      resetScroll(true)
      paintScenes()
      return
    }

    const plan = Plan.build(NETWORK, routed, opts)
    state.plan = plan
    app.dataset.active = 'true'
    map.setRoute({ legs: plan.legs, stationIds: plan.stationIds, stopIds: plan.stopIds })
    panel.innerHTML = UI.itinerary(NETWORK, plan, state.from, state.to, opts)
    resetScroll(true)
    paintScenes()
    bindPanel()
    writeHash()
  }

  /* On wide screens the panel scrolls independently; stacked, the window does,
     and a new route rendered below the fold is a route nobody reads.
     But only once there is a route: doing this on the idle state scrolled the
     search box off the top of a phone before anyone had typed in it, which is
     the first thing you want to see and the last thing to hide. */
  function resetScroll(toResult) {
    panel.scrollTop = 0
    if (!toResult) {
      window.scrollTo({ top: 0 })
      return
    }
    if (!window.matchMedia('(min-width: 60.0625rem)').matches) {
      const wrap = document.querySelector('.mapwrap')
      if (wrap) window.scrollTo({ top: wrap.offsetTop, behavior: 'smooth' })
    }
  }

  function paintScenes() {
    Scene.paintAll(panel)
  }

  /* Photographs past the inline budget are linked rather than embedded, so on a
   * build with no assets beside it — the published single-file fragment — they
   * will not load. Put the drawn illustration back rather than leaving a broken
   * image frame. Capture phase, because `error` on an <img> does not bubble. */
  panel.addEventListener(
    'error',
    e => {
      const img = e.target
      if (!(img instanceof HTMLImageElement) || !img.dataset.fallback) return
      const canvas = document.createElement('canvas')
      canvas.className = 'scene'
      canvas.dataset.scene = img.dataset.fallback
      canvas.dataset.seed = img.dataset.seed || ''
      // The credit belongs to the photograph, not the drawing.
      img.parentNode.querySelector('.photo-credit')?.remove()
      img.replaceWith(canvas)
      Scene.paintAll(panel)
    },
    true
  )

  function bindPanel() {
    panel.querySelectorAll('tr.leg').forEach(row => {
      const i = Number(row.dataset.leg)
      const on = () => map.focusLeg(i)
      const off = () => map.focusLeg(null)
      row.addEventListener('mouseenter', on)
      row.addEventListener('focus', on)
      row.addEventListener('mouseleave', off)
      row.addEventListener('blur', off)
    })
  }

  /* ------------------------------------------------------------ url state */

  function writeHash() {
    const p = new URLSearchParams()
    p.set('from', state.from)
    p.set('to', state.to)
    if (state.railOnly) p.set('rail', '1')
    if (state.date) p.set('date', state.date)
    if (state.nationality) p.set('nat', state.nationality)
    if (state.pace !== 'standard') p.set('pace', state.pace)
    if (state.stay !== 'room') p.set('stay', state.stay)
    history.replaceState(null, '', '#' + p.toString())
  }

  function readHash() {
    const p = new URLSearchParams(location.hash.slice(1))
    const from = p.get('from')
    const to = p.get('to')
    if (from && NETWORK.stations[from]) state.from = from
    if (to && NETWORK.stations[to]) state.to = to
    state.railOnly = p.get('rail') === '1'
    state.date = p.get('date') || ''
    state.nationality = p.get('nat') || ''
    state.pace = p.get('pace') || 'standard'
    state.stay = p.get('stay') || 'room'
  }

  /* -------------------------------------------------------- map behaviour */

  let drag = null
  // Which station the popup is currently offering, so a hover inside the same
  // marker does not rebuild it on every pointer move and kill a click.
  let tipStation = null
  let tipReach = null
  let hideTimer = null

  // How far the pointer must travel before a press counts as a drag rather
  // than a click that wobbled. Also the click/drag cutoff on release.
  const PAN_THRESHOLD = 10

  // Touch pointers currently down. One finger is the page's — it scrolls past
  // the map. Two are the map's: they pan, and their separation pinches.
  const touches = new Map()
  let pinch = null

  const midpoint = () => {
    const pts = [...touches.values()]
    return { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 }
  }
  const spread = () => {
    const pts = [...touches.values()]
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1
  }

  canvas.addEventListener('pointerdown', e => {
    if (e.pointerType === 'touch') {
      touches.set(e.pointerId, { x: e.offsetX, y: e.offsetY })
      if (touches.size === 2) {
        // The second finger says "I mean the map" — no threshold needed.
        drag = { ...midpoint(), panning: true }
        pinch = spread()
        hideTip()
      }
      return
    }
    canvas.setPointerCapture(e.pointerId)
    drag = { x: e.offsetX, y: e.offsetY, originX: e.offsetX, originY: e.offsetY, panning: false }
  })

  canvas.addEventListener('pointermove', e => {
    if (e.pointerType === 'touch' && touches.has(e.pointerId)) {
      touches.set(e.pointerId, { x: e.offsetX, y: e.offsetY })
      if (touches.size < 2 || !drag) return
      // Two fingers down means the browser has already yielded the gesture,
      // so panning and pinching here costs the page nothing.
      e.preventDefault()
      const mid = midpoint()
      map.panBy(mid.x - drag.x, mid.y - drag.y)
      drag.x = mid.x
      drag.y = mid.y
      const now = spread()
      if (pinch) map.zoomAt(mid.x, mid.y, now / pinch)
      pinch = now
      hideTip()
      return
    }

    if (drag) {
      const dx = e.offsetX - drag.x
      const dy = e.offsetY - drag.y
      drag.x = e.offsetX
      drag.y = e.offsetY

      /* A click is a press with a bit of hand-shake in it. Panning from the
       * first pixel means every station you pick nudges the map somewhere new,
       * and it drifts all session. So the map holds still until the pointer is
       * unmistakably somewhere else — and then panning starts from there, so
       * nothing jumps to catch up.
       *
       * Distance from where the press landed, not distance travelled: a slow
       * tremor covers plenty of ground without ever going anywhere, and
       * measuring the path would call that a drag. */
      if (!drag.panning) {
        const off = Math.hypot(e.offsetX - drag.originX, e.offsetY - drag.originY)
        if (off < PAN_THRESHOLD) return
        drag.panning = true
        canvas.style.cursor = 'grabbing'
        hideTip()
        return
      }

      map.panBy(dx, dy)
      hideTip()
      return
    }

    const found = map.pick(e.offsetX, e.offsetY)
    canvas.style.cursor = found ? 'pointer' : 'grab'

    // Moving between the station and its own popup crosses ordinary map, so a
    // plain "no hit means hide" would snatch the buttons away as you reach for
    // them. While a station popup is open, the pointer is safe anywhere inside
    // the box that contains both it and the point it belongs to.
    if (!found) {
      if (!inTipReach(e.offsetX, e.offsetY)) hideTip()
      return
    }

    /* Inside the reach box the popup is the only thing that matters. Grazing
       another marker on the way to its buttons used to swap the popup out from
       under the pointer — you would set off for Bangkok's "start here" and
       click whatever the cursor happened to brush past. */
    if (tipReach && inTipReach(e.offsetX, e.offsetY)) return

    if (found.type === 'station') {
      if (tipStation !== found.id) showStationTip(e.offsetX, e.offsetY, found.id)
      map.focusLeg(null)
    } else if (found.type === 'landmark') {
      if (tipStation !== found.landmark.name) showLandmarkTip(e.offsetX, e.offsetY, found.landmark)
      map.focusLeg(null)
    } else {
      const leg = found.entry.leg
      showTip(
        e.offsetX,
        e.offsetY,
        `<b>${UI.esc(found.entry.fromName)} → ${UI.esc(found.entry.toName)}</b>
         <span>${UI.esc(leg.service)} · ${UI.esc(UI.hours(leg.hours))} · ${UI.esc(
          UI.money(leg.usd ?? 0)
        )}</span>`
      )
      map.focusLeg(found.index)
    }
  })

  /* ------------------------------------------------ the destination popup
   * Hovering a station offers the two things anyone actually wants from a
   * point on a map: start here, or end here. The click-to-cycle shortcut still
   * works, but it is guesswork — it silently decides which end you meant from
   * how many points you have picked. Buttons say it out loud, and they are the
   * only way to change one end of a route without clearing the other.
   */
  function showStationTip(x, y, id) {
    const s = NETWORK.stations[id]
    tipStation = id

    const isFrom = state.from === id
    const isTo = state.to === id
    const originName = state.from ? NETWORK.stations[state.from].city : null
    const targetName = state.to ? NETWORK.stations[state.to].city : null

    const act = (kind, label, on) =>
      `<button type="button" class="tip-go${on ? ' on' : ''}" data-act="${kind}" data-id="${UI.esc(
        id
      )}"${on ? ' aria-current="true"' : ''}>${label}</button>`

    const actions = [
      isFrom
        ? act('from', 'Starting here', true)
        : act('from', targetName ? `Start here → ${UI.esc(targetName)}` : 'Directions from here'),
      isTo
        ? act('to', 'Ending here', true)
        : act('to', originName ? `${UI.esc(originName)} → end here` : 'Directions to here'),
    ].join('')

    showTip(
      x,
      y,
      `<b>${UI.esc(s.name)}</b><span>${UI.esc(s.city)}, ${UI.esc(COUNTRY_NAME[s.country])}${
        s.gauge ? ` · ${UI.esc(s.gauge)} gauge` : ''
      }</span>${s.warn ? `<em>${UI.esc(s.warn)}</em>` : ''}` +
        `<span class="tip-acts">${actions}</span>` +
        `<span class="tip-links">${mapsLink(MAPS.at(stationQuery(s)), 'Show on Google Maps')}</span>`,
      true
    )
  }

  /* A sight rather than a station. Routing to it means routing to the railhead
   * that serves it, and the popup says which one and how far short it stops —
   * silently sending someone to Sisophon when they asked for Angkor is exactly
   * the trap this whole table exists to avoid. */
  function showLandmarkTip(x, y, lm) {
    tipStation = lm.name
    const st = NETWORK.stations[lm.station]
    const isFrom = state.from === lm.station
    const isTo = state.to === lm.station
    const originName = state.from ? NETWORK.stations[state.from].city : null
    const targetName = state.to ? NETWORK.stations[state.to].city : null

    const act = (kind, label, on) =>
      `<button type="button" class="tip-go${on ? ' on' : ''}" data-act="${kind}" data-id="${UI.esc(
        lm.station
      )}" data-label="${UI.esc(lm.name)}"${on ? ' aria-current="true"' : ''}>${label}</button>`

    showTip(
      x,
      y,
      `<b>${UI.esc(lm.name)}</b>` +
        `<span>${UI.esc(COUNTRY_NAME[lm.country])} · railhead ${UI.esc(st.name)}</span>` +
        (lm.last ? `<em class="gap">${UI.esc(lm.last)}</em>` : '') +
        `<span class="tip-acts">${
          [
            isFrom
              ? act('from', 'Starting here', true)
              : act('from', targetName ? `Start here → ${UI.esc(targetName)}` : 'Directions from here'),
            isTo
              ? act('to', 'Ending here', true)
              : act('to', originName ? `${UI.esc(originName)} → end here` : 'Directions to here'),
          ].join('')
        }</span>` +
        /* The gap is the whole reason this table exists, and until now it was
           only ever described. Now it is a route you can follow. */
        `<span class="tip-links">${mapsLink(MAPS.at(landmarkQuery(lm)), 'Show on Google Maps')}${
          lm.last
            ? mapsLink(
                MAPS.between(stationQuery(st), landmarkQuery(lm)),
                `Directions from ${UI.esc(st.city)}`
              )
            : ''
        }</span>`,
      true
    )
  }

  tooltip.addEventListener('pointerenter', cancelHide)
  tooltip.addEventListener('pointerleave', hideTip)

  tooltip.addEventListener('click', e => {
    const btn = e.target.closest('.tip-go')
    if (!btn) return
    const id = btn.dataset.id
    // A landmark answers in its own name, not the railhead's — the same rule
    // the plain-language box already follows.
    const named = btn.dataset.label || null
    if (btn.dataset.act === 'from') {
      // Choosing a start that is already the destination would ask for a route
      // from a place to itself; swap instead, which is what was meant.
      if (state.to === id) state.to = state.from
      state.from = id
    } else {
      if (state.from === id) state.from = state.to
      state.to = id
    }
    /* Keep whichever end the traveller named. Picking Angkor Wat and then a
       plain station should still headline "Angkor Wat", and picking a station
       over a landmark should drop the old name rather than keep claiming it. */
    const cityOf = id => (id ? NETWORK.stations[id].city : null)
    const labels = {
      from: state.labels?.from ?? cityOf(state.from),
      to: state.labels?.to ?? cityOf(state.to),
    }
    labels[btn.dataset.act] = named || cityOf(id)
    labels.from = labels.from ?? cityOf(state.from)
    labels.to = labels.to ?? cityOf(state.to)
    state.labels = labels.from && labels.to ? labels : null

    hideTip()
    renderControls()
    compute()
  })

  canvas.addEventListener('pointerup', e => {
    const wasPinch = e.pointerType === 'touch' && touches.size > 1
    if (e.pointerType === 'touch') {
      touches.delete(e.pointerId)
      if (touches.size < 2) pinch = null
    }
    // Only a press that actually panned suppresses the click.
    const wasDrag = drag && drag.panning
    drag = null
    canvas.style.cursor = 'grab'
    // Lifting one finger out of a two-finger gesture is not a tap.
    if (wasDrag || wasPinch) return

    const found = map.pick(e.offsetX, e.offsetY)
    if (!found || found.type !== 'station') return hideTip()

    /* A finger has no hover, so a tap gets the popup rather than the cycle —
       otherwise touch users are the only ones who never see the choice, and
       they are the ones for whom guessing wrong is most annoying to undo. */
    if (e.pointerType === 'touch') {
      showStationTip(e.offsetX, e.offsetY, found.id)
      return
    }

    // Mouse keeps the shortcut: first click sets the origin, second the
    // destination, then it cycles. The popup is the deliberate version.
    if (!state.from || (state.from && state.to)) {
      state.from = found.id
      state.to = null
    } else {
      state.to = found.id
    }
    hideTip()
    renderControls()
    compute()
  })

  canvas.addEventListener('pointerleave', e => {
    touches.delete(e.pointerId)
    if (touches.size < 2) pinch = null
    drag = null
    // Leaving the canvas for the popup is not leaving the map.
    if (!inTipReach(e.offsetX, e.offsetY)) hideTip()
  })

  canvas.addEventListener('pointercancel', e => {
    touches.delete(e.pointerId)
    if (touches.size < 2) pinch = null
    drag = null
  })

  /* The wheel zooms, with no modifier to hold.
   *
   * There is a fashion for making maps demand ctrl before they will zoom, to
   * stop them swallowing a page scroll. On this layout there is no page scroll
   * to swallow — the app fills the viewport and the document does not move — so
   * the modifier was pure friction guarding against nothing. */
  canvas.addEventListener(
    'wheel',
    e => {
      e.preventDefault()
      // A trackpad pinch arrives as many small deltas, a wheel as few large
      // ones. Scaling by the delta keeps both smooth instead of stepping.
      const step = Math.min(Math.abs(e.deltaY) / 100, 1) * 0.12
      map.zoomAt(e.offsetX, e.offsetY, e.deltaY < 0 ? 1 + step : 1 / (1 + step))
      hideTip()
    },
    { passive: false }
  )

  const zoomStep = factor => () => {
    map.zoomAt(canvas.clientWidth / 2, canvas.clientHeight / 2, factor)
    hideTip()
  }
  $('#zoomin').addEventListener('click', zoomStep(1.3))
  $('#zoomout').addEventListener('click', zoomStep(1 / 1.3))

  function showTip(x, y, html, interactive = false) {
    cancelHide()
    tooltip.innerHTML = html
    tooltip.hidden = false
    tooltip.classList.toggle('live', interactive)
    if (!interactive) tipStation = null
    const rect = canvas.getBoundingClientRect()
    const tw = tooltip.offsetWidth
    const th = tooltip.offsetHeight
    const left = Math.min(Math.max(8, x + 14), rect.width - tw - 8)
    const top = Math.max(8, y - th - 14)
    tooltip.style.left = `${left}px`
    tooltip.style.top = `${top}px`
    // The box the pointer may wander in without dismissing the popup: the
    // popup itself, the point it belongs to, and the gap between them.
    tipReach = interactive
      ? {
          x0: Math.min(left, x) - 12,
          y0: Math.min(top, y) - 12,
          x1: Math.max(left + tw, x) + 12,
          y1: Math.max(top + th, y) + 12,
        }
      : null
  }

  function inTipReach(x, y) {
    return (
      tipReach && x >= tipReach.x0 && x <= tipReach.x1 && y >= tipReach.y0 && y <= tipReach.y1
    )
  }

  function cancelHide() {
    if (hideTimer) clearTimeout(hideTimer)
    hideTimer = null
  }

  function hideTip() {
    cancelHide()
    tooltip.hidden = true
    tooltip.classList.remove('live')
    tipStation = null
    tipReach = null
  }

  /* ------------------------------------------------------------- listeners */

  $('#from').addEventListener('change', e => {
    state.labels = null
    state.from = e.target.value || null
    compute()
  })
  $('#to').addEventListener('change', e => {
    state.labels = null
    state.to = e.target.value || null
    compute()
  })
  $('#swap').addEventListener('click', () => {
    if (state.labels) state.labels = { from: state.labels.to, to: state.labels.from }
    ;[state.from, state.to] = [state.to, state.from]
    renderControls()
    compute()
  })
  $('#railonly').addEventListener('change', e => {
    renderDetailSummary()
    state.railOnly = e.target.checked
    compute()
  })
  $('#date').addEventListener('change', e => {
    renderDetailSummary()
    state.date = e.target.value
    compute()
  })
  $('#nationality').addEventListener('input', e => {
    state.nationality = e.target.value
    renderDetailSummary()
    if (state.plan) compute()
  })
  $('#pace').addEventListener('change', e => {
    state.pace = e.target.value
    renderDetailSummary()
    compute()
  })
  $('#stay').addEventListener('change', e => {
    state.stay = e.target.value
    renderDetailSummary()
    compute()
  })
  const ASK_INDEX = Ask.build(NETWORK, LANDMARKS, COUNTRY_HUB)

  function showAskNote(html, tone) {
    const el = $('#asknote')
    el.className = 'ask-note' + (tone ? ' ' + tone : '')
    el.innerHTML = html
    el.hidden = !html
  }

  function runAsk() {
    const text = $('#askbox').value.trim()
    if (!text) return showAskNote('')

    const result = Ask.ask(NETWORK, ASK_INDEX, text)
    if (!result.ok) {
      /* Buttons rather than bold text. "Pick the one you meant" is an
         instruction, and making the reader retype the answer to a question the
         planner just asked them is a poor way to ask it. */
      const hint = result.suggestions && result.suggestions.length
        ? ` ${result.suggestions
            .slice(0, 4)
            .map(s => `<button type="button" class="ask-sug" data-sug="${UI.esc(s)}">${UI.esc(s)}</button>`)
            .join('')}`
        : ''
      return showAskNote(UI.esc(result.reason) + hint, 'warn')
    }

    state.from = result.from.stationId
    state.to = result.to.stationId
    state.labels = { from: result.from.label, to: result.to.label }
    renderControls()
    compute()

    // Say what it decided, including any gap it cannot cover by rail.
    const line = side => {
      const parts = Ask.explain(NETWORK, side)
        .map((b, i) => (i === 0 ? `<b>${UI.esc(b)}</b>` : `<span>${UI.esc(b)}</span>`))
        .join(' — ')
      // Where the answer is a sight with a road gap, offer the drive as well as
      // describing it.
      const lm = side.landmark
      const st = lm && NETWORK.stations[lm.station]
      return lm && lm.last && st
        ? `${parts} ${mapsLink(MAPS.between(stationQuery(st), landmarkQuery(lm)), 'Directions')}`
        : parts
    }
    showAskNote(`${line(result.from)}<br>${line(result.to)}`, 'ok')
  }

  /* Clicking a suggestion substitutes it for whichever half the planner could
     not read, and re-asks — so the correction takes one click, not a retype. */
  $('#asknote').addEventListener('click', e => {
    const btn = e.target.closest('.ask-sug')
    if (!btn) return
    const pick = btn.dataset.sug
    const box = $('#askbox')
    const pair = Ask.split(box.value)
    if (pair) {
      const [a, b] = pair
      const bad = Ask.ask(NETWORK, ASK_INDEX, box.value)
      // Replace the end that failed; if both did, replace the first.
      const replaceTo = bad.ok ? false : Ask.match(ASK_INDEX, a)?.confident === true
      box.value = replaceTo ? `${a} to ${pick}` : `${pick} to ${b}`
    } else {
      box.value = pick
    }
    runAsk()
  })

  $('#askgo').addEventListener('click', runAsk)
  $('#askbox').addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault()
      runAsk()
    }
  })

  $('#reset').addEventListener('click', () => map.resetView())

  /* Back to a blank slate: clear the pair, drop the shared URL, refit the map. */
  function goHome() {
    state.from = null
    state.to = null
    state.plan = null
    state.labels = null
    $('#askbox').value = ''
    showAskNote('')
    history.replaceState(null, '', location.pathname + location.search)
    renderControls()
    compute()
    map.resetView()
  }
  $('#home').addEventListener('click', goHome)
  $('#startover').addEventListener('click', goHome)

  panel.addEventListener('click', e => {
    const chip = e.target.closest('[data-preset]')
    if (!chip) return
    const p = PRESETS[Number(chip.dataset.preset)]
    state.from = p.from
    state.to = p.to
    state.labels = null
    renderControls()
    compute()
  })

  /* ---------------------------------------------------------------- theme
   * Three states rather than two. A plain light/dark switch is simpler, but it
   * throws away the ability to follow the machine — and the stylesheet already
   * honours prefers-color-scheme, so discarding that would be giving something
   * up for nothing. The button cycles auto → light → dark → auto, and says
   * which it is on.
   */
  const THEME_KEY = 'overlandsea:theme'
  const THEME_ORDER = ['auto', 'light', 'dark']
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)')

  const THEME_TEXT = {
    auto: 'Theme: matching your system. Switch to light.',
    light: 'Theme: light. Switch to dark.',
    dark: 'Theme: dark. Follow your system instead.',
  }

  function readTheme() {
    try {
      const stored = localStorage.getItem(THEME_KEY)
      return THEME_ORDER.includes(stored) ? stored : 'auto'
    } catch {
      // Private browsing, or storage blocked. Following the system is a fine
      // answer and not worth an error over.
      return 'auto'
    }
  }

  function applyTheme(mode) {
    const root = document.documentElement
    if (mode === 'auto') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', mode)

    const btn = $('#theme')
    btn.dataset.mode = mode
    btn.title = THEME_TEXT[mode]
    // The visible label is an icon, so the accessible name has to carry both
    // the current state and what pressing it will do.
    btn.setAttribute('aria-label', THEME_TEXT[mode])
    $('#theme-label').textContent = THEME_TEXT[mode]
    try {
      if (mode === 'auto') localStorage.removeItem(THEME_KEY)
      else localStorage.setItem(THEME_KEY, mode)
    } catch {
      /* nothing to persist to; the choice still holds for this visit */
    }
  }

  let themeMode = readTheme()
  applyTheme(themeMode)

  $('#theme').addEventListener('click', () => {
    themeMode = THEME_ORDER[(THEME_ORDER.indexOf(themeMode) + 1) % THEME_ORDER.length]
    applyTheme(themeMode)
  })

  /* The map is drawn on a canvas, so it does not inherit a palette the way the
     document does — it has to be told to repaint. */
  const redraw = () => map.redraw()
  new MutationObserver(redraw).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme', 'class', 'style'],
  })
  systemDark.addEventListener('change', redraw)

  function updateInset() {
    // Below the breakpoint the panes stack, so nothing overlays the map.
    if (!window.matchMedia('(min-width: 60.0625rem)').matches) {
      return map.setInset({ left: 0, right: 0 })
    }
    const controls = document.querySelector('.controls').getBoundingClientRect()
    map.setInset({
      // The controls only cover the top corner, so reserving their full width
      // would waste half the map. Half of it keeps endpoints clear.
      left: controls.width * 0.5,
      right: panel.getBoundingClientRect().width,
    })
  }

  let resizeTimer = null
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer)
    resizeTimer = setTimeout(() => {
      updateInset()
      map.resize()
      paintScenes() // canvases are sized in device pixels, so they redraw on resize
    }, 120)
  })

  /* ------------------------------------------------------------------ boot */

  readHash()
  renderControls()
  // Fonts are inlined, but the canvas measures text — wait for them so labels
  // are laid out against the real face rather than the fallback metrics.
  const start = () => {
    updateInset()
    map.resize()
    compute()
  }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(start)
  else start()
})()
