// chatThinkingView.ts — how a reply's Thinking section shows (the
// chat.thinkingView setting, AI settings). Set from the unified AI config at
// boot and whenever it changes (workbenchServices.ts); read by chatService
// when a thinking burst starts and when it is settled.
//
//   'auto'   open while the model thinks, closed once the reply moves on
//   'open'   always open
//   'closed' closed until the user opens it
//
// Only 'auto' closes a burst on its own; 'open' and 'closed' leave it as it
// is, so a click made while the reply streams is kept.

export type ChatThinkingViewMode = 'auto' | 'open' | 'closed';

let _view: ChatThinkingViewMode = 'auto';

export function setChatThinkingView(view: string | undefined): void {
  _view = view === 'open' || view === 'closed' ? view : 'auto';
}

/** Whether a new thinking burst starts collapsed. */
export function thinkingStartsCollapsed(): boolean {
  return _view === 'closed';
}

/** A burst's collapsed state once it is settled, from its state now. */
export function thinkingSettled(collapsed: boolean): boolean {
  return _view === 'auto' ? true : collapsed;
}
