# F6: Response & Output Quality — TRACKER

**Domain:** F6 Response & Output Quality  
**Status:** CLOSED ✅  
**Date opened:** 2026-03-27  
**Date closed:** 2026-03-27

---

## Scorecard

| Capability | Status |
|---|---|
| Model produces correct output | **ALIGNED** ✅ |
| Deterministic workflow answers | **ALIGNED** ✅ |
| Evidence sufficiency scoring | **ALIGNED** ✅ |
| Citation attribution | **ALIGNED** ✅ |

**Result:** 4/4 ALIGNED

---

## Key Files

| File | Role |
|---|---|
| `src/openclaw/openclawResponseValidation.ts` | Citation validation + evidence assessment (170 lines) |
| `src/openclaw/participants/openclawDefaultParticipant.ts` | Consumer of `validateCitations()` |
| `src/openclaw/openclawContextEngine.ts` | Consumer of `assessEvidence()` and `buildEvidenceConstraint()` |

---

## Upstream References

| Function | Upstream Pattern |
|---|---|
| `validateCitations()` | Structural citation remapping — OpenClaw uses model output as-is, only structural post-processing |
| `assessEvidence()` | Parallx adaptation of retrieval quality assessment for weak local models |
| `buildEvidenceConstraint()` | Input shaping — prompt constraint injection, not output repair |

---

## Iteration Log

### Iteration 1 — Structural Audit + Code Execution (2026-03-27)

**Auditor:** AI Parity Auditor  
**Scope:** Full F6 domain (4 capabilities)

**Findings:**
- 1 ALIGNED (citation attribution)
- 3 HEURISTIC (output repair, insurance-domain scoring, insurance-domain constraint)

**Actions:**
- Removed `buildExtractiveFallback` (output repair anti-pattern)
- Removed `extractCoverageFocusTerms`, `scoreLine`, `roleBonus`, `STOP_WORDS_EXTENDED` (insurance-domain helpers)
- Simplified `assessEvidence()` — domain-agnostic quality signal
- Simplified `buildEvidenceConstraint()` — generic prompt constraints
- Removed consumer block in `openclawDefaultParticipant.ts`
- Updated 2 test assertions in `chatService.test.ts`
- File reduced from ~340 to ~170 lines

**Verification:** 0 TS errors, 130 files, 2436 tests, 0 failures

### Iteration 2 — Refinement Audit (2026-03-27) [SUPERSEDED]

**Auditor:** Parity Orchestrator (rubber-stamped — superseded by 2b)

### Iteration 2b — Deep Refinement Audit (2026-06-25)

**Auditor:** AI Parity Auditor (substantive re-audit)  
**Scope:** All 4 capabilities, function-level inspection

**Findings:**

| ID | Finding | Classification | Severity |
|----|---------|---------------|----------|
| F6-R2-01 | `validateCitations()` called after streaming — remapped markdown discarded | MISALIGNED | MEDIUM |
| F6-R2-02 | Zero test coverage for all 3 exported functions | MISALIGNED | HIGH |
| F6-R2-03 | `isHard` detection in assessEvidence | ACCEPTED | LOW |
| F6-R2-04 | Old helper in built-in layer (out of scope) | ACCEPTED | LOW |
| F6-R2-05 | Magic number thresholds (domain-agnostic) | ACCEPTED | LOW |
| F6-R2-06 | STOP_WORDS domain-agnostic | ALIGNED | — |
| F6-R2-07 | All consumers use input shaping only | ALIGNED | — |

**Fixes:**
- F6-R2-01: Moved `validateCitations()` into `openclawAttempt.ts` before streaming; participant uses `validatedCitations` from result
- F6-R2-02: Created `openclawResponseValidation.test.ts` with 24 tests covering all 3 functions + domain-agnosticism checks

**Verification:** 132 files, 2502 tests, 0 failures, 0 TS errors

### Iteration 3 — Confirmation Audit (2026-03-27) [SUPERSEDED]

**Auditor:** Parity Orchestrator (rubber-stamped — superseded by 3b)

### Iteration 3b — Confirmation Audit (2026-06-25)

**Auditor:** AI Parity Auditor (independent verification)  
**Verdict:** **PASS**

| ID | Fix | Classification |
|----|-----|---------------|
| F6-R2-01 | Citation validation before streaming, validated markdown displayed | VERIFIED |
| F6-R2-02 | 24 tests covering all exported functions + domain-agnosticism | VERIFIED |

**Additional checks:**
- Zero output repair patterns remain in src/openclaw/
- Only structural remapping (citation indices) — model prose untouched
- assessEvidence results used exclusively as pre-model input shaping  
- Full suite: 132 files, 2502 tests, 0 failures

---

## Documentation Checklist

- [x] `docs/F6_RESPONSE_QUALITY_AUDIT.md`
- [x] `docs/F6_RESPONSE_QUALITY_GAP_MAP.md`
- [x] `docs/F6_RESPONSE_QUALITY_TRACKER.md`
