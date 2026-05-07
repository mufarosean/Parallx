-- Budget extension — initial schema (M63 P1)
-- Decisions:
--   D3 money is INTEGER cents.
--   D4 transaction_date is YYYY-MM-DD local; timestamps are ISO 8601 UTC.
--   D14 categories created BEFORE transactions for sequential-reader FK clarity.
-- Foreign keys are enabled by ExtensionDatabaseManager (electron/database.cjs).
-- WAL mode is enabled by ExtensionDatabaseManager.

PRAGMA foreign_keys = ON;

-- ── Cursor + log state (key/value blob) ─────────────────────────────────────
-- Reserved keys (writers MUST use these spellings; values are JSON-encoded):
--   'last_gmail_message_id'   value: "<id>"          (JSON string)
--   'last_synced_at'          value: "<ISO8601>"     (JSON string)
--   'last_run_status'         value: {"ok":bool,"errors":number,"new":number,...}
CREATE TABLE IF NOT EXISTS sync_state (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- ── Sync log (one row per sync event line) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS sync_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id      TEXT NOT NULL,
    ts          TEXT NOT NULL,
    level       TEXT NOT NULL CHECK(level IN ('info','warn','error')),
    msg_id      TEXT,
    stage       TEXT,
    message     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sync_log_run_id_idx ON sync_log(run_id, id);

-- ── Categories (FK target — defined first per D14) ─────────────────────────
CREATE TABLE IF NOT EXISTS categories (
    id                  TEXT PRIMARY KEY,
    name                TEXT UNIQUE NOT NULL,
    color               TEXT,
    icon                TEXT,
    kind                TEXT NOT NULL DEFAULT 'expense'
                            CHECK(kind IN ('expense','income','transfer')),
    monthly_limit_cents INTEGER,
    rollover            INTEGER NOT NULL DEFAULT 0 CHECK(rollover IN (0,1)),
    sort_order          INTEGER NOT NULL DEFAULT 0,
    archived            INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1)),
    created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS categories_sort_idx ON categories(sort_order);

-- ── Email imports (one row per Gmail message we have processed) ────────────
CREATE TABLE IF NOT EXISTS email_imports (
    gmail_message_id  TEXT PRIMARY KEY,
    received_at       TEXT NOT NULL,
    raw_subject       TEXT,
    raw_snippet       TEXT,
    is_transaction    INTEGER,
    is_balance        INTEGER,
    classifier_model  TEXT,
    processed_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS email_imports_received_idx ON email_imports(received_at);

-- ── Transactions ────────────────────────────────────────────────────────────
-- gmail_message_id is NULLable so manual entries (no email source) are valid.
CREATE TABLE IF NOT EXISTS transactions (
    id                TEXT PRIMARY KEY,
    gmail_message_id  TEXT REFERENCES email_imports(gmail_message_id) ON DELETE SET NULL,
    parent_id         TEXT REFERENCES transactions(id) ON DELETE CASCADE,
    merchant          TEXT,
    amount_cents      INTEGER NOT NULL,
    currency          TEXT NOT NULL DEFAULT 'USD',
    card_last_four    TEXT,
    transaction_date  TEXT NOT NULL,
    category_id       TEXT REFERENCES categories(id) ON DELETE SET NULL,
    ai_confidence     TEXT CHECK(ai_confidence IN ('high','medium','low')),
    extractor_model   TEXT,
    categorizer_model TEXT,
    user_overridden   INTEGER NOT NULL DEFAULT 0 CHECK(user_overridden IN (0,1)),
    status            TEXT NOT NULL DEFAULT 'confirmed'
                          CHECK(status IN ('confirmed','review','hidden','deleted')),
    notes             TEXT,
    created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS tx_date_idx     ON transactions(transaction_date);
CREATE INDEX IF NOT EXISTS tx_category_idx ON transactions(category_id);
CREATE INDEX IF NOT EXISTS tx_status_idx   ON transactions(status);
CREATE INDEX IF NOT EXISTS tx_parent_idx   ON transactions(parent_id);

-- ── Balance snapshots (reconciliation source) ──────────────────────────────
CREATE TABLE IF NOT EXISTS balance_snapshots (
    id                TEXT PRIMARY KEY,
    gmail_message_id  TEXT REFERENCES email_imports(gmail_message_id) ON DELETE SET NULL,
    account_last_four TEXT,
    balance_cents     INTEGER NOT NULL,
    currency          TEXT NOT NULL DEFAULT 'USD',
    snapshot_date     TEXT NOT NULL,
    created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS bs_date_idx ON balance_snapshots(snapshot_date);
