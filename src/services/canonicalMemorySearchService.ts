import { Disposable } from '../platform/lifecycle.js';
import type {
  ICanonicalMemorySearchResult,
  ICanonicalMemorySearchService,
  IIndexingPipelineService,
  IRetrievalService,
  IWorkspaceMemoryService,
} from './serviceTypes.js';

const MEMORY_ROOT = '.parallx/memory/';

function normalizeDate(date?: string): string | undefined {
  if (!date) {
    return undefined;
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(date.trim()) ? date.trim() : undefined;
}

export class CanonicalMemorySearchService extends Disposable implements ICanonicalMemorySearchService {
  constructor(
    private readonly _retrievalService: IRetrievalService,
    private readonly _indexingPipelineService: IIndexingPipelineService,
    private readonly _workspaceMemoryService: IWorkspaceMemoryService,
  ) {
    super();
  }

  isReady(): boolean {
    return this._indexingPipelineService.isInitialIndexComplete;
  }

  async search(
    query: string,
    options?: { layer?: 'all' | 'durable' | 'daily'; date?: string; topK?: number },
  ): Promise<ICanonicalMemorySearchResult[]> {
    const trimmed = query.trim();
    if (!trimmed) {
      return [];
    }

    const layer = options?.layer ?? 'all';
    const requestedDate = normalizeDate(options?.date);
    const durablePath = this._workspaceMemoryService.getDurableMemoryRelativePath();
    const requestedDailyPath = requestedDate
      ? this._workspaceMemoryService.getDailyMemoryRelativePath(new Date(`${requestedDate}T00:00:00.000Z`))
      : undefined;

    const chunks = await this._retrievalService.retrieve(trimmed, {
      sourceFilter: 'file_chunk',
      topK: options?.topK,
    });

    return chunks
      .filter((chunk) => chunk.sourceId.startsWith(MEMORY_ROOT))
      .filter((chunk) => {
        if (layer === 'durable') {
          return chunk.sourceId === durablePath;
        }
        if (layer === 'daily') {
          if (requestedDailyPath) {
            return chunk.sourceId === requestedDailyPath;
          }
          return chunk.sourceId !== durablePath;
        }
        return true;
      })
      .map((chunk) => ({
        sourceId: chunk.sourceId,
        contextPrefix: chunk.contextPrefix,
        text: chunk.text,
        score: chunk.score,
        layer: chunk.sourceId === durablePath ? 'durable' as const : 'daily' as const,
      }));
  }
}