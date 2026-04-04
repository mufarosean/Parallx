// main.ts — Theme Editor built-in tool activation (M49 Phase 4)
//
// Opens the Theme Editor as a floating modal overlay centered on screen.
// Provides live theme customization with save/load/import/export.

import type { ToolContext } from '../../tools/toolModuleLoader.js';
import type { IDisposable } from '../../platform/lifecycle.js';
import type { IStorage } from '../../platform/storage.js';
import { IThemeService, IGlobalStorageService } from '../../services/serviceTypes.js';
import { ThemeEditorPanel } from './themeEditorPanel.js';
import { Overlay } from '../../ui/overlay.js';

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

// ─── Module State ────────────────────────────────────────────────────────────

let _overlay: Overlay | null = null;
let _panel: ThemeEditorPanel | null = null;

function _closeEditor(): void {
  if (_overlay) {
    _overlay.dispose();
    _overlay = null;
  }
  if (_panel) {
    _panel.dispose();
    _panel = null;
  }
}

// ─── Activation ──────────────────────────────────────────────────────────────

export function activate(api: ParallxApi, context: ToolContext): void {
  const themeService = api.services.get<import('../../services/serviceTypes.js').IThemeService>(IThemeService);
  const globalStorage = api.services.get<IStorage>(IGlobalStorageService);

  // Register the "Open Theme Editor" command — opens as floating modal
  context.subscriptions.push(
    api.commands.registerCommand('theme-editor.open', () => {
      // If already open, just focus it
      if (_overlay?.visible) return;

      // Close any previous instance
      _closeEditor();

      _overlay = new Overlay(document.body, {
        closeOnClickOutside: true,
        closeOnEscape: true,
        contentClass: 'theme-editor-modal',
      });

      _panel = new ThemeEditorPanel(_overlay.contentElement, themeService, globalStorage, () => _closeEditor());

      _overlay.onDidClose(() => {
        _panel?.dispose();
        _panel = null;
        _overlay = null;
      });

      _overlay.show();
    }),
  );
}

export function deactivate(): void {
  _closeEditor();
}
