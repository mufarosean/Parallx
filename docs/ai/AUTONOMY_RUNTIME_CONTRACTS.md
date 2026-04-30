# Autonomy Runtime Contracts

**Status:** Phase α (M60) — controls layer landed
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

Phase α emits `chat`, `followup`, and `replay` only. Other kinds are reserved
for downstream domains.

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
