/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from "vitest";
import { StatusBarPart, STATUS_BAR_HEIGHT } from "../../src/parts/statusBarPart.js";
import { StatusBarAlignment } from "../../src/services/serviceTypes.js";
import { PartId, PartPosition } from "../../src/parts/partTypes.js";

function mount() {
  document.body.innerHTML = "";
  const host = document.createElement("div");
  document.body.appendChild(host);
  const part = new StatusBarPart();
  part.create(host);
  return { host, part };
}

describe("StatusBarPart pin", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  it("descriptor: id, position, fixed height constraints", () => {
    const part = new StatusBarPart();
    expect(part.id).toBe(PartId.StatusBar);
    expect(part.position).toBe(PartPosition.Bottom);
    expect(part.minimumHeight).toBe(STATUS_BAR_HEIGHT);
    expect(part.maximumHeight).toBe(STATUS_BAR_HEIGHT);
  });

  it("createContent builds left/right items containers", () => {
    const { part } = mount();
    expect(part.element.querySelector(".left-items.items-container")).not.toBeNull();
    expect(part.element.querySelector(".right-items.items-container")).not.toBeNull();
  });

  it("addEntry creates DOM, classifies by alignment, fires onDidAddEntry", () => {
    const { part } = mount();
    let added = 0;
    part.onDidAddEntry(() => added++);
    part.addEntry({ id: "a", text: "Left", alignment: StatusBarAlignment.Left });
    part.addEntry({ id: "b", text: "Right", alignment: StatusBarAlignment.Right });
    expect(added).toBe(2);
    const left = part.element.querySelector(".left-items #a");
    const right = part.element.querySelector(".right-items #b");
    expect(left).not.toBeNull();
    expect(right).not.toBeNull();
    expect(left?.classList.contains("left")).toBe(true);
    expect(right?.classList.contains("right")).toBe(true);
  });

  it("left items sorted highest priority first (left→right) within left container", () => {
    const { part } = mount();
    part.addEntry({ id: "lo", text: "lo", alignment: StatusBarAlignment.Left, priority: 1 });
    part.addEntry({ id: "hi", text: "hi", alignment: StatusBarAlignment.Left, priority: 10 });
    part.addEntry({ id: "mid", text: "mid", alignment: StatusBarAlignment.Left, priority: 5 });
    const ids = Array.from(part.element.querySelectorAll<HTMLElement>(".left-items .statusbar-item")).map(e => e.id);
    expect(ids).toEqual(["hi", "mid", "lo"]);
  });

  it("addEntry with existing id replaces previous DOM (update semantics)", () => {
    const { part } = mount();
    part.addEntry({ id: "x", text: "v1", alignment: StatusBarAlignment.Left });
    part.addEntry({ id: "x", text: "v2", alignment: StatusBarAlignment.Left });
    const items = part.element.querySelectorAll("#x");
    expect(items.length).toBe(1);
    expect(items[0].textContent).toContain("v2");
  });

  it("clicking an entry with command invokes the wired command executor", () => {
    const { part } = mount();
    let received: string | undefined;
    part.setCommandExecutor((id) => { received = id; });
    part.addEntry({ id: "go", text: "Go", alignment: StatusBarAlignment.Left, command: "cmd.do" });
    const label = part.element.querySelector<HTMLElement>("#go .statusbar-item-label")!;
    label.click();
    expect(received).toBe("cmd.do");
  });

  it("entries with command get cursor:pointer; without command get cursor:default", () => {
    const { part } = mount();
    part.addEntry({ id: "c1", text: "c", alignment: StatusBarAlignment.Left, command: "x" });
    part.addEntry({ id: "c2", text: "n", alignment: StatusBarAlignment.Left });
    const l1 = part.element.querySelector<HTMLElement>("#c1 .statusbar-item-label")!;
    const l2 = part.element.querySelector<HTMLElement>("#c2 .statusbar-item-label")!;
    expect(l1.style.cursor).toBe("pointer");
    expect(l2.style.cursor).toBe("default");
  });

  it("accessor.update() updates text + tooltip in-place", () => {
    const { part } = mount();
    const acc = part.addEntry({ id: "u", text: "old", alignment: StatusBarAlignment.Left, tooltip: "T1" });
    acc.update({ text: "new", tooltip: "T2" });
    const label = part.element.querySelector<HTMLElement>("#u .statusbar-item-label")!;
    expect(label.textContent).toContain("new");
  });

  it("accessor.dispose() removes entry from DOM and fires onDidRemoveEntry", () => {
    const { part } = mount();
    let removed: string | undefined;
    part.onDidRemoveEntry((id) => { removed = id; });
    const acc = part.addEntry({ id: "d", text: "d", alignment: StatusBarAlignment.Right });
    acc.dispose();
    expect(part.element.querySelector("#d")).toBeNull();
    expect(removed).toBe("d");
  });

  it("removeEntry(id) on unknown id is a no-op (no event)", () => {
    const { part } = mount();
    let removed = 0;
    part.onDidRemoveEntry(() => removed++);
    part.removeEntry("missing");
    expect(removed).toBe(0);
  });

  it("getEntries() returns entries sorted by priority descending", () => {
    const { part } = mount();
    part.addEntry({ id: "a", text: "a", alignment: StatusBarAlignment.Left, priority: 1 });
    part.addEntry({ id: "b", text: "b", alignment: StatusBarAlignment.Left, priority: 5 });
    part.addEntry({ id: "c", text: "c", alignment: StatusBarAlignment.Right, priority: 3 });
    const ids = part.getEntries().map(e => e.id);
    expect(ids).toEqual(["b", "c", "a"]);
  });

  it("right-click on container fires onDidContextMenu with client coords", () => {
    const { part } = mount();
    let evt: { x: number; y: number } | undefined;
    part.onDidContextMenu((e) => { evt = e; });
    const content = part.element.querySelector<HTMLElement>(".part-content")!;
    content.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 50, clientY: 60 }));
    expect(evt).toEqual({ x: 50, y: 60 });
  });

  it("entry with htmlElement renders custom node instead of text", () => {
    const { part } = mount();
    const custom = document.createElement("strong");
    custom.textContent = "CUSTOM";
    part.addEntry({ id: "h", text: "ignored", alignment: StatusBarAlignment.Left, htmlElement: custom });
    const label = part.element.querySelector<HTMLElement>("#h .statusbar-item-label")!;
    expect(label.contains(custom)).toBe(true);
    expect(label.textContent).toBe("CUSTOM");
  });
});
