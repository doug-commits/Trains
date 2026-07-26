/* Wiring: controls, map interaction, and keeping the panel and the map in sync.
 * The route is held in the URL hash so a plan can be sent to someone else.
 */

;(function () {
  const COUNTRY_NAME = {
    cn: 'China', la: 'Laos', th: 'Thailand', kh: 'Cambodia', vn: 'Vietnam',
    my: 'Malaysia', sg: 'Singapore', id: 'Indonesia', mm: 'Myanmar',
  }
  const COUNTRY_ORDER = ['cn', 'la', 'th', 'kh', 'vn', 'my', 'sg', 'id', 'mm']

  const PRESETS = [
    { label: 'The Spine', from: 'kunming', to: 'singapore', note: 'Kunming to Singapore — the only continuous rail corridor in the region' },
    { label: 'Bangkok → Singapore', from: 'bkk_aphiwat', to: 'singapore', note: 'The classic, and materially easier than every pre-2026 guide says' },
    { label: 'Laos → Malaysia', from: 'luangprabang', to: 'klsentral', note: 'The common ask. Pure spine, southbound' },
    { label: 'Singapore → Bali', from: 'singapore', to: 'denpasar', note: 'Land and sea the whole way. The flagship' },
    { label: 'Bangkok → Hanoi', from: 'bkk_aphiwat', to: 'hanoi', note: 'There is no rail answer. See what the honest one looks like' },
    { label: 'The Jungle Railway', from: 'klsentral', to: 'wakafbaharu', note: 'Slow, scenic, cult status — the journey as the point' },
  ]

  const $ = sel => document.querySelector(sel)
  const canvas = $('#map')
  const panel = $('#panel')
  const tooltip = $('#tip')

  const map = MapView.create(canvas, NETWORK, BASEMAP)

  const state = {
    from: null,
    to: null,
    railOnly: false,
    date: '',
    nationality: '',
    pace: 'standard',
    plan: null,
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

  function renderControls() {
    $('#from').innerHTML = `<option value="">Choose a station…</option>${stationOptions(state.from)}`
    $('#to').innerHTML = `<option value="">Choose a station…</option>${stationOptions(state.to)}`
    $('#railonly').checked = state.railOnly
    $('#date').value = state.date
    $('#nationality').value = state.nationality
    $('#pace').value = state.pace
  }

  /* ----------------------------------------------------------------- plan */

  function compute() {
    if (!state.from || !state.to || state.from === state.to) {
      state.plan = null
      map.setRoute(null, false)
      panel.innerHTML = UI.idle(NETWORK, PRESETS)
      resetScroll()
      return
    }

    const opts = {
      railOnly: state.railOnly,
      date: state.date,
      nationality: state.nationality,
      pace: state.pace,
    }
    const routed = Router.route(NETWORK, state.from, state.to, opts)

    if (!routed) {
      state.plan = null
      map.setRoute(null, false)
      const reach = Router.reachable(NETWORK, state.from, opts)
      panel.innerHTML = UI.unreachable(NETWORK, state.from, state.to, reach, opts)
      resetScroll()
      return
    }

    const plan = Plan.build(NETWORK, routed, opts)
    state.plan = plan
    map.setRoute({ legs: plan.legs, stationIds: plan.stationIds, stopIds: plan.stopIds })
    panel.innerHTML = UI.itinerary(NETWORK, plan, state.from, state.to, opts)
    resetScroll()
    bindPanel()
    writeHash()
  }

  /* On wide screens the panel scrolls independently; stacked, the window does,
     and a new route rendered below the fold is a route nobody reads. */
  function resetScroll() {
    panel.scrollTop = 0
    if (!window.matchMedia('(min-width: 60.0625rem)').matches) {
      const wrap = document.querySelector('.mapwrap')
      if (wrap) window.scrollTo({ top: wrap.offsetTop, behavior: 'smooth' })
    }
  }

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
  }

  /* -------------------------------------------------------- map behaviour */

  let drag = null

  canvas.addEventListener('pointerdown', e => {
    canvas.setPointerCapture(e.pointerId)
    drag = { x: e.offsetX, y: e.offsetY, moved: 0 }
  })

  canvas.addEventListener('pointermove', e => {
    if (drag) {
      const dx = e.offsetX - drag.x
      const dy = e.offsetY - drag.y
      drag.moved += Math.abs(dx) + Math.abs(dy)
      drag.x = e.offsetX
      drag.y = e.offsetY
      map.panBy(dx, dy)
      hideTip()
      return
    }

    const found = map.pick(e.offsetX, e.offsetY)
    canvas.style.cursor = found ? 'pointer' : 'grab'
    if (!found) return hideTip()

    if (found.type === 'station') {
      const s = found.station
      showTip(
        e.offsetX,
        e.offsetY,
        `<b>${UI.esc(s.name)}</b><span>${UI.esc(s.city)}, ${UI.esc(COUNTRY_NAME[s.country])}${
          s.gauge ? ` · ${UI.esc(s.gauge)} gauge` : ''
        }</span>${s.warn ? `<em>${UI.esc(s.warn)}</em>` : ''}`
      )
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

  canvas.addEventListener('pointerup', e => {
    const wasDrag = drag && drag.moved > 6
    drag = null
    canvas.style.cursor = 'grab'
    if (wasDrag) return

    const found = map.pick(e.offsetX, e.offsetY)
    if (!found || found.type !== 'station') return
    // First click sets the origin, second the destination, then it cycles.
    if (!state.from || (state.from && state.to)) {
      state.from = found.id
      state.to = null
    } else {
      state.to = found.id
    }
    renderControls()
    compute()
  })

  canvas.addEventListener('pointerleave', () => {
    drag = null
    hideTip()
  })

  canvas.addEventListener(
    'wheel',
    e => {
      e.preventDefault()
      map.zoomAt(e.offsetX, e.offsetY, e.deltaY < 0 ? 1.12 : 1 / 1.12)
      hideTip()
    },
    { passive: false }
  )

  function showTip(x, y, html) {
    tooltip.innerHTML = html
    tooltip.hidden = false
    const rect = canvas.getBoundingClientRect()
    const tw = tooltip.offsetWidth
    const th = tooltip.offsetHeight
    tooltip.style.left = `${Math.min(Math.max(8, x + 14), rect.width - tw - 8)}px`
    tooltip.style.top = `${Math.max(8, y - th - 14)}px`
  }
  function hideTip() {
    tooltip.hidden = true
  }

  /* ------------------------------------------------------------- listeners */

  $('#from').addEventListener('change', e => {
    state.from = e.target.value || null
    compute()
  })
  $('#to').addEventListener('change', e => {
    state.to = e.target.value || null
    compute()
  })
  $('#swap').addEventListener('click', () => {
    ;[state.from, state.to] = [state.to, state.from]
    renderControls()
    compute()
  })
  $('#railonly').addEventListener('change', e => {
    state.railOnly = e.target.checked
    compute()
  })
  $('#date').addEventListener('change', e => {
    state.date = e.target.value
    compute()
  })
  $('#nationality').addEventListener('input', e => {
    state.nationality = e.target.value
    if (state.plan) compute()
  })
  $('#pace').addEventListener('change', e => {
    state.pace = e.target.value
    compute()
  })
  $('#reset').addEventListener('click', () => map.resetView())

  panel.addEventListener('click', e => {
    const chip = e.target.closest('[data-preset]')
    if (!chip) return
    const p = PRESETS[Number(chip.dataset.preset)]
    state.from = p.from
    state.to = p.to
    renderControls()
    compute()
  })

  /* ---------------------------------------------------------------- theme */

  const redraw = () => map.redraw()
  new MutationObserver(redraw).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme', 'class', 'style'],
  })
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', redraw)

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
