// homeSources.ts — what Home shows: recent things from every tool that is on.
//
// Home is one page for everything a person comes back to. It knows no tool:
// a tool that keeps things of its own (pages, files, characters, a ledger)
// registers a source here while it runs, saying what is recent, how to
// search it and how to open one. Turned off, the source goes and its items
// leave Home with it. Extensions register through `parallx.home`.

import { createRegistry } from '../platform/registry.js';
import type { IDisposable } from '../platform/lifecycle.js';
import type { Event } from '../platform/events.js';

export interface HomeItem {
  /** Unique within the source. */
  readonly id: string;
  /** What the user calls it. */
  readonly title: string;
  /** One item's kind, singular: 'Page', 'PDF', 'Character'. */
  readonly kind: string;
  /** Registry icon id for the kind. */
  readonly icon?: string;
  /** One line on what it holds. The source writes it: it knows its own items. */
  readonly summary?: string;
  readonly tags?: readonly string[];
  /** Where it lives: 'Readings / Notes'. */
  readonly where?: string;
  /** When it was last touched, in milliseconds since the epoch. */
  readonly touchedAt: number;
  /** Open it. */
  readonly open: () => void;
}

export interface HomeSource {
  /** Stable id (the registering tool's). */
  readonly id: string;
  /** The tool's name, as its filter chip says it: 'Canvas'. */
  readonly label: string;
  /** The most recently touched items, newest first. */
  listRecent(limit: number): Promise<readonly HomeItem[]>;
  /** Items matching the query, beyond the recent ones. Without it, Home searches what is recent. */
  search?(query: string, limit: number): Promise<readonly HomeItem[]>;
  /** Fires when what is recent changed. */
  readonly onDidChange?: Event<void>;
}

const registry = createRegistry<HomeSource>();

export function registerHomeSource(source: HomeSource): IDisposable {
  return registry.register(source.id, source);
}

export function getHomeSources(): readonly HomeSource[] {
  return registry.list();
}

/** Fires when a source comes or goes (a tool turned on or off). */
export const onDidChangeHomeSources: Event<void> = registry.onDidChange;

export interface HomeEntry {
  readonly source: HomeSource;
  readonly item: HomeItem;
}

/**
 * Every source's items as one stream, newest first. A query asks each source
 * to search (or filters its recent items when it cannot); a source that
 * fails is left out, never the page.
 */
export async function collectHomeEntries(query: string, perSource = 24): Promise<HomeEntry[]> {
  const q = query.trim().toLowerCase();
  const lists = await Promise.all(getHomeSources().map(async (source) => {
    try {
      const recent = await source.listRecent(perSource);
      if (!q) return recent.map((item) => ({ source, item }));
      const hit = (item: HomeItem): boolean => [item.title, item.summary, item.kind, item.where, source.label, ...(item.tags ?? [])].some((t) => t?.toLowerCase().includes(q));
      const seen = new Set<string>();
      const found = [...recent.filter(hit), ...(source.search ? await source.search(query.trim(), perSource) : [])];
      return found.filter((item) => !seen.has(item.id) && !!seen.add(item.id)).map((item) => ({ source, item }));
    } catch (err) {
      console.error(`[Home] source "${source.id}" failed:`, err);
      return [];
    }
  }));
  return lists.flat().sort((a, b) => b.item.touchedAt - a.item.touchedAt);
}
