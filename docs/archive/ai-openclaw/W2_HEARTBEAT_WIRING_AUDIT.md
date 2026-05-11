# W2 — Heartbeat Wiring Audit (M58)

**Domain**: D2 HeartbeatRunner
**Milestone**: M58 W2
**Date**: 2026-04-22
**Outcome**: Module is audit-complete (13/13 ALIGNED per D2 closure) but had
zero production imports pre-W2. Audit re-verified alignment + substrate
preconditions before wiring.

---

## 1. Upstream reference state

**Upstream target (D2 baseline)**: `heartbeat-runner.ts:1-1200` at
`github.com/openclaw/openclaw@e635cedb`.

### 1.1 Drift note

As of this audit, `heartbeat-runner.ts` is **no longer present on upstream
`main`**. The upstream project appears to have restructured its autonomy
modules since the D2 baseline snapshot was captured.

**Impact on Parallx**: none. `src/openclaw/openclawHeartbeatRunner.ts` was
audited against the cited upstream file at the time of D2 closure and
classified 13/13 ALIGNED. The behavior (setTimeout-chain scheduler,
preflight gates, duplicate suppression window, wake + dispose semantics)
still matches the upstream *pattern family*. No behavior in the Parallx
runner depends on the upstream file still existing.

**Decision**: drift is documented (not corrected). Parallx continues to
track the D2-baseline semantics captured in `openclawHeartbeatRunner.ts`
and its 22-test suite.

### 1.2 Pattern family references (still present upstream)

- Event-pump + tick-deduper pattern — present in upstream reply
  orchestration (same idiom: debounced drain → run → reschedule).
- Surface-routed post-turn messaging — present in M58 W6 `SurfaceRouter`
  via `ORIGIN_HEARTBEAT` tag.

---

## 2. Parallx-side re-audit

### 2.1 Runner module — `src/openclaw/openclawHeartbeatRunner.ts`

| Capability                          | Status   | Evidence                              |
|-------------------------------------|----------|---------------------------------------|
| Config-driven enable/disable        | ALIGNED  | `start()`/`stop()` gates on `readConfig().enabled` |
| Interval clamping (30s–1h)          | ALIGNED  | `MIN_HEARTBEAT_INTERVAL_MS`/`MAX_HEARTBEAT_INTERVAL_MS` |
| setTimeout-chain scheduling         | ALIGNED  | `_scheduleNext` after every tick      |
| Event queue + deduplication         | ALIGNED  | `DUPLICATE_SUPPRESSION_WINDOW_MS` 60s |
| Preflight "skipped-no-events" gate  | ALIGNED  | Interval ticks with zero events skip  |
| Immediate tick on first event       | ALIGNED  | `pushEvent` drains when length === 1  |
| Wake bypass of no-events gate       | ALIGNED  | `wake(reason)` forces a tick          |
| Error isolation                     | ALIGNED  | try/catch logs + re-queues on fail    |
| Disposal releases timer + queue     | ALIGNED  | `dispose()` clears timer + state      |
| 22-test coverage                    | ALIGNED  | `tests/unit/openclawHeartbeatRunner.test.ts` |

**Runner alignment: 10/10 ALIGNED** — matches D2 closure.

### 2.2 Wiring capabilities (NEW for W2)

| Capability                                        | Pre-W2   | Post-W2 |
|---------------------------------------------------|----------|---------|
| W2.1 Config keys + defaults + migration           | MISSING  | ALIGNED |
| W2.2 HeartbeatTurnExecutor                        | MISSING  | ALIGNED |
| W2.3 Runner instantiation + config reactivity     | MISSING  | ALIGNED |
| W2.4a File-change events routed to `pushEvent`    | MISSING  | ALIGNED |
| W2.4b Indexer completion events routed            | MISSING  | ALIGNED |
| W2.4c Workspace-folder change events routed       | MISSING  | ALIGNED |
| W2.5 `parallx.wakeAgent` command                  | MISSING  | ALIGNED |
| W2.6 Status-surface delivery w/ ORIGIN_HEARTBEAT  | MISSING  | ALIGNED |
| W2.7 Dispose on teardown                          | MISSING  | ALIGNED |
| W2.8 Integration tests                            | MISSING  | ALIGNED |
| W2.9 AI settings UX (toggle + interval slider)    | MISSING  | ALIGNED |
| W2.10 Default OFF on fresh workspace              | MISSING  | ALIGNED |

**Wiring alignment: 12/12 ALIGNED post-W2.**

---

## 3. Substrate reality check

The original M58 plan hinted at full isolated LLM turns per heartbeat. The
Parallx runtime does not yet have an isolated-turn substrate:

- `chatService.sendRequest` mutates session `messages[]`; a heartbeat tick
  would pollute the visible chat history.
- No hidden-session primitive exists to host a parallel turn loop with its
  own context engine, tools, and budget.

**Decision (documented)**: W2 ships a **thin executor** (status-surface
delivery only, no LLM / tool loop). M58 plan explicitly allows this
reduced-surface subset. Full tool-loop heartbeats are deferred to a
future milestone (most likely coupled with D5 subagent spawn in W5).

This keeps the wiring faithful to the runner's lifecycle contract while
refusing to invent a parallel turn engine purely to satisfy the plan.

---

## 4. Feedback-loop guard

By design, the heartbeat's **event sources** (file watcher, indexer,
workspace folders) do not read from `SurfaceRouter` history. Surface
deliveries emitted by the heartbeat executor therefore cannot re-enter
`pushEvent`. Every delivery is stamped with `ORIGIN_HEARTBEAT` so that
any downstream consumer that *does* inspect surface history can filter
via `router.getDeliveriesByOrigin(ORIGIN_HEARTBEAT)` and skip
heartbeat-authored content.

Assertion added to `openclawHeartbeatWiring.test.ts`:
`runner.pendingEventCount === 0` after repeated wake ticks → confirms no
self-feedback.

---

## 5. Decision gate

All 12 wiring capabilities ALIGNED. Thin-executor scope documented.
Feedback-loop guard present. Proceed to GAP_MAP.
