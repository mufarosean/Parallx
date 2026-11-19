// colour-study-wheel.js — draws Colour Study's wheel: every hue round the
// rim, strength from the centre out, at one lightness, with what the paints
// cannot mix dimmed and hatched. Fast enough to redraw while a lightness bar
// is dragged: the geometry of each pixel is worked out once per size, a hue
// table once per wheel model, and reach is asked on a coarse ring grid and
// blended, so its edge is smooth.

import { moReachLab } from './paint-engine.js';
import { moLinearOklab } from './colour.js';
import { moWheelHue } from './paint-wheel.js';

const STEPS = 3600, RING_A = 144, RING_R = 36;
const luts = new Map();
function hueTable(model) {
  if (!luts.has(model)) { const t = new Float32Array(STEPS); for (let i = 0; i < STEPS; i++) t[i] = moWheelHue(i / 10, model); luts.set(model, t); }
  return luts.get(model);
}
const lin = new Float32Array(256);
for (let i = 0; i < 256; i++) { const v = i / 255; lin[i] = v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }

export function moWheelPainter(canvas) {
  let N = 0, angle = null, radius = null;
  function geometry(n) {
    N = n; angle = new Uint16Array(n * n); radius = new Float32Array(n * n);
    const R = n / 2;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const dx = x - R + 0.5, dy = y - R + 0.5, i = y * n + x;
      radius[i] = Math.hypot(dx, dy) / (R - 1);
      angle[i] = Math.min(STEPS - 1, Math.floor((((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360) * 10));
    }
  }
  return {
    /** The canvas's size on screen and its pixels: both sides, always. */
    size(css, dpr) {
      const n = Math.max(64, Math.round(css * Math.min(2, dpr || 1)));
      canvas.style.width = canvas.style.height = `${css}px`;
      if (canvas.width !== n || canvas.height !== n) { canvas.width = n; canvas.height = n; }
      if (N !== n) geometry(n);
    },
    /** o: { model, lightness 0..1, gamut | null, hatch } */
    draw(o) {
      if (!N) return;
      const g = canvas.getContext('2d'), im = g.createImageData(N, N), d = im.data, hues = hueTable(o.model), l = o.lightness;
      const chroma = Math.min(l, 1 - l);
      const rgbAt = (hue, r, out) => {
        const a = r * chroma;
        for (let c = 0; c < 3; c++) { const k = ((c === 0 ? 0 : c === 1 ? 8 : 4) + hue / 30) % 12; out[c] = 255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))); }
      };
      // Reach on a ring grid, then blended per pixel.
      let ring = null;
      if (o.gamut && o.hatch) {
        ring = new Float32Array(RING_A * (RING_R + 1));
        const c = [0, 0, 0];
        for (let j = 0; j < RING_A; j++) for (let i = 0; i <= RING_R; i++) {
          rgbAt(hues[Math.floor((j / RING_A) * STEPS)], i / RING_R, c);
          const lab = moLinearOklab([lin[Math.round(c[0])], lin[Math.round(c[1])], lin[Math.round(c[2])]]);
          ring[j * (RING_R + 1) + i] = moReachLab(o.gamut, lab[0], 2 * lab[1], 2 * lab[2]);
        }
      }
      const c = [0, 0, 0], stripe = Math.max(8, Math.round(N / 34));
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const i = y * N + x, r = radius[i];
        if (r > 1) continue;
        rgbAt(hues[angle[i]], r, c);
        if (ring) {
          const fa = (angle[i] / STEPS) * RING_A, a0 = Math.floor(fa) % RING_A, a1 = (a0 + 1) % RING_A, ta = fa - Math.floor(fa);
          const fr = r * RING_R, r0 = Math.min(RING_R - 1, Math.floor(fr)), tr = fr - r0;
          const reach = (ring[a0 * (RING_R + 1) + r0] * (1 - ta) + ring[a1 * (RING_R + 1) + r0] * ta) * (1 - tr) + (ring[a0 * (RING_R + 1) + r0 + 1] * (1 - ta) + ring[a1 * (RING_R + 1) + r0 + 1] * ta) * tr;
          let k = Math.max(0, Math.min(1, (0.62 - reach) / 0.3)); k = k * k * (3 - 2 * k);
          if (k > 0) {
            const line = (x + y) % stripe < stripe * 0.22 ? 0.5 * k : 0, dim = 0.42 * k;
            for (let ch = 0; ch < 3; ch++) c[ch] = (c[ch] * (1 - dim) + 96 * dim) * (1 - line);
          }
        }
        const p = i * 4;
        d[p] = c[0]; d[p + 1] = c[1]; d[p + 2] = c[2]; d[p + 3] = r > 0.985 ? Math.round((255 * (1 - r)) / 0.015) : 255;
      }
      g.putImageData(im, 0, 0);
    },
  };
}
