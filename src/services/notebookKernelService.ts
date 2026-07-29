// notebookKernelService.ts — renderer-side owner of the notebook kernel (M96)
//
// Same division as M94's pythonEnvService: the main process enforces what it
// can enforce (process lifecycle, containment, the rebuilt environment), and
// this layer owns consent and translation.
//
// Translation is the substantive part. Kernel events arrive as protocol
// messages — `stream`, `execute_input`, `execute_result`, `display_data`,
// `clear_output`, `error`, `reply` — and the notebook UI should never have to
// think in those terms. This service converts them into the SAME
// `NotebookOutput` shapes the .ipynb model uses, so what a cell displays after
// running and what it displays after being loaded from disk are the same
// objects, rendered by the same code. Any divergence there is a bug factory:
// outputs that look right until you save and reopen.

import { Disposable, DisposableStore, type IDisposable } from '../platform/lifecycle.js';
import { Emitter, type Event } from '../platform/events.js';
import { createServiceIdentifier } from '../platform/types.js';
import type { IActivityJournalService } from './activityJournalService.js';
import type { IPythonEnvService } from './pythonEnvService.js';
import type { NotebookOutput } from '../built-in/editor/notebook/notebookModel.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export type KernelState = 'not-started' | 'starting' | 'idle' | 'busy' | 'dead';

export interface IKernelStatus {
  readonly running: boolean;
  readonly state: KernelState;
  readonly pythonVersion: string | null;
  readonly startedAt: number | null;
}

export interface IKernelReadiness {
  /** An environment exists AND ipykernel is importable in it. */
  readonly ready: boolean;
  readonly reason: 'NO_ENV' | 'MISSING_IPYKERNEL' | 'PROBE_FAILED' | 'TIMEOUT' | null;
}

export interface IKernelExecutionResult {
  readonly status: 'ok' | 'error' | 'abort';
  /**
   * Wall-clock milliseconds the KERNEL spent on this cell — measured from
   * `execute_input` (the kernel picking the cell up) to the reply, so time
   * spent queued behind an earlier cell is excluded. "Run All" would otherwise
   * report the last cell as taking as long as the whole notebook.
   *
   * Null when the kernel never started the cell (aborted while queued).
   */
  readonly durationMs: number | null;
  /** ISO timestamps, for the `metadata.execution` block JupyterLab writes. */
  readonly startedAtIso: string | null;
  readonly endedAtIso: string | null;
}

/** A single in-flight execution. */
export interface IKernelExecution extends IDisposable {
  /** Fires when the kernel picks the cell up — the moment timing starts. */
  readonly onDidStart: Event<void>;
  /** Milliseconds since the kernel started this cell, or null if not started. */
  elapsedMs(): number | null;
  readonly requestId: string;
  /** One model-shaped output at a time, in kernel order. */
  readonly onDidOutput: Event<NotebookOutput>;
  /** The `[n]` prompt, available as soon as the kernel accepts the cell. */
  readonly onDidSetExecutionCount: Event<number>;
  /** `clear_output` — a cell redrawing itself (progress bars, animations). */
  readonly onDidClear: Event<{ wait: boolean }>;
  /** Settles when the kernel replies. Never rejects. */
  readonly completed: Promise<IKernelExecutionResult>;
}

export interface INotebookKernelService {
  readonly isAvailable: boolean;
  readonly onDidChangeStatus: Event<IKernelStatus>;
  /** A kernel-level failure the UI must surface (died, host crashed). */
  readonly onDidFail: Event<{ code: string; message: string }>;

  getStatus(): Promise<IKernelStatus>;
  checkReadiness(): Promise<IKernelReadiness>;
  /** Install ipykernel into the workspace environment. */
  installKernelDependencies(): Promise<{ ok: boolean; error?: string }>;
  start(): Promise<{ ok: boolean; error?: string }>;
  stop(): Promise<void>;
  restart(): Promise<{ ok: boolean; error?: string }>;
  interrupt(): Promise<void>;
  /** Queue code. Returns null when no kernel could be started. */
  execute(code: string): Promise<IKernelExecution | null>;
}

export const INotebookKernelService =
  createServiceIdentifier<INotebookKernelService>('INotebookKernelService');

// ─── Electron surface ────────────────────────────────────────────────────────

interface KernelEvent {
  type: string;
  requestId?: string | null;
  [key: string]: unknown;
}

interface NotebookElectronApi {
  status(workspaceRoot: string): Promise<Record<string, unknown>>;
  checkDeps(workspaceRoot: string): Promise<Record<string, unknown>>;
  start(workspaceRoot: string): Promise<Record<string, unknown>>;
  stop(workspaceRoot: string): Promise<Record<string, unknown>>;
  execute(workspaceRoot: string, requestId: string, code: string): Promise<Record<string, unknown>>;
  interrupt(workspaceRoot: string, requestId: string): Promise<Record<string, unknown>>;
  restart(workspaceRoot: string, requestId: string): Promise<Record<string, unknown>>;
  onEvent(cb: (payload: { workspaceRoot: string; event: KernelEvent }) => void): () => void;
}

function getKernelApi(): NotebookElectronApi | undefined {
  // See the matching guard in pythonEnvService: this service is constructed at
  // composition time and under the node-based unit suite, where a bare
  // `window` reference is a ReferenceError.
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { parallxElectron?: { notebookKernel?: NotebookElectronApi } })
    .parallxElectron?.notebookKernel;
}

/**
 * Compare two workspace roots that crossed the IPC boundary.
 *
 * These are the SAME directory expressed two ways, and a strict `!==` is
 * wrong. The renderer's value comes from `URI.fsPath`, which yields
 * `C:/work/ws` — forward slashes, because the URI path is stored that way. The
 * main process tags every event with `path.resolve()`, which on Windows yields
 * `C:\work\ws`. Comparing them literally is always false, which silently drops
 * every kernel event: cells run, produce output, and the UI never hears about
 * it, so they spin forever.
 *
 * Separators are normalised, trailing separators dropped, and case folded —
 * Windows paths are case-insensitive and `c:\work` and `C:\Work` are one
 * directory.
 */
function sameWorkspace(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  // Case-fold based on the SHAPE of the path (a drive letter means Windows,
  // where paths are case-insensitive) rather than on `navigator.platform`,
  // which is deprecated, absent under the node test runner, and answers a
  // question about the host rather than about these two strings.
  const isWindowsPath = /^[a-zA-Z]:[\\/]/.test(a) || /^[a-zA-Z]:[\\/]/.test(b);
  const norm = (p: string): string => {
    const unified = p.replace(/\\/g, '/').replace(/\/+$/, '');
    return isWindowsPath ? unified.toLowerCase() : unified;
  };
  return norm(a) === norm(b);
}

// ─── Execution handle ────────────────────────────────────────────────────────

class KernelExecution extends Disposable implements IKernelExecution {
  private readonly _onDidOutput = this._register(new Emitter<NotebookOutput>());
  readonly onDidOutput: Event<NotebookOutput> = this._onDidOutput.event;

  private readonly _onDidSetExecutionCount = this._register(new Emitter<number>());
  readonly onDidSetExecutionCount: Event<number> = this._onDidSetExecutionCount.event;

  private readonly _onDidClear = this._register(new Emitter<{ wait: boolean }>());
  readonly onDidClear: Event<{ wait: boolean }> = this._onDidClear.event;

  private readonly _onDidStart = this._register(new Emitter<void>());
  readonly onDidStart: Event<void> = this._onDidStart.event;

  readonly completed: Promise<IKernelExecutionResult>;
  private _settle!: (value: IKernelExecutionResult) => void;
  private _done = false;

  /** Set when `execute_input` arrives — the kernel actually starting work. */
  private _startedAt: number | null = null;
  private _endedAt: number | null = null;

  constructor(readonly requestId: string) {
    super();
    this.completed = new Promise((resolve) => { this._settle = resolve; });
  }

  elapsedMs(): number | null {
    if (this._startedAt === null) return null;
    return (this._endedAt ?? Date.now()) - this._startedAt;
  }

  /** Merge consecutive stream chunks rather than emitting one output per chunk.
   *  A loop printing 10,000 lines otherwise produces 10,000 outputs, each with
   *  its own DOM node, and both the notebook file and the pane fall over. */
  handleEvent(event: KernelEvent): void {
    if (this._done) return;

    switch (event.type) {
      case 'execute_input': {
        // The kernel has picked this cell up. Timing starts HERE, not when the
        // request was queued.
        if (this._startedAt === null) {
          this._startedAt = Date.now();
          this._onDidStart.fire();
        }
        const count = event['executionCount'];
        if (typeof count === 'number') this._onDidSetExecutionCount.fire(count);
        break;
      }
      case 'stream':
        this._onDidOutput.fire({
          outputType: 'stream',
          name: event['name'] === 'stderr' ? 'stderr' : 'stdout',
          text: typeof event['text'] === 'string' ? event['text'] : '',
        });
        break;
      case 'execute_result':
        this._onDidOutput.fire({
          outputType: 'execute_result',
          executionCount: typeof event['executionCount'] === 'number' ? event['executionCount'] : null,
          data: (event['data'] as Record<string, unknown>) ?? {},
          metadata: (event['metadata'] as Record<string, unknown>) ?? {},
        });
        break;
      case 'display_data':
        this._onDidOutput.fire({
          outputType: 'display_data',
          data: (event['data'] as Record<string, unknown>) ?? {},
          metadata: (event['metadata'] as Record<string, unknown>) ?? {},
        });
        break;
      case 'error':
        this._onDidOutput.fire({
          outputType: 'error',
          ename: typeof event['ename'] === 'string' ? event['ename'] : '',
          evalue: typeof event['evalue'] === 'string' ? event['evalue'] : '',
          traceback: Array.isArray(event['traceback']) ? event['traceback'].map(String) : [],
        });
        break;
      case 'clear_output':
        this._onDidClear.fire({ wait: event['wait'] === true });
        break;
      case 'reply':
        if (event['of'] === 'execute') {
          const status = event['status'];
          this.finish(status === 'error' ? 'error' : status === 'abort' ? 'abort' : 'ok');
        }
        break;
    }
  }

  /** Settle early — the kernel died, or the notebook closed mid-run. */
  finish(status: 'ok' | 'error' | 'abort'): void {
    if (this._done) return;
    this._done = true;
    this._endedAt = Date.now();
    this._settle({
      status,
      durationMs: this._startedAt === null ? null : this._endedAt - this._startedAt,
      startedAtIso: this._startedAt === null ? null : new Date(this._startedAt).toISOString(),
      endedAtIso: this._startedAt === null ? null : new Date(this._endedAt).toISOString(),
    });
  }

  override dispose(): void {
    this.finish('abort');
    super.dispose();
  }
}

// ─── Service ─────────────────────────────────────────────────────────────────

let _requestCounter = 0;

export class NotebookKernelService extends Disposable implements INotebookKernelService {
  private _workspaceRoot: string | null = null;
  private _journal: IActivityJournalService | undefined;
  private _python: IPythonEnvService | undefined;
  private _state: KernelState = 'not-started';
  private _pythonVersion: string | null = null;
  private _startedAt: number | null = null;

  private readonly _executions = new Map<string, KernelExecution>();
  private readonly _listeners = new DisposableStore();

  private readonly _onDidChangeStatus = this._register(new Emitter<IKernelStatus>());
  readonly onDidChangeStatus: Event<IKernelStatus> = this._onDidChangeStatus.event;

  private readonly _onDidFail = this._register(new Emitter<{ code: string; message: string }>());
  readonly onDidFail: Event<{ code: string; message: string }> = this._onDidFail.event;

  private _unsubscribe: (() => void) | undefined;

  constructor() {
    super();
    const api = getKernelApi();
    if (api) this._unsubscribe = api.onEvent((payload) => this._handleEvent(payload));
  }

  // ── Wiring ──

  setWorkspaceRoot(root: string | null): void {
    if (this._workspaceRoot === root) return;
    // The old kernel belongs to the old workspace; the main process kills it
    // on switch, so in-flight executions here must be released or their
    // promises never settle and the cells stay spinning forever.
    this._abortAll('abort');
    this._workspaceRoot = root;
    this._state = 'not-started';
    this._pythonVersion = null;
    this._startedAt = null;
    this._fireStatus();
  }

  attachJournal(journal: IActivityJournalService): void { this._journal = journal; }
  attachPython(python: IPythonEnvService): void { this._python = python; }

  get isAvailable(): boolean { return !!getKernelApi(); }

  private _fireStatus(): void {
    this._onDidChangeStatus.fire({
      running: this._state !== 'not-started' && this._state !== 'dead',
      state: this._state,
      pythonVersion: this._pythonVersion,
      startedAt: this._startedAt,
    });
  }

  private _note(verb: string, object: string, detail?: string): void {
    this._journal?.note({ actor: 'user', verb, object, detail, source: 'notebook' });
  }

  private _guard(): { ok: true; root: string; api: NotebookElectronApi } | { ok: false; error: string } {
    const api = getKernelApi();
    if (!api) return { ok: false, error: 'Notebooks are only available in the desktop app.' };
    if (!this._workspaceRoot) return { ok: false, error: 'Open a workspace folder first.' };
    // Running a notebook is running arbitrary code, so it sits behind the same
    // per-workspace consent as every other Python action rather than a second,
    // weaker gate of its own.
    if (this._python && !this._python.isEnabled) {
      return { ok: false, error: 'Python is off for this workspace. Turn it on in Settings › Python.' };
    }
    return { ok: true, root: this._workspaceRoot, api };
  }

  // ── Event routing ──

  private _handleEvent(payload: { workspaceRoot: string; event: KernelEvent }): void {
    // Events are workspace-tagged: a kernel from a workspace we have since
    // left must not drive this one's UI. Compared through sameWorkspace, not
    // `!==` — see the note there; the two sides use different separators.
    if (!sameWorkspace(payload.workspaceRoot, this._workspaceRoot)) return;
    const event = payload.event;

    if (event.type === 'status') {
      const state = event['state'];
      if (state === 'busy' || state === 'idle') {
        this._state = state;
        this._fireStatus();
      }
      return;
    }

    if (event.type === 'fatal') {
      this._state = 'dead';
      this._fireStatus();
      this._abortAll('abort');
      this._onDidFail.fire({
        code: String(event['code'] ?? 'FATAL'),
        message: String(event['message'] ?? 'The kernel stopped.'),
      });
      return;
    }

    const requestId = typeof event.requestId === 'string' ? event.requestId : null;
    if (!requestId) return;
    const execution = this._executions.get(requestId);
    if (!execution) return;

    execution.handleEvent(event);
    if (event.type === 'reply' && event['of'] === 'execute') {
      this._executions.delete(requestId);
    }
  }

  private _abortAll(status: 'ok' | 'error' | 'abort'): void {
    for (const execution of this._executions.values()) execution.finish(status);
    this._executions.clear();
  }

  // ── Status ──

  async getStatus(): Promise<IKernelStatus> {
    const api = getKernelApi();
    const empty: IKernelStatus = { running: false, state: 'not-started', pythonVersion: null, startedAt: null };
    if (!api || !this._workspaceRoot) return empty;
    try {
      const res = await api.status(this._workspaceRoot) as {
        running?: boolean; state?: string; pythonVersion?: string | null; startedAt?: number | null;
      };
      // Trust the main process, which owns the process, over local state.
      this._state = (res.state as KernelState) ?? 'not-started';
      this._pythonVersion = res.pythonVersion ?? null;
      this._startedAt = res.startedAt ?? null;
      return {
        running: !!res.running,
        state: this._state,
        pythonVersion: this._pythonVersion,
        startedAt: this._startedAt,
      };
    } catch {
      return empty;
    }
  }

  async checkReadiness(): Promise<IKernelReadiness> {
    const api = getKernelApi();
    if (!api || !this._workspaceRoot) return { ready: false, reason: 'NO_ENV' };
    try {
      const res = await api.checkDeps(this._workspaceRoot) as { ready?: boolean; reason?: string | null };
      return { ready: !!res.ready, reason: (res.reason as IKernelReadiness['reason']) ?? null };
    } catch {
      return { ready: false, reason: 'PROBE_FAILED' };
    }
  }

  async installKernelDependencies(): Promise<{ ok: boolean; error?: string }> {
    if (!this._python) return { ok: false, error: 'Python support is unavailable.' };
    // ipykernel pulls jupyter_client, pyzmq, traitlets and friends — one
    // install, contained in the workspace venv by M94.
    const res = await this._python.installPackages(['ipykernel']);
    if (res.ok) this._note('installed', 'ipykernel', 'notebook kernel support');
    return { ok: res.ok, error: res.error };
  }

  // ── Lifecycle ──

  async start(): Promise<{ ok: boolean; error?: string }> {
    const g = this._guard();
    if (!g.ok) return { ok: false, error: g.error };

    this._state = 'starting';
    this._fireStatus();

    const res = await g.api.start(g.root) as
      { ok?: boolean; error?: string; pythonVersion?: string | null; alreadyRunning?: boolean };

    if (!res.ok) {
      this._state = 'dead';
      this._fireStatus();
      return { ok: false, error: res.error ?? 'The kernel could not be started.' };
    }

    this._state = 'idle';
    this._pythonVersion = res.pythonVersion ?? null;
    this._startedAt = Date.now();
    this._fireStatus();
    if (!res.alreadyRunning) {
      this._note('started', 'notebook kernel', `python ${this._pythonVersion ?? '?'}`);
    }
    return { ok: true };
  }

  async stop(): Promise<void> {
    const api = getKernelApi();
    if (!api || !this._workspaceRoot) return;
    this._abortAll('abort');
    await api.stop(this._workspaceRoot);
    this._state = 'not-started';
    this._startedAt = null;
    this._fireStatus();
    this._note('stopped', 'notebook kernel');
  }

  async restart(): Promise<{ ok: boolean; error?: string }> {
    const g = this._guard();
    if (!g.ok) return { ok: false, error: g.error };
    if (this._state === 'not-started' || this._state === 'dead') return this.start();

    // Everything queued belongs to the interpreter that is about to be
    // discarded.
    this._abortAll('abort');
    const res = await g.api.restart(g.root, `restart-${++_requestCounter}`) as { ok?: boolean; error?: string };
    if (!res.ok) return { ok: false, error: res.error ?? 'Restart failed.' };
    this._state = 'idle';
    this._fireStatus();
    this._note('restarted', 'notebook kernel');
    return { ok: true };
  }

  async interrupt(): Promise<void> {
    const g = this._guard();
    if (!g.ok) return;
    await g.api.interrupt(g.root, `interrupt-${++_requestCounter}`);
  }

  // ── Execution ──

  async execute(code: string): Promise<IKernelExecution | null> {
    const g = this._guard();
    if (!g.ok) return null;

    if (this._state === 'not-started' || this._state === 'dead') {
      const started = await this.start();
      if (!started.ok) return null;
    }

    const requestId = `nb-${++_requestCounter}`;
    const execution = new KernelExecution(requestId);
    // Registered BEFORE the IPC call: the kernel can begin emitting output
    // before `execute` resolves, and an unregistered request drops its first
    // events on the floor.
    this._executions.set(requestId, execution);

    const res = await g.api.execute(g.root, requestId, code) as { ok?: boolean; error?: string };
    if (!res.ok) {
      this._executions.delete(requestId);
      execution.handleEvent({
        type: 'error', requestId,
        ename: 'KernelError', evalue: res.error ?? 'Could not reach the kernel.', traceback: [],
      });
      execution.finish('error');
    }
    return execution;
  }

  override dispose(): void {
    this._abortAll('abort');
    this._listeners.dispose();
    this._unsubscribe?.();
    super.dispose();
  }
}
