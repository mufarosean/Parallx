// electron/hashWorker.cjs — streaming media fingerprints off the main thread.
//
// Computes the two fingerprints the media organizer stores per file in ONE
// pass over one file handle:
//   - md5:    full-contents MD5 (hex, lowercase — same as `certutil -hashfile`
//             / `md5sum` output the extension previously parsed)
//   - oshash: uint64LE sum of the 64KB head + 64KB tail + file size (hex,
//             16 chars zero-padded). Must stay bit-identical to the inline
//             node one-liner the extension previously spawned, because these
//             values are persisted in mo_fingerprints and compared for
//             dedup/rename detection.
//
// Runs in a worker_thread (same pattern as databaseWorker.cjs) so the hash
// CPU never chops the main process event loop that routes user input. The
// pure functions are exported for tests; the message loop only arms when
// loaded as an actual worker.

const { parentPort } = require('worker_threads');
const fs = require('fs');
const crypto = require('crypto');

const OSHASH_CHUNK = 65536;
const OSHASH_MASK = 0xFFFFFFFFFFFFFFFFn;
const MD5_SLAB = 1 << 20; // 1MB read slabs

async function hashFile(filePath, wantOshash) {
  const fh = await fs.promises.open(filePath, 'r');
  try {
    const stat = await fh.stat();
    const size = stat.size;

    const md5 = crypto.createHash('md5');
    const slab = Buffer.alloc(Math.min(MD5_SLAB, Math.max(size, 1)));
    let pos = 0;
    while (pos < size) {
      const { bytesRead } = await fh.read(slab, 0, slab.length, pos);
      if (bytesRead <= 0) break;
      md5.update(bytesRead === slab.length ? slab : slab.subarray(0, bytesRead));
      pos += bytesRead;
    }

    let oshash = null;
    if (wantOshash) {
      let h = BigInt(size);
      if (size < OSHASH_CHUNK * 2) {
        const whole = Buffer.alloc(size);
        if (size > 0) await fh.read(whole, 0, size, 0);
        for (let i = 0; i + 7 < whole.length; i += 8) {
          h = (h + whole.readBigUInt64LE(i)) & OSHASH_MASK;
        }
      } else {
        const head = Buffer.alloc(OSHASH_CHUNK);
        const tail = Buffer.alloc(OSHASH_CHUNK);
        await fh.read(head, 0, OSHASH_CHUNK, 0);
        await fh.read(tail, 0, OSHASH_CHUNK, size - OSHASH_CHUNK);
        for (let i = 0; i < OSHASH_CHUNK; i += 8) h = (h + head.readBigUInt64LE(i)) & OSHASH_MASK;
        for (let i = 0; i < OSHASH_CHUNK; i += 8) h = (h + tail.readBigUInt64LE(i)) & OSHASH_MASK;
      }
      oshash = h.toString(16).padStart(16, '0');
    }

    return { md5: md5.digest('hex'), oshash, size };
  } finally {
    await fh.close();
  }
}

if (parentPort) {
  parentPort.on('message', (msg) => {
    const { id, filePath, oshash } = msg;
    hashFile(filePath, !!oshash)
      .then((result) => parentPort.postMessage({ id, ok: true, result }))
      .catch((err) => parentPort.postMessage({ id, ok: false, error: err?.message ?? String(err) }));
  });
}

module.exports = { hashFile, OSHASH_CHUNK };
