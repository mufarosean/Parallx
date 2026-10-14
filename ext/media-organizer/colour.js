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
