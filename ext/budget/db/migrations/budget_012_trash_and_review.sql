-- Migration 012 — M80 support tables.
--
-- Adds the two tables M80 needs so the AI agent (driven by the
-- budget-sync skill) can soft-delete transactions and queue
-- ambiguous emails for user review. Strictly additive — no
-- existing row is touched.
--
-- 1. transactions_trash — soft-delete bucket for budget.deleteTransaction.
--    The full row payload (JSON) is preserved so budget.restoreTransaction
--    can put it back verbatim. A 30-day purge runs at activate() time.
--
-- 2. pending_review — queue for emails the AI couldn't confidently
--    classify or extract. The Settings → Review Queue tab is the user
--    surface; budget.flagForReview / budget.listPendingReview /
--    budget.resolveReview are the tool surface.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS transactions_trash (
    id              TEXT PRIMARY KEY,
    row_json        TEXT NOT NULL,
    deleted_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    delete_reason   TEXT
);
CREATE INDEX IF NOT EXISTS trash_deleted_at_idx ON transactions_trash(deleted_at);

CREATE TABLE IF NOT EXISTS pending_review (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    email_id           TEXT NOT NULL,
    reason             TEXT NOT NULL,
    partial_data_json  TEXT,
    created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    resolved_at        TEXT,
    resolution         TEXT
);
CREATE INDEX IF NOT EXISTS pending_review_open_idx
    ON pending_review(resolved_at) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS pending_review_email_idx ON pending_review(email_id);
