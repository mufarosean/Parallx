# Parallx Gmail MCP server

Read-only Gmail access exposed to Parallx agents via the
[Model Context Protocol](https://modelcontextprotocol.io/) over STDIO.

This server is part of Milestone 60 / Tier 6 (autonomy proof).

## Design tenets

- **Process isolation.** Runs as a child Node process — never inside
  the Parallx renderer or main process. (M60 §9.5 process isolation.)
- **Read-only.** Single tool: `list_unread`. No mutations, no writes.
- **Scope minimization.** Hits only `gmail.googleapis.com`; no other
  network egress.
- **Privacy.** Never logs message bodies. Subjects and senders are
  metadata required for agent routing and ARE returned to the caller.
- **Zero refresh logic.** The server has no `client_secret` and no
  refresh endpoint. Parallx main process holds the refresh token,
  refreshes when needed, and respawns this server with a fresh
  `GMAIL_ACCESS_TOKEN`.
- **Zero runtime deps.** Plain Node 18+ (`fetch` is built in). Only
  `@types/node` and `typescript` for build.

## Tool

### `list_unread`

| Field   | Type     | Notes                                                       |
|---------|----------|-------------------------------------------------------------|
| `since` | string?  | ISO 8601; only mail after this timestamp.                   |
| `max`   | number?  | 1–100. Default 25.                                          |
| `query` | string?  | Optional Gmail query, e.g. `from:alice OR is:important`.    |

Returns:

```json
{
  "messages": [
    {
      "id": "18d2e0c11b7e8f3a",
      "from": "Alice <alice@example.com>",
      "subject": "Q2 plan",
      "snippet": "Here is the deck for tomorrow…",
      "receivedAt": "2026-04-30T14:22:11.000Z",
      "labels": ["INBOX", "IMPORTANT", "UNREAD"]
    }
  ]
}
```

## How Parallx spawns this server

Via the existing MCP STDIO transport (`src/openclaw/mcp/mcpTransport.ts`),
which goes through the `mcp:spawn` IPC handler in `electron/mcpBridge.cjs`.

Conceptual spawn:

```
node tools/gmail-mcp-server/dist/index.js
  env:
    GMAIL_ACCESS_TOKEN=<short-lived OAuth access token>
```

The server:

1. Reads JSON-RPC envelopes one per line on STDIN.
2. Writes responses one per line on STDOUT.
3. Logs to STDERR only (so as not to corrupt the JSON-RPC stream).

## Running standalone

```powershell
cd tools/gmail-mcp-server
npm install
npm run build
$env:GMAIL_ACCESS_TOKEN = "<your-token>"
node dist/index.js
```

Then send JSON-RPC requests on stdin, one per line:

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"manual","version":"0"}}}
{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"list_unread","arguments":{"max":5}}}
```

## Build pipeline

The Parallx top-level build does NOT currently invoke this sub-package.
Build it explicitly when you change it:

```powershell
cd tools/gmail-mcp-server
npm install
npm run build
```

A future milestone may wire this into `scripts/build.mjs`.

## Security review (M60 §9.5)

| Control                       | How                                                                              |
|-------------------------------|----------------------------------------------------------------------------------|
| Token storage                 | Owned by Parallx main process via `safeStorage` (F3). Server never persists.     |
| Scope minimization            | Read-only. Only `users.messages.list` + `users.messages.get` (metadata format).  |
| Process isolation             | Separate Node child process spawned via `mcp:spawn` IPC.                         |
| Network egress allowlist      | `gmail.googleapis.com` only; `GmailClient.fetchAuthorized` enforces.             |
| Audit log                     | Parallx's autonomy event log records the tool call with arg digest (F4).         |
| Revocation path               | Settings: `mcp.gmail.enabled = false` plus "Disconnect Gmail" (F2).              |
| Body confidentiality          | Bodies are never fetched (`format=metadata`) and never logged.                   |
