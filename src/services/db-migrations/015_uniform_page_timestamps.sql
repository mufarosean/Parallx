-- 015_uniform_page_timestamps.sql — one format for page timestamps.
--
-- SQLite's datetime('now') writes 'YYYY-MM-DD HH:MM:SS' (UTC). The AI's page
-- tools wrote JavaScript ISO strings instead ('YYYY-MM-DDTHH:MM:SS.sssZ', also
-- UTC). Mixed, the two sorted wrongly as text (every 'T' after every space on
-- the same day) and read as different time zones. The tools now write
-- SQLite's form (src/platform/storedTime.ts); this rewrites what they wrote
-- before. strftime reads the trailing 'Z' as UTC; a value it cannot read is
-- left as it is.
UPDATE pages
   SET created_at = strftime('%Y-%m-%d %H:%M:%S', created_at)
 WHERE created_at LIKE '____-__-__T%'
   AND strftime('%Y-%m-%d %H:%M:%S', created_at) IS NOT NULL;

UPDATE pages
   SET updated_at = strftime('%Y-%m-%d %H:%M:%S', updated_at)
 WHERE updated_at LIKE '____-__-__T%'
   AND strftime('%Y-%m-%d %H:%M:%S', updated_at) IS NOT NULL;
