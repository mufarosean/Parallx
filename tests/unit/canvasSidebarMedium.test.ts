// canvasSidebarMedium.test.ts — sidebar and header items from
// docs/CANVAS_ASSESSMENT_2026-10-03.md ("Medium"), on a real SQLite database
// with the app's migrations.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CanvasDataService } from '../../src/built-in/canvas/canvasDataService';
import { DatabaseDataService } from '../../src/built-in/canvas/database/databaseDataService';
import { realSqlite } from './realSqlite';

let env: ReturnType<typeof realSqlite>;
let pages: CanvasDataService;
let dbs: DatabaseDataService;

beforeEach(() => {
  env = realSqlite();
  (globalThis as any).window = { parallxElectron: { database: env.bridge } };
  pages = new CanvasDataService();
  dbs = new DatabaseDataService(pages);
});
afterEach(() => {
  dbs.dispose();
  pages.dispose();
  delete (globalThis as any).window;
});

const ids = (nodes: { id: string; children: any[] }[]): string[] => nodes.flatMap((n) => [n.id, ...ids(n.children)]);

describe('the page tree leaves out the databases the app keeps for itself', () => {
  it('"Page properties" is not a page in the tree; Tags and user databases are', async () => {
    const mine = await pages.createPage(null, 'Notes');
    const own = await dbs.createDatabase({ title: 'Reading list' });
    const props = await dbs.ensureWorkspaceDatabase('page-properties');
    const tags = await dbs.ensureWorkspaceDatabase('tags', { name: 'Tags', type: 'tags' });

    const tree = ids(await pages.getPageTree());
    expect(tree).toContain(mine.id);
    expect(tree).toContain(own.id);
    expect(tree).toContain(tags.databaseId);
    expect(tree).not.toContain(props.databaseId);
  });
});
