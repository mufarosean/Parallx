// Terminal Tool — built-in tool for Parallx (M11 Task 4.1)
//
// Provides an integrated terminal panel in the bottom panel area.
// Spawns a shell via Electron IPC and streams output to the UI.
// Recent output is captured for @terminal mention context injection.

import './terminal.css';
import type { ToolContext } from '../../tools/toolModuleLoader.js';
import type { IDisposable } from '../../platform/lifecycle.js';
import { $ } from '../../ui/dom.js';

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
}

interface ElectronTerminalBridge {
  exec(command: string, options?: { cwd?: string; timeout?: number }): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
    error: { code: string; message: string } | null;
  }>;
  spawn(options?: { shell?: string; cwd?: string }): Promise<{
    id: string | null;
    error: { code: string; message: string } | null;
  }>;
  write(id: string, data: string): void;
  kill(id: string): Promise<{ error: null }>;
  getOutput(lineCount?: number): Promise<{ output: string; lineCount: number }>;
  onData(callback: (payload: { id: string; data: string }) => void): () => void;
  onExit(callback: (payload: { id: string; exitCode: number }) => void): () => void;
}

// ─── State ───────────────────────────────────────────────────────────────────

let _outputEl: HTMLElement | null = null;
let _terminalId: string | null = null;
let _unsubData: (() => void) | null = null;
let _unsubExit: (() => void) | null = null;
let _commandHistory: string[] = [];
let _historyIndex = -1;

/** Maximum lines in the output element before trimming. */
const MAX_OUTPUT_LINES = 2000;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getTerminalBridge(): ElectronTerminalBridge | undefined {
  return (globalThis as Record<string, unknown>).parallxElectron
    ? ((globalThis as Record<string, unknown>).parallxElectron as Record<string, unknown>).terminal as ElectronTerminalBridge | undefined
    : undefined;
}

/** Strip basic ANSI escape sequences for plain text display. */
function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
}

/** Append text to the output element, auto-scroll, and trim excess lines. */
function appendOutput(text: string): void {
  if (!_outputEl) { return; }

  const clean = stripAnsi(text);
  _outputEl.appendChild(document.createTextNode(clean));

  // Trim excess lines
  const lines = _outputEl.textContent?.split('\n') ?? [];
  if (lines.length > MAX_OUTPUT_LINES) {
    const excess = lines.length - MAX_OUTPUT_LINES;
    const content = lines.slice(excess).join('\n');
    _outputEl.textContent = content;
  }

  // Auto-scroll to bottom
  _outputEl.scrollTop = _outputEl.scrollHeight;
}

/** Spawn the interactive shell. */
async function spawnShell(): Promise<void> {
  const bridge = getTerminalBridge();
  if (!bridge) {
    appendOutput('[Terminal] No terminal bridge available — running outside Electron.\n');
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

  const result = await bridge.spawn();
  if (result.error || !result.id) {
    appendOutput(`[Terminal] Failed to spawn shell: ${result.error?.message ?? 'unknown error'}\n`);
    return;
  }

  _terminalId = result.id;

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

  // Register the panel view provider
  const viewDisposable = api.views.registerViewProvider('view.terminal', {
    createView(container: HTMLElement): IDisposable {
      const root = $('div.parallx-terminal');

      // ── Toolbar ──
      const toolbar = $('div.parallx-terminal-toolbar');

      const clearBtn = document.createElement('button');
      clearBtn.className = 'parallx-terminal-toolbar-btn';
      clearBtn.title = 'Clear';
      clearBtn.textContent = '⌫ Clear';
      clearBtn.addEventListener('click', () => {
        if (_outputEl) { _outputEl.textContent = ''; }
      });
      toolbar.appendChild(clearBtn);

      const restartBtn = document.createElement('button');
      restartBtn.className = 'parallx-terminal-toolbar-btn';
      restartBtn.title = 'Restart Shell';
      restartBtn.textContent = '↻ Restart';
      restartBtn.addEventListener('click', () => {
        if (_outputEl) { _outputEl.textContent = ''; }
        void spawnShell();
      });
      toolbar.appendChild(restartBtn);

      root.appendChild(toolbar);

      // ── Output area ──
      const outputArea = $('div.parallx-terminal-output');
      const welcome = $('div.parallx-terminal-welcome');
      welcome.textContent = 'Terminal ready. Type a command below or use @terminal in chat.';
      outputArea.appendChild(welcome);
      root.appendChild(outputArea);
      _outputEl = outputArea;

      // ── Input line ──
      const inputLine = $('div.parallx-terminal-input-line');
      const prompt = $('span.parallx-terminal-prompt');
      prompt.textContent = '❯';
      inputLine.appendChild(prompt);

      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'parallx-terminal-input';
      input.placeholder = 'Enter command...';
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
      outputArea.addEventListener('click', () => input.focus());

      container.appendChild(root);

      // Spawn the shell
      void spawnShell();

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
          root.remove();
        },
      };
    },
  }, { name: 'Terminal', icon: 'terminal' });

  context.subscriptions.push(viewDisposable);

  // ── Commands ──

  context.subscriptions.push(
    api.commands.registerCommand('terminal.clear', () => {
      if (_outputEl) { _outputEl.textContent = ''; }
    }),
  );

  context.subscriptions.push(
    api.commands.registerCommand('terminal.restart', () => {
      if (_outputEl) { _outputEl.textContent = ''; }
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
}
