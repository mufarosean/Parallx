-- M98: FSRS scheduling state, provenance, and card-type groundwork.
-- Columns are additive; SM-2 columns are retained (the replay heal keys on
-- reps > 0 AND stability = 0 to find cards needing FSRS state derivation).

ALTER TABLE fc_cards ADD COLUMN stability REAL NOT NULL DEFAULT 0;
ALTER TABLE fc_cards ADD COLUMN difficulty REAL NOT NULL DEFAULT 0;
ALTER TABLE fc_cards ADD COLUMN last_reviewed_at INTEGER NOT NULL DEFAULT 0;

-- Slice B: per-card source grounding (page-level; 0 = unknown/not paged).
ALTER TABLE fc_cards ADD COLUMN source_page INTEGER NOT NULL DEFAULT 0;

-- Slice F: card types + sibling grouping. basic | cloze | reverse.
ALTER TABLE fc_cards ADD COLUMN card_type TEXT NOT NULL DEFAULT 'basic';
ALTER TABLE fc_cards ADD COLUMN note_group TEXT NOT NULL DEFAULT '';
ALTER TABLE fc_cards ADD COLUMN cloze_index INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_fc_cards_note_group ON fc_cards(note_group) WHERE note_group != '';

-- Deadline-aware scheduling (generic: any target date, not exam-specific).
ALTER TABLE fc_decks ADD COLUMN exam_date INTEGER NOT NULL DEFAULT 0;
ALTER TABLE fc_decks ADD COLUMN desired_retention REAL NOT NULL DEFAULT 0.9;
