import { describe, expect, it, vi } from 'vitest';
import { CanonicalMemorySearchService } from '../../src/services/canonicalMemorySearchService';

describe('CanonicalMemorySearchService', () => {
  it('filters retrieval results to canonical memory files and maps layers', async () => {
    const retrievalService = {
      retrieve: vi.fn(async () => [
        {
          sourceType: 'file_chunk',
          sourceId: '.parallx/memory/MEMORY.md',
          contextPrefix: 'Durable memory',
          text: 'Structured brevity.',
          score: 0.9,
          sources: ['vector'],
          tokenCount: 3,
        },
        {
          sourceType: 'file_chunk',
          sourceId: '.parallx/memory/2026-03-12.md',
          contextPrefix: 'Daily memory',
          text: 'Today note.',
          score: 0.8,
          sources: ['vector'],
          tokenCount: 2,
        },
        {
          sourceType: 'file_chunk',
          sourceId: 'Claims Guide.md',
          contextPrefix: 'Claims Guide',
          text: 'Not memory.',
          score: 0.7,
          sources: ['vector'],
          tokenCount: 2,
        },
      ]),
    };
    const service = new CanonicalMemorySearchService(
      retrievalService as any,
      { isInitialIndexComplete: true } as any,
      {
        getDurableMemoryRelativePath: () => '.parallx/memory/MEMORY.md',
        getDailyMemoryRelativePath: (date?: Date) => `.parallx/memory/${date?.toISOString().slice(0, 10)}.md`,
      } as any,
    );

    const results = await service.search('memory');

    expect(results).toHaveLength(2);
    expect(results[0].layer).toBe('durable');
    expect(results[1].layer).toBe('daily');
    expect(results.some(result => result.sourceId === 'Claims Guide.md')).toBe(false);
    expect(retrievalService.retrieve).toHaveBeenCalledWith('memory', expect.objectContaining({
      sourceFilter: 'file_chunk',
      internalArtifactPolicy: 'include',
    }));
  });

  it('supports daily-layer filtering by explicit date', async () => {
    const service = new CanonicalMemorySearchService(
      {
        retrieve: vi.fn(async () => [
          {
            sourceType: 'file_chunk',
            sourceId: '.parallx/memory/2026-03-11.md',
            contextPrefix: 'Older daily memory',
            text: 'Older note.',
            score: 0.7,
            sources: ['vector'],
            tokenCount: 2,
          },
          {
            sourceType: 'file_chunk',
            sourceId: '.parallx/memory/2026-03-12.md',
            contextPrefix: 'Daily memory',
            text: 'Target note.',
            score: 0.8,
            sources: ['vector'],
            tokenCount: 2,
          },
        ]),
      } as any,
      { isInitialIndexComplete: true } as any,
      {
        getDurableMemoryRelativePath: () => '.parallx/memory/MEMORY.md',
        getDailyMemoryRelativePath: (date?: Date) => `.parallx/memory/${date?.toISOString().slice(0, 10)}.md`,
      } as any,
    );

    const results = await service.search('today', { layer: 'daily', date: '2026-03-12' });

    expect(results).toHaveLength(1);
    expect(results[0].sourceId).toBe('.parallx/memory/2026-03-12.md');
  });
});