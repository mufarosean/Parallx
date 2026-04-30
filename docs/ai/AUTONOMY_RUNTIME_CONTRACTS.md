# Autonomy Runtime Contracts

**Status:** Phase γ (M60) — controls layer extended to heartbeat / cron / sub-agent
**Owner:** Parallx runtime
**Scope:** Defines the trigger taxonomy, autonomy event record schema, feature
flag IDs, and kill-switch semantics that govern every autonomous turn in
Parallx. These contracts are the L6 reference artifact for Milestone 60 T1.

> **Boundary note.** Autonomy is **not user-facing** until the T5 rail polish
> lands. This document is a runtime contract, not a user guide. Do not surface
> these terms in `AI_USER_GUIDE.md` or chat UI copy yet.

---

## 1. Trigger taxonomy

Every autonomy event is tagged with a `trigger` describing the cause of the
turn. Triggers are exhaustive — every code path that drives a turn maps to
exactly one trigger kind.

| `trigger.kind` | Source | `trigger.ref` semantics |
|----------------|--------|--------------------------|
| `chat`         | A user-typed chat request (default participant) | `sessionId` |
| `followup`     | Self-continuation queued by `FollowupRunner` (W1/A2) | `sessionId` |
| `cron`         | Scheduled task fired by `CronService` (T3, deferred) | task id |
| `heartbeat`    | Idle-poll fired by `HeartbeatRunner` (T2, deferred) | session id |
| `file-change`  | Watcher-triggered turn (T2, deferred) | absolute path |
| `subagent`     | Spawned sub-agent turn (T4, deferred) | parent event id |
| `replay`       | `autonomy.replay <id>` command (T5.E3, stub in α) | replayed event id |

Phase α emits `chat`, `followup`, and `replay`. Phase γ adds `heartbeat`,
`cron`, and `subagent`. `file-change` remains reserved.

---

## 2. Autonomy event record schema

Every chain — successful or not — emits at least one record. Records are
written as ndjson lines to
`<APP_ROOT>/data/autonomy-events.<yyyy-mm-dd>.ndjson`. Daily rotation,
90-day retention.

```ts
interface IAutonomyEventRecord {
  id: string;                    // ulid (Crockford Base32, 26 chars)
  triggeredAt: string;           // ISO 8601 UTC
  trigger: { kind: AutonomyTriggerKind; ref?: string };
  budgetSnapshot?: {             // controls applied at trigger time
    depth?: number;              // followup chain depth
    tokensRemaining?: number;
    concurrentTurns?: number;
  };
  systemPromptHash?: string;     // sha256 hex of the assembled system prompt
  toolCalls?: Array<{
    name: string;
    argsDigest: string;          // sha256 of canonicalized args (key-sorted JSON)
    durationMs: number;
    idempotencyKey?: string;
    error?: string;
  }>;
  surfaceRoutes?: Array<{
    surface: string;             // surface plugin id (chat | notifications | status | canvas | filesystem)
    target?: string;
    ok: boolean;
    reason?: 'gated' | 'unavailable' | 'unsupported-content' | 'delivery-error' | 'cancelled' | string;
  }>;
  outcome: 'completed' | 'cancelled' | 'budget' | 'error' | 'gated';
  durationMs?: number;
  tokensIn?: number;
  tokensOut?: number;
  note?: string;                 // free-text reason (e.g. evaluation.reason)
}
```

### Outcome semantics

| `outcome`    | Meaning |
|--------------|---------|
| `completed`  | Chain finished cleanly (or evaluator decided no-followup) |
| `cancelled`  | Kill-switch fired; chain terminated within <2s of cancellation |
| `budget`     | Reached depth cap, token cap, or concurrency cap |
| `error`      | Evaluator/runner threw; payload's `note` carries the message |
| `gated`      | Feature flag denied the chain or surface route |

### Determinism notes

- `id` is a **ulid**, not a uuid — sortable by time, monotonic per ms.
- `argsDigest` is the sha256 of `JSON.stringify(args, sortedKeys)` so identical
  args produce identical digests regardless of property order.
- `systemPromptHash` is the sha256 of the **post-assembly** prompt string —
  before any model-specific transformations.

### Append protocol

Renderer-side append is **read-modify-write** through
`parallxElectron.fs.{readFile,writeFile,exists,mkdir}`. There is no append IPC.
Writes are serialized through a single in-memory `_writeChain` Promise to
prevent interleaved writes within a renderer process. Multi-process writers
are not supported (Parallx is single-renderer).

---

## 3. Feature flag IDs (M60 §3.8)

All flags are read through `IAutonomyFeatureFlagsService.isEnabled(id)`.
Defaults are applied if persistence has not yet hydrated.

| Flag ID | Default | Effect when off |
|---------|---------|-----------------|
| `autonomy.followup.enabled`           | `true`  | Followup runner short-circuits before `FOLLOWUP_DELAY_MS`; participant emits a `gated` event with `note='autonomy.followup.enabled=false'` |
| `autonomy.surface.chat.enabled`       | `true`  | Surface router refuses delivery to the chat plugin and emits a `gated` event |
| `autonomy.surface.notification.enabled` | `true` | Same — notifications plugin |
| `autonomy.surface.statusbar.enabled`  | `true`  | Same — status-bar plugin |
| `autonomy.surface.canvas.enabled`     | `false` | Same — canvas plugin (off by default) |
| `autonomy.surface.filesystem.enabled` | `false` | Same — filesystem plugin (off by default) |
| `autonomy.heartbeat.enabled`          | `false` | `HeartbeatRunner._tick` drops pending events and emits `gated`; no agent invocation |
| `autonomy.cron.enabled`               | `false` | `CronService._executeJob` short-circuits with `gated`, advances `nextRunAt`, no agent invocation |
| `autonomy.subagent.enabled`           | `false` | `SubagentSpawner.spawn` returns `null` immediately and emits `gated`; child agent never instantiated |

Flag changes fire `IAutonomyFeatureFlagsService.onDidChange` synchronously;
listeners are responsible for re-checking state on subsequent operations.
Setting an unknown flag id throws.

The mapping `surface plugin id → flag id` is exposed as
`SURFACE_FLAG_BY_ID` in `src/services/autonomyFeatureFlags.ts`.

---

## 4. Kill-switch semantics (M60 §3.7)

Every autonomy chain participates in cooperative cancellation through the
participant's `ICancellationToken`.

### Required behavior

1. **<2s termination.** From the moment `token.isCancellationRequested` flips
   to `true`, the chain must produce a terminal autonomy event (outcome
   `cancelled`) and stop scheduling new work within 2 seconds.
2. **Polling cadence.** Long waits (e.g. `FOLLOWUP_DELAY_MS`) are polled at
   50ms; immediate cancellation is observed at the next poll tick.

---

## 5. Heartbeat contract (Phase γ — D2)

**Module:** `src/openclaw/openclawHeartbeatRunner.ts`
**Wired site:** `src/built-in/chat/main.ts` (`readHeartbeatConfig` injection point)

### Constants

| Constant | Value | Source |
|----------|-------|--------|
| `MIN_HEARTBEAT_INTERVAL_MS` | `15_000` (15s) | M60 §3.6 floor (was 30s pre-γ) |
| Coalesce window             | `200ms` (configurable per session) | runtime default |

### Tick payload (`IHeartbeatTickAutonomyInfo`)

Emitted via the injected `onAutonomyEvent(info)` callback at the end of every
`_tick`:

```ts
interface IHeartbeatTickAutonomyInfo {
  readonly sessionId: string;
  readonly outcome: 'completed' | 'gated' | 'error';
  readonly durationMs: number;
  readonly note?: string;        // present when gated/error
  readonly eventsProcessed: number;
}
```

The chat extension forwards each tick to `AutonomyEventLog.emit(...)` with
`trigger: { kind: 'heartbeat', ref: sessionId }` and the matching outcome.

### Flag gate

`isFlagEnabled(): boolean` is checked at the start of every tick. When `false`:
- pending events queued via `pushEvent()` are **dropped** (not retried);
- one autonomy event is emitted with `outcome='gated'`, `note='autonomy.heartbeat.enabled=false'`;
- no agent turn is invoked.

### Shutdown

`suspendForShutdown()` is **idempotent**. After it fires:
- the active timer is cleared;
- `pushEvent(...)` and `wake(...)` early-return without queueing;
- new ticks cannot be scheduled until a new `HeartbeatRunner` is constructed.

The chat extension wires this in an `_autonomyShutdownDisposable` registered
**before** the runners themselves so it disposes first.

---

## 6. Cron contract (Phase γ — D4)

**Module:** `src/openclaw/openclawCronService.ts`
**Wired site:** `src/built-in/chat/main.ts` (cron service construction near sub-agent wiring)

### Constants

| Constant | Value | Source |
|----------|-------|--------|
| Job count cap                 | `50` enforced in `addJob` | M60 §3.6 |
| Tick cadence                  | `60_000` ms (1 min) | runtime default |
| Idempotency cache size (auto) | `1000` keys, trimmed to `500` on overflow | this file |
| Persistence path              | `<APP_ROOT>/data/cron.json` | runtime default |

### Fire payload (`ICronFireAutonomyInfo`)

```ts
interface ICronFireAutonomyInfo {
  readonly jobId: string;
  readonly jobName: string;
  readonly scheduledAt: number;       // ms epoch — the slot this fire belongs to
  readonly idempotencyKey: string;    // `${jobId}@${scheduledAt}`
  readonly outcome: 'completed' | 'gated' | 'error' | 'budget';
  readonly durationMs: number;
  readonly note?: string;
  readonly trigger: 'auto' | 'manual'; // 'auto' = timer/missed-job pass; 'manual' = runJob()
}
```

The chat extension emits with `trigger: { kind: 'cron', ref: jobId }` and adds
`toolCalls: [{ name: 'cron.fire', argsDigest: idempotencyKey, idempotencyKey }]`
so the autonomy event log carries the dedup key for downstream replay.

### Idempotency

- Auto-paths (`_checkDueJobs`, `_runMissedJobs`) call
  `_executeJob(job, { trackIdempotency: true })`. The key
  `${jobId}@${scheduledAt}` is recorded in `_recentIdempotencyKeys`. A second
  hit within cache lifetime is a **drop, no event** (idempotent no-op).
- Manual `runJob(jobId)` calls `_executeJob(job, { trackIdempotency: false })`
  to allow operator-initiated re-runs (e.g. debugging) to bypass dedup.
- The cache is bounded: at 1000 entries it is trimmed to the most recent 500.

### Missed-job coalescing

`_runMissedJobs` collects all jobs whose `nextRunAt < now` and coalesces
multiple missed firings of the **same job** into a single execution per
`scheduledAt` slot via a `Set<string>` keyed by `jobId`. After a sleep/wake
or daemon restart, each job fires at most once on catch-up (not N times).

### Persistence

When the chat extension has access to `parallxElectron.fs` and `appPath`, it
calls `cronService.setPersistence({ load, save })` routing to
`<APP_ROOT>/data/cron.json`. CRUD methods (`addJob`, `updateJob`, `removeJob`,
`enableJob`, `disableJob`) `void this._save()` after every mutation.
`loadFromPersistence()` rewrites any past `nextRunAt` to `now` so a single
coalesced catch-up runs after reload, instead of N back-dated firings.

### Shutdown

`suspendForShutdown()` clears the tick timer and sets a shutdown sentinel.
After it fires, both `runJob(...)` and `_executeJob(...)` short-circuit with
no event emission. Idempotent.

---

## 7. Sub-agent contract (Phase γ — D5)

**Module:** `src/openclaw/openclawSubagentSpawn.ts`
**Wired site:** `src/built-in/chat/main.ts` (sub-agent spawner construction)

### Constants

| Constant | Value | Source |
|----------|-------|--------|
| Max depth                | `1` (hard cap, constructor arg) | M60 §3.6 |
| Concurrency cap per parent | `5` (configurable, default) | M60 §3.6 |

Depth is non-configurable in production: a spawned agent cannot itself spawn.

### Spawn payload (`ISubagentSpawnAutonomyInfo`)

```ts
interface ISubagentSpawnAutonomyInfo {
  readonly parentSessionId: string;
  readonly childSessionId: string | null;       // null when gated/budget
  readonly outcome: 'completed' | 'gated' | 'budget' | 'error';
  readonly durationMs: number;
  readonly note?: string;
  readonly budgetSnapshot: {
    readonly depth: number;            // child depth = parent depth + 1
    readonly activeChildren: number;   // before this spawn
  };
}
```

The chat extension emits with `trigger: { kind: 'subagent', ref: parentSessionId }`
and `budgetSnapshot: { depth }`.

### Outcomes

- `gated` — feature flag off: emit, no child agent constructed, return `null`.
- `budget` — depth or concurrency cap hit: emit, return `null`.
- `error` — exception during invocation: emit in `catch`, propagate the throw.
- `completed` — emitted in the `finally` block **only** if the registry
  confirms `status === 'completed'`. Cancelled / errored runs do not emit a
  spurious `completed`.

### Shutdown

The subagent spawner has no timer; shutdown handling is implicit through the
parent agent's cancellation token. The chat extension does not register a
suspend hook for it.

---

## 8. Wired sites (Phase γ — quick reference)

| Module | Constructed at | Observers wired at |
|--------|----------------|---------------------|
| `HeartbeatRunner`    | `src/built-in/chat/main.ts` ~ line 1360 | `readHeartbeatConfig()` injection |
| `CronService`        | `src/built-in/chat/main.ts` ~ line 1202 | `setObservers(...)` + `setPersistence(...)` immediately after construction |
| `SubagentSpawner`    | `src/built-in/chat/main.ts` ~ line 1253 | `setObservers(...)` immediately after construction |
| Shutdown disposable  | `src/built-in/chat/main.ts` (early in `activate`) | calls `suspendForShutdown()` on heartbeat + cron |

Line numbers are approximate; rely on grep, not the table, when refactoring.
3. **No dispatch after cancel.** Once the token is cancelled, the runner must
   not call `queueFollowupRequest` or any sender callback.
4. **Depth reset.** Cancellation resets the followup depth counter to 0 so
   the next chain starts fresh.

### Wired sites (Phase α)

- `src/openclaw/openclawFollowupRunner.ts` — `createFollowupRunner` accepts
  `token?: ICancellationToken`; entry check returns `{shouldFollowup:false,
  reason:'cancelled'}`. Internal `waitCancellable(ms, token)` polls.
- `src/openclaw/participants/openclawDefaultParticipant.ts` — emits a
  `cancelled` autonomy event at:
    - the existing aborted early-return (cancellation during the turn body)
    - the followup-block pre-evaluation check
    - the runner's `evaluation.reason === 'cancelled'` branch

### Replay (deferred)

The `autonomy.replay <id>` command (T5.E3) will replay a recorded event with
`{apply: false}` by default — printing the planned reconstruction without
mutation. `--apply` mode is intentionally not implemented in Phase α.

---

## 5. Reference

- Source files:
  - `src/services/autonomyFeatureFlags.ts`
  - `src/services/autonomyEventLog.ts`
  - `src/services/surfaceRouterService.ts`
  - `src/openclaw/openclawFollowupRunner.ts`
  - `src/openclaw/participants/openclawDefaultParticipant.ts`
  - `src/commands/autonomyReplayCommand.ts`
- Spec: [Parallx_Milestone_60.md](../Parallx_Milestone_60.md) §3.7, §3.8, §3.10, §3.11
- Tests: `tests/unit/autonomy*.test.ts` (5 files, 19 tests)


