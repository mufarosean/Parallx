// pageEditSignals.ts — the heartbeat notices work on pages, not only files.
//
// The heartbeat's interval review runs only when something happened, and
// what counted was file changes (source and text files), index completion,
// workspace changes and tools' signals. Canvas signalled a page's creation
// and nothing more, so a day spent writing pages never woke a review. Each
// page the user edits now sends one "edited page" signal, at most once per
// page every ten minutes (a typing session is one signal, not one per save).
// onDidSavePage fires only from the editor's save path, so these are the
// user's own edits. They are ongoing work, not a gesture: habit detection
// does not learn them (habit: false).

import type { IDisposable } from '../../platform/lifecycle.js';
import type { PageSaveEvent } from './canvasTypes.js';

/** One signal per page per this long. */
export const PAGE_EDIT_SIGNAL_GAP_MS = 10 * 60_000;

/** The signal for an edit, or null while the page signalled within the gap. */
export function pageEditSignal(last: Map<string, number>, pageId: string, title: string | undefined, now: number): Record<string, unknown> | null {
  const prev = last.get(pageId);
  if (prev !== undefined && now - prev < PAGE_EDIT_SIGNAL_GAP_MS) return null;
  last.set(pageId, now);
  if (last.size > 500) last.delete(last.keys().next().value as string); // the oldest goes; it would signal again
  return { source: 'canvas', kind: 'page-edited', title: `edited page "${title?.trim() || 'Untitled'}"`, severity: 'info', actor: 'user', habit: false };
}

export function registerPageEditSignals(
  onDidSavePage: (listener: (e: PageSaveEvent) => void) => IDisposable,
  signal: (payload: Record<string, unknown>) => void,
  now: () => number = Date.now,
): IDisposable {
  const last = new Map<string, number>();
  return onDidSavePage(({ pageId, page }) => {
    const payload = pageEditSignal(last, pageId, page?.title, now());
    if (payload) signal(payload);
  });
}
