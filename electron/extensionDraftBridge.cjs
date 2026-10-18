// extensionDraftBridge.cjs — install an extension the assistant wrote.
//
// The renderer has already shown the person the draft (what it adds, what it
// reaches, the rule checks; src/tools/extensionDraft.ts) and they pressed
// Install. This writes its files to data/extensions/<id>, where installed
// .plx packages go, so it is found again at the next start and removed the
// same way. A draft never replaces an extension that came from elsewhere:
// its folder carries a .parallx-draft mark, and only a marked folder is
// written over (the assistant improving its own tool).

const path = require('node:path');
const fs = require('node:fs/promises');

const ID_RE = /^[a-z0-9-]+\.[a-z0-9-]+$/;
const FILE_RE = /^[a-z0-9][a-z0-9-]*\.(js|css|json|md)$/;
const MAX_BYTES = 512 * 1024;
const MARK = '.parallx-draft';

function setupExtensionDraftBridge(ipcMain, extensionsDir) {
  ipcMain.handle('tools:install-from-draft', async (_event, draft) => {
    try {
      const manifest = draft && typeof draft.manifest === 'object' ? draft.manifest : null;
      const files = draft && typeof draft.files === 'object' ? draft.files : null;
      const id = manifest && typeof manifest.id === 'string' ? manifest.id : '';
      if (!manifest || !files || !ID_RE.test(id)) return { error: 'The draft has no valid id.' };
      const names = Object.keys(files);
      if (!names.includes('main.js') || names.some((n) => !FILE_RE.test(n) || n === 'parallx-manifest.json')) {
        return { error: 'The draft holds files an extension may not have.' };
      }
      const total = names.reduce((n, k) => n + Buffer.byteLength(String(files[k])), 0);
      if (total > MAX_BYTES) return { error: 'The draft is too large.' };

      const dir = path.join(extensionsDir, id);
      if (path.dirname(dir) !== path.resolve(extensionsDir)) return { error: 'The draft has no valid id.' };
      const exists = await fs.stat(dir).then(() => true, () => false);
      if (exists && !(await fs.stat(path.join(dir, MARK)).then(() => true, () => false))) {
        return { error: `An extension named ${id} is already installed. Choose another id.` };
      }
      await fs.rm(dir, { recursive: true, force: true });
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, 'parallx-manifest.json'), JSON.stringify(manifest, null, 2));
      for (const n of names) await fs.writeFile(path.join(dir, n), String(files[n]));
      await fs.writeFile(path.join(dir, MARK), `Written by the assistant, installed ${new Date().toISOString()}\n`);
      console.log(`[ToolInstall] Installed assistant-written "${manifest.name}" (${id}) to ${dir}`);
      return { error: null, toolId: id, toolPath: dir, manifest };
    } catch (err) {
      return { error: err && err.message ? err.message : String(err) };
    }
  });
}

module.exports = { setupExtensionDraftBridge };
