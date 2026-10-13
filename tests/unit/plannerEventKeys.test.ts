// @vitest-environment jsdom
// plannerEventKeys.test.ts — a calendar event's bar from the keyboard: Enter
// edits it (a click only ever opened the editor from the pointer), Alt+arrows
// move it, Alt+Shift+arrows move only its end, saved as a drop is.
// docs/ACCESSIBILITY.md, section 6.

import { describe, it, expect, vi } from 'vitest';
import { PlannerEventBars } from '../../src/built-in/planner/plannerEventBars';

const HOUR = 3_600_000;

describe('event bars from the keyboard', () => {
  it('Enter edits; Alt+arrows move; Alt+Shift+arrows move the end; extra fields ride along', () => {
    const openEventPopover = vi.fn();
    const bars = new PlannerEventBars({ eventPopover: { openEventPopover } } as never);
    const commit = vi.spyOn(bars, 'commitEventMove').mockResolvedValue(undefined);
    const ev = { id: 'e1', startAt: 10 * HOUR, endAt: 11 * HOUR } as never;
    const bar = document.createElement('button');
    document.body.appendChild(bar);
    bars.installEventKeys(bar, ev, { ArrowDown: HOUR / 4, ArrowRight: 24 * HOUR }, true, { allDay: true } as never);
    const key = (k: string, init: KeyboardEventInit = {}) => bar.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));

    key('Enter');
    expect(openEventPopover).toHaveBeenCalledWith({ mode: 'edit', event: ev }, expect.anything());
    key('ArrowDown', { altKey: true });
    expect(commit).toHaveBeenLastCalledWith(ev, { allDay: true, startAt: 10.25 * HOUR, endAt: 11.25 * HOUR }, expect.anything());
    key('ArrowDown', { altKey: true, shiftKey: true });
    expect(commit).toHaveBeenLastCalledWith(ev, { allDay: true, startAt: 10 * HOUR, endAt: 11.25 * HOUR }, expect.anything());
    key('ArrowDown'); // no Alt: the arrows stay the calendar's
    expect(commit).toHaveBeenCalledTimes(2);
    expect(bar.dataset.eventId).toBe('e1');
  });
});
