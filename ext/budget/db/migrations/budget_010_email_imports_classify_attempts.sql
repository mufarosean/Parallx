-- Migration 010 — bound the cursor-rollback retry loop.
--
-- Without a retry counter, every Sync click would slide the cursor back
-- to the oldest `malformed=1` row in the entire history and try to
-- re-LLM-classify it. If the Stage-1 prompt couldn't classify that email
-- the first time, it almost certainly can't the second or third time
-- either — but we'd keep paying the round-trip on every single sync.
--
-- This column lets the sync engine cap retries (`classify_attempts >= 3`
-- means "give up, leave it alone, don't drag the cursor back for it"),
-- and lets the dashboard surface stuck rows so the user can manually
-- inspect them. The sync engine increments this on every Stage-1 attempt
-- that fails for a given gmail_message_id.
ALTER TABLE email_imports
  ADD COLUMN classify_attempts INTEGER NOT NULL DEFAULT 0;
