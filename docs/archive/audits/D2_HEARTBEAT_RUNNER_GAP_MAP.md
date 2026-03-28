# D2 Heartbeat Runner — Gap Map

**Date**: 2026-03-28
**Source audit**: `docs/D2_HEARTBEAT_RUNNER_AUDIT.md`
**Parallx file**: `src/openclaw/openclawHeartbeatRunner.ts` (259 lines)
**Upstream**: `src/infra/heartbeat-runner.ts` (~1200 lines), `heartbeat-wake.ts`, `heartbeat-reason.ts`

---

## Summary

| Capability | Status | Disposition | Priority |
|-----------|--------|-------------|----------|
| D2.4 Timer lifecycle | MISALIGNED → ALIGNED | **RECOMMENDED** | 2 |
| D2.6 Duplicate suppression | MISALIGNED → ALIGNED | **DEFERRED** | 3 |
| D2.11 Constants | MISALIGNED → ALIGNED | **DEFERRED** | 3 |

All 3 gaps are LOW severity. D2.4 is the only one with a concrete correctness benefit (preventing overlapping heartbeats). D2.6 and D2.11 are deliberate desktop adaptations that need documentation only.

---

## Change Plan

### D2.4: Timer lifecycle — `setInterval` → `setTimeout` chaining

- **Status**: MISALIGNED → ALIGNED
- **Disposition**: RECOMMENDED
- **Upstream**: `src/infra/heartbeat-runner.ts`, `scheduleNext()`, lines 993–1010
- **Upstream pattern**: After each heartbeat completes (or is skipped), `scheduleNext()` computes `delay = Math.max(0, nextDue - now)` and calls `setTimeout(() => requestHeartbeatNow({ reason: 'interval' }), delay)`. This ensures:
  1. No overlapping heartbeats — next tick is only scheduled after current tick resolves
  2. No timer drift — delay is computed from wall-clock difference, not fixed cadence
  3. Dynamic interval — if config changes mid-run, the next tick uses the new interval
- **Parallx file**: `src/openclaw/openclawHeartbeatRunner.ts`
- **Parallx lines**: ~148–161 (`start()` method), ~164–169 (`stop()` method), ~121 (`_timer` field declaration)

#### Action

Replace `setInterval`/`clearInterval` with `setTimeout` chaining:

1. **Change `_timer` type** (line ~121):
   ```diff
   - private _timer: ReturnType<typeof setInterval> | null = null;
   + private _timer: ReturnType<typeof setTimeout> | null = null;
   ```

2. **Rewrite `start()` method** (lines ~148–161):
   ```diff
   - this._timer = setInterval(() => {
   -   this._tick('interval');
   - }, interval);
   + this._scheduleNext();
   ```

3. **Add `_scheduleNext()` private method** — the upstream `scheduleNext()` equivalent:
   ```typescript
   /**
    * Schedule the next heartbeat tick using setTimeout chaining.
    * Upstream: scheduleNext() — one-shot timer re-armed after each tick.
    * This prevents overlapping heartbeats and allows dynamic interval changes.
    */
   private _scheduleNext(): void {
     if (this._disposed || !this._state.enabled) return;
     const config = this._getConfig();
     const interval = clampInterval(config.intervalMs);
     const now = Date.now();
     const delay = Math.max(0, this._state.nextDueMs - now);
     this._timer = setTimeout(async () => {
       await this._tick('interval');
       // Re-arm after tick completes — upstream scheduleNext() pattern
       this._state = { ...this._state, intervalMs: interval };
       this._scheduleNext();
     }, delay || interval);
   }
   ```

4. **Update `stop()` method** (lines ~164–169):
   ```diff
   - clearInterval(this._timer);
   + clearTimeout(this._timer);
   ```

5. **Re-arm after wake/event ticks**: In `_tick()`, after a successful execution, the `nextDueMs` state is already updated (line ~222). The `_scheduleNext()` method will use this on the next re-arm. No change needed in `_tick()`.

#### What to remove

- The `setInterval` call in `start()`.
- The `clearInterval` call in `stop()`.

#### Verify

- Existing 20 tests in `tests/unit/openclawHeartbeatRunner.test.ts` must still pass (tests use `vi.useFakeTimers()` — update timer advancement from `vi.advanceTimersByTime` to account for setTimeout re-arming).
- New test: verify that a slow executor (takes > interval) does NOT produce overlapping ticks.
- New test: verify that config interval change between ticks takes effect on next tick.

#### Risk

- **Test breakage**: Tests that use `vi.advanceTimersByTime(interval)` may need adjustment because `setTimeout` chaining means timers fire sequentially rather than on a fixed cadence. Each timer advancement needs to account for the re-arm.
- **Low**: The behavioral change is strictly more correct — overlapping heartbeats were already unlikely with the current async `_tick`, but `setInterval` does not guarantee it.

---

### D2.6: Duplicate suppression — Document as deliberate desktop adaptation

- **Status**: MISALIGNED → ALIGNED (via documentation)
- **Disposition**: DEFERRED
- **Upstream**: `src/infra/heartbeat-runner.ts`, `isDuplicateMain` check, lines 798–833
- **Upstream pattern**: Compares the current heartbeat's output text (`normalized.text.trim()`) against `prevHeartbeatText` stored in the session store. If identical and within 24 hours (`startedAt - prevHeartbeatAt < 24 * 60 * 60 * 1000`), the heartbeat output is suppressed. This is **output-level** dedup — it prevents the model from "nagging" with the same message.
- **Parallx file**: `src/openclaw/openclawHeartbeatRunner.ts`
- **Parallx lines**: ~177–193 (`pushEvent()` dedup block), line 36 (`DUPLICATE_SUPPRESSION_WINDOW_MS`)

#### Current Parallx behavior

Parallx deduplicates at the **input event** level: same `type:payload` key within a 60-second window is dropped before it enters the event queue. This is a different mechanism solving a different problem:

| Aspect | Upstream (output-level) | Parallx (input-level) |
|--------|------------------------|----------------------|
| Target | Model response text | Incoming system event |
| Window | 24 hours | 60 seconds |
| Purpose | Prevent "nagging" repeated alerts | Prevent duplicate event processing |
| Storage | Session store (`prevHeartbeatText`) | In-memory Map (`_recentPayloads`) |

#### Action

No code change. Add JSDoc annotation documenting the deliberate deviation:

1. **Annotate the constant** (line ~36):
   ```typescript
   /**
    * Duplicate suppression window — same event within 60s is ignored.
    *
    * @deviation D2.6 — Upstream uses output-level dedup (24h window on model
    * response text via isDuplicateMain, heartbeat-runner.ts L798-833). Parallx
    * uses input-level dedup (60s window on event type+payload). This is a
    * complementary mechanism: upstream prevents repeated model output, Parallx
    * prevents redundant event processing. Desktop-appropriate because heartbeat
    * turns are internal (not user-visible), so output-level nagging is not a
    * concern. If heartbeat turns become user-visible, add output-level dedup.
    */
   export const DUPLICATE_SUPPRESSION_WINDOW_MS = 60 * 1000;
   ```

2. **Annotate the pushEvent dedup block** (line ~180):
   ```typescript
   // Input-level duplicate suppression — @deviation D2.6
   // Upstream deduplicates at the output level (isDuplicateMain, 24h window).
   // Parallx deduplicates at the input level (same event type+payload, 60s window).
   ```

#### What to remove

Nothing.

#### Verify

- No behavioral change — documentation only.
- Confirm JSDoc renders correctly in IDE hover.

#### Risk

None.

---

### D2.11: Constants — Document default interval as deliberate desktop adaptation

- **Status**: MISALIGNED → ALIGNED (via documentation)
- **Disposition**: DEFERRED
- **Upstream**: `src/auto-reply/heartbeat.ts`, `DEFAULT_HEARTBEAT_EVERY = "30m"`, config schema
- **Parallx file**: `src/openclaw/openclawHeartbeatRunner.ts`
- **Parallx lines**: line 27 (`DEFAULT_HEARTBEAT_INTERVAL_MS`), lines 30–34 (MIN/MAX constants)

#### Divergences

| Constant | Upstream | Parallx | Rationale |
|----------|----------|---------|-----------|
| Default interval | 30 minutes | 5 minutes | Desktop: no API cost, local Ollama, low latency → faster check-ins |
| Min interval | None (config-driven) | 30 seconds | Desktop guardrail: prevent runaway timers from misconfiguration |
| Max interval | None (config-driven) | 1 hour | Desktop guardrail: ensure heartbeats still fire regularly |

#### Action

No code change. Add JSDoc annotations documenting the deliberate deviations:

1. **Annotate DEFAULT_HEARTBEAT_INTERVAL_MS** (line ~27):
   ```typescript
   /**
    * Default heartbeat interval in milliseconds (5 minutes).
    *
    * @deviation D2.11 — Upstream default is 30 minutes (DEFAULT_HEARTBEAT_EVERY
    * in heartbeat.ts) to account for API token cost and rate limits. Parallx
    * uses 5 minutes because: (1) local Ollama has no per-token cost, (2) desktop
    * latency is low, (3) proactive check-ins benefit from faster response to
    * workspace changes. Configurable via AI settings.
    */
   export const DEFAULT_HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;
   ```

2. **Annotate MIN/MAX constants** (lines ~30–34):
   ```typescript
   /**
    * Minimum heartbeat interval — prevents runaway timers.
    *
    * @deviation D2.11 — Upstream has no min/max bounds (relies on config
    * validation via Zod schema). Parallx adds runtime clamping as a desktop
    * guardrail since users can edit settings directly.
    */
   export const MIN_HEARTBEAT_INTERVAL_MS = 30 * 1000;

   /** Maximum heartbeat interval — 1 hour. @deviation D2.11 — see MIN above. */
   export const MAX_HEARTBEAT_INTERVAL_MS = 60 * 60 * 1000;
   ```

#### What to remove

Nothing.

#### Verify

- No behavioral change — documentation only.
- Confirm JSDoc renders correctly in IDE hover.

#### Risk

None.

---

## Dependency Order

1. **D2.4** (timer lifecycle) — standalone, no dependencies on other changes
2. **D2.11** (constants JSDoc) — standalone, no code change
3. **D2.6** (suppression JSDoc) — standalone, no code change

D2.11 and D2.6 are documentation-only and can be applied in any order. D2.4 is the only code change and should be done first since test adjustments may be needed.

---

## Cross-File Impact

| Change | Files affected |
|--------|---------------|
| D2.4 timer refactor | `src/openclaw/openclawHeartbeatRunner.ts`, `tests/unit/openclawHeartbeatRunner.test.ts` |
| D2.6 JSDoc | `src/openclaw/openclawHeartbeatRunner.ts` only |
| D2.11 JSDoc | `src/openclaw/openclawHeartbeatRunner.ts` only |

No type signature changes. No import changes. No cross-module impact.

---

## Items NOT in Scope

The following upstream patterns were evaluated in the audit and classified as ALIGNED desktop adaptations. They do NOT require changes:

- **Active hours check** (upstream L558) — N/A for always-available desktop app
- **Per-agent scheduling** — N/A for single-agent desktop
- **HEARTBEAT.md file gate** — N/A, desktop uses in-app config
- **Lane concurrency** — N/A, single-user single-session
- **Auth profile rotation** — N/A, single local Ollama instance
- **AbortSignal lifecycle** — not needed for desktop dispose pattern
- **Structured telemetry** — console logging is appropriate for desktop
