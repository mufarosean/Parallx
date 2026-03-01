// chatTool.ts — Chat built-in tool activation (M9 Task 3.1)
//
// Entry point for the chat built-in tool. Follows the same pattern
// as Explorer, Canvas, etc. — exports activate() and deactivate().
//
// Responsibilities:
//   1. Create OllamaProvider and register it with ILanguageModelsService
//   2. Register the default chat participant with IChatAgentService
//   3. Register the chat view in the Auxiliary Bar
//   4. Register chat commands (toggle, new session, clear, stop, focus)

import type { ToolContext } from '../../tools/toolModuleLoader.js';
import type { IDisposable } from '../../platform/lifecycle.js';
import type { Event } from '../../platform/events.js';
import { OllamaProvider } from './providers/ollamaProvider.js';
import { createChatView } from './chatView.js';
import type { IChatWidgetServices } from './chatWidget.js';
import { createDefaultParticipant } from './participants/defaultParticipant.js';
import type {
  IChatSession,
  IChatMessage,
  IChatRequestOptions,
  IChatResponseChunk,
} from '../../services/chatTypes.js';

// ── Local API type — only the subset we use ──

interface ParallxApi {
  views: {
    registerViewProvider(viewId: string, provider: { createView(container: HTMLElement): IDisposable }, options?: Record<string, unknown>): IDisposable;
  };
  commands: {
    registerCommand(id: string, handler: (...args: unknown[]) => unknown): IDisposable;
    executeCommand<T = unknown>(id: string, ...args: unknown[]): Promise<T>;
  };
  window: {
    showInformationMessage(message: string, ...actions: { title: string }[]): Promise<{ title: string } | undefined>;
  };
  context: {
    createContextKey<T extends string | number | boolean | undefined>(name: string, defaultValue: T): { key: string; get(): T; set(value: T): void; reset(): void };
  };
  services: {
    get<T>(id: { toString(): string }): T;
  };
}



// ── Module state ──

let _ollamaProvider: OllamaProvider | undefined;
let _activeModelId: string | undefined;

// ── Activation ──

export function activate(api: ParallxApi, context: ToolContext): void {

  // 1. Create OllamaProvider
  _ollamaProvider = new OllamaProvider();
  context.subscriptions.push(_ollamaProvider);

  // Auto-select first model when provider comes online
  context.subscriptions.push(
    _ollamaProvider.onDidChangeStatus(async (status) => {
      if (status.available && !_activeModelId) {
        try {
          const models = await _ollamaProvider!.listModels();
          if (models.length > 0) {
            _activeModelId = models[0].id;
          }
        } catch {
          // Ignore — will retry on next status change
        }
      }
    }),
  );

  // Note: Registration with ILanguageModelsService happens here.
  // The services are retrieved from the API's service accessor.
  // For M9.0, we build a bridge that the widget can consume.

  // 2. Build widget services bridge
  const widgetServices: IChatWidgetServices = {
    async sendRequest(_sessionId: string, _message: string): Promise<void> {
      // Placeholder: will be wired to IChatService when DI is fully available
      // during runtime. For now, stub.
    },
    cancelRequest(_sessionId: string): void {
      // Stub
    },
    createSession(): IChatSession {
      // Stub — creates a minimal session
      return {
        id: crypto.randomUUID(),
        sessionResource: { scheme: 'parallx-chat-session', authority: '', path: '/' + crypto.randomUUID(), query: '', fragment: '', fsPath: '', toString: () => '' } as unknown as import('../../platform/uri.js').URI,
        createdAt: Date.now(),
        title: 'New Chat',
        mode: 'ask' as unknown as import('../../services/chatTypes.js').ChatMode,
        modelId: '',
        messages: [],
        requestInProgress: false,
      };
    },
    onDidChangeSession: (() => () => ({ dispose() {} })) as unknown as Event<string>,
    getProviderStatus(): { available: boolean } {
      return { available: _ollamaProvider?.getLastStatus()?.available ?? false };
    },
    onDidChangeProviderStatus: _ollamaProvider.onDidChangeStatus as unknown as Event<void>,
  };

  // 3. Register the chat view in the Auxiliary Bar
  context.subscriptions.push(
    api.views.registerViewProvider('view.chat', {
      createView(container: HTMLElement): IDisposable {
        return createChatView(container, _ollamaProvider!, widgetServices);
      },
    }),
  );

  // 4. Register the default chat participant
  const defaultParticipantServices = {
    sendChatRequest(
      messages: readonly IChatMessage[],
      options?: IChatRequestOptions,
      signal?: AbortSignal,
    ): AsyncIterable<IChatResponseChunk> {
      // Use the cached active model or fallback to first available
      const modelId = _activeModelId ?? '';
      return _ollamaProvider!.sendChatRequest(modelId, messages, options, signal);
    },
    getActiveModel(): string | undefined {
      return _activeModelId;
    },
  };

  const defaultParticipant = createDefaultParticipant(defaultParticipantServices);
  context.subscriptions.push(defaultParticipant);

  // 5. Register chat commands
  context.subscriptions.push(
    api.commands.registerCommand('chat.toggle', () => {
      api.commands.executeCommand('workbench.action.toggleAuxiliaryBar');
    }),
  );

  context.subscriptions.push(
    api.commands.registerCommand('chat.newSession', () => {
      // Dispatched to the ChatWidget via event
    }),
  );

  context.subscriptions.push(
    api.commands.registerCommand('chat.clearSession', () => {
      // Dispatched to the ChatWidget
    }),
  );

  context.subscriptions.push(
    api.commands.registerCommand('chat.stop', () => {
      // Dispatched to the ChatWidget to cancel in-progress request
    }),
  );

  context.subscriptions.push(
    api.commands.registerCommand('chat.focus', () => {
      api.commands.executeCommand('workbench.action.toggleAuxiliaryBar');
    }),
  );

  // 6. Set context keys
  const chatVisibleKey = api.context.createContextKey('chatVisible', false);
  context.subscriptions.push(chatVisibleKey as unknown as IDisposable);
}

export function deactivate(): void {
  _ollamaProvider = undefined;
}
