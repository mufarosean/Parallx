// commandContribution.ts — contributes.commands processor
//
// Processes the `contributes.commands` section from tool manifests.
// Registers command descriptors with the CommandService using proxy
// handlers that trigger tool activation on first invocation. Once
// the tool activates and registers the real handler via the API,
// the proxy is replaced.
//
// Also manages the lifecycle of contributed commands — they are
// unregistered when their owning tool is deactivated.

import { Disposable, IDisposable } from '../platform/lifecycle.js';
import { Emitter, Event } from '../platform/events.js';
import type { IToolDescription } from '../tools/toolManifest.js';
import type { CommandService } from '../commands/commandRegistry.js';
import type { CommandDescriptor, CommandExecutionContext } from '../commands/commandTypes.js';
import type { ActivationEventService } from '../tools/activationEventService.js';
import type { IContributedCommand, IContributionProcessor } from './contributionTypes.js';

// ─── Queued Invocation ───────────────────────────────────────────────────────

interface QueuedInvocation {
  readonly args: unknown[];
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

// ─── CommandContributionProcessor ────────────────────────────────────────────

/**
 * Processes `contributes.commands` from tool manifests.
 *
 * For each declared command:
 * 1. Registers a proxy handler in the CommandService
 * 2. When invoked before the tool activates, fires the activation event
 *    and queues the invocation
 * 3. Once the real handler is registered by the tool, replays queued
 *    invocations and replaces the proxy
 */
export class CommandContributionProcessor extends Disposable implements IContributionProcessor {

  /** Timeout (ms) before a queued proxy invocation is rejected. */
  static readonly PROXY_TIMEOUT_MS = 10_000;

  /** Contributed command metadata, keyed by command ID. */
  private readonly _contributed = new Map<string, IContributedCommand>();

  /** Registration disposables per tool. */
  private readonly _registrations = new Map<string, IDisposable[]>();

  /** Queued invocations waiting for real handler registration. */
  private readonly _pendingInvocations = new Map<string, QueuedInvocation[]>();

  /** Real handlers registered by tools at runtime. */
  private readonly _realHandlers = new Map<string, (...args: unknown[]) => unknown | Promise<unknown>>();

  // ── Events ──

  private readonly _onDidProcessCommands = this._register(new Emitter<{ toolId: string; commands: readonly IContributedCommand[] }>());
  /** Fires when commands are processed from a manifest. */
  readonly onDidProcessCommands: Event<{ toolId: string; commands: readonly IContributedCommand[] }> = this._onDidProcessCommands.event;

  private readonly _onDidRemoveCommands = this._register(new Emitter<{ toolId: string; commandIds: readonly string[] }>());
  /** Fires when commands are removed (tool deactivation). */
  readonly onDidRemoveCommands: Event<{ toolId: string; commandIds: readonly string[] }> = this._onDidRemoveCommands.event;

  constructor(
    private readonly _commandService: CommandService,
    private readonly _activationEvents: ActivationEventService,
  ) {
    super();
  }

  // ── IContributionProcessor ──

  /**
   * Process a tool's `contributes.commands` and register proxy handlers.
   */
  processContributions(toolDescription: IToolDescription): void {
    const { manifest } = toolDescription;
    const commands = manifest.contributes?.commands;
    if (!commands || commands.length === 0) return;

    const toolId = manifest.id;
    const disposables: IDisposable[] = [];
    const contributedList: IContributedCommand[] = [];

    for (const cmd of commands) {
      // Skip if already registered (e.g. duplicate processing)
      if (this._contributed.has(cmd.id)) {
        console.warn(`[CommandContribution] Command "${cmd.id}" is already contributed — skipping`);
        continue;
      }

      // Skip if the command is already registered in the service (e.g. structural commands)
      if (this._commandService.hasCommand(cmd.id)) {
        console.warn(`[CommandContribution] Command "${cmd.id}" is already registered in CommandService — skipping proxy`);
        // Still track it as contributed for metadata
        const contributed: IContributedCommand = {
          commandId: cmd.id,
          toolId,
          title: cmd.title,
          category: cmd.category,
          icon: cmd.icon,
          keybinding: cmd.keybinding,
          when: cmd.when,
          handlerWired: true,
        };
        this._contributed.set(cmd.id, contributed);
        contributedList.push(contributed);
        continue;
      }

      // Create the contributed command record
      const contributed: IContributedCommand = {
        commandId: cmd.id,
        toolId,
        title: cmd.title,
        category: cmd.category,
        icon: cmd.icon,
        keybinding: cmd.keybinding,
        when: cmd.when,
        handlerWired: false,
      };

      // Create a proxy handler that activates the tool on first invocation
      const proxyHandler = this._createProxyHandler(cmd.id, toolId);

      // Build the full CommandDescriptor
      const descriptor: CommandDescriptor = {
        id: cmd.id,
        title: cmd.title,
        category: cmd.category,
        icon: cmd.icon,
        keybinding: cmd.keybinding,
        when: cmd.when,
        handler: proxyHandler,
      };

      try {
        const registration = this._commandService.registerCommand(descriptor);
        disposables.push(registration);
        this._contributed.set(cmd.id, contributed);
        contributedList.push(contributed);
      } catch (err) {
        console.error(`[CommandContribution] Failed to register command "${cmd.id}" from tool "${toolId}":`, err);
      }
    }

    // Store registrations for cleanup
    const existing = this._registrations.get(toolId) ?? [];
    this._registrations.set(toolId, [...existing, ...disposables]);

    if (contributedList.length > 0) {
      this._onDidProcessCommands.fire({ toolId, commands: contributedList });
      console.log(
        `[CommandContribution] Registered ${contributedList.length} command(s) from tool "${toolId}":`,
        contributedList.map(c => c.commandId).join(', '),
      );
    }
  }

  /**
   * Remove all contributed commands from a tool.
   */
  removeContributions(toolId: string): void {
    const disposables = this._registrations.get(toolId);
    const removedIds: string[] = [];

    if (disposables) {
      for (const d of disposables) {
        d.dispose();
      }
      this._registrations.delete(toolId);
    }

    // Clean up contributed records and queues
    for (const [cmdId, contributed] of this._contributed) {
      if (contributed.toolId === toolId) {
        removedIds.push(cmdId);
        this._contributed.delete(cmdId);

        // Reject any pending invocations so caller promises settle
        const pendingQueue = this._pendingInvocations.get(cmdId);
        if (pendingQueue) {
          for (const invocation of pendingQueue) {
            invocation.reject(new Error(
              `[CommandContribution] Command "${cmdId}" from tool "${toolId}" ` +
              `was deactivated while invocations were pending`,
            ));
          }
          this._pendingInvocations.delete(cmdId);
        }

        this._realHandlers.delete(cmdId);
      }
    }

    if (removedIds.length > 0) {
      this._onDidRemoveCommands.fire({ toolId, commandIds: removedIds });
      console.log(
        `[CommandContribution] Removed ${removedIds.length} command(s) from tool "${toolId}":`,
        removedIds.join(', '),
      );
    }
  }

  // ── Real Handler Registration ──

  /**
   * Called by the CommandsBridge when a tool registers a real handler
   * for a command that was declared in its manifest.
   *
   * Replaces the proxy handler with the real one and replays
   * any queued invocations.
   */
  wireRealHandler(commandId: string, handler: (...args: unknown[]) => unknown | Promise<unknown>): void {
    this._realHandlers.set(commandId, handler);

    const contributed = this._contributed.get(commandId);
    if (contributed) {
      contributed.handlerWired = true;
    }

    // Replay any queued invocations
    const queued = this._pendingInvocations.get(commandId);
    if (queued && queued.length > 0) {
      console.log(`[CommandContribution] Replaying ${queued.length} queued invocation(s) for "${commandId}"`);
      this._pendingInvocations.delete(commandId);

      for (const invocation of queued) {
        try {
          const result = handler(...invocation.args);
          if (result instanceof Promise) {
            result.then(invocation.resolve, invocation.reject);
          } else {
            invocation.resolve(result);
          }
        } catch (err) {
          invocation.reject(err);
        }
      }
    }
  }

  // ── Queries ──

  /**
   * Get all contributed commands.
   */
  getContributedCommands(): readonly IContributedCommand[] {
    return [...this._contributed.values()];
  }

  /**
   * Get contributed commands for a specific tool.
   */
  getContributedCommandsForTool(toolId: string): readonly IContributedCommand[] {
    return [...this._contributed.values()].filter(c => c.toolId === toolId);
  }

  /**
   * Get the contributed command metadata by command ID.
   */
  getContributedCommand(commandId: string): IContributedCommand | undefined {
    return this._contributed.get(commandId);
  }

  /**
   * Check if a command was contributed by a tool.
   */
  isContributed(commandId: string): boolean {
    return this._contributed.has(commandId);
  }

  // ── Internal ──

  /**
   * Create a proxy handler that triggers tool activation and queues invocations.
   */
  private _createProxyHandler(commandId: string, toolId: string) {
    return (_ctx: CommandExecutionContext, ...args: unknown[]): Promise<unknown> => {
      // If the real handler is already wired, call it directly
      const realHandler = this._realHandlers.get(commandId);
      if (realHandler) {
        return Promise.resolve(realHandler(...args));
      }

      // Fire the activation event for the tool
      this._activationEvents.fireCommand(commandId);

      // Queue the invocation and return a promise
      return new Promise((resolve, reject) => {
        const queue = this._pendingInvocations.get(commandId) ?? [];
        queue.push({ args, resolve, reject });
        this._pendingInvocations.set(commandId, queue);

        // Timeout after PROXY_TIMEOUT_MS to prevent indefinite hanging
        setTimeout(() => {
          const currentQueue = this._pendingInvocations.get(commandId);
          if (currentQueue) {
            const idx = currentQueue.findIndex(q => q.resolve === resolve);
            if (idx >= 0) {
              currentQueue.splice(idx, 1);
              reject(new Error(
                `[CommandContribution] Timed out waiting for handler for command "${commandId}" ` +
                `from tool "${toolId}" — tool may have failed to activate`,
              ));
            }
          }
        }, CommandContributionProcessor.PROXY_TIMEOUT_MS);
      });
    };
  }

  // ── Disposal ──

  override dispose(): void {
    // Clean up all registrations
    for (const disposables of this._registrations.values()) {
      for (const d of disposables) {
        d.dispose();
      }
    }
    this._registrations.clear();
    this._contributed.clear();
    this._pendingInvocations.clear();
    this._realHandlers.clear();
    super.dispose();
  }
}
