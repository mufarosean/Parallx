// ankiBridge.cjs — main-process face of the Anki import.
//
// One job: run ankiWorker.cjs in a worker_thread and return its single result.
// The parse uses better-sqlite3, which is synchronous and therefore banned on
// the main process — a multi-megabyte deck would freeze every window while it
// reads. The worker is spawned per call and exits with it; imports are rare
// enough that keeping a warm worker would be complexity without a payoff.

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Worker } = require('worker_threads');

/** A deck export should parse in well under this; a hang should not be forever. */
const PARSE_TIMEOUT_MS = 60_000;

/**
 * Remove parallx-anki-* temp dirs orphaned by a past crash or timeout kill.
 * Runs once per app run, before this process's first worker spawns.
 * terminate() skips the worker's finally blocks, which is how orphans come to
 * exist at all — without this sweep they accumulate forever.
 *
 * Only dirs older than STALE_AGE_MS are touched: a second app instance
 * (PARALLX_USER_DATA / test mode bypasses the single-instance lock) may have
 * an extraction in flight, and its live dir shares the same tmpdir prefix. A
 * live parse is bounded by the 60s timeout, so ten minutes is safely stale.
 */
const STALE_AGE_MS = 10 * 60_000;
let sweptStale = false;
function sweepStaleTempDirs() {
  if (sweptStale) return;
  sweptStale = true;
  try {
    for (const name of fs.readdirSync(os.tmpdir())) {
      if (!name.startsWith('parallx-anki-')) continue;
      const full = path.join(os.tmpdir(), name);
      try {
        if (Date.now() - fs.statSync(full).mtimeMs > STALE_AGE_MS) {
          fs.rm(full, { recursive: true, force: true }, () => { /* best-effort */ });
        }
      } catch { /* raced away or unreadable — skip */ }
    }
  } catch { /* best-effort */ }
}

/**
 * Parse an Anki export (.apkg / .txt) into { decks, cardCount, mediaSkipped }.
 * Resolves with { ok:false, error } rather than rejecting, matching the other
 * bridges' error shape.
 *
 * The bridge owns the extraction temp dir: it generates the path, hands it to
 * the worker via workerData, and deletes it once the worker has actually
 * exited — the only arrangement that survives a timeout terminate(), which
 * skips the worker's own finally cleanup.
 */
function readAnkiExport(filePath) {
  sweepStaleTempDirs();
  const tmpDir = path.join(os.tmpdir(), `parallx-anki-${crypto.randomUUID()}`);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // Delete only after the thread is gone: better-sqlite3's open handle
      // would EBUSY an immediate delete on Windows, and a blocked native call
      // keeps the thread alive until it returns.
      const cleanup = () => fs.rm(tmpDir, { recursive: true, force: true }, () => { /* best-effort */ });
      worker.terminate().then(cleanup, cleanup);
      resolve(result);
    };

    const worker = new Worker(path.join(__dirname, 'ankiWorker.cjs'), {
      workerData: { filePath, tmpDir },
    });

    const timer = setTimeout(() => {
      finish({ ok: false, error: 'Reading the deck took too long and was stopped.' });
    }, PARSE_TIMEOUT_MS);

    worker.once('message', (msg) => finish(msg));
    worker.once('error', (err) => finish({ ok: false, error: err.message }));
    worker.once('exit', (code) => {
      if (code !== 0) finish({ ok: false, error: `Deck parser exited with code ${code}.` });
    });
  });
}

module.exports = { readAnkiExport };
