/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from "vitest";
import { FocusTracker } from "../../src/context/focusTracker.js";

interface FakeCK {
  ctx: Record<string, unknown>;
  setContext(key: string, value: unknown): void;
}
function fakeCK(): FakeCK {
  return {
    ctx: {},
    setContext(k, v) { this.ctx[k] = v; },
  };
}

function mount() {
  document.body.innerHTML = "";
  const root = document.createElement("div");
  document.body.appendChild(root);
  const partA = document.createElement("section");
  partA.setAttribute("data-part-id", "A");
  const viewA1 = document.createElement("div");
  viewA1.setAttribute("data-view-id", "A1");
  const btnA = document.createElement("button");
  btnA.textContent = "a-btn";
  viewA1.appendChild(btnA);
  partA.appendChild(viewA1);

  const partB = document.createElement("section");
  partB.setAttribute("data-part-id", "B");
  const inputB = document.createElement("input");
  partB.appendChild(inputB);

  root.append(partA, partB);
  return { root, partA, partB, viewA1, btnA, inputB };
}

describe("FocusTracker pin", () => {
  let ck: FakeCK;
  beforeEach(() => { ck = fakeCK(); });

  it("focusin within a part sets focusedPartId and updates context keys", () => {
    const { root, btnA } = mount();
    const ft = new FocusTracker(root, ck as never);
    btnA.focus();
    expect(ft.focusedPartId).toBe("A");
    expect(ft.focusedViewId).toBe("A1");
    expect(ck.ctx.focusedPart).toBe("A");
    expect(ck.ctx.focusedView).toBe("A1");
    ft.dispose();
  });

  it("moving focus between parts updates last vs current", () => {
    const { root, btnA, inputB } = mount();
    const ft = new FocusTracker(root, ck as never);
    btnA.focus();
    inputB.focus();
    expect(ft.focusedPartId).toBe("B");
    expect(ft.lastFocusedPartId).toBe("A");
    expect(ft.focusedViewId).toBeUndefined();
    expect(ft.lastFocusedViewId).toBe("A1");
    ft.dispose();
  });

  it("onDidChangeFocus fires on transitions; not on no-op same-target focus", () => {
    const { root, btnA } = mount();
    const ft = new FocusTracker(root, ck as never);
    let n = 0;
    ft.onDidChangeFocus(() => { n++; });
    btnA.focus();
    expect(n).toBe(1);
    btnA.focus();
    expect(n).toBe(1);
    ft.dispose();
  });

  it("onDidFocusPart / onDidFocusView fire only when their id changes", () => {
    const { root, btnA, inputB } = mount();
    const ft = new FocusTracker(root, ck as never);
    const parts: string[] = [];
    const views: string[] = [];
    ft.onDidFocusPart((id) => parts.push(id));
    ft.onDidFocusView((id) => views.push(id));
    btnA.focus();
    inputB.focus();
    expect(parts).toEqual(["A", "B"]);
    expect(views).toEqual(["A1"]);
    ft.dispose();
  });

  it("focusPart() restores focus to a focusable inside the part", () => {
    const { root, partA } = mount();
    const ft = new FocusTracker(root, ck as never);
    ft.focusPart("A");
    // Should focus button inside partA
    expect(partA.contains(document.activeElement)).toBe(true);
    ft.dispose();
  });

  it("focusPart() with no match is a no-op", () => {
    const { root } = mount();
    const ft = new FocusTracker(root, ck as never);
    expect(() => ft.focusPart("Z")).not.toThrow();
    ft.dispose();
  });

  it("focusView() focuses a focusable inside the view", () => {
    const { root, viewA1 } = mount();
    const ft = new FocusTracker(root, ck as never);
    ft.focusView("A1");
    expect(viewA1.contains(document.activeElement)).toBe(true);
    ft.dispose();
  });

  it("suspend() stops tracking; resume() re-enables and restores focus", () => {
    const { root, btnA, inputB } = mount();
    const ft = new FocusTracker(root, ck as never);
    btnA.focus();
    ft.suspend();
    inputB.focus();
    // While suspended, focusedPartId should NOT have changed
    expect(ft.focusedPartId).toBe("A");
    ft.resume(true);
    // restoreFocus brings focus back to last focused element (btnA still in DOM)
    expect(document.activeElement).toBe(btnA);
    ft.dispose();
  });

  it("restoreFocus() falls back through history when last element is gone", () => {
    const { root, btnA, inputB } = mount();
    const ft = new FocusTracker(root, ck as never);
    btnA.focus();
    inputB.focus();
    // remove inputB and try to restore
    inputB.remove();
    ft.restoreFocus();
    expect(document.activeElement).toBe(btnA);
    ft.dispose();
  });

  it("dispose() removes focusin listeners (no state change after disposal)", () => {
    const { root, btnA, inputB } = mount();
    const ft = new FocusTracker(root, ck as never);
    btnA.focus();
    ft.dispose();
    inputB.focus();
    expect(ft.focusedPartId).toBe("A");
  });

  it("tolerates missing context key service", () => {
    const { root, btnA } = mount();
    const ft = new FocusTracker(root, undefined);
    expect(() => btnA.focus()).not.toThrow();
    expect(ft.focusedPartId).toBe("A");
    ft.dispose();
  });
});
