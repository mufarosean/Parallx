/**
 * Pin: pageBlock drop routing — shared edge-vs-interior classifier used by
 * the cross-page drop engine.  Locks the thresholds and the corner-region
 * priority (edge wins on any axis).
 */
import { describe, it, expect } from "vitest";
import {
  getPageBlockDropThresholds,
  classifyPageBlockDropZone,
} from "../../src/built-in/canvas/config/blockStateRegistry/pageBlockDropRouting";

describe("getPageBlockDropThresholds", () => {
  it("uses constant 50px horizontal edge when width >= 150", () => {
    expect(getPageBlockDropThresholds({ left: 0, top: 0, width: 150, height: 200 })).toEqual({
      horizontalEdge: 50,
      verticalEdge: 50, // 200 * 0.25
    });
    expect(getPageBlockDropThresholds({ left: 0, top: 0, width: 999, height: 100 }).horizontalEdge).toBe(50);
  });

  it("scales horizontal edge to 20% of width when width < 150, clamped to >= 16", () => {
    // 100 * 0.2 = 20 → 20
    expect(getPageBlockDropThresholds({ left: 0, top: 0, width: 100, height: 100 }).horizontalEdge).toBe(20);
    // 50 * 0.2 = 10 → clamped to 16
    expect(getPageBlockDropThresholds({ left: 0, top: 0, width: 50, height: 100 }).horizontalEdge).toBe(16);
  });

  it("vertical edge is 25% of height, clamped to >= 8", () => {
    expect(getPageBlockDropThresholds({ left: 0, top: 0, width: 200, height: 400 }).verticalEdge).toBe(100);
    expect(getPageBlockDropThresholds({ left: 0, top: 0, width: 200, height: 20 }).verticalEdge).toBe(8);
  });
});

describe("classifyPageBlockDropZone", () => {
  const rect = { left: 100, top: 200, width: 300, height: 400 };
  // thresholds: horizontalEdge=50 (width>=150), verticalEdge=100 (height*0.25)

  it("classifies pointer at the centre as 'interior'", () => {
    expect(classifyPageBlockDropZone(rect, 250, 400)).toBe("interior");
  });

  it("classifies pointer near the left edge as 'edge'", () => {
    expect(classifyPageBlockDropZone(rect, 110, 400)).toBe("edge"); // rx=10 < 50
  });

  it("classifies pointer near the right edge as 'edge'", () => {
    expect(classifyPageBlockDropZone(rect, 395, 400)).toBe("edge"); // rx=295 > 250
  });

  it("classifies pointer near the top edge as 'edge'", () => {
    expect(classifyPageBlockDropZone(rect, 250, 250)).toBe("edge"); // ry=50 < 100
  });

  it("classifies pointer near the bottom edge as 'edge'", () => {
    expect(classifyPageBlockDropZone(rect, 250, 550)).toBe("edge"); // ry=350 > 300
  });

  it("classifies corner regions as 'edge' (any axis triggers edge)", () => {
    expect(classifyPageBlockDropZone(rect, 110, 250)).toBe("edge");
    expect(classifyPageBlockDropZone(rect, 395, 550)).toBe("edge");
  });

  it("a one-pixel inset from edge becomes 'interior'", () => {
    // Just inside horizontalEdge=50 and verticalEdge=100
    expect(classifyPageBlockDropZone(rect, 100 + 50, 200 + 100)).toBe("interior");
    expect(classifyPageBlockDropZone(rect, 100 + 250, 200 + 300)).toBe("interior");
  });
});
