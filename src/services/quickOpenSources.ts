// quickOpenSources.ts — things Quick Open (Ctrl+P) can open besides files
//
// Quick Open lists the workspace's files and recent workspaces. A tool that
// keeps things of its own (Canvas pages) registers a source here while it
// runs, and Quick Open lists them beside the files, ranked by the same
// fuzzy match. Turned off, the source goes and its items with it.

import { Emitter, type Event } from '../platform/events.js';
import { toDisposable, type IDisposable } from '../platform/lifecycle.js';

export interface QuickOpenSourceItem {
  /** Unique within the source. */
  readonly id: string;
  /** What the user calls it (a page's title). */
  readonly label: string;
  /** Where it lives ("Course Notes / Chain Ladder"), matched as well. */
  readonly detail?: string;
  /** Open it. */
  readonly open: () => void;
}

export interface QuickOpenSource {
  /** Stable id (the registering tool's). */
  readonly id: string;
  /** Section label in the list ("pages"). */
  readonly group: string;
  /** Every item, most relevant first; Quick Open filters and ranks them. */
  listItems(): Promise<readonly QuickOpenSourceItem[]>;
}

const _sources = new Map<string, QuickOpenSource>();
const _onDidChange = new Emitter<void>();
export const onDidChangeQuickOpenSources: Event<void> = _onDidChange.event;

export function registerQuickOpenSource(source: QuickOpenSource): IDisposable {
  _sources.set(source.id, source);
  _onDidChange.fire();
  return toDisposable(() => {
    if (_sources.get(source.id) === source) { _sources.delete(source.id); _onDidChange.fire(); }
  });
}

export function getQuickOpenSources(): readonly QuickOpenSource[] {
  return [..._sources.values()];
}
