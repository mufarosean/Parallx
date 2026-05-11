# Parallx Default Chat Surface Crossover Contract

**Status:** Default-surface migration implemented; contract retained as the maintenance boundary  
**Date:** 2026-03-24  
**Purpose:** Define the concrete migration Parallx will follow to move the main
default chat surface from workflow-led behavior to runtime-owned autonomous
behavior without reintroducing split-brain execution.

---

## 1. Why This Document Exists

The claw runtime migration solved the ownership problem at the orchestration
layer, but the main user-facing chat surface still preserves too much legacy
semantic authority.

Today, the runtime shell is real, but the default surface can still be pushed
into the wrong behavior by:

- front-door workflow classification,
- workflow-specific deterministic answer shortcuts,
- planner assumptions that are treated as semantic truth rather than evidence
  strategy.

That means Parallx can have the correct files, the correct provenance, and the
correct runtime boundaries, yet still answer the wrong question because coded
workflow semantics overruled the user's actual intent.

This document is the execution contract that governed that migration and now defines the guardrails for keeping the default surface migrated.

---

## 2. Problem Statement

The historical problem was that the default chat surface was too willing to let
code decide what the user "really meant" before the runtime reached synthesis.

The concrete failure shape that this migration removed was:

1. `chatTurnSemantics.ts` classifies broad request shape too aggressively.
2. `chatTurnRouter.ts` turns those hints into workflow authority.
3. `chatExecutionPlanner.ts` builds a workflow-shaped plan.
4. `chatDeterministicAnswerSelector.ts` may bypass normal synthesis.
5. `chatDeterministicExecutors.ts` can emit a narrow canned answer that fits
   the workflow label better than the actual request.

This is acceptable for narrow structural fast-paths.
It is not acceptable for the primary user-facing chat surface.

---

## 3. Governing Decision

For the default chat surface:

**Workflow classification is no longer allowed to act as semantic authority.**

It may remain only as:

- an evidence-gathering hint,
- an output-format hint,
- a bounded structural fast-path trigger when the user request is explicit and
  the runtime can prove the transformation is lossless.

It may not remain as:

- a substitute for user intent,
- a reason to bypass synthesis for broad grounded requests,
- a reason to reinterpret summarization requests as extraction requests,
- a reason to emit a domain-specific canned answer unless the user explicitly
  requested that exact structural operation.

---

## 4. Default Surface Target

The target behavior for the main chat surface is:

`user turn -> explicit parse -> bounded route decision -> runtime context/evidence -> model-led synthesis under runtime control -> bounded post-processing`

The important change is this:

the runtime may shape evidence collection, but it must stop pre-answering the
meaning of broad user requests through embedded workflow semantics.

### 4.1 What remains runtime-owned

- explicit parsing,
- participant and mode selection,
- approvals,
- tool control,
- prompt authority,
- context assembly,
- evidence collection,
- trace and checkpoint emission,
- finalization and memory write-back.

### 4.2 What becomes model-led

- final semantic framing of broad grounded requests,
- deciding how to summarize a collection once evidence is assembled,
- deciding how to reconcile mixed evidence when the user asked for synthesis
  rather than extraction.

### 4.3 What remains deterministic

Deterministic handling is still allowed only for these categories:

- product-semantic explanations,
- off-topic redirects,
- explicit memory and transcript recall transforms,
- explicit structural enumeration where the request is plainly asking for listed
  contents,
- exact narrow transforms whose output can be proven to be a direct formatting
  of gathered evidence rather than a reinterpretation of intent.

If a deterministic path changes the semantic meaning of the request, it is out
of bounds for the default surface.

---

## 5. File-Level Ownership Changes

### 5.1 `chatTurnSemantics.ts`

Target role:

- produce bounded hints only,
- identify explicit structural requests,
- identify safe direct-answer cases,
- stop inferring deep workflow meaning from loose phrasing.

Must stop doing:

- treating verbs like `list` as enough to convert a summary request into an
  extraction workflow,
- carrying domain-specific assumptions that are not lossless.

### 5.2 `chatTurnRouter.ts`

Target role:

- perform narrow route selection,
- carry forward hints with explicit confidence,
- never treat workflow type as unquestioned authority for default chat.

Must stop doing:

- promoting semantic hints into behavior that bypasses normal synthesis unless
  the request is explicitly structural.

### 5.3 `chatExecutionPlanner.ts`

Target role:

- plan evidence strategy,
- not decide final semantic meaning.

Implemented implication:

- `workflowType` is no longer a live default-surface route authority; in the
  default path the planner now behaves as an evidence-strategy layer even where
  older internal type names remain.
- summary, comparison, and extraction labels are planning aids, not answer
  authority.

### 5.4 `chatDeterministicAnswerSelector.ts`

Target role:

- gate only truly safe direct answers.

Must stop doing:

- short-circuiting broad grounded turns because a workflow label matched,
- using workflow type alone as sufficient justification for a deterministic
  answer.

### 5.5 `chatDeterministicExecutors.ts`

Target role:

- provide exact structural transforms only.

Must stop doing:

- domain-specific canned synthesis for `exhaustive-extraction`,
- assuming deductible extraction is the default meaning of broad extraction-like
  requests.

### 5.6 `chatDefaultRuntimeExecutionStage.ts` and downstream synthesis path

Target role:

- treat planner output as bounded evidence instructions,
- preserve synthesis as the default answering path for broad grounded requests.

---

## 6. Non-Negotiable Rules

1. The default chat surface must not have two semantic authorities.
2. The planner may choose evidence steps; it may not redefine the user's goal.
3. Deterministic answers must be explainable as exact transforms of explicit
   requests plus gathered evidence.
4. Broad grounded requests must default to synthesis, not canned workflow
   output.
5. If the system is uncertain whether the user asked for summary vs extraction,
   it must preserve the broader interpretation and let synthesis answer from
   evidence.
6. Any temporary compatibility path must be named, tested, and tracked for
   removal.

---

## 7. Execution Plan

### Phase A — Bound semantic authority

Changes:

- narrow `chatTurnSemantics.ts` so workflow inference only fires for explicit
  structural phrasing,
- add confidence or explicitness metadata to workflow hints,
- keep conversational, off-topic, product, memory, and transcript routing.

Success gate:

- broad folder-summary prompts with verbs like `summarize`, `describe`, or `give
  me a short summary of each file` do not get reclassified as extraction because
  they also contain `list` or similar lexical noise.

### Phase B — Demote workflow labels from answer authority to planning hints

Changes:

- route carries planning hints, not answer authority,
- planner continues to choose enumeration/read/retrieve steps,
- synthesis remains the normal answer path for broad grounded turns.

Success gate:

- the runtime can still gather exhaustive evidence without using that workflow
  label to bypass synthesis.

### Phase C — Shrink deterministic answer surface

Changes:

- remove workflow-based deterministic answers for broad summary/comparison /
  extraction requests,
- preserve only direct-answer paths that are provably safe and lossless,
- move any remaining structural transforms behind explicit request-shape checks.

Success gate:

- a request can no longer produce a deductible-focused canned answer merely
  because `workflowType === 'exhaustive-extraction'`.

### Phase D — Rename the concept after behavior is corrected

Changes:

- migrate `workflowType` terminology toward `evidenceStrategy` or equivalent
  once runtime behavior no longer treats it as semantic authority.

Success gate:

- code names reflect actual ownership rather than preserving misleading legacy
  semantics.

---

## 8. Immediate First Slice

The first implementation slice should be deliberately small and high leverage.

### Slice 1

1. Tighten `classifyWorkflowType(...)` so `exhaustive-extraction` requires an
   explicit extraction ask, not merely `list` plus exhaustive language.
2. Prevent `chatDeterministicAnswerSelector.ts` from using workflow labels alone
   to short-circuit summary-like grounded requests.
3. Keep exhaustive evidence gathering intact so context quality does not regress.
4. Add regressions for the RF Guides style prompt that previously produced the
   wrong deductible answer despite correct file provenance.

This slice is the correct first move because it fixes the user-visible failure
without destabilizing the runtime shell.

---

## 9. Verification Contract

Implementation against this document is not complete until all of the following
are true.

### 9.1 Unit coverage

Add or update tests covering:

- summary vs extraction disambiguation in `chatTurnSemantics.ts`,
- deterministic answer suppression for broad grounded requests,
- planner continuity when deterministic workflow answers are removed,
- runtime execution preserving synthesis for exhaustive evidence cases.

Priority files:

- `tests/unit/chatTurnSemantics.test.ts` if missing,
- `tests/unit/chatGroundedExecutor.test.ts`,
- `tests/unit/chatTurnSynthesis.test.ts`,
- `tests/unit/chatRuntimeLifecycle.test.ts`,
- `tests/unit/chatService.test.ts` when route metadata changes.

### 9.2 AI-eval / E2E coverage

Add or preserve coverage for:

- folder-summary prompts with natural phrasing noise,
- explicit file-by-file summary requests,
- explicit extraction requests,
- enumeration-only requests,
- comparison requests that should still remain grounded and evidence-led.

### 9.3 Manual review gate

Before calling this crossover complete, verify that the main chat surface now
behaves like a runtime-owned assistant rather than a hidden workflow machine.

That review must explicitly check:

- broad chat turns feel model-led,
- structural requests remain accurate,
- provenance still matches the answer,
- no obvious split-brain path remains between planning and synthesis.

---

## 10. Anti-Regression Rules

Do not fix this by:

- adding more lexical exceptions to preserve the current workflow authority,
- piling new deterministic answer templates on top of existing ones,
- keeping two parallel meanings for `workflowType`,
- moving the same semantic authority into a differently named helper.

If a future change makes it harder to explain why the answer matched the user
request, it violates this contract.

---

## 11. Relationship To NemoClaw-Like Goals

This crossover does not mean Parallx should copy NemoClaw literally.

It means the main chat surface must finally reflect the same architectural
principle that motivated the claw redesign in the first place:

- runtime owns execution,
- tools remain bounded,
- approvals remain explicit,
- context remains grounded,
- the assistant is not secretly steered by a brittle workflow classifier.

That is the missing user-facing migration.

---

## 12. Completion Condition

This contract is satisfied only when the default chat surface can be described
honestly as:

`runtime-owned, evidence-led, and synthesis-first`

and no longer as:

`runtime-owned shell wrapped around legacy workflow semantics`.