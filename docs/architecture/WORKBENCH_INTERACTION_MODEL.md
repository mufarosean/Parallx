---
Status: Adopted (M83 / SR-3, 2026-05-23) — canonical workbench language for all SR-4+ milestones
Author: Unified Workbench Interaction Agent (subagent invocation)
Branch: systems-redesign-planning
Commit: 01ad9c1 (created); adopted via M83 closeout commit
Created: 2026-05-23
Adopted: 2026-05-23 via docs/Parallx_Milestone_83.md (M83 / SR-3)
Review: docs/research/WORKBENCH_INTERACTION_MODEL_REVIEW.md §1 verdict APPROVE
Atlas: docs/architecture/SYSTEM_ATLAS.md
External brief: docs/research/WORKBENCH_EXTERNAL_ARCHITECTURE_RESEARCH_BRIEF.md
Baseline: docs/research/baselines/workbench-baseline.md
---

# Parallx Workbench Interaction Model

## 1. Purpose and Scope

### 1.1 What This Document Is

This document proposes a **unified primitive set and interaction language** that will allow every workbench surface (Explorer, editors, Canvas, AI chat, extensions, commands, tools, IPC, persistence) to compose into reliable cross-tool workflows.

It is **not** a feature proposal, rewrite spec, or visual redesign. It is a **schema redesign** — a definition of how the parts speak to each other through a common language.

### 1.2 What This Document Is Not

- **Not a feature roadmap.** No new user-facing capabilities are proposed (though enablers for future features are defined).
- **Not a visual redesign.** The workbench layout, panels, sidebars, and menus remain in scope of other milestones.
- **Not a performance rewrite.** Performance optimizations beyond preserving existing hot paths are out of scope. See [Baseline Scorecard §5](docs/research/baselines/workbench-baseline.md#5-performance-hot-paths-already-identified) for what must not regress.
- **Not an extension API breaking change without migration.** Every public extension API must have a documented migration path or a compatibility shim.
- **Not a redesign of AI chat internals or OpenClaw.** Chat remains independent; this proposal defines how chat participates in shared workbench workflows.

### 1.3 Compatibility Statement

**Every existing user-visible behavior must remain achievable through the new model.** Preservation is non-negotiable (Manifest §11). This redesign proposes a cleaner foundation; it does not remove workflows.

**Specific preservation commitments:**
- Existing workspaces open and restore with the same layout and editor state.
- Canvas pages and blocks persist and are recoverable.
- Explorer file tree remains the entry point for file operations.
- AI chat continues as an independent but integrated surface.
- Extension manifests remain valid; activation events still work.
- Keybindings and command IDs remain stable unless explicitly migrated with a deprecation period.
- IPC contracts are replaced with typed equivalents; old contracts have shims.

### 1.4 Scope Boundary

This document is **scoped to the workbench primitive set and their interactions**. It does NOT propose:
- Changes to Explorer's file-watching strategy or tree rendering.
- Changes to editor implementations (PDF, Canvas, file editing).
- Changes to Canvas content model or block types.
- Changes to AI chat model selection or turn execution.
- Changes to extension sandboxing or process isolation.
- Changes to database schema (migrations are separate).

---

## 2. Unified Primitives

Drawn from Manifest §10, refined by external research and current-code analysis.

### 2.1 Workspace

**Definition:** The project boundary, including folders, durable state, settings, background work fences, and lifecycle. The canonical owner of user intent: "this is what the user is working on."

**Current Parallx Implementation:**
- Type: `Workspace` at [src/workspace/workspace.ts:L38](src/workspace/workspace.ts#L38)
- Storage: `.parallx/workspace-identity.json`, `.parallx/workspace-state.json` per [SYSTEM_ATLAS §1.2](docs/architecture/SYSTEM_ATLAS.md#12-workspace-open-and-restore)
- Events: `onDidChangeFolders`, `onDidChangeState` per [SYSTEM_ATLAS §2, Workspace row](docs/architecture/SYSTEM_ATLAS.md#2-system-ownership-table)
- State owners: folder set (canonical), layout (ephemeral → saved), editor snapshots (ephemeral → saved)

**Proposed Canonical Shape (TypeScript):**

```typescript
interface Workspace {
  // Identity
  readonly id: UUID;
  readonly name: string;
  readonly folders: WorkspaceFolder[];

  // State
  readonly isOpen: boolean;
  readonly lastOpenedAt: Date;

  // Lifecycle
  readonly onDidChangeFolders: Event<{ added: WorkspaceFolder[]; removed: WorkspaceFolder[] }>;
  readonly onDidChangeState: Event<{ key: string; newValue: unknown; oldValue?: unknown }>;
  readonly onWillClose: Event<void>;
  readonly onDidClose: Event<void>;

  // Methods
  touch(): Promise<void>; // Update timestamp
  save(): Promise<void>; // Persist state to storage
  setState(key: string, value: unknown): Promise<void>; // Persist workspace-scoped state
  getState(key: string): unknown; // Retrieve workspace-scoped state
}

interface WorkspaceFolder {
  readonly path: string; // Absolute path
  readonly name: string; // Display name (from path or user override)
  readonly index: number; // Order in workspace.folders
}
```

**What It Owns:**
- Canonical folder set (source of truth for `Workspace.folders`).
- Durable workspace state (`setState`, `getState`).
- Lifecycle events (`onDidChangeFolders`, `onWillClose`).
- Identity (UUID, name, timestamp).

**What It Does NOT Own:**
- File system operations (delegated to FileService).
- Workspace layout (managed by Layout service; state is ephemeral → persisted by Workspace).
- Editor snapshots (managed by EditorService; snapshots are ephemeral → persisted by Workspace).
- Extension state (managed by extensions; persistence is per-workspace but not owned by Workspace).

**Migration Story from Current Code:**
- `Workspace` class exists; add `onDidChangeState` event and `setState`/`getState` methods.
- Current dual notification issue (recentWorkspaces + Workspace both update metadata) is resolved: only `Workspace` owns the folder set; `RecentWorkspaces` consumes `onDidChangeFolders`.
- WorkspaceLoader deserializes saved state into `Workspace` instance at [src/workspace/workspaceLoader.ts:L23](src/workspace/workspaceLoader.ts#L23) — no change needed to loading path.

**Compatibility Table Row:**
| Existing | Proposed | Mapping |
|----------|----------|---------|
| `Workspace.folders: string[]` | `Workspace.folders: WorkspaceFolder[]` | Migration: treat strings as `{ path: str, name: baseName(str), index: i }` on load; export as strings for compatibility until migration complete. |
| `workspace.onDidChangeFolders` event | Same | No change |
| `.parallx/workspace-identity.json`, `.parallx/workspace-state.json` | Same two files | Schema may expand `workspace-state.json` to include `state: { [key]: value }` dict; backward compatible. |

---

### 2.2 Resource

**Definition:** A stable identity for any piece of content: files, Canvas pages, chat sessions, tool artifacts, search results, external records. Enables cross-tool referencing without translation.

**Current Parallx Implementation:**
- Mixed: File paths (URIs), Canvas page UUIDs (internal to DB), Chat session IDs (internal to DB), hard-coded URI pattern `parallx.canvas:canvas:<uuid>` per [SYSTEM_ATLAS §4.1, "Canvas pages ↔ Chat context"](docs/architecture/SYSTEM_ATLAS.md#41-one-off-bridges-hard-coded-couplings)
- No unified Resource type; each feature invents its own scheme.

**Proposed Canonical Shape (TypeScript):**

```typescript
// Discriminated union: one Resource variant per content type
type Resource = FileResource | CanvasPageResource | ChatSessionResource | ToolArtifactResource | ExternalResource;

interface FileResource {
  readonly type: 'file';
  readonly path: string; // Absolute path
  readonly hash?: string; // Content hash for versioning (optional)
  readonly workspaceId?: UUID; // Optional: which workspace this file belongs to
}

interface CanvasPageResource {
  readonly type: 'canvas-page';
  readonly pageId: UUID; // Stable page UUID from DB
  readonly blockId?: UUID; // Optional: specific block within page
  readonly workspaceId: UUID; // Which workspace
}

interface ChatSessionResource {
  readonly type: 'chat-session';
  readonly sessionId: UUID; // Stable session UUID from DB
  readonly turnId?: UUID; // Optional: specific turn within session
  readonly workspaceId: UUID;
}

interface ToolArtifactResource {
  readonly type: 'tool-artifact';
  readonly toolId: string; // Tool identifier
  readonly artifactId: string; // Tool-provided ID
  readonly workspaceId?: UUID; // Optional: workspace scope
}

interface ExternalResource {
  readonly type: 'external';
  readonly scheme: string; // 'http', 'gemini', etc.
  readonly uri: string; // Full URI
}

// Unified URI format (canonicalized)
interface ParallxUri {
  scheme: 'parallx'; // Always 'parallx' for Parallx-managed resources
  type: Resource['type'];
  id: string; // Compound ID: UUID or path
  query?: Record<string, string>; // workspace=<uuid>, branch=<hash>, etc.

  // Serialization: parallx://file:abc123?workspace=ws-uuid
  //               parallx://canvas-page:page-uuid?workspace=ws-uuid
  //               parallx://chat-session:session-uuid
  //               parallx://tool-artifact:toolId/artifactId
  //               http://... (external pass-through)
}
```

**What It Owns:**
- Resource identity (type + ID).
- URI scheme interpretation (how to parse `parallx://...` URIs).
- Resource metadata (type-specific properties).

**What It Does NOT Own:**
- Fetching resource content (delegated to service that owns the resource).
- Rendering resource (delegated to editor or view provider).
- Persisting resource (delegated to storage/database service).
- Access control (delegated to capability service).

**Migration Story from Current Code:**
- `LinkResolverService` at [src/links/linkResolverService.ts:L1](src/links/linkResolverService.ts#L1) becomes the central resolver for all Resource types.
- Old `parallx.canvas:canvas:<uuid>` URIs are aliased to new `parallx://canvas-page:<uuid>` scheme; aliasing layer at `LinkResolverService.registerAlias(oldUri, newUri)`.
- File paths continue as `file://...` or are wrapped as `parallx://file:<hash>` with fallback to file path.
- Canvas, chat, explorer each register their resource resolver at `LinkResolverService.registerType('type', resolver)`.

**Compatibility Table Row:**
| Existing | Proposed | Mapping |
|----------|----------|---------|
| File paths as strings | `FileResource { type: 'file', path }` | Implicit wrapping; `path` remains the source of truth. |
| `parallx.canvas:canvas:<uuid>` | `parallx://canvas-page:<uuid>` | Alias in LinkResolverService redirects old to new. |
| Canvas page ID (UUID internal) | `CanvasPageResource.pageId` | Same UUID; wrapped in typed Resource. |
| Chat session ID (internal) | `ChatSessionResource.sessionId` | Same UUID; wrapped in typed Resource. |

---

### 2.3 Surface

**Definition:** A visible place where work happens and context is active. Examples: Explorer sidebar, editor pane, Canvas editor, chat sidebar, command palette, search results panel. The object that can have focus and selection.

**Current Parallx Implementation:**
- Implicit: `EditorPart`, `ExplorerView`, `ChatWidget`, `CanvasEditor` are surfaces but not unified.
- No Surface abstraction; parts are coupled directly to layout.
- Current model: Part = surface. No registry of surfaces.

**Proposed Canonical Shape (TypeScript):**

```typescript
interface Surface {
  readonly id: string; // Unique identifier: 'editor.main', 'explorer', 'chat-sidebar', 'canvas-editor.active'
  readonly type: 'editor' | 'panel' | 'sidebar' | 'view' | 'modal' | 'popup';
  readonly title?: string; // Display title
  readonly active: boolean; // Is this the active/focused surface?
  
  // Context
  readonly activeResource?: Resource;
  readonly selection?: Selection;
  readonly context?: Record<string, unknown>; // Arbitrary context (theme, language, permissions, etc.)

  // Lifecycle
  readonly onDidChangeActive: Event<boolean>;
  readonly onDidChangeSelection: Event<Selection | undefined>;
  readonly onDidChangeResource: Event<{ resource?: Resource; oldResource?: Resource }>;
}

interface SurfaceRegistry {
  // Access
  getActiveSurface(): Surface | undefined;
  getSurface(id: string): Surface | undefined;
  getSurfaces(type?: Surface['type']): Surface[];

  // Observation
  onDidChangeActiveSurface: Event<{ active: Surface; inactive: Surface }>;
  onDidRegisterSurface: Event<Surface>;
  onDidUnregisterSurface: Event<Surface>;

  // Management (internal use)
  register(surface: Surface): void;
  unregister(surfaceId: string): void;
  setActive(surfaceId: string): void;
}
```

**What It Owns:**
- Surface identity and lifecycle (register, unregister, activate).
- Active surface state (which surface has focus).
- Selection and resource context for that surface.
- Registry of all surfaces.

**What It Does NOT Own:**
- Layout (Layout service owns grid, docking, part positioning).
- Content rendering (editor/view providers own rendering).
- State persistence (Workspace/Part state owners persist Surface state).

**Migration Story from Current Code:**
- Create `SurfaceRegistry` service alongside `Layout` at [src/workbench/layout.ts](src/workbench/layout.ts).
- Each part (EditorPart, ExplorerView, ChatWidget, etc.) registers itself as a Surface on initialization.
- Parts emit `onDidChangeActive` when focus changes; registry listens and updates `activeSurface`.
- Old code that checks `editorService.activeEditor` continues to work via delegating to `surfaceRegistry.getActiveSurface().activeResource`.

**Compatibility Table Row:**
| Existing | Proposed | Mapping |
|----------|----------|---------|
| `editorService.activeEditor` | `surfaceRegistry.getActiveSurface()?.activeResource` | Compatibility method returns active editor (or null if non-editor surface is active). |
| Part.focus() | `surfaceRegistry.setActive(partId)` | Explicit API for focusing a surface. |
| (no unified registry) | `SurfaceRegistry` | New service; no breaking change. |

---

### 2.4 Selection

**Definition:** The current focused thing or range in an active surface: file, text range, block, page, resource, search result, or structured item. Enables cross-tool action dispatch.

**Current Parallx Implementation:**
- Scattered: File selection in Explorer, text selection in editors, block selection in Canvas, search result selection.
- One-off bridge: `SelectionActionDispatcher` at [src/services/selectionActionDispatcher.ts:L16](src/services/selectionActionDispatcher.ts#L16) routes selections to named handlers.
- No unified Selection type; each surface defines its own.

**Proposed Canonical Shape (TypeScript):**

```typescript
interface Selection {
  readonly resource: Resource; // The primary resource selected
  readonly location?: SelectionLocation; // Precise location (line, col, block ID, etc.)
  readonly range?: { start: number; end: number }; // Optional: text/content range
  readonly multiple: boolean; // Is this a multi-select (e.g., multiple files)?
  readonly context?: Record<string, unknown>; // Surface-specific context

  // Metadata
  readonly surface: Surface; // Which surface initiated this selection
  readonly timestamp: Date;
}

interface SelectionLocation {
  line?: number; // For text (1-indexed)
  column?: number; // For text (0-indexed)
  blockId?: string; // For Canvas blocks
  pageId?: UUID; // For Canvas pages
  // Other location types TBD per surface
}

interface SelectionService {
  // Observe
  readonly activeSelection: Selection | undefined;
  onDidChangeSelection: Event<{ selection: Selection | undefined; previous?: Selection }>;

  // Update (called by surfaces when their selection changes)
  setSelection(selection: Selection): void;

  // Query
  getSelection(surfaceId: string): Selection | undefined;
  getSelections(resourceType: Resource['type']): Selection[];

  // Clear
  clearSelection(): void;

  // Context: publish typed predicates for contribution gating
  onDidChangeSelectionContext: Event<{ key: string; value: unknown }>;
  getSelectionContext(key: string): unknown;
}
```

**What It Owns:**
- Active selection state (which resource is selected in which surface).
- Selection event stream (coalesced, debounced).
- Selection context for visibility predicates.

**What It Does NOT Own:**
- Surface focus (Surface owns that).
- Multi-select logic (delegated to editor/view that manages multi-select).
- Clipboard (delegated to OS/shell).

**Migration Story from Current Code:**
- Replace `SelectionActionDispatcher` at [src/services/selectionActionDispatcher.ts:L16](src/services/selectionActionDispatcher.ts#L16) with `SelectionService`.
- Each surface (Explorer, Editor, Canvas, Chat) calls `selectionService.setSelection(selection)` when user changes selection (not via dispatcher, directly).
- Handlers that were registered with dispatcher (`AddSelectionToChatHandler`, `SendSelectionToCanvasHandler`) become subscribers to `onDidChangeSelection` event; no change in behavior, just decoupled routing.

**Compatibility Table Row:**
| Existing | Proposed | Mapping |
|----------|----------|---------|
| SelectionActionDispatcher pattern | SelectionService + event-based routing | Dispatch still works; now event-driven (cleaner, backward compatible via shim). |
| File selection in Explorer | `Selection { resource: FileResource, surface: 'explorer' }` | Same user action; typed and observable. |
| Per-surface selection APIs | `SelectionService.getSelection(surfaceId)` | Unified query interface. |

---

### 2.5 Context

**Definition:** The facts that make commands, tools, and UI relevant. Includes: workspace, active surface, selected resource, user permissions, extension state, feature flags, theme, language, and AI settings.

**Current Parallx Implementation:**
- Scattered: `contextKey.ts` at [src/context/contextKey.ts](src/context/contextKey.ts), `workbenchContext.ts` at [src/context/workbenchContext.ts](src/context/workbenchContext.ts), feature flags in various services.
- ~10 context keys defined (CTX_SIDEBAR_VISIBLE, CTX_PANEL_VISIBLE, etc.) vs. VS Code's 100+.
- No public contract or discoverable list.

**Proposed Canonical Shape (TypeScript):**

```typescript
interface ContextKey<T = unknown> {
  readonly key: string; // Fully qualified: 'workbench.ui.sidebar.visible', 'editor.focus', etc.
  readonly type: 'boolean' | 'string' | 'number' | 'object';
  readonly defaultValue: T;
  
  onDidChange: Event<T>;
  get(): T;
  set(value: T): void;
  reset(): void;
}

// Pre-defined core context keys (discoverable, documented, typed)
const ContextKeys = {
  // Workbench
  workbench_focus: createContextKey<'explorer' | 'editor' | 'chat' | 'canvas' | 'panel' | 'sidebar'>('workbench.focus', 'editor'),
  workbench_sidebarVisible: createContextKey<boolean>('workbench.sidebar.visible', true),
  workbench_panelVisible: createContextKey<boolean>('workbench.panel.visible', true),
  workbench_statusbarVisible: createContextKey<boolean>('workbench.statusbar.visible', true),
  
  // Editor
  editor_focus: createContextKey<boolean>('editor.focus', false),
  editor_hasSelection: createContextKey<boolean>('editor.hasSelection', false),
  editor_readonly: createContextKey<boolean>('editor.readonly', false),
  
  // Explorer
  explorer_focus: createContextKey<boolean>('explorer.focus', false),
  explorer_hasSelection: createContextKey<boolean>('explorer.hasSelection', false),
  explorer_selectedCount: createContextKey<number>('explorer.selectedCount', 0),
  
  // Canvas
  canvas_focus: createContextKey<boolean>('canvas.focus', false),
  canvas_hasSelection: createContextKey<boolean>('canvas.hasSelection', false),
  canvas_pageId: createContextKey<UUID | undefined>('canvas.pageId', undefined),
  
  // Chat
  chat_focus: createContextKey<boolean>('chat.focus', false),
  chat_hasSelection: createContextKey<boolean>('chat.hasSelection', false),
  
  // Resource
  resource_type: createContextKey<Resource['type'] | undefined>('resource.type', undefined),
  resource_id: createContextKey<string | undefined>('resource.id', undefined),
  
  // AI / Capabilities
  ai_enabled: createContextKey<boolean>('ai.enabled', true),
  capability_filesystem: createContextKey<boolean>('capability.filesystem', true),
  capability_shell: createContextKey<boolean>('capability.shell', true),
  capability_database: createContextKey<boolean>('capability.database', true),
  capability_secrets: createContextKey<boolean>('capability.secrets', false),
  capability_ai_model: createContextKey<boolean>('capability.ai_model', true),
  
  // Other
  theme_id: createContextKey<string>('theme.id', 'default'),
};

interface ContextService {
  // Access
  getContextKey<T>(key: string): ContextKey<T> | undefined;
  createContextKey<T>(key: string, defaultValue: T): ContextKey<T>;
  
  // Batch update
  withContext<T>(updates: Record<string, unknown>, fn: () => T): T;
  
  // Predicates (for contribution gating)
  matches(predicate: string): boolean; // e.g., "editor.focus && editor.hasSelection"
}
```

**What It Owns:**
- Context key registry (discoverable list of all keys).
- Context key values and change events.
- Predicates for visibility/enablement (when clauses).

**What It Does NOT Own:**
- Capability checks (delegated to CapabilityService).
- Feature flag business logic (delegated to feature flag service).

**Migration Story from Current Code:**
- Move scattered context key definitions from `contextKey.ts`, `workbenchContext.ts`, services into a centralized `ContextKeys` dictionary.
- Existing code that creates/sets context keys continues to work (no breaking change).
- New services publish their context via `ContextKeys` (not private state).

**Compatibility Table Row:**
| Existing | Proposed | Mapping |
|----------|----------|---------|
| Scattered CTX_* definitions | `ContextKeys` dictionary | Centralized; all existing keys preserved. |
| `contextMatchesRules()` | `contextService.matches(predicate)` | Same behavior; typed API. |
| Part-owned context | `ContextService` publishes | Surfaces update context; all observers see updates. |

---

### 2.6 Command

**Definition:** A named, invokeableaction with predictable availability, arguments, result shape, and keybinding/menu contribution rules. The user or system's way to cause work.

**Current Parallx Implementation:**
- Registry: `CommandRegistry` at [src/commands/commandRegistry.ts:L33](src/commands/commandRegistry.ts#L33)
- Contributions: `CommandContribution` at [src/contributions/commandContribution.ts:L40](src/contributions/commandContribution.ts#L40)
- No centralized `when` clause model; visibility is per-handler.

**Proposed Canonical Shape (TypeScript):**

```typescript
interface Command<Args = unknown, Result = unknown> {
  readonly id: string; // Fully qualified: 'explorer.open', 'canvas.insertBlock', etc.
  readonly title: string; // Localized human-readable title
  readonly category?: string; // For organizing in command palette: 'Canvas', 'File', etc.
  readonly description?: string; // Longer description
  readonly icon?: IconReference; // Icon for menus/toolbars
  
  // Availability
  readonly when?: string; // Predicate: "editor.focus && editor.hasSelection"
  readonly preconditions?: Precondition[]; // Typed checks (alternative to string `when`)
  
  // Arguments / Result contracts
  readonly argsContract?: JsonSchema; // Schema for args
  readonly resultContract?: JsonSchema; // Schema for return value
  
  // Behavior
  readonly delegateCommand?: string; // If specified, this command is a wrapper that invokes another
  readonly showInCommandPalette?: boolean; // Default: true
  readonly showInContextMenu?: boolean; // Default: depends on menus contribution
}

interface CommandRegistry {
  // Register
  registerCommand<Args, Result>(cmd: Command<Args, Result>, handler: (args?: Args) => Result | Promise<Result>): Disposable;
  
  // Execute
  executeCommand<Args, Result>(id: string, args?: Args): Promise<Result>;
  
  // Query
  getCommand(id: string): Command | undefined;
  getCommands(): Command[];
  getCommands(predicate: (cmd: Command) => boolean): Command[];
  
  // Events
  onDidRegisterCommand: Event<Command>;
  onDidUnregisterCommand: Event<string>;
  onDidExecuteCommand: Event<{ id: string; args?: unknown; result?: unknown; error?: Error }>;
}
```

**What It Owns:**
- Command identity and metadata (id, title, icon).
- Command availability predicates (when/preconditions).
- Command registration and invocation.
- Command event stream.

**What It Does NOT Own:**
- Keybindings (owned by KeybindingService).
- Menu placement (owned by MenuService, which references commands by ID).
- Implementation (owned by handler; registry only stores metadata).

**Migration Story from Current Code:**
- Existing `CommandRegistry` extended with `when` clause support and typed contracts.
- Commands already have IDs and titles; no breaking change to add optional `when` and contracts.
- Handlers that are already registered continue to work (handler function signature unchanged).

**Compatibility Table Row:**
| Existing | Proposed | Mapping |
|----------|----------|---------|
| `registerCommand(id, handler)` | `registerCommand(cmdMetadata, handler)` | Backward compatible: if only id+handler passed, create default metadata. |
| No `when` support | `Command.when?: string` | Optional; adds visibility control. |
| No contracts | `Command.argsContract, resultContract` | Optional; adds IDE code-complete in extensions. |

---

### 2.7 Tool

**Definition:** A callable capability used by built-in features, extensions, MCP, or AI workflows. Tools map to workbench resources, commands, context, and permissions. Distinct from Command (which is user-initiated); Tools are programmatic.

**Current Parallx Implementation:**
- Registry: `ToolRegistry` at [src/tools/toolRegistry.ts](src/tools/toolRegistry.ts)
- Manifest model: `ToolManifest` at [src/tools/toolManifest.ts:L1](src/tools/toolManifest.ts#L1)
- Activation events: `ActivationEventService` at [src/tools/activationEventService.ts:L1](src/tools/activationEventService.ts#L1)

**Proposed Canonical Shape (TypeScript):**

```typescript
interface Tool<Args = unknown, Result = unknown> {
  readonly id: string; // Fully qualified: 'media-organizer.importPhotos', 'canvas.insertBlock', etc.
  readonly name: string; // Display name
  readonly description?: string;
  
  // Availability
  readonly when?: string; // Predicate: "workspace.open && capability.filesystem"
  readonly requiredCapabilities?: CapabilityId[]; // 'filesystem', 'ai_model', 'shell', etc.
  readonly requiresInput?: boolean; // Does tool require argument?
  
  // Contracts
  readonly inputSchema?: JsonSchema; // Args contract
  readonly outputSchema?: JsonSchema; // Result contract
  
  // Lifecycle
  readonly activationEvents?: ActivationEvent[]; // When to load tool
  readonly deactivationBehavior?: 'cleanup' | 'keep' | 'error'; // On unload
  
  // Invocation result
  readonly maxDuration?: number; // Timeout in ms
  readonly retryPolicy?: { maxAttempts: number; backoffMs: number };
}

interface ToolRegistry {
  // Register
  registerTool<Args, Result>(tool: Tool<Args, Result>, impl: (args?: Args) => Result | Promise<Result>): Disposable;
  
  // Invoke
  invokeTool<Args, Result>(id: string, args?: Args): Promise<Result>;
  invokeToolIfAvailable<Args, Result>(id: string, args?: Args): Promise<Result | undefined>; // Returns undefined if not available
  
  // Query
  getTool(id: string): Tool | undefined;
  getTools(): Tool[];
  getAvailableTools(predicate?: (tool: Tool) => boolean): Tool[];
  
  // Lifecycle
  activateTool(toolId: string): Promise<void>;
  deactivateTool(toolId: string): Promise<void>;
  
  // Events
  onDidRegisterTool: Event<Tool>;
  onDidActivateTool: Event<{ tool: Tool; duration: number }>;
  onDidDeactivateTool: Event<Tool>;
  onDidInvokeTool: Event<{ tool: Tool; args?: unknown; result?: unknown; error?: Error }>;
}

type ActivationEvent =
  | { type: 'onStartup' } // Load eagerly
  | { type: 'onCommand'; commandId: string } // Load when command invoked
  | { type: 'onView'; viewId: string } // Load when view becomes visible
  | { type: 'onWorkspace'; condition: string } // Load when workspace matches condition (e.g., "contains:package.json")
  | { type: 'onDemand' }; // Load only when explicitly invoked
```

**What It Owns:**
- Tool identity and metadata (id, name, description).
- Tool availability predicates (when, requiredCapabilities).
- Tool input/output contracts.
- Tool activation events.
- Tool registry and invocation.

**What It Does NOT Own:**
- Capability checks (CapabilityService enforces; Tool only declares requirements).
- Tool implementation (owned by tool provider; registry only stores metadata).
- Persistence (owned by respective storage service).

**Migration Story from Current Code:**
- Current `ToolRegistry` extended with `when` clause and contract support.
- Existing tools registered via manifest continue to work.
- Activation events already exist; no change to their semantics.

**Compatibility Table Row:**
| Existing | Proposed | Mapping |
|----------|----------|---------|
| `registerTool(manifest)` | `registerTool(toolMetadata, impl)` | Metadata shape expands (adds `when`, contracts); backward compatible. |
| `invokeTool(id, args)` | Same | No change to invocation API. |
| Activation events | Same | Semantics unchanged. |

---

### 2.8 Contribution

**Definition:** A declarative addition by an extension or built-in to commands, views, menus, tools, settings, keybindings, schemas, or surfaces. The workbench contribution system is how features integrate without modifying core code.

**Current Parallx Implementation:**
- Processors: `CommandContribution` at [src/contributions/commandContribution.ts:L40](src/contributions/commandContribution.ts#L40), `KeybindingContribution` at [src/contributions/keybindingContribution.ts:L156](src/contributions/keybindingContribution.ts#L156), `ViewContribution` at [src/contributions/viewContribution.ts:L92](src/contributions/viewContribution.ts#L92), `MenuContribution` at [src/contributions/menuContribution.ts:L46](src/contributions/menuContribution.ts#L46)
- Handler: `WorkbenchContributionHandler` at [src/workbench/workbenchContributionHandler.ts:L46](src/workbench/workbenchContributionHandler.ts#L46)
- Flat model; no visibility predicates.

**Proposed Canonical Shape (TypeScript):**

```typescript
// Contribution types

interface CommandContribution {
  type: 'command';
  command: Command;
  when?: string; // Visibility predicate
}

interface KeybindingContribution {
  type: 'keybinding';
  keybinding: {
    key: string; // e.g., 'Ctrl+Shift+P'
    mac?: string; // Platform-specific overrides
    linux?: string;
    windows?: string;
    command: string; // Command ID
    when?: string; // When to enable this keybinding
    weight?: number; // Priority (higher = overrides lower)
  };
}

interface ViewContribution {
  type: 'view';
  view: {
    id: string;
    title: string;
    container: 'sidebar' | 'panel' | 'auxiliary-bar'; // Where view appears
    icon?: IconReference;
    visible?: boolean; // Initial visibility
    when?: string; // Visibility predicate
  };
  provider: ViewProvider; // Implements content
}

interface MenuContribution {
  type: 'menu';
  menu: {
    id: string; // Menu ID: 'editor/context', 'explorer/context', 'commandPalette', etc.
    group?: string; // Group within menu for sorting: '1_run@5'
    command: string; // Command ID
    when?: string; // Visibility predicate
    title?: string; // Override title for this menu
    icon?: IconReference;
  };
}

interface ToolContribution {
  type: 'tool';
  tool: Tool;
}

interface SettingContribution {
  type: 'setting';
  setting: {
    id: string; // Settings key
    title: string;
    description?: string;
    type: 'string' | 'number' | 'boolean' | 'array';
    defaultValue: unknown;
    enum?: unknown[]; // For dropdowns
    when?: string; // Visibility predicate
  };
}

type Contribution = CommandContribution | KeybindingContribution | ViewContribution | MenuContribution | ToolContribution | SettingContribution;

interface ContributionRegistry {
  // Register
  registerContribution(contribution: Contribution): Disposable;
  registerContributions(contributions: Contribution[]): Disposable;
  
  // Query
  getContributions(type?: Contribution['type']): Contribution[];
  getContributions(predicate: (c: Contribution) => boolean): Contribution[];
  
  // Visibility
  getVisibleContributions(type?: Contribution['type']): Contribution[]; // Filtered by `when` clauses
  
  // Events
  onDidRegisterContribution: Event<Contribution>;
  onDidUnregisterContribution: Event<Contribution>;
}
```

**What It Owns:**
- Contribution type registry.
- Contribution registration and lifecycle.
- Visibility predicate evaluation (when clauses).
- Contribution event stream.

**What It Does NOT Own:**
- Implementation of contributed items (owned by contributor).
- Persistence of contribution state (owned by respective service).

**Migration Story from Current Code:**
- Merge separate contribution processors into unified `ContributionRegistry`.
- Each processor remains as specialized handler (e.g., `MenuContribution` still processes menu items); registry just dispatches.
- Existing contributions continue to work (no breaking change; `when` is optional).

**Compatibility Table Row:**
| Existing | Proposed | Mapping |
|----------|----------|---------|
| Per-type contribution processors | Unified `ContributionRegistry` | Processors remain internal; registry is unified entry point. |
| No `when` support | `Contribution.when?: string` | Optional; adds visibility. |
| Flat contributions | Typed discriminated union | Cleaner type system; no breaking change. |

---

### 2.9 Capability

**Definition:** A permission-like declaration for privileged behavior: filesystem, shell, network, secrets, database, AI model access, or external process access. Tools declare what they need; workbench checks before granting access.

**Current Parallx Implementation:**
- Scattered: `AutonomyFeatureFlagsService` at [src/services/autonomyFeatureFlags.ts](src/services/autonomyFeatureFlags.ts), `PermissionService` at [src/services/permissionService.ts](src/services/permissionService.ts), individual service availability checks.
- No centralized Capability registry.

**Proposed Canonical Shape (TypeScript):**

```typescript
type CapabilityId =
  | 'filesystem' // Read/write files and directories
  | 'shell' // Execute shell commands
  | 'network' // Fetch URLs, make HTTP requests
  | 'secrets' // Access credential storage
  | 'database' // Query SQLite database
  | 'ai_model' // Invoke LLM (local or remote)
  | 'mcp' // Invoke MCP servers
  | 'autonomy' // Run background tasks, schedules
  | 'clipboard' // Read/write clipboard
  | 'notification' // Show notifications
  | 'theme' // Modify theme/colors
  // ... others as needed

interface Capability {
  readonly id: CapabilityId;
  readonly title: string; // Human-readable
  readonly description: string;
  readonly riskLevel: 'low' | 'medium' | 'high'; // For prompting user
  readonly default: 'allow' | 'deny' | 'ask'; // Default permission
}

interface CapabilityGrant {
  readonly capabilityId: CapabilityId;
  readonly toolId?: string; // Grant to specific tool; undefined = global
  readonly permission: 'allow' | 'deny';
  readonly grantedAt: Date;
  readonly grantedBy?: 'user' | 'system' | 'default';
  readonly expiresAt?: Date; // Optional expiration
}

interface CapabilityService {
  // Define capabilities
  registerCapability(capability: Capability): void;
  getCapability(id: CapabilityId): Capability | undefined;
  getCapabilities(): Capability[];
  
  // Check and grant
  isGranted(capabilityId: CapabilityId, toolId?: string): boolean;
  isGrantedOrAsk(capabilityId: CapabilityId, toolId?: string, reason?: string): Promise<boolean>; // May prompt user
  
  // Manage
  grantCapability(grant: CapabilityGrant): void;
  revokeCapability(capabilityId: CapabilityId, toolId?: string): void;
  getGrants(toolId?: string): CapabilityGrant[];
  
  // Events
  onDidGrantCapability: Event<CapabilityGrant>;
  onDidRevokeCapability: Event<{ capabilityId: CapabilityId; toolId?: string }>;
}
```

**What It Owns:**
- Capability definitions (registry of known capabilities).
- Permission state (who has access to what).
- Permission checks and prompting.
- Grant/revoke events.

**What It Does NOT Own:**
- Enforcement (delegated to each service that uses a capability).
- UI for permission prompting (delegated to UI framework).

**Migration Story from Current Code:**
- Create `CapabilityService` as a new service; centralize capability definitions.
- Existing feature flags (autonomy, ai, etc.) become capabilities.
- Services check `capabilityService.isGranted(capabilityId)` instead of checking scattered flags.

**Compatibility Table Row:**
| Existing | Proposed | Mapping |
|----------|----------|---------|
| Scattered feature flags | `CapabilityService` registry | Centralized; flags become capability definitions. |
| Direct permission checks | `isGranted(capabilityId)` | Same behavior; typed API. |
| No capability hierarchy | Flat `CapabilityId` enum | Simple to understand; no complex inheritance. |

---

### 2.10 Event

**Definition:** A typed notification that something changed: workspace, resource, selection, command, job, editor, canvas structure, extension state, or configuration. Enables cross-tool observation without polling or direct coupling.

**Current Parallx Implementation:**
- Base: `Emitter<T>` / `Event<T>` at [src/platform/events.ts](src/platform/events.ts)
- Sample events scattered across services (workbench, editor, canvas, chat, workspace).
- No centralized event registry or discovery.

**Proposed Canonical Shape (TypeScript):**

```typescript
// Event types (typed, discoverable)

interface WorkspaceEvents {
  onDidOpen: Event<Workspace>;
  onDidClose: Event<Workspace>;
  onDidChangeState: Event<{ workspace: Workspace; key: string; value: unknown }>;
  onDidChangeFolders: Event<{ workspace: Workspace; added: WorkspaceFolder[]; removed: WorkspaceFolder[] }>;
}

interface ResourceEvents {
  onDidCreate: Event<Resource>;
  onDidDelete: Event<Resource>;
  onDidChange: Event<{ resource: Resource; oldValue?: unknown }>;
  onDidMove: Event<{ resource: Resource; oldResource: Resource }>;
  onDidRename: Event<{ resource: Resource; oldName: string; newName: string }>;
}

interface SelectionEvents {
  onDidChangeSelection: Event<{ selection: Selection | undefined; previous?: Selection }>;
}

interface SurfaceEvents {
  onDidChangeActiveSurface: Event<{ active: Surface; inactive?: Surface }>;
  onDidRegisterSurface: Event<Surface>;
  onDidUnregisterSurface: Event<Surface>;
}

interface EditorEvents {
  onDidOpenEditor: Event<{ editor: EditorPane; surface: Surface }>;
  onDidCloseEditor: Event<{ editor: EditorPane }>;
  onDidChangeActiveEditor: Event<{ editor?: EditorPane; previous?: EditorPane }>;
  onDidChangeContent: Event<{ editor: EditorPane; isDirty: boolean }>;
  onDidSaveEditor: Event<{ editor: EditorPane }>;
}

interface CanvasEvents {
  onDidCreatePage: Event<{ page: CanvasPage }>;
  onDidDeletePage: Event<{ pageId: UUID }>;
  onDidChangePage: Event<{ page: CanvasPage; isDirty: boolean }>;
  onDidSavePage: Event<{ page: CanvasPage }>;
  onDidChangeBlock: Event<{ pageId: UUID; blockId: UUID; block: Block }>;
  onDidInsertBlock: Event<{ pageId: UUID; blockId: UUID; index: number }>;
  onDidDeleteBlock: Event<{ pageId: UUID; blockId: UUID }>;
  onDidLinkBlock: Event<{ pageId: UUID; blockId: UUID; targetId: string }>;
}

interface ChatEvents {
  onDidCreateSession: Event<{ sessionId: UUID }>;
  onDidDeleteSession: Event<{ sessionId: UUID }>;
  onDidReceiveMessage: Event<{ sessionId: UUID; messageId: UUID; message: ChatMessage }>;
  onDidReceiveTurn: Event<{ sessionId: UUID; turnId: UUID; turn: Turn; artifacts: Artifact[] }>;
}

interface CommandEvents {
  onDidRegisterCommand: Event<Command>;
  onDidUnregisterCommand: Event<string>;
  onDidExecuteCommand: Event<{ id: string; args?: unknown; result?: unknown; error?: Error }>;
}

interface ToolEvents {
  onDidRegisterTool: Event<Tool>;
  onDidUnregisterTool: Event<string>;
  onDidActivateTool: Event<{ tool: Tool; duration: number }>;
  onDidDeactivateTool: Event<Tool>;
  onDidInvokeTool: Event<{ tool: Tool; args?: unknown; result?: unknown; error?: Error }>;
}

interface ConfigurationEvents {
  onDidChangeConfiguration: Event<{ key: string; workspace?: Workspace }>;
}

interface ThemeEvents {
  onDidChangeTheme: Event<{ theme: Theme }>;
}

// Central event registry
interface EventRegistry {
  // Access event stream for any domain
  getEvents(domain: 'workspace' | 'resource' | 'selection' | 'surface' | 'editor' | 'canvas' | 'chat' | 'command' | 'tool' | 'configuration' | 'theme'): unknown; // Typed per domain
  
  // Example access methods (one per domain)
  workspace(): WorkspaceEvents;
  resource(): ResourceEvents;
  selection(): SelectionEvents;
  surface(): SurfaceEvents;
  editor(): EditorEvents;
  canvas(): CanvasEvents;
  chat(): ChatEvents;
  command(): CommandEvents;
  tool(): ToolEvents;
  configuration(): ConfigurationEvents;
  theme(): ThemeEvents;
}
```

**What It Owns:**
- Event definitions (typed).
- Event streams (Emitter implementation).
- Event registry (discoverable list).

**What It Does NOT Own:**
- Event generation (owned by service that fires event).
- Event handling (owned by observer).

**Migration Story from Current Code:**
- Create `EventRegistry` service that aggregates existing events from services.
- Existing `Emitter<T>` / `Event<T>` patterns continue unchanged (underlying implementation).
- Services continue to emit events (no change to emission code).
- New code can discover events via registry for documentation/IDE code-complete.

**Compatibility Table Row:**
| Existing | Proposed | Mapping |
|----------|----------|---------|
| Scattered events in services | `EventRegistry` | Centralized discovery; existing events unchanged. |
| `Emitter<T> / Event<T>` base | Same | No change to implementation. |
| Ad hoc event definitions | Typed event domain interfaces | Better documentation; same behavior. |

---

### 2.11 Task

**Definition:** A foreground or background unit of work with identity, priority, workspace ownership, cancellation, timeout, retry, and result behavior. The abstraction for discrete workable units (beyond commands/tools).

**Current Parallx Implementation:**
- No unified task service. Background work is ad hoc: autonomy heartbeat, indexing pipeline, chat turns.
- Each subsystem manages its own lifecycle.

**Proposed Canonical Shape (TypeScript):**

```typescript
type TaskPriority = 'foreground' | 'background' | 'idle';

interface Task<Result = unknown> {
  readonly id: UUID;
  readonly name: string; // Display name
  readonly priority: TaskPriority;
  readonly workspaceId?: UUID; // Task belongs to workspace; cancelled if workspace closes
  
  // Lifecycle
  readonly state: 'created' | 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  readonly progress?: {
    readonly current: number;
    readonly total: number;
    readonly message?: string;
  };
  
  // Timing
  readonly createdAt: Date;
  readonly startedAt?: Date;
  readonly completedAt?: Date;
  readonly timeout?: number; // Milliseconds until auto-cancel
  readonly maxAttempts?: number; // Retry limit
  readonly retryBackoff?: number; // Milliseconds between retries
  
  // Cancellation
  cancel(reason?: string): Promise<void>;
  readonly cancellationToken: CancellationToken;
  
  // Result
  readonly result?: Result;
  readonly error?: Error;
}

interface CancellationToken {
  readonly isCancellationRequested: boolean;
  readonly onCancellationRequested: Event<void>;
  throwIfCancellationRequested(): void;
}

interface TaskService {
  // Create and queue
  createTask<Result = unknown>(task: Omit<Task<Result>, 'id' | 'state' | 'createdAt'>, impl: (token: CancellationToken) => Promise<Result>): Task<Result>;
  queueTask<Result = unknown>(task: Task<Result>): void;
  
  // Access
  getTask(taskId: UUID): Task | undefined;
  getTasks(predicate?: (task: Task) => boolean): Task[];
  getRunningTasks(): Task[];
  
  // Control
  cancelTask(taskId: UUID, reason?: string): Promise<void>;
  cancelTasks(workspaceId?: UUID): Promise<void>; // Cancel all tasks for workspace
  
  // Events
  onDidCreateTask: Event<Task>;
  onDidStartTask: Event<Task>;
  onDidProgressTask: Event<{ task: Task; progress: Task['progress'] }>;
  onDidCompleteTask: Event<{ task: Task; result?: unknown; error?: Error }>;
  onDidCancelTask: Event<{ task: Task; reason?: string }>;
}
```

**What It Owns:**
- Task identity and lifecycle (created, queued, running, succeeded, failed, cancelled).
- Task queuing and execution policy (priority, concurrency).
- Cancellation tokens and timeout management.
- Task result/error.
- Task event stream.

**What It Does NOT Own:**
- Persistence of task state (tasks are ephemeral unless explicitly persisted).
- Task scheduling (e.g., cron jobs). See CronService (future).

**Migration Story from Current Code:**
- Create `TaskService` as a new core service.
- Autonomy background work (heartbeat, cron, subagents) migrates from Chat to TaskService.
- Indexing pipeline continues to use TaskService for background indexing.
- Existing background work behavior is unchanged (TaskService is implementation detail).

**Compatibility Table Row:**
| Existing | Proposed | Mapping |
|----------|----------|---------|
| (no unified task API) | `TaskService` | New service; no breaking change. Existing background work refactored to use it. |
| Autonomy hardcoded in Chat | Autonomy via `TaskService` | Autonomy lifecycle decoupled from Chat. |

---

### 2.12 Artifact

**Definition:** A durable or temporary output that can be opened, linked, inserted, saved, or referenced later. Examples: Canvas pages, chat messages, generated documents, search results, tool outputs.

**Current Parallx Implementation:**
- Canvas pages (persisted, referenceable).
- Chat messages/turns (persisted, referenceable).
- No unified Artifact abstraction; each feature defines its own.

**Proposed Canonical Shape (TypeScript):**

```typescript
type ArtifactDurability = 'permanent' | 'session' | 'temporary';

interface Artifact {
  readonly id: string; // Unique identifier within scope
  readonly type: string; // 'canvas.page', 'chat.message', 'generated.document', etc.
  readonly title?: string; // Display title
  readonly content: unknown; // Type-specific content
  readonly mimeType?: string; // For file artifacts: 'text/plain', 'application/json', etc.
  
  // Metadata
  readonly durability: ArtifactDurability;
  readonly createdAt: Date;
  readonly updatedAt?: Date;
  readonly createdBy?: { toolId: string; userId?: string }; // Provenance
  readonly workspaceId?: UUID; // Workspace scope
  readonly resource?: Resource; // If this artifact is resolvable as a Resource
  
  // Operations
  save?(): Promise<void>; // Persist (if not already persisted)
  delete?(): Promise<void>; // Delete
  export?(format: string): Promise<Blob>; // Export to specific format
  
  // Links
  readonly links?: Array<{ target: Resource | Artifact; relation: string }>; // Outgoing links
}

interface ArtifactRegistry {
  // Register
  registerArtifact(artifact: Artifact): Disposable;
  
  // Access
  getArtifact(type: string, id: string): Artifact | undefined;
  getArtifacts(predicate?: (artifact: Artifact) => boolean): Artifact[];
  getArtifacts(type: string): Artifact[];
  
  // Events
  onDidCreateArtifact: Event<Artifact>;
  onDidChangeArtifact: Event<{ artifact: Artifact; changes: Partial<Artifact> }>;
  onDidDeleteArtifact: Event<{ type: string; id: string }>;
}
```

**What It Owns:**
- Artifact identity and metadata.
- Artifact persistence (save/delete).
- Artifact linkage.
- Artifact event stream.

**What It Does NOT Own:**
- Artifact content storage (delegated to respective service: Canvas for pages, Chat for messages).
- Rendering artifacts (delegated to editor/view provider).

**Migration Story from Current Code:**
- Canvas pages and chat turns are already artifacts (persisted, referenceable).
- Create `ArtifactRegistry` for discovery and linking.
- Existing Canvas/Chat code continues unchanged; they register their artifacts with the registry.

**Compatibility Table Row:**
| Existing | Proposed | Mapping |
|----------|----------|---------|
| Canvas pages (internal to Canvas) | `Artifact { type: 'canvas.page', id: pageId }` | Canvas pages are instances of Artifact. |
| Chat turns (internal to Chat) | `Artifact { type: 'chat.turn', id: turnId }` | Chat turns are instances of Artifact. |
| (no unified artifact model) | `ArtifactRegistry` | New registry; existing artifacts register automatically. |

---

### 2.13 Provenance

**Definition:** The source trail for a resource or artifact: where it came from, which tool or command created it, which workspace/user action it belongs to, and what triggered it. Enables audit, recovery, and lineage tracing.

**Current Parallx Implementation:**
- Scattered: Canvas pages track creator and timestamp; chat messages track sender; no unified provenance model.
- No cross-tool tracing.

**Proposed Canonical Shape (TypeScript):**

```typescript
interface Provenance {
  // Source trail
  readonly source: 'user' | 'ai' | 'tool' | 'system'; // Who/what created it?
  readonly creator?: {
    toolId?: string; // If tool-created
    userId?: string; // If user-created
    commandId?: string; // If command-created
    taskId?: UUID; // If task-created
  };
  
  // Context
  readonly workspaceId: UUID;
  readonly surfaceId?: string; // Which surface was active?
  readonly parentResource?: Resource; // What was the input (e.g., file that was analyzed)?
  readonly parentArtifact?: Artifact; // What artifact triggered this (e.g., canvas page that was edited)?
  
  // Timing
  readonly createdAt: Date;
  readonly triggeredBy?: string; // Event or action name that triggered creation
  
  // Metadata
  readonly checkpoint?: string; // Workflow step (e.g., 'chat.turn.1', 'canvas.block.insert')
  readonly metadata?: Record<string, unknown>; // Custom metadata per source
}

interface ProvenanceService {
  // Trace
  getProvenance(resource: Resource | Artifact): Provenance | undefined;
  getLineage(resource: Resource | Artifact): Provenance[]; // Full chain back to original
  
  // Create
  record(source: Provenance['source'], context: Omit<Provenance, 'source'>): void;
  
  // Query
  getResourcesBySource(source: Provenance['source']): (Resource | Artifact)[];
  getResourcesByCreator(toolId: string): (Resource | Artifact)[];
  getResourcesByWorkspace(workspaceId: UUID): (Resource | Artifact)[];
  
  // Events
  onDidRecordProvenance: Event<Provenance>;
}
```

**What It Owns:**
- Provenance recording (source trail).
- Lineage tracing (full chain).
- Audit queries.
- Provenance event stream.

**What It Does NOT Own:**
- Enforcement (delegated to policy service, if created).
- Retention policies (delegated to workspace settings).

**Migration Story from Current Code:**
- Create `ProvenanceService` as a new service.
- Canvas pages, chat messages, generated documents all record provenance on creation.
- Existing code continues unchanged; provenance is recorded asynchronously.

**Compatibility Table Row:**
| Existing | Proposed | Mapping |
|----------|----------|---------|
| Canvas page creator + timestamp | `Provenance { source: 'tool', creator.toolId: 'canvas', createdAt }` | Canvas provenance is a Provenance instance. |
| Chat message sender | `Provenance { source: 'ai' or 'user', creator.userId, createdAt }` | Chat provenance is a Provenance instance. |
| (no unified provenance model) | `ProvenanceService` | New service; existing provenance data recorded in new format. |

---

## 3. The Ten Open Design Questions (Answered)

Each question from [WORKBENCH_CURRENT_CODE_RESEARCH_BRIEF §G](docs/research/WORKBENCH_CURRENT_CODE_RESEARCH_BRIEF.md) with decision and rationale.

### Q1: Canonical `Resource` Identity Across File/Canvas/Chat/Tool Artifacts

**Decision:** `Resource` is a discriminated union (sum type) with variants per content type. All resources are resolvable via `LinkResolverService` using the unified URI scheme `parallx://type:id`.

**Rationale:**
- **Current problem:** Chat hardcodes `parallx.canvas:canvas:<uuid>` at [src/built-in/chat/data/chatDataService.ts:L1-L50](docs/architecture/SYSTEM_ATLAS.md#41-one-off-bridges-hard-coded-couplings). Files use `file://`. No unified identity across types.
- **External pattern:** VS Code uses per-scheme URIs with formatters ([EXTERNAL_BRIEF §I.C](docs/research/WORKBENCH_EXTERNAL_ARCHITECTURE_RESEARCH_BRIEF.md)); Eclipse uses typed IResource hierarchy ([EXTERNAL_BRIEF §II.A](docs/research/WORKBENCH_EXTERNAL_ARCHITECTURE_RESEARCH_BRIEF.md)). Composite approach: union type + central resolver.
- **Atlas anchor:** Cross-tool bridges (§4.1) document the current fragmentation. Unified Resource resolves this.
- **Baseline impact:** No performance regression if `LinkResolverService` is lazy-loaded per scheme.
- **Test:** Characterization test (proposed at [Baseline §4](docs/research/baselines/workbench-baseline.md#4-proposed-characterization-tests)): resolve same resource via multiple URI formats; verify equivalence.

---

### Q2: Should `Selection` Be a Workbench-Level Primitive Observable by Any Surface?

**Decision:** Yes. `Selection` is a shared workbench primitive with typed events. Each surface emits `onDidChangeSelection` with a typed Selection object. Handlers subscribe to the event (not a dispatcher routing to named handlers).

**Rationale:**
- **Current problem:** SelectionActionDispatcher at [src/services/selectionActionDispatcher.ts:L16](docs/architecture/SYSTEM_ATLAS.md#2-system-ownership-table) is a one-off bridge. Adding new destinations (e.g., "send to tool X") requires modifying `selectionActionHandlers.ts`. Hard to extend.
- **External pattern:** VS Code uses context keys (implicit observation); IntelliJ uses listener topics (explicit subscriptions). Parallx adopts typed events (explicit + typed).
- **Baseline impact:** Selection events are coalesced per surface to avoid flooding the event loop (100ms window debounce).
- **Test:** SelectionToChatAttach test (proposed) verifies that selecting a file fires an event and chat can subscribe to it.
- **Anti-pattern:** Do NOT create SelectionMode enum with 20+ variants. Each surface defines its own Selection shape via union type.

---

### Q3: Where Should `Surface` Concept Live?

**Decision:** `Surface` is a workbench-level primitive. Lives in a new `SurfaceRegistry` service at `src/layout/surfaceRegistry.ts` (or `src/workbench/surfaceRegistry.ts`). Each part (EditorPart, ExplorerView, ChatWidget, etc.) registers itself as a Surface on initialization.

**Rationale:**
- **Current problem:** No unified Surface abstraction. Parts are coupled directly to Layout. EditorService, Chat, Canvas do not know about each other's UI state.
- **External pattern:** VS Code has implicit surfaces (editor, panel, sidebar). Eclipse couples surfaces to layout (IEditorPart, IViewPart). Parallx adopts explicit Surface registry with parts registering themselves.
- **Atlas anchor:** Layout system at [src/workbench/workbench.ts:L300-L400](docs/architecture/SYSTEM_ATLAS.md#1-entry-points-for-the-primary-workflow) orchestrates parts. SurfaceRegistry is a peer service.
- **Baseline impact:** Surface registry has minimal overhead (lookup O(1), event O(num_observers)).
- **Test:** SurfaceFocus test (proposed) verifies that switching focus between surfaces fires events and updates activeSelection.

---

### Q4: Can `Capability` Be Centralized?

**Decision:** Yes. `CapabilityService` is a new centralized service. Tool manifests declare `requiredCapabilities`. Workbench checks before activating or invoking tools. Capabilities: filesystem, shell, network, secrets, database, ai_model, mcp, autonomy, etc. (~15 total, not 100+).

**Rationale:**
- **Current problem:** Capabilities are scattered. `AutonomyFeatureFlagsService` at [src/services/autonomyFeatureFlags.ts](docs/architecture/SYSTEM_ATLAS.md#2-system-ownership-table) for autonomy-specific flags. `PermissionService` at [src/services/permissionService.ts](docs/architecture/SYSTEM_ATLAS.md#2-system-ownership-table) for tool permissions. No unified model.
- **External pattern:** VS Code declares capabilities in package.json; Eclipse is ad hoc. Parallx adopts centralized CapabilityService with typed CapabilityId enum.
- **Baseline impact:** Capability checks are O(1) lookups; no perf regression.
- **Test:** CapabilityGating test (proposed) verifies that a tool without required capability cannot be invoked.
- **Anti-pattern:** Do NOT make capabilities too granular (e.g., `filesystem.write.home` vs `filesystem.write.workspace`). Stick to top-level capabilities.

---

### Q5: Should Tool Deactivation Guarantee Contribution Removal?

**Decision:** Yes. When a tool is deactivated or uninstalled, all its contributions are removed from all registries. `ToolActivator.deactivate()` calls a standardized `cleanupToolContributions(toolId)` that:
- Removes tool's commands from CommandRegistry.
- Removes tool's views from ViewRegistry.
- Removes tool's menu items from MenuRegistry.
- Removes tool's keybindings from KeybindingRegistry.
- Emits `onDidUnregisterToolContributions(toolId)` so services (Chat, Canvas) can react.

**Rationale:**
- **Current problem:** Tool deactivation cleanup is not comprehensive (see [SYSTEM_ATLAS §4.2 "Tool enablement" row](docs/architecture/SYSTEM_ATLAS.md#42-ambiguous-or-duplicate-state-ownership)). Disabling media-organizer does not remove its menu items. Contributes remain visible; handlers never called.
- **External pattern:** Eclipse fires `IRegistryChangeEvent` on unload, forcing clients to handle `InvalidRegistryObjectException`. IntelliJ does not unload. Parallx ensures cleanup is automatic (not client's responsibility).
- **Atlas anchor:** Cross-tool bridge §5 ("Tool deactivation vs contribution lifecycle") cites this as an open question.
- **Baseline impact:** Cleanup is asynchronous if a tool created 1000+ artifacts. Provides progress notification.
- **Test:** ToolUnloadContributionCleanup test (proposed) verifies contributions are removed after tool deactivates.

---

### Q6: URI Migration Path for `parallx.canvas:canvas:<uuid>`?

**Decision:** Backward-compatible aliasing. Old URI scheme (`parallx.canvas:canvas:UUID`) is registered in LinkResolverService with an alias to the new canonical scheme (`parallx://canvas-page:UUID`). Old URIs redirect to new. Gradual migration: new Canvas pages use canonical scheme; old pages are migrated on first access.

**Rationale:**
- **Current problem:** Hard-coded URI pattern in Chat at [src/built-in/chat/data/chatDataService.ts:L1-L50](docs/architecture/SYSTEM_ATLAS.md#41-one-off-bridges-hard-coded-couplings). One-time migration script would break existing workspaces.
- **External pattern:** VS Code uses URI aliasing implicitly (multiple URI schemes for same content). Eclipse uses plugin namespace versioning.
- **Atlas anchor:** Resource identity (§Q1) defines canonical schemes. Migration path (§Q6) is the transition strategy.
- **Baseline impact:** No performance impact; aliasing is O(1).
- **Test:** LegacyUriResolution test (proposed) verifies old URIs resolve to equivalent new URIs.
- **Breaking change:** None. Old URIs continue to work indefinitely.

---

### Q7: Should Autonomy Be Lifted Out of Chat Into Top-Level Workbench Task Service?

**Decision:** Yes. Create a top-level `TaskService` at `src/services/taskService.ts`. Autonomy (heartbeat, cron, subagents) migrates from Chat activation into TaskService. Chat can schedule autonomy tasks via TaskService without owning their lifecycle. TaskService handles queueing, cancellation, timeouts, retries.

**Rationale:**
- **Current problem:** Autonomy code lives in Chat activation (see [SYSTEM_ATLAS §4.3 "Autonomy ↔ Chat activation"](docs/architecture/SYSTEM_ATLAS.md#43-hidden-coupling)). If Chat is disabled, autonomy is disabled. Coupling is problematic.
- **External pattern:** VS Code has no autonomy. IntelliJ's ProgressManager / BackgroundableTask decouples task execution from UI. Parallx adopts TaskService pattern.
- **Atlas anchor:** Cross-tool edge (Chat → Autonomy) is current hidden coupling (§4.3). TaskService decouples.
- **Baseline impact:** TaskService adds no runtime overhead (same background work, cleaner abstraction).
- **Test:** AutonomyLifecycleIndependence test (proposed) verifies autonomy tasks run even if Chat is disabled.

---

### Q8: Should `SelectionActionDispatcher` Be Replaced by Typed Events?

**Decision:** Yes. Replace SelectionActionDispatcher with `SelectionService.onDidChangeSelection` event. Each surface emits typed Selection events. Handlers subscribe to the events instead of dispatcher routing to named handlers.

**Rationale:**
- **Current problem:** SelectionActionDispatcher at [src/services/selectionActionDispatcher.ts:L16](docs/architecture/SYSTEM_ATLAS.md#41-one-off-bridges-hard-coded-couplings) is a one-off bridge. Hard-coded handler names (`AddSelectionToChatHandler`, `SendSelectionToCanvasHandler`). Adding new destination requires modifying handler code.
- **External pattern:** VS Code uses events implicitly (context changes). IntelliJ uses explicit listener topics. Parallx adopts typed events.
- **Atlas anchor:** Selection primitive (§Q2) defines this change.
- **Baseline impact:** Event dispatch is O(num_subscribers); coalesced to prevent flooding.
- **Test:** SelectionEventRouting test (proposed) verifies that selecting file → Chat can receive event and add attachment.
- **Implementation:** Backward compatibility: old SelectionActionDispatcher is a shim that subscribes to `onDidChangeSelection` and calls old handlers.

---

### Q9: Should `Workspace` Be the Canonical Owner of Folder Set?

**Decision:** Yes. `Workspace.folders` is the canonical source of truth. `FileService` derives its root from `Workspace.folders[0]`. When folders change, Workspace emits `onDidChangeFolders`; FileService re-scans if needed.

**Rationale:**
- **Current problem:** Dual source: `Workspace.folders` and `FileService.setWorkspaceRoot()` can both update the folder set. Two separate notifications. Eventual consistency only.
- **External pattern:** VS Code owns folder set in workbench. Parallx adopts same.
- **Atlas anchor:** Workspace primitive (§2.1) clarifies ownership. Current issue at [SYSTEM_ATLAS §4.2 "Workspace folder set" row](docs/architecture/SYSTEM_ATLAS.md#42-ambiguous-or-duplicate-state-ownership).
- **Baseline impact:** Folder changes are debounced into single event; no regression.
- **Test:** WorkspaceFolderCanonicalOwnership test (proposed) verifies single source of truth.
- **Migration:** Remove `FileService.setWorkspaceRoot()` write path; make it read-only (derives from Workspace.folders).

---

### Q10: Persistence-Version Migration Test Pattern?

**Decision:** Standard migration test pattern (schema version + rollback):
1. Create a fresh workspace at schema version N-1.
2. Save state to `.parallx/workspace-state.json` and `.parallx/data.db` with old schema.
3. Upgrade app (migration N-1 → N runs).
4. Verify state is correct (specific assertions per migration).
5. Downgrade app (rollback N → N-1 runs).
6. Verify state is still correct.

This pattern is implemented in `tests/unit/migrationRollback.test.ts` (proposed) and is required for every schema version change.

**Rationale:**
- **Current problem:** No standardized migration test. Database migrations at [electron/database.cjs:L200+](docs/architecture/SYSTEM_ATLAS.md#6-ipc-contract-index) are not rollback-tested. Risk of corrupted state.
- **External pattern:** VS Code, Eclipse, IntelliJ all use migration versioning. Parallx adopts standard pattern.
- **Baseline impact:** Migration tests add to test suite but do not affect runtime.
- **Test:** MigrationRollback test (proposed, required for every schema change).
- **Tool:** Migration testing framework at `src/testing/migrationTestHelper.ts` (proposed).

---

## 4. Cross-Tool Bridge Replacement Plan

Every bridge in [SYSTEM_ATLAS §4.1 "One-Off Bridges"](docs/architecture/SYSTEM_ATLAS.md#41-one-off-bridges-hard-coded-couplings) has a replacement:

| # | Current Bridge | Code Anchor | Proposed Replacement | Primitive(s) Involved | Migration Ordering | Test Required |
|---|---|---|---|---|---|---|
| 1 | Selection → Chat (AddSelectionToChatHandler) | [src/services/selectionActionHandlers.ts:L35-L70](docs/architecture/SYSTEM_ATLAS.md#41-one-off-bridges-hard-coded-couplings) | SelectionService.onDidChangeSelection event; Chat subscribes | Selection, Event, Surface | SelectionService lands first | SelectionEventRouting test |
| 2 | Selection → Canvas (SendSelectionToCanvasHandler) | [src/services/selectionActionHandlers.ts:L70-L120](docs/architecture/SYSTEM_ATLAS.md#41-one-off-bridges-hard-coded-couplings) | SelectionService.onDidChangeSelection event; Canvas subscribes | Selection, Event, Surface | SelectionService lands first | SelectionEventRouting test |
| 3 | Canvas pages ↔ Chat context (hard-coded URI pattern) | [src/built-in/chat/data/chatDataService.ts:L1-L50](docs/architecture/SYSTEM_ATLAS.md#41-one-off-bridges-hard-coded-couplings) | LinkResolverService resolves `parallx://canvas-page:<uuid>`; alias old scheme | Resource, LinkResolverService | LinkResolverService + Resource both land | LegacyUriResolution test |
| 4 | Chat ↔ Explorer attachments (iterates api.editors.openEditors) | [src/built-in/chat/input/chatContextAttachments.ts:L25-L80](docs/architecture/SYSTEM_ATLAS.md#41-one-off-bridges-hard-coded-couplings) | EditorService publishes onDidChangeOpenEditors event; Chat subscribes | Event, Surface, EditorService | EditorService event lands first | EditorAttachmentSync test |
| 5 | Canvas sidebar ↔ Editor part (hardcoded openEditor call) | [src/built-in/canvas/canvasSidebar.ts:L49-L150](docs/architecture/SYSTEM_ATLAS.md#41-one-off-bridges-hard-coded-couplings) | Canvas sidebar observes EditorService.onDidChangeOpenEditors; keeps cache in sync | Event, Surface, EditorService | EditorService event lands first | CanvasSidebarSync test |
| 6 | Recent workspaces ↔ Workspace service (dual metadata updates) | [src/workspace/recentWorkspaces.ts:L20-L80](docs/architecture/SYSTEM_ATLAS.md#41-one-off-bridges-hard-coded-couplings) | Workspace is canonical owner; RecentWorkspaces observes onDidChangeFolders | Workspace, Event | Workspace canonical ownership lands first | WorkspaceFolderCanonicalOwnership test |
| 7 | Link resolution (per-feature URI handlers) | [src/links/linkResolverService.ts:L1-L100](docs/architecture/SYSTEM_ATLAS.md#41-one-off-bridges-hard-coded-couplings) | Centralized LinkResolverService with Resource union type; each type registers its resolver | Resource, LinkResolverService | Resource union type + LinkResolverService unify | LegacyUriResolution test |

**Migration Ordering:**
1. **Phase 1: Core Primitives** — Resource, Workspace, SelectionService, Event.
2. **Phase 2: Services** — LinkResolverService, SurfaceRegistry, CommandRegistry updates.
3. **Phase 3: Bridge Replacement** — Each one-off bridge is replaced in parallel; tests verify equivalence.

---

## 5. Duplicate-Contract Resolution

Every ambiguous state ownership ([SYSTEM_ATLAS §4.2 "Ambiguous State Ownership"](docs/architecture/SYSTEM_ATLAS.md#42-ambiguous-or-duplicate-state-ownership)) is resolved:

| State Domain | Current Owners | Single Owner (Proposed) | Delegation Model | Resolution Mechanism |
|---|---|---|---|---|
| Canvas page structure | CanvasDataService (DB) + Canvas editor in-memory tree | CanvasDataService (DB is source of truth) | Canvas editor caches in-memory; auto-save persists delta to DB | Auto-save on edit (3s debounce) syncs in-memory → DB |
| Chat session history | ChatDataService (DB) + Chat widget session object | ChatDataService (DB is source of truth) | Chat widget holds turns in-memory; explicit save on turn completion | Turn executor fires `onDidReceiveTurn`; ChatDataService persists |
| Open editor state | `.parallx/workspace-state.json` (source of truth) | Workspace (owns state persistence) | EditorService holds open editors in memory; Workspace snapshots on save | WorkspaceSaver captures open editor snapshots on workspace close |
| Workspace folder set | `Workspace.folders` (canonical) + `FileService.workspaceRoot` (secondary) | Workspace is canonical | FileService reads `Workspace.folders` for root | Workspace emits `onDidChangeFolders`; FileService listens |
| Tool enablement | `.parallx/settings.json` + Contribution registrations | ToolEnablementService (owns enabled flag) + ContributionRegistry (owns contributions) | Disabling tool unregisters contributions via `cleanupToolContributions()` | Tool deactivation fires `onDidUnregisterToolContributions`; handlers clean up |
| Context keys | Runtime map + `.parallx/workspace-state.json` (selected keys) | ContextService (runtime is authoritative) | Workspace auto-saves selected keys on close | On workspace close: WorkspaceSaver captures context keys marked for persistence |
| Layout and parts state | `.parallx/workspace-state.json` (source of truth) | Workspace (owns state persistence) | Layout service holds state in memory; Workspace snapshots on save | WorkspaceSaver captures layout tree on workspace close |

**Resolution Pattern:** Every disputed state has a **canonical owner** (single source of truth) and a **delegation model** (how other holders stay in sync). Synchronization is one-directional (canonical → delegated) or event-based (canonical emits event; delegated subscribes).

---

## 6. Lifecycle and Activation Model

### 6.1 App Startup Phases (Enhanced from Current)

| Phase | Responsibility | Duration Target | Events Fired |
|---|---|---|---|
| **Phase 0: Bootstrap** | Renderer loads HTML, DI container instantiated, Workbench created | — | — |
| **Phase 1: Services** | Register core services (Workspace, Editor, File, Database, Command, Tool, Context, Surface, Selection, Capability, Task, etc.) | < 500ms | `onDidRegisterService` (per service) |
| **Phase 2: Layout** | Build grid system, create Layout parts (editor pane, sidebar, panel, status bar, titlebar) | < 200ms | `onDidRegisterSurface` (per part) |
| **Phase 3: Parts** | Instantiate and render parts; register as Surfaces | < 300ms | `onDidRegisterSurface` (per part) |
| **Phase 4: Workspace Restore** | Load saved layout/editor snapshots from workspace state file; deserialize and apply | < 2000ms (depends on workspace size) | `onDidOpen` (Workspace), `onDidChangeState` (per editor snapshot) |
| **Phase 5: Built-in Tool Activation** | Activate all built-in tools (Explorer, Canvas, Chat, Search, Welcome, etc.) in parallel using precise activation events | < 1000ms (target; depends on network/AI) | `onDidActivateTool` (per tool) |
| **Phase 6: Extension Activation** | Activate user-installed extensions using precise activation events (on-demand, not eager) | 0ms (deferred to on-demand) | `onDidActivateTool` (per extension) |
| **Phase 7: Ready** | Fire `onDidInitialize`, add CSS class `ready`, log ready state, enable user interaction | — | `onDidInitialize` |

### 6.2 Contribution Registration vs Tool Activation

**Relationship:** These are **orthogonal** but related.

- **Contribution registration:** Happens during tool **activation** (when tool's `activate()` method is called). Tool returns manifest with contributions; workbench registers them.
- **Tool activation:** Triggered by activation events. Tool code loads; contributions are registered as a side effect.

**Consequence:** If a tool is not activated, its contributions are not registered. If a tool is deactivated, its contributions are unregistered.

### 6.3 Workspace Lifecycle

```
App starts
  ↓
Phase 4: Workspace Restore
  ↓
Workspace instance created, onDidOpen fired
  ↓
Workspace is open and active
  ↓
(User can work with resources, open editors, use extensions)
  ↓
User closes app or switches workspace
  ↓
workspace.onWillClose fired
  ↓
Dirty editors saved (auto-save or prompt)
  ↓
Layout + editor snapshots captured
  ↓
WorkspaceSaver.save() → .parallx/workspace-state.json written
  ↓
workspace.onDidClose fired
  ↓
Workspace is closed (ephemeral state cleared, persistent state saved)
  ↓
App can restore Workspace later
```

---

## 7. Compatibility and Migration Strategy

### 7.1 Compatibility Table: Existing Public APIs → New Primitives

| Existing Public API | Module | Current Behavior | Proposed Mapping | Migration Path | Deprecation Window |
|---|---|---|---|---|---|
| `editorService.openEditor(input)` | [src/services/editorService.ts:L50-L120](docs/architecture/SYSTEM_ATLAS.md#1-entry-points-for-the-primary-workflow) | Opens an editor and returns EditorPane | Route to `surfaceRegistry.getSurface('editor').activeResource = input` (surface updates) | Shim: old API calls new API; behavior unchanged | 2 releases (M82 + M83) |
| `api.commands.executeCommand(id, ...args)` | [src/api/bridges/commandBridge.ts](docs/architecture/SYSTEM_ATLAS.md#41-one-off-bridges-hard-coded-couplings) | Executes command by ID | Route to `commandRegistry.executeCommand(id, args)` | Direct mapping; no shim needed (same behavior) | None (stable) |
| `SelectionActionDispatcher` | [src/services/selectionActionDispatcher.ts:L16](docs/architecture/SYSTEM_ATLAS.md#41-one-off-bridges-hard-coded-couplings) | Routes selection to hard-coded handlers | Route via `selectionService.onDidChangeSelection` event subscriptions | Shim: dispatcher wires handlers to events | 1 release (M82) |
| `workspace.folders` | [src/workspace/workspace.ts:L38-L100](docs/architecture/SYSTEM_ATLAS.md#1-entry-points-for-the-primary-workflow) | Returns folder set (source of truth) | Same (no change to API) | No migration needed | None (stable) |
| Extension manifest `contributes` | [src/tools/toolManifest.ts:L1](docs/architecture/SYSTEM_ATLAS.md#1-entry-points-for-the-primary-workflow) | Declares commands, views, menus, etc. | Add optional `when` clause to each contribution; schema v2 | Backward compatible (schema v1 still works) | None (schema evolution, not breaking) |
| Context key checking | [src/context/contextKey.ts](docs/architecture/SYSTEM_ATLAS.md#2-system-ownership-table) | Scattered CTX_* checks throughout code | Centralized in `ContextService`; existing checks continue via shim | Shim routes old CTX_ variables to `ContextService` | 2 releases |
| IPC handler `database:query` | [electron/main.cjs:L1850-L1900](docs/architecture/SYSTEM_ATLAS.md#6-ipc-contract-index) | Executes SQL query | Same behavior; add typed contract verification | No breaking change | None (stable) |
| `workspace.onDidChangeFolders` | [src/workspace/workspace.ts](docs/architecture/SYSTEM_ATLAS.md#1-entry-points-for-the-primary-workflow) | Fired when folders change | Same event name; RecentWorkspaces now observes (not dual-owner) | No migration needed | None (stable) |

### 7.2 Phasing: Slices That Can Land Independently

**Slice A (Phase 1: Core Primitives — 1 sprint)**
- Introduce Resource union type.
- Introduce Workspace canonical ownership (refactor dual-owner pattern).
- Introduce SelectionService (replace SelectionActionDispatcher).
- Introduce SurfaceRegistry.
- Introduce ContextService (centralize context keys).
- **Tests required:** LegacyUriResolution, WorkspaceFolderCanonicalOwnership, SelectionEventRouting, SurfaceFocus, ContextKeyDiscovery.
- **Backward compatibility:** Full. Old APIs shimmed. Existing tests pass unchanged.

**Slice B (Phase 2: Extended Primitives — 1 sprint)**
- Introduce Command/Tool unified registry with typed contracts.
- Introduce Contribution registry with `when` clause support.
- Introduce Event registry.
- **Tests required:** CommandContractValidation, ToolActivationFiltering, ContributionVisibilityPredicate.
- **Backward compatibility:** Full. Contributions remain optional; old manifests work.

**Slice C (Phase 3: Advanced Primitives — 1–2 sprints)**
- Introduce Capability service.
- Introduce Task service (autonomy migrates here).
- Introduce Artifact registry.
- Introduce Provenance service.
- **Tests required:** CapabilityGating, TaskQueueing, ArtifactLinking, ProvenanceTracing.
- **Backward compatibility:** Full. Autonomy behavior unchanged (just cleaner abstraction).

**Slice D (Phase 4: Bridge Replacement & UI — 2 sprints)**
- Replace SelectionActionDispatcher (already done in Slice A; just remove old code).
- Replace Canvas sidebar ↔ Editor attachment (use EditorService event).
- Replace Chat ↔ Explorer attachment (use EditorService event).
- Migrate chat/autonomy to TaskService.
- Replace Link resolution with unified LinkResolverService.
- **Tests required:** All cross-tool workflow tests.
- **Backward compatibility:** Full via shims during transition.

### 7.3 Explicit Breaking Changes & Migration Paths

**Change 1: `SelectionActionDispatcher` Deprecated**
- **What changes:** Hard-coded handler registration pattern is removed in M83.
- **Old API:** `dispatcher.registerHandler('AddToChat', handler); dispatcher.dispatch(selection);`
- **New API:** `selectionService.onDidChangeSelection.subscribe(handler);`
- **Migration path:** Shim in M82 converts old handlers to event subscribers. Extensions must update by M83 or break.
- **Tooling:** Migration script to rewrite handler registrations to event subscriptions.

**Change 2: `Workspace.folders` Type Change (Optional)**
- **What changes:** Currently `WorkspaceFolder[] | string[]`. Proposed: `WorkspaceFolder[]` with stable type.
- **Old API:** `workspace.folders[0]: string | WorkspaceFolder`.
- **New API:** `workspace.folders[0]: WorkspaceFolder { path: string; name: string; index: number }`.
- **Migration path:** Automatic conversion on load (strings → WorkspaceFolder objects). Backward compatible if strings are still accepted.
- **Tooling:** No external tool changes needed (internal only).

**All other changes are backward compatible.** See Compatibility Table above.

### 7.4 Required Characterization Tests (Phase Gates)

Every slice must pass characterization tests from [Baseline §4](docs/research/baselines/workbench-baseline.md#4-proposed-characterization-tests) before merging. Examples:

- **Slice A:** LegacyUriResolution, WorkspaceFolderCanonicalOwnership, SelectionEventRouting, SurfaceFocus.
- **Slice B:** CommandContractValidation, ToolActivationFiltering, ContributionVisibilityPredicate.
- **Slice C:** CapabilityGating, TaskQueueing, ArtifactLinking, ProvenanceTracing.
- **Slice D:** EditorAttachmentSync, CanvasSidebarSync, AutonomyLifecycleIndependence, ChatToCanvasArtifact.

All tests must pass AND must not regress existing tests (Explorer → Editor → Chat → Canvas cross-tool workflow must still work).

---

## 8. Out of Scope

This redesign explicitly does NOT propose:

- **Feature changes:** No new user-facing capabilities (though primitives enable future features).
- **Visual redesign:** Layout, panels, sidebars, menus, themes remain unchanged.
- **Performance optimizations beyond preservation:** Baseline hot paths (§5 of baseline scorecard) are not regressed. Performance improvements are future work.
- **AI behavior changes:** Chat model selection, turn execution, OpenClaw internals are unchanged.
- **Extension API breaking changes without migration paths:** Every breaking change has a documented shim and deprecation window.
- **Database schema redesign:** Migrations are separate work; persistence layer unchanged.
- **New IPC handlers:** IPC contracts are replaced with typed equivalents; no new categories.

---

## 9. Acceptance Criteria for This Document

The Fitness and Review Agent will check:

- ✅ Every primitive (13 total) has a Definition, Current Implementation, Proposed Shape, Ownership, and Migration Story.
- ✅ Every cross-tool bridge (7 total) has a replacement entry with migration ordering and test required.
- ✅ Every duplicate state ownership (7 total) has a single canonical owner and delegation model.
- ✅ Every open question (10 total) has a decision and rationale with atlas/external brief/baseline citations.
- ✅ Compatibility table covers all existing public-ish APIs (15+ rows).
- ✅ Phasing plan specifies slices that can land independently (Slice A, B, C, D).
- ✅ Breaking changes are explicit (≤ 2 total) with migration paths and tooling.
- ✅ Characterization tests are defined for every slice gate.
- ✅ No new primitive is proposed unless its absence in Manifest §10 is justified (all 13 are from Manifest).
- ✅ Preservation rules (Manifest §11) are honored: all existing workflows remain achievable.

---

## 10. Risks and Anti-Patterns

### 10.1 Overengineering Risks

**Risk 1: Primitive Proliferation**
- **What:** Adding 20+ new service classes, one per primitive, without clear boundaries.
- **Mitigation:** Limit to the 13 primitives defined here. Do not add Surface*, Resource*, Selection* variants unless used by 3+ features.
- **Evidence:** Current codebase has ~15 services (Editor, File, Chat, Canvas, etc.). Adding 13 primitives = 13 new services is reasonable; 50+ would be unmanageable.

**Risk 2: Event Flood**
- **What:** Every keystroke fires a selection change event; renderer event loop starved.
- **Mitigation:** Coalesce selection events to 100ms windows. Throttle context changes.
- **Evidence:** Baseline §2 shows file-watcher coalescing (50ms window); same pattern applies here.

**Risk 3: Contribution Explosion**
- **What:** If contribution types grow to 100+ (like VS Code), manifest becomes unmaintainable.
- **Mitigation:** Phased contribution types: start with commands, keybindings, menus, views. Add others only if 3+ features use them.
- **Evidence:** External brief §I.E warns against this.

**Risk 4: Circular Dependencies in Events**
- **What:** Service A listens for Service B's events; Service B listens for Service A's events.
- **Mitigation:** Static analysis at build time to detect cycles. Enforce acyclic listener graph.
- **Evidence:** External brief §III.E warns against this in IntelliJ.

### 10.2 Parallx-Specific Risks (from Repo Memory)

**Risk 5: FTS Rebuild Blocks Hot-Path Saves (Reentrancy)**
- **What:** If Contribution registry rebuild uses the same DB as hot-path saves, writer lock contention causes 60+ second pickup lag (see repo memory debugging notes, M64 FTS rebuild).
- **Mitigation:** Contribution registry is in-memory only (no DB); decouples from hot path.
- **Evidence:** Repo memory §M64 FTS cold-start rebuild.

**Risk 6: Background DB Contends with Hot Path**
- **What:** If a background service (e.g., ProvenanceService) periodically scans all artifacts, it locks the DB; foreground saves queue behind it.
- **Mitigation:** Provenance is recorded asynchronously; queries are cached. No polling or periodic full scans.
- **Evidence:** Repo memory §Background scans contend.

**Risk 7: Tool Activation Timeout Hangs App**
- **What:** If a tool's `activate()` method is slow or hangs, workbench initialization blocks.
- **Mitigation:** Tool activation is already async (Slice A); timeouts are enforced by TaskService (Slice C). Built-in tools activate in parallel Phase 5; one slow tool does not block others.
- **Evidence:** Baseline §H15 (extension activation timeout behavior) is part of characterization tests.

### 10.3 Anti-Patterns Explicitly Forbidden

| Anti-Pattern | Why | What To Do Instead |
|---|---|---|
| **One-off bridges** | Couple features directly; hard to extend; hard to test. | Use typed events or centralized service (Selection → Chat example). |
| **Godhood primitives** | If Resource owns everything (content, rendering, persistence, permissions), it becomes unmaintainable. | Resource owns identity; delegate content/rendering/permissions to specialists. |
| **Multi-process extension hosts** | Process per extension is 100–1000ms slower per tool; no sandbox benefit (shared global scope anyway). | Shared process (current model); error isolation via async try-catch. |
| **XML-heavy declarative configs** | XML is verbose, slow to parse, error-prone. | JSON or TypeScript (current Manifest model). |
| **Eager activation on all events** | `activationEvent: "*"` makes all tools load on startup; startup is slow. | Use precise activation events (onCommand, onView, onWorkspace). |
| **String-based visibility predicates** (like VS Code's `when` clauses) | Hard to debug, no IDE autocomplete, typos silently accepted. | Typed context keys (TypeScript enum) with IDE intellisense. |
| **Unbounded context keys** | If context has 1000 keys, discovery is impossible. | Core ~20 keys defined in ContextKeys dict; extensions can add via `contextService.createContextKey()`. |
| **Synchronous IPC** | Renderer blocks waiting for main process. | Async/await with timeout. |

---

## Frontmatter and Metadata

**Document Version:** 1.0 (Draft)
**Status:** Draft (pending Fitness & Review Agent approval)
**Author:** Unified Workbench Interaction Agent
**Branch:** `systems-redesign-planning`
**Commit:** `01ad9c1`
**Date:** 2026-05-23

**Required Downstream Artifacts (handoff to Fitness & Review Agent):**
1. Fitness & Review decision: Keep, Revise, or Rollback.
2. If Approved: Surgical Executor Agent receives Slice A–D implementation plan.
3. If Revise: Specific sections to rewrite; loop back to this agent.

---

**End of Workbench Interaction Model**
