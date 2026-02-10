// Tool Gallery — built-in tool for Parallx
//
// Shows all registered tools with status and contribution summary.
// Demonstrates: sidebar view container contribution, dynamic data, registry querying.

import type { ToolContext } from '../../tools/toolModuleLoader.js';
import type { IDisposable } from '../../platform/lifecycle.js';

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
  container.style.cssText = `
    display: flex; flex-direction: column; height: 100%;
    background: #1e1e1e; overflow: hidden;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  `;

  containerEl = container;

  // Header bar
  const header = document.createElement('div');
  header.style.cssText = `
    display: flex; align-items: center; gap: 6px; padding: 8px 12px;
    background: #252526; border-bottom: 1px solid #333; flex-shrink: 0;
  `;

  const title = document.createElement('span');
  title.style.cssText = 'color: #ccc; font-size: 12px; font-weight: 600; flex: 1; text-transform: uppercase;';
  title.textContent = 'Installed Tools';
  header.appendChild(title);

  const refreshBtn = document.createElement('button');
  refreshBtn.style.cssText = 'background: none; border: 1px solid #555; color: #ccc; font-size: 11px; padding: 2px 6px; cursor: pointer; border-radius: 3px;';
  refreshBtn.textContent = '↻ Refresh';
  refreshBtn.addEventListener('click', () => refresh());
  header.appendChild(refreshBtn);

  container.appendChild(header);

  // Tool list
  const list = document.createElement('div');
  list.style.cssText = 'flex: 1; overflow-y: auto; padding: 4px 0;';
  container.appendChild(list);

  // Detail panel (hidden by default)
  const detail = document.createElement('div');
  detail.style.cssText = `
    display: none; border-top: 1px solid #333; padding: 12px;
    background: #252526; max-height: 40%; overflow-y: auto; flex-shrink: 0;
  `;
  container.appendChild(detail);

  // Refresh logic
  function refresh(): void {
    const tools = api.tools.getAll();
    list.innerHTML = '';

    if (tools.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'padding: 20px; text-align: center; color: #666; font-size: 13px;';
      empty.textContent = 'No tools registered';
      list.appendChild(empty);
      return;
    }

    for (const tool of tools) {
      const row = document.createElement('div');
      row.style.cssText = `
        display: flex; align-items: center; gap: 10px; padding: 8px 12px;
        cursor: pointer; border-bottom: 1px solid #2a2a2a;
        transition: background 80ms ease;
      `;
      row.addEventListener('mouseenter', () => { row.style.background = '#2a2d2e'; });
      row.addEventListener('mouseleave', () => { row.style.background = 'transparent'; });

      // Icon
      const icon = document.createElement('span');
      icon.style.cssText = 'font-size: 20px; width: 28px; text-align: center; flex-shrink: 0;';
      icon.textContent = tool.isBuiltin ? '📦' : '🔌';
      row.appendChild(icon);

      // Info
      const info = document.createElement('div');
      info.style.cssText = 'flex: 1; min-width: 0;';

      const nameRow = document.createElement('div');
      nameRow.style.cssText = 'display: flex; align-items: baseline; gap: 6px;';
      const nameEl = document.createElement('span');
      nameEl.style.cssText = 'color: #e0e0e0; font-size: 13px; font-weight: 500;';
      nameEl.textContent = tool.name;
      nameRow.appendChild(nameEl);
      const versionEl = document.createElement('span');
      versionEl.style.cssText = 'color: #888; font-size: 11px;';
      versionEl.textContent = `v${tool.version}`;
      nameRow.appendChild(versionEl);
      if (tool.isBuiltin) {
        const badge = document.createElement('span');
        badge.style.cssText = 'color: #569cd6; font-size: 10px; border: 1px solid #569cd6; border-radius: 3px; padding: 0 3px;';
        badge.textContent = 'built-in';
        nameRow.appendChild(badge);
      }
      info.appendChild(nameRow);

      const descEl = document.createElement('div');
      descEl.style.cssText = 'color: #888; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';
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
  detail.style.display = 'block';
  detail.innerHTML = '';

  const h = document.createElement('div');
  h.style.cssText = 'font-size: 14px; font-weight: 600; color: #e0e0e0; margin-bottom: 8px;';
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
    row.style.cssText = 'display: flex; gap: 8px; padding: 2px 0; font-size: 12px;';
    const lbl = document.createElement('span');
    lbl.style.cssText = 'color: #888; min-width: 72px; flex-shrink: 0;';
    lbl.textContent = label;
    const val = document.createElement('span');
    val.style.cssText = 'color: #ccc; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';
    val.textContent = value;
    row.appendChild(lbl);
    row.appendChild(val);
    detail.appendChild(row);
  }

  // Close button
  const closeBtn = document.createElement('button');
  closeBtn.style.cssText = `
    margin-top: 10px; background: none; border: 1px solid #555; color: #ccc;
    font-size: 11px; padding: 3px 10px; cursor: pointer; border-radius: 3px;
  `;
  closeBtn.textContent = 'Close';
  closeBtn.addEventListener('click', () => { detail.style.display = 'none'; });
  detail.appendChild(closeBtn);
}
