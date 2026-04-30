-- M59 P5: stacks (RAW + edits, bracketed shots, photo/video bundles)
-- A "stack" groups related media items under a single primary, presenting
-- as one card in the grid with a "+N" badge that expands on click.

CREATE TABLE IF NOT EXISTS mo_stacks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  primary_type TEXT NOT NULL CHECK(primary_type IN ('photo', 'video')),
  primary_id INTEGER NOT NULL,
  name TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS mo_stack_members (
  stack_id INTEGER NOT NULL,
  member_type TEXT NOT NULL CHECK(member_type IN ('photo', 'video')),
  member_id INTEGER NOT NULL,
  role TEXT,
  position INTEGER DEFAULT 0,
  PRIMARY KEY (stack_id, member_type, member_id),
  FOREIGN KEY (stack_id) REFERENCES mo_stacks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_mo_stack_members_stack ON mo_stack_members(stack_id);
CREATE INDEX IF NOT EXISTS idx_mo_stack_members_member ON mo_stack_members(member_type, member_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mo_stacks_primary ON mo_stacks(primary_type, primary_id);
