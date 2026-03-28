# D6: Compaction Depth — Structural Audit

**Auditor:** AI Parity Auditor (M47)  
**Date:** 2026-03-28  
**Domain:** Compaction Depth — identifier preservation, quality audit, retry  
**Status:** 4/8 ALIGNED, 2/8 PARTIAL, 2/8 MISSING

---

## Files Audited

| File | Role |
|------|------|
| `src/openclaw/openclawContextEngine.ts` | `compact()`, `maintain()`, `afterTurn()` implementations |
| `src/openclaw/openclawTurnRunner.ts` | Overflow/timeout → compact → retry loop |
| `src/openclaw/openclawDefaultRuntimeSupport.ts` | `/compact` slash command handler |
| `src/openclaw/openclawTypes.ts` | `IDefaultParticipantServices` (compactSession, storeSessionMemory, storeConceptsFromSession) |
| `tests/unit/openclawContextEngine.test.ts` | Existing test coverage (compact, maintain, generation flow) |

---

## Per-Capability Classification

### D6-1: Identifier Preservation — PARTIAL

**Evidence:**
- `compact()` summarization prompt (line 399): *"Preserve all key facts, decisions, code references, and action items."*
- `/compact` command uses identical prompt (line 430 of `openclawDefaultRuntimeSupport.ts`).

**Gap:**
The prompt asks for "key facts" generically but does **not** explicitly instruct the model to preserve:
- Page names / document titles
- File paths and URIs
- Dates and timestamps
- Proper names (people, systems, entities)

Upstream compaction prompts (agent-runner-execution.ts) include explicit identifier-class enumeration. The current generic prompt risks dropping specific identifiers during aggressive summarization.

**Fix:** Strengthen the summarization system prompt with explicit identifier-class preservation instructions.

---

### D6-2: Quality Audit — MISSING

**Evidence:**
- `compact()` generates a summary and immediately uses it — no validation step.
- No code compares the summary against original history topics.
- No coverage score or quality metric is computed.

**Gap:**
Upstream pattern: after compaction, a quality check verifies the summary covers key topics from the original transcript. If coverage is below threshold, compaction is retried with a stronger prompt. Parallx skips this entirely.

**Fix:** Implement a lightweight post-compaction quality check — either model-based (ask the model to verify coverage) or heuristic (check that key identifiers from the original appear in the summary).

---

### D6-3: Retry on Low Quality — MISSING

**Evidence:**
- The turn runner retries on **overflow** and **timeout**, not on quality.
- `compact()` has no quality-based retry path.
- No `MAX_QUALITY_COMPACTION_ATTEMPTS` constant exists.

**Gap:**
Depends on D6-2 (quality audit). Without a quality signal, there's nothing to trigger quality-based retry. Upstream uses a two-pass approach: first pass with standard prompt, second pass with stronger identifier-preserving prompt if quality is low.

**Fix:** After D6-2, add a retry loop inside `compact()` that re-attempts summarization with a more explicit prompt when quality audit fails.

---

### D6-4: Concept Extraction — PARTIAL

**Evidence:**
- `storeConceptsFromSession` exists in `IDefaultParticipantServices` (line 211 of `openclawTypes.ts`).
- The service is wired through `openclawParticipantServices.ts` (line 138) and `openclawDefaultParticipant.ts` (line 239).
- BUT `compact()` never calls `storeConceptsFromSession` — it only calls `storeSessionMemory`.
- `afterTurn()` has a comment (line 457): *"This hook exists for future extensions (e.g., concept extraction from turn)"* — explicitly marked as future work.
- The memory writeback lifecycle (`queueMemoryWriteBack`) has `storeConceptsFromSession` in its deps signature but it's invoked on session end, not during compaction.

**Gap:**
Pre-compaction concept extraction is the key upstream behavior: before summarizing and discarding history, extract entities/concepts and store them. Currently concepts are extracted on session end (memory writeback), not at compaction time — so compacted-away content loses its concepts.

**Fix:** In `compact()`, before summarization, extract concepts from the about-to-be-compacted history and call `storeConceptsFromSession`. This preserves entity knowledge even when history is discarded.

---

### D6-5: Force Compaction — ALIGNED

**Evidence:**
- `IOpenclawCompactParams.force` is defined (line 97 of context engine types).
- `compact()` honors force: `if (history.length < 2 && !params.force)` — bypasses the count guard.
- Turn runner passes `force: true` on timeout retry (line 213 of `openclawTurnRunner.ts`).
- Test coverage exists: *"respects force flag — compacts even with minimal history (F2-R2-02)"*.

**Assessment:** The force flag is defined, honored, used by the retry loop, and tested. ALIGNED.

---

### D6-6: Transcript Memory Flush — ALIGNED

**Evidence:**
- `compact()` calls `storeSessionMemory` after successful summarization (line 446 of context engine).
- `/compact` command also flushes to memory (line 450 of `openclawDefaultRuntimeSupport.ts`).
- Failure is non-fatal (caught and ignored).
- Test: *"flushes summary to long-term memory after compaction"* — verifies `storeSessionMemory` is called with correct args.

**Assessment:** Both internal compaction and user-facing `/compact` flush summaries to long-term storage. ALIGNED.

---

### D6-7: Maintain Rules — ALIGNED

**Evidence:**
- `maintain()` implements three rules (lines 467-543 of context engine):
  1. **Tool result trim:** Content >2000 chars → first 1500 + `[... truncated]`
  2. **Ack removal:** Short assistant messages matching ack pattern removed
  3. **Summary collapse:** Duplicate `[Context summary]` messages — keep only latest
- Turn runner calls `maintain()` before the retry loop (line 127 of `openclawTurnRunner.ts`).
- Test coverage: 3 dedicated tests for each rule + generation detection test for maintain→assemble flow.

**Assessment:** All three upstream maintenance rules are implemented, integrated, and tested. ALIGNED.

---

### D6-8: Compaction Metrics — PARTIAL

**Evidence:**
- `IOpenclawCompactResult` returns `{ compacted, tokensBefore, tokensAfter }`.
- `IOpenclawTurnResult` tracks `overflowCompactions`, `timeoutCompactions`, `transientRetries`.
- These values are computed and returned from the turn runner.

**Gap:**
- `recordTurn()` in `openclawDefaultParticipant.ts` (line 189) only passes `{ model, promptTokens, completionTokens, totalTokens, durationMs, timestamp }`.
- `ITurnMetrics` (serviceTypes.ts:1853) has no compaction-specific fields (`compactionCount`, `tokensBefore`, `tokensAfter`, `compactionRatio`).
- The compaction stats computed by the turn runner are **discarded** — they exist in the return value but are never persisted to the observability service.

**Fix:**
1. Extend `ITurnMetrics` with compaction fields: `overflowCompactions?`, `timeoutCompactions?`, `compactionTokensBefore?`, `compactionTokensAfter?`.
2. Pass the turn result's compaction stats through to `recordTurn()`.

---

## Summary Matrix

| ID | Capability | Status | Test Coverage | Priority |
|----|-----------|--------|--------------|----------|
| D6-1 | Identifier Preservation | **PARTIAL** | No dedicated test | P1 — data loss risk |
| D6-2 | Quality Audit | **MISSING** | None | P1 — correctness |
| D6-3 | Retry on Low Quality | **MISSING** | None | P2 — depends on D6-2 |
| D6-4 | Concept Extraction | **PARTIAL** | Service wired, not called | P1 — data loss risk |
| D6-5 | Force Compaction | **ALIGNED** | ✅ F2-R2-02 | — |
| D6-6 | Transcript Memory Flush | **ALIGNED** | ✅ flush test | — |
| D6-7 | Maintain Rules | **ALIGNED** | ✅ 3 rule tests + flow | — |
| D6-8 | Compaction Metrics | **PARTIAL** | Stats computed, not recorded | P2 — observability |

---

## M41 Anti-Pattern Check

| Anti-Pattern | Found? | Detail |
|-------------|--------|--------|
| Stub returning hardcoded data | No | All implementations are functional |
| TODO/placeholder in production path | **Yes** | `afterTurn()` comment: "future extensions (e.g., concept extraction from turn)" — D6-4 gap |
| Missing error classification | No | Errors caught with fallback paths |
| Service wired but never invoked | **Yes** | `storeConceptsFromSession` in engine services, never called by compact() |
| Metrics computed but discarded | **Yes** | Turn result compaction stats never reach observability — D6-8 gap |

---

## Implementation Priority

### P1 — Must Fix (data loss / correctness risk)
1. **D6-1:** Strengthen summarization prompt with explicit identifier-class instructions
2. **D6-4:** Call `storeConceptsFromSession` during compact() before summarization
3. **D6-2:** Implement post-compaction quality check (heuristic: identifier survival rate)

### P2 — Should Fix (completeness / observability)
4. **D6-3:** Add quality-gated retry loop in compact() (depends on D6-2)
5. **D6-8:** Extend `ITurnMetrics` and wire compaction stats through `recordTurn()`

### Already Aligned — No Action
- D6-5: Force Compaction
- D6-6: Transcript Memory Flush
- D6-7: Maintain Rules

---

## Iteration 2 — Refinement Audit

**Date:** 2026-03-28  
**Scope:** 10 findings from refinement audit (R1-R10), 4 HIGH/MEDIUM addressed

### R1 HIGH: /compact command quality controls — FIXED ✅
- `/compact` (openclawDefaultRuntimeSupport.ts) now uses `COMPACTION_SUMMARIZATION_PROMPT`
- Added `extractIdentifiers` + `auditCompactionQuality` quality gate
- Quality-gated retry loop with `MAX_QUALITY_RETRIES`
- Concept extraction via `extractConceptsFromTranscript` before transcript discard

### R2 HIGH: Quality field propagation — FIXED ✅
- `IOpenclawTurnResult` extended with `compactionQualityScore` + `compactionQualityRetries`
- Turn runner captures compact results on all 3 paths (proactive, overflow, timeout)
- `ITurnMetrics` extended with `compactionQualityScore` + `compactionQualityRetries`
- Default participant passes quality fields through to `recordTurn()`

### R4 MEDIUM: Extended identifier extraction — FIXED ✅
- `extractIdentifiers()` now matches 4 additional patterns:
  - Email addresses (`\S+@\S+\.\S+`)
  - Version numbers (`v?\d+\.\d+\.\d+`)
  - CamelCase/PascalCase identifiers
  - ALL_CAPS constants (3+ chars)

### R5 MEDIUM: afterTurn concept extraction — FIXED ✅
- `afterTurn()` no longer a stub — extracts concepts from turn messages
- Converts messages to text → `extractConceptsFromTranscript` → `storeConceptsFromSession`
- Catches concepts from short sessions that never trigger compact()

### R3 MEDIUM: Canvas/workspace compaction metrics — DEFERRED
- Readonly turns don't trigger compaction — no metrics to propagate. Correct behavior.

### R6-R10 LOW: Minor refinements — DEFERRED
- R6: QUALITY_THRESHOLD configurability — not blocking
- R7: URI double-matching in extractIdentifiers — cosmetic
- R8: /usage compaction display — observability improvement
- R9: bestScore edge case — minor
- R10: /compact test coverage — covered by retry tests

### Updated Summary Matrix

| ID | Capability | Status | Test Coverage |
|----|-----------|--------|--------------|
| D6-1 | Identifier Preservation | **ALIGNED** ✅ | extractIdentifiers tests (3) |
| D6-2 | Quality Audit | **ALIGNED** ✅ | auditCompactionQuality tests (3) |
| D6-3 | Retry on Low Quality | **ALIGNED** ✅ | compact retry tests (4) |
| D6-4 | Concept Extraction | **ALIGNED** ✅ | extractConceptsFromTranscript tests (3) |
| D6-5 | Force Compaction | **ALIGNED** ✅ | F2-R2-02 |
| D6-6 | Transcript Memory Flush | **ALIGNED** ✅ | flush test |
| D6-7 | Maintain Rules | **ALIGNED** ✅ | 3 rule tests + flow |
| D6-8 | Compaction Metrics | **ALIGNED** ✅ | observability tests (2) + field propagation |
