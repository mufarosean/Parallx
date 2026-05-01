# Milestone 62 — MCP-Only Provider Integration

**Status:** in progress
**Branch:** `milestone-62`
**Predecessor:** M61 (Unified Settings UI)

---

## Vision

> Parallx core ships chat, an autonomy substrate, and an MCP runtime. Everything
> provider-specific (Gmail, Slack, Calendar, Jira, …) is an MCP server, not a
> built-in feature. The user installs an MCP server to gain a capability and
> removes it to lose that capability — no core code change, no orphaned
> settings, no surprises.

This milestone retracts the parts of M60 §T6 (F2–F4) that baked Gmail-specific
OAuth, settings, and tool wrappers into Parallx core. That direction was the
wrong call: it implied Parallx "knows about Gmail," coupled core to a single
provider, and made the integration hard for a user to opt out of.

The MCP runtime already exists. The MCP Servers UI already exists. Users
already add servers via that UI today. M62 finishes the story by deleting the
duplicated Gmail-specific path and ensuring autonomous turns (cron / heartbeat
/ subagent) see MCP tools the same as foreground turns.

---

## Principles

1. **No provider names in core.** No `mcp.gmail.*`, `mcp.slack.*`, `mcp.notion.*`
   settings. Provider config lives with the provider's MCP server.
2. **OAuth lives in the MCP server.** The server handles its own auth, persists
   its own refresh token, and refreshes its own access tokens. Parallx never
   sees provider credentials.
3. **One way to connect external systems: the MCP Servers UI.** Add server →
   capability gained. Remove server → capability lost. No other path.
4. **Autonomous turns see the same tool catalog as foreground turns.** Cron,
   heartbeat, and subagent executors must include MCP tools in their tool
   catalogs; otherwise the workbench has two-tier capability and the autonomy
   story fragments.

---

## What gets removed from core

| File / surface | Reason |
|---|---|
| `src/services/gmailOAuthService.ts` | OAuth belongs in the MCP server |
| `src/built-in/chat/tools/gmailTools.ts` | Built-in `gmail.list_unread` wrapper duplicates what the MCP server exposes |
| `mcp.gmail.enabled` / `mcp.gmail.clientId` / `mcp.gmail.clientSecret` settings | Provider-specific config does not belong in core settings |
| `gmail.disconnect` command | "Disconnecting" = removing the MCP entry |
| `GMAIL_REFRESH_TOKEN_KEY` in `secretStorageService.ts` | The MCP server stores its own creds |
| `gmail` parameter in `registerBuiltInTools` | No longer wired |
| Tests covering the above | Deleted with their subjects |

## What gets added or fixed

| Surface | Change |
|---|---|
| `tools/gmail-mcp-server/` | Becomes self-contained. Adds OAuth (PKCE), `--auth` bootstrap subcommand, loopback redirect listener, on-disk creds with `chmod 600`, in-process access-token refresh. |
| Cron / heartbeat / subagent tool catalogs | If the audit (W1) shows MCP tools are not surfaced, fix the catalog construction so they are. Add a regression test. |
| `docs/USER_GUIDE.md` and `docs/ai/GMAIL_AUTONOMY_WALKTHROUGH.md` | Rewrite. End state: install server → run `--auth` → add to MCP Servers list. No Cloud Console steps in core docs. |

---

## Phases

### W1 — Audit MCP-tools-to-autonomous-turns wiring

Read-only investigation. Goal: produce a clear answer to "do cron, heartbeat,
and subagent executors include MCP tools in their tool catalogs?" If yes, W2
is a no-op. If no, W2 is "make them."

### W2 — Fix MCP→autonomous wiring (if W1 finds gaps)

Wire the MCP tool registry into the cron/heartbeat/subagent executors. Add a
unit test asserting that an autonomous turn's tool catalog contains MCP tools
when an MCP server is registered.

### W3 — Make `tools/gmail-mcp-server/` self-contained

Port the relevant pieces of `gmailOAuthService.ts` into the MCP server. Add an
`--auth` subcommand. Persist creds to `~/.parallx/gmail-mcp/credentials.json`
with `chmod 600`. Server reads creds at startup and refreshes access tokens
in-process.

### W4 — Delete provider-specific core code

Remove the files / settings / commands listed in the "What gets removed" table.
Keep the change atomic so the working tree is consistent.

### W5 — Update docs

Rewrite the walkthrough and user-guide entries to the MCP-only flow.

### W6 — Verify

`npx tsc --noEmit` clean. `npx vitest run` green. Manual smoke test of the
cron→Gmail digest path against the new self-contained MCP server.

---

## Non-goals

- Adding new providers (Slack, etc.) — out of scope. M62 just removes Gmail
  from core; the same MCP-only pattern applies to any provider but no new
  servers are written here.
- Rewriting the MCP runtime itself — out of scope.
- Per-MCP-server approval policy UX — out of scope (M61's tool-policy UI
  already covers this surface).

---

## Success criteria

- `git grep -i gmail src/` returns nothing.
- A user can connect Gmail by: installing `tools/gmail-mcp-server/`, running
  `node dist/index.js --auth`, and adding it via the MCP Servers UI. No Cloud
  Console step is required after the first `--auth` run because the server
  ships a Parallx-owned OAuth client.
- A cron job calling `gmail_list_unread` (or whatever the server names the
  tool) succeeds at fire-time, not just in foreground turns.
- `npx tsc --noEmit` produces no output.
- `npx vitest run` reports green across all files.
- The unified Settings overlay (`Ctrl+Alt+S`) contains zero rows whose key
  starts with `mcp.<provider-name>.`.
