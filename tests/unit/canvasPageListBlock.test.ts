// canvasPageListBlock.test.ts — the Page List block (dataview): its query on a
// real SQLite database with the app's migrations, and how it reads back.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CanvasDataService } from '../../src/built-in/canvas/canvasDataService';
import { DatabaseDataService } from '../../src/built-in/canvas/database/databaseDataService';
import {
  buildDataviewSql, parseDataviewQuery, describeDataviewQuery, dataviewRuleValue,
} from '../../src/built-in/canvas/extensions/dataviewNode';
import { tiptapJsonToMarkdown } from '../../src/built-in/canvas/markdownExport';
import { markdownToTiptapJson } from '../../src/built-in/canvas/markdownImport';
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
afterEach(() => { dbs.dispose(); pages.dispose(); delete (globalThis as any).window; });

async function titles(query: object): Promise<string[]> {
  const built = buildDataviewSql(query as any)!;
  const res = await env.bridge.all(built.sql, built.params);
  return (res.rows ?? []).map((r: any) => r.title);
}

describe('Page List query', () => {
  it('with no rules lists every live page, in the chosen order', async () => {
    const a = await pages.createPage(null, 'Banana');
    await pages.createPage(null, 'apple');
    const gone = await pages.createPage(null, 'Cherry');
    await pages.archivePage(gone.id);
    expect(await titles({ filter: [], sort: { by: 'title', dir: 'asc' } })).toEqual(['apple', 'Banana']);
    expect(await titles({ filter: [], sort: { by: 'title', dir: 'asc' }, limit: 1 })).toEqual(['apple']);
    expect(a).toBeTruthy();
  });

  it('rules on database properties narrow it: select is, tag contains, checkbox, number', async () => {
    const d = await dbs.createDatabase({ title: 'Tasks' });
    const status = await dbs.addProperty(d.id, 'Status', 'select', { options: [] });
    const tags = await dbs.addProperty(d.id, 'Tags', 'tags', { options: [] });
    const done = await dbs.addProperty(d.id, 'Done', 'checkbox');
    const est = await dbs.addProperty(d.id, 'Estimate', 'number');
    await dbs.addRow(d.id, 'Write', { [status.id]: 'Doing', [tags.id]: ['urgent', 'docs'], [done.id]: false, [est.id]: 3 });
    await dbs.addRow(d.id, 'Test', { [status.id]: 'Doing', [tags.id]: ['docs'], [done.id]: true, [est.id]: 8 });
    await dbs.addRow(d.id, 'Ship', { [status.id]: 'Later', [est.id]: 1 });

    const by = { sort: { by: 'title', dir: 'asc' } };
    expect(await titles({ ...by, filter: [{ prop: 'Status', op: 'equals', value: 'Doing' }] })).toEqual(['Test', 'Write']);
    expect(await titles({ ...by, filter: [{ prop: 'Tags', op: 'contains', value: 'urgent' }] })).toEqual(['Write']);
    expect(await titles({ ...by, filter: [{ prop: 'Done', op: 'equals', value: dataviewRuleValue('checkbox', 'yes') }] })).toEqual(['Test']);
    expect(await titles({ ...by, filter: [{ prop: 'Estimate', op: 'greater_than', value: dataviewRuleValue('number', '2') }] })).toEqual(['Test', 'Write']);
    expect(await titles({ ...by, filter: [
      { prop: 'Status', op: 'equals', value: 'Doing' },
      { prop: 'Estimate', op: 'less_than', value: 5 },
    ] })).toEqual(['Write']);
  });

  it('an unknown condition is refused rather than run', () => {
    expect(buildDataviewSql({ filter: [{ prop: 'Status', op: 'drop table' }] })).toBeNull();
  });
});

describe('Page List settings', () => {
  it('an empty query means every page; unreadable stored text is reported, not guessed', () => {
    expect(parseDataviewQuery('')).toEqual({ filter: [] });
    expect(parseDataviewQuery('{not json')).toBeNull();
    expect(parseDataviewQuery('{"filter":"x"}')).toBeNull();
  });

  it('the header says what the list shows', () => {
    expect(describeDataviewQuery({ filter: [] })).toBe('All pages');
    expect(describeDataviewQuery({ filter: [
      { prop: 'Status', op: 'equals', value: 'Doing' },
      { prop: 'Tags', op: 'is_not_empty' },
    ] })).toBe('Status is Doing, Tags is not empty');
  });

  it('survives Markdown export and import with its settings', () => {
    const query = JSON.stringify({ filter: [{ prop: 'Status', op: 'equals', value: 'Doing' }], sort: { by: 'title', dir: 'asc' }, limit: 10 });
    const doc = { type: 'doc', content: [{ type: 'dataview', attrs: { query } }] };
    const back = markdownToTiptapJson(tiptapJsonToMarkdown(doc)) as any;
    const node = back.content.find((n: any) => n.type === 'dataview');
    expect(node?.attrs?.query).toBe(query);
  });
});
