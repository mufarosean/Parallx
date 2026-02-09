// workbenchServices.ts — service registration and initialization

import { ServiceCollection } from '../services/serviceCollection.js';
import { ILifecycleService } from '../services/serviceTypes.js';
import { LifecycleService } from './lifecycle.js';

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

  // Future capabilities will register additional services here:
  // ── Layout (Capability 2) ──
  // ── View (Capability 4) ──
  // ── Workspace (Capability 5/6) ──
  // ── Editor (Capability 9) ──
  // ── Command (Capability 7) ──
  // ── Context Key (Capability 8) ──
}
