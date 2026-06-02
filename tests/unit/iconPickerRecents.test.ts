// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { loadRecentIcons, recordRecentIcon } from '../../src/ui/iconPicker.js';

const KEY = 'test.iconPicker.recent';

describe('iconPicker recents persistence', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('returns [] when nothing is stored', () => {
    expect(loadRecentIcons(KEY)).toEqual([]);
  });

  it('records a pick and reads it back (most-recent first)', () => {
    recordRecentIcon(KEY, 'star');
    recordRecentIcon(KEY, 'heart');
    expect(loadRecentIcons(KEY)).toEqual(['heart', 'star']);
  });

  it('de-duplicates: re-picking moves the icon to the front, no duplicate', () => {
    recordRecentIcon(KEY, 'star');
    recordRecentIcon(KEY, 'heart');
    recordRecentIcon(KEY, 'star');
    expect(loadRecentIcons(KEY)).toEqual(['star', 'heart']);
  });

  it('caps the list at the requested size, dropping the oldest', () => {
    for (const id of ['a', 'b', 'c', 'd']) recordRecentIcon(KEY, id, 3);
    // newest-first, oldest ('a') evicted
    expect(loadRecentIcons(KEY, 3)).toEqual(['d', 'c', 'b']);
  });

  it('ignores empty icon ids', () => {
    recordRecentIcon(KEY, '');
    expect(loadRecentIcons(KEY)).toEqual([]);
  });

  it('returns [] for malformed stored JSON instead of throwing', () => {
    window.localStorage.setItem(KEY, '{not valid json');
    expect(loadRecentIcons(KEY)).toEqual([]);
  });

  it('filters non-string entries out of a stored array', () => {
    window.localStorage.setItem(KEY, JSON.stringify(['star', 42, null, 'heart']));
    expect(loadRecentIcons(KEY)).toEqual(['star', 'heart']);
  });
});
