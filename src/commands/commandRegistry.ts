// commandRegistry.ts — command registration and execution//
// CommandService is the single authority for command registration, lookup,
// and execution. It implements ICommandServiceShape and is registered
// in the DI container under ICommandService.
//
// Design decisions:
//   • When-clause evaluation uses ContextKeyService (Cap 8) when available.
//   • Command handlers receive a CommandExecutionContext for service access.
//   • Registration returns a disposable for clean teardown.
//   • Execution is always async (even for sync handlers) for consistency.

import { Disposable, IDisposable } from '../platform/lifecycle.js';
import { Emitter, Event } from '../platform/events.js';
import { createServiceIdentifier } from '../platform/types.js';
import type { ServiceCollection } from '../services/serviceCollection.js';
import type {
  CommandDescriptor,
  CommandExecutionContext,
  CommandExecutedEvent,
  CommandRegisteredEvent,
  CommandUnregisteredEvent,
  ICommandServiceShape,
} from './commandTypes.js';

/** Minimal shape of ContextKeyService to avoid circular imports. */
interface IContextKeyServiceLike {
  contextMatchesRules(whenClause: string | undefined): boolean;
}

/**
 * Central command service — owns the registry and handles execution.
 */
export class CommandService extends Disposable implements ICommandServiceShape {
  private readonly _commands = new Map<string, CommandDescriptor>();

  // Optional backref to the workbench (set after Phase 1)
  private _workbench: unknown | undefined;

  // Context key service for when-clause evaluation (set by Cap 8 init)
  private _contextKeyService: IContextKeyServiceLike | undefined;

  // ── Events ──

  private readonly _onDidRegisterCommand = this._register(new Emitter<CommandRegisteredEvent>());
  readonly onDidRegisterCommand: Event<CommandRegisteredEvent> = this._onDidRegisterCommand.event;

  private readonly _onDidUnregisterCommand = this._register(new Emitter<CommandUnregisteredEvent>());
  readonly onDidUnregisterCommand: Event<CommandUnregisteredEvent> = this._onDidUnregisterCommand.event;

  private readonly _onDidExecuteCommand = this._register(new Emitter<CommandExecutedEvent>());
  readonly onDidExecuteCommand: Event<CommandExecutedEvent> = this._onDidExecuteCommand.event;

  constructor(private readonly _services: ServiceCollection) {
    super();
  }

  /**
   * Set the workbench reference so command handlers can access it.
   * Called once during workbench initialization.
   */
  setWorkbench(workbench: unknown): void {
    this._workbench = workbench;
  }

  /**
   * Set the context key service for real when-clause evaluation.
   * Called once during Cap 8 initialization.
   */
  setContextKeyService(service: IContextKeyServiceLike): void {
    this._contextKeyService = service;
  }

  // ─── Registry (read) ───────────────────────────────────────────────────────

  getCommands(): ReadonlyMap<string, Readonly<CommandDescriptor>> {
    return this._commands;
  }

  getCommand(id: string): Readonly<CommandDescriptor> | undefined {
    return this._commands.get(id);
  }

  hasCommand(id: string): boolean {
    return this._commands.has(id);
  }

  // ─── Registration ──────────────────────────────────────────────────────────

  registerCommand(descriptor: CommandDescriptor): IDisposable {
    if (this._commands.has(descriptor.id)) {
      throw new Error(`[CommandService] Command already registered: ${descriptor.id}`);
    }

    this._commands.set(descriptor.id, descriptor);
    this._onDidRegisterCommand.fire({
      commandId: descriptor.id,
      descriptor,
    });

    return {
      dispose: () => {
        if (this._commands.get(descriptor.id) === descriptor) {
          this._commands.delete(descriptor.id);
          this._onDidUnregisterCommand.fire({ commandId: descriptor.id });
        }
      },
    };
  }

  /**
   * Convenience: register many commands at once. Returns a single disposable.
   */
  registerCommands(descriptors: CommandDescriptor[]): IDisposable {
    const disposables = descriptors.map((d) => this.registerCommand(d));
    return {
      dispose: () => disposables.forEach((d) => d.dispose()),
    };
  }

  // ─── Execution ─────────────────────────────────────────────────────────────

  async executeCommand<T = unknown>(id: string, ...args: unknown[]): Promise<T> {
    const descriptor = this._commands.get(id);
    if (!descriptor) {
      throw new Error(`[CommandService] Unknown command: ${id}`);
    }

    // When-clause precondition check.
    // Uses ContextKeyService when available (Cap 8), otherwise accepts all.
    if (descriptor.when && this._contextKeyService) {
      if (!this._contextKeyService.contextMatchesRules(descriptor.when)) {
        throw new Error(
          `[CommandService] Command '${id}' precondition not met: ${descriptor.when}`,
        );
      }
    }

    const ctx = this._createContext();
    const start = performance.now();

    const result = await Promise.resolve(descriptor.handler(ctx, ...args));
    const duration = performance.now() - start;

    this._onDidExecuteCommand.fire({
      commandId: id,
      args,
      result,
      duration,
    });

    return result as T;
  }

  // ─── Internals ─────────────────────────────────────────────────────────────

  private _createContext(): CommandExecutionContext {
    const services = this._services;
    const workbench = this._workbench;
    return {
      getService<T>(id: string): T | undefined {
        try {
          return services.get(createServiceIdentifier<T>(id));
        } catch {
          return undefined;
        }
      },
      workbench,
    };
  }

  override dispose(): void {
    this._commands.clear();
    super.dispose();
  }
}