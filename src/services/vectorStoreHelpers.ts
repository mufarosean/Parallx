// vectorStoreHelpers.ts — the pure parts of the vector store.
//
// A vector as the bytes sqlite-vec stores, a query as FTS5 accepts it (the
// stopwords, the quoting), and the rank fusion that merges the keyword and
// the vector lists into one. No database here; vectorStoreService.ts owns
// that and calls these.

import type { RetrievalExtractionPipeline, SearchResult } from './vectorStoreService.js';

export interface VectorRow {
  rowid: number;
  distance?: number;
  source_type: string;
  source_id: string;
  chunk_index: string | number;
  chunk_text: string;
  context_prefix: string;
  heading_path?: string;
  parent_heading_path?: string;
  structural_role?: string;
  document_kind?: string;
  extraction_pipeline?: RetrievalExtractionPipeline;
  extraction_fallback?: number | boolean | null;
  classification_confidence?: number;
  classification_reason?: string;
}

export function toBoolean(value: number | boolean | null | undefined): boolean | undefined {
  if (value === null || value === undefined) { return undefined; }
  return typeof value === 'boolean' ? value : value !== 0;
}

/**
 * The least cosine similarity a chunk needs to reach the AI, unless AI
 * Settings say otherwise (retrieval.minRelevance). A starting point for
 * nomic-embed-text v1.5, not a measured one: each search's trace records the
 * best similarity it saw, so the floor can be tuned against real questions.
 */
export const DEFAULT_MIN_RELEVANCE = 0.5;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Convert a number[] embedding to a binary buffer for sqlite-vec.
 * sqlite-vec expects embeddings as raw Float32Array bytes.
 */
export function float32ArrayToBuffer(embedding: number[]): Uint8Array {
  const f32 = new Float32Array(embedding);
  // Create a standalone copy — do NOT share the Float32Array's backing
  // ArrayBuffer, as Electron IPC structured clone may truncate or
  // misalign views on shared buffers.
  const bytes = new Uint8Array(f32.byteLength);
  bytes.set(new Uint8Array(f32.buffer));
  return bytes;
}

export function normalizeVectorInPlace(vector: number[]): void {
  let sumSq = 0;
  for (const value of vector) {
    sumSq += value * value;
  }
  if (sumSq <= 0) {
    return;
  }
  const invNorm = 1 / Math.sqrt(sumSq);
  for (let i = 0; i < vector.length; i++) {
    vector[i] *= invNorm;
  }
}

/**
 * Common English stopwords that add noise to keyword search.
 * These appear in nearly every document and dilute BM25 relevance.
 *
 * Removed domain-useful words (page, section, table, figure, note,
 * chapter, book, part, example, find, show, help, use, work, read, look,
 * call, give) that carry meaning in knowledge-base search contexts.
 */
export const FTS5_STOPWORDS = new Set([
  // articles, prepositions, conjunctions
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
  'on', 'with', 'at', 'by', 'from', 'as', 'into', 'about', 'between',
  'through', 'after', 'before', 'up', 'down', 'out', 'off', 'over',
  'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when',
  'where', 'why', 'how', 'all', 'each', 'every', 'both', 'few', 'more',
  'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own',
  'same', 'so', 'than', 'too', 'very', 'just', 'because', 'but', 'and',
  'or', 'if', 'while', 'what', 'which', 'who', 'whom', 'this', 'that',
  'these', 'those', 'am', 'it', 'its',
  // pronouns
  'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'him', 'his',
  'she', 'her', 'they', 'them', 'their',
  // common verbs & fillers that appear everywhere but carry no search value
  'tell', 'talk', 'make', 'know', 'think', 'want', 'need',
  'get', 'go', 'come', 'take', 'say', 'ask', 'try',
  'based', 'using', 'see', 'also', 'like', 'number', 'numbers',
]);

/**
 * Check if a word is a stopword, with simple de-pluralisation.
 * "books" → strip 's' → "book" → in stopword set → true.
 * Prevents common plurals from polluting keyword search.
 */
export function isStopword(word: string): boolean {
  const w = word.toLowerCase();
  if (FTS5_STOPWORDS.has(w)) { return true; }
  // Simple de-plural: strip trailing 's' (not 'ss' — "less", "pass")
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) {
    return FTS5_STOPWORDS.has(w.slice(0, -1));
  }
  return false;
}

/**
 * Sanitize a user query for FTS5 MATCH syntax.
 *
 * Uses AND semantics (implicit in FTS5) so that multi-term queries match only
 * documents containing ALL content terms, dramatically reducing noise.
 *
 * The vector similarity path provides broad recall — the keyword path's job is
 * precision.  When AND is too strict and returns nothing, the vector results
 * still come through via score compensation in search().
 *
 * Stopwords are filtered with simple de-pluralisation ("books" → "book" →
 * stopword) to prevent common words from polluting results.
 *
 * FTS5 treats space-separated quoted terms as implicit AND:
 *   "FSI" "Shona" "vocabulary" → matches docs containing ALL three terms
 *
 * Reference: https://www.sqlite.org/fts5.html, section 3
 */
export function sanitizeFts5Query(query: string): string {
  // Remove FTS5 special chars, wrap individual terms in quotes
  const cleaned = query
    .replace(/[*"():^~{}[\]]/g, ' ')
    .trim();

  if (!cleaned) { return ''; }

  // Split into words
  const allTerms = cleaned.split(/\s+/).filter(Boolean);
  if (allTerms.length === 0) { return ''; }

  // Filter out stopwords (with de-pluralisation) — keep only content-bearing terms
  const contentTerms = allTerms.filter((t) => !isStopword(t));

  // If ALL terms were stopwords, keep the originals to avoid empty query
  const terms = contentTerms.length > 0 ? contentTerms : allTerms;

  // Single term → just wrap in quotes
  if (terms.length === 1) {
    return `"${terms[0]}"`;
  }

  // AND semantics (implicit in FTS5 — space-separated quoted terms).
  // The vector path handles recall; the keyword path adds precision.
  return terms.map((t) => `"${t}"`).join(' ');
}

/**
 * Reciprocal Rank Fusion — merges multiple ranked result lists.
 *
 * Formula: RRF(d) = Σ 1/(k + rank(d))
 * Source: Cormack, Clarke & Butt (2009), SIGIR
 *
 * @param rankedLists — map of list name → ordered results
 * @param k — smoothing constant (default 60)
 * @param topN — max results to return
 */
export function reciprocalRankFusion(
  rankedLists: Map<string, VectorRow[]>,
  k: number,
  topN: number,
): SearchResult[] {
  const scores = new Map<number, SearchResult>();

  for (const [listName, results] of rankedLists) {
    for (let rank = 0; rank < results.length; rank++) {
      const row = results[rank];
      const contribution = 1 / (k + rank + 1); // rank is 0-based → +1

      const existing = scores.get(row.rowid);
      if (existing) {
        existing.score += contribution;
        existing.sources.push(listName);
      } else {
        scores.set(row.rowid, {
          rowid: row.rowid,
          sourceType: row.source_type,
          sourceId: row.source_id,
          chunkIndex: Number(row.chunk_index),
          chunkText: row.chunk_text,
          contextPrefix: row.context_prefix,
          score: contribution,
          similarity: typeof row.distance === 'number' ? 1 - row.distance : undefined,
          sources: [listName],
          headingPath: row.heading_path,
          parentHeadingPath: row.parent_heading_path,
          structuralRole: row.structural_role,
          documentKind: row.document_kind,
          extractionPipeline: row.extraction_pipeline,
          extractionFallback: toBoolean(row.extraction_fallback),
          classificationConfidence: row.classification_confidence,
          classificationReason: row.classification_reason,
        });
      }
    }
  }

  return Array.from(scores.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
}
