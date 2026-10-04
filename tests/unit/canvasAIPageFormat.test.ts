// Canvas assessment 2026-10-03, "AI page edits lose formatting": the AI read a
// page as plain text, so a `replace` edit (and Edit mode's Accept) rewrote bold,
// links, nesting and callouts away and dropped sub-page cards.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createEditPageTool, createReadPageTool } from '../../src/built-in/canvas/ai/pageTools';
import { encodeDocContent } from '../../src/built-in/canvas/ai/blockApi';
import { decodeCanvasContent } from '../../src/built-in/canvas/contentSchema';
import { tiptapJsonToMarkdown } from '../../src/built-in/canvas/markdownExport';
import { markdownToTiptapJson } from '../../src/built-in/canvas/markdownImport';
import { _resetResourceRegistryForTest, markResourceSeen, pageResourceKey } from '../../src/services/toolResourceRegistry';

const token = () => ({ isCancellationRequested: false, onCancellationRequested: vi.fn(() => ({ dispose: vi.fn() })) }) as any;
const S1 = { sessionId: 's1' };

const t = (text: string, marks?: any[]) => ({ type: 'text', text, ...(marks ? { marks } : {}) });
const page = () => ({
  type: 'doc',
  content: [
    { type: 'heading', attrs: { id: 'h1', level: 2 }, content: [t('Plan')] },
    { type: 'paragraph', attrs: { id: 'p1' }, content: [t('Bold', [{ type: 'bold' }]), t(' and '), t('link', [{ type: 'link', attrs: { href: 'https://e.com' } }])] },
    { type: 'columnList', attrs: { id: 'cl' }, content: [
      { type: 'column', attrs: { id: 'c1' }, content: [{ type: 'paragraph', attrs: { id: 'l' }, content: [t('Left')] }] },
      { type: 'column', attrs: { id: 'c2' }, content: [{ type: 'pageBlock', attrs: { id: 'card', pageId: 'child-1', title: 'Child' } }] },
    ] },
    { type: 'callout', attrs: { id: 'co', emoji: 'warning' }, content: [{ type: 'paragraph', attrs: { id: 'cp' }, content: [t('Careful')] }] },
  ],
});

function makeDb(rows: any[]) {
  return {
    isOpen: true,
    async get(sql: string, params: unknown[] = []) {
      if (/COUNT\(\*\)/.test(sql)) return { cnt: 0 };
      if (/FROM pages WHERE id = \?/.test(sql)) return rows.find((r) => r.id === params[0]);
      return undefined;
    },
    async all() { return []; },
    async run(sql: string, params: unknown[] = []) {
      if (/UPDATE pages SET content/.test(sql)) {
        const row = rows.find((r) => r.id === params.at(-1));
        if (row) { row.content = params[0]; row.revision += 1; }
        return { changes: row ? 1 : 0 };
      }
      return { changes: 0 };
    },
  } as any;
}

const docOf = (row: any) => decodeCanvasContent(row.content).doc as any;
const types = (doc: any): string[] => { const out: string[] = []; const walk = (n: any) => { out.push(n.type); (n.content ?? []).forEach(walk); }; walk(doc); return out; };

beforeEach(() => _resetResourceRegistryForTest());

describe('the AI sees and keeps every block', () => {
  it('canvas_read_page returns lossless markdown with block ids', async () => {
    const rows = [{ id: 'P', title: 'T', content: encodeDocContent(page() as any), icon: null, is_archived: 0, created_at: '2026-10-04 00:00:00', updated_at: '2026-10-04 00:00:00', revision: 1 }];
    const res = await createReadPageTool(makeDb(rows)).handler({ pageId: 'P' }, token(), S1);
    expect(res.content).toContain('<!-- block:h1 -->');
    expect(res.content).toContain('**Bold**');
    expect(res.content).toContain('[link](https://e.com)');
    expect(res.content).toContain('parallx:open {"type":"columnList"}');
    expect(res.content).toContain('"pageId":"child-1"');
  });

  it('a replace with the body read back unchanged leaves the page exactly as it was', async () => {
    const rows = [{ id: 'P', title: 'T', content: encodeDocContent(page() as any), revision: 1 }];
    markResourceSeen('s1', pageResourceKey('P'));
    const md = tiptapJsonToMarkdown(page(), undefined, { withBlockIds: true });
    const res = await createEditPageTool(makeDb(rows)).handler({ pageId: 'P', markdown: md, mode: 'replace' }, token(), S1);
    expect(res.isError).toBeFalsy();
    // Top-level blocks keep their ids; nested blocks get fresh ones.
    const noNestedIds = (doc: any) => ({ ...doc, content: doc.content.map((b: any) => strip(b, true)) });
    const strip = (n: any, top = false): any => {
      const out: any = { ...n };
      if (n.attrs) { const { id, ...rest } = n.attrs; out.attrs = top ? n.attrs : rest; if (!top && !Object.keys(rest).length) delete out.attrs; }
      if (n.content) out.content = n.content.map((c: any) => strip(c));
      return out;
    };
    expect(noNestedIds(docOf(rows[0]))).toEqual(noNestedIds(page()));
  });

  it('a replace that leaves out a sub-page card puts the card back', async () => {
    const rows = [{ id: 'P', title: 'T', content: encodeDocContent(page() as any), revision: 1 }];
    markResourceSeen('s1', pageResourceKey('P'));
    await createEditPageTool(makeDb(rows)).handler({ pageId: 'P', markdown: '# New plan\n\nShort.', mode: 'replace' }, token(), S1);
    const doc = docOf(rows[0]);
    expect(doc.content.at(-1).type).toBe('pageBlock');
    expect(doc.content.at(-1).attrs.pageId).toBe('child-1');
  });

  it('a card the page did not have is not written (it would move another page)', async () => {
    const rows = [{ id: 'P', title: 'T', content: encodeDocContent(page() as any), revision: 1 }];
    markResourceSeen('s1', pageResourceKey('P'));
    const md = '<!-- parallx:atom {"type":"pageBlock","attrs":{"pageId":"someone-else","title":"X"}} -->\n\ntext';
    await createEditPageTool(makeDb(rows)).handler({ pageId: 'P', markdown: md, mode: 'append' }, token(), S1);
    expect(JSON.stringify(docOf(rows[0]))).not.toContain('someone-else');
  });

  it('appended blocks never reuse an id already on the page', async () => {
    const rows = [{ id: 'P', title: 'T', content: encodeDocContent(page() as any), revision: 1 }];
    markResourceSeen('s1', pageResourceKey('P'));
    await createEditPageTool(makeDb(rows)).handler({ pageId: 'P', markdown: '<!-- block:p1 -->\nCopy of p1', mode: 'append' }, token(), S1);
    const ids: string[] = [];
    const walk = (n: any) => { if (n.attrs?.id) ids.push(n.attrs.id); (n.content ?? []).forEach(walk); };
    walk(docOf(rows[0]));
    expect(new Set(ids).size).toBe(ids.length);
    expect(types(docOf(rows[0]))).toContain('callout');
  });

  it('a block id marker copied twice keeps the id on the first copy only', () => {
    const doc = markdownToTiptapJson('<!-- block:x1 -->\nOne\n\n<!-- block:x1 -->\nTwo', { assignBlockIds: false });
    expect(doc.content![0]!.attrs!.id).toBe('x1');
    expect(doc.content![1]!.attrs?.id).toBeUndefined();
  });
});
