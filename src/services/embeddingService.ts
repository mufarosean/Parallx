// embeddingService.ts — IEmbeddingService implementation (M10 Task 1.1)
//
// Wraps Ollama's /api/embed endpoint for local embedding generation.
// Uses nomic-embed-text v1.5 with mandatory task prefixes.
//
// Key design decisions:
//   - Batch endpoint only (/api/embed, NOT /api/embeddings)
//   - Task prefixes: 'search_document: ' for indexing, 'search_query: ' for retrieval
//   - Auto-pulls embedding model if not installed
//   - Content-hash-based caching avoids re-embedding unchanged content
//
// Ollama endpoint Used:
//   POST /api/embed  — batch embedding generation

import { Disposable } from '../platform/lifecycle.js';
import { Emitter } from '../platform/events.js';
import type { Event } from '../platform/events.js';
import type { IEmbeddingService } from './serviceTypes.js';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Default Ollama base URL. */
const DEFAULT_BASE_URL = 'http://localhost:11434';

/** Default embedding model. */
const DEFAULT_MODEL = 'nomic-embed-text';

/** Expected embedding dimensions for nomic-embed-text v1.5. */
const EXPECTED_DIMENSIONS = 768;

/** Timeout for individual embed requests. */
const EMBED_TIMEOUT_MS = 30_000;

/** Timeout for model pull operation. */
const PULL_TIMEOUT_MS = 600_000; // 10 minutes

/** Maximum batch size per /api/embed call. */
const MAX_BATCH_SIZE = 64;

// ─── Types ───────────────────────────────────────────────────────────────────

/** Task prefix type determines how embeddings are generated. */
export type EmbeddingTaskPrefix = 'search_document' | 'search_query' | 'clustering' | 'classification';

/** Response shape from POST /api/embed. */
interface OllamaEmbedResponse {
  model: string;
  embeddings: number[][];
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
}

/** Model info for UI display. */
export interface EmbeddingModelInfo {
  name: string;
  dimensions: number;
  installed: boolean;
}

// ─── EmbeddingService ────────────────────────────────────────────────────────

/**
 * Service that generates text embeddings via Ollama's /api/embed endpoint.
 *
 * Features:
 * - Batch embedding with automatic chunking into MAX_BATCH_SIZE groups
 * - Mandatory nomic-embed-text task prefixes (search_document, search_query)
 * - Auto-pull of embedding model if not installed
 * - In-memory cache keyed by content hash to avoid redundant API calls
 */
export class EmbeddingService extends Disposable implements IEmbeddingService {

  private readonly _baseUrl: string;
  private readonly _model: string;

  /** In-memory cache: contentHash → embedding vector. */
  private readonly _cache = new Map<string, number[]>();

  /** Whether the model is confirmed installed (avoids repeated checks). */
  private _modelVerified = false;

  // ── Events ──

  private readonly _onDidStartEmbedding = this._register(new Emitter<{ count: number }>());
  readonly onDidStartEmbedding: Event<{ count: number }> = this._onDidStartEmbedding.event;

  private readonly _onDidFinishEmbedding = this._register(new Emitter<{ count: number; durationMs: number }>());
  readonly onDidFinishEmbedding: Event<{ count: number; durationMs: number }> = this._onDidFinishEmbedding.event;

  constructor(baseUrl = DEFAULT_BASE_URL, model = DEFAULT_MODEL) {
    super();
    this._baseUrl = baseUrl;
    this._model = model;
  }

  // ── Public API ──

  /**
   * Embed a single text for storage (search_document prefix).
   * Uses the content hash for caching.
   *
   * @param text — raw text to embed (prefix is added automatically)
   * @param contentHash — optional content hash for cache lookup
   */
  async embedDocument(text: string, contentHash?: string): Promise<number[]> {
    if (contentHash) {
      const cached = this._cache.get(contentHash);
      if (cached) { return cached; }
    }

    const results = await this._embedBatch([`search_document: ${text}`]);
    const embedding = results[0];

    if (contentHash) {
      this._cache.set(contentHash, embedding);
    }

    return embedding;
  }

  /**
   * Embed a user query for retrieval (search_query prefix).
   * Queries are NOT cached (they're unique per request).
   *
   * @param query — the user's search/chat query
   */
  async embedQuery(query: string): Promise<number[]> {
    const results = await this._embedBatch([`search_query: ${query}`]);
    return results[0];
  }

  /**
   * Embed multiple texts in batch for storage.
   * Handles batching into MAX_BATCH_SIZE groups automatically.
   *
   * @param texts — array of raw texts (prefix is added automatically)
   * @param contentHashes — optional parallel array of content hashes
   * @returns parallel array of embedding vectors
   */
  async embedDocumentBatch(
    texts: string[],
    contentHashes?: string[],
    signal?: AbortSignal,
  ): Promise<number[][]> {
    if (texts.length === 0) { return []; }

    // Check cache for hits
    const results: (number[] | null)[] = new Array(texts.length).fill(null);
    const uncachedIndices: number[] = [];

    for (let i = 0; i < texts.length; i++) {
      const hash = contentHashes?.[i];
      if (hash) {
        const cached = this._cache.get(hash);
        if (cached) {
          results[i] = cached;
          continue;
        }
      }
      uncachedIndices.push(i);
    }

    if (uncachedIndices.length === 0) {
      return results as number[][];
    }

    // Prepare texts with prefix
    const prefixedTexts = uncachedIndices.map(
      (idx) => `search_document: ${texts[idx]}`,
    );

    // Batch embed
    const embeddings = await this._embedBatch(prefixedTexts, signal);

    // Merge results and update cache
    for (let j = 0; j < uncachedIndices.length; j++) {
      const originalIdx = uncachedIndices[j];
      results[originalIdx] = embeddings[j];

      const hash = contentHashes?.[originalIdx];
      if (hash) {
        this._cache.set(hash, embeddings[j]);
      }
    }

    return results as number[][];
  }

  /**
   * Get embedding model info.
   */
  getModelInfo(): EmbeddingModelInfo {
    return {
      name: this._model,
      dimensions: EXPECTED_DIMENSIONS,
      installed: this._modelVerified,
    };
  }

  /**
   * Clear the in-memory embedding cache.
   * Call when a full re-index is needed.
   */
  clearCache(): void {
    this._cache.clear();
  }

  /**
   * Number of cached embeddings (for diagnostics).
   */
  get cacheSize(): number {
    return this._cache.size;
  }

  /**
   * Ensure the embedding model is installed. Pulls if not.
   * Should be called once at startup before first embed call.
   *
   * @param signal — optional AbortSignal from the caller (e.g. pipeline).
   *   Combined with internal timeouts so cancellation is immediate.
   */
  async ensureModel(signal?: AbortSignal): Promise<void> {
    if (this._modelVerified) { return; }
    signal?.throwIfAborted();

    try {
      // Quick check: try a minimal embed call
      const fetchSignal = signal
        ? AbortSignal.any([signal, AbortSignal.timeout(EMBED_TIMEOUT_MS)])
        : AbortSignal.timeout(EMBED_TIMEOUT_MS);

      const response = await fetch(`${this._baseUrl}/api/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this._model,
          input: 'test',
        }),
        signal: fetchSignal,
      });

      if (response.ok) {
        this._modelVerified = true;
        console.log(`[EmbeddingService] Model "${this._model}" is available`);
        return;
      }

      // If 404 or model not found, try to pull
      if (response.status === 404 || response.status === 500) {
        await this._pullModel(signal);
        return;
      }

      throw new Error(`Ollama returned HTTP ${response.status}`);
    } catch (err) {
      // Re-throw abort / pull errors as-is
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw err;
      }
      if (err instanceof Error && err.message.includes('pull')) {
        throw err;
      }
      // Connection errors — Ollama might not be running
      throw new Error(
        `[EmbeddingService] Cannot connect to Ollama at ${this._baseUrl}. ` +
        `Is Ollama running? Error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // ── Internal ──

  /**
   * Core batch embedding call via /api/embed.
   * Splits into MAX_BATCH_SIZE groups if needed.
   */
  private async _embedBatch(prefixedTexts: string[], signal?: AbortSignal): Promise<number[][]> {
    await this.ensureModel(signal);

    const totalCount = prefixedTexts.length;
    this._onDidStartEmbedding.fire({ count: totalCount });
    const startTime = performance.now();

    const allEmbeddings: number[][] = [];

    // Process in chunks of MAX_BATCH_SIZE
    for (let i = 0; i < prefixedTexts.length; i += MAX_BATCH_SIZE) {
      signal?.throwIfAborted();
      const batch = prefixedTexts.slice(i, i + MAX_BATCH_SIZE);
      const embeddings = await this._callEmbedApi(batch, signal);
      allEmbeddings.push(...embeddings);
    }

    const durationMs = Math.round(performance.now() - startTime);
    this._onDidFinishEmbedding.fire({ count: totalCount, durationMs });

    return allEmbeddings;
  }

  /**
   * Single /api/embed API call.
   */
  private async _callEmbedApi(inputs: string[], signal?: AbortSignal): Promise<number[][]> {
    // Filter out empty inputs — Ollama rejects them with 400
    const cleanInputs = inputs.map((s) => s.trim() || 'empty');

    const body: Record<string, unknown> = {
      model: this._model,
      input: cleanInputs.length === 1 ? cleanInputs[0] : cleanInputs,
      truncate: true, // Silently truncate inputs exceeding model's context length
    };

    const response = await fetch(`${this._baseUrl}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(EMBED_TIMEOUT_MS)])
        : AbortSignal.timeout(EMBED_TIMEOUT_MS),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(
        `[EmbeddingService] /api/embed returned ${response.status}: ${errorText.slice(0, 200)}`,
      );
    }

    const data = (await response.json()) as OllamaEmbedResponse;

    // Validate dimensions
    if (data.embeddings.length > 0) {
      const dims = data.embeddings[0].length;
      if (dims !== EXPECTED_DIMENSIONS) {
        console.warn(
          `[EmbeddingService] Expected ${EXPECTED_DIMENSIONS} dimensions, got ${dims}. ` +
          `Check if the model "${this._model}" matches the vec_embeddings table schema.`,
        );
      }
    }

    return data.embeddings;
  }

  /**
   * Pull the embedding model from Ollama's registry.
   *
   * @param signal — optional caller-supplied AbortSignal so the pull can be
   *   cancelled immediately when the pipeline is disposed (e.g. workspace switch).
   */
  private async _pullModel(signal?: AbortSignal): Promise<void> {
    console.log(`[EmbeddingService] Pulling model "${this._model}"...`);
    signal?.throwIfAborted();

    const pullSignal = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(PULL_TIMEOUT_MS)])
      : AbortSignal.timeout(PULL_TIMEOUT_MS);

    const response = await fetch(`${this._baseUrl}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this._model, stream: false }),
      signal: pullSignal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(
        `[EmbeddingService] Failed to pull model "${this._model}": ${response.status} ${errorText}`,
      );
    }

    this._modelVerified = true;
    console.log(`[EmbeddingService] Model "${this._model}" pulled successfully`);
  }
}
