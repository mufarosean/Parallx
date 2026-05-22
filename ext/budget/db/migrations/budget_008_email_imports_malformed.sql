-- Migration 008 — Track classification failures on email_imports.
--
-- Previously the sync loop's skip check (`SELECT 1 FROM email_imports
-- WHERE gmail_message_id=?`) treated *every* row as "already processed",
-- including rows where Stage 1 failed or returned malformed JSON. Those
-- broken rows were permanently shadowing real transactions: the email
-- got recorded, no transaction was extracted, and the next sync would
-- skip the email forever.
--
-- The fix is a single boolean column. The sync loop now skips only rows
-- whose classification succeeded (`malformed=0`). Rows with `malformed=1`
-- are retried on the next sync and the INSERT uses INSERT OR REPLACE so
-- a successful retry overwrites the bad row cleanly.
--
-- Backfill: any existing row that recorded NEITHER a transaction NOR a
-- balance is suspicious — under the working pipeline almost every Chase
-- email is one or the other. Flagging those as malformed lets the next
-- sync re-process the May-17-onward backlog automatically, without the
-- user having to run a manual recovery command.

ALTER TABLE email_imports
  ADD COLUMN malformed INTEGER NOT NULL DEFAULT 0;

-- Mark historical "neither transaction nor balance" rows as malformed so
-- the now-fixed pipeline gets a chance to reclassify them. Rows that
-- already produced a transaction or balance snapshot are left alone.
UPDATE email_imports
   SET malformed = 1
 WHERE COALESCE(is_transaction, 0) = 0
   AND COALESCE(is_balance, 0) = 0;

CREATE INDEX IF NOT EXISTS email_imports_malformed_idx
  ON email_imports(malformed);
