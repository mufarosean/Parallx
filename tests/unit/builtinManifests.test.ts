/**
 * Pin-the-invariant: tools/builtinManifests.ts — every built-in manifest passes
 * the validator, owns its declared command ids, and carries the documented
 * publisher / engines metadata.
 */
import { describe, it, expect } from "vitest";
import { validateManifest } from "../../src/tools/toolValidator";
import {
  EXPLORER_MANIFEST,
  SEARCH_MANIFEST,
  TEXT_EDITOR_MANIFEST,
  WELCOME_MANIFEST,
  OUTPUT_MANIFEST,
  INDEXING_LOG_MANIFEST,
  DIAGNOSTICS_MANIFEST,
  AUTONOMY_LOG_MANIFEST,
  TOOL_GALLERY_MANIFEST,
  CHAT_MANIFEST,
  AI_SETTINGS_MANIFEST,
  CANVAS_MANIFEST,
  THEME_EDITOR_MANIFEST,
  SETTINGS_MANIFEST,
} from "../../src/tools/builtinManifests";

const ALL = [
  ["EXPLORER", EXPLORER_MANIFEST],
  ["SEARCH", SEARCH_MANIFEST],
  ["TEXT_EDITOR", TEXT_EDITOR_MANIFEST],
  ["WELCOME", WELCOME_MANIFEST],
  ["OUTPUT", OUTPUT_MANIFEST],
  ["INDEXING_LOG", INDEXING_LOG_MANIFEST],
  ["DIAGNOSTICS", DIAGNOSTICS_MANIFEST],
  ["AUTONOMY_LOG", AUTONOMY_LOG_MANIFEST],
  ["TOOL_GALLERY", TOOL_GALLERY_MANIFEST],
  ["CHAT", CHAT_MANIFEST],
  ["AI_SETTINGS", AI_SETTINGS_MANIFEST],
  ["CANVAS", CANVAS_MANIFEST],
  ["THEME_EDITOR", THEME_EDITOR_MANIFEST],
  ["SETTINGS", SETTINGS_MANIFEST],
] as const;

describe("builtin manifests — validator-clean", () => {
  for (const [label, manifest] of ALL) {
    it(`${label} passes validateManifest with no errors`, () => {
      const r = validateManifest(manifest);
      expect(r.valid, JSON.stringify(r.errors)).toBe(true);
      expect(r.errors).toEqual([]);
    });
  }
});

describe("builtin manifests — identity invariants", () => {
  for (const [label, manifest] of ALL) {
    it(`${label} declares publisher 'parallx' and engines.parallx`, () => {
      expect(manifest.publisher).toBe("parallx");
      expect(typeof manifest.engines?.parallx).toBe("string");
    });
  }

  it("ids are unique across all built-in manifests", () => {
    const ids = ALL.map(([, m]) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("each id starts with the 'parallx.' namespace", () => {
    for (const [, m] of ALL) {
      expect(m.id.startsWith("parallx.")).toBe(true);
    }
  });
});

describe("builtin manifests — command id ownership", () => {
  it("EXPLORER contributes the documented explorer.* commands", () => {
    const ids = EXPLORER_MANIFEST.contributes!.commands!.map((c) => c.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "explorer.newFile",
        "explorer.newFolder",
        "explorer.rename",
        "explorer.delete",
        "explorer.refresh",
        "explorer.collapse",
        "explorer.revealInExplorer",
        "explorer.toggleHiddenFiles",
      ]),
    );
  });

  it("SEARCH contributes the search.* command set + Ctrl+Shift+F keybinding", () => {
    const ids = SEARCH_MANIFEST.contributes!.commands!.map((c) => c.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "search.findInFiles",
        "search.clearResults",
        "search.collapseAll",
        "search.expandAll",
      ]),
    );
    const kb = SEARCH_MANIFEST.contributes!.keybindings!;
    expect(kb).toContainEqual({ command: "search.findInFiles", key: "Ctrl+Shift+F" });
  });

  it("TEXT_EDITOR has Alt+Z keybinding for toggleWordWrap", () => {
    const kb = TEXT_EDITOR_MANIFEST.contributes!.keybindings!;
    expect(kb).toContainEqual({ command: "editor.toggleWordWrap", key: "Alt+Z" });
  });
});

describe("builtin manifests — activationEvents", () => {
  it("TEXT_EDITOR activates on every event ('*')", () => {
    expect(TEXT_EDITOR_MANIFEST.activationEvents).toContain("*");
  });
  it("EXPLORER / SEARCH activate onStartupFinished", () => {
    expect(EXPLORER_MANIFEST.activationEvents).toContain("onStartupFinished");
    expect(SEARCH_MANIFEST.activationEvents).toContain("onStartupFinished");
  });
});
