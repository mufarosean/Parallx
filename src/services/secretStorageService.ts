// secretStorageService.ts — M60 §T6.F3
//
// Renderer-side facade over the `secret:set/get/delete` IPC handlers
// added in F2. The handlers themselves enforce the M53-portable
// storage path (`<APP_ROOT>/data/secrets/<sha256(key)[:32]>.enc`),
// `app.safeStorage` encryption, key-allowlist regex, and Linux
// fallback. This module's job is just to provide a typed,
// renderer-side surface and base64 round-tripping.
//
// Why base64 across the IPC boundary
// ──────────────────────────────────
//   `safeStorage.encryptString` requires a string input. Refresh
//   tokens are ASCII-safe today, but other callers (future MCP creds)
//   may store binary. Base64 is a stable, plain-string envelope that
//   never cares about encoding quirks.

export interface ISecretBridge {
  set(key: string, valueB64: string): Promise<{ ok: boolean; error?: string }>;
  get(key: string): Promise<{ ok: boolean; valueB64?: string; error?: string }>;
  delete(key: string): Promise<{ ok: boolean; error?: string }>;
}

export interface ISecretStorageService {
  /** Set a UTF-8 string secret. Returns ok or an error code. */
  setString(key: string, value: string): Promise<{ ok: boolean; error?: string }>;
  /** Get a UTF-8 string secret. Returns the decrypted value or an error code. */
  getString(key: string): Promise<{ ok: boolean; value?: string; error?: string }>;
  /** Delete a secret. Idempotent — deleting a missing key returns ok. */
  delete(key: string): Promise<{ ok: boolean; error?: string }>;
  /** Whether the bridge is available (electron preload). */
  readonly available: boolean;
}

/**
 * Resolve the renderer-side bridge from `window.parallxElectron.secret`.
 * Returns `undefined` when the preload isn't loaded (e.g. tests).
 */
export function getSecretBridge(): ISecretBridge | undefined {
  const api = (globalThis as { parallxElectron?: { secret?: ISecretBridge } }).parallxElectron;
  return api?.secret;
}

function utf8ToBase64(value: string): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(value, 'utf8').toString('base64');
  }
  // Browser fallback — TextEncoder + btoa.
  const bytes = new TextEncoder().encode(value);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function base64ToUtf8(b64: string): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(b64, 'base64').toString('utf8');
  }
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}

/**
 * Construct a secret storage service. Pass an explicit bridge in
 * tests; production callers omit it to use `window.parallxElectron`.
 */
export function createSecretStorageService(
  bridge: ISecretBridge | undefined = getSecretBridge(),
): ISecretStorageService {
  return {
    available: !!bridge,

    async setString(key, value) {
      if (!bridge) return { ok: false, error: 'bridge-unavailable' };
      return bridge.set(key, utf8ToBase64(value));
    },

    async getString(key) {
      if (!bridge) return { ok: false, error: 'bridge-unavailable' };
      const r = await bridge.get(key);
      if (!r.ok || typeof r.valueB64 !== 'string') {
        return { ok: false, error: r.error ?? 'unknown-error' };
      }
      try {
        return { ok: true, value: base64ToUtf8(r.valueB64) };
      } catch (err) {
        return { ok: false, error: 'decode-failed: ' + (err as Error).message };
      }
    },

    async delete(key) {
      if (!bridge) return { ok: false, error: 'bridge-unavailable' };
      return bridge.delete(key);
    },
  };
}

// M62: well-known provider-specific keys removed. Provider MCP
// servers own their own credential storage (e.g. tools/gmail-mcp-server
// stores its refresh token in ~/.parallx/gmail-mcp/credentials.json).
