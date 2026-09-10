-- AI tagging: the Tag Review list (docs/AI_TAGGING.md).
--
-- One row per photo the AI has been asked to tag. Nothing here touches the
-- photo: Approve writes the photo's tags (plus their parents) and deletes the
-- row; Skip only deletes the row. `tag_ids` is a JSON array of the tags the
-- model picked (and the reviewer edited), before parents are added.
--
-- status: queued (waiting for the runner), running (the photo in progress;
-- reset to queued on the next start if the app closed mid-photo), pending
-- (suggestions ready), nomatch (no tag in the tree fits), failed (see error).

CREATE TABLE IF NOT EXISTS mo_ai_tag_reviews (
  id          INTEGER PRIMARY KEY,
  photo_id    INTEGER NOT NULL UNIQUE REFERENCES mo_photos(id) ON DELETE CASCADE,
  status      TEXT    NOT NULL DEFAULT 'queued'
              CHECK(status IN ('queued', 'running', 'pending', 'nomatch', 'failed')),
  tag_ids     TEXT    NOT NULL DEFAULT '[]',
  error       TEXT,
  model       TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_mo_ai_tag_reviews_status ON mo_ai_tag_reviews(status, id);
