// serviceTypes.ts — service interface definitions

import { ServiceIdentifier, createServiceIdentifier } from '../platform/types.js';
import { IDisposable } from '../platform/lifecycle.js';
import { Event } from '../platform/events.js';

// ─── ILifecycleService ───────────────────────────────────────────────────────

/**
 * Provides workbench lifecycle phase tracking and hooks.
 */
export interface ILifecycleService extends IDisposable {
  readonly phase: number | undefined;
  hasReachedPhase(phase: number): boolean;
  onStartup(phase: number, hook: () => void | Promise<void>): IDisposable;
  onTeardown(phase: number, hook: () => void | Promise<void>): IDisposable;
  startup(): Promise<void>;
  teardown(): Promise<void>;
}

export const ILifecycleService = createServiceIdentifier<ILifecycleService>('ILifecycleService');

// ─── ILayoutService ──────────────────────────────────────────────────────────

/**
 * Manages overall workbench layout.
 */
export interface ILayoutService extends IDisposable {
  readonly container: HTMLElement | undefined;
  layout(): void;
}

export const ILayoutService = createServiceIdentifier<ILayoutService>('ILayoutService');

// ─── IViewService ────────────────────────────────────────────────────────────

/**
 * Manages view lifecycle and placement.
 */
export interface IViewService extends IDisposable {
  // Will be expanded in Capability 4
}

export const IViewService = createServiceIdentifier<IViewService>('IViewService');

// ─── IWorkspaceService ───────────────────────────────────────────────────────

import type { Workspace } from '../workspace/workspace.js';
import type { WorkspaceState } from '../workspace/workspaceTypes.js';
import type { RecentWorkspaceEntry } from '../workspace/workspaceTypes.js';

/**
 * Manages workspace identity, state persistence, and switching.
 */
export interface IWorkspaceService extends IDisposable {
  /** The currently active workspace (undefined before first load). */
  readonly activeWorkspace: Workspace | undefined;

  /** Whether a workspace has been loaded and restored. */
  readonly isRestored: boolean;

  /** Fires when the active workspace changes (e.g. after a switch). */
  readonly onDidChangeWorkspace: Event<Workspace | undefined>;

  /** Fires after workspace state has been restored. */
  readonly onDidRestoreState: Event<WorkspaceState>;

  /** Explicitly save the current workspace state. */
  save(): Promise<void>;

  /** Request a debounced save (for auto-save). */
  requestSave(): void;

  /** Create a new workspace and optionally switch to it. */
  createWorkspace(name: string, path?: string, switchTo?: boolean): Promise<Workspace>;

  /** Switch to a different workspace by ID. */
  switchWorkspace(workspaceId: string): Promise<void>;

  /** Get the recent workspaces list. */
  getRecentWorkspaces(): Promise<readonly RecentWorkspaceEntry[]>;

  /** Remove a workspace from the recent list. */
  removeRecentWorkspace(workspaceId: string): Promise<void>;
}

export const IWorkspaceService = createServiceIdentifier<IWorkspaceService>('IWorkspaceService');

// ─── IEditorService ──────────────────────────────────────────────────────────

import type { IEditorInput } from '../editor/editorInput.js';
import type { EditorOpenOptions } from '../editor/editorTypes.js';

/**
 * Manages editor opening/closing and active editor tracking.
 */
export interface IEditorService extends IDisposable {
  /** Fires when the active editor changes. */
  readonly onDidActiveEditorChange: Event<IEditorInput | undefined>;

  /** The currently active editor input. */
  readonly activeEditor: IEditorInput | undefined;

  /** Open an editor in the active group (or a specified group). */
  openEditor(input: IEditorInput, options?: EditorOpenOptions, groupId?: string): Promise<void>;

  /** Close the active editor (or a specific one). */
  closeEditor(input?: IEditorInput, groupId?: string, force?: boolean): Promise<boolean>;
}

export const IEditorService = createServiceIdentifier<IEditorService>('IEditorService');

// ─── IEditorGroupService ─────────────────────────────────────────────────────

import type { EditorGroupView } from '../editor/editorGroupView.js';
import type { GroupDirection } from '../editor/editorTypes.js';

/**
 * Manages editor group lifecycle and layout.
 */
export interface IEditorGroupService extends IDisposable {
  /** Fires when the active editor group changes. */
  readonly onDidActiveGroupChange: Event<EditorGroupView>;

  /** Fires when the number of groups changes. */
  readonly onDidGroupCountChange: Event<number>;

  /** The currently active editor group. */
  readonly activeGroup: EditorGroupView | undefined;

  /** All editor groups. */
  readonly groups: EditorGroupView[];

  /** Number of groups. */
  readonly groupCount: number;

  /** Get a group by ID. */
  getGroup(groupId: string): EditorGroupView | undefined;

  /** Split a group in a direction. */
  splitGroup(sourceGroupId: string, direction: GroupDirection): EditorGroupView | undefined;

  /** Remove a group (last group replaced by empty one). */
  removeGroup(groupId: string): void;

  /** Activate a group by ID. */
  activateGroup(groupId: string): void;
}

export const IEditorGroupService = createServiceIdentifier<IEditorGroupService>('IEditorGroupService');

// ─── ICommandService ─────────────────────────────────────────────────────────

import type {
  CommandDescriptor,
  CommandExecutedEvent,
  CommandRegisteredEvent,
  CommandUnregisteredEvent,
  ICommandServiceShape,
} from '../commands/commandTypes.js';

/**
 * Registers and executes commands.
 * Re-exports ICommandServiceShape so consumers import from serviceTypes.
 */
export interface ICommandService extends ICommandServiceShape {}

export const ICommandService = createServiceIdentifier<ICommandService>('ICommandService');

// ─── IContextKeyService ──────────────────────────────────────────────────────

import type { ContextKeyChangeEvent, ContextKeyValue, IContextKey } from '../context/contextKey.js';
import type { ContextKeyLookup } from '../context/whenClause.js';

/**
 * Manages context keys and when-clause evaluation.
 */
export interface IContextKeyService extends IDisposable {
  /** Fires when any context key value changes. */
  readonly onDidChangeContext: Event<ContextKeyChangeEvent>;

  /** Create a scoped context (part or view level). */
  createScope(scopeId: string, parentId?: string): IDisposable;

  /** Create a typed handle to a context key. */
  createKey<T extends ContextKeyValue>(key: string, defaultValue: T, scopeId?: string): IContextKey<T>;

  /** Set a context key value in the global scope. */
  setContext(key: string, value: ContextKeyValue): void;

  /** Set a context key value in a specific scope. */
  setContextInScope(key: string, value: ContextKeyValue, scopeId: string): void;

  /** Get a context key value (with scope inheritance). */
  getContextValue(key: string, scopeId?: string): ContextKeyValue;

  /** Evaluate a when-clause expression against a scope. */
  evaluate(expression: string | undefined, scopeId?: string): boolean;

  /** Check if a command's when-clause is satisfied (global scope). */
  contextMatchesRules(whenClause: string | undefined): boolean;

  /** Create a lookup function for a scope. */
  createLookup(scopeId?: string): ContextKeyLookup;
}

export const IContextKeyService = createServiceIdentifier<IContextKeyService>('IContextKeyService');

// ─── IToolRegistryService ────────────────────────────────────────────────────

import type { IToolDescription } from '../tools/toolManifest.js';
import type { IToolEntry, ToolRegisteredEvent, ToolStateChangedEvent, ToolState, ContributionPoint } from '../tools/toolRegistry.js';

/**
 * Service interface for the central tool registry.
 */
export interface IToolRegistryService extends IDisposable {
  /** Fires when a new tool is registered. */
  readonly onDidRegisterTool: Event<ToolRegisteredEvent>;
  /** Fires when a tool's lifecycle state changes. */
  readonly onDidChangeToolState: Event<ToolStateChangedEvent>;

  /** Register a validated tool description. */
  register(description: IToolDescription): void;
  /** Transition a tool to a new state. */
  setToolState(toolId: string, newState: ToolState): void;
  /** Remove a tool from the registry. */
  unregister(toolId: string): void;

  /** Get all registered tool entries. */
  getAll(): readonly IToolEntry[];
  /** Get a tool entry by manifest ID. */
  getById(toolId: string): IToolEntry | undefined;
  /** Get all tools in a specific state. */
  getByState(state: ToolState): readonly IToolEntry[];
  /** Get all tools contributing to a specific point. */
  getContributorsOf(point: ContributionPoint): readonly IToolEntry[];
  /** Total number of registered tools. */
  readonly count: number;
  /** Check if a tool with the given ID is registered. */
  has(toolId: string): boolean;
}

export const IToolRegistryService = createServiceIdentifier<IToolRegistryService>('IToolRegistryService');

// ─── INotificationService ────────────────────────────────────────────────────

import type { NotificationAction, NotificationSeverity as NotifSeverity, INotification } from '../api/notificationService.js';

/**
 * Service interface for the notification/toast system.
 */
export interface INotificationService extends IDisposable {
  /** Attach the notification container to a parent element. */
  attach(parent: HTMLElement): void;
  /** Show a notification. */
  notify(severity: NotifSeverity, message: string, actions?: readonly NotificationAction[], source?: string, timeoutMs?: number): Promise<NotificationAction | undefined>;
  /** Show an information message. */
  info(message: string, ...actions: NotificationAction[]): Promise<NotificationAction | undefined>;
  /** Show a warning message. */
  warn(message: string, ...actions: NotificationAction[]): Promise<NotificationAction | undefined>;
  /** Show an error message. */
  error(message: string, ...actions: NotificationAction[]): Promise<NotificationAction | undefined>;
  /** Dismiss all notifications. */
  dismissAll(): void;
  /** Fires when a notification is shown. */
  readonly onDidShowNotification: Event<INotification>;
  /** Fires when a notification is closed. */
  readonly onDidCloseNotification: Event<string>;
}

export const INotificationService = createServiceIdentifier<INotificationService>('INotificationService');

// ─── IActivationEventService ─────────────────────────────────────────────────

import type { ActivationRequest, ParsedActivationEvent } from '../tools/activationEventService.js';

/**
 * Service interface for the activation event system.
 */
export interface IActivationEventService extends IDisposable {
  /** Register a tool's activation events. Replays already-fired events. */
  registerToolEvents(toolId: string, activationEvents: readonly string[]): IDisposable;
  /** Mark a tool as activated (prevents duplicate requests). */
  markActivated(toolId: string): void;
  /** Clear a tool's activated status. */
  clearActivated(toolId: string): void;
  /** Signal that shell startup has finished. */
  fireStartupFinished(): void;
  /** Signal that a command was invoked. */
  fireCommand(commandId: string): void;
  /** Signal that a view was shown. */
  fireView(viewId: string): void;
  /** Get all tool IDs listening for a raw event. */
  getToolsForEvent(rawEvent: string): readonly string[];
  /** Check if a tool has been marked as activated. */
  isActivated(toolId: string): boolean;
  /** Whether startup has finished. */
  readonly startupFinished: boolean;
  /** Fires when the system determines a tool should be activated. */
  readonly onActivationRequested: Event<ActivationRequest>;
  /** Fires when any activation event fires (observability). */
  readonly onDidFireEvent: Event<ParsedActivationEvent>;
}

export const IActivationEventService = createServiceIdentifier<IActivationEventService>('IActivationEventService');

// ─── IToolErrorService ───────────────────────────────────────────────────────

import type { ToolError, ToolErrorEvent } from '../tools/toolErrorIsolation.js';

/**
 * Service interface for tool error isolation and reporting.
 */
export interface IToolErrorService extends IDisposable {
  /** Record an error for a tool. */
  recordError(toolId: string, error: unknown, context: string): ToolError;
  /** Wrap a synchronous/async callback in a try/catch attributed to a tool. */
  wrap<TArgs extends unknown[], TReturn>(toolId: string, context: string, fn: (...args: TArgs) => TReturn): (...args: TArgs) => TReturn | undefined;
  /** Wrap an async callback in a try/catch attributed to a tool. */
  wrapAsync<TArgs extends unknown[], TReturn>(toolId: string, context: string, fn: (...args: TArgs) => Promise<TReturn>): (...args: TArgs) => Promise<TReturn | undefined>;
  /** Get all recorded errors for a tool. */
  getToolErrors(toolId: string): readonly ToolError[];
  /** Get the total error count for a tool. */
  getErrorCount(toolId: string): number;
  /** Clear recorded errors for a tool. */
  clearErrors(toolId: string): void;
  /** Fires whenever a tool error is recorded. */
  readonly onDidRecordError: Event<ToolErrorEvent>;
  /** Fires when a tool should be force-deactivated. */
  readonly onShouldForceDeactivate: Event<string>;
}

export const IToolErrorService = createServiceIdentifier<IToolErrorService>('IToolErrorService');

// ─── IToolActivatorService ───────────────────────────────────────────────────

import type { ActivatedTool, ToolActivationEvent } from '../tools/toolActivator.js';

/**
 * Service interface for tool activation and deactivation.
 */
export interface IToolActivatorService extends IDisposable {
  /** Activate a tool by ID. Returns true on success. */
  activate(toolId: string): Promise<boolean>;
  /** Deactivate a tool by ID. Returns true on success. */
  deactivate(toolId: string): Promise<boolean>;
  /** Deactivate all activated tools (teardown). */
  deactivateAll(): Promise<void>;
  /** Get the activated tool record. */
  getActivated(toolId: string): ActivatedTool | undefined;
  /** Get all activated tool IDs. */
  getActivatedToolIds(): readonly string[];
  /** Check if a tool is currently activated. */
  isActivated(toolId: string): boolean;
  /** Fires after a tool has been activated. */
  readonly onDidActivate: Event<ToolActivationEvent>;
  /** Fires after a tool has been deactivated. */
  readonly onDidDeactivate: Event<ToolActivationEvent>;
}

export const IToolActivatorService = createServiceIdentifier<IToolActivatorService>('IToolActivatorService');

// ─── IConfigurationService ───────────────────────────────────────────────────

import type {
  IConfigurationServiceShape,
  IConfigurationChangeEvent,
  IConfigurationPropertySchema,
  IRegisteredConfigurationSection,
  IWorkspaceConfiguration,
} from '../configuration/configurationTypes.js';

/**
 * Service interface for the configuration system (M2 Capability 4).
 */
export interface IConfigurationService extends IConfigurationServiceShape {}

export const IConfigurationService = createServiceIdentifier<IConfigurationService>('IConfigurationService');
