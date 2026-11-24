// workProviders.ts — the time and the items a tool's work came to, offered to any tool that keeps a record
//
// A tool in which a person works (problems, cards, drills) registers a
// provider while it runs; a tool that keeps a record of work lists whatever
// providers it finds and reads them. Neither names the other: the core
// defines the shape and the tools fill it (CLAUDE.md, the first principle).
// Every provider reports the same thing: for each local day and each group
// of its items (a paper, a tag, a deck), the minutes worked, the items
// worked, and how many were right where the tool knows. The minutes come
// from the core's clock (workClock.ts), so every tool counts time one way.
//
// A provider only reports; it writes nothing of the reader's. So the record
// is the reader's own and outlives a provider: turned off, a tool's provider
// goes with its subscriptions and `onDidChangeWorkProviders` fires; what was
// read from it before stays wherever the reader kept it, and the tool's own
// store still has it when the tool is on again.
//
// Module-global registry (providers survive activation order). A tool
// reaches it through `api.work` (src/api/bridges/workBridge.ts).

import { createRegistry } from '../platform/registry.js';
import type { Event } from '../platform/events.js';
import type { IDisposable } from '../platform/lifecycle.js';

/** A group of a provider's items: `group` is the provider's own key, `label` the name a person reads. */
export interface IWorkGroup {
  readonly group: string;
  readonly label: string;
}

/**
 * The work of one local day on the items of one set of groups. An item can
 * be in several groups at once (a card in its deck and in each of its tags):
 * they are all named, the most particular first, and the work is still one
 * piece of work. A reader counts an entry once, never once per group.
 */
export interface IWorkEntry {
  /** The local day the work was done on, 'YYYY-MM-DD'. */
  readonly day: string;
  readonly groups: readonly IWorkGroup[];
  /** Minutes worked, by the core's clock; may carry a fraction. */
  readonly minutes: number;
  /** Items worked that day (problems rated, cards reviewed). */
  readonly items: number;
  /** How many of them were right; left out when the tool cannot say. */
  readonly right?: number;
}

export interface IWorkProvider {
  /** Stable, unique across tools: `<tool>.<store>`. */
  readonly id: string;
  /** The tool's name as a person reads it. */
  readonly displayName: string;
  /** The kind of work, as a person reads it: "Problems", "Cards". */
  readonly kind: string;
  /** The tool that registered it. */
  readonly toolId: string;
  /** Every day's work as it stands now. With `since`, the days from that local day on are enough. */
  work(since?: string): Promise<readonly IWorkEntry[]> | readonly IWorkEntry[];
  /** Fires when any day's numbers may have changed. */
  onDidChange(listener: () => void): IDisposable;
}

const registry = createRegistry<IWorkProvider>();

/** Fires when a provider is registered, replaced or disposed. */
export const onDidChangeWorkProviders: Event<void> = registry.onDidChange;

export function listWorkProviders(): readonly IWorkProvider[] {
  return registry.list();
}

/**
 * Register a provider. The same id again replaces the earlier provider (with
 * a warning); disposing the earlier one afterwards leaves the replacement.
 */
export function registerWorkProvider(provider: IWorkProvider): IDisposable {
  if (!provider || typeof provider.id !== 'string' || !provider.id.trim()) {
    throw new Error('[workProviders] A provider needs an id.');
  }
  if (typeof provider.work !== 'function') {
    throw new Error(`[workProviders] Provider "${provider.id}" needs a work() function.`);
  }
  if (typeof provider.onDidChange !== 'function') {
    throw new Error(`[workProviders] Provider "${provider.id}" needs an onDidChange event.`);
  }
  if (registry.get(provider.id)) {
    console.warn(`[workProviders] Provider "${provider.id}" registered twice; the later one replaces the earlier.`);
  }
  return registry.register(provider.id, provider);
}

/**
 * A provider's entries made safe to keep: a day that is a date, numbers that
 * are numbers and none below zero, `right` never more than `items`, groups
 * with a key and a label. An entry that is not one is left out.
 */
export function cleanWorkEntries(list: unknown): IWorkEntry[] {
  const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; };
  const out: IWorkEntry[] = [];
  for (const e of Array.isArray(list) ? list : []) {
    if (!e || typeof e !== 'object') continue;
    const raw = e as { day?: unknown; groups?: unknown; minutes?: unknown; items?: unknown; right?: unknown };
    const day = String(raw.day ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    const groups = (Array.isArray(raw.groups) ? raw.groups : [])
      .filter((g): g is { group?: unknown; label?: unknown } => !!g && typeof g === 'object')
      .map((g) => ({ group: String(g.group ?? ''), label: String(g.label ?? g.group ?? '') }))
      .filter((g) => g.group || g.label);
    const items = Math.floor(num(raw.items));
    const entry: IWorkEntry = { day, groups, minutes: num(raw.minutes), items };
    out.push(raw.right === undefined || raw.right === null ? entry : { ...entry, right: Math.min(items, Math.floor(num(raw.right))) });
  }
  return out;
}
