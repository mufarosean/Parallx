# Parallx Milestone 100 — Concept Lab: The Stats-To-Reserving Ladder

> **Status: CURRICULUM BUILT** (2026-08-16, branch `m100-concept-lab`).
> Phase 2 shipped the full ladder: 25 modules across 7 levels — 13 new
> concept modules (Random Variables; Mean, Variance & Skewness; PDF, CDF
> & Quantiles; Aggregate Losses & The CLT; Conditional Expectation;
> Correlation & Diversification; Loss Development As A Process; Maximum
> Likelihood Estimation; Process vs Parameter Risk; Credibility &
> Shrinkage; Generalized Linear Models; Pearson Residuals) plus Meyers:
> CCL & CSR (the validate-diagnose-fix arc with CCL width and CSR bias
> made quantitative), with the 12 phase-1 exhibit modules re-leveled and
> renamed to explicit exam names (Brosius/Mack/Meyers/Clark/Shapland/
> Marshall/Taylor prefixes) as the top rung. Feel-check round 1: titles
> use standard stats or exam vocabulary (evocative names rejected); the
> story moved from a top strip to a LEFT COLUMN with the controls rail
> on the right (read the step, look at the stage, reach for the dials).
> Round 2: formula + readouts joined the story column (one understanding
> surface). Round 3, the no-background pass: probability itself defined
> from first principles on the first rung; a new buckets-to-curve bars
> mode in PDF/CDF teaches area-equals-probability (the discrete →
> continuous bridge); Bayes opens with an everyday compromise before
> Gogol; MCMC motivation in plain words; every exam module now opens on
> a "The question first" step framing the concept before the exhibit
> (each reuses the module's original first preset, so mount behavior is
> unchanged); insurance vocabulary (accident year, ultimate) defined at
> first use. Framework additions: LEVELS + home ladder,
> Builds On / Where The Exam Uses This link rails (every link
> test-verified to resolve; concept modules without bridges fail
> hygiene), predict-then-reveal story steps, level-grouped sidebar,
> concept-module level chips. 242 concept-lab tests green (184 module
> checks: printed exhibits for exam modules, identities + seeded
> simulation invariants for concept modules; jsdom behavioral walks cover
> the ladder, predicts, connections, Meyers arc, GLM modes).
> PENDING: in-app verification by Mufaro (never rendered on screen).

## The ask (Mufaro, 2026-08-16, second pass)

First pass produced interactive exhibit reproductions. His correction,
verbatim intent:

- "I was expecting something that functions more like a teaching visual.
  These all seem like exhibits more than anything."
- "I see nothing on GLMs in here. Or the Meyers models that he compares."
- "Can we teach all of stats theory using this thing? Let's not half-ass
  it. We focus on what's required to know as prerequisites for the exam,
  but we build from the bottom: probability, random variables, random
  processes, MLE, distributions, Bayesian theory, GLMs. When we get to
  points where the exam material is building from these stats concepts, we
  call it out, we make the connection, so it does not feel like a user is
  stranded."
- "My intention was to allow a visual connection from basic stats to the
  advanced reserving concepts in Exam 7."

The judgment rule he expected: go **general-statistics** when the papers
*assume* background (what a GLM is, likelihood, what a posterior means,
why residuals, why correlation fattens tails); go **exam-direct** when the
syllabus item *is* the technique (Mack's SE formulas, Clark's curves, the
bootstrap procedure). Exhibits are the payoff at the END of a concept's
arc, never the whole module.

## The curriculum (seven levels)

Every module belongs to a level. Concept modules teach; exam modules apply.
Both use the same engine (params / derived / readouts / formula / presets /
story / checks). Concept modules' checks verify mathematical identities and
seeded-simulation invariants instead of printed exhibits — same gate, same
rigor.

**The connective tissue** (the anti-stranding mechanism):
- `foundations`: links UP the ladder — "this module stands on these
  concepts". Rendered as "Builds On" chips; one click opens the concept.
- `bridges`: links DOWN the ladder — "here is exactly where Exam 7 uses
  this". Rendered as "Where The Exam Uses This" chips.
- The recurring visual motif is **the fan**: a partially observed loss
  process and the distribution of its futures. Level 3 introduces it;
  Mack quantifies it analytically, Shapland simulates it, Meyers audits
  it. Same picture, four computations.

### Level 1 — Probability & Random Variables

| Module | Teaches | Scene | Exam bridges |
| --- | --- | --- | --- |
| `random-variable` (NEW) "The Claim Counter" | Random variable as a mapping; LLN: empirical frequency → probability | Draw claims one at a time or in bursts; histogram converges onto the true PMF; running mean walks to E[X] | Every reserve is a statement about a random variable's distribution |
| `mean-machine` (NEW) "The Balance Point" | E[X] as center of mass, variance as spread, skewness; why loss distributions lean right | Draggable probability masses on a beam; the beam tips and balances live; identity E[X²]−E[X]² shown | Best estimate = mean; ranges exist because variance does |
| `distribution-anatomy` (NEW) "One Distribution, Three Views" | PDF ↔ CDF ↔ quantile are the same object; percentiles; tail probability | Three linked panels of one lognormal; drag the probability level on the CDF and the quantile slides; shaded tails | Reserve ranges are quantiles; Meyers' validation asks whether outcomes' percentiles are uniform |
| `dist-zoo` (existing, re-leveled) | The working distributions: Normal, Lognormal, Poisson, ODP, Gamma, NegBin; variance-to-mean | (shipped) | ODP is Shapland's error family; NegBin is Poisson with a Gamma prior (Bayesian bridge) |

### Level 2 — How Randomness Behaves

| Module | Teaches | Scene | Exam bridges |
| --- | --- | --- | --- |
| `sums-clt` (NEW) "Adding Up Claims" | Compound sums S = X₁+…+X_N; CLT and where heavy tails break it; compound Poisson mean/variance | Severity curve → animated draws stack into the aggregate histogram; Normal overlay; tail-gap readout | Aggregate reserves; compound Poisson-Gamma IS Tweedie, the guts of the ODP variance story |
| `conditional-expectation` (NEW) "The Best Guess" | E[Y\|X] as a function; regression as sliced means | Bivariate cloud of (reported, ultimate); draggable vertical slice shows the conditional density and its mean; the traced curve IS the regression line | Brosius' development formula is E[Y\|X] approximated by a line |
| `correlation` (NEW) "When Risks Move Together" | Covariance, ρ, and what correlation does to the SD of a total; diversification | Two lines of business; ρ slider reshapes the cloud and widens the total's distribution; √(σ₁²+σ₂²+2ρσ₁σ₂) live | Marshall's aggregation of systemic risks; Meyers CCL thickens tails with exactly this |

### Level 3 — Random Processes

| Module | Teaches | Scene | Exam bridges |
| --- | --- | --- | --- |
| `process-fan` (NEW) "The Fan Of Futures" — the hero | A process is a path; conditioning on the observed past; the reserving problem stated visually; Mack's assumption E[C_{k+1}\|past]=f·C_k | Simulated development paths pour across the stage; drag the "today" line and the fan re-conditions; endpoint histogram = the reserve distribution | This IS reserving. Mack computes the fan's width analytically; Shapland bootstraps it; Meyers audits whether it was honest |

### Level 4 — Estimation & Likelihood

| Module | Teaches | Scene | Exam bridges |
| --- | --- | --- | --- |
| `likelihood-surface` (NEW) "Let The Data Vote" | Likelihood as the data scoring parameters; MLE; log-likelihood | Observed losses on an axis; candidate density overlaid; each point's density-height bar is its vote; ℓ(μ,σ) contour with a draggable candidate and a Find MLE ascent | Clark fits G(x; ω, θ) by exactly this machine over the triangle |
| `sampling-error` (NEW) "Process vs Parameter Risk" | One truth, many datasets: estimates scatter (parameter risk); outcomes scatter around estimates (process risk); the two add | Repeat-the-experiment animation; two spread bands accumulate; Var(x̄)=σ²/n live | Mack's mse = process + estimation error, term by term; Clark's split; Shapland's √(n/(n−p)) exists because residuals understate σ |

### Level 5 — Bayesian Theory & Credibility

| Module | Teaches | Scene | Exam bridges |
| --- | --- | --- | --- |
| `prior-posterior` (existing, restructured) | Belief as a distribution; posterior ∝ prior × likelihood; data volume sharpens | (shipped; story gains a teach-first arc, Gogol stays as payoff presets) | Gogol's method IS this with lognormals |
| `shrinkage` (NEW) "Credibility Is Shrinkage" | Pooling: raw per-class estimates scatter; shrinking toward the grand mean beats raw at optimal Z=n/(n+k) | Many classes, few observations each; Z slider slides estimates toward the grand mean; out-of-sample error valley bottoms at Bühlmann Z | Brosius Z=VHM/(VHM+EPV); Mack 2000 c*=p/(p+t); Benktander = iterated credibility (mse-valley) |
| `mcmc-watch` (existing, restructured) | Why sampling: no formula for this posterior; the histogram IS the answer | (shipped; motivation front added) | Meyers' models are fit by exactly this |

### Level 6 — Regression & GLMs

| Module | Teaches | Scene | Exam bridges |
| --- | --- | --- | --- |
| `glm-anatomy` (NEW) "The GLM, Piece By Piece" | Linear predictor η=Xβ; link g(μ)=η; error family; variance function V(μ)=φμ^p; overdispersion φ | Three linked panels: η line → link curve bends it into the mean curve → family cloud at a draggable probe with variance envelope; p dial morphs Normal(0)→ODP(1)→Tweedie(1.5)→Gamma(2) | Shapland's ODP model is THIS: log link, V(μ)=φμ on incremental losses; Taylor: that GLM's MLE = chain ladder exactly |
| `residual-lens` (NEW) "Reading Residuals" | Raw residuals funnel when V(μ) is wrong; Pearson r=(y−μ)/√V(μ) standardizes; residuals carry the model's leftover truth | Fitted-vs-residual panel; family toggle makes the funnel appear/vanish; standardization animates | Shapland resamples EXACTLY these Pearson residuals; Venter reads these plots on triangles |

### Level 7 — The Reserving Problem (Exam 7)

Existing exhibit modules, re-leveled with `foundations` links and stories
tightened to open from the concept, not the table: `brosius-line`,
`mse-valley`, `validation-machine`, `csr-story`, `mack-machinery`,
`clark-curves`, `odp-bootstrap`, `marshall-ladder`, `glm-equals-cl`.

| Module | Foundations |
| --- | --- |
| `brosius-line` | conditional-expectation, shrinkage |
| `mse-valley` | shrinkage, sampling-error |
| `meyers-arc` (NEW) "Meyers' Model Ladder" | validation-machine, correlation, process-fan |
| `validation-machine` | distribution-anatomy (percentiles) |
| `csr-story` | process-fan |
| `mack-machinery` | process-fan, sampling-error |
| `clark-curves` | likelihood-surface |
| `odp-bootstrap` | residual-lens, sampling-error |
| `marshall-ladder` | correlation |
| `glm-equals-cl` | glm-anatomy |

**`meyers-arc` (NEW)** is the missing model-comparison narrative: validate
Mack on incurred → tails too thin → LCL → CCL (ρ widens the predictive
distribution, the p-p plot straightens) → paid side biased high → CSR.
Scene: model ladder selector; predictive density with outcome markers on
the left, live p-p plot on the right. Reuses the validation kernel; adds a
correlated-lognormal CCL simulator with the sum-SD identity checked.

## Framework additions

1. **LEVELS** array + `level`, `kind` (`concept`/`exam`), `foundations`,
   `bridges` on module defs. Hygiene tests: every module has a valid
   level; every link resolves to a real module id.
2. **Connections strip** in the module view: "Builds On" and "Where The
   Exam Uses This" chip rows; chips carry one-line explanations and open
   the target module in the pane (route swap, no new editor).
3. **Home = the ladder.** Level sections in order, each with number,
   title, tagline, and its module cards; concept cards show their level,
   exam cards keep the paper line. Sidebar groups by level.
4. **Predict-then-reveal.** Story steps may carry
   `predict: {prompt, options, answer, explain}`: the step asks BEFORE it
   moves the parameters; the learner commits to an option; the reveal
   applies the preset and explains. Answered state persists per module.
5. Header chip: exam modules keep the paper chip; concept modules show
   their level chip.
6. `conceptLab_open` tool description already enumerates modules
   dynamically; it inherits all of this for free.

## Design principles (unchanged from phase 1, plus one)

1. Guide attention: every module opens on a curated moment.
2. Direct manipulation, instant feedback; control of time where time exists.
3. **Checks or nothing**: exam modules reproduce printed exhibits; concept
   modules verify identities and seeded-simulation invariants.
4. Formula ↔ picture hover linkage everywhere.
5. Premium motion, zero chartjunk, tokens only.
6. **NEW — teach, then formalize**: motivate → predict → play → formalize
   → exam payoff. The formula arrives after the intuition, and the exam
   connection is explicit at the end of every concept.

## Verification gate

- All existing 157 checks stay green; every new module ships checks.
- Behavioral walk (jsdom, real `activate()`) extended to every new module
  and the predict widget.
- Full suite green; design-gate sweep (no hex, no em dashes in UI copy,
  Title Case labels, registry icons only).
- PENDING: in-app verification by Mufaro (never rendered on screen here).

## Backlog (explicitly deferred)

CAY correlation module (Meyers §8); Venter residual tests as their own
module; module deep-links from canvas/flashcards; progress marks on the
ladder.
