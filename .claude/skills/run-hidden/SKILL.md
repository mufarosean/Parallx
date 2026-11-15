---
name: run-hidden
description: Launch the built Parallx app with no window, drive it with real mouse, keys and clipboard, and read the result back. Use to see a change working in the real app, to write or run a probe in tests/probes, or to take screenshots of a surface.
---
# Running Parallx hidden

The app is Electron. Probes in `tests/probes/*.mjs` launch it with Playwright against a throwaway profile and workspace, so nothing touches a real workspace and no window appears.

## Get it launchable

1. Dependencies. In a cloud session whose environment has no setup script, run:
   `ONNXRUNTIME_NODE_INSTALL_CUDA=skip npm install --no-audit --no-fund`
   (plain `npm install` fails in the cloud: onnxruntime tries to fetch a graphics-card library from a host that is refused).
2. Build: `node scripts/build.mjs` (about a minute; `npm run build` adds the typecheck and the reference docs).
3. Launch through a probe: on Linux `xvfb-run -a node tests/probes/<name>.mjs [outDir]`; on Windows `node tests/probes/<name>.mjs [outDir]`.
   `mkdir -p test-results` first; probes write there and it is git-ignored.

Rebuild after every change to `src/` or `ext/`: the app loads `dist/`.

## Write a probe

Start from [probe-template.mjs](probe-template.mjs). The pattern every probe follows:

- A new app root and workspace under `test-results/`, `PARALLX_TEST_MODE=1`, `PARALLX_APP_ROOT`, `PARALLX_USER_DATA`.
- Wait for `.parallx-ready`, then run commands through the workbench:
  `window.__parallx_workbench__._services.get({ id: 'ICommandService' }).executeCommand(id, ...args)`.
- Act as a person does: `page.mouse`, `page.keyboard`, the system clipboard through `app.evaluate(({ clipboard }) => ...)`, a finger through CDP `Input.dispatchTouchEvent`.
- Read the state back from the app (a service, a pane's probe hook, a file on disk), never from what you typed.
- One line per check, `ok` or `FAIL` with what came back, a count at the end, exit code 1 on any problem.
- A screenshot of every surface the piece adds. Look at it.

Useful hooks already in the app: `file.openFile <path>` opens any file in its editor; a sheet pane exposes its engine at `document.querySelector('.ws-pane__sheet').__wsHost` (`probeState`, `probeReadValue`, `getSnapshot`); `tests/probes/scene.mjs` has `launchApp`, `cmd`, `openFile`, `sceneOf` for the keyboard audit's style of probe.

## What a hidden run cannot show

The cloud has no Ollama, no graphics card and is not Windows. A check that needs the owner's model or card is reported as not run, with the command he can run locally. A stand-in for a model proves the plumbing, not the result: say which it was.

## The two audits after UI work

- `tests/probes/keyboard-audit-probe.mjs <outDir> [screen filter…]`: keyboard, screen-reader names, contrast, dialogs, touch.
- `tests/probes/touch-drag-probe.mjs`: every kind of drag by finger.

Both are expected to report 0. One known exception until the sheet's toolbar is replaced: the spreadsheet engine's own ribbon leaves one control out of the Tab order, a different one each run.
