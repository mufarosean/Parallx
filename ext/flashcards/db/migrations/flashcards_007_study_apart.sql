-- A deck studied apart stays out of the mixed daily session and the Today counts.
ALTER TABLE fc_decks ADD COLUMN study_apart INTEGER NOT NULL DEFAULT 0;
