// parentTags.js — applying a tag applies its parents (the Media Organizer).
//
// Applying a tag applies its parents, up to the top. Which parent: the one the
// tag was applied under (its sense), else its only parent; a tag filed under
// several parents and applied bare does not say which (JAGUAR under ANIMALS
// and CARS), so it climbs no further. A parent is applied in the sense of its
// own only parent, else bare. A tag the item already carries, in any sense,
// is left as it is. Every path that applies tags calls this after it writes.
// Returns the parent tag ids it added.
const SINGLE_PARENT = 'SELECT child_id AS child, MIN(parent_id) AS parent FROM mo_tags_relations GROUP BY child_id HAVING COUNT(*) = 1';
const TAG_TABLES = { photo: ['mo_photos_tags', 'photo_id', true], video: ['mo_videos_tags', 'video_id', true], album: ['mo_albums_tags', 'album_id', false] };
export async function moApplyParentTags(db, kind, itemIds) {
  const [table, col, hasVia] = TAG_TABLES[kind] || TAG_TABLES.photo; // albums carry no sense
  const ids = [...new Set((itemIds || []).map(Number).filter(Number.isFinite))];
  const added = new Set();
  for (let i = 0; i < ids.length; i += 400) {
    const chunk = ids.slice(i, i + 400);
    const rows = await db.all(
      `WITH RECURSIVE single(child, parent) AS (${SINGLE_PARENT}),
       up(item, tag, via) AS (
         SELECT ${col}, tag_id, ${hasVia ? 'via_parent_id' : '0'} FROM ${table} WHERE ${col} IN (${chunk.map(() => '?').join(',')})
         UNION
         SELECT u.item, COALESCE(NULLIF(u.via, 0), s.parent), COALESCE(s2.parent, 0)
         FROM up u
         LEFT JOIN single s ON s.child = u.tag
         LEFT JOIN single s2 ON s2.child = COALESCE(NULLIF(u.via, 0), s.parent)
         WHERE COALESCE(NULLIF(u.via, 0), s.parent) IS NOT NULL
       )
       SELECT item, tag, MIN(via) AS via FROM up u
       WHERE NOT EXISTS (SELECT 1 FROM ${table} y WHERE y.${col} = u.item AND y.tag_id = u.tag)
         AND EXISTS (SELECT 1 FROM mo_tags t WHERE t.id = u.tag)
       GROUP BY item, tag`,
      chunk,
    );
    if (rows.length === 0) continue;
    await db.transaction(rows.map((r) => hasVia
      ? { type: 'run', sql: `INSERT OR IGNORE INTO ${table} (${col}, tag_id, via_parent_id) VALUES (?, ?, ?)`, params: [r.item, r.tag, Number(r.via) || 0] }
      : { type: 'run', sql: `INSERT OR IGNORE INTO ${table} (${col}, tag_id) VALUES (?, ?)`, params: [r.item, r.tag] }));
    for (const r of rows) added.add(Number(r.tag));
  }
  return [...added];
}
