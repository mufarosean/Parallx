/**
 * Pin: canvas drag-session singleton — get/set/clear contract used by
 * blockHandles → columnDropPlugin → pageBlockNode → crossPageMovement.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  CANVAS_BLOCK_DRAG_MIME,
  setActiveCanvasDragSession,
  getActiveCanvasDragSession,
  clearActiveCanvasDragSession,
  type CanvasDragSession,
} from "../../src/built-in/canvas/config/blockStateRegistry/dragSession";

function makeSession(): CanvasDragSession {
  return {
    sourcePageId: "page-1",
    from: 10,
    to: 20,
    nodes: [{ type: "paragraph" }],
    listType: "bulletList",
    startedAt: Date.now(),
  };
}

describe("canvas/dragSession — singleton get/set/clear", () => {
  beforeEach(() => clearActiveCanvasDragSession());

  it("pins the drag MIME constant", () => {
    expect(CANVAS_BLOCK_DRAG_MIME).toBe("application/x-parallx-canvas-block-drag");
  });

  it("is null when no session active", () => {
    expect(getActiveCanvasDragSession()).toBeNull();
  });

  it("setActive then getActive returns the exact session object", () => {
    const s = makeSession();
    setActiveCanvasDragSession(s);
    expect(getActiveCanvasDragSession()).toBe(s);
  });

  it("clearActive returns to null", () => {
    setActiveCanvasDragSession(makeSession());
    clearActiveCanvasDragSession();
    expect(getActiveCanvasDragSession()).toBeNull();
  });

  it("setActive replaces the prior session (last-writer-wins)", () => {
    const a = makeSession();
    const b = { ...makeSession(), from: 99 };
    setActiveCanvasDragSession(a);
    setActiveCanvasDragSession(b);
    expect(getActiveCanvasDragSession()).toBe(b);
  });
});
