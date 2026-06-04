-- Budget extension — savings & debt goals
--
-- A goal tracks progress toward a target: money saved (kind='savings') or a
-- debt paid down (kind='debt'). current_cents is the amount accumulated toward
-- the goal (saved, or paid off); progress = current / target. The optional
-- target_date drives an on-pace check, and a projected completion date is
-- derived from the user's recent monthly surplus.

CREATE TABLE IF NOT EXISTS goals (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    kind          TEXT NOT NULL DEFAULT 'savings'
                      CHECK(kind IN ('savings','debt')),
    target_cents  INTEGER NOT NULL DEFAULT 0,
    current_cents INTEGER NOT NULL DEFAULT 0,
    target_date   TEXT,
    notes         TEXT,
    archived      INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1)),
    sort_order    INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS goals_archived_idx ON goals(archived);
