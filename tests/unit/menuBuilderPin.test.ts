/** @vitest-environment jsdom */
//
// Pin tests for src/workbench/menuBuilder.ts.
//
// Covers structural invariants:
//   - keybindingHint(): returns undefined when no IKeybindingService is registered
//   - keybindingHint(): returns undefined when service has no binding for that id
//   - keybindingHint(): forwards lookupKeybinding result through formatKeybindingForDisplay
//   - registerDefaultMenuBarItems(): registers 7 default top-level menus (file/edit/selection/view/go/tools/help)
//   - registerDefaultMenuBarItems(): registers dropdown items for file/edit/view/go/tools/help

import { describe, it, expect } from "vitest";
import { MenuBuilder } from "../../src/workbench/menuBuilder.js";
import { ServiceCollection } from "../../src/services/serviceCollection.js";
import { IKeybindingService } from "../../src/services/serviceTypes.js";

function makeBuilder(opts?: { kbBinding?: string | undefined }) {
  const services = new ServiceCollection();
  if (opts && "kbBinding" in opts) {
    const fakeKb = {
      lookupKeybinding: (_id: string): string | undefined => opts.kbBinding,
      registerKeybinding: () => () => {},
      onDidChange: () => ({ dispose: () => {} }),
    };
    services.registerInstance(IKeybindingService, fakeKb as any);
  }

  const registeredMenus: any[] = [];
  const registeredDropdowns: Record<string, any[]> = {};
  const titlebar = {
    registerMenuBarItem: (m: any) => {
      registeredMenus.push(m);
      return { dispose: () => {} };
    },
    registerMenuBarDropdownItems: (menuId: string, items: any[]) => {
      registeredDropdowns[menuId] = items;
      return { dispose: () => {} };
    },
  };
  const activityBarPart = {
    contentElement: document.createElement("div"),
  };

  const mb = new MenuBuilder({
    titlebar: titlebar as any,
    activityBarPart: activityBarPart as any,
    services,
    selectColorTheme: () => {},
  });

  return { mb, registeredMenus, registeredDropdowns };
}

describe("MenuBuilder.keybindingHint", () => {
  it("returns undefined when IKeybindingService is not registered", () => {
    const { mb } = makeBuilder();
    expect(mb.keybindingHint("foo")).toBeUndefined();
  });

  it("returns undefined when the service has no binding for the command", () => {
    const { mb } = makeBuilder({ kbBinding: undefined });
    expect(mb.keybindingHint("file.save")).toBeUndefined();
  });

  it("returns a formatted display string when a binding exists", () => {
    const { mb } = makeBuilder({ kbBinding: "Ctrl+S" });
    const hint = mb.keybindingHint("file.save");
    expect(typeof hint).toBe("string");
    expect(hint!.length).toBeGreaterThan(0);
  });
});

describe("MenuBuilder.registerDefaultMenuBarItems", () => {
  it("registers all 7 default top-level menus in order", () => {
    const { mb, registeredMenus } = makeBuilder();
    mb.registerDefaultMenuBarItems();
    expect(registeredMenus.map(m => m.id)).toEqual([
      "file", "edit", "selection", "view", "go", "tools", "help",
    ]);
    // Labels and order should be present
    for (const m of registeredMenus) {
      expect(typeof m.label).toBe("string");
      expect(typeof m.order).toBe("number");
    }
  });

  it("registers dropdown items for file/edit/view/go/tools/help menus", () => {
    const { mb, registeredDropdowns } = makeBuilder();
    mb.registerDefaultMenuBarItems();
    for (const id of ["file", "edit", "view", "go", "tools", "help"]) {
      expect(Array.isArray(registeredDropdowns[id])).toBe(true);
      expect(registeredDropdowns[id].length).toBeGreaterThan(0);
    }
    // selection menu intentionally has no dropdown items today
    expect(registeredDropdowns["selection"]).toBeUndefined();
  });

  it("File menu includes core save/open/close commands", () => {
    const { mb, registeredDropdowns } = makeBuilder();
    mb.registerDefaultMenuBarItems();
    const fileCmds = registeredDropdowns["file"].map(i => i.commandId);
    expect(fileCmds).toContain("file.save");
    expect(fileCmds).toContain("file.openFile");
    expect(fileCmds).toContain("workbench.action.closeActiveEditor");
  });
});
