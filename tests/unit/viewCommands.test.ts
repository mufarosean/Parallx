/**
 * Pin-the-invariant: commands/viewCommands.ts toggle/show commands delegate
 * straight to the workbench, with the documented keybindings.
 */
import { describe, it, expect, vi } from "vitest";
import {
  showCommands,
  quickOpen,
  gotoLine,
  toggleSidebar,
  togglePanel,
  toggleMaximizedPanel,
  toggleAuxiliaryBar,
  toggleStatusBar,
  toggleZenMode,
} from "../../src/commands/viewCommands";

function ctxFor(wb: any) {
  return { workbench: wb, getService: () => undefined } as any;
}

describe("viewCommands — workbench delegations", () => {
  const cases: ReadonlyArray<{ cmd: any; method: string; keybinding?: string }> = [
    { cmd: showCommands, method: "toggleCommandPalette", keybinding: "Ctrl+Shift+P" },
    { cmd: quickOpen, method: "showQuickOpen", keybinding: "Ctrl+P" },
    { cmd: gotoLine, method: "showGoToLine", keybinding: "Ctrl+G" },
    { cmd: toggleSidebar, method: "toggleSidebar", keybinding: "Ctrl+B" },
    { cmd: togglePanel, method: "togglePanel", keybinding: "Ctrl+J" },
    { cmd: toggleMaximizedPanel, method: "toggleMaximizedPanel" },
    { cmd: toggleAuxiliaryBar, method: "toggleAuxiliaryBar" },
    { cmd: toggleStatusBar, method: "toggleStatusBar" },
    { cmd: toggleZenMode, method: "toggleZenMode", keybinding: "Ctrl+K Z" },
  ];

  for (const { cmd, method, keybinding } of cases) {
    it(`${cmd.id} → workbench.${method}()`, () => {
      const fn = vi.fn();
      const wb = { [method]: fn };
      cmd.handler(ctxFor(wb));
      expect(fn).toHaveBeenCalledOnce();
    });

    if (keybinding) {
      it(`${cmd.id} keybinding is "${keybinding}"`, () => {
        expect(cmd.keybinding).toBe(keybinding);
      });
    }
  }
});
