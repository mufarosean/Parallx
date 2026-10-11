# electron

The main process. `main.cjs` creates the window, the menu and the
lifecycle, and hosts the file, dialog and tool IPC; `preload.cjs` is the
only bridge the renderer sees (`window.parallxElectron`); every other
capability is one `*Bridge.cjs` with its own IPC handlers: database (in
a worker behind `databaseClient.cjs`; `database.cjs` keeps each open
database's prepared statements through `statementCache.cjs`), documents,
browser, Python and notebooks, MCP, models, screen recording.
`storageHandlers.cjs` is the file-backed storage.

The renderer never uses `ipcRenderer` directly.
