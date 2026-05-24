import { describe, it, expect } from "vitest";
import { ColorRegistry, ThemeType } from "../../src/theme/colorRegistry";

describe("ColorRegistry", () => {
  it("registerColor adds a registration and getRegisteredColor returns it", () => {
    const r = new ColorRegistry();
    const reg = r.registerColor("foo.bar", "desc", {
      dark: "#000", light: "#fff", hcDark: "#111", hcLight: "#eee",
    });
    expect(reg.id).toBe("foo.bar");
    expect(reg.description).toBe("desc");
    expect(r.getRegisteredColor("foo.bar")).toBe(reg);
    expect(r.size).toBe(1);
  });

  it("registerColor throws on duplicate id", () => {
    const r = new ColorRegistry();
    r.registerColor("x", "d", { dark: "a", light: "b", hcDark: "c", hcLight: "d" });
    expect(() =>
      r.registerColor("x", "d2", { dark: "a", light: "b", hcDark: "c", hcLight: "d" }),
    ).toThrow(/already registered/);
  });

  it("getRegisteredColors returns a snapshot array", () => {
    const r = new ColorRegistry();
    r.registerColor("a", "", { dark: "1", light: "2", hcDark: "3", hcLight: "4" });
    r.registerColor("b", "", { dark: "1", light: "2", hcDark: "3", hcLight: "4" });
    expect(r.getRegisteredColors().map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("getRegisteredColor returns undefined for unknown id", () => {
    expect(new ColorRegistry().getRegisteredColor("nope")).toBeUndefined();
  });

  it("resolveDefault returns the right value for each theme type", () => {
    const r = new ColorRegistry();
    r.registerColor("k", "", { dark: "D", light: "L", hcDark: "HD", hcLight: "HL" });
    expect(r.resolveDefault("k", ThemeType.DARK)).toBe("D");
    expect(r.resolveDefault("k", ThemeType.LIGHT)).toBe("L");
    expect(r.resolveDefault("k", ThemeType.HIGH_CONTRAST_DARK)).toBe("HD");
    expect(r.resolveDefault("k", ThemeType.HIGH_CONTRAST_LIGHT)).toBe("HL");
  });

  it("resolveDefault returns undefined for unknown id", () => {
    const r = new ColorRegistry();
    expect(r.resolveDefault("missing", ThemeType.DARK)).toBeUndefined();
  });

  it("asCssVariableName replaces dots with hyphens and prefixes --vscode-", () => {
    const r = new ColorRegistry();
    expect(r.asCssVariableName("editor.background")).toBe("--vscode-editor-background");
    expect(r.asCssVariableName("a.b.c")).toBe("--vscode-a-b-c");
    expect(r.asCssVariableName("plain")).toBe("--vscode-plain");
  });

  it("size reflects number of registrations", () => {
    const r = new ColorRegistry();
    expect(r.size).toBe(0);
    r.registerColor("a", "", { dark: "1", light: "2", hcDark: "3", hcLight: "4" });
    r.registerColor("b", "", { dark: "1", light: "2", hcDark: "3", hcLight: "4" });
    expect(r.size).toBe(2);
  });
});
