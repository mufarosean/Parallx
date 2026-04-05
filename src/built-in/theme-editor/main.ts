// main.ts — Theme Editor built-in tool activation
//
// Opens the Theme Editor as an editor tab using the standard editor provider API.
// Provides live theme customization with hover-preview, save/load/import/export.

import type { ToolContext } from '../../tools/toolModuleLoader.js';
import type { IDisposable } from '../../platform/lifecycle.js';
import type { IStorage } from '../../platform/storage.js';
import { IThemeService, IGlobalStorageService } from '../../services/serviceTypes.js';
import { ThemeEditorPanel } from './themeEditorPanel.js';

// ─── Local API type ──────────────────────────────────────────────────────────

interface ParallxApi {
  editors: {
    registerEditorProvider(typeId: string, provider: { createEditorPane(container: HTMLElement): IDisposable }): IDisposable;
    openEditor(options: { typeId: string; title: string; icon?: string; instanceId?: string }): Promise<void>;
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

// ─── Constants ───────────────────────────────────────────────────────────────

const EDITOR_TYPE_ID = 'parallx.theme-editor';

// ─── Activation ──────────────────────────────────────────────────────────────

export function activate(api: ParallxApi, context: ToolContext): void {
  const themeService = api.services.get<import('../../services/serviceTypes.js').IThemeService>(IThemeService);
  const globalStorage = api.services.get<IStorage>(IGlobalStorageService);

  // Register theme editor as an editor provider (opens in tab)
  context.subscriptions.push(
    api.editors.registerEditorProvider(EDITOR_TYPE_ID, {
      createEditorPane(container: HTMLElement): IDisposable {
        return new ThemeEditorPanel(container, themeService, globalStorage);
      },
    }),
  );

  // Register the "Open Theme Editor" command
  context.subscriptions.push(
    api.commands.registerCommand('theme-editor.open', () => {
      api.editors.openEditor({
        typeId: EDITOR_TYPE_ID,
        title: 'Theme Editor',
        icon: 'palette',
      }).catch(err => console.error('[ThemeEditor] Failed to open:', err));
    }),
  );
}

export function deactivate(): void {
  // Editor lifecycle managed by the editor group — nothing to clean up
}
