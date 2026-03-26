# Parallx Deep Audit v2 — Post-M43 Gap Analysis

> **Branch:** `m43-reliability-hardening` | **Baseline:** 0 compile errors, 2,446 tests pass  
> **Date:** Post-M43 | **Purpose:** Second-pass deep audit after M43 closed the original 15 gaps

---

## Context

M43 addressed all 15 non-Parallx gaps from v1 (5 🔴 CRITICAL + 10 🟡 PARITY). This second pass uses 5 parallel research agents covering:
1. OpenClaw core loop
2. Chat service & data layer
3. Tool system & permissions
4. Prompt construction & rendering
5. Indexing, retrieval & embeddings

**Method:** Each agent reported raw findings. Critical items were then spot-checked against actual source code. False positives are marked and excluded from action items.

---

## How to Read This Document

| Tag | Meaning |
|-----|---------|
| 🔴 CRITICAL | Crashes, data loss, security — must fix |
| 🟡 MEDIUM | Silent failures, wrong behavior, missing guards |
| 🟢 LOW | Polish, edge cases, performance |
| ❌ FALSE POSITIVE | Reported by agent but verified as incorrect |

---

## False Positives (Excluded)

These were flagged by research agents but verified as not real issues:

| Claim | Verdict |
|-------|---------|
| XSS via markdown-it HTML entities (R-1, R-4) | `html: false` escapes all raw HTML. MarkdownIt does NOT decode entities back. Safe. |
| FTS5 errors crash retrieval (RAG C2) | FTS5 queries ARE wrapped in try/catch returning `[]` on error (line ~870). |
| CancellationTokenSource leak on error (C4) | Catch block doesn't rethrow — execution continues to `cts.dispose()` at L1092. |
| Token budget 0 misinterpreted (RAG C5) | Explicit 0 is a valid edge case but callers never pass 0; internal-only. |
| RRF ×2 score scaling bug (RAG C1) | Single-path scaling is intentional design for normalization. Not fragile. |
| Session adoption silently tags wrong workspace (M18) | Workspace adoption runs once on open; tags sessions with empty ID. By design. |

---

## 1 — CRITICAL (🔴)

### 1.1 Path Traversal in `readFileRelative` (Security)
- **Where:** `chatDataService.ts` L1567–1575, `openclawTurnPreprocessing.ts` L264
- **Problem:** `readFileRelative()` passes user-supplied paths to `fsAccessor.readFile()` without path traversal validation. `normalizeWorkspaceRelativePath()` strips `./` and leading `/` but does NOT strip `..`. A user typing `#file:../../.env` or the model suggesting such references can read files outside the workspace.
- **Verified:** `writeFileRelative()` (L1580) properly uses `rootUri.joinPath(clean)` which scopes to workspace, but `readFileRelative()` doesn't normalize at all.
- **Impact:** Arbitrary file read outside workspace boundary.
- **Fix:** Apply `normalizeWorkspaceRelativePath()` + reject paths containing `..` segments.

### 1.2 `saveSession()` Has No Transaction (Data Integrity)
- **Where:** `chatSessionPersistence.ts` L108–145
- **Problem:** `saveSession()` does INSERT OR REPLACE → DELETE all messages → INSERT each message pair, all as separate statements. No `BEGIN`/`COMMIT` transaction. If app crashes between DELETE and re-INSERT, all messages for that session are lost. Mid-save, readers see session with zero messages.
- **Verified:** No `BEGIN` or `TRANSACTION` anywhere in the file.
- **Impact:** Data loss on crash. Corrupt reads during save.
- **Fix:** Wrap in `BEGIN IMMEDIATE` / `COMMIT`.

### 1.3 Persistence Errors Silently Swallowed (Data Loss)
- **Where:** `chatService.ts` L789, L792, L841, L845
- **Problem:** `saveSession()`, `writeSessionTranscript()`, `deletePersistedSession()` all have `.catch(() => { /* best-effort */ })`. If disk is full, DB is locked, or I/O fails, the user's conversation is lost with zero indication.
- **Verified:** 5 separate `.catch(() => {})` patterns in the file.
- **Impact:** Silent data loss. User believes conversation is saved.
- **Fix:** At minimum, log errors. Ideally surface a non-blocking "save failed" indicator.

### 1.4 `compact()` Unhandled on 3 Code Paths (Turn Crash)
- **Where:**
  - `openclawTurnRunner.ts` L119 — auto-compact before turn
  - `openclawTurnRunner.ts` L147–158 — compact inside error recovery catch blocks
  - `openclawAttempt.ts` L287–298 — mid-loop compact after tool results
- **Problem:** All three `compact()` calls lack try/catch. If the summarization model call fails (Ollama down, timeout, OOM), the entire turn crashes. In the error-recovery paths (L147), a compact() failure masks the original error.
- **Verified:** No try/catch wrapping any of these calls.
- **Impact:** Turn failure when compact fails. User sees no response.
- **Fix:** Wrap each in try/catch. On failure, log + continue without compaction (better to overflow than crash).

### 1.5 Embedding Dimension Mismatch Corrupts Index
- **Where:** `embeddingService.ts` L332–342
- **Problem:** If Ollama returns embeddings with wrong dimensions (model mismatch, version change), the service only `console.warn`s but proceeds to insert into the vec0 table. sqlite-vec will either crash on dimension mismatch or store garbage vectors that corrupt similarity search.
- **Verified:** Line 336-340 shows warn-only, with return of the bad embeddings.
- **Impact:** Index corruption. All subsequent retrieval returns wrong results.
- **Fix:** Throw on dimension mismatch instead of warn. Caller can catch and surface error.

---

## 2 — MEDIUM (🟡)

### 2.1 No Tool Execution Timeout
- **Where:** `languageModelToolsService.ts` L273
- **Problem:** `await tool.handler(args, token)` has no timeout. If a tool hangs (infinite loop, network wait), the session is permanently stuck. Relies entirely on CancellationToken which only works if the tool checks it.
- **Fix:** `Promise.race()` with configurable timeout (e.g. 300s).

### 2.2 No Tool Result Size Limit at Service Layer
- **Where:** `languageModelToolsService.ts` L273, `openclawAttempt.ts` L254
- **Problem:** Tool result content is unbounded at the service layer. The 20K char truncation only exists at the agent layer. A buggy tool returning massive output consumes intermediate memory before truncation.
- **Fix:** Enforce `MAX_TOOL_RESULT_CHARS` at service layer, not just agent.

### 2.3 Concurrent Request Race Condition
- **Where:** `chatService.ts` L867–921
- **Problem:** `requestInProgress` is checked at L871 but set at L935 — 60+ lines of async setup later. Two rapid submits could both pass the check.
- **Fix:** Set `requestInProgress = true` immediately after the check, before any async work.

### 2.4 System Prompt Exceeds 10% Budget Unchecked 
- **Where:** `chatSystemPromptComposer.ts` L19–40
- **Problem:** SOUL.md + AGENTS.md + TOOLS.md + rules are concatenated without token budget check. If workspace has large prompt files, system prompt can consume most of the context window, leaving insufficient space for query + history.
- **Fix:** Estimate system prompt tokens after assembly; truncate or warn if > 10% of model context.

### 2.5 Memory Decay Never Persisted
- **Where:** `memoryService.ts` L481–513
- **Problem:** `computeDecayScore()` is calculated on recall and applied to ranking, but the computed decay score is never written back to DB. The `last_accessed` timestamp update is fire-and-forget (`.catch(() => {})`). Net effect: memories never truly age, eviction logic is broken.
- **Fix:** Update `decay_score` in DB after recall. Await `last_accessed` update (or at least log failures).

### 2.6 Foreign Keys Not Enabled
- **Where:** `chatSessionPersistence.ts` — entire file
- **Problem:** `PRAGMA foreign_keys = ON` is never called. SQLite FKs are disabled by default. `DELETE FROM chat_sessions` doesn't cascade to `chat_messages`. Orphan messages can accumulate.
- **Fix:** Add `PRAGMA foreign_keys = ON` after DB open.

### 2.7 Schema Migration Errors Silently Caught
- **Where:** `chatSessionPersistence.ts` L95–104, `memoryService.ts` L316–330
- **Problem:** `ALTER TABLE` migrations are wrapped in catch-all try/catch. If migration fails (permissions, read-only, schema lock), the column is never added. Next query assumes column exists → cryptic SQL error.
- **Fix:** After migration, validate column actually exists. Or re-throw non-"duplicate column" errors.

### 2.8 Retrieval Failure Returns `undefined` Silently
- **Where:** `chatDataService.ts` L962–980
- **Problem:** If retrieval service throws, error is caught and `undefined` returned. Upstream participant has no way to distinguish "no results" from "retrieval crashed." User sees no results, no error.
- **Fix:** Return a result object with error flag, or re-throw and let participant handle.

### 2.9 `readFileRelative` Has No File Size Limit
- **Where:** `chatDataService.ts` L1567–1575
- **Problem:** User types `#file:huge-database.sql`. The 500MB file is loaded entirely into memory via `fsAccessor.readFile()`. No size check before reading.
- **Fix:** Stat file before read; reject if > `MAX_FILE_READ_BYTES` (e.g. 1MB).

### 2.10 Temperature / maxTokens Not Validated
- **Where:** `unifiedAIConfigService.ts` L587, `modelSection.ts` L60–90
- **Problem:** UI slider bounds temperature 0–100 → 0.0–1.0, but direct config edit (`.parallx/config.json`) can set temperature: -0.5 or maxTokens > contextWindow. Unvalidated values passed directly to Ollama.
- **Fix:** Clamp temperature to [0, 2]. Validate maxTokens < contextWindow.

### 2.11 Concurrent Tool Approval Race
- **Where:** `permissionService.ts` L296
- **Problem:** Two simultaneous tools requiring approval fire separate confirmation dialogs. No serialization/queueing. Approval state could race.
- **Fix:** Queue approval requests with a semaphore.

### 2.12 Model Probe Failure → Wrong Token Budget
- **Where:** `languageModelsService.ts` L244–252
- **Problem:** `getModelInfo()` is fire-and-forget. If Ollama is temporarily unreachable during probe, context window defaults to 4096. Token budget bar shows wrong values for entire session. No retry.
- **Fix:** Retry probe 3× with backoff. Surface warning if probe fails.

### 2.13 All-Tools-Failed Scenario Not Detected
- **Where:** `openclawAttempt.ts` L218–270
- **Problem:** If every tool call in a batch returns `isError: true`, there's no special handling. Model continues with only error results — no recovery prompt, no escalation.
- **Fix:** Detect all-error batch. Inject recovery prompt: "All tool calls failed. Consider alternative approaches."

### 2.14 Markdown Discarded After Mid-Loop Compaction
- **Where:** `openclawAttempt.ts` L309
- **Problem:** After mid-loop compaction, `markdown = ''` resets accumulated output. If the loop exits next iteration, intermediate markdown is lost.
- **Fix:** Preserve pre-compaction markdown in a separate accumulator.

### 2.15 Prompt File Load Errors Silent
- **Where:** `promptFileService.ts` L301–340
- **Problem:** SOUL.md/AGENTS.md/TOOLS.md load catches ALL errors and returns fallback content. Corrupted file vs missing file are indistinguishable. User gets no indication their custom prompt was skipped.
- **Fix:** Log the error. Return fallback for "not found"; throw for corruption/permission errors.

### 2.16 `.parallxignore` Not Invalidated on Change
- **Where:** `writeTools.ts` L29–56, `main.ts` L805–825
- **Problem:** `.parallxignore` is loaded once and cached module-level. If user updates the file mid-session, stale rules remain in effect until restart.
- **Fix:** Add file watcher or re-load on each tool invocation.

### 2.17 Audit Log Unbounded
- **Where:** `permissionService.ts` L87–88
- **Problem:** `_auditLog: IApprovalAuditEntry[]` grows without bound. Long sessions accumulate thousands of entries.
- **Fix:** Circular buffer with `MAX_AUDIT_LOG = 1000`.

### 2.18 `renderContentPart()` Missing Default Case
- **Where:** `chatContentParts.ts` L40–65
- **Problem:** Big switch statement with no default case. Unknown `part.kind` returns `undefined`, crashing DOM append downstream.
- **Fix:** Add default case returning a placeholder element.

### 2.19 Summarization Failure Silent
- **Where:** `openclawContextEngine.ts` L329–343
- **Problem:** If `sendSummarizationRequest()` fails during compact, a placeholder `'[compacted by context engine]'` is used. No logging, no user indication that history was lost rather than summarized.
- **Fix:** Log the error. Include "[summarization failed]" marker so user knows context was dropped, not summarized.

---

## 3 — LOW (🟢)

### 3.1 Skill Loader YAML Errors Silent
- **Where:** `skillLoaderService.ts` L440–455
- **Problem:** Parse/validation errors for workspace skills silently `continue`. User can't diagnose why their custom skill isn't loading.
- **Fix:** `console.warn` with skill name and error message.

### 3.2 Unknown Slash Commands Silent
- **Where:** `chatRequestParser.ts` L36–54
- **Problem:** `/unknownCommand` is extracted and passed downstream where it's silently ignored.
- **Fix:** Check command registry; show "Unknown command" message.

### 3.3 Unknown @Participant Silent Fallback
- **Where:** `chatAgentService.ts` L100–115
- **Problem:** `@unknownAgent` silently routes to default participant. User thinks they're talking to a specific agent.
- **Fix:** Show "Unknown participant, using default" message.

### 3.4 File Attachment No Size Check
- **Where:** `chatContextAttachments.ts` L200–250
- **Problem:** Pasted images added without size validation. Could submit 500MB image to context pipeline.
- **Fix:** Reject attachments > 10MB with toast.

### 3.5 Memory Eviction Not Transactional
- **Where:** `memoryService.ts` L900–950
- **Problem:** Eviction SELECT + DELETE loop not wrapped in transaction. Partial eviction on crash.
- **Fix:** Wrap in transaction.

### 3.6 Autocomplete Dropdown Not Disposed
- **Where:** `chatMentionAutocomplete.ts` L101–130
- **Problem:** Mention dropdown DOM not cleaned up when chat widget is disposed. Memory leak.
- **Fix:** Add `dispose()` cleanup.

### 3.7 SQLITE_BUSY Not Handled
- **Where:** `chatSessionPersistence.ts` — all operations
- **Problem:** No retry on SQLITE_BUSY. Under rare concurrency conditions, operations fail immediately.
- **Fix:** Add 1–3 retries with short backoff.

### 3.8 `contextWindow` Not Persisted After UI Change
- **Where:** `unifiedAIConfigService.ts`
- **Problem:** UI changes to contextWindow update memory but aren't saved to `.parallx/config.json`. Lost on restart.
- **Fix:** Persist alongside other model settings.

### 3.9 Built-In Skills Overly Permissive
- **Where:** `builtInSkillManifests.ts`
- **Problem:** `scoped-extraction` and `exhaustive-summary` are `always-allowed` but can enumerate entire workspace. No depth/size limit.
- **Fix:** Change to `requires-approval` or add loop limit.

### 3.10 Empty/Zero Budget Edge Cases
- **Where:** `openclawTokenBudget.ts` L56–66
- **Problem:** `computeTokenBudget(0)` returns all-zero splits. `trimTextToBudget()` with negative budget returns empty string via `text.slice(-0)`.
- **Fix:** Guard with `Math.max(budget, MIN_BUDGET)`.

---

## Summary

| Severity | Count | Theme |
|----------|-------|-------|
| 🔴 CRITICAL | 5 | 1 security, 2 data integrity, 1 turn crash, 1 index corruption |
| 🟡 MEDIUM | 19 | Silent failures, missing guards, race conditions, stale config |
| 🟢 LOW | 10 | Polish, edge cases, performance |
| ❌ FALSE POSITIVE | 6 | Excluded after source verification |

**Total actionable:** 34 gaps across 5 severity-critical + 19 medium + 10 low.

---

## Recommended Milestone Structure

| Phase | Focus | Gaps | Effort |
|-------|-------|------|--------|
| 1 — Security & Data Integrity | Path traversal, transactions, persistence logging | 1.1, 1.2, 1.3, 1.5 | M |
| 2 — Crash Resilience | compact() safety, tool timeouts, concurrent races | 1.4, 2.1, 2.3, 2.11, 2.13, 2.14 | M |
| 3 — Budget & Config Guards | System prompt budget, temperature validation, probe retry, file size limits | 2.4, 2.9, 2.10, 2.12, 3.10 | M |
| 4 — Memory & Persistence Hygiene | FK enforcement, decay persistence, migration validation, transactions | 2.5, 2.6, 2.7, 2.8, 2.19, 3.5, 3.7 | M |
| 5 — UX Feedback & Polish | Silent failures → user indicators, skill errors, unknown commands, audit bounds | 2.15, 2.16, 2.17, 2.18, 3.1–3.4, 3.6, 3.8, 3.9 | L |
