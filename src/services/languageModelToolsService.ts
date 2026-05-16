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
import type { PolicyDecisionPoint } from './policyDecisionPoint.js';
import {
  getToolColor,
  markTurnTainted,
  resolveColorGate,
} from '../openclaw/openclawToolPolicy.js';

export interface ILanguageModelToolsRuntimeMetadata {
  readonly name: string;
  readonly permissionLevel: ToolPermissionLevel;
  readonly enabled: boolean;
  readonly requiresApproval: boolean;
  readonly autoApproved: boolean;
  readonly approvalSource: 'default' | 'session' | 'persistent' | 'autonomy-allow-policy' | 'strictness' | 'missing-permission-service';
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

  // ── Permission service (M11 Task 2.1) + Policy Decision Point (M67 Phase 2) ──

  private _permissionService: PermissionService | undefined;
  private _pdp: PolicyDecisionPoint | undefined;

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

  /** Set the Policy Decision Point (M67 Phase 2). */
  setPolicyDecisionPoint(pdp: PolicyDecisionPoint): void {
    this._pdp = pdp;
  }

  // ── Tool-enablement binding (M62 follow-up) ──

  /**
   * Bind the tool-enablement service so the LLM-facing tool list can
   * filter out chat tools whose owning extension is disabled in this
   * workspace. Without this filter, tools registered via
   * `api.chat.registerTool` from an extension that has been disabled
   * (or never enabled) at runtime would leak into the system prompt
   * and bloat token usage. Wired up from workbench.ts after both
   * services are constructed.
   */
  setToolEnablementService(service: {
    isEnabled(toolId: string): boolean;
    has(toolId: string): boolean;
    onDidChangeEnablement: Event<{ toolId: string }>;
  }): void {
    this._toolEnablement = service;
    // Fire onDidChangeTools whenever any extension toggles, so the
    // chat UI re-fetches the filtered tool list.
    this._register(
      service.onDidChangeEnablement(() => this._onDidChangeTools.fire()),
    );
  }

  private _toolEnablement?: {
    isEnabled(toolId: string): boolean;
    has(toolId: string): boolean;
  };

  /**
   * True iff the tool comes from an extension bridge whose owner
   * extension is currently disabled. Returns false for built-in tools,
   * MCP tools (whose ownerToolId is a server ID, not a registered
   * extension), and tools without an enablement service bound.
   */
  private _isOwnerExtensionDisabled(tool: IChatTool): boolean {
    if (!this._toolEnablement) return false;
    if (tool.source !== 'bridge') return false;
    if (!tool.ownerToolId) return false;
    // Only filter when the ownerToolId actually corresponds to a
    // registered extension. MCP server IDs and other non-extension
    // owners are not in the tool registry and must not be filtered.
    if (!this._toolEnablement.has(tool.ownerToolId)) return false;
    return !this._toolEnablement.isEnabled(tool.ownerToolId);
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
        if (this._isOwnerExtensionDisabled(tool)) { return false; }
        // Exclude never-allowed tools from the LLM's view entirely
        const level = this._getEffectiveLevel(tool);
        return level !== 'never-allowed';
      })
      .map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        displaySummary: tool.displaySummary,
        profiles: tool.profiles,
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
        if (this._isOwnerExtensionDisabled(tool)) { return false; }
        const level = this._getEffectiveLevel(tool);
        return level === 'always-allowed';
      })
      .map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        displaySummary: tool.displaySummary,
        profiles: tool.profiles,
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

    // M67 Phase 2 — every invocation goes through the Policy Decision Point.
    // The PDP consolidates: command blocklist + heartbeat-manual gate +
    // never-allowed check + ALWAYS_REQUIRE_CONFIRMATION belt + M65 color gate +
    // checkPermission. When the PDP is not yet wired (test or early init path),
    // fall back to the legacy inline logic.
    const decision = this._pdp
      ? this._pdp.decide({ caller: { kind: 'built-in', id: 'chat' }, tool: { name, defaultLevel }, args, sessionId })
      : this._legacyDecide(name, defaultLevel, sessionId);

    // Derive the permission-level for the observer from the PDP outcome.
    const permLevel: ToolPermissionLevel =
      decision.outcome === 'deny'
        ? (decision.reasons.includes('never-allowed') ? 'never-allowed' : 'requires-approval')
        : decision.outcome === 'require-approval' ? 'requires-approval' : 'always-allowed';

    const metadata: ILanguageModelToolsRuntimeMetadata = {
      name,
      description: tool.description,
      permissionLevel: permLevel,
      enabled: this.isToolEnabled(name),
      requiresApproval: decision.outcome === 'require-approval',
      autoApproved: decision.autoApproved,
      approvalSource: decision.permSource,
      source: tool.source,
      ownerToolId: tool.ownerToolId,
    };
    observer?.onValidated?.(metadata);

    if (!metadata.enabled) {
      return { content: `Tool "${name}" is disabled`, isError: true };
    }

    // ── Handle deny outcomes ─────────────────────────────────────────────────

    if (decision.outcome === 'deny') {
      // autonomy-manual: side-effect — emit to autonomy log
      if (decision.reasons.includes('autonomy-manual') && sessionId && this._permissionService) {
        this._permissionService.recordManagedAutonomyBlock(sessionId, name);
      }
      observer?.onApprovalResolved?.(metadata, false);
      if (decision.reasons.includes('command-blocklist')) {
        return { content: `Tool "${name}": command is blocked`, isError: true };
      }
      if (decision.reasons.includes('autonomy-manual')) {
        return { content: `Tool "${name}" blocked: agent autonomy is manual`, isError: true };
      }
      return { content: `Tool "${name}" is not allowed`, isError: true };
    }

    // ── Handle require-approval outcome ─────────────────────────────────────

    if (decision.outcome === 'require-approval') {
      observer?.onApprovalRequested?.(metadata);
      if (!this._permissionService) {
        observer?.onApprovalResolved?.(metadata, false);
        return {
          content: `Tool "${name}" requires approval but permission service is not available`,
          isError: true,
        };
      }
      // Pass forceApproval=true when the color gate triggered the require-approval
      // so that a persistent "always-allow" override cannot silently bypass the
      // mid-turn taint check inside confirmToolInvocation.
      const colorGateForced = decision.reasons.includes('color-gate-blue-post-red');
      const approved = await this._permissionService.confirmToolInvocation(
        name,
        tool.description,
        args,
        defaultLevel,
        sessionId,
        { forceApproval: colorGateForced },
      );
      observer?.onApprovalResolved?.(metadata, approved);
      if (!approved) {
        return { content: 'Tool execution rejected by user', isError: true };
      }
    } else {
      // allow — auto-approved
      observer?.onApprovalResolved?.(metadata, true);
    }

    if (token.isCancellationRequested) {
      return { content: 'Tool execution cancelled', isError: true };
    }

    try {
      const result = await tool.handler(args, token);
      // Taint the session turn if a red tool succeeded (M65 Layer 5).
      // Taint is set ONLY here, ONLY on success, ONLY when sessionId is in scope.
      if (!result.isError && sessionId && decision.willTaintOnSuccess) {
        markTurnTainted(sessionId);
      }
      observer?.onExecuted?.(metadata, result);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const result = { content: `Tool "${name}" failed: ${message}`, isError: true };
      observer?.onExecuted?.(metadata, result);
      return result;
    }
  }

  /**
   * Legacy decision path used when the PDP has not been wired yet (e.g. in
   * unit tests that construct LanguageModelToolsService in isolation).
   * Mirrors the pre-M67 inline logic: checkPermission + color gate only.
   */
  private _legacyDecide(
    name: string,
    defaultLevel: ToolPermissionLevel,
    sessionId: string | undefined,
  ): import('./policyDecisionPoint.js').PolicyDecision {
    const permCheck = this._permissionService
      ? this._permissionService.checkPermission(name, defaultLevel)
      : { level: defaultLevel, autoApproved: defaultLevel === 'always-allowed', source: 'missing-permission-service' as const };

    // Heartbeat autonomy=manual
    if (sessionId && this._permissionService?.isManagedSessionBlocked(sessionId)) {
      return { outcome: 'deny', reasons: ['autonomy-manual'], autoApproved: false, permSource: permCheck.source, willTaintOnSuccess: false };
    }

    if (permCheck.level === 'never-allowed') {
      return { outcome: 'deny', reasons: ['never-allowed'], autoApproved: false, permSource: permCheck.source, willTaintOnSuccess: false };
    }

    const willTaint = getToolColor(name) === 'red';

    if (resolveColorGate(name, sessionId) === 'requires-approval') {
      return { outcome: 'require-approval', reasons: ['color-gate-blue-post-red'], autoApproved: false, permSource: permCheck.source, willTaintOnSuccess: willTaint };
    }

    if (permCheck.level === 'requires-approval' && !permCheck.autoApproved) {
      return { outcome: 'require-approval', reasons: [`requires-approval:${permCheck.source}`], autoApproved: false, permSource: permCheck.source, willTaintOnSuccess: willTaint };
    }

    return { outcome: 'allow', reasons: [`allow:${permCheck.source}`], autoApproved: permCheck.autoApproved, permSource: permCheck.source, willTaintOnSuccess: willTaint };
  }

  // ── Tool enablement ──

  isToolEnabled(name: string): boolean {
    if (this._disabledTools.has(name)) return false;
    const tool = this._tools.get(name);
    if (tool && this._isOwnerExtensionDisabled(tool)) return false;
    return true;
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
