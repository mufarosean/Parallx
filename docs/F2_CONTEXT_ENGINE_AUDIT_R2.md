# F2 Context Engine — Iteration 2 REFINEMENT Audit

**Date:** 2026-03-27  
**Auditor:** AI Parity Auditor (Claude Opus 4.6)  
**Domain:** F2 — Context Engine  
**Scope:** Line-by-line audit of all F2 implementation and test files

---

## Summary

| Total findings | ALIGNED | MISALIGNED | ACCEPTED |
|---------------|---------|------------|----------|
| 18            | 10      | 5          | 3        |

| Severity breakdown | HIGH | MEDIUM | LOW |
|--------------------|------|--------|-----|
| MISALIGNED         | 0    | 3      | 2   |

---

## Files Audited (every line read)

- `src/openclaw/openclawContextEngine.ts` — 580 lines, full implementation
- `src/openclaw/openclawTokenBudget.ts` — 152 lines, budget computation
- `tests/unit/openclawContextEngine.test.ts` — 715 lines, context engine tests
- `tests/unit/openclawTokenBudget.test.ts` — 134 lines, budget tests
- `src/openclaw/openclawResponseValidation.ts` — cross-referenced for assessEvidence/buildEvidenceConstraint
- `src/openclaw/openclawTurnRunner.ts:80-250` — caller integration check
- `src/openclaw/openclawAttempt.ts:295-350` — mid-loop compact caller check
- `src/services/tokenBudgetService.ts:140-160` — estimateTokens implementation
- `src/openclaw/openclawSystemPrompt.ts:340-365` — trimTextToBudget caller

---

## Per-Finding Details

### Finding F2-R2-01: `trimTextToBudget` returns full text when budget is 0

- **Classification:** MISALIGNED
- **File:** `src/openclaw/openclawTokenBudget.ts:141-150`
- **Issue:** When `budgetTokens = 0`, `maxChars = Math.max(0, 0 * 4) = 0`, then `text.slice(-0) === text.slice(0)` returns the **full string** in JavaScript because `-0` is treated as `0`. The function claims `trimmed: true` but returns all content.
- **Upstream reference:** No upstream equivalent, but violates the function's own contract ("Trim text to fit within a token budget").
- **Impact:** Called from `openclawSystemPrompt.ts:350,360` with `sectionBudget = Math.floor(budgetTokens * 0.3)`. When the system prompt budget is extremely small (context window < 34 tokens), sectionBudget rounds to 0 and the function returns the full section text instead of empty — defeating budget enforcement.
- **Fix:** Add explicit zero-budget guard:
  ```ts
  if (maxChars === 0) {
    return { text: '', trimmed: estimated > 0 };
  }
  ```
- **Severity:** MEDIUM (reachable from production code, defeats budget intent)

---

### Finding F2-R2-02: `compact()` ignores `params.force` flag

- **Classification:** MISALIGNED
- **File:** `src/openclaw/openclawContextEngine.ts:87` (interface declaration), `:327-442` (compact implementation)
- **Issue:** `IOpenclawCompactParams.force` is declared and passed by the turn runner on timeout (`openclawTurnRunner.ts:182`), but `compact()` never reads `params.force`. The flag is silently ignored. The intent is that `force: true` should compact more aggressively, bypassing guards like the `history.length < 2` early-return.
- **Upstream reference:** `agent-runner-execution.ts` — compaction on overflow is unconditional (no force flag), but the timeout path in Parallx is a local adaptation that explicitly uses `force: true`.
- **Fix:** When `params.force === true`, skip the `history.length < 2` guard and attempt compaction regardless.
- **Severity:** MEDIUM (timeout recovery path passes `force: true` expecting aggressive compaction; it gets the same behavior as non-forced)

---

### Finding F2-R2-03: `compact()` simple trim path claims compacted for 2-message history without reducing tokens

- **Classification:** MISALIGNED
- **File:** `src/openclaw/openclawContextEngine.ts:410-414`
- **Issue:** When the simple trim path runs on exactly 2 messages: `keepCount = Math.max(2, Math.floor(2/2)) = 2`. All messages are kept. The function bumps `_compactGeneration`, returns `compacted: true`, but `tokensAfter === tokensBefore`. The turn runner wastes up to 3 retry iterations (MAX_OVERFLOW_COMPACTION) compacting with zero effect.
- **Upstream reference:** N/A — upstream compaction always summarizes.
- **Fix:** Return `compacted: false` when `keepCount >= history.length` (no actual reduction occurred).
- **Severity:** LOW (bounded by retry limits; 3 wasted iterations max)

---

### Finding F2-R2-04: `compact()` with summarizer on minimal history increases context size

- **Classification:** MISALIGNED
- **File:** `src/openclaw/openclawContextEngine.ts:418-427`
- **Issue:** When history has exactly 2 messages and a summarizer is available: `lastExchange = history.slice(-2)` = both messages. The compacted history becomes `[summary_user, summary_ack, original_user, original_assistant]` = 4 messages. This is **larger** than the original 2 messages. `tokensAfter > tokensBefore`. Compaction made the problem worse.
- **Upstream reference:** Upstream's `compactEmbeddedPiSession` summarizes a longer transcript and replaces it with a short summary. The 2-message edge case doesn't arise upstream because compaction is triggered by overflow, which requires enough history to overflow.
- **Fix:** Skip summarizer when `history.length <= 2` — the simple trim path already handles this correctly (by returning `compacted: false` after F2-R2-03 fix).
- **Severity:** MEDIUM (compaction increases context instead of reducing it; downstream retry loop wastes iterations)

---

### Finding F2-R2-05: `assemble()` pushes empty "Retrieved Context" section when RAG returns empty text

- **Classification:** MISALIGNED
- **File:** `src/openclaw/openclawContextEngine.ts:228-242`
- **Issue:** Two related problems: (1) When `retrieveContext` returns `{ text: '', sources: [] }`, the `if (ragResult)` check passed (truthy object), pushing an empty `"## Retrieved Context\n"` header that wasted ~15 tokens. (2) `retrievedContextText` was set unconditionally before checking whether the content fit within the budget. This caused `assessEvidence` to run on content that wasn't actually included in messages, and in zero-budget scenarios, produced spurious `systemPromptAddition` constraints (~52 wasted tokens) on phantom evidence.
- **Upstream reference:** No upstream equivalent for empty-result handling, but wasteful token usage is contrary to the budget-aware assembly pattern.
- **Fix applied:** (a) Changed guard to `if (ragResult?.text)`. (b) Added `if (contextText)` inner guard to skip empty sections after slicing. (c) Moved `retrievedContextText = ragResult.text` inside the `if (contextText)` guard so assessEvidence only runs on content that was actually included in the assembled messages.
- **Severity:** LOW (15-52 wasted tokens; edge case in zero/tiny budgets)

---

### Finding F2-R2-06: `IOpenclawContextEngine` interface lifecycle

- **Classification:** ALIGNED
- **File:** `src/openclaw/openclawContextEngine.ts:40-53`
- **Issue:** None. Interface correctly implements bootstrap/assemble/compact/afterTurn/maintain lifecycle matching upstream `context-engine/types.ts:74-231`. Optional methods marked with `?`. Upstream methods not adopted (ingest, subagent, dispose) are documented with reasons.
- **Upstream reference:** `context-engine/types.ts:74-231`
- **Severity:** N/A

---

### Finding F2-R2-07: Parallel service loading in assemble()

- **Classification:** ALIGNED
- **File:** `src/openclaw/openclawContextEngine.ts:218-231`
- **Issue:** None. `Promise.all` with per-service `.catch(() => undefined)` provides correct error isolation. One failed service doesn't block others. Readiness flags from bootstrap() prevent calls to unavailable services.
- **Upstream reference:** `assembleAttemptContextEngine` — parallel context assembly.
- **Severity:** N/A

---

### Finding F2-R2-08: Elastic budget math correctness

- **Classification:** ALIGNED
- **File:** `src/openclaw/openclawTokenBudget.ts:86-111`
- **Issue:** None. Surplus redistribution to RAG is mathematically correct. The `sum ≤ total` invariant holds for all inputs because `system + rag + history + user = systemCeil + ragCeil + historyCeil + userCeil` (constant, derived from floor rounding) regardless of actual usage. Zero, negative, and over-ceiling inputs all handled correctly.
- **Upstream reference:** `context-engine-maintenance.ts` — elastic budget redistributes unused lane capacity.
- **Severity:** N/A

---

### Finding F2-R2-09: Generation counter for compact/maintain detection

- **Classification:** ALIGNED
- **File:** `src/openclaw/openclawContextEngine.ts:147-150, 188-195`
- **Issue:** None. The `_compactGeneration`/`_lastAssembleGeneration` pair correctly distinguishes compacted vs original history, including the same-length-different-content case. Both compact() and maintain() bump the counter only when changes are made. No race conditions in single-threaded execution.
- **Upstream reference:** Upstream uses mutable session state; generation counter is a Parallx adaptation that correctly achieves the same result.
- **Severity:** N/A

---

### Finding F2-R2-10: Sub-lane budget allocation (55/15/15/10/5%)

- **Classification:** ALIGNED
- **File:** `src/openclaw/openclawContextEngine.ts:205-212`
- **Issue:** None. Sub-lane percentages sum to 100% of RAG budget. Aggregate cap (`usedRagTokens + X <= budget.rag`) prevents over-allocation. Order of operations (page → RAG → memory → transcripts → concepts) is reasonable.
- **Upstream reference:** No direct upstream mapping — Parallx adaptation for multi-source RAG.
- **Severity:** N/A

---

### Finding F2-R2-11: History trimming correctness

- **Classification:** ALIGNED
- **File:** `src/openclaw/openclawContextEngine.ts:540-560`
- **Issue:** None. `trimHistoryToBudget` iterates from end (most recent first), correctly includes 4-token role overhead per message, and stops when budget is exceeded.
- **Upstream reference:** Upstream pattern — context overflow triggers compaction of older turns.
- **Severity:** N/A

---

### Finding F2-R2-12: Service readiness tracking in bootstrap()

- **Classification:** ALIGNED
- **File:** `src/openclaw/openclawContextEngine.ts:169-181`
- **Issue:** None. Checks `!!services.X` for truthiness. Sets internal state. assemble() uses these flags to skip unavailable services rather than calling and failing.
- **Upstream reference:** `runAttemptContextEngineBootstrap` (attempt.context-engine-helpers.ts)
- **Severity:** N/A

---

### Finding F2-R2-13: maintain() rules implementation

- **Classification:** ALIGNED
- **File:** `src/openclaw/openclawContextEngine.ts:455-529`
- **Issue:** None. Three rules (verbose tool trim, ack removal, summary dedup) map to upstream `context-engine-maintenance.ts` transcript rewrite patterns. Operates on a shallow copy of history, doesn't mutate caller's array. Counter bumped only when rewrites > 0.
- **Upstream reference:** `context-engine-maintenance.ts` — rule-based transcript maintenance.
- **Severity:** N/A

---

### Finding F2-R2-14: Memory flush after compaction

- **Classification:** ALIGNED
- **File:** `src/openclaw/openclawContextEngine.ts:429-436`
- **Issue:** None. `storeSessionMemory` called after successful summarization. Non-fatal try-catch. Matches upstream compaction→memory flush pattern.
- **Upstream reference:** Agent runtime triggers memory flush on compaction.
- **Severity:** N/A

---

### Finding F2-R2-15: afterTurn() hook

- **Classification:** ALIGNED
- **File:** `src/openclaw/openclawContextEngine.ts:438-443`
- **Issue:** None. No-op with documentation that platform handles persistence. Exists for future extensions.
- **Upstream reference:** `context-engine/types.ts` — finalize step.
- **Severity:** N/A

---

### Finding F2-R2-16: assessEvidence + buildEvidenceConstraint pre-model input shaping

- **Classification:** ACCEPTED
- **File:** `src/openclaw/openclawContextEngine.ts:266-295` (caller), `src/openclaw/openclawResponseValidation.ts:106-158` (implementation)
- **Issue:** Parallx-specific input shaping for weak local models. Not output repair — constrains model behavior via prompt injection when evidence is weak. Insurance-domain hardcoding (extractCoverageFocusTerms, roleBonus) was already removed in F6 audit.
- **Upstream reference:** No direct equivalent in OpenClaw. Documented as Parallx adaptation for local models that need explicit guidance when evidence is thin.
- **Rationale:** Local 7-20B models benefit significantly from explicit evidence-quality constraints. Cloud-scale models handle ambiguity better and don't need this nudge.
- **Severity:** N/A

---

### Finding F2-R2-17: buildRetrieveAgainQuery heuristic (C5 re-retrieval)

- **Classification:** ACCEPTED
- **File:** `src/openclaw/openclawContextEngine.ts:567-590`
- **Issue:** Simple regex strips question framing to produce a keyword-focused reformulated query for re-retrieval. This is a retrieval optimization, not a routing heuristic. The regex is minimal and purpose-specific.
- **Upstream reference:** No upstream re-retrieval. Parallx adaptation for local RAG where first-pass vector search may miss relevant chunks.
- **Rationale:** Lightweight reformulation that improves recall without adding complexity.
- **Severity:** N/A

---

### Finding F2-R2-18: Per-attempt helpers inlined (not factored)

- **Classification:** ACCEPTED
- **File:** `src/openclaw/openclawTurnRunner.ts:92-107`, `src/openclaw/openclawAttempt.ts:314-340`
- **Issue:** Bootstrap and assembly calls are inline in turnRunner/attempt rather than factored into helper modules matching upstream's `attempt.context-engine-helpers.ts`.
- **Upstream reference:** `attempt.context-engine-helpers.ts` — dedicated helper module.
- **Rationale:** Functionally correct. Factoring unnecessary for single-engine desktop model. Would add indirection without benefit.
- **Severity:** N/A

---

## Test Coverage Gaps

The following code paths have no test exercising them:

| Gap | Target code | Missing test scenario |
|-----|-------------|----------------------|
| T1 | `trimTextToBudget` with budget=0 | Would expose the `slice(-0)` bug (F2-R2-01) |
| T2 | `compact()` with exactly 2 messages, no summarizer | Would expose the compacted-but-unchanged issue (F2-R2-03) |
| T3 | `compact()` with `force: true` | Would expose the ignored flag (F2-R2-02) |
| T4 | `compact()` with summarizer on 2-message history | Would expose context size increase (F2-R2-04) |
| T5 | `assemble()` with RAG returning empty text | Would show unnecessary context section (F2-R2-05) |
| T6 | `assemble()` with `tokenBudget = 0` | Zero-budget edge case |
| T7 | Re-retrieval path (C5: evidence insufficient → reformulate → re-retrieve) | No test covers the assessEvidence→buildRetrieveAgainQuery→re-retrieve flow |
| T8 | Page content exceeding pageLaneBudget | Budget enforcement for open-page content |
| T9 | `storeConceptsFromSession` is in services type but never called | Dead import in `IOpenclawContextEngineServices` |

---

## Anti-Pattern Check

| Pattern | Present? | Details |
|---------|----------|---------|
| Output repair | No | No post-generation content rewriting. assessEvidence shapes INPUT, not output. |
| Pre-classification / regex routing | No | No keyword-based routing in context engine. |
| Eval-driven patchwork | No | No code that exists to pass a specific test. |
| Heuristic substitution for model | No | All retrieval/assembly is context preparation, not answer generation. |
| Preservation bias | No | Code was rewritten from scratch based on upstream patterns. |

---

## Recommended Fix Order

1. **F2-R2-01 (MEDIUM):** Fix `trimTextToBudget` zero-budget edge case — 1-line guard
2. **F2-R2-02 (MEDIUM):** Wire `params.force` in compact() — skip `history.length < 2` guard when forced
3. **F2-R2-04 (MEDIUM):** Guard compact() summarizer path against minimal history — skip when `history.length <= 2`
4. **F2-R2-03 (LOW):** Return `compacted: false` when simple trim keeps all messages
5. **F2-R2-05 (LOW):** Guard empty RAG text in assemble() — check `ragResult?.text` truthiness
6. **T1–T8:** Add regression tests for each gap before/alongside fixes
