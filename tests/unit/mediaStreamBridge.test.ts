/**
 * parallx-media:// — local video and audio streamed with range requests
 * (electron/mediaStreamBridge.cjs). The handler is driven here with real
 * Request objects against a temp file, through a stand-in for Electron's
 * protocol module.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const require = createRequire(import.meta.url);
const M = require('../../electron/mediaStreamBridge.cjs');

describe('urls', () => {
  it('round-trips an absolute path, spaces and all', () => {
    const p = join(tmpdir(), 'Painting sessions', 'oil #3 (final).mp4');
    expect(M.pathFromMediaUrl(M.mediaUrlFor(p))).toBe(p);
  });
  it('refuses relative paths, other hosts and other schemes', () => {
    expect(M.pathFromMediaUrl('parallx-media://file/relative%2Fx.mp4')).toBeNull();
    expect(M.pathFromMediaUrl('parallx-media://other/%2Ftmp%2Fx.mp4')).toBeNull();
    expect(M.pathFromMediaUrl('https://file/%2Ftmp%2Fx.mp4')).toBeNull();
    expect(M.pathFromMediaUrl('parallx-media://file/%2Ftmp%2Fx%00.mp4')).toBeNull();
  });
  it('normalises traversal before the access check sees it', () => {
    expect(M.pathFromMediaUrl(M.mediaUrlFor('/work/space/../../etc/x.mp4'))).toBe(join('/', 'etc', 'x.mp4'));
  });
});

describe('range parsing', () => {
  it('reads the forms a media element sends', () => {
    expect(M.parseRange('bytes=0-', 1000)).toEqual({ start: 0, end: 999 });
    expect(M.parseRange('bytes=100-199', 1000)).toEqual({ start: 100, end: 199 });
    expect(M.parseRange('bytes=900-5000', 1000)).toEqual({ start: 900, end: 999 });
    expect(M.parseRange('bytes=-100', 1000)).toEqual({ start: 900, end: 999 });
    expect(M.parseRange('bytes=0-9, 20-29', 1000)).toEqual({ start: 0, end: 9 });
  });
  it('tells no range from an unsatisfiable one', () => {
    expect(M.parseRange(null, 1000)).toBeNull();
    expect(M.parseRange('items=0-1', 1000)).toBeNull();
    expect(M.parseRange('bytes=-', 1000)).toBeNull();
    expect(M.parseRange('bytes=1000-', 1000)).toBe('unsatisfiable');
    expect(M.parseRange('bytes=50-10', 1000)).toBe('unsatisfiable');
    expect(M.parseRange('bytes=0-', 0)).toBe('unsatisfiable');
  });
});

describe('handler', () => {
  let dir = '';
  let file = '';
  let handler: (req: Request) => Promise<Response>;
  const bytes = Buffer.from(Array.from({ length: 4096 }, (_, i) => i % 251));

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'pmedia-'));
    file = join(dir, 'session.mp4');
    writeFileSync(file, bytes);
    writeFileSync(join(dir, 'notes.txt'), 'secret');
    const protocol = { handle: (_scheme: string, fn: (req: Request) => Promise<Response>) => { handler = fn; } };
    M.setupMediaStreamBridge(protocol, (p: string) => p.startsWith(dir));
  });
  afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

  const get = (url: string, headers: Record<string, string> = {}, method = 'GET') => handler(new Request(url, { headers, method }));

  it('serves a range as 206 with the right bytes and headers', async () => {
    const res = await get(M.mediaUrlFor(file), { Range: 'bytes=100-199' });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe('bytes 100-199/4096');
    expect(res.headers.get('content-length')).toBe('100');
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(res.headers.get('content-type')).toBe('video/mp4');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    const got = Buffer.from(await res.arrayBuffer());
    expect(got.equals(bytes.subarray(100, 200))).toBe(true);
  });
  it('serves the whole file without a range', async () => {
    const res = await get(M.mediaUrlFor(file));
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer()).equals(bytes)).toBe(true);
  });
  it('answers HEAD without a body', async () => {
    const res = await get(M.mediaUrlFor(file), {}, 'HEAD');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-length')).toBe('4096');
  });
  it('refuses what it must not serve', async () => {
    expect((await get(M.mediaUrlFor(file), { Range: 'bytes=5000-' })).status).toBe(416);
    expect((await get(M.mediaUrlFor(join(dir, 'notes.txt')))).status).toBe(400);
    expect((await get(M.mediaUrlFor(join(tmpdir(), 'elsewhere.mp4')))).status).toBe(403);
    expect((await get(M.mediaUrlFor(join(dir, 'missing.mp4')))).status).toBe(404);
  });
});
