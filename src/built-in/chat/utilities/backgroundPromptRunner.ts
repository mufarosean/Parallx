// backgroundPromptRunner.ts — run a prompt as an isolated background agent
// turn on the ephemeral-session rail (M86 C4).
//
// Where `chat.submitPrompt` reveals the chat panel and streams into the
// user's ACTIVE session, this runner forks an ephemeral session (same
// substrate the heartbeat and cron executors use: createEphemeralSession →
// sendRequest → purge), runs one full agentic turn with the normal tools,
// and returns the outcome — the visible chat is never touched.
//
// Primary consumer: dashboard AI-widget refresh. A widget's prompt instructs
// the model to deliver its result via `dashboard_render_widget`, so the
// output lands in the widget cache mid-turn; the caller only needs ok/error.
// The runner is deliberately generic — any surface that wants headless AI
// work (automations, future extension points) can route through the same
// command.
//
// Every run is appended to the autonomy log (origin from the request,
// default 'dashboard') so background work stays auditable in one place.

import { extractFinalAssistantText } from '../../../openclaw/openclawSubagentExecutor.js';
import type {
  IEphemeralSessionHandle,
  IEphemeralSessionSeed,
} from '../../../services/chatService.js';
import type {
  IChatContentPart,
  IChatSendRequestOptions,
} from '../../../services/chatTypes.js';

// ─── Narrow dependency surfaces (testable without the full chat service) ─────

export interface IBackgroundPromptChatService {
  createEphemeralSession(parentId: string, seed?: IEphemeralSessionSeed): IEphemeralSessionHandle;
  purgeEphemeralSession(handle: IEphemeralSessionHandle): void;
  sendRequest(sessionId: string, message: string, options?: IChatSendRequestOptions): Promise<unknown>;
  getSession(sessionId: string): { messages: readonly { response: { parts: readonly IChatContentPart[] } }[] } | undefined;
}

export interface IBackgroundPromptAutonomyLog {
  append(input: {
    origin: string;
    requestText: string;
    content: string;
    metadata?: Readonly<Record<string, unknown>>;
  }): unknown;
}

export interface IBackgroundPromptDeps {
  readonly chatService: IBackgroundPromptChatService;
  /** Id of the active parent chat session to fork from, or undefined if none. */
  readonly getParentSessionId: () => string | undefined;
  /** Optional audit sink — every run (success or failure) is appended. */
  readonly autonomyLog?: IBackgroundPromptAutonomyLog;
  /**
   * Autonomous-session permission routing (2026-07-20 widget-refresh fix).
   * A background turn is NON-INTERACTIVE: without marking, an
   * approval-gated tool call appended a confirmation card to a chat panel
   * nobody was watching — the promise never resolved and the refresh hung
   * until the scheduler's timeout ("cycles forever, then stops with no
   * update"). Marked sessions defer gated calls to the autonomy log
   * instead, exactly like heartbeat/subagent turns.
   */
  readonly permissionService?: {
    markHeartbeatSession(sessionId: string, autonomyLevel?: unknown): void;
    unmarkHeartbeatSession(sessionId: string): void;
    markUserTaskSession(sessionId: string): void;
    unmarkUserTaskSession(sessionId: string): void;
  };
  /** Autonomy dial for autonomous-initiator sessions (heartbeat parity). */
  readonly getAutonomyLevel?: () => unknown;
}

export interface IBackgroundPromptRequest {
  /** The task prompt. Required, non-empty. */
  readonly text: string;
  /** Autonomy-log origin tag. Default 'dashboard'. */
  readonly origin?: string;
  /** Human-readable label for the log — e.g. '[dashboard · Morning brief]'. */
  readonly originLabel?: string;
  /** Optional seed system framing. A sensible default is applied when omitted. */
  readonly systemMessage?: string;
  /**
   * M90 consent model — who triggered this run. 'user' = an explicit user
   * gesture (widget Refresh click): the run is consented, gated tools
   * proceed (belt defers). 'autonomous' = the AI scheduled it
   * (scheduled refresh): the autonomy dial governs. Default 'autonomous'
   * (safer: an unlabeled background run gets the stricter policy).
   */
  readonly initiator?: 'user' | 'autonomous';
}

export type IBackgroundPromptResult =
  | { readonly ok: true; readonly resultText: string }
  | { readonly ok: false; readonly error: string };

// ─── Runner ──────────────────────────────────────────────────────────────────

const DEFAULT_SYSTEM_MESSAGE =
  'This is an automated background task turn — no user is watching it stream. '
  + 'Execute the task with your normal tools. If the task names a delivery '
  + 'channel (for example the dashboard_render_widget tool), deliver the '
  + 'finished result there. Keep any final summary text short.';

export function createBackgroundPromptRunner(
  deps: IBackgroundPromptDeps,
): (req: IBackgroundPromptRequest) => Promise<IBackgroundPromptResult> {
  return async (req: IBackgroundPromptRequest): Promise<IBackgroundPromptResult> => {
    const text = typeof req?.text === 'string' ? req.text.trim() : '';
    if (!text) {
      return { ok: false, error: 'runBackgroundPrompt: a non-empty "text" prompt is required.' };
    }
    const origin = typeof req.origin === 'string' && req.origin.trim() ? req.origin.trim() : 'dashboard';
    const label = typeof req.originLabel === 'string' && req.originLabel.trim()
      ? req.originLabel.trim()
      : `[${origin}] ${text.slice(0, 80)}${text.length > 80 ? '…' : ''}`;

    const parentId = deps.getParentSessionId();
    if (!parentId) {
      return {
        ok: false,
        error: 'No chat session to run against yet — open the chat panel once, then retry.',
      };
    }

    const handle = deps.chatService.createEphemeralSession(parentId, {
      systemMessage: req.systemMessage?.trim() || DEFAULT_SYSTEM_MESSAGE,
      firstUserMessage: text,
      // M91 — archive the run's transcript under its origin (e.g. 'dashboard')
      // so it's reopenable from the autonomy log like a chat session.
      archiveOrigin: origin,
    });

    // M90 — the initiator sets the session's consent policy. 'user' runs
    // (a Refresh click) are consented: gated tools proceed, the belt
    // defers. 'autonomous' runs follow the autonomy dial. Either way the
    // session is headless, so nothing can prompt — marking guarantees it.
    const initiator = req.initiator === 'user' ? 'user' : 'autonomous';
    try {
      if (initiator === 'user') deps.permissionService?.markUserTaskSession(handle.sessionId);
      else deps.permissionService?.markHeartbeatSession(handle.sessionId, deps.getAutonomyLevel?.());
    } catch { /* marking is best-effort */ }

    try {
      await deps.chatService.sendRequest(handle.sessionId, text);
      const session = deps.chatService.getSession(handle.sessionId);
      let resultText = '';
      if (session && session.messages.length > 0) {
        const lastPair = session.messages[session.messages.length - 1];
        resultText = extractFinalAssistantText(lastPair.response.parts);
      }
      deps.autonomyLog?.append({
        origin,
        requestText: label,
        content: resultText || '(no final text — result delivered via tools)',
        metadata: { background: true },
      });
      return { ok: true, resultText };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      deps.autonomyLog?.append({
        origin,
        requestText: label,
        content: `Background turn error: ${msg}`,
        metadata: { background: true, error: true },
      });
      return { ok: false, error: msg };
    } finally {
      try {
        if (initiator === 'user') deps.permissionService?.unmarkUserTaskSession(handle.sessionId);
        else deps.permissionService?.unmarkHeartbeatSession(handle.sessionId);
      } catch { /* best-effort */ }
      // Always purge — scratch state never leaks (cron-executor parity).
      deps.chatService.purgeEphemeralSession(handle);
    }
  };
}
