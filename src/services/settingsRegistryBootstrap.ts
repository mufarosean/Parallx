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
  });

  services.registerInstance(ISettingsRegistryService, registry);
  setGlobalSettingsRegistry(registry);
  disposables.push({ dispose: () => setGlobalSettingsRegistry(undefined) });

  // Migrate any secret values previously stored plaintext in the overrides
  // JSON (e.g. mcp.gmail.clientSecret).
  void registry.migrateSecretsFromJson().catch(() => { /* best-effort */ });

  // Declarative extension settings — every tool's contributes.configuration
  // lands in the unified registry so it appears in the Settings hub, BOUND
  // to the ConfigurationService (STANDARDIZATION.md P1) so the store
  // extensions read is the store the hub writes. Tools register after this
  // runs, so the watcher does the work; the sweep covers any early birds.
  const toolRegistry = services.tryGet(IToolRegistryService);
  if (toolRegistry) {
    const configBridge = services.tryGet(IConfigurationService);
    for (const entry of toolRegistry.getAll()) {
      registerManifestConfiguration(registry, entry.description.manifest as never, configBridge);
    }
    disposables.push(toolRegistry.onDidRegisterTool((e) => {
      registerManifestConfiguration(registry, e.description.manifest as never, configBridge);
    }));
  }

  return disposables;
}
