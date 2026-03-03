# Milestone 13: Chat Architecture — Gate Registry Restructuring

## Research Document — February 19, 2026

---

## Table of Contents

1. [Vision](#vision)
2. [The Problem](#the-problem)
3. [Current State — Deep Audit](#current-state--deep-audit)
4. [Target Architecture](#target-architecture)
5. [Architecture Principles Enforced](#architecture-principles-enforced)
6. [Transformation Plan](#transformation-plan)
7. [Task Tracker](#task-tracker)
8. [Acceptance Criteria](#acceptance-criteria)
9. [Migration Safety Rules](#migration-safety-rules)

---

## Vision

**Before M13 — what an engineer experiences today:**

> You need to add a new chat feature — say, a "pin message" capability. You open `chatTool.ts` (1,825 lines). Somewhere around line 700 there's a closure that queries the database. The interface for the widget is defined in `chatWidget.ts`, the interface for tool access is in `builtInTools.ts`, and the interface for participants is in `defaultParticipant.ts`. You can't tell which file owns which responsibility without reading all 30 files. When you add your feature, you wire it via yet another anonymous closure in the god file, scatter the interface in whichever file felt convenient, and pray nothing breaks. Six months later, nobody can trace how data flows through the system.

**After M13 — what an engineer will experience:**

> You need to add a "pin message" capability. You open `chatTypes.ts` — the single source of truth for every interface. You find `IChatWidgetServices` and add `pinMessage()`. You open `data/chatDataService.ts` to add the database query. You open `main.ts` (~200 lines) and see exactly where the service is constructed and wired. The gate compliance test catches you if you import from the wrong place. The entire dependency graph is deterministic, documented, and enforced.

**The one-sentence pitch:**

> Make the chat built-in's file structure as deterministic, traceable, and testable as the canvas built-in's five-registry gate architecture.

**Why this matters:**

The chat subsystem grew organically across M9–M12 without structural discipline. It now has a 1,825-line god file (`chatTool.ts`), 44 interfaces scattered across 15 files, ~30 anonymous database closures that can't be unit-tested, and 29 files dumped at root level. Canvas went through the same growing pains — and the gate architecture solved it. M13 applies the same medicine to chat.

---

## The Problem

### Problem 1: God File (`chatTool.ts` — 1,825 lines)

`chatTool.ts` is the `activate()` entry point for the entire chat subsystem. Over M9–M12 it accumulated **seven distinct responsibilities**:

| Section | Lines | Responsibility |
|---------|-------|---------------|
| DI retrieval | 128–172 | Gets 13 service instances from the container |
| FS accessor + prompt service | 173–224 | Builds file system accessor, creates PromptFileService |
| Configuration | 225–245 | Reads 4 config values |
| OllamaProvider creation | 246–262 | Creates provider, registers with models service |
| Default participant services | 263–840 | **~580 lines** of inline closures: 30+ DB queries, workspace digest builder, memory/preferences, file ops |
| Widget services | 1100–1225 | Builds `IChatWidgetServices` with more inline closures |
| View + commands + status bar | 1225–1640 | Registers view, 7 commands, token status bar, context keys |

The participant services block alone (263–840) is **larger than most entire files** in the codebase. These closures capture DI references via lexical scope, making them impossible to unit test in isolation.

### Problem 2: Scattered Interfaces (44 across 15 files)

Every file that needs a services contract defines its own interface locally:

| File | Interfaces | Lines |
|------|-----------|-------|
| `defaultParticipant.ts` | `IDefaultParticipantServices` | 142–310 (168 lines!) |
| `builtInTools.ts` | `IBuiltInToolDatabase`, `IBuiltInToolFileSystem`, `IBuiltInToolFileWriter`, `IBuiltInToolRetrieval`, `IBuiltInToolTerminal` | 31–100 |
| `chatWidget.ts` | `IChatWidgetServices` | ~40 lines |
| `chatModelPicker.ts` | `IModelPickerServices` | ~15 lines |
| `chatModePicker.ts` | `IModePickerServices` | ~10 lines |
| `chatSessionSidebar.ts` | `ISessionSidebarServices` | ~20 lines |
| `chatContextAttachments.ts` | `IAttachmentServices` | ~15 lines |
| `chatToolPicker.ts` | `IToolPickerServices` | ~10 lines |
| `chatMentionAutocomplete.ts` | `IMentionSuggestionProvider` | ~10 lines |
| `chatMentionResolver.ts` | `IMentionResolutionServices` | ~10 lines |
| `chatTokenStatusBar.ts` | `ITokenStatusBarServices` | ~15 lines |
| `chatHeaderPart.ts` | `IChatHeaderAction` | ~10 lines |
| `commands/initCommand.ts` | `IInitCommandServices` | ~10 lines |
| `userCommandLoader.ts` | `IUserCommandFileSystem` | ~10 lines |
| `chatRequestParser.ts` | `IChatParsedRequest`, `IChatParsedVariable` | ~15 lines |

**Contrast with canvas:** Canvas has `canvasTypes.ts` — one file, all types. When you need to know any interface shape, you open one file.

### Problem 3: No Data Service Class

Canvas has `CanvasDataService` — a proper class with methods for all database operations, injectable and unit-testable. Chat has **~30 anonymous closures** buried inside `chatTool.ts`'s `activate()` function:

```typescript
// Example from chatTool.ts ~line 350 (simplified)
const defaultParticipantServices = {
  getPageCount: async () => {
    const result = await dbService.query('SELECT COUNT(*) ...');
    return result[0].count;
  },
  getCurrentPageTitle: async () => {
    const editorInput = editorGroupService.activeEditorInput;
    // ... 15 lines of logic ...
  },
  // ... 28 more closures like this
};
```

These closures:
- Cannot be unit tested (they capture `dbService` via lexical scope)
- Cannot be reused (they're local to `activate()`)
- Cannot be injected (no class, no interface, no identifier)
- Make `chatTool.ts` enormous (580+ lines just for this one object)

### Problem 4: Flat Directory — 29 Files at Root

```
src/built-in/chat/
├── chatCodeActions.ts        ← UI rendering helper
├── chatContentParts.ts       ← UI rendering
├── chatContextAttachments.ts ← UI input component
├── chatContextPills.ts       ← UI input component
├── chatDiffViewer.ts         ← UI rendering helper
├── chatHeaderPart.ts         ← UI component
├── chatIcons.ts              ← icon data (like canvasIcons.ts)
├── chatInputPart.ts          ← UI input component
├── chatListRenderer.ts       ← UI rendering
├── chatMentionAutocomplete.ts← UI input feature
├── chatMentionResolver.ts    ← utility
├── chatModeCapabilities.ts   ← types/config
├── chatModelPicker.ts        ← UI picker
├── chatModePicker.ts         ← UI picker
├── chatRequestParser.ts      ← utility
├── chatSessionSidebar.ts     ← UI component
├── chatSlashCommands.ts      ← utility
├── chatSystemPrompts.ts      ← types/config
├── chatTokenStatusBar.ts     ← UI component
├── chatTool.ts               ← ENTRY POINT + GOD FILE
├── chatToolPicker.ts         ← UI picker
├── chatView.ts               ← view factory
├── chatWidget.ts             ← UI orchestrator
├── userCommandLoader.ts      ← utility
├── commands/initCommand.ts
├── participants/{3 files}
├── providers/ollamaProvider.ts
└── tools/builtInTools.ts
```

**Compare canvas:** 10 files at root, everything else in `config/`, `menus/`, `handles/`, `extensions/`, `plugins/`, `database/`, `header/`, `invariants/`, `math/`. You can see the architecture in the folder listing.

### Problem 5: One Circular Dependency

`chatTool.ts` imports `createChatView` from `chatView.ts`, and `chatView.ts` imports `setActiveWidget` from `chatTool.ts`. This is a real ESM cycle. It works at runtime because the functions aren't called during module evaluation, but it's fragile and architecturally incorrect per ARCHITECTURE.md's absolute prohibition on circular dependencies.

### Current Import Graph

```
chatTool ──→ chatView ──→ chatWidget ──→ chatInputPart ──→ chatIcons
   │              ↑            │              │               chatContextAttachments
   │              │            │              │               chatContextPills
   │         (circular!)       │              │               chatToolPicker
   │              │            │              └──→ chatMentionAutocomplete
   │              └── chatTool │
   │                           ├──→ chatListRenderer ──→ chatContentParts ──→ chatIcons
   │                           │                                              chatCodeActions
   │                           ├──→ chatModelPicker ──→ chatIcons
   │                           ├──→ chatModePicker ──→ chatIcons
   │                           ├──→ chatSessionSidebar ──→ chatIcons
   │                           ├──→ chatCodeActions (dynamic)
   │                           ├──→ chatDiffViewer (dynamic)
   │                           └──→ chatContextAttachments
   │                                chatToolPicker
   │
   ├──→ providers/ollamaProvider (leaf)
   ├──→ chatSystemPrompts (leaf)
   ├──→ chatTokenStatusBar ──→ chatIcons, chatSystemPrompts
   ├──→ participants/defaultParticipant ──→ chatSystemPrompts, chatModeCapabilities,
   │                                        chatMentionResolver, chatSlashCommands,
   │                                        userCommandLoader, commands/initCommand,
   │                                        providers/ollamaProvider
   ├──→ participants/workspaceParticipant (leaf)
   ├──→ participants/canvasParticipant (leaf)
   └──→ tools/builtInTools (leaf)
```

**14 leaf files** (zero intra-chat imports): `chatIcons`, `chatCodeActions`, `chatDiffViewer`, `chatModeCapabilities`, `chatMentionResolver`, `chatRequestParser`, `chatSlashCommands`, `chatSystemPrompts`, `ollamaProvider`, `workspaceParticipant`, `canvasParticipant`, `initCommand`, `builtInTools`.

**Most-imported file:** `chatIcons.ts` — depended on by 13 other files (analogous to `canvasIcons.ts` in canvas).

---

## Current State — Deep Audit

### File Inventory (30 .ts files, ~12,476 total lines)

| # | File | Lines | Classification | Local Imports |
|---|------|-------|---------------|--------------|
| 1 | `chatTool.ts` | 1,825 | entry-point | 9 local files |
| 2 | `participants/defaultParticipant.ts` | 1,418 | service | 7 local files |
| 3 | `tools/builtInTools.ts` | 1,086 | data-access | LEAF |
| 4 | `chatWidget.ts` | 847 | view/UI | 10 local files |
| 5 | `providers/ollamaProvider.ts` | 754 | service | LEAF |
| 6 | `chatContentParts.ts` | 722 | view/UI | 2 (chatIcons, chatCodeActions) |
| 7 | `chatTokenStatusBar.ts` | 651 | view/UI | 2 (chatIcons, chatSystemPrompts) |
| 8 | `chatInputPart.ts` | 558 | view/UI | 5 local files |
| 9 | `chatListRenderer.ts` | 474 | view/UI | 2 (chatContentParts, chatIcons) |
| 10 | `chatSessionSidebar.ts` | 400 | view/UI | 1 (chatIcons) |
| 11 | `chatMentionAutocomplete.ts` | 362 | view/UI | 1 (chatIcons) |
| 12 | `chatSystemPrompts.ts` | 348 | types/config | LEAF |
| 13 | `chatContextAttachments.ts` | 307 | view/UI | 1 (chatIcons) |
| 14 | `chatToolPicker.ts` | 299 | view/UI | 1 (chatIcons) |
| 15 | `chatSlashCommands.ts` | 280 | utility | LEAF |
| 16 | `chatModelPicker.ts` | 272 | view/UI | 1 (chatIcons) |
| 17 | `chatMentionResolver.ts` | 237 | utility | LEAF |
| 18 | `chatCodeActions.ts` | 207 | view/UI | LEAF |
| 19 | `chatContextPills.ts` | 206 | view/UI | 1 (chatIcons) |
| 20 | `chatDiffViewer.ts` | 177 | view/UI | LEAF |
| 21 | `chatIcons.ts` | 170 | icon data | LEAF |
| 22 | `commands/initCommand.ts` | 162 | command | LEAF |
| 23 | `chatModePicker.ts` | 153 | view/UI | 1 (chatIcons) |
| 24 | `userCommandLoader.ts` | 126 | utility | 1 (chatSlashCommands) |
| 25 | `chatHeaderPart.ts` | 123 | view/UI | 1 (chatIcons) |
| 26 | `chatRequestParser.ts` | 104 | utility | LEAF |
| 27 | `chatView.ts` | 95 | view/UI | 3 (ollamaProvider, chatWidget, chatTool) |
| 28 | `chatModeCapabilities.ts` | 85 | types/config | LEAF |
| 29 | `participants/workspaceParticipant.ts` | — | service | LEAF |
| 30 | `participants/canvasParticipant.ts` | — | service | LEAF |

### `chatTool.ts` Section-by-Section Map

| Lines | Block | Extracted To (M13 target) |
|-------|-------|--------------------------|
| 1–10 | Header comment | Keep (in `main.ts`) |
| 12–58 | Imports | Reduce to ~10 |
| 60–85 | `extractCanvasPageId()` | → `data/chatDataService.ts` |
| 87–113 | `ParallxApi` interface | → `chatTypes.ts` |
| 116–126 | Module state singletons | → `main.ts` (minimize) |
| 128–172 | DI service retrieval | → `main.ts` |
| 173–224 | FS accessor + prompt service | → `data/chatDataService.ts` |
| 225–245 | Configuration reading | → `main.ts` |
| 246–262 | OllamaProvider creation | → `main.ts` |
| 263–840 | Default participant services (**580 lines**) | → `data/chatDataService.ts` |
| 840–845 | Create + register default participant | → `main.ts` |
| 846–960 | @workspace + @canvas participants | → `main.ts` (thin calls to data service) |
| 960–1100 | Built-in tools + permission service | → `main.ts` (wiring only) |
| 1100–1225 | Widget services bridge | → `data/chatDataService.ts` |
| 1225–1325 | View + command registration | → `main.ts` |
| 1325–1500 | Token status bar | → `main.ts` |
| 1500–1550 | Context keys + font CSS | → `main.ts` |
| 1550–1640 | Phase 7 advanced features | → `main.ts` |
| 1640–1700 | M11 services (lazy-load) | → `main.ts` |
| 1700–1770 | `setActiveWidget`, `setChatIsStreaming`, `deactivate` | → `main.ts` |
| 1770–1825 | Helpers | → `data/chatDataService.ts` |

---

## Target Architecture

### Directory Structure

```
src/built-in/chat/
├── main.ts                     ← Entry point (~200 lines): activate, deactivate, setActiveWidget
├── chatTypes.ts                ← ALL interfaces (44 → consolidated here)
├── chatIcons.ts                ← Raw SVG icon data (leaf — consumed only by IconGate)
│
├── data/                       ← Data access layer
│   └── chatDataService.ts      ← ChatDataService class: all DB queries, workspace digest, FS ops
│
├── config/                     ← Configuration & types
│   ├── chatSystemPrompts.ts    ← System prompt builder
│   ├── chatModeCapabilities.ts ← Mode capability matrix
│   └── chatSlashCommands.ts    ← Slash command registry
│
├── input/                      ← Input area components
│   ├── chatInputPart.ts        ← Tiptap input area
│   ├── chatContextAttachments.ts ← File/page attachment chips
│   ├── chatContextPills.ts     ← Context source pills
│   ├── chatMentionAutocomplete.ts ← @mention autocomplete
│   └── chatRequestParser.ts    ← Input parsing
│
├── rendering/                  ← Message display components
│   ├── chatListRenderer.ts     ← Message list renderer
│   ├── chatContentParts.ts     ← Message content parts (markdown, code, etc.)
│   ├── chatCodeActions.ts      ← Code block action buttons
│   └── chatDiffViewer.ts       ← Inline diff rendering
│
├── pickers/                    ← Selection UI components
│   ├── chatModelPicker.ts      ← Model dropdown
│   ├── chatModePicker.ts       ← Mode dropdown (Ask/Edit/Agent)
│   └── chatToolPicker.ts       ← Tool selector
│
├── widgets/                    ← Top-level UI assemblies
│   ├── chatWidget.ts           ← Chat panel (assembles input, list, pickers)
│   ├── chatView.ts             ← View factory for auxiliary bar
│   ├── chatHeaderPart.ts       ← Header toolbar
│   ├── chatSessionSidebar.ts   ← Session history sidebar
│   └── chatTokenStatusBar.ts   ← Token usage status bar
│
├── utilities/                  ← Shared helpers
│   ├── chatMentionResolver.ts  ← @mention resolution logic
│   └── userCommandLoader.ts    ← .parallx/commands/*.md loader
│
├── participants/               ← Chat participants (keep existing)
│   ├── defaultParticipant.ts   ← Default agentic participant
│   ├── workspaceParticipant.ts ← @workspace participant
│   └── canvasParticipant.ts    ← @canvas participant
│
├── providers/                  ← LLM providers (keep existing)
│   └── ollamaProvider.ts       ← Ollama HTTP client
│
├── commands/                   ← Chat commands (keep existing)
│   └── initCommand.ts          ← /init command handler
│
├── tools/                      ← Built-in tools
│   ├── builtInTools.ts         ← Tool registration orchestrator (~100 lines)
│   ├── pageTools.ts            ← search_workspace, read_page, list_pages, etc.
│   ├── fileTools.ts            ← list_files, read_file, search_files, search_knowledge
│   ├── writeTools.ts           ← write_file, edit_file, delete_file
│   └── terminalTools.ts        ← run_command
│
├── defaults/                   ← Default prompt files (keep existing)
│   ├── SOUL.md
│   └── TOOLS.md
│
├── chatInput.css
├── chatTokenStatusBar.css
├── chatView.css
├── chatWidget.css
└── parallx-manifest.json
```

### Gate Architecture (adapted from canvas model)

Chat's structure is simpler than canvas — it doesn't need five bidirectional registry gates. Instead, it uses a **hub-and-spoke** gate model with `chatTypes.ts` as the type hub and `data/chatDataService.ts` as the data hub:

```
                    ┌───────────────┐
                    │  chatIcons.ts │  (raw SVG — leaf)
                    └───────┬───────┘
                            │
                    ┌───────▼───────┐
                    │ chatTypes.ts  │  (type hub — all interfaces)
                    └───┬───┬───┬──┘
                        │   │   │
           ┌────────────┘   │   └───────────────┐
           │                │                    │
    ┌──────▼───────┐  ┌────▼────────┐  ┌────────▼──────────┐
    │    main.ts   │  │ ChatData    │  │   Folder gates    │
    │ (orchestrator│  │ Service     │  │ (input/, rendering/│
    │  ~200 lines) │  │ (data hub)  │  │  pickers/, widgets/│
    └──────────────┘  └─────────────┘  │  config/, tools/)  │
                                       └───────────────────┘
```

**Import rules:**

| Source | May import from | Must NOT import from |
|--------|----------------|---------------------|
| `main.ts` | Any chat file (orchestrator) | — |
| `chatTypes.ts` | Nothing within chat | Any chat file |
| `chatIcons.ts` | Nothing within chat | Any chat file |
| `data/chatDataService.ts` | `chatTypes.ts` only | UI files, participants, tools |
| `config/*` | `chatTypes.ts` only | UI files, data service, participants |
| `input/*` | `chatTypes.ts`, `chatIcons.ts` | data service, participants, tools, other folders |
| `rendering/*` | `chatTypes.ts`, `chatIcons.ts` | data service, participants, tools, other folders |
| `pickers/*` | `chatTypes.ts`, `chatIcons.ts` | data service, participants, tools, other folders |
| `widgets/*` | `chatTypes.ts`, `chatIcons.ts`, files from `input/`, `rendering/`, `pickers/` | data service, participants, tools |
| `participants/*` | `chatTypes.ts`, `config/*` | UI files, data service directly, tools |
| `providers/*` | `chatTypes.ts` only | Everything else |
| `tools/*` | `chatTypes.ts` only | UI files, participants, data service |
| `commands/*` | `chatTypes.ts` only | UI files, data service |
| `utilities/*` | `chatTypes.ts`, `chatSlashCommands` (for types) | UI files, data service |

**Key difference from canvas:** Canvas uses **re-export gates** (registries that re-export from other registries for their children). Chat uses a **flat type hub** — `chatTypes.ts` provides all interfaces, and each file imports directly from it. This is simpler because chat's dependency graph is already mostly a tree, not the complex mesh that canvas had.

---

## Architecture Principles Enforced

Every task in this milestone is designed to uphold these principles from `ARCHITECTURE.md` and the instructions file:

### From ARCHITECTURE.md

| Principle | How M13 enforces it |
|-----------|-------------------|
| **"One concern per file"** | `chatTool.ts` (7 concerns) → `main.ts` (orchestration only) + `chatDataService.ts` (data access only) |
| **"Types files are co-located"** | 44 scattered interfaces → `chatTypes.ts` (single source of truth) |
| **"No circular dependencies"** | Break `chatTool ↔ chatView` cycle by extracting shared state to `main.ts` |
| **"Children talk only to their parent gate"** | Folder-scoped files import from `chatTypes.ts` hub, not from sibling folders |
| **"Go to source"** | Each file imports types from `chatTypes.ts` (the owner), not from intermediate files |

### From Instructions File

| Principle | How M13 enforces it |
|-----------|-------------------|
| **"Mirror VS Code's structure"** | Sub-folders mirror VS Code's `contrib/chat/browser/` layout |
| **"Never reinvent the wheel"** | Reuses the canvas gate pattern, adapted for chat's simpler graph |
| **"Every new service must have a unit test"** | `ChatDataService` will have full unit test coverage |
| **"One concern per file"** | builtInTools.ts (15 tools + helpers in 1 file) → 4 focused tool files |

### Gate Isolation Invariants (chat-specific)

| Invariant | Description |
|-----------|-------------|
| **Type hub** | `chatTypes.ts` has zero intra-chat imports. All interfaces originate here. |
| **Data hub** | `chatDataService.ts` imports only from `chatTypes.ts`. No UI dependencies. |
| **Folder isolation** | Files in `input/` never import from `rendering/`, `pickers/`, `widgets/`, or vice versa. Cross-folder dependencies go through `chatTypes.ts` interfaces. |
| **Icon leaf** | `chatIcons.ts` has zero imports. Only UI files and `main.ts` may import it directly. |
| **No upward imports** | `config/`, `input/`, `rendering/`, `pickers/` never import from `main.ts` or `chatTool.ts`. |
| **Participant isolation** | Participants import from `chatTypes.ts` and `config/` only — never from UI files. |
| **Tool isolation** | `tools/*` imports from `chatTypes.ts` only — never from UI files, participants, or data service. |

---

## Transformation Plan

### Phase 1: Create `chatTypes.ts` — Centralize All Interfaces

**Goal:** Single source of truth for every exported interface in the chat subsystem.

**What moves:**
- `IDefaultParticipantServices` (168 lines) from `defaultParticipant.ts`
- `IBuiltInToolDatabase`, `IBuiltInToolFileSystem`, `IBuiltInToolFileWriter`, `IBuiltInToolRetrieval`, `IBuiltInToolTerminal` from `builtInTools.ts`
- `IChatWidgetServices` from `chatWidget.ts`
- `IModelPickerServices` from `chatModelPicker.ts`
- `IModePickerServices` from `chatModePicker.ts`
- `ISessionSidebarServices` from `chatSessionSidebar.ts`
- `IAttachmentServices` from `chatContextAttachments.ts`
- `IToolPickerServices` from `chatToolPicker.ts`
- `IMentionSuggestionProvider` from `chatMentionAutocomplete.ts`
- `IMentionResolutionServices` from `chatMentionResolver.ts`
- `ITokenStatusBarServices` from `chatTokenStatusBar.ts`
- `IChatHeaderAction` from `chatHeaderPart.ts`
- `IInitCommandServices` from `initCommand.ts`
- `IUserCommandFileSystem` from `userCommandLoader.ts`
- `IChatParsedRequest`, `IChatParsedVariable` from `chatRequestParser.ts`
- `IWorkspaceParticipantServices` from `workspaceParticipant.ts`
- `ICanvasParticipantServices` from `canvasParticipant.ts`
- `IRetrievalPlan` from `ollamaProvider.ts` (if it's a shared interface)
- `CurrentPageIdGetter` type from `builtInTools.ts`
- `ParallxApi` interface from `chatTool.ts`
- `IChatModeCapabilities` from `chatModeCapabilities.ts`

**Strategy:**
1. Create `chatTypes.ts` with all interfaces
2. In each original file, replace the interface definition with `import type { ... } from './chatTypes.js'` (or appropriate relative path)
3. Keep `export type { IFoo }` re-exports in original files for backward compatibility during transition
4. Run `tsc --noEmit` after each file to catch breakage immediately

**Validation:**
- `tsc --noEmit` passes
- All 1296+ unit tests pass
- No interface is defined in more than one file (grep verification)

### Phase 2: Extract `ChatDataService`

**Goal:** Replace ~30 anonymous closures in `chatTool.ts` with a proper `ChatDataService` class that is injectable and unit-testable.

**What moves to `data/chatDataService.ts`:**
- All database query closures from `defaultParticipantServices` (lines 263–840)
- `getWorkspaceDigest()` with 60s TTL cache (lines 700–840)
- `buildFileSystemAccessor()` (lines 1770–1825)
- `extractCanvasPageId()` helper (lines 60–85)
- `extractBlockPreview()`, `walkContentNode()` helpers (lines 1770–1825)
- Widget services database bridges from lines 1100–1225
- Workspace/canvas participant data bridges from lines 846–960

**Class shape:**

```typescript
// data/chatDataService.ts
import type { IDefaultParticipantServices, IChatWidgetServices, ... } from '../chatTypes.js';

export class ChatDataService {
  constructor(
    private readonly _dbService: IDatabaseService,
    private readonly _fileService: IFileService,
    private readonly _workspaceService: IWorkspaceService,
    private readonly _editorGroupService: IEditorGroupService,
    private readonly _retrievalService: IRetrievalService,
    private readonly _indexingService: IIndexingPipelineService,
    private readonly _memoryService: IMemoryService,
    // ... other DI services
  ) {}

  // Participant data methods
  getPageCount(): Promise<number> { ... }
  getCurrentPageTitle(): Promise<string | undefined> { ... }
  getWorkspaceDigest(): Promise<string> { ... }
  planAndRetrieve(...): Promise<IRetrievalResult> { ... }
  recallMemories(...): Promise<string[]> { ... }
  // ... (all 30+ closures become methods)

  // Widget data methods
  buildWidgetServices(): IChatWidgetServices { ... }

  // Participant service bridges
  buildDefaultParticipantServices(): IDefaultParticipantServices { ... }
  buildWorkspaceParticipantServices(): IWorkspaceParticipantServices { ... }
  buildCanvasParticipantServices(): ICanvasParticipantServices { ... }
}
```

**Strategy:**
1. Create `data/chatDataService.ts` with the class skeleton
2. Move closures one section at a time, converting each to a method
3. Update `chatTool.ts` to instantiate `ChatDataService` and pass it to participants
4. Run tests after each section migration

**Validation:**
- `tsc --noEmit` passes
- All 1296+ unit tests pass
- `chatTool.ts` shrinks by ~800 lines
- New unit test file: `tests/unit/chatDataService.test.ts`

### Phase 3: Slim `chatTool.ts` → `main.ts`

**Goal:** Reduce the entry point to ~200 lines of pure orchestration: construct, wire, register.

**What stays in `main.ts`:**
1. DI service retrieval (~15 lines)
2. Configuration reading (~10 lines)
3. `OllamaProvider` creation (~10 lines)
4. `ChatDataService` instantiation (~5 lines)
5. `createDefaultParticipant()` call + registration (~5 lines)
6. `createWorkspaceParticipant()` / `createCanvasParticipant()` (~10 lines)
7. `registerBuiltInTools()` + permission service (~15 lines)
8. View registration (~10 lines)
9. Command registration (~20 lines)
10. Token status bar creation (~15 lines)
11. Context keys + font CSS (~10 lines)
12. M11 lazy services (~10 lines)
13. `setActiveWidget`, `setChatIsStreaming`, `deactivate` exports (~30 lines)

**Strategy:**
1. Rename `chatTool.ts` → `main.ts`
2. Remove all code that moved to `ChatDataService` in Phase 2
3. Replace inline closures with `dataService.buildDefaultParticipantServices()`, etc.
4. Break `chatTool ↔ chatView` cycle: `chatView.ts` should accept `setActiveWidget` as a parameter instead of importing it
5. Update all imports across the codebase that reference `chatTool.js`

**Validation:**
- `tsc --noEmit` passes
- All tests pass
- `main.ts` ≤ 250 lines
- Zero circular dependencies (verified by import analysis)
- `chatView.ts` no longer imports from `main.ts` / `chatTool.ts`

### Phase 4: Create Sub-Folders with Gate Rules

**Goal:** Move files from root into domain sub-folders. Establish import rules.

**File moves:**

| File | Current Location | New Location |
|------|-----------------|--------------|
| `chatInputPart.ts` | root | `input/chatInputPart.ts` |
| `chatContextAttachments.ts` | root | `input/chatContextAttachments.ts` |
| `chatContextPills.ts` | root | `input/chatContextPills.ts` |
| `chatMentionAutocomplete.ts` | root | `input/chatMentionAutocomplete.ts` |
| `chatRequestParser.ts` | root | `input/chatRequestParser.ts` |
| `chatListRenderer.ts` | root | `rendering/chatListRenderer.ts` |
| `chatContentParts.ts` | root | `rendering/chatContentParts.ts` |
| `chatCodeActions.ts` | root | `rendering/chatCodeActions.ts` |
| `chatDiffViewer.ts` | root | `rendering/chatDiffViewer.ts` |
| `chatModelPicker.ts` | root | `pickers/chatModelPicker.ts` |
| `chatModePicker.ts` | root | `pickers/chatModePicker.ts` |
| `chatToolPicker.ts` | root | `pickers/chatToolPicker.ts` |
| `chatWidget.ts` | root | `widgets/chatWidget.ts` |
| `chatView.ts` | root | `widgets/chatView.ts` |
| `chatHeaderPart.ts` | root | `widgets/chatHeaderPart.ts` |
| `chatSessionSidebar.ts` | root | `widgets/chatSessionSidebar.ts` |
| `chatTokenStatusBar.ts` | root | `widgets/chatTokenStatusBar.ts` |
| `chatSystemPrompts.ts` | root | `config/chatSystemPrompts.ts` |
| `chatModeCapabilities.ts` | root | `config/chatModeCapabilities.ts` |
| `chatSlashCommands.ts` | root | `config/chatSlashCommands.ts` |
| `chatMentionResolver.ts` | root | `utilities/chatMentionResolver.ts` |
| `userCommandLoader.ts` | root | `utilities/userCommandLoader.ts` |

**CSS moves:** Co-located CSS moves with its `.ts` file.

**Strategy:**
1. Create folders: `data/`, `config/`, `input/`, `rendering/`, `pickers/`, `widgets/`, `utilities/`
2. Move files one folder at a time (start with leaves: `config/`, `rendering/`, `pickers/`)
3. Update all import paths in moved files AND in files that import them
4. Run `tsc --noEmit` after each folder migration
5. **Critical:** Update `main.ts` imports, `chatWidget.ts` imports, `chatInputPart.ts` imports

**Validation:**
- `tsc --noEmit` passes
- All tests pass
- Root directory has ≤ 5 .ts files: `main.ts`, `chatTypes.ts`, `chatIcons.ts`, + manifest/CSS
- Each sub-folder's files only import from allowed sources per the gate rules table

### Phase 5: Split `builtInTools.ts` into Per-Domain Files

**Goal:** Break the 1,086-line monolith into focused files by domain.

**Split plan:**

| New File | Tools | Lines (approx) |
|----------|-------|-----------------|
| `tools/pageTools.ts` | `search_workspace`, `read_page`, `read_page_by_title`, `read_current_page`, `list_pages`, `get_page_properties`, `create_page` | ~300 |
| `tools/fileTools.ts` | `list_files`, `read_file`, `search_files`, `search_knowledge` | ~250 |
| `tools/writeTools.ts` | `write_file`, `edit_file`, `delete_file` | ~200 |
| `tools/terminalTools.ts` | `run_command` + blocklist | ~100 |
| `tools/builtInTools.ts` | `registerBuiltInTools()` orchestrator + `extractTextContent()` shared helper | ~100 |

**Strategy:**
1. Create `pageTools.ts` — move page-related tool registration functions
2. Create `fileTools.ts` — move file-related tool registration functions
3. Create `writeTools.ts` — move write/edit/delete tool registration functions
4. Create `terminalTools.ts` — move run_command + blocklist
5. Update `builtInTools.ts` to import from per-domain files and call each domain's registration
6. Shared interfaces already live in `chatTypes.ts` (from Phase 1)
7. Shared utilities (`extractTextContent`, `extractSnippet`, etc.) stay in `builtInTools.ts`

**Validation:**
- `tsc --noEmit` passes
- All tests pass
- `builtInTools.ts` ≤ 150 lines
- Each tool file imports only from `../chatTypes.js` (via `chatTypes.ts` type hub)

### Phase 6: Add Chat Gate Compliance Test

**Goal:** Automated guardrail — if someone adds a cross-folder import, the test fails.

**File:** `tests/unit/chatGateCompliance.test.ts`

**What it tests:**

1. **Type hub purity:** `chatTypes.ts` has zero intra-chat imports
2. **Icon leaf purity:** `chatIcons.ts` has zero intra-chat imports
3. **Data service isolation:** `data/chatDataService.ts` imports only from `chatTypes.ts` within chat
4. **Folder gate rules:** Each file in `input/`, `rendering/`, `pickers/`, `config/` imports only from `chatTypes.ts` and `chatIcons.ts` within chat (never from sibling folders)
5. **Widget assembly rule:** `widgets/*` may import from `chatTypes.ts`, `chatIcons.ts`, `input/*`, `rendering/*`, `pickers/*` — but NOT from `data/`, `participants/`, `tools/`, `config/`
6. **Participant isolation:** `participants/*` imports from `chatTypes.ts` and `config/*` only
7. **Tool isolation:** `tools/*` imports from `chatTypes.ts` only
8. **No circular dependencies:** Import graph is acyclic
9. **Root file count:** ≤ 5 `.ts` files at chat root

**Pattern:** Follows the exact same structure as the existing `gateCompliance.test.ts` — file scanning, regex-based import extraction, allowlist matching.

**Validation:**
- The compliance test itself passes
- All other tests still pass
- Running `npx vitest run tests/unit/chatGateCompliance.test.ts` produces a clean report

---

## Task Tracker

### Phase 1: Create `chatTypes.ts`

| # | Task | Status |
|---|------|--------|
| 1.1 | Create `chatTypes.ts` skeleton with section headers | ⬜ |
| 1.2 | Move service interfaces (`IDefaultParticipantServices`, `IChatWidgetServices`, etc.) | ⬜ |
| 1.3 | Move tool interfaces (`IBuiltInTool*` family) | ⬜ |
| 1.4 | Move picker/UI interfaces (`IModelPickerServices`, `IModePickerServices`, etc.) | ⬜ |
| 1.5 | Move utility interfaces (`IChatParsedRequest`, `IUserCommandFileSystem`, etc.) | ⬜ |
| 1.6 | Move shared types (`ParallxApi`, `CurrentPageIdGetter`, `IChatModeCapabilities`) | ⬜ |
| 1.7 | Update all import paths across 30 files | ⬜ |
| 1.8 | Verify: `tsc --noEmit` clean, all tests pass, grep confirms no duplicate interfaces | ⬜ |

### Phase 2: Extract `ChatDataService`

| # | Task | Status |
|---|------|--------|
| 2.1 | Create `data/chatDataService.ts` class skeleton with constructor | ⬜ |
| 2.2 | Move participant query closures (lines 263–510): page count, titles, model, tools, retrieval | ⬜ |
| 2.3 | Move participant query closures (lines 510–700): memory, preferences, prompt overlay, FS ops | ⬜ |
| 2.4 | Move workspace digest builder (lines 700–840): cache + compute | ⬜ |
| 2.5 | Move widget services bridge (lines 1100–1225) | ⬜ |
| 2.6 | Move workspace/canvas participant bridges (lines 846–960) | ⬜ |
| 2.7 | Move helpers: `extractCanvasPageId`, `extractBlockPreview`, `walkContentNode`, `buildFileSystemAccessor` | ⬜ |
| 2.8 | Write `tests/unit/chatDataService.test.ts` — cover all public methods | ⬜ |
| 2.9 | Verify: `tsc --noEmit` clean, all tests pass, `chatTool.ts` reduced by ~800 lines | ⬜ |

### Phase 3: Slim `chatTool.ts` → `main.ts`

| # | Task | Status |
|---|------|--------|
| 3.1 | Rename `chatTool.ts` → `main.ts`, update all external references | ⬜ |
| 3.2 | Replace inline closures with `dataService.buildXxxServices()` calls | ⬜ |
| 3.3 | Break `chatTool ↔ chatView` circular dependency | ⬜ |
| 3.4 | Verify: `main.ts` ≤ 250 lines, `tsc --noEmit` clean, all tests pass | ⬜ |

### Phase 4: Create Sub-Folders

| # | Task | Status |
|---|------|--------|
| 4.1 | Create `config/` — move `chatSystemPrompts.ts`, `chatModeCapabilities.ts`, `chatSlashCommands.ts` | ⬜ |
| 4.2 | Create `input/` — move 5 input files + CSS | ⬜ |
| 4.3 | Create `rendering/` — move 4 rendering files | ⬜ |
| 4.4 | Create `pickers/` — move 3 picker files | ⬜ |
| 4.5 | Create `widgets/` — move 5 widget files + CSS | ⬜ |
| 4.6 | Create `utilities/` — move 2 utility files | ⬜ |
| 4.7 | Update ALL import paths (main.ts, chatWidget.ts, chatInputPart.ts, defaultParticipant.ts, etc.) | ⬜ |
| 4.8 | Verify: `tsc --noEmit` clean, all tests pass, root has ≤ 5 .ts files | ⬜ |

### Phase 5: Split `builtInTools.ts`

| # | Task | Status |
|---|------|--------|
| 5.1 | Create `tools/pageTools.ts` — extract 7 page tools | ⬜ |
| 5.2 | Create `tools/fileTools.ts` — extract 4 file tools | ⬜ |
| 5.3 | Create `tools/writeTools.ts` — extract 3 write tools | ⬜ |
| 5.4 | Create `tools/terminalTools.ts` — extract 1 terminal tool + blocklist | ⬜ |
| 5.5 | Slim `builtInTools.ts` to orchestrator + shared helpers | ⬜ |
| 5.6 | Verify: `tsc --noEmit` clean, all tests pass, `builtInTools.ts` ≤ 150 lines | ⬜ |

### Phase 6: Chat Gate Compliance Test

| # | Task | Status |
|---|------|--------|
| 6.1 | Create `tests/unit/chatGateCompliance.test.ts` scaffold | ⬜ |
| 6.2 | Implement type hub + icon leaf purity checks | ⬜ |
| 6.3 | Implement folder gate rule checks (input, rendering, pickers, config, widgets) | ⬜ |
| 6.4 | Implement participant + tool isolation checks | ⬜ |
| 6.5 | Implement data service isolation check | ⬜ |
| 6.6 | Implement no-circular-dependency check | ⬜ |
| 6.7 | Implement root file count check (≤ 5) | ⬜ |
| 6.8 | Verify: compliance test passes, all other tests pass | ⬜ |

**Total: 37 tasks across 6 phases**

---

## Acceptance Criteria

### Per-Phase Gates

| Phase | Gate Criteria | Metric |
|-------|-------------|--------|
| **Phase 1** | All interfaces live in `chatTypes.ts`; no duplicates | `grep -r "export interface I" src/built-in/chat/` shows only `chatTypes.ts` |
| **Phase 2** | `ChatDataService` is a proper class; zero anonymous DB closures in entry point | `chatDataService.test.ts` covers all public methods |
| **Phase 3** | Entry point ≤ 250 lines; zero circular deps | `main.ts` line count; import cycle analysis |
| **Phase 4** | Root ≤ 5 .ts files; all files in correct folders | `ls src/built-in/chat/*.ts \| wc -l` |
| **Phase 5** | `builtInTools.ts` ≤ 150 lines; tools split by domain | Per-file line counts |
| **Phase 6** | Compliance test green; catches intentional violations | `npx vitest run tests/unit/chatGateCompliance.test.ts` |

### Overall Acceptance

- [ ] `npx tsc --noEmit` — zero errors
- [ ] `npx vitest run` — all tests pass (1296+ baseline)
- [ ] `npx vitest run tests/unit/chatGateCompliance.test.ts` — all green
- [ ] No circular dependencies in chat import graph
- [ ] Root has ≤ 5 `.ts` files: `main.ts`, `chatTypes.ts`, `chatIcons.ts`
- [ ] `chatTool.ts` no longer exists (renamed to `main.ts`)
- [ ] `ChatDataService` has unit tests for every public method
- [ ] ARCHITECTURE.md updated with chat gate architecture documentation
- [ ] Every file's import list matches the gate rules table

---

## Migration Safety Rules

These rules ensure zero regressions during the restructuring:

### Rule 1: One Phase at a Time

Complete and validate each phase before starting the next. Never have two phases in-flight simultaneously. Each phase must end with:
- `tsc --noEmit` clean
- All tests pass
- Git commit with descriptive message

### Rule 2: Move, Don't Rewrite

Phases 1–5 are **pure refactoring** — moving code between files and adjusting imports. No behavioral changes. No new features. No bug fixes. If you discover a bug during migration, note it and fix it in a separate commit.

### Rule 3: Re-export for Backward Compatibility

When moving an interface from file A to `chatTypes.ts`, temporarily add a re-export in file A:
```typescript
// In the original file — remove after all consumers are updated
export type { IFoo } from './chatTypes.js';
```
This prevents breaking external consumers during transition. Remove re-exports once all imports are updated.

### Rule 4: Test After Every File Move

After moving each file:
1. `tsc --noEmit` — catches any broken import paths
2. `npx vitest run` — catches any runtime breakage
If either fails, fix before proceeding.

### Rule 5: Commit Per Sub-Task

Each numbered task in the tracker gets its own commit. This provides fine-grained rollback points if something goes wrong.

### Rule 6: No Functional Changes

The app must behave identically before and after M13. Same features, same UI, same behavior. The only user-visible change is the file structure. If a test breaks, the migration is wrong — never adjust tests to match a migration error.
