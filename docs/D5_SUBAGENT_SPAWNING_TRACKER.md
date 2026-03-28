# D5 — Sub-Agent Spawning: Domain Tracker

## Status: CLOSED ✅

## Key Files
| File | Role |
|------|------|
| `src/openclaw/openclawSubagentSpawn.ts` | SubagentRegistry + SubagentSpawner |
| `tests/unit/openclawSubagentSpawn.test.ts` | 34 tests |

## Upstream References
| Upstream File | Lines | Parallx Mapping |
|---------------|-------|-----------------|
| `subagent-spawn.ts` | ~847 lines | SubagentSpawner.spawn() lifecycle |
| `sessions-spawn-tool.ts` | ~212 lines | Tool definition (not yet wired) |

## Scorecard

| Capability | Iteration 0 | Iteration 1 | Final |
|------------|------------|------------|-------|
| D5.1 SubagentSpawner class | ALIGNED | ALIGNED | ✅ |
| D5.2 SubagentRegistry | MISALIGNED | ALIGNED (pruning + @deviation) | ✅ |
| D5.3 ISubagentSpawnParams | MISALIGNED | ALIGNED (@deviation D5.3) | ✅ |
| D5.4 ISubagentRun interface | MISALIGNED | ALIGNED (@deviation D5.4) | ✅ |
| D5.5 Spawn mode ("run" only) | ALIGNED | ALIGNED | ✅ |
| D5.6 Depth limit enforcement | ALIGNED | ALIGNED | ✅ |
| D5.7 Concurrency limit | ALIGNED | ALIGNED | ✅ |
| D5.8 Timeout mechanism | ALIGNED | ALIGNED | ✅ |
| D5.9 Announcement delegate | ALIGNED | ALIGNED | ✅ |
| D5.10 Status lifecycle | ALIGNED | ALIGNED | ✅ |
| D5.11 Cancellation | ALIGNED | ALIGNED | ✅ |
| D5.12 Disposal & cleanup | ALIGNED | ALIGNED | ✅ |
| D5.13 Constants | ALIGNED | ALIGNED (+MAX_REGISTRY_HISTORY) | ✅ |
| D5.14 Test coverage | ALIGNED | ALIGNED (34 tests) | ✅ |
| D5.15 No anti-patterns | ALIGNED | ALIGNED | ✅ |

**Final: 15/15 ALIGNED**

**Deferred**: Descendant tracking, N/A server fields, persistent run storage

---

## Iteration 1

### Audit Findings
- **D5.2 (LOW)**: Registry lacks history pruning (unbounded) and descendant tracking
- **D5.3 (LOW)**: Missing N/A server-specific spawn params
- **D5.4 (LOW)**: Simplified run record vs upstream 25+ fields

### Changes Made
1. **History pruning**: MAX_REGISTRY_HISTORY=100, _pruneCompletedRuns() FIFO prune, active runs preserved
2. **@deviation D5.2b**: JSDoc on SubagentRegistry for descendant tracking
3. **@deviation D5.3**: JSDoc on ISubagentSpawnParams for N/A fields
4. **@deviation D5.4**: JSDoc on ISubagentRun for simplified record
5. **2 new tests**: Pruning behavior + active run preservation

### Verification
- **Tests**: 137 files, 2631 tests, 0 failures
- **TypeScript**: 0 errors
- **Cross-domain**: D1 + D2 + D3 + D4 tests still pass
- **UX Guardian**: 6/6 surfaces OK

### Decision
All 15 capabilities ALIGNED. Low-severity deviations documented. **CLOSED.**
