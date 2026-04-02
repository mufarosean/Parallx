-- Media Organizer: Iteration 3 polish
-- Compound unique index for D2 scan dedup + defensive constraints.

-- Compound index for FileQueries.findByFolderAndName() — D2 scan will hammer this
CREATE UNIQUE INDEX IF NOT EXISTS idx_mo_files_folder_basename ON mo_files(folder_id, basename);
