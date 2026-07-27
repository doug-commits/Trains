/* Turning a path through the graph into an itinerary you could defend.
 *
 * A route that exists on paper is not an itinerary. This module applies the
 * connection buffers, punctuality realities, seasonality and border mechanics
 * that decide whether the thing actually works — and it deliberately refuses to
 * invent departure times, because the operators share no timetable and a
 * remembered departure is how a traveller ends up stranded at Padang Besar.
 */

const Plan = (() => {
  const UTC_OFFSET = { cn: 8, la: 7, th: 7, kh: 7, vn: 7, my: 8, sg: 8, bn: 8, id: 7, ph: 8, mm: 6.5 }
  // Indonesia spans three zones; Bali is WITA, an hour ahead of Java.
  const TZ_OVERRIDE = { denpasar: 8, gilimanuk: 8, banyuwangi: 7, kotakinabalu: 8, tenom: 8 }

  const PACE_HOURS = { relaxed: 8, standard: 12, fast: 16 }
  const HOTEL_USD = 35

  // Worthwhile diversions, keyed by a station the route already passes through.
  const DETOURS = {
    butterworth: {
      title: 'The Penang ferry into George Town',
      cost: '+1 night, ~$2',
      text: 'The boat berths beside the KTMB station. Step off the ETS, walk onto the ferry, and arrive in George Town by water — the single cheapest upgrade on the whole spine.',
    },
    hatyai: {
      title: 'Break the journey at Hat Yai',
      cost: '+1 night, ~$25',
      text: 'Not a beauty spot, but the single most effective de-risking move on the spine. SRT southbound routinely runs 30 to 90 minutes late, and it is this arrival that feeds the Padang Besar connection. A night here converts a connection you might miss into one you cannot.',
    },
    arau: {
      title: 'Langkawi, from Arau',
      cost: '+2 nights, ~$15',
      text: 'Taxi to Kuala Perlis, ferry to Langkawi. It puts a genuine rest day right at the Thai–Malaysian border, which is exactly where a long spine journey needs one — and it de-risks the Padang Besar connection by removing the pressure to make it on a fixed day.',
    },
    suratthani: {
      title: 'Koh Samui, from Phun Phin',
      cost: '+2 nights, ~$12',
      text: 'Connecting bus to Donsak pier, then the Raja or Seatran ferry. Combined train-bus-ferry tickets are widely sold. Gulf side — check the October to December monsoon.',
    },
    gemas: {
      title: 'The Jungle Railway north from Gemas',
      cost: '+2 days, ~$12',
      text: 'The Shuttle Timuran up the East Coast Line to Kuala Lipis and Wakaf Baharu. Slow, scenic, cult status. Take it because the journey is the point, not to get anywhere.',
    },
    chumphon: {
      title: 'Koh Tao and Koh Phangan, straight off the train',
      cost: '+2 nights, ~$30',
      text: 'The Lomprayah catamarans leave from a pier a short transfer from Chumphon station and are timed off the overnight trains from Bangkok. Of all the rail-to-island links in Thailand this is the least friction — you step off a sleeper and onto a boat.',
    },
    sisophon: {
      title: 'Angkor, from Sisophon',
      cost: '+2 nights, ~$12',
      text: 'Two hours by road from the railhead at Sisophon. Angkor has no railway and never will, so this road leg is the price of the single best reason to be in Cambodia.',
    },
    saigon: {
      title: 'Take the Mekong to Phnom Penh instead of the bus',
      cost: '+1 night, ~$35',
      text: 'Coach to Châu Đốc, then a river boat up the Mekong with immigration on the riverbank at Vĩnh Xương. It is slower and dearer than the direct coach, and it is the only Vietnam–Cambodia crossing that is not a road.',
    },
    haiphong: {
      title: 'Hạ Long Bay via Cát Bà',
      cost: '+2 nights',
      text: 'An hour by fast ferry from Hải Phòng, which is itself a two-and-a-half hour train from Hanoi. Reaching the bay by rail and boat rather than a tour coach is both nicer and cheaper.',
    },
    hue: {
      title: 'Ride Huế to Đà Nẵng in daylight',
      cost: '+0 nights',
      text: 'The Hải Vân pass is among the best rail scenery in Asia and it is wasted at night. Sit on the sea side and take a daytime train even if it costs you a connection.',
    },
    luangprabang: {
      title: 'Break at Luang Prabang',
      cost: '+2 nights',
      text: 'Two hours from Vientiane on the LCR and the most rewarding stop on the northern half. The scarce inventory is the reason to book it early, not a reason to skip it.',
    },
    bkk_thonburi: {
      title: 'The Death Railway to Nam Tok',
      cost: '+1 day, ~$5',
      text: 'From Bangkok Thonburi via Kanchanaburi. The Wampo viaduct clinging to the cliff above the river is the reason to go.',
    },
    semarang: {
      title: 'Swap the north coast for Bandung and Yogyakarta',
      cost: '+2 hours moving, +2 nights',
      text: 'The router picked the north-coast line through Semarang because it is the quicker way across Java. The southern route — Whoosh to Bandung, then the Argo Wilis through the hills to Purwokerto and Yogyakarta — is slower, prettier, and puts you within reach of Borobudur and Prambanan. On a journey taken deliberately by land, that is usually the better trade.',
    },
    solo: {
      title: 'Borobudur and Prambanan from Yogyakarta',
      cost: '+2 nights',
      text: 'You are already passing through. Yogyakarta is an hour back down the line from Solo and is the reason most people stop on Java at all.',
    },
    cebu: {
      title: 'Bohol, an hour and a half from the pier',
      cost: '+2 nights, ~$24',
      text: 'OceanJet runs Cebu to Tagbilaran most of the day. Chocolate Hills, the Loboc river and Panglao\'s beaches are all inside a day of the port, and Siquijor is one more boat beyond. If you are passing through Cebu at all, this is the cheapest good decision available.',
    },
    legazpi: {
      title: 'Ride the last intercity train in the Philippines',
      cost: '+1 day, ~$3',
      text: 'PNR still works a shuttle between Legazpi, Naga and Sipocot — the only intercity passenger service left in the country, running beside Mayon for the last half hour. It suspends and resumes, so confirm it the week you travel. Take it because it is the train, not because it is the quicker way; the bus is faster.',
    },
    matnog: {
      title: 'Stay on the Nautical Highway rather than fly over it',
      cost: '+0 nights',
      text: 'You are at the ramp for the crossing the whole Strong Republic Nautical Highway is built around — Luzon to Samar, and from there a through bus ticket runs all the way to Davao. Sail in daylight if you can choose: the strait is short and the view of Bulusan going astern is the reason to be on deck.',
    },
    banyuwangi: {
      title: 'Take the dawn crossing to Bali',
      cost: '+0 nights',
      text: 'The Ketapang–Gilimanuk ferry runs around the clock, so you can choose your moment. Choose first light.',
    },
  }

  const clone = obj => JSON.parse(JSON.stringify(obj))

  function tzOf(network, stationId) {
    if (TZ_OVERRIDE[stationId] != null) return TZ_OVERRIDE[stationId]
    return UTC_OFFSET[network.stations[stationId].country] ?? 7
  }

  /* ------------------------------------------------------- merging legs
   * The graph stores station-to-station segments, but a leg is one vehicle:
   * one operator, one service, one continuous ride. Padang Besar to KL Sentral
   * is a single ETS you book once, not five hops — and presenting it as five
   * would invent four connections that do not exist and bury the two that do.
   */
  function mergeSegments(network, path) {
    const runs = []
    for (const step of path) {
      const leg = step.leg
      const open = runs[runs.length - 1]
      const sameVehicle =
        open && open.op === leg.op && open.mode === leg.mode && open.service === leg.service
      if (sameVehicle) open.steps.push(step)
      else runs.push({ op: leg.op, mode: leg.mode, service: leg.service, steps: [step] })
    }

    return runs.map(run => {
      const parts = run.steps.map(s => s.leg)
      const first = parts[0]
      const last = parts[parts.length - 1]
      const confidence = parts.some(l => l.confidence === 'verify')
        ? 'verify'
        : parts.some(l => l.confidence === 'reported')
          ? 'reported'
          : 'structural'

      return {
        mode: run.mode,
        op: run.op,
        service: run.service,
        // Round away binary-float noise; these are indicative times anyway.
        hours: Math.round(parts.reduce((n, l) => n + l.hours, 0) * 100) / 100,
        usd: Math.round(parts.reduce((n, l) => n + (l.usd ?? 0), 0) * 100) / 100,
        cls: parts.find(l => l.cls)?.cls,
        sleeper: parts.some(l => l.sleeper),
        scenic: parts.some(l => l.scenic),
        essential: parts.every(l => l.essential),
        advisory: parts.find(l => l.advisory)?.advisory,
        seasonal: [...new Set(parts.map(l => l.seasonal).filter(Boolean))],
        /* How often the thing runs. Recorded on whichever segment of a run we
         * know it for — the frequency of a through train belongs to the train,
         * not to each station pair it passes. Absent means unrecorded, and the
         * page says so rather than inventing a number. */
        daily: parts.find(l => l.daily)?.daily || null,
        confidence,
        note: [...new Set(parts.map(l => l.note).filter(Boolean))].join(' '),
        borderIds: parts.map(l => l.border).filter(Boolean),
        // Only a frontier at the very start or end of a run governs the buffer
        // at that junction; one in the middle is crossed aboard the train.
        borderAtStart: first.border || null,
        borderAtEnd: last.border || null,
        steps: run.steps.map(s => ({ from: s.from, to: s.to, mode: run.mode, border: s.leg.border || null })),
      }
    })
  }

  /* ------------------------------------------------------------- buffers
   * Every junction gets the largest applicable minimum from the rulebook.
   * If the traveller's real gap is smaller than this, it is not a connection.
   */
  function bufferFor(network, prev, next) {
    const rules = []
    const prevLeg = prev.leg
    const nextLeg = next.leg

    // Call it a terminal when a boat is involved; "same station" reads wrong
    // at a pier and undermines trust in everything around it.
    const place =
      prevLeg.mode === 'ferry' || nextLeg.mode === 'ferry' ? 'terminal' : 'station'

    const shortTransfer = nextLeg.essential && nextLeg.mode === 'road' && nextLeg.hours <= 1

    rules.push(
      shortTransfer
        ? { minutes: 30, rule: 'Step off and walk to the connecting transport' }
        : prevLeg.op === nextLeg.op
          ? { minutes: 30, rule: `Same ${place}, same operator, seat to seat` }
          : {
              minutes: 90,
              rule: `Same ${place}, different operators — no through ticketing, no held connection`,
            }
    )

    if (nextLeg.mode === 'ferry') {
      const label =
        prevLeg.mode === 'road'
          ? 'Onward ferry reached by road transfer'
          : prevLeg.mode === 'ferry'
            ? 'Ferry to ferry at the same terminal'
            : 'Rail to ferry in the same town'
      rules.push({ minutes: prevLeg.mode === 'road' ? 240 : 120, rule: label })
    }

    const border = network.borders[nextLeg.borderAtStart] || network.borders[prevLeg.borderAtEnd]
    if (border) {
      const onFoot = (border.minutes ?? 60) >= 180
      const bothRail = prevLeg.mode === 'rail' && nextLeg.mode === 'rail'
      rules.push({
        minutes: onFoot ? 240 : 120,
        rule: onFoot
          ? 'International border crossed on foot'
          : bothRail
            ? 'International border with a change of train'
            : 'International border with a change of vehicle',
      })
    }

    // The Vientiane problem: two railways, two gauges, fifteen kilometres and
    // no track between them.
    const a = network.stations[next.fromId]
    const b = network.stations[next.toId]
    if (
      nextLeg.essential &&
      nextLeg.mode === 'road' &&
      a && b &&
      a.city === b.city &&
      a.gauge && b.gauge &&
      a.gauge !== b.gauge
    ) {
      rules.push({ minutes: 180, rule: 'Cross-city transfer between two unconnected stations' })
    }

    if (prevLeg.sleeper && prevLeg.hours >= 7) {
      rules.push({ minutes: 120, rule: 'Arriving off a sleeper onto a long-distance departure' })
    }

    const governing = rules.reduce((m, r) => (r.minutes > m.minutes ? r : m), rules[0])
    const chained = prevLeg.sleeper && nextLeg.sleeper && prevLeg.hours >= 7 && nextLeg.hours >= 7

    return {
      minutes: governing.minutes,
      rule: governing.rule,
      chainedSleepers: chained,
      unpunctual: network.operators[prevLeg.op]?.punctual === 'poor',
    }
  }

  /* ---------------------------------------------------------- seasonality */
  /* A season only matters if the route actually enters a country it hits.
   * Without the country test, Philippine typhoon season — six months long —
   * would headline a Bangkok–Singapore itinerary that never leaves the
   * mainland, and a warning that fires on everything gets read as noise. */
  function seasonHits(network, dateStr, countries) {
    if (!dateStr) return []
    const md = dateStr.slice(5, 10)
    const on = new Set(countries)
    return network.seasons.filter(s => {
      // Ranges here never wrap the year end, so a plain string compare is safe.
      if (md < s.from || md > s.to) return false
      return !s.hits || s.hits.some(c => on.has(c))
    })
  }

  function countriesOn(network, stationIds) {
    return [...new Set(stationIds.map(id => network.stations[id].country))]
  }

  /* --------------------------------------------------------------- costs */
  function flightComparison(network, fromId, toId) {
    const a = network.stations[fromId]
    const b = network.stations[toId]
    const km = Proj.haversine(a, b)
    // Cruise plus taxi, climb and descent — gate to gate, not airport to
    // airport, and deliberately not counting the two hours before the gate.
    const hours = km / 800 + 0.75
    const mid = 45 + km * 0.055
    return {
      km: Math.round(km),
      hours,
      low: Math.round(mid * 0.65),
      high: Math.round(mid * 1.35),
    }
  }

  const listOf = xs =>
    xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`

  /* What to actually do about each advisory. The generic fallback tells people
   * to read their own government's advice; these say where the way round is. */
  const ADVISORY_FIX = {
    deepsouth: 'Check your own government\'s current travel advice and decide deliberately. There is a west-coast alternative via Padang Besar that avoids this entirely.',
    myanmar: 'Check your own government\'s current travel advice. There is no through rail here in any case, so nothing is lost by leaving it out.',
    sulu: 'Check what your government says about the specific provinces rather than about Mindanao as a whole. The Nautical Highway corridor through Surigao, Cagayan de Oro and Davao is a different proposition from the Zamboanga peninsula, and reaching Zamboanga by sea from Manila or Iloilo skips the road entirely.',
  }

  /* ------------------------------------------------------- the day plan
   * The nearest thing to a schedule this project will produce, and the line it
   * will not cross is departure times. Nobody publishes them in a common
   * format, so a stated departure would be a remembered one, and a remembered
   * departure is how somebody sleeps on a platform.
   *
   * What can be said honestly is shape: which legs fall on which day, how many
   * hours each day costs, and where the night goes — aboard a sleeper or in a
   * bed. That comes out of running times, connection buffers and the chosen
   * pace, all of which are ours to compute rather than to recall.
   */
  function buildDays(legs, junctions, paceHours) {
    const days = []
    let open = null

    const start = () => {
      open = { n: days.length + 1, legs: [], hours: 0, night: null, nightAt: null }
      days.push(open)
    }

    legs.forEach((entry, i) => {
      const leg = entry.leg
      // An overnight sleeper is not part of a day, it *is* the night.
      const overnight = leg.sleeper && leg.hours >= 7
      const buffer = (junctions[i]?.minutes ?? 0) / 60

      if (!open) start()
      // Starting a leg that would blow through the pace means starting it
      // tomorrow instead — unless nothing has happened today yet, in which case
      // it is simply a long day and saying otherwise would be a fiction.
      else if (!overnight && open.legs.length && open.hours + leg.hours > paceHours) start()

      open.legs.push(i)
      open.hours += leg.hours + buffer

      if (overnight) {
        open.night = 'sleeper'
        open.nightAt = entry.leg.service
        open.nightAtId = null
        open = null
      }
    })

    // Every night between days that is not spent moving is spent in a bed.
    days.forEach((d, i) => {
      if (i === days.length - 1) return
      if (d.night) return
      d.night = 'hotel'
      const lastLeg = legs[d.legs[d.legs.length - 1]]
      d.nightAt = lastLeg ? lastLeg.toCity : null
      // Kept so the night can be priced where it is actually spent.
      d.nightAtId = lastLeg ? lastLeg.toId : null
    })

    /* Boarding an overnight is not arriving. Manila to Cebu is one 22-hour
     * sailing, and calling that "1 day" tells someone they can land and make a
     * connection the same evening. You get off the next morning, so the next
     * morning gets a card. */
    const last = days[days.length - 1]
    if (last && last.night === 'sleeper') {
      const arriveAt = legs[legs.length - 1]
      days.push({
        n: days.length + 1,
        legs: [],
        hours: 0,
        night: null,
        nightAt: null,
        arriveAt: arriveAt ? arriveAt.toCity : null,
      })
    }

    return days
  }

  /* ------------------------------------------------------------ lodging
   * Nights priced where they are actually spent. A regional average would put
   * the same figure on Battambang and Singapore, which are a factor of five
   * apart — and the Singapore night is exactly the one somebody should be
   * warned about before they book it rather than after.
   */
  const TIERS = ['dorm', 'room', 'comfort']

  function ratesFor(network, stationId) {
    const table = network.lodging
    if (!table) return null
    const specific = table.byStation[stationId]
    if (specific) return specific
    const st = network.stations[stationId]
    return (st && table.byCountry[st.country]) || null
  }

  function buildNights(network, schedule, tier) {
    const nights = []
    for (const day of schedule) {
      if (day.night !== 'hotel' || !day.nightAtId) continue
      const rates = ratesFor(network, day.nightAtId)
      nights.push({
        day: day.n,
        stationId: day.nightAtId,
        city: day.nightAt,
        rates,
        usd: rates ? rates[tier] : null,
        note: rates && rates.note ? rates.note : null,
      })
    }
    return nights
  }

  /* -------------------------------------------------------------- risks */
  function buildRisks(network, legs, junctions, seasons, opts) {
    const risks = []
    const seenBorders = new Set()

    for (const s of seasons) {
      // Name the legs that actually carry this season, so the warning points at
      // something instead of hanging over the whole itinerary.
      const exposed = legs.filter(e => e.seasonal?.includes(s.id))
      const named = exposed.length
        ? ` On this route it lands on ${listOf(exposed.map(e => `${e.fromName} – ${e.toName}`))}.`
        : ''
      risks.push({
        severity: 'critical',
        title: `Your dates fall in ${s.name}`,
        text:
          s.text +
          (s.fixed ? '' : ' These dates move each year — the window shown here is approximate.') +
          named,
        fix: exposed.length
          ? 'Leave a spare day either side of those crossings rather than connecting straight through them, and do not put the last one before a flight home.'
          : 'Move the trip by a week either side if you possibly can. If you cannot, book the moment every window opens and accept that some legs will be unobtainable in your preferred class.',
      })
    }

    legs.forEach((entry, i) => {
      const leg = entry.leg

      if (leg.advisory) {
        risks.push({
          severity: 'critical',
          title: `Security advisory on the ${entry.fromName} – ${entry.toName} leg`,
          text: network.advisories[leg.advisory],
          fix: ADVISORY_FIX[leg.advisory] || 'Check your own government\'s current travel advice for this specific route and decide deliberately.',
          legIndex: i,
        })
      }

      for (const borderId of leg.borderIds) {
        const border = network.borders[borderId]
        if (!border || seenBorders.has(borderId)) continue
        seenBorders.add(borderId)
        if (border.hard) {
          risks.push({
            severity: 'critical',
            title: `${border.name} needs a visa you cannot get at the border`,
            text: border.visa + ' ' + border.trap,
            fix: 'Obtain the visa before you leave. If you cannot, this half of the route is closed to you and the itinerary should be replanned to stop short of the frontier.',
            legIndex: i,
          })
        } else if (border.verify) {
          risks.push({
            severity: 'caution',
            title: `${border.name} has a moving part`,
            text: border.verifyNote || border.trap,
            fix: 'Confirm the current position before you book anything that depends on it.',
            legIndex: i,
          })
        }
      }

      if (leg.confidence === 'verify') {
        risks.push({
          severity: 'caution',
          title: `${entry.fromName} to ${entry.toName} is not a service we can stand behind`,
          text: leg.note || 'This service has a history of changing, suspending or running on limited days.',
          fix: 'Verify it is running on your date before you build the rest of the itinerary around it.',
          legIndex: i,
        })
      }

      if (leg.mode === 'ferry' && !leg.essential) {
        risks.push({
          severity: 'note',
          title: `The ${entry.fromName} – ${entry.toName} boat is weather-dependent`,
          text: 'Ferries are cancelled rather than delayed, and a cancellation costs a day rather than an afternoon.',
          fix: 'Never make this crossing the only path to a fixed commitment. Leave a slack day between it and any flight home.',
          legIndex: i,
        })
      }
    })

    junctions.forEach(j => {
      if (j.chainedSleepers) {
        risks.push({
          severity: 'caution',
          title: `Two sleepers back to back at ${j.stationName}`,
          text: 'Chaining overnight trains looks efficient on paper and is punishing in practice. Two nights of broken sleep with a border in between is how people abandon an itinerary halfway.',
          fix: 'Insert a hotel night here. It costs one night and rescues the rest of the trip.',
        })
      } else if (j.minutes >= 180) {
        risks.push({
          severity: 'caution',
          title: `${j.stationName} needs ${Math.round(j.minutes / 60)} hours, not a connection`,
          text: `${j.rule}. A gap smaller than this is not a connection — it is a missed train with a plausible-looking timetable behind it.`,
          fix: j.minutes >= 240
            ? 'Plan an overnight stop here rather than trying to make it in one day.'
            : 'Allow the full window, and prefer a later onward service over the tightest one that appears to work.',
        })
      } else if (j.unpunctual && j.minutes >= 120) {
        risks.push({
          severity: 'caution',
          title: `${j.stationName} depends on an SRT arrival being roughly on time`,
          text: 'SRT long-distance services routinely run 30 to 90 minutes late, and southbound to Hat Yai is the worst offender. It is the arrival that feeds this connection.',
          fix: 'Take the later onward departure, not the first one that appears to connect. An overnight in Hat Yai removes the problem entirely.',
        })
      }
    })

    if (opts.railOnly) {
      const forced = legs.filter(e => e.leg.mode === 'road')
      if (forced.length) {
        risks.push({
          severity: 'note',
          title: `${forced.length} road ${forced.length === 1 ? 'leg is' : 'legs are'} unavoidable even in rail-only mode`,
          text: 'These are station transfers and pier shuttles with no rail alternative — a taxi across Vientiane, a walk between two railheads at a border. Excluding them would not route around the gap; it would just make the journey impossible.',
          fix: 'None needed. They are part of the rail journey, not a substitute for it.',
        })
      }
    }

    const order = { critical: 0, caution: 1, note: 2 }
    return risks.sort((a, b) => order[a.severity] - order[b.severity])
  }

  /* ------------------------------------------------------- booking order */
  function bookingOrder(network, legs) {
    const usedOps = new Set(legs.map(e => e.leg.op))
    const usedModes = new Set(legs.map(e => e.leg.mode))
    const usedServices = new Set(legs.map(e => e.leg.service))
    const out = []

    for (const item of network.scarcity) {
      // Rows key on either a specific operator or a whole mode.
      if (item.op && !usedOps.has(item.op)) continue
      if (item.mode && !usedModes.has(item.mode)) continue
      // A row about booking coaches ahead is noise on a route whose only road
      // leg is a metro ride to the hotel.
      if (item.mode === 'road' && !legs.some(e => e.leg.mode === 'road' && !e.leg.essential)) continue
      if (item.service && ![...usedServices].some(s => s && s.includes(item.service))) continue
      out.push({ ...item, operator: item.op ? network.operators[item.op] : null })
    }

    // Everything else the traveller has to buy, so no leg is left without a
    // route to a ticket.
    const covered = new Set(out.filter(o => o.op).map(o => o.op))
    const others = [...usedOps]
      .filter(op => !covered.has(op))
      .map(op => ({ op, operator: network.operators[op], rank: 99, other: true }))
      .sort((a, b) => a.operator.name.localeCompare(b.operator.name))

    return [...out.sort((a, b) => a.rank - b.rank), ...others]
  }

  /* --------------------------------------------------------------- build */
  function build(network, routed, opts = {}) {
    const legs = mergeSegments(network, routed.path).map(leg => {
      const fromId = leg.steps[0].from
      const toId = leg.steps[leg.steps.length - 1].to
      const from = network.stations[fromId]
      const to = network.stations[toId]
      const via = [...new Set(leg.steps.slice(0, -1).map(s => network.stations[s.to].city))].filter(
        c => c !== from.city && c !== to.city
      )
      return {
        leg,
        fromId,
        toId,
        via,
        fromName: from.name,
        toName: to.name,
        fromCity: from.city,
        toCity: to.city,
        operator: network.operators[leg.op],
      }
    })

    const junctions = []
    for (let i = 0; i < legs.length - 1; i++) {
      const buf = bufferFor(network, legs[i], legs[i + 1])
      junctions.push({
        ...buf,
        afterLeg: i,
        stationId: legs[i].toId,
        stationName: legs[i].toName,
      })
    }

    const railHours = legs.filter(e => e.leg.mode === 'rail').reduce((n, e) => n + e.leg.hours, 0)
    const seaHours = legs.filter(e => e.leg.mode === 'ferry').reduce((n, e) => n + e.leg.hours, 0)
    const roadHours = legs.filter(e => e.leg.mode === 'road').reduce((n, e) => n + e.leg.hours, 0)
    const bufferHours = junctions.reduce((n, j) => n + j.minutes / 60, 0)
    const movingHours = railHours + seaHours + roadHours + bufferHours

    const pace = PACE_HOURS[opts.pace] ?? PACE_HOURS.standard
    /* Day count comes from the day plan rather than dividing total hours by the
     * pace. The two used to disagree — a route with one 22-hour ferry rounded
     * to two days while the schedule below plainly showed three. */
    const schedule = buildDays(legs, junctions, pace)
    const days = schedule.length
    const sleeperNights = schedule.filter(d => d.night === 'sleeper').length
    const hotelNights = schedule.filter(d => d.night === 'hotel').length

    const tier = TIERS.includes(opts.stay) ? opts.stay : 'room'
    const nights = buildNights(network, schedule, tier)

    const transportUsd = legs.reduce((n, e) => n + (e.leg.usd ?? 0), 0)
    const lodgingUsd = nights.reduce((n, x) => n + (x.usd ?? HOTEL_USD), 0)

    const stationIds = routed.stations
    const stopIds = [legs[0].fromId, ...legs.map(e => e.toId)]

    const borders = []
    const seen = new Set()
    for (const entry of legs) {
      for (const id of entry.leg.borderIds) {
        if (seen.has(id)) continue
        seen.add(id)
        borders.push({ ...network.borders[id], id, atLeg: entry })
      }
    }

    const zones = [...new Set(stationIds.map(id => tzOf(network, id)))].sort((a, b) => a - b)
    const countries = countriesOn(network, stationIds)
    const seasons = seasonHits(network, opts.date, countries)

    const detours = Object.entries(DETOURS)
      .filter(([id]) => stationIds.includes(id))
      .map(([id, d]) => ({ ...d, stationId: id }))

    const verifyCount = legs.filter(e => e.leg.confidence === 'verify').length

    return {
      legs,
      junctions,
      borders,
      stationIds,
      stopIds,
      countries,
      zones,
      seasons,
      detours,
      schedule,
      nights,
      stayTier: tier,
      risks: buildRisks(network, legs, junctions, seasons, opts),
      booking: bookingOrder(network, legs),
      totals: {
        railHours,
        seaHours,
        roadHours,
        bufferHours,
        movingHours,
        days,
        sleeperNights,
        hotelNights,
        transportUsd,
        lodgingUsd,
        totalUsd: transportUsd + lodgingUsd,
        borders: borders.length,
        legs: legs.length,
        verifyCount,
      },
      flight: flightComparison(network, stationIds[0], stationIds[stationIds.length - 1]),
      opts,
    }
  }

  return { build, bufferFor, seasonHits, ratesFor, DETOURS, TIERS, HOTEL_USD, clone }
})()
