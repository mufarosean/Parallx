/**
 * Planner chat tools — the AI-facing captureEvent / captureTask / read tools,
 * focused on the calendar-targeting that makes agent-created items reach Google:
 * explicit calendarId, calendarName resolution, the "calendars" reader, the
 * default (delegated to the data service), and the post-write sync nudge.
 */

import { describe, it, expect, vi } from 'vitest';
import { registerPlannerChatTools } from '../../src/built-in/planner/plannerChatTools';

interface ToolDef {
  description: string;
  parameters: object;
  requiresConfirmation: boolean;
  handler: (args: unknown) => Promise<{ content: string; isError?: boolean }>;
}

function setup(overrides?: { defaultId?: string; isRunning?: boolean }) {
  const calendars = [
    { id: 'cal-personal', name: 'Personal', color: null, sourceProvider: null, sourceId: null },
    { id: 'cal-g1', name: 'Work', color: '#123456', sourceProvider: 'google', sourceId: 'work@group.calendar.google.com' },
  ];
  const data = {
    listCalendars: vi.fn(async () => calendars),
    getCalendar: vi.fn(async (id: string) => calendars.find((c) => c.id === id) ?? null),
    resolveDefaultEventCalendarId: vi.fn(async () => overrides?.defaultId ?? 'cal-g1'),
    createEvent: vi.fn(async (input: Record<string, unknown>) => ({ id: 'ev1', ...input })),
    updateEvent: vi.fn(async (id: string, patch: Record<string, unknown>) => ({ id, ...patch })),
    createTask: vi.fn(async (input: Record<string, unknown>) => ({ id: 'tk1', ...input })),
    updateTask: vi.fn(async (id: string, patch: Record<string, unknown>) => ({ id, ...patch })),
    listTasks: vi.fn(async () => []),
    listEvents: vi.fn(async () => []),
    findFreeSlot: vi.fn(async () => null),
  };
  const sync = {
    onDidChange: () => ({ dispose() {} }),
    isRunning: overrides?.isRunning ?? false,
    lastResults: [],
    syncNow: vi.fn(async () => []),
    getLastSyncMs: vi.fn(async () => null),
    refreshProviders: vi.fn(async () => {}),
  };
  const tools = new Map<string, ToolDef>();
  const chat = {
    registerTool: (id: string, def: ToolDef) => { tools.set(id, def); return { dispose() {} }; },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registerPlannerChatTools(chat as any, data as any, sync as any);
  return { data, sync, tools };
}

const call = (tools: Map<string, ToolDef>, id: string, args: unknown) => tools.get(id)!.handler(args);
const json = (r: { content: string }) => JSON.parse(r.content);

describe('planner chat tools — calendar targeting', () => {
  it('captureEvent honours an explicit calendarId and nudges a sync', async () => {
    const { data, sync, tools } = setup();
    const res = await call(tools, 'planner.captureEvent', { title: 'Standup', startAt: '2026-07-02T15:00:00Z', calendarId: 'cal-g1' });
    expect(res.isError).toBeFalsy();
    expect(data.createEvent).toHaveBeenCalledWith(expect.objectContaining({ title: 'Standup', calendarId: 'cal-g1' }));
    expect(sync.syncNow).toHaveBeenCalledTimes(1);
  });

  it('captureEvent resolves a calendar by name (case-insensitive)', async () => {
    const { data, tools } = setup();
    await call(tools, 'planner.captureEvent', { title: 'X', startAt: '+1d', calendarName: 'work' });
    expect(data.createEvent).toHaveBeenCalledWith(expect.objectContaining({ calendarId: 'cal-g1' }));
  });

  it('captureEvent errors (and does not write) on an unknown calendar name', async () => {
    const { data, sync, tools } = setup();
    const res = await call(tools, 'planner.captureEvent', { title: 'X', startAt: '+1d', calendarName: 'Nope' });
    expect(res.isError).toBe(true);
    expect(res.content).toContain('planner.read');
    expect(data.createEvent).not.toHaveBeenCalled();
    expect(sync.syncNow).not.toHaveBeenCalled();
  });

  it('captureEvent with no calendar delegates the default to the data service (calendarId undefined)', async () => {
    const { data, tools } = setup();
    await call(tools, 'planner.captureEvent', { title: 'X', startAt: '+1d' });
    expect(data.createEvent).toHaveBeenCalledWith(expect.objectContaining({ calendarId: undefined }));
  });

  it('captureTask honours calendarId and nudges a sync', async () => {
    const { data, sync, tools } = setup();
    const res = await call(tools, 'planner.captureTask', { title: 'Do it', calendarId: 'cal-g1' });
    expect(res.isError).toBeFalsy();
    expect(data.createTask).toHaveBeenCalledWith(expect.objectContaining({ title: 'Do it', calendarId: 'cal-g1' }));
    expect(sync.syncNow).toHaveBeenCalledTimes(1);
  });

  it('does not nudge a sync while one is already running', async () => {
    const { sync, tools } = setup({ isRunning: true });
    await call(tools, 'planner.captureEvent', { title: 'X', startAt: '+1d', calendarId: 'cal-g1' });
    expect(sync.syncNow).not.toHaveBeenCalled();
  });
});

describe('planner chat tools — read calendars', () => {
  it('lists calendars with Google-sync + default flags so the agent can choose', async () => {
    const { tools } = setup({ defaultId: 'cal-g1' });
    const res = await call(tools, 'planner.read', { what: 'calendars' });
    const { calendars } = json(res);
    expect(calendars).toHaveLength(2);
    const work = calendars.find((c: { id: string }) => c.id === 'cal-g1');
    expect(work.syncsToGoogle).toBe(true);
    expect(work.googleCalendarId).toBe('work@group.calendar.google.com');
    expect(work.isDefaultForNewEvents).toBe(true);
    const personal = calendars.find((c: { id: string }) => c.id === 'cal-personal');
    expect(personal.syncsToGoogle).toBe(false);
    expect(personal.isDefaultForNewEvents).toBe(false);
  });
});
