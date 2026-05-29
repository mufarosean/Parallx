-- 002_widget_appearance.sql
--
-- Per-instance visual overrides (background + border) for dashboard widgets.
-- Stored as a small JSON blob so the shape can evolve without further
-- migrations. An empty object ('{}') means "inherit the chrome defaults".

ALTER TABLE dashboard_widgets
  ADD COLUMN appearance_json TEXT NOT NULL DEFAULT '{}';
