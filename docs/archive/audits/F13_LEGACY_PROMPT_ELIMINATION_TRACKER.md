# F13: Legacy Prompt Elimination — TRACKER

**Status:** CLOSED ✅  
**Started:** 2026-03-27  
**Closed:** 2026-03-27

---

## Scorecard

| Capability | Iter 1 | Iter 2 | Iter 3 |
|-----------|--------|--------|--------|
| F13-1 Prompt viewer shows real prompt | MISALIGNED | ALIGNED | ALIGNED (spot-check) |
| F13-2 Token bar uses real data | MISALIGNED | ALIGNED | ALIGNED (spot-check) |
| F13-3 Legacy builder deleted | MISALIGNED | ALIGNED | ALIGNED (spot-check) |
| F13-4 Legacy composer deleted | MISALIGNED | ALIGNED | ALIGNED (spot-check) |
| F13-5 Tests cover real builder | MISALIGNED | ALIGNED | ALIGNED (spot-check) |

---

## Key Files

| File | Role |
|------|------|
| `src/services/chatRuntimeTypes.ts` | `IOpenclawSystemPromptReport` interface |
| `src/openclaw/openclawPromptArtifacts.ts` | Prompt artifact builder (caches report) |
| `src/built-in/chat/data/chatDataService.ts` | Session services wiring |
| `src/built-in/chat/widgets/chatTokenStatusBar.ts` | Token estimation display |
| `src/built-in/chat/config/chatSystemPrompts.ts` | **LEGACY — to be deleted** |
| `src/built-in/chat/utilities/chatSystemPromptComposer.ts` | **LEGACY — to be deleted** |
| `tests/unit/chatSystemPrompts.test.ts` | **LEGACY — to be deleted** |
| `tests/unit/chatSystemPromptComposer.test.ts` | **LEGACY — to be deleted** |
| `tests/unit/chatGateCompliance.test.ts` | Gate compliance rules |
| `ARCHITECTURE.md` | Stale reference to remove |

---

## Upstream References

- `agents/system-prompt.ts` `buildAgentSystemPrompt` — single prompt builder
- `agents/pi-embedded-runner/run/attempt.ts:132` `buildEmbeddedSystemPrompt` — builds once, caches
- Parallx equivalent: `openclawSystemPrompt.ts` `buildOpenclawSystemPrompt()` + `openclawPromptArtifacts.ts`

---

## Iteration Summary

| Iter | Gaps Found | Gaps Fixed | Tests Added | Verification |
|------|-----------|-----------|-------------|-------------|
| 1 | 5 | 5 | 0 (−52 legacy removed) | tsc 0 errors, 132 files, 2446 tests, 0 failures |
| 2 | 0 | 0 | — | Re-audit: 5/5 ALIGNED, 0 secondary gaps |
| 3 | 0 | 0 | — | Orchestrator spot-check: imports clean, code paths verified |
