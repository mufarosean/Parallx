# Heartbeat → App Awareness Redesign

**Status:** Phase 1 in progress · **Owner:** autonomy · **Date:** 2026-06-06

## Why

Parallx's heartbeat was ported from OpenClaw but **inverted upstream's model**. In the
real OpenClaw (`docs/gateway/heartbeat.md`), heartbeat is a **periodic agentic turn**:
every ~30 min the agent gets a real turn with a deliberately broad prompt — *"read
HEARTBEAT.md, consider outstanding tasks (inbox, calendar, reminders, queued work),
surface anything urgent"* — looks at the whole state of the user's world, and either
replies `HEARTBEAT_OK` or notifies. Extensions feed it extra signals via per-extension
`system-events` monitors. **The heartbeat IS the app's awareness loop.**

Our port turned that into a **file-change reflex**: it only fires on `.ts/.md` saves
(NOOPing almost all), runs interval ticks as *status-only* (no real turn — a "token-burn
guard"), is fed by exactly 3 sources (file/index/workspace), and is blind to diagnostics,
tasks, extension data, and canvas. The plumbing works; the heart was removed. That is why
it reads as a dead black box — even fully enabled it watches the surface the user touches
least and is told to stay quiet.

**Goal:** restore heartbeat as a periodic, app-aware review — diagnostics and extensions
as its senses, the autonomy log + action cards as its voice — while keeping the user in
control (cadence, kill switch, autonomy levels) and the work observable.

## Current state (verified)

- `HeartbeatRunner` (`src/openclaw/openclawHeartbeatRunner.ts`): timer + generic event
  queue (`pushEvent({type,payload})`). Interval ticks skip when no events queued; events
  drive immediate `system-event` ticks.
- `createHeartbeatTurnExecutor` (`src/openclaw/openclawHeartbeatExecutor.ts`): `system-event`/
  `wake`/`hook` → real isolated ephemeral-session turn; `interval`/`cron` → status-only.
  Response contract already exists: `NOOP` (silent) / `NOTE:` (log only) / ACT (deliver).
- Wiring (`src/built-in/chat/main.ts`): `pushEvent` from file/index/workspace only.
- `DiagnosticsService` (`src/services/diagnosticsService.ts`): pluggable check framework
  (`IDiagnosticCheckProducer` → `IDiagnosticResult{name,status:pass|warn|fail,detail,category}`),
  fires `onDidChange`, already auto-runs every 30s from the diagnostics extension. **Not
  connected to heartbeat.** Available via DI (`IDiagnosticsService`) in chat/main.ts.

## Architecture

One pulse, many senses, one voice:

1. **Pulse** — a periodic *agentic* turn (interval reason now runs a real turn, not a
   status flash), at a sane cadence, with light/isolated context. Event-driven reactions
   (`system-event`/`wake`) stay as a faster path on top.
2. **Senses** — an app-context snapshot assembled each tick: diagnostics (warn/fail),
   pending workspace events, indexer status (Phase 1); tasks/planner, canvas activity, a
   user checklist, and third-party extension signals (later phases).
3. **Judge + voice** — the existing NOOP/NOTE/ACT contract; ACT/NOTE surface through the
   autonomy log + the actionable cards already shipped.

## Phases

**Phase 1 — the heart beats (this change).**
- New `openclawHeartbeatContext.ts`: `gatherAppContext(deps)` + pure `formatAppContext()`
  → a compact snapshot string (diagnostics warn/fail, pending-event summary, indexer state).
- Executor: `interval` runs a real review turn seeded with the snapshot + a broad review
  prompt; inject the snapshot into event-driven turns too.
- Runner: interval ticks run a real turn when enabled (drop the "no events → skip" for
  interval); keep coalescing, dedup, and chat back-pressure deferral.
- Wiring: pass `IDiagnosticsService` + pending-event summary into the executor.
- Cadence: default → 30m (was 5m) — sane for real periodic turns; still user-configurable.
- Observability: every periodic review emits a visible autonomy-log line ("reviewed —
  all clear" on NOOP) so the heartbeat is never silent-invisible again.
- Tests + this doc.

**Phase 2 — more senses.** Diagnostics push-on-fail (timely reaction, not just periodic);
planner/tasks due-items sense; canvas recent-activity sense; a `HEARTBEAT.md`-equivalent
user checklist (a designated canvas page or workspace file).

**Phase 3 — extension signal channel. [DONE]** Any extension/background process publishes
noteworthy events into the heartbeat queue by calling the `parallx.autonomy.signal`
command with `{ source, kind, title, detail?, severity? }` — restoring OpenClaw's
per-extension `system-events`. Payloads are normalized (`openclawAutonomySignal.ts`,
pure + tested); malformed ones are dropped; the runner's input-dedup + kill switch
still apply. (Shipped as a command rather than an `api.autonomy.signal(...)` surface to
keep the change additive and low-risk; a typed `api.autonomy` wrapper over the command
is a safe future sugar once verified live.)

**Phase 4 — run without an open chat.** Today real turns need an active parent chat
session. Give the periodic review a standalone session so it runs even when the user is on
canvas/dashboard. UX: a persistent "heartbeat" thread in the autonomy log.

**Phase 5 — UX polish.** Status-bar pulse, "last reviewed N ago / next in N", a heartbeat
activity timeline, and per-sense settings.

## UX principles (hold equal to code)

- **Never silent-invisible.** If it ran, the autonomy log shows it (even "all clear").
- **Quiet by default, loud when it matters.** NOOP the routine; only interrupt for real
  signals. Trust erodes faster from noise than from a missed minor event.
- **In the user's control.** Cadence, kill switch, autonomy level, and per-sense toggles
  are all user-facing; nothing fires that the user can't see or stop.
- **About the user's work, not just files.** Senses point at diagnostics, tasks, canvas —
  the things this product is actually for.

## Verification

- Unit: `gatherAppContext`/`formatAppContext` snapshot shape; runner interval-runs-real-turn;
  executor injects context. `npx vitest run` for heartbeat/autonomy suites.
- Build: `npm run build` (tsc + esbuild) so the bundle is live.
- Manual: enable heartbeat, force a diagnostic to fail (stop Ollama) → next review surfaces
  it in the autonomy log; with all green → review logs "all clear". Confirm cadence + kill
  switch + Wake now.
