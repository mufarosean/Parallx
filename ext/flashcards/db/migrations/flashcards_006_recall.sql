-- M102: production recall — cards that make you SAY it, not recognise it.
--
-- recall_mode picks what a review elicits and therefore which grader runs:
--
--   recognition  reveal + self-grade. Today's loop, and the default, so no
--                existing deck changes behaviour when this migration lands.
--   conceptual   a typed explanation, judged against `rubric` by the model.
--   list         free enumeration, scored by set overlap against `rubric`.
--   formula      the formula, normalised and compared deterministically;
--                the model is consulted only when the strings disagree.
--
-- Deliberately NOT folded into card_type ('basic' | 'cloze' | 'reverse'):
-- that column picks how a note RENDERS into cards, and the two axes are
-- orthogonal — a cloze card can be conceptual, a basic card can be a list.
-- Overloading one column would make "conceptual cloze" unrepresentable.
--
-- A column rather than a tag (fc_cards.tags exists and was the obvious
-- shortcut): behaviour branches on this value, so a mistyped tag would
-- silently return a card to recognition grading with no visible symptom.

ALTER TABLE fc_cards ADD COLUMN recall_mode TEXT NOT NULL DEFAULT 'recognition';

-- rubric: JSON array of the points a correct answer must contain —
-- [{"text": "...", "required": true}]. For `list` the entries ARE the items
-- to enumerate; for `formula` a single entry holds the canonical form.
--
-- Authored once, when the card is created, and cached here forever after.
-- Deriving it at grade time instead would let the model invent a slightly
-- different standard on every review, so the same answer would earn Good on
-- Monday and Hard on Friday. FSRS-6 fits stability to the grade stream and
-- assumes grades are comparable over time; a drifting standard turns a
-- stable bias (self-grading's generosity, which FSRS absorbs) into noise
-- (which it cannot). Editable in the card editor, so a bad rubric is a
-- five-second fix rather than a regeneration.
ALTER TABLE fc_cards ADD COLUMN rubric TEXT NOT NULL DEFAULT '';

-- source_excerpt: the passage the card was generated from, capped.
--
-- Captured at generation because reading it back at review time is not
-- viable: parallxElectron.document.extractText extracts a WHOLE document,
-- so grading one card sourced from a 300-page paper would re-extract all
-- 300 pages. Generation already holds the page text in memory.
--
-- It also freezes the standard: the card is graded against what the source
-- said when the card was made, and keeps grading correctly after the PDF
-- is moved, renamed, or opened on another machine.
ALTER TABLE fc_cards ADD COLUMN source_excerpt TEXT NOT NULL DEFAULT '';

-- Partial: production cards are the minority and every read is "which cards
-- need an answer box".
CREATE INDEX IF NOT EXISTS idx_fc_cards_recall ON fc_cards(recall_mode) WHERE recall_mode != 'recognition';

-- The typed answer, kept per review rather than per card. Reading six
-- months of answers to one card back-to-back shows whether the explanation
-- is consolidating or drifting, which is the progress signal a score cannot
-- carry. fc_reviews is append-only (fcHealFsrsState replays it), so this is
-- history, not state.
ALTER TABLE fc_reviews ADD COLUMN answer_text TEXT NOT NULL DEFAULT '';

-- verdict: the grader's JSON — per-point hit/partial/miss, the contradiction
-- flag, and its one-line note. Stored so a grade stays auditable: when a
-- rating looks wrong months later, the evidence for it is still here.
ALTER TABLE fc_reviews ADD COLUMN verdict TEXT NOT NULL DEFAULT '';
