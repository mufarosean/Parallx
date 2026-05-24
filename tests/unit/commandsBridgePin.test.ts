// commandsBridgePin.test.ts — pin CommandsBridge behavior.

import { describe, it, expect, vi } from "vitest";
import { CommandsBridge } from "../../src/api/bridges/commandsBridge";

function makeService() {
  const registered = new Map<string, any>();
  const service: any = {
    registerCommand(d: any) {
      registered.set(d.id, d);
      return { dispose: () => registered.delete(d.id) };
    },
    executeCommand: vi.fn(async (id: string, ...args: any[]) => {
      const d = registered.get(id);
      if (!d) throw new Error("no such command: " + id);
      return d.handler({ commandId: id }, ...args);
    }),
    getCommands: () => registered,
  };
  return { service, registered };
}

describe("CommandsBridge", () => {
  it("registerCommand attributes the registration and adds to subscriptions", () => {
    const { service, registered } = makeService();
    const subs: any[] = [];
    const b = new CommandsBridge("tool.a", service, subs);
    const disp = b.registerCommand("cmd.x", () => 1);
    expect(registered.has("cmd.x")).toBe(true);
    expect(subs.length).toBe(1);
    expect(typeof disp.dispose).toBe("function");
  });

  it("registered handler passes args (without context) to the user handler", async () => {
    const { service } = makeService();
    const handler = vi.fn(async (...args: any[]) => args.join("|"));
    const b = new CommandsBridge("tool.a", service, []);
    b.registerCommand("cmd.y", handler);
    const result = await b.executeCommand<string>("cmd.y", "a", "b", "c");
    expect(handler).toHaveBeenCalledWith("a", "b", "c");
    expect(result).toBe("a|b|c");
  });

  it("descriptor uses the command id as the title fallback", () => {
    const { service, registered } = makeService();
    const b = new CommandsBridge("tool.a", service, []);
    b.registerCommand("cmd.z", () => {});
    expect(registered.get("cmd.z")?.title).toBe("cmd.z");
  });

  it("getCommands returns the registered ids", async () => {
    const { service } = makeService();
    const b = new CommandsBridge("tool.a", service, []);
    b.registerCommand("a", () => {});
    b.registerCommand("b", () => {});
    const ids = await b.getCommands();
    expect(ids.sort()).toEqual(["a", "b"]);
  });

  it("dispose() removes every registered command", () => {
    const { service, registered } = makeService();
    const b = new CommandsBridge("tool.a", service, []);
    b.registerCommand("a", () => {});
    b.registerCommand("b", () => {});
    b.dispose();
    expect(registered.size).toBe(0);
  });

  it("after dispose, registerCommand throws with the tool id", () => {
    const { service } = makeService();
    const b = new CommandsBridge("tool.foo", service, []);
    b.dispose();
    expect(() => b.registerCommand("cmd", () => {})).toThrow(/tool.foo/);
  });

  it("after dispose, executeCommand and getCommands throw", async () => {
    const { service } = makeService();
    const b = new CommandsBridge("tool.foo", service, []);
    b.dispose();
    await expect(b.executeCommand("any")).rejects.toThrow(/tool.foo/);
    await expect(b.getCommands()).rejects.toThrow(/tool.foo/);
  });

  it("when command is contributed, wires the real handler instead of re-registering", () => {
    const { service, registered } = makeService();
    const wireRealHandler = vi.fn();
    const processor: any = {
      isContributed: (id: string) => id === "contributed.cmd",
      wireRealHandler,
    };
    const b = new CommandsBridge("tool.a", service, [], processor);
    const handler = () => {};
    b.registerCommand("contributed.cmd", handler);
    expect(wireRealHandler).toHaveBeenCalledWith("contributed.cmd", handler);
    expect(registered.has("contributed.cmd")).toBe(false);
  });

  it("non-contributed commands fall through to direct registration even when processor is present", () => {
    const { service, registered } = makeService();
    const processor: any = {
      isContributed: () => false,
      wireRealHandler: vi.fn(),
    };
    const b = new CommandsBridge("tool.a", service, [], processor);
    b.registerCommand("normal", () => {});
    expect(processor.wireRealHandler).not.toHaveBeenCalled();
    expect(registered.has("normal")).toBe(true);
  });
});
