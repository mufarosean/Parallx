-- Work counts, not only the rating (Mufaro, 2026-09-20: a day closed one
-- short because a problem that arrived carrying its workbook rating looked
-- already rated, so the work done on it was never credited and the streak
-- broke). An attempt is worked the moment a cell on its sheet is changed;
-- worked_at is that first moment and never moves, so the day a problem
-- counted on is fixed the way a rating's day is. The campaign credits a
-- problem that was worked OR rated; the rating goes on feeding the score,
-- the Easy bonus and the repeat schedule.
ALTER TABLE ws_attempts ADD COLUMN worked_at INTEGER NOT NULL DEFAULT 0;

-- Everything already holding the student's own cells counts as worked: that
-- is what the bank has been calling "In progress" all along. A rated attempt
-- takes its rating's moment, so no day already seen changes; an open one
-- takes the moment its cells were first saved.
UPDATE ws_attempts
   SET worked_at = CASE WHEN completed = 1 THEN updated_at ELSE started_at END
 WHERE imported = 0 AND length(cells_json) > 2;
