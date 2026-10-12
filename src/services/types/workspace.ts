// workspace.ts — service interfaces for the workspace: folders and state, memory, transcripts, boundaries, global storage.
//
// One file of services/types/; serviceTypes.ts re-exports them all, so import
// from '../serviceTypes.js' as before.

import { createServiceIdentifier } from '../../platform/types.js';
import { IDisposable } from '../../platform/lifecycle.js';
import { Event } from '../../platform/events.js';
import type { Workspace } from '../../workspace/workspace.js';
import type { WorkspaceState, WorkbenchState, WorkspaceFolder, WorkspaceFoldersChangeEvent } from '../../workspace/workspaceTypes.js';
import type { RecentWorkspaceEntry } from '../../workspace/workspaceTypes.js';
import type { URI } from '../../platform/uri.js';
import type { IStorage } from '../../platform/storage.js';

// ─── IWorkspaceService ───────────────────────────────────────────────────────

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
  addFolder(uri: import('../../platform/uri.js').URI, name?: string): void;

  /** Remove a folder from the workspace. */
  removeFolder(uri: import('../../platform/uri.js').URI): void;

  /**
   * Atomically replace all workspace folders.
   *
   * Mirrors VS Code's `updateFolders(foldersToAdd, foldersToRemove)` pattern:
   * fires a **single** `onDidChangeFolders` event so that listeners never see
   * an intermediate zero-folder state.
   */
  updateFolders(foldersToAdd: { uri: import('../../platform/uri.js').URI; name?: string }[]): void;

  /** Get the workspace folder containing the given URI. */
  getWorkspaceFolder(uri: import('../../platform/uri.js').URI): WorkspaceFolder | undefined;

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

  /** Relative path for the user identity file. */
  getUserFileRelativePath(): string;

  /** Read the user identity markdown file. Returns '' if missing. */
  readUserFile(): Promise<string>;

  /** Overwrite the user identity markdown file. */
  writeUserFile(content: string): Promise<void>;

  /** Read the daily memory markdown file for a date. */
  readDailyMemory(date?: Date): Promise<string>;

  /** Ensure the daily memory markdown file exists for a date and return its relative path. */
  ensureDailyMemory(date?: Date): Promise<string>;

  /** Append a note to the daily memory markdown file for a date. */
  appendDailyMemory(text: string, date?: Date): Promise<void>;

  /** Overwrite the daily memory markdown file for a date. Body is rewritten beneath the date header. */
  writeDailyMemory(body: string, date?: Date): Promise<void>;

  // lesson files (progressive disclosure). MEMORY.md is an INDEX
  // of pointers to per-topic lesson files at .parallx/memory/lessons/<slug>.md.
  // Bodies are read on demand by the agent, not auto-loaded.

  /** Relative path of the lessons directory (e.g. `.parallx/memory/lessons`). */
  getLessonsRootRelativePath(): string;

  /** Relative path of a lesson file (e.g. `.parallx/memory/lessons/<slug>.md`). */
  getLessonFileRelativePath(slug: string): string;

  /** Read a lesson file body. Returns '' if missing. */
  readLessonFile(slug: string): Promise<string>;

  /** Write a lesson file body to `.parallx/memory/lessons/<slug>.md`. Creates the directory if missing. */
  writeLessonFile(slug: string, content: string): Promise<void>;

  /** Move a lesson from `lessons/<slug>.md` to `_archive/lessons/<slug>.md`. Returns true if archived. */
  archiveLessonFile(slug: string): Promise<boolean>;

  /** List slugs (without `.md`) of lesson files currently on disk. */
  listLessons(): Promise<string[]>;

  /** Parse `- [Title](lessons/slug.md) — desc` index lines from MEMORY.md. */
  parseMemoryIndex(): Promise<Array<{ slug: string; description: string; path: string }>>;

  /** Idempotent: replace the line for `slug` if present, else append a new entry. Description truncated to 120 chars. */
  addMemoryIndexEntry(slug: string, description: string): Promise<void>;

  /** Remove the index line matching `slug`. No-op if absent. */
  removeMemoryIndexEntry(slug: string): Promise<void>;

  /** Idempotent migration: if MEMORY.md contains a `## Concepts` section the old regex extraction wrote, archive it. */
  archiveLegacyConceptSection(): Promise<{ archived: boolean; movedChars: number }>;

  /** Append a structured session summary block to the daily memory file. */
  appendSessionSummary(sessionId: string, summary: string, messageCount: number, date?: Date): Promise<void>;

  /** Sync the durable preferences section in MEMORY.md from canonical preference records. */
  syncPreferences(preferences: Array<{ key: string; value: string }>): Promise<void>;

  /** Read canonical durable preferences as key-value pairs. */
  readPreferences(): Promise<Array<{ key: string; value: string }>>;

  /** Merge preference records into canonical durable memory. */
  upsertPreferences(preferences: Array<{ key: string; value: string }>): Promise<void>;

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
  writeSessionTranscript(session: import('../chatTypes.js').IChatSession): Promise<void>;

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

// ─── IGlobalStorageService ──────────────────────────────────────────────────

/** Global storage exposed as a DI service for built-in tools. */
export const IGlobalStorageService = createServiceIdentifier<IStorage>('IGlobalStorageService');

/** Workspace storage exposed as a DI service for built-in tools. */
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
