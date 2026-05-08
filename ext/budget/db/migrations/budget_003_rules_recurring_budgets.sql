-- Budget extension — rules engine, recurring detection, real budgets, reconciliation (M63 P3)
-- All additions are additive / nullable. Existing rows survive untouched.
--
-- New domains:
--   1. categorization_rules — deterministic merchant→category rules that override AI guesses.
--   2. recurring_series      — detected subscriptions / recurring charges + manual entries.
--   3. budgets               — month-by-month limits per category, with rollover.
--   4. reconciliations       — user-confirmed reconciliation events per account.
--
-- Convention reminders:
--   • Money is INTEGER cents.
--   • amount_cents > 0 = money out (spend); < 0 = money in (refund/deposit).
--   • Dates are YYYY-MM-DD local. Timestamps are ISO 8601 UTC.

PRAGMA foreign_keys = ON;

-- ── 1. Categorization rules ────────────────────────────────────────────────
-- Match strategy:
--   • match_type = 'exact'    — LOWER(merchant) = LOWER(pattern)
--   • match_type = 'contains' — LOWER(merchant) LIKE '%' || LOWER(pattern) || '%'
--   • match_type = 'regex'    — applied in JS (SQLite has no regex by default)
--
-- 'auto_created' = 1 when the rule was inferred from user_overridden=1 history.
-- Rules with higher 'priority' win when multiple match. Default 100 for manual,
-- 50 for auto-learned. Rules can be disabled without deletion (active=0).
CREATE TABLE IF NOT EXISTS categorization_rules (
    id              TEXT PRIMARY KEY,
    pattern         TEXT NOT NULL,
    match_type      TEXT NOT NULL DEFAULT 'contains'
                        CHECK(match_type IN ('exact','contains','regex')),
    category_id     TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    priority        INTEGER NOT NULL DEFAULT 100,
    auto_created    INTEGER NOT NULL DEFAULT 0 CHECK(auto_created IN (0,1)),
    active          INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
    hits            INTEGER NOT NULL DEFAULT 0,
    last_hit_at     TEXT,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS rules_active_idx   ON categorization_rules(active, priority DESC);
CREATE INDEX IF NOT EXISTS rules_category_idx ON categorization_rules(category_id);

-- ── 2. Recurring series ────────────────────────────────────────────────────
-- One row per detected subscription / monthly bill.
-- 'cadence' is 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly'.
-- 'avg_amount_cents' is the rolling mean over the last N occurrences.
-- 'next_due_date' is best-guess; user can override.
-- 'detection_confidence' helps the UI gate auto-flagging vs ask-the-user.
CREATE TABLE IF NOT EXISTS recurring_series (
    id                    TEXT PRIMARY KEY,
    merchant_pattern      TEXT NOT NULL,
    display_name          TEXT,
    category_id           TEXT REFERENCES categories(id) ON DELETE SET NULL,
    cadence               TEXT NOT NULL DEFAULT 'monthly'
                              CHECK(cadence IN ('weekly','biweekly','monthly','quarterly','yearly')),
    avg_amount_cents      INTEGER NOT NULL DEFAULT 0,
    last_amount_cents     INTEGER,
    last_seen_date        TEXT,
    next_due_date         TEXT,
    occurrence_count      INTEGER NOT NULL DEFAULT 0,
    detection_confidence  TEXT CHECK(detection_confidence IN ('high','medium','low')),
    user_confirmed        INTEGER NOT NULL DEFAULT 0 CHECK(user_confirmed IN (0,1)),
    cancelled             INTEGER NOT NULL DEFAULT 0 CHECK(cancelled IN (0,1)),
    notes                 TEXT,
    created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS recurring_due_idx       ON recurring_series(next_due_date);
CREATE INDEX IF NOT EXISTS recurring_cancelled_idx ON recurring_series(cancelled);

-- Link table: which transactions belong to which recurring series.
CREATE TABLE IF NOT EXISTS recurring_occurrences (
    series_id       TEXT NOT NULL REFERENCES recurring_series(id) ON DELETE CASCADE,
    transaction_id  TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    PRIMARY KEY (series_id, transaction_id)
);
CREATE INDEX IF NOT EXISTS rec_occ_tx_idx ON recurring_occurrences(transaction_id);

-- ── 3. Budgets (monthly limits per category, with rollover) ────────────────
-- One row per (category, month). 'month_key' is 'YYYY-MM'.
-- 'rollover_cents' carries unspent balance from prior month when category has rollover=1.
-- Deriving "spent this month" stays a query against transactions.
CREATE TABLE IF NOT EXISTS budgets (
    id              TEXT PRIMARY KEY,
    category_id     TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    month_key       TEXT NOT NULL,
    limit_cents     INTEGER NOT NULL,
    rollover_cents  INTEGER NOT NULL DEFAULT 0,
    notes           TEXT,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE (category_id, month_key)
);
CREATE INDEX IF NOT EXISTS budgets_month_idx ON budgets(month_key);

-- ── 4. Reconciliation events ───────────────────────────────────────────────
-- Each row is "as of <date>, the user confirmed the account balance".
-- Lets the UI show "off by $X since last reconciliation".
CREATE TABLE IF NOT EXISTS reconciliations (
    id                TEXT PRIMARY KEY,
    account_id        TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    reconciled_at     TEXT NOT NULL,
    statement_balance_cents INTEGER NOT NULL,
    derived_balance_cents   INTEGER NOT NULL,
    diff_cents        INTEGER NOT NULL,
    note              TEXT,
    created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS reconciliations_account_idx ON reconciliations(account_id, reconciled_at DESC);

-- ── 5. Pending vs posted (for future Plaid/CSV import) ─────────────────────
-- Add 'posted' flag to transactions so we can ingest pending charges and
-- swap them out when settled. Default 1 = posted (matches existing email-derived rows).
ALTER TABLE transactions ADD COLUMN posted INTEGER NOT NULL DEFAULT 1 CHECK(posted IN (0,1));
CREATE INDEX IF NOT EXISTS tx_posted_idx ON transactions(posted);

-- 'source' tells us where the row came from: gmail, csv, manual, plaid.
-- Useful for diagnostics and conflict resolution.
ALTER TABLE transactions ADD COLUMN source TEXT NOT NULL DEFAULT 'gmail'
    CHECK(source IN ('gmail','csv','ofx','manual','plaid'));
CREATE INDEX IF NOT EXISTS tx_source_idx ON transactions(source);

-- ── 6. Recurring view: due in next 30 days ────────────────────────────────
DROP VIEW IF EXISTS v_recurring_upcoming;
CREATE VIEW v_recurring_upcoming AS
SELECT r.id, r.merchant_pattern, r.display_name, r.category_id, c.name AS category_name,
       c.color AS category_color, r.cadence, r.avg_amount_cents, r.next_due_date,
       r.occurrence_count, r.detection_confidence, r.user_confirmed
  FROM recurring_series r
  LEFT JOIN categories c ON c.id = r.category_id
 WHERE r.cancelled = 0
 ORDER BY r.next_due_date ASC NULLS LAST;
