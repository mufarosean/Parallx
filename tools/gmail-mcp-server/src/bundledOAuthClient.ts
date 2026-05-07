// bundledOAuthClient.ts — Parallx Google OAuth Desktop client.
//
// Loads OAuth client credentials from a local file outside the repo so they
// never enter source control. Lookup order:
//   1. process.env.GMAIL_OAUTH_CLIENT_ID / GMAIL_OAUTH_CLIENT_SECRET
//   2. ~/.parallx/gmail-mcp/oauth-client.json   { "client_id": "...", "client_secret": "..." }
//
// Per RFC 8252 §8.4, desktop OAuth client secrets are not cryptographically
// confidential — the file approach is purely so we don't trip GitHub's
// secret scanner and so each developer/install controls their own client.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface BundledOAuthClient {
  clientId: string;
  clientSecret: string;
}

export function oauthClientConfigPath(): string {
  return join(homedir(), '.parallx', 'gmail-mcp', 'oauth-client.json');
}

export function loadBundledOAuthClient(): BundledOAuthClient {
  const envId = process.env.GMAIL_OAUTH_CLIENT_ID;
  const envSecret = process.env.GMAIL_OAUTH_CLIENT_SECRET;
  if (envId && envSecret) {
    return { clientId: envId, clientSecret: envSecret };
  }
  try {
    const raw = readFileSync(oauthClientConfigPath(), 'utf8');
    const parsed = JSON.parse(raw) as { client_id?: string; client_secret?: string };
    if (parsed && typeof parsed.client_id === 'string' && typeof parsed.client_secret === 'string') {
      return { clientId: parsed.client_id, clientSecret: parsed.client_secret };
    }
  } catch {
    // file missing or invalid — fall through
  }
  return { clientId: '', clientSecret: '' };
}

// Back-compat: previously these were string constants. Kept as evaluated
// values so existing imports continue to work, but new code should call
// loadBundledOAuthClient() directly.
const _bundled = loadBundledOAuthClient();
export const BUNDLED_GMAIL_OAUTH_CLIENT_ID = _bundled.clientId;
export const BUNDLED_GMAIL_OAUTH_CLIENT_SECRET = _bundled.clientSecret;
