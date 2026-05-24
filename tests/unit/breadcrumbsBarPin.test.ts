/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeAll } from "vitest";
import { BreadcrumbsBar, BREADCRUMBS_HEIGHT } from "../../src/editor/breadcrumbsBar";
import { URI } from "../../src/platform/uri";

beforeAll(() => {
  if (!(Element.prototype as any).scrollIntoView) {
    (Element.prototype as any).scrollIntoView = function () {};
  }
});

function makeInput(uri: URI | undefined): any {
  return { uri };
}

describe("BreadcrumbsBar pin", () => {
  it("BREADCRUMBS_HEIGHT constant and static HEIGHT alias are pinned at 28", () => {
    expect(BREADCRUMBS_HEIGHT).toBe(28);
    expect(BreadcrumbsBar.HEIGHT).toBe(28);
  });

  it("constructor creates .breadcrumbs-control with explicit height and starts hidden", () => {
    const host = document.createElement("div");
    const bar = new BreadcrumbsBar(host);

    expect(bar.domNode.classList.contains("breadcrumbs-control")).toBe(true);
    expect(bar.domNode.style.height).toBe("28px");
    expect(bar.domNode.style.minHeight).toBe("28px");
    expect(bar.isVisible).toBe(false);
    expect(bar.effectiveHeight).toBe(0);
    expect(host.contains(bar.domNode)).toBe(true);

    bar.dispose();
  });

  it("update(undefined) keeps bar hidden and returns false (no transition)", () => {
    const bar = new BreadcrumbsBar(document.createElement("div"));
    expect(bar.update(undefined)).toBe(false);
    expect(bar.isVisible).toBe(false);
    bar.dispose();
  });

  it("update() with file URI under a workspace folder shows the bar and fires visibility event", () => {
    const bar = new BreadcrumbsBar(document.createElement("div"));
    const ws = URI.file("D:/proj");
    bar.setWorkspaceFolders([{ uri: ws, name: "proj" }]);

    const events: boolean[] = [];
    bar.onDidVisibilityChange(v => events.push(v));

    const changed = bar.update(makeInput(URI.file("D:/proj/src/a.ts")));

    expect(changed).toBe(true);
    expect(bar.isVisible).toBe(true);
    expect(bar.domNode.classList.contains("hidden")).toBe(false);
    expect(bar.effectiveHeight).toBe(28);
    expect(events).toEqual([true]);

    bar.dispose();
  });

  it("update() with 'untitled' scheme hides the bar", () => {
    const bar = new BreadcrumbsBar(document.createElement("div"));
    bar.show();
    expect(bar.isVisible).toBe(true);

    const untitled = URI.from({ scheme: "untitled", path: "/Untitled-1" });
    expect(bar.update(makeInput(untitled))).toBe(true);
    expect(bar.isVisible).toBe(false);

    bar.dispose();
  });

  it("show() then hide() transitions are idempotent (no duplicate events)", () => {
    const bar = new BreadcrumbsBar(document.createElement("div"));
    const events: boolean[] = [];
    bar.onDidVisibilityChange(v => events.push(v));

    bar.show();
    bar.show();
    bar.hide();
    bar.hide();

    expect(events).toEqual([true, false]);
    bar.dispose();
  });

  it("update() with no URI on the input hides the bar", () => {
    const bar = new BreadcrumbsBar(document.createElement("div"));
    bar.show();
    expect(bar.update(makeInput(undefined))).toBe(true);
    expect(bar.isVisible).toBe(false);
    bar.dispose();
  });

  it("update() renders one breadcrumb segment element per path part (root + folders + file)", () => {
    const bar = new BreadcrumbsBar(document.createElement("div"));
    bar.setWorkspaceFolders([{ uri: URI.file("D:/proj"), name: "proj" }]);

    bar.update(makeInput(URI.file("D:/proj/src/sub/file.ts")));

    // Items are inside the breadcrumbs widget
    const items = bar.domNode.querySelectorAll(".parallx-breadcrumb-item");
    // root (proj) + src + sub + file.ts = 4
    expect(items.length).toBe(4);

    bar.dispose();
  });

  it("dispose() releases DOM listeners (does not throw)", () => {
    const bar = new BreadcrumbsBar(document.createElement("div"));
    expect(() => bar.dispose()).not.toThrow();
  });
});
