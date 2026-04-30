#!/usr/bin/env node
// index.ts — Parallx Gmail MCP server entry point.
//
// Transport: STDIO JSON-RPC 2.0 (newline-delimited).
// Protocol: MCP (initialize → tools/list → tools/call).
// Tools: one read-only tool — `list_unread`.
//
// Auth: GMAIL_ACCESS_TOKEN env var. Refresh logic stays in Parallx
// main process (security: server has no client_secret, no refresh
// endpoint reachable). When the token expires, the server returns
// an error and Parallx refreshes + respawns.
//
// Privacy: NEVER logs message bodies. Subject + sender are surfaced
// to the agent because they are routing-relevant metadata.

import { GmailClient } from './gmailClient.js';
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  ListUnreadInput,
  ListUnreadOutput,
  McpToolSchema,
} from './types.js';

const SERVER_NAME = 'parallx-gmail-mcp';
const SERVER_VERSION = '0.1.0';
const PROTOCOL_VERSION = '2024-11-05';

const LIST_UNREAD_TOOL: McpToolSchema = {
  name: 'list_unread',
  description:
    'List unread Gmail messages with sender, subject, snippet, received-at, and labels. Read-only.',
  inputSchema: {
    type: 'object',
    properties: {
      since: {
        type: 'string',
        description: 'ISO 8601 — only return mail received after this timestamp.',
      },
      max: {
        type: 'number',
        description: 'Max messages to return. 1-100. Default 25.',
        minimum: 1,
        maximum: 100,
      },
      query: {
        type: 'string',
        description: 'Optional Gmail search query, e.g. "from:alice OR is:important".',
      },
    },
    additionalProperties: false,
  },
};

// ── stderr-only logging (stdout is the JSON-RPC channel) ───────────

function logInfo(msg: string): void {
  process.stderr.write(`[gmail-mcp] ${msg}\n`);
}

function logError(msg: string): void {
  process.stderr.write(`[gmail-mcp][error] ${msg}\n`);
}

// ── JSON-RPC framing ───────────────────────────────────────────────

function writeResponse(res: JsonRpcResponse): void {
  process.stdout.write(JSON.stringify(res) + '\n');
}

function makeError(id: number | string, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

// ── Method handlers ────────────────────────────────────────────────

function handleInitialize(id: number | string): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id,
    result: {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
    },
  };
}

function handleToolsList(id: number | string): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id,
    result: { tools: [LIST_UNREAD_TOOL] },
  };
}

async function handleToolsCall(
  id: number | string,
  params: Record<string, unknown> | undefined,
): Promise<JsonRpcResponse> {
  const name = String(params?.name ?? '');
  const args = (params?.arguments ?? {}) as Record<string, unknown>;
  if (name !== 'list_unread') {
    return makeError(id, -32601, `Unknown tool: ${name}`);
  }

  const accessToken = process.env.GMAIL_ACCESS_TOKEN;
  if (!accessToken) {
    return makeError(
      id,
      -32000,
      'GMAIL_ACCESS_TOKEN env var is not set — Parallx must inject the token at spawn time.',
    );
  }

  const input: ListUnreadInput = {
    since: typeof args.since === 'string' ? args.since : undefined,
    max: typeof args.max === 'number' ? args.max : 25,
    query: typeof args.query === 'string' ? args.query : undefined,
  };

  try {
    const client = new GmailClient(accessToken);
    const messages = await client.listUnread({
      max: input.max ?? 25,
      query: input.query,
      since: input.since,
    });
    const output: ListUnreadOutput = { messages };
    // We log COUNTS only — never subjects or snippets.
    logInfo(`list_unread → ${messages.length} message(s)`);
    return {
      jsonrpc: '2.0',
      id,
      result: {
        content: [
          {
            type: 'text',
            text: JSON.stringify(output),
          },
        ],
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logError(`list_unread failed: ${message}`);
    return makeError(id, -32001, `list_unread failed: ${message}`);
  }
}

function handlePing(id: number | string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result: {} };
}

// ── Dispatch ───────────────────────────────────────────────────────

async function dispatch(req: JsonRpcRequest): Promise<JsonRpcResponse | null> {
  switch (req.method) {
    case 'initialize':
      return handleInitialize(req.id);
    case 'tools/list':
      return handleToolsList(req.id);
    case 'tools/call':
      return handleToolsCall(req.id, req.params);
    case 'ping':
      return handlePing(req.id);
    case 'notifications/initialized':
      // notification — no response
      return null;
    default:
      return makeError(req.id, -32601, `Method not found: ${req.method}`);
  }
}

// ── stdin reader ───────────────────────────────────────────────────

function startReader(): void {
  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk: string) => {
    buffer += chunk;
    let nl = buffer.indexOf('\n');
    while (nl !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line.length > 0) void handleLine(line);
      nl = buffer.indexOf('\n');
    }
  });
  process.stdin.on('end', () => {
    logInfo('stdin closed; exiting');
    process.exit(0);
  });
}

async function handleLine(line: string): Promise<void> {
  let parsed: JsonRpcRequest;
  try {
    parsed = JSON.parse(line) as JsonRpcRequest;
  } catch {
    logError(`malformed JSON: ${line.slice(0, 120)}`);
    return;
  }
  if (parsed.jsonrpc !== '2.0' || typeof parsed.method !== 'string') {
    logError(`invalid JSON-RPC envelope`);
    return;
  }
  // Notifications have no id and no response.
  const isNotification = parsed.id === undefined || parsed.id === null;
  try {
    const response = await dispatch(parsed);
    if (response && !isNotification) writeResponse(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logError(`dispatch error: ${message}`);
    if (!isNotification && parsed.id !== undefined) {
      writeResponse(makeError(parsed.id, -32603, `Internal error: ${message}`));
    }
  }
}

// ── Boot ───────────────────────────────────────────────────────────

logInfo(`${SERVER_NAME} v${SERVER_VERSION} starting (protocol ${PROTOCOL_VERSION})`);
startReader();
