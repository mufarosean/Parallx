/**
 * @vitest-environment jsdom
 *
 * Pin: McpStdioTransport — IPC-bridge dispatch (spawn / send / kill),
 * status transitions, message + exit forwarding filtered by serverId,
 * bridge-unavailable error path.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let messageCbs: Array<(serverId: string, data: string) => void> = [];
let exitCbs: Array<(serverId: string, code: number | null) => void> = [];

const mockMcp = {
  spawn: vi.fn(async (_id: string, _cmd: string, _args: string[], _env: Record<string, string>) => ({})),
  send: vi.fn(async (_id: string, _msg: string) => {}),
  kill: vi.fn(async (_id: string) => {}),
  onMessage: vi.fn((cb: any) => { messageCbs.push(cb); return () => { messageCbs = messageCbs.filter(c => c !== cb); }; }),
  onExit:    vi.fn((cb: any) => { exitCbs.push(cb);    return () => { exitCbs    = exitCbs.filter(c => c !== cb);    }; }),
};

// Bind window.parallxElectron BEFORE importing the module — the module
// captures the bridge at import time via a top-level `const electronApi`.
(window as any).parallxElectron = { mcp: mockMcp };

const mod = await import("../../src/openclaw/mcp/mcpTransport");
const { McpStdioTransport } = mod;

beforeEach(() => {
  vi.clearAllMocks();
  messageCbs = [];
  exitCbs = [];
  mockMcp.spawn.mockResolvedValue({} as any);
});

describe("openclaw/mcp/mcpTransport/McpStdioTransport", () => {
  it("initial status is 'disconnected'", () => {
    const t = new McpStdioTransport("s1", "node", ["a", "b"]);
    expect(t.status).toBe("disconnected");
  });

  it("connect() calls mcp.spawn with id/cmd/args/env (copy of args, empty env default)", async () => {
    const t = new McpStdioTransport("s1", "node", ["a", "b"]);
    await t.connect();
    expect(mockMcp.spawn).toHaveBeenCalledTimes(1);
    const [id, cmd, args, env] = mockMcp.spawn.mock.calls[0];
    expect(id).toBe("s1");
    expect(cmd).toBe("node");
    expect(args).toEqual(["a", "b"]);
    expect(env).toEqual({});
    expect(t.status).toBe("connected");
  });

  it("connect() forwards explicit env to spawn", async () => {
    const t = new McpStdioTransport("s1", "node", [], { K: "v" });
    await t.connect();
    expect(mockMcp.spawn.mock.calls[0][3]).toEqual({ K: "v" });
  });

  it("connect() with spawn error: status='error' and throws with 'MCP spawn failed: <err>'", async () => {
    mockMcp.spawn.mockResolvedValueOnce({ error: "ENOENT" });
    const t = new McpStdioTransport("s1", "node", []);
    await expect(t.connect()).rejects.toThrow(/MCP spawn failed: ENOENT/);
    expect(t.status).toBe("error");
  });

  it("onMessage fires only for matching serverId", async () => {
    const t = new McpStdioTransport("s1", "node", []);
    const fn = vi.fn();
    t.onMessage(fn);
    await t.connect();
    messageCbs[0]("OTHER", "ignored");
    messageCbs[0]("s1", "hello");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("hello");
  });

  it("onClose fires only for matching serverId + sets status='disconnected' on exit", async () => {
    const t = new McpStdioTransport("s1", "node", []);
    const fn = vi.fn();
    t.onClose(fn);
    await t.connect();
    exitCbs[0]("OTHER", 0);
    expect(fn).not.toHaveBeenCalled();
    expect(t.status).toBe("connected");
    exitCbs[0]("s1", 137);
    expect(fn).toHaveBeenCalledWith(137);
    expect(t.status).toBe("disconnected");
  });

  it("send() delegates to mcp.send with id + message", async () => {
    const t = new McpStdioTransport("s1", "node", []);
    await t.connect();
    await t.send("{\"jsonrpc\":\"2.0\"}");
    expect(mockMcp.send).toHaveBeenCalledWith("s1", "{\"jsonrpc\":\"2.0\"}");
  });

  it("close() sets disconnected, calls mcp.kill, and detaches the message/exit listeners (no more events fire after close)", async () => {
    const t = new McpStdioTransport("s1", "node", []);
    const onMsg = vi.fn();
    const onExit = vi.fn();
    t.onMessage(onMsg);
    t.onClose(onExit);
    await t.connect();
    expect(messageCbs).toHaveLength(1);
    expect(exitCbs).toHaveLength(1);
    await t.close();
    expect(t.status).toBe("disconnected");
    expect(mockMcp.kill).toHaveBeenCalledWith("s1");
    expect(messageCbs).toHaveLength(0);
    expect(exitCbs).toHaveLength(0);
  });
});
