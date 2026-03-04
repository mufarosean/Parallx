// main.ts — AI Settings built-in tool activation (M15 Task 2.9)
//
// Registers the AI Settings panel as a Parallx sidebar view.
// Uses api.services.get() to obtain IAISettingsService.

import type { ToolContext } from '../../tools/toolModuleLoader.js';
import type { IDisposable } from '../../platform/lifecycle.js';
import { IAISettingsService } from '../../services/serviceTypes.js';
import { AISettingsPanel } from '../../aiSettings/ui/aiSettingsPanel.js';

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
  window: {
    createStatusBarItem(alignment?: number, priority?: number): {
      text: string;
      tooltip: string | undefined;
      command: string | undefined;
      name: string | undefined;
      show(): void;
      hide(): void;
      dispose(): void;
    };
  };
  services: {
    get<T>(id: { readonly id: string }): T;
    has(id: { readonly id: string }): boolean;
  };
}

// ─── Module State ────────────────────────────────────────────────────────────

let _panel: AISettingsPanel | null = null;

// ─── Activation ──────────────────────────────────────────────────────────────

export function activate(api: ParallxApi, context: ToolContext): void {

  // Get the AI Settings service from DI
  const aiSettingsService = api.services.get<import('../../aiSettings/aiSettingsTypes.js').IAISettingsService>(IAISettingsService);

  // Register view provider
  context.subscriptions.push(
    api.views.registerViewProvider('view.aiSettings', {
      createView(container: HTMLElement): IDisposable {
        _panel = new AISettingsPanel(container, aiSettingsService);
        return _panel;
      },
    }),
  );

  // Register the "Open AI Settings" command
  context.subscriptions.push(
    api.commands.registerCommand('ai-settings.open', () => {
      api.commands.executeCommand('workbench.view.show', 'view.aiSettings');
    }),
  );

  // Status bar entry: ⚙ AI: {presetName}
  const statusItem = api.window.createStatusBarItem(
    1, // Right alignment
    100,
  );
  statusItem.text = `⚙ AI: ${aiSettingsService.getActiveProfile().presetName}`;
  statusItem.tooltip = 'Open AI Settings';
  statusItem.command = 'ai-settings.open';
  statusItem.name = 'AI Settings';
  statusItem.show();
  context.subscriptions.push(statusItem);

  // Update status bar when profile changes
  const changeListener = aiSettingsService.onDidChange((profile) => {
    statusItem.text = `⚙ AI: ${profile.presetName}`;
  });
  context.subscriptions.push(changeListener);
}

export function deactivate(): void {
  if (_panel) {
    _panel.dispose();
    _panel = null;
  }
}
