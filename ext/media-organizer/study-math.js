// study-math.js — the Colour Study's arithmetic: what each lens shows and
// what its readout says, from the edited picture's pixels. No DOM; the plan's
// Study tool (plan-study.js) draws what these return.
//
// Colour is OKLab (for the eye); a painter's value is CIE L* over ten (0
// black, 10 white); warm and cool are how far a colour leans toward orange or
// blue; intensity is roughly Munsell chroma (0 grey, 10 to 16 for strong tube
// colours). Colour masses are nested: raising their number only splits a
// mass, so the masses built so far stay where they were.

import { moColourName, moFromOklab, moOklab } from './colour.js';

const LIN = new Float32Array(256);
for (let i = 0; i < 256; i++) { const v = i / 255; LIN[i] = v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }
const WARM = [0.56, 0.83];
const HUES = [[0, 'red'], [30, 'orange red'], [55, 'orange'], [80, 'yellow orange'], [100, 'yellow'], [125, 'yellow green'], [150, 'green'], [185, 'teal'], [220, 'turquoise'], [255, 'blue'], [290, 'violet'], [320, 'purple'], [345, 'magenta']];

export const moStudyValue = (r, g, b) => { const Y = 0.2126 * LIN[r] + 0.7152 * LIN[g] + 0.0722 * LIN[b]; return (Y > 0.008856 ? 116 * Math.cbrt(Y) - 16 : 903.3 * Y) / 10; };
export const moStudyWarmth = (a, b) => a * WARM[0] + b * WARM[1];
export const moStudyIntensity = (a, b) => Math.hypot(a, b) * 42;
export const moStudyHue = (a, b) => ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
export const moStudyHueName = (h) => { let best = HUES[0]; for (const e of HUES) if (h >= e[0]) best = e; return h >= 355 ? 'red' : best[1]; };
const greyOf = (L) => moFromOklab(L, 0, 0);

/** The defaults for a recipe's `study`; anything missing or out of range falls back to these. */
export function moStudyNormalize(o) {
  const s = o && typeof o === 'object' ? o : {};
  const num = (v, lo, hi, d) => (Number.isFinite(Number(v)) ? Math.max(lo, Math.min(hi, Number(v))) : d);
  const m = s.masses && typeof s.masses === 'object' ? s.masses : {};
  const t = s.temp && typeof s.temp === 'object' ? s.temp : {};
  return {
    lens: ['picture', 'light', 'temp', 'masses', 'intensity'].includes(s.lens) ? s.lens : 'light',
    split: s.split === null || s.split === undefined ? null : num(s.split, 1, 9, 5),
    light: s.light === 'bw' ? 'bw' : 'colours',
    temp: { against: t.against === 'all' ? 'all' : 'near', min: num(t.min, 0, 100, 25) },
    masses: {
      n: Math.round(num(m.n, 2, 16, 5)),
      method: ['colour', 'place', 'shapes'].includes(m.method) ? m.method : 'shapes',
      colour: m.colour === 'average' ? 'average' : 'dominant',
      amount: num(m.amount, 0, 100, 100),
    },
    keep: num(s.keep, 0, 14, 6),
  };
}

/** Analyse RGBA pixels (w x h) once: OKLab, value, and the value that best splits light from shadow. */
export function moStudyAnalyse(px, w, h) {
  const n = w * h;
  const L = new Float32Array(n), A = new Float32Array(n), B = new Float32Array(n), V = new Float32Array(n);
  const hist = new Array(101).fill(0);
  for (let i = 0; i < n; i++) {
    const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2];
    const o = moOklab(r, g, b);
    L[i] = o[0]; A[i] = o[1]; B[i] = o[2]; V[i] = moStudyValue(r, g, b);
    hist[Math.max(0, Math.min(100, Math.round(V[i] * 10)))]++;
  }
  // Otsu: the value cut that best separates two families.
  let sum = 0; for (let t = 0; t <= 100; t++) sum += t * hist[t];
  let sB = 0, wB = 0, best = 0, cut = 50;
  for (let t = 0; t <= 100; t++) {
    wB += hist[t]; if (!wB) continue;
    const wF = n - wB; if (!wF) break;
    sB += t * hist[t];
    const between = wB * wF * (sB / wB - (sum - sB) / wF) ** 2;
    if (between > best) { best = between; cut = t; }
  }
  return { w, h, n, px, L, A, B, V, split: Math.round(cut / 5) / 2 + 0.5, cache: {} };
}

/** A box blur of one channel (squinting), radius in pixels. */
export function moStudyBlur(src, w, h, r) {
  if (r < 1) return src;
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
  for (let y = 0; y < h; y++) {
    const row = y * w; let s = 0;
    for (let x = -r; x <= r; x++) s += src[row + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) { tmp[row + x] = s / (2 * r + 1); s += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)]; }
  }
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let y = -r; y <= r; y++) s += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) { out[y * w + x] = s / (2 * r + 1); s += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x]; }
  }
  return out;
}
function squinted(P, amount) {
  const r = Math.round((amount / 100) * Math.max(P.w, P.h) * 0.025), key = `sq${r}`;
  if (!P.cache[key]) P.cache[key] = { L: moStudyBlur(P.L, P.w, P.h, r), A: moStudyBlur(P.A, P.w, P.h, r), B: moStudyBlur(P.B, P.w, P.h, r) };
  return P.cache[key];
}

/**
 * Nested two-way splits: each step splits the group with the most spread.
 * features: one Float32Array per dimension. Returns { label, parent } at
 * maxK groups; moStudyAtLevel reads any smaller number from it.
 */
export function moStudyBisect(features, n, maxK, sample) {
  const dims = features.length;
  const label = new Int32Array(n);
  const parent = [-1];
  const members = [Array.from({ length: n }, (_, i) => i)];
  const meanOf = (idx) => { const m = new Float64Array(dims); for (const i of idx) for (let d = 0; d < dims; d++) m[d] += features[d][i]; for (let d = 0; d < dims; d++) m[d] /= idx.length || 1; return m; };
  const dist = (i, q) => { let s = 0; for (let d = 0; d < dims; d++) { const e = features[d][i] - q[d]; s += e * e; } return s; };
  const sse = (idx) => { const m = meanOf(idx); let s = 0; for (const i of idx) s += dist(i, m); return s; };
  const err = [sse(members[0])];
  for (let k = 1; k < maxK; k++) {
    let c = 0; for (let j = 1; j < err.length; j++) if (err[j] > err[c]) c = j;
    const idx = members[c];
    if (idx.length < 4 || err[c] <= 1e-9) break;
    const m = meanOf(idx), step = Math.max(1, Math.floor(idx.length / sample));
    let p1 = idx[0], best = -1;
    for (let t = 0; t < idx.length; t += step) { const dd = dist(idx[t], m); if (dd > best) { best = dd; p1 = idx[t]; } }
    let c1 = Array.from({ length: dims }, (_, d) => features[d][p1]); best = -1; let p2 = idx[0];
    for (let t = 0; t < idx.length; t += step) { const dd = dist(idx[t], c1); if (dd > best) { best = dd; p2 = idx[t]; } }
    let c2 = Array.from({ length: dims }, (_, d) => features[d][p2]);
    const side = new Uint8Array(idx.length);
    for (let it = 0; it < 8; it++) {
      const s1 = new Float64Array(dims), s2 = new Float64Array(dims); let n1 = 0, n2 = 0;
      for (let t = 0; t < idx.length; t++) {
        const i = idx[t], right = dist(i, c2) < dist(i, c1); side[t] = right ? 1 : 0;
        if (right) { n2++; for (let d = 0; d < dims; d++) s2[d] += features[d][i]; } else { n1++; for (let d = 0; d < dims; d++) s1[d] += features[d][i]; }
      }
      if (!n1 || !n2) break;
      c1 = Array.from(s1, (v) => v / n1); c2 = Array.from(s2, (v) => v / n2);
    }
    const a = [], b = [];
    for (let t = 0; t < idx.length; t++) (side[t] ? b : a).push(idx[t]);
    if (!a.length || !b.length) { err[c] = 0; k--; continue; }
    members[c] = a; members.push(b); parent.push(c);
    for (const i of b) label[i] = k;
    err[c] = sse(a); err.push(sse(b));
  }
  return { label, parent };
}
/** The groups as they were when there were `k`. */
export function moStudyAtLevel(tree, k) {
  const out = new Int32Array(tree.label.length);
  for (let i = 0; i < out.length; i++) { let l = tree.label[i]; while (l >= k) l = tree.parent[l]; out[i] = l; }
  return out;
}
/** Each pixel takes the most common group around it, for cleaner shapes. */
export function moStudyMajority(lbl, w, h, passes) {
  let cur = lbl;
  for (let p = 0; p < passes; p++) {
    const nx = new Int32Array(cur.length);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const cnt = new Map(); let bestL = cur[y * w + x], bestC = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const l = cur[Math.min(h - 1, Math.max(0, y + dy)) * w + Math.min(w - 1, Math.max(0, x + dx))];
        const c = (cnt.get(l) || 0) + 1; cnt.set(l, c);
        if (c > bestC) { bestC = c; bestL = l; }
      }
      nx[y * w + x] = bestC >= 5 ? bestL : cur[y * w + x];
    }
    cur = nx;
  }
  return cur;
}

const paint = (P, fn) => { const out = new Uint8ClampedArray(P.n * 4); for (let i = 0; i < P.n; i++) { const c = fn(i); out[i * 4] = c[0]; out[i * 4 + 1] = c[1]; out[i * 4 + 2] = c[2]; out[i * 4 + 3] = 255; } return out; };

/** Light and shadow: two families split at value `split`, each in its own average colour. */
export function moStudyLight(P, split, show) {
  const sum = [[0, 0, 0, 0], [0, 0, 0, 0]];
  for (let i = 0; i < P.n; i++) { const f = P.V[i] >= split ? 0 : 1; sum[f][0] += P.L[i]; sum[f][1] += P.A[i]; sum[f][2] += P.B[i]; sum[f][3]++; }
  const fam = sum.map((x) => (x[3] ? [x[0] / x[3], x[1] / x[3], x[2] / x[3]] : [0.5, 0, 0]));
  const rgb = fam.map((f) => moFromOklab(f[0], f[1], f[2]));
  const pixels = paint(P, (i) => { const f = P.V[i] >= split ? 0 : 1; return show === 'bw' ? (f ? [20, 20, 20] : [235, 235, 235]) : rgb[f]; });
  const wl = moStudyWarmth(fam[0][1], fam[0][2]), ws = moStudyWarmth(fam[1][1], fam[1][2]);
  return {
    pixels,
    families: [{ rgb: rgb[0], share: sum[0][3] / P.n }, { rgb: rgb[1], share: sum[1][3] / P.n }],
    warmer: wl > ws + 0.004 ? 'light' : ws > wl + 0.004 ? 'shadow' : 'neither',
  };
}

/** Temperature: orange where warmer than its surroundings (or the whole picture), blue where cooler. */
export function moStudyTemperature(P, against, min) {
  const warm = new Float32Array(P.n);
  for (let i = 0; i < P.n; i++) warm[i] = moStudyWarmth(P.A[i], P.B[i]);
  let ref;
  if (against === 'all') { let m = 0; for (let i = 0; i < P.n; i++) m += warm[i]; ref = new Float32Array(P.n).fill(m / P.n); }
  else ref = moStudyBlur(warm, P.w, P.h, Math.round(Math.max(P.w, P.h) * 0.06));
  const cut = 0.004 + (min / 100) * 0.05;
  return {
    pixels: paint(P, (i) => {
      const d = warm[i] - ref[i], L = P.L[i];
      if (Math.abs(d) < cut) return greyOf(L);
      const k = Math.min(1, (Math.abs(d) - cut) / 0.05) * 0.11 + 0.03;
      return d > 0 ? moFromOklab(L, k * WARM[0], k * WARM[1]) : moFromOklab(L, -k * WARM[0], -k * WARM[1]);
    }),
  };
}

/**
 * Colour masses: `n` big shapes of one colour each, found by colour alone,
 * by colour and place, or after squinting. A mass's colour is its local
 * colour (the most common one in it) or its average; `amount` (0 to 100)
 * turns the colour down toward grey at the same value. `sel` dims all but
 * one mass. Returns the pixels and the masses, largest first:
 * { j, rgb, value, intensity, share }.
 */
export function moStudyMasses(P, opts, sel = -1) {
  const key = `m-${opts.method}`;
  if (!P.cache[key]) {
    const src = opts.method === 'shapes' ? squinted(P, 45) : P;
    const feats = [Float32Array.from(src.L), src.A.map((v) => v * 2.6), src.B.map((v) => v * 2.6)];
    if (opts.method === 'place') {
      const sx = new Float32Array(P.n), sy = new Float32Array(P.n), sc = 0.14 / Math.max(P.w, P.h);
      for (let i = 0; i < P.n; i++) { sx[i] = (i % P.w) * sc; sy[i] = Math.floor(i / P.w) * sc; }
      feats.push(sx, sy);
    }
    P.cache[key] = moStudyBisect(feats, P.n, 16, 4000);
  }
  // The shapes at this count are kept: colour and amount change only the colours.
  const lk = `l-${opts.method}-${opts.n}`;
  if (!P.cache[lk]) { const raw = moStudyAtLevel(P.cache[key], opts.n); P.cache[lk] = opts.method === 'colour' ? raw : moStudyMajority(raw, P.w, P.h, opts.method === 'shapes' ? 3 : 2); }
  const lbl = P.cache[lk];
  let k = 0; for (let i = 0; i < lbl.length; i++) if (lbl[i] >= k) k = lbl[i] + 1;
  const groups = Array.from({ length: k }, () => []);
  for (let i = 0; i < P.n; i++) groups[lbl[i]].push(i);
  const lab = groups.map((idx) => {
    if (!idx.length) return [0.5, 0, 0];
    if (opts.colour === 'average') { let L = 0, a = 0, b = 0; for (const i of idx) { L += P.L[i]; a += P.A[i]; b += P.B[i]; } return [L / idx.length, a / idx.length, b / idx.length]; }
    // Local colour: the most common colour (coarse bins), grown with its close neighbours so a smooth gradient still has one.
    const bins = new Map();
    for (const i of idx) { const kk = `${Math.round(P.L[i] / 0.05)},${Math.round(P.A[i] / 0.02)},${Math.round(P.B[i] / 0.02)}`; const e = bins.get(kk) || [0, 0, 0, 0]; e[0] += P.L[i]; e[1] += P.A[i]; e[2] += P.B[i]; e[3]++; bins.set(kk, e); }
    let top = null; for (const e of bins.values()) if (!top || e[3] > top[3]) top = e;
    const c = [top[0] / top[3], top[1] / top[3], top[2] / top[3]], s0 = [0, 0, 0, 0];
    for (const i of idx) if (Math.hypot(P.L[i] - c[0], 2 * (P.A[i] - c[1]), 2 * (P.B[i] - c[2])) < 0.06) { s0[0] += P.L[i]; s0[1] += P.A[i]; s0[2] += P.B[i]; s0[3]++; }
    return s0[3] ? [s0[0] / s0[3], s0[1] / s0[3], s0[2] / s0[3]] : c;
  });
  const amt = opts.amount / 100;
  const rgb = lab.map((c) => moFromOklab(c[0], c[1] * amt, c[2] * amt));
  const pixels = paint(P, (i) => { const l = lbl[i]; const c = rgb[l]; return sel >= 0 && l !== sel ? [c[0] * 0.25 + 30, c[1] * 0.25 + 30, c[2] * 0.25 + 30] : c; });
  const masses = lab.map((c, j) => ({ j, rgb: rgb[j], value: moStudyValue(...rgb[j]), intensity: moStudyIntensity(c[1] * amt, c[2] * amt), share: groups[j].length / P.n }))
    .filter((m) => m.share > 0).sort((a, b) => b.share - a.share);
  return { pixels, masses };
}

/** Intensity: colour only where it is stronger than `keep`; the rest grey at the same value. */
export function moStudyIntensityLens(P, keep) {
  const hist = new Array(15).fill(0);
  const pixels = paint(P, (i) => { const c = moStudyIntensity(P.A[i], P.B[i]); hist[Math.min(14, Math.floor(c))]++; return c >= keep ? [P.px[i * 4], P.px[i * 4 + 1], P.px[i * 4 + 2]] : greyOf(P.L[i]); });
  let kept = 0; for (let j = Math.ceil(keep); j < 15; j++) kept += hist[j];
  return { pixels, hist, keptShare: kept / P.n };
}

/** A spot's colour (a 7 x 7 average around x, y in the analysed picture). */
export function moStudySpot(P, x, y) {
  const acc = [0, 0, 0, 0, 0];
  for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
    const i = Math.min(P.h - 1, Math.max(0, Math.round(y) + dy)) * P.w + Math.min(P.w - 1, Math.max(0, Math.round(x) + dx));
    acc[0] += P.L[i]; acc[1] += P.A[i]; acc[2] += P.B[i]; acc[3] += P.V[i]; acc[4]++;
  }
  const L = acc[0] / acc[4], a = acc[1] / acc[4], b = acc[2] / acc[4];
  return { value: acc[3] / acc[4], warm: moStudyWarmth(a, b), intensity: moStudyIntensity(a, b), hue: moStudyHue(a, b), rgb: moFromOklab(L, a, b) };
}

/** How B differs from A, in painter's words: one line each for value, temperature, hue and intensity. */
export function moStudyCompare(A, B) {
  const dv = B.value - A.value, dw = B.warm - A.warm, dc = B.intensity - A.intensity;
  const dh = ((B.hue - A.hue + 540) % 360) - 180;
  const lines = [];
  lines.push(Math.abs(dv) < 0.5 ? 'About the same value.' : `B is ${Math.abs(dv).toFixed(1)} values ${dv < 0 ? 'darker' : 'lighter'} (${A.value.toFixed(1)} to ${B.value.toFixed(1)}).`);
  lines.push(Math.abs(dw) < 0.008 ? 'About the same temperature.' : `B is ${dw < 0 ? 'cooler' : 'warmer'}.`);
  if (Math.min(A.intensity, B.intensity) > 1.2) lines.push(Math.abs(dh) > 8 ? `B's hue leans from ${moStudyHueName(A.hue)} toward ${moStudyHueName(B.hue)}.` : `Both are ${moStudyHueName(A.hue)} in hue.`);
  lines.push(Math.abs(dc) < 0.8 ? 'About the same intensity.' : `B is ${dc < 0 ? 'greyer' : 'more intense'} (${A.intensity.toFixed(1)} to ${B.intensity.toFixed(1)}).`);
  if (dv < -1 && dc < -0.8) lines.push('Darker and greyer at once: typical of a shadow side. Mixing only a darker version of A would look flat.');
  return lines;
}

/** One name per mass ("Muted olive green"); masses that share a name are told apart by value: lighter, mid, darker. */
export function moStudyMassNames(masses) {
  const base = masses.map((m) => moColourName(m.rgb).name);
  const out = base.slice();
  for (const n of new Set(base)) {
    const idx = base.map((b, j) => (b === n ? j : -1)).filter((j) => j >= 0);
    if (idx.length < 2) continue;
    idx.sort((x, y) => masses[y].value - masses[x].value);
    const words = idx.length === 2 ? ['lighter', 'darker'] : ['lighter', ...idx.slice(2).map(() => 'mid'), 'darker'];
    idx.forEach((j, k) => { out[j] = `${n} (${words[k]})`; });
  }
  return out;
}
