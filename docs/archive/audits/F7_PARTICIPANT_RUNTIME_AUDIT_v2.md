# Re-Audit Report: F7 — Participant Runtime (Iteration 2)

**Date:** 2026-03-27
**Upstream Reference:** `github.com/openclaw/openclaw` @ e635cedb
**Previous Audit:** `docs/F7_PARTICIPANT_RUNTIME_AUDIT.md` (Iteration 1, 2026-04-16)
**Parallx Files Audited:** 10 source files, 1 test file

---

## Summary

- Capabilities audited: 17
- ALIGNED: 13
- MISALIGNED: 3
- HEURISTIC: 0
- MISSING: 1

All 4 fixes from Iteration 1 have landed correctly. The workspace and canvas participants now flow through `runOpenclawReadOnlyTurn` with retry logic and tool policy filtering. The deprecated `executeOpenclawModelTurn` has zero active callers.

Three new gaps surfaced in this deeper pass — primarily around error handling consistency, config propagation, and test coverage for the new readonly turn runner.

---

## Previous Fix Verification

| Fix | Status | Evidence |
|-----|--------|----------|
| F7-10: Workspace migration | ✅ VERIFIED | `openclawWorkspaceParticipant.ts:22` imports `runOpenclawReadOnlyTurn`, calls it at L293. Zero imports of `executeOpenclawModelTurn`. |
| F7-11: Canvas migration | ✅ VERIFIED | `openclawCanvasParticipant.ts:23` imports `runOpenclawReadOnlyTurn`, calls it at L226. Zero imports of `executeOpenclawModelTurn`. |
| F7-12: Deprecated old path | ✅ VERIFIED | `openclawParticipantRuntime.ts:273-278` has `@deprecated` JSDoc. grep confirms zero active imports of `executeOpenclawModelTurn` in any source file. |
| F7-13: Heuristic followups removed | ✅ VERIFIED | `openclawDefaultParticipant.ts:56-58` returns empty array from `provideFollowups`. Comment at L335-337 documents removal rationale (M41 A3). `generateFollowupSuggestions` function does not exist in codebase. |

---

## Per-Capability Findings

### F7-01: Participant Registration
- **Classification**: ALIGNED
- **Parallx file**: `src/openclaw/registerOpenclawParticipants.ts`
- **Upstream reference**: Agent registration entry point
- **Divergence**: None
- **Evidence**: 3 participants registered via `agentService.registerAgent()` with proper IDs (`parallx.chat.openclaw`, `parallx.chat.workspace`, `parallx.chat.canvas`), surfaces, and builder pattern via `openclawParticipantServices.ts`.
- **Severity**: N/A

### F7-02: Default Participant Pipeline
- **Classification**: ALIGNED
- **Parallx file**: `src/openclaw/participants/openclawDefaultParticipant.ts`
- **Upstream reference**: `agent-runner.ts` L1 entry → L2 retry → L4 attempt
- **Divergence**: None
- **Evidence**: `runOpenclawDefaultTurn` → `buildOpenclawTurnContext` → `runOpenclawTurn` (turn runner with retry/compact) → `executeOpenclawAttempt` (system prompt + tool policy + tool loop). Full pipeline with context engine lifecycle, mention/variable resolution, file attachments, edit mode, memory writeback.
- **Severity**: N/A

### F7-03: Turn Runner Retry Loop
- **Classification**: ALIGNED
- **Parallx file**: `src/openclaw/openclawTurnRunner.ts`
- **Upstream reference**: `agent-runner-execution.ts:113-380` (overflow/transient retry), `run.ts:879-1860` (timeout compaction)
- **Divergence**: None
- **Evidence**: MAX_OVERFLOW_COMPACTION=3, MAX_TIMEOUT_COMPACTION=2, transient exp backoff (2500→5000→10000 capped at 15000), auto-compact at 80% budget, context engine bootstrap before loop.
- **Severity**: N/A

### F7-04: Attempt Execution
- **Classification**: ALIGNED
- **Parallx file**: `src/openclaw/openclawAttempt.ts`
- **Upstream reference**: `attempt.ts:1672-3222+` (L4 attempt execution)
- **Divergence**: None
- **Evidence**: System prompt via `buildOpenclawPromptArtifacts`, tool policy filtering, tool loop with safety budget check, 20K truncation, `afterTurn` context engine finalization.
- **Severity**: N/A

### F7-05: Context Engine Lifecycle
- **Classification**: ALIGNED
- **Parallx file**: `src/openclaw/openclawContextEngine.ts`
- **Upstream reference**: `context-engine/types.ts:74-231`, `context-engine-maintenance.ts`
- **Divergence**: None
- **Evidence**: `IOpenclawContextEngine` with bootstrap/assemble/compact/afterTurn. C1-C5 stages. Evidence assessment at M5.
- **Severity**: N/A

### F7-06: Structured System Prompt
- **Classification**: ALIGNED
- **Parallx file**: `src/openclaw/openclawSystemPrompt.ts`
- **Upstream reference**: `buildEmbeddedSystemPrompt` (attempt.ts:132)
- **Divergence**: None
- **Evidence**: 10-section builder: identity, skills XML, tool summaries, workspace, preferences, overlay, runtime metadata, behavioral rules, model tier.
- **Severity**: N/A

### F7-07: Tool Policy Pipeline
- **Classification**: ALIGNED
- **Parallx file**: `src/openclaw/openclawToolPolicy.ts`
- **Upstream reference**: `tool-policy.ts` 4-stage filtering, `tool-policy-match.ts` deny-first
- **Divergence**: Minor — `resolveToolProfile` has a misleading comment (`case 'edit': return 'standard'; // Edit mode: read-only tools only` — 'standard' allows all tools except `run_command`, which is not "read-only")
- **Evidence**: 3 profiles (readonly/standard/full), deny-first pattern, M11 3-tier permissions (`never-allowed` removed), M42 model capability check. Readonly profile correctly denies write_file/edit_file/delete_file/run_command/create_page.
- **Severity**: LOW (comment-only issue)

### F7-08: Runtime Support
- **Classification**: ALIGNED
- **Parallx file**: `src/openclaw/openclawDefaultRuntimeSupport.ts`
- **Upstream reference**: Runtime command handling
- **Divergence**: None
- **Evidence**: Command registry with /context, /init, /compact. Clean lifecycle with `queueMemoryWriteBack`, `recordCompleted/Failed`.
- **Severity**: N/A

### F7-09: Service Interfaces
- **Classification**: ALIGNED
- **Parallx file**: `src/openclaw/openclawTypes.ts`, `src/openclaw/openclawParticipantServices.ts`
- **Upstream reference**: Service contracts
- **Divergence**: None
- **Evidence**: Separate interfaces for all 3 participant types (`IDefaultParticipantServices`, `IWorkspaceParticipantServices`, `ICanvasParticipantServices`). Adapter pattern with builders in `openclawParticipantServices.ts`.
- **Severity**: N/A

### F7-10: Workspace Participant Pipeline
- **Classification**: ALIGNED (upgraded from MISALIGNED in v1)
- **Parallx file**: `src/openclaw/participants/openclawWorkspaceParticipant.ts`
- **Upstream reference**: All participants through same pipeline entry
- **Divergence**: None — now uses `runOpenclawReadOnlyTurn` which provides retry loop and tool policy filtering
- **Evidence**: Import at L22, call at L293 with `maxIterations: OPENCLAW_MAX_READONLY_ITERATIONS`, `tools: services.getReadOnlyToolDefinitions()`, `invokeToolWithRuntimeControl`.
- **Severity**: N/A

### F7-11: Canvas Participant Pipeline
- **Classification**: ALIGNED (upgraded from MISALIGNED in v1)
- **Parallx file**: `src/openclaw/participants/openclawCanvasParticipant.ts`
- **Upstream reference**: All participants through same pipeline entry
- **Divergence**: None — now uses `runOpenclawReadOnlyTurn`
- **Evidence**: Import at L23, call at L226 with same parameters as workspace.
- **Severity**: N/A

### F7-12: Deprecated Old Execution Path
- **Classification**: ALIGNED (upgraded from MISALIGNED in v1)
- **Parallx file**: `src/openclaw/participants/openclawParticipantRuntime.ts:273-278`
- **Upstream reference**: Single attempt function, no parallel legacy paths
- **Divergence**: Function still exported but marked `@deprecated`. Zero active callers in source.
- **Evidence**: `@deprecated` JSDoc directs callers to `runOpenclawReadOnlyTurn` or `runOpenclawTurn`. grep across entire codebase confirms no active imports.
- **Severity**: N/A

### F7-13: Followup Suggestions
- **Classification**: ALIGNED (upgraded from HEURISTIC in v1)
- **Parallx file**: `src/openclaw/participants/openclawDefaultParticipant.ts:56-58`
- **Upstream reference**: Upstream followups inferred from response or not offered
- **Divergence**: None — empty array returned, no heuristic patchwork
- **Evidence**: `provideFollowups: async (): Promise<readonly IChatFollowup[]> => { return []; }`. Comment documents removal rationale.
- **Severity**: N/A

---

### NEW FINDINGS

### F7-14: Error Handling Consistency (Readonly Participants)
- **Classification**: MISALIGNED
- **Parallx file**: `src/openclaw/participants/openclawWorkspaceParticipant.ts` (L251-333), `src/openclaw/participants/openclawCanvasParticipant.ts` (L190-267)
- **Upstream reference**: `agent-runner.ts` — all agents wrap execution in error reporting. `agent-runner-execution.ts:113-380` — errors classified and propagated with structured result
- **Divergence**: Neither workspace nor canvas wraps `runOpenclawReadOnlyTurn()` in a try/catch. If the readonly runner throws after exhausting retries (transient, timeout), the error propagates uncaught out of the participant handler. The default participant at `openclawDefaultParticipant.ts:155-225` properly catches errors and returns `{ errorDetails: { message, responseIsIncomplete: true } }` with `response.warning()`.
- **Evidence**:
  ```
  // Default participant (correct):
  try {
    const result = await runOpenclawTurn(...);
  } catch (error) {
    response.warning(`OpenClaw turn failed: ${message}`);
    return { errorDetails: { message, responseIsIncomplete: true } };
  }

  // Workspace participant (missing):
  const result = await runOpenclawReadOnlyTurn({...});
  // No try/catch — unrecoverable errors escape the handler
  ```
- **Severity**: MEDIUM — unhandled errors will surface as unformatted exceptions in the UI rather than clean error messages

### F7-15: Config Propagation to Readonly Participants
- **Classification**: MISALIGNED
- **Parallx file**: `src/openclaw/participants/openclawWorkspaceParticipant.ts:278`, `src/openclaw/participants/openclawCanvasParticipant.ts:214`
- **Upstream reference**: `attempt.ts` — model config (temperature, context limits) resolved uniformly for all agents via `applyExtraParamsToAgent`
- **Divergence**: Workspace accesses `unifiedConfigService` via an unsafe type cast (`(services as { unifiedConfigService?: ... })`) because `IWorkspaceParticipantServices` doesn't declare that property. Canvas ignores config entirely and passes empty options `buildOpenclawReadOnlyRequestOptions({})`. This means canvas turns always use default temperature/maxTokens regardless of user settings.
- **Evidence**:
  ```typescript
  // Workspace (dirty cast):
  const effectiveConfig = (services as { unifiedConfigService?: ... }).unifiedConfigService?.getEffectiveConfig();
  const requestOptions = buildOpenclawReadOnlyRequestOptions({
    temperature: effectiveConfig?.model?.temperature,
    maxTokens: effectiveConfig?.model?.maxTokens,
  });

  // Canvas (ignores config):
  const requestOptions = buildOpenclawReadOnlyRequestOptions({});
  ```
- **Severity**: LOW — primarily affects canvas; workspace has a working (if ugly) workaround. Fix: add `unifiedConfigService?` to `IWorkspaceParticipantServices` and `ICanvasParticipantServices` interfaces, or pass effective config through the service builder.

### F7-16: System Prompt Construction (Readonly Participants)
- **Classification**: MISALIGNED
- **Parallx file**: `src/openclaw/participants/openclawWorkspaceParticipant.ts:264-272`, `src/openclaw/participants/openclawCanvasParticipant.ts:201-209`
- **Upstream reference**: `buildEmbeddedSystemPrompt` — all agents use the same structured prompt builder
- **Divergence**: Both workspace and canvas construct system prompts via ad-hoc string concatenation (identity line + bootstrap sections + context). The default participant uses the full 10-section structured `buildOpenclawSystemPrompt` builder. Readonly participants miss: skills XML, tool summaries, behavioral rules, model tier metadata, runtime info.
- **Evidence**:
  ```typescript
  // Workspace ad-hoc prompt:
  const systemPrompt = [
    'You are the OpenClaw workspace lane inside Parallx.',
    'Treat the workspace as the source of truth...',
    `Workspace: ${services.getWorkspaceName()}`,
    ...bootstrapSections,
    'Workspace context for this turn:',
    options.promptContext,
  ].join('\n\n');

  // Default participant (structured):
  // buildOpenclawTurnContext → openclawSystemPrompt.ts → 10-section builder
  ```
- **Severity**: MEDIUM — readonly participants get weaker prompts, which may reduce response quality. However, fixing this is primarily an F3 (System Prompt Builder) concern. The F7 runtime path itself is correct.

### F7-17: Readonly Turn Runner Test Coverage
- **Classification**: MISSING
- **Parallx file**: `src/openclaw/openclawReadOnlyTurnRunner.ts` — no dedicated test file
- **Upstream reference**: All pipeline layers should have test coverage
- **Divergence**: `openclawReadOnlyTurnRunner.ts` has zero unit tests. The scoped participant tests (`openclawScopedParticipants.test.ts`) exercise only the happy path (simple response streamed without errors or tool calls). No tests cover: transient error retry (exp backoff), timeout retry, tool call execution loop, cancellation mid-turn, iteration budget exhaustion, or the interaction between tool policy filtering and tool invocation.
- **Evidence**: `grep -r "readOnlyTurnRunner\|runOpenclawReadOnlyTurn\|ReadOnlyTurn" tests/` returns zero matches.
- **Severity**: MEDIUM — the retry and tool loop logic is untested; regressions could go undetected

---

## Minor Observations (Not Classified as Gaps)

1. **Duplicate constant**: `OPENCLAW_MAX_READONLY_ITERATIONS = 3` is defined in both `openclawParticipantRuntime.ts:30` and `openclawDefaultParticipant.ts:238`. The default participant defines its own copy for Edit mode budget rather than importing from the runtime. Maintenance risk if values diverge.

2. **Misleading comment in `resolveToolProfile`**: `case 'edit': return 'standard'; // Edit mode: read-only tools only` — the `standard` profile allows all tools except `run_command`, which is not "read-only". The comment should say "Edit mode: standard tools (no command execution)".

3. **Dead parameter**: `_commandRegistry` in `runOpenclawDefaultTurn` is created and passed but never used (prefixed `_`). The command registry is consumed only for the slash command definitions in the participant object, not during turn execution.

4. **Double tool filtering for readonly participants**: Tools are first filtered by `services.getReadOnlyToolDefinitions()` (service layer) and then additionally by `applyOpenclawToolPolicy({ mode: 'readonly' })` inside `runOpenclawReadOnlyTurn`. This is defense-in-depth, not a bug, but creates redundancy.

---

## Iteration 1 → Iteration 2 Delta

| Metric | Iteration 1 | Iteration 2 | Change |
|--------|------------|------------|--------|
| Total capabilities | 13 | 17 | +4 new findings |
| ALIGNED | 9 | 13 | +4 (all v1 fixes verified) |
| MISALIGNED | 3 | 3 | 3 old fixed, 3 new found |
| HEURISTIC | 1 | 0 | -1 (F7-13 fixed) |
| MISSING | 0 | 1 | +1 (test coverage gap) |

---

## Recommended Fix Priority

| Priority | Gap | Fix |
|----------|-----|-----|
| 1 (MEDIUM) | F7-14: Error handling | Add try/catch to `runWorkspacePromptTurn` and `runCanvasPromptTurn`, returning `{ errorDetails }` and calling `response.warning()` on failure. ~10 lines per file. |
| 2 (MEDIUM) | F7-17: Test coverage | Create `tests/unit/openclawReadOnlyTurnRunner.test.ts` with cases for: transient retry, timeout retry, tool call loop, cancellation, budget exhaustion. |
| 3 (MEDIUM) | F7-16: Prompt construction | Refactor readonly participants to use a lightweight variant of `buildOpenclawSystemPrompt` (or a new `buildOpenclawReadOnlySystemPrompt`). Cross-domain with F3. |
| 4 (LOW) | F7-15: Config propagation | Add `unifiedConfigService?` to workspace and canvas service interfaces, wire through service builders, use in both participants. |
