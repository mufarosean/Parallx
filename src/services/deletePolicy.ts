/**
 * Delete policy: where a file goes when Parallx deletes it.
 *
 * Two workspace-scoped settings, pushed to the main-process `fs:delete`
 * handler the way the workspace seal is pushed to the egress chokepoint:
 *
 * - `files.deleteToRecycleBin` (default on). Off means every deletion Parallx
 *   performs in this workspace is permanent and immediate, so an experimental
 *   or sensitive workspace never leaves its leftovers in the system Recycle
 *   Bin. Files on a different drive than the user's profile never reach the
 *   Recycle Bin either way (cross-volume rule in `fs:delete`).
 * - `files.eraserPath`. The Eraser executable used for secure deletes: a
 *   caller that asks for `secure: true` gets the file overwritten by Eraser
 *   before removal; when Eraser is missing, a permanent delete instead.
 */
import type { ISettingsRegistryService } from './serviceTypes.js';

export const DELETE_TO_RECYCLE_BIN_SETTING = 'files.deleteToRecycleBin';
export const ERASER_PATH_SETTING = 'files.eraserPath';
export const DEFAULT_ERASER_PATH = 'C:\\Program Files\\Eraser\\Eraser.exe';

type RegistryLike = Pick<ISettingsRegistryService, 'register' | 'getSchema' | 'getValue'>;
type SchemaArg = Parameters<RegistryLike['register']>[0];

export interface DeletePolicy {
  /** Whether same-drive deletions may use the OS Recycle Bin. */
  recycleBin: boolean;
  /** Eraser executable for secure deletes; empty disables Eraser. */
  eraserPath: string;
}

export interface DeletePolicySink {
  setDeletePolicy?(policy: DeletePolicy): Promise<unknown>;
}

/** Register both settings once. Safe to call repeatedly. */
export function registerDeletePolicySettings(registry: RegistryLike): void {
  if (!registry.getSchema(DELETE_TO_RECYCLE_BIN_SETTING)) {
    registry.register({
      key: DELETE_TO_RECYCLE_BIN_SETTING,
      type: 'boolean',
      default: true,
      scope: 'workspace',
      description: 'Send files deleted in this workspace to the Recycle Bin. Off: every deletion Parallx makes here is permanent and immediate, so an experimental or sensitive workspace never leaves anything in the system Recycle Bin. Files on a different drive than your user profile never go to the Recycle Bin either way.',
      category: 'Security',
    } as SchemaArg);
  }
  if (!registry.getSchema(ERASER_PATH_SETTING)) {
    registry.register({
      key: ERASER_PATH_SETTING,
      type: 'string',
      default: DEFAULT_ERASER_PATH,
      scope: 'workspace',
      description: 'Path to Eraser (eraser.heidi.ie) for secure deletes. Downloads deleted from the Browser, and anything else that asks for a secure delete, are overwritten by Eraser before removal. When Eraser is not installed there, the file is deleted permanently instead. Windows only.',
      category: 'Security',
    } as SchemaArg);
  }
}

/** Current policy from settings. Never throws; defaults when unregistered. */
export function readDeletePolicy(registry: RegistryLike | undefined): DeletePolicy {
  const fallback: DeletePolicy = { recycleBin: true, eraserPath: DEFAULT_ERASER_PATH };
  if (!registry) return fallback;
  try {
    registerDeletePolicySettings(registry);
    const recycleBin = registry.getValue<boolean>(DELETE_TO_RECYCLE_BIN_SETTING) !== false;
    const raw = registry.getValue<string>(ERASER_PATH_SETTING);
    const eraserPath = typeof raw === 'string' ? raw.trim() : DEFAULT_ERASER_PATH;
    return { recycleBin, eraserPath };
  } catch {
    return fallback;
  }
}

/** Is this settings change one the delete policy listens to? */
export function isDeletePolicySetting(key: string): boolean {
  return key === DELETE_TO_RECYCLE_BIN_SETTING || key === ERASER_PATH_SETTING;
}

/** Push the current policy to the main process (the fs bridge unless a sink is given). Never throws. */
export function applyDeletePolicy(registry: RegistryLike | undefined, sink?: DeletePolicySink | null): DeletePolicy {
  const policy = readDeletePolicy(registry);
  const target = sink === undefined ? (globalThis as { parallxElectron?: { fs?: DeletePolicySink } }).parallxElectron?.fs : sink;
  try { void target?.setDeletePolicy?.(policy)?.catch(() => { /* main not ready */ }); } catch { /* no bridge */ }
  return policy;
}
