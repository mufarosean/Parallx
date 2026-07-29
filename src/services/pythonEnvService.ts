// pythonEnvService.ts — the renderer-side owner of the per-workspace Python
// runtime (M94).
//
// Division of responsibility with electron/pythonBridge.cjs:
//
//   main process  → containment. Path validation, package-specifier
//                   validation, the rebuilt child environment, process
//                   limits, teardown. Enforces what it can actually enforce.
//
//   this service  → consent and accountability. Nothing runs unless the
//                   workspace has opted in, and every environment mutation
//                   and every script run lands in the activity journal.
//
// The gate is per-workspace and defaults to OFF. That is deliberate: enabling
// it means "this workspace may execute arbitrary code with my user account's
// permissions", which is a bigger decision than any other workspace setting,
// and it should never be inherited silently by a workspace the user opened to
// read a PDF.

import { Disposable } from '../platform/lifecycle.js';
import { Emitter, type Event } from '../platform/events.js';
import { createServiceIdentifier } from '../platform/types.js';
import type { IActivityJournalService } from './activityJournalService.js';
import { getGlobalSettingsRegistry } from './settingsRegistryService.js';

// ── Setting keys ────────────────────────────────────────────────────────────

/** Master consent gate. Workspace-scoped, default false. */
export const PYTHON_ENABLED_KEY = 'python.enabled';
/** Where runnable scripts live, workspace-relative. */
export const PYTHON_SCRIPTS_DIR_KEY = 'python.scriptsDir';
/** Where script output lands, workspace-relative. */
export const PYTHON_OUTPUT_DIR_KEY = 'python.outputDir';
/** Wall-clock ceiling for one run. */
export const PYTHON_RUN_TIMEOUT_KEY = 'python.runTimeoutMs';

// ── Types ───────────────────────────────────────────────────────────────────

export interface IPythonStatus {
  readonly interpreterFound: boolean;
  readonly interpreterVersion: string | null;
  readonly envExists: boolean;
  readonly envPath: string | null;
  readonly envPython?: string | null;
  readonly createdAt: string | null;
  readonly createdWith: string | null;
  readonly activeRuns?: number;
}

export interface IPythonPackage {
  readonly name: string;
  readonly version: string;
}

export interface IPythonRunHandle {
  readonly runId: string;
  readonly scriptPath: string;
  readonly outDir: string;
}

export interface IPythonRunChunk {
  readonly runId: string;
  readonly channel: 'stdout' | 'stderr';
  readonly chunk: string;
}

export interface IPythonRunExit {
  readonly runId: string;
  readonly exitCode: number;
  readonly error: { readonly code: string; readonly message: string } | null;
  readonly durationMs: number;
  readonly outDir?: string;
}

/** A completed or in-flight run, kept for the Settings panel's run log. */
export interface IPythonRunRecord {
  readonly runId: string;
  readonly scriptPath: string;
  readonly startedAt: number;
  output: string;
  exitCode: number | null;
  durationMs: number | null;
  error: string | null;
}

/** Live output from a long-running environment operation. */
export interface IPythonProgress {
  readonly phase: 'create' | 'install' | 'uninstall';
  readonly channel: 'stdout' | 'stderr';
  readonly chunk: string;
}

export interface IPythonEnvService {
  /** Whether this workspace has opted in. */
  readonly isEnabled: boolean;
  /**
   * Streams output while an environment is created or packages installed.
   * Without this the UI can only show a spinner for a 30-second operation,
   * which is indistinguishable from a hang.
   */
  readonly onDidProgress: Event<IPythonProgress>;
  /** False when running outside Electron. */
  readonly isAvailable: boolean;
  readonly onDidChangeStatus: Event<void>;
  readonly onDidRunData: Event<IPythonRunChunk>;
  readonly onDidRunExit: Event<IPythonRunExit>;

  setEnabled(enabled: boolean): Promise<void>;
  getStatus(): Promise<IPythonStatus>;
  getEnvSize(): Promise<{ sizeBytes: number; fileCount: number }>;
  createEnv(): Promise<{ ok: boolean; error?: string }>;
  removeEnv(): Promise<{ ok: boolean; error?: string }>;
  listPackages(): Promise<readonly IPythonPackage[]>;
  installPackages(specs: readonly string[]): Promise<{ ok: boolean; output?: string; error?: string }>;
  uninstallPackages(specs: readonly string[]): Promise<{ ok: boolean; output?: string; error?: string }>;
  runScript(scriptPath: string, args?: readonly string[]): Promise<{ ok: boolean; handle?: IPythonRunHandle; error?: string }>;
  cancelRun(runId: string): Promise<void>;
  /** Formatters importable in this workspace's environment (`black`, `ruff`). */
  availableFormatters(): Promise<readonly string[]>;
  /** Format Python source with whichever formatter is installed. */
  formatPython(source: string): Promise<{ ok: boolean; formatted?: string; error?: string }>;
  /** Recent runs, newest first. */
  recentRuns(): readonly IPythonRunRecord[];
  /** Workspace-relative directories the user has configured. */
  readonly scriptsDir: string;
  readonly outputDir: string;
  /**
   * Register the `python.*` schemas if a settings registry now exists.
   * Idempotent. Needed because this service is constructed before the global
   * registry is created — see the implementation for the full story.
   */
  ensureSettingsRegistered(): void;
}

export const IPythonEnvService = createServiceIdentifier<IPythonEnvService>('IPythonEnvService');

// ── Electron surface ────────────────────────────────────────────────────────

interface PythonElectronApi {
  status(workspaceRoot: string): Promise<Record<string, unknown>>;
  envSize(workspaceRoot: string): Promise<Record<string, unknown>>;
  createEnv(workspaceRoot: string): Promise<Record<string, unknown>>;
  removeEnv(workspaceRoot: string): Promise<Record<string, unknown>>;
  install(workspaceRoot: string, packages: readonly string[]): Promise<Record<string, unknown>>;
  uninstall(workspaceRoot: string, packages: readonly string[]): Promise<Record<string, unknown>>;
  listPackages(workspaceRoot: string): Promise<Record<string, unknown>>;
  runScript(payload: Record<string, unknown>): Promise<Record<string, unknown>>;
  cancelRun(runId: string): Promise<Record<string, unknown>>;
  detectFormatters(workspaceRoot: string): Promise<Record<string, unknown>>;
  format(workspaceRoot: string, source: string, tool: string): Promise<Record<string, unknown>>;
  onRunData(cb: (p: IPythonRunChunk) => void): () => void;
  onRunExit(cb: (p: IPythonRunExit) => void): () => void;
  onProgress(cb: (p: { workspaceRoot: string | null; phase: string; channel: string; chunk: string }) => void): () => void;
}

function getPythonApi(): PythonElectronApi | undefined {
  // `typeof window` guard, not just optional chaining: this service is
  // constructed at workbench composition time and is also loaded by the unit
  // suite, which runs under plain node. A bare `window` reference is a
  // ReferenceError there, and a service that cannot be constructed outside a
  // browser cannot be tested at all.
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { parallxElectron?: { python?: PythonElectronApi } })
    .parallxElectron?.python;
}

/**
 * Compare two paths that crossed the IPC boundary. The renderer's workspace
 * root comes from `URI.fsPath` (`C:/work/ws`); the main process tags events
 * with `path.resolve` (`C:\work\ws`). A strict `!==` silently drops
 * everything — the same trap the notebook service hit.
 */
function samePath(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const isWindows = /^[a-zA-Z]:[\\/]/.test(a) || /^[a-zA-Z]:[\\/]/.test(b);
  const norm = (p: string): string => {
    const unified = p.replace(/\\/g, '/').replace(/\/+$/, '');
    return isWindows ? unified.toLowerCase() : unified;
  };
  return norm(a) === norm(b);
}

const MAX_RUN_RECORDS = 25;
const MAX_RECORD_OUTPUT = 100_000;

// ── Service ─────────────────────────────────────────────────────────────────

export class PythonEnvService extends Disposable implements IPythonEnvService {
  private _workspaceRoot: string | null = null;
  private _journal: IActivityJournalService | undefined;
  private readonly _runs: IPythonRunRecord[] = [];

  private readonly _onDidChangeStatus = this._register(new Emitter<void>());
  readonly onDidChangeStatus: Event<void> = this._onDidChangeStatus.event;

  private readonly _onDidProgress = this._register(new Emitter<IPythonProgress>());
  readonly onDidProgress: Event<IPythonProgress> = this._onDidProgress.event;

  private readonly _onDidRunData = this._register(new Emitter<IPythonRunChunk>());
  readonly onDidRunData: Event<IPythonRunChunk> = this._onDidRunData.event;

  private readonly _onDidRunExit = this._register(new Emitter<IPythonRunExit>());
  readonly onDidRunExit: Event<IPythonRunExit> = this._onDidRunExit.event;

  private _unsubData: (() => void) | undefined;
  private _unsubExit: (() => void) | undefined;
  private _unsubProgress: (() => void) | undefined;

  constructor() {
    super();
    this._registerSettings();

    const api = getPythonApi();
    if (api) {
      this._unsubData = api.onRunData((p) => this._handleRunData(p));
      this._unsubExit = api.onRunExit((p) => this._handleRunExit(p));
      this._unsubProgress = api.onProgress?.((p) => {
        // Progress is workspace-tagged; a lingering install from a workspace
        // we have left must not paint into this one's UI. Compared through a
        // path normaliser because the renderer's root uses forward slashes and
        // the main process resolves to backslashes on Windows.
        if (p.workspaceRoot && !samePath(p.workspaceRoot, this._workspaceRoot)) return;
        this._onDidProgress.fire({
          phase: (p.phase as IPythonProgress['phase']) ?? 'install',
          channel: p.channel === 'stderr' ? 'stderr' : 'stdout',
          chunk: String(p.chunk ?? ''),
        });
      });
    }
  }

  // ── Wiring (called from the workbench once the workspace is known) ──

  /** Point the service at a workspace. Passing null parks it. */
  setWorkspaceRoot(root: string | null): void {
    if (this._workspaceRoot === root) return;
    this._workspaceRoot = root;
    // Runs belong to the workspace that started them; the main process kills
    // them on switch, so the local log starts clean too.
    this._runs.length = 0;
    this._onDidChangeStatus.fire();
  }

  attachJournal(journal: IActivityJournalService): void {
    this._journal = journal;
  }

  // ── Settings ──

  /**
   * Register the `python.*` schemas, retrying until the registry exists.
   *
   * This service is constructed in `registerWorkbenchServices` (workbench.ts),
   * which runs long BEFORE `setGlobalSettingsRegistry` is called during chat
   * tool activation. Registering only in the constructor therefore registered
   * nothing at all: the settings never appeared, and — because
   * `SettingsRegistryService.getValue` THROWS on an unregistered key rather
   * than returning a default — the first read blew up inside the Settings
   * panel constructor, leaving the panel rendering its heading and nothing
   * else.
   *
   * Idempotent (each key is guarded by `getSchema`), so every public entry
   * point can call it and the first one after boot wins. Built-in tools like
   * canvas avoid this by registering from their own activation, which happens
   * after the registry exists; a service constructed at composition time
   * cannot rely on that.
   */
  ensureSettingsRegistered(): void {
    this._registerSettings();
  }

  private _registerSettings(): void {
    const registry = getGlobalSettingsRegistry();
    if (!registry) return;

    if (!registry.getSchema(PYTHON_ENABLED_KEY)) {
      registry.register({
        key: PYTHON_ENABLED_KEY,
        type: 'boolean',
        default: false,
        scope: 'workspace',
        label: 'Enable Python for this workspace',
        description:
          'Lets this workspace create a private Python environment and run scripts. ' +
          'Packages, caches, and temp files stay inside the workspace — but a running ' +
          'script has the same access to your computer as any other program you launch. ' +
          'Off by default, and set per workspace.',
        category: 'Python',
      });
    }
    if (!registry.getSchema(PYTHON_SCRIPTS_DIR_KEY)) {
      registry.register({
        key: PYTHON_SCRIPTS_DIR_KEY,
        type: 'string',
        default: 'scripts',
        scope: 'workspace',
        label: 'Scripts folder',
        description:
          'Workspace-relative folder holding runnable .py files. Ordinary workspace ' +
          'content: watched, indexed, and readable by the assistant.',
        category: 'Python',
      });
    }
    if (!registry.getSchema(PYTHON_OUTPUT_DIR_KEY)) {
      registry.register({
        key: PYTHON_OUTPUT_DIR_KEY,
        type: 'string',
        default: 'output',
        scope: 'workspace',
        label: 'Output folder',
        description:
          'Workspace-relative folder a script writes results into (exposed to the ' +
          'script as PARALLX_OUT). Also ordinary workspace content.',
        category: 'Python',
      });
    }
    if (!registry.getSchema(PYTHON_RUN_TIMEOUT_KEY)) {
      registry.register({
        key: PYTHON_RUN_TIMEOUT_KEY,
        type: 'number',
        default: 120_000,
        min: 1_000,
        max: 900_000,
        scope: 'workspace',
        label: 'Script timeout (ms)',
        description: 'A run exceeding this is stopped, along with any child processes it started.',
        category: 'Python',
      });
    }
  }

  private _setting<T>(key: string, fallback: T): T {
    // Late registration: the registry may only have appeared after this
    // service was constructed.
    this._registerSettings();
    const registry = getGlobalSettingsRegistry();
    if (!registry) return fallback;
    // getValue THROWS for an unregistered key. A settings read must never be
    // able to take down its caller — this one is reached from the Settings
    // panel constructor, where a throw renders an empty pane with no
    // indication of why.
    if (!registry.getSchema(key)) return fallback;
    const value = registry.getValue(key);
    return (value === undefined || value === null ? fallback : value) as T;
  }

  get isEnabled(): boolean {
    return this._setting<boolean>(PYTHON_ENABLED_KEY, false) === true;
  }

  get isAvailable(): boolean {
    return !!getPythonApi();
  }

  get scriptsDir(): string {
    return this._setting<string>(PYTHON_SCRIPTS_DIR_KEY, 'scripts');
  }

  get outputDir(): string {
    return this._setting<string>(PYTHON_OUTPUT_DIR_KEY, 'output');
  }

  async setEnabled(enabled: boolean): Promise<void> {
    this._registerSettings();
    const registry = getGlobalSettingsRegistry();
    if (!registry || !registry.getSchema(PYTHON_ENABLED_KEY)) return;
    await registry.setValue(PYTHON_ENABLED_KEY, enabled, 'workspace');
    this._note(
      enabled ? 'enabled' : 'disabled',
      'Python for this workspace',
      enabled ? 'scripts may now run with your account’s permissions' : undefined,
      'user',
    );
    this._onDidChangeStatus.fire();
  }

  // ── Guards ──

  /**
   * Every operation funnels through here. Two failure modes are deliberately
   * distinct: "no workspace / not in Electron" is a capability problem, while
   * "not enabled" is a consent problem the user can resolve in Settings, and
   * the message says so rather than failing opaquely.
   */
  private _guard(): { ok: true; root: string; api: PythonElectronApi } | { ok: false; error: string } {
    const api = getPythonApi();
    if (!api) return { ok: false, error: 'Python is only available in the desktop app.' };
    if (!this._workspaceRoot) return { ok: false, error: 'Open a workspace folder first.' };
    if (!this.isEnabled) {
      return {
        ok: false,
        error: 'Python is off for this workspace. Turn it on in Settings › Python.',
      };
    }
    return { ok: true, root: this._workspaceRoot, api };
  }

  private _note(verb: string, object: string, detail?: string, actor: 'user' | 'system' | 'ai' = 'system'): void {
    this._journal?.note({ actor, verb, object, detail, source: 'python' });
  }

  // ── Status ──

  async getStatus(): Promise<IPythonStatus> {
    const empty: IPythonStatus = {
      interpreterFound: false,
      interpreterVersion: null,
      envExists: false,
      envPath: null,
      createdAt: null,
      createdWith: null,
    };
    const api = getPythonApi();
    if (!api || !this._workspaceRoot) return empty;
    // Status is a read-only stat of the filesystem, so it is NOT gated on
    // consent — the Settings panel has to be able to say "there is an
    // environment here, 340 MB, created in March" while Python is switched
    // off, otherwise turning it off would hide the thing you want to delete.
    try {
      const res = await api.status(this._workspaceRoot);
      return { ...empty, ...(res as unknown as IPythonStatus) };
    } catch {
      return empty;
    }
  }

  async getEnvSize(): Promise<{ sizeBytes: number; fileCount: number }> {
    const api = getPythonApi();
    if (!api || !this._workspaceRoot) return { sizeBytes: 0, fileCount: 0 };
    try {
      const res = await api.envSize(this._workspaceRoot) as { sizeBytes?: number; fileCount?: number };
      return { sizeBytes: res.sizeBytes ?? 0, fileCount: res.fileCount ?? 0 };
    } catch {
      return { sizeBytes: 0, fileCount: 0 };
    }
  }

  // ── Lifecycle ──

  async createEnv(): Promise<{ ok: boolean; error?: string }> {
    const g = this._guard();
    if (!g.ok) return { ok: false, error: g.error };

    const res = await g.api.createEnv(g.root) as { ok?: boolean; error?: string; alreadyExists?: boolean; interpreterVersion?: string };
    if (res.ok) {
      if (!res.alreadyExists) {
        this._note('created', 'Python environment', `python ${res.interpreterVersion ?? '?'} · .parallx/venv`, 'user');
      }
      this._onDidChangeStatus.fire();
      return { ok: true };
    }
    this._note('failed to create', 'Python environment', res.error);
    return { ok: false, error: res.error ?? 'Could not create the environment.' };
  }

  async removeEnv(): Promise<{ ok: boolean; error?: string }> {
    const api = getPythonApi();
    if (!api || !this._workspaceRoot) return { ok: false, error: 'No workspace.' };
    // Deletion is allowed while disabled — see getStatus. Reclaiming disk
    // should not require re-granting consent first.
    const res = await api.removeEnv(this._workspaceRoot) as { ok?: boolean; error?: string; removed?: boolean };
    if (res.ok) {
      if (res.removed) this._note('deleted', 'Python environment', undefined, 'user');
      this._onDidChangeStatus.fire();
      return { ok: true };
    }
    return { ok: false, error: res.error ?? 'Could not remove the environment.' };
  }

  // ── Packages ──

  async listPackages(): Promise<readonly IPythonPackage[]> {
    const api = getPythonApi();
    if (!api || !this._workspaceRoot) return [];
    try {
      const res = await api.listPackages(this._workspaceRoot) as { packages?: IPythonPackage[] };
      return res.packages ?? [];
    } catch {
      return [];
    }
  }

  async installPackages(specs: readonly string[]): Promise<{ ok: boolean; output?: string; error?: string }> {
    const g = this._guard();
    if (!g.ok) return { ok: false, error: g.error };

    const res = await g.api.install(g.root, specs) as { ok?: boolean; output?: string; error?: string; packages?: string[] };
    const label = (res.packages ?? specs).join(', ');
    if (res.ok) {
      this._note('installed', `Python packages: ${label}`, undefined, 'user');
      this._onDidChangeStatus.fire();
      return { ok: true, output: res.output };
    }
    this._note('failed to install', `Python packages: ${label}`, res.error);
    return { ok: false, output: res.output, error: res.error ?? 'Install failed.' };
  }

  async uninstallPackages(specs: readonly string[]): Promise<{ ok: boolean; output?: string; error?: string }> {
    const g = this._guard();
    if (!g.ok) return { ok: false, error: g.error };

    const res = await g.api.uninstall(g.root, specs) as { ok?: boolean; output?: string; error?: string };
    if (res.ok) {
      this._note('removed', `Python packages: ${specs.join(', ')}`, undefined, 'user');
      this._onDidChangeStatus.fire();
      return { ok: true, output: res.output };
    }
    return { ok: false, output: res.output, error: res.error ?? 'Uninstall failed.' };
  }

  // ── Running ──

  async runScript(
    scriptPath: string,
    args: readonly string[] = [],
  ): Promise<{ ok: boolean; handle?: IPythonRunHandle; error?: string }> {
    const g = this._guard();
    if (!g.ok) return { ok: false, error: g.error };

    const res = await g.api.runScript({
      workspaceRoot: g.root,
      scriptPath,
      args,
      timeout: this._setting<number>(PYTHON_RUN_TIMEOUT_KEY, 120_000),
      outDir: this.outputDir,
    }) as { ok?: boolean; runId?: string; scriptPath?: string; outDir?: string; error?: string };

    if (!res.ok || !res.runId) {
      this._note('failed to run', `Python script ${scriptPath}`, res.error);
      return { ok: false, error: res.error ?? 'Could not start the script.' };
    }

    this._runs.unshift({
      runId: res.runId,
      scriptPath: res.scriptPath ?? scriptPath,
      startedAt: Date.now(),
      output: '',
      exitCode: null,
      durationMs: null,
      error: null,
    });
    if (this._runs.length > MAX_RUN_RECORDS) this._runs.length = MAX_RUN_RECORDS;

    this._note('ran', `Python script ${scriptPath}`, args.length ? `args: ${args.join(' ')}` : undefined, 'user');
    this._onDidChangeStatus.fire();

    return {
      ok: true,
      handle: { runId: res.runId, scriptPath: res.scriptPath ?? scriptPath, outDir: res.outDir ?? '' },
    };
  }

  async cancelRun(runId: string): Promise<void> {
    const api = getPythonApi();
    if (!api) return;
    await api.cancelRun(runId);
  }

  // ── Formatting ──

  async availableFormatters(): Promise<readonly string[]> {
    const api = getPythonApi();
    if (!api || !this._workspaceRoot) return [];
    try {
      const res = await api.detectFormatters(this._workspaceRoot) as { available?: string[] };
      return res.available ?? [];
    } catch {
      return [];
    }
  }

  async formatPython(source: string): Promise<{ ok: boolean; formatted?: string; error?: string }> {
    const g = this._guard();
    if (!g.ok) return { ok: false, error: g.error };

    const available = await this.availableFormatters();
    if (!available.length) {
      // Actionable rather than merely negative — the fix is one install away
      // and the message names it.
      return {
        ok: false,
        error: 'No Python formatter installed in this workspace. Add "black" or "ruff" in Settings › Python.',
      };
    }

    const res = await g.api.format(g.root, source, available[0]) as
      { ok?: boolean; formatted?: string; error?: string };
    if (!res.ok) return { ok: false, error: res.error ?? 'Formatting failed.' };
    return { ok: true, formatted: res.formatted };
  }

  recentRuns(): readonly IPythonRunRecord[] {
    return this._runs;
  }

  // ── Stream handling ──

  private _handleRunData(p: IPythonRunChunk): void {
    const rec = this._runs.find((r) => r.runId === p.runId);
    if (rec && rec.output.length < MAX_RECORD_OUTPUT) {
      rec.output += p.chunk;
    }
    this._onDidRunData.fire(p);
  }

  private _handleRunExit(p: IPythonRunExit): void {
    const rec = this._runs.find((r) => r.runId === p.runId);
    if (rec) {
      rec.exitCode = p.exitCode;
      rec.durationMs = p.durationMs;
      rec.error = p.error ? p.error.message : null;
    }
    if (p.error) {
      this._note('script failed', rec ? rec.scriptPath : p.runId, p.error.message);
    }
    this._onDidRunExit.fire(p);
    this._onDidChangeStatus.fire();
  }

  override dispose(): void {
    this._unsubData?.();
    this._unsubExit?.();
    this._unsubProgress?.();
    super.dispose();
  }
}
