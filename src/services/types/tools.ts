// tools.ts — service interfaces for the extension host: the tool registry, activation events, errors, activation, enablement.
//
// One file of services/types/; serviceTypes.ts re-exports them all, so import
// from '../serviceTypes.js' as before.

import { createServiceIdentifier } from '../../platform/types.js';
import { IDisposable } from '../../platform/lifecycle.js';
import { Event } from '../../platform/events.js';
import type { IToolDescription } from '../../tools/toolManifest.js';
import type { IToolEntry, ToolRegisteredEvent, ToolStateChangedEvent, ToolState, ContributionPoint } from '../../tools/toolRegistry.js';
import type { ActivationRequest, ParsedActivationEvent } from '../../tools/activationEventService.js';
import type { ToolError, ToolErrorEvent } from '../../tools/toolErrorIsolation.js';
import type { ActivatedTool, ToolActivationEvent } from '../../tools/toolActivator.js';
import type { IToolEnablementService as IToolEnablementServiceShape, ToolEnablementChangeEvent, ToolEnablementState } from '../../tools/toolEnablement.js';

// ─── IToolRegistryService ────────────────────────────────────────────────────

/**
 * Service interface for the central tool registry.
 */
export interface IToolRegistryService extends IDisposable {
  /** Fires when a new tool is registered. */
  readonly onDidRegisterTool: Event<ToolRegisteredEvent>;
  /** Fires when a tool's lifecycle state changes. */
  readonly onDidChangeToolState: Event<ToolStateChangedEvent>;

  /** Register a validated tool description. */
  register(description: IToolDescription): void;
  /** Transition a tool to a new state. */
  setToolState(toolId: string, newState: ToolState): void;
  /** Remove a tool from the registry. */
  unregister(toolId: string): void;

  /** Get all registered tool entries. */
  getAll(): readonly IToolEntry[];
  /** Get a tool entry by manifest ID. */
  getById(toolId: string): IToolEntry | undefined;
  /** Get all tools in a specific state. */
  getByState(state: ToolState): readonly IToolEntry[];
  /** Get all tools contributing to a specific point. */
  getContributorsOf(point: ContributionPoint): readonly IToolEntry[];
  /** Total number of registered tools. */
  readonly count: number;
  /** Check if a tool with the given ID is registered. */
  has(toolId: string): boolean;
}

export const IToolRegistryService = createServiceIdentifier<IToolRegistryService>('IToolRegistryService');

// ─── IActivationEventService ─────────────────────────────────────────────────

/**
 * Service interface for the activation event system.
 */
export interface IActivationEventService extends IDisposable {
  /** Register a tool's activation events. Replays already-fired events. */
  registerToolEvents(toolId: string, activationEvents: readonly string[]): IDisposable;
  /** Mark a tool as activated (prevents duplicate requests). */
  markActivated(toolId: string): void;
  /** Clear a tool's activated status. */
  clearActivated(toolId: string): void;
  /** Signal that shell startup has finished. */
  fireStartupFinished(): void;
  /** Signal that a command was invoked. */
  fireCommand(commandId: string): void;
  /** Signal that a view was shown. */
  fireView(viewId: string): void;
  /** Get all tool IDs listening for a raw event. */
  getToolsForEvent(rawEvent: string): readonly string[];
  /** Check if a tool has been marked as activated. */
  isActivated(toolId: string): boolean;
  /** Whether startup has finished. */
  readonly startupFinished: boolean;
  /** Fires when the system determines a tool should be activated. */
  readonly onDidRequestActivation: Event<ActivationRequest>;
  /** Fires when any activation event fires (observability). */
  readonly onDidFireEvent: Event<ParsedActivationEvent>;
}

export const IActivationEventService = createServiceIdentifier<IActivationEventService>('IActivationEventService');

// ─── IToolErrorService ───────────────────────────────────────────────────────

/**
 * Service interface for tool error isolation and reporting.
 */
export interface IToolErrorService extends IDisposable {
  /** Record an error for a tool. */
  recordError(toolId: string, error: unknown, context: string): ToolError;
  /** Wrap a synchronous/async callback in a try/catch attributed to a tool. */
  wrap<TArgs extends unknown[], TReturn>(toolId: string, context: string, fn: (...args: TArgs) => TReturn): (...args: TArgs) => TReturn | undefined;
  /** Wrap an async callback in a try/catch attributed to a tool. */
  wrapAsync<TArgs extends unknown[], TReturn>(toolId: string, context: string, fn: (...args: TArgs) => Promise<TReturn>): (...args: TArgs) => Promise<TReturn | undefined>;
  /** Get all recorded errors for a tool. */
  getToolErrors(toolId: string): readonly ToolError[];
  /** Get the total error count for a tool. */
  getErrorCount(toolId: string): number;
  /** Clear recorded errors for a tool. */
  clearErrors(toolId: string): void;
  /**
   * Every recorded error, keyed by tool id. Phase C (SYSTEM_INTEGRITY.md):
   * the class had this and the interface hid it.
   */
  getAllErrors(): ReadonlyMap<string, readonly ToolError[]>;
  /** Fires whenever a tool error is recorded. */
  readonly onDidRecordError: Event<ToolErrorEvent>;
  /** Fires when a tool should be force-deactivated. */
  readonly onWillForceDeactivate: Event<string>;
}

export const IToolErrorService = createServiceIdentifier<IToolErrorService>('IToolErrorService');

// ─── IToolActivatorService ───────────────────────────────────────────────────

/**
 * Service interface for tool activation and deactivation.
 */
export interface IToolActivatorService extends IDisposable {
  /** Activate a tool by ID. Returns true on success. */
  activate(toolId: string): Promise<boolean>;
  /** Deactivate a tool by ID. Returns true on success. */
  deactivate(toolId: string): Promise<boolean>;
  /** Deactivate all activated tools (teardown). */
  deactivateAll(): Promise<void>;
  /** Get the activated tool record. */
  getActivated(toolId: string): ActivatedTool | undefined;
  /** Get all activated tool IDs. */
  getActivatedToolIds(): readonly string[];
  /** Check if a tool is currently activated. */
  isActivated(toolId: string): boolean;
  /** Fires after a tool has been activated. */
  readonly onDidActivate: Event<ToolActivationEvent>;
  /** Fires after a tool has been deactivated. */
  readonly onDidDeactivate: Event<ToolActivationEvent>;
}

export const IToolActivatorService = createServiceIdentifier<IToolActivatorService>('IToolActivatorService');

// ─── IToolEnablementService ──────────────────────────────────────────────────

/**
 * Service interface for tool enable/disable state management.
 */
export interface IToolEnablementService extends IToolEnablementServiceShape {}

export const IToolEnablementService = createServiceIdentifier<IToolEnablementService>('IToolEnablementService');

// Re-export types for convenience
export type { ToolEnablementChangeEvent, ToolEnablementState };
