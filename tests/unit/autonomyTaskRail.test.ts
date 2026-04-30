// autonomyTaskRail.test.ts — M60 §8 Phase ζ T5.E1
//
// Verifies the AutonomyTaskRailService viewmodel:
//   - merges in-memory live entries with persisted history
//   - filters by trigger kind and outcome
//   - paginates / caps to limit
//   - newest-first ordering
//
// The rail is a *read-only* viewmodel; no business logic. Tests focus on
// data composition + filter shape only.

import { describe, expect, it } from 'vitest';
import { AutonomyTaskRailService } from '../../src/services/autonomyTaskRailService';
import { AutonomyLogService } from '../../src/services/autonomyLogService';
import { AutonomyEventLog, type IAutonomyEventLogFs } from '../../src/services/autonomyEventLog';
import { beforeEach } from 'vitest';

function memoryFs(): IAutonomyEventLogFs {
  const files = new Map<string, string>();
  return {
    async exists(p) { return { ok: true, exists: files.has(p) }; },
    async readFile(p) {
      const data = files.get(p);
      return data === undefined ? { ok: false, error: 'ENOENT' } : { ok: true, data };
    },
    async writeFile(p, c) { files.set(p, c); return { ok: true }; },
    async mkdir() { return { ok: true }; },
    async readdir() {
      return { ok: true, entries: Array.from(files.keys()).map(p => ({ name: p.split('/').pop() ?? p })) };
    },
    async delete(p) { files.delete(p); return { ok: true }; },
  };
}

beforeEach(async () => {
  if (!(globalThis as { crypto?: { subtle?: SubtleCrypto } }).crypto?.subtle) {
    const { webcrypto } = await import('node:crypto');
    (globalThis as { crypto: typeof webcrypto }).crypto = webcrypto;
  }
});

describe('AutonomyTaskRailService (M60 §8 ζ T5.E1)', () => {
  it('returns live rows when history is unavailable', () => {
    const live = new AutonomyLogService();
    live.append({ origin: 'heartbeat', requestText: 'tick', content: 'ran' });
    live.append({ origin: 'cron', requestText: 'job', content: 'ran cron' });
    const rail = new AutonomyTaskRailService(live, undefined);

    const rows = rail.readLiveRows();
    expect(rows.length).toBe(2);
    // Newest first.
    expect(rows[0].trigger).toBe('cron');
    expect(rows[1].trigger).toBe('heartbeat');
  });

  it('filters live rows by trigger kind', () => {
    const live = new AutonomyLogService();
    live.append({ origin: 'heartbeat', requestText: 'a', content: 'a' });
    live.append({ origin: 'cron', requestText: 'b', content: 'b' });
    live.append({ origin: 'subagent', requestText: 'c', content: 'c' });
    const rail = new AutonomyTaskRailService(live, undefined);

    const cronOnly = rail.readLiveRows({ triggers: ['cron'] });
    expect(cronOnly.length).toBe(1);
    expect(cronOnly[0].trigger).toBe('cron');
  });

  it('merges live and persisted history newest-first', async () => {
    const fs = memoryFs();
    const fixedNow = Date.parse('2026-04-30T12:00:00Z');
    const log = new AutonomyEventLog(fs, { dataDir: '/data', now: () => fixedNow });
    log.emit({ trigger: { kind: 'cron', ref: 'j-1' }, outcome: 'completed', durationMs: 10 });
    log.emit({ trigger: { kind: 'subagent', ref: 'r-2' }, outcome: 'gated' });
    await log.flush();

    const live = new AutonomyLogService();
    live.append({ origin: 'heartbeat', requestText: 'live', content: 'now' });

    const rail = new AutonomyTaskRailService(live, log, () => fixedNow);
    const rows = await rail.readRows({ sinceDays: 1, limit: 50 });
    // 1 live + 2 history = 3 rows.
    expect(rows.length).toBe(3);
    // Live row carries content; history rows do not.
    const liveRow = rows.find(r => r.kind === 'live');
    const historyRows = rows.filter(r => r.kind === 'event');
    expect(liveRow?.kind).toBe('live');
    expect(historyRows.length).toBe(2);
  });

  it('caps merged output to the requested limit', async () => {
    const fs = memoryFs();
    const fixedNow = Date.parse('2026-04-30T12:00:00Z');
    const log = new AutonomyEventLog(fs, { dataDir: '/data', now: () => fixedNow });
    for (let i = 0; i < 10; i++) {
      log.emit({ trigger: { kind: 'cron', ref: `j-${i}` }, outcome: 'completed' });
    }
    await log.flush();
    const live = new AutonomyLogService();
    const rail = new AutonomyTaskRailService(live, log, () => fixedNow);

    const rows = await rail.readRows({ sinceDays: 1, limit: 3 });
    expect(rows.length).toBe(3);
  });

  it('filters merged rows by outcome (history only)', async () => {
    const fs = memoryFs();
    const fixedNow = Date.parse('2026-04-30T12:00:00Z');
    const log = new AutonomyEventLog(fs, { dataDir: '/data', now: () => fixedNow });
    log.emit({ trigger: { kind: 'cron', ref: 'a' }, outcome: 'completed' });
    log.emit({ trigger: { kind: 'cron', ref: 'b' }, outcome: 'gated' });
    log.emit({ trigger: { kind: 'cron', ref: 'c' }, outcome: 'completed' });
    await log.flush();
    const live = new AutonomyLogService();
    const rail = new AutonomyTaskRailService(live, log, () => fixedNow);

    const rows = await rail.readRows({ sinceDays: 1, outcomes: ['gated'], limit: 50 });
    expect(rows.length).toBe(1);
    expect(rows[0].kind).toBe('event');
    if (rows[0].kind === 'event') {
      expect(rows[0].outcome).toBe('gated');
    }
  });
});
