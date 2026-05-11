# Canvas Menu Registry — Architecture & Rollout Plan

> **Status:** Phase 1 in progress  
> **Branch:** `canvas-v2`  
> **Baseline:** commit `edb803a` (BlockActionMenuController extraction)

---

## 1. Current State

The canvas editor has **6 independent menu surfaces** living in `src/built-in/canvas/menus/`:

| # | Surface | File | Lines | Pattern | Lifecycle |
|---|---------|------|-------|---------|-----------|
| 1 | Slash menu | `slashMenu.ts` | 276 | Controller class | Persistent |
| 2 | Bubble menu | `bubbleMenu.ts` | 303 | Controller class | Persistent |
| 3 | Block action menu | `blockActionMenu.ts` | 447 | Controller class | Persistent |
| 4 | Image insert popup | `imageInsertPopup.ts` | 202 | Standalone function | Ephemeral |
| 5 | Media insert popup | `mediaInsertPopup.ts` | 328 | Standalone function | Ephemeral |
| 6 | Bookmark insert popup | `bookmarkInsertPopup.ts` | 198 | Standalone function | Ephemeral |

### 1.1 Current Mutual Exclusion

Manual, incomplete, and scattered across `canvasEditorProvider.ts`:

```typescript
// onTransaction — slash wins over bubble
if (this._slashMenu?.visible) {
  this._bubbleMenu?.hide();
}

// onSelectionUpdate — non-empty selection kills slash
if (!editor.state.selection.empty) {
  this._slashMenu?.hide();
}
```

No mutual exclusion exists between:
- Block action menu ↔ slash/bubble  
- Any popup ↔ any other menu  

### 1.2 Current Outside-Click Handling

Three different patterns:

| Surface | Strategy |
|---------|----------|
| SlashMenu | **None** — relies on `checkTrigger()` on every transaction + `onBlur` 150ms delay |
| BubbleMenu | **None** — relies on `onBlur` 150ms delay with `contains(activeElement)` check |
| BlockActionMenu | Own `document.addEventListener('mousedown', _onDocClickOutside)` — checks menu + submenus + anchor |
| 3 Popups | Own per-popup `mousedown` listener with `requestAnimationFrame` delay |

### 1.3 Current Interaction Arbitration

Duplicated checks with inconsistent coverage:

| Surface | Locks checked |
|---------|---------------|
| SlashMenu | `column-resizing`, `dragging` |
| BubbleMenu | `column-resizing`, `column-resize-hover`, `block-handle-interacting`, `dragging` |
| BlockActionMenu | `column-resizing` (in outside-click handler only) |
| Popups | None |

### 1.4 Problems

1. **No mutual exclusion** — Slash + block action can both be visible simultaneously.
2. **3 different outside-click patterns** — fragile, inconsistent, easy to regress.
3. **Duplicated interaction arbitration** — SlashMenu misses `column-resize-hover` and `block-handle-interacting`; BlockActionMenu only checks column-resizing reactively.
4. **No `hideAll()` / `isAnyVisible()`** — canvasEditorPane dispose chain-calls `.hide()` on each surface individually.
5. **CanvasEditorPane is growing** — manual wiring of 6+ controllers with ad-hoc coordination.

---

## 2. Proposed Architecture

### 2.1 `ICanvasMenu` Interface

```typescript
export interface ICanvasMenu {
  /** Unique identifier (e.g. 'slash-menu', 'bubble-menu'). */
  readonly id: string;
  
  /** Whether this menu is currently visible. */
  readonly visible: boolean;
  
  /**
   * Returns true if the given DOM node is "inside" this menu.
   * Used by the registry's outside-click handler.
   * Each menu knows its own containment rules (submenus, anchors, etc.).
   */
  containsTarget(target: Node): boolean;
  
  /** Hide the menu and all its submenus. */
  hide(): void;
}
```

### 2.2 `CanvasMenuRegistry` Class

```typescript
export class CanvasMenuRegistry {
  private _menus: Map<string, ICanvasMenu>;
  private _outsideClickHandler: (e: MouseEvent) => void;
  
  constructor(getEditor: () => Editor | null);
  
  /** Register a menu. Returns a disposable to unregister. */
  register(menu: ICanvasMenu): IDisposable;
  
  /**
   * Called by a menu when it becomes visible.
   * Hides all OTHER visible menus (= mutual exclusion).
   */
  notifyShow(menuId: string): void;
  
  /** Hide all visible menus. */
  hideAll(): void;
  
  /** True if any registered menu is visible. */
  isAnyVisible(): boolean;
  
  /**
   * True if document.activeElement is inside any visible menu.
   * (Used by onBlur handler to avoid premature dismissal.)
   */
  containsFocusedElement(): boolean;
  
  /**
   * Centralized interaction-arbitration check.
   * Returns true if an incompatible interaction is active
   * (column-resizing, column-resize-hover, block-handle-interacting, dragging).
   */
  isInteractionLocked(): boolean;
  
  /** Remove outside-click listener and clear all registrations. */
  dispose(): void;
}
```

### 2.3 Centralized Outside-Click Handler

One `mousedown` listener on `document` (capture phase):

```
for each visible menu:
  if interaction is locked → hide menu
  else if !menu.containsTarget(e.target) → hide menu
```

Replaces:
- BlockActionMenu's `_onDocClickOutside`
- (Phase 2) Popup functions' individual `mousedown` listeners

### 2.4 Centralized Interaction Arbitration

Single `isInteractionLocked()` method using the **superset** of all current checks:

| CSS class | On element | Meaning |
|-----------|-----------|---------|
| `column-resizing` | `document.body` | User is dragging a column border |
| `column-resize-hover` | `document.body` | Cursor is over a column resize handle |
| `block-handle-interacting` | `document.body` | User is interacting with block handle affordances |
| `dragging` | `editor.view.dom` | Block drag-and-drop in progress |

All four conditions hide all menus. This fixes SlashMenu and BlockActionMenu missing some checks.

---

## 3. Controller Adaptations

### 3.1 SlashMenuController

| Change | Detail |
|--------|--------|
| Accept `registry` in constructor | `constructor(host, registry)` |
| Implement `ICanvasMenu` | `id='slash-menu'`, `containsTarget` checks `_menu` |
| Call `registry.notifyShow()` in `_show()` | Mutual exclusion — hides bubble/blockAction |
| Replace `_isInteractionArbitrationLocked()` | Delegate to `registry.isInteractionLocked()` |
| Register with registry in `create()` | `this._registration = registry.register(this)` |

### 3.2 BubbleMenuController

| Change | Detail |
|--------|--------|
| Accept `registry` in constructor | `constructor(host, registry)` |
| Implement `ICanvasMenu` | `id='bubble-menu'`, `containsTarget` checks `_menu` |
| Call `registry.notifyShow()` when showing | In `update()` when `style.display = 'flex'` |
| Replace `_isInteractionArbitrationLocked()` | Delegate to `registry.isInteractionLocked()` |
| Register with registry in `create()` | `this._registration = registry.register(this)` |

### 3.3 BlockActionMenuController

| Change | Detail |
|--------|--------|
| Accept `registry` in constructor | `constructor(host, registry)` |
| Implement `ICanvasMenu` | `id='block-action-menu'`, `containsTarget` checks menu + submenus + anchor |
| Call `registry.notifyShow()` in `show()` | Mutual exclusion |
| Remove `_onDocClickOutside` entirely | Replaced by registry's centralized handler |
| Remove `document.addEventListener/removeEventListener` in create/dispose | Registry owns the listener |
| Remove `_isColumnResizing()` | Covered by `registry.isInteractionLocked()` in centralized handler |
| Register with registry in `create()` | `this._registration = registry.register(this)` |

---

## 4. CanvasEditorPane Simplification

### Before:
```typescript
onTransaction: ({ editor }) => {
  if (this._suppressUpdate) return;
  this._slashMenu?.checkTrigger(editor);
  if (this._slashMenu?.visible) {
    this._bubbleMenu?.hide();
  }
},
onSelectionUpdate: ({ editor }) => {
  if (!editor.state.selection.empty) {
    this._slashMenu?.hide();
  }
  this._bubbleMenu?.update(editor);
},
onBlur: () => {
  setTimeout(() => {
    if (!this._bubbleMenu.menu?.contains(document.activeElement) &&
        !this._inlineMath.popup?.contains(document.activeElement)) {
      this._bubbleMenu.hide();
    }
    if (!this._slashMenu.menu?.contains(document.activeElement)) {
      this._slashMenu.hide();
    }
  }, 150);
},
```

### After:
```typescript
onTransaction: ({ editor }) => {
  if (this._suppressUpdate) return;
  this._slashMenu?.checkTrigger(editor);
  // Mutual exclusion handled by registry.notifyShow() inside each controller
},
onSelectionUpdate: ({ editor }) => {
  this._bubbleMenu?.update(editor);
  // Slash menu self-hides on non-empty selection via checkTrigger
},
onBlur: () => {
  setTimeout(() => {
    if (!this._menuRegistry.containsFocusedElement() &&
        !this._inlineMath.popup?.contains(document.activeElement)) {
      this._menuRegistry.hideAll();
    }
  }, 150);
},
```

### Dispose simplification:
```typescript
// Before: 
this._slashMenu?.hide();
this._bubbleMenu?.hide();
this._blockActionMenu?.hide();

// After:
this._menuRegistry.hideAll();
```

---

## 5. Phased Rollout

### Phase 1 — Core Registry + 3 Controllers (this PR)

1. Create `menus/canvasMenuRegistry.ts` with `ICanvasMenu` + `CanvasMenuRegistry`
2. Adapt `SlashMenuController` → implements `ICanvasMenu`
3. Adapt `BubbleMenuController` → implements `ICanvasMenu`
4. Adapt `BlockActionMenuController` → implements `ICanvasMenu`
5. Update `CanvasEditorPane` → create registry, pass to controllers, simplify callbacks
6. Run full test suite (182 tests across 12 files)
7. Commit

### Phase 2 — Popup Functions (future PR)

1. Add `registry?: CanvasMenuRegistry` param to `SlashActionContext`
2. Thread registry to `showImageInsertPopup`, `showMediaInsertPopup`, `showBookmarkInsertPopup`
3. Popups register as transient menus (`registry.register()` on show, dispose on dismiss)
4. Remove each popup's individual mousedown/keydown listeners
5. Centralized outside-click + Escape handling via registry

### Phase 3 — Escape Key Centralization (future PR)

1. Add centralized `keydown` listener for Escape in the registry
2. Remove per-popup Escape handlers
3. Consider per-menu priority for Escape (inner submenu dismisses before outer)

---

## 6. File Inventory

| File | Action |
|------|--------|
| `menus/canvasMenuRegistry.ts` | **NEW** — ICanvasMenu interface + CanvasMenuRegistry class |
| `menus/slashMenu.ts` | Modify — implement ICanvasMenu, accept registry |
| `menus/bubbleMenu.ts` | Modify — implement ICanvasMenu, accept registry |
| `menus/blockActionMenu.ts` | Modify — implement ICanvasMenu, accept registry, remove outside-click |
| `canvasEditorProvider.ts` | Modify — create registry, simplify callbacks |

No changes to:
- `menus/slashMenuItems.ts` (Phase 2)
- `menus/imageInsertPopup.ts` (Phase 2)
- `menus/mediaInsertPopup.ts` (Phase 2)
- `menus/bookmarkInsertPopup.ts` (Phase 2)
- `handles/blockHandles.ts` (no menu logic)
- `handles/blockSelection.ts` (no menu logic)

---

## 7. Risk Assessment

| Risk | Mitigation |
|------|------------|
| Slash menu outside-click is new behavior | Tested: clicking outside now hides immediately instead of waiting for transaction — matches Notion UX |
| Bubble menu outside-click is new behavior | Tested: clicking outside now hides immediately — `onBlur` remains as fallback for non-click focus loss |
| BlockActionMenu loses its own outside-click | Registry's centralized handler replaces it exactly; `containsTarget` includes submenus + anchor |
| Interaction lock superset may over-hide | All 4 conditions (`column-resizing`, `column-resize-hover`, `block-handle-interacting`, `dragging`) should hide all menus — this is strictly safer |
| Breaking existing tests | Only unit test changes needed if tests mock menu constructors (none currently do — canvas menus are untested in unit tests, covered by E2E) |
