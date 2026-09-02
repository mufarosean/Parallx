// policyDecisionPointInitiator.test.ts — M90 consent model at the PDP.
//
// The initiator decides consent: interactive/user-task turns allow ordinary
// consequential tools (the user's gesture approved them); autonomous turns
// keep the require-approval gate; the destruction belt still gates on every
// initiator.

import { describe, expect, it } from 'vitest';
import { PolicyDecisionPoint } from '../../src/services/policyDecisionPoint';
import { PermissionService } from '../../src/services/permissionService';

function setup(initiatorSession?: { id: string; kind: 'user' | 'autonomous' }) {
  const perms = new PermissionService();
  if (initiatorSession?.kind === 'user') perms.markUserTaskSession(initiatorSession.id);
  if (initiatorSession?.kind === 'autonomous') perms.markHeartbeatSession(initiatorSession.id);
  const pdp = new PolicyDecisionPoint();
  pdp.setPermissionService(perms);
  return { pdp, perms };
}

const req = (name: string, sessionId?: string) => ({
  caller: { kind: 'built-in' as const, id: 'test' },
  tool: { name, defaultLevel: 'requires-approval' as const },
  args: {},
  sessionId,
});

describe('PDP initiator routing (M90)', () => {
  it('interactive turn: ordinary consequential tool is ALLOWED without a prompt', () => {
    const { pdp } = setup();
    const d = pdp.decide(req('canvas_edit_page', 'chat-1'));
    expect(d.outcome).toBe('allow');
    expect(d.reasons).toContain('user-consent');
  });

  it('user-task turn: ordinary consequential tool is ALLOWED without a prompt', () => {
    const { pdp } = setup({ id: 'u1', kind: 'user' });
    const d = pdp.decide(req('canvas_edit_page', 'u1'));
    expect(d.outcome).toBe('allow');
  });

  it('autonomous turn: ordinary consequential tool REQUIRES approval (defers downstream)', () => {
    const { pdp } = setup({ id: 'h1', kind: 'autonomous' });
    const d = pdp.decide(req('canvas_edit_page', 'h1'));
    expect(d.outcome).toBe('require-approval');
  });

  it('the destruction belt REQUIRES approval on every initiator', () => {
    for (const kind of ['user', 'autonomous'] as const) {
      const { pdp } = setup({ id: 's', kind });
      const d = pdp.decide(req('terminal_run_command', 's'));
      expect(d.outcome, `belt on ${kind}`).toBe('require-approval');
      expect(d.reasons).toContain('destruction-belt');
    }
    const interactive = setup();
    expect(interactive.pdp.decide(req('terminal_run_command', 'chat-1')).outcome).toBe('require-approval');
  });

  it('never-allowed still denies regardless of initiator', () => {
    const { pdp, perms } = setup({ id: 'u1', kind: 'user' });
    perms.setPersistentOverride('canvas_edit_page', 'never-allowed');
    expect(pdp.decide(req('canvas_edit_page', 'u1')).outcome).toBe('deny');
  });

  it('web-read-then-write no longer forces approval (color gate removed)', async () => {
    // Even after a "red" web tool ran, a write on the same interactive turn
    // is allowed — the M65 gate is gone.
    const { pdp } = setup();
    const { markTurnTainted } = await import('../../src/openclaw/openclawToolPolicy');
    markTurnTainted('chat-1');
    const d = pdp.decide(req('canvas_edit_page', 'chat-1'));
    expect(d.outcome).toBe('allow');
  });
});

describe('Careful Mode (HARNESS.md 2.3)', () => {
  it('careful on: interactive consequential tools prompt again', () => {
    const { pdp, perms } = setup();
    perms.setCarefulMode(true);
    const d = pdp.decide(req('canvas_edit_page', 'chat-1'));
    expect(d.outcome).toBe('require-approval');
    expect(d.reasons).toContain('careful-mode');
  });

  it('careful off restores user-consent flow', () => {
    const { pdp, perms } = setup();
    perms.setCarefulMode(true);
    perms.setCarefulMode(false);
    const d = pdp.decide(req('canvas_edit_page', 'chat-1'));
    expect(d.outcome).toBe('allow');
    expect(d.reasons).toContain('user-consent');
  });

  it('careful on: a persistent "always allow" override does NOT bypass it', () => {
    const { pdp, perms } = setup();
    perms.setPersistentOverride('canvas_edit_page', 'always-allowed');
    expect(pdp.decide(req('canvas_edit_page', 'chat-1')).outcome).toBe('allow'); // the override, careful off
    perms.setCarefulMode(true);
    const d = pdp.decide(req('canvas_edit_page', 'chat-1'));
    expect(d.outcome).toBe('require-approval');
    expect(d.reasons).toContain('careful-mode');
    expect(d.forceApproval).toBe(true); // the tools layer must not let the grant satisfy it
  });

  it('careful on: a session grant does not bypass it either', () => {
    const { pdp, perms } = setup();
    perms.grantForSession('canvas_edit_page');
    perms.setCarefulMode(true);
    expect(pdp.decide(req('canvas_edit_page', 'chat-1')).outcome).toBe('require-approval');
  });

  it('careful on leaves always-allowed-by-default tools alone (reads never prompt)', () => {
    const { pdp, perms } = setup();
    perms.setCarefulMode(true);
    const d = pdp.decide({ ...req('fs_read_file', 'chat-1'), tool: { name: 'fs_read_file', defaultLevel: 'always-allowed' as const } });
    expect(d.outcome).toBe('allow');
  });

  it('the destruction belt carries forceApproval on the decision', () => {
    const { pdp } = setup();
    const d = pdp.decide(req('terminal_run_command', 'chat-1'));
    expect(d.outcome).toBe('require-approval');
    expect(d.forceApproval).toBe(true);
  });

  it('careful never loosens: autonomous turns still gate with careful off', () => {
    const { pdp } = setup({ id: 'hb-1', kind: 'autonomous' });
    const d = pdp.decide(req('canvas_edit_page', 'hb-1'));
    expect(d.outcome).toBe('require-approval');
  });
});
