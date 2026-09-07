// sealedWorkspace.ts — one flag that keeps a workspace's documents on the machine.
//
// A sealed workspace (docs/BROWSER.md, phase 2) is for folders that hold
// things like tax papers or a social security number. While it is sealed:
//   - cloud model providers are not registered, whatever the per-workspace
//     opt-in says (chat/main.ts syncProviders);
//   - tools that reach the network are hidden from the model and refused
//     if called (languageModelToolsService, by owner extension);
//   - the main-process egress chokepoint refuses every request
//     (electron/webFetchBridge.cjs, told through the preload);
//   - the title bar shows a seal so the state is never silent.
// The user's own browsing is not affected: the browser is theirs, and its
// pages reach the AI only through Send Page To Chat, which the seal blocks
// too because the fetch behind it is egress.

import type { ISettingsRegistryService } from './settingsRegistryService.js';

export const SEALED_WORKSPACE_SETTING = 'workspace.sealed';

/** Extensions whose tools reach the network. Hidden and refused while sealed. */
export const SEALED_TOOL_OWNERS: ReadonlySet<string> = new Set(['parallx.web-research', 'parallx.browser']);

type RegistryLike = Pick<ISettingsRegistryService, 'register' | 'getSchema' | 'getValue'>;

/** Register the setting once. Safe to call repeatedly (getValue throws on unregistered keys). */
export function registerSealedSetting(registry: RegistryLike): void {
  if (registry.getSchema(SEALED_WORKSPACE_SETTING)) return;
  registry.register({
    key: SEALED_WORKSPACE_SETTING,
    type: 'boolean',
    default: false,
    scope: 'workspace',
    description: 'Seal this workspace: no cloud models, no web tools, no network egress from extensions. The AI runs on local models only. For workspaces that hold sensitive documents. Your own browsing in the Browser is unaffected.',
    category: 'Security',
  } as Parameters<RegistryLike['register']>[0]);
}

/** True when the open workspace is sealed. Never throws. */
export function isWorkspaceSealed(registry: RegistryLike | undefined): boolean {
  if (!registry) return false;
  try {
    registerSealedSetting(registry);
    return registry.getValue<boolean>(SEALED_WORKSPACE_SETTING) === true;
  } catch {
    return false;
  }
}

/** Whether a tool's owner extension is one the seal hides. */
export function isSealedOutOwner(ownerToolId: string | undefined): boolean {
  return !!ownerToolId && SEALED_TOOL_OWNERS.has(ownerToolId);
}

interface SealSurfaces {
  readonly titlebar?: { setSealed?(sealed: boolean): void } | undefined;
  readonly egress?: { setSealed?(sealed: boolean): Promise<unknown> } | undefined;
}

/** Read the flag and push it to the title bar and the main-process chokepoint. Returns the state. */
export function applyWorkspaceSeal(registry: RegistryLike | undefined, surfaces: SealSurfaces): boolean {
  const sealed = isWorkspaceSealed(registry);
  try { surfaces.titlebar?.setSealed?.(sealed); } catch { /* the chip is cosmetic */ }
  try { void surfaces.egress?.setSealed?.(sealed)?.catch?.(() => { /* main process not ready */ }); } catch { /* ignore */ }
  return sealed;
}
