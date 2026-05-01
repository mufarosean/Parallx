// gmailOAuthService.test.ts — M60 §T6.F2
//
// Tests the OAuth primitives:
//   1. PKCE — verifier shape + challenge derivation matches RFC 7636 vector
//   2. Auth URL — params present, scope correct, S256 method
//   3. Token exchange — POSTs form-encoded body, parses success response
//   4. Refresh — sends refresh_token grant
//   5. completeAuthFlow — state mismatch refuses; error param surfaces
//   6. beginAuthFlow — wires all pieces together

import { describe, it, expect, vi } from 'vitest';
import {
  buildAuthUrl,
  beginAuthFlow,
  completeAuthFlow,
  deriveCodeChallenge,
  exchangeCodeForTokens,
  generateCodeVerifier,
  generatePkcePair,
  refreshAccessToken,
  type FetchFn,
  _internals,
} from '../../src/services/gmailOAuthService';

describe('gmailOAuthService — PKCE', () => {
  it('generates a base64url verifier of valid length', () => {
    const v = generateCodeVerifier();
    expect(v.length).toBeGreaterThanOrEqual(43);
    expect(v.length).toBeLessThanOrEqual(128);
    expect(v).toMatch(/^[A-Za-z0-9_-]+$/);
    // No padding.
    expect(v.endsWith('=')).toBe(false);
  });

  it('derives the canonical S256 challenge for the RFC 7636 §A.6 vector', async () => {
    // RFC 7636 appendix A.6 worked example.
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const challenge = await deriveCodeChallenge(verifier);
    expect(challenge).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('generatePkcePair returns matching verifier/challenge pair', async () => {
    const pair = await generatePkcePair();
    expect(pair.codeChallengeMethod).toBe('S256');
    const recomputed = await deriveCodeChallenge(pair.codeVerifier);
    expect(pair.codeChallenge).toBe(recomputed);
  });
});

describe('gmailOAuthService — auth URL', () => {
  it('builds a Google consent URL with required params', () => {
    const url = buildAuthUrl({
      clientId: 'cid-123.apps.googleusercontent.com',
      scope: 'https://www.googleapis.com/auth/gmail.readonly',
      redirectUri: 'http://127.0.0.1:54321',
      state: 'state-abc',
      codeChallenge: 'CHALLENGE',
    });
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe(_internals.GOOGLE_AUTH_ENDPOINT);
    expect(parsed.searchParams.get('client_id')).toBe('cid-123.apps.googleusercontent.com');
    expect(parsed.searchParams.get('response_type')).toBe('code');
    expect(parsed.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/gmail.readonly');
    expect(parsed.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:54321');
    expect(parsed.searchParams.get('state')).toBe('state-abc');
    expect(parsed.searchParams.get('code_challenge')).toBe('CHALLENGE');
    expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');
    expect(parsed.searchParams.get('access_type')).toBe('offline');
    expect(parsed.searchParams.get('prompt')).toBe('consent');
  });
});

// ─── Mock fetch helper ───────────────────────────────────────────────

function okResponse(body: unknown): ReturnType<FetchFn> {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
}

function errResponse(status: number, text: string): ReturnType<FetchFn> {
  return Promise.resolve({
    ok: false,
    status,
    json: async () => ({}),
    text: async () => text,
  });
}

describe('gmailOAuthService — token endpoint', () => {
  it('exchangeCodeForTokens posts the auth_code grant and returns tokens', async () => {
    const fetchFn = vi.fn<FetchFn>().mockImplementation((_url, init) => {
      expect(init?.method).toBe('POST');
      expect(init?.headers?.['Content-Type']).toBe('application/x-www-form-urlencoded');
      const body = new URLSearchParams(init?.body ?? '');
      expect(body.get('grant_type')).toBe('authorization_code');
      expect(body.get('code')).toBe('AUTH_CODE');
      expect(body.get('code_verifier')).toBe('VERIFIER');
      expect(body.get('client_id')).toBe('CID');
      expect(body.get('client_secret')).toBe('CSEC');
      expect(body.get('redirect_uri')).toBe('http://127.0.0.1:1');
      return okResponse({
        access_token: 'AT',
        refresh_token: 'RT',
        expires_in: 3600,
        scope: 'https://www.googleapis.com/auth/gmail.readonly',
        token_type: 'Bearer',
      });
    });
    const r = await exchangeCodeForTokens(
      {
        clientId: 'CID',
        clientSecret: 'CSEC',
        code: 'AUTH_CODE',
        codeVerifier: 'VERIFIER',
        redirectUri: 'http://127.0.0.1:1',
      },
      fetchFn,
    );
    expect(r.access_token).toBe('AT');
    expect(r.refresh_token).toBe('RT');
    expect(r.expires_in).toBe(3600);
  });

  it('exchangeCodeForTokens throws on HTTP error', async () => {
    const fetchFn = vi.fn<FetchFn>().mockImplementation(() => errResponse(400, 'invalid_grant'));
    await expect(
      exchangeCodeForTokens(
        { clientId: 'X', clientSecret: 'Y', code: 'C', codeVerifier: 'V', redirectUri: 'R' },
        fetchFn,
      ),
    ).rejects.toThrow(/HTTP 400/);
  });

  it('refreshAccessToken posts the refresh_token grant', async () => {
    const fetchFn = vi.fn<FetchFn>().mockImplementation((_url, init) => {
      const body = new URLSearchParams(init?.body ?? '');
      expect(body.get('grant_type')).toBe('refresh_token');
      expect(body.get('refresh_token')).toBe('RT');
      return okResponse({
        access_token: 'AT2',
        expires_in: 1800,
        scope: 'https://www.googleapis.com/auth/gmail.readonly',
        token_type: 'Bearer',
      });
    });
    const r = await refreshAccessToken(
      { clientId: 'CID', clientSecret: 'CSEC', refreshToken: 'RT' },
      fetchFn,
    );
    expect(r.access_token).toBe('AT2');
    expect(r.expires_in).toBe(1800);
  });
});

describe('gmailOAuthService — beginAuthFlow / completeAuthFlow', () => {
  it('beginAuthFlow returns matching auth URL + verifier + state', async () => {
    const r = await beginAuthFlow({ clientId: 'CID' });
    expect(r.codeVerifier.length).toBeGreaterThanOrEqual(43);
    expect(r.state.length).toBeGreaterThan(8);
    const parsed = new URL(r.authUrl);
    expect(parsed.searchParams.get('client_id')).toBe('CID');
    expect(parsed.searchParams.get('state')).toBe(r.state);
    // codeChallenge in URL must match the verifier we got back.
    const expectedChallenge = await deriveCodeChallenge(r.codeVerifier);
    expect(parsed.searchParams.get('code_challenge')).toBe(expectedChallenge);
    expect(parsed.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:0');
  });

  it('completeAuthFlow refuses on state mismatch', async () => {
    const fetchFn = vi.fn<FetchFn>().mockImplementation(() => okResponse({ access_token: 'AT', expires_in: 1, scope: '', token_type: 'Bearer' }));
    await expect(
      completeAuthFlow({
        redirectUrl: 'http://127.0.0.1:1?code=C&state=BAD',
        codeVerifier: 'V',
        state: 'GOOD',
        clientId: 'CID',
        clientSecret: 'CSEC',
        redirectUri: 'http://127.0.0.1:1',
        fetchFn,
      }),
    ).rejects.toThrow(/state does not match/);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('completeAuthFlow surfaces error param from redirect', async () => {
    await expect(
      completeAuthFlow({
        redirectUrl: 'http://127.0.0.1:1?error=access_denied',
        codeVerifier: 'V',
        state: 'S',
        clientId: 'CID',
        clientSecret: 'CSEC',
        redirectUri: 'http://127.0.0.1:1',
      }),
    ).rejects.toThrow(/OAuth error: access_denied/);
  });

  it('completeAuthFlow exchanges code on state match', async () => {
    const fetchFn = vi.fn<FetchFn>().mockImplementation(() => okResponse({
      access_token: 'AT',
      refresh_token: 'RT',
      expires_in: 3600,
      scope: '',
      token_type: 'Bearer',
    }));
    const r = await completeAuthFlow({
      redirectUrl: 'http://127.0.0.1:1?code=AUTH&state=S',
      codeVerifier: 'V',
      state: 'S',
      clientId: 'CID',
      clientSecret: 'CSEC',
      redirectUri: 'http://127.0.0.1:1',
      fetchFn,
    });
    expect(r.access_token).toBe('AT');
    expect(r.refresh_token).toBe('RT');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
