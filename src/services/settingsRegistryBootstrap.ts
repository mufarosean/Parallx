// settingsRegistryBootstrap.ts — the settings registry is core's to build.
//
// Phase D step 4 (PHASE_D_BRIEF.md). The registry used to be CONSTRUCTED
// inside chat's activate — the audit's canonical "load-bearing core in a
// tool costume": disable chat and the entire Settings hub lost its store,
// and everything built before chat activated raced a registry that did
// not exist yet (the registration-order trap). Now the workbench builds
// it right after the configuration system, before any tool activates;
// tools — chat included — resolve it and register their own schemas.
//
// This module owns only the GENERIC substrate: construction over the two
// storage scopes, safeStorage wiring, the hub's own rollout flag, the
// plaintext-secret migration, and the manifest-configuration sweep that
// binds every tool's contributes.configuration into the hub (that sweep
// is registry infrastructure, not chat domain — it serves all 19 tools).

import type { IDisposable } from '../platform/lifecycle.js';
import { SettingsRegistryService, setGlobalSettingsRegistry } from './settingsRegistryService.js';
import { createSecretStorageService } from './secretStorageService.js';
import { registerManifestConfiguration } from './manifestSettings.js';
import { ToolState } from '../tools/toolRegistry.js';
import type { ServiceCollection } from './serviceCollection.js';
import {
  IConfigurationService,
  IGlobalStorageService,
  IToolRegistryService,
  IWorkspaceStorageService,
  ISettingsRegistryService,
} from './serviceTypes.js';

/**
 * Construct, initialize, and DI-register the one settings registry.
 * Returns the disposables the caller owns (the registry itself and the
 * tool-registration watcher).
 */
export function bootstrapSettingsRegistry(services: ServiceCollection): IDisposable[] {
  const disposables: IDisposable[] = [];

  const userStorage = services.tryGet(IGlobalStorageService);
  const workspaceStorage = services.tryGet(IWorkspaceStorageService);
  const registry = new SettingsRegistryService(userStorage, workspaceStorage);
  disposables.push(registry);

  registry.setSecretStorage(createSecretStorageService());
  void registry.initialize().catch(() => { /* defaults apply */ });

  // §3.8 — the unified settings editor ships behind a flag, default on.
  registry.register({
    key: 'settings.editor.enabled',
    type: 'boolean',
    default: true,
    scope: 'user',
    description: 'Enable the unified settings editor (M60 §3.8 rollback flag).',
    category: 'General',
    // A rollback switch for developers, not a preference: it was the only
    // row on the General page every user opened Settings to.
    hidden: true,
  });

  services.registerInstance(ISettingsRegistryService, registry);
  setGlobalSettingsRegistry(registry);
  disposables.push({ dispose: () => setGlobalSettingsRegistry(undefined) });

  // Migrate any secret values previously stored plaintext in the overrides
  // JSON (e.g. mcp.gmail.clientSecret).
  void registry.migrateSecretsFromJson().catch(() => { /* best-effort */ });

  // A tool's declared settings (contributes.configuration) are in the hub
  // only while the tool runs: registered as it starts, removed when it is
  // turned off (CLAUDE.md, the first principle). Stored values are kept for
  // when it comes back. Bound to the ConfigurationService (STANDARDIZATION.md
  // P1) so the store extensions read is the store the hub writes.
  const toolRegistry = services.tryGet(IToolRegistryService);
  if (toolRegistry) {
    const configBridge = services.tryGet(IConfigurationService);
    const live = new Map<string, IDisposable>();
    const add = (toolId: string): void => {
      if (live.has(toolId)) return;
      const entry = toolRegistry.getById?.(toolId) ?? toolRegistry.getAll().find((e) => e.description.manifest.id === toolId);
      if (!entry) return;
      live.set(toolId, registerManifestConfiguration(registry, entry.description.manifest as never, configBridge));
    };
    const remove = (toolId: string): void => { live.get(toolId)?.dispose(); live.delete(toolId); };
    for (const entry of toolRegistry.getAll()) {
      if (entry.state === ToolState.Activating || entry.state === ToolState.Activated) add(entry.description.manifest.id);
    }
    disposables.push(toolRegistry.onDidChangeToolState((e) => {
      // Before activate() runs, so the tool can read its settings while starting.
      if (e.newState === ToolState.Activating || e.newState === ToolState.Activated) add(e.toolId);
      else if (e.newState === ToolState.Deactivated) remove(e.toolId);
    }));
    disposables.push({ dispose: () => { for (const id of [...live.keys()]) remove(id); } });
  }

  return disposables;
}
