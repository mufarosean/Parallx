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
if (has('mo_plans')) {
  for (const p of db.prepare('SELECT * FROM mo_plans ORDER BY id').all()) {
    const vs = db.prepare('SELECT id, name, recipe_json FROM mo_plan_variants WHERE plan_id = ? ORDER BY position').all(p.id);
    const media = db.prepare('SELECT kind, item_id, role FROM mo_plan_media WHERE plan_id = ? ORDER BY position').all(p.id);
    const desc = (v) => { let r = {}; try { r = JSON.parse(v.recipe_json); } catch { /* bad json */ } return `${v.name}: exposure=${r.exposure} grid=${r.overlays && r.overlays.grid} swatches=${((r.palette && r.palette.swatches) || []).length} crop=${r.crop ? r.crop.w.toFixed(3) + 'x' + r.crop.h.toFixed(3) : '?'}`; };
    out.push(`plan #${p.id} "${p.title}" photo=${p.photo_id} canvas=${p.canvas_w}x${p.canvas_h} kept=${p.variant_id} variants=[${vs.map(desc).join('; ')}] media=[${media.map((m) => `${m.kind}${m.item_id}:${m.role}`).join(' ')}]`);
  }
  out.push(`photos=${db.prepare('SELECT COUNT(*) AS n FROM mo_photos').get().n} stack members=${db.prepare('SELECT COUNT(*) AS n FROM mo_stack_members').get().n} plan files=${db.prepare("SELECT GROUP_CONCAT(basename) AS b FROM mo_files WHERE basename LIKE '%_plan_%'").get().b || '(none)'}`);
}
out.push(`offline root kept=${!!db.prepare("SELECT 1 FROM mo_files WHERE basename = 'gone.jpg'").get()} photo kept=${!!db.prepare("SELECT 1 FROM mo_photos WHERE title = 'gone'").get()} videos=${db.prepare('SELECT COUNT(*) AS n FROM mo_videos').get().n} codec=${(db.prepare('SELECT codec FROM mo_video_files LIMIT 1').get() || {}).codec || '-'}`);
try {
  const ws = require('path').resolve(require('path').dirname(dbPath), '..', '..', '..');
  const prev = require('path').join(ws, '.parallx', 'extensions', 'media-organizer', 'thumbnails', 'previews');
  out.push(`preview copies=${fs.existsSync(prev) ? fs.readdirSync(prev).join(',') || '(none)' : '(no dir)'}`);
} catch { /* no preview dir */ }
out.push(`pending draws left=${db.prepare("SELECT COUNT(*) AS n FROM mo_practice_draws WHERE outcome = 'pending'").get().n}`);
console.log(out.join('\n  '));
