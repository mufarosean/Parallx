/**
 * Pin: canvasMenuRegistry — TEXT_COLORS / BG_COLORS swatch palettes,
 * createRecentList (localStorage-backed MRU), recordRecentColor (ignores
 * null), getRecentColors (filters against the canonical palette). These
 * are the source-of-truth Notion-parity palettes the slash menu, block
 * action menu, and bubble menu all bind to.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  TEXT_COLORS,
  BG_COLORS,
  createRecentList,
  recordRecentColor,
  getRecentColors,
} from "../../src/built-in/canvas/menus/canvasMenuRegistry";

class MemoryStorage implements Storage {
  private _store = new Map<string, string>();
  get length(): number { return this._store.size; }
  clear(): void { this._store.clear(); }
  getItem(k: string): string | null { return this._store.get(k) ?? null; }
  key(i: number): string | null { return [...this._store.keys()][i] ?? null; }
  removeItem(k: string): void { this._store.delete(k); }
  setItem(k: string, v: string): void { this._store.set(k, String(v)); }
}

beforeEach(() => {
  (globalThis as any).localStorage = new MemoryStorage();
});

describe("canvasMenuRegistry — TEXT_COLORS palette", () => {
  it("contains exactly 10 swatches in canonical order (Default, Gray, Brown, Orange, Yellow, Green, Blue, Purple, Pink, Red)", () => {
    expect(TEXT_COLORS.length).toBe(10);
    expect(TEXT_COLORS.map((c) => c.label)).toEqual([
      "Default text", "Gray text", "Brown text", "Orange text", "Yellow text",
      "Green text", "Blue text", "Purple text", "Pink text", "Red text",
    ]);
  });

  it("default text swatch has value=null and a translucent white display", () => {
    expect(TEXT_COLORS[0].value).toBe(null);
    expect(TEXT_COLORS[0].display).toBe("rgba(255,255,255,0.81)");
  });

  it("non-default swatches all have value === display (saturated text colours)", () => {
    for (let i = 1; i < TEXT_COLORS.length; i++) {
      expect(TEXT_COLORS[i].value, TEXT_COLORS[i].label).toBe(TEXT_COLORS[i].display);
      expect(TEXT_COLORS[i].value, TEXT_COLORS[i].label).toMatch(/^rgb\(/);
    }
  });
});

describe("canvasMenuRegistry — BG_COLORS palette", () => {
  it("contains exactly 10 swatches with matching labels", () => {
    expect(BG_COLORS.length).toBe(10);
    expect(BG_COLORS.map((c) => c.label)).toEqual([
      "Default background", "Gray background", "Brown background", "Orange background",
      "Yellow background", "Green background", "Blue background", "Purple background",
      "Pink background", "Red background",
    ]);
  });

  it("default bg swatch has value=null + display=transparent", () => {
    expect(BG_COLORS[0].value).toBe(null);
    expect(BG_COLORS[0].display).toBe("transparent");
  });

  it("non-default bg swatches: value is 0.2 alpha, display is 0.35 alpha (Notion-parity translucency)", () => {
    for (let i = 1; i < BG_COLORS.length; i++) {
      expect(BG_COLORS[i].value, BG_COLORS[i].label).toMatch(/,0\.2\)$/);
      expect(BG_COLORS[i].display, BG_COLORS[i].label).toMatch(/,0\.35\)$/);
    }
  });
});

describe("canvasMenuRegistry — createRecentList", () => {
  it("read() returns [] for an unset key", () => {
    const list = createRecentList("k-empty", 3);
    expect(list.read()).toEqual([]);
  });

  it("read() returns [] when value is invalid JSON (silent degrade)", () => {
    localStorage.setItem("k-bad", "not-json");
    expect(createRecentList("k-bad", 3).read()).toEqual([]);
  });

  it("read() returns [] when stored value is not an array", () => {
    localStorage.setItem("k-obj", JSON.stringify({ a: 1 }));
    expect(createRecentList("k-obj", 3).read()).toEqual([]);
  });

  it("read() filters non-string entries out of a stored array", () => {
    localStorage.setItem("k-mix", JSON.stringify(["a", 1, "b", null, "c"]));
    expect(createRecentList("k-mix", 5).read()).toEqual(["a", "b", "c"]);
  });

  it("read() truncates to the max", () => {
    localStorage.setItem("k-cap", JSON.stringify(["a", "b", "c", "d"]));
    expect(createRecentList("k-cap", 2).read()).toEqual(["a", "b"]);
  });

  it("record() inserts newest-first, dedupes by moving to front, caps at max", () => {
    const list = createRecentList("k-rec", 3);
    list.record("a"); list.record("b"); list.record("c");
    expect(list.read()).toEqual(["c", "b", "a"]);
    list.record("a"); // moved to front
    expect(list.read()).toEqual(["a", "c", "b"]);
    list.record("d"); // pushes 'b' out
    expect(list.read()).toEqual(["d", "a", "c"]);
  });

  it("record() silently degrades when localStorage.setItem throws", () => {
    const failing: any = new MemoryStorage();
    failing.setItem = () => { throw new Error("QuotaExceeded"); };
    (globalThis as any).localStorage = failing;
    const list = createRecentList("k-quota", 3);
    expect(() => list.record("a")).not.toThrow();
  });
});

describe("canvasMenuRegistry — recordRecentColor / getRecentColors", () => {
  it("recordRecentColor ignores null (Default swatch is not recordable)", () => {
    recordRecentColor("text", null);
    recordRecentColor("bg", null);
    expect(getRecentColors("text")).toEqual([]);
    expect(getRecentColors("bg")).toEqual([]);
  });

  it("text and bg are tracked independently", () => {
    recordRecentColor("text", "rgb(80,185,120)"); // Green text
    recordRecentColor("bg", "rgba(80,185,120,0.2)"); // Green bg
    expect(getRecentColors("text").map((s) => s.label)).toEqual(["Green text"]);
    expect(getRecentColors("bg").map((s) => s.label)).toEqual(["Green background"]);
  });

  it("getRecentColors filters out stored values that are no longer in the canonical palette", () => {
    localStorage.setItem("parallx-canvas-recent-text-colors", JSON.stringify(["rgb(80,185,120)", "rgb(999,999,999)"]));
    const recents = getRecentColors("text");
    expect(recents.map((c) => c.label)).toEqual(["Green text"]);
  });

  it("getRecentColors caps the MRU at 3 entries (RECENT_COLOR_MAX)", () => {
    for (const c of TEXT_COLORS.slice(1, 6)) {
      recordRecentColor("text", c.value);
    }
    expect(getRecentColors("text").length).toBeLessThanOrEqual(3);
  });
});
