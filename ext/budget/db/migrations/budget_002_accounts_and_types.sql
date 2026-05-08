-- Budget extension — accounts + richer transaction types (M63 P2)
-- Adds:
--   • accounts table (one row per detected account, keyed by last_four).
--   • transactions.tx_type — distinguishes real spend from transfers / payments.
--   • transactions.account_id — link tx to the account it hit.
--   • balance_snapshots.account_id + .kind — daily summary emails report
--     balances for multiple accounts; we want one row per (account, date).
--
-- All additions are nullable / additive so existing rows survive.

PRAGMA foreign_keys = ON;

-- ── Accounts ────────────────────────────────────────────────────────────────
-- 'kind' values:
--   'checking' / 'savings'   — debit accounts (have balance snapshots)
--   'credit_card'            — credit (negative balance = amount owed)
--   'other'                  — anything we cannot classify yet
CREATE TABLE IF NOT EXISTS accounts (
    id            TEXT PRIMARY KEY,
    last_four     TEXT UNIQUE,
    kind          TEXT NOT NULL DEFAULT 'other'
                      CHECK(kind IN ('checking','savings','credit_card','other')),
    display_name  TEXT,
    currency      TEXT NOT NULL DEFAULT 'USD',
    archived      INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1)),
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS accounts_kind_idx ON accounts(kind);

-- ── Add tx_type + account_id to transactions ───────────────────────────────
-- 'tx_type' values (NULL during legacy migration; sync will backfill on next run):
--   'purchase'    — real spend on debit/credit (gas, restaurant, subscription)
--   'refund'      — negative purchase (return, dispute credit)
--   'deposit'     — money IN (paycheck, transfer-in, refund-in-bank)
--   'transfer'    — internal money move (savings ↔ checking) — IGNORED in spend
--   'cc_payment'  — payment from debit toward credit card — IGNORED in spend
--   'fee'         — bank or service fee — counted in spend
--   'other'       — model unsure; surfaces in Review Queue
ALTER TABLE transactions ADD COLUMN tx_type TEXT
    CHECK(tx_type IN ('purchase','refund','deposit','transfer','cc_payment','fee','other'));
ALTER TABLE transactions ADD COLUMN account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS tx_type_idx    ON transactions(tx_type);
CREATE INDEX IF NOT EXISTS tx_account_idx ON transactions(account_id);

-- ── Add account_id + kind to balance_snapshots ────────────────────────────
-- Daily account summary emails list MULTIPLE balances at once
-- (Total Checking, Savings, etc.). We want a row per (account, snapshot_date).
ALTER TABLE balance_snapshots ADD COLUMN account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL;
ALTER TABLE balance_snapshots ADD COLUMN kind TEXT
    CHECK(kind IN ('checking','savings','credit_card','other'));
CREATE INDEX IF NOT EXISTS bs_account_idx ON balance_snapshots(account_id);

-- ── View: latest balance per account ──────────────────────────────────────
-- Used by Dashboard "Net Worth" and Accounts view.
DROP VIEW IF EXISTS v_account_latest_balance;
CREATE VIEW v_account_latest_balance AS
SELECT a.id          AS account_id,
       a.last_four,
       a.kind,
       a.display_name,
       (SELECT bs.balance_cents
          FROM balance_snapshots bs
         WHERE bs.account_id = a.id
         ORDER BY bs.snapshot_date DESC, bs.created_at DESC
         LIMIT 1)    AS latest_balance_cents,
       (SELECT bs.snapshot_date
          FROM balance_snapshots bs
         WHERE bs.account_id = a.id
         ORDER BY bs.snapshot_date DESC, bs.created_at DESC
         LIMIT 1)    AS latest_balance_date
  FROM accounts a
 WHERE a.archived = 0;
