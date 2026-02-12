// windowService.ts — Electron window‐control abstraction
//
// Wraps the `window.parallxElectron` IPC bridge exposed by
// electron/preload.cjs behind a proper service interface so that
// Part classes never access the global directly.
//
// VS Code reference: INativeHostService / NativeHostService
//   - src/vs/platform/native/common/native.ts (interface)
//   - src/vs/platform/native/common/nativeHostService.ts (impl)

import { Disposable } from '../platform/lifecycle.js';
import { Emitter, Event } from '../platform/events.js';
import { IWindowService } from './serviceTypes.js';

// ─── Electron bridge shape (matches preload.cjs) ────────────────────────────

interface ElectronWindowApi {
  minimize(): void;
  maximize(): void;
  close(): void;
  isMaximized(): Promise<boolean>;
  onMaximizedChange(callback: (maximized: boolean) => void): void;
}

// ─── WindowService ───────────────────────────────────────────────────────────

/**
 * Bridges native window operations to the Electron IPC layer.
 * Falls back to no-ops when running outside Electron (pure browser).
 */
export class WindowService extends Disposable implements IWindowService {
  private readonly _api: ElectronWindowApi | undefined;

  private readonly _onDidChangeMaximized = this._register(new Emitter<boolean>());
  readonly onDidChangeMaximized: Event<boolean> = this._onDidChangeMaximized.event;

  readonly isNativeWindow: boolean;

  constructor() {
    super();

    // Probe for the preload-injected API
    this._api = (window as any).parallxElectron as ElectronWindowApi | undefined;
    this.isNativeWindow = !!this._api;

    // Subscribe to maximised-state changes from the main process
    this._api?.onMaximizedChange((maximized) => {
      this._onDidChangeMaximized.fire(maximized);
    });
  }

  // ── Window controls ──

  minimize(): void {
    this._api?.minimize();
  }

  maximize(): void {
    this._api?.maximize();
  }

  close(): void {
    this._api?.close();
  }

  async isMaximized(): Promise<boolean> {
    return this._api?.isMaximized() ?? false;
  }
}
