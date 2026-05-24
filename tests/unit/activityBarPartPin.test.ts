/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from "vitest";
import { ActivityBarPart } from "../../src/parts/activityBarPart.js";
import { PartId, PartPosition } from "../../src/parts/partTypes.js";

function mount() {
  document.body.innerHTML = "";
  const host = document.createElement("div");
  document.body.appendChild(host);
  const part = new ActivityBarPart();
  part.create(host);
  return { host, part };
}

describe("ActivityBarPart pin", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  it("descriptor: id, position Left, fixed 48px width", () => {
    const part = new ActivityBarPart();
    expect(part.id).toBe(PartId.ActivityBar);
    expect(part.position).toBe(PartPosition.Left);
    expect(part.minimumWidth).toBe(48);
    expect(part.maximumWidth).toBe(48);
  });

  it("addIcon registers icon and creates DOM with data-icon-id", () => {
    const { part } = mount();
    const d = part.addIcon({ id: "explorer", icon: "E", label: "Explorer", source: "builtin" });
    expect(part.hasIcon("explorer")).toBe(true);
    expect(part.element.querySelector('[data-icon-id="explorer"]')).not.toBeNull();
    d.dispose();
    expect(part.hasIcon("explorer")).toBe(false);
    expect(part.element.querySelector('[data-icon-id="explorer"]')).toBeNull();
  });

  it("addIcon with duplicate id is a no-op (warns)", () => {
    const { part } = mount();
    part.addIcon({ id: "x", icon: "X", label: "x", source: "builtin" });
    part.addIcon({ id: "x", icon: "Y", label: "y", source: "builtin" });
    expect(part.element.querySelectorAll('[data-icon-id="x"]').length).toBe(1);
  });

  it("setActiveIcon toggles 'active' class and aria-selected; fires onDidChangeActiveIcon", () => {
    const { part } = mount();
    part.addIcon({ id: "a", icon: "A", label: "a", source: "builtin" });
    part.addIcon({ id: "b", icon: "B", label: "b", source: "builtin" });
    const seen: (string | undefined)[] = [];
    part.onDidChangeActiveIcon((id) => seen.push(id));
    part.setActiveIcon("a");
    const aBtn = part.element.querySelector('[data-icon-id="a"]')!;
    expect(aBtn.classList.contains("active")).toBe(true);
    expect(aBtn.getAttribute("aria-selected")).toBe("true");
    part.setActiveIcon("b");
    expect(aBtn.classList.contains("active")).toBe(false);
    expect(aBtn.getAttribute("aria-selected")).toBe("false");
    part.setActiveIcon("b"); // no-op
    expect(seen).toEqual(["a", "b"]);
  });

  it("removing the active icon clears active state and fires undefined", () => {
    const { part } = mount();
    part.addIcon({ id: "a", icon: "A", label: "a", source: "builtin" });
    part.setActiveIcon("a");
    const seen: (string | undefined)[] = [];
    part.onDidChangeActiveIcon((id) => seen.push(id));
    part.removeIcon("a");
    expect(part.activeIconId).toBeUndefined();
    expect(seen).toEqual([undefined]);
  });

  it("getIcons returns all registered descriptors", () => {
    const { part } = mount();
    part.addIcon({ id: "a", icon: "A", label: "a", source: "builtin" });
    part.addIcon({ id: "b", icon: "B", label: "b", source: "contributed" });
    const ids = part.getIcons().map(i => i.id).sort();
    expect(ids).toEqual(["a", "b"]);
  });

  it("setBadge / clearBadge toggles badge classes and content", () => {
    const { part } = mount();
    part.addIcon({ id: "a", icon: "A", label: "a", source: "builtin" });
    const btn = part.element.querySelector('[data-icon-id="a"]')!;
    const badge = btn.querySelector(".activity-bar-badge, .badge")!;
    expect(badge).not.toBeNull();
    expect(badge.classList.contains("badge-hidden")).toBe(true);
    part.setBadge("a", { count: 3 });
    expect(badge.classList.contains("badge-hidden")).toBe(false);
    part.setBadge("a", undefined);
    expect(badge.classList.contains("badge-hidden")).toBe(true);
  });

  it("setBadge with dot toggles dot variant class", () => {
    const { part } = mount();
    part.addIcon({ id: "a", icon: "A", label: "a", source: "builtin" });
    const btn = part.element.querySelector('[data-icon-id="a"]')!;
    const badge = btn.querySelector(".activity-bar-badge, .badge")!;
    part.setBadge("a", { dot: true });
    expect(badge.classList.contains("activity-bar-badge--dot")).toBe(true);
  });

  it("click on icon fires onDidClickIcon with id + source", () => {
    const { part } = mount();
    part.addIcon({ id: "a", icon: "A", label: "a", source: "contributed" });
    let evt: { iconId: string; source: string } | undefined;
    part.onDidClickIcon((e) => { evt = e; });
    const btn = part.element.querySelector<HTMLElement>('[data-icon-id="a"]')!;
    btn.click();
    expect(evt).toEqual({ iconId: "a", source: "contributed" });
  });

  it("right-click on icon fires onDidContextMenuIcon with coords", () => {
    const { part } = mount();
    part.addIcon({ id: "a", icon: "A", label: "a", source: "builtin" });
    let evt: { iconId: string; x: number; y: number } | undefined;
    part.onDidContextMenuIcon((e) => { evt = e; });
    const btn = part.element.querySelector<HTMLElement>('[data-icon-id="a"]')!;
    btn.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 20 }));
    expect(evt).toEqual({ iconId: "a", x: 10, y: 20 });
  });
});
