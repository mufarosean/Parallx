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
const MIN_MESSAGES_FOR_SUMMARY = 3;

/** Maximum character length for a preference value. */
const MAX_PREFERENCE_VALUE_LENGTH = 500;

/** Maximum memories to retrieve for context injection. */
const DEFAULT_MEMORY_TOP_K = 5;

/** Token budget for injected memory context. */
const DEFAULT_MEMORY_TOKEN_BUDGET = 1500;

/** Source type used in the vector store for memory entries. */
const MEMORY_SOURCE_TYPE = 'memory';

/** Source type used in the vector store for concept entries (P1.2). */
const CONCEPT_SOURCE_TYPE = 'concept';

/** Maximum concepts to retrieve for context injection (P1.2). */
const DEFAULT_CONCEPT_TOP_K = 5;

/** Token budget for injected concept context (P1.2). */
const DEFAULT_CONCEPT_TOKEN_BUDGET = 500;

/** Decay rate constant — half-life ≈ 23 days. */
const DECAY_LAMBDA = 0.03;

/** Eviction: session memories older than this with low decay are removed. */
const MEMORY_EVICTION_DAYS = 90;

/** Eviction: concepts older than this with low encounter count & low decay are removed. */
const CONCEPT_EVICTION_DAYS = 180;

/** Rough token estimator: chars / 4 (same as other services). */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

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

/** A tracked learning concept extracted from conversations (M17 P1.2). */
export interface LearningConcept {
  /** Auto-incremented row ID. */
  id?: number;
  /** The concept name (2-5 words). */
  concept: string;
  /** Subject area (e.g. 'biology', 'programming'). */
  category: string;
  /** Current understanding description. */
  summary: string;
  /** Mastery level: 0.0 (unknown) → 1.0 (mastered). */
  masteryLevel: number;
  /** How many times this concept has been discussed. */
  encounterCount: number;
  /** How many times the user struggled with this concept. */
  struggleCount: number;
  /** When the concept was first seen. */
  firstSeen: string;
  /** When the concept was last discussed. */
  lastSeen: string;
  /** When the concept was last retrieved for context. */
  lastAccessed: string;
  /** JSON array of session IDs that touched this concept. */
  sourceSessions: string;
  /** Decay score — decays over time, boosted on access. */
  decayScore: number;
}

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

const CREATE_CONCEPTS_TABLE = `
CREATE TABLE IF NOT EXISTS learning_concepts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  concept         TEXT    NOT NULL,
  category        TEXT    NOT NULL DEFAULT 'general',
  summary         TEXT    NOT NULL,
  mastery_level   REAL    NOT NULL DEFAULT 0.0,
  encounter_count INTEGER NOT NULL DEFAULT 1,
  struggle_count  INTEGER NOT NULL DEFAULT 0,
  first_seen      TEXT    NOT NULL DEFAULT (datetime('now')),
  last_seen       TEXT    NOT NULL DEFAULT (datetime('now')),
  last_accessed   TEXT    NOT NULL DEFAULT (datetime('now')),
  source_sessions TEXT    NOT NULL DEFAULT '[]',
  decay_score     REAL    NOT NULL DEFAULT 1.0
)`;

const CREATE_CONCEPTS_INDEXES = [
  `CREATE INDEX IF NOT EXISTS idx_concepts_category ON learning_concepts(category)`,
  `CREATE INDEX IF NOT EXISTS idx_concepts_mastery ON learning_concepts(mastery_level)`,
  `CREATE INDEX IF NOT EXISTS idx_concepts_last_seen ON learning_concepts(last_seen)`,
];

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
 * Preference flow:
 *   1. `extractAndStorePreferences(text)` scans text for preference patterns.
 *   2. Preferences are upserted into `user_preferences` table.
 *   3. `getPreferences()` returns all stored preferences.
 *   4. `formatPreferencesForPrompt()` produces a concise prompt section.
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
    await this._db.run(CREATE_CONCEPTS_TABLE);
    for (const idx of CREATE_CONCEPTS_INDEXES) { await this._db.run(idx); }
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
      ).catch(() => {});
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

  /**
   * Store or update learning concepts extracted from a session.
   *
   * For each concept: upsert by `concept` (case-insensitive match).
   * On conflict: increment encounter_count, update last_seen, merge
   * source_sessions, update summary if richer, update mastery_level.
   * Also embed each concept as source_type='concept' in the vector store.
   */
  async storeConcepts(
    concepts: LearningConcept[],
    sessionId: string,
  ): Promise<void> {
    await this._ensureInitialized();

    for (const c of concepts) {
      const conceptLower = c.concept.toLowerCase().trim();
      if (!conceptLower) { continue; }

      // Check for existing concept (case-insensitive)
      const existing = await this._db.get<{
        id: number; encounter_count: number; struggle_count: number;
        summary: string; mastery_level: number; source_sessions: string;
        decay_score: number;
      }>(
        'SELECT id, encounter_count, struggle_count, summary, mastery_level, source_sessions, decay_score FROM learning_concepts WHERE LOWER(concept) = ?',
        [conceptLower],
      );

      if (existing) {
        // Merge source sessions
        let sessions: string[] = [];
        try { sessions = JSON.parse(existing.source_sessions); } catch { sessions = []; }
        if (!sessions.includes(sessionId)) { sessions.push(sessionId); }

        // Update mastery: small boost per encounter (capped at 1.0)
        const newEncounter = existing.encounter_count + 1;
        const newStruggle = existing.struggle_count + (c.struggleCount > 0 ? 1 : 0);
        const masteryDelta = c.struggleCount > 0 ? -0.05 : 0.1;
        const newMastery = Math.max(0, Math.min(1.0, existing.mastery_level + masteryDelta));

        // Use richer summary (longer = likely more detailed)
        const newSummary = c.summary.length > existing.summary.length ? c.summary : existing.summary;

        // Boost decay score on re-encounter
        const newDecay = Math.min(1.0, existing.decay_score + 0.2);

        await this._db.run(
          `UPDATE learning_concepts SET
            summary = ?, mastery_level = ?, encounter_count = ?,
            struggle_count = ?, last_seen = datetime('now'),
            source_sessions = ?, decay_score = ?,
            category = CASE WHEN category = 'general' THEN ? ELSE category END
           WHERE id = ?`,
          [newSummary, newMastery, newEncounter, newStruggle,
           JSON.stringify(sessions), newDecay, c.category || 'general', existing.id],
        );
      } else {
        // Insert new concept
        const sessions = JSON.stringify([sessionId]);
        await this._db.run(
          `INSERT INTO learning_concepts(concept, category, summary, mastery_level,
            encounter_count, struggle_count, source_sessions, decay_score)
           VALUES (?, ?, ?, ?, 1, ?, ?, 1.0)`,
          [c.concept.trim(), c.category || 'general', c.summary,
           Math.max(0, Math.min(1.0, c.masteryLevel || 0)),
           c.struggleCount > 0 ? 1 : 0, sessions],
        );
      }

      // Embed concept for vector retrieval
      const embeddingText = `${c.concept}: ${c.summary}`;
      const contentHash = await hashContent(embeddingText);
      const embedding = await this._embeddingService.embedDocument(embeddingText);

      const chunk: EmbeddedChunk = {
        sourceType: CONCEPT_SOURCE_TYPE as 'page_block' | 'file_chunk',
        sourceId: `concept:${conceptLower}`,
        chunkIndex: 0,
        text: embeddingText,
        contextPrefix: `[Learning Concept — ${c.concept}]`,
        contentHash,
        embedding,
      };

      await this._vectorStore.upsert(CONCEPT_SOURCE_TYPE, `concept:${conceptLower}`, [chunk], contentHash);
    }
  }

  /**
   * Recall learning concepts relevant to a query.
   *
   * Uses vector similarity on concept embeddings. Updates `last_accessed`
   * on every recalled concept.
   */
  async recallConcepts(
    query: string,
    topK?: number,
  ): Promise<LearningConcept[]> {
    await this._ensureInitialized();
    if (!query.trim()) { return []; }

    const maxResults = topK ?? DEFAULT_CONCEPT_TOP_K;

    // Embed query
    const queryEmbedding = await this._embeddingService.embedQuery(query);

    // Vector search filtered to concept source type
    const results = await this._vectorStore.search(queryEmbedding, query, {
      topK: maxResults * 2, // Over-fetch for filtering
      sourceFilter: CONCEPT_SOURCE_TYPE,
      includeKeyword: true,
    });

    // Load full concept data + apply token budget
    let tokensUsed = 0;
    const concepts: LearningConcept[] = [];
    for (const r of results) {
      if (concepts.length >= maxResults) { break; }

      // Extract concept name from sourceId (format: "concept:name")
      const conceptKey = r.sourceId.replace(/^concept:/, '');
      const row = await this._db.get<{
        id: number; concept: string; category: string; summary: string;
        mastery_level: number; encounter_count: number; struggle_count: number;
        first_seen: string; last_seen: string; last_accessed: string;
        source_sessions: string; decay_score: number;
      }>(
        'SELECT * FROM learning_concepts WHERE LOWER(concept) = ?',
        [conceptKey],
      );
      if (!row) { continue; }

      const tokens = estimateTokens(`${row.concept}: ${row.summary}`);
      if (tokensUsed + tokens > DEFAULT_CONCEPT_TOKEN_BUDGET && concepts.length > 0) { break; }
      tokensUsed += tokens;

      concepts.push({
        id: row.id,
        concept: row.concept,
        category: row.category,
        summary: row.summary,
        masteryLevel: row.mastery_level,
        encounterCount: row.encounter_count,
        struggleCount: row.struggle_count,
        firstSeen: row.first_seen,
        lastSeen: row.last_seen,
        lastAccessed: row.last_accessed,
        sourceSessions: row.source_sessions,
        decayScore: row.decay_score,
      });

      // Update last_accessed
      await this._db.run(
        'UPDATE learning_concepts SET last_accessed = datetime(\'now\') WHERE id = ?',
        [row.id],
      );
    }

    return concepts;
  }

  /**
   * Format recalled concepts into a context block for system prompt injection.
   */
  formatConceptContext(concepts: LearningConcept[]): string {
    if (concepts.length === 0) { return ''; }

    const lines: string[] = ['[Prior knowledge — concepts the user has studied before]'];

    for (const c of concepts) {
      const struggle = c.struggleCount > 0 ? `, struggles noted (${c.struggleCount}×)` : '';
      const daysSince = Math.round(
        (Date.now() - new Date(c.lastSeen).getTime()) / (1000 * 60 * 60 * 24),
      );
      const lastStudied = daysSince === 0 ? 'today' : daysSince === 1 ? 'yesterday' : `${daysSince} days ago`;

      lines.push(
        `- ${c.concept} (${c.category}): encountered ${c.encounterCount}×${struggle}. ` +
        `Last studied ${lastStudied}. Mastery: ${c.masteryLevel.toFixed(1)}/1.0`,
      );
      if (c.summary) {
        lines.push(`  ${c.summary}`);
      }
    }

    return lines.join('\n');
  }

  // ── User Preference Learning (Task 5.2) ──

  /**
   * Extract preference statements from text and store them.
   *
   * Uses pattern matching to detect preference statements like:
   *   - "I prefer X"
   *   - "Always use X"
   *   - "I like X for Y"
   *   - "My preference is X"
   *   - "Use X instead of Y"
   *   - "I want X"
   *   - "Default to X"
   *
   * Returns the preferences that were extracted (empty if none detected).
   */
  async extractAndStorePreferences(text: string): Promise<UserPreference[]> {
    await this._ensureInitialized();

    const extracted = this._detectPreferences(text);
    if (extracted.length === 0) { return []; }

    const stored: UserPreference[] = [];
    for (const { key, value } of extracted) {
      const trimmedValue = value.slice(0, MAX_PREFERENCE_VALUE_LENGTH);

      const existing = await this._db.get<{ frequency: number }>(
        'SELECT frequency FROM user_preferences WHERE key = ?',
        [key],
      );

      if (existing) {
        // Update existing preference — bump frequency
        await this._db.run(
          `UPDATE user_preferences SET value = ?, frequency = frequency + 1, updated_at = datetime('now') WHERE key = ?`,
          [trimmedValue, key],
        );
      } else {
        // Insert new preference
        await this._db.run(
          `INSERT INTO user_preferences(key, value, frequency, created_at, updated_at) VALUES (?, ?, 1, datetime('now'), datetime('now'))`,
          [key, trimmedValue],
        );
      }

      const pref = await this._db.get<{ key: string; value: string; frequency: number; created_at: string; updated_at: string }>(
        'SELECT key, value, frequency, created_at, updated_at FROM user_preferences WHERE key = ?',
        [key],
      );

      if (pref) {
        const userPref: UserPreference = {
          key: pref.key,
          value: pref.value,
          frequency: pref.frequency,
          createdAt: pref.created_at,
          updatedAt: pref.updated_at,
        };
        stored.push(userPref);
        this._onDidUpdatePreferences.fire(userPref);
      }
    }

    return stored;
  }

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
    } catch { /* best-effort */ }
    this._onDidUpdateMemory.fire(sessionId);
  }

  /** Get all stored concepts (M20 F.1). */
  async getAllConcepts(): Promise<LearningConcept[]> {
    await this._ensureInitialized();
    const rows = await this._db.all<{
      id: number; concept: string; category: string; summary: string;
      mastery_level: number; encounter_count: number; struggle_count: number;
      first_seen: string; last_seen: string; last_accessed: string;
      source_sessions: string; decay_score: number;
    }>('SELECT * FROM learning_concepts ORDER BY last_seen DESC');
    return rows.map((r) => ({
      id: r.id,
      concept: r.concept,
      category: r.category,
      summary: r.summary,
      masteryLevel: r.mastery_level,
      encounterCount: r.encounter_count,
      struggleCount: r.struggle_count,
      firstSeen: r.first_seen,
      lastSeen: r.last_seen,
      lastAccessed: r.last_accessed,
      sourceSessions: r.source_sessions,
      decayScore: r.decay_score,
    }));
  }

  /** Delete a specific concept by ID (M20 F.2). */
  async deleteConcept(conceptId: number): Promise<void> {
    await this._ensureInitialized();
    // Get the concept name for vector cleanup
    const row = await this._db.get<{ concept: string }>(
      'SELECT concept FROM learning_concepts WHERE id = ?', [conceptId],
    );
    await this._db.run('DELETE FROM learning_concepts WHERE id = ?', [conceptId]);
    if (row) {
      try {
        await this._vectorStore.deleteSource(CONCEPT_SOURCE_TYPE, `concept:${row.concept.toLowerCase()}`);
      } catch { /* best-effort */ }
    }
  }

  // ── Decay & Eviction (M17 P1.3) ──

  /**
   * Recalculate decay scores for all memories and concepts (Task 1.3.3).
   *
   * Should be called periodically (e.g. once per session start).
   * Updates `decay_score` in-place using the exponential decay formula.
   */
  async recalculateDecayScores(): Promise<void> {
    await this._ensureInitialized();

    // Memories: base_importance = importance column (default 0.5)
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

    // Concepts: base_importance = mastery_level (default to 0.5 if 0)
    const concepts = await this._db.all<{ id: number; last_accessed: string; mastery_level: number }>(
      'SELECT id, last_accessed, mastery_level FROM learning_concepts',
    );
    for (const c of concepts) {
      const baseImportance = c.mastery_level > 0 ? c.mastery_level : 0.5;
      const newDecay = computeDecayScore(c.last_accessed || new Date().toISOString(), baseImportance);
      await this._db.run(
        'UPDATE learning_concepts SET decay_score = ? WHERE id = ?',
        [newDecay, c.id],
      );
    }
  }

  /**
   * Evict stale memories and concepts (Task 1.3.5).
   *
   * - Session memories: last_accessed > 90 days AND decay_score < 0.1
   * - Learning concepts: last_accessed > 180 days AND encounter_count = 1 AND decay_score < 0.05
   *
   * Also removes corresponding vector store entries.
   */
  async evictStaleContent(): Promise<{ memoriesEvicted: number; conceptsEvicted: number }> {
    await this._ensureInitialized();

    // First recalculate decay scores so eviction uses current values
    await this.recalculateDecayScores();

    // Evict stale session memories
    const staleMemories = await this._db.all<{ session_id: string }>(
      `SELECT session_id FROM conversation_memories
       WHERE julianday('now') - julianday(last_accessed) > ?
         AND decay_score < 0.1`,
      [MEMORY_EVICTION_DAYS],
    );

    for (const m of staleMemories) {
      await this._db.run('DELETE FROM conversation_memories WHERE session_id = ?', [m.session_id]);
      // Clean up vector store entry (vec_embeddings + fts_chunks + indexing_metadata)
      try {
        await this._vectorStore.deleteSource(MEMORY_SOURCE_TYPE, m.session_id);
      } catch { /* best-effort */ }
    }

    // Evict stale concepts (low encounter, old, fully decayed)
    const staleConcepts = await this._db.all<{ id: number; concept: string }>(
      `SELECT id, concept FROM learning_concepts
       WHERE julianday('now') - julianday(last_accessed) > ?
         AND encounter_count = 1
         AND decay_score < 0.05`,
      [CONCEPT_EVICTION_DAYS],
    );

    for (const c of staleConcepts) {
      await this._db.run('DELETE FROM learning_concepts WHERE id = ?', [c.id]);
      try {
        await this._vectorStore.deleteSource(CONCEPT_SOURCE_TYPE, `concept:${c.concept.toLowerCase()}`);
      } catch { /* best-effort */ }
    }

    return {
      memoriesEvicted: staleMemories.length,
      conceptsEvicted: staleConcepts.length,
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
    const concepts = await this._db.all<{ concept: string }>(
      'SELECT concept FROM learning_concepts',
    );

    // Delete SQL rows
    await this._db.run('DELETE FROM conversation_memories');
    await this._db.run('DELETE FROM learning_concepts');
    await this._db.run('DELETE FROM user_preferences');

    // Clean up vector store entries (vec_embeddings + fts_chunks + indexing_metadata)
    for (const m of memories) {
      try {
        await this._vectorStore.deleteSource(MEMORY_SOURCE_TYPE, m.session_id);
      } catch { /* best-effort */ }
    }
    for (const c of concepts) {
      try {
        await this._vectorStore.deleteSource(CONCEPT_SOURCE_TYPE, `concept:${c.concept.toLowerCase()}`);
      } catch { /* best-effort */ }
    }
  }

  // ── Preference Detection (internal) ──

  /**
   * Detect preference patterns in free-form text.
   *
   * Returns an array of { key, value } pairs. Key is a normalised
   * category label, value is the preference statement.
   */
  private _detectPreferences(text: string): { key: string; value: string }[] {
    const results: { key: string; value: string }[] = [];
    const seen = new Set<string>();

    // Patterns: match "I prefer X", "always use X", etc.
    const patterns: { re: RegExp; keyPrefix: string }[] = [
      { re: /\bi\s+prefer\s+(.+?)(?:\.|,|$)/gi, keyPrefix: 'preference' },
      { re: /\balways\s+use\s+(.+?)(?:\.|,|$)/gi, keyPrefix: 'tool_preference' },
      { re: /\bmy\s+preference\s+is\s+(.+?)(?:\.|,|$)/gi, keyPrefix: 'preference' },
      { re: /\bdefault\s+to\s+(.+?)(?:\.|,|$)/gi, keyPrefix: 'default' },
      { re: /\bi\s+(?:like|want)\s+(.+?)(?:\s+for\s+|\.|,|$)/gi, keyPrefix: 'preference' },
      { re: /\buse\s+(.+?)\s+instead\s+of\s+(.+?)(?:\.|,|$)/gi, keyPrefix: 'preference' },
      { re: /\bformat\s+(.+?)\s+as\s+(.+?)(?:\.|,|$)/gi, keyPrefix: 'formatting' },
    ];

    for (const { re, keyPrefix } of patterns) {
      let match: RegExpExecArray | null;
      while ((match = re.exec(text)) !== null) {
        const value = (match[1] ?? '').trim();
        if (!value || value.length < 2 || value.length > 200) { continue; }

        // Normalise key: prefix + first few meaningful words
        const keyWords = value.toLowerCase()
          .replace(/[^a-z0-9\s]/g, '')
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 3)
          .join('_');

        const key = `${keyPrefix}_${keyWords}`;
        if (seen.has(key)) { continue; }
        seen.add(key);

        results.push({ key, value });
      }
    }

    return results;
  }
}
