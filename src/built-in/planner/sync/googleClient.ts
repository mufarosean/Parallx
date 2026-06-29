// googleClient.ts — typed renderer facade over the main-process Google sync
// bridge (electron/googleSyncBridge.cjs).
//
// All OAuth + Google REST traffic happens in the main process; the refresh
// token never enters the renderer. This module is just a typed, null-safe
// wrapper around `window.parallxElectron.google` so the settings panel and the
// sync provider don't each re-cast `window`.

export interface GoogleStatus {
  readonly connected: boolean;
  readonly email: string | null;
  /** Whether an OAuth client (client_id/secret) was found in main. */
  readonly hasClient: boolean;
}

export interface GoogleAuthorizeResult {
  readonly ok: boolean;
  readonly email?: string;
  readonly error?: string;
}

export interface GoogleFetchResult<T = unknown> {
  readonly ok: boolean;
  readonly status?: number;
  readonly data?: T | null;
  readonly error?: string;
}

export interface GoogleFetchRequest {
  readonly method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly url: string;
  readonly body?: unknown;
}

interface GoogleBridge {
  authorize(scopes?: readonly string[]): Promise<GoogleAuthorizeResult>;
  status(): Promise<GoogleStatus>;
  disconnect(): Promise<{ ok: boolean }>;
  fetch(opts: GoogleFetchRequest): Promise<GoogleFetchResult>;
}

function bridge(): GoogleBridge | undefined {
  return (window as unknown as { parallxElectron?: { google?: GoogleBridge } })
    .parallxElectron?.google;
}

export const googleSync = {
  /** Whether the preload bridge is present (false in tests / browser). */
  available(): boolean {
    return !!bridge();
  },

  async status(): Promise<GoogleStatus> {
    const b = bridge();
    if (!b) return { connected: false, email: null, hasClient: false };
    try {
      return await b.status();
    } catch {
      return { connected: false, email: null, hasClient: false };
    }
  },

  async authorize(scopes?: readonly string[]): Promise<GoogleAuthorizeResult> {
    const b = bridge();
    if (!b) return { ok: false, error: 'bridge-unavailable' };
    try {
      return await b.authorize(scopes);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  async disconnect(): Promise<void> {
    const b = bridge();
    if (b) {
      try { await b.disconnect(); } catch { /* best-effort */ }
    }
  },

  async fetch<T = unknown>(opts: GoogleFetchRequest): Promise<GoogleFetchResult<T>> {
    const b = bridge();
    if (!b) return { ok: false, error: 'bridge-unavailable' };
    try {
      return (await b.fetch(opts)) as GoogleFetchResult<T>;
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
};
