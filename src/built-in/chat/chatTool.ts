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
import type { ChatWidget } from './chatWidget.js';
import { createDefaultParticipant } from './participants/defaultParticipant.js';
import {
  ILanguageModelsService,
  IChatService,
  IChatAgentService,
  IChatModeService,
} from '../../services/chatTypes.js';
import type {
  IChatSession,
  IChatMessage,
  IChatRequestOptions,
  IChatResponseChunk,
  IToolDefinition,
} from '../../services/chatTypes.js';
import { IWorkspaceService } from '../../services/serviceTypes.js';
import { IEditorService } from '../../services/serviceTypes.js';

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
    get<T>(id: { readonly id: string }): T;
    has(id: { readonly id: string }): boolean;
  };
}



// ── Module state ──

let _ollamaProvider: OllamaProvider | undefined;
let _activeWidget: ChatWidget | undefined;

// ── Activation ──

export function activate(api: ParallxApi, context: ToolContext): void {

  // ── 1. Retrieve DI services ──

  const languageModelsService = api.services.get<import('../../services/chatTypes.js').ILanguageModelsService>(ILanguageModelsService);
  const chatService = api.services.get<import('../../services/chatTypes.js').IChatService>(IChatService);
  const agentService = api.services.get<import('../../services/chatTypes.js').IChatAgentService>(IChatAgentService);
  const modeService = api.services.get<import('../../services/chatTypes.js').IChatModeService>(IChatModeService);

  // Workspace context services (for mode-aware system prompts)
  const workspaceService = api.services.has(IWorkspaceService)
    ? api.services.get<import('../../services/serviceTypes.js').IWorkspaceService>(IWorkspaceService)
    : undefined;
  const editorService = api.services.has(IEditorService)
    ? api.services.get<import('../../services/serviceTypes.js').IEditorService>(IEditorService)
    : undefined;

  // ── 2. Create OllamaProvider and register with ILanguageModelsService ──

  _ollamaProvider = new OllamaProvider();
  context.subscriptions.push(_ollamaProvider);

  const providerRegistration = languageModelsService.registerProvider(_ollamaProvider);
  context.subscriptions.push(providerRegistration);

  // ── 3. Register the default chat participant with IChatAgentService ──

  const defaultParticipantServices = {
    sendChatRequest(
      messages: readonly IChatMessage[],
      options?: IChatRequestOptions,
      signal?: AbortSignal,
    ): AsyncIterable<IChatResponseChunk> {
      // Use the active model from ILanguageModelsService
      const modelId = languageModelsService.getActiveModel() ?? '';
      return _ollamaProvider!.sendChatRequest(modelId, messages, options, signal);
    },
    getActiveModel(): string | undefined {
      return languageModelsService.getActiveModel();
    },
    // ── Workspace context (Cap 4 — mode-aware system prompts) ──
    getWorkspaceName(): string {
      return workspaceService?.activeWorkspace?.name ?? 'Parallx Workspace';
    },
    async getPageCount(): Promise<number> {
      // Approximate: count sessions in the workspace.
      // A more precise count would query IDatabaseService, but workspace
      // pages aren't tracked by a single count method yet.
      // For now, return 0 if workspace isn't loaded.
      try {
        const ws = workspaceService?.activeWorkspace;
        return ws ? (ws as unknown as { pageCount?: number }).pageCount ?? 0 : 0;
      } catch {
        return 0;
      }
    },
    getCurrentPageTitle(): string | undefined {
      return editorService?.activeEditor?.name;
    },
    getToolDefinitions(): readonly IToolDefinition[] {
      // Tool definitions will be provided by ILanguageModelToolsService (Cap 6).
      // For now, return empty — Agent mode prompt will omit tools section.
      return [];
    },
  };

  const defaultParticipant = createDefaultParticipant(defaultParticipantServices);
  context.subscriptions.push(defaultParticipant);

  const agentRegistration = agentService.registerAgent(defaultParticipant);
  context.subscriptions.push(agentRegistration);

  // ── 4. Build widget services bridge (delegates to IChatService) ──

  const widgetServices: IChatWidgetServices = {
    async sendRequest(sessionId: string, message: string): Promise<void> {
      await chatService.sendRequest(sessionId, message);
    },
    cancelRequest(sessionId: string): void {
      chatService.cancelRequest(sessionId);
    },
    createSession(): IChatSession {
      return chatService.createSession();
    },
    onDidChangeSession: chatService.onDidChangeSession as Event<string>,
    getProviderStatus(): { available: boolean } {
      return { available: _ollamaProvider?.getLastStatus()?.available ?? false };
    },
    onDidChangeProviderStatus: _ollamaProvider.onDidChangeStatus as unknown as Event<void>,
    modelPicker: {
      getModels: () => languageModelsService.getModels(),
      getActiveModel: () => languageModelsService.getActiveModel(),
      setActiveModel: (modelId: string) => languageModelsService.setActiveModel(modelId),
      onDidChangeModels: languageModelsService.onDidChangeModels,
    },
    modePicker: {
      getMode: () => modeService.getMode(),
      setMode: (mode) => modeService.setMode(mode),
      getAvailableModes: () => modeService.getAvailableModes(),
      onDidChangeMode: modeService.onDidChangeMode,
    },
  };

  // ── 5. Register the chat view in the Auxiliary Bar ──

  context.subscriptions.push(
    api.views.registerViewProvider('view.chat', {
      createView(container: HTMLElement): IDisposable {
        const view = createChatView(container, _ollamaProvider!, widgetServices);
        return view;
      },
    }),
  );

  // ── 6. Register chat commands ──

  context.subscriptions.push(
    api.commands.registerCommand('chat.toggle', () => {
      api.commands.executeCommand('workbench.action.toggleAuxiliaryBar');
    }),
  );

  context.subscriptions.push(
    api.commands.registerCommand('chat.newSession', () => {
      // Create a new session and bind it to the active widget
      const session = chatService.createSession();
      if (_activeWidget) {
        _activeWidget.setSession(session);
      }
    }),
  );

  context.subscriptions.push(
    api.commands.registerCommand('chat.clearSession', () => {
      // Delete the current session and create a fresh one
      if (_activeWidget) {
        const currentSession = _activeWidget.getSession();
        if (currentSession) {
          chatService.deleteSession(currentSession.id);
        }
        const newSession = chatService.createSession();
        _activeWidget.setSession(newSession);
      }
    }),
  );

  context.subscriptions.push(
    api.commands.registerCommand('chat.stop', () => {
      // Cancel the in-progress request for the active widget's session
      if (_activeWidget) {
        const session = _activeWidget.getSession();
        if (session) {
          chatService.cancelRequest(session.id);
        }
      }
    }),
  );

  context.subscriptions.push(
    api.commands.registerCommand('chat.focus', () => {
      api.commands.executeCommand('workbench.action.toggleAuxiliaryBar');
      if (_activeWidget) {
        _activeWidget.focus();
      }
    }),
  );

  // ── 7. Set context keys ──

  const chatVisibleKey = api.context.createContextKey('chatVisible', false);
  context.subscriptions.push(chatVisibleKey as unknown as IDisposable);
}

/** Set the active widget reference (called from chatView). */
export function setActiveWidget(widget: ChatWidget | undefined): void {
  _activeWidget = widget;
}

export function deactivate(): void {
  _ollamaProvider = undefined;
  _activeWidget = undefined;
}
