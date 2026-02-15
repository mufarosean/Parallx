// windowBridge.ts — bridges parallx.window to notification + modal services
//
// Provides message, input box, quick pick, and output channel APIs.

import { IDisposable } from '../../platform/lifecycle.js';
import {
  NotificationSeverity,
  showInputBoxModal,
  showQuickPickModal,
  type NotificationAction,
} from '../notificationService.js';
import type { INotificationService } from '../../services/serviceTypes.js';

/**
 * Bridge for the `parallx.window` API namespace.
 */
export class WindowBridge {
  private readonly _outputChannels: OutputChannelImpl[] = [];
  private _disposed = false;

  constructor(
    private readonly _toolId: string,
    private readonly _notificationService: INotificationService,
    private readonly _workbenchContainer: HTMLElement | undefined,
    private readonly _subscriptions: IDisposable[],
  ) {}

  async showInformationMessage(message: string, ...actions: NotificationAction[]): Promise<NotificationAction | undefined> {
    this._throwIfDisposed();
    return this._notificationService.notify(NotificationSeverity.Information, message, actions, this._toolId);
  }

  async showWarningMessage(message: string, ...actions: NotificationAction[]): Promise<NotificationAction | undefined> {
    this._throwIfDisposed();
    return this._notificationService.notify(NotificationSeverity.Warning, message, actions, this._toolId);
  }

  async showErrorMessage(message: string, ...actions: NotificationAction[]): Promise<NotificationAction | undefined> {
    this._throwIfDisposed();
    return this._notificationService.notify(NotificationSeverity.Error, message, actions, this._toolId);
  }

  async showInputBox(options?: {
    prompt?: string;
    value?: string;
    placeholder?: string;
    password?: boolean;
    validateInput?: (value: string) => string | undefined | Promise<string | undefined>;
  }): Promise<string | undefined> {
    this._throwIfDisposed();
    const parent = this._workbenchContainer ?? document.body;
    return showInputBoxModal(parent, options ?? {});
  }

  async showQuickPick(
    items: readonly { label: string; description?: string; detail?: string; picked?: boolean }[],
    options?: { placeholder?: string; canPickMany?: boolean; matchOnDescription?: boolean },
  ): Promise<any> {
    this._throwIfDisposed();
    const parent = this._workbenchContainer ?? document.body;
    return showQuickPickModal(parent, items, options);
  }

  createOutputChannel(name: string): OutputChannelImpl {
    this._throwIfDisposed();
    const channel = new OutputChannelImpl(`${this._toolId}: ${name}`);
    this._outputChannels.push(channel);
    this._subscriptions.push(channel);
    return channel;
  }

  dispose(): void {
    this._disposed = true;
    for (const ch of this._outputChannels) {
      ch.dispose();
    }
    this._outputChannels.length = 0;
  }

  private _throwIfDisposed(): void {
    if (this._disposed) {
      throw new Error(`[WindowBridge] Tool "${this._toolId}" has been deactivated — API access is no longer allowed.`);
    }
  }
}

// ─── Output Channel ──────────────────────────────────────────────────────────

/**
 * Simple output channel implementation.
 * In M2 this logs to the console. A dedicated Output panel is deferred.
 */
class OutputChannelImpl implements IDisposable {
  private _lines: string[] = [];
  private _visible = false;
  private _disposed = false;

  constructor(readonly name: string) {}

  append(value: string): void {
    if (this._disposed) return;
    this._lines.push(value);
    if (this._visible) {
      console.log(`[Output:${this.name}] ${value}`);
    }
  }

  appendLine(value: string): void {
    this.append(value + '\n');
  }

  clear(): void {
    this._lines = [];
  }

  show(): void {
    this._visible = true;
    // In M2, we just toggle the console logging visibility
    console.log(`[Output:${this.name}] Channel shown (${this._lines.length} lines buffered)`);
  }

  hide(): void {
    this._visible = false;
  }

  dispose(): void {
    this._disposed = true;
    this._lines = [];
  }
}
