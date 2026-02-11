# Milestone 3 – Workbench UI Realization (VS Code-Aligned)

> **Authoritative Scope Notice**
>
> This document is the single source of truth for Milestone 3.
> All implementation must conform to the structures and boundaries defined here.
> VS Code source files are referenced strictly as inspiration and validation, not as scope drivers.
> Referenced material must not expand scope unless a missing core workbench interaction is identified.
> Parallx is **not** a code IDE. It is a VS Code-like structural shell that hosts arbitrary domain-specific tools.
> All VS Code references are filtered through this lens — only structural, shell, and hosting patterns apply.

---

## Milestone Definition

### Vision
Parallx presents a fully operable workbench UI that matches the structural interaction model of VS Code, including title bar, activity bar, sidebar, editor area, panel, status bar, command palette, and keyboard routing. A user familiar with VS Code can operate Parallx without learning new interaction patterns.

### Purpose
To bind the existing workbench services (layout, workspace, tool registry, command registry, context state) built in M1 and M2 to a UI layer that behaves predictably and consistently with VS Code's workbench interaction model. Backend systems already exist. This milestone wires them to concrete, polished UI components and interaction flows.

### Background — What Already Exists
Milestones 1 and 2 established:
- **Layout engine** — `Grid` class with splitting, resizing, serialization (`src/layout/`)
- **Structural parts** — `TitlebarPart`, `SidebarPart`, `PanelPart`, `EditorPart`, `AuxiliaryBarPart`, `StatusBarPart` with DOM creation, size constraints, and lifecycle (`src/parts/`)
- **View system** — `ViewContainer` with tabbed interface, `ViewManager`, `ViewDescriptor` (`src/views/`)
- **Editor groups** — `EditorGroupView` with tab bar, split/merge, drag-and-drop (`src/editor/`)
- **Command system** — `CommandService`, `CommandRegistry`, `CommandPalette` with fuzzy search, when-clause filtering, recent commands (`src/commands/`)
- **Context keys** — `ContextKeyService`, `FocusTracker` (focusin/focusout on workbench root, DOM ancestor walk for data-part-id/data-view-id), `WorkbenchContextManager` with 13 standard context keys (`src/context/`)
- **Workspace** — `WorkspaceService` with switching, persistence, recent workspaces (`src/workspace/`)
- **Tool system** — Full tool lifecycle, contributions (commands, keybindings, menus, views), API boundary (`src/tools/`, `src/api/`, `src/contributions/`)
- **Activity bar** — Standalone `div.activity-bar` created in `workbench.ts` Phase 2 (not a proper `Part`)
- **Keybinding contributions** — `KeybindingContributionProcessor` registers tool keybindings, but **no global keybinding dispatcher** exists at the workbench level
- **Inline styles** — Parts create DOM with heavy `element.style.*` usage alongside the CSS file

### Conceptual Scope

**Included**
- Title bar polish and service wiring
- Activity bar promotion to first-class Part with VS Code-aligned interaction
- Sidebar resize, collapse, and state persistence polish
- Editor area tab behavior, split UX, and drop targets
- Bottom panel toggle, resize, and tab switching
- Status bar entry contribution and command wiring
- Quick Access system (superset of Command Palette)
- Global keybinding dispatch system
- Focus model with keyboard region cycling
- Context-aware command enablement in UI
- CSS class-based styling migration (away from inline styles)
- Notification center integration (wiring existing NotificationService to visible UI)

**Excluded**
- Blocks, canvas, or domain content
- Custom Parallx UX ideas or new interaction metaphors
- Theming engine or theme switching (deferred — M3 uses a single dark theme)
- Multi-window support (deferred, consistent with M1/M2)
- Zen mode, centered editor layout (deferred — polish features)
- Tool marketplace or remote tool installation
- Settings UI / settings editor (deferred)
- Language-specific features (not applicable — Parallx is not a code IDE)

### Structural Commitments
- All UI interactions route through services — no direct DOM manipulation from event handlers that bypasses state.
- All keyboard shortcuts go through a central keybinding dispatch system — no ad-hoc `addEventListener('keydown')` scattered across components.
- All part visibility, size, and position changes persist through the existing workspace state system.
- Focus is tracked as first-class state — exactly one region is active at any time.
- Visual styling uses CSS classes exclusively — inline styles are removed except for computed dimensions (`width`, `height`).

### Architectural Principles
- **Service-First UI**: Every UI action is a command or service call. The UI is a view of state, not the owner of state.
- **Keyboard Parity**: Every mouse action has a keyboard equivalent.
- **State Persistence**: If a user changes a UI state (collapse sidebar, resize panel, reorder tabs), it survives a reload.
- **Progressive Enhancement**: Parts render a functional baseline immediately; tool contributions enhance them dynamically.
- **Accessibility Foundation**: All interactive elements have ARIA roles, labels, and keyboard operability.

### DeepWiki References (authoritative VS Code architecture)
- [Workbench Architecture](https://deepwiki.com/microsoft/vscode/7-workbench-architecture) — High-level structure, parts overview, SerializableGrid layout
- [Layout System and Parts](https://deepwiki.com/microsoft/vscode/7.1-layout-system-and-parts) — Part lifecycle, grid structure, visibility state, position/alignment, persistence
- [Editor Service and Groups](https://deepwiki.com/microsoft/vscode/7.2-editor-service-and-groups) — Editor groups, tab management, split operations
- [Context Keys and State Management](https://deepwiki.com/microsoft/vscode/7.4-context-keys-and-state-management) — Context key bindings, UI state context

---

## Prerequisite – UI Component Library (`src/ui/`)

### Description
Before M3 UI work begins, a shared component library exists at `src/ui/` that provides reusable UI primitives modeled after VS Code's `src/vs/base/browser/ui/`. This eliminates the duplication patterns identified in M1/M2 (tab bars built twice, overlays built five times, input fields built four times, close buttons built three times) and establishes the foundation for all M3 UI construction.

### Rationale
M1/M2 codebase audit revealed zero reusable UI primitives — every visual element was hand-rolled with raw `document.createElement` + inline styles. This caused:
- **Tab bar** duplicated in `editorGroupView.ts` (~177 lines) and `viewContainer.ts` (~65 lines)
- **Overlay/backdrop** duplicated across `commandPalette.ts`, `notificationService.ts` (3×), `menuContribution.ts`, `workbench.ts`
- **Input fields** duplicated in `commandPalette.ts`, `notificationService.ts` (2×), `placeholderViews.ts`
- **Close buttons** duplicated in `editorGroupView.ts` (2×), `notificationService.ts`
- **Toolbar/action buttons** duplicated in `editorGroupView.ts`, `output/main.ts`, `tool-gallery/main.ts`
- **Filterable lists** duplicated in `commandPalette.ts` (~258 lines) and `notificationService.ts` (~130 lines)

### Architecture
Components follow VS Code's exact pattern:
- Vanilla TypeScript classes extending `Disposable` (from `platform/lifecycle.ts`)
- Events via `Emitter<T>` (from `platform/events.ts`)
- Constructor signature: `(container: HTMLElement, options?: TOptions)`
- All visual styling via CSS classes in co-located `ui.css` (no inline styles)
- Context-agnostic — components know nothing about parts, services, or tools

**Dependency rule:** `src/ui/` depends only on `src/platform/`. Feature modules consume from `src/ui/`.

### Phase 1 Components (✅ Implemented)

| Component | File | Consolidates |
|---|---|---|
| **DOM helpers** | `src/ui/dom.ts` | `$()` element creation, `addDisposableListener()`, `clearNode()`, `toggleClass()` |
| **Button** | `src/ui/button.ts` | Toolbar buttons (editorGroupView, output, tool-gallery), notification action buttons, close buttons |
| **InputBox** | `src/ui/inputBox.ts` | Command palette input, notification modal inputs, placeholder view inputs |
| **TabBar** | `src/ui/tabBar.ts` | Editor group tab bar, view container tab bar — with DnD, close, active state, decorations |
| **Overlay** | `src/ui/overlay.ts` | Command palette overlay, notification modals, context menu backdrop, transition overlay |
| **FilterableList** | `src/ui/list.ts` | Command palette list + quick pick list — with fuzzy filter, keyboard nav, badges |
| **ActionBar** | `src/ui/actionBar.ts` | Editor group toolbar, notification action rows, view title bar actions |
| **CountBadge** | `src/ui/countBadge.ts` | Notification count badges, activity bar badges (M3 Cap 1) |

### CSS
All component styles live in `src/ui/ui.css`, concatenated with `src/workbench.css` at build time. All classes use `ui-` prefix to avoid collisions with existing workbench classes. Theme integration via CSS custom properties (`--color-*`).

### VS Code Reference
- `src/vs/base/browser/ui/button/button.ts` — Button pattern
- `src/vs/base/browser/ui/inputbox/inputBox.ts` — InputBox pattern
- `src/vs/base/browser/ui/actionbar/actionbar.ts` — ActionBar pattern
- `src/vs/base/browser/ui/countBadge/countBadge.ts` — CountBadge pattern
- `src/vs/base/browser/ui/list/listWidget.ts` — List/Tree pattern

### Integration Path
M3 capabilities should:
1. **Import from `src/ui/`** instead of creating raw DOM for standard widgets
2. **Refactor existing duplication** as each capability touches the relevant code (e.g., Cap 0 CSS migration should also wire in `TabBar` for editor and view containers)
3. **Add new components to `src/ui/`** when M3 requires primitives not yet built (e.g., `Sash`, `ProgressBar`, `ContextMenu`)

---

## Capability 0 – M2 Gap Cleanup and CSS Migration

### Capability Description
Address known gaps and technical debt from Milestones 1 and 2 before layering M3 UI work on top. The primary debt items are: (1) heavy inline styles that block future theming, (2) the activity bar existing as an ad-hoc DOM element rather than a proper Part, and (3) missing global keybinding dispatch infrastructure.

### Goals
- All parts use CSS classes instead of inline styles for non-computed properties
- Activity bar is promoted to a proper `ActivityBarPart` registered in `PartRegistry`
- The foundation for a global keybinding dispatcher is established
- No M1/M2 regression after cleanup

### Dependencies
None — this is prerequisite work.

### VS Code Reference
- `src/vs/workbench/browser/part.ts` — Base `Part` class with theme-aware styling
- `src/vs/workbench/browser/parts/activitybar/activitybarPart.ts` — `ActivityBarPart` as a registered Part

#### Tasks

**Task 0.1 – Migrate Inline Styles to CSS Classes** ✅
- **Task Description:** Audit all Part subclasses and replace inline `element.style.*` assignments with CSS class application. Computed dimensions (`width`, `height` set by `layout()`) are the only permitted inline styles.
- **Output:** Updated part files and expanded `workbench.css`.
- **Deviation:** Used `.hidden` utility class with `!important` for visibility toggling instead of BEM modifiers. All `display: flex/none` toggles (Part visibility, watermark, empty state, editor column adapter) now use `classList.toggle('hidden')`. Window control hover effects removed from JS since CSS `:hover` already handles them. Grid wrapper classes `.workbench-hgrid` / `.workbench-vgrid` and `.editor-column` added. Workspace transition overlay uses `.visible` class toggle instead of inline opacity. 158 inline styles migrated across 10 files, 9 kept (layout dimensions). Bundle size reduced ~7kb.
- **Completion Criteria:**
  - All `element.style.backgroundColor`, `element.style.color`, `element.style.border*`, `element.style.padding`, `element.style.fontSize`, etc. in part create/mount methods are replaced with CSS class selectors
  - `workbench.css` contains all visual properties that were previously inline
  - Only `element.style.width` and `element.style.height` (set by `layout()`) remain as inline styles
  - Visual appearance is identical before and after migration (screenshot comparison)
  - `EditorGroupView` tab rendering uses CSS classes for active/preview/sticky/dirty states instead of inline `style.*` overrides
- **Notes / Constraints:**
  - This is a refactor, not a redesign — visual output must not change
  - Consider using BEM-like naming convention for new classes: `.part-titlebar__center`, `.editor-tab--active`, `.statusbar-entry--has-command`
  - Do not introduce a CSS preprocessor (plain CSS for now)

**Task 0.2 – Promote Activity Bar to ActivityBarPart** ✅
- **Task Description:** Replace the ad-hoc `div.activity-bar` created in `workbench.ts` Phase 2 with a proper `ActivityBarPart` class extending `Part`, registered in `PartRegistry`, and participating in the grid layout.
- **Output:** `ActivityBarPart` class in `src/parts/activityBarPart.ts`, registered descriptor, grid integration.
- **Deviation:** ActivityBarPart is positioned outside the horizontal grid (prepended to bodyRow) rather than as a grid view, matching the fixed 48px width constraint. Grid topology remains `hGrid(sidebar | editorColumn | auxBar)` with ActivityBarPart as a non-grid fixed-width element.
- **Completion Criteria:**
  - `ActivityBarPart` extends `Part` and implements `IGridView`
  - Registered in `PartRegistry` with `PartId.ActivityBar`
  - Fixed width (48px), full height, positioned as the leftmost element in the horizontal grid
  - Activity bar DOM creation moves from `workbench.ts` into `ActivityBarPart.createContent()`
  - Activity bar icon management (add/remove/reorder/highlight) is encapsulated in the Part
  - Existing tool-contributed activity bar icons continue to work
  - Activity bar participates in workspace state save/restore (active container ID)
  - `PartId` enum in `partTypes.ts` updated with `ActivityBar` entry
- **Notes / Constraints:**
  - VS Code reference: `src/vs/workbench/browser/parts/activitybar/activitybarPart.ts`
  - The secondary activity bar (auxiliary bar side) remains as-is for M3 — it can be promoted in a future milestone
  - The horizontal grid topology changes from `hGrid(sidebar | editorColumn | auxBar)` to `hGrid(activityBar | sidebar | editorColumn | auxBar)`

**Task 0.3 – Establish Keybinding Dispatch Infrastructure** ✅
- **Task Description:** Create a centralized `KeybindingService` that intercepts all keyboard events at the workbench level and resolves them to commands. Replace the ad-hoc `document.addEventListener('keydown')` in `CommandPalette` and any other scattered listeners.
- **Output:** `KeybindingService` class in `src/services/keybindingService.ts`, registered in DI.
- **Deviation:** KeybindingContributionProcessor retains a `setKeybindingService()` bridge method rather than being fully replaced — it continues to parse tool manifests but delegates dispatch to the service. F1 registered as a separate secondary binding for showCommands alongside Ctrl+Shift+P. Chord timeout uses 1500ms as specified.
- **Completion Criteria:**
  - Single `keydown` listener on `document` (capture phase) owned by `KeybindingService`
  - Service maintains a keybinding table: `{ key: NormalizedKeybinding, commandId: string, when?: string }[]`
  - On keydown, normalizes the event, looks up matching keybinding, evaluates `when` clause via `IContextKeyService`, and if satisfied, calls `commandService.executeCommand(commandId)`
  - `preventDefault()` is called only when a keybinding matches and executes
  - Structural keybindings (Ctrl+Shift+P, Ctrl+B, Ctrl+J, etc.) are registered through this service, not via ad-hoc listeners
  - Tool-contributed keybindings from `KeybindingContributionProcessor` are migrated to register through this service
  - Chord support (e.g., `Ctrl+K Ctrl+O` — two-key sequences) with timeout (1500ms, matching VS Code)
  - `IKeybindingService` interface added to `serviceTypes.ts`
- **Notes / Constraints:**
  - VS Code reference: `src/vs/workbench/services/keybinding/browser/keybindingService.ts`
  - This service replaces the keybinding dispatch responsibility from `KeybindingContributionProcessor` (which becomes a registration-only processor)
  - The `CommandPalette` keydown listener (`Ctrl+Shift+P` / `F1`) is removed and replaced with keybinding registrations through this service
  - Key normalization reuses existing `normalizeKeybinding()` from `keybindingContribution.ts`

---

## Capability 1 – Title Bar (VS Code Parity)

### Capability Description
The title bar is a fixed top region spanning the full window width. It displays the workspace name, provides window control buttons, and serves as the anchor for the menu bar and future command center. All content is sourced from services, not hardcoded.

### Goals
- Title bar content is fully data-driven from services
- Workspace name updates reactively when workspace changes
- Window controls work correctly on all platforms (Electron frameless window)
- Menu bar items are registered through the contribution system (not hardcoded in workbench.ts)

### Dependencies
- M2 Gap Cleanup (Task 0.1 for CSS migration, Task 0.2 for ActivityBarPart)

### VS Code Reference
- `src/vs/workbench/browser/parts/titlebar/titlebarPart.ts` — Title bar rendering and layout
- DeepWiki: [Workbench Architecture → Parts Overview](https://deepwiki.com/microsoft/vscode/7-workbench-architecture) — Title bar configuration

#### Tasks

**Task 1.1 – Wire Title Bar to Workspace Service**
- **Task Description:** Replace static title bar content population in `workbench.ts` Phase 3 with reactive binding to `IWorkspaceService`. The workspace name label, app icon, and window title should update automatically when the active workspace changes.
- **Output:** Title bar center region displays workspace name from `WorkspaceService`, updates on `onDidChangeWorkspace`.
- **Completion Criteria:**
  - Workspace name in title bar center is sourced from `workspaceService.activeWorkspace.name`
  - When workspace switches, the label updates without manual DOM manipulation in `workbench.ts`
  - `TitlebarPart` exposes `setWorkspaceName(name: string)` or subscribes to workspace events directly
  - Document title (`document.title`) updates to `{workspaceName} — Parallx` format
  - Clicking the workspace name label opens Quick Access (Capability 7) — not a custom dropdown
  - Title bar content creation moves from `workbench.ts` Phase 3 into `TitlebarPart.createContent()` or a dedicated `TitlebarContentRenderer`
- **Notes / Constraints:**
  - The title bar currently has three slots (left/center/right) — this is correct and should remain
  - In VS Code, the title bar center can optionally show a "Command Center" widget — this is future-compatible but not required in M3

**Task 1.2 – Register Menu Bar via Contribution System**
- **Task Description:** Replace the hardcoded menu bar items ("File", "Edit", "Selection", "View", "Tools", "Help") in `workbench.ts` Phase 3 with a declarative menu registration through the contribution system.
- **Output:** Menu bar items registered via `IMenuContributionService` or a dedicated `MenuBarService`.
- **Completion Criteria:**
  - Menu bar items are not hardcoded in `workbench.ts` — they come from a registration system
  - Default menus (File, Edit, View, Help) are registered during service initialization, not Phase 3 DOM creation
  - Menu items can be contributed by tools via `contributes.menus` with location `menuBar/{menuId}`
  - Clicking a menu bar item opens a dropdown (basic implementation — no nested submenus required in M3)
  - Dropdown items are commands resolved from the contribution system
  - Menu bar renders using CSS classes, not inline styles
  - Keyboard navigation: Alt key focuses menu bar, arrow keys navigate, Enter opens/activates (matching VS Code)
- **Notes / Constraints:**
  - VS Code's menu bar is highly complex (native vs custom, auto-hide, compact mode). M3 implements the custom menu bar only (Electron frameless window style)
  - Dropdown rendering reuses patterns from the existing context menu in `menuContribution.ts`
  - The `Alt` key toggle is a standard Windows/Linux pattern — it should set focus on the first menu item

**Task 1.3 – Polish Window Controls**
- **Task Description:** Ensure window controls (minimize, maximize/restore, close) are correctly wired to Electron IPC and visually match VS Code's frameless window controls.
- **Output:** Window controls that properly reflect window state and respond to Electron events.
- **Completion Criteria:**
  - Minimize button sends `window:minimize` IPC
  - Maximize/restore button toggles and updates icon based on window state
  - Close button sends `window:close` IPC
  - Double-clicking the title bar drag region toggles maximize (platform convention)
  - Controls use CSS classes, not inline styles
  - Controls are hidden when running in a non-Electron context (future web support)
- **Notes / Constraints:**
  - Much of this already works from M1's Electron shell. This task is about polish and correctness, not rebuilding.
  - The maximize icon should change between "maximize" and "restore" symbols when the window state changes

---

## Capability 2 – Activity Bar (Left Icon Strip)

### Capability Description
The activity bar is a narrow vertical strip on the left edge of the workbench containing icons that switch between view containers in the sidebar. It provides the primary navigation for the sidebar's content. This capability wires the `ActivityBarPart` (created in Task 0.2) to the view container registry and implements VS Code's interaction model.

### Goals
- Icons are dynamically populated from registered view containers
- Clicking an icon activates the corresponding view container in the sidebar
- Clicking the already-active icon toggles sidebar visibility (collapses/expands)
- Active icon has a visual indicator (left border highlight)
- Badge indicators can show counts or dots on icons

### Dependencies
- Task 0.2 (ActivityBarPart promotion)

### VS Code Reference
- `src/vs/workbench/browser/parts/activitybar/activitybarPart.ts` — Activity bar rendering, action bar integration
- `src/vs/workbench/browser/parts/activitybar/activitybarActions.ts` — View container switching actions
- DeepWiki: [Layout System and Parts → Workbench Parts](https://deepwiki.com/microsoft/vscode/7.1-layout-system-and-parts)

#### Tasks

**Task 2.1 – Implement Activity Bar Icon Population**
- **Task Description:** Wire `ActivityBarPart` to dynamically populate icons from all registered sidebar view containers (both built-in and tool-contributed).
- **Output:** Activity bar icons that reflect registered view containers in real time.
- **Completion Criteria:**
  - On workbench initialization, activity bar renders one icon per sidebar view container
  - Icons are sourced from the view container's declared icon (text/emoji in M3, full icon support deferred)
  - Icons have a tooltip showing the container name (via `title` attribute)
  - Built-in containers appear first (top), tool-contributed containers appear below a visual separator
  - When a tool contributes a new sidebar container at runtime, a new icon appears dynamically
  - When a tool is deactivated and its containers are removed, the corresponding icon is removed
  - Icon order respects a priority value (lower = higher position)
  - `ActivityBarPart` queries `IViewService` or `ViewManager` for registered containers, not hardcoded lists
- **Notes / Constraints:**
  - Existing activity bar icon management code in `workbench.ts` (`_addContributedActivityBarIcon`, `_switchSidebarContainer`) moves into `ActivityBarPart`
  - The secondary activity bar (right side, for auxiliary bar) is not part of this task

**Task 2.2 – Implement Activity Bar Click Behavior**
- **Task Description:** Implement the VS Code interaction model for activity bar icon clicks.
- **Output:** Click handlers that toggle sidebar visibility and switch containers.
- **Completion Criteria:**
  - Clicking an inactive icon:
    1. Makes the sidebar visible (if hidden)
    2. Switches the sidebar to show that icon's view container
    3. Highlights the clicked icon as active
  - Clicking the already-active icon:
    1. Collapses the sidebar (`layoutService.setPartVisible(PartId.Sidebar, false)`)
    2. Deactivates the icon highlight
  - Clicking an icon while the sidebar is hidden:
    1. Shows the sidebar with the clicked container active
  - Active icon state is stored as a context key (`activeViewContainer`)
  - All sidebar show/hide goes through `ILayoutService` — no direct DOM manipulation
  - Behavior matches VS Code exactly: toggle = click active icon
- **Notes / Constraints:**
  - The sidebar collapse/expand must animate smoothly (CSS transition on width, or immediate — match VS Code which uses immediate)
  - Context key `sidebarVisible` must update when sidebar visibility changes

**Task 2.3 – Implement Activity Bar Badges**
- **Task Description:** Allow view containers to display badge indicators (count or dot) on their activity bar icons.
- **Output:** Badge rendering system on activity bar icons.
- **Completion Criteria:**
  - `ActivityBarPart` exposes `setBadge(containerId: string, badge: { count?: number, dot?: boolean } | undefined)` method
  - Badges render as a small overlay element on the icon (absolute positioned, top-right)
  - Count badges show a number (max "99+")
  - Dot badges show a small colored dot
  - Setting badge to `undefined` removes it
  - Badge API is exposed through the `parallx.views` namespace so tools can set badges on their containers
  - CSS classes: `.activity-bar-badge`, `.activity-bar-badge--count`, `.activity-bar-badge--dot`
- **Notes / Constraints:**
  - VS Code reference: `src/vs/workbench/browser/parts/compositeBarActions.ts` — Badge rendering on composite bar
  - Badges are transient state — they are not persisted across sessions
  - Badge background color: same as status bar background (#007acc) for visual consistency

---

## Capability 3 – Sidebar (Primary Side Panel)

### Capability Description
The sidebar is a vertically resizable, collapsible panel on the left side of the workbench (to the right of the activity bar) that hosts view containers. It already exists from M1/M2 with basic functionality. This capability polishes the resize interaction, collapse behavior, state persistence, and view container rendering to match VS Code's model.

### Goals
- Sidebar resizes smoothly via sash drag
- Sidebar collapses/expands via activity bar toggle, keyboard shortcut, and command
- Sidebar width persists across sessions
- View containers within the sidebar render with collapsible section headers
- View container content is properly clipped and scrollable

### Dependencies
- Capability 2 (Activity Bar — handles sidebar toggle via icon clicks)
- Task 0.1 (CSS migration)

### VS Code Reference
- `src/vs/workbench/browser/parts/sidebar/sidebarPart.ts` — Sidebar part implementation
- `src/vs/workbench/browser/parts/views/viewPaneContainer.ts` — View pane containers within sidebar
- DeepWiki: [Layout System and Parts → Part Visibility](https://deepwiki.com/microsoft/vscode/7.1-layout-system-and-parts)

#### Tasks

**Task 3.1 – Polish Sidebar Resize and Collapse**
- **Task Description:** Ensure the sidebar resize sash works smoothly and that collapse/expand is wired to all trigger points.
- **Output:** Sidebar with polished resize and collapse behavior.
- **Completion Criteria:**
  - Sash drag resizes sidebar between min (170px) and max (800px) widths
  - Sash cursor changes to `col-resize` on hover
  - `Ctrl+B` toggles sidebar visibility (registered via `KeybindingService` from Task 0.3)
  - `workbench.action.toggleSidebarVisibility` command toggles sidebar
  - Sidebar collapse is animated with a smooth width transition (150ms, or instant if user prefers reduced motion)
  - Sidebar width before collapse is remembered and restored on expand
  - Sidebar width is persisted in workspace state via `WorkspaceSaver`
  - When sidebar is hidden, the editor area expands to fill the space
  - Double-clicking the sash resets sidebar to default width (matching VS Code behavior)
- **Notes / Constraints:**
  - The sash handling from M1's `Grid` class provides the underlying resize — this task ensures the sash UX is correct and the collapse animation is smooth
  - State persistence already partially works from M1's workspace save/restore — this task verifies and fixes any gaps

**Task 3.2 – Implement View Container Section Headers**
- **Task Description:** Render view containers within the sidebar as collapsible sections with headers, matching VS Code's "View Pane Container" pattern where each view gets a collapsible accordion section.
- **Output:** Sidebar view containers render with expandable/collapsible sections.
- **Completion Criteria:**
  - When a sidebar view container has multiple views, each view renders as a collapsible section within the container
  - Each section has a header with: collapse/expand chevron (▸ / ▾), view title, optional action toolbar (ellipsis menu)
  - Clicking the header toggles section collapse
  - Right-clicking the header opens a context menu (wired to `view/title` menu contributions)
  - Section collapse state is persisted per workspace
  - When a container has only one view, the section header is hidden (view fills the container)
  - Sections resize proportionally within the container, with drag handles between them (vertical sash between stacked sections)
  - Keyboard: Enter/Space on focused header toggles collapse
- **Notes / Constraints:**
  - VS Code reference: `src/vs/workbench/browser/parts/views/viewPaneContainer.ts` — Multi-pane container
  - This is an enhancement to the existing `ViewContainer` class — it needs a "stacked mode" in addition to the existing "tabbed mode"
  - The sidebar uses stacked mode; the panel continues to use tabbed mode
  - Stacked mode means all views in the container are visible simultaneously in a vertical stack (collapsed sections take minimal height, expanded sections share remaining space)

---

## Capability 4 – Editor Area (Primary Content Region)

### Capability Description
The editor area is the central region of the workbench where tool-provided editors open as tabs. It supports single editors, split editors, tab strips, and tab management. The editor area already exists from M1/M2 with functional tab bars and split groups. This capability polishes the interaction model to match VS Code.

### Goals
- Tab strip interactions match VS Code (click, double-click, drag, close)
- Split editor creation via drag-to-edge and commands
- Editor groups manage properly (merge empty groups, preserve active state)
- Active editor is reflected in window title and context state
- Editor area shows a watermark when no editors are open

### Dependencies
- Task 0.1 (CSS migration for tabs)
- Task 0.3 (Keybinding service for shortcuts)

### VS Code Reference
- `src/vs/workbench/browser/parts/editor/editorGroupView.ts` — Editor group with tabs
- `src/vs/workbench/browser/parts/editor/editorPart.ts` — Editor Part managing groups
- DeepWiki: [Editor Service and Groups](https://deepwiki.com/microsoft/vscode/7.2-editor-service-and-groups) — Group operations, tab management

#### Tasks

**Task 4.1 – Polish Tab Interaction Behavior**
- **Task Description:** Ensure editor tabs implement the full VS Code interaction model.
- **Output:** Tab bar with complete mouse and keyboard interaction.
- **Completion Criteria:**
  - **Single click** on tab: activates that editor in the group
  - **Double click** on tab: pins the editor (removes preview/italic state)
  - **Middle click** (mousedown button 1) on tab: closes the editor
  - **Close button** ("×"): closes the editor; shows for active tab and on hover for others
  - **Drag tab** within same group: reorders tabs
  - **Drag tab** to another group: moves editor to target group
  - **Drag tab** to edge of editor area: creates new split group in that direction (left/right/top/bottom)
  - **Ctrl+W** / **Ctrl+F4**: closes active editor in focused group
  - **Ctrl+Tab**: shows editor picker (next editor in MRU order) — deferred to future milestone, but command registered
  - **Ctrl+Page Down** / **Ctrl+Page Up**: switches to next/previous tab in order
  - Preview editors (single-click opened) show tab label in italic; they are replaced by next preview open
  - Dirty indicator ("●") shows for unsaved editors; close button changes to dot
- **Notes / Constraints:**
  - Many of these behaviors already exist in `EditorGroupView` — this task is about verifying completeness and fixing gaps
  - Preview editor behavior is particularly important for VS Code parity

**Task 4.2 – Polish Split Editor UX**
- **Task Description:** Ensure split editor creation and management matches VS Code's behavior.
- **Output:** Split editors with proper visual feedback and management.
- **Completion Criteria:**
  - Dragging a tab to the left/right/top/bottom edge of the editor area shows a drop overlay indicating split direction
  - Dropping creates a new editor group in that direction with the dragged editor
  - Split commands (`workbench.action.splitEditor`, `workbench.action.splitEditorOrthogonal`) work via keybinding
  - `Ctrl+\` splits the active editor to the right (registered keybinding)
  - When an editor group becomes empty and `closeEmptyGroups` is true (default), the group is automatically removed
  - Remaining groups resize to fill the vacated space
  - Active group has a subtle visual indicator (e.g., brighter tab bar background or accent border)
  - Maximum of 3 visible groups (soft limit matching VS Code default — more can exist but warning logged)
  - Group positions persist across sessions via workspace state
- **Notes / Constraints:**
  - M1's `Grid` class handles the actual splitting. `EditorPart` already has `splitGroup()` and `removeGroup()`. This task ensures the UX layer triggers them correctly.
  - Drop overlay rendering uses M1's `DropOverlay` class

**Task 4.3 – Wire Editor State to Context**
- **Task Description:** Ensure the active editor, active editor group, and editor count are reflected in context keys and window title.
- **Output:** Context keys and window title update reactively with editor state.
- **Completion Criteria:**
  - Context key `activeEditor` updates to the active editor's `typeId` when editors change
  - Context key `activeEditorGroup` updates to the active group's ID
  - Context key `editorGroupCount` reflects the number of visible editor groups
  - Context key `activeEditorDirty` indicates whether the active editor has unsaved changes
  - Window title format: `{activeEditorTitle} — {workspaceName} — Parallx` (or `{workspaceName} — Parallx` if no editor is open)
  - `WorkbenchContextManager` subscribes to `EditorPart` and `EditorGroupView` events
  - When clause `editorGroupCount > 1` can be used to conditionally enable commands
- **Notes / Constraints:**
  - Many of these context keys already exist in `WorkbenchContextManager` — this task is about ensuring they update correctly in all scenarios (open, close, switch, split, merge)

**Task 4.4 – Implement Editor Watermark**
- **Task Description:** When no editors are open in any group, show a centered watermark with keyboard shortcut hints.
- **Output:** Watermark overlay in the editor area.
- **Completion Criteria:**
  - Watermark displays when all editor groups are empty
  - Shows Parallx logo/icon (text-based in M3)
  - Shows common keyboard shortcuts: "Ctrl+Shift+P Command Palette", "Ctrl+B Toggle Sidebar", "Ctrl+J Toggle Panel"
  - Shortcut text is sourced from the keybinding service (so it updates if bindings change)
  - Watermark fades out when an editor is opened
  - Watermark uses CSS classes, not inline styles
- **Notes / Constraints:**
  - VS Code reference: `src/vs/workbench/browser/parts/editor/editorStatus.ts` — Watermark rendering
  - EditorPart already has a `div.editor-watermark` — this task populates it with content

---

## Capability 5 – Bottom Panel

### Capability Description
The bottom panel is a collapsible, resizable region at the bottom of the workbench (below the editor area). It hosts view containers in a tabbed layout. It maps to VS Code's panel area where Terminal, Output, Problems, and Debug Console appear.

### Goals
- Panel toggles via keyboard shortcut and command
- Panel resizes via vertical sash drag
- Panel tabs switch between view containers
- Panel state (visibility, height, active tab) persists

### Dependencies
- Task 0.3 (Keybinding service for Ctrl+J)
- Task 0.1 (CSS migration)

### VS Code Reference
- `src/vs/workbench/browser/parts/panel/panelPart.ts` — Panel part implementation
- `src/vs/workbench/browser/parts/panel/panelActions.ts` — Panel toggle and maximize actions
- DeepWiki: [Layout System and Parts → Part Visibility](https://deepwiki.com/microsoft/vscode/7.1-layout-system-and-parts)

#### Tasks

**Task 5.1 – Polish Panel Toggle and Resize**
- **Task Description:** Ensure the panel toggles and resizes with VS Code-matching behavior.
- **Output:** Panel with polished toggle, resize, and state persistence.
- **Completion Criteria:**
  - `Ctrl+J` toggles panel visibility (registered via `KeybindingService`)
  - `workbench.action.togglePanel` command toggles panel visibility
  - Panel top border has a vertical sash for dragging to resize
  - Panel height persists between min (100px) and a maximum of 80% of the workbench height
  - Panel height before collapse is remembered and restored on expand
  - Panel height is persisted in workspace state
  - When panel is hidden, the editor area expands to fill the space
  - Double-clicking the sash resets panel to default height (matching VS Code behavior)
  - Context key `panelVisible` updates when panel visibility changes
  - Maximize: `workbench.action.toggleMaximizedPanel` command makes panel fill the editor area (toggle back restores original size)
- **Notes / Constraints:**
  - Panel already exists and is functional — this task is about ensuring the UX matches VS Code

**Task 5.2 – Polish Panel Tab Switching**
- **Task Description:** Ensure panel tabs (provided by the `ViewContainer`) work correctly and persist state.
- **Output:** Panel tabs with proper activation, ordering, and persistence.
- **Completion Criteria:**
  - Panel shows one tab per registered panel view container
  - Clicking a tab activates that container's views in the panel content area
  - Active tab has a visual bottom border indicator (accent color)
  - Tab order persists within workspace state
  - Drag-and-drop reordering of panel tabs updates persisted order
  - When a tool contributes a new panel container, a tab appears dynamically
  - When a tool is deactivated, its panel tab is removed
  - Keyboard: Left/Right arrow keys navigate tabs when tab bar is focused
- **Notes / Constraints:**
  - This mostly works already via `ViewContainer` — verify and fix gaps

---

## Capability 6 – Status Bar

### Capability Description
The status bar is a fixed-height strip at the bottom of the workbench displaying status entries contributed by tools and the shell. Entries can be clickable (triggering commands) and show tooltips.

### Goals
- Status bar entries are data-driven from contributions
- Entries are interactive (click triggers command)
- Entries update reactively from context/state changes
- Left/right alignment matches VS Code convention

### Dependencies
- Task 0.1 (CSS migration)

### VS Code Reference
- `src/vs/workbench/browser/parts/statusbar/statusbarPart.ts` — Status bar rendering
- `src/vs/workbench/browser/parts/statusbar/statusbarModel.ts` — Status bar entry model

#### Tasks

**Task 6.1 – Wire Status Bar to Contribution System**
- **Task Description:** Ensure status bar entries come from the contribution system and are not hardcoded in `workbench.ts`.
- **Output:** Status bar populated dynamically from registered entries.
- **Completion Criteria:**
  - Default status bar entries (workspace name, line/column indicator, notifications) are registered through a `StatusBarContribution` pattern, not hardcoded DOM creation
  - Tools can contribute status bar entries via manifest `contributes.statusBar` or runtime API `parallx.window.createStatusBarItem()`
  - Each entry has: `id`, `text`, `tooltip`, `command` (optional), `alignment` (left/right), `priority` (sort order)
  - Clicking an entry with a `command` executes that command via `commandService.executeCommand()`
  - Entries with commands show `cursor: pointer` on hover
  - Entry text can include codicon-style icons (text placeholders in M3: `$(icon-name)` syntax parsed to emoji or text)
  - `StatusBarPart.addEntry()` API is already implemented — verify it integrates with contribution system
  - Status bar updates when context keys change (e.g., notification count badge)
- **Notes / Constraints:**
  - No new status bar entry for M3 — keep it minimal. Default entries: workspace name (left), notification indicator (right)
  - VS Code puts many entries in the status bar (language, encoding, line endings, git branch, etc.) — Parallx adds entries as tools contribute them
  - Consider adding `parallx.window.createStatusBarItem()` to the API if not already present

**Task 6.2 – Implement Status Bar Hide/Show**
- **Task Description:** Allow the status bar to be hidden/shown via command, matching VS Code's behavior.
- **Output:** Status bar toggle command and state persistence.
- **Completion Criteria:**
  - `workbench.action.toggleStatusbarVisibility` command toggles status bar
  - Status bar visibility persisted in workspace state
  - Context key `statusBarVisible` updates
  - When hidden, the panel or editor area fills the vacated space (22px)
- **Notes / Constraints:**
  - VS Code allows hiding the status bar via Settings and View menu — in M3, the command is sufficient

---

## Capability 7 – Quick Access (Command Palette & More)

### Capability Description
Quick Access is the unified text-input-driven navigation system for the workbench. It subsumes the Command Palette and provides prefixed modes for different kinds of access (commands, workspaces, views, etc.). The Command Palette already exists from M2 — this capability evolves it into a proper Quick Access system.

### Goals
- Quick Access serves as the universal entry point for commands, workspace switching, and view navigation
- Prefix modes (`>` for commands, no prefix for file/workspace access) match VS Code
- Workspace switching uses Quick Access, not a custom dropdown
- All execution routes through `commandService.executeCommand()`

### Dependencies
- Task 0.3 (Keybinding service — Quick Access triggered by keybinding)
- Capability 2 (Activity bar — for view container switching results)

### VS Code Reference
- `src/vs/workbench/contrib/quickaccess/browser/quickAccess.ts` — Quick Access coordinator
- `src/vs/workbench/contrib/quickaccess/browser/commandsQuickAccess.ts` — Command palette mode
- `src/vs/workbench/services/quickinput/browser/quickInputService.ts` — Quick input UI

#### Tasks

**Task 7.1 – Evolve Command Palette into Quick Access**
- **Task Description:** Refactor the existing `CommandPalette` class into a `QuickAccessWidget` that supports multiple modes based on input prefix.
- **Output:** `QuickAccessWidget` in `src/commands/quickAccess.ts` (or refactored `commandPalette.ts`).
- **Completion Criteria:**
  - `Ctrl+Shift+P` opens Quick Access with `>` prefix pre-filled (command mode — same as current behavior)
  - `Ctrl+P` opens Quick Access with no prefix (general access mode — future file picker, for now shows recent workspaces and navigation targets)
  - Input starting with `>` filters commands (existing command palette behavior)
  - Input starting with no prefix shows: recent workspaces, registered views (for quick navigation to sidebar sections)
  - Backspacing past the `>` prefix switches from command mode to general mode
  - Typing `>` in general mode switches to command mode
  - All existing command palette features preserved: fuzzy search, when-clause filtering, keybinding display, recent commands, arrow keys, Enter, Escape
  - Quick Access position: centered at top of workbench, 600px wide (matching current commandPalette)
  - Backdrop dims the rest of the UI
- **Notes / Constraints:**
  - VS Code has many Quick Access modes (`@` for symbols, `:` for go-to-line, `#` for workspace symbols, `?` for help). M3 implements only `>` (commands) and no-prefix (workspace/navigation). Additional modes can be added in future milestones.
  - The existing `CommandPalette` class can be refactored in-place — a full rewrite is unnecessary
  - The file is likely renamed from `commandPalette.ts` to `quickAccess.ts` with a re-export for compatibility

**Task 7.2 – Implement Workspace Switching via Quick Access**
- **Task Description:** Implement workspace selection through Quick Access when opened without a command prefix.
- **Output:** Workspace list in Quick Access results.
- **Completion Criteria:**
  - When Quick Access is opened with `Ctrl+P` (no prefix mode), recent workspaces appear in the results list
  - Each result shows workspace name and last-accessed timestamp
  - Selecting a workspace invokes `workspaceService.switchWorkspace(workspaceId)`
  - `workbench.action.openWorkspace` command opens Quick Access in no-prefix mode
  - `Ctrl+K Ctrl+O` chord opens Quick Access in no-prefix mode (VS Code default open workspace binding)
  - Current workspace is highlighted/excluded from the list
  - Quick Access dismisses after selection
  - Workbench triggers reload lifecycle on workspace switch (existing M1 behavior)
- **Notes / Constraints:**
  - No custom dropdown — all workspace switching goes through Quick Access
  - The recent workspace list comes from `RecentWorkspaces` class (M1 Capability 6)
  - Future milestones can add "Open Folder" and "Open File" results to no-prefix mode

---

## Capability 8 – Focus Model & Keyboard Navigation

### Capability Description
The workbench has a clear focus model where exactly one region (part) is active at a time. Focus changes update context keys, which in turn affect command enablement and keybinding resolution. Keyboard shortcuts allow cycling between regions without using the mouse.

### Goals
- One region is focally active at all times
- Focus changes update context keys instantly
- Standard keyboard shortcuts navigate between regions
- Keybindings respect the active focus region for context-conditional resolution

### Dependencies
- Task 0.3 (Keybinding service)
- All part capabilities (1–6, for render completeness)

### VS Code Reference
- `src/vs/platform/contextkey` — Context key system
- `src/vs/workbench/browser/layout.ts` — Focus management in layout
- DeepWiki: [Context Keys and State Management](https://deepwiki.com/microsoft/vscode/7.4-context-keys-and-state-management)

#### Tasks

**Task 8.1 – Implement Region Focus Shortcuts**
- **Task Description:** Register keybindings that move focus between workbench regions, matching VS Code defaults.
- **Output:** Focus navigation commands registered in keybinding service.
- **Completion Criteria:**
  - `Ctrl+1` focuses the first editor group (`workbench.action.focusFirstEditorGroup`)
  - `Ctrl+2`, `Ctrl+3` focus second and third editor groups (if they exist)
  - `Ctrl+0` focuses the sidebar (`workbench.action.focusSideBar`)
  - `` Ctrl+` `` focuses the panel (terminal area) (`workbench.action.focusPanel`)
  - `F6` cycles focus forward through regions: Activity Bar → Sidebar → Editor → Panel → Status Bar → Activity Bar
  - `Shift+F6` cycles focus backward through regions
  - Each focus command calls `focusTracker.focusPart(partId)` which sets DOM focus on the part's first focusable element
  - When a region receives focus, context keys `focusedPart` and `activePart` update
  - Commands are no-ops when their target region is hidden (e.g., Ctrl+0 when sidebar is collapsed)
- **Notes / Constraints:**
  - VS Code reference: `src/vs/workbench/browser/actions/layoutActions.ts` — Focus region actions
  - `FocusTracker` already handles `focusin`/`focusout` and resolves focused part/view. This task adds the explicit focus commands.
  - F6 cycling order should skip hidden parts

**Task 8.2 – Ensure Context-Driven Command Enablement in UI**
- **Task Description:** Verify that all UI surfaces (command palette, menus, toolbar actions) correctly evaluate when clauses against current context before showing or enabling commands.
- **Output:** Context-aware UI across all interactive surfaces.
- **Completion Criteria:**
  - Command palette hides commands whose `when` clause is not satisfied (already works — verify)
  - Menu dropdown items are grayed out or hidden when their `when` clause is not satisfied
  - View title toolbar actions respect `when` clauses
  - Context menu items respect `when` clauses
  - Status bar entries with commands respect enablement
  - When context changes (focus moves, sidebar toggles, etc.), visible menus/toolbars update immediately
  - Example verified: a command with `when: "sidebarVisible"` is hidden in palette when sidebar is collapsed
  - Example verified: a command with `when: "editorGroupCount > 1"` is hidden when only one editor group exists
- **Notes / Constraints:**
  - This is primarily a verification/bugfix task — the when-clause infrastructure exists from M1/M2
  - Focus on the integration points where context meets UI

**Task 8.3 – Implement Tab Trapping and Focus Containment**
- **Task Description:** When an overlay is open (Quick Access, dropdown menu, context menu, notification), keyboard focus is trapped within the overlay until it is dismissed.
- **Output:** Focus trap behavior for modal/overlay UI elements.
- **Completion Criteria:**
  - When Quick Access is open, Tab cycles only within Quick Access elements (input, results)
  - When a dropdown menu is open, arrow keys navigate within the menu; Tab/Escape close it
  - When a context menu is open, focus is contained within the menu
  - Pressing Escape always dismisses the current overlay and restores focus to the previously focused element
  - `FocusTracker` suspends workbench focus tracking while an overlay is open (uses existing `suspend()`/`resume()`)
  - No accessibility focus escapes (screen reader users cannot tab into the workbench behind an overlay)
- **Notes / Constraints:**
  - Focus trapping is an accessibility requirement — important for keyboard-only users
  - Use `aria-modal="true"` and `role="dialog"` on overlay containers
  - The `FocusTracker` already has `suspend()`/`resume()` — wire them to overlay open/close

---

## Capability 9 – Notification Center

### Capability Description
Wire the existing `NotificationService` (M2 API) to a visible notification center in the workbench. Notifications appear as toasts and can be reviewed in a notification list.

### Goals
- Tool-originated notifications are visible in the workbench
- Notifications can be dismissed individually or all at once
- A notification indicator in the status bar shows unread count

### Dependencies
- Capability 6 (Status bar — for notification indicator)

### VS Code Reference
- `src/vs/workbench/browser/parts/notifications/notificationsList.ts` — Notification list rendering
- `src/vs/workbench/browser/parts/notifications/notificationsToasts.ts` — Toast rendering

#### Tasks

**Task 9.1 – Wire Notification Toasts to Workbench**
- **Task Description:** Ensure the existing `NotificationService` toast UI renders correctly within the workbench layout and doesn't conflict with other overlays.
- **Output:** Notification toasts visible in bottom-right of workbench.
- **Completion Criteria:**
  - `parallx.window.showInformationMessage()`, `showWarningMessage()`, `showErrorMessage()` display visible toasts
  - Toasts appear in the bottom-right corner, above the status bar
  - Toasts auto-dismiss after timeout (5 seconds default)
  - Toasts stack vertically (newest on top)
  - Toast dismissal has a fade-out animation
  - Toasts don't overlap with Quick Access or other overlays (z-index layering is correct)
  - Status bar shows a notification count badge (bell icon + count) when notifications are active
  - Clicking the status bar notification badge opens a notification center dropdown (list of recent notifications)
- **Notes / Constraints:**
  - The `NotificationService` already renders toasts — this task is about integration and polish, not rebuilding
  - The notification center dropdown is a simple scrollable list — not a full notification tray

---

## Milestone 3 Outcome

When Milestone 3 is complete:

1. **Visual Parity** — Parallx visually resembles a functional VS Code workbench with all standard regions rendered and interactive.
2. **Interaction Parity** — All structural UI responds to mouse and keyboard in ways that match VS Code's interaction model.
3. **Command Routing** — All user actions route through `commandService.executeCommand()` via the keybinding service or UI event handlers — no direct function calls from UI.
4. **State Persistence** — All UI state (part visibility, sizes, active tabs, focus, sidebar width, panel height) persists across sessions via the workspace state system.
5. **Context Correctness** — Context keys accurately reflect workbench state at all times, enabling correct command enablement and when-clause evaluation.
6. **Keyboard Operability** — Every mouse interaction has a keyboard equivalent. Focus can be navigated entirely by keyboard.
7. **Tool Integration** — Tools can contribute to all UI surfaces (activity bar, sidebar, panel, editor, status bar, menus) through the M2 contribution system, and those contributions render correctly in the M3 UI.

### What Milestone 3 Does NOT Deliver
- Theming or appearance customization (single dark theme only)
- Settings UI (configuration is API-only)
- Multi-window support
- Breadcrumbs or file path navigation
- Search/Find across workbench
- Source control or git integration UI
- Terminal emulation
- Any domain-specific content or tools

---

## Expert Notes & Pushback

The following items are recommendations based on analysis of the codebase and VS Code architecture. They deviate from or expand on the original notes.

### 1. Global Keybinding Service is the #1 Priority
The codebase currently has **no global keybinding dispatcher**. The Command Palette has a hardcoded `Ctrl+Shift+P` listener, and `KeybindingContributionProcessor` registers tool keybindings but with a simple listener. Without a centralized keybinding service (Task 0.3), none of the keyboard shortcuts (Ctrl+B, Ctrl+J, Ctrl+1, F6, etc.) can be implemented cleanly. **This should be the first task attempted in M3**.

### 2. Activity Bar Must Be a Proper Part
The activity bar currently exists as an ad-hoc `div.activity-bar` created directly in `workbench.ts` with no Part lifecycle, no grid participation, and no state persistence methods. Promoting it to a proper `ActivityBarPart` (Task 0.2) is prerequisite for most of Capability 2 and affects the grid topology. **This is the second highest priority**.

### 3. CSS Migration is Technical Hygiene, Not Cosmetic
Parts create DOM with heavy inline `element.style.*` usage alongside the CSS file. This creates maintenance burden and blocks theming. The migration (Task 0.1) should happen early in M3 but can be done incrementally — one part at a time — alongside the capability work.

### 4. Sidebar Should Use Stacked Sections, Not Tabs
The original notes describe "View Container" rendering with headers, collapse arrows, and context menus. This is VS Code's "View Pane Container" pattern — a vertical stack of collapsible sections — which is different from the tab bar pattern. Currently, the sidebar view container uses a tabbed interface (inherited from `ViewContainer`). M3 should introduce a **stacked section mode** for the sidebar while the panel keeps the tab mode. This is a significant UI change.

### 5. Quick Access vs Command Palette
The notes have "Command Palette" (Capability 7) and "Workspace switching" (Task 1.2) as separate items. In VS Code, both are handled by the **Quick Access** system — a single widget with different modes. The `>` prefix triggers command mode; no prefix triggers file/workspace mode. M3 should unify these under a single Quick Access widget rather than building separate UIs.

### 6. Chord Keybindings Are Needed for Workspace Switching
The notes specify `Ctrl+K Ctrl+O` for opening a workspace. This is a **chord** — a two-key sequence. The keybinding service must support chords (first key puts the service into a "waiting for second key" state with a timeout). This is non-trivial and should be part of Task 0.3, not an afterthought.

### 7. Notification Center is Low Priority
The notification toast system already exists in M2's `NotificationService`. Adding a notification center dropdown (Capability 9) is useful but is the lowest-priority capability in M3. If time is constrained, it can ship as toast-only with the status bar badge, deferring the dropdown list to M4.

### 8. No Panel Position Switching in M3
VS Code allows moving the panel to the left, right, or bottom. The original notes don't mention this, and the grid topology from M1 has the panel fixed at the bottom. **M3 should not implement panel position switching** — the bottom position is correct and sufficient. This avoids grid topology changes.
