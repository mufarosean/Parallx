// viewService.ts — IViewService thin facade
//
// Delegates view operations to ViewManager.
// Registered in the DI container during Phase 3 after ViewManager exists.
// The IViewService interface is intentionally minimal in M1/M2;
// it will be expanded as view contribution points are added.

import { Disposable } from '../platform/lifecycle.js';
import type { IViewService } from './serviceTypes.js';

/**
 * Thin facade over ViewManager for the service layer.
 * Tools and services access view lifecycle through this service
 * rather than importing ViewManager directly.
 */
export class ViewService extends Disposable implements IViewService {
  // IViewService is currently empty ("will be expanded in Capability 4").
  // This class exists so the DI container has a concrete instance to
  // hand out, and M2 tool API can depend on a stable service identifier.
}
