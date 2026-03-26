# Milestone 44 — Defensive Hardening

> **Branch:** `m44-defensive-hardening`  
> **Base:** `m43-reliability-hardening` @ `cdb4e11`  
> **HEAD:** `c245d41`  
> **Compile:** 0 errors | **Tests:** 152 files, 2,446 passing  

---

## Objective

Address all actionable gaps from the v2 deep audit (`DEEP_AUDIT_GAP_ANALYSIS_v2.md`). The audit identified 34 items (5 CRITICAL, 19 MEDIUM, 10 LOW) plus 6 false positives. M44 resolved all 5 CRITICAL items and 10 additional MEDIUM/LOW items — 15 fixes total — and verified 5 more items as additional false positives during implementation.

---

## Commits

| # | Hash | Phase | Summary |
|---|------|-------|---------|
| 1 | `b3f16bc` | Security & Data Integrity | Path traversal guard, saveSession transaction, error logging, embedding dimension throw |
| 2 | `e9ff9ac` | Crash Resilience | compact() try/catch on 4 call sites, all-tools-failed detection |
| 3 | `1294f55` | Budget & Config Guards | System prompt budget enforcement, temperature/topP/maxTokens clamping, model probe retry |
| 4 | `d99a543` | Memory & Persistence Hygiene | Eviction transaction, error logging in memoryService, migration logging |
| 5 | `c245d41` | UX Feedback & Polish | renderContentPart default case, audit log bounded to 500, image attachment 10MB limit |

---

## Phase Details

### Phase 1: Security & Data Integrity (`b3f16bc`)

| Gap | File | Change |
|-----|------|--------|
| 1.1 Path traversal | `chatDataService.ts` | `normalizeWorkspaceRelativePath()` now rejects paths containing `..` segments |
| 1.2 No transaction | `chatSessionPersistence.ts` | `saveSession()` wrapped in `BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK` |
| 1.3 Silent .catch | `chatService.ts` | 7 `.catch(() => {})` → `.catch(e => console.error(...))` |
| 1.5 Dimension mismatch | `embeddingService.ts` | `console.warn()` → `throw new Error()` on wrong dimensions |

### Phase 2: Crash Resilience (`e9ff9ac`)

| Gap | File | Change |
|-----|------|--------|
| 1.4 compact() unhandled | `openclawAttempt.ts` | Mid-loop compact wrapped in try/catch |
| 1.4 compact() unhandled | `openclawTurnRunner.ts` | Auto-compact, overflow, and timeout compact wrapped in try/catch |
| 2.13 All-tools-failed | `openclawAttempt.ts` | Detects when every tool result starts with `Error:` / `error:`, breaks loop |

**Verified non-gaps:**
- 2.3 `requestInProgress` race — already set synchronously at L936 before any `await`
- 2.11 Concurrent approval — `confirmToolInvocation` is `await`ed inside a sequential `for` loop

### Phase 3: Budget & Config Guards (`1294f55`)

| Gap | File | Change |
|-----|------|--------|
| 2.4 System prompt budget | `openclawAttempt.ts` | Estimates tokens, truncates system prompt if >10% of context window |
| 2.10 Temperature/topP | `ollamaProvider.ts` | Clamped: temperature [0,2], topP [0,1], maxTokens >0 |
| 2.12 Model probe failure | `languageModelsService.ts` | 3× retry with exponential backoff (1s/2s/4s) |

**Verified non-gap:**
- 2.9 `readFileRelative` file size — already has `MAX_FILE_READ_BYTES = 50 * 1024` guard

### Phase 4: Memory & Persistence Hygiene (`d99a543`)

| Gap | File | Change |
|-----|------|--------|
| 3.5 Eviction not transactional | `memoryService.ts` | `evictStaleContent()` wrapped in `BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK` |
| 2.5 Silent catch in memory | `memoryService.ts` | 7 silent catch blocks → `console.error` logging |
| 2.7 Migration errors silent | `chatSessionPersistence.ts` | Migration catch block now logs with `console.warn` |

**Verified non-gap:**
- 2.6 Foreign keys — `PRAGMA foreign_keys = ON` already set in `electron/database.cjs` L54

### Phase 5: UX Feedback & Polish (`c245d41`)

| Gap | File | Change |
|-----|------|--------|
| 2.18 No default case | `chatContentParts.ts` | Default case returns `div.parallx-chat-unknown-part` with visible text |
| 2.17 Audit log unbounded | `permissionService.ts` | `_audit()` helper, `_MAX_AUDIT_LOG_SIZE = 500`, trims oldest on overflow |
| 3.4 Image no size check | `chatContextAttachments.ts` | 10MB limit on `addPastedImage()` |

**Verified non-gap:**
- 2.16 `.parallxignore` invalidation — already cleared on workspace switch at `main.ts` L1361

---

## Additional False Positives Discovered During Implementation

| Audit Item | Finding |
|------------|---------|
| 2.3 requestInProgress race | `session.requestInProgress = true` set synchronously at L936, before any async work |
| 2.6 Foreign keys not enabled | `PRAGMA foreign_keys = ON` already in `electron/database.cjs` L54 |
| 2.9 readFileRelative no size limit | `MAX_FILE_READ_BYTES = 50 * 1024` guard exists in `buildFileSystemAccessor.readFile()` |
| 2.11 Concurrent approval race | `confirmToolInvocation` is sequentially `await`ed in a `for` loop |
| 2.16 .parallxignore not invalidated | `_writerIgnoreInstance = undefined` at `main.ts` L1361 on workspace switch |

---

## Remaining Open Items (Deferred)

These are genuine but lower-priority items not addressed in M44:

| # | Gap | Reason Deferred |
|---|-----|-----------------|
| 2.1 | Tool execution timeout | Requires `Promise.race()` refactor + configurable timeout UX |
| 2.2 | Tool result size limit at service layer | Agent layer truncation at 20K is sufficient for now |
| 2.8 | Retrieval failure returns undefined | Needs result object redesign across retrieval pipeline |
| 2.14 | Markdown lost after mid-loop compaction | Edge case; compaction resets are intentional for token management |
| 2.15 | Prompt file load errors silent | Low impact; fallback content works correctly |
| 2.19 | Summarization failure silent | Low impact; placeholder marker already inserted |
| 3.1 | Skill loader YAML errors silent | Polish |
| 3.2 | Unknown slash commands silent | Polish |
| 3.3 | Unknown @participant silent | Polish |
| 3.6 | Autocomplete dropdown not disposed | Minor memory leak |
| 3.7 | SQLITE_BUSY not handled | Rare in single-process architecture |
| 3.8 | contextWindow not persisted after UI change | Config persistence enhancement |
| 3.9 | Built-in skills overly permissive | Design decision, not a bug |
| 3.10 | Empty/zero budget edge cases | Internal-only callers never pass 0 |

---

## Files Modified

| File | Phases |
|------|--------|
| `src/built-in/chat/data/chatDataService.ts` | 1 |
| `src/services/chatSessionPersistence.ts` | 1, 4 |
| `src/services/chatService.ts` | 1 |
| `src/services/embeddingService.ts` | 1 |
| `src/openclaw/openclawAttempt.ts` | 2, 3 |
| `src/openclaw/openclawTurnRunner.ts` | 2 |
| `src/built-in/chat/providers/ollamaProvider.ts` | 3 |
| `src/services/languageModelsService.ts` | 3 |
| `src/services/memoryService.ts` | 4 |
| `src/services/permissionService.ts` | 5 |
| `src/built-in/chat/rendering/chatContentParts.ts` | 5 |
| `src/built-in/chat/input/chatContextAttachments.ts` | 5 |
