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
    /** Request a plain redraw frame outside any tween. */
    invalidate() { schedule(); },
    cancel(key) { tweens.delete(key); },
    dispose() { disposed = true; if (rafId) cancelAnimationFrame(rafId); tweens.clear(); smooths.clear(); },
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
    const d = { ...st.values, ...mod.derived(st.values) };
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
  clKsD,
  clKsBand,
  clPpPoints,
  MODULES,
  clGetModule,
};
