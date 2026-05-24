/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi } from "vitest";
import { McpToolBridge } from "../../src/openclaw/mcp/mcpToolBridge";

function makeMcpClient(opts: {
  tools?: Record<string, any[]>;
  callResult?: (serverId: string, name: string, args: any) => any;
} = {}) {
  const statusHandlers: Array<(e: { serverId: string; status: string }) => void> = [];
  const notifHandlers: Array<(e: { serverId: string; method: string }) => void> = [];
  const callTool = vi.fn(async (serverId: string, name: string, args: any) => {
    return opts.callResult?.(serverId, name, args) ?? {
      content: [{ type: "text", text: "ok" }],
      isError: false,
    };
  });
  const client = {
    listTools: vi.fn(async (serverId: string) => opts.tools?.[serverId] ?? []),
    callTool,
    onDidChangeStatus: (h: any) => { statusHandlers.push(h); return { dispose() {} }; },
    onDidReceiveNotification: (h: any) => { notifHandlers.push(h); return { dispose() {} }; },
  };
  return {
    client,
    callTool,
    fireStatus(serverId: string, status: string) { for (const h of statusHandlers) h({ serverId, status }); },
    fireNotification(serverId: string, method: string) { for (const h of notifHandlers) h({ serverId, method }); },
  };
}

function makeToolsService() {
  const registered: any[] = [];
  let disposeCount = 0;
  return {
    registered,
    registerTool: vi.fn((tool: any) => {
      registered.push(tool);
      return { dispose() { disposeCount++; tool.__disposed = true; } };
    }),
    get disposeCount() { return disposeCount; },
  };
}

describe("McpToolBridge.refreshTools", () => {
  it("registers a tool per schema with mcp__<serverId>__<toolName> name and source='mcp'", async () => {
    const { client } = makeMcpClient({
      tools: {
        srvA: [
          { name: "echo", description: "Echo back", inputSchema: { type: "object", properties: { msg: { type: "string" } } } },
          { name: "ping", inputSchema: {} },
        ],
      },
    });
    const tools = makeToolsService();
    const bridge = new McpToolBridge(client as any, tools as any);
    await bridge.refreshTools("srvA");
    expect(tools.registered).toHaveLength(2);
    const echo = tools.registered.find((t) => t.name === "mcp__srvA__echo");
    expect(echo).toBeDefined();
    expect(echo.description).toBe("Echo back");
    expect(echo.source).toBe("mcp");
    expect(echo.ownerToolId).toBe("srvA");
    expect(echo.permissionLevel).toBe("requires-approval");
    expect(echo.requiresConfirmation).toBe(false);
    expect(echo.parameters).toEqual({ type: "object", properties: { msg: { type: "string" } } });
    const ping = tools.registered.find((t) => t.name === "mcp__srvA__ping");
    expect(ping.description).toBe("");
    // inputSchema is provided ({}), so ?? does NOT fall through to default;
    // parameters is exactly the empty object the server sent.
    expect(ping.parameters).toEqual({});
    bridge.dispose();
  });

  it("disposes previous registrations before re-registering on second call", async () => {
    const { client } = makeMcpClient({
      tools: { srv: [{ name: "t1", inputSchema: {} }] },
    });
    const tools = makeToolsService();
    const bridge = new McpToolBridge(client as any, tools as any);
    await bridge.refreshTools("srv");
    const first = tools.registered[0];
    await bridge.refreshTools("srv");
    expect(first.__disposed).toBe(true);
    expect(tools.registered).toHaveLength(2);
    bridge.dispose();
  });

  it("tool handler joins only text-typed content with newlines and falls back to '(no output)'", async () => {
    const { client } = makeMcpClient({
      tools: { s: [{ name: "x", inputSchema: {} }] },
      callResult: () => ({
        content: [
          { type: "text", text: "a" },
          { type: "image", data: "xxx" },
          { type: "text", text: "b" },
          { type: "text" },
        ],
        isError: false,
      }),
    });
    const tools = makeToolsService();
    const bridge = new McpToolBridge(client as any, tools as any);
    await bridge.refreshTools("s");
    const t = tools.registered[0];
    const res = await t.handler({ foo: 1 });
    expect(res.content).toBe("a\nb");
    expect(res.isError).toBe(false);
    bridge.dispose();
  });

  it("tool handler forwards isError and returns '(no output)' for empty text join", async () => {
    const { client } = makeMcpClient({
      tools: { s: [{ name: "x", inputSchema: {} }] },
      callResult: () => ({ content: [{ type: "image", data: "x" }], isError: true }),
    });
    const tools = makeToolsService();
    const bridge = new McpToolBridge(client as any, tools as any);
    await bridge.refreshTools("s");
    const res = await tools.registered[0].handler({});
    expect(res.content).toBe("(no output)");
    expect(res.isError).toBe(true);
    bridge.dispose();
  });
});

describe("McpToolBridge auto-remove and notifications", () => {
  it("removes a server's tools when status flips to 'disconnected'", async () => {
    const c = makeMcpClient({ tools: { s: [{ name: "x", inputSchema: {} }] } });
    const tools = makeToolsService();
    const bridge = new McpToolBridge(c.client as any, tools as any);
    await bridge.refreshTools("s");
    const before = tools.registered[0];
    c.fireStatus("s", "disconnected");
    expect(before.__disposed).toBe(true);
    bridge.dispose();
  });

  it("does NOT remove tools on non-disconnected status transitions", async () => {
    const c = makeMcpClient({ tools: { s: [{ name: "x", inputSchema: {} }] } });
    const tools = makeToolsService();
    const bridge = new McpToolBridge(c.client as any, tools as any);
    await bridge.refreshTools("s");
    const t = tools.registered[0];
    c.fireStatus("s", "connected");
    c.fireStatus("s", "connecting");
    expect(t.__disposed).not.toBe(true);
    bridge.dispose();
  });

  it("re-fetches tools on notifications/tools/list_changed", async () => {
    const c = makeMcpClient({
      tools: { s: [{ name: "x", inputSchema: {} }] },
    });
    const tools = makeToolsService();
    const bridge = new McpToolBridge(c.client as any, tools as any);
    await bridge.refreshTools("s");
    expect(c.client.listTools).toHaveBeenCalledTimes(1);
    c.fireNotification("s", "notifications/tools/list_changed");
    // Promise has been queued; await microtasks
    await Promise.resolve();
    await Promise.resolve();
    expect(c.client.listTools).toHaveBeenCalledTimes(2);
    bridge.dispose();
  });

  it("ignores unrelated notification methods", async () => {
    const c = makeMcpClient({ tools: { s: [{ name: "x", inputSchema: {} }] } });
    const tools = makeToolsService();
    const bridge = new McpToolBridge(c.client as any, tools as any);
    await bridge.refreshTools("s");
    c.fireNotification("s", "notifications/something_else");
    await Promise.resolve();
    expect(c.client.listTools).toHaveBeenCalledTimes(1);
    bridge.dispose();
  });
});

describe("McpToolBridge.dispose", () => {
  it("disposes all per-server tool registrations and clears the map", async () => {
    const c = makeMcpClient({
      tools: {
        a: [{ name: "x", inputSchema: {} }, { name: "y", inputSchema: {} }],
        b: [{ name: "z", inputSchema: {} }],
      },
    });
    const tools = makeToolsService();
    const bridge = new McpToolBridge(c.client as any, tools as any);
    await bridge.refreshTools("a");
    await bridge.refreshTools("b");
    const all = [...tools.registered];
    bridge.dispose();
    for (const t of all) expect(t.__disposed).toBe(true);
  });
});
