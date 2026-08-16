# Parallx Milestone 100 — Concept Lab (Interactive Exam Explorables)

> **Status: BUILT** (2026-08-16, branch `m100-concept-lab`). Framework + 12
> modules: The Credibility Line (Brosius), The MSE Valley (Mack 2000),
> Prior To Posterior (Gogol corrected), The Distribution Zoo, The
> Validation Machine (Meyers §3), The Settlement-Rate Story (CSR §7),
> Watching The Posterior Form (MCMC), Mack's Machinery (RAA, digit-exact
> SEs), Clark's Growth Curves, The Bootstrap Live (Shapland/Taylor-Ashe,
> CL 18,680,856 exact), The Risk Margin Ladder (Marshall, all four printed
> flexes reproduce), The Same Answer Twice (Taylor GLM=CL theorem verified
> to 1e-9). Plus the conceptLab_open chat tool (the instructor SHOWS).
> 157 concept-lab tests (printed-exhibit checks + jsdom behavioral walks
> driving the real activate()); full suite 5,181 green. Design gates swept.
> PENDING: in-app verification by Mufaro (never rendered on screen).
> Backlog: CAY correlation module (Meyers §8); Venter residual tests;
> module deep-links from canvas/flashcards.

## The ask (Mufaro, 2026-08-16)

The Exam 7 syllabus is drowning in theory nobody can picture: GLM forms,
prior/posterior mechanics, credibility mixtures, what an over-dispersed
Poisson even looks like. Study guides and source papers offer zero visual,
zero interactive reference, so the formulas never stick. Build an interactive
surface that maps the exam's statistical machinery to live graphs — sliders,
charts that shift in real time, the mechanics of the formulas made visible.

Hard requirements, in his words:
- "It needs to feel premium and not like AI slop. It needs to feel powerful,
  and to clearly show these relationships."
- Real examples — grounded in the papers, "the Meyers paper could benefit a
  whole lot from this."
- "The more flexible we make the framework, the more we can allow the user
  to interact with the concepts… build a more intuitive understanding
  instead of just memorizing formulas."
- Generic substrate discipline still applies: the framework is a generic
  explorable engine; Exam 7 modules are its first tenant content.

## Design principles (research-backed)

From the explorable-explanations literature (Bret Victor's reactive
documents; Seeing Theory; chi-feng's MCMC gallery):

1. **Guide attention.** An explorable is not a widget dump — each module is
   a short guided story that introduces small parts first, then lets them
   play together. Every module opens on a curated "moment," not a wall of
   sliders at defaults.
2. **Direct manipulation, instant feedback.** Drag a parameter, the picture
   answers within the same frame. Give the user control of time where time
   exists (play/pause/step/speed on simulations).
3. **The paper's numbers or nothing.** Module defaults ARE the paper's own
   worked example, and every module ships machine-checkable `checks` that
   reproduce the printed exhibit values. A module that cannot recompute its
   paper's printed numbers does not ship. This is the exam-tie-in gate.
4. **Formula ↔ picture linkage.** Each module renders its governing equation
   with the CURRENT numeric values live beneath the symbols; hovering a term
   highlights the chart element it drives, and vice versa. This is the
   mechanism that "clearly shows the relationships" — not decoration.
5. **Premium motion, zero chartjunk.** Parameter changes tween through model
   space (the curve morphs, never snaps); slider drags are direct (rAF, no
   tween lag); presets animate. Subtle grid, token typography, categorical
   colors from theme chart tokens only. No 3D, no decorative gradients.

## What "premium" means concretely (the visual contract)

- **Stage layout per module:** control rail (left) with notation-labeled
  sliders + live values + preset "moment" chips; SVG stage (center) with one
  primary visualization; live formula panel (below the stage); story strip
  (top) with 3–5 guided steps; source line (paper, section, page, syllabus
  task chip) always visible.
- **Motion:** module-open choreography (axes fade in, curves draw in via
  stroke-dash, staggered ~40ms); param tweens ~240ms ease-out through
  PARAMETER space (recompute per frame from closed forms — geometry morphs
  correctly, no path cross-fade artifacts); app motion tokens for all
  durations/easings.
- **Ghost pins:** freeze the current curve as a muted labeled ghost, then
  keep exploring — visual A/B against any earlier configuration.
- **Crosshair readouts** with snap-to-notable-points (c*, Z, intersections,
  optima). Derived values tick (animated count) when they change.
- **Simulations** (MCMC, bootstrap, p-p sampling) run on a play/pause/step
  transport with speed control and a seeded RNG (mulberry32) so runs are
  reproducible and testable.
- Design-system gates (memory: these got violated in M98/M99 — run BEFORE
  commit): zero hex colors (chart colors from `--vscode-charts-*`), tokens
  for all spacing/type/radius, Title Case labels, ONE dropdown primitive,
  Lucide icons only, no emojis, dark/light/hc safe.

## Architecture

- **External extension `ext/concept-lab/`** (`parallx.concept-lab`), single
  `main.js` ESM — the flashcards pattern. Verified constraint (M99 + scout
  2026-08-16): external tools load as single-file blob-URL modules
  (toolModuleLoader.ts:196-210); no npm deps, everything hand-rolled inline.
  Concept Lab needs no deps: charts are hand-built SVG, math is closed-form
  + small simulations.

### Integration facts (scouted 2026-08-16)

- LaTeX: `api.ui.renderMarkdown` is the shared Markdown+KaTeX renderer
  (KaTeX CSS ships app-wide). Use it for story prose; the LIVE formula
  panel is hand-built token spans (KaTeX output is opaque to hover-linking).
- `api.ui` surface: rafThrottle, createDropdown, renderMarkdown,
  createAiButton, showContextMenu. NO slider — hand-roll
  `<input type="range">`; `.ui-slider` CSS classes ship globally.
- Colors: new code uses `--px-*` semantic tokens, never `--vscode-*`.
  `--vscode-charts-*` are UNDEFINED at runtime. Chart palette: scoped
  `--cl-*` vars reusing budget's CVD-validated ledger-ink set (sanctioned
  extension domain-data colors, Parallx_UI_System.md:28-33).
- Motion: `--px-dur-instant/fast/base/slow` (70/120/180/260ms),
  `--px-ease` (settle), `--px-ease-out` (enter), `--px-ease-spring` (pop).
  JS tweens read the tokens with numeric fallbacks.
- Ext editor panes DO support `saveViewState`/`restoreViewState`
  (EditorPaneHandle, parallx.d.ts:361-380) — flashcards main.js:4009 is the
  reference. Key data on `input.instanceId`, never parse `input.id`.
- Styles: ONE injected `<style>` guarded by a module flag (flashcards
  pattern). SVG `<text>` needs explicit font-family or Windows falls back
  to serif (budget main.js:3597).
- Tests: `export const __testables = {...}` from main.js; vitest imports the
  plain ESM file directly (flashcards.test.ts pattern); jsdom behavioral
  tier possible later (flashcardsBehavior.test.ts pattern).
- **One editor pane** (`conceptLab.editor`, instanceId `main`) with internal
  module navigation; a sidebar/launcher lists modules. Panes rebuild on tab
  switch — current module + param state live in module-level vars so a
  rebuild restores exactly (worksheet `_practice` pattern).
- **Framework core** (the flexibility ask — modules are declarative content):
  - `defineModule({ id, title, paper: {label, section, pages, task}, params,
    derived, scenes, story, presets, checks })`
  - params: `{ key, tex, label, min, max, step, init, fmt }` in the paper's
    own notation
  - render primitives: scales/axes, path builders (line/area/bars/points/
    ribbon), annotation layer (markers, arrows, region fills, boundary
    labels), formula renderer (token spans bound to params/derived, hover
    link ids), tween engine (one shared rAF loop), sim transport, ghost
    store.
  - `checks`: `[ { name, expect, got: (p) => number, tol } ]` — vitest
    imports `main.js` directly (flashcards test pattern) and runs every
    module's checks against the paper's printed values.
- **Math in plain JS, seeded and deterministic.** Normal/lognormal/Poisson/
  gamma/NB densities, quantiles where needed, least squares, credibility
  algebra, Metropolis sampler — all inline, all unit-tested.
- **No database** in v1 (nothing persists but view state). Chat tool
  (`conceptLab.open` — AI opens a module with specific parameter values) is
  a fast follow after the surface exists; it is the feature no study guide
  can match: the instructor SHOWS instead of tells.

## Module roadmap (each grounded in printed exhibit numbers already verified
## during the M-bank work; inventories in the session scratchpad)

**Phase A — framework + two flagship closed-form modules (prove the bar):**
1. **The Credibility Line** (Brosius). Scatter + least-squares line
   L(x) = a + bx morphing between budgeted loss (b=0), BF (parallel
   offset), and chain ladder (a=0) as Z moves; Z meter = VHM/(VHM+EPV).
   Presets: Table 1 State AA (b=0.968, a=6,023, L(40,490)=45,217);
   Poisson-Binomial world (Q(x)=x+2, Z=d); uniform-prior world (Z=1/3,
   L(x)=(2/3)x+8/3); the tort-reform story (Z=0.628 → $9.5M vs $8M link
   ratio / $12M budgeted / $9M BF).
2. **The MSE Valley** (Mack 2000 / Hürlimann / Benktander). Left: the
   mixing bar R_c = c·R_CL + (1−c)·R_BF with CL/BF/GB/c* stations. Right:
   mse(R_c) = E(α²)·q²·(c²/p + 1/q + (1−c)²/t) parabola with the marker at
   c* = p/(p+t). Second scene: Figure 1 regime map in (p_k, t) space with
   boundaries t = 2−p_k (BF above) and t = p_k·q_k/(1+p_k) (CL below) — drag
   your portfolio through the regions. Checks: Example 1 (t=0.346, c*=0.591,
   SEs 21.3/19.3/17.3/17.2) and Example 2, plus the regime thresholds.

**Phase B — the Bayesian core:**
3. **Prior → Posterior** (Brosius Bayesian sections; Mack 2000 §5 Gogol).
   Prior, likelihood, posterior densities; posterior mean sliding along
   [prior ↔ CL estimate] with the Z meter; normal-normal exact and the
   lognormal Gogol case. Checks: corrected Gogol numbers (z=0.782,
   E(R|C_k)=51.9%, sd 18.9% — the Correction Note values).
4. **Distribution Zoo, Exam Edition.** Normal vs lognormal on the same
   mean/SD (watch the 90% interval skew — Meyers' moment matching:
   σ² = ln(1+CV²), μ = ln(mean)−σ²/2); ODP as Poisson bars on the φ-lattice
   (same mean, Var = φμ — drag φ, overlay plain Poisson); gamma; negative
   binomial (Verrall's ODP twin).

**Phase C — the Meyers suite (his flagged priority):**
5. **The Validation Machine** (Monograph 8 §3). Choose truth, choose a model
   with defect sliders (bias, tail weight); outcomes sample in animated;
   percentiles accumulate into the histogram and p-p plot; KS band
   ±136/√n and D live. Presets reproduce the Figure 3.1 catalogue (Uniform
   D=5.2, Light-Tailed 22.3*, Heavy-Tailed 17.2*, Biased High 39.2*) and the
   real results (Mack incurred combined 15.4*, ODP paid 24.1*).
6. **The Settlement-Rate Story** (§7 CSR). Payment-pattern family
   β_d·(1−γ)^(w−1) bending as γ moves; the chain-ladder-vs-truth bias arrow;
   γ=0 collapses CSR→CRC; posterior strip from Table 7.1 (γ = 0.0446 ±
   0.0282) to drag through. Grounded in the Group 353 paid triangle.
7. **Watching the Posterior Form** (MCMC). chi-feng-style random-walk
   Metropolis on a 2D mini-posterior (logelr × σ): proposals accept/reject
   live, trace plot, marginals accumulating toward Table 5.1's
   logelr −0.3965 (0.0233); step-size slider with live acceptance rate;
   burn-in visual. Explains what "10,000 draws in Stan" actually does.

**Phase D — the rest of the syllabus's hard visuals:** Mack SE ribbons +
α² estimator toggles (Mack 1994, his triangle), Clark growth curves
(ω/θ, truncation, LDF vs Cape Cod), Shapland bootstrap (residual options →
reserve histogram), GLM=chain-ladder (Taylor — ODP+log link reproduces CL,
then break it), CAY correlation ρ widening the predictive, Marshall risk
aggregation (CoV sliders, diversification credit), Meyers risk margin
(cost-of-capital runoff).

## Verification

- `tests/unit/conceptLab.test.ts` imports `ext/concept-lab/main.js` and runs
  every module's `checks` (paper-exhibit reproduction) + math-kernel tests
  (densities vs known values, seeded sampler determinism, least squares,
  credibility algebra).
- Design-gate checklist pass before every commit (see above).
- Never launch the app visibly (dev machine = study machine): static
  analysis + vitest only; in-app verdict is Mufaro's.

## Landmines

- Extensions: single-file ESM, no `require`, no src/ imports, api may lack
  optional namespaces — guard. Portal/popup rules per design gates.
- Panes rebuild on tab switch — module-level state is the survival contract.
- npm not needed for this milestone (no deps). If it ever is:
  `NODE_OPTIONS=--use-system-ca npm install --ignore-scripts`.
