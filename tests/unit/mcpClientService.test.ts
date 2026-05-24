/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/openclaw/mcp/mcpTransport", () => {
  return {
    McpStdioTransport: class FakeTransport {
      status: string = "disconnected";
      private _msgHandlers: Array<(d: string) => void> = [];
      private _closeHandlers: Array<(c: number | null) => void> = [];
      public sent: string[] = [];
      public connectCalled = 0;
      public closeCalled = 0;
      public killedAfterClose = false;
      constructor(
        public serverId: string,
        public command: string,
        public args: readonly string[],
        public env?: Record<string, string>,
      ) {}
      onMessage(h: (d: string) => void) {
        this._msgHandlers.push(h);
        return { dispose: () => { this._msgHandlers = this._msgHandlers.filter((x) => x !== h); } };
      }
      onClose(h: (c: number | null) => void) {
        this._closeHandlers.push(h);
        return { dispose: () => { this._closeHandlers = this._closeHandlers.filter((x) => x !== h); } };
      }
      async connect() { this.connectCalled++; this.status = "connected"; }
      async send(message: string) {
        this.sent.push(message);
        // Auto-respond to initialize request synchronously
        try {
          const parsed = JSON.parse(message);
          if (parsed.method === "initialize" && parsed.id != null) {
            queueMicrotask(() => {
              for (const h of this._msgHandlers) {
                h(JSON.stringify({ jsonrpc: "2.0", id: parsed.id, result: {} }));
              }
            });
          }
        } catch {}
      }
      async close() { this.closeCalled++; this.status = "disconnected"; }
      // Test helpers
      fireMessage(data: string) { for (const h of this._msgHandlers) h(data); }
      fireClose(code: number | null) { for (const h of this._closeHandlers) h(code); }
    },
  };
});

let McpClientService: any;

beforeEach(async () => {
  vi.useFakeTimers();
  ({ McpClientService } = await import("../../src/openclaw/mcp/mcpClientService"));
});

function makeStorage(initial?: string) {
  const store = new Map<string, string>();
  if (initial !== undefined) store.set("mcp.servers", initial);
  return {
    get: vi.fn(async (k: string) => store.get(k)),
    set: vi.fn(async (k: string, v: string) => { store.set(k, v); }),
    delete: vi.fn(async (k: string) => { store.delete(k); }),
    _peek: () => store.get("mcp.servers"),
  };
}

describe("McpClientService — config persistence", () => {
  it("starts with empty configured servers", () => {
    const svc = new McpClientService();
    expect(svc.getConfiguredServers()).toEqual([]);
    svc.dispose();
  });

  it("loads server configs from storage on init", async () => {
    const cfg = [{ id: "a", name: "A", transport: "stdio", command: "x", args: [], enabled: true }];
    const storage = makeStorage(JSON.stringify(cfg));
    const svc = new McpClientService();
    await svc.initStorage(storage as any);
    expect(svc.getConfiguredServers()).toEqual(cfg);
    svc.dispose();
  });

  it("seeds defaults and persists when storage is empty", async () => {
    const storage = makeStorage();
    const svc = new McpClientService();
    await svc.initStorage(storage as any);
    expect(svc.getConfiguredServers()).toEqual([]);
    expect(storage.set).toHaveBeenCalledWith("mcp.servers", "[]");
    svc.dispose();
  });

  it("addServerConfig replaces existing entry with the same id and persists", async () => {
    const storage = makeStorage(JSON.stringify([{ id: "a", name: "OldA", transport: "stdio", enabled: true }]));
    const svc = new McpClientService();
    await svc.initStorage(storage as any);
    await svc.addServerConfig({ id: "a", name: "NewA", transport: "stdio", enabled: true } as any);
    const cfg = svc.getConfiguredServers();
    expect(cfg).toHaveLength(1);
    expect(cfg[0].name).toBe("NewA");
    expect(JSON.parse(storage._peek()!)[0].name).toBe("NewA");
    svc.dispose();
  });

  it("removeServerConfig deletes by id and persists", async () => {
    const storage = makeStorage(
      JSON.stringify([
        { id: "a", name: "A", transport: "stdio", enabled: true },
        { id: "b", name: "B", transport: "stdio", enabled: true },
      ]),
    );
    const svc = new McpClientService();
    await svc.initStorage(storage as any);
    await svc.removeServerConfig("a");
    expect(svc.getConfiguredServers()).toEqual([
      { id: "b", name: "B", transport: "stdio", enabled: true },
    ]);
    expect(JSON.parse(storage._peek()!)).toEqual([
      { id: "b", name: "B", transport: "stdio", enabled: true },
    ]);
    svc.dispose();
  });

  it("falls back to defaults when stored JSON is malformed", async () => {
    const storage = makeStorage("not valid json");
    const svc = new McpClientService();
    await svc.initStorage(storage as any);
    expect(svc.getConfiguredServers()).toEqual([]);
    svc.dispose();
  });
});

describe("McpClientService — uninitialised / unknown servers", () => {
  it("getServerStatus returns 'disconnected' for unknown server", () => {
    const svc = new McpClientService();
    expect(svc.getServerStatus("nope")).toBe("disconnected");
    svc.dispose();
  });

  it("getConnectedServers returns [] when no servers", () => {
    const svc = new McpClientService();
    expect(svc.getConnectedServers()).toEqual([]);
    svc.dispose();
  });

  it("getHealthInfo returns undefined for unknown server", () => {
    const svc = new McpClientService();
    expect(svc.getHealthInfo("nope")).toBeUndefined();
    svc.dispose();
  });

  it("listTools rejects when server is not connected", async () => {
    const svc = new McpClientService();
    await expect(svc.listTools("nope")).rejects.toThrow(/not connected/);
    svc.dispose();
  });

  it("callTool rejects when server is not connected", async () => {
    const svc = new McpClientService();
    await expect(svc.callTool("nope", "x", {})).rejects.toThrow(/not connected/);
    svc.dispose();
  });

  it("ping rejects when server is not connected", async () => {
    const svc = new McpClientService();
    await expect(svc.ping("nope")).rejects.toThrow(/not connected/);
    svc.dispose();
  });
});

describe("McpClientService — connectServer + handshake + ping", () => {
  const config = {
    id: "s1", name: "S1", transport: "stdio" as const, command: "echo", args: [], enabled: true,
    autoReconnect: false,
  };

  it("performs initialize handshake and emits status transitions", async () => {
    const svc = new McpClientService();
    const states: Array<{ serverId: string; status: string }> = [];
    svc.onDidChangeStatus((e: any) => states.push(e));

    await svc.connectServer(config);
    expect(states.map((s) => s.status)).toEqual(["connecting", "connected"]);
    expect(svc.getServerStatus("s1")).toBe("connected");
    expect(svc.getConnectedServers()).toEqual(["s1"]);

    // Should have sent at least the initialize request and the initialized notification
    const transports = (svc as any)._servers.get("s1").transport.sent;
    const parsed = transports.map((s: string) => JSON.parse(s));
    expect(parsed[0].method).toBe("initialize");
    expect(parsed[0].params.clientInfo.name).toBe("Parallx");
    expect(parsed[parsed.length - 1].method).toBe("notifications/initialized");

    await svc.disconnectServer("s1");
    svc.dispose();
  });

  it("responds to server-initiated 'ping' with { result: {} }", async () => {
    const svc = new McpClientService();
    await svc.connectServer(config);
    const entry = (svc as any)._servers.get("s1");
    const transport = entry.transport;
    const sentBefore = transport.sent.length;

    transport.fireMessage(JSON.stringify({ jsonrpc: "2.0", id: 999, method: "ping" }));
    const newMsgs = transport.sent.slice(sentBefore).map((s: string) => JSON.parse(s));
    const pingReply = newMsgs.find((m: any) => m.id === 999);
    expect(pingReply).toEqual({ jsonrpc: "2.0", id: 999, result: {} });

    await svc.disconnectServer("s1");
    svc.dispose();
  });

  it("responds method-not-found (-32601) to unknown server requests", async () => {
    const svc = new McpClientService();
    await svc.connectServer(config);
    const transport = (svc as any)._servers.get("s1").transport;
    const sentBefore = transport.sent.length;

    transport.fireMessage(JSON.stringify({ jsonrpc: "2.0", id: 1001, method: "weird/thing" }));
    const newMsgs = transport.sent.slice(sentBefore).map((s: string) => JSON.parse(s));
    const reply = newMsgs.find((m: any) => m.id === 1001);
    expect(reply.error.code).toBe(-32601);
    expect(reply.error.message).toMatch(/weird\/thing/);

    await svc.disconnectServer("s1");
    svc.dispose();
  });

  it("forwards notifications via onDidReceiveNotification", async () => {
    const svc = new McpClientService();
    await svc.connectServer(config);
    const events: any[] = [];
    svc.onDidReceiveNotification((e: any) => events.push(e));
    const transport = (svc as any)._servers.get("s1").transport;
    transport.fireMessage(JSON.stringify({ jsonrpc: "2.0", method: "notifications/tools/list_changed" }));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ serverId: "s1", method: "notifications/tools/list_changed" });
    await svc.disconnectServer("s1");
    svc.dispose();
  });

  it("ignores non-JSON and non-'2.0' messages", async () => {
    const svc = new McpClientService();
    await svc.connectServer(config);
    const transport = (svc as any)._servers.get("s1").transport;
    const events: any[] = [];
    svc.onDidReceiveNotification((e: any) => events.push(e));
    transport.fireMessage("not json");
    transport.fireMessage(JSON.stringify({ jsonrpc: "1.0", method: "ignored" }));
    expect(events).toHaveLength(0);
    await svc.disconnectServer("s1");
    svc.dispose();
  });

  it("ping() resolves with latency and updates healthInfo", async () => {
    const svc = new McpClientService();
    await svc.connectServer(config);
    const transport = (svc as any)._servers.get("s1").transport;

    const promise = svc.ping("s1");
    // Find pending ping id
    await Promise.resolve();
    const lastSent = JSON.parse(transport.sent[transport.sent.length - 1]);
    expect(lastSent.method).toBe("ping");
    transport.fireMessage(JSON.stringify({ jsonrpc: "2.0", id: lastSent.id, result: {} }));
    const latency = await promise;
    expect(typeof latency).toBe("number");
    expect(latency).toBeGreaterThanOrEqual(0);
    const h = svc.getHealthInfo("s1");
    expect(h?.consecutiveFailures).toBe(0);
    expect(h?.isHealthy).toBe(true);
    expect(h?.lastPingLatencyMs).toBe(latency);

    await svc.disconnectServer("s1");
    svc.dispose();
  });

  it("disconnect fires status='disconnected' and stops tracking the server", async () => {
    const svc = new McpClientService();
    const states: any[] = [];
    svc.onDidChangeStatus((e: any) => states.push(e.status));
    await svc.connectServer(config);
    await svc.disconnectServer("s1");
    expect(states[states.length - 1]).toBe("disconnected");
    expect(svc.getServerStatus("s1")).toBe("disconnected");
    svc.dispose();
  });

  it("connectServer throws on unsupported transport types", async () => {
    const svc = new McpClientService();
    await expect(
      svc.connectServer({ id: "x", name: "x", transport: "sse" as any, url: "http://x", enabled: true }),
    ).rejects.toThrow(/Unsupported transport/);
    svc.dispose();
  });

  it("stdio config without command throws", async () => {
    const svc = new McpClientService();
    await expect(
      svc.connectServer({ id: "x", name: "x", transport: "stdio" as any, enabled: true } as any),
    ).rejects.toThrow(/requires a command/);
    svc.dispose();
  });
});
