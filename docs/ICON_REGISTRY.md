# Icon Registry Architecture

> Established in the IconRegistry commit on the `canvas-v2` branch.  
> See also: `BLOCK_REGISTRY.md`, `CANVAS_V2_PARITY_MASTER_PLAN.md`

---

## Problem

Before the IconRegistry, **11 files** imported directly from `canvasIcons.ts`:

| Category | Files |
|----------|-------|
| **Menus** (4) | slashMenu, blockActionMenu, bubbleMenu, iconMenu |
| **Block extensions** (4) | calloutNode, pageBlockNode, bookmarkNode, mediaNodes |
| **Chrome / UI** (3) | pageChrome, canvasSidebar, blockHandles |

This scattered dependency made it impossible to:
- Ensure icon consistency across menus (e.g. heading icon identical in slash menu and turn-into menu)
- Know which block types have user-selectable icons vs fixed icons
- Change the icon system without touching 11+ files
- Enforce the "children of entry points never import shared modules directly" principle

---

## Solution: Single-Gate IconRegistry

```
canvasIcons.ts  ──►  config/iconRegistry.ts  ──►  all consumers
   (raw data)           (single gate)           (11 files)
```

### The Rule

**Only `config/iconRegistry.ts` imports from `canvasIcons.ts`.**  
All other files in the canvas system import from `iconRegistry.ts`.

### What IconRegistry provides

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
BlockRegistry.getSlashMenuBlocks()  →  BlockDefinition.icon  →  iconRegistry.svgIcon(icon)
BlockRegistry.getTurnIntoBlocks()   →  BlockDefinition.icon  →  iconRegistry.svgIcon(icon)
```

Both menus use the **same** BlockDefinition entries, so icons are guaranteed identical.

### Block extension icons (callout, pageBlock inline icons)

```
Node attrs (stored icon field)  →  iconRegistry.resolvePageIcon()  →  iconRegistry.svgIcon()
```

### Chrome icons (sidebar, page header, block handles)

```
Hardcoded icon IDs  →  iconRegistry.svgIcon() / iconRegistry.createIconElement()
Page data           →  iconRegistry.resolvePageIcon()  →  iconRegistry.createIconElement()
```

### Icon picker

```
iconRegistry.PAGE_SELECTABLE_ICONS  →  IconPicker grid
iconRegistry.svgIcon()              →  render each grid cell
User selects                        →  callback updates node attrs
```

---

## Consistency Guarantees

1. **Same icon everywhere**: Heading in slash menu = heading in turn-into menu (both read `BlockDefinition.icon`)
2. **Single resolution**: Page icons always go through `resolvePageIcon()` for fallback handling
3. **Single catalog**: Icon picker always uses `PAGE_SELECTABLE_ICONS` from one source
4. **No drift**: If an icon name changes, one update in `canvasIcons.ts` propagates through `iconRegistry` to all 11 consumers
