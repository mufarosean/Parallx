// editors.ts — service interfaces for editors and files: resolution, groups, the file service, text file models.
//
// One file of services/types/; serviceTypes.ts re-exports them all, so import
// from '../serviceTypes.js' as before.

import { createServiceIdentifier } from '../../platform/types.js';
import { IDisposable } from '../../platform/lifecycle.js';
import { Event } from '../../platform/events.js';
import type { EditorResolverRegistration, EditorResolution } from '../editorResolverService.js';
import type { IEditorInput } from '../../editor/editorInput.js';
import type { EditorOpenOptions } from '../../editor/editorTypes.js';
import type { EditorGroupView } from '../../editor/editorGroupView.js';
import { GroupDirection } from '../../editor/editorTypes.js';
import { PartId } from '../../parts/partTypes.js';

// ─── IEditorResolverService ──────────────────────────────────────────────────

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
  resolve(uri: import('../../platform/uri.js').URI): EditorResolution | undefined;

  /**
   * Find the registration that would handle a given URI, without creating instances.
   */
  findRegistration(uri: import('../../platform/uri.js').URI): EditorResolverRegistration | undefined;

  /**
   * Find a registration by its ID.
   */
  findById(id: string): EditorResolverRegistration | undefined;

  /**
   * Get all registrations.
   */
  getRegistrations(): readonly EditorResolverRegistration[];
}

// (The IEditorResolverService IDENTIFIER was deleted by the Retirement phase:
// it was the only identifier in this file never registered and never resolved.
// The interface above stays — EditorResolverService implements it and is
// constructed directly in workbenchFileEditorSetup, outside DI.)

// ─── IEditorService ──────────────────────────────────────────────────────────

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
  /**
   * Pre-rendered SVG/HTML for the editor's icon when the input opted to
   * provide one. Empty / undefined means consumers should fall back to
   * deriving an icon from the filename extension (the default path for
   * file-backed editors).
   */
  readonly iconHtml?: string;
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

  /**
   * Focus an already-open editor by its id. Activates the owning group and
   * selects the editor within that group. Returns false if no editor with
   * the given id is currently open.
   */
  focusEditor(editorId: string): Promise<boolean>;

  /** Close the active editor (or a specific one). */
  closeEditor(input?: IEditorInput, groupId?: string, force?: boolean): Promise<boolean>;
}

export const IEditorService = createServiceIdentifier<IEditorService>('IEditorService');

// ─── IEditorGroupService ─────────────────────────────────────────────────────

export { GroupDirection };

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

// ─── IFileService ──────────────────────────────────────────────────────────

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
  setBoundaryChecker(checker: ((uri: import('../../platform/uri.js').URI, operation: string) => void) | undefined): void;

  /** Read a file's content. */
  readFile(uri: import('../../platform/uri.js').URI): Promise<import('../../platform/fileTypes.js').FileContent>;

  /** Write string content to a file (creates parent dirs if needed). */
  writeFile(uri: import('../../platform/uri.js').URI, content: string): Promise<void>;

  /** Get stat information for a file or directory. */
  stat(uri: import('../../platform/uri.js').URI): Promise<import('../../platform/fileTypes.js').FileStat>;

  /** List directory entries, sorted directories-first then alphabetical. */
  readdir(uri: import('../../platform/uri.js').URI): Promise<import('../../platform/fileTypes.js').FileEntry[]>;

  /** Check if a resource exists. */
  exists(uri: import('../../platform/uri.js').URI): Promise<boolean>;

  /** Rename or move a resource. */
  rename(source: import('../../platform/uri.js').URI, target: import('../../platform/uri.js').URI): Promise<void>;

  /** Delete a resource. */
  delete(uri: import('../../platform/uri.js').URI, options?: import('../../platform/fileTypes.js').FileDeleteOptions): Promise<void>;

  /** Create a directory (recursive). */
  mkdir(uri: import('../../platform/uri.js').URI): Promise<void>;

  /** Copy a file or directory. */
  copy(source: import('../../platform/uri.js').URI, target: import('../../platform/uri.js').URI): Promise<void>;

  /**
   * Start watching a path for changes. Returns a disposable that stops watching.
   *
   * `ignoreSegments` drops events whose path contains any of the given
   * segments before they cross IPC (see WATCH_IGNORE_SEGMENTS in
   * parallxIgnore.ts). Coarse volume control, not policy — `.parallxignore`
   * remains the real filter and is applied by consumers.
   */
  watch(
    uri: import('../../platform/uri.js').URI,
    options?: { readonly ignoreSegments?: readonly string[] },
  ): Promise<IDisposable>;

  /** Fires when files change (create, modify, delete). */
  readonly onDidFileChange: Event<import('../../platform/fileTypes.js').FileChangeEvent[]>;

  // ── Dialogs ──

  /** Open native file picker. Returns selected file URIs, or null if cancelled. */
  openFileDialog(options?: import('../../platform/fileTypes.js').OpenFileOptions): Promise<import('../../platform/uri.js').URI[] | null>;

  /** Open native folder picker. Returns selected folder URIs, or null if cancelled. */
  openFolderDialog(options?: import('../../platform/fileTypes.js').OpenFolderOptions): Promise<import('../../platform/uri.js').URI[] | null>;

  /** Open native save dialog. Returns target URI, or null if cancelled. */
  saveFileDialog(options?: import('../../platform/fileTypes.js').SaveFileOptions): Promise<import('../../platform/uri.js').URI | null>;

  /** Show a native OS message box. */
  showMessageBox(options: import('../../platform/fileTypes.js').MessageBoxOptions): Promise<import('../../platform/fileTypes.js').MessageBoxResult>;

  // ── Rich Document Extraction ──

  /**
   * Extract plain text from a rich document file (PDF, Excel, Word).
   * Returns the extracted text, the format identifier, and optional metadata.
   * Throws if the file is not a supported rich document format.
   */
  readDocumentText(uri: import('../../platform/uri.js').URI): Promise<{ text: string; format: string; metadata?: Record<string, unknown>; pageTexts?: readonly string[] }>;

  /**
   * A PDF's text, one string per page, in page order (page 1 first). Cached
   * until the file changes. Undefined for any file that is not a PDF.
   */
  readPdfPages(uri: import('../../platform/uri.js').URI): Promise<readonly string[] | undefined>;

  /**
   * How a file is addressed and, given a quote, every spot it occurs: the
   * PDF page (1 = first page of the file), the text line, or the
   * spreadsheet sheet and cell (the workbook's own A1 reference).
   */
  locateInFile(uri: import('../../platform/uri.js').URI, quote?: string): Promise<import('../fileLocator.js').IFileLocateResult>;

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

// ─── ITextFileModelManager ────────────────────────────────────────────────

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
  resolve(uri: import('../../platform/uri.js').URI): Promise<import('../textFileModelManager.js').TextFileModel>;

  /** Get existing model without loading (returns undefined if not tracked). */
  get(uri: import('../../platform/uri.js').URI): import('../textFileModelManager.js').TextFileModel | undefined;

  /** All currently managed models. */
  readonly models: readonly import('../textFileModelManager.js').TextFileModel[];

  /** Save all dirty models. */
  saveAll(): Promise<void>;

  /** Fires when a new model is created. */
  readonly onDidCreate: Event<import('../textFileModelManager.js').TextFileModel>;

  /** Fires when a model is disposed. */
  readonly onDidDispose: Event<import('../../platform/uri.js').URI>;
}

export const ITextFileModelManager = createServiceIdentifier<ITextFileModelManager>('ITextFileModelManager');
