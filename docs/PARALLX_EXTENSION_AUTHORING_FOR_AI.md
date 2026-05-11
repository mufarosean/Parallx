# Parallx Extension Authoring Guide — For Local AI Models

> **Audience.** A small local language model (3B–14B parameters).
> **Goal.** Generate a working Parallx extension from a user's natural-language request without reasoning.
> **Method.** Copy a template, fill blanks, follow checklists. Do not invent APIs. Do not import from `src/`.

---

## 0. How to use this document

1. Read Section 1 to understand what an extension is.
2. Read Section 2 to pick the **template** that matches the user's request.
3. Read Section 3 (Manifest Reference) and Section 4 (API Reference) to fill in the template.
4. Read Section 5 (Patterns) for the most common code blocks. Copy them verbatim.
5. Read Section 6 (UI Design Rules) — every visual choice MUST follow these. Do not improvise styles.
6. Read Section 7 (Forbidden) before emitting any code.
7. Output exactly two files: `parallx-manifest.json` and `main.js`. Never output anything else unless the user asks for SQL migrations (Section 5.3) or icons.

---

## 1. What a Parallx extension is

A Parallx extension is a folder with two required files:

```
my-extension/
├── parallx-manifest.json   ← required, declares identity + contributions
└── main.js                 ← required, exports activate() and deactivate()
```

Optional files:

```
my-extension/
└── db/
    └── migrations/
        ├── ext_001_initial.sql
        └── ext_002_add_table.sql
```

Where extensions live:

| Location | Purpose |
|---|---|
| `<repo>/ext/<name>/` | Development. Loaded automatically when running from source. |
| `<APP_ROOT>/data/extensions/<id>/` | Installed extensions. Loaded at startup. |

**The user installs an extension by:**
1. Running command `Tools: Install Tool from File…` from the command palette.
2. Picking a `.plx` file (a zip of the extension folder, renamed `.plx`).

**Lifecycle.**
- On startup, Parallx scans both directories for `parallx-manifest.json`.
- It reads each manifest, registers the contributions, then waits for an activation event.
- When an activation event fires, it dynamically `import()`s `main.js` and calls `activate(api, context)`.
- On shutdown or uninstall, it calls `deactivate()`.

---

## 2. Pick a template

Match the user's request to **exactly one** of these templates. If no template fits perfectly, pick the closest one and adapt only what the user explicitly asked for.

| User asks for… | Template |
|---|---|
| "a sidebar view that shows X" | **T1: Sidebar View** |
| "a button in the activity bar that opens X" | **T2: Activity Bar Container + View** |
| "a full-page editor for X", "a tab that displays X" | **T3: Editor Pane** |
| "a command that does X", "a command palette entry" | **T4: Command Only** |
| "a tool the AI chat can call" | **T5: Chat Tool** |
| "a status bar item showing X" | **T6: Status Bar Item** |
| "an extension that uses Gmail / MCP" | **T7: MCP Consumer** |
| "an extension that runs every N minutes" | **T8: Cron Job** |
| "an extension that stores data" | **T9: Database** (combine with T1–T3) |

Each template is defined in Section 8.

---

## 3. Manifest reference (`parallx-manifest.json`)

### 3.1 Required fields (always include)

```json
{
  "manifestVersion": 1,
  "id": "<publisher>.<name>",
  "name": "<Human-Readable Name>",
  "version": "0.1.0",
  "publisher": "<publisher>",
  "description": "<one sentence>",
  "main": "main.js",
  "activationEvents": ["onStartupFinished"],
  "engines": { "parallx": "^0.1.0" },
  "contributes": { }
}
```

### 3.2 Field rules (deterministic)

| Field | Rule |
|---|---|
| `id` | Lowercase. Must contain exactly one dot. Example: `acme.todo-list`. Must be globally unique. |
| `name` | Title Case. Shown in the Tool Gallery. |
| `version` | Semver. Start at `0.1.0`. |
| `main` | Always `"main.js"`. Do not change. |
| `activationEvents` | Pick from Section 3.3. **Default: `["onStartupFinished"]`**. |
| `engines.parallx` | Always `"^0.1.0"`. Do not change. |

### 3.3 Activation events (pick one or more)

| Value | Fires when |
|---|---|
| `"*"` | At startup, before workbench is ready. **Avoid** unless required. |
| `"onStartupFinished"` | After workbench is ready. **Default for most extensions.** |
| `"onCommand:<commandId>"` | First time the command is invoked. |
| `"onView:<viewId>"` | First time the view is opened. |

### 3.4 Contributions

Every contribution is a JSON object inside `contributes`. **All keys are optional** — only include what the extension uses.

#### `contributes.commands`

Declares command IDs. Each command must also be registered at runtime via `api.commands.registerCommand(id, handler)` in `activate()`.

```json
"commands": [
  { "id": "myExt.doThing", "title": "Do The Thing", "category": "My Ext" }
]
```

| Field | Required | Notes |
|---|---|---|
| `id` | yes | Unique. Convention: `<extId>.<verb>`. |
| `title` | yes | Shown in command palette. |
| `category` | no | Groups items in palette. Use the extension's display name. |
| `icon` | no | Lucide icon ID (Section 4.7). |
| `keybinding` | no | E.g. `"Ctrl+Shift+D"`. |
| `when` | no | Context expression. |

#### `contributes.viewContainers`

A **view container** is a slot in the activity bar (left edge icons). Use this when the extension needs its own activity-bar icon. Otherwise, attach views to a built-in container.

```json
"viewContainers": [
  { "id": "myExt-container", "title": "My Ext", "icon": "wallet", "location": "sidebar" }
]
```

| Field | Required | Notes |
|---|---|---|
| `id` | yes | Globally unique. |
| `title` | yes | Tooltip on the activity bar icon. |
| `icon` | yes | Lucide icon ID. |
| `location` | yes | One of `"sidebar"`, `"panel"`, `"auxiliaryBar"`. Use `"sidebar"` for activity bar. |

#### `contributes.views`

A **view** is rendered content inside a container. Multiple views may share a container.

```json
"views": [
  { "id": "myExt.main", "name": "My Ext", "defaultContainerId": "myExt-container" }
]
```

| Field | Required | Notes |
|---|---|---|
| `id` | yes | Globally unique. |
| `name` | yes | View title. |
| `defaultContainerId` | yes | Either your own `viewContainers.id`, or one of the **built-in containers** below. |

**Built-in container IDs (reuse instead of creating your own):**

| ID | Where it lives |
|---|---|
| `view.explorer` | File explorer sidebar |
| `view.search` | Search sidebar |
| `view.canvas` | Canvas pages sidebar |
| `view.chat` | AI chat sidebar |

#### `contributes.editors`

Declares an editor type that opens as a tab.

```json
"editors": [
  { "typeId": "myExt.editor", "displayName": "My Ext" }
]
```

The runtime must call `api.editors.registerEditorProvider("myExt.editor", { createEditorPane })`.

#### `contributes.configuration`

Declares user-facing settings. Stored per-workspace and editable in **Settings**.

```json
"configuration": [
  {
    "title": "My Ext",
    "properties": {
      "myExt.endpointUrl": {
        "type": "string",
        "default": "https://api.example.com",
        "description": "API endpoint."
      },
      "myExt.intervalMinutes": {
        "type": "number",
        "default": 30,
        "minimum": 1,
        "maximum": 1440,
        "description": "Refresh interval."
      },
      "myExt.mode": {
        "type": "string",
        "enum": ["auto", "manual"],
        "default": "auto",
        "description": "Refresh mode."
      }
    }
  }
]
```

Read at runtime with `api.workspace.getConfiguration("myExt").get("endpointUrl")`.

Property `type` must be one of: `"string"`, `"number"`, `"boolean"`, `"object"`, `"array"`.

#### `contributes.menus`

Adds command entries to specific menus.

```json
"menus": {
  "commandPalette": [{ "command": "myExt.doThing" }],
  "view/title":     [{ "command": "myExt.doThing", "when": "view == myExt.main" }]
}
```

#### `contributes.keybindings`

```json
"keybindings": [
  { "command": "myExt.doThing", "key": "Ctrl+Alt+T" }
]
```

#### `contributes.statusBar`

Declares static status-bar entries. (For dynamic ones, use `api.window.createStatusBarItem()` instead.)

```json
"statusBar": [
  { "id": "myExt.status", "name": "My Ext", "text": "$(circle) Ready",
    "tooltip": "My Ext", "command": "myExt.doThing", "alignment": "left", "priority": 100 }
]
```

---

## 4. API reference (the `api` argument to `activate`)

Every extension's `activate(api, context)` receives:
- `api` — the namespaced API object below. Frozen. **Never mutate.**
- `context` — `{ subscriptions: IDisposable[], globalState: Memento, workspaceState: Memento, toolPath: string, toolUri: string }`.

**Cleanup rule:** every disposable returned by an `api.*` call MUST be pushed onto `context.subscriptions`. The host disposes them on shutdown.

### 4.1 `api.commands`

```js
api.commands.registerCommand(id, handler)        // → IDisposable
api.commands.executeCommand(id, ...args)         // → Promise<any>
api.commands.getCommands()                       // → Promise<string[]>
```

`handler` is `(...args) => any | Promise<any>`. Return value is delivered to `executeCommand`'s caller.

### 4.2 `api.views`

```js
api.views.registerViewProvider(viewId, { createView(container) { /* return IDisposable */ } })
api.views.setBadge(containerId, { count: 3 })   // or { dot: true } or undefined
```

`createView(container)` receives a real `HTMLElement`. Append children to it. Return a disposable that cleans up listeners.

### 4.3 `api.editors`

```js
api.editors.registerEditorProvider(typeId, { createEditorPane(container, input) { /* return IDisposable */ } })
api.editors.openEditor({ typeId, title, icon?, instanceId? })   // → Promise<void>
api.editors.closeEditor(editorId)                                // → Promise<boolean>
api.editors.openFileEditor(uri, { pinned? })                     // open built-in text editor
api.editors.openEditors                                          // readonly array of descriptors
api.editors.onDidChangeOpenEditors(listener)                     // → IDisposable
```

`instanceId` lets you open multiple panes of the same `typeId`. Same `typeId+instanceId` means the existing tab is focused, not duplicated.

### 4.4 `api.window`

```js
api.window.showInformationMessage(msg, ...actions)   // returns the picked action or undefined
api.window.showWarningMessage(msg, ...actions)
api.window.showErrorMessage(msg, ...actions)
api.window.showInputBox({ prompt?, value?, placeholder?, password? })   // → Promise<string|undefined>
api.window.showQuickPick(items, { placeholder?, canPickMany? })         // → picked item(s) or undefined
api.window.createOutputChannel(name)                                    // → channel with append/appendLine/show/hide/clear/dispose
api.window.createStatusBarItem(alignment, priority)                     // alignment: 1=Left, 2=Right
api.window.activeColorTheme                                             // { kind } 1=dark 2=light 3=hc-dark 4=hc-light
api.window.onDidChangeActiveColorTheme(listener)
api.window.startDrag(filePaths, iconDataUrl?)                           // for native OS drag-and-drop
```

`actions` are `{ title: string }`. Example:
```js
const pick = await api.window.showInformationMessage("Apply?", { title: "Yes" }, { title: "No" });
if (pick?.title === "Yes") { /* … */ }
```

### 4.5 `api.workspace`

```js
api.workspace.getConfiguration(section?)                  // → { get(key, default?), has(key) }
api.workspace.onDidChangeConfiguration(listener)          // → IDisposable; listener gets { affectsConfiguration(section) }
api.workspace.workspaceFolders                            // readonly [{ uri, name, index }] | undefined
api.workspace.getWorkspaceFolder(uri)
api.workspace.onDidChangeWorkspaceFolders(listener)
api.workspace.onDidChangeWorkspace(listener)              // CRITICAL: handle this, see Pattern 5.5
api.workspace.onDidRename(listener)
api.workspace.onDidFilesChange(listener)
api.workspace.name                                        // workspace display name
api.workspace.getCanvasPages()                            // → Promise<CanvasPageInfo[]>
api.workspace.getCanvasPageTree()                         // → Promise<tree>
api.workspace.onDidChangeCanvasPages(listener)
api.workspace.fs                                          // file-system surface, see below
```

Filesystem (scoped to workspace):
```js
api.workspace.fs.readFile(uri)        // → { content, encoding }
api.workspace.fs.writeFile(uri, content)
api.workspace.fs.stat(uri)            // → { type, size, mtime }; type: 1=file 2=directory 64=symlink
api.workspace.fs.readdir(uri)         // → [{ name, type }]
api.workspace.fs.exists(uri)
api.workspace.fs.rename(src, tgt)
api.workspace.fs.delete(uri, { recursive?, useTrash? })
api.workspace.fs.mkdir(uri)
```

### 4.6 `api.database` (per-extension SQLite)

**Available only for external (non-builtin) extensions.** `api.database` is `undefined` for builtins.

```js
const r = await api.database.open();              // → { error: null, dbPath } | { error: { code, message } }
await api.database.migrate(absoluteMigrationsDir); // run all .sql in dir, ordered by filename
await api.database.run(sql, params);              // → { error, changes, lastInsertRowid }
await api.database.get(sql, params);              // → { error, row }
await api.database.all(sql, params);              // → { error, rows }
await api.database.runTransaction([{ type, sql, params? }, …])  // type: 'run'|'get'|'all'
await api.database.close();
await api.database.isOpen();                      // → { isOpen }
```

**Invariant:** `open()` MUST come before `migrate()`. The host enables `PRAGMA foreign_keys = ON` and WAL mode automatically.

Migration files live at `<toolPath>/db/migrations/*.sql`, sorted by filename. Use a numeric prefix: `myext_001_initial.sql`, `myext_002_add_x.sql`.

### 4.7 `api.icons`

Parallx ships ~2000 Lucide icons. Use them everywhere instead of inline SVG.

```js
api.icons.getIcon(id)                  // → SVG markup string (or '' if unknown)
api.icons.hasIcon(id)                  // → boolean
api.icons.getAllIconIds()              // → string[]
api.icons.createIconHtml(id, size?)    // → '<span …>SVG</span>' ready for innerHTML, default size 16
api.icons.getFileTypeIcon(ext)         // → SVG for file extension (handles leading dot)
```

Common icon IDs (verify with `api.icons.hasIcon`): `home`, `search`, `settings`, `plus`, `trash`, `check`, `x`, `chevron-right`, `chevron-down`, `file`, `folder`, `wallet`, `image`, `video`, `tag`, `star`, `clock`, `calendar`, `link`, `play`, `pause`, `refresh-cw`, `download`, `upload`.

### 4.8 `api.lm` (language models — may be undefined)

```js
const models = await api.lm.getModels();          // → [{ id, displayName, family, parameterSize, contextLength, capabilities }]
for await (const chunk of api.lm.sendChatRequest(modelId, messages, options)) {
  // chunk: { content, done, thinking?, toolCalls?, evalCount?, evalDuration? }
}
api.lm.onDidChangeModels(listener)
```

`messages`: `[{ role: 'system'|'user'|'assistant'|'tool', content: string }]`.
`options`: `{ temperature?, topP?, maxTokens?, format?, seed?, think?, tools? }`.

### 4.9 `api.chat` (may be undefined)

```js
api.chat.createChatParticipant(id, handler)  // register a chat participant (e.g. @myExt)
api.chat.registerTool(name, {
  description: string,
  parameters: <JSON Schema>,
  handler: async (args, token) => ({ content: string, isError?: boolean }),
  requiresConfirmation: boolean,
})
```

A registered chat tool is auto-discoverable by the agent in Agent mode.

### 4.10 `api.mcp` (MCP tool calls — may be undefined)

```js
const result = await api.mcp.invokeTool(fullName, args);   // fullName: 'mcp__<server>__<tool>'
const all = api.mcp.listTools();                            // [{ name, description? }]
```

Result: `{ content: [{ type: 'text', text }], isError? }`.

### 4.11 `api.cron` (scheduled jobs — may be undefined)

```js
api.cron.upsertJob({
  id: 'myExt.sync.scheduled',           // stable, idempotent
  schedule: { every: '30m' },           // OR { at: '<ISO datetime>' } OR { cron: '0 */6 * * *' }
  payload: { agentTurn: 'Sync now and report.' },   // OR { systemEvent: { … } }
  wakeMode: 'now',                      // or 'next-heartbeat'
  enabled: true,
});
api.cron.removeJob(id);
```

`payload.agentTurn` injects a turn into the AI agent. `payload.systemEvent` pushes a structured event.

### 4.12 `api.context`

```js
const key = api.context.createContextKey('myExt.busy', false);
key.set(true); key.get(); key.reset();
api.context.getContextValue('someOtherKey');
```

Use context keys to gate `when` clauses on commands, menus, keybindings.

### 4.13 `api.tools`

```js
api.tools.getAll()         // → ToolInfo[]
api.tools.getById(id)
api.tools.isEnabled(id)
api.tools.setEnabled(id, enabled)
api.tools.onDidChangeEnablement(listener)
api.tools.installFromFile()    // opens file picker for a .plx
api.tools.uninstall(id)
```

### 4.14 `api.env`

```js
api.env.appName       // 'Parallx'
api.env.appVersion    // semver
api.env.toolPath      // absolute path to this extension's directory
```

---

## 5. Patterns (copy verbatim)

### 5.1 Minimal `activate` / `deactivate`

```js
const _disposables = [];
let _api = null;

export async function activate(api, context) {
  _api = api;
  // … register things, push every IDisposable to context.subscriptions OR _disposables
  context.subscriptions.push(api.commands.registerCommand('myExt.hello', () => {
    api.window.showInformationMessage('Hello!');
  }));
}

export async function deactivate() {
  for (const d of _disposables) { try { d.dispose(); } catch {} }
  _disposables.length = 0;
  _api = null;
}
```

### 5.2 Sidebar view that renders DOM

```js
function renderMyView(container, api) {
  container.innerHTML = '';
  const root = document.createElement('div');
  root.style.cssText = 'padding:12px;display:flex;flex-direction:column;gap:8px;color:var(--vscode-foreground);';

  const title = document.createElement('h3');
  title.textContent = 'My View';
  title.style.cssText = 'margin:0;font-size:13px;font-weight:600;';
  root.appendChild(title);

  const btn = document.createElement('button');
  btn.textContent = 'Click me';
  btn.style.cssText = 'padding:4px 10px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:3px;cursor:pointer;';
  btn.addEventListener('click', () => api.window.showInformationMessage('Clicked'));
  root.appendChild(btn);

  container.appendChild(root);

  return { dispose() { container.innerHTML = ''; } };
}
```

### 5.3 Database setup with migrations

`db/migrations/myext_001_initial.sql`:
```sql
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_items_name ON items(name);
```

`main.js`:
```js
async function ensureDatabase(api, toolPath) {
  const open = await api.database.open();
  if (open.error) { console.error(open.error); return false; }
  const sep = toolPath.includes('\\') ? '\\' : '/';
  const dir = toolPath + sep + 'db' + sep + 'migrations';
  const mig = await api.database.migrate(dir);
  if (mig.error) { console.error(mig.error); return false; }
  return true;
}

const db = {
  async run(sql, p = []) { const r = await _api.database.run(sql, p); if (r.error) throw new Error(r.error.message); return r; },
  async get(sql, p = []) { const r = await _api.database.get(sql, p); if (r.error) throw new Error(r.error.message); return r.row; },
  async all(sql, p = []) { const r = await _api.database.all(sql, p); if (r.error) throw new Error(r.error.message); return r.rows; },
};
```

### 5.4 Read configuration

```js
const cfg = api.workspace.getConfiguration('myExt');
const url = cfg.get('endpointUrl', 'https://default');
const interval = cfg.get('intervalMinutes', 30);

// React to changes
context.subscriptions.push(api.workspace.onDidChangeConfiguration(e => {
  if (e.affectsConfiguration('myExt.endpointUrl')) { /* re-read */ }
}));
```

### 5.5 Handle workspace switch (CRITICAL for stateful extensions)

When the user switches workspace, the host closes the old DB and opens a new one **but does not deactivate the extension**. The extension MUST re-init.

```js
context.subscriptions.push(api.workspace.onDidChangeWorkspace(async () => {
  // 1. Cancel anything in flight.
  // 2. Clear in-memory caches.
  // 3. Re-open database, re-run migrations.
  await ensureDatabase(api, api.env.toolPath);
}));
```

### 5.6 Streaming an LLM call

```js
async function summarize(api, modelId, text) {
  const messages = [
    { role: 'system', content: 'You summarize text concisely.' },
    { role: 'user', content: text },
  ];
  let out = '';
  for await (const chunk of api.lm.sendChatRequest(modelId, messages, { temperature: 0.2 })) {
    out += chunk.content;
    if (chunk.done) break;
  }
  return out;
}
```

### 5.7 Register a chat tool

```js
context.subscriptions.push(api.chat.registerTool('myExt_count_items', {
  description: 'Count items in the database matching an optional name filter.',
  parameters: {
    type: 'object',
    properties: {
      filter: { type: 'string', description: 'Optional substring to match in name.' },
    },
    required: [],
  },
  requiresConfirmation: false,
  handler: async (args) => {
    const filter = (args.filter || '').toString();
    const row = filter
      ? await db.get('SELECT COUNT(*) AS n FROM items WHERE name LIKE ?', ['%' + filter + '%'])
      : await db.get('SELECT COUNT(*) AS n FROM items');
    return { content: String(row?.n ?? 0) };
  },
}));
```

### 5.8 Open an editor pane

```js
api.editors.registerEditorProvider('myExt.editor', {
  createEditorPane(container, input) {
    container.innerHTML = '';
    const root = document.createElement('div');
    root.style.cssText = 'padding:16px;color:var(--vscode-foreground);';
    root.textContent = `Editor pane (input id: ${input?.id || '—'})`;
    container.appendChild(root);
    return { dispose() { container.innerHTML = ''; } };
  },
});

await api.editors.openEditor({
  typeId: 'myExt.editor',
  title: 'My Ext',
  icon: 'wallet',
  instanceId: 'main',
});
```

### 5.9 Status bar item

```js
const item = api.window.createStatusBarItem(1, 100); // Left, priority 100
item.text = '$(circle) Idle';
item.tooltip = 'Click to refresh';
item.command = 'myExt.refresh';
item.show();
context.subscriptions.push(item);
```

### 5.10 Theming entry point

Never hardcode colors, fonts, sizes, or spacing. **All visual rules live in Section 6.** Read it before writing any DOM.

---

## 6. UI Design Rules (mandatory)

Parallx has a defined visual identity. Every extension MUST match it so the workbench feels coherent. **Treat this section as code, not advice — pick values from these tables, do not invent.**

### 6.1 Brand identity (one-line summary)

Dark-first, purple-accented, VS-Code-style desktop workbench. Primary brand color is **purple `#9333ea`**. Light, hc-dark, and hc-light themes exist — never assume dark.

### 6.2 Iron rules

1. **Never write a hex color in JS or CSS.** Use a CSS variable from Section 6.4 or 6.5.
2. **Never use emojis** in UI text, button labels, headings, or status messages. Use Lucide icons via `api.icons.createIconHtml(id)` (Section 4.7).
3. **Never use inline SVG.** Use `api.icons.createIconHtml(id, size)`.
4. **Never set a custom font-family.** Use the font tokens in Section 6.5.
5. **Never use raw pixel values for spacing/radius/font-size.** Use the design tokens in Section 6.5.
6. **Never use bright/saturated colors for status (red/green/yellow).** Use the semantic VS Code variables in Section 6.4.
7. **Always render in a dark-mode-friendly way.** Test with the dark palette in your head — text on background must remain legible.
8. **Never block the workbench with modals.** For confirmations use `api.window.showInformationMessage` with action buttons (Section 4.4).
9. **Never use `position: fixed` or `position: absolute` outside your container.** Stay inside the `container` element passed to your view/editor provider.
10. **Never set width/height in vh/vw.** The container is already sized — use `100%` or flex.

### 6.3 Two color systems — pick the right one

Parallx exposes two parallel CSS variable systems. **Always prefer Parallx tokens (`--parallx-*`) when one exists; fall back to VS Code tokens (`--vscode-*`) for everything else.**

| System | Prefix | Use for |
|---|---|---|
| Parallx design tokens | `--parallx-*` | Spacing, radius, font sizes, font families, shadows, icon sizes |
| VS Code color tokens | `--vscode-*` | All colors (foreground, background, borders, hover, selection, errors) |

Do NOT mix and match. Do NOT use `--parallx-*` for colors. Do NOT use `--vscode-*` for spacing.

### 6.4 Color variables — the only colors you may use

Every color in your UI MUST come from this list. If you need a color and it isn't here, fall back to `var(--vscode-foreground)` or `var(--vscode-descriptionForeground)`.

**Text:**

| Variable | Use for |
|---|---|
| `var(--vscode-foreground)` | Default body text |
| `var(--vscode-descriptionForeground)` | Secondary / subdued text, captions, hints |
| `var(--vscode-errorForeground)` | Error text only |
| `var(--vscode-disabledForeground)` | Disabled text |
| `var(--vscode-sideBarTitle-foreground)` | Sidebar section titles |

**Backgrounds:**

| Variable | Use for |
|---|---|
| `var(--vscode-editor-background)` | Main pane / editor body background |
| `var(--vscode-sideBar-background)` | Sidebar view background |
| `var(--vscode-input-background)` | Inputs, dropdowns, pill backgrounds |
| `var(--vscode-list-hoverBackground)` | Row hover state |
| `var(--vscode-list-activeSelectionBackground)` | Selected row background |
| `var(--vscode-list-activeSelectionForeground)` | Selected row text |
| `var(--vscode-menu-background)` | Floating menus, dropdowns |

**Borders & focus:**

| Variable | Use for |
|---|---|
| `var(--vscode-panel-border)` | Section dividers, card borders |
| `var(--vscode-input-border)` | Input borders |
| `var(--vscode-focusBorder)` | Focus ring (this IS the brand purple) |
| `var(--vscode-contrastBorder, transparent)` | High-contrast outline (always include the fallback) |

**Buttons:**

| Variable | Use for |
|---|---|
| `var(--vscode-button-background)` | Primary button background |
| `var(--vscode-button-foreground)` | Primary button text |
| `var(--vscode-button-hoverBackground)` | Primary button hover |
| `var(--vscode-button-secondaryBackground)` | Secondary button background |
| `var(--vscode-button-secondaryForeground)` | Secondary button text |
| `var(--vscode-button-secondaryHoverBackground)` | Secondary button hover |

**Status / feedback (use sparingly):**

| Variable | Use for |
|---|---|
| `var(--vscode-charts-green)` | Success indicators |
| `var(--vscode-charts-red)` | Error indicators |
| `var(--vscode-charts-yellow)` | Warning indicators |
| `var(--vscode-charts-blue)` | Info indicators |
| `var(--vscode-charts-purple)` | Brand-aligned highlight |

### 6.5 Design tokens — the only sizes/fonts/spacings you may use

All Parallx design tokens are exposed as CSS variables prefixed `--parallx-*`. Pick from these tables. **Do not write raw pixel values.**

**Font family:**

| Variable | Use for |
|---|---|
| `var(--parallx-fontFamily-ui)` | All UI chrome — sidebar, menus, buttons, status bar |
| `var(--parallx-fontFamily-editor)` | Long-form / canvas content |
| `var(--parallx-fontFamily-mono)` | Code blocks, file paths, IDs |

**Font size:**

| Variable | Pixels (dark default) | Use for |
|---|---|---|
| `var(--parallx-fontSize-xs)` | 10px | Badges, micro-labels |
| `var(--parallx-fontSize-sm)` | 11px | Status bar, captions |
| `var(--parallx-fontSize-base)` | 12px | Default UI text |
| `var(--parallx-fontSize-md)` | 13px | Sidebar items, menu items |
| `var(--parallx-fontSize-lg)` | 14px | Section headers |
| `var(--parallx-fontSize-xl)` | 16px | Canvas body |
| `var(--parallx-fontSize-2xl)` | 24px | Heading |
| `var(--parallx-fontSize-3xl)` | 36px | Empty-state heading |

**Spacing (use for padding, margin, gap):**

| Variable | Pixels |
|---|---|
| `var(--parallx-spacing-1)` | 4px |
| `var(--parallx-spacing-2)` | 8px |
| `var(--parallx-spacing-3)` | 12px |
| `var(--parallx-spacing-4)` | 16px |
| `var(--parallx-spacing-6)` | 24px |
| `var(--parallx-spacing-8)` | 32px |
| `var(--parallx-spacing-12)` | 48px |
| `var(--parallx-spacing-16)` | 64px |

**Border radius:**

| Variable | Pixels | Use for |
|---|---|---|
| `var(--parallx-radius-none)` | 0 | Sharp edges (rare) |
| `var(--parallx-radius-sm)` | 3px | Buttons, inputs |
| `var(--parallx-radius-md)` | 6px | Panels, sidebar items, cards |
| `var(--parallx-radius-lg)` | 8px | Floating menus |
| `var(--parallx-radius-xl)` | 12px | Chat bubbles, hero cards |
| `var(--parallx-radius-full)` | 999px | Pills, badges, avatars |

**Shadow (only for floating UI):**

| Variable | Use for |
|---|---|
| `var(--parallx-shadow-sm)` | Tooltips, dropdowns |
| `var(--parallx-shadow-md)` | Menus, floating widgets |
| `var(--parallx-shadow-lg)` | Dialogs, large floating panels |

**Icon size (set as `width`/`height` on icon spans):**

| Variable | Pixels | Use for |
|---|---|---|
| `var(--parallx-icon-size-xs)` | 14px | Inline indicators next to text |
| `var(--parallx-icon-size-sm)` | 16px | Tree items, badges (DEFAULT) |
| `var(--parallx-icon-size-md)` | 18px | Action buttons |
| `var(--parallx-icon-size-lg)` | 24px | Activity bar, toolbar |
| `var(--parallx-icon-size-xl)` | 32px | Empty-state illustrations |

### 6.6 Component recipes (copy verbatim)

These are the canonical implementations. Do not deviate.

**Primary button:**
```js
const btn = document.createElement('button');
btn.textContent = 'Save';
btn.style.cssText = `
  padding: var(--parallx-spacing-1) var(--parallx-spacing-3);
  font-family: var(--parallx-fontFamily-ui);
  font-size: var(--parallx-fontSize-md);
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
  border: 1px solid var(--vscode-contrastBorder, transparent);
  border-radius: var(--parallx-radius-sm);
  cursor: pointer;
`;
btn.addEventListener('mouseenter', () => { btn.style.background = 'var(--vscode-button-hoverBackground)'; });
btn.addEventListener('mouseleave', () => { btn.style.background = 'var(--vscode-button-background)'; });
```

**Secondary button:** identical, but `--vscode-button-secondaryBackground/Foreground/HoverBackground`.

**Text input:**
```js
const input = document.createElement('input');
input.type = 'text';
input.style.cssText = `
  padding: var(--parallx-spacing-1) var(--parallx-spacing-2);
  font-family: var(--parallx-fontFamily-ui);
  font-size: var(--parallx-fontSize-md);
  background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
  border: 1px solid var(--vscode-input-border, transparent);
  border-radius: var(--parallx-radius-sm);
  outline: none;
`;
input.addEventListener('focus', () => { input.style.borderColor = 'var(--vscode-focusBorder)'; });
input.addEventListener('blur',  () => { input.style.borderColor = 'var(--vscode-input-border, transparent)'; });
```

**Sidebar section header:**
```js
const h = document.createElement('div');
h.textContent = 'Items';
h.style.cssText = `
  padding: var(--parallx-spacing-2) var(--parallx-spacing-3);
  font-family: var(--parallx-fontFamily-ui);
  font-size: var(--parallx-fontSize-sm);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--vscode-sideBarTitle-foreground);
`;
```

**List row (with hover and selection):**
```js
const row = document.createElement('div');
row.style.cssText = `
  display: flex;
  align-items: center;
  gap: var(--parallx-spacing-2);
  padding: var(--parallx-spacing-1) var(--parallx-spacing-3);
  font-family: var(--parallx-fontFamily-ui);
  font-size: var(--parallx-fontSize-md);
  color: var(--vscode-foreground);
  cursor: pointer;
  border-radius: var(--parallx-radius-sm);
`;
row.addEventListener('mouseenter', () => { row.style.background = 'var(--vscode-list-hoverBackground)'; });
row.addEventListener('mouseleave', () => { if (!row.dataset.selected) row.style.background = 'transparent'; });
// On select:
//   row.dataset.selected = '1';
//   row.style.background = 'var(--vscode-list-activeSelectionBackground)';
//   row.style.color = 'var(--vscode-list-activeSelectionForeground)';
```

**Icon next to text:**
```js
const row = document.createElement('div');
row.style.cssText = 'display:flex; align-items:center; gap: var(--parallx-spacing-2);';
row.innerHTML = api.icons.createIconHtml('folder', 16) + '<span>My Folder</span>';
```

**Pill / badge:**
```js
const pill = document.createElement('span');
pill.textContent = '3';
pill.style.cssText = `
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 var(--parallx-spacing-1);
  font-family: var(--parallx-fontFamily-ui);
  font-size: var(--parallx-fontSize-xs);
  font-weight: 600;
  background: var(--vscode-badge-background);
  color: var(--vscode-badge-foreground);
  border-radius: var(--parallx-radius-full);
`;
```

**Card (e.g. inside an editor pane):**
```js
const card = document.createElement('div');
card.style.cssText = `
  padding: var(--parallx-spacing-4);
  background: var(--vscode-editor-background);
  border: 1px solid var(--vscode-panel-border);
  border-radius: var(--parallx-radius-md);
`;
```

**Empty state:**
```js
const empty = document.createElement('div');
empty.style.cssText = `
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--parallx-spacing-8) var(--parallx-spacing-4);
  gap: var(--parallx-spacing-3);
  color: var(--vscode-descriptionForeground);
  text-align: center;
`;
empty.innerHTML = `
  <span style="width: var(--parallx-icon-size-xl); height: var(--parallx-icon-size-xl); opacity: 0.6;">${api.icons.getIcon('inbox')}</span>
  <div style="font-size: var(--parallx-fontSize-lg); color: var(--vscode-foreground);">No items yet</div>
  <div style="font-size: var(--parallx-fontSize-md);">Add your first item to get started.</div>
`;
```

### 6.7 Layout rules

1. **Root containers in views/editors must be `display: flex; flex-direction: column; height: 100%; width: 100%;` and use `overflow: auto`** when content can grow.
2. **Vertical rhythm:** between sibling blocks use `gap: var(--parallx-spacing-2)` (compact) or `gap: var(--parallx-spacing-3)` (default). Never inline `margin-bottom` on every child.
3. **Padding:** `var(--parallx-spacing-3)` (12px) is the default container padding for sidebar views and dialogs. `var(--parallx-spacing-4)` (16px) for editor panes.
4. **No fixed widths** on sidebar content. Always `width: 100%`. The container handles sizing.
5. **Truncate long text:** `white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`. Never wrap file paths or IDs.

### 6.8 Iconography rules

1. **Source:** Lucide only. Look up IDs via `api.icons.getAllIconIds()` if unsure.
2. **Default size:** 16px for tree items, 18px for action buttons, 24px for activity-bar icons.
3. **Color:** icons inherit `currentColor`. Set `color: var(--vscode-icon-foreground)` on the parent or let it inherit from text.
4. **Activity bar icons (manifest `viewContainers[].icon`):** must be a single recognizable Lucide ID. Prefer concrete nouns: `wallet`, `image`, `folder`, `inbox`, `tag`, `calendar`, `chart-bar`, `bot`, `bookmark`, `database`, `file-text`, `image`, `video`, `music`.
5. **Never** use raster images for icons.

### 6.9 Voice & copy rules

1. **Sentence case** for buttons and labels: `Add item`, not `Add Item` or `ADD ITEM`.
2. **Title case** only for view names, editor tab titles, and command palette titles.
3. **No exclamation marks.** No `!`. Replace `Saved!` with `Saved`.
4. **No emojis** anywhere in UI strings, status messages, notifications, or tooltips.
5. **Status bar text** uses `$(icon-id) Label` syntax — Parallx parses `$(...)` as Lucide icon references. Example: `$(circle) Idle`, `$(check) Synced`.
6. **Notifications are short.** One sentence. Past-tense for completed actions (`Synced 12 items`), present-tense for failures (`Cannot reach server`).

### 6.10 Density & motion

1. **Compact by default.** Parallx is a workbench, not a marketing site. Row height for list items: 22–28px.
2. **Avoid animations.** No CSS transitions on color/background longer than `120ms`. No keyframe animations except a subtle spinner.
3. **Spinner pattern:**
   ```js
   const spin = document.createElement('span');
   spin.innerHTML = api.icons.createIconHtml('loader-2', 16);
   spin.style.cssText = 'display:inline-block; animation: parallx-spin 1s linear infinite;';
   // The host already defines @keyframes parallx-spin in workbench.css.
   ```

### 6.11 Accessibility

1. **Every interactive element MUST be keyboard-reachable.** Use real `<button>` and `<input>` elements, not `<div onclick>`.
2. **Focus ring:** never set `outline: none` without replacing it. The default focus ring uses `var(--vscode-focusBorder)`.
3. **Color is never the only signal.** Pair color with an icon or text label for status.
4. **Contrast:** trust the theme variables — don't combine `--vscode-descriptionForeground` text with `--vscode-input-background` (low contrast). When in doubt, use `--vscode-foreground` on `--vscode-editor-background`.

### 6.12 Quick reject test (apply before emitting CSS)

If any line in your CSS matches one of these, fix it:

| Bad | Replace with |
|---|---|
| `color: white` / `color: #fff` | `color: var(--vscode-foreground)` |
| `background: black` / `background: #1e1e1e` | `background: var(--vscode-editor-background)` |
| `border: 1px solid #333` | `border: 1px solid var(--vscode-panel-border)` |
| `font-family: Arial, sans-serif` | `font-family: var(--parallx-fontFamily-ui)` |
| `font-size: 14px` | `font-size: var(--parallx-fontSize-lg)` |
| `padding: 8px` | `padding: var(--parallx-spacing-2)` |
| `border-radius: 4px` | `border-radius: var(--parallx-radius-sm)` |
| `box-shadow: 0 2px 4px rgba(0,0,0,.4)` | `box-shadow: var(--parallx-shadow-md)` |
| Emoji (`✅`, `🚀`, `⚠️`, …) | `api.icons.createIconHtml('check' / 'rocket' / 'triangle-alert', 16)` |
| Inline `<svg>` | `api.icons.createIconHtml('id', size)` |

---

## 7. Forbidden — never emit code that does any of these

1. **Do not** `import` from `src/` or any internal Parallx path. The only public surface is `api`.
2. **Do not** `require()` Node modules in `main.js` (it runs in the renderer). For filesystem access use `api.workspace.fs`.
3. **Do not** access the DOM outside a `createView`/`createEditorPane` container. Don't touch `document.body`.
4. **Do not** store secrets in `parallx-manifest.json`. Use `api.workspace.getConfiguration` or prompt the user.
5. **Do not** call `setInterval`/`setTimeout` for scheduling — use `api.cron`.
6. **Do not** invent API methods. If a capability isn't in Section 4, it doesn't exist. Tell the user.
7. **Do not** assume `api.lm`, `api.chat`, `api.mcp`, `api.cron`, or `api.database` are defined. **Always** check `if (api.lm) { … }` first.
8. **Do not** mutate the `api` object — it is frozen and assignments will throw in strict mode.
9. **Do not** use TypeScript syntax in `main.js`. The host loads it as plain ESM JavaScript.
10. **Do not** open files outside the workspace. `api.workspace.fs` enforces boundary checks.
11. **Do not** forget to dispose. Every `register*` call returns an `IDisposable` — push it onto `context.subscriptions`.
12. **Do not** include a `package.json` or `node_modules`. Extensions are single-file ESM. Bundle any deps inline.

---

## 8. Templates (copy and fill the blanks)

For every template, replace `<PUBLISHER>`, `<NAME>`, `<EXT_ID>` (= `<publisher>.<name>`), `<DISPLAY>`, `<DESCRIPTION>`.

### T1: Sidebar View

`parallx-manifest.json`:
```json
{
  "manifestVersion": 1,
  "id": "<EXT_ID>",
  "name": "<DISPLAY>",
  "version": "0.1.0",
  "publisher": "<PUBLISHER>",
  "description": "<DESCRIPTION>",
  "main": "main.js",
  "activationEvents": ["onStartupFinished"],
  "engines": { "parallx": "^0.1.0" },
  "contributes": {
    "views": [
      { "id": "<EXT_ID>.main", "name": "<DISPLAY>", "defaultContainerId": "view.explorer" }
    ]
  }
}
```

`main.js`:
```js
const _disposables = [];

export async function activate(api, context) {
  context.subscriptions.push(api.views.registerViewProvider('<EXT_ID>.main', {
    createView(container) {
      container.innerHTML = '';
      const root = document.createElement('div');
      root.style.cssText = 'padding:12px;color:var(--vscode-foreground);';
      root.textContent = '<DISPLAY>';
      container.appendChild(root);
      return { dispose() { container.innerHTML = ''; } };
    },
  }));
}

export async function deactivate() {
  for (const d of _disposables) { try { d.dispose(); } catch {} }
  _disposables.length = 0;
}
```

### T2: Activity Bar Container + View

`parallx-manifest.json`:
```json
{
  "manifestVersion": 1,
  "id": "<EXT_ID>",
  "name": "<DISPLAY>",
  "version": "0.1.0",
  "publisher": "<PUBLISHER>",
  "description": "<DESCRIPTION>",
  "main": "main.js",
  "activationEvents": ["onStartupFinished"],
  "engines": { "parallx": "^0.1.0" },
  "contributes": {
    "viewContainers": [
      { "id": "<EXT_ID>-container", "title": "<DISPLAY>", "icon": "wallet", "location": "sidebar" }
    ],
    "views": [
      { "id": "<EXT_ID>.main", "name": "<DISPLAY>", "defaultContainerId": "<EXT_ID>-container" }
    ]
  }
}
```

`main.js`: same as T1, but the container icon now appears in the activity bar.

### T3: Editor Pane

`parallx-manifest.json`:
```json
{
  "manifestVersion": 1,
  "id": "<EXT_ID>",
  "name": "<DISPLAY>",
  "version": "0.1.0",
  "publisher": "<PUBLISHER>",
  "description": "<DESCRIPTION>",
  "main": "main.js",
  "activationEvents": ["onCommand:<EXT_ID>.open"],
  "engines": { "parallx": "^0.1.0" },
  "contributes": {
    "commands": [
      { "id": "<EXT_ID>.open", "title": "Open <DISPLAY>", "category": "<DISPLAY>" }
    ],
    "editors": [
      { "typeId": "<EXT_ID>.editor", "displayName": "<DISPLAY>" }
    ]
  }
}
```

`main.js`:
```js
export async function activate(api, context) {
  context.subscriptions.push(api.editors.registerEditorProvider('<EXT_ID>.editor', {
    createEditorPane(container, input) {
      container.innerHTML = '';
      const root = document.createElement('div');
      root.style.cssText = 'padding:16px;color:var(--vscode-foreground);';
      root.textContent = '<DISPLAY> editor';
      container.appendChild(root);
      return { dispose() { container.innerHTML = ''; } };
    },
  }));

  context.subscriptions.push(api.commands.registerCommand('<EXT_ID>.open', () => {
    return api.editors.openEditor({
      typeId: '<EXT_ID>.editor',
      title: '<DISPLAY>',
      icon: 'wallet',
      instanceId: 'main',
    });
  }));
}

export async function deactivate() {}
```

### T4: Command Only

```json
{
  "manifestVersion": 1,
  "id": "<EXT_ID>",
  "name": "<DISPLAY>",
  "version": "0.1.0",
  "publisher": "<PUBLISHER>",
  "description": "<DESCRIPTION>",
  "main": "main.js",
  "activationEvents": ["onCommand:<EXT_ID>.run"],
  "engines": { "parallx": "^0.1.0" },
  "contributes": {
    "commands": [
      { "id": "<EXT_ID>.run", "title": "<DISPLAY>: Run", "category": "<DISPLAY>" }
    ],
    "keybindings": [
      { "command": "<EXT_ID>.run", "key": "Ctrl+Alt+R" }
    ]
  }
}
```

```js
export async function activate(api, context) {
  context.subscriptions.push(api.commands.registerCommand('<EXT_ID>.run', async () => {
    await api.window.showInformationMessage('<DISPLAY> ran.');
  }));
}
export async function deactivate() {}
```

### T5: Chat Tool

```json
{
  "manifestVersion": 1,
  "id": "<EXT_ID>",
  "name": "<DISPLAY>",
  "version": "0.1.0",
  "publisher": "<PUBLISHER>",
  "description": "<DESCRIPTION>",
  "main": "main.js",
  "activationEvents": ["onStartupFinished"],
  "engines": { "parallx": "^0.1.0" },
  "contributes": {}
}
```

```js
export async function activate(api, context) {
  if (!api.chat) {
    console.warn('<DISPLAY>: api.chat unavailable');
    return;
  }
  context.subscriptions.push(api.chat.registerTool('<EXT_ID>_now', {
    description: 'Return the current time as ISO 8601.',
    parameters: { type: 'object', properties: {}, required: [] },
    requiresConfirmation: false,
    handler: async () => ({ content: new Date().toISOString() }),
  }));
}
export async function deactivate() {}
```

### T6: Status Bar Item

```json
{
  "manifestVersion": 1,
  "id": "<EXT_ID>",
  "name": "<DISPLAY>",
  "version": "0.1.0",
  "publisher": "<PUBLISHER>",
  "description": "<DESCRIPTION>",
  "main": "main.js",
  "activationEvents": ["onStartupFinished"],
  "engines": { "parallx": "^0.1.0" },
  "contributes": {
    "commands": [
      { "id": "<EXT_ID>.click", "title": "<DISPLAY>: Click status item" }
    ]
  }
}
```

```js
export async function activate(api, context) {
  const item = api.window.createStatusBarItem(1, 100);
  item.text = '$(circle) <DISPLAY>';
  item.tooltip = '<DISPLAY>';
  item.command = '<EXT_ID>.click';
  item.show();
  context.subscriptions.push(item);

  context.subscriptions.push(api.commands.registerCommand('<EXT_ID>.click', () =>
    api.window.showInformationMessage('Clicked.'),
  ));
}
export async function deactivate() {}
```

### T7: MCP Consumer

Manifest: same as T4 (or T1 — depends on UX). Activation: `["onStartupFinished"]`.

```js
export async function activate(api, context) {
  context.subscriptions.push(api.commands.registerCommand('<EXT_ID>.invoke', async () => {
    if (!api.mcp) { await api.window.showErrorMessage('MCP unavailable.'); return; }
    const result = await api.mcp.invokeTool('mcp__<server>__<tool>', { /* args */ });
    if (result.isError) {
      await api.window.showErrorMessage('MCP failed: ' + result.content[0]?.text);
      return;
    }
    await api.window.showInformationMessage(result.content[0]?.text || 'Done.');
  }));
}
export async function deactivate() {}
```

### T8: Cron Job

```json
{
  "manifestVersion": 1,
  "id": "<EXT_ID>",
  "name": "<DISPLAY>",
  "version": "0.1.0",
  "publisher": "<PUBLISHER>",
  "description": "<DESCRIPTION>",
  "main": "main.js",
  "activationEvents": ["onStartupFinished"],
  "engines": { "parallx": "^0.1.0" },
  "contributes": {
    "commands": [
      { "id": "<EXT_ID>.run", "title": "<DISPLAY>: Run now" }
    ],
    "configuration": [{
      "title": "<DISPLAY>",
      "properties": {
        "<EXT_ID_NODOT>.intervalMinutes": {
          "type": "number", "default": 30, "minimum": 5, "maximum": 1440,
          "description": "How often the job runs."
        }
      }
    }]
  }
}
```

```js
export async function activate(api, context) {
  context.subscriptions.push(api.commands.registerCommand('<EXT_ID>.run', async () => {
    // … do the work …
    await api.window.showInformationMessage('<DISPLAY>: ran.');
  }));

  if (api.cron) {
    const minutes = api.workspace.getConfiguration('<EXT_ID_NODOT>').get('intervalMinutes', 30);
    api.cron.upsertJob({
      id: '<EXT_ID>.scheduled',
      schedule: { every: `${minutes}m` },
      payload: { agentTurn: 'Run <DISPLAY> now and report briefly.' },
      wakeMode: 'next-heartbeat',
      enabled: true,
    });
  }
}
export async function deactivate() {}
```

### T9: Database (combine with any other template)

**Add** `db/migrations/<EXT_ID_NODOT>_001_initial.sql`:
```sql
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

**Add** to top of `main.js`:
```js
let _api = null;
let _toolPath = '';
const db = {
  async run(sql, p = []) { const r = await _api.database.run(sql, p); if (r.error) throw new Error(r.error.message); return r; },
  async get(sql, p = []) { const r = await _api.database.get(sql, p); if (r.error) throw new Error(r.error.message); return r.row; },
  async all(sql, p = []) { const r = await _api.database.all(sql, p); if (r.error) throw new Error(r.error.message); return r.rows; },
};

async function ensureDatabase(api) {
  const open = await api.database.open();
  if (open.error) { console.error('[<DISPLAY>] open failed:', open.error.message); return false; }
  const sep = _toolPath.includes('\\') ? '\\' : '/';
  const dir = _toolPath + sep + 'db' + sep + 'migrations';
  const mig = await api.database.migrate(dir);
  if (mig.error) { console.error('[<DISPLAY>] migrate failed:', mig.error.message); return false; }
  return true;
}
```

**Add** to top of `activate(api, context)`:
```js
_api = api;
_toolPath = api.env.toolPath;
if (!api.database) { console.error('<DISPLAY>: api.database unavailable'); return; }
if (!(await ensureDatabase(api))) return;

context.subscriptions.push(api.workspace.onDidChangeWorkspace(async () => {
  await ensureDatabase(api);
}));
```

---

## 9. Final checklist (run before emitting)

Before responding to the user, verify each of these:

**Structure:**
- [ ] Output contains exactly `parallx-manifest.json` and `main.js` (plus `db/migrations/*.sql` if T9).
- [ ] Manifest has all 8 required top-level fields (Section 3.1).
- [ ] Every command in `contributes.commands` is also `registerCommand`-ed in `activate()`.
- [ ] Every view in `contributes.views` is also `registerViewProvider`-ed in `activate()`.
- [ ] Every editor in `contributes.editors` is also `registerEditorProvider`-ed in `activate()`.

**Code:**
- [ ] No `import` from `src/` or `vscode`.
- [ ] No `require()` of Node built-ins.
- [ ] Every disposable returned by `api.*` is pushed onto `context.subscriptions`.
- [ ] Optional APIs (`lm`, `chat`, `mcp`, `cron`, `database`) are guarded with `if (api.X)`.
- [ ] If the extension uses a database, `onDidChangeWorkspace` re-runs `ensureDatabase`.
- [ ] `activate` is `export async function activate(api, context)` and `deactivate` is `export async function deactivate()`.
- [ ] No TypeScript-only syntax in `main.js`.

**UI / Design (Section 6):**
- [ ] Zero hex colors, zero `rgb()`/`rgba()` with concrete numbers in CSS.
- [ ] Every color is `var(--vscode-*)`.
- [ ] Every spacing/radius/font-size/font-family is `var(--parallx-*)`.
- [ ] Zero emojis in any UI string.
- [ ] Zero inline `<svg>` — all icons via `api.icons.createIconHtml`.
- [ ] Buttons use `<button>`, inputs use `<input>` (not `<div onclick>`).
- [ ] Root container of every view/editor uses `width: 100%; height: 100%;`.
- [ ] Activity-bar `viewContainers[].icon` is a real Lucide ID (Section 6.8 list).
- [ ] Status bar text uses `$(icon-id) Label` form, no emoji.
- [ ] Button labels are sentence case, no exclamation marks.

If any box is unchecked, fix the code before responding.

---

## 10. Quick API cheatsheet

```
api.commands.{registerCommand, executeCommand, getCommands}
api.views.{registerViewProvider, setBadge}
api.editors.{registerEditorProvider, openEditor, closeEditor, openFileEditor, openEditors, onDidChangeOpenEditors}
api.window.{showInformationMessage, showWarningMessage, showErrorMessage, showInputBox, showQuickPick,
            createOutputChannel, createStatusBarItem, activeColorTheme, onDidChangeActiveColorTheme, startDrag}
api.workspace.{getConfiguration, onDidChangeConfiguration, workspaceFolders, getWorkspaceFolder,
               onDidChangeWorkspaceFolders, onDidChangeWorkspace, onDidRename, onDidFilesChange,
               name, getCanvasPages, getCanvasPageTree, onDidChangeCanvasPages, fs}
api.workspace.fs.{readFile, writeFile, stat, readdir, exists, rename, delete, mkdir}
api.context.{createContextKey, getContextValue}
api.icons.{getIcon, hasIcon, getAllIconIds, createIconHtml, getFileTypeIcon}
api.tools.{getAll, getById, isEnabled, setEnabled, onDidChangeEnablement,
           installFromFile, uninstall, onDidInstallTool, onDidUninstallTool, onDidChangeTools}
api.env.{appName, appVersion, toolPath}
api.lm?.{getModels, sendChatRequest, registerProvider, onDidChangeModels}            // may be undefined
api.chat?.{createChatParticipant, registerTool}                                      // may be undefined
api.mcp?.{invokeTool, listTools}                                                     // may be undefined
api.cron?.{upsertJob, removeJob}                                                     // may be undefined
api.database?.{open, close, migrate, run, get, all, runTransaction, isOpen}          // external extensions only
context.{subscriptions, globalState, workspaceState, toolPath, toolUri}
```

End of guide.
