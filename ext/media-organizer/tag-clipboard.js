// tag-clipboard.js — Copy Tags from one photo or video, Paste Tags onto one or
// many. A paste adds: tags the targets already have stay, nothing is
// removed. Each tag keeps the sense it was given (via_parent_id: the parent a
// multi-parent tag was applied through).

let clip = null; // { tags: [{ tagId, via }], names: [string], from: string }

const TABLE = { photo: ['mo_photos_tags', 'photo_id'], video: ['mo_videos_tags', 'video_id'] };
const parseKey = (k) => { const i = String(k).indexOf(':'); return { type: String(k).slice(0, i), id: Number(String(k).slice(i + 1)) }; };

export const moTagClip = () => clip;

// The tags of one item (key "photo:12"). Returns how many were copied.
export async function moCopyTags(db, key) {
  const { type, id } = parseKey(key);
  const t = TABLE[type];
  if (!t || !(id > 0)) return 0;
  const rows = await db.all(`SELECT x.tag_id AS tagId, x.via_parent_id AS via, g.name FROM ${t[0]} x JOIN mo_tags g ON g.id = x.tag_id WHERE x.${t[1]} = ? ORDER BY g.name`, [id]);
  if (!rows.length) return 0;
  clip = { tags: rows.map((r) => ({ tagId: r.tagId, via: r.via || 0 })), names: [...new Set(rows.map((r) => r.name))], from: key };
  return clip.names.length;
}

// Adds the copied tags to every item in keys. Returns { items, tagIds } or null with nothing copied.
export async function moPasteTags(db, keys) {
  if (!clip) return null;
  const targets = [...new Set(keys)].map(parseKey).filter((k) => TABLE[k.type] && k.id > 0);
  const ops = [];
  for (const k of targets) {
    const [table, col] = TABLE[k.type];
    for (const tag of clip.tags) ops.push({ type: 'run', sql: `INSERT OR IGNORE INTO ${table} (${col}, tag_id, via_parent_id) VALUES (?, ?, ?)`, params: [k.id, tag.tagId, tag.via] });
  }
  if (ops.length) await db.transaction(ops);
  return { items: targets.length, tagIds: [...new Set(clip.tags.map((t) => t.tagId))] };
}
