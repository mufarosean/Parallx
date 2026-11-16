-- What he keeps on a question between sessions: a mark to come back to it
-- (the sidebar's Marked set draws these), and, per session item, the answer
-- he had half typed when the tab or the app closed.
ALTER TABLE st_questions ADD COLUMN marked INTEGER NOT NULL DEFAULT 0;
ALTER TABLE st_session_items ADD COLUMN draft TEXT NOT NULL DEFAULT '';
