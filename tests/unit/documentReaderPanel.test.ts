// @vitest-environment jsdom
// documentReaderPanel.test.ts — the document reader in Settings: where it
// stands, what it takes, and the buttons that set it up, stop, start and
// remove it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  actionsFor, createDocumentReaderPanel, documentReaderPanelShowing, registerDocumentReaderCommands, setUpNotice, sizeLabel, stateLabel, READER_COMMANDS,
} from '../../src/built-in/settings/documentReaderPanel';
import { DocumentReaderEngine, type IReaderEngineState } from '../../src/services/documentReaderEngine';
import { installKitCommands } from '../../src/ui/kitCommands';
import type { IDisposable } from '../../src/platform/lifecycle';

const GB = 1024 ** 3;
const state = (over: Partial<IReaderEngineState>): IReaderEngineState => ({ phase: 'absent', engine: null, bytesOnDisk: null, downloadBytes: 7 * GB, problems: [], step: null, error: null, ...over });

type Progress = { id?: string; kind?: string; step?: string; label?: string; fraction?: number; received?: number; total?: number };

/** The main process as the preload shows it, with a set-up that ends when `finishInstall` is called. */
function fakeElectron(o: { status?: string; installed?: boolean; state?: 'absent' | 'partial' | 'ready'; bytes?: number } = {}) {
  const world = { status: o.status ?? 'unavailable', installed: o.installed ?? false, state: o.state ?? 'absent' };
  let listener: ((p: Progress) => void) | null = null;
  let finishInstall: (r: { ok: boolean; stopped?: boolean; output?: string }) => void = () => {};
  const docling = {
    status: vi.fn(async () => ({ status: world.status, doclingInstalled: world.installed, engine: world.installed ? 'managed' : null })),
    engineStatus: vi.fn(async (withSize?: boolean) => ({ state: world.state, installing: false, bytesOnDisk: withSize && world.state !== 'absent' ? o.bytes ?? 8.1 * GB : null, downloadBytes: 4 * GB, packageBytes: 3 * GB, machine: { ok: true, problems: [] } })),
    start: vi.fn(async () => { world.status = 'available'; return { ok: true }; }),
    install: vi.fn(() => new Promise<{ ok: boolean; stopped?: boolean; output?: string }>((resolve) => {
      finishInstall = (r) => { if (r.ok) { world.state = 'ready'; world.installed = true; } else if (r.stopped) world.state = 'partial'; resolve(r); };
    })),
    cancelInstall: vi.fn(async () => true),
    removeEngine: vi.fn(async () => { world.state = 'absent'; world.installed = false; world.status = 'unavailable'; return { ok: true }; }),
  };
  (globalThis as { parallxElectron?: unknown }).parallxElectron = { docling, optionalBridges: { on: (_c: string, cb: (p: Progress) => void) => { listener = cb; return () => { listener = null; }; } } };
  return { docling, world, send: (p: Progress) => listener?.(p), finishInstall: (r: { ok: boolean; stopped?: boolean; output?: string }) => finishInstall(r) };
}

/** A command service: the panel's buttons run commands through the kit. */
function fakeCommands() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  installKitCommands({ executeCommand: async (id: string, ...args: unknown[]) => handlers.get(id)?.(...args) });
  return { registerCommand: (id: string, handler: (...args: unknown[]) => unknown): IDisposable => { handlers.set(id, handler); return { dispose: () => handlers.delete(id) }; }, handlers };
}

const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); };

let engine: DocumentReaderEngine;
let mounted: IDisposable[] = [];
function show() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const panel = createDocumentReaderPanel(engine).render(container) as IDisposable;
  mounted.push(panel);
  const facts = () => Object.fromEntries(Array.from(container.querySelectorAll('th')).map((th) => [th.textContent, th.nextElementSibling?.textContent]));
  const buttons = () => Array.from(container.querySelectorAll('button')).map((b) => b.textContent);
  const press = (label: string) => (Array.from(container.querySelectorAll('button')).find((b) => b.textContent === label) as HTMLButtonElement).click();
  return { container, panel, facts, buttons, press };
}

beforeEach(() => { engine = new DocumentReaderEngine(); });
afterEach(() => { for (const m of mounted) m.dispose(); mounted = []; delete (globalThis as { parallxElectron?: unknown }).parallxElectron; document.body.innerHTML = ''; });

describe('what it says', () => {
  it('names each state in plain words', () => {
    expect(stateLabel(state({ phase: 'absent' }))).toBe('Not set up');
    expect(stateLabel(state({ phase: 'partial' }))).toBe('Setting up stopped part of the way');
    expect(stateLabel(state({ phase: 'installing' }))).toBe('Setting up');
    expect(stateLabel(state({ phase: 'ready' }))).toBe('Set up, not running');
    expect(stateLabel(state({ phase: 'running', engine: 'managed' }))).toBe('Set up and running');
    expect(stateLabel(state({ phase: 'running', engine: 'system' }))).toMatch(/this computer's own Python/);
    expect(stateLabel(state({ phase: 'unsupported' }))).toBe('Cannot be set up on this computer');
  });

  it('gives what it takes on disk once measured, and what a set-up downloads before there is one', () => {
    expect(sizeLabel(state({ phase: 'running', engine: 'managed', bytesOnDisk: 8.1 * GB }))).toBe('8.1 GB on this computer');
    expect(sizeLabel(state({ phase: 'absent' }))).toBe('Downloads about 7.0 GB once, for every workspace');
    expect(sizeLabel(state({ phase: 'running', engine: 'managed' }))).toBeNull(); // not measured yet
    expect(sizeLabel(state({ phase: 'absent', downloadBytes: 0 }))).toBeNull();
  });

  it('offers what a state allows, the one to press first', () => {
    const labels = (s: Partial<IReaderEngineState>) => actionsFor(state(s)).map((a) => a.label);
    expect(labels({ phase: 'absent' })).toEqual(['Set Up']);
    expect(labels({ phase: 'partial' })).toEqual(['Carry On Setting Up', 'Remove…']);
    expect(labels({ phase: 'installing' })).toEqual(['Stop']);
    expect(labels({ phase: 'ready' })).toEqual(['Start', 'Remove…']);
    expect(labels({ phase: 'running', engine: 'managed' })).toEqual(['Remove…']);
    expect(labels({ phase: 'running', engine: 'system' })).toEqual(['Set Up']); // nothing of Parallx's own to remove
    expect(labels({ phase: 'unsupported' })).toEqual(['Check Again']);
    expect(labels({ phase: 'unknown' })).toEqual([]);
    expect(actionsFor(state({ phase: 'partial' })).every((a) => !!a.icon)).toBe(true);
  });

  it('tells how a set-up ended to someone who was not looking', () => {
    expect(setUpNotice({ ok: true, stopped: false })).toMatchObject({ kind: 'info' });
    expect(setUpNotice({ ok: false, stopped: true })).toMatchObject({ kind: 'info' });
    expect(setUpNotice({ ok: false, stopped: false, error: 'A file did not match.' })).toEqual({ kind: 'error', text: 'The document reader could not be set up. A file did not match.' });
  });
});

describe('the panel', () => {
  it('asks where the reader stands when it is shown, then how much room it takes', async () => {
    const e = fakeElectron({ status: 'available', installed: true, state: 'ready' });
    expect(e.docling.status).not.toHaveBeenCalled();
    const p = show();
    expect(p.facts().State).toBe('Checking…');
    await settle();
    expect(p.facts()).toMatchObject({ State: 'Set up and running', Size: '8.1 GB on this computer', 'Runs on': 'The processor. It takes no graphics memory.' });
    expect(p.buttons()).toEqual(['Remove…']);
    expect(documentReaderPanelShowing()).toBe(true);
    p.panel.dispose();
    mounted = [];
    expect(documentReaderPanelShowing()).toBe(false);
  });

  it('sets the reader up from its button, shows the progress in place, and keeps Stop the same button', async () => {
    const e = fakeElectron();
    const commands = fakeCommands();
    const subs = registerDocumentReaderCommands(commands, { confirmRemove: async () => true, notify: vi.fn() }, engine);
    const p = show();
    await settle();
    expect(p.facts()).toMatchObject({ State: 'Not set up', Size: 'Downloads about 7.0 GB once, for every workspace' });
    p.press('Set Up');
    await settle();
    expect(p.facts().State).toBe('Setting up');
    const stop = p.container.querySelector('button')!;
    expect(stop.textContent).toBe('Stop');
    const bar = p.container.querySelector('[role="progressbar"]')!;
    e.send({ id: 'docling', kind: 'install', step: 'files', label: 'Downloading layout.onnx', fraction: 0.6, received: 2 * GB, total: 4 * GB });
    expect(bar.getAttribute('aria-valuenow')).toBe('60');
    expect(p.container.textContent).toContain('Downloading layout.onnx');
    expect(p.container.textContent).toContain('2.0 GB of 4.0 GB');
    expect(p.container.querySelector('button')).toBe(stop); // not rebuilt under the pointer
    stop.focus();
    e.finishInstall({ ok: true });
    await settle();
    expect(p.facts().State).toBe('Set up and running');
    expect(p.buttons()).toEqual(['Remove…']);
    expect(document.activeElement).toBe(p.container.querySelector('button')); // the keyboard's place is kept
    for (const s of subs) s.dispose();
  });

  it('Stop asks the set-up to stop; what is done is kept and Carry On is offered', async () => {
    const e = fakeElectron();
    const commands = fakeCommands();
    registerDocumentReaderCommands(commands, { confirmRemove: async () => true, notify: vi.fn() }, engine);
    const p = show();
    await settle();
    p.press('Set Up');
    await settle();
    p.press('Stop');
    expect(e.docling.cancelInstall).toHaveBeenCalledOnce();
    e.finishInstall({ ok: false, stopped: true });
    await settle();
    expect(p.facts().State).toBe('Setting up stopped part of the way');
    expect(p.buttons()).toEqual(['Carry On Setting Up', 'Remove…']);
    expect(p.container.querySelector('[role="alert"]')).toBeNull(); // stopping is not an error
  });

  it('says what went wrong', async () => {
    const e = fakeElectron();
    const commands = fakeCommands();
    registerDocumentReaderCommands(commands, { confirmRemove: async () => true, notify: vi.fn() }, engine);
    const p = show();
    await settle();
    p.press('Set Up');
    await settle();
    e.finishInstall({ ok: false, output: 'A model file is not the one Parallx expects.' });
    await settle();
    expect(p.container.querySelector('[role="alert"]')!.textContent).toBe('A model file is not the one Parallx expects.');
    expect(p.buttons()).toEqual(['Set Up']);
  });

  it('removes the reader only after a yes, and says what removing means', async () => {
    const e = fakeElectron({ status: 'available', installed: true, state: 'ready' });
    const commands = fakeCommands();
    let answer = false;
    const confirmRemove = vi.fn(async (_detail: string) => answer);
    registerDocumentReaderCommands(commands, { confirmRemove, notify: vi.fn() }, engine);
    const p = show();
    await settle();
    p.press('Remove…');
    await settle();
    expect(confirmRemove.mock.calls[0][0]).toMatch(/It frees 8\.1 GB\./);
    expect(confirmRemove.mock.calls[0][0]).toMatch(/What it has already read is kept\./);
    expect(e.docling.removeEngine).not.toHaveBeenCalled();
    answer = true;
    p.press('Remove…');
    await settle();
    expect(e.docling.removeEngine).toHaveBeenCalledOnce();
    expect(p.facts().State).toBe('Not set up');
    expect(p.buttons()).toEqual(['Set Up']);
  });
});

describe('a set-up that ends when Settings is closed', () => {
  it('says so in one notice; with the panel on screen it says nothing more', async () => {
    const e = fakeElectron();
    const commands = fakeCommands();
    const notify = vi.fn();
    registerDocumentReaderCommands(commands, { confirmRemove: async () => true, notify }, engine);
    void commands.handlers.get(READER_COMMANDS.setUp)!();
    await settle();
    e.finishInstall({ ok: true });
    await settle();
    expect(notify).toHaveBeenCalledWith('info', expect.stringContaining('set up and running'));

    notify.mockClear();
    e.world.state = 'absent'; e.world.installed = false; e.world.status = 'unavailable';
    const p = show();
    await settle();
    p.press('Set Up');
    await settle();
    e.finishInstall({ ok: true });
    await settle();
    expect(notify).not.toHaveBeenCalled();
  });
});
