// worksheet-import-verify.cjs — count the drawings stored with each imported
// item, by kind: equation pictures (text-box drawings whose source is PNG),
// text boxes still drawn as SVG, pictures stored as PNG (originals and
// rasterised metafiles), and anything else (a metafile nobody rasterised).
// Run under Electron as Node (better-sqlite3 is built for Electron):
//   electron worksheet-import-verify.cjs <dbPath>
const Database = require('better-sqlite3');
const dbPath = process.argv[2];
if (!dbPath) { console.error('usage: worksheet-import-verify.cjs <dbPath>'); process.exit(2); }
const outDir = process.argv[3] || '';
const fs = require('node:fs');
const path = require('node:path');
let sampleWritten = false;
const db = new Database(dbPath, { readonly: true });
const rows = db.prepare('SELECT id, title, sheet_json AS givens_json FROM ws_items ORDER BY id').all();
let equationPngs = 0, textSvgs = 0, picturePngs = 0, pictureOther = 0;
for (const r of rows) {
  let eq = 0, svg = 0, png = 0, other = 0;
  try {
    const wb = JSON.parse(r.givens_json);
    const res = (wb.resources || []).find((x) => x.name === 'SHEET_DRAWING_PLUGIN');
    if (res) {
      const all = JSON.parse(res.data);
      for (const sheet of Object.values(all)) {
        for (const [id, d] of Object.entries(sheet.data || {})) {
          const src = String(d.source || '');
          if (id.startsWith('tb')) {
            if (src.startsWith('data:image/png')) {
              eq++;
              // The first rendered equation as a file, for the eye.
              if (outDir && !sampleWritten) {
                try { fs.writeFileSync(path.join(outDir, 'equation-sample.png'), Buffer.from(src.slice(src.indexOf(',') + 1), 'base64')); sampleWritten = true; } catch { /* no sample */ }
              }
            } else svg++;
          }
          else if (src.startsWith('data:image/png') || src.startsWith('data:image/jpeg') || src.startsWith('data:image/gif')) png++;
          else other++;
        }
      }
    }
  } catch (e) { console.log(`  ${r.title}: unreadable snapshot (${String(e).slice(0, 80)})`); }
  if (eq || svg || png || other) console.log(`  ${r.title}: equationPngs=${eq} textSvgs=${svg} picturePngs=${png} pictureOther=${other}`);
  equationPngs += eq; textSvgs += svg; picturePngs += png; pictureOther += other;
}
console.log(`TOTAL items=${rows.length} equationPngs=${equationPngs} textSvgs=${textSvgs} picturePngs=${picturePngs} pictureOther=${pictureOther}`);
