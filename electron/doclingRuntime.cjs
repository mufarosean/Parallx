// doclingRuntime.cjs — the document reader's engine, declared as a tool
// runtime (electron/runtimeBridge.cjs): its own Python, its packages from a
// lock file by hash, its models as files by hash. Parallx sets it up once on
// the user's click and runs tools/docling-bridge's server in it.
//
// The models are listed in tools/docling-bridge/models.json, one entry per
// file: where it is fetched from, its size and SHA-256, and the path the
// reader expects it at. The runtime keeps files flat under their `name`; the
// server lays them out at `path` when it starts (hard links, no second copy).
'use strict';
const path = require('node:path');
const fs = require('node:fs');

const RUNTIME_ID = 'docling';
const PYTHON = '3.13.16';
/** Python and the packages (PyTorch is most of it), on top of the model files. */
const PACKAGE_BYTES = Math.round(6.2 * 1024 ** 3);

/** @param {string} appRoot */
function doclingRuntimeSpec(appRoot) {
  const dir = path.join(appRoot, 'tools', 'docling-bridge');
  let models = [];
  try { models = JSON.parse(fs.readFileSync(path.join(dir, 'models.json'), 'utf8')).files || []; } catch { models = []; }
  return {
    id: RUNTIME_ID,
    title: 'Document Reader',
    python: PYTHON,
    locks: { win32: path.join(dir, 'requirements-win.lock') },
    files: models.map((m) => ({ name: m.name, url: m.url, bytes: m.bytes, sha256: m.sha256 })),
    // It reads on the processor when there is no card, so none is required.
    needs: { platforms: ['win32-x64'], diskBytes: 12 * 1024 ** 3 },
    selftest: { script: path.join(dir, 'selftest.py'), args: [] },
  };
}

module.exports = { doclingRuntimeSpec, RUNTIME_ID, PACKAGE_BYTES };
