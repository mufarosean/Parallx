/**
 * Pin tests for the shipped extension manifests under ext/.
 *
 * These manifests are the **public contract** between an extension and the
 * Parallx host: the loader reads `id`/`main`/`activationEvents`, the workbench
 * reads `contributes.viewContainers`/`views`/`editors`/`commands`/`configuration`
 * to wire UI surfaces, and the AI runtime reads `aiInvocable`/`aiDescription`
 * on each command. Renames or removals here are user-visible regressions.
 *
 * Pins:
 *   - Each manifest's identity: manifestVersion=1, id, name, publisher, main.
 *   - activationEvents shape (eager '*' vs onStartupFinished + named events).
 *   - View container + nav view ids that the sidebar binds to.
 *   - Editor typeIds that the editor part routes by.
 *   - Every command id + ai-invocability flag.
 *   - Configuration keys that the runtime reads (gmail server id, query, budget
 *     daily, ambient flag, hub page id/title, mediaOrganizer.showCardTags).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function manifest(name: string): any {
  return JSON.parse(readFileSync(resolve(__dirname, "../..", "ext", name, "parallx-manifest.json"), "utf8"));
}

describe("ext/budget — manifest contract", () => {
  const m = manifest("budget");
  it("pins identity", () => {
    expect(m.manifestVersion).toBe(1);
    expect(m.id).toBe("parallx.budget");
    expect(m.name).toBe("Budget");
    expect(m.publisher).toBe("parallx");
    expect(m.main).toBe("main.js");
  });
  it("activates on startup-finished and view focus", () => {
    expect(m.activationEvents).toEqual(["onStartupFinished", "onView:budget.nav"]);
  });
  it("contributes the budget view container + nav view + editor typeId", () => {
    expect(m.contributes.viewContainers).toEqual([
      { id: "budget-container", title: "Budget", icon: "wallet", location: "sidebar" },
    ]);
    expect(m.contributes.views).toEqual([
      { id: "budget.nav", name: "Budget", defaultContainerId: "budget-container" },
    ]);
    expect(m.contributes.editors).toEqual([
      { typeId: "budget.editor", displayName: "Budget" },
    ]);
  });
  it("pins all command ids", () => {
    const ids = m.contributes.commands.map((c: any) => c.id);
    expect(ids).toEqual([
      "budget.openDashboard", "budget.openPlan", "budget.openSettings",
      "budget.openAccounts", "budget.openTransactions", "budget.openBudgets",
      "budget.openRecurring", "budget.openCashFlow", "budget.openReports",
      "budget.openRules", "budget.openReconcile", "budget.openCategories",
      "budget.openReviewQueue", "budget.openSyncLog", "budget.openImportExport",
      "budget.sync", "budget.reprocessHistory", "budget.exportCsv", "budget.importCsv",
    ]);
  });
  it("budget.sync and budget.importCsv are NOT ai-invocable; others are", () => {
    const byId = new Map(m.contributes.commands.map((c: any) => [c.id, c]));
    expect((byId.get("budget.sync") as any).aiInvocable).toBeUndefined();
    expect((byId.get("budget.importCsv") as any).aiInvocable).toBeUndefined();
    expect((byId.get("budget.openDashboard") as any).aiInvocable).toBe(true);
    expect((byId.get("budget.openTransactions") as any).aiInvocable).toBe(true);
  });
  it("configuration pins gmail server id, query, and start days", () => {
    const props = m.contributes.configuration[0].properties;
    expect(props["budget.gmailMcpServerId"].default).toBe("gmail");
    expect(props["budget.gmailQuery"].type).toBe("string");
    expect(props["budget.syncStartDays"].default).toBe(90);
    expect(props["budget.syncStartDays"].minimum).toBe(1);
    expect(props["budget.syncStartDays"].maximum).toBe(3650);
  });
});

describe("ext/media-organizer — manifest contract", () => {
  const m = manifest("media-organizer");
  it("pins identity and eager activation", () => {
    expect(m.id).toBe("parallx-community.media-organizer");
    expect(m.name).toBe("Media Organizer");
    expect(m.activationEvents).toEqual(["*"]);
    expect(m.main).toBe("main.js");
  });
  it("contributes sidebar container, browser view, and grid editor typeId", () => {
    expect(m.contributes.viewContainers[0].id).toBe("media-organizer-container");
    expect(m.contributes.views[0].id).toBe("mediaOrganizer.browser");
    expect(m.contributes.editors[0].typeId).toBe("media-organizer-grid");
  });
  it("pins all command ids", () => {
    const ids = m.contributes.commands.map((c: any) => c.id).sort();
    expect(ids).toEqual([
      "media-organizer.autoStack",
      "media-organizer.buildPHashes",
      "media-organizer.cacheStats",
      "media-organizer.cancelScan",
      "media-organizer.cleanThumbnails",
      "media-organizer.createAlbum",
      "media-organizer.emptyTrash",
      "media-organizer.findDuplicates",
      "media-organizer.generateThumbnails",
      "media-organizer.moveToTrash",
      "media-organizer.openGrid",
      "media-organizer.openMap",
      "media-organizer.openSmartAlbum",
      "media-organizer.openTimeline",
      "media-organizer.rebuildSearchIndex",
      "media-organizer.rescan",
      "media-organizer.revealInMO",
      "media-organizer.saveSmartAlbum",
      "media-organizer.scan",
      "media-organizer.stackSelected",
    ]);
  });
  it("configuration pins showCardTags default true", () => {
    const props = m.contributes.configuration[0].properties;
    expect(props["mediaOrganizer.showCardTags"].type).toBe("boolean");
    expect(props["mediaOrganizer.showCardTags"].default).toBe(true);
  });
});

describe("ext/text-generator — manifest contract", () => {
  const m = manifest("text-generator");
  it("pins identity and activationEvents", () => {
    expect(m.id).toBe("parallx-community.text-generator");
    expect(m.activationEvents).toEqual([
      "onStartupFinished",
      "onCommand:textGenerator.newChat",
      "onCommand:textGenerator.openHome",
      "onCommand:textGenerator.openCharacters",
      "onCommand:textGenerator.openSettings",
      "onView:textGenerator.home",
    ]);
  });
  it("contributes the six editor typeIds", () => {
    const ids = m.contributes.editors.map((e: any) => e.typeId).sort();
    expect(ids).toEqual([
      "text-generator-character-editor",
      "text-generator-characters",
      "text-generator-chat",
      "text-generator-chat-settings",
      "text-generator-home",
      "text-generator-settings",
    ]);
  });
  it("contributes sidebar container + home view", () => {
    expect(m.contributes.viewContainers[0].id).toBe("text-generator-container");
    expect(m.contributes.views[0].id).toBe("textGenerator.home");
  });
  it("all four commands are ai-invocable", () => {
    const cmds = m.contributes.commands;
    expect(cmds.length).toBe(4);
    for (const c of cmds) {
      expect(c.aiInvocable).toBe(true);
      expect(typeof c.aiDescription).toBe("string");
    }
    expect(cmds.map((c: any) => c.id)).toEqual([
      "textGenerator.newChat",
      "textGenerator.openHome",
      "textGenerator.openCharacters",
      "textGenerator.openSettings",
    ]);
  });
});

describe("ext/web-research — manifest contract", () => {
  const m = manifest("web-research");
  it("pins identity and eager activation", () => {
    expect(m.id).toBe("parallx.web-research");
    expect(m.activationEvents).toEqual(["*"]);
  });
  it("declares workspace-files fs capability", () => {
    expect(m.capabilities.fs).toEqual({ scope: "workspace-files", modes: ["read", "write"] });
  });
  it("configuration pins M65 controls: budget, ambient toggle, hub page id/title", () => {
    const props = m.contributes.configuration[0].properties;
    expect(props["webResearch.dailyBudget"].default).toBe(100);
    expect(props["webResearch.ambientEnabled"].default).toBe(false);
    expect(props["webResearch.hubPageId"].default).toBe("");
    expect(props["webResearch.hubPageTitle"].default).toBe("Research Hub");
  });
});

describe("ext/workspace-graph — manifest contract", () => {
  const m = manifest("workspace-graph");
  it("pins identity and onStartupFinished activation", () => {
    expect(m.id).toBe("parallx.workspace-graph");
    expect(m.activationEvents).toEqual(["onStartupFinished"]);
  });
  it("contributes the workspace-graph editor typeId + view in the explorer container", () => {
    expect(m.contributes.editors[0].typeId).toBe("workspace-graph");
    expect(m.contributes.views[0].id).toBe("view.workspaceGraph");
    expect(m.contributes.views[0].defaultContainerId).toBe("view.explorer");
  });
  it("all three commands are ai-invocable", () => {
    const cmds = m.contributes.commands;
    expect(cmds.length).toBe(3);
    for (const c of cmds) expect(c.aiInvocable).toBe(true);
    expect(cmds.map((c: any) => c.id)).toEqual([
      "workspaceGraph.open",
      "workspaceGraph.refresh",
      "workspaceGraph.rebuildConceptualLinks",
    ]);
  });
});
