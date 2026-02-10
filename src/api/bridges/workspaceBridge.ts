// workspaceBridge.ts — bridges parallx.workspace to configuration
//
// Provides configuration read access and change events for tools.
// In M2, configuration is backed by the ConfigurationService (Cap 4)
// which persists values per-workspace in IStorage.

import { IDisposable, toDisposable } from '../../platform/lifecycle.js';
import { Emitter, Event } from '../../platform/events.js';
import type { ConfigurationService } from '../../configuration/configurationService.js';
import type { IWorkspaceConfiguration, IConfigurationChangeEvent } from '../../configuration/configurationTypes.js';

/**
 * Bridge for the `parallx.workspace` API namespace.
 *
 * Delegates to the ConfigurationService (Cap 4) for reading and writing
 * configuration values. Configuration schemas are registered from manifests
 * via the ConfigurationRegistry.
 */
export class WorkspaceBridge {
  private _disposed = false;
  private readonly _disposables: IDisposable[] = [];

  /** Forwarded change event. */
  readonly onDidChangeConfiguration: Event<IConfigurationChangeEvent>;

  constructor(
    private readonly _toolId: string,
    private readonly _subscriptions: IDisposable[],
    private readonly _configService?: ConfigurationService,
  ) {
    if (this._configService) {
      this.onDidChangeConfiguration = this._configService.onDidChangeConfiguration;
    } else {
      // Fallback: no-op event when ConfigurationService is not available
      const fallbackEmitter = new Emitter<IConfigurationChangeEvent>();
      this._disposables.push(fallbackEmitter);
      this.onDidChangeConfiguration = fallbackEmitter.event;
    }
  }

  /**
   * Get a configuration object scoped to a section.
   */
  getConfiguration(section?: string): IWorkspaceConfiguration {
    this._throwIfDisposed();

    if (this._configService) {
      return this._configService.getConfiguration(section);
    }

    // Fallback: empty configuration when service is not available
    return {
      get: <T>(_key: string, defaultValue?: T): T | undefined => defaultValue,
      update: async () => {},
      has: () => false,
    };
  }

  dispose(): void {
    this._disposed = true;
    for (const d of this._disposables) {
      d.dispose();
    }
    this._disposables.length = 0;
  }

  private _throwIfDisposed(): void {
    if (this._disposed) {
      throw new Error(`[WorkspaceBridge] Tool "${this._toolId}" has been deactivated — API access is no longer allowed.`);
    }
  }
}
