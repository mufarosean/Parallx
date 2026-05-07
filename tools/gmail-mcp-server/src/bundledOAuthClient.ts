// bundledOAuthClient.ts — Parallx-owned Google OAuth Desktop client.
//
// These are the public-by-design credentials for the "Parallx" Google
// Cloud project. Per RFC 8252 §8.4 and Google's own desktop-app docs,
// installed applications cannot keep a client secret confidential —
// the secret here grants no access on its own; users must still
// approve the consent screen for their own data.
//
// Other apps that ship a public OAuth client the same way: GitHub
// CLI, 1Password, VS Code, the Google Cloud SDK itself.
//
// To override (e.g. for development against a different project), set
// GMAIL_OAUTH_CLIENT_ID / GMAIL_OAUTH_CLIENT_SECRET in the environment
// before running --auth.
export const BUNDLED_GMAIL_OAUTH_CLIENT_ID =
  '242493707221-qhd75htges3cmd9hhq97u8sh1g5or8sp.apps.googleusercontent.com';
export const BUNDLED_GMAIL_OAUTH_CLIENT_SECRET = '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';
