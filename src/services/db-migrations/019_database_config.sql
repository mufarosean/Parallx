-- 019_database_config.sql — a database's own settings (docs/DATABASES.md):
-- row templates and the default one, kept as JSON beside the description
-- and lock that 006 gave it. Views keep theirs in database_views.config.
ALTER TABLE databases ADD COLUMN config TEXT NOT NULL DEFAULT '{}';
