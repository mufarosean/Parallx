/**
 * CronTurnExecutor — M58 W4 wiring factory.
 *
 * Wires the audit-closed {@link ./openclawCronService.ts.CronService}
 * (D4 17/17 ALIGNED) to the workbench SurfaceRouter (M58 W6) so that each
 * cron-fire emits an origin-stamped delivery on the status + notifications
 * surfaces, tagged with {@link ORIGIN_CRON}.
 *
 * Substrate scope (M58 W4, "ship thin" per Parallx_Milestone_58.md §6.5):
 *
 *   Parallx has no isolated-turn primitive today — `chatService.sendRequest`
 *   mutates `session.messages[]`. Firing a real agent turn from a cron
 *   trigger would either pollute the active chat session or require
 *   inventing a parallel turn engine (violates M41 P6 — "don't invent when
 *   upstream has a proven approach").
 *
 *   W4 therefore ships a **thin executor**: it routes a status-surface
 *   delivery ("cron fired: <name>") and, when the job carries an
 *   `agentTurn` payload, a notification-surface announcement. The
 *   `agentTurn` string itself is preserved verbatim in the notification
 *   metadata + the CronService run history so that M59, when it builds
 *   the isolated-turn substrate in W5, can retrofit this executor to
 *   actually execute `payload.agentTurn` without any API changes to
 *   `CronService`, its 8-action tool surface, or the UX.
 *
 *   `CronTurnExecutor` is the stable swap seam for that future upgrade.
 */

import {
  ISurfaceRouterService,
  ORIGIN_CRON,
} from '../services/surfaceRouterService.js';
import {
  SURFACE_STATUS,
  SURFACE_NOTIFICATIONS,
} from './openclawSurfacePlugin.js';
import type {
  ICronJob,
  ContextLineFetcher,
  CronTurnExecutor,
  HeartbeatWaker,
} from './openclawCronService.js';
import type { HeartbeatRunner } from './openclawHeartbeatRunner.js';
import type { IChatSession } from '../services/chatTypes.js';
import { ChatContentPartKind } from '../services/chatTypes.js';

// ---------------------------------------------------------------------------
// Status / notification text helpers
// ---------------------------------------------------------------------------

const STATUS_PREFIX = '⏰ cron';

function formatStatusText(job: ICronJob): string {
  return `${STATUS_PREFIX} · ${job.name}`;
}

function formatNotificationText(job: ICronJob): string {
  const desc = job.description?.trim();
  const base = `Cron job "${job.name}" fired`;
  return desc ? `${base} — ${desc}` : base;
}

// ---------------------------------------------------------------------------
// Thin executor factory
// ---------------------------------------------------------------------------

/**
 * Build a CronTurnExecutor that routes each fire to the status + notification
 * surfaces via the SurfaceRouter, stamped with `ORIGIN_CRON`.
 *
 * This executor does NOT invoke the LLM, does NOT call `chatService.sendRequest`,
 * and does NOT run any tool loop. See §6.5 for why.
 *
 * @param router Workbench-owned SurfaceRouter.
 */
export function createCronTurnExecutor(
  router: ISurfaceRouterService,
): CronTurnExecutor {
  return async (job: ICronJob, contextLines: readonly string[]): Promise<void> => {
    const framing = {
      jobId: job.id,
      jobName: job.name,
      wakeMode: job.wakeMode,
      firedAt: Date.now(),
      contextLineCount: contextLines.length,
      // Preserved verbatim so the future (M59) real-turn executor can pick
      // this up and actually execute it against an isolated session.
      agentTurn: job.payload.agentTurn,
      systemEvent: job.payload.systemEvent,
    };

    // 1) Status surface flash — short tag so the user sees that autonomy
    //    did something.
    await router.sendWithOrigin(
      {
        surfaceId: SURFACE_STATUS,
        contentType: 'text',
        content: formatStatusText(job),
        metadata: {
          tooltip: `Cron fired · ${job.name} · wake=${job.wakeMode}`,
          cronEvent: framing,
        },
      },
      ORIGIN_CRON,
    );

    // 2) Notification surface announcement — always-info. Durable, so the
    //    user sees the autonomy signal even if the status bar has scrolled.
    //    When the M59 real-turn substrate lands this becomes the response
    //    surface; for now it advertises *state*, not *action*.
    await router.sendWithOrigin(
      {
        surfaceId: SURFACE_NOTIFICATIONS,
        contentType: 'text',
        content: formatNotificationText(job),
        metadata: {
          severity: 'info',
          source: 'cron',
          cronEvent: framing,
        },
      },
      ORIGIN_CRON,
    );

    // 3) Reset status surface so the tag doesn't linger indefinitely.
    //    The CronService timer runs at 60s granularity, so there's no risk
    //    of clobbering a later tick.
    await router.sendWithOrigin(
      {
        surfaceId: SURFACE_STATUS,
        contentType: 'text',
        content: '',
        metadata: { cronEvent: { ...framing, phase: 'idle' } },
      },
      ORIGIN_CRON,
    );
  };
}

// ---------------------------------------------------------------------------
// ContextLineFetcher — thin active-session reader
// ---------------------------------------------------------------------------

/**
 * Shape of the chat-service slice we need to read recent messages.
 * Narrow-by-design so we can exercise the fetcher in tests without the
 * full IChatService surface.
 */
export interface ICronChatSessionAccessor {
  /** Returns the session currently bound to the active chat widget, if any. */
  getActiveSession(): IChatSession | undefined;
}

/**
 * Build a ContextLineFetcher that reads the last `count` request/response
 * pairs from the active chat session and flattens them into plain lines.
 *
 * Thin scope (M58 W4): no semantic filtering, no token budget. The lines
 * are captured and handed to the thin executor, which then carries them
 * inside delivery metadata for the M59 real-turn substrate to consume.
 *
 * If there is no active session (workbench hasn't finished activation, or
 * user closed all chats), the fetcher returns an empty array rather than
 * throwing — cron should never block on UX state.
 *
 * @param accessor Chat session accessor (typically the runtime chatService).
 */
export function createCronContextLineFetcher(
  accessor: ICronChatSessionAccessor,
): ContextLineFetcher {
  return async (count: number): Promise<readonly string[]> => {
    if (count <= 0) return [];
    const session = accessor.getActiveSession();
    if (!session) return [];

    const pairs = session.messages;
    const start = Math.max(0, pairs.length - count);
    const out: string[] = [];
    for (let i = start; i < pairs.length; i++) {
      const pair = pairs[i];
      const userText = pair.request.text?.trim();
      const assistantText = extractAssistantText(pair.response.parts).trim();
      if (userText) out.push(`user: ${userText}`);
      if (assistantText) out.push(`assistant: ${assistantText}`);
    }
    return out;
  };
}

/**
 * Flatten the markdown parts of an assistant response into a single string.
 * Non-markdown parts (tool invocations, progress, etc.) are skipped — they
 * carry no user-readable transcript text.
 */
function extractAssistantText(parts: readonly unknown[]): string {
  const out: string[] = [];
  for (const part of parts) {
    if (part && typeof part === 'object') {
      const p = part as { kind?: unknown; content?: unknown };
      if (p.kind === ChatContentPartKind.Markdown && typeof p.content === 'string') {
        out.push(p.content);
      }
    }
  }
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// HeartbeatWaker adapter
// ---------------------------------------------------------------------------

/**
 * Build a HeartbeatWaker that forwards cron wake requests to the runtime
 * HeartbeatRunner. The runner's reasons allowlist already accepts `'cron'`
 * (see `HEARTBEAT_REASON_OPTIONS` in unifiedConfigTypes.ts).
 *
 * If the heartbeat runner is disabled in config, `wake()` is a no-op inside
 * the runner — cron never fails because heartbeat is off.
 */
export function createCronHeartbeatWaker(runner: HeartbeatRunner): HeartbeatWaker {
  return (reason: 'cron') => {
    runner.wake(reason);
  };
}
