// workspaceBridge.ts — bridges parallx.workspace to configuration + folders
//
// Provides configuration read access, change events, and workspace folder
// access for tools. In M2, configuration is backed by the ConfigurationService
// (Cap 4) which persists values per-workspace in IStorage.
// In M4 Cap 2, workspace folders are exposed from the WorkspaceService.
// In M56, canvas page query access is exposed from ICanvasPageQueryService.

import { IDisposable } from '../../platform/lifecycle.js';
import { Emitter, Event } from '../../platform/events.js';
import { URI } from '../../platform/uri.js';
import type { ConfigurationService } from '../../configuration/configurationService.js';
import type { IWorkspaceConfiguration, IConfigurationChangeEvent } from '../../configuration/configurationTypes.js';
import type { WorkspaceFolder, WorkspaceFoldersChangeEvent } from '../../workspace/workspaceTypes.js';
import type { FileChangeEvent } from '../../platform/fileTypes.js';
import type { ICanvasPageQueryService } from '../../services/serviceTypes.js';

/** Minimal workspace identity exposed to tools on workspace switch. */
export interface WorkspaceChangeInfo {
  readonly id: string;
  readonly name: string;
}

/** Minimal shape of the workspace service for the bridge. */
interface WorkspaceServiceLike {
  readonly folders: readonly WorkspaceFolder[];
  readonly workspaceName: string;
  readonly onDidChangeFolders: Event<WorkspaceFoldersChangeEvent>;
  readonly onDidChangeWorkspace: Event<{ id: string; name: string } | undefined>;
  readonly onDidRename?: Event<string>;
  getWorkspaceFolder(uri: URI): WorkspaceFolder | undefined;
}

/** Minimal shape of the file service for the bridge. */
interface FileServiceLike {
  readonly onDidFileChange: Event<FileChangeEvent[]>;
}

/** Serialized workspace folder for tool API (URI as string). */
interface ToolWorkspaceFolder {
  readonly uri: string;
  readonly name: string;
  readonly index: number;
}

/** Serialized folder change event for tool API. */
interface ToolWorkspaceFoldersChangeEvent {
  readonly added: readonly ToolWorkspaceFolder[];
  readonly removed: readonly ToolWorkspaceFolder[];
}

/** Serialized canvas page info for tool API (M56). */
export interface ToolCanvasPageInfo {
  readonly id: string;
  readonly parentId: string | null;
  readonly title: string;
  readonly icon: string | null;
  readonly isFavorited: boolean;
  readonly isArchived: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Serialized canvas page tree node for tool API (M56). */
export interface ToolCanvasPageTreeNode extends ToolCanvasPageInfo {
  readonly children: ToolCanvasPageTreeNode[];
}

/** Serialized canvas page change event for tool API (M56). */
export interface ToolCanvasPageChangeEvent {
  readonly kind: string;
  readonly pageId: string;
  readonly page?: ToolCanvasPageInfo;
}

/**
 * Bridge for the `parallx.workspace` API namespace.
 *
 * Delegates to the ConfigurationService (Cap 4) for reading and writing
 * configuration values, and to the WorkspaceService (M4 Cap 2)
 * for workspace folder access.
 */
export class WorkspaceBridge {
  private _disposed = false;
  private readonly _disposables: IDisposable[] = [];

  /** Forwarded change event. */
  readonly onDidChangeConfiguration: Event<IConfigurationChangeEvent>;

  /** Forwarded folder change event (serialized for tool API). */
  readonly onDidChangeWorkspaceFolders: Event<ToolWorkspaceFoldersChangeEvent>;

  /** Forwarded file change event from IFileService. */
  readonly onDidFilesChange: Event<{ type: number; uri: string }[]>;

  /**
   * Forwarded workspace-switch event.
   *
   * Fires after the workbench has completed a workspace switch — the new
   * workspace identity is active, the database is being re-opened, and
   * folders are being restored.  Tools should use this event to:
   *   1. Cancel any in-flight work from the old workspace
   *   2. Clear in-memory caches
   *   3. Reload data from the new workspace context
   *
   * This is the **single authoritative signal** for workspace transitions.
   * Prefer this over subscribing to raw `IWorkspaceService` events.
   */
  readonly onDidChangeWorkspace: Event<WorkspaceChangeInfo | undefined>;

  /** Fires when the workspace is renamed via `workspace.rename` command. */
  readonly onDidRename: Event<string>;

  /** Fires when a canvas page is created, updated, deleted, moved, or reordered (M56). */
  readonly onDidChangeCanvasPages: Event<ToolCanvasPageChangeEvent>;

  constructor(
    private readonly _toolId: string,
    _subscriptions: IDisposable[],
    private readonly _configService?: ConfigurationService,
    private readonly _workspaceService?: WorkspaceServiceLike,
    private readonly _fileService?: FileServiceLike,
    private readonly _canvasPageQueryResolver?: () => ICanvasPageQueryService | undefined,
  ) {
    if (this._configService) {
      this.onDidChangeConfiguration = this._configService.onDidChangeConfiguration;
    } else {
      // Fallback: no-op event when ConfigurationService is not available
      const fallbackEmitter = new Emitter<IConfigurationChangeEvent>();
      this._disposables.push(fallbackEmitter);
      this.onDidChangeConfiguration = fallbackEmitter.event;
    }

    if (this._workspaceService) {
      // Map internal folder change events to serialized form for tools
      const folderEmitter = new Emitter<ToolWorkspaceFoldersChangeEvent>();
      this._disposables.push(folderEmitter);
      const sub = this._workspaceService.onDidChangeFolders((e) => {
        folderEmitter.fire({
          added: e.added.map(WorkspaceBridge._serializeFolder),
          removed: e.removed.map(WorkspaceBridge._serializeFolder),
        });
      });
      this._disposables.push(sub);
      this.onDidChangeWorkspaceFolders = folderEmitter.event;
    } else {
      const fallbackEmitter = new Emitter<ToolWorkspaceFoldersChangeEvent>();
      this._disposables.push(fallbackEmitter);
      this.onDidChangeWorkspaceFolders = fallbackEmitter.event;
    }

    // Workspace-switch events
    if (this._workspaceService) {
      const wsEmitter = new Emitter<WorkspaceChangeInfo | undefined>();
      this._disposables.push(wsEmitter);
      const wsSub = this._workspaceService.onDidChangeWorkspace((ws) => {
        wsEmitter.fire(ws ? { id: ws.id, name: ws.name } : undefined);
      });
      this._disposables.push(wsSub);
      this.onDidChangeWorkspace = wsEmitter.event;
    } else {
      const fallbackEmitter = new Emitter<WorkspaceChangeInfo | undefined>();
      this._disposables.push(fallbackEmitter);
      this.onDidChangeWorkspace = fallbackEmitter.event;
    }

    // Workspace rename events (A9)
    if (this._workspaceService?.onDidRename) {
      const renameEmitter = new Emitter<string>();
      this._disposables.push(renameEmitter);
      const renameSub = this._workspaceService.onDidRename((name) => {
        renameEmitter.fire(name);
      });
      this._disposables.push(renameSub);
      this.onDidRename = renameEmitter.event;
    } else {
      const fallbackEmitter = new Emitter<string>();
      this._disposables.push(fallbackEmitter);
      this.onDidRename = fallbackEmitter.event;
    }

    // File change events (M4 — file watcher → tree refresh)
    if (this._fileService) {
      const fileChangeEmitter = new Emitter<{ type: number; uri: string }[]>();
      this._disposables.push(fileChangeEmitter);
      const fileSub = this._fileService.onDidFileChange((events) => {
        fileChangeEmitter.fire(events.map(e => ({
          type: e.type as number,
          uri: e.uri.toString(),
        })));
      });
      this._disposables.push(fileSub);
      this.onDidFilesChange = fileChangeEmitter.event;
    } else {
      const fallbackEmitter = new Emitter<{ type: number; uri: string }[]>();
      this._disposables.push(fallbackEmitter);
      this.onDidFilesChange = fallbackEmitter.event;
    }

    // Canvas page change events (M56)
    // Late-bound: the canvas tool registers the service after activation,
    // so we subscribe lazily on first access. The emitter is always available.
    const canvasEmitter = new Emitter<ToolCanvasPageChangeEvent>();
    this._disposables.push(canvasEmitter);
    this.onDidChangeCanvasPages = canvasEmitter.event;

    // Try to subscribe immediately; if the service isn't available yet,
    // getCanvasPages() will re-attempt subscription on first call.
    this._canvasPageEmitter = canvasEmitter;
    this._trySubscribeCanvasEvents();
  }

  /**
   * Get a configuration object scoped to a section.
   */
  getConfiguration(section?: string): IWorkspaceConfiguration {
    this._throwIfDisposed();

    if (this._configService) {
      return this._configService.getConfiguration(section);
    }

    // Fallback: empty configuration when service is not available
    return {
      get: <T>(_key: string, defaultValue?: T): T | undefined => defaultValue,
      update: async () => {},
      has: () => false,
    };
  }

  /**
   * Get the current workspace folders (serialized for tool API).
   */
  get workspaceFolders(): readonly ToolWorkspaceFolder[] | undefined {
    this._throwIfDisposed();
    if (!this._workspaceService) return undefined;
    return this._workspaceService.folders.map(WorkspaceBridge._serializeFolder);
  }

  /**
   * Get the workspace folder containing the given URI string.
   */
  getWorkspaceFolder(uriStr: string): ToolWorkspaceFolder | undefined {
    this._throwIfDisposed();
    if (!this._workspaceService) return undefined;

    const uri = URI.parse(uriStr);
    const folder = this._workspaceService.getWorkspaceFolder(uri);
    return folder ? WorkspaceBridge._serializeFolder(folder) : undefined;
  }

  /**
   * Get the workspace display name.
   */
  get name(): string | undefined {
    this._throwIfDisposed();
    return this._workspaceService?.workspaceName;
  }

  // ── Canvas Page Query (M56) ──

  private _canvasPageEmitter!: Emitter<ToolCanvasPageChangeEvent>;
  private _canvasEventSubscribed = false;

  private _trySubscribeCanvasEvents(): void {
    if (this._canvasEventSubscribed) return;
    const svc = this._canvasPageQueryResolver?.();
    if (!svc) return;
    this._canvasEventSubscribed = true;
    const sub = svc.onDidChangePage((e) => {
      this._canvasPageEmitter.fire({
        kind: e.kind,
        pageId: e.pageId,
        page: e.page ? WorkspaceBridge._serializePage(e.page) : undefined,
      });
    });
    this._disposables.push(sub);
  }

  /**
   * Get all non-archived root-level canvas pages (M56).
   */
  async getCanvasPages(): Promise<ToolCanvasPageInfo[]> {
    this._throwIfDisposed();
    this._trySubscribeCanvasEvents();
    const svc = this._canvasPageQueryResolver?.();
    if (!svc) return [];
    const pages = await svc.getRootPages();
    return pages.filter(p => !p.isArchived).map(WorkspaceBridge._serializePage);
  }

  /**
   * Get the full canvas page tree (M56).
   */
  async getCanvasPageTree(): Promise<ToolCanvasPageTreeNode[]> {
    this._throwIfDisposed();
    this._trySubscribeCanvasEvents();
    const svc = this._canvasPageQueryResolver?.();
    if (!svc) return [];
    const tree = await svc.getPageTree();
    return tree.map(WorkspaceBridge._serializePageTree);
  }

  private static _serializePage(p: { id: string; parentId: string | null; title: string; icon: string | null; isFavorited: boolean; isArchived: boolean; createdAt: string; updatedAt: string }): ToolCanvasPageInfo {
    return {
      id: p.id,
      parentId: p.parentId,
      title: p.title,
      icon: p.icon,
      isFavorited: p.isFavorited,
      isArchived: p.isArchived,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    };
  }

  private static _serializePageTree(p: { id: string; parentId: string | null; title: string; icon: string | null; isFavorited: boolean; isArchived: boolean; createdAt: string; updatedAt: string; children: any[] }): ToolCanvasPageTreeNode {
    return {
      ...WorkspaceBridge._serializePage(p),
      children: (p.children || []).map(WorkspaceBridge._serializePageTree),
    };
  }

  dispose(): void {
    this._disposed = true;
    for (const d of this._disposables) {
      d.dispose();
    }
    this._disposables.length = 0;
  }

  private _throwIfDisposed(): void {
    if (this._disposed) {
      throw new Error(`[WorkspaceBridge] Tool "${this._toolId}" has been deactivated — API access is no longer allowed.`);
    }
  }

  private static _serializeFolder(f: WorkspaceFolder): ToolWorkspaceFolder {
    return {
      uri: f.uri.toString(),
      name: f.name,
      index: f.index,
    };
  }
}
