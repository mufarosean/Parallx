# Example Template Extension

A minimal Parallx extension scaffold. Shipped as part of M86-W9 so new
extension authors have a known-good starting point.

## Use it

1. Copy the `ext/_template/` folder to `ext/<your-extension>/`.
2. Edit `parallx-manifest.json` — change `id`, `name`, `description`.
3. Edit `main.js` — register your commands, services, listeners.
4. Restart Parallx. The extension activates on first launch because
   `activationEvents: ["*"]` is set.

## Optional: webview UI

If your extension renders a full UI (not just commands or sidebar
contributions), create a `webview/` subfolder:

```
ext/your-extension/
  parallx-manifest.json
  main.js
  webview/
    index.html
    preload.cjs   (optional)
```

The M86-W9 loader (`electron/extWebviewLoader.cjs`) will resolve a
descriptor for the webview and the shell will mount it in its own
process. A crash in your extension can't take down the workbench.

## Public API surface

The `api` object passed to `activate(api)` is typed in
`parallx.d.ts` at the repo root. Point your tsconfig at
`tsconfig.extension.json` to pick it up:

```jsonc
{
  "extends": "../../tsconfig.extension.json",
  "include": ["main.ts"]
}
```

## What this template does NOT do

- No file I/O — use `api.fs.*` if you need files.
- No network egress — use the web-research extension's chokepoint.
- No direct `window` / `document` access — the renderer's DOM is the
  shell's, not yours.

Stay inside the `api` surface and your extension will keep working
across workbench upgrades.
