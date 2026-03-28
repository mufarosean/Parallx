// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// `electronApi` in mcpTransport.ts is captured at module-load time from
// `window.parallxElectron`. We must set up the mock BEFORE importing
// the module, and use `vi.resetModules()` so each test gets a fresh capture.

type MessageCallback = (serverId: string, data: string) => void;
type ExitCallback = (serverId: string, code: number | null) => void;

function createMockElectronApi() {
  let messageCallback: MessageCallback | undefined;
  let exitCallback: ExitCallback | undefined;

  return {
    mcp: {
      spawn: vi.fn(async () => ({ error: null })),
      send: vi.fn(async () => {}),
      kill: vi.fn(async () => {}),
      onMessage: vi.fn((cb: MessageCallback) => {
        messageCallback = cb;
        return () => { messageCallback = undefined; };
      }),
      onExit: vi.fn((cb: ExitCallback) => {
        exitCallback = cb;
        return () => { exitCallback = undefined; };
      }),
    },
    _fireMessage: (serverId: string, data: string) => messageCallback?.(serverId, data),
    _fireExit: (serverId: string, code: number | null) => exitCallback?.(serverId, code),
  };
}

describe('McpStdioTransport', () => {
  let mockApi: ReturnType<typeof createMockElectronApi>;
  let McpStdioTransport: typeof import('../../../src/openclaw/mcp/mcpTransport.js').McpStdioTransport;
  let savedElectron: any;

  beforeEach(async () => {
    vi.resetModules();
    mockApi = createMockElectronApi();
    savedElectron = (window as any).parallxElectron;
    (window as any).parallxElectron = mockApi;
    // Dynamic import AFTER window.parallxElectron is set
    const mod = await import('../../../src/openclaw/mcp/mcpTransport.js');
    McpStdioTransport = mod.McpStdioTransport;
  });

  afterEach(() => {
    (window as any).parallxElectron = savedElectron;
  });

  // ─── Initial state ─────────────────────────────────────────────

  it('initial status is disconnected', () => {
    const transport = new McpStdioTransport('srv-1', 'node', ['server.js']);
    expect(transport.status).toBe('disconnected');
  });

  // ─── connect ───────────────────────────────────────────────────

  it('connect without Electron API throws', async () => {
    // Re-import with no electronApi
    vi.resetModules();
    (window as any).parallxElectron = undefined;
    const mod = await import('../../../src/openclaw/mcp/mcpTransport.js');
    const transport = new mod.McpStdioTransport('srv-1', 'node', ['server.js']);
    await expect(transport.connect()).rejects.toThrow('MCP IPC bridge not available');
  });

  it('connect transitions to connected on success', async () => {
    const transport = new McpStdioTransport('srv-1', 'node', ['server.js']);
    await transport.connect();
    expect(transport.status).toBe('connected');
    expect(mockApi.mcp.spawn).toHaveBeenCalledWith('srv-1', 'node', ['server.js'], {});
  });

  it('connect passes env to spawn', async () => {
    const env = { NODE_ENV: 'test' };
    const transport = new McpStdioTransport('srv-1', 'node', ['server.js'], env);
    await transport.connect();
    expect(mockApi.mcp.spawn).toHaveBeenCalledWith('srv-1', 'node', ['server.js'], env);
  });

  it('connect transitions to error on spawn failure', async () => {
    mockApi.mcp.spawn.mockResolvedValue({ error: 'ENOENT' });
    const transport = new McpStdioTransport('srv-1', 'node', ['server.js']);
    await expect(transport.connect()).rejects.toThrow('MCP spawn failed: ENOENT');
    expect(transport.status).toBe('error');
  });

  // ─── send ──────────────────────────────────────────────────────

  it('send delegates to IPC bridge', async () => {
    const transport = new McpStdioTransport('srv-1', 'node', ['server.js']);
    await transport.connect();
    await transport.send('{"jsonrpc":"2.0","id":1,"method":"test"}');
    expect(mockApi.mcp.send).toHaveBeenCalledWith('srv-1', '{"jsonrpc":"2.0","id":1,"method":"test"}');
  });

  it('send throws without Electron API', async () => {
    // Re-import with no electronApi so send() sees the guard
    vi.resetModules();
    (window as any).parallxElectron = undefined;
    const mod = await import('../../../src/openclaw/mcp/mcpTransport.js');
    const transport = new mod.McpStdioTransport('srv-1', 'node', ['server.js']);
    // Manually force status past connect (since connect would also throw)
    (transport as any)._status = 'connected';
    await expect(transport.send('test')).rejects.toThrow('MCP IPC bridge not available');
  });

  // ─── onMessage ─────────────────────────────────────────────────

  it('onMessage fires for matching serverId', async () => {
    const transport = new McpStdioTransport('srv-1', 'node', ['server.js']);
    const messages: string[] = [];
    transport.onMessage((data) => messages.push(data));

    await transport.connect();
    mockApi._fireMessage('srv-1', '{"jsonrpc":"2.0","id":1,"result":"ok"}');
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('"result":"ok"');
  });

  it('onMessage does not fire for different serverId', async () => {
    const transport = new McpStdioTransport('srv-1', 'node', ['server.js']);
    const messages: string[] = [];
    transport.onMessage((data) => messages.push(data));

    await transport.connect();
    mockApi._fireMessage('srv-OTHER', '{"jsonrpc":"2.0","id":1,"result":"ok"}');
    expect(messages).toHaveLength(0);
  });

  // ─── onClose / close ──────────────────────────────────────────

  it('onClose fires when process exits', async () => {
    const transport = new McpStdioTransport('srv-1', 'node', ['server.js']);
    const codes: (number | null)[] = [];
    transport.onClose((code) => codes.push(code));

    await transport.connect();
    mockApi._fireExit('srv-1', 1);
    expect(codes).toEqual([1]);
    expect(transport.status).toBe('disconnected');
  });

  it('close transitions to disconnected and calls kill', async () => {
    const transport = new McpStdioTransport('srv-1', 'node', ['server.js']);
    await transport.connect();
    expect(transport.status).toBe('connected');

    await transport.close();
    expect(transport.status).toBe('disconnected');
    expect(mockApi.mcp.kill).toHaveBeenCalledWith('srv-1');
  });

  it('close calls unsub and kill', async () => {
    const transport = new McpStdioTransport('srv-1', 'node', ['server.js']);
    await transport.connect();

    expect(mockApi.mcp.onMessage).toHaveBeenCalledOnce();
    expect(mockApi.mcp.onExit).toHaveBeenCalledOnce();

    await transport.close();
    expect(mockApi.mcp.kill).toHaveBeenCalledWith('srv-1');
  });
});
