# Parallx Gmail MCP server

Read-only Gmail access exposed to Parallx agents via the
[Model Context Protocol](https://modelcontextprotocol.io/) over STDIO.

This server is **self-contained**: it owns the OAuth flow, persists its
own refresh token, and refreshes the access token in-process. Parallx
talks to it like any other MCP server — no Gmail-specific code lives in
Parallx core.

## Design tenets

- **Self-contained.** OAuth, credential storage, token refresh — all
  inside this directory. Parallx core has zero knowledge that this is
  a Gmail server vs. any other MCP server.
- **Process isolation.** Runs as a child Node process — never inside
  the Parallx renderer or main process.
- **Read-only.** Single tool: `list_unread`. No mutations, no writes.
- **Scope minimization.** Hits only `gmail.googleapis.com`; no other
  network egress at runtime.
- **Privacy.** Never logs message bodies. Subjects and senders are
  metadata required for agent routing and ARE returned to the caller.
- **Zero runtime deps.** Plain Node 18+ (`fetch`, `crypto`, `http` are
  built in). Only `@types/node` and `typescript` for build.

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

## End-user setup (in Parallx)

1. Open Parallx → **chat-gear → MCP Servers → + Add Server → Catalog → Gmail**.
2. Click **Install**. The Gmail row appears with status "Disconnected".
3. Click **Authorize**. Your default browser opens to Google's consent
   screen. Sign in and approve read-only access to your inbox.
4. The server saves a refresh token to
   `~/.parallx/gmail-mcp/credentials.json` (mode `0600`) and the row
   flips to **Connected**.
5. `list_unread` is now available to foreground chat, cron, heartbeat,
   and subagent turns.

No terminal, no Google Cloud Console, no `npm install`. The server
ships pre-built at `bundle/server.mjs` and uses the bundled Parallx
OAuth client.

## Developer setup (building from source)

> Skip this section if you're an end user — the committed bundle is
> what runs in production.

### 1. Build

```powershell
cd tools/gmail-mcp-server
npm install
npm run build
```

This produces a single bundled file at `bundle/server.mjs` (~18 kB,
zero runtime dependencies).

### 2. Override the bundled OAuth client (optional)

The bundle ships with the Parallx-owned Google OAuth Desktop client
baked in (see `src/bundledOAuthClient.ts`). To authorize against a
different Google project — e.g. when developing against a staging
project — set environment variables before running `--auth`:

```powershell
$env:GMAIL_OAUTH_CLIENT_ID     = "<your-client-id>"
$env:GMAIL_OAUTH_CLIENT_SECRET = "<your-client-secret>"
node bundle/server.mjs --auth
```

> Per RFC 8252 §8.4, OAuth clients shipped with desktop apps are
> **public-by-design**. The "secret" baked into the bundle is not
> confidential — Google still requires it for the token-exchange call,
> but it grants no access on its own. The user's consent for their own
> data is the actual authorization boundary.

### 3. Manual `--auth` run (developers)

```powershell
node bundle/server.mjs --auth
```

The server starts a one-shot loopback listener, prints a Google
authorization URL to stderr, opens it (you do, in a browser), exchanges
the redirect code for tokens, and writes
`~/.parallx/gmail-mcp/credentials.json` with mode `0600`.

## Runtime behavior

When Parallx spawns the server, it:

1. Reads `~/.parallx/gmail-mcp/credentials.json`.
2. On every `tools/call`, ensures the access token is fresh — if it's
   missing or within 60s of expiring, refreshes via
   `https://oauth2.googleapis.com/token` using the persisted refresh
   token.
3. Calls Gmail with the access token.

Access tokens **never touch disk**. Only the refresh token does, in the
mode-`0600` credentials file.

## Files

| Path                | Role                                                            |
|---------------------|-----------------------------------------------------------------|
| `src/index.ts`      | MCP server entry; `--auth` dispatch; access-token cache.        |
| `src/oauth.ts`      | PKCE, build URL, exchange/refresh — pure Node, no Parallx imports. |
| `src/loopback.ts`   | One-shot `127.0.0.1:0` redirect listener.                       |
| `src/credStore.ts`  | Read/write `~/.parallx/gmail-mcp/credentials.json` (mode 600).   |
| `src/authCli.ts`    | `--auth` orchestration.                                         |
| `src/gmailClient.ts`| Read-only REST client; `gmail.googleapis.com` allowlist.        |
| `src/types.ts`      | JSON-RPC + tool I/O types.                                      |

## Manual JSON-RPC test

```powershell
node bundle/server.mjs
```

Then send requests on stdin, one per line:

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"manual","version":"0"}}}
{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"list_unread","arguments":{"max":5}}}
```

## Re-authorizing or revoking

- **Re-auth:** delete `~/.parallx/gmail-mcp/credentials.json` and re-run
  `node bundle/server.mjs --auth`.
- **Revoke:** revoke at <https://myaccount.google.com/permissions>, then
  delete the credentials file.

## Security model

| Control                 | How                                                                            |
|-------------------------|--------------------------------------------------------------------------------|
| Refresh token at rest   | `~/.parallx/gmail-mcp/credentials.json`, mode 0600.                            |
| Access token at rest    | Never persisted. In-memory only, with expiry.                                  |
| Scope minimization      | Read-only `gmail.readonly`. `users.messages.list` + `users.messages.get` only. |
| Process isolation       | Separate Node child process spawned via Parallx's MCP STDIO transport.         |
| Network egress          | `gmail.googleapis.com` + `oauth2.googleapis.com` + `accounts.google.com` only. |
| Audit log               | Parallx's autonomy event log records every tool call.                          |
| Body confidentiality    | Message bodies are never fetched (`format=metadata`) and never logged.         |
