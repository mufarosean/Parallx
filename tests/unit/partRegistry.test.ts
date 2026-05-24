/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi } from "vitest";
import {
  PartRegistry,
  DuplicatePartError,
  PartNotFoundError,
} from "../../src/parts/partRegistry";
import type { IPart, PartDescriptor } from "../../src/parts/partTypes";

function makePart(id: string): IPart {
  return {
    id,
    dispose: vi.fn(),
  } as unknown as IPart;
}

function descriptor(id: string, factory?: () => IPart): PartDescriptor {
  return {
    id,
    factory: factory ?? (() => makePart(id)),
  } as PartDescriptor;
}

describe("PartRegistry — registration", () => {
  it("register stores the descriptor and fires onDidRegister", () => {
    const reg = new PartRegistry();
    const fired: PartDescriptor[] = [];
    reg.onDidRegister((d) => fired.push(d));
    const d = descriptor("a");
    reg.register(d);
    expect(reg.has("a")).toBe(true);
    expect(reg.getDescriptor("a")).toBe(d);
    expect(fired).toEqual([d]);
  });

  it("register throws DuplicatePartError when re-registering the same ID", () => {
    const reg = new PartRegistry();
    reg.register(descriptor("dup"));
    expect(() => reg.register(descriptor("dup"))).toThrow(DuplicatePartError);
  });

  it("registerMany registers every descriptor in order", () => {
    const reg = new PartRegistry();
    reg.registerMany([descriptor("a"), descriptor("b")]);
    expect(reg.getDescriptors().map((d) => d.id)).toEqual(["a", "b"]);
  });
});

describe("PartRegistry — lookup", () => {
  it("getDescriptor throws PartNotFoundError for unknown ID", () => {
    const reg = new PartRegistry();
    expect(() => reg.getDescriptor("missing")).toThrow(PartNotFoundError);
  });

  it("getPart returns undefined until the part is created", () => {
    const reg = new PartRegistry();
    reg.register(descriptor("a"));
    expect(reg.getPart("a")).toBeUndefined();
    reg.createPart("a");
    expect(reg.getPart("a")).toBeDefined();
  });

  it("requirePart throws PartNotFoundError when the part has not been instantiated", () => {
    const reg = new PartRegistry();
    reg.register(descriptor("a"));
    expect(() => reg.requirePart("a")).toThrow(PartNotFoundError);
    reg.createPart("a");
    expect(reg.requirePart("a")).toBeDefined();
  });
});

describe("PartRegistry — factory", () => {
  it("createPart is singleton — factory is invoked at most once and the same instance is returned", () => {
    const reg = new PartRegistry();
    const factory = vi.fn(() => makePart("a"));
    reg.register(descriptor("a", factory));
    const first = reg.createPart("a");
    const second = reg.createPart("a");
    expect(first).toBe(second);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("createPart fires onDidCreate with the new instance", () => {
    const reg = new PartRegistry();
    reg.register(descriptor("a"));
    const fired: IPart[] = [];
    reg.onDidCreate((p) => fired.push(p));
    const p = reg.createPart("a");
    expect(fired).toEqual([p]);
  });

  it("createPart throws PartNotFoundError when descriptor is not registered", () => {
    const reg = new PartRegistry();
    expect(() => reg.createPart("nope")).toThrow(PartNotFoundError);
  });

  it("createAll materializes every registered descriptor and returns all parts", () => {
    const reg = new PartRegistry();
    reg.registerMany([descriptor("a"), descriptor("b")]);
    const all = reg.createAll();
    expect(all.map((p) => p.id)).toEqual(["a", "b"]);
    expect(reg.getParts()).toHaveLength(2);
  });
});

describe("PartRegistry — disposal", () => {
  it("dispose() disposes every instantiated part and clears registry state", () => {
    const reg = new PartRegistry();
    const partA = makePart("a");
    const partB = makePart("b");
    reg.register(descriptor("a", () => partA));
    reg.register(descriptor("b", () => partB));
    reg.createAll();
    reg.dispose();
    expect(partA.dispose).toHaveBeenCalled();
    expect(partB.dispose).toHaveBeenCalled();
    expect(reg.has("a")).toBe(false);
    expect(reg.getParts()).toEqual([]);
  });
});
