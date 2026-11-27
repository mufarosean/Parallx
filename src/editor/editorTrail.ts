// editorTrail.ts — what an editor tab says about where it is, for the bar
// under the tabs and the tab's own menu.
//
// A file's tab gets its trail from its path (breadcrumbsBar.ts). Any other
// tab may carry one of its own: a list of crumbs, the first the tool, the
// last where the tab is now, each one able to go there. The core's places
// (services/places.ts) fill it for a tool's one tab; the bar draws it and
// knows no tool. A tab that can be pulled out into a tab of its own says so
// with `openInOwnTab` (Open in Its Own Tab on the tab's menu).

import type { Event } from '../platform/events.js';

export interface IEditorTrailCrumb {
  /** What the crumb says: 'Planner', 'Calendar'. */
  readonly label: string;
  /** Registry icon id drawn before the label (the tool's icon on the first crumb). */
  readonly icon?: string;
  /** The crumb of where the tab is now (the last one). */
  readonly current?: boolean;
  /** The place's address (`parallx://place/...`), for whoever reads the trail. */
  readonly address?: string;
  /** Go there: in this tab, or with `newTab` in a tab of its own. */
  open?(options: { readonly newTab: boolean }): void;
}

/** An editor input that carries its own trail. */
export interface IEditorTrailSource {
  readonly trail: readonly IEditorTrailCrumb[] | undefined;
  readonly onDidChangeTrail: Event<void>;
  /** Open what this tab shows in a tab of its own (the tab's menu offers it when set). */
  readonly openInOwnTab?: (() => void) | undefined;
}

/** The input's own trail source, when it has one. */
export function trailSourceOf(input: unknown): IEditorTrailSource | undefined {
  const candidate = input as Partial<IEditorTrailSource> | null | undefined;
  return candidate && typeof candidate === 'object' && typeof candidate.onDidChangeTrail === 'function'
    ? candidate as IEditorTrailSource
    : undefined;
}
