/* Rail-first routing.
 *
 * The graph is small enough that the algorithm is not the interesting part —
 * plain Dijkstra over ~90 edges. What matters is the cost function, because it
 * encodes the whole thesis of the product: stay on rails as far as the rails
 * go, take a boat where the land ends, and use a road vehicle only where
 * neither exists.
 *
 * A shortest-time router would answer half these queries with a bus. This one
 * charges road time at three and a half times its face value, so it will
 * happily spend an extra six hours on a train to avoid two on a coach.
 */

const Router = (() => {
  const MODE_WEIGHT = { rail: 1, ferry: 1.5, road: 3.5 }

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

  function edgeCost(network, leg, opts) {
    let cost = leg.hours * (MODE_WEIGHT[leg.mode] ?? 1) + LEG_PENALTY

    if (leg.border) {
      const border = network.borders[leg.border]
      if (border) cost += ((border.minutes ?? 60) / 60) * BORDER_WEIGHT
    }
    if (leg.scenic && opts.preferScenic !== false) cost -= SCENIC_BONUS
    if (leg.confidence === 'verify') cost += 1.5 // prefer legs we can stand behind

    return Math.max(0.1, cost)
  }

  /**
   * @returns {{path: object[], stations: string[]} | null}
   *          path is an ordered list of {leg, from, to} in travel direction.
   */
  function route(network, fromId, toId, opts = {}) {
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
        const next = best + edgeCost(network, edge.leg, opts)
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

  return { route, reachable, MODE_WEIGHT }
})()
