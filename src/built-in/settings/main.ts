// main.ts — M60 Phase ε §7 T4.D2 settings extension activation
//
// Registers the `settings.open` command. Opens a modal/overlay editor
// rendered by SettingsEditor over document.body. No new workbench panel
// slot — this keeps us within the §3.4 boundary.

import type { ToolContext } from '../../tools/toolModuleLoader.js';
import type { IDisposable } from '../../platform/lifecycle.js';
import { ISettingsRegistryService } from '../../services/serviceTypes.js';
import { SettingsEditor } from './settingsEditor.js';

// ─── Local API type ──────────────────────────────────────────────────────────

interface ParallxApi {
  commands: {
    registerCommand(id: string, handler: (...args: unknown[]) => unknown): IDisposable;
    executeCommand<T = unknown>(id: string, ...args: unknown[]): Promise<T>;
  };
  services: {
    get<T>(id: { readonly id: string }): T;
    has(id: { readonly id: string }): boolean;
  };
}

// ─── Module state ────────────────────────────────────────────────────────────

let _editor: SettingsEditor | null = null;

// ─── Activation ──────────────────────────────────────────────────────────────

export function activate(api: ParallxApi, context: ToolContext): void {
  context.subscriptions.push(
    api.commands.registerCommand('settings.open', () => {
      if (!api.services.has(ISettingsRegistryService)) {
        console.warn('[settings] ISettingsRegistryService not available');
        return;
      }
      const registry = api.services.get<import('../../services/settingsRegistryService.js').ISettingsRegistryService>(
        ISettingsRegistryService,
      );

      // §3.8 rollback flag — bail out cleanly if the editor is disabled.
      try {
        const enabled = registry.getValue<boolean>('settings.editor.enabled');
        if (enabled === false) {
          console.info('[settings] editor disabled by settings.editor.enabled flag');
          return;
        }
      } catch {
        /* schema not registered — proceed (registry must have at least defaults) */
      }

      // Lazy single-instance — re-open shows the same editor again.
      if (_editor) {
        _editor.dispose();
        _editor = null;
      }
      _editor = new SettingsEditor(document.body, registry);
      _editor.show();
    }),
  );
}

export function deactivate(): void {
  if (_editor) {
    _editor.dispose();
    _editor = null;
  }
}
