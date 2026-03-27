# F1 Execution Pipeline — Parity Audit

**Date:** 2026-03-27
**Auditor:** AI Parity Auditor
**Iteration:** 1
**Domain:** F1 — Execution Pipeline
**Upstream:** github.com/openclaw/openclaw commit e635cedb

---

## Summary

| Capabilities audited | ALIGNED | MISALIGNED | HEURISTIC | MISSING |
|---------------------|---------|------------|-----------|---------|
| 13                  | **12**  | **0**      | **0**     | **1**   |

The execution pipeline has dramatically improved since the gap matrix was written.
12 of 13 applicable capabilities are now structurally aligned with upstream OpenClaw.
The sole remaining gap is **model fallback** (F1-04).

---

## Per-Capability Findings

### F1-01: 4-layer pipeline (L1→L2→L3→L4)
- **Classification**: **ALIGNED**
- **Parallx files**: `openclawTurnRunner.ts` (Layer 1: retry loop), `openclawAttempt.ts` (Layer 2: attempt execution)
- **Upstream reference**: `agent-runner.ts` (L1), `agent-runner-execution.ts` (L2), `run.ts` (L3), `attempt.ts` (L4)
- **Divergence**: Parallx collapses upstream's 4 layers into 2: retry+recovery (turn runner) and attempt execution. Upstream L1 (queue/steer) is N/A for single-user desktop. Upstream L3 (lane concurrency, auth rotation) is N/A. This is explicitly documented in the file header (lines 1-18).
- **Evidence**: `runOpenclawTurn()` → error recovery loop → `executeOpenclawAttempt()`. The DefaultParticipant calls the pipeline via `runOpenclawTurn(request, turnContext, response, token)` at `openclawDefaultParticipant.ts:156`.

### F1-02: Context overflow retry (L2)
- **Classification**: **ALIGNED**
- **Parallx file**: `openclawTurnRunner.ts` lines 32-35 (constants), lines 127-138 (retry logic)
- **Upstream reference**: `agent-runner-execution.ts:113-380` — `isContextOverflowError` → `compactEmbeddedPiSession` → retry; `run.ts` — `MAX_OVERFLOW_COMPACTION_ATTEMPTS = 3`
- **Divergence**: None. Constant `MAX_OVERFLOW_COMPACTION = 3` matches upstream. Detection via `isContextOverflow()` → `engine.compact()` → re-assemble → retry. Also includes proactive compaction at 80% capacity (lines 104-113) — Parallx-specific optimization, additive and defensive.

### F1-03: Transient HTTP error retry (L2)
- **Classification**: **ALIGNED**
- **Parallx file**: `openclawTurnRunner.ts` lines 147-154 (retry logic), `openclawErrorClassification.ts` lines 56-64 (classifier)
- **Upstream reference**: `agent-runner-execution.ts` — transient retry with 2500ms delay
- **Divergence**: Parallx adds exponential backoff (2500 → 5000 → 10000ms, capped at 15000ms), while upstream uses flat 2500ms. This is a reasonable improvement. Patterns: `ECONNREFUSED|ETIMEDOUT|ECONNRESET|ENOTFOUND|503|502|EPIPE`.

### F1-04: Model fallback (L2)
- **Classification**: **MISSING**
- **Parallx file**: No implementation.
- **Upstream reference**: `model-fallback.ts:759-785` — `runWithModelFallback`: wraps execution with provider failover; tries primary model, falls back to alternates.
- **Divergence**: `runOpenclawTurn()` calls `executeOpenclawAttempt()` directly — no model-level fallback. Non-transient model failures propagate immediately. `ILanguageModelsService` has a fallback chain for model selection, but no retry-on-failure fallback.
- **Severity**: **MEDIUM** — Functions when model is loaded and healthy. Failure: if Ollama OOMs on a 32B model, request fails rather than trying smaller model.

### F1-05: Model resolution (L3)
- **Classification**: **ALIGNED**
- **Parallx file**: `openclawDefaultParticipant.ts:267` — `services.getActiveModel() ?? request.modelId`, `openclawModelTier.ts:17` — `resolveModelTier()`
- **Upstream reference**: `run.ts:255-370` — `resolveModel`
- **Divergence**: UI-driven via `ILanguageModelsService` rather than agent-config-driven. Documented Parallx adaptation.

### F1-06: Main retry loop (L3)
- **Classification**: **ALIGNED**
- **Parallx file**: `openclawTurnRunner.ts` lines 91-162 — `while (!token.isCancellationRequested)` loop
- **Upstream reference**: `run.ts:879-1860` — main retry loop
- **Divergence**: Upstream uses iteration bounds (min 32, max 160) from auth profile count. Parallx uses individual retry counters as implicit bounds (max 9 iterations). No auth profile iteration needed for single-Ollama.

### F1-07: Workspace/sandbox setup (L4)
- **Classification**: **ALIGNED**
- **Parallx file**: `openclawDefaultParticipant.ts:250-256` — `loadOpenclawBootstrapEntries`, workspace digest
- **Upstream reference**: `attempt.ts:1672-1700` — workspace setup

### F1-08: Skill loading (L4)
- **Classification**: **ALIGNED**
- **Parallx file**: `openclawDefaultParticipant.ts:258-259` — `getSkillCatalog`, `openclawSkillState.ts:17-66` — `buildOpenclawRuntimeSkillState`
- **Upstream reference**: `attempt.ts:1692-1743` — `loadSkillEntries`
- **Evidence**: Skills flow into system prompt at `openclawSystemPrompt.ts:101-102` and into tools at `openclawToolState.ts:43-67`. Gap matrix's "Skills loaded but not integrated into tool creation" has been fixed.

### F1-09: System prompt construction (L4)
- **Classification**: **ALIGNED**
- **Parallx file**: `openclawSystemPrompt.ts:84-142` — `buildOpenclawSystemPrompt()`, `openclawPromptArtifacts.ts:42-67` — integration layer
- **Upstream reference**: `system-prompt.ts:110-400` — `buildAgentSystemPrompt`
- **Evidence**: Multi-section structure: Identity → Safety → Skills (XML) → Tool summaries → Workspace context → Context engine addition → Preferences → Runtime metadata → Behavioral rules → Model-tier guidance. Budget-aware truncation.

### F1-10: Tool creation (L4)
- **Classification**: **ALIGNED**
- **Parallx file**: `openclawToolState.ts:20-92` — `buildOpenclawRuntimeToolState()`, `openclawToolPolicy.ts:80-100` — `applyOpenclawToolPolicy()`
- **Upstream reference**: `attempt.ts:80` — `createOpenClawCodingTools`; `tool-policy.ts` — `isToolAllowedByPolicies`
- **Evidence**: Platform registration + skill catalog → policy filtering (readonly/standard/full profiles → deny-first).

### F1-11: Ollama num_ctx injection (L4)
- **Classification**: **ALIGNED**
- **Parallx file**: `openclawAttempt.ts:204` — `numCtx: context.tokenBudget`, `ollamaProvider.ts:395-399` — forwards to `ollamaOptions['num_ctx']`
- **Upstream reference**: `attempt.ts` — `shouldInjectOllamaCompatNumCtx`, `wrapOllamaCompatNumCtx`
- **Divergence**: Upstream wraps the stream function; Parallx passes `numCtx` on `IChatRequestOptions` — provider picks it up. End result identical.

### F1-12: Context engine bootstrap (L4)
- **Classification**: **ALIGNED**
- **Parallx file**: `openclawTurnRunner.ts:92-97` — bootstrap before retry loop, `openclawContextEngine.ts:140-153` — implementation
- **Upstream reference**: `attempt.context-engine-helpers.ts` — `runAttemptContextEngineBootstrap`
- **Evidence**: Bootstrap checks service readiness (RAG, memory, concepts, transcripts, page). Tested in `openclawContextEngine.test.ts:107-128`.

### F1-13: Context engine assembly (L4)
- **Classification**: **ALIGNED**
- **Parallx file**: `openclawTurnRunner.ts:99-107` — assemble in retry loop, `openclawContextEngine.ts:155-320` — implementation
- **Upstream reference**: `attempt.context-engine-helpers.ts` — `assembleAttemptContextEngine`
- **Evidence**: Parallel retrieval (RAG, memory, concepts, transcripts, pages) with sub-lane budget allocation (55/15/15/10/5%). History trimmed to budget. Re-retrieval on insufficient evidence.

---

## Critical Findings

1. **F1-04 Model fallback is the sole MISSING capability.** Upstream `runWithModelFallback` tries alternate models on failure. Parallx has no equivalent — non-transient model failures are terminal.

2. **No unit tests for `openclawTurnRunner.ts` or `openclawAttempt.ts`.** These are the two primary pipeline files — retry logic, tool loop with mid-loop compaction, and model stream execution are all untested at the unit level.

3. **No unit tests for `openclawErrorClassification.ts`.** The three classifiers are exercised indirectly through the readonly turn runner tests but have no dedicated tests.

4. **Readonly turn runner lacks `ChatToolLoopSafety`.** Main attempt uses `ChatToolLoopSafety` for infinite loop detection. Readonly runner relies only on `maxIterations` — a model calling different tools each iteration could exhaust the budget.

---

## Test Coverage Assessment

| File | Test File | Status |
|------|-----------|--------|
| `openclawTurnRunner.ts` | **None** | **MISSING** |
| `openclawAttempt.ts` | **None** | **MISSING** |
| `openclawErrorClassification.ts` | **None** | **MISSING** |
| `openclawReadOnlyTurnRunner.ts` | `openclawReadOnlyTurnRunner.test.ts` | **Good** — 11 tests |
| `openclawContextEngine.ts` | `openclawContextEngine.test.ts` | **Good** — Comprehensive |
| `openclawTokenBudget.ts` | `openclawContextEngine.test.ts` | **Good** |
| `openclawModelTier.ts` | **None** | **MISSING** |
