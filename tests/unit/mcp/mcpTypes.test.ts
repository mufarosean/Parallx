import { describe, it, expect } from 'vitest';
import type {
  IJsonRpcRequest,
  IJsonRpcResponse,
  IJsonRpcError,
  IJsonRpcNotification,
  IMcpToolSchema,
  IMcpToolCallResult,
  IMcpToolCallResultContent,
  IMcpToolCallParams,
  IMcpInitializeParams,
  IMcpInitializeResult,
  IMcpServerConfig,
  McpConnectionState,
  McpTransportType,
} from '../../../src/openclaw/mcp/mcpTypes.js';

// Type-level tests: verify assignability at runtime by constructing conforming objects.

describe('mcpTypes — type assignability', () => {
  it('IJsonRpcRequest accepts a valid request object', () => {
    const req: IJsonRpcRequest = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: { cursor: 'abc' } };
    expect(req.jsonrpc).toBe('2.0');
    expect(req.method).toBe('tools/list');
  });

  it('IJsonRpcResponse with result', () => {
    const res: IJsonRpcResponse = { jsonrpc: '2.0', id: 1, result: { tools: [] } };
    expect(res.id).toBe(1);
    expect(res.error).toBeUndefined();
  });

  it('IJsonRpcResponse with error', () => {
    const err: IJsonRpcError = { code: -32600, message: 'Invalid Request' };
    const res: IJsonRpcResponse = { jsonrpc: '2.0', id: 2, error: err };
    expect(res.error?.code).toBe(-32600);
  });

  it('IJsonRpcNotification has no id', () => {
    const notif: IJsonRpcNotification = { jsonrpc: '2.0', method: 'notifications/initialized', params: {} };
    expect(notif.method).toBe('notifications/initialized');
    expect((notif as any).id).toBeUndefined();
  });

  it('IMcpToolSchema accepts valid schema', () => {
    const schema: IMcpToolSchema = { name: 'read_file', description: 'Read a file', inputSchema: { type: 'object', properties: { path: { type: 'string' } } } };
    expect(schema.name).toBe('read_file');
  });

  it('IMcpToolCallResult with text content', () => {
    const content: IMcpToolCallResultContent = { type: 'text', text: 'hello' };
    const result: IMcpToolCallResult = { content: [content], isError: false };
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
  });

  it('IMcpToolCallParams accepts valid params', () => {
    const params: IMcpToolCallParams = { name: 'read_file', arguments: { path: '/tmp/test' } };
    expect(params.name).toBe('read_file');
  });

  it('IMcpInitializeParams accepts valid handshake', () => {
    const init: IMcpInitializeParams = {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'Parallx', version: '1.0.0' },
    };
    expect(init.protocolVersion).toBe('2024-11-05');
  });

  it('IMcpServerConfig accepts stdio config', () => {
    const cfg: IMcpServerConfig = {
      id: 'srv-1', name: 'Test Server', transport: 'stdio',
      command: 'node', args: ['server.js'], enabled: true,
    };
    expect(cfg.transport).toBe('stdio');
  });

  it('IMcpServerConfig accepts sse config with url', () => {
    const cfg: IMcpServerConfig = {
      id: 'srv-2', name: 'Remote Server', transport: 'sse',
      url: 'http://localhost:3000/sse', enabled: true,
    };
    expect(cfg.transport).toBe('sse');
    expect(cfg.url).toBeTruthy();
  });

  it('McpConnectionState union covers all states', () => {
    const states: McpConnectionState[] = ['disconnected', 'connecting', 'connected', 'error'];
    expect(states).toHaveLength(4);
  });

  it('McpTransportType union covers stdio and sse', () => {
    const types: McpTransportType[] = ['stdio', 'sse'];
    expect(types).toHaveLength(2);
  });
});
