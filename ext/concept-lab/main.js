// ============================================================================
// Concept Lab — interactive exam explorables (M100)
//
// Maps the statistical machinery of CAS Exam 7 papers to live, animated,
// direct-manipulation graphics. Every module's defaults ARE its paper's own
// worked example, and every module carries machine-checkable `checks` that
// reproduce the printed exhibit values (run from tests/unit/conceptLab.test.ts
// via the __testables export). A module that cannot recompute its paper's
// printed numbers does not ship.
//
// Single-file ESM: external tools load as blob-URL modules, so relative
// imports are unreachable at runtime — all code lives here (web-research
// precedent). No npm deps: math is closed-form + seeded simulation, charts
// are hand-built SVG.
//
// Section map:
//   1. Math kernel (pure, side-effect free — exported via __testables)
//   2. Module framework (defineModule) + module definitions
//   3. Styles (single injected <style>)
//   4. UI framework — tween engine, formula renderer, SVG stage, param rail
//   5. Editor pane (module router, view-state hooks)
//   6. Sidebar view (module launcher)
//   7. Activation
//   8. __testables
// ============================================================================

// ============================================================================
// SECTION 1: MATH KERNEL
// Pure functions only. Everything here is unit-tested against printed
// exhibit values, so keep signatures stable and side-effect free.
// ============================================================================

/** Deterministic RNG — simulations must replay identically for tests. */
function clMulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal draw (Box-Muller; consumes two uniforms per pair). */
function clRandNormal(rng) {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

/** Lanczos log-gamma (g=7, n=9). Accurate to ~1e-13 over the visual range. */
function clLogGamma(x) {
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - clLogGamma(1 - x);
  }
  x -= 1;
  let a = c[0];
  const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/** erf via Abramowitz & Stegun 7.1.26 (|error| <= 1.5e-7 — fine for visuals). */
function clErf(x) {
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return sign * y;
}

function clNormPdf(x, mu = 0, sigma = 1) {
  const z = (x - mu) / sigma;
  return Math.exp(-0.5 * z * z) / (sigma * Math.sqrt(2 * Math.PI));
}

function clNormCdf(x, mu = 0, sigma = 1) {
  return 0.5 * (1 + clErf((x - mu) / (sigma * Math.SQRT2)));
}

/** Acklam's inverse normal CDF (~1.15e-9 relative error). */
function clNormInv(p, mu = 0, sigma = 1) {
  if (p <= 0 || p >= 1) return NaN;
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  const pl = 0.02425;
  let q, r, z;
  if (p < pl) {
    q = Math.sqrt(-2 * Math.log(p));
    z = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else if (p <= 1 - pl) {
    q = p - 0.5; r = q * q;
    z = (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  } else {
    q = Math.sqrt(-2 * Math.log(1 - p));
    z = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  return mu + sigma * z;
}

/**
 * Lognormal parameters from a target mean and sd (Meyers' moment matching:
 * sigma^2 = ln(1 + CV^2), mu = ln(mean) - sigma^2/2).
 */
function clMatchLognormal(mean, sd) {
  const cv2 = (sd / mean) * (sd / mean);
  const sigma2 = Math.log(1 + cv2);
  return { mu: Math.log(mean) - sigma2 / 2, sigma: Math.sqrt(sigma2) };
}

function clLognPdf(x, mu, sigma) {
  if (x <= 0) return 0;
  return clNormPdf(Math.log(x), mu, sigma) / x;
}

function clLognCdf(x, mu, sigma) {
  if (x <= 0) return 0;
  return clNormCdf(Math.log(x), mu, sigma);
}

function clLognInv(p, mu, sigma) {
  return Math.exp(clNormInv(p, mu, sigma));
}

function clPoissonPmf(k, lambda) {
  if (k < 0 || !Number.isInteger(k)) return 0;
  if (lambda <= 0) return k === 0 ? 1 : 0;
  return Math.exp(k * Math.log(lambda) - lambda - clLogGamma(k + 1));
}

/**
 * Over-dispersed Poisson: mass sits on the phi-lattice {0, phi, 2phi, ...}
 * with Poisson(mu/phi) weights, so E = mu and Var = phi*mu. This is the
 * quasi-likelihood object the papers never draw — the whole point of the
 * zoo module.
 */
function clOdpSupport(mu, phi, maxMass = 1e-4) {
  const lambda = mu / phi;
  const pts = [];
  const kMax = Math.max(8, Math.ceil(lambda + 8 * Math.sqrt(lambda)));
  for (let k = 0; k <= kMax; k++) {
    const p = clPoissonPmf(k, lambda);
    if (p > maxMass || k <= lambda) pts.push({ x: k * phi, p });
  }
  return pts;
}

function clGammaPdf(x, shape, scale) {
  if (x <= 0) return 0;
  return Math.exp((shape - 1) * Math.log(x) - x / scale - clLogGamma(shape) - shape * Math.log(scale));
}

/** Negative binomial pmf (failures k before the r-th success, P(success)=p). */
function clNbPmf(k, r, p) {
  if (k < 0 || !Number.isInteger(k)) return 0;
  return Math.exp(clLogGamma(k + r) - clLogGamma(k + 1) - clLogGamma(r) + r * Math.log(p) + k * Math.log(1 - p));
}

/** Ordinary least squares on (x, y) pairs — Brosius' estimator. */
function clFitLeastSquares(pairs) {
  const n = pairs.length;
  let sx = 0, sy = 0, sxy = 0, sxx = 0;
  for (const [x, y] of pairs) { sx += x; sy += y; sxy += x * y; sxx += x * x; }
  const xbar = sx / n, ybar = sy / n;
  const b = (sxy / n - xbar * ybar) / (sxx / n - xbar * xbar);
  const a = ybar - b * xbar;
  return { a, b, xbar, ybar };
}

/**
 * Brosius credibility line: Z = VHM/(VHM+EPV) and
 * L(x) = Z*(x/d) + (1-Z)*EY. Slope Z/d, intercept (1-Z)*EY.
 */
function clBrosiusCred({ EY, d, vhm, epv }) {
  const Z = vhm / (vhm + epv);
  const slope = Z / d;
  const intercept = (1 - Z) * EY;
  return { Z, slope, intercept, L: (x) => intercept + slope * x };
}

/** The three reference estimators the credibility line interpolates. */
function clBrosiusReferences({ EY, d }, x) {
  return {
    linkRatio: x / d,          // chain ladder: a = 0
    budgeted: EY,              // budgeted loss: b = 0
    bf: x + (1 - d) * EY,      // Bornhuetter-Ferguson: b = 1
  };
}

// --- Mack (2000) / Benktander credibility algebra (Theorems 3 & 4) ---------

/**
 * t from the three assessed variances (Mack 2000 p.340): beta^2 =
 * Var(C_k/U | U)/(p*q); E[alpha^2(U)] = E[U^2]*beta^2;
 * t = E[alpha^2] / (Var(U0) + Var(U) - E[alpha^2]).
 */
function clMackT({ p, EU, sdU, sdU0, sdCkU }) {
  const q = 1 - p;
  const beta2 = (sdCkU * sdCkU) / (p * q);
  const EU2 = sdU * sdU + EU * EU;
  const Ea2 = EU2 * beta2;
  const t = Ea2 / (sdU0 * sdU0 + sdU * sdU - Ea2);
  return { beta2, Ea2, t };
}

/** Theorem 3: c* = p / (p + t). */
function clMackCStar(p, t) {
  return p / (p + t);
}

/**
 * Theorem 4: mse(R_c) = E[alpha^2] * q^2 * (c^2/p + 1/q + (1-c)^2/t).
 * c=0 collapses to mse(R_BF), c=1 to mse(R_CL) (exactly: q^2(1/p+1/q) = q/p),
 * c=p to mse(R_GB) — one formula covers all four printed cases.
 */
function clMackMse(c, { p, t, Ea2 }) {
  const q = 1 - p;
  return Ea2 * q * q * ((c * c) / p + 1 / q + ((1 - c) * (1 - c)) / t);
}

/** Reserves along the credibility mixture R_c = c*R_CL + (1-c)*R_BF. */
function clMackReserves({ p, U0, Ck }, c) {
  const q = 1 - p;
  const Rbf = q * U0;
  const Ucl = Ck / p;
  const Rcl = q * Ucl;
  const Rc = c * Rcl + (1 - c) * Rbf;
  return { Rbf, Rcl, Rgb: p * Rcl + q * Rbf, Rc, Ucl, Uc: Ck + Rc };
}

/**
 * Regime map boundaries (Mack 2000 Figure 1): BF is best above t = 2 - p,
 * CL is best below t = p*q/(1+p), GB rules the middle band.
 */
function clMackRegime(p, t) {
  const q = 1 - p;
  if (t >= 2 - p) return 'BF';
  if (t <= (p * q) / (1 + p)) return 'CL';
  return 'GB';
}

/**
 * Gogol's exact Bayesian model with Mack's Correction Note applied:
 * mu_1 = z*(tau^2/2 + ln(C_k/p)) + (1-z)*mu. The tau^2/2 (not tau^2) is
 * the trap the exam grades on — corrected values E(R|C_k)=51.9%, sd 18.9%.
 */
function clGogolPosterior({ EU, sdU, beta2, p, Ck }) {
  const q = 1 - p;
  const sigma2 = Math.log(1 + (sdU * sdU) / (EU * EU));
  const mu = Math.log(EU) - sigma2 / 2;
  const tau2 = Math.log(1 + (beta2 * q) / p);
  const z = sigma2 / (sigma2 + tau2);
  const sigma12 = z * tau2;
  const mu1 = z * (tau2 / 2 + Math.log(Ck / p)) + (1 - z) * mu;
  const EUC = Math.exp(mu1 + sigma12 / 2);
  const varUC = Math.exp(2 * mu1 + sigma12) * (Math.exp(sigma12) - 1);
  return { z, mu, sigma2, tau2, sigma12, mu1, EUC, ERC: EUC - Ck, sdRC: Math.sqrt(varUC) };
}

/**
 * Normal analog of the Gogol structure, exactly conjugate: U ~ N(EU, sdU^2),
 * C_k|U ~ N(pU, s^2) with s^2 = p*q*beta^2*EU^2 (the lognormal model's
 * conditional variance, frozen at the prior mean so the algebra stays
 * closed-form). Posterior mean = z*(C_k/p) + (1-z)*EU with
 * z = p^2 sdU^2 / (p^2 sdU^2 + s^2).
 */
function clNormalConjugate({ EU, sdU, beta, p, Ck }) {
  const q = 1 - p;
  const s2 = p * q * beta * beta * EU * EU;
  const pv = p * p * sdU * sdU;
  const z = pv / (pv + s2);
  const postMean = z * (Ck / p) + (1 - z) * EU;
  const postVar = (sdU * sdU * s2) / (pv + s2);
  return { z, EUC: postMean, ERC: postMean - Ck, sdRC: Math.sqrt(postVar), s: Math.sqrt(s2) };
}

// --- Meyers validation machinery (Monograph 8 sections 3-4) ----------------

/**
 * Kolmogorov-Smirnov D on predicted percentiles (in [0,100]) vs uniform:
 * D = max|F_emp - F_unif| * 100, with the paper's critical band 136/sqrt(n)
 * (19.2 at n=50, 13.6 at n=100, 9.6 at n=200).
 */
function clKsD(percentiles) {
  const sorted = [...percentiles].sort((a, b) => a - b);
  const n = sorted.length;
  let d = 0;
  for (let i = 0; i < n; i++) {
    const f = sorted[i] / 100;
    d = Math.max(d, Math.abs(f - (i + 1) / n), Math.abs(f - i / n));
  }
  return d * 100;
}

function clKsBand(n) {
  return 136 / Math.sqrt(n);
}

/** Sorted percentiles -> p-p plot points {expected, observed} in [0,100]. */
function clPpPoints(percentiles) {
  const sorted = [...percentiles].sort((a, b) => a - b);
  const n = sorted.length;
  return sorted.map((v, i) => ({ expected: ((i + 1) / (n + 1)) * 100, observed: v }));
}

/**
 * One seeded validation experiment (Meyers §3 mechanics): truth draws
 * outcomes from N(0,1); the model claims N(bias, tail). Each outcome's
 * percentile UNDER THE MODEL is Phi((x - bias)/tail); a correct model makes
 * those uniform. Draws depend only on (n, seed), so bias/tail sliders reprice
 * the same outcomes — the honest way to show a defect, and cheap enough to
 * recompute on every drag.
 */
const _valDrawCache = new Map();
function clValidationDraws(n, seed) {
  const key = seed + ':' + n;
  let draws = _valDrawCache.get(key);
  if (!draws) {
    const rng = clMulberry32(seed);
    draws = [];
    for (let i = 0; i < n; i++) draws.push(clRandNormal(rng));
    _valDrawCache.set(key, draws);
    if (_valDrawCache.size > 40) _valDrawCache.delete(_valDrawCache.keys().next().value);
  }
  return draws;
}

function clValidationRun({ n, bias, tail, seed }) {
  const draws = clValidationDraws(n, seed);
  const percentiles = draws.map((x) => 100 * clNormCdf((x - bias) / tail));
  return { percentiles, D: clKsD(percentiles) };
}

// --- Mack (1994) chain-ladder machinery ------------------------------------

/**
 * Age-to-age factors under Mack's three weightings (his (12), (2), (13)):
 * 'ols' regresses C_{k+1} on C_k through the origin, 'vw' is the volume
 * weighted chain-ladder estimator, 'avg' is the plain mean of individual
 * factors. Triangle rows are cumulative, row i observed to length I - i.
 */
function clMackFactorSet(tri, method) {
  const I = tri.length;
  const f = [];
  for (let k = 0; k < I - 1; k++) {
    let num = 0, den = 0, sum = 0, cnt = 0;
    for (let i = 0; i < I; i++) {
      const row = tri[i];
      if (row.length < k + 2) continue;
      const a = row[k], b = row[k + 1];
      if (method === 'ols') { num += a * b; den += a * a; }
      else if (method === 'avg') { sum += b / a; cnt++; }
      else { num += b; den += a; }
    }
    f.push(method === 'avg' ? sum / cnt : num / den);
  }
  return f;
}

/**
 * Mack's variance constants alpha_k^2 (formula (8)) with his rule (9) for
 * the final, non-estimable one: min(a_{K-1}^4/a_{K-2}^2, min(a_{K-2}^2,
 * a_{K-1}^2)) — 'a bit more on the safe side' than the loglinear plot.
 */
function clMackAlpha2(tri) {
  const I = tri.length;
  const f = clMackFactorSet(tri, 'vw');
  const a2 = [];
  for (let k = 0; k < I - 2; k++) {
    let sum = 0, n = 0;
    for (let i = 0; i < I; i++) {
      const row = tri[i];
      if (row.length < k + 2) continue;
      const dev = row[k + 1] / row[k] - f[k];
      sum += row[k] * dev * dev;
      n++;
    }
    a2.push(sum / (n - 1));
  }
  const m = a2.length;
  a2.push(Math.min((a2[m - 1] * a2[m - 1]) / a2[m - 2], Math.min(a2[m - 2], a2[m - 1])));
  return a2;
}

/** Project the full square from the observed triangle and a factor set. */
function clMackProject(tri, f) {
  const I = tri.length;
  return tri.map((row) => {
    const full = [...row];
    for (let k = row.length - 1; k < I - 1; k++) full.push(full[k] * f[k]);
    return full;
  });
}

/**
 * Standard errors of the chain-ladder reserves: per-year formula (7), total
 * formula (11), both on the volume-weighted factors. Also carries the
 * per-step cumulative variance so a projection ribbon can widen age by age.
 */
function clMackSe(tri) {
  const I = tri.length;
  const f = clMackFactorSet(tri, 'vw');
  const a2 = clMackAlpha2(tri);
  const proj = clMackProject(tri, f);
  // S_k in formulas (7)/(11) sums ONLY the years that estimated f_k — rows
  // with both C_k and C_{k+1} observed. Including the newest diagonal's C_k
  // (observed but factorless) understates every standard error ~12%.
  const colSum = [];
  for (let k = 0; k < I; k++) {
    let s = 0;
    for (let i = 0; i < I; i++) if (tri[i].length >= k + 2) s += tri[i][k];
    colSum.push(s);
  }
  const perYear = [];
  for (let i = 0; i < I; i++) {
    const obs = tri[i].length;
    let acc = 0;
    // steps[j] = variance accumulator through projected column c (0-based),
    // so se of the intermediate projection is proj[i][c] * sqrt(acc).
    const steps = [];
    for (let k = obs - 1; k < I - 1; k++) {
      acc += (a2[k] / (f[k] * f[k])) * (1 / proj[i][k] + 1 / colSum[k]);
      steps.push({ c: k + 1, acc });
    }
    const ult = proj[i][I - 1];
    perYear.push({
      ult,
      reserve: ult - tri[i][obs - 1],
      se: ult * Math.sqrt(acc),
      steps,
    });
  }
  let totalMse = 0;
  for (let i = 0; i < I; i++) {
    totalMse += perYear[i].se * perYear[i].se;
    let later = 0;
    for (let j = i + 1; j < I; j++) later += perYear[j].ult;
    let cross = 0;
    for (let k = tri[i].length - 1; k < I - 1; k++) {
      cross += (2 * a2[k]) / (f[k] * f[k]) / colSum[k];
    }
    totalMse += perYear[i].ult * later * cross;
  }
  const totalReserve = perYear.reduce((s, y) => s + y.reserve, 0);
  return { f, a2, proj, perYear, totalReserve, totalSe: Math.sqrt(totalMse) };
}

/** Mack's lognormal range: sigma^2 = ln(1 + cv^2), percentile via z. */
function clMackLognRange(R, cv, z) {
  const s2 = Math.log(1 + cv * cv);
  return R * Math.exp(z * Math.sqrt(s2) - s2 / 2);
}

// --- Clark (2003) growth curves --------------------------------------------

/** Clark's growth function: expected % of ultimate emerged by age x months. */
function clClarkG(x, { family, omega, theta }) {
  if (x <= 0) return 0;
  if (family === 'weibull') return 1 - Math.exp(-Math.pow(x / theta, omega));
  const xw = Math.pow(x, omega);
  return xw / (xw + Math.pow(theta, omega));
}

/**
 * LDF-method reserves off the latest diagonal: development to the truncation
 * age (G(truncAvg)/G(age) - 1), or to ultimate when truncAvg is null.
 */
function clClarkReserves(diag, ages, shape, truncAvg) {
  const gCap = truncAvg == null ? 1 : clClarkG(truncAvg, shape);
  const perAY = diag.map((c, i) => c * (gCap / clClarkG(ages[i], shape) - 1));
  return { perAY, total: perAY.reduce((a, b) => a + b, 0) };
}

/** Cape Cod ELR: total reported over used-up premium (Premium x G(age)). */
function clClarkElr(diag, ages, premium, shape) {
  let rep = 0, used = 0;
  for (let i = 0; i < diag.length; i++) {
    rep += diag[i];
    used += premium[i] * clClarkG(ages[i], shape);
  }
  return { elr: rep / used, usedUp: used };
}

// --- Shapland ODP bootstrap ------------------------------------------------

/** Marsaglia-Tsang gamma draw (scale 1); Johnk boost for shape < 1. */
function clRandGamma(shape, rng) {
  if (shape <= 0) return 0;
  if (shape < 1) {
    let u = 0;
    while (u === 0) u = rng();
    return clRandGamma(shape + 1, rng) * Math.pow(u, 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x, v;
    do { x = clRandNormal(rng); v = 1 + c * x; } while (v <= 0);
    v = v * v * v;
    const u = rng();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (u > 0 && Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

/**
 * Fit the ODP/chain-ladder structure to an incremental triangle: volume
 * weighted factors, backward-fitted incremental means (England-Verrall),
 * unscaled Pearson residuals, and the scale parameter phi = sum(r^2)/(n-p).
 */
function clOdpFit(inc) {
  const I = inc.length;
  const cum = inc.map((row) => {
    const out = [];
    let s = 0;
    for (const q of row) { s += q; out.push(s); }
    return out;
  });
  const f = clMackFactorSet(cum, 'vw');
  // Backward fit: anchor each year at its diagonal, divide down the factors.
  const fitCum = cum.map((row) => {
    const out = new Array(row.length);
    out[row.length - 1] = row[row.length - 1];
    for (let k = row.length - 1; k > 0; k--) out[k - 1] = out[k] / f[k - 1];
    return out;
  });
  const fitInc = fitCum.map((row) => row.map((c, k) => (k === 0 ? c : c - row[k - 1])));
  const resid = [];
  let ss = 0, n = 0;
  for (let i = 0; i < I; i++) {
    for (let k = 0; k < inc[i].length; k++) {
      const m = fitInc[i][k];
      if (m > 0) {
        const r = (inc[i][k] - m) / Math.sqrt(m);
        resid.push({ i, k, r });
        ss += r * r;
        n++;
      }
    }
  }
  const p = 2 * I - 1;
  const phi = ss / (n - p);
  // Degrees-of-freedom correction on the resampling pool (Shapland §3):
  // raw Pearson residuals understate the noise the model consumed fitting
  // its 2I-1 parameters; without it the bootstrap cv runs ~3 points light.
  const dfCorr = Math.sqrt(n / (n - p));
  const proj = clMackProject(cum, f);
  let clReserve = 0;
  for (let i = 0; i < I; i++) clReserve += proj[i][I - 1] - cum[i][cum[i].length - 1];
  return { I, cum, f, fitInc, resid, phi, dfCorr, clReserve };
}

/**
 * One ODP bootstrap pseudo-world: resample residuals onto the fitted means,
 * refit the chain ladder, project, and (optionally) add ODP process noise
 * via gamma draws with mean m and variance phi*m.
 */
function clOdpBootstrapOnce(fit, rng, withProcess) {
  const { I, fitInc, resid, phi, dfCorr } = fit;
  const pseudoCum = [];
  for (let i = 0; i < I; i++) {
    const row = [];
    let s = 0;
    for (let k = 0; k < fitInc[i].length; k++) {
      const m = fitInc[i][k];
      const draw = resid[Math.floor(rng() * resid.length)].r * dfCorr;
      s += m + draw * Math.sqrt(Math.max(0, m));
      row.push(s);
    }
    pseudoCum.push(row);
  }
  const fStar = clMackFactorSet(pseudoCum, 'vw');
  let reserve = 0;
  for (let i = 0; i < I; i++) {
    let c = pseudoCum[i][pseudoCum[i].length - 1];
    for (let k = pseudoCum[i].length - 1; k < I - 1; k++) {
      const next = c * fStar[k];
      let q = next - c;
      if (withProcess && q > 0) q = clRandGamma(q / phi, rng) * phi;
      reserve += q;
      c = next;
    }
  }
  return reserve;
}

// --- Taylor & McGuire marginal-sum (ODP cross-classified) estimation -------

/**
 * Marginal-sum estimation of the ODP cross-classified model (Taylor eqs
 * (3-1)/(3-2)): alternate row balances alpha_k = rowSum/sum(observed beta)
 * and column balances beta_j = colSum/sum(observed alpha), normalized to
 * sum(beta) = 1. These are the ODP MLEs, and Taylor's Theorem says their
 * forecasts coincide cell-by-cell with the chain ladder's.
 */
function clMarginalSum(inc, iters = 200) {
  const I = inc.length;
  const alpha = inc.map((row) => row.reduce((a, b) => a + b, 0));
  let beta = new Array(I).fill(1 / I);
  for (let it = 0; it < iters; it++) {
    for (let k = 0; k < I; k++) {
      let bSum = 0;
      for (let j = 0; j < inc[k].length; j++) bSum += beta[j];
      alpha[k] = inc[k].reduce((a, b) => a + b, 0) / bSum;
    }
    const next = [];
    for (let j = 0; j < I; j++) {
      let cSum = 0, aSum = 0;
      for (let k = 0; k < I; k++) {
        if (inc[k].length > j) { cSum += inc[k][j]; aSum += alpha[k]; }
      }
      next.push(cSum / aSum);
    }
    const norm = next.reduce((a, b) => a + b, 0);
    beta = next.map((b) => b / norm);
    for (let k = 0; k < I; k++) {
      let bSum = 0;
      for (let j = 0; j < inc[k].length; j++) bSum += beta[j];
      alpha[k] = inc[k].reduce((a, b) => a + b, 0) / bSum;
    }
  }
  return { alpha, beta };
}

// --- Marshall risk-margin consolidation ------------------------------------

/** Weighted correlation aggregation: sqrt(sum w_i w_j rho_ij c_i c_j) / W. */
function clCovAggregate(w, c, rho, indices) {
  const idx = indices || w.map((_, i) => i);
  let W = 0;
  for (const i of idx) W += w[i];
  let v = 0;
  for (const i of idx) {
    for (const j of idx) {
      const r = i === j ? 1 : rho(i, j);
      v += w[i] * w[j] * r * c[i] * c[j];
    }
  }
  return Math.sqrt(v) / W;
}

// --- Random-walk Metropolis on a 2D gaussian target ------------------------

/** Bivariate normal log-density up to a constant (all Metropolis needs). */
function clMvn2LogPdf(x, y, t) {
  const zx = (x - t.mx) / t.sx;
  const zy = (y - t.my) / t.sy;
  const r = t.rho || 0;
  return -(zx * zx - 2 * r * zx * zy + zy * zy) / (2 * (1 - r * r));
}

/**
 * One random-walk Metropolis proposal, scaled per-axis by the target sds so
 * `step` is in sd units. Mutates `state` on acceptance; returns the proposal
 * either way so the UI can flash rejections.
 */
function clMetropolisStep(state, target, step, rng) {
  const px = state.x + clRandNormal(rng) * step * target.sx;
  const py = state.y + clRandNormal(rng) * step * target.sy;
  const logA = clMvn2LogPdf(px, py, target) - clMvn2LogPdf(state.x, state.y, target);
  const u = rng();
  const accept = u > 0 && Math.log(u) < logA;
  if (accept) { state.x = px; state.y = py; }
  return { px, py, accept };
}

function clMetropolisRun({ n, step, seed, target, start }) {
  const rng = clMulberry32(seed);
  const state = { x: start?.x ?? target.mx, y: start?.y ?? target.my };
  const xs = [], ys = [];
  let accepted = 0;
  for (let i = 0; i < n; i++) {
    if (clMetropolisStep(state, target, step, rng).accept) accepted++;
    xs.push(state.x);
    ys.push(state.y);
  }
  return { xs, ys, acceptRate: accepted / n };
}

// --- Foundations kernel: samplers, moments, conditioning, likelihood -------
// Pure machinery for the concept levels (probability → estimation). Concept
// modules pin their checks on these identities the same way exam modules pin
// theirs on printed exhibits.

/** Poisson sampler: Knuth product method; normal rounding above λ = 30
    (teaching simulations, where the approximation error is invisible). */
function clRandPoisson(lambda, rng) {
  if (!(lambda > 0)) return 0;
  if (lambda > 30) {
    return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * clRandNormal(rng)));
  }
  const L = Math.exp(-lambda);
  let k = 0, p = 1;
  do { k++; p *= rng(); } while (p > L);
  return k - 1;
}

/** Mean / variance / sd / skewness of a discrete distribution [{x, p}].
    Renormalizes p so dragged bar heights need not sum to one. */
function clDiscreteMoments(masses) {
  let tot = 0;
  for (const m of masses) tot += m.p;
  if (!(tot > 0)) return { mean: NaN, varc: NaN, sd: NaN, skew: NaN };
  let mean = 0;
  for (const m of masses) mean += (m.p / tot) * m.x;
  let m2 = 0, m3 = 0;
  for (const m of masses) {
    const dev = m.x - mean;
    m2 += (m.p / tot) * dev * dev;
    m3 += (m.p / tot) * dev * dev * dev;
  }
  const sd = Math.sqrt(m2);
  return { mean, varc: m2, sd, skew: sd > 0 ? m3 / (sd * sd * sd) : 0 };
}

/** Compound Poisson moments: S = X₁+…+X_N, N ~ Poisson(λ).
    E[S] = λ·E[X]; Var(S) = λ·E[X²] — variance rides on the SECOND moment,
    which is why severity volatility hurts more than frequency volatility. */
function clCompoundMoments(lambda, sevMean, sevCv) {
  const m2 = sevMean * sevMean * (1 + sevCv * sevCv);
  return { mean: lambda * sevMean, varc: lambda * m2, sd: Math.sqrt(lambda * m2) };
}

/** Seeded compound Poisson-lognormal aggregate draws. */
function clCompoundSim({ lambda, sevMean, sevCv, n, seed }) {
  const rng = clMulberry32(seed);
  const { mu, sigma } = clMatchLognormal(sevMean, sevMean * sevCv);
  const draws = new Array(n);
  for (let i = 0; i < n; i++) {
    const count = clRandPoisson(lambda, rng);
    let s = 0;
    for (let c = 0; c < count; c++) s += Math.exp(mu + sigma * clRandNormal(rng));
    draws[i] = s;
  }
  return draws;
}

/** Bivariate normal conditioning: the whole point of regression.
    E[Y|X=x] = μy + ρ(σy/σx)(x−μx);  SD[Y|X=x] = σy√(1−ρ²). */
function clBivarCond({ muX, muY, sdX, sdY, rho }, x) {
  return {
    mean: muY + rho * (sdY / sdX) * (x - muX),
    sd: sdY * Math.sqrt(Math.max(0, 1 - rho * rho)),
  };
}

/** Seeded correlated-normal cloud [{x, y}] via the Cholesky construction. */
function clBivarCloud({ muX, muY, sdX, sdY, rho }, n, seed) {
  const rng = clMulberry32(seed);
  const pts = new Array(n);
  const c = Math.sqrt(Math.max(0, 1 - rho * rho));
  for (let i = 0; i < n; i++) {
    const z1 = clRandNormal(rng);
    const z2 = clRandNormal(rng);
    pts[i] = { x: muX + sdX * z1, y: muY + sdY * (rho * z1 + c * z2) };
  }
  return pts;
}

/** SD of a sum of two correlated risks: √(σ₁² + σ₂² + 2ρσ₁σ₂). */
function clSumSd(s1, s2, rho) {
  return Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 + 2 * rho * s1 * s2));
}

/** Lognormal log-likelihood of strictly positive data. */
function clLognLoglik(data, mu, sigma) {
  if (!(sigma > 0)) return -Infinity;
  let ll = 0;
  for (const x of data) {
    if (!(x > 0)) return -Infinity;
    const z = (Math.log(x) - mu) / sigma;
    ll += -Math.log(x) - Math.log(sigma) - 0.5 * Math.log(2 * Math.PI) - 0.5 * z * z;
  }
  return ll;
}

/** Lognormal MLE in closed form: mean and RMS spread of the logs. */
function clLognMle(data) {
  const logs = data.filter((x) => x > 0).map((x) => Math.log(x));
  const n = logs.length;
  if (!n) return { mu: NaN, sigma: NaN };
  const mu = logs.reduce((a, b) => a + b, 0) / n;
  const sigma = Math.sqrt(logs.reduce((a, b) => a + (b - mu) * (b - mu), 0) / n);
  return { mu, sigma };
}

// ============================================================================
// SECTION 2: MODULE FRAMEWORK + DEFINITIONS
// Modules are declarative content over the kernel: params in the paper's
// own notation, derived values, presets that ARE printed exhibits, a guided
// story, and checks against the printed numbers.
// ============================================================================

// The curriculum ladder. Every module belongs to one level; concept modules
// teach the statistics, exam modules apply it on the papers' own numbers.
// `foundations` links UP the ladder (what a module stands on), `bridges`
// links DOWN (where Exam 7 uses the concept) — the anti-stranding contract:
// a concept module without bridges is an orphan and fails the hygiene test.
const LEVELS = [
  { id: 'probability', title: 'Probability & Random Variables', tagline: 'What randomness is, and the objects that describe it.' },
  { id: 'behavior', title: 'How Randomness Behaves', tagline: 'Sums, conditioning, and risks that move together.' },
  { id: 'processes', title: 'Random Processes', tagline: 'Paths through time, and predicting the rest of one.' },
  { id: 'estimation', title: 'Estimation & Likelihood', tagline: 'Letting data pick parameters, and what that costs.' },
  { id: 'bayes', title: 'Bayesian Theory & Credibility', tagline: 'Beliefs as distributions, updated by evidence.' },
  { id: 'glm', title: 'Regression & GLMs', tagline: 'The model family behind modern reserving.' },
  { id: 'reserving', title: 'The Reserving Problem', tagline: 'Exam 7: the papers, on their own printed numbers.' },
];

function clGetLevel(id) {
  return LEVELS.find((l) => l.id === id);
}

const MODULES = [];

function defineModule(def) {
  MODULES.push(def);
  return def;
}

function clGetModule(id) {
  return MODULES.find((m) => m.id === id);
}

// --- Module: The Credibility Line (Brosius) --------------------------------

const BROSIUS_TABLE1 = [
  [19039, 23279], [33040, 41560], [14637, 18937],
  [2785, 5185], [51606, 54206], [5726, 15726],
];

const BROSIUS_TABLE2 = [
  [1, 1], [2, 9], [1, 2], [0, 2], [6, 7], [2, 5], [1, 3],
];

defineModule({
  id: 'brosius-line',
  title: 'Brosius: Least-Squares Development',
  subtitle: 'Least-squares loss development: one line, three famous methods inside it',
  icon: 'trending-up',
  level: 'reserving',
  kind: 'exam',
  ord: 1,
  foundations: [
    { module: 'conditional-expectation', text: 'The credibility line is the best guess E[Y|X], approximated by a straight line.' },
    { module: 'shrinkage', text: 'The Z weighting is shrinkage: trust the data in proportion to how much it varies between risks.' },
  ],
  paper: {
    label: 'Brosius, "Loss Development Using Credibility"',
    section: 'Tables 1-5 and the credibility form, pp. 3-14',
    task: 'Estimate ultimates with credibility-weighted development',
  },
  intro:
    'Every development method is a line through (reported, ultimate) space. ' +
    'Chain ladder forces it through the origin; budgeted loss makes it flat; ' +
    'Bornhuetter-Ferguson fixes the slope at one. Least squares lets the DATA ' +
    'pick the line, and the credibility form shows exactly how far it trusts ' +
    'your reported losses.',
  params: [
    { key: 'EY', tex: 'E[Y]', label: 'Prior Expected Ultimate', min: 1, max: 20, step: 0.1, init: 4, fmt: 'num', link: 'line-bl' },
    { key: 'd', tex: 'd', label: 'Expected % Reported', min: 0.05, max: 0.95, step: 0.01, init: 0.5, fmt: 'pct', link: 'line-cl' },
    { key: 'vhm', tex: 'VHM', label: 'Variance Of Hypothetical Means', min: 0.01, max: 8, step: 0.01, init: 1, fmt: 'num', link: 'line-ls', modes: ['cred'] },
    { key: 'epv', tex: 'EPV', label: 'Expected Process Variance', min: 0.01, max: 8, step: 0.01, init: 1, fmt: 'num', link: 'line-ls', modes: ['cred'] },
    { key: 'x', tex: 'x', label: 'Reported Losses', min: 0, max: 10, step: 0.1, init: 2, fmt: 'num', link: 'query' },
  ],
  derived(p) {
    const cred = clBrosiusCred(p);
    const refs = clBrosiusReferences(p, p.x);
    return {
      Z: cred.Z,
      slope: cred.slope,
      intercept: cred.intercept,
      Lx: cred.L(p.x),
      linkRatio: refs.linkRatio,
      budgeted: refs.budgeted,
      bf: refs.bf,
    };
  },
  readouts: [
    { sym: 'Z', id: 'Z', fmt: 'num3', label: 'Credibility' },
    { sym: 'L(x)', id: 'Lx', fmt: 'num', label: 'Credibility Estimate', accent: true, link: 'line-ls' },
    { sym: 'x/d', id: 'linkRatio', fmt: 'num', label: 'Chain Ladder', link: 'line-cl' },
    { sym: 'x+(1{-}d)E[Y]', id: 'bf', fmt: 'num', label: 'Bornhuetter-Ferguson', link: 'line-bf' },
  ],
  formula(state) {
    if (state.mode === 'fit') {
      return {
        sym: 'L(x) = a + bx',
        terms: [
          { sym: 'L(x)', fmt: 'num', get: (d) => d.fitL, primary: true, link: 'line-ls' },
          { op: '=' },
          { sym: 'a', fmt: 'num', get: (d) => d.fitA, link: 'line-ls' },
          { op: '+' },
          { sym: 'b', fmt: 'num3', get: (d) => d.fitB, link: 'line-ls' },
          { op: '·' },
          { sym: 'x', fmt: 'num', get: (d) => d.x, link: 'query' },
        ],
      };
    }
    return {
      sym: 'L(x) = Z\\,\\tfrac{x}{d} + (1{-}Z)\\,E[Y],\\quad Z = \\tfrac{VHM}{VHM+EPV}',
      terms: [
        { sym: 'L(x)', fmt: 'num', get: (d) => d.Lx, primary: true, link: 'line-ls' },
        { op: '=' },
        { sym: 'Z', fmt: 'num3', get: (d) => d.Z, link: 'line-ls' },
        { op: '·' },
        { sym: 'x/d', fmt: 'num', get: (d) => d.linkRatio, link: 'line-cl' },
        { op: '+' },
        { sym: '(1{-}Z)', fmt: 'num3', get: (d) => 1 - d.Z, link: 'line-bl' },
        { op: '·' },
        { sym: 'E[Y]', fmt: 'num', get: (d) => d.EY, link: 'line-bl' },
      ],
    };
  },
  presets: [
    {
      id: 'table1',
      label: 'Table 1: State AA',
      note: 'Six real accident years, 15-to-27 month development. The data picks the line: L(x) = 0.968x + 6,023.',
      mode: 'fit',
      data: BROSIUS_TABLE1,
      query: 40490,
      params: { EY: { value: 26482, min: 5000, max: 60000, step: 100 }, d: { value: 0.798 }, x: { value: 40490, min: 0, max: 60000, step: 100 } },
    },
    {
      id: 'poisson',
      label: 'Poisson World',
      note: 'Y ~ Poisson(4), each claim reported with probability 1/2. Bayes gives Q(x) = x + 2: exactly Bornhuetter-Ferguson, and Z = d.',
      mode: 'cred',
      params: { EY: { value: 4 }, d: { value: 0.5 }, vhm: { value: 1 }, epv: { value: 1 }, x: { value: 2 } },
    },
    {
      id: 'negbin',
      label: 'Negative Binomial World',
      note: 'Fatter prior (Var(Y) = 8 vs Poisson\'s 4) doubles VHM: Z rises to 2/3 and the line leans toward your data.',
      mode: 'cred',
      params: { EY: { value: 4 }, d: { value: 0.5 }, vhm: { value: 2 }, epv: { value: 1 }, x: { value: 2 } },
    },
    {
      id: 'uniform',
      label: 'Uniform World',
      note: 'Y uniform on {2,...,6}: tighter prior (VHM = 1/2), so Z falls to 1/3 and the line flattens toward E[Y].',
      mode: 'cred',
      params: { EY: { value: 4 }, d: { value: 0.5 }, vhm: { value: 0.5 }, epv: { value: 1 }, x: { value: 2 } },
    },
    {
      id: 'tort',
      label: 'The Tort Reform Story',
      note: 'A law change breaks the link to history. Industry studies say E[Y] = $12M; actuals come in at $6M reported. Credibility answers $9.5M, between every classical method.',
      mode: 'cred',
      params: {
        EY: { value: 12, min: 4, max: 24, step: 0.1 },
        d: { value: 0.75 },
        vhm: { value: 5.0625, min: 0.1, max: 12, step: 0.01 },
        epv: { value: 2.9988, min: 0.1, max: 12, step: 0.01 },
        x: { value: 6, min: 0, max: 20, step: 0.1 },
      },
    },
  ],
  story: [
    {
      title: 'The question first',
      text: 'A year has reported $x$ so far. What is the fairest guess for where it ends up? Level 2 taught the answer’s shape: the best guess given what you know, $E[Y|X{=}x]$, drawn as a line through the cloud. Every classical reserving method is just an OPINION about that line; this paper lets the data draw it instead. By the end you will see chain ladder, budgeted loss, and Bornhuetter-Ferguson as three special cases of one fitted line, and credibility as the dial that chooses between them: which is a much smaller thing to memorize than three separate methods.',
      preset: 'poisson',
    },
    {
      title: 'Three methods, one picture',
      text: 'Every classical development method is a line through this picture, and seeing them AS lines is the paper’s first gift. Chain ladder answers $L(x) = x/d$: divide reported by the expected reported fraction: which is a ray from the origin: report twice as much, expect twice the ultimate, no exceptions. Budgeted loss answers $L(x) = E[Y]$: a flat line that ignores your report entirely and repeats the prior. Bornhuetter-Ferguson splits the difference: start from the prior’s unreported piece and add the report dollar for dollar: a line with slope exactly one. All three are live on the stage as reference lines; drag the query marker $x$ along them and read each method’s answer at your reported amount. Now notice what should bother you: three defensible methods, three different answers from the same fact, and nothing in the picture yet says which line is RIGHT. That question is exactly what the data gets to answer next.',
      preset: 'poisson',
    },
    {
      title: 'Let the data pick',
      text: 'Brosius’ move is disarmingly simple: stop ASSUMING the line and FIT it. This preset loads Table 1 from the paper: six real accident years, each a dot at (reported at 15 months, ultimate at 27). Fit $L(x) = a + bx$ by least squares: the straight-line version of the best-guess line $E[Y|X]$ you built in Conditional Expectation: and the data answers $b = 0.968$, $a = 6{,}023$. Study where that line sits relative to the three reference lines: it is NONE of them. Not through the origin (so pure chain ladder is rejected by this data), not flat, not slope-one. The intercept says even a year reporting zero should be booked at about 6,000: some losses simply have not surfaced yet. And at the paper’s own query, $x = 40{,}490$, the fitted line answers 45,211: the number printed in Brosius’ exhibit, reproduced under your cursor. Six dots were enough to out-argue three traditions.',
      preset: 'table1',
    },
    {
      title: 'The credibility anatomy',
      text: 'Here is the paper’s deepest section, and you already own its parts. Rewrite the fitted line algebraically and it becomes $L(x) = Z\\,\\tfrac{x}{d} + (1{-}Z)\\,E[Y]$: a weighted average of chain ladder’s answer and budgeted loss’s answer: with the weight $Z = \\tfrac{VHM}{VHM+EPV}$. Those cryptic initials are the shrinkage valley from Credibility & Shrinkage wearing exam clothes: VHM (variance of hypothetical means) is τ², how much true results genuinely differ across years; EPV (expected process variance) is s², how noisy reporting is within a year. Drag VHM up and watch the line swing toward the chain-ladder ray: real differences earn trust in the data. Drag EPV up and it flattens toward the prior: noise earns shrinkage. The best development line is not chosen from a menu of methods; it is DIALED, by a ratio of two variances you can reason about.',
      preset: 'uniform',
    },
    {
      title: 'When history is useless',
      text: 'Now the situation that makes this machinery earn its living. A tort reform has just rewritten the rules: past years developed under different law, so fitting a line to history would be fitting to a world that no longer exists. Does the credibility view collapse? No: and this is the paper’s famous example. You cannot FIT the variances anymore, but you can still ASSESS them by judgment: industry studies say expect about 12M with such-and-such spread between possible outcomes (that is VHM), and reporting noise of so much (EPV). The dial then does its arithmetic: $Z = 0.628$, and with 6M reported against 9M expected at this maturity, the answer lands near 9.5M: below the prior’s 12M, well above chain ladder’s naive read. No classical method can even ASK for that number, because each has its slope pinned by dogma. Credibility’s slope is pinned by two variances you can defend in front of a regulator: which is the whole point.',
      preset: 'tort',
    },
  ],
  checks: [
    { name: 'Table 1 slope b', expect: 0.96781, tol: 1e-4, got: () => clFitLeastSquares(BROSIUS_TABLE1).b },
    { name: 'Table 1 intercept a', expect: 6023.71, tol: 0.5, got: () => clFitLeastSquares(BROSIUS_TABLE1).a },
    { name: 'Table 1 L(40,490)', expect: 45210.5, tol: 1, got: () => { const f = clFitLeastSquares(BROSIUS_TABLE1); return f.a + f.b * 40490; } },
    { name: 'Table 2 slope b', expect: 0.96875, tol: 1e-9, got: () => clFitLeastSquares(BROSIUS_TABLE2).b },
    { name: 'Table 2 intercept a', expect: 2.34375, tol: 1e-9, got: () => clFitLeastSquares(BROSIUS_TABLE2).a },
    { name: 'Poisson world: Z = d', expect: 0.5, tol: 1e-12, got: () => clBrosiusCred({ EY: 4, d: 0.5, vhm: 1, epv: 1 }).Z },
    { name: 'Poisson world: L(x) = x + 2 at x=3', expect: 5, tol: 1e-12, got: () => clBrosiusCred({ EY: 4, d: 0.5, vhm: 1, epv: 1 }).L(3) },
    { name: 'NegBin world: L(2) = (4*2+4)/3', expect: 4, tol: 1e-12, got: () => clBrosiusCred({ EY: 4, d: 0.5, vhm: 2, epv: 1 }).L(2) },
    { name: 'Uniform world: Z = 1/3', expect: 1 / 3, tol: 1e-12, got: () => clBrosiusCred({ EY: 4, d: 0.5, vhm: 0.5, epv: 1 }).Z },
    { name: 'Uniform world: L(6) = 6.667', expect: 20 / 3, tol: 1e-9, got: () => clBrosiusCred({ EY: 4, d: 0.5, vhm: 0.5, epv: 1 }).L(6) },
    { name: 'Tort reform: Z', expect: 0.628, tol: 5e-4, got: () => clBrosiusCred({ EY: 12, d: 0.75, vhm: 5.0625, epv: 2.9988 }).Z },
    { name: 'Tort reform: L($6M) = $9.5M', expect: 9.49, tol: 0.01, got: () => clBrosiusCred({ EY: 12, d: 0.75, vhm: 5.0625, epv: 2.9988 }).L(6) },
  ],
});

// --- Module: The MSE Valley (Mack 2000 / Benktander) -----------------------

const MACK_EXAMPLE1 = { p: 0.5, EU: 0.90, sdU: 0.35, sdU0: 0.15, sdCkU: 0.10, U0: 0.90, Ck: 0.55 };
const MACK_EXAMPLE2 = { p: 0.5, EU: 0.90, sdU: 0.10, sdU0: 0.05, sdCkU: 0.03, U0: 0.90, Ck: 0.55 };

defineModule({
  id: 'mse-valley',
  title: 'Mack 2000: Benktander Credibility',
  subtitle: 'Benktander and the optimal credibility factor, from Mack (2000)',
  icon: 'git-merge',
  level: 'reserving',
  kind: 'exam',
  ord: 2,
  foundations: [
    { module: 'shrinkage', text: 'The credibility weight c is a shrinkage dial, and the valley shows the price of setting it wrong.' },
    { module: 'sampling-error', text: 'The valley exists because estimates carry error; a perfect estimator would have no trade-off.' },
  ],
  paper: {
    label: 'Mack, "Credible Claims Reserves: The Benktander Method" (2000)',
    section: 'Theorems 3-4, Examples 1-2, Figure 1; pp. 337-341',
    task: 'Choose between BF, CL, and Benktander with justified precision',
  },
  intro:
    'Every reserve between Bornhuetter-Ferguson and chain ladder is a mixture ' +
    'R_c = c·R_CL + (1−c)·R_BF. Mean squared error is a parabola in c, so ' +
    'there is a valley, and Benktander (c = p) sits almost at the bottom of ' +
    'it for free. Drag the volatility t and watch the valley move.',
  params: [
    { key: 'p', tex: 'p_k', label: 'Expected % Paid', min: 0.05, max: 0.95, step: 0.01, init: 0.5, fmt: 'pct', link: 'map-dot' },
    { key: 'c', tex: 'c', label: 'Credibility Weight On CL', min: 0, max: 1, step: 0.005, init: 0.5, fmt: 'num2', link: 'c-marker' },
    { key: 'Ck', tex: 'C_k', label: 'Paid To Date (% Of Premium)', min: 0.05, max: 1.2, step: 0.01, init: 0.55, fmt: 'pct', link: 'mix' },
    { key: 'U0', tex: 'U_0', label: 'Prior Ultimate (% Of Premium)', min: 0.4, max: 1.6, step: 0.01, init: 0.90, fmt: 'pct', link: 'mix' },
    { key: 'sdU', tex: '\\sqrt{Var(U)}', label: 'Sd Of True Ultimate', min: 0.02, max: 0.6, step: 0.005, init: 0.35, fmt: 'pct', link: 't-val' },
    { key: 'sdU0', tex: '\\sqrt{Var(U_0)}', label: 'Sd Of The Prior Estimate', min: 0.0, max: 0.4, step: 0.005, init: 0.15, fmt: 'pct', link: 't-val' },
    { key: 'sdCkU', tex: '\\sqrt{Var(C_k/U|U)}', label: 'Payout Pattern Noise', min: 0.005, max: 0.25, step: 0.001, init: 0.10, fmt: 'pct', link: 't-val' },
  ],
  readouts: [
    { sym: 't', id: 't', fmt: 'num3', label: 'Volatility', link: 't-val' },
    { sym: 'c^*', id: 'cStar', fmt: 'num3', label: 'Optimal Weight', accent: true, link: 'c-star' },
    { sym: 'se(R_c)', id: 'seC', fmt: 'pct', label: 'Error At Current c', link: 'c-marker' },
    { sym: 'se(R_{GB})', id: 'seGB', fmt: 'pct', label: 'Benktander Error', link: 'st-gb' },
    { sym: 'R_c', id: 'Rc', fmt: 'pct', label: 'Credibility Reserve', accent: true, link: 'mix' },
    {
      sym: '', id: 'regime', fmt: 'str', label: 'Best Method Here', link: 'map-dot',
      get: (d) => ({ BF: 'Bornhuetter-Ferguson', GB: 'Benktander', CL: 'Chain Ladder' })[d.regime],
    },
  ],
  formula() {
    return {
      sym: 'mse(R_c) = E[\\alpha^2]\\,q_k^2\\left(\\tfrac{c^2}{p_k} + \\tfrac{1}{q_k} + \\tfrac{(1{-}c)^2}{t}\\right)',
      terms: [
        { sym: 'se(R_c)', fmt: 'pct', get: (d) => d.seC, primary: true, link: 'c-marker' },
        { op: 'at' },
        { sym: 'c', fmt: 'num2', get: (d) => d.c, link: 'c-marker' },
        { op: '|' },
        { sym: 'c^* = \\tfrac{p_k}{p_k+t}', fmt: 'num3', get: (d) => d.cStar, link: 'c-star' },
        { op: '|' },
        { sym: 't', fmt: 'num3', get: (d) => d.t, link: 't-val' },
        { op: '|' },
        { sym: 'R_c', fmt: 'pct', get: (d) => d.Rc, link: 'mix' },
      ],
    };
  },
  derived(par) {
    const { p, c, Ck, U0, sdU, sdU0, sdCkU } = par;
    const EU = U0; // the paper assumes E(U_0) = E(U)
    const q = 1 - p;
    const { beta2, Ea2, t } = clMackT({ p, EU, sdU, sdU0, sdCkU });
    const cStar = clMackCStar(p, t);
    const kit = { p, t, Ea2 };
    const res = clMackReserves({ p, U0, Ck }, c);
    return {
      q, beta2, Ea2, t, cStar,
      seBF: Math.sqrt(clMackMse(0, kit)),
      seCL: Math.sqrt(clMackMse(1, kit)),
      seGB: Math.sqrt(clMackMse(p, kit)),
      seOpt: Math.sqrt(clMackMse(cStar, kit)),
      seC: Math.sqrt(clMackMse(c, kit)),
      mseC: clMackMse(c, kit),
      regime: clMackRegime(p, t),
      tBoundaryBF: 2 - p,
      tBoundaryCL: (p * q) / (1 + p),
      ...res,
    };
  },
  presets: [
    {
      id: 'base',
      label: 'The Base Point',
      note: 'U0 = 90%, half paid, 55% in the till. R_BF = 45, R_CL = 55, Benktander answers 50, and its ultimate is a 75/25 blend of CL and the prior.',
      params: { p: { value: 0.5 }, Ck: { value: 0.55 }, U0: { value: 0.90 }, c: { value: 0.5 } },
    },
    {
      id: 'example1',
      label: 'Example 1: Volatile Line',
      note: 'Reinsurance-grade volatility (sd(U) = 35%): t = 0.35, c* = 0.59. GB’s error 17.3% beats BF’s 21.3% and CL’s 19.3%; the true optimum saves only 0.1% more.',
      params: {
        p: { value: 0.5 }, Ck: { value: 0.55 }, U0: { value: 0.90 },
        sdU: { value: 0.35 }, sdU0: { value: 0.15 }, sdCkU: { value: 0.10 },
        c: { value: 0.591 },
      },
    },
    {
      id: 'example2',
      label: 'Example 2: Stable Line',
      note: 'Everything calm (sd(U) = 10%): the errors shrink 3-4x but the RANKING holds; t barely moves because the relative variances did not.',
      params: {
        p: { value: 0.5 }, Ck: { value: 0.55 }, U0: { value: 0.90 },
        sdU: { value: 0.10 }, sdU0: { value: 0.05 }, sdCkU: { value: 0.03 },
        c: { value: 0.618 },
      },
    },
  ],
  story: [
    {
      title: 'The question first',
      text: 'You hold two answers for the same reserve: one that ignores this year’s losses entirely (BF) and one that trusts nothing else (chain ladder). Blending them is the shrinkage dial from Level 5, and "how much of each" has a RIGHT answer: the bottom of an error valley. This paper finds that bottom with pencil and paper: no simulation, no software: and then draws a map showing exactly when each classical method wins. Walk this module and the phrase "Benktander is nearly optimal" stops being a memorized verdict and becomes something you watched happen.',
      preset: 'base',
    },
    {
      title: 'One knob between two extremes',
      text: 'Put the two rival answers on a single dial. At $c = 0$ sits Bornhuetter-Ferguson: reserve the prior’s unreported share, and let this year’s actual losses have no say at all. At $c = 1$ sits chain ladder: gross up this year’s actuals and let the prior have no say. Every value between is a blend: $R_c = c \\cdot R_{CL} + (1{-}c) \\cdot R_{BF}$: and the parabola on stage prices every choice. Benktander’s proposal, decades before anyone proved anything about it, was elegantly physical: set $c = p_k$, the fraction of losses already paid. Trust the data exactly as fast as it arrives: a green year earns little credibility, a mature year earns most. Drag $c$ along the curve and watch the reserve readout swing between the two classical answers. The question this module answers: is Benktander’s instinct just tidy: or is it close to OPTIMAL? That requires knowing what the valley’s bottom means.',
      preset: 'base',
    },
    {
      title: 'The valley',
      text: 'To find the best blend you need a definition of "best", and Mack uses the one you built in Process vs Parameter Risk: mean squared error against the true reserve. His formula, mse$(R_c) = E[\\alpha^2]q_k^2\\left(\\tfrac{c^2}{p_k} + \\tfrac{1}{q_k} + \\tfrac{(1-c)^2}{t}\\right)$, looks dense until you read it as three payments: the $c^2$ term is the price of trusting noisy data (it grows as you lean on actuals), the $(1-c)^2$ term is the price of trusting an imperfect prior, and the middle term is process risk: the part no choice of $c$ can touch, the floor of the valley. Two prices pulling opposite directions make a parabola, exactly like the shrinkage valley one level down, and calculus hands over the bottom: $c^* = \\tfrac{p_k}{p_k + t}$. Now check Benktander against it on this preset: $c = p_k$ sits remarkably near $c^*$ across realistic values. The old instinct was a near-theorem. Drag the dot and watch how FLAT the valley is near its bottom: being roughly right here is cheap, being dogmatic at either end is not.',
      preset: 'example1',
    },
    {
      title: 'What t actually is',
      text: 'The optimal $c^*$ depends on one unfamiliar quantity, $t$, and Mack’s second gift is showing it is built from three variances an actuary can actually defend in a meeting: how much true ultimates vary across years (is this a stable line or a lottery?), how good the prior estimate is (how was 90% of premium derived?), and how noisy the payout process is (do losses arrive on schedule or in lumps?). Assess those three: judgment, benchmarks, or data: and $t$ falls out of a formula; no curve-fitting required. Then play with this preset and watch the logic breathe: crank the payout noise and $t$ rises, dragging $c^*$ down: noisy actuals deserve less trust, lean on the prior. Improve the prior and the same happens for the opposite reason. Sharpen the payout process and $t$ falls, $c^*$ climbs, and the ladder earns its keep. The dial is not set by taste. It is set by which of your information sources deserves the trust: measured.',
      preset: 'example2',
    },
    {
      title: 'The regime map',
      text: 'Mack closes with a picture worth more than the algebra: the regime map on the right, straight from his Figure 1. Its axes are the two things you now understand: maturity $p_k$ across, the trust parameter $t$ up: and it is carved into three territories by two curves. Above $t = 2 - p_k$: noisy data or a young year: even plain BF beats chain ladder outright. Below $t = \\tfrac{p_k q_k}{1+p_k}$ (a sliver that never rises above one-sixth): chain ladder wins. And the entire broad middle belongs to Benktander’s blend. Drag your position around the map and watch the verdict chip update; drag the $t$ slider and feel yourself cross borders. Two lessons to carry out the door: the chain-ladder-wins region is startlingly small for how universally the method is used: and the borders are exact, so "which method should I use?" has stopped being a matter of taste and become a location on a map you can point to.',
      preset: 'example1',
    },
  ],
  checks: [
    { name: 'Base point: R_BF = 45%', expect: 0.45, tol: 1e-12, got: () => clMackReserves({ p: 0.5, U0: 0.9, Ck: 0.55 }, 0).Rbf },
    { name: 'Base point: R_CL = 55%', expect: 0.55, tol: 1e-12, got: () => clMackReserves({ p: 0.5, U0: 0.9, Ck: 0.55 }, 0).Rcl },
    { name: 'Base point: R_GB = 50%', expect: 0.50, tol: 1e-12, got: () => clMackReserves({ p: 0.5, U0: 0.9, Ck: 0.55 }, 0).Rgb },
    { name: 'Base point: U_GB = 105% = 0.75·CL + 0.25·U0', expect: 1.05, tol: 1e-12, got: () => { const r = clMackReserves({ p: 0.5, U0: 0.9, Ck: 0.55 }, 0); return 0.55 + r.Rgb; } },
    { name: 'Example 1: t', expect: 0.346, tol: 5e-4, got: () => clMackT(MACK_EXAMPLE1).t },
    { name: 'Example 1: c*', expect: 0.591, tol: 5e-4, got: () => clMackCStar(0.5, clMackT(MACK_EXAMPLE1).t) },
    { name: 'Example 1: se(R_BF) = 21.3%', expect: 0.213, tol: 5e-4, got: () => { const k = clMackT(MACK_EXAMPLE1); return Math.sqrt(clMackMse(0, { p: 0.5, t: k.t, Ea2: k.Ea2 })); } },
    { name: 'Example 1: se(R_CL) = 19.3%', expect: 0.193, tol: 5e-4, got: () => { const k = clMackT(MACK_EXAMPLE1); return Math.sqrt(clMackMse(1, { p: 0.5, t: k.t, Ea2: k.Ea2 })); } },
    { name: 'Example 1: se(R_GB) = 17.3%', expect: 0.173, tol: 5e-4, got: () => { const k = clMackT(MACK_EXAMPLE1); return Math.sqrt(clMackMse(0.5, { p: 0.5, t: k.t, Ea2: k.Ea2 })); } },
    { name: 'Example 1: se(R_c*) = 17.2%', expect: 0.172, tol: 5e-4, got: () => { const k = clMackT(MACK_EXAMPLE1); const cs = clMackCStar(0.5, k.t); return Math.sqrt(clMackMse(cs, { p: 0.5, t: k.t, Ea2: k.Ea2 })); } },
    { name: 'Example 2: t', expect: 0.309, tol: 5e-4, got: () => clMackT(MACK_EXAMPLE2).t },
    { name: 'Example 2: c*', expect: 0.618, tol: 5e-4, got: () => clMackCStar(0.5, clMackT(MACK_EXAMPLE2).t) },
    { name: 'Example 2: se(R_BF) = 6.2%', expect: 0.062, tol: 5e-4, got: () => { const k = clMackT(MACK_EXAMPLE2); return Math.sqrt(clMackMse(0, { p: 0.5, t: k.t, Ea2: k.Ea2 })); } },
    { name: 'Example 2: se(R_GB) = 4.9%', expect: 0.049, tol: 5e-4, got: () => { const k = clMackT(MACK_EXAMPLE2); return Math.sqrt(clMackMse(0.5, { p: 0.5, t: k.t, Ea2: k.Ea2 })); } },
    { name: 'Regime: BF wins iff t >= 2 - p', expect: 1, tol: 0, got: () => (clMackRegime(0.5, 1.51) === 'BF' && clMackRegime(0.5, 1.49) === 'GB') ? 1 : 0 },
    { name: 'Regime: CL wins iff t <= pq/(1+p)', expect: 1, tol: 0, got: () => (clMackRegime(0.5, 0.166) === 'CL' && clMackRegime(0.5, 0.168) === 'GB') ? 1 : 0 },
    { name: 'Gogol corrected: z = 0.782', expect: 0.782, tol: 5e-4, got: () => clGogolPosterior({ EU: 0.9, sdU: 0.35, beta2: 0.04, p: 0.5, Ck: 0.55 }).z },
    { name: 'Gogol corrected: E(R|C_k) = 51.9%', expect: 0.519, tol: 5e-4, got: () => clGogolPosterior({ EU: 0.9, sdU: 0.35, beta2: 0.04, p: 0.5, Ck: 0.55 }).ERC },
    { name: 'Gogol corrected: sd(R|C_k) = 18.9%', expect: 0.189, tol: 5e-4, got: () => clGogolPosterior({ EU: 0.9, sdU: 0.35, beta2: 0.04, p: 0.5, Ck: 0.55 }).sdRC },
  ],
});

// --- Module: Prior to Posterior (Gogol / Brosius Bayesian) -----------------

defineModule({
  id: 'prior-posterior',
  title: 'Prior To Posterior',
  subtitle: 'How data moves belief: the exact Bayesian models behind credibility',
  icon: 'scale',
  level: 'bayes',
  kind: 'concept',
  ord: 1,
  foundations: [
    { module: 'distribution-anatomy', text: 'Priors and posteriors are ordinary distributions; reading their densities and quantiles starts here.' },
    { module: 'likelihood-surface', text: 'The curve that multiplies the prior is the likelihood, the same object MLE maximizes.' },
  ],
  bridges: [
    { module: 'brosius-line', text: 'Brosius’ credibility formula is a posterior mean in disguise.' },
    { module: 'meyers-arc', text: 'Every Meyers reserve distribution is a posterior; his models differ in what the prior lets move.' },
  ],
  paper: {
    label: 'Mack (2000) §5, Gogol (1993) model',
    section: 'Exact Bayesian reserves with the Correction Note figures; pp. 341-344',
    task: 'Explain how prior variance and process noise set the credibility weight',
  },
  intro:
    'Every credibility formula is a compressed Bayesian update. Here is the ' +
    'uncompressed version: a prior over the true ultimate, a likelihood from ' +
    'what has been paid, and the posterior compromise between them. The ' +
    'credibility weight z is not a choice. It falls out of two variances.',
  params: [
    { key: 'EU', tex: 'E[U]', label: 'Prior Mean Ultimate', min: 0.4, max: 1.6, step: 0.01, init: 0.90, fmt: 'pct', link: 'prior' },
    { key: 'sdU', tex: '\\sqrt{Var(U)}', label: 'Prior Uncertainty', min: 0.05, max: 0.6, step: 0.005, init: 0.35, fmt: 'pct', link: 'prior' },
    { key: 'beta', tex: '\\beta', label: 'Payout Noise', min: 0.02, max: 0.5, step: 0.005, init: 0.20, fmt: 'pct', link: 'lik' },
    { key: 'p', tex: 'p_k', label: 'Expected % Paid', min: 0.05, max: 0.95, step: 0.01, init: 0.5, fmt: 'pct', link: 'lik' },
    { key: 'Ck', tex: 'C_k', label: 'Paid To Date (% Of Premium)', min: 0.05, max: 1.2, step: 0.01, init: 0.55, fmt: 'pct', link: 'lik' },
  ],
  derived(par, st) {
    const dist = st?.mode === 'normal' ? 'normal' : 'lognormal';
    const kit = dist === 'normal'
      ? clNormalConjugate(par)
      : clGogolPosterior({ EU: par.EU, sdU: par.sdU, beta2: par.beta * par.beta, p: par.p, Ck: par.Ck });
    return {
      dist,
      z: kit.z,
      EUC: kit.EUC,
      ERC: kit.ERC,
      sdRC: kit.sdRC,
      Ucl: par.Ck / par.p,
      mu1: kit.mu1,
      sigma12: kit.sigma12,
    };
  },
  readouts: [
    { sym: 'z', id: 'z', fmt: 'num3', label: 'Credibility Of The Data', link: 'post' },
    { sym: 'E[U|C_k]', id: 'EUC', fmt: 'pct', label: 'Posterior Ultimate', accent: true, link: 'post' },
    { sym: 'E[R|C_k]', id: 'ERC', fmt: 'pct', label: 'Posterior Reserve', accent: true, link: 'post' },
    { sym: 'sd(R|C_k)', id: 'sdRC', fmt: 'pct', label: 'Posterior Sd', link: 'post' },
    { sym: 'C_k/p_k', id: 'Ucl', fmt: 'pct', label: 'What The Data Says', link: 'lik' },
    { sym: 'E[U]', id: 'EU', fmt: 'pct', label: 'What The Prior Says', link: 'prior' },
  ],
  formula(state) {
    if (state.mode === 'normal') {
      return {
        sym: 'E[U|C_k] = z\\,\\tfrac{C_k}{p_k} + (1{-}z)\\,E[U]',
        terms: [
          { sym: 'E[U|C_k]', fmt: 'pct', get: (d) => d.EUC, primary: true, link: 'post' },
          { op: '=' },
          { sym: 'z', fmt: 'num3', get: (d) => d.z, link: 'post' },
          { op: '·' },
          { sym: 'C_k/p_k', fmt: 'pct', get: (d) => d.Ucl, link: 'lik' },
          { op: '+' },
          { sym: '(1{-}z)', fmt: 'num3', get: (d) => 1 - d.z, link: 'prior' },
          { op: '·' },
          { sym: 'E[U]', fmt: 'pct', get: (d) => d.EU, link: 'prior' },
        ],
      };
    }
    return {
      sym: '\\mu_1 = z\\left(\\tfrac{\\tau^2}{2} + \\ln\\tfrac{C_k}{p_k}\\right) + (1{-}z)\\mu,\\quad E[U|C_k] = e^{\\mu_1 + \\sigma_1^2/2}',
      terms: [
        { sym: 'E[R|C_k]', fmt: 'pct', get: (d) => d.ERC, primary: true, link: 'post' },
        { op: '=' },
        { sym: 'E[U|C_k]', fmt: 'pct', get: (d) => d.EUC, link: 'post' },
        { op: '−' },
        { sym: 'C_k', fmt: 'pct', get: (d) => d.Ck, link: 'lik' },
        { op: '|' },
        { sym: 'z', fmt: 'num3', get: (d) => d.z, link: 'post' },
        { op: '|' },
        { sym: 'sd(R|C_k)', fmt: 'pct', get: (d) => d.sdRC, link: 'post' },
      ],
    };
  },
  presets: [
    {
      id: 'gogol',
      label: 'Gogol, Corrected',
      note: 'The exact lognormal Bayesian model on Example 1, with the Correction Note applied: mu_1 uses tau^2/2, giving E[R|C_k] = 51.9% and sd 18.9%. The published tau^2 version is the trap.',
      mode: 'lognormal',
      params: { EU: { value: 0.90 }, sdU: { value: 0.35 }, beta: { value: 0.20 }, p: { value: 0.5 }, Ck: { value: 0.55 } },
    },
    {
      id: 'normal',
      label: 'Normal Conjugate',
      note: 'Same variances, normal world: the posterior is symmetric and lands at 50.8% instead of 51.9%. The lognormal skew is worth a full point of reserve.',
      mode: 'normal',
      params: { EU: { value: 0.90 }, sdU: { value: 0.35 }, beta: { value: 0.20 }, p: { value: 0.5 }, Ck: { value: 0.55 } },
    },
    {
      id: 'tight-prior',
      label: 'Confident Prior',
      note: 'Shrink prior uncertainty to 10% and z collapses toward zero: the posterior barely moves off the prior no matter what the triangle says.',
      mode: 'lognormal',
      params: { EU: { value: 0.90 }, sdU: { value: 0.10 }, beta: { value: 0.20 }, p: { value: 0.5 }, Ck: { value: 0.55 } },
    },
    {
      id: 'noisy-data',
      label: 'Noisy Data',
      note: 'Double the payout noise instead and the likelihood flattens: the data loses its vote and z falls the same way.',
      mode: 'lognormal',
      params: { EU: { value: 0.90 }, sdU: { value: 0.35 }, beta: { value: 0.40 }, p: { value: 0.5 }, Ck: { value: 0.55 } },
    },
  ],
  story: [
    {
      title: 'Belief, evidence, compromise',
      text: 'You guessed pizza night would cost about twenty dollars. The smudged receipt looks like twenty-six. You settle near twenty-four: closer to the receipt, because your guess was vague and the receipt, though blurry, is evidence. That is all of Bayes: a **prior** (what you believed), a **likelihood** (what the evidence says), a **posterior** (the compromise). The only math is HOW FAR to move, and variances decide it. Here the unknown is a year’s **ultimate** $U$: what it will finally cost once every claim settles, measured as a percent of premium.',
      preset: 'normal',
    },
    {
      title: 'Belief before data',
      text: 'Now do the pizza move with an accident year. Before any losses arrive, you already believe something about the year’s ultimate $U$: the pricing work said it should cost about 90% of premium. But notice how the belief is drawn on stage: not as a number, as a whole CURVE: the **prior** distribution. Its center is your best prior guess $E[U]$, and its spread $\\sqrt{Var(U)}$ is an honest confession of how little the premium calculation really knows: drag the Prior Uncertainty slider and watch the confession widen. This is the move that makes Bayes different from everything in Level 4: there, unknown quantities were fixed truths to be estimated; here, YOUR OWN UNCERTAINTY about the truth gets a distribution of its own. Once belief is a curve, evidence can reshape it: which is the next step.',
      preset: 'normal',
    },
    {
      title: 'The data votes',
      text: 'Enter the evidence: the year has paid $C_k$ so far, at a stage where about $p_k$ of losses are typically paid. The naive read is chain ladder: if half should be paid and 55% of premium is already out the door, the data "points at" an ultimate of $C_k/p_k = 110\\%$. But payment timing is noisy ($\\beta$ is that noise), so the data does not point: it VOTES, with a whole curve of its own: the **likelihood**, the same object you built in Maximum Likelihood Estimation, drawn here as the second density. Its center is what the data suggests; its width is how loudly. Drag $\\beta$ down and watch the likelihood sharpen into a confident spike; drag it up and watch the data mumble. Keep one distinction straight and Bayes stays easy forever: the prior is what you believed BEFORE, the likelihood is what the evidence says NOW, and neither one alone is the answer.',
      preset: 'noisy-data',
    },
    {
      title: 'Commit to a guess',
      text: 'Two curves now claim the truth: the vague prior and the noisy likelihood. Bayes must decide how far to move from one toward the other, and it decides by comparing their spreads. Commit to the direction first.',
      predict: {
        prompt: 'Halve the payout noise β. What happens to the credibility z?',
        options: ['Rises: cleaner data earns more weight', 'Falls: the prior digs in', 'Unchanged: z is fixed by the prior alone'],
        answer: 0,
        explain: 'z is a RATIO of uncertainties: roughly, prior variance over prior-plus-data variance: the same shape as every credibility formula you will ever meet. Halve β and the likelihood sharpens, so the evidence out-argues the belief and z rises: watch the posterior slide toward what the triangle says as you drag. Then run the mirror experiment: tighten the PRIOR instead (drop its uncertainty to 10%) and z collapses, because a confident belief takes more evidence to move. The satisfying part: once the two spreads are honestly assessed, there is no judgment call left. The weighting is arithmetic, not diplomacy.',
      },
      preset: 'gogol',
    },
    {
      title: 'The compromise, exactly',
      text: 'Multiply the two curves point by point: where BOTH the prior and the likelihood assign decent probability: and rescale so the area is one. The result is the third density on stage: the **posterior**, your updated belief. This preset is the exam’s worked case, Gogol’s lognormal model, and the numbers on screen are the paper’s own (with its Correction Note applied: the published version contains a famous error the exam loves): posterior reserve $E[R|C_k] = 51.9\\%$ of premium, spread 18.9%, credibility $z = 0.782$. Read the picture before the numbers: the posterior sits between prior and likelihood, closer to the data because the data spoke more sharply, and NARROWER than either: two imperfect sources of information genuinely know more together. One more thing worth savoring: Benktander’s simple pencil-and-paper blend, from a paper written decades earlier, lands within a whisker of this exact Bayesian answer. Good heuristics are usually theorems in disguise.',
      preset: 'gogol',
    },
    {
      title: 'Who wins, and why',
      text: 'Finish with the two limiting worlds, because they are both real jobs. Apply this preset: a CONFIDENT prior (uncertainty squeezed to 10%). The posterior barely moves off the prior no matter what the triangle says: $z$ collapses toward zero, and the data is politely ignored. That is not a malfunction: for a stable, well-priced line, it is correct behavior. Now flip to the noisy-data preset and watch the opposite: vague evidence, same story in mirror image. Between the two extremes lies every credibility method on this exam, and you can now name the machinery under all of them: Brosius’ Z, Benktander’s blend, Bühlmann’s $n/(n+k)$: each is a posterior mean wearing work clothes, each is a ratio of variances deciding who gets believed. When a paper says "credibility weighted", hear "Bayesian compromise, with the variances assessed instead of modeled". That translation is worth points, and better, it is true.',
      preset: 'tight-prior',
    },
  ],
  checks: [
    { name: 'Gogol path: z = 0.782', expect: 0.782, tol: 5e-4, got: () => clGogolPosterior({ EU: 0.9, sdU: 0.35, beta2: 0.04, p: 0.5, Ck: 0.55 }).z },
    { name: 'Gogol path: E(U|C_k) = 106.9%', expect: 1.069, tol: 1e-3, got: () => clGogolPosterior({ EU: 0.9, sdU: 0.35, beta2: 0.04, p: 0.5, Ck: 0.55 }).EUC },
    { name: 'Normal conjugate: z = 0.791', expect: 0.7908, tol: 1e-3, got: () => clNormalConjugate({ EU: 0.9, sdU: 0.35, beta: 0.2, p: 0.5, Ck: 0.55 }).z },
    { name: 'Normal conjugate: E(R|C_k) = 50.8%', expect: 0.5082, tol: 1e-3, got: () => clNormalConjugate({ EU: 0.9, sdU: 0.35, beta: 0.2, p: 0.5, Ck: 0.55 }).ERC },
    { name: 'Normal conjugate: sd(U|C_k) = 16.0%', expect: 0.1601, tol: 1e-3, got: () => clNormalConjugate({ EU: 0.9, sdU: 0.35, beta: 0.2, p: 0.5, Ck: 0.55 }).sdRC },
    {
      name: 'Posterior sits between prior and CL, both families', expect: 1, tol: 0,
      got: () => {
        const n = clNormalConjugate({ EU: 0.9, sdU: 0.35, beta: 0.2, p: 0.5, Ck: 0.55 });
        const g = clGogolPosterior({ EU: 0.9, sdU: 0.35, beta2: 0.04, p: 0.5, Ck: 0.55 });
        const between = (v) => v > 0.9 && v < 1.1;
        return between(n.EUC) && between(g.EUC) ? 1 : 0;
      },
    },
    {
      name: 'Tight prior pulls z down', expect: 1, tol: 0,
      got: () => {
        const wide = clGogolPosterior({ EU: 0.9, sdU: 0.35, beta2: 0.04, p: 0.5, Ck: 0.55 }).z;
        const tight = clGogolPosterior({ EU: 0.9, sdU: 0.10, beta2: 0.04, p: 0.5, Ck: 0.55 }).z;
        return tight < 0.35 && wide > 0.7 ? 1 : 0;
      },
    },
  ],
});

// --- Module: The Distribution Zoo (exam edition) ---------------------------

defineModule({
  id: 'dist-zoo',
  title: 'Loss Distributions',
  subtitle: 'Exam edition: the shapes the papers assume but never draw',
  icon: 'spline',
  level: 'probability',
  kind: 'concept',
  ord: 4,
  foundations: [
    { module: 'distribution-anatomy', text: 'Each animal in the zoo is one distribution; the three-view anatomy applies to all of them.' },
    { module: 'mean-machine', text: 'Mean, variance, and skew are the axes the zoo is organized along.' },
  ],
  bridges: [
    { module: 'odp-bootstrap', text: 'The over-dispersed Poisson here is the exact error family Shapland’s bootstrap resamples.' },
    { module: 'validation-machine', text: 'Meyers scores outcomes against lognormal predictive distributions like these.' },
  ],
  paper: {
    label: 'Mack (1994) ranges · Shapland ODP · Verrall NB',
    section: 'Lognormal CI moment matching; ODP Var = phi*mu; NB chain ladder',
    task: 'Choose and defend distributional assumptions for reserve ranges',
  },
  intro:
    'The syllabus keeps asserting distributions it never shows you. What does ' +
    'an over-dispersed Poisson even look like? Why does a lognormal range have ' +
    'a fatter upper tail than a normal one with the same mean and variance? ' +
    'Look at them.',
  params: [
    { key: 'mean', tex: '\\mu', label: 'Mean', min: 20, max: 200, step: 1, init: 100, fmt: 'num', link: 'primary' },
    { key: 'sd', tex: '\\sigma', label: 'Sd', min: 5, max: 80, step: 1, init: 35, fmt: 'num', link: 'primary', modes: ['normal-logn'] },
    { key: 'phi', tex: '\\phi', label: 'Dispersion', min: 1, max: 20, step: 0.5, init: 8, fmt: 'num2', modes: ['odp'], link: 'primary' },
    { key: 'shape', tex: 'k', label: 'Shape', min: 0.6, max: 16, step: 0.1, init: 4, fmt: 'num2', modes: ['gamma'], link: 'primary' },
    { key: 'r', tex: 'r', label: 'NB Size r', min: 1, max: 40, step: 1, init: 5, fmt: 'num', modes: ['negbin'], link: 'primary' },
  ],
  derived(par, st) {
    const mode = st?.mode || 'normal-logn';
    const out = { mode, mean: par.mean };
    if (mode === 'normal-logn') {
      const { mu, sigma } = clMatchLognormal(par.mean, par.sd);
      out.sd = par.sd;
      out.n95 = par.mean + 1.6448536 * par.sd;
      out.ln95 = clLognInv(0.95, mu, sigma);
      out.lnMu = mu; out.lnSigma = sigma;
      out.varRatio = 1;
    } else if (mode === 'odp') {
      out.sd = Math.sqrt(par.phi * par.mean);
      out.varRatio = par.phi;
    } else if (mode === 'gamma') {
      const scale = par.mean / par.shape;
      out.sd = Math.sqrt(par.shape) * scale;
      out.scale = scale;
      out.varRatio = out.sd * out.sd / par.mean;
    } else if (mode === 'negbin') {
      out.sd = Math.sqrt(par.mean * (1 + par.mean / par.r));
      out.varRatio = 1 + par.mean / par.r;
      out.nbP = par.r / (par.r + par.mean);
    }
    return out;
  },
  readouts: [
    { sym: '\\mu', id: 'mean', fmt: 'num', label: 'Mean', link: 'primary' },
    { sym: '\\sigma', id: 'sd', fmt: 'num', label: 'Sd', accent: true, link: 'primary' },
    { sym: '', id: 'varRatio', fmt: 'num2', label: 'Variance-To-Mean', link: 'primary' },
  ],
  formula(state) {
    switch (state.mode) {
      case 'odp':
        return {
          sym: 'X = \\phi N,\\; N \\sim Pois(\\mu/\\phi):\\quad E[X]=\\mu,\\; Var(X)=\\phi\\mu',
          terms: [
            { sym: 'Var(X)', fmt: 'num', get: (d) => d.varRatio * d.mean, primary: true, link: 'primary' },
            { op: '=' },
            { sym: '\\phi', fmt: 'num2', get: (d) => d.varRatio, link: 'primary' },
            { op: '·' },
            { sym: '\\mu', fmt: 'num', get: (d) => d.mean, link: 'primary' },
          ],
        };
      case 'gamma':
        return {
          sym: 'X \\sim Gamma(k, \\theta):\\quad E[X] = k\\theta,\\; Var(X) = k\\theta^2',
          terms: [
            { sym: 'k', fmt: 'num2', get: (d) => d.shape, link: 'primary' },
            { op: '·' },
            { sym: '\\theta', fmt: 'num', get: (d) => d.scale, link: 'primary' },
            { op: '=' },
            { sym: 'E[X]', fmt: 'num', get: (d) => d.mean, primary: true, link: 'primary' },
          ],
        };
      case 'negbin':
        return {
          sym: 'X \\sim NB(r, p):\\quad Var(X) = \\mu\\left(1 + \\tfrac{\\mu}{r}\\right)',
          terms: [
            { sym: 'Var(X)', fmt: 'num', get: (d) => d.varRatio * d.mean, primary: true, link: 'primary' },
            { op: '=' },
            { sym: '\\mu', fmt: 'num', get: (d) => d.mean, link: 'primary' },
            { op: '·' },
            { sym: '1 + \\mu/r', fmt: 'num2', get: (d) => d.varRatio, link: 'primary' },
          ],
        };
      default:
        return {
          sym: '\\sigma_{LN}^2 = \\ln(1 + CV^2),\\quad \\mu_{LN} = \\ln(mean) - \\sigma_{LN}^2/2',
          terms: [
            { sym: 'Normal\\;95th', fmt: 'num', get: (d) => d.n95, link: 'secondary' },
            { op: 'vs' },
            { sym: 'Lognormal\\;95th', fmt: 'num', get: (d) => d.ln95, primary: true, link: 'primary' },
          ],
        };
    }
  },
  presets: [
    {
      id: 'ranges',
      label: 'Normal Vs Lognormal',
      note: 'Same mean, same sd. The lognormal shifts mass right of the peak into a longer upper tail: its 95th percentile sits meaningfully above the normal one. This is why Mack ranges use it.',
      mode: 'normal-logn',
      params: { mean: { value: 100 }, sd: { value: 35 } },
    },
    {
      id: 'odp',
      label: 'Over-Dispersed Poisson',
      note: 'Shapland\'s workhorse: a Poisson stretched onto the phi-lattice. Mean stays put; variance scales by phi. Drag phi to 1 and it collapses to plain Poisson.',
      mode: 'odp',
      params: { mean: { value: 100 }, phi: { value: 8 } },
    },
    {
      id: 'gamma',
      label: 'Gamma',
      note: 'The GLM severity option: right-skewed at low shape, nearly normal at high shape. Variance grows with the square of the mean at fixed shape.',
      mode: 'gamma',
      params: { mean: { value: 100 }, shape: { value: 4 } },
    },
    {
      id: 'negbin',
      label: 'Negative Binomial',
      note: 'Verrall\'s route to the chain ladder: a Poisson whose rate is itself gamma-uncertain. Small r means violent over-dispersion; r to infinity recovers Poisson.',
      mode: 'negbin',
      params: { mean: { value: 100 }, r: { value: 5 } },
    },
  ],
  story: [
    {
      title: 'Shapes of randomness',
      text: 'Different kinds of randomness have different characteristic shapes, and choosing the wrong shape is one of the quietest ways to be wrong in this profession. Human heights cluster symmetrically around a middle: that is the **normal**. Losses pile up small with a long expensive tail: that is the **lognormal** territory you built in the last module. Claim counts arrive in whole numbers: that is the **Poisson** from the Claim Counter. Here is the trap this module exists to spring: two distributions can share the SAME mean and the SAME standard deviation and still disagree wildly about the tail, and in insurance the tail is where the money is. The two curves on stage right now are exactly such a pair. This zoo holds the six shapes the exam actually uses; the goal is that when a paper later says "assume lognormal" or "ODP errors", you see a picture, not a password.',
      preset: 'ranges',
    },
    {
      title: 'Two ranges, one pair of moments',
      text: 'Here is where that trap bites a real method. Mack’s paper (top of the ladder) produces exactly two numbers for a reserve: a mean and a standard error. To quote "the 90th percentile reserve" you must then CHOOSE a shape to wrap around those two numbers, and the data does not choose it for you. Both curves on stage are legitimate choices: same mean, same SD. Watch the two 95th-percentile markers: the lognormal’s sits meaningfully further right, because its long tail spends its probability differently. Neither is "the right answer": Mack’s own advice is to check both and understand why they differ. Drag the sd slider up and watch the disagreement between the markers GROW: the noisier the estimate, the more the shape choice matters, and the more a range quoted without naming its shape is an incomplete sentence.',
      preset: 'ranges',
    },
    {
      title: 'The quasi-distribution',
      text: 'Now meet the exam’s strangest animal: the **over-dispersed Poisson**. A plain Poisson has a rigid rule: its variance always EQUALS its mean, which real claim data almost never obeys. The ODP keeps the Poisson’s whole-number skeleton but scales it: outcomes live on a lattice spaced $\\phi$ apart, so the variance becomes $\\phi\\mu$: mean times a dispersion dial you control. Drag $\\phi$ and watch the lattice spread apart while the shape stays Poisson-like. Be clear about what this object is: not a distribution you will find in a textbook table, but a variance ASSUMPTION (variance proportional to mean) wearing a Poisson costume: which is exactly why the papers call it "quasi-likelihood". Shapland’s bootstrap builds its entire world out of this animal, and having SEEN the lattice, the phrase "ODP with φ = 52,601" stops being a mystery.',
      preset: 'odp',
    },
    {
      title: 'Skew you can dial',
      text: 'The **gamma** family is a lesson in how flexible one shape can be. Slide its shape parameter $k$ and watch the personality change: at $k = 1$ it is the exponential, all crowded against zero with a long slide right; by $k = 16$ it has gathered itself into a nearly symmetric hill. One family, a whole spectrum of skew. Why does the exam care? Because the gamma’s deeper signature is not its outline but its variance habit: a gamma’s spread grows with the SQUARE of its mean, meaning its uncertainty is constant in PERCENT terms: big cells and small cells equally uncertain relative to their size. When you reach Generalized Linear Models one level up, choosing an "error family" will turn out to mean exactly this: choosing how variance scales with the mean. The zoo is where each choice’s face becomes familiar.',
      preset: 'gamma',
    },
    {
      title: 'Poisson with doubt',
      text: 'One last animal, built by combining two others: a preview of Bayesian thinking three levels early. A Poisson counter assumes you KNOW the rate λ. But suppose you are honestly unsure of the rate itself: your book might be a λ = 3 book or a λ = 5 book. Let the rate be random too (give it a gamma shape) and ask what the claim counts look like from outside, averaging over your doubt. The answer is the **negative binomial**: Poisson-like, but wider, because it carries two uncertainties at once: the year’s luck AND your ignorance of the rate. Compare it against the plain Poisson on stage: same mean, visibly fatter shoulders. This move (put a distribution on a parameter, then average it out) is the entire mechanism of Prior To Posterior, met here in its simplest costume.',
      preset: 'negbin',
    },
  ],
  checks: [
    { name: 'Normal 95th at (100, 35)', expect: 157.57, tol: 0.05, got: () => 100 + 1.6448536 * 35 },
    {
      name: 'Lognormal 95th at (100, 35) shows the skew', expect: 165.2, tol: 0.5,
      got: () => { const { mu, sigma } = clMatchLognormal(100, 35); return clLognInv(0.95, mu, sigma); },
    },
    {
      name: 'Lognormal median < mean (mass shifted left of the tail)', expect: 1, tol: 0,
      got: () => { const { mu, sigma } = clMatchLognormal(100, 35); return clLognInv(0.5, mu, sigma) < 100 ? 1 : 0; },
    },
    { name: 'ODP sd at (100, 8)', expect: Math.sqrt(800), tol: 1e-9, got: () => Math.sqrt(8 * 100) },
    {
      name: 'NB variance = mu(1+mu/r) via pmf', expect: 2100, tol: 2,
      got: () => {
        const r = 5, mean = 100, p = r / (r + mean);
        let m = 0, m2 = 0;
        for (let k = 0; k < 3000; k++) { const w = clNbPmf(k, r, p); m += k * w; m2 += k * k * w; }
        return m2 - m * m;
      },
    },
    {
      name: 'Gamma sd from shape/scale', expect: 50, tol: 1e-9,
      got: () => { const shape = 4, scale = 100 / 4; return Math.sqrt(shape) * scale; },
    },
  ],
});

// --- Module: The Validation Machine (Meyers Monograph 8, §3) ---------------

// Fixed teaching seed, chosen so the default sample behaves like Meyers'
// printed Figure 3.1 catalogue: the correct model comfortably validates
// (D = 9.0 vs band 13.6) and the three defects fail in the paper's order
// (biased 28.6 > light 16.9 > heavy 16.5). A correct model DOES fail the
// 95% band one time in twenty — the story text owns that honestly.
const VAL_SEED = 42;

defineModule({
  id: 'validation-machine',
  title: 'Meyers: Model Validation',
  subtitle: 'p-p plots, the KS band, and how Meyers retires bad models',
  icon: 'badge-check',
  level: 'reserving',
  kind: 'exam',
  ord: 3,
  foundations: [
    { module: 'distribution-anatomy', text: 'A percentile is the CDF read at the outcome; uniform percentiles are what honesty looks like.' },
    { module: 'sampling-error', text: 'A model can be biased, too narrow, or too wide; this machine diagnoses which.' },
  ],
  paper: {
    label: 'Meyers, Monograph 8 (2nd ed.), §3',
    section: 'Uniformity of percentiles, Figure 3.1 shape catalogue, KS band 136/√n; pp. 6-11',
    task: 'Test a stochastic reserve model retrospectively and read the failure shape',
  },
  intro:
    'A stochastic model does not just predict a number, it predicts a whole ' +
    'distribution. So test it like one: record the percentile of each actual ' +
    'outcome within its predicted distribution. If the model is right, those ' +
    'percentiles are uniform. Every bow away from the diagonal is a specific ' +
    'diagnosis.',
  params: [
    { key: 'n', tex: 'n', label: 'Outcomes Tested', min: 25, max: 400, step: 25, init: 100, fmt: 'num', link: 'band' },
    { key: 'bias', tex: '\\Delta\\mu', label: 'Model Bias (Sd Units)', min: -0.6, max: 0.6, step: 0.01, init: 0, fmt: 'num2', link: 'model' },
    { key: 'tail', tex: '\\sigma_{model}/\\sigma_{true}', label: 'Model Sd Vs Truth', min: 0.4, max: 2.2, step: 0.01, init: 1, fmt: 'num2', link: 'model' },
  ],
  derived(par) {
    const run = clValidationRun({ n: par.n, bias: par.bias, tail: par.tail, seed: VAL_SEED });
    const band = clKsBand(par.n);
    return {
      D: run.D,
      band,
      passes: run.D <= band,
      percentiles: run.percentiles,
    };
  },
  readouts: [
    { sym: 'D', id: 'D', fmt: 'num2', label: 'KS Statistic', accent: true, link: 'pp' },
    { sym: '', id: 'band', fmt: 'num2', label: 'Critical Value 136/√n', link: 'band' },
    {
      sym: '', id: 'passes', fmt: 'str', label: 'Verdict', link: 'pp',
      get: (d) => (d.passes ? 'Validates' : 'Rejected'),
    },
  ],
  formula() {
    return {
      sym: 'P_i = F_{model}(x_i)\\cdot 100,\\quad D = \\max|F_{emp} - F_{unif}|,\\quad crit = 136/\\sqrt{n}',
      terms: [
        { sym: 'D', fmt: 'num2', get: (d) => d.D, primary: true, link: 'pp' },
        { op: 'vs' },
        { sym: '136/\\sqrt{n}', fmt: 'num2', get: (d) => d.band, link: 'band' },
        { op: '|' },
        { sym: 'n', fmt: 'num', get: (d) => d.n, link: 'band' },
      ],
    };
  },
  presets: [
    {
      id: 'uniform',
      label: 'Correct Model',
      note: 'The model matches the world: percentiles scatter uniformly, the p-p points hug the diagonal, and D sits far inside the band. Meyers\' simulated version printed D = 5.2.',
      params: { n: { value: 100 }, bias: { value: 0 }, tail: { value: 1 } },
    },
    {
      id: 'light',
      label: 'Light-Tailed Model',
      note: 'The model\'s distribution is too narrow: reality keeps landing in its extreme percentiles, the histogram piles up at both ends, and the p-p plot cuts a slanted S. Meyers printed D = 22.3, a failure. This is what killed the Mack and ODP models.',
      params: { n: { value: 100 }, bias: { value: 0 }, tail: { value: 0.6 } },
    },
    {
      id: 'heavy',
      label: 'Heavy-Tailed Model',
      note: 'Too wide instead: outcomes crowd the middle percentiles and the p-p plot bends the other way. Meyers printed D = 17.2, also a failure.',
      params: { n: { value: 100 }, bias: { value: 0 }, tail: { value: 1.8 } },
    },
    {
      id: 'biased',
      label: 'Biased-High Model',
      note: 'The model systematically over-predicts, so actual outcomes keep landing in its LOW percentiles: the whole histogram slides left and the p-p plot bows hard off the diagonal. Meyers printed D = 39.2, the worst failure in the catalogue.',
      params: { n: { value: 100 }, bias: { value: 0.55 }, tail: { value: 1 } },
    },
  ],
  story: [
    {
      title: 'The question first',
      text: 'A model hands you a whole distribution, not a number. How do you check a DISTRIBUTION against reality? With Level 1’s percentile read, run backward: score where each real outcome lands on the model’s own CDF. If the model is honest, those landing spots spread out evenly, like raindrops on a sidewalk. Any pattern in them is a confession: and each KIND of pattern confesses a different crime. This module builds the courtroom: the p-p plot, the KS band, and the field guide of failure shapes: that Meyers then uses, one module over, to put the industry’s standard methods on trial.',
      preset: 'uniform',
    },
    {
      title: 'Score the whole distribution',
      text: 'Watch the machine run on an honest model first, so you know what innocence looks like. For each of $n$ insurers, the model published a predictive distribution before the outcome arrived; when reality landed, we evaluate the model’s own CDF at the actual outcome and record its percentile: the backward read from PDF, CDF & Quantiles. The samples reveal one by one on the left; each becomes a dot on the right. Think about why uniformity is the signature of truth: a correct model’s 30th percentile is, BY ITS OWN DEFINITION, the level reality undercuts 30% of the time: so outcomes must land below it 30% of the time, and in general spread evenly across all percentiles. The model is graded on its own promises. A correct model has no OPINION about where outcomes land in its distribution: that is what having the right distribution means. Any opinion the dots express: any clustering, any lean: is evidence against the model that issued them.',
      preset: 'uniform',
    },
    {
      title: 'The shapes of being wrong',
      text: 'Now break the model on purpose, one defect at a time, and learn each defect’s fingerprint: this is Meyers’ Figure 3.1 turned into a field guide you can operate. This preset makes the model LIGHT-TAILED: its claimed distribution is too narrow for reality. Watch where the percentiles land: piled at 0 and 100, because outcomes keep escaping tails the model swore were nearly impossible; on the p-p plot the dots trace an S through the diagonal. Now try the heavy preset: too WIDE a claim crowds outcomes into the middle percentiles (nothing ever reaches the tails the model wastes probability on), and the S bends the other way. Then the biased preset: everything slides to one side, a shape no width adjustment can produce. Three defects, three unmistakable signatures. Drill them here until reading a p-p plot feels like reading a face: Meyers’ entire monograph, and one whole module upstairs, consists of applying exactly this diagnostic vocabulary to the industry’s standard models.',
      preset: 'light',
    },
    {
      title: 'The bar every model must clear',
      text: 'Even a perfectly honest model produces lumpy percentiles from a finite sample: raindrops do not fall in a perfect grid: so a verdict needs a tolerance, or every model would fail on noise. The Kolmogorov-Smirnov test supplies it: measure $D$, the worst gap between the dots’ running distribution and the perfect diagonal, and compare it to the band $136/\\sqrt{n}$: the wiggle room an honest model deserves at this sample size, wide (19.2) at $n = 50$, tight (9.6) at $n = 200$. Inside the band: the lumps are consistent with luck. Outside: the model’s own percentiles testify against it at the 95% level. Watch the verdict chip as the reveal completes, then note the number that made this famous: across the CAS database, Mack on incurred data scored $D = 15.4$ combined: outside its band: and one of the industry’s default methods stood formally rejected by 200 triangles’ worth of its own predictions.',
      preset: 'biased',
    },
    {
      title: 'Why n matters',
      text: 'One slider is doing quiet philosophical work here: $n$. Set a mild defect with this preset, then walk $n$ upward and watch two things converge on the truth from opposite sides: the picture sharpens (the dots’ pattern stops looking like luck and starts looking like structure) while the band tightens like $1/\\sqrt{n}$ (the tolerance an honest model deserves shrinks). A defect invisible at $n = 50$ is flagrant at $n = 400$. Read the institutional meaning: validation is a SAMPLE SIZE game. One insurer’s handful of triangles can never convict or acquit a method: the lumps of luck are bigger than the defects being hunted: which is exactly why Meyers needed the CAS database of 200 triangles with settled outcomes, and why his verdicts carried weight no single company’s back-test ever could. When someone shows you a validation on eight data points, you now know precisely how much it proves.',
      preset: 'heavy',
    },
  ],
  checks: [
    { name: 'KS band at n=50 is 19.2', expect: 19.2, tol: 0.05, got: () => clKsBand(50) },
    { name: 'KS band at n=200 is 9.6', expect: 9.6, tol: 0.05, got: () => clKsBand(200) },
    {
      name: 'Correct model validates (seeded)', expect: 1, tol: 0,
      got: () => (clValidationRun({ n: 100, bias: 0, tail: 1, seed: VAL_SEED }).D <= clKsBand(100) ? 1 : 0),
    },
    {
      name: 'Light-tailed model is rejected (seeded)', expect: 1, tol: 0,
      got: () => (clValidationRun({ n: 100, bias: 0, tail: 0.6, seed: VAL_SEED }).D > clKsBand(100) ? 1 : 0),
    },
    {
      name: 'Heavy-tailed model is rejected (seeded)', expect: 1, tol: 0,
      got: () => (clValidationRun({ n: 100, bias: 0, tail: 1.8, seed: VAL_SEED }).D > clKsBand(100) ? 1 : 0),
    },
    {
      name: 'Biased-high model is rejected hardest (seeded)', expect: 1, tol: 0,
      got: () => {
        const dBias = clValidationRun({ n: 100, bias: 0.55, tail: 1, seed: VAL_SEED }).D;
        const dOk = clValidationRun({ n: 100, bias: 0, tail: 1, seed: VAL_SEED }).D;
        return dBias > clKsBand(100) && dBias > 2 * dOk ? 1 : 0;
      },
    },
    {
      name: 'Same outcomes repriced: draws independent of the model claim', expect: 1, tol: 0,
      got: () => {
        const a = clValidationDraws(100, VAL_SEED);
        const b = clValidationDraws(100, VAL_SEED);
        return a === b ? 1 : 0;
      },
    },
  ],
});

// --- Module: The Settlement-Rate Story (Meyers §7, CSR) --------------------

// Posterior means from Table 7.1, Group 353 paid data. beta_10 = 0 by
// construction — which is exactly why the CSR ultimate is formally CRC.
const CSR_BETA = [-1.3794, -0.6479, -0.3032, -0.0928, -0.0608, -0.0151, -0.0057, -0.0041, -0.0062, 0.0000];
const CSR_GAMMA = { mean: 0.0446, sd: 0.0282 };
const CSR_LOGELR = { mean: -0.3956, sd: 0.0246 };

/**
 * Expected share of ultimate paid by lag d for accident year w under CSR
 * posterior-mean parameters: exp(beta_d * (1-gamma)^(w-1)), lognormal noise
 * set aside. gamma > 0 shrinks the (negative) early betas for later years,
 * i.e. faster settlement.
 */
function clCsrShare(w, d, gamma) {
  return Math.exp(CSR_BETA[d - 1] * Math.pow(1 - gamma, w - 1));
}

defineModule({
  id: 'csr-story',
  title: 'Meyers: The CSR Model',
  subtitle: 'Why paid-data models failed validation, and how CSR names the culprit',
  icon: 'fast-forward',
  level: 'reserving',
  kind: 'exam',
  ord: 5,
  foundations: [
    { module: 'process-fan', text: 'A payment pattern is a path through time; CSR says the path’s speed itself changed.' },
    { module: 'prior-posterior', text: 'The settlement-rate parameter gets a prior and the data updates it.' },
  ],
  paper: {
    label: 'Meyers, Monograph 8 (2nd ed.), §7',
    section: 'CSR specification, Table 7.1 posterior (gamma = 0.0446 ± 0.0282); pp. 31-36',
    task: 'Explain how a drifting settlement rate biases fixed-pattern methods',
  },
  intro:
    'Chain ladder assumes every accident year pays out on the same curve. ' +
    'The CSR model lets the curve drift: one parameter, gamma, speeds up ' +
    '(or slows down) each successive year\'s settlement. Fit to real data it ' +
    'came back positive, and that single fact explains why Mack and ' +
    'bootstrap ODP kept failing validation on paid losses.',
  params: [
    { key: 'gamma', tex: '\\gamma', label: 'Settlement-Rate Drift', min: -0.10, max: 0.20, step: 0.002, init: 0.0446, fmt: 'num3', link: 'fan' },
    { key: 'dLag', tex: 'd', label: 'Development Lag In Focus', min: 1, max: 9, step: 1, init: 1, fmt: 'num', link: 'bars' },
  ],
  derived(par) {
    const d = Math.round(par.dLag);
    const shares = [];
    for (let w = 1; w <= 10; w++) shares.push(clCsrShare(w, d, par.gamma));
    const sAvg = shares.reduce((a, b) => a + b, 0) / shares.length;
    const s10 = shares[9];
    return {
      dLagInt: d,
      sharesAtLag: shares,
      s10,
      sAvg,
      biasRatio: s10 / sAvg,
      s10Lag1: clCsrShare(10, 1, par.gamma),
      s1Lag1: clCsrShare(1, 1, par.gamma),
      shrink: Math.pow(1 - par.gamma, 9),
    };
  },
  readouts: [
    { sym: '\\gamma', id: 'gamma', fmt: 'num3', label: 'Drift', link: 'fan' },
    { sym: '(1{-}\\gamma)^9', id: 'shrink', fmt: 'num3', label: 'AY-10 Beta Shrink', link: 'fan' },
    { sym: '', id: 's10', fmt: 'pct', label: 'AY-10 Share At Focus Lag', accent: true, link: 'bars' },
    { sym: '', id: 'sAvg', fmt: 'pct', label: 'All-Year Average Share', link: 'bars' },
    {
      sym: '', id: 'biasRatio', fmt: 'str', label: 'Naive Average Pattern Misprices AY-10 By', accent: true, link: 'bars',
      get: (d) => ((d.biasRatio - 1) * 100).toFixed(1) + '%',
    },
  ],
  formula() {
    return {
      sym: '\\mu_{w,d} = \\log(Prem_w) + logelr + \\alpha_w + \\beta_d\\,(1{-}\\gamma)^{w-1}',
      terms: [
        { sym: 'share_{10,d}', fmt: 'pct', get: (d) => d.s10, primary: true, link: 'bars' },
        { op: '=' },
        { sym: 'e^{\\beta_d(1-\\gamma)^9}', fmt: 'pct', get: (d) => d.s10, link: 'fan' },
        { op: '|' },
        { sym: '\\beta_d', fmt: 'num3', get: (d) => CSR_BETA[d.dLagInt - 1], link: 'bars' },
        { op: '|' },
        { sym: '\\gamma', fmt: 'num3', get: (d) => d.gamma, primary: false, link: 'fan' },
      ],
    };
  },
  presets: [
    {
      id: 'crc',
      label: 'Gamma Zero: CRC',
      note: 'At gamma = 0 the fan collapses to a single payment pattern: CSR nests CRC exactly. This is the world chain ladder assumes.',
      params: { gamma: { value: 0 }, dLag: { value: 1 } },
    },
    {
      id: 'posterior',
      label: 'Table 7.1 Posterior Mean',
      note: 'Fit to the Group 353 paid triangle, gamma = 0.0446: the newest year pays 40% in year one where the oldest paid 25%. The betas are the actual posterior means.',
      params: { gamma: { value: 0.0446 }, dLag: { value: 1 } },
    },
    {
      id: 'strong',
      label: 'Strong Speedup',
      note: 'Push gamma to 0.12 and the fan splays: any method that averages one pattern across all years is now pricing the newest year with ancient history.',
      params: { gamma: { value: 0.12 }, dLag: { value: 1 } },
    },
    {
      id: 'slowdown',
      label: 'Slowdown',
      note: 'Gamma below zero runs the story in reverse: settlement decelerating, naive patterns UNDERSTATING the newest year. Same mechanism, opposite sign.',
      params: { gamma: { value: -0.06 }, dLag: { value: 1 } },
    },
  ],
  story: [
    {
      title: 'The question first',
      text: 'Claims have been settling FASTER, year after year. A method that assumes one fixed payout pattern reads that speed as growth and over-reserves. The fix is one honest parameter: let the pattern itself drift. This module walks the machinery of that parameter: how a single dial turns one payout curve into a family of them, what the data said its value was, and the design detail that lets it repair timing without touching the ultimate. The CCL & CSR module shows the validation failure that demanded all this; here you get to hold the repair in your hands.',
      preset: 'crc',
    },
    {
      title: 'One curve or a family',
      text: 'Start from what every fixed-pattern method silently assumes: all accident years share ONE payout curve: the fan on stage collapsed to a single path, which is what this preset shows ($\\gamma = 0$). CSR’s entire innovation is one parameter that relaxes it. The payout shares $\\beta_d$ get scaled by $(1-\\gamma)^{w-1}$, where $w$ counts accident years: so year 1 walks the base curve, year 2 walks it slightly compressed, year 3 more so, each successive year settling a little faster than the one before. Drag $\\gamma$ up from zero and watch one curve become a FAMILY of curves, fanning apart year by year. Read the exponent carefully: the speedup compounds across years but is the same phenomenon throughout: one dial, not ten. That parsimony is deliberate Bayesian craftsmanship: give the data exactly one honest way to express "claims are settling faster", and let the posterior say how much.',
      preset: 'crc',
    },
    {
      title: 'What the data said',
      text: 'A dial is only interesting if the data actually turns it, so here is the verdict from Meyers’ illustrative insurer. The posterior: the updated belief about $\\gamma$ after seeing the triangle, in the Prior To Posterior sense: came out at $0.0446 \\pm 0.0282$. Read that like an actuary: the center says settlement genuinely sped up by about 4.5% per accident year, and the spread says the evidence, while real, is not overwhelming (zero sits about 1.6 standard deviations below the center). The strip under the chart draws this posterior; drag $\\gamma$ across it and watch the payout fan open and close through the band of plausible speeds. This is the Bayesian habit worth internalizing from the whole monograph: the model does not announce "there IS a speedup": it reports how strongly the data pulled the belief away from zero, and carries the remaining doubt forward into the reserve distribution instead of rounding it away.',
      preset: 'posterior',
    },
    {
      title: 'The bias mechanism',
      text: 'Now watch the crime happen: this is the mechanism behind the paid-side bias in the CCL & CSR module, in slow motion. A naive method averages ONE payout pattern across all the years in the triangle and applies it to the newest year. But if settlement has been speeding up, the newest year pays a BIGGER share of its ultimate early than that stale average admits. So when the naive method grosses up the newest year’s early payments: dividing by a share that is too small: it projects an ultimate that is too big. Systematically, every time, in the same direction. The bars on stage show the gap lag by lag: the newest year’s true share (accent) versus the all-years average (gray), with the widest gaps exactly where reserving leans hardest: the early lags of the youngest years. Crank $\\gamma$ with the strong preset and watch the bias grow with the speedup. Faster claims handling: an operational IMPROVEMENT: quietly inflates naive reserves. That irony is the whole reason this model exists.',
      preset: 'strong',
    },
    {
      title: 'Why beta_10 = 0 matters',
      text: 'Finish on the design detail an exam question loves, because it looks technical and is actually elegant. Meyers pins $\\beta_{10} = 0$, and since the shares are scaled as $(1-\\gamma)^{w-1}\\beta_d$, scaling zero gives zero: EVERY year’s cumulative share reaches exactly 100% at lag 10, whatever $\\gamma$ says. Watch the fan on stage confirm it: the curves separate in the middle and reconverge at the right edge, always. The consequence: $\\gamma$ changes the JOURNEY (how fast money goes out) while leaving the DESTINATION (the ultimate’s definition) untouched, which makes the CSR ultimate formally identical to its no-speedup sibling CRC. That is surgical: the model repairs exactly the thing paid-data validation flagged: the timing pattern that biased projections: without redefining what is being reserved for. When you build or grade a model, this is the standard to hold it to: fix the diagnosed failure, and prove you changed nothing else.',
      preset: 'posterior',
    },
  ],
  checks: [
    { name: 'AY-1 lag-1 share = exp(beta_1) = 25.2%', expect: 0.25175, tol: 2e-4, got: () => clCsrShare(1, 1, 0.0446) },
    { name: 'AY-10 lag-1 share at posterior mean = 40.1%', expect: 0.40056, tol: 2e-4, got: () => clCsrShare(10, 1, 0.0446) },
    {
      name: 'Gamma zero collapses the fan (CSR nests CRC)', expect: 0, tol: 1e-12,
      got: () => Math.abs(clCsrShare(1, 1, 0) - clCsrShare(10, 1, 0)),
    },
    {
      name: 'beta_10 = 0: share hits 100% at lag 10 for every year and any gamma', expect: 1, tol: 1e-12,
      got: () => clCsrShare(10, 10, 0.12) * clCsrShare(1, 10, -0.06),
    },
    {
      name: 'Speedup overstates, slowdown understates, zero is exact', expect: 1, tol: 0,
      got: () => {
        const ratio = (g) => {
          let sum = 0;
          for (let w = 1; w <= 10; w++) sum += clCsrShare(w, 1, g);
          return clCsrShare(10, 1, g) / (sum / 10);
        };
        return ratio(0.0446) > 1 && Math.abs(ratio(0) - 1) < 1e-12 && ratio(-0.06) < 1 ? 1 : 0;
      },
    },
    {
      name: 'Shares grow with development for every year', expect: 1, tol: 0,
      got: () => {
        for (let w = 1; w <= 10; w++) {
          if (!(clCsrShare(w, 1, 0.0446) < clCsrShare(w, 5, 0.0446) && clCsrShare(w, 5, 0.0446) < clCsrShare(w, 10, 0.0446))) return 0;
        }
        return 1;
      },
    },
  ],
});

// --- Module: Watching The Posterior Form (MCMC) ----------------------------

// Stylized 2D posterior matched to Table 7.1's printed marginals for
// (logelr, gamma). The real CSR posterior has ~24 dimensions; two are enough
// to watch the machinery work, and honesty demands saying so in the copy.
const MCMC_TARGET = {
  mx: CSR_LOGELR.mean, sx: CSR_LOGELR.sd,
  my: CSR_GAMMA.mean, sy: CSR_GAMMA.sd,
  rho: -0.25,
};
const MCMC_SEED = 42;

defineModule({
  id: 'mcmc-watch',
  title: 'MCMC Sampling',
  subtitle: 'What Stan actually does with those 10,000 draws',
  icon: 'route',
  level: 'bayes',
  kind: 'concept',
  ord: 3,
  foundations: [
    { module: 'prior-posterior', text: 'The surface being explored is a posterior; this module is for when no formula exists for it.' },
  ],
  bridges: [
    { module: 'meyers-arc', text: 'Every model on Meyers’ ladder is fit exactly this way: the histogram of the walk IS the answer.' },
  ],
  paper: {
    label: 'Meyers, Monograph 8 (2nd ed.), §§1, 5-7',
    section: 'Bayesian MCMC estimation; posterior summaries like Table 7.1; pp. 1-3, 16-36',
    task: 'Explain what a posterior mean (sd) table row means and how sampling produces it',
  },
  intro:
    'Every Meyers table row like "logelr −0.3956 (0.0246)" is a histogram of ' +
    'draws from a distribution nobody can write down. This is the machine ' +
    'that draws them: propose a step, compare posterior densities, accept or ' +
    'reject. Watch a two-parameter version (matched to Table 7.1\'s printed ' +
    'marginals) converge in front of you.',
  params: [
    { key: 'step', tex: 's', label: 'Proposal Step (Sd Units)', min: 0.05, max: 8, step: 0.05, init: 1, fmt: 'num2', link: 'chain' },
  ],
  derived() {
    return {
      targetMean: MCMC_TARGET.mx,
      targetSd: MCMC_TARGET.sx,
    };
  },
  readouts: [
    { sym: '', id: 'draws', fmt: 'num', label: 'Draws', link: 'chain' },
    { sym: '', id: 'acceptRate', fmt: 'pct', label: 'Acceptance Rate', link: 'chain' },
    { sym: '', id: 'meanLogelr', fmt: 'num3', label: 'Running Mean logelr', accent: true, link: 'hist' },
    { sym: '', id: 'sdLogelr', fmt: 'num3', label: 'Running Sd', accent: true, link: 'hist' },
    { sym: '', id: 'targetMean', fmt: 'num3', label: 'Table 7.1 Mean', link: 'hist' },
    { sym: '', id: 'targetSd', fmt: 'num3', label: 'Table 7.1 Sd', link: 'hist' },
  ],
  formula() {
    return {
      sym: '\\theta\' = \\theta + s\\,\\varepsilon,\\quad P(accept) = \\min\\!\\left(1, \\tfrac{\\pi(\\theta\')}{\\pi(\\theta)}\\right)',
      terms: [
        { sym: 's', fmt: 'num2', get: (d) => d.step, link: 'chain' },
        { op: '|' },
        { sym: 'accept\\;\\%', fmt: 'pct', get: (d) => d.acceptRate ?? 0, primary: true, link: 'chain' },
        { op: '|' },
        { sym: '\\bar{\\theta}_{logelr}', fmt: 'num3', get: (d) => d.meanLogelr ?? 0, link: 'hist' },
      ],
    };
  },
  presets: [
    {
      id: 'tuned',
      label: 'Well Tuned',
      note: 'Step near one sd: the chain strides across the posterior, accepting roughly a third of proposals. This is the regime samplers aim for.',
      params: { step: { value: 1 } },
    },
    {
      id: 'timid',
      label: 'Timid Steps',
      note: 'Tiny steps get accepted almost every time and go almost nowhere: the chain crawls, and the histogram takes forever to fill out. High acceptance is not success.',
      params: { step: { value: 0.15 } },
    },
    {
      id: 'reckless',
      label: 'Reckless Steps',
      note: 'Huge steps keep proposing wilderness and get rejected: the chain freezes in place for long stretches. Watch the rejected proposals spray.',
      params: { step: { value: 6 } },
    },
  ],
  story: [
    {
      title: 'Why sample at all',
      text: 'Some belief-curves are too complicated for any formula: the CSR posterior lives in about 24 dimensions and nobody can write it down. MCMC’s trick is that you never need the whole map, only the ability to COMPARE two spots ("is it more probable here, or there?"), and that ratio is always computable. So you wander: propose a step, keep it if the new spot is more probable, sometimes keep it anyway if less. Where the walk LINGERS is where the probability lives. Stan does this; JAGS did before it.',
      preset: 'tuned',
    },
    {
      title: 'The walk itself',
      text: 'Watch one rule generate everything on the left panel. From wherever the walker stands, it proposes a random step of typical size $s$. If the posterior is HIGHER at the proposed spot: always go. If lower: go anyway sometimes, with probability equal to the ratio of the two heights (a spot half as probable is accepted half the time). That is the entire Metropolis algorithm, four lines of code, and the reason it works is the reason it is beautiful: always-uphill would climb to the peak and freeze there (that is MLE’s move); the occasional downhill step forces the walker to EXPLORE in proportion to probability, so it spends twice the time wherever the posterior is twice as high. The chain on stage deliberately starts far out in the tail: watch it wander in, find the ridge, and then patrol it. That patrol, boring as it looks, is the whole product.',
      preset: 'tuned',
    },
    {
      title: 'A table row is a histogram',
      text: 'Now connect the walk to what you will actually read in the paper. As the walker patrols, the right panel files every visited position into a histogram: and because time-spent equals probability, that histogram IS the posterior, drawn by footsteps. Meyers’ Table 7.1 prints a row like "logelr: −0.3956 (0.0246)". Look at the readouts as the chain runs: that printed row is nothing but THIS histogram summarized: its mean and its standard deviation: after enough draws. The same is true of every estimate, standard error, and percentile in the entire monograph: each is a statistic of a pile of walker positions exactly like the one accumulating in front of you. This is the demystification worth keeping: a Bayesian "answer" in modern practice is not a formula evaluated: it is a well-mixed sample, counted. When a paper says "the posterior mean was X", picture footsteps.',
      preset: 'tuned',
    },
    {
      title: 'Tuning is a real problem',
      text: 'The step size $s$ looks like a detail and is actually the difference between an answer and an artifact. Apply this preset: TIMID steps. Nearly every proposal is accepted (the acceptance readout goes to the high nineties): but the walker inches along, and after thousands of draws it has explored one corner of the posterior: the histogram is confidently, smoothly wrong. Now try the reckless preset: giant steps get rejected almost every time, the walker stands still, same failure from the other side. Efficiency lives in the unglamorous middle (folk wisdom says accept roughly a quarter to half). Two practical rituals follow directly and now make sense: modern samplers like Stan spend a warmup phase tuning $s$ automatically, and everyone discards the early "burn-in" draws: the walk’s journey IN from its arbitrary starting point, which records where the walker came from, not what the posterior looks like.',
      preset: 'timid',
    },
  ],
  checks: [
    {
      name: 'Chain converges to the Table 7.1 mean (seeded, post burn-in)', expect: CSR_LOGELR.mean, tol: 0.004,
      got: () => {
        const run = clMetropolisRun({ n: 6000, step: 1, seed: MCMC_SEED, target: MCMC_TARGET, start: { x: MCMC_TARGET.mx + 3.5 * MCMC_TARGET.sx, y: MCMC_TARGET.my + 3.5 * MCMC_TARGET.sy } });
        const tail = run.xs.slice(1000);
        return tail.reduce((a, b) => a + b, 0) / tail.length;
      },
    },
    {
      name: 'Chain recovers the Table 7.1 sd (seeded, post burn-in)', expect: CSR_LOGELR.sd, tol: 0.005,
      got: () => {
        const run = clMetropolisRun({ n: 6000, step: 1, seed: MCMC_SEED, target: MCMC_TARGET });
        const tail = run.xs.slice(1000);
        const m = tail.reduce((a, b) => a + b, 0) / tail.length;
        return Math.sqrt(tail.reduce((a, b) => a + (b - m) * (b - m), 0) / tail.length);
      },
    },
    {
      name: 'Tuned acceptance sits in the healthy band', expect: 1, tol: 0,
      got: () => {
        const a = clMetropolisRun({ n: 4000, step: 1, seed: MCMC_SEED, target: MCMC_TARGET }).acceptRate;
        return a > 0.2 && a < 0.6 ? 1 : 0;
      },
    },
    {
      name: 'Bigger steps reject more', expect: 1, tol: 0,
      got: () => {
        const timid = clMetropolisRun({ n: 4000, step: 0.15, seed: MCMC_SEED, target: MCMC_TARGET }).acceptRate;
        const tuned = clMetropolisRun({ n: 4000, step: 1, seed: MCMC_SEED, target: MCMC_TARGET }).acceptRate;
        const wild = clMetropolisRun({ n: 4000, step: 6, seed: MCMC_SEED, target: MCMC_TARGET }).acceptRate;
        return timid > tuned && tuned > wild && timid > 0.85 && wild < 0.12 ? 1 : 0;
      },
    },
  ],
});

// --- Module: Mack's Machinery (Mack 1994, the RAA triangle) ----------------

// RAA Historical Loss Development Study 1991, p.96 — the triangle every
// distribution-free chain-ladder result in the paper is computed on.
const RAA = [
  [5012, 8269, 10907, 11805, 13539, 16181, 18009, 18608, 18662, 18834],
  [106, 4285, 5396, 10666, 13782, 15599, 15496, 16169, 16704],
  [3410, 8992, 13873, 16141, 18735, 22214, 22863, 23466],
  [5655, 11555, 15766, 21266, 23425, 26083, 27067],
  [1092, 9565, 15836, 22169, 25955, 26180],
  [1513, 6445, 11702, 12935, 15852],
  [557, 4020, 10946, 12314],
  [1351, 6947, 13112],
  [3133, 5395],
  [2063],
];

defineModule({
  id: 'mack-machinery',
  title: 'Mack 1994: Standard Errors',
  subtitle: 'The RAA triangle, three estimators, and where the standard errors come from',
  icon: 'layers',
  level: 'reserving',
  kind: 'exam',
  ord: 6,
  foundations: [
    { module: 'process-fan', text: 'Mack’s three assumptions are statements about the development path; the fan is what they buy.' },
    { module: 'sampling-error', text: 'The two terms inside Mack’s mse are process variance and estimation error, met here first.' },
  ],
  paper: {
    label: 'Mack, "Measuring The Variability Of Chain Ladder Reserve Estimates" (1994)',
    section: 'Formulas (2), (7)-(13) on the RAA triangle; Tables 1-2, Chapter 4 ranges',
    task: 'Compute and interpret chain-ladder reserve variability',
  },
  intro:
    'The chain ladder everyone runs is one of THREE least-squares estimators, ' +
    'and its famous standard-error formula is just variance bookkeeping along ' +
    'the projection. Here is the paper\'s own RAA triangle: watch the fan of ' +
    'projections, the ribbons widening with age, and the range that ' +
    'ultimately gets quoted.',
  params: [
    { key: 'focusAY', tex: 'i', label: 'Accident Year In Focus', min: 2, max: 10, step: 1, init: 9, fmt: 'num', link: 'focus' },
    { key: 'pct', tex: '\\%', label: 'Quoted Percentile', min: 55, max: 99, step: 1, init: 90, fmt: 'num', link: 'range' },
  ],
  derived(par, st) {
    const method = st?.mode || 'vw';
    const f = clMackFactorSet(RAA, method);
    const proj = clMackProject(RAA, f);
    const mack = clMackSe(RAA);
    const i = Math.round(par.focusAY) - 1;
    const y = mack.perYear[i];
    const cv = mack.totalSe / mack.totalReserve;
    const z = clNormInv(par.pct / 100);
    return {
      method,
      seAvailable: method === 'vw',
      f1: f[0],
      focusIdx: i,
      focusUlt: proj[i][RAA.length - 1],
      focusReserve: method === 'vw' ? y.reserve : proj[i][RAA.length - 1] - RAA[i][RAA[i].length - 1],
      focusSe: method === 'vw' ? y.se : null,
      focusCv: method === 'vw' && y.reserve > 0 ? y.se / y.reserve : null,
      totalR: mack.totalReserve,
      totalSe: mack.totalSe,
      totalCv: cv,
      z,
      lnPct: clMackLognRange(mack.totalReserve, cv, z),
      normPct: mack.totalReserve * (1 + z * cv),
      projF: f,
      projSquare: proj,
      mack,
    };
  },
  readouts: [
    { sym: '\\hat{f}_1', id: 'f1', fmt: 'num3', label: 'First Factor, This Estimator', link: 'fans' },
    { sym: '\\hat{R}_i', id: 'focusReserve', fmt: 'num', label: 'Focus-Year Reserve', link: 'focus' },
    { sym: 'se(\\hat{R}_i)', id: 'focusSe', fmt: 'num', label: 'Its Standard Error', link: 'focus' },
    { sym: '', id: 'focusCv', fmt: 'pct', label: 'Focus-Year Cv', accent: true, link: 'focus' },
    { sym: '\\hat{R}', id: 'totalR', fmt: 'num', label: 'Total Reserve', link: 'range' },
    { sym: '', id: 'lnPct', fmt: 'num', label: 'Lognormal Quoted Value', accent: true, link: 'range' },
  ],
  formula() {
    return {
      sym: 'mse(\\hat{C}_{iI}) = \\hat{C}_{iI}^2 \\sum_{k}\\tfrac{\\hat{\\alpha}_k^2}{\\hat{f}_k^2}\\left(\\tfrac{1}{\\hat{C}_{ik}} + \\tfrac{1}{\\sum_j C_{jk}}\\right)',
      terms: [
        { sym: 'se(\\hat{R})', fmt: 'num', get: (d) => d.totalSe, primary: true, link: 'range' },
        { op: '/' },
        { sym: '\\hat{R}', fmt: 'num', get: (d) => d.totalR, link: 'range' },
        { op: '=' },
        { sym: 'cv', fmt: 'pct', get: (d) => d.totalCv, link: 'range' },
        { op: '|' },
        { sym: 'LN_{pct}', fmt: 'num', get: (d) => d.lnPct, link: 'range' },
        { op: 'vs' },
        { sym: 'N_{pct}', fmt: 'num', get: (d) => d.normPct, link: 'range' },
      ],
    };
  },
  presets: [
    {
      id: 'chain-ladder',
      label: 'Volume Weighted',
      note: 'The chain ladder: f_1 = 2.999. This weighting is least-squares optimal when Var(C_{k+1}|C_k) is proportional to C_k, and it is the assumption the whole standard-error machinery is built on.',
      mode: 'vw',
      params: { focusAY: { value: 9 }, pct: { value: 90 } },
    },
    {
      id: 'regression',
      label: 'Regression Through Origin',
      note: 'Weight by C_k squared and f_1 falls to 2.217. Same triangle, materially different ultimates. Standard errors here would need a different variance law, so the ribbons stand down.',
      mode: 'ols',
      params: { focusAY: { value: 9 }, pct: { value: 90 } },
    },
    {
      id: 'average',
      label: 'Simple Average',
      note: 'Average the raw factors and f_1 explodes to 8.206, because accident year 1982 developed 106 into 4,285: a 40.4x factor with almost no volume behind it. Weighting is not a technicality.',
      mode: 'avg',
      params: { focusAY: { value: 10 }, pct: { value: 90 } },
    },
  ],
  story: [
    {
      title: 'The question first',
      text: 'The chain ladder gives one number, and one number is not an answer until you know how wrong it could be. Level 4 split every prediction error into process risk plus estimation risk; Mack writes BOTH terms for the chain ladder in closed form: pencil-and-paper formulas for a method everyone thought was beyond statistics. This module reproduces his printed example to the digit, and on the way shows something unsettling: "the" chain ladder is actually three different methods, disagreeing by a factor of four exactly where the reserve is largest.',
      preset: 'chain-ladder',
    },
    {
      title: 'Three chain ladders',
      text: 'Mack’s first revelation is that "the" chain ladder is actually three methods wearing one name. A development factor is fitted from the ratios $C_{k+1}/C_k$ across years: but fitted HOW? Weight each year’s ratio by $C_k^2$ and you get one answer; weight by $C_k$ (the volume-weighted standard) and you get another; weight equally and a third. These are three least-squares fits under three different assumptions about the NOISE: the variance-law lesson from the GLM level, surfacing a decade early. On this famous triangle (the RAA data every stochastic reserving paper reuses) the three answers at $k = 1$ are 2.217, 2.999, and 8.206: not a rounding disagreement, a factor of four, driven by one wild early ratio that each weighting trusts differently. Click through the factor presets and watch the projections swing. By $k \\geq 6$ the three agree: mature data settles arguments: but the young factors, where the money is, depend on a noise assumption most practitioners never knew they were making.',
      preset: 'chain-ladder',
    },
    {
      title: 'Variance bookkeeping',
      text: 'Now the famous part: putting error bars on a method that never had any. Look at the formula’s repeating unit: each projection step adds $\\tfrac{\\hat{\\alpha}_k^2}{\\hat{f}_k^2}\\left(\\tfrac{1}{\\hat{C}_{ik}} + \\tfrac{1}{\\sum_j C_{jk}}\\right)$ to the relative error: and translate its two fractions with what you learned in Process vs Parameter Risk. The $1/\\hat{C}_{ik}$ piece is PROCESS risk: this year’s own future randomness at this step: and it divides by this year’s size, because bigger books are steadier in percent. The $1/\\sum_j C_{jk}$ piece is ESTIMATION risk: the factor $\\hat{f}_k$ was fitted from finitely many years: and it divides by ALL the data that went into the fit. Same two-term split, per step, accumulated along the projection. The ribbon around the focus year is that accumulation drawn live: watch it inflate step by step as the projection walks right, each age adding its own contribution of doubt. Nothing mystical: just careful bookkeeping of the two ways each step can be wrong.',
      preset: 'chain-ladder',
    },
    {
      title: 'The number that matters',
      text: 'Read the readouts the way a reserving actuary would have in 1994, seeing them for the first time. Accident year 9’s reserve is 10,650: and its standard error is 6,333, a 59% coefficient of variation. Sit with that: the error bar is more than half the estimate. Scan the whole triangle and it does not improve much: every year’s cv is at or above 41%. Nothing was done wrong here: this is the RAA data, a real book, projected by the standard method, and Mack’s formulas (reproduced digit-exact in this module’s checks) are simply the first honest measurement of an uncertainty that had always existed. The profession had been booking numbers like 10,650 for decades without knowing the second number. Once you have seen a 59% cv attached to a booked reserve, "the reserve is 10,650" stops sounding like an answer and starts sounding like the first half of a sentence: which is precisely the cultural shift this paper caused.',
      preset: 'chain-ladder',
    },
    {
      title: 'Quoting a range',
      text: 'Two numbers are still not a range: to quote "the 90th percentile reserve" you must wrap a SHAPE around the mean and standard error, and this is the Loss Distributions lesson arriving with money attached. Mack matches both candidates to the same $(\\hat{R}, se)$ pair. At the top of the range the two nearly agree: the lognormal’s 90th percentile is 86,298 and the normal’s is barely different: comforting, and misleading if you stopped there. At the BOTTOM they disagree badly: 24,871 (lognormal) versus 17,672 (normal), a 40% gap in the low estimate, because the lognormal’s floor-and-right-lean pushes its low percentiles up while the symmetric normal dives. Drag the sd slider and watch the disagreement grow with the noise. Mack’s printed verdict is the honest one: there is no general rule; check both and understand why they differ. A range quoted without naming its shape is, quietly, a choice someone made without telling you.',
      preset: 'chain-ladder',
    },
  ],
  checks: [
    { name: 'Volume-weighted f_1 = 2.999', expect: 2.999, tol: 1e-3, got: () => clMackFactorSet(RAA, 'vw')[0] },
    { name: 'Regression f_1 = 2.217', expect: 2.217, tol: 1e-3, got: () => clMackFactorSet(RAA, 'ols')[0] },
    { name: 'Simple-average f_1 = 8.206', expect: 8.206, tol: 1e-3, got: () => clMackFactorSet(RAA, 'avg')[0] },
    { name: 'alpha_1^2 = 27883', expect: 27883, tol: 5, got: () => clMackAlpha2(RAA)[0] },
    { name: 'alpha_9^2 by rule (9) = 1.34', expect: 1.343, tol: 5e-3, got: () => clMackAlpha2(RAA)[8] },
    { name: 'Ultimate AY 2 = 16,858', expect: 16858, tol: 1.5, got: () => clMackSe(RAA).perYear[1].ult },
    { name: 'Reserve AY 9 = 10,650', expect: 10650, tol: 1.5, got: () => clMackSe(RAA).perYear[8].reserve },
    { name: 'se AY 2 = 206', expect: 206, tol: 1, got: () => clMackSe(RAA).perYear[1].se },
    { name: 'se AY 9 = 6,333', expect: 6333, tol: 2, got: () => clMackSe(RAA).perYear[8].se },
    { name: 'Total reserve = 52,135', expect: 52135, tol: 2, got: () => clMackSe(RAA).totalReserve },
    { name: 'Total cv = 51.6%', expect: 0.5162, tol: 5e-4, got: () => { const m = clMackSe(RAA); return m.totalSe / m.totalReserve; } },
    { name: 'Lognormal 90th = 86,298', expect: 86298, tol: 40, got: () => { const m = clMackSe(RAA); return clMackLognRange(m.totalReserve, m.totalSe / m.totalReserve, 1.28); } },
    { name: 'Lognormal 10th = 24,871', expect: 24871, tol: 40, got: () => { const m = clMackSe(RAA); return clMackLognRange(m.totalReserve, m.totalSe / m.totalReserve, -1.28); } },
  ],
});

// --- Module: Clark's Growth Curves (Clark 2003) ----------------------------

// The Mack (1993) reported triangle's latest diagonal at 12/31/2000, AYs
// 1991-2000 (reconstructed from Clark's printed ultimates minus reserves;
// sums to his printed 34,358,090), with average ages x - 6.
const CLARK_DIAG = [3901463, 5339085, 4909315, 4588268, 3873311, 3691712, 3483130, 2864498, 1363294, 344014];
const CLARK_AGES = [114, 102, 90, 78, 66, 54, 42, 30, 18, 6];
const CLARK_PREM = [10000000, 10400000, 10800000, 11200000, 11600000, 12000000, 12400000, 12800000, 13200000, 13600000];
const CLARK_LL = { family: 'loglogistic', omega: 1.434294, theta: 48.6249 };
const CLARK_WB = { family: 'weibull', omega: 1.296906, theta: 48.88453 };
const CLARK_CC = { family: 'loglogistic', omega: 1.447634, theta: 48.0205 };

defineModule({
  id: 'clark-curves',
  title: 'Clark: Growth Curves & MLE',
  subtitle: 'Two parameters replace a factor table, and the tail becomes a choice you can see',
  icon: 'chart-spline',
  level: 'reserving',
  kind: 'exam',
  ord: 7,
  foundations: [
    { module: 'likelihood-surface', text: 'Clark picks ω and θ by maximizing exactly the likelihood machine built here.' },
    { module: 'sampling-error', text: 'Clark’s process versus parameter split is the two-band decomposition from this module.' },
  ],
  paper: {
    label: 'Clark, "LDF Curve-Fitting And Stochastic Reserving" (2003)',
    section: 'Loglogistic/Weibull G(x), LDF and Cape Cod methods, 240-month truncation; Tables 1-5',
    task: 'Fit parametric emergence curves and defend the tail and truncation choices',
  },
  intro:
    'A factor table is a curve you refuse to name. Clark names it: two ' +
    'parameters, maximum likelihood over every increment, and suddenly the ' +
    'tail is not a mystery appendix but a visible stretch of curve you chose. ' +
    'The loglogistic and Weibull agree about the data and disagree about ' +
    'everything after it.',
  params: [
    { key: 'omega', tex: '\\omega', label: 'Shape', min: 0.8, max: 2.5, step: 0.005, init: 1.434294, fmt: 'num3', link: 'curve' },
    { key: 'theta', tex: '\\theta', label: 'Scale (Months To Half-ish)', min: 20, max: 90, step: 0.25, init: 48.6249, fmt: 'num', link: 'curve' },
    { key: 'truncAge', tex: '', label: 'Truncation Age (Months)', min: 120, max: 480, step: 12, init: 240, fmt: 'num', link: 'trunc' },
  ],
  derived(par, st) {
    const family = st?.mode === 'weibull' ? 'weibull' : 'loglogistic';
    const shape = { family, omega: par.omega, theta: par.theta };
    const truncAvg = par.truncAge - 6;
    const trunc = clClarkReserves(CLARK_DIAG, CLARK_AGES, shape, truncAvg);
    const full = clClarkReserves(CLARK_DIAG, CLARK_AGES, shape, null);
    const cc = clClarkElr(CLARK_DIAG, CLARK_AGES, CLARK_PREM, shape);
    return {
      family,
      gOldest: clClarkG(CLARK_AGES[0], shape),
      tailLdf: 1 / clClarkG(CLARK_AGES[0], shape),
      gTrunc: clClarkG(truncAvg, shape),
      truncAvg,
      reservesTrunc: trunc.perAY,
      totalTrunc: trunc.total,
      reservesFull: full.perAY,
      totalFull: full.total,
      tailBeyond: full.total - trunc.total,
      elr: cc.elr,
    };
  },
  readouts: [
    { sym: 'G(x_{1991})', id: 'gOldest', fmt: 'pct', label: 'Oldest Year Emerged', link: 'curve' },
    { sym: 'LDF_{1991}', id: 'tailLdf', fmt: 'num3', label: 'Its Ultimate Development', accent: true, link: 'curve' },
    { sym: '', id: 'totalTrunc', fmt: 'num', label: 'Reserve To Truncation', accent: true, link: 'bars' },
    { sym: '', id: 'tailBeyond', fmt: 'num', label: 'Left In The Tail', link: 'trunc' },
    { sym: 'ELR', id: 'elr', fmt: 'pct', label: 'Cape Cod ELR At This Curve', link: 'curve' },
  ],
  formula(state) {
    if (state.mode === 'weibull') {
      return {
        sym: 'G(x) = 1 - e^{-(x/\\theta)^{\\omega}}',
        terms: [
          { sym: 'G(114)', fmt: 'pct', get: (d) => d.gOldest, primary: true, link: 'curve' },
          { op: '|' },
          { sym: '\\omega', fmt: 'num3', get: (d) => d.omega, link: 'curve' },
          { op: '|' },
          { sym: '\\theta', fmt: 'num', get: (d) => d.theta, link: 'curve' },
          { op: '|' },
          { sym: 'G(x_{trunc})', fmt: 'pct', get: (d) => d.gTrunc, link: 'trunc' },
        ],
      };
    }
    return {
      sym: 'G(x) = \\tfrac{x^{\\omega}}{x^{\\omega} + \\theta^{\\omega}}',
      terms: [
        { sym: 'G(114)', fmt: 'pct', get: (d) => d.gOldest, primary: true, link: 'curve' },
        { op: '|' },
        { sym: '\\omega', fmt: 'num3', get: (d) => d.omega, link: 'curve' },
        { op: '|' },
        { sym: '\\theta', fmt: 'num', get: (d) => d.theta, link: 'curve' },
        { op: '|' },
        { sym: 'G(x_{trunc})', fmt: 'pct', get: (d) => d.gTrunc, link: 'trunc' },
      ],
    };
  },
  presets: [
    {
      id: 'loglogistic',
      label: 'Loglogistic Fit',
      note: 'Clark\'s MLE on all 55 increments: omega = 1.434, theta = 48.6. The oldest year is only 77.2% emerged after ten years, so its LDF is still 1.295. Heavy tail, honest about it.',
      mode: 'loglogistic',
      params: { omega: { value: 1.434294 }, theta: { value: 48.6249 }, truncAge: { value: 240 } },
    },
    {
      id: 'weibull',
      label: 'Weibull Fit',
      note: 'Same 55 increments, different family: the Weibull says the oldest year is 95.0% done and its LDF is 1.052. The data cannot referee the tail; the family choice is the reserve choice.',
      mode: 'weibull',
      params: { omega: { value: 1.296906 }, theta: { value: 48.88453 }, truncAge: { value: 240 } },
    },
    {
      id: 'capecod',
      label: 'Cape Cod Curve',
      note: 'Refit alongside an ELR against on-level premium and the curve barely moves (omega = 1.448, theta = 48.0) while the ELR lands at 59.8%. Clark prefers Cape Cod: the extra information stiffens the immature years.',
      mode: 'loglogistic',
      params: { omega: { value: 1.447634 }, theta: { value: 48.0205 }, truncAge: { value: 240 } },
    },
  ],
  story: [
    {
      title: 'The question first',
      text: 'Instead of nine separate development factors, suppose the payout follows ONE smooth curve with two dials. Which dial settings fit best? That is Level 4’s likelihood machine, verbatim: let every triangle cell vote. Two parameters replace nine, and odd evaluation dates, partial years, and tails stop being special cases. The module also shows you the method’s honest limit: two curve families that fit the data equally well and disagree fivefold about the tail: and Clark’s disciplined answer to living with that.',
      preset: 'loglogistic',
    },
    {
      title: 'Name the curve',
      text: 'Look at what the two dials actually control. $G(x)$ is the fraction of ultimate loss paid by age $x$: the payout pattern as one continuous curve: with $\\theta$ setting WHERE the action happens (the age by which half the money is out) and $\\omega$ setting how SHARPLY the curve turns. Drag both and feel the whole pattern respond as a single object. Now count what you are estimating: two parameters, fitted by letting all fifty-five triangle increments vote through one likelihood: instead of nine separate development factors each fitted from its own thin column of ratios. That trade: fewer parameters, every data point informing every parameter: is the parameter-risk lesson from Level 4, acted on. And because $G(x)$ is defined at EVERY age, not just year-ends, the perennial nuisances of practice: a June evaluation date, a year on the books for seven months: stop being special cases requiring interpolation folklore and become ordinary function evaluations.',
      preset: 'loglogistic',
    },
    {
      title: 'The tail is a family argument',
      text: 'Here is the uncomfortable experiment. Fit the loglogistic family: good fit. Now apply this preset and fit the Weibull family instead: also a good fit, by any statistic you compute on the observed increments. The two curves run nearly on top of each other everywhere the triangle has data. Then look right of the data, where the reserve actually lives: the loglogistic implies the oldest year still grows by a factor 1.295, the Weibull says 1.052: a fivefold disagreement in remaining development, between two models the data cannot tell apart. Nothing in the triangle settles this, and that is the point worth carrying out: the likelihood machine chooses the best member WITHIN a family, but the FAMILY: how fast the tail is allowed to decay: walks in as an assumption, priced invisibly into the reserve. The honest response is not to pick the flattering one; it is to show both, name the choice, and argue it from outside knowledge: which is exactly what Clark does next with truncation.',
      preset: 'weibull',
    },
    {
      title: 'Truncation as discipline',
      text: 'Clark’s answer to the tail problem is administrative rather than mathematical, and better for it. Cap development at a truncation age: 240 months here: and split the projection in two: reserve TO the cap using the fitted curve (solid), and let everything beyond the cap: the shaded region, 6.65M on this data: stand as its own explicitly-labeled item. Drag the truncation line left and right and watch dollars migrate between the fitted reserve and the shaded tail. What has this bought? The part of the answer the data genuinely supports is now separated from the part that is pure curve-family extrapolation: and the second part has become a NUMBER a reviewer can see, question, and replace with judgment or benchmarks, instead of an assumption dissolved invisibly into the total. The mathematics did not improve; the honesty did. A surprising amount of good actuarial practice is exactly this move: converting hidden assumptions into visible line items.',
      preset: 'loglogistic',
    },
    {
      title: 'Same curve, sturdier method',
      text: 'One curve, two ways to use it: and the difference is a credibility argument you already know. The LDF version develops each year’s own reported losses to ultimate: pure chain-ladder logic, so a young year’s ultimate leans entirely on its own thin diagonal cell. The Cape Cod version instead pools everything into one expected loss ratio: divide TOTAL reported losses by TOTAL used-up premium (premium × the fitted $G$, the share of each year’s exposure that has had time to report): giving ELR = 59.78% on this data: and reserves each year as that shared ratio times its unreported premium share. Recognize the move: the immature years, whose own data is mostly noise, get shrunk toward the book-wide rate: Credibility & Shrinkage at $Z \\approx 0$ for the green years, applied through a premium base. Clark recommends Cape Cod for the actual reserve for exactly the reason the valley taught: where data is thin, borrowed strength beats own-data bravado.',
      preset: 'capecod',
    },
  ],
  checks: [
    { name: 'Loglogistic G(114) = 77.24%', expect: 0.7724, tol: 2e-4, got: () => clClarkG(114, CLARK_LL) },
    { name: 'Loglogistic LDF 1991 = 1.2946', expect: 1.2946, tol: 3e-4, got: () => 1 / clClarkG(114, CLARK_LL) },
    { name: 'Loglogistic G(234) = 90.50%', expect: 0.9050, tol: 2e-4, got: () => clClarkG(234, CLARK_LL) },
    { name: 'Truncated LDF 1991 = 1.1716', expect: 1.1716, tol: 3e-4, got: () => clClarkG(234, CLARK_LL) / clClarkG(114, CLARK_LL) },
    { name: 'Untruncated total reserve = 35,640,618', expect: 35640618, tol: 4000, got: () => clClarkReserves(CLARK_DIAG, CLARK_AGES, CLARK_LL, null).total },
    { name: 'Truncated total reserve = 28,987,633', expect: 28987633, tol: 4000, got: () => clClarkReserves(CLARK_DIAG, CLARK_AGES, CLARK_LL, 234).total },
    { name: 'Weibull G(114) = 95.01%', expect: 0.9501, tol: 2e-4, got: () => clClarkG(114, CLARK_WB) },
    { name: 'Weibull LDF 1991 = 1.0525', expect: 1.0525, tol: 3e-4, got: () => 1 / clClarkG(114, CLARK_WB) },
    { name: 'Cape Cod used-up premium = 57,477,500', expect: 57477500, tol: 6000, got: () => clClarkElr(CLARK_DIAG, CLARK_AGES, CLARK_PREM, CLARK_CC).usedUp },
    { name: 'Cape Cod ELR = 59.78%', expect: 0.5978, tol: 5e-4, got: () => clClarkElr(CLARK_DIAG, CLARK_AGES, CLARK_PREM, CLARK_CC).elr },
  ],
});

// --- Module: The Bootstrap, Live (Shapland) --------------------------------

// Taylor & Ashe (1983) incremental paid — the monograph's example triangle
// (and the same data behind Clark's diagonal: its cumulative diagonal equals
// CLARK_DIAG, an independent cross-check inside this file). Chain-ladder
// reserve 18,680,856; Pearson scale 52,601.
const TAYLOR_ASHE = [
  [357848, 766940, 610542, 482940, 527326, 574398, 146342, 139950, 227229, 67948],
  [352118, 884021, 933894, 1183289, 445745, 320996, 527804, 266172, 425046],
  [290507, 1001799, 926219, 1016654, 750816, 146923, 495992, 280405],
  [310608, 1108250, 776189, 1562400, 272482, 352053, 206286],
  [443160, 693190, 991983, 769488, 504851, 470639],
  [396132, 937085, 847498, 805037, 705960],
  [440832, 847631, 1131398, 1063269],
  [359480, 1061648, 1443370],
  [376686, 986608],
  [344014],
];
const TA_FIT = clOdpFit(TAYLOR_ASHE);

defineModule({
  id: 'odp-bootstrap',
  title: 'Shapland: The ODP Bootstrap',
  subtitle: 'Resample the residuals, refit the ladder, watch a reserve distribution exist',
  icon: 'dices',
  level: 'reserving',
  kind: 'exam',
  ord: 8,
  foundations: [
    { module: 'residual-lens', text: 'The pool being resampled is Pearson residuals; why they are exchangeable is this concept.' },
    { module: 'sampling-error', text: 'The √(n/(n−p)) correction exists because residuals understate the true noise.' },
  ],
  paper: {
    label: 'Shapland, "Using The ODP Bootstrap Model" (CAS Monograph 4)',
    section: 'ODP bootstrap of the paid chain ladder on Taylor & Ashe; §§2-3, Figures 5.14-5.16',
    task: 'Produce and defend a full distribution of unpaid claims, not a point estimate',
  },
  intro:
    'The chain ladder gives one number. The bootstrap asks: in how many other ' +
    'worlds consistent with these residuals would it have given a different ' +
    'one? Resample, refit, project, repeat. The histogram that piles up IS ' +
    'the reserve distribution every percentile and TVaR in Shapland comes ' +
    'from.',
  params: [
    { key: 'nSims', tex: 'B', label: 'Bootstrap Iterations', min: 200, max: 4000, step: 100, init: 1500, fmt: 'num', link: 'hist' },
  ],
  derived(par, st) {
    return {
      withProcess: st?.mode !== 'param',
      clReserve: TA_FIT.clReserve,
      phi: TA_FIT.phi,
      dfCorr: TA_FIT.dfCorr,
      nResid: TA_FIT.resid.length,
    };
  },
  readouts: [
    { sym: '', id: 'clReserve', fmt: 'num', label: 'Chain Ladder Point Estimate', link: 'hist' },
    { sym: '', id: 'done', fmt: 'num', label: 'Iterations Run', link: 'hist' },
    { sym: '', id: 'bootMean', fmt: 'num', label: 'Bootstrap Mean', link: 'hist' },
    { sym: '', id: 'bootCv', fmt: 'pct', label: 'Coefficient Of Variation', accent: true, link: 'hist' },
    { sym: '', id: 'p95', fmt: 'num', label: '95th Percentile', accent: true, link: 'hist' },
    { sym: '\\phi', id: 'phi', fmt: 'num', label: 'Pearson Scale', link: 'resid' },
  ],
  formula(state) {
    return {
      sym: state.mode === 'param'
        ? 'q^* = m + r^*\\sqrt{m}\\;\\;(estimation\\;error\\;only)'
        : 'q^* = m + r^*\\sqrt{m},\\qquad q_{future} \\sim \\phi\\,Gamma(m^*/\\phi)',
      terms: [
        { sym: '\\phi', fmt: 'num', get: (d) => d.phi, link: 'resid' },
        { op: '|' },
        { sym: '\\sqrt{n/(n{-}p)}', fmt: 'num3', get: (d) => d.dfCorr, link: 'resid' },
        { op: '|' },
        { sym: 'cv', fmt: 'pct', get: (d) => d.bootCv ?? null, primary: true, link: 'hist' },
      ],
    };
  },
  presets: [
    {
      id: 'full',
      label: 'Parameter Plus Process',
      note: 'The real thing: resampled residuals carry estimation error into every refit, then each future cell adds ODP process noise (variance phi times the mean). Total cv lands near 16%, the published neighborhood for this triangle.',
      mode: 'full',
      params: { nSims: { value: 1500 } },
    },
    {
      id: 'param',
      label: 'Estimation Error Only',
      note: 'Switch the process draws off and the histogram tightens: what remains is uncertainty about the FACTORS alone. The gap between the two widths is exactly the process variance Shapland decomposes.',
      mode: 'param',
      params: { nSims: { value: 1500 } },
    },
  ],
  story: [
    {
      title: 'The question first',
      text: 'History only happened once, so how do you know how different it COULD have been? Manufacture thousands of alternate histories by reshuffling the model’s own leftovers: the flat, exchangeable Pearson residuals from Level 6. Price every fake history, and the pile of answers IS the reserve distribution. This module runs that factory live on the famous Taylor-Ashe triangle: you will watch pseudo-histories get built and priced by the thousand, see which of the two Level-4 risks carries the width, and find the one square root whose omission quietly understates everyone’s risk.',
      preset: 'full',
    },
    {
      title: 'What a residual pool is',
      text: 'Begin with the raw material. Fit the ODP chain ladder (the GLM whose fitted values ARE the chain ladder: Taylor’s theorem, one module over) to the real Taylor-Ashe triangle, and every observed increment leaves a leftover: a Pearson residual $r = (q - m)/\\sqrt{m}$, its miss measured in units of its own cell’s expected wobble: exactly the standardization you learned in Pearson Residuals. Fifty-five cells, fifty-five leftovers, drawn on stage as the pool. Everything that follows rests on one claim about this pool: that it is EXCHANGEABLE: any leftover could plausibly have occurred at any cell, because standardization removed each cell’s scale. If that claim holds, the pool is a bottled sample of the triangle’s pure noise, detached from position and ready to be re-poured anywhere. If it fails: a funnel, a diagonal pattern: every simulated history downstream inherits the flaw. This is why Shapland’s paper spends an entire chapter on residual diagnostics BEFORE simulating anything, and why this ladder made you flatten a funnel yourself before letting you in here.',
      preset: 'full',
    },
    {
      title: 'Manufacture a world, price it',
      text: 'Now watch one alternate history get manufactured, because the loop is the paper. Draw fifty-five residuals from the pool at random, WITH replacement (some leftovers reused, some skipped: that resampling is the "bootstrap"). Re-scale each to its destination cell and lay it around the fitted means: a pseudo-triangle, a history that plausibly could have happened but did not. Now treat the fake as if it were real: refit the chain ladder to it: crucially, the refitted factors DIFFER from the original, which is estimation risk being simulated: project the fake to ultimate, and add fresh process noise (gamma draws) cell by cell for the future’s own randomness. One trip through the loop yields one plausible total reserve; the histogram on stage is thousands of trips piling up, live. Notice the two Level-4 risks entering at two distinct doors: refitting simulates parameter risk, the gamma draws simulate process risk. The machine is not clever mathematics: it is honest, industrialized rerunning of the world.',
      preset: 'full',
    },
    {
      title: 'Where the width comes from',
      text: 'Take the machine apart to see which risk carries the width. Apply this preset: it switches OFF the process-noise draws, so each iteration still resamples and refits (parameter risk lives) but projects without fresh future randomness. The histogram narrows: what remains is estimation error alone, and you can read its share of the total directly off the two widths. Then there is a quieter adjustment doing real work: every resampled residual is multiplied by $\\sqrt{n/(n-p)} = \\sqrt{55/36}$ first. Why: the model fitted 19 parameters, and fitting ABSORBS noise: the residuals left over understate the true σ, exactly the degrees-of-freedom lesson from Process vs Parameter Risk. Without the correction the manufactured histories would all be a touch too calm, and the reserve distribution’s cv comes out near 13% instead of the honest 16%. A three-point understatement of risk, caused by skipping one square root: the kind of silent error that survives review precisely because every individual iteration still looks reasonable.',
      preset: 'param',
    },
    {
      title: 'The deliverable',
      text: 'Step back and look at what the machine actually shipped. The deterministic chain ladder produced one number: 18,680,856: reproduced exactly by this module, and marked as a line on the histogram. The bootstrap wrapped a whole DISTRIBUTION around it, and now every risk question answers itself by reading the pile: the mean is the best estimate, the cv (about 16%) is the relative risk, the 95th and 99th percentiles are capital-style thresholds, and tail averages beyond them price the catastrophic remainder. Every figure in Shapland’s exhibits is a statistic of this histogram: nothing more exotic. Notice also where the point estimate SITS: not at the center but slightly below the mean, because the reserve distribution leans right like everything else in this ladder. That is the quiet final lesson: the number the industry books is one line through a distribution it historically never drew: and once the distribution exists, refusing to look at it is a choice.',
      preset: 'full',
    },
  ],
  checks: [
    { name: 'Chain-ladder reserve = 18,680,856 (England-Verrall)', expect: 18680856, tol: 1, got: () => TA_FIT.clReserve },
    { name: 'Pearson scale phi = 52,601', expect: 52601, tol: 2, got: () => TA_FIT.phi },
    { name: '55 residual cells', expect: 55, tol: 0, got: () => TA_FIT.resid.length },
    { name: 'df correction = sqrt(55/36)', expect: Math.sqrt(55 / 36), tol: 1e-12, got: () => TA_FIT.dfCorr },
    {
      name: 'Cumulative diagonal equals Clark\'s reconstruction (same data)', expect: 34358090, tol: 0,
      got: () => TA_FIT.cum.reduce((s, row) => s + row[row.length - 1], 0),
    },
    {
      name: 'Seeded bootstrap mean within 3% of the chain ladder', expect: 1, tol: 0,
      got: () => {
        const rng = clMulberry32(42);
        let sum = 0;
        const n = 400;
        for (let s = 0; s < n; s++) sum += clOdpBootstrapOnce(TA_FIT, rng, true);
        return Math.abs(sum / n - TA_FIT.clReserve) / TA_FIT.clReserve < 0.03 ? 1 : 0;
      },
    },
    {
      name: 'Seeded full cv in the published neighborhood (14-19%)', expect: 1, tol: 0,
      got: () => {
        const rng = clMulberry32(42);
        const a = [];
        for (let s = 0; s < 600; s++) a.push(clOdpBootstrapOnce(TA_FIT, rng, true));
        const m = a.reduce((x, y) => x + y, 0) / a.length;
        const sd = Math.sqrt(a.reduce((x, y) => x + (y - m) * (y - m), 0) / a.length);
        const cv = sd / m;
        return cv > 0.14 && cv < 0.19 ? 1 : 0;
      },
    },
    {
      name: 'Process noise widens the distribution (seeded)', expect: 1, tol: 0,
      got: () => {
        const sdOf = (proc) => {
          const rng = clMulberry32(42);
          const a = [];
          for (let s = 0; s < 600; s++) a.push(clOdpBootstrapOnce(TA_FIT, rng, proc));
          const m = a.reduce((x, y) => x + y, 0) / a.length;
          return Math.sqrt(a.reduce((x, y) => x + (y - m) * (y - m), 0) / a.length);
        };
        return sdOf(true) > sdOf(false) ? 1 : 0;
      },
    },
  ],
});

// --- Module: The Risk Margin Ladder (Marshall) -----------------------------

// Insurer ABC, Figure 3. Cell order: Motor OSC, Motor PL, Home OSC, Home PL,
// CTP OSC, CTP PL. External CoVs are the verified root-sum-of-squares of the
// seven risk categories in Part D.
const MRSH = {
  labels: ['Motor OSC', 'Motor PL', 'Home OSC', 'Home PL', 'CTP OSC', 'CTP PL'],
  classes: [['Motor', 0, 1], ['Home', 2, 3], ['CTP', 4, 5]],
  w: [0.05, 0.25, 0.05, 0.25, 0.30, 0.10],
  indep: [0.070, 0.050, 0.060, 0.050, 0.060, 0.150],
  internal: [0.055, 0.050, 0.055, 0.050, 0.095, 0.080],
  external: [0.0403, 0.0680, 0.0339, 0.1547, 0.1141, 0.1379],
};

/** Internal systemic correlations: 75% OSC-PL within class, 50% Motor-Home, 25% CTP-anything. */
function clMarshallRhoInternal(i, j, flex) {
  const cls = (k) => (k < 2 ? 0 : k < 4 ? 1 : 2);
  let rho;
  if (cls(i) === cls(j)) rho = 0.75;
  else if (cls(i) !== 2 && cls(j) !== 2) rho = 0.50;
  else rho = 0.25;
  return rho + (1 - rho) * (flex || 0);
}

/** External systemic: fully correlated within a class, independent across. */
function clMarshallRhoExternal(i, j) {
  const cls = (k) => (k < 2 ? 0 : k < 4 ? 1 : 2);
  return cls(i) === cls(j) ? 1 : 0;
}

/**
 * The full Figure 3 consolidation: three independent sources of uncertainty,
 * each aggregated across the six cells with its own correlation structure,
 * then combined by root-sum-of-squares and converted to a margin.
 */
function clMarshallConsolidate({ sIndep = 1, sInternal = 1, sExternal = 1, flex = 0, z = 0.6745 } = {}) {
  const { w, indep, internal, external } = MRSH;
  const ci = indep.map((c) => c * sIndep);
  const cn = internal.map((c) => c * sInternal);
  const ce = external.map((c) => c * sExternal);
  const agg = (c, rho, idx) => clCovAggregate(w, c, rho, idx);
  const none = () => 0;
  const totIndep = agg(ci, none);
  const totInternal = agg(cn, (i, j) => clMarshallRhoInternal(i, j, flex));
  const totExternal = agg(ce, clMarshallRhoExternal);
  const total = Math.sqrt(totIndep ** 2 + totInternal ** 2 + totExternal ** 2);
  const byClass = MRSH.classes.map(([label, a, b]) => {
    const idx = [a, b];
    const iC = agg(ci, none, idx);
    const nC = agg(cn, (i, j) => clMarshallRhoInternal(i, j, flex), idx);
    const eC = agg(ce, clMarshallRhoExternal, idx);
    return { label, indep: iC, internal: nC, external: eC, total: Math.sqrt(iC * iC + nC * nC + eC * eC) };
  });
  const s2 = Math.log(1 + total * total);
  return {
    totIndep, totInternal, totExternal, total, byClass,
    rmNormal: z * total,
    rmLogn: Math.exp(z * Math.sqrt(s2) - s2 / 2) - 1,
  };
}

// --- Module: The Same Answer Twice (Taylor & McGuire) ----------------------

// Table 1-1: incremental paid, New Jersey Manufacturers workers comp
// (Meyers-Shi database), AYs 1988-1997 — extracted from the source PDF.
const TAYLOR_WC = [
  [41821, 34729, 20147, 15965, 11285, 5924, 4775, 3742, 3435, 2958],
  [48167, 39495, 24444, 18178, 10840, 7379, 5683, 4758, 3959],
  [52058, 47459, 27359, 17916, 11448, 8846, 5869, 5391],
  [57251, 49510, 27036, 20871, 14304, 10552, 7742],
  [59213, 54129, 29566, 22484, 14114, 10000],
  [59475, 52076, 26836, 22332, 14756],
  [65607, 44648, 27062, 22655],
  [56748, 39315, 26748],
  [52212, 40030],
  [43962],
];
const TWC_CUM = TAYLOR_WC.map((row) => {
  const out = []; let s = 0;
  for (const q of row) { s += q; out.push(s); }
  return out;
});
const TWC_MS = clMarginalSum(TAYLOR_WC);
const TWC_F = clMackFactorSet(TWC_CUM, 'vw');
const TWC_PROJ = clMackProject(TWC_CUM, TWC_F);

/** CL forecast of the incremental cell (k, j), both 0-based, j future. */
function clTwcClForecast(k, j) {
  return TWC_PROJ[k][j] - TWC_PROJ[k][j - 1];
}

defineModule({
  id: 'glm-equals-cl',
  title: 'Taylor: GLM Equals Chain Ladder',
  subtitle: 'The chain ladder is a GLM: marginal sums, cross-classified, cell for cell',
  icon: 'equal',
  level: 'reserving',
  kind: 'exam',
  ord: 10,
  foundations: [
    { module: 'glm-anatomy', text: 'The cross-classified model is a GLM: log link, ODP errors, one parameter per row and column.' },
  ],
  paper: {
    label: 'Taylor & McGuire, "Stochastic Loss Reserving Using GLMs"',
    section: 'Tables 1-1, 3-1 to 3-5; the marginal-sum theorem and its reconciliation; Chs. 1-3',
    task: 'Explain why the ODP cross-classified GLM reproduces the chain ladder exactly',
  },
  intro:
    'The chain ladder looks like arithmetic folklore. Taylor\'s theorem says ' +
    'it is secretly maximum likelihood for an ODP cross-classified GLM: solve ' +
    'the row and column balances and every forecast lands on the chain ' +
    'ladder\'s, cell for cell. That equivalence is the doorway to standard ' +
    'errors, diagnostics, and every model in the rest of the book.',
  params: [
    { key: 'focusAY', tex: 'k', label: 'Accident Year In Focus', min: 2, max: 10, step: 1, init: 9, fmt: 'num', link: 'fit' },
    { key: 'focusDev', tex: 'j', label: 'Forecast Cell Development', min: 2, max: 10, step: 1, init: 3, fmt: 'num', link: 'cell' },
  ],
  derived(par) {
    const k = Math.round(par.focusAY) - 1;
    const obs = TAYLOR_WC[k].length;
    const j = Math.max(obs, Math.min(9, Math.round(par.focusDev) - 1));
    const clCell = clTwcClForecast(k, j);
    const msCell = TWC_MS.alpha[k] * TWC_MS.beta[j];
    let maxRel = 0;
    for (let kk = 1; kk < 10; kk++) {
      for (let jj = TAYLOR_WC[kk].length; jj < 10; jj++) {
        const a = clTwcClForecast(kk, jj);
        const b = TWC_MS.alpha[kk] * TWC_MS.beta[jj];
        maxRel = Math.max(maxRel, Math.abs(a - b) / a);
      }
    }
    let totalReserve = 0;
    for (let kk = 0; kk < 10; kk++) totalReserve += TWC_PROJ[kk][9] - TWC_CUM[kk][TWC_CUM[kk].length - 1];
    return {
      kIdx: k, jIdx: j,
      f1: TWC_F[0],
      alphaK: TWC_MS.alpha[k],
      betaJ: TWC_MS.beta[j],
      latestX: TWC_CUM[k][obs - 1],
      clCell, msCell,
      maxRel,
      totalReserve,
    };
  },
  readouts: [
    { sym: '\\hat{f}_1', id: 'f1', fmt: 'num3', label: 'First Chain-Ladder Factor', link: 'fit' },
    { sym: '\\hat{\\alpha}_k', id: 'alphaK', fmt: 'num', label: 'Row Parameter (= CL Ultimate)', accent: true, link: 'fit' },
    { sym: '\\hat{\\beta}_j', id: 'betaJ', fmt: 'num3', label: 'Column Parameter (= Incremental Share)', link: 'cell' },
    { sym: '', id: 'clCell', fmt: 'num', label: 'Cell Forecast, Chain Ladder', accent: true, link: 'cell' },
    { sym: '', id: 'msCell', fmt: 'num', label: 'Cell Forecast, GLM', accent: true, link: 'cell' },
    { sym: '', id: 'totalReserve', fmt: 'num', label: 'Total Reserve (Table 3-2)', link: 'fit' },
  ],
  formula() {
    return {
      sym: '\\hat{Y}_{kj} = \\hat{X}_{k,j-1}(\\hat{f}_{j-1} - 1) = \\hat{\\alpha}_k\\,\\hat{\\beta}_j',
      terms: [
        { sym: 'CL', fmt: 'num', get: (d) => d.clCell, primary: true, link: 'cell' },
        { op: '=' },
        { sym: '\\hat{\\alpha}_k\\hat{\\beta}_j', fmt: 'num', get: (d) => d.msCell, primary: true, link: 'cell' },
        { op: '|' },
        { sym: 'max\\;gap', fmt: 'pct2', get: (d) => d.maxRel, link: 'fit' },
      ],
    };
  },
  presets: [
    {
      id: 'reconcile',
      label: 'The Paper\'s Cell',
      note: 'Taylor\'s own reconciliation: accident year 1996 has 92,242 paid through development 2; the chain ladder forecasts 24,070 into cell 3, and alpha_1996 x beta_3 = 173,225 x 0.139 = the same 24,070.',
      params: { focusAY: { value: 9 }, focusDev: { value: 3 } },
    },
    {
      id: 'tail-cell',
      label: 'A Deep Tail Cell',
      note: 'Pick the newest year at development 10: two utterly different-looking computations, one number. The theorem holds across the entire future triangle; the max gap readout is the proof run live.',
      params: { focusAY: { value: 10 }, focusDev: { value: 10 } },
    },
  ],
  story: [
    {
      title: 'The question first',
      text: 'The chain ladder looks like folklore: averages of ratios, no model anywhere in sight. Taylor’s theorem says otherwise. Take Level 6’s GLM (log link, ODP errors), give it one dial per accident year and one per development age, and its best fit lands on EXACTLY the chain ladder’s numbers. The folklore was a maximum likelihood estimate all along: nobody had noticed for most of a century. This module lets you verify the identity cell by cell on Taylor’s own triangle, and then shows what the discovery buys: standard errors, diagnostics, and principled extensions for a ritual that never had any.',
      preset: 'reconcile',
    },
    {
      title: 'The folklore algorithm',
      text: 'First, the folklore, run honestly. On Taylor’s workers compensation triangle, compute the volume-weighted development factors exactly as every reserving department does: $\\hat{f}_1 = 1.815$ tapering down to $\\hat{f}_9 = 1.021$: and walk each accident year’s latest diagonal out to ultimate. Total reserve: 373,346. Now audit what you just did with Level 4 eyes: where was the model? No error distribution was named, no likelihood was maximized, no assumption was written down that anyone could test. Just averages of ratios: an algorithm, not a model: which is why the classical chain ladder can produce a NUMBER but cannot, by itself, produce a standard error, a diagnostic, or a defense. It works, demonstrably, on a century of triangles. The question this module answers is WHY it works: and the answer, hiding in plain sight for decades, turns out to dignify the folklore rather than replace it.',
      preset: 'reconcile',
    },
    {
      title: 'Row and column balances',
      text: 'Now build the model the folklore never wrote down. Say each incremental cell is ODP-distributed with mean $\\alpha_k \\beta_j$: a size parameter per accident year times a timing parameter per development age: which is the GLM from Generalized Linear Models with a log link and the crudest possible structure: one dial per row, one per column. Run the MLE machine from Level 4 on it, and something lovely happens: for this model, "maximize the likelihood" collapses to two bookkeeping conditions called marginal sums: each row’s fitted values must add up to that row’s actual total, and each column’s to its column total. Solve those (the module iterates them live) and READ the solution: $\\hat{\\alpha}_k$ comes out equal to the chain-ladder ultimate for year $k$, and $\\hat{\\beta}_j$ equal to the incremental share the factors imply. The averages-of-ratios ritual was, all along, solving a maximum likelihood problem: nobody had said so out loud.',
      preset: 'reconcile',
    },
    {
      title: 'Cell for cell',
      text: 'A theorem this consequential deserves verification you can touch, so the stage runs Taylor’s own spot-check and then lets you run every other one. His printed example is accident year 1996 at development 3. The chain-ladder route: take the year’s cumulative, multiply by the factor, difference out the increment: 24,070. The GLM route: multiply the fitted parameters, $\\hat{\\alpha}_{1996} = 173{,}225$ times $\\hat{\\beta}_3 = 0.139$: also 24,070. Not approximately: identically, and Taylor proves it holds for EVERY future cell, not just this one. Use the two sliders to steer the probe anywhere in the future triangle and watch both routes light up with the same number; the max-gap readout across all cells sits at zero (this module’s checks hold it below a billionth). Two computations that share no steps: one ratios and averages, one likelihood and link functions: forced to agree everywhere by the structure of the model. That agreement is the theorem, and now you have walked on it.',
      preset: 'reconcile',
    },
    {
      title: 'Why you should care',
      text: 'The theorem sounds like trivia: two roads, same number: until you notice what the second road carries. An algorithm produces a number and stops. A MODEL produces a number plus everything models come with: and the chain ladder is now a model. Standard errors: Taylor’s Table 5-1 prints them per accident year, and their shape is worth reading (U-shaped: mature years have little left to be wrong about, young years borrow strength from columns, the middle is exposed: with the tail cells exploding, as this preset shows). Diagnostics: the Pearson-residual machinery from your Level 6 now applies verbatim, so broken assumptions: a calendar-year trend, a changed mix: show up in plots instead of in next year’s surprise. And extensions: Taylor’s later chapters swap distributions, add trends, and generalize structure by editing the MODEL, not by inventing new rituals. Folklore can only be followed or abandoned. Models can be criticized, defended, and improved: which is the entire cultural argument of stochastic reserving, compressed into one equals sign.',
      preset: 'tail-cell',
    },
  ],
  checks: [
    { name: 'f_1 = 1.815 (Table 3-1)', expect: 1.8149, tol: 5e-4, got: () => TWC_F[0] },
    { name: 'f_9 = 1.021 (Table 3-1)', expect: 1.0209, tol: 5e-4, got: () => TWC_F[8] },
    { name: 'Total reserve = 373,346 (Table 3-2)', expect: 373346, tol: 3, got: () => TWC_PROJ.reduce((s, row, i) => s + row[9] - TWC_CUM[i][TWC_CUM[i].length - 1], 0) },
    { name: 'R_1989 = 3,398 (Table 3-2)', expect: 3398, tol: 2, got: () => TWC_PROJ[1][9] - TWC_CUM[1][8] },
    { name: 'X_1996,2 = 92,242', expect: 92242, tol: 0, got: () => TWC_CUM[8][1] },
    { name: 'alpha_1996 = 173,225 (Table 3-3)', expect: 173225, tol: 2, got: () => TWC_MS.alpha[8] },
    { name: 'beta_3 = 0.139 (Table 3-3)', expect: 0.139, tol: 5e-4, got: () => TWC_MS.beta[2] },
    { name: 'The paper\'s cell: CL forecast = 24,070', expect: 24070, tol: 2, got: () => clTwcClForecast(8, 2) },
    { name: 'The paper\'s cell: alpha x beta = 24,070', expect: 24070, tol: 2, got: () => TWC_MS.alpha[8] * TWC_MS.beta[2] },
    {
      name: 'Theorem: CL and marginal-sum forecasts coincide everywhere', expect: 1, tol: 0,
      got: () => {
        for (let k = 1; k < 10; k++) {
          for (let j = TAYLOR_WC[k].length; j < 10; j++) {
            const a = clTwcClForecast(k, j);
            const b = TWC_MS.alpha[k] * TWC_MS.beta[j];
            if (Math.abs(a - b) / a > 1e-9) return 0;
          }
        }
        return 1;
      },
    },
    {
      name: 'Reconciliation (3-3): f_1 from betas = 1.815', expect: 1.8149, tol: 5e-4,
      got: () => (TWC_MS.beta[0] + TWC_MS.beta[1]) / TWC_MS.beta[0],
    },
  ],
});

defineModule({
  id: 'marshall-ladder',
  title: 'Marshall: Risk Margins',
  subtitle: 'Three sources of uncertainty, one consolidated CoV, one defensible margin',
  icon: 'gauge',
  level: 'reserving',
  kind: 'exam',
  ord: 9,
  foundations: [
    { module: 'correlation', text: 'Consolidation is the sum of correlated risks; what ρ does to a total’s spread starts here.' },
  ],
  paper: {
    label: 'Marshall et al., "A Framework For Assessing Risk Margins"',
    section: 'Figure 3 Parts A-F, the Insurer ABC worked example and its sensitivity tests',
    task: 'Assess, correlate, and consolidate sources of uncertainty into a risk margin',
  },
  intro:
    'A risk margin is not a haircut, it is an argument: independent risk that ' +
    'diversifies away, internal systemic risk your own model carries, and ' +
    'external systemic risk the world imposes. Variances add. CoVs do not. ' +
    'The whole framework is that one sentence, applied carefully.',
  params: [
    { key: 'adequacy', tex: '', label: 'Probability Of Adequacy', min: 60, max: 95, step: 1, init: 75, fmt: 'num', link: 'margin' },
    { key: 'sIndep', tex: '', label: 'Independent Risk Scale', min: 0.25, max: 3, step: 0.05, init: 1, fmt: 'num2', link: 'src-ind' },
    { key: 'sInternal', tex: '', label: 'Internal Systemic Scale', min: 0.25, max: 3, step: 0.05, init: 1, fmt: 'num2', link: 'src-int' },
    { key: 'sExternal', tex: '', label: 'External Systemic Scale', min: 0.25, max: 3, step: 0.05, init: 1, fmt: 'num2', link: 'src-ext' },
    { key: 'flex', tex: '', label: 'Push Correlations To Full', min: 0, max: 1, step: 0.01, init: 0, fmt: 'num2', link: 'src-int' },
  ],
  derived(par) {
    const z = clNormInv(par.adequacy / 100);
    const m = clMarshallConsolidate({
      sIndep: par.sIndep, sInternal: par.sInternal, sExternal: par.sExternal,
      flex: par.flex, z,
    });
    return {
      z,
      totIndep: m.totIndep,
      totInternal: m.totInternal,
      totExternal: m.totExternal,
      total: m.total,
      naiveSum: m.totIndep + m.totInternal + m.totExternal,
      rmNormal: m.rmNormal,
      rmLogn: m.rmLogn,
      byClass: m.byClass,
    };
  },
  readouts: [
    { sym: '', id: 'totIndep', fmt: 'pct', label: 'Independent CoV', link: 'src-ind' },
    { sym: '', id: 'totInternal', fmt: 'pct', label: 'Internal Systemic CoV', link: 'src-int' },
    { sym: '', id: 'totExternal', fmt: 'pct', label: 'External Systemic CoV', link: 'src-ext' },
    { sym: '', id: 'total', fmt: 'pct', label: 'Consolidated CoV', accent: true, link: 'margin' },
    { sym: '', id: 'rmLogn', fmt: 'pct2', label: 'Risk Margin (Lognormal)', accent: true, link: 'margin' },
    { sym: '', id: 'rmNormal', fmt: 'pct2', label: 'Risk Margin (Normal)', link: 'margin' },
  ],
  formula() {
    return {
      sym: 'CoV = \\sqrt{ind^2 + int^2 + ext^2},\\quad RM_{LN} = e^{z\\sigma - \\sigma^2/2} - 1,\\;\\sigma^2 = \\ln(1{+}CoV^2)',
      terms: [
        { sym: 'CoV', fmt: 'pct', get: (d) => d.total, link: 'margin' },
        { op: '|' },
        { sym: 'z', fmt: 'num3', get: (d) => d.z, link: 'margin' },
        { op: '|' },
        { sym: 'RM', fmt: 'pct', get: (d) => d.rmLogn, primary: true, link: 'margin' },
      ],
    };
  },
  presets: [
    {
      id: 'base',
      label: 'Insurer ABC Base',
      note: 'The paper\'s worked example end to end: 3.0% independent, 4.9% internal, 6.6% external consolidate to 8.7%, and at 75% adequacy the lognormal margin is 5.6%.',
      params: { adequacy: { value: 75 }, sIndep: { value: 1 }, sInternal: { value: 1 }, sExternal: { value: 1 }, flex: { value: 0 } },
    },
    {
      id: 'double-indep',
      label: 'Double Independent Risk',
      note: 'Doubling the diversifiable risk moves the margin only 5.6% to 6.5% (the paper\'s printed flex). Small squared terms stay small: this is why systemic risk is the assessment that matters.',
      params: { sIndep: { value: 2 }, sInternal: { value: 1 }, sExternal: { value: 1 }, flex: { value: 0 }, adequacy: { value: 75 } },
    },
    {
      id: 'internal-up',
      label: 'Internal Systemic +50%',
      note: 'A worse model score is expensive: 5.6% becomes 6.6%, the largest single flex in the paper\'s sensitivity table. The balanced scorecard earns its keep here.',
      params: { sInternal: { value: 1.5 }, sIndep: { value: 1 }, sExternal: { value: 1 }, flex: { value: 0 }, adequacy: { value: 75 } },
    },
    {
      id: 'full-corr',
      label: 'Full Internal Correlation',
      note: 'Slide every internal correlation to 100% and the margin goes to 6.3% (printed). Correlation assumptions ARE margin assumptions; the framework forces you to write them down.',
      params: { flex: { value: 1 }, sIndep: { value: 1 }, sInternal: { value: 1 }, sExternal: { value: 1 }, adequacy: { value: 75 } },
    },
  ],
  story: [
    {
      title: 'The question first',
      text: 'A whole company’s reserve risk is not one class’s risk times ten: Level 2 showed independent wobbles partially cancel while shared ones refuse to. Marshall industrializes that lesson: sort every source of uncertainty by whether diversification can touch it, and only then add. This module walks the whole assembly line: three kinds of not-knowing, the quadrature step that turns 14.5% of naive risk into 8.7% of measured risk, the correlation assumption that entire discount hangs on, and the final conversion of uncertainty into a statutory margin. It is the ladder’s one module about running a COMPANY rather than a triangle.',
      preset: 'base',
    },
    {
      title: 'Three kinds of not knowing',
      text: 'Marshall’s framework begins with a sorting exercise, and the sorting IS the insight. Take every reason a reserve could be wrong and ask the Correlation & Diversification question: does pooling across classes tame it? INDEPENDENT risk: the random scatter of individual claims: absolutely: it averages away like the ρ = 0 cloud. INTERNAL SYSTEMIC risk does not: if your model’s specification is off, its parameters mis-fitted, its data flawed, then it is wrong the same way for EVERY class it touches: pooling ten classes pools ten copies of the same mistake. EXTERNAL SYSTEMIC risk: inflation, court doctrines, catastrophic events, latent claims: also refuses: one cause moves everything at once. Look at the bars by class on stage: three sources per class, and the framework keeps them in separate columns on principle, because a number formed by blending tamable and untamable risk has already destroyed the information the consolidation step needs. Sort first, add second: never the reverse.',
      preset: 'base',
    },
    {
      title: 'Variances add, CoVs do not',
      text: 'Now the consolidation itself, and the one arithmetic habit that separates it from naive addition. The three sources measure 3.0%, 4.9%, and 6.6% of the reserve. Add them like grocery prices and you would book 14.5%. Marshall consolidates to 8.7%: and the missing six points are not an error, they are diversification, collected. The rule you learned two levels down does all the work: independent-ish uncertainties add in QUADRATURE: square each, sum the squares, take the root ($\\sqrt{3.0^2 + 4.9^2 + 6.6^2} \\approx 8.7$): because their bad days do not coordinate. Watch the strip on stage: the segments stack in variance space, and the consolidated bar comes out visibly shorter than the segments laid end to end. CoVs never add: variances do. It looks like a technicality and is actually the entire financial value of writing a diversified book, computed: hold capital for 8.7, not 14.5, and be exactly as safe.',
      preset: 'base',
    },
    {
      title: 'Correlation is the price',
      text: 'The quadrature discount rests on an assumption someone must defend: that the sources really do act independently ACROSS CLASSES. This preset stress-tests it: push the internal-systemic correlations between classes to full: assume that when your reserving model misleads you on motor, it misleads you the same way on liability, on property, on everything: and watch the internal CoV climb from 4.9% toward 6.7%, dragging the consolidated margin from 5.65% to 6.33%: both figures straight from Marshall’s printed sensitivity table, reproduced live. That seven-tenths of a point is real capital, and it hangs entirely on a correlation matrix that no triangle can estimate for you: model errors do not announce how correlated they are. Hence the framework’s governance lesson, which outlasts its arithmetic: every diversification credit in the consolidation is an ASSUMPTION with money attached, and the assumption, not the quadrature, is what a reviewer should interrogate.',
      preset: 'full-corr',
    },
    {
      title: 'The margin is a percentile',
      text: 'The last step converts the consolidated uncertainty into money, and it is the percentile read from PDF, CDF & Quantiles doing regulatory work. The requirement (Australian practice, where this framework is standard) is a reserve with 75% probability of adequacy: a 75th percentile, by its plain definition. Wrap a lognormal with the consolidated 8.7% CoV around the central estimate: the shape choice you saw Mack agonize over, made statutory here: and read off the margin above the central estimate: 5.65%, matching Marshall’s printed 5.6%. Now slide the adequacy requirement upward and watch prudence get expensive NONLINEARLY: each further point of comfort costs more than the last, because you are climbing into the right tail where the lognormal thins slowly. That convexity is the same percentile-race you felt in Level 1, now with a balance sheet attached: the difference between 75% and 90% adequacy is not fifteen points of margin: it is a different company.',
      preset: 'base',
    },
  ],
  checks: [
    { name: 'Part B independent total = 3.0%', expect: 0.0297, tol: 5e-4, got: () => clMarshallConsolidate().totIndep },
    { name: 'Part B Home class independent = 4.29% (verified formula)', expect: 0.0429, tol: 2e-4, got: () => clCovAggregate(MRSH.w, MRSH.indep, () => 0, [2, 3]) },
    { name: 'Part B CTP class independent = 5.86% (verified formula)', expect: 0.0586, tol: 2e-4, got: () => clCovAggregate(MRSH.w, MRSH.indep, () => 0, [4, 5]) },
    { name: 'Part C internal total = 4.9%', expect: 0.049, tol: 8e-4, got: () => clMarshallConsolidate().totInternal },
    { name: 'Part E consolidated total = 8.7%', expect: 0.087, tol: 1e-3, got: () => clMarshallConsolidate().total },
    { name: 'Part F margin, lognormal = 5.6%', expect: 0.056, tol: 1.5e-3, got: () => clMarshallConsolidate().rmLogn },
    { name: 'Part F margin, normal = 5.8%', expect: 0.058, tol: 1.5e-3, got: () => clMarshallConsolidate().rmNormal },
    { name: 'Printed flex: double independent = 6.5%', expect: 0.065, tol: 1.5e-3, got: () => clMarshallConsolidate({ sIndep: 2 }).rmLogn },
    { name: 'Printed flex: halve independent = 5.4%', expect: 0.054, tol: 1.5e-3, got: () => clMarshallConsolidate({ sIndep: 0.5 }).rmLogn },
    { name: 'Printed flex: internal +50% = 6.6%', expect: 0.066, tol: 1.5e-3, got: () => clMarshallConsolidate({ sInternal: 1.5 }).rmLogn },
    { name: 'Printed flex: full internal correlation = 6.3%', expect: 0.063, tol: 1.5e-3, got: () => clMarshallConsolidate({ flex: 1 }).rmLogn },
  ],
});

// --- Module: The Claim Counter (random variables, LLN) ---------------------

defineModule({
  id: 'random-variable',
  title: 'Random Variables',
  subtitle: 'A random variable is a number attached to chance, and frequency finds probability',
  icon: 'dice-5',
  level: 'probability',
  kind: 'concept',
  ord: 1,
  paper: null,
  bridges: [
    { module: 'process-fan', text: 'Next year’s unpaid losses are a random variable too; reserving is describing its distribution.' },
    { module: 'odp-bootstrap', text: 'The bootstrap answers a reserve question by literally drawing the random variable thousands of times.' },
  ],
  intro:
    'Roll a die forever and the share of sixes settles near 1 in 6. ' +
    'Probability IS that settling number. A random variable is a number that ' +
    'chance has not picked yet, like next year’s claim count. Draw years one ' +
    'at a time and watch the histogram of what HAPPENED climb onto the curve ' +
    'of what was PROBABLE. That convergence is the law of large numbers, and ' +
    'it is the license for everything else in this lab.',
  params: [
    { key: 'lam', tex: '\\lambda', label: 'Expected Claims Per Year', min: 0.5, max: 12, step: 0.1, init: 4, fmt: 'num', link: 'true' },
  ],
  derived(p) {
    return { trueMean: p.lam, trueSd: Math.sqrt(p.lam) };
  },
  readouts: [
    { sym: 'E[X]', id: 'trueMean', fmt: 'num', label: 'True Mean', link: 'true' },
    { sym: '\\sigma', id: 'trueSd', fmt: 'num2', label: 'True SD', link: 'true' },
    { sym: 'n', id: 'drawCount', fmt: 'str', label: 'Years Drawn', link: 'emp' },
    { sym: '\\bar{X}_n', id: 'empMean', fmt: 'num2', label: 'Empirical Mean', accent: true, link: 'emp' },
  ],
  formula() {
    return {
      sym: '\\bar{X}_n \\xrightarrow{\\;n\\to\\infty\\;} E[X]',
      terms: [
        { sym: '\\bar{X}_n', fmt: 'num2', get: (d) => d.empMean, primary: true, link: 'emp' },
        { op: '→' },
        { sym: 'E[X]=\\lambda', fmt: 'num', get: (d) => d.trueMean, link: 'true' },
      ],
    };
  },
  presets: [
    {
      id: 'book',
      label: 'A Working Book',
      note: 'A small book producing about four claims a year. Draw years and watch what happened climb onto what was probable.',
      params: { lam: { value: 4 } },
    },
    {
      id: 'rare',
      label: 'Rare Events',
      note: 'λ = 0.8: most years are quiet and a few are bad. Skew is the default in insurance, not the exception.',
      params: { lam: { value: 0.8 } },
    },
    {
      id: 'busy',
      label: 'A Busy Book',
      note: 'λ = 9: pile up enough independent events and a bell shape starts assembling itself. That is the central limit theorem clearing its throat.',
      params: { lam: { value: 9 } },
    },
  ],
  story: [
    {
      title: 'What probability even means',
      text: 'Start with something you can hold: a die. Roll it once and you learn almost nothing. Roll it ten times and the share of sixes is ragged: maybe none, maybe three. But roll it ten thousand times and the share settles, stubbornly, near 1 in 6. **Probability is that settling number.** It is not a promise about any single roll; it is a fact about the long run. Now swap the die for an insurance book. Next year’s claim count $X$ is a **random variable**: a number chance has not picked yet. We cannot know it, but it has long-run habits just like the die, and the dotted curve on the stage is a portrait of those habits: the taller the curve over a value, the more often the long run visits it. Press **Draw A Year** in the chart header and watch one year stop being a possibility and become a fact.',
      preset: 'book',
    },
    {
      title: 'Commit to a guess',
      text: 'You have made a year or two real. Here is the question almost everyone answers wrong the first time, so answer it before the machine does.',
      predict: {
        prompt: 'Draw ten years. Will the empirical bars sit close to the true curve?',
        options: ['Yes, ten is plenty', 'No, ten years will look ragged'],
        answer: 1,
        explain: 'Ten draws are noise with only a hint of shape: with so few years, one unlucky draw shifts a whole bar by ten percentage points. Probability makes promises about the LONG run and stays silent about short ones. Try it yourself: press Draw A Year ten times and compare the bars against the dotted curve. This is why one bad year proves nothing about a book, and why small datasets are dangerous evidence. That lesson returns with real teeth in Process vs Parameter Risk.',
      },
      preset: 'book',
    },
    {
      title: 'The law of large numbers',
      text: 'Now press **Run** and let hundreds of years pour in, watching two things at once. First the bars: ragged at fifty years, recognizably curve-shaped by five hundred, nearly identical to the dotted curve after a few thousand. Second, the two vertical lines: the solid one is $\\bar{X}_n$, the plain average of every year drawn so far, and the dashed one is $E[X]$, the **expected value**: the number that running average is heading toward, the average after forever. The solid line wanders early, then locks on. This is the **law of large numbers**, and notice how little it actually promises: no single year is ever forced to behave, and bad streaks still happen. Only the AVERAGE is tamed. Insurance is the business of being the long run on purpose: write enough independent risks and your average becomes predictable even though every individual claim stays wild.',
      preset: 'book',
    },
    {
      title: 'Rare events lean right',
      text: 'Drag $\\lambda$ (Expected Claims Per Year) down to 0.8 and press **Run** again. The shape changes character. The tallest bar now sits at zero: the single most likely year is a quiet one. Yet the readout says the mean is 0.8. How can the average sit above the most common outcome? Look at the two sides of that tallest bar. To its left there is nothing, because a year cannot have fewer than zero claims. To its right the values run on: two, three, four, occasionally worse. A floor blocks one side while a tail stretches the other, so the rare bad years drag the average up, to the right of the typical year. That shape has a name, **right-skewed**, and it is the resting state of insurance: losses have a floor at zero and no ceiling, so most years are fine and the average is set by the few that are not.',
      preset: 'rare',
    },
  ],
  checks: [
    { name: 'Poisson mass sums to one at λ=4', expect: 1, tol: 1e-8, got: () => { let s = 0; for (let k = 0; k <= 60; k++) s += clPoissonPmf(k, 4); return s; } },
    { name: 'Poisson mean identity at λ=4', expect: 4, tol: 1e-6, got: () => { let s = 0; for (let k = 0; k <= 60; k++) s += k * clPoissonPmf(k, 4); return s; } },
    { name: 'Poisson variance identity at λ=4', expect: 4, tol: 1e-5, got: () => { let s = 0; for (let k = 0; k <= 60; k++) s += (k - 4) * (k - 4) * clPoissonPmf(k, 4); return s; } },
    {
      name: 'Seeded LLN: 4,000 draws at λ=4 land within 3σ/√n of the mean',
      expect: 4, tol: 3 * 2 / Math.sqrt(4000),
      got: () => {
        const rng = clMulberry32(20260816);
        let s = 0;
        for (let i = 0; i < 4000; i++) s += clRandPoisson(4, rng);
        return s / 4000;
      },
    },
  ],
});

// --- Module: The Balance Point (moments of a distribution) -----------------

const MM_SEVERITY = [
  { x: 0, p: 0.06 }, { x: 1, p: 0.16 }, { x: 2, p: 0.22 }, { x: 3, p: 0.19 },
  { x: 4, p: 0.13 }, { x: 5, p: 0.09 }, { x: 6, p: 0.06 }, { x: 7, p: 0.04 },
  { x: 8, p: 0.025 }, { x: 9, p: 0.015 }, { x: 10, p: 0.01 },
];
const MM_SYMMETRIC = [
  { x: 0, p: 0.02 }, { x: 1, p: 0.07 }, { x: 2, p: 0.16 }, { x: 3, p: 0.25 },
  { x: 4, p: 0.16 }, { x: 5, p: 0.07 }, { x: 6, p: 0.02 }, { x: 7, p: 0 },
  { x: 8, p: 0 }, { x: 9, p: 0 }, { x: 10, p: 0 },
];
const MM_TWO_BOOKS = [
  { x: 0, p: 0.05 }, { x: 1, p: 0.28 }, { x: 2, p: 0.22 }, { x: 3, p: 0.08 },
  { x: 4, p: 0.03 }, { x: 5, p: 0.02 }, { x: 6, p: 0.04 }, { x: 7, p: 0.1 },
  { x: 8, p: 0.11 }, { x: 9, p: 0.05 }, { x: 10, p: 0.02 },
];

function clMeanMachineMoments(masses, a, b) {
  const base = clDiscreteMoments(masses);
  return {
    mean: base.mean, varc: base.varc, sd: base.sd, skew: base.skew,
    tMean: a * base.mean + b,
    tVar: a * a * base.varc,
    tSd: Math.abs(a) * base.sd,
  };
}

defineModule({
  id: 'mean-machine',
  title: 'Mean, Variance & Skewness',
  subtitle: 'Mean, variance, and skewness, held in your hands: drag the probability and feel the moments move',
  icon: 'anchor',
  level: 'probability',
  kind: 'concept',
  ord: 2,
  paper: null,
  bridges: [
    { module: 'mse-valley', text: 'Mean squared error is a variance plus a squared bias; this module is where both words get their meaning.' },
    { module: 'marshall-ladder', text: 'Marshall’s whole ladder is variances adding; a variance is what the bracket above the beam measures.' },
  ],
  intro:
    'A distribution is mass sitting on a beam. The mean is where a fulcrum ' +
    'balances it, the variance is how far the mass spreads from that point, ' +
    'and skewness is which way it leans. Drag the bars and feel the moments ' +
    'respond, then trend every loss and watch the transformation rules fire.',
  params: [
    { key: 'a', tex: 'a', label: 'Trend Factor (Scale)', min: 0.4, max: 2.5, step: 0.05, init: 1, fmt: 'num2', link: 'trans' },
    { key: 'b', tex: 'b', label: 'Fixed Load (Shift)', min: -2, max: 4, step: 0.1, init: 0, fmt: 'num2', link: 'trans' },
  ],
  derived(p, st) {
    const masses = Array.isArray(st?.data) && st.data.length ? st.data : MM_SEVERITY;
    return clMeanMachineMoments(masses, p.a, p.b);
  },
  readouts: [
    { sym: 'E[X]', id: 'mean', fmt: 'num2', label: 'Mean (Balance Point)', link: 'mean' },
    { sym: '\\sigma', id: 'sd', fmt: 'num2', label: 'Standard Deviation', link: 'sd' },
    { sym: '\\gamma_1', id: 'skew', fmt: 'num2', label: 'Skewness', link: 'skew' },
    { sym: 'E[aX{+}b]', id: 'tMean', fmt: 'num2', label: 'Transformed Mean', accent: true, link: 'trans' },
  ],
  formula() {
    return {
      sym: 'E[aX{+}b] = a\\,E[X] + b, \\qquad \\mathrm{SD}[aX{+}b] = |a|\\,\\sigma',
      terms: [
        { sym: 'E[aX{+}b]', fmt: 'num2', get: (d) => d.tMean, primary: true, link: 'trans' },
        { op: '=' },
        { sym: 'a', fmt: 'num2', get: (d) => d.a, link: 'trans' },
        { op: '·' },
        { sym: 'E[X]', fmt: 'num2', get: (d) => d.mean, link: 'mean' },
        { op: '+' },
        { sym: 'b', fmt: 'num2', get: (d) => d.b, link: 'trans' },
        { op: ',' },
        { sym: '\\mathrm{SD}', fmt: 'num2', get: (d) => d.tSd, link: 'sd' },
      ],
    };
  },
  presets: [
    {
      id: 'severity',
      label: 'A Severity Curve',
      note: 'A right-leaning severity shape: lots of small claims, a persistent tail of large ones. Drag any bar to reshape it.',
      data: MM_SEVERITY,
      params: { a: { value: 1 }, b: { value: 0 } },
    },
    {
      id: 'symmetric',
      label: 'A Symmetric Book',
      note: 'Mass piled evenly around the middle: mean, median, and mode agree, and the skewness reads zero.',
      data: MM_SYMMETRIC,
      params: { a: { value: 1 }, b: { value: 0 } },
    },
    {
      id: 'two-books',
      label: 'Two Books In One',
      note: 'Attritional claims on the left, a second hill of large losses on the right. The mean balances in the valley where almost nothing actually happens.',
      data: MM_TWO_BOOKS,
      params: { a: { value: 1 }, b: { value: 0 } },
    },
    {
      id: 'inflation',
      label: 'Trend It 50%',
      note: 'a = 1.5: every loss grows by half. The mean grows by half, the SD grows by half, the variance grows by 2.25.',
      data: MM_SEVERITY,
      params: { a: { value: 1.5 }, b: { value: 0 } },
    },
  ],
  story: [
    {
      title: 'Mass on a beam',
      text: 'This is the last module’s idea with YOU in control of the chances. Each bar is probability sitting at a loss size: the bar over 2 is the chance a claim costs about 2, and together the bars hold 100% of the chance. Think of them as sandbags on a beam. The **mean** $E[X]$ is where a fulcrum would balance that beam: each bag pulls with its weight times its distance. Try it physically: drag the tall bar near 2 even taller and watch the fulcrum slide toward it; then drag up a small bar far to the right and watch the fulcrum chase it. Notice what the mean is NOT: not the middle of the picture, not the most common value. It is the balance point of chance, and it can sit at a value where almost no individual outcome ever lands.',
      preset: 'severity',
    },
    {
      title: 'Commit to a guess',
      text: 'The balance point obeys a lever law, and levers care about distance. Before you drag anything, commit to a prediction.',
      predict: {
        prompt: 'Pile more mass far to the right without touching the left. The mean moves…',
        options: ['A lot: distance multiplies mass', 'A little: it is only one bar', 'Not at all'],
        answer: 0,
        explain: 'The mean weights every outcome by its distance from the balance point, exactly the way a child sitting far out on a seesaw outweighs one near the middle. A small probability far to the right has leverage out of proportion to its size. Test it: raise the bar at 10 by a sliver and watch the fulcrum jump. This is why a thin tail of large losses can dominate a book’s average even when 95% of claims are small, and why "the typical claim" and "the average claim" are different numbers that answer different questions.',
      },
      preset: 'two-books',
    },
    {
      title: 'Spread is variance',
      text: 'Balance is only half a distribution’s story: two books can balance at the same point and still be entirely different animals. Apply this preset and look at the bracket above the beam: it spans $E[X] \\pm \\sigma$, one **standard deviation** either side of the mean. Now grab the outer bars and drag them taller. The fulcrum barely moves, because the shape stays balanced, but the bracket widens: you are feeding **variance**, the average SQUARED distance of the mass from the balance point. The squaring is a deliberate design choice with a consequence you can feel: twice as far counts four times as much, so one bar far out widens $\\sigma$ more than several bars near the middle. Read $\\sigma$ as the answer to "how wrong is a typical outcome?", in the same units as the losses themselves. Reserve ranges exist because this number is not zero.',
      preset: 'symmetric',
    },
    {
      title: 'Losses lean right',
      text: 'Bring back the severity shape and read three readouts together: the mean, the SD, and the **skewness** $\\gamma_1$. Skewness asks a simple question: is the mass arranged symmetrically around the balance point, or does one side stretch farther than the other? A positive value means a long RIGHT tail: lots of small claims and a few painful ones. Look at where the fulcrum sits: to the right of the tallest bar, dragged there by the tail, exactly like the quiet-book average in the previous module. Now try to build a LEFT-leaning book by piling mass far left: you can do it here, but the insurance world almost never does it to you, because losses stop at zero on one side and have no ceiling on the other. That single asymmetry, floor but no ceiling, is why nearly every distribution on this exam leans right, and why the mean so often sits above the typical outcome.',
      preset: 'severity',
    },
    {
      title: 'Trend the whole book',
      text: 'One last tool, used silently inside half the exam’s formulas: transforming every loss at once. The sliders $a$ and $b$ turn each loss $X$ into $Y = aX + b$: read $a$ as a trend factor (inflation multiplies every claim) and $b$ as a fixed load added on top. The outlined shape is the transformed book.',
      predict: {
        prompt: 'Trend every loss up 50% (a = 1.5). What happens to the standard deviation?',
        options: ['Rises 50%', 'Rises 125%', 'Unchanged: trend shifts, it does not spread'],
        answer: 0,
        explain: 'The SD is measured in the same units as the losses, so trending every loss by 1.5 scales σ by exactly 1.5. VARIANCE is squared distance, so it scales by 1.5² = 2.25: half again the trend, squared. And the fixed load b slides the whole beam sideways: it moves the mean, and adds no spread at all, so σ ignores it completely. Watch the outlined distribution confirm all three at once as you drag. These small rules, E[aX+b] = aE[X] + b and SD[aX+b] = |a|σ, are the reason trending and on-leveling in reserve work move means and spreads differently.',
      },
      preset: 'inflation',
    },
  ],
  checks: [
    { name: 'Symmetric masses: mean = 2 for p ∝ [1,2,3,2,1] on 0..4', expect: 2, tol: 1e-12, got: () => clDiscreteMoments([{ x: 0, p: 1 }, { x: 1, p: 2 }, { x: 2, p: 3 }, { x: 3, p: 2 }, { x: 4, p: 1 }]).mean },
    { name: 'Symmetric masses: variance = 4/3', expect: 4 / 3, tol: 1e-12, got: () => clDiscreteMoments([{ x: 0, p: 1 }, { x: 1, p: 2 }, { x: 2, p: 3 }, { x: 3, p: 2 }, { x: 4, p: 1 }]).varc },
    { name: 'Symmetric masses: skewness = 0', expect: 0, tol: 1e-12, got: () => clDiscreteMoments([{ x: 0, p: 1 }, { x: 1, p: 2 }, { x: 2, p: 3 }, { x: 3, p: 2 }, { x: 4, p: 1 }]).skew },
    { name: 'Renormalization: doubling every p leaves the mean alone', expect: 0, tol: 1e-12, got: () => clDiscreteMoments(MM_SEVERITY.map((m) => ({ x: m.x, p: 2 * m.p }))).mean - clDiscreteMoments(MM_SEVERITY).mean },
    { name: 'Transform: E[1.5X+2] = 1.5·E[X]+2', expect: 0, tol: 1e-12, got: () => { const m = clMeanMachineMoments(MM_SEVERITY, 1.5, 2); return m.tMean - (1.5 * m.mean + 2); } },
    { name: 'Transform: Var(1.5X+2) = 2.25·Var(X)', expect: 0, tol: 1e-12, got: () => { const m = clMeanMachineMoments(MM_SEVERITY, 1.5, 2); return m.tVar - 2.25 * m.varc; } },
    { name: 'The severity shape leans right (skew > 0)', expect: 1, tol: 0, got: () => (clDiscreteMoments(MM_SEVERITY).skew > 0 ? 1 : 0) },
  ],
});

// --- Module: One Distribution, Three Views (PDF / CDF / quantile) ----------

defineModule({
  id: 'distribution-anatomy',
  title: 'PDF, CDF & Quantiles',
  subtitle: 'Density, cumulative probability, and quantile are the same object read three ways',
  icon: 'area-chart',
  level: 'probability',
  kind: 'concept',
  ord: 3,
  paper: null,
  bridges: [
    { module: 'validation-machine', text: 'Meyers scores a model by evaluating F at the actual outcome; a percentile is this module’s read, run in reverse.' },
    { module: 'mack-machinery', text: 'Mack’s quoted reserve range is a lognormal quantile read exactly like the one you drag here.' },
  ],
  intro:
    'The density says where probability is dense. The CDF says how much lies ' +
    'below each point. The quantile function reads the CDF backward: hand it ' +
    'a probability, get back a loss. One object, three views, and every ' +
    '"75th percentile reserve" you will ever quote is the third view.',
  params: [
    { key: 'M', tex: 'E[X]', label: 'Mean Loss', min: 2, max: 40, step: 0.5, init: 10, fmt: 'num', link: 'skew' },
    { key: 'cv', tex: 'cv', label: 'Coefficient Of Variation', min: 0.15, max: 1.5, step: 0.01, init: 0.5, fmt: 'num2', link: 'skew' },
    { key: 'q', tex: 'q', label: 'Probability Level', min: 0.01, max: 0.99, step: 0.01, init: 0.75, fmt: 'pct', link: 'q' },
    { key: 'bins', tex: 'k', label: 'Number Of Buckets', min: 4, max: 80, step: 1, init: 16, fmt: 'num', link: 'bars', modes: ['bars'] },
  ],
  derived(p) {
    const { mu, sigma } = clMatchLognormal(p.M, p.M * p.cv);
    const xq = clLognInv(p.q, mu, sigma);
    // The fullest bucket's probability: watching it shrink as buckets thin
    // is the "no exact value has a chance, only ranges do" lesson.
    const xEnd = clLognInv(0.995, mu, sigma);
    const k = Math.max(1, Math.round(p.bins || 16));
    let maxBucket = 0;
    for (let i = 0; i < k; i++) {
      const a = (i / k) * xEnd, b = ((i + 1) / k) * xEnd;
      maxBucket = Math.max(maxBucket, clLognCdf(b, mu, sigma) - clLognCdf(a, mu, sigma));
    }
    return {
      mu, sigma, xq,
      median: Math.exp(mu),
      meanOverMedian: Math.exp(sigma * sigma / 2),
      tail: 1 - p.q,
      maxBucket,
    };
  },
  readouts: [
    { sym: 'x_q', id: 'xq', fmt: 'num', label: 'Quantile (Loss At q)', accent: true, link: 'xq' },
    { sym: '\\tilde{x}', id: 'median', fmt: 'num', label: 'Median', link: 'median' },
    { sym: 'E[X]/\\tilde{x}', id: 'meanOverMedian', fmt: 'num2', label: 'Mean Over Median', link: 'skew' },
    { sym: 'P(X{>}x_q)', id: 'tail', fmt: 'pct', label: 'Tail Beyond x_q', link: 'q' },
  ],
  formula(state) {
    if (state.mode === 'bars') {
      return {
        sym: '\\text{area of bucket } i = P(X \\in \\text{bucket}_i), \\qquad \\textstyle\\sum_i P_i = 1',
        terms: [
          { sym: 'k', fmt: 'num', get: (d) => d.bins, primary: true, link: 'bars' },
          { op: ',' },
          { sym: 'P_{\\max}', fmt: 'pct', get: (d) => d.maxBucket, link: 'bars' },
        ],
      };
    }
    return {
      sym: 'F(x_q) = q \\;\\Longleftrightarrow\\; x_q = F^{-1}(q)',
      terms: [
        { sym: 'x_q', fmt: 'num', get: (d) => d.xq, primary: true, link: 'xq' },
        { op: '=' },
        { sym: 'F^{-1}(q)', fmt: 'pct', get: (d) => d.q, link: 'q' },
        { op: ',' },
        { sym: '\\tilde{x}', fmt: 'num', get: (d) => d.median, link: 'median' },
        { op: ',' },
        { sym: 'E[X]/\\tilde{x}', fmt: 'num2', get: (d) => d.meanOverMedian, link: 'skew' },
      ],
    };
  },
  presets: [
    {
      id: 'buckets',
      label: 'Buckets First',
      note: 'Chop the possible losses into buckets: each bar’s AREA is the chance of landing in that bucket. Slide Number Of Buckets up and the staircase melts into the smooth curve.',
      mode: 'bars',
      params: { M: { value: 10 }, cv: { value: 0.5 }, q: { value: 0.75 }, bins: { value: 16 } },
    },
    {
      id: 'range',
      label: 'The 75th Percentile Reserve',
      note: 'A book with mean 10 and cv 0.5, read at q = 75%. The loss that 75% of outcomes stay under: this is what a quoted reserve range IS.',
      params: { M: { value: 10 }, cv: { value: 0.5 }, q: { value: 0.75 } },
    },
    {
      id: 'heavy',
      label: 'A Heavy Tail',
      note: 'cv = 1.2: the mean climbs to 1.6 times the median because the long right tail drags the average. Read q = 95% and feel how far out it lives.',
      params: { M: { value: 10 }, cv: { value: 1.2 }, q: { value: 0.95 } },
    },
    {
      id: 'tight',
      label: 'A Predictable Book',
      note: 'cv = 0.2: density, CDF, and quantile all agree that nothing interesting happens far from the mean. Skew nearly vanishes.',
      params: { M: { value: 10 }, cv: { value: 0.2 }, q: { value: 0.5 } },
    },
  ],
  story: [
    {
      title: 'From buckets to a curve',
      text: 'The claim counts you drew earlier were whole numbers, so every value could own its own bar. A LOSS is different: it can land at 3.7, or 3.71, or 3.70588. No exact value can own a bar, because the chance of hitting any EXACT value is zero. So we do the honest thing instead: chop the possibilities into buckets. On the left panel, each bar is one bucket, and the bar’s AREA (width times height) is the chance of landing inside it; the areas together make 100%. Now slide **Number Of Buckets** slowly from 4 up to 80 and watch two things at once: the $P_{max}$ readout (the fullest bucket’s chance) sliding toward zero, and the staircase melting into a smooth curve. That limiting curve is the **probability density function**. Its height alone means nothing on its own. AREA under it is the only thing that ever means probability. Hold onto that: it is the most misread idea in all of statistics.',
      preset: 'buckets',
    },
    {
      title: 'Three questions, one object',
      text: 'The smooth curve you just built can only speak through areas, and there are three ways to ask it a question. The left panel, the **density**, answers "where is the chance concentrated?": the shaded region from zero to the marker holds exactly $q$ of the probability. The right panel is the same information added up as you sweep left to right: the **CDF** $F(x)$ climbs from 0% to 100%, and its height at any $x$ says how much chance lies at or below $x$. And reading the right panel BACKWARD (pick a height $q$ on the axis, walk right until you hit the curve, drop straight down) answers the third question: which loss $x_q$ has exactly $q$ of the chance below it? Drag on either panel and watch all three answers move in lockstep: one object, three views. A surprising number of exam questions are secretly just asking which of the three views you are standing in.',
      preset: 'range',
    },
    {
      title: 'Commit to a guess',
      text: 'This book leans right, like nearly everything in insurance. Two "centers" are marked on the density: the dashed **median** (half the outcomes below it, half above) and the dashed **mean** (the balance point from the beam module). Before looking closely, commit.',
      predict: {
        prompt: 'For a right-skewed loss distribution, where does the mean sit relative to the median?',
        options: ['Above the median', 'Below the median', 'They coincide'],
        answer: 0,
        explain: 'The median only counts HOW MANY outcomes sit on each side of it, so the long tail cannot move it: a huge loss and a merely large loss both count as "one outcome above". The mean weights by DISTANCE, so the tail drags it up. For a lognormal the gap is exact and the readout tracks it live: mean over median = exp(σ²/2), which reaches 1.6 at cv = 1.2. Practical habit to build now: whenever a skewed quantity is reported as one number, ask which center it is. "Average income" and "median income" tell different stories for exactly this reason, and so do reserve estimates.',
      },
      preset: 'heavy',
    },
    {
      title: 'Reading a percentile',
      text: 'Now make the backward read do real work. Set $q$ to 75% and read $x_q$ in the readouts: that loss level is the **75th percentile**, the number that outcomes stay under three times out of four. Watch both panels agree as you drag $q$: the shaded area under the density grows to 75% of the total, while on the CDF the read-line walks up to height 75% and drops at the same $x_q$. This is literally what "a reserve at the 75th percentile" means in practice: a number chosen so that, IF the model is right, there is only a one-in-four chance the true cost ends up beyond it. Now slide $q$ from 75% up to 95% and watch how far $x_q$ has to travel: on a skewed curve the last twenty points of safety are far more expensive than the first seventy-five. Prudence has a price curve, and it is convex.',
      preset: 'range',
    },
    {
      title: 'Why the exam cares',
      text: 'One more read, and it is the one an entire exam paper is built on. So far you handed the machine a probability $q$ and received a loss $x_q$. Run it the other way: take a loss that ACTUALLY happened, evaluate $F$ at it, and out comes the outcome’s percentile under the model. Here is the quietly powerful fact: if the model is telling the truth about the world, those percentiles carry no pattern at all. Real outcomes should land at the 12th, the 67th, the 3rd, the 88th: evenly spread, like raindrops on pavement. If they instead pile up near 0 and 100, the model’s tails were too thin. If they crowd the middle, too fat. If they slide to one side, the model was biased. You will meet this exact machine again in Meyers: Model Validation, where it sits in judgment over the industry’s standard reserving models: and now you know where its gears came from.',
      preset: 'heavy',
    },
  ],
  checks: [
    { name: 'Round trip: F(F⁻¹(0.75)) = 0.75 at mean 10, cv 0.5', expect: 0.75, tol: 1e-6, got: () => { const { mu, sigma } = clMatchLognormal(10, 5); return clLognCdf(clLognInv(0.75, mu, sigma), mu, sigma); } },
    { name: 'Median is the 50% quantile: F⁻¹(0.5) = exp(μ)', expect: 0, tol: 1e-9, got: () => { const { mu, sigma } = clMatchLognormal(10, 5); return clLognInv(0.5, mu, sigma) - Math.exp(mu); } },
    { name: 'Skew identity: mean/median = exp(σ²/2)', expect: 0, tol: 1e-9, got: () => { const { mu, sigma } = clMatchLognormal(10, 5); return 10 / Math.exp(mu) - Math.exp(sigma * sigma / 2); } },
    {
      name: 'The shaded area integrates to q (trapezoid check at q = 0.75)',
      expect: 0.75, tol: 2e-3,
      got: () => {
        const { mu, sigma } = clMatchLognormal(10, 5);
        const xq = clLognInv(0.75, mu, sigma);
        let area = 0;
        const nSteps = 2000, dx = xq / nSteps;
        for (let i = 0; i < nSteps; i++) {
          area += 0.5 * (clLognPdf(i * dx, mu, sigma) + clLognPdf((i + 1) * dx, mu, sigma)) * dx;
        }
        return area;
      },
    },
    { name: 'A heavier cv pushes the 95th percentile out', expect: 1, tol: 0, got: () => { const a = clMatchLognormal(10, 5), b = clMatchLognormal(10, 12); return clLognInv(0.95, b.mu, b.sigma) > clLognInv(0.95, a.mu, a.sigma) ? 1 : 0; } },
    {
      name: 'Buckets melt into the density: bar heights approach f(x) as k grows',
      expect: 1, tol: 0,
      got: () => {
        const { mu, sigma } = clMatchLognormal(10, 5);
        const xEnd = clLognInv(0.995, mu, sigma);
        const gap = (k) => {
          let worst = 0;
          for (let i = 0; i < k; i++) {
            const a = (i / k) * xEnd, b = ((i + 1) / k) * xEnd;
            const h = (clLognCdf(b, mu, sigma) - clLognCdf(a, mu, sigma)) / (b - a);
            worst = Math.max(worst, Math.abs(h - clLognPdf((a + b) / 2, mu, sigma)));
          }
          return worst;
        };
        return gap(64) < gap(8) ? 1 : 0;
      },
    },
    {
      name: 'Thinner buckets each hold less: P_max falls from k=8 to k=64',
      expect: 1, tol: 0,
      got: () => {
        const { mu, sigma } = clMatchLognormal(10, 5);
        const xEnd = clLognInv(0.995, mu, sigma);
        const pMax = (k) => {
          let m = 0;
          for (let i = 0; i < k; i++) {
            const a = (i / k) * xEnd, b = ((i + 1) / k) * xEnd;
            m = Math.max(m, clLognCdf(b, mu, sigma) - clLognCdf(a, mu, sigma));
          }
          return m;
        };
        return pMax(64) < pMax(8) ? 1 : 0;
      },
    },
  ],
});

// --- Module: Adding Up Claims (compound sums, CLT and its limits) ----------

/** Compound Poisson-lognormal skewness: λE[X³] / (λE[X²])^{3/2}. */
function clCompoundSkew(lambda, sevMean, sevCv) {
  const g = 1 + sevCv * sevCv;
  const m2 = sevMean * sevMean * g;
  const m3 = sevMean * sevMean * sevMean * g * g * g;
  return (lambda * m3) / Math.pow(lambda * m2, 1.5);
}

const SUMS_SEV_MEAN = 10;

defineModule({
  id: 'sums-clt',
  title: 'Aggregate Losses & The CLT',
  subtitle: 'A year of losses is a sum of random pieces: when the bell shape arrives, and when it lies',
  icon: 'sigma',
  level: 'behavior',
  kind: 'concept',
  ord: 1,
  paper: null,
  foundations: [
    { module: 'random-variable', text: 'The claim count driving the sum is the Poisson machine from the Random Variables module.' },
    { module: 'mean-machine', text: 'Severity’s second moment, not its mean, is what drives the total’s variance.' },
  ],
  bridges: [
    { module: 'glm-anatomy', text: 'A compound Poisson sum with gamma pieces IS the Tweedie family: the guts of the ODP variance function.' },
    { module: 'mack-machinery', text: 'Mack’s quoted range assumes the reserve is lognormal-ish; this module shows when sums earn a shape like that.' },
  ],
  intro:
    'An accident year’s total is S = X₁ + … + X_N: a random NUMBER of random ' +
    'PIECES. Its mean is boring (λ times average severity). Its variance is ' +
    'not: it rides on the second moment, so severity volatility hurts more ' +
    'than frequency volatility. And the bell curve everyone assumes shows up ' +
    'only when the pieces are many and tame.',
  params: [
    { key: 'lam', tex: '\\lambda', label: 'Claims Per Year', min: 1, max: 40, step: 0.5, init: 8, fmt: 'num', link: 'freq' },
    { key: 'cv', tex: 'cv_X', label: 'Severity Volatility (cv)', min: 0.1, max: 2, step: 0.05, init: 0.5, fmt: 'num2', link: 'sev' },
  ],
  derived(p) {
    const m = clCompoundMoments(p.lam, SUMS_SEV_MEAN, p.cv);
    return {
      aggMean: m.mean,
      aggSd: m.sd,
      aggSkew: clCompoundSkew(p.lam, SUMS_SEV_MEAN, p.cv),
      normP95: m.mean + 1.6449 * m.sd,
    };
  },
  readouts: [
    { sym: 'E[S]', id: 'aggMean', fmt: 'num', label: 'Expected Total', link: 'freq' },
    { sym: '\\sigma_S', id: 'aggSd', fmt: 'num', label: 'SD Of The Total', link: 'sev' },
    { sym: '\\gamma_1', id: 'aggSkew', fmt: 'num2', label: 'Skewness Of The Total', link: 'agg' },
    { sym: 'P(S{>}q_{95}^{N})', id: 'tailExceed', fmt: 'pct', label: 'Beyond The Normal 95th', accent: true, link: 'tail' },
  ],
  formula() {
    return {
      sym: 'E[S] = \\lambda\\,E[X], \\qquad \\mathrm{Var}(S) = \\lambda\\,E[X^2]',
      terms: [
        { sym: 'E[S]', fmt: 'num', get: (d) => d.aggMean, primary: true, link: 'freq' },
        { op: '=' },
        { sym: '\\lambda', fmt: 'num', get: (d) => d.lam, link: 'freq' },
        { op: '·' },
        { sym: 'E[X]', fmt: 'num', get: () => SUMS_SEV_MEAN, link: 'sev' },
        { op: ',' },
        { sym: '\\sigma_S', fmt: 'num', get: (d) => d.aggSd, link: 'sev' },
      ],
    };
  },
  presets: [
    {
      id: 'calm',
      label: 'Many Tame Claims',
      note: 'λ = 20 with mild severity: the central limit theorem earns its keep and the normal overlay hugs the histogram. About 5% of years land beyond the normal 95th.',
      params: { lam: { value: 20 }, cv: { value: 0.3 } },
    },
    {
      id: 'stormy',
      label: 'Few Violent Claims',
      note: 'λ = 4 with cv = 1.5: one large claim IS the year. The histogram leans hard right and the normal overlay quietly understates the tail you actually live in.',
      params: { lam: { value: 4 }, cv: { value: 1.5 } },
    },
    {
      id: 'huge',
      label: 'A Large Portfolio',
      note: 'λ = 40: even with meaningful severity spread, aggregation grinds the skew down like 1/√λ. Size is a real diversifier.',
      params: { lam: { value: 40 }, cv: { value: 0.5 } },
    },
  ],
  story: [
    {
      title: 'A random number of random pieces',
      text: 'A year’s total loss stacks two layers of chance you have already met separately. HOW MANY claims arrive is the Poisson counter from Random Variables. HOW BIG each one is comes from a lognormal severity: the curve in the left panel. Written down: $S = X_1 + X_2 + \\dots + X_N$, where even the NUMBER of terms is random. The right panel runs the experiment live: each simulated year draws a count, draws that many sizes, adds them up, and files the total into the histogram. Watch a few hundred years accumulate. The center of the pile is the easy part, and it is exactly what intuition says: $E[S] = \\lambda \\times E[X]$: expected count times expected size, eight claims averaging ten gives eighty. The SHAPE of the pile is the interesting part: how wide, and how lopsided. The next steps take those one at a time.',
      preset: 'calm',
    },
    {
      title: 'Variance rides the SECOND moment',
      text: 'Apply this preset: the expected total barely changes, but the claims themselves are now violent (severity cv of 1.5 means a single claim’s own spread is one and a half times its mean). Watch the histogram flatten and stretch rightward. The formula names the culprit precisely: $\\mathrm{Var}(S) = \\lambda\\,E[X^2]$, where $E[X^2]$ is the average of the SQUARED claim sizes. Squaring is the beam module’s lever again: a claim ten times the average size contributes a HUNDRED times its share to the variance. Now compare two ways of doubling risk: doubling the claim COUNT doubles the variance, but doubling severity’s spread multiplies $E[X^2]$ far faster. Severity volatility hurts more than frequency volatility, always. This is why a book’s risk lives in its large-claim tail rather than its claim count, and why excess layers and reinsurance are priced off the top of the severity curve, not the middle.',
      preset: 'stormy',
    },
    {
      title: 'Commit to a guess',
      text: 'The dashed overlay is a normal curve given the SAME mean and SAME standard deviation as the true total, and the dashed vertical marker is ITS 95th percentile: where the normal says only one year in twenty should land beyond. Commit before counting.',
      predict: {
        prompt: 'With few, violent claims (λ = 4, cv = 1.5), how many years actually land beyond the normal 95th percentile marker?',
        options: ['More than 5%: the true tail is fatter', 'Exactly 5%: that is what a percentile means', 'Less than 5%'],
        answer: 0,
        explain: 'A percentile is only as honest as the SHAPE it was computed from. The normal is symmetric, so its 95th percentile silently assumes the bad side mirrors the good side. This total leans hard right instead, so more probability lives beyond the marker than the normal admits: the accent readout keeps the true count, and it runs well above 5%. Matching mean and SD is not enough; the moments agree and the tail still lies. Every reserve range built by wrapping a normal around a skewed total runs thin in exactly this way, which is why the exam papers go to such lengths to get whole DISTRIBUTIONS, not just two moments.',
      },
      preset: 'stormy',
    },
    {
      title: 'The bell earns its keep slowly',
      text: 'Now the good news, with its price tag attached. Push $\\lambda$ up to 40 and let the years pour in: the histogram gathers itself together, the lean softens, and the normal overlay starts fitting like it belongs. This is the **central limit theorem**: add enough independent pieces, none of them dominant, and the total’s shape drifts toward the bell REGARDLESS of the pieces’ own shape. But watch the skewness readout while you slide $\\lambda$: it decays like $1/\\sqrt{\\lambda}$. Four times the claims buys only HALF the lean: the square root is the fine print. So the CLT is real but slow, and the professional skill is knowing which side of it you stand on: a large personal-lines book can lean on the bell; a small book, a reinsurance layer, or any total that one claim can dominate, cannot. When in doubt, this module is the test bench: set your book’s numbers and look.',
      preset: 'huge',
    },
  ],
  checks: [
    { name: 'E[S] = λ·E[X] at λ=8, mean 10', expect: 80, tol: 1e-9, got: () => clCompoundMoments(8, 10, 0.5).mean },
    { name: 'Var(S) = λ·E[X²]: 8·100·1.25 = 1000', expect: 1000, tol: 1e-9, got: () => clCompoundMoments(8, 10, 0.5).varc },
    { name: 'Seeded sim mean lands within 2% of theory (λ=8, cv=0.5)', expect: 1, tol: 0, got: () => { const dr = clCompoundSim({ lambda: 8, sevMean: 10, sevCv: 0.5, n: 8000, seed: 12 }); const m = dr.reduce((a, b) => a + b, 0) / dr.length; return Math.abs(m - 80) / 80 < 0.02 ? 1 : 0; } },
    { name: 'Skewness decays with portfolio size: γ(40) < γ(4)', expect: 1, tol: 0, got: () => (clCompoundSkew(40, 10, 0.5) < clCompoundSkew(4, 10, 0.5) ? 1 : 0) },
    {
      name: 'Heavy severity beats the normal 95th more than 5% of the time (seeded)',
      expect: 1, tol: 0,
      got: () => {
        const dr = clCompoundSim({ lambda: 4, sevMean: 10, sevCv: 1.5, n: 8000, seed: 12 });
        const m = clCompoundMoments(4, 10, 1.5);
        const q = m.mean + 1.6449 * m.sd;
        const frac = dr.filter((x) => x > q).length / dr.length;
        return frac > 0.05 ? 1 : 0;
      },
    },
  ],
});

// --- Module: The Best Guess (conditional expectation) ----------------------

// A stable teaching world: reported at 12 months vs ultimate, in $M.
const CE_PAR = { muX: 10, muY: 20, sdX: 2, sdY: 5 };

defineModule({
  id: 'conditional-expectation',
  title: 'Conditional Expectation',
  subtitle: 'E[Y|X]: what knowing something buys you, drawn as a slice through the cloud',
  icon: 'scatter-chart',
  level: 'behavior',
  kind: 'concept',
  ord: 2,
  paper: null,
  foundations: [
    { module: 'mean-machine', text: 'A conditional mean is still a balance point, computed on the slice you are standing in.' },
    { module: 'distribution-anatomy', text: 'The slice itself is an ordinary distribution with its own density and quantiles.' },
  ],
  bridges: [
    { module: 'brosius-line', text: 'Brosius’ development formula IS this line: E[ultimate | reported], approximated by least squares.' },
    { module: 'mse-valley', text: 'The best-guess property (conditional mean minimizes squared error) is why the valley bottoms where it does.' },
  ],
  intro:
    'You know this year reported x. What is your best guess for its ' +
    'ultimate? Slice the cloud at x, look at what is left, and take ITS ' +
    'mean. Trace that answer across every x and you have drawn E[Y|X]: the ' +
    'regression line, the engine under every development method.',
  params: [
    { key: 'rho', tex: '\\rho', label: 'Correlation (Reported, Ultimate)', min: 0, max: 0.95, step: 0.01, init: 0.7, fmt: 'num2', link: 'line' },
    { key: 'x', tex: 'x', label: 'Reported Losses (The Slice)', min: 4, max: 16, step: 0.1, init: 12, fmt: 'num', link: 'slice' },
  ],
  derived(p) {
    const cond = clBivarCond({ ...CE_PAR, rho: p.rho }, p.x);
    return {
      condMean: cond.mean,
      condSd: cond.sd,
      slope: p.rho * (CE_PAR.sdY / CE_PAR.sdX),
      r2: p.rho * p.rho,
    };
  },
  readouts: [
    { sym: 'E[Y|X{=}x]', id: 'condMean', fmt: 'num', label: 'Best Guess At The Slice', accent: true, link: 'slice' },
    { sym: '\\mathrm{SD}[Y|X{=}x]', id: 'condSd', fmt: 'num2', label: 'What Remains Unknown', link: 'band' },
    { sym: 'b', id: 'slope', fmt: 'num2', label: 'Regression Slope', link: 'line' },
    { sym: 'R^2', id: 'r2', fmt: 'pct', label: 'Variance Explained', link: 'line' },
  ],
  formula() {
    return {
      sym: 'E[Y|X{=}x] = \\mu_Y + \\rho\\,\\tfrac{\\sigma_Y}{\\sigma_X}(x - \\mu_X)',
      terms: [
        { sym: 'E[Y|X{=}x]', fmt: 'num', get: (d) => d.condMean, primary: true, link: 'slice' },
        { op: '=' },
        { sym: '\\mu_Y', fmt: 'num', get: () => CE_PAR.muY, link: 'flat' },
        { op: '+' },
        { sym: '\\rho\\,\\sigma_Y/\\sigma_X', fmt: 'num2', get: (d) => d.slope, link: 'line' },
        { op: '·' },
        { sym: '(x-\\mu_X)', fmt: 'num2', get: (d) => d.x - CE_PAR.muX, link: 'slice' },
      ],
    };
  },
  presets: [
    {
      id: 'strong',
      label: 'A Telling Report',
      note: 'ρ = 0.9: the slice is tight and the report carries real news. The best-guess line leans steeply and little stays unknown.',
      params: { rho: { value: 0.9 }, x: { value: 12 } },
    },
    {
      id: 'moderate',
      label: 'A Noisy Report',
      note: 'ρ = 0.6: the report helps but the slice stays wide. The line splits the difference between the data and the overall mean.',
      params: { rho: { value: 0.6 }, x: { value: 12 } },
    },
    {
      id: 'useless',
      label: 'An Uninformative Report',
      note: 'ρ = 0: slice anywhere you like, what remains is the SAME distribution. Best guess: μ_Y, flat. That is budgeted loss, derived rather than assumed.',
      params: { rho: { value: 0 }, x: { value: 12 } },
    },
  ],
  story: [
    {
      title: 'Slice the cloud',
      text: 'Every dot in this cloud is one accident year from history, plotted by two numbers: how much it had reported at twelve months (across) and where its ultimate finally landed (up). Now put yourself in the middle of a live year. You know one thing: it has reported $x$. What is your best guess for its ultimate? Drag the vertical slice to your $x$ and look at what it cuts out of the cloud: only the years that reported roughly what yours has. Their ultimates still vary (that is the violin shape drawn along the slice) but they vary around a center, and that center is the honest answer. Statisticians write it $E[Y|X{=}x]$, read "the expected ultimate GIVEN reported $x$", and it is nothing more exotic than the beam module’s balance point, computed only over the slice you are standing in. Conditioning = throwing away the part of history that no longer matches what you know.',
      preset: 'moderate',
    },
    {
      title: 'Commit to a guess',
      text: 'The ρ slider controls how strongly reported and ultimate move together across years: at high ρ, years that report big finish big. Before touching it, commit to what the extreme means.',
      predict: {
        prompt: 'Set ρ = 0. What does the best-guess line do?',
        options: ['Goes flat at μ_Y: the report buys nothing', 'Still slopes: reported losses always matter', 'Becomes vertical'],
        answer: 0,
        explain: 'Drag ρ to zero and watch: the cloud rounds into a blob, and the slice cuts out the SAME violin wherever you stand. Knowing x now changes nothing about Y, so the best guess is the overall mean μ_Y at every x: the line goes flat. And notice what you just discovered about an exam method: "budgeted loss", which ignores reported losses entirely, is not lazy: it is the CORRECT best guess in a world where the report is uninformative (a brand-new line, a law change that severed history). Methods are beliefs about worlds. The skill the exam actually tests is matching the method to the world you are in.',
      },
      preset: 'useless',
    },
    {
      title: 'What conditioning cannot remove',
      text: 'Push ρ up to 0.9 and watch two different things happen. The line steepens: the report now carries real news, so your guess should move a lot per unit of surprise. And the violin narrows: less is left unexplained once you know $x$. But look closely: it never closes. The leftover spread is $\\mathrm{SD}[Y|X{=}x] = \\sigma_Y\\sqrt{1-\\rho^2}$, and the square root is crueler than intuition expects: even at ρ = 0.9, the residual spread is $\\sqrt{1 - 0.81}$, still 44% of the original. Information reduces uncertainty; it does not abolish it. The part no amount of knowing-x can remove is the same irreducible process risk you will meet formally in Process vs Parameter Risk, and it sets the floor under every reserve range: a perfect model of a random world is still facing a random world.',
      preset: 'strong',
    },
    {
      title: 'The line under every method',
      text: 'Slide the slice across the whole cloud and imagine marking every violin’s center: the marks fall on a straight line with slope $\\rho\\,\\sigma_Y/\\sigma_X$: the **regression line**. Read the slope as a recipe: for each unit your report surprises you, move the ultimate guess by this many units. Now the exam payoff, and it is a big one. Brosius’ least-squares development (top rung of this ladder) is literally this line, estimated from a company’s own history. And the classical methods turn out to be this same line with parts pinned by ASSUMPTION instead of data: chain ladder forces it through the origin, budgeted loss forces it flat, Bornhuetter-Ferguson fixes the slope at one. When an exam question asks "which method is appropriate?", it is really asking "what do you believe about this line?": and now you can picture the answer instead of reciting it.',
      preset: 'moderate',
    },
  ],
  checks: [
    { name: 'ρ = 0 makes the best guess flat at μ_Y', expect: CE_PAR.muY, tol: 1e-12, got: () => clBivarCond({ ...CE_PAR, rho: 0 }, 15).mean },
    { name: 'Slope identity: ρσ_Y/σ_X at ρ = 0.7', expect: 0.7 * (CE_PAR.sdY / CE_PAR.sdX), tol: 1e-12, got: () => (clBivarCond({ ...CE_PAR, rho: 0.7 }, CE_PAR.muX + 1).mean - CE_PAR.muY) },
    { name: 'Conditional SD: σ_Y√(1−ρ²) at ρ = 0.8', expect: CE_PAR.sdY * 0.6, tol: 1e-12, got: () => clBivarCond({ ...CE_PAR, rho: 0.8 }, 12).sd },
    {
      name: 'Seeded cloud: empirical regression slope matches ρσ_Y/σ_X within 5%',
      expect: 1, tol: 0,
      got: () => {
        const pts = clBivarCloud({ ...CE_PAR, rho: 0.7 }, 20000, 9);
        const fit = clFitLeastSquares(pts.map((p) => [p.x, p.y]));
        const target = 0.7 * (CE_PAR.sdY / CE_PAR.sdX);
        return Math.abs(fit.b - target) / target < 0.05 ? 1 : 0;
      },
    },
    {
      name: 'Law of total expectation: E[E[Y|X]] = μ_Y on the seeded cloud',
      expect: 1, tol: 0,
      got: () => {
        const pts = clBivarCloud({ ...CE_PAR, rho: 0.7 }, 20000, 9);
        const m = pts.reduce((a, p) => a + p.y, 0) / pts.length;
        return Math.abs(m - CE_PAR.muY) < 0.15 ? 1 : 0;
      },
    },
  ],
});

// --- Module: When Risks Move Together (correlation and totals) -------------

defineModule({
  id: 'correlation',
  title: 'Correlation & Diversification',
  subtitle: 'ρ and the total: why diversification is real, and why systemic risk eats it',
  icon: 'link-2',
  level: 'behavior',
  kind: 'concept',
  ord: 3,
  paper: null,
  foundations: [
    { module: 'mean-machine', text: 'Variance is the object doing the adding here; the beam is where it got its meaning.' },
    { module: 'conditional-expectation', text: 'ρ is the same dial that set the best-guess slope, now pointed at two lines of business.' },
  ],
  bridges: [
    { module: 'marshall-ladder', text: 'Marshall’s consolidation is this module run at portfolio scale: independent sources diversify, internal systemic sources refuse to.' },
    { module: 'meyers-arc', text: 'Meyers’ CCL model exists because accident years move together; ρ is what fattens the reserve distribution’s tails.' },
  ],
  intro:
    'Two lines of business each wobble. Does the TOTAL wobble like their sum ' +
    'or less? The answer is one formula with ρ inside it: independence buys ' +
    'a Pythagorean discount, perfect correlation refuses to give one, and ' +
    'everything an aggregator cares about lives between those poles.',
  params: [
    { key: 'rho', tex: '\\rho', label: 'Correlation Between Lines', min: -0.5, max: 1, step: 0.01, init: 0.3, fmt: 'num2', link: 'sum' },
    { key: 's1', tex: '\\sigma_A', label: 'SD Of Line A', min: 1, max: 10, step: 0.1, init: 4, fmt: 'num', link: 'a' },
    { key: 's2', tex: '\\sigma_B', label: 'SD Of Line B', min: 1, max: 10, step: 0.1, init: 3, fmt: 'num', link: 'b' },
  ],
  derived(p) {
    const sdSum = clSumSd(p.s1, p.s2, p.rho);
    const indep = clSumSd(p.s1, p.s2, 0);
    return {
      sdSum,
      sdIndep: indep,
      sdPerfect: p.s1 + p.s2,
      benefit: 1 - sdSum / (p.s1 + p.s2),
    };
  },
  readouts: [
    { sym: '\\sigma_{A+B}', id: 'sdSum', fmt: 'num2', label: 'SD Of The Total', accent: true, link: 'sum' },
    { sym: '\\sigma_{\\perp}', id: 'sdIndep', fmt: 'num2', label: 'If Independent', link: 'indep' },
    { sym: '\\sigma_A{+}\\sigma_B', id: 'sdPerfect', fmt: 'num2', label: 'If In Lockstep', link: 'lockstep' },
    { sym: '1{-}\\tfrac{\\sigma_{A+B}}{\\sigma_A+\\sigma_B}', id: 'benefit', fmt: 'pct', label: 'Diversification Benefit', link: 'sum' },
  ],
  formula() {
    return {
      sym: '\\sigma_{A+B}^2 = \\sigma_A^2 + \\sigma_B^2 + 2\\rho\\,\\sigma_A\\sigma_B',
      terms: [
        { sym: '\\sigma_{A+B}', fmt: 'num2', get: (d) => d.sdSum, primary: true, link: 'sum' },
        { op: '←' },
        { sym: '\\sigma_A', fmt: 'num', get: (d) => d.s1, link: 'a' },
        { op: ',' },
        { sym: '\\sigma_B', fmt: 'num', get: (d) => d.s2, link: 'b' },
        { op: ',' },
        { sym: '\\rho', fmt: 'num2', get: (d) => d.rho, link: 'sum' },
      ],
    };
  },
  presets: [
    {
      id: 'independent',
      label: 'Independent Lines',
      note: 'ρ = 0: variances add, SDs do not. σ of 4 and 3 make 5, not 7. That missing 2 is the entire economic case for writing more than one line.',
      params: { rho: { value: 0 }, s1: { value: 4 }, s2: { value: 3 } },
    },
    {
      id: 'systemic',
      label: 'A Systemic Driver',
      note: 'ρ = 0.8: inflation, a court decision, a catastrophe: one cause moves both lines, the cloud stretches onto a line, and the diversification benefit quietly evaporates.',
      params: { rho: { value: 0.8 }, s1: { value: 4 }, s2: { value: 3 } },
    },
    {
      id: 'hedge',
      label: 'A Natural Hedge',
      note: 'ρ = −0.4: when one line runs bad the other tends to run good, and the total is steadier than either alone. Rare in insurance, precious when found.',
      params: { rho: { value: -0.4 }, s1: { value: 4 }, s2: { value: 3 } },
    },
  ],
  story: [
    {
      title: 'Two lines, one total',
      text: 'You run two lines of business. Each dot is one year of history: line A’s result across, line B’s up. The question that matters to whoever owns BOTH: how much does the total bounce around? Start at ρ = 0, meaning the lines are **independent**: knowing A had a bad year tells you nothing about B. The cloud is a round blob, and look at the bars on the right: the total’s spread reads 5 when the pieces are 4 and 3. Less than 4 + 3: because in many years, one line’s bad luck lands on the other’s good luck and partially cancels. Now drag ρ upward and narrate what you see: the blob stretches onto a diagonal line (the years stop disagreeing), the cancellation dries up, and the total’s bar grows toward 7. That gap between 5 and 7, and who gets to keep it, is the entire subject of this module.',
      preset: 'independent',
    },
    {
      title: 'Commit to a guess',
      text: 'Line A wobbles with σ = 4, line B with σ = 3. Before the machine answers, commit to the arithmetic of the extreme case.',
      predict: {
        prompt: 'If the two lines move in perfect lockstep (ρ = 1), the SD of the total is…',
        options: ['7: SDs simply add', '5: variances add like Pythagoras', 'Somewhere below 5'],
        answer: 0,
        explain: 'At ρ = 1 the two lines are one risk wearing two names: every bad year for A is a bad year for B, no offsetting ever happens, and spreads simply add: 4 + 3 = 7. Independence is what buys the discount: there, VARIANCES add (16 + 9 = 25) and the SD is the square root, 5. Yes, that is the Pythagorean theorem, running an insurance company: independent risks meet at right angles. And the 2-unit gap between 7 and 5 is not a metaphor: it is capital you did not have to hold, the entire economic argument for writing more than one line of business.',
      },
      preset: 'systemic',
    },
    {
      title: 'The benefit and its thief',
      text: 'The Diversification Benefit readout measures the share of lockstep risk that pooling forgives: $1 - \\sigma_{A+B}/(\\sigma_A{+}\\sigma_B)$. Play with all three sliders and learn its habits. It is largest when the lines are independent AND similar in size; it shrinks when one line dwarfs the other (a giant has nothing meaningful to cancel against); and it dies entirely as ρ climbs to 1. Then ask the practical question: what would make ρ rise in real life? The answers are uncomfortable: inflation, a court doctrine, a catastrophe season, one shared reinsurer failing: causes that hit EVERY line at once. Those are exactly the risks pooling cannot touch. Independent bad luck is cheap to carry in bulk; shared bad luck costs full price no matter how many lines you write. Reading a risk means asking which kind it is before asking how big it is.',
      preset: 'systemic',
    },
    {
      title: 'Where the exam runs this',
      text: 'Two exam papers are this module at industrial scale, and you can now read both on sight. Marshall’s risk-margin framework asks of every source of uncertainty exactly the question you just learned: can pooling touch it? Independent sources get added the Pythagorean way (squares first, the ρ = 0 discount); systemic sources are added nearly straight, full price. His whole consolidation ladder is bookkeeping for that one distinction. Meyers made the same discovery INSIDE a single triangle: accident years share calendar-year weather, so they are correlated with each other: and a model that assumes they are independent (Mack’s does) understates the total reserve’s spread just like the ρ = 0 bar understates the ρ = 0.45 truth. His CCL model exists to add that missing ρ. One formula: $\\sigma^2 = \\sigma_1^2 + \\sigma_2^2 + 2\\rho\\sigma_1\\sigma_2$: priced at company scale, twice.',
      preset: 'independent',
    },
  ],
  checks: [
    { name: 'Independence is Pythagoras: σ(4,3,ρ=0) = 5', expect: 5, tol: 1e-12, got: () => clSumSd(4, 3, 0) },
    { name: 'Lockstep adds SDs: σ(4,3,ρ=1) = 7', expect: 7, tol: 1e-12, got: () => clSumSd(4, 3, 1) },
    { name: 'Perfect hedge cancels: σ(4,3,ρ=−1) = 1', expect: 1, tol: 1e-12, got: () => clSumSd(4, 3, -1) },
    { name: 'Diversification benefit vanishes at ρ = 1', expect: 0, tol: 1e-12, got: () => 1 - clSumSd(4, 3, 1) / 7 },
    { name: 'σ of the total rises monotonically in ρ', expect: 1, tol: 0, got: () => { let prev = -1, ok = 1; for (let r = -0.5; r <= 1.001; r += 0.1) { const s = clSumSd(4, 3, r); if (s <= prev) ok = 0; prev = s; } return ok; } },
    {
      name: 'Seeded cloud correlation tracks the ρ dial within 0.03',
      expect: 1, tol: 0,
      got: () => {
        const pts = clBivarCloud({ muX: 0, muY: 0, sdX: 4, sdY: 3, rho: 0.6 }, 20000, 21);
        let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
        for (const p of pts) { sx += p.x; sy += p.y; sxx += p.x * p.x; syy += p.y * p.y; sxy += p.x * p.y; }
        const n = pts.length;
        const r = (sxy / n - (sx / n) * (sy / n)) / Math.sqrt((sxx / n - (sx / n) ** 2) * (syy / n - (sy / n) ** 2));
        return Math.abs(r - 0.6) < 0.03 ? 1 : 0;
      },
    },
  ],
});

// --- Module: The Fan Of Futures (development as a stochastic process) ------

// A stable teaching world: a loglogistic payment pattern over ten ages,
// normalized so the expected age-10 cumulative is exactly the ultimate.
const PF = { omega: 1.4, theta: 3.4, ages: 10, ult: 100 };

function clDevG(age) {
  if (age <= 0) return 0;
  return clClarkG(age, { family: 'loglogistic', omega: PF.omega, theta: PF.theta });
}

function clDevExpected(k) {
  return (PF.ult * clDevG(k)) / clDevG(PF.ages);
}

/** Age-to-age factors and their product from age k to the horizon. */
function clDevProdF(k) {
  return clDevG(PF.ages) / clDevG(k);
}

/**
 * Simulate the fan: multiplicative development with mean-one lognormal
 * noise at every step, so E[C_{k+1} | C_k] = f_k · C_k holds EXACTLY —
 * Mack's first assumption is built into the world, then observed.
 * Conditional paths are simulated at cObs = 1 and scaled at render time
 * (the model is multiplicative, so scaling is exact, and dragging the
 * observed point costs nothing).
 */
function clDevPaths({ sigma, kObs, nVis, nSim, seed }) {
  const rng = clMulberry32(seed);
  const adj = -sigma * sigma / 2;
  const stepNoise = () => Math.exp(adj + sigma * clRandNormal(rng));
  const expected = [];
  for (let a = 0; a <= PF.ages; a++) expected.push(clDevExpected(a));

  const visUncond = [];
  for (let i = 0; i < nVis; i++) {
    const path = [0];
    let level = expected[1] * stepNoise();
    path.push(level);
    for (let a = 1; a < PF.ages; a++) {
      level *= (expected[a + 1] / expected[a]) * stepNoise();
      path.push(level);
    }
    visUncond.push(path);
  }

  // Conditional paths at cObs = 1: start from expected[kObs] exactly.
  const visCond = [];
  for (let i = 0; i < nVis; i++) {
    const path = [expected[kObs]];
    let level = expected[kObs];
    for (let a = kObs; a < PF.ages; a++) {
      level *= (expected[a + 1] / expected[a]) * stepNoise();
      path.push(level);
    }
    visCond.push(path);
  }

  const endpoints = [];
  for (let i = 0; i < nSim; i++) {
    let level = expected[kObs];
    for (let a = kObs; a < PF.ages; a++) {
      level *= (expected[a + 1] / expected[a]) * stepNoise();
    }
    endpoints.push(level);
  }

  // A deterministic observed history: one simulated path rescaled to pass
  // through expected[kObs] at kObs, so cObs multiplies it cleanly.
  let hist = [];
  if (visUncond.length) {
    hist = visUncond[0].slice(0, kObs + 1);
    const scale = expected[kObs] / hist[kObs];
    for (let i = 0; i < hist.length; i++) hist[i] *= scale;
  }

  return { expected, visUncond, visCond, endpoints, hist };
}

defineModule({
  id: 'process-fan',
  title: 'Loss Development As A Process',
  subtitle: 'A loss process is a path; reserving is describing the fan of paths still possible',
  icon: 'waves',
  level: 'processes',
  kind: 'concept',
  ord: 1,
  paper: null,
  foundations: [
    { module: 'random-variable', text: 'Each age’s cumulative is a random variable; a process is those variables holding hands through time.' },
    { module: 'conditional-expectation', text: 'Conditioning on the observed past is the best-guess machine, applied to a whole path at once.' },
  ],
  bridges: [
    { module: 'mack-machinery', text: 'Mack computes this fan’s width in closed form; his three assumptions are statements about this picture.' },
    { module: 'clark-curves', text: 'The fan’s spine is Clark’s growth curve G(x), fit to real triangles by maximum likelihood.' },
    { module: 'odp-bootstrap', text: 'Shapland redraws this fan from resampled residuals instead of assumed noise.' },
  ],
  intro:
    'One accident year, growing toward its ultimate. Before it starts, every ' +
    'gray path is a possible life for it. Then you OBSERVE it up to today, ' +
    'and the fan collapses to the futures consistent with what you saw. The ' +
    'distribution of where those paths land is the reserve. This picture is ' +
    'the entire reserving problem; the exam papers are ways of drawing it.',
  params: [
    { key: 'sigma', tex: '\\sigma', label: 'Process Noise Per Step', min: 0.03, max: 0.3, step: 0.005, init: 0.12, fmt: 'num2', link: 'fan' },
    { key: 'k', tex: 'k', label: 'Today (Age Observed To)', min: 1, max: 9, step: 1, init: 4, fmt: 'num', link: 'today' },
    { key: 'cObs', tex: 'C_k/E[C_k]', label: 'How The Year Is Running', min: 0.6, max: 1.5, step: 0.01, init: 1, fmt: 'num2', link: 'today' },
  ],
  derived(p) {
    const Ek = clDevExpected(p.k);
    const obsC = p.cObs * Ek;
    const prodF = clDevProdF(p.k);
    const ultCl = obsC * prodF;
    return {
      obsC,
      prodF,
      ultCl,
      reserve: ultCl - obsC,
      cvEnd: Math.sqrt(Math.exp((PF.ages - p.k) * p.sigma * p.sigma) - 1),
    };
  },
  readouts: [
    { sym: 'C_k', id: 'obsC', fmt: 'num', label: 'Observed To Date', link: 'today' },
    { sym: '\\hat{U}', id: 'ultCl', fmt: 'num', label: 'Ultimate (Chain Ladder)', accent: true, link: 'ult' },
    { sym: 'R', id: 'reserve', fmt: 'num', label: 'Reserve (The Unwritten Part)', link: 'ult' },
    { sym: 'cv', id: 'cvEnd', fmt: 'pct', label: 'Fan Width At The End', link: 'fan' },
  ],
  formula() {
    return {
      sym: 'E[C_{10}\\,|\\,C_k] = C_k \\cdot \\textstyle\\prod_{j\\ge k} f_j',
      terms: [
        { sym: '\\hat{U}', fmt: 'num', get: (d) => d.ultCl, primary: true, link: 'ult' },
        { op: '=' },
        { sym: 'C_k', fmt: 'num', get: (d) => d.obsC, link: 'today' },
        { op: '·' },
        { sym: '\\prod f_j', fmt: 'num2', get: (d) => d.prodF, link: 'fan' },
      ],
    };
  },
  presets: [
    {
      id: 'young',
      label: 'A Young Year',
      note: 'Observed to age 2: most of the year’s story is unwritten and the conditional fan is nearly as wide as the unconditional one. Immature years are where reserving is hard.',
      params: { sigma: { value: 0.12 }, k: { value: 2 }, cObs: { value: 1 } },
    },
    {
      id: 'mature',
      label: 'A Mature Year',
      note: 'Observed to age 7: the fan has collapsed to a narrow brush. Maturity, not cleverness, is what shrinks reserve risk.',
      params: { sigma: { value: 0.12 }, k: { value: 7 }, cObs: { value: 1 } },
    },
    {
      id: 'running-hot',
      label: 'Running 30% Hot',
      note: 'The observed point sits 30% above expected, and the WHOLE conditional fan scales up with it. That proportionality is Mack’s first assumption, which is chain ladder.',
      params: { sigma: { value: 0.12 }, k: { value: 4 }, cObs: { value: 1.3 } },
    },
    {
      id: 'volatile',
      label: 'A Volatile Line',
      note: 'σ = 0.25: same pattern, same maturity, far wider fan. Two books can share a best estimate and disagree enormously about the distribution around it.',
      params: { sigma: { value: 0.25 }, k: { value: 4 }, cObs: { value: 1 } },
    },
  ],
  story: [
    {
      title: 'A path through time',
      text: 'First, the words. An **accident year** is the batch of claims that happened in one year; they get paid out slowly over the following decade. The running total paid so far traces a path, and the path’s final height is the **ultimate**: what the year truly cost. Every gray path is a possible life of this year, drawn from the same pattern and the same noise; the dashed spine is the average pattern $E[C_a]$. Nothing has been observed yet; everything is still possible.',
      preset: 'young',
    },
    {
      title: 'Commit to a guess',
      text: 'The vertical line marked "today" is how much of this year’s story has been written; everything right of it is still chance. Before you drag it, commit.',
      predict: {
        prompt: 'Move today from age 2 to age 7. What happens to the fan of remaining futures?',
        options: ['It narrows: less of the story is left to happen', 'Unchanged: the future is always the future', 'It widens: more history means more ways to differ'],
        answer: 0,
        explain: 'Every remaining development step contributes its own fresh noise, so the fan’s width is built entirely from the steps still AHEAD of today: the formula in the readouts, cv² = exp((10−k)σ²) − 1, falls as k rises. Drag today rightward and watch chance resolve into fact, step by step. At age 2 nearly everything is unwritten and the conditional fan is almost as wide as the gray one; by age 7 it is a narrow brush. This is why young accident years dominate reserve risk, why long-tailed lines (where reaching maturity takes decades) are the hard ones, and why maturity beats cleverness as a risk reducer, every time.',
      },
      preset: 'mature',
    },
    {
      title: 'Conditioning is the whole game',
      text: 'Be precise about what the accent fan IS, because the whole subject lives in this distinction. It is not "the future" in general: it is the futures CONSISTENT with the path you have already watched: the gray lives that passed through today’s observed point, continued forward. Evidence has ruled everything else out. That is the slice-the-cloud move from Conditional Expectation, applied to an entire path at once, and it is the exact definition of the reserving problem: GIVEN the observed past, describe the distribution of the unpaid remainder. The histogram forming on the right margin is that distribution made visible: its center is the best estimate, its spread is the risk, its percentiles are the range you would quote. Every reserving method in existence is an algorithm for drawing this one histogram. Drag today’s line back and forth and watch evidence eat the fan; that eating is what an actuary’s year of new data actually does.',
      preset: 'young',
    },
    {
      title: 'Mack’s first assumption, watched',
      text: 'Now drag the observed dot itself: pull it 30% above the dashed spine, as if this year had been running hot from the start. Watch what the ENTIRE conditional fan does: it scales up by 30%. Every path, proportionally. Nothing bends back toward average, nothing accelerates: the future simply carries today’s level forward by the same growth factors. That proportionality is a statement about how the world works, written $E[C_{k+1}|C_k] = f_k\\,C_k$: "however high you are today, expect to GROW by the usual factor": and it is Mack’s first assumption, which is to say it IS the chain ladder. This simulated world obeys it by construction. A real triangle only CLAIMS it, and the claim can fail: hot years might instead revert toward normal (then Bornhuetter-Ferguson beats chain ladder) or keep deteriorating (then neither is enough). An enormous amount of methodology rides on which way this one drag behaves in your data.',
      preset: 'running-hot',
    },
    {
      title: 'Four ways to draw one fan',
      text: 'Apply the volatile preset and study what changed: same spine, same best estimate, twice the fan. Two books can agree on the NUMBER and disagree completely about the risk around it: which is why "the reserve is 80" is not a full answer, and why the rest of this ladder exists. Here is your map of the exam’s top level, and it is one sentence per paper: everyone is drawing THIS fan, by different means. Mack writes its width in a closed formula: two terms, process and estimation, the split you met one level up. Clark fits the fan’s SPINE (the payout curve) by maximum likelihood. Shapland rebuilds the whole fan empirically, by resampling the model’s own residuals into thousands of alternate histories. And Meyers samples it from a Bayesian posterior: then, in his best contribution, audits everyone’s fans against 200 real outcomes to see whose were honest. Keep this picture. Every module upstairs is a caption to it.',
      preset: 'volatile',
    },
  ],
  checks: [
    { name: 'The pattern is increasing and lands at the ultimate', expect: 100, tol: 1e-9, got: () => clDevExpected(PF.ages) },
    { name: 'Factors multiply telescopically: ∏f from k = G(10)/G(k)', expect: 0, tol: 1e-12, got: () => { let prod = 1; for (let a = 4; a < PF.ages; a++) prod *= clDevG(a + 1) / clDevG(a); return prod - clDevProdF(4); } },
    {
      name: 'Conditioning IS chain ladder: seeded endpoint mean within 1.5% of C_k·∏f',
      expect: 1, tol: 0,
      got: () => {
        const sim = clDevPaths({ sigma: 0.12, kObs: 4, nVis: 0, nSim: 6000, seed: 33 });
        const mean = sim.endpoints.reduce((a, b) => a + b, 0) / sim.endpoints.length;
        const target = clDevExpected(4) * clDevProdF(4);
        return Math.abs(mean - target) / target < 0.015 ? 1 : 0;
      },
    },
    {
      name: 'Endpoint cv matches √(exp((10−k)σ²)−1) within 10% relative (seeded)',
      expect: 1, tol: 0,
      got: () => {
        const sim = clDevPaths({ sigma: 0.12, kObs: 4, nVis: 0, nSim: 6000, seed: 33 });
        const n = sim.endpoints.length;
        const mean = sim.endpoints.reduce((a, b) => a + b, 0) / n;
        const varc = sim.endpoints.reduce((a, b) => a + (b - mean) * (b - mean), 0) / n;
        const cv = Math.sqrt(varc) / mean;
        const target = Math.sqrt(Math.exp(6 * 0.12 * 0.12) - 1);
        return Math.abs(cv - target) / target < 0.1 ? 1 : 0;
      },
    },
    { name: 'The fan narrows with age: cv(k=7) < cv(k=2)', expect: 1, tol: 0, got: () => (Math.sqrt(Math.exp(3 * 0.0144) - 1) < Math.sqrt(Math.exp(8 * 0.0144) - 1) ? 1 : 0) },
  ],
});

// --- Module: Let The Data Vote (likelihood and MLE) ------------------------

// Twelve observed losses ($k), right-skewed the way losses actually are.
const LS_DATA = [3.1, 4.6, 5.2, 6.0, 7.4, 8.1, 9.5, 11.2, 13.0, 16.4, 21.7, 34.5];
const LS_MLE = clLognMle(LS_DATA);

defineModule({
  id: 'likelihood-surface',
  title: 'Maximum Likelihood Estimation',
  subtitle: 'Likelihood scores every candidate distribution by how loudly the data votes for it',
  icon: 'target',
  level: 'estimation',
  kind: 'concept',
  ord: 1,
  paper: null,
  foundations: [
    { module: 'distribution-anatomy', text: 'A vote is a density height; reading densities starts there.' },
    { module: 'random-variable', text: 'The data being scored is a batch of draws from the machine built there.' },
  ],
  bridges: [
    { module: 'clark-curves', text: 'Clark picks ω and θ by running exactly this machine over every cell of a triangle.' },
    { module: 'prior-posterior', text: 'Multiply this likelihood by a prior and normalize: that is the whole of Bayes.' },
  ],
  intro:
    'Twelve losses are on the table. Every candidate (μ, σ) proposes a ' +
    'density, and each observed loss votes: the height of the density at ' +
    'that loss. The log-likelihood adds the log-votes. Slide the candidate ' +
    'around, watch the votes trade off, then climb the surface to the ' +
    'parameters the data actually elects.',
  params: [
    { key: 'mu', tex: '\\mu', label: 'Candidate Log-Mean', min: 1.5, max: 3, step: 0.005, init: 2.65, fmt: 'num2', link: 'cand' },
    { key: 'sigma', tex: '\\sigma', label: 'Candidate Log-SD', min: 0.2, max: 1.4, step: 0.005, init: 1.05, fmt: 'num2', link: 'cand' },
  ],
  derived(p) {
    const ll = clLognLoglik(LS_DATA, p.mu, p.sigma);
    const llMax = clLognLoglik(LS_DATA, LS_MLE.mu, LS_MLE.sigma);
    return {
      ll,
      llMax,
      gap: llMax - ll,
      mleMu: LS_MLE.mu,
      mleSigma: LS_MLE.sigma,
    };
  },
  readouts: [
    { sym: '\\ell(\\mu,\\sigma)', id: 'll', fmt: 'num2', label: 'Log-Likelihood', accent: true, link: 'cand' },
    { sym: '\\ell_{max}', id: 'llMax', fmt: 'num2', label: 'At The MLE', link: 'mle' },
    { sym: '\\hat{\\mu}', id: 'mleMu', fmt: 'num2', label: 'MLE Log-Mean', link: 'mle' },
    { sym: '\\hat{\\sigma}', id: 'mleSigma', fmt: 'num2', label: 'MLE Log-SD', link: 'mle' },
  ],
  formula() {
    return {
      sym: '\\ell(\\mu,\\sigma) = \\textstyle\\sum_i \\log f(x_i;\\,\\mu,\\sigma)',
      terms: [
        { sym: '\\ell', fmt: 'num2', get: (d) => d.ll, primary: true, link: 'cand' },
        { op: '≤' },
        { sym: '\\ell_{max}', fmt: 'num2', get: (d) => d.llMax, link: 'mle' },
        { op: ',' },
        { sym: '\\Delta', fmt: 'num2', get: (d) => d.gap, link: 'cand' },
      ],
    };
  },
  presets: [
    {
      id: 'guess',
      label: 'Someone’s First Guess',
      note: 'A candidate that is too high and too wide. The small losses vote loudly against it; the surface says how loudly.',
      params: { mu: { value: 2.65 }, sigma: { value: 1.05 } },
    },
    {
      id: 'mle',
      label: 'The Data’s Choice',
      note: 'The maximum likelihood estimate. For a lognormal the peak has a closed form: μ̂ is the mean of the logs, σ̂ their RMS spread. No search required, but the surface shows why searching would have found it.',
      params: { mu: { value: Math.round(LS_MLE.mu * 200) / 200 }, sigma: { value: Math.round(LS_MLE.sigma * 200) / 200 } },
    },
    {
      id: 'thin',
      label: 'Too Sure Of Itself',
      note: 'σ far below the data’s spread: the central losses vote hard for it and the tails veto it. One 34.5 outvotes nine well-fit points; that is what a product of votes does.',
      params: { mu: { value: 2.24 }, sigma: { value: 0.3 } },
    },
  ],
  story: [
    {
      title: 'Each point votes',
      text: 'Twelve real losses sit on the axis, from 3.1 up to a nasty 34.5. Your job: find the lognormal curve that best describes the machine that produced them. The two sliders are your hands on the candidate: $\\mu$ slides it, $\\sigma$ widens it. But what does "best" MEAN? Here is the likelihood answer. Let every observed loss vote on your candidate: its vote is the height of the candidate’s density AT that loss (the thin bars). A tall bar says "a curve like this produces losses like me all the time"; a bar near zero says "under this curve I basically never happen". The total score multiplies the votes together: equivalently, adds their logarithms: that is $\\ell$ in the readouts: so a single near-zero vote can veto an otherwise popular candidate. Now slide $\\mu$ back and forth and watch the votes trade: helping the tail claims hurts the middle ones. Fitting a distribution is a negotiation among your data points, and $\\ell$ is the negotiator’s scorecard.',
      preset: 'guess',
    },
    {
      title: 'Commit to a guess',
      text: 'A tempting instinct: when unsure, be vague: stretch σ wide so the curve "covers" every loss and no point can veto you. Commit to what the scorecard will say.',
      predict: {
        prompt: 'Push σ very wide so the density covers every loss. The log-likelihood…',
        options: ['Falls: covering everything thinly loses to concentrating where data is', 'Rises: a wide net catches every vote', 'Stays flat once every point is covered'],
        answer: 0,
        explain: 'A density has a fixed budget: its total area must be one, so width ANYWHERE is height taken from EVERYWHERE. Stretch σ and every single vote shrinks: you covered all the points and impressed none of them. Now try the opposite sin with the preset: σ far too small makes the middle points vote loudly while the 34.5 casts a devastating near-zero veto. The peak lives between the two failures, and that is the deep reason likelihood can CHOOSE a spread at all: it punishes both overconfidence and vagueness, automatically. "Play it safe by being vague" is not safe here: it is just a different way to be wrong.',
      },
      preset: 'thin',
    },
    {
      title: 'Climb the surface',
      text: 'One candidate at a time is slow. The right panel scores ALL of them at once: every pixel is a $(\\mu, \\sigma)$ pair, and brighter means higher $\\ell$. Your current candidate is the dot: drag it around the map and feel the terrain: one bright ridge, no decoys, falling away in every direction. The best possible candidate sits at the peak; it has a name, the **maximum likelihood estimate**, and a button: press **Find MLE** and ride up. For the lognormal the peak happens to have a closed form (μ̂ is the average of the logs, σ̂ their spread: the readouts confirm it), but do not let the shortcut shrink the idea. The MACHINE is: define the score, then climb. When the model is complicated and no formula exists, statisticians climb numerically: and when even climbing fails because the surface lives in twenty dimensions, they send in a random walker instead. You will meet that walker in MCMC Sampling, one level up.',
      preset: 'guess',
    },
    {
      title: 'Clark runs this exact machine',
      text: 'Now the payoff, and it is worth saying slowly. Take this machine and change only its inputs: swap the twelve losses for the fifty-five cells of a loss triangle; swap the lognormal for a smooth payout curve $G(x)$ with two dials $(\\omega, \\theta)$, wrapped in ODP noise. Change NOTHING about the logic: each cell votes on the candidate curve, the log-votes add, the fitted answer is the peak of the surface. What you now have is Clark 2003: an entire exam paper: reduced to an application of a machine you already understand. This is the real reason MLE lives below the exam level in this ladder: it is not a formula to memorize per paper, but ONE machine, indifferent to what it fits. Learn it once here, where you can drag the candidate with your hand, and Clark’s "maximize the loglikelihood over ω and θ" stops being an incantation.',
      preset: 'mle',
    },
  ],
  checks: [
    { name: 'MLE μ̂ is the mean of the logs', expect: 0, tol: 1e-12, got: () => LS_MLE.mu - LS_DATA.map((x) => Math.log(x)).reduce((a, b) => a + b, 0) / LS_DATA.length },
    { name: 'MLE σ̂ is the RMS spread of the logs', expect: 0, tol: 1e-12, got: () => { const logs = LS_DATA.map((x) => Math.log(x)); const m = logs.reduce((a, b) => a + b, 0) / logs.length; return LS_MLE.sigma - Math.sqrt(logs.reduce((a, b) => a + (b - m) * (b - m), 0) / logs.length); } },
    { name: 'The MLE beats every perturbed neighbor', expect: 1, tol: 0, got: () => { const best = clLognLoglik(LS_DATA, LS_MLE.mu, LS_MLE.sigma); for (const [dm, ds] of [[0.03, 0], [-0.03, 0], [0, 0.03], [0, -0.03], [0.03, 0.03], [-0.03, -0.03]]) { if (clLognLoglik(LS_DATA, LS_MLE.mu + dm, LS_MLE.sigma + ds) >= best) return 0; } return 1; } },
    { name: 'Likelihood falls monotonically as μ walks away', expect: 1, tol: 0, got: () => { const s = LS_MLE.sigma; const a = clLognLoglik(LS_DATA, LS_MLE.mu + 0.2, s); const b = clLognLoglik(LS_DATA, LS_MLE.mu + 0.4, s); return b < a ? 1 : 0; } },
  ],
});

// --- Module: Process vs Parameter Risk (sampling error) --------------------

/** Repeat the whole experiment: estimate from n draws, then predict one more. */
function clSamplingRun({ n, sigma, reps, seed, mu = 100 }) {
  const rng = clMulberry32(seed);
  const estimates = [], predErrors = [];
  for (let r = 0; r < reps; r++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += mu + sigma * clRandNormal(rng);
    const xbar = s / n;
    estimates.push(xbar);
    predErrors.push(mu + sigma * clRandNormal(rng) - xbar);
  }
  return { estimates, predErrors };
}

defineModule({
  id: 'sampling-error',
  title: 'Process vs Parameter Risk',
  subtitle: 'One truth, many datasets: the estimate itself wobbles, and predictions pay for both wobbles',
  icon: 'shuffle',
  level: 'estimation',
  kind: 'concept',
  ord: 2,
  paper: null,
  foundations: [
    { module: 'random-variable', text: 'An estimator is a random variable: rerun the world and it lands somewhere else.' },
    { module: 'sums-clt', text: 'x̄ is a scaled sum, which is why its spread obeys the √n law.' },
  ],
  bridges: [
    { module: 'mack-machinery', text: 'Mack’s mse is exactly this decomposition: a process term plus an estimation term, per accident year.' },
    { module: 'odp-bootstrap', text: 'Shapland’s √(n/(n−p)) correction exists because residuals understate σ: an estimation-error fact from this module.' },
  ],
  intro:
    'Nature fixes a truth you never see. You get n observations, estimate, ' +
    'and predict the next outcome. Rerun that whole world thousands of ' +
    'times: the estimates scatter (parameter risk) and outcomes scatter ' +
    'around any estimate (process risk). Predictions pay for both, added ' +
    'in quadrature, and every mse formula on the exam is this sentence.',
  params: [
    { key: 'n', tex: 'n', label: 'Observations Per Dataset', min: 2, max: 60, step: 1, init: 5, fmt: 'num', link: 'param' },
    { key: 'sigma', tex: '\\sigma', label: 'Process Noise', min: 5, max: 40, step: 0.5, init: 20, fmt: 'num', link: 'process' },
  ],
  derived(p) {
    const seParam = p.sigma / Math.sqrt(p.n);
    return {
      seParam,
      sdTotal: p.sigma * Math.sqrt(1 + 1 / p.n),
      shareParam: 1 / (p.n + 1),
    };
  },
  readouts: [
    { sym: '\\sigma', id: 'sigma', fmt: 'num', label: 'Process Risk (Irreducible)', link: 'process' },
    { sym: '\\sigma/\\sqrt{n}', id: 'seParam', fmt: 'num2', label: 'Parameter Risk (Estimation)', link: 'param' },
    { sym: '\\sqrt{\\sigma^2+\\sigma^2/n}', id: 'sdTotal', fmt: 'num2', label: 'Total Prediction Risk', accent: true, link: 'total' },
    { sym: '\\tfrac{1}{n+1}', id: 'shareParam', fmt: 'pct', label: 'Share From Estimation', link: 'param' },
  ],
  formula() {
    return {
      sym: '\\mathrm{Var}(\\text{next} - \\bar{x}) = \\sigma^2 + \\tfrac{\\sigma^2}{n}',
      terms: [
        { sym: '\\text{total}', fmt: 'num2', get: (d) => d.sdTotal, primary: true, link: 'total' },
        { op: '←' },
        { sym: '\\sigma', fmt: 'num', get: (d) => d.sigma, link: 'process' },
        { op: '⊕' },
        { sym: '\\sigma/\\sqrt{n}', fmt: 'num2', get: (d) => d.seParam, link: 'param' },
      ],
    };
  },
  presets: [
    {
      id: 'thin-data',
      label: 'Five Observations',
      note: 'n = 5: the estimates scatter almost as widely as the process itself, and a sixth of total prediction variance is your own estimation error. Young accident years live here.',
      params: { n: { value: 5 }, sigma: { value: 20 } },
    },
    {
      id: 'rich-data',
      label: 'Fifty Observations',
      note: 'n = 50: the estimator histogram narrows like 1/√n and prediction risk approaches the process floor σ. Data buys certainty about the MEAN, never about the next draw.',
      params: { n: { value: 50 }, sigma: { value: 20 } },
    },
    {
      id: 'noisy-line',
      label: 'A Noisier Line',
      note: 'Double σ and BOTH bands double: process risk directly, parameter risk because every dataset you learn from is noisier too.',
      params: { n: { value: 5 }, sigma: { value: 40 } },
    },
  ],
  story: [
    {
      title: 'Rerun the world',
      text: 'Here is the thought experiment classical statistics is secretly built on. Nature fixes a truth: these losses average 100 with noise σ: and never shows it to you. You get $n$ observations, average them, and call the result your estimate $\\bar{x}$. Reasonable. But now RERUN the world: same truth, fresh luck, a new batch of $n$, a new estimate. Then again, thousands of times: which is exactly what the left panel is doing (the small dots across the top are the latest batch). Watch the histogram of estimates pile up. It has a definite shape and a definite spread, and here is the reframe that unlocks the whole level: the estimate YOU actually computed, from the one history you actually got, is a single draw from THIS histogram. The moment you see your own number as one draw among the possible ones, "how good is my estimate?" stops being philosophy and becomes a measurable thing: the width of this pile.',
      preset: 'thin-data',
    },
    {
      title: 'Commit to a guess',
      text: 'More data obviously helps. The question worth committing to is HOW FAST it helps, because careers of budget decisions hang on the answer.',
      predict: {
        prompt: 'Quadruple the sample size from 5 toward 20. The spread of the ESTIMATES…',
        options: ['Halves: parameter risk shrinks like 1/√n', 'Quarters: like 1/n', 'Does not move: σ is σ'],
        answer: 0,
        explain: 'Averaging n independent draws divides the VARIANCE by n: Var(x̄) = σ²/n: but the width you actually see is the standard deviation, its square root, so it shrinks only like 1/√n. Quadruple the data, halve the scatter; watch the histogram confirm it as you slide n. That square root is the tax on certainty: each further halving of estimation error costs FOUR times the observations, which is why the last bit of confidence is always the expensive bit, and why thin data (young accident years, new lines, rare perils) can never be argued into precision. It can only be shrunk toward something: which is what Credibility & Shrinkage, the next level, is for.',
      },
      preset: 'rich-data',
    },
    {
      title: 'Two risks, one prediction',
      text: 'Estimating the truth is only half the job: reserving must predict the NEXT outcome, and that prediction misses for two stacked reasons. First, the next outcome wobbles around the truth by $\\sigma$: **process risk**, the world’s own randomness, untouchable by any amount of data. Second, your estimate of the truth was itself off, by about $\\sigma/\\sqrt{n}$: **estimation risk** (the papers also say parameter risk), the part data CAN shrink. The two misses are independent, so they combine the Pythagorean way you learned in Correlation & Diversification: total² = σ² + σ²/n, which is the bar ladder on the right, live. Study the bars and notice the floor: drag n as high as it goes and the total never falls below σ. A model can be EXACTLY right and the world still surprises you. Mixing up those two kinds of missing: blaming the model for process risk, or trusting thin data as if estimation risk were zero: is the classic reserving mistake, in both directions.',
      preset: 'thin-data',
    },
    {
      title: 'Where the exam splits it',
      text: 'You now hold the exam’s single most reused idea, so collect the payoffs. Mack’s celebrated mean-squared-error formula IS this decomposition written out for the chain ladder: inside his expression sit a process term and an estimation term, per accident year: nothing in it will be new to you except the bookkeeping. Clark reports the same split for his curve fits, and his empirical finding deserves a pause: on real triangles, PARAMETER risk dominates. A triangle looks like a lot of data and is actually 55 numbers; the data is thinner than it feels, exactly the thin-data regime you just explored. And Shapland multiplies his resampled residuals by $\\sqrt{n/(n-p)}$ for a reason you can now state precisely: a model that fitted p parameters has already absorbed some of the noise into them, so its leftover residuals understate the true σ. Three papers, one decomposition. On any exam question about uncertainty, the first productive move is: which term is this?',
      preset: 'thin-data',
    },
  ],
  checks: [
    { name: 'Estimation share identity: 1/(n+1) at n=5', expect: 1 / 6, tol: 1e-12, got: () => 1 / (5 + 1) },
    {
      name: 'Seeded sim: Var(x̄) lands within 8% of σ²/n',
      expect: 1, tol: 0,
      got: () => {
        const { estimates } = clSamplingRun({ n: 5, sigma: 20, reps: 6000, seed: 17 });
        const m = estimates.reduce((a, b) => a + b, 0) / estimates.length;
        const v = estimates.reduce((a, b) => a + (b - m) * (b - m), 0) / estimates.length;
        return Math.abs(v - 80) / 80 < 0.08 ? 1 : 0;
      },
    },
    {
      name: 'Seeded sim: prediction error variance lands within 8% of σ²(1+1/n)',
      expect: 1, tol: 0,
      got: () => {
        const { predErrors } = clSamplingRun({ n: 5, sigma: 20, reps: 6000, seed: 17 });
        const m = predErrors.reduce((a, b) => a + b, 0) / predErrors.length;
        const v = predErrors.reduce((a, b) => a + (b - m) * (b - m), 0) / predErrors.length;
        return Math.abs(v - 480) / 480 < 0.08 ? 1 : 0;
      },
    },
    { name: 'Parameter risk falls monotonically with n', expect: 1, tol: 0, got: () => (20 / Math.sqrt(50) < 20 / Math.sqrt(5) ? 1 : 0) },
  ],
});

// --- Module: Credibility Is Shrinkage --------------------------------------

/** RMSE of the shrunk estimator Z·x̄ + (1−Z)·M against the true class mean:
    err²(Z) = Z²s² + (1−Z)²τ². Minimized at Z* = τ²/(τ²+s²) — Bühlmann. */
function clShrinkErr(Z, tau, s) {
  return Math.sqrt(Z * Z * s * s + (1 - Z) * (1 - Z) * tau * tau);
}

/** Fixed standard-normal pairs so dragging τ or s MORPHS the same classes. */
function clShrinkClasses(m, seed) {
  const rng = clMulberry32(seed);
  const pairs = [];
  for (let i = 0; i < m; i++) pairs.push([clRandNormal(rng), clRandNormal(rng)]);
  return pairs;
}

defineModule({
  id: 'shrinkage',
  title: 'Credibility & Shrinkage',
  subtitle: 'Pull noisy estimates toward the crowd and you beat them all: the valley has a bottom, and it is Bühlmann’s Z',
  icon: 'magnet',
  level: 'bayes',
  kind: 'concept',
  ord: 2,
  paper: null,
  foundations: [
    { module: 'sampling-error', text: 'The raw estimates scatter because estimators wobble; that wobble is the s in the trade-off.' },
    { module: 'prior-posterior', text: 'Shrinking toward the grand mean is a Bayesian update with the crowd as the prior.' },
  ],
  bridges: [
    { module: 'brosius-line', text: 'Brosius’ Z = VHM/(VHM+EPV) is this module’s Z* with the exam’s names on the variances.' },
    { module: 'mse-valley', text: 'Mack 2000’s optimal c* = p/(p+t) is the same valley, walked with GLM-free algebra.' },
  ],
  intro:
    'Twelve classes, each estimated from thin data. The raw estimates ' +
    'scatter MORE than the true class means, because estimation noise piles ' +
    'on top of real differences. Slide Z and shrink every estimate toward ' +
    'the grand mean: too little trusts noise, too much erases real ' +
    'differences, and the error valley bottoms at a ratio of variances.',
  params: [
    { key: 'Z', tex: 'Z', label: 'Credibility (Weight On The Class)', min: 0, max: 1, step: 0.01, init: 0.5, fmt: 'num2', link: 'z' },
    { key: 'tau', tex: '\\tau', label: 'Real Spread Between Classes', min: 2, max: 30, step: 0.5, init: 15, fmt: 'num', link: 'spread' },
    { key: 's', tex: 's', label: 'Estimation Noise Per Class', min: 2, max: 30, step: 0.5, init: 10, fmt: 'num', link: 'noise' },
  ],
  derived(p) {
    const zStar = (p.tau * p.tau) / (p.tau * p.tau + p.s * p.s);
    return {
      zStar,
      errZ: clShrinkErr(p.Z, p.tau, p.s),
      errStar: clShrinkErr(zStar, p.tau, p.s),
      errRaw: p.s,
    };
  },
  readouts: [
    { sym: 'Z^*', id: 'zStar', fmt: 'num2', label: 'The Valley Bottom', accent: true, link: 'zstar' },
    { sym: '\\mathrm{rmse}(Z)', id: 'errZ', fmt: 'num2', label: 'Error At Your Z', link: 'z' },
    { sym: '\\mathrm{rmse}(Z^*)', id: 'errStar', fmt: 'num2', label: 'Error At The Bottom', link: 'zstar' },
    { sym: '\\mathrm{rmse}(1)', id: 'errRaw', fmt: 'num2', label: 'Error Trusting Raw Data', link: 'noise' },
  ],
  formula() {
    return {
      sym: 'Z^* = \\tfrac{\\tau^2}{\\tau^2 + s^2}, \\qquad \\mathrm{err}^2(Z) = Z^2 s^2 + (1{-}Z)^2\\tau^2',
      terms: [
        { sym: 'Z^*', fmt: 'num2', get: (d) => d.zStar, primary: true, link: 'zstar' },
        { op: '←' },
        { sym: '\\tau', fmt: 'num', get: (d) => d.tau, link: 'spread' },
        { op: ',' },
        { sym: 's', fmt: 'num', get: (d) => d.s, link: 'noise' },
      ],
    };
  },
  presets: [
    {
      id: 'balanced',
      label: 'A Fair Fight',
      note: 'Real differences (τ = 15) against estimation noise (s = 10): Z* lands at 0.69. Most of a raw estimate is worth keeping; a third of it is noise you should hand back to the crowd.',
      params: { Z: { value: 0.69 }, tau: { value: 15 }, s: { value: 10 } },
    },
    {
      id: 'noisy',
      label: 'Drowning In Noise',
      note: 's = 25 against τ = 10: most of what you see per class is estimation error, Z* falls to 0.14, and the honest answer is nearly the grand mean for everyone.',
      params: { Z: { value: 0.14 }, tau: { value: 10 }, s: { value: 25 } },
    },
    {
      id: 'distinct',
      label: 'Genuinely Different Classes',
      note: 'τ = 28 against s = 6: the classes really are different and the data is clean. Z* = 0.96: shrinkage politely steps aside.',
      params: { Z: { value: 0.96 }, tau: { value: 28 }, s: { value: 6 } },
    },
  ],
  story: [
    {
      title: 'The scatter lies',
      text: 'Twelve classes of business. Each has a true average loss level (the gray dots): which nobody can see: and an estimate computed from its own thin data (the accent dots). Compare the two scatters carefully: the estimates spread WIDER than the truths. Always. The reason is mechanical and worth saying aloud: an estimate is truth plus estimation noise, and stacking two spreads widens the result (the quadrature rule, again). Now feel the trap this sets. The class with the highest ESTIMATE is probably not your worst class: more likely it is a middling class that drew bad luck in a small sample. Price it up, or panic about it, and you are chasing noise: and next year, when its luck normalizes, you will congratulate yourself for a fix that did nothing. The remedy looks like heresy: drag Z below 1 and deliberately pull every estimate partway toward the crowd’s average. The next step is about why the heresy wins.',
      preset: 'balanced',
    },
    {
      title: 'Commit to a guess',
      text: 'Shrinkage sounds like giving up information: you measured each class, and now you are smudging the measurements together. Commit to what happens to the ERROR.',
      predict: {
        prompt: 'Slide Z from 1 toward Z*. The average error against the TRUE class means…',
        options: ['Falls: trading noise for a small bias wins', 'Rises: raw data is unbiased and unbiased is best', 'Flat: it is a wash'],
        answer: 0,
        explain: 'Each raw estimate is unbiased but noisy; the grand mean is biased for any particular class but rock steady. Blending trades a LITTLE bias for a LOT of variance, and the trade keeps paying all the way down to Z* = τ²/(τ²+s²): watch the error readout fall as you drag. Study what Z* is built from, because it is the module’s whole lesson: τ² measures how DIFFERENT the classes truly are, s² how NOISY each estimate is. Real differences earn trust; noise earns shrinkage. Stein scandalized statistics in 1956 by proving a version of this always wins in aggregate: even for unrelated quantities. The crowd is information, not contamination.',
      },
      preset: 'balanced',
    },
    {
      title: 'Walk the valley',
      text: 'The right panel prices every possible choice of Z at once: $\\mathrm{err}^2(Z) = Z^2 s^2 + (1{-}Z)^2\\tau^2$. Read it as two costs fighting: trust the data too much (Z near 1) and you eat estimation noise $s$; trust the crowd too much (Z near 0) and you erase real class differences $\\tau$. Their sum is a valley with one bottom. Drag your Z along the curve and feel the trade. Then, more instructive, move the WORLD instead of the dial: crank the noise $s$ up and watch the whole valley tilt, its bottom sliding toward 0 (when estimates are garbage, lean on the crowd); crank $\\tau$ up and the bottom slides toward 1 (when classes genuinely differ, respect the differences). The bottom only reaches 0 or 1 when one variance dies completely. Everything in between is compromise: and notice that the compromise is COMPUTED from two measurable quantities, not negotiated in a meeting.',
      preset: 'noisy',
    },
    {
      title: 'Three exam names for one dial',
      text: 'You will meet this dial three times on the exam wearing three different costumes, and it is worth learning to see through all of them now. Brosius writes the valley’s bottom as $Z = VHM/(VHM + EPV)$: "variance of hypothetical means" over itself plus "expected process variance": which is exactly τ² and s² wearing actuarial name tags. Mack 2000 walks the same valley for the blend between BF and chain ladder and finds the bottom at $c^* = p/(p+t)$. Benktander’s method never computes the bottom at all: it iterates the blend once and lands NEAR it, a heuristic that the valley explains. So build the habit: when any exam question says "credibility", do not reach for a memorized formula first. Reach for the two variances: ask "how different are these risks, really?" and "how noisy is my estimate of each?": and the formula, whichever costume it wears, is just their ratio.',
      preset: 'distinct',
    },
  ],
  checks: [
    { name: 'Error identity at Z = 0.5, τ = 15, s = 10', expect: Math.sqrt(0.25 * 100 + 0.25 * 225), tol: 1e-12, got: () => clShrinkErr(0.5, 15, 10) },
    { name: 'Z* = τ²/(τ²+s²) at the Fair Fight preset', expect: 225 / 325, tol: 1e-12, got: () => (15 * 15) / (15 * 15 + 10 * 10) },
    { name: 'The bottom beats both ends', expect: 1, tol: 0, got: () => { const zs = 225 / 325; const b = clShrinkErr(zs, 15, 10); return b < clShrinkErr(0, 15, 10) && b < clShrinkErr(1, 15, 10) ? 1 : 0; } },
    { name: 'Grid search agrees with the closed form within one step', expect: 1, tol: 0, got: () => { let best = 0, bv = Infinity; for (let z = 0; z <= 1.0001; z += 0.001) { const e = clShrinkErr(z, 15, 10); if (e < bv) { bv = e; best = z; } } return Math.abs(best - 225 / 325) < 0.002 ? 1 : 0; } },
    { name: 'Cross-check: Brosius Z with VHM = τ², EPV = s² matches Z*', expect: 0, tol: 1e-12, got: () => clBrosiusCred({ EY: 1, d: 0.5, vhm: 225, epv: 100 }).Z - 225 / 325 },
    {
      name: 'Seeded 400-class world: shrinking to Z* beats trusting raw data',
      expect: 1, tol: 0,
      got: () => {
        const pairs = clShrinkClasses(400, 29);
        const tau = 15, s = 10, M = 100;
        const zs = 225 / 325;
        let e1 = 0, eStar = 0;
        for (const [z1, z2] of pairs) {
          const truth = M + tau * z1;
          const raw = truth + s * z2;
          const shrunk = zs * raw + (1 - zs) * M;
          e1 += (raw - truth) ** 2;
          eStar += (shrunk - truth) ** 2;
        }
        return eStar < e1 ? 1 : 0;
      },
    },
  ],
});

// --- Module: The GLM, Piece By Piece ---------------------------------------

/** The mean through the link: identity for the classical world, log for the
    multiplicative world reserving lives in. */
function clGlmMu(link, b0, b1, x) {
  const eta = b0 + b1 * x;
  return link === 'log' ? Math.exp(eta) : eta;
}

/** The variance function V(μ) = φμ^p (p = 0 constant, 1 ODP, 2 gamma). */
function clVarPower(mu, phi, p) {
  return phi * Math.pow(Math.max(1e-12, mu), p);
}

/**
 * Tweedie-family sampler with mean μ and variance φμ^p:
 *   p ≈ 0   normal;   p ≈ 1   over-dispersed Poisson (φ·Pois(μ/φ));
 *   1<p<2   compound Poisson-gamma (the actual Tweedie construction);
 *   p ≈ 2   gamma.
 * The compound parameters are the standard ones: λ = μ^{2−p}/(φ(2−p)),
 * shape α = (2−p)/(p−1), scale γ = φ(p−1)μ^{p−1}.
 */
function clRandTweedie(mu, phi, p, rng) {
  if (p < 0.5) return mu + Math.sqrt(phi) * clRandNormal(rng);
  if (p < 1.05) return phi * clRandPoisson(mu / phi, rng);
  if (p >= 1.95) {
    const shape = 1 / phi;
    return clRandGamma(shape, rng) * (mu / shape);
  }
  const lambda = Math.pow(mu, 2 - p) / (phi * (2 - p));
  const alpha = (2 - p) / (p - 1);
  const scale = phi * (p - 1) * Math.pow(mu, p - 1);
  const count = clRandPoisson(lambda, rng);
  let s = 0;
  for (let i = 0; i < count; i++) s += clRandGamma(alpha, rng) * scale;
  return s;
}

defineModule({
  id: 'glm-anatomy',
  title: 'Generalized Linear Models',
  subtitle: 'A straight line under the hood, a link that bends it, and a variance that follows the mean',
  icon: 'function-square',
  level: 'glm',
  kind: 'concept',
  ord: 1,
  paper: null,
  foundations: [
    { module: 'conditional-expectation', text: 'A GLM is a shape imposed on E[Y|X]; the best-guess line is the identity-link special case.' },
    { module: 'sums-clt', text: 'The Tweedie errors between ODP and gamma ARE compound Poisson sums; you have already met their guts.' },
  ],
  bridges: [
    { module: 'glm-equals-cl', text: 'Taylor’s theorem: THIS model with one parameter per row and column reproduces chain ladder exactly.' },
    { module: 'odp-bootstrap', text: 'Shapland’s bootstrap world is this model at p = 1: log link, variance φμ, on triangle increments.' },
  ],
  intro:
    'Every GLM is three decisions. A linear predictor η = β₀ + β₁x that ' +
    'stays straight forever. A link that bends η into the mean, so ' +
    'multiplicative worlds get log links. And an error family, chosen by ' +
    'how variance follows the mean: V(μ) = φμ^p. Classical regression is ' +
    'just the corner case where the link is identity and p = 0.',
  params: [
    { key: 'b0', tex: '\\beta_0', label: 'Intercept Of η', min: -1, max: 3, step: 0.01, init: 0.5, fmt: 'num2', link: 'eta' },
    { key: 'b1', tex: '\\beta_1', label: 'Slope Of η', min: 0, max: 0.35, step: 0.005, init: 0.18, fmt: 'num2', link: 'eta' },
    { key: 'phi', tex: '\\varphi', label: 'Dispersion', min: 0.2, max: 3, step: 0.05, init: 1, fmt: 'num2', link: 'var' },
    { key: 'p', tex: 'p', label: 'Variance Power V(μ) = φμ^p', min: 1, max: 2, step: 0.01, init: 1, fmt: 'num2', link: 'var', modes: ['tweedie'] },
    { key: 'x', tex: 'x', label: 'Probe (Where To Look)', min: 0, max: 10, step: 0.1, init: 6, fmt: 'num', link: 'probe' },
  ],
  derived(par, st) {
    const link = st?.mode === 'normal' ? 'identity' : 'log';
    const p = st?.mode === 'normal' ? 0 : par.p;
    const mu = clGlmMu(link, par.b0, par.b1, par.x);
    const V = clVarPower(mu, par.phi, p);
    return {
      eta: par.b0 + par.b1 * par.x,
      muProbe: mu,
      vProbe: V,
      sdProbe: Math.sqrt(Math.max(0, V)),
      ratioStep: st?.mode === 'normal' ? null : Math.exp(par.b1),
    };
  },
  readouts: [
    { sym: '\\eta(x)', id: 'eta', fmt: 'num2', label: 'Linear Predictor', link: 'eta' },
    { sym: '\\mu(x)', id: 'muProbe', fmt: 'num2', label: 'Mean At The Probe', accent: true, link: 'mean' },
    { sym: 'V(\\mu)', id: 'vProbe', fmt: 'num2', label: 'Variance At The Probe', link: 'var' },
    { sym: 'e^{\\beta_1}', id: 'ratioStep', fmt: 'num3', label: 'Multiplier Per Step Of x', link: 'eta' },
  ],
  formula(state) {
    if (state.mode === 'normal') {
      return {
        sym: '\\mu = \\beta_0 + \\beta_1 x, \\qquad V(\\mu) = \\varphi',
        terms: [
          { sym: '\\mu(x)', fmt: 'num2', get: (d) => d.muProbe, primary: true, link: 'mean' },
          { op: '=' },
          { sym: '\\beta_0', fmt: 'num2', get: (d) => d.b0, link: 'eta' },
          { op: '+' },
          { sym: '\\beta_1 x', fmt: 'num2', get: (d) => d.b1 * d.x, link: 'eta' },
          { op: ',' },
          { sym: 'V', fmt: 'num2', get: (d) => d.vProbe, link: 'var' },
        ],
      };
    }
    return {
      sym: '\\log \\mu = \\beta_0 + \\beta_1 x, \\qquad V(\\mu) = \\varphi\\,\\mu^{p}',
      terms: [
        { sym: '\\mu(x)', fmt: 'num2', get: (d) => d.muProbe, primary: true, link: 'mean' },
        { op: '=' },
        { sym: 'e^{\\eta}', fmt: 'num2', get: (d) => d.eta, link: 'eta' },
        { op: ',' },
        { sym: 'p', fmt: 'num2', get: (d) => d.p, link: 'var' },
        { op: ',' },
        { sym: 'V(\\mu)', fmt: 'num2', get: (d) => d.vProbe, link: 'var' },
      ],
    };
  },
  presets: [
    {
      id: 'ols',
      label: 'Classical Regression',
      note: 'Identity link, constant variance: the straight line with a uniform noise band that every statistics course starts from. One corner of the GLM family, not the family.',
      mode: 'normal',
      params: { b0: { value: 2, min: 0, max: 8, step: 0.05 }, b1: { value: 0.6, min: 0, max: 1, step: 0.01 }, phi: { value: 1 }, x: { value: 6 } },
    },
    {
      id: 'odp',
      label: 'The ODP World',
      note: 'Log link, p = 1: variance rides the mean, so big cells are noisy in dollars but steady in percent. This is Shapland’s model for triangle increments, verbatim.',
      mode: 'tweedie',
      params: { b0: { value: 0.5, min: -1, max: 3, step: 0.01 }, b1: { value: 0.18 }, phi: { value: 1 }, p: { value: 1 }, x: { value: 6 } },
    },
    {
      id: 'tweedie',
      label: 'Tweedie Between',
      note: 'p = 1.5: a compound Poisson-gamma world with real point mass at zero and a heavy right lean. Aggregate losses with frequency AND severity noise live here.',
      mode: 'tweedie',
      params: { b0: { value: 0.5 }, b1: { value: 0.18 }, phi: { value: 1 }, p: { value: 1.5 }, x: { value: 6 } },
    },
    {
      id: 'gamma',
      label: 'The Gamma World',
      note: 'p = 2: constant coefficient of variation, so every cell is equally uncertain in PERCENT terms. Severity modeling’s home ground.',
      mode: 'tweedie',
      params: { b0: { value: 0.5 }, b1: { value: 0.18 }, phi: { value: 0.4, max: 1.5 }, p: { value: 2 }, x: { value: 6 } },
    },
  ],
  story: [
    {
      title: 'The straight line under the hood',
      text: 'A GLM is the best-guess line from Level 2 with two upgrades, and underneath it is STILL a straight line: the inset strip shows $\\eta = \\beta_0 + \\beta_1 x$, and it never bends. Everything a GLM fits, it fits on that straight line’s scale. Start in the classical corner (identity link, constant noise): this is ordinary regression, the version every statistics course starts from.',
      preset: 'ols',
    },
    {
      title: 'The link bends the world',
      text: 'Apply the ODP preset and hold both panels in view at once: the mean curve now sweeps upward in a curve: yet the inset $\\eta$ is still perfectly straight. The new ingredient is the **link**: the rule that connects them. With a log link the model says $\\log \\mu = \\eta$, that is, $\\mu = e^{\\eta}$: the straight line lives on the log scale. Why would anyone want that? Because it makes the world MULTIPLICATIVE. Watch the $e^{\\beta_1}$ readout: with a log link, each step of $x$ multiplies the mean by that same factor, instead of adding the same amount. And loss development is multiplicative to its bones: a year that starts 30% bigger pays roughly 30% more at every age: which is why reserving GLMs almost always carry a log link. Two bonuses come free: $e^{\\eta}$ can never go negative (neither can paid losses), and multiplicative effects become ADDITIVE on the η scale, which is exactly where the straight line lives. The link is not a distortion; it is a translation.',
      preset: 'odp',
    },
    {
      title: 'Commit to a guess',
      text: 'The second upgrade is the noise. In this ODP world the variance is not constant: it follows the mean, $V(\\mu) = \\varphi\\mu$. Before studying the cloud, commit to what that implies.',
      predict: {
        prompt: 'With V(μ) = φμ, which cells sit farther from the mean curve IN DOLLARS?',
        options: ['The big ones: SD grows like √μ', 'The small ones: little means wobble more', 'All the same: that is what dispersion means'],
        answer: 0,
        explain: 'The SD at any point is √(φμ), which grows with the mean: watch the envelope widen toward the right of the error panel. So large cells miss by more DOLLARS: while in percent terms (SD/μ = √(φ/μ)) they are actually the steady ones. Why this matters beyond trivia: a fitting method must decide which cells to believe when they disagree, and it believes cells in inverse proportion to their assumed variance. Ordinary least squares (constant V) treats a small early cell and a huge late cell as equally reliable in dollars, which over-trusts the big ones. Get V(μ) right and the fit weights every cell by its actual reliability. Much of GLM’s advantage on triangles is exactly this, quietly.',
      },
      preset: 'odp',
    },
    {
      title: 'The p dial',
      text: 'The third ingredient is the error FAMILY: what the scatter around the mean actually looks like: and one dial sweeps through every family the exam uses, via the law $V(\\mu) = \\varphi\\,\\mu^{p}$. Slide $p$ slowly from 1 to 2 and narrate the species change. At $p = 1$, the ODP: dollar-spread grows like $\\sqrt{\\mu}$, count-flavored noise. At $p = 2$, the gamma: constant PERCENT spread, every cell equally uncertain relative to its size: severity’s natural habitat. And in between sits **Tweedie**, which is not an interpolation gimmick but a real physical object: a compound Poisson sum of gamma-sized pieces: literally the aggregate-losses machine from Level 2: complete with a genuine lump of probability at exactly zero. Look for it in the cloud around $p = 1.5$: some cells sit ON the axis. Quiet cells, zero-payment months: real triangles have them, and now your error family does too. One dial, and every "assume gamma errors" in the syllabus becomes a position on it rather than a separate fact.',
      preset: 'tweedie',
    },
    {
      title: 'Why the exam cares',
      text: 'Now assemble the three parts you can each see on this screen: a straight $\\eta$, a log link, ODP errors: and aim the assembly at a loss triangle, with one $\\beta$ per accident year and one per development age inside $\\eta$. Two theorems then carry most of the reserving syllabus on their backs. Taylor: the maximum likelihood fit of THAT model reproduces the chain ladder’s numbers exactly, cell for cell: the Taylor module upstairs lets you verify it to nine decimal places. So the folklore method was secretly a GLM all along, which means it quietly inherits everything GLMs own: standard errors, residual diagnostics, principled extensions. Shapland: resample THAT model’s Pearson residuals and you get the bootstrap’s alternate histories. So when an exam paper writes "the ODP model underlying the bootstrap", it is pointing at this screen: these three parts, set exactly this way. The GLM is not adjacent to the syllabus. It is underneath it.',
      preset: 'odp',
    },
  ],
  checks: [
    { name: 'Log link means multiplicative: μ(x+1)/μ(x) = e^{β₁}', expect: 0, tol: 1e-12, got: () => clGlmMu('log', 0.5, 0.18, 7) / clGlmMu('log', 0.5, 0.18, 6) - Math.exp(0.18) },
    { name: 'Identity link stays additive: μ(x+1) − μ(x) = β₁', expect: 0.6, tol: 1e-12, got: () => clGlmMu('identity', 2, 0.6, 7) - clGlmMu('identity', 2, 0.6, 6) },
    { name: 'Variance function: V = φμ at p = 1', expect: 8, tol: 1e-12, got: () => clVarPower(8, 1, 1) },
    { name: 'Variance function: V = φμ² at p = 2', expect: 25.6, tol: 1e-9, got: () => clVarPower(8, 0.4, 2) },
    {
      name: 'ODP sampler honesty: seeded mean ≈ μ, variance ≈ φμ (5% / 12%)',
      expect: 1, tol: 0,
      got: () => {
        const rng = clMulberry32(41);
        const n = 8000, mu = 8, phi = 1.3;
        let s = 0, s2 = 0;
        for (let i = 0; i < n; i++) { const y = clRandTweedie(mu, phi, 1, rng); s += y; s2 += y * y; }
        const m = s / n, v = s2 / n - m * m;
        return Math.abs(m - mu) / mu < 0.05 && Math.abs(v - phi * mu) / (phi * mu) < 0.12 ? 1 : 0;
      },
    },
    {
      name: 'Tweedie compound construction honesty at p = 1.5 (5% / 12%)',
      expect: 1, tol: 0,
      got: () => {
        const rng = clMulberry32(41);
        const n = 8000, mu = 8, phi = 1, p = 1.5;
        let s = 0, s2 = 0;
        for (let i = 0; i < n; i++) { const y = clRandTweedie(mu, phi, p, rng); s += y; s2 += y * y; }
        const m = s / n, v = s2 / n - m * m;
        const target = clVarPower(mu, phi, p);
        return Math.abs(m - mu) / mu < 0.05 && Math.abs(v - target) / target < 0.12 ? 1 : 0;
      },
    },
    {
      name: 'Gamma sampler honesty at p = 2 (5% / 12%)',
      expect: 1, tol: 0,
      got: () => {
        const rng = clMulberry32(41);
        const n = 8000, mu = 8, phi = 0.4;
        let s = 0, s2 = 0;
        for (let i = 0; i < n; i++) { const y = clRandTweedie(mu, phi, 2, rng); s += y; s2 += y * y; }
        const m = s / n, v = s2 / n - m * m;
        const target = phi * mu * mu;
        return Math.abs(m - mu) / mu < 0.05 && Math.abs(v - target) / target < 0.12 ? 1 : 0;
      },
    },
  ],
});

// --- Module: Reading Residuals ---------------------------------------------

/**
 * A fixed ODP world (true variance φμ) standardized by an ASSUMED variance
 * power: r = (y − μ)/√(φμ^{p_a}). Right assumption → flat band; too-low
 * p_a → funnel; too-high → inverted funnel. binRatio compares residual
 * spread in the top vs bottom third of fitted values.
 */
function clResidualStudy({ pAssumed, phi, seed, n = 240 }) {
  const rng = clMulberry32(seed);
  const points = [];
  for (let i = 0; i < n; i++) {
    const mu = 2 + (i / (n - 1)) * 38;
    const y = clRandTweedie(mu, phi, 1, rng);
    const r = (y - mu) / Math.sqrt(clVarPower(mu, phi, pAssumed));
    points.push({ mu, y, r });
  }
  const third = Math.floor(n / 3);
  const sdOf = (arr) => {
    const m = arr.reduce((a, b) => a + b, 0) / arr.length;
    return Math.sqrt(arr.reduce((a, b) => a + (b - m) * (b - m), 0) / arr.length);
  };
  const low = sdOf(points.slice(0, third).map((p) => p.r));
  const high = sdOf(points.slice(n - third).map((p) => p.r));
  return { points, binRatio: high / Math.max(1e-9, low) };
}

defineModule({
  id: 'residual-lens',
  title: 'Pearson Residuals',
  subtitle: 'Standardize by the right variance and the funnel flattens: Pearson residuals are the flattening',
  icon: 'activity',
  level: 'glm',
  kind: 'concept',
  ord: 2,
  paper: null,
  foundations: [
    { module: 'glm-anatomy', text: 'V(μ) = φμ^p is the dial being assumed here; it got its meaning one module down.' },
    { module: 'sampling-error', text: 'Residual spread understates true noise because the fit already ate some of it; the df correction lives there.' },
  ],
  bridges: [
    { module: 'odp-bootstrap', text: 'Shapland resamples EXACTLY these Pearson residuals; the flat band is what makes them exchangeable.' },
    { module: 'mack-machinery', text: 'Mack’s weighted factor estimates come from the same variance-weighting logic, applied to link ratios.' },
  ],
  intro:
    'Residuals are what the model could not explain. Standardize them by ' +
    'the WRONG variance and they funnel: big cells look wilder than small ' +
    'ones. Standardize by the right V(μ) and the funnel flattens into an ' +
    'exchangeable pool. That flat pool is what the bootstrap draws from, ' +
    'and every funnel you fail to notice is a lie your simulation will tell.',
  params: [
    { key: 'pa', tex: 'p_a', label: 'Assumed Variance Power', min: 0, max: 2, step: 0.05, init: 0, fmt: 'num2', link: 'std' },
    { key: 'phi', tex: '\\varphi', label: 'Dispersion Of The World', min: 0.4, max: 3, step: 0.05, init: 1.2, fmt: 'num2', link: 'world' },
  ],
  derived(p) {
    const study = clResidualStudy({ pAssumed: p.pa, phi: p.phi, seed: 47 });
    return {
      binRatio: study.binRatio,
      gapFromOdp: p.pa - 1,
    };
  },
  readouts: [
    { sym: 'p_a', id: 'pa', fmt: 'num2', label: 'Assumed Power', link: 'std' },
    { sym: '\\tfrac{sd_{high}}{sd_{low}}', id: 'binRatio', fmt: 'num2', label: 'Funnel Ratio (1 = Flat)', accent: true, link: 'funnel' },
    { sym: 'p_a - 1', id: 'gapFromOdp', fmt: 'num2', label: 'Distance From The Truth', link: 'std' },
  ],
  formula() {
    return {
      sym: 'r_i = \\dfrac{y_i - \\mu_i}{\\sqrt{\\varphi\\,\\mu_i^{\\,p_a}}}',
      terms: [
        { sym: 'p_a', fmt: 'num2', get: (d) => d.pa, primary: true, link: 'std' },
        { op: '→' },
        { sym: 'sd_{high}/sd_{low}', fmt: 'num2', get: (d) => d.binRatio, link: 'funnel' },
      ],
    };
  },
  presets: [
    {
      id: 'wrong',
      label: 'The Naive Lens',
      note: 'Constant-variance standardization (p_a = 0) on a world whose variance actually rides the mean. The funnel opens: large fitted values look wilder than they are.',
      params: { pa: { value: 0 }, phi: { value: 1.2 } },
    },
    {
      id: 'pearson',
      label: 'The Pearson Lens',
      note: 'p_a = 1 matches the world: divide each residual by √(φμ) and the band flattens to ratio ≈ 1. These flat residuals are the exchangeable pool the bootstrap needs.',
      params: { pa: { value: 1 }, phi: { value: 1.2 } },
    },
    {
      id: 'overshoot',
      label: 'Overcorrected',
      note: 'p_a = 2 divides by too much μ: now SMALL cells look wild instead. A funnel in either direction is the same message: your variance assumption disagrees with the data.',
      params: { pa: { value: 2 }, phi: { value: 1.2 } },
    },
  ],
  story: [
    {
      title: 'The funnel',
      text: 'A model’s residuals: actual minus fitted, one per cell: are its confession tape: any pattern left in them is something the model failed to hear. But there is a catch most people learn the hard way: you must listen at the right VOLUME, and volume here means the variance you divide each residual by. The world on stage is honestly ODP: bigger cells genuinely wobble by more dollars, and the model’s mean is exactly right. Yet standardize the residuals by a CONSTANT variance ($p_a = 0$, the naive lens) and look at the left panel: a funnel: quiet on the left, wild on the right. Nothing is wrong with the model. The funnel is an artifact of measuring every cell’s miss with the same dollar yardstick when the cells live on different scales. Misread it as "the model fails on large cells" and you will go fix something that was never broken. Residual plots do not just show model errors: they show YOUR assumptions about the noise, reflected back.',
      preset: 'wrong',
    },
    {
      title: 'Commit to a guess',
      text: 'The dial $p_a$ is YOUR assumption about how the noise scales: divide each residual by $\\sqrt{\\varphi\\mu^{p_a}}$. The world’s true power is 1. Commit to what happens when your assumption meets the truth.',
      predict: {
        prompt: 'Slide the assumed power p_a from 0 up to 1. The funnel…',
        options: ['Flattens into an even band', 'Rotates: small cells start funneling instead', 'Nothing changes: residuals are residuals'],
        answer: 0,
        explain: 'Dividing each residual by its OWN standard deviation, √(φμ) here, converts every cell’s miss into the same currency: "how many of MY typical wobbles did I miss by?" A big cell missing by many dollars and a small cell missing by few can both be perfectly ordinary one-wobble misses, and once standardized correctly they look identical: the funnel flattens into an even band. That is the entire content of the phrase **Pearson residual**: a raw residual measured in units of its own SD. And the move generalizes far beyond triangles: z-scores in school testing, Sharpe ratios in finance, standardized residuals here: one idea, three costumes: never compare raw misses across different scales.',
      },
      preset: 'pearson',
    },
    {
      title: 'Exchangeable at last',
      text: 'Look at what the flattening bought you, because it is the ticket the bootstrap rides on. The right panel shows the standardized pool: hundreds of leftovers that are now statistically interchangeable: any of them could plausibly have occurred at any cell, since each is expressed in its own cell’s natural units. Statisticians call this property **exchangeability**, and for Shapland it is not a nicety but the load-bearing wall. His alternate histories are manufactured by drawing from EXACTLY this pool and rescaling each draw to its destination cell (multiply back by that cell’s $\\sqrt{\\varphi\\mu}$). Now run the failure case in your head: if the pool still funneled: big-cell residuals systematically larger: then shuffling would transplant big-cell noise into small cells, and every manufactured history would be subtly, systematically wrong. Diagnose flatness FIRST, then resample: that ordering is why Shapland’s paper spends an entire chapter on residual plots before it dares to bootstrap anything.',
      preset: 'pearson',
    },
    {
      title: 'Overshooting is also a confession',
      text: 'One more turn of the dial teaches the final reading skill. Push $p_a$ past the truth to 2: now you are dividing the big cells by TOO much, and watch the funnel invert: suddenly the SMALL cells look wild. Pause on what you just learned: a tilt in either direction is the same single message: your assumed variance law disagrees with the data’s actual one: and the DIRECTION of the tilt tells you which way to move $p$. Widening to the right means assume faster variance growth; widening to the left means assume slower. That turns residual plots from a pass/fail ritual into an instrument with a needle you can read. Venter’s paper on testing chain-ladder assumptions is this exact move run on real triangles, systematically, plot by plot. Flat is not a formality to check off. Flat is the evidence that your noise model and reality have stopped arguing: and every tilt is the argument, written down.',
      preset: 'overshoot',
    },
  ],
  checks: [
    { name: 'Pearson formula at a sample point: (12−8)/√(1.2·8)', expect: 4 / Math.sqrt(9.6), tol: 1e-12, got: () => (12 - 8) / Math.sqrt(clVarPower(8, 1.2, 1)) },
    { name: 'Right lens: funnel ratio within [0.8, 1.25] at p_a = 1 (seeded)', expect: 1, tol: 0, got: () => { const r = clResidualStudy({ pAssumed: 1, phi: 1.2, seed: 47 }).binRatio; return r > 0.8 && r < 1.25 ? 1 : 0; } },
    { name: 'Naive lens funnels: ratio > 1.5 at p_a = 0 (seeded)', expect: 1, tol: 0, got: () => (clResidualStudy({ pAssumed: 0, phi: 1.2, seed: 47 }).binRatio > 1.5 ? 1 : 0) },
    { name: 'Overcorrected lens inverts: ratio < 0.75 at p_a = 2 (seeded)', expect: 1, tol: 0, got: () => (clResidualStudy({ pAssumed: 2, phi: 1.2, seed: 47 }).binRatio < 0.75 ? 1 : 0) },
    { name: 'Residual pool is centered near zero under the Pearson lens', expect: 1, tol: 0, got: () => { const pts = clResidualStudy({ pAssumed: 1, phi: 1.2, seed: 47 }).points; const m = pts.reduce((a, p) => a + p.r, 0) / pts.length; return Math.abs(m) < 0.12 ? 1 : 0; } },
  ],
});

// --- Module: Meyers' Model Ladder (the validate-diagnose-fix arc) ----------

// Stylized per-accident-year reserve SDs: recent years carry the risk.
const ARC_SDS = [0.4, 0.5, 0.65, 0.8, 1.0, 1.25, 1.5, 1.8, 2.2, 2.6];
const ARC_TRUE_RHO = 0.45;
const ARC_TRUE_BIAS = 0.35;
const ARC_N = 100;
const ARC_SEED = 42;

/** SD of a total of AYs with corr(i,j) = ρ^{|i−j|}: what CCL adds to Mack. */
function clCclWidth(sds, rho) {
  let v = 0;
  for (let i = 0; i < sds.length; i++) {
    for (let j = 0; j < sds.length; j++) {
      v += Math.pow(rho, Math.abs(i - j)) * sds[i] * sds[j];
    }
  }
  return Math.sqrt(v);
}

defineModule({
  id: 'meyers-arc',
  title: 'Meyers: CCL & CSR',
  subtitle: 'Validate, diagnose, fix, re-validate: why LCL, CCL, and CSR exist at all',
  icon: 'milestone',
  level: 'reserving',
  kind: 'exam',
  ord: 4,
  foundations: [
    { module: 'correlation', text: 'The incurred fix is pure correlation: ρ between accident years is what widens the total.' },
    { module: 'validation-machine', text: 'The scoring machine (percentiles, p-p plots, the KS band) is built and drilled there.' },
    { module: 'mcmc-watch', text: 'Every model on this ladder is fit by the random walk watched there.' },
  ],
  paper: {
    label: 'Meyers, Monograph 8 (2015)',
    section: 'The arc across §3-7: validate Mack and ODP, then build LCL/CCL and CSR',
    task: 'Show WHY each model exists: what failure it was built to fix',
  },
  intro:
    'Meyers took 200 real triangles and asked every standard model one ' +
    'question: were the outcomes uniform on your predicted percentiles? ' +
    'Mack on incurred failed thin. Paid models failed high. Each Bayesian ' +
    'model he then built exists to fix one diagnosed failure: CCL adds the ' +
    'correlation Mack ignores; CSR models the settlement speedup that paid ' +
    'models mistake for growth. This module is that arc, with the dials.',
  params: [
    { key: 'rho', tex: '\\rho', label: 'Model’s Accident-Year Correlation', min: 0, max: 0.7, step: 0.01, init: 0, fmt: 'num2', link: 'width', modes: ['incurred'] },
    { key: 'speed', tex: 's', label: 'Modeled Settlement Speedup', min: 0, max: 0.5, step: 0.01, init: 0, fmt: 'num2', link: 'bias', modes: ['paid'] },
  ],
  derived(p, st) {
    const mode = st?.mode === 'paid' ? 'paid' : 'incurred';
    const wTrue = clCclWidth(ARC_SDS, ARC_TRUE_RHO);
    const tail = mode === 'incurred' ? clCclWidth(ARC_SDS, p.rho) / wTrue : 1;
    const bias = mode === 'paid' ? ARC_TRUE_BIAS - p.speed : 0;
    const run = clValidationRun({ n: ARC_N, bias, tail, seed: ARC_SEED });
    return {
      tail,
      bias,
      D: run.D,
      band: clKsBand(ARC_N),
      passes: run.D < clKsBand(ARC_N) ? 1 : 0,
    };
  },
  readouts: [
    { sym: 'D', id: 'D', fmt: 'num2', label: 'KS Distance', accent: true, link: 'pp' },
    { sym: '\\tfrac{136}{\\sqrt{n}}', id: 'band', fmt: 'num2', label: 'The Band (n = 100)', link: 'pp' },
    { sym: 'w/w_{true}', id: 'tail', fmt: 'pct', label: 'Claimed Width vs Truth', link: 'width' },
    { sym: '\\Delta', id: 'bias', fmt: 'num2', label: 'Residual Bias (SD Units)', link: 'bias' },
  ],
  formula(state) {
    if (state.mode === 'paid') {
      return {
        sym: '\\text{residual bias} = \\Delta_{true} - s',
        terms: [
          { sym: 'D', fmt: 'num2', get: (d) => d.D, primary: true, link: 'pp' },
          { op: '←' },
          { sym: '\\Delta', fmt: 'num2', get: (d) => d.bias, link: 'bias' },
          { op: ',' },
          { sym: 's', fmt: 'num2', get: (d) => d.speed, link: 'bias' },
        ],
      };
    }
    return {
      sym: 'w(\\rho) = \\sqrt{\\textstyle\\sum_{i,j}\\rho^{|i-j|}\\sigma_i\\sigma_j}',
      terms: [
        { sym: 'D', fmt: 'num2', get: (d) => d.D, primary: true, link: 'pp' },
        { op: '←' },
        { sym: 'w/w_{true}', fmt: 'pct', get: (d) => d.tail, link: 'width' },
        { op: ',' },
        { sym: '\\rho', fmt: 'num2', get: (d) => d.rho, link: 'width' },
      ],
    };
  },
  presets: [
    {
      id: 'mack-incurred',
      label: 'Mack On Incurred',
      note: 'The incumbent, tested. Accident years actually move together (ρ = 0.45 here); Mack assumes they do not, so his fan is too thin and outcomes pile up in his extreme percentiles. D blows through the band.',
      mode: 'incurred',
      params: { rho: { value: 0 } },
    },
    {
      id: 'ccl',
      label: 'CCL: Add The Correlation',
      note: 'Same structure, one new parameter: correlation between consecutive accident years. The claimed width climbs to the truth, the p-p plot straightens onto the diagonal, and the KS test goes quiet.',
      mode: 'incurred',
      params: { rho: { value: 0.45 } },
    },
    {
      id: 'mack-paid',
      label: 'Mack And ODP On Paid',
      note: 'Paid models fail DIFFERENTLY: claims have been settling faster, the naive model reads that as growth, and reserves come in high. Outcomes land in the LOW percentiles: a location problem no width fix can cure.',
      mode: 'paid',
      params: { speed: { value: 0 } },
    },
    {
      id: 'csr',
      label: 'CSR: Model The Speedup',
      note: 'The Changing Settlement Rate model gives the speedup its own parameter. Dial s up to the true speedup and the bias dies; the percentiles go uniform. The paid data was never broken: the model was.',
      mode: 'paid',
      params: { speed: { value: 0.35 } },
    },
  ],
  story: [
    {
      title: 'Test the incumbents first',
      text: 'Meyers held something rare in this field: a database of 200 real triangles WHOSE FUTURES HAD ALREADY HAPPENED: the outcomes were settled and known. That let him do to reserving models what backtesting does to trading strategies: no arguing about assumptions, just scorekeeping against reality. The procedure is the Model Validation machine you have already drilled: for each insurer, ask what percentile of Mack’s predictive distribution the actual outcome landed on, then demand the 200 percentiles come out uniform. The stage replays the audit in stylized form: the left panel shows what the model CLAIMED (accent) against the truth (dashed); along the axis, the outcome dots burn red wherever they landed in percentiles the model called nearly impossible. Count the red: far more than the honest handful: and the KS distance blows through the band. Mack on incurred data: the industry’s default: failed its audit. What matters next is not THAT it failed, but the SHAPE of the failure.',
      preset: 'mack-incurred',
    },
    {
      title: 'Commit to a diagnosis',
      text: 'You learned the three fingerprints in the Validation Machine: extremes, middle, one side. Look at where the outcome dots actually land under Mack-incurred, and commit to a diagnosis like a clinician: symptom first, then cause.',
      predict: {
        prompt: 'Outcomes cluster in the EXTREME percentiles (near 0 and 100). The predictive distribution is…',
        options: ['Too narrow: real life keeps escaping its tails', 'Too wide: everything looks middling', 'Biased high: outcomes land low'],
        answer: 0,
        explain: 'An outcome at the 1st or 99th percentile is one the model called a once-in-a-century event: and they keep arriving. Too many extremes means reality keeps escaping the model’s tails: the claimed distribution is too NARROW, understating variability. Notice what the symptom rules OUT, because that is where diagnosis earns its keep: the escapes go in BOTH directions, so this is not bias, and Mack’s central estimates are fine. Nothing is wrong with the point reserve: only with the claimed width around it. A diagnosis that specific tells you exactly what to build: something that widens the distribution without moving its center: and that is precisely what comes next.',
      },
      preset: 'mack-incurred',
    },
    {
      title: 'Diagnose, then build: CCL',
      text: 'WHY is Mack too thin? Follow the cause: his formulas treat the accident years as independent: each year’s luck rolled separately: but real years share calendar-year weather: one inflation spike, one court doctrine, one claims-department reorganization touches every open year at once. And you know from Correlation & Diversification exactly what ignoring shared wobble does to a TOTAL: the width computed under independence, $w(0)$, sits far below the true correlated width: the readout shows the independence claim understating by roughly a third here. So the total reserve’s distribution was built too narrow, and reality kept escaping it: the symptom you just diagnosed, now with its mechanism exposed. Drag $\\rho$ up toward the truth and watch both panels heal in real time: the claimed density widens onto reality and the p-p dots straighten into the band. One added parameter: correlation between accident years: is the entire Correlated Chain Ladder. Not a new philosophy: one diagnosed omission, repaired, and re-audited.',
      preset: 'ccl',
    },
    {
      title: 'The paid side fails differently',
      text: 'Now switch datasets: the same audit, run on models built from PAID losses instead of incurred: and watch the failure change species entirely. Look at the dots: no longer split between both extremes, they pile into the LOW percentiles: outcomes keep landing BELOW where the models pointed. That is not a width problem: it is bias: the models systematically aim high. Try to fix it with the tools from the incurred side: the ρ dial is right there, and it is powerless: widening a distribution that is centered in the wrong place just spreads the wrongness. This is the module’s central skill made concrete: extreme-percentile pileup means too narrow, one-sided slide means biased, middle-crowding means too wide: and each fingerprint demands its OWN repair. Diagnosing WHICH failure you are looking at, before reaching for a fix, is what separates Meyers’ method from the model-shopping it replaced: where practitioners swapped models until one flattered the data, learning nothing.',
      preset: 'mack-paid',
    },
    {
      title: 'CSR: model the speedup',
      text: 'The diagnosis for the paid side: across the database’s calendar years, claims had been SETTLING FASTER: better claims systems, earlier settlements: and a development method that assumes a frozen payout pattern cannot tell "money arriving sooner" from "more money coming". It reads speed as growth and projects high: the one-sided bias you just watched. The repair is again a single honest parameter: give the settlement rate its own dial $s$, with its own prior, and let each triangle’s data say how much speedup it actually contains. Slide $s$ toward the truth and watch the residual bias die and the percentiles spread back into uniformity. Note the craftsmanship in what did NOT change: the model still cannot manufacture a low reserve to flatter anyone: it can only reallocate TIMING, which is exactly the thing the diagnosis implicated. The dedicated CSR module, one shelf over, opens this model’s interior lag by lag: here, what matters is that it exists as an ANSWER to a specific, demonstrated failure.',
      preset: 'csr',
    },
    {
      title: 'The discipline is the content',
      text: 'Step back and name what you actually watched, because it was a LOOP, not a leaderboard. Validate against real outcomes. Read the failure’s SHAPE: thin tails on incurred, bias on paid: because the shape is the diagnosis. Build the SMALLEST model that repairs that specific shape: one correlation parameter for the width failure, one settlement-rate parameter for the bias: never a kitchen-sink rebuild that fixes everything and explains nothing. Then re-validate, because a repair is a hypothesis until reality grades it. Notice what the loop never required: nothing about it is inherently Bayesian or MCMC: those are Meyers’ TOOLS, chosen because posteriors handle many-parameter models gracefully: the loop itself is just honest science applied to reserving. The exam will ask which model fixes which failure, and you now know that cold. But the durable lesson is the loop: it is how every model on this ladder: Mack, Clark, Shapland, all of them: deserves to be read: as an answer to a diagnosed failure of the one before it.',
      preset: 'ccl',
    },
  ],
  checks: [
    { name: 'Width is monotone in ρ', expect: 1, tol: 0, got: () => { let prev = 0, ok = 1; for (let r = 0; r <= 0.71; r += 0.05) { const w = clCclWidth(ARC_SDS, r); if (w <= prev) ok = 0; prev = w; } return ok; } },
    { name: 'ρ = 0 is quadrature: matches √(Σσ²)', expect: 0, tol: 1e-9, got: () => clCclWidth(ARC_SDS, 0) - Math.sqrt(ARC_SDS.reduce((a, s) => a + s * s, 0)) },
    { name: 'Two-year cross-check against the correlation module’s identity', expect: 0, tol: 1e-9, got: () => clCclWidth([3, 4], 0.5) - clSumSd(3, 4, 0.5) },
    { name: 'Mack-incurred (ρ = 0) fails the KS band', expect: 1, tol: 0, got: () => { const tail = clCclWidth(ARC_SDS, 0) / clCclWidth(ARC_SDS, ARC_TRUE_RHO); return clValidationRun({ n: ARC_N, bias: 0, tail, seed: ARC_SEED }).D > clKsBand(ARC_N) ? 1 : 0; } },
    { name: 'CCL at the true ρ passes the band', expect: 1, tol: 0, got: () => (clValidationRun({ n: ARC_N, bias: 0, tail: 1, seed: ARC_SEED }).D < clKsBand(ARC_N) ? 1 : 0) },
    { name: 'Naive paid (bias 0.35) fails the band', expect: 1, tol: 0, got: () => (clValidationRun({ n: ARC_N, bias: ARC_TRUE_BIAS, tail: 1, seed: ARC_SEED }).D > clKsBand(ARC_N) ? 1 : 0) },
    { name: 'The independence claim understates width by a third or more', expect: 1, tol: 0, got: () => (clCclWidth(ARC_SDS, 0) / clCclWidth(ARC_SDS, ARC_TRUE_RHO) < 0.87 ? 1 : 0) },
  ],
});

// ============================================================================
// SECTION 3: STYLES — single injected <style>, guarded (flashcards pattern)
// ============================================================================

let _stylesInjected = false;

function injectStyles() {
  if (_stylesInjected) return;
  _stylesInjected = true;
  const style = document.createElement('style');
  style.id = 'concept-lab-styles';
  style.textContent = CL_CSS;
  document.head.appendChild(style);
}

const CL_CSS = `
.cl-root {
  /* Chart inks — budget's CVD-validated dataviz set (passes adjacent-pair
     ΔE on light AND dark surfaces); sanctioned extension domain colors. */
  --cl-ink-1: #5a8bca;
  --cl-ink-2: #a43b38;
  --cl-ink-3: #5da56e;
  --cl-ink-4: #965719;
  --cl-ink-5: #784d96;
  --cl-ink-6: #a9912b;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--px-bg);
  color: var(--px-text);
  font-family: var(--parallx-fontFamily-ui, sans-serif);
  overflow: hidden;
}

/* ── Header ─────────────────────────────────────────────────────────── */
.cl-header {
  display: flex;
  align-items: center;
  gap: var(--px-space-3);
  padding: var(--px-space-3) var(--px-space-4);
  border-bottom: 1px solid var(--px-divider);
  flex: 0 0 auto;
}
.cl-back {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: var(--px-radius-md);
  background: transparent;
  color: var(--px-text-secondary);
  cursor: pointer;
  transition: background var(--px-dur-fast) var(--px-ease), color var(--px-dur-fast) var(--px-ease);
}
.cl-back:hover { background: var(--px-surface-hover); color: var(--px-text); }
.cl-header-titles { flex: 1 1 auto; min-width: 0; }
.cl-title {
  font-size: var(--px-text-md);
  font-weight: 600;
  letter-spacing: 0.01em;
}
.cl-subtitle {
  font-size: var(--px-text-xs);
  color: var(--px-text-muted);
  margin-top: 1px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cl-source-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--px-space-1);
  padding: 3px var(--px-space-2);
  border: 1px solid var(--px-divider);
  border-radius: var(--px-radius-full);
  font-size: var(--px-text-2xs);
  color: var(--px-text-muted);
  white-space: nowrap;
  flex: 0 0 auto;
}
.cl-source-chip .cl-chip-icon { display: inline-flex; opacity: 0.7; }

/* ── Story strip ────────────────────────────────────────────────────── */
/* The understand column: step, formula, live numbers — ONE surface to
   read, beside a stage that stays pure picture. */
.cl-story {
  flex: 0 0 288px;
  display: flex;
  flex-direction: column;
  gap: var(--px-space-2);
  padding: var(--px-space-3) var(--px-space-4);
  border-right: 1px solid var(--px-divider);
  background: var(--px-bg-inset);
  overflow-y: auto;
}
.cl-story .cl-under {
  border-top: 1px solid var(--px-divider);
  padding-top: var(--px-space-3);
  margin-top: var(--px-space-2);
  flex: 0 0 auto;
}
.cl-story-intro {
  font-size: var(--px-text-xs);
  color: var(--px-text-muted);
  line-height: var(--px-leading-base);
  padding-bottom: var(--px-space-2);
  border-bottom: 1px solid var(--px-divider);
  flex: 0 0 auto;
}
.cl-story-nav {
  display: flex;
  align-items: center;
  gap: var(--px-space-1);
  flex: 0 0 auto;
}
.cl-story-dot {
  width: 8px;
  height: 8px;
  border-radius: var(--px-radius-full);
  border: none;
  padding: 0;
  background: var(--px-surface-active);
  cursor: pointer;
  transition: background var(--px-dur-fast) var(--px-ease), transform var(--px-dur-fast) var(--px-ease-spring);
}
.cl-story-dot:hover { transform: scale(1.35); }
.cl-story-dot.cl-active { background: var(--px-accent); transform: scale(1.2); }
.cl-story-text {
  flex: 0 0 auto;
  min-width: 0;
  font-size: var(--px-text-sm);
  color: var(--px-text-secondary);
  line-height: var(--px-leading-base);
  animation: cl-fade-rise var(--px-dur-base) var(--px-ease-out);
}
.cl-story-text .cl-story-step-title {
  display: block;
  font-weight: 600;
  color: var(--px-text);
  margin-bottom: var(--px-space-1);
}
.cl-story-text .px-markdown p { margin: 0 0 var(--px-space-2); }
.cl-story-text .px-markdown p:last-child { margin-bottom: 0; }
.cl-story-btn {
  border: none;
  background: transparent;
  color: var(--px-text-muted);
  width: 24px;
  height: 24px;
  border-radius: var(--px-radius-sm);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background var(--px-dur-fast) var(--px-ease), color var(--px-dur-fast) var(--px-ease);
}
.cl-story-btn:hover { background: var(--px-surface-hover); color: var(--px-text); }
.cl-story-btn:disabled { opacity: 0.35; cursor: default; }
.cl-scene-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--px-space-1);
  border: 1px solid var(--px-divider);
  background: transparent;
  color: var(--px-text-secondary);
  font-size: var(--px-text-2xs);
  font-weight: 500;
  padding: 2px var(--px-space-2);
  border-radius: var(--px-radius-full);
  cursor: pointer;
  transition: background var(--px-dur-fast) var(--px-ease), color var(--px-dur-fast) var(--px-ease);
}
.cl-scene-btn:hover { background: var(--px-surface-hover); color: var(--px-text); }
.cl-scene-btn:active { transform: var(--px-press); }

/* ── Body: rail + stage ─────────────────────────────────────────────── */
.cl-body {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
}
.cl-rail {
  flex: 0 0 272px;
  display: flex;
  flex-direction: column;
  gap: var(--px-space-4);
  padding: var(--px-space-4);
  border-left: 1px solid var(--px-divider);
  overflow-y: auto;
}
.cl-rail-label {
  font-size: var(--px-text-2xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--px-text-faint);
  margin-bottom: var(--px-space-2);
}
.cl-presets { display: flex; flex-wrap: wrap; gap: var(--px-space-1); }
.cl-preset-chip {
  border: 1px solid var(--px-divider);
  background: transparent;
  color: var(--px-text-secondary);
  font-size: var(--px-text-xs);
  padding: 3px var(--px-space-2);
  border-radius: var(--px-radius-full);
  cursor: pointer;
  transition: background var(--px-dur-fast) var(--px-ease), color var(--px-dur-fast) var(--px-ease),
    border-color var(--px-dur-fast) var(--px-ease);
}
.cl-preset-chip:hover { background: var(--px-surface-hover); color: var(--px-text); }
.cl-preset-chip.cl-active {
  background: var(--px-accent-soft);
  border-color: var(--px-accent);
  color: var(--px-text);
}
.cl-preset-note {
  font-size: var(--px-text-xs);
  color: var(--px-text-muted);
  line-height: var(--px-leading-base);
  margin-top: var(--px-space-2);
  animation: cl-fade-rise var(--px-dur-base) var(--px-ease-out);
}

.cl-slider-row { margin-bottom: var(--px-space-3); }
.cl-slider-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 2px;
}
.cl-slider-sym { display: inline-flex; align-items: baseline; gap: var(--px-space-2); }
.cl-slider-sym .px-markdown { display: inline; }
.cl-slider-sym .px-markdown p { display: inline; margin: 0; }
.cl-slider-name {
  font-size: var(--px-text-2xs);
  color: var(--px-text-faint);
}
.cl-slider-value {
  font-family: var(--parallx-fontFamily-mono, monospace);
  font-variant-numeric: tabular-nums;
  font-size: var(--px-text-xs);
  color: var(--px-text);
  transition: color var(--px-dur-fast) var(--px-ease);
}
.cl-slider-row.cl-hot .cl-slider-value { color: var(--px-accent); }
.cl-slider-input {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 14px;
  margin: 0;
  background: transparent;
  cursor: pointer;
}
.cl-slider-input::-webkit-slider-runnable-track {
  height: 3px;
  border-radius: var(--px-radius-full);
  background: linear-gradient(to right,
    var(--px-accent) 0%, var(--px-accent) var(--cl-fill, 50%),
    var(--px-surface-active) var(--cl-fill, 50%), var(--px-surface-active) 100%);
}
.cl-slider-input::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 12px;
  height: 12px;
  margin-top: -4.5px;
  border-radius: var(--px-radius-full);
  background: var(--px-accent);
  border: 2px solid var(--px-bg);
  box-shadow: var(--px-shadow-sm);
  transition: transform var(--px-dur-fast) var(--px-ease-spring);
}
.cl-slider-input:hover::-webkit-slider-thumb { transform: scale(1.25); }
.cl-slider-input:active::-webkit-slider-thumb { transform: scale(1.4); }
.cl-slider-input:focus-visible { outline: none; }
.cl-slider-input:focus-visible::-webkit-slider-thumb { box-shadow: var(--px-ring-accent); }

.cl-readouts {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--px-space-2) var(--px-space-3);
}
.cl-readout-label {
  font-size: var(--px-text-2xs);
  color: var(--px-text-faint);
}
.cl-readout-label .px-markdown { display: inline; }
.cl-readout-label .px-markdown p { display: inline; margin: 0; }
.cl-readout-value {
  font-family: var(--parallx-fontFamily-mono, monospace);
  font-variant-numeric: tabular-nums;
  font-size: var(--px-text-sm);
  color: var(--px-text);
}
.cl-readout-value.cl-accent { color: var(--px-accent); }

.cl-ghost-row { display: flex; flex-wrap: wrap; gap: var(--px-space-1); align-items: center; }
.cl-ghost-btn {
  border: 1px dashed var(--px-border);
  background: transparent;
  color: var(--px-text-muted);
  font-size: var(--px-text-xs);
  padding: 3px var(--px-space-2);
  border-radius: var(--px-radius-full);
  cursor: pointer;
  transition: color var(--px-dur-fast) var(--px-ease), border-color var(--px-dur-fast) var(--px-ease);
}
.cl-ghost-btn:hover { color: var(--px-text); border-color: var(--px-border-strong); }
.cl-ghost-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--px-space-1);
  border: 1px solid var(--px-divider);
  background: var(--px-bg-inset);
  color: var(--px-text-muted);
  font-size: var(--px-text-2xs);
  padding: 2px var(--px-space-2);
  border-radius: var(--px-radius-full);
  cursor: pointer;
  transition: color var(--px-dur-fast) var(--px-ease);
}
.cl-ghost-chip:hover { color: var(--px-danger); }

/* ── Stage ──────────────────────────────────────────────────────────── */
.cl-stage-col {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}
.cl-stage-row {
  display: flex;
  gap: var(--px-space-4);
  padding: var(--px-space-4);
  flex: 1 1 auto;
  min-height: 260px;
}
.cl-scene {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--px-divider);
  border-radius: var(--px-radius-lg);
  background: var(--px-bg-inset);
  overflow: hidden;
  animation: cl-fade-rise var(--px-dur-slow) var(--px-ease-out);
}
.cl-scene-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--px-space-2) var(--px-space-3);
  font-size: var(--px-text-xs);
  font-weight: 600;
  color: var(--px-text-secondary);
  letter-spacing: 0.02em;
}
.cl-scene-legend { display: flex; gap: var(--px-space-3); font-weight: 400; }
.cl-legend-item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: var(--px-text-2xs);
  color: var(--px-text-muted);
  transition: color var(--px-dur-fast) var(--px-ease);
}
.cl-legend-item.cl-hot { color: var(--px-text); }
.cl-legend-swatch {
  width: 14px;
  height: 0;
  border-top: 2px solid currentColor;
  border-radius: 1px;
}
.cl-legend-swatch.cl-dashed { border-top-style: dashed; }
.cl-svg-wrap { flex: 1 1 auto; min-height: 0; position: relative; }
.cl-svg { display: block; width: 100%; height: 100%; }
.cl-svg text {
  font-family: var(--parallx-fontFamily-ui, sans-serif);
  font-variant-numeric: tabular-nums;
}

/* SVG element roles — colors come from currentColor set inline per element */
.cl-grid-line { stroke: var(--px-divider); stroke-width: 1; }
.cl-axis-label { fill: var(--px-text-faint); font-size: 10px; }
.cl-curve {
  fill: none;
  stroke-width: 2.25;
  stroke-linecap: round;
  stroke-linejoin: round;
  transition: opacity var(--px-dur-fast) var(--px-ease), stroke-width var(--px-dur-fast) var(--px-ease);
}
.cl-curve.cl-ref { stroke-width: 1.5; stroke-dasharray: 5 4; opacity: 0.75; }
.cl-dim .cl-curve:not(.cl-hot) { opacity: 0.18; }
.cl-dim .cl-dot:not(.cl-hot) { opacity: 0.18; }
.cl-curve.cl-hot { stroke-width: 3; opacity: 1; }
.cl-ghost-curve { fill: none; stroke: var(--px-text-faint); stroke-width: 1.5; opacity: 0.5; stroke-dasharray: 2 3; }
.cl-band { opacity: 0.16; }
.cl-bar { opacity: 0.85; }
.cl-bar--cmp { opacity: 0.4; }
.cl-dim .cl-bar { opacity: 0.15; }
.cl-dim .cl-hot .cl-bar { opacity: 0.85; }
.cl-dim .cl-hot .cl-bar--cmp { opacity: 0.4; }
.cl-dim .cl-band { opacity: 0.05; }
.cl-dim .cl-band.cl-hot { opacity: 0.16; }
.cl-dot { transition: opacity var(--px-dur-fast) var(--px-ease); }
.cl-marker-line { stroke: var(--px-text-muted); stroke-width: 1; stroke-dasharray: 3 3; opacity: 0.7; }
.cl-svg-value {
  fill: var(--px-text);
  font-size: 11px;
  font-weight: 600;
}
.cl-svg-tag { fill: var(--px-text-muted); font-size: 9.5px; }
.cl-region { opacity: 0.10; transition: opacity var(--px-dur-base) var(--px-ease); }
.cl-region.cl-active-region { opacity: 0.22; }
.cl-region-label { font-size: 10px; font-weight: 600; opacity: 0.85; }

/* ── Meters ─────────────────────────────────────────────────────────── */
.cl-meter-wrap { padding: 0 var(--px-space-3) var(--px-space-3); }
.cl-meter-head {
  display: flex;
  justify-content: space-between;
  font-size: var(--px-text-2xs);
  color: var(--px-text-faint);
  margin-bottom: 3px;
}
.cl-meter {
  position: relative;
  height: 6px;
  border-radius: var(--px-radius-full);
  background: var(--px-surface-active);
  overflow: visible;
}
.cl-meter-fill {
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: var(--px-radius-full);
  background: var(--px-accent);
  transition: width var(--px-dur-fast) linear;
}
.cl-meter.cl-hot .cl-meter-fill { box-shadow: 0 0 0 3px var(--px-accent-faint); }

/* ── Formula panel ──────────────────────────────────────────────────── */
.cl-formula-bar {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--px-space-2);
  overflow-x: auto;
}
.cl-formula-sym {
  color: var(--px-text-muted);
  font-size: var(--px-text-sm);
  flex: 0 0 auto;
}
.cl-formula-sym .px-markdown p { margin: 0; }
.cl-terms { display: flex; align-items: center; gap: var(--px-space-1); flex-wrap: wrap; }
.cl-term {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  padding: var(--px-space-1) var(--px-space-2);
  border-radius: var(--px-radius-md);
  transition: background var(--px-dur-fast) var(--px-ease);
}
.cl-term.cl-linked { cursor: default; }
.cl-term.cl-linked:hover, .cl-term.cl-hot { background: var(--px-accent-faint); }
.cl-term-sym { font-size: var(--px-text-sm); color: var(--px-text-secondary); }
.cl-term-sym .px-markdown p { margin: 0; }
.cl-term-val {
  font-family: var(--parallx-fontFamily-mono, monospace);
  font-variant-numeric: tabular-nums;
  font-size: var(--px-text-sm);
  color: var(--px-text);
}
.cl-term.cl-primary .cl-term-val { color: var(--px-accent); font-weight: 600; }
.cl-op {
  font-size: var(--px-text-md);
  color: var(--px-text-faint);
  padding-bottom: 2px;
}

/* ── Home guide ─────────────────────────────────────────────────────── */
.cl-guide {
  border: 1px solid var(--px-divider);
  border-radius: var(--px-radius-lg);
  background: var(--px-bg-inset);
  padding: var(--px-space-4);
  margin-bottom: var(--px-space-6);
}
.cl-guide-title {
  font-size: var(--px-text-xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--px-text-faint);
  margin-bottom: var(--px-space-3);
}
.cl-guide-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: var(--px-space-3) var(--px-space-4);
}
.cl-guide-item {
  display: flex;
  gap: var(--px-space-2);
  align-items: flex-start;
}
.cl-guide-icon {
  display: inline-flex;
  color: var(--px-accent);
  flex: 0 0 auto;
  margin-top: 1px;
}
.cl-guide-head {
  font-size: var(--px-text-sm);
  font-weight: 600;
  color: var(--px-text);
}
.cl-guide-text {
  font-size: var(--px-text-xs);
  color: var(--px-text-muted);
  line-height: var(--px-leading-base);
  margin-top: 1px;
}

/* ── Home (module cards) ────────────────────────────────────────────── */
.cl-home {
  flex: 1 1 auto;
  overflow-y: auto;
  padding: var(--px-space-8);
}
.cl-home-title { font-size: var(--px-text-lg); font-weight: 650; }
.cl-home-sub {
  font-size: var(--px-text-sm);
  color: var(--px-text-muted);
  margin: var(--px-space-1) 0 var(--px-space-6);
}
.cl-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: var(--px-space-4);
}
.cl-card {
  border: 1px solid var(--px-divider);
  border-radius: var(--px-radius-lg);
  background: var(--px-bg-inset);
  padding: var(--px-space-4);
  cursor: pointer;
  transition: border-color var(--px-dur-fast) var(--px-ease), transform var(--px-dur-fast) var(--px-ease),
    box-shadow var(--px-dur-fast) var(--px-ease);
  animation: cl-fade-rise var(--px-dur-slow) var(--px-ease-out) backwards;
}
.cl-card:hover {
  border-color: var(--px-accent);
  transform: translateY(-1px);
  box-shadow: var(--px-shadow-md);
}
.cl-card:active { transform: var(--px-press); }
.cl-card-head { display: flex; align-items: center; gap: var(--px-space-2); margin-bottom: var(--px-space-2); }
.cl-card-icon { display: inline-flex; color: var(--px-accent); }
.cl-card-title { font-size: var(--px-text-base); font-weight: 600; }
.cl-card-sub {
  font-size: var(--px-text-xs);
  color: var(--px-text-muted);
  line-height: var(--px-leading-base);
  margin-bottom: var(--px-space-3);
}
.cl-card-paper {
  font-size: var(--px-text-2xs);
  color: var(--px-text-faint);
  border-top: 1px solid var(--px-divider);
  padding-top: var(--px-space-2);
}

/* ── Home ladder ────────────────────────────────────────────────────── */
.cl-level { margin-bottom: var(--px-space-8); }
.cl-level-head {
  display: flex;
  align-items: flex-start;
  gap: var(--px-space-3);
  margin-bottom: var(--px-space-3);
  padding-bottom: var(--px-space-2);
  border-bottom: 1px solid var(--px-divider);
}
.cl-level-num {
  font-size: var(--px-text-xl);
  font-weight: 700;
  color: var(--px-text-faint);
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
}
.cl-level-title { font-size: var(--px-text-md); font-weight: 650; }
.cl-level-tag { font-size: var(--px-text-xs); color: var(--px-text-muted); }

/* ── Connections: Builds On / Where The Exam Uses This ──────────────── */
.cl-conn-label { display: flex; align-items: center; gap: var(--px-space-1); }
.cl-conn-label-icon { display: inline-flex; opacity: 0.8; }
.cl-conn-row {
  display: block;
  width: 100%;
  text-align: left;
  border: 1px solid var(--px-divider);
  border-radius: var(--px-radius-md);
  background: none;
  padding: var(--px-space-2);
  margin-top: var(--px-space-2);
  cursor: pointer;
  font: inherit;
  color: inherit;
  transition: border-color var(--px-dur-fast) var(--px-ease), background var(--px-dur-fast) var(--px-ease);
}
.cl-conn-row:hover { border-color: var(--px-accent); background: var(--px-surface-hover); }
.cl-conn-row:active { transform: var(--px-press); }
.cl-conn-title {
  display: flex;
  align-items: center;
  gap: var(--px-space-2);
  font-size: var(--px-text-sm);
  font-weight: 600;
  color: var(--px-text);
}
.cl-conn-title svg { color: var(--px-text-secondary); flex: 0 0 auto; }
.cl-conn-text {
  display: block;
  font-size: var(--px-text-xs);
  color: var(--px-text-muted);
  margin-top: 2px;
  line-height: var(--px-leading-base);
}

/* ── Predict-then-reveal ────────────────────────────────────────────── */
.cl-predict { margin-top: var(--px-space-2); }
.cl-predict-prompt {
  display: flex;
  align-items: center;
  gap: var(--px-space-2);
  font-size: var(--px-text-sm);
  font-weight: 600;
}
.cl-predict-icon { display: inline-flex; color: var(--px-accent); }
.cl-predict-opts { display: flex; flex-direction: column; align-items: stretch; gap: var(--px-space-2); margin-top: var(--px-space-2); }
.cl-predict-opt {
  font: inherit;
  font-size: var(--px-text-sm);
  color: var(--px-text-secondary);
  background: var(--px-bg-elevated);
  border: 1px solid var(--px-border);
  border-radius: var(--px-radius-md);
  padding: var(--px-space-1) var(--px-space-3);
  text-align: left;
  cursor: pointer;
  transition: border-color var(--px-dur-fast) var(--px-ease), color var(--px-dur-fast) var(--px-ease);
}
.cl-predict-opt:hover:not(:disabled) { border-color: var(--px-accent); color: var(--px-text); }
.cl-predict-opt:active:not(:disabled) { transform: var(--px-press); }
.cl-predict-opt:disabled { cursor: default; opacity: 0.7; }
.cl-predict-opt.cl-right { border-color: var(--px-success); color: var(--px-success); opacity: 1; }
.cl-predict-opt.cl-wrong { border-color: var(--px-danger); color: var(--px-danger); opacity: 1; }
.cl-predict-explain {
  font-size: var(--px-text-xs);
  color: var(--px-text-muted);
  margin-top: var(--px-space-2);
  line-height: var(--px-leading-base);
}
.cl-conn-row:focus-visible, .cl-predict-opt:focus-visible { outline: none; box-shadow: var(--px-ring-accent); }

/* ── Sidebar ────────────────────────────────────────────────────────── */
.cl-side { display: flex; flex-direction: column; gap: 2px; padding: var(--px-space-2); }
.cl-side-level {
  font-size: var(--px-text-2xs);
  font-weight: 650;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--px-text-faint);
  padding: var(--px-space-3) var(--px-space-2) var(--px-space-1);
}
.cl-side-row {
  display: flex;
  align-items: center;
  gap: var(--px-space-2);
  padding: var(--px-space-1) var(--px-space-2);
  border-radius: var(--px-radius-md);
  cursor: pointer;
  font-size: var(--px-text-sm);
  color: var(--px-text-secondary);
  transition: background var(--px-dur-fast) var(--px-ease), color var(--px-dur-fast) var(--px-ease);
}
.cl-side-row:hover { background: var(--px-surface-hover); color: var(--px-text); }
.cl-side-row .cl-side-icon { display: inline-flex; opacity: 0.8; }

@keyframes cl-fade-rise {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: none; }
}
@keyframes cl-draw-in {
  from { stroke-dashoffset: var(--cl-len, 1200); }
  to { stroke-dashoffset: 0; }
}
`;

// ============================================================================
// SECTION 4: UI FRAMEWORK (tween engine, formula renderer, SVG stage)
// ============================================================================

const SVG_NS = 'http://www.w3.org/2000/svg';

function clFmt(v, fmt) {
  if (!Number.isFinite(v)) return '—';
  switch (fmt) {
    case 'pct': return (v * 100).toFixed(1) + '%';
    case 'pct2': return (v * 100).toFixed(2) + '%';
    case 'num2': return v.toFixed(2);
    case 'num3': return v.toFixed(3);
    default: {
      const a = Math.abs(v);
      if (a >= 1000) return Math.round(v).toLocaleString('en-US');
      if (a >= 100) return v.toFixed(1);
      return v.toFixed(2);
    }
  }
}

/** Inline KaTeX via the shared renderer; plain-text fallback for test envs. */
function clTex(tex) {
  if (_api?.ui?.renderMarkdown) {
    try { return _api.ui.renderMarkdown('$' + tex + '$'); } catch { /* fall through */ }
  }
  const span = document.createElement('span');
  span.textContent = tex;
  return span;
}

/** Markdown+KaTeX block via the shared renderer, with plain fallback. */
function clMd(markdown) {
  if (_api?.ui?.renderMarkdown) {
    try { return _api.ui.renderMarkdown(markdown); } catch { /* fall through */ }
  }
  const div = document.createElement('div');
  div.textContent = markdown;
  return div;
}

function clIcon(id, size) {
  if (_api?.icons?.createIconHtml) {
    try { return _api.icons.createIconHtml(id, size || 16); } catch { /* fall through */ }
  }
  return '';
}

function clRafThrottle(fn) {
  if (_api?.ui?.rafThrottle) return _api.ui.rafThrottle(fn);
  let scheduled = false;
  let lastArgs = [];
  const wrapped = (...args) => {
    lastArgs = args;
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; fn(...lastArgs); });
  };
  wrapped.dispose = () => {};
  wrapped.flush = () => {};
  return wrapped;
}

/** Read a --px motion duration once; JS tweens must match the CSS vocabulary. */
let _motionMs = null;
function clMotion() {
  if (_motionMs) return _motionMs;
  let base = 180, slow = 260;
  try {
    const cs = getComputedStyle(document.documentElement);
    const parse = (name, fb) => {
      const raw = cs.getPropertyValue(name).trim();
      const n = parseFloat(raw);
      return Number.isFinite(n) ? n : fb;
    };
    base = parse('--px-dur-base', 180);
    slow = parse('--px-dur-slow', 260);
  } catch { /* jsdom */ }
  _motionMs = { base, slow };
  return _motionMs;
}

/** cubic-bezier solver — matches --px-ease (0.22, 1, 0.36, 1). */
function clCubicBezier(p1x, p1y, p2x, p2y) {
  const cx = 3 * p1x, bx = 3 * (p2x - p1x) - cx, ax = 1 - cx - bx;
  const cy = 3 * p1y, by = 3 * (p2y - p1y) - cy, ay = 1 - cy - by;
  const sampleX = (t) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t) => ((ay * t + by) * t + cy) * t;
  const sampleDX = (t) => (3 * ax * t + 2 * bx) * t + cx;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 6; i++) {
      const err = sampleX(t) - x;
      if (Math.abs(err) < 1e-6) return sampleY(t);
      const d = sampleDX(t);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    let lo = 0, hi = 1;
    t = x;
    while (hi - lo > 1e-6) {
      if (sampleX(t) < x) lo = t; else hi = t;
      t = (lo + hi) / 2;
    }
    return sampleY(t);
  };
}

const CL_EASE_SETTLE = clCubicBezier(0.22, 1, 0.36, 1);

/**
 * One shared animation loop per pane. Numeric tweens (preset transitions)
 * and smooth-approach values (axis domains) both tick here; the loop stops
 * itself when everything settles so an idle pane costs nothing.
 */
function createAnimator(onFrame) {
  const tweens = new Map();
  const smooths = new Set();
  const loops = new Map();
  let rafId = 0;
  let last = 0;
  let disposed = false;

  function tick(now) {
    rafId = 0;
    if (disposed) return;
    const dt = last ? Math.min(64, now - last) : 16;
    last = now;
    let active = false;
    for (const [key, tw] of tweens) {
      const t = Math.min(1, (now - tw.start) / tw.dur);
      tw.apply(tw.from + (tw.to - tw.from) * CL_EASE_SETTLE(t));
      if (t >= 1) tweens.delete(key); else active = true;
    }
    for (const sm of smooths) {
      const gap = sm.target - sm.current;
      if (Math.abs(gap) < sm.eps) {
        sm.current = sm.target;
        smooths.delete(sm);
      } else {
        sm.current += gap * (1 - Math.exp(-dt / sm.tau));
        active = true;
      }
    }
    for (const fn of loops.values()) fn(dt);
    if (loops.size > 0) active = true;
    onFrame();
    if (active) schedule(); else last = 0;
  }

  function schedule() {
    if (!rafId && !disposed) rafId = requestAnimationFrame(tick);
  }

  return {
    /** Tween a value; `apply` receives each eased intermediate. */
    tween(key, from, to, dur, apply) {
      tweens.set(key, { from, to, dur, apply, start: performance.now() });
      schedule();
    },
    /** Smooth-approach handle: set `.target`, read `.current`. */
    smooth(initial, tau = 90, eps = 1e-4) {
      const sm = { current: initial, target: initial, tau, eps };
      return {
        get current() { return sm.current; },
        set target(v) {
          if (v === sm.target) return;
          sm.target = v;
          smooths.add(sm);
          schedule();
        },
        get target() { return sm.target; },
        snap(v) { sm.current = v; sm.target = v; smooths.delete(sm); },
      };
    },
    /** Run fn(dt) every frame until stopped — keeps the loop alive. */
    loop(key, fn) { loops.set(key, fn); schedule(); },
    stopLoop(key) { loops.delete(key); },
    hasLoop(key) { return loops.has(key); },
    /** Request a plain redraw frame outside any tween. */
    invalidate() { schedule(); },
    cancel(key) { tweens.delete(key); },
    dispose() { disposed = true; if (rafId) cancelAnimationFrame(rafId); tweens.clear(); smooths.clear(); loops.clear(); },
  };
}

// --- SVG helpers -----------------------------------------------------------

function svgEl(tag, attrs, cls) {
  const el = document.createElementNS(SVG_NS, tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  if (cls) el.setAttribute('class', cls);
  return el;
}

function clScale(d0, d1, r0, r1) {
  const dd = d1 - d0 || 1;
  const f = (v) => r0 + ((v - d0) / dd) * (r1 - r0);
  f.invert = (r) => d0 + ((r - r0) / (r1 - r0)) * dd;
  return f;
}

function clNiceTicks(min, max, count = 5) {
  const span = max - min;
  if (!(span > 0)) return [min];
  const step0 = span / Math.max(1, count);
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  let step = mag;
  for (const m of [1, 2, 2.5, 5, 10]) {
    if (step0 <= m * mag) { step = m * mag; break; }
  }
  const ticks = [];
  const start = Math.ceil(min / step) * step;
  for (let v = start; v <= max + step * 1e-9; v += step) ticks.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return ticks;
}

/**
 * Pooled axis renderer — reuses tick nodes across frames so a tweening
 * domain does not churn the DOM at 60fps.
 */
function createAxes(parent, opts) {
  const g = svgEl('g');
  parent.appendChild(g);
  const pool = new Map();
  return {
    update(sx, sy, frame) {
      const { left, top, right, bottom } = frame;
      const seen = new Set();
      const put = (key, make, updateFn) => {
        let node = pool.get(key);
        if (!node) { node = make(); pool.set(key, node); g.appendChild(node); }
        updateFn(node);
        seen.add(key);
      };
      const xt = clNiceTicks(sx.invert(left), sx.invert(right), opts.xTicks || 5);
      for (const v of xt) {
        const px = sx(v);
        if (px < left - 0.5 || px > right + 0.5) continue;
        put('gx' + v, () => svgEl('line', {}, 'cl-grid-line'), (n) => {
          n.setAttribute('x1', px); n.setAttribute('x2', px);
          n.setAttribute('y1', top); n.setAttribute('y2', bottom);
        });
        put('lx' + v, () => svgEl('text', { 'text-anchor': 'middle' }, 'cl-axis-label'), (n) => {
          n.setAttribute('x', px); n.setAttribute('y', bottom + 14);
          n.textContent = opts.xFmt ? opts.xFmt(v) : String(v);
        });
      }
      const yt = clNiceTicks(sy.invert(bottom), sy.invert(top), opts.yTicks || 5);
      for (const v of yt) {
        const py = sy(v);
        if (py < top - 0.5 || py > bottom + 0.5) continue;
        put('gy' + v, () => svgEl('line', {}, 'cl-grid-line'), (n) => {
          n.setAttribute('x1', left); n.setAttribute('x2', right);
          n.setAttribute('y1', py); n.setAttribute('y2', py);
        });
        put('ly' + v, () => svgEl('text', { 'text-anchor': 'end' }, 'cl-axis-label'), (n) => {
          n.setAttribute('x', left - 6); n.setAttribute('y', py + 3.5);
          n.textContent = opts.yFmt ? opts.yFmt(v) : String(v);
        });
      }
      for (const [key, node] of pool) {
        if (!seen.has(key)) { node.remove(); pool.delete(key); }
      }
    },
  };
}

function clPathFrom(points) {
  if (!points.length) return '';
  let d = 'M' + points[0][0].toFixed(1) + ',' + points[0][1].toFixed(1);
  for (let i = 1; i < points.length; i++) {
    d += 'L' + points[i][0].toFixed(1) + ',' + points[i][1].toFixed(1);
  }
  return d;
}

// --- Hover linking: formula terms <-> stage elements <-> legend ------------

function clWireHover(sourceEl, linkName, root) {
  const on = () => {
    root.classList.add('cl-dim');
    for (const el of root.querySelectorAll(`[data-cl-link="${linkName}"]`)) el.classList.add('cl-hot');
    sourceEl.classList.add('cl-hot');
  };
  const off = () => {
    root.classList.remove('cl-dim');
    for (const el of root.querySelectorAll(`[data-cl-link="${linkName}"]`)) el.classList.remove('cl-hot');
    sourceEl.classList.remove('cl-hot');
  };
  sourceEl.addEventListener('mouseenter', on);
  sourceEl.addEventListener('mouseleave', off);
}

// --- Control rail builders -------------------------------------------------

function buildSlider(container, def, range, value, onInput, linkRoot) {
  const row = document.createElement('div');
  row.className = 'cl-slider-row';
  if (def.link && linkRoot) {
    row.dataset.clLink = def.link;
    clWireHover(row, def.link, linkRoot);
  }

  const head = document.createElement('div');
  head.className = 'cl-slider-head';
  const sym = document.createElement('span');
  sym.className = 'cl-slider-sym';
  sym.appendChild(clTex(def.tex));
  const name = document.createElement('span');
  name.className = 'cl-slider-name';
  name.textContent = def.label;
  sym.appendChild(name);
  const val = document.createElement('span');
  val.className = 'cl-slider-value';
  head.appendChild(sym);
  head.appendChild(val);
  row.appendChild(head);

  const input = document.createElement('input');
  input.type = 'range';
  input.className = 'cl-slider-input';
  input.min = String(range.min);
  input.max = String(range.max);
  input.step = String(range.step);
  input.value = String(value);
  input.setAttribute('aria-label', def.label);
  row.appendChild(input);

  const paint = (v) => {
    val.textContent = clFmt(v, def.fmt);
    const pct = ((v - range.min) / (range.max - range.min)) * 100;
    row.style.setProperty('--cl-fill', Math.max(0, Math.min(100, pct)) + '%');
  };
  paint(value);

  input.addEventListener('input', () => {
    const v = parseFloat(input.value);
    paint(v);
    onInput(v);
  });

  container.appendChild(row);
  return {
    row,
    set(v) {
      input.value = String(v);
      paint(v);
    },
    setRange(r) {
      input.min = String(r.min); input.max = String(r.max); input.step = String(r.step);
      range = r;
    },
  };
}

/**
 * The live formula bar: a muted symbolic line plus term stacks
 * [symbol / live value]. Terms with `link` participate in hover linking
 * against the stage — hovering Z lights the credibility line, etc.
 */
function buildFormulaBar(container, linkRoot) {
  container.innerHTML = '';
  let valueSlots = [];
  return {
    setSpec(spec) {
      container.innerHTML = '';
      valueSlots = [];
      if (spec.sym) {
        const sym = document.createElement('div');
        sym.className = 'cl-formula-sym';
        sym.appendChild(clMd('$' + spec.sym + '$'));
        container.appendChild(sym);
      }
      const terms = document.createElement('div');
      terms.className = 'cl-terms';
      for (const t of spec.terms) {
        if (t.op !== undefined) {
          const op = document.createElement('span');
          op.className = 'cl-op';
          op.textContent = t.op;
          terms.appendChild(op);
          continue;
        }
        const term = document.createElement('div');
        term.className = 'cl-term' + (t.primary ? ' cl-primary' : '');
        const sym = document.createElement('div');
        sym.className = 'cl-term-sym';
        sym.appendChild(clTex(t.sym));
        const val = document.createElement('div');
        val.className = 'cl-term-val';
        term.appendChild(sym);
        term.appendChild(val);
        if (t.link && linkRoot) {
          term.classList.add('cl-linked');
          term.dataset.clLink = t.link;
          clWireHover(term, t.link, linkRoot);
        }
        terms.appendChild(term);
        valueSlots.push({ el: val, get: t.get, fmt: t.fmt });
      }
      container.appendChild(terms);
    },
    update(d) {
      for (const slot of valueSlots) {
        slot.el.textContent = clFmt(slot.get(d), slot.fmt);
      }
    },
  };
}

function buildLegend(container, items, linkRoot) {
  const legend = document.createElement('div');
  legend.className = 'cl-scene-legend';
  for (const item of items) {
    const el = document.createElement('span');
    el.className = 'cl-legend-item';
    el.style.color = item.color;
    const swatch = document.createElement('span');
    swatch.className = 'cl-legend-swatch' + (item.dashed ? ' cl-dashed' : '');
    el.appendChild(swatch);
    const label = document.createElement('span');
    label.textContent = item.label;
    label.style.color = 'var(--px-text-muted)';
    el.appendChild(label);
    if (item.link && linkRoot) {
      el.dataset.clLink = item.link;
      clWireHover(el, item.link, linkRoot);
    }
    legend.appendChild(el);
  }
  container.appendChild(legend);
  return legend;
}

function buildScene(parent, title, legendItems, linkRoot) {
  const scene = document.createElement('div');
  scene.className = 'cl-scene';
  const head = document.createElement('div');
  head.className = 'cl-scene-head';
  const t = document.createElement('span');
  t.textContent = title;
  head.appendChild(t);
  if (legendItems?.length) buildLegend(head, legendItems, linkRoot);
  scene.appendChild(head);
  const wrap = document.createElement('div');
  wrap.className = 'cl-svg-wrap';
  const svg = svgEl('svg', {}, 'cl-svg');
  wrap.appendChild(svg);
  scene.appendChild(wrap);
  parent.appendChild(scene);
  return { scene, wrap, svg };
}

function buildMeter(parent, leftLabel, rightLabel, linkName, linkRoot) {
  const wrapEl = document.createElement('div');
  wrapEl.className = 'cl-meter-wrap';
  const head = document.createElement('div');
  head.className = 'cl-meter-head';
  const l = document.createElement('span'); l.textContent = leftLabel;
  const mid = document.createElement('span');
  mid.style.cssText = 'color: var(--px-text); font-weight: 600;';
  const r = document.createElement('span'); r.textContent = rightLabel;
  head.appendChild(l); head.appendChild(mid); head.appendChild(r);
  const meter = document.createElement('div');
  meter.className = 'cl-meter';
  const fill = document.createElement('div');
  fill.className = 'cl-meter-fill';
  meter.appendChild(fill);
  if (linkName && linkRoot) {
    meter.dataset.clLink = linkName;
    clWireHover(meter, linkName, linkRoot);
  }
  wrapEl.appendChild(head);
  wrapEl.appendChild(meter);
  parent.appendChild(wrapEl);
  return {
    set(frac, label) {
      fill.style.width = (Math.max(0, Math.min(1, frac)) * 100) + '%';
      mid.textContent = label;
    },
  };
}

// ============================================================================
// SECTION 5: EDITOR PANE
// ============================================================================

let _api = null;
const _disposables = [];
let _paneRerender = null;
// One-shot module configuration from the chat tool, consumed on next mount.
let _pendingConfig = null;

// Pane state survives tab-switch rebuilds via module scope + view-state hooks.
const _paneState = { route: { view: 'home', moduleId: null }, params: {} };

function getLabState(mod) {
  let st = _paneState.params[mod.id];
  if (!st) {
    const values = {}, ranges = {};
    for (const p of mod.params) {
      values[p.key] = p.init;
      ranges[p.key] = { min: p.min, max: p.max, step: p.step };
    }
    st = {
      values, ranges,
      mode: null, data: null, query: null,
      presetId: null, storyIndex: 0, ghosts: [],
      predictAnswers: {},
      fresh: true,
    };
    _paneState.params[mod.id] = st;
  }
  return st;
}

// --- Scene renderers (registered by module id; defs stay declarative) ------

const SCENE_BUILDERS = {
  'random-variable': buildRandomVariableScenes,
  'mean-machine': buildMeanMachineScenes,
  'distribution-anatomy': buildAnatomyScenes,
  'sums-clt': buildSumsScenes,
  'conditional-expectation': buildCondExpScenes,
  'correlation': buildCorrScenes,
  'process-fan': buildProcessFanScenes,
  'likelihood-surface': buildLikelihoodScenes,
  'sampling-error': buildSamplingScenes,
  'shrinkage': buildShrinkScenes,
  'glm-anatomy': buildGlmScenes,
  'residual-lens': buildResidualScenes,
  'meyers-arc': buildMeyersArcScenes,
  'brosius-line': buildBrosiusScenes,
  'mse-valley': buildValleyScenes,
  'prior-posterior': buildPosteriorScenes,
  'dist-zoo': buildZooScenes,
  'validation-machine': buildValidationScenes,
  'csr-story': buildCsrScenes,
  'mcmc-watch': buildMcmcScenes,
  'mack-machinery': buildMackScenes,
  'clark-curves': buildClarkScenes,
  'odp-bootstrap': buildBootstrapScenes,
  'marshall-ladder': buildMarshallScenes,
  'glm-equals-cl': buildGlmClScenes,
};

/** First-mount draw-in: the primary curve sweeps in along its own length. */
function clDrawIn(path) {
  if (typeof path.getTotalLength !== 'function') return;
  try {
    const len = path.getTotalLength();
    if (!len) return;
    path.style.strokeDasharray = String(len);
    path.style.setProperty('--cl-len', String(len));
    path.style.animation = 'cl-draw-in var(--px-dur-slow) var(--px-ease-out) forwards';
    path.addEventListener('animationend', () => {
      path.style.strokeDasharray = '';
      path.style.animation = '';
    }, { once: true });
  } catch { /* jsdom */ }
}

function clDragOnSvg(svg, onDrag) {
  let active = false;
  svg.addEventListener('pointerdown', (e) => {
    active = true;
    try { svg.setPointerCapture(e.pointerId); } catch { /* jsdom */ }
    onDrag(e);
  });
  svg.addEventListener('pointermove', clRafThrottle((e) => { if (active) onDrag(e); }));
  const end = () => { active = false; };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);
}

function clSvgPoint(svg, e) {
  const rect = svg.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

// --- Brosius: scatter + the credibility line -------------------------------

function buildBrosiusScenes(stageRow, ctx) {
  const { linkRoot, animator } = ctx;
  const { scene, wrap, svg } = buildScene(stageRow, 'Reported x  vs  Ultimate y', [
    { label: 'Credibility Line', color: 'var(--px-accent)', link: 'line-ls' },
    { label: 'Chain Ladder', color: 'var(--cl-ink-1)', dashed: true, link: 'line-cl' },
    { label: 'Budgeted Loss', color: 'var(--cl-ink-4)', dashed: true, link: 'line-bl' },
    { label: 'BF', color: 'var(--cl-ink-5)', dashed: true, link: 'line-bf' },
  ], linkRoot);

  const axes = createAxes(svg, {
    xFmt: (v) => clFmt(v, 'num'),
    yFmt: (v) => clFmt(v, 'num'),
  });
  const gGhosts = svgEl('g'); svg.appendChild(gGhosts);
  const pCL = svgEl('path', { stroke: 'var(--cl-ink-1)' }, 'cl-curve cl-ref');
  const pBL = svgEl('path', { stroke: 'var(--cl-ink-4)' }, 'cl-curve cl-ref');
  const pBF = svgEl('path', { stroke: 'var(--cl-ink-5)' }, 'cl-curve cl-ref');
  const pLS = svgEl('path', { stroke: 'var(--px-accent)' }, 'cl-curve');
  pCL.dataset.clLink = 'line-cl';
  pBL.dataset.clLink = 'line-bl';
  pBF.dataset.clLink = 'line-bf';
  pLS.dataset.clLink = 'line-ls';
  svg.appendChild(pCL); svg.appendChild(pBL); svg.appendChild(pBF); svg.appendChild(pLS);
  const gDots = svgEl('g'); svg.appendChild(gDots);

  const qGuide = svgEl('line', {}, 'cl-marker-line'); qGuide.dataset.clLink = 'query';
  const qDotCL = svgEl('circle', { r: 3, fill: 'var(--cl-ink-1)' }, 'cl-dot'); qDotCL.dataset.clLink = 'line-cl';
  const qDotBL = svgEl('circle', { r: 3, fill: 'var(--cl-ink-4)' }, 'cl-dot'); qDotBL.dataset.clLink = 'line-bl';
  const qDotBF = svgEl('circle', { r: 3, fill: 'var(--cl-ink-5)' }, 'cl-dot'); qDotBF.dataset.clLink = 'line-bf';
  const qDot = svgEl('circle', { r: 5, fill: 'var(--px-accent)', stroke: 'var(--px-bg)', 'stroke-width': 1.5 }, 'cl-dot');
  qDot.dataset.clLink = 'line-ls';
  const qLabel = svgEl('text', { 'text-anchor': 'start' }, 'cl-svg-value');
  const qTag = svgEl('text', { 'text-anchor': 'middle' }, 'cl-svg-tag');
  svg.appendChild(qGuide);
  svg.appendChild(qDotCL); svg.appendChild(qDotBL); svg.appendChild(qDotBF);
  svg.appendChild(qDot); svg.appendChild(qLabel); svg.appendChild(qTag);

  const zMeter = buildMeter(scene, 'Budgeted Loss', 'Chain Ladder', 'line-ls', linkRoot);

  const domY = animator.smooth(10, 110);
  let lastData = undefined;
  let drewIn = false;
  let lastFrame = null;

  clDragOnSvg(svg, (e) => {
    if (!lastFrame) return;
    const { sx } = lastFrame;
    const st = ctx.getState();
    const r = st.ranges.x;
    const v = Math.max(r.min, Math.min(r.max, sx.invert(clSvgPoint(svg, e).x)));
    ctx.setParam('x', v);
  });

  return {
    update(st, d) {
      const w = wrap.clientWidth || 640, h = wrap.clientHeight || 300;
      svg.setAttribute('width', w); svg.setAttribute('height', h);
      const frame = { left: 56, top: 14, right: w - 16, bottom: h - 26 };
      const v = st.values;
      const slope = st.mode === 'fit' ? d.fitB : d.slope;
      const intercept = st.mode === 'fit' ? d.fitA : d.intercept;
      const L = (x) => intercept + slope * x;
      const xmax = st.ranges.x.max;

      let dataMax = 0;
      if (st.data) for (const [, y] of st.data) dataMax = Math.max(dataMax, y);
      const yTarget = 1.08 * Math.max(L(xmax), v.EY * 1.35, xmax + (1 - v.d) * v.EY, dataMax, 1e-9);
      if (st.fresh) { domY.snap(yTarget); } else { domY.target = yTarget; }
      const ymax = domY.current;

      const sx = clScale(0, xmax, frame.left, frame.right);
      const sy = clScale(0, ymax, frame.bottom, frame.top);
      lastFrame = { sx, sy, frame };
      axes.update(sx, sy, frame);

      // Chain ladder ray exits the top when d is small — clip to the frame.
      const clXEnd = Math.min(xmax, ymax * v.d);
      pCL.setAttribute('d', clPathFrom([[sx(0), sy(0)], [sx(clXEnd), sy(clXEnd / v.d)]]));
      pBL.setAttribute('d', clPathFrom([[sx(0), sy(v.EY)], [sx(xmax), sy(v.EY)]]));
      pBF.setAttribute('d', clPathFrom([[sx(0), sy((1 - v.d) * v.EY)], [sx(xmax), sy(xmax + (1 - v.d) * v.EY)]]));
      pLS.setAttribute('d', clPathFrom([[sx(0), sy(intercept)], [sx(xmax), sy(L(xmax))]]));
      if (!drewIn) { drewIn = true; clDrawIn(pLS); }

      if (st.data !== lastData) {
        lastData = st.data;
        gDots.innerHTML = '';
        if (st.data) {
          let i = 0;
          for (const pair of st.data) {
            const dot = svgEl('circle', { r: 3.5, fill: 'var(--px-text-secondary)', opacity: 0.85 }, 'cl-dot');
            dot.style.animation = `cl-fade-rise var(--px-dur-base) var(--px-ease-out) ${i * 40}ms backwards`;
            gDots.appendChild(dot);
            i++;
          }
        }
      }
      if (st.data) {
        const dots = gDots.children;
        for (let i = 0; i < st.data.length; i++) {
          dots[i].setAttribute('cx', sx(st.data[i][0]));
          dots[i].setAttribute('cy', sy(st.data[i][1]));
        }
      }

      const qx = sx(v.x);
      const qy = sy(L(v.x));
      qGuide.setAttribute('x1', qx); qGuide.setAttribute('x2', qx);
      qGuide.setAttribute('y1', frame.bottom); qGuide.setAttribute('y2', qy);
      qDot.setAttribute('cx', qx); qDot.setAttribute('cy', qy);
      qDotCL.setAttribute('cx', qx); qDotCL.setAttribute('cy', sy(Math.min(ymax, v.x / v.d)));
      qDotBL.setAttribute('cx', qx); qDotBL.setAttribute('cy', sy(v.EY));
      qDotBF.setAttribute('cx', qx); qDotBF.setAttribute('cy', sy(v.x + (1 - v.d) * v.EY));
      const labelLeft = qx > (frame.left + frame.right) * 0.62;
      qLabel.setAttribute('text-anchor', labelLeft ? 'end' : 'start');
      qLabel.setAttribute('x', qx + (labelLeft ? -9 : 9));
      qLabel.setAttribute('y', qy - 8);
      qLabel.textContent = clFmt(st.mode === 'fit' ? d.fitL : d.Lx, 'num');
      qTag.setAttribute('x', qx);
      qTag.setAttribute('y', frame.bottom + 24);
      qTag.textContent = 'x = ' + clFmt(v.x, 'num');

      gGhosts.innerHTML = '';
      for (const g of st.ghosts) {
        const gp = svgEl('path', {}, 'cl-ghost-curve');
        gp.setAttribute('d', clPathFrom([[sx(0), sy(g.intercept)], [sx(xmax), sy(g.intercept + g.slope * xmax)]]));
        gGhosts.appendChild(gp);
      }

      zMeter.set(d.Z, 'Z = ' + d.Z.toFixed(3));
    },
    snapshot(st, d) {
      return {
        label: st.presetId || 'pin',
        slope: st.mode === 'fit' ? d.fitB : d.slope,
        intercept: st.mode === 'fit' ? d.fitA : d.intercept,
      };
    },
  };
}

// --- MSE Valley: parabola + regime map -------------------------------------

function buildValleyScenes(stageRow, ctx) {
  const { linkRoot, animator } = ctx;

  // Scene 1: the parabola se(R_c) over c, with method stations.
  const s1 = buildScene(stageRow, 'The Valley: se(R_c) By Credibility Weight c', [
    { label: 'BF', color: 'var(--cl-ink-1)', link: 'st-bf' },
    { label: 'Benktander', color: 'var(--cl-ink-3)', link: 'st-gb' },
    { label: 'CL', color: 'var(--cl-ink-2)', link: 'st-cl' },
    { label: 'c*', color: 'var(--px-accent)', link: 'c-star' },
  ], linkRoot);
  const axes1 = createAxes(s1.svg, {
    xFmt: (v) => v.toFixed(2),
    yFmt: (v) => clFmt(v, 'pct'),
  });
  const pCurve = svgEl('path', { stroke: 'var(--px-accent)' }, 'cl-curve');
  pCurve.dataset.clLink = 'c-marker';
  s1.svg.appendChild(pCurve);
  const stations = {};
  for (const [id, color] of [['st-bf', 'var(--cl-ink-1)'], ['st-gb', 'var(--cl-ink-3)'], ['st-cl', 'var(--cl-ink-2)']]) {
    const dot = svgEl('circle', { r: 4, fill: color }, 'cl-dot');
    dot.dataset.clLink = id;
    const tag = svgEl('text', { 'text-anchor': 'middle' }, 'cl-svg-tag');
    tag.dataset.clLink = id;
    const val = svgEl('text', { 'text-anchor': 'middle' }, 'cl-svg-tag');
    val.dataset.clLink = id;
    s1.svg.appendChild(dot); s1.svg.appendChild(tag); s1.svg.appendChild(val);
    stations[id] = { dot, tag, val };
  }
  const starDot = svgEl('path', { fill: 'var(--px-accent)' }, 'cl-dot');
  starDot.dataset.clLink = 'c-star';
  const starTag = svgEl('text', { 'text-anchor': 'middle', fill: 'var(--px-accent)' }, 'cl-svg-tag');
  starTag.dataset.clLink = 'c-star';
  s1.svg.appendChild(starDot); s1.svg.appendChild(starTag);
  const cGuide = svgEl('line', {}, 'cl-marker-line');
  const cDot = svgEl('circle', { r: 6, fill: 'var(--px-accent)', stroke: 'var(--px-bg)', 'stroke-width': 1.5 }, 'cl-dot');
  cDot.dataset.clLink = 'c-marker';
  cDot.style.cursor = 'ew-resize';
  const cVal = svgEl('text', { 'text-anchor': 'middle' }, 'cl-svg-value');
  s1.svg.appendChild(cGuide); s1.svg.appendChild(cDot); s1.svg.appendChild(cVal);
  const mixMeter = buildMeter(s1.scene, 'R_BF', 'R_CL', 'mix', linkRoot);

  const domY1 = animator.smooth(0.25, 110);
  let frame1 = null;
  let drewIn = false;

  clDragOnSvg(s1.svg, (e) => {
    if (!frame1) return;
    const v = Math.max(0, Math.min(1, frame1.sx.invert(clSvgPoint(s1.svg, e).x)));
    ctx.setParam('c', v);
  });

  // Scene 2: Mack's Figure 1 — the (p, t) regime map. Static geometry.
  const s2 = buildScene(stageRow, 'The Regime Map: Figure 1', [], linkRoot);
  const gRegions = svgEl('g'); s2.svg.appendChild(gRegions);
  const axes2 = createAxes(s2.svg, {
    xFmt: (v) => v.toFixed(2),
    yFmt: (v) => v.toFixed(1),
  });
  const regBF = svgEl('path', { fill: 'var(--cl-ink-1)' }, 'cl-region');
  const regGB = svgEl('path', { fill: 'var(--cl-ink-3)' }, 'cl-region');
  const regCL = svgEl('path', { fill: 'var(--cl-ink-2)' }, 'cl-region');
  gRegions.appendChild(regBF); gRegions.appendChild(regGB); gRegions.appendChild(regCL);
  const bndBF = svgEl('path', { stroke: 'var(--cl-ink-1)' }, 'cl-curve cl-ref');
  const bndCL = svgEl('path', { stroke: 'var(--cl-ink-2)' }, 'cl-curve cl-ref');
  s2.svg.appendChild(bndBF); s2.svg.appendChild(bndCL);
  const labBF = svgEl('text', { fill: 'var(--cl-ink-1)' }, 'cl-region-label');
  const labGB = svgEl('text', { fill: 'var(--cl-ink-3)' }, 'cl-region-label');
  const labCL = svgEl('text', { fill: 'var(--cl-ink-2)' }, 'cl-region-label');
  s2.svg.appendChild(labBF); s2.svg.appendChild(labGB); s2.svg.appendChild(labCL);
  const mapDot = svgEl('circle', { r: 6.5, fill: 'var(--px-accent)', stroke: 'var(--px-bg)', 'stroke-width': 1.5 }, 'cl-dot');
  mapDot.dataset.clLink = 'map-dot';
  mapDot.style.cursor = 'move';
  const mapHalo = svgEl('circle', { r: 12, fill: 'var(--px-accent)', opacity: 0.18 }, 'cl-dot');
  mapHalo.dataset.clLink = 'map-dot';
  s2.svg.appendChild(mapHalo); s2.svg.appendChild(mapDot);

  const T_MAX = 2.2;
  let frame2 = null;
  let mapSizeKey = '';

  clDragOnSvg(s2.svg, (e) => {
    if (!frame2) return;
    const pt = clSvgPoint(s2.svg, e);
    const st = ctx.getState();
    const rp = st.ranges.p;
    const p = Math.max(rp.min, Math.min(rp.max, frame2.sx.invert(pt.x)));
    ctx.setParam('p', p);
    // Vertical drag back-solves the payout-noise slider to land on target t:
    // Ea2 = t(VarU0+VarU)/(1+t), then sdCkU = sqrt(Ea2*p*q/E[U^2]).
    const tTarget = Math.max(0.01, Math.min(T_MAX, frame2.sy.invert(pt.y)));
    const v = ctx.getState().values;
    const V = v.sdU0 * v.sdU0 + v.sdU * v.sdU;
    const EU2 = v.sdU * v.sdU + v.U0 * v.U0;
    const ea2 = (tTarget * V) / (1 + tTarget);
    const sd = Math.sqrt(Math.max(0, (ea2 * p * (1 - p)) / EU2));
    const rs = st.ranges.sdCkU;
    ctx.setParam('sdCkU', Math.max(rs.min, Math.min(rs.max, sd)));
  });

  return {
    update(st, d) {
      const v = st.values;

      // Scene 1
      const w1 = s1.wrap.clientWidth || 420, h1 = s1.wrap.clientHeight || 280;
      s1.svg.setAttribute('width', w1); s1.svg.setAttribute('height', h1);
      const f1 = { left: 52, top: 16, right: w1 - 16, bottom: h1 - 26 };
      const kit = { p: v.p, t: d.t, Ea2: d.Ea2 };
      const yTarget1 = 1.18 * Math.max(d.seBF, d.seCL);
      if (st.fresh) domY1.snap(yTarget1); else domY1.target = yTarget1;
      const sx1 = clScale(0, 1, f1.left, f1.right);
      const sy1 = clScale(0, domY1.current, f1.bottom, f1.top);
      frame1 = { sx: sx1, sy: sy1 };
      axes1.update(sx1, sy1, f1);

      const pts = [];
      for (let i = 0; i <= 96; i++) {
        const c = i / 96;
        pts.push([sx1(c), sy1(Math.sqrt(clMackMse(c, kit)))]);
      }
      pCurve.setAttribute('d', clPathFrom(pts));
      if (!drewIn) { drewIn = true; clDrawIn(pCurve); }

      const putStation = (id, cAt, label) => {
        const s = stations[id];
        const px = sx1(cAt), py = sy1(Math.sqrt(clMackMse(cAt, kit)));
        s.dot.setAttribute('cx', px); s.dot.setAttribute('cy', py);
        s.tag.setAttribute('x', px); s.tag.setAttribute('y', py - 16);
        s.tag.textContent = label;
        s.val.setAttribute('x', px); s.val.setAttribute('y', py - 6);
        s.val.textContent = clFmt(Math.sqrt(clMackMse(cAt, kit)), 'pct');
      };
      putStation('st-bf', 0, 'BF');
      putStation('st-gb', v.p, 'GB');
      putStation('st-cl', 1, 'CL');
      const starX = sx1(d.cStar), starY = sy1(d.seOpt);
      starDot.setAttribute('d', `M${starX},${starY - 5}L${starX + 4.5},${starY}L${starX},${starY + 5}L${starX - 4.5},${starY}Z`);
      starTag.setAttribute('x', starX);
      starTag.setAttribute('y', Math.min(f1.bottom - 4, starY + 18));
      starTag.textContent = 'c* = ' + d.cStar.toFixed(3);

      const cx = sx1(v.c), cy = sy1(d.seC);
      cGuide.setAttribute('x1', cx); cGuide.setAttribute('x2', cx);
      cGuide.setAttribute('y1', f1.bottom); cGuide.setAttribute('y2', cy);
      cDot.setAttribute('cx', cx); cDot.setAttribute('cy', cy);
      const cLabLeft = cx > (f1.left + f1.right) * 0.6;
      cVal.setAttribute('text-anchor', cLabLeft ? 'end' : 'start');
      cVal.setAttribute('x', cx + (cLabLeft ? -10 : 10));
      cVal.setAttribute('y', cy - 10);
      cVal.textContent = clFmt(d.seC, 'pct');

      const lo = Math.min(d.Rbf, d.Rcl), hi = Math.max(d.Rbf, d.Rcl);
      const frac = hi > lo ? (d.Rc - lo) / (hi - lo) : 0.5;
      mixMeter.set(d.Rbf <= d.Rcl ? frac : 1 - frac, 'R_c = ' + clFmt(d.Rc, 'pct'));

      // Scene 2 — static regions, rebuilt only on resize
      const w2 = s2.wrap.clientWidth || 420, h2 = s2.wrap.clientHeight || 280;
      s2.svg.setAttribute('width', w2); s2.svg.setAttribute('height', h2);
      const f2 = { left: 44, top: 16, right: w2 - 16, bottom: h2 - 26 };
      const sx2 = clScale(0, 1, f2.left, f2.right);
      const sy2 = clScale(0, T_MAX, f2.bottom, f2.top);
      frame2 = { sx: sx2, sy: sy2 };
      const sizeKey = w2 + 'x' + h2;
      if (sizeKey !== mapSizeKey) {
        mapSizeKey = sizeKey;
        axes2.update(sx2, sy2, f2);
        const bfPts = [], clPts = [];
        for (let i = 0; i <= 64; i++) {
          const p = i / 64;
          bfPts.push([sx2(p), sy2(Math.min(T_MAX, 2 - p))]);
          clPts.push([sx2(p), sy2((p * (1 - p)) / (1 + p))]);
        }
        bndBF.setAttribute('d', clPathFrom(bfPts));
        bndCL.setAttribute('d', clPathFrom(clPts));
        regBF.setAttribute('d', clPathFrom(bfPts) + `L${sx2(1)},${sy2(T_MAX)}L${sx2(0)},${sy2(T_MAX)}Z`);
        regCL.setAttribute('d', clPathFrom(clPts) + `L${sx2(1)},${sy2(0)}L${sx2(0)},${sy2(0)}Z`);
        regGB.setAttribute('d', clPathFrom(bfPts) + clPathFrom(clPts.slice().reverse()).replace(/^M/, 'L') + 'Z');
        labBF.setAttribute('x', sx2(0.09)); labBF.setAttribute('y', sy2(2.02));
        labBF.textContent = 'BF Best';
        labGB.setAttribute('x', sx2(0.42)); labGB.setAttribute('y', sy2(0.75));
        labGB.textContent = 'Benktander Best';
        labCL.setAttribute('x', sx2(0.68)); labCL.setAttribute('y', sy2(0.05));
        labCL.textContent = 'CL Best';
      }
      regBF.classList.toggle('cl-active-region', d.regime === 'BF');
      regGB.classList.toggle('cl-active-region', d.regime === 'GB');
      regCL.classList.toggle('cl-active-region', d.regime === 'CL');
      const mx = sx2(v.p), my = sy2(Math.min(T_MAX, d.t));
      mapDot.setAttribute('cx', mx); mapDot.setAttribute('cy', my);
      mapHalo.setAttribute('cx', mx); mapHalo.setAttribute('cy', my);
    },
    snapshot(st, d) {
      return { label: st.presetId || 'pin', p: st.values.p, t: d.t, Ea2: d.Ea2 };
    },
  };
}

// --- Prior to Posterior: three densities and the credibility rail ----------

function buildPosteriorScenes(stageRow, ctx) {
  const { linkRoot, animator } = ctx;
  const { scene, wrap, svg } = buildScene(stageRow, 'Belief Over The True Ultimate U', [
    { label: 'Prior', color: 'var(--cl-ink-4)', dashed: true, link: 'prior' },
    { label: 'Likelihood', color: 'var(--cl-ink-1)', dashed: true, link: 'lik' },
    { label: 'Posterior', color: 'var(--px-accent)', link: 'post' },
  ], linkRoot);

  const axes = createAxes(svg, {
    xFmt: (v) => clFmt(v, 'pct'),
    yFmt: () => '',
    yTicks: 0,
  });
  const band = svgEl('path', { fill: 'var(--px-accent)' }, 'cl-band');
  band.dataset.clLink = 'post';
  const pPrior = svgEl('path', { stroke: 'var(--cl-ink-4)' }, 'cl-curve cl-ref');
  pPrior.dataset.clLink = 'prior';
  const pLik = svgEl('path', { stroke: 'var(--cl-ink-1)' }, 'cl-curve cl-ref');
  pLik.dataset.clLink = 'lik';
  const pPost = svgEl('path', { stroke: 'var(--px-accent)' }, 'cl-curve');
  pPost.dataset.clLink = 'post';
  svg.appendChild(band);
  svg.appendChild(pPrior); svg.appendChild(pLik); svg.appendChild(pPost);

  const tickPrior = svgEl('line', {}, 'cl-marker-line'); tickPrior.dataset.clLink = 'prior';
  const tickCL = svgEl('line', {}, 'cl-marker-line'); tickCL.dataset.clLink = 'lik';
  const tagPrior = svgEl('text', { 'text-anchor': 'middle', fill: 'var(--cl-ink-4)' }, 'cl-svg-tag');
  tagPrior.dataset.clLink = 'prior';
  const tagCL = svgEl('text', { 'text-anchor': 'middle', fill: 'var(--cl-ink-1)' }, 'cl-svg-tag');
  tagCL.dataset.clLink = 'lik';
  const postDot = svgEl('circle', { r: 5, fill: 'var(--px-accent)', stroke: 'var(--px-bg)', 'stroke-width': 1.5 }, 'cl-dot');
  postDot.dataset.clLink = 'post';
  const postLabel = svgEl('text', { 'text-anchor': 'middle' }, 'cl-svg-value');
  svg.appendChild(tickPrior); svg.appendChild(tickCL);
  svg.appendChild(tagPrior); svg.appendChild(tagCL);
  svg.appendChild(postDot); svg.appendChild(postLabel);

  const rail = buildMeter(scene, 'Prior', 'Chain Ladder', 'post', linkRoot);

  const domLo = animator.smooth(0.2, 110);
  const domHi = animator.smooth(1.8, 110);
  const domYmax = animator.smooth(3, 110);
  let drewIn = false;

  return {
    update(st, d) {
      const w = wrap.clientWidth || 640, h = wrap.clientHeight || 300;
      svg.setAttribute('width', w); svg.setAttribute('height', h);
      const frame = { left: 20, top: 14, right: w - 16, bottom: h - 26 };
      const v = st.values;
      const q = 1 - v.p;
      const logn = d.dist !== 'normal';
      const prior = logn ? clMatchLognormal(v.EU, v.sdU) : null;
      const tau2 = Math.log(1 + (v.beta * v.beta * q) / v.p);
      const tau = Math.sqrt(tau2);
      const sNorm = Math.sqrt(v.p * q * v.beta * v.beta * v.EU * v.EU);
      const sigma1 = logn ? Math.sqrt(d.sigma12) : d.sdRC;

      const priorPdf = (u) => logn ? clLognPdf(u, prior.mu, prior.sigma) : clNormPdf(u, v.EU, v.sdU);
      const likPdf = (u) => {
        if (u <= 0) return 0;
        return logn
          ? clLognPdf(v.Ck, Math.log(v.p * u) - tau2 / 2, tau)
          : clNormPdf(v.Ck, v.p * u, sNorm);
      };
      const postPdf = (u) => logn ? clLognPdf(u, d.mu1, sigma1) : clNormPdf(u, d.EUC, d.sdRC);
      const postInv = (pr) => logn ? clLognInv(pr, d.mu1, sigma1) : clNormInv(pr, d.EUC, d.sdRC);
      const priorInv = (pr) => logn ? clLognInv(pr, prior.mu, prior.sigma) : clNormInv(pr, v.EU, v.sdU);

      const loT = Math.max(0.001, Math.min(priorInv(0.002), postInv(0.002)));
      const hiT = Math.max(priorInv(0.998), postInv(0.998), d.Ucl * 1.15);
      if (st.fresh) { domLo.snap(loT); domHi.snap(hiT); } else { domLo.target = loT; domHi.target = hiT; }
      const lo = domLo.current, hi = domHi.current;

      const N = 140;
      const us = [], fPrior = [], fLik = [], fPost = [];
      let likMax = 0, denMax = 0;
      for (let i = 0; i <= N; i++) {
        const u = lo + ((hi - lo) * i) / N;
        us.push(u);
        const a = priorPdf(u), b = likPdf(u), c = postPdf(u);
        fPrior.push(a); fLik.push(b); fPost.push(c);
        likMax = Math.max(likMax, b);
        denMax = Math.max(denMax, a, c);
      }
      if (st.fresh) domYmax.snap(denMax * 1.1); else domYmax.target = denMax * 1.1;
      const ymax = domYmax.current;
      // The likelihood is not a density in U — scale it for display only.
      const likScale = likMax > 0 ? (0.82 * denMax) / likMax : 1;

      const sx = clScale(lo, hi, frame.left, frame.right);
      const sy = clScale(0, ymax, frame.bottom, frame.top);
      axes.update(sx, sy, frame);

      const path = (fs, scale = 1) => clPathFrom(us.map((u, i) => [sx(u), sy(Math.min(ymax, fs[i] * scale))]));
      pPrior.setAttribute('d', path(fPrior));
      pLik.setAttribute('d', path(fLik, likScale));
      pPost.setAttribute('d', path(fPost));
      if (!drewIn) { drewIn = true; clDrawIn(pPost); }

      // 90% posterior band as a filled slab under the curve.
      const b05 = Math.max(lo, postInv(0.05)), b95 = Math.min(hi, postInv(0.95));
      const bandPts = [];
      for (let i = 0; i <= 60; i++) {
        const u = b05 + ((b95 - b05) * i) / 60;
        bandPts.push([sx(u), sy(Math.min(ymax, postPdf(u)))]);
      }
      band.setAttribute('d', clPathFrom(bandPts) + `L${sx(b95)},${sy(0)}L${sx(b05)},${sy(0)}Z`);

      const put = (tick, tag, u, label) => {
        const x = sx(u);
        tick.setAttribute('x1', x); tick.setAttribute('x2', x);
        tick.setAttribute('y1', frame.bottom); tick.setAttribute('y2', frame.top + 10);
        tag.setAttribute('x', x); tag.setAttribute('y', frame.top + 8);
        tag.textContent = label;
      };
      put(tickPrior, tagPrior, v.EU, 'E[U] ' + clFmt(v.EU, 'pct'));
      put(tickCL, tagCL, d.Ucl, 'Cₖ/p ' + clFmt(d.Ucl, 'pct'));
      const px = sx(d.EUC);
      postDot.setAttribute('cx', px); postDot.setAttribute('cy', sy(0));
      postLabel.setAttribute('x', px); postLabel.setAttribute('y', sy(0) - 12);
      postLabel.textContent = clFmt(d.EUC, 'pct');

      rail.set(d.z, 'z = ' + d.z.toFixed(3));
    },
    snapshot(st, d) {
      return { label: st.presetId || 'pin', mode: d.dist, EUC: d.EUC, z: d.z };
    },
  };
}

// --- Distribution Zoo: curves and lattices ---------------------------------

function makeBarPool(svg, cls) {
  const g = svgEl('g');
  svg.appendChild(g);
  return {
    g,
    set(bars, fill) {
      while (g.children.length < bars.length) g.appendChild(svgEl('rect', { rx: 1 }, cls));
      while (g.children.length > bars.length) g.lastChild.remove();
      for (let i = 0; i < bars.length; i++) {
        const r = g.children[i];
        const b = bars[i];
        r.setAttribute('x', b.x); r.setAttribute('y', b.y);
        r.setAttribute('width', b.w); r.setAttribute('height', b.h);
        r.setAttribute('fill', fill);
      }
    },
  };
}

function buildZooScenes(stageRow, ctx) {
  const { linkRoot, animator } = ctx;
  const { wrap, svg } = buildScene(stageRow, 'Density And Mass, To The Same Scale', [
    { label: 'This Distribution', color: 'var(--px-accent)', link: 'primary' },
    { label: 'Comparison', color: 'var(--cl-ink-1)', dashed: true, link: 'secondary' },
  ], linkRoot);

  const axes = createAxes(svg, {
    xFmt: (v) => clFmt(v, 'num'),
    yFmt: () => '',
    yTicks: 0,
  });
  const barsCmp = makeBarPool(svg, 'cl-bar cl-bar--cmp');
  barsCmp.g.dataset.clLink = 'secondary';
  const barsMain = makeBarPool(svg, 'cl-bar');
  barsMain.g.dataset.clLink = 'primary';
  const pSecondary = svgEl('path', { stroke: 'var(--cl-ink-1)' }, 'cl-curve cl-ref');
  pSecondary.dataset.clLink = 'secondary';
  const pPrimary = svgEl('path', { stroke: 'var(--px-accent)' }, 'cl-curve');
  pPrimary.dataset.clLink = 'primary';
  svg.appendChild(pSecondary); svg.appendChild(pPrimary);
  const mark1 = svgEl('line', {}, 'cl-marker-line');
  const mark2 = svgEl('line', {}, 'cl-marker-line');
  const tag1 = svgEl('text', { 'text-anchor': 'middle', fill: 'var(--px-accent)' }, 'cl-svg-tag');
  const tag2 = svgEl('text', { 'text-anchor': 'middle', fill: 'var(--cl-ink-1)' }, 'cl-svg-tag');
  mark1.dataset.clLink = 'primary'; tag1.dataset.clLink = 'primary';
  mark2.dataset.clLink = 'secondary'; tag2.dataset.clLink = 'secondary';
  svg.appendChild(mark1); svg.appendChild(mark2);
  svg.appendChild(tag1); svg.appendChild(tag2);

  const domHi = animator.smooth(260, 110);
  const domYmax = animator.smooth(0.05, 110);
  let drewIn = false;

  return {
    update(st, d) {
      const w = wrap.clientWidth || 640, h = wrap.clientHeight || 300;
      svg.setAttribute('width', w); svg.setAttribute('height', h);
      const frame = { left: 20, top: 14, right: w - 16, bottom: h - 26 };
      const v = st.values;
      const mode = d.mode;

      const hiT = Math.max(40, d.mean + 4.2 * d.sd);
      if (st.fresh) domHi.snap(hiT); else domHi.target = hiT;
      const hi = domHi.current;
      const sx = clScale(0, hi, frame.left, frame.right);

      // Everything plots as mass-per-unit-x so lattices and densities share
      // one vertical scale — the whole point of the ODP picture.
      let mainBars = null, cmpBars = null, mainCurve = null, cmpCurve = null;
      let m1 = null, m2 = null;
      if (mode === 'odp') {
        mainBars = clOdpSupport(d.mean, v.phi, 1e-7)
          .filter((pt) => pt.x <= hi)
          .map((pt) => ({ u: pt.x, den: pt.p / v.phi, w: v.phi * 0.62 }));
        cmpBars = [];
        for (let k = Math.max(0, Math.floor(d.mean - 4.5 * Math.sqrt(d.mean))); k <= d.mean + 4.5 * Math.sqrt(d.mean); k++) {
          const p = clPoissonPmf(k, d.mean);
          if (p > 1e-7 && k <= hi) cmpBars.push({ u: k, den: p, w: 0.9 });
        }
      } else if (mode === 'negbin') {
        const pNb = d.nbP;
        mainBars = [];
        const step = Math.max(1, Math.round(hi / 220));
        for (let k = 0; k <= hi; k += step) {
          let mass = 0;
          for (let j = k; j < k + step; j++) mass += clNbPmf(j, v.r, pNb);
          if (mass > 1e-7) mainBars.push({ u: k + (step - 1) / 2, den: mass / step, w: step * 0.7 });
        }
        cmpBars = [];
        for (let k = Math.max(0, Math.floor(d.mean - 4.5 * Math.sqrt(d.mean))); k <= d.mean + 4.5 * Math.sqrt(d.mean); k++) {
          const p = clPoissonPmf(k, d.mean);
          if (p > 1e-7 && k <= hi) cmpBars.push({ u: k, den: p, w: 0.9 });
        }
      } else if (mode === 'gamma') {
        mainCurve = (u) => clGammaPdf(u, v.shape, d.scale);
        cmpCurve = (u) => clNormPdf(u, d.mean, d.sd);
      } else {
        const { lnMu, lnSigma } = d;
        mainCurve = (u) => clLognPdf(u, lnMu, lnSigma);
        cmpCurve = (u) => clNormPdf(u, d.mean, d.sd);
        m1 = { u: d.ln95, label: 'LN 95th ' + clFmt(d.ln95, 'num') };
        m2 = { u: d.n95, label: 'N 95th ' + clFmt(d.n95, 'num') };
      }

      let ymaxT = 0;
      const N = 150;
      const curvePath = (f) => {
        const pts = [];
        for (let i = 0; i <= N; i++) {
          const u = (hi * i) / N;
          const y = f(u);
          ymaxT = Math.max(ymaxT, y);
          pts.push([u, y]);
        }
        return pts;
      };
      const mainPts = mainCurve ? curvePath(mainCurve) : null;
      const cmpPts = cmpCurve ? curvePath(cmpCurve) : null;
      if (mainBars) for (const b of mainBars) ymaxT = Math.max(ymaxT, b.den);
      if (cmpBars) for (const b of cmpBars) ymaxT = Math.max(ymaxT, b.den);
      if (st.fresh) domYmax.snap(ymaxT * 1.12); else domYmax.target = ymaxT * 1.12;
      const ymax = domYmax.current;
      const sy = clScale(0, ymax, frame.bottom, frame.top);
      axes.update(sx, sy, frame);

      pPrimary.style.display = mainCurve ? '' : 'none';
      pSecondary.style.display = cmpCurve ? '' : 'none';
      if (mainPts) pPrimary.setAttribute('d', clPathFrom(mainPts.map(([u, y]) => [sx(u), sy(Math.min(ymax, y))])));
      if (cmpPts) pSecondary.setAttribute('d', clPathFrom(cmpPts.map(([u, y]) => [sx(u), sy(Math.min(ymax, y))])));
      if (!drewIn && mainCurve) { drewIn = true; clDrawIn(pPrimary); }

      const toRects = (bars) => bars.map((b) => {
        const x0 = sx(b.u - b.w / 2), x1 = sx(b.u + b.w / 2);
        const y = sy(Math.min(ymax, b.den));
        return { x: x0, y, w: Math.max(1, x1 - x0), h: Math.max(0, frame.bottom - y) };
      });
      barsMain.set(mainBars ? toRects(mainBars) : [], 'var(--px-accent)');
      barsCmp.set(cmpBars ? toRects(cmpBars) : [], 'var(--cl-ink-1)');

      const putMark = (mark, tag, m, yFrac) => {
        if (!m) { mark.style.display = 'none'; tag.style.display = 'none'; return; }
        mark.style.display = ''; tag.style.display = '';
        const x = sx(m.u);
        mark.setAttribute('x1', x); mark.setAttribute('x2', x);
        mark.setAttribute('y1', frame.bottom); mark.setAttribute('y2', frame.top + 10);
        tag.setAttribute('x', x); tag.setAttribute('y', frame.top + 8 + yFrac);
        tag.textContent = m.label;
      };
      putMark(mark1, tag1, m1, 0);
      putMark(mark2, tag2, m2, 12);
    },
    snapshot(st, d) {
      return { label: st.presetId || 'pin', mode: d.mode, mean: d.mean, sd: d.sd };
    },
  };
}

// --- Validation Machine: densities + percentile histogram + p-p plot -------

function buildValidationScenes(stageRow, ctx) {
  const { linkRoot, animator } = ctx;

  // Scene 1: the world vs the model's claim, and where percentiles pile up.
  const s1 = buildScene(stageRow, 'The World Vs The Model', [
    { label: 'Truth', color: 'var(--cl-ink-3)', link: 'truth' },
    { label: 'Model Claim', color: 'var(--cl-ink-1)', dashed: true, link: 'model' },
    { label: 'Outcome Percentiles', color: 'var(--px-accent)', link: 'pp' },
  ], linkRoot);
  const axesTop = createAxes(s1.svg, { xFmt: (v) => String(v), yFmt: () => '', yTicks: 0, xTicks: 4 });
  const axesHist = createAxes(s1.svg, { xFmt: (v) => String(v), yFmt: () => '', yTicks: 0, xTicks: 5 });
  const pTruth = svgEl('path', { stroke: 'var(--cl-ink-3)' }, 'cl-curve cl-ref');
  pTruth.style.strokeDasharray = 'none';
  pTruth.dataset.clLink = 'truth';
  const pModel = svgEl('path', { stroke: 'var(--cl-ink-1)' }, 'cl-curve cl-ref');
  pModel.dataset.clLink = 'model';
  s1.svg.appendChild(pTruth); s1.svg.appendChild(pModel);
  const histBars = makeBarPool(s1.svg, 'cl-bar');
  histBars.g.dataset.clLink = 'pp';
  const expLine = svgEl('line', {}, 'cl-marker-line');
  const histTag = svgEl('text', { 'text-anchor': 'start' }, 'cl-svg-tag');
  s1.svg.appendChild(expLine); s1.svg.appendChild(histTag);

  // Scene 2: the p-p plot with the KS band and a live verdict.
  const s2 = buildScene(stageRow, 'The p-p Plot', [], linkRoot);
  const head2 = s2.scene.querySelector('.cl-scene-head');
  const replay = document.createElement('button');
  replay.className = 'cl-scene-btn';
  replay.innerHTML = clIcon('play', 12) + '<span>Replay Sampling</span>';
  head2.appendChild(replay);
  const axesPp = createAxes(s2.svg, { xFmt: (v) => String(v), yFmt: (v) => String(v), xTicks: 4, yTicks: 4 });
  const diag = svgEl('line', {}, 'cl-marker-line');
  const bandLo = svgEl('line', { stroke: 'var(--cl-ink-2)' }, 'cl-curve cl-ref');
  const bandHi = svgEl('line', { stroke: 'var(--cl-ink-2)' }, 'cl-curve cl-ref');
  bandLo.dataset.clLink = 'band'; bandHi.dataset.clLink = 'band';
  const gPoints = svgEl('g'); gPoints.dataset.clLink = 'pp';
  const verdict = svgEl('text', { 'text-anchor': 'end' }, 'cl-svg-value');
  s2.svg.appendChild(diag); s2.svg.appendChild(bandLo); s2.svg.appendChild(bandHi);
  s2.svg.appendChild(gPoints); s2.svg.appendChild(verdict);

  const reveal = { value: 0, active: false };
  let lastPresetKey = null;

  function startReveal(n) {
    reveal.active = true;
    animator.tween('val-reveal', 0, n, 2000, (val) => {
      reveal.value = val;
      if (val >= n) reveal.active = false;
    });
  }
  replay.addEventListener('click', () => startReveal(ctx.getState().values.n));

  return {
    update(st, d) {
      const v = st.values;

      // A fresh preset (or first mount) replays the sampling animation;
      // slider drags keep everything revealed for direct manipulation.
      if (st.presetId !== lastPresetKey) {
        const first = lastPresetKey === null;
        lastPresetKey = st.presetId ?? 'none';
        if (first || st.presetId) startReveal(v.n);
      }
      if (!reveal.active) reveal.value = v.n;
      const k = Math.max(1, Math.min(v.n, Math.round(reveal.value) || v.n));
      const shown = d.percentiles.slice(0, k);

      // ── Scene 1 ──
      const w1 = s1.wrap.clientWidth || 420, h1 = s1.wrap.clientHeight || 280;
      s1.svg.setAttribute('width', w1); s1.svg.setAttribute('height', h1);
      const fTop = { left: 20, top: 12, right: w1 - 14, bottom: Math.floor(h1 * 0.48) - 6 };
      const fHist = { left: 20, top: Math.floor(h1 * 0.48) + 22, right: w1 - 14, bottom: h1 - 24 };

      const sxT = clScale(-4, 4, fTop.left, fTop.right);
      const yMaxT = Math.max(clNormPdf(0, 0, 1), clNormPdf(v.bias, v.bias, v.tail)) * 1.1;
      const syT = clScale(0, yMaxT, fTop.bottom, fTop.top);
      axesTop.update(sxT, syT, fTop);
      const NPTS = 120;
      const curve = (mu, sd) => {
        const pts = [];
        for (let i = 0; i <= NPTS; i++) {
          const x = -4 + (8 * i) / NPTS;
          pts.push([sxT(x), syT(Math.min(yMaxT, clNormPdf(x, mu, sd)))]);
        }
        return clPathFrom(pts);
      };
      pTruth.setAttribute('d', curve(0, 1));
      pModel.setAttribute('d', curve(v.bias, v.tail));

      const bins = new Array(10).fill(0);
      for (const p of shown) bins[Math.max(0, Math.min(9, Math.floor(p / 10)))]++;
      const sxH = clScale(0, 100, fHist.left, fHist.right);
      const yMaxH = Math.max(k / 10, ...bins) * 1.15;
      const syH = clScale(0, yMaxH, fHist.bottom, fHist.top);
      axesHist.update(sxH, syH, fHist);
      histBars.set(bins.map((count, i) => {
        const x0 = sxH(i * 10 + 0.8), x1 = sxH(i * 10 + 9.2);
        const y = syH(count);
        return { x: x0, y, w: x1 - x0, h: Math.max(0, fHist.bottom - y) };
      }), 'var(--px-accent)');
      const expY = syH(k / 10);
      expLine.setAttribute('x1', fHist.left); expLine.setAttribute('x2', fHist.right);
      expLine.setAttribute('y1', expY); expLine.setAttribute('y2', expY);
      histTag.setAttribute('x', fHist.left + 4);
      histTag.setAttribute('y', expY - 4);
      histTag.textContent = 'Uniform Expects ' + Math.round(k / 10);

      // ── Scene 2 ──
      const w2 = s2.wrap.clientWidth || 420, h2 = s2.wrap.clientHeight || 280;
      s2.svg.setAttribute('width', w2); s2.svg.setAttribute('height', h2);
      const f2 = { left: 34, top: 14, right: w2 - 14, bottom: h2 - 26 };
      const sx2 = clScale(0, 100, f2.left, f2.right);
      const sy2 = clScale(0, 100, f2.bottom, f2.top);
      axesPp.update(sx2, sy2, f2);
      diag.setAttribute('x1', sx2(0)); diag.setAttribute('y1', sy2(0));
      diag.setAttribute('x2', sx2(100)); diag.setAttribute('y2', sy2(100));
      const putBand = (line, off) => {
        const c0 = Math.max(0, -off), c1 = Math.min(100, 100 - off);
        line.setAttribute('x1', sx2(c0)); line.setAttribute('y1', sy2(c0 + off));
        line.setAttribute('x2', sx2(c1)); line.setAttribute('y2', sy2(c1 + off));
      };
      putBand(bandLo, -d.band);
      putBand(bandHi, d.band);

      const sortedShown = [...shown].sort((a, b) => a - b);
      while (gPoints.children.length < sortedShown.length) {
        gPoints.appendChild(svgEl('circle', { r: 2.4, fill: 'var(--px-accent)' }, 'cl-dot'));
      }
      while (gPoints.children.length > sortedShown.length) gPoints.lastChild.remove();
      for (let i = 0; i < sortedShown.length; i++) {
        const c = gPoints.children[i];
        c.setAttribute('cx', sx2(((i + 1) / (sortedShown.length + 1)) * 100));
        c.setAttribute('cy', sy2(sortedShown[i]));
      }

      const liveD = clKsD(sortedShown);
      const pass = liveD <= d.band;
      verdict.setAttribute('x', f2.right - 6);
      verdict.setAttribute('y', f2.top + 14);
      verdict.setAttribute('fill', pass ? 'var(--px-success)' : 'var(--px-danger)');
      verdict.textContent = `D = ${liveD.toFixed(1)} ${pass ? '≤' : '>'} ${d.band.toFixed(1)} · ${pass ? 'Validates' : 'Rejected'}`;
    },
    snapshot(st, d) {
      return { label: st.presetId || 'pin', D: d.D, band: d.band };
    },
  };
}

// --- CSR: the payment-pattern fan + the naive-average bias bars ------------

function buildCsrScenes(stageRow, ctx) {
  const { linkRoot, animator } = ctx;

  const s1 = buildScene(stageRow, 'The Payment Pattern Family', [
    { label: 'AY 1', color: 'var(--cl-ink-1)', link: 'fan' },
    { label: 'AY 10', color: 'var(--px-accent)', link: 'fan' },
    { label: 'γ Posterior (Table 7.1)', color: 'var(--cl-ink-3)', dashed: true, link: 'gamma-strip' },
  ], linkRoot);
  const axesFan = createAxes(s1.svg, { xFmt: (v) => String(v), yFmt: (v) => Math.round(v * 100) + '%', xTicks: 9, yTicks: 4 });
  const fanPaths = [];
  for (let w = 1; w <= 10; w++) {
    const isEdge = w === 1 || w === 10;
    const p = svgEl('path', {
      stroke: w === 10 ? 'var(--px-accent)' : (w === 1 ? 'var(--cl-ink-1)' : 'var(--px-text-faint)'),
    }, isEdge ? 'cl-curve' : 'cl-curve cl-ref');
    if (!isEdge) p.style.strokeDasharray = 'none';
    p.dataset.clLink = 'fan';
    s1.svg.appendChild(p);
    fanPaths.push(p);
  }
  const tagAy1 = svgEl('text', { 'text-anchor': 'start', fill: 'var(--cl-ink-1)' }, 'cl-svg-tag');
  const tagAy10 = svgEl('text', { 'text-anchor': 'start', fill: 'var(--px-accent)' }, 'cl-svg-tag');
  s1.svg.appendChild(tagAy1); s1.svg.appendChild(tagAy10);

  // Gamma posterior strip: drag on the posterior itself to set gamma.
  const stripBand = svgEl('path', { fill: 'var(--cl-ink-3)' }, 'cl-band');
  stripBand.dataset.clLink = 'gamma-strip';
  const stripCurve = svgEl('path', { stroke: 'var(--cl-ink-3)' }, 'cl-curve cl-ref');
  stripCurve.dataset.clLink = 'gamma-strip';
  const stripMarker = svgEl('line', { stroke: 'var(--px-accent)', 'stroke-width': 2 }, '');
  const stripTag = svgEl('text', { 'text-anchor': 'middle' }, 'cl-svg-value');
  const stripZero = svgEl('line', {}, 'cl-marker-line');
  const axesStrip = createAxes(s1.svg, { xFmt: (v) => v.toFixed(2), yFmt: () => '', yTicks: 0, xTicks: 5 });
  s1.svg.appendChild(stripBand); s1.svg.appendChild(stripCurve);
  s1.svg.appendChild(stripZero); s1.svg.appendChild(stripMarker); s1.svg.appendChild(stripTag);

  let stripFrame = null;
  clDragOnSvg(s1.svg, (e) => {
    if (!stripFrame) return;
    const pt = clSvgPoint(s1.svg, e);
    if (pt.y < stripFrame.yTop - 8) return; // only the strip is draggable
    const st = ctx.getState();
    const r = st.ranges.gamma;
    ctx.setParam('gamma', Math.max(r.min, Math.min(r.max, stripFrame.sx.invert(pt.x))));
  });

  const s2 = buildScene(stageRow, 'Share Paid By The Focus Lag, By Accident Year', [
    { label: 'AY 10', color: 'var(--px-accent)', link: 'bars' },
    { label: 'Naive Average', color: 'var(--cl-ink-2)', dashed: true, link: 'bars' },
  ], linkRoot);
  const axesBars = createAxes(s2.svg, { xFmt: (v) => String(v), yFmt: (v) => Math.round(v * 100) + '%', xTicks: 9, yTicks: 4 });
  const barPool = makeBarPool(s2.svg, 'cl-bar');
  barPool.g.dataset.clLink = 'bars';
  const avgLine = svgEl('line', { stroke: 'var(--cl-ink-2)' }, 'cl-curve cl-ref');
  avgLine.dataset.clLink = 'bars';
  const avgTag = svgEl('text', { 'text-anchor': 'end', fill: 'var(--cl-ink-2)' }, 'cl-svg-tag');
  const lagTag = svgEl('text', { 'text-anchor': 'middle' }, 'cl-svg-tag');
  s2.svg.appendChild(avgLine); s2.svg.appendChild(avgTag); s2.svg.appendChild(lagTag);

  const domStripY = animator.smooth(16, 110);
  let drewIn = false;

  return {
    update(st, d) {
      const v = st.values;

      // ── Scene 1: the fan + the posterior strip ──
      const w1 = s1.wrap.clientWidth || 420, h1 = s1.wrap.clientHeight || 280;
      s1.svg.setAttribute('width', w1); s1.svg.setAttribute('height', h1);
      const fFan = { left: 40, top: 12, right: w1 - 44, bottom: Math.floor(h1 * 0.58) };
      const fStrip = { left: 40, top: Math.floor(h1 * 0.58) + 30, right: w1 - 44, bottom: h1 - 22 };

      const sxF = clScale(1, 10, fFan.left, fFan.right);
      const syF = clScale(0, 1, fFan.bottom, fFan.top);
      axesFan.update(sxF, syF, fFan);
      for (let w = 1; w <= 10; w++) {
        const pts = [];
        for (let lag = 1; lag <= 10; lag++) pts.push([sxF(lag), syF(clCsrShare(w, lag, v.gamma))]);
        fanPaths[w - 1].setAttribute('d', clPathFrom(pts));
      }
      if (!drewIn) { drewIn = true; clDrawIn(fanPaths[9]); }
      tagAy1.setAttribute('x', sxF(1) + 4);
      tagAy1.setAttribute('y', syF(clCsrShare(1, 1, v.gamma)) - 6);
      tagAy1.textContent = 'AY 1';
      tagAy10.setAttribute('x', sxF(1) + 4);
      tagAy10.setAttribute('y', syF(clCsrShare(10, 1, v.gamma)) + 12);
      tagAy10.textContent = 'AY 10';

      const gLo = st.ranges.gamma.min, gHi = st.ranges.gamma.max;
      const sxS = clScale(gLo, gHi, fStrip.left, fStrip.right);
      const peak = clNormPdf(CSR_GAMMA.mean, CSR_GAMMA.mean, CSR_GAMMA.sd);
      domStripY.target = peak * 1.15;
      const syS = clScale(0, domStripY.current, fStrip.bottom, fStrip.top);
      stripFrame = { sx: sxS, yTop: fStrip.top };
      axesStrip.update(sxS, syS, fStrip);
      const stripPts = [];
      for (let i = 0; i <= 90; i++) {
        const g = gLo + ((gHi - gLo) * i) / 90;
        stripPts.push([sxS(g), syS(clNormPdf(g, CSR_GAMMA.mean, CSR_GAMMA.sd))]);
      }
      stripCurve.setAttribute('d', clPathFrom(stripPts));
      const b0 = CSR_GAMMA.mean - CSR_GAMMA.sd, b1 = CSR_GAMMA.mean + CSR_GAMMA.sd;
      const bandPts = [];
      for (let i = 0; i <= 30; i++) {
        const g = b0 + ((b1 - b0) * i) / 30;
        bandPts.push([sxS(g), syS(clNormPdf(g, CSR_GAMMA.mean, CSR_GAMMA.sd))]);
      }
      stripBand.setAttribute('d', clPathFrom(bandPts) + `L${sxS(b1)},${syS(0)}L${sxS(b0)},${syS(0)}Z`);
      stripZero.setAttribute('x1', sxS(0)); stripZero.setAttribute('x2', sxS(0));
      stripZero.setAttribute('y1', fStrip.bottom); stripZero.setAttribute('y2', fStrip.top);
      const gx = sxS(v.gamma);
      stripMarker.setAttribute('x1', gx); stripMarker.setAttribute('x2', gx);
      stripMarker.setAttribute('y1', fStrip.bottom); stripMarker.setAttribute('y2', fStrip.top - 2);
      stripTag.setAttribute('x', gx);
      stripTag.setAttribute('y', fStrip.top - 8);
      stripTag.textContent = 'γ = ' + v.gamma.toFixed(3);

      // ── Scene 2: bars at the focus lag ──
      const w2 = s2.wrap.clientWidth || 420, h2 = s2.wrap.clientHeight || 280;
      s2.svg.setAttribute('width', w2); s2.svg.setAttribute('height', h2);
      const f2 = { left: 40, top: 16, right: w2 - 14, bottom: h2 - 26 };
      const sx2 = clScale(0.5, 10.5, f2.left, f2.right);
      const yMax = Math.max(...d.sharesAtLag, 0.01) * 1.18;
      const sy2 = clScale(0, yMax, f2.bottom, f2.top);
      axesBars.update(sx2, sy2, f2);
      barPool.set(d.sharesAtLag.map((s, i) => {
        const x0 = sx2(i + 1 - 0.34), x1 = sx2(i + 1 + 0.34);
        const y = sy2(s);
        return { x: x0, y, w: x1 - x0, h: Math.max(0, f2.bottom - y) };
      }), 'var(--cl-ink-1)');
      // AY 10 carries the accent — it is the year the naive average misprices.
      if (barPool.g.children[9]) barPool.g.children[9].setAttribute('fill', 'var(--px-accent)');
      const ay = sy2(d.sAvg);
      avgLine.setAttribute('x1', f2.left); avgLine.setAttribute('x2', f2.right);
      avgLine.setAttribute('y1', ay); avgLine.setAttribute('y2', ay);
      avgTag.setAttribute('x', f2.right - 4);
      avgTag.setAttribute('y', ay - 5);
      avgTag.textContent = 'Naive Average ' + clFmt(d.sAvg, 'pct');
      lagTag.setAttribute('x', (f2.left + f2.right) / 2);
      lagTag.setAttribute('y', f2.bottom + 22);
      lagTag.textContent = 'Accident Year (Focus Lag d = ' + d.dLagInt + ')';
    },
    snapshot(st, d) {
      return { label: st.presetId || 'pin', gamma: st.values.gamma, biasRatio: d.biasRatio };
    },
  };
}

// --- MCMC: the random walk and the accumulating histogram ------------------

function buildMcmcScenes(stageRow, ctx) {
  const { linkRoot, animator } = ctx;
  const T = MCMC_TARGET;
  const MAX_DRAWS = 6000;
  const BURN_IN = 100;

  const s1 = buildScene(stageRow, 'The Random Walk', [
    { label: 'Posterior Contours', color: 'var(--cl-ink-1)', dashed: true, link: 'chain' },
    { label: 'Chain', color: 'var(--px-accent)', link: 'chain' },
    { label: 'Rejected', color: 'var(--cl-ink-2)', link: 'chain' },
  ], linkRoot);
  const head1 = s1.scene.querySelector('.cl-scene-head');
  const btnPlay = document.createElement('button');
  btnPlay.className = 'cl-scene-btn';
  const btnStep = document.createElement('button');
  btnStep.className = 'cl-scene-btn';
  btnStep.innerHTML = clIcon('redo', 12) + '<span>Step</span>';
  const btnReset = document.createElement('button');
  btnReset.className = 'cl-scene-btn';
  btnReset.innerHTML = clIcon('rotate-ccw', 12) + '<span>Reset</span>';
  head1.appendChild(btnPlay); head1.appendChild(btnStep); head1.appendChild(btnReset);

  const axes1 = createAxes(s1.svg, { xFmt: (v) => v.toFixed(2), yFmt: (v) => v.toFixed(2), xTicks: 4, yTicks: 4 });
  const contours = [1, 2, 3].map((lvl) => {
    const p = svgEl('path', { stroke: 'var(--cl-ink-1)', opacity: String(0.9 - lvl * 0.22) }, 'cl-curve cl-ref');
    p.dataset.clLink = 'chain';
    s1.svg.appendChild(p);
    return p;
  });
  const trail = svgEl('path', { stroke: 'var(--px-accent)', opacity: 0.75, 'stroke-width': 1.4 }, 'cl-curve');
  trail.dataset.clLink = 'chain';
  s1.svg.appendChild(trail);
  const rejectPool = [];
  for (let i = 0; i < 8; i++) {
    const c = svgEl('circle', { r: 2.6, fill: 'var(--cl-ink-2)', opacity: 0 }, 'cl-dot');
    s1.svg.appendChild(c);
    rejectPool.push(c);
  }
  const stateDot = svgEl('circle', { r: 5.5, fill: 'var(--px-accent)', stroke: 'var(--px-bg)', 'stroke-width': 1.5 }, 'cl-dot');
  stateDot.dataset.clLink = 'chain';
  s1.svg.appendChild(stateDot);

  const s2 = buildScene(stageRow, 'What Accumulates', [
    { label: 'Trace', color: 'var(--px-accent)', link: 'hist' },
    { label: 'Table 7.1 Target', color: 'var(--cl-ink-1)', dashed: true, link: 'hist' },
  ], linkRoot);
  const axesTrace = createAxes(s2.svg, { xFmt: () => '', yFmt: (v) => v.toFixed(2), xTicks: 0, yTicks: 3 });
  const axesHist = createAxes(s2.svg, { xFmt: (v) => v.toFixed(2), yFmt: () => '', yTicks: 0, xTicks: 4 });
  const tracePath = svgEl('path', { stroke: 'var(--px-accent)', 'stroke-width': 1.2 }, 'cl-curve');
  tracePath.dataset.clLink = 'hist';
  const traceMean = svgEl('line', { stroke: 'var(--cl-ink-1)' }, 'cl-curve cl-ref');
  const histPool = makeBarPool(s2.svg, 'cl-bar');
  histPool.g.dataset.clLink = 'hist';
  const histTarget = svgEl('path', { stroke: 'var(--cl-ink-1)' }, 'cl-curve cl-ref');
  histTarget.dataset.clLink = 'hist';
  s2.svg.appendChild(tracePath); s2.svg.appendChild(traceMean); s2.svg.appendChild(histTarget);

  // Chain state — deliberately NOT in view-state: a fresh, watchable
  // convergence each time the module mounts is the lesson.
  let rng, walker, xs, ys, accepts, rejects, playing;
  function reset() {
    rng = clMulberry32(MCMC_SEED);
    // Overdispersed start so burn-in is something you can SEE.
    walker = { x: T.mx + 3.5 * T.sx, y: T.my + 3.5 * T.sy };
    xs = []; ys = [];
    accepts = [];
    rejects = [];
    setPlaying(true);
    publish(ctx.getState());
  }
  function setPlaying(on) {
    playing = on;
    btnPlay.innerHTML = clIcon(on ? 'pause' : 'play', 12) + `<span>${on ? 'Pause' : 'Play'}</span>`;
    if (on) {
      animator.loop('mcmc', () => stepChain(3));
    } else {
      animator.stopLoop('mcmc');
      animator.invalidate();
    }
  }
  function stepChain(count) {
    const st = ctx.getState();
    for (let i = 0; i < count; i++) {
      if (xs.length >= MAX_DRAWS) { setPlaying(false); break; }
      const r = clMetropolisStep(walker, T, st.values.step, rng);
      if (!r.accept) {
        rejects.push({ x: r.px, y: r.py });
        if (rejects.length > rejectPool.length) rejects.shift();
      }
      accepts.push(r.accept ? 1 : 0);
      if (accepts.length > 200) accepts.shift();
      xs.push(walker.x); ys.push(walker.y);
    }
    publish(st);
  }
  function publish(st) {
    const tail = xs.slice(BURN_IN);
    let mean = NaN, sd = NaN;
    if (tail.length > 1) {
      mean = tail.reduce((a, b) => a + b, 0) / tail.length;
      sd = Math.sqrt(tail.reduce((a, b) => a + (b - mean) * (b - mean), 0) / tail.length);
    }
    st.sceneStats = {
      draws: xs.length,
      acceptRate: accepts.length ? accepts.reduce((a, b) => a + b, 0) / accepts.length : NaN,
      meanLogelr: mean,
      sdLogelr: sd,
    };
  }
  btnPlay.addEventListener('click', () => setPlaying(!playing));
  btnStep.addEventListener('click', () => { if (!playing) stepChain(1); });
  btnReset.addEventListener('click', reset);
  reset();

  return {
    update(st) {
      // ── Scene 1 ──
      const w1 = s1.wrap.clientWidth || 420, h1 = s1.wrap.clientHeight || 280;
      s1.svg.setAttribute('width', w1); s1.svg.setAttribute('height', h1);
      const f1 = { left: 46, top: 12, right: w1 - 14, bottom: h1 - 26 };
      const sx1 = clScale(T.mx - 4.2 * T.sx, T.mx + 4.2 * T.sx, f1.left, f1.right);
      const sy1 = clScale(T.my - 4.2 * T.sy, T.my + 4.2 * T.sy, f1.bottom, f1.top);
      axes1.update(sx1, sy1, f1);
      const rr = Math.sqrt(1 - T.rho * T.rho);
      contours.forEach((p, i) => {
        const lvl = i + 1;
        const pts = [];
        for (let a = 0; a <= 48; a++) {
          const th = (2 * Math.PI * a) / 48;
          const u = lvl * Math.cos(th), vv = lvl * Math.sin(th);
          pts.push([sx1(T.mx + T.sx * u), sy1(T.my + T.sy * (T.rho * u + rr * vv))]);
        }
        p.setAttribute('d', clPathFrom(pts) + 'Z');
      });
      const tr = [];
      for (let i = Math.max(0, xs.length - 80); i < xs.length; i++) tr.push([sx1(xs[i]), sy1(ys[i])]);
      trail.setAttribute('d', tr.length > 1 ? clPathFrom(tr) : '');
      rejectPool.forEach((c, i) => {
        const rj = rejects[rejects.length - 1 - i];
        if (!rj) { c.setAttribute('opacity', 0); return; }
        c.setAttribute('cx', sx1(rj.x)); c.setAttribute('cy', sy1(rj.y));
        c.setAttribute('opacity', String(0.55 * (1 - i / rejectPool.length)));
      });
      stateDot.setAttribute('cx', sx1(walker.x)); stateDot.setAttribute('cy', sy1(walker.y));

      // ── Scene 2 ──
      const w2 = s2.wrap.clientWidth || 420, h2 = s2.wrap.clientHeight || 280;
      s2.svg.setAttribute('width', w2); s2.svg.setAttribute('height', h2);
      const fT = { left: 46, top: 12, right: w2 - 14, bottom: Math.floor(h2 * 0.42) };
      const fH = { left: 46, top: Math.floor(h2 * 0.42) + 26, right: w2 - 14, bottom: h2 - 24 };

      const lo = T.mx - 4 * T.sx, hi = T.mx + 4 * T.sx;
      const trace = xs.slice(-300);
      const sxT = clScale(0, Math.max(60, trace.length - 1), fT.left, fT.right);
      const syT = clScale(lo, hi, fT.bottom, fT.top);
      axesTrace.update(sxT, syT, fT);
      tracePath.setAttribute('d', trace.length > 1
        ? clPathFrom(trace.map((x, i) => [sxT(i), syT(Math.max(lo, Math.min(hi, x)))]))
        : '');
      traceMean.setAttribute('x1', fT.left); traceMean.setAttribute('x2', fT.right);
      traceMean.setAttribute('y1', syT(T.mx)); traceMean.setAttribute('y2', syT(T.mx));

      const NB = 26;
      const bins = new Array(NB).fill(0);
      const tail = xs.slice(BURN_IN);
      for (const x of tail) {
        const b = Math.floor(((x - lo) / (hi - lo)) * NB);
        if (b >= 0 && b < NB) bins[b]++;
      }
      const binW = (hi - lo) / NB;
      const density = tail.length ? bins.map((c) => c / (tail.length * binW)) : bins;
      const peak = clNormPdf(T.mx, T.mx, T.sx);
      const yMaxH = Math.max(peak, ...density) * 1.15;
      const sxH = clScale(lo, hi, fH.left, fH.right);
      const syH = clScale(0, yMaxH, fH.bottom, fH.top);
      axesHist.update(sxH, syH, fH);
      histPool.set(density.map((den, i) => {
        const x0 = sxH(lo + i * binW) + 0.5, x1 = sxH(lo + (i + 1) * binW) - 0.5;
        const y = syH(den);
        return { x: x0, y, w: Math.max(1, x1 - x0), h: Math.max(0, fH.bottom - y) };
      }), 'var(--px-accent)');
      const tgt = [];
      for (let i = 0; i <= 90; i++) {
        const x = lo + ((hi - lo) * i) / 90;
        tgt.push([sxH(x), syH(Math.min(yMaxH, clNormPdf(x, T.mx, T.sx)))]);
      }
      histTarget.setAttribute('d', clPathFrom(tgt));
      void st;
    },
    snapshot() {
      return { label: 'chain', draws: xs.length };
    },
  };
}

// --- Mack: the projection fan and the quoted range -------------------------

function buildMackScenes(stageRow, ctx) {
  const { linkRoot, animator } = ctx;
  const I = RAA.length;

  const s1 = buildScene(stageRow, 'The Fan Of Projections (RAA Triangle)', [
    { label: 'Observed', color: 'var(--cl-ink-1)', link: 'fans' },
    { label: 'Projected', color: 'var(--cl-ink-1)', dashed: true, link: 'fans' },
    { label: 'Focus Year ±1se', color: 'var(--px-accent)', link: 'focus' },
  ], linkRoot);
  const axes1 = createAxes(s1.svg, { xFmt: (v) => String(v), yFmt: (v) => clFmt(v, 'num'), xTicks: 9, yTicks: 4 });
  const ribbon = svgEl('path', { fill: 'var(--px-accent)' }, 'cl-band');
  ribbon.dataset.clLink = 'focus';
  s1.svg.appendChild(ribbon);
  const obsPaths = [], projPaths = [];
  for (let i = 0; i < I; i++) {
    const o = svgEl('path', { stroke: 'var(--px-text-faint)' }, 'cl-curve cl-ref');
    o.style.strokeDasharray = 'none';
    o.dataset.clLink = 'fans';
    const p = svgEl('path', { stroke: 'var(--px-text-faint)' }, 'cl-curve cl-ref');
    p.dataset.clLink = 'fans';
    s1.svg.appendChild(o); s1.svg.appendChild(p);
    obsPaths.push(o); projPaths.push(p);
  }
  const focusTag = svgEl('text', { 'text-anchor': 'start', fill: 'var(--px-accent)' }, 'cl-svg-value');
  s1.svg.appendChild(focusTag);

  const s2 = buildScene(stageRow, 'The Range That Gets Quoted (Total Reserve)', [
    { label: 'Lognormal', color: 'var(--px-accent)', link: 'range' },
    { label: 'Normal', color: 'var(--cl-ink-1)', dashed: true, link: 'range' },
  ], linkRoot);
  const axes2 = createAxes(s2.svg, { xFmt: (v) => clFmt(v, 'num'), yFmt: () => '', yTicks: 0, xTicks: 4 });
  const pLn = svgEl('path', { stroke: 'var(--px-accent)' }, 'cl-curve');
  pLn.dataset.clLink = 'range';
  const pNorm = svgEl('path', { stroke: 'var(--cl-ink-1)' }, 'cl-curve cl-ref');
  pNorm.dataset.clLink = 'range';
  const markLn = svgEl('line', { stroke: 'var(--px-accent)', 'stroke-width': 2 }, '');
  const markNorm = svgEl('line', {}, 'cl-marker-line');
  const tagLn = svgEl('text', { 'text-anchor': 'middle', fill: 'var(--px-accent)' }, 'cl-svg-value');
  const tagNorm = svgEl('text', { 'text-anchor': 'middle', fill: 'var(--cl-ink-1)' }, 'cl-svg-tag');
  const meanTick = svgEl('line', {}, 'cl-marker-line');
  s2.svg.appendChild(pLn); s2.svg.appendChild(pNorm);
  s2.svg.appendChild(meanTick); s2.svg.appendChild(markLn); s2.svg.appendChild(markNorm);
  s2.svg.appendChild(tagLn); s2.svg.appendChild(tagNorm);

  const domY1 = animator.smooth(40000, 110);
  let frame2 = null;
  let lnShape = null;
  let drewIn = false;

  clDragOnSvg(s2.svg, (e) => {
    if (!frame2 || !lnShape) return;
    const x = frame2.sx.invert(clSvgPoint(s2.svg, e).x);
    const p = clLognCdf(x, lnShape.mu, lnShape.sigma) * 100;
    const st = ctx.getState();
    const r = st.ranges.pct;
    ctx.setParam('pct', Math.max(r.min, Math.min(r.max, Math.round(p))));
  });

  return {
    update(st, d) {
      // ── Scene 1 ──
      const w1 = s1.wrap.clientWidth || 420, h1 = s1.wrap.clientHeight || 280;
      s1.svg.setAttribute('width', w1); s1.svg.setAttribute('height', h1);
      const f1 = { left: 56, top: 14, right: w1 - 40, bottom: h1 - 26 };
      const proj = d.projSquare;
      let yMax = 0;
      for (const row of proj) yMax = Math.max(yMax, row[I - 1]);
      if (st.fresh) domY1.snap(yMax * 1.12); else domY1.target = yMax * 1.12;
      const sx1 = clScale(1, I, f1.left, f1.right);
      const sy1 = clScale(0, domY1.current, f1.bottom, f1.top);
      axes1.update(sx1, sy1, f1);

      for (let i = 0; i < I; i++) {
        const obs = RAA[i].length;
        const isFocus = i === d.focusIdx;
        const color = isFocus ? 'var(--px-accent)' : 'var(--px-text-faint)';
        obsPaths[i].setAttribute('stroke', color);
        projPaths[i].setAttribute('stroke', color);
        obsPaths[i].classList.toggle('cl-ref', !isFocus);
        projPaths[i].classList.toggle('cl-ref', !isFocus);
        obsPaths[i].style.strokeDasharray = 'none';
        if (isFocus) projPaths[i].style.strokeDasharray = '5 4';
        else projPaths[i].style.strokeDasharray = '';
        const oPts = [];
        for (let k = 0; k < obs; k++) oPts.push([sx1(k + 1), sy1(RAA[i][k])]);
        obsPaths[i].setAttribute('d', clPathFrom(oPts));
        const pPts = [];
        for (let k = obs - 1; k < I; k++) pPts.push([sx1(k + 1), sy1(proj[i][k])]);
        projPaths[i].setAttribute('d', obs < I ? clPathFrom(pPts) : '');
      }

      // ±1se ribbon along the focus year, vw machinery only.
      const y = d.mack.perYear[d.focusIdx];
      if (d.seAvailable && y.steps.length) {
        const up = [], dn = [];
        const startObs = RAA[d.focusIdx].length;
        up.push([sx1(startObs), sy1(RAA[d.focusIdx][startObs - 1])]);
        for (const stp of y.steps) {
          const se = d.mack.proj[d.focusIdx][stp.c] * Math.sqrt(stp.acc);
          up.push([sx1(stp.c + 1), sy1(d.mack.proj[d.focusIdx][stp.c] + se)]);
          dn.push([sx1(stp.c + 1), sy1(Math.max(0, d.mack.proj[d.focusIdx][stp.c] - se))]);
        }
        ribbon.style.display = '';
        ribbon.setAttribute('d', clPathFrom(up) + clPathFrom(dn.reverse()).replace(/^M/, 'L') + 'Z');
      } else {
        ribbon.style.display = 'none';
      }
      focusTag.setAttribute('x', sx1(I) - 2);
      focusTag.setAttribute('y', sy1(proj[d.focusIdx][I - 1]) - 8);
      focusTag.setAttribute('text-anchor', 'end');
      focusTag.textContent = `AY ${d.focusIdx + 1}: ${clFmt(proj[d.focusIdx][I - 1], 'num')}`;
      if (!drewIn) { drewIn = true; if (projPaths[d.focusIdx]) clDrawIn(projPaths[d.focusIdx]); }

      // ── Scene 2 ──
      const w2 = s2.wrap.clientWidth || 420, h2 = s2.wrap.clientHeight || 280;
      s2.svg.setAttribute('width', w2); s2.svg.setAttribute('height', h2);
      const f2 = { left: 20, top: 14, right: w2 - 16, bottom: h2 - 26 };
      const hi = d.totalR * 2.6;
      const sx2 = clScale(0, hi, f2.left, f2.right);
      lnShape = clMatchLognormal(d.totalR, d.totalSe);
      const lnPdf = (x) => clLognPdf(x, lnShape.mu, lnShape.sigma);
      const nPdf = (x) => clNormPdf(x, d.totalR, d.totalSe);
      let yMax2 = 0;
      const N = 150;
      const lnPts = [], nPts = [];
      for (let i = 0; i <= N; i++) {
        const x = (hi * i) / N;
        const a = lnPdf(x), b = nPdf(x);
        yMax2 = Math.max(yMax2, a, b);
        lnPts.push([x, a]); nPts.push([x, b]);
      }
      const sy2 = clScale(0, yMax2 * 1.12, f2.bottom, f2.top);
      frame2 = { sx: sx2 };
      axes2.update(sx2, sy2, f2);
      pLn.setAttribute('d', clPathFrom(lnPts.map(([x, v]) => [sx2(x), sy2(v)])));
      pNorm.setAttribute('d', clPathFrom(nPts.map(([x, v]) => [sx2(x), sy2(v)])));

      const putMark = (line, tag, x, label, yOff) => {
        const px = sx2(Math.min(hi, Math.max(0, x)));
        line.setAttribute('x1', px); line.setAttribute('x2', px);
        line.setAttribute('y1', f2.bottom); line.setAttribute('y2', f2.top + 12);
        tag.setAttribute('x', px); tag.setAttribute('y', f2.top + 10 + yOff);
        tag.textContent = label;
      };
      putMark(markLn, tagLn, d.lnPct, `LN ${Math.round(d.pct)}th ${clFmt(d.lnPct, 'num')}`, 0);
      putMark(markNorm, tagNorm, d.normPct, `N ${clFmt(d.normPct, 'num')}`, 13);
      meanTick.setAttribute('x1', sx2(d.totalR)); meanTick.setAttribute('x2', sx2(d.totalR));
      meanTick.setAttribute('y1', f2.bottom); meanTick.setAttribute('y2', f2.bottom - 16);
    },
    snapshot(st, d) {
      return { label: st.presetId || 'pin', f1: d.f1, totalR: d.totalR };
    },
  };
}

// --- Clark: the growth curve and the reserve consequence -------------------

function buildClarkScenes(stageRow, ctx) {
  const { linkRoot, animator } = ctx;

  const s1 = buildScene(stageRow, 'The Growth Curve G(x)', [
    { label: 'This Fit', color: 'var(--px-accent)', link: 'curve' },
    { label: 'Other Family', color: 'var(--cl-ink-1)', dashed: true, link: 'curve' },
    { label: 'Beyond Truncation', color: 'var(--cl-ink-4)', link: 'trunc' },
  ], linkRoot);
  const axes1 = createAxes(s1.svg, { xFmt: (v) => String(v), yFmt: (v) => Math.round(v * 100) + '%', xTicks: 6, yTicks: 4 });
  const tailShade = svgEl('rect', { fill: 'var(--cl-ink-4)' }, 'cl-band');
  tailShade.dataset.clLink = 'trunc';
  s1.svg.appendChild(tailShade);
  const pOther = svgEl('path', { stroke: 'var(--cl-ink-1)' }, 'cl-curve cl-ref');
  pOther.dataset.clLink = 'curve';
  const pMain = svgEl('path', { stroke: 'var(--px-accent)' }, 'cl-curve');
  pMain.dataset.clLink = 'curve';
  s1.svg.appendChild(pOther); s1.svg.appendChild(pMain);
  const gDots = svgEl('g'); gDots.dataset.clLink = 'curve';
  for (let i = 0; i < CLARK_AGES.length; i++) {
    gDots.appendChild(svgEl('circle', { r: 3, fill: 'var(--px-accent)', stroke: 'var(--px-bg)', 'stroke-width': 1 }, 'cl-dot'));
  }
  s1.svg.appendChild(gDots);
  const truncLine = svgEl('line', { stroke: 'var(--cl-ink-4)', 'stroke-width': 2 }, '');
  truncLine.dataset.clLink = 'trunc';
  const truncTag = svgEl('text', { 'text-anchor': 'middle', fill: 'var(--cl-ink-4)' }, 'cl-svg-tag');
  const tailTag = svgEl('text', { 'text-anchor': 'middle' }, 'cl-svg-value');
  s1.svg.appendChild(truncLine); s1.svg.appendChild(truncTag); s1.svg.appendChild(tailTag);

  const s2 = buildScene(stageRow, 'Reserves By Accident Year', [
    { label: 'To Truncation', color: 'var(--px-accent)', link: 'bars' },
    { label: 'To Ultimate', color: 'var(--cl-ink-1)', link: 'bars' },
  ], linkRoot);
  const axes2 = createAxes(s2.svg, { xFmt: (v) => "'" + String(91 + Math.round(v) - 1).slice(-2), yFmt: (v) => clFmt(v / 1e6, 'num2') + 'M', xTicks: 9, yTicks: 4 });
  const fullBars = makeBarPool(s2.svg, 'cl-bar cl-bar--cmp');
  fullBars.g.dataset.clLink = 'bars';
  const truncBars = makeBarPool(s2.svg, 'cl-bar');
  truncBars.g.dataset.clLink = 'bars';
  const totTag = svgEl('text', { 'text-anchor': 'end' }, 'cl-svg-value');
  s2.svg.appendChild(totTag);

  let frame1 = null;
  let drewIn = false;

  clDragOnSvg(s1.svg, (e) => {
    if (!frame1) return;
    const age = frame1.sx.invert(clSvgPoint(s1.svg, e).x) + 6;
    const st = ctx.getState();
    const r = st.ranges.truncAge;
    ctx.setParam('truncAge', Math.max(r.min, Math.min(r.max, Math.round(age / 12) * 12)));
  });

  return {
    update(st, d) {
      const v = st.values;
      const shape = { family: d.family, omega: v.omega, theta: v.theta };
      const other = d.family === 'weibull' ? CLARK_LL : CLARK_WB;

      // ── Scene 1 ──
      const w1 = s1.wrap.clientWidth || 420, h1 = s1.wrap.clientHeight || 280;
      s1.svg.setAttribute('width', w1); s1.svg.setAttribute('height', h1);
      const f1 = { left: 40, top: 14, right: w1 - 16, bottom: h1 - 26 };
      const xMax = Math.max(320, v.truncAge + 48);
      const sx1 = clScale(0, xMax, f1.left, f1.right);
      const sy1 = clScale(0, 1.02, f1.bottom, f1.top);
      frame1 = { sx: sx1 };
      axes1.update(sx1, sy1, f1);
      const N = 140;
      const curve = (sh) => {
        const pts = [];
        for (let i = 0; i <= N; i++) {
          const x = (xMax * i) / N;
          pts.push([sx1(x), sy1(clClarkG(x, sh))]);
        }
        return clPathFrom(pts);
      };
      pMain.setAttribute('d', curve(shape));
      pOther.setAttribute('d', curve(other));
      if (!drewIn) { drewIn = true; clDrawIn(pMain); }
      for (let i = 0; i < CLARK_AGES.length; i++) {
        const c = gDots.children[i];
        c.setAttribute('cx', sx1(CLARK_AGES[i]));
        c.setAttribute('cy', sy1(clClarkG(CLARK_AGES[i], shape)));
      }
      const tx = sx1(d.truncAvg);
      truncLine.setAttribute('x1', tx); truncLine.setAttribute('x2', tx);
      truncLine.setAttribute('y1', f1.bottom); truncLine.setAttribute('y2', f1.top);
      truncTag.setAttribute('x', tx);
      truncTag.setAttribute('y', f1.bottom + 22);
      truncTag.textContent = 'Truncate At ' + v.truncAge + ' Months';
      tailShade.setAttribute('x', tx);
      tailShade.setAttribute('y', f1.top);
      tailShade.setAttribute('width', Math.max(0, f1.right - tx));
      tailShade.setAttribute('height', f1.bottom - f1.top);
      tailTag.setAttribute('x', Math.min(f1.right - 8, tx + (f1.right - tx) / 2));
      tailTag.setAttribute('y', f1.top + 16);
      tailTag.textContent = 'Tail: ' + clFmt(d.tailBeyond / 1e6, 'num2') + 'M';

      // ── Scene 2 ──
      const w2 = s2.wrap.clientWidth || 420, h2 = s2.wrap.clientHeight || 280;
      s2.svg.setAttribute('width', w2); s2.svg.setAttribute('height', h2);
      const f2 = { left: 48, top: 16, right: w2 - 14, bottom: h2 - 26 };
      const sx2 = clScale(0.5, 10.5, f2.left, f2.right);
      const yMax = Math.max(...d.reservesFull, 1) * 1.15;
      const sy2 = clScale(0, yMax, f2.bottom, f2.top);
      axes2.update(sx2, sy2, f2);
      fullBars.set(d.reservesFull.map((r, i) => {
        const x0 = sx2(i + 1 - 0.38), x1 = sx2(i + 1 + 0.38);
        const y = sy2(r);
        return { x: x0, y, w: x1 - x0, h: Math.max(0, f2.bottom - y) };
      }), 'var(--cl-ink-1)');
      truncBars.set(d.reservesTrunc.map((r, i) => {
        const x0 = sx2(i + 1 - 0.26), x1 = sx2(i + 1 + 0.26);
        const y = sy2(Math.max(0, r));
        return { x: x0, y, w: x1 - x0, h: Math.max(0, f2.bottom - y) };
      }), 'var(--px-accent)');
      totTag.setAttribute('x', f2.right - 6);
      totTag.setAttribute('y', f2.top + 14);
      totTag.textContent = clFmt(d.totalTrunc / 1e6, 'num2') + 'M of ' + clFmt(d.totalFull / 1e6, 'num2') + 'M';
    },
    snapshot(st, d) {
      return { label: st.presetId || 'pin', family: d.family, totalTrunc: d.totalTrunc };
    },
  };
}

// --- Bootstrap: the residual pool and the accumulating reserve histogram ---

function buildBootstrapScenes(stageRow, ctx) {
  const { linkRoot, animator } = ctx;

  const s1 = buildScene(stageRow, 'The Residual Pool (55 Cells)', [
    { label: 'Standardized Residual', color: 'var(--px-accent)', link: 'resid' },
  ], linkRoot);
  const axes1 = createAxes(s1.svg, { xFmt: (v) => String(v), yFmt: (v) => String(v), xTicks: 9, yTicks: 4 });
  const zeroLine = svgEl('line', {}, 'cl-marker-line');
  s1.svg.appendChild(zeroLine);
  const gResid = svgEl('g'); gResid.dataset.clLink = 'resid';
  for (let i = 0; i < TA_FIT.resid.length; i++) {
    gResid.appendChild(svgEl('circle', { r: 3, fill: 'var(--px-accent)', opacity: 0.8 }, 'cl-dot'));
  }
  s1.svg.appendChild(gResid);

  const s2 = buildScene(stageRow, 'The Reserve Distribution', [
    { label: 'Bootstrap Totals', color: 'var(--px-accent)', link: 'hist' },
    { label: 'Chain Ladder', color: 'var(--cl-ink-1)', dashed: true, link: 'hist' },
  ], linkRoot);
  const head2 = s2.scene.querySelector('.cl-scene-head');
  const replay = document.createElement('button');
  replay.className = 'cl-scene-btn';
  replay.innerHTML = clIcon('play', 12) + '<span>Replay</span>';
  head2.appendChild(replay);
  const axes2 = createAxes(s2.svg, { xFmt: (v) => clFmt(v / 1e6, 'num') + 'M', yFmt: () => '', yTicks: 0, xTicks: 5 });
  const histPool = makeBarPool(s2.svg, 'cl-bar');
  histPool.g.dataset.clLink = 'hist';
  const clLine = svgEl('line', { stroke: 'var(--cl-ink-1)' }, 'cl-curve cl-ref');
  const clTag = svgEl('text', { 'text-anchor': 'middle', fill: 'var(--cl-ink-1)' }, 'cl-svg-tag');
  const meanLine = svgEl('line', { stroke: 'var(--px-accent)', 'stroke-width': 2 }, '');
  const p95Line = svgEl('line', {}, 'cl-marker-line');
  const p95Tag = svgEl('text', { 'text-anchor': 'middle' }, 'cl-svg-tag');
  s2.svg.appendChild(clLine); s2.svg.appendChild(clTag);
  s2.svg.appendChild(meanLine); s2.svg.appendChild(p95Line); s2.svg.appendChild(p95Tag);

  const domLo = animator.smooth(9e6, 130);
  const domHi = animator.smooth(32e6, 130);

  let draws = [];
  let rng = null;
  let withProcess = true;
  let lastMode = null;

  function publish(st) {
    const n = draws.length;
    let mean = null, cv = null, p95 = null;
    if (n > 10) {
      const m = draws.reduce((a, b) => a + b, 0) / n;
      const sd = Math.sqrt(draws.reduce((a, b) => a + (b - m) * (b - m), 0) / n);
      const sorted = [...draws].sort((a, b) => a - b);
      mean = m;
      cv = sd / m;
      p95 = sorted[Math.floor(0.95 * (n - 1))];
    }
    st.sceneStats = { done: n, bootMean: mean, bootCv: cv, p95 };
  }
  function reset() {
    draws = [];
    rng = clMulberry32(42);
    publish(ctx.getState());
    animator.loop('boot', runChunk);
  }
  function runChunk() {
    const st = ctx.getState();
    const target = Math.round(st.values.nSims);
    if (draws.length >= target) { animator.stopLoop('boot'); return; }
    const burst = Math.min(30, target - draws.length);
    for (let s = 0; s < burst; s++) draws.push(clOdpBootstrapOnce(TA_FIT, rng, withProcess));
    publish(st);
  }
  replay.addEventListener('click', reset);

  return {
    update(st, d) {
      if (st.mode !== lastMode) {
        lastMode = st.mode;
        withProcess = d.withProcess;
        reset();
      } else if (draws.length < Math.round(st.values.nSims) && !animator.hasLoop('boot')) {
        animator.loop('boot', runChunk);
      }

      // ── Scene 1 (static geometry, cheap to repaint) ──
      const w1 = s1.wrap.clientWidth || 420, h1 = s1.wrap.clientHeight || 280;
      s1.svg.setAttribute('width', w1); s1.svg.setAttribute('height', h1);
      const f1 = { left: 40, top: 14, right: w1 - 14, bottom: h1 - 26 };
      let rMax = 0;
      for (const { r } of TA_FIT.resid) rMax = Math.max(rMax, Math.abs(r));
      const sx1 = clScale(0.5, 10.5, f1.left, f1.right);
      const sy1 = clScale(-rMax * 1.15, rMax * 1.15, f1.bottom, f1.top);
      axes1.update(sx1, sy1, f1);
      zeroLine.setAttribute('x1', f1.left); zeroLine.setAttribute('x2', f1.right);
      zeroLine.setAttribute('y1', sy1(0)); zeroLine.setAttribute('y2', sy1(0));
      TA_FIT.resid.forEach((cell, idx) => {
        const c = gResid.children[idx];
        c.setAttribute('cx', sx1(cell.k + 1 + (cell.i - 4.5) / 16));
        c.setAttribute('cy', sy1(cell.r));
      });

      // ── Scene 2 ──
      const w2 = s2.wrap.clientWidth || 420, h2 = s2.wrap.clientHeight || 280;
      s2.svg.setAttribute('width', w2); s2.svg.setAttribute('height', h2);
      const f2 = { left: 20, top: 16, right: w2 - 14, bottom: h2 - 26 };
      if (draws.length > 30) {
        const sorted = [...draws].sort((a, b) => a - b);
        domLo.target = Math.min(sorted[Math.floor(0.003 * sorted.length)], d.clReserve * 0.75);
        domHi.target = Math.max(sorted[Math.ceil(0.997 * (sorted.length - 1))], d.clReserve * 1.3);
      }
      const lo = domLo.current, hi = domHi.current;
      const sx2 = clScale(lo, hi, f2.left, f2.right);
      const NB = 34;
      const bins = new Array(NB).fill(0);
      for (const r of draws) {
        const b = Math.floor(((r - lo) / (hi - lo)) * NB);
        if (b >= 0 && b < NB) bins[b]++;
      }
      const yMax = Math.max(6, ...bins) * 1.12;
      const sy2 = clScale(0, yMax, f2.bottom, f2.top);
      axes2.update(sx2, sy2, f2);
      histPool.set(bins.map((count, i) => {
        const x0 = sx2(lo + (i * (hi - lo)) / NB) + 0.5;
        const x1 = sx2(lo + ((i + 1) * (hi - lo)) / NB) - 0.5;
        const y = sy2(count);
        return { x: x0, y, w: Math.max(1, x1 - x0), h: Math.max(0, f2.bottom - y) };
      }), 'var(--px-accent)');
      const putV = (line, x, y1) => {
        const px = sx2(Math.max(lo, Math.min(hi, x)));
        line.setAttribute('x1', px); line.setAttribute('x2', px);
        line.setAttribute('y1', f2.bottom); line.setAttribute('y2', y1);
        return px;
      };
      const clX = putV(clLine, d.clReserve, f2.top + 10);
      clTag.setAttribute('x', clX); clTag.setAttribute('y', f2.top + 8);
      clTag.textContent = 'CL ' + clFmt(d.clReserve / 1e6, 'num2') + 'M';
      const stats = st.sceneStats || {};
      if (stats.bootMean) putV(meanLine, stats.bootMean, f2.top + 24);
      if (stats.p95) {
        const px = putV(p95Line, stats.p95, f2.top + 24);
        p95Tag.setAttribute('x', px); p95Tag.setAttribute('y', f2.top + 22);
        p95Tag.textContent = '95th ' + clFmt(stats.p95 / 1e6, 'num2') + 'M';
      }
    },
    snapshot(st) {
      return { label: st.presetId || 'pin', done: draws.length };
    },
  };
}

// --- Taylor: the cross-classified fit and the two-route reconciliation -----

function buildGlmClScenes(stageRow, ctx) {
  const { linkRoot, animator } = ctx;

  const s1 = buildScene(stageRow, 'The Fit, Year By Year', [
    { label: 'Actual Incrementals', color: 'var(--cl-ink-1)', link: 'fit' },
    { label: 'Fitted α̂ₖ · β̂ⱼ', color: 'var(--px-accent)', link: 'fit' },
  ], linkRoot);
  const axes1 = createAxes(s1.svg, { xFmt: (v) => String(v), yFmt: (v) => clFmt(v / 1000, 'num') + 'K', xTicks: 9, yTicks: 4 });
  const pFit = svgEl('path', { stroke: 'var(--px-accent)' }, 'cl-curve');
  pFit.dataset.clLink = 'fit';
  s1.svg.appendChild(pFit);
  const gActual = svgEl('g'); gActual.dataset.clLink = 'fit';
  for (let j = 0; j < 10; j++) {
    gActual.appendChild(svgEl('circle', { r: 3.5, fill: 'var(--cl-ink-1)' }, 'cl-dot'));
  }
  s1.svg.appendChild(gActual);
  const cellDot = svgEl('circle', { r: 5.5, fill: 'var(--px-accent)', stroke: 'var(--px-bg)', 'stroke-width': 1.5 }, 'cl-dot');
  cellDot.dataset.clLink = 'cell';
  const cellTag = svgEl('text', { 'text-anchor': 'middle' }, 'cl-svg-value');
  const yearTag = svgEl('text', { 'text-anchor': 'end' }, 'cl-svg-tag');
  s1.svg.appendChild(cellDot); s1.svg.appendChild(cellTag); s1.svg.appendChild(yearTag);

  const s2 = buildScene(stageRow, 'The Reconciliation, Live', [], linkRoot);
  const mkText = (anchor, cls, fill) => {
    const t = svgEl('text', { 'text-anchor': anchor }, cls);
    if (fill) t.setAttribute('fill', fill);
    s2.svg.appendChild(t);
    return t;
  };
  const routeALabel = mkText('start', 'cl-svg-tag');
  const routeA = mkText('start', 'cl-svg-value');
  const routeBLabel = mkText('start', 'cl-svg-tag');
  const routeB = mkText('start', 'cl-svg-value');
  const equals = mkText('middle', '', 'var(--px-accent)');
  equals.setAttribute('font-size', 30);
  equals.setAttribute('font-weight', 700);
  equals.dataset.clLink = 'cell';
  const gapText = mkText('middle', 'cl-svg-tag');
  const numA = mkText('middle', '', 'var(--px-accent)');
  numA.setAttribute('font-size', 19);
  numA.setAttribute('font-weight', 650);
  const numB = mkText('middle', '', 'var(--px-accent)');
  numB.setAttribute('font-size', 19);
  numB.setAttribute('font-weight', 650);

  const domY1 = animator.smooth(70000, 110);

  return {
    update(st, d) {
      const k = d.kIdx, j = d.jIdx;

      // ── Scene 1 ──
      const w1 = s1.wrap.clientWidth || 420, h1 = s1.wrap.clientHeight || 280;
      s1.svg.setAttribute('width', w1); s1.svg.setAttribute('height', h1);
      const f1 = { left: 48, top: 16, right: w1 - 16, bottom: h1 - 26 };
      const fitted = [];
      let yMax = 1;
      for (let jj = 0; jj < 10; jj++) {
        const v = TWC_MS.alpha[k] * TWC_MS.beta[jj];
        fitted.push(v);
        yMax = Math.max(yMax, v);
      }
      for (const q of TAYLOR_WC[k]) yMax = Math.max(yMax, q);
      if (st.fresh) domY1.snap(yMax * 1.15); else domY1.target = yMax * 1.15;
      const sx1 = clScale(1, 10, f1.left, f1.right);
      const sy1 = clScale(0, domY1.current, f1.bottom, f1.top);
      axes1.update(sx1, sy1, f1);
      pFit.setAttribute('d', clPathFrom(fitted.map((v, jj) => [sx1(jj + 1), sy1(v)])));
      for (let jj = 0; jj < 10; jj++) {
        const c = gActual.children[jj];
        if (jj < TAYLOR_WC[k].length) {
          c.style.display = '';
          c.setAttribute('cx', sx1(jj + 1));
          c.setAttribute('cy', sy1(TAYLOR_WC[k][jj]));
        } else {
          c.style.display = 'none';
        }
      }
      cellDot.setAttribute('cx', sx1(j + 1));
      cellDot.setAttribute('cy', sy1(fitted[j]));
      cellTag.setAttribute('x', sx1(j + 1));
      cellTag.setAttribute('y', sy1(fitted[j]) - 12);
      cellTag.textContent = clFmt(d.msCell, 'num');
      yearTag.setAttribute('x', f1.right - 4);
      yearTag.setAttribute('y', f1.top + 12);
      yearTag.textContent = 'Accident Year ' + (1988 + k) + ' · Forecast Cell j = ' + (j + 1);

      // ── Scene 2 ──
      const w2 = s2.wrap.clientWidth || 420, h2 = s2.wrap.clientHeight || 280;
      s2.svg.setAttribute('width', w2); s2.svg.setAttribute('height', h2);
      const left = 26;
      const fPrev = TWC_F[j - 1];
      const xPrev = TWC_PROJ[k][j - 1];
      routeALabel.setAttribute('x', left); routeALabel.setAttribute('y', h2 * 0.18);
      routeALabel.textContent = 'The Chain Ladder Route';
      routeA.setAttribute('x', left); routeA.setAttribute('y', h2 * 0.18 + 18);
      routeA.textContent = `${clFmt(xPrev, 'num')} × (${fPrev.toFixed(3)} − 1)`;
      numA.setAttribute('x', w2 / 2); numA.setAttribute('y', h2 * 0.18 + 44);
      numA.textContent = clFmt(d.clCell, 'num');

      equals.setAttribute('x', w2 / 2); equals.setAttribute('y', h2 * 0.56);
      equals.textContent = '=';

      routeBLabel.setAttribute('x', left); routeBLabel.setAttribute('y', h2 * 0.70);
      routeBLabel.textContent = 'The GLM Route';
      routeB.setAttribute('x', left); routeB.setAttribute('y', h2 * 0.70 + 18);
      routeB.textContent = `α̂ = ${clFmt(d.alphaK, 'num')}  ×  β̂ = ${d.betaJ.toFixed(4)}`;
      numB.setAttribute('x', w2 / 2); numB.setAttribute('y', h2 * 0.70 + 44);
      numB.textContent = clFmt(d.msCell, 'num');

      gapText.setAttribute('x', w2 / 2); gapText.setAttribute('y', h2 - 10);
      gapText.textContent = 'Largest Gap Across Every Future Cell: ' + (d.maxRel * 100).toExponential(1) + '%';
    },
    snapshot(st, d) {
      return { label: st.presetId || 'pin', cell: d.msCell };
    },
  };
}

// --- Marshall: sources by class, and the variance ladder -------------------

function buildMarshallScenes(stageRow, ctx) {
  const { linkRoot } = ctx;

  const s1 = buildScene(stageRow, 'The Sources, By Class', [
    { label: 'Independent', color: 'var(--cl-ink-1)', link: 'src-ind' },
    { label: 'Internal', color: 'var(--cl-ink-4)', link: 'src-int' },
    { label: 'External', color: 'var(--cl-ink-5)', link: 'src-ext' },
    { label: 'Consolidated', color: 'var(--px-accent)', link: 'margin' },
  ], linkRoot);
  const axes1 = createAxes(s1.svg, { xFmt: () => '', yFmt: (v) => (v * 100).toFixed(0) + '%', xTicks: 0, yTicks: 4 });
  const bars1 = makeBarPool(s1.svg, 'cl-bar');
  const groupTags = [];
  for (let g = 0; g < 4; g++) {
    const t = svgEl('text', { 'text-anchor': 'middle' }, 'cl-svg-tag');
    s1.svg.appendChild(t);
    groupTags.push(t);
  }

  const s2 = buildScene(stageRow, 'Variances Add, CoVs Do Not', [], linkRoot);
  const stripSegs = [
    svgEl('rect', { fill: 'var(--cl-ink-1)' }, 'cl-bar'),
    svgEl('rect', { fill: 'var(--cl-ink-4)' }, 'cl-bar'),
    svgEl('rect', { fill: 'var(--cl-ink-5)' }, 'cl-bar'),
  ];
  stripSegs[0].dataset.clLink = 'src-ind';
  stripSegs[1].dataset.clLink = 'src-int';
  stripSegs[2].dataset.clLink = 'src-ext';
  const stripLabel = svgEl('text', { 'text-anchor': 'start' }, 'cl-svg-tag');
  const naiveBar = svgEl('rect', { fill: 'var(--px-text-faint)' }, 'cl-bar cl-bar--cmp');
  const consBar = svgEl('rect', { fill: 'var(--px-accent)' }, 'cl-bar');
  consBar.dataset.clLink = 'margin';
  const naiveTag = svgEl('text', { 'text-anchor': 'start' }, 'cl-svg-tag');
  const consTag = svgEl('text', { 'text-anchor': 'start' }, 'cl-svg-tag');
  const marginText = svgEl('text', { 'text-anchor': 'middle', fill: 'var(--px-accent)', 'font-size': 22, 'font-weight': 650 }, '');
  marginText.dataset.clLink = 'margin';
  const marginSub = svgEl('text', { 'text-anchor': 'middle' }, 'cl-svg-tag');
  for (const el of [...stripSegs, stripLabel, naiveBar, consBar, naiveTag, consTag, marginText, marginSub]) {
    s2.svg.appendChild(el);
  }

  return {
    update(st, d) {
      // ── Scene 1 ──
      const w1 = s1.wrap.clientWidth || 420, h1 = s1.wrap.clientHeight || 280;
      s1.svg.setAttribute('width', w1); s1.svg.setAttribute('height', h1);
      const f1 = { left: 40, top: 16, right: w1 - 14, bottom: h1 - 30 };
      const groups = [...d.byClass, { label: 'Whole Portfolio', indep: d.totIndep, internal: d.totInternal, external: d.totExternal, total: d.total }];
      let yMax = 0.02;
      for (const g of groups) yMax = Math.max(yMax, g.total, g.external, g.internal, g.indep);
      const sy1 = clScale(0, yMax * 1.18, f1.bottom, f1.top);
      const sx1 = clScale(0, groups.length * 5 - 1, f1.left, f1.right);
      axes1.update(sx1, sy1, f1);
      const rects = [];
      const colors = [];
      groups.forEach((g, gi) => {
        const vals = [g.indep, g.internal, g.external, g.total];
        const inks = ['var(--cl-ink-1)', 'var(--cl-ink-4)', 'var(--cl-ink-5)', 'var(--px-accent)'];
        vals.forEach((v, bi) => {
          const x0 = sx1(gi * 5 + bi), x1 = sx1(gi * 5 + bi + 0.8);
          const y = sy1(v);
          rects.push({ x: x0, y, w: x1 - x0, h: Math.max(0, f1.bottom - y) });
          colors.push(inks[bi]);
        });
        groupTags[gi].setAttribute('x', sx1(gi * 5 + 1.9));
        groupTags[gi].setAttribute('y', f1.bottom + 14);
        groupTags[gi].textContent = g.label;
      });
      bars1.set(rects, 'var(--px-accent)');
      for (let i = 0; i < bars1.g.children.length; i++) {
        bars1.g.children[i].setAttribute('fill', colors[i]);
      }

      // ── Scene 2 ──
      const w2 = s2.wrap.clientWidth || 420, h2 = s2.wrap.clientHeight || 280;
      s2.svg.setAttribute('width', w2); s2.svg.setAttribute('height', h2);
      const left = 24, right = w2 - 24;
      const usable = right - left;

      // Variance strip: segment widths proportional to squared CoVs.
      const v2 = [d.totIndep ** 2, d.totInternal ** 2, d.totExternal ** 2];
      const vSum = v2[0] + v2[1] + v2[2];
      let xCur = left;
      const stripY = Math.round(h2 * 0.16), stripH = 22;
      v2.forEach((v, i) => {
        const wSeg = (v / vSum) * usable;
        stripSegs[i].setAttribute('x', xCur);
        stripSegs[i].setAttribute('y', stripY);
        stripSegs[i].setAttribute('width', Math.max(1, wSeg - 1));
        stripSegs[i].setAttribute('height', stripH);
        xCur += wSeg;
      });
      stripLabel.setAttribute('x', left);
      stripLabel.setAttribute('y', stripY - 6);
      stripLabel.textContent = 'Total Variance, Split ind² / int² / ext²';

      // CoV comparison: the naive sum against the consolidated value.
      const barY = Math.round(h2 * 0.45), barH = 14;
      const covScale = usable / Math.max(0.001, d.naiveSum * 1.05);
      naiveBar.setAttribute('x', left); naiveBar.setAttribute('y', barY);
      naiveBar.setAttribute('width', Math.max(1, d.naiveSum * covScale));
      naiveBar.setAttribute('height', barH);
      naiveTag.setAttribute('x', left); naiveTag.setAttribute('y', barY - 5);
      naiveTag.textContent = 'If CoVs Added: ' + clFmt(d.naiveSum, 'pct');
      consBar.setAttribute('x', left); consBar.setAttribute('y', barY + barH + 22);
      consBar.setAttribute('width', Math.max(1, d.total * covScale));
      consBar.setAttribute('height', barH);
      consTag.setAttribute('x', left); consTag.setAttribute('y', barY + barH + 17);
      consTag.textContent = 'Consolidated: ' + clFmt(d.total, 'pct');

      // The deliverable.
      marginText.setAttribute('x', w2 / 2);
      marginText.setAttribute('y', Math.round(h2 * 0.84));
      marginText.textContent = 'Risk Margin ' + clFmt(d.rmLogn, 'pct');
      marginSub.setAttribute('x', w2 / 2);
      marginSub.setAttribute('y', Math.round(h2 * 0.84) + 16);
      marginSub.textContent = `Lognormal at ${Math.round(st.values.adequacy)}% adequacy (normal: ${clFmt(d.rmNormal, 'pct')})`;
    },
    snapshot(st, d) {
      return { label: st.presetId || 'pin', total: d.total, rm: d.rmLogn };
    },
  };
}

// --- Claim Counter: draws pour onto the true PMF ---------------------------

function buildRandomVariableScenes(stageRow, ctx) {
  const { linkRoot, animator } = ctx;
  const { scene, wrap, svg } = buildScene(stageRow, 'What Happened vs What Was Probable', [
    { label: 'Empirical Frequency', color: 'var(--px-accent)', link: 'emp' },
    { label: 'True PMF', color: 'var(--cl-ink-1)', dashed: true, link: 'true' },
  ], linkRoot);

  const head = scene.querySelector('.cl-scene-head');
  const mkBtn = (label, icon) => {
    const b = document.createElement('button');
    b.className = 'cl-scene-btn';
    b.innerHTML = clIcon(icon, 12) + `<span>${label}</span>`;
    head.appendChild(b);
    return b;
  };
  const btnOne = mkBtn('Draw A Year', 'dice-5');
  const btnMany = mkBtn('Draw 100', 'dices');
  const btnRun = mkBtn('Run', 'play');
  const btnReset = mkBtn('Reset', 'rotate-ccw');

  const axes = createAxes(svg, {
    xFmt: (v) => (Number.isInteger(v) && v >= 0 ? String(v) : ''),
    yFmt: (v) => Math.round(v * 100) + '%',
  });
  const gGhosts = svgEl('g'); svg.appendChild(gGhosts);
  const bars = makeBarPool(svg, 'cl-bar');
  bars.g.dataset.clLink = 'emp';
  const pTrue = svgEl('path', { stroke: 'var(--cl-ink-1)' }, 'cl-curve cl-ref');
  pTrue.dataset.clLink = 'true';
  svg.appendChild(pTrue);
  const gTrueDots = svgEl('g'); gTrueDots.dataset.clLink = 'true'; svg.appendChild(gTrueDots);
  const empLine = svgEl('line', { stroke: 'var(--px-accent)' }, 'cl-curve');
  empLine.dataset.clLink = 'emp';
  const trueLine = svgEl('line', { stroke: 'var(--cl-ink-1)' }, 'cl-curve cl-ref');
  trueLine.dataset.clLink = 'true';
  const nTag = svgEl('text', { 'text-anchor': 'end' }, 'cl-svg-value');
  const dropDot = svgEl('circle', { r: 4.5, fill: 'var(--px-accent)' }, 'cl-dot');
  dropDot.style.display = 'none';
  svg.appendChild(empLine); svg.appendChild(trueLine); svg.appendChild(nTag); svg.appendChild(dropDot);

  // Draw state is deliberately NOT in view-state: a fresh, watchable
  // convergence beats a stale one (the MCMC scene set this precedent).
  let counts = [];
  let total = 0, sum = 0;
  let rng = clMulberry32(20260816);
  let simLam = null;
  let lastFrame = null;

  function publish() {
    ctx.getState().sceneStats = { drawCount: total, empMean: total ? sum / total : NaN };
  }
  function record(k) {
    counts[k] = (counts[k] || 0) + 1;
    total++; sum += k;
  }
  function stopRun() {
    animator.stopLoop('rv');
    btnRun.innerHTML = clIcon('play', 12) + '<span>Run</span>';
  }
  function reset() {
    counts = []; total = 0; sum = 0;
    rng = clMulberry32(20260816);
    simLam = ctx.getState().values.lam;
    stopRun();
    publish();
    animator.invalidate();
  }
  btnOne.addEventListener('click', () => {
    const k = clRandPoisson(ctx.getState().values.lam, rng);
    record(k); publish();
    if (lastFrame) {
      const { sx, frame } = lastFrame;
      dropDot.style.display = '';
      dropDot.setAttribute('cx', sx(k));
      const yEnd = frame.bottom - 6;
      animator.tween('rv-drop', frame.top + 10, yEnd, clMotion().base, (v) => {
        dropDot.setAttribute('cy', v);
        if (v >= yEnd - 0.5) dropDot.style.display = 'none';
      });
    }
    animator.invalidate();
  });
  btnMany.addEventListener('click', () => {
    const lam = ctx.getState().values.lam;
    for (let i = 0; i < 100; i++) record(clRandPoisson(lam, rng));
    publish();
    animator.invalidate();
  });
  btnRun.addEventListener('click', () => {
    if (animator.hasLoop('rv')) { stopRun(); return; }
    btnRun.innerHTML = clIcon('pause', 12) + '<span>Pause</span>';
    animator.loop('rv', () => {
      const lam = ctx.getState().values.lam;
      for (let i = 0; i < 4; i++) record(clRandPoisson(lam, rng));
      publish();
      if (total >= 100000) stopRun();
    });
  });
  btnReset.addEventListener('click', reset);
  reset();

  const domY = animator.smooth(0.25, 110);

  return {
    update(st) {
      if (simLam !== null && st.values.lam !== simLam) reset();
      const lam = st.values.lam;
      const w = wrap.clientWidth || 640, h = wrap.clientHeight || 300;
      svg.setAttribute('width', w); svg.setAttribute('height', h);
      const frame = { left: 44, top: 16, right: w - 16, bottom: h - 26 };
      const kmax = Math.max(12, Math.ceil(lam + 4.5 * Math.sqrt(lam)));

      let yMax = 0.02;
      const pmf = [];
      for (let k = 0; k <= kmax; k++) {
        pmf.push(clPoissonPmf(k, lam));
        yMax = Math.max(yMax, pmf[k]);
        if (total) yMax = Math.max(yMax, (counts[k] || 0) / total);
      }
      if (st.fresh) domY.snap(yMax * 1.2); else domY.target = yMax * 1.2;
      const sx = clScale(-0.5, kmax + 0.5, frame.left, frame.right);
      const sy = clScale(0, domY.current, frame.bottom, frame.top);
      lastFrame = { sx, sy, frame };
      axes.update(sx, sy, frame);

      const bw = Math.min(20, Math.max(3, (sx(1) - sx(0)) * 0.62));
      const rects = [];
      for (let k = 0; k <= kmax; k++) {
        const f = total ? (counts[k] || 0) / total : 0;
        rects.push({ x: sx(k) - bw / 2, y: sy(f), w: bw, h: Math.max(0, frame.bottom - sy(f)) });
      }
      bars.set(rects, 'var(--px-accent)');

      pTrue.setAttribute('d', clPathFrom(pmf.map((p, k) => [sx(k), sy(p)])));
      while (gTrueDots.children.length < pmf.length) gTrueDots.appendChild(svgEl('circle', { r: 2.5, fill: 'var(--cl-ink-1)' }, 'cl-dot'));
      while (gTrueDots.children.length > pmf.length) gTrueDots.lastChild.remove();
      for (let k = 0; k <= kmax; k++) {
        gTrueDots.children[k].setAttribute('cx', sx(k));
        gTrueDots.children[k].setAttribute('cy', sy(pmf[k]));
      }

      trueLine.setAttribute('x1', sx(lam)); trueLine.setAttribute('x2', sx(lam));
      trueLine.setAttribute('y1', frame.bottom); trueLine.setAttribute('y2', frame.top + 8);
      if (total) {
        empLine.style.display = '';
        const em = sum / total;
        empLine.setAttribute('x1', sx(em)); empLine.setAttribute('x2', sx(em));
        empLine.setAttribute('y1', frame.bottom); empLine.setAttribute('y2', frame.top + 8);
      } else {
        empLine.style.display = 'none';
      }
      nTag.setAttribute('x', frame.right - 4); nTag.setAttribute('y', frame.top + 12);
      nTag.textContent = total === 1 ? 'n = 1 year' : 'n = ' + total.toLocaleString('en-US') + ' years';

      gGhosts.innerHTML = '';
      for (const g of st.ghosts) {
        if (!g.freqs) continue;
        const pts = [];
        for (let k = 0; k <= Math.min(kmax, g.kmax ?? kmax); k++) {
          pts.push([sx(k), sy((g.freqs[k] || 0) / Math.max(1, g.total))]);
        }
        const gp = svgEl('path', {}, 'cl-ghost-curve');
        gp.setAttribute('d', clPathFrom(pts));
        gGhosts.appendChild(gp);
      }
    },
    snapshot(st) {
      if (!total) return null;
      return { label: 'n=' + total.toLocaleString('en-US'), freqs: counts.slice(), total, kmax: counts.length - 1 };
    },
  };
}

// --- Balance Point: draggable mass on a beam -------------------------------

function buildMeanMachineScenes(stageRow, ctx) {
  const { linkRoot, animator } = ctx;
  const { wrap, svg } = buildScene(stageRow, 'Drag The Probability Mass', [
    { label: 'Mass', color: 'var(--px-accent)', link: 'bars' },
    { label: 'Transformed aX+b', color: 'var(--cl-ink-1)', link: 'trans' },
    { label: 'Balance Point', color: 'var(--cl-ink-4)', link: 'mean' },
    { label: 'E[X] ± σ', color: 'var(--cl-ink-5)', link: 'sd' },
  ], linkRoot);
  const axes = createAxes(svg, {
    xFmt: (v) => clFmt(v, 'num'),
    yFmt: (v) => Math.round(v * 100) + '%',
    yTicks: 4,
  });
  const gGhosts = svgEl('g'); svg.appendChild(gGhosts);
  const bars = makeBarPool(svg, 'cl-bar');
  bars.g.dataset.clLink = 'bars';
  const gTrans = svgEl('g'); gTrans.dataset.clLink = 'trans'; svg.appendChild(gTrans);
  const beam = svgEl('line', { stroke: 'var(--px-text-muted)', 'stroke-width': 2, 'stroke-linecap': 'round' });
  const fulcrum = svgEl('path', { fill: 'var(--cl-ink-4)' });
  fulcrum.dataset.clLink = 'mean';
  const tFulcrum = svgEl('path', { fill: 'none', stroke: 'var(--cl-ink-1)', 'stroke-width': 1.5 });
  tFulcrum.dataset.clLink = 'trans';
  const sdBracket = svgEl('path', { stroke: 'var(--cl-ink-5)', 'stroke-width': 1.5, fill: 'none' });
  sdBracket.dataset.clLink = 'sd';
  const meanTag = svgEl('text', { 'text-anchor': 'middle', fill: 'var(--cl-ink-4)' }, 'cl-svg-value');
  meanTag.dataset.clLink = 'mean';
  const sdTag = svgEl('text', { 'text-anchor': 'middle', fill: 'var(--cl-ink-5)' }, 'cl-svg-tag');
  sdTag.dataset.clLink = 'sd';
  const skewTag = svgEl('text', { 'text-anchor': 'start' }, 'cl-svg-tag');
  skewTag.dataset.clLink = 'skew';
  svg.appendChild(beam); svg.appendChild(fulcrum); svg.appendChild(tFulcrum);
  svg.appendChild(sdBracket); svg.appendChild(meanTag); svg.appendChild(sdTag); svg.appendChild(skewTag);

  const fulcrumPos = animator.smooth(2.31, 90);
  let lastFrame = null;

  clDragOnSvg(svg, (e) => {
    if (!lastFrame) return;
    const st = ctx.getState();
    let masses = Array.isArray(st.data) && st.data.length ? st.data : MM_SEVERITY;
    // Clone before the first mutation so preset constants stay pristine;
    // applyPreset swaps in the shared array again, which drops the flag.
    if (!masses._owned) {
      masses = masses.map((m) => ({ ...m }));
      masses._owned = true;
      st.data = masses;
    }
    const { sx, sy } = lastFrame;
    const pt = clSvgPoint(svg, e);
    let best = 0, bd = Infinity;
    masses.forEach((m, i) => {
      const dx = Math.abs(sx(m.x) - pt.x);
      if (dx < bd) { bd = dx; best = i; }
    });
    masses[best].p = Math.max(0, Math.min(0.6, sy.invert(pt.y)));
    animator.invalidate();
  });

  return {
    update(st, d) {
      const masses = Array.isArray(st.data) && st.data.length ? st.data : MM_SEVERITY;
      const a = st.values.a, b = st.values.b;
      const w = wrap.clientWidth || 640, h = wrap.clientHeight || 300;
      svg.setAttribute('width', w); svg.setAttribute('height', h);
      const frame = { left: 44, top: 16, right: w - 16, bottom: h - 40 };

      const transformed = a !== 1 || b !== 0;
      let xLo = 0, xHi = 10, pMax = 0.3;
      for (const m of masses) {
        pMax = Math.max(pMax, m.p * 1.2);
        if (transformed) {
          xLo = Math.min(xLo, a * m.x + b);
          xHi = Math.max(xHi, a * m.x + b);
        }
      }
      const sx = clScale(xLo - 0.6, xHi + 0.6, frame.left, frame.right);
      const sy = clScale(0, pMax, frame.bottom, frame.top);
      lastFrame = { sx, sy, frame };
      axes.update(sx, sy, frame);

      const bw = Math.min(22, Math.max(6, (sx(1) - sx(0)) * 0.55));
      bars.set(masses.map((m) => ({
        x: sx(m.x) - bw / 2, y: sy(m.p), w: bw, h: Math.max(0, frame.bottom - sy(m.p)),
      })), 'var(--px-accent)');

      gTrans.style.display = transformed ? '' : 'none';
      if (transformed) {
        const need = masses.length * 2;
        while (gTrans.children.length < need) {
          gTrans.appendChild(svgEl('line', { stroke: 'var(--cl-ink-1)', 'stroke-width': 1.5, opacity: 0.8 }));
          gTrans.appendChild(svgEl('circle', { r: 3, fill: 'var(--cl-ink-1)', opacity: 0.85 }, 'cl-dot'));
        }
        while (gTrans.children.length > need) gTrans.lastChild.remove();
        masses.forEach((m, i) => {
          const tx = sx(a * m.x + b), ty = sy(m.p);
          const line = gTrans.children[i * 2], dot = gTrans.children[i * 2 + 1];
          const on = m.p > 0.0005 ? '' : 'none';
          line.style.display = on; dot.style.display = on;
          line.setAttribute('x1', tx); line.setAttribute('x2', tx);
          line.setAttribute('y1', frame.bottom); line.setAttribute('y2', ty);
          dot.setAttribute('cx', tx); dot.setAttribute('cy', ty);
        });
      }

      const beamY = frame.bottom + 8;
      beam.setAttribute('x1', frame.left); beam.setAttribute('x2', frame.right);
      beam.setAttribute('y1', beamY); beam.setAttribute('y2', beamY);

      if (st.fresh) fulcrumPos.snap(d.mean); else fulcrumPos.target = d.mean;
      const fx = sx(fulcrumPos.current);
      fulcrum.setAttribute('d', `M${fx},${beamY + 2} L${fx - 7},${beamY + 14} L${fx + 7},${beamY + 14} Z`);
      meanTag.setAttribute('x', fx); meanTag.setAttribute('y', beamY + 26);
      meanTag.textContent = 'E[X] = ' + clFmt(d.mean, 'num2');

      if (transformed && Number.isFinite(d.tMean)) {
        tFulcrum.style.display = '';
        const tx = sx(d.tMean);
        tFulcrum.setAttribute('d', `M${tx},${beamY + 2} L${tx - 6},${beamY + 12} L${tx + 6},${beamY + 12} Z`);
      } else {
        tFulcrum.style.display = 'none';
      }

      const bx1 = sx(d.mean - d.sd), bx2 = sx(d.mean + d.sd);
      const by = frame.top + 14;
      sdBracket.setAttribute('d', `M${bx1},${by - 4} L${bx1},${by + 4} M${bx1},${by} L${bx2},${by} M${bx2},${by - 4} L${bx2},${by + 4}`);
      sdTag.setAttribute('x', (bx1 + bx2) / 2); sdTag.setAttribute('y', by - 8);
      sdTag.textContent = 'σ = ' + clFmt(d.sd, 'num2');

      skewTag.setAttribute('x', frame.left + 4); skewTag.setAttribute('y', frame.top + 12);
      skewTag.textContent = 'Skew γ₁ = ' + clFmt(d.skew, 'num2') + (d.skew > 0.05 ? ' (leans right)' : d.skew < -0.05 ? ' (leans left)' : ' (balanced)');

      gGhosts.innerHTML = '';
      for (const g of st.ghosts) {
        if (!g.masses) continue;
        for (const m of g.masses) {
          if (m.p <= 0.0005) continue;
          const line = svgEl('line', {}, 'cl-ghost-curve');
          line.setAttribute('x1', sx(m.x)); line.setAttribute('x2', sx(m.x));
          line.setAttribute('y1', frame.bottom); line.setAttribute('y2', sy(m.p));
          gGhosts.appendChild(line);
        }
      }
    },
    snapshot(st) {
      const masses = Array.isArray(st.data) && st.data.length ? st.data : MM_SEVERITY;
      return { label: st.presetId || 'pin', masses: masses.map((m) => ({ ...m })) };
    },
  };
}

// --- Distribution Anatomy: density and CDF, one read -----------------------

function buildAnatomyScenes(stageRow, ctx) {
  const { linkRoot, animator } = ctx;
  const s1 = buildScene(stageRow, 'The Density: Where Probability Is Dense', [
    { label: 'Density', color: 'var(--px-accent)', link: 'pdf' },
    { label: 'Area = q', color: 'var(--px-accent)', link: 'q' },
    { label: 'Median', color: 'var(--cl-ink-1)', dashed: true, link: 'median' },
    { label: 'Mean', color: 'var(--cl-ink-4)', dashed: true, link: 'skew' },
  ], linkRoot);
  const s2 = buildScene(stageRow, 'The CDF: How Much Lies Below', [
    { label: 'F(x)', color: 'var(--px-accent)', link: 'cdf' },
    { label: 'The Read', color: 'var(--cl-ink-5)', link: 'q' },
  ], linkRoot);

  const axes1 = createAxes(s1.svg, { xFmt: (v) => clFmt(v, 'num'), yTicks: 0, yFmt: () => '' });
  const axes2 = createAxes(s2.svg, { xFmt: (v) => clFmt(v, 'num'), yFmt: (v) => Math.round(v * 100) + '%', yTicks: 4 });

  const gGhosts = svgEl('g'); s1.svg.appendChild(gGhosts);
  // The buckets under the curve: heights in density scale so the staircase
  // visibly melts INTO the pdf as the bin count climbs.
  const buckets = makeBarPool(s1.svg, 'cl-bar');
  buckets.g.dataset.clLink = 'bars';
  const areaPath = svgEl('path', { fill: 'var(--px-accent)' }, 'cl-band');
  areaPath.dataset.clLink = 'q';
  const pdfPath = svgEl('path', { stroke: 'var(--px-accent)' }, 'cl-curve');
  pdfPath.dataset.clLink = 'pdf';
  const medianLine = svgEl('line', { stroke: 'var(--cl-ink-1)' }, 'cl-curve cl-ref');
  medianLine.dataset.clLink = 'median';
  const meanLine = svgEl('line', { stroke: 'var(--cl-ink-4)' }, 'cl-curve cl-ref');
  meanLine.dataset.clLink = 'skew';
  const xqLine1 = svgEl('line', {}, 'cl-marker-line');
  xqLine1.dataset.clLink = 'xq';
  const xqDot1 = svgEl('circle', { r: 4.5, fill: 'var(--px-accent)', stroke: 'var(--px-bg)', 'stroke-width': 1.5 }, 'cl-dot');
  xqDot1.dataset.clLink = 'xq';
  const xqTag1 = svgEl('text', { 'text-anchor': 'middle' }, 'cl-svg-value');
  s1.svg.appendChild(areaPath); s1.svg.appendChild(pdfPath);
  s1.svg.appendChild(medianLine); s1.svg.appendChild(meanLine);
  s1.svg.appendChild(xqLine1); s1.svg.appendChild(xqDot1); s1.svg.appendChild(xqTag1);

  const cdfPath = svgEl('path', { stroke: 'var(--px-accent)' }, 'cl-curve');
  cdfPath.dataset.clLink = 'cdf';
  const readPath = svgEl('path', { stroke: 'var(--cl-ink-5)', 'stroke-width': 1.75 }, 'cl-curve');
  readPath.dataset.clLink = 'q';
  const qDot = svgEl('circle', { r: 4.5, fill: 'var(--cl-ink-5)', stroke: 'var(--px-bg)', 'stroke-width': 1.5 }, 'cl-dot');
  qDot.dataset.clLink = 'q';
  const qTag = svgEl('text', { 'text-anchor': 'start', fill: 'var(--cl-ink-5)' }, 'cl-svg-value');
  const xqTag2 = svgEl('text', { 'text-anchor': 'middle' }, 'cl-svg-tag');
  s2.svg.appendChild(cdfPath); s2.svg.appendChild(readPath);
  s2.svg.appendChild(qDot); s2.svg.appendChild(qTag); s2.svg.appendChild(xqTag2);

  const domX = animator.smooth(30, 110);
  let lastD = null;

  const dragToQ = (svgNode, getScale) => {
    clDragOnSvg(svgNode, (e) => {
      const sc = getScale();
      if (!sc || !lastD) return;
      const x = sc.invert(clSvgPoint(svgNode, e).x);
      const q = clLognCdf(Math.max(1e-6, x), lastD.mu, lastD.sigma);
      ctx.setParam('q', Math.max(0.01, Math.min(0.99, Math.round(q * 100) / 100)));
    });
  };
  let sx1Ref = null, sx2Ref = null;
  dragToQ(s1.svg, () => sx1Ref);
  dragToQ(s2.svg, () => sx2Ref);

  return {
    update(st, d) {
      lastD = d;
      const xEnd = clLognInv(0.995, d.mu, d.sigma);
      if (st.fresh) domX.snap(xEnd); else domX.target = xEnd;
      const xMax = domX.current;

      // ── Density panel ──
      const w1 = s1.wrap.clientWidth || 420, h1 = s1.wrap.clientHeight || 280;
      s1.svg.setAttribute('width', w1); s1.svg.setAttribute('height', h1);
      const f1 = { left: 40, top: 16, right: w1 - 14, bottom: h1 - 26 };
      const sx1 = clScale(0, xMax, f1.left, f1.right);
      sx1Ref = sx1;
      const N = 160;
      let pdfMax = 0;
      const pdfPts = [];
      for (let i = 0; i <= N; i++) {
        const x = (i / N) * xMax;
        const y = clLognPdf(x, d.mu, d.sigma);
        pdfPts.push([x, y]);
        pdfMax = Math.max(pdfMax, y);
      }
      const sy1 = clScale(0, pdfMax * 1.12, f1.bottom, f1.top);
      axes1.update(sx1, sy1, f1);
      pdfPath.setAttribute('d', clPathFrom(pdfPts.map(([x, y]) => [sx1(x), sy1(y)])));

      const areaPts = pdfPts.filter(([x]) => x <= d.xq);
      if (areaPts.length) {
        let ap = 'M' + sx1(0).toFixed(1) + ',' + f1.bottom.toFixed(1);
        for (const [x, y] of areaPts) ap += 'L' + sx1(x).toFixed(1) + ',' + sy1(y).toFixed(1);
        ap += 'L' + sx1(Math.min(d.xq, xMax)).toFixed(1) + ',' + sy1(clLognPdf(Math.min(d.xq, xMax), d.mu, d.sigma)).toFixed(1);
        ap += 'L' + sx1(Math.min(d.xq, xMax)).toFixed(1) + ',' + f1.bottom.toFixed(1) + 'Z';
        areaPath.setAttribute('d', ap);
      } else {
        areaPath.setAttribute('d', '');
      }

      // Bucket mode: bars whose AREAS are bucket probabilities; the quantile
      // furniture stands down so the melting is the only thing on stage.
      const barsMode = st.mode === 'bars';
      const qFurniture = [areaPath, medianLine, meanLine, xqLine1, xqDot1, xqTag1];
      for (const el of qFurniture) el.style.display = barsMode ? 'none' : '';
      if (barsMode) {
        const k = Math.max(1, Math.round(st.values.bins || 16));
        const rects = [];
        for (let i = 0; i < k; i++) {
          const a = (i / k) * xMax, b = ((i + 1) / k) * xMax;
          const hDens = (clLognCdf(b, d.mu, d.sigma) - clLognCdf(a, d.mu, d.sigma)) / Math.max(1e-9, b - a);
          rects.push({
            x: sx1(a) + 0.5,
            y: sy1(hDens),
            w: Math.max(1, sx1(b) - sx1(a) - 1),
            h: Math.max(0, f1.bottom - sy1(hDens)),
          });
        }
        buckets.set(rects, 'var(--px-accent)');
        buckets.g.style.display = '';
      } else {
        buckets.g.style.display = 'none';
      }

      const putV = (line, x, yTop) => {
        const px = sx1(Math.min(x, xMax));
        line.setAttribute('x1', px); line.setAttribute('x2', px);
        line.setAttribute('y1', f1.bottom); line.setAttribute('y2', yTop);
        return px;
      };
      putV(medianLine, d.median, f1.top + 22);
      putV(meanLine, st.values.M, f1.top + 10);
      const qx1 = sx1(Math.min(d.xq, xMax));
      xqLine1.setAttribute('x1', qx1); xqLine1.setAttribute('x2', qx1);
      xqLine1.setAttribute('y1', f1.bottom); xqLine1.setAttribute('y2', f1.top + 30);
      xqDot1.setAttribute('cx', qx1);
      xqDot1.setAttribute('cy', sy1(clLognPdf(Math.min(d.xq, xMax), d.mu, d.sigma)));
      xqTag1.setAttribute('x', qx1); xqTag1.setAttribute('y', f1.top + 24);
      xqTag1.textContent = 'x_q = ' + clFmt(d.xq, 'num');

      gGhosts.innerHTML = '';
      for (const g of st.ghosts) {
        if (g.mu === undefined) continue;
        const pts = [];
        for (let i = 0; i <= N; i++) {
          const x = (i / N) * xMax;
          pts.push([sx1(x), sy1(clLognPdf(x, g.mu, g.sigma))]);
        }
        const gp = svgEl('path', {}, 'cl-ghost-curve');
        gp.setAttribute('d', clPathFrom(pts));
        gGhosts.appendChild(gp);
      }

      // ── CDF panel ──
      const w2 = s2.wrap.clientWidth || 420, h2 = s2.wrap.clientHeight || 280;
      s2.svg.setAttribute('width', w2); s2.svg.setAttribute('height', h2);
      const f2 = { left: 44, top: 16, right: w2 - 14, bottom: h2 - 26 };
      const sx2 = clScale(0, xMax, f2.left, f2.right);
      sx2Ref = sx2;
      const sy2 = clScale(0, 1.04, f2.bottom, f2.top);
      axes2.update(sx2, sy2, f2);
      const cdfPts = [];
      for (let i = 0; i <= N; i++) {
        const x = (i / N) * xMax;
        cdfPts.push([sx2(x), sy2(clLognCdf(x, d.mu, d.sigma))]);
      }
      cdfPath.setAttribute('d', clPathFrom(cdfPts));

      const qx2 = sx2(Math.min(d.xq, xMax));
      const qy2 = sy2(st.values.q);
      readPath.setAttribute('d', `M${qx2},${f2.bottom} L${qx2},${qy2} L${f2.left},${qy2}`);
      qDot.setAttribute('cx', qx2); qDot.setAttribute('cy', qy2);
      qTag.setAttribute('x', f2.left + 6); qTag.setAttribute('y', qy2 - 6);
      qTag.textContent = 'q = ' + clFmt(st.values.q, 'pct');
      xqTag2.setAttribute('x', qx2); xqTag2.setAttribute('y', f2.bottom + 24);
      xqTag2.textContent = clFmt(d.xq, 'num');
    },
    snapshot(st, d) {
      return { label: st.presetId || 'pin', mu: d.mu, sigma: d.sigma };
    },
  };
}

// --- Sums: severity panel + accumulating aggregate histogram ---------------

function buildSumsScenes(stageRow, ctx) {
  const { linkRoot, animator } = ctx;
  const s1 = buildScene(stageRow, 'One Claim: The Severity', [
    { label: 'Severity Density', color: 'var(--cl-ink-5)', link: 'sev' },
  ], linkRoot);
  const s2 = buildScene(stageRow, 'A Year Of Claims, Summed', [
    { label: 'Simulated Years', color: 'var(--px-accent)', link: 'agg' },
    { label: 'Normal With Same Mean, SD', color: 'var(--cl-ink-1)', dashed: true, link: 'tail' },
  ], linkRoot);

  const axes1 = createAxes(s1.svg, { xFmt: (v) => clFmt(v, 'num'), yTicks: 0, yFmt: () => '' });
  const axes2 = createAxes(s2.svg, { xFmt: (v) => clFmt(v, 'num'), yTicks: 0, yFmt: () => '' });
  const sevPath = svgEl('path', { stroke: 'var(--cl-ink-5)' }, 'cl-curve');
  sevPath.dataset.clLink = 'sev';
  s1.svg.appendChild(sevPath);
  const bars = makeBarPool(s2.svg, 'cl-bar');
  bars.g.dataset.clLink = 'agg';
  const normPath = svgEl('path', { stroke: 'var(--cl-ink-1)' }, 'cl-curve cl-ref');
  normPath.dataset.clLink = 'tail';
  const p95Line = svgEl('line', {}, 'cl-marker-line');
  p95Line.dataset.clLink = 'tail';
  const p95Tag = svgEl('text', { 'text-anchor': 'middle' }, 'cl-svg-tag');
  p95Tag.dataset.clLink = 'tail';
  const nTag = svgEl('text', { 'text-anchor': 'end' }, 'cl-svg-value');
  s2.svg.appendChild(normPath); s2.svg.appendChild(p95Line);
  s2.svg.appendChild(p95Tag); s2.svg.appendChild(nTag);

  const TARGET = 3000;
  let draws = [];
  let rng = clMulberry32(12);
  let sev = null;
  let simKey = '';

  function publish() {
    const st = ctx.getState();
    const d = st.values;
    const m = clCompoundMoments(d.lam, SUMS_SEV_MEAN, d.cv);
    const q = m.mean + 1.6449 * m.sd;
    const exceed = draws.length ? draws.filter((x) => x > q).length / draws.length : NaN;
    st.sceneStats = { simYears: draws.length, tailExceed: exceed };
  }
  function reset() {
    const v = ctx.getState().values;
    draws = [];
    rng = clMulberry32(12);
    sev = clMatchLognormal(SUMS_SEV_MEAN, SUMS_SEV_MEAN * v.cv);
    simKey = v.lam + '|' + v.cv;
    publish();
    animator.loop('sums', runChunk);
  }
  function runChunk() {
    const v = ctx.getState().values;
    if (draws.length >= TARGET) { animator.stopLoop('sums'); return; }
    const batch = Math.min(40, TARGET - draws.length);
    for (let i = 0; i < batch; i++) {
      const count = clRandPoisson(v.lam, rng);
      let s = 0;
      for (let c = 0; c < count; c++) s += Math.exp(sev.mu + sev.sigma * clRandNormal(rng));
      draws.push(s);
    }
    publish();
  }
  reset();

  return {
    update(st, d) {
      const v = st.values;
      if (v.lam + '|' + v.cv !== simKey) reset();

      // ── Severity panel ──
      const w1 = s1.wrap.clientWidth || 420, h1 = s1.wrap.clientHeight || 280;
      s1.svg.setAttribute('width', w1); s1.svg.setAttribute('height', h1);
      const f1 = { left: 36, top: 16, right: w1 - 14, bottom: h1 - 26 };
      const sevSigma = sev ? sev.sigma : 0.5;
      const sevMu = sev ? sev.mu : Math.log(10);
      const xEnd1 = Math.exp(sevMu + 2.8 * sevSigma);
      const sx1 = clScale(0, xEnd1, f1.left, f1.right);
      const N = 120;
      let pMax = 0;
      const pts1 = [];
      for (let i = 0; i <= N; i++) {
        const x = (i / N) * xEnd1;
        const y = clLognPdf(x, sevMu, sevSigma);
        pts1.push([x, y]);
        pMax = Math.max(pMax, y);
      }
      const sy1 = clScale(0, pMax * 1.12, f1.bottom, f1.top);
      axes1.update(sx1, sy1, f1);
      sevPath.setAttribute('d', clPathFrom(pts1.map(([x, y]) => [sx1(x), sy1(y)])));

      // ── Aggregate panel ──
      const w2 = s2.wrap.clientWidth || 420, h2 = s2.wrap.clientHeight || 280;
      s2.svg.setAttribute('width', w2); s2.svg.setAttribute('height', h2);
      const f2 = { left: 36, top: 16, right: w2 - 14, bottom: h2 - 26 };
      const xEnd2 = Math.max(d.aggMean + 4 * d.aggSd, d.normP95 * 1.15, 1);
      const sx2 = clScale(0, xEnd2, f2.left, f2.right);

      const BINS = 44;
      const binW = xEnd2 / BINS;
      const counts = new Array(BINS).fill(0);
      for (const x of draws) {
        const b = Math.min(BINS - 1, Math.floor(x / binW));
        counts[b]++;
      }
      const total = Math.max(1, draws.length);
      let hMax = 0.001;
      for (const c of counts) hMax = Math.max(hMax, c / total);
      // Normal overlay in the same per-bin units so shapes are comparable.
      const overlay = [];
      let oMax = 0;
      for (let i = 0; i <= N; i++) {
        const x = (i / N) * xEnd2;
        const y = clNormPdf(x, d.aggMean, d.aggSd) * binW;
        overlay.push([x, y]);
        oMax = Math.max(oMax, y);
      }
      const sy2 = clScale(0, Math.max(hMax, oMax) * 1.15, f2.bottom, f2.top);
      axes2.update(sx2, sy2, f2);
      const bw2 = Math.max(2, (f2.right - f2.left) / BINS - 1.5);
      bars.set(counts.map((c, i) => ({
        x: sx2(i * binW) + 0.75, y: sy2(c / total), w: bw2, h: Math.max(0, f2.bottom - sy2(c / total)),
      })), 'var(--px-accent)');
      normPath.setAttribute('d', clPathFrom(overlay.map(([x, y]) => [sx2(x), sy2(y)])));

      const qx = sx2(Math.min(d.normP95, xEnd2));
      p95Line.setAttribute('x1', qx); p95Line.setAttribute('x2', qx);
      p95Line.setAttribute('y1', f2.bottom); p95Line.setAttribute('y2', f2.top + 18);
      p95Tag.setAttribute('x', qx); p95Tag.setAttribute('y', f2.top + 12);
      p95Tag.textContent = 'Normal 95th';
      nTag.setAttribute('x', f2.right - 4); nTag.setAttribute('y', f2.top + 12);
      nTag.textContent = draws.length.toLocaleString('en-US') + ' years';
    },
    snapshot(st) {
      return { label: st.presetId || 'pin', years: draws.length };
    },
  };
}

// --- Conditional expectation: the cloud, the slice, the violin -------------

function buildCondExpScenes(stageRow, ctx) {
  const { linkRoot, animator } = ctx;
  const { wrap, svg } = buildScene(stageRow, 'Reported x  vs  Ultimate y', [
    { label: 'Best-Guess Line E[Y|X]', color: 'var(--px-accent)', link: 'line' },
    { label: 'The Slice At x', color: 'var(--cl-ink-5)', link: 'slice' },
    { label: 'What Remains', color: 'var(--cl-ink-5)', link: 'band' },
    { label: 'μ_Y (Ignore The Report)', color: 'var(--cl-ink-4)', dashed: true, link: 'flat' },
  ], linkRoot);
  const axes = createAxes(svg, { xFmt: (v) => clFmt(v, 'num'), yFmt: (v) => clFmt(v, 'num') });

  const gGhosts = svgEl('g'); svg.appendChild(gGhosts);
  const gDots = svgEl('g'); svg.appendChild(gDots);
  const violin = svgEl('path', { fill: 'var(--cl-ink-5)' }, 'cl-band');
  violin.dataset.clLink = 'band';
  const flatLine = svgEl('line', { stroke: 'var(--cl-ink-4)' }, 'cl-curve cl-ref');
  flatLine.dataset.clLink = 'flat';
  const regLine = svgEl('path', { stroke: 'var(--px-accent)' }, 'cl-curve');
  regLine.dataset.clLink = 'line';
  const sliceLine = svgEl('line', {}, 'cl-marker-line');
  sliceLine.dataset.clLink = 'slice';
  const guessDot = svgEl('circle', { r: 5, fill: 'var(--px-accent)', stroke: 'var(--px-bg)', 'stroke-width': 1.5 }, 'cl-dot');
  guessDot.dataset.clLink = 'slice';
  const guessTag = svgEl('text', { 'text-anchor': 'start' }, 'cl-svg-value');
  svg.appendChild(violin); svg.appendChild(flatLine); svg.appendChild(regLine);
  svg.appendChild(sliceLine); svg.appendChild(guessDot); svg.appendChild(guessTag);

  // One fixed set of standard-normal pairs: dragging ρ MORPHS the same
  // years instead of teleporting to a fresh cloud.
  const baseZ = [];
  {
    const rng = clMulberry32(9);
    for (let i = 0; i < 240; i++) baseZ.push([clRandNormal(rng), clRandNormal(rng)]);
  }
  for (let i = 0; i < baseZ.length; i++) {
    gDots.appendChild(svgEl('circle', { r: 2.5, fill: 'var(--px-text-secondary)', opacity: 0.55 }, 'cl-dot'));
  }

  let lastFrame = null;
  clDragOnSvg(svg, (e) => {
    if (!lastFrame) return;
    const st = ctx.getState();
    const r = st.ranges.x;
    const v = Math.max(r.min, Math.min(r.max, lastFrame.sx.invert(clSvgPoint(svg, e).x)));
    ctx.setParam('x', v);
  });

  return {
    update(st, d) {
      const w = wrap.clientWidth || 640, h = wrap.clientHeight || 300;
      svg.setAttribute('width', w); svg.setAttribute('height', h);
      const frame = { left: 44, top: 14, right: w - 16, bottom: h - 26 };
      const rho = st.values.rho, x = st.values.x;
      const sx = clScale(CE_PAR.muX - 3.2 * CE_PAR.sdX, CE_PAR.muX + 3.2 * CE_PAR.sdX, frame.left, frame.right);
      const sy = clScale(CE_PAR.muY - 3.6 * CE_PAR.sdY, CE_PAR.muY + 3.6 * CE_PAR.sdY, frame.bottom, frame.top);
      lastFrame = { sx, sy, frame };
      axes.update(sx, sy, frame);

      const c = Math.sqrt(Math.max(0, 1 - rho * rho));
      for (let i = 0; i < baseZ.length; i++) {
        const [z1, z2] = baseZ[i];
        const dot = gDots.children[i];
        dot.setAttribute('cx', sx(CE_PAR.muX + CE_PAR.sdX * z1));
        dot.setAttribute('cy', sy(CE_PAR.muY + CE_PAR.sdY * (rho * z1 + c * z2)));
      }

      const xLo = CE_PAR.muX - 3.2 * CE_PAR.sdX, xHi = CE_PAR.muX + 3.2 * CE_PAR.sdX;
      const line = (xx) => CE_PAR.muY + d.slope * (xx - CE_PAR.muX);
      regLine.setAttribute('d', clPathFrom([[sx(xLo), sy(line(xLo))], [sx(xHi), sy(line(xHi))]]));
      flatLine.setAttribute('x1', sx(xLo)); flatLine.setAttribute('x2', sx(xHi));
      flatLine.setAttribute('y1', sy(CE_PAR.muY)); flatLine.setAttribute('y2', sy(CE_PAR.muY));

      // The violin: the conditional density of Y at the slice, drawn sideways.
      const px = sx(x);
      if (d.condSd > 0.01) {
        const scale = (sx(1) - sx(0)) * 1.1; // px per unit density, tuned to read
        const pts = [];
        for (let i = 0; i <= 60; i++) {
          const y = d.condMean - 3.2 * d.condSd + (i / 60) * 6.4 * d.condSd;
          const dens = clNormPdf(y, d.condMean, d.condSd);
          pts.push([px + dens * scale * CE_PAR.sdY, sy(y)]);
        }
        let path = 'M' + px.toFixed(1) + ',' + sy(d.condMean - 3.2 * d.condSd).toFixed(1);
        for (const [xx, yy] of pts) path += 'L' + xx.toFixed(1) + ',' + yy.toFixed(1);
        path += 'L' + px.toFixed(1) + ',' + sy(d.condMean + 3.2 * d.condSd).toFixed(1) + 'Z';
        violin.setAttribute('d', path);
        violin.style.display = '';
      } else {
        violin.style.display = 'none';
      }

      sliceLine.setAttribute('x1', px); sliceLine.setAttribute('x2', px);
      sliceLine.setAttribute('y1', frame.bottom); sliceLine.setAttribute('y2', frame.top);
      guessDot.setAttribute('cx', px); guessDot.setAttribute('cy', sy(d.condMean));
      const left = px > (frame.left + frame.right) * 0.62;
      guessTag.setAttribute('text-anchor', left ? 'end' : 'start');
      guessTag.setAttribute('x', px + (left ? -9 : 9));
      guessTag.setAttribute('y', sy(d.condMean) - 9);
      guessTag.textContent = 'E[Y|x] = ' + clFmt(d.condMean, 'num');

      gGhosts.innerHTML = '';
      for (const g of st.ghosts) {
        if (g.slope === undefined) continue;
        const gl = (xx) => CE_PAR.muY + g.slope * (xx - CE_PAR.muX);
        const gp = svgEl('path', {}, 'cl-ghost-curve');
        gp.setAttribute('d', clPathFrom([[sx(xLo), sy(gl(xLo))], [sx(xHi), sy(gl(xHi))]]));
        gGhosts.appendChild(gp);
      }
    },
    snapshot(st, d) {
      return { label: 'ρ=' + clFmt(st.values.rho, 'num2'), slope: d.slope };
    },
  };
}

// --- Correlation: the morphing cloud and the total's spread ----------------

function buildCorrScenes(stageRow, ctx) {
  const { linkRoot } = ctx;
  const s1 = buildScene(stageRow, 'Years Of Two Lines', [
    { label: 'Line A vs Line B', color: 'var(--px-text-secondary)', link: 'cloud' },
  ], linkRoot);
  const s2 = buildScene(stageRow, 'What The Total Does', [
    { label: 'In Lockstep', color: 'var(--px-text-faint)', link: 'lockstep' },
    { label: 'If Independent', color: 'var(--cl-ink-1)', link: 'indep' },
    { label: 'Actual σ(A+B)', color: 'var(--px-accent)', link: 'sum' },
  ], linkRoot);

  const axes1 = createAxes(s1.svg, { xFmt: (v) => clFmt(v, 'num'), yFmt: (v) => clFmt(v, 'num') });
  const gDots = svgEl('g'); gDots.dataset.clLink = 'cloud'; s1.svg.appendChild(gDots);

  const baseZ = [];
  {
    const rng = clMulberry32(21);
    for (let i = 0; i < 220; i++) baseZ.push([clRandNormal(rng), clRandNormal(rng)]);
  }
  for (let i = 0; i < baseZ.length; i++) {
    gDots.appendChild(svgEl('circle', { r: 2.5, fill: 'var(--px-text-secondary)', opacity: 0.55 }, 'cl-dot'));
  }

  const rows = [
    { key: 'lockstep', fill: 'var(--px-text-faint)', label: 'In Lockstep (ρ = 1)', cls: 'cl-bar cl-bar--cmp' },
    { key: 'indep', fill: 'var(--cl-ink-1)', label: 'If Independent (ρ = 0)', cls: 'cl-bar' },
    { key: 'sum', fill: 'var(--px-accent)', label: 'Actual', cls: 'cl-bar' },
  ].map((r) => {
    const bar = svgEl('rect', { rx: 2, fill: r.fill }, r.cls);
    bar.dataset.clLink = r.key;
    const name = svgEl('text', { 'text-anchor': 'start' }, 'cl-svg-tag');
    const val = svgEl('text', { 'text-anchor': 'start' }, 'cl-svg-value');
    s2.svg.appendChild(bar); s2.svg.appendChild(name); s2.svg.appendChild(val);
    return { ...r, bar, name, val };
  });
  const benefitTag = svgEl('text', { 'text-anchor': 'middle', fill: 'var(--px-accent)' }, 'cl-svg-value');
  benefitTag.dataset.clLink = 'sum';
  const benefitSub = svgEl('text', { 'text-anchor': 'middle' }, 'cl-svg-tag');
  s2.svg.appendChild(benefitTag); s2.svg.appendChild(benefitSub);

  return {
    update(st, d) {
      const v = st.values;

      // ── Cloud ──
      const w1 = s1.wrap.clientWidth || 420, h1 = s1.wrap.clientHeight || 280;
      s1.svg.setAttribute('width', w1); s1.svg.setAttribute('height', h1);
      const f1 = { left: 40, top: 14, right: w1 - 14, bottom: h1 - 26 };
      const span = Math.max(v.s1, v.s2) * 3.2;
      const sx1 = clScale(-span, span, f1.left, f1.right);
      const sy1 = clScale(-span, span, f1.bottom, f1.top);
      axes1.update(sx1, sy1, f1);
      const c = Math.sqrt(Math.max(0, 1 - v.rho * v.rho));
      for (let i = 0; i < baseZ.length; i++) {
        const [z1, z2] = baseZ[i];
        const dot = gDots.children[i];
        dot.setAttribute('cx', sx1(v.s1 * z1));
        dot.setAttribute('cy', sy1(v.s2 * (v.rho * z1 + c * z2)));
      }

      // ── Spread ladder ──
      const w2 = s2.wrap.clientWidth || 420, h2 = s2.wrap.clientHeight || 280;
      s2.svg.setAttribute('width', w2); s2.svg.setAttribute('height', h2);
      const left = 20, right = w2 - 24;
      const sw = clScale(0, Math.max(d.sdPerfect * 1.08, 1e-9), 0, right - left);
      const vals = { lockstep: d.sdPerfect, indep: d.sdIndep, sum: d.sdSum };
      rows.forEach((r, i) => {
        const y = 34 + i * 52;
        r.name.setAttribute('x', left); r.name.setAttribute('y', y - 6);
        r.name.textContent = r.label;
        r.bar.setAttribute('x', left); r.bar.setAttribute('y', y);
        r.bar.setAttribute('height', 16);
        r.bar.setAttribute('width', Math.max(1, sw(vals[r.key])));
        r.val.setAttribute('x', left + Math.max(1, sw(vals[r.key])) + 8);
        r.val.setAttribute('y', y + 12.5);
        r.val.textContent = clFmt(vals[r.key], 'num2');
      });
      benefitTag.setAttribute('x', w2 / 2); benefitTag.setAttribute('y', 34 + 3 * 52 + 6);
      benefitTag.textContent = 'Diversification Benefit ' + clFmt(d.benefit, 'pct');
      benefitSub.setAttribute('x', w2 / 2); benefitSub.setAttribute('y', 34 + 3 * 52 + 22);
      benefitSub.textContent = 'The share of lockstep risk that aggregation forgives';
    },
    snapshot(st, d) {
      return { label: 'ρ=' + clFmt(st.values.rho, 'num2'), sdSum: d.sdSum };
    },
  };
}

// --- Process fan: paths, the collapse at today, and the endpoint fan -------

function buildProcessFanScenes(stageRow, ctx) {
  const { linkRoot, animator } = ctx;
  const { wrap, svg } = buildScene(stageRow, 'One Accident Year, Growing Toward Its Ultimate', [
    { label: 'Possible Lives', color: 'var(--px-text-faint)', link: 'lives' },
    { label: 'Consistent With Today', color: 'var(--px-accent)', link: 'fan' },
    { label: 'Observed', color: 'var(--px-accent)', link: 'today' },
    { label: 'Expected Pattern', color: 'var(--cl-ink-1)', dashed: true, link: 'spine' },
  ], linkRoot);
  const axes = createAxes(svg, {
    xFmt: (v) => (Number.isInteger(v) && v >= 0 && v <= 10 ? 'age ' + v : ''),
    yFmt: (v) => clFmt(v, 'num'),
    xTicks: 10,
  });

  const gUncond = svgEl('g'); gUncond.dataset.clLink = 'lives'; svg.appendChild(gUncond);
  const gCond = svgEl('g'); gCond.dataset.clLink = 'fan'; svg.appendChild(gCond);
  const gGhosts = svgEl('g'); svg.appendChild(gGhosts);
  const spinePath = svgEl('path', { stroke: 'var(--cl-ink-1)' }, 'cl-curve cl-ref');
  spinePath.dataset.clLink = 'spine';
  const gHist = svgEl('g'); gHist.dataset.clLink = 'fan'; svg.appendChild(gHist);
  const obsPath = svgEl('path', { stroke: 'var(--px-accent)', 'stroke-width': 2.5 }, 'cl-curve');
  obsPath.dataset.clLink = 'today';
  const todayLine = svgEl('line', {}, 'cl-marker-line');
  todayLine.dataset.clLink = 'today';
  const obsDot = svgEl('circle', { r: 5.5, fill: 'var(--px-accent)', stroke: 'var(--px-bg)', 'stroke-width': 1.5 }, 'cl-dot');
  obsDot.dataset.clLink = 'today';
  const clMark = svgEl('line', { stroke: 'var(--px-accent)', 'stroke-width': 2 });
  clMark.dataset.clLink = 'ult';
  const clTag = svgEl('text', { 'text-anchor': 'end', fill: 'var(--px-accent)' }, 'cl-svg-value');
  clTag.dataset.clLink = 'ult';
  const todayTag = svgEl('text', { 'text-anchor': 'middle' }, 'cl-svg-tag');
  svg.appendChild(spinePath); svg.appendChild(obsPath); svg.appendChild(todayLine);
  svg.appendChild(obsDot); svg.appendChild(clMark); svg.appendChild(clTag); svg.appendChild(todayTag);

  const makeFanPaths = (g, n, stroke, opacity, width) => {
    while (g.children.length < n) g.appendChild(svgEl('path', { stroke, opacity, 'stroke-width': width, fill: 'none', 'stroke-linecap': 'round' }));
    while (g.children.length > n) g.lastChild.remove();
  };

  let sim = null;
  let simKey = '';
  const domY = animator.smooth(160, 120);
  let lastFrame = null;
  let dragMode = null;

  clDragOnSvg(svg, (e) => {
    if (!lastFrame) return;
    const { sx, sy } = lastFrame;
    const pt = clSvgPoint(svg, e);
    const st = ctx.getState();
    if (e.type === 'pointerdown') {
      dragMode = Math.abs(pt.x - sx(st.values.k)) < 26 ? 'cObs' : 'k';
    }
    if (dragMode === 'cObs') {
      const Ek = clDevExpected(st.values.k);
      const r = st.ranges.cObs;
      ctx.setParam('cObs', Math.max(r.min, Math.min(r.max, sy.invert(pt.y) / Ek)));
    } else {
      const r = st.ranges.k;
      const v = Math.max(r.min, Math.min(r.max, Math.round(sx.invert(pt.x))));
      if (v !== st.values.k) ctx.setParam('k', v);
    }
  });

  return {
    update(st, d) {
      const v = st.values;
      const key = v.sigma + '|' + v.k;
      if (key !== simKey) {
        simKey = key;
        sim = clDevPaths({ sigma: v.sigma, kObs: v.k, nVis: 34, nSim: 700, seed: 33 });
      }

      const w = wrap.clientWidth || 640, h = wrap.clientHeight || 300;
      svg.setAttribute('width', w); svg.setAttribute('height', h);
      const frame = { left: 48, top: 14, right: w - 16, bottom: h - 26 };

      let endMax = 0;
      for (const x of sim.endpoints) endMax = Math.max(endMax, x);
      const yTarget = Math.max(PF.ult * 1.25, endMax * v.cObs * 1.05, d.ultCl * 1.15);
      if (st.fresh) domY.snap(yTarget); else domY.target = yTarget;
      const histW = Math.min(70, (frame.right - frame.left) * 0.12);
      const sx = clScale(0, PF.ages, frame.left, frame.right - histW - 8);
      const sy = clScale(0, domY.current, frame.bottom, frame.top);
      lastFrame = { sx, sy, frame };
      axes.update(sx, sy, frame);

      spinePath.setAttribute('d', clPathFrom(sim.expected.map((e, a) => [sx(a), sy(e)])));

      makeFanPaths(gUncond, sim.visUncond.length, 'var(--px-text-faint)', 0.3, 1);
      sim.visUncond.forEach((path, i) => {
        gUncond.children[i].setAttribute('d', clPathFrom(path.map((val, a) => [sx(a), sy(Math.min(val, domY.current * 1.05))])));
      });

      makeFanPaths(gCond, sim.visCond.length, 'var(--px-accent)', 0.2, 1.2);
      sim.visCond.forEach((path, i) => {
        gCond.children[i].setAttribute('d', clPathFrom(path.map((val, a) => [sx(v.k + a), sy(Math.min(val * v.cObs, domY.current * 1.05))])));
      });

      const histPts = sim.hist.map((val, a) => [sx(a), sy(val * v.cObs)]);
      obsPath.setAttribute('d', clPathFrom(histPts));
      todayLine.setAttribute('x1', sx(v.k)); todayLine.setAttribute('x2', sx(v.k));
      todayLine.setAttribute('y1', frame.bottom); todayLine.setAttribute('y2', frame.top);
      obsDot.setAttribute('cx', sx(v.k)); obsDot.setAttribute('cy', sy(d.obsC));
      todayTag.setAttribute('x', sx(v.k)); todayTag.setAttribute('y', frame.top + 10);
      todayTag.textContent = 'today';

      // Endpoint histogram on the right margin: the reserve distribution.
      const bins = 26;
      const counts = new Array(bins).fill(0);
      const yMaxDom = domY.current;
      for (const x of sim.endpoints) {
        const val = x * v.cObs;
        if (val >= yMaxDom) continue;
        counts[Math.floor((val / yMaxDom) * bins)]++;
      }
      let cMax = 1;
      for (const c of counts) cMax = Math.max(cMax, c);
      const x0 = frame.right - histW;
      while (gHist.children.length < bins) gHist.appendChild(svgEl('rect', { rx: 1, fill: 'var(--px-accent)' }, 'cl-bar'));
      while (gHist.children.length > bins) gHist.lastChild.remove();
      const binH = (frame.bottom - frame.top) / bins;
      for (let b = 0; b < bins; b++) {
        const r = gHist.children[b];
        const bw = (counts[b] / cMax) * histW;
        r.setAttribute('x', x0);
        r.setAttribute('y', sy((b + 1) * (yMaxDom / bins)));
        r.setAttribute('width', Math.max(0, bw));
        r.setAttribute('height', Math.max(0.5, binH - 1));
      }
      clMark.setAttribute('x1', x0); clMark.setAttribute('x2', frame.right);
      clMark.setAttribute('y1', sy(d.ultCl)); clMark.setAttribute('y2', sy(d.ultCl));
      clTag.setAttribute('x', frame.right); clTag.setAttribute('y', sy(d.ultCl) - 6);
      clTag.textContent = 'Û = ' + clFmt(d.ultCl, 'num');

      gGhosts.innerHTML = '';
      for (const g of st.ghosts) {
        if (!g.meanPath) continue;
        const gp = svgEl('path', {}, 'cl-ghost-curve');
        gp.setAttribute('d', clPathFrom(g.meanPath.map(([a, val]) => [sx(a), sy(val)])));
        gGhosts.appendChild(gp);
      }
    },
    snapshot(st, d) {
      const v = st.values;
      const meanPath = [];
      for (let a = v.k; a <= PF.ages; a++) {
        meanPath.push([a, d.obsC * (clDevExpected(a) / clDevExpected(v.k))]);
      }
      return { label: 'k=' + v.k + ' σ=' + clFmt(v.sigma, 'num2'), meanPath };
    },
  };
}

// --- Likelihood: the votes and the surface ---------------------------------

function buildLikelihoodScenes(stageRow, ctx) {
  const { linkRoot, animator } = ctx;
  const s1 = buildScene(stageRow, 'The Votes: Density At Each Observed Loss', [
    { label: 'Candidate Density', color: 'var(--px-accent)', link: 'cand' },
    { label: 'Votes', color: 'var(--cl-ink-5)', link: 'votes' },
    { label: 'The MLE Density', color: 'var(--cl-ink-1)', dashed: true, link: 'mle' },
  ], linkRoot);
  const s2 = buildScene(stageRow, 'The Surface: ℓ Over Every Candidate', [
    { label: 'Higher ℓ', color: 'var(--px-accent)', link: 'cand' },
    { label: 'The Peak', color: 'var(--cl-ink-1)', link: 'mle' },
  ], linkRoot);

  const head2 = s2.scene.querySelector('.cl-scene-head');
  const btnMle = document.createElement('button');
  btnMle.className = 'cl-scene-btn';
  btnMle.innerHTML = clIcon('target', 12) + '<span>Find MLE</span>';
  head2.appendChild(btnMle);

  const axes1 = createAxes(s1.svg, { xFmt: (v) => clFmt(v, 'num'), yTicks: 0, yFmt: () => '' });
  const gGhosts = svgEl('g'); s1.svg.appendChild(gGhosts);
  const gVotes = svgEl('g'); gVotes.dataset.clLink = 'votes'; s1.svg.appendChild(gVotes);
  const mlePath = svgEl('path', { stroke: 'var(--cl-ink-1)' }, 'cl-curve cl-ref');
  mlePath.dataset.clLink = 'mle';
  const candPath = svgEl('path', { stroke: 'var(--px-accent)' }, 'cl-curve');
  candPath.dataset.clLink = 'cand';
  const gData = svgEl('g'); s1.svg.appendChild(mlePath); s1.svg.appendChild(candPath); s1.svg.appendChild(gData);
  for (const x of LS_DATA) {
    const dot = svgEl('circle', { r: 3, fill: 'var(--px-text-secondary)' }, 'cl-dot');
    gData.appendChild(dot);
  }
  for (let i = 0; i < LS_DATA.length; i++) {
    gVotes.appendChild(svgEl('line', { stroke: 'var(--cl-ink-5)', 'stroke-width': 2, opacity: 0.8 }));
  }

  // The surface is static (the data never changes) — paint the heatmap once.
  const GRID_W = 40, GRID_H = 30;
  const MU_LO = 1.5, MU_HI = 3, SG_LO = 0.2, SG_HI = 1.4;
  const llMax = clLognLoglik(LS_DATA, LS_MLE.mu, LS_MLE.sigma);
  const gHeat = svgEl('g'); s2.svg.appendChild(gHeat);
  const heatCells = [];
  for (let iy = 0; iy < GRID_H; iy++) {
    for (let ix = 0; ix < GRID_W; ix++) {
      const mu = MU_LO + ((ix + 0.5) / GRID_W) * (MU_HI - MU_LO);
      const sg = SG_LO + ((iy + 0.5) / GRID_H) * (SG_HI - SG_LO);
      const gap = llMax - clLognLoglik(LS_DATA, mu, sg);
      const cell = svgEl('rect', { fill: 'var(--px-accent)', opacity: (0.88 * Math.exp(-gap / 6)).toFixed(3) });
      gHeat.appendChild(cell);
      heatCells.push(cell);
    }
  }
  const mleStar = svgEl('circle', { r: 4, fill: 'var(--cl-ink-1)', stroke: 'var(--px-bg)', 'stroke-width': 1.5 }, 'cl-dot');
  mleStar.dataset.clLink = 'mle';
  const candDot = svgEl('circle', { r: 5.5, fill: 'var(--px-accent)', stroke: 'var(--px-bg)', 'stroke-width': 1.5 }, 'cl-dot');
  candDot.dataset.clLink = 'cand';
  const gGhostDots = svgEl('g'); s2.svg.appendChild(gGhostDots);
  const muTag = svgEl('text', { 'text-anchor': 'middle' }, 'cl-svg-tag');
  const sgTag = svgEl('text', { 'text-anchor': 'middle', transform: '' }, 'cl-svg-tag');
  s2.svg.appendChild(mleStar); s2.svg.appendChild(candDot);
  s2.svg.appendChild(muTag); s2.svg.appendChild(sgTag);

  let frame2 = null;
  clDragOnSvg(s2.svg, (e) => {
    if (!frame2) return;
    const pt = clSvgPoint(s2.svg, e);
    const st = ctx.getState();
    const mu = frame2.sMu.invert(pt.x);
    const sg = frame2.sSg.invert(pt.y);
    animator.cancel('mle-ride');
    ctx.setParam('mu', Math.max(MU_LO, Math.min(MU_HI, mu)));
    ctx.setParam('sigma', Math.max(SG_LO, Math.min(SG_HI, sg)));
  });
  btnMle.addEventListener('click', () => {
    const st = ctx.getState();
    const mu0 = st.values.mu, sg0 = st.values.sigma;
    animator.tween('mle-ride', 0, 1, clMotion().slow + 200, (t) => {
      ctx.setParam('mu', mu0 + (LS_MLE.mu - mu0) * t);
      ctx.setParam('sigma', sg0 + (LS_MLE.sigma - sg0) * t);
    });
  });

  return {
    update(st, d) {
      const v = st.values;

      // ── Votes panel ──
      const w1 = s1.wrap.clientWidth || 420, h1 = s1.wrap.clientHeight || 280;
      s1.svg.setAttribute('width', w1); s1.svg.setAttribute('height', h1);
      const f1 = { left: 34, top: 16, right: w1 - 14, bottom: h1 - 26 };
      const xEnd = 42;
      const sx1 = clScale(0, xEnd, f1.left, f1.right);
      const N = 150;
      let pMax = 0;
      const cand = [], mle = [];
      for (let i = 0; i <= N; i++) {
        const x = (i / N) * xEnd;
        const yc = clLognPdf(x, v.mu, v.sigma);
        const ym = clLognPdf(x, LS_MLE.mu, LS_MLE.sigma);
        cand.push([x, yc]); mle.push([x, ym]);
        pMax = Math.max(pMax, yc, ym);
      }
      const sy1 = clScale(0, pMax * 1.12, f1.bottom, f1.top);
      axes1.update(sx1, sy1, f1);
      candPath.setAttribute('d', clPathFrom(cand.map(([x, y]) => [sx1(x), sy1(y)])));
      mlePath.setAttribute('d', clPathFrom(mle.map(([x, y]) => [sx1(x), sy1(y)])));
      LS_DATA.forEach((x, i) => {
        gData.children[i].setAttribute('cx', sx1(x));
        gData.children[i].setAttribute('cy', f1.bottom);
        const vote = gVotes.children[i];
        vote.setAttribute('x1', sx1(x)); vote.setAttribute('x2', sx1(x));
        vote.setAttribute('y1', f1.bottom);
        vote.setAttribute('y2', sy1(clLognPdf(x, v.mu, v.sigma)));
      });
      gGhosts.innerHTML = '';
      for (const g of st.ghosts) {
        if (g.mu === undefined) continue;
        const pts = [];
        for (let i = 0; i <= N; i++) {
          const x = (i / N) * xEnd;
          pts.push([sx1(x), sy1(clLognPdf(x, g.mu, g.sigma))]);
        }
        const gp = svgEl('path', {}, 'cl-ghost-curve');
        gp.setAttribute('d', clPathFrom(pts));
        gGhosts.appendChild(gp);
      }

      // ── Surface panel ──
      const w2 = s2.wrap.clientWidth || 420, h2 = s2.wrap.clientHeight || 280;
      s2.svg.setAttribute('width', w2); s2.svg.setAttribute('height', h2);
      const f2 = { left: 34, top: 16, right: w2 - 14, bottom: h2 - 30 };
      const sMu = clScale(MU_LO, MU_HI, f2.left, f2.right);
      const sSg = clScale(SG_LO, SG_HI, f2.bottom, f2.top);
      frame2 = { sMu, sSg };
      const cw = (f2.right - f2.left) / GRID_W;
      const ch = (f2.bottom - f2.top) / GRID_H;
      for (let iy = 0; iy < GRID_H; iy++) {
        for (let ix = 0; ix < GRID_W; ix++) {
          const cell = heatCells[iy * GRID_W + ix];
          cell.setAttribute('x', f2.left + ix * cw);
          cell.setAttribute('y', f2.bottom - (iy + 1) * ch);
          cell.setAttribute('width', cw + 0.5);
          cell.setAttribute('height', ch + 0.5);
        }
      }
      mleStar.setAttribute('cx', sMu(LS_MLE.mu)); mleStar.setAttribute('cy', sSg(LS_MLE.sigma));
      candDot.setAttribute('cx', sMu(v.mu)); candDot.setAttribute('cy', sSg(v.sigma));
      muTag.setAttribute('x', (f2.left + f2.right) / 2); muTag.setAttribute('y', h2 - 8);
      muTag.textContent = 'μ →';
      sgTag.setAttribute('x', f2.left - 18); sgTag.setAttribute('y', (f2.top + f2.bottom) / 2);
      sgTag.setAttribute('transform', `rotate(-90 ${f2.left - 18} ${(f2.top + f2.bottom) / 2})`);
      sgTag.textContent = 'σ →';
      gGhostDots.innerHTML = '';
      for (const g of st.ghosts) {
        if (g.mu === undefined) continue;
        const dot = svgEl('circle', { r: 3, fill: 'none', stroke: 'var(--px-text-faint)', 'stroke-width': 1.5 });
        dot.setAttribute('cx', sMu(g.mu)); dot.setAttribute('cy', sSg(g.sigma));
        gGhostDots.appendChild(dot);
      }
    },
    snapshot(st) {
      return { label: 'μ=' + clFmt(st.values.mu, 'num2') + ' σ=' + clFmt(st.values.sigma, 'num2'), mu: st.values.mu, sigma: st.values.sigma };
    },
  };
}

// --- Sampling error: the estimator histogram and the two bands -------------

function buildSamplingScenes(stageRow, ctx) {
  const { linkRoot, animator } = ctx;
  const s1 = buildScene(stageRow, 'The Estimates Scatter', [
    { label: 'Estimates x̄', color: 'var(--px-accent)', link: 'param' },
    { label: 'Theory: Normal(μ, σ/√n)', color: 'var(--cl-ink-1)', dashed: true, link: 'param' },
    { label: 'The Truth', color: 'var(--cl-ink-4)', dashed: true, link: 'truth' },
  ], linkRoot);
  const s2 = buildScene(stageRow, 'Two Risks, Added In Quadrature', [
    { label: 'Process σ', color: 'var(--cl-ink-1)', link: 'process' },
    { label: 'Parameter σ/√n', color: 'var(--cl-ink-5)', link: 'param' },
    { label: 'Total', color: 'var(--px-accent)', link: 'total' },
  ], linkRoot);

  const TRUTH = 100;
  const axes1 = createAxes(s1.svg, { xFmt: (v) => clFmt(v, 'num'), yTicks: 0, yFmt: () => '' });
  const bars = makeBarPool(s1.svg, 'cl-bar');
  bars.g.dataset.clLink = 'param';
  const theoryPath = svgEl('path', { stroke: 'var(--cl-ink-1)' }, 'cl-curve cl-ref');
  theoryPath.dataset.clLink = 'param';
  const truthLine = svgEl('line', { stroke: 'var(--cl-ink-4)' }, 'cl-curve cl-ref');
  truthLine.dataset.clLink = 'truth';
  const nTag = svgEl('text', { 'text-anchor': 'end' }, 'cl-svg-value');
  const lastRow = svgEl('g');
  s1.svg.appendChild(theoryPath); s1.svg.appendChild(truthLine); s1.svg.appendChild(nTag); s1.svg.appendChild(lastRow);

  const rows = [
    { key: 'process', fill: 'var(--cl-ink-1)', label: 'Process σ (Irreducible)' },
    { key: 'param', fill: 'var(--cl-ink-5)', label: 'Parameter σ/√n (Estimation)' },
    { key: 'total', fill: 'var(--px-accent)', label: 'Total Prediction Risk' },
  ].map((r) => {
    const bar = svgEl('rect', { rx: 2, fill: r.fill }, 'cl-bar');
    bar.dataset.clLink = r.key;
    const name = svgEl('text', { 'text-anchor': 'start' }, 'cl-svg-tag');
    const val = svgEl('text', { 'text-anchor': 'start' }, 'cl-svg-value');
    s2.svg.appendChild(bar); s2.svg.appendChild(name); s2.svg.appendChild(val);
    return { ...r, bar, name, val };
  });
  const shareTag = svgEl('text', { 'text-anchor': 'middle', fill: 'var(--px-accent)' }, 'cl-svg-value');
  const shareSub = svgEl('text', { 'text-anchor': 'middle' }, 'cl-svg-tag');
  s2.svg.appendChild(shareTag); s2.svg.appendChild(shareSub);

  const TARGET = 2500;
  let estimates = [];
  let lastData = [];
  let rng = clMulberry32(17);
  let simKey = '';

  function reset() {
    const v = ctx.getState().values;
    estimates = [];
    lastData = [];
    rng = clMulberry32(17);
    simKey = v.n + '|' + v.sigma;
    animator.loop('samp', runChunk);
  }
  function runChunk() {
    const v = ctx.getState().values;
    if (estimates.length >= TARGET) { animator.stopLoop('samp'); return; }
    const batch = Math.min(30, TARGET - estimates.length);
    for (let b = 0; b < batch; b++) {
      let s = 0;
      const pts = [];
      for (let i = 0; i < v.n; i++) {
        const x = TRUTH + v.sigma * clRandNormal(rng);
        s += x;
        if (b === batch - 1) pts.push(x);
      }
      estimates.push(s / v.n);
      if (b === batch - 1) lastData = pts;
    }
  }
  reset();

  return {
    update(st, d) {
      const v = st.values;
      if (v.n + '|' + v.sigma !== simKey) reset();

      // ── Histogram of estimates ──
      const w1 = s1.wrap.clientWidth || 420, h1 = s1.wrap.clientHeight || 280;
      s1.svg.setAttribute('width', w1); s1.svg.setAttribute('height', h1);
      const f1 = { left: 34, top: 16, right: w1 - 14, bottom: h1 - 26 };
      const span = Math.max(3.8 * d.seParam, v.sigma * 1.1);
      const sx1 = clScale(TRUTH - span, TRUTH + span, f1.left, f1.right);
      const BINS = 40;
      const lo = TRUTH - span, binW = (2 * span) / BINS;
      const counts = new Array(BINS).fill(0);
      for (const e of estimates) {
        const b = Math.floor((e - lo) / binW);
        if (b >= 0 && b < BINS) counts[b]++;
      }
      const total = Math.max(1, estimates.length);
      let hMax = 0.001, oMax = 0;
      for (const c of counts) hMax = Math.max(hMax, c / total);
      const overlay = [];
      for (let i = 0; i <= 140; i++) {
        const x = lo + (i / 140) * 2 * span;
        const y = clNormPdf(x, TRUTH, d.seParam) * binW;
        overlay.push([x, y]);
        oMax = Math.max(oMax, y);
      }
      const sy1 = clScale(0, Math.max(hMax, oMax) * 1.15, f1.bottom, f1.top);
      axes1.update(sx1, sy1, f1);
      const bw1 = Math.max(2, (f1.right - f1.left) / BINS - 1.5);
      bars.set(counts.map((c, i) => ({
        x: sx1(lo + i * binW) + 0.75, y: sy1(c / total), w: bw1, h: Math.max(0, f1.bottom - sy1(c / total)),
      })), 'var(--px-accent)');
      theoryPath.setAttribute('d', clPathFrom(overlay.map(([x, y]) => [sx1(x), sy1(y)])));
      truthLine.setAttribute('x1', sx1(TRUTH)); truthLine.setAttribute('x2', sx1(TRUTH));
      truthLine.setAttribute('y1', f1.bottom); truthLine.setAttribute('y2', f1.top + 8);
      nTag.setAttribute('x', f1.right - 4); nTag.setAttribute('y', f1.top + 12);
      nTag.textContent = estimates.length.toLocaleString('en-US') + ' worlds';

      // The latest dataset, so "one world" stays concrete.
      const need = lastData.length;
      while (lastRow.children.length < need) lastRow.appendChild(svgEl('circle', { r: 2, fill: 'var(--px-text-muted)', opacity: 0.8 }, 'cl-dot'));
      while (lastRow.children.length > need) lastRow.lastChild.remove();
      lastData.forEach((x, i) => {
        const dot = lastRow.children[i];
        dot.setAttribute('cx', Math.max(f1.left, Math.min(f1.right, sx1(x))));
        dot.setAttribute('cy', f1.top + 6);
      });

      // ── Bands ──
      const w2 = s2.wrap.clientWidth || 420, h2 = s2.wrap.clientHeight || 280;
      s2.svg.setAttribute('width', w2); s2.svg.setAttribute('height', h2);
      const left = 20, right = w2 - 24;
      const sw = clScale(0, Math.max(d.sdTotal * 1.1, 1e-9), 0, right - left);
      const vals = { process: v.sigma, param: d.seParam, total: d.sdTotal };
      rows.forEach((r, i) => {
        const y = 34 + i * 52;
        r.name.setAttribute('x', left); r.name.setAttribute('y', y - 6);
        r.name.textContent = r.label;
        r.bar.setAttribute('x', left); r.bar.setAttribute('y', y);
        r.bar.setAttribute('height', 16);
        r.bar.setAttribute('width', Math.max(1, sw(vals[r.key])));
        r.val.setAttribute('x', left + Math.max(1, sw(vals[r.key])) + 8);
        r.val.setAttribute('y', y + 12.5);
        r.val.textContent = clFmt(vals[r.key], 'num2');
      });
      shareTag.setAttribute('x', w2 / 2); shareTag.setAttribute('y', 34 + 3 * 52 + 6);
      shareTag.textContent = 'Estimation Owns ' + clFmt(d.shareParam, 'pct') + ' Of Total Variance';
      shareSub.setAttribute('x', w2 / 2); shareSub.setAttribute('y', 34 + 3 * 52 + 22);
      shareSub.textContent = 'Mack calls these the process and estimation terms of the mse';
    },
    snapshot(st, d) {
      return { label: 'n=' + st.values.n, seParam: d.seParam };
    },
  };
}

// --- Shrinkage: the twelve classes and the error valley --------------------

function buildShrinkScenes(stageRow, ctx) {
  const { linkRoot, animator } = ctx;
  const s1 = buildScene(stageRow, 'Twelve Classes, Shrunk Toward The Crowd', [
    { label: 'True Class Mean', color: 'var(--cl-ink-1)', link: 'spread' },
    { label: 'Raw Estimate', color: 'var(--px-text-faint)', link: 'noise' },
    { label: 'Shrunk By Z', color: 'var(--px-accent)', link: 'z' },
  ], linkRoot);
  const s2 = buildScene(stageRow, 'The Error Valley', [
    { label: 'rmse(Z)', color: 'var(--px-accent)', link: 'z' },
    { label: 'Z*', color: 'var(--cl-ink-1)', dashed: true, link: 'zstar' },
  ], linkRoot);

  const M = 100;
  const pairs = clShrinkClasses(12, 29);
  const axes1 = createAxes(s1.svg, { xFmt: (v) => clFmt(v, 'num'), yTicks: 0, yFmt: () => '' });
  const grandLine = svgEl('line', { stroke: 'var(--px-text-muted)' }, 'cl-curve cl-ref');
  s1.svg.appendChild(grandLine);
  const rows = pairs.map(() => {
    const link = svgEl('line', { stroke: 'var(--px-text-faint)', 'stroke-width': 1, opacity: 0.7 });
    const truth = svgEl('circle', { r: 3, fill: 'var(--cl-ink-1)' }, 'cl-dot');
    truth.dataset.clLink = 'spread';
    const raw = svgEl('circle', { r: 3.5, fill: 'none', stroke: 'var(--px-text-faint)', 'stroke-width': 1.5 }, 'cl-dot');
    raw.dataset.clLink = 'noise';
    const shrunk = svgEl('circle', { r: 4, fill: 'var(--px-accent)' }, 'cl-dot');
    shrunk.dataset.clLink = 'z';
    s1.svg.appendChild(link); s1.svg.appendChild(truth); s1.svg.appendChild(raw); s1.svg.appendChild(shrunk);
    return { link, truth, raw, shrunk };
  });
  const grandTag = svgEl('text', { 'text-anchor': 'middle' }, 'cl-svg-tag');
  s1.svg.appendChild(grandTag);

  const axes2 = createAxes(s2.svg, { xFmt: (v) => clFmt(v, 'num2'), yFmt: (v) => clFmt(v, 'num') });
  const gGhosts = svgEl('g'); s2.svg.appendChild(gGhosts);
  const errPath = svgEl('path', { stroke: 'var(--px-accent)' }, 'cl-curve');
  errPath.dataset.clLink = 'z';
  const zStarLine = svgEl('line', { stroke: 'var(--cl-ink-1)' }, 'cl-curve cl-ref');
  zStarLine.dataset.clLink = 'zstar';
  const zDot = svgEl('circle', { r: 5.5, fill: 'var(--px-accent)', stroke: 'var(--px-bg)', 'stroke-width': 1.5 }, 'cl-dot');
  zDot.dataset.clLink = 'z';
  const zStarTag = svgEl('text', { 'text-anchor': 'middle', fill: 'var(--cl-ink-1)' }, 'cl-svg-tag');
  zStarTag.dataset.clLink = 'zstar';
  s2.svg.appendChild(errPath); s2.svg.appendChild(zStarLine); s2.svg.appendChild(zDot); s2.svg.appendChild(zStarTag);

  let frame2 = null;
  clDragOnSvg(s2.svg, (e) => {
    if (!frame2) return;
    const z = frame2.sx.invert(clSvgPoint(s2.svg, e).x);
    ctx.setParam('Z', Math.max(0, Math.min(1, z)));
  });

  return {
    update(st, d) {
      const v = st.values;

      // ── Classes panel ──
      const w1 = s1.wrap.clientWidth || 420, h1 = s1.wrap.clientHeight || 280;
      s1.svg.setAttribute('width', w1); s1.svg.setAttribute('height', h1);
      const f1 = { left: 30, top: 20, right: w1 - 14, bottom: h1 - 26 };
      const span = 3 * Math.sqrt(v.tau * v.tau + v.s * v.s);
      const sx1 = clScale(M - span, M + span, f1.left, f1.right);
      const sy1 = clScale(0, 1, f1.bottom, f1.top);
      axes1.update(sx1, sy1, f1);
      grandLine.setAttribute('x1', sx1(M)); grandLine.setAttribute('x2', sx1(M));
      grandLine.setAttribute('y1', f1.bottom); grandLine.setAttribute('y2', f1.top + 12);
      grandTag.setAttribute('x', sx1(M)); grandTag.setAttribute('y', f1.top + 8);
      grandTag.textContent = 'grand mean';
      const rowGap = (f1.bottom - f1.top - 16) / (pairs.length - 1);
      pairs.forEach(([z1, z2], i) => {
        const y = f1.top + 14 + i * rowGap;
        const truth = M + v.tau * z1;
        const raw = truth + v.s * z2;
        const shrunk = v.Z * raw + (1 - v.Z) * M;
        const r = rows[i];
        r.truth.setAttribute('cx', sx1(truth)); r.truth.setAttribute('cy', y);
        r.raw.setAttribute('cx', sx1(raw)); r.raw.setAttribute('cy', y);
        r.shrunk.setAttribute('cx', sx1(shrunk)); r.shrunk.setAttribute('cy', y);
        r.link.setAttribute('x1', sx1(raw)); r.link.setAttribute('y1', y);
        r.link.setAttribute('x2', sx1(shrunk)); r.link.setAttribute('y2', y);
      });

      // ── Valley panel ──
      const w2 = s2.wrap.clientWidth || 420, h2 = s2.wrap.clientHeight || 280;
      s2.svg.setAttribute('width', w2); s2.svg.setAttribute('height', h2);
      const f2 = { left: 40, top: 16, right: w2 - 14, bottom: h2 - 26 };
      const sx2 = clScale(0, 1, f2.left, f2.right);
      const yMax = Math.max(v.tau, v.s) * 1.12;
      const sy2 = clScale(0, yMax, f2.bottom, f2.top);
      frame2 = { sx: sx2 };
      axes2.update(sx2, sy2, f2);
      const pts = [];
      for (let i = 0; i <= 100; i++) {
        const z = i / 100;
        pts.push([sx2(z), sy2(clShrinkErr(z, v.tau, v.s))]);
      }
      errPath.setAttribute('d', clPathFrom(pts));
      zStarLine.setAttribute('x1', sx2(d.zStar)); zStarLine.setAttribute('x2', sx2(d.zStar));
      zStarLine.setAttribute('y1', f2.bottom); zStarLine.setAttribute('y2', sy2(d.errStar));
      zStarTag.setAttribute('x', sx2(d.zStar)); zStarTag.setAttribute('y', sy2(d.errStar) - 8);
      zStarTag.textContent = 'Z* = ' + clFmt(d.zStar, 'num2');
      zDot.setAttribute('cx', sx2(v.Z)); zDot.setAttribute('cy', sy2(d.errZ));

      gGhosts.innerHTML = '';
      for (const g of st.ghosts) {
        if (g.tau === undefined) continue;
        const gp = svgEl('path', {}, 'cl-ghost-curve');
        gp.setAttribute('d', clPathFrom(Array.from({ length: 101 }, (_, i) => {
          const z = i / 100;
          return [sx2(z), sy2(Math.min(yMax, clShrinkErr(z, g.tau, g.s)))];
        })));
        gGhosts.appendChild(gp);
      }
    },
    snapshot(st) {
      return { label: 'τ=' + st.values.tau + ' s=' + st.values.s, tau: st.values.tau, s: st.values.s };
    },
  };
}

// --- GLM anatomy: the bent mean, the straight eta, the error cloud ---------

function buildGlmScenes(stageRow, ctx) {
  const { linkRoot, animator } = ctx;
  const s1 = buildScene(stageRow, 'The Mean, Bent By The Link', [
    { label: 'μ(x)', color: 'var(--px-accent)', link: 'mean' },
    { label: 'η (Always Straight)', color: 'var(--cl-ink-1)', link: 'eta' },
    { label: 'Probe', color: 'var(--cl-ink-5)', link: 'probe' },
  ], linkRoot);
  const s2 = buildScene(stageRow, 'The Errors Around The Mean', [
    { label: 'Simulated Cells', color: 'var(--px-text-secondary)', link: 'cloud' },
    { label: 'μ ± 2√V(μ)', color: 'var(--px-accent)', link: 'var' },
  ], linkRoot);

  const axes1 = createAxes(s1.svg, { xFmt: (v) => clFmt(v, 'num'), yFmt: (v) => clFmt(v, 'num'), yTicks: 4 });
  const gGhosts = svgEl('g'); s1.svg.appendChild(gGhosts);
  const meanPath = svgEl('path', { stroke: 'var(--px-accent)' }, 'cl-curve');
  meanPath.dataset.clLink = 'mean';
  const probeLine1 = svgEl('line', {}, 'cl-marker-line');
  probeLine1.dataset.clLink = 'probe';
  const probeDot1 = svgEl('circle', { r: 5, fill: 'var(--px-accent)', stroke: 'var(--px-bg)', 'stroke-width': 1.5 }, 'cl-dot');
  probeDot1.dataset.clLink = 'probe';
  const insetSep = svgEl('line', { stroke: 'var(--px-text-faint)', 'stroke-width': 1, opacity: 0.5 });
  const etaPath = svgEl('path', { stroke: 'var(--cl-ink-1)' }, 'cl-curve');
  etaPath.dataset.clLink = 'eta';
  const etaDot = svgEl('circle', { r: 3.5, fill: 'var(--cl-ink-1)' }, 'cl-dot');
  etaDot.dataset.clLink = 'eta';
  const etaTag = svgEl('text', { 'text-anchor': 'start' }, 'cl-svg-tag');
  s1.svg.appendChild(meanPath); s1.svg.appendChild(probeLine1); s1.svg.appendChild(probeDot1);
  s1.svg.appendChild(insetSep); s1.svg.appendChild(etaPath); s1.svg.appendChild(etaDot); s1.svg.appendChild(etaTag);

  const axes2 = createAxes(s2.svg, { xFmt: (v) => clFmt(v, 'num'), yFmt: (v) => clFmt(v, 'num'), yTicks: 4 });
  const bandPath = svgEl('path', { fill: 'var(--px-accent)' }, 'cl-band');
  bandPath.dataset.clLink = 'var';
  const meanPath2 = svgEl('path', { stroke: 'var(--px-accent)' }, 'cl-curve cl-ref');
  meanPath2.dataset.clLink = 'var';
  const gCloud = svgEl('g'); gCloud.dataset.clLink = 'cloud';
  s2.svg.appendChild(bandPath); s2.svg.appendChild(meanPath2); s2.svg.appendChild(gCloud);
  const CLOUD_N = 64;
  for (let i = 0; i < CLOUD_N; i++) {
    gCloud.appendChild(svgEl('circle', { r: 2.5, fill: 'var(--px-text-secondary)', opacity: 0.6 }, 'cl-dot'));
  }
  const probeLine2 = svgEl('line', {}, 'cl-marker-line');
  probeLine2.dataset.clLink = 'probe';
  s2.svg.appendChild(probeLine2);

  // The cloud keeps its standardized residuals across β drags (smooth), and
  // re-rolls only when the error family itself changes.
  let cloudR = [];
  let cloudKey = '';
  function rollCloud(mode, phi, p, b0, b1) {
    const rng = clMulberry32(53);
    cloudR = [];
    const link = mode === 'normal' ? 'identity' : 'log';
    const power = mode === 'normal' ? 0 : p;
    for (let i = 0; i < CLOUD_N; i++) {
      const x = (i / (CLOUD_N - 1)) * 10;
      const mu = clGlmMu(link, b0, b1, x);
      const y = clRandTweedie(mu, phi, power, rng);
      cloudR.push((y - mu) / Math.sqrt(clVarPower(mu, phi, power)));
    }
  }

  const dragProbe = (svgNode, getSx) => {
    clDragOnSvg(svgNode, (e) => {
      const sx = getSx();
      if (!sx) return;
      const st = ctx.getState();
      const r = st.ranges.x;
      ctx.setParam('x', Math.max(r.min, Math.min(r.max, sx.invert(clSvgPoint(svgNode, e).x))));
    });
  };
  let sx1Ref = null, sx2Ref = null;
  dragProbe(s1.svg, () => sx1Ref);
  dragProbe(s2.svg, () => sx2Ref);

  return {
    update(st, d) {
      const v = st.values;
      const mode = st.mode === 'normal' ? 'normal' : 'tweedie';
      const link = mode === 'normal' ? 'identity' : 'log';
      const power = mode === 'normal' ? 0 : v.p;
      const key = mode + '|' + v.phi + '|' + (mode === 'normal' ? 0 : v.p);
      if (key !== cloudKey) {
        cloudKey = key;
        rollCloud(mode, v.phi, v.p, v.b0, v.b1);
      }

      const N = 90;
      const muAt = (x) => clGlmMu(link, v.b0, v.b1, x);
      let muMax = 0;
      for (let i = 0; i <= N; i++) muMax = Math.max(muMax, muAt((i / N) * 10));
      const vMax = clVarPower(muMax, v.phi, power);
      const yTop = muMax + 2.4 * Math.sqrt(vMax);

      // ── Mean panel with the η inset ──
      const w1 = s1.wrap.clientWidth || 420, h1 = s1.wrap.clientHeight || 280;
      s1.svg.setAttribute('width', w1); s1.svg.setAttribute('height', h1);
      const insetH = Math.max(44, h1 * 0.2);
      const f1 = { left: 40, top: 14, right: w1 - 14, bottom: h1 - 26 - insetH - 10 };
      const sx1 = clScale(0, 10, f1.left, f1.right);
      sx1Ref = sx1;
      const sy1 = clScale(0, yTop * 1.05, f1.bottom, f1.top);
      axes1.update(sx1, sy1, f1);
      meanPath.setAttribute('d', clPathFrom(Array.from({ length: N + 1 }, (_, i) => {
        const x = (i / N) * 10;
        return [sx1(x), sy1(muAt(x))];
      })));
      probeLine1.setAttribute('x1', sx1(v.x)); probeLine1.setAttribute('x2', sx1(v.x));
      probeLine1.setAttribute('y1', f1.bottom); probeLine1.setAttribute('y2', f1.top);
      probeDot1.setAttribute('cx', sx1(v.x)); probeDot1.setAttribute('cy', sy1(d.muProbe));

      const iTop = h1 - 26 - insetH, iBottom = h1 - 26;
      insetSep.setAttribute('x1', f1.left); insetSep.setAttribute('x2', f1.right);
      insetSep.setAttribute('y1', iTop - 5); insetSep.setAttribute('y2', iTop - 5);
      const etaLo = v.b0, etaHi = v.b0 + v.b1 * 10;
      const pad = Math.max(0.4, Math.abs(etaHi - etaLo) * 0.2);
      const syEta = clScale(Math.min(etaLo, etaHi) - pad, Math.max(etaLo, etaHi) + pad, iBottom, iTop);
      etaPath.setAttribute('d', clPathFrom([[sx1(0), syEta(etaLo)], [sx1(10), syEta(etaHi)]]));
      etaDot.setAttribute('cx', sx1(v.x)); etaDot.setAttribute('cy', syEta(d.eta));
      etaTag.setAttribute('x', f1.left + 2); etaTag.setAttribute('y', iTop + 10);
      etaTag.textContent = 'η = β₀ + β₁x (the straight line underneath)';

      gGhosts.innerHTML = '';
      for (const g of st.ghosts) {
        if (g.b0 === undefined) continue;
        const gp = svgEl('path', {}, 'cl-ghost-curve');
        gp.setAttribute('d', clPathFrom(Array.from({ length: N + 1 }, (_, i) => {
          const x = (i / N) * 10;
          return [sx1(x), sy1(Math.min(yTop * 1.05, clGlmMu(g.link, g.b0, g.b1, x)))];
        })));
        gGhosts.appendChild(gp);
      }

      // ── Error panel ──
      const w2 = s2.wrap.clientWidth || 420, h2 = s2.wrap.clientHeight || 280;
      s2.svg.setAttribute('width', w2); s2.svg.setAttribute('height', h2);
      const f2 = { left: 40, top: 14, right: w2 - 14, bottom: h2 - 26 };
      const sx2 = clScale(0, 10, f2.left, f2.right);
      sx2Ref = sx2;
      const sy2 = clScale(0, yTop * 1.05, f2.bottom, f2.top);
      axes2.update(sx2, sy2, f2);

      let up = '', down = '';
      for (let i = 0; i <= N; i++) {
        const x = (i / N) * 10;
        const mu = muAt(x);
        const s = 2 * Math.sqrt(clVarPower(mu, v.phi, power));
        const cmd = i === 0 ? 'M' : 'L';
        up += cmd + sx2(x).toFixed(1) + ',' + sy2(mu + s).toFixed(1);
        down = 'L' + sx2(x).toFixed(1) + ',' + sy2(Math.max(0, mu - s)).toFixed(1) + down;
      }
      bandPath.setAttribute('d', up + down + 'Z');
      meanPath2.setAttribute('d', clPathFrom(Array.from({ length: N + 1 }, (_, i) => {
        const x = (i / N) * 10;
        return [sx2(x), sy2(muAt(x))];
      })));
      for (let i = 0; i < CLOUD_N; i++) {
        const x = (i / (CLOUD_N - 1)) * 10;
        const mu = muAt(x);
        const y = mu + cloudR[i] * Math.sqrt(clVarPower(mu, v.phi, power));
        const dot = gCloud.children[i];
        dot.setAttribute('cx', sx2(x));
        dot.setAttribute('cy', sy2(Math.max(0, Math.min(yTop * 1.05, y))));
      }
      probeLine2.setAttribute('x1', sx2(v.x)); probeLine2.setAttribute('x2', sx2(v.x));
      probeLine2.setAttribute('y1', f2.bottom); probeLine2.setAttribute('y2', f2.top);
    },
    snapshot(st) {
      const mode = st.mode === 'normal' ? 'identity' : 'log';
      return { label: st.presetId || 'pin', link: mode, b0: st.values.b0, b1: st.values.b1 };
    },
  };
}

// --- Residual lens: the funnel and the pool --------------------------------

function buildResidualScenes(stageRow, ctx) {
  const { linkRoot } = ctx;
  const s1 = buildScene(stageRow, 'Residuals vs Fitted', [
    { label: 'Standardized Residuals', color: 'var(--px-text-secondary)', link: 'funnel' },
    { label: 'Spread By Bin', color: 'var(--px-accent)', link: 'funnel' },
  ], linkRoot);
  const s2 = buildScene(stageRow, 'The Pool They Make', [
    { label: 'Residual Pool', color: 'var(--px-accent)', link: 'std' },
    { label: 'Standard Normal', color: 'var(--cl-ink-1)', dashed: true, link: 'std' },
  ], linkRoot);

  const axes1 = createAxes(s1.svg, { xFmt: (v) => clFmt(v, 'num'), yFmt: (v) => clFmt(v, 'num'), yTicks: 4 });
  const zeroLine = svgEl('line', { stroke: 'var(--px-text-muted)' }, 'cl-curve cl-ref');
  const gPts = svgEl('g'); gPts.dataset.clLink = 'funnel';
  const sdPathUp = svgEl('path', { stroke: 'var(--px-accent)' }, 'cl-curve');
  sdPathUp.dataset.clLink = 'funnel';
  const sdPathDn = svgEl('path', { stroke: 'var(--px-accent)' }, 'cl-curve');
  sdPathDn.dataset.clLink = 'funnel';
  s1.svg.appendChild(zeroLine); s1.svg.appendChild(gPts); s1.svg.appendChild(sdPathUp); s1.svg.appendChild(sdPathDn);

  const axes2 = createAxes(s2.svg, { xFmt: (v) => clFmt(v, 'num'), yTicks: 0, yFmt: () => '' });
  const bars = makeBarPool(s2.svg, 'cl-bar');
  bars.g.dataset.clLink = 'std';
  const normPath = svgEl('path', { stroke: 'var(--cl-ink-1)' }, 'cl-curve cl-ref');
  normPath.dataset.clLink = 'std';
  s2.svg.appendChild(normPath);

  let study = null;
  let studyKey = '';

  return {
    update(st, d) {
      const v = st.values;
      const key = v.pa + '|' + v.phi;
      if (key !== studyKey) {
        studyKey = key;
        study = clResidualStudy({ pAssumed: v.pa, phi: v.phi, seed: 47 });
      }

      // ── Funnel panel ──
      const w1 = s1.wrap.clientWidth || 420, h1 = s1.wrap.clientHeight || 280;
      s1.svg.setAttribute('width', w1); s1.svg.setAttribute('height', h1);
      const f1 = { left: 40, top: 14, right: w1 - 14, bottom: h1 - 26 };
      const sx1 = clScale(0, 42, f1.left, f1.right);
      let rMax = 1;
      for (const p of study.points) rMax = Math.max(rMax, Math.abs(p.r));
      const sy1 = clScale(-rMax * 1.12, rMax * 1.12, f1.bottom, f1.top);
      axes1.update(sx1, sy1, f1);
      zeroLine.setAttribute('x1', f1.left); zeroLine.setAttribute('x2', f1.right);
      zeroLine.setAttribute('y1', sy1(0)); zeroLine.setAttribute('y2', sy1(0));
      const need = study.points.length;
      while (gPts.children.length < need) gPts.appendChild(svgEl('circle', { r: 2.2, fill: 'var(--px-text-secondary)', opacity: 0.55 }, 'cl-dot'));
      while (gPts.children.length > need) gPts.lastChild.remove();
      study.points.forEach((p, i) => {
        const dot = gPts.children[i];
        dot.setAttribute('cx', sx1(p.mu));
        dot.setAttribute('cy', sy1(Math.max(-rMax * 1.12, Math.min(rMax * 1.12, p.r))));
      });
      // Rolling sd envelope by bins of fitted value.
      const BINS = 8;
      const binSd = [];
      for (let b = 0; b < BINS; b++) {
        const inBin = study.points.filter((p) => p.mu >= 2 + b * (38 / BINS) && p.mu < 2 + (b + 1) * (38 / BINS));
        if (!inBin.length) { binSd.push(null); continue; }
        const m = inBin.reduce((a, p) => a + p.r, 0) / inBin.length;
        binSd.push(Math.sqrt(inBin.reduce((a, p) => a + (p.r - m) * (p.r - m), 0) / inBin.length));
      }
      const mid = (b) => 2 + (b + 0.5) * (38 / BINS);
      const upPts = [], dnPts = [];
      binSd.forEach((s, b) => {
        if (s == null) return;
        upPts.push([sx1(mid(b)), sy1(Math.min(rMax * 1.12, 2 * s))]);
        dnPts.push([sx1(mid(b)), sy1(Math.max(-rMax * 1.12, -2 * s))]);
      });
      sdPathUp.setAttribute('d', clPathFrom(upPts));
      sdPathDn.setAttribute('d', clPathFrom(dnPts));

      // ── Pool panel ──
      const w2 = s2.wrap.clientWidth || 420, h2 = s2.wrap.clientHeight || 280;
      s2.svg.setAttribute('width', w2); s2.svg.setAttribute('height', h2);
      const f2 = { left: 34, top: 16, right: w2 - 14, bottom: h2 - 26 };
      const lim = Math.max(3.4, rMax * 1.05);
      const sx2 = clScale(-lim, lim, f2.left, f2.right);
      const BINS2 = 34;
      const binW = (2 * lim) / BINS2;
      const counts = new Array(BINS2).fill(0);
      for (const p of study.points) {
        const b = Math.floor((p.r + lim) / binW);
        if (b >= 0 && b < BINS2) counts[b]++;
      }
      const total = study.points.length;
      let hMax = 0.001, oMax = 0;
      const overlay = [];
      for (let i = 0; i <= 120; i++) {
        const x = -lim + (i / 120) * 2 * lim;
        const y = clNormPdf(x, 0, 1) * binW;
        overlay.push([x, y]);
        oMax = Math.max(oMax, y);
      }
      for (const c of counts) hMax = Math.max(hMax, c / total);
      const sy2 = clScale(0, Math.max(hMax, oMax) * 1.15, f2.bottom, f2.top);
      axes2.update(sx2, sy2, f2);
      const bw2 = Math.max(2, (f2.right - f2.left) / BINS2 - 1.5);
      bars.set(counts.map((c, i) => ({
        x: sx2(-lim + i * binW) + 0.75, y: sy2(c / total), w: bw2, h: Math.max(0, f2.bottom - sy2(c / total)),
      })), 'var(--px-accent)');
      normPath.setAttribute('d', clPathFrom(overlay.map(([x, y]) => [sx2(x), sy2(y)])));
    },
    snapshot(st, d) {
      return { label: 'p_a=' + clFmt(st.values.pa, 'num2'), ratio: d.binRatio };
    },
  };
}

// --- Meyers arc: the claim vs reality, and the p-p verdict -----------------

function buildMeyersArcScenes(stageRow, ctx) {
  const { linkRoot, animator } = ctx;
  const s1 = buildScene(stageRow, 'What The Model Claims vs What Happened', [
    { label: 'The Truth', color: 'var(--cl-ink-1)', dashed: true, link: 'truth' },
    { label: 'The Model’s Claim', color: 'var(--px-accent)', link: 'width' },
    { label: 'Outcomes', color: 'var(--px-text-secondary)', link: 'pp' },
  ], linkRoot);
  const s2 = buildScene(stageRow, 'The P-P Plot And The Verdict', [
    { label: 'Outcome Percentiles', color: 'var(--px-accent)', link: 'pp' },
    { label: 'The KS Band', color: 'var(--cl-ink-4)', dashed: true, link: 'pp' },
  ], linkRoot);

  const axes1 = createAxes(s1.svg, { xFmt: (v) => clFmt(v, 'num'), yTicks: 0, yFmt: () => '' });
  const truthPath = svgEl('path', { stroke: 'var(--cl-ink-1)' }, 'cl-curve cl-ref');
  truthPath.dataset.clLink = 'truth';
  const claimPath = svgEl('path', { stroke: 'var(--px-accent)' }, 'cl-curve');
  claimPath.dataset.clLink = 'width';
  const gOut = svgEl('g'); gOut.dataset.clLink = 'pp';
  s1.svg.appendChild(truthPath); s1.svg.appendChild(claimPath); s1.svg.appendChild(gOut);
  const draws = clValidationDraws(ARC_N, ARC_SEED);
  for (let i = 0; i < draws.length; i++) {
    gOut.appendChild(svgEl('circle', { r: 2.4 }, 'cl-dot'));
  }
  const escTag = svgEl('text', { 'text-anchor': 'end' }, 'cl-svg-tag');
  s1.svg.appendChild(escTag);

  const axes2 = createAxes(s2.svg, {
    xFmt: (v) => Math.round(v) + '%',
    yFmt: (v) => Math.round(v) + '%',
    xTicks: 4, yTicks: 4,
  });
  const diag = svgEl('line', { stroke: 'var(--px-text-muted)' }, 'cl-curve cl-ref');
  const bandLo = svgEl('line', { stroke: 'var(--cl-ink-4)' }, 'cl-curve cl-ref');
  const bandHi = svgEl('line', { stroke: 'var(--cl-ink-4)' }, 'cl-curve cl-ref');
  bandLo.dataset.clLink = 'pp'; bandHi.dataset.clLink = 'pp';
  const gPp = svgEl('g'); gPp.dataset.clLink = 'pp';
  const verdict = svgEl('text', { 'text-anchor': 'middle', 'font-size': 15, 'font-weight': 650 });
  const verdictSub = svgEl('text', { 'text-anchor': 'middle' }, 'cl-svg-tag');
  s2.svg.appendChild(diag); s2.svg.appendChild(bandLo); s2.svg.appendChild(bandHi);
  s2.svg.appendChild(gPp); s2.svg.appendChild(verdict); s2.svg.appendChild(verdictSub);
  for (let i = 0; i < draws.length; i++) {
    gPp.appendChild(svgEl('circle', { r: 2.2, fill: 'var(--px-accent)', opacity: 0.75 }, 'cl-dot'));
  }

  return {
    update(st, d) {
      // ── Claim vs truth ──
      const w1 = s1.wrap.clientWidth || 420, h1 = s1.wrap.clientHeight || 280;
      s1.svg.setAttribute('width', w1); s1.svg.setAttribute('height', h1);
      const f1 = { left: 30, top: 16, right: w1 - 14, bottom: h1 - 26 };
      const sx1 = clScale(-3.6, 3.6, f1.left, f1.right);
      const N = 130;
      let pMax = 0;
      const truth = [], claim = [];
      for (let i = 0; i <= N; i++) {
        const x = -3.6 + (i / N) * 7.2;
        const yt = clNormPdf(x, 0, 1);
        const yc = clNormPdf(x, d.bias, Math.max(0.05, d.tail));
        truth.push([x, yt]); claim.push([x, yc]);
        pMax = Math.max(pMax, yt, yc);
      }
      const sy1 = clScale(0, pMax * 1.15, f1.bottom, f1.top);
      axes1.update(sx1, sy1, f1);
      truthPath.setAttribute('d', clPathFrom(truth.map(([x, y]) => [sx1(x), sy1(y)])));
      claimPath.setAttribute('d', clPathFrom(claim.map(([x, y]) => [sx1(x), sy1(y)])));
      let escapees = 0;
      draws.forEach((x, i) => {
        const pct = 100 * clNormCdf((x - d.bias) / Math.max(0.05, d.tail));
        const escaped = pct < 5 || pct > 95;
        if (escaped) escapees++;
        const dot = gOut.children[i];
        dot.setAttribute('cx', sx1(Math.max(-3.6, Math.min(3.6, x))));
        dot.setAttribute('cy', f1.bottom - 4 - (i % 5) * 3.5);
        dot.setAttribute('fill', escaped ? 'var(--px-danger)' : 'var(--px-text-secondary)');
        dot.setAttribute('opacity', escaped ? 0.95 : 0.45);
      });
      escTag.setAttribute('x', f1.right - 4); escTag.setAttribute('y', f1.top + 12);
      escTag.textContent = escapees + ' of ' + draws.length + ' outcomes beyond the claimed 5th-95th (5 expected)';

      // ── P-P plot ──
      const w2 = s2.wrap.clientWidth || 420, h2 = s2.wrap.clientHeight || 280;
      s2.svg.setAttribute('width', w2); s2.svg.setAttribute('height', h2);
      const f2 = { left: 40, top: 16, right: w2 - 14, bottom: h2 - 44 };
      const sx2 = clScale(0, 100, f2.left, f2.right);
      const sy2 = clScale(0, 100, f2.bottom, f2.top);
      axes2.update(sx2, sy2, f2);
      diag.setAttribute('x1', sx2(0)); diag.setAttribute('y1', sy2(0));
      diag.setAttribute('x2', sx2(100)); diag.setAttribute('y2', sy2(100));
      const band = d.band;
      bandLo.setAttribute('x1', sx2(Math.min(100, band))); bandLo.setAttribute('y1', sy2(0));
      bandLo.setAttribute('x2', sx2(100)); bandLo.setAttribute('y2', sy2(Math.max(0, 100 - band)));
      bandHi.setAttribute('x1', sx2(0)); bandHi.setAttribute('y1', sy2(Math.min(100, band)));
      bandHi.setAttribute('x2', sx2(Math.max(0, 100 - band))); bandHi.setAttribute('y2', sy2(100));
      const pts = clPpPoints(draws.map((x) => 100 * clNormCdf((x - d.bias) / Math.max(0.05, d.tail))));
      pts.forEach((p, i) => {
        const dot = gPp.children[i];
        dot.setAttribute('cx', sx2(p.expected));
        dot.setAttribute('cy', sy2(p.observed));
      });
      const pass = d.D < d.band;
      verdict.setAttribute('x', (f2.left + f2.right) / 2);
      verdict.setAttribute('y', h2 - 22);
      verdict.setAttribute('fill', pass ? 'var(--px-success)' : 'var(--px-danger)');
      verdict.textContent = pass ? 'Validates: D = ' + clFmt(d.D, 'num2') + ' inside the band' : 'Rejected: D = ' + clFmt(d.D, 'num2') + ' outside ' + clFmt(d.band, 'num2');
      verdictSub.setAttribute('x', (f2.left + f2.right) / 2);
      verdictSub.setAttribute('y', h2 - 8);
      verdictSub.textContent = pass ? 'Uniform percentiles: the model earned its distribution' : 'The outcomes refuse the model’s percentiles';
    },
    snapshot(st, d) {
      return { label: st.presetId || 'pin', D: d.D };
    },
  };
}

// --- Pane shell ------------------------------------------------------------

function renderPane(container) {
  injectStyles();
  container.innerHTML = '';
  const root = document.createElement('div');
  root.className = 'cl-root';
  container.appendChild(root);

  let cleanup = null;

  function show() {
    if (cleanup) { cleanup(); cleanup = null; }
    root.innerHTML = '';
    const mod = _paneState.route.view === 'module' ? clGetModule(_paneState.route.moduleId) : null;
    cleanup = mod ? renderModuleView(root, mod) : renderHomeView(root);
  }

  _paneRerender = show;
  show();

  return {
    dispose() {
      if (cleanup) cleanup();
      if (_paneRerender === show) _paneRerender = null;
      container.innerHTML = '';
    },
    saveViewState() {
      return { route: { ..._paneState.route } };
    },
    restoreViewState(saved) {
      const r = saved?.route;
      if (r?.view && (r.view !== _paneState.route.view || r.moduleId !== _paneState.route.moduleId)) {
        _paneState.route = r;
        show();
      }
    },
  };
}

function renderHomeView(root) {
  const home = document.createElement('div');
  home.className = 'cl-home';
  const title = document.createElement('div');
  title.className = 'cl-home-title';
  title.textContent = 'Concept Lab';
  const sub = document.createElement('div');
  sub.className = 'cl-home-sub';
  sub.textContent = 'One ladder from coin-flip probability to Mack, Meyers, and the bootstrap. Concept modules teach the statistics; exam modules apply it on the papers’ own printed numbers. Climb in order, or jump in anywhere: every module links down to its foundations and up to where the exam uses it.';
  home.appendChild(title);
  home.appendChild(sub);

  const guide = document.createElement('div');
  guide.className = 'cl-guide';
  const guideTitle = document.createElement('div');
  guideTitle.className = 'cl-guide-title';
  guideTitle.textContent = 'How To Use The Lab';
  guide.appendChild(guideTitle);
  const grid = document.createElement('div');
  grid.className = 'cl-guide-grid';
  const tips = [
    { icon: 'layers', head: 'Climb The Ladder', text: 'Levels 1 to 6 teach the statistics; level 7 is the exam papers on their own printed numbers. Jump in anywhere: Builds On and Where The Exam Uses This link every module down to its foundations and up to its payoff.' },
    { icon: 'circle-dot', head: 'Follow The Story', text: 'Every module opens on a guided walk in the left column. Step through the dots; some steps ask you to COMMIT to a prediction before the reveal, because a guess you owned teaches more than a fact you read.' },
    { icon: 'move-horizontal', head: 'Drag Anywhere', text: 'Sliders work, but so do the charts: drag the query marker, the today line on the fan, the candidate across the likelihood surface, the probability masses on the beam.' },
    { icon: 'mouse-pointer-2', head: 'Hover To Trace', text: 'Hover any formula term, readout, or legend entry and the exact curve it drives lights up while everything else dims.' },
    { icon: 'copy', head: 'Pin A Ghost', text: 'Pin Ghost freezes the current curve in place. Change anything and compare against where you were.' },
    { icon: 'message-square', head: 'Ask The Instructor', text: 'In chat, ask to be SHOWN a concept ("open the MSE valley at Example 1"). The AI opens the right module with the values set.' },
  ];
  for (const tip of tips) {
    const item = document.createElement('div');
    item.className = 'cl-guide-item';
    const icon = document.createElement('span');
    icon.className = 'cl-guide-icon';
    icon.innerHTML = clIcon(tip.icon, 15);
    const body = document.createElement('div');
    const head = document.createElement('div');
    head.className = 'cl-guide-head';
    head.textContent = tip.head;
    const text = document.createElement('div');
    text.className = 'cl-guide-text';
    text.textContent = tip.text;
    body.appendChild(head);
    body.appendChild(text);
    item.appendChild(icon);
    item.appendChild(body);
    grid.appendChild(item);
  }
  guide.appendChild(grid);
  home.appendChild(guide);

  let i = 0;
  LEVELS.forEach((lvl, li) => {
    const mods = MODULES.filter((m) => m.level === lvl.id)
      .sort((a, b) => (a.ord ?? 99) - (b.ord ?? 99));
    if (!mods.length) return;
    const section = document.createElement('div');
    section.className = 'cl-level';
    const head = document.createElement('div');
    head.className = 'cl-level-head';
    const num = document.createElement('span');
    num.className = 'cl-level-num';
    num.textContent = String(li + 1).padStart(2, '0');
    const titles = document.createElement('div');
    const lt = document.createElement('div');
    lt.className = 'cl-level-title';
    lt.textContent = lvl.title;
    const tag = document.createElement('div');
    tag.className = 'cl-level-tag';
    tag.textContent = lvl.tagline;
    titles.appendChild(lt); titles.appendChild(tag);
    head.appendChild(num); head.appendChild(titles);
    section.appendChild(head);

    const cards = document.createElement('div');
    cards.className = 'cl-cards';
    for (const mod of mods) {
      const card = document.createElement('div');
      card.className = 'cl-card' + (mod.kind === 'concept' ? ' cl-card-concept' : '');
      card.style.animationDelay = Math.min(i * 40, 480) + 'ms';
      const chead = document.createElement('div');
      chead.className = 'cl-card-head';
      const icon = document.createElement('span');
      icon.className = 'cl-card-icon';
      icon.innerHTML = clIcon(mod.icon || 'line-chart', 18);
      const t = document.createElement('span');
      t.className = 'cl-card-title';
      t.textContent = mod.title;
      chead.appendChild(icon); chead.appendChild(t);
      const s = document.createElement('div');
      s.className = 'cl-card-sub';
      s.textContent = mod.subtitle;
      const foot = document.createElement('div');
      foot.className = 'cl-card-paper';
      if (mod.paper) {
        foot.textContent = mod.paper.label;
      } else {
        // A concept card points forward: name the exam modules it feeds.
        const feeds = (mod.bridges || [])
          .map((b) => clGetModule(b.module)?.title)
          .filter(Boolean)
          .slice(0, 2);
        foot.textContent = feeds.length ? 'Feeds ' + feeds.join(' · ') : lvl.tagline;
      }
      card.appendChild(chead); card.appendChild(s); card.appendChild(foot);
      card.addEventListener('click', () => {
        _paneState.route = { view: 'module', moduleId: mod.id };
        _paneRerender?.();
      });
      cards.appendChild(card);
      i++;
    }
    section.appendChild(cards);
    home.appendChild(section);
  });
  root.appendChild(home);
  return () => {};
}

function renderModuleView(root, mod) {
  const st = getLabState(mod);
  const animator = createAnimator(() => updateAll());
  const observers = [];

  // ── Header ──
  const header = document.createElement('div');
  header.className = 'cl-header';
  const back = document.createElement('button');
  back.className = 'cl-back';
  back.innerHTML = clIcon('arrow-left', 16);
  back.setAttribute('aria-label', 'Back To Modules');
  back.addEventListener('click', () => {
    _paneState.route = { view: 'home', moduleId: null };
    _paneRerender?.();
  });
  const titles = document.createElement('div');
  titles.className = 'cl-header-titles';
  const t = document.createElement('div');
  t.className = 'cl-title';
  t.textContent = mod.title;
  const s = document.createElement('div');
  s.className = 'cl-subtitle';
  s.textContent = mod.subtitle;
  titles.appendChild(t); titles.appendChild(s);
  const chip = document.createElement('span');
  chip.className = 'cl-source-chip';
  const chipText = document.createElement('span');
  if (mod.paper) {
    chip.innerHTML = `<span class="cl-chip-icon">${clIcon('book-open', 12)}</span>`;
    chipText.textContent = `${mod.paper.label} · ${mod.paper.section}`;
    chip.title = mod.paper.task;
  } else {
    const lvl = clGetLevel(mod.level);
    const n = LEVELS.indexOf(lvl) + 1;
    chip.innerHTML = `<span class="cl-chip-icon">${clIcon('layers', 12)}</span>`;
    chipText.textContent = `Foundations · Level ${n} · ${lvl ? lvl.title : ''}`;
    chip.title = lvl ? lvl.tagline : '';
  }
  chip.appendChild(chipText);
  header.appendChild(back); header.appendChild(titles); header.appendChild(chip);
  root.appendChild(header);

  // ── Story strip ──
  const story = document.createElement('div');
  story.className = 'cl-story';
  const nav = document.createElement('div');
  nav.className = 'cl-story-nav';
  const prevBtn = document.createElement('button');
  prevBtn.className = 'cl-story-btn';
  prevBtn.innerHTML = clIcon('chevron-left', 14);
  prevBtn.setAttribute('aria-label', 'Previous Step');
  const dots = [];
  for (let i = 0; i < mod.story.length; i++) {
    const dot = document.createElement('button');
    dot.className = 'cl-story-dot';
    dot.setAttribute('aria-label', 'Step ' + (i + 1));
    dot.addEventListener('click', () => applyStory(i));
    nav.appendChild(dot);
    dots.push(dot);
  }
  const nextBtn = document.createElement('button');
  nextBtn.className = 'cl-story-btn';
  nextBtn.innerHTML = clIcon('chevron-right', 14);
  nextBtn.setAttribute('aria-label', 'Next Step');
  const storyText = document.createElement('div');
  storyText.className = 'cl-story-text';
  nav.insertBefore(prevBtn, nav.firstChild);
  nav.appendChild(nextBtn);
  story.appendChild(nav);
  // The advance organizer: what this module is about, always visible above
  // the current step so the learner never loses the thread.
  if (mod.intro) {
    const introEl = document.createElement('div');
    introEl.className = 'cl-story-intro';
    introEl.textContent = mod.intro;
    story.appendChild(introEl);
  }
  story.appendChild(storyText);
  prevBtn.addEventListener('click', () => applyStory(st.storyIndex - 1));
  nextBtn.addEventListener('click', () => applyStory(st.storyIndex + 1));

  // ── Body ──
  const body = document.createElement('div');
  body.className = 'cl-body';
  const rail = document.createElement('div');
  rail.className = 'cl-rail';
  const stageCol = document.createElement('div');
  stageCol.className = 'cl-stage-col';
  const stageRow = document.createElement('div');
  stageRow.className = 'cl-stage-row';
  // The formula lives WITH the narrative, not on a third surface: the left
  // column is the one place to understand (step, formula, live numbers);
  // the stage stays pure picture and the rail stays pure controls.
  const formulaSection = document.createElement('div');
  formulaSection.className = 'cl-under';
  const formulaLabel = document.createElement('div');
  formulaLabel.className = 'cl-rail-label';
  formulaLabel.textContent = 'The Formula';
  formulaSection.appendChild(formulaLabel);
  const formulaBar = document.createElement('div');
  formulaBar.className = 'cl-formula-bar';
  formulaSection.appendChild(formulaBar);
  story.appendChild(formulaSection);
  stageCol.appendChild(stageRow);
  // Story guides on the left, stage in the middle, controls on the right:
  // read the step, look at the picture, then reach for the dials.
  body.appendChild(story);
  body.appendChild(stageCol);
  body.appendChild(rail);
  root.appendChild(body);


  // ── Rail: presets ──
  const presetSection = document.createElement('div');
  const presetLabel = document.createElement('div');
  presetLabel.className = 'cl-rail-label';
  presetLabel.textContent = 'Worked Examples';
  presetSection.appendChild(presetLabel);
  const chips = document.createElement('div');
  chips.className = 'cl-presets';
  const chipEls = new Map();
  for (const preset of mod.presets) {
    const c = document.createElement('button');
    c.className = 'cl-preset-chip';
    c.textContent = preset.label;
    c.addEventListener('click', () => applyPreset(preset, true));
    chips.appendChild(c);
    chipEls.set(preset.id, c);
  }
  presetSection.appendChild(chips);
  const presetNote = document.createElement('div');
  presetNote.className = 'cl-preset-note';
  presetSection.appendChild(presetNote);
  rail.appendChild(presetSection);

  // ── Rail: sliders ──
  const sliderSection = document.createElement('div');
  const sliderLabel = document.createElement('div');
  sliderLabel.className = 'cl-rail-label';
  sliderLabel.textContent = 'Parameters';
  sliderSection.appendChild(sliderLabel);
  const sliders = new Map();
  const scheduleUpdate = clRafThrottle(() => updateAll());
  for (const def of mod.params) {
    const handle = buildSlider(sliderSection, def, st.ranges[def.key], st.values[def.key], (v) => {
      animator.cancel('param:' + def.key);
      st.values[def.key] = v;
      st.fresh = false;
      scheduleUpdate();
    }, root);
    sliders.set(def.key, handle);
  }
  rail.appendChild(sliderSection);

  // ── Rail: readouts ──
  const readoutSection = document.createElement('div');
  readoutSection.className = 'cl-under';
  const readoutLabel = document.createElement('div');
  readoutLabel.className = 'cl-rail-label';
  readoutLabel.textContent = 'Readouts';
  readoutSection.appendChild(readoutLabel);
  const readoutGrid = document.createElement('div');
  readoutGrid.className = 'cl-readouts';
  const readoutEls = [];
  for (const r of mod.readouts || []) {
    const cell = document.createElement('div');
    const label = document.createElement('div');
    label.className = 'cl-readout-label';
    if (r.sym) label.appendChild(clTex(r.sym));
    const name = document.createElement('span');
    name.textContent = (r.sym ? ' ' : '') + r.label;
    label.appendChild(name);
    const value = document.createElement('div');
    value.className = 'cl-readout-value' + (r.accent ? ' cl-accent' : '');
    cell.appendChild(label);
    cell.appendChild(value);
    if (r.link) {
      cell.dataset.clLink = r.link;
      clWireHover(cell, r.link, root);
    }
    readoutGrid.appendChild(cell);
    readoutEls.push({ def: r, el: value });
  }
  readoutSection.appendChild(readoutGrid);
  story.appendChild(readoutSection);

  // ── Rail: ghosts ──
  const ghostSection = document.createElement('div');
  const ghostLabel = document.createElement('div');
  ghostLabel.className = 'cl-rail-label';
  ghostLabel.textContent = 'Compare';
  ghostSection.appendChild(ghostLabel);
  const ghostRow = document.createElement('div');
  ghostRow.className = 'cl-ghost-row';
  ghostSection.appendChild(ghostRow);
  rail.appendChild(ghostSection);

  function paintGhosts() {
    ghostRow.innerHTML = '';
    const pin = document.createElement('button');
    pin.className = 'cl-ghost-btn';
    pin.textContent = 'Pin Ghost';
    pin.addEventListener('click', () => {
      const snap = sceneApi.snapshot?.(st, lastD);
      if (!snap) return;
      st.ghosts.push(snap);
      if (st.ghosts.length > 3) st.ghosts.shift();
      paintGhosts();
      updateAll();
    });
    ghostRow.appendChild(pin);
    st.ghosts.forEach((g, i) => {
      const c = document.createElement('button');
      c.className = 'cl-ghost-chip';
      c.innerHTML = clIcon('x', 10) + `<span>${g.label}</span>`;
      c.title = 'Remove This Ghost';
      c.addEventListener('click', () => {
        st.ghosts.splice(i, 1);
        paintGhosts();
        updateAll();
      });
      ghostRow.appendChild(c);
    });
  }
  paintGhosts();

  // ── Rail: connections (the anti-stranding sections) ──
  // "Builds On" walks down to the concepts this module stands on;
  // "Where The Exam Uses This" walks up to the papers that need it.
  const connGroups = [
    { label: 'Builds On', icon: 'layers', items: mod.foundations || [] },
    { label: 'Where The Exam Uses This', icon: 'graduation-cap', items: mod.bridges || [] },
  ].filter((g) => g.items.length);
  for (const group of connGroups) {
    const section = document.createElement('div');
    const label = document.createElement('div');
    label.className = 'cl-rail-label cl-conn-label';
    label.innerHTML = `<span class="cl-conn-label-icon">${clIcon(group.icon, 12)}</span><span>${group.label}</span>`;
    section.appendChild(label);
    for (const item of group.items) {
      const target = clGetModule(item.module);
      if (!target) continue;
      const row = document.createElement('button');
      row.className = 'cl-conn-row';
      const head = document.createElement('span');
      head.className = 'cl-conn-title';
      head.innerHTML = `${clIcon(target.icon || 'line-chart', 13)}<span>${target.title}</span>`;
      const text = document.createElement('span');
      text.className = 'cl-conn-text';
      text.textContent = item.text;
      row.appendChild(head);
      row.appendChild(text);
      row.addEventListener('click', () => {
        _paneState.route = { view: 'module', moduleId: target.id };
        _paneRerender?.();
      });
      section.appendChild(row);
    }
    rail.appendChild(section);
  }

  // ── Stage + formula ──
  const sceneCtx = {
    linkRoot: root,
    animator,
    getState: () => st,
    setParam(key, v) {
      animator.cancel('param:' + key);
      st.values[key] = v;
      st.fresh = false;
      sliders.get(key)?.set(v);
      scheduleUpdate();
    },
  };
  const sceneApi = SCENE_BUILDERS[mod.id]?.(stageRow, sceneCtx) || { update() {} };
  const formula = buildFormulaBar(formulaBar, root);
  let formulaMode = undefined;
  let lastD = null;

  function syncModeUi() {
    for (const def of mod.params) {
      const visible = !def.modes || def.modes.includes(st.mode || 'cred');
      sliders.get(def.key).row.style.display = visible ? '' : 'none';
    }
    if (formulaMode !== st.mode) {
      formulaMode = st.mode;
      formula.setSpec(mod.formula(st));
    }
  }

  function updateAll() {
    const d = { ...st.values, ...mod.derived(st.values, st), ...(st.sceneStats || {}) };
    if (st.mode === 'fit' && st.data) {
      const f = clFitLeastSquares(st.data);
      d.fitA = f.a; d.fitB = f.b; d.fitL = f.a + f.b * st.values.x;
    }
    lastD = d;
    for (const { def, el } of readoutEls) {
      const raw = def.get ? def.get(d) : d[def.id];
      el.textContent = def.fmt === 'str' ? String(raw ?? '—') : clFmt(raw, def.fmt);
    }
    formula.update(d);
    sceneApi.update(st, d);
    st.fresh = false;
  }

  function applyPreset(preset, animate) {
    st.presetId = preset.id;
    st.mode = preset.mode ?? null;
    st.data = preset.data ?? null;
    st.query = preset.query ?? null;
    for (const p of mod.params) {
      st.ranges[p.key] = { min: p.min, max: p.max, step: p.step };
    }
    for (const [key, patch] of Object.entries(preset.params ?? {})) {
      if (patch.min !== undefined || patch.max !== undefined || patch.step !== undefined) {
        const r = st.ranges[key];
        st.ranges[key] = { min: patch.min ?? r.min, max: patch.max ?? r.max, step: patch.step ?? r.step };
      }
    }
    for (const p of mod.params) sliders.get(p.key).setRange(st.ranges[p.key]);
    const dur = clMotion().slow + 140;
    for (const [key, patch] of Object.entries(preset.params ?? {})) {
      if (patch.value === undefined) continue;
      if (animate && !st.fresh) {
        animator.tween('param:' + key, st.values[key], patch.value, dur, (v) => {
          st.values[key] = v;
          sliders.get(key).set(v);
        });
      } else {
        st.values[key] = patch.value;
        sliders.get(key).set(patch.value);
      }
    }
    for (const [id, el] of chipEls) el.classList.toggle('cl-active', id === preset.id);
    presetNote.textContent = preset.note || '';
    syncModeUi();
    updateAll();
  }

  // Predict-then-reveal: a story step with `predict` asks BEFORE it moves the
  // parameters. The learner commits to an option; only then does the preset
  // apply (the reveal). Answers persist per module so revisits don't re-ask.
  function renderPredict(container, step, i, onAnswer) {
    const box = document.createElement('div');
    box.className = 'cl-predict';
    const prompt = document.createElement('div');
    prompt.className = 'cl-predict-prompt';
    prompt.innerHTML = `<span class="cl-predict-icon">${clIcon('circle-help', 13)}</span>`;
    prompt.appendChild(clMd(step.predict.prompt));
    box.appendChild(prompt);
    const opts = document.createElement('div');
    opts.className = 'cl-predict-opts';
    const answered = st.predictAnswers[i];
    step.predict.options.forEach((optText, j) => {
      const b = document.createElement('button');
      b.className = 'cl-predict-opt';
      b.appendChild(clMd(optText));
      if (answered !== undefined) {
        b.disabled = true;
        if (j === step.predict.answer) b.classList.add('cl-right');
        else if (j === answered) b.classList.add('cl-wrong');
      } else {
        b.addEventListener('click', () => {
          st.predictAnswers[i] = j;
          onAnswer();
        });
      }
      opts.appendChild(b);
    });
    box.appendChild(opts);
    if (answered !== undefined && step.predict.explain) {
      const ex = document.createElement('div');
      ex.className = 'cl-predict-explain';
      ex.appendChild(clMd(step.predict.explain));
      box.appendChild(ex);
    }
    container.appendChild(box);
  }

  function renderStoryText(i) {
    const step = mod.story[i];
    storyText.innerHTML = '';
    const title = document.createElement('span');
    title.className = 'cl-story-step-title';
    title.textContent = (i + 1) + '. ' + step.title;
    storyText.appendChild(title);
    storyText.appendChild(clMd(step.text));
    if (step.predict) renderPredict(storyText, step, i, () => applyStory(i));
  }

  function applyStory(i) {
    if (i < 0 || i >= mod.story.length) return;
    st.storyIndex = i;
    const step = mod.story[i];
    dots.forEach((d, j) => d.classList.toggle('cl-active', j === i));
    prevBtn.disabled = i === 0;
    nextBtn.disabled = i === mod.story.length - 1;
    renderStoryText(i);
    if (step.predict && st.predictAnswers[i] === undefined) {
      // Commit before the reveal: the preset waits for an answer, but the
      // stage still needs to render whatever state the learner is in now.
      syncModeUi();
      updateAll();
      return;
    }
    const preset = mod.presets.find((p) => p.id === step.preset);
    if (preset) applyPreset(preset, true);
  }

  // ── Mount ──
  const ro = typeof ResizeObserver !== 'undefined'
    ? new ResizeObserver(clRafThrottle(() => updateAll()))
    : null;
  if (ro) { ro.observe(stageRow); observers.push(ro); }

  st.fresh = true;
  if (st.presetId) {
    // Returning to a module the user already explored: rebuild the UI around
    // the SAVED values — reapplying the preset would clobber their state.
    const preset = mod.presets.find((p) => p.id === st.presetId);
    for (const [id, el] of chipEls) el.classList.toggle('cl-active', id === st.presetId);
    presetNote.textContent = preset?.note || '';
    syncModeUi();
    updateAll();
    dots.forEach((d, j) => d.classList.toggle('cl-active', j === st.storyIndex));
    if (mod.story[st.storyIndex]) renderStoryText(st.storyIndex);
    prevBtn.disabled = st.storyIndex === 0;
    nextBtn.disabled = st.storyIndex === mod.story.length - 1;
  } else {
    applyStory(0);
    if (!mod.story.length) applyPreset(mod.presets[0], false);
  }

  // AI-requested configuration outranks whatever state the mount restored:
  // the instructor said "look at THIS", so that is what renders.
  if (_pendingConfig && _pendingConfig.moduleId === mod.id) {
    const cfg = _pendingConfig;
    _pendingConfig = null;
    const preset = cfg.preset ? mod.presets.find((p) => p.id === cfg.preset) : null;
    if (preset) applyPreset(preset, false);
    if (cfg.params) {
      for (const [key, raw] of Object.entries(cfg.params)) {
        const r = st.ranges[key];
        const s = sliders.get(key);
        if (!r || !s || typeof raw !== 'number' || !Number.isFinite(raw)) continue;
        const val = Math.max(r.min, Math.min(r.max, raw));
        st.values[key] = val;
        s.set(val);
      }
      updateAll();
    }
  }

  return () => {
    animator.dispose();
    for (const o of observers) o.disconnect();
  };
}

// ============================================================================
// SECTION 6: SIDEBAR VIEW
// ============================================================================

function renderSidebar(container) {
  injectStyles();
  container.innerHTML = '';
  const root = document.createElement('div');
  root.className = 'cl-side';
  const home = document.createElement('div');
  home.className = 'cl-side-row';
  home.innerHTML = `<span class="cl-side-icon">${clIcon('layout-grid', 15)}</span><span>All Modules</span>`;
  home.addEventListener('click', () => openLab(null, true));
  root.appendChild(home);
  LEVELS.forEach((lvl, li) => {
    const mods = MODULES.filter((m) => m.level === lvl.id)
      .sort((a, b) => (a.ord ?? 99) - (b.ord ?? 99));
    if (!mods.length) return;
    const heading = document.createElement('div');
    heading.className = 'cl-side-level';
    heading.textContent = (li + 1) + ' · ' + lvl.title;
    heading.title = lvl.tagline;
    root.appendChild(heading);
    for (const mod of mods) {
      const row = document.createElement('div');
      row.className = 'cl-side-row';
      row.innerHTML = `<span class="cl-side-icon">${clIcon(mod.icon || 'line-chart', 15)}</span>`;
      const label = document.createElement('span');
      label.textContent = mod.title;
      row.appendChild(label);
      row.title = mod.subtitle;
      row.addEventListener('click', () => openLab(mod.id));
      root.appendChild(row);
    }
  });
  container.appendChild(root);
  return { dispose() { container.innerHTML = ''; } };
}

async function openLab(moduleId, goHome) {
  if (!_api) return;
  if (moduleId) _paneState.route = { view: 'module', moduleId };
  else if (goHome) _paneState.route = { view: 'home', moduleId: null };
  await _api.editors.openEditor({
    typeId: 'conceptLab',
    title: 'Concept Lab',
    icon: 'line-chart',
    instanceId: 'main',
  });
  // The pane may already be mounted — openEditor only focuses it then.
  _paneRerender?.();
}

// ============================================================================
// SECTION 7: ACTIVATION
// ============================================================================

export async function activate(api, context) {
  _api = api;

  context.subscriptions.push(
    api.commands.registerCommand('conceptLab.open', () => openLab(null)),
  );

  context.subscriptions.push(
    api.editors.registerEditorProvider('conceptLab', {
      createEditorPane(container) {
        return renderPane(container);
      },
    }),
  );

  context.subscriptions.push(
    api.views.registerViewProvider('conceptLab.modules', {
      createView(container) {
        return renderSidebar(container);
      },
    }),
  );

  // conceptLab_open — the instructor SHOWS instead of tells: the AI opens a
  // module with a worked example or specific parameter values on screen.
  if (api.chat?.registerTool) {
    const moduleList = MODULES.map((m) => {
      const ground = m.paper ? m.paper.label : `foundations: ${clGetLevel(m.level)?.title ?? m.level}`;
      return `${m.id} ("${m.title}", ${ground}; presets: ${m.presets.map((p) => p.id).join('/')}; params: ${m.params.map((p) => p.key).join('/')})`;
    }).join('; ');
    context.subscriptions.push(api.chat.registerTool('conceptLab_open', {
      description:
        'Open a Concept Lab interactive explorable so the user can SEE a statistical concept move instead of reading about it. '
        + 'Optionally apply a preset (a paper\'s worked example) and/or set numeric parameter values; the sliders move to them. '
        + 'Modules: ' + moduleList,
      parameters: {
        type: 'object',
        properties: {
          moduleId: { type: 'string', description: 'One of the module ids from the tool description.' },
          preset: { type: 'string', description: 'Optional preset id within that module.' },
          params: { type: 'object', description: 'Optional map of parameter key to numeric value, applied after the preset.' },
        },
        required: ['moduleId'],
      },
      requiresConfirmation: false,
      handler: async (args) => {
        const mod = clGetModule(String(args?.moduleId || ''));
        if (!mod) {
          return { content: 'Unknown module id. Available: ' + MODULES.map((m) => m.id).join(', '), isError: true };
        }
        const preset = args.preset ? mod.presets.find((p) => p.id === args.preset) : null;
        if (args.preset && !preset) {
          return { content: `Unknown preset "${args.preset}" for ${mod.id}. Available: ` + mod.presets.map((p) => p.id).join(', '), isError: true };
        }
        _pendingConfig = {
          moduleId: mod.id,
          preset: preset ? preset.id : null,
          params: args.params && typeof args.params === 'object' ? args.params : null,
        };
        await openLab(mod.id);
        return { content: `Opened "${mod.title}"${preset ? ` at the "${preset.label}" example` : ''}. The user is looking at it now.` };
      },
    }));
  }
}

export async function deactivate() {
  for (const d of _disposables) { try { d.dispose(); } catch { /* teardown */ } }
  _disposables.length = 0;
  _api = null;
}

// ============================================================================
// SECTION 8: __testables — pure logic only; keep side-effect free
// ============================================================================

export const __testables = {
  clMulberry32,
  clRandNormal,
  clLogGamma,
  clErf,
  clNormPdf,
  clNormCdf,
  clNormInv,
  clMatchLognormal,
  clLognPdf,
  clLognCdf,
  clLognInv,
  clPoissonPmf,
  clOdpSupport,
  clGammaPdf,
  clNbPmf,
  clFitLeastSquares,
  clBrosiusCred,
  clBrosiusReferences,
  clMackT,
  clMackCStar,
  clMackMse,
  clMackReserves,
  clMackRegime,
  clGogolPosterior,
  clNormalConjugate,
  clKsD,
  clKsBand,
  clPpPoints,
  clValidationDraws,
  clValidationRun,
  clMackFactorSet,
  clMackAlpha2,
  clMackProject,
  clMackSe,
  clMackLognRange,
  clClarkG,
  clClarkReserves,
  clClarkElr,
  clRandGamma,
  clOdpFit,
  clOdpBootstrapOnce,
  clMvn2LogPdf,
  clMetropolisStep,
  clMetropolisRun,
  clCsrShare,
  clCovAggregate,
  clMarshallConsolidate,
  clMarginalSum,
  clRandPoisson,
  clDiscreteMoments,
  clMeanMachineMoments,
  clCompoundMoments,
  clCompoundSim,
  clCompoundSkew,
  clBivarCond,
  clBivarCloud,
  clSumSd,
  clLognLoglik,
  clLognMle,
  clDevG,
  clDevExpected,
  clDevProdF,
  clDevPaths,
  clSamplingRun,
  LS_DATA,
  LS_MLE,
  clShrinkErr,
  clShrinkClasses,
  clGlmMu,
  clVarPower,
  clRandTweedie,
  clResidualStudy,
  clCclWidth,
  MODULES,
  clGetModule,
  LEVELS,
  clGetLevel,
};
