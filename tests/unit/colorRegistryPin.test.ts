/**
 * Pin: ColorRegistry — registerColor (id uniqueness), getRegisteredColor,
 * getRegisteredColors, resolveDefault per ThemeType, asCssVariableName,
 * size. Built-in singleton sanity: a known registered token resolves.
 */
import { describe, it, expect } from "vitest";
import { ColorRegistry, ThemeType, colorRegistry } from "../../src/theme/colorRegistry";

const defs = (overrides: any = {}) => ({
  dark: "#000",
  light: "#fff",
  hcDark: "#111",
  hcLight: "#eee",
  ...overrides,
});

describe("theme/colorRegistry/ColorRegistry", () => {
  it("registerColor stores id+description+defaults and increments size", () => {
    const reg = new ColorRegistry();
    expect(reg.size).toBe(0);
    const r = reg.registerColor("foo.bar", "Foo bar color", defs({ dark: "#abc" }));
    expect(r.id).toBe("foo.bar");
    expect(r.description).toBe("Foo bar color");
    expect(r.defaults.dark).toBe("#abc");
    expect(reg.size).toBe(1);
  });

  it("registerColor throws on duplicate id", () => {
    const reg = new ColorRegistry();
    reg.registerColor("x", "X", defs());
    expect(() => reg.registerColor("x", "X again", defs())).toThrow(/already registered/);
  });

  it("getRegisteredColor returns the registration or undefined", () => {
    const reg = new ColorRegistry();
    reg.registerColor("x", "X", defs());
    expect(reg.getRegisteredColor("x")?.id).toBe("x");
    expect(reg.getRegisteredColor("missing")).toBeUndefined();
  });

  it("getRegisteredColors returns insertion-ordered snapshot (NOT live)", () => {
    const reg = new ColorRegistry();
    reg.registerColor("a", "A", defs());
    reg.registerColor("b", "B", defs());
    const snap = reg.getRegisteredColors();
    expect(snap.map(r => r.id)).toEqual(["a", "b"]);
    // snapshot doesn't reflect later registrations
    reg.registerColor("c", "C", defs());
    expect(snap.map(r => r.id)).toEqual(["a", "b"]);
  });

  it("resolveDefault returns the per-theme value", () => {
    const reg = new ColorRegistry();
    reg.registerColor("x", "X", defs({ dark: "D", light: "L", hcDark: "HD", hcLight: "HL" }));
    expect(reg.resolveDefault("x", ThemeType.DARK)).toBe("D");
    expect(reg.resolveDefault("x", ThemeType.LIGHT)).toBe("L");
    expect(reg.resolveDefault("x", ThemeType.HIGH_CONTRAST_DARK)).toBe("HD");
    expect(reg.resolveDefault("x", ThemeType.HIGH_CONTRAST_LIGHT)).toBe("HL");
  });

  it("resolveDefault returns undefined for unknown id", () => {
    const reg = new ColorRegistry();
    expect(reg.resolveDefault("nope", ThemeType.DARK)).toBeUndefined();
  });

  it("asCssVariableName replaces dots with hyphens and prefixes --vscode-", () => {
    const reg = new ColorRegistry();
    expect(reg.asCssVariableName("editor.background")).toBe("--vscode-editor-background");
    expect(reg.asCssVariableName("list.activeSelection.foreground")).toBe("--vscode-list-activeSelection-foreground");
    expect(reg.asCssVariableName("foo")).toBe("--vscode-foo");
  });

  it("global colorRegistry singleton has 'widget.border' registered with documented dark/light defaults", () => {
    const r = colorRegistry.getRegisteredColor("widget.border");
    expect(r).toBeDefined();
    expect(r!.defaults.dark).toBe("rgba(255, 255, 255, 0.08)");
    expect(r!.defaults.light).toBe("rgba(0, 0, 0, 0.1)");
    expect(colorRegistry.size).toBeGreaterThan(0);
  });
});
