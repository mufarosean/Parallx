/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach } from "vitest";

async function freshModule() {
  const m = await import("../../src/theme/themeCatalog");
  return m;
}

beforeEach(() => {
  // module-level _userThemesCache persists; reset it via updateUserThemesCache([])
});

describe("themeCatalog — constants", () => {
  it("DEFAULT_THEME_ID, USER_THEMES_KEY, THEME_STORAGE_KEY are stable identifiers", async () => {
    const m = await freshModule();
    expect(m.DEFAULT_THEME_ID).toBe("parallx-dark-modern");
    expect(m.USER_THEMES_KEY).toBe("parallx.userThemes");
    expect(m.THEME_STORAGE_KEY).toBe("parallx.colorTheme");
  });
});

describe("themeCatalog — built-ins", () => {
  it("getAvailableThemes always includes the four built-ins by id", async () => {
    const m = await freshModule();
    m.updateUserThemesCache([]); // ensure empty user cache
    const ids = m.getAvailableThemes().map((t) => t.id);
    expect(ids).toContain("parallx-dark-modern");
    expect(ids).toContain("parallx-light-modern");
    expect(ids.length).toBeGreaterThanOrEqual(4);
  });

  it("findThemeById finds a built-in", async () => {
    const m = await freshModule();
    const found = m.findThemeById("parallx-dark-modern");
    expect(found?.id).toBe("parallx-dark-modern");
  });

  it("findThemeById returns undefined for unknown id", async () => {
    const m = await freshModule();
    expect(m.findThemeById("nope")).toBeUndefined();
  });
});

describe("themeCatalog — user themes cache", () => {
  it("updateUserThemesCache filters out malformed entries", async () => {
    const m = await freshModule();
    m.updateUserThemesCache([
      { id: "good", label: "Good", uiTheme: "vs-dark", colors: {} } as any,
      { id: "noLabel", colors: {} } as any, // missing label → filtered
      null as any,
      { id: "badColors", label: "x", colors: "not-an-object" } as any,
    ]);
    const sources = m.getUserThemeSources();
    expect(sources.map((s) => s.id)).toEqual(["good"]);
  });

  it("getAvailableThemes returns user themes after built-ins", async () => {
    const m = await freshModule();
    m.updateUserThemesCache([
      { id: "u1", label: "U1", uiTheme: "vs-dark", colors: {} } as any,
    ]);
    const all = m.getAvailableThemes();
    expect(all[all.length - 1].id).toBe("u1");
  });

  it("initUserThemesCache parses array JSON from storage", async () => {
    const m = await freshModule();
    const fakeStorage = {
      get: async (k: string) =>
        k === m.USER_THEMES_KEY
          ? JSON.stringify([{ id: "fromDisk", label: "D", uiTheme: "vs-dark", colors: {} }])
          : null,
    } as any;
    await m.initUserThemesCache(fakeStorage);
    expect(m.findThemeById("fromDisk")?.label).toBe("D");
  });

  it("initUserThemesCache yields empty cache when storage has no value", async () => {
    const m = await freshModule();
    const fakeStorage = { get: async () => null } as any;
    await m.initUserThemesCache(fakeStorage);
    expect(m.getUserThemeSources()).toEqual([]);
  });

  it("initUserThemesCache yields empty cache when JSON is malformed", async () => {
    const m = await freshModule();
    const fakeStorage = { get: async () => "{not json" } as any;
    await m.initUserThemesCache(fakeStorage);
    expect(m.getUserThemeSources()).toEqual([]);
  });

  it("initUserThemesCache yields empty cache when JSON is not an array", async () => {
    const m = await freshModule();
    const fakeStorage = { get: async () => JSON.stringify({ not: "array" }) } as any;
    await m.initUserThemesCache(fakeStorage);
    expect(m.getUserThemeSources()).toEqual([]);
  });
});
