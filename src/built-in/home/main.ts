// Home — the page the app opens on.
//
// A tab, opened from the Parallx mark in the title bar and by itself when a
// workspace opens (a setting, per workspace): the greeting, the field to ask
// in, each tool's card for today and the things last worked on (homePage.ts).
// Home knows no tool by name; a tool that is off has put nothing here.

import './home.css';
import type { IDisposable } from '../../platform/lifecycle.js';
import type { ToolContext } from '../../tools/toolModuleLoader.js';
import { ISettingsRegistryService } from '../../services/serviceTypes.js';
import { afterStartup } from '../../services/startupDone.js';
import { renderHome, type HomePage } from './homePage.js';
import { opensOnHome, registerHomeSettings, type HomeSettingsRegistry } from './homeSettings.js';

interface ParallxApi {
  editors: {
    registerEditorProvider(typeId: string, provider: { createEditorPane(container: HTMLElement): IDisposable }): IDisposable;
    openEditor(options: { typeId: string; title: string; icon?: string; instanceId?: string }): Promise<void>;
  };
  commands: {
    registerCommand(id: string, handler: (...args: unknown[]) => unknown): IDisposable;
    executeCommand(id: string, ...args: unknown[]): Promise<unknown>;
    getCommands(): Promise<string[]>;
  };
  services: { get<T>(id: { readonly id: string }): T };
}

/** Every Home that is open (a split editor can hold two), for the commands their controls run. */
const _pages = new Set<HomePage>();

/** The Home a command is for: the one the keys or the pointer are in, else the one in view, else any. */
function page(): HomePage | undefined {
  const all = [..._pages];
  return all.find((p) => p.element.contains(document.activeElement))
    ?? all.find((p) => p.element.isConnected && p.element.offsetParent !== null)
    ?? all[all.length - 1];
}

export function activate(api: ParallxApi, context: ToolContext): void {
  const settings = api.services.get<HomeSettingsRegistry>(ISettingsRegistryService);
  context.subscriptions.push(registerHomeSettings(settings));

  // Opening Home when it is already open reads it again.
  const open = async (): Promise<void> => {
    const were = new Set(_pages);
    await api.editors.openEditor({ typeId: 'home', title: 'Home', icon: 'px-mark', instanceId: 'home' });
    const now = page();
    if (now && were.has(now)) now.refresh();
  };

  context.subscriptions.push(api.editors.registerEditorProvider('home', {
    createEditorPane: (container) => {
      const made = renderHome(container, {
        context, settings,
        runCommand: (id, ...args) => api.commands.executeCommand(id, ...args),
        commands: () => api.commands.getCommands(),
      });
      _pages.add(made);
      return { dispose: () => { _pages.delete(made); made.dispose(); } };
    },
  }));
  const command = (id: string, run: (...args: unknown[]) => unknown): void => { context.subscriptions.push(api.commands.registerCommand(id, run)); };
  command('home.open', open);
  command('home.openItem', (sourceId, itemId) => page()?.openItem(String(sourceId), String(itemId)));
  command('home.pinItem', (sourceId, itemId) => page()?.pinItem(String(sourceId), String(itemId)));
  command('home.ask', () => page()?.ask());
  command('home.keepName', () => page()?.keepName());
  command('home.skipName', () => page()?.skipName());

  // The app opens on Home, once the last session's tabs are back, unless this workspace says not to.
  afterStartup(() => { if (opensOnHome(settings)) void open(); });
}

export function deactivate(): void {
  _pages.clear();
}
