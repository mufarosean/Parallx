// memoryService.ts — IMemoryService implementation (M10 Tasks 5.1 + 5.2)
//
// Conversation Memory (Task 5.1):
//   After a session reaches a message threshold, summarise it via the LLM,
//   embed the summary, and store it in the vector index with
//   source_type='memory'. On new sessions, relevant memories are retrieved
//   and injected as context so the AI recalls past conversations.
//
// User Preference Learning (Task 5.2):
//   Detect and persist preference statements from conversations
//   (e.g. "I prefer TypeScript"). Stored as key-value pairs in SQLite
//   and optionally embedded for semantic retrieval.
//
// References:
//   - docs/Parallx_Milestone_10.md Phase 5 Tasks 5.1, 5.2

import { Disposable } from '../platform/lifecycle.js';
import { Emitter } from '../platform/events.js';
import type { Event } from '../platform/events.js';
import type {
  IDatabaseService,
  IEmbeddingService,
  IVectorStoreService,
  IMemoryService,
} from './serviceTypes.js';
import type { EmbeddedChunk } from './vectorStoreService.js';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Minimum number of message pairs before a session is eligible for summarisation. */
const MIN_MESSAGES_FOR_SUMMARY = 2;

// M81 Phase 4 — MAX_PREFERENCE_VALUE_LENGTH removed (used only by the now-deleted
// extractAndStorePreferences regex pipeline).

/** Maximum memories to retrieve for context injection. */
const DEFAULT_MEMORY_TOP_K = 5;

/** Token budget for injected memory context. */
const DEFAULT_MEMORY_TOKEN_BUDGET = 1500;

/** Source type used in the vector store for memory entries. */
const MEMORY_SOURCE_TYPE = 'memory';

// M81 Phase 3 Stage 2 — CONCEPT_SOURCE_TYPE / DEFAULT_CONCEPT_TOP_K /
// DEFAULT_CONCEPT_TOKEN_BUDGET removed. Concept curation now flows through
// the agent's `memory_edit` tool writing free-form markdown to MEMORY.md.

/** Decay rate constant — half-life ≈ 23 days. */
const DECAY_LAMBDA = 0.03;

/** Eviction: session memories older than this with low decay are removed. */
const MEMORY_EVICTION_DAYS = 90;

/** Rough token estimator: chars / 4 (same as other services). */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// M81 Phase 4 — detectPreferences regex extractor removed alongside the
// extractPreferences pipeline. Preferences are now agent-authored via
// `memory_edit` (USER.md for user-scoped, MEMORY.md for project-scoped).

// M81 Phase 3 Stage 2 — formatConceptContextBlock removed; concepts no longer
// have a structured retrieval lane. Agent-curated facts in MEMORY.md surface
// per-turn via the standard RAG retrieval lane.

/**
 * Compute exponential decay score (M17 P1.3 Task 1.3.3).
 *
 *   decay_score = baseImportance × exp(-λ × daysSinceLastAccess)
 */
export function computeDecayScore(lastAccessed: string, baseImportance: number): number {
  const days = (Date.now() - new Date(lastAccessed).getTime()) / (1000 * 60 * 60 * 24);
  return baseImportance * Math.exp(-DECAY_LAMBDA * Math.max(0, days));
}

/** Simple SHA-256 hash for content dedup. */
async function hashContent(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ─── Types ───────────────────────────────────────────────────────────────────

/** A stored conversation memory. */
export interface ConversationMemory {
  /** Session ID that this memory is derived from. */
  sessionId: string;
  /** LLM-generated summary of the conversation. */
  summary: string;
  /** When the memory was created. */
  createdAt: string;
  /** Number of message pairs in the original session. */
  messageCount: number;
}

/** A stored user preference. */
export interface UserPreference {
  /** Preference key (e.g. 'preferred_language', 'formatting_style'). */
  key: string;
  /** Preference value (e.g. 'TypeScript', 'Always use H2 headings'). */
  value: string;
  /** When it was first detected. */
  createdAt: string;
  /** When it was last confirmed/updated. */
  updatedAt: string;
  /** Number of times the preference has been expressed. */
  frequency: number;
}

// M81 Phase 3 Stage 2 — LearningConcept interface removed; the regex-based
// concept extraction it backed was replaced by agent-curated `memory_edit`.

/** Options for memory retrieval. */
export interface MemoryRetrievalOptions {
  /** Max memories to retrieve (default: 5). */
  topK?: number;
  /** Token budget for memory context (default: 1500). */
  tokenBudget?: number;
}

// ─── SQL Schema (created on first use) ───────────────────────────────────────

const CREATE_MEMORIES_TABLE = `
CREATE TABLE IF NOT EXISTS conversation_memories (
  session_id     TEXT PRIMARY KEY,
  summary        TEXT    NOT NULL,
  message_count  INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  last_accessed  TEXT    NOT NULL DEFAULT (datetime('now')),
  importance     REAL    NOT NULL DEFAULT 0.5,
  decay_score    REAL    NOT NULL DEFAULT 1.0
)`;

// M81 Phase 3 Stage 2 — `learning_concepts` SQL table + indexes removed.
// Existing rows in upgraded DBs are stranded but harmless (no writer / no
// reader references them). Idle rows can be dropped by a future migration
// if disk footprint becomes a concern.

const CREATE_PREFERENCES_TABLE = `
CREATE TABLE IF NOT EXISTS user_preferences (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  frequency  INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)`;

// ─── MemoryService ───────────────────────────────────────────────────────────

/**
 * Manages conversation memory and user preferences.
 *
 * Memory flow:
 *   1. When a session is summarised (via `summariseSession()`), the summary
 *      is embedded and stored in the vector index as source_type='memory'.
 *   2. On new sessions, `recallMemories(query)` retrieves relevant past
 *      conversation summaries via hybrid search.
 *   3. `formatMemoryContext()` produces a readable block for injection.
 *
 * Preference flow (M81 Phase 4):
 *   - Preference writes are agent-driven via `memory_edit` (USER.md / MEMORY.md).
 *   - This service still owns the `user_preferences` SQL table for legacy
 *     callers; `getPreferences()` and `formatPreferencesForPrompt()` read from
 *     it. The regex `extractAndStorePreferences` writer was removed.
 */
export class MemoryService extends Disposable implements IMemoryService {

  private readonly _db: IDatabaseService;
  private readonly _embeddingService: IEmbeddingService;
  private readonly _vectorStore: IVectorStoreService;

  private _initialized = false;

  private readonly _onDidUpdateMemory = this._register(new Emitter<string>());
  readonly onDidUpdateMemory: Event<string> = this._onDidUpdateMemory.event;

  private readonly _onDidUpdatePreferences = this._register(new Emitter<UserPreference>());
  readonly onDidUpdatePreferences: Event<UserPreference> = this._onDidUpdatePreferences.event;

  constructor(
    db: IDatabaseService,
    embeddingService: IEmbeddingService,
    vectorStore: IVectorStoreService,
  ) {
    super();
    this._db = db;
    this._embeddingService = embeddingService;
    this._vectorStore = vectorStore;
  }

  // ── Initialisation ──

  private async _ensureInitialized(): Promise<void> {
    if (this._initialized) { return; }
    if (!this._db.isOpen) { return; }

    await this._db.run(CREATE_MEMORIES_TABLE);
    await this._db.run(CREATE_PREFERENCES_TABLE);

    // M17 Task 1.1.1: Migrate existing DBs — add updated_at if missing
    try {
      await this._db.run(
        `ALTER TABLE conversation_memories ADD COLUMN updated_at TEXT NOT NULL DEFAULT (datetime('now'))`,
      );
    } catch {
      // Column already exists — ignore
    }

    // M17 P1.3 Task 1.3.1: Migrate — add last_accessed, importance, decay_score to conversation_memories
    for (const alter of [
      `ALTER TABLE conversation_memories ADD COLUMN last_accessed TEXT NOT NULL DEFAULT (datetime('now'))`,
      `ALTER TABLE conversation_memories ADD COLUMN importance REAL NOT NULL DEFAULT 0.5`,
      `ALTER TABLE conversation_memories ADD COLUMN decay_score REAL NOT NULL DEFAULT 1.0`,
    ]) {
      try { await this._db.run(alter); } catch { /* already exists */ }
    }

    this._initialized = true;
  }

  // ── Conversation Memory (Task 5.1) ──

  /**
   * Check whether a session has enough messages to be worth summarising.
   */
  isSessionEligibleForSummary(messageCount: number): boolean {
    return messageCount >= MIN_MESSAGES_FOR_SUMMARY;
  }

  /**
   * Check whether a session has already been summarised.
   */
  async hasMemory(sessionId: string): Promise<boolean> {
    await this._ensureInitialized();
    const row = await this._db.get<{ session_id: string }>(
      'SELECT session_id FROM conversation_memories WHERE session_id = ?',
      [sessionId],
    );
    return !!row;
  }

  /**
   * Get the message count stored with the last summary for a session.
   * Returns `null` if no memory exists yet.
   *
   * Used by the growth-based re-summarization guard (M17 Task 1.1.2):
   * if current message count ≥ stored × 2, or ≥ stored + 10, re-summarize.
   */
  async getMemoryMessageCount(sessionId: string): Promise<number | null> {
    await this._ensureInitialized();
    const row = await this._db.get<{ message_count: number }>(
      'SELECT message_count FROM conversation_memories WHERE session_id = ?',
      [sessionId],
    );
    return row ? row.message_count : null;
  }

  /**
   * Store a conversation summary into the database and vector index.
   *
   * This is called by the chat layer after the LLM produces a summary.
   * The summary is embedded and stored with source_type='memory' so it
   * can be retrieved via hybrid search alongside page/file content.
   *
   * @param sessionId — the chat session that was summarised
   * @param summary — LLM-generated conversation summary text
   * @param messageCount — how many message pairs were in the session
   */
  async storeMemory(
    sessionId: string,
    summary: string,
    messageCount: number,
  ): Promise<void> {
    await this._ensureInitialized();

    // 1. Store in relational table (INSERT OR REPLACE handles both create + update)
    await this._db.run(
      `INSERT OR REPLACE INTO conversation_memories(session_id, summary, message_count, created_at, updated_at, last_accessed, importance, decay_score)
       VALUES (?, ?, ?, COALESCE((SELECT created_at FROM conversation_memories WHERE session_id = ?), datetime('now')), datetime('now'), datetime('now'), 0.5, 1.0)`,
      [sessionId, summary, messageCount, sessionId],
    );

    // 2. Embed the summary and store in vector index
    const contentHash = await hashContent(summary);
    const embedding = await this._embeddingService.embedDocument(summary);

    const chunk: EmbeddedChunk = {
      sourceType: MEMORY_SOURCE_TYPE as 'page_block' | 'file_chunk',
      sourceId: sessionId,
      chunkIndex: 0,
      text: summary,
      contextPrefix: `[Conversation Memory — Session ${sessionId.slice(0, 8)}]`,
      contentHash,
      embedding,
    };

    await this._vectorStore.upsert(MEMORY_SOURCE_TYPE, sessionId, [chunk], contentHash);

    this._onDidUpdateMemory.fire(sessionId);
  }

  /**
   * Retrieve relevant conversation memories for a query.
   *
   * Uses hybrid search (vector + keyword) on the vector index,
   * filtered to source_type='memory'.
   *
   * M17 P1.3: Updates last_accessed on recalled rows, applies decay-weighted re-ranking.
   */
  async recallMemories(
    query: string,
    options?: MemoryRetrievalOptions,
  ): Promise<ConversationMemory[]> {
    await this._ensureInitialized();

    if (!query.trim()) { return []; }

    const topK = options?.topK ?? DEFAULT_MEMORY_TOP_K;
    const tokenBudget = options?.tokenBudget ?? DEFAULT_MEMORY_TOKEN_BUDGET;

    // Embed query for vector search
    const queryEmbedding = await this._embeddingService.embedQuery(query);

    // Hybrid search filtered to memory source type
    const results = await this._vectorStore.search(queryEmbedding, query, {
      topK: topK * 2, // Over-fetch for token budget + decay filtering
      sourceFilter: MEMORY_SOURCE_TYPE,
      includeKeyword: true,
    });

    // Enrich with metadata + apply decay-weighted re-ranking (P1.3 Task 1.3.4)
    type ScoredMemory = { memory: ConversationMemory; adjustedScore: number };
    const scored: ScoredMemory[] = [];
    for (const r of results) {
      const meta = await this._db.get<{
        session_id: string; summary: string; message_count: number;
        created_at: string; last_accessed: string; importance: number; decay_score: number;
      }>(
        'SELECT session_id, summary, message_count, created_at, last_accessed, importance, decay_score FROM conversation_memories WHERE session_id = ?',
        [r.sourceId],
      );
      if (!meta) { continue; }

      // Recompute live decay score
      const liveDecay = computeDecayScore(meta.last_accessed || meta.created_at, meta.importance || 0.5);
      const adjustedScore = r.score * (0.5 + 0.5 * liveDecay);

      scored.push({
        memory: {
          sessionId: meta.session_id,
          summary: meta.summary,
          messageCount: meta.message_count,
          createdAt: meta.created_at,
        },
        adjustedScore,
      });
    }

    // Sort by decay-adjusted score descending
    scored.sort((a, b) => b.adjustedScore - a.adjustedScore);

    // Apply token budget
    let tokensUsed = 0;
    const memories: ConversationMemory[] = [];
    for (const s of scored) {
      if (memories.length >= topK) { break; }
      const tokens = estimateTokens(s.memory.summary);
      if (tokensUsed + tokens > tokenBudget && memories.length > 0) { break; }
      memories.push(s.memory);
      tokensUsed += tokens;
    }

    // Update last_accessed for recalled rows (P1.3 Task 1.3.2)
    for (const mem of memories) {
      this._db.run(
        'UPDATE conversation_memories SET last_accessed = datetime(\'now\') WHERE session_id = ?',
        [mem.sessionId],
      ).catch((e) => { console.error('[MemoryService] Failed to update last_accessed:', e); });
    }

    return memories;
  }

  /**
   * Format retrieved memories for injection into a chat message.
   */
  formatMemoryContext(memories: ConversationMemory[]): string {
    if (memories.length === 0) { return ''; }

    const lines: string[] = ['[Conversation Memory]'];

    for (const mem of memories) {
      lines.push('---');
      lines.push(`Previous session (${mem.createdAt}):`);
      lines.push(mem.summary);
    }

    lines.push('---');
    return lines.join('\n');
  }

  /**
   * Get all stored memories (for admin/debug views).
   */
  async getAllMemories(): Promise<ConversationMemory[]> {
    await this._ensureInitialized();
    const rows = await this._db.all<{ session_id: string; summary: string; message_count: number; created_at: string }>(
      'SELECT session_id, summary, message_count, created_at FROM conversation_memories ORDER BY created_at DESC',
    );
    return rows.map((r) => ({
      sessionId: r.session_id,
      summary: r.summary,
      messageCount: r.message_count,
      createdAt: r.created_at,
    }));
  }

  // ── Concept-Level Memory (M17 P1.2) ──

  // M81 Phase 3 Stage 2 — storeConcepts / recallConcepts / formatConceptContext
  // removed. These backed the auto-extraction pipeline that's been replaced by
  // agent-curated `memory_edit` writes. The `learning_concepts` SQL table and
  // 'concept' vector-store source type are also gone.

  // ── User Preference Learning (Task 5.2) ──
  // M81 Phase 4 — extractAndStorePreferences removed. The regex pipeline that
  // backed it (detectPreferences + the chatDataService.extractPreferences
  // wrapper + the queueMemoryWriteBack caller) is gone in favor of agent-
  // authored writes through `memory_edit`. The read methods (getPreferences /
  // formatPreferencesForPrompt / deletePreference) stay because the
  // `user_preferences` SQL table is still consulted by the legacy SQLite
  // memory path for older workspaces that haven't migrated to MEMORY.md.

  /**
   * Get all stored user preferences, ordered by frequency (most confirmed first).
   */
  async getPreferences(): Promise<UserPreference[]> {
    await this._ensureInitialized();
    const rows = await this._db.all<{ key: string; value: string; frequency: number; created_at: string; updated_at: string }>(
      'SELECT key, value, frequency, created_at, updated_at FROM user_preferences ORDER BY frequency DESC, updated_at DESC',
    );
    return rows.map((r) => ({
      key: r.key,
      value: r.value,
      frequency: r.frequency,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  /**
   * Format stored preferences for injection into the system prompt.
   * Only includes preferences with frequency >= 2 (confirmed at least twice)
   * or the most recent 5 if fewer have been confirmed.
   */
  formatPreferencesForPrompt(preferences: UserPreference[]): string {
    if (preferences.length === 0) { return ''; }

    // Prefer confirmed preferences (frequency >= 2), fall back to recent ones
    const confirmed = preferences.filter((p) => p.frequency >= 2);
    const toInclude = confirmed.length > 0
      ? confirmed.slice(0, 10)
      : preferences.slice(0, 5);

    if (toInclude.length === 0) { return ''; }

    const lines = ['User preferences (learned from past conversations):'];
    for (const p of toInclude) {
      lines.push(`- ${p.key}: ${p.value}`);
    }
    return lines.join('\n');
  }

  /**
   * Delete a specific preference by key.
   */
  async deletePreference(key: string): Promise<void> {
    await this._ensureInitialized();
    await this._db.run('DELETE FROM user_preferences WHERE key = ?', [key]);
  }

  /** Delete a specific memory by session ID (M20 F.2). */
  async deleteMemory(sessionId: string): Promise<void> {
    await this._ensureInitialized();
    await this._db.run('DELETE FROM conversation_memories WHERE session_id = ?', [sessionId]);
    try {
      await this._vectorStore.deleteSource(MEMORY_SOURCE_TYPE, sessionId);
    } catch (e) { console.error('[MemoryService] deleteMemory vector cleanup failed:', e); }
    this._onDidUpdateMemory.fire(sessionId);
  }

  // M81 Phase 3 Stage 2 — getAllConcepts / deleteConcept removed.

  // ── Decay & Eviction (M17 P1.3) ──

  /**
   * Recalculate decay scores for all memories (Task 1.3.3).
   *
   * Should be called periodically (e.g. once per session start).
   * Updates `decay_score` in-place using the exponential decay formula.
   */
  async recalculateDecayScores(): Promise<void> {
    await this._ensureInitialized();

    const memories = await this._db.all<{ session_id: string; last_accessed: string; importance: number }>(
      'SELECT session_id, last_accessed, importance FROM conversation_memories',
    );
    for (const m of memories) {
      const newDecay = computeDecayScore(m.last_accessed || new Date().toISOString(), m.importance || 0.5);
      await this._db.run(
        'UPDATE conversation_memories SET decay_score = ? WHERE session_id = ?',
        [newDecay, m.session_id],
      );
    }
  }

  /**
   * Evict stale memories (Task 1.3.5).
   *
   * - Session memories: last_accessed > 90 days AND decay_score < 0.1
   *
   * Also removes corresponding vector store entries.
   */
  async evictStaleContent(): Promise<{ memoriesEvicted: number }> {
    await this._ensureInitialized();

    // First recalculate decay scores so eviction uses current values
    await this.recalculateDecayScores();

    const staleMemories = await this._db.all<{ session_id: string }>(
      `SELECT session_id FROM conversation_memories
       WHERE julianday('now') - julianday(last_accessed) > ?
         AND decay_score < 0.1`,
      [MEMORY_EVICTION_DAYS],
    );

    await this._db.run('BEGIN IMMEDIATE');
    try {
      for (const m of staleMemories) {
        await this._db.run('DELETE FROM conversation_memories WHERE session_id = ?', [m.session_id]);
      }
      await this._db.run('COMMIT');
    } catch (err) {
      await this._db.run('ROLLBACK').catch((rbErr) => { console.error('[MemoryService] ROLLBACK failed during eviction:', rbErr); });
      throw err;
    }

    for (const m of staleMemories) {
      try {
        await this._vectorStore.deleteSource(MEMORY_SOURCE_TYPE, m.session_id);
      } catch (e) { console.error('[MemoryService] eviction vector cleanup failed:', e); }
    }

    return {
      memoriesEvicted: staleMemories.length,
    };
  }

  /**
   * Clear all memories, concepts, and preferences (reset).
   * Also removes all corresponding vector/FTS/indexing_metadata entries.
   */
  async clearAll(): Promise<void> {
    await this._ensureInitialized();

    // Collect all source IDs before deleting SQL rows
    const memories = await this._db.all<{ session_id: string }>(
      'SELECT session_id FROM conversation_memories',
    );

    // Delete SQL rows
    await this._db.run('DELETE FROM conversation_memories');
    await this._db.run('DELETE FROM user_preferences');

    // Clean up vector store entries (vec_embeddings + fts_chunks + indexing_metadata)
    for (const m of memories) {
      try {
        await this._vectorStore.deleteSource(MEMORY_SOURCE_TYPE, m.session_id);
      } catch (e) { console.error('[MemoryService] clearAll memory vector cleanup failed:', e); }
    }
  }
}
