/**
 * Pin-the-invariant: commands/focusCommands.ts cycling + show-if-hidden logic.
 *   - F6 cycles forward through Editor → Panel → AuxiliaryBar → StatusBar →
 *     ActivityBar → Sidebar → Editor; Shift+F6 cycles backward.
 *   - Hidden parts are skipped (Editor is always considered visible).
 *   - focusSideBar / focusPanel toggle the part visible before focusing.
 *   - focusStatusBar is a no-op when the status bar is hidden.
 *   - The three editor-group commands all currently focus the Editor part.
 */
import { describe, it, expect, vi } from "vitest";
import {
  focusNextPart,
  focusPreviousPart,
  focusFirstEditorGroup,
  focusSecondEditorGroup,
  focusThirdEditorGroup,
  focusSideBar,
  focusPanel,
  focusActivityBar,
  focusStatusBar,
} from "../../src/commands/focusCommands";
import { PartId } from "../../src/services/serviceTypes";

function makeWb(opts: {
  focused?: string;
  visible?: Partial<Record<string, boolean>>;
} = {}) {
  const visible = opts.visible ?? {};
  const focusPart = vi.fn();
  const toggleSidebar = vi.fn();
  const togglePanel = vi.fn();
  const isPartVisible = vi.fn((id: string) => visible[id] ?? false);
  const hasFocus = vi.fn((id: string) => id === opts.focused);
  return {
    focusPart,
    toggleSidebar,
    togglePanel,
    isPartVisible,
    hasFocus,
  };
}

function makeCtx(workbench: any) {
  return { workbench, getService: () => undefined } as any;
}

describe("F6 / Shift+F6 — focusNextPart / focusPreviousPart cycle order", () => {
  it("defaults to Editor when nothing is focused and advances to the next visible part", () => {
    const w = makeWb({
      visible: {
        [PartId.Panel]: true,
        [PartId.AuxiliaryBar]: true,
        [PartId.StatusBar]: true,
        [PartId.ActivityBar]: true,
        [PartId.Sidebar]: true,
      },
    });
    focusNextPart.handler!(makeCtx(w));
    expect(w.focusPart).toHaveBeenCalledWith(PartId.Panel);
  });

  it("from Editor, F6 walks: Editor → Panel → AuxBar → StatusBar → ActivityBar → Sidebar → Editor", () => {
    const ids = [
      PartId.Panel,
      PartId.AuxiliaryBar,
      PartId.StatusBar,
      PartId.ActivityBar,
      PartId.Sidebar,
      PartId.Editor,
    ];
    let current: string = PartId.Editor;
    for (const expected of ids) {
      const w = makeWb({
        focused: current,
        visible: {
          [PartId.Panel]: true,
          [PartId.AuxiliaryBar]: true,
          [PartId.StatusBar]: true,
          [PartId.ActivityBar]: true,
          [PartId.Sidebar]: true,
        },
      });
      focusNextPart.handler!(makeCtx(w));
      expect(w.focusPart).toHaveBeenCalledWith(expected);
      current = expected;
    }
  });

  it("Shift+F6 walks backward: Editor → Sidebar → ActivityBar", () => {
    const w = makeWb({
      focused: PartId.Editor,
      visible: {
        [PartId.Sidebar]: true,
        [PartId.ActivityBar]: true,
      },
    });
    focusPreviousPart.handler!(makeCtx(w));
    expect(w.focusPart).toHaveBeenCalledWith(PartId.Sidebar);
  });

  it("skips hidden parts and lands on the next visible neighbour", () => {
    // Only ActivityBar visible (besides Editor). From Editor, forward should
    // skip Panel/AuxBar/StatusBar and land on ActivityBar.
    const w = makeWb({
      focused: PartId.Editor,
      visible: { [PartId.ActivityBar]: true },
    });
    focusNextPart.handler!(makeCtx(w));
    expect(w.focusPart).toHaveBeenCalledWith(PartId.ActivityBar);
  });

  it("falls back to Editor when no neighbour is visible", () => {
    const w = makeWb({ focused: PartId.Editor, visible: {} });
    focusNextPart.handler!(makeCtx(w));
    expect(w.focusPart).toHaveBeenCalledWith(PartId.Editor);
  });
});

describe("editor-group focus commands", () => {
  it("focusFirstEditorGroup / Second / Third all currently focus the Editor part", () => {
    for (const cmd of [
      focusFirstEditorGroup,
      focusSecondEditorGroup,
      focusThirdEditorGroup,
    ]) {
      const w = makeWb();
      cmd.handler!(makeCtx(w));
      expect(w.focusPart).toHaveBeenCalledWith(PartId.Editor);
    }
  });
});

describe("focusSideBar / focusPanel show-if-hidden", () => {
  it("focusSideBar toggles sidebar visible when hidden, then focuses", () => {
    const w = makeWb({ visible: { [PartId.Sidebar]: false } });
    focusSideBar.handler!(makeCtx(w));
    expect(w.toggleSidebar).toHaveBeenCalledOnce();
    expect(w.focusPart).toHaveBeenCalledWith(PartId.Sidebar);
  });

  it("focusSideBar does NOT toggle when sidebar is already visible", () => {
    const w = makeWb({ visible: { [PartId.Sidebar]: true } });
    focusSideBar.handler!(makeCtx(w));
    expect(w.toggleSidebar).not.toHaveBeenCalled();
    expect(w.focusPart).toHaveBeenCalledWith(PartId.Sidebar);
  });

  it("focusPanel toggles panel visible when hidden, then focuses", () => {
    const w = makeWb({ visible: { [PartId.Panel]: false } });
    focusPanel.handler!(makeCtx(w));
    expect(w.togglePanel).toHaveBeenCalledOnce();
    expect(w.focusPart).toHaveBeenCalledWith(PartId.Panel);
  });
});

describe("focusActivityBar / focusStatusBar", () => {
  it("focusActivityBar focuses unconditionally", () => {
    const w = makeWb();
    focusActivityBar.handler!(makeCtx(w));
    expect(w.focusPart).toHaveBeenCalledWith(PartId.ActivityBar);
  });

  it("focusStatusBar is a no-op when the status bar is hidden", () => {
    const w = makeWb({ visible: { [PartId.StatusBar]: false } });
    focusStatusBar.handler!(makeCtx(w));
    expect(w.focusPart).not.toHaveBeenCalled();
  });

  it("focusStatusBar focuses when visible", () => {
    const w = makeWb({ visible: { [PartId.StatusBar]: true } });
    focusStatusBar.handler!(makeCtx(w));
    expect(w.focusPart).toHaveBeenCalledWith(PartId.StatusBar);
  });
});

describe("CommandDescriptor metadata", () => {
  it("F6 and Shift+F6 keybindings are pinned", () => {
    expect(focusNextPart.keybinding).toBe("F6");
    expect(focusPreviousPart.keybinding).toBe("Shift+F6");
  });

  it("ctrl-N keybindings for editor-group focus", () => {
    expect(focusFirstEditorGroup.keybinding).toBe("Ctrl+1");
    expect(focusSecondEditorGroup.keybinding).toBe("Ctrl+2");
    expect(focusThirdEditorGroup.keybinding).toBe("Ctrl+3");
  });

  it("ctrl-0 and ctrl-backtick for sidebar/panel focus", () => {
    expect(focusSideBar.keybinding).toBe("Ctrl+0");
    expect(focusPanel.keybinding).toBe("Ctrl+`");
  });
});
