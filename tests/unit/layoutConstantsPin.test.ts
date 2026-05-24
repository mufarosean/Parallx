/**
 * Pin: workbench/layout constants — TITLE_HEIGHT / STATUS_HEIGHT /
 * ACTIVITY_BAR_WIDTH / PART_HEADER_HEIGHT_PX / DEFAULT_SIDEBAR_WIDTH /
 * DEFAULT_PANEL_HEIGHT / DEFAULT_AUX_BAR_WIDTH / MIN_EDITOR_WIDTH. These
 * pixel values are bound to CSS variables and downstream layout math
 * across the workbench grid; any drift will visibly resize the chrome.
 */
import { describe, it, expect } from "vitest";
import {
  TITLE_HEIGHT,
  STATUS_HEIGHT,
  ACTIVITY_BAR_WIDTH,
  PART_HEADER_HEIGHT_PX,
  DEFAULT_SIDEBAR_WIDTH,
  DEFAULT_PANEL_HEIGHT,
  DEFAULT_AUX_BAR_WIDTH,
  MIN_EDITOR_WIDTH,
} from "../../src/workbench/layout";

describe("workbench/layout — pixel constants", () => {
  it("TITLE_HEIGHT = 30 (titlebar)", () => {
    expect(TITLE_HEIGHT).toBe(30);
  });
  it("STATUS_HEIGHT = 22 (status bar)", () => {
    expect(STATUS_HEIGHT).toBe(22);
  });
  it("ACTIVITY_BAR_WIDTH = 48 (activity bar)", () => {
    expect(ACTIVITY_BAR_WIDTH).toBe(48);
  });
  it("PART_HEADER_HEIGHT_PX = 35 (each part's header band)", () => {
    expect(PART_HEADER_HEIGHT_PX).toBe(35);
  });
  it("DEFAULT_SIDEBAR_WIDTH = 202", () => {
    expect(DEFAULT_SIDEBAR_WIDTH).toBe(202);
  });
  it("DEFAULT_PANEL_HEIGHT = 200", () => {
    expect(DEFAULT_PANEL_HEIGHT).toBe(200);
  });
  it("DEFAULT_AUX_BAR_WIDTH = 480", () => {
    expect(DEFAULT_AUX_BAR_WIDTH).toBe(480);
  });
  it("MIN_EDITOR_WIDTH = 200", () => {
    expect(MIN_EDITOR_WIDTH).toBe(200);
  });

  it("all eight constants are positive finite integers", () => {
    for (const [name, v] of [
      ["TITLE_HEIGHT", TITLE_HEIGHT],
      ["STATUS_HEIGHT", STATUS_HEIGHT],
      ["ACTIVITY_BAR_WIDTH", ACTIVITY_BAR_WIDTH],
      ["PART_HEADER_HEIGHT_PX", PART_HEADER_HEIGHT_PX],
      ["DEFAULT_SIDEBAR_WIDTH", DEFAULT_SIDEBAR_WIDTH],
      ["DEFAULT_PANEL_HEIGHT", DEFAULT_PANEL_HEIGHT],
      ["DEFAULT_AUX_BAR_WIDTH", DEFAULT_AUX_BAR_WIDTH],
      ["MIN_EDITOR_WIDTH", MIN_EDITOR_WIDTH],
    ] as const) {
      expect(typeof v, name).toBe("number");
      expect(Number.isInteger(v), name).toBe(true);
      expect(v as number, name).toBeGreaterThan(0);
    }
  });
});
