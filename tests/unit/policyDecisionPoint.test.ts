// policyDecisionPoint.test.ts — pin PolicyDecisionPoint rule ordering + audit log.
//
// Rule order (first match wins): blocklist → autonomy-manual → never-allowed →
// force-confirmation-override → color-gate → requires-approval → allow.
//
// Pins:
//   - COMMAND_BLOCKLIST: lower+trim, startsWith OR includes match. Several entries
//     verified ('rm -rf /', 'shutdown', 'mkfs', etc.); allow path for benign cmd.
//   - Rule 1 fires only for tool name === 'run_command'.
//   - Rule 2 fires only when sessionId present AND isManagedSessionBlocked=true.
//   - With NO permission service: default permCheck = level=defaultLevel,
//     autoApproved iff level==='always-allowed', source='default'.
//   - Rule 3 'never-allowed' → deny.
//   - Rule 4 force-confirmation-override fires only when permCheck.autoApproved
//     AND tool in ALWAYS_REQUIRE_CONFIRMATION (run_command, delete_file).
//   - Rule 5 color gate: blue tool + tainted session → requires-approval with
//     reason 'color-gate-blue-post-red'. Without taint → falls through.
//   - Rule 6 requires-approval (non-autoApproved) → require-approval with
//     reason 'requires-approval:{source}'.
//   - Rule 7 allow → reason 'allow:{source}'.
//   - willTaintOnSuccess = getToolColor === 'red' on outcomes that compute it.
//   - Audit log: pushes entry on every decision; cap 500 (excess shifted out).

import { describe, it, expect } from 'vitest';
import { PolicyDecisionPoint, COMMAND_BLOCKLIST } from '../../src/services/policyDecisionPoint';
import { markTurnTainted, _resetColorGateRegistryForTests } from '../../src/openclaw/openclawToolPolicy';

type Caller = { kind: 'built-in' | 'extension' | 'mcp' | 'ipc'; id: string };
const caller: Caller = { kind: 'built-in', id: 't' };

function mkReq(tool: string, defaultLevel: any, args: any = {}, sessionId?: string) {
  return { caller, tool: { name: tool, defaultLevel }, args, sessionId };
}

function makePermSvcStub(opts: {
  managed?: boolean;
  level?: 'always-allowed' | 'requires-approval' | 'never-allowed';
  autoApproved?: boolean;
  source?: any;
}) {
  return {
    isManagedSessionBlocked: () => !!opts.managed,
    checkPermission: () => ({
      level: opts.level ?? 'requires-approval',
      autoApproved: !!opts.autoApproved,
      source: opts.source ?? 'default',
    }),
  } as any;
}

describe('PolicyDecisionPoint — blocklist (Rule 1)', () => {
  it('blocks rm -rf / via startsWith (lower+trim)', () => {
    const pdp = new PolicyDecisionPoint();
    const d = pdp.decide(mkReq('run_command', 'always-allowed', { command: '  RM -RF /  ' }));
    expect(d.outcome).toBe('deny');
    expect(d.reasons).toContain('command-blocklist');
  });

  it('blocks via substring includes (e.g. piped shutdown)', () => {
    const pdp = new PolicyDecisionPoint();
    const d = pdp.decide(mkReq('run_command', 'always-allowed', { command: 'echo hi && shutdown -h now' }));
    expect(d.outcome).toBe('deny');
  });

  it('does NOT apply blocklist to non-run_command tools', () => {
    const pdp = new PolicyDecisionPoint();
    pdp.setPermissionService(makePermSvcStub({ level: 'always-allowed', autoApproved: true }));
    const d = pdp.decide(mkReq('write_file', 'always-allowed', { command: 'shutdown' }));
    expect(d.outcome).not.toBe('deny');
  });

  it('benign run_command falls through to permission check', () => {
    const pdp = new PolicyDecisionPoint();
    pdp.setPermissionService(makePermSvcStub({ level: 'requires-approval', autoApproved: false, source: 'default' }));
    const d = pdp.decide(mkReq('run_command', 'requires-approval', { command: 'echo hi' }));
    // run_command is in ALWAYS_REQUIRE_CONFIRMATION, but rule 4 only triggers
    // when permCheck.autoApproved=true. Here permCheck is non-auto → rule 6.
    expect(d.outcome).toBe('require-approval');
    expect(d.reasons.some(r => r.startsWith('requires-approval:'))).toBe(true);
  });

  it('exports a non-empty blocklist containing key destructive prefixes', () => {
    expect(COMMAND_BLOCKLIST).toContain('rm -rf /');
    expect(COMMAND_BLOCKLIST).toContain('mkfs');
    expect(COMMAND_BLOCKLIST).toContain('shutdown');
  });
});

describe('PolicyDecisionPoint — autonomy-manual (Rule 2)', () => {
  it('denies when permission service reports session blocked', () => {
    const pdp = new PolicyDecisionPoint();
    pdp.setPermissionService(makePermSvcStub({ managed: true }));
    const d = pdp.decide(mkReq('write_file', 'requires-approval', {}, 'sess-1'));
    expect(d.outcome).toBe('deny');
    expect(d.reasons).toEqual(['autonomy-manual']);
  });

  it('does NOT trigger when sessionId omitted', () => {
    const pdp = new PolicyDecisionPoint();
    pdp.setPermissionService(makePermSvcStub({ managed: true, level: 'always-allowed', autoApproved: true }));
    const d = pdp.decide(mkReq('write_file', 'requires-approval'));
    expect(d.outcome).not.toBe('deny');
  });
});

describe('PolicyDecisionPoint — never-allowed (Rule 3)', () => {
  it('denies when permission level resolves never-allowed', () => {
    const pdp = new PolicyDecisionPoint();
    pdp.setPermissionService(makePermSvcStub({ level: 'never-allowed' }));
    const d = pdp.decide(mkReq('write_file', 'requires-approval'));
    expect(d.outcome).toBe('deny');
    expect(d.reasons).toEqual(['never-allowed']);
  });
});

describe('PolicyDecisionPoint — force-confirmation-override (Rule 4)', () => {
  it('forces approval when ALWAYS_REQUIRE_CONFIRMATION tool was auto-approved', () => {
    const pdp = new PolicyDecisionPoint();
    pdp.setPermissionService(makePermSvcStub({ level: 'always-allowed', autoApproved: true, source: 'override' }));
    const d = pdp.decide(mkReq('delete_file', 'requires-approval'));
    expect(d.outcome).toBe('require-approval');
    expect(d.reasons).toEqual(['force-confirmation-override']);
    expect(d.autoApproved).toBe(false);
  });
});

describe('PolicyDecisionPoint — color gate (Rule 5)', () => {
  it('forces approval when blue tool runs in tainted session', () => {
    _resetColorGateRegistryForTests();
    markTurnTainted('sess-red');
    const pdp = new PolicyDecisionPoint();
    pdp.setPermissionService(makePermSvcStub({ level: 'always-allowed', autoApproved: true }));
    // write_file is blue (not in ALWAYS_REQUIRE_CONFIRMATION, so rule 4 skipped)
    const d = pdp.decide(mkReq('write_file', 'requires-approval', {}, 'sess-red'));
    expect(d.outcome).toBe('require-approval');
    expect(d.reasons).toEqual(['color-gate-blue-post-red']);
    _resetColorGateRegistryForTests();
  });

  it('does NOT fire for blue tool when session untainted', () => {
    _resetColorGateRegistryForTests();
    const pdp = new PolicyDecisionPoint();
    pdp.setPermissionService(makePermSvcStub({ level: 'always-allowed', autoApproved: true }));
    const d = pdp.decide(mkReq('write_file', 'requires-approval', {}, 'sess-clean'));
    expect(d.outcome).toBe('allow');
  });
});

describe('PolicyDecisionPoint — requires-approval (Rule 6) and allow (Rule 7)', () => {
  it('Rule 6: emits requires-approval:{source}', () => {
    const pdp = new PolicyDecisionPoint();
    pdp.setPermissionService(makePermSvcStub({ level: 'requires-approval', autoApproved: false, source: 'default' }));
    const d = pdp.decide(mkReq('edit_file', 'requires-approval'));
    expect(d.outcome).toBe('require-approval');
    expect(d.reasons).toEqual(['requires-approval:default']);
  });

  it('Rule 7: allow:{source}; autoApproved propagated', () => {
    const pdp = new PolicyDecisionPoint();
    pdp.setPermissionService(makePermSvcStub({ level: 'always-allowed', autoApproved: true, source: 'override' }));
    const d = pdp.decide(mkReq('read_file', 'always-allowed'));
    expect(d.outcome).toBe('allow');
    expect(d.reasons).toEqual(['allow:override']);
    expect(d.autoApproved).toBe(true);
  });

  it('with NO permission service: default = level=defaultLevel, autoApproved iff always-allowed', () => {
    const pdp = new PolicyDecisionPoint();
    const allow = pdp.decide(mkReq('read_file', 'always-allowed'));
    expect(allow.outcome).toBe('allow');
    expect(allow.reasons).toEqual(['allow:default']);
    expect(allow.autoApproved).toBe(true);

    const pdp2 = new PolicyDecisionPoint();
    const req = pdp2.decide(mkReq('edit_file', 'requires-approval'));
    expect(req.outcome).toBe('require-approval');
    expect(req.reasons).toEqual(['requires-approval:default']);
  });
});

describe('PolicyDecisionPoint — willTaintOnSuccess', () => {
  it('true for red tools (webSearch/webFetch); false otherwise', () => {
    const pdp = new PolicyDecisionPoint();
    pdp.setPermissionService(makePermSvcStub({ level: 'always-allowed', autoApproved: true }));
    expect(pdp.decide(mkReq('webSearch', 'always-allowed')).willTaintOnSuccess).toBe(true);
    expect(pdp.decide(mkReq('read_file', 'always-allowed')).willTaintOnSuccess).toBe(false);
  });
});

describe('PolicyDecisionPoint — audit log', () => {
  it('appends one entry per decide() and caps at 500', () => {
    const pdp = new PolicyDecisionPoint();
    pdp.setPermissionService(makePermSvcStub({ level: 'always-allowed', autoApproved: true }));
    for (let i = 0; i < 503; i++) pdp.decide(mkReq('read_file', 'always-allowed'));
    expect(pdp.getAuditLog().length).toBe(500);
  });

  it('clearAuditLog empties it', () => {
    const pdp = new PolicyDecisionPoint();
    pdp.setPermissionService(makePermSvcStub({ level: 'always-allowed', autoApproved: true }));
    pdp.decide(mkReq('read_file', 'always-allowed'));
    expect(pdp.getAuditLog().length).toBe(1);
    pdp.clearAuditLog();
    expect(pdp.getAuditLog().length).toBe(0);
  });
});
