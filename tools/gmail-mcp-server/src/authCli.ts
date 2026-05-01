// authCli.ts — `--auth` subcommand for the Gmail MCP server.
//
// Flow:
//   1. Read GMAIL_OAUTH_CLIENT_ID / GMAIL_OAUTH_CLIENT_SECRET from env.
//   2. Start loopback listener on 127.0.0.1:<random>.
//   3. Build auth URL with PKCE, print it to stderr.
//   4. Wait for redirect; validate state.
//   5. Exchange code → tokens.
//   6. Persist refresh_token + client creds to ~/.parallx/gmail-mcp/credentials.json.
//   7. Exit 0.
//
// On any failure, write a clear message to stderr and exit non-zero.

import {
  buildAuthUrl,
  exchangeCodeForTokens,
  GMAIL_READONLY_SCOPE,
  generatePkcePair,
  generateState,
} from './oauth.js';
import { startLoopback } from './loopback.js';
import { defaultCredPath, writeCredentials } from './credStore.js';

function out(msg: string): void {
  process.stderr.write(msg + '\n');
}

export async function runAuth(): Promise<number> {
  const clientId = process.env.GMAIL_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GMAIL_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    out('error: GMAIL_OAUTH_CLIENT_ID and GMAIL_OAUTH_CLIENT_SECRET must be set.');
    out('');
    out('Create a Google OAuth client (Desktop app) at');
    out('  https://console.cloud.google.com/apis/credentials');
    out('then run:');
    out('  GMAIL_OAUTH_CLIENT_ID=... GMAIL_OAUTH_CLIENT_SECRET=... node dist/index.js --auth');
    return 2;
  }

  out('Starting loopback listener on 127.0.0.1...');
  const loopback = await startLoopback();
  out(`Loopback ready: ${loopback.redirectUri}`);

  const pkce = generatePkcePair();
  const state = generateState();
  const authUrl = buildAuthUrl({
    clientId,
    redirectUri: loopback.redirectUri,
    state,
    codeChallenge: pkce.codeChallenge,
    scope: GMAIL_READONLY_SCOPE,
  });

  out('');
  out('Open this URL in your browser to authorize Gmail (read-only):');
  out('');
  out('  ' + authUrl);
  out('');
  out('Waiting for redirect (5 min timeout)...');

  let redirectUrl: URL;
  try {
    redirectUrl = await loopback.waitForRedirect();
  } catch (err) {
    out(`error: ${(err as Error).message}`);
    return 1;
  }

  const errParam = redirectUrl.searchParams.get('error');
  if (errParam) {
    const desc = redirectUrl.searchParams.get('error_description') ?? '';
    out(`error: OAuth provider returned error: ${errParam}${desc ? ` (${desc})` : ''}`);
    return 1;
  }

  const code = redirectUrl.searchParams.get('code');
  const returnedState = redirectUrl.searchParams.get('state');
  if (!code) {
    out('error: redirect missing `code` parameter');
    return 1;
  }
  if (returnedState !== state) {
    out('error: state mismatch — possible CSRF, refusing to exchange code');
    return 1;
  }

  out('Exchanging authorization code for tokens...');
  let tokens;
  try {
    tokens = await exchangeCodeForTokens({
      clientId,
      clientSecret,
      code,
      codeVerifier: pkce.codeVerifier,
      redirectUri: loopback.redirectUri,
    });
  } catch (err) {
    out(`error: ${(err as Error).message}`);
    return 1;
  }

  if (!tokens.refresh_token) {
    out('error: token endpoint did not return a refresh_token.');
    out('Revoke prior consent at https://myaccount.google.com/permissions');
    out('and re-run --auth.');
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
      obtained_at: new Date().toISOString(),
    },
    credPath,
  );

  out('');
  out(`✓ Credentials saved to ${credPath} (mode 600).`);
  out('  You can now register this server in Parallx:');
  out('    chat-gear → MCP Servers → + Add Server');
  out('    name:    gmail');
  out('    command: node');
  out('    args:    <absolute-path-to>/tools/gmail-mcp-server/bundle/server.mjs');
  return 0;
}
