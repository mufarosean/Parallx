// gmailOAuthService.ts — M60 §T6.F2
//
// Google OAuth 2.0 Desktop-app flow with PKCE, used by the Gmail MCP
// server (T6.F1) for the read-only `gmail.readonly` scope.
//
// Trust boundary
// ──────────────
//   • client_id is **public-by-design** in installed-app OAuth clients
//     (RFC 8252 §8.4). Treat it as discoverable, not secret.
//   • client_secret on a desktop client is **not actually a secret**
//     either (it ships in the binary), but Google still requires it
//     for token exchange. We accept it as a settings field but never
//     log it.
//   • Refresh token IS sensitive; persisted via secret-storage IPC
//     in F3 (`src/services/secretStorageService.ts`). This service
//     stays storage-agnostic — callers wire up persistence.
//   • Access token never touches disk. Lives in this service's memory
//     for its `expires_in` window, then is refreshed.
//
// Loopback redirect
// ─────────────────
//   The full RFC 8252 desktop flow uses `http://127.0.0.1:<random>` as
//   the redirect URI and listens on that port to catch the auth code.
//   The localhost listener requires an additional IPC handler
//   (`oauth:awaitLoopback`) which is NOT yet user-approved. Until that
//   lands, callers complete the flow in two steps:
//     1. `beginAuthFlow()` returns { authUrl, codeVerifier, state, redirectUri }
//     2. UI calls `parallxElectron.shell.openExternal(authUrl)`
//     3. Browser shows "this site can't be reached" on the localhost
//        redirect; the user copies the full URL bar contents
//     4. `completeAuthFlow(redirectUrl, codeVerifier, state)` parses
//        the URL and exchanges the code.
//   This is a known UX limitation; documented in
//   docs/ai/GMAIL_MCP_INTEGRATION.md.
//
// Tests cover (M60 §T6.F2 dispatch):
//   • PKCE generation (verifier length + challenge derivation)
//   • Auth URL building (params, scope, response_type, state)
//   • Token exchange (mock fetch)
//   • Refresh (mock fetch)

const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

/**
 * Stub client_id / client_secret. Settings overrides take precedence;
 * if neither is set, the service refuses to begin a flow with a clear
 * error.
 *
 * The string `__STUB_CLIENT_ID__` / `__STUB_CLIENT_SECRET__` is a
 * sentinel — release builds DO NOT ship a working OAuth client. End
 * users must register their own under
 * https://console.cloud.google.com → OAuth client (Desktop app) and
 * paste the credentials into Settings (`mcp.gmail.clientId` /
 * `mcp.gmail.clientSecret`).
 */
export const STUB_CLIENT_ID = '__STUB_CLIENT_ID__';
export const STUB_CLIENT_SECRET = '__STUB_CLIENT_SECRET__';

// ─── Types ────────────────────────────────────────────────────────────

export interface IPkcePair {
  readonly codeVerifier: string;
  readonly codeChallenge: string;
  readonly codeChallengeMethod: 'S256';
}

export interface IBeginAuthOptions {
  readonly clientId: string;
  /** Defaults to the read-only Gmail scope. */
  readonly scope?: string;
  /** Loopback redirect URI; defaults to `http://127.0.0.1:0`. */
  readonly redirectUri?: string;
  /** Random state for CSRF protection. Auto-generated if omitted. */
  readonly state?: string;
  /** Inject a PKCE pair (tests). Auto-generated otherwise. */
  readonly pkce?: IPkcePair;
}

export interface IBeginAuthResult {
  readonly authUrl: string;
  readonly codeVerifier: string;
  readonly state: string;
  readonly redirectUri: string;
}

export interface IGoogleTokenResponse {
  readonly access_token: string;
  readonly refresh_token?: string;
  readonly expires_in: number;
  readonly scope: string;
  readonly token_type: string;
  readonly id_token?: string;
}

export interface IExchangeCodeParams {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly code: string;
  readonly codeVerifier: string;
  readonly redirectUri: string;
}

export interface IRefreshTokenParams {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly refreshToken: string;
}

/**
 * Minimal `fetch` shape this module depends on. Tests inject a mock.
 */
export type FetchFn = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

// ─── PKCE primitives ──────────────────────────────────────────────────

/**
 * Generate a PKCE code verifier per RFC 7636 §4.1: 43–128 chars,
 * base64url alphabet. We default to 64 chars (~384 bits of entropy).
 */
export function generateCodeVerifier(): string {
  const bytes = new Uint8Array(48); // 48 bytes → 64 base64url chars
  const cryptoApi = (globalThis as { crypto?: Crypto }).crypto;
  if (!cryptoApi) {
    throw new Error('gmailOAuthService: crypto.getRandomValues unavailable');
  }
  cryptoApi.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

/**
 * Derive the S256 code challenge from a verifier per RFC 7636 §4.2:
 * `BASE64URL-ENCODE(SHA256(ASCII(code_verifier)))`.
 */
export async function deriveCodeChallenge(verifier: string): Promise<string> {
  const subtle = (globalThis as { crypto?: { subtle?: SubtleCrypto } }).crypto?.subtle;
  if (!subtle) {
    throw new Error('gmailOAuthService: SubtleCrypto unavailable');
  }
  const data = new TextEncoder().encode(verifier);
  const buf = await subtle.digest('SHA-256', data);
  return base64UrlEncode(new Uint8Array(buf));
}

export async function generatePkcePair(): Promise<IPkcePair> {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await deriveCodeChallenge(codeVerifier);
  return { codeVerifier, codeChallenge, codeChallengeMethod: 'S256' };
}

function base64UrlEncode(bytes: Uint8Array): string {
  // Convert to base64 then strip padding + map +/ → -_.
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const b64 = (typeof btoa === 'function')
    ? btoa(bin)
    // Node fallback — vitest sometimes runs without DOM.
    : Buffer.from(bytes).toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function generateState(): string {
  const bytes = new Uint8Array(16);
  const cryptoApi = (globalThis as { crypto?: Crypto }).crypto;
  if (!cryptoApi) {
    throw new Error('gmailOAuthService: crypto.getRandomValues unavailable');
  }
  cryptoApi.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

// ─── Auth URL ─────────────────────────────────────────────────────────

/**
 * Build the Google OAuth consent URL for an installed-app PKCE flow.
 * Includes `access_type=offline` so Google issues a refresh token, and
 * `prompt=consent` so re-running the flow always returns one (Google
 * omits the refresh token on subsequent grants without it).
 */
export function buildAuthUrl(opts: {
  readonly clientId: string;
  readonly scope: string;
  readonly redirectUri: string;
  readonly state: string;
  readonly codeChallenge: string;
}): string {
  const params = new URLSearchParams({
    client_id: opts.clientId,
    response_type: 'code',
    scope: opts.scope,
    redirect_uri: opts.redirectUri,
    state: opts.state,
    code_challenge: opts.codeChallenge,
    code_challenge_method: 'S256',
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
  });
  return `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`;
}

// ─── Token endpoint calls ─────────────────────────────────────────────

export async function exchangeCodeForTokens(
  params: IExchangeCodeParams,
  fetchFn: FetchFn = (globalThis as { fetch?: FetchFn }).fetch as FetchFn,
): Promise<IGoogleTokenResponse> {
  if (!fetchFn) throw new Error('gmailOAuthService: fetch is unavailable');
  const body = new URLSearchParams({
    client_id: params.clientId,
    client_secret: params.clientSecret,
    code: params.code,
    code_verifier: params.codeVerifier,
    grant_type: 'authorization_code',
    redirect_uri: params.redirectUri,
  });
  const res = await fetchFn(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`token exchange failed: HTTP ${res.status} ${text}`);
  }
  const json = (await res.json()) as IGoogleTokenResponse;
  if (typeof json.access_token !== 'string' || typeof json.expires_in !== 'number') {
    throw new Error('token exchange returned malformed payload');
  }
  return json;
}

export async function refreshAccessToken(
  params: IRefreshTokenParams,
  fetchFn: FetchFn = (globalThis as { fetch?: FetchFn }).fetch as FetchFn,
): Promise<IGoogleTokenResponse> {
  if (!fetchFn) throw new Error('gmailOAuthService: fetch is unavailable');
  const body = new URLSearchParams({
    client_id: params.clientId,
    client_secret: params.clientSecret,
    refresh_token: params.refreshToken,
    grant_type: 'refresh_token',
  });
  const res = await fetchFn(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`token refresh failed: HTTP ${res.status} ${text}`);
  }
  const json = (await res.json()) as IGoogleTokenResponse;
  if (typeof json.access_token !== 'string' || typeof json.expires_in !== 'number') {
    throw new Error('token refresh returned malformed payload');
  }
  return json;
}

// ─── Flow orchestration ───────────────────────────────────────────────

/**
 * Begin an auth flow. Caller must:
 *   1. Open `result.authUrl` in the user's browser.
 *   2. Capture the redirect URL (paste-from-browser until loopback IPC
 *      lands).
 *   3. Call `completeAuthFlow(redirectUrl, codeVerifier, state)`.
 */
export async function beginAuthFlow(opts: IBeginAuthOptions): Promise<IBeginAuthResult> {
  if (!opts.clientId) throw new Error('clientId is required');
  const scope = opts.scope ?? GMAIL_READONLY_SCOPE;
  const redirectUri = opts.redirectUri ?? 'http://127.0.0.1:0';
  const state = opts.state ?? generateState();
  const pkce = opts.pkce ?? (await generatePkcePair());
  const authUrl = buildAuthUrl({
    clientId: opts.clientId,
    scope,
    redirectUri,
    state,
    codeChallenge: pkce.codeChallenge,
  });
  return {
    authUrl,
    codeVerifier: pkce.codeVerifier,
    state,
    redirectUri,
  };
}

/**
 * Complete an auth flow: parse a redirect URL, validate state, exchange
 * the auth code for tokens.
 */
export async function completeAuthFlow(opts: {
  readonly redirectUrl: string;
  readonly codeVerifier: string;
  readonly state: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
  readonly fetchFn?: FetchFn;
}): Promise<IGoogleTokenResponse> {
  let parsed: URL;
  try {
    parsed = new URL(opts.redirectUrl);
  } catch {
    throw new Error('redirectUrl is not a valid URL');
  }
  const err = parsed.searchParams.get('error');
  if (err) {
    throw new Error(`OAuth error: ${err}${parsed.searchParams.get('error_description') ? ` (${parsed.searchParams.get('error_description')})` : ''}`);
  }
  const code = parsed.searchParams.get('code');
  const returnedState = parsed.searchParams.get('state');
  if (!code) throw new Error('redirectUrl missing `code` parameter');
  if (returnedState !== opts.state) {
    // CSRF / state mismatch — refuse to exchange.
    throw new Error('redirectUrl state does not match expected state');
  }
  return exchangeCodeForTokens(
    {
      clientId: opts.clientId,
      clientSecret: opts.clientSecret,
      code,
      codeVerifier: opts.codeVerifier,
      redirectUri: opts.redirectUri,
    },
    opts.fetchFn,
  );
}

// ─── Constants exported for tests ─────────────────────────────────────

export const _internals = {
  GOOGLE_AUTH_ENDPOINT,
  GOOGLE_TOKEN_ENDPOINT,
  GMAIL_READONLY_SCOPE,
};

// ─── Persistence wiring (F3) ──────────────────────────────────────────
//
// Refresh tokens persist via secret-storage; access tokens stay in
// memory. These helpers keep that contract testable without coupling
// the OAuth protocol module to the secret-storage IPC.

import { GMAIL_REFRESH_TOKEN_KEY, type ISecretStorageService } from './secretStorageService.js';

/**
 * Persist a refresh token (if present) returned from a token endpoint
 * call. No-op if the response carries no refresh_token (Google omits
 * it on subsequent grants without `prompt=consent`).
 */
export async function persistRefreshToken(
  tokens: IGoogleTokenResponse,
  secretStorage: ISecretStorageService,
): Promise<{ ok: boolean; error?: string }> {
  if (!tokens.refresh_token) return { ok: true };
  return secretStorage.setString(GMAIL_REFRESH_TOKEN_KEY, tokens.refresh_token);
}

/**
 * Load the persisted refresh token. Returns `undefined` when not yet
 * stored or when the secret bridge is unavailable.
 */
export async function loadPersistedRefreshToken(
  secretStorage: ISecretStorageService,
): Promise<string | undefined> {
  const r = await secretStorage.getString(GMAIL_REFRESH_TOKEN_KEY);
  if (!r.ok || typeof r.value !== 'string' || r.value.length === 0) return undefined;
  return r.value;
}

/**
 * Clear the persisted refresh token (Disconnect Gmail flow).
 */
export async function clearPersistedRefreshToken(
  secretStorage: ISecretStorageService,
): Promise<{ ok: boolean; error?: string }> {
  return secretStorage.delete(GMAIL_REFRESH_TOKEN_KEY);
}

/**
 * In-memory access token cache. Refresh-on-expiry is callers' job;
 * this just holds the value for the current process lifetime.
 *
 * F3 contract: access tokens MUST NOT be persisted. This class has no
 * persistence path on purpose.
 */
export class InMemoryAccessTokenCache {
  private _value?: { readonly token: string; readonly expiresAt: number };

  /** Store a freshly-obtained access token + ttl. */
  set(token: string, expiresInSec: number, now: () => number = Date.now): void {
    this._value = { token, expiresAt: now() + expiresInSec * 1000 };
  }

  /** Returns the token if still valid (with 30s skew margin), else undefined. */
  get(now: () => number = Date.now): string | undefined {
    if (!this._value) return undefined;
    if (now() + 30_000 >= this._value.expiresAt) return undefined;
    return this._value.token;
  }

  clear(): void { this._value = undefined; }
}

