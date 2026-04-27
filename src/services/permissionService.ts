// permissionService.ts — 3-tier tool permission manager (M11 Task 2.1)
//
// Manages tool execution permissions with three tiers:
//   1. always-allowed  — auto-approved (read-only tools)
//   2. requires-approval — user confirms per invocation
//   3. never-allowed   — blocked entirely
//
// Session-level grant cache remembers "Allow for session" decisions.
// Persistent overrides stored in `.parallx/permissions.json` (Task 2.10).
//
// VS Code reference:
//   VS Code's languageModelToolsService has only binary `requiresConfirmation`.
//   We extend this to a proper permission model with grant memory.

import { Disposable } from '../platform/lifecycle.js';
import { Emitter } from '../platform/events.js';
import type { Event } from '../platform/events.js';
import type { ToolPermissionLevel, ToolGrantDecision } from './chatTypes.js';
import type { AgentApprovalStrictness } from '../aiSettings/unifiedConfigTypes.js';
import type { AgentAutonomyLevel } from '../agent/agentTypes.js';

// ── Types ──

/**
 * Callback type for tool confirmation with 3-tier grant options.
 * The service calls this when a tool requires approval.
 * Returns the user's grant decision.
 */
export type ToolConfirmationHandler = (
  toolName: string,
  toolDescription: string,
  args: Record<string, unknown>,
) => Promise<ToolGrantDecision>;

/**
 * Permission override entry from `.parallx/permissions.json`.
 */
export interface IPermissionOverride {
  readonly tool: string;
  readonly level: ToolPermissionLevel;
}

/** Resolved permission for a tool invocation. */
export interface IPermissionCheckResult {
  /** The effective permission level for this tool. */
  readonly level: ToolPermissionLevel;
  /** Whether the tool can proceed without asking the user. */
  readonly autoApproved: boolean;
  /** Source of the decision: 'default' | 'session' | 'persistent' | 'global-auto' | 'strictness'. */
  readonly source: 'default' | 'session' | 'persistent' | 'global-auto' | 'strictness';
}

/** A single entry in the approval audit log. */
export interface IApprovalAuditEntry {
  readonly tool: string;
  readonly decision: 'approved' | 'rejected' | 'blocked';
  readonly source: IPermissionCheckResult['source'];
  readonly timestamp: number;
}

// ── Service ──

/**
 * Tool permission service.
 *
 * Manages the 3-tier permission model:
 * - Default permissions come from the tool's `permissionLevel` field.
 * - Session grants override defaults for the current session.
 * - Persistent overrides from `.parallx/permissions.json` take highest priority.
 * - Global auto-approve (YOLO mode) bypasses everything.
 */
export class PermissionService extends Disposable {

  // ── State ──

  /** Session-level grants: tool name → 'always-allowed' for duration of session. */
  private readonly _sessionGrants = new Map<string, ToolPermissionLevel>();

  /** Persistent overrides (from .parallx/permissions.json). */
  private readonly _persistentOverrides = new Map<string, ToolPermissionLevel>();

  /** Global auto-approve mode (YOLO). */
  private _autoApprove = false;

  /** Approval strictness from agent config. */
  private _approvalStrictness: AgentApprovalStrictness = 'balanced';

  /** Audit log of approval decisions (bounded to last 500 entries). */
  private readonly _auditLog: IApprovalAuditEntry[] = [];
  private static readonly _MAX_AUDIT_LOG_SIZE = 500;

  /** Confirmation handler set by UI layer. */
  private _confirmationHandler: ToolConfirmationHandler | undefined;

  /**
   * Sessions whose tool calls originate from the heartbeat ephemeral runner.
   * For these sessions, `requires-approval` tools are NOT presented to the
   * user via `_confirmationHandler` (the heartbeat output surfaces in the
   * autonomy log, not chat — there is no UI dialog the user can see).
   * Instead, the gate logs a "queued" entry to the autonomy log and rejects
   * the call so the heartbeat turn fails fast without stalling.
   *
   * Set/cleared by `markHeartbeatSession` / `unmarkHeartbeatSession`,
   * called by the heartbeat executor around its `chatService.sendRequest`.
   */
  private readonly _heartbeatSessions = new Set<string>();

  /**
   * Per-heartbeat-session autonomy level, captured at mark-time.
   *   - `manual`               → reject every tool (with autonomy-log entry)
   *   - `allow-readonly`       → same as default heartbeat policy
   *                              (always-allowed reads pass; requires-approval queued)
   *   - `allow-safe-actions`   → same
   *   - `allow-policy-actions` → auto-approve requires-approval tools too
   *                              (user intent: agent runs fully autonomously)
   */
  private readonly _heartbeatAutonomy = new Map<string, AgentAutonomyLevel>();

  /**
   * Sessions whose tool calls originate from a subagent ephemeral run.
   * Same approval semantics as heartbeat (never opens a UI dialog — the
   * subagent runs in the background, the user is not necessarily watching),
   * but autonomy-log entries are tagged `origin: 'subagent'` so they can be
   * filtered separately in the Autonomy Log view.
   *
   * Set/cleared by `markSubagentSession` / `unmarkSubagentSession`,
   * called by the subagent executor around its `chatService.sendRequest`.
   */
  private readonly _subagentSessions = new Set<string>();

  /** Per-subagent-session autonomy level, captured at mark-time. */
  private readonly _subagentAutonomy = new Map<string, AgentAutonomyLevel>();

  /** Optional autonomy log appender for queued-approval entries. */
  private _autonomyLogAppender: { append(input: { origin: 'heartbeat' | 'subagent'; requestText: string; content: string; metadata?: Readonly<Record<string, unknown>>; sessionId?: string }): unknown } | undefined;

  // ── Events ──

  private readonly _onDidChange = this._register(new Emitter<void>());
  /** Fires when permissions change (session grant, override loaded, etc.). */
  readonly onDidChange: Event<void> = this._onDidChange.event;

  constructor() {
    super();
  }

  /** Append an audit entry and trim if over max size. */
  private _audit(entry: IApprovalAuditEntry): void {
    this._auditLog.push(entry);
    if (this._auditLog.length > PermissionService._MAX_AUDIT_LOG_SIZE) {
      this._auditLog.splice(0, this._auditLog.length - PermissionService._MAX_AUDIT_LOG_SIZE);
    }
  }

  // ── Configuration ──

  /** Set the confirmation handler (called by UI layer to show approval dialog). */
  setConfirmationHandler(handler: ToolConfirmationHandler | undefined): void {
    this._confirmationHandler = handler;
  }

  /** Mark an ephemeral chat session as originating from heartbeat. */
  markHeartbeatSession(sessionId: string, autonomyLevel?: AgentAutonomyLevel): void {
    this._heartbeatSessions.add(sessionId);
    if (autonomyLevel !== undefined) {
      this._heartbeatAutonomy.set(sessionId, autonomyLevel);
    }
  }

  /** Clear the heartbeat marker for a session (call in finally). */
  unmarkHeartbeatSession(sessionId: string): void {
    this._heartbeatSessions.delete(sessionId);
    this._heartbeatAutonomy.delete(sessionId);
  }

  /** Mark an ephemeral chat session as originating from a subagent run. */
  markSubagentSession(sessionId: string, autonomyLevel?: AgentAutonomyLevel): void {
    this._subagentSessions.add(sessionId);
    if (autonomyLevel !== undefined) {
      this._subagentAutonomy.set(sessionId, autonomyLevel);
    }
  }

  /** Clear the subagent marker for a session (call in finally). */
  unmarkSubagentSession(sessionId: string): void {
    this._subagentSessions.delete(sessionId);
    this._subagentAutonomy.delete(sessionId);
  }

  /**
   * Resolve the caller origin + autonomy for a session id. Returns
   * `undefined` if the session is a normal user-driven session (no
   * special routing applies).
   */
  private _getCallerContext(sessionId: string | undefined): { origin: 'heartbeat' | 'subagent'; autonomy: AgentAutonomyLevel | undefined } | undefined {
    if (sessionId === undefined) return undefined;
    if (this._heartbeatSessions.has(sessionId)) {
      return { origin: 'heartbeat', autonomy: this._heartbeatAutonomy.get(sessionId) };
    }
    if (this._subagentSessions.has(sessionId)) {
      return { origin: 'subagent', autonomy: this._subagentAutonomy.get(sessionId) };
    }
    return undefined;
  }

  /** Wire the autonomy log appender for queued-approval entries. */
  setAutonomyLogAppender(appender: PermissionService['_autonomyLogAppender']): void {
    this._autonomyLogAppender = appender;
  }

  /**
   * Returns true if the session is heartbeat- or subagent-marked AND its
   * autonomy level is `manual` — meaning the gate must reject *every*
   * tool, including always-allowed reads, before the fast-path approves
   * them. The tools service consults this before its `autoApproved`
   * shortcut.
   */
  isManagedSessionBlocked(sessionId: string | undefined): boolean {
    const ctx = this._getCallerContext(sessionId);
    return ctx?.autonomy === 'manual';
  }

  /**
   * @deprecated Use {@link isManagedSessionBlocked}. Kept for callers that
   * still reference the heartbeat-only spelling; behaves identically.
   */
  isHeartbeatSessionBlocked(sessionId: string | undefined): boolean {
    return this.isManagedSessionBlocked(sessionId);
  }

  /** Record an autonomy-blocked entry. Called by the tools service. */
  recordManagedAutonomyBlock(sessionId: string, toolName: string): void {
    const ctx = this._getCallerContext(sessionId);
    const origin = ctx?.origin ?? 'heartbeat';
    try {
      this._autonomyLogAppender?.append({
        origin,
        requestText: `[${origin}] tool ${toolName} blocked by autonomy=manual`,
        content: `${origin === 'heartbeat' ? 'Heartbeat' : 'Subagent'} attempted to call **${toolName}** but agent autonomy is set to *manual*. No ${origin} tool calls run at this level.`,
        metadata: { kind: 'autonomy-blocked', tool: toolName, autonomy: 'manual' },
        sessionId,
      });
    } catch {
      /* never break the gate */
    }
    this._audit({ tool: toolName, decision: 'blocked', source: 'default', timestamp: Date.now() });
  }

  /**
   * @deprecated Use {@link recordManagedAutonomyBlock}. Kept for callers
   * that still reference the heartbeat-only spelling.
   */
  recordHeartbeatAutonomyBlock(sessionId: string, toolName: string): void {
    this.recordManagedAutonomyBlock(sessionId, toolName);
  }

  /**
   * Filter a tool catalog according to the caller session's autonomy.
   * Used by participants to narrow what the model is even told it can call,
   * so heartbeat under restrictive autonomy doesn't waste round-trips
   * attempting tools that would be blocked at invoke time.
   *
   *   - non-heartbeat session     -> tools returned unchanged
   *   - autonomy=manual           -> empty list
   *   - autonomy=allow-readonly   -> only `always-allowed` tools
   *   - other autonomy            -> tools returned unchanged
   *
   * Each tool's effective level is resolved against persistent + session
   * overrides via `checkPermission`, so user-elevated tools survive the
   * readonly filter.
   */
  filterToolsForSession<T extends { name: string; permissionLevel?: ToolPermissionLevel; requiresConfirmation?: boolean }>(
    tools: readonly T[],
    sessionId: string | undefined,
  ): readonly T[] {
    const ctx = this._getCallerContext(sessionId);
    if (!ctx) {
      return tools;
    }
    if (ctx.autonomy === 'manual') {
      return [];
    }
    if (ctx.autonomy === 'allow-readonly') {
      return tools.filter((tool) => {
        const defaultLevel: ToolPermissionLevel = tool.permissionLevel
          ?? (tool.requiresConfirmation ? 'requires-approval' : 'always-allowed');
        const check = this.checkPermission(tool.name, defaultLevel);
        return check.level === 'always-allowed' || check.autoApproved;
      });
    }
    return tools;
  }

  /** Set global auto-approve mode (bypasses all confirmation). */
  setAutoApprove(enabled: boolean): void {
    this._autoApprove = enabled;
    this._onDidChange.fire();
  }

  /** Whether auto-approve is currently enabled. */
  get autoApprove(): boolean {
    return this._autoApprove;
  }

  /** Set the approval strictness from agent config. */
  setApprovalStrictness(strictness: AgentApprovalStrictness): void {
    this._approvalStrictness = strictness;
    this._onDidChange.fire();
  }

  /** Get the approval audit log. */
  getAuditLog(): readonly IApprovalAuditEntry[] {
    return this._auditLog;
  }

  /** Clear the audit log (e.g. on session reset). */
  clearAuditLog(): void {
    this._auditLog.length = 0;
  }

  // ── Session Grants ──

  /** Grant a tool session-level permission (from "Allow for session" button). */
  grantForSession(toolName: string): void {
    this._sessionGrants.set(toolName, 'always-allowed');
    this._onDidChange.fire();
  }

  /** Check if a tool has a session-level grant. */
  hasSessionGrant(toolName: string): boolean {
    return this._sessionGrants.has(toolName);
  }

  /** Clear all session grants (e.g. on new session or app restart). */
  clearSessionGrants(): void {
    this._sessionGrants.clear();
    this._onDidChange.fire();
  }

  // ── Persistent Overrides ──

  /**
   * Load persistent overrides from content of `.parallx/permissions.json`.
   * Format: `{ "tools": { "write_file": "always-allowed", "run_command": "never-allowed" } }`
   */
  loadPersistentOverrides(json: string): void {
    this._persistentOverrides.clear();

    try {
      const parsed = JSON.parse(json);
      if (parsed && typeof parsed === 'object' && parsed.tools) {
        for (const [name, level] of Object.entries(parsed.tools)) {
          if (isValidPermissionLevel(level)) {
            this._persistentOverrides.set(name, level as ToolPermissionLevel);
          }
        }
      }
    } catch {
      console.warn('[PermissionService] Failed to parse permissions.json');
    }

    this._onDidChange.fire();
  }

  /** Set a persistent override for a tool (from "Always allow" button). */
  setPersistentOverride(toolName: string, level: ToolPermissionLevel): void {
    this._persistentOverrides.set(toolName, level);
    this._onDidChange.fire();
  }

  /** Get all persistent overrides (for serializing back to permissions.json). */
  getPersistentOverrides(): ReadonlyMap<string, ToolPermissionLevel> {
    return this._persistentOverrides;
  }

  /**
   * Get the effective permission map for tool policy filtering.
   * Merges persistent overrides + session grants. Used by OpenClaw tool
   * policy to filter never-allowed tools before the model sees them.
   */
  getEffectivePermissions(): Record<string, ToolPermissionLevel> {
    const result: Record<string, ToolPermissionLevel> = {};
    for (const [name, level] of this._persistentOverrides) {
      result[name] = level;
    }
    for (const [name, level] of this._sessionGrants) {
      result[name] = level;
    }
    return result;
  }

  /**
   * Serialize current persistent overrides to JSON (for writing to permissions.json).
   */
  serializeOverrides(): string {
    const tools: Record<string, string> = {};
    for (const [name, level] of this._persistentOverrides) {
      tools[name] = level;
    }
    return JSON.stringify({ tools }, null, 2);
  }

  // ── Permission Check ──

  /**
   * Check the effective permission level for a tool.
   *
   * Priority order (highest to lowest):
   * 1. Global auto-approve → always-allowed
   * 2. Persistent override from permissions.json
   * 3. Session-level grant
   * 4. Tool's default permissionLevel (or derived from requiresConfirmation)
   */
  checkPermission(
    toolName: string,
    defaultLevel: ToolPermissionLevel,
  ): IPermissionCheckResult {
    // 1. Global auto-approve overrides everything
    if (this._autoApprove) {
      return { level: 'always-allowed', autoApproved: true, source: 'global-auto' };
    }

    // 2. Persistent override from permissions.json
    const persistent = this._persistentOverrides.get(toolName);
    if (persistent) {
      return {
        level: persistent,
        autoApproved: persistent === 'always-allowed',
        source: 'persistent',
      };
    }

    // 3. Session-level grant
    const sessionGrant = this._sessionGrants.get(toolName);
    if (sessionGrant) {
      return {
        level: sessionGrant,
        autoApproved: sessionGrant === 'always-allowed',
        source: 'session',
      };
    }

    // 4. Approval strictness override from agent config
    if (this._approvalStrictness === 'strict' && defaultLevel !== 'never-allowed') {
      // Strict: require approval for all tools regardless of default
      return { level: 'requires-approval', autoApproved: false, source: 'strictness' };
    }
    if (this._approvalStrictness === 'streamlined' && defaultLevel === 'requires-approval') {
      // Streamlined: auto-allow tools that default to requires-approval
      return { level: 'always-allowed', autoApproved: true, source: 'strictness' };
    }

    // 5. Tool's default
    return {
      level: defaultLevel,
      autoApproved: defaultLevel === 'always-allowed',
      source: 'default',
    };
  }

  // ── Confirmation Gate ──

  /**
   * Run the full confirmation gate for a tool invocation.
   *
   * Returns `true` if the tool should proceed, `false` if blocked/rejected.
   * Handles session grants and persistent overrides automatically.
   */
  async confirmToolInvocation(
    toolName: string,
    toolDescription: string,
    args: Record<string, unknown>,
    defaultLevel: ToolPermissionLevel,
    sessionId?: string,
  ): Promise<boolean> {
    const check = this.checkPermission(toolName, defaultLevel);

    // Heartbeat / subagent autonomy gate — runs BEFORE auto-approve so
    // `manual` can veto even read-only tools. Upstream parallel: agent-level
    // autonomy is a coarser dial than per-tool permission; the two compose
    // with autonomy applied first when the call originates from a managed
    // ephemeral session (heartbeat or subagent).
    const callerCtx = this._getCallerContext(sessionId);
    if (callerCtx) {
      const { origin, autonomy } = callerCtx;
      if (autonomy === 'manual') {
        try {
          this._autonomyLogAppender?.append({
            origin,
            requestText: `[${origin}] tool ${toolName} blocked by autonomy=manual`,
            content: `${origin === 'heartbeat' ? 'Heartbeat' : 'Subagent'} attempted to call **${toolName}** but agent autonomy is set to *manual*. No ${origin} tool calls run at this level.`,
            metadata: { kind: 'autonomy-blocked', tool: toolName, autonomy },
            sessionId,
          });
        } catch {
          /* never break the gate */
        }
        this._audit({ tool: toolName, decision: 'blocked', source: check.source, timestamp: Date.now() });
        return false;
      }
      if (autonomy === 'allow-policy-actions' && check.level === 'requires-approval' && !check.autoApproved) {
        // User has dialed up to fully-autonomous; auto-approve managed tool.
        this._audit({ tool: toolName, decision: 'approved', source: 'global-auto', timestamp: Date.now() });
        return true;
      }
    }

    // Auto-approved — proceed immediately
    if (check.autoApproved) {
      this._audit({ tool: toolName, decision: 'approved', source: check.source, timestamp: Date.now() });
      return true;
    }

    // Never-allowed — block immediately
    if (check.level === 'never-allowed') {
      this._audit({ tool: toolName, decision: 'blocked', source: check.source, timestamp: Date.now() });
      return false;
    }

    // Heartbeat- or subagent-originated approval-required call: don't stall
    // on a UI dialog the user can't see. Log a queued entry to the autonomy
    // log and reject. Upstream parallel: VS Code's `LanguageModelToolsService`
    // bails out when no confirmation handler is registered — same shape,
    // just routed through the autonomy log surface instead of a console
    // warning so the user has a record of the deferred action.
    if (callerCtx) {
      const { origin } = callerCtx;
      try {
        this._autonomyLogAppender?.append({
          origin,
          requestText: `[${origin}] tool ${toolName} requires approval`,
          content: `The ${origin} turn requested **${toolName}** but the tool requires approval. ${origin === 'heartbeat' ? 'Heartbeat' : 'Subagent'} output is non-interactive, so the call was deferred. Re-run from chat if you want to authorize it.`,
          metadata: { kind: 'queued-approval', tool: toolName, args },
          sessionId,
        });
      } catch {
        // Appender failures must never break the gate.
      }
      this._audit({ tool: toolName, decision: 'rejected', source: check.source, timestamp: Date.now() });
      return false;
    }

    // Requires approval — ask the user
    if (!this._confirmationHandler) {
      console.warn(`[PermissionService] Tool "${toolName}" requires approval but no handler registered`);
      this._audit({ tool: toolName, decision: 'blocked', source: 'default', timestamp: Date.now() });
      return false;
    }

    const decision = await this._confirmationHandler(toolName, toolDescription, args);

    switch (decision) {
      case 'allow-once':
        this._audit({ tool: toolName, decision: 'approved', source: check.source, timestamp: Date.now() });
        return true;

      case 'allow-session':
        this.grantForSession(toolName);
        this._audit({ tool: toolName, decision: 'approved', source: 'session', timestamp: Date.now() });
        return true;

      case 'always-allow':
        this.setPersistentOverride(toolName, 'always-allowed');
        this.grantForSession(toolName); // Also grant for current session
        this._audit({ tool: toolName, decision: 'approved', source: 'persistent', timestamp: Date.now() });
        return true;

      case 'reject':
        this._audit({ tool: toolName, decision: 'rejected', source: check.source, timestamp: Date.now() });
        return false;

      default:
        return false;
    }
  }
}

// ── Helpers ──

function isValidPermissionLevel(value: unknown): value is ToolPermissionLevel {
  return value === 'always-allowed' || value === 'requires-approval' || value === 'never-allowed';
}
