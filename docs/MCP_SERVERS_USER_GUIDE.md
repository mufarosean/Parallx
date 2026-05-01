# MCP Servers — User Guide

This guide walks you through connecting external tools to Parallx via
**MCP (Model Context Protocol)** servers. You'll learn how to:

1. Connect the bundled **Gmail** server (no terminal, no setup).
2. Install other catalog servers (GitHub, Slack, Filesystem, Brave Search,
   Memory, Sequential Thinking, Fetch).
3. Add a fully custom MCP server (anything published as an `npx`/`node`
   STDIO server).

> **What is MCP?** A protocol that lets the chat agent call external
> tools — read your inbox, search the web, modify a GitHub repo, etc.
> Each server runs as a separate process Parallx spawns on demand.
> Parallx has zero hard-coded knowledge about any specific server; if
> it speaks MCP, Parallx can use it.

---

## Part 1 — Connect Gmail (bundled, no setup)

The Gmail server ships pre-built inside Parallx. You only need to grant
read-only access to your inbox via Google's standard consent screen.

### Step 1 — Open MCP Servers

1. Click the **gear icon** at the top-right of the chat panel.
   *(If your chat panel isn't visible: View → Toggle Chat.)*
2. The **AI Settings** panel opens.
3. In the left sidebar, click **MCP Servers**.

You'll see a section titled "MCP Servers" with a `+ Add Server` button.

### Step 2 — Open the catalog

1. Click **+ Add Server**.
2. A form appears with two tabs at the top: **Catalog** and **Custom**.
3. The **Catalog** tab is selected by default — leave it as-is.

You'll see a list of curated servers. Each one is a card with an
`Install` button on the right.

### Step 3 — Install Gmail

1. Find the **Gmail** card.
   - Title: **Gmail**
   - Tag: **Communication**
   - Description: *"Read-only Gmail access. Lists unread messages..."*
2. Click **Install** on the Gmail card.
3. The form changes to "Install Gmail". Gmail has no fields to fill in
   (it uses Parallx's bundled OAuth client), so just click the
   **Install** button at the bottom.
4. The form closes and a Gmail row appears in the list with status
   **Disconnected** and an **Authorize** button.

### Step 4 — Authorize

1. Click **Authorize** on the Gmail row.
2. The status badge changes to **"Authorizing — check your browser…"**.
3. Your **default web browser** opens to Google's sign-in page.
4. Sign in with the Google account you want Parallx to read.
5. You'll see Google's consent screen:
   - Title: *"Parallx wants to access your Google Account"*
   - Permission requested: **"View your email messages and settings"**
     (read-only — Gmail's `gmail.readonly` scope).
6. Click **Continue** (or **Allow**).
7. The browser shows *"Authorization complete — you can close this
   tab."*. Close the tab.
8. Switch back to Parallx. The Gmail row's status flips to
   **● Connected** (green dot).

That's it. The agent can now use the `list_unread` tool in chat,
heartbeat, cron, and subagent turns.

### Step 5 — Try it

In the chat input, type:

> *"How many unread emails do I have from the last 24 hours?"*

The agent will call the Gmail server's `list_unread` tool and report
back. Tool calls are logged in your autonomy event log — open
**View → Autonomy Events** to see them.

### What's stored where

| File / location | What's in it | Why |
|---|---|---|
| `~/.parallx/gmail-mcp/credentials.json` (mode `0600`) | Your refresh token + Google OAuth client ID/secret | So the server can refresh the access token without asking you again |
| In-memory only | Access token (60-min lifetime, auto-refreshed) | Never persisted to disk |
| Parallx workspace | The Gmail server's row config (no secrets) | So it survives app restarts |

> **Privacy.** The Gmail server **never reads message bodies**, only
> headers (sender, subject, snippet, received-at, labels). Bodies are
> never logged. Network traffic is restricted to
> `gmail.googleapis.com`, `oauth2.googleapis.com`, and
> `accounts.google.com`.

### Re-authorizing or revoking

- **Re-authorize** (e.g. you accidentally denied consent):
  Click **Remove** on the Gmail row, then **+ Add Server → Gmail →
  Install → Authorize** again.
- **Revoke entirely** (Parallx loses access immediately):
  Visit <https://myaccount.google.com/permissions>, find **Parallx**,
  click **Remove access**. Then delete
  `~/.parallx/gmail-mcp/credentials.json` to clean up local state.

### Troubleshooting

| Symptom | Fix |
|---|---|
| Status stuck on "Authorizing — check your browser…" for >2 minutes | Browser didn't open. Look at the bottom of the screen for a Parallx notification with the auth URL. Copy/paste it into a browser. |
| "Authorization failed" badge appears | Open the developer console (Help → Toggle Developer Tools → Console) for details. Most common cause: you denied consent in the Google screen. Click **Authorize** again. |
| Agent says "Gmail tool not available" | The row probably says **Disconnected**. Click **Authorize** (first time) or **Connect** (after first auth). |
| Status flickers between Connecting and Error | Look at the row's tooltip — it shows the underlying error. Most likely the credentials file got corrupted; **Remove** and re-install. |

---

## Part 2 — Install other catalog servers

The catalog has 8 servers as of writing:

| Server | What it does | Setup |
|---|---|---|
| **Filesystem** | Read/write files under an allowed root | Optional path |
| **GitHub** | Browse/edit repos via the REST API | GitHub PAT |
| **Gmail** | Read-only inbox listing | OAuth (Part 1) |
| **Slack** | Read/post messages | Bot token + team ID |
| **Brave Search** | Web search | Brave API key |
| **Memory** | Persistent key/value store | None |
| **Sequential Thinking** | Step-by-step reasoning helper | None |
| **Fetch** | Fetch URLs, convert HTML → markdown | None |

### General flow (any catalog server)

1. **Chat-gear** → **MCP Servers** → **+ Add Server**.
2. Confirm the **Catalog** tab is selected.
3. Find the server card. Click **Install**.
4. Fill in any required fields (marked with `*`).
5. Click **Install** at the bottom.
6. The row appears with status **Connecting…** and shortly **Connected**
   (auto-connect runs unless the server requires OAuth).

### Per-server setup details

#### Filesystem

- **Optional field:** Allowed root path. Absolute path the agent can
  read/write under. Leave blank to default to your workspace folder.
- After install, the row connects automatically. Try: *"List files in
  my workspace."*

#### GitHub

- **Required field:** GitHub PAT (personal access token).
- **How to get one:**
  1. Open <https://github.com/settings/tokens>.
  2. Click **Generate new token (classic)**.
  3. Name it something like `parallx-mcp`.
  4. Select scopes:
     - `repo` — full repo access (read/write code, issues, PRs)
     - `read:org` — list orgs and team membership
     - Add others as needed.
  5. Click **Generate token**. Copy the `ghp_...` string.
- Paste it into the **GitHub PAT** field, click **Install**.
- Try: *"List my open PRs."*

#### Slack

- **Required:** Bot token (`xoxb-...`) and Team ID (`T...`).
- **How to get them:**
  1. Open <https://api.slack.com/apps>. Click **Create New App** →
     **From scratch**.
  2. Name it (e.g. `Parallx`), pick your workspace.
  3. Sidebar: **OAuth & Permissions** → **Scopes** → **Bot Token
     Scopes**. Add at minimum:
     - `chat:write` — post messages
     - `channels:read` — list channels
     - `channels:history` — read channel messages
  4. Top of the same page: **Install to Workspace** → **Allow**.
  5. Copy the **Bot User OAuth Token** (`xoxb-...`).
  6. For the Team ID: in Slack, click your workspace name → **About
     this workspace** → copy the ID near the bottom (`T0123ABCD`).
- Paste both into the form, click **Install**.

#### Brave Search

- **Required:** Brave API key.
- **How to get one:** <https://api.search.brave.com> → Sign up → Free
  tier (2 000 queries/month, plenty for personal use). Copy the key.
- Paste, click **Install**.

#### Memory / Sequential Thinking / Fetch

- No fields. Click **Install**, done.

### After install

- Each server row shows status: **● Connected** (green), **○
  Disconnected** (grey), **● Unhealthy** (yellow), or **✕ Error** (red).
- Hover the dot for tooltip details (latency, last error).
- Click **Disconnect** to stop the process. Click **Connect** to
  restart it. Click **Remove** to delete the config.

---

## Part 3 — Add a custom MCP server

Use this for any server not in the catalog — your own MCP server, a
community-published one, or a private one your team hosts.

> **Limitation.** The Custom form only supports **STDIO** servers
> (Parallx spawns the process and talks over stdin/stdout). HTTP/SSE
> servers are not yet supported in the UI; they require editing the
> workspace MCP config file directly.

### Step 1 — Find the server's launch command

The MCP ecosystem distributes most servers as npm packages you launch
with `npx`. Read the server's README for the exact command. Examples:

- `npx -y @modelcontextprotocol/server-everything`
- `npx -y @some-org/some-mcp-server`
- `node /path/to/your/server.js`

### Step 2 — Open the Custom form

1. Chat-gear → **MCP Servers** → **+ Add Server**.
2. Click the **Custom** tab.
3. Four fields appear: Server ID, Display Name, Command, Environment.

### Step 3 — Fill in the fields

1. **Server ID** *(required)* — short lowercase identifier, e.g.
   `everything`, `mycompany-tools`. This is how Parallx and logs refer
   to the server. Must be unique across servers.
2. **Display Name** *(optional)* — friendly name for the UI, e.g.
   "Everything (test server)". Defaults to Server ID if blank.
3. **Command** *(required)* — the full launch line. Examples:
   ```
   npx -y @modelcontextprotocol/server-everything
   node C:\Users\you\code\my-mcp\dist\index.js
   ```
4. **Environment** *(optional)* — one `KEY=VALUE` per line. Examples:
   ```
   API_KEY=sk-abc123
   LOG_LEVEL=debug
   PYTHONUNBUFFERED=1
   ```
   - Lines starting with `#` are ignored.
   - Quoted values (`"..."` or `'...'`) have their quotes stripped.
   - Blank lines are ignored.

### Step 4 — Save

1. Click **Save & connect**.
2. The form closes; the row appears with status **Connecting…**.
3. Within a few seconds the status flips to **● Connected**.

### If it fails to connect

1. Hover the **✕ Error** dot for a quick error tooltip.
2. Open **Help → Toggle Developer Tools → Console** for the full
   stderr from the server process.
3. Common causes:
   - **`spawn npx ENOENT`** — Node.js / npm isn't installed or not on
     `PATH`. Install Node 18+ from <https://nodejs.org>.
   - **Server prints help and exits** — your command is missing
     required arguments (e.g. `--port`, a positional path).
   - **Authentication error in stderr** — fix the env-var value.
   - **Server starts but no tools appear** — it might not be MCP-spec
     compliant. Look for a `tools/list` response in the server's logs.
4. Click **Remove**, fix the command/env, and try again.

### Testing your config without leaving Parallx

Once connected, ask the agent:

> *"What MCP tools do I have available?"*

It will list every tool from every connected server. If the new
server's tools show up, you're done. If they don't, the server
connected but didn't register any tools — check its README for what
it should expose.

---

## Glossary

| Term | Meaning |
|---|---|
| **MCP** | Model Context Protocol — open standard for tool servers |
| **STDIO transport** | Parallx talks to the server over stdin/stdout pipes |
| **Tool** | A single callable function the server exposes (e.g. `list_unread`) |
| **OAuth bootstrap** | Parallx's helper that runs the server's `--auth` mode in a child process so users never see a terminal |
| **Catalog** | Parallx's curated list of well-tested MCP servers |
| **Custom server** | Any MCP server the user adds manually via Command + Args |

---

## Where to look next

- Per-server tool list: ask the agent *"what MCP tools are available?"*
- The Gmail server's source + technical details:
  [tools/gmail-mcp-server/README.md](../tools/gmail-mcp-server/README.md)
- Building your own MCP server: <https://modelcontextprotocol.io/>
- Curated community catalog beyond Parallx's built-in list:
  <https://github.com/modelcontextprotocol/servers>
