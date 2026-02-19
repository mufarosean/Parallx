import { Disposable } from '../platform/lifecycle.js';
import { URI } from '../platform/uri.js';
import type { WorkspaceFolder } from '../workspace/workspaceTypes.js';
import type { IWorkspaceBoundaryService } from './serviceTypes.js';

export interface WorkspaceBoundaryHost {
  readonly folders: readonly WorkspaceFolder[];
}

export class WorkspaceBoundaryService extends Disposable implements IWorkspaceBoundaryService {
  private _host: WorkspaceBoundaryHost | undefined;

  setHost(host: WorkspaceBoundaryHost): void {
    this._host = host;
  }

  get folders(): readonly WorkspaceFolder[] {
    return this._host?.folders ?? [];
  }

  isUriWithinWorkspace(uri: URI): boolean {
    if (uri.scheme !== 'file') return false;

    const targetPath = uri.path.toLowerCase();
    const folders = this.folders;

    return folders.some((folder) => {
      const folderPath = folder.uri.path.toLowerCase();
      return targetPath === folderPath || targetPath.startsWith(folderPath + '/');
    });
  }

  assertUriWithinWorkspace(uri: URI, requester: string): void {
    if (this.folders.length === 0) {
      throw new Error(
        `[WorkspaceBoundaryService] ${requester} attempted filesystem access with no workspace folders open.`,
      );
    }

    if (!this.isUriWithinWorkspace(uri)) {
      throw new Error(
        `[WorkspaceBoundaryService] ${requester} attempted access outside workspace folders: ${uri.fsPath}`,
      );
    }
  }
}
