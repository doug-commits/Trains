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

  // Two of the eleven take a definite article and reading "Through Philippines"
  // once is enough to want this.
  const THE = new Set(['Philippines'])
  const countryName = (network, code) => {
    const name = network.countryNames?.[code] || code
    return THE.has(name) ? `the ${name}` : name
  }

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
      // Marked, not positional: the cost carries the accent, and it stopped
      // being the last tile the moment a journey had road hours to report.
      [money(t.totalUsd), 'all in', 'cost'],
    ]
    if (t.railHours) bits.push([hours(t.railHours), 'on rails', 'rail'])
    if (t.seaHours) bits.push([hours(t.seaHours), 'at sea', 'ferry'])
    if (t.roadHours) bits.push([hours(t.roadHours), 'by road', 'road'])
    return `<div class="stats">${bits
      .map(
        ([v, l, kind]) =>
          `<div class="stat${kind ? ' is-' + kind : ''}"><b>${esc(v)}</b><span>${esc(l)}</span></div>`
      )
      .join('')}</div>`
  }

  /* The other ways round, and what each one trades.
   *
   * A router that shows one answer is asking to be trusted about a judgement
   * it cannot make: whether you have the extra two days, whether you would
   * rather be on a boat than a coach, whether you have already seen Sumatra.
   * The cost function encodes a defensible default and nothing more, so where
   * a genuinely different journey exists it goes on the page beside the
   * recommendation with its own numbers.
   *
   * Only where one exists. Most corridors here have exactly one way through,
   * and inventing a second by moving a station would be padding.
   */
  function waysSection(network, ways, plan) {
    if (!ways || ways.length < 2) return ''

    /* What actually separates this routing from the recommended one.
     *
     * The first version of this listed new operators and the first three
     * unfamiliar stations, and for Singapore to Bali it produced "Urban metro
     * and KTMB · via Singapore, Johor Bahru, Kluang and 14 more" — every word
     * true and not one of them the point, which is that this one crosses
     * Sumatra by coach instead of sailing to Jakarta. So: countries first,
     * because a different country is the difference anyone would notice; then
     * the single longest leg that is unique to this way, because that is what
     * the day will actually feel like. */
    const distinguish = (mine, base) => {
      const seen = new Set(base.plan.stationIds)
      const theirCountries = new Set(base.plan.countries)
      const fresh = mine.plan.countries.filter(c => !theirCountries.has(c))

      const ours = new Set(base.plan.legs.map(e => e.leg))
      const only = mine.plan.legs.filter(e => !ours.has(e.leg))
      const longest = only.slice().sort((a, b) => b.leg.hours - a.leg.hours)[0]

      const bits = []
      if (fresh.length) {
        bits.push(`Through ${fresh.map(c => countryName(network, c)).join(' and ')}`)
      } else {
        /* Not the endpoints. Both routings start and finish in the same
           place, and "Via Manila" on a journey out of Manila is the kind of
           line that makes a reader stop trusting the rest of the page. */
        /* By city, not by id. Manila has two stations on this map — the
           terminus and the pier — so excluding the id let "Via Manila" back
           onto a card for a journey that starts in Manila. */
        const ids = mine.plan.stationIds
        const ends = new Set(
          [ids[0], ids[ids.length - 1]].map(id => network.stations[id]?.city)
        )
        const where = ids.filter(
          id => !seen.has(id) && !ends.has(network.stations[id]?.city)
        )
        if (where.length) {
          bits.push(`Via ${network.stations[where[0]]?.city || where[0]}`)
        }
      }
      if (longest) {
        bits.push(
          `${hours(longest.leg.hours)} ${MODE_LABEL[longest.leg.mode].toLowerCase()} ` +
            `${longest.fromCity} to ${longest.toCity}`
        )
      }
      return bits.join(', ')
    }

    /* Against the recommendation, in the units a traveller feels — days, money
     * and hours on a road — rather than the router's own cost, which is a
     * weighting and not a thing anyone can check.
     *
     * Written as a phrase rather than signed numbers: "+3 days · +$150 · +18 h
     * by road than the recommendation" parsed as a sum on first reading, and
     * the sign on a saving is exactly the thing people misread. */
    const versus = (mine, base) => {
      const a = mine.plan.totals
      const b = base.plan.totals
      const out = []
      const more = (n, one, many) =>
        `${Math.abs(n)} ${Math.abs(n) === 1 ? one : many} ${n > 0 ? 'longer' : 'shorter'}`

      const day = a.days - b.days
      if (day) out.push(more(day, 'day', 'days'))
      const usd = Math.round(a.totalUsd - b.totalUsd)
      if (usd) out.push(`${money(Math.abs(usd))} ${usd > 0 ? 'dearer' : 'cheaper'}`)
      const road = Math.round(a.roadHours - b.roadHours)
      if (road) out.push(`${Math.abs(road)} h ${road > 0 ? 'more' : 'less'} on a road`)

      if (!out.length) return 'Much the same on every count — a different way, not a worse one.'
      const last = out.pop()
      return `${out.length ? `${out.join(', ')} and ${last}` : last}.`
        .replace(/^./, c => c.toUpperCase())
    }

    const base = ways[0]
    const cards = ways
      .map(w => {
        const t = w.plan.totals
        const what =
          w.index === 0
            ? `Through ${w.plan.countries.map(c => countryName(network, c)).join(', ')}`
            : distinguish(w, base) || 'Another way round'
        return `
          <li class="way${w.current ? ' on' : ''}">
            <div class="way-head">
              <b>${esc(w.index === 0 ? 'Recommended' : `Alternative ${w.index}`)}</b>
              ${w.current ? '<span class="way-now">showing</span>' : ''}
            </div>
            <p class="way-what">${esc(what)}</p>
            <p class="way-nums">
              <span>${esc(hours(t.movingHours))} moving</span>
              <span>${t.days} ${t.days === 1 ? 'day' : 'days'}</span>
              <span>${esc(money(t.totalUsd))}</span>
              <span>${t.legs} ${t.legs === 1 ? 'leg' : 'legs'}</span>
            </p>
            ${
              w.index === 0
                ? '<p class="way-vs">Rails as far as they go, a boat where the land ends.</p>'
                : `<p class="way-vs">${esc(versus(w, base))}</p>`
            }
            ${
              w.current
                ? ''
                : `<button type="button" class="way-go" data-way="${w.index}">Plan this one instead</button>`
            }
          </li>`
      })
      .join('')

    return `
      <section class="block ways">
        <h2>Other ways round</h2>
        <p class="sub">The recommendation is what this planner would do with no
        further information. These are the genuinely different journeys between
        the same two points — not the same route with a station moved, which is
        why there are two of them and not ten. Choosing one rebuilds everything
        below it: the map, the nights, the borders and the cost are all
        downstream of which way you go.</p>
        <ul class="waylist">${cards}</ul>
      </section>`
  }

  /* The clock, as far as this planner is honestly able to give you one.
   *
   * People ask for a timetable and the page has always refused, for a good
   * reason: nine operators here publish in nine formats, several publish
   * nothing, and a departure time is specific to a date and a direction. A
   * planner that prints one is inviting somebody to stand on a platform at the
   * time it made up.
   *
   * But refusing the whole question was too clean. What the data does hold,
   * for about half the legs on this map, is when a service stops for the day —
   * and that single number is the one that actually strands people. Nobody
   * misses a connection because they did not know the 14:05 existed. They miss
   * it because the last boat went at 17:00 and the train got in at 17:20.
   *
   * So: not a timetable. The legs that stop, and which of them decides the
   * day. Every figure here is one that was already checked against the
   * operator; nothing is derived and nothing is estimated.
   */
  function clockBlock(network, plan) {
    const clock = /\d{1,2}:\d{2}/
    const stopping = plan.legs
      .map(entry => {
        const d = entry.leg.daily || entry.operator?.daily
        if (!d) return null
        const last = d.last && clock.test(String(d.last)) ? String(d.last) : null
        // A row earns its place by having a clock time somewhere, but once it
        // is here the prose is shown whether or not it contains one: "roughly
        // hourly from HarbourFront" is the answer to "when does it run", and
        // printing "not recorded" beside a last sailing of 21:00 was not.
        if (!last && !clock.test(d.spread || '')) return null
        return { entry, last, window: d.spread || null }
      })
      .filter(Boolean)

    if (!stopping.length) return ''

    /* The earliest last departure on the route. Not a claim that it is the one
       that will catch you — that depends on the day you start and which train
       you took out of the previous town — but it is the one to plan backwards
       from, and it is the one to look at first. */
    /* And only worth naming if it is early enough to change what you do. The
       first version of this told a reader to plan backwards from a shuttle
       that runs every half hour until 23:45, which is true, useless, and the
       sort of thing that teaches people to skip the box. */
    const EARLY = '20:00'
    const binding = stopping
      .filter(s => s.last && s.last < EARLY)
      .sort((a, b) => a.last.localeCompare(b.last))[0]

    const rows = stopping
      .map(
        s => `
        <tr${s === binding ? ' class="binds"' : ''}>
          <td class="where">
            <b>${esc(s.entry.fromName)}</b>
            <span class="arrow" aria-hidden="true">→</span>
            <b>${esc(s.entry.toName)}</b>
            <span class="svc">${esc(s.entry.leg.service)}</span>
          </td>
          <td>${s.window ? esc(s.window) : '<span class="muted">not recorded</span>'}</td>
          <td class="num-col">${s.last ? esc(s.last) : '—'}</td>
        </tr>`
      )
      .join('')

    return `
      <section class="block clockblock">
        <h2>What stops running, and when</h2>
        <p class="sub">Not a timetable — this planner will not print a departure
        time it cannot stand behind, and no two operators here publish in a way
        that would let it. This is the other half of the question, and the half
        that strands people: which legs stop for the day, and how late. Nobody
        misses a connection for want of knowing the 14:05 existed. They miss it
        because the last boat went at 17:00.</p>
        ${
          binding
            ? `<p class="clock-binds">Plan backwards from the
               <b>${esc(binding.last)}</b> ${esc(binding.entry.fromCity)} to
               ${esc(binding.entry.toCity)} — it is the earliest door to close on
               this route.</p>`
            : ''
        }
        <div class="table-wrap">
          <table class="route clock">
            <thead><tr><th>Leg</th><th>Runs</th><th class="num-col">Last</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </section>`
  }

  /* A destination image. A real photograph wins; the drawn illustration is the
   * fallback, so a half-populated photo set still looks finished. */
  function destinationArt(network, stationId, alt) {
    const photo = typeof Photos !== 'undefined' ? Photos.forStation(stationId) : null
    const kind = typeof Scene !== 'undefined' ? Scene.kindFor(network, LANDMARKS, stationId) : null
    if (photo) return Photos.figure(photo, alt, kind ? { kind, seed: stationId } : null)
    if (!kind) return ''
    return `<canvas class="scene" data-scene="${esc(kind)}" data-seed="${esc(stationId)}"></canvas>`
  }

  /* An operator plate: our own mark in the operator's approximate livery, not
   * their logo. Legible on both grounds because it carries its own ink colour. */
  function plate(op) {
    return (
      `<span class="plate" style="--livery:${esc(op.livery)};--plate-ink:${esc(op.ink)}" ` +
      `aria-hidden="true">${esc(op.mono)}</span>`
    )
  }

  const host = url => url.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '')

  /* Operator first, always. An aggregator only appears where the operator
   * genuinely cannot be booked from abroad, and never as an upsell over a
   * working official site. */
  function bookLine(network, op, mode) {
    if (op.book) {
      return (
        `<a class="book-leg" href="${esc(op.book)}" target="_blank" rel="noopener noreferrer" ` +
        `title="${esc(op.bookNote || '')}">Book with ${esc(op.short)}` +
        `<span class="host">${esc(host(op.book))}</span></a>`
      )
    }
    if (op.bookVia === 'aggregator') {
      const agg = network.aggregators[0]
      return (
        `<span class="book-leg via" title="${esc(op.bookNote || '')}">No bookable site of its own — try ` +
        `<a href="${esc(agg.url)}" target="_blank" rel="noopener noreferrer">${esc(agg.name)}</a>` +
        `<span class="host">${esc(host(agg.url))}</span></span>`
      )
    }
    const where =
      mode === 'ferry' ? 'Pay at the pier' : mode === 'rail' ? 'Buy at the station' : 'Pay on the spot'
    return `<span class="book-leg none" title="${esc(op.bookNote || '')}">${where}</span>`
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

        const op = entry.operator
        const main = `
          <tr class="leg" data-leg="${i}" data-mode="${esc(leg.mode)}" tabindex="0">
            <td class="num"><span class="mode-dot ${leg.mode}" aria-hidden="true"></span>${i + 1}</td>
            <td class="where">
              <b>${esc(entry.fromName)}</b>
              <span class="arrow" aria-hidden="true">→</span>
              <b>${esc(entry.toName)}</b>
              <span class="opline">
                ${plate(op)}
                <span class="op-name">${esc(op.name)}</span>
                <span class="tag ${conf.tone}" title="${esc(conf.title)}">${esc(conf.label)}</span>
              </span>
              <span class="svc">${esc(leg.service)}${cls}</span>
              ${frequencyLine(leg, op)}
              ${viaLine(entry.via)}
              ${leg.note ? `<span class="leg-note">${esc(leg.note)}</span>` : ''}
              ${bookLine(network, op, leg.mode)}
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
            <td colspan="3">
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
        <p class="sub">Durations are typical scheduled running times, not departures, and the figure
        under each service is how often it runs — the number that decides whether a missed connection
        costs you an hour or a day. Where a last departure is shown it is the one worth setting an alarm
        for. No planner in this region can give you a departure time you should trust: the operators
        publish nothing in common. Take these legs to the booking sites below and read the real clock
        there.</p>
        <div class="table-wrap">
          <table class="route">
            <thead><tr><th></th><th>Leg &amp; operator</th><th class="num-col">Time</th><th class="num-col">Fare</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </section>`
  }

  /* How many run in a day, and the last one where missing it costs you a night.
   *
   * This is the closest the page comes to a timetable, and the distinction is
   * deliberate: a frequency is structural — it changes with a timetable revision
   * once or twice a year — while a departure time is specific to a date and a
   * direction and is exactly the thing that strands people. A last sailing is
   * the one clock time worth stating, because it is the one that turns a missed
   * connection into a night on the wrong side of the water. */
  function frequencyLine(leg, operator) {
    // The leg knows best; the operator is the fallback for services whose
    // frequency is a property of the mode rather than of any one route.
    const d = leg.daily || (operator && operator.daily)
    if (!d) {
      return `<span class="freq none">Frequency not recorded — check the operator</span>`
    }
    const count = typeof d.n === 'number' ? `${d.n} a day` : esc(d.n)
    return (
      `<span class="freq">` +
      `<b>${esc(count)}</b>` +
      (d.spread ? ` · ${esc(d.spread)}` : '') +
      (d.last ? ` <span class="last">last ${esc(d.last)}</span>` : '') +
      `</span>`
    )
  }

  /* The day-by-day shape of the journey. Not a timetable — no departure is
   * stated anywhere in it — but it answers the question people actually mean
   * when they ask for one: how many days is this, what happens on each, and
   * where do I sleep. */
  function scheduleBlock(network, plan) {
    if (!plan.schedule || plan.schedule.length < 2) return ''

    const rows = plan.schedule
      .map(day => {
        // A day that exists only because you were asleep on a boat or a train
        // when it started. No legs, but it is a real day of your trip.
        if (!day.legs.length) {
          return `
            <div class="day arrive-only">
              <div class="day-head"><span class="day-n">Day ${day.n}</span></div>
              <span class="night end">Step off in the morning${
                day.arriveAt ? ` at ${esc(day.arriveAt)}` : ''
              }</span>
            </div>`
        }
        const items = day.legs
          .map(i => {
            const e = plan.legs[i]
            // "Manila → Manila" for a cross-town transfer helps nobody; when
            // both ends share a city, name the stations instead.
            const same = e.fromCity === e.toCity
            const a = same ? e.fromName : e.fromCity
            const b = same ? e.toName : e.toCity
            return `<li>
              <span class="mode-dot ${e.leg.mode}" aria-hidden="true"></span>
              <span class="d-route">
                <b>${esc(a)}</b> <span class="arrow" aria-hidden="true">→</span> <b>${esc(b)}</b>
                <span class="d-svc">${esc(e.leg.service)}</span>
              </span>
              <span class="d-time">${esc(hours(e.leg.hours))}</span>
            </li>`
          })
          .join('')

        const night =
          day.night === 'sleeper'
            ? `<span class="night sleeper">Night aboard — ${esc(day.nightAt || 'the sleeper')}</span>`
            : day.night === 'hotel'
              ? `<span class="night hotel">Night in ${esc(day.nightAt || 'town')}</span>`
              : `<span class="night end">Arrive</span>`

        return `
          <div class="day">
            <div class="day-head">
              <span class="day-n">Day ${day.n}</span>
              <span class="day-hours">${esc(hours(day.hours))} moving</span>
            </div>
            <ul class="day-legs">${items}</ul>
            ${night}
          </div>`
      })
      .join('')

    return `
      <section class="block">
        <h2>Day by day</h2>
        <p class="sub">Shape, not a timetable. This is built from running times, the connection buffers
        above and your chosen pace — it deliberately states no departure time, because none of these
        operators publish one this page could stand behind. Use it to decide how many nights to book
        and where; use the operator sites for the clock.</p>
        <div class="days">${rows}</div>
      </section>`
  }

  const TIERS = typeof Plan !== 'undefined' ? Plan.TIERS : ['dorm', 'room', 'comfort']

  const TIER_LABEL = {
    dorm: 'hostel bed',
    room: 'simple private room',
    comfort: 'good mid-range hotel',
  }

  /* What the beds cost, priced where they are actually spent.
   *
   * A regional average would put one figure on Battambang and Singapore, which
   * are a factor of five apart — and the Singapore night is precisely the one
   * worth knowing about before booking rather than after. Three bands rather
   * than one number, because the same journey is a different trip depending on
   * which you take, and both are legitimate. */
  /* Insurance is the one product this audience genuinely needs and is likeliest
   * not to have thought about: a policy written for someone who flew in and out
   * is no use to a person crossing Poipet on foot with an open return. */
  function insuranceLine() {
    if (typeof PARTNERS === 'undefined') return ''
    const p = PARTNERS.insurance
    return (
      `<p class="sub disclosure"><b>Insurance.</b> Most policies assume you arrived by air and ` +
      `leave on a booked date. Whatever you buy, check it covers land borders, ferries and an ` +
      `open-ended trip — several of the cheap ones do not. ` +
      `<a class="stay-book" href="${esc(p.url(p.id))}" target="_blank" ` +
      `rel="sponsored nofollow noopener">${esc(p.name)}</a> is the one we link, because it does; ` +
      `it pays us a commission and it is not the only option.</p>`
    )
  }

  const STAY_COUNTRY = {
    cn: 'China', la: 'Laos', th: 'Thailand', kh: 'Cambodia', vn: 'Vietnam',
    my: 'Malaysia', sg: 'Singapore', bn: 'Brunei', id: 'Indonesia',
    ph: 'Philippines', mm: 'Myanmar',
  }

  /* The figures above are indicative and a year old by the time you read them.
   * A link to real prices on real dates is the natural next thing to want, and
   * this is the one place on the page where a paid link is not in tension with
   * the editorial judgement — no ordering of anything is being sold.
   *
   * rel="sponsored": these are paid links and saying so is both Google's
   * requirement and the honest thing. An undisclosed one is a link-scheme
   * violation, which would cost far more than it earns. */
  function stayLink(network, night) {
    if (typeof PARTNERS === 'undefined' || !night.city) return ''
    const st = network.stations[night.stationId] || {}
    // Named, not just the city: there is a George Town in Malaysia and one in
    // Guyana, and a search that lands in the wrong hemisphere helps nobody.
    const country = STAY_COUNTRY[st.country] || ''
    const href = PARTNERS.booking.url(
      night.city,
      country,
      night.checkin,
      night.checkout,
      PARTNERS.booking.id
    )
    return (
      `<a class="stay-book" href="${esc(href)}" target="_blank"` +
      ` rel="sponsored nofollow noopener">${esc(PARTNERS.booking.label)} in ` +
      `${esc(night.city)}</a>`
    )
  }

  function lodgingSection(network, plan) {
    if (!plan.nights || !plan.nights.length) {
      return plan.totals.sleeperNights
        ? `<section class="block">
             <h2>Where you sleep</h2>
             <p class="sub">Every night on this route is spent moving — ${
               plan.totals.sleeperNights
             } aboard a sleeper, a bed already inside the fare. Nothing to book and nothing to pay.</p>
           </section>`
        : ''
    }

    const tier = plan.stayTier
    const rows = plan.nights
      .map(n => {
        const bands = n.rates
          ? TIERS.map(
              t =>
                `<span class="band ${t === tier ? 'on' : ''}">` +
                `<b>${esc(money(n.rates[t]))}</b><span>${esc(TIER_LABEL[t])}</span></span>`
            ).join('')
          : '<span class="band"><b>—</b><span>no figure recorded</span></span>'
        return `
          <li>
            <div class="stay-head">
              <span class="stay-city"><b>${esc(n.city)}</b> <span class="stay-day">night of day ${n.day}</span></span>
              <span class="stay-price">${esc(money(n.usd ?? 0))}</span>
            </div>
            <div class="bands">${bands}</div>
            ${n.note ? `<p class="stay-note">${esc(n.note)}</p>` : ''}
            ${stayLink(network, n)}
          </li>`
      })
      .join('')

    const sleepers = plan.totals.sleeperNights

    return `
      <section class="block">
        <h2>Where you sleep</h2>
        <p class="sub">Priced where the journey actually stops, not averaged across the region — the
        difference between a night in Siem Reap and a night in Singapore is a factor of five, and it is
        worth seeing before you book. Figures are indicative low-season rates for a room booked a week
        or two out; the totals below use the <b>${esc(TIER_LABEL[tier])}</b> band.${
          sleepers
            ? ` ${sleepers} further ${sleepers === 1 ? 'night is' : 'nights are'} spent aboard, already inside the fare.`
            : ''
        }</p>
        <ul class="stays">${rows}</ul>
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
    const scarce = plan.booking.filter(b => !b.other)
    const rest = plan.booking.filter(b => b.other)

    // The same operator can appear twice — a named scarce service and the
    // operator itself. Say how to buy from them once.
    const noteShown = new Set()
    const row = (b, n) => {
      const showNote = b.operator && b.operator.bookNote && !noteShown.has(b.op)
      if (b.operator) noteShown.add(b.op)
      return `
        <li${b.other ? ' class="other"' : ''}>
          <span class="rank">${b.other ? '·' : n}</span>
          <div>
            <h3>
              ${b.operator ? plate(b.operator) : ''}
              ${esc(b.service || (b.operator ? b.operator.name : MODE_LABEL[b.mode] + ' legs'))}
            </h3>
            ${b.window ? `<p class="window">${esc(b.window)}</p>` : ''}
            ${b.why ? `<p>${esc(b.why)}</p>` : ''}
            ${showNote ? `<p>${esc(b.operator.bookNote)}</p>` : ''}
            ${b.operator ? bookLine(network, b.operator, null) : ''}
          </div>
        </li>`
    }

    const items =
      scarce.map((b, i) => row(b, i + 1)).join('') +
      (rest.length
        ? `<li class="divider"><span></span><p>Everything else on this route, in no
           particular hurry:</p></li>` + rest.map(b => row(b, null)).join('')
        : '')

    return `<section class="block"><h2>Booking sequence</h2>
      <p class="sub">Book in order of scarcity times window length, not in the order you travel.
      The shortest leg on the whole spine sells out first.</p>
      <ol class="booking">${items}</ol>
      <p class="sub foot">Where an operator cannot be booked from abroad — the Laos–China Railway
      above all — an aggregator is the practical route in. They add a fee, and some sell tickets they
      do not yet hold and buy them when inventory opens, which is a genuine cancellation risk on a
      scarce sleeper. Prefer the operator wherever the operator actually works, which is most of the
      time.</p>
      <p class="sub disclosure"><b>No affiliate links on transport.</b> Every booking link above
      goes straight to the operator or aggregator and earns this project nothing. The operator's own
      site is listed first because it is usually cheaper and always more reliable, not because of
      what it pays — that ordering is the most load-bearing judgement on this page and it is not for
      sale. Booking URLs were last reviewed ${esc(network.reviewed)} and are not machine-checked —
      if one is dead, search the operator name rather than trusting a reseller that ranks well.</p>
      <p class="sub disclosure"><b>Where it does earn.</b> The hotel links in “Where you sleep” and
      the insurance link below pay a commission, at no extra cost to you. They are marked as paid
      links. Nothing about them changes a route, a price, or the order of anything: no hotel is
      recommended over another and no leg is routed differently because of them.</p>
      ${insuranceLine()}
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
            <tr><td>Accommodation, ${t.hotelNights} ${
              t.hotelNights === 1 ? 'night' : 'nights'
            }${
              plan.nights && plan.nights.length
                ? ` — ${esc(plan.nights.map(n => `${n.city} ${money(n.usd ?? 0)}`).join(', '))}`
                : ''
            }</td><td class="num-col">${esc(money(t.lodgingUsd))}</td></tr>
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

  function itinerary(network, plan, fromId, toId, opts, ways) {
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

    const labels = opts.labels && opts.labels.from && opts.labels.to ? opts.labels : null
    const art = destinationArt(network, toId, to.city)
    const banner = art
      ? `<div class="banner">${art}<span class="banner-cap">${esc(to.city)}</span></div>`
      : ''

    return `
      ${banner}
      <header class="head">
        <p class="eyebrow">${
          labels
            ? `${esc(from.name)} <span aria-hidden="true">→</span> ${esc(to.name)}`
            : `${esc(opts.railOnly ? 'Hard rail-only' : 'Pragmatic')} routing${
                opts.date ? ` · departing ${esc(opts.date)}` : ''
              }${opts.nationality ? ` · ${esc(opts.nationality)} passport` : ''}`
        }</p>
        <h1>${esc(labels ? labels.from : from.city)} <span aria-hidden="true">→</span> ${esc(
          labels ? labels.to : to.city
        )} overland</h1>
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
      ${waysSection(network, ways, plan)}
      ${routeTable(network, plan)}
      ${clockBlock(network, plan)}
      ${scheduleBlock(network, plan)}
      ${lodgingSection(network, plan)}
      ${borderSection(network, plan)}
      ${risksSection(plan)}
      ${bookingSection(network, plan)}
      ${costSection(network, plan)}
      ${detourSection(plan)}
      ${typeof Photos !== 'undefined' ? Photos.creditBlock(plan.stationIds) : ''}
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

    /* Some pairs fail because the world is like that, not because the data has
     * a hole in it. When one end sits in a country nothing sails to, say so and
     * say why — "no route found" reads as a missing edge, and the difference
     * between a gap in a graph and a suspended ferry is the whole point. */
    const cut =
      network.disconnected?.[to.country] && !network.disconnected[from.country]
        ? { info: network.disconnected[to.country], side: to }
        : network.disconnected?.[from.country] && !network.disconnected[to.country]
          ? { info: network.disconnected[from.country], side: from }
          : null

    if (cut) {
      return `
        <header class="head">
          <p class="eyebrow">Not a gap in the map</p>
          <h1>${esc(from.city)} <span aria-hidden="true">→</span> ${esc(to.city)}</h1>
        </header>
        <div class="callout alert">
          <h3>You cannot reach ${esc(cut.info.name)} overland or by sea</h3>
          <p>${esc(cut.info.why)}</p>
        </div>
        <section class="block">
          <h2>What this planner can do instead</h2>
          <p>${esc(cut.info.inside)}</p>
          ${cut.info.rail ? `<p>${esc(cut.info.rail)}</p>` : ''}
        </section>`
    }

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

  /* The URL a crossing's own page lives at. Defined here rather than in the
     page generator because both need it — the generator to write the file, and
     the list below to link to it — and a slug rule that exists in two places
     is a set of 404s waiting for someone to edit one of them. */
  const borderSlug = id => `${id.replace(/_/g, '-')}-border-crossing`

  function idle(network, presets) {
    const cards = presets
      .map((p, i) => {
        const st = p.stats
        const stats = st
          ? `<span class="corridor-stats">
               <span><b>${st.days}</b>${st.days === 1 ? 'day' : 'days'}</span>
               <span><b>${st.legs}</b>legs</span>
               <span><b>${st.borders}</b>${st.borders === 1 ? 'border' : 'borders'}</span>
               <span><b>${esc(money(st.usd))}</b>all in</span>
             </span>`
          : ''
        // The card was assigned its own photograph in app.js, deduplicated
        // against the others; falling back to the terminus here would undo that.
        const photo =
          typeof Photos !== 'undefined' && p.photoId ? Photos.forId(p.photoId) : null
        const inner = photo
          ? Photos.figure(photo, p.label, p.scene ? { kind: p.scene, seed: p.sceneSeed || p.to } : null)
          : p.scene
            ? `<canvas class="scene" data-scene="${esc(p.scene)}" data-seed="${esc(p.sceneSeed || p.to)}"></canvas>`
            : ''
        const art = inner ? `<span class="corridor-art">${inner}</span>` : ''
        return `<button type="button" class="corridor" data-preset="${i}">
            ${art}
            <span class="corridor-name">${esc(p.label)}<em aria-hidden="true">→</em></span>
            <span class="corridor-note">${esc(p.note)}</span>
            ${stats}
          </button>`
      })
      .join('')

    const myths = network.myths
      .map(m => `<li><span class="belief">${esc(m.belief)}</span><span class="reality">${esc(m.reality)}</span></li>`)
      .join('')

    return `
      <header class="head">
        <p class="eyebrow">Rail-first overland planning</p>
        <h1>Southeast Asia<br>without flying</h1>
        <p class="lede">Every mainstream planner optimises for speed, so it answers
        “Vientiane to Kuala Lumpur” with a flight. This one optimises for continuity on the
        ground: it keeps you on rails as far as the rails go, puts a boat where the land
        ends, and uses a road vehicle only where neither exists.</p>
        <p class="sub">Pick two stations above, or point at anywhere on the map and choose
        whether to start or finish there. Every itinerary comes with the border mechanics, the
        connection buffers that actually hold, and a way to book each leg.</p>
      </header>
      <section class="block">
        <h2>Start from a corridor</h2>
        <div class="chips">${cards}</div>
      </section>
      ${
        typeof GUIDES !== 'undefined' && GUIDES.length
          ? `<section class="block block-web">
        <h2>Routes written up in full</h2>
        <p class="sub">The planner answers any pair on the network. These are the ones asked
        about most often, written out as pages you can read, link to and come back to.</p>
        <ul class="guides">${GUIDES.map(
          g =>
            `<li><a href="/${esc(g.slug)}">${esc(g.h1)}</a><span>${esc(g.summary)}</span></li>`
        ).join('')}</ul>
      </section>`
          : ''
      }
      ${
        Object.keys(network.borders).length
          ? `<section class="block block-web">
        <h2>Border crossings, in detail</h2>
        <p class="sub">Itineraries die at frontiers, not on track. Each of these has its own
        page: where immigration physically is, whether you stay aboard, what your luggage
        does, what cash the far side wants, and the specific trap.</p>
        <ul class="guides">${Object.entries(network.borders)
          .map(
            ([id, b]) =>
              `<li><a href="/${esc(borderSlug(id))}">${esc(b.name)}</a>` +
              `<span>${esc(b.countries)} · about ${b.minutes} min</span></li>`
          )
          .join('')}</ul>
      </section>`
          : ''
      }
      <section class="block">
        <h2>What people get wrong</h2>
        <p class="sub">Travellers arrive with these. All seven are load-bearing — each one has
        stranded somebody.</p>
        <ul class="myths">${myths}</ul>
      </section>
      <footer class="foot-note">
        <p>${esc(network.intro)}</p>
        <p>Network reviewed ${esc(network.reviewed)}. This planner gives you legs, operators,
        border mechanics and connection buffers — deliberately not departure times, because
        SRT, KTMB, LCR, DSVN and KAI publish nothing in a common format and a remembered
        departure is the fastest way to miss a train. Verify live before booking.</p>
        <!-- Absolute, not /privacy: in the app this document is served from an
             internal asset host, where a root-relative link would resolve to a
             page that does not exist inside the package. -->
        <p><a href="https://slowasia.com/privacy" target="_blank" rel="noopener noreferrer">Privacy</a>
        — nothing here is collected, and that page says so in checkable detail.</p>
      </footer>`
  }

  return { itinerary, idle, unreachable, esc, hours, money, MODE_LABEL, borderSlug }
})()
