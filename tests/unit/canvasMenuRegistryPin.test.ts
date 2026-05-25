/**
 * Pin: canvasMenuRegistry — TEXT_COLORS / BG_COLORS swatch palettes,
 * createRecentList (M86-W7 uiCache-backed MRU), recordRecentColor
 * (ignores null), getRecentColors (filters against the canonical
 * palette). These are the source-of-truth Notion-parity palettes the
 * slash menu, block action menu, and bubble menu all bind to.
 *
 * Storage backing was migrated from localStorage to the M86-W7 sync UI
 * cache so the recents survive across renderer crashes and replicate
 * through global-storage.json instead of vanishing with the renderer
 * profile. Tests stub a tiny IStorage and warm the uiCache before each
 * case so the createRecentList helper sees a populated cache.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  TEXT_COLORS,
  BG_COLORS,
  createRecentList,
  recordRecentColor,
  getRecentColors,
} from "../../src/built-in/canvas/menus/canvasMenuRegistry";
import { initUiCache, _resetUiCacheForTests } from "../../src/platform/uiCache";
import type { IStorage } from "../../src/platform/storage";

class FakeStorage implements IStorage {
  store = new Map<string, string>();
  failSet = false;
  async get(k: string): Promise<string | undefined> { return this.store.get(k); }
  async set(k: string, v: string): Promise<void> {
    if (this.failSet) throw new Error("QuotaExceeded");
    this.store.set(k, v);
  }
  async delete(k: string): Promise<void> { this.store.delete(k); }
  async has(k: string): Promise<boolean> { return this.store.has(k); }
  async keys(prefix?: string): Promise<string[]> {
    const all = [...this.store.keys()];
    return prefix ? all.filter(k => k.startsWith(prefix)) : all;
  }
  async clear(): Promise<void> { this.store.clear(); }
}

let backing: FakeStorage;

async function _seed(key: string, value: unknown): Promise<void> {
  backing.store.set(`ui-cache:${key}`, JSON.stringify(value));
  _resetUiCacheForTests();
  await initUiCache(backing);
}

beforeEach(async () => {
  _resetUiCacheForTests();
  backing = new FakeStorage();
  await initUiCache(backing);
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

  it("read() returns [] when stored value is not an array", async () => {
    await _seed("k-obj", { a: 1 });
    expect(createRecentList("k-obj", 3).read()).toEqual([]);
  });

  it("read() filters non-string entries out of a stored array", async () => {
    await _seed("k-mix", ["a", 1, "b", null, "c"]);
    expect(createRecentList("k-mix", 5).read()).toEqual(["a", "b", "c"]);
  });

  it("read() truncates to the max", async () => {
    await _seed("k-cap", ["a", "b", "c", "d"]);
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

  it("record() silently degrades when the backing storage rejects writes", () => {
    backing.failSet = true;
    const list = createRecentList("k-quota", 3);
    // Cache update is synchronous; the write-through rejection is
    // swallowed by SyncCachedStorage's write queue.
    expect(() => list.record("a")).not.toThrow();
    expect(list.read()).toEqual(["a"]);
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

  it("getRecentColors filters out stored values that are no longer in the canonical palette", async () => {
    await _seed("parallx-canvas-recent-text-colors", ["rgb(80,185,120)", "rgb(999,999,999)"]);
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
