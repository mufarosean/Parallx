// loopback.ts — One-shot OAuth redirect listener on 127.0.0.1.
//
// Per RFC 8252 §7.3, desktop apps SHOULD listen on a random
// localhost port and use it as the redirect_uri. We bind to port 0,
// the OS picks a free port, and we close the server after the first
// redirect arrives.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';

export interface LoopbackResult {
  readonly redirectUri: string;
  readonly waitForRedirect: () => Promise<URL>;
  readonly close: () => void;
}

const SUCCESS_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Parallx Gmail MCP</title>
<style>body{font-family:system-ui,sans-serif;max-width:480px;margin:80px auto;padding:0 20px;color:#222}
h1{font-size:20px}p{line-height:1.5}</style></head>
<body><h1>Authorization complete</h1>
<p>You can close this tab and return to your terminal.</p>
</body></html>`;

const ERROR_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Parallx Gmail MCP — error</title>
<style>body{font-family:system-ui,sans-serif;max-width:480px;margin:80px auto;padding:0 20px;color:#222}
h1{font-size:20px;color:#b00020}p{line-height:1.5}</style></head>
<body><h1>Authorization failed</h1>
<p>Check the terminal running <code>--auth</code> for details. You can close this tab.</p>
</body></html>`;

export async function startLoopback(): Promise<LoopbackResult> {
  let resolveRedirect: (url: URL) => void = () => {};
  let rejectRedirect: (err: Error) => void = () => {};
  const redirectPromise = new Promise<URL>((resolve, reject) => {
    resolveRedirect = resolve;
    rejectRedirect = reject;
  });

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (!req.url) {
      res.statusCode = 400;
      res.end();
      return;
    }
    // Reconstruct full URL using the loopback host (the actual port
    // doesn't matter for parsing — only path + query).
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname !== '/') {
      // Ignore favicon and other noise.
      res.statusCode = 404;
      res.end();
      return;
    }
    const hasCode = url.searchParams.has('code');
    const hasError = url.searchParams.has('error');
    if (!hasCode && !hasError) {
      res.statusCode = 400;
      res.end();
      return;
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(hasError ? ERROR_HTML : SUCCESS_HTML);
    resolveRedirect(url);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const addr = server.address() as AddressInfo;
  const redirectUri = `http://127.0.0.1:${addr.port}`;

  // Safety: if the user never completes the flow, time out after 5 min.
  const timeout = setTimeout(() => {
    rejectRedirect(new Error('OAuth redirect timed out after 5 minutes'));
    server.close();
  }, 5 * 60 * 1000);
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
    },
  };
}
