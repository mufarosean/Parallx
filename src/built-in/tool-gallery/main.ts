// Tool Gallery — built-in tool for Parallx
//
// Shows all registered tools with status and contribution summary.
// Demonstrates: sidebar view container contribution, dynamic data, registry querying.

import type { ToolContext } from '../../tools/toolModuleLoader.js';
import type { IDisposable } from '../../platform/lifecycle.js';
import { hide, show } from '../../ui/dom.js';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ToolInfo {
  id: string;
  name: string;
  version: string;
  publisher: string;
  description: string;
  isBuiltin: boolean;
  toolPath: string;
}

interface ParallxApi {
  views: {
    registerViewProvider(viewId: string, provider: { createView(container: HTMLElement): IDisposable }, options?: { name?: string; icon?: string }): IDisposable;
  };
  commands: {
    registerCommand(id: string, handler: (...args: unknown[]) => unknown): IDisposable;
  };
  tools: {
    getAll(): ToolInfo[];
    getById(id: string): ToolInfo | undefined;
  };
}

// ─── State ───────────────────────────────────────────────────────────────────

let containerEl: HTMLElement | null = null;
let refreshFn: (() => void) | null = null;

// ─── Activation ──────────────────────────────────────────────────────────────

export function activate(api: ParallxApi, context: ToolContext): void {
  // Register the sidebar view provider
  const viewDisposable = api.views.registerViewProvider('view.tools', {
    createView(container: HTMLElement): IDisposable {
      return renderToolGallery(container, api);
    },
  }, { name: 'Installed Tools', icon: '🧩' });
  context.subscriptions.push(viewDisposable);

  // Register command to focus the tools view
  const showCmd = api.commands.registerCommand('tools.showInstalled', () => {
    // Refresh the list if the view is mounted
    refreshFn?.();
  });
  context.subscriptions.push(showCmd);
}

export function deactivate(): void {
  containerEl = null;
  refreshFn = null;
}

// ─── Rendering ───────────────────────────────────────────────────────────────

function renderToolGallery(container: HTMLElement, api: ParallxApi): IDisposable {
  container.classList.add('tool-gallery-container');

  containerEl = container;

  // Header bar
  const header = document.createElement('div');
  header.classList.add('tool-gallery-header');

  const title = document.createElement('span');
  title.classList.add('tool-gallery-header-title');
  title.textContent = 'Installed Tools';
  header.appendChild(title);

  const refreshBtn = document.createElement('button');
  refreshBtn.classList.add('tool-gallery-btn');
  refreshBtn.textContent = '↻ Refresh';
  refreshBtn.addEventListener('click', () => refresh());
  header.appendChild(refreshBtn);

  container.appendChild(header);

  // Tool list
  const list = document.createElement('div');
  list.classList.add('tool-gallery-list');
  container.appendChild(list);

  // Detail panel (hidden by default)
  const detail = document.createElement('div');
  detail.classList.add('tool-gallery-detail');
  container.appendChild(detail);

  // Refresh logic
  function refresh(): void {
    const tools = api.tools.getAll();
    list.innerHTML = '';

    if (tools.length === 0) {
      const empty = document.createElement('div');
      empty.classList.add('tool-gallery-empty');
      empty.textContent = 'No tools registered';
      list.appendChild(empty);
      return;
    }

    for (const tool of tools) {
      const row = document.createElement('div');
      row.classList.add('tool-gallery-row');

      // Icon
      const icon = document.createElement('span');
      icon.classList.add('tool-gallery-row-icon');
      icon.textContent = tool.isBuiltin ? '📦' : '🔌';
      row.appendChild(icon);

      // Info
      const info = document.createElement('div');
      info.classList.add('tool-gallery-row-info');

      const nameRow = document.createElement('div');
      nameRow.classList.add('tool-gallery-row-name-row');
      const nameEl = document.createElement('span');
      nameEl.classList.add('tool-gallery-row-name');
      nameEl.textContent = tool.name;
      nameRow.appendChild(nameEl);
      const versionEl = document.createElement('span');
      versionEl.classList.add('tool-gallery-row-version');
      versionEl.textContent = `v${tool.version}`;
      nameRow.appendChild(versionEl);
      if (tool.isBuiltin) {
        const badge = document.createElement('span');
        badge.classList.add('tool-gallery-row-badge');
        badge.textContent = 'built-in';
        nameRow.appendChild(badge);
      }
      info.appendChild(nameRow);

      const descEl = document.createElement('div');
      descEl.classList.add('tool-gallery-row-desc');
      descEl.textContent = tool.description || 'No description';
      info.appendChild(descEl);

      row.appendChild(info);

      // Click → show detail
      row.addEventListener('click', () => showDetail(tool, detail));

      list.appendChild(row);
    }
  }

  refreshFn = refresh;
  refresh();

  return {
    dispose() {
      containerEl = null;
      refreshFn = null;
      container.innerHTML = '';
    },
  };
}

function showDetail(tool: ToolInfo, detail: HTMLElement): void {
  show(detail, 'block');
  detail.innerHTML = '';

  const h = document.createElement('div');
  h.classList.add('tool-gallery-detail-name');
  h.textContent = tool.name;
  detail.appendChild(h);

  const fields: [string, string][] = [
    ['ID', tool.id],
    ['Version', tool.version],
    ['Publisher', tool.publisher],
    ['Built-in', tool.isBuiltin ? 'Yes' : 'No'],
    ['Path', tool.toolPath],
  ];
  if (tool.description) {
    fields.splice(3, 0, ['Description', tool.description]);
  }

  for (const [label, value] of fields) {
    const row = document.createElement('div');
    row.classList.add('tool-gallery-detail-field');
    const lbl = document.createElement('span');
    lbl.classList.add('tool-gallery-detail-label');
    lbl.textContent = label;
    const val = document.createElement('span');
    val.classList.add('tool-gallery-detail-value');
    val.textContent = value;
    row.appendChild(lbl);
    row.appendChild(val);
    detail.appendChild(row);
  }

  // Close button
  const closeBtn = document.createElement('button');
  closeBtn.classList.add('tool-gallery-btn');
  closeBtn.style.marginTop = '10px';
  closeBtn.textContent = 'Close';
  closeBtn.addEventListener('click', () => { hide(detail); });
  detail.appendChild(closeBtn);
}
