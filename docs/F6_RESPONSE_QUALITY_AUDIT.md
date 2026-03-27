# F6: Response & Output Quality — AUDIT

**Domain:** F6 Response & Output Quality  
**Date:** 2026-03-27  
**Auditor:** AI Parity Auditor (iter 1), Parity Orchestrator (iter 2 refinement, iter 3 confirmation)  
**Status:** 4/4 ALIGNED ✅

---

## Summary Table

| Capability | Pre-Audit Status | Post-Audit Status | Action |
|---|---|---|---|
| Model produces correct output | ALIGNED | **ALIGNED** ✅ | No change needed. Output repair was already removed in F5/F7. `buildExtractiveFallback` removed in F6 iter 1. |
| Deterministic workflow answers | HEURISTIC | **ALIGNED** ✅ | Already removed in F5 audit. Confirmed no remnants. |
| Evidence sufficiency scoring | HEURISTIC | **ALIGNED** ✅ | Simplified `assessEvidence()` — removed insurance-domain hardcoding (`extractCoverageFocusTerms`, `roleBonus`, `scoreLine`). Now domain-agnostic quality signal. |
| Citation attribution | ALIGNED | **ALIGNED** ✅ | No change needed. `validateCitations()` is structural citation remapping, not content repair. |

---

## Per-Capability Findings

### 1. Model produces correct output — ALIGNED ✅

**Upstream pattern:** OpenClaw uses model output as-is. No post-processing of content.

**Parallx state:** The `buildExtractiveFallback` function was the last remaining output repair mechanism. When the model returned empty, it synthesized a response by extracting and scoring lines from retrieved context. This violates P1 (Framework, not fixes) and the Output Repair anti-pattern.

**Action taken (F6 iter 1):**
- Removed `buildExtractiveFallback` from `openclawResponseValidation.ts`
- Removed consumer block from `openclawDefaultParticipant.ts` (the `if (!result.markdown.trim() && result.retrievedContextText)` branch)
- Updated 2 test assertions in `chatService.test.ts` to verify ABSENCE of extractive fallback content

### 2. Deterministic workflow answers — ALIGNED ✅

**Upstream pattern:** No deterministic bypass. Model handles all responses.

**Parallx state:** Already removed in F5 audit. `buildDeterministicWorkflowAnswer` and `buildOpenclawProductSemanticsAnswer` were deleted in F5.

**Action taken:** None — confirmed clean.

### 3. Evidence sufficiency scoring — ALIGNED ✅

**Upstream pattern:** OpenClaw doesn't have this exact function, but adjusting prompt context based on retrieval quality is a sound pattern. This is a Parallx adaptation.

**Parallx state (pre-audit):** `assessEvidence()` had insurance-domain-specific branches:
- `extractCoverageFocusTerms()` — extracted insurance-specific terms
- `roleBonus` / `scoreLine()` — domain-specific line scoring
- `STOP_WORDS_EXTENDED` — large stop word set for scoring
- Pattern matching: `what should i do|what does .* cover` branches

**Action taken (F6 iter 1):**
- Removed `extractCoverageFocusTerms()`, `scoreLine()`, `roleBonus`, `STOP_WORDS_EXTENDED`
- Simplified `assessEvidence()` to domain-agnostic quality signal using: query term overlap, section count, word count, hardness detection
- Simplified `buildEvidenceConstraint()` — removed insurance language, now generates generic constraints
- File reduced from ~340 to ~170 lines

**Post-cleanup structure:**
- `assessEvidence()` — pre-model quality signal (INPUT shaping, not output repair)
- `buildEvidenceConstraint()` — prompt constraint for weak/insufficient evidence
- Both consumed by `openclawContextEngine.ts` `assemble()` method

### 4. Citation attribution — ALIGNED ✅

**Upstream pattern:** Structural citation handling only. No content rewriting.

**Parallx state:** `validateCitations()` remaps citation indices when model output doesn't match `ragSources` order, then filters to only attributable citations. This is structural post-processing, not content repair.

**Action taken:** None — already aligned.

---

## Iteration History

| Iter | Type | Findings | Actions |
|---|---|---|---|
| 1 | Structural | 3 HEURISTIC capabilities (output repair, insurance-specific scoring) | Removed `buildExtractiveFallback`, simplified `assessEvidence`/`buildEvidenceConstraint`, removed all insurance-domain helpers |
| 2 | Refinement | 0 issues. No orphaned imports, no stale references in `src/openclaw/`. `chatGroundedResponseHelpers.ts` in built-in layer is out of scope. | None |
| 3 | Confirmation | 4/4 ALIGNED. Gap matrix updated. | Updated summary table in gap matrix. |

---

## Files Modified

| File | Change |
|---|---|
| `src/openclaw/openclawResponseValidation.ts` | Removed `buildExtractiveFallback`, `extractCoverageFocusTerms`, `scoreLine`, `roleBonus`, `STOP_WORDS_EXTENDED`. Simplified `assessEvidence` and `buildEvidenceConstraint`. ~340→170 lines. |
| `src/openclaw/participants/openclawDefaultParticipant.ts` | Removed `buildExtractiveFallback` import and consumer block |
| `tests/unit/chatService.test.ts` | Updated 2 assertions to verify absence of extractive fallback |
| `docs/clawrallx/OPENCLAW_GAP_MATRIX.md` | Section 5 updated to 4/4 ALIGNED. Summary table updated. |
