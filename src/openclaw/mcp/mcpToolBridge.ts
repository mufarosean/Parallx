// mcpToolBridge.ts — MCP Tool Bridge (D1)
//
// Bridges MCP server tools into the Parallx tool system by converting
// IMcpToolSchema entries into IChatTool registrations on ILanguageModelToolsService.
// Each MCP tool is namespaced as `mcp__<serverId>__<toolName>`.

import type { IDisposable } from '../../platform/lifecycle.js';
import type { IMcpClientService } from '../../services/serviceTypes.js';
import type { ILanguageModelToolsService, IChatTool, IToolResult } from '../../services/chatTypes.js';
import type { IMcpToolSchema } from './mcpTypes.js';

export class McpToolBridge implements IDisposable {
  private readonly _registrations = new Map<string, IDisposable[]>();
  private _statusSubscription?: IDisposable;
  private _notificationSubscription?: IDisposable;

  constructor(
    private readonly _mcpClient: IMcpClientService,
    private readonly _toolsService: ILanguageModelToolsService,
  ) {
    // R-10: Auto-remove tools when a server disconnects
    this._statusSubscription = this._mcpClient.onDidChangeStatus(({ serverId, status }) => {
      if (status === 'disconnected') {
        this.removeTools(serverId);
      }
    });

    // D1b-6: Re-fetch tools when server sends notifications/tools/list_changed
    this._notificationSubscription = this._mcpClient.onDidReceiveNotification(({ serverId, method }) => {
      if (method === 'notifications/tools/list_changed') {
        this.refreshTools(serverId);
      }
    });
  }

  /**
   * Refresh tool registrations for a given server.
   * Re-fetches the tool list and re-registers all tools.
   */
  async refreshTools(serverId: string): Promise<void> {
    // Remove old registrations first
    this.removeTools(serverId);

    const schemas = await this._mcpClient.listTools(serverId);
    const disposables: IDisposable[] = [];

    for (const schema of schemas) {
      const tool = this._createTool(serverId, schema);
      const registration = this._toolsService.registerTool(tool);
      disposables.push(registration);
    }

    this._registrations.set(serverId, disposables);
  }

  /**
   * Remove all tool registrations for a given server.
   */
  removeTools(serverId: string): void {
    const existing = this._registrations.get(serverId);
    if (existing) {
      for (const d of existing) d.dispose();
      this._registrations.delete(serverId);
    }
  }

  dispose(): void {
    // R-15: Collect keys first to avoid mid-iteration deletion
    const serverIds = [...this._registrations.keys()];
    for (const id of serverIds) {
      this.removeTools(id);
    }
    this._statusSubscription?.dispose();
    this._notificationSubscription?.dispose();
  }

  // ─── Private ───────────────────────────────────────────────────────

  private _createTool(serverId: string, schema: IMcpToolSchema): IChatTool {
    const namespacedName = `mcp__${serverId}__${schema.name}`;

    return {
      name: namespacedName,
      description: schema.description ?? '',
      parameters: schema.inputSchema ?? { type: 'object', properties: {} },
      handler: async (args: Record<string, unknown>): Promise<IToolResult> => {
        const result = await this._mcpClient.callTool(serverId, schema.name, args);
        const text = result.content
          .filter((c) => c.type === 'text' && c.text)
          .map((c) => c.text!)
          .join('\n');
        return { content: text || '(no output)', isError: result.isError };
      },
      requiresConfirmation: false,
      permissionLevel: 'requires-approval',
      source: 'mcp',
      ownerToolId: serverId,
    };
  }
}
