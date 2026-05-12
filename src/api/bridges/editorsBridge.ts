// editorsBridge.ts — bridges parallx.editors to internal editor system
//
// Allows tools to register editor providers and open editors in the
// editor area using M1's EditorInput + EditorPane system.
// Also provides openFileEditor(uri) for opening files via the
// workbench-level file editor resolver.

import { IDisposable, toDisposable } from '../../platform/lifecycle.js';
import { EditorInput, type IEditorInput } from '../../editor/editorInput.js';
import type { SerializedEditorEntry } from '../../editor/editorTypes.js';
import type { IEditorService, OpenEditorDescriptor } from '../../services/serviceTypes.js';
import {
  registerEditorInputDeserializer,
  hasEditorInputDeserializer,
} from '../../editor/editorInputDeserializer.js';

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

// ─── Tool Editor Provider Registry (module-global) ───────────────────────────
//
// Tool-backed editors share a single editor input class (`ToolEditorInput`) but
// each has its own `typeId` (e.g. 'canvas', 'budget.editor'). On workspace
// restore, the workbench needs to (a) know which tool owns a given typeId so it
// can activate that tool, and (b) look up the live provider to reconstruct the
// input. Both pieces live here so they survive across bridge instances and are
// reachable from the static deserializer.

interface ToolEditorProviderEntry {
  readonly toolId: string;
  readonly provider: ToolEditorProvider;
}

const _toolEditorProviders = new Map<string, ToolEditorProviderEntry>();

/**
 * Look up the owning tool id for a registered editor typeId.
 * Returns undefined if no provider is currently registered.
 */
export function getToolEditorOwner(typeId: string): string | undefined {
  return _toolEditorProviders.get(typeId)?.toolId;
}

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * A tool-provided editor provider that renders content into editor tabs.
 */
export interface ToolEditorProvider {
  createEditorPane(container: HTMLElement, input?: IEditorInput): IDisposable;

  /**
   * Optional: provide custom ribbon content for the editor group ribbon slot.
   *
   * When implemented, the editor group shows this instead of the default
   * file-path breadcrumbs bar. For example, canvas pages use this to show
   * page-hierarchy breadcrumbs, "Edited X ago", favorite star, and ⋯ menu.
   *
   * The returned IDisposable should clean up all DOM and subscriptions.
   */
  createRibbon?(container: HTMLElement, input?: IEditorInput): IDisposable;
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
    _toolEditorProviders.set(typeId, { toolId: this._toolId, provider });

    // Register a workspace-restore deserializer for this typeId. The factory
    // reads the live provider entry so it picks up the current registration
    // even if the tool is deactivated+reactivated. Registration is idempotent
    // across reloads (registerEditorInputDeserializer warns + overwrites).
    if (!hasEditorInputDeserializer(typeId)) {
      registerEditorInputDeserializer(typeId, (data) => {
        const entry = _toolEditorProviders.get(typeId);
        if (!entry) return null;
        const inputId = typeof data?.inputId === 'string'
          ? (data.inputId as string)
          : `${entry.toolId}:${typeId}:${Date.now()}`;
        const name = typeof data?.name === 'string' ? (data.name as string) : typeId;
        const icon = typeof data?.icon === 'string' ? (data.icon as string) : undefined;
        return new ToolEditorInput(typeId, name, icon, entry.provider, inputId, entry.toolId);
      });
    }

    console.log(`[EditorsBridge] Tool "${this._toolId}" registered editor provider: ${typeId}`);

    const disposable = toDisposable(() => {
      this._providers.delete(typeId);
      // Only clear the global entry if it still points at this bridge's provider.
      const current = _toolEditorProviders.get(typeId);
      if (current && current.provider === provider) {
        _toolEditorProviders.delete(typeId);
      }
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
      this._toolId,
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
   * Event that fires when the set of open editors changes.
   * Delegates to EditorService.onDidChangeOpenEditors.
   */
  get onDidChangeOpenEditors(): (listener: () => void) => IDisposable {
    return (listener: () => void) => {
      if (!this._editorService) {
        console.warn('[EditorsBridge] No editor service — onDidChangeOpenEditors is a no-op');
        return toDisposable(() => {});
      }
      const d = this._editorService.onDidChangeOpenEditors(listener);
      this._subscriptions.push(d);
      return d;
    };
  }

  /**
   * Get descriptors for all open editors across all groups.
   */
  getOpenEditors(): OpenEditorDescriptor[] {
    if (!this._editorService) return [];
    return this._editorService.getOpenEditors();
  }

  /**
   * Close an editor by its ID across all groups.
   * Returns true if an editor was found and closed.
   */
  async closeEditor(editorId: string): Promise<boolean> {
    this._throwIfDisposed();
    if (!this._editorService) return false;

    const openEditors = this._editorService.getOpenEditors();
    for (const descriptor of openEditors) {
      if (descriptor.id === editorId) {
        // Create a minimal input-like object so EditorService can match by id
        return this._editorService.closeEditor(
          { id: editorId } as any,
          descriptor.groupId,
          true,
        );
      }
    }
    return false;
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
  private _name: string;
  private readonly _icon: string | undefined;
  readonly provider: ToolEditorProvider;
  /** The tool ID that created this editor input (for cleanup on deactivation). */
  readonly ownerToolId: string;

  constructor(
    typeId: string,
    name: string,
    icon: string | undefined,
    provider: ToolEditorProvider,
    id: string,
    ownerToolId: string,
  ) {
    super(id);
    this.typeId = typeId;
    this._name = name;
    this._icon = icon;
    this.provider = provider;
    this.ownerToolId = ownerToolId;
  }

  get name(): string { return this._name; }

  /**
   * Update the display name and notify listeners (tab bar, etc.).
   */
  setName(name: string): void {
    if (this._name === name) return;
    this._name = name;
    this.fireLabelChange();
  }
  get description(): string { return `Tool editor: ${this.typeId}`; }

  /**
   * Widen access from protected → public so tool providers can control
   * dirty state from their editor panes.
   */
  override setDirty(dirty: boolean): void {
    super.setDirty(dirty);
  }

  serialize(): SerializedEditorEntry {
    return {
      inputId: this.id,
      typeId: this.typeId,
      name: this._name,
      pinned: true,
      sticky: false,
      // Mirror inputId/name/ownerToolId into `data` so the deserializer (which
      // only receives `data`) can fully reconstruct the input on restore.
      data: {
        inputId: this.id,
        name: this._name,
        icon: this._icon,
        ownerToolId: this.ownerToolId,
      },
    };
  }
}
