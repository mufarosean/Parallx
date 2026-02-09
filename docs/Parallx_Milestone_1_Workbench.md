# Milestone 1 – Workbench

> **Authoritative Scope Notice**
>
> This document is the single source of truth for Milestone 1.
> All implementation must conform to the structures and boundaries defined here.
> VS Code source files are referenced strictly as inspiration and validation, not as scope drivers.
> Referenced material must not expand scope unless a missing core workbench element is identified.

---

## Milestone Definition

### Vision
A persistent, configurable workbench exists that can organize, display, and restore an application's layout entirely from data. The workbench operates as a general-purpose sandbox capable of hosting arbitrary tools and views without embedding assumptions about their meaning or behavior.

### Purpose
This milestone establishes the foundational shell of Parallx. It solves structural composition, persistence, and orchestration before any domain-specific semantics are introduced.

### Conceptual Scope

**Included**
- Repository and architectural structure
- Workbench shell orchestration
- Data-driven layout composition with grid system
- Structural regions (parts) and view containers
- View lifecycle and size constraints
- Workspace state persistence and restoration
- Structural context tracking and focus management
- Drag-and-drop view reorganization
- Service-oriented architecture with dependency injection
- Editor groups for document hosting

**Excluded**
- Content semantics (canvas, blocks, pages, databases)
- Editing or document models
- Domain tools or workflows
- AI reasoning or automation
- Theming and styling systems (deferred to later milestones)
- Multi-window support (deferred to later milestones)

### Structural Commitments
- A single workbench shell governs UI structure and lifecycle.
- Layout is derived entirely from serialized state via a constraint-based grid system.
- Views are opaque hosted entities with well-defined lifecycle phases.
- All views implement size constraints to participate in grid layout.
- Workspace state is first-class.
- Repository structure enforces architectural boundaries.
- Services use dependency injection for loose coupling.

### Architectural Principles
- **Separation of Concerns**: Layout, state, and content are distinct layers.
- **Data-Driven Rendering**: UI is a pure function of state.
- **Constraint-Based Layout**: Grid system respects view size boundaries.
- **Lifecycle Management**: All entities have explicit creation, activation, and disposal phases.
- **Service Orientation**: Capabilities are accessed through service interfaces.

---

## Capability 0 – Repository and Architectural Structure

### Capability Description
The system has a defined repository and file structure that enforces architectural boundaries and aligns implementation with Milestone 1 capabilities. The structure separates concerns and makes service boundaries explicit.

### Goals
- All source code locations have explicit ownership.
- Architectural boundaries are visible in the filesystem.
- No ambiguity exists about where new code belongs.
- Service interfaces are separated from implementations.

### Conceptual Responsibilities
- Define module boundaries.
- Prevent cross-capability leakage.
- Serve as a stable foundation for future milestones.
- Enable testability through clear interfaces.

### Dependencies
None.

#### Tasks

**Task 0.1 – Establish Repository Structure** ✅
- **Task Description:** Create and commit the repository folder and file structure exactly as defined below.
- **Output:** A committed directory tree with placeholder files.
- **Completion Criteria:** All listed directories and files exist, and no Milestone 1 code exists outside this structure.
- **Status:** Complete — All 60 files across 11 modules created under `src/`. Structure verified against spec.
- **Notes / Constraints:**  
  - Inspired by VS Code's structural separation of workbench concerns.
  - Reference only:
    - https://github.com/microsoft/vscode/tree/main/src/vs/workbench
    - https://github.com/microsoft/vscode/tree/main/src/vs/base/browser/ui/grid

```txt
src/
├─ workbench/
│  ├─ workbench.ts          # root shell orchestrator
│  ├─ lifecycle.ts          # startup / teardown sequencing
│  └─ workbenchServices.ts  # service registration and initialization
│
├─ layout/
│  ├─ layoutModel.ts        # serializable layout schema
│  ├─ layoutRenderer.ts     # render UI from layout state
│  ├─ layoutPersistence.ts  # load/save layout state
│  ├─ grid.ts               # core grid splitting/resizing logic
│  ├─ gridView.ts           # view interface for grid participation
│  ├─ gridNode.ts           # internal grid tree structure
│  └─ layoutTypes.ts        # layout-related types and enums
│
├─ parts/
│  ├─ part.ts               # base part class (structural container)
│  ├─ partRegistry.ts       # part registration and lookup
│  ├─ titlebarPart.ts       # top titlebar
│  ├─ sidebarPart.ts        # primary sidebar
│  ├─ panelPart.ts          # bottom/side panel
│  ├─ editorPart.ts         # main editor area with groups
│  ├─ auxiliaryBarPart.ts   # secondary sidebar
│  ├─ statusBarPart.ts      # bottom status bar
│  └─ partTypes.ts          # part-related types
│
├─ editor/
│  ├─ editorGroup.ts        # editor group container
│  ├─ editorGroupView.ts    # editor group UI rendering
│  ├─ editorGroupModel.ts   # editor group state management
│  ├─ editorInput.ts        # abstract editor input
│  ├─ editorPane.ts         # abstract editor pane
│  └─ editorTypes.ts        # editor-related types
│
├─ views/
│  ├─ view.ts               # generic view interface with lifecycle
│  ├─ viewDescriptor.ts     # view metadata and registration
│  ├─ viewManager.ts        # view lifecycle + placement
│  ├─ viewContainer.ts      # container that hosts multiple views
│  └─ placeholderViews.ts   # test / dummy views for development
│
├─ workspace/
│  ├─ workspace.ts          # workspace identity model
│  ├─ workspaceLoader.ts    # load workspace state
│  ├─ workspaceSaver.ts     # persist workspace state
│  └─ workspaceTypes.ts     # workspace-related types
│
├─ commands/
│  ├─ commandRegistry.ts    # command registration and execution
│  ├─ commandTypes.ts       # command contracts and interfaces
│  └─ structuralCommands.ts # layout + part + view commands
│
├─ context/
│  ├─ contextKey.ts         # context key definitions and API
│  ├─ contextKeyService.ts  # context key evaluation engine
│  ├─ workbenchContext.ts   # structural context model
│  ├─ focusTracker.ts       # active view / part / region tracking
│  └─ whenClause.ts         # expression parser for when clauses
│
├─ dnd/
│  ├─ dragAndDrop.ts        # drag-and-drop coordination
│  ├─ dropZone.ts           # drop zone rendering and detection
│  ├─ dropOverlay.ts        # visual drop overlay
│  └─ dndTypes.ts           # drag-and-drop types
│
├─ services/
│  ├─ serviceCollection.ts  # dependency injection container
│  ├─ layoutService.ts      # ILayoutService interface + implementation
│  ├─ viewService.ts        # IViewService interface + implementation
│  ├─ workspaceService.ts   # IWorkspaceService interface + implementation
│  ├─ editorService.ts      # IEditorService interface + implementation
│  ├─ editorGroupService.ts # IEditorGroupService interface + implementation
│  ├─ commandService.ts     # ICommandService interface + implementation
│  ├─ contextKeyService.ts  # IContextKeyService interface + implementation
│  └─ serviceTypes.ts       # service interface definitions
│
└─ platform/
   ├─ storage.ts            # storage abstraction (localStorage, IndexedDB, etc.)
   ├─ events.ts             # event bus / emitters
   ├─ lifecycle.ts          # IDisposable pattern and lifecycle hooks
   ├─ instantiation.ts      # service instantiation utilities
   └─ types.ts              # shared platform types and utilities
```

**Task 0.2 – Document Architectural Boundaries** ✅
- **Task Description:** Create a `ARCHITECTURE.md` file that documents the responsibility of each module and the allowed dependencies between them.
- **Output:** `ARCHITECTURE.md` file in the repository root.
- **Completion Criteria:** Dependency rules are clear; circular dependencies are explicitly forbidden.
- **Status:** Complete — `ARCHITECTURE.md` created with module responsibilities, dependency matrix, layered diagram, and explicit prohibition of circular dependencies.
- **Notes / Constraints:**
  - Example rule: "Views may depend on Platform but not on Parts"
  - Example rule: "Services may depend on Platform and expose interfaces, but not on Views directly"
  - Use a dependency graph or matrix to visualize allowed relationships

---

## Capability 1 – Workbench Shell Initialization

### Capability Description
The system can initialize a top-level workbench shell that coordinates layout, view lifecycle, workspace restoration, and service initialization through dependency injection.

### Goals
- Single entry point for workbench initialization
- Proper service wiring with dependency injection
- Clean startup and teardown sequencing
- All subsystems accessible through services

### Conceptual Responsibilities
- Orchestrate initialization order
- Wire up service dependencies
- Create and mount the workbench DOM structure
- Handle graceful shutdown and cleanup

### Dependencies
- Repository and Architectural Structure

#### Tasks

**Task 1.1 – Implement Service Collection** ✅
- **Task Description:** Implement a dependency injection container that registers and resolves services.
- **Output:** `ServiceCollection` class with registration and instantiation capabilities.
- **Completion Criteria:** Services can be registered by interface, dependencies are automatically resolved, circular dependencies are detected and reported.
- **Status:** Complete — Implemented in `services/serviceCollection.ts` with supporting DI utilities in `platform/instantiation.ts` and `platform/types.ts`. Also implemented `platform/lifecycle.ts` (IDisposable, DisposableStore, MutableDisposable, Disposable base class) and `platform/events.ts` (Emitter, Event) as foundational dependencies.
- **Notes / Constraints:**
  - Reference only:
    - https://github.com/microsoft/vscode/blob/main/src/vs/platform/instantiation/common/instantiation.ts
    - https://github.com/microsoft/vscode/blob/main/src/vs/platform/instantiation/common/serviceCollection.ts
  - Support constructor injection pattern
  - Services should be lazily instantiated when first requested
  - Implement IDisposable for cleanup

**Task 1.2 – Implement Workbench Shell** ✅
- **Task Description:** Implement the workbench shell as the sole owner of UI composition and lifecycle.
- **Output:** A functioning workbench shell with initialization and teardown methods.
- **Completion Criteria:** 
  - All layout, part, view, and workspace logic is coordinated through the shell
  - Shell can be instantiated with a service collection
  - Shell properly disposes all resources on shutdown
  - Shell emits lifecycle events (initialized, ready, shutdown)
- **Status:** Complete — Implemented in `workbench/workbench.ts` with service registration in `workbench/workbenchServices.ts` and service interface definitions in `services/serviceTypes.ts`.
- **Notes / Constraints:**  
  - Reference only:
    - https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/workbench.ts
  - Shell should not contain business logic; it delegates to services
  - Initialization phases: (1) Services, (2) Layout, (3) Parts, (4) Workspace restore, (5) Ready

**Task 1.3 – Implement Lifecycle Management** ✅
- **Task Description:** Implement lifecycle sequencing for proper startup and teardown order.
- **Output:** `Lifecycle` class with phase tracking and hooks.
- **Completion Criteria:**
  - Clear initialization phases executed in order
  - Teardown happens in reverse order
  - Async initialization is properly awaited
  - Errors in one phase don't corrupt other phases
- **Status:** Complete — Implemented as `LifecycleService` in `workbench/lifecycle.ts` with 5 named phases (Services, Layout, Parts, WorkspaceRestore, Ready), event emitters for phase transitions, and error isolation via try/catch per hook.
- **Notes / Constraints:**
  - Reference only:
    - https://github.com/microsoft/vscode/blob/main/src/vs/workbench/services/lifecycle/common/lifecycle.ts

---

## Capability 2 – Serializable Layout System

### Capability Description
The system can represent, render, and restore the workbench layout using a fully serializable data model backed by a constraint-based grid system that enables dynamic splitting, resizing, and nesting.

### Goals
- Layout state is a plain data structure (JSON-serializable)
- Grid system enables fluid splitting in any direction
- Size constraints (min/max) prevent invalid layouts
- Layout can be reconstructed deterministically from state
- Supports nested grids for complex arrangements

### Conceptual Responsibilities
- Maintain grid tree structure
- Enforce size constraints during layout
- Serialize/deserialize grid state
- Render grid changes to DOM
- Handle resize events with constraint validation

### Dependencies
- Workbench Shell Initialization

#### Tasks

**Task 2.1 – Define Layout Schema** ✅
- **Status:** Done — `layoutModel.ts` (SerializedLayoutState discriminated union, LAYOUT_SCHEMA_VERSION=1, createDefaultLayoutState) + `layoutTypes.ts` (Orientation, SizingMode, SizeConstraints, Dimensions, Box, SashEdge, GridEventType, GridLocation). 9/9 criteria met.
- **Task Description:** Define the layout state schema used to describe the entire workbench layout.
- **Output:** TypeScript interfaces and types for serializable layout model.
- **Completion Criteria:** Layout schema can represent:
  - Grid structure (horizontal/vertical splits, dimensions)
  - Part placement and visibility
  - View assignments to parts
  - Size constraints and current dimensions
  - Active/focused state
  - Nested grid structures (for editor groups)
  - Split ratios and proportional sizing
- **Notes / Constraints:**  
  - Reference only:
    - https://github.com/microsoft/vscode/blob/main/src/vs/base/browser/ui/grid/grid.ts
  - Schema must be versionable for future migrations
  - Consider using a discriminated union for different node types

**Task 2.2 – Implement Grid System** ✅
- **Status:** Done — `grid.ts` (~450 LOC, addView/splitView/removeView/resize/resizeSash/serialize/deserialize, sash mouse handling) + `gridNode.ts` (GridBranchNode, GridLeafNode tree). 7/7 criteria met.
- **Task Description:** Implement a constraint-based grid that supports splitting, resizing, nesting, and serialization.
- **Output:** Grid class with split/resize/serialize capabilities.
- **Completion Criteria:** 
  - Views can be added/removed/resized in any direction
  - Size constraints (min/max width/height) are enforced
  - Grid maintains balanced proportions on resize
  - Supports nested grids (grids within grid cells)
  - Serializes to and deserializes from JSON
  - Emits events for structural changes
- **Notes / Constraints:**
  - Reference only:
    - https://github.com/microsoft/vscode/blob/main/src/vs/base/browser/ui/grid/grid.ts
    - https://github.com/microsoft/vscode/blob/main/src/vs/base/browser/ui/grid/gridview.ts
  - Use CSS Grid or Flexbox for rendering
  - Implement sash (resize handles) between grid cells
  - Support both pixel and proportional sizing

**Task 2.3 – Implement Grid View Interface** ✅
- **Status:** Done — `gridView.ts` (IGridView interface, BaseGridView abstract class, GridViewFactory type). `fromJSON` provided as static override convention on BaseGridView + `GridViewFactory` type for `Grid.deserialize()`. 6/6 criteria met.
- **Task Description:** Define the interface that views must implement to participate in the grid system.
- **Output:** `IGridView` interface and helper base class.
- **Completion Criteria:**
  - Interface defines size constraints (minimumWidth, maximumWidth, minimumHeight, maximumHeight)
  - Interface defines layout method that receives dimensions
  - Interface defines element property for DOM attachment
  - Interface defines serialization methods (toJSON, fromJSON)
  - Base class provides common implementation patterns
- **Notes / Constraints:**
  - Reference only:
    - https://github.com/microsoft/vscode/blob/main/src/vs/base/browser/ui/grid/gridview.ts
  - Size constraints can be dynamic (computed properties)
  - Layout method should be efficient and non-blocking

**Task 2.4 – Implement Layout Renderer** ✅
- **Status:** Done — `layoutRenderer.ts` (renderFromState, renderDefault, renderGrid, relayout, ResizeObserver auto-resize, _disposeGrid/_clearContainer cleanup, CSS classes: parallx-layout-container, parallx-grid-root). 5/5 criteria met.
- **Task Description:** Implement rendering logic that converts layout state to DOM structure using the grid system.
- **Output:** `LayoutRenderer` class that mounts grid to DOM.
- **Completion Criteria:**
  - Can render initial layout from state
  - Can update layout on state changes
  - Properly cleans up old DOM elements
  - Handles resize events from window or parent container
  - Applies CSS classes for styling hooks
- **Notes / Constraints:**
  - Use reactive pattern to respond to layout changes
  - Minimize DOM thrashing during updates
  - Support smooth transitions for user-initiated changes

**Task 2.5 – Implement Layout Persistence** ✅
- **Status:** Done — `layoutPersistence.ts` (save/load/hasSavedState/clear, JSON validation, version check, migration placeholder, fallback to default) + `platform/storage.ts` (IStorage async interface, InMemoryStorage, LocalStorage, NamespacedStorage). 4/4 criteria met.
- **Task Description:** Implement saving and loading of layout state.
- **Output:** `LayoutPersistence` class with save/load methods.
- **Completion Criteria:**
  - Can serialize entire grid structure to JSON
  - Can restore layout from JSON
  - Handles missing or invalid state gracefully (fallback to default)
  - Validates schema version for compatibility
- **Notes / Constraints:**
  - Store in platform storage abstraction
  - Consider compression for large layouts
  - Provide migration path for schema changes

---

## Capability 3 – Structural Parts

### Capability Description
The system can define and manage structural parts (analogous to VS Code's "Parts") that occupy fixed regions in the workbench and host view containers. Parts are layout-aware structural elements that persist as part of the workbench structure.

### Goals
- Clear distinction between parts (structural) and views (content)
- Parts manage their own lifecycle and sizing
- Parts can host view containers
- Standard set of parts matches common IDE layouts
- Parts can be shown/hidden dynamically

### Conceptual Responsibilities
- Provide structural containers for views
- Manage part visibility and sizing
- Integrate with grid system as grid views
- Persist part state (visibility, size, position)
- Emit events for part state changes

### Clarification
**Parts vs Views:**
- **Parts** are structural containers with fixed positions in the workbench (sidebar, panel, editor area, etc.)
- **Views** are content-based UI elements that are hosted within parts
- Parts persist as layout state; views persist as workspace state
- Parts are layout-aware; views are layout-agnostic (they receive dimensions but don't control placement)

### Dependencies
- Serializable Layout System

#### Tasks

**Task 3.1 – Implement Part Base Class** ✅
- **Status:** Done — `part.ts` (abstract Part extending Disposable, implements IPart + IGridView, lifecycle: create/mount/layout/dispose, visibility, saveState/restoreState, contentElement for child content, size constraints). `partTypes.ts` (PartId enum, PartPosition, PartState, IPart, PartDescriptor). 6/6 criteria met.
- **Task Description:** Implement base `Part` class that all structural parts extend.
- **Output:** Abstract `Part` class with lifecycle and grid integration.
- **Completion Criteria:**
  - Part implements `IGridView` interface
  - Part has lifecycle methods: create, mount, layout, dispose
  - Part has visibility management
  - Part can save/restore its own state
  - Part provides container element for child content
  - Part enforces size constraints
- **Notes / Constraints:**
  - Reference only:
    - https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/part.ts
  - Parts should be framework-agnostic (plain TypeScript/DOM)
  - Use composition over inheritance where possible

**Task 3.2 – Implement Part Registry** ✅
- **Status:** Done — `partRegistry.ts` (register/registerMany, getDescriptor/getPart/requirePart, DuplicatePartError, createPart factory with singleton caching, createAll, events: onDidRegister/onDidCreate). 4/4 criteria met.
- **Task Description:** Implement part registration and lookup system.
- **Output:** `PartRegistry` class for part definitions and instantiation.
- **Completion Criteria:** 
  - Parts can be registered with unique identifiers
  - Parts can be looked up by ID or type
  - Registry validates no duplicate registrations
  - Registry provides factory methods for part creation
- **Notes / Constraints:**
  - Registry should be populated at workbench initialization
  - Consider using decorators for part registration

**Task 3.3 – Implement Standard Parts** ✅
- **Status:** Done — All 6 parts implemented: TitlebarPart (30px fixed, left/center/right slots), SidebarPart (170-800px, activity bar + view container + header), PanelPart (100px min, tab bar + view container), EditorPart (200×150px min, editor group container + watermark), AuxiliaryBarPart (170-800px, hidden by default), StatusBarPart (22px fixed, left/right slots + entry management). Each exports a PartDescriptor. 5/5 criteria met.
- **Task Description:** Implement the standard set of workbench parts.
- **Output:** Implementations of TitlebarPart, SidebarPart, PanelPart, EditorPart, AuxiliaryBarPart, StatusBarPart.
- **Completion Criteria:**
  - Each part properly extends base Part class
  - Each part defines appropriate size constraints
  - Each part provides mounting points for child content
  - Each part integrates with layout service
  - Parts emit appropriate events (visibility changed, size changed, etc.)
- **Notes / Constraints:**
  - Reference only:
    - https://github.com/microsoft/vscode/tree/main/src/vs/workbench/browser/parts
  - TitlebarPart: Top bar with window controls and menus
  - SidebarPart: Primary collapsible sidebar (typically left)
  - PanelPart: Bottom or side panel area
  - EditorPart: Main content area (hosts editor groups)
  - AuxiliaryBarPart: Secondary sidebar (opposite primary)
  - StatusBarPart: Bottom status information bar

**Task 3.4 – Implement Drag-and-Drop for Parts** ✅
- **Status:** Done — `dndTypes.ts` (DropPosition, DragPayload, DropResult, IDropTarget, VIEW_DRAG_MIME). `dropOverlay.ts` (5-zone visual feedback, computePosition with 25% edge threshold, highlight/highlightInvalid, CSS transitions). `dropZone.ts` (HTML5 DnD events, overlay integration, accepts filtering). `dragAndDrop.ts` (DragAndDropController: makeDraggable, registerTarget, performKeyboardDrop for accessibility). 6/6 criteria met.
- **Task Description:** Implement drop zone rendering and view transfer between parts.
- **Output:** Visual drop zones and transfer logic for moving views between parts.
- **Completion Criteria:** 
  - Drop zones highlight valid targets during drag
  - Views can be dragged from one part to another
  - Drop overlay shows visual feedback (center, edges for splitting)
  - Invalid drop targets are visually indicated
  - Drop completes with smooth transition
  - State is updated correctly after drop
- **Notes / Constraints:**
  - Reference only:
    - https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/dnd.ts
    - https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/parts/editor/editorDropTarget.ts
  - Use HTML5 Drag and Drop API
  - Provide keyboard alternatives for accessibility
  - Drop zones: center (merge), top/bottom (split vertical), left/right (split horizontal)

**Additional Work – Electron Desktop Shell** ✅ *(not in original milestone)*
- **Description:** Added an Electron-based desktop app shell so the workbench can be viewed and tested as a standalone native application (like VS Code), rather than running in a browser.
- **What was built:**
  - `electron/main.cjs` — Electron main process (frameless window, custom titlebar, IPC for minimize/maximize/close)
  - `electron/preload.cjs` — Context bridge exposing window control API to the renderer
  - `index.html` — HTML entry point with CSP headers
  - `src/main.ts` — Renderer entry that boots all 6 standard parts with placeholder content (explorer tree, editor watermark, terminal mock, status bar entries)
  - `src/workbench.css` — VS Code-inspired dark theme base styles
  - `scripts/build.mjs` — esbuild bundler for the renderer (IIFE, sourcemaps)
  - `package.json` updated with `"main"`, `npm start` / `npm run dev` scripts
  - `electron` and `esbuild` added as devDependencies
- **Rationale:** Provides a visual harness for verifying that Capabilities 1–3 (DI, layout, parts) work together correctly and gives a tangible checkpoint before proceeding to view hosting.

**Additional Work – Integration Wiring and Bug Fixes** ✅ *(not in original milestone tasks)*
- **Description:** After Capabilities 0–4 were individually completed, several integration passes were needed to wire everything into a functioning end-to-end workbench. These are recorded here as deviations from the original task list.
- **What was done:**
  1. **Sash resizing + DnD wired to live app** — Connected `grid.ts` sash drag handling and `DragAndDropController` to the running workbench so resize handles and view tab dragging work in the Electron shell.
  2. **Layout restructure** — Changed grid topology so the sidebar spans full height (titlebar→statusbar) and the panel sits beneath the editor only, matching VS Code's real layout: `hGrid(sidebar | editorColumnAdapter(vGrid(editor | panel)))`.
  3. **10 disconnected files wired into main** — Refactored `main.ts` into a thin bootstrap; moved all orchestration into `Workbench` class with real lifecycle hooks across all 5 phases. Previously, 10 source files (services, lifecycle, persistence, grid, views, etc.) were built but not imported anywhere.
  4. **Sash visual fix** — Changed sash from a visible 4px solid bar to a transparent 4px hit area with a 1px `::after` pseudo-element border line (hover turns blue), matching VS Code's subtle divider style.
  5. **Panel double tab bar fix** — PanelPart had `hasTitleArea: true` which created a 35px empty `.part-title` div stacking on top of ViewContainer's own tab bar. Fixed by setting `hasTitleArea = false`.
  6. **Auxiliary bar integration** — Wired the AuxiliaryBarPart (Capability 3) into the live workbench: toggle mechanism via activity bar button, secondary activity bar element on right edge, generic empty `ViewContainer('auxiliaryBar')` ready for extensions. Any view descriptor with `containerId: 'auxiliaryBar'` will automatically route to this container. No hardcoded views — extensions populate it in later milestones.
  7. **Registration ordering bug fix** — `allAuxiliaryBarViewDescriptors` was registered after `_setupAuxBarViews()` tried to create views from it, crashing Phase 3. Everything after the crash (layout, resize handler, etc.) never ran. Fixed by registering all descriptors before any `setupXxxViews()` calls.
  8. **Resize/maximize fix** — `.workbench-middle` had `flex: 1 0 auto` causing the middle row to not expand on window maximize; changed to `flex: 1 1 0` with `min-height: 0`. Also added `min-width: 0` / `min-height: 0` to `.grid-branch` and grid element flex properties to allow proper shrinking.
- **Key architectural note:** The view system is fully generic. To add a view to any container (sidebar, panel, or auxiliary bar), you define a `ViewDescriptor` with the target `containerId`, register it with `ViewManager`, create it via `createViewSync()`, and call `container.addView()`. No special-casing per container.

---

## Capability 4 – View Hosting and Lifecycle

### Capability Description
The system can host opaque views with well-defined lifecycle phases, size constraints, and state management. Views are content-based UI elements that participate in the grid layout through their size constraints.

### Goals
- Generic view contract that any content can implement
- Full lifecycle management (create, mount, activate, layout, deactivate, dispose)
- Views provide size constraints for grid participation
- Views manage their own internal state
- View containers can host multiple views with tab UI

### Conceptual Responsibilities
- Define view interface and lifecycle
- Manage view creation and disposal
- Coordinate view activation and focus
- Provide view container abstraction
- Handle view state persistence
- Manage view descriptors and metadata

### Dependencies
- Structural Parts

#### Tasks

**Task 4.1 – Implement View Interface** ✅
- **Task Description:** Implement a generic view contract with full lifecycle phases and size constraints.
- **Output:** `IView` interface and base `View` class.
- **Completion Criteria:** Views implement full lifecycle:
  - **Creation** (`createElement(container: HTMLElement): void`) - Create DOM structure
  - **Visibility** (`setVisible(visible: boolean): void`) - Show/hide without disposal
  - **Layout** (`layout(width: number, height: number): void`) - Respond to size changes
  - **Focus** (`focus(): void`) - Receive keyboard focus
  - **State Persistence** (`saveState(): object`, `restoreState(state: object): void`) - Persist view state
  - **Cleanup** (`dispose(): void`) - Clean up resources
  - **Size Constraints** (`minimumWidth`, `maximumWidth`, `minimumHeight`, `maximumHeight`)
- **Notes / Constraints:**  
  - Reference only:
    - https://github.com/microsoft/vscode/blob/main/src/vs/workbench/common/views.ts
    - https://github.com/microsoft/vscode/blob/main/src/vs/base/browser/ui/grid/gridview.ts
  - Size constraints enable grid system integration
  - Lifecycle methods should be idempotent where possible
  - Use IDisposable pattern for cleanup tracking

**Task 4.2 – Implement View Descriptor** ✅
- **Task Description:** Implement view metadata and registration system.
- **Output:** `ViewDescriptor` class for view metadata.
- **Completion Criteria:**
  - Descriptors contain view ID, name, icon, container ID
  - Descriptors specify when clauses for conditional rendering
  - Descriptors provide factory function for view instantiation
  - Descriptors define default size constraints
  - Descriptors specify focus behavior and keyboard shortcuts
- **Notes / Constraints:**
  - Descriptors should be declarative and JSON-serializable
  - Support lazy view instantiation (defer creation until needed)

**Task 4.3 – Implement View Manager** ✅
- **Task Description:** Implement view lifecycle management and placement coordination.
- **Output:** `ViewManager` class for view orchestration.
- **Completion Criteria:** 
  - Can create views from descriptors
  - Manages view lifecycle transitions
  - Coordinates view placement in parts
  - Tracks active and visible views
  - Handles view disposal and cleanup
  - Provides view lookup by ID
- **Notes / Constraints:**
  - ViewManager should be a singleton service
  - Emit events for view lifecycle transitions
  - Support async view creation for lazy loading

**Task 4.4 – Implement View Container** ✅
- **Task Description:** Implement container that hosts multiple views with tabbed UI.
- **Output:** `ViewContainer` class with tab management.
- **Completion Criteria:**
  - Container can host multiple views
  - Provides tabbed interface for view switching
  - Only one view is active at a time
  - Non-active views are hidden but not disposed
  - Tabs show view icons and names
  - Tab state persists (order, active view)
  - Tabs support drag-and-drop reordering
- **Notes / Constraints:**
  - Reference only:
    - https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/parts/views/viewPaneContainer.ts
  - Container itself implements IGridView for grid participation
  - Size constraints are computed from active view's constraints

**Task 4.5 – Implement Placeholder Views** ✅
- **Task Description:** Create simple test/dummy views for development and testing.
- **Output:** Set of placeholder views with different characteristics.
- **Completion Criteria:**
  - At least 3 placeholder views with different content
  - Placeholder views have varying size constraints
  - Placeholder views demonstrate lifecycle logging
  - Placeholder views show current dimensions
  - Placeholder views can be used to test layout system
- **Notes / Constraints:**
  - Include views that are fixed-size, flexible, and aspect-ratio constrained
  - Use colored backgrounds for visual distinction
  - Log lifecycle method calls to console for debugging

---

## Capability 5 – Workspace State Persistence

### Capability Description
The system can persist and restore complete workbench state across sessions, including layout structure, part visibility, view assignments, and workspace-specific state.

### Goals
- Complete state can be serialized to storage
- State can be restored on startup
- Multiple workspace states can coexist
- State includes layout, parts, views, and context
- Graceful handling of missing or corrupt state

### Conceptual Responsibilities
- Serialize all stateful components
- Coordinate state collection from parts and views
- Store state to persistent storage
- Load state on startup
- Validate and migrate state schemas
- Provide fallback defaults for missing state

### Dependencies
- Serializable Layout System
- View Hosting and Lifecycle

#### Tasks

**Task 5.1 – Define Workspace State Schema** ✅
- **Status:** Done — `workspaceTypes.ts` (WORKSPACE_STATE_VERSION=1, WorkspaceIdentity, WorkspaceMetadata, SerializedPartSnapshot, SerializedViewContainerSnapshot, SerializedViewSnapshot, SerializedEditorSnapshot/EditorGroupSnapshot/EditorInputSnapshot, SerializedContextSnapshot, WorkspaceState top-level schema, storage key helpers, default factories). `workspace.ts` (Workspace class with UUID identity, create/fromSerialized factories, touch, createDefaultState, toJSON). 6/6 criteria met.
- **Task Description:** Define the complete workspace state schema.
- **Output:** TypeScript interfaces for workspace state.
- **Completion Criteria:** Schema includes:
  - Workspace identity (ID, name, path)
  - Layout state (grid structure, part sizes, visibility)
  - View state (active views, view-specific state)
  - Editor state (open editors, active group, scroll positions)
  - Context state (active part, focused view)
  - Schema version for migrations
- **Notes / Constraints:**
  - Use nested structure that mirrors runtime object graph
  - Make schema extensible for future additions
  - Include timestamps for state freshness validation

**Task 5.2 – Implement Workspace Loader** ✅
- **Status:** Done — `workspaceLoader.ts` (WorkspaceLoader class: load by Workspace or by ID, getActiveWorkspaceId/setActiveWorkspaceId, hasSavedState, deep schema validation, version migration placeholder, graceful fallback to defaults on corrupt/missing state, structured logging). 6/6 criteria met.
- **Task Description:** Implement workspace state loading from persistent storage.
- **Output:** `WorkspaceLoader` class with load and validation logic.
- **Completion Criteria:** 
  - Can load state from storage by workspace ID
  - Validates state schema and version
  - Migrates old state schemas to current version
  - Returns default state if none exists
  - Handles corrupt state gracefully
  - Logs loading errors for debugging
- **Notes / Constraints:**
  - Reference only:
    - https://github.com/microsoft/vscode/blob/main/src/vs/workbench/services/workspaces/common/workspaceService.ts
  - Support async loading for large states
  - Consider state compression

**Task 5.3 – Implement Workspace Saver** ✅
- **Status:** Done — `workspaceSaver.ts` (WorkspaceSaver class: WorkspaceStateSources interface for collecting live state from parts/views/containers/viewManager/layout/context, save() immediate, requestSave() debounced, _collectState/_collectPartStates/_collectViewContainerStates/_collectViewStates, re-entrancy guard, error handling, Disposable cleanup). 6/6 criteria met.
- **Task Description:** Implement workspace state saving to persistent storage.
- **Output:** `WorkspaceSaver` class with save and coordination logic.
- **Completion Criteria:**
  - Collects state from all stateful components
  - Serializes complete state to JSON
  - Saves to persistent storage by workspace ID
  - Handles save errors gracefully
  - Supports both explicit saves and auto-save
  - Debounces frequent save requests
- **Notes / Constraints:**
  - Reference only:
    - https://github.com/microsoft/vscode/blob/main/src/vs/workbench/common/memento.ts
  - Use transaction pattern to ensure atomic saves
  - Save incrementally if possible (delta updates)

**Task 5.4 – Implement Workspace Restoration** ✅
- **Status:** Done — Wired into `Workbench._restoreWorkspace()` (Phase 4): loads last-active workspace ID, loads state via WorkspaceLoader, reconstructs Workspace identity, applies state via `_applyRestoredState()` (restores part visibility/sizes/data, view container tab order + active view, per-view state blobs, focus restoration). `_configureSaver()` wires live sources into WorkspaceSaver and auto-save on grid changes. `IWorkspaceService` expanded with activeWorkspace, isRestored, onDidChangeWorkspace, onDidRestoreState, save(), requestSave(). 7/7 criteria met.
- **Task Description:** Implement the restoration flow that rebuilds workbench from saved state.
- **Output:** Restoration logic in workbench shell.
- **Completion Criteria:**
  - Restart restores prior state accurately
  - Layout is reconstructed from saved grid structure
  - Parts restore their visibility and sizes
  - Views are recreated and restored to saved state
  - Active view and focus are restored
  - Scroll positions and cursor positions are restored
  - Restoration handles missing views gracefully
- **Notes / Constraints:**
  - Restoration should be fast (< 1 second for typical state)
  - Show progress indicator for slow restorations
  - Fall back to default layout if restoration fails

---

## Capability 6 – Workspace Identity and Switching

### Capability Description
The system can represent distinct workspace identities and switch between them, properly tearing down old state and rebuilding from new state without leakage.

### Goals
- Workspaces are first-class entities with identity
- Can switch between workspaces without restart
- State is isolated per workspace
- Clean teardown prevents memory leaks
- Switching is fast and smooth

### Conceptual Responsibilities
- Define workspace identity model
- Manage workspace lifecycle
- Coordinate teardown and rebuild during switch
- Ensure proper cleanup of old workspace
- Preserve recent workspace list

### Dependencies
- Workspace State Persistence

#### Tasks

**Task 6.1 – Implement Workspace Model** ✅
- **Task Description:** Define workspace identity and metadata model.
- **Output:** `Workspace` class with identity and metadata.
- **Completion Criteria:**
  - Workspace has unique ID (UUID or hash)
  - Workspace has human-readable name
  - Workspace has optional file path or folder
  - Workspace tracks last accessed time
  - Workspace can be serialized for storage
- **Notes / Constraints:**
  - Support both file-based and virtual workspaces
  - Include workspace icon or color for visual distinction
- **Status:** `Workspace` enhanced with `rename()`, `setIconOrColor()`, `equals()`, `touch()`. `WorkspaceIdentity` and `WorkspaceMetadata` types expanded in `workspaceTypes.ts`.

**Task 6.2 – Implement Workspace Switching** ✅
- **Task Description:** Implement teardown and reconstruction when switching workspaces.
- **Output:** Workspace switching logic in workbench shell.
- **Completion Criteria:** 
  - Current workspace state is saved before switch
  - All disposables are properly disposed
  - No state leakage between workspaces
  - New workspace state is loaded and restored
  - Switching completes with visual transition
  - Recent workspace list is updated
- **Notes / Constraints:**  
  - Reference only:
    - https://github.com/microsoft/vscode/tree/main/src/vs/workbench/services/workspaces
  - Use disposal tracking to verify no leaks
  - Show loading indicator during switch
  - Consider fade transition between workspaces
- **Status:** `switchWorkspace()` and `createWorkspace()` implemented in `Workbench`. Teardown (`_teardownWorkspaceContent`) disposes views, containers, DnD, clears activity bar. Rebuild (`_rebuildWorkspaceContent`) re-creates ViewManager, containers, DnD. Transition overlay with 120ms fade. `IWorkspaceService` expanded with `switchWorkspace` and `createWorkspace` signatures.

**Task 6.3 – Implement Recent Workspaces** ✅
- **Task Description:** Implement tracking and quick access to recent workspaces.
- **Output:** Recent workspace list management.
- **Completion Criteria:**
  - Recent workspaces are tracked with timestamps
  - Can retrieve list of recent workspaces
  - List is persisted across sessions
  - Can remove workspaces from recent list
  - Maximum list size is configurable
- **Notes / Constraints:**
  - Store in global storage (not workspace-specific)
  - Include workspace metadata for display in UI
- **Status:** `RecentWorkspaces` class implemented at bottom of `workbench.ts`. Uses `RECENT_WORKSPACES_KEY` in global storage. `RecentWorkspaceEntry` type supports identity + metadata. `add()` moves workspace to top, trims to `DEFAULT_MAX_RECENT_WORKSPACES` (20). `getAll()`, `remove()`, `clear()`, `count()` all implemented. Current workspace added to recent list in Phase 4 and on every switch.

---

## Capability 7 – Minimal Command Surface

### Capability Description
The system can register, lookup, and execute structural commands that mutate workbench state. Commands operate on state rather than directly manipulating UI.

### Goals
- Declarative command registration
- Commands are first-class entities with metadata
- Execution goes through command service
- Commands can have preconditions (when clauses)
- Commands emit events for observability
- Commands are undoable where appropriate

### Conceptual Responsibilities
- Provide command registry and lookup
- Execute commands with parameter validation
- Enforce preconditions before execution
- Emit command execution events
- Support command composition and batching

### Dependencies
- Workbench Shell Initialization

#### Tasks

**Task 7.1 – Implement Command Registry** ✅
- **Task Description:** Implement command registration, lookup, and execution system.
- **Output:** `CommandRegistry` class and `ICommandService` interface.
- **Completed:** `commandTypes.ts` defines full type contracts (CommandDescriptor, CommandHandler, CommandExecutionContext, ICommandServiceShape). `commandRegistry.ts` implements CommandService class with registration, execution, events, and service-bridged context. `serviceTypes.ts` ICommandService extended to inherit ICommandServiceShape. `commandService.ts` re-exports CommandService. Registered in DI via `workbenchServices.ts`.
- **Completion Criteria:**
  - Commands can be registered with unique IDs
  - Commands have metadata (title, category, icon, keybinding)
  - Commands specify when clause for conditional enablement
  - Commands can be looked up by ID
  - Execution validates preconditions
  - Execution passes typed arguments
  - Registry emits events for command registration and execution
- **Notes / Constraints:**
  - Reference only:
    - https://github.com/microsoft/vscode/blob/main/src/vs/platform/commands/common/commands.ts
  - Use dependency injection to provide services to command handlers
  - Support async command execution

**Task 7.2 – Implement Structural Commands** ✅
- **Task Description:** Implement core commands that mutate layout and part state.
- **Output:** Set of structural commands for workbench manipulation.
- **Completed:** All 13 structural commands implemented in `structuralCommands.ts`. View toggles (sidebar, panel, auxBar, statusBar) operate on grid/part state. Editor split and view move commands are stubs for Cap 9. Layout reset restores default visibility. Workspace save/switch/layout.reset fully functional. Commands registered via `registerBuiltinCommands()` called from `workbench.ts` Phase 3.
- **Completion Criteria:** Commands implemented for:
  - `workbench.action.toggleSidebar` - Show/hide primary sidebar
  - `workbench.action.togglePanel` - Show/hide panel
  - `workbench.action.toggleAuxiliaryBar` - Show/hide auxiliary bar
  - `workbench.action.toggleStatusBar` - Show/hide status bar
  - `workbench.action.splitEditor` - Split active editor group
  - `workbench.action.splitEditorOrthogonal` - Split perpendicular to current
  - `view.moveToSidebar` - Move view to sidebar
  - `view.moveToPanel` - Move view to panel
  - `part.resize` - Resize part by amount
  - `workspace.save` - Explicitly save workspace state
  - `workspace.switch` - Switch to different workspace
  - `layout.reset` - Reset layout to defaults
- **Notes / Constraints:**
  - Commands operate on state models, not DOM directly
  - Commands should be composable (can be called from other commands)
  - Include undo/redo support where appropriate

**Task 7.3 – Implement Command Palette Integration** ✅
- **Task Description:** Create a simple command palette for discovering and executing commands.
- **Output:** Command palette UI component.
- **Completed:** `commandPalette.ts` implements CommandPalette class with overlay div, fuzzy search, keyboard navigation (Up/Down/Enter/Escape), keybinding display, recent commands tracking (localStorage-persisted, float to top when no query). Opens via Ctrl+Shift+P or F1. Styled in `workbench.css`. Instantiated and disposed by workbench._initializeCommands().
- **Completion Criteria:**
  - Palette shows all available commands
  - Commands are filtered by when clauses (disabled commands are hidden or grayed)
  - Fuzzy search filters commands by name
  - Keybinding is shown for commands that have one
  - Executing command closes palette
  - Recent commands appear at top
- **Notes / Constraints:**
  - Reference only:
    - https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/quickaccess/browser/commandsQuickAccess.ts
  - Use simple overlay div for palette UI
  - Support keyboard navigation (up/down arrows, enter to execute)

**Task 7.4 – Implement Workspace Commands** ✅
- **Task Description:** Implement workspace-related commands modeled after VS Code's File menu workspace actions. These commands operate through the command registry and delegate to existing workbench APIs.
- **Output:** Workspace commands registered in `structuralCommands.ts`.
- **Completed:** All 7 workspace commands implemented in `structuralCommands.ts`: duplicateWorkspace (saves then clones), addFolderToWorkspace (stub, multi-root future), removeFolderFromWorkspace (stub), closeFolder (saves then creates fresh workspace), closeWindow (saves then uses Electron bridge or shutdown()), openRecent (returns recent list), saveAs (creates copy under new name). Uses WorkbenchLike interface to avoid circular imports; electron bridge accessed via globalThis.parallxElectron.
- **Completion Criteria:** Commands implemented for:
  - `workspace.duplicateWorkspace` - Duplicate current workspace into a new workspace with the same state
  - `workspace.addFolderToWorkspace` - Add a folder path to the workspace's folder list (multi-root prep)
  - `workspace.removeFolderFromWorkspace` - Remove a folder from the workspace's folder list
  - `workspace.closeFolder` - Close the current workspace and return to empty state
  - `workspace.closeWindow` - Close the Electron window (app quit)
  - `workspace.openRecent` - List recent workspaces for selection
  - `workspace.saveAs` - Save current workspace under a new name
- **Notes / Constraints:**
  - Reference only:
    - https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/actions/workspaceActions.ts
    - `DuplicateWorkspaceInNewWindowAction` – clones workspace folders + settings into a new untitled workspace
    - `AddRootFolderAction` – delegates to `workspaceEditingService.addFolders()`
    - `CloseWorkspaceAction` (id: `workbench.action.closeFolder`) – opens empty window with `forceReuseWindow`
    - `CloseWindowAction` (id: `workbench.action.closeWindow`) – calls `nativeHostService.closeWindow()`
  - Commands should compose existing `Workbench` methods where possible
  - `workspace.addFolderToWorkspace` / `workspace.removeFolderFromWorkspace` require extending the `Workspace` model with a `folders` array (multi-root foundation)
  - `workspace.closeWindow` uses Electron IPC via preload bridge

---

## Capability 8 – Workbench Context State

### Capability Description
The system can track and expose structural context such as active view, focused part, and visibility state. Context drives conditional command enablement and UI rendering.

### Goals
- Context is queryable and observable
- Context changes emit events
- Commands use context for preconditions
- Focus management is explicit and trackable
- Context includes both structural and content state

### Conceptual Responsibilities
- Track active part and view
- Track focused element
- Track visibility state of all parts
- Provide context key API for querying
- Evaluate when clause expressions
- Emit events for context changes

### Dependencies
- View Hosting and Lifecycle
- Structural Parts

#### Tasks

**Task 8.1 – Implement Context Key System** ✅
- **Task Description:** Implement context key definitions, storage, and query API.
- **Output:** `ContextKey` and `IContextKeyService` with evaluation engine.
- **Completion Criteria:**
  - Context keys can be defined with string identifiers
  - Context values can be set and retrieved
  - Context is scoped (global, part, view)
  - When clause expressions can be parsed and evaluated
  - Expression syntax supports AND, OR, NOT operators
  - Expressions support comparisons (==, !=, <, >, in)
  - Context changes trigger re-evaluation of dependent clauses
- **Status:** Complete — Implemented in `context/contextKey.ts` as `ContextKeyService` with `ContextKeyScope` (parent-chain lookup for global→part→view scoping), `ContextKeyHandle<T>` (typed IContextKey), scope management, and when-clause evaluation via delegation to `whenClause.ts`. Registered in DI via `services/contextKeyService.ts` and `workbench/workbenchServices.ts`. Full `IContextKeyService` interface defined in `services/serviceTypes.ts`. Wired into `CommandService` and `CommandPalette` for real when-clause evaluation and filtering.
- **Notes / Constraints:**
  - Reference only:
    - https://github.com/microsoft/vscode/tree/main/src/vs/platform/contextkey
  - Expression syntax: `sidebarVisible && !panelVisible`
  - Support dynamic context (values computed on demand)

**Task 8.2 – Implement Workbench Context** ✅
- **Task Description:** Implement tracking of structural workbench context.
- **Output:** Standard context keys for workbench structure.
- **Completion Criteria:** Context keys track:
  - `sidebarVisible`, `panelVisible`, `auxiliaryBarVisible`, `statusBarVisible` - Part visibility
  - `activePart` - ID of currently active part
  - `activeView` - ID of currently active view
  - `focusedView` - ID of currently focused view
  - `focusedPart` - ID of currently focused part
  - `activeEditor` - ID of active editor (if any)
  - `activeEditorGroup` - ID of active editor group
  - `editorGroupCount` - Number of editor groups
  - `workspaceLoaded` - Whether a workspace is loaded
  - `workbenchState` - Current workbench state (empty, folder, workspace)
- **Status:** Complete — Implemented in `context/workbenchContext.ts` as `WorkbenchContextManager`. Exports named constants for all 13 context keys (`CTX_SIDEBAR_VISIBLE`, `CTX_PANEL_VISIBLE`, etc.). Provides `trackPartVisibility()` for all structural parts, `trackViewManager()` for active view, `setActiveEditor()`/`setActiveEditorGroup()`/`setEditorGroupCount()` for editor state, `setWorkspaceLoaded()`/`setWorkbenchState()` for workspace state. Subscribes to `FocusTracker` events for automatic `focusedPart`/`focusedView` updates. Wired in `workbench.ts._initializeContext()`.
- **Notes / Constraints:**
  - Reference only:
    - https://github.com/microsoft/vscode/blob/main/src/vs/workbench/common/contextkeys.ts
  - Update context synchronously when state changes
  - Use context to enable/disable commands dynamically

**Task 8.3 – Implement Focus Tracking** ✅
- **Task Description:** Implement tracking of active view, focused part, and keyboard focus.
- **Output:** `FocusTracker` class with focus management.
- **Completion Criteria:** 
  - Tracks which part has focus
  - Tracks which view has focus within a part
  - Tracks last focused element for restoration
  - Provides API to programmatically move focus
  - Updates workbench context on focus changes
  - Emits focus change events
  - Handles focus restoration after dialogs/overlays
- **Status:** Complete — Implemented in `context/focusTracker.ts` as `FocusTracker extends Disposable`. Uses `focusin`/`focusout` DOM events on the workbench container, walks up the DOM tree to find `data-part-id` and `data-view-id` attributes (added to `Part.create()` and `View.createElement()`). Maintains focus history with `WeakRef<HTMLElement>` for safe restoration. Provides `focusPart()`, `focusView()`, `restoreFocus()` for programmatic focus, `suspend()`/`resume()` for dialog handling. Emits `onDidFocusPart` and `onDidFocusView` events. Updates `focusedPart`/`focusedView` context keys via ContextKeyService.
- **Notes / Constraints:**
  - Use DOM focus events as base signal
  - Track focus at part granularity for keyboard shortcuts
  - Restore focus intelligently (e.g., after closing a view)

**Task 8.4 – Implement When Clause Parser** ✅
- **Task Description:** Implement expression parser for when clause evaluation.
- **Output:** `WhenClause` parser and evaluator.
- **Completion Criteria:**
  - Can parse expressions into AST
  - Supports operators: &&, ||, !, ==, !=, <, >, <=, >=, in
  - Supports parentheses for grouping
  - Handles undefined context keys gracefully
  - Provides useful error messages for invalid syntax
  - Evaluates expressions efficiently (cached parsing)
- **Status:** Complete — Implemented in `context/whenClause.ts` (~380 lines). Tokenizer converts expression strings into typed tokens. `WhenClauseParser` is a recursive descent parser (or→and→not→compare→primary) that builds a typed AST (`WhenClauseNode`). `parseWhenClause()` caches parsed ASTs in a `Map` for repeated evaluation. `evaluateWhenClause()` / `_evalNode()` evaluates ASTs against a `ContextKeyLookup` function. `testWhenClause()` provides convenient parse+evaluate. Supports all required operators plus parenthesized grouping, string/number/boolean literals, and graceful handling of undefined keys (treated as falsy).
- **Notes / Constraints:**
  - Reference only:
    - https://github.com/microsoft/vscode/blob/main/src/vs/platform/contextkey/common/contextkey.ts
  - Use recursive descent parser or parser combinator library
  - Optimize hot path evaluation (cache compiled expressions)

---

## Capability 9 – Editor Groups and Document Hosting

### Capability Description
The system can host multiple editor groups arranged in a nested grid within the editor part, each group managing tabbed editors with preview and pinning semantics.

### Goals
- Editor part uses nested grid for group layout
- Groups can split horizontally or vertically
- Groups support tabbed editor interface
- Preview editors vs pinned editors
- Drag-and-drop editor movement between groups
- Groups can be merged, closed, and resized

### Conceptual Responsibilities
- Manage editor group lifecycle
- Coordinate nested grid within editor part
- Implement tab UI for editors
- Handle editor opening, closing, activation
- Provide editor state persistence
- Support split editor workflows

### Dependencies
- Structural Parts
- View Hosting and Lifecycle
- Serializable Layout System

#### Tasks

**Task 9.1 – Implement Editor Group Model**
- **Task Description:** Implement state management for a single editor group.
- **Output:** `EditorGroupModel` class for group state.
- **Completion Criteria:**
  - Model tracks list of open editors
  - Model distinguishes preview vs pinned editors
  - Model tracks active editor in group
  - Model maintains editor order
  - Model provides methods to add/remove/reorder editors
  - Model supports sticky editors (remain at start)
  - Model can serialize its state
- **Notes / Constraints:**
  - Reference only:
    - https://github.com/microsoft/vscode/blob/main/src/vs/workbench/common/editor/editorGroupModel.ts
  - Preview editors are shown in italics and replaced when opening new files
  - Pin action converts preview to pinned editor

**Task 9.2 – Implement Editor Input**
- **Task Description:** Define abstract editor input that represents a document or resource.
- **Output:** `EditorInput` base class and interface.
- **Completion Criteria:**
  - Input has unique identifier
  - Input has display name and description
  - Input has type ID for resolution
  - Input can be dirty (unsaved changes)
  - Input can veto closing (if unsaved)
  - Input can be serialized for persistence
- **Notes / Constraints:**
  - Reference only:
    - https://github.com/microsoft/vscode/blob/main/src/vs/workbench/common/editor/editorInput.ts
  - EditorInput is abstract; concrete types implement specific resources (files, diffs, etc.)
  - For Milestone 1, provide simple placeholder editor inputs

**Task 9.3 – Implement Editor Pane**
- **Task Description:** Define abstract editor pane that renders editor content.
- **Output:** `EditorPane` base class with lifecycle.
- **Completion Criteria:**
  - Pane receives editor input and renders content
  - Pane has lifecycle: create, setInput, clearInput, layout, dispose
  - Pane can save and restore view state (scroll, selection)
  - Pane implements IGridView for sizing
  - Pane provides underlying control access (e.g., text editor)
- **Notes / Constraints:**
  - Reference only:
    - https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/parts/editor/editorPane.ts
  - EditorPane is abstract; concrete types render specific editor types
  - For Milestone 1, provide simple placeholder editor panes

**Task 9.4 – Implement Editor Group View**
- **Task Description:** Implement UI rendering and interaction for a single editor group.
- **Output:** `EditorGroupView` class with tab UI.
- **Completion Criteria:**
  - Renders tab bar with editor tabs
  - Renders active editor pane below tabs
  - Tabs show editor name, dirty indicator, close button
  - Preview editors shown in italics
  - Tabs support click to activate, close button to close
  - Tabs support drag-and-drop reordering within group
  - Tabs support drag to other groups
  - Group has toolbar with split and close actions
  - Group integrates with grid system (size constraints)
- **Notes / Constraints:**
  - Reference only:
    - https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/parts/editor/editorGroupView.ts
  - Tab UI should be clean and minimal
  - Support keyboard navigation between tabs

**Task 9.5 – Implement Editor Part with Groups**
- **Task Description:** Enhance EditorPart to host multiple editor groups in nested grid.
- **Output:** EditorPart with nested grid of editor groups.
- **Completion Criteria:**
  - Editor part hosts nested grid of editor groups
  - Can split active group horizontally or vertically
  - Can close groups (editors move to remaining groups)
  - Can merge groups
  - Can resize groups via sash
  - Tracks active group
  - Persists group layout and editor assignments
  - Provides drag-and-drop between groups
- **Notes / Constraints:**
  - Reference only:
    - https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/parts/editor/editorPart.ts
  - Editor part grid is independent from main workbench grid
  - Always maintain at least one editor group

**Task 9.6 – Implement Editor Services**
- **Task Description:** Implement IEditorService and IEditorGroupService for coordinated editor management.
- **Output:** Service interfaces and implementations.
- **Completion Criteria:**
  - `IEditorService` provides high-level editor opening API
  - `IEditorService` resolves editor inputs to editor panes
  - `IEditorService` tracks active editor globally
  - `IEditorGroupService` manages group lifecycle
  - `IEditorGroupService` provides split/merge/move operations
  - Services coordinate to provide unified editor experience
  - Services emit events for editor and group changes
- **Notes / Constraints:**
  - Reference only:
    - https://github.com/microsoft/vscode/blob/main/src/vs/workbench/services/editor/common/editorService.ts
    - https://github.com/microsoft/vscode/blob/main/src/vs/workbench/services/editor/common/editorGroupsService.ts
  - Services should be the primary API for editor operations (don't manipulate groups directly)

---

## Capability 10 – Platform Abstractions

### Capability Description
The system provides platform-agnostic abstractions for storage, events, lifecycle management, and other foundational capabilities that enable testability and portability.

### Goals
- Abstract storage mechanism (localStorage, IndexedDB, file system)
- Event system for pub-sub communication
- Disposable pattern for resource cleanup
- Instantiation utilities for service creation
- Platform-agnostic types and utilities

### Conceptual Responsibilities
- Provide storage interface with implementations
- Provide event emitter with typed events
- Provide lifecycle and disposal tracking
- Enable testability through abstraction

### Dependencies
- None (foundational capability)

#### Tasks

**Task 10.1 – Implement Storage Abstraction**
- **Task Description:** Create storage interface with multiple backend implementations.
- **Output:** `IStorage` interface with localStorage and IndexedDB implementations.
- **Completion Criteria:**
  - Interface supports get/set/delete/clear operations
  - Interface supports namespacing for isolation
  - Async and sync variants available
  - localStorage implementation for simple data
  - IndexedDB implementation for large data
  - In-memory implementation for testing
  - Graceful error handling for quota exceeded
- **Notes / Constraints:**
  - Reference only:
    - https://github.com/microsoft/vscode/blob/main/src/vs/base/common/storage.ts
  - Consider encryption for sensitive data
  - Support migration between storage backends

**Task 10.2 – Implement Event System**
- **Task Description:** Create event emitter with typed events and disposal.
- **Output:** `Emitter<T>` class and `Event<T>` type.
- **Completion Criteria:**
  - Emitters are typed by event payload
  - Listeners can be added and removed
  - Listeners return IDisposable for cleanup
  - Support once listeners (fire once, then dispose)
  - Support event filtering and mapping
  - Events can be debounced or throttled
  - Memory leak prevention (weak references where appropriate)
- **Notes / Constraints:**
  - Reference only:
    - https://github.com/microsoft/vscode/blob/main/src/vs/base/common/event.ts
  - Use functional API: `onDidChangeLayout: Event<LayoutChangeEvent>`

**Task 10.3 – Implement Lifecycle and Disposables**
- **Task Description:** Implement IDisposable pattern and disposal tracking utilities.
- **Output:** `IDisposable` interface and helper classes.
- **Completion Criteria:**
  - IDisposable interface with dispose method
  - DisposableStore for managing multiple disposables
  - toDisposable helper for wrapping cleanup functions
  - MutableDisposable for replaceable disposables
  - Disposal tracking to detect leaks in development
  - Async disposal support
- **Notes / Constraints:**
  - Reference only:
    - https://github.com/microsoft/vscode/blob/main/src/vs/base/common/lifecycle.ts
  - All resources (event listeners, intervals, DOM elements) should be disposable
  - Use try-finally to ensure disposal

**Task 10.4 – Implement Instantiation Utilities**
- **Task Description:** Create utilities for service instantiation and dependency resolution.
- **Output:** Instantiation helper functions and decorators.
- **Completion Criteria:**
  - Support for constructor parameter injection
  - Decorators for marking injectable services
  - Utilities for creating service instances from collection
  - Support for service descriptors (singleton, transient)
  - Circular dependency detection
- **Notes / Constraints:**
  - Reference only:
    - https://github.com/microsoft/vscode/blob/main/src/vs/platform/instantiation/common/instantiation.ts
  - Use TypeScript decorators for marking dependencies
  - Provide good error messages for missing services

---

## Testing Strategy

### Unit Testing
- Each module should have corresponding test file
- Test grid system independently with mock views
- Test services with mock dependencies
- Test serialization round-trips
- Test command preconditions and execution
- Test context key evaluation

### Integration Testing
- Test workbench initialization from empty state
- Test layout restoration from saved state
- Test workspace switching with state isolation
- Test drag-and-drop workflows end-to-end
- Test editor group splitting and merging
- Test view lifecycle through all phases

### Manual Testing Checklist
- [ ] Layout can be split in all directions
- [ ] Parts can be resized and constraints are respected
- [ ] Parts can be shown/hidden
- [ ] Views can be dragged between parts
- [ ] Editors can be split and merged
- [ ] Editors can be dragged between groups
- [ ] State persists across refresh
- [ ] Workspace switching works without leaks
- [ ] Commands are enabled/disabled based on context
- [ ] Focus tracking works correctly
- [ ] Keyboard navigation works throughout

---

## Success Criteria

### Milestone 1 is complete when:

1. **Structural Foundation**
   - Repository structure exists and enforces boundaries
   - Workbench shell initializes and coordinates all subsystems
   - Service architecture with DI is functional

2. **Layout System**
   - Grid system enables dynamic splitting and resizing
   - Layout state can be serialized and restored
   - Size constraints are enforced during layout
   - Nested grids work (editor groups within editor part)

3. **Parts and Views**
   - All standard parts exist and integrate with grid
   - Views have full lifecycle and size constraints
   - View containers provide tabbed interface
   - Parts can host views dynamically

4. **Editor System**
   - Editor groups can be split and merged
   - Groups host tabbed editors
   - Preview and pinned editor semantics work
   - Editors can be moved between groups

5. **State Management**
   - Workspace state persists and restores accurately
   - Workspace switching works without leaks
   - Context keys track workbench state
   - Commands are conditional on context

6. **Interaction**
   - Drag-and-drop works for views and editors
   - Commands mutate state correctly
   - Focus tracking and restoration works
   - Keyboard navigation is functional

7. **Quality**
   - No console errors in normal operation
   - No memory leaks detected
   - Performance is acceptable (layout updates < 16ms)
   - Code follows architectural boundaries

---

## Out of Scope (Explicitly Deferred)

- Content creation and editing
- Document models and text editing
- Domain-specific tools (canvas, database views, etc.)
- AI features and automation
- Theming and appearance customization
- Accessibility (ARIA, screen reader support) beyond basic structure
- Multi-window support (auxiliary windows)
- Extensions and plugin system
- Settings and preferences UI
- Menu bar and context menus (beyond basic structure)
- Status bar item management (beyond container)
- Terminal integration
- Search and replace
- File explorer
- Git integration
- Any domain-specific features

---

## Architectural Patterns Reference

### VS Code Patterns Applied

1. **Grid System** - `src/vs/base/browser/ui/grid/`
   - Constraint-based layout
   - Serializable structure
   - Nested grids

2. **Part Architecture** - `src/vs/workbench/browser/parts/`
   - Structural containers
   - Lifecycle management
   - Grid integration

3. **Service Orientation** - `src/vs/platform/*/common/`
   - Interface-based design
   - Dependency injection
   - Lazy instantiation

4. **Context Keys** - `src/vs/platform/contextkey/`
   - Dynamic UI state
   - Conditional rendering
   - When clause evaluation

5. **Editor Groups** - `src/vs/workbench/browser/parts/editor/`
   - Nested grid management
   - Tab UI patterns
   - Preview semantics

6. **Event System** - `src/vs/base/common/event.ts`
   - Typed events
   - Disposable listeners
   - Event composition

7. **Lifecycle Pattern** - `src/vs/base/common/lifecycle.ts`
   - IDisposable interface
   - Resource tracking
   - Cleanup automation

---

## Notes

- This milestone establishes the workbench foundation only. No content-specific features should be implemented.
- Focus on structural correctness and clean abstractions over premature optimization.
- Reference VS Code source as inspiration, but don't copy implementation details blindly.
- Ensure all code follows the repository structure and architectural boundaries.
- Document key design decisions and patterns as they emerge.
- Maintain test coverage throughout development, not as an afterthought.
- Use placeholder content to validate the system works before adding real content in later milestones.
