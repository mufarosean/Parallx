# Parallx – Architecture

> This document defines the responsibility of each module and the allowed dependencies between them.
> Circular dependencies are **explicitly forbidden**.

---

## Canvas Registry Gate Architecture

The canvas built-in (`src/built-in/canvas/`) has its own internal dependency structure enforced through **five registries** that act as gates. This architecture was established across 20+ commits to eliminate a tangled dependency graph where files imported freely from each other.

### Core Principle

> **Children talk only to their parent gate. Gates go to the source. No shortcuts.**

A "child" is any file that belongs to a registry's domain (e.g. `slashMenu.ts` is a child of CanvasMenuRegistry). A "gate" is a registry that mediates all imports for its children. Children never reach across to a sibling registry — they get everything they need through their own gate's re-exports.

**Gate-to-gate rule:** When a gate needs something from another gate, it imports from the gate that **owns** the symbol — never through an intermediate gate that merely passes it through. If IconRegistry owns `svgIcon`, HandleRegistry imports from IconRegistry directly, not from BlockRegistry. This eliminates phantom dependencies and keeps the import graph honest.

### The Five Gates

```
                    ┌──────────────┐
                    │ canvasIcons  │  (raw SVG data — never imported directly)
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │ IconRegistry │  (leaf gate)
                    └──┬───┬───┬──┘
                       │   │   │
          ┌────────────▼─┐ │ ┌─▼──────────────────┐
          │ BlockRegistry│ │ │ CanvasMenuRegistry │
          │              │◄─┘ │                    │
          └──┬───┬──┬───┘   └────┬───┬─────────┘
             │   │  │             │   │
     ┌───────┘   │  └───────┐   │   │
     ▼       ▼   │          ▼   ▼   ▼
   block   Handle │  BlockState  menu children
   exts    Registry  Registry   (6+ files)
   (5)     │     │    │
           │     │    └── plugins (3)
    ┌──────▼──────┐  │
    │ handle kids │  │    BSR children
    │ (2 files)   │  │    (7 files)
    └─────────────┘  │
                     │
   HandleRegistry, CanvasMenuRegistry also import from
   IconRegistry and BlockStateRegistry directly (go to source).
```

### 1. IconRegistry (`config/iconRegistry.ts`)

**Role:** Single gate for all icon/SVG access. Only file that imports `canvasIcons.ts`.

**Exports:** `svgIcon()`, `createIconElement()`, `resolvePageIcon()`, `PAGE_SELECTABLE_ICONS`, `ALL_ICON_IDS`, `isBlockIconSelectable()`

**Consumers:** Only four — BlockRegistry, CanvasMenuRegistry, HandleRegistry, and any future gate that needs icon functions. Each imports directly from IconRegistry (the source owner).

### 2. BlockRegistry (`config/blockRegistry.ts`)

**Role:** Single source of truth for block metadata, capabilities, and extension factories.

**Re-exports from IconRegistry:** `svgIcon`, `resolvePageIcon`, `createIconElement` (for its children)

**Re-exports from BlockStateRegistry:** All mutation/movement/column/drag-session exports, 30+ symbols (for its children)

**Re-exports from header/pageChrome:** `PageChromeController` (for canvasEditorProvider — the orchestrator)

**Own API:** `BLOCK_REGISTRY`, `BlockDefinition`, `PAGE_CONTAINERS`, `COLUMN_CONTENT_EXPRESSION`, `getBlockExtensions()`, `getSlashMenuBlocks()`, `getTurnIntoBlocks()`, `getBlockLabel()`, `getBlockByName()`, `isContainerBlockType()`, `getNodePlaceholder()`, `createEditorExtensions()`

**Children (8 files):**
- Block extensions: `calloutNode`, `columnNodes`, `mediaNodes`, `bookmarkNode`, `pageBlockNode`
- Chrome/sidebar: `pageChrome`, `canvasSidebar`
- Assembly: `tiptapExtensions`

### 3. CanvasMenuRegistry (`menus/canvasMenuRegistry.ts`)

**Role:** Centralized menu lifecycle — mutual exclusion, outside-click dismissal, interaction arbitration, block-data access for menus.

**Re-exports from BlockStateRegistry (source owner):** `applyBackgroundColorToBlock`, `applyTextColorToBlock`, `deleteBlockAt`, `duplicateBlockAt`, `turnBlockWithSharedStrategy` (for its children)

**Re-exports from BlockRegistry (source owner):** `InsertActionContext`, `InsertActionBaseContext`, `getSlashMenuBlocks`, `getTurnIntoBlocks`, `getBlockLabel`, `getBlockByName`, `BLOCK_REGISTRY`

**Re-exports from IconRegistry (source owner):** `svgIcon`, `PAGE_SELECTABLE_ICONS`

**Own API:** `ICanvasMenu`, `IBlockActionMenu`, `MenuBlockInfo`, `CanvasMenuRegistry` class

**Children (6+ files):** `slashMenu`, `bubbleMenu`, `blockActionMenu`, `iconMenu`, `coverMenu`, `inlineMathEditor`, `imageInsertPopup`, `mediaInsertPopup`, `bookmarkInsertPopup`

No menu child imports from BlockRegistry directly — they get everything through CanvasMenuRegistry.

### 4. BlockStateRegistry (`config/blockStateRegistry/blockStateRegistry.ts`)

**Role:** Two-way gate facade for block mutations, movements, column operations, and drag state. Decomposed from a single 718-line `blockMutations.ts` into 8 focused child modules.

**Inward gate (from BlockRegistry → children):** `PAGE_CONTAINERS`, `isContainerBlockType`

**Outward gate (from children → BlockRegistry):** All exports from `blockLifecycle`, `blockTransforms`, `blockMovement`, `columnCreation`, `columnInvariants`, `crossPageMovement`, `dragSession`, plus column/resize plugins.

**Internal children (8 files):**
- `blockLifecycle.ts` — create, destroy, restyle
- `blockTransforms.ts` — turn-into type conversions
- `blockMovement.ts` — keyboard + DnD positional changes
- `columnCreation.ts` — column layout assembly
- `columnInvariants.ts` — structural rules (empty-check, normalize, dissolve)
- `crossPageMovement.ts` — async cross-page block transfer
- `dragSession.ts` — shared drag state channel
- `blockStateRegistry.ts` — two-way gate facade

Children import from `blockStateRegistry.ts` (their gate), never from `blockRegistry.ts` or each other directly.

### 5. HandleRegistry (`handles/handleRegistry.ts`)

**Role:** Gate for block-handle interaction controllers. Mediates imports so handle children never reach into other registries directly.

**Re-exports from BlockRegistry (source owner):** `PAGE_CONTAINERS`, `isContainerBlockType`

**Re-exports from IconRegistry (source owner):** `svgIcon`

**Re-exports from BlockStateRegistry (source owner):** `CANVAS_BLOCK_DRAG_MIME`, `clearActiveCanvasDragSession`, `setActiveCanvasDragSession`

**Re-exports from CanvasMenuRegistry (source owner):** `IBlockActionMenu`

**Children (2 files):** `blockHandles`, `blockSelection`

Handle children import from `handleRegistry.ts` only — never from blockRegistry, canvasMenuRegistry, or each other's paths directly.

### Gate-to-Gate Import Edges (enforced by compliance test)

| Gate | Imports from | Why |
|------|-------------|-----|
| **IconRegistry** | (none) | Leaf gate — all icons originate here |
| **BlockRegistry** | IconRegistry, BlockStateRegistry | Re-exports icons and mutations for its children |
| **CanvasMenuRegistry** | BlockRegistry, IconRegistry, BlockStateRegistry | Block data from owner, icons from owner, mutations from owner |
| **BlockStateRegistry** | BlockRegistry | Inward gate: `PAGE_CONTAINERS`, `isContainerBlockType` |
| **HandleRegistry** | BlockRegistry, IconRegistry, BlockStateRegistry, CanvasMenuRegistry | Each symbol from its source owner |

### Gate Isolation Invariants

These invariants are **absolute** — violations break the architecture:

| Invariant | Description |
|-----------|-------------|
| **Icon gate** | No non-registry file imports from `iconRegistry.ts`. Icons flow through parent gates. Peer gates import from IconRegistry directly (source owner). |
| **Menu gate** | No menu child imports from `blockRegistry.ts`. All block data (labels, definitions, mutations) flows through CanvasMenuRegistry. |
| **Extension gate** | No block extension imports from `canvasMenuRegistry.ts`. Extensions get everything from BlockRegistry. |
| **Go to source** | Gate-to-gate imports target the gate that **owns** the symbol. No intermediate pass-throughs. Enforced by `gateCompliance.test.ts`. |
| **No cycles** | Gate-to-gate graph must be acyclic, with one permitted exception: BlockRegistry ↔ BlockStateRegistry (safe `export { } from` live re-exports only, no evaluation-time reads). Enforced by a dedicated cycle safety test. |
| **State gate** | No BlockStateRegistry child imports from `blockRegistry.ts` directly. Dependencies flow inward through `blockStateRegistry.ts`. |
| **Handle gate** | No handle child imports from `blockRegistry.ts` or `canvasMenuRegistry.ts`. Dependencies flow through HandleRegistry. |
| **No cross-reach** | Children never import across registries. A menu file cannot import from a block extension file, and vice versa. |

### Why This Matters

The circular dependency that broke column editing (`978539d`) was caused by exactly this kind of cross-reach: `blockRegistry → columnNodes → blockCapabilities → blockRegistry`. The gate architecture prevents this class of bug entirely — every dependency is mediated by a gate, every gate has a clear direction, and esbuild's IIFE bundling order becomes irrelevant because gates defer reads to runtime.

---

## Module Responsibilities

### `platform/`
**Foundational utilities shared across all modules.**
- Storage abstraction (localStorage, IndexedDB, in-memory)
- Event emitter system with typed events
- IDisposable pattern and lifecycle management
- Service instantiation utilities and decorators
- Shared types and constants

### `services/`
**Service interfaces and implementations providing capabilities through dependency injection.**
- Dependency injection container (`ServiceCollection`)
- Service interface definitions (`serviceTypes.ts`)
- Concrete service implementations (layout, view, workspace, editor, command, context key)
- Services are the primary API surface — consumers interact through interfaces, not implementations

### `workbench/`
**Top-level shell orchestrator.**
- Root entry point for application initialization
- Startup and teardown lifecycle sequencing
- Service registration and wiring
- Coordinates layout, parts, views, and workspace restoration
- Does not contain business logic — delegates to services

### `layout/`
**Serializable, constraint-based grid layout system.**
- Layout data model (JSON-serializable schema)
- Grid tree structure with splitting and resizing
- Grid view interface for layout participation
- Layout rendering (state → DOM)
- Layout persistence (save/load)

### `parts/`
**Structural containers occupying fixed regions in the workbench.**
- Base `Part` class with lifecycle and grid integration
- Part registry for registration and lookup
- Standard parts: Titlebar, Sidebar, Panel, Editor, AuxiliaryBar, StatusBar
- Parts host view containers but do not own view logic

### `views/`
**Content-based UI elements hosted within parts.**
- Generic view interface with full lifecycle
- View descriptor (metadata and registration)
- View manager (lifecycle orchestration and placement)
- View container (tabbed multi-view host)
- Placeholder views for development and testing

### `editor/`
**Editor group system for document hosting.**
- Editor group container and model (state management)
- Editor group view (tab UI rendering)
- Abstract editor input (document/resource representation)
- Abstract editor pane (content rendering)
- Editor-related types

### `workspace/`
**Workspace identity, state persistence, and switching.**
- Workspace identity model (ID, name, metadata)
- Workspace state loading from storage
- Workspace state saving to storage
- Workspace-related types

### `commands/`
**Command registration, lookup, and execution.**
- Command registry with metadata and when-clause preconditions
- Command type definitions and interfaces
- Structural commands (toggle sidebar, split editor, resize, etc.)

### `context/`
**Structural context tracking and conditional evaluation.**
- Context key definitions and API
- Context key evaluation engine
- Workbench context model (active part, focused view, visibility)
- Focus tracker (active view/part/region tracking)
- When-clause expression parser

### `dnd/`
**Drag-and-drop coordination for views and editors.**
- Drag-and-drop coordination logic
- Drop zone rendering and hit detection
- Visual drop overlay feedback
- Drag-and-drop types

### `tools/`
**Tool discovery, validation, activation, and isolation.**
- Manifest schema and validation (`parallx-manifest.schema.json`, `toolManifest.ts`, `toolValidator.ts`)
- Tool scanning from filesystem (`toolScanner.ts`)
- Tool module loading (`toolModuleLoader.ts`)
- Registry of discovered and activated tools (`toolRegistry.ts`)
- Activation event matching (`activationEventService.ts`)
- Tool activation lifecycle (`toolActivator.ts`)
- Error isolation to prevent tool crashes from affecting the shell (`toolErrorIsolation.ts`)

### `api/`
**Public API surface exposed to tool extensions.**
- API factory that creates scoped `parallx.*` namespaces per tool (`apiFactory.ts`)
- API type definitions for tools (`parallx.d.ts`)
- API version validation (`apiVersionValidation.ts`)
- Notification, input box, and quick pick UI (`notificationService.ts`)
- Bridge modules connecting API calls to internal services (`bridges/`)

### `configuration/`
**Configuration schema registration and tool-scoped storage.**
- Configuration registry for tool-contributed settings (`configurationRegistry.ts`)
- Configuration service for reading/writing values (`configurationService.ts`)
- Per-tool memento storage with quota enforcement (`toolMemento.ts`)
- Configuration types (`configurationTypes.ts`)

### `contributions/`
**Processing of tool manifest contribution points.**
- Command registration from manifests (`commandContribution.ts`)
- Keybinding registration from manifests (`keybindingContribution.ts`)
- Menu contribution processing (`menuContribution.ts`)
- Shared contribution types (`contributionTypes.ts`)

### `built-in/`
**First-party features shipped with the workbench (not loaded as tools).**
- `welcome/` — Welcome tab shown on startup with start actions (New File, Open File, Open Folder) and recent workspaces/files
- `editor/` — Built-in editor panes for system UIs:
  - Keyboard shortcuts viewer (`keybindingsEditorInput.ts`, `keybindingsEditorPane.ts`) — searchable table of all registered keybindings
  - Settings editor (`settingsEditorInput.ts`, `settingsEditorPane.ts`) — grouped, searchable settings with type-appropriate controls (checkbox, select, number, text)
- `explorer/` — Built-in file explorer view
- `output/` — Output panel view
- `tool-gallery/` — Tool discovery and installation view
- `canvas/` — Canvas built-in with five-registry gate architecture (see "Canvas Registry Gate Architecture" above)
- `chat/` — AI chat assistant (see "Chat / AI Subsystem" below)
- `search/` — Workspace search view

> Built-in features follow the same `EditorInput` / `EditorPane` patterns as tool-contributed editors.
> They may depend on `platform`, `services` (interfaces), `editor` (abstract base classes), and `configuration`.

#### Chat / AI Subsystem (`built-in/chat/`)

The chat built-in is the AI assistant — Parallx's "Jarvis". It runs entirely local via Ollama and comprises:

| File | Responsibility |
|------|---------------|
| `chatTool.ts` | **Central activation** (~1700 lines). Constructs all chat services, builds `defaultParticipantServices` and `widgetServices`, wires providers, assembles workspace digest. |
| `chatWidget.ts` | Chat panel UI — TipTap input, message list, context pills, code action handling |
| `chatSystemPrompts.ts` | Mode-aware system prompt builder (Ask/Edit/Agent). Injects PARALLX_IDENTITY, prompt file layers, workspace digest. |
| `chatContextPills.ts` | Visual context chips above chat input — shows attached files, RAG results, token counts |
| `chatSessionSidebar.ts` | Session list with full-text search |
| `chatListRenderer.ts` | Renders chat messages — markdown, code blocks with action buttons, token counts |
| `participants/defaultParticipant.ts` | Default chat participant with agentic loop (max 10 iterations). Handles prompt assembly, tool invocation, RAG context, budget management. |
| `tools/builtInTools.ts` | 11+ built-in tools (search, read, write, edit, delete, run_command, etc.) |

**Workspace Digest Pipeline:**

Every system prompt includes a pre-computed workspace digest (~2000 tokens) so the AI "already knows" the workspace without tool calls:

```
getWorkspaceDigest()
  ├── DB query: canvas page titles (limit 30)
  ├── File tree walk: depth 3, max 80 entries, skip hidden/node_modules
  └── Key file previews: README.md, SOUL.md, AGENTS.md (first 500 chars)
        │
        ▼
  ISystemPromptContext.workspaceDigest
        │
        ▼
  appendWorkspaceStats() → injected into system prompt
```

**Prompt Assembly Order:**
1. Core PARALLX_IDENTITY (hardcoded personality + behavior rules)
2. `SOUL.md` (user-editable personality, workspace root)
3. `AGENTS.md` (user-editable project context, workspace root)
4. `TOOLS.md` (auto-generated from skill manifests)
5. `.parallx/rules/*.md` (pattern-matched to active file)
6. Workspace digest (auto-generated page titles + file tree + key file previews)
7. RAG results (auto-retrieved per user message)
8. Explicit `@` mentions / attachments
9. Memory context (recalled from past sessions)
10. Conversation history
11. User's current message

### `electron/`
**Electron main process and preload bridge (outside `src/`).**
- `main.cjs` — Window creation, native menu, lifecycle management, IPC handlers
  - Intercepts window close (`lifecycle:beforeClose` → renderer) to allow unsaved-changes prompts
  - Confirms close via `lifecycle:confirmClose` IPC from renderer
- `preload.cjs` — Context bridge exposing `window.parallxElectron` API to the renderer
  - `onBeforeClose(callback)` — registers listener for close interception
  - `confirmClose()` — signals main process to proceed with window close
  - File system, dialog, and shell helpers

> Renderer code must **never** use `ipcRenderer` directly — all IPC goes through the preload bridge.

### `ui/`
**Reusable UI primitives shared across feature modules.**
- Mirrors VS Code's `src/vs/base/browser/ui/` pattern
- Components: `inputBox`, `contextMenu`, `button`, `overlay`, `list`, `breadcrumbs`, `tabBar`, `dialog`, `findReplaceWidget`
- DOM helpers: `$()` element factory, `addDisposableListener()`, visibility toggles, drag helpers
- All components extend `Disposable`, accept `(container, options?)`, use co-located CSS
- Context-agnostic — components don't know which part hosts them

> `ui/` may depend on `platform/` only (events, lifecycle, types).

---

## Dependency Rules

### Dependency Matrix

| Module ↓ may depend on → | platform | ui | services | workbench | layout | parts | views | editor | workspace | commands | context | dnd | tools | api | configuration | contributions |
|--------------------------|:--------:|:--:|:--------:|:---------:|:------:|:-----:|:-----:|:------:|:---------:|:--------:|:-------:|:---:|:-----:|:---:|:-------------:|:-------------:|
| **platform**             |    —     | ✗  |    ✗     |     ✗     |   ✗    |   ✗   |   ✗   |   ✗    |     ✗     |    ✗     |    ✗    |  ✗  |   ✗   |  ✗  |       ✗       |       ✗       |
| **ui**                   |    ✓     | —  |    ✗     |     ✗     |   ✗    |   ✗   |   ✗   |   ✗    |     ✗     |    ✗     |    ✗    |  ✗  |   ✗   |  ✗  |       ✗       |       ✗       |
| **services**             |    ✓     | ✗  |    —     |     ✗     |   ✓    |   ✓   |   ✓   |   ✓    |     ✓     |    ✓     |    ✓    |  ✓  |   ✓   |  ✗  |       ✓       |       ✗       |
| **workbench**            |    ✓     | ✓  |    ✓     |     —     |   ✓    |   ✓   |   ✓   |   ✓    |     ✓     |    ✓     |    ✓    |  ✓  |   ✓   |  ✓  |       ✓       |       ✓       |
| **layout**               |    ✓     | ✓  |    ✗     |     ✗     |   —    |   ✗   |   ✗   |   ✗    |     ✗     |    ✗     |    ✗    |  ✗  |   ✗   |  ✗  |       ✗       |       ✗       |
| **parts**                |    ✓     | ✓  |    ✓*    |     ✗     |   ✓    |   —   |   ✗   |   ✓    |     ✗     |    ✗     |    ✗    |  ✗  |   ✗   |  ✗  |       ✗       |       ✗       |
| **views**                |    ✓     | ✓  |    ✓*    |     ✗     |   ✓    |   ✗   |   —   |   ✗    |     ✗     |    ✗     |    ✗    |  ✗  |   ✗   |  ✗  |       ✗       |       ✗       |
| **editor**               |    ✓     | ✓  |    ✓*    |     ✗     |   ✓    |   ✗   |   ✓   |   —    |     ✗     |    ✗     |    ✗    |  ✗  |   ✗   |  ✗  |       ✗       |       ✗       |
| **workspace**            |    ✓     | ✗  |    ✓*    |     ✗     |   ✓†   |   ✓†  |   ✓†  |   ✗    |     —     |    ✗     |    ✗    |  ✗  |   ✗   |  ✗  |       ✗       |       ✗       |
| **commands**             |    ✓     | ✗  |    ✓*    |     ✗     |   ✗    |   ✗   |   ✗   |   ✗    |     ✗     |    —     |    ✓    |  ✗  |   ✗   |  ✗  |       ✗       |       ✗       |
| **context**              |    ✓     | ✗  |    ✓*    |     ✗     |   ✗    |   ✗   |   ✗   |   ✗    |     ✗     |    ✗     |    —    |  ✗  |   ✗   |  ✗  |       ✗       |       ✗       |
| **dnd**                  |    ✓     | ✓  |    ✓*    |     ✗     |   ✓    |   ✗   |   ✓   |   ✗    |     ✗     |    ✗     |    ✗    |  —  |   ✗   |  ✗  |       ✗       |       ✗       |
| **tools**                |    ✓     | ✗  |    ✓*    |     ✗     |   ✗    |   ✗   |   ✗   |   ✗    |     ✗     |    ✗     |    ✗    |  ✗  |   —   |  ✓  |       ✓       |       ✗       |
| **api**                  |    ✓     | ✓  |    ✓*    |     ✗     |   ✓    |   ✗   |   ✓   |   ✓    |     ✗     |    ✓     |    ✓    |  ✗  |   ✓†  |  —  |       ✓       |       ✓†      |
| **configuration**        |    ✓     | ✗  |    ✓*    |     ✗     |   ✗    |   ✗   |   ✗   |   ✗    |     ✗     |    ✗     |    ✗    |  ✗  |   ✗   |  ✗  |       —       |       ✗       |
| **contributions**        |    ✓     | ✓  |    ✓*    |     ✗     |   ✗    |   ✗   |   ✓   |   ✗    |     ✗     |    ✓     |    ✓    |  ✗  |   ✓†  |  ✗  |       ✗       |       —       |

> `✓*` = May depend on service **interfaces** only (from `services/serviceTypes.ts`), never on concrete implementations.
>
> `✓†` = Type-only imports allowed (`import type`). The dependency is on **type definitions** (interfaces, enums, type aliases) only — no runtime coupling.

### Rules in Plain Language

1. **`platform` depends on nothing.** It is the foundational layer.
2. **`ui` depends only on `platform`.** Reusable UI primitives. Mirrors VS Code's `base/browser/ui/`.
3. **`layout` depends on `platform` and `ui`.** Grid and layout logic uses UI primitives (VS Code: grid IS in `base/browser/ui/grid/`).
4. **`parts` depend on `platform`, `ui`, `layout`, `editor`, and service interfaces.** EditorPart integrates with EditorGroupView at runtime — mirroring VS Code's `EditorPart` → `EditorGroupView` pattern.
5. **`views` depend on `platform`, `ui`, `layout`, and service interfaces.** Views participate in layout but don't know about parts or editors.
6. **`editor` depends on `platform`, `ui`, `layout`, `views`, and service interfaces.** Editors extend view concepts but don't depend on parts directly.
7. **`workspace` depends on `platform`, `layout`†, `views`†, `parts`† (type-only), and service interfaces.** Workspace serialization references layout models, view descriptors, and part types for state persistence.
8. **`commands` depend on `platform`, `context`, and service interfaces.** Commands evaluate context and call services — never import concrete editor/part/built-in types.
9. **`context` depends on `platform` and service interfaces.** Context is a data tracking layer.
10. **`dnd` depends on `platform`, `ui`, `layout`, `views`, and service interfaces.** DnD coordinates view movement through layout.
11. **`tools` depend on `platform`, `api`, `configuration`, and service interfaces.** Tool lifecycle management loads, validates, and activates tools.
12. **`api` depends on `platform`, `ui`, `layout`, `views`, `editor`, `commands`, `context`, `configuration`, `tools`† (type-only), `contributions`† (type-only), and service interfaces.** API bridges connect tool calls to internal services; the factory imports tool manifest types and contribution processor types.
13. **`configuration` depends on `platform` and service interfaces.** Configuration is a data/schema concern.
14. **`contributions` depend on `platform`, `ui`, `views`, `commands`, `context`, `tools`† (type-only), and service interfaces.** Contributions process manifest declarations into registered entities.
15. **`services` depend on `platform` and may import from any module** to provide concrete implementations behind interfaces.
16. **`workbench` is the composition root.** It may depend on everything to wire the system together.

### Absolute Prohibitions

- **No circular dependencies.** If module A imports from module B, module B must not import from module A (directly or transitively).
- **No upward dependencies.** Lower layers (`platform`, `layout`) must never import from higher layers (`workbench`, `services` implementations).
- **No cross-peer dependencies unless explicitly allowed.** For example, `parts` must not import from `views`, `editor`, `workspace`, `commands`, `context`, or `dnd`.
- **No concrete service imports outside `services/` and `workbench/`.** All other modules consume services through interfaces only.

---

## Layered Architecture Diagram

```
┌─────────────────────────────────────────────────┐
│                   workbench/                     │  ← Composition root
│          (orchestrates everything)               │
├─────────────────────────────────────────────────┤
│                   services/                      │  ← Service layer
│       (interfaces + implementations)             │
├────────┬────────┬────────┬────────┬─────────────┤
│ parts/ │ views/ │editor/ │  dnd/  │  commands/   │  ← Feature modules
│        │        │        │        │  context/    │
│        │        │        │        │  workspace/  │
├────────┴────────┴────────┴────────┴─────────────┤
│                   layout/                        │  ← Layout engine
├─────────────────────────────────────────────────┤
│                  platform/                       │  ← Foundation
│  (events, lifecycle, storage, instantiation)     │
└─────────────────────────────────────────────────┘
```

---

## Conventions

- **One concern per file.** Each file has a single, clear responsibility described in its header comment.
- **Types files are co-located.** Each module has a `*Types.ts` file for shared type definitions within that module.
- **Interfaces before implementations.** Service interfaces live in `services/serviceTypes.ts`; implementations live alongside them in `services/`.
- **Test files mirror source structure.** Tests for `src/layout/grid.ts` live at `tests/layout/grid.test.ts` (when testing is introduced).

---

## Menu Pattern (M19)

All context menus must use one of two sanctioned patterns:

### 1. Shared `ContextMenu` — the default

`src/ui/contextMenu.ts` provides a VS Code-patterned floating menu with keyboard navigation, group separators, submenus, keybinding labels, and click-outside-to-dismiss.

**Usage:**

```ts
import { ContextMenu } from '../ui/contextMenu.js';
import type { IContextMenuItem } from '../ui/contextMenu.js';

const items: IContextMenuItem[] = [
  { id: 'copy',   label: 'Copy',   keybinding: 'Ctrl+C', group: 'clipboard' },
  { id: 'paste',  label: 'Paste',  keybinding: 'Ctrl+V', group: 'clipboard' },
  { id: 'delete', label: 'Delete', group: 'edit', className: 'danger' },
];

const menu = ContextMenu.show({
  items,
  anchor: { x: event.clientX, y: event.clientY },
});

menu.onDidSelect(e => {
  commandService.executeCommand(e.item.id);
});

// To dismiss programmatically:
menu.dismiss();
```

**Key points:**

- `id` is required on every item and should match the command ID when possible.
- `group` drives automatic group separators — items with the same group appear together, a separator is inserted between different groups.
- `onDidSelect` fires when the user picks an item. The handler runs the action.
- `ContextMenu.show()` returns an instance; call `instance.dismiss()` to close it. There is no static `hide()`.
- The menu auto-dismisses on click-outside and on item selection.

**Who uses it:** 14+ call sites across the app (explorer, editor tabs, search, views, sidebar, menu contributions, etc.).

### 2. Canvas `CanvasMenuRegistry` — canvas-internal only

`src/built-in/canvas/menus/canvasMenuRegistry.ts` manages 10+ menu surfaces specific to the canvas (block menus, page chrome, icon/cover pickers, bookmarks, etc.). It registers items declaratively and renders them through the canvas gate architecture.

**When to use:** Only for menus that are part of the canvas editing experience and need access to canvas-internal state (block types, page data, etc.).

**Rule:** Code outside `src/built-in/canvas/` must not import from `CanvasMenuRegistry`.

### Adding menus in tools

Tool-contributed menus (`contributes.menus` in the tool manifest) are processed by `src/contributions/menuContribution.ts`, which builds `IContextMenuItem[]` arrays and delegates to the shared `ContextMenu`. Tool authors never construct menus with raw DOM — the contribution system handles it.

### IMenuService decision (M19 A3.4)

**Decision: Not warranted at this time.**

A DI-registered `IMenuService` (like VS Code's `MenuRegistry` + `IMenuService`) would formalize menu contribution, support dynamic when-clause filtering, and unify the command palette with context menus. However:

1. **14+ files already consistently use `ContextMenu.show()`** — the pattern is well-established and understood.
2. **Tool menus flow through `menuContribution.ts`** — the contribution processor already acts as a lightweight menu service for tools.
3. **Canvas menus are deliberately isolated** behind the gate architecture — forcing them through a global service would break the gate contract.
4. **The command palette** (`src/commands/commandPalette.ts`) is a fundamentally different UI (filtered list with search) that shares commands but not rendering logic.

If the app grows to need per-view dynamic menu contribution from 20+ tools with complex when-clause evaluation, introducing `IMenuService` would be appropriate. For now, the current `ContextMenu` + `menuContribution.ts` + `CanvasMenuRegistry` trio is sufficient and well-documented.

---

## Icon System (M19)

All icons across Parallx are registered in a shared icon registry (`src/ui/iconRegistry.ts`). Individual modules (canvas, chat, PDF) may define their own icon constants but storage is centralised.

### Registry API

```ts
import { registerIcon, getIcon, getFileTypeIcon, getFolderIcon, getPageIcon } from '../ui/iconRegistry.js';

// Register a custom icon
registerIcon('my-tool-search', '<svg ...>...</svg>');

// Retrieve by ID
const svg = getIcon('my-tool-search');

// File-type icon by extension (handles leading dot)
const icon = getFileTypeIcon('.ts');   // → TypeScript file icon SVG
const icon2 = getFileTypeIcon('pdf');  // → PDF file icon SVG
```

### Naming Conventions

| Pattern | Example | Use |
|---------|---------|-----|
| `file-<type>` | `file-ts`, `file-pdf`, `file-folder`, `file-page` | File-type icons (16×16) |
| `avatar-<name>` | `avatar-brain`, `avatar-robot`, `avatar-fox` | AI persona avatars (20×20) |
| `icon-<domain>-<name>` | `icon-chat-send`, `icon-canvas-bold` | Domain-specific UI icons |
| `gear` | `gear` | Shared settings/gear icon |

### Size Requirements

| Category | ViewBox | Style |
|----------|---------|-------|
| File-type icons | 16×16 | Stroke-based, monochrome (`currentColor`), `stroke-width="1.2"` |
| Avatar icons | 20×20 | Stroke-based, monochrome (`currentColor`), `stroke-width="1.3"` |
| UI action icons | 16×16 | Stroke-based, monochrome (`currentColor`) |

### Rules

1. **All icons use `currentColor`** — they inherit colour from the parent element and respond to theme changes.
2. **Stroke-based, not filled** — consistent minimalist aesthetic across the app.
3. **Register at module load** — icons are registered via `registerIcon()` when the module evaluates, before any UI renders.
4. **Use `getFileTypeIcon(ext)` for file references** — never hardcode emojis (📁, 📄) for file-type indicators. The helper resolves extension aliases (e.g. `.jpg` → `image`, `.mjs` → `js`).
5. **Canvas icons stay behind the gate** — `src/built-in/canvas/config/canvasIcons.ts` has its own internal icon set managed via `IconRegistry` (the canvas gate). App-level code should not import canvas-internal icons directly.

### Available Icon Sets

- **File-type icons** (22): `file`, `folder`, `md`, `pdf`, `txt`, `json`, `yaml`, `js`, `ts`, `jsx`, `tsx`, `py`, `rs`, `go`, `css`, `html`, `image`, `page`, plus extension aliases
- **Avatar icons** (12): `brain`, `briefcase`, `pen`, `coins`, `microscope`, `chart`, `target`, `robot`, `fox`, `wave`, `lightning`, `puzzle`
- **Shared utility**: `gear`

---

## Window Semantics (M14)

### Strategy: Single Window + Full-Page Reload

Parallx runs as a single Electron `BrowserWindow`. Workspace switches are handled by a full-page reload — **not** by opening a new window. This matches VS Code's single-window UX model while avoiding the complexity of multi-window process management.

### Why Not Multi-Window?

| Concern | Multi-window | Single-window + reload |
|---------|-------------|----------------------|
| Process isolation | Each window gets its own renderer | Reload achieves the same — fresh JS heap per workspace |
| Memory cleanup | Automatic (process teardown) | Automatic (reload tears down everything) |
| Shared state risk | Impossible (process boundary) | Impossible (fresh module-level state on reload) |
| Implementation complexity | High (IPC, window management, state sync) | Low (session context + stale guards) |
| Ollama connection sharing | Needs coordination or proxy | Single connection, no contention |
| User experience | Potentially confusing (multiple windows) | Clean (one window, one workspace) |

### WorkspaceSessionContext as the Abstraction Layer

To guarantee correctness during the async gap between "user clicks switch" and "reload completes", M14 introduces `WorkspaceSessionContext`:

- **`SessionManager`** (`src/workspace/sessionManager.ts`) — owns the lifecycle. `beginSession()` creates a fresh context with a UUID; `endSession()` invalidates the previous context and signals its `AbortController`.
- **`WorkspaceSessionContext`** (`src/workspace/workspaceSessionContext.ts`) — immutable snapshot: `workspaceId`, `sessionId`, `roots`, `abortController`, `cancellationSignal`, `isActive()`, `logPrefix`.
- **`captureSession()`** (`src/workspace/staleGuard.ts`) — lightweight guard for async operations. Capture at start, check `isValid()` before committing results. Cost: one string comparison.
- **`SessionLogger`** (`src/workspace/sessionLogger.ts`) — prepends `[ws:<id> sid:<id>]` to all diagnostic output.

### Guard Points

Stale session guards are placed at every async commit point:

1. **Indexing pipeline** — before `_vectorStore.upsert()` in `_indexSinglePage()` and `_indexSingleFile()`
2. **Embedding batches** — between batches in `_embedChunks()`
3. **Chat requests** — before `_schedulePersist()` in `ChatService.sendRequest()`
4. **Tool invocations** — before each tool call in the agentic loop (`defaultParticipant.ts`)
5. **Abort propagation** — session's `cancellationSignal` is linked to the participant's `AbortController`

### Migration Path to Multi-Window

If Parallx ever needs true multi-window support:

1. `WorkspaceSessionContext` already provides the right abstraction — each window would have its own context
2. `SessionManager` would become per-window (one instance per `BrowserWindow`)
3. Services reading `sessionManager.activeContext` would continue working unchanged
4. The `captureSession()` guard pattern is window-agnostic — it only compares session IDs
5. Database path is already workspace-scoped (`.parallx/data.db`) — no change needed
