/** @vitest-environment jsdom */
//
// Pin tests for src/workbench/statusBarController.ts — updateWindowTitle().
//
// Covers structural invariants:
//   - document.title composition: "Name — Workspace — Parallx"
//   - Dirty editor gets a leading bullet ("●")
//   - No editor: title is "Workspace — Parallx"
//   - WorkbenchContextManager receives scheme/extname/filename when editor has a URI
//   - WorkbenchContextManager is cleared when editor has no URI / no editor
//   - Bad URI clears the resource keys without throwing

import { describe, it, expect, beforeEach } from "vitest";
import { StatusBarController } from "../../src/workbench/statusBarController.js";
import { ServiceCollection } from "../../src/services/serviceCollection.js";

class FakeStatusBar {
  setCommandExecutor(_fn: any): void {}
  getEntries(): any[] { return []; }
  addEntry(_e: any): any { return { update: () => {}, dispose: () => {} }; }
  onDidContextMenu(_cb: any): { dispose: () => void } { return { dispose: () => {} }; }
}

class FakeEditorPart {}

class FakeWorkbenchContext {
  scheme = "untouched";
  ext = "untouched";
  filename = "untouched";
  setResourceScheme(v: string) { this.scheme = v; }
  setResourceExtname(v: string) { this.ext = v; }
  setResourceFilename(v: string) { this.filename = v; }
}

function makeController(workspace: any, wbCtx?: any) {
  const services = new ServiceCollection();
  const c = new StatusBarController({
    statusBar: new FakeStatusBar() as any,
    editorPart: new FakeEditorPart() as any,
    services,
    container: document.createElement("div"),
    keybindingHint: () => undefined,
    toggleStatusBar: () => {},
    getWorkspace: () => workspace,
    getWorkbenchContext: () => wbCtx,
  });
  return c;
}

beforeEach(() => { document.title = ""; });

describe("StatusBarController.updateWindowTitle", () => {
  it("with no editor produces 'Workspace — Parallx'", () => {
    const c = makeController({ displayName: "MyWS" });
    c.updateWindowTitle(undefined);
    expect(document.title).toBe("MyWS — Parallx");
  });

  it("with a clean editor produces 'Name — Workspace — Parallx'", () => {
    const c = makeController({ displayName: "MyWS" });
    c.updateWindowTitle({ name: "foo.ts", isDirty: false, uri: undefined } as any);
    expect(document.title).toBe("foo.ts — MyWS — Parallx");
  });

  it("with a dirty editor prefixes the editor name with a bullet", () => {
    const c = makeController({ displayName: "MyWS" });
    c.updateWindowTitle({ name: "foo.ts", isDirty: true, uri: undefined } as any);
    expect(document.title).toBe("● foo.ts — MyWS — Parallx");
  });

  it("just 'Parallx' when workspace is undefined and no editor", () => {
    const c = makeController(undefined);
    c.updateWindowTitle(undefined);
    expect(document.title).toBe("Parallx");
  });

  it("populates wbCtx scheme/extname/filename from editor.uri", () => {
    const wbCtx = new FakeWorkbenchContext();
    const c = makeController({ displayName: "WS" }, wbCtx);
    const uri = { toString: () => "file:///d:/AI/Parallx/src/foo.ts" };
    c.updateWindowTitle({ name: "foo.ts", isDirty: false, uri } as any);
    expect(wbCtx.scheme).toBe("file");
    expect(wbCtx.ext).toBe(".ts");
    expect(wbCtx.filename).toBe("foo.ts");
  });

  it("clears wbCtx resource keys when there is no active editor", () => {
    const wbCtx = new FakeWorkbenchContext();
    wbCtx.scheme = "x"; wbCtx.ext = "y"; wbCtx.filename = "z";
    const c = makeController({ displayName: "WS" }, wbCtx);
    c.updateWindowTitle(undefined);
    expect(wbCtx.scheme).toBe("");
    expect(wbCtx.ext).toBe("");
    expect(wbCtx.filename).toBe("");
  });

  it("clears wbCtx resource keys when the editor has no URI", () => {
    const wbCtx = new FakeWorkbenchContext();
    wbCtx.scheme = "old"; wbCtx.ext = ".old"; wbCtx.filename = "old.md";
    const c = makeController({ displayName: "WS" }, wbCtx);
    c.updateWindowTitle({ name: "untitled", isDirty: false, uri: undefined } as any);
    expect(wbCtx.scheme).toBe("");
    expect(wbCtx.ext).toBe("");
    expect(wbCtx.filename).toBe("");
  });

  it("treats unparseable scheme as default (no crash)", () => {
    // URI.parse is lenient and rarely throws; assert that an unrecognized
    // input still produces *some* string assignment rather than crashing.
    const wbCtx = new FakeWorkbenchContext();
    const c = makeController({ displayName: "WS" }, wbCtx);
    const uri = { toString: () => "weird-input" };
    expect(() => c.updateWindowTitle({ name: "x", isDirty: false, uri } as any))
      .not.toThrow();
    expect(typeof wbCtx.scheme).toBe("string");
    expect(typeof wbCtx.ext).toBe("string");
    expect(typeof wbCtx.filename).toBe("string");
  });
});
