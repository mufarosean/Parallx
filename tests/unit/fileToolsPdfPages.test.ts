// fileToolsPdfPages.test.ts — what the AI reads from a PDF says which page
// every passage is on.
//
// The PDF library marks a page break AFTER the page ("-- 13 of 30 --"), and
// read as a heading for what follows, every page came out one too low. Grep
// on a PDF reported lines of the extracted text, which the AI turned into
// pages by arithmetic. Now each page starts with its own header, grep on a
// PDF reports pages, and search results say which page they are on.

import { describe, it, expect } from 'vitest';
import {
  createReadFileTool,
  createGrepSearchTool,
  createSearchKnowledgeTool,
  formatPdfForReading,
} from '../../src/built-in/chat/tools/fileTools';
import type { IBuiltInToolFileSystem, IBuiltInToolRetrieval } from '../../src/built-in/chat/chatTypes';
import type { ICancellationToken } from '../../src/services/chatTypes';

const token: ICancellationToken = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) };

const GUIDE = [
  'Rising Fellow — Clark\nIntroduction',
  'Clark only truncates growth curves when estimating reserves.',
  'The ultimate loss is NOT the same as the expected loss! This is super important!',
];

function makeFs(): IBuiltInToolFileSystem {
  return {
    workspaceRootName: 'Exam 7',
    async readdir() { throw new Error('not a folder'); },
    async readFileContent(p: string) {
      if (p.endsWith('.xlsx')) return { content: 'Step,Recipe\n4,Use the true ultimate', type: 'rich-document' as const, totalChars: 40 };
      // The old joined text, which must no longer reach the AI for a PDF.
      return { content: GUIDE.map((t, i) => `${t}\n-- ${i + 1} of 3 --`).join('\n\n'), type: 'rich-document' as const, totalChars: 300 };
    },
    async readPdfPages(p: string) { return p.endsWith('.pdf') ? GUIDE : undefined; },
    async exists() { return true; },
  };
}

describe('fs_read_file on a PDF', () => {
  it('reads page by page, each page under its own header, with what the number means', async () => {
    const r = await createReadFileTool(makeFs()).handler({ path: 'Rising Fellow Guides/Clark.pdf' }, token);
    const out = r.content as string;
    expect(out).toContain('(.pdf file, all 3 pages)');
    expect(out).not.toContain('-- 3 of 3 --');
    const header3 = out.indexOf('===== Page 3 of 3 =====');
    expect(out.indexOf('The ultimate loss is NOT the same')).toBeGreaterThan(header3);
    expect(out).toContain('It is not the page number printed on the page');
  });

  it('reads a page range', async () => {
    const r = await createReadFileTool(makeFs()).handler({ path: 'Rising Fellow Guides/Clark.pdf', start_page: 2, end_page: 2 }, token);
    const out = r.content as string;
    expect(out).toContain('pages 2 to 2 of 3');
    expect(out).toContain('===== Page 2 of 3 =====');
    expect(out).not.toContain('===== Page 3 of 3 =====');
  });

  it('stops at a page boundary when long, and says where to read on', () => {
    const long = Array.from({ length: 40 }, (_, i) => `page ${i + 1} ` + 'x'.repeat(4000));
    const out = formatPdfForReading('big.pdf', long);
    expect(out).toContain('pages 1 to 12 of 40');
    expect(out).toContain('Read on with start_page=13');
    expect(out).not.toContain('===== Page 13 of 40 =====');
  });

  it('says a scan without a text layer has no text', () => {
    expect(formatPdfForReading('scan.pdf', ['', ' '])).toContain('could not extract text');
  });
});

describe('fs_read_file on a spreadsheet', () => {
  it('warns that its lines are not the workbook rows', async () => {
    const r = await createReadFileTool(makeFs()).handler({ path: 'Cookbook/5_Clark.xlsx' }, token);
    expect(r.content).toContain('not numbered as in the workbook');
  });
});

describe('fs_grep_search on a PDF', () => {
  it('reports the PDF page of each match, not a line of extracted text', async () => {
    const r = await createGrepSearchTool(makeFs()).handler({ pattern: 'NOT the same', path: 'Rising Fellow Guides/Clark.pdf' }, token);
    const out = r.content as string;
    expect(out).toContain('Rising Fellow Guides/Clark.pdf (page 3 of 3)');
    expect(out).not.toMatch(/Clark\.pdf:\d+/);
  });
});

describe('fs_search_knowledge results from a PDF', () => {
  it('say which page they are on', async () => {
    const retrieval: IBuiltInToolRetrieval = {
      isReady: () => true,
      retrieve: async () => [
        { sourceType: 'file_chunk', sourceId: 'Rising Fellow Guides/Clark.pdf', contextPrefix: '[Source: "Rising Fellow Guides/Clark.pdf"]', text: '## Truncation\n**Clark only truncates growth curves** when estimating reserves.', score: 0.9 },
        { sourceType: 'file_chunk', sourceId: 'notes.md', contextPrefix: '[Source: "notes.md"]', text: 'unrelated notes', score: 0.5 },
      ],
    };
    const r = await createSearchKnowledgeTool(retrieval, makeFs()).handler({ query: 'truncation' }, token);
    const out = r.content as string;
    expect(out).toContain('[Source: "Rising Fellow Guides/Clark.pdf"] (page 2 of 3)');
    expect(out).toContain('[Source: "notes.md"] [score');
  });
});
