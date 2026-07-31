/* The launcher mark, once.
 *
 * The same geometry is cut into four things: the Android adaptive icon's two
 * vector drawables, the Play listing's 512px PNG, the iOS asset catalog's
 * 1024px PNG, and the launch screen inside the page itself. Four copies of a
 * drawing is four chances for one of them to be the old one, and the one that
 * goes stale is always the store asset nobody opens twice.
 *
 * The coordinates are Android's 108-unit adaptive-icon canvas, because that is
 * the only one of the four with a hard constraint attached: everything sits
 * inside the 66dp circle every launcher mask is guaranteed to leave alone —
 * the mark spans y 24 to 85 against a boundary at 21 and 87, and the widest
 * sleeper corner is 31.4 from centre against a radius of 33.
 */

export const INK = {
  sleeper: '#8CA9B0',
  rail: '#E9A63E',
  sea: '#57B6C8',
  skyTop: '#12303C',
  skyMid: '#0A191F',
  skyFoot: '#061217',
}

/* Rail while there is land, and a boat where the land ends. A track runs down
 * the icon on its sleepers in the same amber the map draws rail in, stops, and
 * carries on as two dashes in the same teal the map draws a ferry in. That is
 * exactly what the legend says and exactly what Bangkok to Bali looks like. */
export const MARK = {
  sleepers: [
    { x: 38, y: 27.5, w: 32, h: 5 },
    { x: 38, y: 37.5, w: 32, h: 5 },
    { x: 38, y: 47.5, w: 32, h: 5 },
    { x: 38, y: 57.5, w: 32, h: 5 },
  ],
  rail: { x: 49, y: 24, w: 10, h: 42 },
  sea: [
    { x: 49, y: 71, w: 10, h: 6 },
    { x: 49, y: 81, w: 10, h: 4 },
  ],
}

const rect = (r, fill) =>
  `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="1" fill="${fill}"/>`

/** The mark alone, in 108-unit coordinates, for compositing onto a ground. */
export const markSvg = () =>
  MARK.sleepers.map(r => rect(r, INK.sleeper)).join('') +
  rect(MARK.rail, INK.rail) +
  MARK.sea.map(r => rect(r, INK.sea)).join('')

/** A finished square icon.
 *
 * `viewBox` decides how much of the canvas is shown. A launcher displays the
 * middle 72 of the 108, so a store asset that shows all 108 comes out looking
 * like the mark shrank — every caller that wants "what a launcher shows"
 * should pass the 72 crop, which is the default.
 */
export const iconSvg = ({ size, crop = 72 } = {}) => {
  const inset = (108 - crop) / 2
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${inset} ${inset} ${crop} ${crop}"` +
    (size ? ` width="${size}" height="${size}"` : '') + `>
  <defs>
    <linearGradient id="sky" x1="54" y1="0" x2="54" y2="108" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${INK.skyTop}"/>
      <stop offset="0.55" stop-color="${INK.skyMid}"/>
      <stop offset="1" stop-color="${INK.skyFoot}"/>
    </linearGradient>
  </defs>
  <rect x="${inset}" y="${inset}" width="${crop}" height="${crop}" fill="url(#sky)"/>
  ${markSvg()}
</svg>`
}
