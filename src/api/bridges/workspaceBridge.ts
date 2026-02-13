// workspaceBridge.ts — bridges parallx.workspace to configuration + folders
//
// Provides configuration read access, change events, and workspace folder
// access for tools. In M2, configuration is backed by the ConfigurationService
// (Cap 4) which persists values per-workspace in IStorage.
// In M4 Cap 2, workspace folders are exposed from the WorkspaceService.

import { IDisposable, toDisposable } from '../../platform/lifecycle.js';
import { Emitter, Event } from '../../platform/events.js';
import { URI } from '../../platform/uri.js';
import type { ConfigurationService } from '../../configuration/configurationService.js';
import type { IWorkspaceConfiguration, IConfigurationChangeEvent } from '../../configuration/configurationTypes.js';
import type { WorkspaceFolder, WorkspaceFoldersChangeEvent } from '../../workspace/workspaceTypes.js';
import type { FileChangeEvent } from '../../platform/fileTypes.js';

/** Minimal shape of the workspace service for the bridge. */
interface WorkspaceServiceLike {
  readonly folders: readonly WorkspaceFolder[];
  readonly workspaceName: string;
  readonly onDidChangeFolders: Event<WorkspaceFoldersChangeEvent>;
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

  constructor(
    private readonly _toolId: string,
    private readonly _subscriptions: IDisposable[],
    private readonly _configService?: ConfigurationService,
    private readonly _workspaceService?: WorkspaceServiceLike,
    private readonly _fileService?: FileServiceLike,
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
