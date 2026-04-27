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
  /**
   * Output-dedup window (ms). When > 0, the executor hashes the final
   * assistant text (normalized) and suppresses delivery if the same text
   * was delivered within the window. Mirrors upstream OpenClaw
   * `isDuplicateMain` (24h). Default: 86_400_000 (24h). `0` disables.
   */
  readonly outputDedupWindowMs?: number;
  /** Override clock for tests. Default: Date.now. */
  readonly now?: () => number;
  /**
   * Optional permission service. When provided, the executor marks the
   * ephemeral session as heartbeat-originated for the duration of
   * `sendRequest`, so requires-approval tools route to the autonomy log
   * instead of stalling on a UI dialog the user can't see. Optional
   * `getAutonomyLevel()` lets the gate also honor agent autonomy:
   * `manual` blocks every tool, `allow-policy-actions` auto-approves.
   */
  readonly permissionService?: {
    markHeartbeatSession(sessionId: string, autonomyLevel?: import('../agent/agentTypes.js').AgentAutonomyLevel): void;
    unmarkHeartbeatSession(sessionId: string): void;
  };
  readonly getAutonomyLevel?: () => import('../agent/agentTypes.js').AgentAutonomyLevel | undefined;
}

// ---------------------------------------------------------------------------
// Constants + helpers
// ---------------------------------------------------------------------------

const IDLE_TEXT = '';
const THINKING_PREFIX = '⏺ heartbeat';
const DEFAULT_DEBOUNCE_MS = 30_000;
const DEFAULT_OUTPUT_DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h (OpenClaw parity)
const OUTPUT_DEDUP_MAX_ENTRIES = 200;
const NOOP_MARKER = /^\s*noop\s*$/i;
const NOTE_MARKER = /^\s*note\s*:\s*(.+)$/i;

/**
 * Normalize an assistant text for output-level dedup. Lowercase, collapse
 * whitespace, trim, truncate to 2000 chars. Cheap and stable.
 */
function normalizeForDedup(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 2000);
}

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
  lines.push('This is NOT a user message. It is an internal reactive trigger. The user did not address you and is not waiting for a reply.');
  if (reason === 'system-event') {
    lines.push('A workspace event occurred that may or may not warrant attention.');
    const firstType = events[0]?.type;
    if (firstType) {
      lines.push(`Event kind: ${firstType}.`);
    }
  } else if (reason === 'wake') {
    lines.push('The user manually requested your attention via the wake command.');
  } else if (reason === 'hook') {
    lines.push('A lifecycle hook triggered this turn.');
  }
  // Decision trichotomy — default IGNORE. Most events deserve no action.
  lines.push('You have exactly three response modes. Default is IGNORE. Choose only one:');
  lines.push('  1. IGNORE — the event is routine and warrants no action. Respond with exactly `NOOP` on its own line and nothing else. Do not narrate, do not acknowledge, do not announce readiness. This is the correct response for the vast majority of file saves and routine workspace activity.');
  lines.push('  2. NOTE — the event is mildly noteworthy but does not warrant action. Respond with one line beginning with `NOTE: ` followed by a single short sentence. Do not call tools. Do not elaborate. The user will see this in the autonomy log only.');
  lines.push('  3. ACT — the event clearly warrants investigation or action. Use your tools, then summarize what you did concisely. Reserve this for events with unambiguous signals (errors, broken files, requested follow-ups).');
  lines.push('When in doubt, choose IGNORE. Background chatter erodes user trust faster than missed minor events.');
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
  const outputDedupMs = realTurnDeps?.outputDedupWindowMs ?? DEFAULT_OUTPUT_DEDUP_WINDOW_MS;
  const now = realTurnDeps?.now ?? (() => Date.now());
  const lastFiredByKey = new Map<string, number>();
  // Output-dedup ring: normalized text → last delivery timestamp. Upstream
  // parity: openclaw `isDuplicateMain` (heartbeat-runner.ts L798-833).
  const deliveredOutputs = new Map<string, number>();
  function recordDelivery(normalized: string, ts: number): void {
    deliveredOutputs.set(normalized, ts);
    if (deliveredOutputs.size > OUTPUT_DEDUP_MAX_ENTRIES) {
      // Evict oldest entry (Map iteration order = insertion order).
      const firstKey = deliveredOutputs.keys().next().value;
      if (firstKey !== undefined) deliveredOutputs.delete(firstKey);
    }
  }
  function isDuplicateOutput(normalized: string, ts: number): boolean {
    if (outputDedupMs <= 0) return false;
    const prev = deliveredOutputs.get(normalized);
    return prev !== undefined && ts - prev < outputDedupMs;
  }

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

    // Mark this ephemeral session as heartbeat-originated so the permission
    // gate routes requires-approval tools to the autonomy log instead of
    // awaiting a UI dialog. Cleared in `finally`.
    const autonomy = realTurnDeps.getAutonomyLevel?.();
    realTurnDeps.permissionService?.markHeartbeatSession(handle.sessionId, autonomy);

    try {
      await realTurnDeps.chatService.sendRequest(handle.sessionId, userMessage);
      const session = realTurnDeps.chatService.getSession(handle.sessionId);
      let resultText = '';
      if (session && session.messages.length > 0) {
        const lastPair = session.messages[session.messages.length - 1];
        resultText = extractFinalAssistantText(lastPair.response.parts);
      }
      const trimmed = resultText.trim();
      const noteMatch = trimmed.match(NOTE_MARKER);
      if (trimmed.length === 0) {
        // Empty — nothing to deliver.
      } else if (NOOP_MARKER.test(trimmed)) {
        // Agent explicitly said "no action warranted" — drop delivery.
        console.debug('[HeartbeatExecutor] NOOP — skipping delivery');
      } else if (noteMatch) {
        // NOTE: agent observed something but did not act. Route to the
        // autonomy log as a quiet annotation; do not deliver to chat.
        const noteText = noteMatch[1].trim();
        const normalized = normalizeForDedup(`note:${noteText}`);
        const ts = now();
        if (isDuplicateOutput(normalized, ts)) {
          console.debug('[HeartbeatExecutor] duplicate NOTE within dedup window — skipping');
        } else {
          recordDelivery(normalized, ts);
          await router.sendWithOrigin(
            {
              surfaceId: SURFACE_STATUS,
              contentType: 'text',
              content: `note · ${noteText}`,
              metadata: {
                heartbeatNote: true,
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
      } else {
        const normalized = normalizeForDedup(trimmed);
        const ts = now();
        if (isDuplicateOutput(normalized, ts)) {
          console.debug('[HeartbeatExecutor] duplicate output within dedup window — skipping delivery');
        } else {
          recordDelivery(normalized, ts);
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
      realTurnDeps.permissionService?.unmarkHeartbeatSession(handle.sessionId);
      realTurnDeps.chatService.purgeEphemeralSession(handle);
      await resetStatus('idle');
    }
  };
}
