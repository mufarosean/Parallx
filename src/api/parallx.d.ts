// parallx.d.ts — Public API type definitions for Parallx tools
//
// This file defines the complete API surface available to tools.
// Tools interact with the shell ONLY through this API — never through
// internal imports. The API is versioned and stable within a major version.
//
// Parallx equivalent of VS Code's `vscode.d.ts`.
// Publishable in the future as `@parallx/types`.

// ─── Core Types ──────────────────────────────────────────────────────────────

/**
 * An object that can release resources when no longer needed.
 */
export interface IDisposable {
  dispose(): void;
}

/**
 * A concrete disposable class tools can instantiate.
 */
export class Disposable implements IDisposable {
  constructor(callOnDispose: () => void);
  dispose(): void;

  /**
   * Combine multiple disposables into one.
   */
  static from(...disposables: IDisposable[]): Disposable;
}

/**
 * A typed event that can be subscribed to.
 */
export type Event<T> = (listener: (e: T) => void) => IDisposable;

/**
 * A cancellation token.
 */
export interface CancellationToken {
  readonly isCancellationRequested: boolean;
  readonly onCancellationRequested: Event<void>;
}

// ─── Tool Context ────────────────────────────────────────────────────────────

/**
 * Context provided to a tool during activation.
 * Tools use this to register disposables, access scoped storage, and
 * determine their own identity and path.
 */
export interface ToolContext {
  /**
   * Disposable array — items added here are disposed when the tool is
   * deactivated. Use this to register all resources that need cleanup.
   */
  readonly subscriptions: IDisposable[];

  /**
   * Per-tool global storage that persists across sessions.
   * Not scoped to a workspace.
   */
  readonly globalState: Memento;

  /**
   * Per-tool workspace-scoped storage.
   * Different for each workspace.
   */
  readonly workspaceState: Memento;

  /**
   * Absolute filesystem path to the tool's root directory.
   */
  readonly toolPath: string;

  /**
   * URI form of the tool path (for API consistency).
   */
  readonly toolUri: string;
}

/**
 * A key-value storage that persists across sessions.
 */
export interface Memento {
  /**
   * Get a value by key.
   * Returns `defaultValue` if not found.
   */
  get<T>(key: string, defaultValue: T): T;
  get<T>(key: string): T | undefined;

  /**
   * Set a value. Pass `undefined` to remove.
   */
  update(key: string, value: unknown): Promise<void>;

  /**
   * Get all stored keys.
   */
  keys(): readonly string[];
}

// ─── Tool Info ───────────────────────────────────────────────────────────────

/**
 * Read-only information about a registered tool.
 */
export interface ToolInfo {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly publisher: string;
  readonly description: string;
  readonly isBuiltin: boolean;
  readonly toolPath: string;
  /** Current lifecycle state (e.g. 'activated', 'deactivated', 'registered'). */
  readonly state: string;
  /** Activation events declared in the manifest. */
  readonly activationEvents: readonly string[];
  /** Contributions declared in the manifest. */
  readonly contributes: ToolContributions;
}

/**
 * Contributions declared by a tool in its manifest.
 * Mirrors the `contributes` section of `parallx-manifest.json`.
 */
export interface ToolContributions {
  readonly commands?: readonly { readonly id: string; readonly title: string; readonly category?: string; readonly icon?: string; readonly keybinding?: string; readonly when?: string }[];
  readonly views?: readonly { readonly id: string; readonly name: string; readonly icon?: string; readonly defaultContainerId?: string; readonly when?: string }[];
  readonly viewContainers?: readonly { readonly id: string; readonly title: string; readonly icon?: string; readonly location: string; readonly hidden?: boolean }[];
  readonly configuration?: readonly { readonly title: string; readonly properties: Readonly<Record<string, { readonly type: string; readonly default?: unknown; readonly description?: string; readonly enum?: readonly string[] }>> }[];
  readonly menus?: Readonly<Record<string, readonly { readonly command: string; readonly group?: string; readonly when?: string }[]>>;
  readonly keybindings?: readonly { readonly command: string; readonly key: string; readonly when?: string }[];
  readonly statusBar?: readonly { readonly id: string; readonly name: string; readonly text: string; readonly tooltip?: string; readonly command?: string; readonly alignment: string; readonly priority?: number }[];
}

// ─── Views Namespace ─────────────────────────────────────────────────────────

/**
 * A view provider renders content into a shell container.
 */
export interface ViewProvider {
  /**
   * Called when the view should render its content.
   * @param container The DOM element to render into.
   * @returns A disposable that cleans up the rendered content.
   */
  createView(container: HTMLElement): IDisposable;
}

/**
 * Options for registering a view provider.
 */
export interface ViewProviderOptions {
  /** Human-readable view name. */
  readonly name: string;
  /** Icon identifier. */
  readonly icon?: string;
  /** Default container ID (e.g., 'workbench.parts.sidebar'). */
  readonly defaultContainerId?: string;
  /** When-clause for visibility. */
  readonly when?: string;
}

// ─── Commands Namespace ──────────────────────────────────────────────────────

/**
 * A command handler function.
 */
export type CommandHandler = (...args: unknown[]) => unknown | Promise<unknown>;

// ─── Window Namespace ────────────────────────────────────────────────────────

/**
 * Severity levels for messages.
 */
export enum MessageSeverity {
  Information = 'information',
  Warning = 'warning',
  Error = 'error',
}

/**
 * An action button on a message.
 */
export interface MessageAction {
  readonly title: string;
  readonly isCloseAffordance?: boolean;
}

/**
 * Options for input box.
 */
export interface InputBoxOptions {
  readonly prompt?: string;
  readonly value?: string;
  readonly placeholder?: string;
  readonly password?: boolean;
  readonly validateInput?: (value: string) => string | undefined | Promise<string | undefined>;
}

/**
 * Options for quick pick.
 */
export interface QuickPickItem {
  readonly label: string;
  readonly description?: string;
  readonly detail?: string;
  readonly picked?: boolean;
}

export interface QuickPickOptions {
  readonly placeholder?: string;
  readonly canPickMany?: boolean;
  readonly matchOnDescription?: boolean;
}

/**
 * An output channel for tool logging.
 */
export interface OutputChannel extends IDisposable {
  readonly name: string;
  append(value: string): void;
  appendLine(value: string): void;
  clear(): void;
  show(): void;
  hide(): void;
}

// ─── Theming ─────────────────────────────────────────────────────────────────

/**
 * Represents the kind/type of a color theme.
 * Mirrors VS Code's `ColorThemeKind`.
 */
export enum ColorThemeKind {
  Dark = 1,
  Light = 2,
  HighContrast = 3,
  HighContrastLight = 4,
}

/**
 * Read-only representation of the active color theme.
 * Mirrors VS Code's `ColorTheme`.
 */
export interface ColorTheme {
  /** The kind of this color theme (dark, light, high contrast). */
  readonly kind: ColorThemeKind;
}

// ─── Context Namespace ───────────────────────────────────────────────────────

/**
 * A handle to a context key.
 */
export interface ContextKey<T extends string | number | boolean | undefined = string | number | boolean | undefined> {
  readonly key: string;
  get(): T;
  set(value: T): void;
  reset(): void;
}

// ─── Workspace / Configuration Namespace ─────────────────────────────────────

/**
 * A workspace folder representing a root directory in the workspace.
 * Mirrors VS Code's `vscode.WorkspaceFolder`.
 */
export interface WorkspaceFolder {
  /** The URI of the folder. */
  readonly uri: string;
  /** The human-readable name of the folder (typically the directory name). */
  readonly name: string;
  /** The ordinal index of this folder in the workspace. */
  readonly index: number;
}

/**
 * Event payload when workspace folders change.
 */
export interface WorkspaceFoldersChangeEvent {
  /** Folders that were added. */
  readonly added: readonly WorkspaceFolder[];
  /** Folders that were removed. */
  readonly removed: readonly WorkspaceFolder[];
}

/**
 * Workspace identity information provided by workspace-switch events.
 */
export interface WorkspaceChangeInfo {
  /** Unique workspace UUID. */
  readonly id: string;
  /** Human-readable workspace name. */
  readonly name: string;
}

/**
 * A read-only configuration object scoped to a section.
 */
export interface Configuration {
  /**
   * Get a configuration value.
   */
  get<T>(key: string, defaultValue?: T): T | undefined;

  /**
   * Check if a configuration key exists.
   */
  has(key: string): boolean;
}

/**
 * Payload for configuration change events.
 */
export interface ConfigurationChangeEvent {
  /**
   * Check if a specific section was affected.
   */
  affectsConfiguration(section: string): boolean;
}

// ─── Editors Namespace ───────────────────────────────────────────────────────

/**
 * An editor provider renders content into editor tabs.
 */
export interface EditorProvider {
  /**
   * Called when an editor pane should render its content.
   * @param container The DOM element to render into.
   * @param input The editor input. `input.instanceId` is the exact value the
   *   opener passed to `openEditor` (your domain id — a page id, a section
   *   name); `input.id` is that value namespaced `tool:type:instance` for
   *   global tab uniqueness. Key your data on `instanceId`; never parse `id`.
   * @returns Either a plain disposable, or an extended handle that also
   *   implements `saveViewState`/`restoreViewState` to preserve scroll,
   *   selection, focus, and other transient UI state across tab switches.
   *   The workbench keeps the returned view state in memory for as long as
   *   the editor input is open (across switches) and evicts it on close.
   */
  createEditorPane(
    container: HTMLElement,
    input?: { readonly id: string; readonly instanceId?: string; readonly name?: string },
  ): IDisposable | EditorPaneHandle;
}

/**
 * Extended return value for {@link EditorProvider.createEditorPane}.
 *
 * Editors that own transient UI state (scroll position, selection, expanded
 * tree nodes, video playback time, etc.) should return this shape so the
 * workbench can save and restore that state across tab switches. The state
 * object is opaque to the workbench — pick whatever shape fits the editor.
 *
 * Mirrors Monaco's IEditor.saveViewState / restoreViewState.
 */
export interface EditorPaneHandle {
  /** Tear down the rendered editor content. */
  dispose(): void;

  /**
   * Capture the editor's current UI state for restoration on a later
   * remount. Called by the workbench immediately before the pane's DOM
   * is removed (tab switch, group move). Should be fast and synchronous.
   * Return `undefined` to skip caching.
   */
  saveViewState?(): unknown;

  /**
   * Restore UI state captured by an earlier {@link saveViewState} call.
   * Called by the workbench after the pane has been mounted, sized, and
   * `setInput` has completed — so DOM queries against the rendered tree
   * are safe at this point.
   */
  restoreViewState?(state: unknown): void;
}

/**
 * Options for opening an editor.
 */
export interface OpenEditorOptions {
  /** The editor type ID (must match a registered provider). */
  readonly typeId: string;
  /** Title shown in the editor tab. */
  readonly title: string;
  /** Optional icon identifier for the tab. */
  readonly icon?: string;
  /** Optional unique instance ID (for multiple editors of same type). */
  readonly instanceId?: string;
}

// ─── The Parallx API ─────────────────────────────────────────────────────────

/**
 * The `parallx.views` API namespace.
 */
export namespace views {
  /**
   * Register a view provider for the given view ID.
   * The view must be declared in the tool's manifest `contributes.views`.
   */
  export function registerViewProvider(
    viewId: string,
    provider: ViewProvider,
    options?: ViewProviderOptions,
  ): IDisposable;

  /**
   * Set a badge on an activity bar icon for a view container.
   * Pass `undefined` to clear the badge.
   * VS Code reference: IActivity badge on CompositeBarActionViewItem
   */
  export function setBadge(
    containerId: string,
    badge: { count?: number; dot?: boolean } | undefined,
  ): void;

  /**
   * Register a menu provider for the sidebar header ⋯ button.
   * The tool owns both the items and their execution — the workbench just renders.
   */
  export function setSidebarMenuProvider(
    containerId: string,
    provider: {
      getMenuItems(): { id: string; label: string; group?: string }[];
      executeAction(actionId: string): void;
    },
  ): void;
}

/**
 * The `parallx.ui` API namespace — shared UI performance helpers, so extension
 * panes throttle their hot paths the SAME way the built-in workbench does.
 */
export namespace ui {
  /**
   * A callback wrapped by {@link rafThrottle}. Invoking it schedules the wrapped
   * function to run once on the next animation frame with the latest arguments.
   */
  export interface RafThrottled<A extends unknown[]> {
    (...args: A): void;
    /** Cancel any pending frame. Call from your dispose/teardown. */
    dispose(): void;
    /** Run the pending invocation now (if any) and cancel the scheduled frame. */
    flush(): void;
  }

  /**
   * Coalesce a high-frequency callback (mousemove / scroll / resize / dragover)
   * into at most one invocation per animation frame, using the most recent
   * arguments. Route your editor page/pane hot-path handlers through this so
   * per-event forced layout (getBoundingClientRect / getComputedStyle) can't
   * pile up and jank the workbench.
   *
   * @example
   *   const onMove = parallx.ui.rafThrottle((e: MouseEvent) => reposition(e));
   *   el.addEventListener('mousemove', onMove);
   *   // on teardown: onMove.dispose();
   */
  export function rafThrottle<A extends unknown[]>(fn: (...args: A) => void): RafThrottled<A>;

  /** An option in a {@link createDropdown} dropdown. */
  export interface DropdownItem {
    readonly value: string;
    readonly label: string;
    /**
     * Optional colour chip rendered before the label, both in the list and on
     * the trigger once selected. For option sets whose colour carries meaning —
     * budget categories, calendar colours, tag palettes.
     */
    readonly color?: string;
  }

  /** Handle returned by {@link createDropdown}. */
  export interface DropdownHandle {
    /** The dropdown's root element (already appended to the container). */
    readonly element: HTMLElement;
    /** Currently selected value ('' when nothing is selected). */
    value: string;
    /**
     * Replace the option list (keeps the current value when still present).
     *
     * Pass `selected` to change items and value together — doing it as two
     * statements flashes the placeholder in between when the old value is not
     * in the new list.
     */
    setItems(items: readonly DropdownItem[], selected?: string): void;
    /** Subscribe to selection changes. */
    onDidChange(listener: (value: string) => void): { dispose(): void };
    focus(): void;
    setDisabled(disabled: boolean): void;
    dispose(): void;
  }

  /**
   * Create a themed single-select dropdown — the SAME `.ui-dropdown`
   * component the built-in workbench uses (keyboard navigation, ARIA,
   * theme tokens). Prefer this over a native `<select>`: the native
   * popup list is drawn by Chromium and cannot be themed.
   *
   * Use this rather than hand-rolling one. The open list is mounted in a
   * body-level fixed layer, so it works inside scrolling containers without
   * being clipped, flips above the trigger when space is tight, and scrolls
   * long option sets without dismissing itself — the three things every
   * hand-rolled replacement in this codebase has got wrong.
   */
  export function createDropdown(container: HTMLElement, options?: {
    readonly items?: readonly DropdownItem[];
    readonly selected?: string;
    readonly placeholder?: string;
    readonly ariaLabel?: string;
    readonly disabled?: boolean;
  }): DropdownHandle;

  /**
   * Render Markdown (+ KaTeX math: `$inline$` and `$$display$$`) into a
   * `.px-markdown` element — the shared compact renderer used for card
   * bodies, widget content, and discussion panels. Safe for
   * model-generated input: raw HTML is never interpreted.
   */
  export function renderMarkdown(markdown: string): HTMLElement;

  /**
   * Create THE AI button — the Parallx brand mark in an accent pill
   * (`.px-ai-btn`). Every "the assistant acts here" affordance uses this
   * one component so the AI has a single face across all surfaces.
   */
  export function createAiButton(container: HTMLElement, options: {
    readonly label: string;
    /** 24px variant for dense rows. */
    readonly compact?: boolean;
    readonly ariaLabel?: string;
    readonly title?: string;
  }): HTMLButtonElement;

  /**
   * Show the workbench context menu at a point — the SAME `.context-menu`
   * the built-in surfaces use (keyboard navigation, submenus, viewport
   * clamping, click-outside dismiss). Prefer this over a hand-rolled menu.
   * `separator: true` entries draw a divider between groups.
   */
  export function showContextMenu(
    anchor: { readonly x: number; readonly y: number },
    items: ReadonlyArray<{
      readonly label?: string;
      /** Registry icon id shown at the row's leading edge. */
      readonly icon?: string;
      readonly danger?: boolean;
      readonly disabled?: boolean;
      readonly separator?: boolean;
      readonly onSelect?: () => void;
    }>,
  ): { dispose(): void };
}

/**
 * The `parallx.keybindings` API namespace.
 *
 * Register keybindings into the SAME single dispatcher the built-in workbench
 * uses. Prefer this (or manifest `contributes.keybindings`) over attaching your
 * own `document` keydown listener — that path leads to cross-surface conflicts
 * (one surface's capture handler swallowing another's keys). Scope a binding
 * with a `when` clause so it only fires when your surface is focused, e.g.
 * `when: "activeEditor == 'my-editor'"` or `when: "focusedView == 'my-view'"`.
 */
export namespace keybindings {
  /**
   * Bind `key` (e.g. 'Ctrl+B', 'ArrowLeft') to a registered command, optionally
   * gated by a `when`-clause. Returns a disposable that removes the binding.
   * Reserved core shortcuts (e.g. the Command Palette) cannot be re-pointed.
   */
  export function register(key: string, commandId: string, when?: string): IDisposable;
}

/**
 * The `parallx.commands` API namespace.
 */
export namespace commands {
  /**
   * Register a command handler.
   * The command should be declared in the tool's manifest `contributes.commands`.
   */
  export function registerCommand(id: string, handler: CommandHandler): IDisposable;

  /**
   * Execute a command by ID.
   */
  export function executeCommand<T = unknown>(id: string, ...args: unknown[]): Promise<T>;

  /**
   * Get all registered command IDs.
   */
  export function getCommands(): Promise<string[]>;
}

/**
 * Alignment for status bar items.
 */
export enum StatusBarAlignment {
  Left = 1,
  Right = 2,
}

/**
 * A status bar item that can be shown/hidden and updated.
 * VS Code reference: `vscode.StatusBarItem`.
 */
export interface StatusBarItem extends IDisposable {
  /** The alignment of this item. */
  readonly alignment: StatusBarAlignment;
  /** The priority. Higher = closer to the edge. */
  readonly priority: number;
  /** The text to show. Supports `$(icon-name)` placeholders. */
  text: string;
  /** The tooltip text. */
  tooltip: string | undefined;
  /** A command to execute on click. */
  command: string | undefined;
  /** Name used in the status bar context menu. */
  name: string | undefined;
  /** Show this item. */
  show(): void;
  /** Hide this item. */
  hide(): void;
}

/**
 * The `parallx.window` API namespace.
 */
export namespace window {
  /**
   * Show an information message with optional action buttons.
   */
  export function showInformationMessage(message: string, ...actions: MessageAction[]): Promise<MessageAction | undefined>;

  /**
   * Show a warning message with optional action buttons.
   */
  export function showWarningMessage(message: string, ...actions: MessageAction[]): Promise<MessageAction | undefined>;

  /**
   * Show an error message with optional action buttons.
   */
  export function showErrorMessage(message: string, ...actions: MessageAction[]): Promise<MessageAction | undefined>;

  /**
   * Show an input box for text input.
   */
  export function showInputBox(options?: InputBoxOptions): Promise<string | undefined>;

  /**
   * Show a quick pick for item selection.
   */
  export function showQuickPick(items: QuickPickItem[], options?: QuickPickOptions): Promise<QuickPickItem | QuickPickItem[] | undefined>;

  /**
   * Show a centered confirm modal (Esc/backdrop cancels, Enter confirms).
   * `danger: true` styles the confirm button destructively and focuses the
   * safe button. Resolves true only if the user confirmed. Prefer this over
   * a warning toast for destructive actions (deleting a deck, a file…).
   */
  export function showConfirmModal(options: {
    message: string;
    detail?: string;
    confirmLabel?: string;
    /** Pass `null` to hide the cancel button. */
    cancelLabel?: string | null;
    danger?: boolean;
  }): Promise<boolean>;

  /**
   * Create a named output channel.
   */
  export function createOutputChannel(name: string): OutputChannel;

  /**
   * Create a status bar item.
   * VS Code reference: `vscode.window.createStatusBarItem()`.
   *
   * @param alignment Optional alignment (default: Left).
   * @param priority Optional priority (default: 0). Higher = closer to edge.
   */
  export function createStatusBarItem(alignment?: StatusBarAlignment, priority?: number): StatusBarItem;

  /**
   * The currently active color theme.
   * VS Code reference: `vscode.window.activeColorTheme`.
   */
  export const activeColorTheme: ColorTheme;

  /**
   * Event that fires when the active color theme changes.
   * VS Code reference: `vscode.window.onDidChangeActiveColorTheme`.
   */
  export const onDidChangeActiveColorTheme: Event<ColorTheme>;
}

/**
 * The `parallx.context` API namespace.
 */
export namespace context {
  /**
   * Create a context key with a default value.
   * The key is scoped to the calling tool.
   */
  export function createContextKey<T extends string | number | boolean | undefined>(
    name: string,
    defaultValue: T,
  ): ContextKey<T>;

  /**
   * Get the current value of a context key.
   */
  export function getContextValue(name: string): string | number | boolean | undefined;
}

/**
 * The `parallx.workspace` API namespace.
 */
export namespace workspace {
  /**
   * Get a configuration object scoped to the tool's section.
   */
  export function getConfiguration(section?: string): Configuration;

  /**
   * Event that fires when configuration changes.
   */
  export const onDidChangeConfiguration: Event<ConfigurationChangeEvent>;

  /**
   * The workspace folders currently open.
   * `undefined` if no workspace is open (never happens in Parallx — returns empty array).
   */
  export const workspaceFolders: readonly WorkspaceFolder[] | undefined;

  /**
   * Get the workspace folder that contains the given URI.
   * Returns `undefined` if the URI is not within any workspace folder.
   */
  export function getWorkspaceFolder(uri: string): WorkspaceFolder | undefined;

  /**
   * Event that fires when workspace folders are added or removed.
   */
  export const onDidChangeWorkspaceFolders: Event<WorkspaceFoldersChangeEvent>;

  /**
   * Event that fires when the active workspace changes (e.g. the user
   * opens a different folder or switches workspaces).
   *
   * This is the **primary signal** for workspace transitions.  When it
   * fires, tools should:
   *   1. Cancel any in-flight work from the old workspace
   *   2. Clear in-memory caches and stale data
   *   3. Reload data from the new workspace context
   *
   * The payload contains the new workspace identity (`id` and `name`).
   * `undefined` means no workspace is active.
   */
  export const onDidChangeWorkspace: Event<WorkspaceChangeInfo | undefined>;

  /**
   * The workspace display name (first folder name, or workspace identity name).
   */
  export const name: string | undefined;

  // ── Canvas Pages (M56) ──

  /**
   * Read-only metadata for a canvas page.
   * Does not include content — only lightweight fields for enumeration and display.
   */
  export interface CanvasPageInfo {
    readonly id: string;
    readonly parentId: string | null;
    readonly title: string;
    readonly icon: string | null;
    readonly isFavorited: boolean;
    readonly isArchived: boolean;
    readonly createdAt: string;
    readonly updatedAt: string;
  }

  /**
   * A canvas page with its children assembled into a tree.
   */
  export interface CanvasPageTreeNode extends CanvasPageInfo {
    readonly children: CanvasPageTreeNode[];
  }

  /**
   * Event payload when a canvas page changes.
   */
  export interface CanvasPageChangeEvent {
    readonly kind: 'Created' | 'Updated' | 'Deleted' | 'Moved' | 'Reordered';
    readonly pageId: string;
    readonly page?: CanvasPageInfo;
  }

  /**
   * Get all non-archived root-level canvas pages.
   * Returns an empty array if the canvas tool is not active.
   */
  export function getCanvasPages(): Promise<CanvasPageInfo[]>;

  /**
   * Get the full canvas page tree (hierarchical, non-archived pages).
   * Returns an empty array if the canvas tool is not active.
   */
  export function getCanvasPageTree(): Promise<CanvasPageTreeNode[]>;

  /**
   * Event that fires when a canvas page is created, updated, deleted, moved, or reordered.
   * Does not fire if the canvas tool is not active.
   */
  export const onDidChangeCanvasPages: Event<CanvasPageChangeEvent>;
}

/**
 * Descriptor for an open editor, returned by `editors.openEditors`.
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
 * The `parallx.editors` API namespace.
 */
export namespace editors {
  /**
   * Register an editor provider for a given type ID.
   * Tools use this to render custom content in editor tabs.
   */
  export function registerEditorProvider(typeId: string, provider: EditorProvider): IDisposable;

  /**
   * Open an editor in the active editor group.
   */
  export function openEditor(options: OpenEditorOptions): Promise<void>;

  /**
   * Close an editor by its ID across all groups.
   * Returns true if an editor was found and closed.
   */
  export function closeEditor(editorId: string): Promise<boolean>;

  /**
   * Update the display title for an already-open editor input by id.
   */
  export function setEditorTitle(inputId: string, title: string): boolean;

  /**
   * Open a file in the built-in text editor.
   *
   * @param uri  File URI string (e.g. `file:///path/to/file.txt` or an fsPath).
   *             Use `untitled://` for a new untitled document.
   * @param options  Optional editor open options.
   */
  export function openFileEditor(uri: string, options?: { pinned?: boolean }): Promise<void>;

  /**
   * Descriptors for all currently open editors across all groups.
   * Refreshed on each access. Use `onDidChangeOpenEditors` to react to changes.
   */
  export const openEditors: readonly OpenEditorDescriptor[];

  /**
   * Event that fires when the set of open editors changes
   * (open, close, active change, dirty state change, pin/unpin).
   */
  export const onDidChangeOpenEditors: Event<void>;
}

// ─── Links (M66) ─────────────────────────────────────────────────────────────

/**
 * A parsed `parallx://` URI, passed to a {@link LinkKindHandler}.
 */
export interface ParsedLink {
  readonly raw: string;
  readonly segment: string;
  readonly pathSegments: readonly string[];
  readonly params: Readonly<Record<string, string>>;
  readonly kind: string | undefined;
}

/** Context passed to a handler when a link is opened. */
export interface LinkResolveContext {
  readonly source?: string;
}

/** Title/icon returned by a kind's {@link LinkKindHandler.resolveMetadata}. */
export interface LinkMetadata {
  readonly title: string;
  /**
   * Registry icon id (e.g. `'file-text'`, `'layers'`) — resolved through the
   * Parallx Lucide registry by every chip renderer. System UI never uses
   * emoji; renderers fall back to raw text only for unknown ids.
   */
  readonly icon?: string;
}

/** Per-kind handler within a {@link LinkContract}. */
export interface LinkKindHandler {
  /** Template shown to the AI, e.g. `parallx://canvas/page/<pageId>`. */
  readonly uriTemplate: string;
  /** One-line human-readable description shown to the AI. */
  readonly description: string;
  /** Optional 1–2 examples shown to the AI. */
  readonly examples?: readonly string[];
  /** Open the resource. Should return `false` if the target is missing/invalid. Should not throw. */
  open(parsed: ParsedLink, ctx: LinkResolveContext): Promise<boolean>;
  /** Lazy metadata for canvas link chips. Return `null` if unknown. */
  resolveMetadata?(parsed: ParsedLink): Promise<LinkMetadata | null>;
}

/**
 * The full contract published by an extension. Adding one of these via
 * `parallx.links.register(...)` makes the extension cite-able everywhere
 * (chat markdown, canvas link chips, AI prompt URI list, link_create tool).
 *
 * The `extensionId` field is filled in automatically by the bridge — callers
 * only need to specify `segment`, `displayName`, and `kinds`.
 */
export interface LinkContract {
  /** Segment owned by this extension. Must be unique workspace-wide. */
  readonly segment: string;
  /** Human label for the segment (e.g. `'Canvas'`). */
  readonly displayName: string;
  /** Owning tool/extension id, populated automatically by the bridge. */
  readonly extensionId: string;
  /** Per-resource-kind handlers, keyed by kind name. */
  readonly kinds: Readonly<Record<string, LinkKindHandler>>;
}

/** Shape passed to `parallx.links.register()`. `extensionId` is optional. */
export type LinkContractInput = Omit<LinkContract, 'extensionId'> & {
  readonly extensionId?: string;
};

/**
 * The `parallx.links` API namespace — M66 unified linking and citations.
 *
 * Every extension that owns cite-able resources should call
 * `parallx.links.register(...)` exactly once from `activate()` with a
 * {@link LinkContract} declaring its segment and per-kind handlers. The
 * contract is read by the chat markdown renderer (for click interception),
 * by the canvas `link` block (for title/icon resolution), and — in
 * Iteration C — by the system prompt builder and the `link_create` chat
 * tool. There are no other integration points.
 */
export namespace links {
  /** Register a {@link LinkContract}. Returns a disposable that unregisters on dispose. */
  export function register(contract: LinkContractInput): IDisposable;

  /**
   * Open a `parallx://` URI by dispatching to its registered handler.
   * Returns `false` if the scheme is unknown, the segment is not registered,
   * or the handler refused/failed. Never throws.
   */
  export function open(uri: string): Promise<boolean>;

  /** Pure helper: build a properly-encoded `parallx://` URI. */
  export function mint(
    segment: string,
    path: string | readonly string[],
    params?: Record<string, string | number | undefined | null>,
  ): string;

  /** Pure helper: parse a `parallx://` URI. Returns `null` on any failure. */
  export function parse(uri: string): ParsedLink | null;

  /**
   * Snapshot of every contract currently registered in this workspace.
   * The system prompt builder, the canvas link chip, and the `link_create`
   * chat tool all read from here — so a new extension becomes citable
   * everywhere automatically just by calling `register()`.
   */
  export function allContracts(): readonly LinkContract[];

  /** Lazy metadata fetch for a single URI. Returns `null` if unknown. */
  export function resolveMetadata(uri: string): Promise<LinkMetadata | null>;

  /** Fires when contracts are added or removed (extension load/unload). */
  export const onDidChangeContracts: Event<void>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Dashboard Widget Contribution (M86)
// ═══════════════════════════════════════════════════════════════════════════════

/** Field types the dashboard's settings drawer can render. */
export type WidgetConfigFieldType = 'string' | 'number' | 'boolean' | 'enum' | 'textarea' | 'markdown' | 'string-list';

export interface WidgetConfigField {
  readonly type: WidgetConfigFieldType;
  readonly label: string;
  readonly description?: string;
  /** Enum options (when type === 'enum'). */
  readonly options?: readonly { readonly value: string; readonly label: string }[];
  /** Default value (mirrors the widget's defaultConfig). */
  readonly default?: unknown;
  readonly placeholder?: string;
}

export interface WidgetConfigSchema {
  /** Keyed by config-property name. Renders in declaration order. */
  readonly fields: Readonly<Record<string, WidgetConfigField>>;
}

/** How the dashboard schedules this widget's `refresh()`. Intervals must be ≥ 60s. */
export type WidgetRefreshPolicy =
  | { readonly kind: 'manual' }
  | { readonly kind: 'interval'; readonly ms: number }
  | { readonly kind: 'cron'; readonly cron: string };

/** 'static' = no refresh; 'query' = data-backed; 'ai' = background AI prompt. */
export type WidgetCategory = 'static' | 'query' | 'ai';

/** Chrome preset: 'card' full chrome, 'minimal' transparent, 'bare' body only. */
export type WidgetChromeStyle = 'card' | 'minimal' | 'bare';

export interface WidgetSizeBounds {
  readonly minColSpan?: number;
  readonly maxColSpan?: number;
  readonly minRowSpan?: number;
  readonly maxRowSpan?: number;
}

export interface WidgetRefreshContext<TConfig = unknown> {
  readonly instanceId: string;
  readonly pageId: string;
  readonly config: TConfig;
  /** Full Parallx API surface, scoped to the dashboard tool. */
  readonly api: unknown;
  readonly cachedOutput: string | null;
  /**
   * How an AI-category refresh should run: 'background' (default) = isolated
   * agent turn, the user's chat is never touched; 'chat' = visible run
   * through the active session (the "Run in chat" debugging escape hatch).
   */
  readonly mode?: 'background' | 'chat';
}

export interface WidgetContext<TConfig = unknown> extends WidgetRefreshContext<TConfig> {
  readonly errorMessage: string | null;
  /** Fires when the user saves new config from the settings drawer. */
  readonly onDidChangeConfig: Event<TConfig>;
  requestRefresh(): void;
  setCachedOutput(output: string): void;
  setError(message: string): void;
  clearError(): void;
}

export interface WidgetHandle extends IDisposable {
  /** Re-render hook the dashboard calls after `setCachedOutput`. */
  refreshFromCache?(cachedOutput: string | null): void;
  /** Called when a refresh fails (message) or the error clears (null). */
  renderError?(message: string | null): void;
}

/**
 * A dashboard widget type contribution. `typeId` must be namespaced under the
 * contributing extension's id (`<extensionId>.<name>`).
 */
export interface WidgetTypeRegistration<TConfig = Record<string, unknown>> {
  readonly typeId: string;
  readonly displayName: string;
  readonly description?: string;
  /** Codicon name or pre-rendered SVG/HTML. */
  readonly icon?: string;
  readonly category: WidgetCategory;
  /** Grid footprint on a 12-column grid. */
  readonly defaultSize: { readonly colSpan: number; readonly rowSpan: number };
  readonly sizeBounds?: WidgetSizeBounds;
  readonly defaultConfig: TConfig;
  readonly configSchema?: WidgetConfigSchema;
  readonly defaultRefreshPolicy?: WidgetRefreshPolicy;
  readonly chromeStyle?: WidgetChromeStyle;
  /**
   * Pure data fetch. Runs both headless (scheduler) and mounted (user click).
   * Return a string to persist it as the widget's cached output (≤ 256 KiB),
   * or `null` when the refresh delivered output through its own channel
   * (e.g. an AI turn calling `dashboard_render_widget` mid-run).
   */
  refresh?(ctx: WidgetRefreshContext<TConfig>): Promise<string | null>;
  /** DOM render. Receives cached output via ctx.cachedOutput on first paint. */
  createWidget(container: HTMLElement, ctx: WidgetContext<TConfig>): WidgetHandle;
}

/** Metadata-only view of a registered widget type. */
export interface WidgetTypeDescriptor {
  readonly typeId: string;
  readonly displayName: string;
  readonly description?: string;
  readonly icon?: string;
  readonly category: WidgetCategory;
  readonly defaultSize: { readonly colSpan: number; readonly rowSpan: number };
  /** Tool that contributed this type. */
  readonly ownerToolId: string;
}

/**
 * The `parallx.dashboard` API namespace — M86 widget contribution.
 *
 * Any extension can contribute widget types to the user's dashboards.
 * Registration is activation-order independent: contribute from `activate()`
 * whenever it runs, and the dashboard picks the type up live — including
 * upgrading "unavailable" placeholder cards of persisted instances the
 * moment the type registers. Dispose the returned disposable (or deactivate)
 * and mounted instances degrade to placeholders; the user's layout, config,
 * and cached content are never lost.
 */
export namespace dashboard {
  /**
   * Contribute a widget type. Validated at the boundary: `typeId` must start
   * with `"<extensionId>."`, sizes must fit the 12-column grid, refresh
   * intervals must be ≥ 60 seconds. Throws on invalid registrations and on
   * `typeId` collisions with another extension.
   */
  export function registerWidgetType<TConfig = Record<string, unknown>>(
    registration: WidgetTypeRegistration<TConfig>,
  ): IDisposable;

  /** Metadata snapshot of every contributed widget type, across all tools. */
  export function listWidgetTypes(): readonly WidgetTypeDescriptor[];
}

/**
 * The `parallx.tools` API namespace.
 * Tool registry metadata and enablement control.
 */
export namespace tools {
  /**
   * Get all registered tools.
   */
  export function getAll(): ToolInfo[];

  /**
   * Get a tool by its ID.
   */
  export function getById(id: string): ToolInfo | undefined;

  /**
   * Check whether a tool is currently enabled.
   */
  export function isEnabled(toolId: string): boolean;

  /**
   * Enable or disable a tool.
   * Throws if the tool is built-in (built-in tools cannot be disabled).
   */
  export function setEnabled(toolId: string, enabled: boolean): Promise<void>;

  /**
   * Event that fires when a tool's enablement state changes.
   */
  export const onDidChangeEnablement: Event<{ toolId: string; enabled: boolean }>;

  /**
   * Event that fires when a tool is registered (discovered at startup or hot-installed).
   */
  export const onDidRegisterTool: Event<{ toolId: string }>;
}

/**
 * The `parallx.env` API namespace.
 * Environment information about the running shell.
 */
export namespace env {
  /** Application name. */
  export const appName: string;

  /** Application version (semver). */
  export const appVersion: string;

  /** The calling tool's root directory path. */
  export const toolPath: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// AI Chat & Language Model Namespaces (M9 Cap 8)
// ═══════════════════════════════════════════════════════════════════════════════

// ── Language Model Types ──

/**
 * Information about an available language model.
 */
export interface LanguageModelInfo {
  readonly id: string;
  readonly displayName: string;
  readonly family: string;
  readonly parameterSize: string;
  readonly quantization: string;
  readonly contextLength: number;
  readonly capabilities: readonly ('completion' | 'tools' | 'thinking')[];
}

/**
 * A chat message sent to or received from a language model.
 */
export interface ChatMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'tool';
  readonly content: string;
  readonly toolCalls?: readonly ToolCallInfo[];
  readonly toolName?: string;
  readonly thinking?: string;
}

/**
 * Options for a language model chat request.
 */
export interface ChatRequestOptions {
  readonly temperature?: number;
  readonly topP?: number;
  readonly maxTokens?: number;
  readonly tools?: readonly ToolDefinition[];
  readonly format?: string | object;
  readonly seed?: number;
  readonly think?: boolean;
}

/**
 * A chunk of streamed model response.
 */
export interface ChatResponseChunk {
  readonly content: string;
  readonly thinking?: string;
  readonly toolCalls?: readonly ToolCallInfo[];
  readonly done: boolean;
  readonly evalCount?: number;
  readonly evalDuration?: number;
}

/**
 * A tool call requested by the model.
 */
export interface ToolCallInfo {
  readonly function: {
    readonly name: string;
    readonly arguments: Record<string, unknown>;
  };
}

/**
 * JSON Schema tool definition for model requests.
 */
export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
}

/**
 * A language model provider that can be registered via `parallx.lm.registerProvider()`.
 */
export interface LanguageModelProvider {
  /** Unique provider ID (e.g. 'ollama'). */
  readonly id: string;
  /** Human-readable display name. */
  readonly displayName: string;
  /** List available models. */
  getModels(): Promise<readonly LanguageModelInfo[]>;
  /** Check provider availability. */
  checkStatus(): Promise<{ available: boolean; version?: string; error?: string }>;
  /** Send a chat request and stream the response. */
  sendChatRequest(
    modelId: string,
    messages: readonly ChatMessage[],
    options?: ChatRequestOptions,
    signal?: AbortSignal,
  ): AsyncIterable<ChatResponseChunk>;
  /** Get detailed model info. */
  getModelInfo(modelId: string): Promise<LanguageModelInfo>;
}

// ── Chat Participant Types ──

/**
 * A chat participant handler function.
 */
export type ChatParticipantHandler = (
  request: ChatParticipantRequest,
  context: ChatParticipantContext,
  response: ChatResponseStream,
  token: CancellationToken,
) => Promise<ChatParticipantResult>;

/**
 * Request passed to a chat participant handler.
 */
export interface ChatParticipantRequest {
  readonly text: string;
  readonly requestId: string;
  readonly command?: string;
  readonly mode: string;
  readonly modelId: string;
  readonly attempt: number;
  readonly interpretation?: {
    readonly surface: 'default' | 'workspace' | 'canvas' | 'bridge';
    readonly rawText: string;
    readonly effectiveText: string;
    readonly commandName?: string;
    readonly hasExplicitCommand: boolean;
    readonly kind: 'command' | 'message';
  };
}

/**
 * Context for a chat participant handler — conversation history.
 */
export interface ChatParticipantContext {
  readonly history: readonly {
    request: { text: string; requestId: string; attempt: number; timestamp: number; replayOfRequestId?: string };
    response: { parts: readonly unknown[]; isComplete: boolean; modelId: string; timestamp: number };
  }[];
  readonly runtime?: {
    buildPromptSeed(systemPrompt: string): readonly ChatMessage[];
    buildPromptEnvelope(systemPrompt: string, userContent: string): readonly ChatMessage[];
    sendPrompt(
      systemPrompt: string,
      userContent: string,
      options?: ChatRequestOptions,
      signal?: AbortSignal,
    ): AsyncIterable<ChatResponseChunk>;
  };
}

/**
 * Stream interface for building a chat response.
 */
export interface ChatResponseStream {
  markdown(content: string): void;
  codeBlock(code: string, language?: string): void;
  progress(message: string): void;
  reference(uri: string, label: string): void;
  thinking(content: string): void;
  warning(message: string): void;
  button(label: string, commandId: string, ...args: unknown[]): void;
  confirmation(message: string, data: unknown): void;
  push(part: unknown): void;
}

/**
 * Result returned by a chat participant handler.
 */
export interface ChatParticipantResult {
  readonly errorDetails?: {
    readonly message: string;
    readonly responseIsIncomplete?: boolean;
    readonly responseIsFiltered?: boolean;
  };
  readonly metadata?: unknown;
}

/**
 * A chat participant object returned from `parallx.chat.createChatParticipant()`.
 */
export interface ChatParticipant extends IDisposable {
  readonly id: string;
  displayName: string;
  description: string;
  iconPath?: string;
  commands: readonly { name: string; description: string }[];
}

/**
 * A tool result returned from a chat tool handler.
 */
export interface ChatToolResult {
  readonly content: string;
  readonly isError?: boolean;
}

/**
 * A chat tool that can be registered via `parallx.chat.registerTool()`.
 */
export interface ChatToolDefinition {
  readonly description: string;
  readonly parameters: Record<string, unknown>;
  readonly handler: (args: Record<string, unknown>, token: CancellationToken) => Promise<ChatToolResult>;
  readonly requiresConfirmation: boolean;
}

/**
 * The `parallx.lm` API namespace.
 * Access to language models for AI-powered features.
 *
 * VS Code reference: `vscode.lm` namespace
 */
export namespace lm {
  /**
   * Get all available language models.
   */
  export function getModels(): Promise<LanguageModelInfo[]>;

  /**
   * Send a chat request to a specific model and stream the response.
   *
   * @param modelId The model to use (e.g. 'llama3.1:8b').
   * @param messages The conversation messages.
   * @param options Optional request parameters.
   */
  export function sendChatRequest(
    modelId: string,
    messages: readonly ChatMessage[],
    options?: ChatRequestOptions,
  ): AsyncIterable<ChatResponseChunk>;

  /**
   * Register a language model provider.
   */
  export function registerProvider(provider: LanguageModelProvider): IDisposable;

  /**
   * Event that fires when the available models change.
   */
  export const onDidChangeModels: Event<void>;
}

/**
 * The `parallx.icons` API namespace.
 * Read-only access to the Lucide icon registry.
 *
 * Extensions should use this instead of inlining SVG icons, ensuring
 * visual consistency with the rest of Parallx.
 */
export namespace icons {
  /**
   * Get SVG markup for an icon by its registry ID.
   * Returns an empty string if the ID is unknown.
   *
   * @param id The icon identifier (e.g. 'search', 'home', 'file-text').
   */
  export function getIcon(id: string): string;

  /**
   * Check whether an icon ID exists in the registry.
   */
  export function hasIcon(id: string): boolean;

  /**
   * Get all available icon IDs.
   */
  export function getAllIconIds(): string[];

  /**
   * Get an icon wrapped in a styled `<span>` element string, ready for innerHTML.
   * Uses the standard Parallx icon styling (inline-flex, centered, non-shrinking).
   *
   * @param id The icon identifier.
   * @param size CSS pixel size (default: 16).
   */
  export function createIconHtml(id: string, size?: number): string;

  /**
   * Get the SVG markup for a file-type icon based on file extension.
   * Handles the leading dot: `.ts` or `ts` both work.
   * Returns a generic file icon for unknown extensions.
   */
  export function getFileTypeIcon(ext: string): string;
}

/**
 * The `parallx.chat` API namespace.
 * Register chat participants and tools for the AI chat system.
 *
 * VS Code reference: `vscode.chat` namespace
 */
export namespace chat {
  /**
   * Create and register a chat participant.
   *
   * @param id Unique participant ID (e.g. 'myTool.codeReview').
   * @param handler The handler function that processes chat requests.
   * @returns A ChatParticipant that can be configured and disposed.
   */
  export function createChatParticipant(id: string, handler: ChatParticipantHandler): ChatParticipant;

  /**
   * Register a chat tool that can be invoked by the AI in Agent mode.
   *
   * @param name Unique tool name (e.g. 'myTool.analyzeCode').
   * @param tool The tool definition with handler.
   */
  export function registerTool(name: string, tool: ChatToolDefinition): IDisposable;
}


// --- M63 P0 � MCP & Cron namespaces ----------------------------------------

/**
 * Result of an MCP tool invocation.
 * Mirrors the MCP wire format so future migration to a real MCP client is
 * a no-op for callers.
 */
export interface McpInvokeResult {
  readonly content: readonly { readonly type: 'text'; readonly text: string }[];
  readonly isError?: boolean;
}

export interface McpToolInfo {
  readonly name: string;
  readonly description?: string;
}

/**
 * The `parallx.mcp` API namespace.
 * Invoke MCP tools registered with the host. Tools are namespaced as
 * `mcp__<serverId>__<toolName>` (e.g. `mcp__parallx-gmail-mcp__list_unread`).
 */
export namespace mcp {
  /** Invoke an MCP tool by full namespaced name. */
  export function invokeTool(
    toolName: string,
    args: Record<string, unknown>,
    token?: { readonly isCancellationRequested: boolean },
  ): Promise<McpInvokeResult>;

  /** List all tools whose name starts with `mcp__`. */
  export function listTools(): readonly McpToolInfo[];
}

/**
 * Cron schedule. Exactly one of `at`, `every`, or `cron` must be set.
 */
export interface CronSchedule {
  /** ISO-8601 datetime for a one-shot job. */
  readonly at?: string;
  /** Duration string for repeating jobs (e.g. "5m", "1h"). */
  readonly every?: string;
  /** 5-field cron expression. */
  readonly cron?: string;
}

/**
 * Cron job payload delivered when the job fires.
 */
export interface CronPayload {
  /** System event pushed to the heartbeat runner. */
  readonly systemEvent?: Record<string, unknown>;
  /** Message injected as an agent turn. */
  readonly agentTurn?: string;
}

/**
 * Cron job descriptor accepted by `parallx.cron.upsertJob`.
 * `id` is a stable, extension-owned key (e.g. `budget.sync.scheduled`).
 */
export interface ExtensionCronJob {
  readonly id: string;
  readonly schedule: CronSchedule;
  readonly payload: CronPayload;
  readonly wakeMode?: 'now' | 'next-heartbeat';
  readonly contextMessages?: number;
  readonly description?: string;
  readonly enabled?: boolean;
}

/**
 * The `parallx.cron` API namespace.
 * Schedule recurring or one-shot agent turns.
 */
export namespace cron {
  /** Idempotent upsert by stable id. */
  export function upsertJob(job: ExtensionCronJob): void;
  /** Remove a job by stable id. Returns true if a job was removed. */
  export function removeJob(id: string): boolean;
}
