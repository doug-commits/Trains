/* Southeast Asian overland network — stations, legs, borders.
 *
 * This is the product. The routing code is twenty lines; the value is in the
 * accuracy of what follows, so every claim here is either structural (gauges,
 * which stations exist, who stamps where) or explicitly labelled as indicative.
 *
 * Durations are typical scheduled running times, NOT departure times. The app
 * never invents a departure time — the operators share no timetable and a
 * remembered departure is the fastest way to strand someone at Padang Besar.
 *
 * confidence:
 *   'structural' — physical/administrative fact, stable for years
 *   'reported'   — consistent across Seat61 / Barrow / operator pages
 *   'verify'     — volatile; the UI surfaces this as a warning
 *
 * Last reviewed against the network atlas: 2026-07.
 */

const NETWORK = {
  reviewed: '2026-07',

  intro:
    'There is exactly one long continuous passenger rail spine in mainland Southeast Asia: ' +
    'Kunming to Vientiane, a taxi across Vientiane, then Nong Khai to Bangkok to Hat Yai to ' +
    'Padang Besar to Kuala Lumpur to JB Sentral to Singapore. Everything else is a branch or ' +
    'an island. Cambodia hangs off that spine at Aranyaprathet. Vietnam is a self-contained ' +
    'north-south line touching no neighbour\'s passenger network. Indonesia is reachable only ' +
    'by sea. Myanmar is isolated.',

  myths: [
    { belief: 'You can take a train from Singapore to Beijing.',
      reality: 'Five journeys, three transfers between unconnected stations, one of them a 15 km taxi in Vientiane. Possible as a project, not as a ticket.' },
    { belief: 'There\'s a train from Bangkok to Hanoi.',
      reality: 'No. Rail to Vientiane, then a 20-hour bus. Or rail via Cambodia, then a bus.' },
    { belief: 'I\'ll get the train from Laos to Vietnam.',
      reality: 'No such railway exists. None is built and none is imminent.' },
    { belief: 'Penang has a train station.',
      reality: 'Butterworth does, on the mainland. George Town is a ferry away — a good ferry, but a ferry.' },
    { belief: 'KL to JB needs a change at Gemas.',
      reality: 'Not since December 2025. Through ETS runs the whole way, some services direct from Padang Besar.' },
    { belief: 'I\'ll change trains at Thanaleng.',
      reality: 'Closed to passengers since 2024. It is a freight dry port now. Khamsavath is the station.' },
    { belief: '"Vientiane station"',
      reality: 'There are two, 15 km apart, on different gauges, serving opposite directions. Always name which one.' },
  ],

  /* ------------------------------------------------------------- operators
   * `mono` and `livery` drive the operator plate shown against each leg. These
   * are our own marks in each operator's approximate livery colour, NOT their
   * logos — those are trademarks, and redistributing them inside a published
   * page is not ours to do.
   *
   * `book` is the operator's own booking site where one genuinely exists and is
   * usable from abroad. Where it does not, `book` is null and `bookNote` says
   * how the ticket is actually bought. Never invent a URL to fill the column: a
   * dead booking link is worse than an honest "buy it at the pier".
   */
  operators: {
    // --- rail
    lcr:   { name: 'Laos–China Railway', short: 'LCR', mono: 'LCR', livery: '#c8102e', ink: '#fff',
             gauge: 'standard', punctual: 'good', book: null, bookVia: 'aggregator',
             bookNote: 'Station counters and the Lao ticketing app. From abroad an agent or aggregator is the practical route in — this is the hardest ticket in the region to buy independently, and the sale window is short.',
             note: 'Chinese-operated, keeps time. The risk is ticket availability, not delay.' },
    srt:   { name: 'State Railway of Thailand', short: 'SRT', mono: 'SRT', livery: '#e4002b', ink: '#fff',
             gauge: 'metre', punctual: 'poor', book: 'https://dticket.railway.co.th',
             bookNote: 'The official e-ticket site. Foreign cards fail on it fairly often, and an aggregator is the usual fallback when they do.',
             note: 'Long-distance services routinely run 30–90 min late. Southbound to Hat Yai is the worst offender.' },
    ktmb:  { name: 'KTMB', short: 'KTMB', mono: 'KTM', livery: '#003da5', ink: '#fff',
             gauge: 'metre', punctual: 'good', book: 'https://online.ktmb.com.my',
             bookNote: 'Reliable and genuinely bookable from abroad. Use it directly rather than a reseller — you gain nothing by going through one.',
             note: 'Genuinely punctual. You can plan to it.' },
    rrc:   { name: 'Royal Railway Cambodia', short: 'Royal', mono: 'RRC', livery: '#b8912f', ink: '#1a1a1a',
             gauge: 'metre', punctual: 'poor', book: 'https://www.royal-railway.com',
             bookNote: 'Schedule changes are announced informally, often on Facebook rather than the site. Confirm the train runs on your date before you plan anything around it.',
             note: 'Limited frequency — often weekends plus selected days, not daily.' },
    dsvn:  { name: 'Vietnam Railways', short: 'DSVN', mono: 'DSVN', livery: '#0f6baf', ink: '#fff',
             gauge: 'metre', punctual: 'fair', book: 'https://dsvn.vn',
             bookNote: 'dsvn.vn is the genuine official site. Several convincing lookalike domains are resellers, so check the address bar before you pay.',
             note: 'The private carriages attached to these trains — Livitrans, Violette, Lotus — are usually the better product.' },
    kai:   { name: 'KAI', short: 'KAI', mono: 'KAI', livery: '#1b3a8c', ink: '#fff',
             gauge: 'metre', punctual: 'good', book: 'https://booking.kai.id',
             bookNote: 'Good site, bookable from abroad. The Access by KAI app is easier once you are in Indonesia.',
             note: 'The best rail in Southeast Asia — punctual, cheap, scenic.' },

    // --- sea
    lomprayah:     { name: 'Lomprayah', short: 'Lomprayah', mono: 'LOM', livery: '#00868b', ink: '#fff',
                     punctual: 'weather', book: 'https://www.lomprayah.com',
                     bookNote: 'Sells combined train-plus-boat tickets from Bangkok, which removes the transfer problem entirely.',
                     note: 'Catamarans, timed off the overnight trains into Chumphon.' },
    rajaferry:     { name: 'Raja Ferry', short: 'Raja', mono: 'RAJA', livery: '#e07b28', ink: '#1a1a1a',
                     punctual: 'weather', book: 'https://www.rajaferryport.com',
                     bookNote: 'Vehicle ferry, frequent, rarely sold out. Combined train-bus-boat tickets are widely sold.', note: '' },
    asdp:          { name: 'ASDP Indonesia Ferry', short: 'ASDP', mono: 'ASDP', livery: '#0e4c92', ink: '#fff',
                     punctual: 'weather', book: 'https://ferizy.com',
                     bookNote: 'Ferizy is ASDP\'s official booking platform. Crossings are frequent enough that walking up usually works too.', note: '' },
    penangferry:   { name: 'Penang Ferry', short: 'Penang Ferry', mono: 'PGF', livery: '#4f7f3a', ink: '#fff',
                     punctual: 'good', book: null, bookVia: 'counter',
                     bookNote: 'Pay at the terminal beside Butterworth station. A few ringgit, no booking, no queue worth worrying about.', note: '' },
    langkawiferry: { name: 'Langkawi ferry lines', short: 'Langkawi Ferry', mono: 'LGK', livery: '#1b7fa8', ink: '#fff',
                     punctual: 'weather', book: null, bookVia: 'aggregator',
                     bookNote: 'Several small operators share these routes and their own sites come and go. An aggregator is the reliable way to see what is actually sailing on your date.', note: '' },
    mekongboat:    { name: 'Mekong slow boat', short: 'Slow boat', mono: 'MEK', livery: '#8a6a3b', ink: '#fff',
                     punctual: 'fair', book: null, bookVia: 'aggregator',
                     bookNote: 'Bought through guesthouses and agents in Huay Xai, or an aggregator. Buy the day before — it leaves early and does not wait.', note: '' },
    tonlesap:      { name: 'Tonlé Sap boat', short: 'Tonlé Sap', mono: 'TSB', livery: '#4e7a6b', ink: '#fff',
                     punctual: 'fair', book: null, bookVia: 'aggregator',
                     bookNote: 'Sold through guesthouses and aggregators. Only runs when the lake is high, roughly August to March.', note: '' },
    speedferry:    { name: 'Speed Ferry Cambodia', short: 'Speed Ferry', mono: 'SFC', livery: '#2e7da8', ink: '#fff',
                     punctual: 'weather', book: null, bookVia: 'counter', bookNote: 'Bought at the Sihanoukville pier or through your guesthouse.', note: '' },
    hangchau:      { name: 'Hang Chau / Blue Cruiser', short: 'Mekong boat', mono: 'HC', livery: '#7a5c9e', ink: '#fff',
                     punctual: 'fair', book: null, bookVia: 'aggregator',
                     bookNote: 'Sold as a through ticket that includes the border formalities. Aggregators carry both operators.', note: '' },
    riauferry:     { name: 'Riau / Straits ferries', short: 'Straits ferry', mono: 'RIAU', livery: '#3e7b8c', ink: '#fff',
                     punctual: 'weather', book: null, bookVia: 'aggregator',
                     bookNote: 'Operators on the Straits routes change often. Check what is currently sailing before you commit to a date.', note: '' },
    localferry:    { name: 'Local ferry', short: 'Local ferry', mono: 'FRY', livery: '#4b7c8c', ink: '#fff',
                     punctual: 'weather', book: null, bookVia: 'counter',
                     bookNote: 'Bought at the pier. Turn up, check the last departure when you arrive, and do not be the one still on the dock.', note: '' },

    // --- road
    greenbus:  { name: 'Green Bus', short: 'Green Bus', mono: 'GRN', livery: '#2e7d32', ink: '#fff',
                 punctual: 'fair', book: 'https://www.greenbusthailand.com',
                 bookNote: 'Northern Thailand\'s main intercity operator, bookable online and comfortable enough.', note: '' },
    damri:     { name: 'Damri', short: 'Damri', mono: 'DMR', livery: '#c1272d', ink: '#fff',
                 punctual: 'fair', book: 'https://damri.co.id',
                 bookNote: 'Indonesia\'s state bus operator. Often sold as a through ticket with the ferry.', note: '' },
    giantibis: { name: 'Giant Ibis', short: 'Giant Ibis', mono: 'GI', livery: '#6b4e3d', ink: '#fff',
                 punctual: 'fair', book: 'https://www.giantibis.com',
                 bookNote: 'Handles the border formalities as a group and is worth the small premium over the local buses.', note: '' },
    coach:     { name: 'Long-distance coach', short: 'Coach', mono: 'BUS', livery: '#8c7b6b', ink: '#fff',
                 punctual: 'fair', book: null, bookVia: 'aggregator',
                 bookNote: 'Several operators run these corridors at varying quality. An aggregator is the sane way to compare them.', note: '' },
    transfer:  { name: 'Local transfer', short: 'Transfer', mono: 'TRF', livery: '#6e828c', ink: '#fff',
                 punctual: 'fair', book: null, bookVia: 'counter',
                 bookNote: 'Taxi, tuk-tuk, songthaew or minivan at the station. Agree the fare before you get in.', note: '' },
    metro:     { name: 'Urban metro', short: 'Metro', mono: 'MTR', livery: '#4a6b8a', ink: '#fff',
                 punctual: 'good', book: null, bookVia: 'counter',
                 bookNote: 'Contactless or a stored-value card at the station. Nothing to plan.', note: '' },
  },

  /* Where the operator cannot be booked from abroad, these are the fallbacks.
   * They are plain links — this project earns nothing from them, and if that
   * ever changes it must be disclosed here and in the output. */
  aggregators: [
    { name: '12Go', url: 'https://12go.asia', note: 'Widest coverage in the region, including boats and minivans.' },
    { name: 'Baolau', url: 'https://www.baolau.com', note: 'Stronger on Vietnamese and Cambodian rail.' },
  ],

  /* ---------------------------------------------------------------- stations
   * gauge: which network the platform physically belongs to. Two stations in
   * the same city on different gauges are two different journeys.
   */
  stations: {
    // --- China / Laos, standard gauge
    kunming:        { name: 'Kunming South',            city: 'Kunming',       country: 'cn', lat: 24.92,  lon: 102.77, gauge: 'standard' },
    mohan:          { name: 'Mohan',                    city: 'Mohan',         country: 'cn', lat: 21.18,  lon: 101.68, gauge: 'standard', minor: true },
    boten:          { name: 'Boten',                    city: 'Boten',         country: 'la', lat: 21.13,  lon: 101.66, gauge: 'standard', minor: true },
    nateuy:         { name: 'Luang Namtha (Nateuy)',    city: 'Luang Namtha',  country: 'la', lat: 20.95,  lon: 101.40, gauge: 'standard', minor: true },
    oudomxay:       { name: 'Oudomxay',                 city: 'Muang Xay',     country: 'la', lat: 20.69,  lon: 101.99, gauge: 'standard', minor: true },
    luangprabang:   { name: 'Luang Prabang',            city: 'Luang Prabang', country: 'la', lat: 19.94,  lon: 102.17, gauge: 'standard' },
    vangvieng:      { name: 'Vang Vieng',               city: 'Vang Vieng',    country: 'la', lat: 18.92,  lon: 102.44, gauge: 'standard', minor: true },
    vte_banthen:    { name: 'Vientiane (Banthen)',      city: 'Vientiane',     country: 'la', lat: 18.05,  lon: 102.52, gauge: 'standard',
                      warn: 'Serves ONLY northbound LCR trains to Luang Prabang and China. Not the station for Thailand.' },

    // --- Laos / Thailand, metre gauge
    vte_khamsavath: { name: 'Vientiane (Khamsavath)',   city: 'Vientiane',     country: 'la', lat: 17.94,  lon: 102.68, gauge: 'metre',
                      warn: 'Serves ONLY southbound trains to Thailand. 15 km from Banthen, no rail link between them.' },
    nongkhai:       { name: 'Nong Khai',                city: 'Nong Khai',     country: 'th', lat: 17.87,  lon: 102.74, gauge: 'metre' },
    udonthani:      { name: 'Udon Thani',               city: 'Udon Thani',    country: 'th', lat: 17.41,  lon: 102.79, gauge: 'metre' },
    khonkaen:       { name: 'Khon Kaen',                city: 'Khon Kaen',     country: 'th', lat: 16.44,  lon: 102.83, gauge: 'metre' },
    korat:          { name: 'Nakhon Ratchasima',        city: 'Korat',         country: 'th', lat: 14.97,  lon: 102.10, gauge: 'metre' },
    ubon:           { name: 'Ubon Ratchathani',         city: 'Ubon',          country: 'th', lat: 15.24,  lon: 104.87, gauge: 'metre' },

    // --- Thailand core
    bkk_aphiwat:    { name: 'Krung Thep Aphiwat',       city: 'Bangkok',       country: 'th', lat: 13.80,  lon: 100.54, gauge: 'metre', hub: true,
                      warn: 'Bangkok\'s long-distance terminal since 2023 — not the old Hua Lamphong. Confirm which terminal your specific train uses.' },
    bkk_hualamphong:{ name: 'Hua Lamphong',             city: 'Bangkok',       country: 'th', lat: 13.74,  lon: 100.52, gauge: 'metre',
                      warn: 'Now mostly local services, but some eastern trains (Aranyaprathet) still start here.' },
    bkk_thonburi:   { name: 'Bangkok Thonburi',         city: 'Bangkok',       country: 'th', lat: 13.72,  lon: 100.47, gauge: 'metre', minor: true },
    ayutthaya:      { name: 'Ayutthaya',                city: 'Ayutthaya',     country: 'th', lat: 14.36,  lon: 100.58, gauge: 'metre' },
    phitsanulok:    { name: 'Phitsanulok',              city: 'Phitsanulok',   country: 'th', lat: 16.83,  lon: 100.27, gauge: 'metre' },
    chiangmai:      { name: 'Chiang Mai',               city: 'Chiang Mai',    country: 'th', lat: 18.79,  lon: 98.98,  gauge: 'metre' },
    kanchanaburi:   { name: 'Kanchanaburi',             city: 'Kanchanaburi',  country: 'th', lat: 14.02,  lon: 99.53,  gauge: 'metre' },
    namtok:         { name: 'Nam Tok',                  city: 'Nam Tok',       country: 'th', lat: 14.24,  lon: 99.07,  gauge: 'metre', minor: true },
    aranyaprathet:  { name: 'Aranyaprathet',            city: 'Aranyaprathet', country: 'th', lat: 13.69,  lon: 102.50, gauge: 'metre' },
    huahin:         { name: 'Hua Hin',                  city: 'Hua Hin',       country: 'th', lat: 12.57,  lon: 99.96,  gauge: 'metre' },
    chumphon:       { name: 'Chumphon',                 city: 'Chumphon',      country: 'th', lat: 10.50,  lon: 99.18,  gauge: 'metre' },
    suratthani:     { name: 'Surat Thani (Phun Phin)',  city: 'Surat Thani',   country: 'th', lat: 9.14,   lon: 99.27,  gauge: 'metre',
                      warn: 'The station is at Phun Phin, 13 km from Surat Thani town and a long way from any pier.' },
    trang:          { name: 'Trang',                    city: 'Trang',         country: 'th', lat: 7.55,   lon: 99.61,  gauge: 'metre' },
    hatyai:         { name: 'Hat Yai Junction',         city: 'Hat Yai',       country: 'th', lat: 7.01,   lon: 100.47, gauge: 'metre', hub: true },
    padangbesar:    { name: 'Padang Besar',             city: 'Padang Besar',  country: 'th', lat: 6.66,   lon: 100.32, gauge: 'metre', hub: true,
                      warn: 'Joint station. SRT publishes departures in Thai time (UTC+7), KTMB in Malaysian time (UTC+8). Read both and you will build a connection that is an hour off.' },
    sungaikolok:    { name: 'Sungai Kolok',             city: 'Sungai Kolok',  country: 'th', lat: 6.02,   lon: 101.97, gauge: 'metre',
                      warn: 'Standing security advisories cover Narathiwat, Yala and Pattani provinces.' },
    ranong:         { name: 'Ranong',                   city: 'Ranong',        country: 'th', lat: 9.96,   lon: 98.63,  gauge: null, minor: true },

    // --- Cambodia
    poipet:         { name: 'Poipet',                   city: 'Poipet',        country: 'kh', lat: 13.66,  lon: 102.56, gauge: 'metre' },
    battambang:     { name: 'Battambang',               city: 'Battambang',    country: 'kh', lat: 13.10,  lon: 103.20, gauge: 'metre' },
    phnompenh:      { name: 'Phnom Penh',               city: 'Phnom Penh',    country: 'kh', lat: 11.57,  lon: 104.92, gauge: 'metre', hub: true },
    takeo:          { name: 'Takeo',                    city: 'Takeo',         country: 'kh', lat: 10.99,  lon: 104.79, gauge: 'metre', minor: true },
    kampot:         { name: 'Kampot',                   city: 'Kampot',        country: 'kh', lat: 10.61,  lon: 104.18, gauge: 'metre' },
    sihanoukville:  { name: 'Sihanoukville',            city: 'Sihanoukville', country: 'kh', lat: 10.63,  lon: 103.52, gauge: 'metre' },

    // --- Vietnam
    hanoi:          { name: 'Hanoi',                    city: 'Hanoi',         country: 'vn', lat: 21.02,  lon: 105.84, gauge: 'metre', hub: true },
    laocai:         { name: 'Lào Cai',                  city: 'Lào Cai',       country: 'vn', lat: 22.49,  lon: 103.97, gauge: 'metre' },
    haiphong:       { name: 'Hải Phòng',                city: 'Hải Phòng',     country: 'vn', lat: 20.86,  lon: 106.68, gauge: 'metre' },
    dongdang:       { name: 'Đồng Đăng',                city: 'Đồng Đăng',     country: 'vn', lat: 21.95,  lon: 106.71, gauge: 'metre', minor: true },
    vinh:           { name: 'Vinh',                     city: 'Vinh',          country: 'vn', lat: 18.68,  lon: 105.68, gauge: 'metre' },
    hue:            { name: 'Huế',                      city: 'Huế',           country: 'vn', lat: 16.46,  lon: 107.59, gauge: 'metre' },
    danang:         { name: 'Đà Nẵng',                  city: 'Đà Nẵng',       country: 'vn', lat: 16.07,  lon: 108.22, gauge: 'metre' },
    nhatrang:       { name: 'Nha Trang',                city: 'Nha Trang',     country: 'vn', lat: 12.25,  lon: 109.19, gauge: 'metre' },
    saigon:         { name: 'Sài Gòn',                  city: 'Ho Chi Minh City', country: 'vn', lat: 10.78, lon: 106.68, gauge: 'metre', hub: true },

    // --- Malaysia
    arau:           { name: 'Arau',                     city: 'Arau',          country: 'my', lat: 6.43,   lon: 100.27, gauge: 'metre' },
    kualaperlis:    { name: 'Kuala Perlis pier',        city: 'Kuala Perlis',  country: 'my', lat: 6.40,   lon: 100.13, gauge: null, minor: true },
    langkawi:       { name: 'Langkawi (Kuah)',          city: 'Langkawi',      country: 'my', lat: 6.32,   lon: 99.85,  gauge: null },
    alorsetar:      { name: 'Alor Setar',               city: 'Alor Setar',    country: 'my', lat: 6.12,   lon: 100.37, gauge: 'metre' },
    butterworth:    { name: 'Butterworth',              city: 'Butterworth',   country: 'my', lat: 5.39,   lon: 100.36, gauge: 'metre',
                      warn: 'This is the station for Penang. George Town is across the water — the ferry berths beside the station.' },
    georgetown:     { name: 'George Town',              city: 'Penang',        country: 'my', lat: 5.42,   lon: 100.34, gauge: null },
    ipoh:           { name: 'Ipoh',                     city: 'Ipoh',          country: 'my', lat: 4.60,   lon: 101.09, gauge: 'metre' },
    klsentral:      { name: 'KL Sentral',               city: 'Kuala Lumpur',  country: 'my', lat: 3.13,   lon: 101.69, gauge: 'metre', hub: true },
    portklang:      { name: 'Port Klang',               city: 'Port Klang',    country: 'my', lat: 3.00,   lon: 101.39, gauge: 'metre', minor: true },
    tampin:         { name: 'Tampin / Pulau Sebang',    city: 'Tampin',        country: 'my', lat: 2.46,   lon: 102.23, gauge: 'metre', minor: true },
    melaka:         { name: 'Melaka ferry terminal',    city: 'Melaka',        country: 'my', lat: 2.19,   lon: 102.25, gauge: null },
    gemas:          { name: 'Gemas',                    city: 'Gemas',         country: 'my', lat: 2.59,   lon: 102.61, gauge: 'metre',
                      warn: 'Junction for the East Coast "Jungle Railway". No longer a forced change for KL–JB since the Dec 2025 electrification.' },
    kualalipis:     { name: 'Kuala Lipis',              city: 'Kuala Lipis',   country: 'my', lat: 4.18,   lon: 102.05, gauge: 'metre' },
    wakafbaharu:    { name: 'Wakaf Baharu',             city: 'Kota Bharu',    country: 'my', lat: 6.16,   lon: 102.22, gauge: 'metre' },
    rantaupanjang:  { name: 'Rantau Panjang',           city: 'Rantau Panjang',country: 'my', lat: 6.03,   lon: 101.98, gauge: null, minor: true },
    jbsentral:      { name: 'JB Sentral',               city: 'Johor Bahru',   country: 'my', lat: 1.46,   lon: 103.76, gauge: 'metre', hub: true },
    kotakinabalu:   { name: 'Kota Kinabalu (Tanjung Aru)', city: 'Kota Kinabalu', country: 'my', lat: 5.94, lon: 116.05, gauge: 'metre',
                      warn: 'Sabah\'s 130 km line is isolated from every other railway in Asia. It connects to nothing.' },
    tenom:          { name: 'Tenom',                    city: 'Tenom',         country: 'my', lat: 5.13,   lon: 115.94, gauge: 'metre', minor: true },

    // --- Singapore
    woodlands:      { name: 'Woodlands CIQ',            city: 'Singapore',     country: 'sg', lat: 1.45,   lon: 103.79, gauge: 'metre' },
    singapore:      { name: 'Singapore (HarbourFront)', city: 'Singapore',     country: 'sg', lat: 1.265,  lon: 103.82, gauge: null, hub: true,
                      warn: 'Rail dead end. Everything onward from here is a boat.' },

    // --- Indonesia
    batam:          { name: 'Batam Centre',             city: 'Batam',         country: 'id', lat: 1.13,   lon: 104.05, gauge: null },
    dumai:          { name: 'Dumai',                    city: 'Dumai',         country: 'id', lat: 1.67,   lon: 101.44, gauge: null },
    pekanbaru:      { name: 'Pekanbaru',                city: 'Pekanbaru',     country: 'id', lat: 0.51,   lon: 101.45, gauge: null, minor: true },
    belawan:        { name: 'Belawan',                  city: 'Belawan',       country: 'id', lat: 3.78,   lon: 98.69,  gauge: null, minor: true },
    medan:          { name: 'Medan',                    city: 'Medan',         country: 'id', lat: 3.59,   lon: 98.68,  gauge: 'metre',
                      warn: 'North Sumatra\'s rail fragment reaches nothing else. It does not join the southern Sumatra network or Java.' },
    palembang:      { name: 'Palembang (Kertapati)',    city: 'Palembang',     country: 'id', lat: -3.02,  lon: 104.75, gauge: 'metre' },
    bandarlampung:  { name: 'Bandar Lampung (Tanjungkarang)', city: 'Bandar Lampung', country: 'id', lat: -5.42, lon: 105.26, gauge: 'metre' },
    bakauheni:      { name: 'Bakauheni',                city: 'Bakauheni',     country: 'id', lat: -5.87,  lon: 105.75, gauge: null, minor: true },
    merak:          { name: 'Merak',                    city: 'Merak',         country: 'id', lat: -5.93,  lon: 106.00, gauge: 'metre', minor: true },
    jakarta:        { name: 'Jakarta (Gambir)',         city: 'Jakarta',       country: 'id', lat: -6.18,  lon: 106.83, gauge: 'metre', hub: true },
    bandung:        { name: 'Bandung',                  city: 'Bandung',       country: 'id', lat: -6.91,  lon: 107.60, gauge: 'metre' },
    yogyakarta:     { name: 'Yogyakarta (Tugu)',        city: 'Yogyakarta',    country: 'id', lat: -7.78,  lon: 110.36, gauge: 'metre' },
    surabaya:       { name: 'Surabaya (Gubeng)',        city: 'Surabaya',      country: 'id', lat: -7.27,  lon: 112.75, gauge: 'metre' },
    banyuwangi:     { name: 'Banyuwangi (Ketapang)',    city: 'Banyuwangi',    country: 'id', lat: -8.14,  lon: 114.39, gauge: 'metre',
                      warn: 'The ferry pier is beside the station. This is what makes "Singapore to Bali overland" literally true.' },
    gilimanuk:      { name: 'Gilimanuk',                city: 'Gilimanuk',     country: 'id', lat: -8.16,  lon: 114.44, gauge: null, minor: true },
    denpasar:       { name: 'Denpasar',                 city: 'Bali',          country: 'id', lat: -8.67,  lon: 115.22, gauge: null },

    // --- Thailand, destination-tier additions
    lopburi:        { name: 'Lopburi',                  city: 'Lopburi',       country: 'th', lat: 14.80,  lon: 100.62, gauge: 'metre' },
    lampang:        { name: 'Lampang',                  city: 'Lampang',       country: 'th', lat: 18.28,  lon: 99.51,  gauge: 'metre' },
    pakchong:       { name: 'Pak Chong',                city: 'Pak Chong',     country: 'th', lat: 14.71,  lon: 101.42, gauge: 'metre',
                      warn: 'The railhead for Khao Yai. The park gate is a further songthaew or taxi ride.' },
    buriram:        { name: 'Buriram',                  city: 'Buriram',       country: 'th', lat: 15.00,  lon: 103.10, gauge: 'metre' },
    surin:          { name: 'Surin',                    city: 'Surin',         country: 'th', lat: 14.88,  lon: 103.49, gauge: 'metre' },
    chachoengsao:   { name: 'Chachoengsao',             city: 'Chachoengsao',  country: 'th', lat: 13.69,  lon: 101.07, gauge: 'metre', minor: true },
    prachuap:       { name: 'Prachuap Khiri Khan',      city: 'Prachuap',      country: 'th', lat: 11.81,  lon: 99.80,  gauge: 'metre' },
    phatthalung:    { name: 'Phatthalung',              city: 'Phatthalung',   country: 'th', lat: 7.62,   lon: 100.08, gauge: 'metre', minor: true },
    nakhonsi:       { name: 'Nakhon Si Thammarat',      city: 'Nakhon Si Thammarat', country: 'th', lat: 8.43, lon: 99.96, gauge: 'metre' },

    // --- Malaysia
    sungaipetani:   { name: 'Sungai Petani',            city: 'Sungai Petani', country: 'my', lat: 5.65,   lon: 100.49, gauge: 'metre', minor: true },
    taiping:        { name: 'Taiping',                  city: 'Taiping',       country: 'my', lat: 4.85,   lon: 100.74, gauge: 'metre' },
    seremban:       { name: 'Seremban',                 city: 'Seremban',      country: 'my', lat: 2.72,   lon: 101.94, gauge: 'metre', minor: true },
    segamat:        { name: 'Segamat',                  city: 'Segamat',       country: 'my', lat: 2.51,   lon: 102.82, gauge: 'metre', minor: true },
    kluang:         { name: 'Kluang',                   city: 'Kluang',        country: 'my', lat: 2.03,   lon: 103.32, gauge: 'metre', minor: true },
    jerantut:       { name: 'Jerantut',                 city: 'Jerantut',      country: 'my', lat: 3.94,   lon: 102.36, gauge: 'metre',
                      warn: 'The railhead for Taman Negara. The park entrance at Kuala Tahan is a further bus or river boat.' },
    guamusang:      { name: 'Gua Musang',               city: 'Gua Musang',    country: 'my', lat: 4.88,   lon: 101.97, gauge: 'metre' },
    dabong:         { name: 'Dabong',                   city: 'Dabong',        country: 'my', lat: 5.38,   lon: 102.02, gauge: 'metre', minor: true },

    // --- Vietnam
    ninhbinh:       { name: 'Ninh Bình',                city: 'Ninh Bình',     country: 'vn', lat: 20.25,  lon: 105.97, gauge: 'metre' },
    thanhhoa:       { name: 'Thanh Hóa',                city: 'Thanh Hóa',     country: 'vn', lat: 19.81,  lon: 105.78, gauge: 'metre', minor: true },
    donghoi:        { name: 'Đồng Hới',                 city: 'Đồng Hới',      country: 'vn', lat: 17.48,  lon: 106.60, gauge: 'metre',
                      warn: 'The railhead for Phong Nha. The caves are about 45 minutes further by road.' },
    quangngai:      { name: 'Quảng Ngãi',               city: 'Quảng Ngãi',    country: 'vn', lat: 15.12,  lon: 108.79, gauge: 'metre', minor: true },
    dieutri:        { name: 'Diêu Trì',                 city: 'Quy Nhơn',      country: 'vn', lat: 13.79,  lon: 109.11, gauge: 'metre',
                      warn: 'The mainline station for Quy Nhơn, about 10 km outside the city.' },
    thapcham:       { name: 'Tháp Chàm',                city: 'Phan Rang',     country: 'vn', lat: 11.59,  lon: 108.98, gauge: 'metre', minor: true },
    muongman:       { name: 'Mương Mán',                city: 'Phan Thiết',    country: 'vn', lat: 10.95,  lon: 108.03, gauge: 'metre',
                      warn: 'The mainline station for Mũi Né and Phan Thiết, with a branch shuttle into town.' },

    // --- Indonesia
    cirebon:        { name: 'Cirebon',                  city: 'Cirebon',       country: 'id', lat: -6.71,  lon: 108.55, gauge: 'metre' },
    semarang:       { name: 'Semarang (Tawang)',        city: 'Semarang',      country: 'id', lat: -6.96,  lon: 110.43, gauge: 'metre' },
    purwokerto:     { name: 'Purwokerto',               city: 'Purwokerto',    country: 'id', lat: -7.42,  lon: 109.23, gauge: 'metre', minor: true },
    solo:           { name: 'Solo Balapan',             city: 'Surakarta',     country: 'id', lat: -7.55,  lon: 110.82, gauge: 'metre' },
    malang:         { name: 'Malang',                   city: 'Malang',        country: 'id', lat: -7.98,  lon: 112.63, gauge: 'metre' },
    probolinggo:    { name: 'Probolinggo',              city: 'Probolinggo',   country: 'id', lat: -7.75,  lon: 113.21, gauge: 'metre',
                      warn: 'The usual railhead for Bromo. The crater rim is a jeep ride beyond Cemoro Lawang.' },
    jember:         { name: 'Jember',                   city: 'Jember',        country: 'id', lat: -8.17,  lon: 113.70, gauge: 'metre', minor: true },

    // --- Laos, the remaining LCR passenger stops
    namo:           { name: 'Na Mo',                    city: 'Na Mo',         country: 'la', lat: 20.87,  lon: 101.83, gauge: 'standard', minor: true },
    nga:            { name: 'Muang Nga',                city: 'Muang Nga',     country: 'la', lat: 20.42,  lon: 102.15, gauge: 'standard', minor: true },
    kasi:           { name: 'Kasi',                     city: 'Kasi',          country: 'la', lat: 19.22,  lon: 102.25, gauge: 'standard', minor: true },
    phonhong:       { name: 'Phonhong',                 city: 'Phonhong',      country: 'la', lat: 18.49,  lon: 102.42, gauge: 'standard', minor: true },

    // --- Cambodia
    sisophon:       { name: 'Sisophon',                 city: 'Sisophon',      country: 'kh', lat: 13.59,  lon: 102.97, gauge: 'metre', minor: true },
    pursat:         { name: 'Pursat',                   city: 'Pursat',        country: 'kh', lat: 12.53,  lon: 103.92, gauge: 'metre', minor: true },

    // --- Thailand islands
    donsak:         { name: 'Donsak pier',              city: 'Donsak',        country: 'th', lat: 9.31,   lon: 99.68,  gauge: null, minor: true },
    kohsamui:       { name: 'Koh Samui',                city: 'Koh Samui',     country: 'th', lat: 9.51,   lon: 100.06, gauge: null },
    kohlanta:       { name: 'Koh Lanta',                city: 'Koh Lanta',     country: 'th', lat: 7.62,   lon: 99.04,  gauge: null },

    // --- Mekong slow boat, the classic two-day run into Laos
    chiangkhong:    { name: 'Chiang Khong',             city: 'Chiang Khong',  country: 'th', lat: 20.27,  lon: 100.40, gauge: null },
    huayxai:        { name: 'Huay Xai',                 city: 'Huay Xai',      country: 'la', lat: 20.28,  lon: 100.41, gauge: null },
    pakbeng:        { name: 'Pakbeng',                  city: 'Pakbeng',       country: 'la', lat: 19.89,  lon: 101.13, gauge: null,
                      warn: 'A one-street village that exists for the overnight stop. Rooms fill when the boat lands — book ahead in season.' },

    // --- Gulf of Thailand islands
    kohtao:         { name: 'Koh Tao',                  city: 'Koh Tao',       country: 'th', lat: 10.10,  lon: 99.84,  gauge: null },
    kohphangan:     { name: 'Koh Phangan',              city: 'Koh Phangan',   country: 'th', lat: 9.75,   lon: 100.02, gauge: null },

    // --- Andaman side
    krabi:          { name: 'Krabi (Klong Jilad)',      city: 'Krabi',         country: 'th', lat: 8.09,   lon: 98.91,  gauge: null },
    kohphiphi:      { name: 'Koh Phi Phi',              city: 'Koh Phi Phi',   country: 'th', lat: 7.74,   lon: 98.78,  gauge: null },
    phuket:         { name: 'Phuket (Rassada)',         city: 'Phuket',        country: 'th', lat: 7.88,   lon: 98.39,  gauge: null,
                      warn: 'No railway on the island and none nearby. Phuket is reached by boat from the Andaman chain, or by road from Surat Thani.' },
    satun:          { name: 'Satun (Tammalang pier)',   city: 'Satun',         country: 'th', lat: 6.53,   lon: 100.06, gauge: null },

    // --- Cambodia
    siemreap:       { name: 'Siem Reap',                city: 'Siem Reap',     country: 'kh', lat: 13.36,  lon: 103.86, gauge: null,
                      warn: 'Angkor has no railway. The nearest railhead is Sisophon, about two hours away by road.' },
    kohrong:        { name: 'Koh Rong',                 city: 'Koh Rong',      country: 'kh', lat: 10.72,  lon: 103.24, gauge: null },

    // --- Vietnam
    catba:          { name: 'Cát Bà',                   city: 'Cát Bà',        country: 'vn', lat: 20.72,  lon: 107.05, gauge: null },
    chaudoc:        { name: 'Châu Đốc',                 city: 'Châu Đốc',      country: 'vn', lat: 10.70,  lon: 105.11, gauge: null },

    // --- Malaysia
    kualakedah:     { name: 'Kuala Kedah pier',         city: 'Kuala Kedah',   country: 'my', lat: 6.11,   lon: 100.31, gauge: null, minor: true },
    labuan:         { name: 'Labuan',                   city: 'Labuan',        country: 'my', lat: 5.28,   lon: 115.24, gauge: null },

    // --- Brunei
    bandarseri:     { name: 'Bandar Seri Begawan (Muara)', city: 'Bandar Seri Begawan', country: 'bn', lat: 4.94, lon: 114.95, gauge: null,
                      warn: 'Brunei has no railway. The ferry chain from Sabah is the only way in that is not a road or a plane.' },

    // --- Bali onward
    padangbai:      { name: 'Padangbai',                city: 'Padangbai',     country: 'id', lat: -8.53,  lon: 115.51, gauge: null, minor: true },
    mataram:        { name: 'Lombok (Lembar)',          city: 'Lombok',        country: 'id', lat: -8.58,  lon: 116.11, gauge: null },
    gili:           { name: 'Gili Trawangan',           city: 'Gili Islands',  country: 'id', lat: -8.35,  lon: 116.04, gauge: null },

    // --- Myanmar (advisory)
    kawthaung:      { name: 'Kawthaung',                city: 'Kawthaung',     country: 'mm', lat: 9.98,   lon: 98.55,  gauge: null,
                      warn: 'Standing security advisories cover much of Myanmar, and there is no through rail to Thailand.' },
  },

  /* -------------------------------------------------------------------- legs
   * mode:      rail | ferry | road
   * essential: a road/ferry leg with no rail alternative that is part of the
   *            rail journey (a station transfer, a pier shuttle). Kept even in
   *            hard rail-only mode, because excluding it doesn't route around
   *            the gap — it just makes the journey impossible.
   * hours:     typical scheduled running time, excluding border formalities.
   * usd:       indicative one-way fare in the class named.
   */
  legs: [
    // === Laos–China Railway (standard gauge) ============================
    { from: 'kunming', to: 'mohan', mode: 'rail', op: 'lcr', service: 'Laos–China Railway EMU', hours: 4.5, usd: 40, cls: '2nd class seat', confidence: 'reported' },
    { from: 'mohan', to: 'boten', mode: 'rail', op: 'lcr', service: 'Laos–China Railway EMU', hours: 0.4, usd: 3, border: 'boten', confidence: 'structural' },
    { from: 'boten', to: 'nateuy', mode: 'rail', op: 'lcr', service: 'Laos–China Railway EMU', hours: 0.5, usd: 4, confidence: 'reported' },
    { from: 'nateuy', to: 'namo', mode: 'rail', op: 'lcr', service: 'Laos–China Railway EMU', hours: 0.3, usd: 2, confidence: 'reported' },
    { from: 'namo', to: 'oudomxay', mode: 'rail', op: 'lcr', service: 'Laos–China Railway EMU', hours: 0.3, usd: 3, confidence: 'reported' },
    { from: 'oudomxay', to: 'nga', mode: 'rail', op: 'lcr', service: 'Laos–China Railway EMU', hours: 0.5, usd: 4, confidence: 'reported' },
    { from: 'nga', to: 'luangprabang', mode: 'rail', op: 'lcr', service: 'Laos–China Railway EMU', hours: 0.5, usd: 4, confidence: 'reported' },
    { from: 'luangprabang', to: 'kasi', mode: 'rail', op: 'lcr', service: 'Laos–China Railway EMU', hours: 0.5, usd: 4, scenic: true, confidence: 'reported' },
    { from: 'kasi', to: 'vangvieng', mode: 'rail', op: 'lcr', service: 'Laos–China Railway EMU', hours: 0.5, usd: 4, scenic: true, confidence: 'reported' },
    { from: 'vangvieng', to: 'phonhong', mode: 'rail', op: 'lcr', service: 'Laos–China Railway EMU', hours: 0.5, usd: 4, confidence: 'reported' },
    { from: 'phonhong', to: 'vte_banthen', mode: 'rail', op: 'lcr', service: 'Laos–China Railway EMU', hours: 0.5, usd: 4, confidence: 'reported' },

    // === The Vientiane gauge break =====================================
    { from: 'vte_banthen', to: 'vte_khamsavath', mode: 'road', op: 'transfer', service: 'Taxi across Vientiane', hours: 0.75, usd: 12, essential: true, km: 15,
      confidence: 'structural',
      note: 'Two unconnected railways on two gauges, 15 km apart. There is no rail link and there will not be one soon. Expect a taxi queue when a full train empties out.' },

    // === Thai–Lao metre gauge ==========================================
    { from: 'vte_khamsavath', to: 'nongkhai', mode: 'rail', op: 'srt', service: 'Rapid 133/134 · Special Express 25/26', hours: 0.4, usd: 2, border: 'nongkhai', confidence: 'structural' },

    // === SRT northeast =================================================
    { from: 'nongkhai', to: 'udonthani', mode: 'rail', op: 'srt', service: 'Rapid 133/134 · Special Express 25/26', hours: 1.0, usd: 3, confidence: 'reported' },
    { from: 'udonthani', to: 'khonkaen', mode: 'rail', op: 'srt', service: 'Rapid 133/134 · Special Express 25/26', hours: 2.0, usd: 6, confidence: 'reported' },
    { from: 'khonkaen', to: 'korat', mode: 'rail', op: 'srt', service: 'Rapid 133/134 · Special Express 25/26', hours: 3.0, usd: 9, confidence: 'reported' },
    { from: 'korat', to: 'pakchong', mode: 'rail', op: 'srt', service: 'Rapid 133/134 · Special Express 25/26', hours: 1.5, usd: 5, confidence: 'reported' },
    { from: 'pakchong', to: 'bkk_aphiwat', mode: 'rail', op: 'srt', service: 'Rapid 133/134 · Special Express 25/26', hours: 3, usd: 9, sleeper: true, confidence: 'reported' },
    { from: 'korat', to: 'buriram', mode: 'rail', op: 'srt', service: 'Special Express / Rapid (Isaan)', hours: 2, usd: 5, confidence: 'reported' },
    { from: 'buriram', to: 'surin', mode: 'rail', op: 'srt', service: 'Special Express / Rapid (Isaan)', hours: 1, usd: 3, confidence: 'reported' },
    { from: 'surin', to: 'ubon', mode: 'rail', op: 'srt', service: 'Special Express / Rapid (Isaan)', hours: 2.5, usd: 5, confidence: 'reported' },

    // === SRT north =====================================================
    { from: 'bkk_aphiwat', to: 'ayutthaya', mode: 'rail', op: 'srt', service: 'Special Express 9/10 · northern line', hours: 1.3, usd: 2, confidence: 'reported' },
    { from: 'ayutthaya', to: 'lopburi', mode: 'rail', op: 'srt', service: 'Special Express 9/10 · northern line', hours: 1, usd: 3, confidence: 'reported' },
    { from: 'lopburi', to: 'phitsanulok', mode: 'rail', op: 'srt', service: 'Special Express 9/10 · northern line', hours: 2.5, usd: 8, confidence: 'reported' },
    { from: 'phitsanulok', to: 'lampang', mode: 'rail', op: 'srt', service: 'Special Express 9/10 · northern line', hours: 5, usd: 15, sleeper: true, scenic: true, confidence: 'reported',
      note: 'Trains 9/10 are the region\'s best sleeper. 2nd class A/C lower berth is the value sweet spot.' },
    { from: 'lampang', to: 'chiangmai', mode: 'rail', op: 'srt', service: 'Special Express 9/10 · northern line', hours: 2.5, usd: 7, scenic: true, confidence: 'reported' },

    // === Death Railway branch ==========================================
    { from: 'bkk_aphiwat', to: 'bkk_thonburi', mode: 'road', op: 'transfer', service: 'Taxi / MRT across Bangkok', hours: 0.6, usd: 5, essential: true, confidence: 'structural' },
    { from: 'bkk_thonburi', to: 'kanchanaburi', mode: 'rail', op: 'srt', service: 'Ordinary 257/259', hours: 2.5, usd: 3, scenic: true, confidence: 'reported' },
    { from: 'kanchanaburi', to: 'namtok', mode: 'rail', op: 'srt', service: 'Ordinary 257/259', hours: 2.0, usd: 2, scenic: true, confidence: 'reported',
      note: 'The Death Railway. The Wampo viaduct section is the reason to take it.' },

    // === SRT east — Cambodia ===========================================
    { from: 'bkk_aphiwat', to: 'bkk_hualamphong', mode: 'road', op: 'metro', service: 'MRT Blue Line, 2 stops', hours: 0.4, usd: 1, essential: true, confidence: 'structural' },
    { from: 'bkk_hualamphong', to: 'chachoengsao', mode: 'rail', op: 'srt', service: 'Ordinary 275/279', hours: 1.5, usd: 0.6, cls: '3rd class fan', confidence: 'reported' },
    { from: 'chachoengsao', to: 'aranyaprathet', mode: 'rail', op: 'srt', service: 'Ordinary 275/279', hours: 4, usd: 1.4, cls: '3rd class fan', confidence: 'reported' },
    { from: 'aranyaprathet', to: 'poipet', mode: 'road', op: 'transfer', service: 'Tuk-tuk / on foot through the border complex', hours: 0.5, usd: 2, essential: true, border: 'poipet', confidence: 'structural' },
    { from: 'poipet', to: 'sisophon', mode: 'rail', op: 'rrc', service: 'Royal Railway northern line', hours: 1, usd: 1.5, confidence: 'verify',
      note: 'Verify the train runs at all on your date — frequency is often weekends plus selected days.' },
    { from: 'sisophon', to: 'battambang', mode: 'rail', op: 'rrc', service: 'Royal Railway northern line', hours: 3, usd: 4.5, confidence: 'verify' },
    { from: 'battambang', to: 'pursat', mode: 'rail', op: 'rrc', service: 'Royal Railway northern line', hours: 3, usd: 3.5, confidence: 'verify' },
    { from: 'pursat', to: 'phnompenh', mode: 'rail', op: 'rrc', service: 'Royal Railway northern line', hours: 4, usd: 4.5, confidence: 'verify' },
    { from: 'phnompenh', to: 'takeo', mode: 'rail', op: 'rrc', service: 'Royal Railway southern line', hours: 1.5, usd: 3, confidence: 'verify' },
    { from: 'takeo', to: 'kampot', mode: 'rail', op: 'rrc', service: 'Royal Railway southern line', hours: 2.5, usd: 4, confidence: 'verify' },
    { from: 'kampot', to: 'sihanoukville', mode: 'rail', op: 'rrc', service: 'Royal Railway southern line', hours: 2.0, usd: 4, scenic: true, confidence: 'verify' },
    { from: 'phnompenh', to: 'saigon', mode: 'road', op: 'giantibis', service: 'Giant Ibis / Mekong Express coach', hours: 7.0, usd: 15, border: 'bavet', confidence: 'reported',
      note: 'No railway exists on this corridor and none is under construction. This is a bus, and calling it anything else would be dishonest.' },

    // === SRT south =====================================================
    { from: 'bkk_aphiwat', to: 'huahin', mode: 'rail', op: 'srt', service: 'Special Express 45/46 (Bangkok – Padang Besar)', hours: 3.5, usd: 9, confidence: 'reported' },
    { from: 'huahin', to: 'prachuap', mode: 'rail', op: 'srt', service: 'Special Express 45/46 (Bangkok – Padang Besar)', hours: 1.5, usd: 4, confidence: 'reported' },
    { from: 'prachuap', to: 'chumphon', mode: 'rail', op: 'srt', service: 'Special Express 45/46 (Bangkok – Padang Besar)', hours: 2.5, usd: 7, sleeper: true, confidence: 'reported' },
    { from: 'chumphon', to: 'suratthani', mode: 'rail', op: 'srt', service: 'Special Express 45/46 (Bangkok – Padang Besar)', hours: 2.5, usd: 7, confidence: 'reported' },
    { from: 'suratthani', to: 'phatthalung', mode: 'rail', op: 'srt', service: 'Special Express 45/46 (Bangkok – Padang Besar)', hours: 3.5, usd: 9, confidence: 'reported' },
    { from: 'phatthalung', to: 'hatyai', mode: 'rail', op: 'srt', service: 'Special Express 45/46 (Bangkok – Padang Besar)', hours: 1.5, usd: 4, confidence: 'reported' },
    { from: 'suratthani', to: 'trang', mode: 'rail', op: 'srt', service: 'Trang branch via Thung Song', hours: 3.5, usd: 9, confidence: 'reported' },
    { from: 'hatyai', to: 'padangbesar', mode: 'rail', op: 'srt', service: 'Special Express 45/46 (Bangkok – Padang Besar)', hours: 1.0, usd: 3, border: 'padangbesar', confidence: 'reported' },
    { from: 'hatyai', to: 'sungaikolok', mode: 'rail', op: 'srt', service: 'Rapid / Ordinary', hours: 4.0, usd: 6, advisory: 'deepsouth', confidence: 'reported' },

    // === Thai island branches ==========================================
    { from: 'suratthani', to: 'donsak', mode: 'road', op: 'transfer', service: 'Connecting bus from Phun Phin station', hours: 1.5, usd: 5, essential: true, confidence: 'reported' },
    { from: 'donsak', to: 'kohsamui', mode: 'ferry', op: 'rajaferry', service: 'Raja / Seatran vehicle ferry', hours: 1.5, usd: 6, seasonal: 'gulf', confidence: 'reported',
      note: 'Combined train + bus + ferry tickets are widely sold and remove most of the friction.' },
    { from: 'trang', to: 'kohlanta', mode: 'ferry', op: 'localferry', service: 'Minivan to pier, then ferry', hours: 3.0, usd: 15, seasonal: 'andaman', confidence: 'verify' },
    { from: 'chumphon', to: 'ranong', mode: 'road', op: 'coach', service: 'Local bus', hours: 3.0, usd: 5, confidence: 'reported' },
    { from: 'ranong', to: 'kawthaung', mode: 'ferry', op: 'localferry', service: 'Longtail across the estuary', hours: 0.75, usd: 10, advisory: 'myanmar', confidence: 'verify' },

    // === Thailand ↔ Malaysia east coast ================================
    { from: 'sungaikolok', to: 'rantaupanjang', mode: 'road', op: 'transfer', service: 'On foot across the frontier bridge', hours: 0.5, usd: 1, essential: true, border: 'sungaikolok', advisory: 'deepsouth', confidence: 'structural' },
    { from: 'rantaupanjang', to: 'wakafbaharu', mode: 'road', op: 'transfer', service: 'Local taxi / bus', hours: 0.75, usd: 6, essential: true, confidence: 'reported' },
    { from: 'wakafbaharu', to: 'dabong', mode: 'rail', op: 'ktmb', service: 'Shuttle Timuran (Jungle Railway)', hours: 3, usd: 2.5, scenic: true, confidence: 'reported' },
    { from: 'dabong', to: 'guamusang', mode: 'rail', op: 'ktmb', service: 'Shuttle Timuran (Jungle Railway)', hours: 2, usd: 2, scenic: true, confidence: 'reported' },
    { from: 'guamusang', to: 'kualalipis', mode: 'rail', op: 'ktmb', service: 'Shuttle Timuran (Jungle Railway)', hours: 2, usd: 1.5, scenic: true, confidence: 'reported' },
    { from: 'kualalipis', to: 'jerantut', mode: 'rail', op: 'ktmb', service: 'Shuttle Timuran (Jungle Railway)', hours: 1.5, usd: 1.5, scenic: true, confidence: 'reported',
      note: 'Slow, scenic, cult status. Take it because the journey is the point, not to get anywhere.' },
    { from: 'jerantut', to: 'gemas', mode: 'rail', op: 'ktmb', service: 'Shuttle Timuran (Jungle Railway)', hours: 4.5, usd: 4.5, scenic: true, confidence: 'reported' },

    // === KTMB west coast spine =========================================
    { from: 'padangbesar', to: 'arau', mode: 'rail', op: 'ktmb', service: 'ETS (Padang Besar – KL Sentral)', hours: 0.4, usd: 2, confidence: 'reported' },
    { from: 'arau', to: 'alorsetar', mode: 'rail', op: 'ktmb', service: 'ETS (Padang Besar – KL Sentral)', hours: 0.6, usd: 2, confidence: 'reported' },
    { from: 'alorsetar', to: 'sungaipetani', mode: 'rail', op: 'ktmb', service: 'ETS (Padang Besar – KL Sentral)', hours: 0.6, usd: 2, confidence: 'reported' },
    { from: 'sungaipetani', to: 'butterworth', mode: 'rail', op: 'ktmb', service: 'ETS (Padang Besar – KL Sentral)', hours: 0.7, usd: 2, confidence: 'reported' },
    { from: 'butterworth', to: 'taiping', mode: 'rail', op: 'ktmb', service: 'ETS (Padang Besar – KL Sentral)', hours: 0.8, usd: 3, confidence: 'reported' },
    { from: 'taiping', to: 'ipoh', mode: 'rail', op: 'ktmb', service: 'ETS (Padang Besar – KL Sentral)', hours: 1, usd: 4, confidence: 'reported' },
    { from: 'ipoh', to: 'klsentral', mode: 'rail', op: 'ktmb', service: 'ETS (Padang Besar – KL Sentral)', hours: 2.3, usd: 10, confidence: 'reported' },
    { from: 'klsentral', to: 'seremban', mode: 'rail', op: 'ktmb', service: 'ETS (KL Sentral – JB Sentral)', hours: 0.8, usd: 3, confidence: 'reported' },
    { from: 'seremban', to: 'gemas', mode: 'rail', op: 'ktmb', service: 'ETS (KL Sentral – JB Sentral)', hours: 1.4, usd: 5, confidence: 'reported' },
    { from: 'gemas', to: 'segamat', mode: 'rail', op: 'ktmb', service: 'ETS (KL Sentral – JB Sentral)', hours: 0.4, usd: 2, confidence: 'reported',
      note: 'Electrified December 2025. KL–JB is now about 4h10 end to end; guides written before then still say 7 hours and a change at Gemas.' },
    { from: 'segamat', to: 'kluang', mode: 'rail', op: 'ktmb', service: 'ETS (KL Sentral – JB Sentral)', hours: 0.8, usd: 4, confidence: 'reported' },
    { from: 'kluang', to: 'jbsentral', mode: 'rail', op: 'ktmb', service: 'ETS (KL Sentral – JB Sentral)', hours: 0.7, usd: 3, confidence: 'reported' },
    { from: 'klsentral', to: 'tampin', mode: 'rail', op: 'ktmb', service: 'ETS (via Tampin)', hours: 1.5, usd: 6, confidence: 'reported' },
    { from: 'tampin', to: 'gemas', mode: 'rail', op: 'ktmb', service: 'ETS (via Tampin)', hours: 0.7, usd: 3, confidence: 'reported' },
    { from: 'klsentral', to: 'portklang', mode: 'rail', op: 'ktmb', service: 'KTM Komuter', hours: 1.2, usd: 2, confidence: 'reported' },

    // === Malaysian sea branches ========================================
    { from: 'butterworth', to: 'georgetown', mode: 'ferry', op: 'penangferry', service: 'Penang ferry', hours: 0.25, usd: 1, essential: true, scenic: true, confidence: 'structural',
      note: 'Berths beside the KTMB station. Take it over the bridge bus every time — the approach to George Town by water is one of the better moments on the whole spine.' },
    { from: 'arau', to: 'kualaperlis', mode: 'road', op: 'transfer', service: 'Taxi from Arau station', hours: 0.5, usd: 5, essential: true, confidence: 'reported' },
    { from: 'kualaperlis', to: 'langkawi', mode: 'ferry', op: 'langkawiferry', service: 'Langkawi fast ferry', hours: 1.25, usd: 5, seasonal: 'andaman', confidence: 'reported',
      note: 'Puts a genuine rest day right at the Thai–Malaysian border, which is exactly where a long spine journey needs one.' },
    { from: 'tampin', to: 'melaka', mode: 'road', op: 'transfer', service: 'Bus / taxi from Pulau Sebang', hours: 0.75, usd: 5, essential: true, confidence: 'reported' },

    // === Malaysia ↔ Singapore ==========================================
    { from: 'jbsentral', to: 'woodlands', mode: 'rail', op: 'ktmb', service: 'Shuttle Tebrau', hours: 0.1, usd: 1.2, border: 'woodlands', confidence: 'structural',
      note: 'Five minutes of track and the most reliably sold-out service in Southeast Asia. Book it the instant the window opens.' },
    { from: 'woodlands', to: 'singapore', mode: 'road', op: 'metro', service: 'MRT Thomson–East Coast Line', hours: 0.5, usd: 1.5, essential: true, confidence: 'structural' },

    // === Singapore / Malaysia ↔ Indonesia ==============================
    { from: 'singapore', to: 'batam', mode: 'ferry', op: 'riauferry', service: 'HarbourFront or Tanah Merah fast ferry', hours: 1.0, usd: 18, border: 'batam', confidence: 'reported',
      note: 'This is how you get past Singapore\'s dead end. Full immigration both ends.' },
    { from: 'batam', to: 'dumai', mode: 'ferry', op: 'riauferry', service: 'Riau inter-island ferry', hours: 6.0, usd: 30, confidence: 'verify',
      note: 'Schedules and operators on the Riau routes change often. Verify before you rely on it.' },
    { from: 'melaka', to: 'dumai', mode: 'ferry', op: 'riauferry', service: 'Melaka–Dumai international ferry', hours: 3.0, usd: 40, border: 'dumai', confidence: 'verify',
      note: 'The elegant Malaysia→Sumatra continuation when it runs — but this route has suspended and resumed repeatedly. Verify, and have the Batam routing as fallback.' },
    { from: 'portklang', to: 'dumai', mode: 'ferry', op: 'riauferry', service: 'Port Klang–Dumai international ferry', hours: 5.0, usd: 45, border: 'dumai', confidence: 'verify' },
    { from: 'georgetown', to: 'belawan', mode: 'ferry', op: 'riauferry', service: 'Penang–Belawan ferry', hours: 5.0, usd: 50, border: 'belawan', confidence: 'verify',
      note: 'Historically operated, intermittent. When running it shortcuts the whole peninsula.' },

    // === Sumatra =======================================================
    { from: 'belawan', to: 'medan', mode: 'road', op: 'transfer', service: 'Taxi / bus', hours: 0.5, usd: 5, essential: true, confidence: 'reported' },
    { from: 'medan', to: 'pekanbaru', mode: 'road', op: 'coach', service: 'Long-distance coach', hours: 14.0, usd: 20, confidence: 'reported',
      note: 'North Sumatra\'s railway does not reach south Sumatra\'s. This gap is road, and it is the least pleasant day of any Singapore–Bali itinerary.' },
    { from: 'dumai', to: 'pekanbaru', mode: 'road', op: 'coach', service: 'Coach', hours: 3.0, usd: 8, confidence: 'reported' },
    { from: 'pekanbaru', to: 'palembang', mode: 'road', op: 'coach', service: 'Long-distance coach', hours: 12.0, usd: 20, confidence: 'reported' },
    { from: 'palembang', to: 'bandarlampung', mode: 'rail', op: 'kai', service: 'Rajabasa / Sriwijaya', hours: 9.0, usd: 8, sleeper: true, confidence: 'reported',
      note: 'South Sumatra\'s isolated network. Pleasant, and a relief after the coaches.' },
    { from: 'bandarlampung', to: 'bakauheni', mode: 'road', op: 'damri', service: 'Damri bus', hours: 2.0, usd: 4, essential: true, confidence: 'reported' },
    { from: 'bakauheni', to: 'merak', mode: 'ferry', op: 'asdp', service: 'ASDP ferry', hours: 2.0, usd: 1.5, essential: true, confidence: 'reported',
      note: 'Very frequent, around the clock. Usually taken as a through bus-plus-ferry ticket.' },

    // === Java ==========================================================
    { from: 'merak', to: 'jakarta', mode: 'rail', op: 'kai', service: 'KAI Commuter via Rangkasbitung', hours: 3.5, usd: 1, confidence: 'reported' },
    { from: 'jakarta', to: 'bandung', mode: 'rail', op: 'kai', service: 'Whoosh high-speed', hours: 0.75, usd: 15, confidence: 'reported',
      note: 'Whoosh runs Halim–Tegalluar in about 45 minutes. The conventional Argo Parahyangan from Gambir takes ~3 h and is the prettier ride.' },
    { from: 'bandung', to: 'purwokerto', mode: 'rail', op: 'kai', service: 'Argo Wilis / Turangga', hours: 4, usd: 8, scenic: true, confidence: 'reported' },
    { from: 'purwokerto', to: 'yogyakarta', mode: 'rail', op: 'kai', service: 'Argo Wilis / Turangga', hours: 2.5, usd: 4, scenic: true, confidence: 'reported' },
    { from: 'yogyakarta', to: 'solo', mode: 'rail', op: 'kai', service: 'Argo / Bima', hours: 1, usd: 2, confidence: 'reported' },
    { from: 'solo', to: 'surabaya', mode: 'rail', op: 'kai', service: 'Argo / Bima', hours: 3.5, usd: 8, confidence: 'reported' },
    { from: 'surabaya', to: 'probolinggo', mode: 'rail', op: 'kai', service: 'Mutiara Timur / Probowangi', hours: 2, usd: 3, confidence: 'reported' },
    { from: 'probolinggo', to: 'jember', mode: 'rail', op: 'kai', service: 'Mutiara Timur / Probowangi', hours: 2.5, usd: 3, scenic: true, confidence: 'reported' },
    { from: 'jember', to: 'banyuwangi', mode: 'rail', op: 'kai', service: 'Mutiara Timur / Probowangi', hours: 2, usd: 2, scenic: true, confidence: 'reported' },
    { from: 'banyuwangi', to: 'gilimanuk', mode: 'ferry', op: 'asdp', service: 'ASDP Ketapang–Gilimanuk', hours: 0.75, usd: 1, essential: true, confidence: 'structural',
      note: 'Runs around the clock, pier beside the station. The dawn crossing is the one people remember.' },
    { from: 'gilimanuk', to: 'denpasar', mode: 'road', op: 'transfer', service: 'Bus / private car', hours: 4.0, usd: 10, essential: true, confidence: 'reported' },

    // === Vietnam =======================================================
    { from: 'vte_khamsavath', to: 'hanoi', mode: 'road', op: 'coach', service: 'Sleeper coach via Nam Phao / Cau Treo', hours: 20.0, usd: 30, border: 'namphao', confidence: 'reported',
      note: 'There is no railway between Laos and Vietnam. None is built and none is imminent. This is a twenty-hour bus and it should be planned as one — the coach leaves from Vientiane\'s bus terminal, not from either railway station.' },
    { from: 'hanoi', to: 'ninhbinh', mode: 'rail', op: 'dsvn', service: 'Reunification Express (SE1–SE8)', hours: 2, usd: 4, confidence: 'reported' },
    { from: 'ninhbinh', to: 'thanhhoa', mode: 'rail', op: 'dsvn', service: 'Reunification Express (SE1–SE8)', hours: 1.5, usd: 3, confidence: 'reported' },
    { from: 'thanhhoa', to: 'vinh', mode: 'rail', op: 'dsvn', service: 'Reunification Express (SE1–SE8)', hours: 2.5, usd: 5, sleeper: true, confidence: 'reported' },
    { from: 'vinh', to: 'donghoi', mode: 'rail', op: 'dsvn', service: 'Reunification Express (SE1–SE8)', hours: 4, usd: 8, sleeper: true, confidence: 'reported' },
    { from: 'donghoi', to: 'hue', mode: 'rail', op: 'dsvn', service: 'Reunification Express (SE1–SE8)', hours: 3, usd: 7, confidence: 'reported' },
    { from: 'hue', to: 'danang', mode: 'rail', op: 'dsvn', service: 'Reunification Express (SE1–SE8)', hours: 3.0, usd: 5, scenic: true, confidence: 'reported',
      note: 'The Hải Vân pass. Among the best rail scenery in Asia — take a daytime train and sit on the sea side.' },
    { from: 'danang', to: 'quangngai', mode: 'rail', op: 'dsvn', service: 'Reunification Express (SE1–SE8)', hours: 3, usd: 6, confidence: 'reported' },
    { from: 'quangngai', to: 'dieutri', mode: 'rail', op: 'dsvn', service: 'Reunification Express (SE1–SE8)', hours: 3.5, usd: 8, sleeper: true, confidence: 'reported' },
    { from: 'dieutri', to: 'nhatrang', mode: 'rail', op: 'dsvn', service: 'Reunification Express (SE1–SE8)', hours: 3.5, usd: 8, confidence: 'reported' },
    { from: 'nhatrang', to: 'thapcham', mode: 'rail', op: 'dsvn', service: 'Reunification Express (SE1–SE8)', hours: 1.5, usd: 4, confidence: 'reported' },
    { from: 'thapcham', to: 'muongman', mode: 'rail', op: 'dsvn', service: 'Reunification Express (SE1–SE8)', hours: 2.5, usd: 6, confidence: 'reported' },
    { from: 'muongman', to: 'saigon', mode: 'rail', op: 'dsvn', service: 'Reunification Express (SE1–SE8)', hours: 4, usd: 8, sleeper: true, confidence: 'reported' },
    { from: 'hanoi', to: 'laocai', mode: 'rail', op: 'dsvn', service: 'SP1–SP4 (overnight, for Sapa)', hours: 8.0, usd: 20, sleeper: true, confidence: 'reported' },
    { from: 'hanoi', to: 'haiphong', mode: 'rail', op: 'dsvn', service: 'HP1/HP2/LP3', hours: 2.5, usd: 4, confidence: 'reported' },
    { from: 'hanoi', to: 'dongdang', mode: 'rail', op: 'dsvn', service: 'DD3/DD4', hours: 4.0, usd: 6, confidence: 'verify',
      note: 'Cross-border passenger service to China from here has been intermittent for years. Treat the frontier as closed unless you have confirmed otherwise.' },

    { from: 'suratthani', to: 'nakhonsi', mode: 'rail', op: 'srt', service: 'Nakhon Si Thammarat branch', hours: 3, usd: 8, confidence: 'reported' },
    { from: 'jakarta', to: 'cirebon', mode: 'rail', op: 'kai', service: 'KAI north-coast line', hours: 3, usd: 6, confidence: 'reported' },
    { from: 'cirebon', to: 'semarang', mode: 'rail', op: 'kai', service: 'KAI north-coast line', hours: 3, usd: 6, scenic: true, confidence: 'reported' },
    { from: 'semarang', to: 'surabaya', mode: 'rail', op: 'kai', service: 'KAI north-coast line', hours: 4, usd: 8, confidence: 'reported' },
    { from: 'surabaya', to: 'malang', mode: 'rail', op: 'kai', service: 'KAI (Surabaya – Malang)', hours: 2, usd: 4, scenic: true, confidence: 'reported' },

    // === Mekong slow boat ==============================================
    { from: 'chiangmai', to: 'chiangkhong', mode: 'road', op: 'greenbus', service: 'Green Bus via Chiang Rai', hours: 6, usd: 12, essential: true, confidence: 'reported' },
    { from: 'chiangkhong', to: 'huayxai', mode: 'road', op: 'transfer', service: 'Shuttle over the Fourth Thai–Lao Friendship Bridge', hours: 0.5, usd: 2, essential: true, border: 'huayxai', confidence: 'structural' },
    { from: 'huayxai', to: 'pakbeng', mode: 'ferry', op: 'mekongboat', service: 'Mekong slow boat (day 1)', hours: 6, usd: 15, scenic: true, confidence: 'reported',
      note: 'Two days downriver with a night at Pakbeng. The speedboat alternative does it in one day and has a genuinely bad safety record — take the slow boat.' },
    { from: 'pakbeng', to: 'luangprabang', mode: 'ferry', op: 'mekongboat', service: 'Mekong slow boat (day 2)', hours: 8, usd: 15, scenic: true, confidence: 'reported' },

    // === Gulf of Thailand islands ======================================
    { from: 'chumphon', to: 'kohtao', mode: 'ferry', op: 'lomprayah', service: 'Lomprayah / Songserm catamaran', hours: 1.75, usd: 17, seasonal: 'gulf', confidence: 'reported',
      note: 'The pier is at Thung Makham Noi, a short transfer from Chumphon station, and the boats are timed off the overnight trains from Bangkok.' },
    { from: 'kohtao', to: 'kohphangan', mode: 'ferry', op: 'lomprayah', service: 'Lomprayah catamaran', hours: 1.5, usd: 12, seasonal: 'gulf', scenic: true, confidence: 'reported' },
    { from: 'kohphangan', to: 'kohsamui', mode: 'ferry', op: 'lomprayah', service: 'Lomprayah / Raja ferry', hours: 0.5, usd: 9, seasonal: 'gulf', confidence: 'reported' },

    // === Andaman islands ===============================================
    { from: 'trang', to: 'krabi', mode: 'road', op: 'transfer', service: 'Minivan', hours: 2, usd: 6, essential: true, confidence: 'reported' },
    { from: 'krabi', to: 'kohphiphi', mode: 'ferry', op: 'localferry', service: 'Andaman Wave / Ao Nang Princess', hours: 2, usd: 14, seasonal: 'andaman', scenic: true, confidence: 'reported' },
    { from: 'kohphiphi', to: 'kohlanta', mode: 'ferry', op: 'localferry', service: 'Island-hopper ferry', hours: 1.5, usd: 12, seasonal: 'andaman', confidence: 'verify',
      note: 'Runs in high season only. Out of season the connection is back via Krabi by road.' },
    { from: 'kohphiphi', to: 'phuket', mode: 'ferry', op: 'localferry', service: 'Phi Phi – Rassada ferry', hours: 2, usd: 14, seasonal: 'andaman', confidence: 'reported' },

    // === Thailand ↔ Malaysia by sea ====================================
    { from: 'hatyai', to: 'satun', mode: 'road', op: 'transfer', service: 'Minivan to Tammalang pier', hours: 2, usd: 7, essential: true, confidence: 'reported' },
    { from: 'satun', to: 'langkawi', mode: 'ferry', op: 'langkawiferry', service: 'Tammalang – Kuah international ferry', hours: 1.5, usd: 12, border: 'satun', seasonal: 'andaman', confidence: 'verify',
      note: 'A sea border, and the one way to reach Malaysia from Thailand without touching Padang Besar. Sailings are few per day and stop early — missing the last one strands you in Satun.' },

    // === More Langkawi piers ===========================================
    { from: 'alorsetar', to: 'kualakedah', mode: 'road', op: 'transfer', service: 'Taxi from Alor Setar station', hours: 0.4, usd: 4, essential: true, confidence: 'reported' },
    { from: 'kualakedah', to: 'langkawi', mode: 'ferry', op: 'langkawiferry', service: 'Kuala Kedah – Kuah ferry', hours: 1.75, usd: 6, seasonal: 'andaman', confidence: 'reported' },
    { from: 'georgetown', to: 'langkawi', mode: 'ferry', op: 'langkawiferry', service: 'Penang – Langkawi ferry', hours: 2.75, usd: 18, seasonal: 'andaman', confidence: 'verify',
      note: 'Operates seasonally and has suspended before. Verify it is running rather than assuming it.' },

    // === Cambodia: Angkor, the Tonlé Sap and the islands ===============
    { from: 'sisophon', to: 'siemreap', mode: 'road', op: 'transfer', service: 'Bus / shared taxi', hours: 2, usd: 6, essential: true, confidence: 'reported' },
    { from: 'phnompenh', to: 'siemreap', mode: 'ferry', op: 'tonlesap', service: 'Tonlé Sap fast boat', hours: 6, usd: 35, scenic: true, confidence: 'verify',
      note: 'Only runs when the lake is high, roughly August to March, and it is a hot crowded six hours. People take it for the floating villages, not the comfort.' },
    { from: 'sihanoukville', to: 'kohrong', mode: 'ferry', op: 'speedferry', service: 'Speed Ferry Cambodia', hours: 0.75, usd: 12, scenic: true, confidence: 'reported' },

    // === Vietnam by water ==============================================
    { from: 'haiphong', to: 'catba', mode: 'ferry', op: 'localferry', service: 'Cát Bà fast ferry', hours: 1, usd: 10, scenic: true, confidence: 'reported',
      note: 'The practical way into Hạ Long Bay from the railway, rather than a coach from Hanoi.' },
    { from: 'saigon', to: 'chaudoc', mode: 'road', op: 'coach', service: 'Coach into the Mekong Delta', hours: 6, usd: 12, confidence: 'reported' },
    { from: 'chaudoc', to: 'phnompenh', mode: 'ferry', op: 'hangchau', service: 'Mekong river boat (Hang Chau / Blue Cruiser)', hours: 5, usd: 35, border: 'chaudoc', scenic: true, confidence: 'verify',
      note: 'The only Vietnam–Cambodia crossing that is not a road. Immigration happens on the riverbank at Vĩnh Xương and Kaam Samnor while the boat waits.' },

    // === Sabah ↔ Brunei ================================================
    { from: 'kotakinabalu', to: 'labuan', mode: 'ferry', op: 'localferry', service: 'Labuan express ferry', hours: 3, usd: 15, confidence: 'reported' },
    { from: 'labuan', to: 'bandarseri', mode: 'ferry', op: 'localferry', service: 'Labuan – Muara ferry', hours: 1.5, usd: 12, border: 'brunei', confidence: 'verify' },

    // === Bali onward ===================================================
    { from: 'denpasar', to: 'padangbai', mode: 'road', op: 'transfer', service: 'Shuttle to the port', hours: 1.5, usd: 6, essential: true, confidence: 'reported' },
    { from: 'padangbai', to: 'mataram', mode: 'ferry', op: 'asdp', service: 'ASDP Padangbai – Lembar', hours: 4.5, usd: 4, scenic: true, confidence: 'reported',
      note: 'Slow, cheap and rolls in the strait. The tourist fast boats do it in under two hours from Padangbai or Serangan.' },
    { from: 'mataram', to: 'gili', mode: 'ferry', op: 'localferry', service: 'Bangsal – Gili public boat', hours: 0.75, usd: 3, scenic: true, confidence: 'reported' },

    // === Sabah (isolated) ==============================================
    { from: 'kotakinabalu', to: 'tenom', mode: 'rail', op: 'ktmb', service: 'Sabah State Railway', hours: 2.5, usd: 5, scenic: true, confidence: 'reported' },
  ],

  /* ----------------------------------------------------------------- borders
   * The part of the product nobody else writes. Mechanics first, then the trap.
   */
  borders: {
    boten: {
      name: 'Boten ↔ Mohan', countries: 'Laos ↔ China', at: 'On the train, stopping at both stations',
      minutes: 90,
      stayOnTrain: 'Off and on — Lao exit at Boten, re-board, Chinese entry at Mohan',
      luggage: 'Partial — off for scanning at Mohan',
      visa: 'A Chinese visa must already be in your passport. There is no reliable visa-on-arrival at the Mohan railway checkpoint.',
      hard: true,
      cash: 'Carry a small amount of Chinese yuan — border ATMs fail routinely.',
      trap: 'China\'s transit-visa-free and unilateral visa-free arrangements are usually air-arrival specific. Do not assume a policy that works at an airport works at a land rail crossing. This is the crossing that most often defeats travellers, and it defeats them on documents rather than logistics.',
      verify: true,
    },
    nongkhai: {
      name: 'Khamsavath ↔ Nong Khai', countries: 'Laos ↔ Thailand', at: 'Lao formalities at Khamsavath, Thai immigration and customs at Nong Khai',
      minutes: 60,
      stayOnTrain: 'Yes, on the through sleeper',
      luggage: 'Yes — all luggage comes off the train at Nong Khai for customs',
      visa: 'Lao visa-on-arrival is generally available; Thai entry is visa-exempt for many nationalities. Confirm for your passport.',
      cash: 'Small amounts of Thai baht and Lao kip.',
      trap: 'You must take every bag off the train at Nong Khai for customs. Travellers who do not know this get caught out at night, half asleep, and hold up the carriage. Separately: arriving at Khamsavath does not put you on the Laos–China Railway — that is Banthen, 15 km away, different gauge, separate ticket.',
    },
    padangbesar: {
      name: 'Padang Besar', countries: 'Thailand ↔ Malaysia', at: 'Joint station — both countries\' immigration inside the same building, at platform level',
      minutes: 90,
      stayOnTrain: 'No — you change trains here',
      luggage: 'Yes',
      visa: 'Malaysian entry is visa-free for many nationalities and generally quick. The queue depends entirely on whether a full SRT train just arrived.',
      cash: 'Malaysian ringgit for the ETS ticket if you have not pre-booked.',
      trap: 'Malaysia is UTC+8, Thailand UTC+7. SRT publishes Padang Besar departures in Thai time; KTMB publishes them in Malaysian time. Read both operators\' sites and you will construct a connection exactly one hour different from reality — in the direction that makes you miss it. Convert everything to one clock before you book.',
      buffer: 'Minimum 90 minutes between scheduled SRT arrival and ETS departure. Given SRT\'s southbound punctuality, prefer two hours or an overnight in Hat Yai.',
    },
    woodlands: {
      name: 'JB Sentral ↔ Woodlands', countries: 'Malaysia ↔ Singapore', at: 'Southbound: both Malaysian exit and Singaporean entry cleared at JB Sentral before boarding',
      minutes: 45,
      stayOnTrain: 'Cleared before boarding — you arrive in Singapore already admitted',
      luggage: 'Yes',
      visa: 'Singapore entry is visa-free for most nationalities; an SG Arrival Card must be submitted online before arrival.',
      cash: 'Nothing needed — the leg is a few ringgit.',
      trap: 'The ticket, not the border. Five minutes of track and the most reliably sold-out service in the region. The road causeway is the fallback and can mean hours in traffic.',
      verify: true,
      verifyNote: 'Check whether the RTS Link (JB–Woodlands North metro) has opened — it was targeted for end-2026 and changes this crossing\'s capacity and mechanics entirely.',
    },
    poipet: {
      name: 'Aranyaprathet ↔ Poipet', countries: 'Thailand ↔ Cambodia', at: 'Border complex between the two railheads, crossed on foot or by short tuk-tuk',
      minutes: 180,
      stayOnTrain: 'No — SRT terminates at Aranyaprathet, Royal Railway starts at Poipet',
      luggage: 'Yes, carried across',
      visa: 'Get the Cambodian e-visa in advance. It removes most of the friction and most of the scam surface.',
      cash: 'US dollars in small notes — Cambodia runs on them, and border ATMs are unreliable.',
      trap: 'The region\'s most scam-prone crossing: fake "visa offices" positioned before the real one, inflated e-visa fees, invented "processing" charges. Use only the official immigration building and know the correct official fee before you arrive. Budget 2–3 hours end to end, more at weekends.',
      verify: true,
      verifyNote: 'Verify whether a Royal Railway train runs at all on your arrival day, or plan a night in Poipet or Battambang.',
    },
    sungaikolok: {
      name: 'Sungai Kolok ↔ Rantau Panjang', countries: 'Thailand ↔ Malaysia (east coast)', at: 'Frontier bridge, crossed on foot',
      minutes: 90,
      stayOnTrain: 'No — walk across, then local transport to Wakaf Baharu',
      luggage: 'Yes',
      visa: 'As Padang Besar. Malaysian entry generally straightforward.',
      cash: 'Ringgit for the taxi to Wakaf Baharu.',
      trap: 'Standing security advisories cover Thailand\'s far-southern provinces — Narathiwat, Yala and Pattani. Many governments advise against non-essential travel there. Check your own government\'s current position and decide deliberately. Only worth it if the Jungle Railway is the point of the trip.',
      advisory: true,
    },
    bavet: {
      name: 'Bavet ↔ Moc Bai', countries: 'Cambodia ↔ Vietnam', at: 'Road border — the coach handles the paperwork',
      minutes: 90,
      stayOnTrain: 'Bus stops, everyone off and back on',
      luggage: 'Yes',
      visa: 'Vietnamese e-visa should be obtained in advance — land borders do not reliably issue on arrival.',
      cash: 'Vietnamese dong for onward transport.',
      trap: 'There is no railway here and no prospect of one. Reputable operators (Giant Ibis, Mekong Express) handle the formalities as a group and are worth the small premium over local buses.',
    },
    namphao: {
      name: 'Nam Phao ↔ Cau Treo', countries: 'Laos ↔ Vietnam', at: 'Mountain road border, mid-journey on the sleeper coach',
      minutes: 120,
      stayOnTrain: 'Bus stops, everyone off and back on',
      luggage: 'Yes',
      visa: 'Vietnamese e-visa in advance. Confirm your chosen crossing point is one where e-visas are accepted.',
      cash: 'Small US dollar notes and Vietnamese dong.',
      trap: 'The crossing often happens in the small hours, and unofficial "stamping fees" are common here. It is the least comfortable border in this whole network, on the least comfortable leg.',
    },
    huayxai: {
      name: 'Chiang Khong ↔ Huay Xai', countries: 'Thailand ↔ Laos', at: 'Fourth Thai–Lao Friendship Bridge, by shuttle bus',
      minutes: 90,
      stayOnTrain: 'No — you cannot walk the bridge, a shuttle bus carries you across',
      luggage: 'Yes',
      visa: 'Lao visa-on-arrival is normally available here, in US dollars cash. Confirm for your passport before relying on it.',
      cash: 'Crisp, unmarked US dollar notes for the Lao visa fee, plus kip for the boat.',
      trap: 'The bridge is several kilometres outside both towns, so the crossing is two tuk-tuk rides with a bus in between. Do it the afternoon before the boat, not the same morning — the slow boat leaves Huay Xai early and does not wait.',
    },
    satun: {
      name: 'Tammalang ↔ Langkawi', countries: 'Thailand ↔ Malaysia (by sea)', at: 'Ferry terminal at each end',
      minutes: 60,
      stayOnTrain: 'n/a — immigration is in the terminal, not on the boat',
      luggage: 'Yes',
      visa: 'As at Padang Besar: Malaysian entry is visa-free for many nationalities. Confirm for your own passport.',
      cash: 'Ringgit for Langkawi; the Thai side takes baht only.',
      trap: 'Only a handful of sailings a day and they finish early in the afternoon. This is the one Thailand–Malaysia crossing where missing the last departure means a night in a town you had not planned to visit.',
      verify: true,
      verifyNote: 'Sailing times shift with the season and the operator has changed more than once. Confirm the current timetable before building a day around it.',
    },
    chaudoc: {
      name: 'Vĩnh Xương ↔ Kaam Samnor', countries: 'Vietnam ↔ Cambodia (by river)', at: 'Riverbank posts, with the boat waiting alongside',
      minutes: 120,
      stayOnTrain: 'Off the boat at each post, then back on',
      luggage: 'Yes',
      visa: 'Cambodian e-visa in advance. Coming the other way, a Vietnamese e-visa must name a land or river crossing you are allowed to use.',
      cash: 'US dollars in small notes for both sides.',
      trap: 'Unofficial "processing" and "overtime" fees are routine at this crossing, and the boat operator often collects passports as a group. Know the correct official fee, and expect the whole thing to take longer than the schedule claims.',
      verify: true,
    },
    brunei: {
      name: 'Labuan ↔ Muara', countries: 'Malaysia ↔ Brunei (by sea)', at: 'Ferry terminal at each end',
      minutes: 60,
      stayOnTrain: 'n/a',
      luggage: 'Yes',
      visa: 'Brunei is visa-free for many nationalities on short visits. Confirm for your own passport.',
      cash: 'Brunei dollars; Singapore dollars are accepted at par.',
      trap: 'Muara is a working port well outside Bandar Seri Begawan, and onward transport thins out in the evening. Both this leg and the Kota Kinabalu one are weather-dependent.',
      verify: true,
    },
    batam: {
      name: 'Singapore ↔ Batam', countries: 'Singapore ↔ Indonesia', at: 'Ferry terminal — immigration at the terminal, not on the boat',
      minutes: 60,
      stayOnTrain: 'n/a',
      luggage: 'Yes',
      visa: 'Indonesian visa-on-arrival or e-VOA is available to many nationalities at the main Batam terminals. Confirm the specific terminal is an international checkpoint.',
      cash: 'Indonesian rupiah.',
      trap: 'Some Riau ferry terminals are domestic-only. Arriving at the wrong one wastes a day.',
    },
    dumai: {
      name: 'Melaka / Port Klang ↔ Dumai', countries: 'Malaysia ↔ Indonesia', at: 'Ferry terminal',
      minutes: 90, stayOnTrain: 'n/a', luggage: 'Yes',
      visa: 'Indonesian VOA / e-VOA availability at Dumai is narrower than at the airports. Verify before committing.',
      cash: 'Indonesian rupiah.',
      trap: 'This route has suspended and resumed repeatedly. Do not build an itinerary on it without confirming it is currently running, and keep the Singapore–Batam routing as your fallback.',
      verify: true,
    },
    belawan: {
      name: 'Penang ↔ Belawan', countries: 'Malaysia ↔ Indonesia', at: 'Ferry terminal, Belawan (port for Medan)',
      minutes: 90, stayOnTrain: 'n/a', luggage: 'Yes',
      visa: 'Confirm Belawan is currently an international checkpoint issuing VOA.',
      cash: 'Indonesian rupiah.',
      trap: 'Historically operated, intermittent. Treat as unavailable until confirmed.',
      verify: true,
    },
  },

  /* -------------------------------------------------------------- advisories */
  advisories: {
    deepsouth: 'Thailand\'s far-southern provinces (Narathiwat, Yala, Pattani) carry standing security advisories, and many governments advise against non-essential travel there. The Sungai Kolok route passes through them. Check your own government\'s current position.',
    myanmar: 'Standing security advisories cover much of Myanmar. There is no through rail to Thailand in any case.',
  },

  /* -------------------------------------------------------------- seasonality
   * Dates that make sleepers genuinely unobtainable rather than merely dear.
   * Moveable feasts are approximate — the app labels them as such.
   */
  seasons: [
    { id: 'songkran', name: 'Songkran', from: '04-11', to: '04-17', fixed: true,
      hits: ['th'], text: 'The single worst week for Thai rail. Everything full, roads gridlocked, and it is not a queue you can talk your way through.' },
    { id: 'cny', name: 'Chinese New Year', from: '02-10', to: '02-24', fixed: false,
      hits: ['my', 'sg', 'cn'], text: 'Malaysian, Singaporean and every China-bound LCR service saturates. Dates move each year — check the actual date for your travel year.' },
    { id: 'eid', name: 'Hari Raya Aidilfitri', from: '03-18', to: '03-28', fixed: false,
      hits: ['my', 'id'], text: 'Malaysian and Indonesian rail is saturated for days either side. Dates shift ~11 days earlier each year — verify for your year.' },
    { id: 'thaipusam', name: 'Thaipusam', from: '01-28', to: '02-05', fixed: false,
      hits: ['my'], text: 'Malaysian peninsular services fill up. Moves with the lunar calendar.' },
    { id: 'tet', name: 'Tết', from: '02-10', to: '02-24', fixed: false,
      hits: ['vn'], text: 'Vietnamese rail effectively closes to tourists for a week either side. Dates move each year.' },
    { id: 'gulf', name: 'Gulf of Thailand monsoon', from: '10-15', to: '12-31', fixed: true,
      hits: ['th'], text: 'Roughest on the Gulf side. The Samui and Phangan ferries are the affected legs; cancellations cost a day.' },
    { id: 'andaman', name: 'Andaman monsoon', from: '05-01', to: '10-15', fixed: true,
      hits: ['th', 'my'], text: 'Andaman-side ferries (Lanta, Phi Phi, Langkawi) see rough crossings and occasional cancellation.' },
  ],

  /* ---------------------------------------------------- booking scarcity rank
   * Book in order of scarcity × window length, not chronological order.
   */
  scarcity: [
    { op: 'ktmb', service: 'Shuttle Tebrau', rank: 1, window: 'Short and brutal — book at the moment the window opens', why: 'The most reliably sold-out service in the region, despite being the shortest.' },
    { op: 'lcr', service: null, rank: 2, window: 'Historically days rather than weeks — verify the current window', why: 'Scarcest inventory in the region and the hardest to book independently from abroad.' },
    { op: 'srt', service: null, rank: 3, window: '~90 days', why: 'Sleepers on trains 9/10 and the southern overnights sell out first.' },
    { op: 'dsvn', service: null, rank: 4, window: '~60 days', why: 'Book on dsvn.vn — the lookalike domains are resellers.' },
    { op: 'rrc', service: null, rank: 5, window: 'Limited and short', why: 'Verify the train runs at all on your date before anything else.' },
    { op: 'kai', service: null, rank: 6, window: '~45 days', why: 'Plentiful, but the Bandung and Yogyakarta services fill at weekends.' },
    { op: 'ktmb', service: null, rank: 7, window: '~30 days, extended to ~6 months around major festivals', why: 'ETS is plentiful outside festival periods.' },
    { mode: 'ferry', rank: 8, window: 'Mostly turn-up-and-go', why: 'Langkawi and Samui routes are worth pre-booking in season, and the Mekong slow boat the day before you sail.' },
    { mode: 'road', rank: 9, window: 'Walk-up, except the long coaches', why: 'The Vientiane–Hanoi sleeper coach and the Sumatra runs are worth a day or two ahead.' },
  ],
}
