/**
 * SubagentTurnExecutor — M58 W5 wiring factory.
 *
 * Builds the {@link SubagentTurnExecutor} + {@link SubagentAnnouncer}
 * delegates that the audit-closed {@link ./openclawSubagentSpawn.ts.SubagentSpawner}
 * (D5 15/15 ALIGNED) needs in order to execute a *real* isolated LLM turn
 * and deliver its final assistant response back to the parent chat.
 *
 * Unlike W2/W4 (which ship thin per §6.5), W5 DOES run a live isolated
 * turn: it is the minimum viable proof that the ephemeral-session
 * substrate (`chatService.createEphemeralSession` / `purgeEphemeralSession`
 * + `chatSessionPersistence.isEphemeralSessionId`) provides true
 * isolation — no persisted rows, no session-list pollution, no mutation of
 * the parent session's `messages[]`.
 *
 * Upstream parity:
 *   - subagent-spawn.ts:1-847 @ github.com/openclaw/openclaw
 *     (spawnSubagentDirect → registerSubagentRun → isolated session → run →
 *     announce → cleanup)
 *   - Parallx adapts the "isolated session" step onto our
 *     ephemeral-session substrate; everything else (registry, depth gating,
 *     concurrency cap, timeout, announcement) is reused from
 *     `SubagentSpawner` verbatim.
 *
 * Parallx adaptation:
 *   - Session fork is `chatService.createEphemeralSession(parentId, seed)`
 *   - Turn driver is the existing `chatService.sendRequest` — no parallel
 *     turn engine (M41 P6)
 *   - Final assistant text is extracted from the completed pair's
 *     `response.parts` (text + markdown parts joined)
 *   - Announcement is a `surfaceRouter.sendWithOrigin(ORIGIN_SUBAGENT, ...)`
 *     onto the chat surface, with `metadata.subagentResult = true` so the
 *     chat UI (or a future card renderer) can surface it distinctly
 *
 * Depth + recursion:
 *   - The module tracks active subagent depth in `_subagentDepth` so the
 *     `sessions_spawn` tool handler can reject recursive spawns (M58
 *     hard-cap: subagent cannot spawn another subagent, i.e. maxDepth = 1)
 *   - The SubagentSpawner itself also enforces this via `callerDepth >=
 *     maxDepth` — both gates are intentional (belt-and-braces)
 */

import type {
  SubagentTurnExecutor,
  SubagentAnnouncer,
  ISubagentRun,
} from './openclawSubagentSpawn.js';
import {
  ORIGIN_SUBAGENT,
} from '../services/surfaceRouterService.js';
import { SURFACE_CHAT } from './openclawSurfacePlugin.js';
import type {
  IEphemeralSessionHandle,
  IEphemeralSessionSeed,
} from '../services/chatService.js';
import type {
  IChatAssistantResponse,
  IChatContentPart,
  IChatSendRequestOptions,
} from '../services/chatTypes.js';

// ---------------------------------------------------------------------------
// Shared subagent-depth state (tool handler ↔ executor)
// ---------------------------------------------------------------------------
//
// JavaScript runs single-threaded on the renderer; the only way `depth` can
// be observed from `sessions_spawn` is from within an awaited call graph
// rooted at a subagent turn. Incrementing before `sendRequest` and
// decrementing in `finally` therefore gives the tool handler a correct view
// of the caller's depth for recursion rejection.
//
// If two user-initiated spawns run in parallel (both at depth 0), the
// counter momentarily reads 2 — but the tool only needs a truthy "deeper
// than 0" signal to reject recursion, so the sum is safe.

let _subagentDepth = 0;

/** Current observed subagent depth. 0 == caller is the user / parent turn. */
export function currentSubagentDepth(): number {
  return _subagentDepth;
}

/**
 * @internal — exported only for tests. Production code should not call
 * this directly; the executor manages the counter around sendRequest.
 */
export function _resetSubagentDepthForTests(): void {
  _subagentDepth = 0;
}

// ---------------------------------------------------------------------------
// Narrow dependencies so tests don't need a full ChatService
// ---------------------------------------------------------------------------

/** Narrow surface of ChatService the executor touches. */
export interface ISubagentChatService {
  createEphemeralSession(parentId: string, seed?: IEphemeralSessionSeed): IEphemeralSessionHandle;
  purgeEphemeralSession(handle: IEphemeralSessionHandle): void;
  sendRequest(sessionId: string, message: string, options?: IChatSendRequestOptions): Promise<unknown>;
  getSession(sessionId: string): { messages: readonly { response: IChatAssistantResponse }[] } | undefined;
}

/** Narrow surface of SurfaceRouter the announcer touches. */
export interface ISubagentAnnouncerRouter {
  sendWithOrigin(
    params: {
      surfaceId: string;
      contentType: 'text' | 'structured' | 'binary' | 'action';
      content: unknown;
      metadata?: Record<string, unknown>;
    },
    origin: string,
  ): Promise<unknown>;
}

// ---------------------------------------------------------------------------
// Final-text extraction
// ---------------------------------------------------------------------------

/**
 * Concatenate text-bearing parts from an assistant response into a single
 * string. Matches the `_extractTextContent` shape used by
 * chatSessionPersistence.ts (`content` / `code` / `message` fields).
 */
export function extractFinalAssistantText(parts: readonly IChatContentPart[]): string {
  const chunks: string[] = [];
  for (const part of parts) {
    const rec = part as unknown as Record<string, unknown>;
    if (typeof rec.content === 'string') chunks.push(rec.content);
    else if (typeof rec.code === 'string') chunks.push(rec.code as string);
    else if (typeof rec.message === 'string') chunks.push(rec.message as string);
  }
  return chunks.join('\n').trim();
}

// ---------------------------------------------------------------------------
// Executor factory
// ---------------------------------------------------------------------------

export interface ICreateSubagentTurnExecutorOpts {
  /** Narrow chat service (createEphemeralSession / sendRequest / getSession / purge). */
  readonly chatService: ISubagentChatService;
  /** Returns the id of the parent session the subagent was spawned from. */
  readonly getParentSessionId: () => string | undefined;
  /**
   * Optional per-turn options passed to sendRequest. Kept narrow (no
   * participant override by default — the ephemeral session inherits the
   * parent's mode/model, and the default participant routes correctly).
   */
  readonly buildSendOptions?: (task: string, model: string | null) => IChatSendRequestOptions | undefined;
  /**
   * Optional permission-service hooks. When provided, the ephemeral subagent
   * session is marked so that requires-approval tool calls route to the
   * autonomy log under `origin: 'subagent'` instead of stalling on a UI
   * dialog the user can't see.
   */
  readonly permissionService?: {
    markSubagentSession(sessionId: string, autonomyLevel?: import('../agent/agentTypes.js').AgentAutonomyLevel): void;
    unmarkSubagentSession(sessionId: string): void;
  };
  /** Resolves the autonomy level applied to subagent tool calls. */
  readonly getAutonomyLevel?: () => import('../agent/agentTypes.js').AgentAutonomyLevel | undefined;
}

/**
 * Build a {@link SubagentTurnExecutor} that runs a real, isolated LLM turn.
 *
 * Flow per spawn:
 *   1. Increment `_subagentDepth` so recursive `sessions_spawn` calls from
 *      inside the subagent reject.
 *   2. `chatService.createEphemeralSession(parentId, seed)` — scratch session
 *      invisible to persistence + session-list UI.
 *   3. `chatService.sendRequest(handle.sessionId, task, options)` — a real
 *      turn through the existing participant pipeline, tool loop, approval
 *      flow, and loop-safety.
 *   4. Read back the last assistant response from the ephemeral session and
 *      extract its text.
 *   5. `purgeEphemeralSession(handle)` — drops scratch state. The parent
 *      session is untouched throughout.
 *   6. Decrement `_subagentDepth`.
 *
 * Failure modes:
 *   - Missing parent session id → throws; SubagentSpawner records failure.
 *   - sendRequest rejects → error propagates; SubagentSpawner records
 *     failed/timeout status.
 *   - Empty assistant response → returns an empty string; the spawner
 *     treats "no announce" when result is falsy.
 */
export function createSubagentTurnExecutor(
  opts: ICreateSubagentTurnExecutorOpts,
): SubagentTurnExecutor {
  return async (task: string, model: string | null): Promise<string> => {
    const parentId = opts.getParentSessionId();
    if (!parentId) {
      throw new Error('SubagentTurnExecutor: no active parent session');
    }

    const seed: IEphemeralSessionSeed = {
      firstUserMessage: task,
    };

    const handle = opts.chatService.createEphemeralSession(parentId, seed);
    _subagentDepth += 1;
    // Tag this ephemeral session as subagent-originated so the permission
    // gate routes requires-approval tool calls to the autonomy log under
    // `origin: 'subagent'` instead of awaiting a UI dialog. Cleared in
    // `finally`.
    const subagentAutonomy = opts.getAutonomyLevel?.();
    opts.permissionService?.markSubagentSession(handle.sessionId, subagentAutonomy);
    try {
      const sendOptions = opts.buildSendOptions?.(task, model);
      await opts.chatService.sendRequest(handle.sessionId, task, sendOptions);

      const session = opts.chatService.getSession(handle.sessionId);
      if (!session || session.messages.length === 0) {
        return '';
      }
      const lastPair = session.messages[session.messages.length - 1];
      return extractFinalAssistantText(lastPair.response.parts);
    } finally {
      _subagentDepth = Math.max(0, _subagentDepth - 1);
      opts.permissionService?.unmarkSubagentSession(handle.sessionId);
      // Always purge — even on error — so scratch state doesn't leak.
      opts.chatService.purgeEphemeralSession(handle);
    }
  };
}

// ---------------------------------------------------------------------------
// Announcer factory
// ---------------------------------------------------------------------------

export interface ICreateSubagentAnnouncerOpts {
  readonly surfaceRouter: ISubagentAnnouncerRouter;
  readonly getParentSessionId: () => string | undefined;
}

/**
 * Build a {@link SubagentAnnouncer} that routes the subagent's final
 * response through the surface router (chat plugin), stamped with
 * `ORIGIN_SUBAGENT` and `metadata.subagentResult = true`. The chat UI (or a
 * future card renderer) can then surface it as a distinct bubble / card.
 *
 * Announcement is a delivery, not a chat append: per §6.5 the tool result
 * itself carries the final text back to the caller, and the chat UI already
 * renders tool-invocation results as cards. The surface delivery is for
 * observability + feedback-loop origin tagging.
 */
export function createSubagentAnnouncer(
  opts: ICreateSubagentAnnouncerOpts,
): SubagentAnnouncer {
  return async (run: ISubagentRun, result: string): Promise<void> => {
    const parentId = opts.getParentSessionId();
    await opts.surfaceRouter.sendWithOrigin(
      {
        surfaceId: SURFACE_CHAT,
        contentType: 'text',
        content: result,
        metadata: {
          subagentResult: true,
          runId: run.id,
          label: run.label,
          task: run.task,
          parentSessionId: parentId,
          durationMs: (run.completedAt ?? Date.now()) - run.spawnedAt,
        },
      },
      ORIGIN_SUBAGENT,
    );
  };
}
