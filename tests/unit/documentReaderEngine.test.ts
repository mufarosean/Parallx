// documentReaderEngine.test.ts — the one place the app asks where the
// document reader's engine stands, changes it, and has it read a document.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentReaderEngine, phaseOf, type IReaderEngineState } from '../../src/services/documentReaderEngine';

type Progress = { id?: string; kind?: string; step?: string; label?: string; fraction?: number; received?: number; total?: number };

/** The main process, as the preload shows it: a reader in the state given, and the set-up's progress channel. */
function fakeElectron(o: { status?: string; installed?: boolean; engine?: 'managed' | 'system' | null; state?: 'absent' | 'partial' | 'ready'; installing?: boolean; machine?: { ok: boolean; problems?: string[] }; bytes?: number } = {}) {
  const world = { status: o.status ?? 'unavailable', installed: o.installed ?? false, state: o.state ?? 'absent', installing: o.installing ?? false };
  let listener: ((p: Progress) => void) | null = null;
  const stop = vi.fn(() => { listener = null; });
  const docling = {
    status: vi.fn(async () => ({ status: world.status, doclingInstalled: world.installed, engine: o.engine ?? null })),
    engineStatus: vi.fn(async (withSize?: boolean) => ({ state: world.state, installing: world.installing, bytesOnDisk: withSize ? o.bytes ?? null : null, downloadBytes: 4 * 1024 ** 3, packageBytes: 3 * 1024 ** 3, machine: o.machine ?? { ok: true, problems: [] } })),
    start: vi.fn(async () => { world.status = 'available'; return { ok: true }; }),
    install: vi.fn(async (): Promise<{ ok: boolean; output?: string; stopped?: boolean }> => { world.state = 'ready'; world.installed = true; return { ok: true }; }),
    cancelInstall: vi.fn(async () => true),
    removeEngine: vi.fn(async (): Promise<{ ok: boolean; error?: string }> => { world.state = 'absent'; world.installed = false; world.status = 'unavailable'; return { ok: true }; }),
    convert: vi.fn(async (_path: string, _options?: { ocr?: boolean }): Promise<{ ok: boolean; error?: string }> => ({ ok: true })),
  };
  (globalThis as { parallxElectron?: unknown }).parallxElectron = {
    docling,
    optionalBridges: { on: vi.fn((_channel: string, cb: (p: Progress) => void) => { listener = cb; return stop; }) },
  };
  return { docling, world, stop, send: (p: Progress) => listener?.(p), listening: () => listener !== null };
}

let engine: DocumentReaderEngine;
beforeEach(() => { engine = new DocumentReaderEngine(); });
afterEach(() => { vi.useRealTimers(); delete (globalThis as { parallxElectron?: unknown }).parallxElectron; });

describe('where the reader stands', () => {
  const machine = { ok: true };
  it('reads the phase from what the main process says', () => {
    expect(phaseOf(null, null)).toBe('none');
    expect(phaseOf({ status: 'unavailable' }, { state: 'absent', machine })).toBe('absent');
    expect(phaseOf({ status: 'unavailable' }, { state: 'partial', machine })).toBe('partial');
    expect(phaseOf({ status: 'unavailable' }, { state: 'partial', installing: true, machine })).toBe('installing');
    expect(phaseOf({ status: 'unavailable' }, { state: 'ready', machine })).toBe('ready');
    expect(phaseOf({ status: 'starting' }, { state: 'ready', machine })).toBe('starting');
    expect(phaseOf({ status: 'available', engine: 'managed' }, { state: 'ready', machine })).toBe('running');
    expect(phaseOf({ status: 'unavailable' }, { state: 'absent', machine: { ok: false, problems: ['No room.'] } })).toBe('unsupported');
  });

  it('counts a Docling in the computer\'s own Python as a reader: set up when it is there, running when it runs', () => {
    expect(phaseOf({ status: 'unavailable', doclingInstalled: true, engine: 'system' }, { state: 'absent', machine })).toBe('ready');
    expect(phaseOf({ status: 'available', doclingInstalled: true, engine: 'system' }, { state: 'absent', machine })).toBe('running');
  });

  it('asks nothing until it is asked, then says the phase, what a set-up downloads, and the size when measured', async () => {
    const e = fakeElectron({ status: 'available', installed: true, engine: 'managed', state: 'ready', bytes: 8 * 1024 ** 3 });
    expect(engine.state.phase).toBe('unknown');
    expect(e.docling.status).not.toHaveBeenCalled();
    const seen: IReaderEngineState[] = [];
    engine.onDidChange((s) => seen.push(s));
    expect(await engine.refresh()).toMatchObject({ phase: 'running', engine: 'managed', bytesOnDisk: null, downloadBytes: 7 * 1024 ** 3 });
    expect((await engine.refresh(true)).bytesOnDisk).toBe(8 * 1024 ** 3);
    expect((await engine.refresh()).bytesOnDisk).toBe(8 * 1024 ** 3); // a quick look keeps the size it measured
    expect(seen).toHaveLength(3);
  });

  it('says why a computer cannot run it, and that there is no reader outside the desktop app', async () => {
    fakeElectron({ machine: { ok: false, problems: ['It needs 9 GB of free disk; this drive has 2 GB.'] } });
    expect(await engine.refresh()).toMatchObject({ phase: 'unsupported', problems: ['It needs 9 GB of free disk; this drive has 2 GB.'] });
    delete (globalThis as { parallxElectron?: unknown }).parallxElectron;
    expect((await engine.refresh()).phase).toBe('none');
  });
});

describe('setting it up', () => {
  it('sets it up, shows each step, starts it, and says how it ended', async () => {
    const e = fakeElectron();
    let finish: (r: { ok: boolean }) => void = () => {};
    e.docling.install.mockImplementation(() => new Promise((resolve) => { finish = (r) => { e.world.state = 'ready'; e.world.installed = true; resolve(r); }; }));
    const ended = vi.fn();
    engine.onDidFinishSetUp(ended);
    const done = engine.setUp();
    expect(engine.state).toMatchObject({ phase: 'installing', step: { label: 'Checking this computer', fraction: 0 }, error: null });
    e.send({ id: 'docling', kind: 'install', step: 'files', label: 'Downloading layout.onnx', fraction: 0.6, received: 2 * 1024 ** 3, total: 4 * 1024 ** 3 });
    expect(engine.state.step).toEqual({ label: 'Downloading layout.onnx', fraction: 0.6, received: 2 * 1024 ** 3, total: 4 * 1024 ** 3 });
    e.send({ id: 'enhance', kind: 'install', step: 'files', label: 'Another engine', fraction: 0.9 });
    expect(engine.state.step?.label).toBe('Downloading layout.onnx'); // another engine's steps are not this one's
    // A look taken mid-way, before the main process says it is installing, does not lose the set-up.
    expect((await engine.refresh()).phase).toBe('installing');
    finish({ ok: true });
    expect(await done).toEqual({ ok: true, stopped: false });
    expect(e.docling.start).toHaveBeenCalledOnce();
    expect(engine.state).toMatchObject({ phase: 'running', step: null, error: null });
    expect(ended).toHaveBeenCalledWith({ ok: true, stopped: false });
    expect(e.listening()).toBe(false); // it stops hearing the steps when the set-up ends
  });

  it('a set-up that was stopped is no error, and leaves what is done', async () => {
    const e = fakeElectron();
    e.docling.install.mockImplementation(async () => { e.world.state = 'partial'; return { ok: false, stopped: true, output: 'Stopped.' }; });
    engine.stopSetUp();
    expect(e.docling.cancelInstall).toHaveBeenCalledOnce();
    expect(await engine.setUp()).toEqual({ ok: false, stopped: true });
    expect(engine.state).toMatchObject({ phase: 'partial', error: null });
  });

  it('says what went wrong when it fails, or when it is set up and will not start', async () => {
    const e = fakeElectron();
    e.docling.install.mockResolvedValueOnce({ ok: false, output: 'A model file is not the one Parallx expects.' });
    expect(await engine.setUp()).toEqual({ ok: false, stopped: false, error: 'A model file is not the one Parallx expects.' });
    expect(engine.state.error).toBe('A model file is not the one Parallx expects.');
    e.docling.start.mockResolvedValueOnce({ ok: false } as never);
    const second = await engine.setUp();
    expect(second.ok).toBe(false);
    expect(second.error).toMatch(/did not start/);
    expect(engine.state.error).toMatch(/did not start/);
  });

  it('does not start a second set-up over one that is running', async () => {
    const e = fakeElectron();
    e.docling.install.mockImplementation(() => new Promise(() => { /* never ends */ }));
    void engine.setUp();
    expect((await engine.setUp()).error).toMatch(/already/);
    expect(e.docling.install).toHaveBeenCalledOnce();
  });
});

describe('starting and removing', () => {
  it('starts a reader that is set up', async () => {
    const e = fakeElectron({ installed: true, state: 'ready' });
    expect(await engine.start()).toBe(true);
    expect(engine.state.phase).toBe('running');
    e.world.status = 'unavailable';
    e.docling.start.mockResolvedValueOnce({ ok: false, error: 'Its port is taken.' } as never);
    expect(await engine.start()).toBe(false);
    expect(engine.state).toMatchObject({ phase: 'ready', error: 'Its port is taken.' });
  });

  it('removes the engine, and says why when it cannot', async () => {
    const e = fakeElectron({ status: 'available', installed: true, engine: 'managed', state: 'ready', bytes: 8 * 1024 ** 3 });
    await engine.refresh(true);
    expect(await engine.remove()).toBe(true);
    expect(engine.state).toMatchObject({ phase: 'absent', error: null });
    e.docling.removeEngine.mockResolvedValueOnce({ ok: false, error: 'A file is in use.' });
    expect(await engine.remove()).toBe(false);
    expect(engine.state.error).toBe('A file is in use.');
  });
});

describe('reading one document', () => {
  it('asks the reader for it, the way asked, and says while it is under way', async () => {
    const e = fakeElectron({ status: 'available', installed: true, state: 'ready' });
    let finish: (r: { ok: boolean }) => void = () => {};
    e.docling.convert.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const changed: string[] = [];
    engine.onDidChangeReading((p) => changed.push(`${p} ${engine.isReading(p)}`));
    const read = engine.read('D:/Scans/Exam.pdf', true);
    expect(engine.isReading('d:/scans/exam.pdf')).toBe(true); // whatever the path's case
    await vi.waitFor(() => expect(e.docling.convert).toHaveBeenCalledWith('D:/Scans/Exam.pdf', { ocr: true }));
    finish({ ok: true });
    expect(await read).toEqual({ ok: true });
    expect(engine.isReading('D:/Scans/Exam.pdf')).toBe(false);
    expect(changed).toEqual(['D:/Scans/Exam.pdf true', 'D:/Scans/Exam.pdf false']);
  });

  it('a second ask for the same document the same way joins the first', async () => {
    const e = fakeElectron({ status: 'available', installed: true, state: 'ready' });
    let finish: (r: { ok: boolean }) => void = () => {};
    e.docling.convert.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const first = engine.read('D:/scans/exam.pdf', true, false);
    const second = engine.read('D:/Scans/exam.pdf', true);
    expect(second).toBe(first);
    finish({ ok: true });
    await first;
    expect(e.docling.convert).toHaveBeenCalledOnce();
    e.docling.convert.mockImplementation(async () => ({ ok: true }));
    await engine.read('D:/scans/exam.pdf', true, false);
    expect(e.docling.convert).toHaveBeenCalledTimes(2); // once the first is done, an ask reads again
  });

  it('starts a reader that is set up and not running, and waits for one that is starting', async () => {
    const e = fakeElectron({ installed: true, state: 'ready' });
    expect(await engine.read('D:/a.pdf', false)).toEqual({ ok: true });
    expect(e.docling.start).toHaveBeenCalledOnce();
    expect(e.docling.convert).toHaveBeenCalledWith('D:/a.pdf', { ocr: false });

    vi.useFakeTimers();
    const starting = fakeElectron({ status: 'starting', installed: true, state: 'ready' });
    const read = engine.read('D:/b.pdf', false);
    await vi.advanceTimersByTimeAsync(2_500);
    expect(starting.docling.convert).not.toHaveBeenCalled();
    starting.world.status = 'available';
    await vi.advanceTimersByTimeAsync(2_500);
    expect(await read).toEqual({ ok: true });
    expect(starting.docling.start).not.toHaveBeenCalled();
  });

  it('leaves a reader that is not running alone when told to start nothing', async () => {
    const e = fakeElectron({ status: 'available', installed: true, state: 'ready' });
    await engine.read('D:/a.pdf', true, false);
    expect(e.docling.status).not.toHaveBeenCalled();
    expect(e.docling.start).not.toHaveBeenCalled();
  });

  it('says so when there is no reader, and when the reader could not read it', async () => {
    const none = fakeElectron();
    expect(await engine.read('D:/a.pdf', false)).toEqual({ ok: false, error: 'The document reader is not set up, or did not start.' });
    expect(none.docling.convert).not.toHaveBeenCalled();
    const e = fakeElectron({ status: 'available', installed: true, state: 'ready' });
    e.docling.convert.mockResolvedValueOnce({ ok: false, error: 'The file is damaged.' });
    expect(await engine.read('D:/a.pdf', false)).toEqual({ ok: false, error: 'The file is damaged.' });
    e.docling.convert.mockRejectedValueOnce(new Error('The reader stopped.'));
    expect(await engine.read('D:/a.pdf', false)).toEqual({ ok: false, error: 'The reader stopped.' });
    delete (globalThis as { parallxElectron?: unknown }).parallxElectron;
    expect((await engine.read('D:/a.pdf', false)).ok).toBe(false);
  });
});
