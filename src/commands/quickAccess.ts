// quickAccess.ts — unified quick-access overlay (command palette + workspace picker)
//
// VS Code parity:
//   - `src/vs/platform/quickinput/browser/quickAccess.ts`  (QuickAccessController)
//   - `src/vs/platform/quickinput/common/quickAccess.ts`   (registry + provider interface)
//   - `src/vs/workbench/contrib/quickaccess/browser/commandsQuickAccess.ts` (command mode)
//   - `src/vs/workbench/browser/actions/quickAccessActions.ts` (quickOpen / showCommands)
//
// Architecture:
//   QuickAccessWidget hosts a single input + list overlay.
//   Based on the current input prefix it delegates to a "provider":
//     '>'  → CommandsProvider   (existing command palette behavior)
//     ''   → GeneralProvider    (recent workspaces + view navigation)
//   When the user types or backspaces across the prefix boundary the active
//   provider is swapped dynamically — matching VS Code's QuickAccessController
//   behaviour.
//
// Keybindings:
//   Ctrl+Shift+P → workbench.action.showCommands  → show('>')
//   Ctrl+P       → workbench.action.quickOpen      → show('')
//   Escape       → dismiss

import { Disposable, IDisposable } from '../platform/lifecycle.js';
import { Emitter, Event } from '../platform/events.js';
import type { CommandDescriptor } from './commandTypes.js';
import type { CommandService } from './commandRegistry.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_VISIBLE_ITEMS = 15;
const MAX_RECENT_COMMANDS = 5;
const PALETTE_WIDTH = 600;
const RECENT_STORAGE_KEY = 'parallx:commandPalette:recent';

/** VS Code prefix for command mode. */
const COMMAND_PREFIX = '>';

// ── File picker constants (M4 Cap 6) ────────────────────────────────────────

const RECENT_FILES_KEY = 'parallx:quickAccess:recentFiles';
const MAX_RECENT_FILES = 20;
const MAX_FILE_RESULTS = 50;
const FILE_SCAN_DEPTH = 10;

/** Directory names excluded from recursive file scanning. */
const EXCLUDED_DIRS = new Set([
  'node_modules', '.git', '__pycache__', 'dist', 'build', '.next',
]);

// ─── Fuzzy match ─────────────────────────────────────────────────────────────

/**
 * Simple fuzzy match: every character in the query must appear in order
 * within the target (case-insensitive). Returns a score (lower is better)
 * or -1 if no match.
 */
function fuzzyScore(query: string, target: string): number {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let qi = 0;
  let score = 0;
  let lastMatchIndex = -1;

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      const gap = lastMatchIndex >= 0 ? ti - lastMatchIndex - 1 : ti;
      score += gap;
      lastMatchIndex = ti;
      qi++;
    }
  }

  return qi === q.length ? score : -1;
}

// ─── Quick‑access item types ─────────────────────────────────────────────────

interface QuickAccessItem {
  id: string;
  label: string;
  /** Secondary text shown to the right of the label. */
  detail?: string;
  /** Category prefix shown before the label. */
  category?: string;
  /** Keybinding text (command mode only). */
  keybinding?: string;
  /** "recently used" badge (command mode only). */
  isRecent?: boolean;
  /** Group label for section separators. */
  group?: string;
  /** Fuzzy score for sorting. */
  score: number;
  /** Callback when selected. */
  accept: () => void;
}

// ─── Provider interface ──────────────────────────────────────────────────────

/**
 * A Quick Access provider populates the item list for a given prefix.
 * Mirrors VS Code's `IQuickAccessProvider.provide()` pattern.
 */
interface IQuickAccessProvider {
  readonly prefix: string;
  readonly placeholder: string;
  getItems(query: string): QuickAccessItem[] | Promise<QuickAccessItem[]>;
}

// ─── Minimal dependency shapes (avoid circular imports) ──────────────────────

/** Minimal shape to avoid circular import from workbenchContext. */
interface IContextKeyServiceLike {
  contextMatchesRules(whenClause: string | undefined): boolean;
}

/** Minimal shape of menu contribution processor for palette filtering. */
interface IMenuContributionLike {
  isCommandVisibleInPalette(commandId: string): boolean;
}

/** Minimal shape of keybinding contribution processor for display. */
interface IKeybindingContributionLike {
  getKeybindingForCommand(commandId: string): { key: string } | undefined;
}

/** Minimal shape of workspace service for recent workspaces. */
interface IWorkspaceServiceLike {
  readonly workspace: { readonly id: string; readonly name: string };
  getRecentWorkspaces(): Promise<readonly { identity: { id: string; name: string }; metadata: { lastAccessedAt: string } }[]>;
  switchWorkspace(workspaceId: string): Promise<void>;
}

// ── File picker types (M4 Cap 6) ────────────────────────────────────────────

/** Minimal shape for file-picker scanning — avoids circular imports. */
interface IFilePickerDelegate {
  getWorkspaceFolders(): readonly { uri: string; name: string }[];
  readDirectory(dirUri: string): Promise<readonly { name: string; uri: string; type: number }[]>;
  onDidChangeFolders(listener: () => void): IDisposable;
}

interface FilePickerEntry {
  readonly name: string;
  readonly uri: string;
  readonly relativePath: string;
  readonly folderName: string;
}

// ═════════════════════════════════════════════════════════════════════════════
// Commands Provider — existing command palette behaviour under '>' prefix
// ═════════════════════════════════════════════════════════════════════════════

class CommandsProvider implements IQuickAccessProvider {
  readonly prefix = COMMAND_PREFIX;
  readonly placeholder = 'Type the name of a command to run.';

  constructor(
    private readonly _commandService: CommandService,
    private readonly _getContextKeyService: () => IContextKeyServiceLike | undefined,
    private readonly _getMenuContribution: () => IMenuContributionLike | undefined,
    private readonly _getKeybindingContribution: () => IKeybindingContributionLike | undefined,
    private readonly _getRecentCommandIds: () => string[],
    private readonly _executeCommand: (commandId: string) => void,
  ) {}

  getItems(query: string): QuickAccessItem[] {
    const commands = this._commandService.getCommands();
    const contextKeyService = this._getContextKeyService();
    const menuContribution = this._getMenuContribution();
    const keybindingContribution = this._getKeybindingContribution();
    const recentIds = this._getRecentCommandIds();
    const recentSet = new Set(recentIds);
    const items: QuickAccessItem[] = [];

    for (const [, desc] of commands) {
      // When-clause filtering
      if (desc.when && contextKeyService) {
        if (!contextKeyService.contextMatchesRules(desc.when)) continue;
      }
      // Menu contribution filtering
      if (menuContribution && !menuContribution.isCommandVisibleInPalette(desc.id)) continue;

      const searchText = desc.category ? `${desc.category}: ${desc.title}` : desc.title;
      const score = query.length > 0 ? fuzzyScore(query, searchText) : 0;
      if (query.length > 0 && score < 0) continue;

      const keybinding = desc.keybinding
        ?? keybindingContribution?.getKeybindingForCommand(desc.id)?.key;

      items.push({
        id: desc.id,
        label: desc.title,
        category: desc.category,
        keybinding,
        isRecent: recentSet.has(desc.id),
        score,
        accept: () => this._executeCommand(desc.id),
      });
    }

    // Sort: recents first (when no query), then by score, then alphabetically
    items.sort((a, b) => {
      if (query.length === 0) {
        if (a.isRecent && !b.isRecent) return -1;
        if (!a.isRecent && b.isRecent) return 1;
        if (a.isRecent && b.isRecent) {
          return recentIds.indexOf(a.id) - recentIds.indexOf(b.id);
        }
      }
      if (a.score !== b.score) return a.score - b.score;
      return a.label.localeCompare(b.label);
    });

    return items;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// General Provider — recent workspaces + view navigation under '' prefix
// ═════════════════════════════════════════════════════════════════════════════

class GeneralProvider implements IQuickAccessProvider {
  readonly prefix = '';
  readonly placeholder = 'Search files, workspaces, or type > for commands.';

  // ── File picker state (M4 Cap 6) ──────────────────────────────────────
  private _fileScanner: WorkspaceFileScanner | undefined;
  private _openFileEditor: ((uri: string) => void) | undefined;
  private _recentFileUris: string[] = [];

  constructor(
    private readonly _getWorkspaceService: () => IWorkspaceServiceLike | undefined,
  ) {
    this._loadRecentFiles();
  }

  // ── File picker setters (M4 Cap 6) ────────────────────────────────────

  setFileScanner(scanner: WorkspaceFileScanner): void {
    this._fileScanner = scanner;
  }

  setOpenFileEditor(fn: (uri: string) => void): void {
    this._openFileEditor = fn;
  }

  // ── Recent files persistence (M4 Cap 6) ───────────────────────────────

  private _loadRecentFiles(): void {
    try {
      const raw = localStorage.getItem(RECENT_FILES_KEY);
      this._recentFileUris = raw ? JSON.parse(raw) : [];
    } catch {
      this._recentFileUris = [];
    }
  }

  private _saveRecentFiles(): void {
    try {
      localStorage.setItem(RECENT_FILES_KEY, JSON.stringify(this._recentFileUris));
    } catch { /* storage full */ }
  }

  pushRecentFile(uri: string): void {
    this._recentFileUris = [
      uri,
      ...this._recentFileUris.filter((u) => u !== uri),
    ].slice(0, MAX_RECENT_FILES);
    this._saveRecentFiles();
  }

  // ── Items ─────────────────────────────────────────────────────────────

  async getItems(query: string): Promise<QuickAccessItem[]> {
    const items: QuickAccessItem[] = [];
    const hasWorkspaceFolders = this._fileScanner
      && (this._fileScanner.cached?.length ?? 0) > 0
      || this._fileScanner?.isScanning;

    // ── File results (M4 Cap 6) ─────────────────────────────────────────
    if (this._fileScanner) {
      this._fileScanner.ensureScanned();
      const files = this._fileScanner.cached;

      if (files) {
        const recentSet = new Set(this._recentFileUris);
        const recentOrder = this._recentFileUris;
        const openFn = this._openFileEditor;

        // Score and collect
        const scored: { entry: FilePickerEntry; score: number; isRecent: boolean }[] = [];
        for (const file of files) {
          const score = query.length > 0 ? fuzzyScore(query, file.name) : 0;
          if (query.length > 0 && score < 0) continue;
          scored.push({ entry: file, score, isRecent: recentSet.has(file.uri) });
        }

        // Sort: recent first (by recency order), then score, then alpha
        scored.sort((a, b) => {
          if (a.isRecent && !b.isRecent) return -1;
          if (!a.isRecent && b.isRecent) return 1;
          if (a.isRecent && b.isRecent) {
            return recentOrder.indexOf(a.entry.uri) - recentOrder.indexOf(b.entry.uri);
          }
          if (a.score !== b.score) return a.score - b.score;
          return a.entry.name.localeCompare(b.entry.name);
        });

        const limit = Math.min(scored.length, MAX_FILE_RESULTS);
        for (let i = 0; i < limit; i++) {
          const { entry, score, isRecent } = scored[i];
          items.push({
            id: `file:${entry.uri}`,
            label: entry.name,
            detail: entry.relativePath,
            group: 'files',
            score: isRecent ? -1 : score,
            isRecent,
            accept: () => {
              this.pushRecentFile(entry.uri);
              openFn?.(entry.uri);
            },
          });
        }
      } else if (this._fileScanner.isScanning) {
        items.push({
          id: 'files:searching',
          label: 'Searching files…',
          detail: '',
          group: 'files',
          score: 0,
          accept: () => {},
        });
      }
    }

    // ── Workspace results ───────────────────────────────────────────────
    const workspaceService = this._getWorkspaceService();
    if (workspaceService) {
      const currentId = workspaceService.workspace.id;
      try {
        const recents = await workspaceService.getRecentWorkspaces();
        for (const entry of recents) {
          if (entry.identity.id === currentId) continue;

          const label = entry.identity.name;
          const score = query.length > 0 ? fuzzyScore(query, label) : 0;
          if (query.length > 0 && score < 0) continue;

          const lastAccessed = entry.metadata.lastAccessedAt
            ? _formatRelativeTime(entry.metadata.lastAccessedAt)
            : '';

          items.push({
            id: `workspace:${entry.identity.id}`,
            label,
            detail: lastAccessed,
            group: 'recent workspaces',
            score,
            accept: () => {
              workspaceService.switchWorkspace(entry.identity.id).catch((err) => {
                console.error('[QuickAccess] Failed to switch workspace:', err);
              });
            },
          });
        }
      } catch (err) {
        console.warn('[QuickAccess] Failed to load recent workspaces:', err);
      }
    }

    // Sort: files before workspaces (group order), then within each group
    // the items are already sorted by their insertion logic
    return items;
  }
}

/** Format an ISO date string as a relative time label (e.g. "2 hours ago"). */
function _formatRelativeTime(isoString: string): string {
  try {
    const dt = new Date(isoString);
    const now = Date.now();
    const diffMs = now - dt.getTime();
    if (diffMs < 0) return '';
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `${diffH}h ago`;
    const diffD = Math.floor(diffH / 24);
    if (diffD < 30) return `${diffD}d ago`;
    return dt.toLocaleDateString();
  } catch {
    return '';
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Workspace File Scanner (M4 Cap 6)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Recursively scans workspace folders for files, caching results.
 * Scanning is async and non-blocking — results are available via `cached`.
 * Cache is invalidated when workspace folders change.
 */
class WorkspaceFileScanner {
  private _cache: FilePickerEntry[] | null = null;
  private _scanPromise: Promise<void> | null = null;
  private _version = 0;

  private readonly _onDidScan = new Emitter<void>();
  readonly onDidScan: Event<void> = this._onDidScan.event;

  constructor(private readonly _delegate: IFilePickerDelegate) {
    _delegate.onDidChangeFolders(() => this.invalidate());
  }

  invalidate(): void {
    this._cache = null;
    this._version++;
    this._scanPromise = null;
  }

  get cached(): readonly FilePickerEntry[] | null {
    return this._cache;
  }

  get isScanning(): boolean {
    return this._scanPromise !== null && this._cache === null;
  }

  /** Start scanning (if not already in progress or cached). */
  ensureScanned(): void {
    if (this._cache || this._scanPromise) return;
    const version = ++this._version;
    this._scanPromise = this._doScan(version)
      .then(() => {
        if (this._version === version) {
          this._onDidScan.fire();
        }
      })
      .catch((err) => {
        console.warn('[FileScanner] scan failed:', err);
      });
  }

  private async _doScan(version: number): Promise<void> {
    const files: FilePickerEntry[] = [];
    const folders = this._delegate.getWorkspaceFolders();

    for (const folder of folders) {
      if (this._version !== version) return;
      await this._scanDir(folder.uri, folder.name, '', files, 0, version);
    }

    if (this._version === version) {
      this._cache = files;
    }
  }

  private async _scanDir(
    dirUri: string,
    folderName: string,
    relativePath: string,
    out: FilePickerEntry[],
    depth: number,
    version: number,
  ): Promise<void> {
    if (depth >= FILE_SCAN_DEPTH || this._version !== version) return;

    try {
      const entries = await this._delegate.readDirectory(dirUri);
      for (const entry of entries) {
        if (this._version !== version) return;

        const childRelative = relativePath
          ? `${relativePath}/${entry.name}`
          : entry.name;

        if (entry.type === 2 /* Directory */) {
          if (EXCLUDED_DIRS.has(entry.name)) continue;
          await this._scanDir(
            entry.uri, folderName, childRelative, out, depth + 1, version,
          );
        } else if (entry.type === 1 /* File */) {
          out.push({
            name: entry.name,
            uri: entry.uri,
            relativePath: childRelative,
            folderName,
          });
        }
      }
    } catch (err) {
      console.warn('[FileScanner] readdir failed:', dirUri, err);
    }
  }

  dispose(): void {
    this._onDidScan.dispose();
    this._version++;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// QuickAccessWidget — the unified overlay
// ═════════════════════════════════════════════════════════════════════════════

export class QuickAccessWidget extends Disposable {
  // ── DOM refs ───────────────────────────────────────────────────────────
  private _overlay: HTMLElement | null = null;
  private _input: HTMLInputElement | null = null;
  private _listEl: HTMLElement | null = null;

  // ── State ──────────────────────────────────────────────────────────────
  private _visible = false;
  private _items: QuickAccessItem[] = [];
  private _selectedIndex = 0;
  private _activeProvider: IQuickAccessProvider | undefined;
  private _recentCommandIds: string[] = [];

  // ── Providers ──────────────────────────────────────────────────────────
  private readonly _commandsProvider: CommandsProvider;
  private readonly _generalProvider: GeneralProvider;

  // ── Dependency accessors ───────────────────────────────────────────────
  private _contextKeyService: IContextKeyServiceLike | undefined;
  private _menuContribution: IMenuContributionLike | undefined;
  private _keybindingContribution: IKeybindingContributionLike | undefined;
  private _workspaceService: IWorkspaceServiceLike | undefined;
  private _focusTracker: { suspend(): void; resume(restore?: boolean): void } | undefined;

  // ── Events ─────────────────────────────────────────────────────────────
  private readonly _onDidExecute = this._register(new Emitter<string>());
  readonly onDidExecute: Event<string> = this._onDidExecute.event;

  private readonly _onDidHide = this._register(new Emitter<void>());
  readonly onDidHide: Event<void> = this._onDidHide.event;

  constructor(
    private readonly _commandService: CommandService,
    private readonly _container: HTMLElement,
  ) {
    super();
    this._loadRecent();

    // Track executed commands for recents
    this._register(this._commandService.onDidExecuteCommand((e) => {
      this._pushRecent(e.commandId);
    }));

    // Create providers
    this._commandsProvider = new CommandsProvider(
      this._commandService,
      () => this._contextKeyService,
      () => this._menuContribution,
      () => this._keybindingContribution,
      () => this._recentCommandIds,
      (id) => this._executeCommandById(id),
    );

    this._generalProvider = new GeneralProvider(
      () => this._workspaceService,
    );
  }

  // ── Dependency setters ─────────────────────────────────────────────────

  setContextKeyService(service: IContextKeyServiceLike): void {
    this._contextKeyService = service;
  }

  setMenuContribution(service: IMenuContributionLike): void {
    this._menuContribution = service;
  }

  setKeybindingContribution(service: IKeybindingContributionLike): void {
    this._keybindingContribution = service;
  }

  setWorkspaceService(service: IWorkspaceServiceLike): void {
    this._workspaceService = service;
  }

  setFocusTracker(tracker: { suspend(): void; resume(restore?: boolean): void }): void {
    this._focusTracker = tracker;
  }

  /**
   * Wire the file picker delegate (M4 Cap 6).
   * Creates a workspace file scanner that feeds file results into the
   * general provider. When scanning completes, the visible list is refreshed.
   */
  setFilePickerDelegate(
    delegate: IFilePickerDelegate,
    openFileEditor: (uri: string) => void,
  ): void {
    const scanner = new WorkspaceFileScanner(delegate);
    this._generalProvider.setFileScanner(scanner);
    this._generalProvider.setOpenFileEditor(openFileEditor);

    // Re-render when background scan completes
    this._register({
      dispose: scanner.onDidScan(() => {
        if (this._visible && this._activeProvider === this._generalProvider) {
          this._resolveProviderAndUpdate();
        }
      }).dispose,
    });
  }

  // ── Public API ─────────────────────────────────────────────────────────

  get visible(): boolean {
    return this._visible;
  }

  /**
   * Open Quick Access with an optional initial value.
   *
   * VS Code parity:
   *   - `quickAccess.show('>')` → command mode (Ctrl+Shift+P)
   *   - `quickAccess.show('')`  → general mode (Ctrl+P)
   *
   * @param value Initial input value. Defaults to `>` (command mode) for compat.
   */
  show(value: string = COMMAND_PREFIX): void {
    if (this._visible) {
      // If already visible, just update the value and switch mode
      if (this._input) {
        this._input.value = value;
        this._resolveProviderAndUpdate();
      }
      return;
    }
    this._visible = true;
    // Suspend workbench focus tracking while overlay is open (Cap 8.3)
    this._focusTracker?.suspend();
    this._createDOM();
    if (this._input) {
      this._input.value = value;
      // For command mode, select only the text after the prefix so
      // the user can immediately start typing a command name
      if (value === COMMAND_PREFIX) {
        this._input.setSelectionRange(value.length, value.length);
      }
    }
    this._resolveProviderAndUpdate();
    this._input?.focus();
  }

  hide(): void {
    if (!this._visible) return;
    this._visible = false;
    this._destroyDOM();
    // Resume workbench focus tracking and restore previous focus (Cap 8.3)
    this._focusTracker?.resume(true);
    this._onDidHide.fire();
  }

  /**
   * Toggle the command palette (legacy compat).
   * Opens in command mode if not visible, hides if visible.
   */
  toggle(): void {
    if (this._visible) {
      this.hide();
    } else {
      this.show(COMMAND_PREFIX);
    }
  }

  // ── Recent commands persistence ────────────────────────────────────────

  private _loadRecent(): void {
    try {
      const raw = localStorage.getItem(RECENT_STORAGE_KEY);
      this._recentCommandIds = raw ? JSON.parse(raw) : [];
    } catch {
      this._recentCommandIds = [];
    }
  }

  private _saveRecent(): void {
    try {
      localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(this._recentCommandIds));
    } catch { /* storage full */ }
  }

  private _pushRecent(commandId: string): void {
    this._recentCommandIds = [
      commandId,
      ...this._recentCommandIds.filter((id) => id !== commandId),
    ].slice(0, MAX_RECENT_COMMANDS);
    this._saveRecent();
  }

  // ── Provider resolution ────────────────────────────────────────────────

  /**
   * Determine which provider should be active based on the current input
   * value, then refresh the item list.
   *
   * VS Code parity: QuickAccessController.doShowOrPick determines the
   * provider via `registry.getQuickAccessProvider(value)` which matches
   * by longest prefix. We have only two providers so a simple startsWith
   * check suffices.
   */
  private _resolveProviderAndUpdate(): void {
    const value = this._input?.value ?? '';
    const provider = value.startsWith(COMMAND_PREFIX)
      ? this._commandsProvider
      : this._generalProvider;

    const providerChanged = provider !== this._activeProvider;
    this._activeProvider = provider;

    // Update placeholder when provider changes
    if (providerChanged && this._input) {
      this._input.placeholder = provider.placeholder;
    }

    // Strip prefix to get the filter query
    const query = value.startsWith(COMMAND_PREFIX)
      ? value.slice(COMMAND_PREFIX.length).trimStart()
      : value;

    this._updateItems(query);
  }

  // ── Item list ──────────────────────────────────────────────────────────

  private async _updateItems(query: string): Promise<void> {
    if (!this._activeProvider) return;
    const items = await this._activeProvider.getItems(query);
    this._items = items;
    this._selectedIndex = items.length > 0 ? 0 : -1;
    this._renderItems();
  }

  // ── DOM creation ───────────────────────────────────────────────────────

  private _createDOM(): void {
    // Overlay backdrop
    const overlay = document.createElement('div');
    overlay.className = 'command-palette-overlay';
    // Accessibility: modal overlay traps focus (Cap 8.3)
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Quick Access');
    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay) this.hide();
    });

    // Palette container
    const palette = document.createElement('div');
    palette.className = 'command-palette';

    // Input
    const input = document.createElement('input');
    input.className = 'command-palette-input';
    input.type = 'text';
    input.spellcheck = false;
    input.autocomplete = 'off';
    input.addEventListener('input', () => this._resolveProviderAndUpdate());
    input.addEventListener('keydown', (e) => this._onInputKeydown(e));

    // List
    const list = document.createElement('div');
    list.className = 'command-palette-list';
    list.setAttribute('role', 'listbox');

    // Focus-trap keydown on list items: Tab returns to input, Escape closes (Cap 8.3)
    list.addEventListener('keydown', (e: KeyboardEvent) => {
      switch (e.key) {
        case 'Tab':
          e.preventDefault();
          if (e.shiftKey || !e.shiftKey) {
            // Always cycle back to input
            this._input?.focus();
          }
          break;
        case 'Escape':
          e.preventDefault();
          this.hide();
          break;
        case 'ArrowDown':
          e.preventDefault();
          this._moveSelection(1);
          break;
        case 'ArrowUp':
          e.preventDefault();
          this._moveSelection(-1);
          break;
        case 'Enter':
          e.preventDefault();
          this._acceptSelected();
          break;
      }
    });

    palette.appendChild(input);
    palette.appendChild(list);
    overlay.appendChild(palette);
    this._container.appendChild(overlay);

    this._overlay = overlay;
    this._input = input;
    this._listEl = list;
  }

  private _destroyDOM(): void {
    if (this._overlay) {
      this._overlay.remove();
      this._overlay = null;
      this._input = null;
      this._listEl = null;
    }
  }

  // ── Keyboard handling ──────────────────────────────────────────────────

  private _onInputKeydown(e: KeyboardEvent): void {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        this._moveSelection(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        this._moveSelection(-1);
        break;
      case 'Enter':
        e.preventDefault();
        this._acceptSelected();
        break;
      case 'Escape':
        e.preventDefault();
        this.hide();
        break;
      case 'Tab':
        // Focus trap — Tab cycles only within Quick Access (Cap 8.3)
        e.preventDefault();
        // Only two focusable elements: input and list.
        // Tab from input focuses first visible item, Shift+Tab stays on input.
        if (!e.shiftKey && this._listEl) {
          const firstItem = this._listEl.querySelector('.command-palette-item') as HTMLElement | null;
          if (firstItem) {
            firstItem.focus();
          }
        }
        // Shift+Tab always keeps focus on input (it's the first element)
        break;
    }
  }

  // ── List rendering ─────────────────────────────────────────────────────

  private _renderItems(): void {
    const list = this._listEl;
    if (!list) return;

    list.innerHTML = '';

    if (this._items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'command-palette-empty';
      empty.textContent = this._activeProvider === this._commandsProvider
        ? 'No matching commands'
        : 'No matching files or workspaces';
      list.appendChild(empty);
      return;
    }

    const visibleItems = this._items.slice(0, MAX_VISIBLE_ITEMS);
    let lastGroup: string | undefined;
    let lastWasRecent = false;

    for (let i = 0; i < visibleItems.length; i++) {
      const item = visibleItems[i];

      // Section separator — command mode: recent vs other
      if (this._activeProvider === this._commandsProvider) {
        if (lastWasRecent && !item.isRecent && (this._input?.value ?? '').trim() === COMMAND_PREFIX) {
          const sep = document.createElement('div');
          sep.className = 'command-palette-separator';
          list.appendChild(sep);
        }
        lastWasRecent = !!item.isRecent;
      } else {
        // General mode: group separators
        if (item.group && item.group !== lastGroup) {
          const sep = document.createElement('div');
          sep.className = 'command-palette-group-label';
          sep.textContent = item.group;
          list.appendChild(sep);
          lastGroup = item.group;
        }
      }

      const row = document.createElement('div');
      row.className = 'command-palette-item';
      row.tabIndex = -1; // Focusable for keyboard navigation (Cap 8.3)
      if (i === this._selectedIndex) row.classList.add('selected');
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', i === this._selectedIndex ? 'true' : 'false');

      // Label
      const labelEl = document.createElement('span');
      labelEl.className = 'command-palette-item-label';

      if (item.category) {
        const cat = document.createElement('span');
        cat.className = 'command-palette-item-category';
        cat.textContent = `${item.category}: `;
        labelEl.appendChild(cat);
      }
      labelEl.appendChild(document.createTextNode(item.label));

      // "recently used" badge (command mode)
      if (item.isRecent && (this._input?.value ?? '').trim() === COMMAND_PREFIX) {
        const badge = document.createElement('span');
        badge.className = 'command-palette-recent-badge';
        badge.textContent = 'recently used';
        labelEl.appendChild(badge);
      }

      row.appendChild(labelEl);

      // Detail text (general mode — e.g. "2h ago")
      if (item.detail) {
        const detailEl = document.createElement('span');
        detailEl.className = 'command-palette-item-detail';
        detailEl.textContent = item.detail;
        row.appendChild(detailEl);
      }

      // Keybinding (command mode)
      if (item.keybinding) {
        const kbd = document.createElement('span');
        kbd.className = 'command-palette-item-keybinding';
        kbd.textContent = item.keybinding;
        row.appendChild(kbd);
      }

      // Mouse events
      row.addEventListener('mouseenter', () => {
        this._selectedIndex = i;
        this._updateSelection();
      });
      row.addEventListener('click', (e) => {
        e.preventDefault();
        this._selectedIndex = i;
        this._acceptSelected();
      });

      list.appendChild(row);
    }

    // Overflow indicator
    if (this._items.length > MAX_VISIBLE_ITEMS) {
      const more = document.createElement('div');
      more.className = 'command-palette-more';
      more.textContent = `${this._items.length - MAX_VISIBLE_ITEMS} more…`;
      list.appendChild(more);
    }
  }

  // ── Selection management ───────────────────────────────────────────────

  private _moveSelection(delta: number): void {
    if (this._items.length === 0) return;
    const maxIdx = Math.min(this._items.length, MAX_VISIBLE_ITEMS) - 1;
    this._selectedIndex = Math.max(0, Math.min(maxIdx, this._selectedIndex + delta));
    this._updateSelection();
  }

  private _updateSelection(): void {
    if (!this._listEl) return;
    const rows = this._listEl.querySelectorAll('.command-palette-item');
    rows.forEach((row, i) => {
      row.classList.toggle('selected', i === this._selectedIndex);
      row.setAttribute('aria-selected', i === this._selectedIndex ? 'true' : 'false');
    });
  }

  // ── Acceptance / execution ─────────────────────────────────────────────

  private _acceptSelected(): void {
    const item = this._items[this._selectedIndex];
    if (!item) return;

    this.hide();
    item.accept();
  }

  private _executeCommandById(commandId: string): void {
    this._commandService.executeCommand(commandId).catch((err) => {
      console.error('[QuickAccess] Failed to execute command:', commandId, err);
    });
    this._onDidExecute.fire(commandId);
  }

  // ── Dispose ────────────────────────────────────────────────────────────

  override dispose(): void {
    this._destroyDOM();
    super.dispose();
  }
}

// ─── Legacy re-export ────────────────────────────────────────────────────────
// Allows existing imports of `CommandPalette` to keep working.

/** @deprecated Use `QuickAccessWidget` instead. */
export { QuickAccessWidget as CommandPalette };
