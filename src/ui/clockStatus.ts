// clockStatus.ts — where a clock that counts time worked says it has stopped
//
// A clock that stops for idleness says so where it is shown, and says when it
// goes on again: to the eye in words, and to a screen reader politely (the
// element is a status region; what is drawn is what is spoken). The words are
// the same wherever a clock runs, and the stop's words give the rule: time
// away is not counted. Empty, the element takes no room.

import type { IDisposable } from '../platform/lifecycle.js';
import { createBlock } from './block.js';
import './clockStatus.css';

/** As much of a clock as its status needs (services/workClock.ts gives one). */
export interface IClockLike {
  readonly idle: boolean;
  readonly idleMinutes: number;
  onDidChangeIdle(listener: (idle: boolean) => void): IDisposable;
}

/** How long "Counting again" stays before the line is empty again. */
const RETURN_SHOWN_MS = 4000;

export const clockStoppedWords = (minutes: number): string => `Paused: no input for ${minutes} minutes. That time is not counted.`;
export const CLOCK_RETURN_WORDS = 'Counting again';

/** The status line of `clock` in `container` (`bar`: a line of its own across a pane). Disposing takes it out. */
export function createClockStatus(container: HTMLElement | null, clock: IClockLike, options: { readonly bar?: boolean } = {}): { readonly element: HTMLElement } & IDisposable {
  const element = createBlock(container, options.bar ? 'div' : 'span', { className: options.bar ? 'px-clock-status px-clock-status--bar' : 'px-clock-status', attrs: { role: 'status' } });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const sub = clock.onDidChangeIdle((idle) => {
    clearTimeout(timer);
    element.classList.toggle('px-clock-status--stopped', idle);
    element.textContent = idle ? clockStoppedWords(clock.idleMinutes) : CLOCK_RETURN_WORDS;
    if (!idle) timer = setTimeout(() => { element.textContent = ''; }, RETURN_SHOWN_MS);
  });
  return {
    element,
    dispose: () => { clearTimeout(timer); sub.dispose(); element.remove(); },
  };
}
