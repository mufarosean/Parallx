/**
 * Pin-the-invariant: PolicyDecisionPoint decision-rule ordering (M67 Phase 2).
 *
 * `PolicyDecisionPoint.decide()` consolidates five previously-scattered
 * approval gates into one ordered rule sequence. The rule order is a
 * load-bearing security invariant — every reordering or omission silently
 * changes what gets allowed without prompting the user.
 *
 * Rule order (first match wins) per src/services/policyDecisionPoint.ts:
 *   1. `run_command` with command-blocklist match            → deny
 *   2. Managed session (heartbeat/subagent) autonomy=manual → deny
 *   3. Permission service: never-allowed                    → deny
 *   4. ALWAYS_REQUIRE_CONFIRMATION safety belt              → require-approval
 *   5. M65 color gate (blue tool in red-tainted turn)       → require-approval
 *   6. Permission requires-approval (non-autoApproved)      → require-approval
 *   7. Otherwise                                            → allow
 *
 * No test for PolicyDecisionPoint existed before this file.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import {
  PolicyDecisionPoint,
  COMMAND_BLOCKLIST,
  type PolicyRequest,
} from '../../src/services/policyDecisionPoint';
import {
  markTurnTainted,
  _resetColorGateRegistryForTests,
} from '../../src/openclaw/openclawToolPolicy';

interface StubPermResult {
  level: 'always-allowed' | 'requires-approval' | 'never-allowed';
  autoApproved: boolean;
  source: 'default' | 'session' | 'persistent' | 'autonomy-allow-policy' | 'strictness';
}

function makeStubPermissionService(opts: {
  managedBlockedSessions?: Set<string>;
  perToolResult?: Record<string, StubPermResult>;
  defaultResult?: StubPermResult;
} = {}) {
  return {
    isManagedSessionBlocked(sessionId: string | undefined): boolean {
      if (!sessionId) return false;
      return opts.managedBlockedSessions?.has(sessionId) ?? false;
    },
    checkPermission(toolName: string, defaultLevel: string): StubPermResult {
      if (opts.perToolResult && opts.perToolResult[toolName]) {
        return opts.perToolResult[toolName];
      }
      if (opts.defaultResult) return opts.defaultResult;
      return {
        level: defaultLevel as any,
        autoApproved: defaultLevel === 'always-allowed',
        source: 'default',
      };
    },
  };
}

function req(partial: Partial<PolicyRequest> & { name: string }): PolicyRequest {
  return {
    caller: { kind: 'built-in', id: 'test' },
    tool: { name: partial.name, defaultLevel: partial.tool?.defaultLevel ?? 'always-allowed' },
    args: partial.args ?? {},
    sessionId: partial.sessionId,
  } as PolicyRequest;
}

describe('PolicyDecisionPoint decision-rule ordering (M67)', () => {
  beforeEach(() => {
    _resetColorGateRegistryForTests();
  });

  it('Rule 1: run_command with blocklisted command denies regardless of permissions', () => {
    const pdp = new PolicyDecisionPoint();
    pdp.setPermissionService(makeStubPermissionService({
      defaultResult: { level: 'always-allowed', autoApproved: true, source: 'default' },
    }) as any);

    const decision = pdp.decide(req({
      name: 'run_command',
      args: { command: 'rm -rf /' },
      tool: { name: 'run_command', defaultLevel: 'always-allowed' },
    } as any));

    expect(decision.outcome).toBe('deny');
    expect(decision.reasons).toContain('command-blocklist');
  });

  it('Rule 1: run_command with safe command falls through to lower rules (allow)', () => {
    const pdp = new PolicyDecisionPoint();
    pdp.setPermissionService(makeStubPermissionService({
      defaultResult: { level: 'always-allowed', autoApproved: true, source: 'default' },
    }) as any);

    const decision = pdp.decide(req({
      name: 'run_command',
      args: { command: 'echo hi' },
      tool: { name: 'run_command', defaultLevel: 'always-allowed' },
    } as any));

    // run_command is in ALWAYS_REQUIRE_CONFIRMATION → Rule 4 fires
    expect(decision.outcome).toBe('require-approval');
    expect(decision.reasons).toContain('force-confirmation-override');
  });

  it('Rule 2: managed session with autonomy=manual denies, beats every later rule', () => {
    const pdp = new PolicyDecisionPoint();
    pdp.setPermissionService(makeStubPermissionService({
      managedBlockedSessions: new Set(['s1']),
      defaultResult: { level: 'never-allowed', autoApproved: false, source: 'persistent' },
    }) as any);

    const decision = pdp.decide(req({
      name: 'read_file',
      sessionId: 's1',
      tool: { name: 'read_file', defaultLevel: 'always-allowed' },
    } as any));

    expect(decision.outcome).toBe('deny');
    expect(decision.reasons).toEqual(['autonomy-manual']);
  });

  it('Rule 3: never-allowed beats Rule 4/5/6/7', () => {
    const pdp = new PolicyDecisionPoint();
    pdp.setPermissionService(makeStubPermissionService({
      defaultResult: { level: 'never-allowed', autoApproved: false, source: 'persistent' },
    }) as any);

    const decision = pdp.decide(req({
      name: 'read_file',
      tool: { name: 'read_file', defaultLevel: 'always-allowed' },
    } as any));

    expect(decision.outcome).toBe('deny');
    expect(decision.reasons).toContain('never-allowed');
  });

  it('Rule 4: ALWAYS_REQUIRE_CONFIRMATION safety belt fires even if perm autoApproved', () => {
    const pdp = new PolicyDecisionPoint();
    pdp.setPermissionService(makeStubPermissionService({
      perToolResult: {
        'delete_file': { level: 'always-allowed', autoApproved: true, source: 'session' },
      },
    }) as any);

    const decision = pdp.decide(req({
      name: 'delete_file',
      tool: { name: 'delete_file', defaultLevel: 'always-allowed' },
    } as any));

    expect(decision.outcome).toBe('require-approval');
    expect(decision.reasons).toContain('force-confirmation-override');
    expect(decision.autoApproved).toBe(false);
  });

  it('Rule 5: blue tool in red-tainted turn requires approval even if perm is always-allowed', () => {
    const pdp = new PolicyDecisionPoint();
    pdp.setPermissionService(makeStubPermissionService({
      defaultResult: { level: 'always-allowed', autoApproved: true, source: 'session' },
    }) as any);

    markTurnTainted('s-tainted');

    // write_file is blue, not in ALWAYS_REQUIRE_CONFIRMATION → falls to Rule 5
    const decision = pdp.decide(req({
      name: 'write_file',
      sessionId: 's-tainted',
      tool: { name: 'write_file', defaultLevel: 'always-allowed' },
    } as any));

    expect(decision.outcome).toBe('require-approval');
    expect(decision.reasons).toContain('color-gate-blue-post-red');
    expect(decision.willTaintOnSuccess).toBe(false); // write_file is blue, not red
  });

  it('Rule 5 does NOT fire when there is no taint', () => {
    const pdp = new PolicyDecisionPoint();
    pdp.setPermissionService(makeStubPermissionService({
      defaultResult: { level: 'always-allowed', autoApproved: true, source: 'session' },
    }) as any);

    const decision = pdp.decide(req({
      name: 'write_file',
      sessionId: 's-clean',
      tool: { name: 'write_file', defaultLevel: 'always-allowed' },
    } as any));

    expect(decision.outcome).toBe('allow');
    expect(decision.reasons.some(r => r.startsWith('allow:'))).toBe(true);
  });

  it('Rule 6: requires-approval (non-autoApproved) propagates source in reasons', () => {
    const pdp = new PolicyDecisionPoint();
    pdp.setPermissionService(makeStubPermissionService({
      defaultResult: { level: 'requires-approval', autoApproved: false, source: 'persistent' },
    }) as any);

    const decision = pdp.decide(req({
      name: 'read_file',
      tool: { name: 'read_file', defaultLevel: 'requires-approval' },
    } as any));

    expect(decision.outcome).toBe('require-approval');
    expect(decision.reasons).toContain('requires-approval:persistent');
  });

  it('Rule 7: clean allow path returns autoApproved with source-prefixed reason', () => {
    const pdp = new PolicyDecisionPoint();
    pdp.setPermissionService(makeStubPermissionService({
      defaultResult: { level: 'always-allowed', autoApproved: true, source: 'session' },
    }) as any);

    const decision = pdp.decide(req({
      name: 'read_file',
      tool: { name: 'read_file', defaultLevel: 'always-allowed' },
    } as any));

    expect(decision.outcome).toBe('allow');
    expect(decision.autoApproved).toBe(true);
    expect(decision.reasons).toContain('allow:session');
  });

  it('webSearch (red tool) has willTaintOnSuccess=true', () => {
    const pdp = new PolicyDecisionPoint();
    pdp.setPermissionService(makeStubPermissionService({
      defaultResult: { level: 'always-allowed', autoApproved: true, source: 'session' },
    }) as any);

    const decision = pdp.decide(req({
      name: 'webSearch',
      tool: { name: 'webSearch', defaultLevel: 'always-allowed' },
    } as any));

    expect(decision.outcome).toBe('allow');
    expect(decision.willTaintOnSuccess).toBe(true);
  });

  it('missing permission service falls back to defaults (no crash)', () => {
    const pdp = new PolicyDecisionPoint();
    // intentionally not setting permissionService

    const decision = pdp.decide(req({
      name: 'read_file',
      tool: { name: 'read_file', defaultLevel: 'always-allowed' },
    } as any));

    expect(decision.outcome).toBe('allow');
    expect(decision.permSource).toBe('default');
  });

  it('audit log retains decision entries up to bounded cap', () => {
    const pdp = new PolicyDecisionPoint();
    pdp.setPermissionService(makeStubPermissionService({
      defaultResult: { level: 'always-allowed', autoApproved: true, source: 'session' },
    }) as any);

    pdp.decide(req({ name: 'read_file', tool: { name: 'read_file', defaultLevel: 'always-allowed' } } as any));
    pdp.decide(req({ name: 'write_file', tool: { name: 'write_file', defaultLevel: 'always-allowed' } } as any));

    const log = pdp.getAuditLog();
    expect(log.length).toBe(2);
    expect(log[0].tool).toBe('read_file');
    expect(log[1].tool).toBe('write_file');
  });

  it('COMMAND_BLOCKLIST is non-empty and contains the canonical destructive patterns', () => {
    // Guard against accidental emptying of the blocklist constant.
    expect(COMMAND_BLOCKLIST.length).toBeGreaterThan(0);
    expect(COMMAND_BLOCKLIST).toContain('rm -rf /');
    expect(COMMAND_BLOCKLIST).toContain('mkfs');
  });
});
