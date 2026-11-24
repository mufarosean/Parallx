// The work-provider point: a tool registers a provider of work by day and
// group, a reader lists them, and what a provider says is made safe to keep.
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { registerWorkProvider, listWorkProviders, onDidChangeWorkProviders, cleanWorkEntries, type IWorkProvider } from '../../src/services/workProviders.js';
import { createWorkApi } from '../../src/api/bridges/workBridge.js';
import { createClockStatus, clockStoppedWords, CLOCK_RETURN_WORDS } from '../../src/ui/clockStatus.js';
import { Emitter } from '../../src/platform/events.js';

const provider = (id: string, over: Partial<IWorkProvider> = {}): IWorkProvider => ({ id, displayName: 'Drills', kind: 'Drills', toolId: 't', work: () => [], onDidChange: () => ({ dispose() {} }), ...over });

describe('work providers', () => {
  it('lists what is registered, says when it changes, and a disposed provider is gone', () => {
    const changes = vi.fn();
    const sub = onDidChangeWorkProviders(changes);
    const a = registerWorkProvider(provider('a.one'));
    expect(listWorkProviders().map((p) => p.id)).toContain('a.one');
    expect(changes).toHaveBeenCalledTimes(1);
    a.dispose();
    expect(listWorkProviders().map((p) => p.id)).not.toContain('a.one');
    expect(changes).toHaveBeenCalledTimes(2);
    sub.dispose();
  });
  it('refuses a provider with no id, no work() or no change event', () => {
    expect(() => registerWorkProvider(provider(''))).toThrow(/id/);
    expect(() => registerWorkProvider({ ...provider('x'), work: undefined as never })).toThrow(/work\(\)/);
    expect(() => registerWorkProvider({ ...provider('x'), onDidChange: undefined as never })).toThrow(/onDidChange/);
  });
  it('the same id again replaces the earlier provider, and disposing the earlier leaves the later', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const first = registerWorkProvider(provider('a.two', { kind: 'First' }));
    const second = registerWorkProvider(provider('a.two', { kind: 'Second' }));
    first.dispose();
    expect(listWorkProviders().find((p) => p.id === 'a.two')?.kind).toBe('Second');
    second.dispose();
    warn.mockRestore();
  });
  it('keeps only entries that are a day with numbers: none below zero, right never above items', () => {
    expect(cleanWorkEntries([
      { day: '2026-03-10', groups: [{ group: 'tag:mack', label: 'Mack' }, { group: 'deck:1' }, null], minutes: 12.5, items: 3, right: 5 },
      { day: '2026-03-11', groups: 'x', minutes: -4, items: 'two' },
      { day: 'yesterday', minutes: 5, items: 1 },
      null, 'x',
    ])).toEqual([
      { day: '2026-03-10', groups: [{ group: 'tag:mack', label: 'Mack' }, { group: 'deck:1', label: 'deck:1' }], minutes: 12.5, items: 3, right: 3 },
      { day: '2026-03-11', groups: [], minutes: 0, items: 0 },
    ]);
    expect(cleanWorkEntries(undefined)).toEqual([]);
  });
});

describe('api.work', () => {
  it('registers under the calling tool, cleans what the provider reports, and everything goes with the tool', async () => {
    const subscriptions: { dispose(): void }[] = [];
    const api = createWorkApi('tool.a', subscriptions);
    api.registerProvider({ id: 'tool.a.drills', displayName: 'Drills', kind: 'Drills', work: () => [{ day: '2026-03-10', groups: [], minutes: 3, items: 1, right: 9 }] as never, onDidChange: () => ({ dispose() {} }) });
    const p = api.providers().find((x) => x.id === 'tool.a.drills')!;
    expect(p.toolId).toBe('tool.a');
    expect(await p.work()).toEqual([{ day: '2026-03-10', groups: [], minutes: 3, items: 1, right: 1 }]);
    const clock = api.createClock({ showing: () => true });
    expect(api.idleMinutes).toBe(10);
    for (const d of subscriptions) d.dispose();
    expect(api.providers().find((x) => x.id === 'tool.a.drills')).toBeUndefined();
    clock.dispose();
  });
});

describe('the clock status', () => {
  it('is a polite status that says the stop with the rule, then the return, then nothing', () => {
    vi.useFakeTimers();
    const idle = new Emitter<boolean>();
    const host = document.createElement('div');
    const status = createClockStatus(host, { idle: false, idleMinutes: 15, onDidChangeIdle: idle.event });
    const el = host.querySelector('.px-clock-status')!;
    expect(el.getAttribute('role')).toBe('status');
    expect(el.textContent).toBe('');
    idle.fire(true);
    expect(el.textContent).toBe(clockStoppedWords(15));
    expect(el.textContent).toMatch(/Paused.*15 minutes.*not counted/);
    idle.fire(false);
    expect(el.textContent).toBe(CLOCK_RETURN_WORDS);
    vi.advanceTimersByTime(5000);
    expect(el.textContent).toBe('');
    status.dispose();
    expect(host.children.length).toBe(0);
    vi.useRealTimers();
  });
});
