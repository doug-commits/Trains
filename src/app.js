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

  const $ = sel => document.querySelector(sel)
  const app = document.querySelector('.app')
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
    // Set only when the question named places rather than stations, so the
    // answer can be headlined in the words that were actually used.
    labels: null,
  }

  /* Real numbers on the corridor cards, so the choice is informed before the
     click. One Dijkstra run per corridor over ~200 edges — cheap at boot. */
  function withStats(presets) {
    // Several corridors end in the same kind of place, and three identical
    // skylines in a row reads as a rendering bug. Where the terminus repeats,
    // take the illustration from somewhere else the route actually calls at.
    const used = new Set()
    return presets.map(p => {
      const routed = Router.route(NETWORK, p.from, p.to, {})
      if (!routed) return p
      const plan = Plan.build(NETWORK, routed, {})
      const t = plan.totals

      let scene = Scene.kindFor(NETWORK, LANDMARKS, p.to)
      let seed = p.to
      if (used.has(scene)) {
        const along = plan.stationIds
          .map(id => ({ id, kind: Scene.kindFor(NETWORK, LANDMARKS, id) }))
          .find(x => !used.has(x.kind))
        if (along) {
          scene = along.kind
          seed = along.id
        }
      }
      used.add(scene)

      return {
        ...p,
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

  function renderDetailSummary() {
    const bits = [state.railOnly ? 'Hard rail-only' : 'Pragmatic routing']
    if (state.pace !== 'standard') bits.push(PACE_LABEL[state.pace])
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
    renderDetailSummary()
  }

  /* ----------------------------------------------------------------- plan */

  function compute() {
    if (!state.from || !state.to || state.from === state.to) {
      state.plan = null
      map.setRoute(null, false)
      app.dataset.active = 'false'
      panel.innerHTML = UI.idle(NETWORK, CORRIDORS)
      resetScroll()
      paintScenes()
      return
    }

    const opts = {
      railOnly: state.railOnly,
      date: state.date,
      nationality: state.nationality,
      pace: state.pace,
      labels: state.labels,
    }
    const routed = Router.route(NETWORK, state.from, state.to, opts)

    if (!routed) {
      state.plan = null
      map.setRoute(null, false)
      const reach = Router.reachable(NETWORK, state.from, opts)
      app.dataset.active = 'true'
      panel.innerHTML = UI.unreachable(NETWORK, state.from, state.to, reach, opts)
      resetScroll()
      paintScenes()
      return
    }

    const plan = Plan.build(NETWORK, routed, opts)
    state.plan = plan
    app.dataset.active = 'true'
    map.setRoute({ legs: plan.legs, stationIds: plan.stationIds, stopIds: plan.stopIds })
    panel.innerHTML = UI.itinerary(NETWORK, plan, state.from, state.to, opts)
    resetScroll()
    paintScenes()
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

  function paintScenes() {
    Scene.paintAll(panel)
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
    renderDetailSummary()
    state.pace = e.target.value
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
      const hint = result.suggestions && result.suggestions.length
        ? ` Try ${result.suggestions.slice(0, 3).map(s => `<b>${UI.esc(s)}</b>`).join(', ')}.`
        : ''
      return showAskNote(UI.esc(result.reason) + hint, 'warn')
    }

    state.from = result.from.stationId
    state.to = result.to.stationId
    state.labels = { from: result.from.label, to: result.to.label }
    renderControls()
    compute()

    // Say what it decided, including any gap it cannot cover by rail.
    const line = side =>
      Ask.explain(NETWORK, side)
        .map((b, i) => (i === 0 ? `<b>${UI.esc(b)}</b>` : `<span>${UI.esc(b)}</span>`))
        .join(' — ')
    showAskNote(`${line(result.from)}<br>${line(result.to)}`, 'ok')
  }

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
