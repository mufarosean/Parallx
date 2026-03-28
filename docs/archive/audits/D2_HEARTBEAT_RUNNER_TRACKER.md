# D2 — Heartbeat Runner: Domain Tracker

## Status: CLOSED ✅

## Key Files
| File | Role |
|------|------|
| `src/openclaw/openclawHeartbeatRunner.ts` | HeartbeatRunner class — timer, event queue, dedup |
| `tests/unit/openclawHeartbeatRunner.test.ts` | 22 tests |

## Upstream References
| Upstream File | Lines | Parallx Mapping |
|---------------|-------|-----------------|
| `src/agents/heartbeat-runner.ts` | ~1200 lines | `openclawHeartbeatRunner.ts` (desktop subset) |

## Scorecard

| Capability | Iteration 0 | Iteration 1 | Final |
|------------|------------|------------|-------|
| D2.1 HeartbeatRunner class | ALIGNED | ALIGNED | ✅ |
| D2.2 IHeartbeatState interface | ALIGNED | ALIGNED | ✅ |
| D2.3 Reason flags | ALIGNED | ALIGNED | ✅ |
| D2.4 Timer lifecycle | MISALIGNED | ALIGNED (setTimeout chain) | ✅ |
| D2.5 Event queue (pushEvent) | ALIGNED | ALIGNED | ✅ |
| D2.6 Duplicate suppression | MISALIGNED (LOW) | ALIGNED (@deviation D2.6) | ✅ |
| D2.7 Wake handler | ALIGNED | ALIGNED | ✅ |
| D2.8 Preflight gates | ALIGNED | ALIGNED | ✅ |
| D2.9 Error handling | ALIGNED | ALIGNED | ✅ |
| D2.10 Disposal & cleanup | ALIGNED | ALIGNED | ✅ |
| D2.11 Constants | MISALIGNED (LOW) | ALIGNED (@deviation D2.11) | ✅ |
| D2.12 Test coverage | ALIGNED | ALIGNED (22 tests) | ✅ |
| D2.13 No anti-patterns | ALIGNED | ALIGNED | ✅ |

**Final: 13/13 ALIGNED**

---

## Iteration 1

### Audit Findings
- **D2.4 (LOW)**: setInterval vs upstream setTimeout chaining — prevents overlapping heartbeats
- **D2.6 (LOW)**: Input-level 60s dedup vs upstream output-level 24h dedup
- **D2.11 (LOW)**: 5min default vs upstream 30min — desktop adaptation

### Changes Made
1. **setTimeout chaining**: Replaced `setInterval` with `_scheduleNext()` method using one-shot `setTimeout`, re-armed after tick completes. Updated `stop()` to `clearTimeout`.
2. **@deviation D2.6**: JSDoc annotations on suppression window and pushEvent dedup block
3. **@deviation D2.11**: JSDoc annotations on DEFAULT/MIN/MAX constants
4. **2 new tests**: setTimeout chaining validation + slow executor non-overlap

### Verification
- **Tests**: 137 files, 2602 tests, 0 failures
- **TypeScript**: 0 errors
- **Cross-domain**: D1 + D3 tests still pass
- **UX Guardian**: 6/6 surfaces OK

### Decision
All 13 capabilities ALIGNED. No iteration 2 needed. **CLOSED.**
