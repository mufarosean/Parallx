-- Remove Unit… puts a unit's row of Units in the Trash and leaves its
-- questions where they are. Where the questions name their unit in words (a
-- select, a text), Study would make the row again from them: the names of
-- the units he removed are kept here so it does not. A row of that name in
-- Units again takes the name off the list.
ALTER TABLE st_subjects ADD COLUMN removed_units TEXT NOT NULL DEFAULT '[]';
