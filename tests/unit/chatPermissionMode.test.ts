// The permission mode as the chat uses it (utilities/chatPermissionMode.ts):
// a skill's tool gated through the mode, and the mode kept per workspace.

import { describe, expect, it } from 'vitest';
import { PermissionService } from '../../src/services/permissionService';
import { PERMISSION_MODE_STORAGE_KEY, keepPermissionMode, resolveSkillPermission } from '../../src/built-in/chat/utilities/chatPermissionMode';

describe('a skill through the mode', () => {
  const setup = () => {
    const perms = new PermissionService();
    perms.markHeartbeatSession('h1');
    return perms;
  };

  it('with no permission service, the skill\'s own level decides', () => {
    expect(resolveSkillPermission(undefined, 'x', 'always-allowed').autoApproved).toBe(true);
    expect(resolveSkillPermission(undefined, 'x', 'requires-approval').autoApproved).toBe(false);
  });

  it('Ask: a turn the user started runs a requires-approval skill on their consent; an autonomous turn asks', () => {
    const perms = setup();
    expect(resolveSkillPermission(perms, 'x', 'requires-approval', 'chat-1')).toMatchObject({ autoApproved: true, source: 'user-consent' });
    expect(resolveSkillPermission(perms, 'x', 'requires-approval', 'h1')).toMatchObject({ autoApproved: false });
    expect(resolveSkillPermission(perms, 'x', 'always-allowed', 'h1')).toMatchObject({ autoApproved: true, source: 'default' });
  });

  it('Auto runs it, Careful asks, a ban holds in every mode', () => {
    const perms = setup();
    perms.setPermissionMode('auto');
    expect(resolveSkillPermission(perms, 'x', 'requires-approval', 'chat-1')).toMatchObject({ autoApproved: true, source: 'auto' });
    expect(resolveSkillPermission(perms, 'x', 'requires-approval', 'h1')).toMatchObject({ autoApproved: false });
    perms.setPermissionMode('careful');
    perms.grantForSession('x');
    expect(resolveSkillPermission(perms, 'x', 'requires-approval', 'chat-1')).toMatchObject({ autoApproved: false });
    perms.setPermissionMode('auto');
    perms.setPersistentOverride('x', 'never-allowed');
    expect(resolveSkillPermission(perms, 'x', 'requires-approval', 'chat-1')).toMatchObject({ level: 'never-allowed', autoApproved: false });
  });
});

describe('the mode kept per workspace', () => {
  const storage = (initial: Record<string, string>) => {
    const data = new Map(Object.entries(initial));
    return {
      data,
      get: async (k: string) => data.get(k),
      set: async (k: string, v: string) => { data.set(k, v); },
      delete: async (k: string) => { data.delete(k); },
      has: async (k: string) => data.has(k),
      keys: async () => [...data.keys()],
      clear: async () => { data.clear(); },
    };
  };

  it('reads the stored mode back at startup and writes every change', async () => {
    const perms = new PermissionService();
    const store = storage({ [PERMISSION_MODE_STORAGE_KEY]: 'auto' });
    const sub = keepPermissionMode(perms, store);
    await Promise.resolve();
    expect(perms.getPermissionMode()).toBe('auto');
    perms.setPermissionMode('careful');
    await Promise.resolve();
    expect(store.data.get(PERMISSION_MODE_STORAGE_KEY)).toBe('careful');
    sub.dispose();
    perms.setPermissionMode('ask');
    await Promise.resolve();
    expect(store.data.get(PERMISSION_MODE_STORAGE_KEY)).toBe('careful');
  });

  it('nothing stored, or a word that is not a mode, leaves Ask', async () => {
    const perms = new PermissionService();
    keepPermissionMode(perms, storage({}));
    await Promise.resolve();
    expect(perms.getPermissionMode()).toBe('ask');
    const other = new PermissionService();
    keepPermissionMode(other, storage({ [PERMISSION_MODE_STORAGE_KEY]: 'yolo' }));
    await Promise.resolve();
    expect(other.getPermissionMode()).toBe('ask');
  });
});
