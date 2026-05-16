// capabilityFsBridge.ts — scoped capability filesystem bridge for extensions
//
// Extensions that declare `capabilities.fs` in their manifest receive a
// CapabilityFsBridge instance from `api.requestCapability('fs', ...)` instead
// of the workspace-wide `api.workspace.fs`.
//
// Three scopes (from IManifestFsCapability.scope):
//   extension-data   — paths relative to <workspace>/.parallx/extensions/<id>/
//   workspace-read   — URI strings, read-only access to workspace
//   workspace-files  — URI strings, read+write access to workspace

import { URI } from '../../platform/uri.js';
import type { IFileService } from '../../services/serviceTypes.js';
import type { IManifestFsCapability } from '../../tools/toolManifest.js';

export type FsCapabilityScope = NonNullable<IManifestFsCapability['scope']>;
export type FsCapabilityMode = 'read' | 'write';

/**
 * Scoped filesystem handle returned by `api.requestCapability('fs', ...)`.
 * API surface is identical to `api.workspace.fs` so extensions can swap
 * with minimal changes.
 */
export class CapabilityFsBridge {
  private readonly _extName: string;
  private readonly _scope: FsCapabilityScope;
  private readonly _modes: ReadonlySet<FsCapabilityMode>;

  constructor(
    private readonly _extensionId: string,
    scope: FsCapabilityScope,
    modes: readonly FsCapabilityMode[],
    private readonly _fileService: IFileService,
    private readonly _getWorkspaceFolderUris: () => URI[],
  ) {
    this._extName = _extensionId.includes('.') ? _extensionId.split('.').slice(1).join('.') : _extensionId;
    this._scope = scope;
    this._modes = new Set(modes);
  }

  // ── Public API (matches api.workspace.fs) ─────────────────────────────

  async readFile(pathOrUri: string): Promise<{ content: string; encoding: string }> {
    this._assertMode('read');
    const uri = this._resolve(pathOrUri);
    this._assertWithin(uri);
    const result = await this._fileService.readFile(uri);
    return { content: result.content, encoding: 'utf-8' };
  }

  async writeFile(pathOrUri: string, content: string): Promise<void> {
    this._assertMode('write');
    const uri = this._resolve(pathOrUri);
    this._assertWithin(uri);
    await this._fileService.writeFile(uri, content);
  }

  async stat(pathOrUri: string): Promise<{ type: number; size: number; mtime: number }> {
    this._assertMode('read');
    const uri = this._resolve(pathOrUri);
    this._assertWithin(uri);
    const s = await this._fileService.stat(uri);
    return { type: s.type as number, size: s.size, mtime: s.mtime };
  }

  async readdir(pathOrUri: string): Promise<{ name: string; type: number }[]> {
    this._assertMode('read');
    const uri = this._resolve(pathOrUri);
    this._assertWithin(uri);
    const entries = await this._fileService.readdir(uri);
    return entries.map(e => ({ name: e.name, type: e.type as number }));
  }

  async exists(pathOrUri: string): Promise<boolean> {
    this._assertMode('read');
    const uri = this._resolve(pathOrUri);
    this._assertWithin(uri);
    return this._fileService.exists(uri);
  }

  async rename(src: string, tgt: string): Promise<void> {
    this._assertMode('write');
    const srcUri = this._resolve(src);
    const tgtUri = this._resolve(tgt);
    this._assertWithin(srcUri);
    this._assertWithin(tgtUri);
    await this._fileService.rename(srcUri, tgtUri);
  }

  async delete(pathOrUri: string): Promise<void> {
    this._assertMode('write');
    const uri = this._resolve(pathOrUri);
    this._assertWithin(uri);
    await this._fileService.delete(uri, { useTrash: 'auto' });
  }

  async mkdir(pathOrUri: string): Promise<void> {
    this._assertMode('write');
    const uri = this._resolve(pathOrUri);
    this._assertWithin(uri);
    await this._fileService.mkdir(uri);
  }

  // ── Internal ───────────────────────────────────────────────────────────

  private _resolve(pathOrUri: string): URI {
    if (this._scope !== 'extension-data') {
      return URI.parse(pathOrUri);
    }

    // extension-data: treat as relative path within the extension's data dir.
    // Data dir: <workspace>/.parallx/extensions/<extName>/
    const folders = this._getWorkspaceFolderUris();
    if (folders.length === 0) {
      throw new Error(`[CapabilityFsBridge] No workspace open — extension-data access unavailable`);
    }

    // If caller already passed a full file URI, resolve it directly.
    if (pathOrUri.startsWith('file:')) {
      return URI.parse(pathOrUri);
    }

    const wsFolder = folders[0];
    // Build absolute path: join workspace root, .parallx/extensions/<extName>, and the relative path.
    const parts = [wsFolder.fsPath, '.parallx', 'extensions', this._extName];
    if (pathOrUri) parts.push(...pathOrUri.split('/').filter(Boolean));
    return URI.file(parts.join('/'));
  }

  private _assertMode(mode: FsCapabilityMode): void {
    if (!this._modes.has(mode)) {
      throw new Error(
        `[CapabilityFsBridge] "${this._extensionId}" does not have "${mode}" access in its fs capability declaration`,
      );
    }
  }

  private _assertWithin(uri: URI): void {
    if (uri.scheme !== 'file') {
      throw new Error(`[CapabilityFsBridge] Only file:// URIs are supported (got ${uri.scheme}://)`);
    }

    if (this._scope === 'extension-data') {
      const folders = this._getWorkspaceFolderUris();
      if (folders.length === 0) return;
      const dataRoot = folders[0].fsPath + `/.parallx/extensions/${this._extName}`;
      const targetPath = uri.fsPath.replace(/\\/g, '/');
      const dataRootNorm = dataRoot.replace(/\\/g, '/');
      if (targetPath !== dataRootNorm && !targetPath.startsWith(dataRootNorm + '/')) {
        throw new Error(
          `[CapabilityFsBridge] "${this._extensionId}" attempted access outside its data directory`,
        );
      }
      return;
    }

    // workspace-read / workspace-files: must be within a workspace folder.
    const folders = this._getWorkspaceFolderUris();
    if (folders.length === 0) {
      throw new Error(`[CapabilityFsBridge] No workspace folders open — filesystem access unavailable`);
    }
    const targetPath = uri.path.toLowerCase();
    const isWithin = folders.some(folderUri => {
      const folderPath = folderUri.path.toLowerCase();
      return targetPath === folderPath || targetPath.startsWith(folderPath + '/');
    });
    if (!isWithin) {
      throw new Error(
        `[CapabilityFsBridge] "${this._extensionId}" attempted access outside workspace folders: ${uri.fsPath}`,
      );
    }
  }
}
