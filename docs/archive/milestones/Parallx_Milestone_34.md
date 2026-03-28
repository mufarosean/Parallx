# Milestone 34 — Retrieval Balance And Performance Rework

> Authoritative scope notice
>
> This document is the single source of truth for Milestone 34.
> All work that rebalances Parallx retrieval for latency, relevance, source
> quality, and prompt efficiency must conform to the findings, contract, and
> execution plan defined here.

---

## Table of Contents

1. Problem Statement
2. Product Goal
3. Current State Audit
4. Research Conclusions
5. Target Product Contract
6. Execution Plan
7. Task Tracker
8. Verification Checklist
9. Risks And Open Questions
10. References

---

## Problem Statement

Parallx retrieval is no longer suffering from only one problem.

The earlier framing of "retrieval performance" was too narrow. The real product
issue is **retrieval balance**.

Today the retrieval stack can still fail in four user-visible ways:

1. grounded turns can feel slower than the same model in raw Ollama because too
   much pre-answer work happens before streaming begins;
2. the system can still retrieve the wrong evidence class, including noisy
   workspace files or internal configuration artifacts, when the user needed a
   narrower source set;
3. context packing can overweight volume over precision, so the model receives
   too many merely-related chunks instead of the most decisive ones;
4. retrieval behavior is harder to reason about because candidate breadth,
   thresholding, source balancing, and structure expansion interact in ways that
   are individually defensible but not yet holistically tuned.

This means the product can feel both slower and less trustworthy than it should.

Milestone 34 is therefore not a micro-optimization pass. It is a retrieval
rebalance milestone.

---

## Product Goal

Parallx retrieval should become:

1. fast enough that grounded answers start streaming promptly;
2. selective enough that irrelevant sources rarely survive into the final
   prompt;
3. balanced enough that one noisy source or corpus class does not monopolize the
   answer;
4. explicit enough that we can explain why a source was included or excluded;
5. stable enough that product-level evals measure real quality rather than
   accidental corpus noise.

Concretely, the target contract is:

1. grounded turns retrieve fewer, better candidates;
2. low-value internal artifacts do not appear in normal user-facing grounded
   answers unless explicitly requested;
3. latency-heavy retrieval stages are justified by measurable quality gains or
   removed;
4. retrieval policy is tuned around user outcomes, not around isolated per-step
   heuristics;
5. live evals and deterministic tests validate both speed and evidence quality.

---

## Current State Audit

### Retrieval pipeline today

The current retrieval implementation lives primarily in
`src/services/retrievalService.ts`.

The active pipeline is more sophisticated than the older performance note
assumed:

1. query planning classifies complexity and can decompose harder questions into
   multiple query variants;
2. candidate breadth is adaptive via `candidateMultiplier` and per-query top-k
   sizing;
3. hybrid search results are post-processed through score thresholding, cosine
   reranking, second-stage rerank logic, diversity ordering, evidence-role
   balancing, source deduplication, and token-budget enforcement;
4. runtime defaults can be overridden by unified config through
   `IUnifiedAIConfigService`.

This means the retrieval system is capable, but its balancing is not yet proven
optimal.

### Key current defaults worth revisiting

The following defaults are still notable hotspots in the current code:

1. `DEFAULT_MIN_SCORE = 0.01`
2. `SIMPLE_OVERFETCH_FACTOR = 3`
3. `EXACT_OVERFETCH_FACTOR = 2`
4. `HARD_OVERFETCH_FACTOR = 5`
5. `DEFAULT_MAX_PER_SOURCE = 5`
6. cosine reranking remains enabled by default through
   `DEFAULT_MIN_COSINE_SCORE = 0.20`

Each of these can be reasonable in isolation. The milestone question is whether
their combination produces the right overall product behavior.

### Evidence of current imbalance

Recent work on transcript recall and memory routing exposed a broader retrieval
hygiene issue:

1. generic workspace retrieval can still surface internal or weakly relevant
   files such as `.parallx/ai-config.json` in normal answer contexts;
2. source caps and diversity logic can still leave final prompts dominated by a
   few verbose documents when better, narrower evidence exists;
3. transcript-specific questions showed that general retrieval can outcompete
   the intended evidence lane if source selection is not tightly constrained.

### Current architectural quirk: domain-shaped retrieval heuristics

The current retrieval service is also more product-shaped than a generic
retrieval layer should be.

`src/services/retrievalService.ts` currently contains a large
intent-aware source-boost section with hand-authored boosts and penalties for
specific query families such as:

1. agent contacts;
2. repair shops;
3. deductible questions;
4. claims filing;
5. total-loss thresholds;
6. insurance coverage decisions.

This has helped the demo workspace behave better, but it creates two important
risks:

1. retrieval quality is partly coming from corpus-specific heuristics rather
   than durable ranking principles;
2. it becomes harder to predict whether a future failure is caused by indexing,
   ranking, corpus shape, or one narrow boost rule.

Milestone 34 should treat that heuristic layer as something to audit and reduce,
not something to keep expanding casually.

### Why the old plan is insufficient by itself

`docs/ai/RETRIEVAL_PERFORMANCE_FIX_PLAN.md` correctly identifies real latency and
noise concerns, but it predates the current richer retrieval pipeline.

It is still useful as symptom documentation, but it is no longer sufficient as
the implementation spec because:

1. retrieval now has more tuning surfaces than just reranking and score
   thresholding;
2. some slowness/noise tradeoffs are now caused by interactions between planner
   breadth, structure expansion, and late-stage packing;
3. the product now needs corpus hygiene and evidence-lane isolation, not just a
   faster pipeline.

---

## Research Conclusions

The correct next retrieval milestone should optimize for **balance**, not only
for speed.

### Conclusion 1: latency matters, but only with evidence quality preserved

If we remove expensive retrieval stages but answer quality collapses, we did not
improve the product. Every latency reduction must be paired with a relevance and
honesty check.

### Conclusion 2: corpus hygiene is now a first-class retrieval concern

The model should not ordinarily retrieve Parallx internal files, configuration
artifacts, or other low-signal workspace noise unless the user explicitly asks
for them.

### Conclusion 3: candidate breadth must be tuned against outcome quality

Overfetch is not free. It increases latency, expands noise, and makes later
filter stages work harder. Candidate breadth should be justified by measured win
rates on hard queries, not just by defensive intuition.

### Conclusion 4: evidence lanes need stronger boundaries

Transcript recall, canonical memory recall, current-page context, and generic
workspace retrieval are different evidence lanes. When the user clearly asks for
one lane, the others should not quietly dominate the answer.

### Conclusion 5: retrieval observability must improve enough to make tuning
decisions cheap

We already have useful traces, but Milestone 34 should make it easier to answer:

1. what sources were considered;
2. what got dropped and why;
3. which corpus class won;
4. whether the final prompt was decisive or just large.

### Conclusion 6: OpenClaw is useful as a boundary model, not as a full retrieval template

OpenClaw is relevant here, but not because Parallx should copy its whole agent
runtime yet.

The useful retrieval lessons from current OpenClaw are:

1. memory retrieval is explicit and tool-shaped (`memory_search`,
   `memory_get`), not a hidden global prompt tax;
2. transcript/session recall is optional, bounded, and explicitly isolated from
   default memory behavior;
3. hybrid retrieval is configurable, but the result surface remains narrow:
   snippets, paths, lines, and scores rather than a giant automatic prompt dump;
4. background indexing is allowed to be slightly stale rather than blocking the
   user path.

Parallx should borrow those boundary principles, not the full OpenClaw
autonomous architecture at this stage.

### Conclusion 7: the best adjacent products separate retrieval strategies by evidence type

The comparative research suggests no single winning pattern across all evidence
types:

1. Aider uses a repository map to provide compact structural awareness and then
   asks for specific files, instead of relying on broad document-style RAG for
   code understanding;
2. Cline leans heavily on interactive search, mentions, active-file tracking,
   and explicit exploration rather than silently injecting a large generic
   retrieval payload;
3. Continue mixes several retrieval lanes, including FTS, embeddings,
   recently-edited files, reranking, and repo-map-based file selection.

The common theme is not "more retrieval." The common theme is
**lane-specific retrieval with bounded output**.

### Conclusion 8: repo summaries are often a better first-context surface than raw chunk retrieval

For code-heavy repositories, products like Aider and Continue use a repo map or
repo-map-guided file selection so the model first understands the structure of
the codebase before pulling full snippets.

That suggests Parallx should not force all workspace understanding through the
same chunk-retrieval path. A compact structural workspace surface may be a
better first step for some query classes than broad chunk injection.

### Conclusion 9: explicit search and exact-match tools are still part of a reliable retrieval system

Products such as Cline and Continue still preserve explicit exact-search paths
alongside semantic retrieval.

That matters because users trust AI more when:

1. exact names, numbers, config keys, and identifiers can be recovered
   deterministically;
2. the model can narrow its search surface instead of pretending semantic
   similarity is always enough.

---

## Target Product Contract

Milestone 34 establishes the following retrieval contract for Parallx.

### 1. Relevance-first retrieval

The final packed context should favor decisive evidence over broad thematic
similarity.

That means:

1. fewer weakly related chunks survive;
2. top evidence should usually come from the right source family;
3. retrieval should fail honestly when strong evidence is absent.

### 2. Corpus hygiene by default

Normal grounded retrieval should not surface low-value internal Parallx files or
other workspace implementation artifacts unless the user is explicitly asking
about those files.

### 3. Explicit lane boundaries

When a turn is clearly about:

1. transcript history,
2. canonical memory,
3. current page,
4. product semantics,

generic workspace retrieval should not override that lane unless the user is
also clearly asking a broader workspace question.

### 4. Balanced latency

Retrieval sophistication is acceptable only when it pays for itself. Slow stages
must earn their place with measurable answer-quality gains.

### 5. Tunable but sane defaults

Unified config should remain the override surface, but milestone defaults should
be strong enough that most users do not need to hand-tune retrieval.

### 6. Stable trust surface

Users should not feel that they need to open specific documents just to verify
whether Parallx grounded itself correctly.

That means:

1. retrieval should consistently surface the right evidence family for normal
   questions;
2. exact identifiers and narrow factual asks should resolve deterministically
   where possible;
3. noisy or internal artifacts should rarely appear in ordinary grounded turns.

---

## Execution Plan

### Phase A — Retrieval audit and measurement

- [x] Re-audit the current retrieval pipeline against the old performance fix
      note and identify which assumptions are now stale.
- [ ] Measure the current latency and packed-context profile for representative
      conversational, grounded, and hard-query turns.
- [ ] Enumerate the highest-frequency noisy source classes that survive into
      user-facing prompts.

### Phase B — Balance model redesign

- [x] Define retrieval lane precedence rules for transcript, memory,
      current-page, product-semantics, and generic workspace retrieval.
- [x] Define default corpus hygiene rules for internal Parallx files and other
      low-signal artifacts.
- [x] Revisit threshold and candidate-breadth defaults as one coordinated
      balance model rather than isolated constant tweaks.

### Phase C — Implementation

- [ ] Reduce avoidable candidate breadth and prompt noise in
      `src/services/retrievalService.ts`.
- [x] Harden source filtering so internal artifacts do not pollute normal
      grounded answers.
- [ ] Tighten evidence-lane isolation where explicit transcript or memory asks
      are being overshadowed by generic retrieval.
- [ ] Ensure retrieval traces remain useful after any simplification.

### Phase D — Validation

- [ ] Add focused unit coverage for the rebalanced retrieval defaults.
- [ ] Add deterministic coverage for source hygiene and lane precedence.
- [ ] Add or update live AI evals for latency-sensitive grounded turns and
      noisy-source regressions.
- [ ] Validate that grounded answer quality improves or stays flat while latency
      improves.

---

## Task Tracker

- [x] Create Milestone 34 branch
- [x] Create Milestone 34 document
- [x] Audit current retrieval pipeline against prior fix notes
- [x] Define retrieval balance contract
- [ ] Implement retrieval rebalance changes
- [ ] Validate latency, relevance, and source hygiene

---

## Implementation Log

### 2026-03-13 — Research and audit baseline completed

Completed in this planning slice:

1. created the `milestone-34` branch;
2. created Milestone 34 as a new authoritative retrieval rebalance document;
3. re-audited the live `retrievalService.ts` pipeline rather than relying on
   the older retrieval-performance note alone;
4. confirmed that the current retrieval path is already a multi-stage ranking
   system with adaptive query planning, structure expansion, cosine reranking,
   diversity ordering, evidence-role balancing, source deduplication, and token
   budgeting;
5. documented that the current service also contains a large domain-specific
   source-boost layer tied to the insurance demo corpus, which improves some
   outcomes but weakens general reasoning about retrieval behavior;
6. reviewed current OpenClaw memory search behavior and captured the useful
   lessons for Parallx: explicit recall tools, opt-in session retrieval,
   bounded snippet output, and non-blocking indexing;
7. compared adjacent product patterns from Aider, Cline, and Continue and
   recorded the main cross-product lesson: reliable systems separate retrieval
   lanes by evidence type instead of forcing everything through one broad
   semantic-retrieval path.

### 2026-03-13 — First implementation slice: internal artifact hygiene

Completed in this implementation slice:

1. added an explicit internal-artifact policy to retrieval so generic grounded
   retrieval can exclude `.parallx/*` files by default while explicit callers
   can opt back in;
2. hardened `RetrievalService` so ordinary grounded answers no longer surface
   `.parallx` artifacts such as internal config files unless the query or
   caller explicitly targets that lane;
3. updated `CanonicalMemorySearchService` to opt into internal-artifact
   retrieval explicitly, preserving canonical markdown memory recall;
4. extended retrieval traces so corpus-hygiene drops are visible in diagnostics;
5. added focused regression coverage for both the default exclusion path and
   the canonical-memory opt-in path.

Focused validation completed:

1. `npm run test:unit -- retrievalService.test.ts canonicalMemorySearchService.test.ts` ✅

### 2026-03-13 — Second implementation slice: reduce demo-corpus drift in source boosts

Completed in this implementation slice:

1. tightened the insurance-agent contact trigger in retrieval so plain generic
   "agent" architecture questions do not accidentally activate the insurance
   contact-boost lane;
2. kept the stronger insurance-contact behavior for true contact-style asks
   such as phone, email, call, or "my agent" questions;
3. added a focused regression proving unrelated agent-architecture queries now
   prefer code evidence over insurance demo docs.

Focused validation completed:

1. `npm run test:unit -- retrievalService.test.ts canonicalMemorySearchService.test.ts` ✅

---

## Verification Checklist

- [ ] `npm run test:unit -- ...` for retrieval and routing regressions
- [ ] Deterministic coverage for source hygiene and explicit-lane precedence
- [ ] Live eval covering at least one latency-sensitive grounded query
- [ ] Live eval covering at least one noisy-source regression
- [ ] Milestone doc updated with implementation log and final validation list

---

## Risks And Open Questions

1. Some retrieval stages may look expensive but still be protecting answer
   quality in edge cases; we should measure before cutting aggressively.
2. Over-correcting source hygiene could hide legitimate internal files when the
   user is explicitly asking about Parallx config or architecture.
3. Retrieval lane isolation can improve precision but accidentally suppress
   useful corroborating evidence if the precedence rules are too rigid.
4. Live AI evals are still sensitive to corpus composition and model behavior,
   so deterministic harnesses must shoulder more of the tuning burden.
5. The main chat architecture hotspot remains in
   `src/built-in/chat/participants/defaultParticipant.ts` and
   `src/built-in/chat/data/chatDataService.ts`; retrieval improvements should be
   careful not to re-entangle orchestration concerns there.

---

## References

### Prior Parallx planning docs

1. `docs/ai/RETRIEVAL_PERFORMANCE_FIX_PLAN.md`
2. `docs/ai/CONVERSATIONAL_ROUTING_FIX_PLAN.md`
3. `docs/ai/AIR_E2E_PLAYWRIGHT_PLAN.md`
4. `docs/Parallx_Milestone_32.md`
5. `docs/Parallx_Milestone_33.md`

### Primary code surfaces for this milestone

1. `src/services/retrievalService.ts`
2. `src/services/vectorStoreService.ts`
3. `src/built-in/chat/utilities/chatContextPlanner.ts`
4. `src/built-in/chat/utilities/chatTurnContextPreparation.ts`
5. `src/built-in/chat/participants/defaultParticipant.ts`
6. `src/built-in/chat/data/chatDataService.ts`