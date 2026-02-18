// fileSystemBridge.ts — bridges parallx.workspace.fs to IFileService
//
// Provides scoped filesystem access for tools. Tools can only access
// files within workspace folders (enforced by path validation).
//
// VS Code reference: vscode.workspace.fs namespace

import { URI } from '../../platform/uri.js';
import type { FileStat, FileEntry } from '../../platform/fileTypes.js';
import type { IFileService } from '../../services/serviceTypes.js';
import type { WorkspaceBoundaryService } from '../../services/workspaceBoundaryService.js';

/**
 * Bridge for `parallx.workspace.fs` — scoped filesystem access for tools.
 *
 * All operations validate that the target URI is within workspace folders.
 * Bridge validates tool is active before every call.
 */
export class FileSystemBridge {
  private _disposed = false;

  constructor(
    private readonly _toolId: string,
    private readonly _fileService: IFileService,
    private readonly _getWorkspaceFolderUris: () => URI[],
    private readonly _boundaryService?: WorkspaceBoundaryService,
  ) {}

  // ── Public API (matches parallx.workspace.fs) ────────────────────────

  async readFile(uri: URI): Promise<string> {
    this._throwIfDisposed();
    this._validateScope(uri);
    const content = await this._fileService.readFile(uri);
    return content.content;
  }

  async writeFile(uri: URI, content: string): Promise<void> {
    this._throwIfDisposed();
    this._validateScope(uri);
    await this._fileService.writeFile(uri, content);
  }

  async stat(uri: URI): Promise<FileStat> {
    this._throwIfDisposed();
    this._validateScope(uri);
    return this._fileService.stat(uri);
  }

  async readdir(uri: URI): Promise<FileEntry[]> {
    this._throwIfDisposed();
    this._validateScope(uri);
    return this._fileService.readdir(uri);
  }

  async exists(uri: URI): Promise<boolean> {
    this._throwIfDisposed();
    this._validateScope(uri);
    return this._fileService.exists(uri);
  }

  async delete(uri: URI): Promise<void> {
    this._throwIfDisposed();
    this._validateScope(uri);
    await this._fileService.delete(uri, { useTrash: true });
  }

  async rename(source: URI, target: URI): Promise<void> {
    this._throwIfDisposed();
    this._validateScope(source);
    this._validateScope(target);
    await this._fileService.rename(source, target);
  }

  async createDirectory(uri: URI): Promise<void> {
    this._throwIfDisposed();
    this._validateScope(uri);
    await this._fileService.mkdir(uri);
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────

  dispose(): void {
    this._disposed = true;
  }

  // ── Internal ───────────────────────────────────────────────────────────

  /**
   * Validate that a URI is within one of the workspace folders.
   * Tools should NOT get unbounded filesystem access.
   */
  private _validateScope(uri: URI): void {
    if (uri.scheme !== 'file') {
      throw new Error(`[FileSystemBridge] Only file:// URIs are supported (got ${uri.scheme}://)`);
    }

    if (this._boundaryService) {
      this._boundaryService.assertUriWithinWorkspace(uri, `Tool "${this._toolId}"`);
      return;
    }

    const folders = this._getWorkspaceFolderUris();
    if (folders.length === 0) {
      throw new Error(`[FileSystemBridge] No workspace folders open — filesystem operations unavailable`);
    }

    const targetPath = uri.path.toLowerCase();
    const isWithin = folders.some((folderUri) => {
      const folderPath = folderUri.path.toLowerCase();
      return targetPath === folderPath || targetPath.startsWith(folderPath + '/');
    });

    if (!isWithin) {
      throw new Error(
        `[FileSystemBridge] Tool "${this._toolId}" attempted access outside workspace folders: ${uri.fsPath}`,
      );
    }
  }

  private _throwIfDisposed(): void {
    if (this._disposed) {
      throw new Error(
        `[FileSystemBridge] Tool "${this._toolId}" has been deactivated — API access is no longer allowed.`,
      );
    }
  }
}
