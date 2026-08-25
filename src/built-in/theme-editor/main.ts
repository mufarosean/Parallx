// main.ts — Theme Editor built-in tool activation
//
// Opens the Theme Editor as an editor tab using the standard editor provider API.
// Provides live theme customization with hover-preview, save/load/import/export.

import type { ToolContext } from '../../tools/toolModuleLoader.js';
import type { IDisposable } from '../../platform/lifecycle.js';
import type { IStorage } from '../../platform/storage.js';
import { IThemeService, IGlobalStorageService } from '../../services/serviceTypes.js';
import { settingsPanelRegistry } from '../../services/settingsPanelRegistry.js';
import { PxAppearancePanel } from './pxAppearancePanel.js';

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


// ─── Activation ──────────────────────────────────────────────────────────────

export function activate(api: ParallxApi, context: ToolContext): void {
  const themeService = api.services.get<import('../../services/serviceTypes.js').IThemeService>(IThemeService);
  const globalStorage = api.services.get<IStorage>(IGlobalStorageService);

  // ONE appearance surface (STANDARDIZATION.md P1): the Settings hub's
  // Appearance panel. The separate editor-tab surface is retired — same
  // panel class, second door. The historical command id routes to the hub.
  context.subscriptions.push(
    api.commands.registerCommand('theme-editor.open', () => {
      api.commands.executeCommand('settings.openAppearance');
    }),
  );

  // Contribute Appearance as a panel inside the unified Settings hub, so
  // "themes are accessed through Settings" per the app-wide settings model.
  context.subscriptions.push(
    settingsPanelRegistry.register({
      id: 'appearance',
      label: 'Appearance',
      order: 10,
      description: 'Base palette, accent color, and your saved themes.',
      render: (container) => new PxAppearancePanel(container, themeService, globalStorage),
    }),
  );
}

export function deactivate(): void {
  // Editor lifecycle managed by the editor group — nothing to clean up
}
