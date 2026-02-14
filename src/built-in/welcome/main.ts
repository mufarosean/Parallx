// Welcome Tool — built-in tool for Parallx
//
// Shows a welcome page in the editor area on first launch.
// Demonstrates: editor opening API, command contribution, globalState.

import type { ToolContext } from '../../tools/toolModuleLoader.js';
import type { IDisposable } from '../../platform/lifecycle.js';

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
  container.style.cssText = `
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    height: 100%; padding: 40px; overflow-y: auto;
    background: var(--vscode-editor-background, #1e1e1e); color: var(--vscode-foreground, #cccccc); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  `;

  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'max-width: 700px; width: 100%; text-align: center;';

  // Logo / App name
  const logo = document.createElement('div');
  logo.style.cssText = 'margin-bottom: 12px; user-select: none; display: flex; justify-content: center;';
  logo.innerHTML = `<svg width="96" height="96" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="6" y="8" width="16" height="16" rx="1.5" transform="skewX(-8)" fill="#a21caf" opacity="0.45"/>
    <rect x="10" y="6" width="16" height="16" rx="1.5" transform="skewX(-8)" fill="#a21caf"/>
  </svg>`;
  wrapper.appendChild(logo);

  const h1 = document.createElement('h1');
  h1.style.cssText = 'font-size: 28px; font-weight: 300; color: #e0e0e0; margin: 0 0 4px;';
  h1.textContent = api.env.appName || 'Parallx';
  wrapper.appendChild(h1);

  const version = document.createElement('div');
  version.style.cssText = 'font-size: 13px; color: #888; margin-bottom: 32px;';
  version.textContent = `v${api.env.appVersion || '0.1.0'}`;
  wrapper.appendChild(version);

  // Divider
  const divider = document.createElement('hr');
  divider.style.cssText = 'border: none; border-top: 1px solid #333; width: 60%; margin: 0 auto 24px;';
  wrapper.appendChild(divider);

  // ── Two-column layout: Start (left) | Recent (right) ──
  const columns = document.createElement('div');
  columns.style.cssText = 'display: flex; gap: 40px; text-align: left; margin-bottom: 32px;';

  // Left column: Getting Started
  const leftCol = document.createElement('div');
  leftCol.style.cssText = 'flex: 1; min-width: 0;';
  columns.appendChild(leftCol);

  const startTitle = document.createElement('h2');
  startTitle.style.cssText = 'font-size: 16px; font-weight: 600; color: #e0e0e0; margin: 0 0 12px;';
  startTitle.textContent = 'Start';
  leftCol.appendChild(startTitle);

  const startItems = [
    { icon: '📄', text: 'New File', command: 'workbench.action.files.newUntitledFile' },
    { icon: '📂', text: 'Open File…', command: 'workbench.action.files.openFile' },
    { icon: '📁', text: 'Open Folder…', command: 'workbench.action.files.openFolder' },
  ];

  for (const item of startItems) {
    const row = document.createElement('div');
    row.style.cssText = 'display: flex; align-items: center; gap: 8px; padding: 4px 0; font-size: 13px; cursor: pointer;';
    row.addEventListener('mouseenter', () => { row.style.background = '#2a2d2e'; });
    row.addEventListener('mouseleave', () => { row.style.background = 'transparent'; });
    const iconSpan = document.createElement('span');
    iconSpan.textContent = item.icon;
    iconSpan.style.fontSize = '16px';
    const textSpan = document.createElement('span');
    textSpan.textContent = item.text;
    textSpan.style.color = '#3794ff';
    row.appendChild(iconSpan);
    row.appendChild(textSpan);
    row.addEventListener('click', () => {
      api.commands.executeCommand(item.command).catch(() => {});
    });
    leftCol.appendChild(row);
  }

  // Help sub-section
  const helpTitle = document.createElement('h2');
  helpTitle.style.cssText = 'font-size: 16px; font-weight: 600; color: #e0e0e0; margin: 20px 0 12px;';
  helpTitle.textContent = 'Help';
  leftCol.appendChild(helpTitle);

  const helpItems = [
    { icon: '⌨️', text: 'Command Palette', hint: 'Ctrl+Shift+P', command: 'workbench.action.showCommands' },
    { icon: '⚙️', text: 'Settings', hint: 'Ctrl+,', command: 'workbench.action.openSettings' },
    { icon: '🎹', text: 'Keyboard Shortcuts', hint: 'Ctrl+K Ctrl+S', command: 'workbench.action.openKeybindings' },
  ];

  for (const item of helpItems) {
    const row = document.createElement('div');
    row.style.cssText = 'display: flex; align-items: center; gap: 8px; padding: 4px 0; font-size: 13px; cursor: pointer;';
    row.addEventListener('mouseenter', () => { row.style.background = '#2a2d2e'; });
    row.addEventListener('mouseleave', () => { row.style.background = 'transparent'; });
    const iconSpan = document.createElement('span');
    iconSpan.textContent = item.icon;
    iconSpan.style.fontSize = '16px';
    const textSpan = document.createElement('span');
    textSpan.textContent = item.text;
    textSpan.style.color = '#3794ff';
    const hintSpan = document.createElement('span');
    hintSpan.textContent = item.hint;
    hintSpan.style.cssText = 'color: #888; font-size: 12px; margin-left: auto;';
    row.appendChild(iconSpan);
    row.appendChild(textSpan);
    row.appendChild(hintSpan);
    row.addEventListener('click', () => {
      api.commands.executeCommand(item.command).catch(() => {});
    });
    leftCol.appendChild(row);
  }

  // Right column: Recent
  const rightCol = document.createElement('div');
  rightCol.style.cssText = 'flex: 1; min-width: 0;';
  columns.appendChild(rightCol);

  const recentTitle = document.createElement('h2');
  recentTitle.style.cssText = 'font-size: 16px; font-weight: 600; color: #e0e0e0; margin: 0 0 12px;';
  recentTitle.textContent = 'Recent';
  rightCol.appendChild(recentTitle);

  // Recent Workspaces
  const recentWorkspaces = _getRecentWorkspaces();
  // Recent Files
  const recentFiles = _getRecentFiles();

  if (recentWorkspaces.length === 0 && recentFiles.length === 0) {
    const emptyMsg = document.createElement('div');
    emptyMsg.style.cssText = 'font-size: 13px; color: #888; padding: 4px 0;';
    emptyMsg.textContent = 'No recent items yet.';
    rightCol.appendChild(emptyMsg);
  }

  if (recentWorkspaces.length > 0) {
    const wsLabel = document.createElement('div');
    wsLabel.style.cssText = 'font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #888; margin-bottom: 6px;';
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
    const fileLabel = document.createElement('div');
    fileLabel.style.cssText = 'font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #888; margin: 12px 0 6px;';
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
  const footer = document.createElement('div');
  footer.style.cssText = 'font-size: 12px; color: #555; margin-top: 24px; text-align: center;';
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
  const row = document.createElement('div');
  row.style.cssText = 'display: flex; align-items: center; gap: 8px; padding: 3px 4px; font-size: 13px; cursor: pointer; border-radius: 3px;';
  row.addEventListener('mouseenter', () => { row.style.background = '#2a2d2e'; });
  row.addEventListener('mouseleave', () => { row.style.background = 'transparent'; });

  const iconSpan = document.createElement('span');
  iconSpan.textContent = icon;
  iconSpan.style.fontSize = '14px';
  iconSpan.style.flexShrink = '0';

  const textWrap = document.createElement('div');
  textWrap.style.cssText = 'min-width: 0; overflow: hidden;';

  const nameEl = document.createElement('div');
  nameEl.style.cssText = 'color: #3794ff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;';
  nameEl.textContent = label;

  if (detail) {
    const detailEl = document.createElement('div');
    detailEl.style.cssText = 'color: #888; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;';
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
