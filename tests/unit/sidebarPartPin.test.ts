/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from "vitest";
import { SidebarPart } from "../../src/parts/sidebarPart.js";
import { PartId, PartPosition } from "../../src/parts/partTypes.js";
import { Orientation } from "../../src/layout/layoutTypes.js";

function mount() {
  document.body.innerHTML = "";
  const host = document.createElement("div");
  document.body.appendChild(host);
  const part = new SidebarPart();
  part.create(host);
  return { host, part };
}

describe("SidebarPart pin", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  it("descriptor: id, name, position, constraints, snap", () => {
    const part = new SidebarPart();
    expect(part.id).toBe(PartId.Sidebar);
    expect(part.name).toBe("Side Bar");
    expect(part.position).toBe(PartPosition.Left);
    expect(part.minimumWidth).toBe(170);
    expect(part.maximumWidth).toBe(Number.POSITIVE_INFINITY);
    expect(part.snap).toBe(true);
  });

  it("access to .element before create() throws", () => {
    const part = new SidebarPart();
    expect(() => part.element).toThrow(/has not been created/);
    expect(() => part.contentElement).toThrow(/has not been created/);
  });

  it("create() builds title + content; tagged with role/aria/data-part-id", () => {
    const { host, part } = mount();
    expect(host.contains(part.element)).toBe(true);
    expect(part.element.getAttribute("role")).toBe("region");
    expect(part.element.getAttribute("aria-label")).toBe("Side Bar");
    expect(part.element.getAttribute("data-part-id")).toBe(PartId.Sidebar);
    expect(part.element.classList.contains("part")).toBe(true);
    expect(part.element.querySelector(".part-title")).not.toBeNull();
    expect(part.element.querySelector(".part-content")).not.toBeNull();
  });

  it("createContent builds activity bar + view slots; header slot wired from title area", () => {
    const { part } = mount();
    expect(part.activityBarSlot).toBeTruthy();
    expect(part.viewContainerSlot).toBeTruthy();
    expect(part.headerSlot).toBeTruthy();
    expect(part.activityBarSlot!.classList.contains("sidebar-activity-bar")).toBe(true);
    expect(part.viewContainerSlot!.classList.contains("sidebar-views")).toBe(true);
    expect(part.headerSlot!.classList.contains("sidebar-header")).toBe(true);
  });

  it("create() is idempotent (calling twice does not rebuild)", () => {
    const { host, part } = mount();
    const el = part.element;
    part.create(host);
    expect(part.element).toBe(el);
  });

  it("mount(parent) moves the existing element into a new parent", () => {
    const { part } = mount();
    const other = document.createElement("div");
    document.body.appendChild(other);
    part.mount(other);
    expect(other.contains(part.element)).toBe(true);
  });

  it("layout() sets element width/height styles and fires onDidChangeSize when changed", () => {
    const { part } = mount();
    let sizes = 0;
    part.onDidChangeSize(() => sizes++);
    part.layout(200, 300, Orientation.Horizontal);
    expect(part.width).toBe(200);
    expect(part.height).toBe(300);
    expect(part.element.style.width).toBe("200px");
    expect(part.element.style.height).toBe("300px");
    expect(sizes).toBe(1);
    part.layout(200, 300, Orientation.Horizontal); // unchanged
    expect(sizes).toBe(1);
  });

  it("setVisible() toggles 'hidden' class and fires onDidChangeVisibility only on change", () => {
    const { part } = mount();
    let changes = 0;
    part.onDidChangeVisibility(() => changes++);
    part.setVisible(true);
    expect(changes).toBe(0); // already visible
    part.setVisible(false);
    expect(part.visible).toBe(false);
    expect(part.element.classList.contains("hidden")).toBe(true);
    expect(changes).toBe(1);
    part.setVisible(true);
    expect(part.element.classList.contains("hidden")).toBe(false);
    expect(changes).toBe(2);
  });

  it("setActiveView fires onDidChangeActiveView only on change", () => {
    const part = new SidebarPart();
    const seen: (string | undefined)[] = [];
    part.onDidChangeActiveView((v) => seen.push(v));
    part.setActiveView("explorer");
    part.setActiveView("explorer");
    part.setActiveView(undefined);
    expect(seen).toEqual(["explorer", undefined]);
  });

  it("saveState / restoreState round-trip preserves visibility, position, activeViewId", () => {
    const part = new SidebarPart();
    part.setActiveView("scm");
    part.setVisible(false);
    const s = part.saveState();
    expect(s.id).toBe(PartId.Sidebar);
    expect(s.visible).toBe(false);
    expect(s.position).toBe(PartPosition.Left);
    expect(s.data?.activeViewId).toBe("scm");

    const part2 = new SidebarPart();
    part2.restoreState(s);
    expect(part2.visible).toBe(false);
    expect(part2.activeViewId).toBe("scm");
  });

  it("toJSON returns a structural summary", () => {
    const { part } = mount();
    part.layout(180, 400, Orientation.Horizontal);
    const j = part.toJSON() as Record<string, unknown>;
    expect(j.id).toBe(PartId.Sidebar);
    expect(j.type).toBe("part");
    expect(j.width).toBe(180);
    expect(j.height).toBe(400);
    expect(j.visible).toBe(true);
  });
});
