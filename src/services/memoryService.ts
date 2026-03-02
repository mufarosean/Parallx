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

/** Rough token estimator: chars / 4 (same as other services). */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
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
  session_id    TEXT PRIMARY KEY,
  summary       TEXT    NOT NULL,
  message_count INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
)`;

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
    await this._db.run(CREATE_PREFERENCES_TABLE);
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

    // 1. Store in relational table
    await this._db.run(
      `INSERT OR REPLACE INTO conversation_memories(session_id, summary, message_count, created_at)
       VALUES (?, ?, ?, datetime('now'))`,
      [sessionId, summary, messageCount],
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
      topK: topK * 2, // Over-fetch for token budget
      sourceFilter: MEMORY_SOURCE_TYPE,
      includeKeyword: true,
    });

    // Apply token budget
    let tokensUsed = 0;
    const budgeted: typeof results = [];
    for (const r of results) {
      const tokens = estimateTokens(r.chunkText);
      if (tokensUsed + tokens > tokenBudget && budgeted.length > 0) { break; }
      budgeted.push(r);
      tokensUsed += tokens;
    }

    // Enrich with metadata from relational table
    const memories: ConversationMemory[] = [];
    for (const r of budgeted.slice(0, topK)) {
      const meta = await this._db.get<{ session_id: string; summary: string; message_count: number; created_at: string }>(
        'SELECT session_id, summary, message_count, created_at FROM conversation_memories WHERE session_id = ?',
        [r.sourceId],
      );
      if (meta) {
        memories.push({
          sessionId: meta.session_id,
          summary: meta.summary,
          messageCount: meta.message_count,
          createdAt: meta.created_at,
        });
      }
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

  /**
   * Clear all memories and preferences (reset).
   */
  async clearAll(): Promise<void> {
    await this._ensureInitialized();
    await this._db.run('DELETE FROM conversation_memories');
    await this._db.run('DELETE FROM user_preferences');
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
