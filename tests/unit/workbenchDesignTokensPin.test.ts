/**
 * Pin tests for src/theme/workbenchDesignTokens.ts — side-effect token registration.
 *
 * Pins:
 *   - Importing the module registers the documented categories of tokens
 *     (fontFamily, fontSize, radius, spacing, shadow, icon.size) into
 *     `designTokenRegistry`.
 *   - Each required token has a non-empty value in every theme type.
 *   - Token CSS variable names follow the documented `--vscode-<id-with-dots-as-hyphens>` form.
 */
import { describe, it, expect } from "vitest";
import { designTokenRegistry } from "../../src/theme/designTokenRegistry";
import { ThemeType } from "../../src/theme/themeTypes";
import "../../src/theme/workbenchDesignTokens";

const REQUIRED: ReadonlyArray<string> = [
  // Font families
  "fontFamily.ui", "fontFamily.editor", "fontFamily.mono",
  // Font sizes
  "fontSize.xs", "fontSize.sm", "fontSize.base", "fontSize.md",
  "fontSize.lg", "fontSize.xl", "fontSize.2xl", "fontSize.3xl",
  // Radius
  "radius.none", "radius.sm", "radius.md", "radius.lg", "radius.xl", "radius.full",
  // Spacing
  "spacing.1", "spacing.2", "spacing.3", "spacing.4",
  "spacing.6", "spacing.8", "spacing.12", "spacing.16",
  // Shadows
  "shadow.sm", "shadow.md", "shadow.lg",
  // Icon sizes
  "icon.size.xs", "icon.size.sm", "icon.size.md", "icon.size.lg", "icon.size.xl",
];

describe("theme/workbenchDesignTokens — side-effect registration", () => {
  it("registers all documented tokens", () => {
    const size = designTokenRegistry.getRegisteredTokens().length;
    expect(size).toBeGreaterThanOrEqual(REQUIRED.length);
    for (const id of REQUIRED) {
      const reg = designTokenRegistry.getRegisteredToken(id);
      expect(reg, `token ${id} missing`).toBeTruthy();
    }
  });

  it("every required token resolves to a non-empty value in every theme type", () => {
    for (const id of REQUIRED) {
      for (const type of [ThemeType.DARK, ThemeType.LIGHT, ThemeType.HIGH_CONTRAST_DARK, ThemeType.HIGH_CONTRAST_LIGHT]) {
        const v = designTokenRegistry.resolveDefault(id, type);
        expect(typeof v, `${id} in ${type}`).toBe("string");
        expect((v as string).length, `${id} in ${type}`).toBeGreaterThan(0);
      }
    }
  });

  it("CSS variable names follow --parallx-<id-with-dots-as-hyphens>", () => {
    expect(designTokenRegistry.asCssVariableName("fontSize.base")).toBe("--parallx-fontSize-base");
    expect(designTokenRegistry.asCssVariableName("icon.size.md")).toBe("--parallx-icon-size-md");
    expect(designTokenRegistry.asCssVariableName("radius.full")).toBe("--parallx-radius-full");
  });
});
