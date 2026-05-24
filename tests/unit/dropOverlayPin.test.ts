/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from "vitest";
import { DropOverlay } from "../../src/dnd/dropOverlay.js";
import { DropPosition } from "../../src/dnd/dndTypes.js";

const rect = (w: number, h: number): DOMRect =>
  ({ left: 0, top: 0, right: w, bottom: h, width: w, height: h, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);

describe("DropOverlay pin", () => {
  let parent: HTMLElement;
  let ov: DropOverlay;

  beforeEach(() => {
    document.body.innerHTML = "";
    parent = document.createElement("div");
    document.body.appendChild(parent);
    ov = new DropOverlay();
  });

  it("element has overlay class and five drop zones", () => {
    expect(ov.element.classList.contains("parallx-drop-overlay")).toBe(true);
    const zones = ov.element.querySelectorAll(".drop-zone");
    expect(zones.length).toBe(5);
    expect(ov.element.querySelector(".drop-zone-center")).not.toBeNull();
    expect(ov.element.querySelector(".drop-zone-top")).not.toBeNull();
    expect(ov.element.querySelector(".drop-zone-bottom")).not.toBeNull();
    expect(ov.element.querySelector(".drop-zone-left")).not.toBeNull();
    expect(ov.element.querySelector(".drop-zone-right")).not.toBeNull();
  });

  it("show() attaches to parent and forces position:relative; hide() removes", () => {
    ov.show(parent);
    expect(ov.element.parentNode).toBe(parent);
    expect(parent.style.position).toBe("relative");
    ov.hide();
    expect(ov.element.parentNode).toBeNull();
    expect(ov.currentPosition).toBeUndefined();
  });

  it("show() is idempotent (does not re-append)", () => {
    ov.show(parent);
    ov.show(parent);
    expect(parent.querySelectorAll(".parallx-drop-overlay").length).toBe(1);
  });

  it("computePosition maps cursor to Top / Bottom / Left / Right / Center via 25% edge band", () => {
    const r = rect(100, 100);
    expect(ov.computePosition(50, 5, r)).toBe(DropPosition.Top);
    expect(ov.computePosition(50, 95, r)).toBe(DropPosition.Bottom);
    expect(ov.computePosition(5, 50, r)).toBe(DropPosition.Left);
    expect(ov.computePosition(95, 50, r)).toBe(DropPosition.Right);
    expect(ov.computePosition(50, 50, r)).toBe(DropPosition.Center);
  });

  it("computePosition tolerates zero-size rect by treating fractions as 0.5 (center)", () => {
    const r = rect(0, 0);
    expect(ov.computePosition(0, 0, r)).toBe(DropPosition.Center);
  });

  it("highlight() applies drop-highlight + drop-highlight-<pos> on the matching zone", () => {
    ov.show(parent);
    ov.highlight(DropPosition.Top);
    const topZone = ov.element.querySelector(".drop-zone-top")!;
    expect(topZone.classList.contains("drop-highlight")).toBe(true);
    expect(topZone.classList.contains("drop-highlight-top")).toBe(true);
    expect(ov.currentPosition).toBe(DropPosition.Top);
  });

  it("highlight() to a new position clears the previous highlight", () => {
    ov.show(parent);
    ov.highlight(DropPosition.Top);
    ov.highlight(DropPosition.Right);
    const topZone = ov.element.querySelector(".drop-zone-top")!;
    const rightZone = ov.element.querySelector(".drop-zone-right")!;
    expect(topZone.classList.contains("drop-highlight")).toBe(false);
    expect(rightZone.classList.contains("drop-highlight")).toBe(true);
  });

  it("highlight() is a no-op when position is already current", () => {
    ov.show(parent);
    ov.highlight(DropPosition.Center);
    const centerZone = ov.element.querySelector(".drop-zone-center")!;
    const before = centerZone.className;
    ov.highlight(DropPosition.Center);
    expect(centerZone.className).toBe(before);
  });

  it("highlightInvalid() clears any drop-highlight and tags overlay --invalid", () => {
    ov.show(parent);
    ov.highlight(DropPosition.Top);
    ov.highlightInvalid();
    const topZone = ov.element.querySelector(".drop-zone-top")!;
    expect(topZone.classList.contains("drop-highlight")).toBe(false);
    expect(ov.element.classList.contains("parallx-drop-overlay--invalid")).toBe(true);
    expect(ov.currentPosition).toBeUndefined();
  });

  it("hide() clears highlights and --invalid class", () => {
    ov.show(parent);
    ov.highlightInvalid();
    ov.hide();
    expect(ov.element.classList.contains("parallx-drop-overlay--invalid")).toBe(false);
  });
});
