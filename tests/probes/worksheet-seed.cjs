// worksheet-seed.cjs — a synthetic problem bank for the hidden worksheet
// screens probe. Runs against a workspace database the app has ALREADY
// migrated (the probe opens Worksheets once first), so every table exists.
// Nothing here comes from a real workspace.
//
// better-sqlite3 is built for Electron: run with ELECTRON_RUN_AS_NODE=1.
//   electron worksheet-seed.cjs <dbPath>
'use strict';
const Database = require('better-sqlite3');
const [dbPath] = process.argv.slice(2);
if (!dbPath) { console.error('usage: worksheet-seed.cjs <dbPath>'); process.exit(2); }
const db = new Database(dbPath);
const DAY = 86400000;
const NOW = Date.now();
const dayKey = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
let seed = 11;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

const PAPERS = [['brosius', 'Brosius'], ['clark', 'Clark'], ['venter', 'Venter'], ['verrall', 'Verrall'], ['meyers', 'Meyers'], ['siewert', 'Siewert']];
const sheet = (title, i) => JSON.stringify({
  id: 'wb', sheetOrder: ['s1'], appVersion: '0.1',
  sheets: { s1: { id: 's1', name: 'Sheet1', rowCount: 60, columnCount: 20, cellData: {
    0: { 0: { v: title, s: null } },
    2: { 1: { v: 'Given the following information:' } },
    4: { 1: { v: 'Accident Year' }, 2: { v: 'Reported' }, 3: { v: 'Paid' } },
    5: { 1: { v: 2021 }, 2: { v: 1200 + i * 10 }, 3: { v: 900 + i * 5 } },
    6: { 1: { v: 2022 }, 2: { v: 1350 + i * 10 }, 3: { v: 980 + i * 5 } },
    8: { 1: { v: 'Question: estimate the ultimate loss for accident year 2022.' } },
  } } },
});

const insItem = db.prepare(`INSERT INTO ws_items (title, question_md, created_at, sheet_json, paper, source, kind, quadrant, sheet_name, source_label)
  VALUES (?, '', ?, ?, ?, ?, ?, ?, ?, 'Seed workbook')`);
const insAttempt = db.prepare(`INSERT INTO ws_attempts (item_id, started_at, updated_at, cells_json, self_grade, completed, seconds, session_id, imported, worked_at)
  VALUES (?, ?, ?, '', ?, 1, ?, ?, ?, ?)`);
const ids = [];
const tx = db.transaction(() => {
  for (const [paper, label] of PAPERS) {
    for (let i = 1; i <= 8; i++) {
      const title = `RF ${label} - ${i}`;
      const r = insItem.run(title, NOW - (40 + i) * DAY, sheet(title, i), paper, rnd() < 0.8 ? 'rf' : 'cas', rnd() < 0.8 ? 'quant' : 'qual', 1 + Math.floor(rnd() * 4), title);
      ids.push({ id: Number(r.lastInsertRowid), paper });
    }
  }
  // Ratings over the last twelve days, weighted so the papers differ.
  for (const it of ids) {
    const cover = it.paper === 'verrall' ? 0.2 : it.paper === 'venter' ? 0.4 : 0.7;
    if (rnd() > cover) continue;
    const g = rnd();
    const grade = g < 0.45 ? 'easy' : g < 0.75 ? 'medium' : 'hard';
    const ago = Math.floor(rnd() * 12);
    const at = NOW - ago * DAY - Math.floor(rnd() * 6) * 3600000;
    const imported = ago > 10 ? 1 : 0;
    insAttempt.run(it.id, at - 600000, at, grade, 300 + Math.floor(rnd() * 900), '', imported, imported ? 0 : at - 300000);
  }
  // Worked today without a rating: two of them.
  for (const it of ids.slice(3, 5)) {
    db.prepare(`INSERT INTO ws_attempts (item_id, started_at, updated_at, cells_json, self_grade, completed, seconds, worked_at) VALUES (?, ?, ?, '{"x":1}', '', 0, 400, ?)`).run(it.id, NOW - 3600000, NOW - 1800000, NOW - 1800000);
  }
  // The campaign: day 8 of 22, Fridays off.
  const start = NOW - 7 * DAY;
  db.prepare(`INSERT OR REPLACE INTO ws_campaign (id, start_day, days, daily_target, started_at, rest_days) VALUES (1, ?, 22, 3, ?, '[5]')`).run(dayKey(start), start);
  // Notes on five problems.
  const notes = ['Review the tail factor derivation', 'Watch the units: $000s', 'Compare with Mack: the variance term', 'Never remember the formula for the bias adjustment', 'Do again before the exam'];
  ids.slice(0, 5).forEach((it, i) => db.prepare('INSERT INTO ws_problem_note (item_id, note, updated_at) VALUES (?, ?, ?)').run(it.id, notes[i], NOW - i * DAY));
  // Stars on three.
  for (const it of ids.slice(6, 9)) db.prepare('INSERT INTO ws_star (item_id, starred_at) VALUES (?, ?)').run(it.id, NOW - 2 * DAY);
  // Study time: the last ten days, one to three hours a day over a few problems.
  for (let d = 0; d < 10; d++) {
    const day = dayKey(NOW - d * DAY);
    const picks = ids.slice((d * 5) % ids.length, (d * 5) % ids.length + 4);
    for (const it of picks) db.prepare('INSERT OR REPLACE INTO ws_study_time (day, item_id, session_id, seconds) VALUES (?, ?, ?, ?)').run(day, it.id, '', 900 + Math.floor(rnd() * 1500));
    db.prepare('INSERT OR REPLACE INTO ws_study_time (day, item_id, session_id, seconds) VALUES (?, 0, ?, ?)').run(day, 'q-open', 300);
  }
  // Rewards earned.
  db.prepare('INSERT OR REPLACE INTO ws_reward (id, unlocked_at) VALUES (?, ?)').run('first-step', NOW - 6 * DAY);
  db.prepare('INSERT OR REPLACE INTO ws_reward (id, unlocked_at) VALUES (?, ?)').run('full-day', NOW - 5 * DAY);
  // Quizzes: one open at its second problem with two marked, one completed.
  const openIds = ids.slice(0, 6).map((x) => x.id);
  db.prepare(`INSERT INTO ws_quiz_session (id, name, item_ids, position, skipped, marked, started_at, touched_at, finished_at) VALUES ('q-open', 'Day 8 Draw', ?, 1, '[]', ?, ?, ?, NULL)`)
    .run(JSON.stringify(openIds), JSON.stringify([openIds[2], openIds[4]]), NOW - 3600000, NOW - 600000);
  const doneIds = ids.slice(10, 16).map((x) => x.id);
  db.prepare(`INSERT INTO ws_quiz_session (id, name, item_ids, position, skipped, marked, started_at, touched_at, finished_at) VALUES ('q-done', 'Day 6 Draw', ?, 6, '[]', '[]', ?, ?, ?)`)
    .run(JSON.stringify(doneIds), NOW - 2 * DAY, NOW - 2 * DAY + 7200000, NOW - 2 * DAY + 7200000);
});
tx();
console.log(`seeded ${ids.length} problems into ${dbPath}`);
