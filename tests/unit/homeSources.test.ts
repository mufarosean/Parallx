// homeSources.test.ts — Home's contribution point: sources come and go with
// their tools, their items merge into one stream, and one failing source
// never takes the page down.

import { describe, it, expect, vi } from 'vitest';
import { collectHomeEntries, getHomeSources, onDidChangeHomeSources, registerHomeSource, type HomeItem } from '../../src/services/homeSources.js';

const item = (id: string, touchedAt: number, extra: Partial<HomeItem> = {}): HomeItem => ({ id, title: id, kind: 'Thing', touchedAt, open: () => {}, ...extra });

describe('home sources', () => {
  it('lists a source while it is registered, and says when the set changes', () => {
    const changed = vi.fn();
    const listening = onDidChangeHomeSources(changed);
    const reg = registerHomeSource({ id: 't.a', label: 'A', listRecent: async () => [] });
    expect(getHomeSources().map((s) => s.id)).toContain('t.a');
    reg.dispose();
    expect(getHomeSources().map((s) => s.id)).not.toContain('t.a');
    expect(changed).toHaveBeenCalledTimes(2);
    listening.dispose();
  });

  it('merges every source into one stream, newest first', async () => {
    const a = registerHomeSource({ id: 't.a', label: 'A', listRecent: async () => [item('a1', 10), item('a2', 30)] });
    const b = registerHomeSource({ id: 't.b', label: 'B', listRecent: async () => [item('b1', 20)] });
    expect((await collectHomeEntries('')).map((e) => e.item.id)).toEqual(['a2', 'b1', 'a1']);
    a.dispose(); b.dispose();
  });

  it('leaves out a source that fails, and keeps the rest', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    const bad = registerHomeSource({ id: 't.bad', label: 'Bad', listRecent: async () => { throw new Error('boom'); } });
    const good = registerHomeSource({ id: 't.good', label: 'Good', listRecent: async () => [item('g', 1)] });
    expect((await collectHomeEntries('')).map((e) => e.item.id)).toEqual(['g']);
    bad.dispose(); good.dispose(); quiet.mockRestore();
  });

  it('a query filters what is recent by title, summary, tag, kind and tool, and asks the source to search', async () => {
    const search = vi.fn(async () => [item('old', 1, { title: 'Chain ladder, 2019' }), item('r1', 5, { title: 'Chain ladder' })]);
    const reg = registerHomeSource({
      id: 't.a', label: 'Notes',
      listRecent: async () => [item('r1', 5, { title: 'Chain ladder' }), item('r2', 4, { title: 'Budget', tags: ['chain'] }), item('r3', 3, { title: 'Other' })],
      search,
    });
    expect((await collectHomeEntries(' Chain ')).map((e) => e.item.id)).toEqual(['r1', 'r2', 'old']);
    expect(search).toHaveBeenCalledWith('Chain', expect.any(Number));
    expect((await collectHomeEntries('notes')).map((e) => e.item.id).sort()).toEqual(['old', 'r1', 'r2', 'r3']);
    reg.dispose();
  });
});
