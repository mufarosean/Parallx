// colour.js — colour science for Painting Plans: OKLab (a lightness scale that
// matches the eye, with hue and chroma kept apart), value bands that keep a
// pixel's hue, and palette extraction from the edited picture.

// GLSL for the engine's fragment shader. Inputs are sRGB-encoded 0..1.
export const MO_OKLAB_GLSL = `
vec3 srgbToLinear(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
vec3 linearToSrgb(vec3 c) { c = max(c, 0.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
vec3 toOklab(vec3 c) {
  c = srgbToLinear(clamp(c, 0.0, 1.0));
  vec3 l = pow(max(vec3(0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b,
    0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b,
    0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b), 0.0), vec3(1.0 / 3.0));
  return vec3(0.2104542553 * l.x + 0.7936177850 * l.y - 0.0040720468 * l.z,
    1.9779984951 * l.x - 2.4285922050 * l.y + 0.4505937099 * l.z,
    0.0259040371 * l.x + 0.7827717662 * l.y - 0.8086757660 * l.z);
}
vec3 oklabToLinear(vec3 o) {
  vec3 l = vec3(o.x + 0.3963377774 * o.y + 0.2158037573 * o.z, o.x - 0.1055613458 * o.y - 0.0638541728 * o.z, o.x - 0.0894841775 * o.y - 1.2914855480 * o.z);
  l = l * l * l;
  return vec3(4.0767416621 * l.x - 3.3077115913 * l.y + 0.2309699292 * l.z,
    -1.2684380046 * l.x + 2.6097574011 * l.y - 0.3413193965 * l.z,
    -0.0041960863 * l.x - 0.7034186147 * l.y + 1.7076147010 * l.z);
}
// A pixel moved to the lightness of its value band (lb, the band's grey) with its
// hue kept; colour the band's lightness cannot hold is given up, never the hue.
vec3 valueBand(vec3 c, float lb) {
  vec3 o = toOklab(c);
  float L = pow(srgbToLinear(vec3(lb)).x, 1.0 / 3.0);
  vec3 r = vec3(lb);
  float k = 1.0;
  for (int i = 0; i < 24; i++) {
    vec3 t = oklabToLinear(vec3(L, o.yz * k));
    if (min(t.r, min(t.g, t.b)) >= -0.001 && max(t.r, max(t.g, t.b)) <= 1.001) { r = linearToSrgb(t); break; }
    k *= 0.82;
  }
  return clamp(r, 0.0, 1.0);
}
`;

const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const enc = (v) => { v = Math.max(0, Math.min(1, v)); return 255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055); };

// sRGB bytes to OKLab [L, a, b].
export function moOklab(r, g, b) {
  const R = lin(r), G = lin(g), B = lin(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
}

// OKLab to sRGB bytes; a colour outside the screen's range keeps its hue and
// lightness and gives up chroma.
export function moFromOklab(L, a, b) {
  const raw = (k) => {
    const l = (L + 0.3963377774 * a * k + 0.2158037573 * b * k) ** 3;
    const m = (L - 0.1055613458 * a * k - 0.0638541728 * b * k) ** 3;
    const s = (L - 0.0894841775 * a * k - 1.2914855480 * b * k) ** 3;
    return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s];
  };
  let k = 1; let c = raw(k);
  for (let i = 0; i < 30 && (Math.min(...c) < -0.001 || Math.max(...c) > 1.001); i++) { k *= 0.85; c = raw(k); }
  return c.map((v) => Math.round(enc(v)));
}

const dist2 = (p, q) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;

// The picture's colours from RGBA bytes: up to `count` swatches as
// { rgb, share }, most of the picture first. Pixels are pooled into small
// OKLab cells, the clusters are seeded far apart (so a small accent colour
// is not swallowed by a large field) and refined, and two swatches the eye
// would call the same are merged. Deterministic: the same picture gives the
// same palette.
export function moPalette(rgba, count) {
  const k = Math.max(1, Math.min(16, Math.floor(Number(count) || 8)));
  const cells = new Map();
  let total = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] < 128) continue;
    const key = (rgba[i] >> 2) << 12 | (rgba[i + 1] >> 2) << 6 | (rgba[i + 2] >> 2);
    const cell = cells.get(key);
    if (cell) { cell.w++; cell.r += rgba[i]; cell.g += rgba[i + 1]; cell.b += rgba[i + 2]; } else cells.set(key, { w: 1, r: rgba[i], g: rgba[i + 1], b: rgba[i + 2] });
    total++;
  }
  if (!total) return [];
  const pts = [...cells.values()].map((c) => ({ w: c.w, lab: moOklab(c.r / c.w, c.g / c.w, c.b / c.w) }));
  // Seeds: the heaviest cell, then each next the cell furthest from every seed,
  // weighted so a lone stray pixel does not count as a colour.
  const minShare = total * 0.002;
  const seeds = [pts.reduce((a, p) => (p.w > a.w ? p : a)).lab];
  const near = pts.map((p) => dist2(p.lab, seeds[0]));
  while (seeds.length < Math.min(k, pts.length)) {
    let best = -1; let score = 0;
    for (let i = 0; i < pts.length; i++) { const s = near[i] * Math.min(1, pts[i].w / minShare) * Math.sqrt(pts[i].w); if (s > score) { score = s; best = i; } }
    if (best < 0 || near[best] < 1e-4) break;
    seeds.push(pts[best].lab);
    for (let i = 0; i < pts.length; i++) near[i] = Math.min(near[i], dist2(pts[i].lab, pts[best].lab));
  }
  let centres = seeds.map((s) => s.slice());
  let weights = [];
  const refine = () => {
    for (let it = 0; it < 16; it++) {
      const sums = centres.map(() => [0, 0, 0, 0]);
      for (const p of pts) {
        let bi = 0; let bd = Infinity;
        for (let c = 0; c < centres.length; c++) { const d = dist2(p.lab, centres[c]); if (d < bd) { bd = d; bi = c; } }
        const s = sums[bi]; s[0] += p.lab[0] * p.w; s[1] += p.lab[1] * p.w; s[2] += p.lab[2] * p.w; s[3] += p.w;
      }
      centres = centres.map((c, i) => (sums[i][3] ? [sums[i][0] / sums[i][3], sums[i][1] / sums[i][3], sums[i][2] / sums[i][3]] : c));
      weights = sums.map((s) => s[3]);
    }
  };
  refine();
  // Swatches closer than a just-noticeable step are one colour.
  for (let merged = true; merged && centres.length > 1;) {
    merged = false;
    for (let i = 0; i < centres.length && !merged; i++) {
      for (let j = i + 1; j < centres.length && !merged; j++) {
        if (dist2(centres[i], centres[j]) < 0.03 * 0.03) { centres.splice(weights[i] >= weights[j] ? j : i, 1); weights.splice(0); merged = true; }
      }
    }
    if (merged) refine();
  }
  return centres.map((c, i) => ({ rgb: moFromOklab(c[0], c[1], c[2]), share: (weights[i] || 0) / total }))
    .filter((s) => s.share > 0)
    .sort((a, b) => b.share - a.share);
}

// ── Names ──────────────────────────────────────────────────────────────────

const linOf = (rgb) => rgb.map(lin);
const lumOf = (l) => 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];

// A painter's value, 0 (black) to 10 (white), from the colour's lightness (CIE L*).
export function moValueStep(rgb) {
  const Y = lumOf(linOf(rgb));
  const Ls = Y > 0.008856 ? 116 * Math.cbrt(Y) - 16 : 903.3 * Y;
  return Math.max(0, Math.min(10, Math.round(Ls / 10)));
}
const VALUE_WORDS = ['very dark', 'very dark', 'dark', 'dark', 'mid dark', 'mid', 'mid light', 'light', 'light', 'very light', 'very light'];

// An everyday name for a colour ("Muted olive green") and its value step.
export function moColourName(rgb) {
  const [L, a, b] = moOklab(rgb[0], rgb[1], rgb[2]);
  const C = Math.hypot(a, b);
  const h = ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
  const value = moValueStep(rgb);
  const out = (name) => ({ name: name.charAt(0).toUpperCase() + name.slice(1), value, valueWord: VALUE_WORDS[value] });
  if (C < 0.025) {
    if (L > 0.95) return out('white');
    if (L < 0.22) return out('black');
    const tint = C < 0.012 ? '' : (h > 20 && h < 120 ? 'warm ' : h > 180 && h < 300 ? 'cool ' : '');
    return out(`${L > 0.75 ? 'light ' : L < 0.4 ? 'dark ' : ''}${tint}grey`);
  }
  let fam = h < 20 || h >= 345 ? 'red' : h < 40 ? 'orange red' : h < 70 ? 'orange' : h < 95 ? 'yellow orange' : h < 115 ? 'yellow'
    : h < 130 ? 'yellow green' : h < 165 ? 'green' : h < 185 ? 'teal' : h < 225 ? 'turquoise' : h < 280 ? 'blue' : h < 295 ? 'violet' : h < 322 ? 'purple' : 'magenta';
  let shade = true; // light and dark still apply
  const warm = fam === 'orange' || fam === 'orange red' || fam === 'yellow orange';
  if (warm && L < 0.55 && C < 0.13) { fam = fam === 'orange red' ? 'reddish brown' : 'brown'; shade = L > 0.42; }
  else if (warm && fam !== 'orange red' && L > 0.78 && C < 0.07) { fam = 'beige'; shade = false; }
  else if (warm && fam !== 'orange red' && L >= 0.55 && C < 0.1) { fam = 'tan'; shade = false; }
  else if (fam === 'orange' && L > 0.82) { fam = 'peach'; shade = false; }
  else if ((fam === 'red' || fam === 'magenta' || fam === 'orange red') && L > 0.72) { fam = L > 0.86 ? 'pale pink' : 'pink'; shade = false; }
  else if ((fam === 'yellow green' || fam === 'yellow') && L < 0.65 && C < 0.12) fam = 'olive green';
  else if (fam === 'blue' && L < 0.33) { fam = 'navy blue'; shade = false; }
  else if (fam === 'turquoise' && L < 0.45) fam = 'teal';
  const muted = C < 0.06 && !/brown|beige|tan|olive|navy/.test(fam) ? 'muted ' : C > 0.2 ? 'bright ' : '';
  const tone = !shade ? '' : L > 0.8 ? 'light ' : L < 0.4 ? 'dark ' : '';
  return out(`${muted}${tone}${fam}`);
}

// ── Paints ─────────────────────────────────────────────────────────────────

// Common artists' tube colours, as their mid tone reads on screen.
export const MO_COMMON_PAINTS = [
  ['Titanium White', 0xf4f3ee], ['Ivory Black', 0x262421], ['Payne’s Grey', 0x3b4552],
  ['Lemon Yellow', 0xf1e11c], ['Cadmium Yellow Light', 0xf8d81d], ['Cadmium Yellow Medium', 0xf6b70e], ['Yellow Ochre', 0xc79a3c],
  ['Raw Sienna', 0xb5762f], ['Burnt Sienna', 0x8a3f22], ['Raw Umber', 0x5a4630], ['Burnt Umber', 0x4a2f22],
  ['Cadmium Orange', 0xec7a1b], ['Cadmium Red Light', 0xdf3b26], ['Cadmium Red Medium', 0xc4261f], ['Alizarin Crimson', 0x7e1a2a],
  ['Quinacridone Magenta', 0x8e1f55], ['Dioxazine Purple', 0x3b1f4f], ['Ultramarine Blue', 0x283a8e], ['Cobalt Blue', 0x1f4f9e],
  ['Cerulean Blue', 0x2a7ab0], ['Phthalo Blue', 0x0f3a78], ['Phthalo Green', 0x0d5a48], ['Viridian', 0x1f6b57], ['Sap Green', 0x4b5d22],
].map(([name, n]) => ({ name, hex: '\u0023' + n.toString(16).padStart(6, '0') })); // stored as numbers: paint data, not a style
// Until someone sets their own: a classic beginner's set.
export const MO_STARTER_PAINTS = ['Titanium White', 'Cadmium Yellow Light', 'Yellow Ochre', 'Cadmium Red Light', 'Alizarin Crimson', 'Ultramarine Blue', 'Burnt Umber', 'Sap Green']
  .map((n) => MO_COMMON_PAINTS.find((p) => p.name === n));
export const MO_MIX_RULES = { max: 3, lighten: 'white', whiteFree: true, noBlack: true, preferFewer: true };

// A painting plan's values as swatches, darkest first: the tones its Values view lays the picture in.
// `levels` bands (none: nine steps), or light and shadow when `notan` is set, in grey or in one paint
// (`under`, a paint's name) from its darks to its tints, worked as the plan's shader works them.
export function moValueSwatches(levels, notan, under) {
  const p = under ? MO_COMMON_PAINTS.find((x) => x.name === under) : null;
  const u = p ? moOklab(...moHexRgb(p.hex)) : null;
  const n = Number(levels) >= 2 ? Math.round(Number(levels)) : 9;
  const Ls = Number(notan) > 0 ? [0.24, 0.86] : Array.from({ length: n }, (_, i) => (i + 0.5) / n);
  return Ls.map((L) => {
    if (!u) return moFromOklab(L, 0, 0);
    const k = Math.max(0, Math.min(1, 1 - Math.abs(L - u[0]) / Math.max(u[0], 1 - u[0]))), f = 0.35 + 0.65 * k;
    return moFromOklab(L, u[1] * f, u[2] * f);
  });
}

export function moHexRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [n >> 16 & 255, n >> 8 & 255, n & 255];
}

// ── Mixing ─────────────────────────────────────────────────────────────────
// Paint mixes like pigment, not like light: each colour becomes a smooth
// reflectance curve, the curves mix by Kubelka-Munk (absorption over
// scattering, single constant) weighted by each paint's lightness and share,
// and the mix is read back as a screen colour. The method follows
// spectral.js (MIT); the curves and fit here are our own. An estimate:
// real tubes differ by brand.

const WL = []; for (let l = 380; l <= 730; l += 10) WL.push(l);
const lobe = (x, mu, s1, s2) => Math.exp(-0.5 * ((x - mu) / (x < mu ? s1 : s2)) ** 2);
// CIE 1931 observer, multi-lobe fit (Wyman, Sloan and Shirley 2013).
const CMF = WL.map((l) => [
  1.056 * lobe(l, 599.8, 37.9, 31.0) + 0.362 * lobe(l, 442.0, 16.0, 26.7) - 0.065 * lobe(l, 501.1, 20.4, 26.2),
  0.821 * lobe(l, 568.8, 46.9, 40.5) + 0.286 * lobe(l, 530.9, 16.3, 31.1),
  1.217 * lobe(l, 437.0, 11.8, 36.0) + 0.681 * lobe(l, 459.0, 26.0, 13.8)]);
function rawRgb(spec) {
  let X = 0, Y = 0, Z = 0;
  for (let i = 0; i < WL.length; i++) { X += spec[i] * CMF[i][0]; Y += spec[i] * CMF[i][1]; Z += spec[i] * CMF[i][2]; }
  return [3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z, -0.9692660 * X + 1.8760108 * Y + 0.0415560 * Z, 0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z];
}
const WHITE_RGB = rawRgb(WL.map(() => 1));
const specRgb = (s) => rawRgb(s).map((v, i) => v / WHITE_RGB[i]);
const rise = (at) => WL.map((l) => 1 / (1 + Math.exp(-(l - at) / 8)));
const S_W = WL.map(() => 1), S_R = rise(595), S_Y = rise(495);
const S_B = S_Y.map((v) => 1 - v), S_C = S_R.map((v) => 1 - v), S_G = S_Y.map((v, i) => v * (1 - S_R[i])), S_M = S_G.map((v) => 1 - v);
const RGB_OF = new Map([S_W, S_R, S_Y, S_B, S_C, S_G, S_M].map((s) => [s, specRgb(s)]));

// A reflectance curve for a linear RGB colour: white plus the secondary and
// primary of its hue sector, solved so the curve shows that colour.
function curveOf(t) {
  const [r, g, b] = t;
  const [s1, s2] = r >= g ? (g >= b ? [S_Y, S_R] : r >= b ? [S_M, S_R] : [S_M, S_B]) : (r >= b ? [S_Y, S_G] : g >= b ? [S_C, S_G] : [S_C, S_B]);
  const A = RGB_OF.get(S_W), B = RGB_OF.get(s1), C = RGB_OF.get(s2);
  const det3 = (x, y, z) => x[0] * (y[1] * z[2] - y[2] * z[1]) - y[0] * (x[1] * z[2] - x[2] * z[1]) + z[0] * (x[1] * y[2] - x[2] * y[1]);
  const D = det3(A, B, C) || 1e-9;
  const k = [det3(t, B, C) / D, det3(A, t, C) / D, det3(A, B, t) / D].map((v) => Math.max(0, v));
  return WL.map((_, i) => Math.min(1, Math.max(1e-4, k[0] * S_W[i] + k[1] * s1[i] + k[2] * s2[i])));
}
const toKs = (R) => (1 - R) ** 2 / (2 * R);
const fromKs = (k) => 1 + k - Math.sqrt(k * k + 2 * k);
const labLin = (l) => {
  const a = Math.cbrt(Math.max(0, 0.4122214708 * l[0] + 0.5363325363 * l[1] + 0.0514459929 * l[2]));
  const m = Math.cbrt(Math.max(0, 0.2119034982 * l[0] + 0.6806995451 * l[1] + 0.1073969566 * l[2]));
  const s = Math.cbrt(Math.max(0, 0.0883024619 * l[0] + 0.2817188376 * l[1] + 0.6299787005 * l[2]));
  return [0.2104542553 * a + 0.7936177850 * m - 0.0040720468 * s, 1.9779984951 * a - 2.4285922050 * m + 0.4505937099 * s, 0.0259040371 * a + 0.7827717662 * m - 0.8086757660 * s];
};

// A paint ready to mix: its curve as absorption over scattering, its
// lightness, and the small difference between its curve and its colour.
export function moPaintPrep(p) {
  const rgb = moHexRgb(p.hex) || [128, 128, 128];
  const l = linOf(rgb);
  const curve = p.water ? S_W : curveOf(l);
  const back = specRgb(curve);
  const [L, a, b] = moOklab(rgb[0], rgb[1], rgb[2]);
  const C = Math.hypot(a, b);
  return { name: p.name, hex: p.hex, water: !!p.water, ks: curve.map(toKs), Y: Math.max(0.003, lumOf(l)), err: p.water ? [0, 0, 0] : l.map((v, i) => v - back[i]),
    white: !p.water && L > 0.93 && C < 0.03, black: L < 0.3 && C < 0.035 };
}

// The colour of `parts` of prepared paints mixed, as linear RGB.
export function moMixLinear(paints, parts) {
  const w = parts.map((c, i) => paints[i].Y * c * c);
  const tot = w.reduce((s, v) => s + v, 0) || 1;
  const k = new Float64Array(WL.length);
  for (let i = 0; i < paints.length; i++) { const f = w[i] / tot; if (f) for (let j = 0; j < WL.length; j++) k[j] += f * paints[i].ks[j]; }
  const rgb = specRgb(Array.from(k, fromKs));
  for (let i = 0; i < paints.length; i++) for (let ch = 0; ch < 3; ch++) rgb[ch] += (w[i] / tot) * paints[i].err[ch];
  return rgb.map((v) => Math.max(0, Math.min(1, v)));
}
const toHex = (l) => '\u0023' + l.map((v) => Math.round(enc(v)).toString(16).padStart(2, '0')).join('');

export function moCloseness(de) { return de < 0.02 ? 'Very close' : de < 0.045 ? 'Close' : de < 0.09 ? 'Near' : 'Far'; }

// How to mix `rgb` from `paintList` ({ name, hex }) under `rules`
// (MO_MIX_RULES). Returns { best, simpler } recipes, each
// { paints: [{ name, hex, parts, touch }], hex, de, closeness }; simpler
// is the closest mix with fewer paints, when there is one.
export function moMixRecipes(rgb, paintList, rules) {
  const R = Object.assign({}, MO_MIX_RULES, rules || {});
  const all = (paintList || []).map(moPaintPrep);
  const water = R.lighten === 'water';
  const lightener = water ? moPaintPrep({ name: 'Water', hex: 'ffffff', water: true }) : all.find((p) => p.white) || null;
  const free = water || R.whiteFree;
  const colours = all.filter((p) => !p.white && !(R.noBlack && p.black));
  if (!free && lightener) colours.push(lightener);
  if (!colours.length && !lightener) return { best: null, simpler: null };
  const tLab = labLin(linOf(rgb));
  // How far apart the eye finds two colours: OKLab with hue and colourfulness counted twice (deltaEOK2), so a
  // dark brown is never "near" a dark green just because both are dark.
  const errOf = (sub, c) => { const m = labLin(moMixLinear(sub, c)); return Math.hypot(m[0] - tLab[0], 2 * (m[1] - tLab[1]), 2 * (m[2] - tLab[2])); };
  const fit = (sub) => {
    let c = sub.map(() => 1), e = errOf(sub, c);
    if (sub.length < 2) return { c, e };
    for (let it = 0, step = 1.2; it < 48 && step > 0.03; it++) {
      let better = false;
      for (let i = 0; i < c.length; i++) for (const d of [1, -1]) { const t = c.slice(); t[i] *= Math.exp(d * step); const te = errOf(sub, t); if (te < e) { e = te; c = t; better = true; } }
      if (!better) step /= 2;
    }
    return { c, e };
  };
  const found = [];
  const tryMix = (sub) => {
    const withL = free && lightener && !sub.includes(lightener) ? [...sub, lightener] : sub;
    const f = fit(withL);
    found.push({ sub: withL, c: f.c, e: f.e, n: sub.length });
    return f.e;
  };
  if (lightener && !water) found.push({ sub: [lightener], c: [1], e: errOf([lightener], [1]), n: free ? 0 : 1 });
  let beam = colours.map((p) => [p]);
  for (let n = 1; n <= R.max && beam.length; n++) {
    const kept = beam.map((sub) => ({ sub, e: tryMix(sub) })).sort((a, b) => a.e - b.e).slice(0, 6);
    const next = new Map();
    if (n < R.max) for (const { sub } of kept) for (const p of colours) if (!sub.includes(p)) { const s = [...sub, p]; next.set(s.map((x) => x.name).sort().join('|'), s); }
    beam = [...next.values()];
  }
  const recipe = (f) => {
    // Paints under 3% of the mix are dropped, a tiny share is "a touch", the rest small whole parts.
    let sub = f.sub, c = f.c;
    const tot = c.reduce((s, v) => s + v, 0);
    const keep = sub.map((_, i) => i).filter((i) => c[i] / tot >= 0.03);
    if (keep.length && keep.length < sub.length) { sub = keep.map((i) => sub[i]); c = fit(sub).c; }
    const max = Math.max(...c);
    const touch = c.map((v) => v / max < 0.05);
    const min = Math.min(...c.filter((_, i) => !touch[i]));
    const partsAt = (s) => c.map((v, i) => (touch[i] ? 0 : Math.max(1, Math.round((v / min) * s))));
    const mixOf = (p) => { const top = Math.max(...p); return p.map((v, i) => (touch[i] ? top * 0.04 : v)); };
    const e0 = errOf(sub, c);
    let best = null;
    for (let s = 1; s <= 6; s++) {
      const p = partsAt(s);
      if (Math.max(...p) > 12 && best) break;
      const e = errOf(sub, mixOf(p));
      if (!best || e < best.e - 1e-4) best = { p, e };
      if (e <= e0 + 0.012) break; // simple parts win while the mix stays as close to the eye
    }
    const gcd = (a, b) => (b ? gcd(b, a % b) : a);
    const d = best.p.filter((v) => v > 0).reduce(gcd, 0);
    const p = best.p.map((v) => v / (d || 1));
    const order = sub.map((_, i) => i).sort((a, b) => (touch[a] - touch[b]) || p[b] - p[a]);
    return { paints: order.map((i) => ({ name: sub[i].name, hex: sub[i].hex, parts: p[i], touch: touch[i] })), hex: toHex(moMixLinear(sub, mixOf(p))), de: best.e, closeness: moCloseness(best.e) };
  };
  if (!found.length) return { best: null, simpler: null };
  const byN = new Map();
  for (const f of found) if (!byN.has(f.n) || f.e < byN.get(f.n).e) byN.set(f.n, f);
  const top = Math.min(...found.map((f) => f.e));
  const ns = [...byN.keys()].sort((a, b) => a - b);
  const chosenN = R.preferFewer ? ns.find((n) => byN.get(n).e <= top + 0.012 || (top < 0.09 && moCloseness(byN.get(n).e) === moCloseness(top))) : ns.find((n) => byN.get(n).e === top);
  const best = recipe(byN.get(chosenN));
  const fewer = ns.filter((n) => n < chosenN && n > 0).map((n) => byN.get(n)).sort((a, b) => a.e - b.e)[0];
  return { best, simpler: fewer && fewer.e < 0.09 ? recipe(fewer) : null }; // a simpler mix only when it is at least near
}
