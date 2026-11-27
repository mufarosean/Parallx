// homeSources.ts — what Home shows: what every tool that is on has for it.
//
// Home is the page the app opens on. It knows no tool. A tool that keeps
// things of its own (pages, files, decks, a ledger) registers a source here
// while it runs, saying what was last worked on and how to open one; a tool
// with something for today registers one card (a number, a line, one
// action). Turned off, its source and its card go and leave Home with it.
// Extensions register through `parallx.home`.

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
  /** More of its opening text than the summary, line breaks kept: Home draws it small, as a picture of the thing. */
  readonly preview?: string;
  /** A picture of the thing itself (a URL an image element can load), shown in place of the drawn one. */
  readonly image?: string;
  /** One figure about it, shown at the right: '412' with 'words', 'p. 14' with 'of 38'. */
  readonly stat?: { readonly value: string; readonly unit?: string };
  /** Open it. */
  readonly open: () => void;
}

export interface HomeSource {
  /** Stable id (the registering tool's). */
  readonly id: string;
  /** The tool's name: 'Canvas'. */
  readonly label: string;
  /** The most recently touched items, newest first. */
  listRecent(limit: number): Promise<readonly HomeItem[]>;
  /** Items matching the query, beyond the recent ones. Without it, Home searches what is recent. */
  search?(query: string, limit: number): Promise<readonly HomeItem[]>;
  /** These items by id, recent or not (ones that are gone left out). With it, a pinned thing stays on Home after it stopped being recent. */
  find?(ids: readonly string[]): Promise<readonly HomeItem[]>;
  /** Fires when what is recent changed. */
  readonly onDidChange?: Event<void>;
}

/** What a tool has for today: one number, one line, one action. */
export interface HomeCard {
  /** Stable id (the registering tool's, then the card's own). */
  readonly id: string;
  /** The tool's name, as the card says where it is from. */
  readonly from: string;
  /** Registry icon id beside the tool's name. */
  readonly icon?: string;
  /** The figure the card is about: '30'. A card with none is a first step. */
  readonly number?: string;
  /** What the figure counts: 'cards due'. */
  readonly unit?: string;
  /** One sentence under it. */
  readonly line: string;
  /** The one thing to do about it: a command of the tool's. */
  readonly action: { readonly label: string; readonly command: string; readonly args?: readonly unknown[]; readonly icon?: string };
}

/**
 * A card that is read when Home asks: the tool counts when Home opens and
 * when it says its own data changed, and keeps no timer for it.
 */
export interface HomeCardProvider {
  /** Stable id (the registering tool's, then the card's own). */
  readonly id: string;
  /** Today's card, or null when the tool has nothing to say. */
  read(): Promise<HomeCard | null>;
  /** Fires when the card would read differently. */
  readonly onDidChange?: Event<void>;
}

const registry = createRegistry<HomeSource>();
const cards = createRegistry<HomeCardProvider>();

/** A card that is read each time Home asks. The same id again replaces it. */
export function registerHomeCardProvider(provider: HomeCardProvider): IDisposable {
  return cards.register(provider.id, provider);
}

/** A card that says the same until it is registered again under its id. */
export function registerHomeCard(card: HomeCard): IDisposable {
  return cards.register(card.id, { id: card.id, read: async () => card });
}

export function getHomeCardProviders(): readonly HomeCardProvider[] {
  return cards.list();
}

/** Fires when a card or a provider comes, is replaced or goes. */
export const onDidChangeHomeCards: Event<void> = cards.onDidChange;

/** Every tool's card for today, in the order the tools registered; a provider that fails is left out, never the row. */
export async function collectHomeCards(): Promise<HomeCard[]> {
  const read = await Promise.all(getHomeCardProviders().map(async (provider) => {
    try { return await provider.read(); } catch (err) { console.error(`[Home] card "${provider.id}" failed:`, err); return null; }
  }));
  return read.filter((card): card is HomeCard => !!card);
}

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
  return (await readHomeEntries(query, perSource)).entries;
}

/** The same stream, with how many sources could not be read: a page that got nothing from a failed source does not know the workspace is empty. */
export async function readHomeEntries(query: string, perSource = 24): Promise<{ entries: HomeEntry[]; failed: number }> {
  let failed = 0;
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
      failed++;
      return [];
    }
  }));
  return { entries: lists.flat().sort((a, b) => b.item.touchedAt - a.item.touchedAt), failed };
}

/** The things under these keys (source id, item id) that `have` does not hold, asked of the sources that can find by id. */
export async function findHomeEntries(wanted: readonly { readonly sourceId: string; readonly itemId: string }[]): Promise<HomeEntry[]> {
  const found = await Promise.all(getHomeSources().map(async (source) => {
    const ids = wanted.filter((w) => w.sourceId === source.id).map((w) => w.itemId);
    if (!ids.length || !source.find) return [];
    try { return (await source.find(ids)).map((item) => ({ source, item })); } catch (err) { console.error(`[Home] source "${source.id}" could not find its pinned things:`, err); return []; }
  }));
  return found.flat();
}
