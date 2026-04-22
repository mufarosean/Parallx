# W2 — Heartbeat Wiring Gap Map (M58)

**Domain**: D2 HeartbeatRunner
**Milestone**: M58 W2
**Upstream baseline**: OpenClaw heartbeat-runner pattern family (see AUDIT §1.1 for drift note)

---

## 1. Files changed / created

| File                                                   | Action   | Purpose |
|--------------------------------------------------------|----------|---------|
| `src/aiSettings/unifiedConfigTypes.ts`                 | MODIFIED | Added `IUnifiedHeartbeatConfig`, `HEARTBEAT_REASON_OPTIONS`, `HeartbeatReasonKey`; added `heartbeat` field to `IUnifiedAIConfig`, `DEFAULT_UNIFIED_CONFIG`, `fromLegacyProfile` |
| `src/openclaw/openclawHeartbeatExecutor.ts`            | CREATED  | Thin `HeartbeatTurnExecutor` factory — status-surface delivery only, no LLM call |
| `src/built-in/chat/main.ts`                            | MODIFIED | Instantiates `HeartbeatRunner` + executor after canvas surface registration; wires file / indexer / workspace events to `pushEvent`; registers `parallx.wakeAgent` command; subscribes to `onDidChangeConfig` for live reactivity |
| `src/aiSettings/ui/sections/heartbeatSection.ts`       | CREATED  | AI settings panel section with enable toggle + interval slider (30s–1h) |
| `src/aiSettings/ui/aiSettingsPanel.ts`                 | MODIFIED | Registers `HeartbeatSection` after `AgentSection` |
| `tests/unit/openclawHeartbeatWiring.test.ts`           | CREATED  | 7 integration tests covering interval tick, pushEvent, disabled config, reasons allowlist, wake, origin tagging, no self-feedback |
| `tests/unit/aiSettingsPanel.test.ts`                   | MODIFIED | Section count + id list updated from 7→8 to include `heartbeat` |

---

## 2. Deviation rationale

### 2.1 Host site: `chat/main.ts` vs `workbench.ts`

M58 plan prescribed `workbench.ts` Phase 5 as the instantiation site. All
dependencies the runner needs — `surfaceRouter`, `fileService`,
`indexingPipelineService`, `workspaceService`, `unifiedConfigService`,
and the extension `api.commands` handle — are already scoped inside the
chat participant's activation (`src/built-in/chat/main.ts`). Reaching
these from `workbench.ts` would have required exposing new service
facades for a one-shot wire.

**Decision**: follow the W1 FollowupRunner precedent — wire inside
`chat/main.ts` alongside the other surface-router consumers. Documented
here as a deliberate deviation, not a regression.

### 2.2 Thin executor (no LLM turn)

Upstream heartbeats drive full isolated turns. Parallx does not yet have
an isolated-turn substrate (see AUDIT §3). Rather than invent a parallel
turn engine to force parity, W2 ships a **thin executor** that emits
narrow `SURFACE_STATUS` deliveries tagged with `ORIGIN_HEARTBEAT`. The
M58 plan explicitly permits this reduced-surface subset.

Upgrade path is clean: `createHeartbeatTurnExecutor` is a stable seam. A
future milestone that gains an isolated-turn host swaps the executor
implementation behind the same `HeartbeatTurnExecutor` signature. Runner,
config, UX, and event routing remain unchanged.

### 2.3 Upstream drift (documentation-only)

`heartbeat-runner.ts` is no longer present on upstream `main`. Parallx
tracks the D2-baseline semantics captured in `openclawHeartbeatRunner.ts`
+ its 22-test suite. No behavioral correction required; flagged in the
AUDIT and noted here so future parity sweeps don't treat this as a gap
to close.

---

## 3. Capability → change map

| Capability | File(s) | Evidence |
|------------|---------|----------|
| W2.1 Config keys | `unifiedConfigTypes.ts` | `heartbeat: IUnifiedHeartbeatConfig` on `IUnifiedAIConfig`; default `{enabled:false, intervalMs:300000, reasons:[...5]}` |
| W2.2 Thin executor | `openclawHeartbeatExecutor.ts` | `createHeartbeatTurnExecutor(router, getConfig)` → filters by `reasons` → `sendWithOrigin({surfaceId:SURFACE_STATUS, ...}, ORIGIN_HEARTBEAT)` |
| W2.3 Instantiation + reactivity | `chat/main.ts` | `new HeartbeatRunner(executor, readConfig)`; `onDidChangeConfig → stop()+start()` |
| W2.4a File events | `chat/main.ts` | `fileService.onDidFileChange → pushEvent({type:'file-change'})` |
| W2.4b Indexer events | `chat/main.ts` | `indexingPipelineService.onDidCompleteInitialIndex → pushEvent({type:'index-complete'})` |
| W2.4c Workspace events | `chat/main.ts` | `workspaceService.onDidChangeFolders → pushEvent({type:'workspace-change'})` |
| W2.5 Wake command | `chat/main.ts` | `api.commands.registerCommand('parallx.wakeAgent', () => runner.wake('wake'))` |
| W2.6 Status surface w/ origin | `openclawHeartbeatExecutor.ts` | `router.sendWithOrigin(params, ORIGIN_HEARTBEAT)` |
| W2.7 Dispose | `chat/main.ts` | `context.subscriptions.push(heartbeatRunner)` |
| W2.8 Tests | `openclawHeartbeatWiring.test.ts` | 7/7 passing |
| W2.9 UX | `heartbeatSection.ts`, `aiSettingsPanel.ts` | Toggle + Slider, appears between Agent and Tools |
| W2.10 Default OFF | `unifiedConfigTypes.ts` | `DEFAULT_UNIFIED_CONFIG.heartbeat.enabled = false` |

---

## 4. Non-goals (deferred)

- Full LLM / tool-loop heartbeat turns (awaits isolated-turn substrate).
- Cron-triggered wake (W4 will call `runner.wake('cron')` from the CronService — hook is already in place via the reasons allowlist).
- Sub-agent dispatch from heartbeat (W5 concern).
- Per-reason UX checklist (config field exists, advanced users can edit `ai-config.json`).

---

## 5. Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Event-source change bursts saturate the runner | 60s dedup window absorbs repeats; interval clamp ≥30s prevents tight loops |
| Status-surface churn overwhelms UI | Executor emits 2 deliveries per tick (label + idle blank) — cheap; guarded by `enabled=false` default |
| Config flip mid-tick | `stop()` clears timer, `start()` re-reads config — tested |
| Self-feedback | Event sources never read surface history; `getDeliveriesByOrigin(ORIGIN_HEARTBEAT)` available as filter for any future consumer |
