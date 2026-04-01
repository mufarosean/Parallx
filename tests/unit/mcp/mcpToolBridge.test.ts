import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { McpToolBridge } from '../../../src/openclaw/mcp/mcpToolBridge.js';
import { Emitter } from '../../../src/platform/events.js';
import type { IMcpClientService } from '../../../src/services/serviceTypes.js';
import type { ILanguageModelToolsService, IChatTool, IToolResult } from '../../../src/services/chatTypes.js';
import type { IMcpToolSchema, IMcpToolCallResult, McpConnectionState } from '../../../src/openclaw/mcp/mcpTypes.js';
import type { IDisposable } from '../../../src/platform/lifecycle.js';

// ─── Helpers ───────────────────────────────────────────────────────────────

function createMockMcpClient() {
  const statusEmitter = new Emitter<{ serverId: string; status: McpConnectionState }>();
  const notificationEmitter = new Emitter<{ serverId: string; method: string; params?: Record<string, unknown> }>();
  return {
    connectServer: vi.fn(),
    disconnectServer: vi.fn(),
    getServerStatus: vi.fn(() => 'connected' as McpConnectionState),
    getConnectedServers: vi.fn(() => []),
    listTools: vi.fn(async (): Promise<readonly IMcpToolSchema[]> => []),
    callTool: vi.fn(async (): Promise<IMcpToolCallResult> => ({ content: [], isError: false })),
    ping: vi.fn(async () => 10),
    getHealthInfo: vi.fn(() => undefined),
    onDidChangeStatus: statusEmitter.event,
    onDidReceiveNotification: notificationEmitter.event,
    dispose: vi.fn(),
    _statusEmitter: statusEmitter,
    _notificationEmitter: notificationEmitter,
  };
}

function createMockToolsService() {
  const toolsEmitter = new Emitter<void>();
  const registrations: Array<{ tool: IChatTool; disposable: IDisposable }> = [];
  return {
    onDidChangeTools: toolsEmitter.event,
    registerTool: vi.fn((tool: IChatTool): IDisposable => {
      const d = { dispose: vi.fn() };
      registrations.push({ tool, disposable: d });
      return d;
    }),
    getTools: vi.fn(() => []),
    getTool: vi.fn(),
    getToolDefinitions: vi.fn(() => []),
    getReadOnlyToolDefinitions: vi.fn(() => []),
    invokeTool: vi.fn(),
    isToolEnabled: vi.fn(() => true),
    setToolEnabled: vi.fn(),
    getEnabledCount: vi.fn(() => 0),
    dispose: vi.fn(),
    _registrations: registrations,
    _toolsEmitter: toolsEmitter,
  };
}

function makeToolSchemas(count: number): IMcpToolSchema[] {
  return Array.from({ length: count }, (_, i) => ({
    name: `tool_${i}`,
    description: `Tool ${i}`,
    inputSchema: { type: 'object', properties: {} },
  }));
}

// ─── Test Suite ────────────────────────────────────────────────────────────

describe('McpToolBridge', () => {
  let mcpClient: ReturnType<typeof createMockMcpClient>;
  let toolsService: ReturnType<typeof createMockToolsService>;
  let bridge: McpToolBridge;

  beforeEach(() => {
    mcpClient = createMockMcpClient();
    toolsService = createMockToolsService();
    bridge = new McpToolBridge(mcpClient as any, toolsService as any);
  });

  afterEach(() => {
    bridge.dispose();
    mcpClient._statusEmitter.dispose();
    mcpClient._notificationEmitter.dispose();
    toolsService._toolsEmitter.dispose();
  });

  // ─── refreshTools ──────────────────────────────────────────────

  it('refreshTools registers tools from server', async () => {
    mcpClient.listTools.mockResolvedValue(makeToolSchemas(3));
    await bridge.refreshTools('srv-1');
    expect(toolsService.registerTool).toHaveBeenCalledTimes(3);
  });

  it('refreshTools namespaces tool names as mcp__serverId__toolName', async () => {
    mcpClient.listTools.mockResolvedValue([{ name: 'read_file', description: 'Read', inputSchema: { type: 'object' } }]);
    await bridge.refreshTools('srv-1');
    const registeredTool = (toolsService.registerTool as ReturnType<typeof vi.fn>).mock.calls[0][0] as IChatTool;
    expect(registeredTool.name).toBe('mcp__srv-1__read_file');
  });

  it('refreshTools replaces old registrations', async () => {
    mcpClient.listTools.mockResolvedValue(makeToolSchemas(2));
    await bridge.refreshTools('srv-1');

    const oldRegistrations = toolsService._registrations.filter(r => r.tool.name.includes('srv-1'));

    mcpClient.listTools.mockResolvedValue(makeToolSchemas(1));
    await bridge.refreshTools('srv-1');

    // Old registrations should have been disposed
    for (const r of oldRegistrations) {
      expect(r.disposable.dispose).toHaveBeenCalled();
    }
  });

  // ─── removeTools ───────────────────────────────────────────────

  it('removeTools disposes registrations for server', async () => {
    mcpClient.listTools.mockResolvedValue(makeToolSchemas(2));
    await bridge.refreshTools('srv-1');

    const regs = toolsService._registrations.filter(r => r.tool.name.includes('srv-1'));
    bridge.removeTools('srv-1');
    for (const r of regs) {
      expect(r.disposable.dispose).toHaveBeenCalled();
    }
  });

  it('removeTools for unknown server is a no-op', () => {
    // Should not throw
    bridge.removeTools('no-such-server');
  });

  // ─── tool handler ─────────────────────────────────────────────

  it('tool handler calls mcpClient.callTool with correct args', async () => {
    mcpClient.listTools.mockResolvedValue(makeToolSchemas(1));
    mcpClient.callTool.mockResolvedValue({
      content: [{ type: 'text', text: 'result' }],
      isError: false,
    });
    await bridge.refreshTools('srv-1');

    const registeredTool = (toolsService.registerTool as ReturnType<typeof vi.fn>).mock.calls[0][0] as IChatTool;
    const result = await registeredTool.handler({ key: 'val' }, { isCancellationRequested: false, onCancellationRequested: vi.fn() } as any);

    expect(mcpClient.callTool).toHaveBeenCalledWith('srv-1', 'tool_0', { key: 'val' });
    expect(result.content).toBe('result');
  });

  it('tool handler formats text content by joining with newlines', async () => {
    mcpClient.listTools.mockResolvedValue(makeToolSchemas(1));
    mcpClient.callTool.mockResolvedValue({
      content: [
        { type: 'text', text: 'line1' },
        { type: 'text', text: 'line2' },
      ],
      isError: false,
    });
    await bridge.refreshTools('srv-1');

    const tool = (toolsService.registerTool as ReturnType<typeof vi.fn>).mock.calls[0][0] as IChatTool;
    const result = await tool.handler({}, { isCancellationRequested: false, onCancellationRequested: vi.fn() } as any);
    expect(result.content).toBe('line1\nline2');
  });

  it('tool handler returns "(no output)" for empty content', async () => {
    mcpClient.listTools.mockResolvedValue(makeToolSchemas(1));
    mcpClient.callTool.mockResolvedValue({
      content: [],
      isError: false,
    });
    await bridge.refreshTools('srv-1');

    const tool = (toolsService.registerTool as ReturnType<typeof vi.fn>).mock.calls[0][0] as IChatTool;
    const result = await tool.handler({}, { isCancellationRequested: false, onCancellationRequested: vi.fn() } as any);
    expect(result.content).toBe('(no output)');
  });

  it('tool handler propagates isError', async () => {
    mcpClient.listTools.mockResolvedValue(makeToolSchemas(1));
    mcpClient.callTool.mockResolvedValue({
      content: [{ type: 'text', text: 'error output' }],
      isError: true,
    });
    await bridge.refreshTools('srv-1');

    const tool = (toolsService.registerTool as ReturnType<typeof vi.fn>).mock.calls[0][0] as IChatTool;
    const result = await tool.handler({}, { isCancellationRequested: false, onCancellationRequested: vi.fn() } as any);
    expect(result.isError).toBe(true);
  });

  // ─── _createTool schema mapping ───────────────────────────────

  it('registered tool has correct metadata', async () => {
    mcpClient.listTools.mockResolvedValue([{
      name: 'my_tool',
      description: 'Does things',
      inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
    }]);
    await bridge.refreshTools('srv-1');

    const tool = (toolsService.registerTool as ReturnType<typeof vi.fn>).mock.calls[0][0] as IChatTool;
    expect(tool.name).toBe('mcp__srv-1__my_tool');
    expect(tool.description).toBe('Does things');
    expect(tool.source).toBe('mcp');
    expect(tool.ownerToolId).toBe('srv-1');
    expect(tool.permissionLevel).toBe('requires-approval');
    expect(tool.requiresConfirmation).toBe(false);
    expect(tool.parameters).toEqual({ type: 'object', properties: { path: { type: 'string' } } });
  });

  it('registered tool defaults description to empty string', async () => {
    mcpClient.listTools.mockResolvedValue([{
      name: 'no_desc',
      inputSchema: { type: 'object' },
    }]);
    await bridge.refreshTools('srv-1');

    const tool = (toolsService.registerTool as ReturnType<typeof vi.fn>).mock.calls[0][0] as IChatTool;
    expect(tool.description).toBe('');
  });

  // ─── dispose ───────────────────────────────────────────────────

  it('dispose cleans up all server registrations', async () => {
    mcpClient.listTools.mockResolvedValue(makeToolSchemas(2));
    await bridge.refreshTools('srv-1');

    mcpClient.listTools.mockResolvedValue(makeToolSchemas(1));
    await bridge.refreshTools('srv-2');

    const allRegs = [...toolsService._registrations];
    bridge.dispose();

    for (const r of allRegs) {
      expect(r.disposable.dispose).toHaveBeenCalled();
    }
  });

  // ─── auto-remove on disconnect ─────────────────────────────────

  it('auto-removes tools when server status changes to disconnected', async () => {
    mcpClient.listTools.mockResolvedValue(makeToolSchemas(2));
    await bridge.refreshTools('srv-1');

    const regs = toolsService._registrations.filter(r => r.tool.name.includes('srv-1'));
    // Simulate server disconnect
    mcpClient._statusEmitter.fire({ serverId: 'srv-1', status: 'disconnected' });

    for (const r of regs) {
      expect(r.disposable.dispose).toHaveBeenCalled();
    }
  });

  it('does not remove tools for non-disconnect status changes', async () => {
    mcpClient.listTools.mockResolvedValue(makeToolSchemas(1));
    await bridge.refreshTools('srv-1');

    const reg = toolsService._registrations[0];
    mcpClient._statusEmitter.fire({ serverId: 'srv-1', status: 'connecting' });

    expect(reg.disposable.dispose).not.toHaveBeenCalled();
  });

  // ─── D1b-6: notifications/tools/list_changed ────────────────

  it('refreshes tools when server sends notifications/tools/list_changed', async () => {
    mcpClient.listTools.mockResolvedValue(makeToolSchemas(2));
    await bridge.refreshTools('srv-1');

    // Update mock to return different tools
    mcpClient.listTools.mockResolvedValue(makeToolSchemas(3));

    // Simulate the notification
    mcpClient._notificationEmitter.fire({
      serverId: 'srv-1',
      method: 'notifications/tools/list_changed',
    });

    // refreshTools is async — wait for listTools to be called again
    await vi.waitFor(() => {
      // First call from initial refreshTools, second from notification-triggered refresh
      expect(mcpClient.listTools).toHaveBeenCalledTimes(2);
    });
  });

  it('ignores non-tool-change notifications', async () => {
    mcpClient.listTools.mockResolvedValue(makeToolSchemas(1));
    await bridge.refreshTools('srv-1');
    const callCount = (mcpClient.listTools as ReturnType<typeof vi.fn>).mock.calls.length;

    mcpClient._notificationEmitter.fire({
      serverId: 'srv-1',
      method: 'notifications/resources/list_changed',
    });

    // listTools should NOT be called again
    expect(mcpClient.listTools).toHaveBeenCalledTimes(callCount);
  });
});
