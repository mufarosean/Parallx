// Tag rules + Tag Review queue, on a real SQLite database (docs/AI_TAGGING.md).
//
// Runs the extension's own code, not a copy: the DB wrapper and tag queries
// (Sections 1-6) and the AI-tagging section (43) are cut out of
// ext/media-organizer/main.js and executed against an in-memory database built
// from every migration in ext/media-organizer/db/migrations.
//
// better-sqlite3 is built for Electron, so run it with Electron's Node:
//   $env:ELECTRON_RUN_AS_NODE=1; node_modules\electron\dist\electron.exe tests\probes\tag-rules-probe.cjs

'use strict';
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const root = path.resolve(__dirname, '..', '..');
const src = fs.readFileSync(path.join(root, 'ext', 'media-organizer', 'main.js'), 'utf8');
const cut = (from, to) => {
  const a = src.indexOf(from);
  const b = src.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error(`marker not found: ${from} / ${to}`);
  return src.slice(src.lastIndexOf('\n', src.lastIndexOf('// ═', a)) + 1, src.lastIndexOf('\n', src.lastIndexOf('// ═', b)) + 1);
};
const core = cut('// SECTION 1: DATABASE WRAPPER', '// SECTION 7: PHOTO QUERIES');
const tagging = cut('// SECTION 43: AI TAGGING', '// SECTION 44: ACTIVATION');

// ── A real database from the real migrations ──
const sqlite = new Database(':memory:');
sqlite.pragma('foreign_keys = ON');
const migDir = path.join(root, 'ext', 'media-organizer', 'db', 'migrations');
for (const f of fs.readdirSync(migDir).filter((n) => n.endsWith('.sql')).sort()) {
  sqlite.exec(fs.readFileSync(path.join(migDir, f), 'utf8'));
}
const bridge = {
  async run(sql, params = []) {
    try { const r = sqlite.prepare(sql).run(params); return { changes: r.changes, lastInsertRowid: Number(r.lastInsertRowid) }; } catch (e) { return { error: { message: e.message } }; }
  },
  async get(sql, params = []) {
    try { return { row: sqlite.prepare(sql).get(params) ?? null }; } catch (e) { return { error: { message: e.message } }; }
  },
  async all(sql, params = []) {
    try { return { rows: sqlite.prepare(sql).all(params) }; } catch (e) { return { error: { message: e.message } }; }
  },
  async runTransaction(ops) {
    try {
      const results = sqlite.transaction(() => ops.map((op) => sqlite.prepare(op.sql).run(op.params || [])))();
      return { results };
    } catch (e) { return { error: { message: e.message } }; }
  },
};

// ── What Sections 1-6 and 43 reach for outside themselves ──
const events = [];
global.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } };
global.document = { dispatchEvent(e) { events.push(e); return true; } };
const preamble = `
  let _api = null; let _moClosing = false; const _commandDisposables = [];
  function _notifySidebarRefresh() {}
  function moIsGifPath(p) { return !!p && /\\.gif$/i.test(p); }
  async function moGetSetting(k, d) { return d; }
  async function moSetSetting() {}
  async function moResolveItemPath() { return null; }
  async function resolveThumbnail() { return null; }
  function setThumbImgSrc() {} function openLightbox() {} function moEl() { throw new Error('no DOM in the probe'); } function moIcon() { return ''; }
`;
const names = ['TagQueries', 'moNormalizeTagName', 'moTagQueue', 'moTagApprove', 'moTagSetPicks', 'moTagSkip', 'moTagRetry',
  'moTagCounts', 'moTagEligible', 'moTagWithAI', 'moToolTagPhotos', 'MO_TAG_UNTAGGED_FROM', '_moTagRun'];
// eslint-disable-next-line no-new-func
const M = new Function(preamble + core + tagging + `\n_dbBridge = arguments[0];\nreturn { ${names.join(', ')} };`)(bridge);
const T = M.TagQueries;

// ── Tiny harness ──
let pass = 0;
const fails = [];
const ok = (cond, label) => { if (cond) pass++; else fails.push(label); };
const eq = (a, b, label) => ok(JSON.stringify(a) === JSON.stringify(b), `${label}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const throwsLike = async (fn, re, label) => {
  try { await fn(); fails.push(`${label}: did not throw`); } catch (e) { ok(re.test(String(e && e.message)), `${label}: threw "${e && e.message}"`); }
};
const parents = (id) => sqlite.prepare('SELECT parent_id FROM mo_tags_relations WHERE child_id = ? ORDER BY parent_id').all(id).map((r) => r.parent_id);
const multiParent = () => sqlite.prepare('SELECT child_id FROM mo_tags_relations GROUP BY child_id HAVING COUNT(*) > 1').all();

(async () => {
  // Capitals and case-insensitive uniqueness
  const beach = await T.create({ name: '  beach ' });
  eq(beach.name, 'BEACH', 'create stores capitals, trimmed');
  eq((await T.create({ name: 'golden   retriever' })).name, 'GOLDEN RETRIEVER', 'create collapses spaces');
  await throwsLike(() => T.create({ name: 'Beach' }), /BEACH|already|exist|duplicate/i, 'create refuses a case-only duplicate');
  await throwsLike(() => T.create({ name: '   ' }), /empty/i, 'create refuses an empty name');
  eq((await T.update(beach.id, { name: 'coast' })).name, 'COAST', 'rename stores capitals');
  await throwsLike(() => T.update(beach.id, { name: 'Golden Retriever' }), /GOLDEN RETRIEVER|already|exist|duplicate/i, 'rename refuses a case-only duplicate');
  eq((await T.update(beach.id, { name: 'Coast' })).name, 'COAST', 'renaming a tag to its own name in another case is fine');

  // One parent per tag
  const animals = await T.create({ name: 'animals' });
  const pets = await T.create({ name: 'pets' });
  const dog = await T.create({ name: 'dog' });
  const corgi = await T.create({ name: 'corgi' });
  const cat = await T.create({ name: 'cat' });
  await T.addParent(dog.id, animals.id);
  await T.addParent(corgi.id, dog.id);
  await T.addParent(corgi.id, pets.id);
  eq(parents(corgi.id), [pets.id], 'addParent moves the tag (one parent)');
  await throwsLike(() => T.addParent(animals.id, dog.id), /cycle/i, 'addParent refuses a loop');
  await throwsLike(() => T.update(cat.id, { parentIds: [animals.id, pets.id] }), /one parent/i, 'update refuses two parents');
  await T.update(cat.id, { parentIds: [pets.id] });
  eq(parents(cat.id), [pets.id], 'update sets the one parent');
  await T.addChild(dog.id, corgi.id);
  eq(parents(corgi.id), [dog.id], 'addChild moves the child');
  await T.updateChildTags(animals.id, [dog.id, cat.id]);
  eq(parents(cat.id), [animals.id], 'updateChildTags moves each child');
  await T.update(pets.id, { childIds: [cat.id] });
  eq(parents(cat.id), [pets.id], 'update childIds moves each child');
  await throwsLike(() => T.bulkUpdate([corgi.id], { parentIds: { mode: 'add', values: [animals.id, pets.id] } }), /one parent/i, 'bulkUpdate refuses two parents');
  eq(multiParent(), [], 'no tag has two parents');

  // Merge keeps one parent and never closes a loop
  const places = await T.create({ name: 'places' });
  const src1 = await T.create({ name: 'seaside' });   // under PETS, child SAND
  const sand = await T.create({ name: 'sand' });
  await T.addParent(src1.id, pets.id);
  await T.addParent(sand.id, src1.id);
  const dest = await T.create({ name: 'shore' });     // under PLACES
  await T.addParent(dest.id, places.id);
  await T.merge([src1.id], dest.id);
  eq(parents(dest.id), [places.id], 'merge: destination keeps its place');
  eq(parents(sand.id), [dest.id], 'merge: source children move to the destination');
  eq(multiParent(), [], 'merge: no tag has two parents');
  ok(sqlite.prepare('SELECT alias FROM mo_tag_aliases WHERE tag_id = ?').all(dest.id).some((r) => r.alias === 'SEASIDE'), 'merge: the source name becomes an alias');
  // Chain A > B > C, merge A into C: B must not end up under C while C is under B.
  const a = await T.create({ name: 'chain a' });
  const b = await T.create({ name: 'chain b' });
  const c = await T.create({ name: 'chain c' });
  await T.addParent(b.id, a.id);
  await T.addParent(c.id, b.id);
  await T.merge([a.id], c.id);
  ok(!(parents(b.id).includes(c.id) && parents(c.id).includes(b.id)), 'merge: no loop between B and C');
  eq(parents(b.id), [], 'merge: the loop-closing child goes to the top level');
  eq(multiParent(), [], 'merge (chain): no tag has two parents');

  await T.updateAliases(dog.id, ['puppy', ' hound ']);
  eq(sqlite.prepare('SELECT alias FROM mo_tag_aliases WHERE tag_id = ? ORDER BY alias').all(dog.id).map((r) => r.alias), ['HOUND', 'PUPPY'], 'aliases are stored in capitals');

  // ── Tag Review queue on real rows ──
  // Fixture rows: the given values, plus a placeholder for any other NOT NULL
  // column without a default (the schema decides, not this probe).
  const insert = (table, values) => {
    const row = { ...values };
    for (const c of sqlite.prepare(`PRAGMA table_info(${table})`).all()) {
      if (c.name in row || c.pk || !c.notnull || c.dflt_value !== null) continue;
      row[c.name] = /INT|REAL|NUM/i.test(c.type) ? 1 : `x-${table}-${c.name}-${Math.random()}`;
    }
    const keys = Object.keys(row);
    const sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`;
    return Number(sqlite.prepare(sql).run(keys.map((k) => row[k])).lastInsertRowid);
  };
  const folder = insert('mo_folders', { path: 'C:\\lib' });
  const addPhoto = (basename, opts = {}) => {
    const photo = insert('mo_photos', { title: basename });
    const file = insert('mo_files', { folder_id: folder, basename });
    insert('mo_photos_files', { photo_id: photo, file_id: file, is_primary: 1 });
    if (opts.deleted) sqlite.prepare("UPDATE mo_photos SET deleted_at = datetime('now') WHERE id = ?").run(photo);
    return photo;
  };
  const tagged = addPhoto('tagged.jpg');
  sqlite.prepare('INSERT INTO mo_photos_tags (photo_id, tag_id) VALUES (?, ?)').run(tagged, beach.id);
  const plain = addPhoto('plain.jpg');
  const gif = addPhoto('loop.gif');
  addPhoto('trashed.jpg', { deleted: true });
  const inReview = addPhoto('queued.jpg');
  const primary = addPhoto('primary.jpg');
  const stacked = addPhoto('stacked-copy.jpg');
  const stack = insert('mo_stacks', { primary_type: 'photo', primary_id: primary });
  insert('mo_stack_members', { stack_id: stack, member_type: 'photo', member_id: primary, role: 'primary', position: 0 });
  insert('mo_stack_members', { stack_id: stack, member_type: 'photo', member_id: stacked, role: 'member', position: 1 });
  await M.moTagQueue([inReview]);
  const untagged = sqlite.prepare(`SELECT p.id ${M.MO_TAG_UNTAGGED_FROM} ORDER BY p.id`).all().map((r) => r.id);
  eq(untagged, [plain, primary], 'untagged = live, not GIF, not a stacked copy, not already in review');

  const elig = await M.moTagEligible([{ type: 'photo', id: plain }, { type: 'photo', id: gif }, { type: 'video', id: 1 }, { type: 'photo', id: 9999 }, { type: 'photo', id: plain }]);
  eq(elig, { ids: [plain], skipped: { gif: 1, notPhoto: 1, missing: 1 } }, 'eligibility: photos only, GIFs and missing left out, no duplicates');

  // Queue: a re-queue starts a row over, but never a row mid-run.
  await M.moTagQueue([plain]);
  const row = () => sqlite.prepare('SELECT * FROM mo_ai_tag_reviews WHERE photo_id = ?').get(plain);
  sqlite.prepare("UPDATE mo_ai_tag_reviews SET status = 'running' WHERE photo_id = ?").run(plain);
  await M.moTagQueue([plain]);
  eq(row().status, 'running', 'queue leaves a running row alone');
  sqlite.prepare("UPDATE mo_ai_tag_reviews SET status = 'pending', tag_ids = ? WHERE photo_id = ?").run(JSON.stringify([corgi.id]), plain);
  await M.moTagQueue([plain]);
  eq([row().status, row().tag_ids], ['queued', '[]'], 'queue starts a finished row over');

  // Approve adds the picks and every parent, keeps existing tags, removes the row.
  sqlite.prepare('INSERT INTO mo_photos_tags (photo_id, tag_id) VALUES (?, ?)').run(plain, beach.id);
  sqlite.prepare("UPDATE mo_ai_tag_reviews SET status = 'pending', tag_ids = ? WHERE photo_id = ?").run(JSON.stringify([corgi.id]), plain);
  events.length = 0;
  eq(await M.moTagApprove(row().id), 1, 'approve reports one photo');
  const onPhoto = sqlite.prepare('SELECT tag_id FROM mo_photos_tags WHERE photo_id = ? ORDER BY tag_id').all(plain).map((r) => r.tag_id);
  eq(onPhoto, [beach.id, animals.id, dog.id, corgi.id].sort((x, y) => x - y), 'approve: CORGI brings DOG and ANIMALS, BEACH stays');
  eq(row(), undefined, 'approve removes the row');
  ok(events.some((e) => e.type === 'mo:tags-bulk-changed' && e.detail.keys[0] === `photo:${plain}`), 'approve tells open grids which card changed');

  // A pick on a No Match row makes it reviewable; Skip and Retry.
  await M.moTagQueue([primary]);
  const prow = () => sqlite.prepare('SELECT * FROM mo_ai_tag_reviews WHERE photo_id = ?').get(primary);
  sqlite.prepare("UPDATE mo_ai_tag_reviews SET status = 'nomatch' WHERE photo_id = ?").run(primary);
  await M.moTagSetPicks(prow().id, [cat.id]);
  eq([prow().status, prow().tag_ids], ['pending', JSON.stringify([cat.id])], 'a pick on No Match makes it pending');
  sqlite.prepare("UPDATE mo_ai_tag_reviews SET status = 'failed', error = 'x' WHERE photo_id = ?").run(primary);
  await M.moTagRetry(prow().id);
  eq([prow().status, prow().error], ['queued', null], 'retry re-queues a failed row');
  sqlite.prepare("UPDATE mo_ai_tag_reviews SET status = 'running' WHERE photo_id = ?").run(primary);
  await M.moTagSkip(prow().id);
  ok(!!prow(), 'skip never removes a row mid-run');
  sqlite.prepare("UPDATE mo_ai_tag_reviews SET status = 'pending' WHERE photo_id = ?").run(primary);
  await M.moTagSkip(prow().id);
  eq(prow(), undefined, 'skip removes the row');

  // Deleting a photo takes its review row with it.
  await M.moTagQueue([stacked]);
  sqlite.prepare('DELETE FROM mo_photos_files WHERE photo_id = ?').run(stacked);
  sqlite.prepare('DELETE FROM mo_photos WHERE id = ?').run(stacked);
  eq(sqlite.prepare('SELECT COUNT(*) AS n FROM mo_ai_tag_reviews WHERE photo_id = ?').get(stacked).n, 0, 'a purged photo leaves no review row');

  // The chat tool's count and its refusal without a vision model (no model in the probe).
  const count = await M.moToolTagPhotos({ countOnly: true });
  ok(/^1 untagged photo /.test(count.content), `tool countOnly: "${count.content}"`);
  const start = await M.moToolTagPhotos({});
  ok(start.isError && /not available/i.test(start.content), `tool refuses without a model: "${start.content}"`);
  eq((await M.moTagCounts()).queued, 1, 'a refused start queues nothing new');

  console.log(`\n${pass} passed, ${fails.length} failed`);
  for (const f of fails) console.log('  FAIL ' + f);
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('PROBE CRASH', e); process.exit(2); });
