# Milestone 91 — Autonomous Run Transcripts (reopen like chat)

**Status: COMPLETE 2026-07-20 — S1 persistence (3a411e25), S2 archive-on-purge
(9b686b27), S3 read-only viewer. Branch m89-personality; needs in-app
verification (S3 is UI). Retention default 100 runs/workspace.**

**Why:** chat sessions persist to SQLite and can be reopened forever; autonomous
runs (heartbeat, cron, background widget refresh) run on ephemeral sessions
that are PURGED the moment the turn ends (`chatService.purgeEphemeralSession`
→ `_sessions.delete`). Only bodiless receipts survive. Mufaro: "the nice thing
about chat is we can always go back to it" — autonomous work should be equally
reviewable. This closes the asymmetry: keep the full transcript (reasoning +
every tool call), reopen it read-only.

## Design

Autonomous runs are ARCHIVED at purge time — the full session (messages +
tool calls) is written to the SAME SQLite message tables chat uses, tagged
with an `origin`, and kept OUT of the chat list. A retention cap prunes old
runs. A read-only viewer reopens one from the autonomy log.

Reusing `chat_messages` (not a parallel store) is deliberate: the message
reconstruction, part rendering, and transcript logic all work unchanged.

## Slices

### S1 — Persistence layer (`chatSessionPersistence.ts`)
- Migration: `chat_sessions` gains `origin TEXT` (NULL = interactive chat).
  Index `(origin, updated_at)`.
- `archiveSession(db, session, origin, workspaceId)` — the ONE entry point
  that intentionally bypasses the ephemeral-id early-return; writes the
  session row with `origin` set + its messages. All other persistence
  paths keep refusing ephemeral ids.
- `loadArchivedRunSummaries(db, workspaceId, limit)` — metadata only
  (id, origin, title, timestamps, message count) for the list.
- `loadArchivedRun(db, sessionId)` — full transcript on demand.
- `pruneArchivedRuns(db, workspaceId, keep)` — keep newest N (default 100),
  delete older (messages cascade).
- `loadSessions` (chat list) filters `origin IS NULL` so archived runs never
  appear as chats.
- Tests: round-trip, chat-list exclusion, retention prune, ephemeral guard
  still holds for the ordinary paths.

### S2 — Lifecycle (`chatService.ts` + executors)
- `IEphemeralSessionSeed` gains `archiveOrigin?: string`. When set,
  `purgeEphemeralSession` ARCHIVES before deleting (if the session has
  messages), then prunes.
- Executors set it: heartbeat → `'heartbeat'`, cron → `'cron'`, background
  runner → its `origin` (`'dashboard'`), subagent → `'subagent'`.
- `chatService.getArchivedRunSummaries()` / `getArchivedRun(id)` public API.
- Tests: archived-on-purge only when archiveOrigin + messages present;
  no-archive path unchanged; chat list still excludes them.

### S3 — Review surface (autonomy log)
- Autonomy-log entries that carry a `sessionId` gain a "View full run"
  action → opens the archived transcript READ-ONLY (reuses the chat
  rendering; no input, no send). A dedicated lightweight viewer or a
  read-only chat-widget mode.
- The autonomy log's live entries already carry `sessionId`; wire the id
  through to the archive lookup.

## Non-goals / kept
- Chat list stays clean — archived runs are a separate surface.
- Bodiless ndjson event log (M-autonomy) stays as the fast structured
  history; this adds the full transcript ALONGSIDE it.
- Retention default 100 runs/workspace (tunable later); no unbounded growth.
- Privacy: archived transcripts live in the workspace SQLite like chat — the
  same trust boundary, not the bodiless posture. (Consistent with chat.)
