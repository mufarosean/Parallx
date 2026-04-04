// D3: Diagnostics panel — built-in panel tool for AI runtime health checks
// Pattern: Panel view contribution (same as indexing-log tool)

import './diagnostics.css';
import type { ToolContext } from '../../tools/toolModuleLoader.js';
import type { IDisposable } from '../../platform/lifecycle.js';
import { $ } from '../../ui/dom.js';
import type { IDiagnosticResult } from '../../services/serviceTypes.js';
import { IDiagnosticsService } from '../../services/serviceTypes.js';

import { getIcon } from '../../ui/iconRegistry.js';

// ── SVG Icons — from the central Lucide icon registry ────────────────────────

const ICON_PASS = getIcon('check')!;
const ICON_FAIL = getIcon('close')!;
const ICON_WARN = getIcon('alert-triangle')!;
const ICON_REFRESH = getIcon('refresh')!;

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
let _autoRefreshTimer: ReturnType<typeof setInterval> | undefined;

const AUTO_REFRESH_MS = 30_000; // 30 seconds

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

    // Live auto-refresh: re-run checks periodically
    _autoRefreshTimer = setInterval(() => {
      diagnosticsService?.runChecks().catch(() => {});
    }, AUTO_REFRESH_MS);
  }
}

export function deactivate(): void {
  if (_autoRefreshTimer) { clearInterval(_autoRefreshTimer); _autoRefreshTimer = undefined; }
  diagnosticsService = undefined;
  renderCallback = undefined;
}

// ── View renderer ────────────────────────────────────────────────────────────

/** Sort order: fail first, then warn, then pass. */
const STATUS_ORDER: Record<string, number> = { fail: 0, warn: 1, pass: 2 };

function renderDiagnosticsView(container: HTMLElement): IDisposable {
  container.classList.add('diagnostics-container');

  // Header — summary counts + refresh button
  const header = $('div.diagnostics-header');

  const badgeBar = $('span.diagnostics-badge-bar');
  header.appendChild(badgeBar);

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

  // Status line
  const statusLine = $('div.diagnostics-status');

  // Results list
  const listContainer = $('div.diagnostics-list');

  container.appendChild(header);
  container.appendChild(statusLine);
  container.appendChild(listContainer);

  function renderResults(): void {
    const results = [...currentResults].sort(
      (a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9),
    );

    // Badge bar counts
    const pass = results.filter(r => r.status === 'pass').length;
    const fail = results.filter(r => r.status === 'fail').length;
    const warn = results.filter(r => r.status === 'warn').length;
    badgeBar.innerHTML = '';
    const makeBadge = (count: number, label: string, cls: string): void => {
      const badge = $('span.diagnostics-badge');
      badge.classList.add(cls);
      badge.textContent = `${label}: ${count}`;
      badgeBar.appendChild(badge);
    };
    if (fail > 0) { makeBadge(fail, 'Fail', 'diagnostics-badge--fail'); }
    if (warn > 0) { makeBadge(warn, 'Warn', 'diagnostics-badge--warn'); }
    makeBadge(pass, 'Pass', 'diagnostics-badge--pass');

    // Status line
    const lastTime = results.length > 0
      ? new Date(Math.max(...results.map(r => r.timestamp))).toLocaleTimeString()
      : '—';
    statusLine.textContent = `Last checked: ${lastTime}`;

    // List
    listContainer.textContent = '';
    if (results.length === 0) {
      const empty = $('div.diagnostics-empty');
      empty.textContent = 'No diagnostic results yet. Click refresh to run checks.';
      listContainer.appendChild(empty);
      return;
    }

    for (const result of results) {
      const row = $('div.diagnostics-row');
      row.classList.add(`diagnostics-row--${result.status}`);

      const icon = $('span.diagnostics-row-icon');
      icon.innerHTML = result.status === 'pass' ? ICON_PASS : result.status === 'fail' ? ICON_FAIL : ICON_WARN;
      row.appendChild(icon);

      const name = $('span.diagnostics-row-name');
      name.textContent = result.name;
      row.appendChild(name);

      const detail = $('span.diagnostics-row-detail');
      detail.textContent = result.detail;
      row.appendChild(detail);

      listContainer.appendChild(row);
    }
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
