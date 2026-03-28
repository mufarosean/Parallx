// mcpClientService.ts — MCP Client Service implementation (D1)
//
// Manages MCP server connections, JSON-RPC correlation, tool listing, and tool calling.
// Each server gets its own transport instance. Requests use a monotonic ID counter
// with a pending-promise map for correlation. 30s timeout per request.

import { Emitter } from '../../platform/events.js';
import { Disposable } from '../../platform/lifecycle.js';
import type { IDisposable } from '../../platform/lifecycle.js';
import type { Event } from '../../platform/events.js';
import type { IMcpClientService } from '../../services/serviceTypes.js';
import type { IMcpServerConfig, IMcpToolSchema, IMcpToolCallResult, McpConnectionState, IJsonRpcRequest, IJsonRpcResponse } from './mcpTypes.js';
import { McpStdioTransport, type IMcpTransport } from './mcpTransport.js';

const REQUEST_TIMEOUT_MS = 30_000;

interface IServerEntry {
  config: IMcpServerConfig;
  transport: IMcpTransport;
  tools: IMcpToolSchema[];
  subscriptions: IDisposable[];
  pendingIds: Set<number>;
}

interface IPendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class McpClientService extends Disposable implements IMcpClientService {
  private readonly _servers = new Map<string, IServerEntry>();
  private readonly _pending = new Map<number, IPendingRequest>();
  private _nextId = 1;

  private readonly _onDidChangeStatus = new Emitter<{ serverId: string; status: McpConnectionState }>();
  readonly onDidChangeStatus: Event<{ serverId: string; status: McpConnectionState }> = this._onDidChangeStatus.event;

  async connectServer(config: IMcpServerConfig): Promise<void> {
    if (this._servers.has(config.id)) {
      await this.disconnectServer(config.id);
    }

    const transport = this._createTransport(config);
    const subscriptions: IDisposable[] = [];

    subscriptions.push(
      transport.onMessage((data) => this._handleMessage(config.id, data)),
    );
    subscriptions.push(
      transport.onClose(() => this._handleClose(config.id)),
    );

    const entry: IServerEntry = { config, transport, tools: [], subscriptions, pendingIds: new Set() };
    this._servers.set(config.id, entry);

    this._onDidChangeStatus.fire({ serverId: config.id, status: 'connecting' });

    await transport.connect();
    this._onDidChangeStatus.fire({ serverId: config.id, status: 'connected' });

    // MCP initialize handshake
    await this._sendRequest(config.id, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'Parallx', version: '1.0.0' },
    });

    // Send initialized notification (no response expected)
    const notification = JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    });
    await transport.send(notification);
  }

  async disconnectServer(serverId: string): Promise<void> {
    const entry = this._servers.get(serverId);
    if (!entry) return;

    // Remove entry first to prevent _handleClose from double-firing (R-05)
    this._servers.delete(serverId);
    for (const sub of entry.subscriptions) sub.dispose();

    // Reject pending before closing transport (R-06)
    this._rejectPendingForServer(serverId, entry);
    await entry.transport.close();

    this._onDidChangeStatus.fire({ serverId, status: 'disconnected' });
  }

  getServerStatus(serverId: string): McpConnectionState {
    const entry = this._servers.get(serverId);
    return entry?.transport.status ?? 'disconnected';
  }

  getConnectedServers(): readonly string[] {
    const result: string[] = [];
    for (const [id, entry] of this._servers) {
      if (entry.transport.status === 'connected') result.push(id);
    }
    return result;
  }

  async listTools(serverId: string): Promise<readonly IMcpToolSchema[]> {
    const entry = this._servers.get(serverId);
    if (!entry) throw new Error(`Server ${serverId} not connected`);

    const result = await this._sendRequest(serverId, 'tools/list', {}) as { tools?: IMcpToolSchema[] };
    const tools = result?.tools ?? [];
    entry.tools = tools;
    return tools;
  }

  async callTool(serverId: string, toolName: string, args: Record<string, unknown>): Promise<IMcpToolCallResult> {
    const entry = this._servers.get(serverId);
    if (!entry) throw new Error(`Server ${serverId} not connected`);

    const result = await this._sendRequest(serverId, 'tools/call', {
      name: toolName,
      arguments: args,
    }) as IMcpToolCallResult;

    return result ?? { content: [], isError: true };
  }

  override dispose(): void {
    const serverIds = [...this._servers.keys()];
    for (const id of serverIds) {
      // Fire-and-forget disconnect on dispose
      this.disconnectServer(id).catch(() => {});
    }
    this._onDidChangeStatus.dispose();
    super.dispose();
  }

  // ─── Private ───────────────────────────────────────────────────────

  private _createTransport(config: IMcpServerConfig): IMcpTransport {
    if (config.transport === 'stdio') {
      if (!config.command) throw new Error(`Server ${config.id}: stdio transport requires a command`);
      return new McpStdioTransport(config.id, config.command, config.args ?? [], config.env);
    }
    throw new Error(`Unsupported transport: ${config.transport}`);
  }

  private async _sendRequest(serverId: string, method: string, params: Record<string, unknown>): Promise<unknown> {
    const entry = this._servers.get(serverId);
    if (!entry) throw new Error(`Server ${serverId} not connected`);

    const id = this._nextId++;
    const request: IJsonRpcRequest = { jsonrpc: '2.0', id, method, params };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error(`MCP request ${method} (id=${id}) timed out after ${REQUEST_TIMEOUT_MS}ms`));
      }, REQUEST_TIMEOUT_MS);

      this._pending.set(id, { resolve, reject, timer });
      entry.pendingIds.add(id);
      entry.transport.send(JSON.stringify(request)).catch((err) => {
        clearTimeout(timer);
        this._pending.delete(id);
        reject(err);
      });
    });
  }

  private _handleMessage(_serverId: string, data: string): void {
    let parsed: IJsonRpcResponse;
    try {
      parsed = JSON.parse(data);
    } catch {
      return; // Ignore non-JSON messages
    }

    // R-03: Validate JSON-RPC 2.0 version
    if (parsed.jsonrpc !== '2.0') return;
    if (parsed.id == null) return; // Notification — ignore for now

    const pending = this._pending.get(parsed.id);
    if (!pending) return;

    clearTimeout(pending.timer);
    this._pending.delete(parsed.id);

    if (parsed.error) {
      pending.reject(new Error(`MCP error ${parsed.error.code}: ${parsed.error.message}`));
    } else {
      pending.resolve(parsed.result);
    }
  }

  private _handleClose(serverId: string): void {
    const entry = this._servers.get(serverId);
    if (!entry) return; // Already cleaned up by disconnectServer (R-05)
    this._servers.delete(serverId);
    this._rejectPendingForServer(serverId, entry);
    this._onDidChangeStatus.fire({ serverId, status: 'disconnected' });
  }

  private _rejectPendingForServer(_serverId: string, entry: IServerEntry): void {
    // R-01: Reject all pending requests tracked for this server
    const error = new Error(`MCP server ${_serverId} disconnected`);
    for (const id of entry.pendingIds) {
      const pending = this._pending.get(id);
      if (pending) {
        clearTimeout(pending.timer);
        this._pending.delete(id);
        pending.reject(error);
      }
    }
    entry.pendingIds.clear();
  }
}
