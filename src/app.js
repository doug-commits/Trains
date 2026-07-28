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

  /* The written-up routes get their headline numbers from the same router that
   * produced the page, so the link and the page it points at cannot disagree. */
  for (const g of GUIDES) {
    const routed = Router.route(NETWORK, g.from, g.to, {})
    if (!routed) continue
    const t = Plan.build(NETWORK, routed, {}).totals
    g.summary = `${t.legs} legs · ${t.days}d · ${UI.money(t.totalUsd)}`
  }

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
    // The search boxes show whatever the selects now hold, so a pick made on
    // the map or by a corridor card reads back in the fields too.
    syncCombos()
    foldSummary()
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
  /* A new answer starts at the top of itself. On a phone that is the sheet's
   * own scroller rather than the window, which no longer moves — and a result
   * arriving while the sheet is down is worth raising it for, because the
   * alternative is an answer delivered off the bottom of the screen. */
  function resetScroll(toResult) {
    panel.scrollTop = 0
    if (sheetScroll) sheetScroll.scrollTop = 0
    window.scrollTo({ top: 0 })
    if (toResult) revealResult()
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
        return
      }
      /* One finger gets to move the map. It still has to earn the pan, or
       * every station you tap shifts the map out from under the tap. */
      if (touches.size === 1) {
        drag = { x: e.offsetX, y: e.offsetY, originX: e.offsetX, originY: e.offsetY, panning: false }
      }
      return
    }
    canvas.setPointerCapture(e.pointerId)
    drag = { x: e.offsetX, y: e.offsetY, originX: e.offsetX, originY: e.offsetY, panning: false }
  })

  canvas.addEventListener('pointermove', e => {
    if (e.pointerType === 'touch' && touches.has(e.pointerId)) {
      touches.set(e.pointerId, { x: e.offsetX, y: e.offsetY })
      if (!drag) return
      /* One finger moves the map, in whichever direction it was moved.
       *
       * Nothing scrolls behind it to be protected any more: the map owns the
       * screen and the itinerary rides over it on the sheet, which does its own
       * scrolling. The map having to share its own vertical axis with a page
       * underneath was a symptom of the stacked layout, and it went with it. */
      if (touches.size < 2) {
        const dx1 = e.offsetX - drag.x
        const dy1 = e.offsetY - drag.y
        drag.x = e.offsetX
        drag.y = e.offsetY

        if (!drag.panning) {
          if (Math.hypot(e.offsetX - drag.originX, e.offsetY - drag.originY) < PAN_THRESHOLD) return
          drag.panning = true
          hideTip()
          return
        }

        e.preventDefault()
        map.panBy(dx1, dy1)
        hideTip()
        return
      }
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

  /* Double-tap zooms in on the spot, which is what a thumb reaches for before
   * it tries a pinch. Two taps close together in time and place — a second tap
   * somewhere else is two taps on two stations, not a gesture. */
  const DOUBLE_TAP_MS = 320
  const DOUBLE_TAP_PX = 36
  let lastTap = null

  canvas.addEventListener('pointerup', e => {
    const wasPinch = e.pointerType === 'touch' && touches.size > 1
    if (e.pointerType === 'touch') {
      touches.delete(e.pointerId)
      if (touches.size < 2) pinch = null
    }

    if (e.pointerType === 'touch' && !wasPinch && !(drag && drag.panning)) {
      const now = performance.now()
      if (
        lastTap &&
        now - lastTap.t < DOUBLE_TAP_MS &&
        Math.hypot(e.offsetX - lastTap.x, e.offsetY - lastTap.y) < DOUBLE_TAP_PX
      ) {
        lastTap = null
        drag = null
        hideTip()
        map.zoomAt(e.offsetX, e.offsetY, 2)
        return
      }
      lastTap = { t: now, x: e.offsetX, y: e.offsetY }
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

  /* ------------------------------------------------------------- combobox */

  /* A native select over two hundred stations means scrolling past nine
   * countries to reach Surabaya, and its own type-ahead only jumps to the
   * first letter of the option text — which here is the city, so "surabaya"
   * works and "gubeng" never will. This filters on everything: station name,
   * city, and country.
   *
   * The select is still the model. It holds the answer, the rest of the app
   * reads it, and this is only a nicer way to reach it. */

  /* Fold accents, so "Đà Nẵng" is reachable from a keyboard that has no Đ and
   * "Huế" from one with no ế. NFD splits a letter from its marks and the range
   * strips the marks — but it leaves đ alone, because a stroked d is its own
   * letter rather than a d wearing an accent. That one is spelled out. */
  const fold = s =>
    s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/đ/g, 'd')

  const CHOICES = Object.entries(NETWORK.stations).map(([id, s]) => ({
    id,
    city: s.city,
    name: s.name,
    country: s.country,
    where: COUNTRY_NAME[s.country],
    // Where a city has several stations, the one people mean comes first:
    // "sing" should offer HarbourFront before Woodlands CIQ, which is a
    // border post you pass through rather than a place you set out from.
    weight: s.hub ? 0 : s.minor ? 2 : 1,
    hay: fold(`${s.city} ${s.name} ${COUNTRY_NAME[s.country]}`),
  }))

  /* A cap for a search, not for the list.
   *
   * Typing narrows, so sixty ranked matches is far more than anyone reads. An
   * empty box is the opposite act — it is browsing, and the whole point of
   * grouping the stations under their countries is to be able to go and look
   * at Vietnam. Cutting that off at sixty stops the list halfway through the
   * third country, which is worse than not grouping it at all. */
  const MAX_ROWS = 60

  /* Ranked, so typing "sing" puts Singapore above Sungai Petani. A match at
   * the start of a word beats one buried mid-string, and the city beats the
   * station name — people think in cities. */
  function search(q) {
    /* Nothing typed: down the map rather than down the alphabet. The countries
     * come out in the order the railway runs — Kunming at the top, Java at the
     * bottom — which is the order someone planning this journey already has in
     * their head, and the order the groups are then rendered in. */
    if (!q) {
      return CHOICES.slice().sort(
        (a, b) =>
          COUNTRY_ORDER.indexOf(a.country) - COUNTRY_ORDER.indexOf(b.country) ||
          a.city.localeCompare(b.city) ||
          a.weight - b.weight ||
          a.name.localeCompare(b.name)
      )
    }
    const n = fold(q)
    const scored = []
    for (const c of CHOICES) {
      const at = c.hay.indexOf(n)
      if (at < 0) continue
      const wordStart = at === 0 || c.hay[at - 1] === ' ' || c.hay[at - 1] === '('
      const inCity = at < c.city.length
      scored.push({ c, rank: (at === 0 ? 0 : wordStart ? 1 : 2) + (inCity ? 0 : 0.5), at })
    }
    scored.sort(
      (a, b) =>
        a.rank - b.rank ||
        a.c.weight - b.c.weight ||
        a.c.city.localeCompare(b.c.city) ||
        a.c.name.localeCompare(b.c.name)
    )
    return scored.map(s => s.c)
  }

  /* Two hundred stations under eleven headings rather than in one column.
   *
   * Grouping without reordering: a Map keeps its keys in the order they were
   * first seen, so walking the ranked list and dropping each station into its
   * country's bucket leaves the countries ordered by their own best match, and
   * each country's stations in the order the ranking put them. The top hit is
   * still the first row of the first group — which is what Enter takes, and
   * what would quietly break if this sorted alphabetically by country. */
  function byCountry(list) {
    const groups = new Map()
    for (const c of list) {
      const g = groups.get(c.where)
      if (g) g.push(c)
      else groups.set(c.where, [c])
    }
    return [...groups].map(([country, items]) => ({ country, items }))
  }

  const mark = (text, q) => {
    if (!q) return UI.esc(text)
    const folded = fold(text)
    // Folding can shorten a string, and then an index into the folded copy
    // points at the wrong letters of the original. Where that happens, show
    // the row unmarked rather than emphasising the wrong half of a word.
    if (folded.length !== text.length) return UI.esc(text)
    const at = folded.indexOf(fold(q))
    if (at < 0) return UI.esc(text)
    return (
      UI.esc(text.slice(0, at)) +
      `<b>${UI.esc(text.slice(at, at + q.length))}</b>` +
      UI.esc(text.slice(at + q.length))
    )
  }

  function setupCombo(which) {
    const select = $(`#${which}`)
    const input = $(`#${which}-q`)
    const list = $(`#${which}-list`)
    let rows = []
    let active = -1
    let open = false

    const labelFor = id => {
      const s = NETWORK.stations[id]
      return s ? (s.city === s.name ? s.name : `${s.city} — ${s.name}`) : ''
    }

    function close() {
      open = false
      active = -1
      list.hidden = true
      list.style.top = ''
      list.style.bottom = ''
      list.style.maxHeight = ''
      input.setAttribute('aria-expanded', 'false')
      input.removeAttribute('aria-activedescendant')
    }

    /* Open into whichever side has room, and never past the edge of it.
     *
     * On a phone the soft keyboard takes half the screen the moment this field
     * is focused, and the list drops from an input that is now near the bottom
     * of what is left — so it went behind the keyboard and showed one row of
     * eight. The keyboard is not something the page is told about, but it is
     * the difference between the visual viewport and the layout, and on Android
     * it shrinks the window outright. Both are covered by measuring what is
     * actually there at the moment the list opens. */
    const GAP = 8
    function place() {
      const box = input.getBoundingClientRect()
      const vv = window.visualViewport
      const top = vv ? vv.offsetTop : 0
      const bottom = top + (vv ? vv.height : window.innerHeight)

      const below = bottom - box.bottom - GAP
      const above = box.top - top - GAP
      // Below unless it is genuinely cramped and above is better. Flipping for
      // a few pixels would make the list jump around as you type.
      const flip = below < 132 && above > below
      list.style.top = flip ? 'auto' : ''
      list.style.bottom = flip ? '100%' : ''
      const room = Math.max(96, Math.min(272, Math.floor(flip ? above : below)))
      list.style.maxHeight = room + 'px'
    }

    function paint(q) {
      const all = search(q)
      const found = q ? all.slice(0, MAX_ROWS) : all
      if (!found.length) {
        rows = []
        list.innerHTML = `<li class="combo-empty">Nothing matches “${UI.esc(q)}”</li>`
      } else {
        /* rows is the flat, ranked list the keyboard walks; the markup is the
         * same stations under their country. The two are kept in step by
         * rebuilding rows from the groups, so an index is an index either way. */
        rows = []
        const html = []
        for (const { country, items } of byCountry(found)) {
          html.push(
            `<li class="combo-group" role="presentation">${UI.esc(country)}</li>`
          )
          for (const c of items) {
            const i = rows.push(c) - 1
            html.push(
              `<li id="${which}-opt-${i}" role="option" aria-selected="${i === active}" data-i="${i}">` +
                `<span>${mark(c.city === c.name ? c.name : `${c.city} — ${c.name}`, q)}</span>` +
                `</li>`
            )
          }
        }
        list.innerHTML = html.join('')
      }
      open = true
      list.hidden = false
      input.setAttribute('aria-expanded', 'true')
      place()
    }

    function highlight(i) {
      const prev = list.querySelector('[aria-selected="true"]')
      if (prev) prev.setAttribute('aria-selected', 'false')
      active = i
      if (i < 0) return input.removeAttribute('aria-activedescendant')
      // By index, not by position: the country headings are children too.
      const el = list.querySelector(`[data-i="${i}"]`)
      if (!el) return
      el.setAttribute('aria-selected', 'true')
      el.scrollIntoView({ block: 'nearest' })
      input.setAttribute('aria-activedescendant', el.id)
    }

    function choose(i) {
      const c = rows[i]
      if (!c) return
      select.value = c.id
      select.dispatchEvent(new Event('change'))
      input.value = labelFor(c.id)
      close()
    }

    input.addEventListener('input', () => paint(input.value.trim()))
    input.addEventListener('focus', () => {
      input.select()
      paint('')
    })

    /* The keyboard arrives a beat after the focus that summons it, so the
     * measurement taken when the list opened describes a screen that no longer
     * exists. Measure again when the viewport actually changes. */
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', () => {
        if (open) place()
      })
    }
    window.addEventListener('resize', () => {
      if (open) place()
    })
    // The sheet the field rides on has just finished moving underneath it.
    window.addEventListener('sheetmoved', () => {
      if (open) place()
    })

    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        if (!open) return paint(input.value.trim())
        if (!rows.length) return
        const step = e.key === 'ArrowDown' ? 1 : -1
        highlight((active + step + rows.length) % rows.length)
        return
      }
      if (e.key === 'Enter') {
        if (!open || !rows.length) return
        e.preventDefault()
        // Enter with nothing highlighted takes the best match, which is what
        // typing three letters and pressing Enter is asking for.
        choose(active < 0 ? 0 : active)
        return
      }
      if (e.key === 'Escape' && open) {
        e.preventDefault()
        close()
        input.value = labelFor(select.value)
        return
      }
      if (e.key === 'Tab') close()
    })

    /* Keep the press from moving focus, then act on the click.
     *
     * The press is what blurs the input, and the blur is what closes the list —
     * so without this the row is gone before anything lands on it. Cancelling
     * the mousedown's default cancels the focus change and nothing else: the
     * click still follows, from a finger as well as a mouse.
     *
     * It has to be the click and not the pointerdown. The list scrolls, so a
     * touch is held back while the browser decides whether it is a scroll, and
     * a tap with a pixel of wobble in it is withdrawn as pointercancel with no
     * pointerdown ever delivered. Every tap on a phone has a pixel of wobble in
     * it. That is why this list worked under a mouse and was dead under a
     * thumb. */
    list.addEventListener('mousedown', e => {
      if (e.target.closest('li[data-i]')) e.preventDefault()
    })

    list.addEventListener('click', e => {
      const li = e.target.closest('li[data-i]')
      if (li) choose(Number(li.dataset.i))
    })

    input.addEventListener('blur', () => {
      // Leaving with half a word typed should not look like a choice.
      setTimeout(() => {
        if (!open) return
        close()
        input.value = labelFor(select.value)
      }, 0)
    })

    return { sync: () => { input.value = labelFor(select.value) } }
  }

  const COMBOS = { from: setupCombo('from'), to: setupCombo('to') }
  const syncCombos = () => {
    COMBOS.from.sync()
    COMBOS.to.sync()
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
    /* On a phone the map is the whole screen and the overlays are on top of
     * it: the bar along the top and the sheet coming up from the bottom. What
     * is left between them is where a route has to fit, or it is drawn behind
     * the itinerary describing it. */
    if (!window.matchMedia('(min-width: 60.0625rem)').matches) {
      const bar = document.querySelector('.topbar').getBoundingClientRect()
      const covered = Math.max(0, window.innerHeight - (sheetY ?? window.innerHeight))
      return map.setInset({
        left: 0,
        right: 0,
        top: bar.height,
        // Never more than half, so a sheet pulled to full does not squeeze the
        // fit into a sliver — at that point the reader is looking at the list.
        bottom: Math.min(covered, window.innerHeight * 0.5),
      })
    }
    const controls = document.querySelector('.controls').getBoundingClientRect()
    map.setInset({
      // The controls only cover the top corner, so reserving their full width
      // would waste half the map. Half of it keeps endpoints clear.
      left: controls.width * 0.5,
      right: panel.getBoundingClientRect().width,
    })
  }

  /* --------------------------------------------- describing a place by hand */

  /* Someone who half-remembers a place cannot spell their way to it — there is
   * no spelling of "umbrella market" close enough to "Maeklong" for a typo
   * matcher to bridge. This searches what the dataset says about each place
   * rather than what it is called, and shows the sentence that earned the hit
   * so the answer can be checked rather than trusted. */

  const describeBox = $('#describebox')
  const describeOut = $('#describe-out')

  // Emphasise the words the reader actually typed, so the evidence is scannable.
  function litWhy(text, matched) {
    const set = new Set(matched)
    return text
      .split(/(\b)/)
      .map(part =>
        set.has(Ask.norm(part)) ? `<b>${UI.esc(part)}</b>` : UI.esc(part)
      )
      .join('')
  }

  function runDescribe() {
    const q = describeBox.value.trim()
    if (q.length < 3) return (describeOut.innerHTML = '')

    const hits = Ask.describe(NETWORK, LANDMARKS, q, 6)
    if (!hits.length) {
      describeOut.innerHTML =
        `<li class="describe-none">Nothing here matches that. Try what happens ` +
        `at the place rather than what it looks like — a market, a crossing, a ` +
        `boat, a climb.</li>`
      return
    }

    describeOut.innerHTML = hits
      .map(h => {
        const st = NETWORK.stations[h.stationId]
        const where = st ? `${st.city}, ${COUNTRY_NAME[st.country]}` : ''
        return (
          `<li>` +
          `<span class="d-name">${UI.esc(h.label)}` +
          `<span class="d-kind">${h.kind === 'landmark' ? 'sight' : 'station'}</span></span>` +
          (h.why
            ? `<span class="d-why">${UI.esc(h.why.source)}: ${litWhy(h.why.text, h.matched)}</span>`
            : '') +
          `<span class="d-acts">` +
          `<button type="button" data-pick="from" data-station="${UI.esc(h.stationId)}" ` +
          `data-label="${UI.esc(h.label)}">Start here</button>` +
          `<button type="button" data-pick="to" data-station="${UI.esc(h.stationId)}" ` +
          `data-label="${UI.esc(h.label)}">End here</button>` +
          (where ? `<span class="d-kind">${UI.esc(where)}</span>` : '') +
          `</span></li>`
        )
      })
      .join('')
  }

  let describeTimer = null
  describeBox.addEventListener('input', () => {
    clearTimeout(describeTimer)
    describeTimer = setTimeout(runDescribe, 120)
  })

  describeOut.addEventListener('click', e => {
    const btn = e.target.closest('button[data-station]')
    if (!btn) return
    const side = btn.dataset.pick
    state[side] = btn.dataset.station
    // A sight and its railhead are not the same place, so the answer is
    // headlined in the words the reader used rather than the station's name.
    state.labels = null
    renderControls()
    compute()
  })

  /* ------------------------------------------------------------- folding */

  /* The panel covers northwest Thailand at the default view — Chiang Mai, Pai,
   * the Mae Hong Son loop — and there is no arrangement of a 24rem panel over
   * a map of ten countries that covers nothing. So it folds, and the choice
   * sticks, because someone who wants that corner wants it every visit. */
  const FOLD_KEY = 'overlandsea:folded'
  const controls = document.querySelector('.controls')
  const foldBtn = $('#fold')

  function applyFold(folded, remember = true) {
    controls.dataset.collapsed = String(folded)
    foldBtn.setAttribute('aria-expanded', String(!folded))
    $('#fold-label').textContent = folded ? 'Show the search panel' : 'Hide the search panel'
    foldBtn.title = folded ? 'Show the search panel' : 'Hide the search panel'
    if (remember) {
      try {
        localStorage.setItem(FOLD_KEY, folded ? '1' : '0')
      } catch (e) {
        /* private mode — the fold still works, it just will not be remembered */
      }
    }
    // The map fits itself around whatever the overlays leave, so it has to be
    // told the moment that changes.
    updateInset()
    map.resize()
  }

  /* What the folded bar says. Without it the panel collapses to a bare chevron
   * and the route you picked disappears from the controls entirely. */
  function foldSummary() {
    const label = id => {
      const s = NETWORK.stations[id]
      return s ? s.city : ''
    }
    const bit = $('.fold-what')
    bit.textContent =
      state.from && state.to ? `${label(state.from)} → ${label(state.to)}` : ''
  }

  foldBtn.addEventListener('click', () => {
    applyFold(controls.dataset.collapsed !== 'true')
  })

  /* --------------------------------------------------------- the sheet */

  /* On a phone the map is the page and the itinerary is a sheet over it.
   *
   * Three positions. Two is not enough: you either want a glance at the next
   * departure with the map still readable, or the whole itinerary, and a
   * single "open" has to be one or the other. Peek shows the search box, half
   * shows the first legs, full is the document.
   *
   * The transition is added on release and removed on grab, so a drag tracks
   * the finger exactly and only the snap glides. A transition left on during
   * the drag is what makes a sheet feel like it is being dragged through
   * treacle. */
  const sheet = $('#sheet')
  const sheetScroll = $('#sheet-scroll')
  const grip = $('#grip')
  const PEEK = 118 // enough for the grip and the first field

  const onPhone = () => !window.matchMedia('(min-width: 60.0625rem)').matches
  const snapPoints = () => {
    const h = window.innerHeight
    return { full: Math.round(h * 0.06), half: Math.round(h * 0.55), peek: h - PEEK }
  }
  const nearestSnap = (y, bias = 0) => {
    const pts = snapPoints()
    return Object.keys(pts).reduce((best, k) =>
      Math.abs(pts[k] - (y + bias)) < Math.abs(pts[best] - (y + bias)) ? k : best, 'half')
  }

  let snap = 'half'
  let sheetY = null

  function placeSheet(y, gliding) {
    sheetY = y
    sheet.dataset.gliding = gliding ? 'true' : 'false'
    sheet.style.setProperty('--sheet-y', `${y}px`)
  }

  function setSnap(next, glide = true) {
    snap = next
    sheet.dataset.snap = next
    placeSheet(snapPoints()[next], glide)
    // The map is fitted to the strip the sheet leaves, so moving the sheet
    // changes what "fit the route" means.
    updateInset()
    /* Anything measuring where it sits on screen has to measure again, and not
     * until the sheet has finished moving. The station list is the one that
     * matters: it opens downwards out of a field that is somewhere else by the
     * time the glide ends. */
    clearTimeout(movedTimer)
    movedTimer = setTimeout(
      () => window.dispatchEvent(new CustomEvent('sheetmoved')),
      glide ? 300 : 0
    )
  }
  let movedTimer = null

  /* Focusing a field raises the sheet.
   *
   * The keyboard takes half the screen, and a field sitting at 55% of it is
   * then underneath the keyboard along with anything it drops open. Every
   * phone map app does this; the alternative is typing blind. */
  sheet.addEventListener('focusin', e => {
    if (!onPhone()) return
    if (!e.target.matches('input, textarea, select')) return
    if (snap !== 'full') setSnap('full')
  })

  /* Dragging the grip moves the sheet. Dragging the contents scrolls them —
   * unless they are already at the top and the drag is downwards, which is the
   * gesture that closes a sheet everywhere else and would otherwise do
   * nothing here. */
  let sheetDrag = null

  const startSheetDrag = (e, fromContent) => {
    if (!onPhone()) return
    sheetDrag = { y: e.clientY, from: sheetY, at: performance.now(), moved: 0, fromContent }
    sheet.dataset.gliding = 'false'
  }

  grip.addEventListener('pointerdown', e => {
    startSheetDrag(e, false)
    grip.setPointerCapture(e.pointerId)
  })

  sheetScroll.addEventListener('pointerdown', e => {
    if (snap === 'full' && sheetScroll.scrollTop > 0) return
    startSheetDrag(e, true)
  })

  const moveSheet = e => {
    if (!sheetDrag) return
    const dy = e.clientY - sheetDrag.y
    sheetDrag.moved = Math.max(sheetDrag.moved, Math.abs(dy))

    /* A drag that began on the contents only takes over once it is clearly a
     * downward pull, so a flick meant for the list is still a scroll. */
    if (sheetDrag.fromContent && dy < 12) return
    if (e.cancelable) e.preventDefault()

    const pts = snapPoints()
    placeSheet(Math.max(pts.full, Math.min(pts.peek, sheetDrag.from + dy)), false)
  }

  const endSheetDrag = e => {
    if (!sheetDrag) return
    const held = sheetDrag
    sheetDrag = null
    if (held.moved < 4) return setSnap(snap) // a tap, not a drag

    /* A flick should land where it was thrown, not where it stopped. The bias
     * is the distance the sheet would keep travelling at the speed it left. */
    const dt = Math.max(16, performance.now() - held.at)
    const velocity = (e.clientY - held.y) / dt
    setSnap(nearestSnap(sheetY, velocity * 140))
  }

  window.addEventListener('pointermove', moveSheet, { passive: false })
  window.addEventListener('pointerup', endSheetDrag)
  window.addEventListener('pointercancel', () => { sheetDrag = null; setSnap(snap) })

  // The grip is a button, so it answers a keyboard too.
  grip.addEventListener('click', () => {
    if (!onPhone()) return
    setSnap(snap === 'full' ? 'peek' : snap === 'half' ? 'full' : 'half')
  })
  grip.addEventListener('keydown', e => {
    const order = ['peek', 'half', 'full']
    const i = order.indexOf(snap)
    if (e.key === 'ArrowUp' && i < 2) { e.preventDefault(); setSnap(order[i + 1]) }
    if (e.key === 'ArrowDown' && i > 0) { e.preventDefault(); setSnap(order[i - 1]) }
  })

  /* A new answer is worth showing. Landing on the itinerary rather than
   * leaving it folded away under a map the reader has to think to move. */
  function revealResult() {
    if (onPhone() && snap === 'peek') setSnap('half')
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
    // Restore the fold before the first fit, so the map is not laid out for a
    // panel width it is about to stop having.
    let folded = false
    try {
      // Not on a phone: the fold control is hidden there in favour of the
      // sheet, so a remembered fold would hide the search with nothing left
      // on screen to bring it back.
      folded = !onPhone() && localStorage.getItem(FOLD_KEY) === '1'
    } catch (e) {
      /* private mode — open is the right default */
    }
    applyFold(folded, false)
    // Half: the map readable and the first legs of the answer already showing.
    // Placed without a glide, so the sheet is where it belongs on the first
    // frame rather than sliding in as though something had happened.
    setSnap('half', false)
    map.resize()
    compute()
  }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(start)
  else start()
})()
