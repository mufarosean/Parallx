// chatAgentService.ts — IChatAgentService implementation (M9 Task 2.2)
//
// Participant (agent) registry and request dispatch.
// Built-in and tool-contributed participants use identical registration.
//
// VS Code reference:
//   src/vs/workbench/contrib/chat/common/chatAgents.ts

import { Disposable, toDisposable } from '../platform/lifecycle.js';
import { Emitter } from '../platform/events.js';
import type { IDisposable } from '../platform/lifecycle.js';
import type { Event } from '../platform/events.js';
import type {
  IChatAgentService,
  IChatParticipant,
  IChatParticipantRequest,
  IChatParticipantContext,
  IChatResponseStream,
  IChatParticipantResult,
  ICancellationToken,
} from './chatTypes.js';
import { buildParticipantRuntimeTrace } from '../built-in/chat/utilities/chatParticipantRuntimeTrace.js';

/** Default participant ID — handles messages with no @mention. */
const DEFAULT_AGENT_ID = 'parallx.chat.default';

/**
 * Chat agent service — participant registry and dispatch.
 *
 * Agents (the service-layer name) map 1:1 to participants (the API-layer name).
 * VS Code separates these terms the same way.
 */
export class ChatAgentService extends Disposable implements IChatAgentService {

  private readonly _agents = new Map<string, IChatParticipant>();

  private _resolveAgent(participantId: string): IChatParticipant | undefined {
    const direct = this._agents.get(participantId);
    if (direct) {
      return direct;
    }

    if (!participantId.includes('.')) {
      const builtInId = `parallx.chat.${participantId}`;
      const builtIn = this._agents.get(builtInId);
      if (builtIn) {
        return builtIn;
      }
    }

    const normalized = participantId.trim().toLowerCase();
    for (const agent of this._agents.values()) {
      if (agent.displayName.trim().toLowerCase() === normalized) {
        return agent;
      }
    }

    return undefined;
  }

  // ── Events ──

  private readonly _onDidChangeAgents = this._register(new Emitter<void>());
  readonly onDidChangeAgents: Event<void> = this._onDidChangeAgents.event;

  // ── Registration ──

  registerAgent(participant: IChatParticipant): IDisposable {
    if (this._agents.has(participant.id)) {
      throw new Error(`Chat participant '${participant.id}' is already registered.`);
    }

    this._agents.set(participant.id, participant);
    this._onDidChangeAgents.fire();

    return toDisposable(() => {
      this._agents.delete(participant.id);
      this._onDidChangeAgents.fire();
    });
  }

  // ── Lookup ──

  getAgents(): readonly IChatParticipant[] {
    return [...this._agents.values()];
  }

  getAgent(id: string): IChatParticipant | undefined {
    return this._resolveAgent(id);
  }

  getDefaultAgent(): IChatParticipant | undefined {
    return this._agents.get(DEFAULT_AGENT_ID);
  }

  // ── Dispatch ──

  async invokeAgent(
    participantId: string,
    request: IChatParticipantRequest,
    context: IChatParticipantContext,
    response: IChatResponseStream,
    token: ICancellationToken,
  ): Promise<IChatParticipantResult> {
    const agent = this._resolveAgent(participantId);
    if (!agent) {
      // Fallback to default agent
      const defaultAgent = this.getDefaultAgent();
      if (!defaultAgent) {
        throw new Error(`Chat participant '${participantId}' not found and no default agent available.`);
      }
      return this._safeInvoke(defaultAgent, request, context, response, token);
    }

    return this._safeInvoke(agent, request, context, response, token);
  }

  /**
   * Safely invoke an agent handler, catching errors and converting them
   * to error content parts rather than crashing the chat session.
   */
  private async _safeInvoke(
    agent: IChatParticipant,
    request: IChatParticipantRequest,
    context: IChatParticipantContext,
    response: IChatResponseStream,
    token: ICancellationToken,
  ): Promise<IChatParticipantResult> {
    try {
      if (agent.runtime) {
        return await agent.runtime.handleTurn(request, context, response, token);
      }
      return await agent.handler(request, context, response, token);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[ChatAgentService] Agent '${agent.id}' handler error:`, err);

      const failureTrace = buildParticipantRuntimeTrace(request, context, {
        phase: 'execution',
        checkpoint: 'participant-handler-error',
        runState: 'failed',
        note: message,
      });
      if (failureTrace) {
        context.runtime?.reportTrace?.(failureTrace);
      }

      // Write error to the response stream so the user sees it
      try {
        response.warning(`An error occurred: ${message}`);
      } catch {
        // Stream may already be closed — ignore
      }

      return {
        errorDetails: {
          message,
          responseIsIncomplete: true,
        },
      };
    }
  }
}
