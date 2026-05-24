/**
 * Pin-the-invariant: AutonomyTaskRailService.
 *
 * Zero prior unit coverage. Pins:
 *  - readLiveRows: limit cap, trigger-filter inclusion, outcome filter
 *    drops all live rows (live carries no outcome), origin → trigger
 *    mapping (heartbeat/cron/subagent/agent preserved; everything else
 *    becomes 'chat').
 *  - readRows without history: returns live-only.
 *  - readRows with history: merges, dedupes by id across days, sorts
 *    triggeredAt descending, caps at limit.
 *  - sinceDays clamped to 1..90 (default 7).
 *  - Trigger & outcome filters applied to history rows independently.
 *  - onDidChange fires on both live append and history emit.
 */

import { describe, expect, it, vi } from 'vitest';
import { Emitter } from '../../src/platform/events';
import {
  AutonomyTaskRailService,
  type IRailRow,
} from '../../src/services/autonomyTaskRailService';
import type {
  IAutonomyLogEntry,
  IAutonomyLogReader,
} from '../../src/services/autonomyLogService';
import type {
  AutonomyOutcome,
  AutonomyTriggerKind,
  IAutonomyEventLog,
  IAutonomyEventRecord,
} from '../../src/services/autonomyEventLog';

// ─── Stubs ─────────────────────────────────────────────────────────────────

class StubLiveReader implements IAutonomyLogReader {
  entries: IAutonomyLogEntry[] = [];
  private readonly _e = new Emitter<IAutonomyLogEntry>();
  readonly onDidChange = this._e.event;
  fire(entry: IAutonomyLogEntry) {
    this.entries = [entry, ...this.entries];
    this._e.fire(entry);
  }
  getEntries(opts?: { limit?: number; origin?: string; onlyUnread?: boolean }): readonly IAutonomyLogEntry[] {
    return this.entries.slice(0, opts?.limit ?? 50);
  }
  getUnreadCount(): number { return this.entries.filter((e) => !e.read).length; }
  markRead(): number { return 0; }
}

class StubHistory implements IAutonomyEventLog {
  byDay = new Map<string, IAutonomyEventRecord[]>();
  private readonly _emit = new Emitter<IAutonomyEventRecord>();
  readonly onDidEmit = this._emit.event;
  emit(): IAutonomyEventRecord { throw new Error('not used'); }
  async readDay(day: string): Promise<readonly IAutonomyEventRecord[]> {
    return this.byDay.get(day) ?? [];
  }
  async findById(): Promise<IAutonomyEventRecord | undefined> { return undefined; }
  fire(rec: IAutonomyEventRecord) { this._emit.fire(rec); }
  dispose(): void { /* */ }
}

function liveEntry(over: Partial<IAutonomyLogEntry> = {}): IAutonomyLogEntry {
  return {
    id: 'live-1',
    timestamp: Date.parse('2026-05-25T12:00:00.000Z'),
    origin: 'chat',
    requestText: 'req',
    content: 'body',
    read: false,
    ...over,
  };
}

function eventRecord(over: Partial<IAutonomyEventRecord> = {}): IAutonomyEventRecord {
  return {
    id: 'ev-1',
    triggeredAt: '2026-05-25T08:00:00.000Z',
    trigger: { kind: 'cron' },
    outcome: 'completed',
    ...over,
  };
}

const NOW = Date.parse('2026-05-25T12:30:00.000Z');

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('AutonomyTaskRailService.readLiveRows', () => {
  it('maps live origins to triggers (heartbeat/cron/subagent/agent preserved; other → chat)', () => {
    const live = new StubLiveReader();
    live.entries = [
      liveEntry({ id: 'a', origin: 'heartbeat' }),
      liveEntry({ id: 'b', origin: 'cron' }),
      liveEntry({ id: 'c', origin: 'subagent' }),
      liveEntry({ id: 'd', origin: 'agent' }),
      liveEntry({ id: 'e', origin: 'file-change' }),
      liveEntry({ id: 'f', origin: 'whatever' }),
    ];
    const svc = new AutonomyTaskRailService(live, undefined, () => NOW);
    const rows = svc.readLiveRows();
    expect(rows.map((r) => (r.kind === 'live' ? r.trigger : 'event'))).toEqual([
      'heartbeat', 'cron', 'subagent', 'agent', 'chat', 'chat',
    ]);
    svc.dispose();
  });

  it('respects an explicit limit', () => {
    const live = new StubLiveReader();
    for (let i = 0; i < 10; i++) live.entries.push(liveEntry({ id: `x${i}` }));
    const svc = new AutonomyTaskRailService(live, undefined, () => NOW);
    expect(svc.readLiveRows({ limit: 3 }).length).toBe(3);
    svc.dispose();
  });

  it('trigger filter excludes non-matching live rows', () => {
    const live = new StubLiveReader();
    live.entries = [
      liveEntry({ id: 'a', origin: 'heartbeat' }),
      liveEntry({ id: 'b', origin: 'cron' }),
      liveEntry({ id: 'c', origin: 'chat' }),
    ];
    const svc = new AutonomyTaskRailService(live, undefined, () => NOW);
    const rows = svc.readLiveRows({ triggers: ['heartbeat', 'chat'] });
    expect(rows.map((r) => r.id).sort()).toEqual(['a', 'c']);
    svc.dispose();
  });

  it('any outcome filter drops all live rows (live carries no outcome)', () => {
    const live = new StubLiveReader();
    live.entries = [liveEntry({ id: 'a' }), liveEntry({ id: 'b' })];
    const svc = new AutonomyTaskRailService(live, undefined, () => NOW);
    expect(svc.readLiveRows({ outcomes: ['completed'] })).toEqual([]);
    svc.dispose();
  });
});

describe('AutonomyTaskRailService.readRows', () => {
  it('returns live-only when no history is configured', async () => {
    const live = new StubLiveReader();
    live.entries = [liveEntry({ id: 'L1' })];
    const svc = new AutonomyTaskRailService(live, undefined, () => NOW);
    const rows = await svc.readRows();
    expect(rows.length).toBe(1);
    expect(rows[0].kind).toBe('live');
    svc.dispose();
  });

  it('merges live + history, sorted by triggeredAt descending', async () => {
    const live = new StubLiveReader();
    live.entries = [
      liveEntry({ id: 'L_late', timestamp: Date.parse('2026-05-25T11:00:00.000Z') }),
      liveEntry({ id: 'L_early', timestamp: Date.parse('2026-05-25T05:00:00.000Z') }),
    ];
    const hist = new StubHistory();
    hist.byDay.set('2026-05-25', [
      eventRecord({ id: 'E_mid', triggeredAt: '2026-05-25T08:00:00.000Z' }),
      eventRecord({ id: 'E_super_early', triggeredAt: '2026-05-25T01:00:00.000Z' }),
    ]);
    const svc = new AutonomyTaskRailService(live, hist, () => NOW);
    const rows = await svc.readRows();
    expect(rows.map((r) => r.id)).toEqual(['L_late', 'E_mid', 'L_early', 'E_super_early']);
    svc.dispose();
  });

  it('caps merged result at limit', async () => {
    const live = new StubLiveReader();
    live.entries = [
      liveEntry({ id: 'L1', timestamp: Date.parse('2026-05-25T11:00:00.000Z') }),
      liveEntry({ id: 'L2', timestamp: Date.parse('2026-05-25T10:00:00.000Z') }),
    ];
    const hist = new StubHistory();
    hist.byDay.set('2026-05-25', [
      eventRecord({ id: 'E1', triggeredAt: '2026-05-25T09:00:00.000Z' }),
      eventRecord({ id: 'E2', triggeredAt: '2026-05-25T08:00:00.000Z' }),
      eventRecord({ id: 'E3', triggeredAt: '2026-05-25T07:00:00.000Z' }),
    ]);
    const svc = new AutonomyTaskRailService(live, hist, () => NOW);
    const rows = await svc.readRows({ limit: 2 });
    expect(rows.length).toBe(2);
    expect(rows.map((r) => r.id)).toEqual(['L1', 'L2']);
    svc.dispose();
  });

  it('dedupes by id across days', async () => {
    const live = new StubLiveReader();
    const hist = new StubHistory();
    const rec = eventRecord({ id: 'dup', triggeredAt: '2026-05-25T01:00:00.000Z' });
    hist.byDay.set('2026-05-25', [rec]);
    hist.byDay.set('2026-05-24', [rec]); // intentionally duplicated id across days
    const svc = new AutonomyTaskRailService(live, hist, () => NOW);
    const rows = await svc.readRows({ sinceDays: 2 });
    expect(rows.filter((r) => r.id === 'dup').length).toBe(1);
    svc.dispose();
  });

  it('clamps sinceDays to 1..90 (>90 read uses 90; <1 read uses 1)', async () => {
    const live = new StubLiveReader();
    const hist = new StubHistory();
    const spy = vi.spyOn(hist, 'readDay');
    const svc = new AutonomyTaskRailService(live, hist, () => NOW);
    await svc.readRows({ sinceDays: 9999 });
    expect(spy.mock.calls.length).toBe(90);
    spy.mockClear();
    await svc.readRows({ sinceDays: 0 });
    expect(spy.mock.calls.length).toBe(1);
    svc.dispose();
  });

  it('applies trigger filter to history rows', async () => {
    const live = new StubLiveReader();
    const hist = new StubHistory();
    hist.byDay.set('2026-05-25', [
      eventRecord({ id: 'E_cron', trigger: { kind: 'cron' } }),
      eventRecord({ id: 'E_chat', trigger: { kind: 'chat' } }),
      eventRecord({ id: 'E_hb', trigger: { kind: 'heartbeat' } }),
    ]);
    const svc = new AutonomyTaskRailService(live, hist, () => NOW);
    const rows = await svc.readRows({ triggers: ['cron'] satisfies AutonomyTriggerKind[] });
    expect(rows.map((r) => r.id)).toEqual(['E_cron']);
    svc.dispose();
  });

  it('applies outcome filter to history rows', async () => {
    const live = new StubLiveReader();
    const hist = new StubHistory();
    hist.byDay.set('2026-05-25', [
      eventRecord({ id: 'E_ok', outcome: 'completed' }),
      eventRecord({ id: 'E_err', outcome: 'error' }),
      eventRecord({ id: 'E_bud', outcome: 'budget' }),
    ]);
    const svc = new AutonomyTaskRailService(live, hist, () => NOW);
    const rows = await svc.readRows({ outcomes: ['error', 'budget'] satisfies AutonomyOutcome[] });
    expect(rows.map((r) => r.id).sort()).toEqual(['E_bud', 'E_err']);
    svc.dispose();
  });

  it('records inside a day are walked newest-first (reverse of write order)', async () => {
    const live = new StubLiveReader();
    const hist = new StubHistory();
    hist.byDay.set('2026-05-25', [
      eventRecord({ id: 'first_written', triggeredAt: '2026-05-25T01:00:00.000Z' }),
      eventRecord({ id: 'second_written', triggeredAt: '2026-05-25T02:00:00.000Z' }),
      eventRecord({ id: 'third_written', triggeredAt: '2026-05-25T03:00:00.000Z' }),
    ]);
    const svc = new AutonomyTaskRailService(live, hist, () => NOW);
    const rows = await svc.readRows();
    // After sort, descending triggeredAt — `third_written` (03:00) first.
    expect(rows.map((r) => r.id)).toEqual(['third_written', 'second_written', 'first_written']);
    svc.dispose();
  });
});

describe('AutonomyTaskRailService.onDidChange', () => {
  it('fires when the live reader emits', () => {
    const live = new StubLiveReader();
    const svc = new AutonomyTaskRailService(live, undefined, () => NOW);
    const fires: number[] = [];
    svc.onDidChange(() => fires.push(1));
    live.fire(liveEntry({ id: 'x' }));
    expect(fires.length).toBe(1);
    svc.dispose();
  });

  it('fires when the history log emits', () => {
    const live = new StubLiveReader();
    const hist = new StubHistory();
    const svc = new AutonomyTaskRailService(live, hist, () => NOW);
    const fires: number[] = [];
    svc.onDidChange(() => fires.push(1));
    hist.fire(eventRecord({ id: 'y' }));
    expect(fires.length).toBe(1);
    svc.dispose();
  });
});
