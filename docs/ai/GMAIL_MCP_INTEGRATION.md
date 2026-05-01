# Gmail MCP integration — user setup guide

> **Status:** M62 self-contained server. The Gmail MCP server in
> `tools/gmail-mcp-server/` owns its own OAuth flow and credential
> store. Parallx core has no Gmail-specific code, settings, or commands.

Parallx integrates with your Gmail inbox through a small, read-only MCP
server (`tools/gmail-mcp-server/`). The server runs its own OAuth 2.0
desktop flow, persists its refresh token on disk under `~/.parallx/`,
and refreshes access tokens in-process. No mail bodies ever cross into
the agent. Subjects, senders, snippets, labels, and timestamps are
returned to the agent so it can triage, summarize, and route — with
your approval.

## What gets installed where

| Component                         | Location                                                  | Trust boundary                          |
|-----------------------------------|-----------------------------------------------------------|-----------------------------------------|
| Gmail MCP server                  | `tools/gmail-mcp-server/bundle/server.mjs`                | Spawned as a Node child process.        |
| OAuth client config (your input)  | `GMAIL_OAUTH_CLIENT_ID` / `GMAIL_OAUTH_CLIENT_SECRET` env | Used only by the `--auth` flow.         |
| Refresh token + client creds      | `~/.parallx/gmail-mcp/credentials.json` (mode 0600)       | File-system permissions only.           |
| Access token (transient)          | In-process memory (60 s skew refresh)                     | Never persisted to disk.                |

## One-time setup

1. **Create a Google OAuth client.**
   - Open [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials).
   - **Create credentials → OAuth client ID → Desktop app**.
   - Note the **Client ID** and **Client Secret**.
   - On the consent screen, add the scope
     `https://www.googleapis.com/auth/gmail.readonly`.

2. **Build the server.**
   ```bash
   cd tools/gmail-mcp-server
   npm install
   npm run build
   ```

3. **Run the OAuth bootstrap.** The server starts a one-shot loopback
   listener on `127.0.0.1:0`, opens nothing automatically, and prints
   the auth URL for you to paste into a browser.
   ```bash
   GMAIL_OAUTH_CLIENT_ID=...   \
   GMAIL_OAUTH_CLIENT_SECRET=... \
     node dist/index.js --auth
   ```
   - Open the printed URL in your browser, approve the read-only
     scope. Google redirects back to the loopback listener, which
     completes PKCE token exchange and writes
     `~/.parallx/gmail-mcp/credentials.json` (mode `0600`).
   - The CLI prints the exact `chat-gear → MCP Servers` entry to use
     in the next step.

4. **Register the server in Parallx.**
   - Open Parallx → chat-gear (in the chat title bar) → **MCP Servers**
     section → **+ Add Server**:
     - **Name**: `gmail`
     - **Transport**: `stdio`
     - **Command**: `node`
     - **Args**: absolute path to `tools/gmail-mcp-server/bundle/server.mjs`
     - **Enabled**: ✓
   - Save. The status dot should go `Connecting… → Connected`. The
     server reads the on-disk credentials and refreshes its access
     token in-process; Parallx core sees only the `gmail.list_unread`
     tool that the server exposes via STDIO JSON-RPC.

5. **Test the connection.**
   - Open chat → ask: *"What unread email do I have?"*
   - The agent calls the `gmail.list_unread` tool. First call surfaces
     the standard MCP-tool approval prompt (every MCP tool ships at
     **require-approval** on first use). Approve once; subsequent calls
     run without prompting if you remembered the decision.

## How it runs

```
┌─────────────────────────┐         spawn (mcp:spawn IPC)
│ Parallx renderer        │  ─────────────────────────────────►  ┌──────────────────────────────┐
│  • gmail.list_unread    │                                       │ tools/gmail-mcp-server       │
│    tool call            │                                       │ (Node child process)         │
│  • no env injection;    │  STDIO JSON-RPC                       │                              │
│    server self-hosts    │  ◄─────────────────────────────────   │  • reads ~/.parallx/...      │
│    OAuth                │     {messages: [...]} on stdout       │  • refreshes access token    │
│                         │                                       │    in-process (60 s skew)    │
│                         │                                       │  • fetch → gmail.googleapis  │
│                         │                                       │  • metadata format only      │
│                         │                                       │  • body never fetched        │
└─────────────────────────┘                                       └──────────────────────────────┘
        │
        ▼
  AutonomyEventLog: records the call with argsDigest only.
  Subjects, snippets, and bodies are NEVER written to the audit log.
```

Token lifecycle (entirely inside the MCP server):

- **Access token** (~1 hour TTL) lives in the MCP child's memory, with
  a 60 s skew refresh window. Never written to disk.
- **Refresh token + client creds** live in
  `~/.parallx/gmail-mcp/credentials.json` (mode `0600`). The server
  writes atomically (`.tmp` → `rename`). Decryption is gated on
  file-system permissions only; encryption-at-rest is the user's
  responsibility (e.g. encrypted home directory).

## What the tool can read

| Returned to agent     | Source                                                            |
|-----------------------|-------------------------------------------------------------------|
| Message id            | `users.messages.list` response                                    |
| `From:` header        | `users.messages.get?format=metadata&metadataHeaders=From`         |
| `Subject:` header     | `users.messages.get?format=metadata&metadataHeaders=Subject`      |
| Gmail snippet         | `users.messages.get?format=metadata` (already metadata)           |
| Received timestamp    | `internalDate` (epoch ms) → ISO 8601                              |
| Label IDs             | `labelIds[]` (e.g. `INBOX`, `IMPORTANT`, `CATEGORY_PERSONAL`)     |

What the tool **never** reads:

- Message body (HTML or plain text).
- Attachments.
- Thread mailing-list members (only the canonical `From:` is exposed).
- Bcc/Cc.

## What gets logged

- **Autonomy event log** (per `gmail.list_unread` call):
  `{ tool: "gmail.list_unread", argsDigest: <sha-256 of canonical args>, outcome }`.
  Never the resulting messages, never subjects.
- **MCP child process stderr**: only counts (e.g. `list_unread → 7 message(s)`).
  Never subjects or snippets.

## Disconnecting

There is no `gmail.disconnect` command in Parallx core. To disconnect:

1. **Remove the MCP server entry** in chat-gear → MCP Servers (kills
   the child process and stops auto-spawn).
2. **Delete the credential file**:
   ```bash
   rm ~/.parallx/gmail-mcp/credentials.json
   ```
3. **(Optional) Revoke at Google's side** — visit
   [myaccount.google.com → Security → Third-party apps](https://myaccount.google.com/security)
   and remove your OAuth client. This invalidates the refresh token
   even if a stale copy of `credentials.json` remains anywhere.

## Network egress

The Parallx Gmail MCP server reaches **only**:

- `gmail.googleapis.com` — for `users.messages.list` / `.get`. Enforced
  by `GmailClient.fetchAuthorized` with an explicit host check that
  throws on any other host.
- `accounts.google.com` — only during `--auth`, browser-driven.
- `oauth2.googleapis.com` — for token exchange and refresh.

Parallx core makes none of these calls. All network egress for Gmail
is in the MCP child process.

## Troubleshooting

| Symptom                                              | Cause                                        | Fix                                                                 |
|------------------------------------------------------|----------------------------------------------|---------------------------------------------------------------------|
| `--auth` fails with "missing env"                    | `GMAIL_OAUTH_CLIENT_ID/SECRET` not set       | Re-run with both env vars set (exit code `2`).                      |
| `--auth` reports "no refresh_token in response"      | Google returned grant without offline access | Revoke the OAuth client at myaccount.google.com → re-run `--auth`.  |
| MCP server starts but `gmail.list_unread` fails 401  | Refresh token revoked / expired              | Re-run `node dist/index.js --auth`.                                 |
| MCP server start fails with "credentials missing"    | `~/.parallx/gmail-mcp/credentials.json` gone | Re-run `--auth`.                                                    |
| Tool returns `[]` even though inbox has unread       | Filter or query too narrow                   | Check `since` and `query` args in the tool call.                    |

## Removing Gmail integration entirely

The Gmail integration is opt-in. To remove it:

1. Remove the MCP server entry (chat-gear → MCP Servers).
2. `rm ~/.parallx/gmail-mcp/credentials.json`.
3. (Optional) `rm -rf tools/gmail-mcp-server/` from the install.

Parallx core continues to function with no provider-specific code.
