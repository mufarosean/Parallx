// D3: Diagnostics panel — built-in panel tool for AI runtime health checks
// Pattern: Panel view contribution (same as indexing-log tool)

import './diagnostics.css';
import type { ToolContext } from '../../tools/toolModuleLoader.js';
import type { IDisposable } from '../../platform/lifecycle.js';
import { $ } from '../../ui/dom.js';
import type { IDiagnosticResult } from '../../services/serviceTypes.js';
import { IDiagnosticsService } from '../../services/serviceTypes.js';

// ── SVG Icons ────────────────────────────────────────────────────────────────

const ICON_PASS = `<svg width="16" height="16" viewBox="0 0 16 16" fill="var(--parallx-success-fg, #4ec9b0)"><path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z"/></svg>`;
const ICON_FAIL = `<svg width="16" height="16" viewBox="0 0 16 16" fill="var(--parallx-error-fg, #f44747)"><path d="M11.06 4.94a.75.75 0 010 1.06L9.06 8l2 2a.75.75 0 11-1.06 1.06L8 9.06l-2 2a.75.75 0 01-1.06-1.06l2-2-2-2a.75.75 0 011.06-1.06L8 6.94l2-2a.75.75 0 011.06 0z"/></svg>`;
const ICON_WARN = `<svg width="16" height="16" viewBox="0 0 16 16" fill="var(--parallx-warning-fg, #cca700)"><path d="M8 1l7 14H1L8 1zm0 3L3.2 13h9.6L8 4zm-.75 3.5h1.5v3h-1.5v-3zm0 4h1.5v1.5h-1.5v-1.5z"/></svg>`;
const ICON_REFRESH = `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M13.45 5.66A6 6 0 003.17 4.5H5V6H1V2h1.5v1.76A7.5 7.5 0 0115 7.5h-1.5a.11.11 0 00-.05-.16v-.02l-.01-.02A5.97 5.97 0 0013.45 5.66zM2.55 10.34A6 6 0 0012.83 11.5H11V10h4v4h-1.5v-1.76A7.5 7.5 0 011 8.5h1.5l.01.02.01.02c.08.6.26 1.2.53 1.76l.01.02.01.02z"/></svg>`;

// ── Local API type ───────────────────────────────────────────────────────────

interface ParallxApi {
  views: {
    registerViewProvider(viewId: string, provider: { createView(container: HTMLElement): IDisposable }, options?: { name?: string; icon?: string }): IDisposable;
  };
  commands: {
    registerCommand(commandId: string, handler: (...args: unknown[]) => unknown): IDisposable;
  };
  services: {
    has(id: unknown): boolean;
    get<T>(id: unknown): T;
  };
}

// ── Module exports ───────────────────────────────────────────────────────────

let diagnosticsService: InstanceType<typeof import('../../services/diagnosticsService.js').DiagnosticsService> | undefined;
let currentResults: readonly IDiagnosticResult[] = [];
let renderCallback: (() => void) | undefined;

export function activate(api: ParallxApi, context: ToolContext): void {
  // Resolve diagnostics service from DI via api.services
  const svc = api.services.has(IDiagnosticsService)
    ? api.services.get<import('../../services/serviceTypes.js').IDiagnosticsService>(IDiagnosticsService)
    : undefined;
  if (svc) {
    diagnosticsService = svc as typeof diagnosticsService;
  }

  // Register view provider for the panel tab
  const viewDisposable = api.views.registerViewProvider('view.diagnostics', {
    createView(container: HTMLElement): IDisposable {
      return renderDiagnosticsView(container);
    },
  });
  context.subscriptions.push(viewDisposable);

  // Register re-run command
  const cmdDisposable = api.commands.registerCommand('diagnostics.runChecks', async () => {
    if (diagnosticsService) {
      currentResults = await diagnosticsService.runChecks();
      renderCallback?.();
    }
  });
  context.subscriptions.push(cmdDisposable);

  // Subscribe to service changes
  if (diagnosticsService) {
    const sub = diagnosticsService.onDidChange((results) => {
      currentResults = results;
      renderCallback?.();
    });
    context.subscriptions.push(sub);

    // Auto-run on startup
    diagnosticsService.runChecks().then((results) => {
      currentResults = results;
      renderCallback?.();
    }).catch(() => { /* swallow startup errors */ });
  }
}

export function deactivate(): void {
  diagnosticsService = undefined;
  renderCallback = undefined;
}

// ── View renderer ────────────────────────────────────────────────────────────

function renderDiagnosticsView(container: HTMLElement): IDisposable {
  container.classList.add('diagnostics-container');

  // Header
  const header = $('div.diagnostics-header');
  const title = $('span.diagnostics-title');
  title.textContent = 'AI Runtime Diagnostics';
  header.appendChild(title);

  const spacer = $('span.diagnostics-spacer');
  header.appendChild(spacer);

  const refreshBtn = $('button.diagnostics-toolbar-btn');
  refreshBtn.title = 'Re-run checks';
  refreshBtn.innerHTML = ICON_REFRESH;
  refreshBtn.addEventListener('click', async () => {
    if (diagnosticsService) {
      refreshBtn.classList.add('diagnostics-spinning');
      currentResults = await diagnosticsService.runChecks();
      refreshBtn.classList.remove('diagnostics-spinning');
      renderResults();
    }
  });
  header.appendChild(refreshBtn);

  // Summary line
  const summary = $('div.diagnostics-summary');

  // Results table
  const tableContainer = $('div.diagnostics-table-container');

  container.appendChild(header);
  container.appendChild(summary);
  container.appendChild(tableContainer);

  function renderResults(): void {
    const results = currentResults;

    // Summary
    const pass = results.filter(r => r.status === 'pass').length;
    const fail = results.filter(r => r.status === 'fail').length;
    const warn = results.filter(r => r.status === 'warn').length;
    const icon = fail > 0 ? '❌' : warn > 0 ? '⚠️' : '✅';
    summary.textContent = `${icon} ${pass} pass, ${fail} fail, ${warn} warn`;
    summary.className = `diagnostics-summary ${fail > 0 ? 'diagnostics-summary--fail' : warn > 0 ? 'diagnostics-summary--warn' : 'diagnostics-summary--pass'}`;

    // Table
    tableContainer.textContent = '';
    if (results.length === 0) {
      const empty = $('div.diagnostics-empty');
      empty.textContent = 'No diagnostic results yet. Click refresh to run checks.';
      tableContainer.appendChild(empty);
      return;
    }

    const table = $('table.diagnostics-table');
    const thead = $('thead');
    thead.innerHTML = '<tr><th></th><th>Check</th><th>Detail</th><th>Time</th></tr>';
    table.appendChild(thead);

    const tbody = $('tbody');
    for (const result of results) {
      const row = $('tr.diagnostics-row');
      row.classList.add(`diagnostics-row--${result.status}`);

      const iconCell = $('td.diagnostics-icon');
      iconCell.innerHTML = result.status === 'pass' ? ICON_PASS : result.status === 'fail' ? ICON_FAIL : ICON_WARN;

      const nameCell = $('td.diagnostics-name');
      nameCell.textContent = result.name;

      const detailCell = $('td.diagnostics-detail');
      detailCell.textContent = result.detail;

      const timeCell = $('td.diagnostics-time');
      timeCell.textContent = new Date(result.timestamp).toLocaleTimeString();

      row.appendChild(iconCell);
      row.appendChild(nameCell);
      row.appendChild(detailCell);
      row.appendChild(timeCell);
      tbody.appendChild(row);
    }
    table.appendChild(tbody);
    tableContainer.appendChild(table);
  }

  // Wire up render callback
  renderCallback = renderResults;

  // Initial render with any existing results
  renderResults();

  return {
    dispose() {
      renderCallback = undefined;
      container.textContent = '';
    },
  };
}
