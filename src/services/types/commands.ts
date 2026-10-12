// commands.ts — service interfaces for commands and context: the command service, context keys, configuration and the settings registry, the contributed commands, keybindings, menus and views.
//
// One file of services/types/; serviceTypes.ts re-exports them all, so import
// from '../serviceTypes.js' as before.

import { createServiceIdentifier } from '../../platform/types.js';
import { IDisposable } from '../../platform/lifecycle.js';
import { Event } from '../../platform/events.js';
import type { ICommandServiceShape, } from '../../commands/commandTypes.js';
import type { ContextKeyChangeEvent, ContextKeyValue, IContextKey } from '../../context/contextKey.js';
import type { ContextKeyLookup } from '../../context/whenClause.js';
import type { IConfigurationServiceShape, } from '../../configuration/configurationTypes.js';
import type { IContributedCommand } from '../../contributions/contributionTypes.js';
import type { IContributedKeybinding } from '../../contributions/contributionTypes.js';
import type { IContributedMenuItem, MenuLocationId } from '../../contributions/contributionTypes.js';
import type { ISettingsRegistryService as ISettingsRegistryServiceType } from '../settingsRegistryService.js';
import type { IToolDescription } from '../../tools/toolManifest.js';

// ─── ICommandService ─────────────────────────────────────────────────────────

/**
 * Registers and executes commands.
 * Re-exports ICommandServiceShape so consumers import from serviceTypes.
 */
export interface ICommandService extends ICommandServiceShape {}

export const ICommandService = createServiceIdentifier<ICommandService>('ICommandService');

// ─── IContextKeyService ──────────────────────────────────────────────────────

/**
 * Manages context keys and when-clause evaluation.
 */
export interface IContextKeyService extends IDisposable {
  /** Fires when any context key value changes. */
  readonly onDidChangeContext: Event<ContextKeyChangeEvent>;

  /** Create a scoped context (part or view level). */
  createScope(scopeId: string, parentId?: string): IDisposable;

  /** Create a typed handle to a context key. */
  createKey<T extends ContextKeyValue>(key: string, defaultValue: T, scopeId?: string): IContextKey<T>;

  /** Set a context key value in the global scope. */
  setContext(key: string, value: ContextKeyValue): void;

  /** Set a context key value in a specific scope. */
  setContextInScope(key: string, value: ContextKeyValue, scopeId: string): void;

  /** Get a context key value (with scope inheritance). */
  getContextValue(key: string, scopeId?: string): ContextKeyValue;

  /** Evaluate a when-clause expression against a scope. */
  evaluate(expression: string | undefined, scopeId?: string): boolean;

  /** Check if a command's when-clause is satisfied (global scope). */
  contextMatchesRules(whenClause: string | undefined): boolean;

  /** Create a lookup function for a scope. */
  createLookup(scopeId?: string): ContextKeyLookup;

  /**
   * All effective context keys for a scope (default: global), inherited
   * chain included. Phase C (SYSTEM_INTEGRITY.md): the map existed on the
   * class but was unreadable through its own DI interface.
   */
  getAllContext(scopeId?: string): Map<string, ContextKeyValue>;
}

export const IContextKeyService = createServiceIdentifier<IContextKeyService>('IContextKeyService');

// ─── IConfigurationService ───────────────────────────────────────────────────

/**
 * Service interface for the configuration system.
 */
export interface IConfigurationService extends IConfigurationServiceShape {}

export const IConfigurationService = createServiceIdentifier<IConfigurationService>('IConfigurationService');

// ─── ICommandContributionService ─────────────────────────────────────────────

export interface ICommandContributionService {
  processContributions(toolDescription: IToolDescription): void;
  removeContributions(toolId: string): void;
  wireRealHandler(commandId: string, handler: (...args: unknown[]) => unknown | Promise<unknown>): void;
  getContributedCommands(): readonly IContributedCommand[];
  getContributedCommand(commandId: string): IContributedCommand | undefined;
  isContributed(commandId: string): boolean;
}

export const ICommandContributionService = createServiceIdentifier<ICommandContributionService>('ICommandContributionService');

// ─── IKeybindingContributionService ──────────────────────────────────────────

export interface IKeybindingContributionService {
  processContributions(toolDescription: IToolDescription): void;
  removeContributions(toolId: string): void;
  getKeybindingForCommand(commandId: string): IContributedKeybinding | undefined;
  getAllKeybindings(): readonly IContributedKeybinding[];
}

export const IKeybindingContributionService = createServiceIdentifier<IKeybindingContributionService>('IKeybindingContributionService');

// ─── IMenuContributionService ────────────────────────────────────────────────

export interface IMenuContributionService {
  processContributions(toolDescription: IToolDescription): void;
  removeContributions(toolId: string): void;
  isCommandVisibleInPalette(commandId: string): boolean;
  getViewTitleActions(viewId: string): readonly IContributedMenuItem[];
  renderViewTitleActions(viewId: string, container: HTMLElement): IDisposable;
  showViewContextMenu(viewId: string, x: number, y: number): IDisposable;
  dismissContextMenu(): void;
  getMenuItems(location: MenuLocationId): readonly IContributedMenuItem[];
}

export const IMenuContributionService = createServiceIdentifier<IMenuContributionService>('IMenuContributionService');

// ─── View Contribution ───────────────────────────────────────────────────────

/**
 * Service for processing view and view container contributions from tool manifests.
 * Manages the view provider registry that bridges manifest declarations to runtime content.
 */
export interface IViewContributionService {
  processContributions(toolDescription: import('../../tools/toolManifest.js').IToolDescription): void;
  removeContributions(toolId: string): void;
  registerProvider(viewId: string, provider: { resolveView(viewId: string, container: HTMLElement): void | import('../../platform/lifecycle.js').IDisposable }): import('../../platform/lifecycle.js').IDisposable;
  hasContributedView(viewId: string): boolean;
  getContainers(): readonly { id: string; toolId: string; title: string; icon?: string; location: 'sidebar' | 'panel' | 'auxiliaryBar'; priority: number }[];
  getContainer(containerId: string): { id: string; toolId: string; title: string; icon?: string; location: 'sidebar' | 'panel' | 'auxiliaryBar'; priority: number } | undefined;
  getContainersForLocation(location: 'sidebar' | 'panel' | 'auxiliaryBar'): readonly { id: string; toolId: string; title: string; icon?: string; location: 'sidebar' | 'panel' | 'auxiliaryBar'; priority: number }[];
  getViewsForContainer(containerId: string): readonly { id: string; toolId: string; name: string; containerId: string; icon?: string; when?: string }[];
  readonly onDidAddContainer: import('../../platform/events.js').Event<{ id: string; toolId: string; title: string; icon?: string; location: 'sidebar' | 'panel' | 'auxiliaryBar'; priority: number }>;
  readonly onDidRemoveContainer: import('../../platform/events.js').Event<string>;
  readonly onDidAddView: import('../../platform/events.js').Event<{ id: string; toolId: string; name: string; containerId: string; icon?: string; when?: string }>;
  readonly onDidRemoveView: import('../../platform/events.js').Event<string>;
  readonly onDidRegisterProvider: import('../../platform/events.js').Event<{ viewId: string }>;
}

export const IViewContributionService = createServiceIdentifier<IViewContributionService>('IViewContributionService');

// ─── ISettingsRegistryService ────────────────────────
//
// Schema-driven settings registry. Every service / extension registers
// its settings up-front; the registry owns validation, persistence, change
// events, and scope routing. Backed by IGlobalStorageService (user) and
// IWorkspaceStorageService (workspace). Adapter-binds to existing flat
// stores like AutonomyFeatureFlagsService.

export type ISettingsRegistryService = ISettingsRegistryServiceType;
export const ISettingsRegistryService =
  createServiceIdentifier<ISettingsRegistryServiceType>('ISettingsRegistryService');
