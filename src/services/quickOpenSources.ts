// quickOpenSources.ts — things Quick Open (Ctrl+P) can open besides files
//
// Quick Open lists the workspace's files and recent workspaces. A tool that
// keeps things of its own (Canvas pages, settings, tools, themes) registers
// a source here while it runs, and Quick Open lists them beside the files,
// ranked by the same fuzzy match (commands/quickOpenRanking.ts). Turned off,
// the source goes and its items with it.

import { createRegistry } from '../platform/registry.js';
import type { IDisposable } from '../platform/lifecycle.js';

export interface QuickOpenSourceItem {
  /** Unique within the source. */
  readonly id: string;
  /** What the user calls it (a page's title). */
  readonly label: string;
  /** Where it lives ("Course Notes / Chain Ladder"), matched as well. */
  readonly detail?: string;
  /** Words that find it but are not shown (a setting's key and description). */
  readonly keywords?: string;
  /** Open it. */
  readonly open: () => void;
}

export interface QuickOpenSource {
  /** Stable id (the registering tool's). */
  readonly id: string;
  /** Section label in the list ("pages"). */
  readonly group: string;
  /** One item's kind, singular ("Page"), shown on its row when kinds mix. */
  readonly kind?: string;
  /** List nothing until the user types: for long lists like every setting. */
  readonly onlyWhenQueried?: boolean;
  /** Every item, most relevant first; Quick Open filters and ranks them. */
  listItems(): Promise<readonly QuickOpenSourceItem[]>;
}

const registry = createRegistry<QuickOpenSource>();

export function registerQuickOpenSource(source: QuickOpenSource): IDisposable {
  return registry.register(source.id, source);
}

export function getQuickOpenSources(): readonly QuickOpenSource[] {
  return registry.list();
}
