# Chat Workspace Session Scoping — Research + Execution Plan (March 3, 2026)

## Why this is needed

User expectation is correct: switching workspace must switch chat context deterministically. A chat session should never leak across workspace boundaries.

Current implementation is only *implicitly scoped* by whichever database file is currently bound. This is brittle when workspace identity changes but DB path overlap or event ordering creates ambiguity.

## Current-state research (code-traced)

### 1) Session model has no explicit workspace key
- `IChatSession` in `src/services/chatTypes.ts` does not include `workspaceId`.
- `ChatService.createSession()` in `src/services/chatService.ts` creates session UUID + metadata only.

### 2) Persistence schema has no workspace column
- `chat_sessions` table in `src/services/chatSessionPersistence.ts` currently has:
  - `id`, `title`, `mode`, `model_id`, `created_at`, `updated_at`
- `loadSessions()` loads all sessions from table by `updated_at DESC` with no workspace filter.
- `searchSessions()` and `searchSessionsSemantic()` also have no workspace filter.

### 3) Switch flow ordering is intended but still timing-sensitive
- Workbench switch (`src/workbench/workbench.ts`) does:
  1. fire workspace-switch event
  2. restore folders
  3. await DB open for new workspace
  4. bind DB to `ChatService`
  5. call `chatService.restoreSessions()`
  6. start indexing pipeline
- Chat tool switch handler (`src/built-in/chat/main.ts`) also resets sessions and creates a fresh active session.

### 4) Existing recent fix
- `ChatService.resetForWorkspaceSwitch()` was changed to clear in-memory sessions but defer restore until DB rebind, to avoid restoring from old DB mid-switch.

## Deterministic target behavior

1. Every chat session has `workspaceId`.
2. Every persistence operation is scoped by `workspaceId`:
   - save/update
   - load
   - delete
   - search
3. On workspace switch:
   - active chat workspace scope is updated first,
   - in-memory sessions are cleared,
   - restore loads only sessions matching new `workspaceId`.
4. Indexing remains cancellable and starts only after DB is open for new workspace (already in place).

## Execution steps

### Step A — Type + service surface
- Add `workspaceId` to `IChatSession`.
- Add `setWorkspaceScope(workspaceId: string)` to `IChatService`.
- `ChatService` stores current workspace scope in private field and stamps all new sessions with it.

### Step B — Schema + migration
- Add `workspace_id TEXT NOT NULL DEFAULT ''` column to `chat_sessions` (safe migration in `ensureChatTables`).
- Add index on `(workspace_id, updated_at DESC)`.

### Step C — Scoped persistence APIs
- Update persistence functions signatures to include `workspaceId` where required:
  - `saveSession(db, session, workspaceId?)`
  - `loadSessions(db, workspaceId)`
  - `deletePersistedSession(db, sessionId, workspaceId?)`
  - `searchSessions(db, workspaceId, query, limit)`
  - `searchSessionsSemantic(db, workspaceId, memories)`
- Queries filter on `workspace_id = ?`.

### Step D — Wire switch and startup deterministically
- In workbench startup + switch path:
  - call `chatService.setWorkspaceScope(this._workspace.id)` before restore.
- In chat built-in startup path:
  - set initial scope from `workspaceService.activeWorkspace?.id` if available.
- On workspace-switch event in chat built-in:
  - update scope immediately before reset/createSession.

### Step E — Tests
- Extend `chatWorkspaceSwitch.test.ts` for scope transitions.
- Add/extend persistence tests to verify:
  - sessions from workspace A are not visible in workspace B,
  - scoped search only returns current workspace sessions.

## Non-goals in this change

- Re-architecting retrieval/vector indexing tables by workspace scope.
- UX redesign of session sidebar.

## Risk notes

- Existing legacy sessions without workspace_id will default to `''` and won’t appear in scoped views unless explicitly migrated. This is acceptable for correctness-first behavior; optional backfill can be added later if needed.

## Validation checklist

- `npx tsc --noEmit`
- `npx vitest run tests/unit/chatWorkspaceSwitch.test.ts`
- `npx vitest run tests/unit/chatSessionPersistence.test.ts` (or equivalent persistence test file)
- full `npx vitest run`
