// Tool Gallery — built-in tool for Parallx
//
// VS Code Extensions-style tool browser.
// Sidebar: search input with @-prefix filters, grouped tool list.
// Editor pane: detail page with header, tabs (Details, Feature Contributions, Status).
//
// References:
//   VS Code extensionsViewlet.ts — sidebar list, search, grouping
//   VS Code extensionEditor.ts — editor pane, header, tabs, contribution tables

import './toolGallery.css';
import type { ToolContext } from '../../tools/toolModuleLoader.js';
import type { IDisposable } from '../../platform/lifecycle.js';
import { $, clearNode } from '../../ui/dom.js';
import { getIcon } from '../../ui/iconRegistry.js';
import { renderEmptyState } from '../../ui/emptyStates.js';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ToolContributions {
  commands?: { id: string; title: string; category?: string; icon?: string; keybinding?: string; when?: string }[];
  views?: { id: string; name: string; icon?: string; defaultContainerId?: string; when?: string }[];
  viewContainers?: { id: string; title: string; icon?: string; location?: string; hidden?: boolean }[];
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
    executeCommand<T = unknown>(id: string, ...args: unknown[]): Promise<T>;
  };
  editors: {
    registerEditorProvider(typeId: string, provider: { createEditorPane(container: HTMLElement, input?: { id: string; name: string }): IDisposable }): IDisposable;
    openEditor(options: { typeId: string; title: string; icon?: string; instanceId?: string }): Promise<void>;
  };
  window: {
    showInformationMessage(message: string, ...actions: { title: string; isCloseAffordance?: boolean }[]): Promise<{ title: string } | undefined>;
    showWarningMessage(message: string, ...actions: { title: string; isCloseAffordance?: boolean }[]): Promise<{ title: string } | undefined>;
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
    onDidChangeTools: (listener: () => void) => IDisposable;
  };
  workspace: {
    workspaceFolders?: readonly { uri: string; name: string; index: number }[];
    fs?: {
      exists(uri: string): Promise<boolean>;
      delete(uri: string): Promise<void>;
    };
  };
}

// ─── SVG Icon Constants — from the central Lucide icon registry ──────────────

/** Built-in tool icon — package/cube. */
const SVG_ICON_BUILTIN = getIcon('package')!;

/** External tool icon — plug connector. */
const SVG_ICON_EXTERNAL = getIcon('plug')!;

/** Large built-in tool icon for editor pane header. */
const SVG_ICON_BUILTIN_LG = SVG_ICON_BUILTIN;

/** Large external tool icon for editor pane header. */
const SVG_ICON_EXTERNAL_LG = SVG_ICON_EXTERNAL;

/** Install/download icon for the install button. */
const SVG_ICON_INSTALL = getIcon('export')!;

// ─── State ───────────────────────────────────────────────────────────────────

let _sidebarRefresh: (() => void) | null = null;

// ─── Activation ──────────────────────────────────────────────────────────────

export function activate(api: ParallxApi, context: ToolContext): void {
  // Register the editor provider for tool detail pages
  const editorDisposable = api.editors.registerEditorProvider('tool-detail', {
    createEditorPane(container: HTMLElement, input?: { id: string; name: string; instanceId?: string }): IDisposable {
      const toolId = input?.instanceId ?? input?.id;
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
  }, { name: 'Installed Tools', icon: 'puzzle' });
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
        await api.window.showInformationMessage(`Tool installed successfully. Enable it to start using it.`);
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
    // Registered Lucide glyphs, never text symbols.
    arrow.innerHTML = getIcon(collapsed ? 'chevron-right' : 'chevron-down');
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
      const empty = renderEmptyState(
        currentFilter === 'installed' && !searchText ? 'toolGallery.empty' : 'toolGallery.filter',
      );
      empty.classList.add('tool-gallery-empty');
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

  // Listen for tool registration events (covers startup discovery of external tools)
  const changeListener = api.tools.onDidChangeTools(() => { refresh(); });

  _sidebarRefresh = refresh;
  refresh();

  return {
    dispose() {
      _sidebarRefresh = null;
      enablementListener.dispose();
      installListener.dispose();
      uninstallListener.dispose();
      changeListener.dispose();
      container.innerHTML = '';
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// TOOL EDITOR PANE — detail page opened in the editor area
// ═══════════════════════════════════════════════════════════════════════════════

function renderToolEditor(container: HTMLElement, api: ParallxApi, toolId: string): IDisposable {
  container.classList.add('tool-editor');

  const maybeTool = api.tools.getById(toolId);
  if (!maybeTool) {
    const msg = $('div');
    msg.classList.add('tool-editor-empty');
    msg.textContent = `Tool "${toolId}" not found.`;
    container.appendChild(msg);
    return { dispose() { container.innerHTML = ''; } };
  }
  const tool: ToolInfo = maybeTool;

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
      // Ask the user whether to keep or delete associated data
      const keepData = { title: 'Keep Data' };
      const deleteData = { title: 'Delete Data' };
      const cancel = { title: 'Cancel', isCloseAffordance: true };
      const choice = await api.window.showWarningMessage(
        `Uninstall "${tool.name}"? You can keep its data for later or delete it permanently.`,
        keepData, deleteData, cancel,
      );
      if (!choice || choice.title === 'Cancel') return;

      uninstallBtn.disabled = true;
      uninstallBtn.textContent = 'Uninstalling…';
      try {
        // If user chose to delete data, close the extension's isolated database
        // and remove the entire extension data directory (.parallx/extensions/<name>/).
        // Since extensions now own their own database, deleting the folder removes everything.
        if (choice.title === 'Delete Data') {
          const bridge = (globalThis as any).parallxElectron;
          // Derive extension name from tool ID: "publisher.tool-name" → "tool-name"
          const extName = tool.id.includes('.') ? tool.id.split('.').slice(1).join('.') : tool.id;

          // 1. Close the extension database so the file isn't locked
          if (bridge?.extensionDatabase?.close) {
            try {
              await bridge.extensionDatabase.close(extName);
            } catch (e) {
              console.warn(`[ToolGallery] Extension DB close warning:`, e);
            }
          }

          // 2. Remove workspace extension data directory (includes database + all cached files)
          const wsFolder = api.workspace.workspaceFolders?.[0];
          if (wsFolder && api.workspace.fs) {
            const extDataUri = wsFolder.uri.replace(/\/$/, '') + '/.parallx/extensions/' + extName;
            try {
              if (await api.workspace.fs.exists(extDataUri)) {
                await api.workspace.fs.delete(extDataUri);
                console.log(`[ToolGallery] Deleted extension data: .parallx/extensions/${extName}/`);
              }
            } catch (e) {
              console.warn(`[ToolGallery] Extension data deletion warning:`, e);
            }
          }
        }
        await api.tools.uninstall(tool.id);
        await api.window.showInformationMessage(
          `"${tool.name}" has been uninstalled.${choice.title === 'Delete Data' ? ' Associated data was deleted.' : ' Data was preserved.'}`,
        );
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

  // ── Membership banner ──
  // Makes "this tool is part of the family" concrete: a live summary of what
  // it adds to Parallx's shared surfaces, each chip a one-click jump there.
  renderMembershipBanner(container, api, tool);

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
        renderContributionsTab(content, tool, api);
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

// ─── Membership banner ───────────────────────────────────────────────────────

function renderMembershipBanner(container: HTMLElement, api: ParallxApi, tool: ToolInfo): void {
  const c = tool.contributes ?? {};
  const cmdCount = c.commands?.length ?? 0;
  const settingCount = (c.configuration ?? []).reduce(
    (n, sec) => n + Object.keys(sec.properties ?? {}).length, 0,
  );
  const viewCount = c.views?.length ?? 0;
  const kbCount = c.keybindings?.length ?? 0;
  const firstViewId = c.views?.[0]?.id;
  const settingsCategory = c.configuration?.[0]?.title || tool.name;

  const banner = $('div');
  banner.classList.add('tool-editor-membership');

  const lead = $('div');
  lead.classList.add('tool-editor-membership-lead');
  lead.innerHTML =
    '<span class="tool-editor-membership-badge">Part of Parallx</span>' +
    '<span class="tool-editor-membership-text">Everything this tool adds lives in the shared surfaces: same theme, same Settings, same Command Palette.</span>';
  banner.appendChild(lead);

  const chipsRow = $('div');
  chipsRow.classList.add('tool-editor-membership-chips');

  const addChip = (count: number, noun: string, onClick: (() => void) | null) => {
    if (count <= 0) return;
    const chip = $('button');
    chip.classList.add('tool-editor-membership-chip');
    if (!onClick) chip.classList.add('tool-editor-membership-chip--static');
    chip.innerHTML =
      `<span class="tool-editor-membership-num">${count}</span>` +
      `<span class="tool-editor-membership-noun">${noun}${count === 1 ? '' : 's'}</span>`;
    if (onClick) {
      chip.addEventListener('click', onClick);
    } else {
      (chip as HTMLButtonElement).disabled = true;
    }
    chipsRow.appendChild(chip);
  };

  const run = (id: string, ...args: unknown[]) =>
    api.commands.executeCommand(id, ...args).catch((e: unknown) =>
      console.warn(`[ToolGallery] ${id} failed:`, e));

  addChip(cmdCount, 'command', () => run('workbench.action.showCommands'));
  addChip(settingCount, 'setting', () => run('settings.open', `schema:${settingsCategory}`));
  addChip(viewCount, 'view', firstViewId ? () => run('workbench.view.show', firstViewId) : null);
  addChip(kbCount, 'shortcut', () => run('settings.openKeyboardShortcuts'));

  // A tool with no declared contributions still belongs — say so plainly.
  if (cmdCount + settingCount + viewCount + kbCount === 0) {
    const none = $('span');
    none.classList.add('tool-editor-membership-none');
    none.textContent = 'No declared contributions yet.';
    chipsRow.appendChild(none);
  }

  banner.appendChild(chipsRow);
  container.appendChild(banner);
}

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

function renderContributionsTab(container: HTMLElement, tool: ToolInfo, api: ParallxApi): void {
  const contrib = tool.contributes;
  if (!contrib) {
    renderEmptyMessage(container, 'No contributions declared.');
    return;
  }

  const run = (id: string, ...args: unknown[]) =>
    api.commands.executeCommand(id, ...args).catch((e: unknown) =>
      console.warn(`[ToolGallery] ${id} failed:`, e));

  let hasAny = false;

  // Commands — each row runnable.
  if (contrib.commands && contrib.commands.length > 0) {
    hasAny = true;
    renderContributionSection(container, 'Commands', contrib.commands.length, () => {
      return createActionTable(
        ['Title', 'Command ID', 'Category'],
        contrib.commands!.map(c => ({
          cells: [c.title, c.id, c.category ?? ''],
          action: { label: 'Run', onClick: () => run(c.id) },
        })),
      );
    });
  }

  // Views — each row openable.
  if (contrib.views && contrib.views.length > 0) {
    hasAny = true;
    renderContributionSection(container, 'Views', contrib.views.length, () => {
      return createActionTable(
        ['Name', 'View ID', 'Container'],
        contrib.views!.map(v => ({
          cells: [v.name, v.id, v.defaultContainerId ?? ''],
          action: { label: 'Open', onClick: () => run('workbench.view.show', v.id) },
        })),
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

  // Configuration — links into the unified Settings hub (these live there too).
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
      }, { label: 'Open in Settings', onClick: () => run('settings.open', `schema:${config.title}`) });
    }
  }

  // Keybindings — links into the Keyboard Shortcuts hub panel.
  if (contrib.keybindings && contrib.keybindings.length > 0) {
    hasAny = true;
    renderContributionSection(container, 'Keybindings', contrib.keybindings.length, () => {
      return createTable(
        ['Command', 'Key', 'When'],
        contrib.keybindings!.map(k => [k.command, k.key, k.when ?? '']),
      );
    }, { label: 'Manage shortcuts', onClick: () => run('settings.openKeyboardShortcuts') });
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
  headerAction?: { label: string; onClick: () => void },
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

  if (headerAction) {
    const btn = $('button');
    btn.classList.add('tool-editor-contrib-action');
    btn.textContent = headerAction.label;
    btn.addEventListener('click', (e) => {
      e.stopPropagation(); // don't toggle collapse
      headerAction.onClick();
    });
    header.appendChild(btn);
  }

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

/** Like createTable, but each row carries a trailing action button. */
function createActionTable(
  headers: string[],
  rows: { cells: string[]; action: { label: string; onClick: () => void } }[],
): HTMLElement {
  const table = $('table');
  table.classList.add('tool-editor-table');

  const thead = $('thead');
  const headerRow = $('tr');
  for (const h of [...headers, '']) {
    const th = $('th');
    th.textContent = h;
    headerRow.appendChild(th);
  }
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = $('tbody');
  for (const row of rows) {
    const tr = $('tr');
    for (const cell of row.cells) {
      const td = $('td');
      td.textContent = cell;
      tr.appendChild(td);
    }
    const actionTd = $('td');
    actionTd.classList.add('tool-editor-table-action-cell');
    const btn = $('button');
    btn.classList.add('tool-editor-row-action');
    btn.textContent = row.action.label;
    btn.addEventListener('click', row.action.onClick);
    actionTd.appendChild(btn);
    tr.appendChild(actionTd);
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
