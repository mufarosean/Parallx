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
import { PolicyDecisionPoint } from './policyDecisionPoint.js';
import {
  markTurnTainted,
} from '../openclaw/openclawToolPolicy.js';

/**
 * Canonical tool-name form: snake_case, `^[a-zA-Z0-9_-]{1,64}$`.
 *
 * Function-calling schemas (OpenAI / Ollama) reject names containing `.` or
 * other punctuation, and a workspace that MIXES separators (`fs_read_file` vs
 * `budget.pullEmails`) reliably makes small models invent the wrong separator.
 * So every tool name is normalized to one separator at the single registration
 * chokepoint — schema, prompt summaries, and dispatch then all agree, and
 * extensions don't have to know the rule (a warning tells the author to fix it
 * at the source).
 */
export function normalizeToolName(name: string): string {
  // Replace any disallowed char (notably `.`) with `_`, then trim leading and
  // trailing underscores.
  //
  // We deliberately do NOT collapse internal runs of underscores. The MCP
  // bridge namespaces every tool as `mcp__<serverId>__<toolName>` (see
  // openclaw/mcp/mcpToolBridge.ts and the api.mcp contract documented in
  // src/api/parallx.d.ts), and `__` is valid in OpenAI/Anthropic/Ollama
  // function names (^[A-Za-z0-9_-]{1,64}$), so the collapse was never required
  // for API compliance. Collapsing `__`→`_` silently rewrote every MCP tool
  // name (e.g. `mcp__gmail__list_emails` → `mcp_gmail_list_emails`), which
  // broke exact-name lookups in extensions that follow the documented
  // convention — the Budget Gmail sync could never find its tool even when the
  // server was connected.
  const cleaned = name.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/^_+|_+$/g, '');
  return cleaned.slice(0, 64) || 'tool';
}

export interface ILanguageModelToolsRuntimeMetadata {
  readonly name: string;
  readonly permissionLevel: ToolPermissionLevel;
  readonly enabled: boolean;
  readonly requiresApproval: boolean;
  readonly autoApproved: boolean;
  readonly approvalSource: 'default' | 'session' | 'persistent' | 'autonomy-allow-policy' | 'strictness' | 'missing-permission-service' | 'user-consent';
  readonly source?: 'built-in' | 'bridge' | 'mcp';
  readonly ownerToolId?: string;
  readonly description?: string;
  /** HARNESS.md §2.1 — model-written intent from the call's `description` arg. */
  readonly intent?: string;
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
  // HARNESS.md §2.3 — ONE decision owner, constructed here so a "PDP not
  // wired yet" state cannot exist (same move as retirement Part 3.1's one
  // diagnostics engine). setPermissionService forwards the dependency.
  private readonly _pdp = new PolicyDecisionPoint();

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
    this._pdp.setPermissionService(service);
  }

  /** Get the bound permission service (if any). */
  getPermissionService(): PermissionService | undefined {
    return this._permissionService;
  }

  /** The Policy Decision Point — for audit-log introspection surfaces. */
  get policyDecisionPoint(): PolicyDecisionPoint {
    return this._pdp;
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
    canChangeEnablement?(toolId: string): boolean;
    setEnablement?(toolId: string, enabled: boolean): Promise<void>;
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
    canChangeEnablement?(toolId: string): boolean;
    setEnablement?(toolId: string, enabled: boolean): Promise<void>;
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
    // Enforce the canonical snake_case name at the boundary so the schema sent
    // to the model, the prompt's tool summaries, and dispatch all use the same
    // string. An extension that registers `budget.pullEmails` is silently fixed
    // to `budget_pullEmails` (and warned), instead of the model guessing.
    const canonical = normalizeToolName(tool.name);
    if (canonical !== tool.name) {
      console.warn(
        `[Tools] Tool name "${tool.name}" (owner: ${tool.ownerToolId ?? 'unknown'}) is not a valid ` +
        `function name; registering as "${canonical}". Use snake_case (a-z, 0-9, _) for tool names.`,
      );
    }
    const registered: IChatTool = canonical === tool.name ? tool : { ...tool, name: canonical };

    if (this._tools.has(canonical)) {
      throw new Error(`Tool "${canonical}" is already registered`);
    }

    this._tools.set(canonical, registered);
    this._onDidChangeTools.fire();

    return {
      dispose: () => {
        this._tools.delete(canonical);
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
        category: tool.category,
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
        category: tool.category,
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

    // M67 Phase 2 + HARNESS.md §2.3 — every invocation goes through the ONE
    // Policy Decision Point (constructed with this service, so no unwired
    // state exists). It consolidates: command blocklist + heartbeat-manual
    // gate + never-allowed check + ALWAYS_REQUIRE_CONFIRMATION belt +
    // checkPermission + M90 initiator consent + Careful Mode. The legacy
    // inline path is deleted — it had drifted (it still enforced the M65
    // color gate Mufaro removed in M90, and still gated interactive turns
    // pre-M90-style), which meant two decision owners disagreeing.
    const decision = this._pdp.decide({ caller: { kind: 'built-in', id: 'chat' }, tool: { name, defaultLevel }, args, sessionId });

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
      intent: typeof args['description'] === 'string' && args['description'].trim()
        ? args['description'].trim()
        : undefined,
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
      // Pass forceApproval=true when the destruction belt or Careful Mode
      // triggered the require-approval, so a persistent "always-allow"
      // override cannot silently bypass either. (The M65 color-gate reason
      // is gone with the legacy decision path — M90 removed that gate.)
      const forced = decision.reasons.includes('destruction-belt') || decision.reasons.includes('careful-mode');
      const approved = await this._permissionService.confirmToolInvocation(
        name,
        tool.description,
        args,
        defaultLevel,
        sessionId,
        { forceApproval: forced },
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
      // Session-scoped tools (plan, read-registry) receive the session the
      // turn runs in via the invocation context — the ONLY place it's known.
      const result = await tool.handler(args, token, { sessionId });
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


  // ── Tool enablement ──

  isToolEnabled(name: string): boolean {
    if (this._disabledTools.has(name)) return false;
    const tool = this._tools.get(name);
    if (tool && this._isOwnerExtensionDisabled(tool)) return false;
    return true;
  }

  setToolEnabled(name: string, enabled: boolean): void {
    // External (extension-bridge) tools are gated per-workspace by the
    // extension-enablement service, NOT the local _disabledTools set. A
    // tool from a disabled extension reports isToolEnabled() === false via
    // _isOwnerExtensionDisabled, so toggling only _disabledTools would be a
    // no-op — the checkbox would re-render unchecked and appear un-clickable.
    // When ENABLING such a tool we must turn its owning extension on; the
    // extension is the enablement granularity, so this lights up all of its
    // tools (the user can then disable individual ones below via _disabledTools).
    const tool = this._tools.get(name);
    const ownerExt =
      tool && tool.source === 'bridge' && tool.ownerToolId &&
      this._toolEnablement?.has(tool.ownerToolId)
        ? tool.ownerToolId
        : undefined;

    if (
      enabled && ownerExt &&
      this._toolEnablement?.setEnablement &&
      !this._toolEnablement.isEnabled(ownerExt) &&
      (this._toolEnablement.canChangeEnablement?.(ownerExt) ?? true)
    ) {
      // Enable the owning extension. setEnablement mutates its in-memory
      // state synchronously (before persisting) and fires onDidChangeEnablement,
      // which is wired to onDidChangeTools so pickers re-render.
      void this._toolEnablement.setEnablement(ownerExt, true);
    }

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
      // Mirror isToolEnabled: a tool from a disabled extension is not
      // enabled even though it isn't in _disabledTools.
      if (!this._disabledTools.has(tool.name) && !this._isOwnerExtensionDisabled(tool)) {
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
