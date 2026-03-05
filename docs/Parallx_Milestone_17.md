# Milestone 17 — Second Brain: Learning Intelligence & Reliability

> **Authoritative Scope Notice**
>
> This document is the single source of truth for Milestone 17.
> All implementation must conform to the structures and boundaries defined here.
> Milestones 1–14 established the workbench shell, tool system, local AI chat,
> RAG pipeline, and workspace session isolation. Milestone 15 added AI personality
> & behavior settings. Milestone 16 redesigned the RAG pipeline for precision.
> This milestone transforms Parallx from a RAG chatbot into a genuine **second brain**
> that learns how the user thinks, tracks what they know, detects where they struggle,
> and proactively helps them learn — all locally, all privately.

---

## Table of Contents

1. [Vision](#vision)
2. [Honest Assessment — Current State](#honest-assessment--current-state)
3. [Priority Map](#priority-map)
4. [P0 — Critical Fixes (Must Ship First)](#p0--critical-fixes)
   - [P0.1 RAG Token Trimming Bug](#p01-rag-token-trimming-bug)
   - [P0.2 Latency Reduction](#p02-latency-reduction)
5. [P1 — Memory Intelligence (Core Differentiator)](#p1--memory-intelligence)
   - [P1.1 Updatable Session Memories](#p11-updatable-session-memories)
   - [P1.2 Concept-Level Memory Schema](#p12-concept-level-memory-schema)
   - [P1.3 Memory Eviction & Decay](#p13-memory-eviction--decay)
6. [P2 — Learning Awareness](#p2--learning-awareness)
   - [P2.1 Struggle Detection](#p21-struggle-detection)
   - [P2.2 Proactive Review Nudges](#p22-proactive-review-nudges)
7. [P3 — Active Learning Tools](#p3--active-learning-tools)
   - [P3.1 Quiz Generation](#p31-quiz-generation)
   - [P3.2 Spaced Repetition Scheduling](#p32-spaced-repetition-scheduling)
8. [Task Tracker](#task-tracker)
9. [Verification Checklist](#verification-checklist)
10. [File Impact Map](#file-impact-map)
11. [Risk Register](#risk-register)

---

## Vision

**Before M17 — what the user experiences today:**

> A student opens Parallx with 30 pages of biology notes. They ask "explain meiosis
> vs mitosis." The AI produces a good grounded answer from the indexed notes. They
> come back tomorrow and ask a different question — the AI has no memory of yesterday's
> confusion about prophase. They ask the same prophase question three sessions in a row
> — the AI never notices the pattern. After a week of study, there's no way to know
> which topics are solid and which need review. The AI is a helpful search engine
> over notes, but it doesn't know the student at all.

**After M17 — what the user will experience:**

> Same student, same notes. They ask about meiosis — the AI explains it, and
> tracks that *meiosis* and *mitosis comparison* were discussed as concepts. When
> they struggle with prophase (asking about it again, rephrasing, expressing
> confusion), the AI detects the pattern and stores it: "User struggles with
> prophase stages — especially identifying key events in prophase I vs II."
> Next session, the AI's memory recall includes this struggle note as context.
> After a week, the student types `/review` and gets a prioritized list: "Topics
> due for review: Prophase I/II (struggled 3 sessions ago), Meiosis II
> (mentioned but never tested), Krebs cycle (last studied 5 days ago)." They
> type `/quiz meiosis` and the AI generates targeted questions from their actual
> notes, evaluates answers, and updates mastery scores. The AI says "You got
> 4/5 on meiosis but consistently miss details about crossing over. Want me to
> explain that again?"

**The one-sentence pitch:**

> Give Parallx a model of the user as a learner — what they know, what they
> don't, and what they need next — using only local models, local storage, and
> the content they already have.

**Why this matters:**

The infrastructure is solid (M10–M16 built indexing, retrieval, hybrid search,
re-ranking, session persistence, memory storage, preference learning). But the
**intelligence layer** — the part that makes Parallx a second brain rather than
a search engine — is missing. This milestone adds it across four priority tiers,
each building on the last.

---

## Honest Assessment — Current State

Full code-level audit performed on March 5, 2026. Every finding is verified by
reading source code, not documentation.

### What Works (End-to-End Verified)

| Capability | Status | Evidence |
|------------|--------|----------|
| **Indexing pipeline** | Production-quality | Content hashing, incremental updates, mtime fast-skip, batch embedding, .parallxignore, PDF/DOCX/XLSX support. `indexingPipeline.ts` (960 lines) |
| **Hybrid retrieval** | Solid 5-stage pipeline | RRF threshold → relative drop-off → cosine re-rank → source dedup → token budget. `retrievalService.ts` (439 lines). M16 added cosine re-ranking |
| **Session persistence** | SQLite-backed, survives restarts | `chat_sessions` + `chat_messages` tables, restored via `chatService.restoreSessions()` from `workbench.ts` |
| **Within-session context** | Full history maintained | Automatic summarization on overflow (`defaultParticipant.ts` L834–862). `/compact` command for manual compaction |
| **Preference injection** | Wired end-to-end | `extractPreferences()` at L1147 → `getPreferencesForPrompt()` at L406 → appended to system prompt at L430 |

### What Partially Works (Wired but Fragile)

| Capability | Problem | Code Reference |
|------------|---------|----------------|
| **Cross-session memory** | One-shot: session summarized once at message 3, never updated even if session reaches 50 messages | `defaultParticipant.ts` L1167: `if (hasMemory) { return; }` |
| **Preference learning** | Regex-only: catches "I prefer X" but not "examples really help me understand" | `memoryService.ts` L459–467: 7 regex patterns, no semantic extraction |
| **Token budget allocation** | RAG trimming bug: `_trimToTokenBudget()` always keeps text from END — correct for history (most recent) but drops highest-scored RAG chunks first | `tokenBudgetService.ts` L236–262 |
| **Memory type safety** | Memory embeddings cast as `'page_block'\|'file_chunk'` source type when value is `'memory'` | `memoryService.ts` storeMemory() call to vectorStore |

### What Doesn't Work

| Capability | Status | Evidence |
|------------|--------|----------|
| **Proactive suggestions** | Coverage gap type declared but never generated. In-memory only (lost on restart). Cluster threshold (0.003) near-useless. No UI consumer found | `proactiveSuggestionsService.ts` — `coverage_gap` has zero generation code |
| **Concept/topic tracking** | Does not exist | Zero code for concept extraction, mastery, or topic modeling |
| **Struggle detection** | Does not exist | No tracking of repeated questions, confusion signals, or difficulty patterns |
| **Study features** | Do not exist | Zero matches for quiz, spaced repetition, study plan, flashcard, mastery across entire codebase |
| **Model preloading** | Does not exist | `ollamaProvider.ts` never sends `keep_alive`, no warm-up call. Cold model loads add 10–30s |

---

## Priority Map

| Priority | Area | Impact | Effort | Dependency |
|----------|------|--------|--------|------------|
| **P0.1** | RAG token trimming bug | Critical — drops best RAG chunks | 1 hour | None |
| **P0.2** | Latency reduction | Critical — 15–60s responses kill conversational feel | 1 day | None |
| **P1.1** | Updatable session memories | High — memories frozen after 3 messages | 3 hours | None |
| **P1.2** | Concept-level memory schema | High — foundation for all learning features | 2 days | P1.1 |
| **P1.3** | Memory eviction & decay | High — without this, retrieval degrades over months | 1 day | P1.2 |
| **P2.1** | Struggle detection | Medium — tracks where user is stuck | 1 day | P1.2 |
| **P2.2** | Proactive review nudges | Medium — surfaces timely review suggestions | 1 day | P1.2, P2.1 |
| **P3.1** | Quiz generation | Lower — active learning from workspace content | 1 day | P1.2 |
| **P3.2** | Spaced repetition scheduling | Lower — optimal review timing | 2 days | P1.2, P2.1, P3.1 |

---

## P0 — Critical Fixes

These must ship before any new features. They fix things that actively degrade
the user experience today.

### P0.1 RAG Token Trimming Bug

**Problem:**
`TokenBudgetService._trimToTokenBudget()` always keeps text from the END of the
concatenated input. For **history** this is correct (keeps most recent messages).
For **RAG context** this is backwards — RAG chunks are ordered by relevance score
descending, so the most relevant chunks are at the START. The current code drops
the best chunks and keeps the worst.

**Evidence:**

```typescript
// tokenBudgetService.ts L236–262 (current code)
private _trimToTokenBudget(text: string, maxTokens: number): string {
    const targetChars = maxTokens * 4;
    if (text.length <= targetChars) { return text; }

    const paragraphs = text.split('\n\n');
    const kept: string[] = [];
    // Always keeps from the END — correct for history, wrong for RAG
    for (let i = paragraphs.length - 1; i >= 0; i--) {
      const candidate = [paragraphs[i], ...kept].join('\n\n');
      if (candidate.length > targetChars) { break; }
      kept.unshift(paragraphs[i]);
    }
    // ...
}
```

The method's own JSDoc comment acknowledges the dual purpose:
> *"For history: removes oldest messages (from the start).*
> *For RAG: removes text from the end (lowest-scoring chunks are typically last)."*

But the implementation only keeps from the END, for both callers:

```typescript
// tokenBudgetService.ts L185 (history — correct)
const trimmed = this._trimToTokenBudget(history, budget.history);

// tokenBudgetService.ts L194 (RAG — bug)
const trimmed = this._trimToTokenBudget(ragContext, budget.ragContext);
```

**Call chain:** `defaultParticipant.ts` L727 → `budgetService.allocate(contextWindow, systemPrompt, ragContext, history, userMessage)` → `_trimToTokenBudget()` for both history (L185) and RAG (L194).

**Fix:**

Add a `keepFrom` parameter:

```typescript
private _trimToTokenBudget(
  text: string,
  maxTokens: number,
  keepFrom: 'start' | 'end' = 'end'
): string
```

When `keepFrom === 'start'`, iterate from the START of paragraphs:

```typescript
if (keepFrom === 'start') {
  for (let i = 0; i < paragraphs.length; i++) {
    const candidate = [...kept, paragraphs[i]].join('\n\n');
    if (candidate.length > targetChars) { break; }
    kept.push(paragraphs[i]);
  }
} else {
  // existing end-keeping logic
}
```

Update callers:
- History: `this._trimToTokenBudget(history, budget.history, 'end')` — no change
- RAG: `this._trimToTokenBudget(ragContext, budget.ragContext, 'start')` — fixed

#### Tasks

| Task | Description | File(s) | Est. |
|------|-------------|---------|------|
| **0.1.1** | Add `keepFrom: 'start' \| 'end'` parameter to `_trimToTokenBudget()`. Implement start-keeping logic (iterate from index 0, accumulate forward). Hard-truncate fallback: `text.slice(0, targetChars)` for start, `text.slice(-targetChars)` for end. | `tokenBudgetService.ts` | 20 min |
| **0.1.2** | Update `allocate()` to pass `'end'` for history (L185) and `'start'` for RAG (L194). Update JSDoc. | `tokenBudgetService.ts` | 10 min |
| **0.1.3** | Add unit tests: (a) `_trimToTokenBudget(text, budget, 'start')` keeps first N paragraphs; (b) `_trimToTokenBudget(text, budget, 'end')` keeps last N paragraphs; (c) `allocate()` integration test verifying RAG keeps highest-scored chunks. | `tests/unit/tokenBudgetService.test.ts` | 30 min |

**Verification:** `tsc --noEmit && npx vitest run`

---

### P0.2 Latency Reduction

**Problem:**
On consumer hardware running Ollama locally, users experience 15–60 seconds per
response. This breaks the conversational feel essential for a study companion.
The latency comes from four sources, all fixable without changing the model:

| Source | Current Impact | Fix |
|--------|---------------|-----|
| Cold model loading | +10–30s after 5 min idle | Send `keep_alive` in every request |
| No model preloading | +10–30s on first message after launch | Warm-up call on health detection |
| Sequential context assembly | +200–1000ms (steps 5–9 run one-at-a-time) | `Promise.all()` parallelization |
| Context overflow summarization | +20–60s (full LLM round-trip before response) | Replace with simple truncation |

**Latency timeline — current pipeline** (from `defaultParticipant.ts`):

```
User sends message
  │
  ├─ Phase A (pre-request): ~500ms–60s
  │   ├─ Step 1–4: mode lookup, prompt build, history          sync
  │   ├─ Step 2: Promise.all [5 calls]                         ~100ms ✅ already parallel
  │   ├─ Step 5: resolveMentions()                             sequential ❌
  │   ├─ Step 6: getCurrentPageContent()                       sequential ❌
  │   ├─ Step 7: retrieveContext() [embedding + hybrid search] sequential ❌ ~200-500ms
  │   ├─ Step 8: recallMemories()                              sequential ❌ ~100-300ms
  │   ├─ Step 9: read attachments                              sequential ❌
  │   └─ Step 11: overflow summarization                       sequential LLM call ❌❌❌
  │
  ├─ Phase B (main LLM response): 5–60s
  │   └─ Step 12: sendChatRequest() → streaming
  │
  └─ Phase C (post-response): non-blocking ✅
      ├─ extractPreferences() — fire-and-forget
      └─ storeSessionMemory() — fire-and-forget
```

#### Tasks

| Task | Description | File(s) | Est. |
|------|-------------|---------|------|
| **0.2.1** | Add `keep_alive: '30m'` to every `/api/chat` request body. This tells Ollama to keep the model loaded in VRAM for 30 minutes after the last request instead of the default 5 minutes, eliminating cold-start penalties for active study sessions. | `ollamaProvider.ts` L321–354 (request body construction) | 15 min |
| **0.2.2** | Add `preloadModel(modelId: string)` method to `OllamaProvider`. When health polling detects Ollama is available (L735–748), send a zero-token `/api/chat` request with `keep_alive: '30m'` to pre-load the configured model into VRAM. Also trigger preload when active model changes. | `ollamaProvider.ts` | 45 min |
| **0.2.3** | Pre-warm the embedding model (`nomic-embed-text`) alongside the chat model. In `preloadModel()`, also send a single-token `/api/embed` request to load the embedding model. This prevents the first RAG search from paying a model-load penalty. | `ollamaProvider.ts`, `embeddingService.ts` | 30 min |
| **0.2.4** | Parallelize context assembly steps 5–9. Wrap `resolveMentions()`, `getCurrentPageContent()`, `retrieveContext()`, `recallMemories()`, and attachment reading in a single `Promise.all()`, like step 2 already does for prompt context. These 5 calls are fully independent. | `defaultParticipant.ts` L401–630 | 45 min |
| **0.2.5** | Replace context overflow summarization (L834–862) with simple oldest-first truncation. Drop the oldest history messages until token estimate fits the context window. The `/compact` command already exists for explicit LLM-based summarization. Keep the LLM summarization logic behind a commented/opt-in flag for future use. | `defaultParticipant.ts` L834–862 | 30 min |
| **0.2.6** | Delete dead `planRetrieval()` method and its parsing helpers (~140 lines) from `ollamaProvider.ts` (L422–560). These were left behind when the planner was disabled and add confusion. | `ollamaProvider.ts` L422–560 | 15 min |
| **0.2.7** | Add latency instrumentation. Log timestamps for key pipeline phases: (a) context assembly start/end, (b) first streamed token, (c) full response complete. Use `performance.now()`. Output to debug channel only (no user-visible overhead). | `defaultParticipant.ts` | 30 min |

**Verification:** `tsc --noEmit && npx vitest run`. Manual test: send a message after 10-minute idle — should see < 5s to first token (warm) vs. prior 15–30s (cold).

---

## P1 — Memory Intelligence

These tasks transform the flat session-summary memory into a structured model of
the user's knowledge. P1 is the foundation for all learning features in P2 and P3.

### P1.1 Updatable Session Memories

**Problem:**
Once a session has been summarized (at message 3), the summary is never updated
— even if the session continues to 50 messages. The guard at
`defaultParticipant.ts` L1167 (`if (hasMemory) { return; }`) prevents
re-summarization. This means the memory is a frozen snapshot of the first 3
messages; everything discussed afterward is lost to cross-session recall.

**Current schema:**

```sql
-- conversation_memories (memoryService.ts L98–105)
CREATE TABLE IF NOT EXISTS conversation_memories (
  session_id    TEXT PRIMARY KEY,
  summary       TEXT    NOT NULL,
  message_count INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
```

**Fix:**
1. Add `updated_at TEXT` column to `conversation_memories`
2. Replace the `hasMemory` binary guard with a **growth-based re-summarization
   check**: if the current message count is ≥ 2× the `message_count` stored in
   the last summary, re-summarize
3. Use `INSERT OR REPLACE` (already used by `storeMemory()`) so the updated
   summary overwrites the previous one
4. Update the vector store embedding for the memory to reflect the new summary

**Re-summarization trigger logic:**

```
storedMessageCount = getMemoryMessageCount(sessionId)
currentMessageCount = context.history.length + 1

shouldResynthesize =
  storedMessageCount === null               // never summarized → summarize now
  || currentMessageCount >= storedMessageCount * 2   // doubled → re-summarize
  || currentMessageCount >= storedMessageCount + 10  // 10+ new messages → re-summarize
```

#### Tasks

| Task | Description | File(s) | Est. |
|------|-------------|---------|------|
| **1.1.1** | Add `updated_at TEXT` column to `conversation_memories` table. Add migration: `ALTER TABLE conversation_memories ADD COLUMN updated_at TEXT DEFAULT (datetime('now'))`. | `memoryService.ts` | 15 min |
| **1.1.2** | Add `getMemoryMessageCount(sessionId: string): Promise<number \| null>` method to `IMemoryService`. Returns the `message_count` from the existing memory row, or `null` if no memory exists. | `memoryService.ts`, `serviceTypes.ts` | 20 min |
| **1.1.3** | Replace the `hasMemory` guard in `defaultParticipant.ts` with growth-based check. Remove `hasSessionMemory` service call. Add `getSessionMemoryMessageCount` to `ChatRequestServices` type. Implement the trigger logic: summarize if null, or if current ≥ stored × 2, or if current ≥ stored + 10. | `defaultParticipant.ts` L1156–1200, `chatTypes.ts`, `chatDataService.ts` | 45 min |
| **1.1.4** | When re-summarizing, update the vector store embedding. Call `vectorStore.deleteBySource('memory', sessionId)` then re-embed the new summary. Ensure `storeMemory()` handles the update path cleanly. | `memoryService.ts` storeMemory() | 30 min |
| **1.1.5** | Unit tests: (a) first summary at message 3; (b) no re-summary at message 5 (< 2×); (c) re-summary triggers at message 6 (2×); (d) re-summary triggers at message 13 (stored=3, current=13 ≥ 3+10); (e) vector embedding is updated on re-summary. | `tests/unit/memoryService.test.ts` | 30 min |

**Verification:** `tsc --noEmit && npx vitest run`

---

### P1.2 Concept-Level Memory Schema

**Problem:**
Memories are stored as opaque session summaries — "we discussed X and Y." There
is no structured representation of **what** the user knows. This means:
- No concept-level retrieval ("what does the user know about prophase?")
- No mastery tracking ("the user has asked about prophase 4 times")
- No gap detection ("the user studied mitosis but never meiosis")

**Current state:**
- `conversation_memories` stores one summary per session
- `user_preferences` stores key/value pairs from regex extraction
- Vector embeddings use `source_type = 'memory'` with one embedding per session
- No table, column, or code exists for concept tracking

**New schema:**

```sql
-- New table: tracked concepts extracted from conversations
CREATE TABLE IF NOT EXISTS learning_concepts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  concept        TEXT    NOT NULL,           -- "prophase I", "Krebs cycle"
  category       TEXT    NOT NULL DEFAULT 'general', -- "biology", "chemistry"
  summary        TEXT    NOT NULL,           -- current understanding description
  mastery_level  REAL    NOT NULL DEFAULT 0.0, -- 0.0 (unknown) → 1.0 (mastered)
  encounter_count INTEGER NOT NULL DEFAULT 1, -- how many times discussed
  struggle_count INTEGER NOT NULL DEFAULT 0, -- how many times user struggled
  first_seen     TEXT    NOT NULL DEFAULT (datetime('now')),
  last_seen      TEXT    NOT NULL DEFAULT (datetime('now')),
  last_accessed  TEXT    NOT NULL DEFAULT (datetime('now')),
  source_sessions TEXT   NOT NULL DEFAULT '[]', -- JSON array of session IDs
  decay_score    REAL    NOT NULL DEFAULT 1.0   -- decays over time, boosted on access
);

CREATE INDEX IF NOT EXISTS idx_concepts_category ON learning_concepts(category);
CREATE INDEX IF NOT EXISTS idx_concepts_mastery ON learning_concepts(mastery_level);
CREATE INDEX IF NOT EXISTS idx_concepts_last_seen ON learning_concepts(last_seen);
```

**Concept extraction strategy:**

Use the existing LLM (same fire-and-forget pattern as session summarization) to
extract concepts from conversations. The prompt:

```
Extract the key concepts discussed in this conversation. For each concept, provide:
- concept: the topic name (2-5 words)
- category: the subject area
- user_understanding: brief description of the user's current grasp
- struggled: true if the user showed confusion, asked for rephrasing, or needed multiple explanations

Output as JSON array. Only include concepts the user actively engaged with.
```

This runs post-response (same timing as session memory summarization) and is
fire-and-forget. The LLM call is amortized — extract concepts at the same time
as summarizing the session, in a single prompt.

**Concept recall integration:**

In `recallMemories()`, also query `learning_concepts` for concepts relevant to
the current query. Format as:

```
[Prior knowledge — concepts the user has studied before]
- Prophase I (biology): encountered 4 times, struggles with identifying key events.
  Last studied 3 days ago. Mastery: 0.3/1.0
- Meiosis (biology): encountered 2 times. Last studied 1 day ago. Mastery: 0.6/1.0
```

This gives the LLM context about the user's learning state, enabling adaptive
responses (e.g., providing more detail on low-mastery topics).

#### Tasks

| Task | Description | File(s) | Est. |
|------|-------------|---------|------|
| **1.2.1** | Create `learning_concepts` table and indexes. Add migration SQL. Ensure table is created in `_ensureInitialized()`. | `memoryService.ts` | 30 min |
| **1.2.2** | Define `LearningConcept` TypeScript interface. Add to `serviceTypes.ts`. Fields: `id`, `concept`, `category`, `summary`, `masteryLevel`, `encounterCount`, `struggleCount`, `firstSeen`, `lastSeen`, `lastAccessed`, `sourceSessions`, `decayScore`. | `serviceTypes.ts` | 15 min |
| **1.2.3** | Add `storeConcepts(concepts: LearningConcept[], sessionId: string): Promise<void>` method. For each concept: upsert by `concept` (case-insensitive match). On conflict: increment `encounter_count`, update `last_seen`, merge `source_sessions`, update `summary` if richer, update `mastery_level`. Also embed each concept as `source_type = 'concept'` in the vector store. | `memoryService.ts` | 1 hour |
| **1.2.4** | Add `recallConcepts(query: string, topK?: number): Promise<LearningConcept[]>` method. Hybrid search: vector similarity on concept embeddings + FTS5 keyword match on concept name + category. Filter to top K (default 5). Update `last_accessed` on every recall. | `memoryService.ts` | 45 min |
| **1.2.5** | Add `formatConceptContext(concepts: LearningConcept[]): string` method. Produces the `[Prior knowledge]` block for system prompt injection. Include mastery level, encounter count, struggle flag, and last-seen date. | `memoryService.ts` | 20 min |
| **1.2.6** | Build concept extraction prompt. Combine with session summarization into a single LLM call (fire-and-forget). The prompt asks the LLM to output both the session summary AND extracted concepts in structured JSON. Parse the JSON response and call `storeConcepts()`. | `defaultParticipant.ts` (post-response block) | 1 hour |
| **1.2.7** | Wire concept recall into the pre-request context assembly. After `recallMemories()`, call `recallConcepts()` and append formatted concept context to `contextParts`. Gate behind `retrievalPlan.needsRetrieval` (same as memory recall). Cap at ~500 tokens (2000 chars). | `defaultParticipant.ts` L605–620, `chatDataService.ts`, `chatTypes.ts` | 45 min |
| **1.2.8** | Extend `IMemoryService` interface in `serviceTypes.ts` with the new methods. Update `ChatRequestServices` type in `chatTypes.ts` to expose `recallConcepts` and `storeConceptsFromSession`. Wire through `chatDataService.ts`. | `serviceTypes.ts`, `chatTypes.ts`, `chatDataService.ts` | 30 min |
| **1.2.9** | Unit tests: (a) concept upsert — first write creates row, second increments counter; (b) concept recall — vector + keyword search returns relevant concepts, updates `last_accessed`; (c) concept context formatting; (d) concept extraction prompt parsing; (e) mastery level update on repeated encounters. | `tests/unit/memoryService.test.ts` | 1 hour |

**Verification:** `tsc --noEmit && npx vitest run`

---

### P1.3 Memory Eviction & Decay

**Problem:**
Memories and concepts accumulate forever. After months of use, retrieval quality
degrades as hundreds of old, irrelevant memories compete with current study topics
for the limited context window slots. There is no staleness check, no decay, and
no eviction.

**Current state:**
- `conversation_memories`: no `last_accessed_at`, no importance score, no eviction
- `user_preferences`: no expiry, no decay
- `learning_concepts` (P1.2): has `decay_score` and `last_accessed` columns but
  no code uses them yet

**Decay function:**

```
decay_score = base_importance × exp(-λ × days_since_last_access)

where:
  base_importance = mastery_level for concepts, 0.5 for session memories
  λ = 0.03 (half-life ≈ 23 days — a concept not accessed in 23 days
       drops to 50% relevance)
  days_since_last_access = (now - last_accessed) in days
```

The decay score is used as a **re-ranking multiplier** during recall:

```
final_score = retrieval_score × (0.5 + 0.5 × decay_score)
```

This means a fully-decayed memory still gets 50% of its retrieval score (never
completely invisible), while a recently-accessed memory gets full weight.

**Eviction policy:**

Run `evictStaleContent()` on session start (non-blocking). Delete:
- Session memories where `last_accessed < 90 days ago` AND `decay_score < 0.1`
- Learning concepts where `last_accessed < 180 days ago` AND `encounter_count = 1` AND `decay_score < 0.05`
- Clean up corresponding `vec_embeddings` and `fts_chunks` entries

#### Tasks

| Task | Description | File(s) | Est. |
|------|-------------|---------|------|
| **1.3.1** | Add `last_accessed TEXT` and `importance REAL DEFAULT 0.5` columns to `conversation_memories`. Migration: `ALTER TABLE conversation_memories ADD COLUMN last_accessed TEXT DEFAULT (datetime('now'))` and same for `importance`. | `memoryService.ts` | 15 min |
| **1.3.2** | Update `recallMemories()` — after fetching results, update `last_accessed = datetime('now')` for all retrieved rows (bulk UPDATE). Also update `last_accessed` on `learning_concepts` in `recallConcepts()`. | `memoryService.ts` | 30 min |
| **1.3.3** | Add `computeDecayScore(lastAccessed: string, baseImportance: number): number` utility. Implements the exponential decay formula. Add `recalculateDecayScores(): Promise<void>` method that bulk-updates `decay_score` for all concepts and memories. | `memoryService.ts` | 30 min |
| **1.3.4** | Integrate decay into recall ranking. In `recallMemories()` and `recallConcepts()`, after hybrid search, multiply each result's score by `(0.5 + 0.5 × decay_score)`. Re-sort by adjusted score. | `memoryService.ts` | 30 min |
| **1.3.5** | Add `evictStaleContent(): Promise<{ memoriesEvicted: number; conceptsEvicted: number }>` method. Implements the eviction policy. Deletes from DB + `vec_embeddings` + `fts_chunks`. | `memoryService.ts` | 45 min |
| **1.3.6** | Trigger eviction on session start. In `chatDataService.ts` or `defaultParticipant.ts` initialization, call `evictStaleContent()` as fire-and-forget. Also call `recalculateDecayScores()` periodically (once per day or on session start). | `chatDataService.ts` | 20 min |
| **1.3.7** | Unit tests: (a) decay formula: score at t=0 is 1.0, at t=23 days is ~0.5, at t=90 days is ~0.07; (b) `last_accessed` updated on recall; (c) eviction removes memories older than 90 days with low decay; (d) eviction preserves high-encounter concepts even when old; (e) decay-weighted re-ranking changes result order. | `tests/unit/memoryService.test.ts` | 45 min |

**Verification:** `tsc --noEmit && npx vitest run`

---

## P2 — Learning Awareness

These tasks give the AI awareness of the user's learning patterns. They build
on the concept-level memory from P1.2.

### P2.1 Struggle Detection

**Problem:**
The AI has no awareness of when a user is struggling. A student who asks about
prophase in 3 consecutive sessions — rephrasing each time, expressing confusion,
asking for simpler explanations — gets no special treatment. The AI treats each
question as if it's the first time.

**Detection signals** (from conversational patterns):

| Signal | Pattern | Weight |
|--------|---------|--------|
| **Repeated topic** | Same concept appears in 3+ sessions | Strong |
| **Rephrasing** | Semantically similar questions within same session (cosine > 0.7) | Strong |
| **Confusion markers** | User text contains: "I don't understand", "I'm confused", "can you explain again", "that doesn't make sense", "what do you mean", "wait", "huh" | Medium |
| **Simplification requests** | "explain it simpler", "ELI5", "in simple terms", "break it down" | Medium |
| **Follow-up depth** | 4+ follow-up questions on the same topic in one session | Weak |

**Implementation approach:**

Post-response analysis (same fire-and-forget timing as concept extraction).
For each detected struggle signal:
1. Look up the concept in `learning_concepts`
2. Increment `struggle_count`
3. Decrease `mastery_level` by 0.1 (clamped to 0.0–1.0)
4. Store a struggle note in the concept's `summary` field

The struggle data is then available to the LLM through concept recall —
it sees "User struggles with prophase I (struggle_count: 3, mastery: 0.2)"
and naturally adjusts its explanation depth.

#### Tasks

| Task | Description | File(s) | Est. |
|------|-------------|---------|------|
| **2.1.1** | Add `detectStruggleSignals(userText: string, sessionHistory: IChatHistoryPair[]): StruggleSignal[]` method to `memoryService.ts`. Implements regex-based detection for confusion markers and simplification requests. Returns an array of `{ type, concept?, confidence }`. | `memoryService.ts` | 45 min |
| **2.1.2** | Add semantic repetition detection. After concept extraction (P1.2.6), compare the current message's embedding with embeddings of the same concepts from previous sessions. If cosine similarity > 0.7, flag as repeated topic. | `memoryService.ts` | 45 min |
| **2.1.3** | Add `recordStruggle(conceptId: number, signal: StruggleSignal): Promise<void>` method. Increments `struggle_count`, decreases `mastery_level` by 0.1 (clamped), appends struggle context to `summary`. Fires `onDidUpdateConcept` event. | `memoryService.ts` | 30 min |
| **2.1.4** | Wire struggle detection into the post-response pipeline. After concept extraction, run `detectStruggleSignals()` on the user's message and session history. For each detected signal with an associated concept, call `recordStruggle()`. Fire-and-forget. | `defaultParticipant.ts` (post-response block) | 30 min |
| **2.1.5** | Update `formatConceptContext()` to include struggle information. When a concept has `struggle_count > 0`, add a note: "⚠ User has struggled with this topic (N times). Provide extra detail and check understanding." | `memoryService.ts` | 15 min |
| **2.1.6** | Unit tests: (a) confusion markers detected in "I don't understand meiosis"; (b) simplification request detected in "explain it simpler"; (c) repeated topic detected across sessions; (d) `recordStruggle` increments count and decreases mastery; (e) concept context includes struggle warning. | `tests/unit/memoryService.test.ts` | 45 min |

**Verification:** `tsc --noEmit && npx vitest run`

---

### P2.2 Proactive Review Nudges

**Problem:**
The existing `ProactiveSuggestionsService` generates topic clusters and orphan
page detections but has critical gaps:
- `coverage_gap` type is declared but never generated
- Suggestions are in-memory only (lost on restart)
- No UI consumer renders them
- No learning-specific suggestion types exist

This task repurposes and extends the proactive suggestions system to generate
learning-relevant nudges: review reminders, knowledge gap alerts, and
struggle-area prompts.

**New suggestion types:**

| Type | Trigger | Message Example |
|------|---------|-----------------|
| `review_due` | Concept `last_seen > 3 days` AND `mastery_level < 0.7` | "You haven't reviewed **Krebs cycle** in 5 days. Your mastery is 0.4 — want a quick refresher?" |
| `struggle_alert` | Concept `struggle_count >= 3` AND `mastery_level < 0.3` | "You've struggled with **prophase I** across 3 sessions. Want to try a different approach?" |
| `knowledge_gap` | Category has concepts but one key area has no entries (detected via workspace content vs. concept coverage) | "Your biology notes cover mitosis, meiosis, and DNA replication, but you haven't studied **transcription** yet." |
| `mastery_milestone` | Concept `mastery_level >= 0.8` for the first time | "Great progress! You've reached 80% mastery on **cell division**. 🎉" |

**Persistence:**

Extend proactive suggestions with SQLite persistence:

```sql
CREATE TABLE IF NOT EXISTS proactive_suggestions (
  id           TEXT PRIMARY KEY,
  type         TEXT NOT NULL,
  title        TEXT NOT NULL,
  message      TEXT NOT NULL,
  related_ids  TEXT NOT NULL DEFAULT '[]', -- JSON array
  confidence   REAL NOT NULL DEFAULT 0.5,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  dismissed    INTEGER NOT NULL DEFAULT 0,
  acted_on     INTEGER NOT NULL DEFAULT 0
);
```

#### Tasks

| Task | Description | File(s) | Est. |
|------|-------------|---------|------|
| **2.2.1** | Create `proactive_suggestions` table and migrate existing in-memory storage to SQLite. Update `ProactiveSuggestionsService` to read/write from DB. Preserve the existing merge/dismiss logic. | `proactiveSuggestionsService.ts` | 1 hour |
| **2.2.2** | Add `review_due` suggestion generator. Query `learning_concepts` for concepts where `last_seen > 3 days` AND `mastery_level < 0.7`. Generate one suggestion per concept matching the criteria. Cap at 5 review suggestions. | `proactiveSuggestionsService.ts` | 45 min |
| **2.2.3** | Add `struggle_alert` suggestion generator. Query `learning_concepts` for concepts where `struggle_count >= 3` AND `mastery_level < 0.3`. Generate one suggestion per matching concept. | `proactiveSuggestionsService.ts` | 30 min |
| **2.2.4** | Add `mastery_milestone` suggestion generator. Query `learning_concepts` for concepts where `mastery_level >= 0.8` AND concept has never had a milestone suggestion (track via `acted_on` or a separate flag). | `proactiveSuggestionsService.ts` | 30 min |
| **2.2.5** | Implement `knowledge_gap` detection. Compare indexed workspace content topics (from page titles + auto-tags) against `learning_concepts`. Identify topics present in the workspace but absent from concepts. This is the stub that was declared but never built. | `proactiveSuggestionsService.ts` | 1 hour |
| **2.2.6** | Register a `/review` slash command (repurpose the existing code-review one or add `/studyreview`). When invoked, fetches all non-dismissed proactive suggestions sorted by priority (`struggle_alert` > `review_due` > `knowledge_gap` > `mastery_milestone`) and formats them as a markdown list with action prompts. | `chatSlashCommands.ts`, `defaultParticipant.ts` | 45 min |
| **2.2.7** | Unit tests: (a) `review_due` generated for stale concepts; (b) `struggle_alert` generated for high-struggle concepts; (c) persistence survives simulated restart; (d) dismissed suggestions stay dismissed; (e) `/review` command formats suggestions correctly. | `tests/unit/proactiveSuggestions.test.ts` | 45 min |

**Verification:** `tsc --noEmit && npx vitest run`

---

## P3 — Active Learning Tools

These tasks add tools that the student actively uses to learn, rather than
passively receiving information. They require P1.2 (concept schema) as
foundation.

### P3.1 Quiz Generation

**Problem:**
Students learn through testing (the testing effect is one of the most robust
findings in cognitive science). Parallx has all the ingredients — indexed
content, an LLM, concept tracking — but no way to generate or administer quizzes.

**Implementation:**

A new `/quiz` slash command and a `generate_quiz` chat tool that:
1. Takes a topic or concept as input (or uses recent concepts if none specified)
2. Retrieves relevant chunks from the workspace via RAG
3. Prompts the LLM to generate 3–5 questions from the actual content
4. Presents questions one at a time
5. Evaluates the user's answers against the source material
6. Updates concept mastery scores based on performance

**Quiz prompt template:**

```
You are a study tutor. Generate {count} quiz questions about "{topic}" using
ONLY the following source material. Do not use any knowledge outside this context.

[Source material from RAG retrieval]

For each question:
- Type: multiple_choice | short_answer | true_false
- Question text
- Correct answer with explanation referencing the source
- For multiple_choice: 4 options (A–D)
- Difficulty: easy | medium | hard

Output as JSON array. Match difficulty to the user's mastery level: {mastery_level}.
```

**Answer evaluation prompt:**

```
The user was asked: "{question}"
Their answer: "{user_answer}"
The correct answer: "{correct_answer}"
Source material: "{source_chunk}"

Evaluate:
1. Is the answer correct? (yes/partially/no)
2. Brief feedback (1–2 sentences)
3. Mastery adjustment: +0.1 (correct), +0.05 (partial), -0.05 (wrong)

Output as JSON.
```

#### Tasks

| Task | Description | File(s) | Est. |
|------|-------------|---------|------|
| **3.1.1** | Add `generate_quiz` tool definition to the tool registry. Parameters: `topic` (string, optional), `count` (number, default 3), `difficulty` (easy/medium/hard, optional — auto-selected from mastery if omitted). The tool retrieves relevant content via RAG, generates questions via LLM, and returns structured JSON. | `tools/` (new file `studyTools.ts`), `builtInTools.ts` | 1 hour |
| **3.1.2** | Add `evaluate_answer` tool definition. Parameters: `question_id` (string), `user_answer` (string). Evaluates against correct answer + source material. Returns feedback + mastery adjustment. Calls `memoryService.updateMastery()` to adjust the concept's score. | `tools/studyTools.ts`, `builtInTools.ts` | 45 min |
| **3.1.3** | Add `/quiz` slash command. Template: "Generate a quiz about {topic} using my workspace content. Ask questions one at a time and wait for my answer before moving to the next." If no topic specified, select the 3 concepts with lowest mastery from `learning_concepts`. | `chatSlashCommands.ts` | 30 min |
| **3.1.4** | Add `updateMastery(conceptId: number, adjustment: number, source: 'quiz' \| 'conversation'): Promise<void>` method to `IMemoryService`. Clamps mastery_level between 0.0 and 1.0. Fires `onDidUpdateConcept`. | `memoryService.ts`, `serviceTypes.ts` | 20 min |
| **3.1.5** | Add quiz result tracking. New table `quiz_results`: `id`, `concept_id`, `question_text`, `user_answer`, `correct_answer`, `is_correct` (yes/partially/no), `mastery_adjustment`, `created_at`. Used for spaced repetition scheduling (P3.2). | `memoryService.ts` | 30 min |
| **3.1.6** | Unit tests: (a) `generate_quiz` tool returns valid question structure; (b) `evaluate_answer` returns feedback and mastery adjustment; (c) mastery increases on correct answers, decreases on wrong; (d) `/quiz` without topic selects lowest-mastery concepts; (e) quiz results are persisted. | `tests/unit/studyTools.test.ts` | 1 hour |

**Verification:** `tsc --noEmit && npx vitest run`

---

### P3.2 Spaced Repetition Scheduling

**Problem:**
Without spaced repetition, students review randomly — wasting time on topics
they already know while neglecting topics that are fading. SM-2/Anki-style
scheduling is the gold standard for retention.

**Algorithm:**

Use a simplified SM-2 algorithm (same family as Anki):

```
After each review:
  if correct:
    quality = 5 (perfect) or 4 (hesitated) or 3 (difficult but correct)
  if wrong:
    quality = 2 (familiar but wrong) or 1 (wrong) or 0 (blank)

  if quality >= 3:
    if repetition == 0: interval = 1 day
    if repetition == 1: interval = 3 days
    else: interval = previous_interval × ease_factor

    ease_factor = max(1.3, ease_factor + (0.1 - (5 - quality) × (0.08 + (5 - quality) × 0.02)))
    repetition += 1
  else:
    repetition = 0
    interval = 1 day

  next_review = now + interval
```

**Schema:**

```sql
CREATE TABLE IF NOT EXISTS review_schedule (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  concept_id      INTEGER NOT NULL REFERENCES learning_concepts(id),
  ease_factor     REAL    NOT NULL DEFAULT 2.5,
  interval_days   REAL    NOT NULL DEFAULT 1.0,
  repetition      INTEGER NOT NULL DEFAULT 0,
  next_review     TEXT    NOT NULL,
  last_review     TEXT,
  last_quality    INTEGER,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(concept_id)
);

CREATE INDEX IF NOT EXISTS idx_review_due ON review_schedule(next_review);
```

#### Tasks

| Task | Description | File(s) | Est. |
|------|-------------|---------|------|
| **3.2.1** | Create `review_schedule` table. Add to memory service initialization. | `memoryService.ts` | 15 min |
| **3.2.2** | Add `ISpacedRepetitionService` interface to `serviceTypes.ts`. Methods: `scheduleReview(conceptId, quality)`, `getDueReviews(): Promise<ReviewItem[]>`, `getUpcomingReviews(days: number): Promise<ReviewItem[]>`, `recordReview(conceptId, quality)`. | `serviceTypes.ts` | 20 min |
| **3.2.3** | Implement `SpacedRepetitionService extends Disposable`. Implements SM-2 algorithm. On `scheduleReview()`, creates or updates the schedule entry. On `recordReview()`, recomputes interval and ease factor, sets next review date. | New file: `src/services/spacedRepetitionService.ts` | 1.5 hours |
| **3.2.4** | Wire spaced repetition into quiz results (P3.1). After `evaluate_answer`, call `spacedRepetition.recordReview(conceptId, quality)` where quality is mapped from `is_correct`: yes → 5, partially → 3, no → 1. | `tools/studyTools.ts` | 20 min |
| **3.2.5** | Wire into `/review` command (P2.2.6). When `/review` is invoked, include "Due for review today" section from `getDueReviews()`. Sort by urgency (most overdue first). | `chatSlashCommands.ts`, `defaultParticipant.ts` | 30 min |
| **3.2.6** | Add `/study` slash command. Starts a structured study session: fetches due reviews, generates quiz questions for the top 5 due concepts, and guides the user through them. Template: "Start a study session. Review due topics, quiz me on them, and update my progress." | `chatSlashCommands.ts` | 30 min |
| **3.2.7** | Register service in DI. Create in `workbenchServices.ts`, inject `IDatabaseService` and `IMemoryService`. | `workbenchServices.ts`, `chat/main.ts` | 20 min |
| **3.2.8** | Unit tests: (a) SM-2 interval calculation: first review → 1 day, second → 3 days, third → 3 × ease; (b) ease factor adjustment on quality 5 vs 0; (c) failed review resets repetition to 0; (d) `getDueReviews()` returns concepts with `next_review <= now`; (e) quiz integration updates schedule. | `tests/unit/spacedRepetition.test.ts` | 1 hour |

**Verification:** `tsc --noEmit && npx vitest run`

---

## Task Tracker

### P0 — Critical Fixes

| Task | Description | Status | Commit |
|------|-------------|--------|--------|
| 0.1.1 | `_trimToTokenBudget` keepFrom parameter | ⬜ | |
| 0.1.2 | Update `allocate()` callers | ⬜ | |
| 0.1.3 | Unit tests for trimming | ⬜ | |
| 0.2.1 | `keep_alive: '30m'` in chat requests | ⬜ | |
| 0.2.2 | `preloadModel()` on health detection | ⬜ | |
| 0.2.3 | Embedding model pre-warming | ⬜ | |
| 0.2.4 | Parallelize context assembly steps 5–9 | ⬜ | |
| 0.2.5 | Replace overflow summarization with truncation | ⬜ | |
| 0.2.6 | Delete dead `planRetrieval()` code | ⬜ | |
| 0.2.7 | Latency instrumentation | ⬜ | |

### P1 — Memory Intelligence

| Task | Description | Status | Commit |
|------|-------------|--------|--------|
| 1.1.1 | `updated_at` column migration | ⬜ | |
| 1.1.2 | `getMemoryMessageCount()` method | ⬜ | |
| 1.1.3 | Growth-based re-summarization guard | ⬜ | |
| 1.1.4 | Vector embedding update on re-summary | ⬜ | |
| 1.1.5 | Updatable memory unit tests | ⬜ | |
| 1.2.1 | `learning_concepts` table + migration | ⬜ | |
| 1.2.2 | `LearningConcept` TypeScript interface | ⬜ | |
| 1.2.3 | `storeConcepts()` method | ⬜ | |
| 1.2.4 | `recallConcepts()` method | ⬜ | |
| 1.2.5 | `formatConceptContext()` method | ⬜ | |
| 1.2.6 | Concept extraction prompt (combined with summary) | ⬜ | |
| 1.2.7 | Wire concept recall into context assembly | ⬜ | |
| 1.2.8 | Interface updates + DI wiring | ⬜ | |
| 1.2.9 | Concept-level memory unit tests | ⬜ | |
| 1.3.1 | `last_accessed` + `importance` columns | ⬜ | |
| 1.3.2 | Update `last_accessed` on recall | ⬜ | |
| 1.3.3 | Decay score computation | ⬜ | |
| 1.3.4 | Decay-weighted recall ranking | ⬜ | |
| 1.3.5 | `evictStaleContent()` method | ⬜ | |
| 1.3.6 | Eviction trigger on session start | ⬜ | |
| 1.3.7 | Eviction + decay unit tests | ⬜ | |

### P2 — Learning Awareness

| Task | Description | Status | Commit |
|------|-------------|--------|--------|
| 2.1.1 | `detectStruggleSignals()` method | ⬜ | |
| 2.1.2 | Semantic repetition detection | ⬜ | |
| 2.1.3 | `recordStruggle()` method | ⬜ | |
| 2.1.4 | Wire struggle detection post-response | ⬜ | |
| 2.1.5 | Concept context includes struggle info | ⬜ | |
| 2.1.6 | Struggle detection unit tests | ⬜ | |
| 2.2.1 | Persistent proactive suggestions (SQLite) | ⬜ | |
| 2.2.2 | `review_due` suggestion generator | ⬜ | |
| 2.2.3 | `struggle_alert` suggestion generator | ⬜ | |
| 2.2.4 | `mastery_milestone` suggestion generator | ⬜ | |
| 2.2.5 | `knowledge_gap` detection (the missing stub) | ⬜ | |
| 2.2.6 | `/review` slash command | ⬜ | |
| 2.2.7 | Proactive suggestions unit tests | ⬜ | |

### P3 — Active Learning Tools

| Task | Description | Status | Commit |
|------|-------------|--------|--------|
| 3.1.1 | `generate_quiz` tool | ⬜ | |
| 3.1.2 | `evaluate_answer` tool | ⬜ | |
| 3.1.3 | `/quiz` slash command | ⬜ | |
| 3.1.4 | `updateMastery()` method | ⬜ | |
| 3.1.5 | `quiz_results` table | ⬜ | |
| 3.1.6 | Quiz generation unit tests | ⬜ | |
| 3.2.1 | `review_schedule` table | ⬜ | |
| 3.2.2 | `ISpacedRepetitionService` interface | ⬜ | |
| 3.2.3 | SM-2 algorithm implementation | ⬜ | |
| 3.2.4 | Wire spaced rep into quiz results | ⬜ | |
| 3.2.5 | Due reviews in `/review` command | ⬜ | |
| 3.2.6 | `/study` slash command | ⬜ | |
| 3.2.7 | Service DI registration | ⬜ | |
| 3.2.8 | Spaced repetition unit tests | ⬜ | |

**Total: 48 tasks across 4 priority tiers.**

---

## Verification Checklist

After each task:
- [ ] `tsc --noEmit` — zero errors
- [ ] `npx vitest run` — all tests pass
- [ ] Git commit: `M17 Task X.Y.Z: <description>`

After P0 complete:
- [ ] Manual test: RAG query — verify highest-scored chunks survive budget trimming
- [ ] Manual test: send message after 10-min idle — first token in < 5s (not 15–30s)
- [ ] Manual test: send message immediately after launch — model preloaded
- [ ] Latency log shows context assembly < 200ms (not 500–1000ms)

After P1 complete:
- [ ] Manual test: 10-message session → memory updates at message 6 (not frozen at 3)
- [ ] Manual test: discuss a topic → concept appears in `learning_concepts` table
- [ ] Manual test: next session, ask about same topic → concept context appears in response
- [ ] Manual test: after 90+ days idle, stale low-value memories are evicted

After P2 complete:
- [ ] Manual test: ask confused questions about topic → `struggle_count` increments
- [ ] Manual test: `/review` command shows prioritized review list
- [ ] Manual test: proactive suggestions persist across app restart

After P3 complete:
- [ ] Manual test: `/quiz biology` generates questions from indexed notes
- [ ] Manual test: answering quiz updates mastery score
- [ ] Manual test: `/study` shows due reviews and starts quiz session
- [ ] Manual test: SM-2 intervals increase on consecutive correct answers

---

## File Impact Map

| File | Tasks | Changes |
|------|-------|---------|
| `src/services/tokenBudgetService.ts` | 0.1.1, 0.1.2 | `keepFrom` parameter, caller updates |
| `src/built-in/chat/providers/ollamaProvider.ts` | 0.2.1, 0.2.2, 0.2.3, 0.2.6 | `keep_alive`, preloadModel, dead code removal |
| `src/services/embeddingService.ts` | 0.2.3 | Pre-warm method |
| `src/built-in/chat/participants/defaultParticipant.ts` | 0.2.4, 0.2.5, 0.2.7, 1.1.3, 1.2.6, 1.2.7, 2.1.4 | Context parallelization, overflow fix, latency logging, memory guards, concept extraction, struggle detection |
| `src/services/memoryService.ts` | 1.1.1, 1.1.2, 1.1.4, 1.2.1, 1.2.3, 1.2.4, 1.2.5, 1.3.1–1.3.5, 2.1.1–2.1.3, 2.1.5, 3.1.4, 3.1.5 | Schema migrations, concept storage/recall, decay, eviction, struggle detection, mastery updates |
| `src/services/serviceTypes.ts` | 1.1.2, 1.2.2, 1.2.8, 1.3.x, 2.1.x, 3.1.4, 3.2.2 | Interface extensions for all new methods |
| `src/built-in/chat/chatTypes.ts` | 1.1.3, 1.2.8 | `ChatRequestServices` type updates |
| `src/built-in/chat/data/chatDataService.ts` | 1.1.3, 1.2.8, 1.3.6 | Wire new memory/concept methods, eviction trigger |
| `src/services/proactiveSuggestionsService.ts` | 2.2.1–2.2.5 | SQLite persistence, 4 new suggestion types, knowledge gap implementation |
| `src/built-in/chat/config/chatSlashCommands.ts` | 2.2.6, 3.1.3, 3.2.5, 3.2.6 | `/review`, `/quiz`, `/study` commands |
| `src/built-in/chat/tools/studyTools.ts` | 3.1.1, 3.1.2, 3.2.4 | **New file** — quiz + answer evaluation tools |
| `src/built-in/chat/tools/builtInTools.ts` | 3.1.1, 3.1.2 | Register study tools |
| `src/services/spacedRepetitionService.ts` | 3.2.3 | **New file** — SM-2 implementation |
| `src/workbench/workbenchServices.ts` | 3.2.7 | DI registration for spaced repetition service |
| `src/built-in/chat/main.ts` | 3.2.7 | Tool registration for study tools |

### New Files

| File | Purpose |
|------|---------|
| `src/built-in/chat/tools/studyTools.ts` | `generate_quiz` + `evaluate_answer` tool implementations |
| `src/services/spacedRepetitionService.ts` | SM-2 spaced repetition algorithm + schedule management |
| `tests/unit/studyTools.test.ts` | Study tool unit tests |
| `tests/unit/spacedRepetition.test.ts` | SM-2 algorithm unit tests |

---

## Risk Register

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Concept extraction LLM quality** | Small local models may extract poor concepts (too generic, missing key topics) | Use structured JSON output format with examples. Validate extraction results. Allow user correction via `/forget concept` command. Start with conservative extraction (fewer, higher-confidence concepts). |
| **Concept deduplication** | "prophase", "Prophase I", "prophase 1", "early prophase" may create separate entries | Normalize concept names: lowercase, strip numbers, use embedding similarity (> 0.85) to merge near-duplicates on `storeConcepts()`. |
| **Fire-and-forget LLM overload** | Post-response fires: preference extraction + session summary + concept extraction + struggle detection = 2–3 LLM calls silently | Combine into a single post-response LLM call with a unified prompt that outputs summary + concepts + struggle signals in one JSON response. Share the LLM connection. |
| **Quiz quality on small models** | 7B–8B models may generate trivial or incorrect quiz questions | Include source material in the prompt so answers are grounded. Add a self-check step: "Verify each answer against the source material before outputting." Grade questions by model confidence. |
| **SM-2 cold start** | New concepts have no review history — SM-2 starts with interval=1 day, which may spam the user | Only schedule reviews for concepts that have been encountered 2+ times. First encounter creates the concept; second encounter creates the review schedule. |
| **Memory table migrations** | `ALTER TABLE` on existing DBs with data | Use `ALTER TABLE ... ADD COLUMN` which SQLite supports safely. No data loss. Test migration on a DB with existing data. |
| **Proactive suggestion spam** | Too many nudges annoy the user | Cap at 5 active suggestions. Priority ranking ensures the most important appear first. Dismissed suggestions stay dismissed. Add a global "suggestions enabled" toggle via AI Settings (M15). |
| **`keep_alive` VRAM usage** | 30-minute keep_alive keeps the model loaded, consuming 4–16 GB VRAM | Document VRAM requirements. Make `keep_alive` duration configurable via AI Settings. Default 30 min is reasonable for active study sessions. |

---

## Appendix A: Existing Infrastructure Leveraged

| Service | How It's Used in M17 |
|---------|---------------------|
| `IMemoryService` | Extended with concepts, struggle tracking, mastery — not replaced |
| `IEmbeddingService` + `IVectorStoreService` | Concept embeddings stored alongside page/file embeddings. Same hybrid search for recall |
| `IRetrievalService` | Powers quiz question generation — retrieves relevant chunks for question context |
| `ProactiveSuggestionsService` | Extended with 4 learning-specific suggestion types + SQLite persistence |
| `IAutoTaggingService` | Category assignment for concept extraction (optional enrichment) |
| `IRelatedContentService` | "Study X next because it builds on Y" logic for knowledge gap detection |
| `IDatabaseService` | All new tables use existing SQLite infrastructure |
| `SlashCommandRegistry` | `/quiz`, `/review`, `/study` registered via existing pattern |
| `ILanguageModelToolsService` | `generate_quiz`, `evaluate_answer` registered as built-in tools |
| `AI Settings` (M15) | Suggestions toggle, keep_alive duration, study mode personality overlay |

## Appendix B: Schema Summary

All new tables created by M17:

```sql
-- P1.2: Concept tracking
CREATE TABLE learning_concepts (
  id, concept, category, summary, mastery_level, encounter_count,
  struggle_count, first_seen, last_seen, last_accessed, source_sessions,
  decay_score
);

-- P2.2: Persistent proactive suggestions
CREATE TABLE proactive_suggestions (
  id, type, title, message, related_ids, confidence, created_at,
  dismissed, acted_on
);

-- P3.1: Quiz result history
CREATE TABLE quiz_results (
  id, concept_id, question_text, user_answer, correct_answer,
  is_correct, mastery_adjustment, created_at
);

-- P3.2: Spaced repetition schedule
CREATE TABLE review_schedule (
  id, concept_id, ease_factor, interval_days, repetition,
  next_review, last_review, last_quality, created_at
);
```

Columns added to existing tables:

```sql
-- conversation_memories
ALTER TABLE conversation_memories ADD COLUMN updated_at TEXT;
ALTER TABLE conversation_memories ADD COLUMN last_accessed TEXT;
ALTER TABLE conversation_memories ADD COLUMN importance REAL DEFAULT 0.5;
```
