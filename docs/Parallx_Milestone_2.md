# Milestone 2 – Tools, Views, and Extensibility

> **Authoritative Scope Notice**
>
> This document is the single source of truth for Milestone 2.
> All implementation must conform to the structures and boundaries defined here.
> VS Code source files are referenced strictly as inspiration and validation, not as scope drivers.
> Referenced material must not expand scope unless a missing core extensibility element is identified.
> Parallx is **not** a code IDE. It is a VS Code-like structural shell that hosts arbitrary domain-specific tools.
> All VS Code references are filtered through this lens — only structural, shell, and hosting patterns apply.

---

## Milestone Definition

### Vision
The workbench shell built in Milestone 1 becomes a **tool-hosting platform**. External tools can register themselves, contribute UI, lifecycle-manage their resources, and persist their state — all through a well-defined API boundary. The shell remains domain-agnostic; tools bring the domain.

### Purpose
This milestone transforms Parallx from a static shell into a live extensibility platform. It solves tool discovery, registration, isolation, lifecycle, and contribution before any domain-specific tools are authored. After M2, a third-party developer can write a Parallx tool that contributes views, commands, and configuration without touching shell internals.

### Conceptual Scope

**Included**
- Tool manifest schema and validation
- Tool registry and discovery
- Tool API boundary (the `parallx` namespace)
- Tool lifecycle (activation, deactivation, error isolation)
- Tool configuration and state persistence (Memento pattern)
- Command contribution from tools
- Declarative view and view container contribution
- Menu and keybinding contribution points
- Built-in tools that validate the system end-to-end
- M1 gap cleanup (stub commands, empty facades, dead file)

**Excluded**
- Tool marketplace or remote installation (deferred)
- Tool sandboxing or process isolation (tools run in-process for M2)
- Multi-window tool hosting (deferred)
- Theming contribution from tools (deferred)
- Network-based tool communication (deferred)
- Domain-specific tool implementations (canvas, database, AI, etc.)
- Language server protocol or code intelligence features (not applicable — Parallx is not a code IDE)

### Structural Commitments
- Tools interact with the shell only through the `parallx` API surface — never through internal imports.
- Tool manifests are declarative JSON; the shell reads and validates them at load time.
- Activation is lazy and event-driven; tools are not loaded until needed.
- Tool errors must not crash the shell; activation failures are isolated and reported.
- Built-in tools use the same API and manifest as external tools — no special-casing.
- All M1 extension points (ViewDescriptor, CommandDescriptor, ContextKey, EditorInput) are reachable through the tool API.

### Architectural Principles
- **API Boundary**: All tool↔shell interaction goes through a versioned, documented API object.
- **Declarative First**: Tools declare capabilities in a manifest; the shell does the wiring.
- **Lazy Activation**: Tools are loaded on-demand in response to activation events.
- **Error Isolation**: One tool's failure must not affect another tool or the shell.
- **Symmetry**: Built-in tools and external tools use identical mechanisms.
- **State Ownership**: Tools own their state; the shell provides scoped storage.

---

## Capability 0 – M1 Gap Cleanup

### Capability Description
Address the known gaps identified in the Milestone 1 Completion Verdict before building new M2 infrastructure on top. This ensures the foundation is solid.

### Goals
- All M1 stub command handlers are wired to real implementations
- Empty service facade files are populated or removed
- Dead files are removed
- Codebase is clean for M2 work

### Conceptual Responsibilities
- Wire stub commands to existing APIs
- Create thin service facades or consolidate
- Remove files that serve no purpose
- Verify no regressions after cleanup

### Dependencies
None — this is prerequisite work.

#### Tasks

**Task 0.1 – Wire Stub Command Handlers** ✅
- **Task Description:** Connect the 7 stub command handlers identified in M1 Gap 1 to their real implementations.
- **Output:** All 19 structural commands are fully functional (no stub messages logged).
- **Completion Criteria:**
  - ✅ `workbench.action.splitEditor` calls `IEditorGroupService.splitGroup(activeGroupId, GroupDirection.Right)`
  - ✅ `workbench.action.splitEditorOrthogonal` calls `IEditorGroupService.splitGroup(activeGroupId, GroupDirection.Down)`
  - ✅ `view.moveToSidebar` performs `removeView` + `addView` across containers via `_findViewContainer` helper; validates source ≠ target
  - ✅ `view.moveToPanel` performs `removeView` + `addView` across containers via `_findViewContainer` helper; validates source ≠ target
  - ✅ `part.resize` calls `Grid.resizeSash()` via `_resolveGridForPart` helper to find the correct grid (hGrid or vGrid)
  - ✅ `workspace.addFolderToWorkspace` and `workspace.removeFolderFromWorkspace` remain stubs with clear `DEFERRED` comments explaining multi-root is out of M2 scope
- **Notes / Constraints:**
  - The editor split commands use the `IEditorGroupService` interface via `ctx.getService()`, not reaching into `EditorPart` directly
  - The view move commands validate the target container accepts the view before moving (checks source ≠ target, view exists in source)

**Task 0.2 – Populate or Remove Empty Service Facades** ✅
- **Task Description:** Address `layoutService.ts`, `viewService.ts`, and `workspaceService.ts` which are currently comment-only placeholders.
- **Output:** Each file contains a thin facade class implementing its interface.
- **Completion Criteria:**
  - ✅ `LayoutService` implements `ILayoutService`, delegates `layout()` to hGrid/vGrid and `_layoutViewContainers()`; host set via `setHost()` in Phase 3
  - ✅ `ViewService` implements `IViewService` (currently empty interface — placeholder for Cap 4 expansion); registered for DI stability
  - ✅ `WorkspaceService` implements `IWorkspaceService`, delegates all workspace ops to Workbench; forwards `onDidSwitchWorkspace` events
  - ✅ All three registered in DI container via `_registerFacadeServices()` called in Phase 3 of workbench initialization
  - ✅ Consumers can import from the facade via the service identifier, not from implementation internals
- **Notes / Constraints:**
  - Thin delegation pattern chosen — facades use a `setHost()` method to receive the Workbench reference (same pattern as `CommandService.setWorkbench()`)
  - This establishes the facade pattern for M2 — tools will access services through the DI container

**Task 0.3 – Remove Dead File** ✅
- **Task Description:** Remove `context/contextKeyService.ts` (1-line comment, serves no purpose) and update any imports.
- **Output:** File deleted, no dangling references.
- **Completion Criteria:**
  - ✅ File deleted from repository
  - ✅ No imports referenced the dead file (confirmed via grep); `services/contextKeyService.ts` and `context/contextKey.ts` already used by all consumers
  - ✅ Build succeeds with zero errors (esbuild bundle builds successfully)

**Task 0.4 – Fix All Pre-existing TypeScript Errors** ✅
- **Task Description:** Resolve all 7 TypeScript strict-mode errors across 4 files so `npx tsc --noEmit` reports zero errors.
- **Output:** Clean TypeScript compilation (zero errors, zero warnings).
- **Completion Criteria:**
  - ✅ `editorGroup.ts`: `EditorOpenOptions` and `EditorCloseOptions` re-exported with `export type` (required by `isolatedModules`)
  - ✅ `contextBridge.ts`: removed unnecessary `as ContextKeyValue` cast in `handle.set(value)` — `value` is already `T extends ContextKeyValue`
  - ✅ `notificationService.ts`: wrapped Promise `resolve` callback in a `resolveWrapper` that adapts `NotificationResult` → `NotificationAction | undefined`
  - ✅ `apiFactory.ts`: imported `ContextKeyValue` type and aligned `ParallxApiObject.context` API surface to use `ContextKeyValue` instead of narrower `string | number | boolean | undefined`
  - ✅ `viewsBridge.ts`: made `ViewProviderOptions.name` optional (API shape already declared it optional; fallback to `viewId` already existed)
  - ✅ `npx tsc --noEmit` produces zero errors

---

## Capability 1 – Tool Manifest and Registry

### Capability Description
The system can discover, validate, and register tools from declarative manifest files. A tool manifest declares the tool's identity, activation events, contributions (views, commands, configuration), and entry point — analogous to a VS Code extension's `package.json`.

### Goals
- Tool identity is established at load time from manifest
- Manifests are validated against a schema before registration
- Invalid manifests produce clear error messages without crashing the shell
- The tool registry is the single source of truth for loaded tools
- Tools can be queried by ID, state, or contribution type

### Conceptual Responsibilities
- Define and validate tool manifest schema
- Scan configured directories for tool manifests
- Register validated tools in central registry
- Track tool state (discovered → registered → activated → deactivated → disposed)
- Provide query API for registered tools

### Dependencies
- M1 Gap Cleanup

### VS Code Reference
- `src/vs/workbench/services/extensions/common/extensionDescriptionRegistry.ts` — Extension description storage and lookup
- `src/vs/platform/extensions/common/extensions.ts` — `IExtensionDescription` interface, extension manifest shape
- `src/vs/workbench/services/extensions/common/abstractExtensionService.ts` — Scanning and activation coordination
- DeepWiki: [Extension System](https://deepwiki.com/microsoft/vscode/8-extension-system) — Extension Lifecycle, Extension Management

#### Tasks

**Task 1.1 – Define Tool Manifest Schema** ✅
- **Task Description:** Define the TypeScript interfaces and JSON schema for a tool manifest. This is the `package.json`-equivalent for Parallx tools.
- **Output:** `IToolManifest` interface and JSON Schema definition for validation.
- **Completion Criteria:**
  - ✅ Manifest declares tool identity (`id`, `name`, `version`, `publisher`, `description`) — `IToolManifest` in `src/tools/toolManifest.ts`
  - ✅ Manifest declares `main` entry point (relative path to JS/TS module)
  - ✅ Manifest declares `activationEvents` array (e.g., `onCommand:*`, `onView:*`, `onStartupFinished`) — typed as `ActivationEventType` union
  - ✅ Manifest declares `contributes` object with contribution point keys (views, viewContainers, commands, configuration, menus, keybindings) — typed as `IManifestContributions` with per-point descriptor interfaces
  - ✅ Manifest declares `engines.parallx` version compatibility string — `IManifestEngines` interface
  - ✅ Schema is versioned (`manifestVersion` field) — `CURRENT_MANIFEST_VERSION = 1`
  - ✅ JSON schema file can be used for IDE-assisted editing of manifests — `src/tools/parallx-manifest.schema.json` (JSON Schema draft-07)
- **Notes / Constraints:**
  - Reference only:
    - VS Code's `package.json` schema for extensions: https://code.visualstudio.com/api/references/extension-manifest
    - `src/vs/platform/extensions/common/extensions.ts` — `IExtensionDescription` interface
  - Start minimal — only include contribution points that M2 implements
  - `activationEvents` supported in M2: `onStartupFinished`, `onCommand:<id>`, `onView:<id>`, `*` (eager)
  - Parallx-specific: no `browser` entry point (no web workers in M2), no `extensionDependencies` (deferred)

**Task 1.2 – Implement Tool Manifest Validator** ✅
- **Task Description:** Implement validation logic that checks a parsed manifest against the schema and reports errors.
- **Output:** `validateManifest(manifest: unknown): ValidationResult` function.
- **Completion Criteria:**
  - ✅ Validates all required fields are present and correctly typed — checks `id`, `name`, `version`, `publisher`, `main`, `engines`, `activationEvents`
  - ✅ Validates `activationEvents` use supported event types — validates prefixes against `SUPPORTED_ACTIVATION_PREFIXES`
  - ✅ Validates `contributes` sub-schemas (view descriptors, command descriptors, etc.) — validates views, viewContainers, commands, configuration, menus, keybindings arrays
  - ✅ Returns structured errors with field path and message (e.g., `contributes.views[0].id: must be a non-empty string`) — `ValidationError { path, message }` with dot-path notation
  - ✅ Validates `engines.parallx` version compatibility against current shell version — supports `^`, `~`, `>=`, exact, and `*` semver ranges against `PARALLX_VERSION`
  - ✅ Warns on unknown fields without failing (forward compatibility) — `ValidationWarning` for unrecognized top-level keys
- **Notes / Constraints:**
  - Do not use a heavy JSON schema library; write focused validation logic
  - Validation should be synchronous and fast

**Task 1.3 – Implement Tool Scanner** ✅
- **Task Description:** Implement discovery of tool manifests from configured directories.
- **Output:** `ToolScanner` class that finds and parses tool manifests.
- **Completion Criteria:**
  - ✅ Scans one or more configured tool directories — `scanDirectories()` accepts array of `{ path, isBuiltin }` entries
  - ✅ Finds `parallx-manifest.json` files in tool subdirectories — IPC handler in `electron/main.cjs` reads subdirectories and parses manifest files
  - ✅ Parses and validates each manifest — scanner calls `validateManifest()` on each discovered manifest
  - ✅ Returns list of valid tool descriptions and list of validation failures — `ToolScanResult { tools, failures, directoryErrors }`
  - ✅ Handles filesystem errors gracefully (permissions, missing dirs) — directory-level and entry-level errors captured without throwing
  - ✅ Supports both built-in tool directory and user tool directory — `scanDefaults()` scans `<appPath>/tools` (builtin) and `~/.parallx/tools` (user) via IPC bridge
- **Notes / Constraints:**
  - Reference only:
    - `src/vs/workbench/services/extensions/node/extensionPoints.ts` — Extension scanner
  - Built-in tools live under `src/tools/` (or similar in-repo path)
  - External tools are loaded from a configurable directory (e.g., `~/.parallx/tools/`)
  - In M2, external tools are manually placed in the directory (no install command yet)
  - Filesystem access uses Electron IPC bridge (renderer has no Node.js access): `electron/main.cjs` handles `tools:scan-directory` and `tools:get-directories`, `electron/preload.cjs` exposes `scanToolDirectory()` and `getToolDirectories()`

**Task 1.4 – Implement Tool Registry** ✅
- **Task Description:** Implement a central registry that holds all validated tool descriptions and tracks their state.
- **Output:** `ToolRegistry` class with registration, lookup, and state tracking.
- **Completion Criteria:**
  - ✅ Tools can be registered from validated manifests — `register(description)` stores and fires `onDidRegisterTool`
  - ✅ Tools can be looked up by ID — `getById(toolId)` returns `IToolEntry | undefined`
  - ✅ Registry tracks tool state: `discovered` → `registered` → `activating` → `activated` → `deactivating` → `deactivated` → `disposed` — `ToolState` enum with `setToolState()` method
  - ✅ Registry rejects duplicate tool IDs — `register()` throws on duplicate
  - ✅ Registry emits events: `onDidRegisterTool`, `onDidChangeToolState` — via `Emitter<T>` pattern
  - ✅ Registry provides query methods: `getAll()`, `getById(id)`, `getByState(state)`, `getContributorsOf(contributionPoint)` — all return `readonly IToolEntry[]`
  - ✅ Registry is a singleton service registered in the DI container — `IToolRegistryService` in `serviceTypes.ts`, registered in `workbenchServices.ts`
  - ✅ State transitions are validated — `VALID_TRANSITIONS` map enforces legal transitions (e.g., cannot go from `discovered` directly to `activated`)
- **Notes / Constraints:**
  - Reference only:
    - `src/vs/workbench/services/extensions/common/extensionDescriptionRegistry.ts` — `ExtensionDescriptionRegistry`
  - Registry is a singleton service registered in the DI container
  - State transitions should be validated (e.g., cannot go from `discovered` directly to `activated`)

---

## Capability 2 – Tool API Boundary

### Capability Description
The system defines a clear API surface (`parallx` namespace) that is the only way tools interact with the shell. The API is a versioned, documented contract that provides access to views, commands, context, configuration, and state — without exposing internal implementation details.

### Goals
- Tools cannot import shell internals; they receive an API object
- API is versioned and stable within a major version
- API object is created per-tool with proper scoping
- API provides access to all M1 extension points (views, commands, context, editors)
- API is type-safe with full TypeScript definitions

### Conceptual Responsibilities
- Define the `parallx` API type definition file
- Implement API factory that creates per-tool API instances
- Scope API access per tool (e.g., tool can only dispose its own resources)
- Map API calls to internal shell services
- Version the API for compatibility

### Dependencies
- Tool Manifest and Registry

### VS Code Reference
- `src/vscode-dts/vscode.d.ts` — The public API type definitions
- `src/vs/workbench/api/common/extHost.api.impl.ts` — `createApiFactoryAndRegisterActors()` — API factory that creates API object per extension
- DeepWiki: [Extension System → API Surface](https://deepwiki.com/microsoft/vscode/8-extension-system) — API Structure, API Factory, Namespaces

#### Tasks

**Task 2.1 – Define Parallx API Type Definitions** ✅
- **Task Description:** Create the `parallx.d.ts` type definition file that defines the complete API surface available to tools. This is the Parallx equivalent of `vscode.d.ts`.
- **Output:** `parallx.d.ts` file with full TypeScript type definitions.
- **Completion Criteria:**
  - ✅ `parallx.views` namespace: `registerViewProvider(viewId, provider)` — with `ViewProvider` and `ViewProviderOptions` types
  - ✅ `parallx.commands` namespace: `registerCommand(id, handler)`, `executeCommand(id, ...args)`, `getCommands()` — with `CommandHandler` type
  - ✅ `parallx.window` namespace: `showInformationMessage()`, `showWarningMessage()`, `showErrorMessage()`, `showInputBox()`, `showQuickPick()`, `createOutputChannel(name)` — with `MessageSeverity`, `MessageAction`, `InputBoxOptions`, `QuickPickItem/Options`, `OutputChannel` types
  - ✅ `parallx.context` namespace: `createContextKey(name, defaultValue)`, `getContextValue(name)` — with `ContextKey<T>` type
  - ✅ `parallx.workspace` namespace: `getConfiguration(section)`, `onDidChangeConfiguration` — with `Configuration` and `ConfigurationChangeEvent` types
  - ✅ `parallx.editors` namespace: `openEditor(input)`, `registerEditorProvider(typeId, provider)` — with `EditorProvider` and `OpenEditorOptions` types
  - ✅ `parallx.tools` namespace: `getAll()`, `getById(id)` (read-only access to tool registry metadata) — returns `ToolInfo` objects
  - ✅ `parallx.env` namespace: `appName`, `appVersion`, `toolPath`
  - ✅ `Disposable` class and `IDisposable` interface exported
  - ✅ `ToolContext` interface matching activation context (subscriptions, globalState, workspaceState, toolPath, toolUri) — with `Memento` interface
  - ✅ All types use structural typing (no class instances cross the boundary)
- **Notes / Constraints:**
  - File location: `src/api/parallx.d.ts`
  - Includes `CancellationToken`, `Event<T>`, and all supporting types (structural, no class instances)

**Task 2.2 – Implement API Factory** ✅
- **Task Description:** Implement a factory function that creates a fresh, scoped API object for each tool upon activation.
- **Output:** `createToolApi(toolDescription, services)` function returning a `typeof parallx` object.
- **Completion Criteria:**
  - ✅ Factory creates a new API object per tool (not shared between tools) — `createToolApi()` in `src/api/apiFactory.ts` creates fresh bridge instances
  - ✅ API object methods are scoped to the calling tool (e.g., `registerCommand` tags the command with the tool's ID) — all bridges receive `toolId` and scope operations
  - ✅ All `Disposable` objects returned by API methods are tracked per-tool for cleanup — shared `subscriptions` array tracked across all bridges
  - ✅ API access failures (e.g., calling after deactivation) throw clear errors — `_throwIfDisposed()` in every bridge
  - ✅ API object is frozen after creation (no monkey-patching) — `Object.freeze()` on all namespace objects and the top-level API
- **Notes / Constraints:**
  - Returns `{ api, dispose }` tuple; `dispose()` cleans up all bridges and subscriptions
  - Takes `ApiFactoryDependencies` containing services, viewManager, toolRegistry, notificationService

**Task 2.3 – Implement API-to-Service Bridge** ✅
- **Task Description:** Implement the bridge layer that maps each API namespace method to the corresponding internal service call.
- **Output:** Bridge implementations for each API namespace (`ViewsBridge`, `CommandsBridge`, `WindowBridge`, `ContextBridge`, `WorkspaceBridge`).
- **Completion Criteria:**
  - ✅ `parallx.views.registerViewProvider()` → `ViewManager.register()` with `IViewDescriptor` wrapping tool's `ViewProvider` into full `IView` adapter (createElement, layout, saveState, etc.)
  - ✅ `parallx.commands.registerCommand()` → `CommandService.registerCommand()` wrapping tool handler into internal `CommandHandler` shape
  - ✅ `parallx.commands.executeCommand()` → `CommandService.executeCommand()` with validation
  - ✅ `parallx.window.showInformationMessage()` → `NotificationService.notify()` with severity and source attribution
  - ✅ `parallx.context.createContextKey()` → `ContextKeyService.createKey()` in tool-scoped scope (`tool:<toolId>`)
  - ✅ `parallx.workspace.getConfiguration()` → `WorkspaceBridge` configuration store scoped to tool's section
  - ✅ Every API call validates the tool is still active before proceeding — `_throwIfDisposed()` in all bridges
  - ✅ All returned `Disposable` objects are registered in the tool's `subscriptions` for cleanup
- **Notes / Constraints:**
  - Six bridge modules in `src/api/bridges/`: `commandsBridge.ts`, `viewsBridge.ts`, `windowBridge.ts`, `contextBridge.ts`, `workspaceBridge.ts`, `editorsBridge.ts`
  - `EditorsBridge` also implemented (Task 2.6) for editor provider registration and opening

**Task 2.4 – Implement Notification System** ✅
- **Task Description:** Implement the shell's notification/toast system that backs `parallx.window.showInformationMessage()`, `showWarningMessage()`, and `showErrorMessage()`.
- **Output:** Notification overlay UI that displays brief messages with optional action buttons.
- **Completion Criteria:**
  - ✅ Three severity levels: information (blue `#3794ff`), warning (yellow `#cca700`), error (red `#f14c4c`) — colored left border
  - ✅ Messages appear as toast overlays in the bottom-right corner of the workbench — fixed positioning with z-index 10000
  - ✅ Messages auto-dismiss after a configurable timeout (default 5 seconds) — `DEFAULT_TIMEOUT_MS = 5000`
  - ✅ Messages can include action buttons that return a Promise with the selected action — `NotificationAction` buttons resolve the promise
  - ✅ Multiple messages stack vertically with newest on top — `prepend()` with flex-column layout
  - ✅ Messages can be dismissed manually via close button — `×` button in top-right corner
  - ✅ `showInputBox()` and `showQuickPick()` render as modal overlays centered in the workbench — `showInputBoxModal()` and `showQuickPickModal()` with backdrop overlay
- **Notes / Constraints:**
  - File location: `src/api/notificationService.ts`
  - Entrance/exit animations (opacity + translateX) for polish
  - `INotificationService` registered in DI container, attached to DOM in Phase 3

**Task 2.5 – Implement API Version Validation** ✅
- **Task Description:** Implement version compatibility checking between the shell's API version and a tool's declared `engines.parallx` requirement.
- **Output:** `isCompatible(engineRequirement, shellVersion)` function using semver-like comparison.
- **Completion Criteria:**
  - ✅ Supports `^`, `~`, `>=`, range syntax for version constraints — plus `*` wildcard and exact match
  - ✅ Shell refuses to activate tools with incompatible engine requirements — `isCompatible()` returns `{ compatible, reason }`
  - ✅ Clear error message identifies version mismatch — specific messages for major/minor mismatch vs. version too low
  - ✅ Shell version is exposed via `parallx.env.appVersion` — reads `PARALLX_VERSION` from toolValidator
- **Notes / Constraints:**
  - File location: `src/api/apiVersionValidation.ts`
  - Reexports `PARALLX_VERSION` for consistency
  - Uses same semver logic as toolValidator.ts but exported as standalone API

**Task 2.6 – Implement Editor Opening API** ✅
- **Task Description:** Implement the `parallx.editors` API namespace that allows tools to open content in the editor area as tabs, using M1's `EditorInput` and `EditorPane` system.
- **Output:** `EditorsBridge` and `IEditorProvider` interface.
- **Completion Criteria:**
  - ✅ Tools can register an editor provider: `parallx.editors.registerEditorProvider(typeId, provider)` where `provider` implements `{ createEditorPane(container: HTMLElement): Disposable }`
  - ✅ Tools can open an editor: `parallx.editors.openEditor({ typeId, title, icon? })` which creates a tab in the active editor group
  - ✅ Editor pane content is rendered by the tool's provider into the provided DOM container — via `ToolEditorInput` which extends `EditorInput`
  - ✅ Editor tabs show the tool-provided title and icon — serialized in `ToolEditorInput.serialize()`
  - ✅ Multiple editors of the same type can be open simultaneously — unique `instanceId` or timestamp-based IDs
  - ✅ Registration returns a `Disposable` for cleanup — tracked in tool's subscriptions
- **Notes / Constraints:**
  - File location: `src/api/bridges/editorsBridge.ts`
  - `ToolEditorInput` extends `EditorInput` (M1) and carries a reference to the tool's provider
  - Editor state persistence deferred to Cap 4 integration

---

## Capability 3 – Tool Lifecycle

### Capability Description
The system can load, activate, and deactivate tools on demand based on activation events. Tools are lazily activated when their declared activation events fire, and cleanly deactivated during disposal with full resource cleanup.

### Goals
- Tools are not loaded until an activation event fires
- Activation is orderly and error-isolated per tool
- Tools receive a `ToolContext` on activation for resource management
- Deactivation cleanly disposes all tool resources
- Tool failures are reported but never crash the shell

### Conceptual Responsibilities
- Monitor activation events and trigger tool loading
- Load tool entry point modules
- Call `activate(context)` on the tool's exported API
- Track activated tools and their subscriptions
- Call `deactivate()` and dispose subscriptions on teardown
- Report and isolate activation/runtime errors

### Dependencies
- Tool Manifest and Registry
- Tool API Boundary

### VS Code Reference
- `src/vs/workbench/api/common/extHostExtensionActivator.ts` — `ExtensionsActivator` class: `activateByEvent()`, dependency resolution, error isolation
- `src/vs/workbench/api/common/extHostExtensionService.ts` — Extension module loading and activation context creation
- `src/vs/workbench/services/extensions/common/abstractExtensionService.ts` — `activateByEvent()` with Immediate/Normal kinds
- DeepWiki: [Extension System → Extension Lifecycle](https://deepwiki.com/microsoft/vscode/8-extension-system) — Activation Events, Activation Sequence

#### Tasks

**Task 3.1 – Implement Activation Event System** ✅
- **Task Description:** Implement the event system that monitors activation triggers and signals when a tool should be activated.
- **Output:** `ActivationEventService` class that listens for and dispatches activation events.
- **Completion Criteria:**
  - ✅ Supports `onStartupFinished` — tool activates after shell initialization completes
  - ✅ Supports `onCommand:<commandId>` — tool activates when a contributed command is first invoked
  - ✅ Supports `onView:<viewId>` — tool activates when a contributed view is first shown
  - ✅ Supports `*` (star) — tool activates eagerly at startup (discouraged but supported)
  - ✅ Events are deduplicated (a tool activates at most once regardless of how many events fire) — `_activatedTools` Set in ActivationEventService
  - ✅ Events that fire before a tool is registered are queued and replayed — `_pendingEvents` Set with replay in `registerToolEvents()`
  - ✅ Activation events emit through the shell's event bus for observability — `onDidFireEvent` emitter
- **Notes / Constraints:**
  - File location: `src/tools/activationEventService.ts`
  - Includes `parseActivationEvent()` utility for structured event parsing
  - `fireStartupFinished()` triggers both `*` and `onStartupFinished` events
  - Registered as `IActivationEventService` in DI container

**Task 3.2 – Implement Tool Module Loader** ✅
- **Task Description:** Implement the loader that imports a tool's entry point module and extracts its `activate` and `deactivate` exports.
- **Output:** `ToolModuleLoader` class with `loadModule(manifestPath, mainEntry)` method.
- **Completion Criteria:**
  - ✅ Loads the tool's `main` entry point using dynamic `import()` — webpackIgnore comment for esbuild compatibility
  - ✅ Validates the module exports an `activate` function
  - ✅ Validates optional `deactivate` function export — warns if exported but not a function
  - ✅ Reports clear error if module fails to load (syntax error, missing file, etc.) — returns `LoadModuleResult` with error string
  - ✅ Handles both `.js` and `.ts` (compiled) entry points — path resolution is extension-agnostic
  - ✅ Returns a typed `ToolModule` object: `{ activate: ActivateFunction, deactivate?: DeactivateFunction }` — includes `rawModule` for diagnostics
- **Notes / Constraints:**
  - File location: `src/tools/toolModuleLoader.ts`
  - Also exports `ToolContext`, `Memento`, `ActivateFunction`, `DeactivateFunction` types
  - In M2, tools run in-process — no RPC or worker isolation

**Task 3.3 – Implement Tool Activation** ✅
- **Task Description:** Implement the activation flow that creates a `ToolContext`, calls the tool's `activate()` function, and tracks the activated tool.
- **Output:** `ToolActivator` class with `activate(toolId)` method.
- **Completion Criteria:**
  - ✅ Creates a `ToolContext` object with: `subscriptions`, `globalState` (Memento), `workspaceState` (Memento), `toolPath`, `toolUri`, `environmentVariableCollection` (placeholder) — uses `InMemoryMemento` (full persistent Memento deferred to Cap 4)
  - ✅ Creates a scoped API object via the API factory (Capability 2) — calls `createToolApi(description, deps)`
  - ✅ Calls `tool.activate(api, context)` with the context and API — handles both sync and async activation
  - ✅ Wraps activation in a try/catch — failure logs error via ToolErrorService and marks tool as `Deactivated`
  - ✅ Tracks the `ActivatedTool` record (module reference, context, subscriptions, exports) — stored in `_activatedTools` Map
  - ✅ Updates tool state in the registry from `registered` → `activating` → `activated` (or `Deactivated` on failure)
  - ✅ Times activation and logs duration for performance monitoring — `performance.now()` timing
- **Notes / Constraints:**
  - File location: `src/tools/toolActivator.ts`
  - Activation signature: `activate(api, context)` — API first, context second
  - Phase 5 (Ready) in workbench.ts creates the activator and fires `fireStartupFinished()`
  - Registered as `IToolActivatorService` in DI container

**Task 3.4 – Implement Tool Deactivation** ✅
- **Task Description:** Implement the deactivation flow that calls a tool's `deactivate()` function and cleans up all associated resources.
- **Output:** `ToolActivator.deactivate(toolId)` method.
- **Completion Criteria:**
  - ✅ Calls the tool's `deactivate()` function if exported (wrapped in try/catch)
  - ✅ Disposes all items in `context.subscriptions` array — reverse-order disposal
  - ✅ Unregisters all commands contributed by this tool — via API bridge dispose
  - ✅ Removes all views contributed by this tool — via API bridge dispose
  - ✅ Removes all context keys created by this tool — via API bridge dispose
  - ✅ Updates tool state in registry: `activated` → `deactivating` → `deactivated`
  - ✅ Clears references to the tool module for garbage collection — `_activatedTools.delete()`
  - ✅ Logs deactivation result (success or errors encountered during cleanup)
- **Notes / Constraints:**
  - Deactivation is tolerant — continues disposing subscriptions even if `deactivate()` throws
  - Order: deactivate() → subscriptions → API bridges → references
  - `deactivateAll()` method for shell teardown
  - Teardown wired in Phase Ready of workbench lifecycle

**Task 3.5 – Implement Tool Error Isolation** ✅
- **Task Description:** Implement error boundary logic that prevents tool failures from affecting the shell or other tools.
- **Output:** Error wrapping utilities and error reporting infrastructure.
- **Completion Criteria:**
  - ✅ All tool-originated calls (activation, command handlers, view providers) are wrapped in try/catch — `wrap()` and `wrapAsync()` utilities
  - ✅ Errors are attributed to the originating tool (by tool ID) — `ToolError.toolId` field
  - ✅ Errors are logged with tool ID, error message, and stack trace — `console.error()` with full context
  - ✅ Repeated errors from the same tool trigger a warning (potential infinite loop detection) — rapid-error detection: 5 errors in 5s window
  - ✅ Shell provides `parallx.window.showErrorMessage()` for tools to report their own errors — via WindowBridge (Cap 2)
  - ✅ A tool error summary is available for debugging (e.g., `getToolErrors(toolId)`) — plus `getErrorCount()`, `getAllErrors()`
- **Notes / Constraints:**
  - File location: `src/tools/toolErrorIsolation.ts`
  - Maximum error count (50) before `onShouldForceDeactivate` fires
  - Warning at 10 errors, force-deactivation signal at 50
  - Registered as `IToolErrorService` in DI container

---

## Capability 4 – Tool Configuration and State

### Capability Description
The system provides scoped persistent storage for tools (Memento pattern) and allows tools to contribute configuration schemas that appear in a settings system. Tools own their data; the shell provides the storage infrastructure.

### Goals
- Each tool has dedicated global and workspace-scoped storage
- Tools can contribute typed configuration schemas
- Configuration changes emit events for reactive updates
- State persists across sessions via the workspace state system (M1 Capability 5)
- Configuration values have defined defaults from the manifest

### Conceptual Responsibilities
- Implement Memento storage scoped per tool
- Implement configuration contribution point
- Implement configuration read/write API
- Integrate configuration with workspace persistence
- Emit configuration change events

### Dependencies
- Tool Manifest and Registry
- Tool API Boundary
- Workspace State Persistence (M1)

### VS Code Reference
- `src/vs/workbench/common/memento.ts` — `Memento` class for scoped storage
- `src/vs/platform/extensionManagement/common/extensionStorage.ts` — Extension-scoped storage service
- `src/vscode-dts/vscode.d.ts` lines 8000-8200 — `ExtensionContext.globalState`, `ExtensionContext.workspaceState`, `SecretStorage`
- DeepWiki: [Extension System → Extension Storage and Secrets](https://deepwiki.com/microsoft/vscode/8-extension-system) — Storage Scopes

#### Tasks

**Task 4.1 – Implement Tool Memento Storage** ✅
- **Task Description:** Implement the Memento pattern providing tools with `globalState` and `workspaceState` key-value stores.
- **Output:** `ToolMemento` class implementing `get<T>(key, defaultValue?)` and `update(key, value)`.
- **Completion Criteria:**
  - ✅ `globalState` persists across all workspaces (stored in global storage namespace) — namespace `tool-global:<toolId>/`
  - ✅ `workspaceState` persists only within the current workspace (stored in workspace storage namespace) — namespace `tool-ws:<toolId>/`
  - ✅ Keys are namespaced by tool ID to prevent collisions (e.g., `tool-global:myTool/key`)
  - ✅ Values are JSON-serialized — `JSON.stringify()` on write, `JSON.parse()` on read
  - ✅ `get<T>(key)` returns `T | undefined`; `get<T>(key, defaultValue)` returns `T` — function overloads
  - ✅ `update(key, value)` is async (returns `Promise<void>`) — pass `undefined` to delete
  - ✅ `keys()` returns all stored keys for the tool — strips namespace prefix
  - ✅ Integrates with M1's `IStorage` abstraction — constructor takes `IStorage`, uses `get`/`set`/`delete`/`keys`
- **Notes / Constraints:**
  - File location: `src/configuration/toolMemento.ts`
  - `createToolMementos()` factory creates global + workspace pair
  - `load()` hydrates in-memory cache from storage; `flush()` persists cache to storage
  - Storage quota per tool: warn at 5MB, hard limit at 10MB
  - Non-JSON-serializable values throw with clear error message
  - ToolActivator now uses `ToolMemento` instead of `InMemoryMemento` when storage deps are available; falls back to `InMemoryMemento` when not

**Task 4.2 – Implement Configuration Contribution Point** ✅
- **Task Description:** Implement the `contributes.configuration` manifest section that allows tools to define typed settings with defaults.
- **Output:** Configuration schema processing and registration in the shell's configuration system.
- **Completion Criteria:**
  - ✅ Tools declare configuration in manifest: `{ "contributes": { "configuration": { "title": "My Tool", "properties": { "myTool.setting1": { "type": "string", "default": "value", "description": "..." } } } } }` — parsed from `IManifestConfigurationDescriptor`
  - ✅ Shell parses and registers configuration schemas at manifest load time — `ConfigurationRegistry.registerFromManifest()` called during tool activation
  - ✅ Schemas define type, default, description, enum values, and validation constraints — `IConfigurationPropertySchema` with runtime `validateValue()`
  - ✅ Registered configurations are queryable by section — `getAllSchemas()`, `getAllSections()`, `getToolSchemas(toolId)`
  - ✅ Invalid configuration values fall back to defaults — `ConfigurationService._getValue()` checks explicit → registered default → caller default
- **Notes / Constraints:**
  - File location: `src/configuration/configurationRegistry.ts`
  - `registerProperties()` for programmatic registration, `registerFromManifest()` for manifest-based
  - `unregisterTool(toolId)` removes all schemas contributed by a tool
  - `onDidChangeSchema` event fires when schemas are added or removed
  - Validation warns on type mismatch but does not block writes (forward compatibility)

**Task 4.3 – Implement Configuration Service** ✅
- **Task Description:** Implement a configuration service that tools access through `parallx.workspace.getConfiguration()`.
- **Output:** `ConfigurationService` class with get/update/onDidChange methods.
- **Completion Criteria:**
  - ✅ `getConfiguration(section?)` returns a `WorkspaceConfiguration` object — `ScopedConfiguration` class with section-prefixed key resolution
  - ✅ `WorkspaceConfiguration.get<T>(key, defaultValue?)` reads a setting value — checks explicit → registered default → caller default
  - ✅ `WorkspaceConfiguration.update(key, value)` writes a setting value — persists to `IStorage` under `config:` prefix
  - ✅ `WorkspaceConfiguration.has(key)` checks if a setting exists — checks both explicit values and registered schemas
  - ✅ `onDidChangeConfiguration` event fires with affected keys when settings change — `IConfigurationChangeEvent` with `affectsConfiguration()` and `affectedKeys`
  - ✅ Default values from manifest are used when no explicit value is set — registry defaults from `IConfigurationPropertySchema`
  - ✅ Configuration values are stored per-workspace — uses workspace-scoped `IStorage` via `NamespacedStorage`
- **Notes / Constraints:**
  - File location: `src/configuration/configurationService.ts`
  - Shared types in `src/configuration/configurationTypes.ts`
  - `IConfigurationService` registered in DI container via `registerConfigurationServices()` in Phase 1
  - `ConfigurationService.load()` hydrates in-memory cache from storage during Phase 4 (workspace restore)
  - `WorkspaceBridge` now delegates to `ConfigurationService` instead of maintaining its own config store
  - `ApiFactoryDependencies` extended with optional `configurationService` field
  - Schema change events propagated as configuration change events (tools see new defaults immediately)

---

## Capability 5 – Command Contribution from Tools

### Capability Description
Tools can contribute commands through their manifest and register runtime command handlers through the API. Contributed commands integrate with the existing command palette from M1 and respect when-clause activation conditions.

### Goals
- Tools declare commands in their manifest's `contributes.commands` section
- Runtime registration wires handlers to declared commands
- Commands appear in the command palette with proper metadata
- Commands can have keybinding contributions
- Commands respect when clauses for conditional enablement
- Menu contributions place commands in context menus and title bars

### Conceptual Responsibilities
- Process `contributes.commands` from manifests
- Register proxy commands for lazy activation
- Wire tool-registered handler to proxy when tool activates
- Process `contributes.keybindings` from manifests
- Process `contributes.menus` from manifests
- Integrate with M1's CommandService and CommandPalette

### Dependencies
- Tool API Boundary
- Tool Lifecycle

### VS Code Reference
- `src/vs/workbench/api/common/extHostCommands.ts` — `ExtHostCommands`: `registerCommand`, `executeCommand`, `$executeContributedCommand`
- `src/vs/workbench/api/browser/mainThreadCommands.ts` — Renderer-side command proxy
- `src/vs/workbench/services/extensions/common/extensionsApiProposals.ts` — Command contribution from extensions
- DeepWiki: [Extension System → ExtHostCommands](https://deepwiki.com/microsoft/vscode/8-extension-system) — Command registration and execution flow

#### Tasks

**Task 5.1 – Implement Command Contribution Processing** ✅
- **Task Description:** Process the `contributes.commands` section from tool manifests and register command metadata in the command service.
- **Output:** Command contribution processor that reads manifests and registers command descriptors.
- **Completion Criteria:**
  - ✅ Manifest `contributes.commands` schema: `[{ "command": "myTool.doSomething", "title": "Do Something", "category": "My Tool", "icon": "...", "enablement": "when clause" }]` — parsed in `CommandContributionProcessor.processContributions()`
  - ✅ Each declared command is registered in `CommandService` with metadata (title, category, icon, when clause) — `CommandDescriptor` created with all manifest fields, registered via `commandService.registerCommand()`
  - ✅ A proxy handler is registered that triggers tool activation on first invocation — proxy fires `activationEventService.fireActivationEvent('onCommand:' + id)` then queues the invocation with a 10 s timeout
  - ✅ After tool activation, the proxy handler is replaced with the tool's real handler — `wireRealHandler()` swaps the handler in CommandService and replays all queued invocations
  - ✅ Commands contributed by a tool are unregistered when the tool is deactivated — `removeContributions(toolId)` unregisters all commands and cleans tracking maps; wired to `onDidDeactivate` in `workbench.ts`
- **Notes / Constraints:**
  - Commands should be prefixed or namespaced to avoid collisions (manifest validation ensures `tool.id` prefix)
  - Proxy handlers should queue the invocation and replay it once the real handler is available
- **Implementation Notes:**
  - New file: `src/contributions/commandContribution.ts` — `CommandContributionProcessor extends Disposable implements IContributionProcessor`
  - New file: `src/contributions/contributionTypes.ts` — shared types `IContributedCommand`, `IContributedKeybinding`, `IContributedMenuItem`, `MenuLocationId`, `IContributionProcessor`
  - Modified: `src/api/bridges/commandsBridge.ts` — `registerCommand()` detects contributed commands and calls `wireRealHandler()` instead of re-registering
  - Service identifier `ICommandContributionService` added to `src/services/serviceTypes.ts`

**Task 5.2 – Implement Keybinding Contribution Processing** ✅
- **Task Description:** Process the `contributes.keybindings` section from tool manifests and register keybindings.
- **Output:** Keybinding contribution processor.
- **Completion Criteria:**
  - ✅ Manifest `contributes.keybindings` schema: `[{ "command": "myTool.doSomething", "key": "ctrl+shift+t", "when": "when clause" }]` — parsed in `KeybindingContributionProcessor.processContributions()`
  - ✅ Keybindings are registered in a keybinding service — `KeybindingContributionProcessor` maintains a keybinding map from normalized key combos to command IDs; registered as `IKeybindingContributionService` in DI container
  - ✅ Keybinding conflicts are detected and logged (last registered wins) — `console.warn` emitted on conflict, previous binding replaced
  - ✅ Keybindings are shown in the command palette alongside their commands — `CommandPalette` queries `IKeybindingContributionLike.getKeybindingForCommand()` and displays via `formatKeybindingForDisplay()`
  - ✅ Keybindings respect platform differences (Ctrl vs Cmd) — `formatKeybindingForDisplay()` uses `navigator.platform` to show ⌘/⌃/⌥/⇧ on Mac, Ctrl/Alt/Shift on others
- **Notes / Constraints:**
  - M2 keybinding support is basic — a keybinding map from key combos to command IDs
  - A full keybinding resolution system with chords and contexts is deferred to a later milestone
  - Keybindings should integrate with M1's `CommandPalette` display
- **Implementation Notes:**
  - New file: `src/contributions/keybindingContribution.ts` — `KeybindingContributionProcessor extends Disposable implements IContributionProcessor`
  - Key normalization: `normalizeKeybinding()` sorts modifiers alphabetically (alt, ctrl, meta, shift) + lowercase key for reliable matching
  - Global `keydown` listener on `document` dispatches to `commandService.executeCommand()` when normalized key matches; respects when-clause via optional `IContextKeyServiceLike`
  - Service identifier `IKeybindingContributionService` added to `src/services/serviceTypes.ts`

**Task 5.3 – Implement Menu Contribution Processing** ✅
- **Task Description:** Process the `contributes.menus` section from tool manifests to place commands in menus.
- **Output:** Menu contribution processor and basic menu rendering system.
- **Completion Criteria:**
  - ✅ Manifest `contributes.menus` schema: `{ "commandPalette": [{ "command": "id", "when": "clause" }], "view/title": [{ "command": "id", "group": "navigation" }], "view/context": [{ "command": "id", "when": "clause" }] }` — parsed in `MenuContributionProcessor.processContributions()`
  - ✅ Menu items are conditional on when clauses — `_evaluateWhen()` integrates with `IContextKeyServiceLike` for runtime evaluation
  - ✅ `commandPalette` menu controls whether a command appears in the palette — `isCommandVisibleInPalette()` used by `CommandPalette._updateList()` to filter commands
  - ✅ `view/title` adds action buttons to view title bars — `renderViewTitleActions()` creates `<button>` elements positioned in a flex container, with title tooltip and click → `commandService.executeCommand()`
  - ✅ `view/context` adds items to view right-click context menus — `showViewContextMenu()` renders a positioned overlay with items sorted by group, group separators, and click-to-execute; overlay auto-dismisses on outside click or Escape
  - ✅ Menu items are sorted by `group` and `order` properties — items sorted by group string first, then numeric order within group
- **Notes / Constraints:**
  - Reference only:
    - VS Code's menu contribution point: https://code.visualstudio.com/api/references/contribution-points#contributes.menus
  - M2 implements a basic menu system — full theming and nested submenus are deferred
  - Context menus are triggered by right-click events on view containers
- **Implementation Notes:**
  - New file: `src/contributions/menuContribution.ts` — `MenuContributionProcessor extends Disposable implements IContributionProcessor`
  - Three menu locations supported: `commandPalette`, `view/title`, `view/context` (typed as `MenuLocationId`)
  - `CommandPalette` updated with `setMenuContribution()` / `setKeybindingContribution()` setter methods and `IMenuContributionLike` / `IKeybindingContributionLike` interfaces for loose coupling
  - Service identifier `IMenuContributionService` added to `src/services/serviceTypes.ts`
  - All three contribution processors created and wired in `workbench.ts._initializeToolLifecycle()`, registered in DI via `workbenchServices.ts.registerContributionProcessors()`

---

## Capability 6 – Declarative View and ViewContainer Contribution

### Capability Description
Tools can contribute views and view containers through their manifest's `contributes` section. Contributed views integrate with the M1 view system (ViewDescriptor, ViewManager, ViewContainer) and are rendered in the appropriate workbench parts.

### Goals
- Tools declare views and view containers in their manifest
- Views are created lazily when their container becomes visible
- View containers route to sidebar, panel, or auxiliary bar as declared
- Tools implement view content through the API's view provider pattern
- When clauses control view visibility

### Conceptual Responsibilities
- Process `contributes.viewsContainers` from manifests
- Process `contributes.views` from manifests
- Create view descriptors and register with ViewManager
- Implement view provider pattern for tool-rendered content
- Lazy-create views when containers become visible
- Handle view activation events

### Dependencies
- Tool API Boundary
- Tool Lifecycle
- View Hosting and Lifecycle (M1)

### VS Code Reference
- `src/vs/workbench/api/browser/viewsExtensionPoint.ts` — `ViewsExtensionHandler`: processes `contributes.viewsContainers` and `contributes.views`, routes to sidebar/panel/auxBar
- `src/vs/workbench/common/views.ts` — `IViewsRegistry`, `IViewContainersRegistry`, `IViewDescriptor`, `ViewContainer`
- `src/vs/workbench/browser/parts/views/viewDescriptorService.ts` — View descriptor management
- DeepWiki: [Workbench Architecture → Parts Overview](https://deepwiki.com/microsoft/vscode/7-workbench-architecture) — Part structure and view hosting

#### Tasks

**Task 6.1 – Implement ViewContainer Contribution Processing** ✅
- **Task Description:** Process the `contributes.viewsContainers` section from tool manifests and register new view containers in the appropriate workbench parts.
- **Output:** ViewContainer contribution processor.
- **Completion Criteria:**
  - Manifest schema: `{ "contributes": { "viewsContainers": { "sidebar": [{ "id": "myContainer", "title": "My Container", "icon": "..." }], "panel": [...], "auxiliaryBar": [...] } } }`
  - Each declared container is registered with the M1 `PartRegistry` / view container system
  - Container location (sidebar, panel, auxiliaryBar) determines which part hosts it
  - Container has an icon and title for the activity bar entry
  - Container is created lazily (no DOM until first view is shown)
  - Container contributed by a tool is removed when the tool is deactivated
- **Notes / Constraints:**
  - Reference only:
    - `src/vs/workbench/api/browser/viewsExtensionPoint.ts` — `ViewsExtensionHandler` class, `handleAndRegisterCustomViewContainers()`
  - Sidebar containers get an activity bar icon; panel containers get a tab; auxiliary bar containers get a secondary activity bar icon
  - Built-in containers from M1 (explorer, terminal, etc.) remain; tool-contributed containers are additive
- **Implementation Notes:** `ViewContributionProcessor` in `src/contributions/viewContribution.ts` processes manifest `viewContainers` array. Workbench creates `ViewContainer` DOM via `_onToolContainerAdded()`, mounting into sidebar-views/panel-views/aux-bar slots. Containers are disposed on tool deactivation via `_onToolContainerRemoved()` and in `_teardownWorkspaceContent()`.
- **Deviation:** The manifest schema uses a flat `viewContainers: [{ id, title, icon, location }]` array instead of the nested `{ sidebar: [...], panel: [...] }` format. The flat format was already established by the existing M2 validator and is functionally equivalent.

**Task 6.2 – Implement View Contribution Processing** ✅
- **Task Description:** Process the `contributes.views` section from tool manifests and register view descriptors.
- **Output:** View contribution processor.
- **Completion Criteria:**
  - Manifest schema: `{ "contributes": { "views": { "myContainer": [{ "id": "myView", "name": "My View", "when": "when clause", "icon": "..." }] } } }`
  - Views are keyed by container ID (referencing a built-in or tool-contributed container)
  - Each view becomes a `ViewDescriptor` registered with `ViewManager`
  - Views specify optional `when` clause for conditional visibility
  - Views are created lazily when their container is first shown
  - The view's actual content is provided by a `ViewProvider` registered at runtime via the API
- **Notes / Constraints:**
  - Reference only:
    - `src/vs/workbench/api/browser/viewsExtensionPoint.ts` — View descriptor creation from extension manifest
    - `src/vs/workbench/common/views.ts` — `IViewDescriptor` interface
  - If a view is declared but no provider is registered, show a placeholder with the view name and a message
  - Views contributed to unknown containers log a warning
- **Implementation Notes:** `ViewContributionProcessor.processContributions()` iterates `contributes.views` (keyed by container ID), creates `ViewDescriptor` per entry with an async factory (placeholder until provider resolves), and registers via `ViewManager.register()`. Views added to contributed containers trigger workbench `_onToolViewAdded()` which calls `ViewManager.createView()` + `ViewContainer.addView()`.

**Task 6.3 – Implement View Provider Pattern** ✅
- **Task Description:** Implement the runtime API for tools to provide view content. A tool registers a `ViewProvider` that the shell calls to render view content.
- **Output:** `IViewProvider` interface and `registerViewProvider()` API method.
- **Completion Criteria:**
  - `IViewProvider` interface: `{ resolveView(viewId: string, container: HTMLElement): void | Disposable }`
  - Tools call `parallx.views.registerViewProvider(viewId, provider)` during activation
  - When the shell needs to show the view, it calls `provider.resolveView(viewId, container)`
  - The tool renders its UI into the provided `container` element
  - Provider registration returns a `Disposable` for cleanup
  - If a provider is registered before the view is shown, the view is rendered on first show
  - If a provider is registered after the view is already showing, the view is immediately rendered
- **Notes / Constraints:**
  - This is the primary mechanism for tools to create UI — they receive a DOM container and own its contents
  - The shell does not interpret or manage the tool's DOM — the tool has full control within its container
  - View providers should handle `layout(width, height)` calls for responsive behavior
- **Implementation Notes:** `IToolViewProvider` interface in `viewContribution.ts`. `ViewsBridge.registerViewProvider()` detects manifest-contributed views via `_viewContributionProcessor.hasContributedView()` and delegates to `processor.registerProvider()`, wrapping the tool's `createView` callback into the `IToolViewProvider.resolveView` pattern. Pending resolver map (`_pendingResolvers`) handles both pre- and post-registration timing.

**Task 6.4 – Implement Activity Bar Integration** ✅
- **Task Description:** Extend the M1 sidebar activity bar to display icons for tool-contributed view containers.
- **Output:** Dynamic activity bar population from registered view containers.
- **Completion Criteria:**
  - Activity bar shows icons for all registered sidebar view containers
  - Clicking an activity bar icon switches the sidebar to that container's views
  - Active container is visually indicated (highlighted icon)
  - Activity bar updates dynamically when tools contribute or remove containers
  - Ordering respects a priority value from the manifest (lower = higher position)
  - Built-in containers appear first; tool-contributed containers appear below
- **Notes / Constraints:**
  - M1's sidebar already has a basic activity bar; this task extends it for dynamic population
  - Icon format in M2: simple text/emoji or class name reference (full icon theming deferred)
- **Implementation Notes:** `_addContributedActivityBarIcon()` inserts a separator between built-in and contributed icons, then adds a button with click handler calling `_switchSidebarContainer()`. `_switchSidebarContainer()` hides/shows containers, updates active highlights across all icons, and updates the sidebar header label. Built-in icon clicks now call `_switchSidebarContainer(undefined)` to properly deactivate contributed containers. Separator and contributed icons are cleaned up on tool deactivation.

---

## Capability 7 – Built-In Tools

### Capability Description
A small set of built-in tools ship with Parallx to validate the tool system end-to-end and provide baseline functionality. Built-in tools use the exact same manifest and API as external tools — no special-casing. They serve as reference implementations and smoke tests for Capabilities 1–6.

### Goals
- At least 2 built-in tools that exercise the full contribution surface
- Built-in tools use `parallx-manifest.json` and the `parallx` API exclusively
- Built-in tools demonstrate views, commands, configuration, and state
- Built-in tools serve as documentation by example for tool authors

### Conceptual Responsibilities
- Provide reference tool implementations
- Exercise all contribution points (views, commands, config, menus)
- Validate the full tool lifecycle (discovery → activation → runtime → deactivation)
- Provide baseline utility to an empty Parallx workbench

### Dependencies
- All of Capabilities 1–6

#### Tasks

**Task 7.1 – Implement Welcome Tool** ✅
- **Task Description:** Create a built-in "Welcome" tool that contributes a welcome view to the editor area, showing getting-started content and recent workspaces.
- **Output:** Complete Welcome tool with manifest, entry point, and view provider.
- **Completion Criteria:**
  - `parallx-manifest.json` declares: identity, `onStartupFinished` activation, contributes a view, contributes commands
  - Entry point exports `activate(parallx, context)` and `deactivate()`
  - View renders a welcome page with Parallx logo/name, version, links, and recent workspace list
  - Contributes `welcome.openWelcome` command to show the welcome view
  - Uses `context.globalState` to track whether this is the first launch (show welcome automatically on first launch)
  - View content is plain DOM (no framework)
- **Notes / Constraints:**
  - This tool validates: manifest loading, activation events, editor opening API, command contribution, Memento state
  - The welcome view opens in the editor area as an editor tab via `parallx.editors.openEditor()` (uses `EditorInput` + `EditorPane` from M1)
  - Keep content simple and structural — it demonstrates the system, not a polished UX
- **Implementation Notes:** `src/built-in/welcome/main.ts` — registers EditorProvider (EDITOR_TYPE_ID `parallx.welcome.editor`), contributes `welcome.openWelcome` command. Uses `context.globalState` with `welcome.hasShownWelcome` key to auto-open on first launch. Plain DOM with logo, version, getting-started items, footer.
- **Deviation:** Built-in tools are statically imported and activated via `ToolActivator.activateBuiltin()` (bypasses ToolModuleLoader) since esbuild IIFE bundles can't dynamically import bundled modules. Manifests are defined inline in workbench.ts. The manifest JSON files still exist as reference documentation.

**Task 7.2 – Implement Output Tool** ✅
- **Task Description:** Create a built-in "Output" tool that contributes an output panel view showing log messages from tools and the shell.
- **Output:** Complete Output tool with manifest, entry point, and view provider.
- **Completion Criteria:**
  - `parallx-manifest.json` declares: identity, `onStartupFinished` activation, contributes a panel view, contributes commands
  - Entry point exports `activate(parallx, context)` and `deactivate()`
  - View renders a scrollable log viewer in the panel area
  - Contributes `output.clear` command to clear the log
  - Contributes `output.toggleTimestamps` command to show/hide timestamps
  - Exposes an output channel pattern: tools can write to named output channels via `parallx.window.createOutputChannel(name)`
  - Uses `context.workspaceState` to persist view settings (timestamp visibility, scroll position)
- **Notes / Constraints:**
  - This tool validates: panel view contribution, commands, workspace state, tool-to-tool communication via API
  - Output channel API: `parallx.window.createOutputChannel(name)` returns `{ appendLine(msg), clear(), show(), dispose() }`
  - Log entries are in-memory (not persisted) — configuration for persistence is a future feature
- **Implementation Notes:** `src/built-in/output/main.ts` — registers panel view provider for `view.output` (defaultContainerId: panel). Intercepts `console.log/warn/error` to capture tool and shell output. Toolbar with timestamp toggle and clear button. Capped at 1000 entries. Uses `context.workspaceState` for `output.showTimestamps`. Creates own output channel via `api.window.createOutputChannel('Output Tool')`.

**Task 7.3 – Implement Tool Gallery View** ✅
- **Task Description:** Create a built-in "Tools" view that shows all registered tools, their status, and contribution summary — analogous to VS Code's Extensions view.
- **Output:** Complete Tools tool with manifest, entry point, and view provider.
- **Completion Criteria:**
  - `parallx-manifest.json` declares: identity, `onStartupFinished` activation, contributes a sidebar view container and view
  - Entry point exports `activate(parallx, context)` and `deactivate()`
  - View renders a list of all registered tools with: name, version, status (activated/deactivated/error), contribution summary
  - Clicking a tool shows detail (manifest info, contributed views, commands, configuration)
  - View updates dynamically when tools are activated or deactivated
  - Contributes `tools.showInstalled` command to focus the tools view
- **Notes / Constraints:**
  - This tool validates: sidebar view container contribution, dynamic data rendering, registry querying
  - This is a read-only view in M2 (no install/uninstall actions — marketplace is deferred)
  - Tool list is fetched from ToolRegistry via `parallx.tools.getAll()` and `parallx.tools.getById(id)`
- **Implementation Notes:** `src/built-in/tool-gallery/main.ts` — contributes `tools-container` sidebar view container (icon 🧩) and `view.tools` view. Renders a scrollable tool list from `api.tools.getAll()` with name, version, built-in badge, and description. Click shows detail panel with ID, publisher, path. Manual refresh button. Uses Cap 6 activity bar integration to add a sidebar icon.

---

## File Structure Additions

The following files and directories are added in Milestone 2. Existing M1 files are unchanged unless noted as modified.

```txt
src/
├─ tools/                           # Tool system infrastructure
│  ├─ toolManifest.ts               # IToolManifest interface, manifest types
│  ├─ toolValidator.ts              # Manifest validation logic
│  ├─ toolScanner.ts                # Filesystem tool discovery
│  ├─ toolRegistry.ts               # Central tool registry (includes ToolState enum)
│  ├─ toolModuleLoader.ts           # Dynamic import() loader for tool entry points
│  ├─ toolActivator.ts              # Activation/deactivation lifecycle (includes ActivatedTool)
│  ├─ toolErrorIsolation.ts         # Error isolation and reporting
│  ├─ activationEventService.ts     # Activation event monitoring
│  └─ parallx-manifest.schema.json  # JSON Schema for IDE-assisted manifest editing
│
├─ api/                             # Tool API boundary
│  ├─ parallx.d.ts                  # Public API type definitions
│  ├─ apiFactory.ts                 # Per-tool API object factory (also wires parallx.tools inline)
│  ├─ apiVersionValidation.ts       # Version compatibility checking
│  ├─ notificationService.ts        # Toast/notification overlay UI
│  └─ bridges/
│     ├─ viewsBridge.ts             # parallx.views → ViewManager
│     ├─ commandsBridge.ts          # parallx.commands → CommandService
│     ├─ windowBridge.ts            # parallx.window → notification/dialog system
│     ├─ contextBridge.ts           # parallx.context → ContextKeyService
│     ├─ workspaceBridge.ts         # parallx.workspace → ConfigurationService
│     └─ editorsBridge.ts           # parallx.editors → EditorService/EditorGroupService
│
├─ configuration/                   # Configuration system
│  ├─ configurationService.ts       # Configuration read/write/events
│  ├─ configurationRegistry.ts      # Schema registration from manifests
│  ├─ configurationTypes.ts         # Configuration-related types
│  └─ toolMemento.ts                # Per-tool Memento implementation
│
├─ contributions/                   # Contribution point processors
│  ├─ contributionTypes.ts          # Shared contribution types and IContributionProcessor
│  ├─ commandContribution.ts        # contributes.commands processor
│  ├─ keybindingContribution.ts     # contributes.keybindings processor
│  ├─ menuContribution.ts           # contributes.menus processor
│  └─ viewContribution.ts           # contributes.views + viewsContainers processor (Cap 6)
│
├─ built-in/                        # Built-in tools — each is a self-contained tool (Cap 7)
│  ├─ welcome/
│  │  ├─ parallx-manifest.json      # Welcome tool manifest
│  │  └─ main.ts                    # Welcome tool entry point
│  ├─ output/
│  │  ├─ parallx-manifest.json      # Output tool manifest
│  │  └─ main.ts                    # Output tool entry point
│  └─ tool-gallery/
│     ├─ parallx-manifest.json      # Tool Gallery manifest
│     └─ main.ts                    # Tool Gallery entry point
│
└─ main.ts                          # (MODIFIED) Boot sequence includes tool system init
```

---

## Testing Strategy

### Unit Tests
- **Tool Manifest Validator:** Test with valid, invalid, missing-field, and extra-field manifests
- **Tool Registry:** Test registration, duplicate rejection, state transitions, queries
- **API Factory:** Test per-tool scoping, API freeze, post-deactivation access rejection
- **Version Compatibility:** Test semver range matching for `engines.parallx`
- **Configuration Service:** Test get/set/defaults/events with tool-scoped configurations
- **Memento Storage:** Test get/set/keys/namespacing for global and workspace scopes
- **Activation Events:** Test event firing, deduplication, queuing, replay
- **When Clause:** Test command enablement and view visibility with contributed when clauses

### Integration Tests
- **Full Tool Lifecycle:** Load manifest → register → activate via event → run command → deactivate → verify cleanup
- **Multi-Tool Interaction:** Two tools contribute commands and views; verify no cross-contamination
- **Error Isolation:** Tool A throws in activate(); verify Tool B still activates and runs correctly
- **Workspace Switching:** Activate tools → switch workspace → verify workspace state isolates per-tool
- **Contribution Processing:** Load manifest with views, commands, and configuration → verify all contributions appear in shell

### Manual Verification
- **Built-In Tools:** Start Parallx → Welcome tool opens → Output panel shows logs → Tools view lists all tools
- **Command Palette:** Open palette → tool-contributed commands appear with proper titles and keybindings
- **Activity Bar:** Tool-contributed sidebar container appears with icon → clicking navigates to views
- **View Lifecycle:** Navigate away from tool view → navigate back → view is restored (not recreated)
- **Error Handling:** Introduce a syntax error in a tool → shell starts cleanly → error is reported in output

---

## Success Criteria

| # | Criterion | Description |
|---|-----------|-------------|
| **0** | **M1 Gap Cleanup** | |
| 0a | All stub command handlers are wired to real implementations | No stub log messages; `splitEditor`, `splitEditorOrthogonal`, `view.moveToSidebar`, `view.moveToPanel`, `part.resize` all functional |
| 0b | Empty service facades are resolved | Each facade file is populated or removed; no comment-only placeholders |
| 0c | Dead file removed; build passes | `context/contextKeyService.ts` deleted; all imports redirected; zero build errors |
| **1** | **Tool Discovery** | |
| 1a | Tool manifests are discovered from configured directories | Scanner finds and parses `parallx-manifest.json` files |
| 1b | Invalid manifests produce clear errors without crashing | Validation reports field-level errors; shell continues |
| 1c | Tool registry tracks all discovered tools and their state | Registry queryable by ID, state, contribution type |
| **2** | **API Boundary** | |
| 2a | Tools receive a scoped, frozen API object on activation | Each tool gets its own API; `Object.freeze()` prevents tampering |
| 2b | API provides access to views, commands, context, configuration, editors, and tools | All M2 API namespaces are functional |
| 2c | API calls after deactivation throw clear errors | Post-disposal access is caught and reported |
| 2d | API version is validated against manifest requirement | Incompatible tools are rejected with version mismatch error |
| **3** | **Tool Lifecycle** | |
| 3a | Tools activate lazily in response to activation events | `onCommand`, `onView`, `onStartupFinished` all trigger activation |
| 3b | Activation failures are isolated and reported | Failed tool is marked as errored; other tools unaffected |
| 3c | Deactivation disposes all tool resources | Commands, views, context keys, subscriptions all cleaned up |
| 3d | Tool error in runtime does not crash shell | Try/catch on all tool-originated calls |
| **4** | **Configuration and State** | |
| 4a | Tools have global and workspace-scoped Memento storage | `get`/`update`/`keys` work for both scopes |
| 4b | Tools can contribute configuration schemas | Settings declared in manifest are registered and queryable |
| 4c | Configuration changes fire events | `onDidChangeConfiguration` notifies relevant tools |
| **5** | **Command Contribution** | |
| 5a | Tool-declared commands appear in command palette | Title, category, and keybinding are displayed |
| 5b | Keybindings trigger contributed commands | Keyboard shortcut executes the correct command |
| 5c | Menu contributions place commands in view title bars | `view/title` menu items render as action buttons |
| **6** | **View Contribution** | |
| 6a | Tool-declared view containers appear in activity bar | Container icon and title are shown |
| 6b | Tool-declared views render in their target containers | View provider content appears in the correct part |
| 6c | Views with when clauses are conditionally visible | View hides/shows as context changes |
| **7** | **Built-In Tools** | |
| 7a | Welcome tool activates and opens welcome editor tab | Welcome page renders in editor area via `parallx.editors.openEditor()` |
| 7b | Output tool captures log messages in panel | Output channel messages appear in scrollable log |
| 7c | Tool Gallery view lists all registered tools | List shows name, version, status for each tool |
| **8** | **Quality** | |
| 8a | No console errors in normal operation | Clean startup with all built-in tools |
| 8b | No memory leaks from tool activation/deactivation cycles | Repeated activate/deactivate doesn't grow memory |
| 8c | Tool system initialization adds < 50ms to startup | Tool scanning and registration is fast |
| 8d | Code follows architectural boundaries | Tools cannot import from `src/` internals; only from API |

---

## VS Code Source References (Curated for Parallx)

These references were selected for their relevance to Parallx's structural shell and tool-hosting model. Code-IDE-specific features (languages, text editing, debugging, SCM, etc.) are intentionally excluded.

1. **Extension Description / Manifest** — `src/vs/platform/extensions/common/extensions.ts`
   - `IExtensionDescription` interface — Parallx equivalent is `IToolManifest`
   - Extension identity, activation events, contribution points

2. **Extension Description Registry** — `src/vs/workbench/services/extensions/common/extensionDescriptionRegistry.ts`
   - Centralized extension metadata storage — Parallx equivalent is `ToolRegistry`
   - Lookup by ID, activation event mapping

3. **Extension Activation** — `src/vs/workbench/api/common/extHostExtensionActivator.ts`
   - `ExtensionsActivator.activateByEvent()` — Event-driven lazy activation
   - `ActivationOperation` class — Error isolation per extension
   - Dependency-ordered activation (deferred for Parallx M2)

4. **Extension Service** — `src/vs/workbench/api/common/extHostExtensionService.ts`
   - `_loadExtensionModule()` — Dynamic module loading
   - Activation context creation (`ExtensionContext`)
   - Deactivation with dispose-all-subscriptions

5. **API Factory** — `src/vs/workbench/api/common/extHost.api.impl.ts`
   - `createApiFactoryAndRegisterActors()` — Creates fresh API object per extension
   - Namespace structure (`commands`, `window`, `workspace`, etc.)
   - Per-extension scoping of `registerCommand`, `registerProvider`, etc.

6. **View Contribution Extension Point** — `src/vs/workbench/api/browser/viewsExtensionPoint.ts`
   - `ViewsExtensionHandler` — Processes `contributes.viewsContainers` and `contributes.views`
   - Routes view containers to sidebar, panel, or auxiliary bar
   - Creates `ViewDescriptor` from manifest JSON

7. **Views Registry** — `src/vs/workbench/common/views.ts`
   - `IViewsRegistry`, `IViewContainersRegistry` — Centralized view metadata
   - `IViewDescriptor` — View metadata with when clause, icon, container routing

8. **Extension Host Manager** — `src/vs/workbench/services/extensions/common/extensionHostManager.ts`
   - Process boundary management (not needed in M2 but architecturally relevant for future isolation)

9. **Memento** — `src/vs/workbench/common/memento.ts`
   - Scoped storage for extensions — pattern for Parallx's `ToolMemento`

10. **Workbench Architecture** — DeepWiki: [Workbench Architecture](https://deepwiki.com/microsoft/vscode/7-workbench-architecture)
    - Parts overview, layout system, state persistence, context keys
    - Relevant for understanding how tool-contributed views integrate with the shell

11. **Extension System** — DeepWiki: [Extension System](https://deepwiki.com/microsoft/vscode/8-extension-system)
    - Process architecture, RPC protocol, API surface, lifecycle, storage
    - Primary reference for Parallx's tool system design (filtered for structural relevance)

---

## Notes

- This milestone transforms Parallx from a passive shell into an active tool-hosting platform. The key deliverable is the API boundary — everything else supports it.
- Tools run in-process in M2. Process isolation (like VS Code's Extension Host) is a future milestone. The API boundary is designed so that adding isolation later requires no changes to tool code.
- Built-in tools are first-class citizens — they use the same manifest and API as external tools. If a built-in tool can't be built with the public API, the API is incomplete.
- The `parallx.d.ts` file should be treated as a public contract. Breaking changes require a major version bump.
- Do not build a tool marketplace, installer, or update mechanism in M2. Tool installation is manual (copy files to a directory).
- Focus on correctness and clean API design over broad feature coverage. A small, correct API is better than a large, leaky one.
- Reference VS Code source as inspiration, but adapt patterns for Parallx's simpler, non-IDE model. Most VS Code complexity comes from language features, remote hosting, and web compatibility — none of which apply to Parallx in M2.

---

## Post-M2 Audit Resolution

A full 43-issue audit was performed after M2 implementation. All actionable issues have been resolved:

### HIGH Severity (3/3 fixed)
- **Shutdown data loss** — `main.ts` `beforeunload` handler now catches shutdown errors; preload listener leak fixed
- **Stale tab indices** — `editorGroupView.ts` closures now resolve editor index at event time via `model.editors.indexOf(editor)`
- **QuickPick OOB** — `notificationService.ts` ArrowDown clamps `highlightIndex` to visible item count

### MEDIUM Bugs (8/9 fixed, 1 non-issue)
- **EditorService double-fire** — Removed redundant manual fire in `openEditor()`
- **ViewContainer listener leak** — Per-view disposable map tracks and cleans up constraint listeners
- **ToolMemento quota** — Byte tracking now subtracts old value size on overwrites
- **Workbench saver leak** — Old grid listeners disposed before adding new ones in `_configureSaver()`
- **MenuContribution escape leak** — Escape handler tracked and removed in `dismissContextMenu()`
- **StatusBar stale entry** — `updateEntry()` now syncs stored entry map with DOM changes
- **ConfigRegistry over-unregistration** — Disposable now removes only specific keys, not entire tool registration
- EditorPart double-fire (non-issue — separate add/remove events are correct behavior)
- LayoutRenderer dispose (non-issue — `DisposableStore.delete()` exists)

### MEDIUM Design (3/3 fixed, 6 intentional/deferred)
- **`as any` casts** — `window.parallxElectron` now properly typed with `scanToolDirectory`/`getToolDirectories`
- **Sync FS in main process** — `electron/main.cjs` tool scanner IPC handler converted to async `fs/promises`
- **Unbounded parse cache** — `whenClause.ts` parse cache capped at 500 entries with LRU eviction
- Structural commands coupling, workspace null-host, duplicate context writes, loose equality — intentional patterns
- Windows `file://` URI handling, focus/context rebuild — deferred to future work

### LOW Dead Code
- Audit originally flagged types like `Position`, `Box`, `SashEdge`, `GridEventType`, `GridViewFactory`, `EditorMoveTarget`, `EditorCloseResult`, `CommandRegistrationOptions`, and `PALETTE_WIDTH` as unused dead code. These are **milestone-specified forward-looking contracts** (defined in M1 Task 2.1, 2.3, 9.x) that will be consumed in future work. All were preserved — no design types were removed.

### LOW Missing Implementations (6/6 fixed)
- **Titlebar drag region** — Added `-webkit-app-region: drag` CSS property
- **StatusBar command click** — Added `onDidClickEntry` event with click handler wiring
- **Grid constraint subscription** — `GridBranchNode.addChild` now subscribes to child `onDidChangeConstraints`
- **ViewsBridge descriptor unregister** — Added `ViewManager.unregister()`, bridge calls it on dispose
- **parallxElectron type sync** — Resolved with HIGH #1 fix
- **ViewContainer aria-selected** — `activateView()` now updates `aria-selected` on both old and new tabs

### LOW Architecture/Docs (2/2 fixed, 3 observations noted)
- **ARCHITECTURE.md** — Added `tools/`, `api/`, `configuration/`, `contributions/` modules; updated dependency matrix and rules
- **Semver** — Verified clean (no duplicates or inconsistencies)
- Workbench.ts god-class, contribution disposables, no tests — noted for future milestone work

---

## Cross-Milestone Deep Audit (Post-M2, Round 2)

A comprehensive cross-milestone audit covering M1 + M2 found additional latent bugs and structural debt
beyond the initial 43-issue audit. 14 files modified, all issues verified at the line level.

### HIGH Severity (8/8 fixed)
- **H1 — NamespacedStorage.clear() wipes ALL namespaces** — `storage.ts` `clear()` and `clearSync()` now enumerate keys matching the namespace prefix and delete individually, instead of delegating to `_inner.clear()`
- **H2 — Reentrancy guard drops concurrent editor switches** — `editorGroupView.ts` boolean guard replaced with a "latest-wins" sequence counter; stale calls bail after the await instead of newer calls being dropped
- **H3 — `_closeAt` doesn't fire EditorActive** — `editorGroupModel.ts` now fires `EditorGroupChangeKind.EditorActive` when the closed editor was the active one and a new active editor is selected
- **H4 — Remote code execution via `http://` in manifest main** — `toolModuleLoader.ts` now throws for `http://` and `https://` URLs; only `file:` URIs and relative paths are accepted
- **H5 — Pending command invocations dropped on deactivation** — `commandContribution.ts` `removeContributions()` now iterates and rejects all pending invocations before deleting them, ensuring caller promises settle
- **H6 — Window resize listener never removed** — `workbench.ts` `shutdown()` now calls `window.removeEventListener('resize', ...)`
- **H7 — `_wireViewContributionEvents` accumulates duplicates** — View contribution event subscriptions now tracked in a dedicated `DisposableStore` that is cleared during `_teardownWorkspaceContent()`
- **H8 — `shutdown()` fires disposed emitter** — `_onDidShutdown.fire()` now executes BEFORE `this.dispose()` so listeners receive the shutdown notification

### MEDIUM Severity (9/9 fixed)
- **M1 — EditorService misses within-group editor switches** — `editorService.ts` now subscribes to each group's model `EditorActive` change events via `_wireGroupListeners()`, re-wired when group count changes
- **M2 — EditorService.closeEditor double-fires** — Only fires `onDidActiveEditorChange` when the active editor actually changed (compares before/after); delegates to model's `EditorActive` event for active-closed case
- **M3 — `getContributorsOf('menus')` always empty** — `toolRegistry.ts` now handles Record-type contributions (menus) by checking `Object.keys(...).length > 0` in addition to `Array.isArray()`
- **M4 — Built-in tool activation fire-and-forget** — `_registerAndActivateBuiltinTools()` now async; `Promise.allSettled()` awaits all activations before `fireStartupFinished()`; `_initializeToolLifecycle()` also made async
- **M5 — MutationObserver never disconnected** — `_makeTabsDraggable()` `observer` stored in `_tabObservers` array; all disconnected in `_teardownWorkspaceContent()`
- **M6 — Tool views not cleared on workspace switch** — `_teardownWorkspaceContent()` now calls `removeContributions()` for all contributed tool IDs; added `getContributedToolIds()` to `ViewContributionProcessor`
- **M7 — `notify()` promise leak (timeoutMs=0, no container)** — `notificationService.ts` immediately dismisses persistent notifications when no container is attached
- **M8 — Emitter leak counter never decrements** — `events.ts` `_leakWarnCount` now decremented in the unsubscribe disposable, tracking active listeners not total-ever
- **M9 — `_editorColumnAdapter` emitter relies on indirect disposal** — `workbench.ts` layout teardown now explicitly disposes the adapter before the parent grid

### LOW Severity (2/4 fixed, 2 noted)
- **L2 — `_pendingEvents` grows monotonically** — `activationEventService.ts` added `dispose()` override that clears `_pendingEvents`, `_eventToTools`, and `_activatedTools`
- **L3 — ContextBridge double-dispose** — `contextBridge.ts` removed duplicate push to `_subscriptions`; only `_keys` array now owns the `handle.reset()` disposable
- L1 (ToolActivator TOCTOU) — mitigated by ToolState.Activating synchronous guard; no code change needed
- L4 (EditorPart fallback dimensions) — by design; `|| 800`/`|| 600` fallbacks work correctly when parts are created in a hidden div

### Architecture (dependency matrix updated)
- **ARCHITECTURE.md** — Updated dependency matrix to reflect M2 type-only imports:
  - `parts` → `editor` (✓†), `workspace` → `layout`/`views`/`parts` (✓†), `api` → `tools`/`contributions` (✓†), `contributions` → `tools` (✓†)
  - Added `✓†` notation for type-only dependencies; updated all 4 affected plain-language rules

### Previously Cleared (false positives from initial audit)
- Output tool console recursion — NOT FOUND (addEntry uses DOM only)
- ViewContainer tab listener accumulation — NOT FOUND (tabs created once per view)

---

## Comprehensive Cohesion Audit (Post-M2, Round 3)

A full-spectrum cohesion audit was performed across all M1 + M2 subsystems to verify that
independently-built systems interoperate correctly and that no latent cross-system conflicts
remain. Five parallel deep-dive audits covered: Editor chain, Tool lifecycle pipeline,
Contributions & Views, Platform/Storage/Config, and Workbench orchestration. All confirmed
findings were resolved. Commit `1f01957` on `milestone-2`.

**12 files modified, 179 insertions, 39 deletions.**

### HIGH Severity (7/7 fixed)

- **H1 — Last-editor-close leaves stale pane** — `editorGroupModel.ts` `_closeAt()` now fires `EditorActive` with `editor: undefined` when closing the last editor in a group (`wasActive && editors.length === 0`). Previously the condition `wasActive && _activeIndex >= 0` silently skipped the event when `_activeIndex` was `-1`, leaving the old pane visible in `editorGroupView.ts`.

- **H2 — Editor inputs never disposed on close** — `editorGroupModel.ts` `_closeAt()` now calls `entry.input.dispose()` after removing the editor. `dispose()` also disposes all remaining inputs. Previously, closed editor inputs were spliced from the array but never freed.

- **H3 — Double pane creation on every openEditor** — `editorGroupView.ts` `openEditor()` now checks whether the model already fired `EditorActive` synchronously (by comparing `_showActiveEditorSeq` before/after) and skips the explicit `_showActiveEditor()` call if so. Previously, both the model event handler and the explicit call created panes.

- **H4 — Tool-scoped context keys invisible during global evaluation** — `contextKey.ts` `contextMatchesRules()` now aggregates own keys from ALL registered scopes (including child scopes like `tool:<toolId>`) instead of only evaluating against the global scope. This ensures tool-contributed when-clauses work correctly for command enablement and menu visibility.

- **H5 — ToolMemento quota counter grows monotonically on delete** — `toolMemento.ts` delete path (`update(key, undefined)`) now decrements `_estimatedBytes` by the old value's serialized size before removing it. Previously, deletes returned early without adjusting the quota counter, causing it to eventually hit the 10MB hard limit even with tiny actual data.

- **H6 — ConfigurationRegistry unregister deletes other tool's keys** — `configurationRegistry.ts` `_unregisterKeys()` now verifies `schema.toolId === toolId` before deleting a key from `_properties`. Previously, if Tool B re-registered the same key after Tool A, Tool A's disposal would delete Tool B's key.

- **H7 — Workspace switch has no mutex + contributions lost** — `workbench.ts` `switchWorkspace()` now has a `_switching` boolean guard preventing concurrent calls. `_rebuildWorkspaceContent()` now replays tool contributions by calling `removeContributions()` + `processContributions()` for all registered tools with view/viewContainer contributions, and calls `viewContribution.updateViewManager()` to update the ViewManager reference. Previously, contributed UI vanished after workspace switch because the new ViewManager had no descriptors.

### MEDIUM Severity (6/6 fixed)

- **M1 — DisposableStore.clear/dispose unsafe** — `lifecycle.ts` `DisposableStore.clear()` and `dispose()` now wrap each item's `dispose()` in try/catch, collecting errors and logging them. Previously, if one disposal threw, remaining items and the Set's `.clear()` were never reached.

- **M2 — EditorPart emitters not tracked for disposal** — `editorPart.ts` `_onDidActiveGroupChange` and `_onDidGroupCountChange` emitters now use `this._register()`. Previously they were standalone instances manually disposed in `dispose()`, which was fragile.

- **M3 — EditorService fires active-editor events for non-active groups** — `editorService.ts` `_wireGroupListeners()` now only fires `onDidActiveEditorChange` when the originating group is `editorPart.activeGroup`. Previously, background group tab switches incorrectly updated the service-level active editor.

- **M4 — EditorService closeEditor double-fires** — `editorService.ts` `closeEditor()` no longer explicitly fires `onDidActiveEditorChange`. The model's `EditorActive` event (now always fired, including on last-editor close via H1) is caught by `_wireGroupListeners()`.

- **M5 — Keybinding when-clause fallthrough** — `keybindingContribution.ts` global keydown handler now iterates bindings from last to first, checking each binding's when-clause. Previously it only checked the very last binding, so if that binding's `when` evaluated false, no earlier valid binding was tried.

- **M6 — Concurrent tool activation race** — `toolActivator.ts` `activate()` now maintains an `_activating` Map of in-flight promises. If `activate()` is called for a tool that's already activating, it returns the existing promise instead of starting a parallel activation.

### MEDIUM Structural (2/2 fixed)

- **M7 — Activity bar spacer missing CSS class** — `workbench.ts` `_addAuxBarToggle()` now adds `activity-bar-spacer` class to the spacer div. Previously, `_addContributedActivityBarIcon()` queried `.activity-bar-spacer` to insert icons before the aux-bar toggle, but the selector returned null because the class was never set.

- **M8 — ViewContribution needs ViewManager update on workspace switch** — `viewContribution.ts` added `updateViewManager(viewManager)` method that updates the internal `_viewManager` reference and re-registers all existing view descriptors into the new ViewManager. Called from `_rebuildWorkspaceContent()` during workspace switch.

### Pane robustness improvements (from editor audit)

- **pane.setInput() error isolation** — `editorGroupView.ts` `_showActiveEditor()` now wraps `pane.setInput()` in try/catch. On failure, the orphan pane is immediately disposed and its DOM removed, preventing a blank pane from persisting.

### False positives identified
- **ViewContribution #1 (ViewManager ↔ ViewContainer disconnect)** — `_onToolViewRemoved` DOES call `vc.removeView(viewId)` on all container maps. Not a bug.
- **ViewContribution #3 (container removal no DOM cleanup)** — `_onToolContainerRemoved` properly disposes and removes from maps. Not a bug.
- **ActivationEventService markActivated on failure** — `markActivated()` is only called AFTER successful activation (lines 247, 329 in toolActivator.ts). Not a bug.
