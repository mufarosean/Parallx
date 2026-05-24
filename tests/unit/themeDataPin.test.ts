// themeDataPin.test.ts — pin ColorThemeData.fromSource parsing + uiTheme mapping.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ColorThemeData } from "../../src/theme/themeData";
import { ThemeType } from "../../src/theme/themeTypes";

function makeColorRegistry(known: string[]) {
  const set = new Set(known);
  return {
    getRegisteredColor: (id: string) => (set.has(id) ? { id, description: "", defaults: {} } : undefined),
  } as any;
}

function makeTokenRegistry(known: string[]) {
  const set = new Set(known);
  return {
    getRegisteredToken: (id: string) => (set.has(id) ? { id } : undefined),
  } as any;
}

describe("ColorThemeData.fromSource — uiTheme → ThemeType", () => {
  const registry = makeColorRegistry([]);
  it("maps vs-dark to DARK", () => {
    const t = ColorThemeData.fromSource({ id: "a", label: "A", uiTheme: "vs-dark", colors: {} }, registry);
    expect(t.type).toBe(ThemeType.DARK);
  });
  it("maps vs to LIGHT", () => {
    const t = ColorThemeData.fromSource({ id: "a", label: "A", uiTheme: "vs", colors: {} }, registry);
    expect(t.type).toBe(ThemeType.LIGHT);
  });
  it("maps hc-black to HIGH_CONTRAST_DARK", () => {
    const t = ColorThemeData.fromSource({ id: "a", label: "A", uiTheme: "hc-black", colors: {} }, registry);
    expect(t.type).toBe(ThemeType.HIGH_CONTRAST_DARK);
  });
  it("maps hc-light to HIGH_CONTRAST_LIGHT", () => {
    const t = ColorThemeData.fromSource({ id: "a", label: "A", uiTheme: "hc-light", colors: {} }, registry);
    expect(t.type).toBe(ThemeType.HIGH_CONTRAST_LIGHT);
  });
  it("falls back to DARK for unknown uiTheme", () => {
    const t = ColorThemeData.fromSource({ id: "a", label: "A", uiTheme: "bogus" as any, colors: {} }, registry);
    expect(t.type).toBe(ThemeType.DARK);
  });
});

describe("ColorThemeData.fromSource — color filtering", () => {
  let warn: any;
  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
  });

  it("retains registered colors", () => {
    const registry = makeColorRegistry(["foreground", "background"]);
    const t = ColorThemeData.fromSource(
      { id: "x", label: "X", uiTheme: "vs-dark", colors: { foreground: "#fff", background: "#000" } },
      registry,
    );
    expect(t.getColor("foreground")).toBe("#fff");
    expect(t.getColor("background")).toBe("#000");
  });

  it("drops unknown color keys and warns", () => {
    const registry = makeColorRegistry(["foreground"]);
    const t = ColorThemeData.fromSource(
      { id: "x", label: "X", uiTheme: "vs-dark", colors: { foreground: "#fff", mystery: "#abc" } },
      registry,
    );
    expect(t.getColor("foreground")).toBe("#fff");
    expect(t.getColor("mystery")).toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  it("getColor returns undefined for missing key", () => {
    const t = ColorThemeData.fromSource(
      { id: "x", label: "X", uiTheme: "vs-dark", colors: {} },
      makeColorRegistry([]),
    );
    expect(t.getColor("nope")).toBeUndefined();
  });

  it("preserves id and label from source", () => {
    const t = ColorThemeData.fromSource(
      { id: "the-id", label: "The Label", uiTheme: "vs-dark", colors: {} },
      makeColorRegistry([]),
    );
    expect(t.id).toBe("the-id");
    expect(t.label).toBe("The Label");
  });
});

describe("ColorThemeData.fromSource — design tokens", () => {
  let warn: any;
  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
  });

  it("ignores designTokens when no token registry passed", () => {
    const t = ColorThemeData.fromSource(
      { id: "x", label: "X", uiTheme: "vs-dark", colors: {}, designTokens: { "font.size": "13px" } },
      makeColorRegistry([]),
    );
    expect(t.getDesignToken("font.size")).toBeUndefined();
  });

  it("retains registered design tokens when registry provided", () => {
    const t = ColorThemeData.fromSource(
      { id: "x", label: "X", uiTheme: "vs-dark", colors: {}, designTokens: { "font.size": "13px" } },
      makeColorRegistry([]),
      makeTokenRegistry(["font.size"]),
    );
    expect(t.getDesignToken("font.size")).toBe("13px");
  });

  it("drops unknown design tokens and warns", () => {
    const t = ColorThemeData.fromSource(
      { id: "x", label: "X", uiTheme: "vs-dark", colors: {}, designTokens: { "font.size": "13px", bogus: "1" } },
      makeColorRegistry([]),
      makeTokenRegistry(["font.size"]),
    );
    expect(t.getDesignToken("font.size")).toBe("13px");
    expect(t.getDesignToken("bogus")).toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  it("no designTokens field → getDesignToken returns undefined", () => {
    const t = ColorThemeData.fromSource(
      { id: "x", label: "X", uiTheme: "vs-dark", colors: {} },
      makeColorRegistry([]),
      makeTokenRegistry(["font.size"]),
    );
    expect(t.getDesignToken("font.size")).toBeUndefined();
  });
});
