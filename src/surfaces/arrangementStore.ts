// arrangementStore.ts — named shapes of the app, kept
//
// Foundation Decision 5, second half. arrangement.ts made a shape capturable;
// this makes it durable: saved by name, listed, switched, and one of them —
// home — always there when the app opens.
//
// The mechanics mirror the house pattern for named user collections
// (user themes, AI presets): ONE storage key holding a JSON array, a second
// for the active id, validation on load that drops what it cannot read
// rather than refusing to start. Storage is the file-backed per-workspace
// IStorage — arrangements are small structural documents that must be
// exportable as files, so they do not belong in SQLite, and they are state
// with identity, not settings, so they do not belong in the settings
// registry either.
//
// Takes the narrow storage surface it needs rather than IStorage itself so
// the surfaces layer keeps zero service imports and the whole store tests
// against a Map.

import { Emitter } from '../platform/events.js';
import type { Event } from '../platform/events.js';
import { parseArrangement } from './arrangement.js';
import type { Arrangement } from './arrangement.js';

/** The subset of IStorage this store needs. */
export interface IArrangementStorage {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
}

const ARRANGEMENTS_KEY = 'surfaces.arrangements';
const ACTIVE_KEY = 'surfaces.activeArrangementId';

/**
 * The deterministic landing shape. "What if the app had a real home page
 * that it always lands on when first opened" — this is that page's identity.
 * A workspace without one falls back to whatever was open, exactly as today.
 */
export const HOME_ARRANGEMENT_ID = 'arrangement.home';

export class ArrangementStore {
  private readonly _byId = new Map<string, Arrangement>();
  private _activeId: string | undefined;
  private _loaded = false;

  private readonly _onDidChange = new Emitter<void>();
  readonly onDidChange: Event<void> = this._onDidChange.event;

  constructor(private readonly _storage: IArrangementStorage) {}

  /**
   * Read everything from storage. Idempotent; call once at startup.
   *
   * Every entry passes through parseArrangement — the same gate an imported
   * file passes — so one corrupt entry costs that entry, never the list.
   * Returns how many were dropped so the caller can say so.
   */
  async load(): Promise<{ loaded: number; dropped: number }> {
    let dropped = 0;
    this._byId.clear();

    const raw = await this._storage.get(ARRANGEMENTS_KEY);
    if (raw) {
      let entries: unknown;
      try {
        entries = JSON.parse(raw);
      } catch {
        entries = undefined;
      }
      if (Array.isArray(entries)) {
        for (const entry of entries) {
          const arrangement = parseArrangement(entry);
          if (arrangement) {
            this._byId.set(arrangement.id, arrangement);
          } else {
            dropped++;
          }
        }
      } else if (entries !== undefined) {
        dropped++;
      }
    }

    this._activeId = (await this._storage.get(ACTIVE_KEY)) || undefined;
    if (this._activeId && !this._byId.has(this._activeId)) this._activeId = undefined;

    this._loaded = true;
    this._onDidChange.fire();
    return { loaded: this._byId.size, dropped };
  }

  get isLoaded(): boolean { return this._loaded; }

  /** All saved arrangements, home first, then by name. */
  list(): readonly Arrangement[] {
    return [...this._byId.values()].sort((a, b) => {
      if (a.id === HOME_ARRANGEMENT_ID) return -1;
      if (b.id === HOME_ARRANGEMENT_ID) return 1;
      return a.name.localeCompare(b.name);
    });
  }

  get(id: string): Arrangement | undefined {
    return this._byId.get(id);
  }

  /** The home arrangement, when one has been saved. */
  getHome(): Arrangement | undefined {
    return this._byId.get(HOME_ARRANGEMENT_ID);
  }

  get activeId(): string | undefined { return this._activeId; }

  /** Upsert by id and persist. */
  async save(arrangement: Arrangement): Promise<void> {
    this._byId.set(arrangement.id, arrangement);
    await this._persist();
    this._onDidChange.fire();
  }

  /** Save `arrangement` as THE home shape, whatever id it was captured under. */
  async saveAsHome(arrangement: Arrangement): Promise<void> {
    await this.save({ ...arrangement, id: HOME_ARRANGEMENT_ID, name: 'Home' });
  }

  async remove(id: string): Promise<void> {
    if (!this._byId.delete(id)) return;
    if (this._activeId === id) {
      this._activeId = undefined;
      await this._storage.set(ACTIVE_KEY, '');
    }
    await this._persist();
    this._onDidChange.fire();
  }

  async rename(id: string, name: string): Promise<void> {
    const existing = this._byId.get(id);
    if (!existing || existing.name === name) return;
    this._byId.set(id, { ...existing, name });
    await this._persist();
    this._onDidChange.fire();
  }

  /** Record which arrangement the workspace is currently shaped as. */
  async setActive(id: string | undefined): Promise<void> {
    if (this._activeId === id) return;
    this._activeId = id && this._byId.has(id) ? id : undefined;
    await this._storage.set(ACTIVE_KEY, this._activeId ?? '');
    this._onDidChange.fire();
  }

  /**
   * Accept an arrangement from a file someone exported. The same parse gate
   * as load: undefined means the file is malformed, and saying so is the
   * caller's job.
   */
  static parseImport(raw: string): Arrangement | undefined {
    try {
      return parseArrangement(JSON.parse(raw));
    } catch {
      return undefined;
    }
  }

  /** The file form of an arrangement. Pretty-printed: it is meant to be shared. */
  static serializeExport(arrangement: Arrangement): string {
    return JSON.stringify(arrangement, null, 2);
  }

  private async _persist(): Promise<void> {
    await this._storage.set(ARRANGEMENTS_KEY, JSON.stringify([...this._byId.values()]));
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}
