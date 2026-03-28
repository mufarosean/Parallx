# F6: Response & Output Quality — GAP MAP

**Domain:** F6 Response & Output Quality  
**Date:** 2026-03-27  
**Mapper:** AI Parity Auditor (combined audit + gap mapping in iter 1)  
**Status:** All gaps resolved ✅

---

## Change Plan Overview

| Gap ID | Capability | Severity | Files | Status |
|---|---|---|---|---|
| F6-01 | Output repair removal | HIGH | `openclawResponseValidation.ts`, `openclawDefaultParticipant.ts`, `chatService.test.ts` | RESOLVED ✅ |
| F6-02 | Insurance-domain evidence scoring | MEDIUM | `openclawResponseValidation.ts` | RESOLVED ✅ |
| F6-03 | Insurance-domain evidence constraint | MEDIUM | `openclawResponseValidation.ts` | RESOLVED ✅ |

---

## Gap F6-01: Output Repair (`buildExtractiveFallback`)

**Anti-pattern:** Output Repair — synthesizing a response without the model when the model returns empty.

**Upstream reference:** OpenClaw uses model output as-is. When the model returns empty, the runtime signals failure, not fabrication.

**Changes:**
1. **DELETE** `buildExtractiveFallback()` function from `openclawResponseValidation.ts`
2. **DELETE** `scoreLine()`, `roleBonus` helpers (used only by extractive fallback)  
3. **DELETE** `STOP_WORDS_EXTENDED` constant (used only by scoring)
4. **REMOVE** consumer block in `openclawDefaultParticipant.ts`: the `if (!result.markdown.trim() && result.retrievedContextText)` → `buildExtractiveFallback()` call
5. **UPDATE** 2 test assertions in `chatService.test.ts`: change from asserting extractive content present to asserting it absent

## Gap F6-02: Insurance-Domain Evidence Scoring

**Anti-pattern:** Pre-classification / domain-specific hardcoding in `assessEvidence()`.

**Upstream reference:** Quality signals should be domain-agnostic. Upstream adjusts behavior based on retrieval quality without domain-specific term matching.

**Changes:**
1. **DELETE** `extractCoverageFocusTerms()` — insurance-specific term extraction
2. **SIMPLIFY** `assessEvidence()` — remove `what should i do|what does .* cover` branches, keep domain-agnostic signals: query term overlap, section count, word count, hardness detection

## Gap F6-03: Insurance-Domain Evidence Constraint

**Anti-pattern:** Domain-specific language in prompt constraints.

**Changes:**
1. **SIMPLIFY** `buildEvidenceConstraint()` — remove insurance-specific language ("coverage", "deductible", etc.), use generic constraint phrasing

---

## Execution Notes

The AI Parity Auditor combined audit and execution for this domain due to the straightforward nature of the changes (pure deletions and simplifications). All changes were verified:
- 0 TypeScript errors
- 2436 tests passing (130 files)
- 0 orphaned imports or stale references in `src/openclaw/`
