// filesystemSurface.ts — FilesystemSurfacePlugin (M58 W6)
//
// Routes file-write deliveries through the workspace IFileService.
//
// Upstream parity:
//   - ChannelPlugin.outbound for file/disk channels — binary + text delivery
//   - (github.com/openclaw/openclaw src/channels/)
//
// Parallx adaptation:
//   - Text + structured (serialized JSON) content types
//   - All writes go through IFileService.writeFile, respecting any installed
//     boundary checker (.parallxignore / workspace sandbox)
//   - Path resolved relative to first workspace folder; absolute paths are
//     rejected unless `metadata.allowAbsolute === true`

import type { IFileService, IWorkspaceService } from '../serviceTypes.js';
import { URI } from '../../platform/uri.js';
import {
  SURFACE_FILESYSTEM,
  type ISurfaceCapabilities,
  type ISurfaceDelivery,
  type ISurfacePlugin,
} from '../../openclaw/openclawSurfacePlugin.js';

const CAPABILITIES: ISurfaceCapabilities = {
  supportsText: true,
  supportsStructured: true,
  supportsBinary: false,
  supportsActions: false,
};

export class FilesystemSurfacePlugin implements ISurfacePlugin {
  readonly id = SURFACE_FILESYSTEM;
  readonly capabilities = CAPABILITIES;

  constructor(
    private readonly _fileService: IFileService,
    private readonly _workspaceService: IWorkspaceService | undefined,
  ) {}

  isAvailable(): boolean {
    // Needs at least one workspace folder to resolve relative paths.
    return (this._workspaceService?.folders?.length ?? 0) > 0;
  }

  async deliver(delivery: ISurfaceDelivery): Promise<boolean> {
    if (!this.isAvailable()) {
      // Permanent — isPermanentDeliveryError matches "not available"
      throw new Error('Filesystem surface not available: no workspace folder open');
    }

    const path = readString(delivery.metadata.path);
    if (!path) {
      throw new Error('Filesystem delivery requires metadata.path');
    }

    const allowAbsolute = delivery.metadata.allowAbsolute === true;
    const target = this._resolveUri(path, allowAbsolute);

    const body = this._renderBody(delivery);
    await this._fileService.writeFile(target, body);
    return true;
  }

  dispose(): void {
    // No owned resources.
  }

  // ── Internals ──

  private _resolveUri(relOrAbs: string, allowAbsolute: boolean): URI {
    // Absolute path handling — only if explicitly allowed.
    const isAbsolute = /^([a-zA-Z]:[\\/]|\/)/.test(relOrAbs);
    if (isAbsolute) {
      if (!allowAbsolute) {
        throw new Error(`Absolute paths not allowed: "${relOrAbs}"`);
      }
      return URI.file(relOrAbs);
    }

    // Reject traversal even in relative paths.
    if (relOrAbs.includes('..')) {
      throw new Error(`Path traversal not allowed: "${relOrAbs}"`);
    }

    const firstFolder = this._workspaceService?.folders?.[0]?.uri;
    if (!firstFolder) {
      throw new Error('No workspace folder to resolve relative path against');
    }

    // Join first folder fsPath with the relative path.
    const base = firstFolder.fsPath.replace(/[\\/]+$/, '');
    const normalized = relOrAbs.replace(/\\/g, '/');
    return URI.file(`${base}/${normalized}`);
  }

  private _renderBody(delivery: ISurfaceDelivery): string {
    if (delivery.contentType === 'structured') {
      try {
        return JSON.stringify(delivery.content, null, 2);
      } catch (err) {
        throw new Error(`Failed to serialize structured content: ${(err as Error).message}`);
      }
    }
    // text (supported) — everything else is blocked by router capability check
    if (typeof delivery.content === 'string') return delivery.content;
    return String(delivery.content ?? '');
  }
}

function readString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}
