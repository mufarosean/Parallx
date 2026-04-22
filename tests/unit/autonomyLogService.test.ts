// autonomyLogService.test.ts — M58-real post-ship UX reshape.
//
// Covers the dedicated AutonomyLogService that replaces the short-lived
// "append autonomous results directly into chat" behavior.
//
// Invariants:
//   1. append() returns a well-formed entry with a unique id, starts unread
//   2. onDidAppend and onDidChange both fire
//   3. getEntries returns newest-first, respects limit/origin/onlyUnread
//   4. getUnreadCount tracks correctly
//   5. markRead(ids) marks exact matches; markRead() without args marks all
//   6. clear() empties + fires change
//   7. Ring buffer trims to AUTONOMY_LOG_MAX_ENTRIES

import { describe, it, expect, beforeEach } from 'vitest';
import {
  AutonomyLogService,
  AUTONOMY_LOG_MAX_ENTRIES,
} from '../../src/services/autonomyLogService';

function push(log: AutonomyLogService, origin: string, content = 'body', requestText = `[${origin}]`) {
  return log.append({ origin, content, requestText });
}

describe('AutonomyLogService', () => {
  let log: AutonomyLogService;

  beforeEach(() => {
    log = new AutonomyLogService();
  });

  it('append returns a well-formed entry', () => {
    const e = push(log, 'heartbeat', 'saved TODO.md', '[heartbeat · file-saved]');
    expect(e.id).toMatch(/^al-/);
    expect(e.origin).toBe('heartbeat');
    expect(e.read).toBe(false);
    expect(e.timestamp).toBeGreaterThan(0);
    expect(e.content).toBe('saved TODO.md');
    expect(e.requestText).toBe('[heartbeat · file-saved]');
  });

  it('append ids are unique across rapid calls', () => {
    const a = push(log, 'cron');
    const b = push(log, 'cron');
    const c = push(log, 'cron');
    expect(new Set([a.id, b.id, c.id]).size).toBe(3);
  });

  it('fires onDidAppend and onDidChange', () => {
    let appended = 0;
    let changed = 0;
    log.onDidAppend(() => { appended++; });
    log.onDidChange(() => { changed++; });
    push(log, 'cron');
    expect(appended).toBe(1);
    expect(changed).toBe(1);
  });

  it('getEntries returns newest-first and respects limit', () => {
    push(log, 'cron', 'a');
    push(log, 'cron', 'b');
    push(log, 'cron', 'c');
    const out = log.getEntries({ limit: 2 });
    expect(out).toHaveLength(2);
    expect(out[0].content).toBe('c');
    expect(out[1].content).toBe('b');
  });

  it('getEntries filters by origin', () => {
    push(log, 'cron', 'c1');
    push(log, 'heartbeat', 'h1');
    push(log, 'cron', 'c2');
    const onlyCron = log.getEntries({ origin: 'cron' });
    expect(onlyCron.map((e) => e.content)).toEqual(['c2', 'c1']);
  });

  it('getEntries onlyUnread skips read entries', () => {
    const a = push(log, 'cron', 'a');
    push(log, 'cron', 'b');
    log.markRead([a.id]);
    const unread = log.getEntries({ onlyUnread: true });
    expect(unread).toHaveLength(1);
    expect(unread[0].content).toBe('b');
  });

  it('getUnreadCount tracks correctly', () => {
    push(log, 'cron');
    push(log, 'cron');
    expect(log.getUnreadCount()).toBe(2);
    log.markRead();
    expect(log.getUnreadCount()).toBe(0);
  });

  it('markRead(ids) marks exact matches only', () => {
    const a = push(log, 'cron');
    const b = push(log, 'cron');
    expect(log.markRead([a.id])).toBe(1);
    const entries = log.getEntries();
    const byId = new Map(entries.map((e) => [e.id, e]));
    expect(byId.get(a.id)?.read).toBe(true);
    expect(byId.get(b.id)?.read).toBe(false);
  });

  it('markRead() without args marks all unread', () => {
    push(log, 'cron');
    push(log, 'heartbeat');
    push(log, 'subagent');
    expect(log.markRead()).toBe(3);
    expect(log.getUnreadCount()).toBe(0);
  });

  it('markRead returns 0 when nothing changes', () => {
    const e = push(log, 'cron');
    log.markRead([e.id]);
    expect(log.markRead([e.id])).toBe(0);
  });

  it('clear empties the log and fires change', () => {
    push(log, 'cron');
    push(log, 'cron');
    let changed = 0;
    log.onDidChange(() => { changed++; });
    log.clear();
    expect(log.size).toBe(0);
    expect(log.getEntries()).toHaveLength(0);
    expect(changed).toBe(1);
  });

  it('clear on empty log does not fire change', () => {
    let changed = 0;
    log.onDidChange(() => { changed++; });
    log.clear();
    expect(changed).toBe(0);
  });

  it('ring buffer trims to cap', () => {
    // Append cap + 5 entries
    for (let i = 0; i < AUTONOMY_LOG_MAX_ENTRIES + 5; i++) {
      push(log, 'cron', `entry-${i}`);
    }
    expect(log.size).toBe(AUTONOMY_LOG_MAX_ENTRIES);
    // Oldest 5 should be trimmed — the earliest retained is entry-5
    const all = log.getEntries({ limit: AUTONOMY_LOG_MAX_ENTRIES });
    const contents = all.map((e) => e.content);
    expect(contents[0]).toBe(`entry-${AUTONOMY_LOG_MAX_ENTRIES + 4}`);
    expect(contents[contents.length - 1]).toBe('entry-5');
  });
});
