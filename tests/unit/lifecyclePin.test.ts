import { describe, it, expect, vi } from "vitest";
import { LifecycleService, LifecyclePhase } from "../../src/workbench/lifecycle";

describe("LifecycleService pin", () => {
  it("phase enum values are pinned 1..5", () => {
    expect(LifecyclePhase.Services).toBe(1);
    expect(LifecyclePhase.Layout).toBe(2);
    expect(LifecyclePhase.Parts).toBe(3);
    expect(LifecyclePhase.WorkspaceRestore).toBe(4);
    expect(LifecyclePhase.Ready).toBe(5);
  });

  it("startup runs phases 1→5 in order, firing start+complete per phase", async () => {
    const svc = new LifecycleService();
    const order: string[] = [];
    svc.onDidPhaseStart(e => order.push(`start:${e.phase}`));
    svc.onDidPhaseComplete(e => order.push(`done:${e.phase}`));

    await svc.startup();

    expect(order).toEqual([
      "start:1", "done:1",
      "start:2", "done:2",
      "start:3", "done:3",
      "start:4", "done:4",
      "start:5", "done:5",
    ]);
    expect(svc.phase).toBe(LifecyclePhase.Ready);
    expect(svc.hasReachedPhase(LifecyclePhase.Services)).toBe(true);
    expect(svc.hasReachedPhase(LifecyclePhase.Ready)).toBe(true);
  });

  it("startup hooks fire in registration order within a phase and await async", async () => {
    const svc = new LifecycleService();
    const order: string[] = [];
    svc.onStartup(LifecyclePhase.Services, () => { order.push("a"); });
    svc.onStartup(LifecyclePhase.Services, async () => {
      await new Promise(r => setTimeout(r, 5));
      order.push("b");
    });
    svc.onStartup(LifecyclePhase.Services, () => { order.push("c"); });

    await svc.startup();

    expect(order).toEqual(["a", "b", "c"]);
  });

  it("teardown runs phases 5→1 in reverse order", async () => {
    const svc = new LifecycleService();
    const order: number[] = [];
    svc.onDidPhaseStart(e => order.push(e.phase));

    await svc.teardown();

    expect(order).toEqual([5, 4, 3, 2, 1]);
  });

  it("registering a startup hook AFTER its phase has been reached executes immediately", async () => {
    const svc = new LifecycleService();
    await svc.startup();

    const hook = vi.fn();
    svc.onStartup(LifecyclePhase.Services, hook);

    expect(hook).toHaveBeenCalledTimes(1);
  });

  it("disposing a registration removes the hook so it never runs", async () => {
    const svc = new LifecycleService();
    const hook = vi.fn();
    const reg = svc.onStartup(LifecyclePhase.Layout, hook);
    reg.dispose();

    await svc.startup();

    expect(hook).not.toHaveBeenCalled();
  });

  it("errors thrown by a hook are captured, fired on onDidPhaseError, and do not stop the cycle", async () => {
    const svc = new LifecycleService();
    const errors: LifecyclePhase[] = [];
    svc.onDidPhaseError(e => errors.push(e.phase));

    svc.onStartup(LifecyclePhase.Services, () => { throw new Error("boom"); });
    const reached: number[] = [];
    svc.onDidPhaseComplete(e => reached.push(e.phase));

    await svc.startup();

    expect(errors).toEqual([LifecyclePhase.Services]);
    expect(svc.errors).toHaveLength(1);
    expect(svc.errors[0].error.message).toBe("boom");
    expect(reached).toEqual([1, 2, 3, 4, 5]);
  });

  it("rejected async hooks are captured as errors", async () => {
    const svc = new LifecycleService();
    svc.onStartup(LifecyclePhase.Ready, async () => { throw new Error("late"); });

    await svc.startup();

    expect(svc.errors.map(e => e.error.message)).toContain("late");
  });

  it("non-Error throws are coerced to Error", async () => {
    const svc = new LifecycleService();
    svc.onStartup(LifecyclePhase.Services, () => { throw "stringly"; });

    await svc.startup();

    expect(svc.errors[0].error).toBeInstanceOf(Error);
    expect(svc.errors[0].error.message).toBe("stringly");
  });
});
