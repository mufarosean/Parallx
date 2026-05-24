/**
 * Pin tests for src/platform/instantiation.ts — DI primitives.
 *
 * Pins:
 *   - `inject` records a required dependency at the given parameter index.
 *   - `injectOptional` records an optional dependency.
 *   - `getServiceDependencies` returns a defensive copy.
 *   - `singleton`/`transient` produce ServiceDescriptors with correct lifetime flag.
 *   - `createInstance` resolves @inject dependencies from the provider in parameter order.
 *   - `createInstance` throws a descriptive error when a required dep is missing.
 *   - `createInstance` injects undefined when an @injectOptional dep is missing.
 *   - `createInstance` fills non-decorated parameter slots with extraArgs in order.
 */
import { describe, it, expect } from "vitest";
import {
  inject, injectOptional, getServiceDependencies,
  singleton, transient, createInstance,
} from "../../src/platform/instantiation";
import { createServiceIdentifier } from "../../src/platform/types";

const IFoo = createServiceIdentifier<{ name: string }>("IFoo");
const IBar = createServiceIdentifier<{ name: string }>("IBar");
const IMissing = createServiceIdentifier<{}>("IMissing");

class FakeProvider {
  private readonly _map = new Map<any, any>();
  add(id: any, v: any): this { this._map.set(id, v); return this; }
  get<T>(id: any): T { return this._map.get(id); }
  has(id: any): boolean { return this._map.has(id); }
}

describe("platform/instantiation — decorators + dependency metadata", () => {
  it("@inject records a required dependency at the parameter index", () => {
    class A {
      constructor(foo: any) { void foo; }
    }
    inject(IFoo)(A, undefined, 0);
    const deps = getServiceDependencies(A);
    expect(deps.length).toBe(1);
    expect(deps[0].id).toBe(IFoo);
    expect(deps[0].parameterIndex).toBe(0);
    expect(deps[0].optional).toBe(false);
  });

  it("@injectOptional records an optional dependency", () => {
    class B {
      constructor(bar: any) { void bar; }
    }
    injectOptional(IBar)(B, undefined, 0);
    const deps = getServiceDependencies(B);
    expect(deps[0].optional).toBe(true);
  });

  it("getServiceDependencies returns a defensive copy", () => {
    class C { constructor(x: any) { void x; } }
    inject(IFoo)(C, undefined, 0);
    const a = getServiceDependencies(C);
    a.push({ id: IBar, parameterIndex: 9, optional: false } as any);
    const b = getServiceDependencies(C);
    expect(b.length).toBe(1);
  });
});

describe("platform/instantiation — descriptors", () => {
  it("singleton() produces a descriptor with singleton=true", () => {
    class S {}
    const d = singleton(IFoo, S);
    expect(d.id).toBe(IFoo);
    expect(d.ctor).toBe(S);
    expect(d.singleton).toBe(true);
  });

  it("transient() produces a descriptor with singleton=false", () => {
    class T {}
    const d = transient(IFoo, T);
    expect(d.singleton).toBe(false);
  });
});

describe("platform/instantiation — createInstance", () => {
  it("resolves @inject dependencies from the provider in parameter order", () => {
    class WithDeps {
      constructor(public readonly foo: any, public readonly bar: any) {}
    }
    inject(IFoo)(WithDeps, undefined, 0);
    inject(IBar)(WithDeps, undefined, 1);

    const foo = { name: "foo" };
    const bar = { name: "bar" };
    const p = new FakeProvider().add(IFoo, foo).add(IBar, bar);
    const i = createInstance(p as any, WithDeps);
    expect(i.foo).toBe(foo);
    expect(i.bar).toBe(bar);
  });

  it("throws a descriptive MissingDependencyError when a required dep is absent", () => {
    class Needs {
      constructor(x: any) { void x; }
    }
    inject(IMissing)(Needs, undefined, 0);
    const p = new FakeProvider();
    expect(() => createInstance(p as any, Needs))
      .toThrow(/Cannot instantiate Needs.*IMissing.*parameter index 0/);
  });

  it("injects undefined for absent @injectOptional dependency", () => {
    class Opt {
      constructor(public readonly x: any) {}
    }
    injectOptional(IBar)(Opt, undefined, 0);
    const p = new FakeProvider();
    const i = createInstance(p as any, Opt);
    expect(i.x).toBeUndefined();
  });

  it("fills non-decorated parameter slots with extraArgs in order", () => {
    class Mixed {
      constructor(public readonly foo: any, public readonly extra1: string, public readonly extra2: number) {}
    }
    inject(IFoo)(Mixed, undefined, 0);
    const p = new FakeProvider().add(IFoo, { name: "f" });
    const i = createInstance(p as any, Mixed, "hello", 42);
    expect(i.foo).toEqual({ name: "f" });
    expect(i.extra1).toBe("hello");
    expect(i.extra2).toBe(42);
  });
});
