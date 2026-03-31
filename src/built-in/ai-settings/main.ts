// main.ts — AI Settings built-in tool activation (M15 Task 2.9)
//
// Registers the AI Settings panel as a Parallx sidebar view.
// Uses api.services.get() to obtain IAISettingsService.

import type { ToolContext } from '../../tools/toolModuleLoader.js';
import type { IDisposable } from '../../platform/lifecycle.js';
import { IAISettingsService, IUnifiedAIConfigService, INotificationService, IWorkspaceMemoryService, IMcpClientService } from '../../services/serviceTypes.js';
import { ILanguageModelsService, ILanguageModelToolsService } from '../../services/chatTypes.js';
import type { IToolPickerServices } from '../../services/chatTypes.js';
import { AISettingsPanel } from '../../aiSettings/ui/aiSettingsPanel.js';
import { getIcon } from '../../ui/iconRegistry.js';

// ─── Local API type ──────────────────────────────────────────────────────────

interface ParallxApi {
  editors: {
    openFileEditor(uri: string, options?: { pinned?: boolean }): Promise<void>;
  };
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
      iconSvg: string | undefined;
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

  // Get the Unified AI Config service for workspace override info (M20 B.2)
  const unifiedConfigService = api.services.has(IUnifiedAIConfigService)
    ? api.services.get<import('../../aiSettings/unifiedConfigTypes.js').IUnifiedAIConfigService>(IUnifiedAIConfigService)
    : undefined;

  const workspaceMemoryService = api.services.has(IWorkspaceMemoryService)
    ? api.services.get<import('../../services/serviceTypes.js').IWorkspaceMemoryService>(IWorkspaceMemoryService)
    : undefined;

  // Get the Language Models service (for Default Model dropdown in Model section)
  const languageModelsService = api.services.has(ILanguageModelsService)
    ? api.services.get<import('../../services/chatTypes.js').ILanguageModelsService>(ILanguageModelsService)
    : undefined;

  // Get the Notification service for toast messages (M20 D.2/D.3)
  const notificationService = api.services.has(INotificationService)
    ? api.services.get<import('../../api/notificationService.js').NotificationService>(INotificationService)
    : undefined;

  // Get the Language Model Tools service for tool tree in Tools section (M20 E.1)
  const languageModelToolsService = api.services.has(ILanguageModelToolsService)
    ? api.services.get<import('../../services/chatTypes.js').ILanguageModelToolsService>(ILanguageModelToolsService)
    : undefined;

  // Build IToolPickerServices adapter (same shape as chatDataService.ts)
  const toolPickerServices: IToolPickerServices | undefined = languageModelToolsService
    ? {
        getTools: () => languageModelToolsService.getTools().map((t) => ({
          name: t.name,
          description: t.description,
          enabled: languageModelToolsService.isToolEnabled(t.name),
        })),
        setToolEnabled: (name: string, enabled: boolean) =>
          languageModelToolsService.setToolEnabled(name, enabled),
        onDidChangeTools: languageModelToolsService.onDidChangeTools,
        getEnabledCount: () => languageModelToolsService.getEnabledCount(),
      }
    : undefined;

  // Get the MCP Client service for MCP section (D1)
  const mcpClientService = api.services.has(IMcpClientService)
    ? api.services.get<import('../../openclaw/mcp/mcpClientService.js').McpClientService>(IMcpClientService)
    : undefined;

  // Register view provider
  context.subscriptions.push(
    api.views.registerViewProvider('view.aiSettings', {
      createView(container: HTMLElement): IDisposable {
        _panel = new AISettingsPanel(container, aiSettingsService, languageModelsService, unifiedConfigService, toolPickerServices, mcpClientService);
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

  // Register the "Scroll to section" command (M20 E.2 — wrench icon redirect)
  context.subscriptions.push(
    api.commands.registerCommand('ai-settings.scrollToSection', (sectionId: unknown) => {
      if (_panel && typeof sectionId === 'string') {
        _panel.scrollToSection(sectionId);
      }
    }),
  );

  async function openCanonicalMemoryFile(relativePathPromise: Promise<string> | string): Promise<void> {
    if (!workspaceMemoryService) {
      notificationService?.warn('Workspace memory service is not available.');
      return;
    }

    const relativePath = await Promise.resolve(relativePathPromise);
    await api.editors.openFileEditor(relativePath, { pinned: false });
  }

  context.subscriptions.push(
    api.commands.registerCommand('memory.openDurable', async () => {
      await openCanonicalMemoryFile(workspaceMemoryService?.getDurableMemoryRelativePath() ?? '.parallx/memory/MEMORY.md');
    }),
  );

  context.subscriptions.push(
    api.commands.registerCommand('memory.openTodayLog', async () => {
      if (!workspaceMemoryService) {
        notificationService?.warn('Workspace memory service is not available.');
        return;
      }
      await openCanonicalMemoryFile(workspaceMemoryService.ensureDailyMemory());
    }),
  );

  // Status bar entry: gear icon + AI: {presetName}
  const statusItem = api.window.createStatusBarItem(
    1, // Right alignment
    100,
  );
  statusItem.iconSvg = getIcon('gear');

  // Helper: build status text + tooltip with workspace scope indicator (M20 B.2)
  function updateStatusBar(presetName: string): void {
    let text = `AI: ${presetName}`;
    let tooltip = 'Click to open AI Hub';
    if (unifiedConfigService) {
      const wsOverride = unifiedConfigService.getWorkspaceOverride();
      const overriddenKeys = unifiedConfigService.getOverriddenKeys();
      if (wsOverride && (wsOverride._presetId || overriddenKeys.length > 0)) {
        text += ' [ws]'; // workspace override indicator
        const parts: string[] = [`Active preset: ${presetName}`];
        if (wsOverride._presetId) {
          parts.push('Workspace preset pinned');
        }
        if (overriddenKeys.length > 0) {
          parts.push(`Workspace overrides: ${overriddenKeys.length} field${overriddenKeys.length > 1 ? 's' : ''}`);
        }
        parts.push('Click to open AI Hub');
        tooltip = parts.join('. ') + '.';
      }
    }
    statusItem.text = text;
    statusItem.tooltip = tooltip;
  }

  updateStatusBar(aiSettingsService.getActiveProfile().presetName);
  statusItem.command = 'ai-settings.open';
  statusItem.name = 'AI Settings';
  statusItem.show();
  context.subscriptions.push(statusItem);

  // Update status bar when profile changes
  const changeListener = aiSettingsService.onDidChange((profile) => {
    updateStatusBar(profile.presetName);
  });
  context.subscriptions.push(changeListener);

  // Also update when unified config changes (workspace overrides may change)
  if (unifiedConfigService) {
    const unifiedListener = unifiedConfigService.onDidChangeConfig(() => {
      const profile = aiSettingsService.getActiveProfile();
      updateStatusBar(profile.presetName);
    });
    context.subscriptions.push(unifiedListener);
  }

  // ── Toast Notifications (M20 D.2) ──

  if (notificationService) {
    // Track preset name for switch detection
    let _lastPresetName = aiSettingsService.getActiveProfile().presetName;

    const presetSwitchListener = aiSettingsService.onDidChange((profile) => {
      if (profile.presetName !== _lastPresetName) {
        notificationService.info(`Switched to preset: ${profile.presetName}`);
        _lastPresetName = profile.presetName;
      }
    });
    context.subscriptions.push(presetSwitchListener);

    // Workspace override toasts
    if (unifiedConfigService) {
      let _lastOverrideCount = unifiedConfigService.getOverriddenKeys().length;
      let _hadOverride = !!unifiedConfigService.getWorkspaceOverride();

      const overrideListener = unifiedConfigService.onDidChangeConfig(() => {
        const currentCount = unifiedConfigService.getOverriddenKeys().length;
        const hasOverride = !!unifiedConfigService.getWorkspaceOverride();

        if (currentCount > _lastOverrideCount && _lastOverrideCount === 0) {
          notificationService.info('Workspace override saved');
        } else if (!hasOverride && _hadOverride) {
          notificationService.info('Reset to global preset');
        } else if (currentCount === 0 && _lastOverrideCount > 0 && hasOverride) {
          notificationService.info('Reset to global preset');
        }

        _lastOverrideCount = currentCount;
        _hadOverride = hasOverride;
      });
      context.subscriptions.push(overrideListener);

      // Clone-on-write notification (M20 D.3)
      const cloneListener = unifiedConfigService.onDidCloneBuiltIn(({ originalName, cloneName }) => {
        notificationService.info(
          `Built-in preset '${originalName}' is read-only. Created editable copy: '${cloneName}'`,
        );
      });
      context.subscriptions.push(cloneListener);
    }
  }
}

export function deactivate(): void {
  if (_panel) {
    _panel.dispose();
    _panel = null;
  }
}
