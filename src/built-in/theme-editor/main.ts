// main.ts — Theme Editor built-in tool activation (M49 Phase 4)
//
// Registers the Theme Editor panel as a Parallx view.
// Provides live theme customization with save/load/import/export.

import type { ToolContext } from '../../tools/toolModuleLoader.js';
import type { IDisposable } from '../../platform/lifecycle.js';
import { IThemeService } from '../../services/serviceTypes.js';
import { ThemeEditorPanel } from './themeEditorPanel.js';

// ─── Local API type ──────────────────────────────────────────────────────────

interface ParallxApi {
  views: {
    registerViewProvider(
      viewId: string,
      provider: { createView(container: HTMLElement): IDisposable },
      options?: Record<string, unknown>,
    ): IDisposable;
  };
  commands: {
    registerCommand(id: string, handler: (...args: unknown[]) => unknown): IDisposable;
    executeCommand<T = unknown>(id: string, ...args: unknown[]): Promise<T>;
  };
  services: {
    get<T>(id: { readonly id: string }): T;
    has(id: { readonly id: string }): boolean;
  };
}

// ─── Module State ────────────────────────────────────────────────────────────

let _panel: ThemeEditorPanel | null = null;

// ─── Activation ──────────────────────────────────────────────────────────────

export function activate(api: ParallxApi, context: ToolContext): void {
  const themeService = api.services.get<import('../../services/serviceTypes.js').IThemeService>(IThemeService);

  // Register view provider
  context.subscriptions.push(
    api.views.registerViewProvider('view.themeEditor', {
      createView(container: HTMLElement): IDisposable {
        _panel = new ThemeEditorPanel(container, themeService);
        return _panel;
      },
    }),
  );

  // Register the "Open Theme Editor" command
  context.subscriptions.push(
    api.commands.registerCommand('theme-editor.open', () => {
      api.commands.executeCommand('workbench.view.show', 'view.themeEditor');
    }),
  );
}

export function deactivate(): void {
  if (_panel) {
    _panel.dispose();
    _panel = null;
  }
}
