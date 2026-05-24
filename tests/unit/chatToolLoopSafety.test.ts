/**
 * Pin-the-invariant: chatToolLoopSafety circuit-breaker.
 *
 * Prevents tool-call loops from running away. Pins:
 *   - HISTORY_LIMIT = 30 (sliding window via shift)
 *   - CRITICAL_REPEAT_THRESHOLD = 8 (8 identical calls in a row -> blocked)
 *   - Identical signature = same tool name AND deep-equal args (key-order independent)
 *   - Reset by ANY different signature in between (the count is "consecutive at end")
 *   - block decision includes a note referencing the tool name and repeat count
 *
 * Zero prior unit coverage.
 */

import { describe, expect, it } from 'vitest';
import { ChatToolLoopSafety } from '../../src/services/chatToolLoopSafety';

const THRESHOLD = 8;

describe('ChatToolLoopSafety.record — repeat detection', () => {
  it('allows the first call', () => {
    const s = new ChatToolLoopSafety();
    const r = s.record('search', { q: 'foo' });
    expect(r.blocked).toBe(false);
  });

  it('allows up to THRESHOLD-1 identical consecutive calls', () => {
    const s = new ChatToolLoopSafety();
    for (let i = 0; i < THRESHOLD - 1; i++) {
      const r = s.record('search', { q: 'foo' });
      expect(r.blocked).toBe(false);
    }
  });

  it('blocks on the THRESHOLD-th identical consecutive call', () => {
    const s = new ChatToolLoopSafety();
    let last;
    for (let i = 0; i < THRESHOLD; i++) {
      last = s.record('search', { q: 'foo' });
    }
    expect(last!.blocked).toBe(true);
    expect(last!.note).toBeDefined();
    expect(last!.note).toContain('search');
  });

  it('does NOT block when calls differ in args', () => {
    const s = new ChatToolLoopSafety();
    for (let i = 0; i < THRESHOLD * 2; i++) {
      const r = s.record('search', { q: `query-${i}` });
      expect(r.blocked).toBe(false);
    }
  });

  it('does NOT block when calls differ in tool name', () => {
    const s = new ChatToolLoopSafety();
    let r;
    for (let i = 0; i < THRESHOLD * 2; i++) {
      r = s.record(i % 2 === 0 ? 'search' : 'read', { q: 'foo' });
    }
    expect(r!.blocked).toBe(false);
  });

  it('counts only CONSECUTIVE identical calls (one different breaks the streak)', () => {
    const s = new ChatToolLoopSafety();
    // 7 identical
    for (let i = 0; i < THRESHOLD - 1; i++) {
      expect(s.record('search', { q: 'foo' }).blocked).toBe(false);
    }
    // 1 different — resets the consecutive streak
    expect(s.record('read', { path: 'a' }).blocked).toBe(false);
    // 7 identical again — still under threshold
    let last;
    for (let i = 0; i < THRESHOLD - 1; i++) {
      last = s.record('search', { q: 'foo' });
    }
    expect(last!.blocked).toBe(false);
  });
});

describe('ChatToolLoopSafety.record — argument identity', () => {
  it('treats key-order-different objects as identical', () => {
    const s = new ChatToolLoopSafety();
    for (let i = 0; i < THRESHOLD - 1; i++) {
      // alternate { a, b } and { b, a } — must still be considered same
      const args = i % 2 === 0 ? { a: 1, b: 2 } : { b: 2, a: 1 };
      s.record('tool', args);
    }
    const last = s.record('tool', { a: 1, b: 2 });
    expect(last.blocked).toBe(true);
  });

  it('treats deeply nested objects with same content as identical', () => {
    const s = new ChatToolLoopSafety();
    let last;
    for (let i = 0; i < THRESHOLD; i++) {
      last = s.record('tool', { nested: { x: [1, 2, 3], y: 'z' } });
    }
    expect(last!.blocked).toBe(true);
  });

  it('treats different array order as different (array order is significant)', () => {
    const s = new ChatToolLoopSafety();
    let r;
    for (let i = 0; i < THRESHOLD * 2; i++) {
      r = s.record('tool', { items: i % 2 === 0 ? [1, 2] : [2, 1] });
    }
    expect(r!.blocked).toBe(false);
  });
});

describe('ChatToolLoopSafety — history window', () => {
  it('does not block if THRESHOLD identical calls span outside the 30-call window', () => {
    // Strategy: fill 30 slots with distinct calls, then attempt THRESHOLD identical ones.
    // The earlier identical "primer" calls have rolled off the window, so only the most
    // recent run can possibly trigger the threshold.
    const s = new ChatToolLoopSafety();
    // 7 identical 'A' calls
    for (let i = 0; i < THRESHOLD - 1; i++) s.record('A', { i: 0 });
    // 30 distinct 'B' calls to push 'A' out of the window
    for (let i = 0; i < 30; i++) s.record('B', { i });
    // 7 identical 'A' calls — under threshold from the rolling window's perspective
    let last;
    for (let i = 0; i < THRESHOLD - 1; i++) last = s.record('A', { i: 0 });
    expect(last!.blocked).toBe(false);
  });

  it('returns block.note referencing repeatCount accurately', () => {
    const s = new ChatToolLoopSafety();
    let last;
    for (let i = 0; i < THRESHOLD; i++) {
      last = s.record('search', { q: 'foo' });
    }
    expect(last!.note).toMatch(/8 identical/);
  });
});
