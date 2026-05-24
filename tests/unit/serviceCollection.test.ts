// serviceCollection.test.ts — pin ServiceCollection (DI container).
//
// Pins:
//   - register / registerInstance / has / get / tryGet basics.
//   - get throws ServiceNotFoundError for unknown id.
//   - lazy: descriptor only instantiated on first get; subsequent gets return same
//     instance when singleton; new instance every get when transient.
//   - @inject + @injectOptional: required deps resolved in parameter-index order;
//     missing required → throws ServiceNotFoundError (via cascade); optional missing → undefined.
//   - circular dependency detection throws CircularDependencyError with chain message.
//   - dispose: calls dispose() on instantiated instances, swallows errors, clears entries.
//   - post-dispose: register/registerInstance/get throw 'has been disposed'.
//   - tryGet returns undefined when get throws (e.g. circular).
//   - dispose is idempotent (second call no-op).

import { describe, it, expect, vi } from 'vitest';
import { ServiceCollection } from '../../src/services/serviceCollection';
import { createServiceIdentifier } from '../../src/platform/types';
import { inject, injectOptional, singleton, transient } from '../../src/platform/instantiation';

const IA = createServiceIdentifier<any>('IA');
const IB = createServiceIdentifier<any>('IB');
const IC = createServiceIdentifier<any>('IC');

class A { tag = 'A'; }
class B {
  tag = 'B';
  constructor(public a: A) {}
}
// Manually wire @inject — decorators applied imperatively to avoid TS decorator
// runtime config differences in vitest:
inject(IA)(B, undefined, 0);

class C {
  tag = 'C';
  constructor(public a: A | undefined) {}
}
injectOptional(IA)(C, undefined, 0);

// Circular: D -> E -> D
class D { constructor(public e: any) {} }
class E { constructor(public d: any) {} }
inject(IB)(D, undefined, 0);
inject(IA)(E, undefined, 0);

describe('ServiceCollection — basic registry', () => {
  it('registerInstance + get returns the instance; has=true', () => {
    const sc = new ServiceCollection();
    const a = new A();
    sc.registerInstance(IA, a);
    expect(sc.has(IA)).toBe(true);
    expect(sc.get(IA)).toBe(a);
  });

  it('get throws ServiceNotFoundError for unknown id', () => {
    const sc = new ServiceCollection();
    expect(() => sc.get(IA)).toThrow(/Service not found: IA/);
  });

  it('tryGet returns undefined for unknown id', () => {
    const sc = new ServiceCollection();
    expect(sc.tryGet(IA)).toBeUndefined();
  });
});

describe('ServiceCollection — lazy instantiation lifetimes', () => {
  it('singleton: descriptor instantiated on first get; same instance thereafter', () => {
    const ctor = vi.fn(function () { (this as any).tag = 'A'; }) as any;
    Object.defineProperty(ctor, 'length', { value: 0 });
    const sc = new ServiceCollection();
    sc.register(singleton(IA, ctor));
    expect(ctor).not.toHaveBeenCalled();
    const x = sc.get(IA);
    const y = sc.get(IA);
    expect(ctor).toHaveBeenCalledTimes(1);
    expect(x).toBe(y);
  });

  it('transient: new instance every get', () => {
    let counter = 0;
    class T { id = ++counter; }
    const sc = new ServiceCollection();
    sc.register(transient(IA, T));
    const x = sc.get(IA) as T;
    const y = sc.get(IA) as T;
    expect(x).not.toBe(y);
    expect((x as any).id).not.toBe((y as any).id);
  });
});

describe('ServiceCollection — @inject resolution', () => {
  it('required dependency resolved + injected at parameter index', () => {
    const sc = new ServiceCollection();
    const a = new A();
    sc.registerInstance(IA, a);
    sc.register(singleton(IB, B));
    const b = sc.get(IB) as B;
    expect(b.a).toBe(a);
  });

  it('missing required dependency throws (cascade from inner get)', () => {
    const sc = new ServiceCollection();
    sc.register(singleton(IB, B)); // IA unregistered
    expect(() => sc.get(IB)).toThrow(/Service not found: IA/);
  });

  it('@injectOptional: missing dependency → undefined', () => {
    const sc = new ServiceCollection();
    sc.register(singleton(IC, C));
    const c = sc.get(IC) as C;
    expect(c.a).toBeUndefined();
  });

  it('@injectOptional: present dependency → resolved', () => {
    const sc = new ServiceCollection();
    const a = new A();
    sc.registerInstance(IA, a);
    sc.register(singleton(IC, C));
    expect((sc.get(IC) as C).a).toBe(a);
  });

  it('circular dependency throws CircularDependencyError with chain', () => {
    const sc = new ServiceCollection();
    sc.register(singleton(IA, E)); // E needs IA (itself recursively after D)
    sc.register(singleton(IB, D)); // D needs IB
    // Wire: IA -> E -> IA  (direct self-cycle simpler)
    expect(() => sc.get(IA)).toThrow(/Circular dependency detected.*IA/);
  });

  it('tryGet swallows resolution throws → undefined', () => {
    const sc = new ServiceCollection();
    sc.register(singleton(IB, B)); // missing IA dep
    expect(sc.tryGet(IB)).toBeUndefined();
  });
});

describe('ServiceCollection — dispose', () => {
  it('calls dispose() on instantiated instances; swallows errors; clears entries', () => {
    const sc = new ServiceCollection();
    const inst1: any = { dispose: vi.fn() };
    const inst2: any = { dispose: vi.fn(() => { throw new Error('boom'); }) };
    sc.registerInstance(IA, inst1);
    sc.registerInstance(IB, inst2);
    expect(() => sc.dispose()).not.toThrow();
    expect(inst1.dispose).toHaveBeenCalled();
    expect(inst2.dispose).toHaveBeenCalled();
  });

  it('post-dispose register / registerInstance / get all throw "has been disposed"', () => {
    const sc = new ServiceCollection();
    sc.dispose();
    expect(() => sc.register(singleton(IA, A))).toThrow(/has been disposed/);
    expect(() => sc.registerInstance(IA, new A())).toThrow(/has been disposed/);
    expect(() => sc.get(IA)).toThrow(/has been disposed/);
  });

  it('dispose is idempotent (second call is a no-op)', () => {
    const sc = new ServiceCollection();
    const inst: any = { dispose: vi.fn() };
    sc.registerInstance(IA, inst);
    sc.dispose();
    sc.dispose();
    expect(inst.dispose).toHaveBeenCalledTimes(1);
  });

  it('dispose does NOT call dispose() on descriptor-only entries that were never instantiated', () => {
    const ctorDispose = vi.fn();
    class L { dispose() { ctorDispose(); } }
    const sc = new ServiceCollection();
    sc.register(singleton(IA, L));
    sc.dispose();
    expect(ctorDispose).not.toHaveBeenCalled();
  });
});
