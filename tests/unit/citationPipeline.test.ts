// citationPipeline.test.ts — C1.5 Citation accuracy tests
//
// Verifies that the citation pipeline produces correct, consistent
// number mappings from formatContext() through _buildSourceCitations().

import { describe, it, expect } from 'vitest';

// ── Inline replicas of the dedup/numbering logic from retrievalService
// and chatDataService so we can unit-test the algorithm in isolation. ──

interface MockChunk {
  sourceType: string;
  sourceId: string;
  text: string;
  contextPrefix?: string;
}

/** Replica of RetrievalService.formatContext() numbering algorithm. */
function formatContextNumbers(chunks: MockChunk[]): Map<string, number> {
  const sourceIndex = new Map<string, number>();
  let nextIndex = 1;
  for (const chunk of chunks) {
    const key = `${chunk.sourceType}:${chunk.sourceId}`;
    if (!sourceIndex.has(key)) {
      sourceIndex.set(key, nextIndex++);
    }
  }
  return sourceIndex;
}

/** Replica of _buildSourceCitations() numbering algorithm. */
function buildCitationNumbers(chunks: MockChunk[]): Array<{ index: number; key: string }> {
  const seen = new Set<string>();
  const sources: Array<{ index: number; key: string }> = [];
  let nextIndex = 1;
  for (const chunk of chunks) {
    const key = `${chunk.sourceType}:${chunk.sourceId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sources.push({ key, index: nextIndex++ });
  }
  return sources;
}

/** Extract [N] numbers from text in order of appearance. */
function extractCitationNumbers(text: string): number[] {
  const result: number[] = [];
  const seen = new Set<number>();
  const pattern = /\[(\d+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(text)) !== null) {
    const n = parseInt(m[1], 10);
    if (!seen.has(n)) {
      seen.add(n);
      result.push(n);
    }
  }
  return result;
}

describe('Citation Pipeline', () => {

  // ── Number consistency ──

  it('formatContext and buildCitations assign identical numbers for same chunks', () => {
    const chunks: MockChunk[] = [
      { sourceType: 'file_chunk', sourceId: '/docs/a.pdf', text: 'chunk 1' },
      { sourceType: 'file_chunk', sourceId: '/docs/b.md', text: 'chunk 2' },
      { sourceType: 'file_chunk', sourceId: '/docs/a.pdf', text: 'chunk 3 (same source)' },
    ];

    const contextMap = formatContextNumbers(chunks);
    const citationArr = buildCitationNumbers(chunks);

    // Both should produce 2 unique sources
    expect(contextMap.size).toBe(2);
    expect(citationArr.length).toBe(2);

    // Numbers should match
    for (const { key, index } of citationArr) {
      expect(contextMap.get(key)).toBe(index);
    }
  });

  it('numbering starts at 1 and increments', () => {
    const chunks: MockChunk[] = [
      { sourceType: 'page', sourceId: 'page-1', text: 'A' },
      { sourceType: 'page', sourceId: 'page-2', text: 'B' },
      { sourceType: 'file_chunk', sourceId: '/file.txt', text: 'C' },
    ];

    const citations = buildCitationNumbers(chunks);
    expect(citations.map(c => c.index)).toEqual([1, 2, 3]);
  });

  it('deduplicates chunks from the same source', () => {
    const chunks: MockChunk[] = [
      { sourceType: 'file_chunk', sourceId: '/doc.pdf', text: 'page 1' },
      { sourceType: 'file_chunk', sourceId: '/doc.pdf', text: 'page 5' },
      { sourceType: 'file_chunk', sourceId: '/doc.pdf', text: 'page 10' },
    ];

    const citations = buildCitationNumbers(chunks);
    expect(citations.length).toBe(1);
    expect(citations[0].index).toBe(1);
  });

  it('handles empty chunks', () => {
    expect(formatContextNumbers([]).size).toBe(0);
    expect(buildCitationNumbers([])).toEqual([]);
  });

  // ── Citation extraction ──

  it('extracts [N] numbers in first-appearance order', () => {
    const text = 'The policy covers liability [2] and collision [1]. See also [2][3].';
    expect(extractCitationNumbers(text)).toEqual([2, 1, 3]);
  });

  it('returns empty array for text without citations', () => {
    expect(extractCitationNumbers('No citations here.')).toEqual([]);
  });

  it('handles adjacent citations [1][2][3]', () => {
    const text = 'Multiple sources apply [1][2][3].';
    expect(extractCitationNumbers(text)).toEqual([1, 2, 3]);
  });

  // ── Remap logic ──

  it('remaps LLM-renumbered citations by first-appearance order', () => {
    // LLM used [1],[2],[3] but our sources are [1],[3],[5]
    const llmText = 'Info from [1] and [2]. Also [3].';
    const ourCitations = [
      { index: 1, uri: '/a.pdf', label: 'A' },
      { index: 3, uri: '/b.pdf', label: 'B' },
      { index: 5, uri: '/c.pdf', label: 'C' },
    ];

    const firstAppearance = extractCitationNumbers(llmText);
    // firstAppearance = [1, 2, 3]

    const sorted = [...ourCitations].sort((a, b) => a.index - b.index);
    // sorted indices: [1, 3, 5]

    const remap = new Map<number, number>();
    for (let i = 0; i < firstAppearance.length; i++) {
      remap.set(firstAppearance[i], sorted[i].index);
    }

    // [1] → 1, [2] → 3, [3] → 5
    expect(remap.get(1)).toBe(1);
    expect(remap.get(2)).toBe(3);
    expect(remap.get(3)).toBe(5);
  });

  it('no remap needed when LLM uses correct numbers', () => {
    const validIndices = new Set([1, 2, 3]);
    const referenced = extractCitationNumbers('See [1] and [3].');
    const unmatched = referenced.filter(n => !validIndices.has(n));
    expect(unmatched).toEqual([]);
  });

  it('detects unmatched citation references', () => {
    const validIndices = new Set([1, 2]);
    const referenced = extractCitationNumbers('Sources [1][2][5].');
    const unmatched = referenced.filter(n => !validIndices.has(n));
    expect(unmatched).toEqual([5]);
  });
});
