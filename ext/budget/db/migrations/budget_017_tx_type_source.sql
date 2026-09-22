-- Type provenance (docs/BUDGET_REVIEW_2026-09-21.md): who decided a
-- transaction's tx_type. 'ai' on import, 'subject' when Reprocess read it
-- from the email subject, 'manual' when the user set it (editor drawer, review
-- queue, chat tool), 'csv' from an import. NULL for rows typed before this
-- column existed. Shown beside the type the way the category's source is.
ALTER TABLE transactions ADD COLUMN tx_type_source TEXT;
CREATE INDEX IF NOT EXISTS tx_type_source_idx ON transactions(tx_type, tx_type_source);
