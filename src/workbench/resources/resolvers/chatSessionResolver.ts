// chatSessionResolver.ts — Built-in chat-session Resource resolver (Slice A8)
//
// Resolves a `ChatSessionResource` to its session record via a minimal
// session-source interface. The resolver does NOT couple to the concrete
// chat agent runtime (which is OFF-LIMITS per the manifest). Callers
// supply any object that satisfies `ChatSessionSource`, keeping the
// resolver tier-0 testable and the off-limits boundary intact.
//
// Pure-additive: not wired into IResourceRegistry yet.

import type { ChatSessionResource } from '../resource.js';
import type { ResourceResolver } from '../resourceRegistry.js';

/** Minimum surface required to resolve a chat session. */
export interface ChatSessionSource {
  /** Returns the canonical session record for `sessionId`, or undefined if not found. */
  getSession(sessionId: string): Promise<unknown> | unknown;
}

export interface ChatSessionResolveResult {
  readonly resource: ChatSessionResource;
  readonly session: unknown;
}

export class ChatSessionResourceResolver implements ResourceResolver<ChatSessionResource, ChatSessionResolveResult> {
  readonly type = 'chat-session' as const;

  constructor(private readonly _source: ChatSessionSource) {}

  async resolve(resource: ChatSessionResource): Promise<ChatSessionResolveResult> {
    if (!resource.sessionId) {
      throw new Error('[ChatSessionResourceResolver] ChatSessionResource.sessionId is empty');
    }
    const session = await Promise.resolve(this._source.getSession(resource.sessionId));
    if (session === undefined || session === null) {
      throw new Error(`[ChatSessionResourceResolver] session not found: ${resource.sessionId}`);
    }
    return { resource, session };
  }
}

export function chatSessionResourceResolver(source: ChatSessionSource): ChatSessionResourceResolver {
  return new ChatSessionResourceResolver(source);
}
