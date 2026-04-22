# W2 — Heartbeat Wiring Tracker (M58)

**Domain**: D2 HeartbeatRunner wiring
**Milestone**: M58 W2
**Status**: ✅ CLOSED

---

## Scorecard

| # | Capability | Status | Evidence |
|---|------------|--------|----------|
| W2.1 | Config keys + defaults + migration | ✅ ALIGNED | `src/aiSettings/unifiedConfigTypes.ts` — `IUnifiedHeartbeatConfig`, default `{enabled:false, intervalMs:300000, reasons:5}`, `fromLegacyProfile` back-fill |
| W2.2 | HeartbeatTurnExecutor | ✅ ALIGNED | `src/openclaw/openclawHeartbeatExecutor.ts` — thin, status-surface only |
| W2.3 | Runner instantiation + config reactivity | ✅ ALIGNED | `src/built-in/chat/main.ts` heartbeat block; `onDidChangeConfig → stop()+start()` |
| W2.4a | File-change events → pushEvent | ✅ ALIGNED | `fileService.onDidFileChange` handler |
| W2.4b | Indexer events → pushEvent | ✅ ALIGNED | `indexingPipelineService.onDidCompleteInitialIndex` handler |
| W2.4c | Workspace events → pushEvent | ✅ ALIGNED | `workspaceService.onDidChangeFolders` handler |
| W2.5 | `parallx.wakeAgent` command | ✅ ALIGNED | `api.commands.registerCommand('parallx.wakeAgent', ...)` |
| W2.6 | Status surface w/ `ORIGIN_HEARTBEAT` | ✅ ALIGNED | `router.sendWithOrigin(params, ORIGIN_HEARTBEAT)` in executor |
| W2.7 | Dispose on teardown | ✅ ALIGNED | `context.subscriptions.push(heartbeatRunner)` |
| W2.8 | Integration tests | ✅ ALIGNED | `tests/unit/openclawHeartbeatWiring.test.ts` — 7/7 passing |
| W2.9 | AI settings UX | ✅ ALIGNED | `src/aiSettings/ui/sections/heartbeatSection.ts` — toggle + interval slider |
| W2.10 | Default OFF on fresh workspace | ✅ ALIGNED | `DEFAULT_UNIFIED_CONFIG.heartbeat.enabled = false` |

**12/12 ALIGNED.**

---

## Key files

**Production code**
- `src/aiSettings/unifiedConfigTypes.ts` — config shape + defaults
- `src/openclaw/openclawHeartbeatExecutor.ts` — thin executor factory
- `src/openclaw/openclawHeartbeatRunner.ts` — runner (unchanged, D2 closure)
- `src/built-in/chat/main.ts` — wiring site
- `src/aiSettings/ui/sections/heartbeatSection.ts` — UX section
- `src/aiSettings/ui/aiSettingsPanel.ts` — section registration

**Tests**
- `tests/unit/openclawHeartbeatRunner.test.ts` — 22 runner unit tests (unchanged, still green)
- `tests/unit/openclawHeartbeatWiring.test.ts` — 7 wiring integration tests (new)
- `tests/unit/aiSettingsPanel.test.ts` — section-count assertion updated 7→8

---

## Upstream references

- D2 baseline: `heartbeat-runner.ts:1-1200` @ `github.com/openclaw/openclaw@e635cedb`
- Drift: upstream file no longer present on `main` as of 2026-04-22; Parallx tracks D2-baseline semantics (see AUDIT §1.1, GAP_MAP §2.3)
- M58 W6 surface substrate: `ISurfaceRouterService.sendWithOrigin`, `ORIGIN_HEARTBEAT`, `SURFACE_STATUS`

---

## Iteration log

### Iteration 1 — 2026-04-22

- Re-audited D2 runner module: 10/10 ALIGNED (unchanged from D2 closure).
- Substrate reality check: no isolated-turn host in current runtime. Adopted thin-executor scope per M58 plan allowance.
- Upstream drift noted, documented, non-blocking.
- Wired runner into `chat/main.ts` (deviation from plan's `workbench.ts`, rationale in GAP_MAP §2.1).
- Added 7 integration tests; updated panel test for +1 section.
- Type-check: clean.
- Full test suite: **2348/2348 passing** (131 files).

**Outcome**: CLOSED ✅

---

## Decision gate

- [x] All capabilities ALIGNED
- [x] All tests green (2348/2348)
- [x] Type-check clean
- [x] UX surface renders with default-OFF
- [x] Feedback-loop guard verified
- [x] Deferred items documented (W4 cron wake, W5 subagent dispatch, future full-turn executor)

---

## Commit

`M58/W2: HeartbeatRunner wired into runtime — CLOSED (12/12 ALIGNED, 29 tests)`

(29 = 22 existing runner tests + 7 new wiring tests)
