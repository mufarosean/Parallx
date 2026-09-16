-- AI tagging: a review row's mode (docs/AI_TAGGING.md, "Retag").
--
-- 'add' (the default, and every row that existed before this migration):
-- Approve adds the picks and their parents on top of what the photo has and
-- removes nothing. 'retag': the model saw the photo with no tags and picked
-- afresh; Approve makes the picks (and their parents) the photo's whole tag
-- set, so what it had and the picks lack is removed. Skip leaves the photo
-- untouched either way. Nothing is removed until Approve.

ALTER TABLE mo_ai_tag_reviews ADD COLUMN mode TEXT NOT NULL DEFAULT 'add' CHECK(mode IN ('add', 'retag'));
