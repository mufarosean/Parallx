// pageRecents.ts — the recent list (recentsService.ts) follows the pages.
//
// The list records a page with the title it had when it was opened, so a
// page opened as "Untitled" and named afterwards stayed "Untitled" on Start
// and the dashboard's Recent widget, and a page moved to Trash or deleted
// stayed listed, one click from opening a page that is gone. A rename now
// renames its entry and a page leaving (Trash or delete, each sub-page with
// it) leaves the list.

import type { IDisposable } from '../../platform/lifecycle.js';
import type { Event } from '../../platform/events.js';
import { PageChangeKind, type PageChangeEvent } from './canvasTypes.js';

/** What this needs of the recent list. */
export interface PageRecentsSink {
  retitle(key: string, title: string): void;
  forget(key: string): void;
}

export function registerPageRecents(onDidChangePage: Event<PageChangeEvent>, recents: PageRecentsSink | undefined): IDisposable {
  if (!recents) return { dispose: () => undefined };
  return onDidChangePage((e) => {
    const key = `page:${e.pageId}`;
    if (e.kind === PageChangeKind.Deleted || (e.kind === PageChangeKind.Updated && e.page?.isArchived)) {
      recents.forget(key);
    } else if (e.kind === PageChangeKind.Updated && e.page && (!e.changedFields || e.changedFields.includes('title'))) {
      recents.retitle(key, e.page.title || 'Untitled');
    }
  });
}
