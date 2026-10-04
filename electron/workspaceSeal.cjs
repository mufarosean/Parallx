// workspaceSeal.cjs — the sealed-workspace flag on the main-process side
// (docs/BROWSER.md phase 2). Part of the core: the renderer pushes the flag
// (preload `workspaceSeal.setSealed`, channel `workspace:setSealed`) and
// every bridge that reaches the network asks isSealed() before it does. Defaults to open; once the renderer
// has said "sealed", every egress request is refused until it says otherwise.
//
// It lives here, not in a tool's bridge, so the seal holds whichever tools
// are turned on, and loading it starts nothing.

let _sealed = false;

/** Whether the open workspace is sealed (nothing leaves the machine). */
function isSealed() { return _sealed; }

/** Set the flag (the IPC handler, and tests). Returns the new value. */
function setSealed(sealed) { _sealed = !!sealed; return _sealed; }

/** Register the renderer's channel. */
function setupWorkspaceSeal(ipcMain) {
  ipcMain.handle('workspace:setSealed', (_event, sealed) => ({ ok: true, sealed: setSealed(sealed) }));
}

module.exports = { isSealed, setSealed, setupWorkspaceSeal };
