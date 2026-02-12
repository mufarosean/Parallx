// editorsBridge.ts — bridges parallx.editors to internal editor system
//
// Allows tools to register editor providers and open editors in the
// editor area using M1's EditorInput + EditorPane system.
// Also provides openFileEditor(uri) for opening files via the
// workbench-level file editor resolver.

import { IDisposable, toDisposable } from '../../platform/lifecycle.js';
import { Emitter, Event } from '../../platform/events.js';
import { EditorInput, type IEditorInput } from '../../editor/editorInput.js';
import { EditorPane, type IEditorPane } from '../../editor/editorPane.js';
import type { SerializedEditorEntry } from '../../editor/editorTypes.js';
import type { IEditorService } from '../../services/serviceTypes.js';

// ─── File Editor Resolver ────────────────────────────────────────────────────

/**
 * A function that creates an EditorInput from a URI string.
 * Registered at the workbench level (not per-tool).
 */
export type FileEditorResolverFn = (uri: string) => Promise<IEditorInput | undefined>;

/**
 * Global file editor resolver. Set by the workbench during initialisation.
 * When a tool calls `editors.openFileEditor(uri)`, this resolver creates
 * the appropriate EditorInput (FileEditorInput, UntitledEditorInput, etc.).
 */
let _fileEditorResolver: FileEditorResolverFn | undefined;

/**
 * Set the global file editor resolver. Called once during workbench init.
 */
export function setFileEditorResolver(resolver: FileEditorResolverFn): void {
  _fileEditorResolver = resolver;
}

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * A tool-provided editor provider that renders content into editor tabs.
 */
export interface ToolEditorProvider {
  createEditorPane(container: HTMLElement): IDisposable;
}

export interface OpenEditorOptions {
  readonly typeId: string;
  readonly title: string;
  readonly icon?: string;
  readonly instanceId?: string;
}

// ─── Editors Bridge ──────────────────────────────────────────────────────────

/**
 * Bridge for the `parallx.editors` API namespace.
 */
export class EditorsBridge {
  private readonly _providers = new Map<string, ToolEditorProvider>();
  private readonly _registrations: IDisposable[] = [];
  private _disposed = false;

  constructor(
    private readonly _toolId: string,
    private readonly _editorService: IEditorService | undefined,
    private readonly _subscriptions: IDisposable[],
  ) {}

  /**
   * Register an editor provider for a type ID.
   */
  registerEditorProvider(typeId: string, provider: ToolEditorProvider): IDisposable {
    this._throwIfDisposed();

    if (this._providers.has(typeId)) {
      throw new Error(`[EditorsBridge] Editor provider for type "${typeId}" is already registered by tool "${this._toolId}".`);
    }

    this._providers.set(typeId, provider);
    console.log(`[EditorsBridge] Tool "${this._toolId}" registered editor provider: ${typeId}`);

    const disposable = toDisposable(() => {
      this._providers.delete(typeId);
    });

    this._registrations.push(disposable);
    this._subscriptions.push(disposable);

    return disposable;
  }

  /**
   * Open an editor in the active editor group.
   */
  async openEditor(options: OpenEditorOptions): Promise<void> {
    this._throwIfDisposed();

    const provider = this._providers.get(options.typeId);
    if (!provider) {
      throw new Error(
        `[EditorsBridge] No editor provider registered for type "${options.typeId}". ` +
        `Register one first with parallx.editors.registerEditorProvider().`
      );
    }

    // Create a ToolEditorInput backed by the tool's provider
    const inputId = options.instanceId ?? `${this._toolId}:${options.typeId}:${Date.now()}`;
    const input = new ToolEditorInput(
      options.typeId,
      options.title,
      options.icon,
      provider,
      inputId,
    );

    if (this._editorService) {
      await this._editorService.openEditor(input, { pinned: true });
    } else {
      console.warn(`[EditorsBridge] No editor service available — cannot open editor "${options.title}"`);
    }
  }

  /**
   * Get provider for a type ID (used internally by the pane system).
   */
  getProvider(typeId: string): ToolEditorProvider | undefined {
    return this._providers.get(typeId);
  }

  /**
   * Open a file in the text editor using the workbench-level file-editor resolver.
   *
   * The resolver creates the appropriate `EditorInput` (FileEditorInput for
   * `file://` URIs, UntitledEditorInput for `untitled://`, etc.).
   *
   * @param uri  File URI string (e.g. `file:///C:/project/readme.md` or an fsPath).
   * @param options  Optional editor open options.
   */
  async openFileEditor(uri: string, options?: { pinned?: boolean }): Promise<void> {
    this._throwIfDisposed();

    if (!_fileEditorResolver) {
      throw new Error('[EditorsBridge] No file editor resolver registered. The file editor may not be initialised yet.');
    }

    const input = await _fileEditorResolver(uri);
    if (!input) {
      console.warn(`[EditorsBridge] File editor resolver returned undefined for URI: ${uri}`);
      return;
    }

    if (this._editorService) {
      await this._editorService.openEditor(input, { pinned: options?.pinned ?? true });
    } else {
      console.warn(`[EditorsBridge] No editor service available — cannot open file editor.`);
    }
  }

  dispose(): void {
    this._disposed = true;
    this._providers.clear();
    for (const d of this._registrations) {
      d.dispose();
    }
    this._registrations.length = 0;
  }

  private _throwIfDisposed(): void {
    if (this._disposed) {
      throw new Error(`[EditorsBridge] Tool "${this._toolId}" has been deactivated — API access is no longer allowed.`);
    }
  }
}

// ─── Tool Editor Input ───────────────────────────────────────────────────────

/**
 * An EditorInput backed by a tool's editor provider.
 */
class ToolEditorInput extends EditorInput {
  readonly typeId: string;
  private readonly _name: string;
  private readonly _icon: string | undefined;
  readonly provider: ToolEditorProvider;

  constructor(
    typeId: string,
    name: string,
    icon: string | undefined,
    provider: ToolEditorProvider,
    id: string,
  ) {
    super(id);
    this.typeId = typeId;
    this._name = name;
    this._icon = icon;
    this.provider = provider;
  }

  get name(): string { return this._name; }
  get description(): string { return `Tool editor: ${this.typeId}`; }

  serialize(): SerializedEditorEntry {
    return {
      inputId: this.id,
      typeId: this.typeId,
      name: this._name,
      pinned: true,
      sticky: false,
      data: { icon: this._icon },
    };
  }
}
