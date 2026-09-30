// Reads the image editor's tables (docs/IMAGE_EDITOR.md) back from a Media
// Organizer database after image-editor-probe.mjs has closed the app.
//
// better-sqlite3 is built for Electron: run with ELECTRON_RUN_AS_NODE=1.
//   electron image-editor-verify.cjs <dbPath>

'use strict';
const fs = require('fs');
const Database = require('better-sqlite3');

const [dbPath] = process.argv.slice(2);
if (!dbPath || !fs.existsSync(dbPath)) { console.log('no database'); process.exit(0); }
const db = new Database(dbPath, { readonly: true });
const out = [];
const has = (t) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
if (!has('mo_photo_edits')) { console.log('no mo_photo_edits table'); process.exit(0); }
out.push(`presets table=${has('mo_edit_presets')} `);
out.push(`migration 026 recorded=${!!db.prepare("SELECT 1 FROM _migrations WHERE name LIKE '%026_photo_edits%'").get()}`);

const title = (id) => (db.prepare('SELECT f.basename FROM mo_photos_files pf JOIN mo_files f ON f.id = pf.file_id WHERE pf.photo_id = ? AND pf.is_primary = 1').get(id) || {}).basename || `#${id}`;
for (const e of db.prepare('SELECT photo_id, recipe_json FROM mo_photo_edits ORDER BY photo_id').all()) {
  let r = {};
  try { r = JSON.parse(e.recipe_json); } catch { /* bad json */ }
  const quiet = { vignetteMid: 0.5, vignetteFeather: 0.5, grainSize: 0.25, sharpenRadius: 1 };
  const set = Object.entries(r).filter(([k, v]) => typeof v === 'number' && v !== 0 && quiet[k] !== v).map(([k, v]) => `${k}=${v}`).join(' ');
  out.push(`edit of ${title(e.photo_id)}: ${set || '(no slider set)'} removals=${(r.removals || []).length} enhance=${r.enhance ? r.enhance.scale : 0}`);
}

const copies = db.prepare(`SELECT p.id, f.basename, i.width, i.height, p.rating FROM mo_photos p
  JOIN mo_photos_files pf ON pf.photo_id = p.id AND pf.is_primary = 1
  JOIN mo_files f ON f.id = pf.file_id
  LEFT JOIN mo_image_files i ON i.file_id = f.id
  WHERE f.basename LIKE '%-edit%' OR f.basename LIKE '%-2x%' ORDER BY p.id`).all();
for (const c of copies) {
  const stack = db.prepare(`SELECT s.primary_id, m.role FROM mo_stack_members m JOIN mo_stacks s ON s.id = m.stack_id
    WHERE m.member_type = 'photo' AND m.member_id = ?`).get(c.id);
  const tags = db.prepare('SELECT t.name FROM mo_photos_tags pt JOIN mo_tags t ON t.id = pt.tag_id WHERE pt.photo_id = ? ORDER BY t.name').all(c.id).map((t) => t.name);
  out.push(`copy ${c.basename} ${c.width}x${c.height} rating=${c.rating} stacked=${stack ? `${stack.role} under ${title(stack.primary_id)}` : 'no'} tags=[${tags.join(', ')}]`);
}
if (!copies.length) out.push('no copies in the library');

// Save writes over an original: is what the library holds for each file what is on disk?
const crypto = require('crypto');
const path = require('path');
const thumbRoot = path.join(path.dirname(dbPath), 'thumbnails');
const hasThumb = (md5) => { const walk = (d) => fs.existsSync(d) && fs.readdirSync(d, { withFileTypes: true }).some((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.includes(md5))); return !!md5 && walk(thumbRoot); };
const held = db.prepare(`SELECT p.id, f.basename, f.size, fo.path AS folder,
    (SELECT value FROM mo_fingerprints fp WHERE fp.file_id = f.id AND fp.type = 'md5') AS md5
  FROM mo_photos p JOIN mo_photos_files pf ON pf.photo_id = p.id AND pf.is_primary = 1
  JOIN mo_files f ON f.id = pf.file_id JOIN mo_folders fo ON fo.id = f.folder_id
  WHERE p.deleted_at IS NULL ORDER BY p.id`).all();
const stale = [];
for (const h of held) {
  const file = path.join(h.folder, h.basename);
  if (!fs.existsSync(file)) continue;
  const bytes = fs.readFileSync(file);
  const inStep = crypto.createHash('md5').update(bytes).digest('hex') === h.md5 && bytes.length === Number(h.size);
  if (!inStep) stale.push(h.basename);
  if (h.basename === 'fractal.jpg') {
    const tags = db.prepare('SELECT t.name FROM mo_photos_tags pt JOIN mo_tags t ON t.id = pt.tag_id WHERE pt.photo_id = ? ORDER BY t.name').all(h.id).map((t) => t.name);
    const edit = db.prepare('SELECT 1 FROM mo_photo_edits WHERE photo_id = ?').get(h.id);
    out.push(`record of fractal.jpg: photo ${h.id} ${inStep ? 'in step with the file' : 'NOT in step with the file'} tags=[${tags.join(', ')}] ${edit ? 'an edit is stored' : 'no edit stored'} ${hasThumb(h.md5) ? 'thumbnail for the new picture' : 'no thumbnail under its checksum'}`);
  }
}
out.push(`records in step with their files: ${stale.length ? `NO, not ${stale.join(', ')}` : `all ${held.length}`}`);
console.log(out.join('\n  '));
