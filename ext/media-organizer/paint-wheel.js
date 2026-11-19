// paint-wheel.js — the colour wheel's arithmetic for Colour Study: the
// painter's wheel (red, yellow and blue a third apart, so red faces green,
// blue faces orange and yellow faces violet) and the screen's wheel, the
// harmonies as offsets on the wheel, and hue, saturation and lightness to and
// from a colour. No DOM, no storage.

// Painter's wheel: these wheel angles are these screen hues, straight lines between.
const RYB_ANGLE = [0, 60, 120, 180, 240, 300, 360];
const RYB_HUE = [0, 30, 60, 120, 240, 285, 360];
const turn = (d) => ((d % 360) + 360) % 360;
function along(v, from, to) {
  v = turn(v);
  for (let i = 0; i < from.length - 1; i++) if (v <= from[i + 1]) return to[i] + ((v - from[i]) / (from[i + 1] - from[i])) * (to[i + 1] - to[i]);
  return 0;
}

export const MO_WHEEL_MODELS = ['painter', 'screen'];
/** A wheel angle (0 at red, clockwise) as a screen hue, 0 to 360. */
export function moWheelHue(angle, model = 'painter') { return turn(model === 'screen' ? angle : along(angle, RYB_ANGLE, RYB_HUE)); }
/** A screen hue as an angle on the wheel. */
export function moWheelAngle(hue, model = 'painter') { return turn(model === 'screen' ? hue : along(hue, RYB_HUE, RYB_ANGLE)); }

/** Each harmony as offsets on the wheel from the first colour. */
export const MO_HARMONIES = {
  complementary: [0, 180],
  splitComplementary: [0, 150, 210],
  triadic: [0, 120, 240],
  tetradic: [0, 60, 180, 300],
  square: [0, 90, 180, 270],
  analogous: [0, -30, 30],
};
export const MO_HARMONY_NAMES = { complementary: 'Complementary', splitComplementary: 'Split Complementary', triadic: 'Triadic', tetradic: 'Tetradic', square: 'Square', analogous: 'Analogous' };
/** The harmony's screen hues, the base first. */
export function moHarmonyHues(type, baseHue, model = 'painter') {
  const at = moWheelAngle(baseHue, model);
  return (MO_HARMONIES[type] || MO_HARMONIES.complementary).map((o) => moWheelHue(at + o, model));
}

/** Hue in degrees, saturation and lightness 0 to 1, as sRGB bytes. */
export function moHslRgb(h, s, l) {
  h = turn(h); s = Math.max(0, Math.min(1, s)); l = Math.max(0, Math.min(1, l));
  const a = s * Math.min(l, 1 - l);
  const f = (n) => { const k = (n + h / 30) % 12; return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
  return [f(0), f(8), f(4)];
}
export function moRgbHsl(rgb) {
  const r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (d < 1e-9) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [turn(h * 60), Math.min(1, s), l];
}
