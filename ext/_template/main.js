// ext/_template/main.js — M86-W9 starter scaffold
//
// Minimal, runnable extension. Copy this folder, rename the id/name in
// parallx-manifest.json, and you have a working extension. The contract
// is intentionally small:
//
//   - `activate(api)` runs once when the extension is loaded. Register
//     commands, services, listeners, etc. through `api`.
//   - `deactivate()` runs on workbench shutdown or extension reload.
//     Dispose anything you registered (subscriptions, timers, watchers).
//
// `api` is typed in `parallx.d.ts` at the repo root (M86-W10). Point
// your tsconfig at `tsconfig.extension.json` to pick it up.
//
// NOTE: extension entries are loaded via dynamic `import()` and must
// use ESM `export` syntax. CommonJS `module.exports = ...` silently
// breaks activation. The repo's `tests/unit/extensionEsmExport.test.ts`
// guard enforces this.

const _disposables = [];

export function activate(api) {
  // Sample command. Replace with whatever your extension does.
  const hello = api.commands.registerCommand('exampleTemplate.hello', async () => {
    await api.window.showInformationMessage('Hello from the example template extension.');
  });
  _disposables.push(hello);
}

export function deactivate() {
  for (const d of _disposables.splice(0)) {
    try { d.dispose(); } catch { /* keep deactivate idempotent */ }
  }
}
