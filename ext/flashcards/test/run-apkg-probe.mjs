// run-apkg-probe.mjs — end-to-end verification of .apkg import.
//
// vitest cannot cover parseApkg (better-sqlite3 is a native module built for
// the Electron ABI), so this probe does it standalone: it AUTHORS a synthetic
// .apkg shaped exactly like Anki's export — collection.anki21 SQLite database
// with col/notes/cards tables, U+001F field separators, a "please update Anki"
// stub collection.anki2 beside it — then reads the file back through the REAL
// electron/ankiWorker.cjs and asserts on every semantic the importer relies
// on: deck grouping, the reversed-card field swap, cloze expansion, HTML
// flattening, media counting, stub avoidance, and the anki21b error path.
//
// Headless: no Electron app, no window (dev machine = study machine).
//
// Run (better-sqlite3 is built for the ELECTRON ABI — plain `node` fails
// with ERR_DLOPEN_FAILED at the first `new Database`):
//   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe ext/flashcards/test/run-apkg-probe.mjs

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
const { readAnkiFile } = require_(path.join(ROOT, 'electron', 'ankiWorker.cjs'));

const SEP = '\x1f'; // Anki's field separator inside notes.flds

// ─── Author the synthetic collection ─────────────────────────────────────────

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apkg-probe-'));

function authorCollection(dbPath, { stub = false } = {}) {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE col   (id INTEGER PRIMARY KEY, decks TEXT, models TEXT);
    CREATE TABLE notes (id INTEGER PRIMARY KEY, flds TEXT, tags TEXT, mid INTEGER);
    CREATE TABLE cards (id INTEGER PRIMARY KEY, nid INTEGER, did INTEGER, ord INTEGER);
  `);

  if (stub) {
    // What Anki actually writes into the legacy stub when the export targets
    // the newer schema: one note telling the user to upgrade.
    db.prepare('INSERT INTO col (id, decks, models) VALUES (1, ?, ?)').run(
      JSON.stringify({ 1: { name: 'Default' } }),
      JSON.stringify({ 100: { type: 0, name: 'Basic' } }),
    );
    db.prepare('INSERT INTO notes (id, flds, tags, mid) VALUES (1, ?, ?, 100)')
      .run(`Please update to the latest Anki version${SEP}then import the .apkg file again.`, '');
    db.prepare('INSERT INTO cards (id, nid, did, ord) VALUES (1, 1, 1, 0)').run();
    db.close();
    return;
  }

  // Models carry their real templates (qfmt/afmt as stock Anki writes them),
  // because cards.ord is a template ordinal and the worker renders from the
  // template. Model 106 deliberately has NO tmpls/flds — the fallback path.
  const FLDS_FB = [{ name: 'Front', ord: 0 }, { name: 'Back', ord: 1 }];
  const AFMT_STD = '{{FrontSide}}\n\n<hr id=answer>\n\n{{Back}}';
  db.prepare('INSERT INTO col (id, decks, models) VALUES (1, ?, ?)').run(
    JSON.stringify({
      1: { name: 'Exam 7::Reserving' },
      2: { name: 'Exam 7::ERM' },
    }),
    JSON.stringify({
      100: {
        type: 0, name: 'Basic', flds: FLDS_FB,
        tmpls: [{ name: 'Card 1', ord: 0, qfmt: '{{Front}}', afmt: AFMT_STD }],
      },
      101: {
        type: 0, name: 'Basic (and reversed card)', flds: FLDS_FB,
        tmpls: [
          { name: 'Card 1', ord: 0, qfmt: '{{Front}}', afmt: AFMT_STD },
          { name: 'Card 2', ord: 1, qfmt: '{{Back}}', afmt: '{{FrontSide}}\n\n<hr id=answer>\n\n{{Front}}' },
        ],
      },
      102: {
        type: 1, name: 'Cloze',
        flds: [{ name: 'Text', ord: 0 }, { name: 'Extra', ord: 1 }],
        tmpls: [{ name: 'Cloze', ord: 0, qfmt: '{{cloze:Text}}', afmt: '{{cloze:Text}}<br>{{Extra}}' }],
      },
      103: {
        type: 0, name: 'Basic (optional reversed card)',
        flds: [{ name: 'Front', ord: 0 }, { name: 'Back', ord: 1 }, { name: 'Add Reverse', ord: 2 }],
        tmpls: [
          { name: 'Card 1', ord: 0, qfmt: '{{Front}}', afmt: AFMT_STD },
          { name: 'Card 2', ord: 1, qfmt: '{{#Add Reverse}}{{Back}}{{/Add Reverse}}', afmt: '{{FrontSide}}\n\n<hr id=answer>\n\n{{Front}}' },
        ],
      },
      104: {
        type: 0, name: 'Vocabulary (three cards)',
        flds: [{ name: 'Term', ord: 0 }, { name: 'Def', ord: 1 }, { name: 'Example', ord: 2 }],
        tmpls: [
          { name: 'Recognition', ord: 0, qfmt: '{{Term}}', afmt: '{{Def}}' },
          { name: 'Recall', ord: 1, qfmt: '{{Def}}', afmt: '{{Term}}' },
          { name: 'Usage', ord: 2, qfmt: 'Example for {{Term}}?', afmt: '{{Example}}' },
        ],
      },
      105: {
        type: 1, name: 'Titled Cloze',
        flds: [{ name: 'Title', ord: 0 }, { name: 'Text', ord: 1 }],
        tmpls: [{ name: 'Cloze', ord: 0, qfmt: '{{cloze:Text}}', afmt: '{{cloze:Text}}<br>{{Title}}' }],
      },
      106: { type: 0, name: 'Legacy (no templates)' },
    }),
  );

  const note = db.prepare('INSERT INTO notes (id, flds, tags, mid) VALUES (?, ?, ?, ?)');
  note.run(1, `What does Mack assume?${SEP}Independence of accident years`, ' reserving mack ', 100);
  note.run(2, `Brosius${SEP}Least squares development`, '', 101);
  note.run(3, `{{c1::Bornhuetter-Ferguson}} blends {{c2::expected losses}} with actual emergence${SEP}See Friedland ch. 9`, '', 102);
  note.run(4, `<div>HTML front</div>${SEP}back text [sound:say.mp3] <img src="chart.png">`, '', 100);
  note.run(5, `Loss ratio${SEP}Losses over premium${SEP}y`, '', 103);
  note.run(6, `Frequency${SEP}Claims per exposure${SEP}`, '', 103);
  note.run(7, `ILF${SEP}Increased limits factor${SEP}ILF example: 1M over 100k`, '', 104);
  note.run(8, `Reinsurance terms${SEP}The {{c1::ceding}} company transfers risk`, '', 105);
  note.run(9, `Alpha${SEP}Beta${SEP}Gamma`, '', 106);

  const card = db.prepare('INSERT INTO cards (id, nid, did, ord) VALUES (?, ?, ?, ?)');
  card.run(1, 1, 1, 0);          // Basic → Reserving
  card.run(2, 2, 1, 0);          // Reversed, forward → Reserving
  card.run(3, 2, 1, 1);          // Reversed, reverse → Reserving
  card.run(4, 3, 2, 0);          // Cloze c1 → ERM
  card.run(5, 3, 2, 1);          // Cloze c2 → ERM
  card.run(6, 4, 2, 0);          // HTML/media → ERM
  card.run(7, 5, 1, 0);          // Optional-reverse forward (marker set) → Reserving
  card.run(8, 5, 1, 1);          // Optional-reverse reverse (marker set) → Reserving
  card.run(9, 6, 1, 0);          // Optional-reverse forward (marker EMPTY) → Reserving
  card.run(10, 6, 1, 1);         // Orphan reverse row: qfmt renders empty → must be skipped
  card.run(11, 7, 2, 0);         // Three-template ord 0 → ERM
  card.run(12, 7, 2, 1);         // Three-template ord 1 → ERM
  card.run(13, 7, 2, 2);         // Three-template ord 2 → ERM (distinct, NOT a duplicate)
  card.run(14, 8, 2, 0);         // Titled cloze → ERM (cloze field is index 1, not 0)
  card.run(15, 9, 1, 0);         // Legacy fallback forward → Reserving
  card.run(16, 9, 1, 1);         // Legacy fallback reverse → Reserving
  card.run(17, 9, 1, 2);         // Legacy fallback ord 2: no template info → skipped
  card.run(18, 3, 2, 2);         // Stale cloze row: note 3 has c1/c2 but not c3 → skipped
  db.close();
}

const realDb = path.join(tmpDir, 'collection.anki21');
const stubDb = path.join(tmpDir, 'collection.anki2');
authorCollection(realDb);
authorCollection(stubDb, { stub: true });

const apkgPath = path.join(tmpDir, 'exam7.apkg');
{
  const zip = new AdmZip();
  zip.addFile('collection.anki21', fs.readFileSync(realDb));
  zip.addFile('collection.anki2', fs.readFileSync(stubDb));
  zip.addFile('media', Buffer.from('{}'));
  zip.writeZip(apkgPath);
}

// A "new format" export: only the zstd member is present.
const newFormatPath = path.join(tmpDir, 'newformat.apkg');
{
  const zip = new AdmZip();
  zip.addFile('collection.anki21b', Buffer.from('zstd-compressed, unreadable here'));
  zip.addFile('media', Buffer.from(''));
  zip.writeZip(newFormatPath);
}

// ─── Read it back through the real worker code ───────────────────────────────

let failures = 0;
function check(label, cond, detail = '') {
  if (cond) console.log(`  PASS  ${label}`);
  else { failures++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); }
}

console.log('\n=== .apkg probe ===\n');
const r = readAnkiFile(apkgPath);

check('parses ok', r.ok === true, r.error);
check('reads collection.anki21, not the stub', r.source === 'collection.anki21', String(r.source));
check('fifteen cards total (skips: empty-front reverse, ord>=2 without template)', r.cardCount === 15, `got ${r.cardCount}`);
check('two decks, Anki names kept', r.decks.length === 2
  && r.decks.some((d) => d.name === 'Exam 7::Reserving')
  && r.decks.some((d) => d.name === 'Exam 7::ERM'));

const reserving = r.decks.find((d) => d.name === 'Exam 7::Reserving')?.cards ?? [];
const erm = r.decks.find((d) => d.name === 'Exam 7::ERM')?.cards ?? [];

check('basic card front/back (FrontSide not duplicated into the back)', reserving.some((c) =>
  c.front === 'What does Mack assume?' && c.back === 'Independence of accident years'));
check('tags carried over', reserving.some((c) => c.tags.join(',') === 'reserving,mack'));
check('reversed card renders template 2 (swapped direction)', reserving.some((c) =>
  c.front === 'Least squares development' && c.back === 'Brosius'));
check('no card from the "please update" stub', !JSON.stringify(r.decks).includes('Please update'));

const c1 = erm.find((c) => c.front.startsWith('[…]'));
const c2 = erm.find((c) => c.front.includes('blends […]'));
check('cloze c1: target hidden, others revealed', !!c1
  && c1.front === '[…] blends expected losses with actual emergence');
check('cloze c2: target hidden, others revealed', !!c2
  && c2.front === 'Bornhuetter-Ferguson blends […] with actual emergence');
check('cloze back reveals all + Extra via the afmt template', !!c1
  && c1.back === 'Bornhuetter-Ferguson blends expected losses with actual emergence\nSee Friedland ch. 9');

const htmlCard = erm.find((c) => c.front === 'HTML front');
check('field HTML flattened', !!htmlCard, JSON.stringify(erm.map((c) => c.front)));
check('media stripped from text', !!htmlCard && !htmlCard.back.includes('sound') && !htmlCard.back.includes('img'));
check('media references counted', r.mediaSkipped === 2, `got ${r.mediaSkipped}`);

// Optional reversed: the Add Reverse marker gates card 2 and never leaks as content.
check('optional-reverse forward back has no marker pollution', reserving.some((c) =>
  c.front === 'Loss ratio' && c.back === 'Losses over premium'));
check('optional-reverse reverse card renders when marker set', reserving.some((c) =>
  c.front === 'Losses over premium' && c.back === 'Loss ratio'));
check('optional-reverse card with EMPTY marker is skipped (empty question)', !reserving.some((c) =>
  c.front === 'Claims per exposure')
  && reserving.filter((c) => c.front === 'Frequency' || c.back === 'Frequency').length === 1);

// Three templates → three DISTINCT cards, no ord>=2 duplicates.
const trio = erm.filter((c) => ['ILF', 'Increased limits factor', 'Example for ILF?'].includes(c.front));
check('three-template notetype yields three distinct cards', trio.length === 3
  && trio.some((c) => c.front === 'ILF' && c.back === 'Increased limits factor')
  && trio.some((c) => c.front === 'Increased limits factor' && c.back === 'ILF')
  && trio.some((c) => c.front === 'Example for ILF?' && c.back === 'ILF example: 1M over 100k'),
JSON.stringify(trio));

// Cloze field resolved from the template, not hardcoded to fields[0].
check('titled cloze clozes the Text field, not the Title', erm.some((c) =>
  c.front === 'The […] company transfers risk'
  && c.back === 'The ceding company transfers risk\nReinsurance terms'));

// Template-less model: heuristic fallback, ord >= 2 skipped instead of duplicated.
const legacy = reserving.filter((c) => ['Alpha', 'Beta'].includes(c.front));
check('template-less fallback keeps ord 0/1 and drops ord 2', legacy.length === 2
  && legacy.some((c) => c.front === 'Alpha' && c.back === 'Beta\n\nGamma')
  && legacy.some((c) => c.front === 'Beta' && c.back === 'Alpha'),
JSON.stringify(legacy));

// A cloze card row whose deletion no longer exists in the note (card 18, ord 2
// = c3): Anki hides it as an empty card; importing it would create front==back junk.
check('stale cloze ordinal is skipped, not imported as front==back junk',
  erm.filter((c) => c.front.includes('blends')).length === 2);

console.log('\n=== new-format (.anki21b) error path ===\n');
let newFormatErr = '';
try { readAnkiFile(newFormatPath); } catch (e) { newFormatErr = e.message; }
check('rejects with the re-export instruction', newFormatErr.includes('Support older Anki versions'), newFormatErr);

console.log('\n=== corrupt .apkg error path ===\n');
// Corrupt the deflate stream of the FIRST entry (collection.anki21) precisely:
// its data starts after the 30-byte local header + name/extra (lengths at
// offsets 26/28); the central directory at the tail stays intact. adm-zip's
// readFile returns null for this, which must surface as an actionable
// message, not a writeFileSync TypeError.
const corruptPath = path.join(tmpDir, 'corrupt.apkg');
{
  const bytes = fs.readFileSync(apkgPath);
  // adm-zip reorders entries, so find collection.anki21's LOCAL header by its
  // name's first occurrence; the header is the fixed 30 bytes before it.
  const nameOff = bytes.indexOf(Buffer.from('collection.anki21'));
  const lh = nameOff - 30;
  const dataStart = nameOff + bytes.readUInt16LE(lh + 26) + bytes.readUInt16LE(lh + 28);
  const compSize = bytes.readUInt32LE(lh + 18);
  for (let i = dataStart; i < dataStart + Math.min(200, compSize); i++) bytes[i] = 0xff;
  fs.writeFileSync(corruptPath, bytes);
}
let corruptErr = '';
try { readAnkiFile(corruptPath); } catch (e) { corruptErr = e.message; }
check('corrupt archive fails with a human error, not Node internals',
  corruptErr.length > 0 && !corruptErr.includes('must be of type'), corruptErr.slice(0, 120));

fs.rmSync(tmpDir, { recursive: true, force: true });

console.log(failures === 0 ? '\nAll .apkg probe checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
