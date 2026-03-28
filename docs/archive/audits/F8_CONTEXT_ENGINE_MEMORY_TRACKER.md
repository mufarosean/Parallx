# F8 — Context Engine / Memory — Parity Tracker

**Domain:** Context Engine + Memory lifecycle  
**Status:** CLOSED ✅  
**Execution order position:** 2 of 10 (F7→**F8**→F3→F1→F2→F5→F6→F9→F10→F4)  
**Cross-domain deferrals from F7:** F8 — memory lifecycle  
**Cross-domain deferrals to later domains:** None  

---

## Final Scorecard

| Metric | Value |
|--------|-------|
| Capabilities audited | 16 |
| ALIGNED | 16 |
| MISALIGNED | 0 |
| MISSING | 0 |
| Iterations completed | 3 |
| Tests added | 24 |
| Total OpenClaw tests | 53 (7 files) |

---

## Iteration Summary

| Iter | Gaps Found | Gaps Fixed | Tests Added | Verification |
|------|-----------|------------|-------------|-------------|
| 1 (Structural) | 3 (F8-3 HIGH, F8-5 HIGH, F8-15 HIGH) | 3 | 23 | tsc 0 errors, 52/52 pass, UX 7/7 |
| 2 (Refinement) | 1 (F8-16 HIGH) | 1 | 1 | tsc 0 errors, 53/53 pass, UX 4/4 |
| 3 (Confirmation) | 0 | — | — | 16/16 ALIGNED, DOMAIN COMPLETE |

---

## Key Files

| File | Role |
|------|------|
| `src/openclaw/openclawContextEngine.ts` | Context engine impl (bootstrap, assemble, compact, afterTurn) |
| `src/openclaw/openclawTokenBudget.ts` | Token budget computation + estimation |
| `src/openclaw/openclawResponseValidation.ts` | Evidence assessment + re-retrieval |
| `src/openclaw/openclawTurnRunner.ts` | Turn runner (calls engine.assemble/compact) |
| `src/openclaw/openclawAttempt.ts` | Single attempt (calls engine lifecycle) |

---

## Iteration 1 — Structural Audit

**Date:** 2026-03-27  
**Report:** `docs/F8_CONTEXT_ENGINE_MEMORY_AUDIT.md`

### Key Findings

**ALIGNED (11):** F8-1 (interface shape), F8-2 (bootstrap readiness), F8-4 (parallel retrieval), F8-6 (summarization compact), F8-7 (trim fallback), F8-8 (memory flush), F8-9 (afterTurn hook), F8-10 (turn runner lifecycle), F8-11 (10/30/30/30 budget computation), F8-12 (evidence + re-retrieval), F8-13 (history trimming), F8-14 (engine services type)

**MISALIGNED (2):**
- **F8-3:** assemble() RAG content flows into systemPromptAddition → system prompt → truncated to 10% by attempt. 30% RAG budget not honored end-to-end. **HIGH severity.**
- **F8-5:** Sub-lane limits sum to 175% of RAG budget (no aggregate cap). Combined with F8-3 truncation, per-lane enforcement is ineffective. **HIGH severity.**

**MISSING (1):**
- **F8-15:** Zero unit tests for context engine, token budget, compact, or parallel retrieval. **HIGH severity.**

### Priority Fixes for Iteration 2
1. Fix budget lane collision (F8-3 + F8-5) — separate RAG content from system prompt
2. Add unit tests (F8-15)

---

## Iteration 2 — Refinement

**Audit focus:** Fresh audit after Iteration 1 fixes, all 16 capabilities re-evaluated.

### New Findings
- **F8-16 (HIGH):** Compact → retry cycle broken. `assemble()` unconditionally overwrote `_lastHistory` with `params.history` on every call, discarding compaction. The turn runner always passes the same `context.history` (readonly), so overflow/timeout retry loops executed identical attempts until exhaustion.

### Fix Applied
- **`openclawContextEngine.ts`:** Added `effectiveHistory` guard at top of `assemble()` — if `_lastHistory` is non-empty and shorter than incoming `params.history`, it was compacted and should be preserved. History trimming now uses `effectiveHistory` instead of raw `params.history`.
- **`openclawContextEngine.test.ts`:** Added F8-16 regression test verifying compact → re-assemble preserves shortened history.

### Verification
- tsc: 0 errors
- Tests: 53/53 pass (7 files)
- UX: CLEAR (4/4 surfaces — chat input, evidence panel, page content, memory)

---

## Iteration 3 — Confirmation

**Audit verdict:** DOMAIN COMPLETE ✅

- 16/16 capabilities ALIGNED
- 0 MISALIGNED, 0 MISSING
- All 4 previous fixes verified independently (F8-3, F8-5, F8-15, F8-16)
- 24 context engine unit tests passing
- 1 cosmetic observation (F8-17: consecutive user-role messages) — deferred, Ollama handles via concatenation
- No cross-domain deferrals

---

## Files Modified

| File | Changes |
|------|---------|
| `src/openclaw/openclawContextEngine.ts` | Major rewrite: RAG → messages array, sub-lane normalization, effectiveHistory guard |
| `src/openclaw/openclawAttempt.ts` | Removed hard 10% truncation → warning-only |
| `tests/unit/openclawDefaultParticipant.test.ts` | Updated C2 assertion for message-based RAG delivery |
| `tests/unit/openclawContextEngine.test.ts` | NEW: 24 tests covering full engine lifecycle |
