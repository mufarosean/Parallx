// languageModelToolsService.ts — Tool registry and invocation (M9 Task 6.1, M11 Task 2.1)
//
// Implements ILanguageModelToolsService: registers tools, invokes them with
// permission gates, and provides Ollama-formatted tool definitions.
//
// M11 upgrade: 3-tier permission model via PermissionService.
// The old binary `requiresConfirmation` is mapped to the new model:
//   requiresConfirmation: false → 'always-allowed'
//   requiresConfirmation: true  → 'requires-approval'
//
// VS Code reference:
//   src/vs/workbench/contrib/chat/common/tools/languageModelToolsService.ts
//   Parallx folds confirmation logic into this single service.

import { Disposable } from '../platform/lifecycle.js';
import { Emitter } from '../platform/events.js';
import type { Event } from '../platform/events.js';
import type { IStorage } from '../platform/storage.js';
import type {
  ILanguageModelToolsService,
  IChatTool,
  IToolResult,
  IToolDefinition,
  ICancellationToken,
  ToolPermissionLevel,
} from './chatTypes.js';
import type { PermissionService } from './permissionService.js';

export interface ILanguageModelToolsRuntimeMetadata {
  readonly name: string;
  readonly permissionLevel: ToolPermissionLevel;
  readonly enabled: boolean;
  readonly requiresApproval: boolean;
  readonly autoApproved: boolean;
  readonly approvalSource: 'default' | 'session' | 'persistent' | 'global-auto' | 'strictness' | 'missing-permission-service';
  readonly source?: 'built-in' | 'bridge' | 'mcp';
  readonly ownerToolId?: string;
  readonly description?: string;
}

export interface ILanguageModelToolsRuntimeObserver {
  onValidated?(metadata: ILanguageModelToolsRuntimeMetadata): void;
  onApprovalRequested?(metadata: ILanguageModelToolsRuntimeMetadata): void;
  onApprovalResolved?(metadata: ILanguageModelToolsRuntimeMetadata, approved: boolean): void;
  onExecuted?(metadata: ILanguageModelToolsRuntimeMetadata, result: IToolResult): void;
}

export interface ILanguageModelToolsRuntimeControl {
  invokeToolWithRuntimeControl(
    name: string,
    args: Record<string, unknown>,
    token: ICancellationToken,
    observer?: ILanguageModelToolsRuntimeObserver,
    sessionId?: string,
  ): Promise<IToolResult>;
}

// ── Helpers ──

/**
 * Derive the effective permission level for a tool.
 * Uses explicit `permissionLevel` if set, otherwise maps `requiresConfirmation`.
 */
function getEffectivePermission(tool: IChatTool): ToolPermissionLevel {
  if (tool.permissionLevel) {
    return tool.permissionLevel;
  }
  return tool.requiresConfirmation ? 'requires-approval' : 'always-allowed';
}

// ── Service implementation ──

export class LanguageModelToolsService extends Disposable implements ILanguageModelToolsService, ILanguageModelToolsRuntimeControl {

  // ── Tool registry ──

  private readonly _tools = new Map<string, IChatTool>();

  // ── Enablement ──

  private static readonly _STORAGE_KEY = 'parallx.chat.disabledTools';
  private readonly _disabledTools: Set<string>;
  private _storage: IStorage | undefined;

  // ── Events ──

  private readonly _onDidChangeTools = this._register(new Emitter<void>());
  readonly onDidChangeTools: Event<void> = this._onDidChangeTools.event;

  // ── Permission service (M11 Task 2.1) ──

  private _permissionService: PermissionService | undefined;

  constructor() {
    super();
    // Start with empty set — populated when setStorage() is called
    this._disabledTools = new Set<string>();
  }

  // ── Storage binding (M53 D3.10) ──

  /**
   * Bind global storage and hydrate persisted disabled-tools set.
   * Called from workbench Phase 1 after global storage is ready.
   */
  async setStorage(storage: IStorage): Promise<void> {
    this._storage = storage;
    try {
      const stored = await storage.get(LanguageModelToolsService._STORAGE_KEY);
      if (stored) {
        const arr = JSON.parse(stored);
        if (Array.isArray(arr)) {
          for (const name of arr) {
            if (typeof name === 'string') {
              this._disabledTools.add(name);
            }
          }
        }
      }
    } catch { /* ignore parse errors */ }
  }

  // ── Permission service binding ──

  /**
   * Set the permission service (M11 Task 2.1).
   * Called from chatTool.ts during activation.
   */
  setPermissionService(service: PermissionService): void {
    this._permissionService = service;
  }

  /** Get the bound permission service (if any). */
  getPermissionService(): PermissionService | undefined {
    return this._permissionService;
  }

  // ── Registration ──

  registerTool(tool: IChatTool): { dispose(): void } {
    if (this._tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered`);
    }

    this._tools.set(tool.name, tool);
    this._onDidChangeTools.fire();

    return {
      dispose: () => {
        this._tools.delete(tool.name);
        this._onDidChangeTools.fire();
      },
    };
  }

  // ── Queries ──

  getTools(): readonly IChatTool[] {
    return Array.from(this._tools.values());
  }

  getTool(name: string): IChatTool | undefined {
    return this._tools.get(name);
  }

  /**
   * Get enabled tools formatted as Ollama tool definitions.
   *
   * These are included in the `tools` array of the chat request
   * when in Agent mode. Only enabled, non-blocked tools are returned.
   */
  getToolDefinitions(): readonly IToolDefinition[] {
    return Array.from(this._tools.values())
      .filter((tool) => {
        if (this._disabledTools.has(tool.name)) { return false; }
        // Exclude never-allowed tools from the LLM's view entirely
        const level = this._getEffectiveLevel(tool);
        return level !== 'never-allowed';
      })
      .map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      }));
  }

  /**
   * Get read-only (non-confirmation) tool definitions.
   * Used in Ask mode so the AI can browse workspace content without write access.
   */
  getReadOnlyToolDefinitions(): readonly IToolDefinition[] {
    return Array.from(this._tools.values())
      .filter((tool) => {
        if (this._disabledTools.has(tool.name)) { return false; }
        const level = this._getEffectiveLevel(tool);
        return level === 'always-allowed';
      })
      .map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      }));
  }

  // ── Invocation ──

  async invokeTool(
    name: string,
    args: Record<string, unknown>,
    token: ICancellationToken,
  ): Promise<IToolResult> {
    return this.invokeToolWithRuntimeControl(name, args, token);
  }

  async invokeToolWithRuntimeControl(
    name: string,
    args: Record<string, unknown>,
    token: ICancellationToken,
    observer?: ILanguageModelToolsRuntimeObserver,
    sessionId?: string,
  ): Promise<IToolResult> {
    const tool = this._tools.get(name);
    if (!tool) {
      return { content: `Tool "${name}" not found`, isError: true };
    }

    const defaultLevel = getEffectivePermission(tool);
    const permissionCheck = this._permissionService
      ? this._permissionService.checkPermission(name, defaultLevel)
      : {
        level: defaultLevel,
        autoApproved: defaultLevel === 'always-allowed',
        source: 'missing-permission-service' as const,
      };

    const metadata: ILanguageModelToolsRuntimeMetadata = {
      name,
      description: tool.description,
      permissionLevel: permissionCheck.level,
      enabled: this.isToolEnabled(name),
      requiresApproval: permissionCheck.level === 'requires-approval' && !permissionCheck.autoApproved,
      autoApproved: permissionCheck.autoApproved,
      approvalSource: permissionCheck.source,
      source: tool.source,
      ownerToolId: tool.ownerToolId,
    };
    observer?.onValidated?.(metadata);

    if (!metadata.enabled) {
      return { content: `Tool "${name}" is disabled`, isError: true };
    }

    // Heartbeat autonomy=manual: block every tool, including always-allowed
    // reads, before the fast-path. See PermissionService.isHeartbeatSessionBlocked.
    if (
      sessionId !== undefined &&
      this._permissionService &&
      typeof (this._permissionService as PermissionService).isHeartbeatSessionBlocked === 'function' &&
      (this._permissionService as PermissionService).isHeartbeatSessionBlocked(sessionId)
    ) {
      (this._permissionService as PermissionService).recordHeartbeatAutonomyBlock(sessionId, name);
      observer?.onApprovalResolved?.(metadata, false);
      return { content: `Tool "${name}" blocked: agent autonomy is manual`, isError: true };
    }

    if (permissionCheck.level === 'never-allowed') {
      observer?.onApprovalResolved?.(metadata, false);
      return { content: `Tool "${name}" is not allowed`, isError: true };
    }

    if (metadata.requiresApproval) {
      observer?.onApprovalRequested?.(metadata);
      if (!this._permissionService) {
        observer?.onApprovalResolved?.(metadata, false);
        return {
          content: `Tool "${name}" requires approval but permission service is not available`,
          isError: true,
        };
      }

      const approved = await this._permissionService.confirmToolInvocation(
        name,
        tool.description,
        args,
        defaultLevel,
        sessionId,
      );
      observer?.onApprovalResolved?.(metadata, approved);
      if (!approved) {
        return { content: 'Tool execution rejected by user', isError: true };
      }
    } else if (metadata.autoApproved) {
      observer?.onApprovalResolved?.(metadata, true);
    }

    if (token.isCancellationRequested) {
      return { content: 'Tool execution cancelled', isError: true };
    }

    try {
      const result = await tool.handler(args, token);
      observer?.onExecuted?.(metadata, result);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const result = { content: `Tool "${name}" failed: ${message}`, isError: true };
      observer?.onExecuted?.(metadata, result);
      return result;
    }
  }

  // ── Tool enablement ──

  isToolEnabled(name: string): boolean {
    return !this._disabledTools.has(name);
  }

  setToolEnabled(name: string, enabled: boolean): void {
    const changed = enabled
      ? this._disabledTools.delete(name)
      : !this._disabledTools.has(name) && (this._disabledTools.add(name), true);
    if (changed) {
      this._persistDisabledTools();
      this._onDidChangeTools.fire();
    }
  }

  getEnabledCount(): number {
    let count = 0;
    for (const tool of this._tools.values()) {
      if (!this._disabledTools.has(tool.name)) {
        count++;
      }
    }
    return count;
  }

  private _persistDisabledTools(): void {
    this._storage?.set(
      LanguageModelToolsService._STORAGE_KEY,
      JSON.stringify([...this._disabledTools]),
    );  // fire-and-forget
  }

  // ── Internal ──

  /**
   * Get the effective permission level for a tool, accounting for
   * persistent overrides from PermissionService.
   */
  private _getEffectiveLevel(tool: IChatTool): ToolPermissionLevel {
    const defaultLevel = getEffectivePermission(tool);
    if (this._permissionService) {
      return this._permissionService.checkPermission(tool.name, defaultLevel).level;
    }
    return defaultLevel;
  }
}
