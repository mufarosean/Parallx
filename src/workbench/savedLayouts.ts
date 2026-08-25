// savedLayouts.ts — named workbench layouts, saved and switchable.
//
// A saved layout is the WHOLE shape of the body as it exists today: the
// one grid's tree (parts, floating container boxes, detached panel views)
// plus the container rail assignments the tree's boxes do not carry.
// Workspace-scoped, stored through the same key-value storage as the rest
// of workspace state.
//
// Relation to arrangements (FOUNDATION.md decision 4): arrangements
// capture SURFACES, which the body does not run on yet. This store speaks
// the tree the app actually has now; when surfaces land, saved layouts
// fold into arrangements rather than surviving as a second system.

import type { SerializedGrid } from '../layout/layoutModel.js';
import type { SerializedContainerRail } from '../workspace/workspaceTypes.js';

export interface SavedLayout {
  readonly id: string;
  readonly name: string;
  /** ISO timestamp of the save. */
  readonly savedAt: string;
  readonly tree: SerializedGrid;
  readonly rails: readonly SerializedContainerRail[];
}

/** The slice of storage this store needs; matches IStorage. */
export interface ISavedLayoutStorage {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
}

const STORAGE_KEY = 'workbench.savedLayouts';

export class SavedLayoutStore {
  private readonly _byId = new Map<string, SavedLayout>();
  private _loaded = false;

  constructor(private readonly _storage: ISavedLayoutStorage) {}

  /** Read everything from storage. Idempotent; call once at startup. */
  async load(): Promise<void> {
    if (this._loaded) return;
    this._loaded = true;
    const raw = await this._storage.get(STORAGE_KEY);
    if (!raw) return;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      for (const entry of parsed) {
        if (
          entry && typeof entry === 'object'
          && typeof (entry as SavedLayout).id === 'string'
          && typeof (entry as SavedLayout).name === 'string'
          && (entry as SavedLayout).tree && typeof (entry as SavedLayout).tree === 'object'
        ) {
          const layout = entry as SavedLayout;
          this._byId.set(layout.id, {
            ...layout,
            rails: Array.isArray(layout.rails) ? layout.rails : [],
          });
        }
      }
    } catch {
      // A corrupt store loses its contents, never the session.
    }
  }

  /** All layouts, most recently saved first. */
  list(): SavedLayout[] {
    return [...this._byId.values()].sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  }

  get(id: string): SavedLayout | undefined {
    return this._byId.get(id);
  }

  async save(layout: SavedLayout): Promise<void> {
    this._byId.set(layout.id, layout);
    await this._persist();
  }

  async rename(id: string, name: string): Promise<boolean> {
    const existing = this._byId.get(id);
    if (!existing || !name.trim()) return false;
    this._byId.set(id, { ...existing, name: name.trim() });
    await this._persist();
    return true;
  }

  async remove(id: string): Promise<boolean> {
    if (!this._byId.delete(id)) return false;
    await this._persist();
    return true;
  }

  private async _persist(): Promise<void> {
    await this._storage.set(STORAGE_KEY, JSON.stringify([...this._byId.values()]));
  }
}
