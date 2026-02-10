// workbenchServices.ts — service registration and initialization

import { ServiceCollection } from '../services/serviceCollection.js';
import { ILifecycleService, ICommandService, IContextKeyService, IToolRegistryService, INotificationService } from '../services/serviceTypes.js';
import { LifecycleService } from './lifecycle.js';
import { CommandService } from '../services/commandService.js';
import { ContextKeyService } from '../services/contextKeyService.js';
import { ToolRegistry } from '../tools/toolRegistry.js';
import { NotificationService } from '../api/notificationService.js';

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

  // Future capabilities will register additional services here:
  // ── Layout (Capability 2) ──
  // ── View (Capability 4) ──
  // ── Workspace (Capability 5/6) ──
  // ── Editor (Capability 9) ──
}
