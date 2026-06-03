-- Planner (settings) — per-workspace key/value store backing the planner
-- settings panel in the unified Settings hub. Strictly additive; values are
-- opaque strings the data service encodes/decodes per key.
CREATE TABLE IF NOT EXISTS planner_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
