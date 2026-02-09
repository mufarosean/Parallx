// commandTypes.ts — command contracts and interfaces//
// Defines the core types for the command system. Commands are first-class
// entities with metadata, preconditions (when clauses), and async handlers.
// The design mirrors VS Code's CommandsRegistry pattern, adapted for Parallx.

import type { IDisposable } from '../platform/lifecycle.js';
import type { Event } from '../platform/events.js';

// ─── Command Handler ─────────────────────────────────────────────────────────

/**
 * A command handler receives a context object plus arbitrary typed arguments.
 * It may return a value (useful for queries) or void.
 */
export type CommandHandler = (ctx: CommandExecutionContext, ...args: unknown[]) => unknown | Promise<unknown>;

/**
 * Context provided to every command handler during execution.
 * Gives the handler access to the service layer without coupling to concrete types.
 */
export interface CommandExecutionContext {
  /** Resolve a service by its string identifier (matches ServiceIdentifier.id). */
  getService<T>(id: string): T | undefined;

  /**
   * The workbench instance for direct access to workbench-level APIs.
   * Commands that need layout mutation, workspace operations, etc. use this.
   */
  readonly workbench: unknown; // typed as unknown to avoid circular import; cast in handler
}

// ─── Command Metadata ────────────────────────────────────────────────────────

/**
 * Static metadata for a registered command.
 */
export interface CommandDescriptor {
  /** Unique command identifier, e.g. `'workbench.action.toggleSidebar'`. */
  readonly id: string;

  /** Human-readable title shown in the command palette. */
  readonly title: string;

  /** Optional category for grouping in the palette (e.g. "View", "Workspace"). */
  readonly category?: string;

  /** Optional icon identifier (codicon name or custom). */
  readonly icon?: string;

  /** Optional default keybinding string, e.g. `'Ctrl+B'`. */
  readonly keybinding?: string;

  /**
   * When-clause expression that controls command availability.
   * The command is available only when this expression evaluates to true.
   * Undefined means always available.
   * Example: `'sidebarVisible'`, `'!panelVisible && editorGroupCount > 1'`
   */
  readonly when?: string;

  /** The handler function invoked when the command is executed. */
  readonly handler: CommandHandler;
}

// ─── Command Registration ────────────────────────────────────────────────────

/**
 * Options for registering a command (everything except the handler,
 * which is required separately for type clarity).
 */
export interface CommandRegistrationOptions {
  readonly id: string;
  readonly title: string;
  readonly category?: string;
  readonly icon?: string;
  readonly keybinding?: string;
  readonly when?: string;
}

// ─── Command Events ──────────────────────────────────────────────────────────

/** Fired when a command is successfully executed. */
export interface CommandExecutedEvent {
  readonly commandId: string;
  readonly args: readonly unknown[];
  readonly result: unknown;
  readonly duration: number; // ms
}

/** Fired when a new command is registered. */
export interface CommandRegisteredEvent {
  readonly commandId: string;
  readonly descriptor: Readonly<CommandDescriptor>;
}

/** Fired when a command is unregistered. */
export interface CommandUnregisteredEvent {
  readonly commandId: string;
}

// ─── Command Registry Interface ──────────────────────────────────────────────

/**
 * Read-only view of the command registry.
 * Used by consumers that need to query available commands (e.g. the palette).
 */
export interface ICommandRegistry {
  /** All currently registered command descriptors. */
  getCommands(): ReadonlyMap<string, Readonly<CommandDescriptor>>;

  /** Look up a single command by ID. Returns undefined if not found. */
  getCommand(id: string): Readonly<CommandDescriptor> | undefined;

  /** Check if a command with the given ID exists. */
  hasCommand(id: string): boolean;

  /** Fires when a command is registered. */
  readonly onDidRegisterCommand: Event<CommandRegisteredEvent>;

  /** Fires when a command is unregistered. */
  readonly onDidUnregisterCommand: Event<CommandUnregisteredEvent>;
}

// ─── Command Service Interface ───────────────────────────────────────────────

/**
 * Full command service: registration + execution.
 * This is the primary entry-point for the command system.
 */
export interface ICommandServiceShape extends ICommandRegistry, IDisposable {
  /**
   * Register a command. Returns a disposable that unregisters it.
   * Throws if a command with the same ID is already registered.
   */
  registerCommand(descriptor: CommandDescriptor): IDisposable;

  /**
   * Execute a command by ID with the given arguments.
   * Throws if the command does not exist.
   * Throws if the precondition (when clause) is not satisfied.
   * Returns the result of the handler.
   */
  executeCommand<T = unknown>(id: string, ...args: unknown[]): Promise<T>;

  /** Fires after every successful command execution. */
  readonly onDidExecuteCommand: Event<CommandExecutedEvent>;
}