// serviceTypes.ts — service interface definitions

import { createServiceIdentifier } from '../platform/types.js';
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
 * Event fired when a part's visibility changes.
 * VS Code reference: IPartVisibilityChangeEvent in layoutService.ts
 */
export interface PartVisibilityChangeEvent {
  readonly partId: string;
  readonly visible: boolean;
}

/**
 * Manages overall workbench layout.
 * VS Code reference: IWorkbenchLayoutService (src/vs/workbench/services/layout/browser/layoutService.ts)
 */
export interface ILayoutService extends IDisposable {
  readonly container: HTMLElement | undefined;
  layout(): void;

  /**
   * Returns whether the given part is currently visible.
   * VS Code reference: isVisible(part: Parts): boolean
   */
  isVisible(partId: string): boolean;

  /**
   * Show or hide a workbench part.
   * VS Code reference: setPartHidden(hidden: boolean, part: Parts): void
   */
  setPartHidden(hidden: boolean, partId: string): void;

  /**
   * Fires when any part's visibility changes.
   * VS Code reference: onDidChangePartVisibility
   */
  readonly onDidChangePartVisibility: Event<PartVisibilityChangeEvent>;
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
import type { WorkspaceState, WorkbenchState, WorkspaceFolder, WorkspaceFoldersChangeEvent } from '../workspace/workspaceTypes.js';
import type { RecentWorkspaceEntry } from '../workspace/workspaceTypes.js';

/**
 * Manages workspace identity, state persistence, switching, and folder model.
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

  // ── Folder Model (M4 Cap 2) ──

  /** The open workspace folders. Empty array if no folders open. */
  readonly folders: readonly WorkspaceFolder[];

  /** Current workbench state (EMPTY, FOLDER, WORKSPACE). */
  readonly workbenchState: WorkbenchState;

  /** Fires when workspace folders change. */
  readonly onDidChangeFolders: Event<WorkspaceFoldersChangeEvent>;

  /** Fires when workbench state changes (e.g., EMPTY → FOLDER). */
  readonly onDidChangeWorkbenchState: Event<WorkbenchState>;

  /** Add a folder to the workspace. */
  addFolder(uri: import('../platform/uri.js').URI, name?: string): void;

  /** Remove a folder from the workspace. */
  removeFolder(uri: import('../platform/uri.js').URI): void;

  /**
   * Atomically replace all workspace folders.
   *
   * Mirrors VS Code's `updateFolders(foldersToAdd, foldersToRemove)` pattern:
   * fires a **single** `onDidChangeFolders` event so that listeners never see
   * an intermediate zero-folder state.
   */
  updateFolders(foldersToAdd: { uri: import('../platform/uri.js').URI; name?: string }[]): void;

  /** Get the workspace folder containing the given URI. */
  getWorkspaceFolder(uri: import('../platform/uri.js').URI): WorkspaceFolder | undefined;

  /** Workspace display name (first folder name or workspace identity name). */
  readonly workspaceName: string;
}

export const IWorkspaceService = createServiceIdentifier<IWorkspaceService>('IWorkspaceService');

// ─── IWorkspaceBoundaryService ───────────────────────────────────────────────

import type { URI } from '../platform/uri.js';

/**
 * Centralized workspace boundary policy service.
 *
 * Enforces that file URI access stays within explicitly attached workspace
 * folders unless explicitly allowlisted by future policy extensions.
 */
export interface IWorkspaceBoundaryService extends IDisposable {
  /** Set the host providing folder access. */
  setHost(host: { readonly folders: readonly WorkspaceFolder[] }): void;

  /** Returns the current workspace folders. */
  readonly folders: readonly WorkspaceFolder[];

  /** Returns true if the URI is within the workspace folder tree. */
  isUriWithinWorkspace(uri: URI): boolean;

  /** Throws if the URI is not within the workspace folder tree. */
  assertUriWithinWorkspace(uri: URI, requester: string): void;
}

export const IWorkspaceBoundaryService = createServiceIdentifier<IWorkspaceBoundaryService>('IWorkspaceBoundaryService');

// ─── IDatabaseService ────────────────────────────────────────────────────────

/**
 * Service providing SQLite database access via IPC to the main process.
 * Database is scoped to the active workspace folder.
 */
export interface IDatabaseService extends IDisposable {
  /** Whether a database is currently open. */
  readonly isOpen: boolean;

  /** The path to the currently open database, or null. */
  readonly currentPath: string | null;

  /** Fires after a database is opened (payload: dbPath). */
  readonly onDidOpen: Event<string>;

  /** Fires after a database is closed. */
  readonly onDidClose: Event<void>;

  /** Open a database for the given workspace path. */
  openForWorkspace(workspacePath: string, migrationsDir?: string): Promise<void>;

  /** Close the current database. */
  close(): Promise<void>;

  /** Run migration scripts. */
  migrate(migrationsDir: string): Promise<void>;

  /** Execute a write statement. */
  run(sql: string, params?: unknown[]): Promise<import('./databaseService.js').DatabaseRunResult>;

  /** Execute a query returning a single row. */
  get<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null>;

  /** Execute a query returning all rows. */
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;

  /** Execute multiple operations in a transaction. */
  runTransaction(operations: import('./databaseService.js').TransactionOp[]): Promise<unknown[]>;
}

export const IDatabaseService = createServiceIdentifier<IDatabaseService>('IDatabaseService');

// ─── IEditorResolverService ──────────────────────────────────────────────────

import type { EditorResolverRegistration, EditorResolution } from './editorResolverService.js';
export type { EditorResolverRegistration, EditorResolution };

/**
 * Maps file extensions to appropriate EditorInput + EditorPane creators.
 * Mirrors VS Code's IEditorResolverService.
 */
export interface IEditorResolverService extends IDisposable {
  /**
   * Register an editor for a set of file extensions.
   * Returns a disposable to unregister.
   */
  registerEditor(registration: EditorResolverRegistration): IDisposable;

  /**
   * Resolve a URI to the best matching EditorInput + EditorPane.
   * Returns undefined if no registration matches.
   */
  resolve(uri: import('../platform/uri.js').URI): EditorResolution | undefined;

  /**
   * Find the registration that would handle a given URI, without creating instances.
   */
  findRegistration(uri: import('../platform/uri.js').URI): EditorResolverRegistration | undefined;

  /**
   * Find a registration by its ID.
   */
  findById(id: string): EditorResolverRegistration | undefined;

  /**
   * Get all registrations.
   */
  getRegistrations(): readonly EditorResolverRegistration[];
}

export const IEditorResolverService = createServiceIdentifier<IEditorResolverService>('IEditorResolverService');

// ─── IEditorService ──────────────────────────────────────────────────────────

import type { IEditorInput } from '../editor/editorInput.js';
import type { EditorOpenOptions } from '../editor/editorTypes.js';

/**
 * Descriptor for an open editor, used by the Open Editors view.
 */
export interface OpenEditorDescriptor {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly isDirty: boolean;
  readonly isActive: boolean;
  readonly groupId: string;
}

/**
 * Manages editor opening/closing and active editor tracking.
 */
export interface IEditorService extends IDisposable {
  /** Fires when the active editor changes. */
  readonly onDidActiveEditorChange: Event<IEditorInput | undefined>;

  /** Fires when the set of open editors changes (open, close, dirty, reorder). */
  readonly onDidChangeOpenEditors: Event<void>;

  /** The currently active editor input. */
  readonly activeEditor: IEditorInput | undefined;

  /** Get descriptors for all open editors across all groups. */
  getOpenEditors(): OpenEditorDescriptor[];

  /** Open an editor in the active group (or a specified group). */
  openEditor(input: IEditorInput, options?: EditorOpenOptions, groupId?: string): Promise<void>;

  /** Close the active editor (or a specific one). */
  closeEditor(input?: IEditorInput, groupId?: string, force?: boolean): Promise<boolean>;
}

export const IEditorService = createServiceIdentifier<IEditorService>('IEditorService');

// ─── IEditorGroupService ─────────────────────────────────────────────────────

import type { EditorGroupView } from '../editor/editorGroupView.js';
import { GroupDirection } from '../editor/editorTypes.js';
export { GroupDirection };
import { PartId } from '../parts/partTypes.js';
export { PartId };

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

  /** Split a group in a direction (creates new group, copies active editor). */
  splitGroup(sourceGroupId: string, direction: GroupDirection): EditorGroupView | undefined;

  /** Add a group adjacent to the reference group (VS Code naming for splitGroup). */
  addGroup(referenceGroupId: string, direction: GroupDirection): EditorGroupView | undefined;

  /** Remove a group (merges editors into nearest group; last group replaced by empty one). */
  removeGroup(groupId: string): void;

  /** Merge source group's editors into target group, then remove source. */
  mergeGroup(sourceGroupId: string, targetGroupId: string): void;

  /** Find a group adjacent to the source in the given direction. */
  findGroup(direction: GroupDirection, sourceGroupId?: string): EditorGroupView | undefined;

  /** Activate a group by ID. */
  activateGroup(groupId: string): void;
}

export const IEditorGroupService = createServiceIdentifier<IEditorGroupService>('IEditorGroupService');

// ─── ICommandService ─────────────────────────────────────────────────────────

import type {
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
  /** Number of currently visible (active) notifications. */
  readonly activeCount: number;
  /** Recent notification history (newest first). */
  readonly history: readonly INotification[];
  /** Clear notification history. */
  clearHistory(): void;
  /** Fires when a notification is shown. */
  readonly onDidShowNotification: Event<INotification>;
  /** Fires when a notification is closed. */
  readonly onDidCloseNotification: Event<string>;
  /** Fires when the active notification count changes. */
  readonly onDidChangeCount: Event<number>;
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
  readonly onDidRequestActivation: Event<ActivationRequest>;
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
  readonly onWillForceDeactivate: Event<string>;
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

// ─── IToolEnablementService ──────────────────────────────────────────────────

import type { IToolEnablementService as IToolEnablementServiceShape, ToolEnablementChangeEvent, ToolEnablementState } from '../tools/toolEnablement.js';

/**
 * Service interface for tool enable/disable state management (M6 Capability 0).
 */
export interface IToolEnablementService extends IToolEnablementServiceShape {}

export const IToolEnablementService = createServiceIdentifier<IToolEnablementService>('IToolEnablementService');

// Re-export types for convenience
export type { ToolEnablementChangeEvent, ToolEnablementState };

// ─── IConfigurationService ───────────────────────────────────────────────────

import type {
  IConfigurationServiceShape,
} from '../configuration/configurationTypes.js';

/**
 * Service interface for the configuration system (M2 Capability 4).
 */
export interface IConfigurationService extends IConfigurationServiceShape {}

export const IConfigurationService = createServiceIdentifier<IConfigurationService>('IConfigurationService');

// ─── ICommandContributionService ─────────────────────────────────────────────

import type { IContributedCommand } from '../contributions/contributionTypes.js';

export interface ICommandContributionService {
  processContributions(toolDescription: IToolDescription): void;
  removeContributions(toolId: string): void;
  wireRealHandler(commandId: string, handler: (...args: unknown[]) => unknown | Promise<unknown>): void;
  getContributedCommands(): readonly IContributedCommand[];
  getContributedCommand(commandId: string): IContributedCommand | undefined;
  isContributed(commandId: string): boolean;
}

export const ICommandContributionService = createServiceIdentifier<ICommandContributionService>('ICommandContributionService');

// ─── IKeybindingContributionService ──────────────────────────────────────────

import type { IContributedKeybinding } from '../contributions/contributionTypes.js';

export interface IKeybindingContributionService {
  processContributions(toolDescription: IToolDescription): void;
  removeContributions(toolId: string): void;
  getKeybindingForCommand(commandId: string): IContributedKeybinding | undefined;
  getAllKeybindings(): readonly IContributedKeybinding[];
}

export const IKeybindingContributionService = createServiceIdentifier<IKeybindingContributionService>('IKeybindingContributionService');

// ─── IMenuContributionService ────────────────────────────────────────────────

import type { IContributedMenuItem, MenuLocationId } from '../contributions/contributionTypes.js';

export interface IMenuContributionService {
  processContributions(toolDescription: IToolDescription): void;
  removeContributions(toolId: string): void;
  isCommandVisibleInPalette(commandId: string): boolean;
  getViewTitleActions(viewId: string): readonly IContributedMenuItem[];
  renderViewTitleActions(viewId: string, container: HTMLElement): IDisposable;
  showViewContextMenu(viewId: string, x: number, y: number): IDisposable;
  dismissContextMenu(): void;
  getMenuItems(location: MenuLocationId): readonly IContributedMenuItem[];
}

export const IMenuContributionService = createServiceIdentifier<IMenuContributionService>('IMenuContributionService');

// ─── View Contribution (M2 Capability 6) ─────────────────────────────────────

/**
 * Service for processing view and view container contributions from tool manifests.
 * Manages the view provider registry that bridges manifest declarations to runtime content.
 */
export interface IViewContributionService {
  processContributions(toolDescription: import('../tools/toolManifest.js').IToolDescription): void;
  removeContributions(toolId: string): void;
  registerProvider(viewId: string, provider: { resolveView(viewId: string, container: HTMLElement): void | import('../platform/lifecycle.js').IDisposable }): import('../platform/lifecycle.js').IDisposable;
  hasContributedView(viewId: string): boolean;
  getContainers(): readonly { id: string; toolId: string; title: string; icon?: string; location: 'sidebar' | 'panel' | 'auxiliaryBar'; priority: number }[];
  getContainer(containerId: string): { id: string; toolId: string; title: string; icon?: string; location: 'sidebar' | 'panel' | 'auxiliaryBar'; priority: number } | undefined;
  getContainersForLocation(location: 'sidebar' | 'panel' | 'auxiliaryBar'): readonly { id: string; toolId: string; title: string; icon?: string; location: 'sidebar' | 'panel' | 'auxiliaryBar'; priority: number }[];
  getViewsForContainer(containerId: string): readonly { id: string; toolId: string; name: string; containerId: string; icon?: string; when?: string }[];
  readonly onDidAddContainer: import('../platform/events.js').Event<{ id: string; toolId: string; title: string; icon?: string; location: 'sidebar' | 'panel' | 'auxiliaryBar'; priority: number }>;
  readonly onDidRemoveContainer: import('../platform/events.js').Event<string>;
  readonly onDidAddView: import('../platform/events.js').Event<{ id: string; toolId: string; name: string; containerId: string; icon?: string; when?: string }>;
  readonly onDidRemoveView: import('../platform/events.js').Event<string>;
  readonly onDidRegisterProvider: import('../platform/events.js').Event<{ viewId: string }>;
}

export const IViewContributionService = createServiceIdentifier<IViewContributionService>('IViewContributionService');

// ─── IKeybindingService ──────────────────────────────────────────────────────

/**
 * Centralized keybinding dispatch service (M3 Capability 0.3).
 * Owns a single document-level keydown listener (capture phase) and resolves
 * keyboard events to command executions via the keybinding table.
 *
 * Replaces the ad-hoc dispatch in KeybindingContributionProcessor and the
 * hardcoded listeners in CommandPalette.
 *
 * VS Code reference: src/vs/workbench/services/keybinding/browser/keybindingService.ts
 */
export interface IKeybindingService extends IDisposable {
  /**
   * Register a keybinding that maps a key combination to a command.
   * Returns a disposable that removes the registration.
   *
   * @param key — Normalized keybinding string, e.g. 'Ctrl+B', 'Ctrl+K Ctrl+F'
   * @param commandId — Command to execute when the keybinding fires
   * @param when — Optional when-clause expression for conditional activation
   * @param source — Origin of the keybinding (e.g. 'builtin', 'tool:<toolId>')
   */
  registerKeybinding(key: string, commandId: string, when?: string, source?: string): IDisposable;

  /**
   * Register multiple keybindings at once. Returns a single disposable.
   */
  registerKeybindings(bindings: readonly { key: string; commandId: string; when?: string; source?: string }[]): IDisposable;

  /**
   * Remove all keybindings contributed by a specific source.
   */
  removeKeybindingsBySource(source: string): void;

  /**
   * Look up the keybinding string for a command (first match).
   * Returns undefined if no keybinding is registered for the command.
   */
  lookupKeybinding(commandId: string): string | undefined;

  /**
   * Get all registered keybindings.
   */
  getAllKeybindings(): readonly { key: string; commandId: string; when?: string; source?: string }[];

  /** Fires when a keybinding is successfully dispatched. */
  readonly onDidDispatch: Event<{ key: string; commandId: string }>;

  /** Fires when a chord prefix is entered (status bar hint). */
  readonly onDidEnterChordPrefix: Event<string>;

  /** Fires when a chord is cancelled (timeout or non-matching second key). */
  readonly onDidCancelChord: Event<void>;
}

export const IKeybindingService = createServiceIdentifier<IKeybindingService>('IKeybindingService');

// ─── IWindowService ──────────────────────────────────────────────────────────

/**
 * Abstraction over native window operations (minimize, maximize, close, etc.).
 * In Electron, delegates to `window.parallxElectron` IPC bridge.
 * In browser-only mode, methods are no-ops.
 *
 * VS Code reference: INativeHostService (src/vs/platform/native/common/native.ts)
 * — our scope is narrower: only window-chrome operations.
 */
export interface IWindowService extends IDisposable {
  /** Whether the host supports native window controls (Electron). */
  readonly isNativeWindow: boolean;
  /** Minimize the window. */
  minimize(): void;
  /** Toggle maximize / restore. */
  maximize(): void;
  /** Close the window. */
  close(): void;
  /** Query current maximized state. */
  isMaximized(): Promise<boolean>;
  /** Fires when the maximized state changes. */
  readonly onDidChangeMaximized: Event<boolean>;
}

export const IWindowService = createServiceIdentifier<IWindowService>('IWindowService');

// ─── IFileService (M4 Capability 1) ────────────────────────────────────────

/**
 * Provides filesystem operations as a service abstraction.
 * Backed by Electron IPC bridge in M4; designed as a provider facade
 * so additional providers (virtual FS, remote FS) can be registered later.
 *
 * VS Code reference: IFileService (src/vs/platform/files/common/files.ts)
 */
export interface IFileService extends IDisposable {
  /**
   * Install (or clear) a boundary checker invoked before filesystem operations.
   *
   * The checker can throw to deny access for out-of-scope URIs.
   */
  setBoundaryChecker(checker: ((uri: import('../platform/uri.js').URI, operation: string) => void) | undefined): void;

  /** Read a file's content. */
  readFile(uri: import('../platform/uri.js').URI): Promise<import('../platform/fileTypes.js').FileContent>;

  /** Write string content to a file (creates parent dirs if needed). */
  writeFile(uri: import('../platform/uri.js').URI, content: string): Promise<void>;

  /** Get stat information for a file or directory. */
  stat(uri: import('../platform/uri.js').URI): Promise<import('../platform/fileTypes.js').FileStat>;

  /** List directory entries, sorted directories-first then alphabetical. */
  readdir(uri: import('../platform/uri.js').URI): Promise<import('../platform/fileTypes.js').FileEntry[]>;

  /** Check if a resource exists. */
  exists(uri: import('../platform/uri.js').URI): Promise<boolean>;

  /** Rename or move a resource. */
  rename(source: import('../platform/uri.js').URI, target: import('../platform/uri.js').URI): Promise<void>;

  /** Delete a resource. */
  delete(uri: import('../platform/uri.js').URI, options?: import('../platform/fileTypes.js').FileDeleteOptions): Promise<void>;

  /** Create a directory (recursive). */
  mkdir(uri: import('../platform/uri.js').URI): Promise<void>;

  /** Copy a file or directory. */
  copy(source: import('../platform/uri.js').URI, target: import('../platform/uri.js').URI): Promise<void>;

  /** Start watching a path for changes. Returns a disposable that stops watching. */
  watch(uri: import('../platform/uri.js').URI): Promise<IDisposable>;

  /** Fires when files change (create, modify, delete). */
  readonly onDidFileChange: Event<import('../platform/fileTypes.js').FileChangeEvent[]>;

  // ── Dialogs ──

  /** Open native file picker. Returns selected file URIs, or null if cancelled. */
  openFileDialog(options?: import('../platform/fileTypes.js').OpenFileOptions): Promise<import('../platform/uri.js').URI[] | null>;

  /** Open native folder picker. Returns selected folder URIs, or null if cancelled. */
  openFolderDialog(options?: import('../platform/fileTypes.js').OpenFolderOptions): Promise<import('../platform/uri.js').URI[] | null>;

  /** Open native save dialog. Returns target URI, or null if cancelled. */
  saveFileDialog(options?: import('../platform/fileTypes.js').SaveFileOptions): Promise<import('../platform/uri.js').URI | null>;

  /** Show a native OS message box. */
  showMessageBox(options: import('../platform/fileTypes.js').MessageBoxOptions): Promise<import('../platform/fileTypes.js').MessageBoxResult>;
}

export const IFileService = createServiceIdentifier<IFileService>('IFileService');

// ─── ITextFileModelManager (M4 Capability 1) ──────────────────────────────

/**
 * Manages text file models — the in-memory representation of text files
 * that sits between IFileService (raw bytes) and editors (text panes).
 *
 * Central authority for dirty state, content, and model lifecycle.
 * Multiple editors viewing the same file share one TextFileModel.
 *
 * VS Code reference: ITextFileService (src/vs/workbench/services/textfile/common/textFileService.ts)
 */
export interface ITextFileModelManager extends IDisposable {
  /** Load (or return existing) model for a URI. */
  resolve(uri: import('../platform/uri.js').URI): Promise<import('./textFileModelManager.js').TextFileModel>;

  /** Get existing model without loading (returns undefined if not tracked). */
  get(uri: import('../platform/uri.js').URI): import('./textFileModelManager.js').TextFileModel | undefined;

  /** All currently managed models. */
  readonly models: readonly import('./textFileModelManager.js').TextFileModel[];

  /** Save all dirty models. */
  saveAll(): Promise<void>;

  /** Fires when a new model is created. */
  readonly onDidCreate: Event<import('./textFileModelManager.js').TextFileModel>;

  /** Fires when a model is disposed. */
  readonly onDidDispose: Event<import('../platform/uri.js').URI>;
}

export const ITextFileModelManager = createServiceIdentifier<ITextFileModelManager>('ITextFileModelManager');

// ─── IThemeService (M5 Capability 3) ──────────────────────────────────────

/**
 * Manages color themes — loading, resolving, and injecting CSS custom properties.
 *
 * VS Code reference: IThemeService (src/vs/platform/theme/common/themeService.ts)
 */
export interface IThemeService extends IDisposable {
  /** The currently applied color theme. */
  readonly activeTheme: import('../theme/themeData.js').IColorTheme;

  /** Fired when the active theme changes. */
  readonly onDidChangeTheme: Event<import('../theme/themeData.js').IColorTheme>;

  /** Resolve a color from the active theme, with registry default fallback. */
  getColor(colorId: string): string;

  /** Apply a parsed theme. */
  applyTheme(theme: import('../theme/themeData.js').ColorThemeData): void;
}

export const IThemeService = createServiceIdentifier<IThemeService>('IThemeService');

// ─── Status Bar Types ────────────────────────────────────────────────────────

/**
 * Status bar alignment for items.
 * VS Code reference: StatusbarAlignment (src/vs/workbench/services/statusbar/browser/statusbar.ts)
 */
export enum StatusBarAlignment {
  Left = 'left',
  Right = 'right',
}

/**
 * Descriptor for a status bar entry.
 * VS Code reference: IStatusbarEntry
 */
export interface StatusBarEntry {
  readonly id: string;
  /** Display text. Supports `$(icon-name)` codicon placeholders. */
  readonly text: string;
  readonly alignment: StatusBarAlignment;
  /** Sort order: higher priority = closer to the edge. */
  readonly priority?: number;
  readonly tooltip?: string;
  /** Command ID to execute on click. */
  readonly command?: string;
  /** Human-readable name for context-menu toggling. */
  readonly name?: string;
  /** Optional SVG icon string rendered before the text. */
  readonly iconSvg?: string;
}

/**
 * Accessor returned when adding an entry — allows updating or removing it.
 * VS Code reference: IStatusbarEntryAccessor
 */
export interface StatusBarEntryAccessor extends IDisposable {
  /** Update the entry's mutable properties. */
  update(entry: Partial<Pick<StatusBarEntry, 'text' | 'tooltip' | 'command' | 'iconSvg'>>): void;
}

/**
 * Minimal interface for status bar part operations needed by API consumers.
 * VS Code reference: IStatusbarService
 */
export interface IStatusBarPart {
  addEntry(entry: StatusBarEntry): StatusBarEntryAccessor;
}
