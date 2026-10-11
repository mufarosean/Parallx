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
import type { ISecretStorageService } from '../../services/secretStorageService.js';
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
/** In a server's args, the open workspace folder (resolved at each connect). */
export const WORKSPACE_ROOT_PLACEHOLDER = '{workspaceRoot}';
/** Env values (tokens, API keys) live in the OS-encrypted secret store under this prefix. */
const SECRET_ENV_PREFIX = 'mcp.env.';

/**
 * A server config as written to workspace storage. Its env values are not in
 * it: `envSecret` names the secret that holds them. A config keeps plaintext
 * env only when the secret store is unavailable.
 */
type StoredServerConfig = IMcpServerConfig & { readonly envSecret?: string };

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
  private _secrets: ISecretStorageService | undefined;
  /** The secret holding each server's env, by server id. */
  private readonly _envSecretKeys = new Map<string, string>();
  /** Servers whose env is in the secret store but could not be read this session. */
  private readonly _envUnreadable = new Set<string>();
  private _configuredServers: IMcpServerConfig[] = [];
  /** A sealed workspace runs no MCP server (see setSealed). */
  private _sealed = false;
  private _workspaceRoot: () => string | undefined = () => undefined;

  private readonly _onDidChangeStatus = new Emitter<{ serverId: string; status: McpConnectionState }>();
  readonly onDidChangeStatus: Event<{ serverId: string; status: McpConnectionState }> = this._onDidChangeStatus.event;

  private readonly _onDidReceiveNotification = new Emitter<{ serverId: string; method: string; params?: Record<string, unknown> }>();
  readonly onDidReceiveNotification: Event<{ serverId: string; method: string; params?: Record<string, unknown> }> = this._onDidReceiveNotification.event;

  // ── Server Config Persistence ──────────────────────────────────────

  async initStorage(storage: IStorage, secrets?: ISecretStorageService): Promise<void> {
    this._storage = storage;
    this._secrets = secrets?.available ? secrets : undefined;
    await this._loadServerConfigs();
  }

  /**
   * A sealed workspace keeps its documents on the machine. An MCP server is a
   * separate program and Parallx cannot see what it reaches, so while sealed
   * no server runs: running ones stop, and none connects until the seal is
   * lifted, when the enabled ones start again. Their tools are hidden and
   * refused by the tools service (McpToolBridge marks them reachesNetwork).
   */
  async setSealed(sealed: boolean): Promise<void> {
    if (sealed === this._sealed) return;
    this._sealed = sealed;
    if (sealed) {
      await Promise.all([...this._servers.keys()].map((id) => this.disconnectServer(id).catch(() => {})));
      return;
    }
    for (const server of this._configuredServers) {
      if (server.enabled && !this._servers.has(server.id)) {
        this.connectServer(server).catch((err) => console.warn(`[MCP] Connect after unseal failed for ${server.id}:`, err));
      }
    }
  }

  get isSealed(): boolean {
    return this._sealed;
  }

  /** Where `{workspaceRoot}` in a server's args points (the Filesystem server's allowed folder). */
  setWorkspaceRootProvider(provider: () => string | undefined): void {
    this._workspaceRoot = provider;
  }

  private _withWorkspaceRoot(config: IMcpServerConfig): IMcpServerConfig {
    if (!config.args?.some((a) => a.includes(WORKSPACE_ROOT_PLACEHOLDER))) return config;
    const root = this._workspaceRoot();
    if (!root) throw new Error(`${config.name} works in the open workspace folder. Open a folder first.`);
    return { ...config, args: config.args.map((a) => a.split(WORKSPACE_ROOT_PLACEHOLDER).join(root)) };
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
    const secretKey = this._envSecretKeys.get(serverId);
    this._envSecretKeys.delete(serverId);
    await this._persistServerConfigs();
    if (secretKey) await this._secrets?.delete(secretKey).catch(() => undefined);
  }

  private async _loadServerConfigs(): Promise<void> {
    if (!this._storage) return;
    try {
      const json = await this._storage.get(STORAGE_KEY_SERVERS);
      if (json) {
        const parsed = JSON.parse(json);
        if (Array.isArray(parsed) && parsed.length > 0) {
          let plaintextEnv = false;
          const configs: IMcpServerConfig[] = [];
          for (const stored of parsed as StoredServerConfig[]) {
            const { envSecret, ...config } = stored;
            if (envSecret) {
              this._envSecretKeys.set(config.id, envSecret);
              const read = await this._readEnvSecret(envSecret, config.id);
              if (!read.env) this._envUnreadable.add(config.id);
              configs.push({ ...config, ...read });
            } else {
              configs.push(config);
              if (config.env && Object.keys(config.env).length > 0) plaintextEnv = true;
            }
          }
          this._configuredServers = configs;
          // Configs saved before env moved to the secret store: move it now.
          if (plaintextEnv && this._secrets) await this._persistServerConfigs();
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
      const stored = await Promise.all(this._configuredServers.map((c) => this._toStored(c)));
      await this._storage.set(STORAGE_KEY_SERVERS, JSON.stringify(stored));
    } catch (e) {
      console.warn('[McpClientService] Failed to persist server configs:', e);
    }
  }

  /** The config as written to workspace storage: env values go to the secret store. */
  private async _toStored(config: IMcpServerConfig): Promise<StoredServerConfig> {
    const { env, ...rest } = config;
    if (!env || Object.keys(env).length === 0) {
      // The env is in the store but could not be read this session (the
      // keychain was locked, or unavailable): keep pointing at it, so one bad
      // start does not lose the token for good.
      const key = this._envSecretKeys.get(config.id);
      return key && this._envUnreadable.has(config.id) ? { ...rest, envSecret: key } : rest;
    }
    this._envUnreadable.delete(config.id);
    if (!this._secrets) return config;
    let key = this._envSecretKeys.get(config.id);
    if (!key) {
      // Random, not derived from the server id: the store is shared by every
      // workspace, and two of them may name a server the same.
      key = `${SECRET_ENV_PREFIX}${crypto.randomUUID()}`;
      this._envSecretKeys.set(config.id, key);
    }
    const saved = await this._secrets.setString(key, JSON.stringify(env));
    if (saved.ok) return { ...rest, envSecret: key };
    console.warn(`[McpClientService] Secret store refused env for ${config.id} (${saved.error}); kept in workspace storage.`);
    return config;
  }

  private async _readEnvSecret(key: string, serverId: string): Promise<{ env?: Record<string, string> }> {
    const read = await this._secrets?.getString(key);
    if (!read?.ok || !read.value) {
      console.warn(`[McpClientService] Env for ${serverId} could not be read from the secret store (${read?.error ?? 'store unavailable'}).`);
      return {};
    }
    try {
      return { env: JSON.parse(read.value) as Record<string, string> };
    } catch {
      return {};
    }
  }

  async connectServer(config: IMcpServerConfig): Promise<void> {
    if (this._sealed) {
      throw new Error('This workspace is sealed, so MCP servers do not run in it.');
    }
    if (this._servers.has(config.id)) {
      await this.disconnectServer(config.id);
    }

    const transport = this._createTransport(this._withWorkspaceRoot(config));
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
      if (this._sealed) {
        for (const sub of entry.subscriptions) sub.dispose();
        this._servers.delete(config.id);
        entry.isReconnecting = false;
        this._onDidChangeStatus.fire({ serverId: config.id, status: 'disconnected' });
        return;
      }
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
