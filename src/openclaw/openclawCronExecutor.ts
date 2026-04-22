/**
 * CronTurnExecutor — M58 W4-real wiring factory.
 *
 * Wires the audit-closed {@link ./openclawCronService.ts.CronService}
 * (D4 17/17 ALIGNED) to the workbench SurfaceRouter (M58 W6) AND to the W5
 * ephemeral-session substrate so that each cron fire:
 *
 *   1. Emits an origin-stamped status flash immediately (so the user
 *      knows autonomy did something even before the turn completes).
 *   2. If `payload.agentTurn` is set and real-turn deps are available,
 *      runs a real isolated LLM turn via `createEphemeralSession` +
 *      `sendRequest` and delivers the final assistant text as a
 *      `cronResult` card on the chat surface.
 *   3. If `payload.agentTurn` is unset (a bare reminder job), keeps the
 *      thin notification behavior — job fired, nothing to execute.
 *
 * Reason for shape change (Parallx_Milestone_58.md §6.5 corrective scope,
 * 2026-04-22): the original §6.5 ship-thin decision was reversed after W5
 * proved the ephemeral-session substrate works. Cron jobs with
 * `agentTurn` payloads must actually execute the turn, not just advertise
 * that they fired. Autonomous cron turns are the "cron runs a real agent
 * task at 8am" user story.
 *
 * Upstream parity:
 *   - cron-tool.ts (openclaw e635cedb) — cron jobs carry an agent prompt
 *     and execute it through the same turn runner as a user message,
 *     in an isolated scope that does not pollute the active chat.
 *   - Parallx adaptation: the isolated scope is the W5 ephemeral session
 *     substrate; the turn runner is `chatService.sendRequest` unchanged.
 *
 * Context-line seeding:
 *   - Ephemeral seed does NOT currently support prior message pairs
 *     (the seed surface is `systemMessage` + `firstUserMessage`).
 *   - M58-real folds `contextLines` into the user message under a
 *     "Previous chat context:" header. This carries the intent — the
 *     model sees the recent conversation before executing the task —
 *     without widening the substrate API. Future work can add prior-
 *     messages seeding to the substrate; the executor swap is trivial
 *     when that lands.
 *
 * Loop safety:
 *   - Cron has no event sources that read from the surface router; its
 *     only trigger is the internal scheduler timer + explicit
 *     `cron_run`/`cron_wake` tool calls. Emitting ORIGIN_CRON deliveries
 *     cannot re-enter the scheduler.
 *   - Tool calls inside cron real turns still pass through the normal
 *     approval gates (substrate uses the shared `chatService.sendRequest`
 *     pipeline — ChatToolLoopSafety, approval flow, all intact).
 *
 * Failure handling:
 *   - If the real turn throws, the executor:
 *       1. Delivers an error `cronResult` card (so the user sees what
 *          failed, not just a silent scheduler entry).
 *       2. Purges the ephemeral session in `finally`.
 *       3. Rethrows so `CronService._executeJob` records success=false
 *          with the error message in `cron_runs` history.
 *
 * Fallback (thin) behavior:
 *   - When `realTurnDeps` is not provided OR no active parent session
 *     exists OR `payload.agentTurn` is unset, the executor falls back to
 *     the original thin path: status flash + notification + idle reset.
 *     Bare reminder jobs and early activation both stay safe.
 */

import {
  ISurfaceRouterService,
  ORIGIN_CRON,
} from '../services/surfaceRouterService.js';
import {
  SURFACE_STATUS,
  SURFACE_NOTIFICATIONS,
  SURFACE_CHAT,
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
// Real-turn deps
// ---------------------------------------------------------------------------

/** Narrow surface of ChatService the cron real-turn path touches. */
export interface ICronChatService {
  createEphemeralSession(parentId: string, seed?: IEphemeralSessionSeed): IEphemeralSessionHandle;
  purgeEphemeralSession(handle: IEphemeralSessionHandle): void;
  sendRequest(sessionId: string, message: string, options?: IChatSendRequestOptions): Promise<unknown>;
  getSession(sessionId: string): { messages: readonly { response: { parts: readonly IChatContentPart[] } }[] } | undefined;
}

/** Optional deps enabling real-turn execution. Absent → thin fallback. */
export interface ICronRealTurnDeps {
  readonly chatService: ICronChatService;
  /** Returns the id of the active parent chat session, or undefined if none. */
  readonly getParentSessionId: () => string | undefined;
}

function buildSeedSystemMessage(job: ICronJob, firedAt: number): string {
  const iso = new Date(firedAt).toISOString();
  return [
    `This is a scheduled cron job "${job.name}" firing at ${iso}.`,
    'The user defined this turn at scheduling time.',
    'Execute it and report the result concisely.',
  ].join(' ');
}

function buildSeedUserMessage(agentTurn: string, contextLines: readonly string[]): string {
  const parts: string[] = [];
  if (contextLines.length > 0) {
    parts.push('Previous chat context:');
    for (const line of contextLines) {
      parts.push(line);
    }
    parts.push('');
  }
  parts.push(`Task: ${agentTurn}`);
  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Executor factory
// ---------------------------------------------------------------------------

/**
 * Build a CronTurnExecutor that routes each fire through status +
 * (optionally) real turn + chat result delivery, all stamped with
 * `ORIGIN_CRON`.
 *
 * @param router Workbench-owned SurfaceRouter.
 * @param realTurnDeps Optional real-turn deps. When provided and the job
 *   carries `payload.agentTurn`, the executor runs a real isolated LLM
 *   turn. Otherwise it falls back to the original thin path.
 */
export function createCronTurnExecutor(
  router: ISurfaceRouterService,
  realTurnDeps?: ICronRealTurnDeps,
): CronTurnExecutor {
  return async (job: ICronJob, contextLines: readonly string[]): Promise<void> => {
    const firedAt = Date.now();
    const agentTurn = typeof job.payload.agentTurn === 'string' ? job.payload.agentTurn.trim() : '';
    const hasAgentTurn = agentTurn.length > 0;

    const framing = {
      jobId: job.id,
      jobName: job.name,
      wakeMode: job.wakeMode,
      firedAt,
      contextLineCount: contextLines.length,
      agentTurn: job.payload.agentTurn,
      systemEvent: job.payload.systemEvent,
    };

    // 1) Status flash — always fires so the user sees cron activity even
    //    before the turn completes.
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

    const resetStatus = async (phase: string): Promise<void> => {
      await router.sendWithOrigin(
        {
          surfaceId: SURFACE_STATUS,
          contentType: 'text',
          content: '',
          metadata: { cronEvent: { ...framing, phase } },
        },
        ORIGIN_CRON,
      );
    };

    // 2) Thin path: either no agent turn defined (bare reminder job) or no
    //    real-turn deps / active session. Keep the §6.5 notification behavior.
    const parentId = realTurnDeps?.getParentSessionId();
    const canRunRealTurn = hasAgentTurn && realTurnDeps !== undefined && parentId !== undefined;

    if (!canRunRealTurn) {
      if (realTurnDeps !== undefined && hasAgentTurn && parentId === undefined) {
        console.debug('[CronExecutor] no active parent session; falling back to thin notification');
      }
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
      await resetStatus('idle');
      return;
    }

    // 3) Real-turn path — run the user's scheduled prompt through the
    //    ephemeral-session substrate.
    const systemMessage = buildSeedSystemMessage(job, firedAt);
    const userMessage = buildSeedUserMessage(agentTurn, contextLines);

    const handle = realTurnDeps!.chatService.createEphemeralSession(parentId!, {
      systemMessage,
      firstUserMessage: userMessage,
    });

    let thrownError: unknown;
    try {
      await realTurnDeps!.chatService.sendRequest(handle.sessionId, userMessage);
      const session = realTurnDeps!.chatService.getSession(handle.sessionId);
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
              cronResult: true,
              jobId: job.id,
              jobName: job.name,
              parentSessionId: parentId,
              cronEvent: framing,
            },
          },
          ORIGIN_CRON,
        );
      }
    } catch (err) {
      thrownError = err;
      const msg = err instanceof Error ? err.message : String(err);
      await router.sendWithOrigin(
        {
          surfaceId: SURFACE_CHAT,
          contentType: 'text',
          content: `Cron turn error: ${msg}`,
          metadata: {
            cronResult: true,
            jobId: job.id,
            jobName: job.name,
            error: true,
            parentSessionId: parentId,
            cronEvent: framing,
          },
        },
        ORIGIN_CRON,
      );
    } finally {
      // Always purge — scratch state never leaks.
      realTurnDeps!.chatService.purgeEphemeralSession(handle);
      await resetStatus('idle');
    }

    // Rethrow so `CronService._executeJob` records success=false with the
    // error message in `cron_runs` history. The chat error card has already
    // been delivered at this point.
    if (thrownError !== undefined) {
      throw thrownError instanceof Error ? thrownError : new Error(String(thrownError));
    }
  };
}

// ---------------------------------------------------------------------------
// ContextLineFetcher — thin active-session reader (unchanged from M58 W4)
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
// HeartbeatWaker adapter (unchanged from M58 W4)
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
