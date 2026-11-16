-- Which pages of a material the concept map has read, so a page is asked
-- about once: {"<page>": {"s": "read" | "unread", "n": starts it came back
-- unreadable, "h": the page text's hash when it was read}}. A section is
-- mapped when every page it owns is read (or left out as unreadable), not
-- when concepts happen to sit on its pages; the hashes let an edited notes
-- file keep what did not change.
ALTER TABLE st_materials ADD COLUMN map_pages_json TEXT NOT NULL DEFAULT '{}';
