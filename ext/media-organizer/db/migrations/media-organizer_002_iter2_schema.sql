-- Media Organizer: Iteration 2 schema additions
-- Adds columns identified as gaps by Source Analyst + tag_aliases table.

-- Tag sorting & favouriting
ALTER TABLE mo_tags ADD COLUMN sort_name TEXT DEFAULT '';
ALTER TABLE mo_tags ADD COLUMN favorite INTEGER DEFAULT 0;

-- Tag aliases (many-to-one)
CREATE TABLE IF NOT EXISTS mo_tag_aliases (
  tag_id  INTEGER NOT NULL REFERENCES mo_tags(id) ON DELETE CASCADE,
  alias   TEXT    NOT NULL,
  PRIMARY KEY (tag_id, alias)
);

-- Album date (distinct from timestamps — "when did this album happen")
ALTER TABLE mo_albums ADD COLUMN date TEXT;

-- Folder mod_time for incremental scan detection
ALTER TABLE mo_folders ADD COLUMN mod_time TEXT;

-- Photo photographer credit
ALTER TABLE mo_photos ADD COLUMN photographer TEXT;

-- Indexes on new columns
CREATE INDEX IF NOT EXISTS idx_mo_tags_sort_name ON mo_tags(sort_name);
CREATE INDEX IF NOT EXISTS idx_mo_tags_favorite ON mo_tags(favorite);
CREATE INDEX IF NOT EXISTS idx_mo_tag_aliases_alias ON mo_tag_aliases(alias);
CREATE INDEX IF NOT EXISTS idx_mo_folders_mod_time ON mo_folders(mod_time);
