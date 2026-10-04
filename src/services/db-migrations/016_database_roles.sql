-- 016_database_roles.sql — the databases the app makes for itself, by role.
--
-- The property panel keeps two workspace databases: "Tags" (tagging a page
-- joins it) and "Page properties" (a property on a page that is in no other
-- database).  They were found by title, so a user's own database named
-- "Tags" was taken over, renaming ours lost it, and two with one title
-- resolved to either.  They are now found by `role`; at most one database
-- holds a role.  Existing ones are adopted on first use
-- (DatabaseDataService.ensureWorkspaceDatabase).
ALTER TABLE databases ADD COLUMN role TEXT DEFAULT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_databases_role ON databases(role) WHERE role IS NOT NULL;
