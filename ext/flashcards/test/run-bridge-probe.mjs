// run-bridge-probe.mjs — verification of the ankiBridge worker lifecycle.
//
// The apkg probe exercises parsing; this one exercises the BRIDGE: spawning
// ankiWorker in a worker_thread, the bridge-owned temp-dir lifetime, the
// age-guarded stale sweep (old orphans removed, recent dirs — possibly a
// second live instance's — preserved), and the ok:false error shape.
//
// Headless: no Electron app, no window (dev machine = study machine).
//
// Run (better-sqlite3 is Electron-ABI; plain `node` fails at `new Database`):
//   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe ext/flashcards/test/run-bridge-probe.mjs

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require_ = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..', '..');
const AdmZip = require_('adm-zip');
const Database = require_('better-sqlite3');
const { readAnkiExport } = require_(path.join(ROOT, 'electron', 'ankiBridge.cjs'));

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-probe-'));

// A stale orphan from a "crashed previous run" (old mtime) — must be swept…
const staleDir = path.join(os.tmpdir(), 'parallx-anki-stale-orphan');
fs.mkdirSync(staleDir, { recursive: true });
fs.writeFileSync(path.join(staleDir, 'collection.anki21'), 'junk');
const oldTime = new Date(Date.now() - 60 * 60_000);
fs.utimesSync(staleDir, oldTime, oldTime);

// …while a RECENT dir (another live instance mid-extraction) must survive.
const liveDir = path.join(os.tmpdir(), 'parallx-anki-live-elsewhere');
fs.mkdirSync(liveDir, { recursive: true });

// Minimal real .apkg.
const dbPath = path.join(work, 'collection.anki21');
const db = new Database(dbPath);
db.exec('CREATE TABLE col (id INTEGER PRIMARY KEY, decks TEXT, models TEXT); CREATE TABLE notes (id INTEGER PRIMARY KEY, flds TEXT, tags TEXT, mid INTEGER); CREATE TABLE cards (id INTEGER PRIMARY KEY, nid INTEGER, did INTEGER, ord INTEGER);');
db.prepare('INSERT INTO col VALUES (1, ?, ?)').run(
  JSON.stringify({ 1: { name: 'Smoke' } }),
  JSON.stringify({ 9: { type: 0, name: 'Basic', flds: [{ name: 'Front', ord: 0 }, { name: 'Back', ord: 1 }], tmpls: [{ name: 'Card 1', ord: 0, qfmt: '{{Front}}', afmt: '{{Back}}' }] } }),
);
db.prepare('INSERT INTO notes VALUES (1, ?, ?, 9)').run('Q\x1fA', '');
db.prepare('INSERT INTO cards VALUES (1, 1, 1, 0)').run();
db.close();
const apkg = path.join(work, 'smoke.apkg');
const zip = new AdmZip();
zip.addFile('collection.anki21', fs.readFileSync(dbPath));
zip.writeZip(apkg);

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`  PASS  ${label}`);
  else { failures++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); }
};

console.log('\n=== bridge probe ===\n');
const res = await readAnkiExport(apkg);
// Bridge cleanup runs after terminate() settles — give it a beat.
await new Promise((r) => setTimeout(r, 500));

const leftovers = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('parallx-anki-'));
check('bridge parses through the worker', res.ok === true && res.cardCount === 1, JSON.stringify(res).slice(0, 200));
check('card content correct', res.ok && res.decks[0].cards[0].front === 'Q' && res.decks[0].cards[0].back === 'A');
check('old orphan swept, this call\'s dir cleaned up', !leftovers.includes('parallx-anki-stale-orphan')
  && !leftovers.some((n) => !['parallx-anki-live-elsewhere'].includes(n)), leftovers.join(', '));
check('recent dir (another instance, possibly live) is preserved', leftovers.includes('parallx-anki-live-elsewhere'));

const bad = await readAnkiExport(path.join(work, 'missing.apkg'));
check('missing file yields ok:false with a message', bad.ok === false && typeof bad.error === 'string');

fs.rmSync(liveDir, { recursive: true, force: true });
fs.rmSync(work, { recursive: true, force: true });
console.log(failures === 0 ? '\nAll bridge probe checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
