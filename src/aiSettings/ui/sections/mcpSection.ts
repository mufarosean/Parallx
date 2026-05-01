// mcpSection.ts — MCP Servers settings section (D1, M61 Phase 3)
//
// Displays configured MCP servers with live status indicators and
// connect/disconnect/remove actions. Reads server list from
// IUnifiedAIConfigService; queries connection state via IMcpClientService.
//
// M61 Phase 3 additions:
//   - Catalog tab in the install form (curated list from `mcpCatalog.ts`)
//   - Env-var support in the manual install form
//   - Auto-connect after add (so the user doesn't have to click Connect)

import { $ } from '../../../ui/dom.js';
import { SettingsSection } from '../sectionBase.js';
import type { IAISettingsService, AISettingsProfile } from '../../aiSettingsTypes.js';
import type { IMcpClientService } from '../../../services/serviceTypes.js';
import type { IMcpServerConfig, McpConnectionState } from '../../../openclaw/mcp/mcpTypes.js';
import { MCP_CATALOG, type IMcpCatalogEntry } from '../../../openclaw/mcp/mcpCatalog.js';

// ─── Status → display mapping ────────────────────────────────────────────────

const STATUS_META: Record<McpConnectionState | 'unhealthy', { dot: string; label: string; cls: string }> = {
  connected:    { dot: '●', label: 'Connected',      cls: 'connected' },
  unhealthy:    { dot: '●', label: 'Unhealthy',      cls: 'unhealthy' },
  connecting:   { dot: '◐', label: 'Connecting…',    cls: 'connecting' },
  reconnecting: { dot: '◐', label: 'Reconnecting…',  cls: 'reconnecting' },
  error:        { dot: '✕', label: 'Error',           cls: 'error' },
  disconnected: { dot: '○', label: 'Disconnected',    cls: 'disconnected' },
};

// ─── McpSection ──────────────────────────────────────────────────────────────

export class McpSection extends SettingsSection {

  private readonly _mcpClient: IMcpClientService | undefined;
  private _summaryEl!: HTMLElement;
  private _listContainer!: HTMLElement;

  constructor(
    service: IAISettingsService,
    mcpClient?: IMcpClientService,
  ) {
    super(service, 'mcp', 'MCP Servers');
    this._mcpClient = mcpClient;
  }

  build(): void {
    // ── Summary badge (same pattern as ToolsSection) ──
    this._summaryEl = $('span.ai-settings-mcp-summary');
    this._updateSummary();
    this.headerElement.appendChild(this._summaryEl);

    // ── Server list ──
    this._listContainer = $('div.ai-settings-mcp-list');
    this.contentElement.appendChild(this._listContainer);

    // ── Add Server button ──
    const addBtn = $('button.ai-settings-mcp-add-btn');
    addBtn.textContent = '+ Add Server';
    addBtn.addEventListener('click', () => this._showAddForm());
    this.contentElement.appendChild(addBtn);

    // ── Initial render ──
    this._renderServerList();

    // Live updates
    if (this._mcpClient) {
      this._register(this._mcpClient.onDidChangeStatus(() => {
        this._renderServerList();
        this._updateSummary();
      }));
    }
  }

  update(_profile: AISettingsProfile): void {
    this._renderServerList();
    this._updateSummary();
  }

  // ─── Queries ───────────────────────────────────────────────────────

  private _getServers(): readonly IMcpServerConfig[] {
    if (!this._mcpClient) return [];
    return this._mcpClient.getConfiguredServers();
  }

  private _resolveStatus(serverId: string): McpConnectionState | 'unhealthy' {
    const base = this._mcpClient?.getServerStatus(serverId) ?? 'disconnected';
    if (base === 'connected') {
      const health = this._mcpClient?.getHealthInfo(serverId);
      if (health && !health.isHealthy) return 'unhealthy';
    }
    return base;
  }

  // ─── Rendering ─────────────────────────────────────────────────────

  private _updateSummary(): void {
    if (!this._summaryEl) return;
    const servers = this._getServers();
    const connected = servers.filter((s) => {
      const st = this._resolveStatus(s.id);
      return st === 'connected' || st === 'unhealthy';
    }).length;
    this._summaryEl.textContent = servers.length === 0
      ? ''
      : `${connected}/${servers.length} connected`;
  }

  private _renderServerList(): void {
    if (!this._listContainer) return;
    this._listContainer.innerHTML = '';

    const servers = this._getServers();
    if (servers.length === 0) {
      const empty = $('div.ai-settings-mcp-empty');
      empty.textContent = 'No MCP servers configured. Click "+ Add Server" below to get started.';
      this._listContainer.appendChild(empty);
      return;
    }

    for (const server of servers) {
      this._listContainer.appendChild(this._renderServerRow(server));
    }
  }

  private _renderServerRow(server: IMcpServerConfig): HTMLElement {
    const status = this._resolveStatus(server.id);
    const meta = STATUS_META[status];
    const row = $('div.ai-settings-mcp-row');
    row.dataset.serverId = server.id;
    row.dataset.status = meta.cls;

    // Left: status dot + server info
    const left = $('div.ai-settings-mcp-row__left');

    const dot = $('span.ai-settings-mcp-dot');
    dot.textContent = meta.dot;
    dot.dataset.status = meta.cls;
    dot.title = this._buildTooltip(server.id, status);
    left.appendChild(dot);

    const info = $('div.ai-settings-mcp-info');

    const nameEl = $('span.ai-settings-mcp-name');
    nameEl.textContent = server.name || server.id;
    info.appendChild(nameEl);

    const detailEl = $('span.ai-settings-mcp-detail');
    const cmd = [server.command, ...(server.args ?? [])].join(' ');
    detailEl.textContent = `${server.transport} · ${cmd}`;
    info.appendChild(detailEl);

    left.appendChild(info);
    row.appendChild(left);

    // Right: status label + action buttons
    const right = $('div.ai-settings-mcp-row__right');

    const badge = $('span.ai-settings-mcp-badge');
    badge.textContent = meta.label;
    badge.dataset.status = meta.cls;
    right.appendChild(badge);

    // Primary action
    if (status === 'connected' || status === 'unhealthy') {
      right.appendChild(this._makeBtn('Disconnect', () => {
        this._mcpClient?.disconnectServer(server.id);
      }));
    } else if (status === 'reconnecting' || status === 'connecting') {
      right.appendChild(this._makeBtn('Cancel', () => {
        this._mcpClient?.disconnectServer(server.id);
      }));
    } else {
      right.appendChild(this._makeBtn('Connect', () => {
        this._mcpClient?.connectServer(server).catch((err) => {
          console.error(`[McpSection] Connect failed for ${server.id}:`, err);
        });
      }));
    }

    // Remove
    right.appendChild(this._makeBtn('Remove', () => this._removeServer(server.id), true));

    row.appendChild(right);
    return row;
  }

  private _makeBtn(label: string, handler: () => void, danger = false): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = 'ai-settings-mcp-btn';
    if (danger) btn.classList.add('ai-settings-mcp-btn--danger');
    btn.textContent = label;
    btn.addEventListener('click', handler);
    return btn;
  }

  private _buildTooltip(serverId: string, status: McpConnectionState | 'unhealthy'): string {
    if (status === 'unhealthy') {
      const health = this._mcpClient?.getHealthInfo(serverId);
      return health
        ? `Unhealthy — ${health.consecutiveFailures} consecutive ping failures`
        : 'Unhealthy';
    }
    if (status === 'connected') {
      const health = this._mcpClient?.getHealthInfo(serverId);
      return health?.lastPingLatencyMs != null
        ? `Connected — ping ${health.lastPingLatencyMs}ms`
        : 'Connected';
    }
    return STATUS_META[status].label;
  }

  // ─── Add Form (M61 Phase 3 — catalog + manual + env) ──────────────

  private _showAddForm(): void {
    const existing = this.contentElement.querySelector('.ai-settings-mcp-add-form');
    if (existing) return;

    const form = $('div.ai-settings-mcp-add-form');

    // ── Tab strip ──
    const tabs = $('div.ai-settings-mcp-tabs');
    const catalogTab = document.createElement('button');
    catalogTab.className = 'ai-settings-mcp-tab ai-settings-mcp-tab--active';
    catalogTab.textContent = 'Catalog';
    catalogTab.type = 'button';
    const customTab = document.createElement('button');
    customTab.className = 'ai-settings-mcp-tab';
    customTab.textContent = 'Custom';
    customTab.type = 'button';
    tabs.appendChild(catalogTab);
    tabs.appendChild(customTab);
    form.appendChild(tabs);

    const body = $('div.ai-settings-mcp-form-body');
    form.appendChild(body);

    const showCatalog = (): void => {
      catalogTab.classList.add('ai-settings-mcp-tab--active');
      customTab.classList.remove('ai-settings-mcp-tab--active');
      body.innerHTML = '';
      this._renderCatalogPicker(body, () => form.remove());
    };
    const showCustom = (): void => {
      customTab.classList.add('ai-settings-mcp-tab--active');
      catalogTab.classList.remove('ai-settings-mcp-tab--active');
      body.innerHTML = '';
      this._renderCustomForm(body, () => form.remove());
    };

    catalogTab.addEventListener('click', showCatalog);
    customTab.addEventListener('click', showCustom);

    showCatalog();
    this.contentElement.insertBefore(form, this._listContainer.nextSibling);
  }

  /** Render the catalog list. Click an entry to expand its install form. */
  private _renderCatalogPicker(host: HTMLElement, close: () => void): void {
    const intro = $('div.ai-settings-mcp-catalog-intro');
    intro.textContent =
      'Pick a server from the curated list. You only need to fill in the API key or path it asks for.';
    host.appendChild(intro);

    for (const entry of MCP_CATALOG) {
      const card = $('div.ai-settings-mcp-catalog-card');

      const head = $('div.ai-settings-mcp-catalog-card__head');
      const title = $('span.ai-settings-mcp-catalog-card__title');
      title.textContent = entry.displayName;
      const tag = $('span.ai-settings-mcp-catalog-card__tag');
      tag.textContent = entry.category;
      head.appendChild(title);
      head.appendChild(tag);
      card.appendChild(head);

      const desc = $('div.ai-settings-mcp-catalog-card__desc');
      desc.textContent = entry.description;
      card.appendChild(desc);

      const actions = $('div.ai-settings-mcp-catalog-card__actions');
      const installBtn = document.createElement('button');
      installBtn.className = 'ai-settings-mcp-btn';
      installBtn.type = 'button';
      installBtn.textContent = 'Install';
      installBtn.addEventListener('click', () => {
        this._showCatalogInstall(host, entry, close);
      });
      const homeLink = document.createElement('a');
      homeLink.className = 'ai-settings-mcp-catalog-card__home';
      homeLink.href = entry.homepage;
      homeLink.target = '_blank';
      homeLink.rel = 'noopener noreferrer';
      homeLink.textContent = 'Docs ↗';
      actions.appendChild(installBtn);
      actions.appendChild(homeLink);
      card.appendChild(actions);

      host.appendChild(card);
    }
  }

  /** Replace the catalog list with the install dialog for one entry. */
  private _showCatalogInstall(
    host: HTMLElement,
    entry: IMcpCatalogEntry,
    close: () => void,
  ): void {
    host.innerHTML = '';

    const heading = $('div.ai-settings-mcp-install-heading');
    heading.textContent = `Install ${entry.displayName}`;
    host.appendChild(heading);

    const desc = $('div.ai-settings-mcp-install-desc');
    desc.textContent = entry.description;
    host.appendChild(desc);

    const cmdLine = $('div.ai-settings-mcp-install-cmd');
    cmdLine.textContent = `${entry.command} ${entry.args.join(' ')}`;
    host.appendChild(cmdLine);

    const envInputs: { key: string; el: HTMLInputElement; required: boolean }[] = [];
    for (const v of entry.env) {
      const wrap = $('div.ai-settings-mcp-install-field');
      const label = document.createElement('label');
      label.className = 'ai-settings-mcp-install-label';
      label.textContent = v.required ? `${v.label} *` : v.label;
      wrap.appendChild(label);

      const input = document.createElement('input');
      input.className = 'ai-settings-mcp-input';
      input.type = v.secret ? 'password' : 'text';
      input.placeholder = v.key;
      wrap.appendChild(input);

      const help = $('div.ai-settings-mcp-install-help');
      help.textContent = v.description;
      wrap.appendChild(help);

      host.appendChild(wrap);
      envInputs.push({ key: v.key, el: input, required: v.required });
    }

    const status = $('div.ai-settings-mcp-install-status');
    host.appendChild(status);

    const btnRow = $('div.ai-settings-mcp-form-actions');

    const installBtn = document.createElement('button');
    installBtn.className = 'ai-settings-mcp-btn';
    installBtn.textContent = 'Install';
    installBtn.type = 'button';
    installBtn.addEventListener('click', () => {
      const env: Record<string, string> = {};
      for (const f of envInputs) {
        const v = f.el.value.trim();
        if (!v) {
          if (f.required) {
            status.textContent = `Missing required value: ${f.key}`;
            return;
          }
          continue;
        }
        env[f.key] = v;
      }
      void this._addServer({
        id: this._uniqueServerId(entry.id),
        name: entry.displayName,
        transport: 'stdio',
        command: entry.command,
        args: [...entry.args],
        env: Object.keys(env).length > 0 ? env : undefined,
        enabled: true,
      });
      close();
    });

    const backBtn = document.createElement('button');
    backBtn.className = 'ai-settings-mcp-btn';
    backBtn.textContent = 'Back';
    backBtn.type = 'button';
    backBtn.addEventListener('click', () => this._renderCatalogPicker(host, close));

    btnRow.appendChild(installBtn);
    btnRow.appendChild(backBtn);
    host.appendChild(btnRow);

    if (envInputs.length > 0) envInputs[0].el.focus();
  }

  /** Manual install form (was the only path before M61 Phase 3). */
  private _renderCustomForm(host: HTMLElement, close: () => void): void {
    const idInput = document.createElement('input');
    idInput.className = 'ai-settings-mcp-input';
    idInput.placeholder = 'Server ID (e.g. filesystem)';
    host.appendChild(idInput);

    const nameInput = document.createElement('input');
    nameInput.className = 'ai-settings-mcp-input';
    nameInput.placeholder = 'Display Name (optional)';
    host.appendChild(nameInput);

    const cmdInput = document.createElement('input');
    cmdInput.className = 'ai-settings-mcp-input';
    cmdInput.placeholder = 'Command (e.g. npx -y @modelcontextprotocol/server-everything)';
    host.appendChild(cmdInput);

    const envHelp = $('div.ai-settings-mcp-install-help');
    envHelp.textContent = 'Environment variables — one KEY=VALUE per line (optional).';
    host.appendChild(envHelp);

    const envArea = document.createElement('textarea');
    envArea.className = 'ai-settings-mcp-input ai-settings-mcp-textarea';
    envArea.rows = 3;
    envArea.placeholder = 'API_KEY=...\nFOO=bar';
    host.appendChild(envArea);

    const status = $('div.ai-settings-mcp-install-status');
    host.appendChild(status);

    const btnRow = $('div.ai-settings-mcp-form-actions');

    const saveBtn = document.createElement('button');
    saveBtn.className = 'ai-settings-mcp-btn';
    saveBtn.textContent = 'Save & connect';
    saveBtn.type = 'button';
    saveBtn.addEventListener('click', () => {
      const id = idInput.value.trim();
      const name = nameInput.value.trim() || id;
      const command = cmdInput.value.trim();
      if (!id || !command) {
        status.textContent = 'Server ID and command are required.';
        return;
      }
      const parts = command.split(/\s+/);
      const env = parseEnvBlock(envArea.value);
      void this._addServer({
        id,
        name,
        transport: 'stdio',
        command: parts[0],
        args: parts.slice(1),
        env: env && Object.keys(env).length > 0 ? env : undefined,
        enabled: true,
      });
      close();
    });

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'ai-settings-mcp-btn';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.type = 'button';
    cancelBtn.addEventListener('click', close);

    btnRow.appendChild(saveBtn);
    btnRow.appendChild(cancelBtn);
    host.appendChild(btnRow);

    idInput.focus();
  }

  /** Generate a non-clashing id when the catalog id is already taken. */
  private _uniqueServerId(base: string): string {
    const existing = new Set(this._getServers().map((s) => s.id));
    if (!existing.has(base)) return base;
    let n = 2;
    while (existing.has(`${base}-${n}`)) n++;
    return `${base}-${n}`;
  }

  // ─── Mutations ─────────────────────────────────────────────────────

  private async _addServer(server: IMcpServerConfig): Promise<void> {
    if (!this._mcpClient) return;
    try {
      await this._mcpClient.addServerConfig(server);
    } catch (err) {
      console.error('[McpSection] Failed to save server:', err);
      return;
    }
    this._renderServerList();
    this._updateSummary();
    // M61 Phase 3: auto-connect when enabled, so the user doesn't have to
    // click Connect after install.
    if (server.enabled) {
      this._mcpClient.connectServer(server).catch((err) => {
        console.error(`[McpSection] Auto-connect failed for ${server.id}:`, err);
      });
    }
  }

  private _removeServer(serverId: string): void {
    if (!this._mcpClient) return;
    this._mcpClient.disconnectServer(serverId);
    this._mcpClient.removeServerConfig(serverId).catch((err) => {
      console.error('[McpSection] Failed to remove server:', err);
    });
    this._renderServerList();
    this._updateSummary();
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Parse a `KEY=VALUE` env-var block (one per line) into a plain object.
 * Blank lines, lines without `=`, and lines with empty keys are ignored.
 * Values are trimmed; leading/trailing quotes are stripped.
 */
function parseEnvBlock(text: string): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
