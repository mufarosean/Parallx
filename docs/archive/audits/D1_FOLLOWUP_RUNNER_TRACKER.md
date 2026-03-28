# D1 — Followup Runner: Domain Tracker

## Status: CLOSED ✅

## Key Files
| File | Role |
|------|------|
| `src/openclaw/openclawFollowupRunner.ts` | Followup evaluation & runner factory |
| `src/openclaw/openclawAttempt.ts` | Attempt executor (tool loop, continuationRequested) |
| `src/openclaw/openclawTurnRunner.ts` | Turn runner (propagates continuationRequested) |
| `tests/unit/openclawFollowupRunner.test.ts` | 21 tests |

## Upstream References
| Upstream File | Lines | Parallx Mapping |
|---------------|-------|-----------------|
| `src/agents/followup-runner.ts` | ~370 lines | `openclawFollowupRunner.ts` (evaluation subset) |
| `src/agents/attempt.ts` | L89–L142 | `openclawAttempt.ts` tool loop + continuationRequested |

## Scorecard

| Capability | Iteration 0 | Iteration 1 | Final |
|------------|------------|------------|-------|
| D1.1 evaluateFollowup signature | ALIGNED | ALIGNED | ✅ |
| D1.2 createFollowupRunner factory | MISALIGNED | ALIGNED (documented) | ✅ |
| D1.3 Safety gates (depth/cancel/error) | ALIGNED | ALIGNED | ✅ |
| D1.4 FOLLOWUP_DELAY_MS | MISSING | ALIGNED (wired) | ✅ |
| D1.5 MAX_FOLLOWUP_DEPTH | ALIGNED | ALIGNED | ✅ |
| D1.6 Test coverage | ALIGNED | ALIGNED (21 tests) | ✅ |
| D1.7 Positive evaluation path | MISSING | ALIGNED (Gate 5) | ✅ |
| D1.8 No anti-patterns | ALIGNED | ALIGNED | ✅ |

**Final: 8/8 ALIGNED**

---

## Iteration 1

### Audit Findings
- **D1.7 (HIGH)**: `evaluateFollowup()` structurally inert — all 5 gates only returned `shouldFollowup: false`. No positive path existed. Runner could never fire.
- **D1.4 (LOW)**: `FOLLOWUP_DELAY_MS` exported but never consumed by the runner closure.
- **D1.2 (MEDIUM)**: Factory scope mismatch — Parallx evaluation-only vs upstream's ~370-line execution lifecycle.

### Changes Made
1. **Gate 5 positive path**: Added `continuationRequested` flag to `IOpenclawAttemptResult` and `IOpenclawTurnResult`. Gate 5 in `evaluateFollowup()` checks `turnResult.continuationRequested` → returns `{ shouldFollowup: true, reason: 'tool-continuation' }`.
2. **Delay wiring**: `FOLLOWUP_DELAY_MS` now used in runner closure: `await new Promise(resolve => setTimeout(resolve, FOLLOWUP_DELAY_MS))` before sender call.
3. **Factory JSDoc**: Expanded to explain Parallx evaluation-vs-execution scope adaptation.
4. **7 new tests**: 5 positive-path evaluateFollowup tests + 2 runner timing/behavior tests.

### Verification
- **Tests**: 137 files, 2600 tests, 0 failures
- **TypeScript**: 0 errors
- **Cross-domain**: D3 steer tests still pass
- **UX Guardian**: 6/6 surfaces OK, no UX impact

### Decision
All 8 capabilities ALIGNED. No iteration 2 needed. **CLOSED.**
