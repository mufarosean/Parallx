// relatedContentService.test.ts — pin RelatedContentService.
//
// Pins:
//   - findRelated: returns [] when isInitialIndexComplete=false (no embed/search called)
//   - returns [] when page text is undefined (db has no row)
//   - vectorSearch called with: queryEmbedding, maxResults*3, sourceFilter
//     - sourceTypeFilter 'page' → 'page_block'
//     - sourceTypeFilter 'file' → 'file_chunk'
//     - omitted → undefined
//   - same-page page_block chunks are filtered out (sourceType='page_block' AND sourceId===pageId)
//     - File chunks with matching path do NOT filter (different sourceType)
//   - grouping: groups by `${sourceType}:${sourceId}`, totals score, counts chunks
//   - MIN_SCORE=0.3 filter — groups whose TOTAL score < 0.3 dropped
//   - sort desc by totalScore, then slice to maxResults
//   - default maxResults=8
//   - mapping: page_block → sourceType='page' with title via db; file_chunk → 'file' with basename
//   - basename: handles backslashes too
//   - page title fallback: 'Untitled' when title row missing
//   - onDidChangeRelated re-fires '*' when vectorStoreService.onDidUpdateIndex emits
//   - text content truncated to first 2000 chars before embedQuery

import { describe, it, expect, vi } from 'vitest';
import { RelatedContentService } from '../../src/services/relatedContentService';
import { Emitter } from '../../src/platform/events';

function tipTapText(text: string): string {
  return JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
}

function mkDeps(pages: Record<string, { title: string; content: string }>, indexComplete = true) {
  const onDidUpdateIndex = new Emitter<void>();
  const embed = vi.fn(async (_text: string) => [1, 2, 3]);
  const vectorSearch = vi.fn(async (_v: number[], _n: number, _f?: string): Promise<any[]> => []);
  return {
    embeddingService: { embedQuery: embed } as any,
    vectorStoreService: { onDidUpdateIndex: onDidUpdateIndex.event, vectorSearch } as any,
    db: {
      isOpen: true,
      get: vi.fn(async (sql: string, params: any[]) => {
        const id = params[0];
        if (sql.includes('FROM pages WHERE id = ? AND is_archived = 0')) {
          return pages[id] ? { content: pages[id].content, title: pages[id].title } : undefined;
        }
        if (sql.includes('SELECT title FROM pages WHERE id = ?')) {
          return pages[id] ? { title: pages[id].title } : undefined;
        }
        return undefined;
      }),
    } as any,
    indexingPipeline: { isInitialIndexComplete: indexComplete } as any,
    onDidUpdateIndex,
    embed,
    vectorSearch,
  };
}

function mkResult(over: Partial<any> = {}): any {
  return { sourceType: 'page_block', sourceId: 'p1', score: 0.5, text: '', chunkIndex: 0, ...over };
}

describe('RelatedContentService — guards', () => {
  it('returns [] when initial index not complete (no embed, no search)', async () => {
    const d = mkDeps({}, false);
    const svc = new RelatedContentService(d.embeddingService, d.vectorStoreService, d.db, d.indexingPipeline);
    expect(await svc.findRelated('p1')).toEqual([]);
    expect(d.embed).not.toHaveBeenCalled();
    expect(d.vectorSearch).not.toHaveBeenCalled();
  });

  it('returns [] when page text is missing', async () => {
    const d = mkDeps({});
    const svc = new RelatedContentService(d.embeddingService, d.vectorStoreService, d.db, d.indexingPipeline);
    expect(await svc.findRelated('missing')).toEqual([]);
    expect(d.vectorSearch).not.toHaveBeenCalled();
  });
});

describe('RelatedContentService — vectorSearch args', () => {
  const pages = { p1: { title: 'Page 1', content: tipTapText('hello world') } };

  it('default maxResults=8 → vectorSearch n=24, filter undefined', async () => {
    const d = mkDeps(pages);
    const svc = new RelatedContentService(d.embeddingService, d.vectorStoreService, d.db, d.indexingPipeline);
    await svc.findRelated('p1');
    expect(d.vectorSearch).toHaveBeenCalledTimes(1);
    const [, n, filter] = d.vectorSearch.mock.calls[0];
    expect(n).toBe(24);
    expect(filter).toBeUndefined();
  });

  it('sourceTypeFilter=page → "page_block"; file → "file_chunk"', async () => {
    const d = mkDeps(pages);
    const svc = new RelatedContentService(d.embeddingService, d.vectorStoreService, d.db, d.indexingPipeline);
    await svc.findRelated('p1', { sourceTypeFilter: 'page' });
    expect(d.vectorSearch.mock.calls[0][2]).toBe('page_block');
    await svc.findRelated('p1', { sourceTypeFilter: 'file' });
    expect(d.vectorSearch.mock.calls[1][2]).toBe('file_chunk');
  });

  it('maxResults=2 → vectorSearch n=6', async () => {
    const d = mkDeps(pages);
    const svc = new RelatedContentService(d.embeddingService, d.vectorStoreService, d.db, d.indexingPipeline);
    await svc.findRelated('p1', { maxResults: 2 });
    expect(d.vectorSearch.mock.calls[0][1]).toBe(6);
  });

  it('embedQuery receives title+\\n+text (truncated to 2000 chars)', async () => {
    const d = mkDeps(pages);
    const svc = new RelatedContentService(d.embeddingService, d.vectorStoreService, d.db, d.indexingPipeline);
    await svc.findRelated('p1');
    expect(d.embed).toHaveBeenCalledTimes(1);
    const arg = d.embed.mock.calls[0][0] as string;
    expect(arg).toBe('Page 1\nhello world');
    expect(arg.length).toBeLessThanOrEqual(2000);
  });
});

describe('RelatedContentService — same-page filtering', () => {
  const pages = {
    p1: { title: 'Page 1', content: tipTapText('a') },
    p2: { title: 'Page 2', content: tipTapText('b') },
  };

  it('filters page_block chunks whose sourceId===queried pageId', async () => {
    const d = mkDeps(pages);
    d.vectorSearch.mockResolvedValueOnce([
      mkResult({ sourceType: 'page_block', sourceId: 'p1', score: 0.9 }), // same page — filtered
      mkResult({ sourceType: 'page_block', sourceId: 'p2', score: 0.7 }),
    ]);
    const svc = new RelatedContentService(d.embeddingService, d.vectorStoreService, d.db, d.indexingPipeline);
    const out = await svc.findRelated('p1');
    expect(out.length).toBe(1);
    expect(out[0].sourceId).toBe('p2');
  });

  it('does NOT filter file_chunk with matching id (different sourceType)', async () => {
    const d = mkDeps(pages);
    d.vectorSearch.mockResolvedValueOnce([
      mkResult({ sourceType: 'file_chunk', sourceId: 'p1', score: 0.5 }), // not filtered
    ]);
    const svc = new RelatedContentService(d.embeddingService, d.vectorStoreService, d.db, d.indexingPipeline);
    const out = await svc.findRelated('p1');
    expect(out.length).toBe(1);
    expect(out[0].sourceType).toBe('file');
  });
});

describe('RelatedContentService — grouping + ranking', () => {
  it('groups by sourceType:sourceId, totals score + count, sorts desc', async () => {
    const d = mkDeps({ p1: { title: 'P1', content: tipTapText('x') }, p2: { title: 'P2', content: tipTapText('y') }, p3: { title: 'P3', content: tipTapText('z') } });
    d.vectorSearch.mockResolvedValueOnce([
      mkResult({ sourceId: 'p2', score: 0.2 }),
      mkResult({ sourceId: 'p2', score: 0.3 }),
      mkResult({ sourceId: 'p3', score: 0.9 }),
    ]);
    const svc = new RelatedContentService(d.embeddingService, d.vectorStoreService, d.db, d.indexingPipeline);
    const out = await svc.findRelated('p1');
    expect(out.length).toBe(2);
    expect(out[0].sourceId).toBe('p3');
    expect(out[0].score).toBeCloseTo(0.9, 5);
    expect(out[0].matchingChunks).toBe(1);
    expect(out[1].sourceId).toBe('p2');
    expect(out[1].score).toBeCloseTo(0.5, 5);
    expect(out[1].matchingChunks).toBe(2);
  });

  it('drops groups whose TOTAL score < MIN_SCORE 0.3', async () => {
    const d = mkDeps({ p1: { title: 'P1', content: tipTapText('x') }, p2: { title: 'P2', content: tipTapText('y') } });
    d.vectorSearch.mockResolvedValueOnce([
      mkResult({ sourceId: 'p2', score: 0.29 }), // below cutoff
    ]);
    const svc = new RelatedContentService(d.embeddingService, d.vectorStoreService, d.db, d.indexingPipeline);
    expect(await svc.findRelated('p1')).toEqual([]);
  });

  it('respects maxResults slice AFTER sort', async () => {
    const pages: Record<string, { title: string; content: string }> = { p1: { title: 'P1', content: tipTapText('x') } };
    for (let i = 2; i <= 11; i++) pages[`p${i}`] = { title: `P${i}`, content: tipTapText('y') };
    const d = mkDeps(pages);
    d.vectorSearch.mockResolvedValueOnce(
      Array.from({ length: 10 }, (_, i) => mkResult({ sourceId: `p${i + 2}`, score: 1 - i * 0.05 })),
    );
    const svc = new RelatedContentService(d.embeddingService, d.vectorStoreService, d.db, d.indexingPipeline);
    const out = await svc.findRelated('p1', { maxResults: 3 });
    expect(out.length).toBe(3);
    expect(out.map((r) => r.sourceId)).toEqual(['p2', 'p3', 'p4']);
  });
});

describe('RelatedContentService — label resolution', () => {
  it('page result → label is page title from db', async () => {
    const d = mkDeps({
      p1: { title: 'Self', content: tipTapText('q') },
      p2: { title: 'Friend Title', content: tipTapText('') },
    });
    d.vectorSearch.mockResolvedValueOnce([mkResult({ sourceId: 'p2', score: 0.8 })]);
    const svc = new RelatedContentService(d.embeddingService, d.vectorStoreService, d.db, d.indexingPipeline);
    const out = await svc.findRelated('p1');
    expect(out[0].label).toBe('Friend Title');
  });

  it('page result with missing title row → "Untitled"', async () => {
    const d = mkDeps({ p1: { title: 'Self', content: tipTapText('q') } });
    d.vectorSearch.mockResolvedValueOnce([mkResult({ sourceId: 'orphan', score: 0.8 })]);
    const svc = new RelatedContentService(d.embeddingService, d.vectorStoreService, d.db, d.indexingPipeline);
    const out = await svc.findRelated('p1');
    expect(out[0].label).toBe('Untitled');
  });

  it('file result → label is basename (handles both / and \\)', async () => {
    const d = mkDeps({ p1: { title: 'Self', content: tipTapText('q') } });
    d.vectorSearch.mockResolvedValueOnce([
      mkResult({ sourceType: 'file_chunk', sourceId: '/abs/dir/foo.ts', score: 0.6 }),
      mkResult({ sourceType: 'file_chunk', sourceId: 'C:\\Users\\x\\bar.md', score: 0.5 }),
    ]);
    const svc = new RelatedContentService(d.embeddingService, d.vectorStoreService, d.db, d.indexingPipeline);
    const out = await svc.findRelated('p1');
    const byScore = [...out].sort((a, b) => b.score - a.score);
    expect(byScore[0].label).toBe('foo.ts');
    expect(byScore[1].label).toBe('bar.md');
    expect(byScore[0].sourceType).toBe('file');
  });
});

describe('RelatedContentService — onDidChangeRelated', () => {
  it("re-fires '*' when vectorStore index updates", () => {
    const d = mkDeps({});
    const svc = new RelatedContentService(d.embeddingService, d.vectorStoreService, d.db, d.indexingPipeline);
    const events: string[] = [];
    svc.onDidChangeRelated((id) => events.push(id));
    d.onDidUpdateIndex.fire();
    d.onDidUpdateIndex.fire();
    expect(events).toEqual(['*', '*']);
  });
});
