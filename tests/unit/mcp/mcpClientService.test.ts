// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { McpClientService } from '../../../src/openclaw/mcp/mcpClientService.js';
import { Emitter } from '../../../src/platform/events.js';
import type { IMcpTransport } from '../../../src/openclaw/mcp/mcpTransport.js';
import type { IMcpServerConfig, McpConnectionState, IJsonRpcResponse } from '../../../src/openclaw/mcp/mcpTypes.js';

// ─── Helpers ───────────────────────────────────────────────────────────────

function createMockTransport(): IMcpTransport & {
  _onMessage: Emitter<string>;
  _onClose: Emitter<number | null>;
  fireMessage: (data: string) => void;
  fireClose: (code: number | null) => void;
} {
  const _onMessage = new Emitter<string>();
  const _onClose = new Emitter<number | null>();
  return {
    status: 'disconnected' as McpConnectionState,
    connect: vi.fn(async function (this: any) { this.status = 'connected'; }),
    send: vi.fn(async () => {}),
    close: vi.fn(async function (this: any) { this.status = 'disconnected'; }),
    onMessage: _onMessage.event,
    onClose: _onClose.event,
    _onMessage,
    _onClose,
    fireMessage: (data: string) => _onMessage.fire(data),
    fireClose: (code: number | null) => _onClose.fire(code),
  };
}

function makeStdioConfig(id = 'srv-1'): IMcpServerConfig {
  return { id, name: 'Test', transport: 'stdio', command: 'node', args: ['server.js'], enabled: true };
}

function makeSseConfig(id = 'srv-sse'): IMcpServerConfig {
  return { id, name: 'SSE', transport: 'sse', url: 'http://localhost:3000', enabled: true };
}

function jsonRpcResponse(id: number, result?: unknown, error?: { code: number; message: string }): string {
  const res: IJsonRpcResponse = { jsonrpc: '2.0', id, result, error };
  return JSON.stringify(res);
}

// ─── Test Suite ────────────────────────────────────────────────────────────

describe('McpClientService', () => {
  let service: McpClientService;
  let mockTransport: ReturnType<typeof createMockTransport>;
  let createTransportSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    service = new McpClientService();
    mockTransport = createMockTransport();
    createTransportSpy = vi.spyOn(service as any, '_createTransport').mockReturnValue(mockTransport);
  });

  afterEach(() => {
    service.dispose();
    mockTransport._onMessage.dispose();
    mockTransport._onClose.dispose();
    createTransportSpy.mockRestore();
  });

  // Helper: connect and auto-respond to initialize handshake
  async function connectWithHandshake(config = makeStdioConfig()): Promise<void> {
    // The connect call will send an initialize request; auto-respond to it
    const connectPromise = service.connectServer(config);
    // Wait a tick for the request to be sent, then respond
    await vi.waitFor(() => {
      expect(mockTransport.send).toHaveBeenCalled();
    });
    // First send call is the initialize request
    const initCall = (mockTransport.send as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const initReq = JSON.parse(initCall);
    mockTransport.fireMessage(jsonRpcResponse(initReq.id, {
      protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'test' },
    }));
    await connectPromise;
  }

  // ─── connectServer ─────────────────────────────────────────────

  it('connectServer fires connecting then connected status', async () => {
    const statuses: McpConnectionState[] = [];
    service.onDidChangeStatus(({ status }) => statuses.push(status));

    await connectWithHandshake();

    expect(statuses).toContain('connecting');
    expect(statuses).toContain('connected');
    expect(statuses.indexOf('connecting')).toBeLessThan(statuses.indexOf('connected'));
  });

  it('connectServer calls transport.connect()', async () => {
    await connectWithHandshake();
    expect(mockTransport.connect).toHaveBeenCalledOnce();
  });

  it('connectServer sends initialize handshake', async () => {
    await connectWithHandshake();
    const sendCalls = (mockTransport.send as ReturnType<typeof vi.fn>).mock.calls;
    // First call = initialize request, second call = notifications/initialized
    expect(sendCalls.length).toBeGreaterThanOrEqual(2);
    const initReq = JSON.parse(sendCalls[0][0]);
    expect(initReq.method).toBe('initialize');
    expect(initReq.jsonrpc).toBe('2.0');
    const notif = JSON.parse(sendCalls[1][0]);
    expect(notif.method).toBe('notifications/initialized');
  });

  it('connectServer replaces existing server (disconnects old first)', async () => {
    await connectWithHandshake();
    const disconnectSpy = vi.spyOn(service, 'disconnectServer');

    // Create a fresh mock transport for the second connect
    const mockTransport2 = createMockTransport();
    createTransportSpy.mockReturnValue(mockTransport2);

    const connectPromise = service.connectServer(makeStdioConfig());
    await vi.waitFor(() => {
      expect(mockTransport2.send).toHaveBeenCalled();
    });
    const initCall = (mockTransport2.send as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const initReq = JSON.parse(initCall);
    mockTransport2.fireMessage(jsonRpcResponse(initReq.id, { protocolVersion: '2024-11-05', capabilities: {} }));
    await connectPromise;

    expect(disconnectSpy).toHaveBeenCalledWith('srv-1');
    mockTransport2._onMessage.dispose();
    mockTransport2._onClose.dispose();
  });

  it('connectServer transport failure rejects', async () => {
    (mockTransport.connect as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('spawn failed'));
    await expect(service.connectServer(makeStdioConfig())).rejects.toThrow('spawn failed');
  });

  // ─── disconnectServer ──────────────────────────────────────────

  it('disconnectServer cleans up and fires disconnected', async () => {
    await connectWithHandshake();
    const statuses: McpConnectionState[] = [];
    service.onDidChangeStatus(({ status }) => statuses.push(status));

    await service.disconnectServer('srv-1');
    expect(mockTransport.close).toHaveBeenCalled();
    expect(statuses).toContain('disconnected');
  });

  it('disconnectServer unknown server is a no-op', async () => {
    // Should not throw
    await service.disconnectServer('unknown-id');
  });

  // ─── getServerStatus ───────────────────────────────────────────

  it('getServerStatus returns transport status for connected server', async () => {
    await connectWithHandshake();
    expect(service.getServerStatus('srv-1')).toBe('connected');
  });

  it('getServerStatus returns disconnected for unknown server', () => {
    expect(service.getServerStatus('unknown')).toBe('disconnected');
  });

  // ─── getConnectedServers ───────────────────────────────────────

  it('getConnectedServers returns connected server ids', async () => {
    await connectWithHandshake();
    expect(service.getConnectedServers()).toContain('srv-1');
  });

  it('getConnectedServers is empty initially', () => {
    expect(service.getConnectedServers()).toHaveLength(0);
  });

  // ─── listTools ─────────────────────────────────────────────────

  it('listTools returns tools from response', async () => {
    await connectWithHandshake();
    const listPromise = service.listTools('srv-1');

    await vi.waitFor(() => {
      // The listTools call should have sent a second request after init+notif
      const calls = (mockTransport.send as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls.length).toBeGreaterThanOrEqual(3);
    });

    const sendCalls = (mockTransport.send as ReturnType<typeof vi.fn>).mock.calls;
    const listReq = JSON.parse(sendCalls[sendCalls.length - 1][0]);
    mockTransport.fireMessage(jsonRpcResponse(listReq.id, {
      tools: [{ name: 'read_file', description: 'Reads a file', inputSchema: { type: 'object' } }],
    }));

    const tools = await listPromise;
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('read_file');
  });

  it('listTools returns empty when response has no tools', async () => {
    await connectWithHandshake();
    const listPromise = service.listTools('srv-1');

    await vi.waitFor(() => {
      const calls = (mockTransport.send as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls.length).toBeGreaterThanOrEqual(3);
    });
    const sendCalls = (mockTransport.send as ReturnType<typeof vi.fn>).mock.calls;
    const req = JSON.parse(sendCalls[sendCalls.length - 1][0]);
    mockTransport.fireMessage(jsonRpcResponse(req.id, {}));

    const tools = await listPromise;
    expect(tools).toHaveLength(0);
  });

  it('listTools throws for unconnected server', async () => {
    await expect(service.listTools('srv-nope')).rejects.toThrow('not connected');
  });

  // ─── callTool ──────────────────────────────────────────────────

  it('callTool returns result from server', async () => {
    await connectWithHandshake();
    const callPromise = service.callTool('srv-1', 'read_file', { path: '/tmp/x' });

    await vi.waitFor(() => {
      const calls = (mockTransport.send as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls.length).toBeGreaterThanOrEqual(3);
    });
    const sendCalls = (mockTransport.send as ReturnType<typeof vi.fn>).mock.calls;
    const toolReq = JSON.parse(sendCalls[sendCalls.length - 1][0]);
    expect(toolReq.method).toBe('tools/call');
    mockTransport.fireMessage(jsonRpcResponse(toolReq.id, {
      content: [{ type: 'text', text: 'file contents here' }],
    }));

    const result = await callPromise;
    expect(result.content[0].text).toBe('file contents here');
  });

  it('callTool throws for unconnected server', async () => {
    await expect(service.callTool('srv-nope', 'tool', {})).rejects.toThrow('not connected');
  });

  // ─── Request timeout ──────────────────────────────────────────

  it('request times out after 30s', async () => {
    vi.useFakeTimers();
    try {
      await connectWithHandshake();

      const callPromise = service.callTool('srv-1', 'slow_tool', {});
      // Advance past the 30s timeout
      vi.advanceTimersByTime(30_001);

      await expect(callPromise).rejects.toThrow(/timed out/);
    } finally {
      vi.useRealTimers();
    }
  });

  // ─── Response correlation ─────────────────────────────────────

  it('correctly correlates interleaved responses', async () => {
    await connectWithHandshake();

    // Fire two tool calls
    const call1 = service.callTool('srv-1', 'tool_a', {});
    const call2 = service.callTool('srv-1', 'tool_b', {});

    await vi.waitFor(() => {
      const calls = (mockTransport.send as ReturnType<typeof vi.fn>).mock.calls;
      // init + notif + 2 tool calls = 4
      expect(calls.length).toBeGreaterThanOrEqual(4);
    });

    const sendCalls = (mockTransport.send as ReturnType<typeof vi.fn>).mock.calls;
    const req1 = JSON.parse(sendCalls[sendCalls.length - 2][0]);
    const req2 = JSON.parse(sendCalls[sendCalls.length - 1][0]);

    // Respond in reverse order
    mockTransport.fireMessage(jsonRpcResponse(req2.id, {
      content: [{ type: 'text', text: 'result_b' }],
    }));
    mockTransport.fireMessage(jsonRpcResponse(req1.id, {
      content: [{ type: 'text', text: 'result_a' }],
    }));

    const result1 = await call1;
    const result2 = await call2;
    expect(result1.content[0].text).toBe('result_a');
    expect(result2.content[0].text).toBe('result_b');
  });

  // ─── _handleMessage edge cases ────────────────────────────────

  it('_handleMessage ignores invalid JSON', async () => {
    await connectWithHandshake();
    // Should not throw
    mockTransport.fireMessage('this is not json{{{');
  });

  it('_handleMessage ignores notifications (no id)', async () => {
    await connectWithHandshake();
    mockTransport.fireMessage(JSON.stringify({ jsonrpc: '2.0', method: 'some/notification' }));
    // No crash, no pending resolution
  });

  it('_handleMessage ignores wrong jsonrpc version', async () => {
    await connectWithHandshake();
    mockTransport.fireMessage(JSON.stringify({ jsonrpc: '1.0', id: 999, result: 'bad' }));
    // Should be ignored
  });

  it('_handleMessage rejects pending on error response', async () => {
    await connectWithHandshake();
    const callPromise = service.callTool('srv-1', 'fail_tool', {});

    await vi.waitFor(() => {
      const calls = (mockTransport.send as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls.length).toBeGreaterThanOrEqual(3);
    });
    const sendCalls = (mockTransport.send as ReturnType<typeof vi.fn>).mock.calls;
    const req = JSON.parse(sendCalls[sendCalls.length - 1][0]);

    mockTransport.fireMessage(jsonRpcResponse(req.id, undefined, { code: -32000, message: 'tool failed' }));
    await expect(callPromise).rejects.toThrow('MCP error -32000: tool failed');
  });

  // ─── _rejectPendingForServer on disconnect ─────────────────────

  it('pending requests are rejected when server disconnects externally', async () => {
    await connectWithHandshake();
    const callPromise = service.callTool('srv-1', 'slow', {});

    // Simulate unexpected close from transport
    mockTransport.fireClose(1);

    await expect(callPromise).rejects.toThrow(/disconnected/);
  });

  // ─── dispose ───────────────────────────────────────────────────

  it('dispose disconnects all servers', async () => {
    await connectWithHandshake();
    const disconnectSpy = vi.spyOn(service, 'disconnectServer');

    service.dispose();
    expect(disconnectSpy).toHaveBeenCalledWith('srv-1');
  });

  // ─── _createTransport ─────────────────────────────────────────

  it('_createTransport throws for unsupported transport type', () => {
    createTransportSpy.mockRestore(); // Use the real method
    expect(() => (service as any)._createTransport(makeSseConfig())).toThrow(/Unsupported transport/);
  });

  it('_createTransport throws for stdio without command', () => {
    createTransportSpy.mockRestore();
    const cfg: IMcpServerConfig = { id: 's', name: 'S', transport: 'stdio', enabled: true };
    expect(() => (service as any)._createTransport(cfg)).toThrow(/requires a command/);
  });

  it('_createTransport returns McpStdioTransport for valid stdio config', () => {
    createTransportSpy.mockRestore();
    const transport = (service as any)._createTransport(makeStdioConfig());
    expect(transport).toBeDefined();
    expect(transport.status).toBe('disconnected');
  });
});
