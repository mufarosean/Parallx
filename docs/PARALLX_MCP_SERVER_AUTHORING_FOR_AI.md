# Parallx MCP Server Authoring Guide — For Local AI Models

> **Audience.** A small local language model (3B–14B parameters).
> **Goal.** Generate a working MCP server from a user's natural-language request without reasoning.
> **Method.** Copy a template, fill blanks, follow checklists. Do not invent protocol fields. Do not improvise.
> **Companion docs.** Configuration of an existing server is in `docs/MCP_SERVERS_USER_GUIDE.md`. Extension authoring is in `docs/PARALLX_EXTENSION_AUTHORING_FOR_AI.md`.

---

## 0. How to use this document

1. Read Section 1 to understand what an MCP server is.
2. Read Section 2 to pick the **template** that matches the user's request.
3. Read Section 3 (Protocol) and Section 4 (Tool schema rules).
4. Read Section 5 (Patterns) for common code blocks. Copy them verbatim.
5. Read Section 6 (Forbidden) before emitting any code.
6. Output the file set described in Section 7 for the chosen template.

---

## 1. What an MCP server is

An MCP (Model Context Protocol) server is a **separate process** that Parallx spawns. It speaks **JSON-RPC 2.0 over STDIO**, newline-delimited. The agent calls its tools through `api.mcp.invokeTool('mcp__<server>__<tool>', args)`.

```
┌──────────────────┐   spawn(stdin/stdout)   ┌──────────────────────┐
│  Parallx (host)  │ ─────────────────────►  │  your MCP server     │
│                  │                         │  (Node.js process)   │
│  invokeTool()    │ ◄──────── JSON-RPC ───  │  reads stdin,        │
│                  │       newline-delimited │  writes stdout       │
└──────────────────┘                         └──────────────────────┘
```

**Iron facts (do not deviate):**
- Transport: STDIO. Read JSON-RPC requests from `stdin`, one per line. Write responses to `stdout`, one per line.
- **`stdout` is reserved for JSON-RPC.** All logs go to `stderr`.
- Protocol version: `"2024-11-05"`.
- Runtime: **Node.js 18+**. Single-file ESM where possible.
- Distribution: published npm package runnable via `npx -y <pkg>`, OR a local script invoked as `node /abs/path/to/server.mjs`.

**Two distribution paths (pick one in Section 2):**
| Path | When |
|---|---|
| **A. Public npm package** | The user wants to share the server, or it's installable via `npx -y`. |
| **B. Local script** | The user wants a private/local server, single file, no publish step. |

---

## 2. Pick a template

Match the user's request to **exactly one** template.

| User asks for… | Template |
|---|---|
| "an MCP server that exposes a single tool", "a quick local tool" | **T1: Single-Tool Local Script** (Path B, single `.mjs` file) |
| "an MCP server with multiple tools" | **T2: Multi-Tool Local Script** (Path B) |
| "an MCP server I can publish to npm" | **T3: npm Package** (Path A, TypeScript) |
| "an MCP server that calls a REST API" | **T4: REST Wrapper** (Path B + `fetch`) |
| "an MCP server that reads/writes files" | **T5: Filesystem Tool** (Path B + Node `fs`) |
| "an MCP server that needs API keys / secrets" | **T6: Authenticated Server** (any path + env vars) |
| "an MCP server with OAuth" | **T7: OAuth Server** (advanced — see Section 5.10) |

Each template is fully spelled out in Section 7.

---

## 3. Protocol reference (deterministic)

### 3.1 Wire format

Every message is a **single line of JSON** terminated by `\n`. Parsers must:
- Split incoming bytes by `\n`.
- Trim each line.
- Skip blank lines.
- `JSON.parse` each non-blank line.

### 3.2 Methods you MUST implement

Parallx will only ever send these methods. Implement exactly these — no more, no less.

| Method | Direction | Response required? | Purpose |
|---|---|---|---|
| `initialize` | request | yes | Negotiate protocol version + announce capabilities. |
| `notifications/initialized` | notification | **no** | Sent after `initialize`. Has no `id`. Do not respond. |
| `tools/list` | request | yes | Return the array of tool schemas. |
| `tools/call` | request | yes | Invoke a tool by name. |
| `ping` | request | yes | Return empty `{}`. Health check. |

Any other method MUST return JSON-RPC error code `-32601` (method not found).

### 3.3 Request shape

```json
{ "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": { "name": "list_unread", "arguments": { "max": 10 } } }
```

Notifications have **no `id`**:
```json
{ "jsonrpc": "2.0", "method": "notifications/initialized" }
```

### 3.4 Response shapes

**Success:**
```json
{ "jsonrpc": "2.0", "id": 1, "result": { /* method-specific */ } }
```

**Error:**
```json
{ "jsonrpc": "2.0", "id": 1, "error": { "code": -32000, "message": "human-readable reason" } }
```

### 3.5 Method-specific result shapes

**`initialize` result (copy verbatim, only edit `name` and `version`):**
```json
{
  "protocolVersion": "2024-11-05",
  "capabilities": { "tools": {} },
  "serverInfo": { "name": "<server-id>", "version": "0.1.0" }
}
```

**`tools/list` result:**
```json
{ "tools": [ { "name": "...", "description": "...", "inputSchema": { /* JSON Schema */ } } ] }
```

**`tools/call` result (success):**
```json
{
  "content": [ { "type": "text", "text": "<JSON or human-readable string>" } ]
}
```

**`tools/call` result (tool reported error — HTTP-level success, MCP-level error):**
```json
{
  "content": [ { "type": "text", "text": "Error: cannot reach server" } ],
  "isError": true
}
```

**`ping` result:** `{}` (empty object).

### 3.6 Standard JSON-RPC error codes

Use these exact numbers:

| Code | Meaning | When |
|---|---|---|
| `-32700` | Parse error | malformed JSON received |
| `-32600` | Invalid request | `jsonrpc` not `"2.0"`, missing `method`, etc. |
| `-32601` | Method not found | unknown method or unknown tool name |
| `-32602` | Invalid params | tool args fail validation |
| `-32603` | Internal error | unexpected exception |
| `-32000` | Server error | application-level failure (auth, network, etc.) |

---

## 4. Tool schema rules

Every tool entry in `tools/list` MUST have these three fields:

| Field | Type | Rule |
|---|---|---|
| `name` | string | Lowercase, snake_case, ≤ 40 chars. Example: `list_unread`. |
| `description` | string | One sentence. Tells the agent **when** to use the tool. |
| `inputSchema` | JSON Schema (object) | Must be `type: "object"` with explicit `properties` and `additionalProperties: false`. |

**Description rules (small models often get this wrong):**
1. Start with a verb (`List`, `Search`, `Create`, `Read`, `Send`).
2. State **what** the tool returns or does.
3. State key constraints (read-only? max items? auth required?).
4. Do NOT mention prompt formatting or model behavior.
5. Bad: `"This tool can be used by the agent to maybe get some emails."`
   Good: `"List unread Gmail messages with sender, subject, and snippet. Read-only. Returns at most 100 items."`

**`inputSchema` rules:**
1. Always `type: "object"`.
2. Always `additionalProperties: false`.
3. Use `required: []` (empty) if all params are optional. Never omit `required`.
4. Each property has a `description`.
5. Use `enum` for closed sets. Use `minimum`/`maximum` for numbers.
6. Allowed property `type`: `"string"`, `"number"`, `"integer"`, `"boolean"`, `"array"`, `"object"`.

Example skeleton:
```json
{
  "type": "object",
  "properties": {
    "query":    { "type": "string",  "description": "Search text." },
    "max":      { "type": "integer", "minimum": 1, "maximum": 100, "description": "Max results. Default 25." },
    "format":   { "type": "string",  "enum": ["json", "text"], "description": "Output format." }
  },
  "required": [],
  "additionalProperties": false
}
```

**Tool result rules:**
1. Always return `{ content: [{ type: "text", text: "..." }] }`.
2. If the result is structured data, set `text` to `JSON.stringify(data)`.
3. If the result is human-readable, set `text` to the prose.
4. On tool failure, set `isError: true` and put the error message in `text`.
5. Keep `text` ≤ 64 KB. Truncate longer results and indicate truncation in the text.

---

## 5. Patterns (copy verbatim)

### 5.1 Minimal STDIO server skeleton (Node ESM, single file)

```js
#!/usr/bin/env node
// my-server.mjs — minimal MCP server skeleton

const SERVER_NAME = '<server-id>';
const SERVER_VERSION = '0.1.0';
const PROTOCOL_VERSION = '2024-11-05';

// ── Tool catalog ──────────────────────────────────────────────────
const TOOLS = [
  {
    name: 'echo',
    description: 'Return the input text unchanged. For smoke-testing the server.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to echo back.' },
      },
      required: ['text'],
      additionalProperties: false,
    },
  },
];

// ── Logging — stderr only (stdout is the JSON-RPC channel) ────────
const log = (msg) => process.stderr.write(`[${SERVER_NAME}] ${msg}\n`);
const logErr = (msg) => process.stderr.write(`[${SERVER_NAME}][error] ${msg}\n`);

// ── Wire helpers ──────────────────────────────────────────────────
const send = (res) => process.stdout.write(JSON.stringify(res) + '\n');
const ok   = (id, result) => ({ jsonrpc: '2.0', id, result });
const err  = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

// ── Tool dispatch ─────────────────────────────────────────────────
async function callTool(name, args) {
  switch (name) {
    case 'echo':
      return { content: [{ type: 'text', text: String(args.text ?? '') }] };
    default:
      throw Object.assign(new Error(`Unknown tool: ${name}`), { code: -32601 });
  }
}

// ── Method dispatch ───────────────────────────────────────────────
async function dispatch(req) {
  const { id, method, params } = req;
  switch (method) {
    case 'initialize':
      return ok(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      });
    case 'tools/list':
      return ok(id, { tools: TOOLS });
    case 'tools/call': {
      const name = String(params?.name ?? '');
      const args = (params?.arguments ?? {});
      try {
        const result = await callTool(name, args);
        return ok(id, result);
      } catch (e) {
        const code = e?.code ?? -32000;
        return err(id, code, e?.message ?? String(e));
      }
    }
    case 'ping':
      return ok(id, {});
    case 'notifications/initialized':
      return null; // no response for notifications
    default:
      return err(id, -32601, `Method not found: ${method}`);
  }
}

// ── stdin reader (line-delimited) ─────────────────────────────────
let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf('\n')) !== -1) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (line) handleLine(line);
  }
});
process.stdin.on('end', () => { log('stdin closed; exiting'); process.exit(0); });

async function handleLine(line) {
  let req;
  try { req = JSON.parse(line); }
  catch { logErr(`malformed JSON: ${line.slice(0, 120)}`); return; }
  if (req.jsonrpc !== '2.0' || typeof req.method !== 'string') {
    logErr('invalid envelope');
    return;
  }
  const isNotification = req.id === undefined || req.id === null;
  try {
    const res = await dispatch(req);
    if (res && !isNotification) send(res);
  } catch (e) {
    logErr(`dispatch error: ${e?.message ?? e}`);
    if (!isNotification) send(err(req.id, -32603, `Internal error: ${e?.message ?? e}`));
  }
}

log(`${SERVER_NAME} v${SERVER_VERSION} starting (protocol ${PROTOCOL_VERSION})`);
```

### 5.2 Adding a new tool

To add a tool, do **two** things — never one:
1. Append a schema to the `TOOLS` array (Section 4).
2. Add a `case '<name>':` in `callTool()`.

### 5.3 Reading env vars

```js
const apiKey = process.env.MY_API_KEY;
if (!apiKey) {
  // Fail fast inside the tool call so the agent sees a real error.
  throw Object.assign(new Error('MY_API_KEY is not set. Configure it in MCP Servers → Edit.'), { code: -32000 });
}
```

Never embed secrets in code. Always read from `process.env`.

### 5.4 Calling a REST API

```js
async function fetchJson(url, init = {}) {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw Object.assign(new Error(`HTTP ${res.status} ${res.statusText}: ${body.slice(0, 200)}`), { code: -32000 });
  }
  return res.json();
}
```

Always:
1. Check `res.ok`.
2. Include status + a snippet of the response body in the error message.
3. Use a `signal` from `AbortController` if the user can pass `timeoutMs` (cap at 60_000).

### 5.5 Reading and writing files (if required)

Always validate paths against an allowlist:
```js
import { realpath } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

async function safeResolve(allowedRoot, requested) {
  const root = await realpath(allowedRoot);
  const abs = resolve(root, requested);
  const real = await realpath(abs).catch(() => abs);
  if (real !== root && !real.startsWith(root + sep)) {
    throw Object.assign(new Error(`Path is outside allowed root: ${requested}`), { code: -32000 });
  }
  return real;
}
```

Allowed root comes from an env var, e.g. `process.env.MY_FS_ROOT`.

### 5.6 Logging discipline

```js
log('list_unread → 12 messages');     // counts and timings only
// NEVER:
// log(`subject: ${msg.subject}`);    // PII / privacy leak
// console.log(...)                    // stdout corruption
```

Rules:
- `console.log` is **forbidden** (writes to stdout). Use `log()` / `logErr()` (stderr).
- Never log message bodies, file contents, secrets, or full URLs with tokens.
- Log counts, durations, and tool names only.

### 5.7 Truncating large responses

```js
const MAX_RESPONSE_BYTES = 64 * 1024;
function truncate(text) {
  if (Buffer.byteLength(text, 'utf8') <= MAX_RESPONSE_BYTES) return text;
  const slice = Buffer.from(text, 'utf8').subarray(0, MAX_RESPONSE_BYTES).toString('utf8');
  return slice + '\n\n[truncated — output exceeded 64 KB]';
}
```

### 5.8 Cancellation (optional but preferred)

If a tool can take more than a few seconds:
```js
async function callTool(name, args) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), Math.min(args.timeoutMs ?? 30000, 60000));
  try {
    return await doWork(args, controller.signal);
  } finally {
    clearTimeout(t);
  }
}
```

### 5.9 Graceful shutdown

```js
process.on('SIGINT',  () => { log('SIGINT received');  process.exit(0); });
process.on('SIGTERM', () => { log('SIGTERM received'); process.exit(0); });
```

### 5.10 OAuth (advanced — only when the user explicitly asks)

Use this pattern only when the user requests OAuth. Two-mode binary:
- **Default mode:** runs as the MCP server.
- **`--auth` mode:** runs the one-time OAuth flow and exits.

```js
async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--auth')) {
    const code = await runAuthFlow();   // implement loopback + PKCE
    process.exit(code);
  }
  // … normal server startup
}
```

Persist refresh tokens to `~/.parallx/<server-id>/credentials.json` with file mode `0o600`. Refresh access tokens in-process. Never log token values.

---

## 6. Forbidden — never emit code that does any of these

1. **Do not** write to `stdout` for anything other than JSON-RPC responses.
2. **Do not** use `console.log`, `console.info`, `console.warn`. Use `process.stderr.write(...)`.
3. **Do not** use the `@modelcontextprotocol/sdk` unless the user explicitly asks for it. The hand-rolled skeleton in Section 5.1 is preferred — small models can't reliably configure the SDK.
4. **Do not** emit anything other than newline-terminated single-line JSON on stdout. No pretty-printing.
5. **Do not** respond to notifications (messages with no `id`). Silently dispatch them.
6. **Do not** hardcode secrets. Read from `process.env`.
7. **Do not** send Buffer / binary content. The MCP `content[]` array carries `{ type: "text", text: string }` only (this guide). Encode binary as base64 inside `text` if you must.
8. **Do not** spawn child processes from inside a tool unless absolutely required. Prefer a library call.
9. **Do not** swallow errors. Always return a JSON-RPC error response or `{ isError: true }` content.
10. **Do not** start an HTTP server. MCP transport is STDIO.
11. **Do not** invent JSON-RPC fields. Use only `jsonrpc`, `id`, `method`, `params`, `result`, `error`.
12. **Do not** ship a `package.json` with `"type": "commonjs"` for `.mjs` files. Use ESM (`"type": "module"`).
13. **Do not** use TypeScript syntax in `.mjs` / `.js` files. Plain ESM JavaScript only.
14. **Do not** register the server with Parallx automatically. The user adds it via Settings → MCP Servers (Section 8).

---

## 7. Templates (copy and fill the blanks)

Replace `<SERVER_ID>` (lowercase, hyphenated, e.g. `weather-mcp`), `<SERVER_DESC>`, `<TOOL_NAME>` (snake_case), `<TOOL_DESC>`.

### T1: Single-Tool Local Script

**Files:**
```
<SERVER_ID>/
└── server.mjs
```

`server.mjs`: copy Section 5.1 verbatim. Replace:
- `SERVER_NAME` → `'<SERVER_ID>'`
- The `TOOLS` array's single entry with the user's tool.
- The `callTool` body with the user's logic.

**How the user installs it:**
1. Save `server.mjs` somewhere on disk, e.g. `~/mcp/<SERVER_ID>/server.mjs`.
2. In Parallx: chat-gear → MCP Servers → + Add Server → **Custom** tab.
3. Fill in:
   - **ID:** `<SERVER_ID>`
   - **Display name:** human-readable
   - **Command:** `node`
   - **Args (one per line):** `/abs/path/to/server.mjs`
   - **Env vars:** any required env from Section 5.3.
4. Save.

### T2: Multi-Tool Local Script

Same as T1, but `TOOLS` has multiple entries and `callTool` has multiple `case` branches.

**Pattern:**
```js
const TOOLS = [
  { name: 'tool_a', description: '<TOOL_A_DESC>', inputSchema: { /* … */ } },
  { name: 'tool_b', description: '<TOOL_B_DESC>', inputSchema: { /* … */ } },
];

async function callTool(name, args) {
  switch (name) {
    case 'tool_a': return { content: [{ type: 'text', text: await doA(args) }] };
    case 'tool_b': return { content: [{ type: 'text', text: await doB(args) }] };
    default: throw Object.assign(new Error(`Unknown tool: ${name}`), { code: -32601 });
  }
}
```

### T3: npm Package

**Files:**
```
<SERVER_ID>/
├── package.json
├── README.md
└── src/
    └── index.mjs   (Section 5.1 skeleton, with shebang)
```

`package.json`:
```json
{
  "name": "@<scope>/<SERVER_ID>",
  "version": "0.1.0",
  "description": "<SERVER_DESC>",
  "type": "module",
  "bin": { "<SERVER_ID>": "src/index.mjs" },
  "files": ["src", "README.md"],
  "engines": { "node": ">=18" },
  "license": "MIT"
}
```

`src/index.mjs`: starts with `#!/usr/bin/env node` and contains the Section 5.1 skeleton.

**How the user installs it after `npm publish`:**
1. Parallx → MCP Servers → + Add Server → **Custom** tab.
2. **Command:** `npx`
3. **Args:** one per line — `-y`, `@<scope>/<SERVER_ID>`

### T4: REST Wrapper

Use T1 or T2 as the base. Add Section 5.4's `fetchJson` helper. Body of one tool:
```js
case 'search_<thing>': {
  const apiKey = process.env.<SERVER_ID_UPPER>_API_KEY;
  if (!apiKey) throw Object.assign(new Error('API key not set'), { code: -32000 });
  const url = new URL('https://api.example.com/search');
  url.searchParams.set('q', String(args.query ?? ''));
  url.searchParams.set('limit', String(Math.min(args.max ?? 10, 50)));
  const data = await fetchJson(url, { headers: { 'Authorization': `Bearer ${apiKey}` } });
  return { content: [{ type: 'text', text: JSON.stringify(data) }] };
}
```

`inputSchema` for the tool:
```json
{
  "type": "object",
  "properties": {
    "query": { "type": "string", "description": "Search text." },
    "max":   { "type": "integer", "minimum": 1, "maximum": 50, "description": "Max results. Default 10." }
  },
  "required": ["query"],
  "additionalProperties": false
}
```

### T5: Filesystem Tool

Use T1. Required env var: `<SERVER_ID_UPPER>_FS_ROOT`. Use `safeResolve` from Section 5.5 in every tool.

Example `read_file` tool body:
```js
case 'read_file': {
  const root = process.env.<SERVER_ID_UPPER>_FS_ROOT;
  if (!root) throw Object.assign(new Error('FS root not configured'), { code: -32000 });
  const path = await safeResolve(root, String(args.path ?? ''));
  const content = await import('node:fs/promises').then(m => m.readFile(path, 'utf8'));
  return { content: [{ type: 'text', text: truncate(content) }] };
}
```

### T6: Authenticated Server

Use T1, T2, or T4 as the base. Add to README:

```
Required env vars:
  <SERVER_ID_UPPER>_API_KEY   API key for <service>
```

In `callTool`, check the env var **inside** each tool that needs it (Section 5.3).

### T7: OAuth Server

Use Section 5.10. Beyond the scope of small models — if the user requests OAuth, output the structure (T3 npm package + `--auth` flag) and tell the user: **"OAuth flows are non-trivial. Implement `runAuthFlow()` using PKCE + a loopback redirect. See `tools/gmail-mcp-server/src/oauth.ts` in the Parallx repo for a reference."**

---

## 8. Manual install steps (include in your README output)

After generating the server, instruct the user to install it. Always emit this block as part of your final response, with `<SERVER_ID>` and the chosen command/args filled in.

> **To use this server in Parallx:**
> 1. Open the chat panel and click the **gear** icon (top-right of chat).
> 2. In **AI Settings**, click **MCP Servers** in the left sidebar.
> 3. Click **+ Add Server**, then choose the **Custom** tab.
> 4. Fill in:
>    - **ID:** `<SERVER_ID>`
>    - **Display name:** `<SERVER_ID>`
>    - **Command:** `<command>` (e.g. `node` or `npx`)
>    - **Args (one per line):** `<args>` (e.g. `/abs/path/to/server.mjs`, or `-y` then `@scope/<SERVER_ID>`)
>    - **Env vars:** any required env from the README.
> 5. Click **Save**. The row appears with status **● Connected** if the server starts cleanly. Hover the status badge to see stderr if it doesn't.
> 6. The agent can now call any tool as `mcp__<SERVER_ID>__<tool-name>`.

---

## 9. Final checklist (run before emitting)

Verify each of these:

**Protocol:**
- [ ] Implements `initialize`, `tools/list`, `tools/call`, `ping`, `notifications/initialized`.
- [ ] Returns `protocolVersion: "2024-11-05"` from `initialize`.
- [ ] Returns `capabilities: { tools: {} }` from `initialize`.
- [ ] Notifications (`id` is `undefined` or `null`) get **no** response.
- [ ] All other methods return error code `-32601`.

**Wire format:**
- [ ] Reads stdin as line-delimited UTF-8.
- [ ] Writes one-line JSON to stdout per response.
- [ ] No `console.log` / `console.info` / `console.warn` anywhere.
- [ ] All logs go to `process.stderr.write(...)`.

**Tools:**
- [ ] Every tool has `name` (snake_case), `description` (verb-led, one sentence), `inputSchema`.
- [ ] Every `inputSchema` is `type: "object"` with `additionalProperties: false`.
- [ ] Every `properties.*` has a `description`.
- [ ] Tool results are `{ content: [{ type: "text", text: "..." }] }`.
- [ ] Errors set `isError: true` OR return a JSON-RPC error response.

**Hygiene:**
- [ ] No secrets in source. All keys from `process.env`.
- [ ] Long outputs truncated to ≤ 64 KB.
- [ ] No `setInterval`/`setTimeout` left dangling on shutdown.
- [ ] `SIGINT` / `SIGTERM` handlers installed.
- [ ] Filesystem tools validate paths against an allowlist root.

**Distribution:**
- [ ] If npm package: `package.json` has `"type": "module"`, `"bin"`, `"engines.node": ">=18"`.
- [ ] If local script: file starts with `#!/usr/bin/env node`.
- [ ] README contains the Section 8 install steps.

If any box is unchecked, fix the code before responding.

---

## 10. Quick protocol cheatsheet

```
TRANSPORT      stdin/stdout, line-delimited JSON-RPC 2.0
PROTOCOL       2024-11-05
METHODS        initialize | notifications/initialized | tools/list | tools/call | ping
LOGGING        stderr only
TOOL RESULT    { content: [{ type: 'text', text: string }], isError?: boolean }
ERRORS         -32700 parse | -32600 invalid req | -32601 method not found
               -32602 invalid params | -32603 internal | -32000 server error
ENV VARS       only source of secrets
INVOKED AS     api.mcp.invokeTool('mcp__<server-id>__<tool-name>', args)   // from Parallx extensions
```

End of guide.
