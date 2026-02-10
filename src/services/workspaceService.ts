// workspaceService.ts — IWorkspaceService thin facade
//
// Delegates workspace operations to the Workbench instance.
// Registered in the DI container during Phase 3 after the workspace
// subsystem (Workspace, WorkspaceLoader, WorkspaceSaver) exists.

import { Disposable } from '../platform/lifecycle.js';
import { Emitter, Event } from '../platform/events.js';
import type { Workspace } from '../workspace/workspace.js';
import type { WorkspaceState, RecentWorkspaceEntry } from '../workspace/workspaceTypes.js';
import type { IWorkspaceService } from './serviceTypes.js';

/**
 * Minimal shape of the workbench for workspace delegation.
 * Avoids circular import of the full Workbench class.
 */
interface WorkspaceHost {
  readonly workspace: Workspace;
  readonly _workspaceSaver: { save(): Promise<void>; requestSave(): void };
  createWorkspace(name: string, path?: string, switchTo?: boolean): Promise<Workspace>;
  switchWorkspace(workspaceId: string): Promise<void>;
  getRecentWorkspaces(): Promise<readonly RecentWorkspaceEntry[]>;
  removeRecentWorkspace(workspaceId: string): Promise<void>;
  readonly onDidSwitchWorkspace: Event<Workspace>;
}

/**
 * Thin facade over the Workbench's workspace subsystem.
 * Tools and services access workspace operations through this service
 * rather than reaching into Workbench internals.
 */
export class WorkspaceService extends Disposable implements IWorkspaceService {

  private _host: WorkspaceHost | undefined;
  private _isRestored = false;

  private readonly _onDidChangeWorkspace = this._register(new Emitter<Workspace | undefined>());
  readonly onDidChangeWorkspace: Event<Workspace | undefined> = this._onDidChangeWorkspace.event;

  private readonly _onDidRestoreState = this._register(new Emitter<WorkspaceState>());
  readonly onDidRestoreState: Event<WorkspaceState> = this._onDidRestoreState.event;

  /**
   * Bind the workspace host (Workbench). Called once during Phase 3.
   */
  setHost(host: WorkspaceHost): void {
    this._host = host;
    // Forward workspace-switch events
    this._register(host.onDidSwitchWorkspace((ws) => {
      this._onDidChangeWorkspace.fire(ws);
    }));
  }

  /** Mark the workspace as restored (called after Phase 4). */
  markRestored(state: WorkspaceState): void {
    this._isRestored = true;
    this._onDidRestoreState.fire(state);
  }

  get activeWorkspace(): Workspace | undefined {
    return this._host?.workspace;
  }

  get isRestored(): boolean {
    return this._isRestored;
  }

  async save(): Promise<void> {
    await this._host?._workspaceSaver.save();
  }

  requestSave(): void {
    this._host?._workspaceSaver.requestSave();
  }

  async createWorkspace(name: string, path?: string, switchTo?: boolean): Promise<Workspace> {
    if (!this._host) throw new Error('WorkspaceService not initialized');
    return this._host.createWorkspace(name, path, switchTo);
  }

  async switchWorkspace(workspaceId: string): Promise<void> {
    if (!this._host) throw new Error('WorkspaceService not initialized');
    await this._host.switchWorkspace(workspaceId);
  }

  async getRecentWorkspaces(): Promise<readonly RecentWorkspaceEntry[]> {
    if (!this._host) return [];
    return this._host.getRecentWorkspaces();
  }

  async removeRecentWorkspace(workspaceId: string): Promise<void> {
    await this._host?.removeRecentWorkspace(workspaceId);
  }
}
