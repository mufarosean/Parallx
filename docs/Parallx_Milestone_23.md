# Milestone 23 — Retrieval System Overhaul & Evidence Engine

> **Authoritative Scope Notice**
>
> This document is the single source of truth for Milestone 23.
> All retrieval-related implementation, evaluation, and documentation work for
> this milestone must conform to the architecture, priorities, and task
> boundaries defined here.
>
> Milestones 10–22 established Parallx's local-first indexing, chunking,
> hybrid retrieval, AI settings, retrieval hardening, chunk-overlap fixes,
> document extraction, and cleanup of abandoned planner paths. This milestone
> does **not** treat retrieval as a minor tuning problem. It treats retrieval as
> a first-class evidence system and defines the overhaul required for Parallx to
> answer grounded questions about code, docs, PDFs, notes, and workspace state
> with materially higher precision, coverage, and reasoning support.

---

## Table of Contents

1. [Problem Statement](#problem-statement)
2. [Current State Audit](#current-state-audit)
3. [Research Basis](#research-basis)
4. [Vision](#vision)
5. [Guiding Principles](#guiding-principles)
6. [Target Capabilities](#target-capabilities)
7. [Target Architecture](#target-architecture)
8. [Phase Plan](#phase-plan)
9. [Implementation Sequence](#implementation-sequence)
10. [Migration & Compatibility](#migration--compatibility)
11. [Evaluation Strategy](#evaluation-strategy)
12. [Task Tracker](#task-tracker)
13. [Verification Checklist](#verification-checklist)
14. [Risk Register](#risk-register)

---

## Problem Statement

Parallx already has a functioning retrieval pipeline, but the current system is
still architecturally shallow relative to the kinds of questions the product is
expected to answer.

Today the system can:

- index workspace pages and files,
- perform hybrid dense + FTS retrieval,
- apply lightweight cosine reranking,
- cap per-source evidence,
- enforce a token budget, and
- inject retrieved context into chat.

That is a strong baseline, but it is **not yet a modern evidence engine**.

The current limitations are structural:

1. **Candidate generation is still too one-shot**
   - runtime retrieval currently follows the user's final text directly;
   - there is no active query decomposition or staged evidence gathering for
     cross-cutting questions.

2. **Ranking is still too lightweight for hard questions**
   - reciprocal rank fusion plus cosine filtering improves relevance, but it is
     not the same as a true second-stage evidence ranking system.

3. **Evidence coverage is not optimized explicitly**
   - the system limits per-source monopoly, but it does not yet optimize for
     complementary evidence roles such as definition, architecture,
     implementation detail, recency, and failure mode.

4. **Structured-document retrieval is not yet first-class**
   - PDFs, office docs, and long structured sources are extracted and chunked,
     but retrieval still primarily operates as generic chunk search rather than
     structure-aware evidence assembly.

5. **Complex reasoning questions are under-supported**
   - many user questions span multiple sources or multiple concepts;
   - retrieval does not yet iteratively verify that the minimum sufficient
     evidence set has actually been assembled.

6. **Evaluation is not yet the primary driver of retrieval evolution**
   - the codebase contains strong retrieval research, but the runtime still
     needs a dedicated eval harness and milestone-owned metrics for proving that
     quality actually improved.

The result is a system that can feel competent on easy questions and shallow on
hard ones.

Milestone 23 fixes that by redefining retrieval as:

> **search engineering + evidence assembly + grounded answer support**

rather than merely:

> **top-k chunk lookup**.

---

## Current State Audit

This audit is based on current runtime code and the existing internal retrieval
research documents.

### What the current runtime does well

1. **Hybrid retrieval already exists**
   - `retrievalService.ts` embeds the query, calls `VectorStoreService.search()`,
     applies score filtering, cosine reranking, source caps, and token budget.

2. **Keyword search is materially better than the original M10 shape**
   - `vectorStoreService.ts` now uses AND-first FTS5 search with OR fallback;
   - stopwords are filtered;
   - `contextPrefix` is prepended into FTS content for stronger lexical recall.

3. **Chunking is materially better than the original baseline**
   - `chunkingService.ts` now uses 1024-char chunks with 200-char overlap;
   - markdown structure, headings, tables, and code blocks are preserved more
     carefully than the original naive chunking path.

4. **Retrieval behavior is user-configurable**
   - `retrievalSection.ts` exposes `ragTopK`, `ragMaxPerSource`,
     `ragTokenBudget`, `ragScoreThreshold`, `ragCosineThreshold`, and
     `ragDropoffRatio`.

5. **Workspace contamination is bounded by architecture**
   - `IDatabaseService` is workspace-scoped, so the main vector index is not a
     global cross-workspace pool.

### What the current runtime still lacks

1. **No runtime multi-query decomposition path**
   - the old planner bridge has been removed;
   - `defaultParticipant.ts` now builds a synthetic retrieval plan and calls
     `retrieveContext(userText)` directly.

2. **No true second-stage semantic reranker**
   - current reranking is cosine-based over stored embeddings;
   - there is no dedicated reranker that reasons over the query-candidate pair
     as a ranking problem.

3. **No diversity-aware evidence selection**
   - current selection prevents source monopoly but does not optimize for
     complementary evidence roles.

4. **Metadata is still too coarse for advanced ranking**
   - current retrieval rows primarily expose `sourceType`, `sourceId`,
     `chunkIndex`, `chunkText`, and `contextPrefix`;
   - richer retrieval metadata such as content role, section kind,
     extraction mode, document structure class, or recency-aware rank signals
     are not yet first-class ranking inputs.

5. **No iterative retrieve-again loop**
   - if evidence is incomplete, the system does not yet explicitly detect that
     state and launch a second retrieval pass.

6. **No late-interaction or multivector path for hard documents**
   - long PDFs, mixed-layout docs, and dense architecture notes still rely on a
     single-vector-per-chunk retrieval path.

### Current-state conclusion

Parallx has moved beyond naive retrieval, but it is still operating as a
**strong first-stage retriever** rather than a complete evidence engine.

That distinction is the reason this milestone exists.

---

## Research Basis

Milestone 23 is grounded in both **internal Parallx research** and **external
retrieval research / vendor guidance**.

### Internal research reviewed

#### 1. `docs/ai/RAG_RETRIEVAL_HARDENING_RESEARCH.md`

Key findings retained:

- retrieval failure is multi-causal, not a single bug;
- keyword search quality, score thresholds, reranking, conversation scoping,
  overlap, and metadata all matter;
- retrieval quality has historically been harmed by noisy lexical recall and
  insufficient post-retrieval filtering.

#### 2. `docs/ai/RAG_ARCHITECTURE_COMPARISON.md`

Key findings retained:

- mature systems use smaller chunks with overlap;
- hybrid retrieval is normal, not optional;
- lightweight reranking is often high-leverage;
- multi-query retrieval is useful for hard questions, but should be targeted;
- context management should be priority-based, not pure concatenation.

#### 3. `docs/ai/RETRIEVAL_PERFORMANCE_FIX_PLAN.md`

Historical value retained:

- latency is real and must be treated as a product constraint;
- any reranking or decomposition layer must justify itself with eval gains;
- retrieval quality and time-to-first-token must be co-optimized.

This document is **historical**, not authoritative runtime design.

### Runtime code reviewed

- `src/services/retrievalService.ts`
- `src/services/vectorStoreService.ts`
- `src/services/chunkingService.ts`
- `src/services/indexingPipeline.ts`
- `src/built-in/chat/participants/defaultParticipant.ts`
- `src/aiSettings/ui/sections/retrievalSection.ts`
- `src/services/serviceTypes.ts`

### External research reviewed

#### Anthropic — Contextual Retrieval
Source: https://www.anthropic.com/news/contextual-retrieval

Relevant findings:

- embeddings + BM25 outperform embeddings alone;
- contextualized chunks materially improve retrieval;
- contextual embeddings + contextual BM25 reduced top-20 retrieval failure by
  49% in Anthropic's experiments;
- adding reranking reduced failure by 67%;
- Anthropic recommends evaluating chunk boundaries, overlap, and top-k settings;
- reranking should operate on a candidate pool, not the whole corpus.

#### Cohere — Reranking guidance
Source: https://docs.cohere.com/docs/reranking-with-cohere

Relevant findings:

- reranking is a second-stage operation that can sit on top of lexical or
  semantic search;
- reranking is particularly valuable when the first-stage retriever is broad but
  imperfect;
- reranking applies naturally to semi-structured data, code, tables, JSON, and
  long documents.

#### Pinecone — Hybrid search
Source: https://www.pinecone.io/learn/hybrid-search/

Relevant findings:

- keyword and semantic search fail in different ways;
- hybrid retrieval outperforms standalone lexical or standalone dense search;
- weighting between dense and sparse signals matters and should be tuned by
  corpus and model quality.

#### Qdrant — Hybrid search, RRF, multivector retrieval
Source: https://qdrant.tech/articles/hybrid-search/

Relevant findings:

- RRF is a strong default fusion strategy;
- linear score blending is often a poor substitute for true fusion/reranking;
- late-interaction / multivector retrieval is most effective as a reranking step
  over a candidate set, not as the only retrieval path;
- multi-vector models preserve more local meaning than a single-vector chunk;
- search quality should be measured with standard ranking metrics such as
  `precision@k`, `MRR`, and `NDCG`.

#### LlamaIndex — Sub-question query decomposition
Source: https://developers.llamaindex.ai/python/examples/query_engine/sub_question_query_engine/

Relevant findings:

- complex questions can be decomposed into sub-questions before synthesis;
- sub-question retrieval is a practical pattern for multi-hop or multi-source
  questions;
- decomposition should support final synthesis rather than replace it.

### Research conclusion

Internal and external research align on the same core point:

> strong retrieval systems are staged systems.

They combine:

- better candidate generation,
- better ranking,
- better evidence coverage,
- better structure awareness, and
- explicit evaluation.

---

## Vision

### Before M23

> Parallx has a solid local-first RAG baseline, but hard questions still depend
> too heavily on one-shot chunk retrieval plus generic synthesis. The system can
> retrieve relevant evidence, but it does not yet behave like a disciplined
> evidence engine.

### After M23

> Parallx retrieval is evidence-first, structure-aware, and evaluation-driven.
> It can gather candidates with hybrid retrieval, rank them with stronger
> evidence selection, decompose complex questions when needed, preserve document
> structure for hard sources, and explicitly prefer complementary evidence over
> redundant similarity hits.

### Product-level success criteria

After this milestone, Parallx should feel materially better at:

- answering architecture questions spanning docs + code + notes;
- answering PDF and structured-document questions with fewer irrelevant cites;
- handling exact identifiers, filenames, APIs, and workspace-specific jargon;
- avoiding five-near-duplicate chunk dumps;
- recognizing when more evidence is required before answering.

---

## Guiding Principles

1. **Local-first remains mandatory**
   - no cloud retrieval dependency;
   - all core retrieval capabilities must have a local path.

2. **Retrieval and reasoning are separate layers**
   - retrieval assembles evidence;
   - synthesis uses evidence;
   - the system must not rely on synthesis to compensate for weak retrieval.

3. **Broad first-stage, selective second-stage**
   - first-stage retrieval should maximize useful candidates;
   - second-stage selection should maximize precision and coverage.

4. **Evidence coverage beats raw similarity**
   - the goal is the minimum sufficient evidence set, not merely the top-most
     similar chunks.

5. **Structured content deserves structured retrieval**
   - PDFs, office docs, and rich notes need retrieval that respects sections,
     headings, tables, pages, and extraction quality.

6. **Every retrieval upgrade must be measurable**
   - no change ships without evals, traces, or before/after metrics.

7. **Latency is a product feature**
   - stronger retrieval is only successful if it remains compatible with local
     interaction expectations.

---

## Target Capabilities

Milestone 23 introduces the following target capabilities.

### C1. Retrieval eval harness

A repeatable retrieval benchmark suite that measures:

- candidate recall,
- top-k relevance,
- citation precision,
- source diversity,
- answer grounding success,
- latency by stage.

### C2. Metadata-rich evidence index

The index should support more than plain chunk text. Retrieval should be able to
reason over metadata such as:

- source type,
- relative path,
- page/section/heading,
- extraction pipeline,
- content role (heading/body/table/code/caption/summary),
- updated timestamp,
- parent-child relationships,
- workspace/document scope.

### C3. Hybrid retrieval 2.0

The first-stage retriever should:

- preserve dense + lexical retrieval,
- support better weighting/fusion controls,
- broaden candidates intentionally for downstream ranking,
- preserve exact-match strength for identifiers and product-specific terms.

### C4. Stronger second-stage ranking

Parallx needs a real ranking layer that goes beyond pure cosine thresholding.
This can include:

- configurable lightweight reranking,
- evidence-role-aware selection,
- rank fusion + rerank composition,
- optional harder reranking paths for expensive queries.

### C5. Diversity-aware evidence assembly

Selection should explicitly prefer complementary evidence, not just multiple
versions of the same match.

### C6. Query decomposition for hard questions

The system should detect when a question spans multiple concepts or sources and
split it into targeted retrieval queries.

### C7. Iterative retrieve-again loop

If the answering layer detects evidence insufficiency, retrieval should be able
to run a second targeted pass instead of improvising.

### C8. Structure-aware retrieval for PDFs and complex documents

Parallx should preserve and exploit document structure better, including:

- parent-child chunk relations,
- page/section targeting,
- table-aware and figure-aware evidence,
- optional late-interaction reranking for hard cases.

### C9. Retrieval observability

Developers and future users need visibility into:

- which retrieval stages fired,
- candidate counts by stage,
- why chunks survived or were dropped,
- whether the answer was evidence-sufficient or evidence-thin.

---

## Target Architecture

### Steady-state retrieval pipeline

```text
User question
    ↓
Question classifier
    ↓
Simple question? ────────────── yes ──→ direct hybrid retrieval
    ↓ no
Query decomposition / expansion
    ↓
Hybrid first-stage retrieval
(dense + lexical + strict scope filters)
    ↓
Second-stage ranking
(rerank + diversity + evidence-role balancing)
    ↓
Evidence sufficiency check
    ↓
Enough evidence? ────────────── yes ──→ grounded synthesis + citations
    ↓ no
Focused follow-up retrieval pass
    ↓
Grounded synthesis + citations
```

### Retrieval layer responsibilities

#### 1. Candidate generation layer
Responsible for:

- strict scope eligibility,
- hybrid search,
- high-recall candidate gathering,
- exact-match support,
- optional multi-query expansion.

#### 2. Ranking layer
Responsible for:

- relevance ordering,
- semantic reranking,
- metadata-aware boosts/penalties,
- diversity balancing.

#### 3. Evidence assembly layer
Responsible for:

- per-source caps,
- evidence-role coverage,
- token-budget packing,
- source attribution and provenance.

#### 4. Synthesis support layer
Responsible for:

- detecting evidence insufficiency,
- requesting an additional retrieval pass,
- preserving citations and grounding constraints.

---

## Phase Plan

## Phase A — Measurement First

Goal: make retrieval quality measurable before changing architecture.

### A.1 Build a retrieval benchmark set
- curate a Parallx-specific dataset of retrieval questions across:
  - code questions,
  - architecture questions,
  - PDF questions,
  - cross-source questions,
  - exact-identifier questions,
  - ambiguous/follow-up questions.

### A.2 Define milestone metrics
Track at minimum:

- `Recall@K`
- `MRR`
- `NDCG@K`
- source diversity per answer
- citation precision
- evidence sufficiency rate
- stage latency (`retrieve`, `rerank`, `assemble`, `answer`)

### A.3 Add retrieval tracing
Produce structured logs or trace objects for:

- decomposition output,
- candidate pools,
- fused scores,
- rerank decisions,
- diversity drops,
- final selected evidence.

**Exit criterion**: a repeatable baseline report exists before major retrieval refactors land.

---

## Phase B — Index & Metadata Overhaul

Goal: improve what retrieval can know about each chunk.

### B.1 Extend index schema for ranking metadata
Add first-class fields for:

- structural role,
- heading path,
- page number when available,
- extraction pipeline and confidence,
- parent/child chunk links,
- last-updated timestamp,
- document kind.

### B.2 Preserve hierarchical document structure
Introduce parent-child retrieval primitives so the system can:

- retrieve a precise child chunk,
- expand to its parent section when needed,
- cite the correct local evidence without losing context.

### B.3 Add extraction-quality signaling
Retrieval should know if a chunk came from:

- text-native extraction,
- OCR,
- degraded fallback,
- table reconstruction,
- caption/figure extraction.

**Exit criterion**: ranking can consume richer metadata than text + path alone.

---

## Phase C — Candidate Generation 2.0

Goal: improve recall without destroying precision.

### C.1 Harden dense + lexical retrieval composition
- keep hybrid retrieval as default;
- evaluate fusion/weighting strategies against benchmark queries;
- preserve exact-match strength for APIs, filenames, model names, and product
  terms.

### C.2 Add query decomposition path for hard questions
- detect multi-hop and cross-source questions;
- generate targeted sub-queries;
- merge and deduplicate results before ranking.

### C.3 Add query rewriting / expansion safeguards
- preserve the raw user query;
- log rewritten queries;
- prevent decomposition from losing critical identifiers.

### C.4 Make candidate breadth adaptive
- simple exact questions should stay fast;
- complex architecture questions can fetch broader candidate pools.

**Exit criterion**: candidate generation improves recall on hard questions without regressing easy-question latency.

---

## Phase D — Ranking & Evidence Selection

Goal: improve which evidence survives.

### D.1 Introduce a stronger second-stage ranking layer
Candidate directions:

- stronger local reranker,
- query-candidate semantic scorer,
- configurable hard-query rerank path,
- combined rank-fusion + rerank pipeline.

### D.2 Add diversity-aware selection
Ensure the final evidence set prefers complementary chunks rather than only
nearest-neighbor duplicates.

### D.3 Add evidence-role balancing
Prefer a set that can cover roles like:

- definition,
- architecture location,
- implementation detail,
- current behavior,
- failure mode,
- recency.

### D.4 Improve token-budget packing
Pack context by value density, not just rank order.

**Exit criterion**: final evidence sets become more complementary, more grounded, and less redundant.

---

## Phase E — Structure-Aware Retrieval for Hard Documents

Goal: improve retrieval for PDFs, office docs, and dense long-form sources.

### E.1 Parent-child retrieval for sections and pages
Support retrieving a fine-grained chunk while also exposing its parent section or
page envelope.

### E.2 Table/code/figure-aware evidence handling
- tables should not be ranked like plain prose;
- code blocks should preserve lexical exactness;
- figure captions and callouts should remain attachable to local context.

### E.3 Evaluate late-interaction reranking for hard cases
Pilot a multivector or late-interaction rerank path for:

- PDFs with mixed layout,
- structured technical docs,
- code-heavy retrieval,
- long architecture documents.

This is explicitly a **targeted hard-case path**, not the default for all
queries.

**Exit criterion**: structured-doc retrieval materially improves on benchmark PDF and long-doc questions.

---

## Phase F — Evidence-Sufficient Answering Loop

Goal: prevent shallow answers when evidence is incomplete.

### F.1 Add evidence sufficiency checks
The answering pipeline should be able to classify the evidence set as:

- sufficient,
- weak but answerable,
- insufficient.

### F.2 Add retrieve-again behavior
If evidence is insufficient:

- generate a follow-up retrieval query,
- retrieve again,
- merge new evidence,
- synthesize only after the second pass.

### F.3 Add abstain / clarify behavior
If the system still lacks evidence, it should:

- answer narrowly with caveats,
- ask a clarifying question, or
- state that the evidence is insufficient.

**Exit criterion**: fewer confident but weakly grounded answers on hard questions.

---

## Phase G — Product Surface, Tuning, and Rollout

Goal: expose the overhaul safely and make it operable.

### G.1 Expand retrieval settings carefully
Potential new settings:

- decomposition mode,
- candidate breadth preset,
- rerank mode,
- diversity strength,
- hard-document retrieval mode,
- retrieval trace toggle.

### G.2 Add internal diagnostics UI or dev tools
Developers should be able to inspect:

- generated retrieval queries,
- first-stage candidates,
- rerank scores,
- dropped evidence,
- final packed context.

### G.3 Roll out with eval gates
No retrieval stage becomes the default path until it passes benchmark thresholds
and manual regression review.

**Exit criterion**: retrieval overhaul is observable, tunable, and safe to ship incrementally.

---

## Implementation Sequence

This section converts the milestone into the **recommended execution order**.

The rule for M23 is:

> **measure first, then widen retrieval power, then harden ranking, then add
> iterative reasoning support.**

The sequence below is dependency-aware and intended to minimize rework.

### Sequence 1 — Establish measurement before changing behavior

**Milestone tasks**
- A1
- A2
- A3

**Why first**

Without a benchmark set and retrieval tracing, every later retrieval change is
an argument instead of a measurement.

**Primary deliverables**
- retrieval benchmark dataset in workspace-owned test assets;
- metric definitions and reporting format;
- stage-level retrieval trace objects/logging;
- a baseline report against the current hybrid retriever.

**Likely implementation areas**
- `tests/ai-eval/**`
- `tests/unit/**` retrieval-focused tests
- `src/services/retrievalService.ts`
- `src/services/vectorStoreService.ts`
- retrieval-related diagnostics or trace utilities under `src/services/**`

**Exit gate**
- baseline retrieval report exists;
- the current system can explain candidate selection and final evidence packing.

---

### Sequence 2 — Expand index metadata without changing answer behavior yet

**Milestone tasks**
- B1
- B2
- B3

**Why second**

Ranking and diversity logic cannot use metadata that does not exist.

**Primary deliverables**
- expanded retrieval/index schema;
- parent-child structural metadata for chunks/sections/pages;
- extraction-quality metadata for document-derived chunks;
- safe reindex path or pipeline-version bump if required.

**Likely implementation areas**
- `src/services/vectorStoreService.ts`
- `src/services/indexingPipeline.ts`
- `src/services/chunkingService.ts`
- database schema/migration files used by the indexing layer
- `src/services/serviceTypes.ts`

**Exit gate**
- index stores richer retrieval metadata;
- rebuild path works cleanly;
- no regression in basic indexing correctness.

---

### Sequence 3 — Upgrade candidate generation

**Milestone tasks**
- C1
- C2
- C3
- C4

**Why third**

Once measurement exists and metadata is richer, the next bottleneck is recall
and query coverage.

**Primary deliverables**
- evaluated hybrid retrieval tuning;
- query classifier for simple vs hard questions;
- decomposition path for multi-hop / cross-source questions;
- guarded query rewriting that preserves identifiers;
- adaptive candidate breadth rules.

**Likely implementation areas**
- `src/services/retrievalService.ts`
- `src/services/vectorStoreService.ts`
- `src/built-in/chat/participants/defaultParticipant.ts`
- shared retrieval-query utilities under `src/services/**` or `src/built-in/chat/**`
- retrieval settings/config types under `src/aiSettings/**`

**Exit gate**
- hard-question recall improves against baseline;
- identifier-heavy prompts do not regress;
- simple chat remains on the fast path.

---

### Sequence 4 — Introduce stronger ranking and evidence selection

**Milestone tasks**
- D1
- D2
- D3
- D4

**Why fourth**

This is the point where Parallx stops being mostly a candidate retriever and
starts becoming an evidence selector.

**Primary deliverables**
- second-stage ranking implementation;
- diversity-aware selection logic;
- evidence-role-aware packing strategy;
- improved token-budget selection by evidence value, not just rank order.

**Likely implementation areas**
- `src/services/retrievalService.ts`
- new ranking/selection helpers under `src/services/**`
- `src/built-in/chat/data/chatDataService.ts`
- `src/built-in/chat/participants/defaultParticipant.ts`

**Exit gate**
- final evidence sets show lower redundancy;
- citation quality improves;
- at least one ranking path beats baseline in the benchmark suite.

---

### Sequence 5 — Improve hard-document retrieval paths

**Milestone tasks**
- E1
- E2
- E3

**Why fifth**

This slice depends on both richer metadata and stronger ranking. It should be
applied after the generic retrieval path is already measurable and improved.

**Primary deliverables**
- parent-section / page expansion logic;
- specialized treatment for tables, code, figures, and captions;
- optional late-interaction / multivector pilot for hard-document reranking.

**Likely implementation areas**
- `src/services/chunkingService.ts`
- `src/services/indexingPipeline.ts`
- `src/services/retrievalService.ts`
- extraction pipeline support code under `src/services/**` and `electron/**`

**Exit gate**
- PDF and structured-doc benchmark questions improve materially;
- hard-document mode remains bounded in latency and memory.

---

### Sequence 6 — Add evidence sufficiency and retrieve-again loop

**Milestone tasks**
- F1
- F2
- F3

**Why sixth**

It only makes sense to add iterative retrieval once the underlying retrieval and
ranking system is strong enough to benefit from a second pass.

**Primary deliverables**
- evidence sufficiency classification;
- retrieve-again orchestration;
- abstain / clarify behavior for thin evidence.

**Likely implementation areas**
- `src/built-in/chat/participants/defaultParticipant.ts`
- `src/built-in/chat/data/chatDataService.ts`
- prompt-building or answer-orchestration helpers under `src/built-in/chat/**`
- retrieval tracing / evaluation code to track second-pass effectiveness

**Exit gate**
- fewer thinly grounded answers on hard questions;
- second retrieval pass is traceable and measurable.

---

### Sequence 7 — Surface controls, diagnostics, and rollout gates

**Milestone tasks**
- G1
- G2
- G3

**Why last**

Settings and diagnostics should reflect the final retrieval architecture, not
an unstable intermediate design.

**Primary deliverables**
- retrieval settings updates;
- diagnostics UI/dev tooling;
- rollout criteria tied to benchmark thresholds.

**Likely implementation areas**
- `src/aiSettings/ui/sections/retrievalSection.ts`
- `src/aiSettings/unifiedConfigTypes.ts`
- diagnostics surfaces under `src/built-in/chat/**` or `src/views/**`
- eval/reporting docs and milestone checklists

**Exit gate**
- retrieval overhaul is observable and configurable;
- rollout is blocked unless benchmark thresholds are met.

---

### Recommended implementation slices

For actual engineering execution, use these slices:

1. **Slice 1 — Baseline eval + tracing**
  - complete all of Phase A before touching ranking behavior.

2. **Slice 2 — Schema + metadata foundation**
  - complete B1/B2/B3 with reindex validation.

3. **Slice 3 — Query classification + decomposition**
  - implement C2/C3/C4, then retune C1 with metrics.

4. **Slice 4 — Ranking and diversity**
  - implement D1/D2/D3/D4 and prove improvements.

5. **Slice 5 — Structured-doc hard path**
  - implement E1/E2, then evaluate E3 experimentally.

6. **Slice 6 — Evidence sufficiency loop**
  - implement F1/F2/F3 after ranking is strong.

7. **Slice 7 — Productization**
  - implement G1/G2/G3 once the retrieval behavior is stable.

### Recommended commit / validation rhythm

For each slice:

1. implement one retrieval slice only;
2. run `tsc --noEmit`;
3. run targeted unit tests;
4. run retrieval benchmark/eval set;
5. document the before/after result in the milestone or related eval output.

### Explicit dependency rules

- Do **not** implement late-interaction retrieval before the benchmark suite exists.
- Do **not** ship query decomposition without identifier-regression tests.
- Do **not** ship new ranking logic without trace output explaining why chunks won.
- Do **not** add user-facing retrieval settings for capabilities that have not
  passed eval gates.

---

## Sequence 1 — Concrete Implementation Slice Plan

This section defines the **actual first execution slice** for Milestone 23.

Sequence 1 is intentionally narrow:

> build the retrieval measurement foundation without materially changing
> retrieval behavior.

That means the first slice should add **evaluation and observability**, not a
new retrieval algorithm.

### Slice 1A — Retrieval benchmark scaffold

**Goal**

Create a retrieval-focused benchmark layer alongside the existing AI quality
evaluation flow.

**Current foundation already present**

- `tests/ai-eval/ai-quality.spec.ts` already runs real end-to-end AI evals;
- `tests/ai-eval/scoring.ts` already builds summary reports;
- `tests/ai-eval/ai-eval-fixtures.ts` already launches a real Electron app with
  the demo workspace;
- `playwright.ai-eval.config.ts` already provides a dedicated evaluation config.

**Implementation tasks**

1. Add a retrieval-specific rubric or dataset file under `tests/ai-eval/`.
2. Separate retrieval-focused cases from general response-quality cases.
3. Define initial benchmark categories:
  - exact identifier retrieval,
  - source selection,
  - cross-source coverage,
  - PDF/structured-doc retrieval,
  - follow-up source continuity.
4. Define machine-readable expected evidence targets for each test case.

**Likely files**

- `tests/ai-eval/rubric.ts`
- new retrieval benchmark file(s) under `tests/ai-eval/`
- `tests/ai-eval/scoring.ts`

**Validation**

- retrieval benchmark data loads cleanly;
- report output can represent retrieval-specific scoring.

---

### Slice 1B — Retrieval metrics and scoring

**Goal**

Add retrieval-oriented metrics without waiting for the full overhaul.

**Implementation tasks**

1. Extend scoring/reporting to track retrieval metrics separately from general
  answer-quality scoring.
2. Add baseline metrics for:
  - source citation precision,
  - expected-source hit rate,
  - evidence coverage score,
  - retrieval latency,
  - empty/irrelevant context rate where observable.
3. Add report sections for retrieval-specific before/after comparisons.

**Likely files**

- `tests/ai-eval/scoring.ts`
- `tests/ai-eval/ai-quality.spec.ts`
- generated outputs under `test-results/`

**Validation**

- benchmark run emits retrieval-specific JSON/text fields;
- output is stable enough to use as a baseline artifact.

---

### Slice 1C — Retrieval tracing in runtime services

**Goal**

Make the current retriever explain itself.

**Implementation tasks**

1. Add trace objects in `retrievalService.ts` for:
  - input query,
  - effective retrieval config,
  - candidate counts,
  - score-threshold drops,
  - cosine rerank drops,
  - source-dedup drops,
  - token-budget trimming,
  - final selected chunk identities.
2. Add trace points in `vectorStoreService.ts` for:
  - vector result count,
  - keyword result count,
  - AND-vs-OR fallback behavior,
  - fused result count.
3. Keep tracing additive and non-invasive in this slice.
  - no retrieval behavior change;
  - no new ranking logic yet.

**Likely files**

- `src/services/retrievalService.ts`
- `src/services/vectorStoreService.ts`
- `src/services/serviceTypes.ts` if a trace type/service contract is needed
- targeted unit tests under `tests/unit/`

**Validation**

- unit tests cover trace generation;
- traces explain why chunks survived or were dropped;
- retrieval behavior remains functionally unchanged.

---

### Slice 1D — Baseline retrieval report

**Goal**

Produce the first milestone-owned baseline report before any retrieval overhaul
logic lands.

**Implementation tasks**

1. Run the retrieval benchmark suite against the current runtime.
2. Save the baseline report into the standard report output path.
3. Summarize the baseline in this milestone doc once captured.

**Expected baseline artifact**

- machine-readable retrieval report in `test-results/`
- human-readable summary report in `test-results/`
- milestone note summarizing known weaknesses exposed by the benchmark

---

### Definition of done for Sequence 1

Sequence 1 is complete only when all of the following are true:

- retrieval benchmark cases exist;
- retrieval-specific metrics are reported;
- runtime retrieval traces exist;
- the current retriever has a saved baseline report;
- the milestone task tracker marks A1/A2/A3 complete when finished;
- the slice is committed and documented per the execution-discipline rules.

### Recommended commit breakdown for Sequence 1

Use at least these commits:

1. `tests: add retrieval benchmark scaffold`
2. `tests: add retrieval scoring and reporting`
3. `services: add retrieval trace instrumentation`
4. `docs: record retrieval baseline and update milestone 23`

If any one of those becomes too large, split further.

### Recommended validation commands for Sequence 1

- `tsc --noEmit`
- targeted `vitest` for retrieval/unit trace coverage
- retrieval-focused AI eval run using [playwright.ai-eval.config.ts](playwright.ai-eval.config.ts)

### What Sequence 1 must NOT do

To keep the slice disciplined, Sequence 1 must not:

- add query decomposition;
- add new ranking logic;
- change chunking/index structure;
- change user-facing retrieval settings;
- introduce any behavior change that would make the baseline incomparable.

---

## Execution Discipline

Milestone 23 implementation must follow a **regular commit cadence** and a
**regular documentation cadence**.

### Commit discipline

Implementation should be committed in small, reviewable slices.

**Required rule**

- make at least **one commit per implementation slice**;
- if a slice is large, split it into multiple commits by subtask;
- do not accumulate multiple retrieval architecture changes into one opaque
  commit.

**Preferred commit grouping**

1. benchmark/eval scaffolding
2. retrieval tracing
3. schema/index metadata changes
4. candidate-generation changes
5. ranking/diversity changes
6. structured-doc retrieval changes
7. evidence-sufficiency loop changes
8. settings/diagnostics rollout

### Documentation discipline

Documentation must stay in sync with implementation.

**Required rule**

- after each completed slice, update this milestone document;
- mark completed tasks in the task tracker;
- note any deviation from the planned architecture or sequence;
- record benchmark impact when behavior changed.

### Minimum update required after each slice

After each completed slice, document:

1. what changed;
2. which milestone tasks were completed;
3. what tests/evals were run;
4. whether behavior improved, regressed, or stayed neutral;
5. whether the next planned slice changed.

### Implementation start rule

When implementation begins, do **not** treat documentation as a final cleanup
step. It is part of the slice definition itself.

That means each slice is only complete when:

- code is implemented,
- tests/evals are run,
- changes are committed, and
- the milestone doc is updated.

### Implementation Log

#### Slice 1A/1B — Retrieval benchmark scaffold + scoring foundation

**What changed**

- added a dedicated retrieval benchmark definition file under `tests/ai-eval/`;
- defined machine-readable expected-source and required-term targets for the
  first retrieval-focused benchmark cases;
- extended the scoring/reporting layer with retrieval metrics for expected
  source hit rate, required-term coverage, citation presence, and forbidden-term
  violations;
- wired the existing AI quality eval loop so baseline runs can emit retrieval
  metrics without changing prompts or retrieval behavior.

**Tasks completed**

- A1. Build Parallx retrieval benchmark set
- A2. Define milestone-owned retrieval metrics

**Tests/evals run**

- targeted unit coverage for retrieval benchmark lookup and retrieval metric
  aggregation;
- TypeScript/build validation.

**Behavior impact**

- retrieval behavior is unchanged;
- evaluation/reporting coverage improved.

**Next slice**

- Sequence 1C: add runtime retrieval tracing and stage diagnostics.

#### Slice 1C — Runtime retrieval tracing + stage diagnostics

**What changed**

- added vector-store search tracing for vector count, keyword count, fused
  count, final count, and FTS5 fallback behavior;
- added retrieval-service tracing for post-search stage counts, drop reasons,
  token-budget usage, and final selected chunk identities;
- exposed last-trace accessors so retrieval benchmarks and future diagnostics
  can inspect the most recent retrieval pipeline run without changing behavior;
- added unit coverage for vector-store fallback tracing and retrieval-stage
  trace summaries.

**Tasks completed**

- A3. Add retrieval tracing / stage diagnostics

**Tests/evals run**

- targeted unit coverage for vector-store and retrieval trace behavior;
- TypeScript/build validation.

**Behavior impact**

- retrieval ranking/selection behavior is unchanged;
- observability and future baseline reporting are improved.

**Next slice**

- Sequence 1D: run baseline retrieval report and capture benchmark artifacts.

#### Slice 1D — Baseline retrieval report (initial capture)

**What changed**

- ran the retrieval-focused AI eval subset against the live demo workspace and
  saved the first milestone-owned baseline report to `test-results/`;
- captured machine-readable retrieval metrics and human-readable summary output
  for the benchmark cases that completed before the worker failed;
- identified an environment/runtime stability issue during the eval run: a
  stale Electron process was holding the fixed renderer port, and a later test
  still hit a page-closed / worker-teardown failure.

**Baseline artifacts**

- `test-results/ai-eval-report.json`
- `test-results/ai-eval-report.txt`

**Observed baseline (initial subset)**

- model: `qwen3.5:27b`
- completed tests before worker failure: `T01`, `T02`, `T05`
- overall score: `11.1%` (Poor)
- expected-source hit rate: `0%`
- required-term coverage: `0%`
- citation presence rate: `0%`
- average latency on the completed factual/detail turns: ~65–67s

**Known weaknesses exposed by the baseline**

- the current retriever frequently returns no usable grounded answer for direct
  factual and contact-detail questions;
- multi-document accident-workflow synthesis is failing before evidence is
  assembled into a usable answer;
- citation behavior is absent in the captured baseline subset;
- runtime stability for long AI eval runs still needs hardening before the full
  retrieval benchmark sweep can be treated as reliable.

**Behavior impact**

- retrieval behavior is still unchanged;
- Milestone 23 now has a saved baseline artifact, but the full retrieval subset
  should be re-run after AI-eval stability is hardened.

#### Slice 1D follow-up — AI eval stability hardening + full retrieval subset rerun

**What changed**

- hardened Electron-based eval startup by allowing test runs to bind the
  renderer server on an ephemeral port instead of the fixed development port;
- hardened test shutdown by bypassing the unsaved-close interception in test
  mode and adding bounded fixture teardown with forced process cleanup as a
  fallback;
- re-ran the full retrieval-focused benchmark subset after the stability fix and
  replaced the partial baseline with a complete eight-test retrieval report.

**Updated baseline artifacts**

- `test-results/ai-eval-report.json`
- `test-results/ai-eval-report.txt`

**Updated baseline (full retrieval subset)**

- model: `qwen3.5:27b`
- completed tests: `T01`, `T02`, `T05`, `T07`, `T08`, `T09`, `T15`, `T17`
- overall score: `66.7%` (`Needs Work`)
- expected-source hit rate: `36%`
- required-term coverage: `64%`
- citation presence rate: `27%`
- average forbidden violations: `0.09`

**Primary failures now exposed by the fuller baseline**

- `T07` source attribution remains a hard failure: the system is still weak at
  citation-oriented retrieval/answering for recommended repair shops;
- `T15` deep retrieval remains a hard failure: the retriever is still missing
  the total-loss-threshold / KBB-style evidence path;
- `T17` remains only partially successful because the third turn still failed
  to progress cleanly through the chat input lifecycle, even though the overall
  test run now completes reliably.

**Behavior impact**

- retrieval runtime behavior remains unchanged;
- the milestone now has a materially more trustworthy baseline for Phase B
  retrieval work, and the next implementation slices should target citation
  weakness, deep retrieval weakness, and the remaining multi-turn UI/runtime
  instability.

### 2026-03-07 — Sequence 2 foundation: retrieval metadata schema + persistence

**What changed**

- added an additive retrieval metadata schema for chunk-level structure and
  source-level extraction/classification details;
- extended chunk production so indexed chunks now carry heading breadcrumbs,
  immediate parent breadcrumbs, and coarse structural roles;
- persisted source metadata including document kind, extraction pipeline,
  fallback state, and classifier confidence/reason alongside existing summaries;
- surfaced the richer metadata through vector/keyword retrieval result shapes
  without changing ranking or answer behavior yet;
- bumped the indexing pipeline version so existing workspaces reindex cleanly
  and populate the new metadata fields.

**Files changed**

- `src/built-in/canvas/migrations/011_retrieval_metadata.sql`
- `src/services/chunkingService.ts`
- `src/services/indexingPipeline.ts`
- `src/services/vectorStoreService.ts`
- `src/services/serviceTypes.ts`
- `tests/unit/indexingPipeline.test.ts`
- `tests/unit/vectorStoreService.test.ts`

**Why this slice matters**

- `T07` and `T15` are currently failing partly because the retriever has no
  persisted notion of section ancestry, structural role, or extraction quality;
- this slice does not tune ranking yet, but it creates the durable metadata
  needed for later query decomposition, section expansion, and reranking work;
- parent breadcrumb storage provides the minimum parent-child retrieval
  primitive needed for later expansion passes.

**Behavior impact**

- retrieval answers should remain behaviorally unchanged for now;
- indexing now records richer metadata and forces a clean rebuild via pipeline
  version `3`, preparing the system for later Phase C/D/E ranking logic.

### 2026-03-07 — Sequence 3 initial slice: guarded query planning

This first Phase C slice upgrades candidate generation in the retrieval service
without introducing a new heavyweight ranking model.

**Implemented**

- added lightweight query-planning heuristics in `RetrievalService` to classify
  questions as simple vs hard before searching;
- kept identifier-heavy prompts on a single-query fast path so exact-match
  retrieval remains protected for values like dollar amounts, percentages,
  acronyms, filenames, and phone numbers;
- added guarded query rewriting that strips obvious prompt filler while
  preserving critical identifiers;
- added bounded query decomposition for multi-clause / cross-source questions
  and merged the resulting candidate pools before downstream filtering;
- made candidate breadth adaptive by query class instead of using one fixed
  overfetch multiplier for every request;
- extended retrieval trace output so later eval work can inspect the generated
  query plan and per-search trace set.

**Files changed**

- `src/services/retrievalService.ts`
- `tests/unit/retrievalService.test.ts`

**Why this slice matters**

- it directly targets the planned C2/C3/C4 work while staying local-first and
  preserving the existing hybrid retriever as the underlying search engine;
- it creates a measurable query-planning layer that can be tuned against `T07`,
  `T15`, and `T17` before any heavier Phase D reranking work lands;
- it reduces the chance that complex questions are forced through the same
  narrow candidate path as simple fact lookups.

**Behavior impact**

- simple identifier-sensitive prompts remain on the fast path;
- harder, multi-clause prompts can now fan out into multiple bounded retrieval
  queries before score filtering, cosine reranking, dedup, and token packing;
- retrieval traces now capture enough planning context to support the later C1
  benchmark-retuning pass.

### 2026-03-06 — Sequence 3 tuning: lexical focus and heading-aware boosts

This follow-up Phase C tuning pass targeted the first benchmark regressions seen
after the initial query-planning slice.

**Implemented**

- excluded citation-formatting phrases from hard-query classification so prompts
  like "Please cite your sources" no longer create bad decomposition branches;
- added a lightweight keyword-focused lexical rewrite for simple,
  non-identifier prompts so the lexical half of hybrid retrieval can search on
  denser terms like `repair shops recommended` without losing the original
  semantic embedding query;
- added a small heading/context-prefix overlap boost so chunks whose section or
  source heading directly matches the lexical focus terms are favored in the
  fused candidate set;
- added unit coverage for the new lexical rewrite and heading-aware boost.

**Files changed**

- `src/services/retrievalService.ts`
- `tests/unit/retrievalService.test.ts`

**Validation**

- `npx tsc --noEmit` ✅
- `npx vitest run tests/unit/retrievalService.test.ts` ✅
- targeted AI eval reruns on `T07` and `T15` showed mixed but directional
  behavior: one rerun improved `T07` from `0%` to `50%` with citation presence
  restored, while repeated reruns still showed model/runtime instability via
  intermittent empty responses.

**Interpretation**

- the retrieval-side changes are helping candidate focus, but the end-to-end
  benchmark remains noisy because the current eval path can still fail with
  empty model responses;
- before further C1 tuning, the next best step is to expose or capture runtime
  retrieval traces during the AI eval path so candidate quality can be measured
  independently from response-generation flakiness.

---

## Migration & Compatibility

### In scope for migration

- schema expansion for retrieval metadata,
- index rebuilds when required,
- retrieval trace schemas,
- UI additions for retrieval tuning.

### Compatibility rules

1. Existing workspaces must remain indexable.
2. Retrieval settings migration must preserve sensible defaults.
3. If a harder retrieval path is unavailable, Parallx must fall back to the
   baseline hybrid path rather than fail.
4. Local-first remains mandatory for the default experience.

### Explicit non-goals for this milestone

- cloud-only reranking dependencies,
- replacing the entire chat system,
- changing the local-first product promise,
- unlimited retrieval passes,
- over-optimizing for benchmarks at the expense of latency.

---

## Evaluation Strategy

Milestone 23 is only successful if retrieval quality becomes measurable and the
new system beats the baseline on real Parallx tasks.

### Benchmark categories

1. **Exact identifier retrieval**
   - filenames,
   - symbols,
   - config keys,
   - API names.

2. **Cross-source architecture retrieval**
   - docs + code + notes questions.

3. **PDF / extracted-doc retrieval**
   - page-range questions,
   - section questions,
   - table/caption-sensitive questions.

4. **Follow-up / conversational retrieval**
   - questions that rely on prior source focus.

5. **Multi-hop retrieval**
   - questions/ that need multiple evidence pieces before synthesis.

### Required reporting

For every major retrieval upgrade, produce:

- before/after metric table,
- latency table by stage,
- representative wins,
- representative regressions,
- tuning decision and rationale.

### Ship criteria

Milestone 23 should not be considered complete unless:

- benchmark coverage exists,
- at least one stronger ranking path beats baseline,
- complex-question retrieval improves measurably,
- PDF / structured-doc retrieval shows measurable gains,
- no unacceptable regression in local interaction latency is introduced.

---

## Task Tracker

### Phase A — Measurement First
- [x] A1. Build Parallx retrieval benchmark set
- [x] A2. Define milestone-owned retrieval metrics
- [x] A3. Add retrieval tracing / stage diagnostics

### Phase B — Index & Metadata Overhaul
- [x] B1. Extend retrieval index schema for richer metadata
- [x] B2. Add parent-child structural retrieval primitives
- [x] B3. Add extraction-quality metadata to ranking inputs

### Phase C — Candidate Generation 2.0
- [ ] C1. Re-evaluate hybrid retrieval composition against benchmarks
- [ ] C2. Add query decomposition for hard questions
- [ ] C3. Add guarded query rewriting / expansion
- [ ] C4. Make candidate breadth adaptive by query type

### Phase D — Ranking & Evidence Selection
- [ ] D1. Add stronger second-stage ranking layer
- [ ] D2. Add diversity-aware evidence selection
- [ ] D3. Add evidence-role-aware context packing
- [ ] D4. Improve token-budget packing strategy

### Phase E — Structure-Aware Retrieval
- [ ] E1. Add parent-section / page expansion at retrieval time
- [ ] E2. Add table/code/figure-aware evidence handling
- [ ] E3. Pilot late-interaction reranking for hard cases

### Phase F — Evidence-Sufficient Answering
- [ ] F1. Add evidence sufficiency checks
- [ ] F2. Add retrieve-again behavior
- [ ] F3. Add abstain / clarify path for thin evidence

### Phase G — Product Surface & Rollout
- [ ] G1. Expand retrieval settings and defaults safely
- [ ] G2. Add retrieval diagnostics UI/dev tooling
- [ ] G3. Gate rollout with eval thresholds

---

## Verification Checklist

- [ ] Baseline retrieval benchmark exists and is repeatable
- [ ] Retrieval traces can explain why evidence was selected or dropped
- [ ] Hybrid retrieval remains strong on identifier-heavy queries
- [ ] Hard-question recall improves over baseline
- [ ] Final evidence sets show lower redundancy
- [ ] PDF / long-doc retrieval improves on benchmark questions
- [ ] Evidence-insufficient questions trigger retrieve-again or abstain behavior
- [ ] Local-first defaults remain intact
- [ ] `tsc --noEmit` clean after each implementation slice
- [ ] Relevant unit/eval tests pass after each implementation slice

---

## Risk Register

### Risk 1 — Retrieval quality improves but latency regresses too far
**Mitigation**
- require stage-level latency reporting;
- keep simple questions on the light path;
- reserve expensive retrieval modes for hard queries.

### Risk 2 — Query decomposition harms exact-match questions
**Mitigation**
- preserve the raw query;
- add decomposition only behind query classification;
- test identifier-heavy prompts separately.

### Risk 3 — Richer metadata increases indexing cost too much
**Mitigation**
- add schema incrementally;
- separate must-have metadata from experimental metadata;
- benchmark rebuild cost.

### Risk 4 — Diversity logic accidentally drops the single best evidence
**Mitigation**
- diversity is a post-retrieval balancing step, not a hard replacement for
  relevance;
- measure answer correctness, not diversity in isolation.

### Risk 5 — Late-interaction experiments consume too many local resources
**Mitigation**
- keep them hard-case and opt-in at first;
- benchmark memory, index size, and rerank latency;
- preserve a strong default path without multivector dependency.

### Risk 6 — The system becomes too complex to reason about
**Mitigation**
- keep the retrieval pipeline explicitly staged;
- add tracing and milestone-owned diagrams;
- require every new stage to justify itself with metrics.

---

## Milestone Summary

Milestone 23 is the point where Parallx stops treating retrieval as a helper and
starts treating it as an evidence system.

The goal is not to make retrieval merely *more complex*.

The goal is to make it:

- more measurable,
- more selective,
- more coverage-aware,
- more structure-aware, and
- more grounded.

That is the retrieval foundation required for Parallx to feel truly reliable on
workspace-scale knowledge tasks.
