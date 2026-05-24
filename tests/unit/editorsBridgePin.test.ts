import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  EditorsBridge,
  setFileEditorResolver,
  getToolEditorOwner,
  type ToolEditorProvider,
} from "../../src/api/bridges/editorsBridge";
import type { IEditorService, OpenEditorDescriptor } from "../../src/services/serviceTypes";
import type { IDisposable } from "../../src/platform/lifecycle";

function makeProvider(): ToolEditorProvider {
  return {
    createEditorPane: () => ({ dispose: () => {} }),
  };
}

function makeEditorService() {
  const openEditors: OpenEditorDescriptor[] = [];
  return {
    openEditor: vi.fn(async () => undefined),
    closeEditor: vi.fn(async () => true),
    getOpenEditors: () => openEditors,
    onDidChangeOpenEditors: vi.fn(() => ({ dispose: () => {} })),
    _openEditors: openEditors,
  } as unknown as IEditorService & {
    openEditor: ReturnType<typeof vi.fn>;
    closeEditor: ReturnType<typeof vi.fn>;
    onDidChangeOpenEditors: ReturnType<typeof vi.fn>;
    _openEditors: OpenEditorDescriptor[];
  };
}

describe("EditorsBridge pin", () => {
  let svc: ReturnType<typeof makeEditorService>;
  let subs: IDisposable[];
  let bridge: EditorsBridge;

  beforeEach(() => {
    svc = makeEditorService();
    subs = [];
    bridge = new EditorsBridge("tool.a", svc, subs);
  });

  it("registerEditorProvider stores provider, exposes it via getProvider, and records owner globally", () => {
    const p = makeProvider();
    const d = bridge.registerEditorProvider("typeA", p);
    expect(bridge.getProvider("typeA")).toBe(p);
    expect(getToolEditorOwner("typeA")).toBe("tool.a");
    expect(subs.length).toBe(1);
    d.dispose();
    expect(bridge.getProvider("typeA")).toBeUndefined();
    expect(getToolEditorOwner("typeA")).toBeUndefined();
  });

  it("duplicate registration of same typeId on same bridge throws", () => {
    bridge.registerEditorProvider("typeDup", makeProvider());
    expect(() => bridge.registerEditorProvider("typeDup", makeProvider())).toThrow(/already registered/);
    // cleanup
    bridge.dispose();
  });

  it("openEditor without a registered provider throws a descriptive error", async () => {
    await expect(bridge.openEditor({ typeId: "unknown", title: "x" })).rejects.toThrow(/No editor provider/);
  });

  it("openEditor calls editorService.openEditor with a ToolEditorInput (pinned: true)", async () => {
    bridge.registerEditorProvider("typeB", makeProvider());
    await bridge.openEditor({ typeId: "typeB", title: "Hello" });
    expect(svc.openEditor).toHaveBeenCalledTimes(1);
    const [input, opts] = svc.openEditor.mock.calls[0];
    expect(opts).toEqual({ pinned: true });
    expect((input as any).typeId).toBe("typeB");
    expect((input as any).name).toBe("Hello");
  });

  it("openEditor honours instanceId for the input id", async () => {
    bridge.registerEditorProvider("typeC", makeProvider());
    await bridge.openEditor({ typeId: "typeC", title: "T", instanceId: "fixed-id" });
    const [input] = svc.openEditor.mock.calls[0];
    expect((input as any).id).toBe("fixed-id");
  });

  it("getOpenEditors returns the service's editors (or [] when no service)", () => {
    svc._openEditors.push({ id: "e1", groupId: "g1" } as OpenEditorDescriptor);
    expect(bridge.getOpenEditors()).toEqual([{ id: "e1", groupId: "g1" }]);

    const bridgeNoSvc = new EditorsBridge("tool.b", undefined, []);
    expect(bridgeNoSvc.getOpenEditors()).toEqual([]);
  });

  it("closeEditor matches by id from getOpenEditors and forwards groupId", async () => {
    svc._openEditors.push({ id: "e1", groupId: "g1" } as OpenEditorDescriptor);
    const ok = await bridge.closeEditor("e1");
    expect(ok).toBe(true);
    expect(svc.closeEditor).toHaveBeenCalledWith({ id: "e1" }, "g1", true);
  });

  it("closeEditor returns false when no matching editor", async () => {
    expect(await bridge.closeEditor("missing")).toBe(false);
  });

  it("onDidChangeOpenEditors delegates to the editor service", () => {
    const off = bridge.onDidChangeOpenEditors(() => {});
    expect(svc.onDidChangeOpenEditors).toHaveBeenCalledTimes(1);
    off.dispose();
  });

  it("openFileEditor throws when no resolver is registered", async () => {
    // Ensure clean state
    setFileEditorResolver(undefined as unknown as Parameters<typeof setFileEditorResolver>[0]);
    await expect(bridge.openFileEditor("file:///foo")).rejects.toThrow(/No file editor resolver/);
  });

  it("openFileEditor calls the resolver and opens the returned input", async () => {
    const fakeInput = { id: "fi", typeId: "file" };
    setFileEditorResolver(async () => fakeInput as any);
    await bridge.openFileEditor("file:///foo", { pinned: false });
    expect(svc.openEditor).toHaveBeenCalledWith(fakeInput, { pinned: false });
  });

  it("dispose() prevents further API access (throws)", () => {
    bridge.dispose();
    expect(() => bridge.registerEditorProvider("x", makeProvider())).toThrow(/has been deactivated/);
  });
});
