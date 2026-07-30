/* The routes written up as their own pages.
 *
 * Curated, not combinatorial. 203 stations make around 40,000 orderable pairs,
 * and generating them all would produce thin near-identical pages that read as
 * doorway spam — the kind of thing that gets a whole domain suppressed rather
 * than any one page ranked. These are corridors people ask about in these
 * words, each with a genuinely different answer behind it.
 *
 * Shared: tools/build-pages.mjs renders them, and the planner links to them
 * from its idle panel so a crawler arriving at the homepage can reach them.
 */

const GUIDES = [
  { from: 'bkk_aphiwat', to: 'singapore', slug: 'bangkok-to-singapore-by-train',
    h1: 'Bangkok to Singapore by train',
    intent: 'The classic overland run, and materially easier than most guides written before 2026 suggest.' },
  { from: 'kunming', to: 'singapore', slug: 'kunming-to-singapore-overland',
    h1: 'Kunming to Singapore overland',
    intent: 'The only continuous rail corridor in the region, end to end.' },
  { from: 'bkk_aphiwat', to: 'hanoi', slug: 'bangkok-to-hanoi-overland',
    h1: 'Bangkok to Hanoi overland',
    intent: 'There is no through train. This is what the honest answer looks like.' },
  { from: 'luangprabang', to: 'klsentral', slug: 'laos-to-malaysia-by-train',
    h1: 'Laos to Malaysia by train',
    intent: 'Luang Prabang to Kuala Lumpur, pure spine, southbound.' },
  { from: 'singapore', to: 'denpasar', slug: 'singapore-to-bali-without-flying',
    h1: 'Singapore to Bali without flying',
    intent: 'Land and sea the whole way, across two countries and four ferries.' },
  { from: 'bkk_aphiwat', to: 'siemreap', slug: 'bangkok-to-siem-reap-overland',
    h1: 'Bangkok to Siem Reap overland',
    intent: 'Train to the frontier, and the truth about the Poipet crossing.' },
  { from: 'bkk_aphiwat', to: 'chiangmai', slug: 'bangkok-to-chiang-mai-sleeper-train',
    h1: 'Bangkok to Chiang Mai by sleeper train',
    intent: 'The overnight most people take, and which berth is worth paying for.' },
  { from: 'hanoi', to: 'saigon', slug: 'hanoi-to-ho-chi-minh-city-by-train',
    h1: 'Hanoi to Ho Chi Minh City by train',
    intent: 'The Reunification Express, the full length of Vietnam.' },
  { from: 'klsentral', to: 'wakafbaharu', slug: 'jungle-railway-malaysia',
    h1: 'The Jungle Railway across Malaysia',
    intent: 'Slow, scenic, cult status — the journey as the point rather than the transport.' },
  { from: 'chiangmai', to: 'luangprabang', slug: 'chiang-mai-to-luang-prabang-slow-boat',
    h1: 'Chiang Mai to Luang Prabang by slow boat',
    intent: 'Two days down the Mekong, with a night at Pakbeng you cannot skip.' },
  { from: 'bkk_aphiwat', to: 'kohsamui', slug: 'bangkok-to-koh-samui-train-and-ferry',
    h1: 'Bangkok to Koh Samui by train and ferry',
    intent: 'Night train south, then the boat — and why the joint ticket is worth it.' },
  { from: 'bkk_aphiwat', to: 'phnompenh', slug: 'bangkok-to-phnom-penh-overland',
    h1: 'Bangkok to Phnom Penh overland',
    intent: 'Two railways that do not meet, and the road that joins them.' },
  { from: 'singapore', to: 'klsentral', slug: 'singapore-to-kuala-lumpur-by-train',
    h1: 'Singapore to Kuala Lumpur by train',
    intent: 'The Shuttle Tebrau and the ETS north — the fastest honest rail answer in the region.' },
  { from: 'manila', to: 'boracay', slug: 'manila-to-boracay-without-flying',
    h1: 'Manila to Boracay without flying',
    intent: 'Everyone flies. This is what the alternative actually costs in time and money.' },
  { from: 'manila', to: 'davao', slug: 'manila-to-davao-overland',
    h1: 'Manila to Davao overland',
    intent: 'The length of the Philippines by bus and ship, on the Nautical Highway.' },
  { from: 'bkk_aphiwat', to: 'vte_khamsavath', slug: 'bangkok-to-vientiane-by-train',
    h1: 'Bangkok to Vientiane by train',
    intent: 'Across the Friendship Bridge, and the gauge break waiting on the other side.' },

  /* Added later, and chosen the same way: corridors with a materially different
   * answer behind them, not the reverse of a page that already exists. A page
   * for "Singapore to Bangkok" would be the Bangkok page read upwards — the
   * same legs, the same crossings, the same prose — and two of those is one
   * page and one liability.
   *
   * Single-leg international corridors are missing on purpose. "Ho Chi Minh
   * City to Phnom Penh" is one bus and one frontier, so almost everything worth
   * saying about it is about Bavet — and that now has a page of its own, which
   * is the better answer to the query rather than a thinner second copy of it. */

  { from: 'saigon', to: 'bkk_aphiwat', slug: 'ho-chi-minh-city-to-bangkok-overland',
    h1: 'Ho Chi Minh City to Bangkok overland',
    intent: 'Two frontiers, no through train, and a week if you do it properly.' },
  { from: 'singapore', to: 'jakarta', slug: 'singapore-to-jakarta-without-flying',
    h1: 'Singapore to Jakarta without flying',
    intent: 'An hour in the air, or five days across the Riau islands and the length of Sumatra.' },
  { from: 'klsentral', to: 'bkk_aphiwat', slug: 'kuala-lumpur-to-bangkok-by-train',
    h1: 'Kuala Lumpur to Bangkok by train',
    intent: 'The spine northbound — two trains, one frontier, and a clock that changes at it.' },
  { from: 'bkk_aphiwat', to: 'georgetown', slug: 'bangkok-to-penang-by-train',
    h1: 'Bangkok to Penang by train',
    intent: 'The old visa-run route, and why the train still stops short of the island.' },
  { from: 'bkk_aphiwat', to: 'kunming', slug: 'bangkok-to-kunming-by-train',
    h1: 'Bangkok to Kunming by train',
    intent: 'Almost all of it on rails since 2021 — and the crossing that turns people back.' },
  { from: 'bkk_aphiwat', to: 'luangprabang', slug: 'bangkok-to-luang-prabang-overland',
    h1: 'Bangkok to Luang Prabang overland',
    intent: 'The sleeper north, the Friendship Bridge, and 90 minutes on the new railway.' },
  { from: 'vte_khamsavath', to: 'kunming', slug: 'vientiane-to-kunming-by-train',
    h1: 'Vientiane to Kunming by train',
    intent: 'The newest railway in the region, and the hardest ticket in it to buy.' },
  { from: 'jakarta', to: 'denpasar', slug: 'jakarta-to-bali-by-train-and-ferry',
    h1: 'Jakarta to Bali by train and ferry',
    intent: 'The length of Java on rails, then the strait — no border, and no flight.' },
  { from: 'surabaya', to: 'denpasar', slug: 'surabaya-to-bali-by-train-and-ferry',
    h1: 'Surabaya to Bali by train and ferry',
    intent: 'The short end of the Java run, and the ferry nobody books in advance.' },
  { from: 'manila', to: 'cebu', slug: 'manila-to-cebu-by-ferry',
    h1: 'Manila to Cebu by ferry',
    intent: 'Twenty-odd hours on a ship for the price of a checked bag.' },

  /* The far corners. Each of these is the only written-up journey that uses a
   * particular frontier, which is why they are here: a crossing page with no
   * journey behind it is a briefing nobody can act on, and the six below carry
   * Belawan, Dumai, Chong Mek, Chau Doc, Sungai Tujoh and Sungai Kolok. */

  { from: 'singapore', to: 'medan', slug: 'singapore-to-medan-overland',
    h1: 'Singapore to Medan overland',
    intent: 'Up the peninsula and across the strait to Sumatra, on the old ferry route.' },
  { from: 'klsentral', to: 'pekanbaru', slug: 'kuala-lumpur-to-pekanbaru-overland',
    h1: 'Kuala Lumpur to Pekanbaru overland',
    intent: 'The Melaka ferry to Dumai, and the road into central Sumatra.' },
  { from: 'bkk_aphiwat', to: 'pakse', slug: 'bangkok-to-pakse-overland',
    h1: 'Bangkok to Pakse overland',
    intent: 'The eastern sleeper to Ubon, then Chong Mek — the quiet way into southern Laos.' },
  { from: 'phnompenh', to: 'chaudoc', slug: 'phnom-penh-to-chau-doc-by-boat',
    h1: 'Phnom Penh to Chau Doc by boat',
    intent: 'One of the last passenger river crossings in the region, and how immigration works on water.' },
  { from: 'kuching', to: 'kotakinabalu', slug: 'kuching-to-kota-kinabalu-overland',
    h1: 'Kuching to Kota Kinabalu overland',
    intent: 'The length of Borneo by road and sea, in and out of Brunei on the way.' },
  { from: 'bkk_aphiwat', to: 'wakafbaharu', slug: 'bangkok-to-kota-bharu-by-train',
    h1: 'Bangkok to Kota Bharu by train',
    intent: 'The east-coast crossing at Sungai Kolok — and the security advice to read first.' },
]
