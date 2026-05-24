/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi } from "vitest";
import { CommandService } from "../../src/commands/commandRegistry";
import { ServiceCollection } from "../../src/services/serviceCollection";

function makeService() {
  return new CommandService(new ServiceCollection() as any);
}

describe("CommandService — registration", () => {
  it("registerCommand stores descriptor, getCommand/hasCommand reflect it, and fires onDidRegisterCommand", () => {
    const svc = makeService();
    const fired = vi.fn();
    svc.onDidRegisterCommand(fired);
    const d = svc.registerCommand({ id: "x", title: "X", handler: () => "ok" });
    expect(svc.hasCommand("x")).toBe(true);
    expect(svc.getCommand("x")?.title).toBe("X");
    expect(svc.getCommands().size).toBe(1);
    expect(fired).toHaveBeenCalledWith(expect.objectContaining({ commandId: "x" }));
    d.dispose();
  });

  it("registerCommand throws on duplicate id", () => {
    const svc = makeService();
    svc.registerCommand({ id: "x", title: "X", handler: () => 0 });
    expect(() => svc.registerCommand({ id: "x", title: "Y", handler: () => 0 })).toThrow(/already registered/);
  });

  it("dispose() unregisters and fires onDidUnregisterCommand", () => {
    const svc = makeService();
    const unreg = vi.fn();
    svc.onDidUnregisterCommand(unreg);
    const d = svc.registerCommand({ id: "x", title: "X", handler: () => 0 });
    d.dispose();
    expect(svc.hasCommand("x")).toBe(false);
    expect(unreg).toHaveBeenCalledWith({ commandId: "x" });
  });

  it("disposing a stale registration does not unregister a re-registered command", () => {
    const svc = makeService();
    const d1 = svc.registerCommand({ id: "x", title: "X", handler: () => 0 });
    d1.dispose();
    svc.registerCommand({ id: "x", title: "X2", handler: () => 1 });
    d1.dispose(); // stale
    expect(svc.hasCommand("x")).toBe(true);
    expect(svc.getCommand("x")?.title).toBe("X2");
  });

  it("registerCommands registers all and disposes all at once", () => {
    const svc = makeService();
    const d = svc.registerCommands([
      { id: "a", title: "A", handler: () => 1 },
      { id: "b", title: "B", handler: () => 2 },
    ]);
    expect(svc.hasCommand("a")).toBe(true);
    expect(svc.hasCommand("b")).toBe(true);
    d.dispose();
    expect(svc.hasCommand("a")).toBe(false);
    expect(svc.hasCommand("b")).toBe(false);
  });
});

describe("CommandService — execution", () => {
  it("executeCommand throws on unknown id", async () => {
    const svc = makeService();
    await expect(svc.executeCommand("nope")).rejects.toThrow(/Unknown command/);
  });

  it("returns the handler result and forwards args", async () => {
    const svc = makeService();
    svc.registerCommand({ id: "x", title: "X", handler: (_ctx, a: number, b: number) => a + b });
    const r = await svc.executeCommand<number>("x", 2, 3);
    expect(r).toBe(5);
  });

  it("fires onDidExecuteCommand with id, args, and result", async () => {
    const svc = makeService();
    const fired = vi.fn();
    svc.onDidExecuteCommand(fired);
    svc.registerCommand({ id: "x", title: "X", handler: () => "ok" });
    await svc.executeCommand("x", 1, 2);
    expect(fired).toHaveBeenCalledTimes(1);
    const ev = fired.mock.calls[0][0];
    expect(ev.commandId).toBe("x");
    expect(ev.args).toEqual([1, 2]);
    expect(ev.result).toBe("ok");
    expect(typeof ev.duration).toBe("number");
  });

  it("awaits async handlers", async () => {
    const svc = makeService();
    svc.registerCommand({
      id: "x",
      title: "X",
      handler: async () => { await new Promise((r) => setTimeout(r, 1)); return 42; },
    });
    expect(await svc.executeCommand<number>("x")).toBe(42);
  });

  it("when-clause is enforced only after setContextKeyService is called", async () => {
    const svc = makeService();
    svc.registerCommand({ id: "x", title: "X", when: "enabled", handler: () => "ok" });
    // No context key service → no enforcement
    await expect(svc.executeCommand("x")).resolves.toBe("ok");

    let allow = false;
    svc.setContextKeyService({ contextMatchesRules: () => allow });
    await expect(svc.executeCommand("x")).rejects.toThrow(/precondition not met/);
    allow = true;
    await expect(svc.executeCommand("x")).resolves.toBe("ok");
  });

  it("provides a CommandExecutionContext with workbench backref", async () => {
    const svc = makeService();
    const wb = { tag: "bench" };
    svc.setWorkbench(wb);
    const seen: any[] = [];
    svc.registerCommand({ id: "x", title: "X", handler: (ctx) => { seen.push(ctx); return null; } });
    await svc.executeCommand("x");
    expect(seen[0].workbench).toBe(wb);
    expect(typeof seen[0].getService).toBe("function");
    expect(seen[0].getService("never-registered")).toBeUndefined();
  });
});
