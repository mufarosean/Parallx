-- Tags the student puts on a problem (tagEditor.ts), from its note box.
-- Kept apart from ws_items.tags, which the import writes (paper, source,
-- kind, task), so the import never touches them and the editor shows only
-- these; listItems joins both, so search, quizzes and a roster see them all.
CREATE TABLE IF NOT EXISTS ws_item_tag (
  item_id INTEGER NOT NULL,
  tag TEXT NOT NULL,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (item_id, tag)
);
CREATE INDEX IF NOT EXISTS idx_ws_item_tag_tag ON ws_item_tag(tag);
