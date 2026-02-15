// Tool Gallery — built-in tool for Parallx
//
// Shows all registered tools with status and contribution summary.
// Includes enable/disable toggle for non-built-in tools (M6 Capability 0).
// Demonstrates: sidebar view container contribution, dynamic data, registry querying.

import type { ToolContext } from '../../tools/toolModuleLoader.js';
import type { IDisposable } from '../../platform/lifecycle.js';
import { $,  hide, show } from '../../ui/dom.js';

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
    isEnabled(toolId: string): boolean;
    setEnabled(toolId: string, enabled: boolean): Promise<void>;
    onDidChangeEnablement: (listener: (e: { toolId: string; enabled: boolean }) => void) => IDisposable;
  };
}

// ─── State ───────────────────────────────────────────────────────────────────

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
  refreshFn = null;
}

// ─── Rendering ───────────────────────────────────────────────────────────────

function renderToolGallery(container: HTMLElement, api: ParallxApi): IDisposable {
  container.classList.add('tool-gallery-container');

  // Header bar
  const header = $('div');
  header.classList.add('tool-gallery-header');

  const title = $('span');
  title.classList.add('tool-gallery-header-title');
  title.textContent = 'Installed Tools';
  header.appendChild(title);

  const refreshBtn = $('button');
  refreshBtn.classList.add('tool-gallery-btn');
  refreshBtn.textContent = '↻ Refresh';
  refreshBtn.addEventListener('click', () => refresh());
  header.appendChild(refreshBtn);

  container.appendChild(header);

  // Tool list
  const list = $('div');
  list.classList.add('tool-gallery-list');
  container.appendChild(list);

  // Detail panel (hidden by default)
  const detail = $('div');
  detail.classList.add('tool-gallery-detail');
  container.appendChild(detail);

  // Refresh logic
  function refresh(): void {
    const tools = api.tools.getAll();
    list.innerHTML = '';

    if (tools.length === 0) {
      const empty = $('div');
      empty.classList.add('tool-gallery-empty');
      empty.textContent = 'No tools registered';
      list.appendChild(empty);
      return;
    }

    for (const tool of tools) {
      const enabled = api.tools.isEnabled(tool.id);

      const row = $('div');
      row.classList.add('tool-gallery-row');
      if (!enabled) {
        row.classList.add('tool-gallery-row-disabled');
      }

      // Icon
      const icon = $('span');
      icon.classList.add('tool-gallery-row-icon');
      icon.textContent = tool.isBuiltin ? '📦' : '🔌';
      row.appendChild(icon);

      // Info
      const info = $('div');
      info.classList.add('tool-gallery-row-info');

      const nameRow = $('div');
      nameRow.classList.add('tool-gallery-row-name-row');
      const nameEl = $('span');
      nameEl.classList.add('tool-gallery-row-name');
      nameEl.textContent = tool.name;
      nameRow.appendChild(nameEl);
      const versionEl = $('span');
      versionEl.classList.add('tool-gallery-row-version');
      versionEl.textContent = `v${tool.version}`;
      nameRow.appendChild(versionEl);
      if (tool.isBuiltin) {
        const badge = $('span');
        badge.classList.add('tool-gallery-row-badge');
        badge.textContent = 'built-in';
        nameRow.appendChild(badge);
      }
      if (!enabled) {
        const disabledBadge = $('span');
        disabledBadge.classList.add('tool-gallery-row-badge', 'tool-gallery-row-badge-disabled');
        disabledBadge.textContent = 'disabled';
        nameRow.appendChild(disabledBadge);
      }
      info.appendChild(nameRow);

      const descEl = $('div');
      descEl.classList.add('tool-gallery-row-desc');
      descEl.textContent = tool.description || 'No description';
      info.appendChild(descEl);

      row.appendChild(info);

      // Enable/Disable toggle (only for non-built-in tools)
      if (!tool.isBuiltin) {
        const toggle = $('button');
        toggle.classList.add('tool-gallery-toggle');
        toggle.textContent = enabled ? 'Disable' : 'Enable';
        toggle.title = enabled ? `Disable ${tool.name}` : `Enable ${tool.name}`;
        if (!enabled) {
          toggle.classList.add('tool-gallery-toggle-enable');
        }
        toggle.addEventListener('click', (e) => {
          e.stopPropagation(); // Don't trigger row click
          toggle.disabled = true;
          toggle.textContent = '…';
          api.tools.setEnabled(tool.id, !enabled).catch((err: unknown) => {
            console.error(`[ToolGallery] Toggle failed for "${tool.id}":`, err);
            toggle.disabled = false;
            toggle.textContent = enabled ? 'Disable' : 'Enable';
          });
        });
        row.appendChild(toggle);
      }

      // Click → show detail
      row.addEventListener('click', () => showDetail(tool, detail, api));

      list.appendChild(row);
    }
  }

  // Listen for enablement changes to refresh the list reactively
  const enablementListener = api.tools.onDidChangeEnablement(() => {
    refresh();
  });

  refreshFn = refresh;
  refresh();

  return {
    dispose() {
      refreshFn = null;
      enablementListener.dispose();
      container.innerHTML = '';
    },
  };
}

function showDetail(tool: ToolInfo, detail: HTMLElement, api: ParallxApi): void {
  show(detail, 'block');
  detail.innerHTML = '';

  const h = $('div');
  h.classList.add('tool-gallery-detail-name');
  h.textContent = tool.name;
  detail.appendChild(h);

  const enabled = api.tools.isEnabled(tool.id);
  const fields: [string, string][] = [
    ['ID', tool.id],
    ['Version', tool.version],
    ['Publisher', tool.publisher],
    ['Built-in', tool.isBuiltin ? 'Yes' : 'No'],
    ['Status', enabled ? 'Enabled' : 'Disabled'],
    ['Path', tool.toolPath],
  ];
  if (tool.description) {
    fields.splice(3, 0, ['Description', tool.description]);
  }

  for (const [label, value] of fields) {
    const row = $('div');
    row.classList.add('tool-gallery-detail-field');
    const lbl = $('span');
    lbl.classList.add('tool-gallery-detail-label');
    lbl.textContent = label;
    const val = $('span');
    val.classList.add('tool-gallery-detail-value');
    val.textContent = value;
    row.appendChild(lbl);
    row.appendChild(val);
    detail.appendChild(row);
  }

  // Enable/Disable button in detail panel (only for non-built-in)
  if (!tool.isBuiltin) {
    const toggleBtn = $('button');
    toggleBtn.classList.add('tool-gallery-btn', 'tool-gallery-detail-toggle');
    toggleBtn.textContent = enabled ? 'Disable Tool' : 'Enable Tool';
    if (!enabled) {
      toggleBtn.classList.add('tool-gallery-toggle-enable');
    }
    toggleBtn.addEventListener('click', () => {
      toggleBtn.disabled = true;
      toggleBtn.textContent = '…';
      api.tools.setEnabled(tool.id, !enabled).catch((err: unknown) => {
        console.error(`[ToolGallery] Toggle failed for "${tool.id}":`, err);
        toggleBtn.disabled = false;
        toggleBtn.textContent = enabled ? 'Disable Tool' : 'Enable Tool';
      });
    });
    detail.appendChild(toggleBtn);
  }

  // Close button
  const closeBtn = $('button');
  closeBtn.classList.add('tool-gallery-btn', 'tool-gallery-detail-close');
  closeBtn.textContent = 'Close';
  closeBtn.addEventListener('click', () => { hide(detail); });
  detail.appendChild(closeBtn);
}
