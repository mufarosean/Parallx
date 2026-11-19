// progressProviders.ts — how far along a tool's items are, offered to any tool that shows progress
//
// A tool whose items are worked and rated (problems, cards, drills) registers
// a provider while it runs; a tool that shows progress lists whatever
// providers it finds. Neither names the other: the core defines the shape and
// the tools fill it (CLAUDE.md, the first principle). Every provider speaks
// the same four states, so a reader can draw one bar for any of them:
// good, middling, poor, and the rest (not worked yet). The words a person
// reads for them are the provider's own ("Easy", "Medium", "Hard",
// "Not rated"). Groups whose items overlap are counted together by the
// provider (`count`), never added by the reader. Turned off, a tool's provider goes with its subscriptions and
// `onDidChangeProgressProviders` fires, so a reader drops its bars at once.
//
// Module-global registry (providers survive activation order). Built-ins
// import it; extensions reach the same live object through the core command
// `progress.getRegistry` (src/commands/progressCommands.ts), which returns
// `{ register, list, onDidChange }`.

import { createRegistry } from '../platform/registry.js';
import type { Event } from '../platform/events.js';
import type { IDisposable } from '../platform/lifecycle.js';

/** The four states every provider counts in, best first; `rest` is what has not been worked. */
export type ProgressState = 'good' | 'middling' | 'poor' | 'rest';
export const PROGRESS_STATES: readonly ProgressState[] = ['good', 'middling', 'poor', 'rest'];

/** The provider's own word for each state, as a person reads it. */
export type ProgressWords = Readonly<Record<ProgressState, string>>;

/**
 * One group of a provider's items (a paper, a tag, a deck) with its counts.
 * The rest is `total` minus the three. `group` is the provider's own key for
 * `open`; `label` is the name a person reads.
 */
export interface IProgressGroup {
  readonly group: string;
  readonly label: string;
  readonly total: number;
  readonly good: number;
  readonly middling: number;
  readonly poor: number;
}

/** Counts with no group to belong to: a set of groups taken together. */
export type IProgressCounts = Pick<IProgressGroup, 'total' | 'good' | 'middling' | 'poor'>;

export interface IProgressProvider {
  /** Stable, unique across tools: `<tool>.<store>`. */
  readonly id: string;
  /** The kind of item it counts, plural, as a heading: "Problems", "Cards". */
  readonly displayName: string;
  /** The tool that registered it. */
  readonly toolId: string;
  readonly words: ProgressWords;
  /** Every group with its counts as they are now. */
  groups(): Promise<IProgressGroup[]> | IProgressGroup[];
  /** Fires when any count may have changed. */
  onDidChange(listener: () => void): IDisposable;
  /**
   * These groups taken together, each item counted once. A provider whose
   * groups can share items (a card in its deck and in each of its tags) gives
   * it, because their counts cannot be added; a reader that shows several
   * groups as one asks here. Without it the groups share nothing and a reader
   * adds them.
   */
  count?(groups: readonly string[]): Promise<IProgressCounts> | IProgressCounts;
  /** Show the items of these groups in that state where they live, all of them together. Resolves false when it could not. */
  open?(groups: readonly string[], state: ProgressState): Promise<boolean>;
}

/** The live object `progress.getRegistry` returns to extensions. */
export interface IProgressProviderRegistry {
  register(provider: IProgressProvider): IDisposable;
  list(): readonly IProgressProvider[];
  onDidChange: Event<void>;
}

const registry = createRegistry<IProgressProvider>();

/** Fires when a provider is registered, replaced or disposed. */
export const onDidChangeProgressProviders: Event<void> = registry.onDidChange;

export function listProgressProviders(): readonly IProgressProvider[] {
  return registry.list();
}

/**
 * Register a provider. The same id again replaces the earlier provider
 * (with a warning); disposing the earlier one afterwards leaves the
 * replacement in place.
 */
export function registerProgressProvider(provider: IProgressProvider): IDisposable {
  if (!provider || typeof provider.id !== 'string' || !provider.id.trim()) {
    throw new Error('[progressProviders] A provider needs an id.');
  }
  if (typeof provider.groups !== 'function') {
    throw new Error(`[progressProviders] Provider "${provider.id}" needs a groups() function.`);
  }
  if (typeof provider.onDidChange !== 'function') {
    throw new Error(`[progressProviders] Provider "${provider.id}" needs an onDidChange event.`);
  }
  if (registry.get(provider.id)) {
    console.warn(`[progressProviders] Provider "${provider.id}" registered twice; the later one replaces the earlier.`);
  }
  return registry.register(provider.id, provider);
}

/**
 * A group's counts made safe to draw: whole numbers, none below zero, and the
 * three never more than the total (a provider that miscounts cannot make a
 * bar longer than its items). Returns [good, middling, poor, rest].
 */
export function progressCounts(group: IProgressCounts): [number, number, number, number] {
  const whole = (v: unknown): number => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n > 0 ? n : 0; };
  const total = whole(group.total);
  const good = Math.min(whole(group.good), total);
  const middling = Math.min(whole(group.middling), total - good);
  const poor = Math.min(whole(group.poor), total - good - middling);
  return [good, middling, poor, total - good - middling - poor];
}

/** One live object, so a consumer holding it sees every later registration. */
export const progressProviderRegistry: IProgressProviderRegistry = Object.freeze({
  register: registerProgressProvider,
  list: listProgressProviders,
  onDidChange: onDidChangeProgressProviders,
});
