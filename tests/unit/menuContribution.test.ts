/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/contributions/menuContribution.css", () => ({}));

import { MenuContributionProcessor } from "../../src/contributions/menuContribution";

const cmdSvc = { getCommand: () => undefined, executeCommand: vi.fn() } as any;

function toolDesc(menus: Record<string, any[]>, id = "tool-1"): any {
  return { manifest: { id, contributes: { menus } } };
}

let warnSpy: any, logSpy: any, errSpy: any;
beforeEach(() => {
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  warnSpy.mockRestore(); logSpy.mockRestore(); errSpy.mockRestore();
});

describe("MenuContributionProcessor — processContributions", () => {
  it("is a no-op when manifest.contributes.menus is missing", () => {
    const p = new MenuContributionProcessor(cmdSvc);
    p.processContributions({ manifest: { id: "t", contributes: {} } } as any);
    expect(p.getViewTitleActions("v")).toEqual([]);
    expect(p.getViewContextMenuItems("v")).toEqual([]);
  });

  it("skips items whose menu location is not supported and logs a warning", () => {
    const p = new MenuContributionProcessor(cmdSvc);
    p.processContributions(toolDesc({ "bogus/location": [{ command: "c1" }] }));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Unknown menu location "bogus/location"'));
  });

  it("skips items missing a command and logs a warning", () => {
    const p = new MenuContributionProcessor(cmdSvc);
    p.processContributions(toolDesc({ "view/title": [{} as any] }));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("missing command"));
    expect(p.getViewTitleActions("v")).toEqual([]);
  });

  it("registers view/title and view/context items keyed by tool id", () => {
    const p = new MenuContributionProcessor(cmdSvc);
    p.processContributions(toolDesc({
      "view/title": [{ command: "cmd.title" }],
      "view/context": [{ command: "cmd.ctx" }],
    }));
    expect(p.getViewTitleActions("v").map((i) => i.commandId)).toEqual(["cmd.title"]);
    expect(p.getViewContextMenuItems("v").map((i) => i.commandId)).toEqual(["cmd.ctx"]);
  });

  it("fires onDidProcessMenus and onDidChangeMenu for each affected location", () => {
    const p = new MenuContributionProcessor(cmdSvc);
    const processed = vi.fn(); const changed = vi.fn();
    p.onDidProcessMenus(processed);
    p.onDidChangeMenu(changed);
    p.processContributions(toolDesc({
      "view/title": [{ command: "a" }, { command: "b" }],
      "view/context": [{ command: "c" }],
    }));
    expect(processed).toHaveBeenCalledTimes(1);
    expect(processed.mock.calls[0][0].toolId).toBe("tool-1");
    expect(processed.mock.calls[0][0].items).toHaveLength(3);
    const firedLocations = changed.mock.calls.map((c) => c[0]).sort();
    expect(firedLocations).toEqual(["view/context", "view/title"]);
  });
});

describe("MenuContributionProcessor — getViewTitleActions / getViewContextMenuItems sorting", () => {
  it("sorts by group, then preserves insertion order within group", () => {
    const p = new MenuContributionProcessor(cmdSvc);
    p.processContributions(toolDesc({
      "view/title": [
        { command: "z", group: "navigation" },
        { command: "a", group: "1_top" },
        { command: "b", group: "1_top" },
      ],
    }));
    const got = p.getViewTitleActions("v").map((i) => i.commandId);
    expect(got).toEqual(["a", "b", "z"]);
  });

  it("filters items whose when clause evaluates to false (with a context service)", () => {
    const p = new MenuContributionProcessor(cmdSvc);
    p.setContextKeyService({
      contextMatchesRules: (when?: string) => when === "show",
    });
    p.processContributions(toolDesc({
      "view/title": [
        { command: "a", when: "show" },
        { command: "b", when: "hide" },
        { command: "c" /* no when → always shown */ },
      ],
    }));
    const got = p.getViewTitleActions("v").map((i) => i.commandId).sort();
    expect(got).toEqual(["a", "c"]);
  });

  it("getViewContextMenuItems applies the same when-clause filter", () => {
    const p = new MenuContributionProcessor(cmdSvc);
    p.setContextKeyService({ contextMatchesRules: (w?: string) => w !== "hide" });
    p.processContributions(toolDesc({
      "view/context": [
        { command: "a" },
        { command: "b", when: "hide" },
      ],
    }));
    expect(p.getViewContextMenuItems("v").map((i) => i.commandId)).toEqual(["a"]);
  });
});

describe("MenuContributionProcessor — removeContributions", () => {
  it("removes only the matching tool's items and fires onDidRemoveMenus + onDidChangeMenu", () => {
    const p = new MenuContributionProcessor(cmdSvc);
    p.processContributions(toolDesc({ "view/title": [{ command: "a" }] }, "tool-A"));
    p.processContributions(toolDesc({ "view/title": [{ command: "b" }] }, "tool-B"));

    const removed = vi.fn(); const changed = vi.fn();
    p.onDidRemoveMenus(removed);
    p.onDidChangeMenu(changed);

    p.removeContributions("tool-A");

    expect(removed).toHaveBeenCalledWith({ toolId: "tool-A" });
    expect(changed).toHaveBeenCalledWith("view/title");
    expect(p.getViewTitleActions("v").map((i) => i.commandId)).toEqual(["b"]);
  });

  it("is a no-op for an unknown tool id", () => {
    const p = new MenuContributionProcessor(cmdSvc);
    const removed = vi.fn();
    p.onDidRemoveMenus(removed);
    p.removeContributions("never-registered");
    expect(removed).not.toHaveBeenCalled();
  });
});
