// toolTypes.ts — central type definitions for the tools subsystem
//
// All tool-related interfaces, types, and enums live here.
// Implementation files import types from this module and re-export
// for backward compatibility. Follows VS Code's pattern of separating
// types from implementation.

import type { IDisposable } from '../platform/lifecycle.js';
import type { Event } from '../platform/events.js';
import type { IStorage } from '../platform/storage.js';
import type { Memento } from '../configuration/configurationTypes.js';
import type { ConfigurationRegistry } from '../configuration/configurationRegistry.js';
import type { IToolDescription } from './toolManifest.js';

// Re-export manifest types for one-stop-shop access
export type {
  ActivationEventType,
  IManifestViewDescriptor,
  IManifestViewContainerDescriptor,
  IManifestCommandDescriptor,
  IManifestConfigurationDescriptor,
  IManifestConfigurationProperty,
  IManifestMenuItem,
  IManifestKeybinding,
  IManifestStatusBarEntry,
  IManifestContributions,
  IManifestEngines,
  IToolManifest,
  IToolDescription,
} from './toolManifest.js';

// ─── Tool State (from toolRegistry) ─────────────────────────────────────────

/**
 * Lifecycle states a tool can be in.
 * Transitions are validated — see `ToolRegistry._validateTransition`.
 */
export enum ToolState {
  Discovered = 'discovered',
  Registered = 'registered',
  Activating = 'activating',
  Activated = 'activated',
  Deactivating = 'deactivating',
  Deactivated = 'deactivated',
  Disposed = 'disposed',
}

/** Internal entry for a registered tool. */
export interface IToolEntry {
  /** Validated tool description (manifest + metadata). */
  readonly description: IToolDescription;
  /** Current lifecycle state. */
  readonly state: ToolState;
}

export interface ToolRegisteredEvent {
  readonly toolId: string;
  readonly description: IToolDescription;
}

export interface ToolStateChangedEvent {
  readonly toolId: string;
  readonly previousState: ToolState;
  readonly newState: ToolState;
}

/** Contribution point name constants. */
export type ContributionPoint =
  | 'views'
  | 'viewContainers'
  | 'commands'
  | 'configuration'
  | 'menus'
  | 'keybindings';

// ─── Tool Module (from toolModuleLoader) ─────────────────────────────────────

/**
 * Context passed to a tool's `activate()` function.
 * See parallx.d.ts → ToolContext.
 */
export interface ToolContext {
  /** Disposables registered by the tool. All disposed on deactivation. */
  readonly subscriptions: IDisposable[];
  /** Global state (Memento) — persists across workspaces. */
  readonly globalState: Memento;
  /** Workspace state (Memento) — persists within current workspace. */
  readonly workspaceState: Memento;
  /** Absolute path to the tool's root directory. */
  readonly toolPath: string;
  /** URI string for the tool's root. */
  readonly toolUri: string;
  /** Placeholder for future environment variable collection. */
  readonly environmentVariableCollection: Record<string, string>;
}

/**
 * The activate function signature.
 * Tools export: `export function activate(api, context)`
 */
export type ActivateFunction = (api: unknown, context: ToolContext) => void | Promise<void>;

/**
 * The deactivate function signature (optional).
 * Tools export: `export function deactivate()`
 */
export type DeactivateFunction = () => void | Promise<void>;

/**
 * Loaded tool module with extracted exports.
 */
export interface ToolModule {
  /** The tool's activate function. */
  readonly activate: ActivateFunction;
  /** The tool's optional deactivate function. */
  readonly deactivate?: DeactivateFunction;
  /** The raw module for diagnostics. */
  readonly rawModule: Record<string, unknown>;
}

// ─── Validation (from toolValidator) ─────────────────────────────────────────

export interface ValidationError {
  /** Dot-path to the offending field (e.g., 'contributes.views[0].id'). */
  readonly path: string;
  /** Human-readable error message. */
  readonly message: string;
}

export interface ValidationResult {
  /** Whether the manifest is valid (no errors). Warnings don't fail validation. */
  readonly valid: boolean;
  /** Validation errors (each prevents registration). */
  readonly errors: readonly ValidationError[];
  /** Validation warnings (informational, don't prevent registration). */
  readonly warnings: readonly ValidationWarning[];
}

/** Validation warning — advisory only, does not prevent registration. */
export interface ValidationWarning {
  /** Dot-path to the field that triggered the warning. */
  readonly path: string;
  /** Human-readable warning message. */
  readonly message: string;
}

// ─── Error Isolation (from toolErrorIsolation) ───────────────────────────────

/**
 * A recorded tool error.
 */
export interface ToolError {
  /** Tool ID that caused the error. */
  readonly toolId: string;
  /** Human-readable error message. */
  readonly message: string;
  /** Stack trace (if available). */
  readonly stack?: string;
  /** When the error occurred. */
  readonly timestamp: number;
  /** Context where the error happened (activation, command, view, etc.). */
  readonly context: string;
}

/**
 * Event fired when a tool error is recorded.
 */
export interface ToolErrorEvent extends ToolError {}

// ─── Enablement (from toolEnablement) ────────────────────────────────────────

/**
 * The enablement state of a tool.
 * Extensible later to per-workspace scoping.
 */
export enum ToolEnablementState {
  /** Tool is enabled globally (default state). */
  EnabledGlobally = 'EnabledGlobally',
  /** Tool is disabled globally by the user. */
  DisabledGlobally = 'DisabledGlobally',
}

/**
 * Event fired when a tool's enablement state changes.
 */
export interface ToolEnablementChangeEvent {
  /** The tool whose enablement changed. */
  readonly toolId: string;
  /** The new enablement state. */
  readonly newState: ToolEnablementState;
}

/**
 * Service that tracks and persists enabled/disabled state for tools.
 *
 * VS Code equivalent: IWorkbenchExtensionEnablementService
 * Simplified to two states since Parallx has no remote servers,
 * workspace trust, or extension kind restrictions.
 */
export interface IToolEnablementService {
  isEnabled(toolId: string): boolean;
  setEnablement(toolId: string, enabled: boolean): Promise<void>;
  getEnablementState(toolId: string): ToolEnablementState;
  canChangeEnablement(toolId: string): boolean;
  getDisabledToolIds(): ReadonlySet<string>;
  readonly onDidChangeEnablement: Event<ToolEnablementChangeEvent>;
}

// ─── Activation Events (from activationEventService) ─────────────────────────

/**
 * Activation event kinds supported in M2.
 */
export enum ActivationEventKind {
  /** Eager — activates immediately on startup. */
  Star = '*',
  /** After shell init completes. */
  OnStartupFinished = 'onStartupFinished',
  /** When a specific command is first invoked. */
  OnCommand = 'onCommand',
  /** When a specific view is first shown. */
  OnView = 'onView',
}

/**
 * A parsed activation event.
 */
export interface ParsedActivationEvent {
  readonly kind: ActivationEventKind;
  /** The qualifier after the colon, e.g., the commandId in `onCommand:myTool.doSomething`. */
  readonly qualifier?: string;
  /** Original event string. */
  readonly raw: string;
}

/**
 * Fired when the system determines a tool should be activated.
 */
export interface ActivationRequest {
  readonly toolId: string;
  readonly event: ParsedActivationEvent;
  readonly timestamp: number;
}

// ─── Tool Activator (from toolActivator) ─────────────────────────────────────

/**
 * Record of an activated tool.
 */
export interface ActivatedTool {
  /** The tool's validated description. */
  readonly description: IToolDescription;
  /** The loaded module. */
  readonly module: ToolModule;
  /** The tool context passed to activate(). */
  readonly context: ToolContext;
  /** The scoped API object (typed as unknown to avoid api/ dependency). */
  readonly api: unknown;
  /** Function to dispose the API bridges. */
  readonly disposeApi: () => void;
  /** Timestamp when activation completed. */
  readonly activatedAt: number;
  /** Duration of activation in ms. */
  readonly activationDurationMs: number;
}

/**
 * Event fired on activation/deactivation.
 */
export interface ToolActivationEvent {
  readonly toolId: string;
  readonly success: boolean;
  readonly durationMs: number;
  readonly error?: string;
}

/**
 * Optional storage dependencies for persistent mementos.
 * When provided, ToolMemento is used instead of InMemoryMemento.
 */
export interface ToolStorageDependencies {
  readonly globalStorage: IStorage;
  readonly workspaceStorage: IStorage;
  readonly configRegistry?: ConfigurationRegistry;
  readonly workspaceIdProvider?: () => string | undefined;
}
