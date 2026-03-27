# F5 Routing Architecture — Tracker

**Domain:** F5 — Routing Architecture  
**Status:** CLOSED ✅  
**Started:** 2025-03-27  
**Closed:** 2025-03-27  

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

## Iteration 2 — Refinement

**Audit:** 12 files audited, 11 CLEAN, 1 LOW (claw runtime observation, out of scope)  
**Conclusion:** PASS — zero remaining heuristics in openclaw layer  
**Ready for iteration 3 confirmation**

---

## Iteration 3 — Confirmation

**Audit:** 6/6 ALIGNED confirmed  
**Verification:** grep for all 6 removed symbols returns 0 hits in src/ and tests/  
**Conclusion:** PASS — domain ready for closure
