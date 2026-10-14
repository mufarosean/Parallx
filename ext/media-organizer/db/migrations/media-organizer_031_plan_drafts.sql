-- A painting plan's working picture (plan-variations.js): the controls as they
-- stand, kept apart from the saved variations, which stay as they were saved
-- until the painter saves changes into one. draft_from is the variation the
-- working picture was opened from, NULL after Start Over or when it came from
-- none. A plan saved before this has neither; it opens on a copy of the
-- variation it kept.

ALTER TABLE mo_plans ADD COLUMN draft_json TEXT;
ALTER TABLE mo_plans ADD COLUMN draft_from INTEGER;
