/**
 * parallx.d.ts — Parallx Extension SDK (M86-W10).
 *
 * Public ABI every Parallx extension binds against. The shell injects
 * an `api` object matching `ParallxApi` into each extension's
 * `activate(api, context)` entry point. Extensions ship with their
 * `engines.parallx` manifest field pinned to a major version below.
 *
 * Stability rules:
 * - Additive changes (new properties, new methods, optional fields)
 *   are MINOR version bumps and do not break existing extensions.
 * - Renames, removals, or type-shape changes are MAJOR version bumps
 *   and require every extension's manifest `engines.parallx` to
 *   widen its range.
 * - Anything not declared in this file is internal and may change at
 *   any time. Reaching into `api` for undeclared methods is at the
 *   extension's own risk.
 *
 * This file is the SINGLE source of truth for the SDK surface. The
 * shared `tsconfig.extension.json` at the repo root points every
 * extension's TS build at this declaration.
 */

declare namespace parallx {
  /** Semver string the running shell exposes. */
  export const version: string;

  // ─── Disposables ────────────────────────────────────────────────

  /** Anything the shell hands back that can be torn down later. */
  export interface IDisposable {
    dispose(): void;
  }

  /** Listener registration shape. Returns a disposable. */
  export type Event<T> = (listener: (e: T) => unknown) => IDisposable;

  /** Cooperative cancellation, mirrors VS Code's surface. */
  export interface CancellationToken {
    readonly isCancellationRequested: boolean;
    readonly onCancellationRequested: Event<unknown>;
  }

  // ─── Activation context ─────────────────────────────────────────

  /** Mutable per-activation bag the shell hands to `activate()`. */
  export interface ExtensionContext {
    /** Subscriptions auto-disposed when the extension deactivates. */
    readonly subscriptions: IDisposable[];
    /** Absolute path of the unpacked extension on disk. */
    readonly extensionPath: string;
    /** Workspace-scoped key/value store for the extension. */
    readonly workspaceState: IMemento;
    /** Global (cross-workspace) key/value store for the extension. */
    readonly globalState: IMemento;
  }

  export interface IMemento {
    get<T>(key: string): T | undefined;
    get<T>(key: string, fallback: T): T;
    update(key: string, value: unknown): Promise<void>;
    keys(): readonly string[];
  }

  // ─── Environment ────────────────────────────────────────────────

  export interface Env {
    /** Absolute path to extension-bundled tools (ffmpeg, sqlite, …). */
    readonly toolPath: string;
    /** Absolute path to per-workspace data dir (`.parallx/`). */
    readonly workspacePath: string;
    /** Process platform identifier ('win32' | 'darwin' | 'linux'). */
    readonly platform: NodeJS.Platform;
  }

  // ─── Commands ───────────────────────────────────────────────────

  export interface Commands {
    registerCommand(id: string, handler: (...args: unknown[]) => unknown): IDisposable;
    executeCommand<T = unknown>(id: string, ...args: unknown[]): Promise<T>;
  }

  // ─── Window / UI surfaces ───────────────────────────────────────

  export interface MessageItem {
    title: string;
    isCloseAffordance?: boolean;
  }

  export interface InputBoxOptions {
    prompt?: string;
    placeHolder?: string;
    value?: string;
    password?: boolean;
    ignoreFocusOut?: boolean;
    validateInput?(value: string): string | null | undefined;
  }

  export interface QuickPickItem {
    label: string;
    description?: string;
    detail?: string;
    picked?: boolean;
  }

  export interface QuickPickOptions {
    placeholder?: string;
    canPickMany?: boolean;
    matchOnDescription?: boolean;
    matchOnDetail?: boolean;
  }

  export interface StatusBarItem extends IDisposable {
    text: string;
    tooltip?: string;
    command?: string;
    show(): void;
    hide(): void;
  }

  export interface Window {
    showInformationMessage(message: string, ...items: MessageItem[]): Promise<MessageItem | undefined>;
    showWarningMessage(message: string, ...items: MessageItem[]): Promise<MessageItem | undefined>;
    showErrorMessage(message: string, ...items: MessageItem[]): Promise<MessageItem | undefined>;
    showInputBox(options?: InputBoxOptions): Promise<string | undefined>;
    showQuickPick<T extends QuickPickItem>(items: readonly T[], options?: QuickPickOptions): Promise<T | T[] | undefined>;
    createStatusBarItem(alignment?: 1 | 2, priority?: number): StatusBarItem;
  }

  /** Light-weight status bar facade (notifications-style transient text). */
  export interface StatusBar {
    setMessage(message: string, durationMs?: number): void;
  }

  // ─── Views (sidebar) ────────────────────────────────────────────

  export interface ViewProvider {
    createView(container: HTMLElement): IDisposable | void;
  }

  export interface Views {
    registerViewProvider(viewId: string, provider: ViewProvider): IDisposable;
  }

  // ─── Editors (workbench) ────────────────────────────────────────

  export interface EditorInput {
    typeId: string;
    title: string;
    icon?: string;
    instanceId?: string;
    state?: unknown;
  }

  export interface EditorProvider {
    createEditorPane(container: HTMLElement, input: EditorInput): IDisposable | void;
  }

  export interface Editors {
    registerEditorProvider(typeId: string, provider: EditorProvider): IDisposable;
    openEditor(input: EditorInput): Promise<void>;
    openFileEditor(uri: string): Promise<void>;
    readonly onDidChangeOpenEditors: Event<unknown>;
  }

  // ─── Workspace ──────────────────────────────────────────────────

  export interface WorkspaceFolder {
    uri: string;
    name: string;
    index: number;
  }

  export interface Configuration {
    get<T>(section: string): T | undefined;
    get<T>(section: string, fallback: T): T;
    update(section: string, value: unknown): Promise<void>;
    has(section: string): boolean;
  }

  export interface ConfigurationChangeEvent {
    affectsConfiguration(section: string): boolean;
  }

  export interface CanvasPageNode {
    id: string;
    title: string;
    parentId: string | null;
    children?: CanvasPageNode[];
  }

  export interface Workspace {
    readonly folders: readonly WorkspaceFolder[];
    getConfiguration(section?: string): Configuration;
    onDidChangeConfiguration: Event<ConfigurationChangeEvent>;
    onDidChangeWorkspace: Event<unknown>;
    onDidChangeWorkspaceFolders: Event<unknown>;
    onDidChangeCanvasPages: Event<unknown>;
    getCanvasPageTree(): Promise<readonly CanvasPageNode[]>;
  }

  // ─── Filesystem (workspace-rooted) ──────────────────────────────

  export interface FileStat {
    type: 'file' | 'directory';
    size: number;
    mtime: number;
  }

  export interface Fs {
    readFile(path: string): Promise<Uint8Array>;
    writeFile(path: string, data: Uint8Array | string): Promise<void>;
    delete(path: string): Promise<void>;
    rename(oldPath: string, newPath: string): Promise<void>;
    copy(srcPath: string, destPath: string): Promise<void>;
    mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
    stat(path: string): Promise<FileStat>;
    readdir(path: string): Promise<readonly string[]>;
    exists(path: string): Promise<boolean>;
    watch(path: string, listener: (kind: 'change' | 'rename', name: string) => void): Promise<IDisposable>;
  }

  // ─── Database (per-workspace SQLite) ────────────────────────────

  export interface DatabaseOpenResult {
    ok: boolean;
    path?: string;
    error?: string;
  }

  export interface DatabaseMigrateResult {
    ok: boolean;
    applied: number;
    error?: string;
  }

  export interface Database {
    open(): Promise<DatabaseOpenResult>;
    migrate(migrationsDir: string): Promise<DatabaseMigrateResult>;
    run(sql: string, params?: readonly unknown[]): Promise<{ changes: number; lastInsertRowid: number | bigint }>;
    all<T = unknown>(sql: string, params?: readonly unknown[]): Promise<T[]>;
    get<T = unknown>(sql: string, params?: readonly unknown[]): Promise<T | undefined>;
  }

  // ─── Chat / agent ───────────────────────────────────────────────

  export interface ChatToolDefinition {
    description: string;
    schema?: unknown;
    invoke(input: unknown, token?: CancellationToken): Promise<unknown>;
  }

  export interface ChatParticipant {
    id: string;
    name: string;
    description?: string;
    handle(prompt: string, token: CancellationToken): AsyncIterable<string> | Promise<string>;
  }

  export interface Chat {
    registerTool(name: string, def: ChatToolDefinition): IDisposable;
    registerParticipant(participant: ChatParticipant): IDisposable;
  }

  // ─── Language models ────────────────────────────────────────────

  export interface LanguageModel {
    id: string;
    name: string;
    family?: string;
  }

  export interface LMChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
  }

  export interface LM {
    getModels(): Promise<readonly LanguageModel[]>;
    sendChatRequest(modelId: string, messages: readonly LMChatMessage[]): AsyncIterable<string>;
  }

  // ─── MCP (tools provided by external servers) ──────────────────

  export interface McpToolCallResult {
    ok: boolean;
    content?: unknown;
    error?: string;
  }

  export interface Mcp {
    listTools(): Promise<readonly { name: string; server: string }[]>;
    callTool(name: string, input: unknown): Promise<McpToolCallResult>;
  }

  // ─── Cron / scheduled tasks ─────────────────────────────────────

  export interface CronJobSpec {
    id: string;
    cron: string;
    handler: () => Promise<void> | void;
  }

  export interface Cron {
    upsertJob(spec: CronJobSpec): Promise<IDisposable>;
  }

  // ─── Links / cross-extension contracts ──────────────────────────

  export interface LinkProvider {
    id: string;
    handle(uri: string): Promise<boolean> | boolean;
  }

  export interface Links {
    register(provider: LinkProvider): IDisposable;
    readonly onDidChangeContracts: Event<unknown>;
  }

  // ─── Canvas blocks ──────────────────────────────────────────────

  export interface CanvasBlockDefinition {
    type: string;
    title: string;
    icon?: string;
    render(container: HTMLElement, props: unknown): IDisposable | void;
  }

  export interface Canvas {
    registerBlockType(def: CanvasBlockDefinition): IDisposable;
  }

  // ─── Workspace graph ────────────────────────────────────────────

  export interface WorkspaceGraphNode {
    id: string;
    label: string;
    kind: string;
    meta?: Record<string, unknown>;
  }

  export interface WorkspaceGraphEdge {
    from: string;
    to: string;
    kind: string;
  }

  export interface WorkspaceGraphProvider {
    id: string;
    getNodes(): Promise<readonly WorkspaceGraphNode[]> | readonly WorkspaceGraphNode[];
    getEdges(): Promise<readonly WorkspaceGraphEdge[]> | readonly WorkspaceGraphEdge[];
  }

  export interface WorkspaceGraph {
    registerProvider(provider: WorkspaceGraphProvider): IDisposable;
    getAll(): readonly WorkspaceGraphNode[];
    notifyChange(): void;
    readonly onDidChange: Event<unknown>;
  }

  // ─── Service locator (escape hatch) ────────────────────────────

  /**
   * Service identifiers are nominal symbols the shell exports. Reach
   * into `api.services` only when no first-class namespace covers
   * your use case — anything here may break across MAJOR versions.
   */
  export type ServiceId<T> = symbol & { __serviceBrand: T };

  export interface Services {
    has<T>(id: ServiceId<T>): boolean;
    get<T>(id: ServiceId<T>): T;
  }

  // ─── Top-level API ──────────────────────────────────────────────

  export interface ParallxApi {
    readonly env: Env;
    readonly commands: Commands;
    readonly window: Window;
    readonly statusBar?: StatusBar;
    readonly views: Views;
    readonly editors: Editors;
    readonly workspace: Workspace;
    readonly fs: Fs;
    readonly database?: Database;
    readonly chat: Chat;
    readonly lm?: LM;
    readonly mcp?: Mcp;
    readonly cron?: Cron;
    readonly links: Links;
    readonly canvas: Canvas;
    readonly workspaceGraph: WorkspaceGraph;
    readonly services: Services;
  }

  // ─── Lifecycle ──────────────────────────────────────────────────

  export type ActivateFn = (api: ParallxApi, context: ExtensionContext) => Promise<void> | void;
  export type DeactivateFn = () => Promise<void> | void;
}

export = parallx;
export as namespace parallx;
