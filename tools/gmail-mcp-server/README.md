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

## One-time setup

> **End users:** ignore this section. The bundled server ships pre-built
> at `bundle/server.mjs` and registration happens through the Parallx
> MCP Servers UI. This section is for developers building the server
> from source.

### 1. Create a Google OAuth client (developers only)

1. Visit <https://console.cloud.google.com/apis/credentials>.
2. Create an **OAuth client ID** of type **Desktop app**.
3. Enable the **Gmail API** for the project.
4. Add yourself as a test user under **OAuth consent screen → Test users**.
5. Copy the client ID and client secret.

> Per RFC 8252 §8.4, OAuth clients shipped with desktop apps are
> **public-by-design**. The "secret" is not actually secret — Google
> still requires it for token exchange.

### 2. Build

```powershell
cd tools/gmail-mcp-server
npm install
npm run build
```

This produces a single bundled file at `bundle/server.mjs` (~18 kB,
zero runtime dependencies). The bundle is committed to the repo so
end users never need a Node toolchain.

### 3. Authorize

```powershell
$env:GMAIL_OAUTH_CLIENT_ID     = "<your-client-id>"
$env:GMAIL_OAUTH_CLIENT_SECRET = "<your-client-secret>"
node bundle/server.mjs --auth
```

The server will:

1. Start a one-shot HTTP listener on `127.0.0.1:<random-port>`.
2. Print a Google authorization URL — open it in your browser.
3. After you approve, Google redirects to the loopback URL.
4. The server exchanges the auth code for tokens and writes them to
   `~/.parallx/gmail-mcp/credentials.json` with mode `0600`.
5. Exits 0.

### 4. Register in Parallx

In Parallx: **chat-gear → MCP Servers → + Add Server**

| Field    | Value                                                                |
|----------|----------------------------------------------------------------------|
| Name     | `gmail`                                                              |
| Command  | `node`                                                               |
| Args     | `<absolute-path-to>/tools/gmail-mcp-server/bundle/server.mjs`        |

Save. The server registers `list_unread` with the agent. The same tool
is available to foreground chat turns and to autonomous turns (cron,
heartbeat, subagent) — they all share Parallx's tool catalog.

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
