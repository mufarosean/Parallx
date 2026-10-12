# Parallx – Architecture

> What each folder is for, which folders may import which, and where to
> start reading. The rules here are enforced by tests (see "What the tests
> enforce"), so this document and the code cannot drift apart silently.

---

## Where to start reading

1. `src/main.ts` creates the `Workbench` (`src/workbench/workbench.ts`),
   the composition root: it builds the services, lays out the parts and
   activates the built-in tools in named boot phases.
2. `src/tools/builtinManifests.ts` lists the 18 built-in tools and
   `src/built-in/<tool>/main.ts` is each one's `activate()`. Everything a
   tool adds (editors, views, commands, AI tools, blocks, widgets, settings)
   is registered there through `api.*`, the same API extensions in `ext/`
   use.
3. The AI chat is two halves: `src/built-in/chat/` is the panel the user
   sees; `src/openclaw/` is the runtime behind it (the turn loop, tools,
   context, memory, routines).
4. `src/services/serviceTypes.ts` declares every service interface the
   app wires through dependency injection; implementations sit beside it in
   `src/services/`.

## Glossary

One idea, one word, in the UI and in code:

| In the UI | In code | Meaning |
|---|---|---|
| Tool | built-in (`src/built-in/`) or extension (`ext/`) | A feature the user can turn on or off |
| Page | canvas page | A document in the Canvas editor |
| Routine | cron job, workflow | Work that runs on a schedule or a trigger |
| Chat | chat (UI), openclaw (runtime) | The AI assistant |
| Atelier | `media-organizer` | The photo and video library; its ids keep the old name because data is stored under them |
| Creations AI | `creations-ai`, `textGenerator.*` commands | Characters, roleplay and stories |
| Workspace | workspace | A folder the app has open, with its own `.parallx/` state |

---

## Canvas Registry Gate Architecture

The canvas built-in (`src/built-in/canvas/`) has its own internal dependency structure enforced through **six registry gates**. The original canvas core was built around five gates; the live architecture now includes a sixth gate for the integrated database subsystem. This architecture was established across 20+ commits to eliminate a tangled dependency graph where files imported freely from each other.

### Core Principle

> **Children talk only to their parent gate. Gates go to the source. No shortcuts.**

A "child" is any file that belongs to a registry's domain (e.g. `slashMenu.ts` is a child of CanvasMenuRegistry). A "gate" is a registry that mediates all imports for its children. Children never reach across to a sibling registry — they get everything they need through their own gate's re-exports.

**Gate-to-gate rule:** When a gate needs something from another gate, it imports from the gate that **owns** the symbol — never through an intermediate gate that merely passes it through. If IconRegistry owns `svgIcon`, HandleRegistry imports from IconRegistry directly, not from BlockRegistry. This eliminates phantom dependencies and keeps the import graph honest.

### The Six Gates

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

### 6. DatabaseRegistry (`database/databaseRegistry.ts`)

**Role:** Gate for the integrated database subsystem used by canvas inline and full-page databases.

**Re-exports from IconRegistry (source owner):** `svgIcon`, `PAGE_SELECTABLE_ICONS`, `resolvePageIcon`

**Re-exports from pageChrome:** `PageChromeController` and page chrome types

**Own API:** Database types, property configuration UI, view host/view classes, filter UI, relation/rollup helpers, formula engine exports, and database-specific shared UI helpers.

**Children:** `databaseEditorProvider`, `databaseViewHost`, `views/*`, `properties/*`, `filters/*`, `relations/*`, `polish/*`, and other database-owned helpers.

Database children import from `databaseRegistry.ts` only — never from iconRegistry, pageChrome, or sibling database files directly.

### Gate-to-Gate Import Edges (enforced by compliance test)

| Gate | Imports from | Why |
|------|-------------|-----|
| **IconRegistry** | (none) | Leaf gate — all icons originate here |
| **BlockRegistry** | IconRegistry, BlockStateRegistry | Re-exports icons and mutations for its children |
| **CanvasMenuRegistry** | BlockRegistry, IconRegistry, BlockStateRegistry | Block data from owner, icons from owner, mutations from owner |
| **BlockStateRegistry** | BlockRegistry | Inward gate: `PAGE_CONTAINERS`, `isContainerBlockType` |
| **HandleRegistry** | BlockRegistry, IconRegistry, BlockStateRegistry, CanvasMenuRegistry | Each symbol from its source owner |
| **DatabaseRegistry** | IconRegistry, `canvasTypes`, `header/pageChrome` | Icons from source owner, shared canvas types, page chrome integration |

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

## Folder Map

Lines are counted at the time of writing; the point is the shape, not the number.

| Folder | What it holds | May import |
|---|---|---|
| `src/platform/` (1.8K) | The basics with no DOM: events (`Emitter`), disposables (`Disposable`, `DisposableStore`), storage, URIs, the app clock (`localTime`), DI primitives | nothing else in `src` |
| `src/ui/` (11K) | DOM widgets and the kit: `kit.ts` (buttons, headers, empty states), context menus, dropdowns, tooltips, the icon registry, Markdown rendering, the code editor host | `platform` |
| `src/theme/` (1.6K) | The `--px-*` tokens, light and dark themes, appearance settings | `platform`, `ui` |
| `src/layout/` (2.4K) | The serializable grid the workbench is laid out on | `platform`, `ui` |
| `src/parts/` (3.4K) | The fixed regions: title bar, activity bar, side bar, editor area, panel, auxiliary bar, status bar | `platform`, `ui`, `layout`, `editor`, service interfaces |
| `src/views/` (1.6K) | Views and the containers that host them inside parts | `platform`, `ui`, `layout`, service interfaces |
| `src/editor/` (12.7K) | Editor groups and tabs, and `panes/`: one pane per file kind (code, Markdown, PDF, EPUB, Word, Excel, image, notebook) | `platform`, `ui`, `layout`, `views`, service interfaces |
| `src/workspace/` (1.6K) | What a workspace is, how its state is saved and restored, recent workspaces | `platform`, service interfaces |
| `src/commands/` (4.3K) | The command registry, Quick Open and the command palette, the built-in structural commands | `platform`, `context`, service interfaces |
| `src/context/` (1.4K) | Context keys and `when` clauses (which part is active, what is focused) | `platform`, service interfaces |
| `src/dnd/` (0.5K) | Drag and drop between parts and views | `platform`, `ui`, `layout`, `views` |
| `src/tools/` (3.9K) | The extension host: manifests and their schema, discovery, validation, activation events, the module loader (which resolves an extension's relative imports), error isolation | `platform`, `api`, `configuration`, service interfaces |
| `src/api/` (7.1K) | The `parallx.*` API a tool sees: `apiFactory.ts` builds it per tool; `bridges/` connect each namespace to the services; `parallx.d.ts` is the public type | `platform`, `ui`, `layout`, `views`, `editor`, `commands`, `context`, `configuration`, service interfaces |
| `src/configuration/` (1K) | Settings schemas tools contribute and per-tool storage | `platform`, service interfaces |
| `src/contributions/` (2.3K) | Processors for manifest contribution points: commands, keybindings, menus, icons, views | `platform`, `ui`, `views`, `commands`, `context` |
| `src/services/` (38K) | Service interfaces (`serviceTypes.ts`, one file per area under `types/`) and implementations: files, editors, layout, settings, indexing and search, embeddings, language models, agents, autonomy, policies | anything below the tools and the workbench; never a built-in tool |
| `src/openclaw/` (19K) | The chat runtime: the turn loop (`openclawTurnRunner`, `openclawAttempt`), the context engine, participants, slash commands, routines (cron, heartbeat), MCP clients, the agent "mind" | `platform`, `services`, `agent`; never a built-in tool |
| `src/agent/` (0.4K) | The agent task model and lifecycle types | `platform` |
| `src/aiSettings/` (4.4K) | The AI configuration service (presets, profiles) and the AI Settings panel sections | `platform`, `ui`, `services` |
| `src/links/` (0.4K) | `parallx://` links: parsing, minting, resolving | `platform`, `services` |
| `src/vendor/` | The libraries that load on first use, not at boot: pdf.js, highlight.js, JSZip. Each entry builds as its own bundle (`dist/renderer/vendor-<name>.js`); `lazy.ts` holds the loaders the app calls | the packages only |
| `src/built-in/<tool>/` (117K) | The 18 first-party tools: canvas, chat, dashboard, settings, explorer, search, terminal, output, planner, worksheet, agents, ai-settings, activity-log, indexing-log, diagnostics, tool-gallery, theme-editor, welcome. `main.ts` is each one's activation, `manifest.ts` its manifest (gathered in `workbench/builtinManifests.ts`) | everything below; never another built-in, never the workbench |
| `src/workbench/` (11.7K) | The composition root: boot phases, service wiring (`workbenchServices.ts`), parts and layout, editor setup, the status bar | anything |
| `electron/` (16K) | The main process: window and lifecycle (`main.cjs`), the preload bridge (`preload.cjs`), and one bridge per capability (database, files, documents, browser, Python, MCP, models) | (CommonJS, outside the renderer) |
| `ext/` (125K) | The nine extensions shipped with the app, loaded like any third-party extension: Browser, Budget, Concept Lab, Creations AI, Flashcards, Atelier (`media-organizer`), Study, Web Research, Workspace Graph | only `api.*` |
| `tests/` | `unit/` (vitest), `e2e/` (Playwright against the built app), `probes/`, `ui-polish/` (screenshot sweeps), `eval/` and `ai-eval/` (model-in-the-loop) | |

### The first principle, in code

The core knows no optional tool. A built-in or extension adds what it adds
through a contribution point while it runs: editors and views, commands,
menus, keybindings, settings, page blocks (`api.canvas.registerBlock`),
dashboard widgets, AI tools (`api.chat.registerTool`), skills, icons and
styles. Turned off, all of it goes without a restart. `CLAUDE.md` states
the rule; `coreToolMentionsRatchet.test.ts` keeps the core from naming a
tool it may not have.

### Built-in tools

A built-in lives in `src/built-in/<tool>/` with its manifest in
`src/tools/builtinManifests.ts`. Those with `required: true` (canvas, chat,
settings, dashboard and the shell views) are always on; the rest can be
turned off. A built-in may import the layers below it and the service
interfaces; it may not import another built-in or the workbench. Two
built-ins that need each other go through a contribution point.

#### Canvas (`src/built-in/canvas/`)

The page editor, on Tiptap. Its own six-gate import structure is described
at the top of this document. `canvasDataService.ts` is the data layer
(pages, trees, autosave, trash, version history); `canvasEditorProvider.ts`
is the editor; `extensions/` holds one file per block type; `database/` is
the table system; `ai/` registers the canvas AI tools.

#### Chat (`src/built-in/chat/` and `src/openclaw/`)

`chat/main.ts` is the activation: it builds the providers (Ollama,
Anthropic), the data service, the tools, the widget and the session list,
and hands the runtime its services. The runtime in `src/openclaw/` runs a
turn: `openclawTurnRunner.ts` retries and compacts, `openclawAttempt.ts`
streams the model and runs tools, `openclawContextEngine.ts` assembles the
prompt (identity, `SOUL.md`, `USER.md`, `AGENTS.md`, skills, rules, the
workspace digest, retrieved context, memory, history). Routines run from
`openclawCronService.ts` and `openclawHeartbeatRunner.ts`; MCP servers from
`mcp/`; the agent's persistent model from `mind/`. Slash commands are one
file each in `commands/`.

### Electron (`electron/`)

The renderer never touches `ipcRenderer`: everything goes through the
preload bridge (`window.parallxElectron`), and each main-process capability
is one `*Bridge.cjs` file with its own IPC handlers. The database runs in a
worker (`databaseWorker.cjs`) behind `databaseClient.cjs`.

### UI (`src/ui/`)

Reusable widgets, each extending `Disposable`, taking `(container,
options?)`, with co-located CSS. The kit (`kit.ts`) is the vocabulary every
surface draws from; `--px-*` tokens are the only colours, sizes and motion.

### Absolute Prohibitions

- **No circular dependencies.** If module A imports from module B, module B must not import from module A (directly or transitively).
- **No upward dependencies.** Lower layers (`platform`, `layout`) must never import from higher layers (`workbench`, `services` implementations).
- **No cross-peer dependencies unless explicitly allowed.** For example, `parts` must not import from `views`, `editor`, `workspace`, `commands`, `context`, or `dnd`.
- **No concrete service imports outside `services/` and `workbench/`.** All other modules consume services through interfaces only.

---

## Layers

```
┌───────────────────────────────────────────────────────────────┐
│                       workbench/                              │  composition root
├───────────────────────────────────────────────────────────────┤
│              built-in/<tool>/            ext/<tool>/          │  tools (on or off)
├───────────────────────────────────────────────────────────────┤
│   tools/   api/   contributions/   configuration/             │  extension host
├───────────────────────────────────────────────────────────────┤
│   services/   openclaw/   agent/   aiSettings/   links/       │  services and the chat runtime
├────────┬────────┬────────┬────────┬──────────┬────────────────┤
│ parts/ │ views/ │editor/ │  dnd/  │ commands/│ context/       │  shell pieces
│        │        │        │        │ workspace/                │
├────────┴────────┴────────┴────────┴──────────┴────────────────┤
│                        layout/                                │
├───────────────────────────────────────────────────────────────┤
│                    ui/        theme/                          │
├───────────────────────────────────────────────────────────────┤
│                       platform/                               │  foundation
└───────────────────────────────────────────────────────────────┘
```

Imports point down. `importDirectionRatchet.test.ts` encodes these rules
and holds a baseline of the few imports that still point up; the baseline
may only fall.

---

## What the tests enforce

| Rule | Test |
|---|---|
| Imports point down the layers | `tests/unit/importDirectionRatchet.test.ts` |
| The core names no optional tool | `tests/unit/coreToolMentionsRatchet.test.ts` |
| Files over 800 lines may only shrink | `tests/unit/fileSizeRatchet.test.ts` |
| Comments carry no milestone tags, dates or names | `tests/unit/historyTagRatchet.test.ts` |
| Extensions use only names that exist | `tests/unit/extUndefinedNames.test.ts` |
| Extensions use the kit and the tokens | `tests/unit/extStyleRatchet.test.ts` |
| The canvas gates (above) | `tests/unit/gateCompliance.test.ts` |
| Chat files import only through their gates | `tests/unit/chatGateCompliance.test.ts` |
| A packaged extension holds every module it imports | `tests/unit/packageExtension.test.ts` |
| `ext/study/main.js` matches its sources | `tests/unit/studyBundle.test.ts` |
| pdf.js, highlight.js and JSZip stay in their own bundles: nothing outside `src/vendor/` imports them for a value | `tests/unit/lazyVendorBundles.test.ts` |

The checks every change runs: `npm run typecheck` (the app and the
tests), `npx vitest run`, `npm run build`.

---

## Conventions

- **One concern per file**, named for what it does, with a header comment
  that says what the file is for and who uses it. No milestone codes,
  dates or names in comments: history lives in git.
- **Types beside their module.** Shared types live in a `*Types.ts` file
  next to the code; service interfaces live in `services/serviceTypes.ts`.
- **A file fits in one sitting:** under 800 lines, 1,500 at most.
- **Persisted strings are frozen.** Command ids, setting keys, storage
  keys, table names, extension ids and migration file names are stored on
  disk or typed by users; rename the constant, never the value.
- **Tests live in `tests/unit/`**, named after the subject they test.
- **Copy:** Title Case for actions and titles, sentence case for section
  labels and hints, `…` when an action opens a dialog.

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

---

## LLM Request Isolation (M52)

### The Problem: Global Active Model Mutation

`ILanguageModelsService` maintains a global `_activeModelId` — the user's currently selected model in the UI. The original `sendChatRequest(messages)` method reads from this global slot. When any caller needed a specific model, it had to call `setActiveModel(modelId)` first, which:

1. Overwrites `_activeModelId` (global mutation)
2. Persists to storage (disk write)
3. Probes the model via `/api/show` (network request)
4. Resets streaming parser state across ALL providers
5. Fires `onDidChangeModels` (UI update cascade)

This design is safe when only one caller exists (the chat UI). It becomes a **race condition** when multiple callers exist — OpenClaw's autonomous behaviors (heartbeat, MCP event triggers, agentic loops) and external extensions (text-generator) can call `sendChatRequest` concurrently, causing model slot collisions, streaming parser corruption, and VRAM churn on the Ollama backend.

### The Fix: `sendChatRequestForModel(modelId, messages)`

Two entry points now exist on `ILanguageModelsService`:

| Method | Mutates global state? | Used by |
|--------|----------------------|---------|
| `sendChatRequest(messages)` | Yes — reads `_activeModelId` | Internal callers already operating on the UI-selected model (chat UI, AI settings) |
| `sendChatRequestForModel(modelId, messages)` | **No** — resolves provider directly from `modelId` | Extension API bridge (`parallx.lm`), any caller that knows its target model |

The extension API bridge (`LanguageModelBridge`) calls `sendChatRequestForModel` exclusively. Extensions never touch the global active model — they specify which model they want and the service routes directly to the correct provider.

### Request Routing

```
┌─────────────────────────────────────────────────────────────────┐
│                     Callers                                     │
│                                                                 │
│  OpenClaw (chat UI)          Extension (parallx.lm)             │
│  AI Settings service         Another extension                  │
│       │                           │                             │
│       │ sendChatRequest()         │ sendChatRequestForModel()   │
│       │ (uses _activeModelId)     │ (modelId passed directly)   │
│       ▼                           ▼                             │
│  ┌─────────────────────────────────────────────┐                │
│  │          LanguageModelsService               │                │
│  │                                             │                │
│  │  _modelToProvider: Map<modelId, providerId> │                │
│  │  _providers: Map<providerId, provider>      │                │
│  │                                             │                │
│  │  Both methods resolve: modelId → provider   │                │
│  │  Then call: provider.sendChatRequest(...)   │                │
│  └──────────────────┬──────────────────────────┘                │
│                     │                                           │
│                     ▼                                           │
│  ┌─────────────────────────────────┐                            │
│  │  OllamaProvider                 │                            │
│  │  (handles concurrent requests   │                            │
│  │   to different models natively) │                            │
│  └─────────────────────────────────┘                            │
└─────────────────────────────────────────────────────────────────┘
```

### Invariants

- **`setActiveModel()` is UI-only.** Called by model picker, chat widget, session restore. Never called in the request dispatch path.
- **Extensions cannot mutate global model state.** The `parallx.lm` API surface does not expose `setActiveModel`.
- **OpenClaw has unconditional priority.** Because there is no shared mutable state in the request path, OpenClaw's autonomous behaviors (heartbeat, MCP triggers, agentic loops) cannot be disrupted by extension LLM calls — and vice versa.
- **Ollama handles concurrency.** Ollama natively supports multiple loaded models (`OLLAMA_MAX_LOADED_MODELS`). Routing requests directly means Ollama manages model scheduling without Parallx forcing unnecessary swaps.

### Files Changed

| File | Change |
|------|--------|
| `src/services/chatTypes.ts` | Added `sendChatRequestForModel` to `ILanguageModelsService` interface |
| `src/services/languageModelsService.ts` | Implemented `sendChatRequestForModel` — provider lookup by modelId, no global mutation |
| `src/api/bridges/languageModelBridge.ts` | Switched from `setActiveModel` + `sendChatRequest` to `sendChatRequestForModel` |
