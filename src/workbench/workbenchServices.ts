// workbenchServices.ts — service registration and initialization

import { ServiceCollection } from '../services/serviceCollection.js';
import { ILifecycleService, ICommandService, IContextKeyService, IToolRegistryService, INotificationService, IActivationEventService, IToolErrorService, IToolActivatorService, IConfigurationService } from '../services/serviceTypes.js';
import { LifecycleService } from './lifecycle.js';
import { CommandService } from '../services/commandService.js';
import { ContextKeyService } from '../services/contextKeyService.js';
import { ToolRegistry } from '../tools/toolRegistry.js';
import { NotificationService } from '../api/notificationService.js';
import { ActivationEventService } from '../tools/activationEventService.js';
import { ToolErrorService } from '../tools/toolErrorIsolation.js';
import { ConfigurationRegistry } from '../configuration/configurationRegistry.js';
import { ConfigurationService } from '../configuration/configurationService.js';
import type { IStorage } from '../platform/storage.js';

/**
 * Registers all core services into the service collection.
 *
 * This is the composition root: it wires concrete implementations
 * to their service identifiers. Called once during workbench startup.
 *
 * As capabilities are implemented, their services are added here.
 */
export function registerWorkbenchServices(services: ServiceCollection): void {
  // ── Lifecycle ──
  services.registerInstance(ILifecycleService, new LifecycleService());

  // ── Context Key (Capability 8) ──
  services.registerInstance(IContextKeyService, new ContextKeyService());

  // ── Command (Capability 7) ──
  services.registerInstance(ICommandService, new CommandService(services));

  // ── Tool Registry (M2 Capability 1) ──
  services.registerInstance(IToolRegistryService, new ToolRegistry());

  // ── Notification Service (M2 Capability 2) ──
  services.registerInstance(INotificationService, new NotificationService());

  // ── Activation Event Service (M2 Capability 3) ──
  services.registerInstance(IActivationEventService, new ActivationEventService());

  // ── Tool Error Service (M2 Capability 3) ──
  services.registerInstance(IToolErrorService, new ToolErrorService());

  // Note: IToolActivatorService is registered in the workbench after
  // all dependencies (API factory deps) are available.

  // Note: IConfigurationService is registered in the workbench after
  // storage is initialized (requires IStorage from Phase 1).
}

/**
 * Creates and registers the ConfigurationService.
 * Called after storage is available (Phase 1).
 *
 * @returns The ConfigurationService and ConfigurationRegistry instances.
 */
export function registerConfigurationServices(
  services: ServiceCollection,
  storage: IStorage,
): { configService: ConfigurationService; configRegistry: ConfigurationRegistry } {
  const configRegistry = new ConfigurationRegistry();
  const configService = new ConfigurationService(storage, configRegistry);

  services.registerInstance(IConfigurationService, configService as any);

  return { configService, configRegistry };
}
