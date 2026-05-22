-- Migration 011 — Clean slate.
--
-- Migrations 005–010 accumulated patch-on-patch around a fundamentally
-- broken sync history: a buggy run wrote rows with no extracted data,
-- the skip-check then treated them as "done forever," and every fix
-- attempt added more state (malformed, classify_attempts, cursor
-- rollback) to try to backdate around the damage. None of it produced
-- the clean ledger the user actually wanted.
--
-- This migration wipes ledger state and resets the Gmail cursor to
-- 2026-04-01. The next sync re-fetches every transaction email from
-- that date forward and rebuilds the ledger from scratch with the
-- simplified sync logic (see main.js — skip-check is now just "have we
-- seen this gmail_message_id," no retry gymnastics).
--
-- What we KEEP:
--   • categories, accounts, rules, budgets, recurring patterns,
--     review_assignments — anything the user authored manually.
--   • Schema — every column/table from prior migrations stays.
--
-- What we WIPE:
--   • email_imports — the source of the bug; rebuilt from Gmail.
--   • transactions — derived from email_imports; rebuilt by sync.
--   • balance_snapshots — also derived; rebuilt by sync.
--   • recurring_occurrences — derived from transactions.
--   • sync_log — historical noise from the broken runs.
--   • sync_state.last_synced_at — replaced with 2026-04-01.

DELETE FROM recurring_occurrences;
DELETE FROM transactions;
DELETE FROM balance_snapshots;
DELETE FROM email_imports;
DELETE FROM sync_log;

-- Reset the cursor. The next sync sees last_synced_at=2026-04-01 and
-- pulls every matching email from that date forward.
INSERT OR REPLACE INTO sync_state (key, value)
  VALUES ('last_synced_at', '"2026-04-01T00:00:00.000Z"');
