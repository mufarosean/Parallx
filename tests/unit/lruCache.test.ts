// lruCache.test.ts — the cache forgets its least recently used entry past the cap.

import { describe, it, expect } from 'vitest';
import { LRUCache } from '../../src/platform/lruCache';

describe('LRUCache', () => {
  it('drops the oldest entry past the cap, and a read makes an entry young again', () => {
    const c = new LRUCache<string, number>(2);
    c.set('a', 1);
    c.set('b', 2);
    expect(c.get('a')).toBe(1); // a is now the newest
    c.set('c', 3); // b, the oldest, goes
    expect(c.get('b')).toBeUndefined();
    expect(c.get('a')).toBe(1);
    expect(c.get('c')).toBe(3);
    expect(c.size).toBe(2);
  });

  it('overwrites in place, deletes, and clears', () => {
    const c = new LRUCache<string, number>(2);
    c.set('a', 1);
    c.set('a', 2);
    expect(c.size).toBe(1);
    expect(c.get('a')).toBe(2);
    c.delete('a');
    expect(c.get('a')).toBeUndefined();
    c.set('x', 1);
    c.clear();
    expect(c.size).toBe(0);
  });
});
