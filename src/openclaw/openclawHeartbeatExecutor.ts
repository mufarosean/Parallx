/**
 * HeartbeatTurnExecutor — M58 W2-real wiring factory.
 *
 * Wires the audit-closed {@link `openclawHeartbeatRunner.ts`.HeartbeatRunner}
 * (D2 13/13 ALIGNED) to the workbench SurfaceRouter (M58 W6) AND to the W5
 * ephemeral-session substrate so that:
 *
 *   - `interval` ticks emit status-only pulses (no LLM turn — periodic
 *     token-burn would deliver no value without a triggering event).
 *   - `cron` reason is a no-op (delegated to cron executor).
 *   - `system-event`, `wake`, and `hook` reasons run a real isolated LLM
 *     turn via `createEphemeralSession` + `sendRequest`, and deliver the
 *     final assistant text to the parent chat as an origin-stamped
 *     `heartbeatResult` card.
 *
 * Reason → behavior matrix (Parallx_Milestone_58.md §6.5 corrective scope,
 * 2026-04-22):
 *
 *   | reason         | status flash | real turn | notes                          |
 *   |----------------|--------------|-----------|--------------------------------|
 *   | interval       | yes          | no        | periodic "I'm alive" signal    |
 *   | cron           | no           | no        | delegated to cron executor     |
 *   | system-event   | yes          | yes       | debounced 30s per event key    |
 *   | wake           | yes          | yes       | manual user invocation         |
 *   | hook           | yes          | yes       | explicit programmatic trigger  |
 *
 * Upstream parity:
 *   - heartbeat-runner.ts (openclaw e635cedb) — turn invocation with
 *     structured system-event framing and scheduler-driven wake reasons.
 *   - Parallx adopts the same reason taxonomy; the substrate (ephemeral
 *     session) is the Parallx adaptation of openclaw's "run a fresh agent
 *     turn without polluting the parent session."
 *
 * Parallx adaptation:
 *   - Session fork: `chatService.createEphemeralSession(parentId, seed)`
 *     (see `src/services/chatService.ts` W5-A substrate).
 *   - Turn driver: existing `chatService.sendRequest` — no parallel turn
 *     engine (M41 P6: don't invent when upstream has a proven approach).
 *   - Result extraction: `extractFinalAssistantText` from the subagent
 *     executor (shared helper — same final-text contract across autonomous
 *     turn consumers: subagent, heartbeat, cron).
 *   - Delivery: `surfaceRouter.sendWithOrigin(ORIGIN_HEARTBEAT, SURFACE_CHAT,
 *     { metadata: { heartbeatResult: true, reason, eventKind } })`. The
 *     chat surface / UI can style these distinctly from user-initiated
 *     turns.
 *
 * Loop safety (structural):
 *   - Heartbeat's only event sources are `fileService.onDidFileChange`,
 *     `indexingPipelineService.onDidCompleteInitialIndex`, and
 *     `workspaceService.onDidChangeFolders`. None of them read from the
 *     surface router's delivery history. Emitting ORIGIN_HEARTBEAT
 *     deliveries therefore cannot re-enter pushEvent.
 *   - `system-event` is debounced per event key (30s window). A
 *     file-watch storm on the same path fires a single real turn.
 *   - `interval` is intentionally status-only to prevent a background
 *     timer from generating LLM calls with no trigger.
 *   - Tool calls inside heartbeat real turns still pass through the
 *     normal tool-policy approval gates (substrate reuses
 *     `chatService.sendRequest`, which runs `ChatToolLoopSafety` and
 *     approval flow verbatim).
 *
 * Fallback (thin) behavior:
 *   - If `realTurnDeps` is not provided OR the reason requires a real
 *     turn but no parent chat session is active, the executor falls
 *     back to status-only flash + idle reset and logs a debug note.
 *     This keeps heartbeat safe during workbench activation or when the
 *     user has no chat widget open.
 */

import { ISurfaceRouterService, ORIGIN_HEARTBEAT } from '../services/surfaceRouterService.js';
import { SURFACE_STATUS, SURFACE_CHAT } from './openclawSurfacePlugin.js';
import type {
  HeartbeatReason,
  HeartbeatTurnExecutor,
  IHeartbeatSystemEvent,
} from './openclawHeartbeatRunner.js';
import { extractFinalAssistantText } from './openclawSubagentExecutor.js';
import type {
  IEphemeralSessionHandle,
  IEphemeralSessionSeed,
} from '../services/chatService.js';
import type {
  IChatContentPart,
  IChatSendRequestOptions,
} from '../services/chatTypes.js';

// ---------------------------------------------------------------------------
// Config + dependency shapes
// ---------------------------------------------------------------------------

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

/** Narrow surface of ChatService the heartbeat real-turn path touches. */
export interface IHeartbeatChatService {
  createEphemeralSession(parentId: string, seed?: IEphemeralSessionSeed): IEphemeralSessionHandle;
  purgeEphemeralSession(handle: IEphemeralSessionHandle): void;
  sendRequest(sessionId: string, message: string, options?: IChatSendRequestOptions): Promise<unknown>;
  getSession(sessionId: string): { messages: readonly { response: { parts: readonly IChatContentPart[] } }[] } | undefined;
}

/** Optional deps enabling real-turn execution. Absent → thin fallback. */
export interface IHeartbeatRealTurnDeps {
  readonly chatService: IHeartbeatChatService;
  /** Returns the id of the active parent chat session, or undefined if none. */
  readonly getParentSessionId: () => string | undefined;
  /** Debounce window for `system-event` per event key (ms). Default: 30_000. */
  readonly debounceMs?: number;
  /** Override clock for tests. Default: Date.now. */
  readonly now?: () => number;
}

// ---------------------------------------------------------------------------
// Constants + helpers
// ---------------------------------------------------------------------------

const IDLE_TEXT = '';
const THINKING_PREFIX = '⏺ heartbeat';
const DEFAULT_DEBOUNCE_MS = 30_000;

function formatTickText(reason: HeartbeatReason, eventCount: number): string {
  const suffix = eventCount > 0 ? ` · ${eventCount} event${eventCount === 1 ? '' : 's'}` : '';
  return `${THINKING_PREFIX} · ${reason}${suffix}`;
}

/**
 * Debounce key for an event. We prefer the event's payload.path (file
 * changes), otherwise fall back to `type|json(payload)` so distinct events
 * of the same kind don't collapse into one bucket.
 */
function computeDebounceKey(event: IHeartbeatSystemEvent): string {
  const rawPath = (event.payload as { path?: unknown })?.path;
  if (typeof rawPath === 'string' && rawPath.length > 0) {
    return `${event.type}|${rawPath}`;
  }
  try {
    return `${event.type}|${JSON.stringify(event.payload ?? {})}`;
  } catch {
    return event.type;
  }
}

function buildSeedSystemMessage(reason: HeartbeatReason, events: readonly IHeartbeatSystemEvent[]): string {
  const lines: string[] = [];
  lines.push(`You were woken by a heartbeat event (reason: ${reason}).`);
  if (reason === 'system-event') {
    lines.push('A workspace event occurred that may warrant attention.');
    const firstType = events[0]?.type;
    if (firstType) {
      lines.push(`Event kind: ${firstType}.`);
    }
  } else if (reason === 'wake') {
    lines.push('The user manually requested your attention via the wake command.');
  } else if (reason === 'hook') {
    lines.push('A lifecycle hook triggered this turn.');
  }
  lines.push('Use your tools to investigate if appropriate. Be concise. If no action is warranted, say so briefly.');
  return lines.join(' ');
}

function buildSeedUserMessage(reason: HeartbeatReason, events: readonly IHeartbeatSystemEvent[]): string {
  const lines: string[] = [];
  lines.push(`[heartbeat ${reason}]`);
  if (events.length === 0) {
    lines.push('(no events)');
  } else {
    lines.push(`${events.length} event${events.length === 1 ? '' : 's'}:`);
    for (const ev of events.slice(0, 10)) {
      let payloadStr: string;
      try {
        payloadStr = JSON.stringify(ev.payload);
      } catch {
        payloadStr = '[unserializable payload]';
      }
      lines.push(`- ${ev.type} @ ${new Date(ev.timestamp).toISOString()} · ${payloadStr}`);
    }
    if (events.length > 10) {
      lines.push(`... (${events.length - 10} more events truncated)`);
    }
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Executor factory
// ---------------------------------------------------------------------------

/**
 * Build a heartbeat executor that:
 *   1. Respects the reasons allowlist.
 *   2. Emits status-surface pulses for observability on allowed reasons.
 *   3. Runs a real isolated LLM turn on `system-event`, `wake`, and `hook`
 *      when `realTurnDeps` is provided and a parent session exists.
 *   4. Debounces `system-event` per event key (30s window) so file-watch
 *      storms collapse to one real turn.
 *
 * @param router Workbench-owned SurfaceRouter.
 * @param getConfig Live config reader — reasons allowlist can change at runtime.
 * @param realTurnDeps Optional real-turn dependencies. When omitted, the
 *   executor falls back to status-only pulses (safe for early activation).
 * @returns HeartbeatTurnExecutor suitable for `new HeartbeatRunner(...)`.
 */
export function createHeartbeatTurnExecutor(
  router: ISurfaceRouterService,
  getConfig: () => IHeartbeatExecutorConfig,
  realTurnDeps?: IHeartbeatRealTurnDeps,
): HeartbeatTurnExecutor {
  const debounceMs = realTurnDeps?.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const now = realTurnDeps?.now ?? (() => Date.now());
  const lastFiredByKey = new Map<string, number>();

  return async (events: readonly IHeartbeatSystemEvent[], reason: HeartbeatReason): Promise<void> => {
    const { reasons } = getConfig();
    if (!reasons.includes(reason)) return;

    // cron is delegated to the cron executor — heartbeat stays silent.
    if (reason === 'cron') return;

    const systemEventFraming = {
      reason,
      eventCount: events.length,
      events: events.map((e) => ({ type: e.type, payload: e.payload, timestamp: e.timestamp })),
      timestamp: Date.now(),
    };

    // 1) Status flash — tells user "something is happening."
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

    const resetStatus = async (phase: string): Promise<void> => {
      await router.sendWithOrigin(
        {
          surfaceId: SURFACE_STATUS,
          contentType: 'text',
          content: IDLE_TEXT,
          metadata: { systemEvent: { ...systemEventFraming, phase } },
        },
        ORIGIN_HEARTBEAT,
      );
    };

    // Interval is intentionally status-only — a periodic timer firing real
    // LLM turns with no trigger event is a token-burn trap.
    if (reason === 'interval' || realTurnDeps === undefined) {
      await resetStatus('idle');
      return;
    }

    // Real-turn path: system-event / wake / hook
    const parentId = realTurnDeps.getParentSessionId();
    if (!parentId) {
      // No active chat — skip real turn cleanly. Heartbeat must never error.
      console.debug('[HeartbeatExecutor] no active parent chat session; skipping real turn');
      await resetStatus('idle-no-session');
      return;
    }

    // Debounce system-event per key. Other reasons (wake, hook) are always
    // user/programmatically initiated, so debouncing them would swallow
    // intentional requests.
    if (reason === 'system-event' && events.length > 0) {
      const keys = Array.from(new Set(events.map(computeDebounceKey)));
      const current = now();
      const allRecent = keys.every((k) => {
        const last = lastFiredByKey.get(k);
        return last !== undefined && current - last < debounceMs;
      });
      if (allRecent) {
        await resetStatus('idle-debounced');
        return;
      }
      for (const k of keys) lastFiredByKey.set(k, current);
    }

    const systemMessage = buildSeedSystemMessage(reason, events);
    const userMessage = buildSeedUserMessage(reason, events);

    const handle = realTurnDeps.chatService.createEphemeralSession(parentId, {
      systemMessage,
      firstUserMessage: userMessage,
    });

    try {
      await realTurnDeps.chatService.sendRequest(handle.sessionId, userMessage);
      const session = realTurnDeps.chatService.getSession(handle.sessionId);
      let resultText = '';
      if (session && session.messages.length > 0) {
        const lastPair = session.messages[session.messages.length - 1];
        resultText = extractFinalAssistantText(lastPair.response.parts);
      }
      if (resultText.trim().length > 0) {
        await router.sendWithOrigin(
          {
            surfaceId: SURFACE_CHAT,
            contentType: 'text',
            content: resultText,
            metadata: {
              heartbeatResult: true,
              reason,
              eventKind: events[0]?.type,
              eventCount: events.length,
              parentSessionId: parentId,
              systemEvent: systemEventFraming,
            },
          },
          ORIGIN_HEARTBEAT,
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await router.sendWithOrigin(
        {
          surfaceId: SURFACE_CHAT,
          contentType: 'text',
          content: `Heartbeat turn error: ${msg}`,
          metadata: {
            heartbeatResult: true,
            reason,
            error: true,
            parentSessionId: parentId,
            systemEvent: systemEventFraming,
          },
        },
        ORIGIN_HEARTBEAT,
      );
    } finally {
      // Always purge — even on error — so scratch state doesn't leak.
      realTurnDeps.chatService.purgeEphemeralSession(handle);
      await resetStatus('idle');
    }
  };
}
