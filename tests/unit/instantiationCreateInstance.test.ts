/**
 * Pin-the-invariant: platform/instantiation.ts createInstance behavior.
 */
import { describe, it, expect } from "vitest";
import {
  inject,
  injectOptional,
  createInstance,
  getServiceDependencies,
  singleton,
  transient,
  type IServiceProvider,
} from "../../src/platform/instantiation";
import type { ServiceIdentifier } from "../../src/platform/types";

function makeId<T>(name: string): ServiceIdentifier<T> {
  // ServiceIdentifier is `{ id: string }` + brand; use a structural shim.
  return { id: name } as ServiceIdentifier<T>;
}

class MapProvider implements IServiceProvider {
  constructor(private readonly map: Map<string, unknown>) {}
  get<T>(id: ServiceIdentifier<T>): T {
    if (!this.map.has(id.id)) throw new Error("no " + id.id);
    return this.map.get(id.id) as T;
  }
  has(id: ServiceIdentifier<any>): boolean {
    return this.map.has(id.id);
  }
}

describe("createInstance", () => {
  it("injects a required service at the decorated parameter index", () => {
    const ILogger = makeId<{ log: () => string }>("ILogger");
    class C {
      constructor(@inject(ILogger) public logger: { log: () => string }) {}
    }
    const provider = new MapProvider(new Map([["ILogger", { log: () => "hi" }]]));
    const inst = createInstance(provider, C);
    expect(inst.logger.log()).toBe("hi");
  });

  it("throws MissingDependencyError when required service is not registered", () => {
    const IMissing = makeId("IMissing");
    class C {
      constructor(@inject(IMissing) public dep: unknown) {}
    }
    const provider = new MapProvider(new Map());
    expect(() => createInstance(provider, C)).toThrowError(/missing required service "IMissing"/);
  });

  it("@injectOptional yields undefined when service is not registered", () => {
    const IOpt = makeId<{ x: number }>("IOpt");
    class C {
      constructor(@injectOptional(IOpt) public opt: { x: number } | undefined) {}
    }
    const inst = createInstance(new MapProvider(new Map()), C);
    expect(inst.opt).toBeUndefined();
  });

  it("@injectOptional injects the service when registered", () => {
    const IOpt = makeId<{ x: number }>("IOpt");
    class C {
      constructor(@injectOptional(IOpt) public opt: { x: number } | undefined) {}
    }
    const provider = new MapProvider(new Map([["IOpt", { x: 7 }]]));
    expect(createInstance(provider, C).opt).toEqual({ x: 7 });
  });

  it("fills non-decorated parameters from extraArgs in order", () => {
    const ILog = makeId<{ log: () => string }>("ILog");
    class C {
      constructor(public name: string, @inject(ILog) public logger: { log: () => string }, public n: number) {}
    }
    const provider = new MapProvider(new Map([["ILog", { log: () => "x" }]]));
    const inst = createInstance(provider, C, "alice", 42);
    expect(inst.name).toBe("alice");
    expect(inst.n).toBe(42);
    expect(inst.logger.log()).toBe("x");
  });

  it("getServiceDependencies returns a copy that does not mutate the original", () => {
    const IA = makeId("IA");
    class C {
      constructor(@inject(IA) public a: unknown) {}
    }
    const first = getServiceDependencies(C);
    expect(first).toHaveLength(1);
    first.pop();
    const second = getServiceDependencies(C);
    expect(second).toHaveLength(1);
  });
});

describe("singleton / transient descriptors", () => {
  it("singleton() flags singleton:true and preserves ctor + id", () => {
    const ID = makeId("X");
    class X {}
    const d = singleton(ID, X);
    expect(d.singleton).toBe(true);
    expect(d.id).toBe(ID);
    expect(d.ctor).toBe(X);
  });

  it("transient() flags singleton:false", () => {
    const ID = makeId("Y");
    class Y {}
    expect(transient(ID, Y).singleton).toBe(false);
  });
});
