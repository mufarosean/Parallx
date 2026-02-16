// Tool Gallery — built-in tool for Parallx
//
// VS Code Extensions-style tool browser.
// Sidebar: search input with @-prefix filters, grouped tool list.
// Editor pane: detail page with header, tabs (Details, Feature Contributions, Status).
//
// References:
//   VS Code extensionsViewlet.ts — sidebar list, search, grouping
//   VS Code extensionEditor.ts — editor pane, header, tabs, contribution tables

import type { ToolContext } from '../../tools/toolModuleLoader.js';
import type { IDisposable } from '../../platform/lifecycle.js';
import { $, clearNode } from '../../ui/dom.js';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ToolContributions {
  commands?: { id: string; title: string; category?: string; icon?: string; keybinding?: string; when?: string }[];
  views?: { id: string; name: string; icon?: string; defaultContainerId?: string; when?: string }[];
  viewContainers?: { id: string; title: string; icon?: string; location?: string }[];
  configuration?: { title: string; properties: Record<string, { type: string; default?: unknown; description?: string; enum?: string[] }> }[];
  menus?: Record<string, { command: string; group?: string; when?: string }[]>;
  keybindings?: { command: string; key: string; when?: string }[];
  statusBar?: { id: string; name: string; text: string; tooltip?: string; command?: string; alignment: string; priority?: number }[];
}

interface ToolInfo {
  id: string;
  name: string;
  version: string;
  publisher: string;
  description: string;
  isBuiltin: boolean;
  toolPath: string;
  state: string;
  activationEvents: string[];
  contributes: ToolContributions;
}

interface ParallxApi {
  views: {
    registerViewProvider(viewId: string, provider: { createView(container: HTMLElement): IDisposable }, options?: { name?: string; icon?: string }): IDisposable;
  };
  commands: {
    registerCommand(id: string, handler: (...args: unknown[]) => unknown): IDisposable;
  };
  editors: {
    registerEditorProvider(typeId: string, provider: { createEditorPane(container: HTMLElement, input?: { id: string; name: string }): IDisposable }): IDisposable;
    openEditor(options: { typeId: string; title: string; icon?: string; instanceId?: string }): Promise<void>;
  };
  window: {
    showInformationMessage(message: string, ...actions: { title: string; isCloseAffordance?: boolean }[]): Promise<{ title: string } | undefined>;
    showErrorMessage(message: string, ...actions: { title: string; isCloseAffordance?: boolean }[]): Promise<{ title: string } | undefined>;
  };
  tools: {
    getAll(): ToolInfo[];
    getById(id: string): ToolInfo | undefined;
    isEnabled(toolId: string): boolean;
    setEnabled(toolId: string, enabled: boolean): Promise<void>;
    onDidChangeEnablement: (listener: (e: { toolId: string; enabled: boolean }) => void) => IDisposable;
    installFromFile(): Promise<{ toolId: string } | { error: string } | { canceled: true }>;
    uninstall(toolId: string): Promise<void>;
    onDidInstallTool: (listener: (e: { toolId: string }) => void) => IDisposable;
    onDidUninstallTool: (listener: (e: { toolId: string }) => void) => IDisposable;
  };
}

// ─── SVG Icon Constants ──────────────────────────────────────────────────────

/** Built-in tool icon — package/cube (codicon-package style, 16×16). */
const SVG_ICON_BUILTIN = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M14 4.5V14.5C14 15.33 13.33 16 12.5 16H3.5C2.67 16 2 15.33 2 14.5V1.5C2 0.67 2.67 0 3.5 0H9.5L14 4.5ZM9.5 1H3.5C3.22 1 3 1.22 3 1.5V14.5C3 14.78 3.22 15 3.5 15H12.5C12.78 15 13 14.78 13 14.5V5H10C9.72 5 9.5 4.78 9.5 4.5V1Z" fill="currentColor"/></svg>';

/** External tool icon — plug (codicon-plug style, 16×16). */
const SVG_ICON_EXTERNAL = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 1V5H5V1H6ZM11 1V5H10V1H11ZM3 6H13V8C13 9.86 11.72 11.41 10 11.87V15H6V11.87C4.28 11.41 3 9.86 3 8V6Z" fill="currentColor"/></svg>';

/** Large built-in tool icon for editor pane header (28×28). */
const SVG_ICON_BUILTIN_LG = '<svg width="28" height="28" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M14 4.5V14.5C14 15.33 13.33 16 12.5 16H3.5C2.67 16 2 15.33 2 14.5V1.5C2 0.67 2.67 0 3.5 0H9.5L14 4.5ZM9.5 1H3.5C3.22 1 3 1.22 3 1.5V14.5C3 14.78 3.22 15 3.5 15H12.5C12.78 15 13 14.78 13 14.5V5H10C9.72 5 9.5 4.78 9.5 4.5V1Z" fill="currentColor"/></svg>';

/** Large external tool icon for editor pane header (28×28). */
const SVG_ICON_EXTERNAL_LG = '<svg width="28" height="28" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 1V5H5V1H6ZM11 1V5H10V1H11ZM3 6H13V8C13 9.86 11.72 11.41 10 11.87V15H6V11.87C4.28 11.41 3 9.86 3 8V6Z" fill="currentColor"/></svg>';

/** Install/download icon for the install button (14×14). */
const SVG_ICON_INSTALL = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8.5 1V9.79L11.15 7.15L12 8L8 12L4 8L4.85 7.15L7.5 9.79V1H8.5ZM3 13H13V14H3V13Z" fill="currentColor"/></svg>';

// ─── State ───────────────────────────────────────────────────────────────────

let _sidebarRefresh: (() => void) | null = null;

// ─── Activation ──────────────────────────────────────────────────────────────

export function activate(api: ParallxApi, context: ToolContext): void {
  // Register the editor provider for tool detail pages
  const editorDisposable = api.editors.registerEditorProvider('tool-detail', {
    createEditorPane(container: HTMLElement, input?: { id: string; name: string }): IDisposable {
      const toolId = input?.id;
      if (!toolId) {
        container.textContent = 'No tool selected';
        return { dispose() {} };
      }
      return renderToolEditor(container, api, toolId);
    },
  });
  context.subscriptions.push(editorDisposable);

  // Register the sidebar view provider
  const viewDisposable = api.views.registerViewProvider('view.tools', {
    createView(container: HTMLElement): IDisposable {
      return renderToolSidebar(container, api);
    },
  }, { name: 'Installed Tools', icon: '🧩' });
  context.subscriptions.push(viewDisposable);

  // Command to refresh the sidebar
  const showCmd = api.commands.registerCommand('tools.showInstalled', () => {
    _sidebarRefresh?.();
  });
  context.subscriptions.push(showCmd);
}

export function deactivate(): void {
  _sidebarRefresh = null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SIDEBAR VIEW — search input, grouped tool list
// ═══════════════════════════════════════════════════════════════════════════════

type FilterMode = 'installed' | 'enabled' | 'disabled' | 'builtin' | 'search';

function renderToolSidebar(container: HTMLElement, api: ParallxApi): IDisposable {
  container.classList.add('tool-gallery-container');

  // ── Search bar with install action ──
  const searchWrap = $('div');
  searchWrap.classList.add('tool-gallery-search');
  const searchInput = $('input') as HTMLInputElement;
  searchInput.classList.add('tool-gallery-search-input');
  searchInput.type = 'text';
  searchInput.placeholder = 'Search tools…  (@enabled, @disabled, @builtin)';
  searchInput.spellcheck = false;
  searchWrap.appendChild(searchInput);

  const installBtn = $('button');
  installBtn.classList.add('tool-gallery-install-btn');
  installBtn.innerHTML = SVG_ICON_INSTALL;
  installBtn.title = 'Install from .plx file';
  installBtn.addEventListener('click', async () => {
    installBtn.disabled = true;
    try {
      const result = await api.tools.installFromFile();
      if ('canceled' in result) {
        // User cancelled — no action needed
      } else if ('error' in result) {
        await api.window.showErrorMessage(`Installation failed: ${result.error}`);
      } else {
        await api.window.showInformationMessage(`Tool installed successfully.`);
        const tool = api.tools.getById(result.toolId);
        if (tool) {
          api.editors.openEditor({
            typeId: 'tool-detail',
            title: tool.name,
            icon: 'plug',
            instanceId: tool.id,
          }).catch(() => {});
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      await api.window.showErrorMessage(`Installation failed: ${msg}`);
    } finally {
      installBtn.disabled = false;
    }
  });
  searchWrap.appendChild(installBtn);

  container.appendChild(searchWrap);

  // ── Tool list ──
  const list = $('div');
  list.classList.add('tool-gallery-list');
  container.appendChild(list);

  // ── State ──
  let currentFilter: FilterMode = 'installed';
  let searchText = '';
  const collapsedGroups = new Set<string>();

  // ── Parse search text ──
  function parseSearch(raw: string): { filter: FilterMode; text: string } {
    const trimmed = raw.trim();
    if (trimmed.startsWith('@enabled')) return { filter: 'enabled', text: trimmed.slice(8).trim() };
    if (trimmed.startsWith('@disabled')) return { filter: 'disabled', text: trimmed.slice(9).trim() };
    if (trimmed.startsWith('@builtin')) return { filter: 'builtin', text: trimmed.slice(8).trim() };
    if (trimmed.startsWith('@installed')) return { filter: 'installed', text: trimmed.slice(10).trim() };
    if (trimmed.length > 0) return { filter: 'search', text: trimmed };
    return { filter: 'installed', text: '' };
  }

  // ── Filter tools ──
  function filterTools(tools: ToolInfo[]): ToolInfo[] {
    let result = tools;
    switch (currentFilter) {
      case 'enabled':
        result = tools.filter(t => api.tools.isEnabled(t.id));
        break;
      case 'disabled':
        result = tools.filter(t => !api.tools.isEnabled(t.id));
        break;
      case 'builtin':
        result = tools.filter(t => t.isBuiltin);
        break;
    }
    if (searchText) {
      const lower = searchText.toLowerCase();
      result = result.filter(t =>
        t.name.toLowerCase().includes(lower) ||
        t.description.toLowerCase().includes(lower) ||
        t.id.toLowerCase().includes(lower) ||
        t.publisher.toLowerCase().includes(lower),
      );
    }
    return result;
  }

  // ── Render a tool row ──
  function createToolRow(tool: ToolInfo): HTMLElement {
    const enabled = api.tools.isEnabled(tool.id);

    const row = $('div');
    row.classList.add('tool-gallery-row');
    if (!enabled) row.classList.add('tool-gallery-row-disabled');

    // Icon
    const icon = $('span');
    icon.classList.add('tool-gallery-row-icon');
    icon.innerHTML = tool.isBuiltin ? SVG_ICON_BUILTIN : SVG_ICON_EXTERNAL;
    row.appendChild(icon);

    // Info
    const info = $('div');
    info.classList.add('tool-gallery-row-info');

    // Name row
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

    // Publisher
    const publisherEl = $('div');
    publisherEl.classList.add('tool-gallery-row-publisher');
    publisherEl.textContent = tool.publisher;
    info.appendChild(publisherEl);

    // Description
    const descEl = $('div');
    descEl.classList.add('tool-gallery-row-desc');
    descEl.textContent = tool.description || 'No description';
    info.appendChild(descEl);

    row.appendChild(info);

    // Enable/Disable toggle
    const toggle = $('button');
    toggle.classList.add('tool-gallery-toggle');
    if (tool.isBuiltin) {
      toggle.textContent = 'Disable';
      toggle.title = 'Built-in tools cannot be disabled';
      toggle.disabled = true;
      toggle.classList.add('tool-gallery-toggle-builtin');
    } else {
      toggle.textContent = enabled ? 'Disable' : 'Enable';
      toggle.title = enabled ? `Disable ${tool.name}` : `Enable ${tool.name}`;
      if (!enabled) toggle.classList.add('tool-gallery-toggle-enable');
      toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        toggle.disabled = true;
        toggle.textContent = '…';
        api.tools.setEnabled(tool.id, !enabled).catch((err: unknown) => {
          console.error(`[ToolGallery] Toggle failed for "${tool.id}":`, err);
          toggle.disabled = false;
          toggle.textContent = enabled ? 'Disable' : 'Enable';
        });
      });
    }
    row.appendChild(toggle);

    // Click → open editor
    row.addEventListener('click', () => {
      api.editors.openEditor({
        typeId: 'tool-detail',
        title: tool.name,
        icon: tool.isBuiltin ? 'package' : 'plug',
        instanceId: tool.id,
      }).catch((err: unknown) => {
        console.error(`[ToolGallery] Failed to open tool editor for "${tool.id}":`, err);
      });
    });

    return row;
  }

  // ── Render a group header ──
  function createGroupHeader(label: string, count: number, groupKey: string): HTMLElement {
    const header = $('div');
    header.classList.add('tool-gallery-group-header');
    const collapsed = collapsedGroups.has(groupKey);
    if (collapsed) header.classList.add('tool-gallery-group-collapsed');

    const arrow = $('span');
    arrow.classList.add('tool-gallery-group-arrow');
    arrow.textContent = collapsed ? '▶' : '▼';
    header.appendChild(arrow);

    const text = $('span');
    text.classList.add('tool-gallery-group-label');
    text.textContent = `${label} (${count})`;
    header.appendChild(text);

    header.addEventListener('click', () => {
      if (collapsedGroups.has(groupKey)) {
        collapsedGroups.delete(groupKey);
      } else {
        collapsedGroups.add(groupKey);
      }
      refresh();
    });

    return header;
  }

  // ── Refresh ──
  function refresh(): void {
    const tools = filterTools(api.tools.getAll());
    clearNode(list);

    if (tools.length === 0) {
      const empty = $('div');
      empty.classList.add('tool-gallery-empty');
      empty.textContent = currentFilter === 'installed' && !searchText
        ? 'No tools registered'
        : 'No matching tools';
      list.appendChild(empty);
      return;
    }

    // Group by enabled/disabled when in "installed" mode
    if (currentFilter === 'installed' && !searchText) {
      const enabled = tools.filter(t => api.tools.isEnabled(t.id));
      const disabled = tools.filter(t => !api.tools.isEnabled(t.id));

      if (enabled.length > 0) {
        list.appendChild(createGroupHeader('Enabled', enabled.length, 'enabled'));
        if (!collapsedGroups.has('enabled')) {
          for (const tool of enabled) {
            list.appendChild(createToolRow(tool));
          }
        }
      }

      if (disabled.length > 0) {
        list.appendChild(createGroupHeader('Disabled', disabled.length, 'disabled'));
        if (!collapsedGroups.has('disabled')) {
          for (const tool of disabled) {
            list.appendChild(createToolRow(tool));
          }
        }
      }
    } else {
      // Flat list for filtered views
      for (const tool of tools) {
        list.appendChild(createToolRow(tool));
      }
    }
  }

  // ── Search event ──
  searchInput.addEventListener('input', () => {
    const parsed = parseSearch(searchInput.value);
    currentFilter = parsed.filter;
    searchText = parsed.text;
    refresh();
  });

  // Listen for enablement changes
  const enablementListener = api.tools.onDidChangeEnablement(() => { refresh(); });

  // Listen for tool install/uninstall events to auto-refresh
  const installListener = api.tools.onDidInstallTool(() => { refresh(); });
  const uninstallListener = api.tools.onDidUninstallTool(() => { refresh(); });

  _sidebarRefresh = refresh;
  refresh();

  return {
    dispose() {
      _sidebarRefresh = null;
      enablementListener.dispose();
      installListener.dispose();
      uninstallListener.dispose();
      container.innerHTML = '';
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// TOOL EDITOR PANE — detail page opened in the editor area
// ═══════════════════════════════════════════════════════════════════════════════

function renderToolEditor(container: HTMLElement, api: ParallxApi, toolId: string): IDisposable {
  container.classList.add('tool-editor');

  const tool = api.tools.getById(toolId);
  if (!tool) {
    const msg = $('div');
    msg.classList.add('tool-editor-empty');
    msg.textContent = `Tool "${toolId}" not found.`;
    container.appendChild(msg);
    return { dispose() { container.innerHTML = ''; } };
  }

  const enabled = api.tools.isEnabled(tool.id);

  // ── Header ──
  const header = $('div');
  header.classList.add('tool-editor-header');

  const iconEl = $('div');
  iconEl.classList.add('tool-editor-header-icon');
  iconEl.innerHTML = tool.isBuiltin ? SVG_ICON_BUILTIN_LG : SVG_ICON_EXTERNAL_LG;
  header.appendChild(iconEl);

  const headerDetails = $('div');
  headerDetails.classList.add('tool-editor-header-details');

  const nameEl = $('div');
  nameEl.classList.add('tool-editor-header-name');
  nameEl.textContent = tool.name;
  headerDetails.appendChild(nameEl);

  const subtitleEl = $('div');
  subtitleEl.classList.add('tool-editor-header-subtitle');
  const parts: string[] = [tool.id, `v${tool.version}`, tool.publisher];
  if (tool.isBuiltin) parts.push('built-in');
  subtitleEl.textContent = parts.join(' · ');
  headerDetails.appendChild(subtitleEl);

  if (tool.description) {
    const descEl = $('div');
    descEl.classList.add('tool-editor-header-desc');
    descEl.textContent = tool.description;
    headerDetails.appendChild(descEl);
  }

  // Action buttons
  const actions = $('div');
  actions.classList.add('tool-editor-header-actions');

  const toggleBtn = $('button');
  toggleBtn.classList.add('tool-editor-action-btn');
  if (tool.isBuiltin) {
    toggleBtn.textContent = 'Disable';
    toggleBtn.title = 'Built-in tools cannot be disabled';
    toggleBtn.disabled = true;
    toggleBtn.classList.add('tool-editor-action-builtin');
  } else {
    toggleBtn.textContent = enabled ? 'Disable' : 'Enable';
    if (!enabled) toggleBtn.classList.add('tool-editor-action-enable');
    toggleBtn.addEventListener('click', () => {
      toggleBtn.disabled = true;
      toggleBtn.textContent = '…';
      api.tools.setEnabled(tool.id, !enabled).catch((err: unknown) => {
        console.error(`[ToolGallery] Toggle failed for "${tool.id}":`, err);
        toggleBtn.disabled = false;
        toggleBtn.textContent = enabled ? 'Disable' : 'Enable';
      });
    });
  }
  actions.appendChild(toggleBtn);

  // Uninstall button (only for external tools)
  if (!tool.isBuiltin) {
    const uninstallBtn = $('button');
    uninstallBtn.classList.add('tool-editor-action-btn', 'tool-editor-action-uninstall');
    uninstallBtn.textContent = 'Uninstall';
    uninstallBtn.title = `Uninstall ${tool.name}`;
    uninstallBtn.addEventListener('click', async () => {
      uninstallBtn.disabled = true;
      uninstallBtn.textContent = 'Uninstalling…';
      try {
        await api.tools.uninstall(tool.id);
        await api.window.showInformationMessage(`"${tool.name}" has been uninstalled.`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        await api.window.showErrorMessage(`Uninstall failed: ${msg}`);
        uninstallBtn.disabled = false;
        uninstallBtn.textContent = 'Uninstall';
      }
    });
    actions.appendChild(uninstallBtn);
  }

  headerDetails.appendChild(actions);
  header.appendChild(headerDetails);
  container.appendChild(header);

  // ── Tab bar ──
  const tabs = ['Details', 'Feature Contributions', 'Runtime Status'] as const;
  type TabId = typeof tabs[number];
  let activeTab: TabId = 'Details';

  const navbar = $('div');
  navbar.classList.add('tool-editor-navbar');

  const tabButtons: HTMLElement[] = [];
  for (const tab of tabs) {
    const btn = $('div');
    btn.classList.add('tool-editor-tab');
    if (tab === activeTab) btn.classList.add('tool-editor-tab-active');
    btn.textContent = tab;
    btn.addEventListener('click', () => {
      activeTab = tab;
      for (const b of tabButtons) b.classList.remove('tool-editor-tab-active');
      btn.classList.add('tool-editor-tab-active');
      renderTabContent();
    });
    navbar.appendChild(btn);
    tabButtons.push(btn);
  }
  container.appendChild(navbar);

  // ── Tab content area ──
  const content = $('div');
  content.classList.add('tool-editor-content');
  container.appendChild(content);

  function renderTabContent(): void {
    clearNode(content);
    switch (activeTab) {
      case 'Details':
        renderDetailsTab(content, tool);
        break;
      case 'Feature Contributions':
        renderContributionsTab(content, tool);
        break;
      case 'Runtime Status':
        renderStatusTab(content, tool);
        break;
    }
  }

  renderTabContent();

  // Re-render on enablement change
  const enablementListener = api.tools.onDidChangeEnablement((e) => {
    if (e.toolId === toolId) {
      // Re-render the whole editor to reflect new state
      container.innerHTML = '';
      renderToolEditor(container, api, toolId);
    }
  });

  return {
    dispose() {
      enablementListener.dispose();
      container.innerHTML = '';
    },
  };
}

// ─── Details Tab ─────────────────────────────────────────────────────────────

function renderDetailsTab(container: HTMLElement, tool: ToolInfo): void {
  const section = $('div');
  section.classList.add('tool-editor-details');

  if (tool.description) {
    const desc = $('div');
    desc.classList.add('tool-editor-details-desc');
    desc.textContent = tool.description;
    section.appendChild(desc);
  }

  const fields: [string, string][] = [
    ['Publisher', tool.publisher],
    ['Version', tool.version],
    ['Tool ID', tool.id],
    ['Built-in', tool.isBuiltin ? 'Yes' : 'No'],
    ['State', tool.state],
    ['Path', tool.toolPath],
  ];

  const table = $('div');
  table.classList.add('tool-editor-details-table');
  for (const [label, value] of fields) {
    const row = $('div');
    row.classList.add('tool-editor-details-row');

    const lbl = $('span');
    lbl.classList.add('tool-editor-details-label');
    lbl.textContent = label;
    row.appendChild(lbl);

    const val = $('span');
    val.classList.add('tool-editor-details-value');
    val.textContent = value;
    row.appendChild(val);

    table.appendChild(row);
  }
  section.appendChild(table);

  container.appendChild(section);
}

// ─── Feature Contributions Tab ───────────────────────────────────────────────

function renderContributionsTab(container: HTMLElement, tool: ToolInfo): void {
  const contrib = tool.contributes;
  if (!contrib) {
    renderEmptyMessage(container, 'No contributions declared.');
    return;
  }

  let hasAny = false;

  // Commands
  if (contrib.commands && contrib.commands.length > 0) {
    hasAny = true;
    renderContributionSection(container, 'Commands', contrib.commands.length, () => {
      return createTable(
        ['Title', 'Command ID', 'Category'],
        contrib.commands!.map(c => [c.title, c.id, c.category ?? '']),
      );
    });
  }

  // Views
  if (contrib.views && contrib.views.length > 0) {
    hasAny = true;
    renderContributionSection(container, 'Views', contrib.views.length, () => {
      return createTable(
        ['Name', 'View ID', 'Container'],
        contrib.views!.map(v => [v.name, v.id, v.defaultContainerId ?? '']),
      );
    });
  }

  // View Containers
  if (contrib.viewContainers && contrib.viewContainers.length > 0) {
    hasAny = true;
    renderContributionSection(container, 'View Containers', contrib.viewContainers.length, () => {
      return createTable(
        ['Title', 'Container ID', 'Location'],
        contrib.viewContainers!.map(vc => [vc.title, vc.id, vc.location ?? '']),
      );
    });
  }

  // Configuration
  if (contrib.configuration && contrib.configuration.length > 0) {
    hasAny = true;
    for (const config of contrib.configuration) {
      const props = Object.entries(config.properties ?? {});
      if (props.length === 0) continue;
      renderContributionSection(container, `Configuration: ${config.title}`, props.length, () => {
        return createTable(
          ['Name', 'Type', 'Default', 'Description'],
          props.map(([name, prop]) => [
            name,
            prop.type,
            prop.default !== undefined ? String(prop.default) : '',
            prop.description ?? '',
          ]),
        );
      });
    }
  }

  // Keybindings
  if (contrib.keybindings && contrib.keybindings.length > 0) {
    hasAny = true;
    renderContributionSection(container, 'Keybindings', contrib.keybindings.length, () => {
      return createTable(
        ['Command', 'Key', 'When'],
        contrib.keybindings!.map(k => [k.command, k.key, k.when ?? '']),
      );
    });
  }

  // Menus
  if (contrib.menus) {
    const entries = Object.entries(contrib.menus);
    if (entries.length > 0) {
      hasAny = true;
      const allItems: [string, string, string][] = [];
      for (const [location, items] of entries) {
        for (const item of items) {
          allItems.push([location, item.command, item.when ?? '']);
        }
      }
      renderContributionSection(container, 'Menus', allItems.length, () => {
        return createTable(['Location', 'Command', 'When'], allItems);
      });
    }
  }

  // Status Bar
  if (contrib.statusBar && contrib.statusBar.length > 0) {
    hasAny = true;
    renderContributionSection(container, 'Status Bar', contrib.statusBar.length, () => {
      return createTable(
        ['Name', 'Text', 'Alignment', 'Command'],
        contrib.statusBar!.map(s => [s.name, s.text, s.alignment, s.command ?? '']),
      );
    });
  }

  if (!hasAny) {
    renderEmptyMessage(container, 'No contributions declared.');
  }
}

// ─── Runtime Status Tab ──────────────────────────────────────────────────────

function renderStatusTab(container: HTMLElement, tool: ToolInfo): void {
  const section = $('div');
  section.classList.add('tool-editor-status');

  const fields: [string, string][] = [
    ['State', tool.state],
    ['Activation Events', (tool.activationEvents ?? []).join(', ') || 'none'],
    ['Tool Path', tool.toolPath],
    ['Built-in', tool.isBuiltin ? 'Yes' : 'No'],
  ];

  for (const [label, value] of fields) {
    const row = $('div');
    row.classList.add('tool-editor-status-row');

    const lbl = $('span');
    lbl.classList.add('tool-editor-status-label');
    lbl.textContent = label;
    row.appendChild(lbl);

    const val = $('span');
    val.classList.add('tool-editor-status-value');
    val.textContent = value;
    row.appendChild(val);

    section.appendChild(row);
  }

  // State indicator
  const stateIndicator = $('div');
  stateIndicator.classList.add('tool-editor-status-indicator');
  const dot = $('span');
  dot.classList.add('tool-editor-status-dot');
  if (tool.state === 'activated') {
    dot.classList.add('tool-editor-status-dot-active');
  } else if (tool.state === 'deactivated' || tool.state === 'disposed') {
    dot.classList.add('tool-editor-status-dot-inactive');
  } else {
    dot.classList.add('tool-editor-status-dot-pending');
  }
  stateIndicator.appendChild(dot);
  const stateText = $('span');
  stateText.textContent = tool.state === 'activated' ? 'Active' :
    tool.state === 'deactivated' ? 'Inactive' :
    tool.state === 'disposed' ? 'Disposed' : 'Pending';
  stateIndicator.appendChild(stateText);
  section.insertBefore(stateIndicator, section.firstChild);

  container.appendChild(section);
}

// ─── Shared Helpers ──────────────────────────────────────────────────────────

/** Render a collapsible contribution section with header and lazy content. */
function renderContributionSection(
  container: HTMLElement,
  title: string,
  count: number,
  buildContent: () => HTMLElement,
): void {
  const section = $('div');
  section.classList.add('tool-editor-contrib-section');

  const header = $('div');
  header.classList.add('tool-editor-contrib-header');

  const arrow = $('span');
  arrow.classList.add('tool-editor-contrib-arrow');
  arrow.textContent = '▼';
  header.appendChild(arrow);

  const label = $('span');
  label.classList.add('tool-editor-contrib-label');
  label.textContent = `${title} (${count})`;
  header.appendChild(label);

  section.appendChild(header);

  const body = $('div');
  body.classList.add('tool-editor-contrib-body');
  body.appendChild(buildContent());
  section.appendChild(body);

  let collapsed = false;
  header.addEventListener('click', () => {
    collapsed = !collapsed;
    arrow.textContent = collapsed ? '▶' : '▼';
    body.style.display = collapsed ? 'none' : '';
  });

  container.appendChild(section);
}

/** Create a simple HTML table. */
function createTable(headers: string[], rows: string[][]): HTMLElement {
  const table = $('table');
  table.classList.add('tool-editor-table');

  const thead = $('thead');
  const headerRow = $('tr');
  for (const h of headers) {
    const th = $('th');
    th.textContent = h;
    headerRow.appendChild(th);
  }
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = $('tbody');
  for (const row of rows) {
    const tr = $('tr');
    for (const cell of row) {
      const td = $('td');
      td.textContent = cell;
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);

  return table;
}

/** Render an empty/placeholder message. */
function renderEmptyMessage(container: HTMLElement, text: string): void {
  const msg = $('div');
  msg.classList.add('tool-editor-empty');
  msg.textContent = text;
  container.appendChild(msg);
}
