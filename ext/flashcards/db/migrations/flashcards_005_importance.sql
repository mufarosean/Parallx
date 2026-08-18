-- M101: exam-criticality scoring on cards.
--
-- importance: 0 = unscored (legacy cards and manual cards start here);
-- 1..100 = AI- or user-assigned exam criticality. The new-card band of the
-- study queue introduces high-importance cards first, so when time runs
-- short before an exam the most crucial content was learned first.
--
-- importance_reason: the one-line rationale attached when the AI scored the
-- card. Shown in the browse editor so the score is auditable, not oracular.

ALTER TABLE fc_cards ADD COLUMN importance INTEGER NOT NULL DEFAULT 0;
ALTER TABLE fc_cards ADD COLUMN importance_reason TEXT NOT NULL DEFAULT '';
