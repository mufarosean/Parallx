/**
 * Built-in tool manifests — pure declarative data extracted from workbench.ts.
 *
 * Each constant describes a single built-in tool's identity, activation events,
 * and shell contributions.  The workbench pairs these with the pre-imported
 * tool modules at registration time.
 */

import type { IToolManifest } from './toolManifest.js';

// ── Explorer ─────────────────────────────────────────────────────────────

export const EXPLORER_MANIFEST: IToolManifest = {
  manifestVersion: 1,
  id: 'parallx.explorer',
  name: 'Explorer',
  version: '1.0.0',
  publisher: 'parallx',
  description: 'File Explorer — browse, create, rename, and delete files and folders.',
  main: './main.js',
  engines: { parallx: '^0.1.0' },
  activationEvents: ['onStartupFinished'],
  contributes: {
    commands: [
      // M70: newFile / newFolder / rename are DUPLICATE (existing file tools).
      // delete is EXCLUDED (destructive, irreversible from headless agent context).
      // revealInExplorer is DUPLICATE (not actionable in headless agent context).
      { id: 'explorer.newFile', title: 'Explorer: New File...' },
      { id: 'explorer.newFolder', title: 'Explorer: New Folder...' },
      { id: 'explorer.rename', title: 'Explorer: Rename...' },
      { id: 'explorer.delete', title: 'Explorer: Delete' },
      { id: 'explorer.refresh', title: 'Explorer: Refresh',
        aiInvocable: true, aiDescription: 'Refresh the file explorer view.' },
      { id: 'explorer.collapse', title: 'Explorer: Collapse All',
        aiInvocable: true, aiDescription: 'Collapse all folders in the file explorer.' },
      { id: 'explorer.revealInExplorer', title: 'Explorer: Reveal in Explorer' },
      { id: 'explorer.toggleHiddenFiles', title: 'Explorer: Toggle Hidden Files',
        aiInvocable: true, aiDescription: 'Show or hide dotfiles and hidden files in the explorer.' },
    ],
    keybindings: [
      { command: 'explorer.rename', key: 'F2', when: "focusedView == 'view.explorer'" },
      { command: 'explorer.delete', key: 'Delete', when: "focusedView == 'view.explorer'" },
    ],
    viewContainers: [
      { id: 'explorer-container', title: 'Explorer', icon: 'folder', location: 'sidebar' as const },
    ],
    views: [
      { id: 'view.openEditors', name: 'Open Editors', defaultContainerId: 'explorer-container' },
      { id: 'view.explorer', name: 'Explorer', defaultContainerId: 'explorer-container' },
    ],
  },
};

// ── Search ───────────────────────────────────────────────────────────────

export const SEARCH_MANIFEST: IToolManifest = {
  manifestVersion: 1,
  id: 'parallx.search',
  name: 'Search',
  version: '1.0.0',
  publisher: 'parallx',
  description: 'Find in Files — workspace-wide text search with results tree.',
  main: './main.js',
  engines: { parallx: '^0.1.0' },
  activationEvents: ['onStartupFinished'],
  contributes: {
    commands: [
      { id: 'search.findInFiles', title: 'Search: Find in Files',
        aiInvocable: true, aiDescription: 'Open the search view to find text across workspace files.' },
      { id: 'search.clearResults', title: 'Search: Clear Results',
        aiInvocable: true, aiDescription: 'Clear the current search results.' },
      { id: 'search.collapseAll', title: 'Search: Collapse All Results',
        aiInvocable: true, aiDescription: 'Collapse every group in the search results.' },
      { id: 'search.expandAll', title: 'Search: Expand All Results',
        aiInvocable: true, aiDescription: 'Expand every group in the search results.' },
    ],
    keybindings: [
      { command: 'search.findInFiles', key: 'Ctrl+Shift+F' },
    ],
    viewContainers: [
      { id: 'search-container', title: 'Search', icon: 'search', location: 'sidebar' as const },
    ],
    views: [
      { id: 'view.search', name: 'Search', defaultContainerId: 'search-container' },
    ],
  },
};

// ── Text Editor ──────────────────────────────────────────────────────────

export const TEXT_EDITOR_MANIFEST: IToolManifest = {
  manifestVersion: 1,
  id: 'parallx.editor.text',
  name: 'Text Editor',
  version: '1.0.0',
  publisher: 'parallx',
  description: 'Built-in text editor for files and untitled documents.',
  main: './main.js',
  engines: { parallx: '^0.1.0' },
  activationEvents: ['*'],
  contributes: {
    commands: [
      { id: 'editor.toggleWordWrap', title: 'View: Toggle Word Wrap',
        aiInvocable: true, aiDescription: 'Toggle word-wrap in the active editor.' },
      { id: 'editor.changeEncoding', title: 'Change File Encoding',
        aiInvocable: true, aiDescription: 'Open the file encoding picker for the active editor.' },
    ],
    keybindings: [
      { command: 'editor.toggleWordWrap', key: 'Alt+Z' },
    ],
  },
};

// ── Welcome ──────────────────────────────────────────────────────────────

export const WELCOME_MANIFEST: IToolManifest = {
  manifestVersion: 1,
  id: 'parallx.welcome',
  name: 'Welcome',
  version: '1.0.0',
  publisher: 'parallx',
  description: 'Welcome page — shows getting-started content and recent workspaces.',
  main: './main.js',
  engines: { parallx: '^0.1.0' },
  activationEvents: ['onStartupFinished'],
  contributes: {
    commands: [{ id: 'welcome.openWelcome', title: 'Welcome: Show Welcome Page',
      aiInvocable: true, aiDescription: 'Open the welcome page.' }],
    editors: [{ typeId: 'parallx.welcome.editor', displayName: 'Welcome' }],
  },
};

// ── Terminal ─────────────────────────────────────────────────────────────
// M86 — the terminal tool existed (src/built-in/terminal + electron bridge)
// but was never registered here, so its panel view never activated and the
// old core "Console" placeholder rendered as a permanent empty tab.

export const TERMINAL_MANIFEST: IToolManifest = {
  manifestVersion: 1,
  id: 'parallx.terminal',
  name: 'Terminal',
  version: '1.0.0',
  publisher: 'parallx',
  description: 'Integrated terminal panel — runs shell commands in the workspace.',
  main: './main.js',
  engines: { parallx: '^0.1.0' },
  activationEvents: ['onStartupFinished'],
  contributes: {
    commands: [
      { id: 'terminal.clear', title: 'Terminal: Clear',
        aiInvocable: true, aiDescription: 'Clear the active terminal.' },
      { id: 'terminal.restart', title: 'Terminal: Restart Shell',
        aiInvocable: true, aiDescription: 'Restart the active terminal session.' },
    ],
    views: [{ id: 'view.terminal', name: 'Terminal', defaultContainerId: 'panel' }],
  },
};

// ── Output ───────────────────────────────────────────────────────────────

export const OUTPUT_MANIFEST: IToolManifest = {
  manifestVersion: 1,
  id: 'parallx.output',
  name: 'Output',
  version: '1.0.0',
  publisher: 'parallx',
  description: 'Output panel — shows log messages from tools and the shell.',
  main: './main.js',
  engines: { parallx: '^0.1.0' },
  activationEvents: ['onStartupFinished'],
  contributes: {
    commands: [
      { id: 'output.clear', title: 'Output: Clear Log',
        aiInvocable: true, aiDescription: 'Clear the current output channel.' },
      { id: 'output.toggleTimestamps', title: 'Output: Toggle Timestamps',
        aiInvocable: true, aiDescription: 'Toggle timestamp display in the output panel.' },
    ],
    views: [{ id: 'view.output', name: 'Output', defaultContainerId: 'panel' }],
  },
};

// ── Indexing Log ─────────────────────────────────────────────────────────

export const INDEXING_LOG_MANIFEST: IToolManifest = {
  manifestVersion: 1,
  id: 'parallx.indexing-log',
  name: 'Indexing',
  version: '1.0.0',
  publisher: 'parallx',
  description: 'Indexing Log — real-time view of files and pages being indexed into the knowledge base.',
  main: './main.js',
  engines: { parallx: '^0.1.0' },
  activationEvents: ['onStartupFinished'],
  contributes: {
    commands: [
      { id: 'indexingLog.clear', title: 'Indexing: Clear Log',
        aiInvocable: true, aiDescription: 'Clear the indexing log entries.' },
      { id: 'indexingLog.toggleErrorFilter', title: 'Indexing: Toggle Error Filter',
        aiInvocable: true, aiDescription: 'Toggle the error-only filter in the indexing log.' },
    ],
    views: [{ id: 'view.indexingLog', name: 'Indexing', defaultContainerId: 'panel' }],
  },
};

// ── Activity Log ─────────────────────────────────────────────────────────

export const ACTIVITY_LOG_MANIFEST: IToolManifest = {
  manifestVersion: 1,
  id: 'parallx.activity-log',
  name: 'Activity',
  version: '1.0.0',
  publisher: 'parallx',
  description: 'Activity — live timeline of what happened in the app: editors, commands, pages, assistant turns.',
  main: './main.js',
  engines: { parallx: '^0.1.0' },
  activationEvents: ['onStartupFinished'],
  contributes: {
    commands: [
      { id: 'activityLog.copyRecent', title: 'Activity: Copy Timeline to Clipboard',
        aiInvocable: true, aiDescription: 'Copy the visible activity timeline to the clipboard.' },
    ],
    views: [{ id: 'view.activityLog', name: 'Activity', defaultContainerId: 'panel' }],
  },
};

// ── Diagnostics (D3) ─────────────────────────────────────────────────────

export const DIAGNOSTICS_MANIFEST: IToolManifest = {
  manifestVersion: 1,
  id: 'parallx.diagnostics',
  name: 'Diagnostics',
  version: '1.0.0',
  publisher: 'parallx',
  description: 'AI runtime diagnostics — health checks for Ollama, RAG, embeddings, and configuration.',
  main: './main.js',
  engines: { parallx: '^0.1.0' },
  activationEvents: ['onStartupFinished'],
  contributes: {
    commands: [
      { id: 'diagnostics.runChecks', title: 'Diagnostics: Run Health Checks',
        aiInvocable: true, aiDescription: 'Run the diagnostics health checks and show results.' },
    ],
    views: [{ id: 'view.diagnostics', name: 'AI Diagnostics', defaultContainerId: 'panel' }],
  },
};

// ── Autonomy Log (M58-real post-ship UX reshape) ─────────────────────────

export const AUTONOMY_LOG_MANIFEST: IToolManifest = {
  manifestVersion: 1,
  id: 'parallx.autonomy-log',
  name: 'Autonomy Log',
  version: '1.0.0',
  publisher: 'parallx',
  description: 'Dedicated view for heartbeat, cron, and subagent run results — keeps autonomous activity out of the chat transcript.',
  main: './main.js',
  engines: { parallx: '^0.1.0' },
  activationEvents: ['onStartupFinished'],
  contributes: {
    commands: [
      { id: 'autonomyLog.markAllRead', title: 'Autonomy Log: Mark All Read',
        aiInvocable: true, aiDescription: 'Mark every autonomy log entry as read.' },
      { id: 'autonomyLog.clear',       title: 'Autonomy Log: Clear',
        aiInvocable: true, aiDescription: 'Clear all autonomy log entries.' },
    ],
    views: [{ id: 'view.autonomyLog', name: 'Autonomy Log', defaultContainerId: 'panel' }],
  },
};

// ── Tool Gallery ─────────────────────────────────────────────────────────

export const TOOL_GALLERY_MANIFEST: IToolManifest = {
  manifestVersion: 1,
  id: 'parallx.tool-gallery',
  name: 'Tools',
  version: '1.0.0',
  publisher: 'parallx',
  description: 'Tool Gallery — shows all registered tools, their status, and contributions.',
  main: './main.js',
  engines: { parallx: '^0.1.0' },
  activationEvents: ['onStartupFinished'],
  contributes: {
    commands: [{ id: 'tools.showInstalled', title: 'Tools: Show Installed Tools',
      aiInvocable: true, aiDescription: 'Show the list of installed tools and extensions.' }],
    viewContainers: [
      { id: 'tools-container', title: 'Tools', icon: 'px-tools', location: 'sidebar' as const },
    ],
    views: [{ id: 'view.tools', name: 'Installed Tools', defaultContainerId: 'tools-container' }],
    editors: [{ typeId: 'tool-detail', displayName: 'Tool Details' }],
  },
};

// ── Chat ─────────────────────────────────────────────────────────────────

export const CHAT_MANIFEST: IToolManifest = {
  manifestVersion: 1,
  id: 'parallx.chat',
  name: 'Chat',
  version: '1.0.0',
  publisher: 'parallx',
  description: 'AI Chat — local language model conversations powered by Ollama.',
  main: './main.js',
  engines: { parallx: '^0.1.0' },
  activationEvents: ['onStartupFinished'],
  contributes: {
    commands: [
      // M70: chat.switchMode and chat.selectModel are EXCLUDED (AI-settings
      // mutation policy — the AI must not steer its own invocation policy).
      // chat.show is NOT in the manifest; it's registered at runtime by
      // main.ts. Annotated there via the bridge if/when needed.
      { id: 'chat.toggle', title: 'Chat: Toggle Chat Panel',
        aiInvocable: true, aiDescription: 'Show or hide the chat view.' },
      { id: 'chat.show', title: 'Chat: Show',
        aiInvocable: true, aiDescription: 'Reveal the chat view (showing it first if hidden).' },
      { id: 'chat.newSession', title: 'Chat: New Session',
        aiInvocable: true, aiDescription: 'Start a new chat session.' },
      { id: 'chat.clearSession', title: 'Chat: Clear Session',
        aiInvocable: true, aiDescription: 'Clear the current chat session messages.' },
      { id: 'chat.stop', title: 'Chat: Stop Response',
        aiInvocable: true, aiDescription: 'Stop the current AI generation.' },
      { id: 'chat.focus', title: 'Chat: Focus Input',
        aiInvocable: true, aiDescription: 'Move focus into the chat input.' },
      // M86: deliberately NOT aiInvocable — the model has plan_update
      // {clear:true}; this is the USER's escape hatch for stale plans.
      { id: 'chat.clearPlan', title: 'Chat: Clear Plan' },
    ],
    keybindings: [
      { command: 'chat.toggle', key: 'Ctrl+Shift+I' },
      { command: 'chat.focus', key: 'Ctrl+L' },
    ],
    viewContainers: [
      { id: 'chat-container', title: 'Chat', icon: 'px-chat', location: 'auxiliaryBar' as const },
    ],
    views: [
      { id: 'view.chat', name: 'Chat', defaultContainerId: 'chat-container' },
    ],
  },
};

// ── AI Settings ──────────────────────────────────────────────────────────

export const AI_SETTINGS_MANIFEST: IToolManifest = {
  manifestVersion: 1,
  id: 'parallx.ai-settings',
  name: 'AI Settings',
  version: '1.0.0',
  publisher: 'parallx',
  description: 'Configure AI personality, behavior, and model settings.',
  main: './main.js',
  engines: { parallx: '^0.1.0' },
  activationEvents: ['onStartupFinished'],
  contributes: {
    commands: [
      { id: 'ai-settings.open', title: 'Parallx: Open AI Settings' },
      { id: 'memory.openDurable', title: 'Parallx: Open Durable Memory' },
      { id: 'memory.openTodayLog', title: 'Parallx: Open Today\'s Memory Log' },
    ],
    keybindings: [
      { command: 'ai-settings.open', key: 'Ctrl+Shift+A' },
    ],
    viewContainers: [
      { id: 'ai-settings-container', title: 'AI Settings', icon: 'px-ai', location: 'auxiliaryBar' as const, hidden: true },
    ],
    views: [
      { id: 'view.aiSettings', name: 'AI Settings', defaultContainerId: 'ai-settings-container' },
    ],
  },
};

// ── Canvas ───────────────────────────────────────────────────────────────

export const CANVAS_MANIFEST: IToolManifest = {
  manifestVersion: 1,
  id: 'parallx.canvas',
  name: 'Canvas',
  version: '0.1.0',
  publisher: 'parallx',
  description: 'Canvas — create and organise pages with rich-text content.',
  main: './main.js',
  engines: { parallx: '^0.1.0' },
  activationEvents: ['onStartupFinished'],
  contributes: {
    commands: [
      // M70 audit decisions:
      // - canvas.newPage: DUPLICATE (covered by `canvas_create_page` AI tool).
      // - canvas.deletePage: EXCLUDED (destructive, irreversible).
      // - canvas.rename/duplicate: OUT_OF_MVP (need pageId arg).
      // showKeyboardShortcuts / showTemplatePicker registered at runtime in
      // main.ts; declared here so manifest pipeline picks up aiInvocable.
      { id: 'canvas.newPage', title: 'Canvas: New Page' },
      { id: 'canvas.newDatabase', title: 'Canvas: New Database' },
      { id: 'canvas.deletePage', title: 'Canvas: Delete Page' },
      { id: 'canvas.renamePage', title: 'Canvas: Rename Page' },
      { id: 'canvas.duplicatePage', title: 'Canvas: Duplicate Page' },
      { id: 'canvas.showKeyboardShortcuts', title: 'Canvas: Show Keyboard Shortcuts',
        aiInvocable: true, aiDescription: 'Show the canvas keyboard shortcuts overlay.' },
      { id: 'canvas.showTemplatePicker', title: 'Canvas: Show Template Picker',
        aiInvocable: true, aiDescription: 'Open the canvas template picker.' },
      { id: 'canvas.manageTemplates', title: 'Canvas: Manage Templates',
        aiInvocable: true, aiDescription: 'Open the user-template manager (list, delete custom canvas templates).' },
      { id: 'canvas.saveAsTemplate', title: 'Canvas: Save Page As Template',
        aiInvocable: true, aiDescription: 'Save the given canvas page as a reusable custom template. Argument: pageId (string, required).' },
    ],
    keybindings: [
      { command: 'canvas.newPage', key: 'Ctrl+N', when: "focusedView == 'view.canvas'" },
    ],
    viewContainers: [
      { id: 'canvas-container', title: 'Canvas', icon: 'px-canvas', location: 'sidebar' as const },
    ],
    views: [
      { id: 'view.canvas', name: 'Pages', defaultContainerId: 'canvas-container' },
    ],
    editors: [{ typeId: 'canvas', displayName: 'Canvas Page' }],
  },
};

// ── Theme Editor ─────────────────────────────────────────────────────────

export const THEME_EDITOR_MANIFEST: IToolManifest = {
  manifestVersion: 1,
  id: 'parallx.theme-editor',
  name: 'Appearance',
  version: '1.0.0',
  publisher: 'parallx',
  description: 'Choose a base palette and accent. Live preview, applied everywhere.',
  main: './main.js',
  engines: { parallx: '^0.1.0' },
  activationEvents: ['onStartupFinished'],
  contributes: {
    commands: [
      { id: 'theme-editor.open', title: 'Parallx: Appearance',
        aiInvocable: true, aiDescription: 'Open the Appearance settings to change the base palette and accent.' },
    ],
    keybindings: [
      { command: 'theme-editor.open', key: 'Ctrl+Shift+T' },
    ],
    editors: [{ typeId: 'parallx.theme-editor', displayName: 'Appearance' }],
  },
};

// ── Planner (M82) ────────────────────────────────────────────────────────

export const PLANNER_MANIFEST: IToolManifest = {
  manifestVersion: 1,
  id: 'parallx.planner',
  name: 'Planner',
  version: '0.1.0',
  publisher: 'parallx',
  description: 'Calendar + tasks. Capture-fast / plan-later workflow with AI-aware scheduling.',
  main: './main.js',
  engines: { parallx: '^0.1.0' },
  activationEvents: ['onStartupFinished'],
  contributes: {
    commands: [
      { id: 'planner.open', title: 'Planner: Open',
        aiInvocable: true, aiDescription: 'Open the Planner editor.' },
      { id: 'planner.newTask', title: 'Planner: New Task…',
        aiInvocable: true, aiDescription: 'Create a new task via an input prompt.' },
      { id: 'planner.newEvent', title: 'Planner: New Event…',
        aiInvocable: true, aiDescription: 'Create a new calendar event via an input prompt.' },
    ],
    keybindings: [
      // NOTE: Ctrl+Shift+P is reserved for the Command Palette
      // (workbench.action.showCommands) and must never be reassigned.
      { command: 'planner.open', key: 'Ctrl+Shift+K' },
    ],
    viewContainers: [
      { id: 'planner-container', title: 'Planner', icon: 'px-planner', location: 'sidebar' as const },
    ],
    views: [
      { id: 'view.planner', name: 'Tasks', defaultContainerId: 'planner-container' },
    ],
    editors: [{ typeId: 'planner', displayName: 'Planner' }],
  },
};

// ── Worksheets (M99) ─────────────────────────────────────────────────────

export const WORKSHEET_MANIFEST: IToolManifest = {
  manifestVersion: 1,
  id: 'parallx.worksheet',
  name: 'Worksheets',
  version: '0.1.0',
  publisher: 'parallx',
  description: 'Practice sheets — bounded spreadsheet items with givens and solutions, faithful to a target exam tool\'s constraints.',
  main: './main.js',
  engines: { parallx: '^0.1.0' },
  activationEvents: ['onStartupFinished'],
  contributes: {
    commands: [
      { id: 'worksheet.open', title: 'Worksheets: Open Practice Items',
        aiInvocable: true, aiDescription: 'Open the practice items browser.' },
      { id: 'worksheet.openScratch', title: 'Worksheets: Open Scratch Sheet',
        aiInvocable: true, aiDescription: 'Open a blank exam-faithful practice sheet.' },
      { id: 'worksheet.generate', title: 'Worksheets: Generate Items',
        aiInvocable: true, aiDescription: 'Generate practice items from study material.' },
      { id: 'worksheet.importExcel', title: 'Worksheets: Import from Excel',
        aiInvocable: true, aiDescription: 'Import existing Excel practice workbooks (Item/Answer pairs or question-and-solution sheets) as practice items.' },
      { id: 'worksheet.practice', title: 'Worksheets: Start Practice Session',
        aiInvocable: true, aiDescription: 'Open the practice-session builder: filter the item bank by topic and history, pick a length, shuffle, and work the items as a quiz.' },
    ],
    viewContainers: [
      { id: 'worksheet-container', title: 'Worksheets', icon: 'file-spreadsheet', location: 'sidebar' as const },
    ],
    views: [
      { id: 'view.worksheet', name: 'Practice Items', defaultContainerId: 'worksheet-container' },
    ],
    editors: [{ typeId: 'worksheet', displayName: 'Practice Sheet' }],
    configuration: [
      {
        title: 'Worksheets',
        properties: {
          'worksheet.sheetAppearance': {
            type: 'string',
            enum: ['light', 'dark', 'app'],
            default: 'light',
            description: 'Theme for the practice-sheet surface, independent of the app theme. "light" matches the real exam tool (always-white sheet), "dark" pins the sheet dark, "app" follows the workbench light/dark mode. The Sheet Theme button on any open sheet flips between light and dark.',
          },
        },
      },
    ],
  },
};

// ── Dashboard (M71) ──────────────────────────────────────────────────────

export const DASHBOARD_MANIFEST: IToolManifest = {
  manifestVersion: 1,
  id: 'parallx.dashboard',
  name: 'Dashboard',
  version: '0.1.0',
  publisher: 'parallx',
  description: 'Dashboard — a configurable launchpad for the workspace. Widgets contributed by tools; refresh on cron, interval, or manual.',
  main: './main.js',
  engines: { parallx: '^0.1.0' },
  activationEvents: ['onStartupFinished'],
  contributes: {
    commands: [
      { id: 'dashboard.open', title: 'Dashboard: Open',
        aiInvocable: true, aiDescription: 'Open the workspace dashboard.' },
      { id: 'dashboard.newPage', title: 'Dashboard: New Page',
        aiInvocable: true, aiDescription: 'Create a new dashboard page.' },
      { id: 'dashboard.addWidget', title: 'Dashboard: Add Widget…',
        aiInvocable: true, aiDescription: 'Open the widget picker on the active dashboard page.' },
      { id: 'dashboard.refreshAll', title: 'Dashboard: Refresh All Widgets',
        aiInvocable: true, aiDescription: 'Manually refresh every widget on the active dashboard page.' },
    ],
    keybindings: [
      { command: 'dashboard.open', key: 'Ctrl+Shift+H' },
    ],
    viewContainers: [
      { id: 'dashboard-container', title: 'Dashboard', icon: 'px-dashboard', location: 'sidebar' as const },
    ],
    views: [
      { id: 'view.dashboard', name: 'Dashboards', defaultContainerId: 'dashboard-container' },
    ],
    editors: [{ typeId: 'dashboard', displayName: 'Dashboard' }],
    configuration: [
      {
        title: 'Dashboard',
        properties: {
          'dashboard.aiRefreshConcurrency': {
            type: 'number',
            default: 2,
            description: 'How many AI widget refreshes may run as background agents at the same time (1-8). Applies to scheduled refreshes and "Refresh all"; extra refreshes queue.',
          },
        },
      },
    ],
  },
};

// ── Settings (M60 Phase ε §7 T4.D2) ──────────────────────────────────────

export const SETTINGS_MANIFEST: IToolManifest = {
  manifestVersion: 1,
  id: 'parallx.settings',
  name: 'Settings',
  version: '1.0.0',
  publisher: 'parallx',
  description: 'Unified, schema-driven settings editor (M60 §7).',
  main: './main.js',
  engines: { parallx: '^0.1.0' },
  activationEvents: ['onStartupFinished'],
  contributes: {
    commands: [
      { id: 'settings.open', title: 'Parallx: Open Settings',
        aiInvocable: true, aiDescription: 'Open the workspace settings editor.' },
      // workspace.importConfig and workspace.resetConfig are EXCLUDED by the
      // M70 denylist (config mutation / destructive). Only the read-only
      // export path is opt-in.
      { id: 'workspace.exportConfig', title: 'Workspace: Export Configuration',
        aiInvocable: true, aiDescription: 'Export the workspace configuration to a file for backup (user picks the destination via a save-file dialog).' },
      { id: 'workspace.importConfig', title: 'Workspace: Import Configuration' },
      { id: 'workspace.resetConfig', title: 'Workspace: Reset Configuration' },
    ],
    keybindings: [
      { command: 'settings.open', key: 'Ctrl+Alt+S' },
    ],
  },
};
