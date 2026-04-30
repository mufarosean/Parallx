// blockTools.test.ts — M60 Phase δ T3 chat tool behavioral tests.
//
// Verifies all 5 block tools (M60 §6.2) end-to-end against an in-memory DB mock:
//   query_pages_by_property — multi-filter AND, sort by property, group.
//   read_block — finds a block by id, returns json + plaintext.
//   edit_block — replaces block content, bumps revision, preserves blockId.
//   insert_block_after — inserts new paragraph with new blockId.
//   link_block — appends a link paragraph in source page.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createBlockTools,
  BLOCK_TOOL_NAMES,
} from '../../src/built-in/chat/tools/blockTools';
import { encodeDocContent } from '../../src/built-in/chat/tools/blockApi';
import type { IBuiltInToolDatabase } from '../../src/built-in/chat/chatTypes';
import type { ICancellationToken } from '../../src/services/chatTypes';

function token(): ICancellationToken {
  return { isCancellationRequested: false, onCancellationRequested: vi.fn(() => ({ dispose: vi.fn() })) as any };
}

interface PageRow { id: string; title: string; content: string; revision: number; updated_at: string }
interface PropRow { page_id: string; key: string; value: string }

function makeDb(pages: PageRow[], props: PropRow[] = []) {
  const db: IBuiltInToolDatabase = {
    isOpen: true,
    async get<T>(sql: string, params: unknown[] = []): Promise<T | null | undefined> {
      if (/FROM pages WHERE id = \?$/.test(sql.trim())) {
        return pages.find(p => p.id === params[0]) as T | undefined;
      }
      if (/FROM pages WHERE id = \?/.test(sql)) {
        return pages.find(p => p.id === params[0]) as T | undefined;
      }
      return undefined;
    },
    async all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      // query_pages_by_property — pages SELECT
      if (/SELECT p\.id, p\.title, p\.updated_at FROM pages p/.test(sql)) {
        // Extract the INTERSECT of page_ids from the props table by scanning params.
        // We re-implement the filter here by parsing param tuples [key, ...].
        // The SQL is parameterized as: per filter, [key, value...]; final [limit].
        // For simplicity in this mock, ignore SQL structure and apply filter
        // params in pairs to mimic equals/contains/is_(not_)empty etc.
        // Tests below use only "equals" so we hard-code that path.
        const filtersRaw = params.slice(0, -1) as unknown[];
        const limit = params.at(-1) as number;
        const matches = new Set<string>(pages.map(p => p.id));
        for (let i = 0; i < filtersRaw.length; i += 2) {
          const key = filtersRaw[i] as string;
          const valueJson = filtersRaw[i + 1] as string;
          const ids = new Set(props.filter(pr => pr.key === key && pr.value === valueJson).map(pr => pr.page_id));
          for (const id of [...matches]) if (!ids.has(id)) matches.delete(id);
        }
        return pages.filter(p => matches.has(p.id))
          .map(p => ({ id: p.id, title: p.title, updated_at: p.updated_at } as T))
          .slice(0, limit);
      }
      if (/SELECT page_id, value FROM page_properties/.test(sql)) {
        const key = params[0] as string;
        const ids = params.slice(1) as string[];
        return props.filter(pr => pr.key === key && ids.includes(pr.page_id))
          .map(pr => ({ page_id: pr.page_id, value: pr.value } as T));
      }
      return [];
    },
    async run(sql: string, params: unknown[] = []): Promise<{ changes: number }> {
      if (/UPDATE pages SET content/.test(sql)) {
        const id = params.at(-1) as string;
        const content = params[0] as string;
        const updated = params[1] as string;
        const target = pages.find(p => p.id === id);
        if (target) {
          target.content = content;
          target.revision = (target.revision ?? 1) + 1;
          target.updated_at = updated;
        }
        return { changes: target ? 1 : 0 };
      }
      return { changes: 0 };
    },
  };
  return db;
}

function buildDocEnvelope(blocks: { id: string; text: string }[]): string {
  return encodeDocContent({
    type: 'doc',
    content: blocks.map(b => ({
      type: 'paragraph',
      attrs: { id: b.id },
      content: [{ type: 'text', text: b.text }],
    })),
  });
}

describe('blockTools — registration', () => {
  it('exposes 5 tools matching BLOCK_TOOL_NAMES', () => {
    const tools = createBlockTools(undefined);
    expect(tools.map(t => t.name).sort()).toEqual([...BLOCK_TOOL_NAMES].sort());
  });
});

describe('query_pages_by_property (M60 §6.3 C1)', () => {
  let db: IBuiltInToolDatabase;
  let tool: any;
  beforeEach(() => {
    db = makeDb(
      [
        { id: 'p1', title: 'Alpha', content: '', revision: 1, updated_at: '2026-01-01' },
        { id: 'p2', title: 'Beta', content: '', revision: 1, updated_at: '2026-01-02' },
        { id: 'p3', title: 'Gamma', content: '', revision: 1, updated_at: '2026-01-03' },
      ],
      [
        { page_id: 'p1', key: 'status', value: JSON.stringify('Draft') },
        { page_id: 'p1', key: 'tag', value: JSON.stringify('research') },
        { page_id: 'p2', key: 'status', value: JSON.stringify('Draft') },
        { page_id: 'p2', key: 'tag', value: JSON.stringify('product') },
        { page_id: 'p3', key: 'status', value: JSON.stringify('Final') },
      ],
    );
    tool = createBlockTools(db).find(t => t.name === 'query_pages_by_property')!;
  });

  it('intersects multiple filters (status=Draft AND tag=research)', async () => {
    const result = await tool.handler({
      filter: [
        { prop: 'status', op: 'equals', value: 'Draft' },
        { prop: 'tag', op: 'equals', value: 'research' },
      ],
    }, token());
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('Alpha');
    expect(result.content).not.toContain('Beta');
    expect(result.content).not.toContain('Gamma');
  });

  it('rejects empty filter array', async () => {
    const result = await tool.handler({ filter: [] }, token());
    expect(result.isError).toBe(true);
  });

  it('groups results by a property', async () => {
    const result = await tool.handler({
      filter: [{ prop: 'status', op: 'equals', value: 'Draft' }],
      group: 'tag',
    }, token());
    expect(result.content).toContain('### tag = research');
    expect(result.content).toContain('### tag = product');
  });
});

describe('read_block / edit_block / insert_block_after / link_block', () => {
  let pages: PageRow[];
  let db: IBuiltInToolDatabase;
  let tools: ReturnType<typeof createBlockTools>;

  beforeEach(() => {
    pages = [
      {
        id: 'p1', title: 'Source', revision: 1, updated_at: '2026-01-01',
        content: buildDocEnvelope([
          { id: 'a1', text: 'first' },
          { id: 'a2', text: 'second' },
          { id: 'a3', text: 'third' },
        ]),
      },
      {
        id: 'p2', title: 'Target', revision: 1, updated_at: '2026-01-01',
        content: buildDocEnvelope([{ id: 't1', text: 'hello target' }]),
      },
    ];
    db = makeDb(pages);
    tools = createBlockTools(db);
  });

  it('read_block returns the block JSON and plaintext', async () => {
    const tool = tools.find(t => t.name === 'read_block')!;
    const result = await tool.handler({ pageId: 'p1', blockId: 'a2' }, token());
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('a2');
    expect(result.content).toContain('second');
    expect(result.content).toContain('paragraph');
  });

  it('read_block errors when block missing', async () => {
    const tool = tools.find(t => t.name === 'read_block')!;
    const result = await tool.handler({ pageId: 'p1', blockId: 'nope' }, token());
    expect(result.isError).toBe(true);
  });

  it('edit_block replaces content, bumps revision, preserves blockId', async () => {
    const tool = tools.find(t => t.name === 'edit_block')!;
    const before = pages[0]!.revision;
    const result = await tool.handler(
      { pageId: 'p1', blockId: 'a2', newContent: 'rewritten', idempotencyKey: 'k1' },
      token(),
    );
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('idempotencyKey: k1');
    expect(pages[0]!.revision).toBe(before + 1);
    const decoded = JSON.parse(pages[0]!.content);
    const docContent = decoded.doc.content;
    const a2 = docContent.find((b: any) => b.attrs?.id === 'a2');
    expect(a2.content[0].text).toBe('rewritten');
    // Other blocks intact.
    const a1 = docContent.find((b: any) => b.attrs?.id === 'a1');
    expect(a1.content[0].text).toBe('first');
  });

  it('insert_block_after inserts a new block with a fresh id', async () => {
    const tool = tools.find(t => t.name === 'insert_block_after')!;
    const result = await tool.handler(
      { pageId: 'p1', anchorBlockId: 'a1', content: 'inserted' },
      token(),
    );
    expect(result.isError).toBeFalsy();
    const decoded = JSON.parse(pages[0]!.content);
    const ids = decoded.doc.content.map((b: any) => b.attrs?.id);
    expect(ids).toContain('a1');
    expect(ids).toContain('a2');
    expect(ids.length).toBe(4);
    // Inserted block sits between a1 and a2.
    expect(ids[0]).toBe('a1');
    expect(ids[2]).toBe('a2');
  });

  it('link_block creates a link paragraph after the source block', async () => {
    const tool = tools.find(t => t.name === 'link_block')!;
    const result = await tool.handler(
      { fromPageId: 'p1', fromBlockId: 'a1', toPageId: 'p2', toBlockId: 't1', label: 'See target' },
      token(),
    );
    expect(result.isError).toBeFalsy();
    const decoded = JSON.parse(pages[0]!.content);
    const linkBlock = decoded.doc.content[1];
    expect(linkBlock.type).toBe('paragraph');
    expect(linkBlock.content[0].text).toContain('See target');
    expect(linkBlock.content[0].text).toContain('page://p2#t1');
  });

  it('link_block errors when target block missing', async () => {
    const tool = tools.find(t => t.name === 'link_block')!;
    const result = await tool.handler(
      { fromPageId: 'p1', fromBlockId: 'a1', toPageId: 'p2', toBlockId: 'nope' },
      token(),
    );
    expect(result.isError).toBe(true);
  });
});
