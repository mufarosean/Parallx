// documentExtractionService.test.ts — pin DocumentExtractionService.
//
// Bridges-Docling-or-legacy facade. Pins:
//   - initialize:
//     - no api → bridgeStatus 'unavailable', not initialized→initialized=true (single-pass);
//     - status() returns 'available' → bridgeStatus 'available' + isDoclingAvailable=true; start() NOT called;
//     - status() throws → start() attempted; start.ok=true → 'available'+true; start.ok=false → 'unavailable'+false.
//     - re-initialize is a no-op (single-pass).
//   - extractDocument: docling unavailable → legacy path; ocr=true selects 'docling-ocr' pipeline; ocr=false → 'docling'.
//   - extractDocument: docling throws → falls back to legacy (no rethrow).
//   - extractDocument result mapping: missing fields default (markdown=''; page_count=0; tables_found=0; elapsed_ms=0; diagnostics=[]).
//   - extractDocument: !result.ok → legacy fallback (NOT thrown).
//   - extractBatch: empty input → empty map; docling batch path maps results pairwise; failed items skipped.
//   - extractBatch: docling unavailable → sequential extractDocument per file.
//   - extractBatch: docling batch throws → sequential fallback.
//   - legacy path: missing api throws; error.message thrown; pipeline='legacy'; diagnostics=['Legacy extractor used'].
//   - availability/bridgeStatus events fired only on change (idempotent setters).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DocumentExtractionService } from '../../src/services/documentExtractionService';

interface Apis {
  docling?: any;
  document?: any;
}
function setApis(a: Apis) {
  (globalThis as any).window = { parallxElectron: a };
}
function clearApis() {
  delete (globalThis as any).window;
}

describe('DocumentExtractionService — initialize', () => {
  afterEach(clearApis);

  it('no docling api → bridgeStatus=unavailable; sets initialized=true (idempotent)', async () => {
    setApis({});
    const svc = new DocumentExtractionService();
    const statuses: string[] = [];
    svc.onDidChangeBridgeStatus((s) => statuses.push(s));
    await svc.initialize();
    expect(svc.bridgeStatus).toBe('unavailable');
    expect(svc.isDoclingAvailable).toBe(false);
    await svc.initialize();
    // No extra status events fired (idempotent setter; also _initialized gate)
    expect(statuses.length).toBeLessThanOrEqual(1);
  });

  it("status.status='available' → bridgeStatus=available + isDoclingAvailable=true; start NOT called", async () => {
    const start = vi.fn();
    setApis({ docling: { status: vi.fn(async () => ({ status: 'available', port: 0, pythonPath: '', doclingInstalled: true })), start } });
    const svc = new DocumentExtractionService();
    let availFires = 0;
    svc.onDidChangeAvailability(() => availFires++);
    await svc.initialize();
    expect(svc.bridgeStatus).toBe('available');
    expect(svc.isDoclingAvailable).toBe(true);
    expect(start).not.toHaveBeenCalled();
    expect(availFires).toBe(1);
  });

  it('status throws → start() attempted; ok=true → available+true', async () => {
    setApis({ docling: { status: vi.fn(async () => { throw new Error('not started'); }), start: vi.fn(async () => ({ ok: true })) } });
    const svc = new DocumentExtractionService();
    const transitions: string[] = [];
    svc.onDidChangeBridgeStatus((s) => transitions.push(s));
    await svc.initialize();
    expect(transitions).toEqual(['starting', 'available']);
    expect(svc.isDoclingAvailable).toBe(true);
  });

  it('start ok=false → unavailable+false', async () => {
    setApis({ docling: { status: vi.fn(async () => { throw new Error('x'); }), start: vi.fn(async () => ({ ok: false, error: 'no python' })) } });
    const svc = new DocumentExtractionService();
    await svc.initialize();
    expect(svc.bridgeStatus).toBe('unavailable');
    expect(svc.isDoclingAvailable).toBe(false);
  });

  it('start throws → unavailable+false', async () => {
    setApis({ docling: { status: vi.fn(async () => { throw new Error('x'); }), start: vi.fn(async () => { throw new Error('boom'); }) } });
    const svc = new DocumentExtractionService();
    await svc.initialize();
    expect(svc.bridgeStatus).toBe('unavailable');
    expect(svc.isDoclingAvailable).toBe(false);
  });
});

describe('DocumentExtractionService — extractDocument', () => {
  beforeEach(clearApis);
  afterEach(clearApis);

  it('uses Docling when available; ocr flag drives pipeline selection', async () => {
    const convert = vi.fn(async (_p: string, opts: any) => ({
      ok: true,
      markdown: 'MD',
      page_count: 3,
      tables_found: 1,
      elapsed_ms: 42,
      diagnostics: ['d1'],
    }));
    setApis({ docling: { status: vi.fn(async () => ({ status: 'available' })), start: vi.fn(), convert } });
    const svc = new DocumentExtractionService();
    await svc.initialize();
    const r1 = await svc.extractDocument('a.pdf', { ocr: false });
    expect(r1.pipeline).toBe('docling');
    expect(r1.markdown).toBe('MD');
    expect(r1.pageCount).toBe(3);
    expect(r1.tablesFound).toBe(1);
    expect(r1.elapsedMs).toBe(42);
    expect(r1.diagnostics).toEqual(['d1']);
    const r2 = await svc.extractDocument('a.pdf', { ocr: true });
    expect(r2.pipeline).toBe('docling-ocr');
    expect(convert).toHaveBeenLastCalledWith('a.pdf', { ocr: true });
  });

  it('docling missing fields default to safe values', async () => {
    setApis({ docling: { status: vi.fn(async () => ({ status: 'available' })), start: vi.fn(), convert: vi.fn(async () => ({ ok: true })) } });
    const svc = new DocumentExtractionService();
    await svc.initialize();
    const r = await svc.extractDocument('a.pdf');
    expect(r.markdown).toBe('');
    expect(r.pageCount).toBe(0);
    expect(r.tablesFound).toBe(0);
    expect(r.elapsedMs).toBe(0);
    expect(r.diagnostics).toEqual([]);
  });

  it('docling !ok → falls back to legacy (does NOT throw to caller)', async () => {
    const extractText = vi.fn(async () => ({ text: 'legacy text', metadata: { pageCount: 2 } }));
    setApis({
      docling: { status: vi.fn(async () => ({ status: 'available' })), start: vi.fn(), convert: vi.fn(async () => ({ ok: false, error: 'nope' })) },
      document: { extractText },
    });
    const svc = new DocumentExtractionService();
    await svc.initialize();
    const r = await svc.extractDocument('a.pdf');
    expect(r.pipeline).toBe('legacy');
    expect(r.markdown).toBe('legacy text');
    expect(r.pageCount).toBe(2);
    expect(extractText).toHaveBeenCalledWith('a.pdf');
  });

  it('docling throws → falls back to legacy', async () => {
    const extractText = vi.fn(async () => ({ text: 'leg' }));
    setApis({
      docling: { status: vi.fn(async () => ({ status: 'available' })), start: vi.fn(), convert: vi.fn(async () => { throw new Error('boom'); }) },
      document: { extractText },
    });
    const svc = new DocumentExtractionService();
    await svc.initialize();
    const r = await svc.extractDocument('a.pdf');
    expect(r.pipeline).toBe('legacy');
    expect(r.markdown).toBe('leg');
    expect(r.diagnostics).toEqual(['Legacy extractor used']);
  });

  it('docling unavailable + no legacy api → throws', async () => {
    setApis({});
    const svc = new DocumentExtractionService();
    await svc.initialize();
    await expect(svc.extractDocument('a.pdf')).rejects.toThrow(/Legacy document extraction API not available/);
  });

  it('legacy error → thrown with .message', async () => {
    setApis({ document: { extractText: vi.fn(async () => ({ error: { code: 'E', message: 'bad file', path: 'a' } })) } });
    const svc = new DocumentExtractionService();
    await svc.initialize();
    await expect(svc.extractDocument('a.pdf')).rejects.toThrow(/bad file/);
  });
});

describe('DocumentExtractionService — extractBatch', () => {
  afterEach(clearApis);

  it('empty input → empty map (no api calls)', async () => {
    const convertBatch = vi.fn();
    setApis({ docling: { status: vi.fn(async () => ({ status: 'available' })), start: vi.fn(), convertBatch } });
    const svc = new DocumentExtractionService();
    await svc.initialize();
    const map = await svc.extractBatch([]);
    expect(map.size).toBe(0);
    expect(convertBatch).not.toHaveBeenCalled();
  });

  it('docling batch path maps results pairwise; failed items skipped', async () => {
    const convertBatch = vi.fn(async () => ({
      ok: true,
      results: [
        { ok: true, markdown: 'A', page_count: 1, tables_found: 0, elapsed_ms: 1, diagnostics: [] },
        { ok: false, error: 'fail-2' },
        { error: 'fail-3' },
      ],
    }));
    setApis({ docling: { status: vi.fn(async () => ({ status: 'available' })), start: vi.fn(), convertBatch } });
    const svc = new DocumentExtractionService();
    await svc.initialize();
    const map = await svc.extractBatch([
      { path: 'p1', ocr: false },
      { path: 'p2' },
      { path: 'p3', ocr: true },
    ]);
    expect([...map.keys()]).toEqual(['p1']);
    expect(map.get('p1')?.markdown).toBe('A');
    expect(map.get('p1')?.pipeline).toBe('docling');
  });

  it('docling unavailable → sequential extractDocument per file via legacy', async () => {
    const extractText = vi.fn(async (p: string) => ({ text: `text-${p}` }));
    setApis({ document: { extractText } });
    const svc = new DocumentExtractionService();
    await svc.initialize();
    const map = await svc.extractBatch([{ path: 'a' }, { path: 'b' }]);
    expect(map.get('a')?.markdown).toBe('text-a');
    expect(map.get('b')?.markdown).toBe('text-b');
    expect(map.get('a')?.pipeline).toBe('legacy');
  });

  it('docling batch throws → sequential fallback', async () => {
    const extractText = vi.fn(async () => ({ text: 't' }));
    setApis({
      docling: {
        status: vi.fn(async () => ({ status: 'available' })),
        start: vi.fn(),
        convert: vi.fn(async () => ({ ok: true, markdown: 't' })),
        convertBatch: vi.fn(async () => { throw new Error('batch fail'); }),
      },
      document: { extractText },
    });
    const svc = new DocumentExtractionService();
    await svc.initialize();
    const map = await svc.extractBatch([{ path: 'a' }]);
    expect(map.get('a')?.markdown).toBe('t');
    // pipeline is 'docling' since convert (single) succeeded
    expect(map.get('a')?.pipeline).toBe('docling');
  });
});

describe('DocumentExtractionService — change events', () => {
  afterEach(clearApis);

  it('availability + bridge events do not fire on repeated identical sets', async () => {
    setApis({ docling: { status: vi.fn(async () => ({ status: 'available' })), start: vi.fn() } });
    const svc = new DocumentExtractionService();
    let availFires = 0;
    let statusFires = 0;
    svc.onDidChangeAvailability(() => availFires++);
    svc.onDidChangeBridgeStatus(() => statusFires++);
    await svc.initialize();
    await svc.initialize(); // gated by _initialized
    expect(availFires).toBe(1);
    expect(statusFires).toBe(1);
  });
});
