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

  /** Fires when the workspace is renamed. */
  readonly onDidRename: Event<string>;

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

// ─── IWorkspaceMemoryService ───────────────────────────────────────────────

export interface IWorkspaceMemoryService extends IDisposable {
  /** Canonical workspace memory root: .parallx/memory */
  readonly memoryRoot: URI | undefined;

  /** Canonical durable memory file: .parallx/memory/MEMORY.md */
  readonly durableMemoryUri: URI | undefined;

  /** Canonical daily log file: .parallx/memory/YYYY-MM-DD.md */
  getDailyMemoryUri(date?: Date): URI | undefined;

  /** Relative path for today's daily memory log. */
  getDailyMemoryRelativePath(date?: Date): string;

  /** Relative path for durable memory. */
  getDurableMemoryRelativePath(): string;

  /** Ensure canonical memory directories and seed files exist. */
  ensureScaffold(): Promise<void>;

  /** Read the durable memory markdown file. */
  readDurableMemory(): Promise<string>;

  /** Overwrite the durable memory markdown file. */
  writeDurableMemory(content: string): Promise<void>;

  /** Read the daily memory markdown file for a date. */
  readDailyMemory(date?: Date): Promise<string>;

  /** Ensure the daily memory markdown file exists for a date and return its relative path. */
  ensureDailyMemory(date?: Date): Promise<string>;

  /** Append a note to the daily memory markdown file for a date. */
  appendDailyMemory(text: string, date?: Date): Promise<void>;

  /** Append a structured session summary block to the daily memory file. */
  appendSessionSummary(sessionId: string, summary: string, messageCount: number, date?: Date): Promise<void>;

  /** Sync the durable preferences section in MEMORY.md from canonical preference records. */
  syncPreferences(preferences: Array<{ key: string; value: string }>): Promise<void>;

  /** Read canonical durable preferences as key-value pairs. */
  readPreferences(): Promise<Array<{ key: string; value: string }>>;

  /** Merge preference records into canonical durable memory. */
  upsertPreferences(preferences: Array<{ key: string; value: string }>): Promise<void>;

  /** Sync legacy/imported learning concepts into a durable markdown section. */
  syncConcepts(concepts: Array<{ concept: string; category: string; summary: string; encounterCount?: number; masteryLevel?: number }>): Promise<void>;

  /** Read canonical durable concepts. */
  readConcepts(): Promise<Array<{ concept: string; category: string; summary: string; encounterCount: number; masteryLevel: number; struggleCount: number }>>;

  /** Merge concept records into canonical durable memory. */
  upsertConcepts(concepts: Array<{ concept: string; category: string; summary: string; encounterCount?: number; masteryLevel?: number; struggleCount?: number }>): Promise<void>;

  /** Search canonical durable concepts with simple workspace-local ranking. */
  searchConcepts(query: string, topK?: number): Promise<Array<{ concept: string; category: string; summary: string; encounterCount: number; masteryLevel: number; struggleCount: number }>>;

  /** Read a prompt-ready preferences block from canonical durable memory. */
  getPreferencesPromptBlock(): Promise<string | undefined>;

  /** Resolve the canonical markdown file containing a stored session summary, if present. */
  findSessionSummaryRelativePath(sessionId: string): Promise<string | undefined>;

  /** Whether a canonical daily log already contains a summary block for the session. */
  hasSessionSummary(sessionId: string): Promise<boolean>;

  /** Read the canonical message count stored for a session summary, if present. */
  getSessionSummaryMessageCount(sessionId: string): Promise<number | null>;

  /** Import legacy DB-backed memory snapshot into canonical markdown files once. */
  importLegacySnapshot(snapshot: {
    memories: Array<{ sessionId: string; createdAt: string; messageCount: number; summary: string }>;
    preferences: Array<{ key: string; value: string }>;
    concepts: Array<{ concept: string; category: string; summary: string; encounterCount?: number; masteryLevel?: number }>;
  }): Promise<{ imported: boolean; reason: 'imported' | 'already-imported' | 'empty-snapshot' }>;
}

export const IWorkspaceMemoryService = createServiceIdentifier<IWorkspaceMemoryService>('IWorkspaceMemoryService');

// ─── IWorkspaceTranscriptService ───────────────────────────────────────────

export interface IWorkspaceTranscriptService extends IDisposable {
  /** Canonical transcript root: .parallx/sessions */
  readonly transcriptRoot: URI | undefined;

  /** Resolve the canonical transcript file URI for a chat session. */
  getTranscriptUri(sessionId: string): URI | undefined;

  /** Relative transcript path for a chat session. */
  getTranscriptRelativePath(sessionId: string): string;

  /** Ensure canonical transcript directories exist. */
  ensureScaffold(): Promise<void>;

  /** Persist the current transcript snapshot for a session. */
  writeSessionTranscript(session: import('./chatTypes.js').IChatSession): Promise<void>;

  /** Read the canonical transcript snapshot for a session. */
  readSessionTranscript(sessionId: string): Promise<string>;

  /** Delete the canonical transcript file for a session. */
  deleteSessionTranscript(sessionId: string): Promise<void>;
}

export const IWorkspaceTranscriptService = createServiceIdentifier<IWorkspaceTranscriptService>('IWorkspaceTranscriptService');

// ─── ICanonicalMemorySearchService ────────────────────────────────────────

export interface ICanonicalMemorySearchResult {
  readonly sourceId: string;
  readonly contextPrefix: string;
  readonly text: string;
  readonly score: number;
  readonly layer: 'durable' | 'daily';
}

export interface ICanonicalMemorySearchService extends IDisposable {
  /** Whether canonical memory search can currently serve indexed results. */
  isReady(): boolean;

  /** Search canonical workspace memory only, independent of generic file retrieval. */
  search(
    query: string,
    options?: { layer?: 'all' | 'durable' | 'daily'; date?: string; topK?: number },
  ): Promise<ICanonicalMemorySearchResult[]>;
}

export const ICanonicalMemorySearchService = createServiceIdentifier<ICanonicalMemorySearchService>('ICanonicalMemorySearchService');

// ─── IWorkspaceBoundaryService ───────────────────────────────────────────────

import type { URI } from '../platform/uri.js';
import type {
  AgentActionClass,
  AgentMemoryCorrectionInput,
  AgentApprovalRequest,
  AgentApprovalRequestInput,
  AgentApprovalResolution,
  AgentMemoryEntry,
  AgentMemoryEntryInput,
  AgentPlanStep,
  AgentPlanStepInput,
  AgentPolicyDecision,
  AgentProposedAction,
  AgentRunResult,
  AgentTraceEntry,
  AgentTraceEntryInput,
  AgentTaskDiagnostics,
  AgentTaskStatus,
  AgentTaskRecord,
} from '../agent/agentTypes.js';
import type { IStorage } from '../platform/storage.js';
import type { IWorkspaceSessionContext } from '../workspace/workspaceSessionContext.js';

// ─── IGlobalStorageService ──────────────────────────────────────────────────

/** M53 D3: Global storage exposed as a DI service for built-in tools. */
export const IGlobalStorageService = createServiceIdentifier<IStorage>('IGlobalStorageService');

/** M53 D3: Workspace storage exposed as a DI service for built-in tools. */
export const IWorkspaceStorageService = createServiceIdentifier<IStorage>('IWorkspaceStorageService');

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

// ─── IAgentPolicyService ────────────────────────────────────────────────────

/**
 * Resolves agent action classification and default policy decisions.
 */
export interface IAgentPolicyService extends IDisposable {
  /** Classify an agent action into a stable action class. */
  classifyAction(action: AgentProposedAction): AgentActionClass;

  /** Evaluate the default policy decision for an agent action. */
  evaluateAction(action: AgentProposedAction): AgentPolicyDecision;
}

export const IAgentPolicyService = createServiceIdentifier<IAgentPolicyService>('IAgentPolicyService');

// ─── IAgentTaskStore ────────────────────────────────────────────────────────

/**
 * Persists agent tasks and approval requests into durable local storage.
 */
export interface IAgentTaskStore extends IDisposable {
  /** Bind storage and hydrate any persisted state. */
  setStorage(storage: IStorage): Promise<void>;

  /** Insert or replace a task record. */
  upsertTask(task: AgentTaskRecord): Promise<void>;

  /** Get a task by id. */
  getTask(taskId: string): AgentTaskRecord | undefined;

  /** List tasks for a workspace. */
  listTasksForWorkspace(workspaceId: string): readonly AgentTaskRecord[];

  /** Insert or replace a plan step. */
  upsertPlanStep(step: AgentPlanStep): Promise<void>;

  /** Get a plan step by id. */
  getPlanStep(stepId: string): AgentPlanStep | undefined;

  /** List plan steps for a task. */
  listPlanStepsForTask(taskId: string): readonly AgentPlanStep[];

  /** Insert or replace an approval request. */
  upsertApprovalRequest(request: AgentApprovalRequest): Promise<void>;

  /** Get an approval request by id. */
  getApprovalRequest(requestId: string): AgentApprovalRequest | undefined;

  /** List approval requests for a task. */
  listApprovalRequestsForTask(taskId: string): readonly AgentApprovalRequest[];

  /** List all pending approval requests. */
  listPendingApprovalRequests(): readonly AgentApprovalRequest[];

  /** Insert or replace a task memory entry. */
  upsertMemoryEntry(entry: AgentMemoryEntry): Promise<void>;

  /** Get a task memory entry by id. */
  getMemoryEntry(entryId: string): AgentMemoryEntry | undefined;

  /** List task memory entries for a task. */
  listMemoryEntriesForTask(taskId: string): readonly AgentMemoryEntry[];

  /** Insert or replace a trace entry. */
  upsertTraceEntry(entry: AgentTraceEntry): Promise<void>;

  /** List trace entries for a task. */
  listTraceEntriesForTask(taskId: string): readonly AgentTraceEntry[];
}

export const IAgentTaskStore = createServiceIdentifier<IAgentTaskStore>('IAgentTaskStore');

// ─── IAgentApprovalService ──────────────────────────────────────────────────

/**
 * Owns durable creation and resolution of agent approval requests.
 */
export interface IAgentApprovalService extends IDisposable {
  /** Bind storage and hydrate any persisted approval state. */
  setStorage(storage: IStorage): Promise<void>;

  /** Create and persist a new pending approval request, or merge into an existing bundle. */
  createApprovalRequest(input: AgentApprovalRequestInput): Promise<AgentApprovalRequest>;

  /** Resolve a persisted approval request. */
  resolveApprovalRequest(requestId: string, resolution: AgentApprovalResolution, resolvedAt?: string): Promise<AgentApprovalRequest>;

  /** Get a single approval request by id. */
  getApprovalRequest(requestId: string): AgentApprovalRequest | undefined;

  /** List approval requests for a task. */
  listApprovalRequestsForTask(taskId: string): readonly AgentApprovalRequest[];

  /** List pending approval requests. */
  listPendingApprovalRequests(): readonly AgentApprovalRequest[];

  /** Group pending approval requests by task + bundle identity for rendering. */
  listPendingApprovalBundles(): readonly AgentApprovalRequest[];

  /** Fires when an approval request is created or resolved. */
  readonly onDidChangeApprovalRequests: Event<AgentApprovalRequest>;
}

export const IAgentApprovalService = createServiceIdentifier<IAgentApprovalService>('IAgentApprovalService');

// ─── IAgentSessionService ───────────────────────────────────────────────────

/**
 * Owns task lifecycle transitions and approval pause/resume semantics.
 */
export interface IAgentSessionService extends IDisposable {
  /** Create and persist a new task for the active workspace. */
  createTask(input: import('../agent/agentTypes.js').DelegatedTaskInput, taskId?: string, now?: string): Promise<AgentTaskRecord>;

  /** Update a task status directly through validated lifecycle transitions. */
  transitionTask(taskId: string, nextStatus: AgentTaskStatus, now?: string, options?: { blockerReason?: string; blockerCode?: import('../agent/agentTypes.js').AgentBlockReasonCode; currentStepId?: string; stopAfterCurrentStep?: boolean }): Promise<AgentTaskRecord>;

  /** Move a task into awaiting-approval and enqueue an approval request. */
  queueApprovalForTask(taskId: string, request: Omit<AgentApprovalRequestInput, 'taskId'>, now?: string): Promise<{ task: AgentTaskRecord; approvalRequest: AgentApprovalRequest }>;

  /** Persist plan steps for a task. */
  setPlanSteps(taskId: string, steps: readonly AgentPlanStepInput[], now?: string): Promise<readonly AgentPlanStep[]>;

  /** Merge newly recorded workspace artifact refs into the task. */
  recordTaskArtifacts(taskId: string, artifactRefs: readonly string[], now?: string): Promise<AgentTaskRecord>;

  /** List plan steps for a task. */
  getPlanSteps(taskId: string): readonly AgentPlanStep[];

  /** Request that the task pause after completing its current runnable step. */
  requestStopAfterCurrentStep(taskId: string, now?: string): Promise<AgentTaskRecord>;

  /** Continue a paused or blocked task. */
  continueTask(taskId: string, now?: string): Promise<AgentTaskRecord>;

  /** Redirect a paused or blocked task with an additional constraint and resume planning. */
  redirectTask(taskId: string, constraint: string, now?: string): Promise<AgentTaskRecord>;

  /** Resolve an approval request and resume or block the task accordingly. */
  resolveTaskApproval(taskId: string, requestId: string, resolution: AgentApprovalResolution, now?: string): Promise<AgentTaskRecord>;

  /** Get a single task. */
  getTask(taskId: string): AgentTaskRecord | undefined;

  /** List tasks for the active workspace. */
  listActiveWorkspaceTasks(): readonly AgentTaskRecord[];

  /** Fires when a task changes. */
  readonly onDidChangeTasks: Event<AgentTaskRecord>;
}

export const IAgentSessionService = createServiceIdentifier<IAgentSessionService>('IAgentSessionService');

// ─── IAgentExecutionService ────────────────────────────────────────────────

/**
 * Runs the minimal autonomous execution loop over persisted plan steps.
 */
export interface IAgentExecutionService extends IDisposable {
  /** Execute runnable plan steps until the task completes or yields. */
  runTask(taskId: string, now?: string): Promise<AgentRunResult>;
}

export const IAgentExecutionService = createServiceIdentifier<IAgentExecutionService>('IAgentExecutionService');

// ─── IAgentMemoryService ───────────────────────────────────────────────────

/**
 * Owns task-scoped working memory entries and compaction rules.
 */
export interface IAgentMemoryService extends IDisposable {
  /** Persist a task memory entry. */
  remember(taskId: string, input: AgentMemoryEntryInput, now?: string): Promise<AgentMemoryEntry>;

  /** List task memory entries in creation order. */
  listTaskMemory(taskId: string, options?: { includeSuperseded?: boolean }): readonly AgentMemoryEntry[];

  /** Get a specific task memory entry. */
  getTaskMemoryEntry(taskId: string, entryId: string): AgentMemoryEntry | undefined;

  /** Correct a prior memory entry by superseding it with a new canonical entry. */
  correctTaskMemory(taskId: string, entryId: string, correction: AgentMemoryCorrectionInput, now?: string): Promise<{ previous: AgentMemoryEntry; corrected: AgentMemoryEntry }>;

  /** Compact older non-pinned memory entries while preserving recent context. */
  compactTaskMemory(taskId: string, now?: string): Promise<readonly AgentMemoryEntry[]>;
}

export const IAgentMemoryService = createServiceIdentifier<IAgentMemoryService>('IAgentMemoryService');

// ─── IAgentTraceService ────────────────────────────────────────────────────

/**
 * Owns readable autonomous run trace entries.
 */
export interface IAgentTraceService extends IDisposable {
  /** Persist a trace entry for a task. */
  record(taskId: string, input: AgentTraceEntryInput, now?: string): Promise<AgentTraceEntry>;

  /** List trace entries for a task in creation order. */
  listTaskTrace(taskId: string): readonly AgentTraceEntry[];

  /** Build a reproducible diagnostics snapshot for a task. */
  getTaskDiagnostics(taskId: string): AgentTaskDiagnostics | undefined;
}

export const IAgentTraceService = createServiceIdentifier<IAgentTraceService>('IAgentTraceService');

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

  // ── Rich Document Extraction ──

  /**
   * Extract plain text from a rich document file (PDF, Excel, Word).
   * Returns the extracted text, the format identifier, and optional metadata.
   * Throws if the file is not a supported rich document format.
   */
  readDocumentText(uri: import('../platform/uri.js').URI): Promise<{ text: string; format: string; metadata?: Record<string, unknown> }>;

  /**
   * Check if a file extension represents a supported rich document format.
   * @param ext — Lowercase extension including the dot (e.g. '.pdf')
   */
  isRichDocument(ext: string): boolean;

  /**
   * Set of file extensions for rich document formats that can be extracted.
   * Each extension is lowercase with leading dot (e.g. '.pdf', '.docx').
   */
  readonly richDocumentExtensions: ReadonlySet<string>;
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

// ─── IDocumentExtractionService (M21 Phase A) ─────────────────────────────

/**
 * Pipeline type indicating which extraction method was used.
 */
export type ExtractionPipeline = 'docling' | 'docling-ocr' | 'legacy';

/**
 * Result of extracting structured content from a rich document.
 */
export interface DocumentExtractionResult {
  /** Structured Markdown output (or plain text for legacy). */
  markdown: string;
  /** Number of pages detected (0 if unknown). */
  pageCount: number;
  /** Number of tables recovered from the document. */
  tablesFound: number;
  /** Time in ms the extraction took. */
  elapsedMs: number;
  /** Diagnostic messages from the extraction pipeline. */
  diagnostics: string[];
  /** Which pipeline was used. */
  pipeline: ExtractionPipeline;
}

/**
 * Status of the Docling bridge service.
 */
export type DoclingBridgeStatus = 'unavailable' | 'starting' | 'available' | 'downloading-models' | 'error';

/**
 * Manages document extraction via the Docling bridge (primary) with
 * fallback to legacy extractors (pdf-parse, mammoth, SheetJS).
 *
 * Reference: docs/Parallx_Milestone_21.md Phase A
 */
export interface IDocumentExtractionService extends IDisposable {
  /** Whether Docling is available on this system. */
  readonly isDoclingAvailable: boolean;

  /** Current bridge status. */
  readonly bridgeStatus: DoclingBridgeStatus;

  /** Event fired when Docling availability changes. */
  readonly onDidChangeAvailability: Event<boolean>;

  /** Event fired when bridge status changes. */
  readonly onDidChangeBridgeStatus: Event<DoclingBridgeStatus>;

  /**
   * Extract structured Markdown from a rich document.
   * Tries Docling first, falls back to legacy extractors.
   */
  extractDocument(filePath: string, options?: {
    ocr?: boolean;
  }): Promise<DocumentExtractionResult>;

  /**
   * Extract a batch of rich documents via Docling in a single round-trip.
   * Falls back to sequential extractDocument() calls if batch API is unavailable.
   *
   * @param files — Array of file paths with extraction options.
   * @returns Map from file path to extraction result (or error).
   */
  extractBatch(files: { path: string; ocr?: boolean }[]): Promise<Map<string, DocumentExtractionResult>>;

  /**
   * Initialize the service: detect Python, start Docling bridge.
   * Called once during workbench initialization.
   */
  initialize(): Promise<void>;
}

export const IDocumentExtractionService = createServiceIdentifier<IDocumentExtractionService>('IDocumentExtractionService');

// ─── IEmbeddingService (M10 Task 1.1) ──────────────────────────────────────

/**
 * Generates text embeddings via Ollama's /api/embed endpoint.
 * Uses nomic-embed-text v1.5 with mandatory task prefixes.
 *
 * Reference: docs/Parallx_Milestone_10.md DR-1, DR-2
 */
export interface IEmbeddingService extends IDisposable {
  /** Embed a single document text (adds 'search_document:' prefix). */
  embedDocument(text: string, contentHash?: string): Promise<number[]>;

  /** Embed a user query (adds 'search_query:' prefix). */
  embedQuery(query: string): Promise<number[]>;

  /** Embed multiple document texts in batch. */
  embedDocumentBatch(texts: string[], contentHashes?: string[], signal?: AbortSignal): Promise<number[][]>;

  /** Get model info (name, dimensions, installed status). */
  getModelInfo(): { name: string; dimensions: number; installed: boolean };

  /** Ensure the embedding model is installed (pulls if not). */
  ensureModel(signal?: AbortSignal): Promise<void>;

  /** Clear the in-memory embedding cache. */
  clearCache(): void;

  /** Current number of cached embeddings. */
  readonly cacheSize: number;

  /** Fires when an embedding batch starts. */
  readonly onDidStartEmbedding: Event<{ count: number }>;

  /** Fires when an embedding batch completes. */
  readonly onDidFinishEmbedding: Event<{ count: number; durationMs: number }>;
}

export const IEmbeddingService = createServiceIdentifier<IEmbeddingService>('IEmbeddingService');

// ─── IChunkingService (M10 Task 1.3) ───────────────────────────────────────

/**
 * Splits content into chunks suitable for embedding and retrieval.
 * Supports canvas pages (TipTap JSON) and workspace files.
 *
 * Reference: docs/Parallx_Milestone_10.md DR-6, DR-8
 */
export interface IChunkingService extends IDisposable {
  /** Chunk a canvas page by TipTap block boundaries. */
  chunkPage(pageId: string, pageTitle: string, contentJson: string): Promise<import('./chunkingService.js').Chunk[]>;

  /** Chunk a workspace file by headings/paragraphs. */
  chunkFile(filePath: string, content: string, language?: string): Promise<import('./chunkingService.js').Chunk[]>;
}

export const IChunkingService = createServiceIdentifier<IChunkingService>('IChunkingService');

// ─── IVectorStoreService (M10 Task 1.2) ────────────────────────────────────

/**
 * Manages the dual vector + keyword index (sqlite-vec vec0 + FTS5).
 * Provides upsert, delete, and hybrid search with RRF fusion.
 *
 * Reference: docs/Parallx_Milestone_10.md DR-3, DR-4, DR-5
 */
export interface IVectorStoreService extends IDisposable {
  /** Upsert embedded chunks for a source. */
  upsert(
    sourceType: string,
    sourceId: string,
    chunks: import('./vectorStoreService.js').EmbeddedChunk[],
    contentHash: string,
    summary?: string,
    sourceMetadata?: import('./vectorStoreService.js').SourceIndexMetadata,
  ): Promise<void>;

  /** Delete all chunks for a source. */
  deleteSource(sourceType: string, sourceId: string): Promise<void>;

  /** Hybrid search: vector + keyword, merged via RRF. */
  search(
    queryEmbedding: number[],
    queryText: string,
    options?: import('./vectorStoreService.js').SearchOptions,
  ): Promise<import('./vectorStoreService.js').SearchResult[]>;

  /** Vector-only search (for "find similar"). */
  vectorSearch(
    queryEmbedding: number[],
    topK?: number,
    sourceFilter?: string,
  ): Promise<import('./vectorStoreService.js').SearchResult[]>;

  /** Get stored content hash for incremental re-indexing. */
  getContentHash(sourceType: string, sourceId: string): Promise<string | null>;

  /** Bulk-fetch indexed_at timestamps: source_id → epoch ms. */
  getIndexedAtMap(sourceType: string): Promise<Map<string, number>>;

  /** Get all indexed sources. */
  getIndexedSources(): Promise<import('./vectorStoreService.js').IndexingMeta[]>;

  /** Get aggregate statistics. */
  getStats(): Promise<import('./vectorStoreService.js').VectorStoreStats>;

  /** Get document summaries for all indexed sources. Map<sourceId, summary>. */
  getDocumentSummaries(): Promise<Map<string, string>>;

  /** Batch-fetch stored embeddings by rowid. Returns Map<rowid, float[]>. */
  getEmbeddings(rowids: number[]): Promise<Map<number, number[]>>;

  /**
   * Fetch nearby section/page companion chunks for a retrieved anchor.
   * Used by retrieval-time structure-aware expansion on hard documents.
   */
  getStructuralCompanions(
    anchor: import('./vectorStoreService.js').SearchResult,
    options?: { limit?: number },
  ): Promise<import('./vectorStoreService.js').SearchResult[]>;

  /** Get trace information for the most recent hybrid search. */
  getLastSearchTrace?(): import('./vectorStoreService.js').HybridSearchTrace | undefined;

  /** Delete ALL data from vec_embeddings, fts_chunks, and indexing_metadata. */
  purgeAll(): Promise<void>;

  /** Fires when a source is indexed/re-indexed. */
  readonly onDidUpdateIndex: Event<{ sourceId: string; chunkCount: number }>;
}

export const IVectorStoreService = createServiceIdentifier<IVectorStoreService>('IVectorStoreService');

// ─── IIndexingPipelineService (M10 Task 2.1, 2.2) ─────────────────────────

/**
 * Orchestrates indexing of canvas pages and workspace files into the
 * vector store. Handles initial full-index on workspace open and
 * incremental re-indexing on saves/file changes.
 *
 * Reference: docs/Parallx_Milestone_10.md Phase 2
 */
export interface IIndexingPipelineService extends IDisposable {
  /** Whether the pipeline is currently running. */
  readonly isIndexing: boolean;

  /** Current progress snapshot. */
  readonly progress: import('./indexingPipeline.js').IndexingProgress;

  /** Whether the initial full indexing has completed at least once. */
  readonly isInitialIndexComplete: boolean;

  /** Start the full indexing pipeline (pages + files). */
  start(): Promise<void>;

  /** Cancel in-progress indexing. */
  cancel(): void;

  /** Force re-index a single page (bypass debounce). */
  reindexPage(pageId: string): Promise<void>;

  /** Force re-index a single file (bypass debounce). */
  reindexFile(filePath: string): Promise<void>;

  /** Schedule a debounced page re-index. */
  schedulePageReindex(pageId: string): void;

  /** Schedule a debounced file re-index. */
  scheduleFileReindex(filePath: string): void;

  /** Fires when indexing progress changes. */
  readonly onDidChangeProgress: Event<import('./indexingPipeline.js').IndexingProgress>;

  /** Fires when a single source (page or file) finishes indexing. */
  readonly onDidIndexSource: Event<import('./indexingPipeline.js').IndexingSourceResult>;

  /** Fires when initial indexing completes. */
  readonly onDidCompleteInitialIndex: Event<{ pages: number; files: number; durationMs: number }>;
}

export const IIndexingPipelineService = createServiceIdentifier<IIndexingPipelineService>('IIndexingPipelineService');

// ─── IRetrievalService (M10 Task 3.1) ─────────────────────────────────────

/**
 * Query-time retrieval: embeds user queries, runs hybrid search, applies
 * post-retrieval filtering (score threshold, dedup, token budget), and
 * returns ranked context chunks with source attribution.
 *
 * Reference: docs/Parallx_Milestone_10.md Phase 3 Task 3.1
 */
export interface IRetrievalService extends IDisposable {
  /** Retrieve relevant context chunks for a query. */
  retrieve(
    query: string,
    options?: import('./retrievalService.js').RetrievalOptions,
  ): Promise<import('./retrievalService.js').RetrievedContext[]>;

  /** Format retrieved chunks for injection into a chat message. */
  formatContext(
    chunks: import('./retrievalService.js').RetrievedContext[],
  ): string;

  /** Get trace information for the most recent retrieval request. */
  getLastTrace?(): import('./retrievalService.js').RetrievalTrace | undefined;
}

export const IRetrievalService = createServiceIdentifier<IRetrievalService>('IRetrievalService');

// ─── IMemoryService (M10 Tasks 5.1 + 5.2) ──────────────────────────────────

/**
 * Manages conversation memory and user preference learning.
 *
 * Task 5.1 — Conversation Memory:
 *   Stores LLM-generated summaries of past sessions, embeds them in the
 *   vector index, and retrieves relevant memories for new sessions.
 *
 * Task 5.2 — User Preference Learning:
 *   Extracts and persists preference statements from conversations,
 *   formats them for injection into the system prompt.
 */
export interface IMemoryService extends IDisposable {
  /** Fires when a conversation memory is stored or updated. */
  readonly onDidUpdateMemory: Event<string>;
  /** Fires when a user preference is created or updated. */
  readonly onDidUpdatePreferences: Event<import('./memoryService.js').UserPreference>;

  /** Whether a session has enough messages to summarise. */
  isSessionEligibleForSummary(messageCount: number): boolean;

  /** Whether a memory already exists for the given session. */
  hasMemory(sessionId: string): Promise<boolean>;

  /**
   * Get the message count stored with the last summary for a session.
   * Returns `null` if no memory exists. Used for growth-based re-summarization (M17 Task 1.1.2).
   */
  getMemoryMessageCount(sessionId: string): Promise<number | null>;

  /** Store a conversation summary (after LLM summarisation). */
  storeMemory(sessionId: string, summary: string, messageCount: number): Promise<void>;

  /** Retrieve relevant memories for a query via hybrid search. */
  recallMemories(
    query: string,
    options?: import('./memoryService.js').MemoryRetrievalOptions,
  ): Promise<import('./memoryService.js').ConversationMemory[]>;

  /** Format retrieved memories for injection into a chat message. */
  formatMemoryContext(memories: import('./memoryService.js').ConversationMemory[]): string;

  /** Get all stored memories. */
  getAllMemories(): Promise<import('./memoryService.js').ConversationMemory[]>;

  /** Delete a specific memory by session ID (M20 F.2). */
  deleteMemory(sessionId: string): Promise<void>;

  /** Get all stored learning concepts (M20 F.1). */
  getAllConcepts(): Promise<import('./memoryService.js').LearningConcept[]>;

  /** Delete a specific learning concept by ID (M20 F.2). */
  deleteConcept(conceptId: number): Promise<void>;

  /** Extract and store user preferences from text. */
  extractAndStorePreferences(text: string): Promise<import('./memoryService.js').UserPreference[]>;

  /** Get all stored user preferences, ordered by frequency. */
  getPreferences(): Promise<import('./memoryService.js').UserPreference[]>;

  /** Format preferences for system prompt injection. */
  formatPreferencesForPrompt(preferences: import('./memoryService.js').UserPreference[]): string;

  /** Delete a specific preference by key. */
  deletePreference(key: string): Promise<void>;

  /** Clear all memories and preferences. */
  clearAll(): Promise<void>;

  // ── Concept-Level Memory (M17 P1.2) ──

  /** Store or update learning concepts extracted from a session. */
  storeConcepts(concepts: import('./memoryService.js').LearningConcept[], sessionId: string): Promise<void>;

  /** Recall concepts relevant to a query via hybrid search. */
  recallConcepts(query: string, topK?: number): Promise<import('./memoryService.js').LearningConcept[]>;

  /** Format recalled concepts for system prompt injection. */
  formatConceptContext(concepts: import('./memoryService.js').LearningConcept[]): string;

  // ── Decay & Eviction (M17 P1.3) ──

  /** Recalculate decay scores for all memories and concepts. */
  recalculateDecayScores(): Promise<void>;

  /** Evict stale memories and concepts that have decayed below threshold. */
  evictStaleContent(): Promise<{ memoriesEvicted: number; conceptsEvicted: number }>;
}

export const IMemoryService = createServiceIdentifier<IMemoryService>('IMemoryService');

// ─── IRelatedContentService (M10 Task 7.1) ─────────────────────────────────

/**
 * Finds pages and files semantically related to a given page using
 * vector similarity search.  Powers the "Related Content" sidebar.
 */
export interface IRelatedContentService extends IDisposable {
  /** Fires when the related content results may have changed. */
  readonly onDidChangeRelated: Event<string>;

  /** Find items related to a given page. */
  findRelated(
    pageId: string,
    options?: import('./relatedContentService.js').FindRelatedOptions,
  ): Promise<import('./relatedContentService.js').RelatedItem[]>;
}

export const IRelatedContentService = createServiceIdentifier<IRelatedContentService>('IRelatedContentService');

// ─── IAutoTaggingService (M10 Task 7.2) ────────────────────────────────────

/**
 * Embedding-based auto-tagging for canvas pages.
 * Suggests and applies tags by propagating from similar pages.
 */
export interface IAutoTaggingService extends IDisposable {
  /** Fires when a page's tags change. */
  readonly onDidChangeTags: Event<import('./autoTaggingService.js').TagChangeEvent>;
  /** Fires when tag suggestions are generated. */
  readonly onDidSuggestTags: Event<{ pageId: string; suggestions: import('./autoTaggingService.js').TagSuggestion[] }>;

  /** Get all tags for a page. */
  getPageTags(pageId: string): Promise<import('./autoTaggingService.js').PageTag[]>;
  /** Suggest tags for a page (does not apply them). */
  suggestTags(pageId: string): Promise<import('./autoTaggingService.js').TagSuggestion[]>;
  /** Auto-tag on save — suggest + apply high-confidence tags. Returns applied suggestions. */
  autoTagOnSave(pageId: string): Promise<import('./autoTaggingService.js').TagSuggestion[]>;
  /** Add a tag to a page. Returns the created tag. */
  addTag(pageId: string, tagName: string, tagColor?: string): Promise<import('./autoTaggingService.js').PageTag>;
  /** Remove a tag from a page. */
  removeTag(pageId: string, tagName: string): Promise<void>;
  /** Get all known tags across all pages. */
  getAllTags(): Promise<import('./autoTaggingService.js').PageTag[]>;
}

export const IAutoTaggingService = createServiceIdentifier<IAutoTaggingService>('IAutoTaggingService');

// ─── IProactiveSuggestionsService (M10 Task 7.4) ──────────────────────────

/**
 * Periodically analyses the knowledge base to detect patterns and
 * surface actionable suggestions (consolidation, orphans, coverage gaps).
 */
export interface IProactiveSuggestionsService extends IDisposable {
  /** Fires when the suggestions list updates. */
  readonly onDidUpdateSuggestions: Event<import('./proactiveSuggestionsService.js').ProactiveSuggestion[]>;

  /** Current active suggestions (excluding dismissed). */
  readonly suggestions: import('./proactiveSuggestionsService.js').ProactiveSuggestion[];

  /** Dismiss a suggestion. */
  dismiss(suggestionId: string): void;

  /** Force an immediate analysis. */
  analyze(): Promise<import('./proactiveSuggestionsService.js').ProactiveSuggestion[]>;
}

export const IProactiveSuggestionsService = createServiceIdentifier<IProactiveSuggestionsService>('IProactiveSuggestionsService');

// ─── IAISettingsService (M15) ────────────────────────────────────────────────

/**
 * Manages AI personality & behavior settings profiles.
 *
 * Persists profiles to IStorage, emits change events so consumers
 * (chat prompt builder, proactive suggestions) react immediately.
 *
 * Interface defined in aiSettings/aiSettingsTypes.ts.
 * DI identifier created here to follow the serviceTypes.ts pattern.
 */
import type { IAISettingsService as IAISettingsServiceType } from '../aiSettings/aiSettingsTypes.js';
export const IAISettingsService = createServiceIdentifier<IAISettingsServiceType>('IAISettingsService');

// ─── IUnifiedAIConfigService (M20) ──────────────────────────────────────────

/**
 * Unified AI Configuration Service — replaces both AISettingsService (M15)
 * and ParallxConfigService (M11) with a single source of truth.
 *
 * Provides preset management, workspace overrides, and merged effective config.
 * Interface defined in aiSettings/unifiedConfigTypes.ts.
 */
import type { IUnifiedAIConfigService as IUnifiedAIConfigServiceType } from '../aiSettings/unifiedConfigTypes.js';
export const IUnifiedAIConfigService = createServiceIdentifier<IUnifiedAIConfigServiceType>('IUnifiedAIConfigService');

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
  /**
   * Optional custom DOM element to render instead of text/iconSvg.
   * When set, `text` and `iconSvg` are ignored for rendering.
   * The element is appended directly into the label container.
   */
  readonly htmlElement?: HTMLElement;
}

/**
 * Accessor returned when adding an entry — allows updating or removing it.
 * VS Code reference: IStatusbarEntryAccessor
 */
export interface StatusBarEntryAccessor extends IDisposable {
  /** Update the entry's mutable properties. */
  update(entry: Partial<Pick<StatusBarEntry, 'text' | 'tooltip' | 'command' | 'iconSvg' | 'htmlElement'>>): void;
}

/**
 * Minimal interface for status bar part operations needed by API consumers.
 * VS Code reference: IStatusbarService
 */
export interface IStatusBarPart {
  addEntry(entry: StatusBarEntry): StatusBarEntryAccessor;
}

// ─── Session Manager ─────────────────────────────────────────────────────────

/**
 * Manages workspace session identity.
 *
 * A "session" starts when a workspace is opened (or the page loads)
 * and ends when the user switches workspace (or the page unloads).
 * Each session gets a unique `sessionId`.
 *
 * VS Code reference: implicit — VS Code uses per-window process isolation.
 * Parallx models the same guarantee explicitly via WorkspaceSessionContext.
 */
export interface ISessionManager {
  /** The currently active session context, or `undefined` before first open. */
  readonly activeContext: IWorkspaceSessionContext | undefined;

  /**
   * Create a new session for the given workspace.
   * Invalidates any previous session (abort + isActive → false).
   */
  beginSession(workspaceId: string, roots: readonly URI[]): IWorkspaceSessionContext;

  /** End the current session (abort + invalidate). No-op if no active session. */
  endSession(): void;

  /** Fired when the active session changes (begin or end). */
  readonly onDidChangeSession: Event<IWorkspaceSessionContext | undefined>;
}
export const ISessionManager = createServiceIdentifier<ISessionManager>('ISessionManager');

// ─── IDiagnosticsService (D3) ──────────────────────────────────────────────

export interface IDiagnosticResult {
  readonly name: string;
  readonly status: 'pass' | 'fail' | 'warn';
  readonly detail: string;
  readonly timestamp: number;
  readonly category?: 'connection' | 'model' | 'rag' | 'config' | 'workspace';
}

export type IDiagnosticCheckProducer = (deps: IDiagnosticCheckDeps) => Promise<IDiagnosticResult>;

export interface IDiagnosticCheckDeps {
  readonly checkProviderStatus?: () => Promise<{ available: boolean; version?: string; error?: string }>;
  readonly getActiveModel?: () => string | undefined;
  readonly listModels?: () => Promise<readonly { id: string; name: string; size?: number }[]>;
  readonly isRAGAvailable?: () => boolean;
  readonly isIndexing?: () => boolean;
  readonly getFileCount?: () => Promise<number>;
  readonly getWorkspaceName: () => string;
  readonly existsRelative?: (path: string) => Promise<boolean>;
  readonly getModelContextLength?: () => number;
  readonly getEffectiveConfig?: () => unknown;
  readonly checkEmbedding?: () => Promise<boolean>;
  readonly getEmbeddingModelInfo?: () => { name: string; dimensions: number; installed: boolean };
  readonly getEmbeddingContextLength?: () => Promise<number>;
  readonly checkVectorStore?: () => Promise<boolean>;
  readonly checkDocumentExtraction?: () => Promise<boolean>;
  readonly checkMemoryService?: () => Promise<boolean>;
  // D7: Observability integration
  readonly getObservabilityMetrics?: () => ISessionMetrics;
}

export interface IDiagnosticsService {
  runChecks(): Promise<readonly IDiagnosticResult[]>;
  getLastResults(): readonly IDiagnosticResult[];
  updateDeps(patch: Partial<IDiagnosticCheckDeps>): void;
  readonly onDidChange: Event<readonly IDiagnosticResult[]>;
}

export const IDiagnosticsService = createServiceIdentifier<IDiagnosticsService>('IDiagnosticsService');

// ─── IObservabilityService (D7) ─────────────────────────────────────────────

export interface ITurnMetrics {
  readonly model: string;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
  readonly durationMs: number;
  readonly timestamp: number;
  readonly budgetUtilization?: {
    readonly system: number;  // actual / allocated ratio (0-1)
    readonly rag: number;
    readonly history: number;
    readonly user: number;
  };
  /** D6-8: Number of overflow-triggered compactions during the turn. */
  readonly overflowCompactions?: number;
  /** D6-8: Number of timeout-triggered compactions during the turn. */
  readonly timeoutCompactions?: number;
  /** D6-2: Best quality score from compaction quality audit (0-1). */
  readonly compactionQualityScore?: number;
  /** D6-3: Number of quality-based retries performed during compaction. */
  readonly compactionQualityRetries?: number;
}

export interface ISessionMetrics {
  readonly turnCount: number;
  readonly totalPromptTokens: number;
  readonly totalCompletionTokens: number;
  readonly totalTokens: number;
  readonly totalDurationMs: number;
  readonly avgDurationMs: number;
  readonly avgPromptTokens: number;
  readonly avgCompletionTokens: number;
}

export interface IModelMetrics {
  readonly model: string;
  readonly turnCount: number;
  readonly totalTokens: number;
  readonly avgDurationMs: number;
  readonly avgPromptTokens: number;
  readonly avgCompletionTokens: number;
}

export interface IObservabilityService {
  recordTurn(metrics: ITurnMetrics): void;
  getSessionMetrics(): ISessionMetrics;
  getModelMetrics(model?: string): readonly IModelMetrics[];
  getTurnHistory(): readonly ITurnMetrics[];
  readonly onDidRecordTurn: Event<ITurnMetrics>;
}

export const IObservabilityService = createServiceIdentifier<IObservabilityService>('IObservabilityService');

// ---------------------------------------------------------------------------
// D4: Runtime Hook Registry
// ---------------------------------------------------------------------------

/** D4-5: Observer for model call lifecycle events. */
export interface IChatRuntimeMessageObserver {
  onBeforeModelCall?(messages: readonly { role: string; content: string }[], model: string): void;
  onAfterModelCall?(messages: readonly { role: string; content: string }[], model: string, durationMs: number): void;
}

/** D4-4: Registry for runtime hooks — tool observers and message observers. */
export interface IRuntimeHookRegistry {
  /** Register a tool invocation observer. Returns a disposable to unregister. */
  registerToolObserver(observer: import('../services/chatRuntimeTypes.js').IChatRuntimeToolInvocationObserver): IDisposable;
  /** Register a message lifecycle observer. Returns a disposable to unregister. */
  registerMessageObserver(observer: IChatRuntimeMessageObserver): IDisposable;
  /** Get a composite tool observer that fires all registered observers (error-isolated). */
  getCompositeToolObserver(): import('../services/chatRuntimeTypes.js').IChatRuntimeToolInvocationObserver;
  /** Get a composite message observer that fires all registered observers (error-isolated). */
  getCompositeMessageObserver(): IChatRuntimeMessageObserver;
}

export const IRuntimeHookRegistry = createServiceIdentifier<IRuntimeHookRegistry>('IRuntimeHookRegistry');

// ── D1: MCP Client Service ──────────────────────────────────────────────────

import type { IMcpServerConfig, IMcpToolSchema, IMcpToolCallResult, McpConnectionState, IMcpHealthInfo } from '../openclaw/mcp/mcpTypes.js';

export interface IMcpClientService extends IDisposable {
  initStorage(storage: IStorage): Promise<void>;
  getConfiguredServers(): readonly IMcpServerConfig[];
  addServerConfig(config: IMcpServerConfig): Promise<void>;
  removeServerConfig(serverId: string): Promise<void>;
  connectServer(config: IMcpServerConfig): Promise<void>;
  disconnectServer(serverId: string): Promise<void>;
  getServerStatus(serverId: string): McpConnectionState;
  getConnectedServers(): readonly string[];
  listTools(serverId: string): Promise<readonly IMcpToolSchema[]>;
  callTool(serverId: string, toolName: string, args: Record<string, unknown>): Promise<IMcpToolCallResult>;
  ping(serverId: string): Promise<number>;
  getHealthInfo(serverId: string): IMcpHealthInfo | undefined;
  readonly onDidChangeStatus: Event<{ serverId: string; status: McpConnectionState }>;
  readonly onDidReceiveNotification: Event<{ serverId: string; method: string; params?: Record<string, unknown> }>;
}

export const IMcpClientService = createServiceIdentifier<IMcpClientService>('IMcpClientService');
