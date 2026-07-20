import { describe, it, expect } from 'vitest';
import { extractWorkspaceReferences } from '../../src/services/referenceExtractor.js';

describe('extractWorkspaceReferences', () => {
  it('returns empty for empty or non-string input', () => {
    expect(extractWorkspaceReferences('')).toEqual([]);
    expect(extractWorkspaceReferences(undefined as any)).toEqual([]);
    expect(extractWorkspaceReferences(null as any)).toEqual([]);
  });

  it('extracts parallx://page/<id> short-form references', () => {
    const refs = extractWorkspaceReferences('See parallx://page/abc123 for context.');
    expect(refs).toEqual([{ targetType: 'page_block', targetId: 'abc123' }]);
  });

  it('extracts parallx://canvas/page/<id> long-form references', () => {
    const refs = extractWorkspaceReferences('Background in parallx://canvas/page/xyz789.');
    expect(refs).toEqual([{ targetType: 'page_block', targetId: 'xyz789' }]);
  });

  it('handles block-level long-form URIs by resolving to the page', () => {
    const refs = extractWorkspaceReferences('In parallx://canvas/page/p1/block/b1, ...');
    expect(refs).toEqual([{ targetType: 'page_block', targetId: 'p1' }]);
  });

  it('extracts multiple references in one text', () => {
    const text = 'See parallx://page/a and parallx://canvas/page/b for details.';
    const refs = extractWorkspaceReferences(text);
    expect(refs).toEqual([
      { targetType: 'page_block', targetId: 'a' },
      { targetType: 'page_block', targetId: 'b' },
    ]);
  });

  it('de-duplicates references that point to the same target', () => {
    const text = 'parallx://page/abc and again parallx://canvas/page/abc.';
    const refs = extractWorkspaceReferences(text);
    expect(refs).toEqual([{ targetType: 'page_block', targetId: 'abc' }]);
  });

  it('ignores malformed parallx URIs', () => {
    const refs = extractWorkspaceReferences('parallx:// invalid and parallx://justbad');
    expect(refs).toEqual([]);
  });

  it('stops URI matching at common markdown delimiters', () => {
    // The URI should be parallx://page/x, not parallx://page/x).
    const refs = extractWorkspaceReferences('see [the page](parallx://page/x)');
    expect(refs).toEqual([{ targetType: 'page_block', targetId: 'x' }]);
  });

  it('stops at whitespace and quote characters', () => {
    const refs = extractWorkspaceReferences('"parallx://page/q" and parallx://page/r ');
    expect(refs).toEqual([
      { targetType: 'page_block', targetId: 'q' },
      { targetType: 'page_block', targetId: 'r' },
    ]);
  });

  it('does not emit file references (out of scope for Phase 2)', () => {
    const refs = extractWorkspaceReferences('parallx://file/notes.md is a file ref.');
    expect(refs).toEqual([]);
  });
});

// ─── M88 S3 — markdown links, wiki links, title mentions ─────────────────────

import {
  extractMarkdownLinkTargets,
  extractWikiLinkTitles,
  resolveRelativeTarget,
  findTitleMentions,
} from '../../src/services/referenceExtractor.js';

describe('extractMarkdownLinkTargets (M88 S3)', () => {
  it('extracts relative file targets and decodes %20', () => {
    expect(extractMarkdownLinkTargets(
      'See [notes](study/Exam%207.md) and [ch2](../book/ch2.pdf).',
    )).toEqual(['study/Exam 7.md', '../book/ch2.pdf']);
  });

  it('excludes images, external URLs, schemes, and pure anchors', () => {
    expect(extractMarkdownLinkTargets(
      '![img](pic.png) [ext](https://x.com/a) [mail](mailto:a@b.c) [top](#heading) [px](parallx://page/abc)',
    )).toEqual([]);
  });

  it('strips fragments and titles', () => {
    expect(extractMarkdownLinkTargets('[s](notes.md#sec2) [t](a.md "Title")')).toEqual(['notes.md', 'a.md']);
  });
});

describe('extractWikiLinkTitles (M88 S3)', () => {
  it('extracts titles and alias forms', () => {
    expect(extractWikiLinkTitles('Link [[Brehm Correlation]] and [[Exam 7 Notes|notes]].'))
      .toEqual(['Brehm Correlation', 'Exam 7 Notes']);
  });

  it('ignores empty and malformed brackets', () => {
    expect(extractWikiLinkTitles('[[]] [not-wiki] [[  ]]')).toEqual([]);
  });
});

describe('resolveRelativeTarget (M88 S3)', () => {
  it('resolves ./, ../ and backslashes against the base dir', () => {
    expect(resolveRelativeTarget('study/exam7', '../book/ch2.pdf')).toBe('study/book/ch2.pdf');
    expect(resolveRelativeTarget('study', './notes.md')).toBe('study/notes.md');
    expect(resolveRelativeTarget('', 'a\\b.md')).toBe('a/b.md');
    expect(resolveRelativeTarget('study', '/root.md')).toBe('root.md');
  });
});

describe('findTitleMentions (M88 S3)', () => {
  const titles = [
    { key: 'file_chunk:papers/Brehm-Correlation.pdf', title: 'Brehm-Correlation' },
    { key: 'page_block:p1', title: 'Exam 7 Study Plan' },
    { key: 'page_block:p2', title: 'notes' },        // short/lowercase → never matches
    { key: 'page_block:p3', title: 'Robust Estimation' },
  ];

  it('finds word-boundary title mentions case-insensitively', () => {
    const text = 'As shown in brehm-correlation, the exam 7 study plan holds.';
    expect(findTitleMentions(text, titles).sort()).toEqual([
      'file_chunk:papers/Brehm-Correlation.pdf',
      'page_block:p1',
    ]);
  });

  it('rejects substring hits inside larger words and noise titles', () => {
    expect(findTitleMentions('xxbrehm-correlationyy discusses notes', titles)).toEqual([]);
  });
});
