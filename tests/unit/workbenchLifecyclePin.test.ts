/**
 * Pin: workbench LifecycleService — phase ordering, hook execution,
 * late-registration replay, and error capture semantics.
 */
import { describe, it, expect } from "vitest";
import { LifecycleService, LifecyclePhase } from "../../src/workbench/lifecycle";

describe("LifecyclePhase enum — numeric values + ordering", () => {
  it("phase values are 1..5 in startup order", () => {
    expect(LifecyclePhase.Services).toBe(1);
    expect(LifecyclePhase.Layout).toBe(2);
    expect(LifecyclePhase.Parts).toBe(3);
    expect(LifecyclePhase.WorkspaceRestore).toBe(4);
    expect(LifecyclePhase.Ready).toBe(5);
  });
});

describe("LifecycleService — initial state", () => {
  it("phase is undefined and no phase reached", () => {
    const svc = new LifecycleService();
    expect(svc.phase).toBeUndefined();
    expect(svc.hasReachedPhase(LifecyclePhase.Services)).toBe(false);
    expect(svc.errors).toEqual([]);
  });
});

describe("LifecycleService — startup", () => {
  it("runs phases 1→5 in order, awaiting async hooks", async () => {
    const svc = new LifecycleService();
    const order: number[] = [];
    svc.onStartup(LifecyclePhase.Ready, () => { order.push(5); });
    svc.onStartup(LifecyclePhase.Services, async () => {
      await Promise.resolve();
      order.push(1);
    });
    svc.onStartup(LifecyclePhase.Parts, () => { order.push(3); });
    svc.onStartup(LifecyclePhase.Layout, () => { order.push(2); });
    svc.onStartup(LifecyclePhase.WorkspaceRestore, () => { order.push(4); });

    await svc.startup();
    expect(order).toEqual([1, 2, 3, 4, 5]);
    expect(svc.phase).toBe(LifecyclePhase.Ready);
    expect(svc.hasReachedPhase(LifecyclePhase.Ready)).toBe(true);
  });

  it("fires onDidPhaseStart and onDidPhaseComplete for each phase in order", async () => {
    const svc = new LifecycleService();
    const events: string[] = [];
    svc.onDidPhaseStart((e) => events.push(`start:${e.phase}`));
    svc.onDidPhaseComplete((e) => events.push(`complete:${e.phase}`));
    await svc.startup();
    expect(events).toEqual([
      "start:1", "complete:1",
      "start:2", "complete:2",
      "start:3", "complete:3",
      "start:4", "complete:4",
      "start:5", "complete:5",
    ]);
  });

  it("hooks throwing sync errors do NOT halt subsequent phases; error captured", async () => {
    const svc = new LifecycleService();
    const order: number[] = [];
    svc.onStartup(LifecyclePhase.Services, () => { throw new Error("boom"); });
    svc.onStartup(LifecyclePhase.Layout, () => { order.push(2); });
    svc.onStartup(LifecyclePhase.Ready, () => { order.push(5); });
    await svc.startup();
    expect(order).toEqual([2, 5]);
    expect(svc.errors).toHaveLength(1);
    expect(svc.errors[0].phase).toBe(LifecyclePhase.Services);
    expect(svc.errors[0].error.message).toBe("boom");
  });

  it("async rejections in phase hooks are captured (await error)", async () => {
    const svc = new LifecycleService();
    svc.onStartup(LifecyclePhase.Services, async () => { throw new Error("async-boom"); });
    await svc.startup();
    expect(svc.errors).toHaveLength(1);
    expect(svc.errors[0].error.message).toBe("async-boom");
  });

  it("non-Error throw is wrapped in Error(String(err))", async () => {
    const svc = new LifecycleService();
    svc.onStartup(LifecyclePhase.Services, () => { throw "string-thrown"; });
    await svc.startup();
    expect(svc.errors[0].error).toBeInstanceOf(Error);
    expect(svc.errors[0].error.message).toBe("string-thrown");
  });

  it("onDidPhaseError fires for each captured error", async () => {
    const svc = new LifecycleService();
    const errors: number[] = [];
    svc.onDidPhaseError((e) => errors.push(e.phase));
    svc.onStartup(LifecyclePhase.Services, () => { throw new Error("a"); });
    svc.onStartup(LifecyclePhase.Layout, () => { throw new Error("b"); });
    await svc.startup();
    expect(errors).toEqual([LifecyclePhase.Services, LifecyclePhase.Layout]);
  });
});

describe("LifecycleService — late onStartup registration", () => {
  it("registering for an already-reached phase executes the hook immediately", async () => {
    const svc = new LifecycleService();
    await svc.startup();
    let ran = false;
    svc.onStartup(LifecyclePhase.Ready, () => { ran = true; });
    expect(ran).toBe(true);
  });

  it("late async hook still captures its error against the phase", async () => {
    const svc = new LifecycleService();
    await svc.startup();
    svc.onStartup(LifecyclePhase.Ready, async () => { throw new Error("late-boom"); });
    await Promise.resolve();
    await Promise.resolve();
    expect(svc.errors.some(e => e.error.message === "late-boom" && e.phase === LifecyclePhase.Ready)).toBe(true);
  });
});

describe("LifecycleService — teardown reverses startup order", () => {
  it("runs phases 5→1 in reverse during teardown", async () => {
    const svc = new LifecycleService();
    const order: number[] = [];
    svc.onTeardown(LifecyclePhase.Services, () => { order.push(1); });
    svc.onTeardown(LifecyclePhase.Layout, () => { order.push(2); });
    svc.onTeardown(LifecyclePhase.Parts, () => { order.push(3); });
    svc.onTeardown(LifecyclePhase.WorkspaceRestore, () => { order.push(4); });
    svc.onTeardown(LifecyclePhase.Ready, () => { order.push(5); });
    await svc.teardown();
    expect(order).toEqual([5, 4, 3, 2, 1]);
  });
});

describe("LifecycleService — dispose hooks remove them", () => {
  it("onStartup().dispose() removes a pending hook before startup runs", async () => {
    const svc = new LifecycleService();
    let ran = false;
    const reg = svc.onStartup(LifecyclePhase.Ready, () => { ran = true; });
    reg.dispose();
    await svc.startup();
    expect(ran).toBe(false);
  });

  it("onTeardown().dispose() removes a pending teardown hook", async () => {
    const svc = new LifecycleService();
    let ran = false;
    const reg = svc.onTeardown(LifecyclePhase.Ready, () => { ran = true; });
    reg.dispose();
    await svc.teardown();
    expect(ran).toBe(false);
  });
});
