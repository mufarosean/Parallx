-- M59 Phase 3: perceptual hash (dHash 64-bit) on image files.
-- Stored as INTEGER (signed 64-bit). Computed by background indexer.
-- Hamming distance ≤ 8 across pHashes ⇒ near-duplicate cluster.

ALTER TABLE mo_image_files ADD COLUMN phash INTEGER;

-- Partial index: only rows that have a phash. Brute-force scan still required
-- for Hamming distance, but the index trims the candidate set.
CREATE INDEX IF NOT EXISTS idx_mo_image_files_phash_present
  ON mo_image_files(phash)
  WHERE phash IS NOT NULL;
