# Block Editor Assembly Consolidation Plan

**Date:** 2026-02-20  
**Status:** Ready for execution  
**Scope:** Eliminate `blockCapabilities.ts`, gate `tiptapExtensions.ts` through `blockRegistry.ts`

---

## Problem Statement

Three files exist in `config/` that overlap and create confusing dependency edges:

| File | Lines | Role |
|---|---|---|
| `blockCapabilities.ts` | 13 | Shim — re-exports 4 constants from blockRegistry |
| `tiptapExtensions.ts` | 108 | Assembly — builds the Extensions[] array for Tiptap |
| `blockRegistry.ts` | 1088 | The actual single-source-of-truth catalog |

### Current import graph (confusing)

```
canvasEditorProvider ──→ tiptapExtensions ──→ blockCapabilities ──→ blockRegistry
                         tiptapExtensions ──→ blockRegistry (also directly)
columnNodes          ──→ blockCapabilities ──→ blockRegistry
columnNodes          ──→ blockRegistry (also directly)
```

Four problems:
1. **blockCapabilities.ts is pointless.** It re-exports 4 constants already in blockRegistry. Both consumers also import from blockRegistry directly for other things.
2. **tiptapExtensions.ts is accessed directly** by canvasEditorProvider, violating the "registries are the single entry point" principle.
3. **Circular feel.** columnNodes imports from blockCapabilities AND blockRegistry — two paths to the same data.
4. **canvasEditorProvider has to know** about a second config file that isn't blockRegistry.

### Target import graph (clean)

```
canvasEditorProvider ──→ blockRegistry (only)
columnNodes          ──→ blockRegistry (only)
tiptapExtensions     ──→ blockRegistry (internal, never imported directly by children)
```

All children communicate through one entry point: **blockRegistry**.

---

## Decision: Keep `tiptapExtensions.ts` as an internal file

`tiptapExtensions.ts` must remain as a separate **file** (not inlined into blockRegistry) because:
- It imports from 12 external packages (StarterKit, Placeholder, TextStyle, Color, Highlight, GlobalDragHandle, CharacterCount, AutoJoiner, plus 4 custom infrastructure extensions)
- These are **not blocks** — they're editor infrastructure (marks, plugins, utilities)
- blockRegistry is already 1088 lines; inlining tiptapExtensions would add complexity with no benefit

But it will be consumed **through blockRegistry**, exactly like:
- `blockStateRegistry/` is consumed through blockRegistry
- `iconRegistry.ts` is consumed through blockRegistry
- `plugins/` are consumed through blockRegistry

Pattern: **file stays, entry point is blockRegistry**.

---

## Execution Steps

### Step 1: Delete `blockCapabilities.ts`
- File is a 13-line shim with zero logic
- Both consumers already import from blockRegistry directly

### Step 2: Rewire `columnNodes.ts`
**Before:**
```typescript
import { COLUMN_CONTENT_EXPRESSION } from '../config/blockCapabilities.js';
import { columnResizePlugin, ... } from '../config/blockRegistry.js';
```
**After:**
```typescript
import { COLUMN_CONTENT_EXPRESSION, columnResizePlugin, ... } from '../config/blockRegistry.js';
```

Also update the comment on line 33 that references blockCapabilities.ts:
```
// The allowed node set is centralized in config/blockCapabilities.ts.
```
→
```
// The allowed node set is centralized in config/blockRegistry.ts.
```

### Step 3: Rewire `tiptapExtensions.ts` internal import
**Before:**
```typescript
import { DRAG_HANDLE_CUSTOM_NODE_TYPES } from './blockCapabilities.js';
import { getNodePlaceholder, getBlockExtensions } from './blockRegistry.js';
```
**After:**
```typescript
import { DRAG_HANDLE_CUSTOM_NODE_TYPES, getNodePlaceholder, getBlockExtensions } from './blockRegistry.js';
```

### Step 4: Add re-export in `blockRegistry.ts`
Add at the bottom of blockRegistry.ts:
```typescript
// ── Editor Assembly Access (registry gate) ────────────────────────────────
// canvasEditorProvider gets the fully assembled extension array through
// blockRegistry — its single entry point — instead of importing
// tiptapExtensions.ts directly.

export { createEditorExtensions } from './tiptapExtensions.js';
export type { EditorExtensionContext } from './tiptapExtensions.js';
```

Note: `EditorExtensionContext` is already defined and exported from blockRegistry.ts itself — tiptapExtensions.ts merely re-exports it for backward compatibility. Once we gate through blockRegistry, that re-export in tiptapExtensions becomes unused by external consumers, but we keep the local re-export since tiptapExtensions.ts itself consumes it.

Wait — actually `EditorExtensionContext` is **defined** in blockRegistry.ts (lines 56-66), and tiptapExtensions.ts imports it from blockRegistry **and re-exports it**. So we only need to re-export `createEditorExtensions`. The type is already exported from blockRegistry.

```typescript
export { createEditorExtensions } from './tiptapExtensions.js';
```

### Step 5: Rewire `canvasEditorProvider.ts`
**Before:**
```typescript
import { createEditorExtensions } from './config/tiptapExtensions.js';
```
**After:**
```typescript
import { createEditorExtensions } from './config/blockRegistry.js';
```

### Step 6: Clean up `tiptapExtensions.ts` re-export
Remove the now-unnecessary backward-compatibility re-export:
```typescript
// Re-export for backward compatibility — callers that imported from here.
export type { EditorExtensionContext } from './blockRegistry.js';
```

This line exists only for external consumers who imported from tiptapExtensions.ts. After step 5, there are none.

---

## Affected Files

| File | Action | Detail |
|---|---|---|
| `config/blockCapabilities.ts` | **DELETE** | 13-line shim, zero consumers after rewiring |
| `extensions/columnNodes.ts` | **MODIFY** | Move `COLUMN_CONTENT_EXPRESSION` import to blockRegistry line, update comment |
| `config/tiptapExtensions.ts` | **MODIFY** | Import from blockRegistry instead of blockCapabilities; remove re-export |
| `config/blockRegistry.ts` | **MODIFY** | Add `createEditorExtensions` re-export |
| `canvasEditorProvider.ts` | **MODIFY** | Import from blockRegistry instead of tiptapExtensions |

---

## Validation

- `npm run build` passes  
- `npx vitest run` — all 182 tests pass  
- No file imports from `blockCapabilities.js` or directly from `tiptapExtensions.js`

---

## Result

After this consolidation, the config/ directory structure is:

```
config/
├── blockRegistry.ts          ← THE single entry point for all block APIs
├── blockStateRegistry/       ← Internal: lifecycle, transforms, movement
│   ├── blockLifecycle.ts
│   ├── blockTransforms.ts
│   ├── blockMovement.ts
│   └── blockStateRegistry.ts (facade)
├── iconRegistry.ts           ← Internal: SVG data + icon helpers
├── tiptapExtensions.ts       ← Internal: editor assembly (StarterKit + infrastructure)
└── (blockCapabilities.ts)    ← DELETED
```

Every child — extensions, plugins, menus, handles, providers — imports from `blockRegistry.ts` only. Internal files exist for implementation decomposition but are never directly imported by children.
