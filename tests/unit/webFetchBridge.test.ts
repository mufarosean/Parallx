// tests/unit/webFetchBridge.test.ts — Egress chokepoint security tests (M65 C13).
//
// Covers:
//   * CIDR rejection for every documented private/reserved range (C1)
//   * Domain blocklist for every C4 entry + subdomain match
//   * http:// hard reject (C3)
//   * Redirect to private IP rejected on the second hop (C2)
//   * Body cap counted from the stream, not Content-Length (C6)
//   * Per-turn fetch backstop (5)
//   * Canonical URL normalization shape
//
// We exercise the bridge by calling `_internals.doWebFetch` with an injected
// single-hop transport so DNS/HTTPS are simulated without sockets.

import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const bridge = require_('../../electron/webFetchBridge.cjs');
const {
  isPrivateIp,
  isBlocklistedHost,
  canonicalUrl,
  doWebFetch,
  DOMAIN_BLOCKLIST,
  PRIVATE_V4_CIDRS,
  PER_TURN_FETCH_BACKSTOP,
  _resetTurnFetchCount,
} = bridge._internals;

// ─── isPrivateIp ─────────────────────────────────────────────────────────────

describe('isPrivateIp — IPv4 CIDR coverage (C1)', () => {
  // One concrete address per documented CIDR.
  const samples: Record<string, string> = {
    '0.0.0.0/8':         '0.1.2.3',
    '10.0.0.0/8':        '10.0.0.5',
    '100.64.0.0/10':     '100.64.5.5',
    '127.0.0.0/8':       '127.0.0.1',
    '169.254.0.0/16':    '169.254.169.254',
    '172.16.0.0/12':     '172.16.0.1',
    '192.0.0.0/24':      '192.0.0.5',
    '192.0.2.0/24':      '192.0.2.5',
    '192.168.0.0/16':    '192.168.1.1',
    '198.18.0.0/15':     '198.19.0.5',
    '198.51.100.0/24':   '198.51.100.5',
    '203.0.113.0/24':    '203.0.113.5',
    '224.0.0.0/4':       '239.0.0.5',
    '240.0.0.0/4':       '253.0.0.5',
    '255.255.255.255/32':'255.255.255.255',
  };
  for (const [cidr, addr] of Object.entries(samples)) {
    it(`rejects ${addr} (${cidr})`, () => {
      expect(isPrivateIp(addr)).toBe(true);
    });
  }
  it('allows a normal public address', () => {
    expect(isPrivateIp('8.8.8.8')).toBe(false);
    expect(isPrivateIp('1.1.1.1')).toBe(false);
    expect(isPrivateIp('151.101.1.69')).toBe(false);
  });
  it('PRIVATE_V4_CIDRS is exhaustively exercised', () => {
    expect(PRIVATE_V4_CIDRS.length).toBe(Object.keys(samples).length);
  });
});

describe('isPrivateIp — IPv6', () => {
  it('rejects loopback and unspecified', () => {
    expect(isPrivateIp('::1')).toBe(true);
    expect(isPrivateIp('::')).toBe(true);
  });
  it('rejects link-local fe80::/10', () => {
    expect(isPrivateIp('fe80::1')).toBe(true);
  });
  it('rejects unique-local fc00::/7', () => {
    expect(isPrivateIp('fc00::1')).toBe(true);
    expect(isPrivateIp('fd12:3456:789a::1')).toBe(true);
  });
  it('rejects multicast ff00::/8', () => {
    expect(isPrivateIp('ff02::1')).toBe(true);
  });
  it('rejects IPv4-mapped private addresses', () => {
    expect(isPrivateIp('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateIp('::ffff:169.254.169.254')).toBe(true);
  });
  it('allows a public IPv6 (e.g. Google DNS)', () => {
    expect(isPrivateIp('2001:4860:4860::8888')).toBe(false);
  });
  it('rejects garbage', () => {
    expect(isPrivateIp('not-an-ip')).toBe(true);
    expect(isPrivateIp('')).toBe(true);
  });
});

// ─── isBlocklistedHost ───────────────────────────────────────────────────────

describe('isBlocklistedHost (C4)', () => {
  it('every documented entry is rejected (exact match)', () => {
    for (const entry of DOMAIN_BLOCKLIST) {
      expect(isBlocklistedHost(entry, '/')).toBe(true);
    }
  });
  it('subdomain match: foo.webhook.site rejected', () => {
    expect(isBlocklistedHost('foo.webhook.site', '/')).toBe(true);
    expect(isBlocklistedHost('a.b.requestbin.com', '/')).toBe(true);
    expect(isBlocklistedHost('attacker.pipedream.net', '/')).toBe(true);
  });
  it('similar-sounding but distinct host not rejected', () => {
    expect(isBlocklistedHost('notwebhook.site', '/')).toBe(false);
    expect(isBlocklistedHost('webhook.sitex', '/')).toBe(false);
  });
  it('cloud metadata literal IP entry rejected', () => {
    expect(isBlocklistedHost('169.254.169.254', '/')).toBe(true);
    expect(isBlocklistedHost('metadata.google.internal', '/')).toBe(true);
    expect(isBlocklistedHost('metadata.azure.com', '/')).toBe(true);
  });
  it('pastebin.com is blocked outright', () => {
    expect(isBlocklistedHost('pastebin.com', '/somepath')).toBe(true);
  });
  it('path /raw/* defense-in-depth (any pastebin-named proxy)', () => {
    expect(isBlocklistedHost('alt-pastebin.example.org', '/raw/abc')).toBe(true);
  });
});

// ─── canonicalUrl ────────────────────────────────────────────────────────────

describe('canonicalUrl (C5 normalization)', () => {
  it('lowercases scheme + host', () => {
    expect(canonicalUrl('HTTPS://Example.COM/Path')).toBe('https://example.com/Path');
  });
  it('drops fragment, keeps search', () => {
    expect(canonicalUrl('https://example.com/p?a=1&b=2#frag')).toBe('https://example.com/p?a=1&b=2');
  });
  it('strips trailing / on bare host', () => {
    expect(canonicalUrl('https://example.com/')).toBe('https://example.com');
    expect(canonicalUrl('https://example.com')).toBe('https://example.com');
  });
  it('returns null for garbage', () => {
    expect(canonicalUrl('not a url')).toBeNull();
  });
});

// ─── doWebFetch via injected transport ───────────────────────────────────────

// Synthetic preflight: applies the real gate functions to the URL but uses
// a hand-crafted host→IP map instead of dns.lookup. This lets us drive both
// the happy path and the redirect-to-private-IP attack deterministically.
function makePreflight(hostToIps: Record<string, string[]> = {}) {
  return async function(urlStr: string) {
    const u = new URL(urlStr);
    if (u.protocol !== 'https:') { const e: any = new Error('not https'); e.code = 'NOT_HTTPS'; throw e; }
    if (isBlocklistedHost(u.hostname, u.pathname)) {
      const e: any = new Error('blocklisted'); e.code = 'BLOCKLISTED'; throw e;
    }
    // If host is a literal IP, treat it as resolving to itself.
    const ips = hostToIps[u.hostname] ?? (/^[\d.:]+$/.test(u.hostname) ? [u.hostname] : ['1.2.3.4']);
    for (const ip of ips) {
      if (isPrivateIp(ip)) { const e: any = new Error('priv'); e.code = 'PRIVATE_IP'; throw e; }
    }
  };
}

function fakeOk(body = '<html><body>hi</body></html>', status = 200, contentType = 'text/html') {
  return async ({ urlStr }: { urlStr: string }) => ({
    redirected: false,
    status,
    contentType,
    body,
    finalUrl: urlStr,
  });
}

function fakeRedirect(to: string, status = 302) {
  return async () => ({ redirected: true, nextUrl: to, status });
}

describe('doWebFetch — protocol + blocklist gates (C3, C4)', () => {
  beforeEach(() => _resetTurnFetchCount('test'));

  it('rejects http://', async () => {
    await expect(doWebFetch({
      url: 'http://example.com/', turnId: 'test',
      _injectedRequest: fakeOk(), _injectedPreflight: makePreflight(),
    })).rejects.toMatchObject({ code: 'NOT_HTTPS' });
  });

  it('rejects blocklisted host even with https', async () => {
    await expect(doWebFetch({
      url: 'https://webhook.site/some-id', turnId: 'test',
      _injectedRequest: fakeOk(), _injectedPreflight: makePreflight(),
    })).rejects.toMatchObject({ code: 'BLOCKLISTED' });
  });

  it('rejects blocklisted subdomain', async () => {
    await expect(doWebFetch({
      url: 'https://attacker.pipedream.net/x', turnId: 'test',
      _injectedRequest: fakeOk(), _injectedPreflight: makePreflight(),
    })).rejects.toMatchObject({ code: 'BLOCKLISTED' });
  });

  it('rejects literal cloud-metadata IP via blocklist (even before DNS would catch it)', async () => {
    await expect(doWebFetch({
      url: 'https://169.254.169.254/latest/meta-data/', turnId: 'test',
      _injectedRequest: fakeOk(), _injectedPreflight: makePreflight(),
    })).rejects.toMatchObject({ code: 'BLOCKLISTED' });
  });
});

describe('doWebFetch — redirect handling (C2)', () => {
  beforeEach(() => _resetTurnFetchCount('test'));

  it('redirect to https://127.0.0.1 is rejected on hop 2 (private IP)', async () => {
    let hop = 0;
    const transport = async ({ urlStr }: { urlStr: string }) => {
      hop++;
      if (hop === 1) return { redirected: true, nextUrl: 'https://127.0.0.1/secret', status: 302 };
      throw new Error('should-not-reach');
    };
    await expect(doWebFetch({
      url: 'https://example.com/start', turnId: 'test',
      _injectedRequest: transport as any,
      _injectedPreflight: makePreflight({ 'example.com': ['1.2.3.4'] }),
    })).rejects.toMatchObject({ code: 'PRIVATE_IP' });
  });

  it('redirect re-runs blocklist on hop 2', async () => {
    let hop = 0;
    const transport = async () => {
      hop++;
      if (hop === 1) return { redirected: true, nextUrl: 'https://webhook.site/abc', status: 302 };
      throw new Error('should-not-reach');
    };
    await expect(doWebFetch({
      url: 'https://example.com/start', turnId: 'test',
      _injectedRequest: transport as any,
      _injectedPreflight: makePreflight(),
    })).rejects.toMatchObject({ code: 'BLOCKLISTED' });
  });

  it('rejects after 3 redirect hops', async () => {
    let n = 0;
    const transport = async () => {
      n++;
      return { redirected: true, nextUrl: `https://example${n}.com/`, status: 302 };
    };
    await expect(doWebFetch({
      url: 'https://example.com/', turnId: 'test',
      _injectedRequest: transport as any,
      _injectedPreflight: makePreflight(),
    })).rejects.toMatchObject({ code: 'REDIRECT_LIMIT' });
  });
});

describe('doWebFetch — body-cap accounting (C6)', () => {
  beforeEach(() => _resetTurnFetchCount('test'));

  it('body smaller than cap passes through', async () => {
    const r = await doWebFetch({
      url: 'https://example.com/x',
      turnId: 'test',
      _injectedRequest: fakeOk('small body'),
      _injectedPreflight: makePreflight(),
    });
    expect(r.body).toBe('small body');
    expect(r.status).toBe(200);
  });

  it('body-cap overflow: BODY_TOO_LARGE propagates from the transport', async () => {
    const transport = async () => {
      const err: any = new Error('Body exceeded');
      err.code = 'BODY_TOO_LARGE';
      throw err;
    };
    await expect(doWebFetch({
      url: 'https://example.com/big', turnId: 'test',
      _injectedRequest: transport as any,
      _injectedPreflight: makePreflight(),
    })).rejects.toMatchObject({ code: 'BODY_TOO_LARGE' });
  });
});

describe('doWebFetch — per-turn backstop', () => {
  beforeEach(() => _resetTurnFetchCount('back'));

  it('hard-stops after PER_TURN_FETCH_BACKSTOP', async () => {
    for (let i = 0; i < PER_TURN_FETCH_BACKSTOP; i++) {
      // eslint-disable-next-line no-await-in-loop
      await doWebFetch({
        url: 'https://example.com/', turnId: 'back',
        _injectedRequest: fakeOk(), _injectedPreflight: makePreflight(),
      });
    }
    await expect(doWebFetch({
      url: 'https://example.com/', turnId: 'back',
      _injectedRequest: fakeOk(), _injectedPreflight: makePreflight(),
    })).rejects.toMatchObject({ code: 'TURN_BACKSTOP' });
  });
});

// --- F3: connect-time IP pin via custom https.request({ lookup }) ------------

const { _makePinnedLookup } = bridge._internals;

describe('_makePinnedLookup (F3 � M65 Iter 2)', () => {
  it('returns prevalidated address(es); never invokes DNS', () => {
    const prevalidated = [{ address: '8.8.8.8', family: 4 }];
    const lookup = _makePinnedLookup(prevalidated);
    let result: any = null;
    lookup('example.com', { family: 0, all: false }, (err: any, address: any, family: any) => {
      result = { err, address, family };
    });
    expect(result.err).toBeNull();
    expect(result.address).toBe('8.8.8.8');
    expect(result.family).toBe(4);
  });

  it('honors options.all === true (returns the full set)', () => {
    const prevalidated = [
      { address: '8.8.8.8', family: 4 },
      { address: '8.8.4.4', family: 4 },
    ];
    const lookup = _makePinnedLookup(prevalidated);
    let result: any = null;
    lookup('example.com', { all: true }, (err: any, addresses: any) => {
      result = { err, addresses };
    });
    expect(result.err).toBeNull();
    expect(result.addresses).toEqual([
      { address: '8.8.8.8', family: 4 },
      { address: '8.8.4.4', family: 4 },
    ]);
  });

  it('respects options.family (IPv4 only filter)', () => {
    const prevalidated = [
      { address: '8.8.8.8', family: 4 },
      { address: '2001:4860:4860::8888', family: 6 },
    ];
    const lookup = _makePinnedLookup(prevalidated);
    let result: any = null;
    lookup('example.com', { family: 4, all: false }, (err: any, address: any, family: any) => {
      result = { err, address, family };
    });
    expect(result.err).toBeNull();
    expect(result.address).toBe('8.8.8.8');
    expect(result.family).toBe(4);
  });

  it('respects options.family (IPv6 only filter)', () => {
    const prevalidated = [
      { address: '8.8.8.8', family: 4 },
      { address: '2001:4860:4860::8888', family: 6 },
    ];
    const lookup = _makePinnedLookup(prevalidated);
    let result: any = null;
    lookup('example.com', { family: 6, all: false }, (err: any, address: any, family: any) => {
      result = { err, address, family };
    });
    expect(result.err).toBeNull();
    expect(result.address).toBe('2001:4860:4860::8888');
    expect(result.family).toBe(6);
  });

  it('rejects with PRIVATE_IP when no prevalidated address matches family', () => {
    // Defense-in-depth � should be unreachable since preflight guards.
    const prevalidated = [{ address: '8.8.8.8', family: 4 }];
    const lookup = _makePinnedLookup(prevalidated);
    let result: any = null;
    lookup('example.com', { family: 6, all: false }, (err: any) => {
      result = err;
    });
    expect(result).toBeTruthy();
    expect(result.code).toBe('PRIVATE_IP');
  });

  it('snapshot is closure-captured; mutating the source array does not affect lookup', () => {
    const prevalidated = [{ address: '8.8.8.8', family: 4 }];
    const lookup = _makePinnedLookup(prevalidated);
    // Attacker mutates the array post-creation.
    prevalidated.push({ address: '127.0.0.1', family: 4 });
    let result: any = null;
    lookup('example.com', { all: true }, (err: any, addresses: any) => {
      result = { err, addresses };
    });
    expect(result.err).toBeNull();
    expect(result.addresses).toHaveLength(1);
    expect(result.addresses[0].address).toBe('8.8.8.8');
  });

  it('legacy (host, family, cb) calling convention is supported', () => {
    const prevalidated = [{ address: '8.8.8.8', family: 4 }];
    const lookup = _makePinnedLookup(prevalidated);
    let result: any = null;
    // Node sometimes calls lookup(host, family, cb) when options is a number.
    lookup('example.com', 4 as any, (err: any, address: any, family: any) => {
      result = { err, address, family };
    });
    expect(result.err).toBeNull();
    expect(result.address).toBe('8.8.8.8');
    expect(result.family).toBe(4);
  });
});
