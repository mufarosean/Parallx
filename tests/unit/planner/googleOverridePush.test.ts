// googleOverridePush.test.ts — pushing a per-occurrence exception to Google.
//
// Google addresses an instance by id. The id is usually derivable as
// `{masterId}_{originalStartUTC}`, and the old code treated "usually" as
// "always": a miss came back as a bare 404 ("Not Found"), the edit was left
// dirty, and every sync from then on retried the same id that would never
// exist. These pin the recovery path — try what we recorded, try the derived
// id, then ASK Google which instance occupies the slot.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GoogleCalendarSyncProvider } from '../../../src/built-in/planner/sync/googleCalendarSyncProvider.js';
import type { PlannerDataService } from '../../../src/built-in/planner/plannerDataService.js';
import type { EventOverride, PlannerEvent } from '../../../src/built-in/planner/plannerTypes.js';

interface Call { method: string; url: string; body?: unknown }

/** Responses keyed by a substring of the request url + method. */
type Route = (call: Call) => { ok: boolean; status?: number; data?: unknown; error?: string } | undefined;

let calls: Call[] = [];
let routes: Route[] = [];

function installBridge(): void {
  (globalThis as unknown as { window: unknown }).window = {
    parallxElectron: {
      google: {
        async fetch(opts: Call) {
          calls.push(opts);
          for (const r of routes) {
            const hit = r(opts);
            if (hit) return hit;
          }
          return { ok: false, status: 404, error: 'Not Found' };
        },
      },
    },
  };
}

const BASE: PlannerEvent = {
  id: 'e1', title: 'Work', description: null,
  startAt: Date.parse('2026-08-17T15:30:00Z'), endAt: Date.parse('2026-08-17T17:00:00Z'),
  allDay: false, location: null, calendarId: 'cal-local', color: null,
  recurrence: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH',
  sourceProvider: 'google', sourceId: 'master1', createdAt: 0, updatedAt: 0,
};

function fakeData(): PlannerDataService {
  return {
    async getEventBySource() { return BASE; },
    async getCalendar() {
      return { id: 'cal-local', name: 'Nutty Plan', sourceProvider: 'google', sourceId: 'gcal1' };
    },
  } as unknown as PlannerDataService;
}

const SLOT = Date.parse('2026-08-21T15:30:00Z');

function override(p: Partial<EventOverride> = {}): EventOverride {
  return {
    id: 'ovr-1', baseId: 'e1', originalStartAt: SLOT, cancelled: false,
    title: 'Work/Flashcards', description: null,
    startAt: Date.parse('2026-08-21T17:00:00Z'), endAt: Date.parse('2026-08-21T19:00:00Z'),
    allDay: false, location: null, color: null, sourceId: null, ...p,
  };
}

beforeEach(() => { calls = []; routes = []; installBridge(); });
afterEach(() => { delete (globalThis as unknown as { window?: unknown }).window; });

describe('pushOverride — instance addressing', () => {
  it('PATCHes the derived instance id when it exists', async () => {
    routes = [(c) => (c.method === 'PATCH' && c.url.includes('master1_20260821T153000Z')
      ? { ok: true, data: { id: 'master1_20260821T153000Z', updated: '2026-08-21T20:00:00Z' } }
      : undefined)];

    const res = await new GoogleCalendarSyncProvider(fakeData()).pushOverride('master1', override());
    expect(res.providerId).toBe('master1_20260821T153000Z');
    expect(res.remoteUpdatedAt).toBe(Date.parse('2026-08-21T20:00:00Z'));
    expect(calls).toHaveLength(1); // no lookup needed
  });

  it('prefers the id Google already gave us over the derived guess', async () => {
    routes = [(c) => (c.method === 'PATCH' && c.url.includes('real_instance_id')
      ? { ok: true, data: { id: 'real_instance_id' } } : undefined)];

    const res = await new GoogleCalendarSyncProvider(fakeData())
      .pushOverride('master1', override({ sourceId: 'real_instance_id' }));
    expect(res.providerId).toBe('real_instance_id');
    expect(calls[0].url).toContain('real_instance_id');
  });

  // The reported failure: "Google Calendar override push failed: Not Found".
  it('resolves the real instance id from Google when the derived one 404s', async () => {
    routes = [
      (c) => (c.method === 'GET' && c.url.includes('/instances')
        ? {
          ok: true,
          data: {
            items: [
              { id: 'master1_20260820T153000Z', originalStartTime: { dateTime: '2026-08-20T15:30:00Z' } },
              { id: 'master1_20260821T153000Z_R', originalStartTime: { dateTime: '2026-08-21T15:30:00Z' } },
            ],
          },
        }
        : undefined),
      (c) => (c.method === 'PATCH' && c.url.includes('master1_20260821T153000Z_R')
        ? { ok: true, data: { id: 'master1_20260821T153000Z_R' } } : undefined),
    ];

    const res = await new GoogleCalendarSyncProvider(fakeData()).pushOverride('master1', override());
    expect(res.providerId).toBe('master1_20260821T153000Z_R');
    // derived PATCH (404) → instances GET → PATCH the real id
    expect(calls.map((c) => c.method)).toEqual(['PATCH', 'GET', 'PATCH']);
    const lookup = calls[1].url;
    expect(lookup).toContain('/events/master1/instances');
    expect(lookup).toContain('timeMin=');
    expect(lookup).toContain('timeMax=');
  });

  // Our expander and Google's can disagree about the instant (a DST boundary,
  // a series whose zone changed) while plainly meaning the same occurrence.
  it('falls back to the occurrence on the same local day when no instant matches', async () => {
    const offByAnHour = new Date(SLOT + 3_600_000).toISOString();
    routes = [
      (c) => (c.method === 'GET' && c.url.includes('/instances')
        ? { ok: true, data: { items: [{ id: 'shifted', originalStartTime: { dateTime: offByAnHour } }] } }
        : undefined),
      (c) => (c.method === 'PATCH' && c.url.includes('shifted')
        ? { ok: true, data: { id: 'shifted' } } : undefined),
    ];

    const res = await new GoogleCalendarSyncProvider(fakeData()).pushOverride('master1', override());
    expect(res.providerId).toBe('shifted');
  });

  it('does not rewrite an occurrence on a different day', async () => {
    const nextWeek = new Date(SLOT + 7 * 86_400_000).toISOString();
    routes = [(c) => (c.method === 'GET' && c.url.includes('/instances')
      ? { ok: true, data: { items: [{ id: 'wrong-week', originalStartTime: { dateTime: nextWeek } }] } }
      : undefined)];

    await expect(new GoogleCalendarSyncProvider(fakeData()).pushOverride('master1', override()))
      .rejects.toThrow(/no occurrence of the series/);
    expect(calls.some((c) => c.method === 'PATCH' && c.url.includes('wrong-week'))).toBe(false);
  });

  it('surfaces a non-404 failure instead of hunting for another id', async () => {
    routes = [(c) => (c.method === 'PATCH' ? { ok: false, status: 403, error: 'Forbidden' } : undefined)];

    await expect(new GoogleCalendarSyncProvider(fakeData()).pushOverride('master1', override()))
      .rejects.toThrow(/Forbidden/);
    expect(calls.every((c) => c.method === 'PATCH')).toBe(true); // no instances lookup
  });

  it('sends an explicit timeZone on the instance body', async () => {
    routes = [(c) => (c.method === 'PATCH' ? { ok: true, data: { id: 'x' } } : undefined)];
    await new GoogleCalendarSyncProvider(fakeData()).pushOverride('master1', override());
    const body = calls[0].body as { start: { timeZone?: string }; end: { timeZone?: string } };
    expect(body.start.timeZone).toBeTruthy();
    expect(body.end.timeZone).toBe(body.start.timeZone);
  });

  it('cancels an occurrence with status=cancelled and no times', async () => {
    routes = [(c) => (c.method === 'PATCH' ? { ok: true, data: { id: 'x' } } : undefined)];
    await new GoogleCalendarSyncProvider(fakeData()).pushOverride('master1', override({ cancelled: true }));
    expect(calls[0].body).toEqual({ status: 'cancelled' });
  });
});
