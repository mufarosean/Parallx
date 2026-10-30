// moUpscaleBatch.test.ts — Atelier's Upscale over several photos: one engine
// run for the batch, so the model loads once (upscale-batch.js, and
// moEnhanceRunMany in enhance-engine.js). Output names, the command, results
// mapped back to their photos, a failure in one photo, Stop, and the work
// folder removed however the run ends. The engine itself is faked.
import { afterEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error — JS module with no types
import { moUpscaleBatch, moUpscaleOutputName, moUpscaleUniqueOutputPath } from '../../ext/media-organizer/upscale-batch.js';
// @ts-expect-error — JS module with no types
import { moEnhanceActivate, moEnhanceManyArgs, moEnhanceManyProgress, moEnhanceRunMany } from '../../ext/media-organizer/enhance-engine.js';

type Target = { path: string; basename: string; item: { id: number } };
type Job = { input: string; output: string };
type Photo = { index: number; ok: boolean; error?: string; work?: string };
type ManyOpts = { workDir: string; onRunId: (id: string) => void; onPhoto: (p: Photo) => void };
type Progress = { index: number; label: string; fraction: number };

const target = (path: string, id: number): Target => ({ path, basename: path.slice(path.lastIndexOf('/') + 1), item: { id } });

/** Fake deps: a disk of `files`, a work folder that records its removal, and a scripted engine. */
function harness(files: string[], engine: (jobs: Job[], opts: ManyOpts) => Promise<{ ok: boolean; stopped: boolean; error: string }>) {
  const disk = new Set(files);
  const log: string[] = [];
  const finished: [string, string][] = [];
  const disposed: string[] = [];
  const runMany = vi.fn(async (jobs: Job[], _scale: number, _onProgress: (p: Progress) => void, opts: ManyOpts) => {
    log.push('run');
    return engine(jobs, opts);
  });
  const runOne = vi.fn(async (_input: string, output: string) => { disk.add(output); });
  const deps = {
    exists: async (p: string) => disk.has(p),
    readsDirectly: (p: string) => !/\.heic$/i.test(p),
    convert: vi.fn(async (_src: string, png: string) => { disk.add(png); }),
    withTemp: async (work: (dir: string) => Promise<unknown>) => {
      log.push('temp made');
      try { return await work('/ws/.enhance-x'); } finally { log.push('temp removed'); }
    },
    dispose: async (paths: string[]) => { disposed.push(...paths); },
    runOne,
    runMany,
    onRunId: vi.fn(),
    isCancelled: () => false,
    onProgress: vi.fn(),
    finish: async (t: Target, out: string) => { finished.push([t.basename, out]); },
  };
  return { deps, disk, log, finished, disposed, runMany, runOne };
}

describe('output names', () => {
  it('names the result beside the original, numbered past files on disk and names the batch took', async () => {
    expect(moUpscaleOutputName('photo.jpg', 2)).toBe('photo-2x.png');
    expect(moUpscaleOutputName('photo.jpg', 4, 3)).toBe('photo-4x (3).png');
    expect(moUpscaleOutputName('.hidden', 2)).toBe('.hidden-2x.png');
    const disk = new Set(['/p/a-2x.png']);
    const exists = async (p: string) => disk.has(p);
    expect(await moUpscaleUniqueOutputPath('/p/a.jpg', 2, exists)).toBe('/p/a-2x (2).png');
    expect(await moUpscaleUniqueOutputPath('/p/a.jpg', 2, exists, new Set(['/p/a-2x (2).png']))).toBe('/p/a-2x (3).png');
    expect(await moUpscaleUniqueOutputPath('C:\\p\\b.png', 4, exists)).toBe('C:\\p\\b-4x.png');
  });
});

describe('the batch command', () => {
  it('passes the job list, scale, piece size and work folder', () => {
    expect(moEnhanceManyArgs('/w/jobs.json', 4, 2048, '/w')).toEqual(['--jobs', '/w/jobs.json', '--scale', '4', '--piece-out', '2048', '--work-dir', '/w']);
  });

  it('reads the progress lines into labels over the whole batch, and finished photos', () => {
    const follow = moEnhanceManyProgress(2);
    expect(follow({ stage: 'read' })).toEqual({ index: 0, label: 'Reading the pictures', fraction: 0 });
    expect(follow({ stage: 'enlarge', photo: 0, done: 0, total: 4 })).toEqual({ index: 0, label: 'Loading the model and enlarging piece 1 of 4', fraction: 0 });
    expect(follow({ stage: 'enlarge', photo: 0, done: 2, total: 4 })).toEqual({ index: 0, label: 'Enlarging piece 3 of 4', fraction: 0.25 });
    expect(follow({ stage: 'photo', photo: 0, ok: true, work: '/w/p0000' })).toEqual({ photo: { index: 0, ok: true, error: '', work: '/w/p0000' } });
    // The model is loaded now: the next photo's first piece does not say it loads again.
    expect(follow({ stage: 'enlarge', photo: 1, done: 0, total: 2 })).toEqual({ index: 1, label: 'Enlarging piece 1 of 2', fraction: 0.5 });
    expect(follow({ stage: 'photo', photo: 1, ok: false, error: 'Too big.' })).toEqual({ photo: { index: 1, ok: false, error: 'Too big.', work: '' } });
    expect(follow({ stage: 'join', photo: 1 })).toBeNull();
    expect(follow('not json')).toBeNull();
  });
});

describe('moUpscaleBatch', () => {
  it('runs the engine once for every photo and maps each result back to its photo', async () => {
    const h = harness(['/p/a.jpg', '/p/a.png', '/q/b.heic'], async (jobs, opts) => {
      for (const [i, j] of jobs.entries()) { h.disk.add(j.output); opts.onPhoto({ index: i, ok: true, work: `${opts.workDir}/p000${i}` }); }
      return { ok: true, stopped: false, error: '' };
    });
    const targets = [target('/p/a.jpg', 1), target('/p/a.png', 2), target('/q/b.heic', 3)];
    const res = await moUpscaleBatch(targets, 2, h.deps);
    expect(h.runMany).toHaveBeenCalledTimes(1);
    expect(h.runOne).not.toHaveBeenCalled();
    // Two photos of one stem in one folder get two names; the HEIC goes as a PNG made in the work folder.
    expect(h.runMany.mock.calls[0][0]).toEqual([
      { input: '/p/a.jpg', output: '/p/a-2x.png' },
      { input: '/p/a.png', output: '/p/a-2x (2).png' },
      { input: '/ws/.enhance-x/source-2.png', output: '/q/b-2x.png' },
    ]);
    expect(h.runMany.mock.calls[0][3].workDir).toBe('/ws/.enhance-x');
    expect(h.finished).toEqual([['a.jpg', '/p/a-2x.png'], ['a.png', '/p/a-2x (2).png'], ['b.heic', '/q/b-2x.png']]);
    expect(res).toEqual({ written: 3, failures: [], stopped: false });
    // Each photo's pieces go as it finishes; the work folder goes at the end.
    expect(h.disposed).toEqual(expect.arrayContaining(['/ws/.enhance-x/p0000', '/ws/.enhance-x/p0001', '/ws/.enhance-x/p0002']));
    expect(h.log).toEqual(['temp made', 'run', 'temp removed']);
    // The originals are only read.
    expect([...h.disk]).toEqual(expect.arrayContaining(['/p/a.jpg', '/p/a.png', '/q/b.heic']));
  });

  it('reports a failure in one photo for that photo, and the others are kept', async () => {
    const h = harness(['/p/1.jpg', '/p/2.jpg', '/p/3.jpg'], async (jobs, opts) => {
      h.disk.add(jobs[0].output); opts.onPhoto({ index: 0, ok: true });
      opts.onPhoto({ index: 1, ok: false, error: 'The graphics card ran out of memory.' });
      h.disk.add(jobs[2].output); opts.onPhoto({ index: 2, ok: true });
      return { ok: true, stopped: false, error: '' };
    });
    const res = await moUpscaleBatch([target('/p/1.jpg', 1), target('/p/2.jpg', 2), target('/p/3.jpg', 3)], 4, h.deps);
    expect(res.written).toBe(2);
    expect(res.failures.map((f: { target: Target; message: string }) => [f.target.basename, f.message])).toEqual([['2.jpg', 'The graphics card ran out of memory.']]);
    expect(h.finished.map(([b]) => b)).toEqual(['1.jpg', '3.jpg']);
    // The half-written result of the failed photo is removed.
    expect(h.disposed).toContain('/p/2-4x.png.part');
    expect(h.disposed).not.toContain('/p/1-4x.png.part');
  });

  it('fails the photos the engine never reported when it stops on its own, and keeps a result already whole', async () => {
    const h = harness(['/p/1.jpg', '/p/2.jpg', '/p/3.jpg'], async (jobs) => {
      h.disk.add(jobs[0].output);   // written, but its line was lost
      return { ok: false, stopped: false, error: 'The enlargement stopped: code 3.' };
    });
    const res = await moUpscaleBatch([target('/p/1.jpg', 1), target('/p/2.jpg', 2), target('/p/3.jpg', 3)], 2, h.deps);
    expect(res.written).toBe(1);
    expect(res.failures.map((f: { message: string }) => f.message)).toEqual(['The enlargement stopped: code 3.', 'The enlargement stopped: code 3.']);
    expect(h.log).toEqual(['temp made', 'run', 'temp removed']);
  });

  it('on Stop, keeps what finished and fails nothing', async () => {
    const h = harness(['/p/1.jpg', '/p/2.jpg'], async (jobs, opts) => {
      h.disk.add(jobs[0].output); opts.onPhoto({ index: 0, ok: true });
      return { ok: false, stopped: true, error: 'Stopped.' };
    });
    const res = await moUpscaleBatch([target('/p/1.jpg', 1), target('/p/2.jpg', 2)], 2, h.deps);
    expect(res).toEqual({ written: 1, failures: [], stopped: true });
    expect(h.disposed).toContain('/p/2-2x.png.part');
  });

  it('removes the work folder when the engine throws', async () => {
    const h = harness(['/p/1.jpg', '/p/2.jpg'], async () => { throw new Error('Enhance needs the desktop app.'); });
    const res = await moUpscaleBatch([target('/p/1.jpg', 1), target('/p/2.jpg', 2)], 2, h.deps);
    expect(res.written).toBe(0);
    expect(res.failures.map((f: { message: string }) => f.message)).toEqual(['Enhance needs the desktop app.', 'Enhance needs the desktop app.']);
    expect(h.log).toEqual(['temp made', 'run', 'temp removed']);
  });

  it('a photo that cannot be converted fails alone; the rest still run', async () => {
    const h = harness(['/p/1.heic', '/p/2.jpg', '/p/3.jpg'], async (jobs, opts) => {
      for (const [i, j] of jobs.entries()) { h.disk.add(j.output); opts.onPhoto({ index: i, ok: true }); }
      return { ok: true, stopped: false, error: '' };
    });
    h.deps.convert.mockRejectedValueOnce(new Error('The photo could not be read.'));
    const res = await moUpscaleBatch([target('/p/1.heic', 1), target('/p/2.jpg', 2), target('/p/3.jpg', 3)], 2, h.deps);
    expect(h.runMany.mock.calls[0][0].map((j: Job) => j.input)).toEqual(['/p/2.jpg', '/p/3.jpg']);
    expect(h.finished.map(([b]) => b)).toEqual(['2.jpg', '3.jpg']);
    expect(res.failures.map((f: { target: Target; message: string }) => [f.target.basename, f.message])).toEqual([['1.heic', 'The photo could not be read.']]);
  });

  it('one photo goes through the single-picture run, as before', async () => {
    const h = harness(['/p/1.jpg'], async () => ({ ok: true, stopped: false, error: '' }));
    const res = await moUpscaleBatch([target('/p/1.jpg', 1)], 2, h.deps);
    expect(h.runMany).not.toHaveBeenCalled();
    expect(h.runOne).toHaveBeenCalledTimes(1);
    expect(h.runOne.mock.calls[0].slice(0, 3)).toEqual(['/p/1.jpg', '/p/1-2x.png', 2]);
    expect(res).toEqual({ written: 1, failures: [], stopped: false });
  });

  it('does not start when Stop came first', async () => {
    const h = harness(['/p/1.jpg', '/p/2.jpg'], async () => ({ ok: true, stopped: false, error: '' }));
    const res = await moUpscaleBatch([target('/p/1.jpg', 1), target('/p/2.jpg', 2)], 2, { ...h.deps, isCancelled: () => true });
    expect(h.runMany).not.toHaveBeenCalled();
    expect(res).toEqual({ written: 0, failures: [], stopped: true });
    expect(h.log).toEqual(['temp made', 'temp removed']);
  });
});

describe('moEnhanceRunMany', () => {
  const w = globalThis as unknown as { window?: unknown };
  afterEach(() => { delete w.window; });

  it('writes the job list, starts one run, and routes its lines to progress and finished photos', async () => {
    let listener: ((p: unknown) => void) | null = null;
    const written: [string, string][] = [];
    const invoke = vi.fn(async (channel: string, _spec: unknown, script?: string, _args?: string[], runId?: string) => {
      if (channel === 'runtimes:status') return { state: 'ready' };
      if (channel === 'runtimes:check') return { ok: true, problems: [], cards: [{ name: 'card', vramMiB: 24000, freeMiB: 22000 }] };
      if (channel === 'runtimes:run') {
        expect(script).toBe('/app/ext/media-organizer/engine/enhance.py');
        const send = (data: unknown) => listener && listener({ id: 'seedvr2-enhance', kind: 'run', runId, data });
        send({ stage: 'enlarge', photo: 0, done: 0, total: 2 });
        send({ stage: 'photo', photo: 0, ok: true, work: '/w/p0000' });
        send({ stage: 'photo', photo: 1, ok: false, error: 'Too big.', work: '/w/p0001' });
        return { ok: true };
      }
      return null;
    });
    w.window = {
      parallxElectron: {
        optionalBridges: { invoke, on: (_ch: string, fn: (p: unknown) => void) => { listener = fn; return () => { listener = null; }; } },
        fs: { writeFile: async (p: string, text: string) => { written.push([p, text]); return {}; } },
      },
    };
    const api = { commands: { registerCommand: () => ({ dispose() {} }) } };
    const subs = moEnhanceActivate(api, '/app/ext/media-organizer');
    const progress: Progress[] = [];
    const photos: Photo[] = [];
    const r = await moEnhanceRunMany([{ input: '/p/a.jpg', output: '/p/a-2x.png' }, { input: '/p/b.jpg', output: '/p/b-2x.png' }], 2,
      (p: Progress) => progress.push(p), { workDir: '/w', onPhoto: (p: Photo) => photos.push(p) });
    for (const s of subs) s.dispose();
    expect(r).toEqual({ ok: true, stopped: false, error: '' });
    expect(written).toEqual([['/w/jobs.json', JSON.stringify([{ input: '/p/a.jpg', output: '/p/a-2x.png' }, { input: '/p/b.jpg', output: '/p/b-2x.png' }])]]);
    const runs = invoke.mock.calls.filter((c) => c[0] === 'runtimes:run');
    expect(runs).toHaveLength(1);
    expect(runs[0][3]).toEqual(['--jobs', '/w/jobs.json', '--scale', '2', '--piece-out', '4096', '--work-dir', '/w']);
    expect(progress).toEqual([{ index: 0, label: 'Loading the model and enlarging piece 1 of 2', fraction: 0 }]);
    expect(photos).toEqual([{ index: 0, ok: true, error: '', work: '/w/p0000' }, { index: 1, ok: false, error: 'Too big.', work: '/w/p0001' }]);
  });
});
