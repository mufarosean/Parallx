# W4 — Cron Wiring Tracker (M58)

**Domain**: D4 CronService (wiring)
**Milestone**: M58 Worker 4
**Branch**: `milestone-58`
**Status**: ✅ **CLOSED**

---

## Scorecard

| ID | Capability | Status |
|----|-----------|--------|
| W4.1 | Thin `CronTurnExecutor` emitting `ORIGIN_CRON` deliveries | ✅ ALIGNED |
| W4.2 | `ContextLineFetcher` over active chat session messages | ✅ ALIGNED |
| W4.3 | `HeartbeatWaker` adapter → `heartbeatRunner.wake('cron')` | ✅ ALIGNED |
| W4.4 | Runtime instantiation + lifecycle (start/dispose/catchup) | ✅ ALIGNED |
| W4.5 | 8 tool definitions matching upstream action set | ✅ ALIGNED |
| W4.6 | Tool registration via `registerBuiltInTools` | ✅ ALIGNED |
| W4.7 | Approval gating in `openclawToolPolicy` | ✅ ALIGNED |
| W4.8 | Persistence | ⏸ DEFERRED (M59 W5) |
| W4.9 | Wiring test coverage | ✅ ALIGNED (13 tests) |
| W4.10 | AI-settings "Scheduled jobs" subsection | ✅ ALIGNED |

**Closure: 9/9 ALIGNED · 1 DEFERRED (documented)**

Upstream scheduler alignment (D4): 17/17 ALIGNED — unchanged by W4.

---

## Key files

| File | Role |
|------|------|
| `src/openclaw/openclawCronService.ts` | D4 scheduler (unchanged, 77 existing tests) |
| `src/openclaw/openclawCronExecutor.ts` | **NEW** — W4 thin executor + fetcher + waker factories |
| `src/openclaw/openclawToolPolicy.ts` | **MODIFIED** — approval set + `cronToolPermissionLevel()` |
| `src/built-in/chat/tools/cronTools.ts` | **NEW** — 8 `cron_*` tools |
| `src/built-in/chat/tools/builtInTools.ts` | **MODIFIED** — `cronHost` param + registration |
| `src/built-in/chat/main.ts` | **MODIFIED** — instantiation, lifecycle, heartbeat bridge |
| `src/aiSettings/ui/sections/cronSection.ts` | **NEW** — informational subsection |
| `src/aiSettings/ui/aiSettingsPanel.ts` | **MODIFIED** — insert CronSection |
| `tests/unit/openclawCronWiring.test.ts` | **NEW** — 13 wiring tests |

---

## Upstream references

- `cron-tool.ts:1-541` — 8-action tool surface (pre-drift baseline @ `e635cedb`)
- `cron/service.ts` — scheduler contract (ContextLineFetcher, wake modes, missed-job catchup)
- `heartbeat-runner.ts::wake(reason)` — reuse for `"next-heartbeat"` wake mode
- `ISurfaceRouterService.sendWithOrigin` (Parallx M58 W6) — `ORIGIN_CRON` tagging

---

## Iteration log

### Iteration 1 — Audit + design

- Re-confirmed D4 17/17 ALIGNED; flagged upstream drift in `cron-tool.ts` restructure (non-blocking, documented)
- Selected `chat/main.ts` instantiation site per W2 precedent (plan deviation logged in GAP_MAP §2)
- Chose thin-executor ship-thin path per Parallx_Milestone_58.md §6.5
- Designed 3-delivery fire pattern (status flash + notification toast + status idle)
- Designed approval posture: mutate requires-approval · observe/trigger always-allowed

### Iteration 2 — Implementation

- Added `createCronTurnExecutor`, `createCronContextLineFetcher`, `createCronHeartbeatWaker` factories
- Added `APPROVAL_REQUIRED_CRON_ACTIONS` + helpers in `openclawToolPolicy`
- Implemented 8 `cron_*` tools with full parameter schemas and policy-driven `permissionLevel`
- Wired `cronService` + `cronHeartbeatRunnerRef` + `cronHeartbeatWaker` at activate-scope; started scheduler after `registerBuiltInTools`
- Added heartbeat disposable subscription to clear ref on runner teardown
- Added informational cron section to AI settings panel (slot for M59 live job list)

### Iteration 3 — Type & test fixes

- Fixed `pair.response.rawText` → `extractAssistantText(pair.response.parts)` using `ChatContentPartKind.Markdown` filter (real `IChatAssistantResponse` shape)
- Added type-only re-export of `CronService` from `cronTools.ts` to keep documentation/test imports stable
- Updated `builtInTools.test.ts`: 24 → 32 tools, sorted names list includes 8 cron_* entries
- Updated `chatGateCompliance.test.ts`: registered `tools/cronTools.ts` in `FOLDER_RULES` with no allowed imports
- Updated `aiSettingsPanel.test.ts`: 8 → 9 sections, cron ID assertion between heartbeat and tools
- Updated wiring test fixture to use `{parts: [{kind:'markdown', content}]}` matching real response shape

---

## Verification

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | Clean (no output) |
| `npm run test:unit` | **132 files · 2362 tests · all passing** |
| New cron wiring tests | 13/13 pass |
| Existing D4 scheduler tests | 77/77 pass (unchanged) |
| Existing chat gate / built-in tools / panel tests | All pass after assertion updates |
| UX: AI settings panel | Renders "Scheduled jobs" section with intro + approval posture + M59 placeholder |
| Ship-thin spy assertion | `router.sendWithOrigin` called exactly 3x per fire, all with `ORIGIN_CRON` |

---

## Decision gate — CLOSED ✅

- All 9 in-scope wiring capabilities ALIGNED
- W4.8 persistence explicitly deferred to M59 W5 (documented in audit + gap map)
- Full test suite green (2362/2362)
- Type check clean
- No core-runtime file modified outside the approved list
- Ship-thin guarantee proven by test
- Default-safe posture: jobs only exist via approved `cron_add`; no implicit scheduling

**Closure commit**: `M58/W4: CronService wired into runtime (ship thin per §6.5) - CLOSED (9/9 ALIGNED, 13 tests)`
