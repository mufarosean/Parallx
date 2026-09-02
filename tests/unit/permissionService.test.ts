// permissionService.test.ts — approval-gate behavior pins.

import { describe, expect, it } from 'vitest';
import { PermissionService } from '../../src/services/permissionService';


// ─── Forced-approval reason (2026-07-20 always-allow legibility fix) ─────────

describe('forced-approval reason threading', () => {
  it('passes a reason to the handler when forceApproval overrides an auto-approved tool', async () => {
    const svc = new PermissionService();
    svc.setPersistentOverride('canvas_edit_page', 'always-allowed');
    let seenReason: string | undefined = 'unset';
    svc.setConfirmationHandler(async (_n, _d, _a, forcedReason) => {
      seenReason = forcedReason;
      return 'allow-once';
    });
    const approved = await svc.confirmToolInvocation(
      'canvas_edit_page', 'Edit a page', {}, 'requires-approval', 'sess-1',
      { forceApproval: true },
    );
    expect(approved).toBe(true);
    expect(seenReason).toContain('Safety gate');
  });

  it('passes NO reason on an ordinary approval prompt', async () => {
    const svc = new PermissionService();
    let seenReason: string | undefined = 'unset';
    svc.setConfirmationHandler(async (_n, _d, _a, forcedReason) => {
      seenReason = forcedReason;
      return 'allow-once';
    });
    await svc.confirmToolInvocation('some_tool', 'Tool', {}, 'requires-approval', 'sess-1');
    expect(seenReason).toBeUndefined();
  });
});

// ─── M90 consent model — initiator-based permissions ─────────────────────────

describe('M90 user-task consent', () => {
  it('getSessionInitiator classifies user-task / autonomous / interactive', () => {
    const svc = new PermissionService();
    svc.markUserTaskSession('u1');
    svc.markHeartbeatSession('h1');
    expect(svc.getSessionInitiator('u1')).toBe('user-task');
    expect(svc.getSessionInitiator('h1')).toBe('autonomous');
    expect(svc.getSessionInitiator('unknown')).toBe('interactive');
    expect(svc.getSessionInitiator(undefined)).toBe('interactive');
    // A subagent runs on its parent's consent: an autonomous parent's spawn
    // is autonomous at the gate; a user-task parent's is user-task; an
    // orphan (no parent known) stays interactive.
    svc.markSubagentSession('sub-h', undefined, 'h1');
    svc.markSubagentSession('sub-u', undefined, 'u1');
    svc.markSubagentSession('sub-orphan');
    expect(svc.getSessionInitiator('sub-h')).toBe('autonomous');
    expect(svc.getSessionInitiator('sub-u')).toBe('user-task');
    expect(svc.getSessionInitiator('sub-orphan')).toBe('interactive');
    svc.unmarkSubagentSession('sub-h');
    expect(svc.getSessionInitiator('sub-h')).toBe('interactive');
  });

  it('a user-task session approves an ordinary gated tool WITHOUT calling the handler', async () => {
    const svc = new PermissionService();
    svc.markUserTaskSession('u1');
    let handlerCalled = false;
    svc.setConfirmationHandler(async () => { handlerCalled = true; return 'reject'; });
    const ok = await svc.confirmToolInvocation('canvas_edit_page', 'Edit', {}, 'requires-approval', 'u1');
    expect(ok).toBe(true);
    expect(handlerCalled).toBe(false); // gesture = consent, no prompt
  });

  it('a user-task session DEFERS the destruction belt (headless cannot prompt)', async () => {
    const logged: string[] = [];
    const svc = new PermissionService();
    svc.setAutonomyLogAppender({ append: (e) => { logged.push(String(e.metadata?.tool)); return e; } });
    svc.markUserTaskSession('u1');
    svc.setConfirmationHandler(async () => 'always-allow');
    const ok = await svc.confirmToolInvocation('terminal_run_command', 'Shell', { command: 'ls' }, 'requires-approval', 'u1');
    expect(ok).toBe(false);              // deferred, not run
    expect(logged).toContain('terminal_run_command');
  });

  it('a user-task session still respects never-allowed bans', async () => {
    const svc = new PermissionService();
    svc.setPersistentOverride('fs_write_file', 'never-allowed');
    svc.markUserTaskSession('u1');
    const ok = await svc.confirmToolInvocation('fs_write_file', 'Write', {}, 'requires-approval', 'u1');
    expect(ok).toBe(false);
  });
});
