/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

let McpStdioTransport: any;
let mcpApi: any;
let messageHandlers: Array<(serverId: string, data: string) => void> = [];
let exitHandlers: Array<(serverId: string, code: number | null) => void> = [];

beforeAll(async () => {
  messageHandlers = [];
  exitHandlers = [];
  mcpApi = {
    spawn: vi.fn(async (_serverId: string, _command: string, _args: string[], _env: Record<string, string>) => ({})),
    send: vi.fn(async (_serverId: string, _message: string) => {}),
    kill: vi.fn(async (_serverId: string) => {}),
    onMessage: vi.fn((h: any) => { messageHandlers.push(h); return () => { messageHandlers = messageHandlers.filter((x) => x !== h); }; }),
    onExit: vi.fn((h: any) => { exitHandlers.push(h); return () => { exitHandlers = exitHandlers.filter((x) => x !== h); }; }),
  };
  (globalThis as any).window = { parallxElectron: { mcp: mcpApi } };
  // Import AFTER window is set so module-scope electronApi resolves.
  ({ McpStdioTransport } = await import("../../src/openclaw/mcp/mcpTransport"));
});

afterAll(() => {
  delete (globalThis as any).window;
});

function freshTransport(serverId = "srv-1") {
  return new McpStdioTransport(serverId, "/bin/echo", ["hi"], { FOO: "BAR" });
}

describe("McpStdioTransport.connect", () => {
  it("flips status connecting→connected and forwards spawn args", async () => {
    mcpApi.spawn.mockResolvedValueOnce({});
    const t = freshTransport("srv-A");
    expect(t.status).toBe("disconnected");
    const p = t.connect();
    // status should be 'connecting' synchronously after subscribe but before spawn resolves
    expect(t.status).toBe("connecting");
    await p;
    expect(t.status).toBe("connected");
    expect(mcpApi.spawn).toHaveBeenCalledWith("srv-A", "/bin/echo", ["hi"], { FOO: "BAR" });
  });

  it("passes empty env object when no env is configured", async () => {
    mcpApi.spawn.mockResolvedValueOnce({});
    const t = new McpStdioTransport("srv-B", "cmd", ["a"]);
    await t.connect();
    expect(mcpApi.spawn).toHaveBeenLastCalledWith("srv-B", "cmd", ["a"], {});
  });

  it("sets status='error' and throws when spawn returns { error }", async () => {
    mcpApi.spawn.mockResolvedValueOnce({ error: "boom" });
    const t = freshTransport("srv-C");
    await expect(t.connect()).rejects.toThrow(/MCP spawn failed: boom/);
    expect(t.status).toBe("error");
  });
});

describe("McpStdioTransport messages", () => {
  it("fires onMessage only for matching serverId", async () => {
    mcpApi.spawn.mockResolvedValueOnce({});
    const t = freshTransport("srv-D");
    const seen: string[] = [];
    t.onMessage((s: string) => seen.push(s));
    await t.connect();
    for (const h of messageHandlers) {
      h("srv-OTHER", "ignored");
      h("srv-D", "kept");
    }
    expect(seen).toEqual(["kept"]);
  });

  it("fires onClose only for matching serverId and flips status to disconnected with code", async () => {
    mcpApi.spawn.mockResolvedValueOnce({});
    const t = freshTransport("srv-E");
    const codes: Array<number | null> = [];
    t.onClose((c: number | null) => codes.push(c));
    await t.connect();
    for (const h of exitHandlers) h("srv-OTHER", 99);
    expect(t.status).toBe("connected");
    for (const h of exitHandlers) h("srv-E", 0);
    expect(codes).toEqual([0]);
    expect(t.status).toBe("disconnected");
  });
});

describe("McpStdioTransport.send", () => {
  it("forwards messages to electronApi.mcp.send with serverId", async () => {
    mcpApi.spawn.mockResolvedValueOnce({});
    const t = freshTransport("srv-F");
    await t.connect();
    await t.send("{\"hello\":1}");
    expect(mcpApi.send).toHaveBeenCalledWith("srv-F", "{\"hello\":1}");
  });
});

describe("McpStdioTransport.close", () => {
  it("calls kill, sets status disconnected", async () => {
    mcpApi.spawn.mockResolvedValueOnce({});
    const t = freshTransport("srv-G");
    await t.connect();
    expect(t.status).toBe("connected");
    await t.close();
    expect(mcpApi.kill).toHaveBeenCalledWith("srv-G");
    expect(t.status).toBe("disconnected");
  });
});
