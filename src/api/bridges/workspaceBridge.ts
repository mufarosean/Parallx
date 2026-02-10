// workspaceBridge.ts — bridges parallx.workspace to configuration
//
// Provides configuration read access and change events for tools.
// In M2, configuration is backed by workspace state storage.

import { IDisposable, toDisposable } from '../../platform/lifecycle.js';
import { Emitter, Event } from '../../platform/events.js';

/**
 * A read-only configuration object.
 */
export interface IConfiguration {
  get<T>(key: string, defaultValue?: T): T | undefined;
  has(key: string): boolean;
}

export interface IConfigurationChangeEvent {
  affectsConfiguration(section: string): boolean;
}

/**
 * Bridge for the `parallx.workspace` API namespace.
 *
 * In M2, configuration is stored in workspace state as a flat key-value map
 * under `config.<toolId>.<section>.<key>`. Full configuration contribution
 * points are expanded in Capability 4.
 */
export class WorkspaceBridge {
  private readonly _configStore = new Map<string, unknown>();
  private _disposed = false;

  private readonly _onDidChangeConfiguration = new Emitter<IConfigurationChangeEvent>();
  readonly onDidChangeConfiguration: Event<IConfigurationChangeEvent> = this._onDidChangeConfiguration.event;

  constructor(
    private readonly _toolId: string,
    private readonly _subscriptions: IDisposable[],
  ) {
    this._subscriptions.push(this._onDidChangeConfiguration);
  }

  /**
   * Get a configuration object scoped to a section.
   */
  getConfiguration(section?: string): IConfiguration {
    this._throwIfDisposed();
    const prefix = section ? `${this._toolId}.${section}` : this._toolId;

    return {
      get: <T>(key: string, defaultValue?: T): T | undefined => {
        const fullKey = `${prefix}.${key}`;
        if (this._configStore.has(fullKey)) {
          return this._configStore.get(fullKey) as T;
        }
        return defaultValue;
      },
      has: (key: string): boolean => {
        return this._configStore.has(`${prefix}.${key}`);
      },
    };
  }

  /**
   * Set a configuration value (used internally by the shell when loading defaults).
   */
  _setConfigValue(section: string, key: string, value: unknown): void {
    const fullKey = `${this._toolId}.${section}.${key}`;
    this._configStore.set(fullKey, value);
    this._onDidChangeConfiguration.fire({
      affectsConfiguration: (s: string) => fullKey.startsWith(s) || s.startsWith(fullKey),
    });
  }

  dispose(): void {
    this._disposed = true;
    this._configStore.clear();
    this._onDidChangeConfiguration.dispose();
  }

  private _throwIfDisposed(): void {
    if (this._disposed) {
      throw new Error(`[WorkspaceBridge] Tool "${this._toolId}" has been deactivated — API access is no longer allowed.`);
    }
  }
}
