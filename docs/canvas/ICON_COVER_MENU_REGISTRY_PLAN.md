# Icon & Cover Menu Registry Plan

> **Date:** 2026-02-20  
> **Branch:** `canvas-v2`  
> **Baseline:** commit `6800482`, 12 files, 182 tests passing

---

## 1. Problem

### 1a. Icon picker — 3 independent consumers, no registry coordination

Three files independently import `IconPicker` from `src/ui/iconPicker.ts` and
`PAGE_ICON_IDS` / `svgIcon` from `canvasIcons.ts`, then wire up the same boilerplate
(create → listen events → dismiss):

| # | File | Anchor | Container | Opts |
|---|------|--------|-----------|------|
| 1 | `pageChrome.ts:808` | `_iconEl` or `_pageHeader` | `_host.container` | search: ✓, remove: if has icon, size: 22 |
| 2 | `pageBlockNode.ts:226` | `dom` (block card) | `document.body` | search: ✗, remove: ✓, size: 18 |
| 3 | `calloutNode.ts:112` | `iconSpan` | `document.body` | search: ✓, remove: ✗, size: 22 |

**Consequences:**
- The icon picker is **not** registered in `CanvasMenuRegistry` → opening slash menu
  or bubble menu does NOT dismiss an open icon picker (no mutual exclusion).
- Each consumer imports `IconPicker`, `PAGE_ICON_IDS`, `svgIcon` directly —
  children of entry points (pageBlockNode, calloutNode) bypass blockRegistry.
- Mounting to `document.body` (consumers 2 & 3) causes broken positioning when
  the viewport layout doesn't match expectations — **the screenshot shows the icon
  grid rendering as a flat horizontal strip at the page bottom.**

### 1b. Cover picker — raw DOM soup, no component, no registry

The cover picker lives entirely in `pageChrome.ts:653-807` as ~155 lines of raw
DOM construction with inline gradient data, upload logic, and link paste. It:
- Has its own outside-click/escape listeners (not coordinated with menu registry)
- Has no `ICanvasMenu` lifecycle hooks
- Is not dismissible by other menus
- Contains hardcoded gradient data that should live in configuration

### 1c. UI quality — icon picker looks broken

The screenshot shows the icon picker rendered at the bottom of the screen as a
flat horizontal strip rather than a proper popup grid. This is caused by:
- Mounting to `document.body` without proper containment
- `layoutPopup` positioning failing when the anchor is far from viewport edges
- The picker's `fixed` positioning computing incorrect coordinates

---

## 2. Solution Architecture

### Principle

Both icon picker and cover picker become `ICanvasMenu`-registered surfaces managed
by `CanvasMenuRegistry`. This gives them:
- Mutual exclusion (opening one hides all others)
- Outside-click dismissal through the centralized mousedown listener
- Interaction arbitration (hidden during column resize, drag, etc.)
- Proper lifecycle (dispose on editor teardown)

### New files

| File | Purpose |
|------|---------|
| `menus/iconMenu.ts` | `IconMenuController implements ICanvasMenu` — wraps `IconPicker` |
| `menus/coverMenu.ts` | `CoverMenuController implements ICanvasMenu` — extracted from pageChrome |

### Existing files modified

| File | Change |
|------|--------|
| `canvasMenuRegistry.ts` | Add `IconMenuHost` and `CoverMenuHost` to `CanvasMenuHost` union; create icon/cover menus in `createStandardMenus()` |
| `pageChrome.ts` | Remove `_showIconPicker()` and `_showCoverPicker()` — call `menuRegistry.showIconMenu()` / `menuRegistry.showCoverMenu()` instead |
| `pageBlockNode.ts` | Remove direct `IconPicker` import — receive an `showIconPicker` function via `PageBlockOptions` from blockRegistry |
| `calloutNode.ts` | Remove direct `IconPicker` import — receive `showIconPicker` function via block extension options from blockRegistry |
| `blockRegistry.ts` | Add `showIconPicker` to `EditorExtensionContext`, thread from canvasEditorProvider |
| `canvasEditorProvider.ts` | Pass `showIconPicker` callback (delegates to icon menu) into extension context |

### Data flow

```
canvasEditorProvider
  ├─ CanvasMenuRegistry.createStandardMenus(host)
  │    ├─ SlashMenuController          (existing)
  │    ├─ BubbleMenuController         (existing)
  │    ├─ BlockActionMenuController    (existing)
  │    ├─ IconMenuController           (NEW — wraps IconPicker)
  │    └─ CoverMenuController          (NEW — extracted from pageChrome)
  │
  ├─ blockRegistry.createEditorExtensions(ctx)
  │    ctx.showIconPicker = (anchor, opts) => menuRegistry.showIconMenu(anchor, opts)
  │    └─ pageBlockNode     — calls ctx.showIconPicker(anchor, opts)
  │    └─ calloutNode       — calls ctx.showIconPicker(anchor, opts)
  │
  └─ PageChromeController(host)
       host.showIconPicker = (anchor, opts) => menuRegistry.showIconMenu(anchor, opts)
       host.showCoverPicker = () => menuRegistry.showCoverMenu()
```

---

## 3. Phase 1 — IconMenuController

### 3a. `menus/iconMenu.ts`

```typescript
export interface IconMenuOptions {
  readonly anchor: HTMLElement;
  readonly showSearch?: boolean;
  readonly showRemove?: boolean;
  readonly iconSize?: number;
  readonly onSelect: (iconId: string) => void;
  readonly onRemove?: () => void;
}

export interface IconMenuHost {
  readonly container: HTMLElement;
}

export class IconMenuController implements ICanvasMenu {
  readonly id = 'icon-menu';
  private _picker: IconPicker | null = null;
  private _visible = false;
  private _registration: IDisposable | null = null;

  constructor(
    private readonly _host: IconMenuHost,
    private readonly _registry: CanvasMenuRegistry,
  ) {}

  get visible(): boolean { return this._visible; }

  containsTarget(target: Node): boolean {
    return this._picker?.element.contains(target) ?? false;
  }

  create(): void {
    this._registration = this._registry.register(this);
  }

  show(options: IconMenuOptions): void {
    this.hide();
    this._registry.notifyShow(this.id);

    this._picker = new IconPicker(this._host.container, {
      anchor: options.anchor,
      icons: PAGE_ICON_IDS,
      renderIcon: (id, _size) => svgIcon(id),
      showSearch: options.showSearch ?? true,
      showRemove: options.showRemove ?? false,
      iconSize: options.iconSize ?? 22,
    });

    this._visible = true;

    this._picker.onDidSelectIcon(options.onSelect);
    if (options.onRemove) {
      this._picker.onDidRemoveIcon(options.onRemove);
    }
    this._picker.onDidDismiss(() => {
      this._visible = false;
      this._picker = null;
    });
  }

  hide(): void {
    if (this._picker) {
      this._picker.dismiss();
      this._picker = null;
    }
    this._visible = false;
  }

  dispose(): void {
    this.hide();
    this._registration?.dispose();
  }
}
```

**Key details:**
- Always mounts to `_host.container` (the editor pane), never `document.body`
- Delegates icon catalog (`PAGE_ICON_IDS`, `svgIcon`) internally — consumers just
  get `onSelect(iconId)` callback
- Calling `show()` auto-hides all other menus via `_registry.notifyShow()`

### 3b. Registry integration

`CanvasMenuRegistry.createStandardMenus()` gains:
```typescript
const iconMenu = new IconMenuController({ container: host.container }, this);
iconMenu.create();
this._iconMenu = iconMenu;
```

New public method:
```typescript
showIconMenu(options: IconMenuOptions): void {
  this._iconMenu?.show(options);
}
```

### 3c. Consumer changes

**blockRegistry** — `EditorExtensionContext` gains:
```typescript
readonly showIconPicker?: (options: ShowIconPickerOptions) => void;
```

where `ShowIconPickerOptions` is a local narrow type (anchor + callbacks + display options).

**pageBlockNode** — replaces `new IconPicker(...)` with:
```typescript
this.options.showIconPicker?.({ anchor: dom, showRemove: true, ... });
```

**calloutNode** — same pattern via extension options.

**pageChrome** — replaces `_showIconPicker()` body with:
```typescript
this._host.showIconPicker({ anchor, showRemove: !!this._currentPage?.icon, ... });
```

---

## 4. Phase 2 — CoverMenuController

### 4a. `menus/coverMenu.ts`

Extracts the 155 lines from `pageChrome._showCoverPicker()` into a proper
`ICanvasMenu` implementation:

```typescript
export interface CoverMenuHost {
  readonly container: HTMLElement;
  readonly editorContainer: HTMLElement | null;
  readonly coverEl: HTMLElement | null;
  readonly pageHeader: HTMLElement | null;
}

export class CoverMenuController implements ICanvasMenu {
  readonly id = 'cover-menu';
  // ... lifecycle, show/hide, tab rendering (gallery/upload/link)
}
```

**Gradient data** moves to a `COVER_GRADIENTS` constant in the file (or a
`config/coverGallery.ts` — TBD based on size).

### 4b. Consumer change

`pageChrome._showCoverPicker()` becomes:
```typescript
this._host.showCoverPicker?.();
```

---

## 5. Phase 3 — Fix Icon Picker UI

The root cause of the broken UI:
1. `document.body` mount → `layoutPopup` computes position relative to viewport
   but the fixed overlay can be clipped or displaced by scroll/overflow
2. The `.ui-icon-picker` CSS `max-height: 420px` may not be respected when the
   container has different stacking context

**Fixes:**
- Mount to editor pane container (via IconMenuController), not `document.body`
- Add overflow protection to `layoutPopup` positioning
- Ensure `.ui-icon-picker` z-index sits above the editor but below modals

---

## 6. Execution Steps

| Step | Action | Files |
|------|--------|-------|
| 1 | Create `IconMenuController` | `menus/iconMenu.ts` (new) |
| 2 | Register icon menu in `CanvasMenuRegistry` | `canvasMenuRegistry.ts` |
| 3 | Add `showIconPicker` to `EditorExtensionContext` | `config/blockRegistry.ts` |
| 4 | Wire `showIconPicker` from canvasEditorProvider | `canvasEditorProvider.ts` |
| 5 | Replace direct `IconPicker` in `pageBlockNode.ts` | `extensions/pageBlockNode.ts` |
| 6 | Replace direct `IconPicker` in `calloutNode.ts` | `extensions/calloutNode.ts` |
| 7 | Replace `_showIconPicker()` in pageChrome | `header/pageChrome.ts` |
| 8 | Create `CoverMenuController` | `menus/coverMenu.ts` (new) |
| 9 | Register cover menu in `CanvasMenuRegistry` | `canvasMenuRegistry.ts` |
| 10 | Replace `_showCoverPicker()` in pageChrome | `header/pageChrome.ts` |
| 11 | Verify: `get_errors`, `npx vitest run` | all files |
| 12 | Commit | — |

---

## 7. Design Principles Applied

| Principle | How |
|-----------|-----|
| Entry-point routing | pageBlockNode and calloutNode receive `showIconPicker` through blockRegistry, not by importing IconPicker directly |
| Menu registry coordination | Icon and cover menus participate in mutual exclusion, outside-click, interaction arbitration |
| `src/ui/` stays generic | `IconPicker` remains a reusable UI primitive. Canvas-specific wiring lives in `IconMenuController` |
| No raw DOM in feature code | Cover picker extracted into a proper component with `ICanvasMenu` lifecycle |
| Fix mounting | All popups mount to editor pane container, not `document.body` |
