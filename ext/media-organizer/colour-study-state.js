// colour-study-state.js — what a Colour Study sheet keeps (its wheel, harmony,
// palette, the colour studied, the mix, the paints turned off, the ground and
// notes), made safe when read back, and the small helpers its files share.

import { MO_COMMON_PAINTS, moHexRgb } from './colour.js';
import { moHex } from './paint-engine.js';
import { MO_HARMONIES, moHslRgb, moWheelAngle, moWheelHue } from './paint-wheel.js';

export const HOME = 'mo:colour-sheets-changed';
export const PROBLEMS = [['bright', 'Too Bright', 'sun'], ['dull', 'Too Dull', 'cloud'], ['dark', 'Too Dark', 'moon'], ['light', 'Too Light', 'sun-dim'], ['warm', 'Too Warm', 'flame'], ['cool', 'Too Cool', 'snowflake']];
export const say = (v) => (Math.round(v * 10) / 10).toFixed(1);
export const rgbOf = (hex) => moHexRgb(hex) || [128, 128, 128];
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const parse = (text, fallback) => { try { const v = JSON.parse(text); return v == null ? fallback : v; } catch { return fallback; } };
// What the canvas is toned with, behind the target and the mix.
export const GROUNDS = ['Burnt Sienna', 'Raw Sienna', 'Raw Umber', 'Burnt Umber', 'Yellow Ochre', 'Titanium White', 'Grey'];
export const groundHex = (name) => { const p = MO_COMMON_PAINTS.find((x) => x.name === name); return p ? p.hex : moHex([128, 128, 128]); };
export const VALUE_WORDS = ['a very dark', 'a very dark', 'a dark', 'a dark', 'a middle dark', 'a middle', 'a middle light', 'a light', 'a light', 'a very light', 'a very light'];

export function harmonyColours(type, h, s, l, wheel) {
  const at = moWheelAngle(h, wheel);
  return (MO_HARMONIES[type] || [0]).map((o) => moHex(moHslRgb(moWheelHue(at + o, wheel), s, l)));
}
export function defaultState() {
  return { wheel: 'painter', harmony: 'splitComplementary', colours: harmonyColours('splitComplementary', 81, 0.3, 0.34, 'painter'), active: 0, shown: null, base: null, light: 'warm', hatch: true, valueCheck: false, twinsGrey: false, source: 'wheel', tubesOff: [], mix: null, masses: [], pictureFrom: '', notes: '', ground: 'Burnt Sienna' };
}
export function cleanState(raw) {
  const d = defaultState(), s = Object.assign({}, d, raw && typeof raw === 'object' ? raw : {});
  const hexes = (list) => (Array.isArray(list) ? list.map((h) => moHexRgb(h)).filter(Boolean).map(moHex) : []);
  s.colours = hexes(s.colours).slice(0, 9); if (!s.colours.length) s.colours = d.colours;
  s.active = clamp(Math.round(Number(s.active) || 0), 0, s.colours.length - 1);
  s.wheel = s.wheel === 'screen' ? 'screen' : 'painter';
  s.harmony = s.harmony === 'none' || MO_HARMONIES[s.harmony] ? s.harmony : d.harmony;
  s.light = s.light === 'cool' ? 'cool' : 'warm';
  s.source = s.source === 'picture' ? 'picture' : 'wheel';
  s.shown = moHexRgb(s.shown) ? moHex(moHexRgb(s.shown)) : null;
  s.base = moHexRgb(s.base) ? moHex(moHexRgb(s.base)) : null;
  s.masses = hexes(s.masses).slice(0, 16);
  s.tubesOff = Array.isArray(s.tubesOff) ? s.tubesOff.map(String) : [];
  s.mix = Array.isArray(s.mix) ? s.mix.filter((m) => m && m.name && m.parts > 0).map((m) => ({ name: String(m.name), parts: clamp(Math.round(m.parts), 1, 24) })) : null;
  if (s.mix && !s.mix.length) s.mix = null;
  for (const k of ['hatch', 'valueCheck', 'twinsGrey']) s[k] = !!s[k];
  s.ground = GROUNDS.includes(s.ground) ? s.ground : d.ground;
  s.notes = String(s.notes || '').slice(0, 4000); s.pictureFrom = String(s.pictureFrom || '').slice(0, 120);
  return s;
}

