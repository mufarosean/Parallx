-- When a problem's sheet was last replaced from its workbook (Import Workbook,
-- Replace Sheets). Work saved before that was done on the old layout, so the
-- problem tab opens on the new sheet instead; ratings, stars, time and the
-- attempt history stay. 0 = the sheet is the one first imported.
ALTER TABLE ws_items ADD COLUMN sheet_at INTEGER NOT NULL DEFAULT 0;
