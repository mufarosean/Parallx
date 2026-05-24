// mcpBridgePin.test.ts — pin McpBridge invoke + list surface.

import { describe, it, expect, vi } from "vitest";
import { McpBridge } from "../../src/api/bridges/mcpBridge";

function makeService(tools: any[] = [], invokeImpl?: any) {
  return {
    invokeTool: vi.fn(invokeImpl ?? (async () => ({ content: "ok", isError: false }))),
    getTools: vi.fn(() => tools),
  } as any;
}

describe("McpBridge", () => {
  it("invokeTool wraps service result into MCP {type:'text',text}[] content", async () => {
    const svc = makeService([], async () => ({ content: "hello world" }));
    const b = new McpBridge("tool.a", svc);
    const r = await b.invokeTool("mcp__srv__do", { x: 1 });
    expect(r.content).toEqual([{ type: "text", text: "hello world" }]);
  });

  it("invokeTool preserves isError flag from service", async () => {
    const svc = makeService([], async () => ({ content: "boom", isError: true }));
    const b = new McpBridge("tool.a", svc);
    const r = await b.invokeTool("mcp__srv__x", {});
    expect(r.isError).toBe(true);
  });

  it("invokeTool forwards toolName and args to service", async () => {
    const svc = makeService();
    const b = new McpBridge("tool.a", svc);
    await b.invokeTool("mcp__srv__add", { a: 1, b: 2 });
    expect(svc.invokeTool).toHaveBeenCalledWith(
      "mcp__srv__add",
      { a: 1, b: 2 },
      expect.objectContaining({ isCancellationRequested: false }),
    );
  });

  it("invokeTool passes a NEVER_CANCELLED token when no token provided", async () => {
    const svc = makeService();
    const b = new McpBridge("tool.a", svc);
    await b.invokeTool("mcp__srv__x", {});
    const passed = svc.invokeTool.mock.calls[0][2];
    expect(passed.isCancellationRequested).toBe(false);
  });

  it("invokeTool bridges a public IMcpInvokeToken into ICancellationToken shape", async () => {
    const svc = makeService();
    const b = new McpBridge("tool.a", svc);
    await b.invokeTool("mcp__srv__x", {}, { isCancellationRequested: true });
    const passed = svc.invokeTool.mock.calls[0][2];
    expect(passed.isCancellationRequested).toBe(true);
    expect(typeof passed.onCancellationRequested).toBe("function");
  });

  it("listTools returns only tools whose name starts with 'mcp__'", () => {
    const svc = makeService([
      { name: "mcp__srv__a", description: "a" },
      { name: "internal__b", description: "b" },
      { name: "mcp__srv__c" },
    ]);
    const b = new McpBridge("tool.x", svc);
    const out = b.listTools();
    expect(out.map(t => t.name)).toEqual(["mcp__srv__a", "mcp__srv__c"]);
  });

  it("listTools returns {name, description} only — drops other fields", () => {
    const svc = makeService([
      { name: "mcp__srv__a", description: "a", extra: "drop" } as any,
    ]);
    const b = new McpBridge("tool.x", svc);
    const out = b.listTools();
    expect(out[0]).toEqual({ name: "mcp__srv__a", description: "a" });
  });
});
