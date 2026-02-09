// workspace.ts — workspace identity model
import {
  WorkspaceIdentity,
  WorkspaceMetadata,
  WorkspaceState,
  WORKSPACE_STATE_VERSION,
  createDefaultEditorSnapshot,
  createDefaultContextSnapshot,
} from './workspaceTypes.js';
import { createDefaultLayoutState, SerializedLayoutState } from '../layout/layoutModel.js';

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