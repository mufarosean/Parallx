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
    background: #1e1e1e; color: #cccccc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  `;

  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'max-width: 600px; width: 100%; text-align: center;';

  // Logo / App name
  const logo = document.createElement('div');
  logo.style.cssText = 'font-size: 64px; margin-bottom: 8px; user-select: none;';
  logo.textContent = '⚡';
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

  // Getting started section
  const section = document.createElement('div');
  section.style.cssText = 'text-align: left; margin-bottom: 32px;';

  const sectionTitle = document.createElement('h2');
  sectionTitle.style.cssText = 'font-size: 16px; font-weight: 600; color: #e0e0e0; margin: 0 0 12px;';
  sectionTitle.textContent = 'Getting Started';
  section.appendChild(sectionTitle);

  const items = [
    { icon: '📂', text: 'Open a workspace to begin working on a project' },
    { icon: '⌨️', text: 'Press Ctrl+Shift+P to open the Command Palette' },
    { icon: '🔧', text: 'Tools contribute views, commands, and UI to the shell' },
    { icon: '📦', text: 'Check the Tools panel to see installed tools' },
  ];

  for (const item of items) {
    const row = document.createElement('div');
    row.style.cssText = 'display: flex; align-items: center; gap: 10px; padding: 6px 0; font-size: 14px;';
    const iconSpan = document.createElement('span');
    iconSpan.textContent = item.icon;
    iconSpan.style.fontSize = '18px';
    const textSpan = document.createElement('span');
    textSpan.textContent = item.text;
    textSpan.style.color = '#b0b0b0';
    row.appendChild(iconSpan);
    row.appendChild(textSpan);
    section.appendChild(row);
  }
  wrapper.appendChild(section);

  // Footer
  const footer = document.createElement('div');
  footer.style.cssText = 'font-size: 12px; color: #555; margin-top: 24px;';
  footer.textContent = 'Built-in tool — validates manifest loading, activation, editor API, commands, and state.';
  wrapper.appendChild(footer);

  container.appendChild(wrapper);

  return { dispose() { wrapper.remove(); } };
}
