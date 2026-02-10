// commandsBridge.ts — bridges parallx.commands to internal CommandService
//
// Scopes command registration to the calling tool and tracks
// disposables for cleanup on deactivation.

import { IDisposable, toDisposable } from '../platform/lifecycle.js';
import type { ICommandServiceShape, CommandDescriptor, CommandHandler, CommandExecutionContext } from '../commands/commandTypes.js';

/**
 * Bridge for the `parallx.commands` API namespace.
 * All commands registered through this bridge are attributed to the tool.
 */
export class CommandsBridge {
  private readonly _registrations: IDisposable[] = [];
  private _disposed = false;

  constructor(
    private readonly _toolId: string,
    private readonly _commandService: ICommandServiceShape,
    private readonly _subscriptions: IDisposable[],
  ) {}

  /**
   * Register a command handler.
   * The command is attributed to this tool for cleanup.
   */
  registerCommand(id: string, handler: (...args: unknown[]) => unknown | Promise<unknown>): IDisposable {
    this._throwIfDisposed();

    // Wrap the tool's handler into the internal CommandHandler shape
    const internalHandler: CommandHandler = (ctx: CommandExecutionContext, ...args: unknown[]) => {
      return handler(...args);
    };

    const descriptor: CommandDescriptor = {
      id,
      title: id, // tools provide proper titles through manifest contributes.commands
      handler: internalHandler,
    };

    const disposable = this._commandService.registerCommand(descriptor);
    this._registrations.push(disposable);
    this._subscriptions.push(disposable);

    return disposable;
  }

  /**
   * Execute a command by ID.
   */
  async executeCommand<T = unknown>(id: string, ...args: unknown[]): Promise<T> {
    this._throwIfDisposed();
    return this._commandService.executeCommand<T>(id, ...args);
  }

  /**
   * Get all registered command IDs.
   */
  async getCommands(): Promise<string[]> {
    this._throwIfDisposed();
    return [...this._commandService.getCommands().keys()];
  }

  /**
   * Dispose all commands registered by this tool.
   */
  dispose(): void {
    this._disposed = true;
    for (const d of this._registrations) {
      d.dispose();
    }
    this._registrations.length = 0;
  }

  private _throwIfDisposed(): void {
    if (this._disposed) {
      throw new Error(`[CommandsBridge] Tool "${this._toolId}" has been deactivated — API access is no longer allowed.`);
    }
  }
}
