#!/usr/bin/env node

// src/index.ts
import { setDefaultResultOrder } from "node:dns";

// src/gmailClient.ts
var GMAIL_API_HOST = "gmail.googleapis.com";
var GMAIL_API_BASE = `https://${GMAIL_API_HOST}/gmail/v1`;
var GmailClient = class {
  constructor(accessToken) {
    this.accessToken = accessToken;
    if (!accessToken) {
      throw new Error("GmailClient: accessToken is required");
    }
  }
  /**
   * List unread messages. Combines `is:unread` with optional caller
   * query and `since` filter. Returns hydrated message metadata.
   */
  async listUnread(opts) {
    const max = Math.max(1, Math.min(100, Math.floor(opts.max)));
    const queryParts = [];
    const readState = opts.readState ?? "unread";
    if (readState === "unread") queryParts.push("is:unread");
    else if (readState === "read") queryParts.push("-is:unread");
    if (opts.query) queryParts.push(`(${opts.query})`);
    if (opts.since) {
      const epoch = Math.floor(new Date(opts.since).getTime() / 1e3);
      if (Number.isFinite(epoch)) queryParts.push(`after:${epoch}`);
    }
    const q = queryParts.join(" ").trim();
    const listUrl = new URL(`${GMAIL_API_BASE}/users/me/messages`);
    if (q) listUrl.searchParams.set("q", q);
    listUrl.searchParams.set("maxResults", String(max));
    const listRes = await this.fetchAuthorized(listUrl.toString());
    const listJson = await listRes.json();
    const ids = (listJson.messages ?? []).map((m) => m.id).slice(0, max);
    if (ids.length === 0) return [];
    const CONCURRENCY = 6;
    const includeBody = opts.includeBody === true;
    const hydrated = new Array(ids.length);
    let cursor = 0;
    const workers = Array.from({ length: Math.min(CONCURRENCY, ids.length) }, async () => {
      while (true) {
        const i = cursor++;
        if (i >= ids.length) return;
        hydrated[i] = await this.getMessageMetadata(ids[i], includeBody);
      }
    });
    await Promise.all(workers);
    const messages = hydrated.filter((m) => m !== null);
    messages.sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
    return messages;
  }
  async getMessageMetadata(id, includeBody = false) {
    const url = new URL(`${GMAIL_API_BASE}/users/me/messages/${encodeURIComponent(id)}`);
    if (includeBody) {
      url.searchParams.set("format", "full");
    } else {
      url.searchParams.set("format", "metadata");
      url.searchParams.append("metadataHeaders", "From");
      url.searchParams.append("metadataHeaders", "Subject");
    }
    const res = await this.fetchAuthorized(url.toString());
    const json = await res.json();
    if (!json.id) return null;
    const headers = json.payload?.headers ?? [];
    const findHeader = (name) => {
      const h = headers.find((x) => x.name.toLowerCase() === name.toLowerCase());
      return h?.value ?? "";
    };
    const fromRaw = findHeader("From");
    const subject = findHeader("Subject");
    const internalDateMs = Number(json.internalDate ?? "0");
    const receivedAt = Number.isFinite(internalDateMs) && internalDateMs > 0 ? new Date(internalDateMs).toISOString() : (/* @__PURE__ */ new Date(0)).toISOString();
    let body;
    if (includeBody && json.payload) {
      body = extractPlainBody(json.payload);
    }
    return {
      id: json.id,
      threadId: json.threadId ?? "",
      from: fromRaw,
      subject,
      snippet: json.snippet ?? "",
      receivedAt,
      labels: Object.freeze([...json.labelIds ?? []]),
      ...body !== void 0 ? { body } : {}
    };
  }
  async fetchAuthorized(url) {
    const parsed = new URL(url);
    if (parsed.host !== GMAIL_API_HOST) {
      throw new Error(`GmailClient: refused egress to non-Gmail host: ${parsed.host}`);
    }
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        Accept: "application/json"
      }
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Gmail API error ${res.status}: ${body.slice(0, 256)}`);
    }
    return res;
  }
};
var MAX_BODY_BYTES = 8 * 1024;
function decodeBase64Url(data) {
  try {
    return Buffer.from(data, "base64url").toString("utf8");
  } catch {
    const std = data.replace(/-/g, "+").replace(/_/g, "/");
    const pad = std.length % 4 === 0 ? "" : "=".repeat(4 - std.length % 4);
    try {
      return Buffer.from(std + pad, "base64").toString("utf8");
    } catch {
      return "";
    }
  }
}
function findPart(part, mime) {
  if (!part) return void 0;
  if (part.mimeType === mime && part.body?.data && !part.filename) {
    return decodeBase64Url(part.body.data);
  }
  if (Array.isArray(part.parts)) {
    for (const child of part.parts) {
      const found = findPart(child, mime);
      if (found) return found;
    }
  }
  return void 0;
}
function stripHtml(html) {
  return html.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/\s+/g, " ").trim();
}
function extractPlainBody(payload) {
  let text = findPart(payload, "text/plain");
  if (!text) {
    const html = findPart(payload, "text/html");
    if (html) text = stripHtml(html);
  }
  if (!text) return "";
  const buf = Buffer.from(text, "utf8");
  if (buf.byteLength <= MAX_BODY_BYTES) return text;
  return buf.subarray(0, MAX_BODY_BYTES).toString("utf8");
}

// src/oauth.ts
import { createHash, randomBytes } from "node:crypto";
var GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
var GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
var GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
function base64Url(buf) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function generatePkcePair() {
  const codeVerifier = base64Url(randomBytes(48));
  const codeChallenge = base64Url(createHash("sha256").update(codeVerifier).digest());
  return { codeVerifier, codeChallenge };
}
function generateState() {
  return base64Url(randomBytes(16));
}
function buildAuthUrl(opts) {
  const params = new URLSearchParams({
    client_id: opts.clientId,
    response_type: "code",
    scope: opts.scope ?? GMAIL_READONLY_SCOPE,
    redirect_uri: opts.redirectUri,
    state: opts.state,
    code_challenge: opts.codeChallenge,
    code_challenge_method: "S256",
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true"
  });
  return `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`;
}
async function exchangeCodeForTokens(opts) {
  const body = new URLSearchParams({
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
    code: opts.code,
    code_verifier: opts.codeVerifier,
    grant_type: "authorization_code",
    redirect_uri: opts.redirectUri
  });
  const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString()
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`token exchange failed: HTTP ${res.status} ${text}`);
  }
  const json = await res.json();
  if (typeof json.access_token !== "string" || typeof json.expires_in !== "number") {
    throw new Error("token exchange returned malformed payload");
  }
  return json;
}
async function refreshAccessToken(opts) {
  const body = new URLSearchParams({
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
    refresh_token: opts.refreshToken,
    grant_type: "refresh_token"
  });
  const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString()
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`token refresh failed: HTTP ${res.status} ${text}`);
  }
  const json = await res.json();
  if (typeof json.access_token !== "string" || typeof json.expires_in !== "number") {
    throw new Error("token refresh returned malformed payload");
  }
  return json;
}

// src/loopback.ts
import { createServer } from "node:http";
var SUCCESS_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Parallx Gmail MCP</title>
<style>body{font-family:system-ui,sans-serif;max-width:480px;margin:80px auto;padding:0 20px;color:#222}
h1{font-size:20px}p{line-height:1.5}</style></head>
<body><h1>Authorization complete</h1>
<p>You can close this tab and return to your terminal.</p>
</body></html>`;
var ERROR_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Parallx Gmail MCP \u2014 error</title>
<style>body{font-family:system-ui,sans-serif;max-width:480px;margin:80px auto;padding:0 20px;color:#222}
h1{font-size:20px;color:#b00020}p{line-height:1.5}</style></head>
<body><h1>Authorization failed</h1>
<p>Check the terminal running <code>--auth</code> for details. You can close this tab.</p>
</body></html>`;
async function startLoopback() {
  let resolveRedirect = () => {
  };
  let rejectRedirect = () => {
  };
  const redirectPromise = new Promise((resolve, reject) => {
    resolveRedirect = resolve;
    rejectRedirect = reject;
  });
  const server = createServer((req, res) => {
    if (!req.url) {
      res.statusCode = 400;
      res.end();
      return;
    }
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname !== "/") {
      res.statusCode = 404;
      res.end();
      return;
    }
    const hasCode = url.searchParams.has("code");
    const hasError = url.searchParams.has("error");
    if (!hasCode && !hasError) {
      res.statusCode = 400;
      res.end();
      return;
    }
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(hasError ? ERROR_HTML : SUCCESS_HTML);
    resolveRedirect(url);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  const redirectUri = `http://127.0.0.1:${addr.port}`;
  const timeout = setTimeout(() => {
    rejectRedirect(new Error("OAuth redirect timed out after 5 minutes"));
    server.close();
  }, 5 * 60 * 1e3);
  timeout.unref();
  return {
    redirectUri,
    waitForRedirect: () => redirectPromise.finally(() => {
      clearTimeout(timeout);
      server.close();
    }),
    close: () => {
      clearTimeout(timeout);
      server.close();
    }
  };
}

// src/credStore.ts
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
function defaultCredPath() {
  const envPath = process.env["PARALLX_GMAIL_CRED_PATH"];
  if (envPath && typeof envPath === "string") return envPath;
  return join(homedir(), ".parallx", "gmail-mcp", "credentials.json");
}
async function readCredentials(path = defaultCredPath()) {
  let raw;
  try {
    raw = await fs.readFile(path, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`credentials file is not valid JSON: ${path}`);
  }
  const c = parsed;
  if (c?.version !== 1 || typeof c.client_id !== "string" || typeof c.client_secret !== "string" || typeof c.refresh_token !== "string" || typeof c.scope !== "string" || typeof c.obtained_at !== "string") {
    throw new Error(`credentials file has unexpected shape: ${path}`);
  }
  return c;
}
async function writeCredentials(creds, path = defaultCredPath()) {
  const dir = dirname(path);
  await fs.mkdir(dir, { recursive: true });
  const tmp = `${path}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(creds, null, 2), { mode: 384 });
  try {
    await fs.chmod(tmp, 384);
  } catch {
  }
  await fs.rename(tmp, path);
}

// src/bundledOAuthClient.ts
import { readFileSync } from "node:fs";
import { homedir as homedir2 } from "node:os";
import { join as join2 } from "node:path";
function oauthClientConfigPath() {
  return join2(homedir2(), ".parallx", "gmail-mcp", "oauth-client.json");
}
function loadBundledOAuthClient() {
  const envId = process.env.GMAIL_OAUTH_CLIENT_ID;
  const envSecret = process.env.GMAIL_OAUTH_CLIENT_SECRET;
  if (envId && envSecret) {
    return { clientId: envId, clientSecret: envSecret };
  }
  try {
    const raw = readFileSync(oauthClientConfigPath(), "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.client_id === "string" && typeof parsed.client_secret === "string") {
      return { clientId: parsed.client_id, clientSecret: parsed.client_secret };
    }
  } catch {
  }
  return { clientId: "", clientSecret: "" };
}
var _bundled = loadBundledOAuthClient();
var BUNDLED_GMAIL_OAUTH_CLIENT_ID = _bundled.clientId;
var BUNDLED_GMAIL_OAUTH_CLIENT_SECRET = _bundled.clientSecret;

// src/authCli.ts
function out(msg) {
  process.stderr.write(msg + "\n");
}
async function runAuth() {
  const clientId = process.env.GMAIL_OAUTH_CLIENT_ID || BUNDLED_GMAIL_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GMAIL_OAUTH_CLIENT_SECRET || BUNDLED_GMAIL_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    out("error: no OAuth client configured. This build is missing the bundled");
    out("Parallx OAuth client. Set GMAIL_OAUTH_CLIENT_ID and");
    out("GMAIL_OAUTH_CLIENT_SECRET in the environment to override.");
    return 2;
  }
  out("Starting loopback listener on 127.0.0.1...");
  const loopback = await startLoopback();
  out(`Loopback ready: ${loopback.redirectUri}`);
  const pkce = generatePkcePair();
  const state = generateState();
  const authUrl = buildAuthUrl({
    clientId,
    redirectUri: loopback.redirectUri,
    state,
    codeChallenge: pkce.codeChallenge,
    scope: GMAIL_READONLY_SCOPE
  });
  out("");
  out("Open this URL in your browser to authorize Gmail (read-only):");
  out("");
  out("  " + authUrl);
  out("");
  out("Waiting for redirect (5 min timeout)...");
  let redirectUrl;
  try {
    redirectUrl = await loopback.waitForRedirect();
  } catch (err) {
    out(`error: ${err.message}`);
    return 1;
  }
  const errParam = redirectUrl.searchParams.get("error");
  if (errParam) {
    const desc = redirectUrl.searchParams.get("error_description") ?? "";
    out(`error: OAuth provider returned error: ${errParam}${desc ? ` (${desc})` : ""}`);
    return 1;
  }
  const code = redirectUrl.searchParams.get("code");
  const returnedState = redirectUrl.searchParams.get("state");
  if (!code) {
    out("error: redirect missing `code` parameter");
    return 1;
  }
  if (returnedState !== state) {
    out("error: state mismatch \u2014 possible CSRF, refusing to exchange code");
    return 1;
  }
  out("Exchanging authorization code for tokens...");
  let tokens;
  try {
    tokens = await exchangeCodeForTokens({
      clientId,
      clientSecret,
      code,
      codeVerifier: pkce.codeVerifier,
      redirectUri: loopback.redirectUri
    });
  } catch (err) {
    out(`error: ${err.message}`);
    return 1;
  }
  if (!tokens.refresh_token) {
    out("error: token endpoint did not return a refresh_token.");
    out("Revoke prior consent at https://myaccount.google.com/permissions");
    out("and re-run --auth.");
    return 1;
  }
  const credPath = defaultCredPath();
  await writeCredentials(
    {
      version: 1,
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: tokens.refresh_token,
      scope: tokens.scope || GMAIL_READONLY_SCOPE,
      obtained_at: (/* @__PURE__ */ new Date()).toISOString()
    },
    credPath
  );
  out("");
  out(`\u2713 Credentials saved to ${credPath} (mode 600).`);
  out("  You can now register this server in Parallx:");
  out("    chat-gear \u2192 MCP Servers \u2192 + Add Server");
  out("    name:    gmail");
  out("    command: node");
  out("    args:    <absolute-path-to>/tools/gmail-mcp-server/bundle/server.mjs");
  return 0;
}

// src/index.ts
try {
  setDefaultResultOrder("ipv4first");
} catch {
}
var SERVER_NAME = "parallx-gmail-mcp";
var SERVER_VERSION = "0.1.0";
var PROTOCOL_VERSION = "2024-11-05";
var LIST_UNREAD_TOOL = {
  name: "list_unread",
  description: "List Gmail messages with sender, subject, snippet, received-at, thread id, and labels. Read-only. Defaults to unread; pass read_state to widen the search.",
  inputSchema: {
    type: "object",
    properties: {
      since: {
        type: "string",
        description: "ISO 8601 \u2014 only return mail received after this timestamp."
      },
      max: {
        type: "number",
        description: "Max messages to return. 1-100. Default 25.",
        minimum: 1,
        maximum: 100
      },
      query: {
        type: "string",
        description: 'Optional Gmail search query, e.g. "from:alice OR is:important".'
      },
      read_state: {
        type: "string",
        enum: ["unread", "read", "all"],
        description: 'Read-state filter. "unread" (default) preserves legacy is:unread; "read" returns only seen mail; "all" applies no read-state constraint.'
      },
      include_body: {
        type: "boolean",
        description: "Include decoded plain-text body (truncated to 8 KB). Default false. Set true when callers (e.g. transaction-extractor pipelines) need the email body and not just the snippet preview."
      }
    },
    additionalProperties: false
  }
};
function logInfo(msg) {
  process.stderr.write(`[gmail-mcp] ${msg}
`);
}
function logError(msg) {
  process.stderr.write(`[gmail-mcp][error] ${msg}
`);
}
function writeResponse(res) {
  process.stdout.write(JSON.stringify(res) + "\n");
}
function makeError(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}
function handleInitialize(id) {
  return {
    jsonrpc: "2.0",
    id,
    result: {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION }
    }
  };
}
function handleToolsList(id) {
  return {
    jsonrpc: "2.0",
    id,
    result: { tools: [LIST_UNREAD_TOOL] }
  };
}
var tokenCache = null;
var TOKEN_REFRESH_SKEW_MS = 6e4;
async function getAccessToken() {
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt - TOKEN_REFRESH_SKEW_MS > now) {
    return tokenCache.accessToken;
  }
  const creds = await readCredentials();
  if (!creds) {
    throw new Error(
      "no credentials on disk \u2014 run `node dist/index.js --auth` first"
    );
  }
  const tokens = await refreshAccessToken({
    clientId: creds.client_id,
    clientSecret: creds.client_secret,
    refreshToken: creds.refresh_token
  });
  tokenCache = {
    accessToken: tokens.access_token,
    expiresAt: now + tokens.expires_in * 1e3
  };
  return tokens.access_token;
}
async function handleToolsCall(id, params) {
  const name = String(params?.name ?? "");
  const args = params?.arguments ?? {};
  if (name !== "list_unread") {
    return makeError(id, -32601, `Unknown tool: ${name}`);
  }
  let accessToken;
  try {
    accessToken = await getAccessToken();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return makeError(id, -32e3, message);
  }
  const rawReadState = args.read_state;
  const readState = rawReadState === "read" || rawReadState === "all" || rawReadState === "unread" ? rawReadState : "unread";
  const input = {
    since: typeof args.since === "string" ? args.since : void 0,
    max: typeof args.max === "number" ? args.max : 25,
    query: typeof args.query === "string" ? args.query : void 0,
    read_state: readState,
    include_body: args.include_body === true
  };
  try {
    const client = new GmailClient(accessToken);
    const messages = await client.listUnread({
      max: input.max ?? 25,
      query: input.query,
      since: input.since,
      readState,
      includeBody: input.include_body === true
    });
    const output = { messages };
    logInfo(`list_unread \u2192 ${messages.length} message(s)`);
    return {
      jsonrpc: "2.0",
      id,
      result: {
        content: [
          {
            type: "text",
            text: JSON.stringify(output)
          }
        ]
      }
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const cause = err && typeof err === "object" ? err.cause : void 0;
    let causeStr = "";
    if (cause) {
      const c = cause;
      causeStr = ` (cause: ${c.code ?? c.message ?? String(cause)})`;
    }
    logError(`list_unread failed: ${message}${causeStr}`);
    return makeError(id, -32001, `list_unread failed: ${message}${causeStr}`);
  }
}
function handlePing(id) {
  return { jsonrpc: "2.0", id, result: {} };
}
async function dispatch(req) {
  switch (req.method) {
    case "initialize":
      return handleInitialize(req.id);
    case "tools/list":
      return handleToolsList(req.id);
    case "tools/call":
      return handleToolsCall(req.id, req.params);
    case "ping":
      return handlePing(req.id);
    case "notifications/initialized":
      return null;
    default:
      return makeError(req.id, -32601, `Method not found: ${req.method}`);
  }
}
function startReader() {
  let buffer = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buffer += chunk;
    let nl = buffer.indexOf("\n");
    while (nl !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line.length > 0) void handleLine(line);
      nl = buffer.indexOf("\n");
    }
  });
  process.stdin.on("end", () => {
    logInfo("stdin closed; exiting");
    process.exit(0);
  });
}
async function handleLine(line) {
  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch {
    logError(`malformed JSON: ${line.slice(0, 120)}`);
    return;
  }
  if (parsed.jsonrpc !== "2.0" || typeof parsed.method !== "string") {
    logError(`invalid JSON-RPC envelope`);
    return;
  }
  const isNotification = parsed.id === void 0 || parsed.id === null;
  try {
    const response = await dispatch(parsed);
    if (response && !isNotification) writeResponse(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logError(`dispatch error: ${message}`);
    if (!isNotification && parsed.id !== void 0) {
      writeResponse(makeError(parsed.id, -32603, `Internal error: ${message}`));
    }
  }
}
async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--auth")) {
    const code = await runAuth();
    process.exit(code);
  }
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stderr.write(
      `${SERVER_NAME} v${SERVER_VERSION}

Usage:
  node dist/index.js            run as MCP server (STDIO JSON-RPC)
  node dist/index.js --auth     authorize Gmail (one-time)
  node dist/index.js --help     show this help

Auth env vars (only required for --auth):
  GMAIL_OAUTH_CLIENT_ID
  GMAIL_OAUTH_CLIENT_SECRET
`
    );
    process.exit(0);
  }
  logInfo(`${SERVER_NAME} v${SERVER_VERSION} starting (protocol ${PROTOCOL_VERSION})`);
  startReader();
}
void main();
