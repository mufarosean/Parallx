// Reads the practice tables (M104) back from a Media Organizer database after
// practice-probe.mjs has closed the app.
//
// better-sqlite3 is built for Electron: run with ELECTRON_RUN_AS_NODE=1.
//   electron practice-verify.cjs <dbPath>

'use strict';
const fs = require('fs');
const Database = require('better-sqlite3');

const [dbPath] = process.argv.slice(2);
if (!dbPath || !fs.existsSync(dbPath)) { console.log('no database'); process.exit(0); }
const db = new Database(dbPath, { readonly: true });
const out = [];
const has = (t) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
if (!has('mo_practice_sessions')) { console.log('no practice tables'); process.exit(0); }
out.push(`migration 022 recorded=${!!db.prepare("SELECT 1 FROM _migrations WHERE name LIKE '%022_practice%'").get()}`);
for (const s of db.prepare('SELECT * FROM mo_practice_sessions ORDER BY id').all()) {
  const draws = db.prepare('SELECT position, photo_id, planned_seconds, spent_seconds, outcome, drawn_at IS NOT NULL AS shown FROM mo_practice_draws WHERE session_id = ? ORDER BY position').all(s.id);
  out.push(`session #${s.id} ${s.kind} pool=${s.pool_json} per=${s.seconds_per}s planned=${s.planned_seconds}s spent=${s.spent_seconds}s ended=${s.ended_at ? 'yes' : 'no'} draws=[${draws.map((d) => `${d.position}:${d.outcome}${d.shown ? '' : '(unshown)'}/${d.spent_seconds}s`).join(' ')}]`);
}
out.push(`daily rows=${db.prepare('SELECT day, photo_id, session_id FROM mo_practice_daily').all().map((r) => `${r.day}:photo${r.photo_id}:session${r.session_id}`).join(' ') || '(none)'}`);
out.push(`presets=${db.prepare('SELECT COUNT(*) AS n FROM mo_practice_presets').get().n}`);
out.push(`pending draws left=${db.prepare("SELECT COUNT(*) AS n FROM mo_practice_draws WHERE outcome = 'pending'").get().n}`);
console.log(out.join('\n  '));
