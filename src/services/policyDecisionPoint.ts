// policyDecisionPoint.ts — M67 Phase 2: Policy Decision Point
//
// Single service that every tool invocation consults before execution.
// Consolidates the previously-scattered approval gates:
//
//   1. terminalTools.ts    COMMAND_BLOCKLIST  (hard-deny by command string)
//   2. permissionService   ALWAYS_REQUIRE_CONFIRMATION (safety belt)
//   3. permissionService   checkPermission (3-tier level + autoApprove)
//   4. openclawToolPolicy  resolveColorGate (M65 taint gate)
//   5. permissionService   heartbeat / subagent autonomy=manual blocking
//
// Decision rule order (first match wins — see decide()):
//   Rule 1 — terminal_run_command with a hard-blocked pattern → deny
//   Rule 2 — managed session (heartbeat/subagent) with autonomy=manual → deny
//   Rule 3 — permission service says never-allowed → deny
//   Rule 4 — ALWAYS_REQUIRE_CONFIRMATION safety belt → require-approval
//             (fires when checkPermission returned autoApproved=true via YOLO/
//             streamlined, ensuring force-confirmation tools are never silently
//             bypassed even in fully-autonomous mode)
//   Rule 5 — M65 color gate (blue tool in a red-tainted turn) → require-approval
//   Rule 6 — permission check says requires-approval (non-autoApproved) → require-approval
//   Rule 7 — otherwise → allow
//
// Audit: every decision is appended to an in-memory ring buffer (cap 500).
// The permissionService._auditLog is KEPT for permission-level decisions.
// This log captures the full composite outcome across all rules.

import type { ToolPermissionLevel } from './chatTypes.js';
import type { PermissionService, IPermissionCheckResult } from './permissionService.js';
import { getToolColor } from '../openclaw/openclawToolPolicy.js';
import { ALWAYS_REQUIRE_CONFIRMATION } from './permissionService.js';

// ── Command blocklist ─────────────────────────────────────────────────────────

/**
 * Commands hard-denied at the PDP layer regardless of user approval or YOLO
 * mode. Intentionally short: only commands whose only purpose is destruction.
 * The broader defense is the approval gate via ALWAYS_REQUIRE_CONFIRMATION.
 */
export const COMMAND_BLOCKLIST: readonly string[] = [
  'rm -rf /',
  'format c:',
  'format /',
  'mkfs',
  'dd if=',
  ':(){:|:&};:',
  'shutdown',
  'reboot',
  'halt',
  'init 0',
  'init 6',
];

function _isCommandBlocked(command: string): boolean {
  const lower = command.toLowerCase().trim();
  return COMMAND_BLOCKLIST.some((b) => lower.startsWith(b) || lower.includes(b));
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type CallerKind = 'built-in' | 'extension' | 'mcp' | 'ipc';

export interface PolicyRequest {
  readonly caller: { readonly kind: CallerKind; readonly id: string };
  readonly tool: { readonly name: string; readonly defaultLevel: ToolPermissionLevel };
  readonly args: Record<string, unknown>;
  readonly sessionId?: string;
}

export type PolicyOutcome = 'allow' | 'require-approval' | 'deny';

export interface PolicyDecision {
  readonly outcome: PolicyOutcome;
  /** Ordered list of rule names that fired, newest last. Suitable for audit. */
  readonly reasons: readonly string[];
  /** True when the decision is auto-approved (no dialog needed). */
  readonly autoApproved: boolean;
  /** Source from the underlying permission check. */
  readonly permSource: IPermissionCheckResult['source'] | 'missing-permission-service';
  /** True when the tool, if it succeeds, should taint the session turn. */
  readonly willTaintOnSuccess: boolean;
}

export interface IPolicyAuditEntry {
  readonly caller: PolicyRequest['caller'];
  readonly tool: string;
  readonly outcome: PolicyOutcome;
  readonly reasons: readonly string[];
  readonly timestamp: number;
}

// ── PolicyDecisionPoint ───────────────────────────────────────────────────────

export class PolicyDecisionPoint {
  private _permissionService: PermissionService | undefined;
  private readonly _auditLog: IPolicyAuditEntry[] = [];
  private static readonly _MAX_AUDIT = 500;

  setPermissionService(svc: PermissionService): void {
    this._permissionService = svc;
  }

  /**
   * Make a policy decision for a tool invocation request.
   *
   * Rules evaluated in order — first match wins:
   *
   *   1. terminal_run_command with a hard-blocked string → deny (no override)
   *   2. Heartbeat/subagent session with autonomy=manual → deny
   *   3. Permission service: never-allowed → deny
   *   4. ALWAYS_REQUIRE_CONFIRMATION safety belt → require-approval
   *      (fires only when checkPermission returned autoApproved, which
   *      should not happen for these tools but guards against future drift)
   *   5. M65 color gate: blue tool after red-tainted turn → require-approval
   *   6. Permission level requires-approval (non-autoApproved) → require-approval
   *   7. Otherwise → allow
   */
  decide(req: PolicyRequest): PolicyDecision {
    const { tool, args, sessionId, caller } = req;
    const { name, defaultLevel } = tool;
    const reasons: string[] = [];

    // Rule 1 — command hard-deny
    if (name === 'terminal_run_command') {
      const cmd = typeof args['command'] === 'string' ? args['command'] : '';
      if (_isCommandBlocked(cmd)) {
        reasons.push('command-blocklist');
        return this._emit(caller, name, {
          outcome: 'deny', reasons, autoApproved: false,
          permSource: 'default', willTaintOnSuccess: false,
        });
      }
    }

    // Rule 2 — managed session with autonomy=manual
    if (sessionId && this._permissionService?.isManagedSessionBlocked(sessionId)) {
      reasons.push('autonomy-manual');
      return this._emit(caller, name, {
        outcome: 'deny', reasons, autoApproved: false,
        permSource: 'default', willTaintOnSuccess: false,
      });
    }

    // Permission check (basis for rules 3, 4, 6)
    const permCheck: IPermissionCheckResult = this._permissionService
      ? this._permissionService.checkPermission(name, defaultLevel)
      : { level: defaultLevel, autoApproved: defaultLevel === 'always-allowed', source: 'default' };

    // Rule 3 — never-allowed
    if (permCheck.level === 'never-allowed') {
      reasons.push('never-allowed');
      return this._emit(caller, name, {
        outcome: 'deny', reasons, autoApproved: false,
        permSource: permCheck.source, willTaintOnSuccess: false,
      });
    }

    const willTaint = getToolColor(name) === 'red';
    const forceConfirm = ALWAYS_REQUIRE_CONFIRMATION.has(name);

    // Rule 4 — safety belt: force-confirmation tools must never be silently bypassed.
    // checkPermission already prevents autoApproved for these tools, but this is
    // defense-in-depth against future code changes that remove that guard.
    if (forceConfirm && permCheck.autoApproved) {
      reasons.push('force-confirmation-override');
      return this._emit(caller, name, {
        outcome: 'require-approval', reasons, autoApproved: false,
        permSource: permCheck.source, willTaintOnSuccess: willTaint,
      });
    }

    // Rule 5 (M65 web-taint color gate) REMOVED — M90 consent model,
    // Mufaro's explicit informed decision 2026-07-20 ("remove it entirely",
    // injection risk shown and accepted; docs/Parallx_Milestone_90.md).
    // Web-read-then-write no longer forces re-approval on any turn type.
    // Taint bookkeeping still runs (markTurnTainted) but gates nothing; the
    // transcript's tool cards are the visibility mechanism.

    // Rule 6 — requires-approval gates ONLY autonomous sessions (M90).
    // Interactive turns and user-task runs (a widget Refresh click) were
    // started by an explicit user gesture — the gesture IS the approval, so
    // ordinary consequential tools proceed. Autonomous sessions
    // (heartbeat/cron/scheduled refresh) keep the gate; downstream they
    // defer to the autonomy log per the dial.
    if (permCheck.level === 'requires-approval' && !permCheck.autoApproved) {
      const initiator = this._permissionService?.getSessionInitiator(sessionId) ?? 'interactive';
      // The destruction belt (shell, file-delete) still routes to
      // require-approval on EVERY initiator — irreversible, low-frequency,
      // and NOT part of the M90 relaxation (Mufaro kept it). Downstream:
      // interactive prompts, user-task/autonomous defer to the log.
      //
      // HARNESS.md §2.3 — Careful Mode suspends the user-consent relaxation:
      // when the user flips it on, interactive turns prompt for every
      // consequential tool again. This is the ONE honest gating switch that
      // replaced the never-wired autonomy dial in the mode picker.
      const careful = this._permissionService?.isCarefulMode() === true;
      if (initiator === 'autonomous' || forceConfirm || careful) {
        reasons.push(forceConfirm ? 'destruction-belt' : careful ? 'careful-mode' : `requires-approval:${permCheck.source}`);
        return this._emit(caller, name, {
          outcome: 'require-approval', reasons, autoApproved: false,
          permSource: permCheck.source, willTaintOnSuccess: willTaint,
        });
      }
      // Interactive or user-task turn, ordinary write — the user's gesture
      // approved it (M90 consent model). Proceed without a prompt.
      reasons.push('user-consent');
      return this._emit(caller, name, {
        outcome: 'allow', reasons, autoApproved: true,
        permSource: 'user-consent', willTaintOnSuccess: willTaint,
      });
    }

    // Rule 7 — allow
    reasons.push(`allow:${permCheck.source}`);
    return this._emit(caller, name, {
      outcome: 'allow', reasons, autoApproved: permCheck.autoApproved,
      permSource: permCheck.source, willTaintOnSuccess: willTaint,
    });
  }

  getAuditLog(): readonly IPolicyAuditEntry[] {
    return this._auditLog;
  }

  clearAuditLog(): void {
    this._auditLog.length = 0;
  }

  private _emit(
    caller: PolicyRequest['caller'],
    tool: string,
    decision: PolicyDecision,
  ): PolicyDecision {
    this._auditLog.push({ caller, tool, outcome: decision.outcome, reasons: decision.reasons, timestamp: Date.now() });
    if (this._auditLog.length > PolicyDecisionPoint._MAX_AUDIT) {
      this._auditLog.splice(0, this._auditLog.length - PolicyDecisionPoint._MAX_AUDIT);
    }
    return decision;
  }
}
