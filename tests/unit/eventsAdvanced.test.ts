/**
 * Pin-the-invariant: events.ts secondary surface — debounce/throttle/defer/fromPromise/leak.
 *
 * Complements existing tests/unit/events.test.ts which covers the core Emitter
 * + map/filter/any/once/None. This file pins the timer-driven utilities and
 * the dev-mode leak-warning surface.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  Emitter,
  EventUtils,
  enableLeakWarnings,
  disableLeakWarnings,
} from "../../src/platform/events";

describe("Emitter — leak warnings", () => {
  afterEach(() => disableLeakWarnings());

  it("warns when listener count exceeds threshold", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    enableLeakWarnings(2);
    const e = new Emitter<number>();
    e.event(() => {});
    e.event(() => {});
    expect(warn).not.toHaveBeenCalled();
    e.event(() => {});
    expect(warn).toHaveBeenCalled();
    e.dispose();
    warn.mockRestore();
  });

  it("does not warn after disableLeakWarnings", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    enableLeakWarnings(1);
    disableLeakWarnings();
    const e = new Emitter<number>();
    for (let i = 0; i < 10; i++) e.event(() => {});
    expect(warn).not.toHaveBeenCalled();
    e.dispose();
    warn.mockRestore();
  });

  it("subscribing post-dispose returns a no-op disposable", () => {
    const e = new Emitter<number>();
    e.dispose();
    const fn = vi.fn();
    const sub = e.event(fn);
    expect(typeof sub.dispose).toBe("function");
    expect(e.listenerCount).toBe(0);
    expect(() => sub.dispose()).not.toThrow();
  });

  it("snapshots listeners before fire so listeners added during fire don't run", () => {
    const e = new Emitter<number>();
    const seen: string[] = [];
    e.event(v => {
      seen.push("a:" + v);
      e.event(v2 => seen.push("late:" + v2));
    });
    e.fire(1);
    expect(seen).toEqual(["a:1"]);
    e.dispose();
  });
});

describe("EventUtils.debounce", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("fires only after delay of silence with the latest value", async () => {
    const e = new Emitter<number>();
    const debounced = EventUtils.debounce(e.event, 50);
    const seen: number[] = [];
    debounced(v => seen.push(v));

    e.fire(1);
    await vi.advanceTimersByTimeAsync(20);
    e.fire(2);
    await vi.advanceTimersByTimeAsync(20);
    e.fire(3);
    expect(seen).toEqual([]);
    await vi.advanceTimersByTimeAsync(50);
    expect(seen).toEqual([3]);
    e.dispose();
  });

  it("dispose clears pending timeout", async () => {
    const e = new Emitter<number>();
    const debounced = EventUtils.debounce(e.event, 50);
    const seen: number[] = [];
    const sub = debounced(v => seen.push(v));
    e.fire(1);
    sub.dispose();
    await vi.advanceTimersByTimeAsync(100);
    expect(seen).toEqual([]);
    e.dispose();
  });
});

describe("EventUtils.throttle", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("fires the first value immediately then collapses bursts", async () => {
    const e = new Emitter<number>();
    const t = EventUtils.throttle(e.event, 100);
    const seen: number[] = [];
    t(v => seen.push(v));

    e.fire(1);
    expect(seen).toEqual([1]);
    e.fire(2);
    e.fire(3);
    expect(seen).toEqual([1]);
    await vi.advanceTimersByTimeAsync(100);
    expect(seen).toEqual([1, 3]);
    e.dispose();
  });

  it("dispose clears pending throttle", async () => {
    const e = new Emitter<number>();
    const t = EventUtils.throttle(e.event, 100);
    const seen: number[] = [];
    const sub = t(v => seen.push(v));
    e.fire(1);
    e.fire(2);
    sub.dispose();
    await vi.advanceTimersByTimeAsync(200);
    expect(seen).toEqual([1]);
    e.dispose();
  });
});

describe("EventUtils.defer", () => {
  it("invokes the factory lazily once, but reuses it for every listener", () => {
    let factoryCalls = 0;
    let subscribed = 0;
    const source: any = (_listener: any) => {
      subscribed++;
      return { dispose() {} };
    };
    const deferred = EventUtils.defer(() => {
      factoryCalls++;
      return source;
    });
    expect(factoryCalls).toBe(0);
    expect(subscribed).toBe(0);
    deferred(() => {});
    expect(factoryCalls).toBe(1);
    expect(subscribed).toBe(1);
    deferred(() => {});
    expect(factoryCalls).toBe(1); // factory not called again
    expect(subscribed).toBe(2);
  });
});

describe("EventUtils.fromPromise", () => {
  it("fires once when promise resolves", async () => {
    const p = Promise.resolve("ok");
    const ev = EventUtils.fromPromise(p);
    const fn = vi.fn();
    ev(fn);
    await p;
    await Promise.resolve();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("fires once when promise rejects", async () => {
    const p = Promise.reject(new Error("nope")).catch(() => {});
    const ev = EventUtils.fromPromise(p);
    const fn = vi.fn();
    ev(fn);
    await p;
    await Promise.resolve();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
