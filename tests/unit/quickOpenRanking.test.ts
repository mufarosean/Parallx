// Quick Open ranking: how a query matches a source's items, and how the
// general list orders files, pages, settings, tools and themes together.
import { describe, it, expect } from 'vitest';
import {
  matchEntry, looksLikePath, collectSourceRows, rankQuickOpenRows,
  DETAIL_PENALTY, type QuickOpenRow,
} from '../../src/commands/quickOpenRanking';
import type { QuickOpenSource } from '../../src/services/quickOpenSources';

const noop = (): void => {};

function row(id: string, label: string, score: number, group: string, kind?: string, extra: Partial<QuickOpenRow> = {}): QuickOpenRow {
  return { id, label, score, group, kind, accept: noop, ...extra };
}

describe('matchEntry', () => {
  it('prefers a label match over a detail match over a keyword match', () => {
    const onLabel = matchEntry('accent', 'Accent Colour', 'Appearance', 'appearance.accent');
    const onDetail = matchEntry('accent', 'Highlight', 'Accent options', 'x');
    const onKeyword = matchEntry('accent', 'Highlight', 'Appearance', 'appearance.accent the accent hue');
    expect(onLabel?.labelMatches).toEqual([0, 1, 2, 3, 4, 5]);
    expect(onDetail?.detailMatches).toEqual([0, 1, 2, 3, 4, 5]);
    expect(onKeyword?.labelMatches).toBeUndefined();
    expect(onLabel!.score).toBeLessThan(onDetail!.score);
    expect(onDetail!.score).toBeLessThan(onKeyword!.score);
  });

  it('puts the detail penalty on a detail match', () => {
    const label = matchEntry('notes', 'Notes', undefined)!;
    const detail = matchEntry('notes', 'Other', 'Notes')!;
    expect(detail.score - label.score).toBe(DETAIL_PENALTY);
  });

  it('matches keywords only as a whole substring, never by scattered letters', () => {
    expect(matchEntry('model', 'Temperature', 'Chat', 'chat.defaultModel the model to use')).not.toBeNull();
    expect(matchEntry('zqx', 'Temperature', 'Chat', 'z q x scattered')).toBeNull();
  });

  it('returns null when nothing matches', () => {
    expect(matchEntry('xyz', 'Planner', 'On', 'parallx.planner')).toBeNull();
  });
});

describe('looksLikePath', () => {
  it.each(['src/', 'docs\\notes', 'notes.md', 'quickAccess.ts', '.gitignore'])('reads %s as a path', (q) => {
    expect(looksLikePath(q)).toBe(true);
  });
  it.each(['accent', 'planner', 'dark mode', 'Chat Model'])('reads %s as a name', (q) => {
    expect(looksLikePath(q)).toBe(false);
  });
});

describe('collectSourceRows', () => {
  const source = (id: string, labels: string[], extra: Partial<QuickOpenSource> = {}): QuickOpenSource => ({
    id, group: id, kind: id[0].toUpperCase() + id.slice(1, -1),
    listItems: async () => labels.map((label) => ({ id: label, label, open: noop })),
    ...extra,
  });

  it('lists a source that waits for a query only once the user types', async () => {
    const settings = source('settings', ['Accent', 'Font'], { onlyWhenQueried: true });
    const pages = source('pages', ['Course Notes']);
    expect((await collectSourceRows('', [settings, pages], 50)).map((r) => r.label)).toEqual(['Course Notes']);
    expect((await collectSourceRows('acc', [settings, pages], 50)).map((r) => r.label)).toEqual(['Accent']);
  });

  it('keeps each source in its own order with no query, and best first with one', async () => {
    const s = source('tools', ['Zeta Tool', 'Alpha Tool', 'Toolbox']);
    expect((await collectSourceRows('', [s], 50)).map((r) => r.label)).toEqual(['Zeta Tool', 'Alpha Tool', 'Toolbox']);
    expect((await collectSourceRows('tool', [s], 50))[0].label).toBe('Toolbox');
  });

  it('carries the source group and kind, and caps each source', async () => {
    const rows = await collectSourceRows('a', [source('themes', ['Amber', 'Slate', 'Warm'])], 2);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.group === 'themes' && r.kind === 'Theme')).toBe(true);
    expect(rows[0].id).toBe('themes:Amber');
  });

  it('skips a source that fails to list, and opens the entry on accept', async () => {
    let opened = '';
    const broken: QuickOpenSource = { id: 'broken', group: 'broken', listItems: async () => { throw new Error('gone'); } };
    const good: QuickOpenSource = { id: 'good', group: 'good', listItems: async () => [{ id: 'a', label: 'Accent', open: () => { opened = 'a'; } }] };
    const rows = await collectSourceRows('acc', [broken, good], 50);
    expect(rows.map((r) => r.id)).toEqual(['good:a']);
    rows[0].accept();
    expect(opened).toBe('a');
  });
});

describe('rankQuickOpenRows', () => {
  const rows = [
    row('setting', 'Accent', -1500, 'settings', 'Setting'),
    row('tool', 'Disable Browser', -900, 'tools', 'Tool'),
    row('file', 'accent.md', -1400, 'files', 'File'),
    row('theme', 'Amber', 40, 'themes', 'Theme'),
  ];

  it('keeps the sections as listed when the query is empty', () => {
    expect(rankQuickOpenRows(rows, '').map((r) => r.id)).toEqual(['setting', 'tool', 'file', 'theme']);
  });

  it('puts files first when the query looks like a path, the rest as listed', () => {
    const ranked = rankQuickOpenRows(rows, 'docs/acc');
    expect(ranked.map((r) => r.id)).toEqual(['file', 'setting', 'tool', 'theme']);
    expect(ranked[0].group).toBe('files');
  });

  it('ranks by match quality otherwise, and shows a category on each row when kinds mix', () => {
    const ranked = rankQuickOpenRows(rows, 'acc');
    expect(ranked.map((r) => r.id)).toEqual(['setting', 'file', 'tool', 'theme']);
    expect(ranked.map((r) => r.category)).toEqual(['Setting', 'File', 'Tool', 'Theme']);
    expect(ranked.every((r) => r.group === undefined)).toBe(true);
  });

  it('keeps the section header and no category when one kind is left', () => {
    const files = [row('b', 'b.ts', -1000, 'files', 'File'), row('a', 'a.ts', -1200, 'files', 'File')];
    const ranked = rankQuickOpenRows(files, 'ts x');
    expect(ranked.map((r) => r.id)).toEqual(['a', 'b']);
    expect(ranked.every((r) => r.group === 'files' && r.category === undefined)).toBe(true);
  });

  it('lets a recently opened row lead among close matches, and keeps ties in order', () => {
    const ranked = rankQuickOpenRows([
      row('older', 'Notes', -1300, 'files', 'File'),
      row('recent', 'My Notes', -1200, 'files', 'File', { isRecent: true }),
      row('tieA', 'Tie', 0, 'pages', 'Page'),
      row('tieB', 'Tie', 0, 'pages', 'Page'),
    ], 'notes');
    expect(ranked.map((r) => r.id)).toEqual(['recent', 'older', 'tieA', 'tieB']);
  });

  it('does not change the rows it was given', () => {
    const before = rows.map((r) => ({ ...r }));
    rankQuickOpenRows(rows, 'acc');
    expect(rows).toEqual(before);
  });
});
