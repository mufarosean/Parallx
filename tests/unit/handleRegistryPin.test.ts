/**
 * Pin: canvas handleRegistry — 5th registry gate.  Children (blockHandles,
 * blockSelection, blockMarquee) import ONLY through this file.  Verifies the
 * re-export surface remains intact and stable.
 */
import { describe, it, expect } from "vitest";
import * as gate from "../../src/built-in/canvas/handles/handleRegistry";

describe("handleRegistry — re-export surface", () => {
  it("re-exports svgIcon from iconRegistry", () => {
    expect(typeof gate.svgIcon).toBe("function");
  });

  it("re-exports drag-session helpers from blockStateRegistry", () => {
    expect(typeof gate.CANVAS_BLOCK_DRAG_MIME).toBe("string");
    expect(gate.CANVAS_BLOCK_DRAG_MIME.length).toBeGreaterThan(0);
    expect(typeof gate.clearActiveCanvasDragSession).toBe("function");
    expect(typeof gate.setActiveCanvasDragSession).toBe("function");
  });

  it("re-exports column-invariant helpers from blockStateRegistry", () => {
    expect(typeof gate.resolveBlockAncestry).toBe("function");
    expect(typeof gate.resolveMovableBlock).toBe("function");
    expect(typeof gate.normalizeAllColumnLists).toBe("function");
    expect(typeof gate.notifyLinkedPageBlocksDeleted).toBe("function");
  });

  it("re-exports PAGE_CONTAINERS + isContainerBlockType from blockRegistry", () => {
    expect(Array.isArray(gate.PAGE_CONTAINERS) || gate.PAGE_CONTAINERS instanceof Set).toBe(true);
    expect(typeof gate.isContainerBlockType).toBe("function");
  });

  it("re-exports child controllers + plugin key", () => {
    expect(typeof gate.BlockHandlesController).toBe("function");
    expect(typeof gate.BlockSelectionController).toBe("function");
    expect(typeof gate.BlockMarqueeController).toBe("function");
    expect(typeof gate.createBlockSelectionPlugin).toBe("function");
    // blockSelectionPluginKey is a PluginKey instance from prosemirror-state.
    expect(gate.blockSelectionPluginKey).toBeDefined();
  });
});
