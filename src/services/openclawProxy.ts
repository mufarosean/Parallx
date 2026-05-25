/**
 * src/services/openclawProxy.ts — M86-W8 sidecar AI runtime scaffold.
 *
 * Renderer-side thin proxy over the openclaw utility-process host
 * (`electron/openclawHost.cjs`). This is the SCAFFOLD only — today
 * it lets the renderer ping the host, read its version, and round-trip
 * an echo payload so we can validate the channel before migrating
 * actual openclaw turns onto it. The eventual goal is to mirror the
 * existing in-renderer openclaw service shape so call sites do not
 * change when the migration flips.
 *
 * The transport is intentionally a plain IPC bridge rather than a
 * direct MessagePort. That keeps the renderer free of preload
 * surgery and lets the main process attach the same authorization
 * model it uses for every other typed IPC handler (M86-W6).
 */

/** Match the protocol from electron/openclawHost.cjs. */
export interface HostRequest {
  id: string;
  kind: string;
  payload?: unknown;
}

export interface HostResponse {
  id: string;
  ok: boolean;
  error?: string;
  [k: string]: unknown;
}

interface OpenclawHostBridge {
  send(req: HostRequest): Promise<HostResponse>;
}

interface ParallxBridgeWithOpenclaw {
  openclawHost?: OpenclawHostBridge;
}

let _idSeq = 0;
function nextId(): string {
  _idSeq = (_idSeq + 1) & 0x7fffffff;
  return `proxy-${Date.now().toString(36)}-${_idSeq.toString(36)}`;
}

function _bridge(): OpenclawHostBridge | undefined {
  const bridge = (globalThis as { parallx?: ParallxBridgeWithOpenclaw }).parallx;
  return bridge?.openclawHost;
}

export class OpenclawProxy {
  /** Resolves with the host's reported version string (e.g. `0.1.0-scaffold`). */
  async getVersion(): Promise<string | null> {
    const bridge = _bridge();
    if (!bridge) return null;
    const res = await bridge.send({ id: nextId(), kind: 'host:version' });
    if (!res.ok) return null;
    return typeof res.version === 'string' ? res.version : null;
  }

  /** Resolves true if the host responded within `timeoutMs`. */
  async ping(timeoutMs = 1000): Promise<boolean> {
    const bridge = _bridge();
    if (!bridge) return false;
    const send = bridge.send({ id: nextId(), kind: 'host:ping' });
    const timeout = new Promise<HostResponse>((resolve) =>
      setTimeout(() => resolve({ id: '', ok: false, error: 'ETIMEDOUT' }), timeoutMs),
    );
    const res = await Promise.race([send, timeout]);
    return res.ok === true;
  }

  /** Round-trip an arbitrary payload for channel-integrity tests. */
  async echo<T>(payload: T): Promise<T | null> {
    const bridge = _bridge();
    if (!bridge) return null;
    const res = await bridge.send({ id: nextId(), kind: 'host:echo', payload });
    if (!res.ok) return null;
    return (res.payload as T) ?? null;
  }
}

let _instance: OpenclawProxy | undefined;
export function getOpenclawProxy(): OpenclawProxy {
  if (!_instance) _instance = new OpenclawProxy();
  return _instance;
}

export function _resetOpenclawProxyForTests(): void {
  _instance = undefined;
  _idSeq = 0;
}
