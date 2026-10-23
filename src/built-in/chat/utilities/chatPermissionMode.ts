// permissionMode.ts — the permission mode (Ask, Auto, Careful) as the chat
// uses it: the skills' gate through the mode, and the mode kept per
// workspace. The mode itself lives in the permission service; the picker
// sets it through IModePickerServices.

import type { IDisposable } from '../../../platform/lifecycle.js';
import type { IStorage } from '../../../platform/storage.js';
import type { ToolPermissionLevel } from '../../../services/chatTypes.js';
import { coercePermissionMode } from '../../../services/permissionService.js';
import type { IPermissionCheckResult, PermissionService } from '../../../services/permissionService.js';

/** The workspace storage key that holds the permission mode. */
export const PERMISSION_MODE_STORAGE_KEY = 'chat.permissionMode';

/**
 * A skill's tool returns its instructions; it changes nothing by itself. It
 * is gated the way the ordinary tools are: a ban holds in every mode, Auto
 * runs it, Careful asks, and on a turn the user started it runs on their
 * consent. An autonomous turn asks, and the log answers.
 */
export function resolveSkillPermission(
  perms: PermissionService | undefined,
  toolName: string,
  defaultLevel: ToolPermissionLevel,
  sessionId?: string,
): IPermissionCheckResult {
  if (!perms) {
    return { level: defaultLevel, autoApproved: defaultLevel === 'always-allowed', source: 'default' };
  }
  const check = perms.checkPermission(toolName, defaultLevel);
  if (check.level === 'never-allowed') return check;
  if (perms.isAutoFor(sessionId)) return { level: check.level, autoApproved: true, source: 'auto' };
  if (perms.isCarefulMode()) return { level: check.level, autoApproved: false, source: check.source };
  if (check.autoApproved || perms.getSessionInitiator(sessionId) === 'autonomous') return check;
  return { level: check.level, autoApproved: true, source: 'user-consent' };
}

/**
 * The mode is a workspace preference: read back at startup, written on
 * every change, so the switch the user set holds across restarts, per
 * workspace. Returns the subscription that writes it.
 */
export function keepPermissionMode(perms: PermissionService, storage: IStorage): IDisposable {
  storage.get(PERMISSION_MODE_STORAGE_KEY)
    .then((value) => { if (value !== undefined) perms.setPermissionMode(coercePermissionMode(value)); })
    .catch(() => { /* Ask until the preference can be read */ });
  return perms.onDidChange(() => {
    storage.set(PERMISSION_MODE_STORAGE_KEY, perms.getPermissionMode()).catch(() => { /* in memory for this window */ });
  });
}
