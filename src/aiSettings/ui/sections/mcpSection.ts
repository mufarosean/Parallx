// mcpSection.ts — MCP Servers settings section (D1)
//
// Displays configured MCP servers with live status indicators and
// connect/disconnect/remove actions. Reads server list from
// IUnifiedAIConfigService; queries connection state via IMcpClientService.

import { $ } from '../../../ui/dom.js';
import { SettingsSection } from '../sectionBase.js';
import type { IAISettingsService, AISettingsProfile } from '../../aiSettingsTypes.js';
import type { IMcpClientService } from '../../../services/serviceTypes.js';
import type { IMcpServerConfig, McpConnectionState } from '../../../openclaw/mcp/mcpTypes.js';

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

  // ─── Add Form ──────────────────────────────────────────────────────

  private _showAddForm(): void {
    const existing = this.contentElement.querySelector('.ai-settings-mcp-add-form');
    if (existing) return;

    const form = $('div.ai-settings-mcp-add-form');

    const fields: { placeholder: string; el: HTMLInputElement }[] = [
      { placeholder: 'Server ID (e.g. filesystem)', el: document.createElement('input') },
      { placeholder: 'Display Name (optional)', el: document.createElement('input') },
      { placeholder: 'Command  (e.g. npx -y @modelcontextprotocol/server-everything)', el: document.createElement('input') },
    ];
    for (const f of fields) {
      f.el.className = 'ai-settings-mcp-input';
      f.el.placeholder = f.placeholder;
      form.appendChild(f.el);
    }
    const [idInput, nameInput, cmdInput] = fields.map(f => f.el);

    const btnRow = $('div.ai-settings-mcp-form-actions');

    const saveBtn = document.createElement('button');
    saveBtn.className = 'ai-settings-mcp-btn';
    saveBtn.textContent = 'Save';
    saveBtn.addEventListener('click', () => {
      const id = idInput.value.trim();
      const name = nameInput.value.trim() || id;
      const command = cmdInput.value.trim();
      if (!id || !command) return;

      const parts = command.split(/\s+/);
      this._addServer({
        id,
        name,
        transport: 'stdio',
        command: parts[0],
        args: parts.slice(1),
        enabled: true,
      });
      form.remove();
    });

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'ai-settings-mcp-btn';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => form.remove());

    btnRow.appendChild(saveBtn);
    btnRow.appendChild(cancelBtn);
    form.appendChild(btnRow);

    this.contentElement.insertBefore(form, this._listContainer.nextSibling);
    idInput.focus();
  }

  // ─── Mutations ─────────────────────────────────────────────────────

  private _addServer(server: IMcpServerConfig): void {
    if (!this._mcpClient) return;
    this._mcpClient.addServerConfig(server).catch((err) => {
      console.error('[McpSection] Failed to save server:', err);
    });
    this._renderServerList();
    this._updateSummary();
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
