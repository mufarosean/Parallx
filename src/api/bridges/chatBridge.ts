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
  ) {}

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
