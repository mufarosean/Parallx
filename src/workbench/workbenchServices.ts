// workbenchServices.ts — service registration and initialization

import { ServiceCollection } from '../services/serviceCollection.js';
import { ILifecycleService, ICommandService, IContextKeyService, IToolRegistryService, INotificationService, IActivationEventService, IToolErrorService, IToolActivatorService, IConfigurationService, ICommandContributionService, IKeybindingContributionService, IMenuContributionService, IViewContributionService, IKeybindingService } from '../services/serviceTypes.js';
import { LifecycleService } from './lifecycle.js';
import { CommandService } from '../services/commandService.js';
import { ContextKeyService } from '../services/contextKeyService.js';
import { ToolRegistry } from '../tools/toolRegistry.js';
import { NotificationService } from '../api/notificationService.js';
import { ActivationEventService } from '../tools/activationEventService.js';
import { ToolErrorService } from '../tools/toolErrorIsolation.js';
import { ConfigurationRegistry } from '../configuration/configurationRegistry.js';
import { ConfigurationService } from '../configuration/configurationService.js';
import { CommandContributionProcessor } from '../contributions/commandContribution.js';
import { KeybindingContributionProcessor } from '../contributions/keybindingContribution.js';
import { MenuContributionProcessor } from '../contributions/menuContribution.js';
import { ViewContributionProcessor } from '../contributions/viewContribution.js';
import { KeybindingService } from '../services/keybindingService.js';
import type { IStorage } from '../platform/storage.js';
import type { ViewManager } from '../views/viewManager.js';

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

  // Note: Contribution processors (ICommandContributionService,
  // IKeybindingContributionService, IMenuContributionService) are
  // registered in the workbench during Phase 5 after CommandService
  // and ActivationEventService are available.
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

/**
 * Creates and registers the contribution processors (M2 Capability 5)
 * and the centralized KeybindingService (M3 Capability 0.3).
 * Called during Phase 5 after CommandService and ActivationEventService are available.
 *
 * @returns The three contribution processor instances and the KeybindingService.
 */
export function registerContributionProcessors(
  services: ServiceCollection,
): {
  commandContribution: CommandContributionProcessor;
  keybindingContribution: KeybindingContributionProcessor;
  menuContribution: MenuContributionProcessor;
  keybindingService: KeybindingService;
} {
  const commandService = services.get(ICommandService) as unknown as import('../commands/commandRegistry.js').CommandService;
  const activationEvents = services.get(IActivationEventService) as unknown as ActivationEventService;

  const commandContribution = new CommandContributionProcessor(commandService, activationEvents);
  const keybindingContribution = new KeybindingContributionProcessor(commandService);
  const menuContribution = new MenuContributionProcessor(commandService);

  // Create the centralized KeybindingService (M3 Capability 0.3)
  const keybindingService = new KeybindingService(commandService);

  // Wire context key service if available
  if (services.has(IContextKeyService)) {
    const contextKeyService = services.get(IContextKeyService) as any;
    keybindingContribution.setContextKeyService(contextKeyService);
    menuContribution.setContextKeyService(contextKeyService);
    keybindingService.setContextKeyService(contextKeyService);
  }

  // Tell the keybinding contribution processor to delegate dispatch
  // to the centralized service instead of its own listener
  keybindingContribution.setKeybindingService(keybindingService);

  services.registerInstance(ICommandContributionService, commandContribution as any);
  services.registerInstance(IKeybindingContributionService, keybindingContribution as any);
  services.registerInstance(IMenuContributionService, menuContribution as any);
  services.registerInstance(IKeybindingService, keybindingService as any);

  return { commandContribution, keybindingContribution, menuContribution, keybindingService };
}

/**
 * Creates and registers the ViewContributionProcessor (M2 Capability 6).
 * Called during Phase 5 after ViewManager is available.
 */
export function registerViewContributionProcessor(
  services: ServiceCollection,
  viewManager: ViewManager,
): ViewContributionProcessor {
  const viewContribution = new ViewContributionProcessor(viewManager);
  services.registerInstance(IViewContributionService, viewContribution as any);
  return viewContribution;
}
