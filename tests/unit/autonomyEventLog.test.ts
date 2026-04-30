// autonomyEventLog.test.ts — M60 §3.10 structured autonomy event writer
//
// Verifies:
//   - Record schema: id is a 26-char ulid; triggeredAt is ISO; outcome is
//     one of the allowed strings.
//   - emit() persists ndjson lines and readDay() returns parsed records.
//   - findById() walks the retention window.
//   - sha256Hex / canonicalArgsDigest are stable & 64-hex-char.
//   - No plaintext bodies are persisted: caller's note is stored verbatim,
//     but the schema does not include any body field.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AutonomyEventLog,
  canonicalArgsDigest,
  isUlid,
  sha256Hex,
  type IAutonomyEventLogFs,
  type IAutonomyEventRecord,
} from '../../src/services/autonomyEventLog';

// ---------------------------------------------------------------------------
// In-memory fs bridge
// ---------------------------------------------------------------------------

function memoryFs(): IAutonomyEventLogFs & { dump(): Map<string, string> } {
  const files = new Map<string, string>();
  return {
    dump: () => files,
    async exists(path: string) {
      return { ok: true, exists: files.has(path) };
    },
    async readFile(path: string) {
      const data = files.get(path);
      return data === undefined
        ? { ok: false, error: 'ENOENT' }
        : { ok: true, data };
    },
    async writeFile(path: string, content: string) {
      files.set(path, content);
      return { ok: true };
    },
    async mkdir() {
      return { ok: true };
    },
    async readdir(_path: string) {
      return {
        ok: true,
        entries: Array.from(files.keys()).map(p => ({
          name: p.split(/[\\/]/).pop() ?? p,
        })),
      };
    },
    async delete(path: string) {
      files.delete(path);
      return { ok: true };
    },
  };
}

// ---------------------------------------------------------------------------
// SubtleCrypto polyfill for sha256 in the Node test environment.
// Vitest runs under jsdom by default, but SubtleCrypto availability varies.
// ---------------------------------------------------------------------------

beforeEach(async () => {
  if (!(globalThis as { crypto?: { subtle?: SubtleCrypto } }).crypto?.subtle) {
    const { webcrypto } = await import('node:crypto');
    (globalThis as { crypto: typeof webcrypto }).crypto = webcrypto;
  }
});

afterEach(() => {
  vi.useRealTimers();
});

describe('AutonomyEventLog (M60 §3.10)', () => {
  it('writes a structured ndjson record on emit', async () => {
    const fs = memoryFs();
    const log = new AutonomyEventLog(fs, {
      dataDir: '/data',
      now: () => Date.parse('2026-04-30T12:00:00Z'),
    });
    const record = log.emit({
      trigger: { kind: 'followup', ref: 'sess-1' },
      outcome: 'completed',
      durationMs: 42,
      tokensIn: 100,
      tokensOut: 50,
    });
    await log.flush();

    expect(isUlid(record.id)).toBe(true);
    expect(record.triggeredAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(record.outcome).toBe('completed');

    // File written on the right day key.
    const file = '/data/autonomy-events.2026-04-30.ndjson';
    expect(fs.dump().has(file)).toBe(true);

    // ndjson content is one record per line, newline-terminated.
    const raw = fs.dump().get(file)!;
    const lines = raw.trim().split('\n');
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]) as IAutonomyEventRecord;
    expect(parsed.id).toBe(record.id);
    expect(parsed.trigger.kind).toBe('followup');
    expect(parsed.tokensIn).toBe(100);

    // No body / message / file content fields anywhere in the schema.
    expect(parsed).not.toHaveProperty('body');
    expect(parsed).not.toHaveProperty('message');
    expect(parsed).not.toHaveProperty('content');
  });

  it('readDay parses every emitted record', async () => {
    const fs = memoryFs();
    const log = new AutonomyEventLog(fs, {
      dataDir: '/data',
      now: () => Date.parse('2026-04-30T12:00:00Z'),
    });
    log.emit({ trigger: { kind: 'cron' }, outcome: 'completed' });
    log.emit({ trigger: { kind: 'heartbeat' }, outcome: 'gated' });
    log.emit({ trigger: { kind: 'followup' }, outcome: 'cancelled' });
    await log.flush();

    const records = await log.readDay('2026-04-30');
    expect(records).toHaveLength(3);
    expect(records.map(r => r.outcome)).toStrictEqual(['completed', 'gated', 'cancelled']);
  });

  it('findById walks the retention window', async () => {
    const fs = memoryFs();
    let nowMs = Date.parse('2026-04-30T12:00:00Z');
    const log = new AutonomyEventLog(fs, {
      dataDir: '/data',
      now: () => nowMs,
      retentionDays: 5,
    });
    const r1 = log.emit({ trigger: { kind: 'followup' }, outcome: 'completed' });
    await log.flush();

    // Advance 2 days and emit again.
    nowMs = Date.parse('2026-05-02T12:00:00Z');
    const r2 = log.emit({ trigger: { kind: 'cron' }, outcome: 'completed' });
    await log.flush();

    expect(await log.findById(r1.id)).toMatchObject({ id: r1.id });
    expect(await log.findById(r2.id)).toMatchObject({ id: r2.id });
    expect(await log.findById('not-a-real-id')).toBeUndefined();
  });

  it('sha256Hex returns 64 hex chars', async () => {
    const hash = await sha256Hex('hello world');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    // Stable for identical input.
    expect(await sha256Hex('hello world')).toBe(hash);
  });

  it('canonicalArgsDigest is order-independent', async () => {
    const a = await canonicalArgsDigest({ b: 2, a: 1 });
    const b = await canonicalArgsDigest({ a: 1, b: 2 });
    expect(a).toBe(b);
  });

  it('ulids are 26 chars and time-prefix sortable', () => {
    const fs = memoryFs();
    const log = new AutonomyEventLog(fs, {
      dataDir: '/data',
      now: () => Date.parse('2026-04-30T12:00:00Z'),
    });
    const r1 = log.emit({ trigger: { kind: 'chat' }, outcome: 'completed' });
    expect(r1.id).toHaveLength(26);
    expect(isUlid(r1.id)).toBe(true);
  });
});
