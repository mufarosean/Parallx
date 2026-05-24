/**
 * Pin-the-invariant: commands/structuralCommands.ts aggregator.
 *
 * registerBuiltinCommands delegates to commandService.registerCommands with the
 * canonical ALL_BUILTIN_COMMANDS list — ids must be unique and every entry
 * must implement the CommandDescriptor shape.
 */
import { describe, it, expect, vi } from "vitest";
import {
  ALL_BUILTIN_COMMANDS,
  registerBuiltinCommands,
} from "../../src/commands/structuralCommands";

describe("structuralCommands aggregator", () => {
  it("exposes a non-empty list of CommandDescriptor entries", () => {
    expect(Array.isArray(ALL_BUILTIN_COMMANDS)).toBe(true);
    expect(ALL_BUILTIN_COMMANDS.length).toBeGreaterThan(20);
    for (const c of ALL_BUILTIN_COMMANDS) {
      expect(typeof c.id).toBe("string");
      expect(typeof c.title).toBe("string");
      expect(typeof c.handler).toBe("function");
    }
  });

  it("every command id is unique", () => {
    const ids = ALL_BUILTIN_COMMANDS.map((c) => c.id);
    const set = new Set(ids);
    expect(set.size).toBe(ids.length);
  });

  it("includes the canonical view + file + workspace commands", () => {
    const ids = new Set(ALL_BUILTIN_COMMANDS.map((c) => c.id));
    for (const expected of [
      "workbench.action.showCommands",
      "workbench.action.quickOpen",
      "workbench.action.toggleSidebar",
      "workbench.action.togglePanel",
      "workbench.action.toggleZenMode",
      "file.openFile",
      "file.save",
      "file.saveAs",
      "file.saveAll",
      "workspace.save",
      "workspace.switch",
      "workspace.closeFolder",
      "workspace.closeWindow",
      "layout.reset",
      "edit.undo",
      "edit.redo",
      "edit.cut",
      "edit.copy",
      "edit.paste",
      "edit.find",
      "edit.replace",
    ]) {
      expect(ids.has(expected)).toBe(true);
    }
  });

  it("registerBuiltinCommands forwards ALL_BUILTIN_COMMANDS to commandService.registerCommands", () => {
    const disposable = { dispose: vi.fn() };
    const registerCommands = vi.fn().mockReturnValue(disposable);
    const cs: any = { registerCommands };
    const result = registerBuiltinCommands(cs);
    expect(registerCommands).toHaveBeenCalledOnce();
    expect(registerCommands.mock.calls[0][0]).toBe(ALL_BUILTIN_COMMANDS);
    expect(result).toBe(disposable);
  });

  it("Edit keybindings: Ctrl+Z/Ctrl+Shift+Z/Ctrl+X/Ctrl+C/Ctrl+V/Ctrl+F/Ctrl+H", () => {
    const byId = new Map(ALL_BUILTIN_COMMANDS.map((c) => [c.id, c]));
    expect(byId.get("edit.undo")?.keybinding).toBe("Ctrl+Z");
    expect(byId.get("edit.redo")?.keybinding).toBe("Ctrl+Shift+Z");
    expect(byId.get("edit.cut")?.keybinding).toBe("Ctrl+X");
    expect(byId.get("edit.copy")?.keybinding).toBe("Ctrl+C");
    expect(byId.get("edit.paste")?.keybinding).toBe("Ctrl+V");
    expect(byId.get("edit.find")?.keybinding).toBe("Ctrl+F");
    expect(byId.get("edit.replace")?.keybinding).toBe("Ctrl+H");
  });

  it("Preferences: openKeybindings is Ctrl+K Ctrl+S, selectColorTheme is Ctrl+T", () => {
    const byId = new Map(ALL_BUILTIN_COMMANDS.map((c) => [c.id, c]));
    expect(byId.get("workbench.action.openKeybindings")?.keybinding).toBe("Ctrl+K Ctrl+S");
    expect(byId.get("workbench.action.selectTheme")?.keybinding).toBe("Ctrl+T");
  });
});
