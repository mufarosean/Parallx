// paint-engine.js — the paint arithmetic behind Colour Study: what a set of
// paints can mix (the gamut), the recipe for a colour and why each paint is
// in it, what one more squeeze of each tube does, what to reach for when a
// mix is wrong, and the rows that turn one dial at a time (value, intensity,
// temperature). No DOM, no storage: paints and rules come in, colours and
// words go out.
//
// The mixing model sits behind one small interface (MoMixModel), so a better
// one (measured pigments, another spectral model) replaces it here and
// nowhere else. The model in use is colour.js's Kubelka-Munk mix: it makes
// green from Ultramarine Blue and Yellow Ochre, where the weighted geometric
// mean (kept below for comparison) makes a muted blue.
//
// Colours are [r, g, b] bytes. A paint is { name, hex, strength? }.

import { moRgbHsl, moWheelAngle } from './paint-wheel.js';
import { MO_MIX_RULES, moCloseness, moEncode, moHexRgb, moLinearOklab, moMixLinear, moOklab, moOklabLinear, moPaintPrep, moValueOf } from './colour.js';

const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const turn = (d) => ((d % 360) + 360) % 360;
/** The shortest way round from hue a to hue b, -180 to 180. */
const hueGap = (a, b) => ((b - a + 540) % 360) - 180;
const HASH = '#';
export const moHex = (rgb) => HASH + rgb.map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');

// ── colour ──────────────────────────────────────────────────────────────────

/** A painter's value, 0 (black) to 10 (white): CIE L* over ten, not rounded. */
export const moValue = (rgb) => moValueOf(rgb);
/** [L, C, hue in degrees] in OKLab's cylinder. */
export function moOklch(rgb) {
  const [L, a, b] = moOklab(rgb[0], rgb[1], rgb[2]);
  return [L, Math.hypot(a, b), turn((Math.atan2(b, a) * 180) / Math.PI)];
}
const inRange = (c) => c[0] >= -0.0005 && c[1] >= -0.0005 && c[2] >= -0.0005 && c[0] <= 1.0005 && c[1] <= 1.0005 && c[2] <= 1.0005;
/** OKLCH as a screen colour; chroma is given up (never hue or lightness) until it fits. */
export function moFromOklch(L, C, h) {
  L = clamp(L, 0, 1);
  const ca = Math.cos((h * Math.PI) / 180), sa = Math.sin((h * Math.PI) / 180);
  let c = moOklabLinear(L, C * ca, C * sa);
  if (!inRange(c)) {
    let lo = 0, hi = C;
    for (let i = 0; i < 22; i++) { const mid = (lo + hi) / 2; if (inRange(moOklabLinear(L, mid * ca, mid * sa))) lo = mid; else hi = mid; }
    c = moOklabLinear(L, lo * ca, lo * sa);
  }
  return moEncode(c);
}
/** Distance in OKLab. Shown to a person times 100. */
export function moDeltaE(a, b) {
  const p = moOklab(a[0], a[1], a[2]), q = moOklab(b[0], b[1], b[2]);
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}
// The measure recipes are judged by: OKLab with hue and chroma counted twice (colour.js's), so a dark
// brown is never close to a dark green just because both are dark.
const eyeLab = (linear) => { const l = moLinearOklab(linear); return [l[0], 2 * l[1], 2 * l[2]]; };
const eyeOf = (rgb) => eyeLab(rgb.map(lin));
const eyeGap = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
/** The colour of this hue and chroma at exactly this painter's value. */
export function moColourAtValue(h, C, value) {
  let lo = 0, hi = 1, rgb = [0, 0, 0];
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    rgb = moFromOklch(mid, C, h);
    if (moValueOf(rgb) < value) lo = mid; else hi = mid;
  }
  return rgb;
}

// ── mixing models ───────────────────────────────────────────────────────────

/**
 * @typedef {{ name: string, hex: string, strength?: number }} MoPaint
 * @typedef {{ name: string, prep(paint: MoPaint): any, mix(prepared: any[], parts: number[]): number[] }} MoMixModel
 * `mix` returns linear RGB, 0 to 1.
 */

/** Pigment mixing by Kubelka-Munk (colour.js). A paint's strength scales how far its parts go. */
export const MO_MIX_KM = { name: 'km', prep: (p) => moPaintPrep(p), mix: (prepared, parts) => moMixLinear(prepared, parts) };

// Typical tinting strengths for the geometric model: estimates, not measurements.
const GEO_STRENGTH = { 'Titanium White': 1, 'Cadmium Yellow Light': 0.8, 'Yellow Ochre': 0.6, 'Cadmium Red Light': 1, 'Alizarin Crimson': 1.1, 'Ultramarine Blue': 1.25, 'Burnt Umber': 0.9, 'Sap Green': 0.9 };
/** A weighted geometric mean of each channel in linear light: quick, and wrong about blue with yellow. */
export const MO_MIX_GEOMETRIC = {
  name: 'geometric',
  prep: (p) => ({ ...moPaintPrep(p), logs: (moHexRgb(p.hex) || [128, 128, 128]).map((v) => Math.log(Math.max(0.003, lin(v)))), w: Number(p.strength) > 0 ? Number(p.strength) : (GEO_STRENGTH[p.name] || 1) }),
  mix(prepared, parts) {
    let tot = 0; const out = [0, 0, 0];
    for (let i = 0; i < prepared.length; i++) { const w = parts[i] * prepared[i].w; tot += w; for (let ch = 0; ch < 3; ch++) out[ch] += w * prepared[i].logs[ch]; }
    return out.map((v) => clamp(Math.exp(v / (tot || 1)), 0, 1));
  },
};
export const MO_MIX_MODEL = MO_MIX_KM;

const cleanPaints = (paints) => (paints || []).filter((p) => p && p.name && moHexRgb(p.hex)).map((p) => ({ name: String(p.name), hex: HASH + String(p.hex).replace(HASH, '').toLowerCase(), ...(Number(p.strength) > 0 && Number(p.strength) !== 1 ? { strength: Number(p.strength) } : {}) }));
/** The colour of parts[i] of paints[i], mixed. */
export function moMixRgb(paints, parts, model = MO_MIX_MODEL) {
  const list = cleanPaints(paints);
  if (!list.length) return [128, 128, 128];
  return moEncode(model.mix(list.map((p) => model.prep(p)), list.map((_, i) => Math.max(0, Number(parts[i]) || 0))));
}
const WATER = { name: 'Water', hex: HASH + 'ffffff', water: true };
const mixOf = (list, mix, model) => { const paints = mix.some((m) => m.name === WATER.name) && !list.some((p) => p.name === WATER.name) ? [...list, WATER] : list; const used = mix.filter((m) => m.parts > 0 && paints.some((p) => p.name === m.name)); return used.length ? moMixRgb(used.map((m) => paints.find((p) => p.name === m.name)), used.map((m) => m.parts), model) : null; };

// ── the gamut: every mix the paints reach ───────────────────────────────────

const CELL = 0.0125, NL = 81, NA = 145, HALF = 0.9; // the reach grid: lightness 0..1, the two colour axes -0.9..0.9
const REACH = 0.09;                                  // "Near" or better (moCloseness)
const BUDGET = 60000;
const gcd = (a, b) => (b ? gcd(b, a % b) : a);
// Parts for n paints, 1 to `top` each, the same ratio once (2:2 is 1:1).
const ratioCache = new Map();
function ratios(n, top) {
  const key = n * 16 + top;
  if (!ratioCache.has(key)) {
    const out = [], cur = new Array(n).fill(1);
    for (;;) {
      if (cur.reduce(gcd) === 1) out.push(cur.slice());
      let i = 0;
      while (i < n && cur[i] === top) { cur[i] = 1; i++; }
      if (i === n) break;
      cur[i]++;
    }
    ratioCache.set(key, out);
  }
  return ratioCache.get(key);
}
function subsets(n, k) {
  const out = [];
  const go = (from, pick) => { if (pick.length === k) { out.push(pick.slice()); return; } for (let i = from; i < n; i++) { pick.push(i); go(i + 1, pick); pick.pop(); } };
  go(0, []);
  return out;
}
let sphere = null;
function sphereOffsets() {
  if (!sphere) {
    const r = REACH / CELL, n = Math.ceil(r), out = [];
    for (let x = -n; x <= n; x++) for (let y = -n; y <= n; y++) for (let z = -n; z <= n; z++) if (x * x + y * y + z * z <= r * r) out.push(x, y, z);
    sphere = Int8Array.from(out);
  }
  return sphere;
}

const gamuts = new Map();
/**
 * Every mix `paints` reach under `rules` (MO_MIX_RULES): each choice of up to `rules.max` paints (white
 * beside them when it does not count), in whole parts (up to 8 of each for two paints, 6 for three, 4 for
 * four). Kept per paint list, so asking again costs nothing. With many paints the choices are cut (three
 * paints from more than ten) to stay quick.
 */
export function moGamut(paints, rules, model = MO_MIX_MODEL) {
  const list = cleanPaints(paints);
  const R = Object.assign({}, MO_MIX_RULES, rules || {});
  const key = JSON.stringify([model.name, list, R.max, R.lighten, !!R.whiteFree, !!R.noBlack]);
  const had = gamuts.get(key);
  if (had) return had;

  const water = R.lighten === 'water';
  const mixable = water ? [...list, { name: 'Water', hex: HASH + 'ffffff', water: true }] : list;
  const prepared = mixable.map((p) => model.prep(p));
  const lightener = water ? mixable.length - 1 : prepared.findIndex((p) => p.white);
  const free = lightener >= 0 && (water || !!R.whiteFree);
  const colours = prepared.map((_, i) => i).filter((i) => (free || water ? i !== lightener && !prepared[i].white : true) && !(R.noBlack && prepared[i].black));

  // How many paints and parts: the rule, cut down while the count is over the budget.
  let most = clamp(Math.round(Number(R.max) || 3), 1, 5), cut = 0;
  const topFor = (n) => Math.max(2, [8, 8, 6, 4, 3, 2][Math.min(5, n - 1)] - cut);
  if (colours.length > 10) most = Math.min(most, 3);
  if (colours.length > 16) most = Math.min(most, 2);
  const plan = () => {
    const combos = [];
    for (let k = 1; k <= Math.min(most, colours.length); k++) for (const s of subsets(colours.length, k)) { const idx = s.map((i) => colours[i]); combos.push(idx); if (free) combos.push([...idx, lightener]); }
    if (free) combos.push([lightener]);
    return combos;
  };
  let combos = plan();
  const count = () => combos.reduce((n, c) => n + ratios(c.length, topFor(c.length)).length, 0);
  while (count() > BUDGET && (cut < 6 || most > 1)) { if (cut < 6) cut++; else most--; combos = plan(); }

  const size = count(), width = Math.max(1, ...combos.map((c) => c.length));
  const labs = new Float32Array(size * 3), comboOf = new Uint16Array(size), partsOf = new Uint8Array(size * width);
  const grid = new Uint8Array(NL * NA * NA), seeds = [];
  let n = 0;
  combos.forEach((idx, ci) => {
    const sub = idx.map((i) => prepared[i]);
    for (const parts of ratios(idx.length, topFor(idx.length))) {
      const l = eyeLab(model.mix(sub, parts));
      labs[n * 3] = l[0]; labs[n * 3 + 1] = l[1]; labs[n * 3 + 2] = l[2];
      comboOf[n] = ci;
      for (let j = 0; j < parts.length; j++) partsOf[n * width + j] = parts[j];
      const x = clamp(Math.round(l[0] / CELL), 0, NL - 1), y = clamp(Math.round((l[1] + HALF) / CELL), 0, NA - 1), z = clamp(Math.round((l[2] + HALF) / CELL), 0, NA - 1), at = (x * NA + y) * NA + z;
      if (!grid[at]) { grid[at] = 2; seeds.push(x, y, z); }
      n++;
    }
  });
  // Every cell within reach of a mix.
  const off = sphereOffsets();
  for (let s = 0; s < seeds.length; s += 3) {
    for (let o = 0; o < off.length; o += 3) {
      const x = seeds[s] + off[o], y = seeds[s + 1] + off[o + 1], z = seeds[s + 2] + off[o + 2];
      if (x >= 0 && y >= 0 && z >= 0 && x < NL && y < NA && z < NA) { const at = (x * NA + y) * NA + z; if (!grid[at]) grid[at] = 1; }
    }
  }
  const gamut = { key, size, paints: list, rules: R, model, mixable, prepared, combos, width, labs, comboOf, partsOf, grid, recipes: new Map() };
  gamuts.set(key, gamut);
  if (gamuts.size > 6) gamuts.delete(gamuts.keys().next().value);
  return gamut;
}

/** How far within reach a colour is: 1 inside what the paints mix, 0 outside, smooth across the edge. */
export function moReach(gamut, rgb) { const l = eyeOf(rgb); return moReachLab(gamut, l[0], l[1], l[2]); }
/** The same for a point of the recipe measure (L, 2a, 2b): the wheel asks per pixel. */
export function moReachLab(gamut, L, a2, b2) {
  const g = gamut.grid;
  const fx = clamp(L / CELL, 0, NL - 1.001), fy = clamp((a2 + HALF) / CELL, 0, NA - 1.001), fz = clamp((b2 + HALF) / CELL, 0, NA - 1.001);
  const x = Math.floor(fx), y = Math.floor(fy), z = Math.floor(fz), tx = fx - x, ty = fy - y, tz = fz - z;
  const at = (i, j, k) => (g[((x + i) * NA + y + j) * NA + z + k] ? 1 : 0);
  const c00 = at(0, 0, 0) * (1 - tz) + at(0, 0, 1) * tz, c01 = at(0, 1, 0) * (1 - tz) + at(0, 1, 1) * tz;
  const c10 = at(1, 0, 0) * (1 - tz) + at(1, 0, 1) * tz, c11 = at(1, 1, 0) * (1 - tz) + at(1, 1, 1) * tz;
  return (c00 * (1 - ty) + c01 * ty) * (1 - tx) + (c10 * (1 - ty) + c11 * ty) * tx;
}

// Across the painter's wheel from each other (red and green, blue and orange, yellow and violet).
const opposed = (a, b) => { const p = moRgbHsl(a), q = moRgbHsl(b); return p[1] > 0.12 && q[1] > 0.08 && Math.abs(hueGap(moWheelAngle(p[0]), moWheelAngle(q[0]))) >= 125; };
const warmth = (h) => Math.cos(((h - 60) * Math.PI) / 180); // 1 at orange, -1 at blue
const round1 = (v) => Math.round(v * 10) / 10;

/**
 * How `to` differs from `from`, in a painter's terms: value steps, colourfulness, hue, and a sentence
 * part ("0.5 darker, cooler and a little duller"; "the same" when the eye would not tell).
 */
export function moDrift(fromRgb, toRgb) {
  const a = moOklch(fromRgb), b = moOklch(toRgb);
  const dValue = moValueOf(toRgb) - moValueOf(fromRgb), dChroma = b[1] - a[1];
  const coloured = a[1] > 0.02 && b[1] > 0.02;
  const dHue = coloured ? hueGap(a[2], b[2]) : 0;
  const de = eyeGap(eyeOf(fromRgb), eyeOf(toRgb));
  const words = [];
  if (Math.abs(dValue) >= 0.15) words.push(`${round1(Math.abs(dValue)).toFixed(1)} ${dValue > 0 ? 'lighter' : 'darker'}`);
  const dWarm = coloured ? warmth(b[2]) - warmth(a[2]) : 0;
  if (coloured && Math.abs(dHue) >= 4 && Math.abs(dWarm) >= 0.03) words.push(dWarm > 0 ? 'warmer' : 'cooler');
  if (Math.abs(dChroma) >= 0.006) words.push(`${Math.abs(dChroma) < 0.015 ? 'a little ' : ''}${dChroma > 0 ? 'brighter' : 'duller'}`);
  const text = !words.length ? 'the same' : words.length === 1 ? words[0] : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
  return { dValue, dChroma, dHue, dWarm, de, closeness: moCloseness(de), text };
}

// Why a paint is in a mix: what the mix loses without it.
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
function rolesFor(entries, model) {
  // entries: [{ paint, prepared, parts }]
  if (entries.length === 1) return ['Straight from the tube'];
  const all = moEncode(model.mix(entries.map((e) => e.prepared), entries.map((e) => e.parts)));
  const target = moOklch(all);
  // The paint nearest the mix's own hue with the most say sets the hue.
  let lead = -1, best = -1;
  entries.forEach((e, i) => { const c = moOklch(moHexRgb(e.paint.hex)); if (c[1] < 0.04 || e.prepared.white) return; const score = (1 - Math.abs(hueGap(c[2], target[2])) / 180) * Math.sqrt(e.parts); if (Math.abs(hueGap(c[2], target[2])) < 50 && score > best) { best = score; lead = i; } });
  return entries.map((e, i) => {
    if (i === lead) return 'Sets the hue';
    const rest = entries.filter((_, j) => j !== i);
    const without = moEncode(model.mix(rest.map((x) => x.prepared), rest.map((x) => x.parts)));
    const d = moDrift(without, all);
    const verbs = [];
    if (Math.abs(d.dValue) >= 0.15) verbs.push(d.dValue > 0 ? 'lightens' : 'darkens');
    if (Math.abs(d.dHue) >= 4 && Math.abs(d.dWarm) >= 0.03) verbs.push(d.dWarm > 0 ? 'warms' : 'cools');
    const opposite = opposed(moHexRgb(e.paint.hex), without);
    const say = (list) => cap(list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}` : list[0]);
    if (d.dChroma <= -0.006) return opposite ? `${say(['dulls', ...verbs.filter((v) => v === 'darkens' || v === 'lightens')])}: the opposite colour` : say([...verbs, 'dulls']);
    if (!verbs.length) return d.dChroma >= 0.006 ? 'Brightens' : 'Adjusts it a little';
    return say(verbs);
  });
}

function recipeFrom(gamut, idx, parts, target, eyeT) {
  const d = parts.reduce(gcd) || 1;
  const p = parts.map((v) => v / d);
  const sub = idx.map((i) => gamut.prepared[i]);
  const linear = gamut.model.mix(sub, p), rgb = moEncode(linear), de = eyeGap(eyeLab(linear), eyeT);
  const order = idx.map((_, i) => i).sort((a, b) => p[b] - p[a]);
  const roles = rolesFor(idx.map((i, j) => ({ paint: gamut.mixable[i], prepared: sub[j], parts: p[j] })), gamut.model);
  return { paints: order.map((j) => ({ name: gamut.mixable[idx[j]].name, hex: gamut.mixable[idx[j]].hex, parts: p[j], role: roles[j] })), rgb, hex: moHex(rgb), de, closeness: moCloseness(de), reachable: de < REACH };
}
const scoreOf = (de, paints, parts) => de + 0.004 * paints + 0.0008 * parts;

/**
 * How to mix `rgb`: the mix that is closest once simpler mixes are favoured (each paint costs a little,
 * each part less), with why each paint is there. `nearest` is the smallest distance any mix reaches,
 * which only falls as paints are added; `de` is this recipe's own distance.
 */
export function moRecipe(gamut, rgb) {
  const k = (rgb[0] << 16) | (rgb[1] << 8) | rgb[2];
  const had = gamut.recipes.get(k);
  if (had) return had;
  const t = eyeOf(rgb), { labs, comboOf, partsOf, width, combos } = gamut;
  let best = -1, bestScore = Infinity, nearest = Infinity;
  for (let n = 0; n < gamut.size; n++) {
    const de = Math.hypot(labs[n * 3] - t[0], labs[n * 3 + 1] - t[1], labs[n * 3 + 2] - t[2]);
    if (de < nearest) nearest = de;
    const c = combos[comboOf[n]];
    let total = 0; for (let j = 0; j < c.length; j++) total += partsOf[n * width + j];
    const s = scoreOf(de, c.length, total);
    if (s < bestScore) { bestScore = s; best = n; }
  }
  let out = null;
  if (best >= 0) { const c = combos[comboOf[best]]; out = recipeFrom(gamut, c, Array.from(partsOf.subarray(best * width, best * width + c.length)), rgb, t); }
  if (!out) out = { paints: [], rgb: [128, 128, 128], hex: moHex([128, 128, 128]), de: Infinity, closeness: 'Far', reachable: false };
  out.nearest = nearest;
  if (gamut.recipes.size > 2000) gamut.recipes.clear();
  gamut.recipes.set(k, out);
  return out;
}

// ── the bench: a mix a person changes ───────────────────────────────────────

/** The colour of a mix given as [{ name, parts }], or null when it holds no paint. */
export function moMixOfParts(paints, mix, model = MO_MIX_MODEL) { return mixOf(cleanPaints(paints), mix || [], model); }

/** What `add` more parts of each paint would do to the mix: its new colour and the change in words. */
export function moTubeNudges(paints, mix, add = 1, model = MO_MIX_MODEL) {
  const list = cleanPaints(paints), now = mixOf(list, mix || [], model);
  return list.map((p) => {
    const next = (mix || []).some((m) => m.name === p.name) ? mix.map((m) => (m.name === p.name ? { name: m.name, parts: m.parts + add } : m)) : [...(mix || []), { name: p.name, parts: add }];
    const rgb = mixOf(list, next, model) || moHexRgb(p.hex);
    return { name: p.name, hex: p.hex, rgb, drift: now ? moDrift(now, rgb) : moDrift(rgb, rgb) };
  });
}

/** The closest mixes for `rgb` without one paint, closest first: what to use when a tube runs out. */
export function moSubstitutes(paints, rules, rgb, without, model = MO_MIX_MODEL) {
  let list = cleanPaints(paints).filter((p) => p.name !== without);
  const full = moRecipe(moGamut(paints, rules, model), rgb), used = new Set(full.paints.map((p) => p.name));
  const out = [];
  for (let i = 0; i < 3 && list.length; i++) {
    const r = moRecipe(moGamut(list, rules, model), rgb);
    if (!r.paints.length || out.some((o) => o.hex === r.hex)) break;
    out.push({ ...r, drift: moDrift(rgb, r.rgb) });
    // Next: without the paint this one leaned on in its place.
    const stand = r.paints.find((p) => !used.has(p.name)) || r.paints[0];
    list = list.filter((p) => p.name !== stand.name);
  }
  return out.sort((a, b) => a.de - b.de);
}

const PROBLEMS = {
  bright: { want: (d) => -d.dChroma * 10, word: 'dulls' },
  dull: { want: (d) => d.dChroma * 10, word: 'brightens' },
  dark: { want: (d) => d.dValue / 10 * 3, word: 'lightens' },
  light: { want: (d) => -d.dValue / 10 * 3, word: 'darkens' },
  warm: { want: (d) => -d.dWarm, word: 'cools' },
  cool: { want: (d) => d.dWarm, word: 'warms' },
};
/**
 * What to reach for when a mix is too bright, dull, dark, light, warm or cool: the paint (one more
 * part of it, or one part less of one in the mix) that moves the mix that way with the least
 * side effect, and a sentence saying why.
 */
export function moFixMix(paints, mix, problem, model = MO_MIX_MODEL, rules) {
  const R = Object.assign({}, MO_MIX_RULES, rules || {});
  const P = PROBLEMS[problem], list = cleanPaints(paints).filter((p) => !(R.noBlack && moPaintPrep(p).black)), now = mixOf(list, mix || [], model);
  if (!P || !now) return null;
  const side = (d, key) => (key === 'bright' || key === 'dull' ? Math.abs(d.dValue) / 10 * 3 + Math.abs(d.dWarm) * 0.5 : key === 'dark' || key === 'light' ? Math.abs(d.dChroma) * 10 + Math.abs(d.dWarm) * 0.5 : Math.abs(d.dValue) / 10 * 3 + Math.abs(d.dChroma) * 10);
  const tries = moTubeNudges(list, mix, 1, model).map((n) => ({ name: n.name, hex: n.hex, action: 'add', rgb: n.rgb, drift: n.drift }));
  for (const m of mix) {
    if (m.parts < 2 || mix.length < 2) continue;
    const rgb = mixOf(list, mix.map((x) => (x.name === m.name ? { name: x.name, parts: x.parts - 1 } : x)), model);
    const p = list.find((x) => x.name === m.name);
    if (rgb && p) tries.push({ name: m.name, hex: p.hex, action: 'less', rgb, drift: moDrift(now, rgb) });
  }
  let best = null, bestScore = 0.004;
  // Only a change a person would call by that name counts: the same thresholds moDrift speaks by.
  const real = (d) => (problem === 'bright' || problem === 'dull' ? Math.abs(d.dChroma) >= 0.006 : problem === 'dark' || problem === 'light' ? Math.abs(d.dValue) >= 0.15 : Math.abs(d.dHue) >= 4 && Math.abs(d.dWarm) >= 0.03);
  const able = tries.filter((t) => P.want(t.drift) > 0 && real(t.drift));
  for (const t of able) { const s = P.want(t.drift) - 0.6 * side(t.drift, problem); if (s > bestScore) { bestScore = s; best = t; } }
  if (!best) { bestScore = 0; for (const t of able) { const gain = P.want(t.drift); if (gain > bestScore) { bestScore = gain; best = t; } } }
  if (!best) return null;
  const opposite = best.action === 'add' && opposed(moHexRgb(best.hex), now);
  const lead = best.action === 'add' ? `Add ${best.name}, a touch at a time.` : `Use less ${best.name}.`;
  const why = problem === 'bright' && opposite ? ' It sits across the wheel from this colour, so it greys the mix without killing it.' : ` It ${P.word} the mix.`;
  const d = best.drift, also = [];
  if ((problem === 'bright' || problem === 'dull' || problem === 'warm' || problem === 'cool') && Math.abs(d.dValue) >= 0.2) also.push(`makes it ${round1(Math.abs(d.dValue)).toFixed(1)} ${d.dValue > 0 ? 'lighter' : 'darker'}`);
  if ((problem === 'dark' || problem === 'light') && Math.abs(d.dChroma) >= 0.006) also.push(`makes it ${d.dChroma > 0 ? 'brighter' : 'duller'}`);
  if ((problem === 'dark' || problem === 'light' || problem === 'bright' || problem === 'dull') && Math.abs(d.dHue) >= 4 && Math.abs(d.dWarm) >= 0.03) also.push(`${d.dWarm > 0 ? 'warms' : 'cools'} it`);
  const follow = also.length ? ` It also ${also.join(' and ')}${problem !== 'dark' && problem !== 'light' && d.dValue <= -0.2 && list.some((p) => moPaintPrep(p).white) ? ', so follow with a little white' : ''}.` : '';
  return { name: best.name, action: best.action, rgb: best.rgb, drift: d, text: `${lead}${why}${follow}` };
}

/**
 * The order to put a recipe's paints down: lightest first, darkest last and in touches, since a dark
 * paint moves a light pile much further than the other way round.
 */
export function moMixOrder(recipePaints, paints) {
  const hexOf = (p) => p.hex || ((paints || []).find((x) => x.name === p.name) || {}).hex;
  const order = (recipePaints || []).map((p) => ({ name: p.name, v: moValueOf(moHexRgb(hexOf(p)) || [128, 128, 128]) })).sort((a, b) => b.v - a.v).map((p) => p.name);
  const text = order.length < 2 ? (order.length ? `${order[0]}, straight from the tube.` : '')
    : `Order: ${order[0]} first, then ${order.slice(1, -1).concat(order.length > 2 ? [`${order[order.length - 1]} last`] : [order[order.length - 1]]).join(', then ')}, a little at a time. A dark paint moves a light pile fast.`;
  return { order, text };
}

// ── the rows: one dial at a time ────────────────────────────────────────────

// Temperature runs from orange (warmest) to the blue opposite it (coolest).
const WARM_POLE = 60, COOL_POLE = 240;
// The colour of the light on the lit side: warm light a sunlit yellow, cool light a north-sky blue.
const LIGHT_WARM = 95, LIGHT_COOL = 230, LIGHT_C = 0.09;
/**
 * A hue leaned warmer (dir 1) or cooler (dir -1) by up to `deg`, never past the pole: the way round that
 * changes its temperature, so a yellow cools toward lemon green, a red toward crimson, a blue warms
 * toward violet and cools toward cyan.
 */
export function moLeanHue(h, dir, deg) {
  if (!dir || !(deg > 0)) return h;
  const pole = dir > 0 ? WARM_POLE : COOL_POLE, gap = hueGap(h, pole);
  const way = gap !== 0 ? Math.sign(gap) : 0, room = Math.abs(gap);
  // exactly opposite the pole either way changes it as much: a blue warms toward violet, an orange cools toward yellow
  const w = Math.abs(room - 180) < 1e-9 ? (dir > 0 ? 1 : 1) : way;
  return turn(h + w * Math.min(deg, room));
}
/**
 * The study rows for a base colour, each turning one dial and holding the others:
 *   value  the base hue and chroma from value 1 to 9.5;
 *   light  light to shadow as a painter sees it: the lights take the light's colour, the shadows keep
 *          the object's colour and lean the other way in temperature;
 *   tone   full chroma down to grey at the base's value;
 *   temp   cooler to warmer at the base's value and chroma;
 *   twins  other hues at the base's value.
 * Each cell is { rgb, value, base? }.
 */
export function moVariationRows(rgb, opts) {
  const n = clamp(Math.round((opts && opts.cells) || 10), 3, 24);
  const [, C, h] = moOklch(rgb), v = moValueOf(rgb);
  const cell = (c, extra) => ({ rgb: c, value: moValueOf(c), ...(extra || {}) });
  const at = (i) => i / (n - 1);

  const value = []; let nearest = 0;
  for (let i = 0; i < n; i++) { const tv = 1 + at(i) * 8.5; value.push(cell(moColourAtValue(h, C, tv))); if (Math.abs(tv - v) < Math.abs(1 + at(nearest) * 8.5 - v)) nearest = i; }
  value[nearest].base = true;

  // Light to shadow, as a painter sees it. The lit side takes the colour of the light: each light cell is
  // tinted toward it (warm light a yellow, cool light a blue), more toward the top, so a blue lit by warm
  // light goes greener and greyer and skin under cool light goes grey blue. The shadow keeps the object's
  // own colour and leans the other way in temperature (at most 30°): under warm light a yellow's shadow is
  // a cooler, greener yellow and a red's a crimson. Colour drains a little at both ends; a grey, with no
  // hue to lean, is tinted instead.
  const warmLight = !(opts && opts.light === 'cool'), lightHue = warmLight ? LIGHT_WARM : LIGHT_COOL, light = [];
  const rad = (d) => (d * Math.PI) / 180;
  for (let i = 0; i < n; i++) {
    const t = at(i) * 2 - 1, tv = 1.5 + at(i) * 7.7;
    if (t > 0) {
      const k = 0.4 * t, a2 = C * Math.cos(rad(h)) * (1 - k) + LIGHT_C * Math.cos(rad(lightHue)) * k, b2 = C * Math.sin(rad(h)) * (1 - k) + LIGHT_C * Math.sin(rad(lightHue)) * k;
      const drain = t > 0.6 ? 1 - 0.45 * ((t - 0.6) / 0.4) : 1;
      light.push(cell(moColourAtValue((Math.atan2(b2, a2) * 180) / Math.PI, Math.hypot(a2, b2) * drain, tv)));
    } else {
      const drain = t < -0.6 ? 1 - 0.4 * ((-t - 0.6) / 0.4) : 1, dir = warmLight ? -1 : 1;
      if (C < 0.025) light.push(cell(moColourAtValue(dir > 0 ? WARM_POLE + 10 : COOL_POLE, Math.max(C, 0.035 * -t), tv)));
      else light.push(cell(moColourAtValue(moLeanHue(h, dir, 30 * -t), C * drain, tv)));
    }
  }

  const tone = [];
  const own = rgb.map((x) => clamp(Math.round(x), 0, 255)); // the base itself, where a row starts from it
  for (let i = 0; i < n; i++) tone.push(i === 0 ? cell(own, { base: true }) : cell(moColourAtValue(h, C * (1 - at(i)), v)));

  // Cool on the left, warm on the right; neither end passes its pole.
  const temp = [];
  const mid = Math.floor((n - 1) / 2), span = Math.max(mid, n - 1 - mid);
  for (let i = 0; i < n; i++) {
    const t = (i - mid) / span;
    temp.push(cell(moColourAtValue(moLeanHue(h, Math.sign(t), 35 * Math.abs(t)), C, v)));
  }
  temp[mid] = cell(own, { base: true });

  const twins = [cell(own, { base: true })], tc = clamp(C, 0.06, 0.1);
  for (let i = 1; i < n; i++) twins.push(cell(moColourAtValue(h + (i * 360) / n, tc, v)));

  return { value, light, tone, temp, twins };
}
