// main.ts — AI Settings built-in tool activation (M15 Task 2.9)
//
// Registers the AI Settings panel as a Parallx sidebar view.
// Uses api.services.get() to obtain IAISettingsService.

import type { ToolContext } from '../../tools/toolModuleLoader.js';
import type { IDisposable } from '../../platform/lifecycle.js';
import { IAISettingsService, IUnifiedAIConfigService, INotificationService, IWorkspaceMemoryService, IMcpClientService, IAutonomyFeatureFlagsService, IGlobalStorageService } from '../../services/serviceTypes.js';
import { ILanguageModelsService, ILanguageModelToolsService } from '../../services/chatTypes.js';
import type { IToolPickerServices } from '../../services/chatTypes.js';
import { AISettingsPanel } from '../../aiSettings/ui/aiSettingsPanel.js';

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

  // Get the Autonomy Feature Flags service so the Heartbeat section's
  // "Enable" toggle drives the single source of truth for the runtime gate
  // (M60 §3.8) instead of exposing two parallel switches.
  const autonomyFlagsService = api.services.has(IAutonomyFeatureFlagsService)
    ? api.services.get<import('../../services/autonomyFeatureFlags.js').IAutonomyFeatureFlagsService>(IAutonomyFeatureFlagsService)
    : undefined;

  // Global storage — needed by the Web Research section to read/write
  // webResearch.* keys (Brave API key, daily budget, ambient toggle).
  const globalStorage = api.services.has(IGlobalStorageService)
    ? api.services.get<import('../../platform/storage.js').IStorage>(IGlobalStorageService)
    : undefined;

  // Register view provider
  context.subscriptions.push(
    api.views.registerViewProvider('view.aiSettings', {
      createView(container: HTMLElement): IDisposable {
        _panel = new AISettingsPanel(container, aiSettingsService, languageModelsService, unifiedConfigService, toolPickerServices, mcpClientService, autonomyFlagsService, globalStorage);
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

  // ── M61 Phase 5 manager commands ──
  // Action rows in the unified settings overlay use these to launch the
  // existing section-scoped managers. Each opens the AI Settings sidebar
  // and scrolls to the right section.
  const _openSection = async (sectionId: string): Promise<void> => {
    await api.commands.executeCommand('workbench.view.show', 'view.aiSettings');
    // Wait one tick so the panel has time to mount before we scroll.
    setTimeout(() => api.commands.executeCommand('ai-settings.scrollToSection', sectionId), 0);
  };
  context.subscriptions.push(
    api.commands.registerCommand('aiSettings.manageTools', () => _openSection('tools')),
    api.commands.registerCommand('aiSettings.manageMcp', () => _openSection('mcp')),
    api.commands.registerCommand('aiSettings.manageAgents', () => _openSection('agent')),
    api.commands.registerCommand('aiSettings.manageCron', () => _openSection('cron')),
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
