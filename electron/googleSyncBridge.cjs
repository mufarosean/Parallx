// electron/googleSyncBridge.cjs — main-process Google OAuth + authenticated REST
// for the planner's two-way Google Calendar / Tasks sync.
//
// Why this lives in the main process (not the renderer):
//   • The OAuth redirect needs a localhost HTTP listener (RFC 8252 §7.3) — the
//     renderer can't open a socket.
//   • The long-lived refresh token must never enter the renderer; it stays in
//     `app.safeStorage` (same contract as the Brave key in webFetchBridge.cjs).
//   • Google's token/REST endpoints don't emit CORS headers a renderer `fetch`
//     would need; a main-process fetch has no such restriction.
//
// The PKCE + loopback logic mirrors the proven flow in
// tools/gmail-mcp-server/src/{oauth,loopback}.ts. That server is a separate
// bundled package, so this is a deliberate copy/adapt rather than an import.

const { createServer } = require('node:http');
const { createHash, randomBytes } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { homedir } = require('node:os');
const nodePath = require('node:path');
const { shell } = require('electron');

// ─── Endpoints / constants ───────────────────────────────────────────────────

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v2/userinfo';

// google:fetch is host-allowlisted — the renderer can only reach the Google
// API surface, never arbitrary hosts with the bearer token.
const ALLOWED_HOSTS = new Set(['www.googleapis.com']);
const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

const REFRESH_TOKEN_SECRET_KEY = 'google.sync.refresh_token';
const ACCOUNT_SECRET_KEY = 'google.sync.account';

const DEFAULT_SCOPES = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/tasks',
];

// Single-account: the in-memory access token never touches disk.
let _accessTokenCache = null; // { token: string, expiresAtMs: number }

// ─── OAuth client credentials (public-by-design for desktop apps) ─────────────
// Lookup order mirrors tools/gmail-mcp-server/src/bundledOAuthClient.ts but
// generalized: env → ~/.parallx/google → reuse ~/.parallx/gmail-mcp if the user
// pointed both at one Google Cloud project. Accepts the raw console download
// shape ({ installed: {...} }) as well as a flat { client_id, client_secret }.

function loadOAuthClient() {
  const envId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const envSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (envId && envSecret) return { clientId: envId, clientSecret: envSecret };

  const candidates = [
    nodePath.join(homedir(), '.parallx', 'google', 'oauth-client.json'),
    nodePath.join(homedir(), '.parallx', 'gmail-mcp', 'oauth-client.json'),
  ];
  for (const p of candidates) {
    try {
      const parsed = JSON.parse(readFileSync(p, 'utf8'));
      const inst = parsed.installed || parsed.web || parsed;
      if (inst && typeof inst.client_id === 'string' && typeof inst.client_secret === 'string') {
        return { clientId: inst.client_id, clientSecret: inst.client_secret };
      }
    } catch {
      // missing / invalid — try next
    }
  }
  return { clientId: '', clientSecret: '' };
}

// ─── PKCE helpers (RFC 7636) ──────────────────────────────────────────────────

function _base64Url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function _generatePkcePair() {
  const codeVerifier = _base64Url(randomBytes(48));
  const codeChallenge = _base64Url(createHash('sha256').update(codeVerifier).digest());
  return { codeVerifier, codeChallenge };
}

function _generateState() {
  return _base64Url(randomBytes(16));
}

function _buildAuthUrl({ clientId, redirectUri, state, codeChallenge, scope }) {
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    scope,
    redirect_uri: redirectUri,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    access_type: 'offline',
    prompt: 'consent', // force a refresh_token even on re-auth
    include_granted_scopes: 'true',
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

async function _exchangeCodeForTokens({ clientId, clientSecret, code, codeVerifier, redirectUri }) {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    code_verifier: codeVerifier,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
  });
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`token exchange failed: HTTP ${res.status} ${text}`);
  }
  return res.json();
}

async function _refreshAccessToken({ clientId, clientSecret, refreshToken }) {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`token refresh failed: HTTP ${res.status} ${text}`);
  }
  return res.json();
}

// ─── One-shot loopback redirect listener on 127.0.0.1:0 ───────────────────────

const _LOOPBACK_HTML = `<!doctype html><html><head><meta charset="utf-8">
<title>Parallx — Google sync</title>
<style>body{font-family:system-ui,sans-serif;max-width:480px;margin:80px auto;padding:0 20px;color:#222}
h1{font-size:20px}p{line-height:1.5}</style></head>
<body><h1>Authorization complete</h1>
<p>You can close this tab and return to Parallx.</p></body></html>`;

async function _startLoopback() {
  let resolveRedirect = () => {};
  let rejectRedirect = () => {};
  const redirectPromise = new Promise((resolve, reject) => {
    resolveRedirect = resolve;
    rejectRedirect = reject;
  });

  const server = createServer((req, res) => {
    if (!req.url) { res.statusCode = 400; res.end(); return; }
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname !== '/') { res.statusCode = 404; res.end(); return; }
    if (!url.searchParams.has('code') && !url.searchParams.has('error')) {
      res.statusCode = 400; res.end(); return;
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(_LOOPBACK_HTML);
    resolveRedirect(url);
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const addr = server.address();
  const redirectUri = `http://127.0.0.1:${addr.port}`;
  const timeout = setTimeout(() => {
    rejectRedirect(new Error('OAuth redirect timed out after 5 minutes'));
    server.close();
  }, 5 * 60 * 1000);
  timeout.unref();

  return {
    redirectUri,
    waitForRedirect: () => redirectPromise.finally(() => { clearTimeout(timeout); server.close(); }),
    close: () => { clearTimeout(timeout); try { server.close(); } catch { /* already closed */ } },
  };
}

// ─── Token management ─────────────────────────────────────────────────────────

async function _getAccessToken(secrets, { forceRefresh = false } = {}) {
  if (!forceRefresh && _accessTokenCache && _accessTokenCache.expiresAtMs > Date.now() + 60_000) {
    return _accessTokenCache.token;
  }
  const refreshToken = await secrets.readSecret(REFRESH_TOKEN_SECRET_KEY);
  if (!refreshToken) throw new Error('not-connected');
  const client = loadOAuthClient();
  if (!client.clientId || !client.clientSecret) throw new Error('no-oauth-client');
  const tok = await _refreshAccessToken({
    clientId: client.clientId,
    clientSecret: client.clientSecret,
    refreshToken,
  });
  if (typeof tok.access_token !== 'string' || typeof tok.expires_in !== 'number') {
    throw new Error('malformed-token-response');
  }
  _accessTokenCache = { token: tok.access_token, expiresAtMs: Date.now() + tok.expires_in * 1000 };
  return tok.access_token;
}

// ─── Flows ────────────────────────────────────────────────────────────────────

async function _authorize(secrets, scopes) {
  const client = loadOAuthClient();
  if (!client.clientId || !client.clientSecret) {
    return { ok: false, error: 'no-oauth-client' };
  }
  const loop = await _startLoopback();
  try {
    const pkce = _generatePkcePair();
    const state = _generateState();
    const scope = (Array.isArray(scopes) && scopes.length ? scopes : DEFAULT_SCOPES).join(' ');
    const authUrl = _buildAuthUrl({
      clientId: client.clientId,
      redirectUri: loop.redirectUri,
      state,
      codeChallenge: pkce.codeChallenge,
      scope,
    });
    await shell.openExternal(authUrl);

    const redirect = await loop.waitForRedirect();
    if (redirect.searchParams.get('state') !== state) return { ok: false, error: 'state-mismatch' };
    const authError = redirect.searchParams.get('error');
    if (authError) return { ok: false, error: authError };
    const code = redirect.searchParams.get('code');
    if (!code) return { ok: false, error: 'no-code' };

    const tokens = await _exchangeCodeForTokens({
      clientId: client.clientId,
      clientSecret: client.clientSecret,
      code,
      codeVerifier: pkce.codeVerifier,
      redirectUri: loop.redirectUri,
    });
    if (typeof tokens.access_token !== 'string') return { ok: false, error: 'no-access-token' };
    // refresh_token only comes back on first consent; prompt=consent forces it.
    if (typeof tokens.refresh_token !== 'string') return { ok: false, error: 'no-refresh-token' };

    await secrets.writeSecret(REFRESH_TOKEN_SECRET_KEY, tokens.refresh_token);
    _accessTokenCache = {
      token: tokens.access_token,
      expiresAtMs: Date.now() + (tokens.expires_in || 3600) * 1000,
    };

    let email = '';
    try {
      const res = await fetch(USERINFO_ENDPOINT, { headers: { Authorization: `Bearer ${tokens.access_token}` } });
      if (res.ok) {
        const j = await res.json();
        if (j && typeof j.email === 'string') email = j.email;
      }
    } catch {
      // userinfo is best-effort; connection still succeeded
    }
    if (email) await secrets.writeSecret(ACCOUNT_SECRET_KEY, email);

    return { ok: true, email };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  } finally {
    loop.close();
  }
}

async function _apiFetch(secrets, method, urlStr, body) {
  const verb = typeof method === 'string' ? method.toUpperCase() : 'GET';
  if (!ALLOWED_METHODS.has(verb)) return { ok: false, error: 'method-not-allowed' };

  let url;
  try { url = new URL(urlStr); } catch { return { ok: false, error: 'bad-url' }; }
  if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname)) {
    return { ok: false, error: 'host-not-allowed' };
  }

  const send = (token) => fetch(url.toString(), {
    method: verb,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body != null ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });

  let token;
  try { token = await _getAccessToken(secrets); }
  catch (err) { return { ok: false, error: err.message }; }

  let res;
  try { res = await send(token); }
  catch (err) { return { ok: false, error: err && err.message ? err.message : String(err) }; }

  // One forced refresh + retry on 401 (token revoked / clock skew).
  if (res.status === 401) {
    try { token = await _getAccessToken(secrets, { forceRefresh: true }); }
    catch (err) { return { ok: false, error: err.message }; }
    try { res = await send(token); }
    catch (err) { return { ok: false, error: err && err.message ? err.message : String(err) }; }
  }

  const text = await res.text().catch(() => '');
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch { /* keep null for 204 / non-JSON */ } }

  if (!res.ok) {
    const msg = (data && data.error && (data.error.message || data.error)) || `HTTP ${res.status}`;
    return { ok: false, status: res.status, error: String(msg), data };
  }
  return { ok: true, status: res.status, data };
}

// ─── IPC registration ─────────────────────────────────────────────────────────

function setupGoogleSyncBridge(ipcMain, _appRoot, secrets) {
  if (!ipcMain || typeof ipcMain.handle !== 'function') {
    throw new Error('[GoogleSyncBridge] ipcMain.handle is required');
  }
  if (!secrets
    || typeof secrets.readSecret !== 'function'
    || typeof secrets.writeSecret !== 'function'
    || typeof secrets.deleteSecret !== 'function') {
    throw new Error('[GoogleSyncBridge] secrets {readSecret,writeSecret,deleteSecret} are required');
  }

  ipcMain.handle('google:authorize', async (_event, scopes) =>
    _authorize(secrets, Array.isArray(scopes) ? scopes.filter((s) => typeof s === 'string') : null));

  ipcMain.handle('google:status', async () => {
    const refresh = await secrets.readSecret(REFRESH_TOKEN_SECRET_KEY);
    const email = await secrets.readSecret(ACCOUNT_SECRET_KEY);
    return { connected: !!refresh, email: email || null, hasClient: !!loadOAuthClient().clientId };
  });

  ipcMain.handle('google:disconnect', async () => {
    _accessTokenCache = null;
    await secrets.deleteSecret(REFRESH_TOKEN_SECRET_KEY);
    await secrets.deleteSecret(ACCOUNT_SECRET_KEY);
    return { ok: true };
  });

  ipcMain.handle('google:fetch', async (_event, opts) => {
    const safe = opts && typeof opts === 'object' ? opts : {};
    return _apiFetch(secrets, safe.method, safe.url, safe.body);
  });
}

module.exports = { setupGoogleSyncBridge };
