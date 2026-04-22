/**
 * HeartbeatTurnExecutor — M58 W2 wiring factory.
 *
 * Wires the audit-closed {@link `openclawHeartbeatRunner.ts`.HeartbeatRunner}
 * (D2 13/13 ALIGNED) to the workbench SurfaceRouter (M58 W6) so that each
 * heartbeat tick emits a status-surface message stamped with
 * {@link ORIGIN_HEARTBEAT}.
 *
 * Substrate scope (M58 W2, "thin executor" fallback per the milestone plan):
 *
 *   The current Parallx turn-running machinery (`chatService.sendRequest`,
 *   openclaw default participant) is session-bound — it appends user +
 *   assistant pairs to `session.messages` and can't accept a "fresh message
 *   list with no history impact" without either a hidden synthetic session
 *   or a parallel turn engine. Both options exceed the M58 scope and would
 *   violate M41 P6 ("don't invent when upstream has a proven approach").
 *
 *   The W2 mandate explicitly permits a "reduced-surface subset": this
 *   executor does **not** invoke the LLM or tool loop. It routes a minimal
 *   text tick ("thinking… (reason:X, events:N)" → "idle") to the status
 *   surface via the SurfaceRouter, tagged `ORIGIN_HEARTBEAT` so downstream
 *   consumers can filter their own echoes via `getDeliveriesByOrigin`.
 *
 *   Full tool-loop heartbeat turns are a follow-on milestone (requires an
 *   isolated-turn substrate that doesn't exist today).
 */

import { ISurfaceRouterService, ORIGIN_HEARTBEAT } from '../services/surfaceRouterService.js';
import { SURFACE_STATUS } from './openclawSurfacePlugin.js';
import type {
  HeartbeatReason,
  HeartbeatTurnExecutor,
  IHeartbeatSystemEvent,
} from './openclawHeartbeatRunner.js';

/**
 * Config-facing view of the heartbeat reasons allowlist.
 *
 * Kept narrow so we can update the allowlist live without rebuilding the
 * runner. The runner calls the executor on every tick regardless; the
 * executor itself enforces the allowlist.
 */
export interface IHeartbeatExecutorConfig {
  /** Reasons that should emit a status tick. Other reasons are silently skipped. */
  readonly reasons: readonly HeartbeatReason[];
}

const IDLE_TEXT = '';
const THINKING_PREFIX = '⏺ heartbeat';

/**
 * Build a heartbeat status text tag.
 *
 * Upstream parallel: heartbeat activity surfaces via short status tags so
 * the user has an inspectable signal of background agent work.
 */
function formatTickText(reason: HeartbeatReason, eventCount: number): string {
  const suffix = eventCount > 0 ? ` · ${eventCount} event${eventCount === 1 ? '' : 's'}` : '';
  return `${THINKING_PREFIX} · ${reason}${suffix}`;
}

/**
 * Build a HeartbeatTurnExecutor that routes ticks to the status surface.
 *
 * @param router Workbench-owned SurfaceRouter (guaranteed non-null by caller).
 * @param getConfig Live config reader — allowlist can change at runtime.
 * @returns HeartbeatTurnExecutor suitable for passing to `new HeartbeatRunner(...)`.
 */
export function createHeartbeatTurnExecutor(
  router: ISurfaceRouterService,
  getConfig: () => IHeartbeatExecutorConfig,
): HeartbeatTurnExecutor {
  return async (events: readonly IHeartbeatSystemEvent[], reason: HeartbeatReason): Promise<void> => {
    const { reasons } = getConfig();
    if (!reasons.includes(reason)) {
      // Silently drop — the reason isn't in the user's allowlist.
      return;
    }

    // Build the system-event framing payload. Upstream frames heartbeats with
    // a structured system-event message; we carry the same shape as metadata
    // so downstream consumers (task rail, observability) can read it.
    const systemEventFraming = {
      reason,
      eventCount: events.length,
      events: events.map((e) => ({ type: e.type, payload: e.payload, timestamp: e.timestamp })),
      timestamp: Date.now(),
    };

    // 1) Flash the "thinking" tag.
    await router.sendWithOrigin(
      {
        surfaceId: SURFACE_STATUS,
        contentType: 'text',
        content: formatTickText(reason, events.length),
        metadata: {
          tooltip: `Heartbeat tick · reason=${reason} · events=${events.length}`,
          systemEvent: systemEventFraming,
        },
      },
      ORIGIN_HEARTBEAT,
    );

    // 2) Reset to idle so the status bar doesn't retain a stale tag.
    // The runner keeps ticks short and non-overlapping by design
    // (setTimeout chain in `_scheduleNext`), so this is immediate.
    await router.sendWithOrigin(
      {
        surfaceId: SURFACE_STATUS,
        contentType: 'text',
        content: IDLE_TEXT,
        metadata: { systemEvent: { ...systemEventFraming, phase: 'idle' } },
      },
      ORIGIN_HEARTBEAT,
    );
  };
}
