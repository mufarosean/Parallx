// activityJournal.test.ts — the app's common activity language.
//
// Covers the pure/behavioral core: narrative rendering, secret redaction,
// burst coalescing, ring retention, actor attribution, and batched
// best-effort persistence against a fake database.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ActivityJournalService,
  renderActivityLine,
  redactActivityText,
  type IActivityEvent,
} from '../../src/services/activityJournalService.js';
import { Emitter } from '../../src/platform/events.js';

function ev(partial: Partial<IActivityEvent>): IActivityEvent {
  return {
    ts: new Date(2026, 6, 27, 19, 42).getTime(),
    actor: 'user',
    verb: 'opened',
    object: 'pdf "notes.pdf"',
    source: 'editor',
    count: 1,
    ...partial,
  };
}

describe('renderActivityLine', () => {
  it('renders time, actor, verb, object', () => {
    expect(renderActivityLine(ev({}))).toBe('19:42 user opened pdf "notes.pdf"');
  });

  it('labels actors distinctly — ai is "assistant", ext keeps its id, system is "app"', () => {
    expect(renderActivityLine(ev({ actor: 'ai', verb: 'ran tool', object: 'web_search' }))).toContain('assistant ran tool web_search');
    expect(renderActivityLine(ev({ actor: 'ext:media-organizer', verb: 'noted', object: 'x' }))).toContain('media-organizer noted x');
    expect(renderActivityLine(ev({ actor: 'system', verb: 'started', object: 'session' }))).toContain('app started session');
  });

  it('appends coalesced counts and detail', () => {
    const line = renderActivityLine(ev({ count: 4, detail: '~240 chars' }));
    expect(line).toContain('×4');
    expect(line).toContain('— ~240 chars');
  });

  it('carries the exact-identity ref for the model reader — two "Notes" pages stay distinguishable', () => {
    const line = renderActivityLine(ev({ verb: 'edited', object: 'page "Notes"', ref: 'page:abc123' }));
    expect(line).toContain('page "Notes" [page:abc123]');
    // No ref → no bracket noise.
    expect(renderActivityLine(ev({}))).not.toContain('[');
  });
});

describe('redactActivityText', () => {
  it('redacts credential-shaped fragments', () => {
    const out = redactActivityText('set api_key=sk-abcdef123456 in settings');
    expect(out).not.toContain('sk-abcdef123456');
    expect(out).toContain('[redacted]');
  });

  it('redacts long hex blobs', () => {
    const out = redactActivityText('checksum deadbeefdeadbeefdeadbeefdeadbeef1234');
    expect(out).toContain('[hex]');
  });

  it('leaves ordinary prose alone', () => {
    expect(redactActivityText('opened pdf "Exam 7 notes.pdf"')).toBe('opened pdf "Exam 7 notes.pdf"');
  });
});

describe('ActivityJournalService', () => {
  let now: number;
  let journal: ActivityJournalService;

  beforeEach(() => {
    vi.useFakeTimers();
    now = new Date(2026, 6, 27, 12, 0).getTime();
    journal = new ActivityJournalService(() => now);
  });
  afterEach(() => {
    journal.dispose();
    vi.useRealTimers();
  });

  it('appends and tails in order', () => {
    journal.note({ verb: 'opened', object: 'a' });
    now += 1000;
    journal.note({ verb: 'opened', object: 'b' });
    const tail = journal.tail(10);
    expect(tail.map((e) => e.object)).toEqual(['a', 'b']);
  });

  it('coalesces identical bursts within the window into one line with a count', () => {
    for (let i = 0; i < 5; i++) {
      journal.note({ verb: 'focused', object: 'chat view' });
      now += 5_000;
    }
    const tail = journal.tail(10);
    expect(tail).toHaveLength(1);
    expect(tail[0].count).toBe(5);
  });

  it('does NOT coalesce across the window or across different objects', () => {
    journal.note({ verb: 'focused', object: 'chat view' });
    now += 120_000; // beyond the 90s window
    journal.note({ verb: 'focused', object: 'chat view' });
    journal.note({ verb: 'focused', object: 'explorer view' });
    expect(journal.tail(10)).toHaveLength(3);
  });

  it('does NOT coalesce same-titled objects with different refs (two pages named "Notes")', () => {
    journal.note({ verb: 'edited', object: 'page "Notes"', ref: 'page:aaa' });
    now += 5_000;
    journal.note({ verb: 'edited', object: 'page "Notes"', ref: 'page:bbb' });
    now += 5_000;
    journal.note({ verb: 'edited', object: 'page "Notes"', ref: 'page:aaa' }); // adjacent-only coalescing: new line
    const tail = journal.tail(10);
    expect(tail).toHaveLength(3);
    expect(tail.map((e) => e.ref)).toEqual(['page:aaa', 'page:bbb', 'page:aaa']);
  });

  it('DOES coalesce a typing bout on one page (same ref) into one ×N line', () => {
    for (let i = 0; i < 4; i++) {
      journal.note({ verb: 'edited', object: 'page "Exam 7"', ref: 'page:abc', detail: `~${100 + i} chars` });
      now += 5_000;
    }
    const tail = journal.tail(10);
    expect(tail).toHaveLength(1);
    expect(tail[0].count).toBe(4);
    expect(tail[0].detail).toBe('~103 chars'); // latest detail wins
  });

  it('drops malformed notes and never throws', () => {
    expect(() => journal.note({ verb: '', object: '' })).not.toThrow();
    expect(() => journal.note(undefined as never)).not.toThrow();
    expect(journal.tail(10)).toHaveLength(0);
  });

  it('caps the ring', () => {
    for (let i = 0; i < 700; i++) {
      journal.note({ verb: 'opened', object: `file-${i}` });
      now += 100_000; // defeat coalescing
    }
    expect(journal.tail(10_000).length).toBeLessThanOrEqual(600);
  });

  it('renderRecent produces a readable narrative and respects sinceMs', () => {
    journal.note({ verb: 'opened', object: 'pdf "x.pdf"' });
    now += 200_000;
    journal.note({ actor: 'ai', verb: 'ran tool', object: 'web_search' });
    const all = journal.renderRecent();
    expect(all.split('\n')).toHaveLength(2);
    expect(all).toContain('user opened pdf "x.pdf"');
    expect(all).toContain('assistant ran tool web_search');
    const recentOnly = journal.renderRecent({ sinceMs: now - 1000 });
    expect(recentOnly.split('\n')).toHaveLength(1);
    expect(recentOnly).toContain('web_search');
  });

  it('redacts secrets on the way in', () => {
    journal.note({ verb: 'ran', object: 'command with token=abcdef012345 inside' });
    expect(journal.tail(1)[0].object).not.toContain('abcdef012345');
  });

  it('flushes batched inserts through runTransaction once the DB is attached and open', async () => {
    const runs: string[] = [];
    const txBatches: unknown[][] = [];
    const openEmitter = new Emitter<string>();
    const closeEmitter = new Emitter<void>();
    const fakeDb = {
      isOpen: true,
      currentPath: '/x',
      onDidOpen: openEmitter.event,
      onDidClose: closeEmitter.event,
      openForWorkspace: async () => {},
      close: async () => {},
      migrate: async () => {},
      run: async (sql: string) => { runs.push(sql); return { changes: 0, lastInsertRowid: 0 }; },
      get: async () => null,
      all: async () => [],
      runTransaction: async (ops: unknown[]) => { txBatches.push(ops); return []; },
      dispose: () => {},
    };
    journal.attachDatabase(fakeDb as never);
    // Drain the async table-init microtasks (fake timers are active, so no
    // real waiting is involved — init resolves through immediate promises).
    for (let i = 0; i < 6; i++) await Promise.resolve();
    expect(runs.some((s) => s.includes('CREATE TABLE'))).toBe(true);

    journal.note({ verb: 'opened', object: 'a' });
    now += 100_000;
    journal.note({ verb: 'opened', object: 'b', ref: 'editor:file-b' });
    await journal.flush();

    expect(txBatches).toHaveLength(1);
    expect(txBatches[0]).toHaveLength(2);
    // ref rides the insert (null when absent, value when present).
    const params = (txBatches[0] as { params: unknown[] }[]).map((op) => op.params);
    expect(params[0]).toContain(null);
    expect(params[1]).toContain('editor:file-b');
    // Retention prune ran during table init, and the pre-ref-table migration
    // was attempted (duplicate-column errors are swallowed on modern tables).
    expect(runs.some((s) => s.includes('DELETE FROM activity_log'))).toBe(true);
    expect(runs.some((s) => s.includes('ADD COLUMN ref'))).toBe(true);
  });

  it('keeps the ring alive when the DB is closed (persistence is best-effort)', async () => {
    journal.note({ verb: 'opened', object: 'a' });
    await journal.flush(); // no DB attached — must not throw
    expect(journal.tail(1)).toHaveLength(1);
  });

  it('query filters by actor, verb, source, and ref (ring fallback)', async () => {
    journal.note({ actor: 'user', source: 'editor', verb: 'opened', object: '"a.md"', ref: 'file:a' });
    now += 1000;
    journal.note({ actor: 'ai', source: 'tool', verb: 'ran tool', object: 'web_search' });
    now += 1000;
    journal.note({ actor: 'user', source: 'editor', verb: 'closed', object: '"a.md"', ref: 'file:a' });
    now += 1000;
    journal.note({ actor: 'ext:budget', source: 'ext:budget', verb: 'imported', object: 'ledger' });

    expect((await journal.query({ actor: 'ai' })).map((e) => e.object)).toEqual(['web_search']);
    expect((await journal.query({ verb: 'closed' })).map((e) => e.object)).toEqual(['"a.md"']);
    expect((await journal.query({ source: 'editor' }))).toHaveLength(2);
    expect((await journal.query({ ref: 'file:a' }))).toHaveLength(2);
    expect((await journal.query({ actor: 'user', verb: 'opened' })).map((e) => e.verb)).toEqual(['opened']);
    expect(await journal.query({ actor: 'nobody' })).toEqual([]);
  });

  it('query filters compose with sinceTs and limit', async () => {
    for (let i = 0; i < 5; i++) {
      journal.note({ actor: 'user', source: 'editor', verb: 'opened', object: `doc-${i}`, ref: `file:${i}` });
      now += 100_000; // outside the coalesce window
    }
    const late = await journal.query({ actor: 'user', sinceTs: now - 250_000 });
    expect(late.length).toBeLessThan(5);
    const capped = await journal.query({ actor: 'user', limit: 2 });
    expect(capped).toHaveLength(2);
    // Newest kept when the limit trims (ring fallback slices from the end).
    expect(capped[capped.length - 1].object).toBe('doc-4');
  });
});
