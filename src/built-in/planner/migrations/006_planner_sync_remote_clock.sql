-- Planner sync — record the PROVIDER's own last-modified stamp per row.
--
-- Why: conflict resolution used to compare `updated_at` (LOCAL wall clock)
-- against Google's `updated` (Google's clock). Those are different clocks, and
-- worse, applying a remote upsert stamped `updated_at = Date.now()` — so every
-- pulled row's "last modified" silently became "when this workspace last
-- pulled it", which is always LATER than Google's real timestamp. A second
-- workspace holding a stale copy therefore won every conflict and PATCHed its
-- stale copy back over an edit made in the first workspace.
--
-- remote_updated_at stores the provider's timestamp exactly as reported, so the
-- only question we ever ask is the right one: "has the remote changed since the
-- version I last reconciled?" (remote.updated > remote_updated_at). Same clock
-- on both sides of that comparison.
--
-- NULL = never reconciled with a provider (local-only rows, or rows written
-- before this migration — those fall back to the legacy comparison once).
ALTER TABLE planner_events          ADD COLUMN remote_updated_at INTEGER;
ALTER TABLE planner_tasks           ADD COLUMN remote_updated_at INTEGER;
ALTER TABLE planner_event_overrides ADD COLUMN remote_updated_at INTEGER;
