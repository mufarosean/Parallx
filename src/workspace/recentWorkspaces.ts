// recentWorkspaces.ts — manages the persisted list of recent workspaces
//
// Stores a capped, ordered list of recently accessed workspaces
// in global (non-workspace-specific) storage.

import type { IStorage } from '../platform/storage.js';
import type { RecentWorkspaceEntry } from './workspaceTypes.js';
import {
  RECENT_WORKSPACES_KEY,
  DEFAULT_MAX_RECENT_WORKSPACES,
} from './workspaceTypes.js';
import type { Workspace } from './workspace.js';

/**
 * Manages a capped, ordered list of recently accessed workspaces.
 * Stored in global (non-workspace-specific) storage.
 */
export class RecentWorkspaces {
  private _maxSize: number;

  constructor(
    private readonly _storage: IStorage,
    maxSize = DEFAULT_MAX_RECENT_WORKSPACES,
  ) {
    this._maxSize = maxSize;
  }

  /**
   * Get all recent workspace entries, sorted by lastAccessedAt descending.
   */
  async getAll(): Promise<readonly RecentWorkspaceEntry[]> {
    try {
      const json = await this._storage.get(RECENT_WORKSPACES_KEY);
      if (!json) return [];

      const parsed = JSON.parse(json);
      if (!Array.isArray(parsed)) return [];

      return parsed as RecentWorkspaceEntry[];
    } catch {
      return [];
    }
  }

  /**
   * Add (or update) a workspace in the recent list.
   * Moves it to the top and trims the list to maxSize.
   */
  async add(workspace: Workspace): Promise<void> {
    const list = await this._getList();

    // Remove existing entry with same ID
    const filtered = list.filter(e => e.identity.id !== workspace.id);

    // Prepend current workspace
    workspace.touch();
    const entry: RecentWorkspaceEntry = {
      identity: workspace.identity,
      metadata: workspace.metadata,
    };
    filtered.unshift(entry);

    // Trim to max
    const trimmed = filtered.slice(0, this._maxSize);
    await this._saveList(trimmed);
  }

  /**
   * Remove a workspace from the recent list.
   */
  async remove(workspaceId: string): Promise<void> {
    const list = await this._getList();
    const filtered = list.filter(e => e.identity.id !== workspaceId);
    await this._saveList(filtered);
  }

  /**
   * Clear the entire recent list.
   */
  async clear(): Promise<void> {
    await this._storage.delete(RECENT_WORKSPACES_KEY);
  }

  /**
   * Get the number of recent entries.
   */
  async count(): Promise<number> {
    const list = await this._getList();
    return list.length;
  }

  private async _getList(): Promise<RecentWorkspaceEntry[]> {
    try {
      const json = await this._storage.get(RECENT_WORKSPACES_KEY);
      if (!json) return [];
      const parsed = JSON.parse(json);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private async _saveList(list: RecentWorkspaceEntry[]): Promise<void> {
    await this._storage.set(RECENT_WORKSPACES_KEY, JSON.stringify(list));
  }
}
