// recentsService.ts — ONE owner for per-workspace recency (Retirement 3.7).
//
// Before this service, "what did I use recently" was tracked by four
// independent systems: quickAccess kept a recent-commands MRU and a
// recent-files list (each with its own storage key + parser), the explorer
// kept a files+pages list in its tool workspaceState, and Welcome
// re-implemented raw reads of two of those keys — the duplicate-key drift
// that made Welcome's recents permanently empty. Now: the lists live HERE,
// hydrated once from workspace storage, read synchronously from memory, and
// every consumer (palette, dashboard widget, Welcome) asks this service.
//
// Recent WORKSPACES are global-scoped and stay with RecentWorkspaces /
// IWorkspaceService.getRecentWorkspaces() — this service is per-workspace.
//
// No data migration from the pre-3.7 keys: recency lists repopulate
// passively with zero user effort (unlike, say, keyboard rebinds), so the
// old lists are simply orphaned.

import type { IStorage } from '../platform/storage.js';
import { createServiceIdentifier } from '../platform/types.js';

/** One opened thing. `key` dedups: `file:<uri>` or `page:<pageId>`. */
export interface RecentOpenedItem {
  readonly key: string;
  readonly kind: 'file' | 'page';
  readonly title: string;
  /** File URI (kind 'file') or page id (kind 'page') — used to reopen. */
  readonly target: string;
  readonly ts: number;
}

export interface IRecentsServiceShape {
  /** Resolves once the persisted lists are hydrated into memory. */
  readonly whenReady: Promise<void>;
  /** Record an opened file/page (stamps ts, MRU-dedups, caps, persists). */
  recordOpen(item: Omit<RecentOpenedItem, 'ts'>): void;
  /** Every recently-opened item, most recent first. */
  getRecentOpens(): readonly RecentOpenedItem[];
  /** Just the file URIs, most recent first (palette ordering, Welcome). */
  getRecentFileUris(): string[];
  /** Record a command execution in the palette MRU. */
  recordCommand(commandId: string): void;
  /** The palette's recent-command MRU, most recent first. */
  getRecentCommandIds(): string[];
}

export const IRecentsService = createServiceIdentifier<IRecentsServiceShape>('IRecentsService');

const OPENS_KEY = 'recents.opens';
const COMMANDS_KEY = 'recents.commands';
const OPENS_CAP = 30;
const COMMANDS_CAP = 5;
const FILE_URIS_CAP = 20;

export class RecentsService implements IRecentsServiceShape {
  private _opens: RecentOpenedItem[] = [];
  private _commandIds: string[] = [];
  readonly whenReady: Promise<void>;

  constructor(private readonly _storage: IStorage | undefined) {
    this.whenReady = this._hydrate();
  }

  private async _hydrate(): Promise<void> {
    if (!this._storage) return;
    try {
      const raw = await this._storage.get(OPENS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this._opens = parsed.filter((x): x is RecentOpenedItem =>
            !!x && typeof x.key === 'string' && typeof x.title === 'string'
            && (x.kind === 'file' || x.kind === 'page') && typeof x.target === 'string');
        }
      }
    } catch { /* fresh start */ }
    try {
      const raw = await this._storage.get(COMMANDS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this._commandIds = parsed.filter((x): x is string => typeof x === 'string');
        }
      }
    } catch { /* fresh start */ }
  }

  recordOpen(item: Omit<RecentOpenedItem, 'ts'>): void {
    const next: RecentOpenedItem = { ...item, ts: Date.now() };
    this._opens = [next, ...this._opens.filter((r) => r.key !== next.key)].slice(0, OPENS_CAP);
    void this._storage?.set(OPENS_KEY, JSON.stringify(this._opens));
  }

  getRecentOpens(): readonly RecentOpenedItem[] {
    return this._opens;
  }

  getRecentFileUris(): string[] {
    return this._opens.filter((r) => r.kind === 'file').map((r) => r.target).slice(0, FILE_URIS_CAP);
  }

  recordCommand(commandId: string): void {
    this._commandIds = [commandId, ...this._commandIds.filter((id) => id !== commandId)].slice(0, COMMANDS_CAP);
    void this._storage?.set(COMMANDS_KEY, JSON.stringify(this._commandIds));
  }

  getRecentCommandIds(): string[] {
    return this._commandIds;
  }
}
