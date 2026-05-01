// oauth.ts — Google OAuth 2.0 PKCE flow for desktop apps (RFC 8252).
//
// Self-contained: no imports from Parallx core. Uses Node's built-in
// `crypto` and `fetch` (Node 18+).
//
// Trust model
// ───────────
//   • client_id / client_secret are public-by-design for installed
//     OAuth clients (RFC 8252 §8.4). They ship next to the binary or
//     in env vars — treat them as discoverable, not secret.
//   • Refresh token IS sensitive; persisted to disk in credStore.ts
//     with chmod 600.
//   • Access token never touches disk. In-memory only, with an expiry.

import { createHash, randomBytes } from 'node:crypto';

export const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
export const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

export interface PkcePair {
  readonly codeVerifier: string;
  readonly codeChallenge: string;
}

export interface TokenResponse {
  readonly access_token: string;
  readonly refresh_token?: string;
  readonly expires_in: number;
  readonly scope: string;
  readonly token_type: string;
}

function base64Url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function generatePkcePair(): PkcePair {
  const codeVerifier = base64Url(randomBytes(48)); // 64 chars after b64url
  const codeChallenge = base64Url(createHash('sha256').update(codeVerifier).digest());
  return { codeVerifier, codeChallenge };
}

export function generateState(): string {
  return base64Url(randomBytes(16));
}

export function buildAuthUrl(opts: {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly state: string;
  readonly codeChallenge: string;
  readonly scope?: string;
}): string {
  const params = new URLSearchParams({
    client_id: opts.clientId,
    response_type: 'code',
    scope: opts.scope ?? GMAIL_READONLY_SCOPE,
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

export async function exchangeCodeForTokens(opts: {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly code: string;
  readonly codeVerifier: string;
  readonly redirectUri: string;
}): Promise<TokenResponse> {
  const body = new URLSearchParams({
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
    code: opts.code,
    code_verifier: opts.codeVerifier,
    grant_type: 'authorization_code',
    redirect_uri: opts.redirectUri,
  });
  const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`token exchange failed: HTTP ${res.status} ${text}`);
  }
  const json = (await res.json()) as TokenResponse;
  if (typeof json.access_token !== 'string' || typeof json.expires_in !== 'number') {
    throw new Error('token exchange returned malformed payload');
  }
  return json;
}

export async function refreshAccessToken(opts: {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly refreshToken: string;
}): Promise<TokenResponse> {
  const body = new URLSearchParams({
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
    refresh_token: opts.refreshToken,
    grant_type: 'refresh_token',
  });
  const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`token refresh failed: HTTP ${res.status} ${text}`);
  }
  const json = (await res.json()) as TokenResponse;
  if (typeof json.access_token !== 'string' || typeof json.expires_in !== 'number') {
    throw new Error('token refresh returned malformed payload');
  }
  return json;
}
