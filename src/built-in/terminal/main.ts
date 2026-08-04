// Terminal Tool — built-in tool for Parallx (M11 Task 4.1)
//
// Provides an integrated terminal panel in the bottom panel area.
// Spawns a shell via Electron IPC and streams output to the UI.
// Recent output is captured for @terminal mention context injection.

import './terminal.css';
import type { ToolContext } from '../../tools/toolModuleLoader.js';
import type { IDisposable } from '../../platform/lifecycle.js';
import { $ } from '../../ui/dom.js';
import { createPanelToolbarButton, createPanelEmptyState } from '../../ui/panelSurface.js';
import { ansiToHtml } from '../../ui/ansiToHtml.js';
import { rafThrottle } from '../../platform/rafThrottle.js';
import { IWorkspaceService } from '../../services/serviceTypes.js';
import { IPythonEnvService } from '../../services/pythonEnvService.js';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ParallxApi {
  views: {
    registerViewProvider(
      viewId: string,
      provider: { createView(container: HTMLElement): IDisposable },
      options?: { name?: string; icon?: string },
    ): IDisposable;
  };
  commands: {
    registerCommand(id: string, handler: (...args: unknown[]) => unknown): IDisposable;
  };
  services: {
    has(id: unknown): boolean;
    get<T>(id: unknown): T;
  };
}

interface ElectronTerminalBridge {
  exec(command: string, options?: { cwd?: string; timeout?: number }): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
    error: { code: string; message: string } | null;
  }>;
  spawn(options?: { shell?: string; cwd?: string; workspaceRoot?: string }): Promise<{
    id: string | null;
    error: { code: string; message: string } | null;
  }>;
  write(id: string, data: string): void;
  kill(id: string): Promise<{ error: null }>;
  getOutput(lineCount?: number): Promise<{ output: string; lineCount: number }>;
  envInfo(workspaceRoot?: string): Promise<{ active: boolean; venvPath: string | null; binDir: string | null }>;
  sessionEnv(id: string): Promise<{ ok: boolean; venv: string | null }>;
  onData(callback: (payload: { id: string; data: string }) => void): () => void;
  onExit(callback: (payload: { id: string; exitCode: number }) => void): () => void;
}

// ─── State ───────────────────────────────────────────────────────────────────

let _outputEl: HTMLElement | null = null;
let _scrollEl: HTMLElement | null = null;
let _emptyEl: HTMLElement | null = null;
let _terminalId: string | null = null;
let _unsubData: (() => void) | null = null;
let _unsubExit: (() => void) | null = null;
let _commandHistory: string[] = [];
let _historyIndex = -1;

/** Workspace root, so shells open in the project and pick up its venv (M97). */
let _workspaceRoot: string | undefined;
/** The venv the CURRENT shell was started with — null when none. */
let _sessionVenv: string | null = null;
/** Strip for the STALE-session notice only; the steady state lives in the prompt. */
let _envBar: HTMLElement | null = null;
/** The `❯` glyph, which carries the active environment name like a shell prompt. */
let _promptEl: HTMLElement | null = null;

/** Maximum lines in the output element before trimming. */
const MAX_OUTPUT_LINES = 2000;

/**
 * Line count tracked incrementally, NOT read back from the DOM.
 *
 * The previous trim loop did `textContent.split('\n')` on every append — an
 * O(buffer) read per chunk, so a command streaming a large output made
 * appending O(n²) on the renderer thread. Each chunk records its own newline
 * count in a dataset attribute so trimming can subtract exactly what it drops.
 */
let _lineCount = 1;

/** Output that arrived before the panel view was built; flushed on mount. */
const _pendingOutput: string[] = [];
/** Bound so a long install with the panel closed cannot grow without limit. */
const MAX_PENDING_CHUNKS = 500;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getTerminalBridge(): ElectronTerminalBridge | undefined {
  return (globalThis as Record<string, unknown>).parallxElectron
    ? ((globalThis as Record<string, unknown>).parallxElectron as Record<string, unknown>).terminal as ElectronTerminalBridge | undefined
    : undefined;
}

/** Toggle the empty-state overlay based on whether any output exists. */
function syncTerminalEmpty(): void {
  // childNodes, not textContent — reading textContent serialises the whole
  // buffer, and this runs on every appended chunk.
  if (_emptyEl) { _emptyEl.hidden = (_outputEl?.childNodes.length ?? 0) > 0; }
}

/** Clear the visible output and restore the empty state. */
function clearTerminalOutput(): void {
  if (_outputEl) { _outputEl.textContent = ''; }
  _lineCount = 1;
  syncTerminalEmpty();
}

/**
 * One scroll per painted frame. `scrollTop = scrollHeight` forces a synchronous
 * layout, and a fast command emits many chunks per frame; per-chunk scrolling
 * was most of the append cost that remained after the O(n²) fix.
 */
const _pinScroll = rafThrottle(() => {
  const scroller = _scrollEl ?? _outputEl;
  if (scroller) scroller.scrollTop = scroller.scrollHeight;
});

/**
 * Append text to the output element, auto-scroll, and trim excess lines.
 *
 * Output is RENDERED with its ANSI colour rather than stripped. The panel used
 * to throw the escape codes away, which meant `pip`, `pytest`, `ruff` and
 * friends came out as undifferentiated grey — the error line looking exactly
 * like the twenty lines above it. The renderer is the same one notebook
 * tracebacks use (ui/ansiToHtml.ts), and it HTML-escapes everything it does
 * not itself emit, so shell output can never become markup.
 */
function appendOutput(text: string): void {
  if (!_outputEl) {
    // The panel view is built lazily, so output can arrive before it exists —
    // an install started from Settings while the terminal was never opened.
    // Dropping it here is how "the terminal is empty" survives being fixed:
    // the stream would be wired correctly and there would still be nothing to
    // see. Hold it instead and flush when the view mounts.
    _pendingOutput.push(text);
    if (_pendingOutput.length > MAX_PENDING_CHUNKS) _pendingOutput.shift();
    return;
  }

  const chunk = document.createElement('span');
  chunk.className = 'parallx-terminal-chunk';
  chunk.innerHTML = ansiToHtml(text);
  // Each chunk carries its own newline count so the trim loop can subtract
  // exactly what it removes without re-reading the buffer.
  const newlines = (text.match(/\n/g) ?? []).length;
  chunk.dataset['lines'] = String(newlines);
  _outputEl.appendChild(chunk);
  _lineCount += newlines;

  // Trim whole chunks from the front. Removing a node is O(1); the old
  // implementation re-counted the entire buffer's lines first.
  while (_lineCount > MAX_OUTPUT_LINES && _outputEl.childNodes.length > 1) {
    const first = _outputEl.firstChild as HTMLElement;
    _lineCount -= Number(first.dataset?.['lines'] ?? 0);
    _outputEl.removeChild(first);
  }

  syncTerminalEmpty();
  _pinScroll();
}

/**
 * Show the active environment where a shell would show it: in the prompt.
 *
 * A real terminal emulator gets `(.venv)` for free — the shell prints its own
 * prompt over a PTY and `activate` overrides the prompt function. This panel
 * is not a terminal emulator: it is an <input> writing to a PIPED shell, and a
 * shell with no TTY prints no prompt at all. The `❯` is ours, so the indicator
 * has to be ours too.
 *
 * The strip below is reserved for the one state that needs an ACTION —
 * a running shell whose environment has since changed. Duplicating the steady
 * state in both places would just be noise.
 */
function paintPrompt(activeVenv: string | null): void {
  if (!_promptEl) return;
  _promptEl.replaceChildren();
  if (activeVenv) {
    const name = activeVenv.replace(/[\\/]+$/, '').split(/[\\/]/).slice(-2, -1)[0] === '.parallx'
      ? '.venv'
      : (activeVenv.split(/[\\/]/).pop() || 'venv');
    const env = $('span');
    env.className = 'parallx-terminal-prompt__env';
    env.textContent = `(${name})`;
    env.title = `Python environment active: ${activeVenv}`;
    _promptEl.appendChild(env);
  }
  const glyph = $('span');
  glyph.className = 'parallx-terminal-prompt__glyph';
  glyph.textContent = '❯';
  _promptEl.appendChild(glyph);
}

/**
 * Reconcile what a NEW shell would get against what the RUNNING one has.
 *
 * A live process's environment cannot be changed from outside, so creating an
 * environment while a shell is open cannot retroactively activate it —
 * `python` would keep resolving to the system one with no explanation. VS Code
 * has the same constraint and answers it the same way: mark the session and
 * offer a relaunch.
 */
async function refreshEnvBar(): Promise<void> {
  const bridge = getTerminalBridge();
  if (!bridge?.envInfo) { if (_envBar) _envBar.hidden = true; return; }

  let info: { active: boolean; venvPath: string | null };
  try {
    info = await bridge.envInfo(_workspaceRoot);
  } catch {
    if (_envBar) _envBar.hidden = true;
    return;
  }

  const wanted = info.active ? info.venvPath : null;
  // Before a shell exists, show what the next one WILL get — otherwise the
  // panel reads as "no environment" when there is one, until you type.
  paintPrompt(_terminalId ? _sessionVenv : wanted);

  if (!_envBar) return;
  const stale = !!_terminalId && wanted !== _sessionVenv;
  _envBar.replaceChildren();
  if (!stale) { _envBar.hidden = true; return; }

  _envBar.hidden = false;
  _envBar.classList.add('parallx-terminal-env--stale');

  const label = $('span');
  label.className = 'parallx-terminal-env__label';
  label.textContent = wanted
    ? 'A Python environment was created for this workspace. Restart the shell to use it.'
    : 'This shell is using an environment that no longer exists.';
  _envBar.appendChild(label);

  const restart = document.createElement('button');
  restart.type = 'button';
  restart.className = 'parallx-terminal-env__action';
  restart.textContent = 'Restart shell';
  restart.addEventListener('click', () => { clearTerminalOutput(); void spawnShell(); });
  _envBar.appendChild(restart);
}

/** Lazy-spawn guard: at most one shell, created on first interaction. */
let _spawning = false;
async function ensureShell(): Promise<void> {
  if (_terminalId || _spawning) return;
  _spawning = true;
  try { await spawnShell(); } finally { _spawning = false; }
}

/** Spawn the interactive shell. */
async function spawnShell(): Promise<void> {
  const bridge = getTerminalBridge();
  if (!bridge) {
    appendOutput('[Terminal] No terminal bridge available. Running outside Electron.\n');
    return;
  }

  // Kill existing session
  if (_terminalId) {
    try { await bridge.kill(_terminalId); } catch { /* ignore */ }
    _terminalId = null;
  }

  // Clean up old listeners
  _unsubData?.();
  _unsubExit?.();

  const result = await bridge.spawn({ workspaceRoot: _workspaceRoot });
  if (result.error || !result.id) {
    appendOutput(`[Terminal] Failed to spawn shell: ${result.error?.message ?? 'unknown error'}\n`);
    return;
  }

  _terminalId = result.id;

  // Record what this shell actually got, so the strip can tell the user when
  // it has since gone stale.
  try {
    const session = await bridge.sessionEnv(result.id);
    _sessionVenv = session.venv;
  } catch {
    _sessionVenv = null;
  }
  void refreshEnvBar();

  // Subscribe to output
  _unsubData = bridge.onData((payload) => {
    if (payload.id === _terminalId) {
      appendOutput(payload.data);
    }
  });

  // Subscribe to exit
  _unsubExit = bridge.onExit((payload) => {
    if (payload.id === _terminalId) {
      appendOutput(`\n[Process exited with code ${payload.exitCode}]\n`);
      _terminalId = null;
    }
  });
}

/** Send a command to the shell. */
function sendCommand(text: string): void {
  const bridge = getTerminalBridge();
  if (!bridge || !_terminalId) {
    appendOutput(`[Terminal] No active shell session.\n`);
    return;
  }
  bridge.write(_terminalId, text + '\n');
}

// ─── Activation ──────────────────────────────────────────────────────────────

export function activate(api: ParallxApi, context: ToolContext): void {

  // ── M97: workspace + Python environment awareness ──
  // The shell opens in the workspace and activates its venv, so `python`,
  // `pip`, and console scripts mean the same thing here as in a run cell.
  if (api.services.has(IWorkspaceService)) {
    const workspace = api.services.get<IWorkspaceService>(IWorkspaceService);
    _workspaceRoot = workspace.folders?.[0]?.uri?.fsPath;
  }
  if (api.services.has(IPythonEnvService)) {
    const python = api.services.get<IPythonEnvService>(IPythonEnvService);
    // Creating or deleting the environment changes what a NEW shell would get.
    // A running one cannot follow, so the strip surfaces the difference rather
    // than silently diverging.
    context.subscriptions.push(python.onDidChangeStatus(() => { void refreshEnvBar(); }));

    // Environment creation and pip installs stream here.
    //
    // This is where a user looks when they run something, and it was empty:
    // the bridge has always emitted the command line (`$ pip install pandas`)
    // and piped pip's live output, but the only subscriber was the Settings
    // panel. Making someone open Settings › Python to watch a package install
    // is not a terminal — it is a log viewer that happens to be somewhere else.
    context.subscriptions.push(python.onDidProgress((p) => {
      appendOutput(p.chunk);
    }));

    // Script runs (the editor's Run action, and the AI's python tool) stream
    // here too, for the same reason.
    context.subscriptions.push(python.onDidRunData((p) => {
      appendOutput(p.chunk);
    }));

    context.subscriptions.push(python.onDidRunExit((p) => {
      // A bare prompt after output leaves you guessing whether it worked.
      if (p.error) appendOutput(`\n\u001b[31m✗ ${p.error.message}\u001b[0m\n`);
      else if (p.exitCode === 0) appendOutput(`\u001b[32m✓ finished in ${p.durationMs} ms\u001b[0m\n`);
      else appendOutput(`\u001b[31m✗ exited ${p.exitCode} after ${p.durationMs} ms\u001b[0m\n`);
    }));
  }

  // Register the panel view provider
  const viewDisposable = api.views.registerViewProvider('view.terminal', {
    createView(container: HTMLElement): IDisposable {
      const root = $('div.parallx-terminal');
      root.classList.add('px-panel');

      // ── Actions — floating, no header row. The tab strip above already
      // says "Terminal"; a toolbar here just repeated it and cost a row. ──
      const actions = $('div');
      actions.className = 'px-panel-actions';
      actions.appendChild(createPanelToolbarButton({
        icon: 'eraser',
        title: 'Clear',
        onClick: () => clearTerminalOutput(),
      }));
      actions.appendChild(createPanelToolbarButton({
        icon: 'rotate-cw',
        title: 'Restart shell',
        onClick: () => { clearTerminalOutput(); void spawnShell(); },
      }));
      root.appendChild(actions);

      // ── Environment strip (M97) — hidden unless there is something to say ──
      _envBar = $('div');
      _envBar.className = 'parallx-terminal-env';
      _envBar.hidden = true;
      root.appendChild(_envBar);
      void refreshEnvBar();

      // ── Body: scrollable output + empty-state overlay ──
      const body = $('div');
      body.className = 'px-panel-body';

      const outputArea = $('div.parallx-terminal-output');
      body.appendChild(outputArea);

      const empty = createPanelEmptyState({
        icon: 'square-terminal',
        title: 'Terminal ready',
        hint: 'Type a command below, or use @terminal in chat to give the agent shell access.',
      });
      body.appendChild(empty);

      root.appendChild(body);
      _outputEl = outputArea;
      _scrollEl = body;
      _emptyEl = empty;
      // Fresh element, fresh count — a stale count from a previous mount would
      // make the trim loop start evicting chunks long before 2000 real lines.
      _lineCount = 1;

      // Replay anything that streamed in before this view existed — the install
      // you started from Settings and only then came looking for.
      if (_pendingOutput.length > 0) {
        const held = _pendingOutput.splice(0, _pendingOutput.length);
        for (const text of held) appendOutput(text);
      }

      syncTerminalEmpty();

      // ── Input line ──
      const inputLine = $('div.parallx-terminal-input-line');
      const prompt = $('span.parallx-terminal-prompt');
      _promptEl = prompt;
      paintPrompt(null);
      inputLine.appendChild(prompt);
      void refreshEnvBar();

      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'parallx-terminal-input';
      input.placeholder = 'Enter command…';
      input.spellcheck = false;
      input.autocomplete = 'off';
      inputLine.appendChild(input);

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const text = input.value.trim();
          if (!text) { return; }
          _commandHistory.push(text);
          _historyIndex = _commandHistory.length;
          input.value = '';
          sendCommand(text);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          if (_historyIndex > 0) {
            _historyIndex--;
            input.value = _commandHistory[_historyIndex] ?? '';
          }
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          if (_historyIndex < _commandHistory.length - 1) {
            _historyIndex++;
            input.value = _commandHistory[_historyIndex] ?? '';
          } else {
            _historyIndex = _commandHistory.length;
            input.value = '';
          }
        }
      });

      root.appendChild(inputLine);

      // Focus on click anywhere in the terminal
      body.addEventListener('click', () => input.focus());

      container.appendChild(root);

      // Spawn the shell LAZILY on first interaction — the tab merely existing
      // must not cost a shell process at every app start.
      input.addEventListener('focus', () => { void ensureShell(); });

      return {
        dispose() {
          _unsubData?.();
          _unsubExit?.();
          const bridge = getTerminalBridge();
          if (bridge && _terminalId) {
            void bridge.kill(_terminalId);
          }
          _terminalId = null;
          _outputEl = null;
          _scrollEl = null;
          _emptyEl = null;
          root.remove();
        },
      };
    },
  }, { name: 'Terminal', icon: 'terminal' });

  context.subscriptions.push(viewDisposable);

  // ── Commands ──

  context.subscriptions.push(
    api.commands.registerCommand('terminal.clear', () => {
      clearTerminalOutput();
    }),
  );

  context.subscriptions.push(
    api.commands.registerCommand('terminal.restart', () => {
      clearTerminalOutput();
      void spawnShell();
    }),
  );
}

export function deactivate(): void {
  _unsubData?.();
  _unsubExit?.();
  const bridge = getTerminalBridge();
  if (bridge && _terminalId) {
    void bridge.kill(_terminalId);
  }
  _terminalId = null;
  _commandHistory = [];
  // Held output belongs to the session being torn down; replaying it into a
  // later one would show a stale install above an unrelated prompt.
  _pendingOutput.length = 0;
}
