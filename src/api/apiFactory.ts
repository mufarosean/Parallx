// apiFactory.ts — creates a per-tool, scoped API object
//
// The API factory is the composition root of the tool API boundary.
// It creates a fresh, frozen API object for each tool upon activation,
// wiring bridge implementations to internal shell services.
//
// Tools call `parallx.commands.registerCommand(...)` etc. — the factory
// ensures all such calls are scoped to the calling tool and tracked
// for cleanup.

import { IDisposable, toDisposable } from '../platform/lifecycle.js';
import { ServiceCollection } from '../services/serviceCollection.js';
import {
  ICommandService,
  IContextKeyService,
  IEditorService,
} from '../services/serviceTypes.js';
import type { ContextKeyValue } from '../context/contextKey.js';
import type { IToolDescription } from '../tools/toolManifest.js';
import type { ToolRegistry, IToolEntry } from '../tools/toolRegistry.js';
import type { StatusBarPart, StatusBarEntryAccessor } from '../parts/statusBarPart.js';
import { StatusBarAlignment } from '../parts/statusBarPart.js';
import { PARALLX_VERSION } from './apiVersionValidation.js';
import { NotificationService } from './notificationService.js';
import { CommandsBridge } from './bridges/commandsBridge.js';
import { ViewsBridge } from './bridges/viewsBridge.js';
import { WindowBridge } from './bridges/windowBridge.js';
import { ContextBridge } from './bridges/contextBridge.js';
import { WorkspaceBridge } from './bridges/workspaceBridge.js';
import { EditorsBridge } from './bridges/editorsBridge.js';
import type { ViewManager } from '../views/viewManager.js';
import type { ConfigurationService } from '../configuration/configurationService.js';
import type { CommandContributionProcessor } from '../contributions/commandContribution.js';
import type { ViewContributionProcessor } from '../contributions/viewContribution.js';

// ─── API Dependencies ────────────────────────────────────────────────────────

/**
 * Dependencies the factory needs to wire all bridges.
 * Gathered from the DI container and passed in.
 */
export interface ApiFactoryDependencies {
  readonly services: ServiceCollection;
  readonly viewManager: ViewManager;
  readonly toolRegistry: ToolRegistry;
  readonly notificationService: NotificationService;
  readonly workbenchContainer: HTMLElement | undefined;
  readonly configurationService?: ConfigurationService;
  readonly commandContributionProcessor?: CommandContributionProcessor;
  readonly viewContributionProcessor?: ViewContributionProcessor;
  /** ActivityBarPart badge host for parallx.views.setBadge(). */
  readonly badgeHost?: { setBadge(iconId: string, badge: { count?: number; dot?: boolean } | undefined): void };
  /** StatusBarPart for parallx.window.createStatusBarItem(). */
  readonly statusBarPart?: StatusBarPart;
}

// ─── API Shape ───────────────────────────────────────────────────────────────

/**
 * The shape of the frozen API object given to each tool.
 * Matches the public `parallx` namespace from parallx.d.ts.
 */
export interface ParallxApiObject {
  readonly views: {
    registerViewProvider(viewId: string, provider: { createView(container: HTMLElement): IDisposable }, options?: { name?: string; icon?: string; defaultContainerId?: string; when?: string }): IDisposable;
    setBadge(containerId: string, badge: { count?: number; dot?: boolean } | undefined): void;
  };
  readonly commands: {
    registerCommand(id: string, handler: (...args: unknown[]) => unknown | Promise<unknown>): IDisposable;
    executeCommand<T = unknown>(id: string, ...args: unknown[]): Promise<T>;
    getCommands(): Promise<string[]>;
  };
  readonly window: {
    showInformationMessage(message: string, ...actions: { title: string; isCloseAffordance?: boolean }[]): Promise<{ title: string } | undefined>;
    showWarningMessage(message: string, ...actions: { title: string; isCloseAffordance?: boolean }[]): Promise<{ title: string } | undefined>;
    showErrorMessage(message: string, ...actions: { title: string; isCloseAffordance?: boolean }[]): Promise<{ title: string } | undefined>;
    showInputBox(options?: { prompt?: string; value?: string; placeholder?: string; password?: boolean }): Promise<string | undefined>;
    showQuickPick(items: readonly { label: string; description?: string }[], options?: { placeholder?: string; canPickMany?: boolean }): Promise<any>;
    createOutputChannel(name: string): IDisposable & { name: string; append(v: string): void; appendLine(v: string): void; clear(): void; show(): void; hide(): void };
    createStatusBarItem(alignment?: number, priority?: number): {
      alignment: number; priority: number;
      text: string; tooltip: string | undefined; command: string | undefined; name: string | undefined;
      show(): void; hide(): void; dispose(): void;
    };
  };
  readonly context: {
    createContextKey<T extends ContextKeyValue>(name: string, defaultValue: T): { key: string; get(): T; set(value: T): void; reset(): void };
    getContextValue(name: string): ContextKeyValue;
  };
  readonly workspace: {
    getConfiguration(section?: string): { get<T>(key: string, defaultValue?: T): T | undefined; has(key: string): boolean };
    readonly onDidChangeConfiguration: (listener: (e: { affectsConfiguration(section: string): boolean }) => void) => IDisposable;
  };
  readonly editors: {
    registerEditorProvider(typeId: string, provider: { createEditorPane(container: HTMLElement): IDisposable }): IDisposable;
    openEditor(options: { typeId: string; title: string; icon?: string; instanceId?: string }): Promise<void>;
  };
  readonly tools: {
    getAll(): { id: string; name: string; version: string; publisher: string; description: string; isBuiltin: boolean; toolPath: string }[];
    getById(id: string): { id: string; name: string; version: string; publisher: string; description: string; isBuiltin: boolean; toolPath: string } | undefined;
  };
  readonly env: {
    readonly appName: string;
    readonly appVersion: string;
    readonly toolPath: string;
  };
}

// ─── API Factory ─────────────────────────────────────────────────────────────

/**
 * Create a fresh, scoped, frozen API object for a tool.
 *
 * Every method is bound to the tool's ID and tracked for cleanup.
 * The returned object is `Object.freeze()`d to prevent monkey-patching.
 *
 * @param toolDescription The validated tool description.
 * @param deps Shell service dependencies.
 * @returns The frozen API object and a dispose function that cleans up all bridges.
 */
export function createToolApi(
  toolDescription: IToolDescription,
  deps: ApiFactoryDependencies,
): { api: ParallxApiObject; dispose: () => void } {
  const toolId = toolDescription.manifest.id;
  const subscriptions: IDisposable[] = [];

  // ── Resolve services ──
  const commandService = deps.services.has(ICommandService)
    ? deps.services.get(ICommandService)
    : undefined;

  const contextKeyService = deps.services.has(IContextKeyService)
    ? deps.services.get(IContextKeyService)
    : undefined;

  const editorService = deps.services.has(IEditorService)
    ? deps.services.get(IEditorService)
    : undefined;

  // ── Create bridges ──
  const commandsBridge = commandService
    ? new CommandsBridge(toolId, commandService as any, subscriptions, deps.commandContributionProcessor)
    : undefined;

  const viewsBridge = new ViewsBridge(toolId, deps.viewManager, subscriptions, deps.viewContributionProcessor, deps.badgeHost);

  const windowBridge = new WindowBridge(
    toolId,
    deps.notificationService,
    deps.workbenchContainer,
    subscriptions,
  );

  const contextBridge = contextKeyService
    ? new ContextBridge(toolId, contextKeyService, subscriptions)
    : undefined;

  const workspaceBridge = new WorkspaceBridge(toolId, subscriptions, deps.configurationService);

  const editorsBridge = new EditorsBridge(toolId, editorService, subscriptions);

  // ── Build API object ──
  const api: ParallxApiObject = {
    views: Object.freeze({
      registerViewProvider: (viewId, provider, options) =>
        viewsBridge.registerViewProvider(viewId, provider, options),
      setBadge: (containerId, badge) =>
        viewsBridge.setBadge(containerId, badge),
    }),

    commands: Object.freeze({
      registerCommand: (id, handler) => {
        if (!commandsBridge) throw new Error('CommandService not available');
        return commandsBridge.registerCommand(id, handler);
      },
      executeCommand: <T = unknown>(id: string, ...args: unknown[]) => {
        if (!commandsBridge) throw new Error('CommandService not available');
        return commandsBridge.executeCommand<T>(id, ...args);
      },
      getCommands: () => {
        if (!commandsBridge) throw new Error('CommandService not available');
        return commandsBridge.getCommands();
      },
    }),

    window: Object.freeze({
      showInformationMessage: (msg, ...actions) => windowBridge.showInformationMessage(msg, ...actions),
      showWarningMessage: (msg, ...actions) => windowBridge.showWarningMessage(msg, ...actions),
      showErrorMessage: (msg, ...actions) => windowBridge.showErrorMessage(msg, ...actions),
      showInputBox: (options) => windowBridge.showInputBox(options),
      showQuickPick: (items, options) => windowBridge.showQuickPick(items, options),
      createOutputChannel: (name) => windowBridge.createOutputChannel(name),
      createStatusBarItem: (alignment?: number, priority?: number) => {
        const sbPart = deps.statusBarPart;
        // Map public enum (1=Left, 2=Right) to internal enum.
        const internalAlignment = alignment === 2
          ? StatusBarAlignment.Right
          : StatusBarAlignment.Left;
        const prio = priority ?? 0;
        const itemId = `${toolId}.statusbar.${Date.now()}.${Math.random().toString(36).slice(2, 6)}`;

        let _text = '';
        let _tooltip: string | undefined;
        let _command: string | undefined;
        let _name: string | undefined;
        let _visible = false;
        let _accessor: StatusBarEntryAccessor | undefined;

        const item = {
          get alignment() { return alignment === 2 ? 2 : 1; },
          get priority() { return prio; },
          get text() { return _text; },
          set text(v: string) {
            _text = v;
            if (_visible && _accessor) _accessor.update({ text: v });
          },
          get tooltip() { return _tooltip; },
          set tooltip(v: string | undefined) {
            _tooltip = v;
            if (_visible && _accessor) _accessor.update({ tooltip: v });
          },
          get command() { return _command; },
          set command(v: string | undefined) {
            _command = v;
            if (_visible && _accessor) _accessor.update({ command: v });
          },
          get name() { return _name; },
          set name(v: string | undefined) { _name = v; },
          show() {
            if (_visible || !sbPart) return;
            _visible = true;
            _accessor = sbPart.addEntry({
              id: itemId,
              text: _text,
              alignment: internalAlignment,
              priority: prio,
              tooltip: _tooltip,
              command: _command,
              name: _name,
            });
            subscriptions.push(_accessor);
          },
          hide() {
            if (!_visible || !_accessor) return;
            _visible = false;
            _accessor.dispose();
            _accessor = undefined;
          },
          dispose() {
            item.hide();
          },
        };
        return item;
      },
    }),

    context: Object.freeze({
      createContextKey: (name, defaultValue) => {
        if (!contextBridge) throw new Error('ContextKeyService not available');
        return contextBridge.createContextKey(name, defaultValue);
      },
      getContextValue: (name) => {
        if (!contextBridge) throw new Error('ContextKeyService not available');
        return contextBridge.getContextValue(name);
      },
    }),

    workspace: Object.freeze({
      getConfiguration: (section) => workspaceBridge.getConfiguration(section),
      onDidChangeConfiguration: workspaceBridge.onDidChangeConfiguration,
    }),

    editors: Object.freeze({
      registerEditorProvider: (typeId, provider) => editorsBridge.registerEditorProvider(typeId, provider),
      openEditor: (options) => editorsBridge.openEditor(options),
    }),

    tools: Object.freeze({
      getAll: () => _toolEntriesToInfo(deps.toolRegistry.getAll()),
      getById: (id) => {
        const entry = deps.toolRegistry.getById(id);
        return entry ? _toolEntryToInfo(entry) : undefined;
      },
    }),

    env: Object.freeze({
      appName: 'Parallx',
      appVersion: PARALLX_VERSION,
      toolPath: toolDescription.toolPath,
    }),
  };

  // Freeze the top-level API object
  Object.freeze(api);

  // ── Dispose function ──
  const dispose = (): void => {
    commandsBridge?.dispose();
    viewsBridge.dispose();
    windowBridge.dispose();
    contextBridge?.dispose();
    workspaceBridge.dispose();
    editorsBridge.dispose();

    // Dispose all tracked subscriptions
    for (const s of subscriptions) {
      try { s.dispose(); } catch { /* best-effort */ }
    }
    subscriptions.length = 0;
  };

  return { api, dispose };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function _toolEntriesToInfo(entries: readonly IToolEntry[]): Array<{
  id: string; name: string; version: string; publisher: string;
  description: string; isBuiltin: boolean; toolPath: string;
}> {
  return entries.map(_toolEntryToInfo);
}

function _toolEntryToInfo(entry: IToolEntry): {
  id: string; name: string; version: string; publisher: string;
  description: string; isBuiltin: boolean; toolPath: string;
} {
  const m = entry.description.manifest;
  return {
    id: m.id,
    name: m.name,
    version: m.version,
    publisher: m.publisher,
    description: m.description ?? '',
    isBuiltin: entry.description.isBuiltin,
    toolPath: entry.description.toolPath,
  };
}
