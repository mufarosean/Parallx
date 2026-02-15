// toolEnablement.ts — tool enablement types
//
// Defines the enablement state model for Parallx tools.
// Tools can be enabled or disabled globally. Per-workspace scoping
// is supported by the enum but not implemented until needed.
//
// VS Code reference:
//   src/vs/workbench/services/extensionManagement/common/extensionManagement.ts
//   — EnablementState enum (simplified from 8 states to 2 for M6)

import type { Event } from '../platform/events.js';

// ─── Enablement State ────────────────────────────────────────────────────────

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

// ─── Events ──────────────────────────────────────────────────────────────────

/**
 * Event fired when a tool's enablement state changes.
 */
export interface ToolEnablementChangeEvent {
  /** The tool whose enablement changed. */
  readonly toolId: string;
  /** The new enablement state. */
  readonly newState: ToolEnablementState;
}

// ─── Service Interface ───────────────────────────────────────────────────────

/**
 * Service that tracks and persists enabled/disabled state for tools.
 *
 * VS Code equivalent: IWorkbenchExtensionEnablementService
 * Simplified to two states since Parallx has no remote servers,
 * workspace trust, or extension kind restrictions.
 */
export interface IToolEnablementService {
  /**
   * Whether a tool is currently enabled.
   * Returns `true` if the tool ID is NOT in the disabled set.
   */
  isEnabled(toolId: string): boolean;

  /**
   * Set the enablement state of a tool.
   * Persists the change to storage and fires `onDidChangeEnablement`.
   * Throws if `canChangeEnablement(toolId)` returns `false`.
   */
  setEnablement(toolId: string, enabled: boolean): Promise<void>;

  /**
   * Get the enablement state of a tool.
   */
  getEnablementState(toolId: string): ToolEnablementState;

  /**
   * Whether the enablement state of a tool can be changed by the user.
   * Returns `false` for built-in tools (they are always enabled).
   */
  canChangeEnablement(toolId: string): boolean;

  /**
   * Get all tool IDs that are currently disabled.
   * Used during startup to filter which tools to skip.
   */
  getDisabledToolIds(): ReadonlySet<string>;

  /**
   * Fires when any tool's enablement state changes.
   */
  readonly onDidChangeEnablement: Event<ToolEnablementChangeEvent>;
}
