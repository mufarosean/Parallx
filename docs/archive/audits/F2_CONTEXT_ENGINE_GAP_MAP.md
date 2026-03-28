# Change Plan: F2 — Context Engine

**Date:** 2026-03-27  
**Author:** Gap Mapper  
**Input:** F2 Context Engine Audit (Iteration 1)  
**Baseline:** 3 ALIGNED, 3 MISALIGNED, 0 HEURISTIC, 0 MISSING

---

## Overview Table

| Gap ID | Capability | Status | Target | Severity | Depends On |
|--------|-----------|--------|--------|----------|------------|
| GAP-F2-04 | Context Maintenance | MISALIGNED → ALIGNED | Add `maintain()` method separating proactive maintenance from emergency `compact()` | MEDIUM | — |
| GAP-F2-05 | Per-Attempt Helpers | MISALIGNED → ACCEPTED | Accept as-is with behavioral verification tests | LOW | — |
| GAP-F2-06 | Token Budget Management | MISALIGNED → ALIGNED | Wire elastic `TokenBudgetService` into context engine, replace fixed 10/30/30/30 | MEDIUM | — |
| GAP-F2-T1 | Context Engine Tests | NEEDS EXPANSION | Add missing test coverage per audit findings | MANDATORY | GAP-F2-04, GAP-F2-06 |
| GAP-F2-T2 | Token Budget Tests | MISSING FILE | Create dedicated `openclawTokenBudget.test.ts` | MANDATORY | GAP-F2-06 |

---

## Test File Discrepancy

The auditor reported "24 tests, all passing" — the user's correction says ZERO tests exist. **Verification: `tests/unit/openclawContextEngine.test.ts` exists and contains 24 tests** covering `computeTokenBudget`, `estimateMessagesTokens`, `trimTextToBudget`, `bootstrap`, `assemble`, and `compact`. The file is real and contains substantive test code.

What IS missing:
- A dedicated `tests/unit/openclawTokenBudget.test.ts` file (token budget tests are co-located in the context engine test file)
- Tests for `afterTurn()`, sub-lane budget boundaries, evidence assessment integration, budget sum verification
- Tests for the new `maintain()` method (GAP-F2-04)
- Tests for demand-aware budget allocation (GAP-F2-06)

The plan below addresses all missing coverage.

---

## GAP-F2-04: Context Maintenance (MISALIGNED → ALIGNED)

### Problem

Upstream separates two distinct operations:
1. **`maintain()`** — proactive transcript rewrite called between turns; edits/removes/rewrites individual messages for quality
2. **`compact()`** (via `compactEmbeddedPiSessionDirect`) — emergency token reduction triggered by context overflow; summarizes entire history blocks

Parallx merges both into `compact()`, which only does summarization-based reduction. There is no proactive quality maintenance. Long conversations accumulate low-quality entries (verbose tool results, redundant acknowledgments, stale context references) that only get cleaned when the context window overflows.

### Upstream Reference

- **File:** `src/agents/pi-embedded-runner/context-engine-maintenance.ts`
  - `runContextEngineMaintenance` — runs optional transcript maintenance
  - `buildContextEngineMaintenanceRuntimeContext` — attaches rewrite helpers to runtime context
- **File:** `src/context-engine/types.ts:74-231`
  - `ContextEngine.maintain` — required lifecycle method
  - Returns `ContextEngineMaintenanceResult` = `TranscriptRewriteResult`
- **Pipeline call site:** `OPENCLAW_PIPELINE_REFERENCE.md` line 178: "Bootstrap → assemble → maintain → finalize per turn"

### Parallx Target Files

| File | Action |
|------|--------|
| `src/openclaw/openclawContextEngine.ts` | Add `maintain()` method to interface and implementation |
| `src/openclaw/openclawTurnRunner.ts` | Call `maintain()` before first `assemble()` in the retry loop |
| `tests/unit/openclawContextEngine.test.ts` | Add `maintain()` tests |

### Change Description

#### 1. Add `maintain()` to `IOpenclawContextEngine` interface

Add a new optional method to the interface:

```ts
maintain?(params: IOpenclawMaintainParams): Promise<IOpenclawMaintainResult>;
```

With types:

```ts
export interface IOpenclawMaintainParams {
  readonly sessionId: string;
  readonly tokenBudget: number;
}

export interface IOpenclawMaintainResult {
  readonly rewrites: number;    // count of messages edited/removed
  readonly tokensBefore: number;
  readonly tokensAfter: number;
}
```

#### 2. Implement `maintain()` in `OpenclawContextEngine`

Minimal Parallx adaptation of upstream transcript maintenance. **Does NOT use model calls** — performs rule-based cleanup only:

1. **Trim verbose tool results** — tool call results beyond a threshold (e.g., >2000 chars) get truncated to their first N chars + "... [truncated]"
2. **Remove redundant acknowledgment pairs** — consecutive assistant messages that are just "Understood" / "Got it" / acknowledgments with no substance
3. **Collapse stale context summaries** — if `_lastHistory` contains multiple `[Context summary]` prefixed messages, keep only the most recent one

This is the desktop-appropriate subset of upstream's `TranscriptRewriteResult` pattern. Upstream's full rewrite uses a model call to intelligently edit messages — that's appropriate for a gateway with cheap model access but not for a local-first desktop app where every model call costs time.

#### 3. Wire `maintain()` into the turn runner

In `runOpenclawTurn()`, call `maintain()` once after `bootstrap()` and before the retry loop's first `assemble()`:

```ts
// Bootstrap context engine once before retry loop
if (context.engine.bootstrap) {
  await context.engine.bootstrap({ ... });
}

// Proactive maintenance: clean transcript before first assembly
if (context.engine.maintain) {
  await context.engine.maintain({
    sessionId: context.sessionId,
    tokenBudget: context.tokenBudget,
  });
}
```

This matches upstream's lifecycle: bootstrap → maintain → assemble → execute.

### What to Remove

Nothing. `compact()` stays as-is — it handles the emergency overflow path. `maintain()` is additive, handling the proactive quality path.

### Verification Criteria

1. `maintain()` reduces token count when history contains verbose tool results
2. `maintain()` removes redundant acknowledgment pairs
3. `maintain()` collapses duplicate context summaries
4. `maintain()` is a no-op when history is clean (no rewrites needed → `rewrites: 0`)
5. `maintain()` is called before `assemble()` in the turn runner
6. `compact()` behavior is unchanged (no regression)

### Risk Assessment

- **LOW risk** — `maintain()` is additive. It doesn't replace any existing behavior.
- **Regression concern** — must verify `compact()` tests still pass after adding `maintain()`.
- **Edge case** — `maintain()` on an empty `_lastHistory` should be a safe no-op.

### Platform Adaptation Note

Upstream `maintain()` uses a model call for intelligent transcript rewriting. Parallx adaptation uses rule-based cleanup only. This is documented as intentional: local-first desktop apps should minimize model calls during context preparation. If a model-based maintenance path is wanted later, it can be added behind a config flag.

---

## GAP-F2-05: Per-Attempt Helpers (MISALIGNED → ACCEPTED)

### Problem

Upstream factors bootstrap and assembly into named helper functions in `attempt.context-engine-helpers.ts`. Parallx inlines them in `runOpenclawTurn()` and `executeOpenclawAttempt()`.

### Upstream Reference

- **File:** `src/agents/pi-embedded-runner/run/attempt.context-engine-helpers.ts`
  - `runAttemptContextEngineBootstrap` — standalone helper
  - `assembleAttemptContextEngine` — standalone helper taking token budget, messages, model ID
- **Reference:** `OPENCLAW_REFERENCE_SOURCE_MAP.md` lines 116-117

### Decision: ACCEPT AS-IS

The audit explicitly notes: *"This is a code organization issue, not a behavioral one. The calls happen in the right order."*

Reasons to accept:
1. **Behavior is correct** — bootstrap before loop, assemble at top of each iteration, compact on overflow ✓
2. **The inline code is 3-5 lines each** — extracting to helpers adds indirection without real benefit
3. **No upstream functional difference** — the helpers are thin wrappers around engine method calls
4. **Testability is already addressed** — the engine methods themselves are unit-tested independently

**What we WILL do**: Add a verification test that confirms the call order (bootstrap → assemble) is correct in the integration test plan (GAP-F2-T1).

### What to Remove

Nothing.

### Verification Criteria

1. Confirm bootstrap is called once before retry loop (existing code ✓)
2. Confirm assemble is called at top of each retry iteration (existing code ✓)
3. Add integration test verifying call order (part of GAP-F2-T1)

### Risk Assessment

- **ZERO risk** — no code change.

---

## GAP-F2-06: Token Budget Management (MISALIGNED → ALIGNED)

### Problem

The OpenClaw context engine uses `computeTokenBudget()` for a fixed 10/30/30/30 percentage split. This wastes budget when slots are underutilized:
- System prompt only uses 3% → remaining 7% wasted
- Small conversation (2 turns) doesn't need 30% history → 25% wasted
- On a 4096-token model, wasted budget is meaningful (up to ~1000 tokens lost)

An elastic `TokenBudgetService` already exists (M20 Phase G) in `src/services/tokenBudgetService.ts` with demand-driven allocation, but the OpenClaw engine doesn't use it.

### Upstream Reference

- **File:** `src/agents/pi-embedded-runner/run/attempt.context-engine-helpers.ts:52-73`
  - Token budget passed as a single number to `assembleAttemptContextEngine`
  - Engine decides internally how to allocate — upstream doesn't enforce fixed percentages
- **File:** `src/context-engine/types.ts:74-231`
  - `ContextEngine.assemble` receives total budget, not per-slot allocations
- **Reference:** `OPENCLAW_REFERENCE_SOURCE_MAP.md` line 117: `assembleAttemptContextEngine` — builds context per-attempt (messages, token budget, model ID)

### Parallx Target Files

| File | Action |
|------|--------|
| `src/openclaw/openclawContextEngine.ts` | Inject `TokenBudgetService`, use elastic allocation in `assemble()` |
| `src/openclaw/openclawTokenBudget.ts` | Add demand-aware `computeElasticBudget()`, keep `computeTokenBudget()` as fallback |
| `src/openclaw/participants/openclawDefaultParticipant.ts` | Pass `TokenBudgetService` instance into engine constructor |
| `tests/unit/openclawTokenBudget.test.ts` | New file: dedicated token budget tests |
| `tests/unit/openclawContextEngine.test.ts` | Update assemble tests for elastic behavior |

### Change Description

#### Approach: Demand-aware allocation in `computeTokenBudget` (not full `TokenBudgetService` wiring)

After analysis, the better approach is **NOT** to inject `TokenBudgetService` directly. Here's why:

1. The `TokenBudgetService.allocate()` method requires pre-built **string content** for each slot — it allocates based on actual content size. But `assemble()` needs budget ceilings BEFORE it retrieves content (to know how much to retrieve).
2. Upstream passes a single total budget number, and the engine decides splits internally. This matches the current Parallx pattern.

Instead, the right fix is to make `computeTokenBudget()` **demand-aware** — it should accept actual usage hints and redistribute unused capacity:

#### 1. Add `computeElasticBudget()` to `openclawTokenBudget.ts`

```ts
export interface IOpenclawElasticBudgetParams {
  readonly contextWindow: number;
  /** Actual system prompt token count (if known from previous turn or estimate). */
  readonly systemActual?: number;
  /** Actual history token count (from estimateMessagesTokens). */
  readonly historyActual?: number;
  /** Actual user prompt token count. */
  readonly userActual?: number;
}

export function computeElasticBudget(params: IOpenclawElasticBudgetParams): IOpenclawTokenBudget {
  const total = Math.max(0, Math.floor(params.contextWindow));
  if (total === 0) return { total: 0, system: 0, rag: 0, history: 0, user: 0 };

  // Start with fixed-percentage ceilings
  const systemCeil = Math.floor(total * 0.10);
  const ragCeil = Math.floor(total * 0.30);
  const historyCeil = Math.floor(total * 0.30);
  const userCeil = Math.floor(total * 0.30);

  // If actuals are known, compute surplus from underutilized slots
  const systemUsed = Math.min(params.systemActual ?? systemCeil, systemCeil);
  const historyUsed = Math.min(params.historyActual ?? historyCeil, historyCeil);
  const userUsed = Math.min(params.userActual ?? userCeil, userCeil);

  // Surplus = ceiling - actual for slots that underutilize
  const surplus = (systemCeil - systemUsed) + (historyCeil - historyUsed) + (userCeil - userUsed);

  // Redistribute surplus to RAG (primary beneficiary of unused budget)
  return {
    total,
    system: systemUsed,
    rag: ragCeil + surplus,
    history: historyUsed,
    user: userUsed,
  };
}
```

#### 2. Update `OpenclawContextEngine.assemble()` to use elastic budget

In `assemble()`, replace:
```ts
const budget = computeTokenBudget(params.tokenBudget);
```

With demand-aware allocation that uses actual history and prompt sizes:

```ts
const historyTokenEstimate = estimateMessagesTokens(effectiveHistory);
const userTokenEstimate = estimateTokens(params.prompt);
const budget = computeElasticBudget({
  contextWindow: params.tokenBudget,
  historyActual: historyTokenEstimate,
  userActual: userTokenEstimate,
  // systemActual not known at this point — uses ceiling
});
```

This gives RAG the surplus from short history/prompt.

#### 3. Keep `computeTokenBudget()` as fallback

`computeTokenBudget()` stays — it's used by other code paths (system prompt budget check in `executeOpenclawAttempt`, and as a simple fallback). No deletion.

### What to Remove

- The fixed `computeTokenBudget(params.tokenBudget)` call in `assemble()` — replaced with `computeElasticBudget()`.
- No other code removed.

### Verification Criteria

1. **Short conversation + small prompt**: RAG gets substantially more than 30% (surplus from underutilized history/user)
2. **Full conversation + long prompt**: Budget falls back to near 10/30/30/30 (no surplus to redistribute)
3. **Zero context window**: Returns all zeros (same as before)
4. **4096-token model with 2-turn history**: RAG budget meaningfully larger than 1228 (30% of 4096)
5. **Existing tests pass**: `computeTokenBudget()` behavior unchanged
6. **No budget overrun**: `system + rag + history + user ≤ total` for all inputs

### Risk Assessment

- **MEDIUM risk** — budget allocation change affects what content fits in context.
- **Regression concern** — assemble tests that check specific token counts may need updating.
- **Mitigation** — `computeElasticBudget()` with no actuals provided degrades to fixed-percentage behavior (same as before).
- **Cross-file impact** — `executeOpenclawAttempt` uses `Math.floor(context.tokenBudget * 0.10)` for system budget check — this is independent and unaffected.

---

## GAP-F2-T1: Context Engine Test Expansion

### Missing Coverage (from audit section "Missing Coverage")

Add to `tests/unit/openclawContextEngine.test.ts`:

| Test | Category | Description |
|------|----------|-------------|
| `afterTurn smoke test` | afterTurn | Verify afterTurn() completes without error |
| `maintain() no-op on clean history` | maintain | New method returns `rewrites: 0` when nothing to clean |
| `maintain() trims verbose tool results` | maintain | Tool results >2000 chars get truncated |
| `maintain() removes redundant acks` | maintain | Consecutive "Understood" messages removed |
| `maintain() collapses duplicate summaries` | maintain | Multiple `[Context summary]` entries → keep latest |
| `maintain() called before assemble in runner` | integration | Verify call order spy |
| `assemble() uses elastic budget` | budget | With short history, RAG gets more than 30% |
| `assemble() elastic fallback` | budget | With no actuals, matches fixed-percentage behavior |
| `sub-lane budget at exact boundary` | assemble | Content exactly at lane limit is included, content at limit+1 is excluded |
| `budget sum ≤ total` | budget | `Math.floor` rounding doesn't violate total |
| `estimateTokens re-export identity` | token budget | Verify re-exported `estimateTokens` is same function as `tokenBudgetService.estimateTokens` |

### Test Approach

- Use existing `createMockServices()` factory
- For `maintain()` tests: populate `_lastHistory` via `assemble()`, then call `maintain()`
- For elastic budget tests: provide known-size history and verify RAG allocation increases

---

## GAP-F2-T2: Dedicated Token Budget Test File

### File: `tests/unit/openclawTokenBudget.test.ts`

Create a dedicated test file for token budget functions. Existing budget tests in `openclawContextEngine.test.ts` can stay (they're co-located and fine), but the new elastic function needs focused testing.

| Test | Function | Description |
|------|----------|-------------|
| `computeElasticBudget with no actuals = fixed split` | `computeElasticBudget` | Degrades to 10/30/30/30 |
| `computeElasticBudget redistributes system surplus` | `computeElasticBudget` | System uses 3% → RAG gets 7% extra |
| `computeElasticBudget redistributes history surplus` | `computeElasticBudget` | Short history → RAG gets surplus |
| `computeElasticBudget redistributes user surplus` | `computeElasticBudget` | Short prompt → RAG gets surplus |
| `computeElasticBudget combined surplus` | `computeElasticBudget` | All three underutilize → RAG gets big boost |
| `computeElasticBudget never exceeds total` | `computeElasticBudget` | `system + rag + history + user ≤ total` for edge cases |
| `computeElasticBudget zero window` | `computeElasticBudget` | Returns all zeros |
| `computeElasticBudget 4096-token model` | `computeElasticBudget` | Realistic small model with 2-turn conversation |
| `computeElasticBudget actuals exceed ceiling` | `computeElasticBudget` | Actuals > ceiling → clamped to ceiling, no negative surplus |
| `trimTextToBudget preserves recency` | `trimTextToBudget` | End of text is kept (already tested, but here for completeness) |

---

## Dependency Order for Execution

```
GAP-F2-06 (Token Budget)      ← no dependencies, changes function signatures
    │
    ├── GAP-F2-T2 (Token Budget Tests)  ← tests the new function
    │
GAP-F2-04 (Context Maintenance)  ← no dependencies, adds new method
    │
    ├── GAP-F2-T1 (Context Engine Test Expansion)  ← tests both GAP-F2-04 and GAP-F2-06
    │
GAP-F2-05 (Accepted)  ← no code change
```

**Recommended execution order:**

1. **GAP-F2-06** — Add `computeElasticBudget()` to `openclawTokenBudget.ts`, update `assemble()`
2. **GAP-F2-T2** — Create `tests/unit/openclawTokenBudget.test.ts` and verify elastic function
3. **GAP-F2-04** — Add `maintain()` to interface + implementation + turn runner call
4. **GAP-F2-T1** — Expand `tests/unit/openclawContextEngine.test.ts` with all missing tests
5. **Verify** — Run full test suite, confirm no regressions

---

## Risk Assessment Summary

| Risk | Severity | Mitigation |
|------|----------|------------|
| Elastic budget changes RAG content volume | MEDIUM | `computeElasticBudget` without actuals degrades to fixed split; existing tests verify baseline |
| `maintain()` accidentally removes wanted messages | LOW | Rule-based only — no model calls; conservative thresholds; tests verify preservation |
| Test file changes break existing coverage | LOW | Additive only — no existing tests modified, only new tests added (except assemble budget test updates) |
| Cross-file import changes | LOW | `computeElasticBudget` is a new export, not a rename; `computeTokenBudget` stays |
| Budget sum rounding errors | LOW | Explicit test: `system + rag + history + user ≤ total` |

---

## Anti-Pattern Check

| Anti-Pattern | Status |
|-------------|--------|
| Preservation bias | ✓ CLEAR — `computeTokenBudget` kept only as fallback, not because it exists |
| Patch-thinking | ✓ CLEAR — elastic budget replaces the fixed split in `assemble()`, not patched on top |
| Wrapper framing | ✓ CLEAR — `maintain()` is a direct upstream lifecycle method, not a wrapper |
| Output repair | ✓ CLEAR — no post-processing of model output |
| Pre-classification | ✓ CLEAR — no regex routing added |
| Eval-driven patchwork | ✓ CLEAR — changes derive from upstream patterns, not test results |

---

## Files Modified Summary

| File | Changes |
|------|---------|
| `src/openclaw/openclawTokenBudget.ts` | Add `IOpenclawElasticBudgetParams`, `computeElasticBudget()` |
| `src/openclaw/openclawContextEngine.ts` | Add `maintain()` types + implementation; update `assemble()` to use `computeElasticBudget()` |
| `src/openclaw/openclawTurnRunner.ts` | Call `maintain()` after `bootstrap()`, before retry loop |
| `tests/unit/openclawContextEngine.test.ts` | Add ~11 new tests for maintain, elastic budget, afterTurn, boundaries |
| `tests/unit/openclawTokenBudget.test.ts` | **NEW FILE** — ~10 tests for `computeElasticBudget()` |

**Files NOT modified** (confirmed no changes needed):
- `src/services/tokenBudgetService.ts` — no changes, stays as shared utility
- `src/openclaw/openclawAttempt.ts` — uses independent system budget check, unaffected
- `src/openclaw/openclawTypes.ts` — no type changes needed
- `src/openclaw/participants/openclawDefaultParticipant.ts` — no constructor change needed (elastic budget is internal to engine)
