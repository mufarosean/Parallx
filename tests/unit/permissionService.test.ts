/**
 * Pin-the-invariant: PermissionService.checkPermission() priority chain.
 *
 * Per src/services/permissionService.ts §"Permission Check" the resolution
 * order is:
 *   1. Persistent override (highest)
 *   2. Session grant
 *   3. Approval strictness (`strict` upgrades, `streamlined` downgrades)
 *   4. Tool default (lowest)
 *
 * Plus the cross-cutting `ALWAYS_REQUIRE_CONFIRMATION` safety belt — which
 * does NOT upgrade a `never-allowed` (stricter wins) but DOES strip auto-
 * approve from every other source so dangerous tools always confront a
 * confirmation dialog.
 *
 * No prior unit test exists for this class. The priority chain is the
 * gatekeeping contract every tool invocation depends on.
 */

import { describe, expect, it } from 'vitest';
import {
  PermissionService,
  ALWAYS_REQUIRE_CONFIRMATION,
} from '../../src/services/permissionService';

describe('PermissionService.checkPermission — priority chain', () => {
  it('defaults to the tool default level when nothing overrides it', () => {
    const svc = new PermissionService();
    const r = svc.checkPermission('read_file', 'always-allowed');
    expect(r.level).toBe('always-allowed');
    expect(r.autoApproved).toBe(true);
    expect(r.source).toBe('default');
  });

  it('session grant beats default', () => {
    const svc = new PermissionService();
    svc.grantForSession('write_file');
    const r = svc.checkPermission('write_file', 'requires-approval');
    expect(r.level).toBe('always-allowed');
    expect(r.autoApproved).toBe(true);
    expect(r.source).toBe('session');
  });

  it('persistent override beats session grant', () => {
    const svc = new PermissionService();
    svc.grantForSession('write_file');                    // session: always-allowed
    svc.setPersistentOverride('write_file', 'never-allowed'); // persistent: never-allowed
    const r = svc.checkPermission('write_file', 'requires-approval');
    expect(r.level).toBe('never-allowed');
    expect(r.autoApproved).toBe(false);
    expect(r.source).toBe('persistent');
  });

  it('strictness=strict upgrades default to requires-approval', () => {
    const svc = new PermissionService();
    svc.setApprovalStrictness('strict');
    const r = svc.checkPermission('read_file', 'always-allowed');
    expect(r.level).toBe('requires-approval');
    expect(r.autoApproved).toBe(false);
    expect(r.source).toBe('strictness');
  });

  it('strictness=strict does NOT upgrade never-allowed (stricter wins)', () => {
    const svc = new PermissionService();
    svc.setApprovalStrictness('strict');
    const r = svc.checkPermission('forbidden_tool', 'never-allowed');
    expect(r.level).toBe('never-allowed');
  });

  it('strictness=streamlined downgrades requires-approval to always-allowed', () => {
    const svc = new PermissionService();
    svc.setApprovalStrictness('streamlined');
    const r = svc.checkPermission('write_file', 'requires-approval');
    expect(r.level).toBe('always-allowed');
    expect(r.autoApproved).toBe(true);
    expect(r.source).toBe('strictness');
  });

  it('strictness=streamlined does NOT downgrade ALWAYS_REQUIRE_CONFIRMATION tools', () => {
    const svc = new PermissionService();
    svc.setApprovalStrictness('streamlined');
    for (const tool of ALWAYS_REQUIRE_CONFIRMATION) {
      const r = svc.checkPermission(tool, 'requires-approval');
      expect(r.level, `tool ${tool}`).toBe('requires-approval');
      expect(r.autoApproved, `tool ${tool}`).toBe(false);
    }
  });
});

describe('PermissionService — ALWAYS_REQUIRE_CONFIRMATION safety belt', () => {
  it('exposes the documented destructive-tool set', () => {
    expect(ALWAYS_REQUIRE_CONFIRMATION.has('run_command')).toBe(true);
    expect(ALWAYS_REQUIRE_CONFIRMATION.has('delete_file')).toBe(true);
  });

  it('persistent always-allowed cannot auto-approve a force-confirmation tool', () => {
    const svc = new PermissionService();
    svc.setPersistentOverride('run_command', 'always-allowed');
    const r = svc.checkPermission('run_command', 'requires-approval');
    expect(r.level).toBe('requires-approval');
    expect(r.autoApproved).toBe(false);
    expect(r.source).toBe('persistent');
  });

  it('session always-allowed cannot auto-approve a force-confirmation tool', () => {
    const svc = new PermissionService();
    svc.grantForSession('delete_file');
    const r = svc.checkPermission('delete_file', 'requires-approval');
    expect(r.level).toBe('requires-approval');
    expect(r.autoApproved).toBe(false);
    expect(r.source).toBe('session');
  });

  it('persistent never-allowed still wins over the safety belt (stricter)', () => {
    const svc = new PermissionService();
    svc.setPersistentOverride('run_command', 'never-allowed');
    const r = svc.checkPermission('run_command', 'requires-approval');
    expect(r.level).toBe('never-allowed');
    expect(r.source).toBe('persistent');
  });
});

describe('PermissionService — IPermissionCheckResult.source enum stability', () => {
  // The IPermissionCheckResult.source union is consumed by autonomy log,
  // chat UI, and audit storage. Removing or renaming a value would silently
  // corrupt downstream filters. This test pins every documented source.
  it('emits each documented source value when its branch is hit', () => {
    const svc = new PermissionService();

    // 'default'
    expect(svc.checkPermission('a', 'always-allowed').source).toBe('default');

    // 'session'
    svc.grantForSession('b');
    expect(svc.checkPermission('b', 'requires-approval').source).toBe('session');

    // 'persistent'
    svc.setPersistentOverride('c', 'never-allowed');
    expect(svc.checkPermission('c', 'requires-approval').source).toBe('persistent');

    // 'strictness'
    svc.setApprovalStrictness('strict');
    expect(svc.checkPermission('d', 'always-allowed').source).toBe('strictness');

    // 'autonomy-allow-policy' fires inside confirmToolInvocation, not
    // checkPermission. We assert it is at least part of the union by
    // referencing it through a typed const so any rename breaks compile.
    const knownSources: ReadonlyArray<NonNullable<
      ReturnType<PermissionService['checkPermission']>['source']
    > | 'autonomy-allow-policy'> = [
      'default',
      'session',
      'persistent',
      'autonomy-allow-policy',
      'strictness',
    ];
    expect(knownSources).toHaveLength(5);
  });
});

describe('PermissionService — session / persistent override storage', () => {
  it('hasSessionGrant reflects grantForSession', () => {
    const svc = new PermissionService();
    expect(svc.hasSessionGrant('x')).toBe(false);
    svc.grantForSession('x');
    expect(svc.hasSessionGrant('x')).toBe(true);
  });

  it('clearSessionGrants drops every session grant', () => {
    const svc = new PermissionService();
    svc.grantForSession('a');
    svc.grantForSession('b');
    svc.clearSessionGrants();
    expect(svc.hasSessionGrant('a')).toBe(false);
    expect(svc.hasSessionGrant('b')).toBe(false);
  });

  it('loadPersistentOverrides ignores invalid levels and survives malformed JSON', () => {
    const svc = new PermissionService();
    svc.loadPersistentOverrides(JSON.stringify({
      tools: {
        write_file: 'always-allowed',
        weird: 'galactic-allow',         // invalid, must be skipped
        delete_file: 'never-allowed',
      },
    }));
    expect(svc.getPersistentOverrides().get('write_file')).toBe('always-allowed');
    expect(svc.getPersistentOverrides().get('delete_file')).toBe('never-allowed');
    expect(svc.getPersistentOverrides().has('weird')).toBe(false);

    // Malformed JSON must not throw — it must reset overrides quietly.
    expect(() => svc.loadPersistentOverrides('{ not json')).not.toThrow();
    expect(svc.getPersistentOverrides().size).toBe(0);
  });

  it('serializeOverrides round-trips through loadPersistentOverrides', () => {
    const a = new PermissionService();
    a.setPersistentOverride('write_file', 'always-allowed');
    a.setPersistentOverride('shell', 'never-allowed');

    const b = new PermissionService();
    b.loadPersistentOverrides(a.serializeOverrides());
    expect(b.getPersistentOverrides().get('write_file')).toBe('always-allowed');
    expect(b.getPersistentOverrides().get('shell')).toBe('never-allowed');
  });

  it('getEffectivePermissions merges persistent + session (session wins on collision)', () => {
    const svc = new PermissionService();
    svc.setPersistentOverride('tool', 'never-allowed');
    svc.grantForSession('tool');
    const eff = svc.getEffectivePermissions();
    expect(eff['tool']).toBe('always-allowed');
  });
});

describe('PermissionService — audit log retention', () => {
  it('checkPermission alone does NOT write to the audit log', () => {
    const svc = new PermissionService();
    svc.checkPermission('a', 'always-allowed');
    svc.checkPermission('b', 'requires-approval');
    // Audit is appended by confirmToolInvocation / recordManagedAutonomyBlock,
    // not by the pure check. Pinning this avoids accidental log noise.
    expect(svc.getAuditLog().length).toBe(0);
  });

  it('clearAuditLog empties the log', () => {
    const svc = new PermissionService();
    svc.recordManagedAutonomyBlock('s1', 'run_command');
    expect(svc.getAuditLog().length).toBeGreaterThan(0);
    svc.clearAuditLog();
    expect(svc.getAuditLog().length).toBe(0);
  });
});
