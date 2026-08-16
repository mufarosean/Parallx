// conceptLab.test.ts — the exam-tie-in gate for Concept Lab (M100).
//
// Every module ships `checks` that reproduce its paper's PRINTED exhibit
// values (Brosius Tables 1-5, Mack 2000 Examples 1-2, the Gogol Correction
// Note figures). A module that cannot recompute its paper's printed numbers
// does not ship — this file is where that promise is enforced.

import { describe, expect, it } from 'vitest';

// @ts-expect-error — plain-JS extension module with no types
import { __testables } from '../../ext/concept-lab/main.js';

const {
  clMulberry32,
  clRandNormal,
  clLogGamma,
  clNormCdf,
  clNormInv,
  clMatchLognormal,
  clLognCdf,
  clLognInv,
  clPoissonPmf,
  clOdpSupport,
  clNbPmf,
  clFitLeastSquares,
  clKsD,
  clKsBand,
  clPpPoints,
  MODULES,
} = __testables;

// ---------------------------------------------------------------------------
// Paper-exhibit reproduction — every module's declared checks
// ---------------------------------------------------------------------------

describe.each(MODULES.map((m: any) => [m.id, m] as const))(
  'module %s reproduces its paper',
  (_id: string, mod: any) => {
    it.each(mod.checks.map((c: any) => [c.name, c] as const))(
      '%s',
      (_name: string, check: any) => {
        const got = check.got();
        expect(got).toBeCloseToTarget(check.expect, check.tol);
      },
    );
  },
);

// Custom matcher: |got - expect| <= tol, with tol = 0 meaning exact.
expect.extend({
  toBeCloseToTarget(received: number, target: number, tol: number) {
    const pass = tol === 0 ? received === target : Math.abs(received - target) <= tol;
    return {
      pass,
      message: () =>
        `expected ${received} to be within ${tol} of ${target} (off by ${Math.abs(received - target)})`,
    };
  },
});

declare module 'vitest' {
  interface Assertion<T> {
    toBeCloseToTarget(target: number, tol: number): T;
  }
}

// ---------------------------------------------------------------------------
// Module hygiene — the declarative contract the UI relies on
// ---------------------------------------------------------------------------

describe('module definitions', () => {
  it('every module carries paper grounding and at least one check', () => {
    for (const mod of MODULES) {
      expect(mod.id).toBeTruthy();
      expect(mod.paper?.label).toBeTruthy();
      expect(mod.paper?.section).toBeTruthy();
      expect(mod.checks.length).toBeGreaterThan(0);
      expect(mod.params.length).toBeGreaterThan(0);
      expect(mod.presets.length).toBeGreaterThan(0);
      expect(mod.story.length).toBeGreaterThan(0);
    }
  });

  it('derived() evaluates finite at every param default', () => {
    for (const mod of MODULES) {
      const p: Record<string, number> = {};
      for (const par of mod.params) p[par.key] = par.init;
      const d = mod.derived(p, { mode: null });
      for (const [k, v] of Object.entries(d)) {
        if (typeof v === 'number') {
          expect(Number.isFinite(v), `${mod.id}.${k}`).toBe(true);
        }
      }
    }
  });

  it('every preset patches only declared params, within its own range', () => {
    for (const mod of MODULES) {
      const keys = new Set(mod.params.map((p: any) => p.key));
      for (const preset of mod.presets) {
        for (const [key, patch] of Object.entries(preset.params ?? {}) as [string, any][]) {
          expect(keys.has(key), `${mod.id}/${preset.id}/${key}`).toBe(true);
          const base = mod.params.find((p: any) => p.key === key);
          const min = patch.min ?? base.min;
          const max = patch.max ?? base.max;
          expect(patch.value).toBeGreaterThanOrEqual(min);
          expect(patch.value).toBeLessThanOrEqual(max);
        }
      }
    }
  });

  it('derived() evaluates finite at every preset', () => {
    for (const mod of MODULES) {
      for (const preset of mod.presets) {
        const p: Record<string, number> = {};
        for (const par of mod.params) p[par.key] = par.init;
        for (const [key, patch] of Object.entries(preset.params ?? {}) as [string, any][]) {
          p[key] = patch.value;
        }
        const d = mod.derived(p, { mode: preset.mode ?? null });
        for (const [k, v] of Object.entries(d)) {
          if (typeof v === 'number') {
            expect(Number.isFinite(v), `${mod.id}/${preset.id}/${k}`).toBe(true);
          }
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Math kernel — known-value tests independent of any module
// ---------------------------------------------------------------------------

describe('math kernel', () => {
  it('logGamma matches factorials', () => {
    expect(Math.exp(clLogGamma(5))).toBeCloseTo(24, 8);      // 4!
    expect(Math.exp(clLogGamma(11))).toBeCloseTo(3628800, 2); // 10!
    expect(clLogGamma(0.5)).toBeCloseTo(Math.log(Math.sqrt(Math.PI)), 10);
  });

  it('normal CDF hits the textbook anchors', () => {
    expect(clNormCdf(0)).toBeCloseTo(0.5, 7);
    expect(clNormCdf(1.959964)).toBeCloseTo(0.975, 5);
    expect(clNormCdf(-1.644854)).toBeCloseTo(0.05, 5);
  });

  it('normInv inverts normCdf', () => {
    for (const p of [0.01, 0.05, 0.25, 0.5, 0.75, 0.95, 0.99]) {
      expect(clNormCdf(clNormInv(p))).toBeCloseTo(p, 6);
    }
  });

  it('lognormal moment matching reproduces the target moments', () => {
    const { mu, sigma } = clMatchLognormal(0.9, 0.35);
    // Mack 2000 §5 prints sigma = 0.375 for exactly these inputs.
    expect(sigma).toBeCloseTo(0.375, 3);
    const mean = Math.exp(mu + (sigma * sigma) / 2);
    const varc = Math.exp(2 * mu + sigma * sigma) * (Math.exp(sigma * sigma) - 1);
    expect(mean).toBeCloseTo(0.9, 10);
    expect(Math.sqrt(varc)).toBeCloseTo(0.35, 10);
  });

  it('lognormal quantiles bracket the median at exp(mu)', () => {
    const { mu, sigma } = clMatchLognormal(1, 0.5);
    expect(clLognInv(0.5, mu, sigma)).toBeCloseTo(Math.exp(mu), 8);
    expect(clLognCdf(clLognInv(0.9, mu, sigma), mu, sigma)).toBeCloseTo(0.9, 6);
  });

  it('Poisson pmf sums to one and hits its mean', () => {
    let sum = 0, mean = 0;
    for (let k = 0; k < 80; k++) { const p = clPoissonPmf(k, 7); sum += p; mean += k * p; }
    expect(sum).toBeCloseTo(1, 10);
    expect(mean).toBeCloseTo(7, 8);
  });

  it('ODP support has mean mu and variance phi*mu', () => {
    const pts = clOdpSupport(100, 8, 0);
    let sum = 0, mean = 0, m2 = 0;
    for (const { x, p } of pts) { sum += p; mean += x * p; m2 += x * x * p; }
    expect(sum).toBeCloseTo(1, 6);
    expect(mean).toBeCloseTo(100, 3);
    expect(m2 - mean * mean).toBeCloseTo(800, 1);
  });

  it('negative binomial pmf sums to one with the right mean', () => {
    // failures before rth success: mean = r(1-p)/p
    let sum = 0, mean = 0;
    for (let k = 0; k < 400; k++) { const p = clNbPmf(k, 4, 0.5); sum += p; mean += k * p; }
    expect(sum).toBeCloseTo(1, 8);
    expect(mean).toBeCloseTo(4, 6);
  });

  it('least squares recovers an exact linear relationship', () => {
    const fit = clFitLeastSquares([[0, 3], [1, 5], [2, 7], [3, 9]]);
    expect(fit.b).toBeCloseTo(2, 12);
    expect(fit.a).toBeCloseTo(3, 12);
  });

  it('seeded RNG replays identically', () => {
    const a = clMulberry32(42), b = clMulberry32(42);
    for (let i = 0; i < 10; i++) expect(a()).toBe(b());
  });

  it('randNormal is roughly standard over many draws', () => {
    const rng = clMulberry32(7);
    let sum = 0, sum2 = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) { const z = clRandNormal(rng); sum += z; sum2 += z * z; }
    expect(sum / n).toBeCloseTo(0, 1);
    expect(sum2 / n).toBeCloseTo(1, 1);
  });
});

// ---------------------------------------------------------------------------
// Meyers validation machinery — the KS band and p-p construction
// ---------------------------------------------------------------------------

describe('validation machinery (Meyers §3)', () => {
  it('KS band reproduces the printed critical values', () => {
    expect(clKsBand(50)).toBeCloseTo(19.2, 1);   // Monograph 8 n=50
    expect(clKsBand(100)).toBeCloseTo(13.6, 1);  // illustrative Figure 3.1
    expect(clKsBand(200)).toBeCloseTo(9.6, 1);   // all lines combined
  });

  it('perfectly uniform percentiles give a small D that passes the band', () => {
    const n = 100;
    const unif = Array.from({ length: n }, (_, i) => ((i + 0.5) / n) * 100);
    const d = clKsD(unif);
    expect(d).toBeLessThan(1);
    expect(d).toBeLessThan(clKsBand(n));
  });

  it('a biased-high model fails the band the way Figure 3.1 shows', () => {
    // Outcomes systematically land in the model's low percentiles.
    const n = 100;
    const biased = Array.from({ length: n }, (_, i) => Math.pow((i + 0.5) / n, 2) * 100);
    expect(clKsD(biased)).toBeGreaterThan(clKsBand(n));
  });

  it('p-p points are sorted with plotting positions i/(n+1)', () => {
    const pts = clPpPoints([80, 20, 50]);
    expect(pts.map((p: any) => p.observed)).toEqual([20, 50, 80]);
    expect(pts[0].expected).toBeCloseTo(25, 10);
    expect(pts[1].expected).toBeCloseTo(50, 10);
    expect(pts[2].expected).toBeCloseTo(75, 10);
  });
});
