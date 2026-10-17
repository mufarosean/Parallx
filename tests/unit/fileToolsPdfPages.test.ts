// fileToolsPdfPages.test.ts — what the AI reads from a document says where
// every passage is, and carries the source label it cites with.
//
// The PDF library marks a page break AFTER the page ("-- 13 of 30 --"), and
// read as a heading for what follows, every page came out one too low. Now
// each page is its own block under its own header. A large document comes
// back as its start, and a question finds its passages wherever they are,
// cut from the live file (never from the index, which can lag the file).

import { describe, it, expect, beforeEach } from 'vitest';
import { createReadFileTool, createGrepSearchTool } from '../../src/built-in/chat/tools/fileTools';
import type { IBuiltInToolFileSystem, IBuiltInToolRetrieval } from '../../src/built-in/chat/chatTypes';
import type { ICancellationToken } from '../../src/services/chatTypes';
import { _resetSourceHandlesForTest, getSourceHandle } from '../../src/services/sourceHandles';

const token: ICancellationToken = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) };
const session = { sessionId: 'chat-1' };

const GUIDE = [
  'Rising Fellow — Clark\nIntroduction',
  'Clark only truncates growth curves when estimating reserves.',
  'The ultimate loss is NOT the same as the expected loss! This is super important!',
];

/** A 40-page book: too large to show whole. Page 31 holds the tail factor. */
const BOOK = Array.from({ length: 40 }, (_, i) => i === 30
  ? 'Tail factors. The selected tail factor is 1.05, taken from the inverse power curve fit. ' + 'filler '.repeat(500)
  : `Chapter text on page ${i + 1}. ` + 'lorem ipsum dolor '.repeat(250));

function makeFs(): IBuiltInToolFileSystem {
  return {
    workspaceRootName: 'Exam 7',
    async readdir() { throw new Error('not a folder'); },
    async readFileContent(p: string) {
      if (p.endsWith('.xlsx')) return { content: 'Step,Recipe\n4,Use the true ultimate', type: 'rich-document' as const, totalChars: 40 };
      // The old joined text, which must no longer reach the AI for a PDF.
      return { content: GUIDE.map((t, i) => `${t}\n-- ${i + 1} of 3 --`).join('\n\n'), type: 'rich-document' as const, totalChars: 300 };
    },
    async readPdfPages(p: string) {
      if (p.endsWith('Book.pdf')) return BOOK;
      return p.endsWith('.pdf') ? GUIDE : undefined;
    },
    async exists() { return true; },
  };
}

beforeEach(() => _resetSourceHandlesForTest());

describe('fs_read_file on a PDF', () => {
  it('reads page by page, each page a labelled block', async () => {
    const r = await createReadFileTool(makeFs()).handler({ path: 'Rising Fellow Guides/Clark.pdf' }, token, session);
    const out = r.content as string;
    expect(out).toContain('(.pdf file, 3 pages)');
    expect(out).not.toContain('-- 3 of 3 --');
    const header3 = out.indexOf('===== [S3] Rising Fellow Guides/Clark.pdf · page 3 of 3 =====');
    expect(header3).toBeGreaterThan(0);
    expect(out.indexOf('The ultimate loss is NOT the same')).toBeGreaterThan(header3);
    // The label points at that page, and remembers what the page said.
    const s3 = getSourceHandle('chat-1', 'S3')!;
    expect(s3.uri).toBe('parallx://explorer/file?path=Rising+Fellow+Guides%2FClark.pdf&page=3');
    expect(s3.title).toBe('Clark.pdf, page 3');
    expect(s3.text).toContain('The ultimate loss is NOT the same');
    expect(s3.document).toBe(true);
  });

  it('reads a page range', async () => {
    const r = await createReadFileTool(makeFs()).handler({ path: 'Rising Fellow Guides/Clark.pdf', start_page: 2, end_page: 2 }, token);
    const out = r.content as string;
    expect(out).toContain('pages 2 to 2 of 3');
    expect(out).toContain('===== Rising Fellow Guides/Clark.pdf · page 2 of 3 =====');
    expect(out).not.toContain('page 3 of 3 =====');
  });

  it('gives a large document as its start, and says to ask with a query (no script, no paging through)', async () => {
    const r = await createReadFileTool(makeFs()).handler({ path: 'Books/Book.pdf' }, token, session);
    const out = r.content as string;
    expect(out).toContain('the start of a large file');
    expect(out).toContain('page 1 of 40');
    expect(out).not.toContain('page 31 of 40');
    expect(out).toContain('call fs_read_file again with `query`');
  });

  it('finds the passage that answers a question in a large document, from the live pages (keywords, no index)', async () => {
    const r = await createReadFileTool(makeFs()).handler({ path: 'Books/Book.pdf', query: 'selected tail factor' }, token, session);
    const out = r.content as string;
    expect(out).toMatch(/===== \[S\d+\] Books\/Book\.pdf · page 31 of 40 =====/);
    expect(out).toContain('The selected tail factor is 1.05');
  });

  it('places index results on the live pages, and drops a stale chunk that is no longer in the file', async () => {
    const retrieval: IBuiltInToolRetrieval = {
      isReady: () => true,
      retrieve: async () => [
        // Indexed before an edit: these words are gone from the file.
        { sourceType: 'file_chunk', sourceId: 'Books/Book.pdf', contextPrefix: '', text: 'The selected tail factor was 1.10 in the first draft of this chapter.', score: 0.95 },
        { sourceType: 'file_chunk', sourceId: 'Books/Book.pdf', contextPrefix: '', text: 'Tail factors. The selected tail factor is 1.05, taken from the inverse power curve fit.', score: 0.9 },
      ],
    };
    const r = await createReadFileTool(makeFs(), retrieval).handler({ path: 'Books/Book.pdf', query: 'tail factor' }, token, session);
    const out = r.content as string;
    expect(out).toContain('page 31 of 40');
    expect(out).not.toContain('1.10');
  });

  it('says a scan without a text layer has no text', async () => {
    const fs = makeFs();
    fs.readPdfPages = async () => ['', ' '];
    const r = await createReadFileTool(fs).handler({ path: 'scan.pdf' }, token);
    expect(r.content).toContain('could not extract text');
  });
});

describe('fs_read_file on a spreadsheet', () => {
  it('warns that its lines are not the workbook rows', async () => {
    const r = await createReadFileTool(makeFs()).handler({ path: 'Cookbook/5_Clark.xlsx' }, token);
    expect(r.content).toContain('not numbered as in the workbook');
  });
});

describe('fs_grep_search', () => {
  it('reports the PDF page of each match, labelled like a read of that page', async () => {
    const read = await createReadFileTool(makeFs()).handler({ path: 'Rising Fellow Guides/Clark.pdf' }, token, session);
    expect(read.content).toContain('[S3]');
    const r = await createGrepSearchTool(makeFs()).handler({ pattern: 'NOT the same', path: 'Rising Fellow Guides/Clark.pdf' }, token, session);
    const out = r.content as string;
    expect(out).toContain('[S3] Rising Fellow Guides/Clark.pdf (page 3 of 3)');
    expect(out).not.toMatch(/Clark\.pdf:\d+/);
  });

  it('adds related passages from the index, placed on the live page, when nothing matches exactly', async () => {
    const retrieval: IBuiltInToolRetrieval = {
      isReady: () => true,
      retrieve: async () => [
        { sourceType: 'file_chunk', sourceId: 'Rising Fellow Guides/Clark.pdf', contextPrefix: '[Source: "Rising Fellow Guides/Clark.pdf"]', text: '## Truncation\n**Clark only truncates growth curves** when estimating reserves.', score: 0.9 },
        { sourceType: 'file_chunk', sourceId: 'src/code.ts', contextPrefix: '', text: 'function truncate() {}', score: 0.5 },
        { sourceType: 'page_block', sourceId: 'page-7', contextPrefix: '[Source: "Clark notes" | Type: paragraph]', text: 'Truncation keeps the tail from growing forever.', score: 0.4 },
      ],
    };
    const r = await createGrepSearchTool(makeFs(), retrieval).handler({ pattern: 'curve truncation', path: 'Rising Fellow Guides/Clark.pdf' }, token, session);
    const out = r.content as string;
    expect(out).toContain('No exact matches');
    expect(out).toMatch(/===== \[S\d+\] Rising Fellow Guides\/Clark\.pdf · page 2 of 3 =====\nClark only truncates/);
    expect(out).toMatch(/===== \[S\d+\] canvas page "Clark notes" =====/);
    expect(out).not.toContain('function truncate');
  });
});
