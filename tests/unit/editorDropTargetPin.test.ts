/** @vitest-environment jsdom */
import { describe, it, expect, vi } from "vitest";
import { EditorDropTarget } from "../../src/editor/editorDropTarget";
import { EDITOR_TAB_DRAG_TYPE, GroupDirection } from "../../src/editor/editorTypes";

function makeDt(typesIncludesEditorTab: boolean, payload?: object) {
  const types = typesIncludesEditorTab ? [EDITOR_TAB_DRAG_TYPE] : ["text/plain"];
  return {
    types,
    dropEffect: "none",
    effectAllowed: "all",
    setData: vi.fn(),
    getData: vi.fn((type: string) =>
      type === EDITOR_TAB_DRAG_TYPE && payload !== undefined ? JSON.stringify(payload) : ""),
  };
}

function dispatch(target: HTMLElement, type: string, dt: any, opts: Partial<{ clientX: number; clientY: number }> = {}) {
  const ev = new Event(type, { bubbles: true, cancelable: true }) as any;
  Object.defineProperty(ev, "dataTransfer", { value: dt });
  if (opts.clientX !== undefined) ev.clientX = opts.clientX;
  if (opts.clientY !== undefined) ev.clientY = opts.clientY;
  target.dispatchEvent(ev);
  return ev;
}

function setRect(el: HTMLElement, rect: { left: number; top: number; width: number; height: number }) {
  el.getBoundingClientRect = () => ({
    left: rect.left, top: rect.top, right: rect.left + rect.width, bottom: rect.top + rect.height,
    width: rect.width, height: rect.height, x: rect.left, y: rect.top, toJSON: () => ({}),
  } as DOMRect);
}

function makeGroup(container: HTMLElement, id: string, hasEditors = false): HTMLElement {
  const group = document.createElement("div");
  group.classList.add("editor-group");
  group.setAttribute("data-editor-group-id", id);
  const tabBar = document.createElement("div");
  tabBar.classList.add("editor-tab-bar");
  if (hasEditors) {
    const tab = document.createElement("div");
    tab.classList.add("ui-tab");
    tabBar.appendChild(tab);
  }
  const paneContainer = document.createElement("div");
  paneContainer.classList.add("editor-pane-container");
  group.appendChild(tabBar);
  group.appendChild(paneContainer);
  container.appendChild(group);
  return group;
}

describe("EditorDropTarget pin", () => {
  it("ignores dragover without the editor-tab MIME type", () => {
    const container = document.createElement("div");
    setRect(container, { left: 0, top: 0, width: 400, height: 300 });
    const group = makeGroup(container, "g1");
    setRect(group, { left: 0, top: 0, width: 400, height: 300 });

    const target = new EditorDropTarget(container);

    const paneContainer = group.querySelector(".editor-pane-container") as HTMLElement;
    dispatch(paneContainer, "dragover", makeDt(false));

    expect(container.querySelector(".editor-drop-overlay")).toBeNull();
    target.dispose();
  });

  it("creates a single overlay on dragover with editor-tab MIME and reuses it for the same group", () => {
    const container = document.createElement("div");
    setRect(container, { left: 0, top: 0, width: 400, height: 300 });
    const group = makeGroup(container, "g1", true);
    setRect(group, { left: 0, top: 0, width: 400, height: 300 });
    const pane = group.querySelector(".editor-pane-container") as HTMLElement;

    const target = new EditorDropTarget(container);

    dispatch(pane, "dragover", makeDt(true));
    dispatch(pane, "dragover", makeDt(true));

    expect(container.querySelectorAll(".editor-drop-overlay").length).toBe(1);
    target.dispose();
  });

  it("suppresses overlay when dragging over the tab bar of a non-empty group", () => {
    const container = document.createElement("div");
    setRect(container, { left: 0, top: 0, width: 400, height: 300 });
    const group = makeGroup(container, "g1", /*hasEditors*/ true);
    setRect(group, { left: 0, top: 0, width: 400, height: 300 });
    const tabBar = group.querySelector(".editor-tab-bar") as HTMLElement;

    const target = new EditorDropTarget(container);
    dispatch(tabBar, "dragover", makeDt(true));

    expect(container.querySelector(".editor-drop-overlay")).toBeNull();
    target.dispose();
  });

  it("creates overlay over tab bar when the group is empty (no .ui-tab children)", () => {
    const container = document.createElement("div");
    setRect(container, { left: 0, top: 0, width: 400, height: 300 });
    const group = makeGroup(container, "g1", /*hasEditors*/ false);
    setRect(group, { left: 0, top: 0, width: 400, height: 300 });
    const tabBar = group.querySelector(".editor-tab-bar") as HTMLElement;

    const target = new EditorDropTarget(container);
    dispatch(tabBar, "dragover", makeDt(true));

    expect(container.querySelectorAll(".editor-drop-overlay").length).toBe(1);
    target.dispose();
  });

  it("dispose() clears overlay and detaches listeners", () => {
    const container = document.createElement("div");
    setRect(container, { left: 0, top: 0, width: 400, height: 300 });
    const group = makeGroup(container, "g1", true);
    setRect(group, { left: 0, top: 0, width: 400, height: 300 });
    const pane = group.querySelector(".editor-pane-container") as HTMLElement;

    const target = new EditorDropTarget(container);
    dispatch(pane, "dragover", makeDt(true));
    expect(container.querySelector(".editor-drop-overlay")).not.toBeNull();

    target.dispose();
    expect(container.querySelector(".editor-drop-overlay")).toBeNull();
  });

  it("drop with center position fires onDidDrop with targetGroupId and splitDirection=undefined (merge)", () => {
    const container = document.createElement("div");
    setRect(container, { left: 0, top: 0, width: 400, height: 300 });
    const group = makeGroup(container, "g-center", true);
    setRect(group, { left: 0, top: 0, width: 400, height: 300 });
    const pane = group.querySelector(".editor-pane-container") as HTMLElement;

    const target = new EditorDropTarget(container);
    const events: any[] = [];
    target.onDidDrop(e => events.push(e));

    // Create overlay
    dispatch(pane, "dragover", makeDt(true));
    const overlay = container.querySelector(".editor-drop-overlay") as HTMLElement;
    setRect(overlay, { left: 0, top: 0, width: 400, height: 300 });

    // Move into center → currentPosition === Center
    dispatch(overlay, "dragover", makeDt(true), { clientX: 200, clientY: 150 });
    // Drop with full payload
    dispatch(overlay, "drop", makeDt(true, { sourceGroupId: "src", editorIndex: 2, inputId: "x" }));

    expect(events.length).toBe(1);
    expect(events[0].targetGroupId).toBe("g-center");
    expect(events[0].splitDirection).toBeUndefined();
    expect(events[0].data).toEqual({ sourceGroupId: "src", editorIndex: 2, inputId: "x" });
  });

  it("drop on left edge fires GroupDirection.Left; right edge → Right; top → Up; bottom → Down", () => {
    const cases: Array<[number, number, GroupDirection]> = [
      [10, 150, GroupDirection.Left],
      [390, 150, GroupDirection.Right],
      [200, 10, GroupDirection.Up],
      [200, 290, GroupDirection.Down],
    ];

    for (const [x, y, expected] of cases) {
      const container = document.createElement("div");
      setRect(container, { left: 0, top: 0, width: 400, height: 300 });
      const group = makeGroup(container, "g", true);
      setRect(group, { left: 0, top: 0, width: 400, height: 300 });
      const pane = group.querySelector(".editor-pane-container") as HTMLElement;

      const target = new EditorDropTarget(container);
      const events: any[] = [];
      target.onDidDrop(e => events.push(e));

      dispatch(pane, "dragover", makeDt(true));
      const overlay = container.querySelector(".editor-drop-overlay") as HTMLElement;
      setRect(overlay, { left: 0, top: 0, width: 400, height: 300 });

      dispatch(overlay, "dragover", makeDt(true), { clientX: x, clientY: y });
      dispatch(overlay, "drop", makeDt(true, { sourceGroupId: "s", editorIndex: 0, inputId: "i" }));

      expect(events[0].splitDirection).toBe(expected);
      target.dispose();
    }
  });

  it("drop with no payload does NOT fire onDidDrop, but still disposes the overlay", () => {
    const container = document.createElement("div");
    setRect(container, { left: 0, top: 0, width: 400, height: 300 });
    const group = makeGroup(container, "g", true);
    setRect(group, { left: 0, top: 0, width: 400, height: 300 });
    const pane = group.querySelector(".editor-pane-container") as HTMLElement;

    const target = new EditorDropTarget(container);
    const events: any[] = [];
    target.onDidDrop(e => events.push(e));

    dispatch(pane, "dragover", makeDt(true));
    const overlay = container.querySelector(".editor-drop-overlay") as HTMLElement;
    setRect(overlay, { left: 0, top: 0, width: 400, height: 300 });
    dispatch(overlay, "dragover", makeDt(true), { clientX: 200, clientY: 150 });

    // No payload — getData returns "" → undefined → no fire
    dispatch(overlay, "drop", makeDt(true));

    expect(events.length).toBe(0);
    expect(container.querySelector(".editor-drop-overlay")).toBeNull();
    target.dispose();
  });

  it("EDGE_THRESHOLD is 33% — pixel boundary inside the center stays Center", () => {
    const container = document.createElement("div");
    setRect(container, { left: 0, top: 0, width: 300, height: 300 });
    const group = makeGroup(container, "g", true);
    setRect(group, { left: 0, top: 0, width: 300, height: 300 });
    const pane = group.querySelector(".editor-pane-container") as HTMLElement;

    const target = new EditorDropTarget(container);
    const events: any[] = [];
    target.onDidDrop(e => events.push(e));

    dispatch(pane, "dragover", makeDt(true));
    const overlay = container.querySelector(".editor-drop-overlay") as HTMLElement;
    setRect(overlay, { left: 0, top: 0, width: 300, height: 300 });

    // 35% in from each side → squarely inside center band
    dispatch(overlay, "dragover", makeDt(true), { clientX: 105, clientY: 105 });
    dispatch(overlay, "drop", makeDt(true, { sourceGroupId: "s", editorIndex: 0, inputId: "i" }));

    expect(events[0].splitDirection).toBeUndefined();
    target.dispose();
  });
});
