/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from "vitest";
import { DropZone } from "../../src/dnd/dropZone";
import { DropPosition, VIEW_DRAG_MIME, type DragPayload } from "../../src/dnd/dndTypes";

function makeDataTransfer(payload?: DragPayload, withMime = true) {
  const types: string[] = withMime ? [VIEW_DRAG_MIME] : [];
  const store = new Map<string, string>();
  if (payload && withMime) store.set(VIEW_DRAG_MIME, JSON.stringify(payload));
  return {
    types,
    dropEffect: "none" as string,
    effectAllowed: "all" as string,
    setData: (k: string, v: string) => store.set(k, v),
    getData: (k: string) => store.get(k) ?? "",
  };
}

function fireDrag(type: string, dt: any, target: HTMLElement, extra?: Record<string, unknown>): DragEvent {
  const ev = new Event(type, { bubbles: true, cancelable: true }) as DragEvent;
  Object.defineProperty(ev, "dataTransfer", { value: dt });
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      Object.defineProperty(ev, k, { value: v });
    }
  }
  target.dispatchEvent(ev);
  return ev;
}

describe("DropZone pin", () => {
  let host: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  it("accepts() defaults to true when no acceptFn provided", () => {
    const dz = new DropZone("p1", host);
    expect(dz.accepts({ viewId: "v" } as any)).toBe(true);
    dz.dispose();
  });

  it("accepts() forwards to acceptFn when provided", () => {
    const dz = new DropZone("p1", host, (p) => (p as any).viewId === "ok");
    expect(dz.accepts({ viewId: "ok" } as any)).toBe(true);
    expect(dz.accepts({ viewId: "no" } as any)).toBe(false);
    dz.dispose();
  });

  it("ignores drag events without the parallx view MIME (no preventDefault)", () => {
    const dz = new DropZone("p1", host);
    const dt = makeDataTransfer(undefined, /* withMime */ false);
    const ev = fireDrag("dragover", dt, host);
    expect(ev.defaultPrevented).toBe(false);
    dz.dispose();
  });

  it("dragover with the right MIME calls preventDefault and sets dropEffect='move'", () => {
    const dz = new DropZone("p1", host);
    const dt = makeDataTransfer({ viewId: "v" } as any);
    const ev = fireDrag("dragover", dt, host, { clientX: 50, clientY: 50 });
    expect(ev.defaultPrevented).toBe(true);
    expect(dt.dropEffect).toBe("move");
    dz.dispose();
  });

  it("drop fires onDidDrop with the parsed payload and targetPartId", () => {
    const dz = new DropZone("part.alpha", host);
    const payload = { viewId: "vv" } as any;
    const drops: any[] = [];
    dz.onDidDrop((r) => drops.push(r));

    // Simulate enter/over so the overlay records a position
    const dt = makeDataTransfer(payload);
    fireDrag("dragenter", dt, host, { clientX: 10, clientY: 10 });
    fireDrag("dragover", dt, host, { clientX: 10, clientY: 10 });
    fireDrag("drop", dt, host, { clientX: 10, clientY: 10 });

    expect(drops.length).toBe(1);
    expect(drops[0].targetPartId).toBe("part.alpha");
    expect(drops[0].payload).toEqual(payload);
    expect(drops[0].position).toBeDefined();
    dz.dispose();
  });

  it("drop does not fire onDidDrop when payload is rejected by acceptFn", () => {
    const dz = new DropZone("p", host, () => false);
    const drops: any[] = [];
    dz.onDidDrop((r) => drops.push(r));
    const dt = makeDataTransfer({ viewId: "x" } as any);
    fireDrag("drop", dt, host);
    expect(drops.length).toBe(0);
    dz.dispose();
  });

  it("drop with no payload (no MIME) does not fire onDidDrop", () => {
    const dz = new DropZone("p", host);
    const drops: any[] = [];
    dz.onDidDrop((r) => drops.push(r));
    const dt = makeDataTransfer(undefined, false);
    fireDrag("drop", dt, host);
    expect(drops.length).toBe(0);
    dz.dispose();
  });

  it("dispose detaches drag listeners (no more onDidDrop fires)", () => {
    const dz = new DropZone("p", host);
    const drops: any[] = [];
    dz.onDidDrop((r) => drops.push(r));
    dz.dispose();
    const dt = makeDataTransfer({ viewId: "x" } as any);
    fireDrag("drop", dt, host);
    expect(drops.length).toBe(0);
  });

  it("VIEW_DRAG_MIME is the documented constant", () => {
    expect(VIEW_DRAG_MIME).toBe("application/parallx-view");
  });

  it("DropPosition.Center is the fallback when no over event preceded the drop", () => {
    const dz = new DropZone("p", host);
    const drops: any[] = [];
    dz.onDidDrop((r) => drops.push(r));
    const dt = makeDataTransfer({ viewId: "x" } as any);
    fireDrag("drop", dt, host);
    expect(drops[0].position).toBe(DropPosition.Center);
    dz.dispose();
  });
});
