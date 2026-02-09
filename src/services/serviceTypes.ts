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

/**
 * Manages workspace identity and state.
 */
export interface IWorkspaceService extends IDisposable {
  // Will be expanded in Capability 5/6
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

/**
 * Registers and executes commands.
 */
export interface ICommandService extends IDisposable {
  // Will be expanded in Capability 7
}

export const ICommandService = createServiceIdentifier<ICommandService>('ICommandService');

// ─── IContextKeyService ──────────────────────────────────────────────────────

/**
 * Manages context keys and when-clause evaluation.
 */
export interface IContextKeyService extends IDisposable {
  // Will be expanded in Capability 8
}

export const IContextKeyService = createServiceIdentifier<IContextKeyService>('IContextKeyService');
