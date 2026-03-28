# Milestone 25 — AIR Product Behavior, E2E Quality, and Evaluation

> **Authoritative Scope Notice**
>
> This document is the single source of truth for Milestone 25.
> All AIR behavior, conversational-routing, grounded-answer balance,
> autonomous-task UX validation, deterministic Playwright coverage, and
> real-model AI evaluation work for this milestone must conform to the
> architecture, priorities, and task boundaries defined here.
>
> Milestones 9–24 established Parallx's local-first chat stack, retrieval
> pipeline, AI settings, workspace memory, evidence engine, and autonomous
> workspace agent runtime. This milestone does **not** primarily add new
> model capabilities. It turns those capabilities into a **product-quality AIR
> experience** that behaves correctly across conversational turns, grounded
> evidence turns, and autonomous delegated work, with comprehensive end-to-end
> validation that reflects how the best products in the industry behave.

---

## Table of Contents

1. [Problem Statement](#problem-statement)
2. [Current State Audit](#current-state-audit)
3. [Vision](#vision)
4. [Scope](#scope)
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

Parallx now has all the major AIR building blocks:

- local-first chat with Ollama,
- workspace retrieval and evidence assembly,
- context injection and memory recall,
- unified AI settings,
- autonomous workspace task runtime,
- approvals, traceability, and artifact summaries.

That is a strong technical foundation, but it does **not yet guarantee a
product-quality AIR experience**.

The current gaps are not primarily about missing primitives. They are about
**behavior quality**, **mode balance**, and **end-to-end confidence**.

Today the system can still fail in ways that users experience immediately:

1. **Conversational turns can feel contaminated by workspace behavior**
   - a simple greeting or identity question can still be shaped too strongly by
     workspace context, evidence rules, or tool availability.

2. **Grounded turns and conversational turns are not yet validated as a single product contract**
   - retrieval quality is measured;
   - autonomy safety is measured;
   - but the transition between lightweight conversation, evidence-grounded
     explanation, and autonomous task behavior is not yet tested as one system.

3. **Deterministic E2E coverage is still too narrow**
   - current Playwright chat tests prove context plumbing and isolation, but do
     not yet fully validate the AIR product behavior matrix.

4. **Autonomous UI behavior is under-tested end to end**
   - the backend autonomy scenarios are covered at the service/eval layer, but
     the chat task rail, approvals, blocked states, diagnostics, and artifact
     summaries are not yet validated comprehensively through the real UI.

5. **The AI eval harness is still stronger on retrieval than on AIR product behavior**
   - retrieval metrics are mature;
   - autonomy scenario rollup exists;
   - but AIR still lacks a dedicated product-quality dimension for:
     - conversational cleanliness,
     - grounded-answer discipline,
     - mode transitions,
     - autonomy communication quality.

6. **There is no single milestone-owned quality bar for AIR as a product**
   - without one, the system can pass retrieval tests and autonomy tests while
     still feeling rough or untrustworthy in normal daily use.

Milestone 25 fixes that by treating AIR as a **product behavior contract**,
not just a collection of subsystems.

---

## Current State Audit

### What the current system already does well

1. **Conversational routing has started to improve**
   - narrow conversational-turn gating now exists for simple greetings and
     identity-style prompts.

2. **Grounded answer infrastructure is strong**
   - retrieved context, evidence analysis, late retrieval retries, and citation
     repair already exist.

3. **Autonomous runtime layers are complete**
   - tasks, approvals, traces, artifact recording, memory, and blocked-state
     reasoning are implemented.

4. **Chat surfaces already expose autonomy state**
   - the task rail shows task status, approvals, artifact summaries, and
     diagnostics.

5. **Playwright coverage exists for core chat behavior**
   - chat context plumbing,
   - workspace chat isolation,
   - basic conversational balance.

6. **A thin AIR test-mode driver and first autonomy task-rail E2E slice now exist**
   - test mode can create, seed, run, resolve, continue, and inspect real
     workspace-scoped agent tasks through the chat debug surface;
   - deterministic product E2E now covers approval-pending, deny-blocked,
     approve-completed-with-artifacts, pause/continue, and outside-workspace
     blocked-diagnostics task-rail behavior.

7. **Mixed AIR mode-transition coverage has now started to exist deterministically**
   - the Playwright suite now includes a same-session flow that proves:
     - conversational greeting,
     - grounded current-page answer,
     - delegated task visibility,
     - and lightweight social follow-up behavior after delegated work is visible.

8. **Real-model AI eval already exists**
   - the suite runs against live Ollama and produces structured reports.

9. **A milestone-owned AIR behavior eval dimension now exists**
  - the AI eval harness now reports an `air-behavior` dimension;
  - first-pass live-model AIR cases now validate fresh-session identity
    cleanliness and grounded-to-social follow-up behavior;
  - additional live-model AIR cases now validate weak-evidence honesty and
    workspace-boundary explanation quality, and the weak-evidence rubric has
    been hardened against inferred earthquake-coverage hallucinations;
  - autonomy communication cases now validate approval-scope explanation and
    blocked-task recovery guidance, backed by a product-side explanation path
    instead of generic workspace retrieval;
  - completion-follow-up communication now also validates artifact guidance
    and task-trace explanation quality.

10. **The AIR E2E slice has already found and fixed one real runtime edge**
   - a stepwise-resumed task could remain in `planning` when all plan steps
     were already complete;
   - lifecycle and execution regression coverage now protect that resume path.

### What still lacks milestone-quality coverage

1. **No full AIR product-behavior matrix in Playwright**
   - there is not yet an authoritative full spec for the balance between:
     - conversational turns,
     - grounded evidence turns,
     - autonomous delegated runs.
   - however, the suite now includes one deterministic mixed-mode AIR flow;
     the remaining gaps are breadth, not absence.

2. **Autonomy E2E still lacks full deterministic breadth**
   - deterministic seeding now exists, and the matrix covers approvals,
     pause/continue, and outside-workspace blocked diagnostics;
   - remaining gaps are deeper diagnostics/memory
     assertions.

3. **Mode transition behavior is not yet measured explicitly**
   - we now assert one real same-session mode-balanced flow across:
     - conversational -> grounded -> delegated-visible -> conversational;
   - we still do not yet assert every planned transition such as:
     - grounded -> delegated,
     - delegated -> approval,
     - approval -> completion or block.

4. **AIR behavior scoring is now only partially complete**
   - the AI eval harness now has an explicit `air-behavior` dimension;
   - uncertainty handling, workspace-boundary explanation, approval-scope
     explanation, blocked-task recovery, completed-artifact guidance, and
     trace-explanation checks now exist;
   - remaining work is rollout-oriented reporting and milestone release gates.

5. **No milestone-owned rollout gate for AIR behavior quality**
   - broader AIR exposure should depend on passing product behavior thresholds,
     not only retrieval or autonomy backend thresholds.

### Current-state conclusion

Parallx has the AIR engine. It still needs the **AIR product-quality harness**.

That distinction is the reason this milestone exists.

---

## Vision

### Before M25

> Parallx has strong AIR subsystems, but behavior quality is still validated in
> fragments. The product can be correct in pieces without yet being proven
> polished, trustworthy, and mode-balanced as a whole.

### After M25

> Parallx AIR is validated as a complete product behavior system: it handles
> social conversation naturally, answers evidence-seeking questions with the
> right grounding discipline, and exposes autonomous delegated work through a
> safe and comprehensible UI — all backed by deterministic Playwright coverage
> and real-model AI evaluation.

### Product definition

Parallx AIR becomes a **mode-balanced workspace intelligence system**:

- natural when the user is just talking,
- disciplined when the user needs evidence,
- explicit and inspectable when the user delegates work,
- and measured against a milestone-owned quality bar.

---

## Scope

### In scope

- deterministic Playwright E2E coverage for conversational, grounded, and
  autonomous AIR behavior;
- test-only hooks required to drive autonomy through the real product UI in
  test mode;
- AIR behavior scoring additions in the real-model Playwright AI eval harness;
- milestone-owned AIR benchmark cases and rollout thresholds;
- product-level assertions for mode transitions and state hygiene;
- evaluation/report output updates for AIR behavior summaries.

### Out of scope

- replacing the model provider;
- large new autonomy features unrelated to validation quality;
- rewriting the retrieval engine again;
- broad UI redesigns outside the AIR task/chat surfaces;
- cloud-hosted evaluation or external SaaS dependence.

---

## Guiding Principles

1. **Test the product contract, not just the plumbing**
   - assertions should answer what the user experiences, not only what internal
     services return.

2. **Separate deterministic correctness from real-model quality**
   - mocked Playwright E2E proves structure and routing;
   - live-model AI eval proves answer quality and tone.

3. **Conversation should default to naturalness**
   - greetings, identity questions, acknowledgements, and short social turns
     should not be forced through evidence-heavy behavior.

4. **Grounding should remain explicit and disciplined**
   - when AIR uses evidence, that should be visible and appropriately cited;
   - when evidence is weak, AIR should narrow, caveat, or ask for clarification.

5. **Autonomy must stay inspectable**
   - approvals, blocked states, traces, diagnostics, and artifact summaries are
     first-class product requirements, not optional debug data.

6. **Test hooks must be thin and test-mode only**
   - any new Playwright driver hooks must wrap existing production services,
     never fork production behavior.

---

## Target Capabilities

By the end of M25, Parallx must be able to prove the following.

### Conversational behavior

- fresh-session greetings stay lightweight;
- identity questions avoid workspace contamination;
- social follow-ups after grounded turns do not keep unnecessary citations or
  evidence scaffolding;
- new sessions behave like a clean slate for visible chat behavior.

### Grounded answer behavior

- current-page evidence questions use page context correctly;
- workspace retrieval questions use retrieved evidence correctly;
- low-evidence questions stay honest and constrained;
- citation behavior matches actual evidence usage.

### Autonomous product behavior

- delegated tasks render visibly in chat;
- approval requests are actionable and understandable;
- deny paths remain blocked and artifact-free;
- approve paths complete and show artifact summaries;
- paused runs can continue cleanly;
- diagnostics remain readable and task-scoped.

### AIR behavior evaluation

- AIR has a dedicated quality dimension in the Playwright AI eval report;
- AIR benchmark cases include conversational cleanliness, grounded behavior,
  uncertainty handling, and autonomy communication quality;
- rollout logic can distinguish a technically working AIR stack from a product-
  quality AIR experience.

---

## Target Architecture

Milestone 25 should use two complementary validation layers.

### Layer A — Deterministic Playwright product E2E

Purpose:

- validate request payload shape,
- validate visible UI state,
- validate mode transitions,
- validate task-rail and approval interactions.

Characteristics:

- mocked Ollama routes;
- real Electron app;
- real workbench state;
- no fake DOM shortcuts except minimal test-only service hooks.

Primary outputs:

- `tests/e2e/26-air-product-behavior.spec.ts`
- potential additional helper utilities in `tests/e2e/fixtures.ts`

### Layer B — Real-model Playwright AIR eval

Purpose:

- measure actual AIR behavior quality under live inference;
- produce a milestone-owned AIR score and benchmark summary.

Characteristics:

- real Ollama inference;
- shared worker-scoped Electron app;
- scored benchmark cases and report output.

Primary outputs:

- `tests/ai-eval/ai-quality.spec.ts` updates or
- `tests/ai-eval/air-behavior.spec.ts`
- scoring/report updates in `tests/ai-eval/scoring.ts`

### Required test-only AIR hook

To make autonomy E2E reliable, expose a test-only AIR driver in the existing
chat debug surface when `window.parallxElectron?.testMode` is true.

Expected capabilities:

- create/seed delegated tasks,
- seed plan steps,
- run tasks,
- resolve approvals,
- inspect current task state.

This hook must wrap the real workspace-scoped services already registered in
the workbench.

---

## Phase Plan

### Phase A — AIR Test Foundations

Goal: create the deterministic hooks and helpers needed for comprehensive AIR
product tests.

### Phase B — Conversational vs Grounded Product E2E

Goal: codify the user-visible contract for lightweight conversation vs
evidence-based answering.

### Phase C — Autonomous Task Rail E2E

Goal: validate delegated task UI behavior end to end through the real product
surface.

### Phase D — AIR Quality Eval Expansion

Goal: add AIR behavior scoring to the live Playwright AI eval harness.

### Phase E — AIR Rollout Gates and Reporting

Goal: add milestone-owned thresholds, reporting, and rollout criteria for AIR
product quality.

---

## Implementation Sequence

The order matters. Product-level AIR testing should be built from deterministic
control toward live-model evaluation.

### Sequence 1 — Test foundations first

- implement Phase A before writing broad autonomy E2E coverage.

### Sequence 2 — Lock conversational and grounded routing

- implement Phase B before autonomy UI evaluation is broadened.

### Sequence 3 — Add autonomy UI product coverage

- implement Phase C after deterministic task seeding exists.

### Sequence 4 — Expand live-model AIR eval

- implement Phase D only after the deterministic AIR product contract is clear.

### Sequence 5 — Add rollout gates

- implement Phase E after AIR benchmark cases and scores exist.

### Ordering constraints

1. Do **not** rely on brittle DOM-only autonomy setup when a small test-mode
   service hook can drive the real runtime safely.
2. Do **not** collapse deterministic E2E and live-model AI eval into one suite.
3. Do **not** broaden AIR defaults based only on retrieval and autonomy backend
   metrics.
4. Do **not** ship AIR quality gates without human-readable reporting.

---

## Migration & Compatibility

This milestone should preserve:

- existing retrieval E2E tests,
- existing chat isolation tests,
- existing AI eval report structure, extended rather than replaced,
- existing autonomy backend benchmarks.

Any new AIR test hook must be:

- gated to test mode only,
- unavailable in production,
- thin over the existing services,
- documented in the milestone and any related AIR testing docs.

---

## Evaluation Strategy

### Deterministic product E2E matrix

Required minimum cases:

1. fresh-session greeting;
2. fresh-session identity question;
3. grounded current-page answer;
4. grounded retrieved answer;
5. conversational -> grounded -> conversational transition;
6. new session after grounded turn;
7. awaiting approval task rail state;
8. deny blocked task rail state;
9. approve completed task with artifact summary;
10. paused task continue path;
11. blocked outside-workspace task diagnostics.

### Real-model AIR eval dimensions

Required AIR additions:

1. conversational cleanliness;
2. grounded-answer discipline;
3. uncertainty handling;
4. mode-balance quality;
5. autonomy communication quality.

### Suggested AIR benchmark IDs

- `B01` Greeting remains natural
- `B02` Identity question avoids workspace contamination
- `B03` Grounded answer cites only when evidence is used
- `B04` Social follow-up drops stale evidence scaffolding
- `B05` Weak evidence response stays honest
- `B06` Approval explanation is clear
- `B07` Denied run explains the block and next step clearly
- `B08` Completed run summarizes artifacts and next steps clearly

### Rollout expectation

AIR should not broaden further by default until:

- deterministic AIR E2E cases are passing,
- AIR live-model behavior meets milestone thresholds,
- milestone AIR benchmarks `T22` through `T29` meet the release bar in the report,
- autonomy communication quality is acceptable,
- and manual review confirms the product feels mode-balanced.

---

## Task Tracker

### Phase A — AIR Test Foundations
- [x] A1. Add test-mode AIR driver hook over real chat/autonomy services
- [ ] A2. Add shared Playwright helpers for AIR task seeding and inspection
- [ ] A3. Document AIR testing architecture and hook contract

### Phase B — Conversational vs Grounded Product E2E
- [ ] B1. Add comprehensive conversational-turn E2E coverage
- [ ] B2. Add grounded-answer E2E coverage for current-page and retrieved evidence
- [x] B3. Add mode-transition E2E coverage across mixed turn types

### Phase C — Autonomous Task Rail E2E
- [x] C1. Add awaiting-approval task rail E2E coverage
- [x] C2. Add deny-blocked task rail E2E coverage
- [x] C3. Add approve-complete artifact summary E2E coverage
- [x] C4. Add pause/continue and diagnostics E2E coverage

### Phase D — AIR Quality Eval Expansion
- [x] D1. Add AIR behavior benchmark cases to Playwright AI eval
- [x] D2. Add AIR quality dimensions to scoring/report output
- [x] D3. Add autonomy communication quality evaluation cases

### Phase E — Rollout Gates & Reporting
- [x] E1. Add AIR behavior summary to evaluation report
- [x] E2. Add AIR rollout gate thresholds and manual-review gate
- [x] E3. Document milestone-owned AIR quality bar and release criteria

---

## Verification Checklist

- [ ] Conversational greetings in fresh sessions do not trigger evidence-heavy behavior
- [ ] Identity questions remain conversational and unpolluted by workspace content
- [ ] Grounded answers include evidence only when appropriate
- [x] Low-evidence answers remain honest and constrained
- [x] Mode transitions remain stable within the same session
- [ ] New sessions behave like a visible clean slate after grounded turns
- [x] Awaiting approval state is visible and actionable in the task rail
- [x] Denied actions remain blocked and artifact-free in the UI
- [x] Approved runs surface artifacts and next-step guidance in the UI
- [x] Paused tasks can continue and update visibly in the UI
- [x] Blocked outside-workspace runs expose readable diagnostics
- [x] AIR explains approval, blocked, artifact, and trace semantics clearly
- [x] AIR live-model evaluation includes conversational and autonomy communication quality
- [x] AIR report output includes milestone-owned behavior summaries and rollout status
- [x] Relevant deterministic Playwright tests pass
- [x] Relevant AI eval Playwright runs pass or produce acceptable scored output

Phase E implementation note:

- the evaluation report now emits an `AIR BEHAVIOR SUMMARY` section with per-benchmark status for `T22` through `T29`;
- the report now emits an `AIR BEHAVIOR ROLLOUT GATE` section with explicit thresholds for identity cleanliness, grounded-to-social balance, weak-evidence honesty, workspace-boundary explanation, approval scope, blocked recovery, artifact guidance, and trace explanation;
- default rollout remains blocked until both the AIR thresholds pass and `PARALLX_AIR_MANUAL_REVIEW_APPROVED=1` is set for the release run.

---

## Risk Register

### Risk 1 — Overfitting to mocked E2E

If deterministic tests become too mocked, AIR can pass E2E while still feeling
bad under real inference.

Mitigation:

- keep deterministic E2E for structure;
- keep real-model AI eval for actual quality.

### Risk 2 — Brittle autonomy UI tests

If autonomy E2E depends on accidental DOM details or race-prone setup,
maintenance cost will spike.

Mitigation:

- add a thin test-mode driver hook over real services;
- assert only on stable, user-facing task-rail outputs.

### Risk 3 — AIR score inflation without user-trust gains

AIR may pass benchmark cases while still feeling awkward in open-ended use.

Mitigation:

- require manual review alongside rollout gates;
- score conversational cleanliness and mode transitions explicitly.

### Risk 4 — Scope drift back into feature work

This milestone can easily expand into building more AIR features instead of
validating the product behavior contract.

Mitigation:

- keep the scope centered on testing, evaluation, and rollout quality;
- defer unrelated AIR features unless they are required to make the contract
  testable.

### Risk 5 — Production leakage from test hooks

Test-only driver surfaces could accidentally persist into production behavior.

Mitigation:

- gate hooks strictly behind `testMode`;
- keep them wrapper-only;
- avoid any production call sites.