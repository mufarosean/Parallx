// canvasLinking.test.ts — linking between pages ("Against Notion": @ links,
// backlinks, Move To), the backlinks query on a real SQLite database.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CanvasDataService } from '../../src/built-in/canvas/canvasDataService';
import { findMentionQuery, rankMentionCandidates } from '../../src/built-in/canvas/menus/mentionMenu';
import { pageMoveTargets } from '../../src/built-in/canvas/pageMoveTargets';
import { pageLinkHref } from '../../src/built-in/canvas/pageLinks';
import { realSqlite } from './realSqlite';

describe('"@" opens the page picker only where a mention starts', () => {
  it('at the line start or after a space, with what follows as the query', () => {
    expect(findMentionQuery('@')).toEqual({ query: '', length: 1 });
    expect(findMentionQuery('see @Pro')).toEqual({ query: 'Pro', length: 4 });
    expect(findMentionQuery('see (@Pro')).toEqual({ query: 'Pro', length: 4 });
    expect(findMentionQuery('@Project plan')).toEqual({ query: 'Project plan', length: 13 });
  });
  it('not inside an e-mail address, after "@ ", or after two spaces', () => {
    expect(findMentionQuery('mail me@example')).toBeNull();
    expect(findMentionQuery('@ x')).toBeNull();
    expect(findMentionQuery('@a  b')).toBeNull();
    expect(findMentionQuery('no at sign')).toBeNull();
  });
});

describe('page picker results', () => {
  const pages = [
    { id: 'a', title: 'Reading list', icon: null, path: '' },
    { id: 'b', title: 'Book notes', icon: null, path: 'Reading list' },
    { id: 'c', title: 'Notes on reading', icon: null, path: '' },
    { id: 'self', title: 'Reading log', icon: null, path: '' },
  ];
  it('titles that start with the query come first; the current page is left out', () => {
    expect(rankMentionCandidates(pages, 'read', 'self').map((p) => p.id)).toEqual(['a', 'c']);
    expect(rankMentionCandidates(pages, 'NOTES', 'self').map((p) => p.id)).toEqual(['c', 'b']);
    expect(rankMentionCandidates(pages, '', 'self').map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('Move To targets', () => {
  const tree = [
    { id: 'p', title: 'Projects', children: [
      { id: 'x', title: 'Moving', children: [{ id: 'x1', title: 'Inside', children: [] }] },
      { id: 'y', title: 'Other', children: [] },
    ] },
    { id: 'db', title: 'Tasks', children: [{ id: 'row', title: 'A row', children: [] }] },
    { id: 'q', title: '', children: [] },
  ];
  it('leaves out the page, its own subpages and databases', () => {
    expect(pageMoveTargets(tree, 'x', (id) => id === 'db')).toEqual([
      { id: 'p', title: 'Projects', depth: 0 },
      { id: 'y', title: 'Other', depth: 1 },
      { id: 'q', title: 'Untitled', depth: 0 },
    ]);
  });
});

describe('backlinks', () => {
  let env: ReturnType<typeof realSqlite>;
  let pages: CanvasDataService;
  beforeEach(() => {
    env = realSqlite();
    (globalThis as any).window = { parallxElectron: { database: env.bridge } };
    pages = new CanvasDataService();
  });
  afterEach(() => { pages.dispose(); delete (globalThis as any).window; });

  const linkDoc = (href: string, text: string) => JSON.stringify({ type: 'doc', content: [
    { type: 'paragraph', attrs: { id: 'p1' }, content: [{ type: 'text', text, marks: [{ type: 'link', attrs: { href } }] }] },
  ] });

  it('lists live pages that link to the page or a block in it, not itself, not the Trash', async () => {
    const target = await pages.createPage(null, 'Target');
    const a = await pages.createPage(null, 'Alpha');
    const b = await pages.createPage(null, 'Beta');
    const gone = await pages.createPage(null, 'Gone');
    const plain = await pages.createPage(null, 'Plain');
    await pages.updatePage(a.id, { content: linkDoc(pageLinkHref(target.id), 'Target') });
    await pages.updatePage(b.id, { content: linkDoc(pageLinkHref(target.id, 'blk1'), 'a block') });
    await pages.updatePage(gone.id, { content: linkDoc(pageLinkHref(target.id), 'Target') });
    await pages.updatePage(target.id, { content: linkDoc(pageLinkHref(target.id), 'me') });
    await pages.updatePage(plain.id, { content: linkDoc('https://example.com', 'web') });
    await pages.archivePage(gone.id);

    expect((await pages.getBacklinks(target.id)).map((p) => p.title)).toEqual(['Alpha', 'Beta']);
    expect(await pages.getBacklinks(a.id)).toEqual([]);
  });
});
