/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from "vitest";
import { DragAndDropController } from "../../src/dnd/dragAndDrop.js";
import { DropPosition, VIEW_DRAG_MIME, type DragPayload } from "../../src/dnd/dndTypes.js";

describe("DragAndDropController pin", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  it("makeDraggable sets draggable + aria-grabbed=false", () => {
    const ctrl = new DragAndDropController();
    const el = document.createElement("div");
    ctrl.makeDraggable(el, { viewId: "v1", sourcePartId: "p1" });
    expect(el.draggable).toBe(true);
    expect(el.getAttribute("aria-grabbed")).toBe("false");
    ctrl.dispose();
  });

  it("dragstart writes payload to dataTransfer, adds .dragging, fires onDidDragStart", () => {
    const ctrl = new DragAndDropController();
    const el = document.createElement("div");
    const payload: DragPayload = { viewId: "v1", sourcePartId: "p1" };
    ctrl.makeDraggable(el, payload);

    const data: Record<string, string> = {};
    const dt = {
      effectAllowed: "" as DataTransfer["effectAllowed"],
      setData(type: string, val: string) { data[type] = val; },
      getData(type: string) { return data[type] ?? ""; },
    } as unknown as DataTransfer;

    let started: DragPayload | null = null;
    ctrl.onDidDragStart(p => { started = p; });

    const evt = new Event("dragstart", { bubbles: true, cancelable: true }) as DragEvent;
    Object.defineProperty(evt, "dataTransfer", { value: dt });
    el.dispatchEvent(evt);

    expect(data[VIEW_DRAG_MIME]).toBe(JSON.stringify(payload));
    expect(dt.effectAllowed).toBe("move");
    expect(el.classList.contains("dragging")).toBe(true);
    expect(el.getAttribute("aria-grabbed")).toBe("true");
    expect(started).toEqual(payload);
    ctrl.dispose();
  });

  it("dragend removes .dragging, resets aria-grabbed, fires onDidDragEnd", () => {
    const ctrl = new DragAndDropController();
    const el = document.createElement("div");
    el.classList.add("dragging");
    el.setAttribute("aria-grabbed", "true");
    ctrl.makeDraggable(el, { viewId: "v1", sourcePartId: "p1" });
    let ended = 0;
    ctrl.onDidDragEnd(() => ended++);
    el.dispatchEvent(new Event("dragend", { bubbles: true }));
    expect(el.classList.contains("dragging")).toBe(false);
    expect(el.getAttribute("aria-grabbed")).toBe("false");
    expect(ended).toBe(1);
    ctrl.dispose();
  });

  it("registerTarget adds a drop zone; hasTarget/getTargetIds reflect it", () => {
    const ctrl = new DragAndDropController();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const z = ctrl.registerTarget("partA", host);
    expect(z.partId).toBe("partA");
    expect(ctrl.hasTarget("partA")).toBe(true);
    expect(ctrl.getTargetIds()).toEqual(["partA"]);
    ctrl.dispose();
  });

  it("re-registering same partId replaces the old target", () => {
    const ctrl = new DragAndDropController();
    const host1 = document.createElement("div");
    const host2 = document.createElement("div");
    document.body.append(host1, host2);
    const a = ctrl.registerTarget("partA", host1);
    const b = ctrl.registerTarget("partA", host2);
    expect(a).not.toBe(b);
    expect(ctrl.getTargetIds()).toEqual(["partA"]);
    ctrl.dispose();
  });

  it("unregisterTarget removes the entry", () => {
    const ctrl = new DragAndDropController();
    const host = document.createElement("div");
    document.body.appendChild(host);
    ctrl.registerTarget("partA", host);
    ctrl.unregisterTarget("partA");
    expect(ctrl.hasTarget("partA")).toBe(false);
    ctrl.dispose();
  });

  it("performKeyboardDrop fires onDidDropComplete only when the target accepts", () => {
    const ctrl = new DragAndDropController();
    const host = document.createElement("div");
    document.body.appendChild(host);
    ctrl.registerTarget("partA", host, p => p.viewId === "yes");
    const drops: unknown[] = [];
    ctrl.onDidDropComplete(r => drops.push(r));

    ctrl.performKeyboardDrop({ viewId: "yes", sourcePartId: "src" }, "partA", DropPosition.Center);
    ctrl.performKeyboardDrop({ viewId: "no", sourcePartId: "src" }, "partA", DropPosition.Top);
    ctrl.performKeyboardDrop({ viewId: "yes", sourcePartId: "src" }, "missing", DropPosition.Top);

    expect(drops.length).toBe(1);
    ctrl.dispose();
  });

  it("dispose() unregisters all targets", () => {
    const ctrl = new DragAndDropController();
    const host = document.createElement("div");
    document.body.appendChild(host);
    ctrl.registerTarget("partA", host);
    ctrl.registerTarget("partB", host);
    ctrl.dispose();
    expect(ctrl.getTargetIds()).toEqual([]);
  });
});
