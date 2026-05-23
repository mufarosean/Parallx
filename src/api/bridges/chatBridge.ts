// chatBridge.ts — bridges parallx.chat to IChatAgentService + ILanguageModelToolsService (M9 Cap 8 Task 8.3)
//
// Scopes participant and tool registration to the calling tool.

import { toDisposable } from '../../platform/lifecycle.js';
import type { IDisposable } from '../../platform/lifecycle.js';
import type {
  IChatAgentService,
  IChatParticipant,
  IChatParticipantHandler,
  ILanguageModelToolsService,
  IChatTool,
  ICancellationToken,
  IToolResult,
} from '../../services/chatTypes.js';
import { createBridgeParticipantRuntime } from '../../built-in/chat/utilities/chatBridgeParticipantRuntime.js';
import type { IChatParticipantContributionService } from '../../services/serviceTypes.js';

/**
 * Definition shape accepted by `parallx.chat.registerParticipant` (M82 Slice B).
 * Mirrors VS Code's chat participant registration API.
 */
export interface IRegisterChatParticipantDefinition {
  readonly id: string;
  readonly name?: string;
  readonly fullName?: string;
  readonly description?: string;
  readonly iconPath?: string;
  readonly isSticky?: boolean;
  readonly commands?: readonly { name: string; description?: string }[];
  readonly handler: IChatParticipantHandler;
}

/**
 * Bridge for the `parallx.chat` API namespace.
 * Participant and tool registrations are attributed to the tool for cleanup.
 */
export class ChatBridge {
  private readonly _registrations: IDisposable[] = [];
  private _disposed = false;

  constructor(
    private readonly _toolId: string,
    private readonly _agentService: IChatAgentService,
    private readonly _toolsService: ILanguageModelToolsService | undefined,
    private readonly _subscriptions: IDisposable[],
    /**
     * M82 Slice B — optional. When present, `registerParticipant()` looks up
     * the manifest-declared stub for `definition.id` and wires the real handler
     * in place. When absent or no stub exists, falls back to direct registration.
     */
    private readonly _participantContribution?: IChatParticipantContributionService,
  ) {}

  /**
   * Register a chat participant (M82 Slice B).
   *
   * Two paths:
   *   1. Manifest-declared: if `definition.id` matches a stub registered from
   *      `contributes.chat.participants[]`, swaps in the real handler. The stub's
   *      metadata (displayName/description/commands) is retained from the manifest.
   *   2. Imperative-only: if no stub exists, registers a fresh participant via
   *      `createChatParticipant` with the provided metadata.
   *
   * Returns a disposable. Disposing the manifest-declared path *only* unwires the
   * real handler (reverting to the stub); the stub itself is owned by the
   * contribution processor and is torn down when the tool unregisters.
   */
  registerParticipant(definition: IRegisterChatParticipantDefinition): IDisposable {
    this._throwIfDisposed();
    if (!definition?.id || typeof definition.handler !== 'function') {
      throw new Error('[ChatBridge.registerParticipant] definition.id and handler are required');
    }

    // Path 1: manifest-declared stub exists — wire real handler in place.
    if (this._participantContribution?.hasContributed(definition.id)) {
      const wired = this._participantContribution.wireRealHandler(definition.id, definition.handler);
      if (wired) {
        const disposable = toDisposable(() => {
          // Unwire only — the stub registration belongs to the contribution
          // processor and is disposed when the tool itself is removed.
          this._participantContribution?.wireRealHandler(definition.id, async () => ({}));
        });
        this._registrations.push(disposable);
        this._subscriptions.push(disposable);
        return disposable;
      }
    }

    // Path 2: no manifest stub — register directly.
    const participant = this.createChatParticipant(definition.id, definition.handler);
    if (definition.fullName ?? definition.name) participant.displayName = definition.fullName ?? definition.name ?? definition.id;
    if (definition.description !== undefined) participant.description = definition.description;
    if (definition.iconPath !== undefined) participant.iconPath = definition.iconPath;
    if (definition.commands) participant.commands = definition.commands.map((c) => ({ name: c.name, description: c.description ?? '' }));
    return participant;
  }

  /**
   * Create and register a chat participant.
   *
   * Returns a configurable ChatParticipant object with dispose().
   * The handler is wrapped to attribute requests to the tool.
   */
  createChatParticipant(
    id: string,
    handler: IChatParticipantHandler,
  ): IChatParticipant & { displayName: string; description: string; iconPath?: string; commands: { name: string; description: string }[] } & IDisposable {
    this._throwIfDisposed();

    // Mutable descriptor properties
    let displayName = id;
    let description = '';
    let iconPath: string | undefined;
    let commands: { name: string; description: string }[] = [];
    let participantDisposable: IDisposable | undefined;

    const runtime = createBridgeParticipantRuntime({
      participantId: id,
      handler,
    });

    const wrappedHandler: IChatParticipantHandler = (request, context, response, token) => runtime.handleTurn(request, context, response, token);

    const participant: IChatParticipant = {
      id,
      surface: 'bridge',
      get displayName() { return displayName; },
      get description() { return description; },
      get iconPath() { return iconPath; },
      get commands() { return commands; },
      runtime,
      handler: wrappedHandler,
    };

    participantDisposable = this._agentService.registerAgent(participant);

    const disposable = toDisposable(() => {
      participantDisposable?.dispose();
    });
    this._registrations.push(disposable);
    this._subscriptions.push(disposable);

    // Return a configurable + disposable participant object
    return {
      id,
      surface: 'bridge',
      get displayName() { return displayName; },
      set displayName(v: string) { displayName = v; },
      get description() { return description; },
      set description(v: string) { description = v; },
      get iconPath() { return iconPath; },
      set iconPath(v: string | undefined) { iconPath = v; },
      get commands() { return commands; },
      set commands(v: { name: string; description: string }[]) { commands = v; },
      runtime,
      handler: wrappedHandler,
      dispose: () => disposable.dispose(),
    };
  }

  /**
   * Register a chat tool for Agent mode.
   */
  registerTool(
    name: string,
    tool: {
      description: string;
      parameters: Record<string, unknown>;
      handler: (args: Record<string, unknown>, token: ICancellationToken) => Promise<IToolResult>;
      requiresConfirmation: boolean;
    },
  ): IDisposable {
    this._throwIfDisposed();

    if (!this._toolsService) {
      throw new Error('ILanguageModelToolsService is not available');
    }

    const chatTool: IChatTool = {
      name,
      description: tool.description,
      parameters: tool.parameters,
      handler: tool.handler,
      requiresConfirmation: tool.requiresConfirmation,
      source: 'bridge',
      ownerToolId: this._toolId,
    };

    const disposable = this._toolsService.registerTool(chatTool);
    this._registrations.push(disposable);
    this._subscriptions.push(disposable);
    return disposable;
  }

  /**
   * Dispose all registrations made by this tool.
   */
  dispose(): void {
    this._disposed = true;
    for (const d of this._registrations) {
      d.dispose();
    }
    this._registrations.length = 0;
  }

  private _throwIfDisposed(): void {
    if (this._disposed) {
      throw new Error(`[ChatBridge] tool "${this._toolId}" is disposed`);
    }
  }
}
