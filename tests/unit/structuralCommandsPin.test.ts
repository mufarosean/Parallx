/**
 * Pin tests for src/commands/structuralCommands.ts — built-in command catalog.
 *
 * Pins:
 *   - Exports `registerBuiltinCommands` (function) and `ALL_BUILTIN_COMMANDS` (array).
 *   - Catalog is non-empty and each entry has `id` + `title` + `handler`.
 *   - Catalog contains the documented "stability nucleus" command ids:
 *     showCommands, quickOpen, toggleSidebar, splitEditor, closeActiveEditor,
 *     workspaceSave, fileOpenFile, edit.undo, edit.copy, edit.paste,
 *     layout.reset, workbench.action.openSettings, workbench.action.openKeybindings,
 *     workbench.action.selectTheme.
 *   - All ids in the catalog are unique.
 *   - `registerBuiltinCommands` calls `commandService.registerCommands(ALL_BUILTIN_COMMANDS)`
 *     and returns its disposable.
 */
import { describe, it, expect, vi } from "vitest";
import { registerBuiltinCommands, ALL_BUILTIN_COMMANDS } from "../../src/commands/structuralCommands";

describe("commands/structuralCommands — exports + catalog shape", () => {
  it("exports `registerBuiltinCommands` (function) and `ALL_BUILTIN_COMMANDS` (array)", () => {
    expect(typeof registerBuiltinCommands).toBe("function");
    expect(Array.isArray(ALL_BUILTIN_COMMANDS)).toBe(true);
    expect(ALL_BUILTIN_COMMANDS.length).toBeGreaterThan(0);
  });

  it("every entry has `id`, `title`, and `handler`", () => {
    for (const cmd of ALL_BUILTIN_COMMANDS) {
      expect(typeof cmd.id).toBe("string");
      expect(cmd.id.length).toBeGreaterThan(0);
      expect(typeof cmd.title).toBe("string");
      expect(typeof cmd.handler).toBe("function");
    }
  });

  it("contains the documented stability-nucleus command ids", () => {
    const ids = new Set(ALL_BUILTIN_COMMANDS.map(c => c.id));
    const required = [
      "workbench.action.showCommands",
      "workbench.action.quickOpen",
      "workbench.action.toggleSidebar",
      "workbench.action.splitEditor",
      "workbench.action.closeActiveEditor",
      "workspace.save",
      "file.openFile",
      "edit.undo",
      "edit.copy",
      "edit.paste",
      "layout.reset",
      "workbench.action.openSettings",
      "workbench.action.openKeybindings",
      "workbench.action.selectTheme",
    ];
    for (const id of required) {
      expect(ids.has(id), `expected catalog to contain command id '${id}'`).toBe(true);
    }
  });

  it("command ids are unique within the catalog", () => {
    const ids = ALL_BUILTIN_COMMANDS.map(c => c.id);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(dupes).toEqual([]);
  });
});

describe("commands/structuralCommands — registerBuiltinCommands", () => {
  it("delegates to `commandService.registerCommands(ALL_BUILTIN_COMMANDS)` and returns its disposable", () => {
    const disp = { dispose: vi.fn() };
    const commandService = {
      registerCommands: vi.fn(() => disp),
    };
    const out = registerBuiltinCommands(commandService as any);
    expect(commandService.registerCommands).toHaveBeenCalledTimes(1);
    expect(commandService.registerCommands.mock.calls[0][0]).toBe(ALL_BUILTIN_COMMANDS);
    expect(out).toBe(disp);
  });
});
