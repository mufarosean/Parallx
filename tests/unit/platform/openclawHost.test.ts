/**
 * tests/unit/platform/openclawHost.test.ts — pin the M86-W8 scaffold
 * protocol surface so the channel contract stays stable while the
 * actual openclaw migration is in flight.
 */
import { describe, it, expect } from 'vitest';
// CJS module under test; require it directly so we don't need a TS shim.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const host = require('../../../electron/openclawHost.cjs') as {
  HOST_VERSION: string;
  _dispatch(msg: unknown): Promise<void>;
  _handlers: Record<string, (payload: unknown) => unknown>;
};

describe('openclawHost (M86-W8 scaffold)', () => {
  it('exports a non-empty version string', () => {
    expect(typeof host.HOST_VERSION).toBe('string');
    expect(host.HOST_VERSION.length).toBeGreaterThan(0);
  });

  it('registers ping / version / echo handlers', () => {
    expect(typeof host._handlers['host:ping']).toBe('function');
    expect(typeof host._handlers['host:version']).toBe('function');
    expect(typeof host._handlers['host:echo']).toBe('function');
  });

  it('ping handler returns ok + pong timestamp', () => {
    const result = host._handlers['host:ping']({}) as { ok: boolean; pong: number };
    expect(result.ok).toBe(true);
    expect(typeof result.pong).toBe('number');
  });

  it('version handler returns ok + matching HOST_VERSION', () => {
    const result = host._handlers['host:version']({}) as { ok: boolean; version: string };
    expect(result.ok).toBe(true);
    expect(result.version).toBe(host.HOST_VERSION);
  });

  it('echo handler round-trips the payload', () => {
    const payload = { a: 1, b: ['x', 'y'] };
    const result = host._handlers['host:echo'](payload) as { ok: boolean; payload: unknown };
    expect(result.ok).toBe(true);
    expect(result.payload).toEqual(payload);
  });
});
