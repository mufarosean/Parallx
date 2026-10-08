-- The recipe a problem's solution names ("Paper - Recipe name"), for the
-- Problem Bank's Recipe filter. recipe IS NULL = the sheet was not read yet
-- (filled once from sheet_json on activation); '' = it names none.
ALTER TABLE ws_items ADD COLUMN recipe TEXT;
ALTER TABLE ws_items ADD COLUMN recipe_paper TEXT NOT NULL DEFAULT '';
