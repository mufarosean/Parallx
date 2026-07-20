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
