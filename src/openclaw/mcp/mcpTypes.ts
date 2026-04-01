// mcpTypes.ts — MCP (Model Context Protocol) type definitions (D1)
//
// JSON-RPC 2.0 message types, MCP tool schemas, server config,
// and connection state types for the MCP integration layer.

// ═══════════════════════════════════════════════════════════════════════════════
// JSON-RPC 2.0 Message Types
// ═══════════════════════════════════════════════════════════════════════════════

export interface IJsonRpcRequest {
  readonly jsonrpc: '2.0';
  readonly id: number;
  readonly method: string;
  readonly params?: Record<string, unknown>;
}

export interface IJsonRpcResponse {
  readonly jsonrpc: '2.0';
  readonly id: number;
  readonly result?: unknown;
  readonly error?: IJsonRpcError;
}

export interface IJsonRpcError {
  readonly code: number;
  readonly message: string;
  readonly data?: unknown;
}

export interface IJsonRpcNotification {
  readonly jsonrpc: '2.0';
  readonly method: string;
  readonly params?: Record<string, unknown>;
}

/**
 * Server-initiated JSON-RPC request (has both id and method).
 * Unlike a notification, this requires a response from the client.
 * Example: MCP `ping` — server sends `{ id: N, method: "ping" }`,
 * client MUST respond with `{ id: N, result: {} }`.
 */
export interface IJsonRpcServerRequest {
  readonly jsonrpc: '2.0';
  readonly id: number | string;
  readonly method: string;
  readonly params?: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MCP Tool Schema
// ═══════════════════════════════════════════════════════════════════════════════

export interface IMcpToolSchema {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MCP Tool Call Types
// ═══════════════════════════════════════════════════════════════════════════════

export interface IMcpToolCallParams {
  readonly name: string;
  readonly arguments?: Record<string, unknown>;
}

export interface IMcpToolCallResultContent {
  readonly type: 'text' | 'image' | 'resource';
  readonly text?: string;
  readonly data?: string;
  readonly mimeType?: string;
}

export interface IMcpToolCallResult {
  readonly content: readonly IMcpToolCallResultContent[];
  readonly isError?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MCP Initialize Types
// ═══════════════════════════════════════════════════════════════════════════════

export interface IMcpInitializeParams {
  readonly protocolVersion: string;
  readonly capabilities: Record<string, unknown>;
  readonly clientInfo: {
    readonly name: string;
    readonly version: string;
  };
}

export interface IMcpInitializeResult {
  readonly protocolVersion: string;
  readonly capabilities: Record<string, unknown>;
  readonly serverInfo?: {
    readonly name: string;
    readonly version?: string;
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// MCP Server Configuration
// ═══════════════════════════════════════════════════════════════════════════════

export type McpTransportType = 'stdio' | 'sse';

export interface IMcpServerConfig {
  readonly id: string;
  readonly name: string;
  readonly transport: McpTransportType;
  readonly command?: string;
  readonly args?: readonly string[];
  readonly url?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly enabled: boolean;
  // D1b-8: Reconnection config
  readonly autoReconnect?: boolean;         // default: true
  readonly maxReconnectAttempts?: number;    // default: 5
  readonly reconnectBaseDelayMs?: number;    // default: 1000
}

// ═══════════════════════════════════════════════════════════════════════════════
// Unified MCP Config
// ═══════════════════════════════════════════════════════════════════════════════

export interface IUnifiedMcpConfig {
  readonly servers: readonly IMcpServerConfig[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// Connection State
// ═══════════════════════════════════════════════════════════════════════════════

export type McpConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';

// ═══════════════════════════════════════════════════════════════════════════════
// Health Monitoring
// ═══════════════════════════════════════════════════════════════════════════════

export interface IMcpHealthInfo {
  readonly lastPingAt: number | null;
  readonly lastPingLatencyMs: number | null;
  readonly consecutiveFailures: number;
  readonly isHealthy: boolean;
}
