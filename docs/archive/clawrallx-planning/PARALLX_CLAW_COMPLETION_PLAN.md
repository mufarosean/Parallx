# Parallx Claw Completion Plan

**Status:** Active completion plan  
**Date:** 2026-03-24  
**Purpose:** Durable continuation document for finishing the claw redesign without depending on chat-session memory.

---

## 1. Why This File Exists

This file exists because the redesign context should not live in chat history.

The next implementation pass must be able to resume from repository state alone.

This document is the canonical completion plan for the remaining claw work.

---

## 2. Current Reality

The implementation is materially advanced, but it is not near the intended end
state yet.

What is already true:

- the default participant now runs on a claw-only runtime,
- the default runtime is stage-based,
- default, `@workspace`, `@canvas`, and bridged participant descriptors now all expose runtime-backed entry points and `ChatAgentService` dispatches those runtime entries directly,
- runtime traces now include run/checkpoint metadata,
- tool/approval behavior is partially runtime-owned,
- the default claw execution lane no longer falls back to raw `invokeTool(...)` during grounded tool execution,
- runtime-controlled invocation ownership is now centralized in `LanguageModelToolsService`, with `ChatDataService` delegating rather than reimplementing permission and execution flow,
- memory checkpoint wiring plus success/abort/failure outcome recording are now routed through a shared runtime lifecycle helper rather than ad hoc sink ownership in `chatTurnSynthesis.ts`,
- memory write-back/checkpoints are partially runtime-owned,
- `@workspace` and `@canvas` now emit runtime-visible prompt-stage checkpoints,
- `@workspace` and `@canvas` now resolve scoped runtime trace/checkpoint reporting
  through a shared helper that prefers `context.runtime`,
- default and scoped runtime lanes now share the same runtime prompt seed and
  envelope message builders,
- bridged participants preserve explicit `bridge` surface identity through
  registration and dispatch,
- bridged participants now emit shared claw runtime trace/checkpoint events
  through the participant context injected by `ChatService`,
- bridged participants can now opt into a runtime-owned prompt builder exposed
  on `context.runtime`, including shared history/attachment prompt assembly and
  prompt-stage checkpoints,
- bridged participants now also receive a runtime-owned `sendPrompt(...)`
  helper on `context.runtime` so prompt assembly and model execution can stay
  on one shared runtime-owned path,
- bridged participants can now forward additional runtime trace payloads
  through `IChatParticipantResult.metadata` without depending on a built-in
  service bundle,
- bridged tools now carry explicit bridge source/owner provenance into the
  runtime-controlled tool metadata path,
- main execution now routes memory checkpoints and final run outcomes through a
  shared runtime checkpoint sink instead of inline trace mapping,
- participant failure traces and bridge runtime traces now share one trace-seed
  builder instead of duplicated turn-state mapping logic.

What is not yet true:

- live NemoClaw A/B execution artifacts are not yet present in this workspace,
- autonomy manual review approval is still an external close-out blocker,
- full skill-manifest parity remains a broader follow-on track beyond the runtime-seam closure in this pass.

---

## 3. Finish Condition

This work is complete only when all of the following are true:

1. default chat,
2. `@workspace`,
3. `@canvas`,
4. tool-contributed participants via `ChatBridge`

all execute through one claw runtime contract with:

- one request-interpretation contract,
- one prompt-stage contract,
- one tool/approval contract,
- one checkpoint/finalization contract,
- one persistence model,
- one runtime trace model.

Anything short of this is still transitional architecture.

---

## 4. Remaining Workstreams

### 4.1 Universal Runtime Entry

Status: complete for the current migration target.

Finish when every participant surface enters one runtime entry path instead of
using participant-local orchestration.

Required changes:

- adapt `@workspace` and `@canvas` onto the same runtime entry contract used by
  the default participant,
- adapt `ChatBridge` registration to runtime-backed participant descriptors
  rather than raw handler pass-through,
- make `ChatAgentService` dispatch runtime-backed participants uniformly.

Current truth:

- default, `@workspace`, `@canvas`, and bridged participant descriptors now all
  register runtime-backed entries,
- `ChatAgentService` now prefers runtime-backed dispatch before legacy handler
  dispatch,
- scoped participants still expose `handler` for compatibility, but that handler
  delegates to the runtime entry instead of owning orchestration.

Primary files:

- `src/built-in/chat/utilities/chatDefaultParticipantRuntime.ts`
- `src/built-in/chat/participants/workspaceParticipant.ts`
- `src/built-in/chat/participants/canvasParticipant.ts`
- `src/api/bridges/chatBridge.ts`
- `src/services/chatAgentService.ts`

### 4.2 Prompt Authority Unification

Finish when every participant surface uses one runtime-owned prompt-stage
boundary.

Required changes:

- merge default and scoped prompt-stage behavior under one shared prompt-stage
  contract,
- reduce helper modules so they are implementation details rather than
  alternate prompt authorities,
- either migrate bridged participants onto the same prompt-stage contract or
  explicitly wrap them in runtime-owned prompt adapters.

Primary files:

- `src/built-in/chat/utilities/chatDefaultRuntimePromptStage.ts`
- `src/built-in/chat/utilities/chatScopedRuntimePromptStage.ts`
- `src/built-in/chat/utilities/chatTurnMessageAssembly.ts`
- `src/built-in/chat/utilities/chatUserContentComposer.ts`
- `src/built-in/chat/utilities/chatSystemPromptComposer.ts`

### 4.3 Tool And Approval Convergence

Finish when no participant surface can execute tools outside runtime control.

Required changes:

- route all tool execution through one runtime-owned tool invocation interface,
- ensure bridge participants cannot bypass runtime approval/provenance flow,
- remove remaining compatibility-boundary shortcuts above the now-canonical
  runtime-controlled executor path.

Primary files:

- `src/built-in/chat/data/chatDataService.ts`
- `src/built-in/chat/utilities/chatGroundedExecutor.ts`
- `src/built-in/chat/utilities/chatTurnSynthesis.ts`
- `src/api/bridges/chatBridge.ts`

### 4.4 Checkpoint, Persistence, And Finalization Unification

Finish when transcript updates, run checkpoints, memory writes, and final run
outcomes are sequenced by one dedicated runtime-owned contract.

Required changes:

- centralize named checkpoint writes,
- centralize run outcome recording,
- centralize memory write-back boundary control,
- eliminate helper-timing-based persistence behavior.

Primary files:

- `src/built-in/chat/utilities/chatMemoryWriteBack.ts`
- `src/built-in/chat/utilities/chatTurnSynthesis.ts`
- `src/built-in/chat/utilities/chatDefaultParticipantRuntime.ts`
- `src/services/chatService.ts`

---

## 5. Architectural Decision Still Open

The tool-contributed participant path is now resolved for the current cut by
the second acceptable end state:

1. **Explicit boundary:** bridged participants remain a formally documented
  compatibility surface and are no longer described as in migration.

That means parity work now compares claw-native surfaces directly and treats
bridge behavior as an intentional compatibility boundary rather than a hidden
second runtime.

---

## 6. Verification Gate

Do not describe the claw redesign as complete unless all required verification
passes or a blocker is explicitly recorded as external.

Required verification:

- `npx tsc --noEmit`
- `npm run test:unit`
- focused runtime regression suites
- `npx playwright test --config=playwright.ai-eval.config.ts tests/ai-eval/ai-quality.spec.ts -g "T06|T19|T30|T31|T32"`
- `npx playwright test --config=playwright.ai-eval.config.ts tests/ai-eval/memory-layers.spec.ts`
- `PARALLX_AI_EVAL_WORKSPACE=tests/ai-eval/stress-workspace` + stress eval
- Exam 7 eval if the required benchmark files actually exist in the configured
  workspace

Current known verification truth:

- unit is green at `156` files / `2587` tests, and core AI eval, memory-layer eval, and stress eval are green,
- Exam 7 is currently blocked by missing external benchmark files,
- manual autonomy review approval remains an external close-out blocker.

---

## 7. Anti-Drift Rules

1. Update this file when the finish condition or remaining work changes.
2. Update `PARALLX_CLAW_IMPLEMENTATION_TRACKER.md` in the same work session as
   any status change.
3. Update `docs/Parallx_Milestone_40.md` when verification or milestone truth
   changes.
4. Do not claim the system is near the target unless the tool-contributed
   participant path is no longer partially integrated.

---

## 8. Resume Here

If work resumes after context loss, start from this order:

1. Read this file.
2. Read `docs/clawrallx/PARALLX_CLAW_IMPLEMENTATION_TRACKER.md`.
3. Read `docs/clawrallx/PARALLX_CLAW_RUNTIME_CONTRACT.md`.
4. Read `docs/Parallx_Milestone_40.md`.
5. Continue with live A/B execution using `tests/ai-eval/clawParityBenchmark.ts`, normalize/import captures through `tests/ai-eval/clawParityArtifacts.ts`, and record results in `PARALLX_CLAW_PARITY_FAILURE_LEDGER.md`.