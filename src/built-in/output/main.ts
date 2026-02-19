// Output Tool — built-in tool for Parallx
//
// Provides a scrollable log viewer in the panel area.
// Demonstrates: panel view contribution, commands, workspace state.

import './output.css';
import type { ToolContext } from '../../tools/toolModuleLoader.js';
import type { IDisposable } from '../../platform/lifecycle.js';
import { $ } from '../../ui/dom.js';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ParallxApi {
  views: {
    registerViewProvider(viewId: string, provider: { createView(container: HTMLElement): IDisposable }, options?: { name?: string; icon?: string }): IDisposable;
  };
  commands: {
    registerCommand(id: string, handler: (...args: unknown[]) => unknown): IDisposable;
  };
  window: {
    createOutputChannel(name: string): OutputChannel;
  };
}

interface OutputChannel {
  readonly name: string;
  append(value: string): void;
  appendLine(value: string): void;
  clear(): void;
  show(): void;
  dispose(): void;
}

// ─── State ───────────────────────────────────────────────────────────────────

/** Global log entries available to the output view. */
const logEntries: LogEntry[] = [];
let showTimestamps = true;
let listEl: HTMLElement | null = null;
let outputChannel: OutputChannel | null = null;

interface LogEntry {
  readonly timestamp: number;
  readonly source: string;
  readonly message: string;
}

// ─── Activation ──────────────────────────────────────────────────────────────

export function activate(api: ParallxApi, context: ToolContext): void {
  // Restore settings from workspace state
  const savedTimestamps = context.workspaceState.get<boolean>('output.showTimestamps');
  if (savedTimestamps !== undefined) showTimestamps = savedTimestamps;

  // Create an output channel for the tool itself
  outputChannel = api.window.createOutputChannel('Output Tool');

  // Register the panel view provider
  const viewDisposable = api.views.registerViewProvider('view.output', {
    createView(container: HTMLElement): IDisposable {
      return renderOutputView(container);
    },
  }, { name: 'Output', icon: '📋' });
  context.subscriptions.push(viewDisposable);

  // Register commands
  const clearCmd = api.commands.registerCommand('output.clear', () => {
    logEntries.length = 0;
    refreshList();
    outputChannel?.appendLine('Output cleared');
  });
  context.subscriptions.push(clearCmd);

  const toggleCmd = api.commands.registerCommand('output.toggleTimestamps', () => {
    showTimestamps = !showTimestamps;
    context.workspaceState.update('output.showTimestamps', showTimestamps);
    refreshList();
  });
  context.subscriptions.push(toggleCmd);

  // Intercept console.log/warn/error to capture output
  const origLog = console.log;
  const origWarn = console.warn;
  const origError = console.error;

  console.log = (...args: unknown[]) => {
    origLog.apply(console, args);
    addEntry('log', args.map(String).join(' '));
  };
  console.warn = (...args: unknown[]) => {
    origWarn.apply(console, args);
    addEntry('warn', args.map(String).join(' '));
  };
  console.error = (...args: unknown[]) => {
    origError.apply(console, args);
    addEntry('error', args.map(String).join(' '));
  };

  // Restore console on dispose
  context.subscriptions.push({
    dispose() {
      console.log = origLog;
      console.warn = origWarn;
      console.error = origError;
      listEl = null;
    },
  });

  // Seed with initial entry
  addEntry('info', 'Output panel ready');
}

export function deactivate(): void {
  outputChannel = null;
  listEl = null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function addEntry(source: string, message: string): void {
  logEntries.push({ timestamp: Date.now(), source, message });
  // Cap at 1000 entries
  if (logEntries.length > 1000) logEntries.shift();
  refreshList();
}

function refreshList(): void {
  if (!listEl) return;
  listEl.innerHTML = '';
  for (const entry of logEntries) {
    const row = $('div');
    row.classList.add('output-row', `output-${entry.source}`);

    let text = '';
    if (showTimestamps) {
      const d = new Date(entry.timestamp);
      const ts = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}.${String(d.getMilliseconds()).padStart(3, '0')}`;
      text = `[${ts}] `;
    }
    text += entry.message;

    row.textContent = text;
    listEl.appendChild(row);
  }

  // Auto-scroll to bottom
  listEl.scrollTop = listEl.scrollHeight;
}

function renderOutputView(container: HTMLElement): IDisposable {
  container.classList.add('output-container');

  // Toolbar
  const toolbar = $('div');
  toolbar.classList.add('output-toolbar');

  const title = $('span');
  title.classList.add('output-toolbar-title');
  title.textContent = 'OUTPUT';
  toolbar.appendChild(title);

  const tsBtn = $('button');
  tsBtn.classList.add('output-toolbar-btn');
  tsBtn.textContent = '⏱ Timestamps';
  tsBtn.title = 'Toggle timestamps';
  tsBtn.addEventListener('click', () => {
    showTimestamps = !showTimestamps;
    refreshList();
  });
  toolbar.appendChild(tsBtn);

  const clearBtn = $('button');
  clearBtn.classList.add('output-toolbar-btn');
  clearBtn.textContent = '🗑 Clear';
  clearBtn.title = 'Clear output';
  clearBtn.addEventListener('click', () => {
    logEntries.length = 0;
    refreshList();
  });
  toolbar.appendChild(clearBtn);

  container.appendChild(toolbar);

  // Log list
  const list = $('div');
  list.classList.add('output-list');
  container.appendChild(list);

  listEl = list;
  refreshList();

  return {
    dispose() {
      listEl = null;
      container.innerHTML = '';
    },
  };
}
