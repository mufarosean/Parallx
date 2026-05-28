#!/usr/bin/env node
// Force IPv4-first DNS resolution. Node's default `fetch` (undici) otherwise
// races IPv6 (AAAA) records first; on hosts where IPv6 routes to Google blackhole
// or is misconfigured, the connect attempt stalls until UND_ERR_CONNECT_TIMEOUT.
import { setDefaultResultOrder } from 'node:dns';
try { setDefaultResultOrder('ipv4first'); } catch { /* older node */ }

// index.ts — Parallx Gmail MCP server entry point.
//
// Transport: STDIO JSON-RPC 2.0 (newline-delimited).
// Protocol: MCP (initialize → tools/list → tools/call).
// Tools: one read-only tool — `list_emails`.
//
// Auth: self-contained. Run `node dist/index.js --auth` once to
// authorize Gmail (PKCE + loopback redirect). Credentials are saved
// to ~/.parallx/gmail-mcp/credentials.json (chmod 600) and the
// server refreshes the access token in-process on demand.
//
// Privacy: NEVER logs message bodies. Subject + sender are surfaced
// to the agent because they are routing-relevant metadata.

import { GmailClient } from './gmailClient.js';
import { runAuth } from './authCli.js';
import { readCredentials, type StoredCredentials } from './credStore.js';
import { refreshAccessToken } from './oauth.js';
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

const LIST_EMAILS_TOOL: McpToolSchema = {
  name: 'list_emails',
  description:
    'Search Gmail and return matching messages with sender, subject, snippet, optional body, received-at, thread id, and labels. Read-only. ALL parameters are optional — combine them freely:\n' +
    '  • `query` — Gmail search syntax. Use this for sender filters ("from:alice@x.com"), account filters via from:, topic/subject filters ("subject:invoice", "vacation"), label filters ("label:work"), attachment filters ("has:attachment"), date range ("after:2026/01/01 before:2026/02/01"), starred ("is:starred"), or any combination ("from:(boss@x.com OR hr@x.com) subject:offsite").\n' +
    '  • `since` — ISO 8601 timestamp; only return mail received after this time. Composable with `query`.\n' +
    '  • `read_state` — "unread" (default), "read", or "all". Use "all" if `query` already constrains read-state.\n' +
    '  • `include_body` — include decoded plain-text body (truncated to 8 KB). Default false.\n' +
    '  • `max` / `page_token` — pagination. Default 25 per page.\n' +
    'With no arguments, returns the 25 most recent unread messages. To pull every email from the last 7 days regardless of read state, pass since + read_state="all". To search by topic across all mail, pass query="<keywords>" + read_state="all".',
  inputSchema: {
    type: 'object',
    properties: {
      since: {
        type: 'string',
        description: 'ISO 8601 — only return mail received after this timestamp. Optional. Combines with `query`.',
      },
      max: {
        type: 'number',
        description: 'Max messages to return per page. 1-500 (Gmail API max). Default 25.',
        minimum: 1,
        maximum: 500,
      },
      query: {
        type: 'string',
        description:
          'Gmail search query in standard Gmail syntax. Examples: "from:alice@example.com", "subject:invoice", "label:work has:attachment", "from:(boss OR hr) vacation", "after:2026/01/01 before:2026/02/01", "is:starred". Combine with operators (AND implicit, OR explicit, parens for grouping). Use this to filter by sender, account, topic, subject, label, date — anything Gmail search supports.',
      },
      read_state: {
        type: 'string',
        enum: ['unread', 'read', 'all'],
        description:
          'Read-state filter. "unread" (default) returns only unread mail; "read" returns only seen mail; "all" applies no read-state constraint. Use "all" when `query` already includes a read-state operator or when you want every match regardless of read state.',
      },
      include_body: {
        type: 'boolean',
        description:
          'Include decoded plain-text body (truncated to 8 KB). Default false. Set true when the caller needs the email body for content analysis (e.g. transaction extraction, summarization) and not just the snippet preview.',
      },
      page_token: {
        type: 'string',
        description:
          'Opaque Gmail pageToken for paginating beyond `max` results per call. Pass the `nextPageToken` returned by the previous call to fetch the next page. Reuse the same since/query/read_state — tokens are only valid against an identical query.',
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
    result: { tools: [LIST_EMAILS_TOOL] },
  };
}

// ── Access token cache (refreshed in-process) ─────────────────────

interface CachedToken {
  readonly accessToken: string;
  readonly expiresAt: number; // epoch ms
}
let tokenCache: CachedToken | null = null;
const TOKEN_REFRESH_SKEW_MS = 60_000; // refresh 60s before expiry

async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt - TOKEN_REFRESH_SKEW_MS > now) {
    return tokenCache.accessToken;
  }
  const creds: StoredCredentials | null = await readCredentials();
  if (!creds) {
    throw new Error(
      'no credentials on disk — run `node dist/index.js --auth` first',
    );
  }
  const tokens = await refreshAccessToken({
    clientId: creds.client_id,
    clientSecret: creds.client_secret,
    refreshToken: creds.refresh_token,
  });
  tokenCache = {
    accessToken: tokens.access_token,
    expiresAt: now + tokens.expires_in * 1000,
  };
  return tokens.access_token;
}

async function handleToolsCall(
  id: number | string,
  params: Record<string, unknown> | undefined,
): Promise<JsonRpcResponse> {
  const name = String(params?.name ?? '');
  const args = (params?.arguments ?? {}) as Record<string, unknown>;
  // Accept the legacy `list_unread` name for one release so any pinned
  // skill / cron / extension config doesn't break in-place. New callers
  // should use `list_emails`. The behaviour is identical.
  if (name !== 'list_emails' && name !== 'list_unread') {
    return makeError(id, -32601, `Unknown tool: ${name}`);
  }

  let accessToken: string;
  try {
    accessToken = await getAccessToken();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return makeError(id, -32000, message);
  }

  const rawReadState = args.read_state;
  const readState: 'unread' | 'read' | 'all' =
    rawReadState === 'read' || rawReadState === 'all' || rawReadState === 'unread'
      ? rawReadState
      : 'unread';

  const input: ListUnreadInput = {
    since: typeof args.since === 'string' ? args.since : undefined,
    max: typeof args.max === 'number' ? args.max : 25,
    query: typeof args.query === 'string' ? args.query : undefined,
    read_state: readState,
    include_body: args.include_body === true,
    page_token: typeof args.page_token === 'string' ? args.page_token : undefined,
  };

  try {
    const client = new GmailClient(accessToken);
    const { messages, nextPageToken } = await client.listUnread({
      max: input.max ?? 25,
      query: input.query,
      since: input.since,
      readState,
      includeBody: input.include_body === true,
      pageToken: input.page_token,
    });
    const output: ListUnreadOutput = {
      messages,
      ...(nextPageToken ? { nextPageToken } : {}),
    };
    // We log COUNTS only — never subjects or snippets.
    logInfo(`list_emails → ${messages.length} message(s)`);
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
    const cause = err && typeof err === 'object' ? (err as { cause?: unknown }).cause : undefined;
    let causeStr = '';
    if (cause) {
      const c = cause as { code?: string; message?: string };
      causeStr = ` (cause: ${c.code ?? c.message ?? String(cause)})`;
    }
    logError(`list_emails failed: ${message}${causeStr}`);
    return makeError(id, -32001, `list_emails failed: ${message}${causeStr}`);
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

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes('--auth')) {
    const code = await runAuth();
    process.exit(code);
  }
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stderr.write(
      `${SERVER_NAME} v${SERVER_VERSION}\n` +
        '\nUsage:\n' +
        '  node dist/index.js            run as MCP server (STDIO JSON-RPC)\n' +
        '  node dist/index.js --auth     authorize Gmail (one-time)\n' +
        '  node dist/index.js --help     show this help\n' +
        '\nAuth env vars (only required for --auth):\n' +
        '  GMAIL_OAUTH_CLIENT_ID\n' +
        '  GMAIL_OAUTH_CLIENT_SECRET\n',
    );
    process.exit(0);
  }
  logInfo(`${SERVER_NAME} v${SERVER_VERSION} starting (protocol ${PROTOCOL_VERSION})`);
  startReader();
}

void main();
