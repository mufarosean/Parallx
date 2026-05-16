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
