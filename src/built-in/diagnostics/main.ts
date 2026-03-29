// D3: Diagnostics panel — built-in panel tool for AI runtime health checks
// Pattern: Panel view contribution (same as indexing-log tool)

import './diagnostics.css';
import type { ToolContext } from '../../tools/toolModuleLoader.js';
import type { IDisposable } from '../../platform/lifecycle.js';
import { $ } from '../../ui/dom.js';
import type { IDiagnosticResult } from '../../services/serviceTypes.js';
import { IDiagnosticsService } from '../../services/serviceTypes.js';

// ── SVG Icons (Lucide spec: 24×24, stroke-width 2, round caps/joins) ────────

const ICON_PASS = `<svg viewBox="0 0 24 24" fill="none" stroke="var(--parallx-success-fg, #4ec9b0)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
const ICON_FAIL = `<svg viewBox="0 0 24 24" fill="none" stroke="var(--parallx-error-fg, #f44747)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
const ICON_WARN = `<svg viewBox="0 0 24 24" fill="none" stroke="var(--parallx-warning-fg, #cca700)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
const ICON_REFRESH = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15A9 9 0 1 1 21 12"/></svg>`;

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
    const icon = fail > 0 ? 'FAIL' : warn > 0 ? 'WARN' : 'PASS';
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
