// workspace.ts — workspace identity model
import {
  WorkspaceIdentity,
  WorkspaceMetadata,
  WorkspaceState,
  WorkbenchState,
  WORKSPACE_STATE_VERSION,
  createDefaultEditorSnapshot,
  createDefaultContextSnapshot,
  type WorkspaceFolder,
  type WorkspaceFoldersChangeEvent,
  type SerializedWorkspaceFolder,
} from './workspaceTypes.js';
import { createDefaultLayoutState } from '../layout/layoutModel.js';
import { URI } from '../platform/uri.js';
import { Emitter, Event } from '../platform/events.js';

// ─── UUID helper ────────────────────────────────────────────────────────────

function generateUUID(): string {
  // crypto.randomUUID() is available in modern browsers and Electron
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback (RFC-4122-ish v4)
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// ─── Workspace ──────────────────────────────────────────────────────────────

/**
 * Represents a workspace with identity, metadata, and state.
 * Can be serialized to / deserialized from storage.
 */
export class Workspace {
  private _identity: WorkspaceIdentity;
  private _metadata: WorkspaceMetadata;

  // ── Folders (M4 Cap 2) ──
  private _folders: WorkspaceFolder[] = [];
  private readonly _onDidChangeFolders = new Emitter<WorkspaceFoldersChangeEvent>();
  readonly onDidChangeFolders: Event<WorkspaceFoldersChangeEvent> = this._onDidChangeFolders.event;
  private readonly _onDidChangeState = new Emitter<WorkbenchState>();
  readonly onDidChangeState: Event<WorkbenchState> = this._onDidChangeState.event;

  constructor(identity: WorkspaceIdentity, metadata?: WorkspaceMetadata) {
    this._identity = identity;
    this._metadata = metadata ?? {
      createdAt: new Date().toISOString(),
      lastAccessedAt: new Date().toISOString(),
    };
  }

  // ── Factory ──

  /**
   * Create a brand-new workspace with a generated UUID.
   */
  static create(name: string, path?: string, iconOrColor?: string): Workspace {
    return new Workspace({
      id: generateUUID(),
      name,
      path,
      iconOrColor,
    });
  }

  /**
   * Reconstruct a Workspace from its serialized identity + metadata.
   */
  static fromSerialized(identity: WorkspaceIdentity, metadata: WorkspaceMetadata): Workspace {
    return new Workspace(identity, metadata);
  }

  // ── Identity ──

  get id(): string { return this._identity.id; }
  get name(): string { return this._identity.name; }
  get path(): string | undefined { return this._identity.path; }
  get iconOrColor(): string | undefined { return this._identity.iconOrColor; }
  get identity(): WorkspaceIdentity { return this._identity; }

  // ── Metadata ──

  get metadata(): WorkspaceMetadata { return this._metadata; }
  get createdAt(): string { return this._metadata.createdAt; }
  get lastAccessedAt(): string { return this._metadata.lastAccessedAt; }

  /**
   * Touch the workspace — update lastAccessedAt to now.
   */
  touch(): void {
    this._metadata = {
      ...this._metadata,
      lastAccessedAt: new Date().toISOString(),
    };
  }

  /**
   * Rename the workspace.
   */
  rename(name: string): void {
    this._identity = { ...this._identity, name };
  }

  /**
   * Update icon or colour tag.
   */
  setIconOrColor(iconOrColor: string | undefined): void {
    this._identity = { ...this._identity, iconOrColor };
  }

  /**
   * Check if two workspace references represent the same workspace.
   */
  equals(other: Workspace): boolean {
    return this._identity.id === other.id;
  }

  // ── Folders (M4 Cap 2) ─────────────────────────────────────────────────

  /**
   * The open workspace folders (read-only snapshot).
   */
  get folders(): readonly WorkspaceFolder[] {
    return this._folders;
  }

  /**
   * Current workspace state classification.
   */
  get state(): WorkbenchState {
    if (this._folders.length === 0) return WorkbenchState.EMPTY;
    return WorkbenchState.FOLDER;
  }

  /**
   * Add a folder to the workspace. Returns the new WorkspaceFolder, or
   * undefined if the URI is already present.
   */
  addFolder(uri: URI, name?: string): WorkspaceFolder | undefined {
    // Reject duplicates
    const key = uri.toKey();
    if (this._folders.some((f) => f.uri.toKey() === key)) {
      return undefined;
    }

    const prevState = this.state;
    const folder: WorkspaceFolder = {
      uri,
      name: name ?? uri.basename,
      index: this._folders.length,
    };
    this._folders.push(folder);
    this._reindex();

    this._onDidChangeFolders.fire({ added: [folder], removed: [] });
    if (this.state !== prevState) {
      this._onDidChangeState.fire(this.state);
    }
    return folder;
  }

  /**
   * Remove a folder by URI. Returns true if found and removed.
   */
  removeFolder(uri: URI): boolean {
    const key = uri.toKey();
    const idx = this._folders.findIndex((f) => f.uri.toKey() === key);
    if (idx === -1) return false;

    const prevState = this.state;
    const removed = this._folders.splice(idx, 1);
    this._reindex();

    this._onDidChangeFolders.fire({ added: [], removed });
    if (this.state !== prevState) {
      this._onDidChangeState.fire(this.state);
    }
    return true;
  }

  /**
   * Reorder folders to match the given URI order.
   */
  reorderFolders(uris: URI[]): void {
    const byKey = new Map(this._folders.map((f) => [f.uri.toKey(), f]));
    const reordered: WorkspaceFolder[] = [];
    for (const u of uris) {
      const f = byKey.get(u.toKey());
      if (f) reordered.push(f);
    }
    // Append any that weren't in the URI list (shouldn't happen, but be safe)
    for (const f of this._folders) {
      if (!reordered.includes(f)) reordered.push(f);
    }
    this._folders = reordered;
    this._reindex();
  }

  /**
   * Replace all folders at once (used during restore).
   */
  setFolders(folders: WorkspaceFolder[]): void {
    const prevState = this.state;
    const removed = [...this._folders];
    this._folders = [...folders];
    this._reindex();

    const added = [...this._folders];
    if (removed.length > 0 || added.length > 0) {
      this._onDidChangeFolders.fire({ added, removed });
    }
    if (this.state !== prevState) {
      this._onDidChangeState.fire(this.state);
    }
  }

  /**
   * Get the workspace folder that contains the given URI, or undefined.
   */
  getWorkspaceFolder(uri: URI): WorkspaceFolder | undefined {
    const target = uri.path.toLowerCase();
    return this._folders.find((f) => {
      const fp = f.uri.path.toLowerCase();
      return target === fp || target.startsWith(fp + '/');
    });
  }

  /**
   * Serialize folders for persistence.
   */
  serializeFolders(): SerializedWorkspaceFolder[] {
    return this._folders.map((f) => ({
      scheme: f.uri.scheme,
      path: f.uri.path,
      name: f.name,
    }));
  }

  /**
   * Restore folders from serialized data.
   */
  restoreFolders(data: readonly SerializedWorkspaceFolder[]): void {
    const folders: WorkspaceFolder[] = data.map((d, i) => ({
      uri: URI.from({ scheme: d.scheme, path: d.path }),
      name: d.name,
      index: i,
    }));
    this.setFolders(folders);
  }

  private _reindex(): void {
    for (let i = 0; i < this._folders.length; i++) {
      (this._folders[i] as { index: number }).index = i;
    }
  }

  // ── Serialization ──

  /**
   * Build a complete default WorkspaceState for this workspace.
   * Used when no saved state exists.
   */
  createDefaultState(width: number, height: number): WorkspaceState {
    return {
      version: WORKSPACE_STATE_VERSION,
      identity: this._identity,
      metadata: this._metadata,
      layout: createDefaultLayoutState(width, height),
      parts: [],
      viewContainers: [],
      views: [],
      editors: createDefaultEditorSnapshot(),
      context: createDefaultContextSnapshot(),
      folders: this.serializeFolders(),
    };
  }

  /**
   * Serialize identity + metadata only (for the recent workspaces list).
   */
  toJSON(): { identity: WorkspaceIdentity; metadata: WorkspaceMetadata } {
    return {
      identity: this._identity,
      metadata: this._metadata,
    };
  }
}