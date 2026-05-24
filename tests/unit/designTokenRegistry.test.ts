import { describe, it, expect } from "vitest";
import { DesignTokenRegistry } from "../../src/theme/designTokenRegistry";
import { ThemeType } from "../../src/theme/themeTypes";

describe("DesignTokenRegistry", () => {
  it("registerToken stores a registration and rejects duplicates", () => {
    const r = new DesignTokenRegistry();
    const reg = r.registerToken("fontFamily.ui", "desc", { dark: "Arial", light: "Arial", hcDark: "Arial", hcLight: "Arial" });
    expect(reg.id).toBe("fontFamily.ui");
    expect(r.getRegisteredToken("fontFamily.ui")).toBe(reg);
    expect(() => r.registerToken("fontFamily.ui", "x", reg.defaults)).toThrow(/already registered/);
  });

  it("resolveDefault returns the per-theme value and undefined for unknown ids", () => {
    const r = new DesignTokenRegistry();
    r.registerToken("k", "", { dark: "D", light: "L", hcDark: "HD", hcLight: "HL" });
    expect(r.resolveDefault("k", ThemeType.DARK)).toBe("D");
    expect(r.resolveDefault("k", ThemeType.LIGHT)).toBe("L");
    expect(r.resolveDefault("k", ThemeType.HIGH_CONTRAST_DARK)).toBe("HD");
    expect(r.resolveDefault("k", ThemeType.HIGH_CONTRAST_LIGHT)).toBe("HL");
    expect(r.resolveDefault("nope", ThemeType.DARK)).toBeUndefined();
  });

  it("asCssVariableName uses the --parallx- prefix and converts dots to hyphens", () => {
    const r = new DesignTokenRegistry();
    expect(r.asCssVariableName("fontFamily.ui")).toBe("--parallx-fontFamily-ui");
    expect(r.asCssVariableName("a.b.c")).toBe("--parallx-a-b-c");
    expect(r.asCssVariableName("plain")).toBe("--parallx-plain");
  });

  it("size and getRegisteredTokens reflect registrations", () => {
    const r = new DesignTokenRegistry();
    expect(r.size).toBe(0);
    r.registerToken("a", "", { dark: "1", light: "1", hcDark: "1", hcLight: "1" });
    r.registerToken("b", "", { dark: "1", light: "1", hcDark: "1", hcLight: "1" });
    expect(r.size).toBe(2);
    expect(r.getRegisteredTokens().map((t) => t.id)).toEqual(["a", "b"]);
  });
});
