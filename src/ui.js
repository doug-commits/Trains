/* Panel rendering. The map shows the shape of the journey; this shows whether
 * it works. Order matters and is fixed: risk flags arrive before booking links,
 * because a traveller who books before reading the Padang Besar timezone note
 * has already lost the connection.
 */

const UI = (() => {
  const esc = s =>
    String(s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    )

  const MODE_LABEL = { rail: 'Rail', ferry: 'Sea', road: 'Road' }

  function hours(h) {
    if (h == null) return '—'
    if (h < 1) return `${Math.round(h * 60)}m`
    const whole = Math.floor(h)
    const mins = Math.round((h - whole) * 60)
    if (whole >= 24) {
      const d = Math.floor(whole / 24)
      return `${d}d ${whole % 24}h`
    }
    return mins ? `${whole}h ${mins}m` : `${whole}h`
  }

  const money = n => (n < 10 ? `$${n.toFixed(n % 1 ? 1 : 0)}` : `$${Math.round(n)}`)

  const CONFIDENCE = {
    structural: { label: 'Structural', tone: 'ok', title: 'A physical or administrative fact — stations, gauges, who stamps where. Stable for years.' },
    reported: { label: 'Reported', tone: 'ok', title: 'Consistent across the operator pages, Seat61 and Richard Barrow\'s Thai train guide.' },
    verify: { label: 'Verify', tone: 'warn', title: 'Volatile or known to suspend. Confirm this one is running before you book around it.' },
  }

  /* ------------------------------------------------------------- the lede */

  function lede(network, plan, fromId, toId) {
    const t = plan.totals
    const from = network.stations[fromId]
    const to = network.stations[toId]
    const railShare = t.railHours / Math.max(1, t.railHours + t.seaHours + t.roadHours)

    const modes = []
    const railLegs = plan.legs.filter(e => e.leg.mode === 'rail').length
    const seaLegs = plan.legs.filter(e => e.leg.mode === 'ferry').length
    const roadLegs = plan.legs.filter(e => e.leg.mode === 'road').length
    const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
    if (railLegs) modes.push(`${railLegs} on rails`)
    if (seaLegs) modes.push(`${seaLegs} by sea`)
    if (roadLegs) modes.push(`${roadLegs} by road`)

    const total = Math.max(1, t.railHours + t.seaHours + t.roadHours)
    const seaShare = t.seaHours / total
    const scenicSea = plan.legs.filter(e => e.leg.mode === 'ferry' && e.leg.scenic).length

    let character
    if (seaShare > 0.45 && scenicSea) character = 'as much a boat journey as an overland one'
    else if (railShare > 0.85) character = 'a genuine rail journey almost end to end'
    else if (railShare > 0.6) character = 'a rail journey with the gaps bridged'
    else if (railShare > 0.25) character = 'a rail journey for part of its length and an honest slog for the rest'
    else if (seaShare > 0.25) character = 'not a rail journey — the railways do not come here, and the water is the way through'
    else character = 'not really a rail journey at all — the railways do not go this way'

    const sentences = []
    sentences.push(
      `${esc(from.city)} to ${esc(to.city)} is ${character}: ${plural(t.legs, 'leg')} (${modes.join(', ')}) ` +
        `across ${plan.countries.length} ${plan.countries.length === 1 ? 'country' : 'countries'}, ` +
        `with ${t.borders} ${t.borders === 1 ? 'frontier' : 'frontiers'} in between.`
    )

    const top = plan.risks[0]
    if (top) sentences.push(`The one to watch: ${esc(top.title)}.`)

    const longestRoad = plan.legs
      .filter(e => e.leg.mode === 'road' && !e.leg.essential)
      .sort((a, b) => b.leg.hours - a.leg.hours)[0]
    const scenicHours = plan.legs.filter(e => e.leg.scenic).reduce((n, e) => n + e.leg.hours, 0)
    const scenicShare = scenicHours / total

    if (scenicSea >= 2 || (scenicSea && seaShare > 0.45)) {
      sentences.push(
        'The water is the point here rather than a gap in the railway — this is a journey people ' +
          'take deliberately, and the slow version is the good version.'
      )
    } else if (longestRoad && longestRoad.leg.hours >= 10) {
      sentences.push(
        `Be clear-eyed about the ${hours(longestRoad.leg.hours)} coach from ` +
          `${esc(longestRoad.fromCity)} to ${esc(longestRoad.toCity)} — there is no railway on that ` +
          `corridor and no way to dress the bus up as anything else.`
      )
    } else if (scenicShare > 0.4) {
      sentences.push(
        `It is genuinely enjoyable rather than merely possible: ${hours(scenicHours)} of this is ` +
          `worth riding for its own sake` +
          (t.sleeperNights
            ? ', and the sleepers replace hotel nights rather than costing you days.'
            : '.')
      )
    } else if (t.roadHours > t.railHours) {
      sentences.push(
        'It is possible, and that is about the strongest thing to say for it. If the point is the journey, ask for a different pair of endpoints.'
      )
    } else {
      sentences.push(
        'It works and it is comfortable enough, but the journey here is transport rather than the reward — plan the stops, not just the legs.'
      )
    }

    return sentences.join(' ')
  }

  /* ------------------------------------------------------------- sections */

  function statBar(plan) {
    const t = plan.totals
    const bits = [
      [`${t.days}`, t.days === 1 ? 'day' : 'days'],
      [`${t.legs}`, 'legs'],
      [`${t.borders}`, t.borders === 1 ? 'border' : 'borders'],
      [money(t.totalUsd), 'all in'],
    ]
    if (t.railHours) bits.push([hours(t.railHours), 'on rails'])
    if (t.seaHours) bits.push([hours(t.seaHours), 'at sea'])
    if (t.roadHours) bits.push([hours(t.roadHours), 'by road'])
    return `<div class="stats">${bits
      .map(([v, l]) => `<div class="stat"><b>${esc(v)}</b><span>${esc(l)}</span></div>`)
      .join('')}</div>`
  }

  /* Long runs call at a dozen places; listing them all buries the useful ones. */
  function viaLine(via) {
    if (!via.length) return ''
    const shown = via.slice(0, 6)
    const rest = via.length - shown.length
    const text = shown.join(' · ') + (rest ? ` · +${rest} more` : '')
    return `<span class="via" title="${esc(via.join(' · '))}">via ${esc(text)}</span>`
  }

  function routeTable(network, plan) {
    const rows = plan.legs
      .map((entry, i) => {
        const leg = entry.leg
        const conf = CONFIDENCE[leg.confidence] || CONFIDENCE.reported
        const junction = plan.junctions.find(j => j.afterLeg === i)
        const cls = leg.cls ? `<span class="cls">${esc(leg.cls)}</span>` : ''

        const main = `
          <tr class="leg" data-leg="${i}" tabindex="0">
            <td class="num"><span class="mode-dot ${leg.mode}" aria-hidden="true"></span>${i + 1}</td>
            <td class="where">
              <b>${esc(entry.fromName)}</b>
              <span class="arrow" aria-hidden="true">→</span>
              <b>${esc(entry.toName)}</b>
              <span class="svc">${esc(leg.service)}${cls}</span>
              ${viaLine(entry.via)}
              ${leg.note ? `<span class="leg-note">${esc(leg.note)}</span>` : ''}
            </td>
            <td class="op">
              <span class="op-name">${esc(entry.operator.short)}</span>
              <span class="tag ${conf.tone}" title="${esc(conf.title)}">${esc(conf.label)}</span>
            </td>
            <td class="dur num-col">${esc(hours(leg.hours))}</td>
            <td class="fare num-col">${esc(money(leg.usd ?? 0))}</td>
          </tr>`

        if (!junction) return main
        const warn = junction.minutes >= 180 || junction.chainedSleepers
        return (
          main +
          `<tr class="junction ${warn ? 'warn' : ''}">
            <td></td>
            <td colspan="4">
              <span class="j-label">Change at ${esc(junction.stationName)}</span>
              <span class="j-buffer">allow ${junction.minutes >= 120 ? `${(junction.minutes / 60).toFixed(junction.minutes % 60 ? 1 : 0)} h` : `${junction.minutes} min`} minimum</span>
              <span class="j-rule">${esc(junction.rule)}</span>
            </td>
          </tr>`
        )
      })
      .join('')

    return `
      <section class="block">
        <h2>The route</h2>
        <p class="sub">Durations are typical scheduled running times, not departures. No planner in this
        region can give you a departure time you should trust — the operators publish nothing in common.
        Take these legs to the booking sites below and read the real clock there.</p>
        <div class="table-wrap">
          <table class="route">
            <thead><tr><th></th><th>Leg</th><th>Operator</th><th class="num-col">Time</th><th class="num-col">Fare</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </section>`
  }

  function timezoneStrip(network, plan) {
    if (plan.zones.length < 2) return ''
    const crossesPadang = plan.borders.some(b => b.id === 'padangbesar')
    return `
      <div class="callout ${crossesPadang ? 'alert' : ''}">
        <h3>${plan.zones.length} timezones: ${plan.zones.map(z => `UTC+${z}`).join(', ')}</h3>
        <p>${
          crossesPadang
            ? 'Padang Besar is the trap. SRT publishes its departures there in Thai time (UTC+7); KTMB publishes the same platform in Malaysian time (UTC+8). Read both operators\' sites and you will build a connection exactly one hour different from reality, in the direction that makes you miss it. Convert everything to one clock before you book anything.'
            : 'Convert every published time to a single clock in your own notes before you book. Operators publish in their own local time and label it inconsistently.'
        }</p>
      </div>`
  }

  function borderSection(network, plan) {
    if (!plan.borders.length) return ''
    const blocks = plan.borders
      .map(b => {
        const rows = [
          ['Where', b.at],
          ['On the train?', b.stayOnTrain],
          ['Luggage', b.luggage],
          ['Visa', b.visa],
          ['Cash on the far side', b.cash],
          ['Time cost', `About ${b.minutes} minutes of formalities`],
        ]
        return `
          <article class="crossing ${b.hard ? 'hard' : ''}">
            <header>
              <h3>${esc(b.name)}</h3>
              <span class="countries">${esc(b.countries)}</span>
            </header>
            <dl>
              ${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}
            </dl>
            <p class="trap"><b>The trap.</b> ${esc(b.trap)}</p>
            ${b.buffer ? `<p class="trap"><b>Buffer.</b> ${esc(b.buffer)}</p>` : ''}
            ${b.verifyNote ? `<p class="trap verify"><b>Verify.</b> ${esc(b.verifyNote)}</p>` : ''}
          </article>`
      })
      .join('')

    return `<section class="block"><h2>Border crossings</h2>
      <p class="sub">Itineraries die at frontiers, not on track. Never plan one of these without
      checking the current position for your own passport.</p>${blocks}</section>`
  }

  function risksSection(plan) {
    if (!plan.risks.length) {
      return `<section class="block"><h2>Where this breaks</h2>
        <p class="sub">Nothing on this route trips the risk rules — which is unusual, and worth
        double-checking against the operators before you take it as read.</p></section>`
    }
    const items = plan.risks
      .map(
        r => `
        <li class="risk ${r.severity}">
          <span class="sev">${r.severity}</span>
          <h3>${esc(r.title)}</h3>
          <p>${esc(r.text)}</p>
          <p class="fix"><b>What to do.</b> ${esc(r.fix)}</p>
        </li>`
      )
      .join('')
    return `<section class="block"><h2>Where this breaks</h2>
      <p class="sub">Ranked by what actually ends trips, not by probability. A missed last connection
      costs a day and an unplanned hotel; a missed afternoon connection costs an afternoon.</p>
      <ol class="risks">${items}</ol></section>`
  }

  function bookingSection(network, plan) {
    const items = plan.booking
      .map(
        (b, i) => `
        <li>
          <span class="rank">${i + 1}</span>
          <div>
            <h3>${esc(b.service || b.operator.name)}</h3>
            <p class="window">${esc(b.window)}</p>
            <p>${esc(b.why)}</p>
            ${
              b.operator.book
                ? `<a class="book" href="${esc(b.operator.book)}" target="_blank" rel="noopener noreferrer">${esc(
                    new URL(b.operator.book).hostname.replace(/^www\./, '')
                  )}</a>`
                : '<span class="book none">Bought at the pier, or through a local agent</span>'
            }
          </div>
        </li>`
      )
      .join('')

    return `<section class="block"><h2>Booking sequence</h2>
      <p class="sub">Book in order of scarcity times window length, not in the order you travel.
      The shortest leg on the whole spine sells out first.</p>
      <ol class="booking">${items}</ol>
      <p class="sub foot">Where an operator cannot be booked from abroad — LCR above all — an
      aggregator such as 12Go or Baolau is the practical route in. They add a fee, and some sell
      tickets they do not yet hold and buy them when inventory opens, which is a genuine cancellation
      risk on a scarce sleeper. Prefer the operator wherever the operator actually works.</p>
      </section>`
  }

  function costSection(network, plan) {
    const t = plan.totals
    const f = plan.flight
    return `<section class="block"><h2>Costs</h2>
      <div class="table-wrap">
        <table class="costs">
          <tbody>
            <tr><td>Transport, ${t.legs} legs</td><td class="num-col">${esc(money(t.transportUsd))}</td></tr>
            <tr><td>Accommodation, ${t.hotelNights} ${t.hotelNights === 1 ? 'night' : 'nights'} at about $${Plan.HOTEL_USD}</td><td class="num-col">${esc(money(t.lodgingUsd))}</td></tr>
            ${
              t.sleeperNights
                ? `<tr class="saved"><td>${t.sleeperNights} ${t.sleeperNights === 1 ? 'night' : 'nights'} on a sleeper — a bed you already paid for in the fare</td><td class="num-col">included</td></tr>`
                : ''
            }
            <tr class="total"><td>Total</td><td class="num-col">${esc(money(t.totalUsd))}</td></tr>
          </tbody>
        </table>
      </div>
      <div class="compare">
        <h3>Against flying</h3>
        <p>
          <b>${t.days} ${t.days === 1 ? 'day' : 'days'}, ${esc(money(t.totalUsd))}, ${t.legs} legs</b>
          versus a flight of roughly <b>${esc(hours(f.hours))}</b> gate to gate at somewhere around
          <b>$${f.low}–${f.high}</b>. That fare band is estimated from the ${f.km} km great-circle
          distance, not from live inventory — check it.
        </p>
        <p class="honest">${
          t.days >= 3
            ? 'The plane wins on time and often on money. People take this route because the overland journey is the thing they want, not because it is efficient. If that is not you, fly — and there is no shame in the sleeper one way and the plane home.'
            : 'On a trip this short the train is genuinely competitive, and it puts you in the middle of a city rather than an hour outside one.'
        }</p>
      </div>
      </section>`
  }

  function detourSection(plan) {
    if (!plan.detours.length) return ''
    const items = plan.detours
      .map(
        d => `<li><h3>${esc(d.title)}</h3><span class="cost">${esc(d.cost)}</span><p>${esc(d.text)}</p></li>`
      )
      .join('')
    return `<section class="block"><h2>If you have more time</h2>
      <p class="sub">Where the slow-travel value actually is — the detours that turn a transit into a trip.</p>
      <ul class="detours">${items}</ul></section>`
  }

  function seasonBanner(plan) {
    if (!plan.seasons.length) return ''
    return plan.seasons
      .map(
        s => `<div class="callout alert season">
          <h3>Your dates fall in ${esc(s.name)}</h3>
          <p>${esc(s.text)}</p>
        </div>`
      )
      .join('')
  }

  /* ------------------------------------------------------------ assembled */

  function itinerary(network, plan, fromId, toId, opts) {
    const from = network.stations[fromId]
    const to = network.stations[toId]
    const t = plan.totals

    const stationWarnings = plan.stationIds
      .map(id => ({ id, s: network.stations[id] }))
      .filter(x => x.s.warn)
      .map(
        x => `<li><b>${esc(x.s.name)}</b> ${esc(x.s.warn)}</li>`
      )
      .join('')

    return `
      <header class="head">
        <p class="eyebrow">${esc(opts.railOnly ? 'Hard rail-only' : 'Pragmatic')} routing${
          opts.date ? ` · departing ${esc(opts.date)}` : ''
        }${opts.nationality ? ` · ${esc(opts.nationality)} passport` : ''}</p>
        <h1>${esc(from.city)} <span aria-hidden="true">→</span> ${esc(to.city)} overland</h1>
        ${statBar(plan)}
        <p class="lede">${lede(network, plan, fromId, toId)}</p>
      </header>
      ${seasonBanner(plan)}
      ${timezoneStrip(network, plan)}
      ${
        stationWarnings
          ? `<div class="callout"><h3>Stations that catch people out</h3><ul class="warns">${stationWarnings}</ul></div>`
          : ''
      }
      ${routeTable(network, plan)}
      ${borderSection(network, plan)}
      ${risksSection(plan)}
      ${bookingSection(network, plan)}
      ${costSection(network, plan)}
      ${detourSection(plan)}
      <footer class="foot-note">
        <p>Network reviewed ${esc(network.reviewed)}. ${
          t.verifyCount
            ? `${t.verifyCount} ${t.verifyCount === 1 ? 'leg on this route is' : 'legs on this route are'} marked <b>Verify</b> — those are the ones to confirm first.`
            : 'No leg on this route is currently flagged as volatile.'
        } Cross-check anything time-critical against the operator and against
        <a href="https://www.seat61.com/asia-trains.htm" target="_blank" rel="noopener noreferrer">Seat61</a>
        before you book. Fares are indicative.</p>
      </footer>`
  }

  function unreachable(network, fromId, toId, reachableSet, opts) {
    const from = network.stations[fromId]
    const to = network.stations[toId]

    // Name the station where the rails actually stop, on the destination's side.
    const target = network.stations[toId]
    let nearest = null
    let best = Infinity
    for (const id of reachableSet) {
      const s = network.stations[id]
      const d = Proj.haversine(s, target)
      if (d < best) {
        best = d
        nearest = { id, s, d }
      }
    }

    return `
      <header class="head">
        <p class="eyebrow">No route under these constraints</p>
        <h1>${esc(from.city)} <span aria-hidden="true">→</span> ${esc(to.city)}</h1>
      </header>
      <div class="callout alert">
        <h3>The rails do not go this way</h3>
        <p>${
          opts.railOnly
            ? 'In hard rail-only mode this pair has no chain of railways and unavoidable transfers connecting them. That is the honest answer, and stretching to give you a route would be worse than not having one.'
            : 'These two points are not connected by any chain of rail, sea or road legs in this network.'
        }</p>
        ${
          nearest
            ? `<p>Going as far as the railways allow gets you to <b>${esc(nearest.s.name)}</b>,
               about ${Math.round(nearest.d)} km short of ${esc(to.city)}.</p>`
            : ''
        }
        <p>${
          opts.railOnly
            ? 'Switch to pragmatic routing and the planner will bridge the gap with the minimum necessary road leg, and tell you exactly how long it is.'
            : 'Check whether either endpoint is on an isolated fragment — Sabah\'s line and northern Sumatra\'s connect to nothing else in Asia.'
        }</p>
      </div>`
  }

  function idle(network, presets) {
    const chips = presets
      .map(
        (p, i) =>
          `<button class="chip" data-preset="${i}"><b>${esc(p.label)}</b><span>${esc(p.note)}</span></button>`
      )
      .join('')

    const myths = network.myths
      .map(m => `<li><span class="belief">${esc(m.belief)}</span><span class="reality">${esc(m.reality)}</span></li>`)
      .join('')

    return `
      <header class="head">
        <p class="eyebrow">Rail-first overland planning</p>
        <h1>Southeast Asia<br>without flying</h1>
        <p class="lede">${esc(network.intro)}</p>
        <p class="sub">Every mainstream planner optimises for speed, so it answers
        “Vientiane to Kuala Lumpur” with a flight. This one optimises for continuity on the ground:
        it keeps you on rails as far as the rails go, puts a boat where the land ends, and uses a
        road vehicle only where neither exists.</p>
      </header>
      <section class="block">
        <h2>Start from a corridor</h2>
        <div class="chips">${chips}</div>
      </section>
      <section class="block">
        <h2>What people get wrong</h2>
        <p class="sub">Travellers arrive with these. All seven are load-bearing — each one has
        stranded somebody.</p>
        <ul class="myths">${myths}</ul>
      </section>
      <footer class="foot-note">
        <p>Network reviewed ${esc(network.reviewed)}. This planner gives you legs, operators,
        border mechanics and connection buffers — deliberately not departure times, because
        SRT, KTMB, LCR, DSVN and KAI publish nothing in a common format and a remembered
        departure is the fastest way to miss a train. Verify live before booking.</p>
      </footer>`
  }

  return { itinerary, idle, unreachable, esc, hours, money, MODE_LABEL }
})()
