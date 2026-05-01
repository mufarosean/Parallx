# Gmail MCP integration — user setup guide

> **Status:** Phase η F1 + F5 landed. F2 (OAuth) + F3 (safeStorage) +
> F4 (`gmail.list_unread` tool registration) are pending IPC approval —
> see `docs/Parallx_Milestone_60.md` §18 Phase η for status. This guide
> describes the intended end-state user flow.

Parallx integrates with your Gmail inbox through a small, read-only MCP
server (`tools/gmail-mcp-server/`) plus an in-app OAuth 2.0 desktop
flow. No mail bodies ever cross into the agent. Subjects, senders,
snippets, labels, and timestamps are returned to the agent so it can
triage, summarize, and route — with your approval.

## What gets installed where

| Component                         | Location                                  | Trust boundary                          |
|-----------------------------------|-------------------------------------------|-----------------------------------------|
| Gmail MCP server                  | `tools/gmail-mcp-server/dist/`            | Spawned as a Node child process.        |
| OAuth client config (your input)  | Settings → Integrations → Gmail            | Stored in user-scope settings.          |
| Refresh token (after sign-in)     | `<userData>/secrets/gmail-tokens.enc`     | Encrypted via Electron `safeStorage`.   |
| Access token (transient)          | In-memory only                            | Never persisted to disk.                |

## One-time setup

1. **Create an OAuth client.**
   - Open [Google Cloud Console](https://console.cloud.google.com/apis/credentials).
   - Create credentials → OAuth client ID → Application type: **Desktop app**.
   - Note the **Client ID** and **Client Secret**.
   - Add the following OAuth scope to the consent screen:
     `https://www.googleapis.com/auth/gmail.readonly`.

2. **Paste credentials into Parallx.**
   - Open Parallx → `Ctrl+,` → search for **gmail**.
   - Set:
     - `mcp.gmail.clientId` — paste your Client ID.
     - `mcp.gmail.clientSecret` — paste your Client Secret. (Stored as
       a secret-marked setting; encrypted at rest.)
   - Toggle `mcp.gmail.enabled` → on.

3. **Sign in.**
   - Click **Sign in with Google** in the Gmail settings panel.
   - Parallx opens your default browser to Google's OAuth consent
     screen via the `shell:openExternal` IPC (https-only allowlist).
   - **Loopback gap (Phase η):** until the loopback-listener IPC is
     approved, Parallx does **not** automatically catch the redirect.
     After consenting, copy the redirected URL from your browser's
     address bar and paste it back into Parallx when prompted. The
     full `code` + `state` query params travel together, so a single
     paste suffices. M61 will replace this with an in-process loopback
     listener.
   - On paste, Parallx exchanges the auth code for a refresh token,
     encrypts it via `safeStorage`, and stores it under
     `<APP_ROOT>/data/secrets/<sha256(key)[:32]>.enc` (M53-portable).
     **Portability tradeoff:** because the encrypted blob lives inside
     the Parallx install directory rather than `<userData>`, it travels
     with the app when the install folder is moved. The OS-level
     keychain still gates decryption, so a copied install on a
     different user account cannot decrypt the token.

4. **Test the connection.**
   - Open chat → ask: *"What unread email do I have?"*
   - The agent calls the `gmail.list_unread` tool.
   - First call requires approval (the tool ships at the
     **require-approval** permission tier). After approval the tool can
     be remembered via the §3.7 pattern memory if you choose.

## How it runs

```
┌─────────────────────────┐         spawn (mcp:spawn IPC)
│ Parallx renderer        │  ─────────────────────────────────►  ┌──────────────────────────────┐
│  • gmail.list_unread    │                                       │ tools/gmail-mcp-server       │
│    tool call            │                                       │ (Node child process)         │
│  • passes access token  │  GMAIL_ACCESS_TOKEN env var           │                              │
│    via env at spawn     │                                       │  • STDIO JSON-RPC (MCP)      │
│                         │                                       │  • fetch → gmail.googleapis  │
│                         │  ◄─────────────────────────────────   │  • metadata format only      │
│                         │     {messages: [...]} on stdout       │  • body never fetched        │
└─────────────────────────┘                                       └──────────────────────────────┘
        │
        ▼
  AutonomyEventLog: records the call with argsDigest only.
  Subjects, snippets, and bodies are NEVER written to the audit log.
```

Token lifecycle:

- **Access token** (~1 hour TTL) lives in main-process memory, injected
  into each spawned MCP child via env. Never written to disk. When
  expired, Parallx refreshes it and respawns the child.
- **Refresh token** (long-lived) lives in
  `<APP_ROOT>/data/secrets/<sha256('mcp.gmail.refreshToken')[:32]>.enc`,
  encrypted by `safeStorage`. Decryption is gated on the OS-level
  user keychain. Path lives under `APP_ROOT` (M53 portable storage)
  rather than `<userData>` so the install is self-contained when
  relocated; see the portability tradeoff in step 3.

## What the tool can read

| Returned to agent     | Source                                                            |
|-----------------------|-------------------------------------------------------------------|
| Message id            | `users.messages.list` response                                    |
| `From:` header        | `users.messages.get?format=metadata&metadataHeaders=From`         |
| `Subject:` header     | `users.messages.get?format=metadata&metadataHeaders=Subject`     |
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

Settings → Integrations → Gmail → **Disconnect Gmail**. This:

1. Revokes the refresh token at Google's side via
   `https://oauth2.googleapis.com/revoke` (when reachable).
2. Deletes the encrypted blob at
   `<APP_ROOT>/data/secrets/<sha256('mcp.gmail.refreshToken')[:32]>.enc`
   via the `secret:delete` IPC.
3. Sets `mcp.gmail.enabled = false`.
4. Kills any running Gmail MCP child process.

You can also disable without revoking: just toggle `mcp.gmail.enabled`
off — the refresh token stays encrypted at rest.

## Network egress

The Parallx Gmail MCP server reaches **only** `gmail.googleapis.com`.
The `GmailClient.fetchAuthorized` method enforces this with an explicit
host check that throws on any other host. The OAuth flow itself reaches
`accounts.google.com` (browser-driven) and `oauth2.googleapis.com`
(Parallx main process).

## Linux note

Electron's `safeStorage` requires a system keyring on Linux
(gnome-keyring, kwallet, etc.). When the keyring is unavailable,
the `secret:set` IPC handler returns a typed error:

```
{ ok: false, error: 'safe-storage-unavailable' }
```

Parallx never falls through to plaintext storage in this state — the
refresh token is simply not persisted, sign-in surfaces the error, and
the Gmail tool reports "Gmail OAuth not configured" until the keyring
is available. Install + start gnome-keyring or kwallet before
connecting Gmail on Linux.

This behavior is identical across dev and production builds (the
F3-plan dev/production split was simplified during η implementation
in favor of a single typed-error contract).

## Troubleshooting

| Symptom                                        | Cause                              | Fix                                                              |
|------------------------------------------------|------------------------------------|------------------------------------------------------------------|
| "Gmail MCP is disabled" tool error             | `mcp.gmail.enabled = false`        | Settings → Integrations → Gmail → toggle on.                     |
| "GMAIL_ACCESS_TOKEN env var is not set"        | Tool spawned without OAuth         | Sign in (Settings → Integrations → Gmail).                       |
| "safe-storage-unavailable" on Linux            | No keyring                         | Install + start gnome-keyring or kwallet.                        |
| "Gmail API error 401"                          | Token revoked / expired refresh    | Disconnect + re-sign-in.                                         |
| Tool returns `[]` even though inbox has unread | Filter or query too narrow         | Check `since` and `query` args.                                  |

## Security review

See [Parallx_Milestone_60.md §9.5](../Parallx_Milestone_60.md) for the
full M60 security review controls. Highlights:

- Read-only scope (`gmail.readonly`).
- Process isolation (separate Node child).
- Network egress allowlist (`gmail.googleapis.com`).
- Encrypted token storage (`safeStorage`).
- Audit log with argsDigest (never bodies).
- Revocation path (in-app + Google account).
