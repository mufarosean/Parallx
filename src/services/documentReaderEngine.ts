// documentReaderEngine.ts — the document reader as a thing on this computer.
//
// The reader (Docling, with its scan reader) runs in an engine Parallx sets
// up itself (electron/doclingRuntime.cjs): its own Python, its packages and
// its models, about 8 GB. This is the one place the app asks where that
// engine stands and changes it: set it up (or carry on a set-up that
// stopped), stop a set-up, start it, remove it, and have it read one
// document now. Settings shows it (built-in/settings/documentReaderPanel.ts);
// the PDF view's Reading side asks it for a document
// (editor/panes/pdf/pdfReadingPanel.ts).
//
// Nothing here runs until something asks: no status is fetched and nothing is
// listened for at launch.

import { Emitter, type Event } from '../platform/events.js';

export type ReaderPhase =
  | 'none'          // not the desktop app: there is no reader to speak of
  | 'unknown'       // not asked yet
  | 'absent'        // not set up
  | 'partial'       // a set-up stopped part of the way
  | 'installing'
  | 'ready'         // set up, not running
  | 'starting'
  | 'running'
  | 'unsupported';  // this computer cannot run it

/** Where a set-up is: what it is doing, and how far along. */
export interface IReaderStep { readonly label: string; readonly fraction: number; readonly received?: number; readonly total?: number }

export interface IReaderEngineState {
  readonly phase: ReaderPhase;
  /** Whose engine does the reading: Parallx's own, or a Docling in this computer's own Python. */
  readonly engine: 'managed' | 'system' | null;
  /** What Parallx's own engine takes on disk; null until it is measured. */
  readonly bytesOnDisk: number | null;
  /** What a set-up downloads: the models and the packages. */
  readonly downloadBytes: number;
  /** Why this computer cannot run it. */
  readonly problems: readonly string[];
  readonly step: IReaderStep | null;
  /** Why the last set-up, start or removal did not work. */
  readonly error: string | null;
}

/** How a set-up ended. */
export interface IReaderSetUpResult { readonly ok: boolean; readonly stopped: boolean; readonly error?: string }

/** What reading one document came to. */
export interface IReaderReadResult { readonly ok: boolean; readonly error?: string }

interface IReaderStatus { status?: string; doclingInstalled?: boolean; engine?: 'managed' | 'system' | null }
interface IEngineStatus {
  state?: 'absent' | 'partial' | 'ready';
  installing?: boolean;
  bytesOnDisk?: number | null;
  downloadBytes?: number;
  packageBytes?: number;
  machine?: { ok: boolean; problems?: string[] };
}
interface IReaderBridge {
  status(): Promise<IReaderStatus | null | undefined>;
  start(): Promise<{ ok?: boolean; error?: string } | null | undefined>;
  install(): Promise<{ ok?: boolean; output?: string; stopped?: boolean } | null | undefined>;
  engineStatus(withSize?: boolean): Promise<IEngineStatus | null | undefined>;
  cancelInstall(): Promise<unknown>;
  removeEngine(): Promise<{ ok?: boolean; error?: string } | null | undefined>;
  convert(filePath: string, options?: { ocr?: boolean }): Promise<{ ok?: boolean; error?: string } | null | undefined>;
}
interface IProgress { id?: string; kind?: string; step?: string; label?: string; fraction?: number; received?: number; total?: number }
type Electron = { docling?: Partial<IReaderBridge>; optionalBridges?: { on(channel: string, cb: (p: IProgress) => void): () => void } };

const electron = (): Electron | undefined => (globalThis as { parallxElectron?: Electron }).parallxElectron;

/** The reader's bridge as the preload exposes it. Any part may be missing (not the desktop app), so each use asks for what it needs. */
const bridge = (): Partial<IReaderBridge> | undefined => electron()?.docling;

/** The engine's id in electron/doclingRuntime.cjs: its progress events carry it. */
const ENGINE_ID = 'docling';
/** A reader still starting up (the app has just opened) is waited for this long. */
const START_WAIT_MS = 60_000;
const START_POLL_MS = 2_000;

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** Where the reader stands, from the two things the main process says about it. */
export function phaseOf(status: IReaderStatus | null | undefined, engine: IEngineStatus | null | undefined): ReaderPhase {
  if (!status || !engine) return 'none';
  if (engine.installing) return 'installing';
  if (status.status === 'available') return 'running';
  if (status.status === 'starting') return 'starting';
  if (engine.state === 'ready' || status.doclingInstalled) return 'ready';
  if (engine.machine && !engine.machine.ok) return 'unsupported';
  return engine.state === 'partial' ? 'partial' : 'absent';
}

const INITIAL: IReaderEngineState = { phase: 'unknown', engine: null, bytesOnDisk: null, downloadBytes: 0, problems: [], step: null, error: null };

export class DocumentReaderEngine {
  private _state: IReaderEngineState = INITIAL;
  private readonly _onDidChange = new Emitter<IReaderEngineState>();
  /** The state changed: a refresh, a step of a set-up, an action's end. */
  readonly onDidChange: Event<IReaderEngineState> = this._onDidChange.event;
  private readonly _onDidFinishSetUp = new Emitter<IReaderSetUpResult>();
  /** A set-up started here ended: done, stopped, or failed. */
  readonly onDidFinishSetUp: Event<IReaderSetUpResult> = this._onDidFinishSetUp.event;
  private readonly _onDidChangeReading = new Emitter<string>();
  /** A document started or stopped being read (the path, as it was asked for). */
  readonly onDidChangeReading: Event<string> = this._onDidChangeReading.event;

  private _progress: (() => void) | null = null;
  /** A set-up started here is running: the main process may not say so yet, or any more, for a moment. */
  private _settingUp = false;
  private readonly _reads = new Map<string, Promise<IReaderReadResult>>();

  get state(): IReaderEngineState { return this._state; }

  private _set(next: Partial<IReaderEngineState>): IReaderEngineState {
    this._state = { ...this._state, ...next };
    this._onDidChange.fire(this._state);
    return this._state;
  }

  /** Hear the set-up's steps for as long as one runs. */
  private _follow(): void {
    if (this._progress) return;
    try {
      this._progress = electron()?.optionalBridges?.on('runtimes:progress', (p) => {
        if (!p || p.id !== ENGINE_ID || p.kind !== 'install' || this._state.phase !== 'installing' || p.step === 'error') return;
        this._set({ step: { label: p.label || 'Working', fraction: p.fraction ?? 0, ...(p.total ? { received: p.received ?? 0, total: p.total } : {}) } });
      }) ?? null;
    } catch { this._progress = null; }
  }

  private _unfollow(): void {
    this._progress?.();
    this._progress = null;
  }

  /** Ask the main process where the reader stands. `withSize` measures what it takes on disk (slower). */
  async refresh(withSize = false): Promise<IReaderEngineState> {
    const api = bridge();
    if (!api?.status || !api.engineStatus) return this._set({ phase: 'none' });
    try {
      const [status, engine] = await Promise.all([api.status(), api.engineStatus(withSize)]);
      const phase = this._settingUp ? 'installing' : phaseOf(status, engine);
      if (phase === 'installing') this._follow(); else this._unfollow();
      return this._set({
        phase,
        engine: status?.engine ?? null,
        bytesOnDisk: withSize ? engine?.bytesOnDisk ?? null : this._state.bytesOnDisk,
        downloadBytes: (engine?.downloadBytes ?? 0) + (engine?.packageBytes ?? 0),
        problems: engine?.machine && !engine.machine.ok ? engine.machine.problems ?? [] : [],
        step: phase === 'installing' ? this._state.step ?? { label: 'Working', fraction: 0 } : null,
      });
    } catch (err) {
      return this._set({ error: messageOf(err) });
    }
  }

  /** Set the reader up, or carry on a set-up that stopped; then start it. */
  async setUp(): Promise<IReaderSetUpResult> {
    const api = bridge();
    if (!api?.install || !api.start) return { ok: false, stopped: false, error: 'The document reader needs the desktop app.' };
    if (this._state.phase === 'installing') return { ok: false, stopped: false, error: 'It is already being set up.' };
    this._settingUp = true;
    this._set({ phase: 'installing', step: { label: 'Checking this computer', fraction: 0 }, error: null });
    this._follow();
    let result: IReaderSetUpResult;
    try {
      const installed = await api.install();
      if (installed?.ok) {
        const started = await api.start().catch(() => null);
        result = started?.ok ? { ok: true, stopped: false } : { ok: false, stopped: false, error: 'The document reader is set up but did not start. Restart Parallx and try again.' };
      } else {
        result = { ok: false, stopped: installed?.stopped === true, ...(installed?.stopped ? {} : { error: installed?.output || 'The document reader could not be set up.' }) };
      }
    } catch (err) {
      result = { ok: false, stopped: false, error: messageOf(err) };
    }
    this._settingUp = false;
    this._unfollow();
    await this.refresh(true);
    this._set({ error: result.error ?? null });
    this._onDidFinishSetUp.fire(result);
    return result;
  }

  /** Stop a set-up. What is done is kept: setting up again carries on from there. */
  stopSetUp(): void {
    void Promise.resolve(bridge()?.cancelInstall?.()).catch(() => { /* nothing was running */ });
  }

  /** Start a reader that is set up and not running. */
  async start(): Promise<boolean> {
    const api = bridge();
    if (!api?.start) return false;
    this._set({ phase: 'starting', error: null });
    const started = await api.start().catch(() => null);
    await this.refresh();
    if (!started?.ok) this._set({ error: started?.error || 'The document reader did not start. Restart Parallx and try again.' });
    return started?.ok === true;
  }

  /** Remove Parallx's own engine from this computer. What it has read is kept. */
  async remove(): Promise<boolean> {
    const api = bridge();
    if (!api?.removeEngine) return false;
    this._set({ error: null });
    const removed = await api.removeEngine().catch((err) => ({ ok: false, error: messageOf(err) }));
    await this.refresh(true);
    if (!removed?.ok) this._set({ error: removed?.error || 'The document reader could not be removed.' });
    return removed?.ok === true;
  }

  /** Wait for a reader that is starting; start one that is set up and not running. False when there is none to wait for. */
  private async _running(api: Partial<IReaderBridge>): Promise<boolean> {
    if (!api.status) return false;
    const until = Date.now() + START_WAIT_MS;
    let asked = false;
    for (;;) {
      const status = await api.status().catch(() => null);
      if (status?.status === 'available') return true;
      if (status?.status !== 'starting') {
        // Set up and not running: start it once, then wait for it like any other start.
        if (asked || !status?.doclingInstalled || !api.start) return false;
        asked = true;
        if (!(await api.start().catch(() => null))?.ok) return false;
        continue;
      }
      if (Date.now() >= until) return false;
      await new Promise((resolve) => setTimeout(resolve, START_POLL_MS));
    }
  }

  /** Is this document being read now (by an ask made here)? */
  isReading(fsPath: string): boolean {
    const key = fsPath.toLowerCase();
    return this._reads.has(`${key}\n1`) || this._reads.has(`${key}\n0`);
  }

  /**
   * Have the reader read one document now, again when it has before. `ocr`
   * reads every page from its pixels (a scan); without it the document's own
   * text is read. The reading is kept by the main process as always. A second
   * ask for the same document the same way joins the first. `start` (the
   * default) starts a reader that is set up and not running; without it a
   * reader that is not already running or starting is left alone.
   */
  read(fsPath: string, ocr: boolean, start = true): Promise<IReaderReadResult> {
    const key = `${fsPath.toLowerCase()}\n${ocr ? 1 : 0}`;
    const flying = this._reads.get(key);
    if (flying) return flying;
    const flight = (async (): Promise<IReaderReadResult> => {
      const api = bridge();
      if (!api?.convert) return { ok: false, error: 'The document reader needs the desktop app.' };
      try {
        if (start && !(await this._running(api))) return { ok: false, error: 'The document reader is not set up, or did not start.' };
        const result = await api.convert(fsPath, { ocr });
        return result?.ok ? { ok: true } : { ok: false, error: result?.error || 'The document could not be read.' };
      } catch (err) {
        return { ok: false, error: messageOf(err) };
      }
    })();
    this._reads.set(key, flight);
    this._onDidChangeReading.fire(fsPath);
    void flight.then(() => {
      if (this._reads.get(key) === flight) this._reads.delete(key);
      this._onDidChangeReading.fire(fsPath);
    });
    return flight;
  }

  /** Forget everything (tests). */
  reset(): void {
    this._unfollow();
    this._settingUp = false;
    this._reads.clear();
    this._state = INITIAL;
  }
}

/** The one document reader engine of the app. */
export const documentReaderEngine = new DocumentReaderEngine();
