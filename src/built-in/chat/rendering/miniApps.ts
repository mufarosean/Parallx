// miniApps.ts — where a chat mini-app (```app, ui/answerFormApp.ts) can go.
//
// Open In Tab gives it an editor tab of its own; Pin To Dashboard makes it
// a Mini-App widget (a dashboard widget type chat contributes, placed by
// the dashboard's generic dashboard.addWidgetWith); Save To Page is the
// app page block (answerFormBlocks.ts). Wherever it goes it runs in the
// same jail. A tab outlives a restart: its app is kept in this workspace's
// chat state, the newest 40.

import type { IDisposable } from '../../../platform/lifecycle.js';
import type { WidgetTypeRegistration } from '../../../api/bridges/dashboardBridge.js';
import { htmlFragment } from '../../../ui/answerForms.js';
import { escapeHtml } from '../../../ui/format.js';
import { getIcon } from '../../../ui/iconRegistry.js';
import { LOCKED_NOTE, OPEN_MINI_APP_COMMAND, PIN_MINI_APP_COMMAND, mountMiniApp, parseMiniApp } from '../../../ui/answerFormApp.js';

export const MINI_APP_EDITOR = 'chat.miniApp';
export const MINI_APP_WIDGET = 'parallx.chat.app';
const STATE_KEY = 'chat.miniApps';
const KEEP = 40;

interface Memento { get<T>(key: string, defaultValue?: T): T | undefined; update(key: string, value: unknown): Thenable<void> | Promise<void> }
type Thenable<T> = PromiseLike<T>;

export interface MiniAppApi {
  readonly commands: {
    registerCommand(id: string, handler: (...args: unknown[]) => unknown): IDisposable;
    executeCommand<T = unknown>(id: string, ...args: unknown[]): Promise<T>;
  };
  readonly editors: {
    registerEditorProvider(typeId: string, provider: { createEditorPane(container: HTMLElement, input?: { readonly instanceId?: string }): IDisposable }): IDisposable;
    openEditor(options: { typeId: string; title: string; icon?: string; instanceId?: string }): Promise<void>;
  };
  readonly dashboard?: { registerWidgetType(registration: WidgetTypeRegistration<{ src: string }>): IDisposable };
}

/** A stable id for an app's source (FNV-1a), so opening it twice reuses one tab. */
function appId(src: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < src.length; i++) { h ^= src.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return `app-${(h >>> 0).toString(36)}`;
}

/** The app filling `host` (a tab or a widget), or a quiet note when it cannot be read. */
function fillWithApp(host: HTMLElement, src: string, missing: string): void {
  const app = parseMiniApp(src);
  host.classList.add('px-af-app-fill');
  if (!app) { host.replaceChildren(htmlFragment(`<p class="px-af-app-fill__note">${escapeHtml(missing)}</p>`)); return; }
  host.replaceChildren(htmlFragment(`<div class="px-af-app-fill__stage" title="${LOCKED_NOTE}"></div>`));
  const stage = host.querySelector<HTMLElement>('.px-af-app-fill__stage')!;
  mountMiniApp(stage, app, { fill: true });
}

export function registerMiniApps(api: MiniAppApi, state: Memento): IDisposable[] {
  const saved = (): Record<string, { title: string; src: string; at: number }> => ({ ...(state.get(STATE_KEY, {}) ?? {}) });
  const out: IDisposable[] = [];

  out.push(api.editors.registerEditorProvider(MINI_APP_EDITOR, {
    createEditorPane(container, input) {
      const entry = saved()[input?.instanceId ?? ''];
      fillWithApp(container, entry?.src ?? '', 'This app is no longer kept. Open it again from its chat.');
      return { dispose: () => container.replaceChildren() };
    },
  }));

  out.push(api.commands.registerCommand(OPEN_MINI_APP_COMMAND, async (title: unknown, src: unknown) => {
    const text = String(src ?? '');
    if (!parseMiniApp(text)) return;
    const id = appId(text);
    const all = saved();
    all[id] = { title: String(title || 'Mini-App'), src: text, at: Date.now() };
    const newest = Object.entries(all).sort((a, b) => b[1].at - a[1].at).slice(0, KEEP);
    await state.update(STATE_KEY, Object.fromEntries(newest));
    await api.editors.openEditor({ typeId: MINI_APP_EDITOR, title: all[id].title, icon: 'app-window', instanceId: id });
  }));

  out.push(api.commands.registerCommand(PIN_MINI_APP_COMMAND, (title: unknown, src: unknown) =>
    api.commands.executeCommand('dashboard.addWidgetWith', MINI_APP_WIDGET, { src: String(src ?? '') }, String(title || 'Mini-App'))));

  if (api.dashboard) {
    out.push(api.dashboard.registerWidgetType({
      typeId: MINI_APP_WIDGET,
      displayName: 'Mini-App',
      description: 'A small app from a chat answer. It runs locked down: no files, no internet.',
      icon: getIcon('app-window'),
      category: 'static',
      defaultSize: { colSpan: 6, rowSpan: 5 },
      defaultConfig: { src: '' },
      createWidget(container, ctx) {
        const paint = (src: string): void => fillWithApp(container, src, 'Pin an app here from a chat answer (Pin To Dashboard).');
        paint(String(ctx.config.src ?? ''));
        const sub = ctx.onDidChangeConfig((c) => paint(String(c.src ?? '')));
        return { dispose: () => { sub.dispose(); container.replaceChildren(); } };
      },
    }));
  }
  return out;
}
