// mcpClientService.ts — MCP Client Service implementation (D1 + D1b)
//
// Manages MCP server connections, JSON-RPC correlation, tool listing, tool calling,
// ping support (D1b-1/2/3), and connection health monitoring (D1b-4).
//
// Each server gets its own transport instance. Requests use a monotonic ID counter
// with a pending-promise map for correlation. 30s timeout per request, 5s for ping.
//
// D1b additions:
// - 3-way message dispatch: responses, server requests (e.g. ping), notifications
// - Automatic response to server `ping` requests with `{ result: {} }`
// - `ping()` method for outbound health checks
// - Periodic health monitor timer (30s interval)
// - Per-server health info tracking (latency, failures, healthy flag)

import { Emitter } from '../../platform/events.js';
import { Disposable } from '../../platform/lifecycle.js';
import type { IDisposable } from '../../platform/lifecycle.js';
import type { Event } from '../../platform/events.js';
import type { IMcpClientService } from '../../services/serviceTypes.js';
import type { IStorage } from '../../platform/storage.js';
import type { IMcpServerConfig, IMcpToolSchema, IMcpToolCallResult, McpConnectionState, IJsonRpcRequest, IJsonRpcResponse, IMcpHealthInfo } from './mcpTypes.js';
import { McpStdioTransport, type IMcpTransport } from './mcpTransport.js';

const REQUEST_TIMEOUT_MS = 30_000;
const PING_TIMEOUT_MS = 5_000;
const HEALTH_CHECK_INTERVAL_MS = 30_000;
const MAX_CONSECUTIVE_FAILURES_UNHEALTHY = 3;
const DEFAULT_MAX_RECONNECT_ATTEMPTS = 5;
const DEFAULT_RECONNECT_BASE_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 30_000;
const STORAGE_KEY_SERVERS = 'mcp.servers';

const DEFAULT_MCP_SERVERS: IMcpServerConfig[] = [];

interface IServerEntry {
  config: IMcpServerConfig;
  transport: IMcpTransport;
  tools: IMcpToolSchema[];
  subscriptions: IDisposable[];
  pendingIds: Set<number>;
  healthTimer: ReturnType<typeof setInterval> | null;
  health: {
    lastPingAt: number | null;
    lastPingLatencyMs: number | null;
    consecutiveFailures: number;
  };
  // D1b-5: Reconnection state
  reconnectAttempt: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  isReconnecting: boolean;
  manualDisconnect: boolean;
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
  private _storage: IStorage | undefined;
  private _configuredServers: IMcpServerConfig[] = [];

  private readonly _onDidChangeStatus = new Emitter<{ serverId: string; status: McpConnectionState }>();
  readonly onDidChangeStatus: Event<{ serverId: string; status: McpConnectionState }> = this._onDidChangeStatus.event;

  private readonly _onDidReceiveNotification = new Emitter<{ serverId: string; method: string; params?: Record<string, unknown> }>();
  readonly onDidReceiveNotification: Event<{ serverId: string; method: string; params?: Record<string, unknown> }> = this._onDidReceiveNotification.event;

  // ── Server Config Persistence ──────────────────────────────────────

  async initStorage(storage: IStorage): Promise<void> {
    this._storage = storage;
    await this._loadServerConfigs();
  }

  getConfiguredServers(): readonly IMcpServerConfig[] {
    return this._configuredServers;
  }

  async addServerConfig(config: IMcpServerConfig): Promise<void> {
    // Replace if same ID exists
    this._configuredServers = [
      ...this._configuredServers.filter(s => s.id !== config.id),
      config,
    ];
    await this._persistServerConfigs();
  }

  async removeServerConfig(serverId: string): Promise<void> {
    this._configuredServers = this._configuredServers.filter(s => s.id !== serverId);
    await this._persistServerConfigs();
  }

  private async _loadServerConfigs(): Promise<void> {
    if (!this._storage) return;
    try {
      const json = await this._storage.get(STORAGE_KEY_SERVERS);
      if (json) {
        const parsed = JSON.parse(json);
        if (Array.isArray(parsed) && parsed.length > 0) {
          this._configuredServers = parsed;
          return;
        }
      }
    } catch (e) {
      console.warn('[McpClientService] Failed to load server configs:', e);
    }
    // Seed with defaults on first run
    this._configuredServers = [...DEFAULT_MCP_SERVERS];
    await this._persistServerConfigs();
  }

  private async _persistServerConfigs(): Promise<void> {
    if (!this._storage) return;
    try {
      await this._storage.set(STORAGE_KEY_SERVERS, JSON.stringify(this._configuredServers));
    } catch (e) {
      console.warn('[McpClientService] Failed to persist server configs:', e);
    }
  }

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

    const entry: IServerEntry = {
      config, transport, tools: [], subscriptions, pendingIds: new Set(),
      healthTimer: null,
      health: { lastPingAt: null, lastPingLatencyMs: null, consecutiveFailures: 0 },
      reconnectAttempt: 0, reconnectTimer: null, isReconnecting: false, manualDisconnect: false,
    };
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

    // D1b-3: Start periodic health monitoring
    this._startHealthMonitor(config.id);
  }

  async disconnectServer(serverId: string): Promise<void> {
    const entry = this._servers.get(serverId);
    if (!entry) return;

    // D1b-5: Mark as manual disconnect to prevent auto-reconnect
    entry.manualDisconnect = true;

    // D1b-5: Cancel any pending reconnection timer
    if (entry.reconnectTimer) {
      clearTimeout(entry.reconnectTimer);
      entry.reconnectTimer = null;
    }

    // D1b-3: Stop health monitor before disconnect
    this._stopHealthMonitor(serverId);

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
    if (!entry) return 'disconnected';
    if (entry.isReconnecting) return 'reconnecting';
    return entry.transport.status;
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

  // D1b-3: Send a ping to the server and return latency in ms
  async ping(serverId: string): Promise<number> {
    const entry = this._servers.get(serverId);
    if (!entry) throw new Error(`Server ${serverId} not connected`);
    if (entry.isReconnecting) throw new Error(`Server ${serverId} is reconnecting`);

    const start = Date.now();
    await this._sendRequest(serverId, 'ping', {}, PING_TIMEOUT_MS);
    const latencyMs = Date.now() - start;

    // Update health info on success
    entry.health.lastPingAt = Date.now();
    entry.health.lastPingLatencyMs = latencyMs;
    entry.health.consecutiveFailures = 0;

    return latencyMs;
  }

  // D1b-4: Get health info for a server
  getHealthInfo(serverId: string): IMcpHealthInfo | undefined {
    const entry = this._servers.get(serverId);
    if (!entry) return undefined;
    return {
      lastPingAt: entry.health.lastPingAt,
      lastPingLatencyMs: entry.health.lastPingLatencyMs,
      consecutiveFailures: entry.health.consecutiveFailures,
      isHealthy: entry.health.consecutiveFailures < MAX_CONSECUTIVE_FAILURES_UNHEALTHY,
    };
  }

  override dispose(): void {
    const serverIds = [...this._servers.keys()];
    for (const id of serverIds) {
      this._stopHealthMonitor(id);
      // Fire-and-forget disconnect on dispose
      this.disconnectServer(id).catch(() => {});
    }
    this._onDidChangeStatus.dispose();
    this._onDidReceiveNotification.dispose();
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

  private async _sendRequest(serverId: string, method: string, params: Record<string, unknown>, timeoutMs = REQUEST_TIMEOUT_MS): Promise<unknown> {
    const entry = this._servers.get(serverId);
    if (!entry) throw new Error(`Server ${serverId} not connected`);

    const id = this._nextId++;
    const request: IJsonRpcRequest = { jsonrpc: '2.0', id, method, params };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error(`MCP request ${method} (id=${id}) timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this._pending.set(id, { resolve, reject, timer });
      entry.pendingIds.add(id);
      entry.transport.send(JSON.stringify(request)).catch((err) => {
        clearTimeout(timer);
        this._pending.delete(id);
        reject(err);
      });
    });
  }

  // D1b-1/D1b-2: 3-way message dispatch — responses, server requests, notifications
  private _handleMessage(serverId: string, data: string): void {
    let parsed: any;
    try {
      parsed = JSON.parse(data);
    } catch {
      return; // Ignore non-JSON messages
    }

    // R-03: Validate JSON-RPC 2.0 version
    if (parsed.jsonrpc !== '2.0') return;

    const hasId = parsed.id != null;
    const hasMethod = typeof parsed.method === 'string';

    if (hasId && hasMethod) {
      // Server-initiated request (e.g., ping) — needs a response
      this._handleServerRequest(serverId, parsed.id, parsed.method, parsed.params);
    } else if (hasId && !hasMethod) {
      // Response to our pending request
      this._handleResponse(parsed);
    } else if (hasMethod && !hasId) {
      // Notification — no response needed, emit for observability
      this._onDidReceiveNotification.fire({ serverId, method: parsed.method, params: parsed.params });
    }
  }

  // D1b-1: Respond to server-initiated requests (e.g., ping)
  private _handleServerRequest(serverId: string, requestId: number | string, method: string, _params?: Record<string, unknown>): void {
    const entry = this._servers.get(serverId);
    if (!entry) return;

    if (method === 'ping') {
      // MCP spec: respond with { result: {} }
      const response = JSON.stringify({
        jsonrpc: '2.0',
        id: requestId,
        result: {},
      });
      entry.transport.send(response).catch(() => {});
    } else {
      // Unknown server request — respond with method-not-found error
      const response = JSON.stringify({
        jsonrpc: '2.0',
        id: requestId,
        error: { code: -32601, message: `Method not found: ${method}` },
      });
      entry.transport.send(response).catch(() => {});
    }
  }

  // Handle response to a pending request we sent
  private _handleResponse(parsed: IJsonRpcResponse): void {
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

  // D1b-3: Start periodic health monitoring for a server
  private _startHealthMonitor(serverId: string): void {
    const entry = this._servers.get(serverId);
    if (!entry || entry.healthTimer) return;

    entry.healthTimer = setInterval(() => {
      this.ping(serverId).catch(() => {
        // Ping failed — increment failure counter
        const e = this._servers.get(serverId);
        if (e) {
          e.health.consecutiveFailures++;
        }
      });
    }, HEALTH_CHECK_INTERVAL_MS);
  }

  // D1b-3: Stop health monitoring for a server
  private _stopHealthMonitor(serverId: string): void {
    const entry = this._servers.get(serverId);
    if (!entry?.healthTimer) return;
    clearInterval(entry.healthTimer);
    entry.healthTimer = null;
  }

  private _handleClose(serverId: string): void {
    const entry = this._servers.get(serverId);
    if (!entry) return; // Already cleaned up by disconnectServer (R-05)

    this._stopHealthMonitor(serverId);
    this._rejectPendingForServer(serverId, entry);

    // D1b-5: Auto-reconnect if not a manual disconnect
    const config = entry.config;
    if (!entry.manualDisconnect && config.autoReconnect !== false) {
      // Keep entry in map but mark as reconnecting
      entry.isReconnecting = true;
      this._onDidChangeStatus.fire({ serverId, status: 'reconnecting' });
      this._attemptReconnect(config, entry);
      return;
    }

    this._servers.delete(serverId);
    this._onDidChangeStatus.fire({ serverId, status: 'disconnected' });
  }

  // D1b-5: Exponential backoff reconnection
  private _attemptReconnect(config: IMcpServerConfig, entry: IServerEntry): void {
    const maxAttempts = config.maxReconnectAttempts ?? DEFAULT_MAX_RECONNECT_ATTEMPTS;
    const baseDelay = config.reconnectBaseDelayMs ?? DEFAULT_RECONNECT_BASE_DELAY_MS;

    if (entry.reconnectAttempt >= maxAttempts) {
      // Give up — remove entry and fire error
      this._servers.delete(config.id);
      entry.isReconnecting = false;
      this._onDidChangeStatus.fire({ serverId: config.id, status: 'error' });
      return;
    }

    // Exponential backoff capped at MAX_RECONNECT_DELAY_MS
    const delay = Math.min(baseDelay * Math.pow(2, entry.reconnectAttempt), MAX_RECONNECT_DELAY_MS);
    entry.reconnectAttempt++;

    entry.reconnectTimer = setTimeout(async () => {
      entry.reconnectTimer = null;
      try {
        // Clean up old entry before reconnecting
        for (const sub of entry.subscriptions) sub.dispose();
        this._servers.delete(config.id);
        entry.isReconnecting = false;

        // Re-run full connect flow (creates new transport, handshake, health monitor)
        await this.connectServer(config);
      } catch {
        // connectServer failed — try again if we haven't been manually disconnected
        const currentEntry = this._servers.get(config.id);
        if (currentEntry && !currentEntry.manualDisconnect) {
          currentEntry.isReconnecting = true;
          currentEntry.reconnectAttempt = entry.reconnectAttempt;
          this._attemptReconnect(config, currentEntry);
        } else if (!currentEntry) {
          // No entry exists — create a shell entry to keep trying
          const shellEntry: IServerEntry = {
            config,
            transport: entry.transport, // stale, but we'll replace on success
            tools: [],
            pendingIds: new Set(),
            subscriptions: [],
            healthTimer: null,
            health: { lastPingAt: null, lastPingLatencyMs: null, consecutiveFailures: 0 },
            reconnectAttempt: entry.reconnectAttempt,
            reconnectTimer: null,
            isReconnecting: true,
            manualDisconnect: false,
          };
          this._servers.set(config.id, shellEntry);
          this._attemptReconnect(config, shellEntry);
        }
      }
    }, delay);
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
