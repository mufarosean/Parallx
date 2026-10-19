// worksheet-roster-seed.cjs — a roster over the synthetic bank that
// worksheet-seed.cjs made: twelve problems tagged roster-test, nine still
// starred (two unstarred today, one yesterday), three rated today.
// Nothing here comes from a real workspace.
//
//   electron worksheet-roster-seed.cjs <dbPath>   (ELECTRON_RUN_AS_NODE=1)
'use strict';
const Database = require('better-sqlite3');
const [dbPath] = process.argv.slice(2);
const db = new Database(dbPath);
const NOW = Date.now();
const dayKey = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const today = dayKey(NOW);
const startOfToday = new Date(`${today}T00:00:00`).getTime();
const ids = db.prepare("SELECT id FROM ws_items WHERE source IN ('rf', 'cas') ORDER BY id LIMIT 12").all().map((r) => r.id);
db.transaction(() => {
  for (const id of ids) {
    const tags = db.prepare('SELECT tags FROM ws_items WHERE id = ?').get(id).tags;
    db.prepare('UPDATE ws_items SET tags = ? WHERE id = ?').run([tags, 'roster-test'].filter(Boolean).join(','), id);
    db.prepare('INSERT OR IGNORE INTO ws_star (item_id, starred_at) VALUES (?, ?)').run(id, startOfToday - 2 * 86400000);
  }
  const unstar = (id, at) => {
    db.prepare('DELETE FROM ws_star WHERE item_id = ?').run(id);
    db.prepare('INSERT INTO ws_star_log (item_id, starred, at) VALUES (?, 0, ?)').run(id, at);
  };
  unstar(ids[0], startOfToday - 3 * 3600000);
  unstar(ids[1], startOfToday + 60000);
  unstar(ids[2], startOfToday + 120000);
  for (const id of ids.slice(1, 4)) {
    db.prepare("INSERT INTO ws_attempts (item_id, started_at, updated_at, cells_json, self_grade, completed) VALUES (?, ?, ?, '', 'easy', 1)").run(id, startOfToday + 30000, startOfToday + 90000);
  }
  // Unfinished work from before any quiz on the problems still starred: a quiz must open them clean.
  for (const id of ids.slice(3)) {
    db.prepare('INSERT INTO ws_attempts (item_id, started_at, updated_at, cells_json, completed) SELECT id, ?, ?, sheet_json, 0 FROM ws_items WHERE id = ?').run(startOfToday - 86400000, startOfToday - 86400000, id);
  }
  // A practice exam question that names a paper in its title, not to be sat yet.
  db.prepare("INSERT INTO ws_items (title, question_md, created_at, sheet_json, paper, source, kind, quadrant, sheet_name, source_label) SELECT 'PE 3 · Q #4 · Clark', '', ?, sheet_json, 'pe3', 'exam', 'quant', 0, 'Q #4', '' FROM ws_items WHERE id = ?").run(NOW, ids[0]);
  db.prepare('INSERT INTO ws_roster (id, tag, start_day, end_day, created_at) VALUES (1, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET tag = excluded.tag, start_day = excluded.start_day, end_day = excluded.end_day')
    .run('roster-test', dayKey(startOfToday - 86400000), dayKey(startOfToday + 4 * 86400000), NOW);
})();
console.log(`roster: ${ids.length} tagged, ${db.prepare('SELECT COUNT(*) n FROM ws_star WHERE item_id IN (' + ids.join(',') + ')').get().n} starred`);
db.close();
