-- Migration 006 — Categorization audit trail.
--
-- Up to now, the only place we recorded "how was this tx categorized" was the
-- categorizer_model column (the LLM model id). That's not enough:
--   * Was it a deterministic rule hit, an AI guess, a manual override, or
--     seed data?
--   * If it was a rule, WHICH rule? The user has no way to ask the database
--     "show me everything DISNEYPLUS matches" without merchant-string LIKE.
--
-- These two columns close that gap. They are nullable to avoid breaking the
-- 62 existing rows; the sync engine populates them going forward, and the
-- Rules section + Transactions UI surface the source as a small badge.

ALTER TABLE transactions
  ADD COLUMN categorization_source TEXT
    CHECK (categorization_source IN ('rule','ai','manual','seed'));

ALTER TABLE transactions
  ADD COLUMN matched_rule_id TEXT
    REFERENCES categorization_rules(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS tx_categorization_source_idx
  ON transactions(categorization_source);
CREATE INDEX IF NOT EXISTS tx_matched_rule_idx
  ON transactions(matched_rule_id);

-- Backfill: existing rows with a category_id but no source — best guess.
-- They were either AI-categorized (no rules existed at the time) or seeded.
-- Tag them 'seed' so the UI shows them honestly as "from before audit trail
-- existed" rather than misattributing to the AI.
UPDATE transactions
   SET categorization_source = 'seed'
 WHERE category_id IS NOT NULL
   AND categorization_source IS NULL;
