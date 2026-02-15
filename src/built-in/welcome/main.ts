// Welcome Tool — built-in tool for Parallx
//
// Shows a welcome page in the editor area on first launch.
// Demonstrates: editor opening API, command contribution, globalState.

import type { ToolContext } from '../../tools/toolModuleLoader.js';
import type { IDisposable } from '../../platform/lifecycle.js';
import { $ } from '../../ui/dom.js';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ParallxApi {
  editors: {
    registerEditorProvider(typeId: string, provider: { createEditorPane(container: HTMLElement): IDisposable }): IDisposable;
    openEditor(options: { typeId: string; title: string; icon?: string; instanceId?: string }): Promise<void>;
  };
  commands: {
    registerCommand(id: string, handler: (...args: unknown[]) => unknown): IDisposable;
    executeCommand(id: string, ...args: unknown[]): Promise<unknown>;
  };
  env: {
    appName: string;
    appVersion: string;
  };
}

// ─── Activation ──────────────────────────────────────────────────────────────

const EDITOR_TYPE_ID = 'parallx.welcome.editor';
const FIRST_LAUNCH_KEY = 'welcome.hasShownWelcome';

export function activate(api: ParallxApi, context: ToolContext): void {
  // Register the welcome editor provider
  const editorDisposable = api.editors.registerEditorProvider(EDITOR_TYPE_ID, {
    createEditorPane(container: HTMLElement): IDisposable {
      return renderWelcomePage(container, api);
    },
  });
  context.subscriptions.push(editorDisposable);

  // Register the "open welcome" command
  const commandDisposable = api.commands.registerCommand('welcome.openWelcome', () => {
    openWelcome(api);
  });
  context.subscriptions.push(commandDisposable);

  // Auto-open on first launch
  const hasShown = context.globalState.get<boolean>(FIRST_LAUNCH_KEY);
  if (!hasShown) {
    context.globalState.update(FIRST_LAUNCH_KEY, true);
    openWelcome(api);
  }
}

export function deactivate(): void {
  // Nothing to clean up — subscriptions handle disposal
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function openWelcome(api: ParallxApi): void {
  api.editors.openEditor({
    typeId: EDITOR_TYPE_ID,
    title: 'Welcome',
    icon: '🏠',
  }).catch((err) => {
    console.error('[Welcome] Failed to open welcome editor:', err);
  });
}

function renderWelcomePage(container: HTMLElement, api: ParallxApi): IDisposable {
  container.classList.add('welcome-container');

  const wrapper = $('div');
  wrapper.classList.add('welcome-wrapper');

  // Logo / App name
  const logo = $('div');
  logo.classList.add('welcome-logo');
  logo.innerHTML = `<svg width="96" height="96" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="6" y="8" width="16" height="16" rx="1.5" transform="skewX(-8)" fill="#a21caf" opacity="0.45"/>
    <rect x="10" y="6" width="16" height="16" rx="1.5" transform="skewX(-8)" fill="#a21caf"/>
  </svg>`;
  wrapper.appendChild(logo);

  const h1 = $('h1');
  h1.classList.add('welcome-title');
  h1.textContent = api.env.appName || 'Parallx';
  wrapper.appendChild(h1);

  const version = $('div');
  version.classList.add('welcome-version');
  version.textContent = `v${api.env.appVersion || '0.1.0'}`;
  wrapper.appendChild(version);

  // Divider
  const divider = $('hr');
  divider.classList.add('welcome-divider');
  wrapper.appendChild(divider);

  // ── Two-column layout: Start (left) | Recent (right) ──
  const columns = $('div');
  columns.classList.add('welcome-columns');

  // Left column: Getting Started
  const leftCol = $('div');
  leftCol.classList.add('welcome-col');
  columns.appendChild(leftCol);

  const startTitle = $('h2');
  startTitle.classList.add('welcome-section-title');
  startTitle.textContent = 'Start';
  leftCol.appendChild(startTitle);

  const startItems = [
    { icon: '📄', text: 'New File', command: 'workbench.action.files.newUntitledFile' },
    { icon: '📂', text: 'Open File…', command: 'workbench.action.files.openFile' },
    { icon: '📁', text: 'Open Folder…', command: 'workbench.action.files.openFolder' },
  ];

  for (const item of startItems) {
    const row = $('div');
    row.classList.add('welcome-action-row');
    const iconSpan = $('span');
    iconSpan.textContent = item.icon;
    iconSpan.classList.add('welcome-action-icon');
    const textSpan = $('span');
    textSpan.textContent = item.text;
    textSpan.classList.add('welcome-action-text');
    row.appendChild(iconSpan);
    row.appendChild(textSpan);
    row.addEventListener('click', () => {
      api.commands.executeCommand(item.command).catch(() => {});
    });
    leftCol.appendChild(row);
  }

  // Help sub-section
  const helpTitle = $('h2');
  helpTitle.classList.add('welcome-section-title', 'welcome-section-title--help');
  helpTitle.textContent = 'Help';
  leftCol.appendChild(helpTitle);

  const helpItems = [
    { icon: '⌨️', text: 'Command Palette', hint: 'Ctrl+Shift+P', command: 'workbench.action.showCommands' },
    { icon: '⚙️', text: 'Settings', hint: 'Ctrl+,', command: 'workbench.action.openSettings' },
    { icon: '🎹', text: 'Keyboard Shortcuts', hint: 'Ctrl+K Ctrl+S', command: 'workbench.action.openKeybindings' },
  ];

  for (const item of helpItems) {
    const row = $('div');
    row.classList.add('welcome-action-row');
    const iconSpan = $('span');
    iconSpan.textContent = item.icon;
    iconSpan.classList.add('welcome-action-icon');
    const textSpan = $('span');
    textSpan.textContent = item.text;
    textSpan.classList.add('welcome-action-text');
    const hintSpan = $('span');
    hintSpan.textContent = item.hint;
    hintSpan.classList.add('welcome-action-hint');
    row.appendChild(iconSpan);
    row.appendChild(textSpan);
    row.appendChild(hintSpan);
    row.addEventListener('click', () => {
      api.commands.executeCommand(item.command).catch(() => {});
    });
    leftCol.appendChild(row);
  }

  // Right column: Recent
  const rightCol = $('div');
  rightCol.classList.add('welcome-col');
  columns.appendChild(rightCol);

  const recentTitle = $('h2');
  recentTitle.classList.add('welcome-section-title');
  recentTitle.textContent = 'Recent';
  rightCol.appendChild(recentTitle);

  // Recent Workspaces
  const recentWorkspaces = _getRecentWorkspaces();
  // Recent Files
  const recentFiles = _getRecentFiles();

  if (recentWorkspaces.length === 0 && recentFiles.length === 0) {
    const emptyMsg = $('div');
    emptyMsg.classList.add('welcome-empty');
    emptyMsg.textContent = 'No recent items yet.';
    rightCol.appendChild(emptyMsg);
  }

  if (recentWorkspaces.length > 0) {
    const wsLabel = $('div');
    wsLabel.classList.add('welcome-category-label');
    wsLabel.textContent = 'Workspaces';
    rightCol.appendChild(wsLabel);

    for (const ws of recentWorkspaces.slice(0, 5)) {
      const row = _createRecentRow('📁', ws.name, ws.path || '', () => {
        api.commands.executeCommand('workbench.action.switchWorkspace', ws.id).catch(() => {});
      });
      rightCol.appendChild(row);
    }
  }

  if (recentFiles.length > 0) {
    const fileLabel = $('div');
    fileLabel.classList.add('welcome-category-label', 'welcome-category-label--files');
    fileLabel.textContent = 'Files';
    rightCol.appendChild(fileLabel);

    for (const fileUri of recentFiles.slice(0, 8)) {
      const fileName = fileUri.split('/').pop() || fileUri;
      const filePath = _uriToDisplayPath(fileUri);
      const row = _createRecentRow('📄', fileName, filePath, () => {
        api.commands.executeCommand('workbench.action.quickOpen', fileUri).catch(() => {});
      });
      rightCol.appendChild(row);
    }
  }

  wrapper.appendChild(columns);

  // Footer
  const footer = $('div');
  footer.classList.add('welcome-footer');
  footer.textContent = 'Built-in tool — validates manifest loading, activation, editor API, commands, and state.';
  wrapper.appendChild(footer);

  container.appendChild(wrapper);

  return { dispose() { wrapper.remove(); } };
}

// ─── Recent Data Readers ─────────────────────────────────────────────────────

const RECENT_WORKSPACES_STORAGE_KEY = 'parallx.recentWorkspaces';
const RECENT_FILES_STORAGE_KEY = 'parallx:quickAccess:recentFiles';

/** Read recent workspaces from localStorage. */
function _getRecentWorkspaces(): { id: string; name: string; path?: string }[] {
  try {
    const raw = localStorage.getItem(RECENT_WORKSPACES_STORAGE_KEY);
    if (!raw) return [];
    const entries = JSON.parse(raw) as { identity: { id: string; name: string; path?: string } }[];
    return entries.map(e => ({
      id: e.identity.id,
      name: e.identity.name,
      path: e.identity.path,
    }));
  } catch {
    return [];
  }
}

/** Read recent file URIs from localStorage. */
function _getRecentFiles(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_FILES_STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as string[];
  } catch {
    return [];
  }
}

/** Convert a file URI to a short display path. */
function _uriToDisplayPath(uri: string): string {
  try {
    // file:///C:/foo/bar.ts → C:\foo\bar.ts (on Windows)
    if (uri.startsWith('file:///')) {
      const path = decodeURIComponent(uri.slice(8));
      // Shorten long paths: keep first dir + …/filename
      if (path.length > 50) {
        const parts = path.replace(/\\/g, '/').split('/');
        if (parts.length > 3) {
          return parts[0] + '/…/' + parts.slice(-2).join('/');
        }
      }
      return path;
    }
    return uri;
  } catch {
    return uri;
  }
}

/** Create a clickable recent item row. */
function _createRecentRow(icon: string, label: string, detail: string, onClick: () => void): HTMLElement {
  const row = $('div');
  row.classList.add('welcome-recent-row');

  const iconSpan = $('span');
  iconSpan.textContent = icon;
  iconSpan.classList.add('welcome-recent-icon');

  const textWrap = $('div');
  textWrap.classList.add('welcome-recent-text-wrap');

  const nameEl = $('div');
  nameEl.classList.add('welcome-recent-name');
  nameEl.textContent = label;

  if (detail) {
    const detailEl = $('div');
    detailEl.classList.add('welcome-recent-detail');
    detailEl.textContent = detail;
    textWrap.appendChild(nameEl);
    textWrap.appendChild(detailEl);
  } else {
    textWrap.appendChild(nameEl);
  }

  row.appendChild(iconSpan);
  row.appendChild(textWrap);
  row.addEventListener('click', onClick);
  return row;
}
