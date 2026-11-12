// doclingReadings.cjs — the readings the document reader has made, kept on disk.
//
// A reading is where everything on a document's pages is: the lines of a
// scanned page with their boxes, every block, every table's cells. The reader
// returns it with the text. It is kept here, one file per document under
// <app>/data/readings, and handed out by path for as long as the document's
// size and modified time are the ones it was read at. The viewer's text layer
// for a scan, the place a citation lights up, and a scan's page text all come
// from it; the index only needs the Markdown, so the reading is not sent on.
'use strict';
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const dirOf = (appRoot) => path.join(appRoot, 'data', 'readings');

function fileOf(appRoot, filePath) {
  const key = crypto.createHash('sha256').update(path.resolve(String(filePath)).toLowerCase()).digest('hex').slice(0, 40);
  return path.join(dirOf(appRoot), `${key}.json`);
}

/** Store a conversion's reading and return the result without it. */
async function keep(appRoot, filePath, result) {
  if (!result || typeof result !== 'object' || !('reading' in result)) return result;
  const { reading, ...rest } = result;
  if (reading && Array.isArray(reading.pages)) {
    try {
      const st = await fs.promises.stat(filePath);
      await fs.promises.mkdir(dirOf(appRoot), { recursive: true });
      const file = fileOf(appRoot, filePath);
      await fs.promises.writeFile(`${file}.tmp`, JSON.stringify({ path: path.resolve(filePath), size: st.size, mtimeMs: Math.round(st.mtimeMs), reading }));
      await fs.promises.rename(`${file}.tmp`, file);
    } catch (err) {
      console.warn('[DoclingReadings] The reading could not be kept for', filePath, err && err.message);
    }
  }
  return rest;
}

/**
 * The reading kept for a document, or null when there is none or the
 * document has changed since it was read.
 */
async function get(appRoot, filePath) {
  try {
    const kept = JSON.parse(await fs.promises.readFile(fileOf(appRoot, filePath), 'utf8'));
    const st = await fs.promises.stat(filePath);
    if (kept.size !== st.size || kept.mtimeMs !== Math.round(st.mtimeMs)) return null;
    return kept.reading || null;
  } catch {
    return null;
  }
}

module.exports = { keep, get };
