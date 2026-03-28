# Milestone 45 — Legacy Default Claw Runtime Removal

**Status:** In Progress  
**Branch:** `m46-legacy-runtime-removal`  
**Depends on:** `m44-defensive-hardening` commit `d425f69`

---

## Background

At Milestone 41, the instruction was explicit: **build the OpenClaw framework from scratch, study the upstream source, the existing code is not the starting point.** The OpenClaw runtime was implemented as a complete, self-contained system in `src/openclaw/` with zero imports from the old Default Claw runtime utilities.

However, the old Default Claw runtime was never removed. Both runtimes were registered simultaneously in `main.ts`. The config default `runtime.implementation: 'openclaw'` meant the old runtime never executed, but its code remained — causing confusion and misdirected fixes (e.g., patching `chatGroundedExecutor.ts` for a bug that only exists in the OpenClaw runtime).

This milestone surgically removes all dead Default Claw runtime code.

---

## Audit Summary

### Runtime Architecture
- **Active runtime:** OpenClaw (`src/openclaw/`, 20 files) — self-contained, zero imports from old utilities
- **Dead runtime:** Default Claw (`src/built-in/chat/utilities/chatDefault*`, `src/built-in/chat/participants/`) — never selected, never runs
- **Selection mechanism:** `chatRuntimeSelector.ts` routes `DEFAULT_CHAT_PARTICIPANT_ID` → `OPENCLAW_DEFAULT_PARTICIPANT_ID` when config is `'openclaw'`

### What OpenClaw reimplemented independently
Each old utility has an OpenClaw equivalent that shares zero code:

| Old (Default Claw) | OpenClaw Replacement |
|---|---|
| `chatDefaultParticipantRuntime` | `openclawDefaultParticipant` |
| `chatGroundedExecutor` | `openclawAttempt` |
| `chatTurnSynthesis` / `chatTurnExecutionConfig` | `openclawTurnRunner` |
| `chatContextAssembly` / `chatContextPlanner` | `openclawContextEngine` |
| `chatSystemPrompts` / `chatSystemPromptComposer` | `openclawSystemPrompt` |
| `chatTurnBudgeting` | `openclawTokenBudget` |
| `chatResponseValidator` | `openclawResponseValidation` |
| `chatRequestErrorCategorizer` | `openclawErrorClassification` |
| `chatSkillMatcher` | `openclawTurnPreprocessing` |
| `chatWorkspaceDocumentListing` | `openclawWorkspaceDocumentListing` |
| `chatToolLoopSafety` (shim) | `openclawToolLoopSafety` (shim) |

---

## Phases

### Phase 1 — Surgery on Shared Files

Files that import old-runtime code but also serve the active pipeline. Cut the dead references without breaking the shared functionality.

| File | Change |
|---|---|
| `src/built-in/chat/main.ts` | Remove old participant imports, registration blocks (default + legacy compare + workspace + canvas), and `dataService.buildDefaultParticipantServices()` call. Rewire `setTurnPreparationServices` to use `dataService` directly. |
| `src/built-in/chat/data/chatDataService.ts` | Remove `buildDefaultParticipantServices()`, `buildWorkspaceParticipantServices()`, `buildCanvasParticipantServices()` methods. Remove import of `buildChatDefaultParticipantServices`. Remove `IDefaultParticipantServices`, `IWorkspaceParticipantServices`, `ICanvasParticipantServices` from type imports (only if no other method uses them). |
| `src/services/chatRuntimeSelector.ts` | Remove `LEGACY_COMPARE_PARTICIPANT_ID`. Simplify `resolveChatRuntimeParticipantId` — always return OpenClaw for default participant. |

### Phase 2 — Delete Old Runtime Source Files (~39 files)

**Participants (3):**
- `src/built-in/chat/participants/defaultParticipant.ts`
- `src/built-in/chat/participants/workspaceParticipant.ts`
- `src/built-in/chat/participants/canvasParticipant.ts`

**Config (2):**
- `src/built-in/chat/config/chatModeCapabilities.ts`
- `src/built-in/chat/config/chatSlashCommands.ts`

**Note:** `chatSystemPrompts.ts` is kept — used by shared UI (`chatTokenStatusBar.ts`, `chatSystemPromptComposer.ts`).

**Utilities — Pipeline (20):**
- `chatDefaultParticipantRuntime.ts`
- `chatDefaultRuntimeInterpretationStage.ts`
- `chatDefaultRuntimeContextStage.ts`
- `chatDefaultRuntimeExecutionStage.ts`
- `chatDefaultRuntimePromptStage.ts`
- `chatDefaultTurnInterpretation.ts`
- `chatDefaultTurnExecution.ts`
- `chatDefaultPreparedTurnContext.ts`
- `chatDefaultCommandRegistry.ts`
- `chatDefaultEarlyCommands.ts`
- `chatTurnPrelude.ts`
- `chatTurnBudgeting.ts`
- `chatTurnContextPreparation.ts`
- `chatTurnMessageAssembly.ts`
- `chatTurnSynthesis.ts`
- `chatTurnExecutionConfig.ts`
- `chatGroundedExecutor.ts`
- `chatModelOnlyExecutor.ts`
- `chatRuntimeLifecycle.ts`
- `chatRuntimeCheckpointSink.ts`

**Utilities — Context/Validation (7):**
- `chatContextAssembly.ts`
- `chatContextSourceLoader.ts`
- `chatContextPlanner.ts`
- `chatSkillMatcher.ts`
- `chatMemoryWriteBack.ts`
- `chatResponseValidator.ts`
- `chatCompactCommand.ts`

**Utilities — Scoped Participant (5):**
- `chatScopedParticipantRuntime.ts`
- `chatScopedParticipantHandler.ts`
- `chatScopedParticipantPromptRunner.ts`
- `chatScopedParticipantExecution.ts`
- `chatScopedRuntimePromptStage.ts`

**Utilities — Other Dead (6):**
- `chatSpecificCoverageFocus.ts`
- `chatToolLoopSafety.ts`
- `chatTurnEntryRouting.ts`
- `chatWorkspaceDocumentListing.ts`
- `chatRequestErrorCategorizer.ts`
- `chatResponseParsingHelpers.ts`
- `chatUserContentComposer.ts`
- `userCommandLoader.ts`

**Empty folder:**
- `src/chatRuntime/`

### Phase 3 — Delete Old Tests, Fix Remaining

**Delete (~6 test files):**
- `tests/unit/agenticLoop.test.ts`
- `tests/unit/chatGroundedExecutor.test.ts`
- `tests/unit/chatTurnSynthesis.test.ts`
- `tests/unit/workspaceParticipant.test.ts`
- `tests/unit/canvasParticipant.test.ts`
- `tests/unit/chatDefaultParticipantAdapter.test.ts`

**Fix:**
- `tests/unit/chatGateCompliance.test.ts` — remove old participant entries from FOLDER_RULES allowlist

### Phase 4 — Verify

- `npx tsc --noEmit` — zero errors
- `npx vitest run` — all tests pass
- Verify no dangling imports remain

---

## What Stays (Shared Infrastructure, ~23 files)

Files in `src/built-in/chat/utilities/` used by `chatService.ts`, `chatDataService.ts`, or the chat widget:

**Service-layer (11):** `chatTurnSemantics`, `chatTurnRouter`, `chatGroundedResponseHelpers`, `chatMentionResolver`, `chatScopeResolver`, `chatRuntimePromptMessages`, `chatParticipantRuntimeTrace`, `chatSemanticFallback`, `chatBridgeParticipantRuntime`, `chatParticipantInterpretation`, `chatParticipantCommandDispatcher`

**Widget adapters (12):** `chatAgentTaskWidgetAdapter`, `chatDefaultParticipantAdapter` (used by chatDataService for OpenClaw service building), `chatWidgetAttachmentAdapter`, `chatWidgetPickerAdapter`, `chatWidgetRequestAdapter`, `chatWidgetSessionAdapter`, `chatTokenBarAdapter`, `chatViewerOpeners`, `chatSystemPromptComposer`, `chatScopedParticipantAdapters`, `chatRuntimeAutonomyMirror`, `chatWorkspaceDigest`

**Config (1):** `chatSystemPrompts.ts` (used by token status bar for estimation)

---

## Risk Assessment

| Risk | Mitigation |
|---|---|
| Breaking import that wasn't caught in audit | TypeScript compiler (`tsc --noEmit`) catches all dangling imports |
| Shared file incorrectly classified as old-only | Audit verified every file's importers across entire `src/` |
| Test failures from removed test utilities | Full vitest run after deletion |
| Rollback needed | Clean branch from known-good commit `d425f69` |
