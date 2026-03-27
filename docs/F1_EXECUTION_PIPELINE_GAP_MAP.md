# F1 Execution Pipeline — Gap Map (Change Plan)

**Date:** 2026-03-27  
**Mapper:** Gap Mapper  
**Input:** `F1_EXECUTION_PIPELINE_AUDIT.md` (Iteration 1)  
**Domain:** F1 — Execution Pipeline  
**Upstream:** `github.com/openclaw/openclaw` commit e635cedb

---

## Summary

| Gap ID | Title | Audit Status | Target |
|--------|-------|-------------|--------|
| GAP-F1-01 | Model fallback | MISSING → ALIGNED | Add model fallback retry wrapper in turn runner |
| GAP-F1-02 | Tool loop safety in readonly runner | MISSING safety mechanism | Add `ChatToolLoopSafety` to readonly runner |
| GAP-F1-03 | Unit tests — Turn runner | MISSING tests | Create `openclawTurnRunner.test.ts` |
| GAP-F1-04 | Unit tests — Attempt | MISSING tests | Create `openclawAttempt.test.ts` |
| GAP-F1-05 | Unit tests — Error classification | MISSING tests | Create `openclawErrorClassification.test.ts` |
| GAP-F1-06 | Unit tests — Model tier | MISSING tests | Create `openclawModelTier.test.ts` |

---

## GAP-F1-01: Model Fallback

- **Status**: MISSING → ALIGNED
- **Upstream**: `model-fallback.ts:759-785` — `runWithModelFallback`; integrated at L2 (`agent-runner-execution.ts:113-763`) where inner call to L3 is wrapped in this function. On non-transient model failure, tries the next model in the fallback chain.
- **Upstream reference doc**: `OPENCLAW_PIPELINE_REFERENCE.md` lines 70-73: "Wrap execution in `runWithModelFallback` (from model-fallback.ts) — Provider failover: tries primary model, falls back to alternates"
- **Parallx target file**: `src/openclaw/openclawTurnRunner.ts` — `runOpenclawTurn()` (lines 82-210)
- **Secondary files**: `src/openclaw/openclawErrorClassification.ts` (add `isModelError` classifier), `src/openclaw/openclawTurnRunner.ts` (add `IOpenclawTurnContext` model-fallback field)

### What upstream does

`runWithModelFallback` wraps the inner execution call. When the primary model returns a non-transient failure (OOM, model-not-found, model-load-failure), it:
1. Catches the error
2. Resolves the next model in the fallback chain
3. Retries the execution with the alternate model
4. If all models exhausted, throws the last error

### What Parallx must change

**Parallx adaptation**: Upstream rotates cloud API providers. Parallx has a single Ollama instance but may have multiple models loaded. The adaptation is: on non-transient model error (OOM, model-not-loaded), ask `ILanguageModelsService` for available models, pick the next one, rebuild `sendChatRequest` with the alternate model, and retry.

#### Change 1: Add `isModelError` classifier

**File**: `src/openclaw/openclawErrorClassification.ts`  
**Action**: Add a new exported function `isModelError(error: unknown): boolean` after `isTimeoutError`.  
**Pattern**: Detect Ollama-specific non-transient model failures: `"out of memory"`, `"model not found"`, `"failed to load model"`, `"insufficient"`, `"CUDA out of memory"`, `"ggml_metal"`.  
**Why not transient**: These errors won't resolve by retrying the same model — need a different model.

#### Change 2: Add model fallback fields to `IOpenclawTurnContext`

**File**: `src/openclaw/openclawAttempt.ts` — `IOpenclawTurnContext` interface  
**Action**: Add two optional fields:
```ts
/** Ordered list of fallback model IDs to try if primary fails. */
readonly fallbackModels?: readonly string[];
/** Callback to rebuild sendChatRequest for a different model. */
readonly rebuildSendChatRequest?: (modelId: string) => IOpenclawTurnContext['sendChatRequest'];
```

#### Change 3: Wire fallback models in participant

**File**: `src/openclaw/participants/openclawDefaultParticipant.ts` — `buildOpenclawTurnContext()`  
**Action**: After resolving `runtimeInfo.model`, query `services.getModels?.()` (via `ILanguageModelsService`) to get all available models, filter out the primary, and pass as `fallbackModels`. Wire `rebuildSendChatRequest` to re-delegate through `services.sendChatRequest` with a model-override option.

#### Change 4: Add model fallback retry in turn runner

**File**: `src/openclaw/openclawTurnRunner.ts` — `runOpenclawTurn()`, in the catch block (after transient retry at line ~185)  
**Action**: Add a new error branch between the transient retry (3c) and the unrecoverable throw (3d):
```
// 3d. Model failure → try next fallback model
if (isModelError(error) && context.fallbackModels && fallbackIndex < context.fallbackModels.length) {
  const nextModel = context.fallbackModels[fallbackIndex];
  response.progress(`Model error, falling back to ${nextModel}...`);
  if (context.rebuildSendChatRequest) {
    context = { ...context, sendChatRequest: context.rebuildSendChatRequest(nextModel) };
  }
  fallbackIndex++;
  continue;
}
```
**What to add**: Declare `let fallbackIndex = 0;` at the top of the retry state (line ~96). Import `isModelError` from `openclawErrorClassification.js`.  
**What to remove**: Nothing — this is purely additive.

### Before-Writing Checklist (M41 5 Questions)

1. **Does the upstream reference exist?** YES — `model-fallback.ts:759-785`, cited in `OPENCLAW_PIPELINE_REFERENCE.md` L70-73 and `OPENCLAW_GAP_MATRIX.md` row 5.
2. **Is this the minimum change?** YES — 4 small, additive changes: one classifier, two interface fields, one retry branch, one wiring point.
3. **Does it avoid anti-patterns?** YES — No output repair, no pre-classification, no eval-driven patchwork. Structural retry on model failure.
4. **Is the Parallx adaptation documented?** YES — Upstream rotates cloud providers; Parallx rotates local Ollama models. Same pattern, different resolution mechanism.
5. **What could break?** If `ILanguageModelsService.getModels()` returns stale data, fallback might try an unloaded model. Mitigation: fallback models are resolved at turn start (fresh) and the fallback loop will catch the next failure and try the next model.

### Verification Criteria

- Unit test: Simulate a model error on first attempt → verify fallback model is used on retry
- Unit test: All fallback models fail → verify original error is thrown
- Unit test: `isModelError` correctly classifies Ollama OOM and model-not-found errors
- Integration: Unload primary model from Ollama, send message → verify it falls back to alternate model

### Risk Assessment

- **LOW**: Purely additive change. Existing behavior (throw on model error) is preserved when `fallbackModels` is empty/undefined.
- **Watch**: `IOpenclawTurnContext` is a readonly interface; spreading it with `{...context, sendChatRequest}` requires `context` param to become `let` instead of `const` in `runOpenclawTurn`.

---

## GAP-F1-02: Tool Loop Safety in Readonly Runner

- **Status**: MISSING safety mechanism → ALIGNED
- **Upstream**: `agent-runner-execution.ts:113-380` — all agent turns use tool loop safety. The main attempt (`openclawAttempt.ts:207`) instantiates `ChatToolLoopSafety` and calls `loopSafety.record()` before each tool execution (lines 254-259).
- **Parallx target file**: `src/openclaw/openclawReadOnlyTurnRunner.ts` — `runOpenclawReadOnlyTurn()`, tool execution loop (lines 217-225)
- **Upstream reference doc**: `src/services/chatToolLoopSafety.ts` — `ChatToolLoopSafety.record()` blocks after 8 consecutive identical calls.

### What the main attempt does (the pattern to replicate)

In `openclawAttempt.ts:207`:
```ts
const loopSafety = new ChatToolLoopSafety();
```
Then at line 254-259, before each tool call:
```ts
const safety = loopSafety.record(toolCall.function.name, toolCall.function.arguments);
if (safety.blocked) {
  loopBlocked = true;
  break;
}
```

### What Parallx must change

**File**: `src/openclaw/openclawReadOnlyTurnRunner.ts`

#### Change 1: Import ChatToolLoopSafety

**Action**: Add import at the top of the file:
```ts
import { ChatToolLoopSafety } from '../services/chatToolLoopSafety.js';
```

#### Change 2: Instantiate and use loop safety

**Location**: Inside `runOpenclawReadOnlyTurn()`, before the main while loop (~line 122).  
**Action**: Add `const loopSafety = new ChatToolLoopSafety();`

**Location**: Inside the tool call execution loop (~lines 217-225), before each `invokeToolWithRuntimeControl` call.  
**Action**: Add the safety check:
```ts
const safety = loopSafety.record(toolName, toolCall.function.arguments);
if (safety.blocked) {
  response.warning(`Stopped: repeated identical ${toolName} calls detected.`);
  break; // Exit tool loop, complete turn
}
```

### What to remove

Nothing — purely additive.

### Before-Writing Checklist (M41 5 Questions)

1. **Does the upstream reference exist?** YES — `agent-runner-execution.ts` applies safety to all agents. Main attempt already has it at `openclawAttempt.ts:207,254-259`.
2. **Is this the minimum change?** YES — one import, one instantiation, one guard check.
3. **Does it avoid anti-patterns?** YES — reuses the existing canonical `ChatToolLoopSafety` from `src/services/chatToolLoopSafety.ts`.
4. **Is the Parallx adaptation documented?** N/A — identical pattern to main attempt.
5. **What could break?** Readonly turns that legitimately call the same tool 8+ times with identical args would be blocked. This matches the main attempt's behavior and is the correct safety boundary.

### Verification Criteria

- Extend `openclawReadOnlyTurnRunner.test.ts`: Add test that simulates 10 identical tool calls → verify turn stops after 8 with a warning.
- Existing 11 tests must continue passing.

### Risk Assessment

- **VERY LOW**: Same pattern already proven in the main attempt. Import is from the canonical shared location.

---

## GAP-F1-03: Unit Tests — Turn Runner

- **Status**: MISSING tests
- **Upstream**: `openclawTurnRunner.ts` is the Layer 1 retry loop — the most critical reliability mechanism.
- **Parallx target file**: Create `tests/unit/openclawTurnRunner.test.ts`

### What to test

| Test | Description | Verifies |
|------|-------------|----------|
| Successful turn | Happy path: assemble → attempt → return result | Basic pipeline flow |
| Context overflow → compact → retry | Mock `executeOpenclawAttempt` to throw overflow on first call, succeed on second | F1-02 ALIGNED status |
| Max overflow retries exhausted | Throw overflow 4 times → verify throws on 4th (max 3 retries) | Retry bound |
| Timeout → force compact → retry | Throw timeout → verify engine.compact called with `force: true` | F1-02 ALIGNED, timeout path |
| Max timeout retries exhausted | Throw timeout 3 times → verify throws on 3rd (max 2 retries) | Retry bound |
| Transient → delay → retry | Throw transient → verify delay → succeed on retry | F1-03 ALIGNED status |
| Max transient retries exhausted | Throw transient 4 times → verify throws | Retry bound |
| Cancellation respected | Set `token.isCancellationRequested` mid-loop → verify early exit | Token handling |
| Proactive compaction at 80% | Mock assembled.estimatedTokens > 80% budget → verify compact called before attempt | Proactive compaction path |
| Context engine bootstrap called once | Verify `engine.bootstrap` called exactly once before retry loop | Bootstrap lifecycle |
| Model fallback (after GAP-F1-01) | Throw model error with fallbackModels → verify retry with next model | F1-04 once implemented |

### Test structure

- Mock `executeOpenclawAttempt` (vi.mock the module)
- Mock `IOpenclawTurnContext.engine` methods (bootstrap, assemble, compact)
- Create minimal `IChatResponseStream` and `ICancellationToken` stubs (reuse patterns from `openclawReadOnlyTurnRunner.test.ts`)
- Each test controls which errors are thrown and on which call

### Before-Writing Checklist

1. **Upstream reference?** YES — tests verify the behavior documented in `agent-runner-execution.ts:113-380` (overflow retry, transient retry, timeout retry).
2. **Minimum change?** YES — test file only, no production code changes.
3. **Anti-patterns?** N/A for tests.
4. **Adaptation documented?** N/A for tests.
5. **What could break?** Nothing — test-only change.

---

## GAP-F1-04: Unit Tests — Attempt

- **Status**: MISSING tests
- **Upstream**: `openclawAttempt.ts` is the Layer 2 single-attempt execution — system prompt, tool loop, model streaming.
- **Parallx target file**: Create `tests/unit/openclawAttempt.test.ts`

### What to test

| Test | Description | Verifies |
|------|-------------|----------|
| Simple turn, no tools | Mock model returns text-only → verify result.markdown | Basic execution |
| Tool call loop | Mock model returns tool call → mock tool result → model returns text | Tool loop |
| Tool result truncation | Mock tool returning >20,000 chars → verify truncation | MAX_TOOL_RESULT_CHARS |
| ChatToolLoopSafety blocks | Mock model returning 8+ identical tool calls → verify loop stops | Loop safety |
| All tools failed → stop | Mock tool results all starting with "Error:" → verify loop stops | All-tools-failed guard |
| Mid-loop compaction | Mock messages exceeding 85% budget → verify engine.compact called | Mid-loop budget check |
| maxToolIterations respected | Exceed iteration count → verify loop stops | Iteration bound |
| Cancellation mid-tool-loop | Cancel token during tool execution → verify early exit | Token handling |
| System prompt budget warning | System tokens > 10% of budget → verify console.warn | Budget check |
| Mention context injected | Provide mentionContextBlocks → verify an extra user message in messages | M2 injection |

### Test structure

- Mock `sendChatRequest` to return controlled async iterables
- Mock `invokeToolWithRuntimeControl` for tool call tests
- Stub `engine.compact`, `engine.assemble`, `engine.afterTurn`
- Stub `buildOpenclawPromptArtifacts` to return a fixed prompt (vi.mock)
- Reuse `createResponse()`, `createToken()` helpers from readonly runner tests

### Before-Writing Checklist

1. **Upstream reference?** YES — tests verify behavior from `attempt.ts:1672-3222` (tool loop, session lifecycle, prompt assembly).
2. **Minimum change?** YES — test file only.
3. **Anti-patterns?** N/A.
4. **Adaptation documented?** N/A.
5. **What could break?** Nothing.

---

## GAP-F1-05: Unit Tests — Error Classification

- **Status**: MISSING tests
- **Upstream**: `openclawErrorClassification.ts` — three classifiers driving all retry logic.
- **Parallx target file**: Create `tests/unit/openclawErrorClassification.test.ts`

### What to test

| Classifier | Positive cases | Negative cases |
|-----------|---------------|----------------|
| `isContextOverflow` | `"context length exceeded"`, `"too many tokens"`, `"context window"`, `"maximum context"` | `"timeout"`, `"ECONNREFUSED"`, generic error |
| `isTransientError` | `"ECONNREFUSED"`, `"ETIMEDOUT"`, `"ECONNRESET"`, `"ENOTFOUND"`, `"503"`, `"502"`, `"EPIPE"` | `"context length"`, `"timeout"`, generic error |
| `isTimeoutError` | `"timeout"`, `"deadline"`, `"aborted"` | `"ECONNREFUSED"`, `"context length"`, generic error |
| All three | Handles `Error` objects, plain strings, objects with `message`, non-standard values | — |
| `isModelError` (after GAP-F1-01) | `"out of memory"`, `"model not found"`, `"failed to load model"` | Transient errors, overflow errors |

### Test structure

- Simple parameterized tests: `it.each(cases)('classifies correctly', ...)`
- Test each input type: `new Error(msg)`, `msg` as string, `{ message: msg }`, `42`
- No mocks needed — pure functions

### Before-Writing Checklist

1. **Upstream reference?** YES — classifiers trace to `agent-runner-execution.ts` (overflow, transient) and Ollama API docs (timeout, model error).
2. **Minimum change?** YES — test file only.
3. **Anti-patterns?** N/A.
4. **Adaptation documented?** N/A.
5. **What could break?** Nothing.

---

## GAP-F1-06: Unit Tests — Model Tier

- **Status**: MISSING tests
- **Upstream**: `openclawModelTier.ts:17` — `resolveModelTier()` drives conditional prompt guidance.
- **Parallx target file**: Create `tests/unit/openclawModelTier.test.ts`

### What to test

| Input | Expected | Reason |
|-------|----------|--------|
| `"qwen2.5:7b-instruct"` | `'small'` | 7 ≤ 8 |
| `"qwen2.5:3b"` | `'small'` | 3 ≤ 8 |
| `"gpt-oss:20b"` | `'medium'` | 8 < 20 ≤ 32 |
| `"llama3:32b"` | `'medium'` | 32 ≤ 32 |
| `"llama3:70b"` | `'large'` | 70 > 32 |
| `"qwen3.5:110b"` | `'large'` | 110 > 32 |
| `"custom-model"` | `'medium'` | No size pattern → default medium |
| `""` | `'medium'` | Empty string → default medium |
| `"nomic-embed-text"` | `'medium'` | No size pattern → default |
| `"qwen2.5:0.5b"` | `'small'` | 0 ≤ 8 (note: regex captures `0` from `0.5b`) |

### Test structure

- Simple `describe`/`it.each` block
- No mocks — pure function
- Import `resolveModelTier` from `../../src/openclaw/openclawModelTier`

### Before-Writing Checklist

1. **Upstream reference?** YES — `buildAgentSystemPrompt` adjusts sections based on model capabilities (OPENCLAW_REFERENCE_SOURCE_MAP.md §7). Parallx uses `resolveModelTier()` for the same purpose.
2. **Minimum change?** YES — test file only.
3. **Anti-patterns?** N/A.
4. **Adaptation documented?** N/A.
5. **What could break?** Nothing.

---

## Dependency Order

Execute changes in this order:

```
1. GAP-F1-05 — Error classification tests (pure functions, no deps)
2. GAP-F1-06 — Model tier tests (pure function, no deps)
3. GAP-F1-01a — Add isModelError to error classification
4. GAP-F1-01b — Add fallback fields to IOpenclawTurnContext
5. GAP-F1-01c — Wire fallback models in participant
6. GAP-F1-01d — Add fallback retry branch in turn runner
7. GAP-F1-02 — Add ChatToolLoopSafety to readonly runner
8. GAP-F1-03 — Turn runner tests (depends on 6 landing)
9. GAP-F1-04 — Attempt tests (no new deps)
```

Steps 1-2 are independent and can run in parallel.  
Steps 3-6 are sequential (each depends on prior).  
Steps 7, 8, 9 are independent of each other but 8 depends on 6.

---

## Cross-File Impact Summary

| File | Change type | Impact |
|------|------------|--------|
| `src/openclaw/openclawErrorClassification.ts` | Add `isModelError` | New export, no breaking changes |
| `src/openclaw/openclawAttempt.ts` | Extend `IOpenclawTurnContext` interface | Additive — new optional fields |
| `src/openclaw/openclawTurnRunner.ts` | Add fallback retry branch, change `context` from const to let | Behavioral change — new retry path |
| `src/openclaw/participants/openclawDefaultParticipant.ts` | Wire fallback models in `buildOpenclawTurnContext` | Additive — populates new optional fields |
| `src/openclaw/openclawReadOnlyTurnRunner.ts` | Add import + safety check | Behavioral change — can now block infinite loops |
| `tests/unit/openclawTurnRunner.test.ts` | New file | Test-only |
| `tests/unit/openclawAttempt.test.ts` | New file | Test-only |
| `tests/unit/openclawErrorClassification.test.ts` | New file | Test-only |
| `tests/unit/openclawModelTier.test.ts` | New file | Test-only |

---

## What This Plan Does NOT Include

- **No changes to canvas core, electron, or indexing pipeline** — out of scope per M41.
- **No output repair** — model fallback is a structural retry, not output post-processing.
- **No pre-classification** — error classifiers match Ollama API error patterns, not user intent.
- **No eval-driven patches** — all changes trace to upstream `model-fallback.ts` and `agent-runner-execution.ts`.
