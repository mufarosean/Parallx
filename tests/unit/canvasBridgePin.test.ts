// canvasBridgePin.test.ts — pin CanvasBridge manifest/imperative paths.

import { describe, it, expect, vi } from "vitest";
import { CanvasBridge } from "../../src/api/bridges/canvasBridge";

function makeRegistry() {
  return {
    register: vi.fn((_def: any) => ({ dispose: vi.fn() })),
  } as any;
}

function makeContribution(opts: { has: boolean; wired: boolean }) {
  return {
    hasContributed: vi.fn(() => opts.has),
    wireRealDefinition: vi.fn(() => opts.wired),
    unwireRealDefinition: vi.fn(),
  } as any;
}

const def = { id: "block.foo", name: "Foo" } as any;

describe("CanvasBridge", () => {
  it("rejects definitions missing id", () => {
    const b = new CanvasBridge("tool.a", makeRegistry(), []);
    expect(() => b.registerBlockType({} as any)).toThrow(/definition\.id is required/);
  });

  it("rejects definitions missing name", () => {
    const b = new CanvasBridge("tool.a", makeRegistry(), []);
    expect(() => b.registerBlockType({ id: "x" } as any)).toThrow(/definition\.name is required/);
  });

  it("imperative path: delegates to registry.register and adds to subscriptions", () => {
    const reg = makeRegistry();
    const subs: any[] = [];
    const b = new CanvasBridge("tool.a", reg, subs);
    const d = b.registerBlockType(def);
    expect(reg.register).toHaveBeenCalledWith(def);
    expect(subs).toContain(d);
  });

  it("manifest path: wires real definition through contribution processor (not registry)", () => {
    const reg = makeRegistry();
    const c = makeContribution({ has: true, wired: true });
    const subs: any[] = [];
    const b = new CanvasBridge("tool.a", reg, subs, c);
    const d = b.registerBlockType(def);
    expect(c.wireRealDefinition).toHaveBeenCalledWith("block.foo", def);
    expect(reg.register).not.toHaveBeenCalled();
    expect(subs).toContain(d);
    // disposing unwires
    d.dispose();
    expect(c.unwireRealDefinition).toHaveBeenCalledWith("block.foo");
  });

  it("manifest path with wireRealDefinition returning false falls through to registry", () => {
    const reg = makeRegistry();
    const c = makeContribution({ has: true, wired: false });
    const b = new CanvasBridge("tool.a", reg, [], c);
    b.registerBlockType(def);
    expect(reg.register).toHaveBeenCalledWith(def);
  });

  it("no contribution service: always uses the imperative registry path", () => {
    const reg = makeRegistry();
    const b = new CanvasBridge("tool.a", reg, []);
    b.registerBlockType(def);
    expect(reg.register).toHaveBeenCalledWith(def);
  });

  it("dispose disposes all owned registrations and is idempotent", () => {
    const reg = makeRegistry();
    const handle = { dispose: vi.fn() };
    reg.register = vi.fn(() => handle);
    const b = new CanvasBridge("tool.a", reg, []);
    b.registerBlockType(def);
    b.dispose();
    expect(handle.dispose).toHaveBeenCalledTimes(1);
    b.dispose(); // idempotent — no double dispose
    expect(handle.dispose).toHaveBeenCalledTimes(1);
  });

  it("after dispose, registerBlockType throws", () => {
    const b = new CanvasBridge("tool.a", makeRegistry(), []);
    b.dispose();
    expect(() => b.registerBlockType(def)).toThrow(/bridge has been disposed/);
  });
});
