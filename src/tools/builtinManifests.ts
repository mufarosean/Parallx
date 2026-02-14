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
      { id: 'explorer.newFile', title: 'Explorer: New File...' },
      { id: 'explorer.newFolder', title: 'Explorer: New Folder...' },
      { id: 'explorer.rename', title: 'Explorer: Rename...' },
      { id: 'explorer.delete', title: 'Explorer: Delete' },
      { id: 'explorer.refresh', title: 'Explorer: Refresh' },
      { id: 'explorer.collapse', title: 'Explorer: Collapse All' },
      { id: 'explorer.revealInExplorer', title: 'Explorer: Reveal in Explorer' },
      { id: 'explorer.toggleHiddenFiles', title: 'Explorer: Toggle Hidden Files' },
    ],
    keybindings: [
      { command: 'explorer.rename', key: 'F2', when: "focusedView == 'view.explorer'" },
      { command: 'explorer.delete', key: 'Delete', when: "focusedView == 'view.explorer'" },
    ],
    viewContainers: [
      { id: 'explorer-container', title: 'Explorer', icon: '📁', location: 'sidebar' as const },
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
      { id: 'search.findInFiles', title: 'Search: Find in Files' },
      { id: 'search.clearResults', title: 'Search: Clear Results' },
      { id: 'search.collapseAll', title: 'Search: Collapse All Results' },
      { id: 'search.expandAll', title: 'Search: Expand All Results' },
    ],
    keybindings: [
      { command: 'search.findInFiles', key: 'Ctrl+Shift+F' },
    ],
    viewContainers: [
      { id: 'search-container', title: 'Search', icon: '🔍', location: 'sidebar' as const },
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
      { id: 'editor.toggleWordWrap', title: 'View: Toggle Word Wrap' },
      { id: 'editor.changeEncoding', title: 'Change File Encoding' },
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
    commands: [{ id: 'welcome.openWelcome', title: 'Welcome: Show Welcome Page' }],
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
      { id: 'output.clear', title: 'Output: Clear Log' },
      { id: 'output.toggleTimestamps', title: 'Output: Toggle Timestamps' },
    ],
    views: [{ id: 'view.output', name: 'Output', defaultContainerId: 'panel' }],
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
    commands: [{ id: 'tools.showInstalled', title: 'Tools: Show Installed Tools' }],
    viewContainers: [
      { id: 'tools-container', title: 'Tools', icon: '🧩', location: 'sidebar' as const },
    ],
    views: [{ id: 'view.tools', name: 'Installed Tools', defaultContainerId: 'tools-container' }],
  },
};
