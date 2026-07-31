// @vitest-environment jsdom
//
// terminalPythonOutput.test.ts — Python output has to land in the Terminal panel.
//
// Written because it didn't. The streaming end was built correctly — the bridge
// emits the command line (`$ pip install pandas`) and pipes pip's live output
// through IPythonEnvService.onDidProgress — but the only subscriber was the
// Settings › Python panel. So a user who ran an install watched an empty
// terminal and had to go find a settings page to see what was happening, and the
// editor's Run action literally told them to ("see Settings › Python for output").
//
// The three subscriptions here are the whole fix, so they are what these tests
// pin. The fourth test covers the trap that would have made the fix invisible:
// the panel view is built lazily, so output that arrives before anyone opens the
// terminal has to be held rather than dropped.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { activate, deactivate } from '../../src/built-in/terminal/main.js';
import { IPythonEnvService } from '../../src/services/pythonEnvService.js';
import { IWorkspaceService } from '../../src/services/serviceTypes.js';
import type { IDisposable } from '../../src/platform/lifecycle.js';

// ── A minimal event emitter matching the service's Event<T> shape ────────────

function emitter<T>() {
  const listeners = new Set<(e: T) => void>();
  const event = (listener: (e: T) => void): IDisposable => {
    listeners.add(listener);
    return { dispose: () => listeners.delete(listener) };
  };
  return { event, fire: (e: T) => { for (const l of [...listeners]) l(e); } };
}

function makeHarness() {
  const progress = emitter<{ phase: string; channel: string; chunk: string }>();
  const runData = emitter<{ runId: string; channel: string; chunk: string }>();
  const runExit = emitter<{ runId: string; exitCode: number; error: { code: string; message: string } | null; durationMs: number }>();
  const status = emitter<void>();

  const python = {
    onDidProgress: progress.event,
    onDidRunData: runData.event,
    onDidRunExit: runExit.event,
    onDidChangeStatus: status.event,
    getStatus: async () => ({ exists: false, venvPath: null }),
  };

  const subscriptions: IDisposable[] = [];
  const registered: Array<{ viewId: string; provider: { createView(c: HTMLElement): IDisposable } }> = [];

  const api = {
    views: {
      registerViewProvider(viewId: string, provider: { createView(c: HTMLElement): IDisposable }) {
        registered.push({ viewId, provider });
        return { dispose: () => {} };
      },
    },
    commands: { registerCommand: () => ({ dispose: () => {} }) },
    services: {
      has: (id: unknown) => id === IPythonEnvService || id === IWorkspaceService,
      get: (id: unknown) => (id === IPythonEnvService ? python : { folders: [] }),
    },
  };

  const context = {
    subscriptions,
    globalState: { get: () => undefined, update: async () => {} },
    workspaceState: { get: () => undefined, update: async () => {} },
    toolPath: '', toolUri: '', environmentVariableCollection: {},
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  activate(api as any, context as any);

  let openView: IDisposable | undefined;

  return {
    progress, runData, runExit,
    /** Mount the panel view, as opening the Terminal panel does. */
    openPanel(): HTMLElement {
      // Closing the previous one first — the view's dispose() is what releases
      // the module's reference to the old output element. Without it the module
      // keeps writing into a detached node and the next panel looks empty, which
      // is a test artefact, not a product bug.
      openView?.dispose();
      const host = document.createElement('div');
      document.body.appendChild(host);
      const view = registered.find(r => r.viewId === 'view.terminal');
      if (!view) throw new Error('terminal view provider was never registered');
      openView = view.provider.createView(host);
      return host;
    },
    text: (host: HTMLElement) =>
      host.querySelector('.parallx-terminal-output')?.textContent ?? '',
    /** What the tool loader does on deactivation. */
    teardown(): void {
      openView?.dispose();
      openView = undefined;
      for (const s of subscriptions.splice(0)) s.dispose();
    },
  };
}

let harness: ReturnType<typeof makeHarness> | undefined;
function harnessed() {
  harness = makeHarness();
  return harness;
}

beforeEach(() => {
  document.body.innerHTML = '';
  // The panel talks to an Electron bridge that does not exist under jsdom; the
  // module already guards for it, and none of these paths need a live shell.
  delete (globalThis as Record<string, unknown>).parallxElectron;
});

afterEach(() => {
  // Dispose the view and every subscription, the way the tool loader does.
  // Skipping this leaves the module holding a detached output element, and the
  // next test's pre-open output writes into the orphan.
  harness?.teardown();
  harness = undefined;
  deactivate();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('pip / venv output reaches the terminal', () => {
  it('shows the command the bridge echoed', () => {
    // THE regression: this is the `$ pip install …` line pythonBridge.cjs emits
    // at the start of every install, and it went only to Settings › Python.
    const h = harnessed();
    const host = h.openPanel();
    h.progress.fire({ phase: 'install', channel: 'stdout', chunk: '$ pip install pandas\n' });
    expect(h.text(host)).toContain('$ pip install pandas');
  });

  it('streams pip progress as it arrives', () => {
    const h = harnessed();
    const host = h.openPanel();
    h.progress.fire({ phase: 'install', channel: 'stdout', chunk: 'Collecting pandas\n' });
    h.progress.fire({ phase: 'install', channel: 'stdout', chunk: 'Downloading pandas-2.2.0.whl (11 MB)\n' });
    const out = h.text(host);
    expect(out).toContain('Collecting pandas');
    expect(out).toContain('Downloading pandas-2.2.0.whl');
  });

  it('shows environment-creation output', () => {
    const h = harnessed();
    const host = h.openPanel();
    h.progress.fire({ phase: 'create', channel: 'stdout', chunk: 'Creating environment with Python 3.12.1…\n' });
    expect(h.text(host)).toContain('Creating environment with Python 3.12.1');
  });

  it('shows stderr, which is where the errors are', () => {
    // The actual complaint: Python ERRORS were not visible here.
    const h = harnessed();
    const host = h.openPanel();
    h.progress.fire({
      phase: 'install', channel: 'stderr',
      chunk: 'ERROR: Could not find a version that satisfies the requirement pandsa\n',
    });
    expect(h.text(host)).toContain('Could not find a version that satisfies');
  });
});

describe('script runs reach the terminal', () => {
  it('streams stdout from a run', () => {
    const h = harnessed();
    const host = h.openPanel();
    h.runData.fire({ runId: 'r1', channel: 'stdout', chunk: 'hello from the script\n' });
    expect(h.text(host)).toContain('hello from the script');
  });

  it('streams a traceback from stderr', () => {
    const h = harnessed();
    const host = h.openPanel();
    h.runData.fire({
      runId: 'r1', channel: 'stderr',
      chunk: 'Traceback (most recent call last):\n  File "a.py", line 1\nZeroDivisionError: division by zero\n',
    });
    const out = h.text(host);
    expect(out).toContain('Traceback (most recent call last)');
    expect(out).toContain('ZeroDivisionError: division by zero');
  });

  it('reports a clean exit with its duration', () => {
    const h = harnessed();
    const host = h.openPanel();
    h.runExit.fire({ runId: 'r1', exitCode: 0, error: null, durationMs: 42 });
    expect(h.text(host)).toContain('finished in 42 ms');
  });

  it('reports a non-zero exit rather than just stopping', () => {
    const h = harnessed();
    const host = h.openPanel();
    h.runExit.fire({ runId: 'r1', exitCode: 1, error: null, durationMs: 17 });
    expect(h.text(host)).toContain('exited 1');
  });

  it('reports a failure to start', () => {
    const h = harnessed();
    const host = h.openPanel();
    h.runExit.fire({
      runId: 'r1', exitCode: -1, durationMs: 3,
      error: { code: 'ENOENT', message: 'interpreter not found' },
    });
    expect(h.text(host)).toContain('interpreter not found');
  });

  it('renders ANSI colour rather than leaking escape codes as text', () => {
    const h = harnessed();
    const host = h.openPanel();
    h.runExit.fire({ runId: 'r1', exitCode: 0, error: null, durationMs: 5 });
    // The marker is coloured; the user must never see the raw sequence.
    expect(h.text(host)).not.toContain('[32m');
    expect(h.text(host)).not.toContain('');
  });
});

describe('output that arrives before the panel is opened', () => {
  it('is replayed when the terminal is finally opened', () => {
    // Without this the fix is invisible in the most common case: you click
    // Install in Settings, then go looking at the terminal — which mounts only
    // at that moment, after every chunk has already been emitted.
    const h = harnessed();
    h.progress.fire({ phase: 'install', channel: 'stdout', chunk: '$ pip install pandas\n' });
    h.progress.fire({ phase: 'install', channel: 'stdout', chunk: 'Successfully installed pandas-2.2.0\n' });

    const host = h.openPanel();
    const out = h.text(host);
    expect(out).toContain('$ pip install pandas');
    expect(out).toContain('Successfully installed pandas-2.2.0');
  });

  it('keeps ordering across the boundary', () => {
    const h = harnessed();
    h.progress.fire({ phase: 'install', channel: 'stdout', chunk: 'FIRST\n' });
    const host = h.openPanel();
    h.progress.fire({ phase: 'install', channel: 'stdout', chunk: 'SECOND\n' });
    const out = h.text(host);
    expect(out.indexOf('FIRST')).toBeLessThan(out.indexOf('SECOND'));
    expect(out.indexOf('FIRST')).toBeGreaterThanOrEqual(0);
  });

  it('does not replay the same buffered output twice', () => {
    const h = harnessed();
    h.progress.fire({ phase: 'install', channel: 'stdout', chunk: 'ONLY ONCE\n' });
    const first = h.openPanel();
    expect(h.text(first)).toContain('ONLY ONCE');

    // Closing and reopening the panel must not resurrect the backlog.
    const second = h.openPanel();
    expect(h.text(second)).not.toContain('ONLY ONCE');
  });

  it('bounds the backlog so a long install with the panel closed cannot grow forever', () => {
    const h = harnessed();
    for (let i = 0; i < 900; i++) {
      h.progress.fire({ phase: 'install', channel: 'stdout', chunk: `line ${i}\n` });
    }
    const host = h.openPanel();
    const out = h.text(host);
    // The tail is what matters — the end of an install is the part you need.
    expect(out).toContain('line 899');
    expect(out).not.toContain('line 0\n');
  });

  it('hides the empty state once replayed output lands', () => {
    const h = harnessed();
    h.progress.fire({ phase: 'install', channel: 'stdout', chunk: 'something\n' });
    const host = h.openPanel();
    const empty = host.querySelector<HTMLElement>('.px-panel-empty, .parallx-terminal-empty');
    if (empty) expect(empty.hidden).toBe(true);
  });
});
