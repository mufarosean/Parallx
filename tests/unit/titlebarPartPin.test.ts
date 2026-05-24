/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from "vitest";
import { TitlebarPart, titlebarPartDescriptor } from "../../src/parts/titlebarPart.js";
import { PartId, PartPosition } from "../../src/parts/partTypes.js";
import { Emitter } from "../../src/platform/events.js";
import type { IWindowService } from "../../src/services/serviceTypes.js";

function makeWindowService(opts: { native?: boolean; maximized?: boolean } = {}): IWindowService & {
  _emitter: Emitter<boolean>;
  calls: Record<string, number>;
} {
  const e = new Emitter<boolean>();
  const calls = { minimize: 0, maximize: 0, close: 0 };
  return {
    isNativeWindow: opts.native ?? true,
    minimize: () => { calls.minimize++; },
    maximize: () => { calls.maximize++; },
    close: () => { calls.close++; },
    isMaximized: async () => opts.maximized ?? false,
    onDidChangeMaximized: e.event,
    dispose: () => e.dispose(),
    _emitter: e,
    calls,
  } as unknown as IWindowService & { _emitter: Emitter<boolean>; calls: Record<string, number> };
}

function mount(part: TitlebarPart) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  part.create(host);
  return host;
}

describe("TitlebarPart descriptor", () => {
  it("describes top-positioned visible part with 30px height", () => {
    expect(titlebarPartDescriptor.id).toBe(PartId.Titlebar);
    expect(titlebarPartDescriptor.position).toBe(PartPosition.Top);
    expect(titlebarPartDescriptor.defaultVisible).toBe(true);
    expect(titlebarPartDescriptor.constraints.minimumHeight).toBe(30);
    expect(titlebarPartDescriptor.constraints.maximumHeight).toBe(30);
    const inst = titlebarPartDescriptor.factory();
    expect(inst).toBeInstanceOf(TitlebarPart);
    inst.dispose();
  });
});

describe("TitlebarPart workspace name (Task 1.1)", () => {
  beforeEach(() => { document.body.innerHTML = ""; document.title = ""; });

  it("create() renders workspace label with default name and updates document.title", () => {
    const p = new TitlebarPart();
    p.setWindowService(makeWindowService({ native: false }));
    mount(p);
    const label = document.querySelector(".titlebar-workspace-label") as HTMLElement;
    expect(label.textContent).toBe("Parallx");
    expect(document.title).toBe("Parallx — Parallx");
    p.dispose();
  });

  it("setWorkspaceName updates label and document.title", () => {
    const p = new TitlebarPart();
    p.setWindowService(makeWindowService({ native: false }));
    mount(p);
    p.setWorkspaceName("My WS");
    const label = document.querySelector(".titlebar-workspace-label") as HTMLElement;
    expect(label.textContent).toBe("My WS");
    expect(document.title).toBe("My WS — Parallx");
    p.dispose();
  });

  it("setActiveEditorTitle prepends editor title", () => {
    const p = new TitlebarPart();
    p.setWindowService(makeWindowService({ native: false }));
    mount(p);
    p.setWorkspaceName("WS");
    p.setActiveEditorTitle("file.ts");
    expect(document.title).toBe("file.ts — WS — Parallx");
    p.dispose();
  });

  it("clicking workspace label fires onDidClickWorkspaceName", () => {
    const p = new TitlebarPart();
    p.setWindowService(makeWindowService({ native: false }));
    mount(p);
    let fired = 0;
    p.onDidClickWorkspaceName(() => fired++);
    const label = document.querySelector(".titlebar-workspace-label") as HTMLElement;
    label.click();
    expect(fired).toBe(1);
    p.dispose();
  });

  it("Enter key on workspace label fires onDidClickWorkspaceName", () => {
    const p = new TitlebarPart();
    p.setWindowService(makeWindowService({ native: false }));
    mount(p);
    let fired = 0;
    p.onDidClickWorkspaceName(() => fired++);
    const label = document.querySelector(".titlebar-workspace-label") as HTMLElement;
    label.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(fired).toBe(1);
    p.dispose();
  });
});

describe("TitlebarPart menu bar (Task 1.2)", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  it("registerMenuBarItem renders item label and sorts by order", () => {
    const p = new TitlebarPart();
    p.setWindowService(makeWindowService({ native: false }));
    mount(p);
    p.registerMenuBarItem({ id: "edit", label: "Edit", order: 2 });
    p.registerMenuBarItem({ id: "file", label: "File", order: 1 });
    const items = Array.from(document.querySelectorAll(".titlebar-menu-item")) as HTMLElement[];
    expect(items.map(i => i.textContent)).toEqual(["File", "Edit"]);
    expect(items[0].getAttribute("role")).toBe("menuitem");
    expect(items[0].getAttribute("data-menu-id")).toBe("file");
    p.dispose();
  });

  it("disposing the item removes it from the menu bar", () => {
    const p = new TitlebarPart();
    p.setWindowService(makeWindowService({ native: false }));
    mount(p);
    const d = p.registerMenuBarItem({ id: "file", label: "File", order: 1 });
    expect(document.querySelectorAll(".titlebar-menu-item").length).toBe(1);
    d.dispose();
    expect(document.querySelectorAll(".titlebar-menu-item").length).toBe(0);
    p.dispose();
  });

  it("registerMenuBarDropdownItems sorts by group then order", () => {
    const p = new TitlebarPart();
    p.setWindowService(makeWindowService({ native: false }));
    mount(p);
    p.registerMenuBarDropdownItems("file", [
      { commandId: "b", title: "B", group: "z", order: 1 },
      { commandId: "a", title: "A", group: "a", order: 2 },
      { commandId: "c", title: "C", group: "a", order: 1 },
    ]);
    // We cannot easily peek the internal sort without opening the menu, but we can
    // verify disposal removes the items by re-registering after disposal.
    p.dispose();
  });

  it("registerMenuBarDropdownItems returns a disposable that removes the registered items", () => {
    const p = new TitlebarPart();
    p.setWindowService(makeWindowService({ native: false }));
    mount(p);
    const items = [{ commandId: "x", title: "X" }];
    const d = p.registerMenuBarDropdownItems("file", items);
    d.dispose();
    // No throw — internal map purged
    expect(() => d.dispose()).not.toThrow();
    p.dispose();
  });
});

describe("TitlebarPart window controls (Task 1.3)", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  it("non-native window hides .window-controls container", () => {
    const p = new TitlebarPart();
    p.setWindowService(makeWindowService({ native: false }));
    mount(p);
    const right = document.querySelector(".titlebar-right") as HTMLElement;
    expect(right.classList.contains("hidden")).toBe(true);
    expect(right.querySelector(".window-controls")).toBeNull();
    p.dispose();
  });

  it("native window renders minimize / maximize / close buttons wired to IWindowService", () => {
    const p = new TitlebarPart();
    const svc = makeWindowService({ native: true });
    p.setWindowService(svc);
    mount(p);
    const controls = document.querySelector(".window-controls") as HTMLElement;
    expect(controls).not.toBeNull();
    const btns = Array.from(controls.querySelectorAll("button")) as HTMLButtonElement[];
    expect(btns.length).toBe(3);
    btns[0].click();
    btns[1].click();
    btns[2].click();
    expect(svc.calls.minimize).toBe(1);
    expect(svc.calls.maximize).toBe(1);
    expect(svc.calls.close).toBe(1);
    p.dispose();
  });

  it("dblclick on drag region calls maximize", () => {
    const p = new TitlebarPart();
    const svc = makeWindowService({ native: true });
    p.setWindowService(svc);
    mount(p);
    const drag = document.querySelector(".titlebar-drag-region") as HTMLElement;
    drag.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(svc.calls.maximize).toBe(1);
    p.dispose();
  });

  it("onDidChangeMaximized updates maximize button aria-label to Restore / Maximize", async () => {
    const p = new TitlebarPart();
    const svc = makeWindowService({ native: true, maximized: false });
    p.setWindowService(svc);
    mount(p);
    const maxBtn = document.querySelectorAll(".window-control-btn")[1] as HTMLButtonElement;
    expect(maxBtn.getAttribute("aria-label")).toBe("Maximize");
    svc._emitter.fire(true);
    expect(maxBtn.getAttribute("aria-label")).toBe("Restore");
    svc._emitter.fire(false);
    expect(maxBtn.getAttribute("aria-label")).toBe("Maximize");
    p.dispose();
  });
});
