-- Migration 018 — A workspace that has never synced has no sync cursor.
--
-- Migration 011 was a one-time repair of one ledger: it reset the Gmail cursor
-- to 2026-04-01. Migrations run on every workspace, so every NEW workspace got
-- that cursor too. Two visible effects for someone who had never synced:
--   • the Overview said "Last sync 3/31/2026", a sync that never happened;
--   • the first sync started from 2026-04-01 and ignored the settings that are
--     documented to control it (budget.syncStartDays / budget.syncStartDate),
--     because those only apply when there is no cursor.
--
-- Remove the cursor only where Budget has provably never run: it still holds
-- exactly the value 011 wrote, no sync run was ever recorded, and no email was
-- ever imported. A workspace that has synced keeps its cursor untouched.

DELETE FROM sync_state
 WHERE key = 'last_synced_at'
   AND value = '"2026-04-01T00:00:00.000Z"'
   AND NOT EXISTS (SELECT 1 FROM sync_state WHERE key = 'last_run_at')
   AND NOT EXISTS (SELECT 1 FROM email_imports);
