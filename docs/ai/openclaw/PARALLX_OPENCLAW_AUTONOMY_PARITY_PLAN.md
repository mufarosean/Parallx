# Parallx OpenClaw Autonomy Parity Plan

**Status:** Runtime mirroring implemented; current AI verification slice green, manual review still open  
**Date:** 2026-03-25  
**Purpose:** Close the highest-value autonomy gap between the live Parallx OpenClaw chat surface and upstream OpenClaw so agent mode is user-testable end to end in the chat UI.

---

## 1. Why This File Exists

The repository already has:

- a live OpenClaw-backed default participant,
- a runtime-controlled tool loop,
- a chat task rail with approvals and diagnostics,
- task/approval/session services for delegated autonomy.

But those pieces are still split.

The current live agent-mode chat path can execute tools autonomously, while the
task/approval rail mostly remains a separate delegated-task subsystem instead of
the runtime-owned view of that same autonomous run.

This document records the evidence, the exact gap, the implementation steps,
and the verification path so the work can resume from repository state alone.

---

## 2. Verified Current State

### 2.1 What Parallx already does

Verified local evidence:

- `src/openclaw/participants/openclawDefaultParticipant.ts`
  - agent mode gets full tools,
  - agent mode iterates over tool calls,
  - tool calls run through `invokeToolWithRuntimeControl(...)`,
  - the run completes only after the multi-step loop exits.
- `src/built-in/chat/utilities/chatGroundedExecutor.ts`
  - the grounded runtime already emits tool validation, approval, and execution
    trace signals through `IChatRuntimeToolInvocationObserver`.
- `src/services/languageModelToolsService.ts`
  - tool validation, approval, and execution are runtime-controlled rather than
    participant-local.
- `src/built-in/chat/widgets/chatWidget.ts`
  - the chat UI already renders an agent task rail with task controls and
    approval actions.
- `src/services/agentSessionService.ts`
  - task lifecycle, approval pause/resume, and trace recording already exist.
- `src/services/agentExecutionService.ts`
  - persisted plan steps can already execute through the approval-aware task
    engine and record artifacts.

### 2.2 The concrete gap

Verified local evidence:

- `src/built-in/chat/main.ts`
  - task creation, plan seeding, and task execution are currently exposed only
    through debug-driver hooks.
- `src/built-in/chat/data/chatDataService.ts`
  - widget services can read and control tasks, but normal chat execution does
    not create them.
- repository-wide search shows no normal default/OpenClaw chat path calling:
  - `agentSessionService.createTask(...)`
  - `agentSessionService.setPlanSteps(...)`
  - `agentExecutionService.runTask(...)`

That means the user-facing autonomy rail is not the runtime-owned surface of
the live OpenClaw loop yet.

---

## 3. Upstream OpenClaw Evidence We Are Following

The goal is not to invent a new Parallx-only autonomy model. The goal is to use
OpenClaw's runtime discipline as the source shape and adapt it to Parallx's
existing chat/task services.

### 3.1 Runtime-owned tool loop

Upstream evidence:

- `openclaw/openclaw` `src/agents/pi-embedded-runner/run/attempt.ts`
  - builds the tool runtime inside the embedded run path,
  - enables tools as a runtime concern, not as participant-local behavior.

### 3.2 Before-tool-call runtime control and loop protection

Upstream evidence:

- `openclaw/openclaw` `src/agents/pi-tools.before-tool-call.ts`
  - runs a before-tool-call hook,
  - checks repetitive call patterns before execution,
  - can block critical loops.
- `openclaw/openclaw` `src/agents/tool-loop-detection.ts`
  - keeps tool call history,
  - detects repeated no-progress loops,
  - supports warning and critical thresholds.

### 3.3 Approval-mediated execution

Upstream evidence:

- `openclaw/openclaw` `src/agents/tools/nodes-tool.ts`
  - requests approval when execution requires it,
  - waits for resolution before proceeding.
- `openclaw/openclaw` `src/agents/bash-tools.exec-approval-request.ts`
  - models approval registration and decision waiting as runtime behavior.

### 3.4 Session/subagent runtime breadth

Upstream evidence:

- `openclaw/openclaw` `src/agents/tools/sessions-spawn-tool.ts`
- `openclaw/openclaw` `src/agents/tools/subagents-tool.ts`
- `openclaw/openclaw` `src/agents/subagent-control.ts`

These show that upstream OpenClaw autonomy is broader than a single one-shot
tool loop. Parallx does not need to clone the whole session-control plane in
this slice, but it does need one runtime-owned, inspectable autonomy surface in
the chat UI.

---

## 4. Execution Goal For This Slice

Close the highest-value user-facing gap first:

**Agent-mode OpenClaw chat turns must create and update runtime-owned autonomy
tasks so the existing chat task rail becomes the visible control surface for the
live autonomous run rather than a disconnected side system.**

This slice is complete when:

1. an agent-mode chat turn creates a task record automatically,
2. tool validation/execution/approval events update that task in real time,
3. approval-required turns visibly pause in the task rail and resume from the
   same runtime path after approval,
4. completion/failure is reflected in the task rail and traces,
5. loop-safety exists for repeated identical tool calls in the live runtime,
6. AI verification and autonomy-focused regression coverage are updated.

---

## 5. Implementation Plan

### Step 1. Add a runtime-owned autonomy adapter for live agent-mode turns

Target files:

- `src/built-in/chat/utilities/`
- `src/built-in/chat/chatTypes.ts`
- `src/built-in/chat/utilities/chatTurnSynthesis.ts`
- `src/openclaw/participants/openclawDefaultParticipant.ts`
- `src/built-in/chat/utilities/chatDefaultParticipantAdapter.ts`

Plan:

- introduce one adapter that can:
  - create an agent task for an agent-mode turn,
  - record tool-driven plan steps from the live tool loop,
  - translate runtime approval events into task approval state,
  - mark completion/failure/blocked states.
- keep the adapter runtime-owned and reusable instead of embedding task logic in
  each participant.

Why this follows evidence:

- upstream OpenClaw keeps tool-loop ownership inside the runtime,
- Parallx already has runtime-owned tool observers and task services,
- this closes the split without inventing a second autonomy engine.

### Step 2. Mirror approval flow into the existing task rail

Target files:

- `src/services/agentSessionService.ts`
- `src/services/agentApprovalService.ts`
- runtime adapter files from Step 1

Plan:

- when runtime-controlled tools request approval, create or merge the matching
  approval request on the task,
- when approval resolves, unblock the live task state and continue the run from
  the existing widget control flow.

Why this follows evidence:

- upstream OpenClaw treats approval as a first-class runtime transition,
- Parallx already has approval request and resolution services, but they are not
  yet the normal live agent-mode path.

### Step 3. Add lightweight OpenClaw-style loop safety to the live runtime

Target files:

- new chat/runtime helper under `src/built-in/chat/utilities/`
- `src/built-in/chat/utilities/chatGroundedExecutor.ts`
- `src/openclaw/participants/openclawDefaultParticipant.ts`

Plan:

- keep a short in-run history of tool name + normalized arguments,
- if the same no-progress tool call repeats past a threshold, fail the run with
  a visible warning and trace note,
- record the loop-safety outcome in task diagnostics and runtime trace.

Why this follows evidence:

- upstream OpenClaw explicitly runs before-tool-call loop detection,
- this is one of the missing robustness layers in the current Parallx autonomy
  gap analysis.

### Step 4. Verify against unit, parity, and AI eval surfaces

Required verification after implementation:

### 5.1 Execution update — 2026-03-25

Completed implementation:

- `src/built-in/chat/data/chatDataService.ts`
  - now exposes `createAutonomyMirror(...)` through the default participant
    service bundle using the existing workspace/task/approval/policy services.
- `src/built-in/chat/utilities/chatTurnExecutionConfig.ts`
  - now creates a runtime-owned autonomy mirror for live claw agent-mode turns.
- `src/built-in/chat/utilities/chatTurnSynthesis.ts`
  - now begins, completes, aborts, and fails the live autonomy mirror as part
    of the shared prepared-turn lifecycle.
- `src/built-in/chat/utilities/chatGroundedExecutor.ts`
  - now applies loop-safety before tool execution and preserves trace-aware
    runtime observers while mirroring tool activity into the task rail.
- `src/openclaw/participants/openclawDefaultParticipant.ts`
  - now creates a runtime-owned autonomy mirror for live OpenClaw agent turns,
    mirrors tool execution into the task rail, and blocks repeated identical
    tool loops with a visible failure.

Verified results from this slice:

- `npm run test:unit -- tests/unit/chatGroundedExecutor.test.ts tests/unit/chatTurnSynthesis.test.ts tests/unit/openclawDefaultParticipant.test.ts`
  - `16/16` passed.
- `npm run build:renderer`
  - passed.
- `npm run test:ai-eval -- tests/ai-eval/ai-quality.spec.ts tests/ai-eval/stress-quality.spec.ts tests/ai-eval/memory-layers.spec.ts tests/ai-eval/route-authority.spec.ts tests/ai-eval/workspace-bootstrap-diagnostic.spec.ts`
  - autonomy scenario summary recorded `100%` for boundary, approval,
    completion, and trace completeness.
  - broader AI quality remained below the historical `100%` bar because of
    existing retrieval/data-freshness regressions outside the autonomy wiring
    slice (`T11`, `T12`, `T14`, `T21`, `T31`, plus several partial retrieval
    cases).

Remaining open work after this slice:

- complete manual autonomy review sign-off,
- keep Exam 7 tracked as the remaining workspace-dependent external blocker; the Books suite now reruns cleanly at `100%` when `PARALLX_AI_EVAL_WORKSPACE=C:\Users\mchit\OneDrive\Documents\Books` is supplied explicitly.

Follow-up verification update on 2026-03-25:

- `npx vitest run tests/unit/chatGroundedAnswerRepairs.test.ts tests/unit/chatDataServiceMemoryRecall.test.ts tests/unit/openclawDefaultParticipant.test.ts`
  - `48/48` passed.
- `npm run build:renderer` followed by `npx playwright test --config=playwright.ai-eval.config.ts tests/ai-eval/ai-quality.spec.ts tests/ai-eval/memory-layers.spec.ts tests/ai-eval/route-authority.spec.ts tests/ai-eval/workspace-bootstrap-diagnostic.spec.ts`
  - `42/42` passed.
  - `tests/ai-eval/ai-quality.spec.ts` = `32/32` and `100.0%`.
  - `tests/ai-eval/memory-layers.spec.ts` = `7/7`.
  - `tests/ai-eval/route-authority.spec.ts` = `2/2`.
  - `tests/ai-eval/workspace-bootstrap-diagnostic.spec.ts` = `1/1`.
- `npm run build:renderer` followed by `PARALLX_AI_EVAL_WORKSPACE=C:\Users\mchit\OneDrive\Documents\Books`, `PARALLX_AI_EVAL_WORKSPACE_NAME=Books`, and `npx playwright test --config=playwright.ai-eval.config.ts tests/ai-eval/books-quality.spec.ts`
  - `8/8` and `100.0%` (`Excellent`).

- focused unit tests for the new autonomy adapter,
- focused unit tests for loop-safety behavior,
- existing autonomy/task/UI unit suites,
- `npx vitest run tests/unit/openclawDefaultParticipant.test.ts`
- `npx vitest run tests/unit/agentExecutionService.test.ts tests/unit/agentSessionService.test.ts tests/unit/chatAutonomyUI.test.ts tests/unit/clawParityArtifacts.test.ts`
- `npm run build:renderer`
- directly runnable AI Playwright suites in this repo,
- any blocked suite must remain explicitly documented as external.

---

## 6. Expected Non-Goals For This Slice

This slice does **not** claim to finish all upstream OpenClaw breadth.

It does not attempt to fully clone:

- the Gateway control plane,
- ACP/session spawning infrastructure,
- the whole upstream subagent/session management surface.

It does claim to close the most visible end-user autonomy gap on the live chat
surface: a runtime-owned autonomous turn that is inspectable, pausable,
approval-aware, and user-testable in the Parallx chat UI.

---

## 7. Progress Log

- 2026-03-25: Verified that the live OpenClaw agent-mode loop is real but not
  yet mirrored into the chat task rail.
- 2026-03-25: Verified that the task/approval rail and delegated-task services
  already exist and are wired to the widget, but normal chat execution does not
  create or drive them.
- 2026-03-25: Chosen execution target for this slice: runtime-owned task mirror
  plus lightweight loop-safety for live agent-mode turns.