# D6: Compaction Depth — Gap Map (Change Plan)

**Created:** 2026-03-28  
**Source:** D6_COMPACTION_DEPTH_AUDIT.md  
**Baseline:** 4/8 ALIGNED, 2/8 PARTIAL, 2/8 MISSING

---

## Iteration 1 — Change Plan

| Gap | Status | Change | Target File |
|-----|--------|--------|-------------|
| D6-1 | PARTIAL→ALIGNED | Strengthen summarization prompt with identifier classes | openclawContextEngine.ts |
| D6-2 | MISSING→ALIGNED | Add auditCompactionQuality() function | openclawContextEngine.ts |
| D6-3 | MISSING→ALIGNED | Quality-gated retry loop (MAX_QUALITY_RETRIES=2) | openclawContextEngine.ts |
| D6-4 | PARTIAL→ALIGNED | Wire storeConceptsFromSession call into compact() | openclawContextEngine.ts |
| D6-8 | PARTIAL→ALIGNED | Compaction fields on ITurnMetrics + wire into recordTurn | serviceTypes.ts, participants |

**Implementation Order:**
1. D6-1 (prompt), D6-4 (concepts), D6-8 (ITurnMetrics fields) — parallel
2. D6-2 (quality audit) — depends on D6-1
3. D6-3 (retry) — depends on D6-2
4. D6-8 (wiring) — depends on D6-2/D6-3

**Tests Added:** 15 new tests

---

## Iteration 2 — Refinement Change Plan

| Finding | Severity | Change | Target File |
|---------|----------|--------|-------------|
| R1 | HIGH | /compact: replace generic prompt with COMPACTION_SUMMARIZATION_PROMPT, add quality gate + retry + concept extraction | openclawDefaultRuntimeSupport.ts |
| R2 | HIGH | Wire compactionQualityScore + compactionQualityRetries through IOpenclawTurnResult → ITurnMetrics → recordTurn | openclawTurnRunner.ts, serviceTypes.ts, openclawDefaultParticipant.ts |
| R4 | MEDIUM | Extend extractIdentifiers with email, version, CamelCase, ALL_CAPS patterns | openclawContextEngine.ts |
| R5 | MEDIUM | Implement afterTurn() concept extraction from turn messages | openclawContextEngine.ts |

**Implementation Order:**
1. R4 (extractIdentifiers) — independent
2. R1 (/compact quality) — depends on exported constants
3. R2 (quality field propagation) — depends on IOpenclawCompactResult fields
4. R5 (afterTurn) — independent

**Files Modified:** 5 source files, 0 new test files (existing coverage sufficient)
