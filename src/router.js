/* Rail-first routing.
 *
 * The graph is small enough that the algorithm is not the interesting part —
 * plain Dijkstra over ~150 edges. What matters is the cost function, because it
 * encodes the whole thesis of the product: stay on rails as far as the rails
 * go, take a boat where the land ends, and use a road vehicle only where
 * neither exists.
 *
 * A shortest-time router would answer half these queries with a bus. This one
 * charges substitute road time at three and a half times its face value, so it
 * will happily spend an extra six hours on a train to avoid two on a coach —
 * but it charges unavoidable road connectors far less, because penalising a gap
 * nothing can route around just produces absurd detours.
 */

const Router = (() => {
  const MODE_WEIGHT = { rail: 1, ferry: 1.5, road: 3.5 }

  /* An `essential` road leg is a connector with no rail alternative — the bus to
   * the pier, the shuttle over a frontier bridge. The 3.5x penalty exists to
   * stop road *replacing* rail; charging it here instead punishes the traveller
   * for a gap that no routing can avoid, and sends them hundreds of kilometres
   * the wrong way down a railway to dodge a two-hour minivan. */
  const ESSENTIAL_ROAD_WEIGHT = 1.5

  // Every leg carries a fixed penalty so the router doesn't assemble a chain of
  // ten short hops where one longer leg exists.
  const LEG_PENALTY = 0.5

  // Border formalities cost real hours and real risk, so they're weighted above
  // their clock time. Fewer frontiers is genuinely a better itinerary.
  const BORDER_WEIGHT = 1.5

  // The ferry-bridges design principle, made mechanical: when two routings are
  // close on time and cost, prefer the one with the better boat.
  const SCENIC_BONUS = 0.4

  function buildAdjacency(network, opts) {
    const adj = new Map()
    const add = (from, to, leg, reversed) => {
      if (!adj.has(from)) adj.set(from, [])
      adj.get(from).push({ to, leg, reversed })
    }

    for (const leg of network.legs) {
      if (opts.railOnly && leg.mode === 'road' && !leg.essential) continue
      if (opts.avoidAdvisory && leg.advisory) continue
      add(leg.from, leg.to, leg, false)
      add(leg.to, leg.from, leg, true)
    }
    return adj
  }

  /* How much a leg already used by a route found earlier is charged, when
   * looking for a route that is genuinely different rather than the same one
   * with a station swapped. Four is enough to push the search onto another
   * corridor and not so much that it will cross a continent to avoid a
   * connector every sane routing uses. */
  const DETOUR_PENALTY = 4

  /* How much travelling an alternative has to contain that the recommendation
   * does not, before it is a different journey rather than a different train.
   *
   * Measured in hours and not as a fraction, which was the first attempt and
   * was wrong. By fraction the two cases are indistinguishable: Singapore to
   * Kuala Lumpur routed via Seremban instead of Tampin is 47% new, and Bangkok
   * to Singapore down the Jungle Railway instead of the west coast is 51%. One
   * is padding and the other is the reason somebody makes the trip. In hours
   * they are 2.2 and 18.3, and the difference is obvious — because what makes
   * a journey different is how much of it is different, not what share of a
   * short trip a short detour happens to be.
   *
   * Six is half a waking day of travelling. Below it the two routings are the
   * same plan with a change of train somewhere in the middle. */
  const MIN_UNIQUE_HOURS = 6

  /* And a ceiling on sameness regardless, for the case where an alternative is
   * genuinely long but almost entirely retraces the recommendation. */
  const MAX_SHARE = 0.9

  /* And past this much worse than the recommendation, it is not an alternative
   * — it is a different holiday. Without a ceiling the search will always find
   * something, so Woodlands to Singapore, half an hour on the MRT, came back
   * offering three days through Sumatra at twenty-five times the cost. Two
   * and a bit is wide enough for the real ones: the Sumatran coach chain
   * against the Jakarta ship is 1.6. */
  const MAX_WORSE = 2.2

  function edgeCost(network, leg, opts, penalty) {
    const weight =
      leg.mode === 'road' && leg.essential
        ? ESSENTIAL_ROAD_WEIGHT
        : (MODE_WEIGHT[leg.mode] ?? 1)
    let cost = leg.hours * weight + LEG_PENALTY

    if (leg.border) {
      const border = network.borders[leg.border]
      if (border) cost += ((border.minutes ?? 60) / 60) * BORDER_WEIGHT
    }
    if (leg.scenic && opts.preferScenic !== false) cost -= SCENIC_BONUS
    if (leg.confidence === 'verify') cost += 1.5 // prefer legs we can stand behind

    cost = Math.max(0.1, cost)
    // Applied last and to the finished figure, so a leg that was nearly free
    // is still discouraged rather than staying nearly free.
    if (penalty) cost *= penalty.get(leg) ?? 1
    return cost
  }

  /**
   * @returns {{path: object[], stations: string[]} | null}
   *          path is an ordered list of {leg, from, to} in travel direction.
   */
  function route(network, fromId, toId, opts = {}, penalty = null) {
    if (fromId === toId) return null
    if (!network.stations[fromId] || !network.stations[toId]) return null

    const adj = buildAdjacency(network, opts)
    const dist = new Map([[fromId, 0]])
    const prev = new Map()
    const done = new Set()

    // A binary heap would be overkill at this size; linear scan is clearer.
    const queue = new Set([fromId])

    while (queue.size) {
      let current = null
      let best = Infinity
      for (const id of queue) {
        const d = dist.get(id) ?? Infinity
        if (d < best) {
          best = d
          current = id
        }
      }
      if (current === null) break
      queue.delete(current)
      done.add(current)
      if (current === toId) break

      for (const edge of adj.get(current) ?? []) {
        if (done.has(edge.to)) continue
        const next = best + edgeCost(network, edge.leg, opts, penalty)
        if (next < (dist.get(edge.to) ?? Infinity)) {
          dist.set(edge.to, next)
          prev.set(edge.to, { from: current, edge })
          queue.add(edge.to)
        }
      }
    }

    if (!prev.has(toId) && fromId !== toId) return null

    const path = []
    let cursor = toId
    while (cursor !== fromId) {
      const step = prev.get(cursor)
      if (!step) return null
      path.unshift({
        leg: step.edge.leg,
        from: step.from,
        to: cursor,
        reversed: step.edge.reversed,
      })
      cursor = step.from
    }

    return { path, stations: [fromId, ...path.map(s => s.to)] }
  }

  /* The other ways round.
   *
   * One answer is the right default — a planner that opens with four options is
   * asking the reader to do the work it was built to do. But one answer is
   * wrong whenever the reader knows something the cost function does not: that
   * they have a week rather than four days, that the weekly boat sails
   * tomorrow, that they have already seen Sumatra. The complaint that produced
   * this was exactly that shape — a real ship the router had no edge for, and a
   * reader who could see it was missing.
   *
   * Not Yen's algorithm, which is the textbook answer and the wrong one here:
   * its k-shortest paths differ by a station at a time, so the second, third
   * and fourth are the first with a stop moved. This charges every leg an
   * earlier answer used, which pushes the search onto a different corridor
   * instead, and then throws away anything that still overlaps too much. What
   * comes back is two or three genuinely different journeys, or nothing —
   * nothing being the honest answer when the map only offers one way.
   *
   * Each is costed as if it had never been penalised, so the figures shown
   * against it are the real ones.
   */
  function alternatives(network, fromId, toId, opts = {}, want = 2) {
    const best = route(network, fromId, toId, opts)
    if (!best) return []

    const trueCost = r =>
      r.path.reduce((n, s) => n + edgeCost(network, s.leg, opts, null), 0)
    const hoursOf = r => r.path.reduce((n, s) => n + (s.leg.hours || 0), 0)
    // The stations, not the legs: joining leg objects gives a row of
    // [object Object] and every path of the same length collides.
    const key = r => r.stations.join('>')

    /* Hours in `a` that `b` does not contain. The whole test of whether two
       routings are different journeys. */
    const uniqueHours = (a, b) => {
      const setB = new Set(b.path.map(s => s.leg))
      return a.path
        .filter(s => !setB.has(s.leg))
        .reduce((n, s) => n + (s.leg.hours || 0), 0)
    }

    /* Shared travelling time as a fraction of the shorter of the two, not of
       either one in particular: a long way round that contains the whole of a
       short one is the short one plus a detour, and saying so needs the small
       denominator. */
    const share = (a, b) => {
      const setB = new Set(b.path.map(s => s.leg))
      const shared = a.path
        .filter(s => setB.has(s.leg))
        .reduce((n, s) => n + (s.leg.hours || 0), 0)
      const floor = Math.min(hoursOf(a), hoursOf(b))
      return floor ? shared / floor : 1
    }

    const different = (a, b) => uniqueHours(a, b) >= MIN_UNIQUE_HOURS && share(a, b) <= MAX_SHARE

    const penalty = new Map()
    const charge = r => {
      for (const s of r.path) penalty.set(s.leg, (penalty.get(s.leg) ?? 1) * DETOUR_PENALTY)
    }
    charge(best)

    const kept = []
    const seen = new Set([key(best)])
    /* Bounded rather than looping until it finds enough: on a corridor with
       genuinely one way through, every round returns the same path and the
       loop would never end. Twice what is wanted, plus one. */
    for (let round = 0; round < want * 2 + 1 && kept.length < want; round++) {
      const next = route(network, fromId, toId, opts, penalty)
      if (!next || !next.path.length) break
      charge(next)
      if (seen.has(key(next))) continue
      seen.add(key(next))
      if (!different(next, best)) continue
      if (kept.some(k => !different(next, k))) continue
      if (trueCost(next) / trueCost(best) > MAX_WORSE) continue
      kept.push(next)
    }

    const baseline = trueCost(best)
    return kept.map(r => ({
      ...r,
      // Ranked against the recommendation rather than each other, because the
      // question a reader is asking is "what does this cost me over the one
      // you picked?"
      worseBy: trueCost(r) / baseline,
    }))
  }

  /** Which stations are reachable at all — used to explain a failed route. */
  function reachable(network, fromId, opts = {}) {
    const adj = buildAdjacency(network, opts)
    const seen = new Set([fromId])
    const stack = [fromId]
    while (stack.length) {
      const id = stack.pop()
      for (const edge of adj.get(id) ?? []) {
        if (!seen.has(edge.to)) {
          seen.add(edge.to)
          stack.push(edge.to)
        }
      }
    }
    return seen
  }

  return { route, alternatives, reachable, MODE_WEIGHT }
})()
