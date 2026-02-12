# Milestone 4 — File System, Explorer, and Interaction Surface

> **Authoritative Scope Notice**
>
> This document is the single source of truth for Milestone 4.
> All implementation must conform to the structures and boundaries defined here.
> VS Code source files are referenced strictly as inspiration and validation, not as scope drivers.
> Referenced material must not expand scope unless a missing core interaction is identified.
> Parallx is **not** a code IDE. It is a VS Code-like structural shell that hosts arbitrary domain-specific tools.
> All VS Code references are filtered through this lens — only structural, shell, and hosting patterns apply.

---

## Milestone Definition

### Vision
Parallx becomes a real working environment. A user can open a folder, browse its contents in the Explorer sidebar, open files as editor tabs, edit text, save changes, and manage their workspace — all through the same interaction patterns as VS Code. The File menu works. The Explorer works. Opening and saving files works.

### Purpose
Milestones 1–3 built the structural shell (layout, parts, grid), the extensibility platform (tools, API, lifecycle), and the polished UI layer (activity bar, keyboard routing, Quick Access). But the app has no content interaction. Every File menu item is either a stub or missing. The Explorer sidebar is a placeholder. Editors can't display real file content. This milestone closes that gap by building the **filesystem interaction layer** — the minimum set of capabilities that make the workbench feel like a functioning application rather than a demonstration shell.

This is deliberately scoped as a **vertical slice** — not a full IDE file system. It provides enough to make every major UI surface functional with real content, validating that three milestones of plumbing actually work end-to-end.

### Background — What Already Exists

**Infrastructure that M4 builds on top of:**
- **Electron IPC bridge** — `electron/main.cjs` already handles IPC for tool scanning (`tools:scan-directory`), window controls, and maximized state. The pattern for adding filesystem IPC is established.
- **Preload context bridge** — `electron/preload.cjs` exposes APIs to the renderer via `contextBridge.exposeInMainWorld()`. New filesystem APIs follow the same pattern.
- **Tool system** — Built-in tools use `parallx-manifest.json` + `activate(api, context)` pattern. The Explorer, text editor, and search are built as tools using the same API as third-party tools.
- **Editor system** — `EditorInput` (abstract, with dirty/save/serialize), `EditorPane` (abstract, with setInput/layout/dispose), `EditorGroupView` (tab bar, split, DnD), `EditorPart` (nested grid of groups). M2 added `ToolEditorInput` and `EditorsBridge` for tools to open editor tabs via `parallx.editors.openEditor()` and `parallx.editors.registerEditorProvider()`.
- **View system** — `ViewDescriptor` → `ViewManager` → `ViewContainer` pipeline. Tools contribute sidebar views via `contributes.views` manifest and implement them via `parallx.views.registerViewProvider()`.
- **Workspace model** — `Workspace` class has UUID identity, name, metadata. `addFolderToWorkspace` / `removeFolderFromWorkspace` exist as stub commands. `Workspace` does NOT yet have a `folders` array.
- **Command system** — Full command registration, execution, palette integration, keybinding dispatch (M3).
- **Quick Access** — Unified widget with `>` prefix (commands) and no-prefix mode (workspaces). M4 adds a file picker to no-prefix mode.
- **Status bar** — Contribution-based entries with `parallx.window.createStatusBarItem()`. Tools can add status entries.
- **Menu bar** — Registered via `TitlebarPart.registerMenuBarItem()` / `registerMenuBarDropdownItems()`. File menu exists but most items are non-functional.
- **Context keys** — 13+ structural keys tracked. M4 adds file/folder-related keys.
- **Activity bar** — `ActivityBarPart` with dynamic icon population, badge support, click-to-toggle.

**What does NOT exist:**
- No filesystem access from the renderer (beyond tool scanning IPC)
- No `Workspace.folders` array — the workspace model has no concept of open folders
- No file tree / Explorer view
- No concrete `FileEditorInput` backed by a real file
- No text editor pane that displays file content
- No save/save-as dialog integration
- No open-file/open-folder dialog integration
- No file watcher for external changes
- No file-related context keys (`resourceScheme`, `resourceExtname`, etc.)
- No encoding or line-ending detection
- No search/find-in-files

### Conceptual Scope

**Included**
- Electron IPC filesystem bridge (read, write, stat, readdir, watch, dialog)
- Filesystem service abstraction in the renderer
- Workspace folder model (add/remove folders, persist across sessions)
- Explorer built-in tool (folder tree, open editors list)
- File editor input backed by real files
- Plain text editor pane (textarea-based — not Monaco, not a code editor)
- File open/save/save-as dialogs wired to Electron
- File menu items wired to real commands
- File watcher for external modification detection
- Quick Access file picker (Ctrl+P shows files from workspace folders)
- File-related context keys and status bar entries
- Dirty state, save confirmation dialogs, revert

**Excluded**
- Syntax highlighting or code intelligence (Parallx is not a code IDE)
- Rich text editing or WYSIWYG editors
- Monaco editor integration (deferred — too heavy for M4)
- Git/SCM integration (deferred)
- File search/replace across files (deferred — Ctrl+Shift+F)
- Remote filesystem or network files
- File decorations (git status colors, etc.)
- Binary file viewers (images, PDFs, etc.)
- File encoding conversion UI
- Drag-and-drop files from OS into Parallx
- Multi-root workspace `.code-workspace` file format
- Breadcrumb navigation in editor

### Structural Commitments
- All filesystem access goes through the Electron IPC bridge — the renderer never has direct Node.js `fs` access.
- The filesystem service is an abstraction — future milestones can swap in remote/virtual filesystems without changing consumers.
- **All resources are identified by URI objects** — `{ scheme: string, authority: string, path: string }`. In M4, all URIs use `file://` scheme, but the abstraction exists from day one so consumers never assume local filesystem. The IPC bridge resolves `file://` URIs to local paths internally.
- The Explorer is a built-in tool using the same API as external tools — no special-casing.
- File editors use the existing `EditorInput` / `EditorPane` system from M1 — no parallel editor infrastructure.
- Workspace folders are first-class state — they persist across sessions and are exposed through the API.
- All file operations are async and cancellable where possible.
- **Text file models are managed centrally** — a `TextFileModelManager` tracks open text files, their dirty state, and content. This is the source of truth for dirty state, not individual editor inputs. Multiple editors viewing the same file share one model.

### Architectural Principles
- **IPC Boundary**: All filesystem calls cross the Electron IPC bridge. The renderer is a pure UI layer.
- **URI Addressing**: All resources are identified by URI objects (`{ scheme, authority, path }`), not string paths. The IPC bridge resolves `file://` URIs to local paths. This matches VS Code's `URI` model and enables future provider routing.
- **Service Abstraction**: Consumers depend on `IFileService`, not on Electron APIs directly. `IFileService` is designed as a provider facade — M4 has one provider (disk/IPC), but the interface supports registering additional providers by URI scheme.
- **Text Model Layer**: A `TextFileModelManager` sits between `IFileService` (raw bytes) and editors (text panes). It manages in-memory text models per URI, centralizes dirty state, and enables features like "Save All" and multi-view-of-same-file. This mirrors VS Code's `ITextFileService`.
- **Tool Symmetry**: Explorer, text editor, and related views are built-in tools using `parallx.*` API.
- **Workspace Ownership**: The workspace model owns the "what folders are open" state. The Explorer tool renders that state.
- **Editor Reuse**: File editors extend the existing `EditorInput`/`EditorPane` system, not a new system. `FileEditorInput` registers with the editor resolver so the system knows which pane to use for file URIs.
- **WorkbenchState**: The workspace tracks its state as EMPTY (no folder opened), FOLDER (single folder), or WORKSPACE (multi-root, deferred). This affects UI behavior — Explorer shows a welcome prompt in EMPTY state, tree in FOLDER state.

### VS Code Reference (Curated — Verified Against Source)

> These references were validated by examining the actual VS Code GitHub repository and DeepWiki documentation during M4 drafting. Each path has been confirmed to exist and the described role has been verified.

**Platform Layer (file system foundation):**
- `src/vs/platform/files/common/files.ts` — `IFileService` interface, `IFileSystemProvider`, `FileType`, `FileSystemProviderCapabilities`, error codes (`FileSystemProviderErrorCode`)
- `src/vs/platform/files/common/fileService.ts` — `FileService` class: facade that routes operations to registered `IFileSystemProvider` instances by URI scheme
- `src/vs/platform/files/node/diskFileSystemProvider.ts` — `DiskFileSystemProvider`: implements `IFileSystemProvider` for local `file://` scheme using Node.js `fs` APIs
- `src/vs/platform/workspace/common/workspace.ts` — `IWorkspaceContextService`, `IWorkspace`, `WorkspaceFolder = { uri, name, index }`, `WorkbenchState` enum (EMPTY, FOLDER, WORKSPACE)

**Workbench Layer (editor system):**
- `src/vs/workbench/common/editor.ts` — `EditorInput` base class, `EditorInputCapabilities` flags
- `src/vs/workbench/services/editor/browser/editorService.ts` — `EditorService`: central coordinator for opening/closing editors
- `src/vs/workbench/services/editor/browser/editorResolverService.ts` — `EditorResolverService`: maps `EditorInput` types to `EditorPane` implementations (the router)
- `src/vs/workbench/browser/parts/editor/editorGroupView.ts` — `EditorGroupView`: tab bar, pane management, model state
- `src/vs/workbench/browser/parts/editor/editorPart.ts` — `EditorPart`: manages grid of `EditorGroupView` instances

**Files Contribution (Explorer + file editors):**
- `src/vs/workbench/contrib/files/browser/explorerViewlet.ts` — `ExplorerViewPaneContainer`: sidebar container for Explorer
- `src/vs/workbench/contrib/files/browser/views/explorerView.ts` — `ExplorerView`: file tree using `WorkbenchCompressibleAsyncDataTree<ExplorerItem>`
- `src/vs/workbench/contrib/files/browser/views/explorerViewer.ts` — Tree renderers, data source, filter, drag-and-drop, compression delegate
- `src/vs/workbench/contrib/files/common/files.ts` — Constants (`VIEWLET_ID`, `VIEW_ID`), context keys (`ExplorerFolderContext`, `ExplorerRootContext`, `ExplorerFocusedContext`, etc.)
- `src/vs/workbench/contrib/files/browser/editors/fileEditorInput.ts` — `FileEditorInput`: editor input backed by a file URI
- `src/vs/workbench/contrib/files/browser/files.contribution.ts` — Registers `FileEditorInput`, `BinaryFileEditor`, configuration schemas
- `src/vs/workbench/contrib/files/browser/fileCommands.ts` — Save, revert, open file/folder, reveal in explorer commands
- `src/vs/workbench/contrib/files/browser/fileActions.contribution.ts` — Context menus for Explorer, Open Editors, editor title

**Text File Service (critical intermediate layer):**
- `src/vs/workbench/services/textfile/common/textFileService.ts` — `ITextFileService`: manages text file models between `IFileService` (raw bytes) and editors. Handles encoding detection, dirty tracking per resource, save conflict detection (etag-based), auto-save, hot exit.
- `src/vs/workbench/services/textfile/common/textFileEditorModel.ts` — `TextFileEditorModel`: in-memory model wrapping a text resource with dirty state, content, encoding, save lifecycle.

**Context Keys (verified from source):**
- `src/vs/workbench/common/contextkeys.ts` — `DirtyWorkingCopiesContext`, `WorkbenchStateContext`, `WorkspaceFolderCountContext`, `ActiveEditorCanRevertContext`, `ActiveEditorContext`, `ResourceContextKey` (composite: scheme, filename, extname, dirname, path)

**DeepWiki:**
- [Source Code Layers](https://deepwiki.com/microsoft/vscode-wiki/4.1-source-code-layers) — Layer hierarchy, dependency rules, service injection
- [Layout System and Editor Management](https://deepwiki.com/microsoft/vscode/3.2-editor-features-and-contributions) — EditorPart, EditorGroupView, EditorService, EditorResolverService
- [Workspaces and Multi-root](https://deepwiki.com/microsoft/vscode-docs/6.3-workspaces-and-multi-root) — Workspace folder model, virtual workspaces
- [VS Code Wiki: Source Code Organization](https://github.com/microsoft/vscode/wiki/source-code-organization) — Definitive guide to layer rules and contribution patterns

### VS Code Alignment Audit

> This section documents where Parallx M4 aligns with VS Code's actual architecture and where it deliberately deviates. Deviations are marked as **intentional** (simplification appropriate for M4 scope) or **corrective** (spec updated to fix a gap).

**✅ Aligned — no changes needed:**
- Layer architecture (base → platform → workbench) matches VS Code's dependency hierarchy
- Explorer as a workbench contribution using core APIs — equivalent to our "built-in tool" pattern
- `EditorInput` → resolver → `EditorPane` pipeline matches our M1/M2 editor system
- `WorkspaceFolder = { uri, name, index }` matches exactly
- Context key patterns match (resource keys, folder count, dirty state)
- File watcher push pattern (subscribe → receive events) matches
- Dirty state / save confirmation / revert lifecycle matches

**⚠️ Corrected in this spec (gaps found during audit):**
1. **URI-based resource identifiers** — VS Code identifies all resources by `URI`, not string paths. All `IFileService` methods accept `URI` objects. Our spec now requires URI objects throughout (even though all URIs are `file://` in M4). See Structural Commitment below.
2. **TextFileModelManager** — VS Code has `ITextFileService` as a critical layer between `IFileService` (raw bytes) and editors (text models). It manages per-resource dirty state, encoding, save conflicts, and model lifecycle. Without this, opening the same file in two editor groups would have independent dirty states. Our spec now includes a lightweight equivalent. See Capability 1 additions.
3. **Editor resolver registration** — VS Code's `EditorResolverService` maps input types to pane implementations. Our built-in text editor tool must register via `parallx.editors.registerEditorProvider()` with a glob/scheme matcher. Made explicit in Capability 4.
4. **WorkbenchState** — VS Code distinguishes EMPTY (no folder) vs FOLDER (single) vs WORKSPACE (multi-root). This affects Explorer welcome screen and menu enablement. Added to Capability 2.

**⚠️ Intentional deviations (acceptable for M4 scope):**
- **No provider registration pattern** — VS Code routes filesystem operations to `IFileSystemProvider` instances by URI scheme. We use direct IPC to the main process. The `IFileService` interface is designed so providers can be added later.
- **Simple tree** — VS Code uses `WorkbenchCompressibleAsyncDataTree` with folder compression, virtualized rendering, and file icon themes. We use a simpler tree. VS Code's tree features can be adopted incrementally.
- **`<textarea>` editor** — VS Code uses Monaco. We use a plain textarea. The `EditorPane` abstraction means Monaco can be swapped in later without changing `FileEditorInput` or the editor service.
- **Main-process watchers** — VS Code runs file watchers in isolated utility processes. We run them in the main process. This is acceptable for M4's modest scale.
- **No save conflict detection** — VS Code uses etag-based conflict detection. We rely on mtime comparison. Full etag support deferred.
- **No hot exit** — VS Code remembers unsaved files across sessions. Deferred.

---

## Capability 0 — Filesystem IPC Bridge

### Capability Description
The Electron main process provides a filesystem API to the renderer via IPC. This is the foundation for all file operations — reading, writing, watching, and dialog access.

### Goals
- Renderer can read/write/stat/list files through a well-defined async API
- File dialogs (open file, open folder, save as) are accessible from the renderer
- File watching notifies the renderer of external changes
- Error handling is consistent and informative
- Security: only whitelisted operations are exposed, no arbitrary code execution

### Conceptual Responsibilities
- Define IPC channel contracts for filesystem operations
- Implement main-process handlers using Node.js `fs/promises`
- Expose typed API through preload context bridge
- Handle errors, permissions, and edge cases (symlinks, large files, binary detection)

### Dependencies
- Existing Electron shell from M1

### VS Code Reference
- `src/vs/platform/files/node/diskFileSystemProvider.ts` — Node.js filesystem operations
- `src/vs/platform/files/common/files.ts` — `IFileService`, `FileType`, `FileSystemProviderCapabilities`

#### Tasks

**Task 0.1 — Implement Filesystem IPC Handlers in Main Process** ✅
- **Task Description:** Add IPC handlers to `electron/main.cjs` for core filesystem operations.
- **Implementation Notes:** Added 9 IPC handlers (fs:readFile, fs:writeFile, fs:stat, fs:readdir, fs:exists, fs:rename, fs:delete, fs:mkdir, fs:copy) to main.cjs using fs/promises. Includes 50MB size guard, binary detection (first 8KB null-byte scan), structured error normalization, readdir sorts dirs-first then alpha case-insensitive, delete defaults to shell.trashItem(), mkdir/writeFile create parent dirs recursively.
- **Output:** IPC handlers for file CRUD, directory listing, stat, and file watching.
- **Completion Criteria:**
  - `fs:readFile(path, encoding?)` — reads file content, returns string (utf-8 default) or base64 for binary; rejects for files > 50MB with clear error
  - `fs:writeFile(path, content, encoding?)` — writes content to file, creates parent directories if needed (`mkdir -p` equivalent)
  - `fs:stat(path)` — returns `{ type: 'file'|'directory'|'symlink', size, mtime, ctime, isReadonly }`
  - `fs:readdir(path)` — returns `[{ name, type, size, mtime }]` sorted: directories first, then alphabetical
  - `fs:exists(path)` — returns boolean
  - `fs:rename(path, newPath)` — renames/moves a file or directory
  - `fs:delete(path, options?)` — deletes file or directory (recursive option for directories); moves to OS trash by default via `shell.trashItem()`
  - `fs:mkdir(path)` — creates directory (recursive)
  - `fs:copy(source, destination)` — copies file or directory
  - All handlers use `fs/promises` (async, non-blocking) — no sync filesystem calls
  - All handlers validate paths are absolute and within allowed roots (no path traversal above workspace folders)
  - Errors return structured `{ code: string, message: string, path: string }` objects
- **Notes / Constraints:**
  - Error codes: `ENOENT`, `EACCES`, `EEXIST`, `EISDIR`, `ENOTDIR`, `ENOTEMPTY`, `ETOOLARGE`
  - Binary detection: check first 8KB for null bytes; if binary, `readFile` returns base64 with `{ encoding: 'base64' }` flag
  - Large file guard: files > 50MB are rejected with `ETOOLARGE` to prevent renderer memory issues
  - File encoding: default utf-8; future milestone can add encoding detection

**Task 0.2 — Implement File Dialog IPC Handlers** ✅
- **Task Description:** Add IPC handlers for native OS file dialogs.
- **Implementation Notes:** Added 4 dialog IPC handlers (dialog:openFile, dialog:openFolder, dialog:saveFile, dialog:showMessageBox) using electron.dialog API. All modal to mainWindow. Cancel returns null. Default path falls back to user home.
- **Output:** IPC handlers for open file, open folder, and save-as dialogs.
- **Completion Criteria:**
  - `dialog:openFile(options?)` — opens native file picker, returns `string[]` (selected paths) or `null` if cancelled; options: `filters` (e.g., `[{ name: 'Text', extensions: ['txt', 'md'] }]`), `multiSelect: boolean`, `defaultPath: string`
  - `dialog:openFolder(options?)` — opens native folder picker, returns `string[]` or `null`; options: `multiSelect: boolean`, `defaultPath: string`
  - `dialog:saveFile(options?)` — opens native save dialog, returns `string` (chosen path) or `null`; options: `filters`, `defaultPath`, `defaultName`
  - `dialog:showMessageBox(options)` — opens native message box (for "Save before closing?" prompts), returns `{ response: number, checkboxChecked: boolean }`
  - Dialogs are modal to the Parallx window (pass `BrowserWindow` reference)
  - Cancel always returns `null`, never throws
- **Notes / Constraints:**
  - Uses `electron.dialog.showOpenDialog()`, `showSaveDialog()`, `showMessageBox()`
  - Default path should be current workspace folder (if any) or user's home directory
  - File filters follow Electron's `FileFilter` format

**Task 0.3 — Implement File Watcher IPC** ✅
- **Task Description:** Add IPC handlers for filesystem watching so the renderer is notified of external file changes.
- **Implementation Notes:** Added fs:watch and fs:unwatch handlers using fsSync.watch() with recursive option. 100ms debounce with event coalescing. Ignores .git/node_modules/.DS_Store/Thumbs.db/__pycache__. Max 10 watchers with ELIMIT error. Auto-unwatch on error. Cleanup on before-quit. Push events via mainWindow.webContents.send('fs:change').
- **Output:** File watcher IPC with subscribe/unsubscribe pattern.
- **Completion Criteria:**
  - `fs:watch(path, options?)` — starts watching a file or directory for changes; returns a `watchId` string
  - `fs:unwatch(watchId)` — stops watching
  - Changes are pushed to the renderer via IPC event `fs:change` with payload `{ watchId, events: [{ type: 'created'|'changed'|'deleted', path }] }`
  - Directory watching is recursive by default (watches entire subtree)
  - Watcher debounces rapid changes (100ms coalesce window)
  - Watcher ignores common noise: `.git/`, `node_modules/`, `.DS_Store`, `Thumbs.db`
  - All watchers are cleaned up on window close
  - Maximum of 10 active watchers (prevents resource exhaustion)
- **Notes / Constraints:**
  - Uses `fs.watch()` or `chokidar` (if added as dependency) for cross-platform compatibility
  - `fs.watch()` has known quirks on macOS/Linux — consider `chokidar` for reliability
  - Watcher events include the absolute path of the changed file
  - Watcher errors (e.g., watched directory deleted) send an error event and auto-unwatch

**Task 0.4 — Expose Filesystem API via Preload Context Bridge** ✅
- **Task Description:** Extend `electron/preload.cjs` to expose all filesystem and dialog APIs to the renderer.
- **Implementation Notes:** Extended preload.cjs with parallxElectron.fs.* (12 methods including onDidChange) and parallxElectron.dialog.* (4 methods). Updated Window interface in main.ts with full TypeScript types for all new APIs. onDidChange returns unsubscribe function. All methods async via ipcRenderer.invoke().
- **Output:** `window.parallxElectron` extended with filesystem methods.
- **Completion Criteria:**
  - `parallxElectron.fs.readFile(path, encoding?)` → Promise
  - `parallxElectron.fs.writeFile(path, content, encoding?)` → Promise
  - `parallxElectron.fs.stat(path)` → Promise
  - `parallxElectron.fs.readdir(path)` → Promise
  - `parallxElectron.fs.exists(path)` → Promise
  - `parallxElectron.fs.rename(path, newPath)` → Promise
  - `parallxElectron.fs.delete(path, options?)` → Promise
  - `parallxElectron.fs.mkdir(path)` → Promise
  - `parallxElectron.fs.copy(source, dest)` → Promise
  - `parallxElectron.dialog.openFile(options?)` → Promise
  - `parallxElectron.dialog.openFolder(options?)` → Promise
  - `parallxElectron.dialog.saveFile(options?)` → Promise
  - `parallxElectron.dialog.showMessageBox(options)` → Promise
  - `parallxElectron.fs.watch(path, options?)` → Promise<string> (watchId)
  - `parallxElectron.fs.unwatch(watchId)` → Promise
  - `parallxElectron.fs.onDidChange(callback)` → unsubscribe function
  - TypeScript types updated in renderer for `window.parallxElectron` interface
- **Notes / Constraints:**
  - All methods are async (return Promises)
  - Type definition file `src/platform/electronApi.d.ts` (or similar) provides TypeScript types for `parallxElectron`
  - Follows same pattern as existing `parallxElectron.minimize()`, `parallxElectron.maximize()`, etc.

---

## Capability 1 — Filesystem Service

### Capability Description
A renderer-side service abstraction over the Electron filesystem IPC. Consumers (tools, editors, workspace) depend on `IFileService` rather than calling `parallxElectron.fs.*` directly. This enables future backends (virtual FS, remote FS) and provides a single place for caching, error normalization, and event aggregation.

### Goals
- Single service interface for all filesystem operations
- Decoupled from Electron — interface could be backed by any provider
- Events for file create/change/delete propagated to subscribers
- File content caching for recently read files
- Registered in DI container

### Dependencies
- Capability 0 (Filesystem IPC Bridge)

### VS Code Reference
- `src/vs/platform/files/common/fileService.ts` — `FileService` class
- `src/vs/platform/files/common/files.ts` — `IFileService`, `IFileSystemProvider`, `FileType`

#### Tasks

**Task 1.1 — Define IFileService Interface and URI Type** ✅
- **Task Description:** Define the filesystem service interface that all consumers depend on, along with the URI type used throughout the system.
- **Implementation Notes:** Created URI class in src/platform/uri.ts (static factories: file(), parse(), from(), revive(); instance: fsPath, with(), toString(), toJSON(), basename, extname, dirname, joinPath, equals(), toKey(); plus URIMap utility). Created fileTypes.ts with FileType, FileChangeType, FileStat, FileContent, FileEntry, FileChangeEvent, FileOperationError, FileDeleteOptions, dialog types. Added IFileService and ITextFileModelManager interfaces to serviceTypes.ts.
- **Output:** `IFileService` interface in `src/services/serviceTypes.ts`, `URI` class in `src/platform/uri.ts`, and types in `src/platform/fileTypes.ts`.
- **Completion Criteria:**
  - `URI` class with `scheme: string`, `authority: string`, `path: string`, `query: string`, `fragment: string`
  - Static factory methods: `URI.file(path)` (creates `file://` URI), `URI.parse(string)`, `URI.from({ scheme, path, ... })`
  - Instance methods: `toString()`, `with({ scheme?, path?, ... })`, `fsPath` getter (for `file://` URIs only — returns local path)
  - `readFile(uri: URI): Promise<FileContent>` — `FileContent = { content: string, encoding: string, size: number, mtime: number }`
  - `writeFile(uri: URI, content: string): Promise<void>`
  - `stat(uri: URI): Promise<FileStat>` — `FileStat = { type: FileType, size, mtime, ctime, isReadonly, uri }`
  - `readdir(uri: URI): Promise<FileEntry[]>` — `FileEntry = { name, uri: URI, type: FileType, size, mtime }`
  - `exists(uri: URI): Promise<boolean>`
  - `rename(source: URI, target: URI): Promise<void>`
  - `delete(uri: URI, options?: { recursive?: boolean, useTrash?: boolean }): Promise<void>`
  - `mkdir(uri: URI): Promise<void>`
  - `copy(source: URI, target: URI): Promise<void>`
  - `watch(uri: URI): Promise<IDisposable>` — returns disposable that stops watching
  - `onDidFileChange: Event<FileChangeEvent[]>` — `FileChangeEvent = { type: FileChangeType, uri: URI }`
  - `FileType` enum: `File`, `Directory`, `SymbolicLink`, `Unknown`
  - `FileChangeType` enum: `Created`, `Changed`, `Deleted`
  - Service identifier: `IFileService` in `serviceTypes.ts`
- **Notes / Constraints:**
  - All consumers use `URI` objects, never raw string paths — this matches VS Code's pattern
  - The IPC bridge internally resolves `file://` URIs to local paths via `uri.fsPath`
  - Interface is designed as a provider facade — M4 has one provider (disk), but `registerProvider(scheme, provider)` method exists on the interface for future extensibility
  - Convenience: `URI.file('/path/to/file')` creates `{ scheme: 'file', authority: '', path: '/path/to/file' }`

**Task 1.2 — Implement FileService** ✅
- **Task Description:** Implement the filesystem service backed by the Electron IPC bridge.
- **Implementation Notes:** Created FileService in src/services/fileService.ts. Delegates to parallxElectron.fs.* and dialog.* APIs. Includes LRU content cache (20 entries, invalidated on change events), watcher lifecycle management, URI-based interface, structured error normalization via FileOperationError, graceful degradation when Electron bridge unavailable. Registered as singleton in workbenchServices.ts.
- **Output:** `FileService` class in `src/services/fileService.ts`.
- **Completion Criteria:**
  - Implements `IFileService` interface
  - Delegates all operations to `parallxElectron.fs.*` and `parallxElectron.dialog.*`
  - Normalizes errors into consistent `FileOperationError` types with `code` and `message`
  - Aggregates file watcher events through `onDidFileChange` emitter
  - Manages watcher lifecycle (auto-unwatch on dispose)
  - Simple LRU content cache for recently read files (max 20 entries, evicts on memory pressure or file change)
  - Cache is invalidated when a file change event is received for that URI
  - Registered in DI container via `workbenchServices.ts`
  - Graceful degradation: if `parallxElectron.fs` is not available (browser context), all methods throw with clear "filesystem not available" error
- **Notes / Constraints:**
  - The service is a singleton — one instance for the lifetime of the workbench
  - Watcher management: maintains a Map of active watchers, disposes all on service dispose
  - Dialog methods are pass-through to `parallxElectron.dialog.*` with default path injection

**Task 1.3 — Extend Parallx Tool API with Filesystem Access** ✅
- **Task Description:** Add `parallx.workspace.fs` namespace to the tool API so tools can access the filesystem.
- **Implementation Notes:** Created FileSystemBridge in src/api/bridges/fileSystemBridge.ts. Provides readFile, writeFile, stat, readdir, exists, delete, rename, createDirectory. All operations scoped to workspace folders (validates URI against folder list). Bridge validates tool is active before every call (_throwIfDisposed).
- **Output:** Updated `parallx.d.ts` and new `FileSystemBridge` in `src/api/bridges/`.
- **Completion Criteria:**
  - `parallx.workspace.fs.readFile(uri)` → Promise<string>
  - `parallx.workspace.fs.writeFile(uri, content)` → Promise<void>
  - `parallx.workspace.fs.stat(uri)` → Promise<FileStat>
  - `parallx.workspace.fs.readdir(uri)` → Promise<FileEntry[]>
  - `parallx.workspace.fs.exists(uri)` → Promise<boolean>
  - `parallx.workspace.fs.delete(uri)` → Promise<void>
  - `parallx.workspace.fs.rename(source, target)` → Promise<void>
  - `parallx.workspace.fs.createDirectory(uri)` → Promise<void>
  - All operations scoped: tools can only access files within workspace folders (enforced by bridge)
  - Bridge validates tool is active before every call (`_throwIfDisposed()`)
- **Notes / Constraints:**
  - Tools should NOT get unbounded filesystem access — scope to workspace folders
  - This mirrors VS Code's `vscode.workspace.fs` namespace
  - Copy operation intentionally excluded from tool API in M4 (tools can read+write to achieve it)

**Task 1.4 — Implement TextFileModelManager** ✅
- **Task Description:** Add a lightweight text file model manager that sits between `IFileService` (raw bytes) and editors (text panes).
- **Implementation Notes:** Created TextFileModelManager and TextFileModel in src/services/textFileModelManager.ts. TextFileModel: uri, content, isDirty, isConflicted, mtime, updateContent(), save(), revert(), ref-counted lifecycle, events (onDidChangeContent, onDidChangeDirty, onDidChangeConflicted, onDidDispose). Manager: resolve() (get-or-create with ref count), get(), models, saveAll(), reacts to IFileService.onDidFileChange (silent reload if clean, conflict if dirty). Registered in workbenchServices.ts. This is the central authority for text file dirty state, content, and model lifecycle. It mirrors VS Code's `ITextFileService` in simplified form.
- **Output:** `TextFileModelManager` class in `src/services/textFileModelManager.ts`, `ITextFileModelManager` interface in `serviceTypes.ts`.
- **Completion Criteria:**
  - `resolve(uri: URI): Promise<TextFileModel>` — loads file content from `IFileService`, creates or returns existing model
  - `get(uri: URI): TextFileModel | undefined` — returns existing model without loading (for checks like "is this file already open?")
  - `models: readonly TextFileModel[]` — all currently managed models
  - `onDidCreate: Event<TextFileModel>` — new model created
  - `onDidDispose: Event<URI>` — model disposed
  - `saveAll(): Promise<void>` — saves all dirty models (enables "Save All" command)
  - `TextFileModel` class:
    - `uri: URI` — identity
    - `content: string` — current text content (may differ from disk if dirty)
    - `isDirty: boolean` — true if content has been modified since last save/load
    - `mtime: number` — last known modification time from disk
    - `isConflicted: boolean` — true if external change detected while dirty
    - `onDidChangeContent: Event<void>` — content was modified
    - `onDidChangeDirty: Event<boolean>` — dirty state changed
    - `onDidChangeConflicted: Event<boolean>` — conflict state changed
    - `updateContent(newContent: string): void` — sets content, marks dirty
    - `save(): Promise<void>` — writes to disk via `IFileService`, updates mtime, clears dirty
    - `revert(): Promise<void>` — reloads from disk, clears dirty
    - `dispose(): void` — removes from manager
  - When `IFileService.onDidFileChange` fires for a managed URI:
    - If model is NOT dirty: silently reload content (keeps editor in sync with disk)
    - If model IS dirty: set `isConflicted = true` (user decides via save/revert)
  - Models are ref-counted: first `resolve()` creates, last `dispose()` destroys
  - Registered in DI container
- **Notes / Constraints:**
  - This is deliberately simpler than VS Code's `TextFileEditorModel` — no encoding conversion, no backup/hot exit, no auto-save scheduler
  - The key value: `FileEditorInput` instances for the same URI share one `TextFileModel`, so dirty state is consistent across split views
  - The manager does NOT load all workspace files — only files that are opened in editors
  - VS Code reference: `src/vs/workbench/services/textfile/common/textFileEditorModel.ts`

---

## Capability 2 — Workspace Folder Model

### Capability Description
The workspace model gains a `folders` array that represents the directories the user has opened. Folders can be added, removed, and persisted. This is the data model that the Explorer renders and that file operations scope to.

### Goals
- Workspace tracks zero or more root folders
- Folders are persisted across sessions
- Adding/removing folders fires events
- Workspace state is reflected in context keys and window title
- The stub commands `addFolderToWorkspace` and `removeFolderFromWorkspace` become functional

### Dependencies
- Capability 1 (FileService — for validating folder paths exist)

### VS Code Reference
- `src/vs/platform/workspace/common/workspace.ts` — `IWorkspace`, `IWorkspaceFolder`
- `src/vs/workbench/services/workspaces/common/workspaceEditing.ts` — Add/remove folder operations

#### Tasks

**Task 2.1 — Extend Workspace Model with Folders** ✅
- **Task Description:** Add a `folders` array to the `Workspace` class and update serialization.
- **Output:** `Workspace.folders` property with add/remove/reorder methods, plus `WorkbenchState` tracking.
- **Completion Criteria:**
  - `Workspace` gains `folders: readonly WorkspaceFolder[]` property — `WorkspaceFolder = { uri: URI, name: string, index: number }`
  - `Workspace.state: WorkbenchState` — enum `EMPTY` (no folder), `FOLDER` (single folder); `WORKSPACE` (multi-root) is reserved but not implemented in M4
  - `addFolder(uri: URI, name?: string): WorkspaceFolder` — adds a folder, name defaults to directory basename
  - `removeFolder(uri: URI): boolean` — removes a folder by URI
  - `reorderFolders(uris: URI[]): void` — reorders folders to match the given URI order
  - `onDidChangeFolders: Event<WorkspaceFoldersChangeEvent>` — fires with `{ added, removed }` arrays
  - `onDidChangeState: Event<WorkbenchState>` — fires when state changes (e.g., EMPTY → FOLDER)
  - Folders are serialized as part of workspace state (in `WorkspaceState` schema — new `folders` field, stored as `{ scheme, path, name }[]`)
  - Folders are restored from workspace state on load
  - Duplicate folder URIs are rejected (no adding the same folder twice)
  - Empty folder list is valid (EMPTY state)
  - `WorkbenchState` automatically derived: 0 folders = EMPTY, 1+ folders = FOLDER
- **Notes / Constraints:**
  - `WorkspaceFolder.name` can be customized by the user (defaults to directory basename)
  - `WorkspaceFolder.uri` is a `URI` object (typically `file://` scheme in M4)
  - This extends the existing `Workspace` class, not a new class
  - VS Code reference: `WorkbenchState` in `src/vs/platform/workspace/common/workspace.ts`
  - `WorkbenchState.EMPTY` drives Explorer to show "Open Folder" welcome screen instead of tree

**Task 2.2 — Wire Workspace Folder Commands** ✅
- **Task Description:** Connect the existing stub commands to real implementations using the new folder model and Electron dialogs.
- **Output:** Functional `addFolderToWorkspace`, `removeFolderFromWorkspace`, `openFolder`, `closeFolder` commands.
- **Completion Criteria:**
  - `workspace.addFolderToWorkspace` — opens native folder picker (`dialog:openFolder`), adds selected folder to workspace, saves state
  - `workspace.removeFolderFromWorkspace` — removes specified folder from workspace (if present), saves state; if no folder specified, shows Quick Pick with current folders
  - `workspace.openFolder` — opens native folder picker, creates new workspace with that folder (or replaces current single-folder workspace), saves state
  - `workspace.closeFolder` — clears all folders from workspace, resets to empty state
  - `file.openFile` — opens native file picker (`dialog:openFile`), opens selected file(s) as editor tabs
  - `file.newTextFile` — creates a new untitled editor tab with empty content (unsaved, no backing file)
  - `file.save` — saves the active editor's content to its file (or triggers save-as if untitled)
  - `file.saveAs` — opens native save dialog, saves active editor content to chosen path
  - `file.revert` — reloads active editor content from disk, discarding changes (with confirmation if dirty)
  - All commands validate preconditions (e.g., `file.save` requires an active editor with dirty state)
  - All commands update context keys and trigger workspace save after completion
- **Notes / Constraints:**
  - These commands wire into the existing File menu items from M3 Cap 1
  - `openFolder` in VS Code replaces the current workspace; `addFolderToWorkspace` adds to it — preserve this distinction
  - When the last folder is removed, the workspace is "empty" but still exists (like VS Code's "untitled workspace")

**Task 2.3 — Update Context Keys and Window Title for Folders** ✅
- **Task Description:** Add folder-related context keys and update the window title to reflect open folders.
- **Output:** New context keys and reactive window title.
- **Completion Criteria:**
  - Context key `workspaceFolderCount` — number of folders in workspace (0 = empty)
  - Context key `workspaceHasFolder` — boolean, true if at least one folder is open
  - Context key `workbenchState` — string value: `'empty'` or `'folder'` (matches VS Code's `WorkbenchStateContext`)
  - Context key `resourceScheme` — scheme of the active editor's resource (e.g., `file`, `untitled`)
  - Context key `resourceExtname` — extension of the active editor's file (e.g., `.ts`, `.md`)
  - Context key `resourceFilename` — filename of the active editor's file
  - Context key `activeEditorIsDirty` — (already exists from M3 as `activeEditorDirty`; verify working with file editors)
  - Window title format updates: `{dirty}{filename} — {folderName} — Parallx` (single folder) or `{dirty}{filename} — {workspaceName} — Parallx` (multi-folder or no folder)
  - When no editor is open: `{folderName} — Parallx` or `{workspaceName} — Parallx`
  - `{dirty}` prefix is `● ` (dot + space) when active editor has unsaved changes
- **Notes / Constraints:**
  - These context keys enable when-clause conditions like `when: "resourceExtname == .md"` for future tool contributions
  - Title format matches VS Code's default `window.title` template

**Task 2.4 — Expose Workspace Folders in Tool API** ✅
- **Task Description:** Extend `parallx.workspace` API with folder access.
- **Output:** Updated `parallx.d.ts` and workspace bridge.
- **Completion Criteria:**
  - `parallx.workspace.workspaceFolders` — readonly array of `{ uri, name, index }` (or `undefined` if no workspace)
  - `parallx.workspace.getWorkspaceFolder(uri)` — returns the workspace folder that contains the given URI (or `undefined`)
  - `parallx.workspace.onDidChangeWorkspaceFolders` — event fires when folders are added/removed
  - `parallx.workspace.name` — workspace name (first folder name, or workspace identity name)
- **Notes / Constraints:**
  - Mirrors VS Code's `vscode.workspace.workspaceFolders` API
  - Tools should be able to discover what folders are open to scope their operations

---

## Capability 3 — Explorer Built-In Tool

### Capability Description
A built-in Explorer tool provides the file tree view in the sidebar, matching VS Code's Explorer functionality. It shows the folder structure of all workspace folders, supports file/folder CRUD operations, and opening files in the editor.

### Goals
- File tree renders all workspace folders with expandable/collapsible directory nodes
- Single-click previews a file (opens as preview tab); double-click pins it
- Right-click context menu with file operations (new file, new folder, rename, delete)
- Tree updates reactively when files change on disk
- Explorer is the first sidebar view (top of activity bar)

### Dependencies
- Capability 1 (FileService)
- Capability 2 (Workspace Folder Model)

### VS Code Reference
- `src/vs/workbench/contrib/files/browser/views/explorerViewer.ts` — File tree rendering
- `src/vs/workbench/contrib/files/browser/explorerService.ts` — Explorer state management
- `src/vs/workbench/contrib/files/browser/fileActions.ts` — File CRUD actions

#### Tasks

**Task 3.1 — Implement Explorer Tool Manifest and Activation**
- **Task Description:** Create the built-in Explorer tool with manifest, entry point, and sidebar view contribution.
- **Output:** `src/built-in/explorer/parallx-manifest.json` and `src/built-in/explorer/main.ts`.
- **Completion Criteria:**
  - Manifest declares: identity (`parallx.explorer`), `onStartupFinished` activation, contributes a sidebar view container (`explorer-container`, icon 📁, location sidebar) and two views (`view.explorer` for file tree, `view.openEditors` for open editors list)
  - Entry point exports `activate(api, context)` and `deactivate()`
  - Activation registers view providers for both views
  - Contributes commands: `explorer.newFile`, `explorer.newFolder`, `explorer.rename`, `explorer.delete`, `explorer.refresh`, `explorer.collapse`, `explorer.revealInExplorer`
  - Contributes keybindings: `F2` for rename (when Explorer focused), `Delete` for delete
  - Built-in tool uses static import + `activateBuiltin()` pattern (matching M2 Welcome/Output/Gallery tools)
  - Explorer is registered first in the activity bar (appears at top, before other sidebar containers)
- **Notes / Constraints:**
  - Uses `parallx.workspace.workspaceFolders` to get root folders
  - Uses `parallx.workspace.fs.*` for all file operations
  - Subscribes to `parallx.workspace.onDidChangeWorkspaceFolders` to react to folder changes
  - Icon can be emoji 📁 or text "E" for M4 (codicon support deferred)

**Task 3.2 — Implement File Tree View**
- **Task Description:** Implement the file tree UI that renders workspace folder contents as an expandable/collapsible tree.
- **Output:** File tree rendered in the Explorer sidebar view.
- **Completion Criteria:**
  - Each workspace folder is a root node in the tree (if single folder, its children are shown directly at top level — matching VS Code behavior)
  - Directories are expandable/collapsible with chevron indicators (▸ / ▾)
  - Files show their filename with appropriate icon hint (text: 📄, folder: 📁; real icons deferred)
  - Items are sorted: directories first, then files, both alphabetical (case-insensitive)
  - Single-click on a file opens it as a preview editor (italic tab)
  - Double-click on a file opens it as a pinned editor (normal tab)
  - Expand/collapse state is persisted per workspace via `context.workspaceState`
  - Tree is populated lazily — subdirectories are loaded on first expand, not on initial render
  - Loading indicator ("...") shows while a directory's contents are being fetched
  - Empty directories show "(empty)" placeholder
  - Hidden files (starting with `.`) are shown but can be toggled via command (`explorer.toggleHiddenFiles`)
  - Tree re-renders when file watcher reports changes (new files appear, deleted files disappear)
  - Tree nodes are keyboard navigable: Up/Down to move, Enter to open/toggle, Left to collapse, Right to expand
  - Selected node is highlighted with background color
  - Active editor's file is highlighted/revealed in the tree
- **Notes / Constraints:**
  - Tree rendering is plain DOM — no virtual scrolling in M4 (acceptable for < 10,000 visible nodes)
  - Each tree node is a `div` with indent level set by CSS `padding-left` (20px per level)
  - The tree is a flat list in the DOM with visual indentation (not nested DOM) — this matches VS Code's `TreeView` pattern and enables efficient updates
  - File watcher is scoped to workspace folders only
  - Performance target: initial tree render of a 500-file folder < 200ms

**Task 3.3 — Implement Open Editors View**
- **Task Description:** Implement the "Open Editors" view that lists all currently open editor tabs.
- **Output:** Open Editors list in the Explorer sidebar.
- **Completion Criteria:**
  - Lists all open editors across all editor groups
  - Each entry shows: filename, dirty indicator (●), close button (×)
  - Entries are grouped by editor group (if multiple groups exist)
  - Clicking an entry activates that editor tab in its group
  - Close button closes the editor (with save confirmation if dirty)
  - List updates reactively when editors are opened, closed, or change dirty state
  - Drag-and-drop reordering within the list reorders tabs in the editor group
  - Context key `openEditorsCount` tracks the number of open editors
  - "Close All" button in the view header closes all editors (with save confirmation for dirty ones)
  - When no editors are open, shows "No open editors" placeholder
- **Notes / Constraints:**
  - Subscribes to `EditorService` events for reactive updates
  - This view is shown as a collapsible section above the file tree (matching VS Code's Explorer layout)
  - In stacked sidebar mode (M3 Cap 3.2), this is the first section, file tree is the second

**Task 3.4 — Implement File Context Menu**
- **Task Description:** Implement right-click context menu on file tree nodes for file operations.
- **Output:** Context menu with file CRUD operations.
- **Completion Criteria:**
  - Right-clicking a file shows: Open, Open to the Side, Rename, Delete, Copy Path, Copy Relative Path
  - Right-clicking a folder shows: New File, New Folder, Rename, Delete, Copy Path, Collapse All (for expanded folders)
  - Right-clicking empty space in the tree shows: New File, New Folder, Refresh
  - "New File" creates an inline text input in the tree at the selected location; pressing Enter creates the file and opens it; Escape cancels
  - "New Folder" creates an inline text input; pressing Enter creates the directory
  - "Rename" converts the selected node's label into an inline text input with the current name pre-filled; Enter confirms, Escape cancels
  - "Delete" shows a confirmation dialog ("Are you sure you want to delete {name}?") and uses trash by default
  - All operations go through `parallx.workspace.fs.*`
  - Context menu dismisses on click outside or Escape
  - Context menu uses the `MenuContributionProcessor` system (commands registered in manifest, menu items declared in `contributes.menus` under `view/context`)
- **Notes / Constraints:**
  - Inline rename/create input is a common VS Code pattern — a small input box replaces the tree node label temporarily
  - Validation: prevent invalid filenames (/, \, :, *, ?, ", <, >, |), empty names, and names starting with `.` (warn but allow)
  - After creating a file, the tree should expand the parent folder and reveal/select the new entry

---

## Capability 4 — File Editor

### Capability Description
A built-in file editor that can open, display, edit, and save plain text files. This is not a code editor — it's a basic text editing surface that proves the editor system works with real file content. It uses a `<textarea>` or contenteditable `<div>` for text editing.

### Goals
- Files open as editor tabs with the file's name and dirty state
- Text content is editable with basic text editing (select, cut, copy, paste, undo, redo)
- Changes are tracked (dirty state) and can be saved to disk
- Save triggers write through FileService
- "Save before close" dialog when closing a dirty editor
- Multiple files can be open simultaneously in different tabs/groups

### Dependencies
- Capability 1 (FileService — for read/write)
- Existing Editor system (M1 Cap 9, M2 Cap 2.6)

### VS Code Reference
- `src/vs/workbench/browser/parts/editor/textResourceEditor.ts` — Text editor integration
- `src/vs/editor/browser/widget/codeEditor/codeEditorWidget.ts` — Editor widget (reference, not target)
- `src/vs/workbench/common/editor/editorInput.ts` — EditorInput base

#### Tasks

**Task 4.1 — Implement FileEditorInput**
- **Task Description:** Create a concrete `EditorInput` subclass that represents a file on disk.
- **Output:** `FileEditorInput` class in `src/built-in/editor/fileEditorInput.ts`.
- **Completion Criteria:**
  - Extends `EditorInput` (M1)
  - `uri` property — absolute file path
  - `getName()` returns filename (e.g., `index.ts`)
  - `getDescription()` returns relative path from workspace folder
  - `getTypeId()` returns `'parallx.editor.file'`
  - `isDirty()` returns true when editor content differs from last saved content
  - `save()` writes current content to disk via `IFileService.writeFile()`, clears dirty state, fires `onDidChangeDirty`
  - `saveAs(targetUri)` writes to a new path, updates the input's URI
  - `revert()` re-reads content from disk via `IFileService.readFile()`, clears dirty state
  - `confirmClose()` — if dirty, shows "Save before closing?" dialog with Save / Don't Save / Cancel options; returns whether close should proceed
  - `serialize()` returns `{ typeId, uri, viewState? }` for workspace persistence
  - `onDidChangeDirty: Event<void>` — fires when dirty state changes
  - `onDidChangeContent: Event<string>` — fires when content is updated (from disk read or user edit)
  - Two inputs with the same URI are considered equal (deduplication)
- **Notes / Constraints:**
  - Content is loaded lazily — `resolve()` reads the file on first access, not in constructor
  - Content is held in memory as a string — no streaming for M4
  - The "save before close?" dialog uses `parallxElectron.dialog.showMessageBox()` or the notification system
  - `FileEditorInput.create(uri, fileService)` factory method for construction

**Task 4.2 — Implement UntitledEditorInput**
- **Task Description:** Create an `EditorInput` subclass for new, unsaved files.
- **Output:** `UntitledEditorInput` class in `src/built-in/editor/untitledEditorInput.ts`.
- **Completion Criteria:**
  - Extends `EditorInput`
  - `getName()` returns `"Untitled-{n}"` (incrementing counter)
  - `getTypeId()` returns `'parallx.editor.untitled'`
  - `isDirty()` returns true if any content has been typed (empty untitled is not dirty)
  - `save()` triggers save-as flow (opens save dialog), then converts to `FileEditorInput` for the chosen path
  - `confirmClose()` — if dirty, shows save dialog
  - `serialize()` returns content for workspace persistence (so unsaved files survive reload)
  - `uri` is a synthetic `untitled://{id}` URI
- **Notes / Constraints:**
  - When a user does "File > New Text File", this is what opens
  - After save-as, the tab title updates to the real filename
  - Untitled editors that are empty (no typed content) can be closed without confirmation

**Task 4.3 — Implement TextEditorPane**
- **Task Description:** Create a concrete `EditorPane` that renders file content in an editable text area.
- **Output:** `TextEditorPane` class in `src/built-in/editor/textEditorPane.ts`.
- **Completion Criteria:**
  - Extends `EditorPane` (M1)
  - Renders a `<textarea>` (or contenteditable `<pre>`) that fills the pane area
  - `setInput(input: FileEditorInput | UntitledEditorInput)` loads and displays the file content
  - Text changes in the textarea update the input's content and dirty state
  - Textarea uses monospace font, dark background matching workbench theme
  - Basic text editing works natively: select, cut, copy, paste, undo, redo (browser-native)
  - `layout(width, height)` resizes the textarea to fill available space
  - Tab key inserts a tab character (doesn't move focus) — use `keydown` handler
  - Line numbers are shown in a gutter column (optional — can be deferred if complex)
  - Current line is highlighted with subtle background color
  - Scroll position is saved/restored in view state
  - Word wrap toggleable via command (`editor.toggleWordWrap`)
  - Status bar shows cursor position (line:column) via `parallx.window.createStatusBarItem()`
  - Status bar shows file encoding (UTF-8) and line endings (LF/CRLF)
- **Notes / Constraints:**
  - This is deliberately a simple text editor — no syntax highlighting, no autocomplete, no minimap
  - `<textarea>` is the simplest approach; contenteditable `<pre>` enables line numbers but is more complex
  - Recommend `<textarea>` for M4, with line numbers as a stretch goal
  - Word wrap default: on for prose files (.md, .txt), off for code files
  - Performance: should handle files up to ~1MB without lag (larger files show warning)

**Task 4.4 — Register File Editor as Built-In Tool (with Editor Resolver)**
- **Task Description:** Package the file editor as a built-in tool that registers the editor provider via the editor resolver pattern (matching VS Code's `EditorResolverService`).
- **Output:** `src/built-in/editor/main.ts` with manifest and activation.
- **Completion Criteria:**
  - Manifest declares: identity (`parallx.editor.text`), `*` activation (always active — needed for file opening), contributes no views (it's an editor provider, not a view)
  - `activate()` registers the editor provider via `parallx.editors.registerEditorProvider()` with:
    - Provider ID: `'parallx.editor.file'`
    - **Glob matcher**: `'*'` (matches all files — default text editor)
    - **Scheme matcher**: `['file']` (only handles `file://` URIs)
    - Factory: `{ createEditorInput(uri) → FileEditorInput, createEditorPane() → TextEditorPane }`
  - Also registers for untitled: provider ID `'parallx.editor.untitled'`, scheme `['untitled']`
  - When `editorService.openEditor(uri)` is called, the resolver matches the URI's scheme and glob against registered providers, selects this provider, and creates the appropriate `EditorInput` + `EditorPane`
  - File association: all text files default to this editor (binary files show "Binary file — cannot display" message)
  - Contributes commands: `editor.toggleWordWrap`, `editor.changeEncoding` (stub for M4)
  - Contributes status bar items: cursor position (line:col), encoding, line ending
- **Notes / Constraints:**
  - This task makes the editor resolver pattern from M2's `EditorsBridge` concrete — the resolver now has registered providers to choose from
  - VS Code reference: `src/vs/workbench/services/editor/browser/editorResolverService.ts` uses `RegisteredEditorInfo` with glob and scheme matchers
  - The distinction between `FileEditorInput` and `UntitledEditorInput` requires separate provider registrations
  - Binary file detection: if `readFile` returns base64, show a placeholder instead of garbled text
  - `FileEditorInput` uses `TextFileModelManager.resolve(uri)` to get/create the text model — NOT `IFileService.readFile()` directly

**Task 4.5 — Wire EditorGroupView Close Confirmation**
- **Task Description:** Ensure that closing a dirty editor tab triggers the save confirmation flow.
- **Output:** Modified `EditorGroupView` and `EditorGroupModel` to check dirty state before close.
- **Completion Criteria:**
  - When user clicks × on a dirty tab, `EditorInput.confirmClose()` is called before closing
  - If user chooses "Save", the input is saved, then closed
  - If user chooses "Don't Save", the input is closed without saving (dirty state discarded)
  - If user chooses "Cancel", the close is cancelled (tab stays open)
  - When closing a group with multiple dirty editors, each is prompted in order (or batch "Save All" option)
  - When closing the window (`workspace.closeWindow`), all dirty editors are prompted before shutdown
  - `Ctrl+W` on a dirty editor triggers the same confirmation flow
  - The confirmation dialog is the native OS dialog (via `dialog:showMessageBox`) for reliability
- **Notes / Constraints:**
  - `EditorInput.confirmClose()` was defined in M1 as a veto mechanism — this task makes it real
  - The close confirmation must be async (dialog is async) — the close flow needs to await it
  - This modifies existing M1 code (`EditorGroupView._closeEditor`, `EditorGroupModel._closeAt`) to insert the async confirmation step

---

## Capability 5 — File Menu and Command Wiring

### Capability Description
All File menu items are wired to real, functional commands. The File menu matches VS Code's structure (adapted for Parallx's scope) and every item does something meaningful.

### Goals
- File menu items are complete and functional
- Commands are registered through the contribution system
- Keyboard shortcuts match VS Code defaults
- Menu items respect when-clause enablement

### Dependencies
- Capabilities 1–4 (FileService, Workspace Folders, Explorer, File Editor)

#### Tasks

**Task 5.1 — Wire Complete File Menu**
- **Task Description:** Register all File menu items with real command implementations.
- **Output:** Complete File menu with functional items.
- **Completion Criteria:**
  - Menu structure (with separator groups):
    ```
    New Text File           Ctrl+N
    ---
    Open File...            Ctrl+O
    Open Folder...          Ctrl+K Ctrl+O
    Open Recent             →  (submenu with recent workspaces)
    ---
    Add Folder to Workspace...
    Save Workspace As...
    Duplicate Workspace
    ---
    Save                    Ctrl+S
    Save As...              Ctrl+Shift+S
    Save All                Ctrl+K S
    ---
    Revert File
    Close Editor            Ctrl+W
    Close Folder
    Close Window            Alt+F4
    ```
  - Every item executes a real command — no stubs, no "coming soon" messages
  - Items that don't apply are grayed out (e.g., "Save" when no editor is active, "Revert" when editor is not dirty, "Close Folder" when no folder is open)
  - "Open Recent" shows a submenu of recent workspaces (from `RecentWorkspaces`)
  - Keyboard shortcuts are registered through `KeybindingService` (M3 Cap 0.3)
  - When clauses: `Save` requires `activeEditor`, `Revert` requires `activeEditorIsDirty`, `Close Folder` requires `workspaceHasFolder`
- **Notes / Constraints:**
  - This task reuses commands defined in Capability 2 (Task 2.2) and Capability 4
  - The menu registration uses `TitlebarPart.registerMenuBarDropdownItems()` from M3 Cap 1.2
  - "Open Recent" submenu is a simplified implementation — shows flat list, not nested folders/workspaces distinction

**Task 5.2 — Wire Edit Menu**
- **Task Description:** Wire the Edit menu to real operations.
- **Output:** Functional Edit menu.
- **Completion Criteria:**
  - Menu structure:
    ```
    Undo                    Ctrl+Z
    Redo                    Ctrl+Shift+Z
    ---
    Cut                     Ctrl+X
    Copy                    Ctrl+C
    Paste                   Ctrl+V
    ---
    Find                    Ctrl+F
    Replace                 Ctrl+H
    ```
  - Undo/Redo/Cut/Copy/Paste delegate to browser-native `document.execCommand()` (these work natively on textarea/contenteditable)
  - Find/Replace: in M4, `Ctrl+F` triggers the browser's native find (adequate for textarea). A custom find-in-editor is deferred.
  - All shortcuts registered via `KeybindingService` — but these are pass-through to native behavior (the keybinding handler checks if the focused element is an input/textarea and skips interception)
- **Notes / Constraints:**
  - Edit operations are largely browser-native for M4 — the menu items provide discoverability
  - The keybinding service must NOT intercept Ctrl+C/V/X/Z when a text input or textarea is focused

**Task 5.3 — Update Other Menus**
- **Task Description:** Ensure View, Go, Tools, and Help menus have appropriate content.
- **Output:** All menus populated with functional or clearly-scoped items.
- **Completion Criteria:**
  - **View menu** (already mostly done from M3):
    - Explorer                (focuses Explorer sidebar)
    - Output                  (focuses Output panel)
    - ---
    - Toggle Sidebar          Ctrl+B
    - Toggle Panel            Ctrl+J
    - Toggle Status Bar
    - ---
    - Word Wrap               (toggles in active editor)
  - **Go menu**:
    - Go to File...           Ctrl+P  (opens Quick Access)
    - Go to Command...        Ctrl+Shift+P (opens Quick Access with >)
  - **Tools menu**:
    - Tool Gallery            (focuses tools sidebar view)
  - **Help menu** (existing):
    - Welcome                 (opens Welcome tab)
    - Show All Commands        Ctrl+Shift+P
- **Notes / Constraints:**
  - Menus should only show items that are implemented — no placeholders or stubs
  - Items contributed by tools automatically appear in the correct menus via the contribution system

---

## Capability 6 — Quick Access File Picker

### Capability Description
The Quick Access widget (M3 Cap 7) gains a file picker mode. When opened with Ctrl+P (no prefix), it shows recent files and allows searching across all files in workspace folders.

### Goals
- Ctrl+P shows files from workspace folders
- Fuzzy search filters files by name
- Selecting a file opens it in the editor
- Recent files appear at top
- File list is built from workspace folder contents

### Dependencies
- Capability 1 (FileService — for listing files)
- Capability 2 (Workspace Folders — for knowing where to search)
- M3 Capability 7 (Quick Access widget)

#### Tasks

**Task 6.1 — Implement File Picker Quick Access Provider**
- **Task Description:** Add a `FilesProvider` to the Quick Access system that lists files from workspace folders.
- **Output:** File search results in Quick Access when opened without prefix.
- **Completion Criteria:**
  - When Quick Access is opened with Ctrl+P and workspace folders exist, shows file results
  - Typing filters files by fuzzy name match (not full path search — just filename)
  - Results show: filename, relative path from workspace root (as detail text)
  - Selecting a result opens the file via `parallx.editors.openEditor()`
  - File list is built by recursively scanning workspace folders (with depth limit of 10 levels)
  - Scanning excludes: `node_modules`, `.git`, `__pycache__`, `dist`, `build`, `.next` (configurable ignore patterns)
  - Results are sorted: recently opened files first, then by fuzzy match score
  - Maximum 50 results shown (performance)
  - Scanning happens in background with cancellation if user changes query
  - If no workspace folders are open, falls back to showing recent workspaces (existing behavior)
  - File results and workspace results coexist — workspaces in a "Recent Workspaces" group, files in a "Files" group
- **Notes / Constraints:**
  - The file list can be cached and invalidated on file watcher events for performance
  - First scan may be slow for large directories — show a "Searching..." indicator
  - VS Code's Quick Open has sophisticated ranking — M4 uses simple fuzzy match with recency boost
  - This provider registers with the Quick Access `IQuickAccessProvider` interface (prefix `''`, same as GeneralProvider — they merge results)

---

## File Structure Additions

```txt
src/
├─ platform/
│  ├─ uri.ts                       # URI class (scheme, authority, path) — foundational type
│  ├─ fileTypes.ts                 # FileType, FileStat, FileEntry, FileChangeType, etc.
│  └─ electronApi.d.ts             # TypeScript types for window.parallxElectron (updated)
│
├─ services/
│  ├─ fileService.ts               # IFileService implementation backed by Electron IPC
│  └─ textFileModelManager.ts      # TextFileModelManager — manages text models per URI, dirty state
│
├─ api/
│  └─ bridges/
│     └─ fileSystemBridge.ts       # parallx.workspace.fs bridge (scoped to workspace folders)
│
├─ built-in/
│  ├─ explorer/
│  │  ├─ parallx-manifest.json     # Explorer tool manifest
│  │  ├─ main.ts                   # Explorer tool entry point
│  │  ├─ fileTreeView.ts           # File tree view provider
│  │  └─ openEditorsView.ts        # Open editors list view provider
│  │
│  └─ editor/
│     ├─ parallx-manifest.json     # Text editor tool manifest
│     ├─ main.ts                   # Text editor tool entry point
│     ├─ fileEditorInput.ts        # FileEditorInput (file-backed editor)
│     ├─ untitledEditorInput.ts    # UntitledEditorInput (unsaved editor)
│     └─ textEditorPane.ts         # TextEditorPane (textarea-based editing surface)
│
electron/
├─ main.cjs                        # (MODIFIED) — fs IPC handlers, dialog handlers, watcher handlers
└─ preload.cjs                     # (MODIFIED) — parallxElectron.fs.*, parallxElectron.dialog.*

src/
├─ workspace/
│  └─ workspace.ts                 # (MODIFIED) — folders array, add/remove/reorder, serialization
├─ workspace/
│  └─ workspaceTypes.ts            # (MODIFIED) — WorkspaceFolder type, folders in WorkspaceState
├─ commands/
│  └─ structuralCommands.ts        # (MODIFIED) — file.* commands, wired workspace folder commands
├─ commands/
│  └─ quickAccess.ts               # (MODIFIED) — FilesProvider added
├─ context/
│  └─ workbenchContext.ts           # (MODIFIED) — folder and resource context keys
├─ api/
│  └─ parallx.d.ts                 # (MODIFIED) — parallx.workspace.fs, workspaceFolders, etc.
├─ api/
│  └─ bridges/
│     └─ workspaceBridge.ts        # (MODIFIED) — workspace folders API
└─ workbench/
   └─ workbench.ts                 # (MODIFIED) — Explorer tool registration, file command wiring
```

---

## Testing Strategy

### Unit Tests
- **FileService:** Mock `parallxElectron.fs`, test read/write/stat/error normalization/cache invalidation
- **Workspace Folders:** Test add/remove/reorder, duplicate rejection, serialization round-trip, event firing
- **FileEditorInput:** Test dirty state transitions, save/revert, confirmClose flow, serialize/deserialize
- **UntitledEditorInput:** Test naming (Untitled-1, -2, -3), dirty-on-type, save-as conversion
- **File tree model:** Test sort order (dirs first, alphabetical), expand/collapse state, lazy loading

### Integration Tests
- **Full file workflow:** Open folder → expand tree → click file → edit text → Ctrl+S → verify file written → close tab → confirm save dialog
- **Multi-file:** Open 3 files → edit 2 → close all → save dialog for each dirty file
- **Workspace persistence:** Open folder → open files → reload → verify folder and open editors are restored
- **File watcher:** Open folder → create file externally → verify tree updates → modify file externally → verify editor content updates (or shows "file changed on disk" prompt)
- **Quick Access file picker:** Open folder with 100 files → Ctrl+P → type partial name → verify results → select → verify file opens

### Manual Verification
- [ ] File > Open Folder opens native dialog and populates Explorer
- [ ] File > Open File opens native dialog and opens file as editor tab
- [ ] File > New Text File creates untitled editor tab
- [ ] File > Save saves dirty editor to disk (or save-as for untitled)
- [ ] File > Save As opens save dialog and saves to new path
- [ ] File > Revert reloads file from disk
- [ ] File > Close Editor closes active tab (with save prompt if dirty)
- [ ] Explorer tree shows folder contents with correct hierarchy
- [ ] Single-click file in tree opens preview tab (italic)
- [ ] Double-click file in tree opens pinned tab (normal)
- [ ] Right-click in tree shows context menu with working New File/Folder/Rename/Delete
- [ ] Creating a new file via context menu works (inline input → file created → opened)
- [ ] Deleting a file via context menu moves to trash and removes from tree
- [ ] Renaming a file updates tree and editor tab title
- [ ] Ctrl+P shows files from workspace folders with fuzzy search
- [ ] Status bar shows cursor position, encoding, line ending for active text editor
- [ ] Dirty indicator (●) appears on tab when text is modified
- [ ] Window title shows `filename — folder — Parallx` format
- [ ] Closing dirty editor shows native save dialog
- [ ] Closing window with dirty editors prompts to save

---

## Success Criteria

| # | Criterion | Description |
|---|-----------|-------------|
| **0** | **Filesystem Bridge** | |
| 0a | File CRUD operations work through IPC | Read, write, stat, readdir, rename, delete, mkdir, copy all functional |
| 0b | File dialogs open and return selections | Open file, open folder, save-as, message box all work |
| 0c | File watcher reports external changes | Creating/modifying/deleting a file externally is detected |
| **1** | **File Service** | |
| 1a | IFileService is registered and functional | All operations work through the service abstraction |
| 1b | Errors are normalized | All filesystem errors have consistent code/message structure |
| 1c | Cache invalidates on changes | Reading a file after modification returns fresh content |
| **2** | **Workspace Folders** | |
| 2a | Folders can be added and removed | Commands work, workspace state updates |
| 2b | Folders persist across sessions | Reload restores workspace folders |
| 2c | Window title reflects open folder | Title format matches specification |
| 2d | Context keys update with folder state | `workspaceFolderCount`, `workspaceHasFolder` are correct |
| **3** | **Explorer** | |
| 3a | File tree renders workspace folders | Correct hierarchy, sort order, expand/collapse |
| 3b | Files can be opened from tree | Single-click = preview, double-click = pinned |
| 3c | File CRUD from context menu works | New file, new folder, rename, delete all functional |
| 3d | Tree updates on external changes | File watcher events refresh the tree |
| 3e | Open Editors view lists active editors | Correct count, dirty state, click-to-activate |
| **4** | **File Editor** | |
| 4a | Text files open and display correctly | Content renders in textarea, correct encoding |
| 4b | Editing creates dirty state | Dirty dot on tab, dirty context key, window title prefix |
| 4c | Save writes to disk | Ctrl+S saves, file on disk is updated |
| 4d | Close confirmation works | Dirty tab shows save dialog with Save/Don't Save/Cancel |
| 4e | Untitled editors work | New text file, save-as to create backing file |
| 4f | Multiple editors work | Multiple files open in tabs and groups |
| **5** | **Menus and Commands** | |
| 5a | Every File menu item is functional | No stubs, no dead items |
| 5b | Menu items respect when-clauses | Grayed out when not applicable |
| 5c | Keyboard shortcuts work | Ctrl+N, Ctrl+O, Ctrl+S, Ctrl+Shift+S, Ctrl+W all functional |
| **6** | **Quick Access** | |
| 6a | Ctrl+P shows files from workspace | Files appear with fuzzy search |
| 6b | Selecting a file opens it | File opens in editor on selection |
| **7** | **Quality** | |
| 7a | No console errors in normal file operations | Clean workflow execution |
| 7b | File operations are non-blocking | UI remains responsive during read/write |
| 7c | Large directory trees render efficiently | 500-file folder loads in < 200ms |
| 7d | Memory is stable during file operations | No leaks from repeated open/close cycles |

---

## Sequencing Recommendation

### Why M4 and not M3.5?

This is a full milestone, not a patch. It introduces:
- A new platform layer (filesystem IPC — 4 tasks)
- A new service (FileService — 3 tasks)
- Two new built-in tools (Explorer, Text Editor — 9 tasks)
- A new data model (workspace folders — 4 tasks)
- Menu rewiring (3 tasks)
- Quick Access extension (1 task)

That's **25 tasks across 7 capabilities** — comparable in scope to M2 (which had 28 tasks across 8 capabilities). The additional task (1.4 TextFileModelManager) was added based on VS Code source audit to prevent dirty-state bugs in multi-view scenarios.

### Should you finish M3 first?

**Yes, but only the remaining tasks that M4 depends on.** Specifically:

| M3 Task | Status | M4 Dependency? |
|---------|--------|----------------|
| Cap 8 — Focus model & keyboard nav | Not started | **Partial** — Task 8.1 (region focus shortcuts) is nice-to-have. Tasks 8.2–8.3 (context enablement verification, focus trapping) are useful but not blocking. |
| Cap 9 — Notification center | Not started | **No** — Toast notifications already work. The notification center dropdown is polish. |

**Recommendation:** Complete M3 Task 8.1 (focus shortcuts — Ctrl+1, Ctrl+0, F6 cycling) because they're quick wins that make the workbench feel more complete. Skip M3 Tasks 8.2, 8.3, and Cap 9 for now — they're verification/polish tasks that can be done after M4 or in a future polish milestone.

Then proceed to M4. The experience payoff of "I can open a folder and edit files" far outweighs the polish payoff of "focus traps correctly in overlays."

---

## Notes

- This milestone deliberately chooses a **textarea** over Monaco or CodeMirror. The goal is to prove the editor system works with real files, not to build a code editor. A future milestone can swap the `TextEditorPane` internals for a proper editor widget without changing the `EditorInput`/`EditorPane` contract.
- The Explorer is a built-in tool, not shell code. This validates that the M2 tool system can support a complex, stateful view with file operations. If the Explorer can be built with the public API, any tool can.
- File watchers are intentionally simple in M4 — recursive watching with debouncing. Production-grade watching (like VS Code's `parcel/watcher` integration) is a future optimization.
- Binary file handling is minimal: detect and show a placeholder message. Binary viewers (images, hex, etc.) are future tools.
- The `IFileService` abstraction is the key architectural investment. Even though M4 only has one provider (Electron/Node.js), the interface enables remote filesystems, virtual filesystems, and in-memory filesystems in future milestones without changing any consumer code.
# Milestone 4 — VS Code Alignment Audit

> **Purpose:** Verify that Parallx M4 spec is architecturally aligned with the real VS Code codebase, based on primary source review (GitHub source, DeepWiki, VS Code wiki).

---

## Sources Examined

- `src/vs/platform/files/common/files.ts` — `IFileService` interface, `FileType`, error codes, capabilities
- `src/vs/platform/files/common/fileService.ts` — `FileService` implementation (facade over providers)
- `src/vs/platform/files/node/diskFileSystemProvider.ts` — Local disk filesystem provider
- `src/vs/workbench/contrib/files/browser/explorerViewlet.ts` — Explorer viewlet (sidebar container)
- `src/vs/workbench/contrib/files/browser/views/explorerView.ts` — File tree view implementation
- `src/vs/workbench/contrib/files/browser/files.contribution.ts` — File editor registration, configuration
- `src/vs/workbench/contrib/files/browser/fileActions.contribution.ts` — Context menus, commands
- `src/vs/workbench/contrib/files/browser/fileCommands.ts` — File save/revert/open commands
- `src/vs/workbench/contrib/files/common/files.ts` — Constants: `VIEWLET_ID`, `VIEW_ID`, context keys
- `src/vs/workbench/common/editor.ts` — `EditorInput` base class
- `src/vs/workbench/browser/parts/editor/editorGroupView.ts` — `EditorGroupView` implementation
- `src/vs/workbench/services/editor/browser/editorService.ts` — `EditorService` (coordinator)
- `src/vs/workbench/services/editor/browser/editorResolverService.ts` — Maps inputs to panes
- `src/vs/platform/workspace/common/workspace.ts` — `IWorkspaceContextService`, `WorkspaceFolder`
- `src/vs/code/electron-main/main.ts` — Electron main process startup and service creation
- VS Code Wiki: Source Code Organization
- DeepWiki: File System & Internals, Source Code Layers

---

## Assessment Summary

| Area | Alignment | Notes |
|------|-----------|-------|
| **Layer architecture** | ✅ Aligned | Our base→platform→workbench layering matches |
| **IFileService abstraction** | ✅ Aligned | Provider-based facade pattern is correct |
| **FileSystemProvider model** | ⚠️ Deviation | VS Code uses provider pattern, we have direct IPC — acceptable for M4 but should be noted |
| **Explorer as contribution** | ✅ Aligned | VS Code Explorer lives in `workbench/contrib/files/` — our "built-in tool" pattern is equivalent |
| **Explorer tree component** | ⚠️ Deviation | VS Code uses `WorkbenchCompressibleAsyncDataTree`, we plan simple tree — acceptable |
| **EditorInput/EditorPane** | ✅ Aligned | Our pattern matches VS Code's `EditorInput` → `EditorResolverService` → `EditorPane` |
| **FileEditorInput** | ✅ Aligned | VS Code has `FileEditorInput` in `contrib/files/browser/editors/` |
| **Workspace model** | ✅ Aligned | `IWorkspaceContextService` with `getWorkspace().folders` matches our plan |
| **Context keys** | ✅ Aligned | VS Code uses same pattern: `ResourceContextKey`, folder contexts |
| **File watcher isolation** | ⚠️ Deviation | VS Code runs watchers in utility processes, we use main process — acceptable for M4 |
| **Editor resolver service** | ⚠️ Missing | Our spec doesn't explicitly describe the resolution step |
| **Text file service** | ⚠️ Missing | VS Code has `ITextFileService` between `IFileService` and editors |
| **Dialog service** | ⚠️ Deviation | VS Code has `IDialogService` as service, we wire through IPC — acceptable |

---

## Detailed Findings

### 1. File System Architecture

**VS Code actual:**
- `IFileService` (in `platform/files/common/files.ts`) is the **facade** — all consumers use this
- `IFileSystemProvider` is the **backend** — `DiskFileSystemProvider` for local, others for remote/virtual
- `FileService` (in `platform/files/common/fileService.ts`) orchestrates: routes operations to registered providers based on URI scheme
- Provider capabilities declared via `FileSystemProviderCapabilities` bitfield: `FileReadWrite`, `FileOpenReadWriteClose`, `FileAtomicRead`, `FileClone`, `Trash`, etc.
- Files are identified by `URI` objects, not string paths — this is critical for scheme-based routing

**Our M4 spec:**
- `IFileService` interface is correct conceptually
- We route through Electron IPC to main process → `fs/promises` — this is equivalent to VS Code's `DiskFileSystemProvider` but without the provider registration layer
- We use string paths, not URIs

**Verdict:** ✅ Structurally correct for M4 scope. The provider abstraction is a future milestone concern (virtual/remote FS). **However, we should use URI-like resource identifiers from the start** — even if they're all `file://` scheme for now. This matches VS Code and sets us up for future extensibility.

**Recommended change:** Add a note that `IFileService` methods accept `URI` objects (or at minimum `{ scheme: string, path: string }`) rather than raw string paths. The IPC bridge can resolve these to actual filesystem paths.

---

### 2. Explorer Architecture

**VS Code actual:**
- Explorer is a **workbench contribution** in `src/vs/workbench/contrib/files/`
- It's NOT an extension — it's core code, but organized like a contribution
- `ExplorerViewPaneContainer` extends `ViewPaneContainer` — it's a viewlet/sidebar
- The tree uses `WorkbenchCompressibleAsyncDataTree<ExplorerItem>` — a highly sophisticated async tree
- `ExplorerItem` is the tree node model (wraps `IFileStat`)
- `ExplorerDataSource` provides lazy child loading
- `ExplorerService` manages state (focus, selection, editable, etc.)
- Folder compression: single-child directories are compressed (e.g., `src/vs/platform` shows as one node)
- Tree view state (expanded/collapsed) is persisted to `StorageScope.WORKSPACE`
- File icon themes are applied via CSS class management
- Context menus use `MenuId.ExplorerContext` menu registration

**Our M4 spec:**
- Explorer is a "built-in tool" using `parallx-manifest.json` + `parallx.*` API
- We plan a simpler tree without compression
- Context menus planned with right-click actions

**Verdict:** ✅ Our approach is architecturally sound. VS Code's Explorer is effectively a "built-in contribution" using core APIs — our "built-in tool" is the same pattern. Key differences are acceptable:
- No folder compression (fine for M4)
- Simpler tree implementation (fine for M4)
- **However:** We should match VS Code's key interaction patterns:
  - Single-click = preview (transient editor), Double-click = pin (permanent editor)
  - Tree state persistence
  - `ExplorerFocusedContext`, `ExplorerFolderContext` etc. context keys

**No changes needed** — our spec already covers these.

---

### 3. Editor System

**VS Code actual:**
- Opening flow: `EditorService.openEditor(input, options, group?)` → `EditorResolverService.resolveEditor(input)` → matches input type to registered `EditorPane` → `EditorGroupView.openEditor()` → `EditorPanes.showEditorPane(pane)` → `pane.setInput(input)`
- **Key class: `EditorResolverService`** — this is the **router** that maps `EditorInput` types to `EditorPane` implementations. Extensions/contributions register editor associations here.
- `FileEditorInput` lives in `contrib/files/browser/editors/fileEditorInput.ts`
- `TextFileEditor` (extends `AbstractTextResourceEditor`) displays text files using Monaco
- `BinaryFileEditor` shows binary files with a simple placeholder
- `TextFileService` (`ITextFileService`) manages text file models — it sits **between** `IFileService` (raw bytes) and the editor (text model). It handles encoding detection, dirty tracking, save conflict detection, auto-save, hot exit.
- `EditorInput` capabilities are declared via `EditorInputCapabilities` flags: `Readonly`, `Untitled`, `RequiresTrust`, `Singleton`, `MultipleEditors`, etc.

**Our M4 spec:**
- `FileEditorInput` extending `EditorInput` — correct
- `UntitledEditorInput` — correct (VS Code has this too)
- `TextEditorPane` — correct concept, though we use `<textarea>` instead of Monaco
- We don't describe the resolver/router step

**Verdict:** ⚠️ We should explicitly include the **editor resolver** concept. In VS Code, this is critical — it's how the system knows "a `file://` URI should open in `TextFileEditor`" vs "a `.png` should open in `BinaryFileEditor`". Our M2 already has `EditorsBridge.registerEditorProvider()` which is this concept. **We should clarify in M4 that `FileEditorInput` registers with the resolver, not just exists.**

**Recommended change:** In Capability 4 (File Editor), add a task or note that the built-in text editor tool registers a file editor provider that handles `file://` URIs via the existing `parallx.editors.registerEditorProvider()` API. Also note the need for a `TextFileService` equivalent that manages the text model lifecycle (encoding, dirty state, content cache) separately from the raw filesystem.

---

### 4. Workspace Model

**VS Code actual:**
- `IWorkspaceContextService` provides `getWorkspace()` which returns `IWorkspace`
- `IWorkspace` has `folders: WorkspaceFolder[]` where `WorkspaceFolder = { uri: URI, name: string, index: number }`
- Three states: `WorkbenchState.EMPTY` (no folder), `WorkbenchState.FOLDER` (single folder), `WorkbenchState.WORKSPACE` (multi-root `.code-workspace`)
- `WorkspaceFolderCountContext` context key (numeric)
- Events: `onDidChangeWorkspaceFolders`, `onWillChangeWorkspaceFolders`
- Folder add/remove goes through `IWorkspaceEditingService`
- Window title uses folder name

**Our M4 spec:**
- `Workspace.folders` array with `WorkspaceFolder = { uri, name, index }` — matches exactly
- Add/remove/reorder methods — matches
- `workspaceFolderCount` context key — matches
- Events on change — matches

**Verdict:** ✅ Nearly perfect alignment. **One addition:** We should include `WorkbenchState` concept (EMPTY vs FOLDER) even in simplified form. This affects what the Explorer shows (welcome/prompt vs tree) and what menu items are enabled.

---

### 5. File Service IPC vs Provider Pattern

**VS Code actual:**
- `FileService` in main process creates `DiskFileSystemProvider` and registers it for `file://` scheme
- Renderer accesses via `IFileService` which routes to the provider
- In Electron desktop, the `IFileService` in renderer communicates to main process via IPC channels
- The abstraction is URI-scheme-based: `file://` → disk, `vscode-remote://` → remote, etc.

**Our M4 spec:**
- We bridge Electron IPC directly: `parallxElectron.fs.readFile(path)` → main process → `fs/promises`
- `FileService` in renderer wraps these IPC calls

**Verdict:** ✅ Functionally identical for local files. The VS Code pattern of routing by URI scheme is more sophisticated, but our direct IPC approach is correct for M4 where we only support local `file://`. **Key insight:** We should make our `FileService` consume URIs so the routing can be added later without changing consumers.

---

### 6. Context Keys

**VS Code actual (from `workbench/contrib/files/common/files.ts` and `workbench/common/contextkeys.ts`):**
- `explorerViewletVisibleContext`
- `explorerFocusedContext` / `filesExplorerFocusedContext`
- `explorerFolderContext` (is the focused item a folder?)
- `explorerRootContext` (is it a root folder?)
- `explorerResourceReadonlyContext` / `explorerResourceNotReadonlyContext`
- `explorerResourceCut` (for cut/paste)
- `explorerResourceMoveableToTrash`
- `explorerCompressedFocusContext` (compressed folder navigation)
- `explorerResourceAvailableEditorIdsContext`
- `ResourceContextKey` (composite): `resourceScheme`, `resourceFilename`, `resourceExtname`, `resourceDirname`, `resourcePath`
- `DirtyWorkingCopiesContext`
- `WorkbenchStateContext` (EMPTY, FOLDER, WORKSPACE)
- `WorkspaceFolderCountContext`
- `ActiveEditorCanRevertContext`, `ActiveEditorContext`

**Our M4 spec:**
- `workspaceFolderCount`, `workspaceHasFolder` — matches
- `resourceScheme`, `resourceExtname`, `resourceFilename` — matches
- `activeEditorIsDirty` — matches (VS Code calls this `DirtyWorkingCopiesContext`)

**Verdict:** ✅ Good coverage. Could add `explorerFolderContext` and `explorerRootContext` which are important for menu enablement. Our spec already has these in the Explorer section. `WorkbenchStateContext` would be a useful addition.

---

### 7. File Commands and Menus

**VS Code actual (from `fileActions.contribution.ts` and `fileCommands.ts`):**
- Save commands: `SAVE_FILE_COMMAND_ID`, `SAVE_FILE_AS_COMMAND_ID`, `SAVE_ALL_COMMAND_ID`, `SAVE_FILE_WITHOUT_FORMATTING_COMMAND_ID`, `REVERT_FILE_COMMAND_ID`
- New file: `NEW_UNTITLED_FILE_COMMAND_ID`, `NEW_FILE_COMMAND_ID`
- Compare: `COMPARE_WITH_SAVED_COMMAND_ID`, `SELECT_FOR_COMPARE_COMMAND_ID`, `COMPARE_SELECTED_COMMAND_ID`
- Explorer actions: Copy path, copy relative path, reveal in explorer, open with
- Delete uses `shell.trashItem()` (Electron's trash API) when available
- Context menus registered via `MenuId.ExplorerContext`, `MenuId.OpenEditorsContext`
- Save uses `textFileService.save()` which handles encoding, conflict detection, etc.

**Our M4 spec:**
- Covers most of these: save, save as, revert, new file, new folder
- Includes trash delete
- Context menus planned

**Verdict:** ✅ Good alignment. The compare commands are appropriately excluded from M4.

---

### 8. Key Pattern: TextFileService

**VS Code actual:**
- `ITextFileService` is a **critical intermediate layer** between `IFileService` (raw bytes) and editors (text models)
- It manages: text file models (in-memory state), encoding detection/conversion, dirty tracking per resource, auto-save scheduling, save conflict detection (etag-based), backup/hot exit
- `TextFileEditorModel` wraps a text model with lifecycle management
- Editors don't call `IFileService.readFile()` directly — they go through `ITextFileService` which manages the model lifecycle

**Our M4 spec:**
- We have `FileEditorInput` doing dirty tracking directly
- We load file content in the editor pane's `setInput()` method
- No intermediate text model service

**Verdict:** ⚠️ This is the **biggest gap** in our spec. We should add at minimum a `TextFileModelManager` (simpler than VS Code's full `TextFileService`) that:
1. Tracks which files are currently open as text models
2. Manages dirty state per resource (not per editor input — important for multiple editors on same file)
3. Detects external changes (via watcher) and marks models as conflicted
4. Centralizes save logic (so "Save All" works without iterating editors)

Without this, we'll have bugs when the same file is opened in two editor groups, or when "Save All" needs to find all dirty resources.

**Recommended change:** Add a lightweight `TextFileModelManager` to Capability 1 (Filesystem Service) or create a new Capability 1.5. This doesn't need to be as complex as VS Code's — just a map of `uri → { content, dirty, mtime }` with events.

---

## Summary of Recommended Changes

### Must-Fix (Architectural correctness)
1. **Use URI-based resource identifiers** throughout, not raw string paths. Even if all URIs are `file://` for now, this is foundational for the provider pattern later.
2. **Add TextFileModelManager** — a lightweight service that manages in-memory text models per resource, handles dirty state centrally, and detects external changes. Without this, multi-view-of-same-file and Save All will break.
3. **Clarify editor resolver registration** — the built-in text editor tool should register via `parallx.editors.registerEditorProvider()` with a glob/scheme matcher, not just exist.

### Should-Fix (VS Code alignment)
4. **Add `WorkbenchState` concept** — EMPTY vs FOLDER distinction affects Explorer welcome screen and menu enablement.
5. **Match `explorerFolderContext` / `explorerRootContext`** naming for context keys (already in spec but confirm naming).
6. **Note that `IFileService` is a facade over providers** — even though M4 only has one provider (disk/IPC), the interface should be designed so a second provider can be registered by URI scheme.

### Nice-to-Have (Polish)
7. Reference specific VS Code file paths more precisely (done above).
8. Note that VS Code runs file watchers in utility processes for isolation — we can defer this but should note the architectural debt.
9. Explorer tree state persistence to workspace storage (already in spec).

---

## Verdict

**The M4 spec is approximately 85% aligned with VS Code's real architecture.** The main gaps are:
- URI-based identifiers (foundational, easy to add)
- TextFileModelManager (significant, prevents real bugs)
- Editor resolver clarity (documentation, not code change)

The spec correctly identifies the layer boundaries, service abstractions, contribution patterns, and editor system reuse that VS Code uses. The deliberate simplifications (textarea vs Monaco, no folder compression, direct IPC vs provider routing) are appropriate for M4's scope.
