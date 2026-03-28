# D5: Media/Vision — Tracker

**Domain:** D5 — Media/Vision (VLM support via Ollama vision models)
**Status:** CLOSED ✅
**Started:** 2025-01-28
**Closed:** 2026-03-28

---

## Scorecard

| # | Capability | Iter 1 | Iter 2 | Iter 3 | Final |
|---|-----------|--------|--------|--------|-------|
| D5-1 | Vision Model Detection | ✅ | ✅ | ✅ | ✅ |
| D5-2 | Image Attachment Types | ✅ | ✅ | ✅ | ✅ |
| D5-3 | Image Paste/Upload Input | ✅ | ✅ | ✅ | ✅ |
| D5-4 | Vision Capability Gating | ✅ | ✅ | ✅ | ✅ |
| D5-5 | Image-to-Message Pipeline | ✅ | ✅ | ✅ | ✅ |
| D5-6 | System Prompt Vision Awareness | ⏳ | ✅⚠ | ✅ | ✅ |
| D5-7 | Vision Model Auto-Selection | ⏳ | ✅⚠ | ✅ | ✅ |
| D5-8 | Image in History/Compaction | ⏳ | ✅⚠ | ✅ | ✅ |

**Final Score: 8/8 ALIGNED**

---

## Key Files

### Files to Modify
- `src/openclaw/openclawTokenBudget.ts` — G1: image-aware token estimation
- `src/openclaw/openclawContextEngine.ts` — G2: image-aware compaction
- `src/openclaw/openclawSystemPrompt.ts` — G3: vision guidance section
- `src/openclaw/openclawAttempt.ts` — G3: wire supportsVision
- `src/built-in/chat/input/chatContextAttachments.ts` — G4: auto-suggest callback
- `src/built-in/chat/widgets/chatWidget.ts` — G4: wire callback

---

## Iteration Log

### Iteration 1 — Structural (COMPLETE)
- **Scope:** 3 non-ALIGNED capabilities (D5-6, D5-7, D5-8) → 4 gaps (G1–G4)
- **Gaps Found:** 4
- **Gaps Fixed:** 4 (G1–G4)
- **Tests Added:** 1 unit (`chatImageAttachments.test.ts`), 1 e2e (`30-chat-vision-regenerate.spec.ts`)
- **Verification:** Code review — all 9 files changed, 70 insertions

### Iteration 2 — Refinement (COMPLETE — 2026-03-28)
- **Scope:** Review all 9 changed files for correctness, edge cases, architecture
- **Findings:** 9 refinement issues (2 HIGH, 3 MEDIUM, 4 LOW)
- **HIGH:** R-01 (token formula overcounts by ~33%), R-02 (`supportsVision` from attachments not model capabilities)
- **MEDIUM:** R-03 (auto-suggest silent no-op), R-04 (unhandled promise rejection), R-05 (type mismatch)
- **LOW:** R-06 (compaction loses visual context), R-07 (vision guidance not tier-gated), R-08 (empty array cosmetic), R-09 (unthrottled sync calls)
- **Tests Needed:** 14 (T-01 through T-14) — see audit for test plan
- **Verification:** Full audit documented in `D5_MEDIA_VISION_AUDIT.md`

### Iteration 3 — Parity Check (COMPLETE — 2026-03-28)
- **Scope:** Final 8-capability parity verification after all Iter 2 fixes applied
- **Fixes Applied:** R-01 (token formula), R-02 (supportsVision source), R-03 (console.warn), R-04 (.catch), R-05 (type alignment), R-08 (empty array guard)
- **Tests Added:** 13 unit tests in `tests/unit/mediaVision.test.ts` (token estimation, system prompt, compaction)
- **Verification:** 149 files passed, 2879 tests, 0 failures, 0 tsc errors
- **Result:** 8/8 ALIGNED, M41 CLEAN

---

## Closure Summary

- **8/8 capabilities ALIGNED**
- **13 D5-specific unit tests** in `mediaVision.test.ts`
- **12 source files modified** across openclaw runtime, chat UI, and main.ts wiring
- **Key architecture:** `supportsVision` derives from Ollama model capabilities (not attachment sniffing), flows through typed adapter chain, vision guidance in system prompt is conditional
- **Deferred items:** R-06 (visual context preservation in compaction), R-07 (tier-gated vision guidance), R-09 (debounced sync) — acceptable for v1

---
