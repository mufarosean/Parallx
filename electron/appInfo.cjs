// appInfo.cjs — the versions a bug report needs, read once in the preload.
//
// Help › Copy Diagnostics prints these. Only version numbers and the OS
// family: no paths, no host name, no user name.

const os = require('os');
const path = require('path');

function readAppVersion() {
  try {
    // The same package.json the app ships with (inside the asar when packaged).
    return String(require(path.join(__dirname, '..', 'package.json')).version || '');
  } catch {
    return '';
  }
}

module.exports = Object.freeze({
  version: readAppVersion(),
  electron: process.versions.electron || '',
  chrome: process.versions.chrome || '',
  node: process.versions.node || '',
  platform: process.platform,
  arch: process.arch,
  osRelease: (() => { try { return os.release(); } catch { return ''; } })(),
});
