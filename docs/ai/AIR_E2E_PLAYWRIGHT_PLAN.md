# AIR E2E Playwright Plan

**Date:** 2026-03-08  
**Status:** In progress  
**Goal:** Add a comprehensive Playwright-based AIR validation suite that covers conversational behavior, grounded evidence behavior, and autonomous task behavior at a product level.

## Implementation update — 2026-03-08

Implemented in this first slice:

- added a thin test-mode AIR driver on `window.__parallx_chat_debug__.agent` in `src/built-in/chat/main.ts`;
- added `tests/e2e/26-air-product-behavior.spec.ts` for deterministic autonomous task-rail coverage;
- added a mixed-mode deterministic AIR flow covering conversational -> grounded -> delegated-visible -> social follow-up behavior in one session;
- added a milestone-owned `air-behavior` dimension to the live-model AI eval harness;
- added and validated two first-pass AIR eval cases: fresh-session identity cleanliness and grounded-to-social follow-up behavior;
- added and validated two more AIR eval cases for weak-evidence honesty and workspace-boundary explanation quality;
- added and validated two autonomy-communication AIR eval cases for approval-scope explanation and blocked-task recovery guidance;
- added and validated two more autonomy-communication AIR eval cases for completed-artifact guidance and task-trace explanation quality;
- hardened the weak-evidence rubric so inferred earthquake-coverage claims are treated as AIR failures rather than partial passes;
- added a narrow product-semantics answer path so AIR answers approval-scope and blocked-workspace recovery questions from known app behavior instead of irrelevant workspace retrieval;
- extended that product-semantics path so AIR also answers artifact-guidance and task-trace questions from known app behavior instead of irrelevant workspace retrieval;
- tightened task-rail wording for pending approvals, blocked states, and completion summaries, then enforced that wording through unit and deterministic Playwright coverage;
- added task-detail helper text so completed-run artifacts and recorded traces are explained in the UI as product semantics rather than opaque diagnostics;
- validated approval-pending, deny-to-blocked, approve-to-completed-with-artifacts, pause/continue, and outside-workspace diagnostics behavior through the real chat task rail;
- fixed a runtime lifecycle edge so a task can complete cleanly from `planning` when all plan steps are already finished after a continue/resume path.

Validated with:

- `npx vitest run tests/unit/agentLifecycle.test.ts tests/unit/agentExecutionService.test.ts`
- `npm run build`
- `npx playwright test tests/e2e/25-chat-conversation-balance.spec.ts tests/e2e/26-air-product-behavior.spec.ts`
- `npx playwright test --config=playwright.ai-eval.config.ts --grep "T22|T23"`
- `npx playwright test --config=playwright.ai-eval.config.ts --grep "T24|T25"`
- `npx vitest run tests/unit/chatService.test.ts tests/unit/chatAutonomyUI.test.ts`
- `npx playwright test tests/e2e/26-air-product-behavior.spec.ts`
- `npx playwright test --config=playwright.ai-eval.config.ts --grep "T26|T27"`
- `npx playwright test --config=playwright.ai-eval.config.ts --grep "T28|T29"`

---

## Why the current tests are not enough

Today the repository has three useful but incomplete layers:

1. **Deterministic chat E2E** in `tests/e2e/23-chat-context.spec.ts`, `tests/e2e/24-workspace-chat-isolation.spec.ts`, and `tests/e2e/25-chat-conversation-balance.spec.ts`.
2. **Real-model AI eval** in `tests/ai-eval/ai-quality.spec.ts`.
3. **Service-backed autonomy evaluation** in `tests/ai-eval/autonomyScenarioRunner.ts`.

Those layers prove pieces of the system, but they do not yet prove the full AIR product contract that users experience:

- conversational turns should feel natural,
- evidence-seeking turns should feel grounded,
- the system must transition cleanly between those modes,
- autonomous task UX must remain safe, inspectable, and understandable.

The missing piece is a **single coherent Playwright plan** that treats AIR as a product, not just as retrieval plumbing plus backend autonomy scenarios.

---

## Target quality bar

We are not trying to beat frontier models at raw intelligence. We are trying to match the best products in user-facing behavior:

1. **ChatGPT / Claude conversational mode**
   - greetings stay lightweight,
   - identity questions do not trigger workspace contamination,
   - follow-up social turns do not inherit citations or tool scaffolding.

2. **Copilot / grounded assistant mode**
   - evidence-seeking questions use the right workspace context,
   - citations appear only when the answer is grounded in retrieved evidence,
   - low-evidence situations fail honestly instead of hallucinating.

3. **Agent / autonomy mode**
   - delegated tasks are visible,
   - approvals are explicit,
   - blocked states are actionable,
   - artifacts and traces are inspectable,
   - autonomous runs stay inside policy and workspace boundaries.

---

## Recommended test architecture

Do **not** collapse everything into one giant spec. Use two Playwright layers:

### Layer A — Deterministic product E2E

**Config:** `playwright.config.ts`  
**Purpose:** UI and payload correctness with Ollama mocked.  
**Guarantee:** Product behavior is structurally correct and stable.

This layer should assert:

- what the user sees,
- what request payload is sent,
- when tools are or are not present,
- when citations are or are not visible,
- how autonomy task cards render and transition.

### Layer B — Real-model AIR quality eval

**Config:** `playwright.ai-eval.config.ts`  
**Purpose:** Behavioral quality with real Ollama inference.  
**Guarantee:** AIR feels right, not just wired right.

This layer should score:

- conversational quality,
- grounded answer quality,
- mode transitions,
- follow-up handling,
- autonomy safety/completion quality.

Both layers are Playwright. They serve different purposes and should remain separate.

---

## Proposed deterministic E2E suite

### File target

- `tests/e2e/26-air-product-behavior.spec.ts`

### Group 1: Conversational mode

These tests should use intercepted Ollama requests and assert the exact payload sent to the model.

1. **Fresh-session greeting**
   - Prompt: `hello`
   - Assert: no `[Retrieved Context]`, no current-page injection, no tools, no `Sources:` footer.

2. **Identity question**
   - Prompt: `who are you`
   - Assert: no retrieval payload, no citations, no workspace contamination.

3. **Social check-in**
   - Prompt: `how's it going`
   - Assert: same lightweight path as greeting.

4. **Post-grounding conversational follow-up**
   - Flow:
     - ask grounded workspace question,
     - then ask `thanks` or `got it`.
   - Assert: follow-up does not reuse citations or evidence scaffolding unnecessarily.

### Group 2: Grounded evidence mode

1. **Current-page evidence question**
   - Assert: current-page content appears in user payload.
   - Assert: answer renders without `Sources:` when grounded only by injected page context.

2. **Workspace retrieval question**
   - Prompt should force real retrieved context.
   - Assert: `[Retrieved Context]` exists in payload.
   - Assert: visible citations or source footer only for grounded answers.

3. **Low-evidence question**
   - Intercept model to respond conservatively.
   - Assert: UI shows uncertainty / caveat behavior rather than fake certainty.

4. **Mode transition: conversational -> grounded -> conversational**
   - Same session, three turns.
   - Assert payload changes per turn:
     - first turn lightweight,
     - second turn grounded,
     - third turn lightweight again.
   - Status: implemented for conversational -> grounded -> delegated-visible -> social follow-up in `tests/e2e/26-air-product-behavior.spec.ts`.

### Group 3: Session and workspace hygiene

1. **New session clean slate**
   - Grounded turn in session A.
   - New session.
   - Greeting in session B.
   - Assert no prior evidence scaffolding bleeds into the new session payload.

2. **Workspace switch clean slate**
   - Reuse the workspace-switch E2E pattern.
   - Assert conversation and autonomy UI do not bleed between workspaces.

### Group 4: Autonomous task rail UX

This is the largest current gap.

Recommended assertions:

1. **Awaiting approval card renders correctly**
   - visible status,
   - approval explanation,
   - action buttons,
   - no artifacts yet.

2. **Approve once transitions to completion**
   - approval disappears,
   - task status updates,
   - artifact summary appears,
   - recommended next step appears.

3. **Deny transitions to blocked**
   - blocked reason visible,
   - no artifact summary,
   - actionable next step visible.

4. **Pause after step / continue**
   - task enters paused state,
   - continue resumes,
   - task completes or returns to planning.
   - Status: implemented.

5. **Outside-workspace blocked task**
   - blocked code/reason visible in task diagnostics,
   - trace summary visible,
   - no artifacts recorded.
   - Status: implemented.

6. **Expanded diagnostics view**
   - trace entries present,
   - memory count present,
   - approvals count present,
   - artifact count present.
   - Status: initial trace/approval diagnostics coverage implemented; memory-count coverage still pending.

---

## Required test hook for autonomy E2E

Current test mode now exposes a deterministic AIR driver through `__parallx_chat_debug__.agent` for creating and advancing agent tasks through the real workspace-scoped services.

Implemented driver capabilities:

- `seedTask(seed)`
- `createTask(input, taskId?)`
- `setPlanSteps(taskId, steps)`
- `runTask(taskId)`
- `resolveApproval(taskId, requestId, resolution)`
- `continueTask(taskId)`
- `listTasks()` / `getTask(taskId)` / `getDiagnostics(taskId)`

Scope constraints:

- only in `window.parallxElectron?.testMode`,
- thin wrapper over existing services,
- no production-only behavior changes.

This is better than trying to manufacture autonomy state through fake DOM or model-output side effects.

---

## Proposed real-model AI eval expansion

### File target

- extend `tests/ai-eval/ai-quality.spec.ts`
- or add `tests/ai-eval/air-behavior.spec.ts`

### New dimensions to score

1. **Conversational cleanliness**
   - greeting quality,
   - identity question quality,
   - social follow-up quality,
   - absence of irrelevant citations or document contamination.

2. **Mode balance**
   - does AIR switch appropriately between conversational and grounded behavior across adjacent turns?

3. **Uncertainty handling**
   - when evidence is weak, does AIR narrow the answer or ask for clarification?

4. **Autonomous UX quality**
   - approval wording clarity,
   - blocked-state explanation clarity,
   - completion summary usefulness,
   - artifact summary usefulness,
   - trace/diagnostic comprehensibility.

Implementation status:

- a milestone-owned `air-behavior` dimension now exists in the report;
- the first live-model AIR cases validate fresh-session identity cleanliness and grounded-to-social follow-up behavior;
- uncertainty handling, workspace-boundary explanation, approval-scope explanation, and blocked-task recovery cases now exist and have focused validation coverage;
- completed-artifact guidance and task-trace explanation cases now also exist and have focused validation coverage.
- the final report now includes an `AIR BEHAVIOR SUMMARY` section and an `AIR BEHAVIOR ROLLOUT GATE` section backed by milestone-owned thresholds and a manual AIR review gate.

### Suggested benchmark cases

1. `B01` Greeting remains natural
2. `B02` Identity question avoids workspace contamination
3. `B03` Grounded question cites only when using retrieved evidence
4. `B04` Social follow-up after grounded turn drops citations
5. `B05` Weak evidence response stays honest
6. `B06` Approval prompt is understandable and specific
7. `B07` Denied run explains block and next step clearly
8. `B08` Completed run summarizes artifacts and next steps clearly

---

## Execution order

### Step 1

Add the autonomy test hook in test mode only.

### Step 2

Create `tests/e2e/26-air-product-behavior.spec.ts` with deterministic payload/UI assertions.

### Step 3

Extend `tests/ai-eval/ai-quality.spec.ts` with a new AIR behavior dimension and benchmark IDs.

### Step 4

Add rollout reporting for the new AIR behavior dimension beside retrieval and autonomy summaries.

Status: implemented in `tests/ai-eval/scoring.ts`, including benchmark-level rollout checks for `T22` through `T29` and the `PARALLX_AIR_MANUAL_REVIEW_APPROVED` release gate.

---

## Pass criteria

### Deterministic E2E must prove

1. conversational turns do not accidentally ground,
2. grounded turns do ground,
3. transitions between those modes are stable,
4. autonomy UI is actionable and correct.

### Real-model AIR eval must prove

1. conversational dimension >= target threshold,
2. grounded dimension >= target threshold,
3. mode-balance cases pass,
4. autonomy communication quality passes,
5. no obvious frontier-gap regressions remain in the final report,
6. AIR rollout reporting shows benchmark-level pass status for `T22` through `T29`,
7. AIR default rollout remains blocked until the manual AIR review gate is approved.

---

## Concrete recommendation

With the first autonomy slice now implemented, the next highest-value expansion is:

- continue broadening deterministic conversational/new-session hygiene coverage, while keeping rollout readiness owned by the new AIR report and gate sections.

1. broaden `tests/e2e/26-air-product-behavior.spec.ts` with conversational identity and mixed mode-transition cases,
2. add pause/continue and outside-workspace blocked-task UI coverage,
3. extend the real-model AIR eval with milestone-owned AIR behavior dimensions.

That will move AIR testing from an initial product-quality suite to a fuller milestone-grade AIR behavior matrix, with the remaining deterministic gaps centered on identity/new-session hygiene and deeper diagnostics assertions.