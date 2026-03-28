// mcpSection.ts — MCP Servers settings section (D1)
//
// Displays configured MCP servers with status indicators and
// connect/disconnect/remove actions. Reads/writes through
// IUnifiedAIConfigService. Simplified Iter 1 implementation.

import { $ } from '../../../ui/dom.js';
import type { IUnifiedAIConfigService } from '../../unifiedConfigTypes.js';
import { SettingsSection } from '../sectionBase.js';
import type { IAISettingsService, AISettingsProfile } from '../../aiSettingsTypes.js';
import type { IMcpClientService } from '../../../services/serviceTypes.js';
import type { IMcpServerConfig, McpConnectionState } from '../../../openclaw/mcp/mcpTypes.js';

// ─── McpSection ──────────────────────────────────────────────────────────────

export class McpSection extends SettingsSection {

  private readonly _unifiedService: IUnifiedAIConfigService | undefined;
  private readonly _mcpClient: IMcpClientService | undefined;
  private _summaryEl!: HTMLElement;
  private _listContainer!: HTMLElement;

  constructor(
    service: IAISettingsService,
    unifiedService?: IUnifiedAIConfigService,
    mcpClient?: IMcpClientService,
  ) {
    super(service, 'mcp', 'MCP Servers');
    this._unifiedService = unifiedService;
    this._mcpClient = mcpClient;
  }

  build(): void {
    // ── Summary badge ──
    this._summaryEl = $('span.ai-settings-mcp-summary');
    this._updateSummary();
    this.headerElement.appendChild(this._summaryEl);

    // ── Server list container ──
    this._listContainer = $('div.ai-settings-mcp-list');
    this.contentElement.appendChild(this._listContainer);

    // ── Add Server button ──
    const addBtn = $('button.ai-settings-mcp-add', '+ Add Server');
    addBtn.addEventListener('click', () => this._showAddForm());
    this.contentElement.appendChild(addBtn);

    // ── Initial render ──
    this._renderServerList();

    // Listen for status changes
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

  // ─── Private ───────────────────────────────────────────────────────

  private _getServers(): readonly IMcpServerConfig[] {
    if (!this._unifiedService) return [];
    return this._unifiedService.getEffectiveConfig().mcp?.servers ?? [];
  }

  private _getStatus(serverId: string): McpConnectionState {
    return this._mcpClient?.getServerStatus(serverId) ?? 'disconnected';
  }

  private _updateSummary(): void {
    if (!this._summaryEl) return;
    const servers = this._getServers();
    const connected = servers.filter((s) => this._getStatus(s.id) === 'connected').length;
    this._summaryEl.textContent = servers.length === 0
      ? 'No servers'
      : `${connected}/${servers.length} connected`;
  }

  private _renderServerList(): void {
    if (!this._listContainer) return;
    this._listContainer.innerHTML = '';

    const servers = this._getServers();
    if (servers.length === 0) {
      const empty = $('div.ai-settings-mcp-empty', 'No MCP servers configured.');
      this._listContainer.appendChild(empty);
      return;
    }

    for (const server of servers) {
      const row = this._renderServerRow(server);
      this._listContainer.appendChild(row);
    }
  }

  private _renderServerRow(server: IMcpServerConfig): HTMLElement {
    const status = this._getStatus(server.id);
    const row = $('div.ai-settings-mcp-row');
    row.dataset.serverId = server.id;

    // Status indicator
    const indicator = $('span.ai-settings-mcp-status');
    indicator.dataset.status = status;
    indicator.textContent = status === 'connected' ? '●' : status === 'connecting' ? '◐' : '○';
    row.appendChild(indicator);

    // Name
    const nameEl = $('span.ai-settings-mcp-name', server.name || server.id);
    row.appendChild(nameEl);

    // Transport badge
    const transportEl = $('span.ai-settings-mcp-transport', server.transport);
    row.appendChild(transportEl);

    // Actions
    const actions = $('span.ai-settings-mcp-actions');

    if (status === 'connected') {
      const disconnectBtn = $('button.ai-settings-mcp-btn', 'Disconnect');
      disconnectBtn.addEventListener('click', () => {
        this._mcpClient?.disconnectServer(server.id);
      });
      actions.appendChild(disconnectBtn);
    } else {
      const connectBtn = $('button.ai-settings-mcp-btn', 'Connect');
      connectBtn.addEventListener('click', () => {
        this._mcpClient?.connectServer(server).catch((err) => {
          console.error(`[McpSection] Connect failed for ${server.id}:`, err);
        });
      });
      actions.appendChild(connectBtn);
    }

    const removeBtn = $('button.ai-settings-mcp-btn.ai-settings-mcp-btn--danger', 'Remove');
    removeBtn.addEventListener('click', () => this._removeServer(server.id));
    actions.appendChild(removeBtn);

    row.appendChild(actions);
    return row;
  }

  private _showAddForm(): void {
    // Simple inline form for adding a server
    const existing = this._listContainer.parentElement?.querySelector('.ai-settings-mcp-add-form');
    if (existing) return; // Already showing

    const form = $('div.ai-settings-mcp-add-form');

    const idInput = document.createElement('input');
    idInput.placeholder = 'Server ID';
    idInput.className = 'ai-settings-mcp-input';
    form.appendChild(idInput);

    const nameInput = document.createElement('input');
    nameInput.placeholder = 'Display Name';
    nameInput.className = 'ai-settings-mcp-input';
    form.appendChild(nameInput);

    const cmdInput = document.createElement('input');
    cmdInput.placeholder = 'Command (e.g. npx -y @modelcontextprotocol/server-everything)';
    cmdInput.className = 'ai-settings-mcp-input';
    form.appendChild(cmdInput);

    const btnRow = $('div.ai-settings-mcp-btn-row');
    const saveBtn = $('button.ai-settings-mcp-btn', 'Save');
    saveBtn.addEventListener('click', () => {
      const id = idInput.value.trim();
      const name = nameInput.value.trim() || id;
      const command = cmdInput.value.trim();
      if (!id || !command) return;

      const parts = command.split(/\s+/);
      const newServer: IMcpServerConfig = {
        id,
        name,
        transport: 'stdio',
        command: parts[0],
        args: parts.slice(1),
        enabled: true,
      };

      this._addServer(newServer);
      form.remove();
    });

    const cancelBtn = $('button.ai-settings-mcp-btn', 'Cancel');
    cancelBtn.addEventListener('click', () => form.remove());

    btnRow.appendChild(saveBtn);
    btnRow.appendChild(cancelBtn);
    form.appendChild(btnRow);

    this.contentElement.insertBefore(form, this._listContainer.nextSibling);
  }

  private _addServer(server: IMcpServerConfig): void {
    if (!this._unifiedService) return;
    const current = this._getServers();
    const updated = [...current, server];
    this._unifiedService.updateActivePreset({ mcp: { servers: updated } }).catch((err) => {
      console.error('[McpSection] Failed to save server:', err);
    });
    this._renderServerList();
    this._updateSummary();
  }

  private _removeServer(serverId: string): void {
    if (!this._unifiedService) return;
    // Disconnect first
    this._mcpClient?.disconnectServer(serverId);
    const current = this._getServers();
    const updated = current.filter((s) => s.id !== serverId);
    this._unifiedService.updateActivePreset({ mcp: { servers: updated } }).catch((err) => {
      console.error('[McpSection] Failed to remove server:', err);
    });
    this._renderServerList();
    this._updateSummary();
  }
}
