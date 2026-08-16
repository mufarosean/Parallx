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

// ============================================================================
// SECTION 2: MODULE FRAMEWORK + DEFINITIONS
// Modules are declarative content over the kernel: params in the paper's
// own notation, derived values, presets that ARE printed exhibits, a guided
// story, and checks against the printed numbers.
// ============================================================================

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
  title: 'The Credibility Line',
  subtitle: 'Least-squares loss development: one line, three famous methods inside it',
  icon: 'trending-up',
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
      title: 'Three methods, one picture',
      text: 'Chain ladder says $L(x) = x/d$, a ray from the origin. Budgeted loss says $L(x) = E[Y]$, a flat line that ignores $x$ entirely. BF splits the difference with slope one. Watch all three live as reference lines.',
      preset: 'poisson',
    },
    {
      title: 'Let the data pick',
      text: 'Brosius\' answer: fit $L(x) = a + bx$ by least squares. In Table 1\'s real data the fit lands at $b = 0.968$, $a = 6{,}023$: none of the three classical lines, and better than all of them.',
      preset: 'table1',
    },
    {
      title: 'The credibility anatomy',
      text: 'The same line rewritten: $L(x) = Z\\frac{x}{d} + (1-Z)E[Y]$ with $Z = \\frac{VHM}{VHM + EPV}$. Drag VHM up and the line swings toward chain ladder; drag EPV up and it flattens toward the prior.',
      preset: 'uniform',
    },
    {
      title: 'When history is useless',
      text: 'Tort reform: past data cannot set the line, but judgment can set $VHM$ and $EPV$. $Z = 0.628$ answers $9.5M. No classical method gets there.',
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
  title: 'The MSE Valley',
  subtitle: 'Benktander and the optimal credibility factor, from Mack (2000)',
  icon: 'git-merge',
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
      title: 'One knob between two extremes',
      text: 'BF ignores your losses ($c = 0$); chain ladder trusts nothing else ($c = 1$). Benktander proposed $c = p_k$: trust the data exactly as fast as it pays in.',
      preset: 'base',
    },
    {
      title: 'The valley',
      text: 'mse$(R_c) = E[\\alpha^2]q_k^2\\left(\\frac{c^2}{p_k} + \\frac{1}{q_k} + \\frac{(1-c)^2}{t}\\right)$ is a parabola. Its bottom sits at $c^* = \\frac{p_k}{p_k + t}$, and Benktander’s $c = p_k$ is nearly always close.',
      preset: 'example1',
    },
    {
      title: 'What t actually is',
      text: 'Assess three variances an actuary can defend (the true ultimate, the prior, the payout noise) and $t$ falls out. High noise pushes $t$ up (trust the prior); low noise pulls it down (trust the ladder).',
      preset: 'example2',
    },
    {
      title: 'The regime map',
      text: 'Figure 1: above $t = 2 - p_k$ plain BF wins; below $t = \\frac{p_k q_k}{1+p_k}$ (never more than 1/6) chain ladder wins. The whole middle belongs to Benktander. Find your portfolio on the map.',
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
      title: 'Belief before data',
      text: 'The prior is a full distribution over the true ultimate $U$, not a number. Its spread $\\sqrt{Var(U)}$ is a statement of how little the premium calculation really knows.',
      preset: 'normal',
    },
    {
      title: 'The data votes',
      text: 'Paid-to-date $C_k$ points at $C_k/p_k$ (chain ladder), but with noise $\\beta$. The likelihood curve is how loudly the data votes. Watch it sharpen as $\\beta$ falls.',
      preset: 'noisy-data',
    },
    {
      title: 'The compromise, exactly',
      text: 'Gogol\'s lognormal model gives the exact posterior. With the Correction Note applied, $E[R|C_k] = 51.9\\%$, sd $18.9\\%$, and $z = 0.782$. Nearly identical to Benktander\'s free answer.',
      preset: 'gogol',
    },
    {
      title: 'Who wins, and why',
      text: '$z$ is a ratio of variances: prior spread against data noise. Confident prior or noisy data, either one pulls the posterior home. There is no judgment call left once the variances are set.',
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
  title: 'The Distribution Zoo',
  subtitle: 'Exam edition: the shapes the papers assume but never draw',
  icon: 'spline',
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
      title: 'Two ranges, one pair of moments',
      text: 'Mack computes a mean and a standard error, then needs a DISTRIBUTION to quote percentiles. Normal and lognormal agree on both moments and still disagree about the tail you care about.',
      preset: 'ranges',
    },
    {
      title: 'The quasi-distribution',
      text: 'ODP is not in any textbook table because it is a variance ASSUMPTION, $Var = \\phi\\mu$, wearing a Poisson costume. The lattice spacing IS $\\phi$. Now you have seen it.',
      preset: 'odp',
    },
    {
      title: 'Skew you can dial',
      text: 'Gamma at shape $k=1$ is exponential; by $k=16$ it is almost symmetric. GLM error families are a choice of how variance scales with the mean.',
      preset: 'gamma',
    },
    {
      title: 'Poisson with doubt',
      text: 'Give the Poisson rate a gamma prior and the mixture is negative binomial. Verrall builds the whole chain ladder out of this object.',
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
  title: 'The Validation Machine',
  subtitle: 'p-p plots, the KS band, and how Meyers retires bad models',
  icon: 'badge-check',
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
      title: 'Score the whole distribution',
      text: 'For each of $n$ insurers, ask: at what percentile of the model\'s predictive distribution did the ACTUAL outcome land? A correct model has no opinion about where: the percentiles must come out uniform.',
      preset: 'uniform',
    },
    {
      title: 'The shapes of being wrong',
      text: 'Each defect has a signature. Too light-tailed piles percentiles at 0 and 100; too heavy-tailed crowds the middle; bias slides everything to one side. Figure 3.1 is a field guide. Walk the presets.',
      preset: 'light',
    },
    {
      title: 'The bar every model must clear',
      text: 'The Kolmogorov-Smirnov band is $136/\\sqrt{n}$: 19.2 at $n{=}50$, 9.6 at $n{=}200$. Meyers held Mack and bootstrap ODP to it across 200 triangles; Mack-on-incurred came in at $D = 15.4$ combined and was rejected.',
      preset: 'biased',
    },
    {
      title: 'Why n matters',
      text: 'Push $n$ up and the band tightens while the picture sharpens: a defect invisible at $n{=}50$ is unmistakable at $n{=}400$. Validation is a sample-size game, which is why the CAS database of 200 triangles exists at all.',
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
  title: 'The Settlement-Rate Story',
  subtitle: 'Why paid-data models failed validation, and how CSR names the culprit',
  icon: 'fast-forward',
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
      title: 'One curve or a family',
      text: 'Every fixed-pattern method assumes the payout curve is shared across accident years. CSR adds one parameter: $\\beta_d$ is scaled by $(1-\\gamma)^{w-1}$, so each successive year walks its own curve.',
      preset: 'crc',
    },
    {
      title: 'What the data said',
      text: 'On the illustrative insurer, the posterior put $\\gamma$ at $0.0446 \\pm 0.0282$: a real speedup. Drag $\\gamma$ through the posterior strip and watch the fan open.',
      preset: 'posterior',
    },
    {
      title: 'The bias mechanism',
      text: 'Average one pattern across all years and apply it to the newest: when settlement sped up, the newest year\'s early payments are a BIGGER share of its ultimate than the average admits, so the naive projection overstates it. The bars show the gap lag by lag.',
      preset: 'strong',
    },
    {
      title: 'Why beta_10 = 0 matters',
      text: 'With $\\beta_{10} = 0$, every year\'s share reaches 100% at lag 10 whatever $\\gamma$ is, so the CSR ultimate calculation is formally identical to CRC. Gamma changes the JOURNEY, not the destination. That is precisely why it repairs paid-data validation without touching the ultimate\'s definition.',
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
  title: 'Watching The Posterior Form',
  subtitle: 'What Stan actually does with those 10,000 draws',
  icon: 'route',
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
      text: 'The CSR posterior lives in ~24 dimensions with no closed form. MCMC never needs one: it only ever COMPARES the posterior density at two points, and that ratio is computable. Stan does this; JAGS did before it.',
      preset: 'tuned',
    },
    {
      title: 'The walk itself',
      text: 'From the current $\\theta$, propose $\\theta\' = \\theta + s\\varepsilon$. If the posterior is higher there, go; if lower, go with probability $\\pi(\\theta\')/\\pi(\\theta)$. The chain starts far out in the tail. Watch it find the ridge, then stay.',
      preset: 'tuned',
    },
    {
      title: 'A table row is a histogram',
      text: 'Table 7.1 prints logelr $-0.3956\\;(0.0246)$. That row IS the histogram forming on the right, summarized. Every estimate, SE, and percentile in the monograph is a statistic of draws like these.',
      preset: 'tuned',
    },
    {
      title: 'Tuning is a real problem',
      text: 'Timid steps accept everything and learn nothing; reckless steps reject everything and learn nothing. Efficiency peaks in between, which is why Stan tunes itself during warmup, and why "burn-in" draws get discarded.',
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
  title: 'Mack\'s Machinery',
  subtitle: 'The RAA triangle, three estimators, and where the standard errors come from',
  icon: 'layers',
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
      title: 'Three chain ladders',
      text: 'All three factor sets are least-squares answers under different variance laws: weight by $C_k^2$, by $C_k$, or not at all. At $k=1$ they answer 2.217, 2.999, and 8.206. By $k \\geq 6$ they agree. Maturity is what settles arguments.',
      preset: 'chain-ladder',
    },
    {
      title: 'Variance bookkeeping',
      text: 'Each projection step contributes $\\tfrac{\\hat{\\alpha}_k^2}{\\hat{f}_k^2}(\\tfrac{1}{\\hat{C}_{ik}} + \\tfrac{1}{\\sum C_{jk}})$: process noise plus estimation error. The ribbon around the focus year is that sum accumulating, age by age.',
      preset: 'chain-ladder',
    },
    {
      title: 'The number that matters',
      text: 'Accident year 9 carries a reserve of 10,650 with standard error 6,333: a 59% coefficient of variation. Every year in this triangle is at or above 41%. A point estimate without that number is not an answer.',
      preset: 'chain-ladder',
    },
    {
      title: 'Quoting a range',
      text: 'Mack matches a lognormal to $(\\hat{R}, se)$: the 90th percentile is 86,298 while the normal would say almost the same. The 10th percentiles disagree badly (24,871 vs 17,672). His verdict: there is no general rule; check both.',
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
  title: 'Clark\'s Growth Curves',
  subtitle: 'Two parameters replace a factor table, and the tail becomes a choice you can see',
  icon: 'chart-spline',
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
      title: 'Name the curve',
      text: 'Fifty-five increments, two parameters, one likelihood. $G(x)$ IS the payout pattern, defined at every age at once, so odd evaluation dates and partial years stop being special cases.',
      preset: 'loglogistic',
    },
    {
      title: 'The tail is a family argument',
      text: 'Loglogistic and Weibull both fit the observed increments well. Then the loglogistic pays 1.295 on the oldest year while the Weibull pays 1.052. Nothing in the triangle settles this. That is the point.',
      preset: 'weibull',
    },
    {
      title: 'Truncation as discipline',
      text: 'Clark caps development at 240 months: reserve to the cap, and the shaded tail beyond it (6.65M here) becomes an explicit, separately-argued item instead of an extrapolation nobody reviewed.',
      preset: 'loglogistic',
    },
    {
      title: 'Same curve, sturdier method',
      text: 'The Cape Cod variant divides reported losses by used-up premium: ELR = 59.78%. Immature years lean on the premium instead of their own thin diagonal, which is why Clark recommends it for the actual reserve.',
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
  title: 'The Bootstrap, Live',
  subtitle: 'Resample the residuals, refit the ladder, watch a reserve distribution exist',
  icon: 'dices',
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
      title: 'What a residual pool is',
      text: 'Fit the ODP chain ladder and every observed increment leaves a standardized residual $r = (q-m)/\\sqrt{m}$. Fifty-five of them, assumed exchangeable. That exchangeability IS the bootstrap\'s assumption, which is why Shapland spends a whole chapter diagnosing it.',
      preset: 'full',
    },
    {
      title: 'Manufacture a world, price it',
      text: 'Draw 55 residuals with replacement, rebuild a pseudo-triangle around the fitted means, refit the ladder, project, and add gamma process noise cell by cell. One iteration, one plausible total. Watch them pile up.',
      preset: 'full',
    },
    {
      title: 'Where the width comes from',
      text: 'Kill the process draws and the distribution narrows: parameter error alone. The correction $\\sqrt{n/(n-p)}$ matters too; without it the pool understates the noise the model consumed fitting 19 parameters.',
      preset: 'param',
    },
    {
      title: 'The deliverable',
      text: 'Mean, cv, 95th, 99th, TVaR: every number in Shapland\'s exhibits is a statistic of this histogram. The point estimate you started with is just one line through it.',
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
  title: 'The Same Answer Twice',
  subtitle: 'The chain ladder is a GLM: marginal sums, cross-classified, cell for cell',
  icon: 'equal',
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
      title: 'The folklore algorithm',
      text: 'Volume-weighted factors on the workers comp triangle: $\\hat{f}_1 = 1.815$ down to $\\hat{f}_9 = 1.021$, projecting a total reserve of 373,346. Nothing here looks like a statistical model. Yet.',
      preset: 'reconcile',
    },
    {
      title: 'Row and column balances',
      text: 'Model each cell as ODP with mean $\\alpha_k\\beta_j$. Maximum likelihood reduces to marginal sums: each row parameter balances its row, each column parameter its column. Solved, $\\hat{\\alpha}_k$ IS the chain-ladder ultimate and $\\hat{\\beta}_j$ the incremental payout share.',
      preset: 'reconcile',
    },
    {
      title: 'Cell for cell',
      text: 'Taylor checks 1996 development 3: $92{,}242 \\times 1.261$ gives $\\hat{Y} = 24{,}070$, and $173{,}225 \\times 0.139 = 24{,}070$. Move the sliders anywhere in the future triangle; the max-gap readout stays at zero.',
      preset: 'reconcile',
    },
    {
      title: 'Why you should care',
      text: 'Once the chain ladder is a GLM, it stops being folklore: Table 5-1 hands you standard errors (U-shaped in accident year, exploding in the tail), residual diagnostics catch broken assumptions, and Chapters 4-6 extend the model instead of the ritual.',
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
  title: 'The Risk Margin Ladder',
  subtitle: 'Three sources of uncertainty, one consolidated CoV, one defensible margin',
  icon: 'gauge',
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
      title: 'Three kinds of not knowing',
      text: 'Independent risk averages out across classes. Internal systemic risk (your model\'s own specification, parameters, data) does not. External systemic risk (inflation, courts, events, latency) does not either. The framework refuses to blend them.',
      preset: 'base',
    },
    {
      title: 'Variances add, CoVs do not',
      text: '3.0, 4.9, and 6.6 consolidate to 8.7, not 14.5. Squaring before adding is the entire mathematics of diversification, and the bars show what it forgives.',
      preset: 'base',
    },
    {
      title: 'Correlation is the price',
      text: 'Push the internal correlations to full and the internal CoV climbs from 4.9% toward 6.7%, dragging the margin to 6.3%. There is no diversification credit without a defended correlation assumption.',
      preset: 'full-corr',
    },
    {
      title: 'The margin is a percentile',
      text: 'At 75% probability of adequacy, $z = 0.6745$ of a lognormal around the central estimate: 5.6%. Slide the adequacy up and watch prudence get expensive nonlinearly.',
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
.cl-story {
  display: flex;
  align-items: flex-start;
  gap: var(--px-space-3);
  padding: var(--px-space-2) var(--px-space-4);
  border-bottom: 1px solid var(--px-divider);
  background: var(--px-bg-inset);
  flex: 0 0 auto;
}
.cl-story-nav {
  display: flex;
  align-items: center;
  gap: var(--px-space-1);
  padding-top: 3px;
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
  flex: 1 1 auto;
  min-width: 0;
  font-size: var(--px-text-sm);
  color: var(--px-text-secondary);
  line-height: var(--px-leading-base);
  animation: cl-fade-rise var(--px-dur-base) var(--px-ease-out);
}
.cl-story-text .cl-story-step-title {
  font-weight: 600;
  color: var(--px-text);
  margin-right: var(--px-space-2);
}
.cl-story-text .px-markdown { display: inline; }
.cl-story-text .px-markdown p { display: inline; margin: 0; }
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
  border-right: 1px solid var(--px-divider);
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
  align-items: center;
  gap: var(--px-space-6);
  padding: var(--px-space-3) var(--px-space-4) var(--px-space-4);
  border-top: 1px solid var(--px-divider);
  flex: 0 0 auto;
  overflow-x: auto;
}
.cl-formula-sym {
  color: var(--px-text-muted);
  font-size: var(--px-text-sm);
  flex: 0 0 auto;
}
.cl-formula-sym .px-markdown p { margin: 0; }
.cl-terms { display: flex; align-items: center; gap: var(--px-space-2); flex: 0 0 auto; }
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

/* ── Sidebar ────────────────────────────────────────────────────────── */
.cl-side { display: flex; flex-direction: column; gap: 2px; padding: var(--px-space-2); }
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
      fresh: true,
    };
    _paneState.params[mod.id] = st;
  }
  return st;
}

// --- Scene renderers (registered by module id; defs stay declarative) ------

const SCENE_BUILDERS = {
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
  sub.textContent = 'The syllabus, made visible. Every module is grounded in its paper’s own worked example. Drag the parameters and watch the mechanics move.';
  home.appendChild(title);
  home.appendChild(sub);
  const cards = document.createElement('div');
  cards.className = 'cl-cards';
  let i = 0;
  for (const mod of MODULES) {
    const card = document.createElement('div');
    card.className = 'cl-card';
    card.style.animationDelay = (i * 50) + 'ms';
    const head = document.createElement('div');
    head.className = 'cl-card-head';
    const icon = document.createElement('span');
    icon.className = 'cl-card-icon';
    icon.innerHTML = clIcon(mod.icon || 'line-chart', 18);
    const t = document.createElement('span');
    t.className = 'cl-card-title';
    t.textContent = mod.title;
    head.appendChild(icon); head.appendChild(t);
    const s = document.createElement('div');
    s.className = 'cl-card-sub';
    s.textContent = mod.subtitle;
    const paper = document.createElement('div');
    paper.className = 'cl-card-paper';
    paper.textContent = mod.paper.label;
    card.appendChild(head); card.appendChild(s); card.appendChild(paper);
    card.addEventListener('click', () => {
      _paneState.route = { view: 'module', moduleId: mod.id };
      _paneRerender?.();
    });
    cards.appendChild(card);
    i++;
  }
  home.appendChild(cards);
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
  chip.innerHTML = `<span class="cl-chip-icon">${clIcon('book-open', 12)}</span>`;
  const chipText = document.createElement('span');
  chipText.textContent = `${mod.paper.label} · ${mod.paper.section}`;
  chip.appendChild(chipText);
  chip.title = mod.paper.task;
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
  story.appendChild(storyText);
  root.appendChild(story);
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
  const formulaBar = document.createElement('div');
  formulaBar.className = 'cl-formula-bar';
  stageCol.appendChild(stageRow);
  stageCol.appendChild(formulaBar);
  body.appendChild(rail);
  body.appendChild(stageCol);
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
  rail.appendChild(readoutSection);

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

  function applyStory(i) {
    if (i < 0 || i >= mod.story.length) return;
    st.storyIndex = i;
    const step = mod.story[i];
    dots.forEach((d, j) => d.classList.toggle('cl-active', j === i));
    prevBtn.disabled = i === 0;
    nextBtn.disabled = i === mod.story.length - 1;
    storyText.innerHTML = '';
    const title = document.createElement('span');
    title.className = 'cl-story-step-title';
    title.textContent = (i + 1) + '. ' + step.title;
    storyText.appendChild(title);
    storyText.appendChild(clMd(step.text));
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
    const step = mod.story[st.storyIndex];
    if (step) {
      storyText.innerHTML = '';
      const title = document.createElement('span');
      title.className = 'cl-story-step-title';
      title.textContent = (st.storyIndex + 1) + '. ' + step.title;
      storyText.appendChild(title);
      storyText.appendChild(clMd(step.text));
    }
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
  for (const mod of MODULES) {
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
    const moduleList = MODULES.map((m) =>
      `${m.id} ("${m.title}", ${m.paper.label}; presets: ${m.presets.map((p) => p.id).join('/')}; params: ${m.params.map((p) => p.key).join('/')})`,
    ).join('; ');
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
  MODULES,
  clGetModule,
};
