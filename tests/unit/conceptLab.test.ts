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
  clRandPoisson,
  clDiscreteMoments,
  clCompoundMoments,
  clCompoundSim,
  clBivarCond,
  clBivarCloud,
  clSumSd,
  clLognLoglik,
  clLognMle,
  MODULES,
  LEVELS,
  clGetModule,
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
  it('every module is grounded: exam modules in a paper, concept modules in bridges', () => {
    const levelIds = new Set(LEVELS.map((l: any) => l.id));
    for (const mod of MODULES) {
      expect(mod.id).toBeTruthy();
      expect(levelIds.has(mod.level), `${mod.id}.level = ${mod.level}`).toBe(true);
      expect(['concept', 'exam'], `${mod.id}.kind`).toContain(mod.kind);
      if (mod.kind === 'exam') {
        expect(mod.paper?.label).toBeTruthy();
        expect(mod.paper?.section).toBeTruthy();
      } else {
        // The anti-stranding contract: a concept module must say where the
        // exam uses it, or it is an orphan.
        expect((mod.bridges ?? []).length, `${mod.id} has no bridges`).toBeGreaterThan(0);
      }
      expect(mod.checks.length).toBeGreaterThan(0);
      expect(mod.params.length).toBeGreaterThan(0);
      expect(mod.presets.length).toBeGreaterThan(0);
      expect(mod.story.length).toBeGreaterThan(0);
    }
  });

  it('every foundations/bridges link resolves to a real module, no self-links', () => {
    for (const mod of MODULES) {
      for (const item of [...(mod.foundations ?? []), ...(mod.bridges ?? [])]) {
        expect(clGetModule(item.module), `${mod.id} -> ${item.module}`).toBeTruthy();
        expect(item.module, `${mod.id} links to itself`).not.toBe(mod.id);
        expect(item.text, `${mod.id} -> ${item.module} text`).toBeTruthy();
      }
    }
  });

  it('story steps TEACH: no caption-length steps (Mufaro 2026-08-17)', () => {
    // A step must carry a real explanation: anchor, action, mechanism,
    // consequence. Captions were rejected; this gate keeps them out.
    for (const mod of MODULES) {
      for (const step of mod.story) {
        if (step.predict) {
          const combined = step.text.length + step.predict.prompt.length + step.predict.explain.length;
          expect(combined, `${mod.id} / "${step.title}" predict teaches ${combined} chars`).toBeGreaterThanOrEqual(500);
        } else {
          expect(step.text.length, `${mod.id} / "${step.title}" is ${step.text.length} chars`).toBeGreaterThanOrEqual(350);
        }
      }
      expect((mod.intro || '').length, `${mod.id} intro`).toBeGreaterThanOrEqual(200);
    }
  });

  it('story steps reference real presets and carry well-formed predicts', () => {
    for (const mod of MODULES) {
      for (const step of mod.story) {
        if (step.preset) {
          expect(
            mod.presets.some((p: any) => p.id === step.preset),
            `${mod.id} story preset ${step.preset}`,
          ).toBe(true);
        }
        if (step.predict) {
          expect(step.predict.prompt).toBeTruthy();
          expect(step.predict.explain).toBeTruthy();
          expect(step.predict.options.length).toBeGreaterThanOrEqual(2);
          expect(step.predict.answer).toBeGreaterThanOrEqual(0);
          expect(step.predict.answer).toBeLessThan(step.predict.options.length);
        }
      }
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
// Foundations kernel — the concept-level machinery (Levels 1-4)
// ---------------------------------------------------------------------------

describe('foundations kernel', () => {
  it('Poisson sampler hits its mean and variance over seeded draws', () => {
    const rng = clMulberry32(11);
    let s = 0, s2 = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) { const k = clRandPoisson(4, rng); s += k; s2 += k * k; }
    const mean = s / n;
    expect(mean).toBeCloseTo(4, 1);
    expect(s2 / n - mean * mean).toBeCloseTo(4, 0);
  });

  it('discrete moments and renormalization', () => {
    const m = clDiscreteMoments([
      { x: 0, p: 1 }, { x: 1, p: 2 }, { x: 2, p: 3 }, { x: 3, p: 2 }, { x: 4, p: 1 },
    ]);
    expect(m.mean).toBeCloseTo(2, 12);
    expect(m.varc).toBeCloseTo(4 / 3, 12);
    expect(m.skew).toBeCloseTo(0, 12);
    const scaled = clDiscreteMoments([
      { x: 0, p: 10 }, { x: 1, p: 20 }, { x: 2, p: 30 }, { x: 3, p: 20 }, { x: 4, p: 10 },
    ]);
    expect(scaled.mean).toBeCloseTo(m.mean, 12);
    expect(scaled.varc).toBeCloseTo(m.varc, 12);
  });

  it('compound Poisson: E[S] = λE[X], Var(S) = λE[X²], and the sim agrees', () => {
    const m = clCompoundMoments(4, 10, 0.5);
    expect(m.mean).toBeCloseTo(40, 12);
    expect(m.varc).toBeCloseTo(4 * 100 * 1.25, 10); // λ·m²(1+cv²) = 500
    const draws = clCompoundSim({ lambda: 4, sevMean: 10, sevCv: 0.5, n: 20000, seed: 3 });
    const mean = draws.reduce((a: number, b: number) => a + b, 0) / draws.length;
    const varc = draws.reduce((a: number, b: number) => a + (b - mean) * (b - mean), 0) / draws.length;
    expect(Math.abs(mean - m.mean) / m.mean).toBeLessThan(0.02);
    expect(Math.abs(varc - m.varc) / m.varc).toBeLessThan(0.08);
  });

  it('bivariate conditioning matches the closed form', () => {
    const par = { muX: 10, muY: 20, sdX: 2, sdY: 5, rho: 0.6 };
    const c = clBivarCond(par, 12);
    expect(c.mean).toBeCloseTo(20 + 0.6 * (5 / 2) * 2, 12); // 23
    expect(c.sd).toBeCloseTo(5 * Math.sqrt(1 - 0.36), 12);  // 4
    // ρ = 0: knowing X tells you nothing.
    expect(clBivarCond({ ...par, rho: 0 }, 12).mean).toBeCloseTo(20, 12);
  });

  it('bivariate cloud reproduces its correlation over seeded draws', () => {
    const pts = clBivarCloud({ muX: 0, muY: 0, sdX: 1, sdY: 1, rho: 0.7 }, 20000, 5);
    let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
    for (const p of pts) { sx += p.x; sy += p.y; sxx += p.x * p.x; syy += p.y * p.y; sxy += p.x * p.y; }
    const n = pts.length;
    const covar = sxy / n - (sx / n) * (sy / n);
    const r = covar / Math.sqrt((sxx / n - (sx / n) ** 2) * (syy / n - (sy / n) ** 2));
    expect(r).toBeCloseTo(0.7, 1);
  });

  it('sum SD identity: independence adds variances, ρ = 1 adds SDs', () => {
    expect(clSumSd(3, 4, 0)).toBeCloseTo(5, 12);
    expect(clSumSd(3, 4, 1)).toBeCloseTo(7, 12);
    expect(clSumSd(3, 4, -1)).toBeCloseTo(1, 12);
  });

  it('lognormal MLE is the mean and RMS spread of the logs, and maximizes ℓ', () => {
    const data = [1, 2, 4, 8, 16].map((x) => x * 3);
    const { mu, sigma } = clLognMle(data);
    const logs = data.map((x) => Math.log(x));
    const mHat = logs.reduce((a, b) => a + b, 0) / logs.length;
    expect(mu).toBeCloseTo(mHat, 12);
    const best = clLognLoglik(data, mu, sigma);
    for (const [dm, ds] of [[0.05, 0], [-0.05, 0], [0, 0.05], [0, -0.05]]) {
      expect(clLognLoglik(data, mu + dm, sigma + ds)).toBeLessThan(best);
    }
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
