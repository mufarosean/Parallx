/**
 * Pin tests for src/theme/workbenchColors.ts — side-effect token registration.
 *
 * Pins:
 *   - Importing the module registers a documented set of workbench color tokens
 *     into the shared colorRegistry singleton.
 *   - Each registered token resolves to a string default for every ThemeType
 *     (Dark, Light, HighContrastDark, HighContrastLight).
 *   - The registry size grows after the import (i.e. tokens are actually added).
 */
import { describe, it, expect } from "vitest";
import { colorRegistry } from "../../src/theme/colorRegistry";
import { ThemeType } from "../../src/theme/themeTypes";

// Trigger registration (must be a static import so it runs once at module load).
import "../../src/theme/workbenchColors";

const afterSize = colorRegistry.size;

const REQUIRED = [
  // Core
  "foreground",
  "focusBorder",
  "errorForeground",
  // Titlebar
  "titleBar.activeBackground",
  "titleBar.activeForeground",
  // Menu
  "menu.background",
  "menu.selectionBackground",
  // Activity bar / sidebar
  "activityBar.background",
  "sideBar.background",
  // Editor / tabs
  "editor.background",
  "editor.foreground",
  "tab.activeBackground",
  "tab.inactiveBackground",
  // Breadcrumbs
  "breadcrumb.background",
];

describe("theme/workbenchColors — side-effect registration", () => {
  it("imports adds the documented workbench tokens to the registry", () => {
    expect(afterSize).toBeGreaterThan(REQUIRED.length);
    for (const id of REQUIRED) {
      const reg = colorRegistry.getRegisteredColor(id);
      expect(reg, `expected colorRegistry to have token '${id}'`).toBeTruthy();
    }
  });

  it("every required token resolves to a string default for all four theme types", () => {
    for (const id of REQUIRED) {
      for (const t of [ThemeType.DARK, ThemeType.LIGHT, ThemeType.HIGH_CONTRAST_DARK, ThemeType.HIGH_CONTRAST_LIGHT]) {
        const v = colorRegistry.resolveDefault(id, t);
        expect(typeof v, `default for ${id} / theme ${t}`).toBe("string");
        expect((v as string).length).toBeGreaterThan(0);
      }
    }
  });

  it("asCssVariableName converts dotted token id to --vscode-<id-with-hyphens>", () => {
    expect(colorRegistry.asCssVariableName("editor.background")).toBe("--vscode-editor-background");
    expect(colorRegistry.asCssVariableName("tab.activeBorderTop")).toBe("--vscode-tab-activeBorderTop");
  });
});
