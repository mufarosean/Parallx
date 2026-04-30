# Autonomy Task Rail (M60 §8 Phase ζ)

The Autonomy Task Rail is the single, opinionated UI for inspecting and
controlling everything Parallx does on its own — heartbeat replies, cron
jobs, sub-agent spawns, follow-up runs, surface-router deliveries, and
replays. It lives in the `view.autonomyLog` panel next to Indexing Log
and AI Diagnostics.

The rail is an **observation surface**, not a runner. It does not
schedule, dispatch, or retry. It composes data from existing services:

| Source | Kind | Purpose |
|---|---|---|
| `AutonomyLogService` | in-memory ring buffer (200 entries) | rich markdown bodies for live deliveries |
| `AutonomyEventLog` | append-only ndjson, 90-day retention | structured records (no bodies) for history & analytics |
| `AutonomyTaskRailService` | read-only viewmodel | merges live + history into one filterable feed |
| `AutonomyPatternMemoryService` | JSON file | "remember this approval" decisions for sub-agent spawns |
| `AutonomyFeatureFlagsService` | flags persisted in IStorage | the kill-switch (`autonomy.paused.global`) and per-trigger gates |

## Trigger kinds

The rail surfaces every value in `AutonomyTriggerKind`:

```
chat | heartbeat | cron | followup | subagent | file-change | replay
```

Plus the synthetic `agent` origin for direct agent deliveries that
appear in the in-memory log.

## Outcomes

```
completed | cancelled | budget | gated | error | deferred
```

`gated` means a feature flag (or the global pause) refused the run.
`budget` means a hard cap (concurrency, depth, token budget) refused it.

## Kill-switch (T5.E2)

Two flags compose:

- `autonomy.paused.global` — when on, **every** trigger is blocked,
  regardless of its per-trigger flag. This is the panic button.
- `autonomy.{heartbeat,cron,subagent,followup}.enabled` — per-trigger
  gates.

The composition is centralized in `isAutonomyTriggerAllowed()`:

```ts
isAutonomyTriggerAllowed(flags, triggerFlag) =
  !flags.isEnabled('autonomy.paused.global') && flags.isEnabled(triggerFlag)
```

All four runner observers (cron, sub-agent, heartbeat, followup) use
this helper. Toggling the rail's "Pause autonomy" checkbox flips
`autonomy.paused.global` and persists via `IStorage` — the pause
survives reload.

## Pattern memory (T5.E3)

When the user explicitly approves a sub-agent spawn and chooses
"remember this pattern", the spawner records a key tuple in
`<APP_ROOT>/data/autonomy-patterns.json`:

```
toolName             = "subagent.spawn"
parentSessionPattern = <session id>
argsShape            = sorted-comma-joined keys of the spawn params
```

**Privacy**: raw argument values are never stored. `computeArgsShape()`
reduces `{task, label, model}` → `"label,model,task"` and that is what
goes to disk. The id is `pat-<base36 FNV-1a hash of the tuple>`.

The flag gate is still authoritative — pattern memory only surfaces a
`pattern-approved` note in the autonomy event so the user can see why
a spawn skipped an explicit approval prompt. Revoking a pattern is
immediate and persists.

## Retention

- In-memory log: 200 entries (ring buffer).
- ndjson event log: 90 days (`AutonomyEventLog` rotates daily files).
- Pattern memory: indefinite, manually revocable. Cleared per-workspace.

## Acceptance criteria (§8.2)

- [x] Every autonomy event from §3.10 appears in the rail with timestamp,
      trigger, outcome.
- [x] Kill-switch survives reload (persisted via flags service).
- [x] Pattern memory is scoped (per-workspace via app-data dir),
      listable, revocable.
