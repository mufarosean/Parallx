// bundledOAuthClient.ts — Parallx-owned Google OAuth Desktop client.
//
// Per RFC 8252 §8.4 and Google's own desktop-app docs, installed
// applications cannot keep a client secret confidential. Even so, we
// no longer ship the credentials inline in source — instead they are
// supplied at runtime via environment variables (or by the host app
// reading them from a packaged config outside this repo).
//
// To run --auth locally:
//   set GMAIL_OAUTH_CLIENT_ID and GMAIL_OAUTH_CLIENT_SECRET in env
//   before invoking the bundled server with --auth.
export const BUNDLED_GMAIL_OAUTH_CLIENT_ID = '';
export const BUNDLED_GMAIL_OAUTH_CLIENT_SECRET = '';
