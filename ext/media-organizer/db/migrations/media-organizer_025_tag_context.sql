-- Tag context (docs/AI_TAGGING.md, 2026-09-21): an assignment says WHICH
-- sense of a tag it means. via_parent_id is the parent the tag was applied
-- under (FACE via PORTRAIT, FACE via POSE), 0 when the tag was applied bare.
-- Branch views and counts read it; ancestors are inferred from the tree and
-- never stamped on the item, so restructuring the tree above a tag changes
-- no photo. Backfill: an existing row takes the one parent the item also
-- carries (what "parents come along" used to write), else it stays bare.
-- The primary key gains the column, so one item can carry a tag in two
-- senses; SQLite cannot alter a primary key, so the tables are rebuilt.

CREATE TABLE mo_photos_tags_ctx (
  photo_id      INTEGER NOT NULL REFERENCES mo_photos(id) ON DELETE CASCADE,
  tag_id        INTEGER NOT NULL REFERENCES mo_tags(id) ON DELETE CASCADE,
  via_parent_id INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (photo_id, tag_id, via_parent_id)
);
INSERT INTO mo_photos_tags_ctx (photo_id, tag_id, via_parent_id)
  SELECT pt.photo_id, pt.tag_id, COALESCE((
    SELECT r.parent_id FROM mo_tags_relations r
    WHERE r.child_id = pt.tag_id
      AND EXISTS (SELECT 1 FROM mo_photos_tags p2 WHERE p2.photo_id = pt.photo_id AND p2.tag_id = r.parent_id)
    GROUP BY r.child_id HAVING COUNT(*) = 1), 0)
  FROM mo_photos_tags pt;
DROP TABLE mo_photos_tags;
ALTER TABLE mo_photos_tags_ctx RENAME TO mo_photos_tags;
CREATE INDEX IF NOT EXISTS idx_mo_photos_tags_tag ON mo_photos_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_mo_photos_tags_via ON mo_photos_tags(via_parent_id);

CREATE TABLE mo_videos_tags_ctx (
  video_id      INTEGER NOT NULL REFERENCES mo_videos(id) ON DELETE CASCADE,
  tag_id        INTEGER NOT NULL REFERENCES mo_tags(id) ON DELETE CASCADE,
  via_parent_id INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (video_id, tag_id, via_parent_id)
);
INSERT INTO mo_videos_tags_ctx (video_id, tag_id, via_parent_id)
  SELECT vt.video_id, vt.tag_id, COALESCE((
    SELECT r.parent_id FROM mo_tags_relations r
    WHERE r.child_id = vt.tag_id
      AND EXISTS (SELECT 1 FROM mo_videos_tags v2 WHERE v2.video_id = vt.video_id AND v2.tag_id = r.parent_id)
    GROUP BY r.child_id HAVING COUNT(*) = 1), 0)
  FROM mo_videos_tags vt;
DROP TABLE mo_videos_tags;
ALTER TABLE mo_videos_tags_ctx RENAME TO mo_videos_tags;
CREATE INDEX IF NOT EXISTS idx_mo_videos_tags_tag ON mo_videos_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_mo_videos_tags_via ON mo_videos_tags(via_parent_id);
