// eventCalendarPicker.test.ts — which calendar a new event lands on, and
// whether the picker admits that some calendars go nowhere.
//
// An event only reaches Google if its calendar is a Google MIRROR row
// (source_provider = 'google'); listEventsToPush JOINs on exactly that. Put an
// event on a local calendar and it stays on this machine forever — no error, no
// upstream copy, invisible in every other workspace on the same account. The
// dialog used to hard-prefer 'cal-personal' for new events (overriding both the
// user's "New events go to" setting and any synced calendar) and rendered bare
// names, so nothing on screen distinguished a dead end from a live one.

import { describe, it, expect } from 'vitest';
import { eventCalendarItems } from '../../../src/built-in/planner/plannerEditorProvider.js';
import type { PlannerCalendar } from '../../../src/built-in/planner/plannerTypes.js';

function cal(p: Partial<PlannerCalendar> & { id: string; name: string }): PlannerCalendar {
  return {
    color: '#4c8bf5', visible: true, isDefault: false, sortOrder: 0,
    sourceProvider: null, sourceId: null, createdAt: 0, updatedAt: 0, ...p,
  };
}

describe('eventCalendarItems', () => {
  it('flags local-only calendars once anything syncs', () => {
    const items = eventCalendarItems([
      cal({ id: 'cal-personal', name: 'Personal' }),
      cal({ id: 'cal-nutty', name: 'Nutty Plan', sourceProvider: 'google', sourceId: 'g1' }),
    ]);
    expect(items).toEqual([
      { value: 'cal-personal', label: 'Personal · Not Synced' },
      { value: 'cal-nutty', label: 'Nutty Plan' },
    ]);
  });

  it('stays quiet when nothing syncs — the hint would be noise on every row', () => {
    const items = eventCalendarItems([
      cal({ id: 'cal-personal', name: 'Personal' }),
      cal({ id: 'cal-work', name: 'Work' }),
    ]);
    expect(items.map((i) => i.label)).toEqual(['Personal', 'Work']);
  });

  it('preserves order and ids', () => {
    const items = eventCalendarItems([
      cal({ id: 'a', name: 'A', sourceProvider: 'google', sourceId: 'ga' }),
      cal({ id: 'b', name: 'B' }),
      cal({ id: 'c', name: 'C', sourceProvider: 'google', sourceId: 'gc' }),
    ]);
    expect(items.map((i) => i.value)).toEqual(['a', 'b', 'c']);
    expect(items[1].label).toBe('B · Not Synced');
  });
});
