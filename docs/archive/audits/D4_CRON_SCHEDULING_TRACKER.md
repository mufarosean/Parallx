# D4 — Cron & Scheduling: Domain Tracker

## Status: CLOSED ✅

## Key Files
| File | Role |
|------|------|
| `src/openclaw/openclawCronService.ts` | CronService — job CRUD, timer, execution, cron parser |
| `tests/unit/openclawCronService.test.ts` | 77 tests |

## Upstream References
| Upstream File | Lines | Parallx Mapping |
|---------------|-------|-----------------|
| `src/cron/schedule.ts` | computeNextRunAtMs | computeNextCronRun + parseCronField |
| `src/cron/service/jobs.ts` | ~909 lines | CronService CRUD, execution, missed catchup |
| `cron-tool.ts` | ~541 lines | Tool actions (add/update/remove/list/run/runs/wake/status) |

## Scorecard

| Capability | Iteration 0 | Iteration 1 | Final |
|------------|------------|------------|-------|
| D4.1 CronService class | ALIGNED | ALIGNED | ✅ |
| D4.2 ICronJob interface | MISALIGNED | ALIGNED (+description, deleteAfterRun, updatedAt) | ✅ |
| D4.3 Schedule validation | MISALIGNED | ALIGNED (@deviation — optional fields vs discriminated unions) | ✅ |
| D4.4 Job CRUD | ALIGNED | ALIGNED | ✅ |
| D4.5 Timer lifecycle | ALIGNED | ALIGNED | ✅ |
| D4.6 Job execution | ALIGNED | ALIGNED (+deleteAfterRun) | ✅ |
| D4.7 Missed job catchup | ALIGNED | ALIGNED | ✅ |
| D4.8 Wake mode handling | ALIGNED | ALIGNED | ✅ |
| D4.9 Context injection | ALIGNED | ALIGNED | ✅ |
| D4.10 Run history | MISALIGNED | ALIGNED (cap 200, getJobRuns) | ✅ |
| D4.11 Constants | ALIGNED | ALIGNED (+MAX_RUN_HISTORY) | ✅ |
| D4.12 Duration parser | ALIGNED | ALIGNED | ✅ |
| D4.13 Cron expression parser | MISSING (placeholder) | ALIGNED (real parser) | ✅ |
| D4.14 One-shot "at" jobs | ALIGNED | ALIGNED | ✅ |
| D4.15 Test coverage | ALIGNED | ALIGNED (77 tests) | ✅ |
| D4.16 No anti-patterns | ALIGNED | ALIGNED | ✅ |
| D4.status status() method | MISSING | ALIGNED | ✅ |

**Final: 17/17 ALIGNED** (D4.3 schedule format deviation documented)

**Deferred**: Job persistence (SQLite), JSONL run-log, discriminated union schedule types

---

## Iteration 1

### Audit Findings
- **D4.13 (HIGH)**: Cron parser was a placeholder — returned `now + 60s` for ALL expressions
- **D4.2 (MEDIUM)**: Missing optional fields (description, deleteAfterRun, updatedAt)
- **D4.10 (MEDIUM)**: Unbounded run history — memory leak risk
- **D4.3 (MEDIUM)**: Optional fields vs discriminated unions (deferred as low correctness gain)

### Changes Made
1. **Real cron parser**: `parseCronField()` handles *, numbers, ranges, steps, lists. `computeNextCronRun()` iterates forward up to 366 days using UTC
2. **Bounded history**: MAX_RUN_HISTORY=200, _trimRunHistory(), getJobRuns() per-job filter
3. **Optional fields**: description, deleteAfterRun (auto-remove on success), updatedAt
4. **status() method**: Returns jobCount, runningJobs, timerActive, totalRuns
5. **27 new tests**: Cron parsing, history bounds, getJobRuns, status, deleteAfterRun, fields

### Verification
- **Tests**: 137 files, 2629 tests, 0 failures
- **TypeScript**: 0 errors
- **Cross-domain**: D1 + D2 + D3 tests still pass
- **UX Guardian**: 6/6 surfaces OK

### Decision
All 17 capabilities ALIGNED. Deferred items documented. **CLOSED.**
