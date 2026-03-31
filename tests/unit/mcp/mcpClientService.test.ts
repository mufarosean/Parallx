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

  it('_handleMessage emits notification event for messages with method but no id', async () => {
    await connectWithHandshake();
    const notifications: Array<{ method: string }> = [];
    service.onDidReceiveNotification((n) => notifications.push(n));
    mockTransport.fireMessage(JSON.stringify({ jsonrpc: '2.0', method: 'some/notification' }));
    expect(notifications).toHaveLength(1);
    expect(notifications[0].method).toBe('some/notification');
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

  // ─── D1b-1: Server ping request handling ──────────────────────

  it('responds to server ping request with { result: {} }', async () => {
    await connectWithHandshake();

    // Server sends a ping request (has id AND method)
    const serverPing = JSON.stringify({ jsonrpc: '2.0', id: 42, method: 'ping' });
    mockTransport.fireMessage(serverPing);

    // The service should have sent a response via transport.send
    await vi.waitFor(() => {
      const calls = (mockTransport.send as ReturnType<typeof vi.fn>).mock.calls;
      // init + notif + ping response = 3+
      const lastCall = calls[calls.length - 1][0];
      expect(lastCall).toContain('"id":42');
    });

    const calls = (mockTransport.send as ReturnType<typeof vi.fn>).mock.calls;
    const pingResponse = JSON.parse(calls[calls.length - 1][0]);
    expect(pingResponse.jsonrpc).toBe('2.0');
    expect(pingResponse.id).toBe(42);
    expect(pingResponse.result).toEqual({});
    expect(pingResponse.error).toBeUndefined();
  });

  it('responds to server ping with string id', async () => {
    await connectWithHandshake();

    const serverPing = JSON.stringify({ jsonrpc: '2.0', id: 'abc-123', method: 'ping' });
    mockTransport.fireMessage(serverPing);

    await vi.waitFor(() => {
      const calls = (mockTransport.send as ReturnType<typeof vi.fn>).mock.calls;
      const lastCall = calls[calls.length - 1][0];
      expect(lastCall).toContain('"abc-123"');
    });

    const calls = (mockTransport.send as ReturnType<typeof vi.fn>).mock.calls;
    const response = JSON.parse(calls[calls.length - 1][0]);
    expect(response.id).toBe('abc-123');
    expect(response.result).toEqual({});
  });

  // ─── D1b-2: Unknown server request handling ───────────────────

  it('responds to unknown server request with method-not-found error', async () => {
    await connectWithHandshake();

    const unknownReq = JSON.stringify({ jsonrpc: '2.0', id: 99, method: 'unknown/method', params: {} });
    mockTransport.fireMessage(unknownReq);

    await vi.waitFor(() => {
      const calls = (mockTransport.send as ReturnType<typeof vi.fn>).mock.calls;
      const lastCall = calls[calls.length - 1][0];
      expect(lastCall).toContain('"id":99');
    });

    const calls = (mockTransport.send as ReturnType<typeof vi.fn>).mock.calls;
    const response = JSON.parse(calls[calls.length - 1][0]);
    expect(response.error).toBeDefined();
    expect(response.error.code).toBe(-32601);
    expect(response.error.message).toContain('unknown/method');
  });

  // ─── D1b-3: Outbound ping ────────────────────────────────────

  it('ping() sends ping request and returns latency', async () => {
    await connectWithHandshake();

    const pingPromise = service.ping('srv-1');

    // Wait for the ping request to be sent
    await vi.waitFor(() => {
      const calls = (mockTransport.send as ReturnType<typeof vi.fn>).mock.calls;
      const lastCall = calls[calls.length - 1][0];
      expect(lastCall).toContain('"method":"ping"');
    });

    // Respond to the ping
    const calls = (mockTransport.send as ReturnType<typeof vi.fn>).mock.calls;
    const pingReq = JSON.parse(calls[calls.length - 1][0]);
    mockTransport.fireMessage(jsonRpcResponse(pingReq.id, {}));

    const latency = await pingPromise;
    expect(latency).toBeGreaterThanOrEqual(0);
  });

  it('ping() throws for unconnected server', async () => {
    await expect(service.ping('not-connected')).rejects.toThrow('not connected');
  });

  it('ping() rejects on timeout (5s)', async () => {
    vi.useFakeTimers();
    try {
      await connectWithHandshake();

      const pingPromise = service.ping('srv-1');
      // Advance past the 5s ping timeout
      vi.advanceTimersByTime(5_001);

      await expect(pingPromise).rejects.toThrow(/timed out/);
    } finally {
      vi.useRealTimers();
    }
  });

  // ─── D1b-3: Health monitor timer ──────────────────────────────

  it('health monitor sends periodic pings', async () => {
    vi.useFakeTimers();
    try {
      await connectWithHandshake();

      // At connection, health monitor is started (30s interval)
      // The initial connect sends: init request + notif = 2 calls
      const initialCalls = (mockTransport.send as ReturnType<typeof vi.fn>).mock.calls.length;

      // Advance 30s — health monitor should fire a ping
      vi.advanceTimersByTime(30_000);

      await vi.waitFor(() => {
        const calls = (mockTransport.send as ReturnType<typeof vi.fn>).mock.calls;
        expect(calls.length).toBeGreaterThan(initialCalls);
      });

      const calls = (mockTransport.send as ReturnType<typeof vi.fn>).mock.calls;
      const lastReq = JSON.parse(calls[calls.length - 1][0]);
      expect(lastReq.method).toBe('ping');
    } finally {
      vi.useRealTimers();
    }
  });

  // ─── D1b-4: Health info tracking ──────────────────────────────

  it('getHealthInfo returns initial state after connect', async () => {
    await connectWithHandshake();
    const health = service.getHealthInfo('srv-1');
    expect(health).toBeDefined();
    expect(health!.lastPingAt).toBeNull();
    expect(health!.lastPingLatencyMs).toBeNull();
    expect(health!.consecutiveFailures).toBe(0);
    expect(health!.isHealthy).toBe(true);
  });

  it('getHealthInfo returns undefined for unknown server', () => {
    expect(service.getHealthInfo('unknown')).toBeUndefined();
  });

  it('ping() updates health info on success', async () => {
    await connectWithHandshake();

    const pingPromise = service.ping('srv-1');
    await vi.waitFor(() => {
      const calls = (mockTransport.send as ReturnType<typeof vi.fn>).mock.calls;
      const lastCall = calls[calls.length - 1][0];
      expect(lastCall).toContain('"method":"ping"');
    });
    const calls = (mockTransport.send as ReturnType<typeof vi.fn>).mock.calls;
    const req = JSON.parse(calls[calls.length - 1][0]);
    mockTransport.fireMessage(jsonRpcResponse(req.id, {}));
    await pingPromise;

    const health = service.getHealthInfo('srv-1');
    expect(health!.lastPingAt).toBeGreaterThan(0);
    expect(health!.lastPingLatencyMs).toBeGreaterThanOrEqual(0);
    expect(health!.consecutiveFailures).toBe(0);
    expect(health!.isHealthy).toBe(true);
  });

  // ─── D1b-6: Notification events ──────────────────────────────

  it('onDidReceiveNotification fires for server notifications', async () => {
    await connectWithHandshake();

    const notifications: Array<{ serverId: string; method: string }> = [];
    service.onDidReceiveNotification((n) => notifications.push(n));

    // Server sends a notification (has method, no id)
    mockTransport.fireMessage(JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/tools/list_changed',
    }));

    expect(notifications).toHaveLength(1);
    expect(notifications[0].serverId).toBe('srv-1');
    expect(notifications[0].method).toBe('notifications/tools/list_changed');
  });

  it('notifications do not resolve pending requests', async () => {
    await connectWithHandshake();

    // Start a tool call
    const callPromise = service.callTool('srv-1', 'my_tool', {});
    await vi.waitFor(() => {
      const calls = (mockTransport.send as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls.length).toBeGreaterThanOrEqual(3);
    });

    // Send a notification — should NOT resolve the pending call
    mockTransport.fireMessage(JSON.stringify({
      jsonrpc: '2.0',
      method: 'some/notification',
    }));

    // The tool call should still be pending (not resolved by the notification)
    // Resolve it properly
    const sendCalls = (mockTransport.send as ReturnType<typeof vi.fn>).mock.calls;
    const toolReq = JSON.parse(sendCalls[sendCalls.length - 1][0]);
    mockTransport.fireMessage(jsonRpcResponse(toolReq.id, { content: [{ type: 'text', text: 'ok' }] }));

    const result = await callPromise;
    expect(result.content[0].text).toBe('ok');
  });

  // ─── D1b-7: Edge case refinements ─────────────────────────────

  it('ping() rejects during reconnecting state', async () => {
    vi.useFakeTimers();
    try {
      await connectWithHandshake();

      // Make reconnect attempts fail so we stay in reconnecting state
      createTransportSpy.mockImplementation(() => {
        const fail = createMockTransport();
        fail.connect = vi.fn(async () => { throw new Error('refused'); });
        return fail;
      });

      // Trigger unexpected close — entry stays in map as reconnecting
      mockTransport.fireClose(1);

      // ping should fail because server is reconnecting  
      await expect(service.ping('srv-1')).rejects.toThrow('reconnecting');
    } finally {
      vi.useRealTimers();
    }
  });

  it('health monitor stops during reconnect and restarts after success', async () => {
    vi.useFakeTimers();
    try {
      await connectWithHandshake();

      const initialSendCount = (mockTransport.send as ReturnType<typeof vi.fn>).mock.calls.length;

      // Advance 30s — health monitor should have fired
      vi.advanceTimersByTime(30_001);
      await vi.waitFor(() => {
        expect((mockTransport.send as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(initialSendCount);
      });

      // Now trigger unexpected close
      const mockTransport2 = createMockTransport();
      createTransportSpy.mockReturnValue(mockTransport2);
      mockTransport.fireClose(1);

      // Old transport shouldn't get more pings (health monitor stopped)
      const afterCloseSendCount = (mockTransport.send as ReturnType<typeof vi.fn>).mock.calls.length;
      vi.advanceTimersByTime(30_001);
      expect((mockTransport.send as ReturnType<typeof vi.fn>).mock.calls.length).toBe(afterCloseSendCount);

      mockTransport2._onMessage.dispose();
      mockTransport2._onClose.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  // ─── D1b-5: Reconnection ────────────────────────────────────

  it('auto-reconnects on unexpected close', async () => {
    vi.useFakeTimers();
    try {
      await connectWithHandshake();
      const statuses: McpConnectionState[] = [];
      service.onDidChangeStatus(({ status }) => statuses.push(status));

      // Create a fresh transport for the reconnect attempt
      const mockTransport2 = createMockTransport();
      createTransportSpy.mockReturnValue(mockTransport2);

      // Simulate unexpected close
      mockTransport.fireClose(1);

      // Should fire reconnecting status
      expect(statuses).toContain('reconnecting');

      // Advance past the reconnect delay (1s base * 2^0 = 1s)
      vi.advanceTimersByTime(1_001);

      // Wait for reconnect attempt (connectServer is async)
      await vi.waitFor(() => {
        expect(mockTransport2.connect).toHaveBeenCalled();
      });

      // Respond to the handshake
      await vi.waitFor(() => {
        expect(mockTransport2.send).toHaveBeenCalled();
      });
      const initCall = (mockTransport2.send as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const initReq = JSON.parse(initCall);
      mockTransport2.fireMessage(jsonRpcResponse(initReq.id, {
        protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'test' },
      }));

      await vi.waitFor(() => {
        expect(statuses).toContain('connected');
      });

      mockTransport2._onMessage.dispose();
      mockTransport2._onClose.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('manual disconnect does NOT auto-reconnect', async () => {
    vi.useFakeTimers();
    try {
      await connectWithHandshake();
      const statuses: McpConnectionState[] = [];
      service.onDidChangeStatus(({ status }) => statuses.push(status));

      await service.disconnectServer('srv-1');

      // Should fire disconnected, NOT reconnecting
      expect(statuses).toContain('disconnected');
      expect(statuses).not.toContain('reconnecting');

      // Advance time — no reconnect should happen
      vi.advanceTimersByTime(60_000);
      expect(statuses).not.toContain('connecting');
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives up after maxReconnectAttempts', async () => {
    vi.useFakeTimers();
    try {
      const config = { ...makeStdioConfig(), autoReconnect: true, maxReconnectAttempts: 2 };
      // Connect initially
      const connectPromise = service.connectServer(config);
      await vi.waitFor(() => { expect(mockTransport.send).toHaveBeenCalled(); });
      const initCall = (mockTransport.send as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const initReq = JSON.parse(initCall);
      mockTransport.fireMessage(jsonRpcResponse(initReq.id, {
        protocolVersion: '2024-11-05', capabilities: {},
      }));
      await connectPromise;

      const statuses: McpConnectionState[] = [];
      service.onDidChangeStatus(({ status }) => statuses.push(status));

      // Make all reconnect attempts fail
      createTransportSpy.mockImplementation(() => {
        const failTransport = createMockTransport();
        failTransport.connect = vi.fn(async () => { throw new Error('connection refused'); });
        return failTransport;
      });

      // Unexpected close
      mockTransport.fireClose(1);
      expect(statuses).toContain('reconnecting');

      // Attempt 1: delay = 1s
      vi.advanceTimersByTime(1_001);
      await vi.advanceTimersByTimeAsync(10);
      // Attempt 2: delay = 2s
      vi.advanceTimersByTime(2_001);
      await vi.advanceTimersByTimeAsync(10);

      // After max attempts, should fire error
      await vi.waitFor(() => {
        expect(statuses).toContain('error');
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('respects autoReconnect: false config', async () => {
    const config = { ...makeStdioConfig(), autoReconnect: false };
    const connectPromise = service.connectServer(config);
    await vi.waitFor(() => { expect(mockTransport.send).toHaveBeenCalled(); });
    const initCall = (mockTransport.send as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const initReq = JSON.parse(initCall);
    mockTransport.fireMessage(jsonRpcResponse(initReq.id, {
      protocolVersion: '2024-11-05', capabilities: {},
    }));
    await connectPromise;

    const statuses: McpConnectionState[] = [];
    service.onDidChangeStatus(({ status }) => statuses.push(status));

    // Unexpected close
    mockTransport.fireClose(1);

    // Should disconnect, not reconnect
    expect(statuses).toContain('disconnected');
    expect(statuses).not.toContain('reconnecting');
  });

  // ─── Server Config Persistence ────────────────────────────────

  describe('server config persistence', () => {
    function createMockStorage(data: Record<string, string> = {}): { get: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> } {
      const store = { ...data };
      return {
        get: vi.fn(async (key: string) => store[key] ?? null),
        set: vi.fn(async (key: string, value: string) => { store[key] = value; }),
        remove: vi.fn(async (key: string) => { delete store[key]; }),
      };
    }

    it('seeds default servers on first run (no stored config)', async () => {
      const storage = createMockStorage();
      await service.initStorage(storage as any);

      const servers = service.getConfiguredServers();
      expect(servers.length).toBe(1);
      expect(servers[0].id).toBe('everything');
      expect(servers[0].enabled).toBe(true);
      // Should have persisted the defaults
      expect(storage.set).toHaveBeenCalledWith('mcp.servers', expect.any(String));
    });

    it('loads stored servers instead of defaults', async () => {
      const stored = [{ id: 'custom', name: 'Custom', transport: 'stdio', command: 'node', args: [], enabled: true }];
      const storage = createMockStorage({ 'mcp.servers': JSON.stringify(stored) });
      await service.initStorage(storage as any);

      const servers = service.getConfiguredServers();
      expect(servers.length).toBe(1);
      expect(servers[0].id).toBe('custom');
    });

    it('seeds defaults when stored value is empty array', async () => {
      const storage = createMockStorage({ 'mcp.servers': JSON.stringify([]) });
      await service.initStorage(storage as any);

      const servers = service.getConfiguredServers();
      expect(servers.length).toBe(1);
      expect(servers[0].id).toBe('everything');
    });

    it('addServerConfig upserts and persists', async () => {
      const storage = createMockStorage();
      await service.initStorage(storage as any);

      const newServer: IMcpServerConfig = { id: 'new-srv', name: 'New', transport: 'sse', url: 'http://localhost:8080', enabled: true };
      await service.addServerConfig(newServer);

      const servers = service.getConfiguredServers();
      expect(servers.find(s => s.id === 'new-srv')).toBeDefined();
      // Persisted
      expect(storage.set).toHaveBeenCalledWith('mcp.servers', expect.stringContaining('new-srv'));
    });

    it('addServerConfig replaces existing server with same ID', async () => {
      const storage = createMockStorage();
      await service.initStorage(storage as any);

      const updated = { id: 'everything', name: 'Updated', transport: 'stdio' as const, command: 'npx', args: [], enabled: false };
      await service.addServerConfig(updated);

      const servers = service.getConfiguredServers();
      const match = servers.find(s => s.id === 'everything');
      expect(match?.name).toBe('Updated');
      expect(match?.enabled).toBe(false);
      expect(servers.length).toBe(1); // no duplicate
    });

    it('removeServerConfig removes and persists', async () => {
      const storage = createMockStorage();
      await service.initStorage(storage as any);
      expect(service.getConfiguredServers().length).toBe(1);

      await service.removeServerConfig('everything');

      expect(service.getConfiguredServers().length).toBe(0);
      expect(storage.set).toHaveBeenCalledWith('mcp.servers', '[]');
    });

    it('getConfiguredServers returns empty array when no storage initialized', () => {
      // No initStorage called
      expect(service.getConfiguredServers()).toEqual([]);
    });
  });
});
