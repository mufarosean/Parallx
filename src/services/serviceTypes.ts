// serviceTypes.ts — service interface definitions

import { ServiceIdentifier, createServiceIdentifier } from '../platform/types.js';
import { IDisposable } from '../platform/lifecycle.js';
import { Event } from '../platform/events.js';

// ─── ILifecycleService ───────────────────────────────────────────────────────

/**
 * Provides workbench lifecycle phase tracking and hooks.
 */
export interface ILifecycleService extends IDisposable {
  readonly phase: number | undefined;
  hasReachedPhase(phase: number): boolean;
  onStartup(phase: number, hook: () => void | Promise<void>): IDisposable;
  onTeardown(phase: number, hook: () => void | Promise<void>): IDisposable;
  startup(): Promise<void>;
  teardown(): Promise<void>;
}

export const ILifecycleService = createServiceIdentifier<ILifecycleService>('ILifecycleService');

// ─── ILayoutService ──────────────────────────────────────────────────────────

/**
 * Manages overall workbench layout.
 */
export interface ILayoutService extends IDisposable {
  readonly container: HTMLElement | undefined;
  layout(): void;
}

export const ILayoutService = createServiceIdentifier<ILayoutService>('ILayoutService');

// ─── IViewService ────────────────────────────────────────────────────────────

/**
 * Manages view lifecycle and placement.
 */
export interface IViewService extends IDisposable {
  // Will be expanded in Capability 4
}

export const IViewService = createServiceIdentifier<IViewService>('IViewService');

// ─── IWorkspaceService ───────────────────────────────────────────────────────

import type { Workspace } from '../workspace/workspace.js';
import type { WorkspaceState } from '../workspace/workspaceTypes.js';
import type { RecentWorkspaceEntry } from '../workspace/workspaceTypes.js';

/**
 * Manages workspace identity, state persistence, and switching.
 */
export interface IWorkspaceService extends IDisposable {
  /** The currently active workspace (undefined before first load). */
  readonly activeWorkspace: Workspace | undefined;

  /** Whether a workspace has been loaded and restored. */
  readonly isRestored: boolean;

  /** Fires when the active workspace changes (e.g. after a switch). */
  readonly onDidChangeWorkspace: Event<Workspace | undefined>;

  /** Fires after workspace state has been restored. */
  readonly onDidRestoreState: Event<WorkspaceState>;

  /** Explicitly save the current workspace state. */
  save(): Promise<void>;

  /** Request a debounced save (for auto-save). */
  requestSave(): void;

  /** Create a new workspace and optionally switch to it. */
  createWorkspace(name: string, path?: string, switchTo?: boolean): Promise<Workspace>;

  /** Switch to a different workspace by ID. */
  switchWorkspace(workspaceId: string): Promise<void>;

  /** Get the recent workspaces list. */
  getRecentWorkspaces(): Promise<readonly RecentWorkspaceEntry[]>;

  /** Remove a workspace from the recent list. */
  removeRecentWorkspace(workspaceId: string): Promise<void>;
}

export const IWorkspaceService = createServiceIdentifier<IWorkspaceService>('IWorkspaceService');

// ─── IEditorService ──────────────────────────────────────────────────────────

/**
 * Manages editor opening/closing and active editor tracking.
 */
export interface IEditorService extends IDisposable {
  // Will be expanded in Capability 9
}

export const IEditorService = createServiceIdentifier<IEditorService>('IEditorService');

// ─── IEditorGroupService ─────────────────────────────────────────────────────

/**
 * Manages editor group lifecycle and layout.
 */
export interface IEditorGroupService extends IDisposable {
  // Will be expanded in Capability 9
}

export const IEditorGroupService = createServiceIdentifier<IEditorGroupService>('IEditorGroupService');

// ─── ICommandService ─────────────────────────────────────────────────────────

import type {
  CommandDescriptor,
  CommandExecutedEvent,
  CommandRegisteredEvent,
  CommandUnregisteredEvent,
  ICommandServiceShape,
} from '../commands/commandTypes.js';

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
  // Will be expanded in Capability 8
}

export const IContextKeyService = createServiceIdentifier<IContextKeyService>('IContextKeyService');
