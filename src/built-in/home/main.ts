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

/** The Home that is open, for the commands its controls run. */
let _page: HomePage | undefined;

export function activate(api: ParallxApi, context: ToolContext): void {
  const settings = api.services.get<HomeSettingsRegistry>(ISettingsRegistryService);
  context.subscriptions.push(registerHomeSettings(settings));

  // Opening Home when it is already open reads it again.
  const open = async (): Promise<void> => {
    const was = _page;
    await api.editors.openEditor({ typeId: 'home', title: 'Home', icon: 'px-mark', instanceId: 'home' });
    if (was && was === _page) was.refresh();
  };

  context.subscriptions.push(api.editors.registerEditorProvider('home', {
    createEditorPane: (container) => {
      const page = renderHome(container, {
        context, settings,
        runCommand: (id, ...args) => api.commands.executeCommand(id, ...args),
        commands: () => api.commands.getCommands(),
      });
      _page = page;
      return { dispose: () => { if (_page === page) _page = undefined; page.dispose(); } };
    },
  }));
  const command = (id: string, run: (...args: unknown[]) => unknown): void => { context.subscriptions.push(api.commands.registerCommand(id, run)); };
  command('home.open', open);
  command('home.openItem', (sourceId, itemId) => _page?.openItem(String(sourceId), String(itemId)));
  command('home.pinItem', (sourceId, itemId) => _page?.pinItem(String(sourceId), String(itemId)));
  command('home.ask', () => _page?.ask());
  command('home.keepName', () => _page?.keepName());
  command('home.skipName', () => _page?.skipName());

  // The app opens on Home, once the last session's tabs are back, unless this workspace says not to.
  afterStartup(() => { if (opensOnHome(settings)) void open(); });
}

export function deactivate(): void {
  _page = undefined;
}
