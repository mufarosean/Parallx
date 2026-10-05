// explorerFileLink.test.ts — the `parallx://explorer/file` citation link.
//
// The failures this guards against, from a real study session: links built
// from a guessed drive path (D:\AI\Parallx\…) that did not exist, "validated"
// links that were never checked, and page numbers worked out by hand that
// were one off. A link's path is the workspace path the file tools show; a
// check confirms the file exists and sets the page from where the quote is.

import { describe, it, expect } from 'vitest';
import { URI } from '../../src/platform/uri';
import { parseParallxUri } from '../../src/links/parallxUri';
import {
  checkFileLink,
  fileLinkCandidates,
  relativeToRoot,
  revealTargetOf,
  type IFileLinkHost,
} from '../../src/built-in/explorer/fileLink';
import type { IFileLocateResult } from '../../src/services/fileLocator';

const ROOT = URI.file('C:/Users/mchit/OneDrive/Documents/Actuarial Science/Exams/Exam 7 - October 2026');

// The workspace's files and what the locator says about each.
const FILES: Record<string, IFileLocateResult & { quoteAt?: Record<string, IFileLocateResult['spots']> }> = {
  'Rising Fellow Guides/Clark.pdf': {
    addressing: 'page', pageCount: 30, spots: [],
    quoteAt: {
      'The ultimate loss is NOT the same as the expected loss': [{ page: 13, text: 'The ultimate loss is NOT the same as the expected loss' }],
      'truncation': [{ page: 8, text: 'truncation' }, { page: 17, text: 'truncation' }],
    },
  },
  'Practice Problems and Exams/Exam 7 Recipes (import).txt': {
    addressing: 'line', lineCount: 2000, spots: [],
    quoteAt: { 'Use untruncated ultimates when computing': [{ line: 1324, text: 'Use untruncated ultimates when computing' }] },
  },
  'Rising Fellow Exam 7 Cookbook/Exam 7 Cookbook - 5_Clark.xlsx': {
    addressing: 'cell', sheets: ['LDF', 'Cape Cod'], spots: [],
    quoteAt: { 'Use the true ultimate': [{ sheet: 'Cape Cod', cell: 'C180', text: 'Use the true ultimate' }] },
  },
};

function makeHost(): IFileLinkHost {
  const rel = (uri: string) => relativeToRoot(ROOT, URI.parse(uri));
  return {
    workspaceRoot: () => ROOT,
    stat: async (uri) => {
      const r = rel(uri);
      if (r === 'Rising Fellow Guides') return { type: 2 };
      if (r && FILES[r]) return { type: 1 };
      throw new Error('ENOENT');
    },
    locate: async (uri, quote) => {
      const f = FILES[rel(uri)!];
      if (!quote) return f;
      if (quote === 'ELR') return { ...f, quoteTooShort: true };
      return { ...f, spots: f.quoteAt?.[quote] ?? [] };
    },
  };
}

const link = (params: Record<string, string>) => parseParallxUri(
  `parallx://explorer/file?${new URLSearchParams(params).toString()}`,
)!;

describe('explorer file link: which file a path means', () => {
  it('resolves a workspace path (as the file tools show it) against the open workspace', () => {
    const [c] = fileLinkCandidates({ path: 'Rising Fellow Guides/Clark.pdf' }, ROOT);
    expect(c.uri.fsPath).toBe('C:/Users/mchit/OneDrive/Documents/Actuarial Science/Exams/Exam 7 - October 2026/Rising Fellow Guides/Clark.pdf');
    expect(c.relative).toBe('Rising Fellow Guides/Clark.pdf');
  });

  it('accepts backslashes, a leading ./ or / and an absolute path inside the workspace', () => {
    expect(fileLinkCandidates({ path: 'Rising Fellow Guides\\Clark.pdf' }, ROOT)[0].relative).toBe('Rising Fellow Guides/Clark.pdf');
    expect(fileLinkCandidates({ path: './Rising Fellow Guides/Clark.pdf' }, ROOT)[0].relative).toBe('Rising Fellow Guides/Clark.pdf');
    expect(fileLinkCandidates({ path: '/Rising Fellow Guides/Clark.pdf' }, ROOT)[0].relative).toBe('Rising Fellow Guides/Clark.pdf');
    const abs = 'c:\\users\\mchit\\OneDrive\\Documents\\Actuarial Science\\Exams\\Exam 7 - October 2026\\Rising Fellow Guides\\Clark.pdf';
    expect(fileLinkCandidates({ path: abs }, ROOT)[0].relative).toBe('Rising Fellow Guides/Clark.pdf');
  });

  it('refuses a path that climbs out of the workspace', () => {
    expect(fileLinkCandidates({ path: '../secrets.txt' }, ROOT)).toEqual([]);
  });

  it('still opens an old uri=file:/// link', () => {
    const [c] = fileLinkCandidates({ uri: ROOT.joinPath('Rising Fellow Guides/Clark.pdf').toString() }, ROOT);
    expect(c.relative).toBe('Rising Fellow Guides/Clark.pdf');
  });

  it('reads the reveal target, keeping only well-formed numbers', () => {
    expect(revealTargetOf({ page: '13', quote: ' the words ', line: 'x', cell: 'c180', sheet: 'Cape Cod' }))
      .toEqual({ page: 13, quote: 'the words', cell: 'C180', sheet: 'Cape Cod' });
  });
});

describe('explorer file link: checking', () => {
  it('rejects the guessed drive path that broke every link in the session', async () => {
    const r = await checkFileLink(makeHost(), link({ path: 'D:\\AI\\Parallx\\Exam Source Material\\Shapland.pdf' }), {});
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain('No file at');
      expect(r.error).toContain('relative to the workspace');
    }
  });

  it('confirms a file exists and returns the canonical workspace-path link', async () => {
    const r = await checkFileLink(makeHost(), link({ path: 'Rising Fellow Guides\\Clark.pdf' }), {});
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(parseParallxUri(r.uri)!.params.path).toBe('Rising Fellow Guides/Clark.pdf');
      expect(r.checked).toBe('"Clark.pdf" exists.');
    }
  });

  it('says a folder is not a file', async () => {
    const r = await checkFileLink(makeHost(), link({ path: 'Rising Fellow Guides' }), {});
    expect(r).toEqual({ ok: false, error: '"Rising Fellow Guides" is a folder, not a file.' });
  });

  it('sets the PDF page from where the quote is, and says what it checked', async () => {
    const r = await checkFileLink(makeHost(), link({ path: 'Rising Fellow Guides/Clark.pdf', quote: 'The ultimate loss is NOT the same as the expected loss' }), { thorough: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const p = parseParallxUri(r.uri)!.params;
    expect(p.page).toBe('13');
    expect(p.quote).toBe('The ultimate loss is NOT the same as the expected loss');
    expect(r.location).toBe('page 13 of 30');
    expect(r.checked).toContain('quote was found on page 13 of 30');
  });

  it('corrects a wrong page (the off-by-one) and says so', async () => {
    const r = await checkFileLink(makeHost(), link({ path: 'Rising Fellow Guides/Clark.pdf', page: '12', quote: 'The ultimate loss is NOT the same as the expected loss' }), { thorough: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(parseParallxUri(r.uri)!.params.page).toBe('13');
    expect(r.checked).toContain('Page 12 was given; the quote is on page 13');
  });

  it('keeps the page given when the quote appears there too, and names the other places', async () => {
    const r = await checkFileLink(makeHost(), link({ path: 'Rising Fellow Guides/Clark.pdf', page: '17', quote: 'truncation' }), { thorough: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(parseParallxUri(r.uri)!.params.page).toBe('17');
    expect(r.checked).toContain('also appear at page 8');
  });

  it('refuses a quote that is not in the file, or too short to place', async () => {
    const missing = await checkFileLink(makeHost(), link({ path: 'Rising Fellow Guides/Clark.pdf', quote: 'words the paper never says' }), { thorough: true });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error).toContain('not found in "Clark.pdf"');
    const short = await checkFileLink(makeHost(), link({ path: 'Rising Fellow Guides/Clark.pdf', quote: 'ELR' }), { thorough: true });
    expect(short.ok).toBe(false);
    if (!short.ok) expect(short.error).toContain('too short');
  });

  it('checks a page given without a quote against the page count, and says the text was not checked', async () => {
    const past = await checkFileLink(makeHost(), link({ path: 'Rising Fellow Guides/Clark.pdf', page: '31' }), { thorough: true });
    expect(past).toEqual({ ok: false, error: '"Clark.pdf" has 30 pages; page 31 is past the end.' });
    const inRange = await checkFileLink(makeHost(), link({ path: 'Rising Fellow Guides/Clark.pdf', page: '5' }), { thorough: true });
    expect(inRange.ok).toBe(true);
    if (inRange.ok) expect(inRange.checked).toContain('nothing on the page was checked');
  });

  it('sets the line of a text file from the quote', async () => {
    const r = await checkFileLink(makeHost(), link({ path: 'Practice Problems and Exams/Exam 7 Recipes (import).txt', quote: 'Use untruncated ultimates when computing' }), { thorough: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(parseParallxUri(r.uri)!.params.line).toBe('1324');
    expect(r.location).toBe('line 1324');
  });

  it('sets the sheet and cell of a spreadsheet from the quote, and drops a page that does not apply', async () => {
    const r = await checkFileLink(makeHost(), link({ path: 'Rising Fellow Exam 7 Cookbook/Exam 7 Cookbook - 5_Clark.xlsx', page: '3', quote: 'Use the true ultimate' }), { thorough: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const p = parseParallxUri(r.uri)!.params;
    expect(p).toMatchObject({ sheet: 'Cape Cod', cell: 'C180' });
    expect(p.page).toBeUndefined();
    expect(r.location).toBe('sheet "Cape Cod", cell C180');
    expect(r.checked).toContain('page does not apply');
  });

  it('checks a sheet name given without a quote', async () => {
    const r = await checkFileLink(makeHost(), link({ path: 'Rising Fellow Exam 7 Cookbook/Exam 7 Cookbook - 5_Clark.xlsx', sheet: 'Benktander', cell: 'A1' }), { thorough: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('Its sheets: LDF, Cape Cod');
  });
});
