// Seeds (and afterwards reads back) a Media Organizer database for the Tag
// Review scene of ui-screenshot-probe.mjs (docs/AI_TAGGING.md).
//
// The database is built the way the app builds it: every migration applied
// and recorded in _migrations, so the app's own migrate() finds nothing to do.
// Photos are real files with real sizes and MD5 fingerprints, so the
// extension makes thumbnails for them as it would after a scan.
//
// better-sqlite3 is built for Electron: run with ELECTRON_RUN_AS_NODE=1.
//   electron tag-review-seed.cjs seed   <dbPath> <photosDir> <spec.json>
//   electron tag-review-seed.cjs verify <dbPath>
// spec.json: [{ "basename": "boxing.jpg", "width": 564, "height": 846 }, ...]

'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const [mode, dbPath, photosDir, specPath] = process.argv.slice(2);
const root = path.resolve(__dirname, '..', '..');

function insert(db, table, values) {
  const row = { ...values };
  for (const c of db.prepare(`PRAGMA table_info(${table})`).all()) {
    if (c.name in row || c.pk || !c.notnull || c.dflt_value !== null) continue;
    row[c.name] = /INT|REAL|NUM/i.test(c.type) ? 0 : '';
  }
  const keys = Object.keys(row);
  return Number(db.prepare(`INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(keys.map((k) => row[k])).lastInsertRowid);
}

if (mode === 'seed') {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  const migDir = path.join(root, 'ext', 'media-organizer', 'db', 'migrations');
  for (const f of fs.readdirSync(migDir).filter((n) => n.endsWith('.sql')).sort()) {
    db.transaction(() => {
      db.exec(fs.readFileSync(path.join(migDir, f), 'utf8'));
      db.prepare('INSERT INTO _migrations (name) VALUES (?)').run(f);
    })();
  }

  const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
  const folder = insert(db, 'mo_folders', { path: photosDir });
  const photo = {};
  for (const s of spec) {
    const full = path.join(photosDir, s.basename);
    const buf = fs.readFileSync(full);
    const file = insert(db, 'mo_files', { folder_id: folder, basename: s.basename, size: buf.length });
    insert(db, 'mo_fingerprints', { file_id: file, type: 'md5', value: crypto.createHash('md5').update(buf).digest('hex') });
    insert(db, 'mo_image_files', { file_id: file, width: s.width, height: s.height });
    const id = insert(db, 'mo_photos', { title: s.basename.replace(/\.[^.]+$/, '') });
    insert(db, 'mo_photos_files', { photo_id: id, file_id: file, is_primary: 1 });
    photo[s.basename] = id;
  }

  // The user's tree, in capitals, one parent per tag.
  const tree = [['SPORTS'], ['BOXING', 'SPORTS'], ['TENNIS', 'SPORTS'], ['PEOPLE'], ['CROWD', 'PEOPLE'], ['PORTRAIT', 'PEOPLE'],
    ['EQUIPMENT'], ['CAMERA', 'EQUIPMENT'], ['ANIMALS'], ['DOG', 'ANIMALS'], ['CORGI', 'DOG'], ['PLACES'], ['BEACH', 'PLACES'],
    ['PATTERNS'], ['TEST CARD', 'PATTERNS'], ['FRACTAL', 'PATTERNS']];
  const tag = {};
  for (const [name, parent] of tree) {
    tag[name] = insert(db, 'mo_tags', { name });
    if (parent) db.prepare('INSERT INTO mo_tags_relations (parent_id, child_id) VALUES (?, ?)').run(tag[parent], tag[name]);
  }
  db.prepare("UPDATE mo_tags SET description = 'Colour bars and test patterns' WHERE id = ?").run(tag['TEST CARD']);
  // One photo already carries a tag of its own.
  db.prepare('INSERT INTO mo_photos_tags (photo_id, tag_id) VALUES (?, ?)').run(photo['fractal.jpg'], tag.PATTERNS);

  const review = db.prepare('INSERT INTO mo_ai_tag_reviews (photo_id, status, tag_ids, error, model) VALUES (?, ?, ?, ?, ?)');
  review.run(photo['boxing.jpg'], 'pending', JSON.stringify([tag.BOXING, tag.CROWD, tag.CAMERA]), null, 'qwen3.8:27b');
  review.run(photo['card.jpg'], 'nomatch', '[]', null, 'qwen3.8:27b');
  review.run(photo['fractal.jpg'], 'failed', '[]', 'The model did not reply with a tag list.', 'qwen3.8:27b');
  review.run(photo['bars.jpg'], 'queued', '[]', null, null);
  db.close();
  console.log(JSON.stringify({ photo, tag }));
} else if (mode === 'verify') {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  const tagsOf = {};
  for (const r of db.prepare(`SELECT f.basename, t.name FROM mo_photos_tags pt JOIN mo_tags t ON t.id = pt.tag_id
      JOIN mo_photos_files pf ON pf.photo_id = pt.photo_id AND pf.is_primary = 1 JOIN mo_files f ON f.id = pf.file_id ORDER BY f.basename, t.name`).all()) {
    (tagsOf[r.basename] = tagsOf[r.basename] || []).push(r.name);
  }
  const reviews = db.prepare(`SELECT f.basename, r.status, r.tag_ids, r.error FROM mo_ai_tag_reviews r
      JOIN mo_photos_files pf ON pf.photo_id = r.photo_id AND pf.is_primary = 1 JOIN mo_files f ON f.id = pf.file_id ORDER BY r.id`).all();
  const tagNames = db.prepare('SELECT name FROM mo_tags ORDER BY name').all().map((r) => r.name);
  console.log(JSON.stringify({ tagsOf, reviews, tagNames }));
  db.close();
} else {
  console.error('usage: tag-review-seed.cjs seed <dbPath> <photosDir> <spec.json> | verify <dbPath>');
  process.exit(2);
}
