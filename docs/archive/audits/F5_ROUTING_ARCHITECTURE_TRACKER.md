# F5 Routing Architecture — Tracker

**Domain:** F5 — Routing Architecture  
**Status:** CLOSED ✅ — All findings verified, 0 regressions  
**Started:** 2025-03-27  
**Re-opened:** 2026-03-27  
**Closed:** 2026-06-25  

---

## Scorecard

| ID | Capability | Iter 1 | Iter 2 | Iter 3 | Final |
|----|-----------|--------|--------|--------|-------|
| F5-01 | Route resolution | ALIGNED | ALIGNED | ALIGNED | ✅ ALIGNED |
| F5-02 | Off-topic detection | ALIGNED | ALIGNED | ALIGNED | ✅ ALIGNED |
| F5-03 | Conversational detection | ALIGNED | ALIGNED | ALIGNED | ✅ ALIGNED |
| F5-04 | Product semantics Q&A | ALIGNED | ALIGNED | ALIGNED | ✅ ALIGNED |
| F5-05 | Broad workspace summary | HEURISTIC | ALIGNED | ALIGNED | ✅ ALIGNED |
| F5-06 | Workspace doc listing (adj) | HEURISTIC | ALIGNED | ALIGNED | ✅ ALIGNED |
| F5-07 | Trace seed independence | — | MISALIGNED | ALIGNED | ✅ ALIGNED |
| F5-08 | Dead routing gated | — | MISALIGNED | ALIGNED | ✅ ALIGNED |
| F5-09 | Path traversal security | — | MISALIGNED | ALIGNED | ✅ ALIGNED |
| F5-10 | Preprocessing test coverage | — | MISALIGNED | ALIGNED | ✅ ALIGNED |

---

## Key Files

| File | Role |
|------|------|
| `src/openclaw/openclawTurnPreprocessing.ts` | Turn preprocessing + semantic fallback |
| `src/openclaw/openclawResponseValidation.ts` | Response validation + broad workspace patterns |
| `src/openclaw/openclawWorkspaceDocumentListing.ts` | Document listing regex bypass |
| `src/openclaw/openclawTypes.ts` | Type definitions w/ dead route kinds |
| `src/openclaw/participants/openclawDefaultParticipant.ts` | Default participant consumer |
| `src/openclaw/participants/openclawWorkspaceParticipant.ts` | Workspace participant consumer |
| `src/services/chatService.ts` | Chat service w/ semantic fallback plumbing |

---

## Upstream References

- OpenClaw routing: slash commands + mode only, no regex pre-classification
- `/summarize` and `@workspace /list` are the structural alternatives already present

---

## Iteration 1 — Structural

**Audit:** 4/5 ALIGNED, 1/5 HEURISTIC (F5-05 broad workspace summary)  
**Additional findings:** F5-06 workspace doc listing bypass, dead type debt (TD1, TD2)  
**Gap map:** 5 gaps, 17 files (2 deletions, 15 edits)  
**Code execution:** Complete — 14 files modified, 2 deleted, 1 test removed, 1 test rewritten  
**Verification:** 130 files, 2436 tests, 0 failures, 0 TS errors  
**UX validation:** 8/8 surfaces CLEAN  

---

## Iteration 2 — Deep Refinement (supersedes rubber-stamped R2)

**Audit:** `docs/F5_ROUTING_ARCHITECTURE_AUDIT_R2.md`  
**Findings:** 12 total — 6 ALIGNED, 4 MISALIGNED, 2 ACCEPTED  

| ID | Finding | Classification | Severity |
|----|---------|---------------|----------|
| F5-R2-01 | buildOpenclawTraceSeed consumes old regex turnState | MISALIGNED | MEDIUM |
| F5-R2-02 | chatService._buildTurnState runs dead regex routing | MISALIGNED | MEDIUM |
| F5-R2-03 | No path traversal validation in @file mentions | MISALIGNED (SECURITY) | HIGH |
| F5-R2-04 | No unit tests for openclawTurnPreprocessing.ts | MISALIGNED | HIGH |
| F5-R2-05 | openclawTypes.ts route types clean | ALIGNED | — |
| F5-R2-06 | Default participant routing clean | ALIGNED | — |
| F5-R2-07 | Workspace participant routing clean | ALIGNED | — |
| F5-R2-08 | Canvas participant routing clean | ALIGNED | — |
| F5-R2-09 | Mention/variable processing legitimate | ALIGNED | — |
| F5-R2-10 | Silent error swallowing in preprocessing | ACCEPTED | LOW |
| F5-R2-11 | assessEvidence heuristic for input shaping | ACCEPTED | LOW |
| F5-R2-12 | No heuristic-absence regression tests | MISALIGNED | LOW |

**Conclusion:** FAILS previous rubber-stamp. 4 real gaps found. Domain NOT ready for closure.  
**Blocking on:** F5-R2-03 (security), F5-R2-04 (test coverage)

---

## Iteration 2b — Code Fixes

**Fixes applied:**

| ID | Fix Description | Files Changed |
|----|----------------|---------------|
| F5-R2-01 | `buildOpenclawTraceSeed()` no longer reads `turnState.turnRoute`; always uses `{ kind: 'grounded', reason: defaultReason }` | `openclawParticipantRuntime.ts` |
| F5-R2-02 | `chatService._buildTurnState()` skips `analyzeChatTurnSemantics` + `determineChatTurnRoute` for non-bridge participants | `chatService.ts` |
| F5-R2-03 | Added `isValidWorkspaceRelativePath()` — rejects `..` traversal, absolute paths, empty strings. Applied to `@file:`, `@folder:`, `#file:` resolution | `openclawTurnPreprocessing.ts` |
| F5-R2-04 | Created comprehensive test suite: 33 tests covering `extractMentions`, `stripMentions`, `resolveMentions`, `resolveVariables`, `isValidWorkspaceRelativePath`, security edge cases | `openclawTurnPreprocessing.test.ts` (new) |

**Verification:** 131 files, 2478 tests, 0 failures, 0 TS errors

---

## Iteration 3b — Confirmation Audit

**Auditor:** AI Parity Auditor (independent re-audit)  
**Verdict:** **PASS**

| ID | Fix | Classification |
|----|-----|---------------|
| F5-R2-01 | buildOpenclawTraceSeed no longer reads old routing | VERIFIED |
| F5-R2-02 | _buildTurnState gates old routing for non-bridge | VERIFIED |
| F5-R2-03 | Path traversal validation at all 3 entry points | VERIFIED |
| F5-R2-04 | 33 tests covering all exported functions + security | VERIFIED |

**Additional checks:**
- Zero references to `turnRoute`, `isConversational`, `isFileEnumeration` in openclaw code paths
- Security fix complete — no bypasses, bootstrap/attachment paths are hardcoded constants
- F5-R2-12 (heuristic-absence tests) LOW — structurally impossible due to `needsLegacyRouting` gate
- Full suite: 131 files, 2478 tests, 0 failures
