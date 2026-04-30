// types.ts — Shared types for the Parallx Gmail MCP server.
//
// Matches the MCP / JSON-RPC 2.0 shape consumed by Parallx's
// `src/openclaw/mcp/mcpClientService.ts`.

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: unknown;
  error?: JsonRpcError;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
}

// ── Tool I/O ─────────────────────────────────────────────────────────

export interface ListUnreadInput {
  /** ISO 8601 timestamp; only return mail received after this. */
  since?: string;
  /** 1-100. Default 25. */
  max?: number;
  /** Optional Gmail search query (e.g. "from:alice OR is:important"). */
  query?: string;
}

export interface UnreadMessage {
  id: string;
  /** Display name + email (parsed from Gmail `From:` header). */
  from: string;
  subject: string;
  /** Gmail-provided snippet — short preview, not the full body. */
  snippet: string;
  /** ISO 8601 timestamp from Gmail `internalDate`. */
  receivedAt: string;
  /** Gmail label IDs (e.g. `INBOX`, `IMPORTANT`, `CATEGORY_PERSONAL`). */
  labels: readonly string[];
}

export interface ListUnreadOutput {
  messages: readonly UnreadMessage[];
}

// ── MCP tool schema (returned by `tools/list`) ──────────────────────

export interface McpToolSchema {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}
