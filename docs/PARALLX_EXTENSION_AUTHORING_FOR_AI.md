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

#### `contributes.icons`

Icons the extension draws itself, for the rare mark no registry icon fits (typically its activity-bar icon). Prefer a Lucide id (Section 4.7); bring an icon only when none fits.

```json
"icons": [
  { "id": "px-myext", "svg": "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"12\" cy=\"12\" r=\"8\"/></svg>" }
]
```

| Field | Required | Notes |
|---|---|---|
| `id` | yes | Non-empty string. Convention: `px-<extId>`. Any `icon` field (view container, command, `api.icons.*`) can then name it. |
| `svg` | yes | Complete `<svg>…</svg>` markup: must start with `<svg` (leading whitespace allowed). Draw in `currentColor`, 24×24 viewBox, 2px stroke, like Lucide, so it follows the theme. |

- The validator rejects a non-array `icons`, an entry that is not an object, an empty or non-string `id`, and an `svg` that is not `<svg>` markup.
- The icons exist only while the extension runs: registered as it starts (before its view containers, so they can name them) and removed when it is turned off.
- An extension cannot replace an icon that already exists. If `id` is a core icon (or one another tool registered first), that entry is skipped with a console warning and the existing icon stays. Pick an id of your own.

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
| `icon` | yes | Lucide icon ID, or the `id` of an icon from `contributes.icons`. |
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
  "view/title":     [{ "command": "myExt.doThing", "when": "view == myExt.main" }],
  "viewContainer/title": [
    { "command": "myExt.refresh", "title": "Refresh", "group": "1_actions",
      "when": "activeViewContainer == 'myExt-container'" }
  ]
}
```

Locations: `commandPalette`, `view/title`, `view/context`, `menubar/tools` (the Tools menu, `title` is the label), and `viewContainer/title`: the More Actions (`⋯`) menu in the sidebar header. Its items always say which container they belong to with `when: "activeViewContainer == '<your container id>'"`, or they would show under every container. And `editor/title`: the More Actions menu of an editor pane. It is on the PDF viewer (`⋯` in its toolbar) and on the text and code editors (a More Actions button at the right of their status line, shown only while some tool has an entry for that file; the palette's Show Editor Actions opens the same menu). Its items say which editor they belong to with `when`: `activeEditor == 'parallx.editor.pdf'` or `activeEditor == 'parallx.editor.file'` (text and code). The clause is read with that pane's own file, so it may also use `resourceExtname` (`'.md'`), `resourceFilename` and `resourceScheme`, for example `"when": "activeEditor == 'parallx.editor.file' && resourceExtname == '.md'"`. The row shows your extension's name at the right. The command is called with one argument: `{ uri, fsPath, page }` from the PDF viewer (the file's URI string, its path, the current 1-based page), `{ uri, fsPath }` from the text and code editors (no `page`). Items are sorted by `group`; an item whose command is not registered is not shown. Like every contribution, they leave when the extension is turned off.

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
api.editors.registerFileEditor(typeId, { extensions, iconHtml? }) // while your tool runs, files with these extensions open in your editor;
                                                                 // the pane's input.instanceId is 'file:' + the file's path
                                                                 // (the Explorer closes the tab when the file is deleted and reopens it
                                                                 // under the new name after a rename or a move; never write a file back
                                                                 // that is no longer there)
api.editors.closeEditor(editorId)                                // → Promise<boolean>
api.editors.openFileEditor(uri, { pinned?, reveal?, side? })     // open a file in its editor
// reveal: { page?, quote? } (PDF), { line?, endLine? } (text), { sheet?, cell? } (spreadsheet, A1 cell);
// applied once the file has loaded. side: true opens it beside the active editor (the group to
// its right, split when there is none); a file already open is shown where it is
api.editors.openEditors                                          // readonly array of descriptors: { id, name, description, isDirty, isActive, groupId,
                                                                 //   isShowing, typeId, filePath?, status? }. isShowing: it is the editor in front in its
                                                                 //   group (what a person sees there; one per group). filePath: the file it shows
api.editors.onDidChangeOpenEditors(listener)                     // → IDisposable
api.editors.setEditorStatus({ typeId, instanceId }, 'p. 214')    // → boolean. Your open editor's live word (up to 24 characters:
                                                                 //   "24 due", "3 of 12"), shown beside it where open editors are
                                                                 //   listed. Yours only; undefined clears it; false if it is not open.
```

`instanceId` lets you open multiple panes of the same `typeId`. Same `typeId+instanceId` means the existing tab is focused, not duplicated. The id is namespaced per tool and type under the hood, so `'main'` is safe even though every other extension also uses `'main'` — you can never collide with (or be blocked by) another tool's tabs.

### 4.4 `api.window`

```js
api.window.showInformationMessage(msg, ...actions)   // returns the picked action or undefined
api.window.showWarningMessage(msg, ...actions)
api.window.showErrorMessage(msg, ...actions)
api.window.showInputBox({ prompt?, value?, placeholder?, password? })   // → Promise<string|undefined>
api.window.showQuickPick(items, { placeholder?, canPickMany?, matchOnDescription?, confirmLabel? })   // → picked item(s) or undefined
// canPickMany: a checkbox per row (a click, or Space in the list), ticks kept while the search changes, then the
// dialog's Cancel and its confirming button (confirmLabel, "OK" by default); resolves the ticked items. The search
// finds every word typed in the label, and in the description and detail with matchOnDescription.
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
api.workspace.listFiles(maxFiles?)                        // → Promise<[{ uri, name, relativePath, folder }]>: every file of the
                                                          //   workspace (machinery and hidden folders left out), for a picker over "any file"
api.workspace.onDidMoveFiles(listener)                    // → IDisposable; listener gets [{ from, to }] (file:// URIs) after the app
                                                          //   moved or renamed a file or folder (the Explorer, workspace.fs.rename): keep a link to it
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
api.workspace.fs.locate(uri, quote?)  // → { addressing: 'page'|'line'|'cell'|'none', pageCount?, lineCount?, sheets?, spots: [{ page?, line?, sheet?, cell?, text }] }
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

Parallx ships ~2000 Lucide icons. Use them everywhere instead of inline SVG. An icon the registry lacks is declared in the manifest (`contributes.icons`, Section 3.4) and then used by id like any other.

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
api.lm.parseJson(replyText)                        // → the JSON in a reply (object or array), past prose, fences and a leaked <think> block; null when none. Never a greedy regex.
```

`messages`: `[{ role: 'system'|'user'|'assistant'|'tool', content: string }]`.
`options`: `{ temperature?, topP?, maxTokens?, format?, seed?, think?, tools?, engine? }`.
`engine`: `{ label?, attended?, background? }`. A call with neither flag is one
someone waits on: it starts now, ahead of background AI work (routines, page
linking). `attended`: a job the person started and watches, made of many calls
(a sync): ahead of background work too, and a chat turn may pause one (it is
retried unseen). `background`: nobody waits on it (memory extraction after an
exchange): it runs when the engine is free. `label` names the call in AI ›
Show Model Calls. One context size: every call runs at the size the model is
loaded at (the chat's); a `numCtx` of your own only counts while nothing is
loaded.

### 4.9 `api.chat` (may be undefined)

```js
api.chat.createChatParticipant(id, handler)  // register a chat participant (e.g. @myExt)
api.chat.registerTool(name, {
  description: string,
  parameters: <JSON Schema>,
  handler: async (args, token) => ({ content: string, isError?: boolean }),
  requiresConfirmation: boolean,
  reachesNetwork?: boolean,      // the tool reaches the internet
  untrustedOutput?: boolean,     // what it returns comes from outside and may carry instructions
  profiles?: ('readonly' | 'standard')[],    // the narrower tool profiles it belongs to (below)
})                                            // → IDisposable
api.chat.registerDropHandler({
  mimeType: 'application/x-myext-items',      // your own drag type
  resolve: async (data) => ({ paths?: string[], warning?: string }) | undefined,
})                                            // → IDisposable
```

A registered chat tool is auto-discoverable by the agent in Agent mode. Declare honestly what it does; the app's safety rules read these flags, never the tool's name:

- `reachesNetwork: true`: the tool makes any request off this computer. A sealed workspace (nothing leaves the machine) hides the tool from the AI.
- `requiresConfirmation: true`: the tool writes or changes the user's data. It runs at once in a turn the user started (sending the message is the consent); in a scheduled or background turn, and with Careful Mode on, it asks first. A tool that only reads declares `false`.
- `untrustedOutput: true`: the result carries text from outside (a web page, a search result, a downloaded file) that may contain instructions. The turn is marked as having read it, and its tool cards show what ran. Since M90 (the owner's decision, `docs/Parallx_Milestone_90.md`) that mark no longer makes later writes in the turn ask first.
- `profiles`: the chat runs each turn with a tool profile. Ask and Agent use `full`, which has every tool; a model the app rates small (8B parameters or fewer) runs with `standard`, and Edit mode too. A tool without `profiles` is hidden from those turns. Declare `['standard']` for a tool that only makes safe writes in your own data (it never deletes or overwrites the user's work), and add `'readonly'` for one that only reads. Anything else is dropped.

`registerDropHandler` lets the chat input accept your extension's own drag type while it runs. The input attaches dropped files by itself; when a drop of `mimeType` carried no file it could attach, `resolve` gets the drag's data of that type and returns absolute `paths` to attach, or a `warning` shown in the chat input when nothing could be attached (return `undefined` to ignore the drop). Disposed, or the extension turned off, the input stops accepting the type.

All of these are removed when the extension is turned off; still push them into `context.subscriptions`.

`api.chat.shownSession()` is the conversation the chat has open and whether it is on screen now: `{ id, showing }`, or `undefined` when it has none. After you open the chat on something of yours (`chat.stagePrompt`), it says which conversation that was; later it says whether that conversation is the one the person is looking at (`showing` is false while the chat's panel is closed or behind another view). `api.chat.onDidChangeShownSession(listener)` fires when the chat opens another conversation. Whether the panel shows is asked when you read it, so nothing runs for it.

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

### 4.11b Question providers (a core seam, through a command)

A tool that holds questions (a problem bank, practice cards, an imported
exam) offers them to any tool that runs sessions over questions; neither
names the other. The registry is the core's and is reached through one
command, so the pattern is the same as `chat.getSelectionActionDispatcher`:

```js
const registry = await api.commands.executeCommand('questions.getRegistry');
// { register(provider) → IDisposable, list() → providers, onDidChange(listener) → IDisposable }
context.subscriptions.push(registry.register({
  id: 'myExt.cards',                 // '<tool>.<store>', unique
  displayName: 'Practice Cards',
  toolId: 'my-publisher.my-ext',
  async list({ limit } = {}) {       // → [{ ref, question, answer, kind, rubric?, paper?, source?, exam?, sitting?, number?, part?, label?, sourceUri?, sourcePage?, sourceExcerpt?, tags? }]
    …
  },
  async open(ref) { … return true; },   // show the question where it lives; optional
}));
```

`kind` is `essay`, `short`, `quant`, `mc` or `other`; `rubric` is `[{ text, required }]`. A consumer lists providers with `registry.list()`, re-reads on `registry.onDidChange`, and shows `displayName` as the question's origin. The command may be missing on an older host: retry a few times, then give up quietly. Study consumes this seam; Worksheets (`worksheets.problems`) and Flashcards (`flashcards.essay-practice`) provide into it.

### 4.11c Progress providers (a core seam, through a command)

A tool whose items are worked and rated (problems, cards, drills) says how
far along they are; any tool that shows progress draws it. Neither names the
other. Every progress provider counts in the same four states, best first:
`good`, `middling`, `poor`, and the rest (not worked yet), so a reader draws
one bar for any of them (`api.ui.createStackedBar`, §6.3). The registry is
the core's and is reached through one command:

```js
const registry = await api.commands.executeCommand('progress.getRegistry');
// { register(provider) → IDisposable, list() → providers, onDidChange(listener) → IDisposable }
context.subscriptions.push(registry.register({
  id: 'myExt.drills',                // '<tool>.<store>', unique
  displayName: 'Drills',             // the kind of item, plural, as a heading
  toolId: 'my-publisher.my-ext',
  words: { good: 'Crisp', middling: 'Shaky', poor: 'Blank', rest: 'Untried' },   // your own words for the four states
  async groups() {                   // every group (a paper, a tag, a deck) with its counts now
    return [{ group: 'mack', label: 'Mack', total: 9, good: 4, middling: 2, poor: 1 }];   // the rest is total minus the three
  },
  onDidChange(listener) { … return { dispose() { … } }; },   // call listener() when any count may have changed
  async count(groups) { … return { total: 12, good: 5, middling: 2, poor: 1 }; },   // these groups together, each item once; only when your groups can share items
  async open(groups, state) { … return true; },   // show the items of these groups in that state ('good' | 'middling' | 'poor' | 'rest'), all together; optional
}));
```

`group` is your own key (it comes back in `count` and `open`, always as a list); `label` is the name a person reads. A reader matches a group to its own things by name, so name groups as the person names them. Counts are whole numbers; a reader clamps what does not add up. A reader may show several of your groups as one (two of them match one of its things): when your groups cannot share an item (a problem is in one paper), leave `count` out and the reader adds them; when they can (a card is in its deck and in each of its tags), give `count(groups)`, the same four numbers over those groups with each item once, because the sum would count an item twice. `open(groups, state)` gets every group behind the part that was pressed, so what opens is what the part counts. Leave `open` out when you have nowhere to show the items: a reader then draws the bar without buttons. A reader lists providers with `registry.list()`, reads `groups()` again on the provider's `onDidChange`, and re-lists on `registry.onDidChange` (a tool turned off takes its provider with it, at once). The command may be missing on an older host: retry a few times, then give up quietly. Study's Progress consumes this seam; Worksheets (`worksheets.problems`) and Flashcards (`flashcards.cards`) provide into it.

### 4.11d `api.work`: time worked, and work providers

Two things the core owns so every tool counts time one way and no tool reads
another's tables: **the clock**, and **work providers**.

**The clock.** Time worked is time with your surface showing and the person
at the desk. The core's clock counts while `showing()` is true and the person
pressed a key, clicked, tapped or scrolled anywhere in the app within the
idle time; when the idle time passes with none, it takes the whole stretch
since that input back, once. Moving the mouse alone is not being there. The
idle time is one setting for the whole app (Idle Time under General in
Settings: 5, 10, 15 or 30 minutes, 10 to begin with); a running clock follows
a change at once. A look that crosses local midnight gives each side to its
own day. Never write your own timer for time worked, and never measure it as
the gap between two events (a card shown and a card graded): a break with the
tab up would count.

```js
const clock = api.work.createClock({
  showing: () => root.isConnected && root.getClientRects().length > 0 && document.visibilityState === 'visible',
  bucket: () => String(currentItemId),          // optional: what is showing now, when one clock serves several things
  onCount: (seconds) => { shown += seconds; },  // optional: a clock on screen moves by this many whole seconds (below zero: taken back)
  credit: (credits, final) => {                 // whole seconds to keep: [{ day: 'YYYY-MM-DD', bucket, seconds }], seconds below zero when taken back
    for (const c of credits) addSeconds(c.day, c.bucket, c.seconds);   // every half minute, when the surface stops showing, at dispose (final)
  },
});
api.work.createClockStatus(headerEl, clock);    // the line that says "Paused: no input for 10 minutes. That time is not counted." and "Counting again"
clock.dispose();                                // when the surface closes: its last seconds go to credit first
```

Wherever a clock is shown or a session is running, put `createClockStatus`
there too (`{ bar: true }` for a line of its own across a pane): the person
sees when the clock stopped and when it goes on, and a screen reader is told
politely. `api.work.idleMinutes` is the idle time now; `api.work.dayOf(ms)` is
the local day the clock would credit a moment to (use it for anything you
count beside the time, so both land on the same day). Clocks and status lines
are disposed for you when your extension is turned off.

**Work providers.** A tool in which a person works reports what each day's
work came to; a tool that keeps a record of work reads every provider and
writes its own record. Neither names the other. A work provider reports, for
each local **day** and each **group** of its items (a paper, a tag, a deck):
the **minutes** worked (from the clock above), the **items** worked, and how
many were **right** when it can say.

```js
context.subscriptions.push(api.work.registerProvider({
  id: 'myExt.drills',                  // '<tool>.<store>', unique
  displayName: 'Drills',               // your tool's name, as a person reads it
  kind: 'Problems',                    // the kind of work: 'Problems', 'Cards', …
  async work(since) {                  // every day's work as it stands now; with `since` ('YYYY-MM-DD'), the days from then on are enough
    return [{
      day: '2026-11-23',               // the local day the work was done on
      groups: [{ group: 'tag:mack', label: 'Mack' }, { group: 'deck:3', label: 'Exam 7' }],   // every group the items are in, the most particular first
      minutes: 12.5,                   // may carry a fraction; a reader rounds
      items: 4,                        // items worked that day
      right: 3,                        // leave it out when you cannot say
    }];
  },
  onDidChange(listener) { … return { dispose() { … } }; },   // call listener() when any day's numbers may have changed
}));

api.work.providers()                   // every tool's provider, as registered now: [{ id, displayName, kind, toolId, work, onDidChange }]
api.work.onDidChangeProviders(listener)   // a tool was turned on or off
```

Rules for a provider: report whole days, each as it stands now (the same
call later may say more for today, and less when an idle stretch was taken
back), never increments. An entry is one piece of work: when an item is in
several groups at once, name them all in `groups` and report the work once;
a reader counts an entry once, never once per group. Name groups as the
person names them: a reader matches `label` to its own things by name. Keep
your own store (the seconds by day): the reader keeps only its record, so
your past is still yours to report after you were off. Report only time the
clock counted while your own surface was showing, so two tools never report
the same seconds.

Rules for a reader: read `work()` when a provider's `onDidChange` fires and
when the list changes; write nothing when nothing changed; never write into
a provider's data. A provider that goes (its tool was turned off) says
nothing about its past: keep what you recorded from it.

Study reads this point: each subject's Work Log gets one row per tool, unit
and local day (the group matched to a unit by its name or its Also Called),
which grows with the day's work; a row the person changed is theirs from then
on. Worksheets (`worksheets.problems`, by paper) and Flashcards
(`flashcards.cards`, by tag and deck) provide into it.

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
api.env.timeZone      // the app's time zone, an IANA name such as 'America/Chicago'
await api.env.readAsset('figure/body.bin')   // → ArrayBuffer: a data file the extension ships
```

`api.env.readAsset(relativePath)` reads a data file from the extension's own folder (a mesh, a model, an image), as an `ArrayBuffer`. The path is relative to the folder; an absolute path, a URL or `..` is refused, and so is a file over 512 MB. Code is imported (`import './x.js'`), never read this way.

`api.env.timeZone` is the one time zone for the whole app: the Time Zone setting (Settings › General), or this computer's zone when that is empty. Use it for every "today", day boundary and date label (`new Intl.DateTimeFormat('en-CA', { timeZone: api.env.timeZone })`) so your dates agree with the assistant and every other tool. Read it each time you need it (the user can change it while you run); never hardcode a zone (a test rejects `timeZone: 'Area/City'` literals in tools).

### 4.15 `api.dashboard` — contribute dashboard widgets (M86)

Any extension can add widget types to the user's dashboards. Registration is
**activation-order independent**: call it from `activate()` whenever it runs;
the dashboard picks the type up live, including upgrading "unavailable"
placeholder cards the moment your type registers. When your extension is
disabled, mounted instances degrade to placeholders — the user's layout,
config, and cached content are never lost.

```js
api.dashboard.registerWidgetType(reg)   // → IDisposable (push to _disposables)
api.dashboard.listWidgetTypes()         // → metadata for every contributed type
```

Rules enforced at the boundary (throws on violation):

- `typeId` MUST start with `"<yourExtensionId>."` — e.g. `parallx.budget.mtd-spend`.
- `defaultSize` must fit the 12-column grid (`1 ≤ colSpan ≤ 12`).
- `defaultRefreshPolicy` intervals must be ≥ 60 000 ms; cron must be 5-field.
- A `typeId` registered by another extension cannot be taken over.

Registration shape (all the same fields the built-in widgets use):

```js
const d = api.dashboard.registerWidgetType({
  typeId: 'myExt.my-widget',            // namespaced under your extension id
  displayName: 'My widget',
  description: 'One sentence for the picker. Give two unrelated example uses.',
  icon: '<svg …></svg>',                // inline SVG or codicon name
  category: 'query',                    // 'static' | 'query' | 'ai'
  defaultSize: { colSpan: 4, rowSpan: 3 },
  defaultConfig: { maxItems: 8 },
  configSchema: {                       // renders the settings drawer for free
    fields: {
      maxItems: { type: 'number', label: 'How many to show' },
    },
  },
  defaultRefreshPolicy: { kind: 'interval', ms: 30 * 60_000 },

  // Pure data fetch. Runs headless (scheduler) AND on manual refresh.
  // Return a string (usually JSON.stringify of your data), ≤ 256 KiB.
  async refresh(ctx) {
    const data = await computeMyData(ctx.config);
    return JSON.stringify(data);
  },

  // DOM render into the widget card body. Parse ctx.cachedOutput to paint.
  createWidget(container, ctx) {
    function paint(cached) { /* build DOM from JSON.parse(cached) */ }
    paint(ctx.cachedOutput);
    const sub = ctx.onDidChangeConfig(() => ctx.requestRefresh());
    ctx.requestRefresh(); // refresh on mount if your data changes out-of-band
    return {
      refreshFromCache(cached) { paint(cached); },
      renderError(message) { /* show message; null = cleared */ },
      dispose() { sub.dispose(); },
    };
  },
});
_disposables.push(d);
```

**`renderMode: 'markdown'` — widgets without DOM code.** Set it and omit
`createWidget` entirely: the dashboard renders your widget's cached output
as Markdown (empty/error states included). Perfect for plain-JS extensions
and AI-backed widgets — your `refresh` either returns Markdown directly or
has a background agent deliver it via `dashboard_render_widget` (return
`null` in that case so you don't overwrite the delivered content).
`parallx://` links in the rendered Markdown are automatically routed
through the link resolver, so a heading link into your own surface gives
the widget its click-through for free. Reference: the news-brief widget in
`ext/web-research/main.js`.

Design rules for widgets:

- **A widget is a door, not a poster** — clicking it should navigate into
  your extension's own surface (`api.editors.openEditor(...)` / a command,
  or a `parallx://` link in markdown mode).
- **Domain-blind config**: don't hardcode a use case that config could
  express. State two unrelated instantiations in `description`.
- Reuse the data paths your extension already has (the budget widget calls
  the same summary query as its chat tool — see `ext/budget/main.js`,
  `buildMtdSpendWidget`, for the reference implementation).
- Guard for older shells: `if (api.dashboard?.registerWidgetType) { … }`.

### 4.16 `api.home` — put your things and your card on Home

Home is the page the app opens on: a greeting, a field to ask the chat,
"Today, from your tools" (one card a tool), and the things last worked on
from every tool that is on. Two contribution points, both registered while
you run. Turned off, your card and your things leave Home; nothing else
changes.

**Your things, in the feed.** If your extension keeps things a person comes
back to (characters, decks, a ledger, an album), register a source:

```js
_disposables.push(api.home.registerSource({
  id: 'decks',                 // stable within your extension
  label: 'Flashcards',         // your name
  async listRecent(limit) {    // newest first
    return recentDecks(limit).map((d) => ({
      id: d.id,
      title: d.name,
      kind: 'Deck',            // singular
      icon: 'layers',          // registry icon id
      summary: d.description,  // its own opening words; Home shows two lines
      preview: d.firstFronts,  // optional: more of its text, line breaks kept, drawn small as its picture
      image: d.coverUrl,       // optional: a picture of the thing itself (a URL an <img> can load)
      stat: { value: String(d.cards), unit: 'cards' },   // optional: one figure, shown at the right
      tags: d.tags,
      where: 'Decks',
      touchedAt: d.reviewedAt, // milliseconds since the epoch
      open: () => api.commands.executeCommand('flashcards.openDeck', d.id),
    }));
  },
  onDidChange: onDecksChanged, // optional: (listener) => IDisposable
}));
```

**Your card for today.** One number, one line, one action that runs a
command of yours. Home says which tool it is from (your manifest's name).
Register a provider and Home reads it when it opens and when you say your
data changed, so you keep no timer:

```js
_disposables.push(api.home.registerCardProvider({
  id: 'today',
  async read() {               // null: nothing to say today, no card
    const due = await countDue();
    if (!due) return null;
    return {
      id: 'today',
      icon: 'layers',          // optional, beside your name
      number: String(due),     // optional: a card with no number is a first step
      unit: 'cards due',
      line: '6 are new, 24 to review.',
      action: { label: 'Study', icon: 'play', command: 'flashcards.study' },
    };
  },
  onDidChange: onDecksChanged, // optional: (listener) => IDisposable
}));
```

`api.home.registerCard(card)` puts up a card that says the same until you
register it again under its id (the same id replaces it); disposing takes
it back.

- Guard for older shells: `if (api.home?.registerCardProvider) { … }`.
- Keep `listRecent` and `read` cheap: Home calls them when it opens, when
  it is opened again, and when you say something changed. No timers.
- One card a tool. Sentence case for `unit` and `line`, Title Case for the
  action's label, as everywhere (section 6).
- `search` on a source is still accepted, but Home has no search field of
  its own now (the field on Home asks the chat), so nothing calls it.

### 4.17 `api.canvas.databases` — keep your record where the person can see it

A canvas database is the person's own table: they open it, sort it, filter
it, edit it, and build views on it. If your extension tracks things a person
would want to look at or correct (questions answered, sessions logged, items
collected), keep them in a canvas database instead of a private store: the
visibility comes for free, and what they change in the table is what you
read next. `api.database` (4.6) stays the place for data only your code
reads.

| Call | What it does |
|---|---|
| `list()` | `{ id, title }` of every database the person has. |
| `get(databaseId)` | `{ id, title, pageId, parentPageId, columns }`, or `null` when there is no such database. `columns[0]` is always the title column (`type: 'title'`, named "Name"). A database in the Trash is still returned, with `trashed: true`: it lists no rows until the person restores it, so treat it as away, not as empty. |
| `create({ title, parentPageId?, columns? })` | A database with exactly those columns after the title column. No starter Status column. |
| `createPage({ title, parentPageId? })` | A plain page, to hold your databases. Returns `{ id }`. |
| `ensureColumns(databaseId, columns)` | Adds the columns missing by name (case does not matter). Never changes or removes one that is there; a select, status or tags column only gains listed options it lacks. Does nothing when nothing is missing. |
| `listRows(databaseId)` | `{ pageId, title, values }[]`, values by column **name**. A few queries however many rows. |
| `addRow(databaseId, { title, values? })` | Adds a row; returns it. |
| `updateRow(databaseId, pageId, { title?, values? })` | Changes only what is named (`null` clears a cell). One write, one change event. |
| `removeRow(databaseId, pageId)` | The row's page goes to the Trash. |
| `addRows(databaseId, rows)`, `updateRows(databaseId, patches)`, `removeRows(databaseId, pageIds)` | Many rows at once (`patches` are `{ pageId, title?, values? }`): one transaction and one change event (no `pageId`), so an open view reloads once. Every value is checked first; one refused writes nothing. Use these for a table you keep a hundred rows of (a plan's days), not a loop of single writes. |
| `onDidChange(databaseId, listener)` | `{ kind: 'rows' \| 'cells' \| 'columns', pageId? }` for every change, whoever made it: the person in any view, the chat, another extension, you. A row, or the database itself, going to the Trash or coming back from it is a `'rows'` change. |
| `open(databaseId)` | Opens the database in the editor. |

Column types: `text`, `number`, `checkbox`, `date` ("YYYY-MM-DD"),
`datetime` ("YYYY-MM-DDTHH:mm", local), `select` and `status` (an option's
name), `tags` (names), `url`, `email`, `phone`, `files`, `relation` (page
ids of rows in `config.databaseId`), `unique_id`, and the ones the app
computes: `created_time`, `last_edited_time`, `formula`
(`config.expression`), `rollup`.

```js
const db = api.canvas.databases;

// Once: a page, and a database under it.
const page = await db.createPage({ title: 'Reading' });
const log = await db.create({
  title: 'Reading Log',
  parentPageId: page.id,
  columns: [
    { name: 'Finished', type: 'date' },
    { name: 'Kind', type: 'select', config: { options: ['Book', 'Paper'] } },
    { name: 'Pages', type: 'number' },
    { name: 'Times Opened', type: 'number', config: { computedBy: true } },  // yours: see below
  ],
});
await context.workspaceState.update('reading.logId', log.id);   // remember the id, not the title

// Every start, and whenever columns change: the person may have deleted one.
await db.ensureColumns(log.id, COLUMNS);

// Write by column name.
const row = await db.addRow(log.id, { title: 'Meditations', values: { Kind: 'Book', Pages: 254 } });
await db.updateRow(log.id, row.pageId, { values: { Finished: '2026-11-18', 'Times Opened': 3 } });

// Read what is there now, including what the person typed into the table.
const rows = await db.listRows(log.id);   // [{ pageId, title: 'Meditations', values: { Kind: 'Book', Pages: 254, … } }]

// Follow their edits. Disposed for you when your extension is turned off.
context.subscriptions.push(db.onDidChange(log.id, (e) => {
  if (e.kind === 'columns') void db.ensureColumns(log.id, COLUMNS);
  void refresh();
}));
```

Rules:

- **The database is the record.** Read it when you need it; do not keep a
  copy that can disagree with what the person sees. Rows they add, retitle,
  edit or delete are the truth.
- **Use what is there.** Offer to use a database the person already has
  (`list`, `get`, then `ensureColumns` for what is missing) before making a
  new one. `ensureColumns` never changes a column that exists, so a column
  of another type under your name is theirs: read it as it is.
- **A column you keep** (`config: { computedBy: true }`) is one you work out
  and the person should not type into: a count, a last-used date. Only your
  extension writes it, through this API. The person sees it in every view;
  no view, the row's page, nor the chat's tools can change it, its type is
  fixed, and its cells say "Kept by" and your extension's name. With your
  extension off it stays, read-only. They can still delete the column:
  `ensureColumns` puts it back (empty), then write its values again. Keep
  only what you compute; everything a person might correct stays theirs.
- **Sized to what it holds.** A column made by `create` may carry a
  `width` in px (48 to 640) for the new table; `{ name: 'Name', type:
  'title', width }` sizes the title column. Give narrow numbers and dates
  narrow widths so the columns the person types into are on screen when the
  table opens; they can resize every column as usual.
- **Names are the contract.** Values are keyed by column name, matched
  whatever the case. A name the database lacks is refused with the names it
  has, and nothing is written. The person can rename a column: `get` it by
  the id you stored if a name stops matching.
- **Remember ids** (the database's, a row's `pageId`) in your own state;
  titles change.
- **Never throws when you start.** Every call rejects with "Canvas databases
  are not available" while the canvas is not running; `onDidChange` set
  before then starts hearing when it is. Guard for older shells:
  `if (api.canvas?.databases) { … }`.
- **Turned off, you leave nothing running** and nothing is taken away: the
  page, the databases, rows and values stay the person's.

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
  root.style.cssText = 'padding: var(--px-space-3); display: flex; flex-direction: column; gap: var(--px-space-2);';

  api.ui.createSectionLabel(root, 'My View');
  api.ui.createButton(root, { label: 'Say Hello', size: 'sm', onClick: () => api.window.showInformationMessage('Hello.') });

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
    api.ui.createPageHeader(root, { title: 'My Ext', primary: { label: 'Refresh', icon: 'refresh-cw', onClick: () => {} } });
    api.ui.createEmptyState(root, { headline: 'Nothing here yet.', hint: `Input id: ${input?.id || 'none'}.` });
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

Parallx is one app, not a federation of tools. An extension supplies **content and actions**; the workbench supplies **every piece of chrome**: buttons, page headers, empty states, menus, dropdowns, dialogs, tokens. **If you are writing CSS for a button, a header, a menu or a dialog, stop: there is a component for it (Section 6.3).** The build checks this: `tests/unit/extStyleRatchet.test.ts` counts raw colours, pixel font sizes, uppercase labels, emoji, native `confirm()` and native `<select>` per extension and fails if a count rises. A new extension starts at zero.

### 6.1 Identity (one paragraph)

Calm, dense, dark-first desktop workbench in the spirit of Linear and Obsidian: graphite surfaces, **one accent colour** (user-chosen, Steel by default), quiet secondary text, one main action per screen. Light mode is a first-class peer, never an afterthought. **The Parallx mark is the only sign of AI**: no sparkles, robots or speech bubbles. There is no brand purple (the old `#9333ea` is retired).

### 6.2 Iron rules

1. **Chrome comes from the kit** (Section 6.3): `api.ui.createButton`, `createIconButton`, `createPageHeader`, `createEmptyState`, `createSectionLabel`, `createFilterChip`, `createSegmented`, `createDropdown`, `createStackedBar`, `showContextMenu`, and `api.window.showConfirmModal` for confirmations. Never clone them.
2. **Never write a colour literal.** No hex, no `rgb()`/`rgba()` with numbers. Use the `--px-*` tokens in 6.4. (A data palette, such as category colours a user picks, is data, not styling.)
3. **Never write a pixel font size.** Use `--px-text-*` (6.5). Six sizes; nothing between them.
4. **Never set a font-family.** Inherit it (the user picks the app font in Appearance).
5. **Controls sit on the height ladder:** 28px default, 24px dense, 22px panel-dense (`--px-control-h`, `-sm`, `-xs`). One radius for controls: `--px-radius-sm`.
6. **No uppercase, no letter-spaced micro-labels.** Section labels are sentence case, `--px-text-sm`, weight 600, secondary colour (`createSectionLabel`).
7. **One primary action per view.** Everything else is secondary, ghost, or behind ⋯ (the page header enforces this).
8. **No emoji** in any UI string. Icons come from `api.icons.createIconHtml(id, size)`.
9. **No native dialogs or selects:** no `confirm()`, `alert()`, `prompt()`, `<select>`.
10. **Stay in your container.** No `position: fixed` outside it, no `vh`/`vw`, no z-index (menus and dialogs from the kit already sit on the workbench's popup layer).

### 6.3 The kit: use these, do not style your own

```js
// Page header: title; one primary, up to two secondary (extras move into ⋯); ⋯ for the rest.
api.ui.createPageHeader(root, {
  title: 'Budget',
  subtitle: 'September 2026',
  primary:   { label: 'Sync Now', icon: 'refresh-cw', onClick: () => sync() },
  secondary: [{ label: 'Export', onClick: () => exportCsv() }],
  more:      [{ label: 'Settings', icon: 'settings', onSelect: () => openSettings() }],
});

// Buttons: kind 'primary' | 'secondary' (default) | 'ghost' | 'danger'; size 'md' (28) | 'sm' (24).
// A button in a toolbar, a row or a card leads with an icon. The words that
// answer a dialog (Cancel, Close, Done, Save) stay words. A state is a switch
// (createToggle), never a button whose word flips (Enable / Disable).
// wordButtonRatchet.test.ts counts the rest per file; the count only falls.
api.ui.createButton(toolbar, { label: 'Add Account', icon: 'plus', onClick: add });
api.ui.createButton(row, { label: 'Remove', icon: 'trash-2', kind: 'danger', size: 'sm', onClick: remove });

// Toolbar actions are icons with a tooltip (title is required).
api.ui.createIconButton(toolbar, { icon: 'filter', title: 'Filter', onClick: openFilter });

// Empty state: one headline, one hint, one way out.
api.ui.createEmptyState(body, {
  icon: 'inbox',
  headline: 'No transactions yet.',
  hint: 'Sync an account or import a CSV to see them here.',
  action: { label: 'Import CSV', onClick: importCsv },
});

// Layout and text around your controls: the kit's block, never document.createElement.
// Refuses control tags (button, input, a, select) and on* attributes; rawDomRatchet counts the rest.
const card = api.ui.createBlock(body, 'div', { className: 'budget-card' });
api.ui.createBlock(card, 'span', { className: 'budget-card-name', text: account.name });

// A header or empty-state action can run a command instead of a handler (kitHandlerRatchet counts onClick):
// primary: { label: 'Export…', icon: 'download', command: 'budget.export', args: [accountId] }

// Section label inside a page or sidebar.
api.ui.createSectionLabel(sidebar, 'Accounts');

// Filters that narrow a list (several on at once): chips. aria-pressed carries the state.
const noted = api.ui.createFilterChip(bar, { label: 'Noted', count: 5, onToggle: (on) => refilter() });

// One choice of a few (a setting, a rating): the segmented switch.
api.ui.createSegmented(row, { ariaLabel: 'Sheet appearance', items: [{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }], value: 'light', onChange: save });
// The same choice as cards side by side, each with lines under its label (its name for a screen reader is all of it).
api.ui.createSegmented(row, { ariaLabel: 'The plan you follow', items: [{ value: 'floor', label: 'Floor', detail: ['104 h', '96 under 200'] }, { value: 'standard', label: 'Standard', detail: ['144 h', '56 under 200'] }], value: 'standard', onChange: follow });

// Counts in four states (how far along a paper, a deck, a unit is): THE stacked bar, never your own.
// Green good, yellow middling, red poor, the rest an outline; one order always; a part with nothing is not drawn.
// Never by hue alone: each state has its own texture too (good solid, middling hatched, poor ticked; on the thin
// bar solid, dashed, dotted), and under forced colours the parts are drawn in the system's colours.
// `label` is the whole bar spoken in full. A part with `command` (or `onClick`) is a button with its own name;
// without one the bar is one picture. `size: 'sm'` is a thin line for a list row, never pressable.
// A part's tooltip is its `label`; give `title` a shorter one when the row already says whose bar it is ('Wrong: 2').
// The tooltip is not the mouse's only: it shows when the keyboard's focus arrives on a part, on a tap of a part that
// does nothing else, and on a long press of one that acts (a tap there runs its action). Where there is room, also
// write the numbers out beside the bar; a tooltip is the only place for them nowhere.
api.ui.createStackedBar(row, { label: 'Mack, Questions: 12 right, 3 partly, 2 wrong, 5 not yet', parts: [
  { state: 'good', count: 12, label: 'Right: 12' },
  { state: 'middling', count: 3, label: 'Partly: 3' },
  { state: 'poor', count: 2, label: 'Mack, Questions, wrong: 2. Study these', command: 'myExt.study', args: ['mack', 'wrong'] },
  { state: 'rest', count: 5, label: 'Not yet: 5' },
] });   // → { element, update(options), dispose() }: update() redraws new counts in place and keeps the focus
// A legend's swatch is the bar's own: an element with class px-stacked-bar-key and the state, so tone and texture match the bars.
api.ui.createBlock(legend, 'span', { className: 'px-stacked-bar-key', attrs: { 'data-state': 'middling', 'aria-hidden': 'true' } });
// A bar on a surface other than the page's (a card) sets --px-bar-cut to that surface on its container: the textures are cut in it.

// A sub-page links back to the page it belongs to.
api.ui.createPageHeader(root, { title: 'Problem Bank', back: { label: 'Worksheets', onClick: openHome } });

// Choices: THE dropdown, never <select>. Menus: THE context menu.
const dd = api.ui.createDropdown(row, { items, selected: 'month', ariaLabel: 'Period' });
api.ui.showContextMenu(anchorEl, [{ label: 'Rename', icon: 'pencil', onSelect: rename }]);
// Several choices set together (a model, then a size): keepOpen rows leave the
// menu open and move their check; update() redraws when a choice changes the rest.
const menu = api.ui.showContextMenu(btn, build(), { anchorPosition: 'above' }); // rows: { label, checked, keepOpen: true, onSelect: () => { pick(); menu.update(build()); } }

// Confirmations: the app's modal, never confirm().
const ok = await api.window.showConfirmModal({ message: 'Delete this deck?', detail: 'Its 42 cards go too.', confirmLabel: 'Delete', danger: true });

// A dialog you build yourself (role="dialog", aria-modal="true") keeps Tab inside it; dispose when it closes.
const tabs = api.ui.keepTabInside(dialog, backdrop);

// Removed with a way back (the row can be put back): the Undo toast, not a question first.
api.ui.showUndoToast({ message: 'Deck removed', undo: () => restoreDeck(deck) });
```

If the kit lacks something you need, the kit grows (ask for it); the extension never clones a component.

#### The scene: give every control an id

The app keeps a live list of what is on screen (the scene), which the
assistant and the probes read. A kit control with an `id` is in it; one
without is drawn but not listed. Ids are stable within their surface and
read `<tool>.<name>`; a control that runs a bare command takes the
command's id. Your view or pane is already a surface owned by your tool.

```js
// Every kit function takes id (and hint); a button that runs a command records it.
api.ui.createButton(toolbar, { id: 'budget.sync', label: 'Sync Now', command: 'budget.sync' });
api.ui.createIconButton(toolbar, { id: 'budget.filter', icon: 'filter', title: 'Filter', onClick: openFilter });
api.ui.createFilterChip(bar, { id: 'budget.noted', label: 'Noted', onToggle: refilter });
api.ui.createSegmented(row, { id: 'budget.period', ariaLabel: 'Period', items, value: 'month', onChange: save });
api.ui.createDropdown(row, { id: 'budget.account', items, selected: 'main', ariaLabel: 'Account' });

// A repeated region (one card per account) is a surface with the row's id as instance;
// its buttons keep fixed ids. A list you render yourself is one entry.
const card = document.createElement('article');
api.ui.createSurface(card, { id: 'budget.account', owner: 'budget', label: account.name, instance: account.id });
api.ui.createButton(card, { id: 'budget.account.remove', label: 'Remove', kind: 'danger', size: 'sm', onClick: remove });
api.ui.createList(listEl, { id: 'budget.transactions', label: 'Transactions', rows: () => [...listEl.children], selected: () => selectedIds });

// Form controls: each declares its state (pressed, value, number, selection) itself.
api.ui.createToggle(form, { id: 'budget.roundUp', label: 'Round up', checked: true, onChange: save });
api.ui.createInput(form, { id: 'budget.name', label: 'Name', value: name });
api.ui.createSelect(form, { id: 'budget.currency', label: 'Currency', items, value: 'USD', onChange: save });
api.ui.createSlider(form, { id: 'budget.limit', label: 'Monthly limit', min: 0, max: 5000, value: 1200, onChange: save });
api.ui.createTabs(head, { id: 'budget.tabs', label: 'Sections', items: [{ id: 'spend', label: 'Spending' }], active: 'spend', onSelect: show });

// A menu you open is in the scene while it is open.
api.ui.createMenu(btn, { id: 'budget.more', label: 'More', items: [{ label: 'Export', onSelect: exportCsv }] });

// Chrome you drew yourself (a tab, a chip) keeps its DOM; declare it in place.
api.ui.declareControl(myTab, { id: 'budget.tab.accounts', label: 'Accounts', state: () => ({ kind: 'pressed', value: active }) });

// A dynamic id segment (a field's label, a category name) goes through sceneSlug: 'Saved So Far' is 'saved-so-far'.
api.ui.declareControl(input, { id: `budget.goal.${api.ui.sceneSlug(labelText)}`, label: labelText, kind: 'input', state: () => ({ kind: 'value', value: input.value }) });
```

### 6.4 Colour tokens (the only colours you may use)

| Token | Use for |
|---|---|
| `--px-text` | Body text, titles |
| `--px-text-secondary` | Labels, secondary text, section labels |
| `--px-text-muted` | Hints, captions, metadata |
| `--px-text-faint` | Timestamps, placeholders (still ≥ 4.5:1) |
| `--px-accent-text` | Accent used as text (links, an active label). Never `--px-accent` for text: it fails contrast in light mode |
| `--px-bg` | Page background |
| `--px-bg-elevated` | Cards, popovers, secondary buttons |
| `--px-bg-inset` | Inputs, wells, code |
| `--px-surface-hover` / `--px-surface-active` / `--px-surface-selected` | Row and control states |
| `--px-border` / `--px-border-strong` | Edges of floating surfaces and inputs |
| `--px-divider` | Separation inside a surface |
| `--px-accent`, `--px-accent-hover`, `--px-accent-soft`, `--px-accent-faint` | Accent fills (the primary button, a selected chip) |
| `--px-text-on-accent` | Text on an accent fill (picked per accent for contrast) |
| `--px-danger`, `--px-success`, `--px-warning`, `--px-info` (+ `-soft`) | Status, sparingly |
| `--px-shadow-sm` / `-md` / `-lg` | Floating surfaces only |

Every token has a light-mode value. Test your surface in both (Settings › Appearance › Mode).

### 6.5 Type, space, radius, controls

**Type (`--px-text-*`):** `xs` 11 captions and timestamps · `sm` 12 secondary text, labels, buttons · `base` 13 body, rows, inputs · `md` 15 card and dialog titles · `lg` 18 section titles · `xl` 22 page titles. (`2xs` 10 exists for dense badges only.) Weights: 400 and 600.

**Space (`--px-space-*`):** 1 = 4px, 2 = 8, 3 = 12, 4 = 16, 5 = 20, 6 = 24, 8 = 32.

**Radius (`--px-radius-*`):** `sm` 4 controls and rows · `md` 6 cards and popovers · `lg` 10 large panels · `full` counts and avatars only.

**Control height (`--px-control-h*`):** 28 default · `-sm` 24 dense · `-xs` 22 panel toolbars · `-lg` 32 hero actions only.

**Menu sizes (`--px-menu-w-*`, `--px-menu-h-*`):** three steps, no more. `sm` 160 wide, 240 tall (a few short actions) · `md` 240 wide, 360 tall (the usual menu, the menu bar) · `lg` 320 wide, 480 tall (items with a second line; the widest any menu grows). Heights stop at the window. A menu is as wide as its items between `sm` and `lg`; `ContextMenu.show({ size })` sets its floor and height cap. A list longer than its cap scrolls; never set a menu's width or height in pixels.

### 6.6 Layout

1. Every tab starts with `createPageHeader`. Content below it, padded `--px-space-6` horizontally.
2. **Sidebar = navigation inside your tool**: its content (accounts, decks, folders, filters). Never the same destinations as your editor's own tabs, never a Settings row (settings live in the app's Settings, reached from the header's ⋯), never a full-width button at the bottom. The "new" action is a `+` icon button in the section label row.
3. One main column per view; side panels only when the content is a list → detail.
4. A view with nothing in it renders `createEmptyState`, centred in the area it describes.

### 6.7 Icons

1. Lucide ids via `api.icons.createIconHtml(id, size)`; 16px in rows and buttons, 14px in dense rows.
2. **One concept, one icon** across the app: `trash` for delete, `plus` for new, `settings` for settings, `refresh-cw` for refresh, `ellipsis` for more, `pencil` for rename, `px-ai-mark` for anything that calls the AI, and only for that.
3. Activity-bar icons are a single concrete noun: `wallet`, `image`, `folder`, `inbox`, `calendar`, `book-open`, `database`. Never `bot`, `sparkles` or `message-circle` (AI is the mark).
4. An icon of your own goes in the manifest (`contributes.icons`, Section 3.4), never inline in `main.js`: `id` like `px-<extId>`, Lucide-style markup in `currentColor`. It exists only while the extension runs and can never replace a core icon (a clash is skipped).

### 6.8 Copy

1. **Title Case for actions and titles** (buttons, menu items, tabs, page titles), with small joining words lowercase: `Add Account`, `Turn On`, `Import from CSV`, `Drawing and Painting`.
2. **Sentences for everything else**: hints, empty states, errors, toasts. End them with a period.
3. No exclamation marks, no emoji, no em dashes in labels, the ellipsis character `…` (not three dots) when an action opens a dialog.
4. Say each thing once. A button that is obvious needs no hint under it.
5. Never a dead end: a control that cannot run now says why in its tooltip and offers the fix in place (a "Turn On" action), not a toast after the click.

### 6.9 Quick reject test (before emitting)

Reject your own output if it contains any of: a `#` colour or `rgb(` with numbers; `font-size: <n>px`; `text-transform: uppercase`; `letter-spacing` on a label; an emoji; `confirm(` / `alert(` / `<select`; a hand-styled `<button>` where `api.ui.createButton` fits; more than one primary button in a view; `--vscode-*` or `--parallx-*` where a `--px-*` token exists.

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
- [ ] Buttons, page headers, empty states, section labels come from `api.ui` (6.3); no hand-styled chrome.
- [ ] Zero colour literals; every colour is a `--px-*` token (6.4); accent as text uses `--px-accent-text`.
- [ ] Zero pixel font sizes; every size is `--px-text-*` (6.5). No font-family set.
- [ ] No `text-transform: uppercase`, no letter-spaced labels.
- [ ] At most one primary button per view.
- [ ] Zero emoji; icons via `api.icons.createIconHtml`; AI shown only by `px-ai-mark`.
- [ ] No `confirm()` / `alert()` / `<select>`; the kit's modal and dropdown instead.
- [ ] Actions and titles in Title Case; hints and messages are sentences with a period.
- [ ] Checked in light mode as well as dark.

If any box is unchecked, fix the code before responding.

---

## 10. Quick API cheatsheet

```
api.commands.{registerCommand, executeCommand, getCommands}
api.views.{registerViewProvider, setBadge}
api.editors.{registerEditorProvider, openEditor, closeEditor, openFileEditor, setEditorStatus, openEditors, onDidChangeOpenEditors}
api.window.{showInformationMessage, showWarningMessage, showErrorMessage, showInputBox, showQuickPick,
            createOutputChannel, createStatusBarItem, activeColorTheme, onDidChangeActiveColorTheme, startDrag}
api.workspace.{getConfiguration, onDidChangeConfiguration, workspaceFolders, getWorkspaceFolder,
               onDidChangeWorkspaceFolders, onDidChangeWorkspace, onDidRename, onDidFilesChange,
               name, getCanvasPages, getCanvasPageTree, onDidChangeCanvasPages, listFiles, onDidMoveFiles, fs}
api.workspace.fs.{readFile, writeFile, stat, readdir, exists, rename, delete, mkdir}
api.context.{createContextKey, getContextValue}
api.icons.{getIcon, hasIcon, getAllIconIds, createIconHtml, getFileTypeIcon}
api.tools.{getAll, getById, isEnabled, setEnabled, onDidChangeEnablement,
           installFromFile, uninstall, onDidInstallTool, onDidUninstallTool, onDidChangeTools}
api.env.{appName, appVersion, toolPath, timeZone}
api.canvas.databases.{list, get, create, createPage, ensureColumns, listRows, addRow, updateRow, removeRow, onDidChange, open}
api.work.{createClock, createClockStatus, idleMinutes, dayOf, registerProvider, providers, onDidChangeProviders}
api.lm?.{getModels, sendChatRequest, registerProvider, onDidChangeModels, parseJson} // may be undefined
api.chat?.{createChatParticipant, registerTool, registerDropHandler,
           shownSession, onDidChangeShownSession}                                      // may be undefined
api.mcp?.{invokeTool, listTools}                                                     // may be undefined
api.cron?.{upsertJob, removeJob}                                                     // may be undefined
api.database?.{open, close, migrate, run, get, all, runTransaction, isOpen}          // external extensions only
context.{subscriptions, globalState, workspaceState, toolPath, toolUri}
```

End of guide.
