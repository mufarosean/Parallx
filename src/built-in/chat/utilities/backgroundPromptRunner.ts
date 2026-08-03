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
  /** Cancel an in-flight request (used by the runner's own timeout). */
  cancelRequest?(sessionId: string): void;
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
  /**
   * The model that will serve this turn (the global active model — the turn
   * engine resolves it at send time). Recorded on every log entry so "which
   * model ran my refresh" is never a mystery again.
   */
  readonly getActiveModelId?: () => string | undefined;
  /** Activity journal — background failures must be narratable. */
  readonly activity?: {
    note(n: { actor?: string; verb: string; object: string; detail?: string; source?: string }): void;
  };
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
  /**
   * Hard turn timeout (ms). The runner cancels the request and reports a
   * real failure instead of leaving an orphaned turn running behind a
   * scheduler race. Default 240s — under the dashboard scheduler's 300s
   * backstop, so the runner always settles first and single-flight
   * accounting stays truthful.
   */
  readonly timeoutMs?: number;
}

export type IBackgroundPromptResult =
  | { readonly ok: true; readonly resultText: string; readonly model?: string }
  | { readonly ok: false; readonly error: string; readonly model?: string };

const DEFAULT_TIMEOUT_MS = 240_000;

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
        error: 'No chat session to run against yet. Open the chat panel once, then retry.',
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

    // Recorded on every log entry: the model the turn engine will resolve at
    // send time. "Which model ran my refresh" must never be a mystery.
    const model = deps.getActiveModelId?.() || undefined;
    const timeoutMs = typeof req.timeoutMs === 'number' && req.timeoutMs > 0
      ? req.timeoutMs
      : DEFAULT_TIMEOUT_MS;

    const fail = (error: string): IBackgroundPromptResult => {
      deps.autonomyLog?.append({
        origin,
        requestText: label,
        content: `Background turn FAILED: ${error}`,
        metadata: { background: true, error: true, sessionId: handle.sessionId, model },
      });
      deps.activity?.note({
        actor: 'ai',
        source: origin,
        verb: 'background task failed',
        object: label,
        detail: model ? `${error} (model: ${model})` : error,
      });
      return { ok: false, error, model };
    };

    try {
      // The runner owns its own timeout: cancel the turn and report a REAL
      // failure rather than racing past an orphaned request (the old
      // scheduler-side race left widgets spinning on turns nobody cancelled).
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timedOut = new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), timeoutMs);
      });
      const turn = deps.chatService.sendRequest(handle.sessionId, text)
        .then((r) => ({ kind: 'done' as const, result: r }));
      const outcome = await Promise.race([turn, timedOut]);
      if (timer) clearTimeout(timer);

      if (outcome === 'timeout') {
        try { deps.chatService.cancelRequest?.(handle.sessionId); } catch { /* best-effort */ }
        // Give the cancellation a moment to unwind so purge archives a
        // coherent transcript; never wait on a truly wedged turn.
        await Promise.race([turn.catch(() => undefined), new Promise((r) => setTimeout(r, 5_000))]);
        return fail(`timed out after ${Math.round(timeoutMs / 1000)}s, the request was cancelled`);
      }

      // ChatService.sendRequest NEVER rejects on turn failure — provider
      // down, model missing, agent crash all come back as
      // result.errorDetails on a RESOLVED promise. Ignoring the result was
      // the black hole that reported every broken refresh as ok:true.
      const details = (outcome.result as { errorDetails?: { message?: string } } | undefined)?.errorDetails;
      if (details) {
        return fail(details.message || 'The turn failed with an unknown error.');
      }

      const session = deps.chatService.getSession(handle.sessionId);
      let resultText = '';
      if (session && session.messages.length > 0) {
        const lastPair = session.messages[session.messages.length - 1];
        resultText = extractFinalAssistantText(lastPair.response.parts);
      }
      deps.autonomyLog?.append({
        origin,
        requestText: label,
        content: resultText || '(no final text, the result was delivered via tools)',
        metadata: { background: true, sessionId: handle.sessionId, model },
      });
      return { ok: true, resultText, model };
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
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
