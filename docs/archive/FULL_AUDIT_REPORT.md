# Parallx Full Codebase Audit Report

**Date:** 2025-01-XX  
**Scope:** All milestones (M1, M2, M3 Caps 0–4)  
**Method:** Every component compared against VS Code `microsoft/vscode` actual source code (TypeScript + CSS)

---

## Executive Summary

The audit compared every major Parallx component against VS Code's actual source code from the `microsoft/vscode` repository. Findings are organized by component with severity ratings.

**Critical findings:**
1. **~60+ inline style violations** across 6 files — directly violates project rules
2. **Direct Electron IPC access** (`window.parallxElectron`) from Part class — violates architecture rules
3. **Missing keyboard navigation** in activity bar — no arrow key movement between icons
4. **Missing context menus** in activity bar and status bar
5. **ViewContainer has 30+ inline styles** for visual properties that should be CSS classes

**Positive findings:**
1. Title bar DOM structure generally matches VS Code (drag region prepend, left/center/right slots)
2. Editor part with nested Grid, split groups, watermark, drop target — well structured
3. Activity bar badge system matches VS Code's NumberBadge/IconBadge concept
4. Keybinding service with chord support is solid
5. Disposable/Emitter patterns used consistently

---

## 1. Title Bar (Cap 1) — Severity: MEDIUM

### VS Code's actual DOM (from `titlebarPart.ts` lines 449–553):
```
.part.titlebar
  .titlebar-container (flex, overflow: hidden, user-select: none)
    .titlebar-drag-region (position: absolute, inset: 0, -webkit-app-region: drag)
    .titlebar-left
      .window-appicon (Windows/Linux only, via prepend())
      menubar (via CustomMenubarControl — separate class)
    .titlebar-center
      .window-title (font-size: 12px, text-overflow: ellipsis)
    .titlebar-right
      .action-toolbar-container (WorkbenchToolBar)
      .window-controls-container (z-index: 3000, -webkit-app-region: no-drag)
        div.window-icon.window-minimize (Codicon.chromeMinimize)
        div.window-icon.window-max-restore (toggles codicon)
        div.window-icon.window-close (Codicon.chromeClose)
```

### Parallx's actual DOM:
```
.part.part-parallx-titlebar
  .part-content
    .titlebar-container
      .titlebar-drag-region (prepended ✓)
      .titlebar-left.titlebar-menubar [role=menubar]
        span.titlebar-app-icon
        span.titlebar-menu-item (multiple)
      .titlebar-center
        span.titlebar-workspace-label [role=button]
      .titlebar-right
        div.window-controls
          button.window-control-btn (minimize, text: ─)
          button.window-control-btn (maximize, text: □)
          button.window-control-btn.window-control-btn--close (text: ✕)
```

### Gaps:

| # | Issue | VS Code Pattern | Parallx Current | Severity |
|---|-------|----------------|-----------------|----------|
| T1 | Window control icons | Codicon glyphs via CSS class | Text characters (─, □, ✕) | Low |
| T2 | Window controls container | `.window-controls-container` with `-webkit-app-region: no-drag` | `.window-controls` — no explicit no-drag | Medium |
| T3 | Inactive state | `onBlur()`/`onFocus()` → `isInactive` + `updateStyles()` for dimmed colors | Not implemented | Medium |
| T4 | Menu bar element type | `div.menubar-menu-button` via CustomMenubarControl class | `span.titlebar-menu-item` created directly | Low |
| T5 | Dropdown inline styles | Not applicable (VS Code uses its own context view system) | `style.position = 'fixed'`, `style.top`, `style.left` on dropdown | Medium |
| T6 | Direct Electron IPC | Injected via service (`INativeHostService`) | `(window as any).parallxElectron` in Part class | **High** |
| T7 | Window title format | `WindowTitle` class manages title template | Manual `document.title` updates | Low |

### T6 Detail — Architecture Violation
```typescript
// titlebarPart.ts line 554
const api = (window as any).parallxElectron as ElectronWindowApi | undefined;
```
The project instructions explicitly state: *"No direct IPC calls from UI code; no `window.parallxElectron` in Part classes."* The Electron API should be injected via a service.

---

## 2. Activity Bar (Cap 2) — Severity: MEDIUM-HIGH

### VS Code's actual pattern (from `activitybarPart.ts`, `compositeBar.ts`, `compositeBarActions.ts`):
- `ActivitybarPart extends Part` → creates content area with `.content`
- Lazy-creates `PaneCompositeBar` → `CompositeBar` → `ActionBar`
- `ActionBar` provides `role="tablist"`, keyboard navigation (ArrowUp/ArrowDown/Home/End)
- Icons via `a.action-label` with codicon CSS background
- Badge: `.badge > .badge-content` with `show()/hide()` CSS class toggle
- Active indicator: `.active-item-indicator` with `::before` pseudo-element
- Context menu: right-click shows pin/unpin, position options
- DnD: Items are reorderable via `CompositeDragAndDropObserver`
- Global activity bar (accounts, settings) at bottom via `GlobalCompositeBar`

### Gaps:

| # | Issue | VS Code Pattern | Parallx Current | Severity |
|---|-------|----------------|-----------------|----------|
| A1 | Keyboard navigation | ActionBar with full arrow key + Home/End navigation | None — no keyboard nav between icons | **High** |
| A2 | Context menu | Right-click → pin/unpin, hide, position menu | None | Medium |
| A3 | Drag-and-drop reorder | CompositeDragAndDropObserver | None | Low |
| A4 | Badge visibility toggle | `show(badge)`/`hide(badge)` CSS class | `badge.style.display = 'none'/'';` inline style | Medium |
| A5 | Icon rendering | Codicon CSS class on `a.action-label` | Text emoji on `span.activity-bar-icon-label` | Low |
| A6 | Overflow handling | CompositeOverflowActivityAction with "..." button | None | Low |
| A7 | Action bar abstraction | Uses ActionBar from `src/vs/base/browser/ui/actionbar/` | Direct button creation | Medium |

### A1 Detail — Missing Keyboard Navigation
VS Code's `CompositeBar.create()` creates an `ActionBar` with:
```typescript
this.compositeSwitcherBar = new ActionBar(actionBarDiv, {
  ariaLabel: 'Active View Switcher',
  ariaRole: 'tablist',
  preventLoopNavigation: true,
  triggerKeys: { keyDown: true }
});
```
This gives automatic keyboard navigation. Parallx creates buttons directly with no keyboard nav at all.

---

## 3. Sidebar (Cap 3) — Severity: MEDIUM

### VS Code's actual pattern:
- `SidebarPart extends AbstractPaneCompositePart extends CompositePart extends Part`
- CompositePart provides: `createTitleArea()` with title label + toolbar, `createContentArea()` with progress bar
- `AbstractPaneCompositePart` adds: composite bar (top/bottom), focus tracking, composite open/close
- Title area shows active view container name with "Views and More Actions..." toolbar

### Gaps:

| # | Issue | VS Code Pattern | Parallx Current | Severity |
|---|-------|----------------|-----------------|----------|
| S1 | Class hierarchy | 4-level: Part → CompositePart → AbstractPaneCompositePart → SidebarPart | 1-level: Part → SidebarPart (93 lines) | Low |
| S2 | Title area content | Shows view name + toolbar with view actions | Empty header slot | Medium |
| S3 | Composite system | Full composite open/close/switch lifecycle | Direct ViewContainer mounting | Low |
| S4 | ViewContainer inline styles | N/A | **30+ inline style violations** in viewContainer.ts | **High** |
| S5 | PlaceholderViews inline styles | N/A | **30+ inline style violations** in placeholderViews.ts | **High** |

### S4/S5 Detail — Inline Style Violations
```typescript
// viewContainer.ts lines 98-119
this._element.style.display = 'flex';
this._element.style.flexDirection = 'column';
this._element.style.overflow = 'hidden';
this._element.style.position = 'relative';
this._tabBar.style.display = 'flex';
this._tabBar.style.alignItems = 'center';
this._tabBar.style.height = `${this._tabBarHeight}px`;
// ... 6 more

// viewContainer.ts lines 698-705 (tab creation)
tab.style.display = 'flex';
tab.style.alignItems = 'center';
tab.style.padding = '0 12px';
tab.style.cursor = 'pointer';
tab.style.whiteSpace = 'nowrap';
tab.style.height = '100%';
tab.style.userSelect = 'none';
tab.style.fontSize = '13px';
```

```typescript
// placeholderViews.ts lines 73-76
container.style.padding = '8px';
container.style.color = '#cccccc';
container.style.fontSize = '13px';
container.style.backgroundColor = '#252526';

// placeholderViews.ts lines 146-155 (input element)
input.style.width = '100%';
input.style.padding = '6px 8px';
input.style.border = '1px solid #3c3c3c';
input.style.borderRadius = '2px';
input.style.backgroundColor = '#3c3c3c';
input.style.color = '#cccccc';
input.style.marginBottom = '8px';
input.style.fontSize = '13px';
input.style.outline = 'none';
input.style.boxSizing = 'border-box';
```

These are all **visual properties** (colors, padding, fonts, backgrounds) that per project rules MUST be in CSS classes.

---

## 4. Editor Area (Cap 4) — Severity: LOW-MEDIUM

### VS Code's actual pattern:
- `EditorPart extends Part` → `createContentArea()` with container → grid control → DnD setup
- `EditorGroupView` manages tab bar, editor panes, focus
- Edge splits via `setupDragAndDropSupport()` on the part container
- `CenteredLayoutWidget` for centered editing mode
- Context keys: `multipleEditorGroups`, `activeEditorGroupIndex`, etc.

### Gaps:

| # | Issue | VS Code Pattern | Parallx Current | Severity |
|---|-------|----------------|-----------------|----------|
| E1 | Drop overlay inline styles | N/A (VS Code uses CSS classes) | `style.position`, `style.inset`, `style.zIndex`, `style.pointerEvents` | Medium |
| E2 | Centered layout | CenteredLayoutWidget | Not implemented | Low |
| E3 | Tab close animation | CSS transition on tab width | Not verified | Low |

The editor part is the most solid component. Core functionality (grid, splits, watermark, DnD) works correctly.

---

## 5. Panel (Cap 5) — NOT IMPLEMENTED

87-line shell with `_tabBarSlot` and `_viewContainerSlot`. Cap 5 tasks not started. Expected.

---

## 6. Status Bar (Cap 6) — Severity: LOW

### VS Code's actual pattern (from `statusbarPart.ts` lines 405-431):
```typescript
this.leftItemsContainer = $('.left-items.items-container');
this.rightItemsContainer = $('.right-items.items-container');
this.element.tabIndex = 0;
// + context menu + StatusBarFocused context key
```

### Gaps:

| # | Issue | VS Code Pattern | Parallx Current | Severity |
|---|-------|----------------|-----------------|----------|
| SB1 | Context menu | Right-click to hide/show items | None | Low |
| SB2 | Focus management | `tabIndex = 0`, `StatusBarFocused` context key | None | Low |
| SB3 | Class names | `.left-items.items-container` | `.statusbar-left` | Low |

Functional for basic use. Missing features are Cap 6 scope.

---

## 7. Cross-Cutting: Inline Style Violations

### Summary by file:

| File | Count | Type | Severity |
|------|-------|------|----------|
| `views/viewContainer.ts` | ~30 | Visual: display, flex, padding, cursor, fontSize, etc. | **HIGH** |
| `views/placeholderViews.ts` | ~30 | Visual: colors, padding, fonts, backgrounds, borders | **HIGH** |
| `views/view.ts` | 5 | Mixed: overflow, position (layout), display | Medium |
| `editor/editorDropTarget.ts` | 5 | Visual: position, inset, zIndex, pointerEvents | Medium |
| `parts/activityBarPart.ts` | 4 | Visual: badge display toggle | Medium |
| `workbench/workbench.ts` | 4 | Visual: context menu styled inline | Medium |
| `parts/titlebarPart.ts` | 3 | Visual: dropdown positioning | Medium |

**Total: ~80+ inline style usages, ~60+ of which are visual properties that MUST be CSS classes per project rules.**

### Allowed (per rules):
- `element.style.width/height` for computed layout dimensions ✓
- `section.body.style.height` for dynamic section sizing ✓

---

## 8. Architecture Rule Violations

| # | Rule | Violation | Location |
|---|------|-----------|----------|
| AR1 | "No `window.parallxElectron` in Part classes" | Direct access to `(window as any).parallxElectron` | titlebarPart.ts line 554 |
| AR2 | "No inline `element.style.*` for visual properties" | 60+ violations across 6 files | See section 7 |
| AR3 | "Before implementing any visual element, check `src/ui/` for an existing component" | ViewContainer tab bar built from scratch instead of using `src/ui/tabBar.ts` | viewContainer.ts |
| AR4 | "If a UI interaction could appear in more than one place, it MUST be a component in `src/ui/`" | Dropdown menus built inline in titlebarPart.ts instead of a reusable component | titlebarPart.ts |

---

## 9. Priority Fix Order

### P0 — Must fix (rule violations, broken patterns)
1. ✅ **Move all visual inline styles to CSS classes** — viewContainer.ts, placeholderViews.ts, view.ts, editorDropTarget.ts, activityBarPart.ts
2. ✅ **Extract Electron IPC from TitlebarPart** — created `WindowService` in `src/services/windowService.ts`, wired via `IWindowService` interface
3. ✅ **Extract dropdown menu to `src/ui/` component** — created `src/ui/contextMenu.ts`, refactored titlebar and workbench context menus

### P1 — Should fix (VS Code parity gaps affecting UX)
4. ✅ **Add keyboard navigation to activity bar** — VS Code `ActionBar` pattern: Up/Down/Home/End/Enter/Space, roving tabindex, `role="tablist"`, `aria-selected`
5. ✅ **Add window inactive state to title bar** — window blur/focus toggles `.inactive` class on titlebar, dims text + controls via existing CSS
6. ✅ **Populate sidebar header** — shows active view container name (dynamic) + actions toolbar with "More Actions" ellipsis button

### P2 — Nice to have (polish items)
7. ✅ **Add context menu to activity bar** — right-click fires `onDidContextMenuIcon`, wired to `ContextMenu` component
8. ✅ **Add context menu to status bar** — right-click fires `onDidContextMenu`, shows entry list via `ContextMenu`
9. ✅ **Replace text glyph window controls with proper SVG icons** — minimize/maximize/restore/close use inline SVGs with `currentColor`
10. ✅ **Add `-webkit-app-region: no-drag` to window controls container** — CSS already existed from prior work

---

## 10. What's Working Well

- **Part base class** — clean Disposable + Emitter pattern, correct grid integration
- **Editor Part** — solid grid-based multi-group editor with splits, DnD, watermark
- **Keybinding Service** — chord support, centralized dispatch, proper priority handling
- **Title bar structure** — drag region prepend pattern matches VS Code
- **Activity bar badges** — NumberBadge/IconBadge concept implemented correctly
- **CSS migration (Cap 0)** — 158 inline styles previously migrated to CSS classes (some regressed)
- **Configuration system** — proper service with typed access
- **Tool extensibility (M2)** — manifest validation, activation events, error isolation

