# Icon Registry Architecture

> Established in the IconRegistry commit on the `canvas-v2` branch.  
> See also: `BLOCK_REGISTRY.md`, `CANVAS_V2_PARITY_MASTER_PLAN.md`

---

## Three-Registry Architecture

The canvas system has three registries that act as **single entry points**.
Only registries import from other registries — no child file ever reaches
across to a sibling registry.

```
canvasIcons.ts  (raw SVG data)
       │
  IconRegistry   ← single gate to canvasIcons.ts
     ╱     ╲
BlockRegistry   MenuRegistry   ← only these two import from IconRegistry
   │               │
   ├── calloutNode  ├── slashMenu
   ├── pageBlockNode├── blockActionMenu
   ├── bookmarkNode ├── bubbleMenu
   ├── mediaNodes   └── iconMenu
   ├── blockHandles
   ├── pageChrome
   └── canvasSidebar
```

### The Rule

1. **Only `iconRegistry.ts`** imports from `canvasIcons.ts`.
2. **Only `blockRegistry.ts` and `canvasMenuRegistry.ts`** import from `iconRegistry.ts`.
3. Block extensions, chrome, and sidebar import icon functions from **blockRegistry**.
4. Menu surface files import icon functions from **canvasMenuRegistry**.
5. **No child file ever imports from iconRegistry directly.**

---

## Problem (before)

11 files imported directly from `canvasIcons.ts` (then from `iconRegistry.ts`):

| Category | Files |
|----------|-------|
| **Menus** (4) | slashMenu, blockActionMenu, bubbleMenu, iconMenu |
| **Block extensions** (4) | calloutNode, pageBlockNode, bookmarkNode, mediaNodes |
| **Chrome / UI** (3) | pageChrome, canvasSidebar, blockHandles |

This scattered dependency made it impossible to enforce the principle that
children of entry points never reach across to other registries.

---

## Solution: Registry-to-Registry Gates

### What BlockRegistry re-exports (from IconRegistry)

| Export | Purpose |
|--------|---------|
| `svgIcon(id)` | Get raw SVG string for an icon ID |
| `resolvePageIcon(icon)` | Validate stored icon string → canonical ID |
| `createIconElement(id, size)` | Create a sized `<span>` with SVG icon |

Consumed by: calloutNode, pageBlockNode, bookmarkNode, mediaNodes,
blockHandles, pageChrome, canvasSidebar.

### What MenuRegistry re-exports (from IconRegistry)

| Export | Purpose |
|--------|---------|
| `svgIcon(id)` | Get raw SVG string for an icon ID |
| `PAGE_SELECTABLE_ICONS` | Icon IDs for the user-facing icon picker |

Consumed by: slashMenu, blockActionMenu, bubbleMenu, iconMenu.

### What IconRegistry owns directly

| Export | Purpose |
|--------|---------|
| `svgIcon(id)` | Get raw SVG string for an icon ID |
| `createIconElement(id, size)` | Create a sized `<span>` with SVG icon |
| `resolvePageIcon(icon)` | Validate stored icon string → canonical ID with fallback |
| `PAGE_SELECTABLE_ICONS` | Icon IDs available in the user-facing icon picker |
| `ALL_ICON_IDS` | Complete set of all icon IDs in the system |
| `isBlockIconSelectable(name)` | Whether a block type's icon is user-changeable |

---

## Block Icon Model

### BlockDefinition fields

```typescript
interface BlockDefinition {
  icon: string;             // Icon ID (e.g. 'lightbulb', 'bullet-list') or text glyph ('H₁')
  iconIsText?: boolean;     // True when icon is a text glyph, not an SVG key
  iconSelectable?: boolean; // True when user can change the icon via picker
}
```

### Icon selectability

| Block type | `iconSelectable` | Reason |
|-----------|------------------|--------|
| `callout` | `true` | User picks the callout icon (lightbulb, flag, etc.) |
| `pageBlock` | `true` | User picks the page icon |
| All others | `false` (default) | Icon is fixed by the block type definition |

The `isBlockIconSelectable()` function in IconRegistry mirrors this — it's the authoritative check for whether the icon picker should be offered for a given block.

---

## Data Flow

### Menu icons (slash menu, turn-into, action menu)

```
MenuRegistry.getSlashMenuBlocks()  →  MenuBlockInfo.icon  →  menuRegistry.svgIcon(icon)
MenuRegistry.getTurnIntoBlocks()   →  MenuBlockInfo.icon  →  menuRegistry.svgIcon(icon)
```

Both menus use the **same** BlockDefinition entries (via MenuRegistry), so
icons are guaranteed identical.

### Block extension icons (callout, pageBlock inline icons)

```
Node attrs (stored icon field)  →  blockRegistry.resolvePageIcon()  →  blockRegistry.svgIcon()
```

### Chrome icons (sidebar, page header, block handles)

```
Hardcoded icon IDs  →  blockRegistry.svgIcon() / blockRegistry.createIconElement()
Page data           →  blockRegistry.resolvePageIcon()  →  blockRegistry.createIconElement()
```

### Icon picker

```
menuRegistry.PAGE_SELECTABLE_ICONS  →  IconPicker grid
menuRegistry.svgIcon()              →  render each grid cell
User selects                        →  callback updates node attrs
```

---

## Consistency Guarantees

1. **Same icon everywhere**: Heading in slash menu = heading in turn-into menu (both read `BlockDefinition.icon` via their registry)
2. **Single resolution**: Page icons always go through `resolvePageIcon()` for fallback handling
3. **Single catalog**: Icon picker always uses `PAGE_SELECTABLE_ICONS` from one source
4. **No drift**: If an icon name changes, one update in `canvasIcons.ts` propagates through `iconRegistry` → registries → all consumers
5. **No cross-reach**: No child file imports from a registry that isn't its parent — the three-registry principle is enforced at the import level
