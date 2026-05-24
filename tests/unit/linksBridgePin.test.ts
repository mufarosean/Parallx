import { describe, it, expect, beforeEach, vi } from "vitest";
import { LinksBridge, type LinkContractInput } from "../../src/api/bridges/linksBridge";
import type { ILinkResolverService, LinkContract } from "../../src/links/linkResolverService";
import type { IDisposable } from "../../src/platform/lifecycle";

function makeService() {
  const registered: LinkContract[] = [];
  return {
    register: vi.fn((c: LinkContract) => {
      registered.push(c);
      return { dispose: () => { const i = registered.indexOf(c); if (i >= 0) registered.splice(i, 1); } };
    }),
    open: vi.fn(async () => true),
    allContracts: () => registered,
    resolveMetadata: vi.fn(async () => ({ title: "hi" })),
    onDidChangeContracts: vi.fn(() => ({ dispose: () => {} })),
    _registered: registered,
  } as unknown as ILinkResolverService & {
    register: ReturnType<typeof vi.fn>;
    open: ReturnType<typeof vi.fn>;
    resolveMetadata: ReturnType<typeof vi.fn>;
    onDidChangeContracts: ReturnType<typeof vi.fn>;
    _registered: LinkContract[];
  };
}

describe("LinksBridge pin", () => {
  let svc: ReturnType<typeof makeService>;
  let subs: IDisposable[];
  let bridge: LinksBridge;

  beforeEach(() => {
    svc = makeService();
    subs = [];
    bridge = new LinksBridge("tool.a", svc, subs);
  });

  it("register fills in extensionId from toolId and forwards full contract", () => {
    const input: LinkContractInput = { segment: "note", displayName: "Note", kinds: ["page"] as any };
    const d = bridge.register(input);
    expect(svc.register).toHaveBeenCalledTimes(1);
    const arg = svc.register.mock.calls[0][0] as LinkContract;
    expect(arg.extensionId).toBe("tool.a");
    expect(arg.segment).toBe("note");
    expect(subs.length).toBe(1);
    d.dispose();
    expect(svc._registered.length).toBe(0);
  });

  it("register honours explicit extensionId override", () => {
    bridge.register({ segment: "x", displayName: "X", kinds: ["page"] as any, extensionId: "other.tool" });
    expect((svc.register.mock.calls[0][0] as LinkContract).extensionId).toBe("other.tool");
  });

  it("open forwards URI and tags source with the tool id", async () => {
    const ok = await bridge.open("parallx://note/abc");
    expect(ok).toBe(true);
    expect(svc.open).toHaveBeenCalledWith("parallx://note/abc", { source: "tool.a" });
  });

  it("mint produces a parallx:// URI that parse() round-trips", () => {
    const uri = bridge.mint("note", ["abc", "def"], { ref: "1" });
    expect(uri.startsWith("parallx://note/")).toBe(true);
    const parsed = bridge.parse(uri);
    expect(parsed?.segment).toBe("note");
    expect(parsed?.pathSegments).toEqual(["abc", "def"]);
  });

  it("parse returns null for non-parallx URIs", () => {
    expect(bridge.parse("https://example.com")).toBeNull();
  });

  it("allContracts returns the service's registered contracts (and [] when no service)", () => {
    bridge.register({ segment: "a", displayName: "A", kinds: ["page"] as any });
    expect(bridge.allContracts().length).toBe(1);

    const bridgeNoSvc = new LinksBridge("t.b", undefined, []);
    expect(bridgeNoSvc.allContracts()).toEqual([]);
  });

  it("resolveMetadata delegates to service; returns null when no service", async () => {
    await expect(bridge.resolveMetadata("parallx://x")).resolves.toEqual({ title: "hi" });
    const bridgeNoSvc = new LinksBridge("t.b", undefined, []);
    await expect(bridgeNoSvc.resolveMetadata("parallx://x")).resolves.toBeNull();
  });

  it("onDidChangeContracts delegates to service", () => {
    const off = bridge.onDidChangeContracts(() => {});
    expect(svc.onDidChangeContracts).toHaveBeenCalledTimes(1);
    off.dispose();
  });

  it("dispose() prevents further API access (throws on register/open)", async () => {
    bridge.dispose();
    expect(() => bridge.register({ segment: "z", displayName: "Z", kinds: ["page"] as any })).toThrow(/has been deactivated/);
    await expect(bridge.open("parallx://z")).rejects.toThrow(/has been deactivated/);
  });

  it("register without a service is a no-op disposable + warns", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const b = new LinksBridge("t.b", undefined, []);
    const d = b.register({ segment: "x", displayName: "X", kinds: ["page"] as any });
    expect(warn).toHaveBeenCalled();
    d.dispose();
    warn.mockRestore();
  });
});
