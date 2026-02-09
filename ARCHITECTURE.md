# Parallx – Architecture

> This document defines the responsibility of each module and the allowed dependencies between them.
> Circular dependencies are **explicitly forbidden**.

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

---

## Dependency Rules

### Dependency Matrix

| Module ↓ may depend on → | platform | services | workbench | layout | parts | views | editor | workspace | commands | context | dnd |
|--------------------------|:--------:|:--------:|:---------:|:------:|:-----:|:-----:|:------:|:---------:|:--------:|:-------:|:---:|
| **platform**             |    —     |    ✗     |     ✗     |   ✗    |   ✗   |   ✗   |   ✗    |     ✗     |    ✗     |    ✗    |  ✗  |
| **services**             |    ✓     |    —     |     ✗     |   ✓    |   ✓   |   ✓   |   ✓    |     ✓     |    ✓     |    ✓    |  ✓  |
| **workbench**            |    ✓     |    ✓     |     —     |   ✓    |   ✓   |   ✓   |   ✓    |     ✓     |    ✓     |    ✓    |  ✓  |
| **layout**               |    ✓     |    ✗     |     ✗     |   —    |   ✗   |   ✗   |   ✗    |     ✗     |    ✗     |    ✗    |  ✗  |
| **parts**                |    ✓     |    ✓*    |     ✗     |   ✓    |   —   |   ✗   |   ✗    |     ✗     |    ✗     |    ✗    |  ✗  |
| **views**                |    ✓     |    ✓*    |     ✗     |   ✓    |   ✗   |   —   |   ✗    |     ✗     |    ✗     |    ✗    |  ✗  |
| **editor**               |    ✓     |    ✓*    |     ✗     |   ✓    |   ✗   |   ✓   |   —    |     ✗     |    ✗     |    ✗    |  ✗  |
| **workspace**            |    ✓     |    ✓*    |     ✗     |   ✗    |   ✗   |   ✗   |   ✗    |     —     |    ✗     |    ✗    |  ✗  |
| **commands**             |    ✓     |    ✓*    |     ✗     |   ✗    |   ✗   |   ✗   |   ✗    |     ✗     |    —     |    ✓    |  ✗  |
| **context**              |    ✓     |    ✓*    |     ✗     |   ✗    |   ✗   |   ✗   |   ✗    |     ✗     |    ✗     |    —    |  ✗  |
| **dnd**                  |    ✓     |    ✓*    |     ✗     |   ✓    |   ✗   |   ✓   |   ✗    |     ✗     |    ✗     |    ✗    |  —  |

> `✓*` = May depend on service **interfaces** only (from `services/serviceTypes.ts`), never on concrete implementations.

### Rules in Plain Language

1. **`platform` depends on nothing.** It is the foundational layer.
2. **`layout` depends only on `platform`.** Grid and layout logic is self-contained.
3. **`parts` depend on `platform`, `layout`, and service interfaces.** Parts integrate with the grid but don't know about views or editors.
4. **`views` depend on `platform`, `layout`, and service interfaces.** Views participate in layout but don't know about parts or editors.
5. **`editor` depends on `platform`, `layout`, `views`, and service interfaces.** Editors extend view concepts but don't depend on parts directly.
6. **`workspace` depends on `platform` and service interfaces.** Workspace is a pure data/persistence concern.
7. **`commands` depend on `platform`, `context`, and service interfaces.** Commands evaluate context and call services.
8. **`context` depends on `platform` and service interfaces.** Context is a data tracking layer.
9. **`dnd` depends on `platform`, `layout`, `views`, and service interfaces.** DnD coordinates view movement through layout.
10. **`services` depend on `platform` and may import from any module** to provide concrete implementations behind interfaces.
11. **`workbench` is the composition root.** It may depend on everything to wire the system together.

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
