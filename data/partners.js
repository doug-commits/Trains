/* Where this project earns money, and where it deliberately does not.
 *
 * Transport stays clean. Every booking link on a leg goes straight to the
 * operator or aggregator and earns nothing, and the operator is listed first
 * because it is usually cheaper and always more reliable. That ordering is the
 * most load-bearing editorial judgement here and it is not for sale.
 *
 * Lodging and insurance are different. Nobody suspects a rail planner of
 * ranking KTMB above SRT for hotel money, the reader was going to book a bed
 * somewhere regardless, and the lodging section already does the work of
 * saying what a night costs — a link to check real dates is a service rather
 * than an interruption.
 *
 * IDs are empty until the accounts exist. An empty id is not a broken link:
 * the link still goes to a useful search, it simply earns nothing, and the
 * disclosure below reads correctly either way. Never invent one.
 *
 * Set them at build time:
 *   BOOKING_AID=1234567 SAFETYWING_REF=yourref node tools/build.mjs
 */

const PARTNERS = {
  // Booking.com Partner Programme. `aid` is the affiliate id.
  booking: {
    id: '',
    label: 'Check prices',
    /** Search for a place, optionally on the real dates of this leg. */
    url(city, country, checkin, checkout, id) {
      const q = encodeURIComponent([city, country].filter(Boolean).join(', '))
      const bits = [`ss=${q}`, 'lang=en-gb']
      if (checkin) bits.push(`checkin=${checkin}`)
      if (checkout) bits.push(`checkout=${checkout}`)
      if (id) bits.push(`aid=${encodeURIComponent(id)}`)
      return `https://www.booking.com/searchresults.html?${bits.join('&')}`
    },
  },

  /* SafetyWing Nomad Insurance. Chosen over the alternatives because it covers
   * land borders and long open-ended trips, which is what this audience is
   * actually doing — a policy that assumes you flew in and out is no use to
   * someone crossing Poipet on foot. */
  insurance: {
    id: '',
    name: 'SafetyWing',
    url(id) {
      return id
        ? `https://safetywing.com/nomad-insurance?referenceID=${encodeURIComponent(id)}`
        : 'https://safetywing.com/nomad-insurance'
    },
  },
}
