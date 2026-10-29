// appConnections.ts — the person decides what an app may use.
//
// A mini-app (`parallx.call`) or an installed extension (`api.chat.invokeTool`)
// may use the person's tools: the same tools the assistant uses, so a tool
// that is turned off cannot be reached and every call goes through the one
// Policy Decision Point (caller kind 'app'). Before the first use of a tool,
// the person is asked: Allow Once, Always Allow, Don't Allow. A tool the
// policy says must always be confirmed is asked about every time. Grants are
// this workspace's, listed in Settings › App Permissions, where each can be
// revoked. An app whose code changes is a new app and is asked again.

import type { IDisposable } from '../../../platform/lifecycle.js';
import { Emitter } from '../../../platform/events.js';
import { ILanguageModelToolsService, type ILanguageModelToolsService as ToolsService, type IChatTool } from '../../../services/chatTypes.js';
import { setAppToolCaller, type AppRef, type AppToolResult } from '../../../services/appConnections.js';
import { settingsPanelRegistry } from '../../../services/settingsPanelRegistry.js';
import { setMiniAppConnector } from '../../../ui/answerFormApp.js';
import { htmlFragment } from '../../../ui/answerForms.js';
import { escapeHtml } from '../../../ui/format.js';
import { createButton } from '../../../ui/kit.js';
import { keepTabInside } from '../../../ui/dom.js';
import { enterMode } from '../../../ui/interactionMode.js';
import './appConnections.css';

export const APP_PERMISSION_ANSWER_COMMAND = 'chat.appPermissionAnswer';
export const REVOKE_APP_PERMISSION_COMMAND = 'chat.revokeAppPermission';
const STATE_KEY = 'chat.appGrants';

type Grant = 'always' | 'never';
interface AppGrants { title: string; kind: AppRef['kind']; tools: Record<string, Grant>; used: number }
type Choice = 'once' | 'always' | 'never';

interface Memento { get<T>(key: string, defaultValue?: T): T | undefined; update(key: string, value: unknown): PromiseLike<void> | Promise<void> }

export interface AppConnectionsApi {
  readonly commands: { registerCommand(id: string, handler: (...args: unknown[]) => unknown): IDisposable };
  readonly services: { has(id: { readonly id: string }): boolean; get<T>(id: { readonly id: string }): T };
}

/** The first sentence of a tool's description: what it does, for the person. */
function whatItDoes(tool: IChatTool): string {
  const text = (tool.displaySummary || tool.description || tool.name).replace(/\s+/g, ' ').trim();
  const first = /^(.+?[.!?])(\s|$)/.exec(text)?.[1] ?? text;
  return first.length > 160 ? `${first.slice(0, 159)}…` : first;
}

/** Arguments a person can read before allowing a change. */
function argSummary(args: Record<string, unknown>): string {
  const parts = Object.entries(args).slice(0, 4).map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
  const text = parts.join(', ');
  return text.length > 200 ? `${text.slice(0, 199)}…` : text;
}

export function registerAppConnections(api: AppConnectionsApi, state: Memento): IDisposable[] {
  const tools = api.services.has(ILanguageModelToolsService) ? api.services.get<ToolsService>(ILanguageModelToolsService) : undefined;
  const changed = new Emitter<void>();
  const read = (): Record<string, AppGrants> => ({ ...(state.get<Record<string, AppGrants>>(STATE_KEY, {}) ?? {}) });
  const write = async (all: Record<string, AppGrants>): Promise<void> => { await state.update(STATE_KEY, all); changed.fire(); };

  // ── The dialog ───────────────────────────────────────────────────────────
  // One question at a time; each answer is a command, so its buttons are
  // ordinary declared controls.
  const pending = new Map<string, (choice: Choice) => void>();
  let queue: Promise<unknown> = Promise.resolve();
  let seq = 0;

  const ask = (app: AppRef, tool: IChatTool, args: Record<string, unknown>, changes: boolean, everyTime: boolean, recheck: () => Grant | undefined): Promise<Choice> => {
    const run = (): Promise<Choice> => new Promise<Choice>((resolve) => {
      // Two calls can wait on one question: when its turn comes, a call answers
      // from what the person just decided instead of asking again.
      const now = recheck();
      if (now === 'never') { resolve('never'); return; }
      if (now === 'always' && !everyTime) { resolve('always'); return; }
      const id = `p${++seq}`;
      const doc = document;
      const overlay = htmlFragment(
        '<div class="parallx-modal-overlay px-app-permission"><div class="parallx-modal-box" role="alertdialog" aria-modal="true" '
        + `aria-labelledby="${id}-q" aria-describedby="${id}-d">`
        + `<div class="parallx-modal-label" id="${id}-q">Allow ${escapeHtml(app.title)} to use ${escapeHtml(tool.name)}?</div>`
        + `<div class="parallx-modal-detail" id="${id}-d">${escapeHtml(whatItDoes(tool))}`
        + (changes ? ` This changes your data${Object.keys(args).length ? `: ${escapeHtml(argSummary(args))}` : ''}.` : '')
        + (everyTime ? ' You are asked every time for this one.' : '')
        + `</div><div class="parallx-modal-buttons"></div></div></div>`,
      ).firstElementChild as HTMLElement;
      const box = overlay.querySelector<HTMLElement>('.parallx-modal-box')!;
      const row = overlay.querySelector<HTMLElement>('.parallx-modal-buttons')!;
      const no = createButton(row, { id: null, label: 'Don\'t Allow', icon: 'x', command: APP_PERMISSION_ANSWER_COMMAND, args: [id, 'never'] });
      createButton(row, { id: null, label: 'Allow Once', icon: 'check', command: APP_PERMISSION_ANSWER_COMMAND, args: [id, 'once'], kind: everyTime ? 'primary' : 'secondary' });
      if (!everyTime) createButton(row, { id: null, label: 'Always Allow', icon: 'check-check', kind: 'primary', command: APP_PERMISSION_ANSWER_COMMAND, args: [id, 'always'] });
      doc.body.appendChild(overlay);
      const trap = keepTabInside(box);
      let done = false;
      const finish = (choice: Choice): void => {
        if (done) return;
        done = true;
        pending.delete(id);
        trap.dispose();
        overlay.remove();
        mode.exit();
        resolve(choice);
      };
      pending.set(id, finish);
      // Escape, a press outside and leaving the window all mean no.
      const mode = enterMode({ id: 'app-permission', ownedRoots: () => [box], onExit: () => finish('never'), exitOnWindowBlur: false });
      no.focus();
    });
    const next = queue.then(run, run);
    queue = next.catch(() => undefined);
    return next;
  };

  // ── The gate ─────────────────────────────────────────────────────────────
  const call = async (app: AppRef, name: string, args: Record<string, unknown>): Promise<AppToolResult> => {
    const found = tools?.decideFor?.(name, args, { kind: 'app', id: `${app.kind}:${app.id}` });
    if (!found) throw new Error(`No tool named ${name} is available. It may be turned off.`);
    const { tool, decision } = found;
    if (decision.outcome === 'deny') throw new Error(`${tool.name} cannot be used by apps.`);
    const all = read();
    const entry: AppGrants = all[app.id] ?? { title: app.title, kind: app.kind, tools: {}, used: 0 };
    const grant = entry.tools[tool.name];
    if (grant === 'never') throw new Error(`You did not allow ${app.title} to use ${tool.name}.`);
    const everyTime = decision.forceApproval === true;
    if (grant !== 'always' || everyTime) {
      const choice = await ask(app, tool, args, decision.outcome === 'require-approval' || tool.requiresConfirmation, everyTime, () => read()[app.id]?.tools[tool.name]);
      if (choice === 'never') {
        entry.tools[tool.name] = 'never';
        await write({ ...read(), [app.id]: { ...entry, title: app.title } });
        throw new Error(`You did not allow ${app.title} to use ${tool.name}.`);
      }
      if (choice === 'always') entry.tools[tool.name] = 'always';
    }
    await write({ ...read(), [app.id]: { ...entry, title: app.title, used: Date.now() } });
    const result = await tool.handler(args, { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) } as never);
    const content = typeof result?.content === 'string' ? result.content : JSON.stringify(result?.content ?? '');
    if (result?.isError) throw new Error(content.slice(0, 300) || `${tool.name} failed.`);
    let data: unknown;
    try { data = JSON.parse(content); } catch { /* text, not JSON */ }
    return data === undefined ? { content } : { content, data };
  };

  setAppToolCaller(call);
  setMiniAppConnector((app, tool, args) => call({ ...app, kind: 'mini-app' }, tool, args));

  // ── Settings › App Permissions ───────────────────────────────────────────
  const panelHtml = (all: Record<string, AppGrants>): string => {
    const apps = Object.entries(all).filter(([, a]) => Object.keys(a.tools).length).sort((a, b) => b[1].used - a[1].used);
    if (!apps.length) return '<p class="px-app-perm__empty">No app has asked to use your tools yet. When a mini-app or an extension the assistant built asks, your answer is kept here.</p>';
    return apps.map(([id, a]) => `<section class="px-app-perm__app" data-app="${escapeHtml(id)}"><div class="px-app-perm__head">`
      + `<span class="px-app-perm__name">${escapeHtml(a.title)}</span><span class="px-app-perm__kind">${a.kind === 'extension' ? 'Extension' : 'Mini-app'}</span>`
      + `<span class="px-app-perm__all"></span></div><ul class="px-app-perm__tools">`
      + Object.entries(a.tools).map(([tool, g]) => `<li data-tool="${escapeHtml(tool)}"><span class="px-app-perm__tool">${escapeHtml(tool)}</span>`
        + `<span class="px-app-perm__grant">${g === 'always' ? 'Allowed' : 'Not allowed'}</span><span class="px-app-perm__revoke"></span></li>`).join('')
      + '</ul></section>').join('');
  };

  const out: IDisposable[] = [
    { dispose: () => { setAppToolCaller(null); setMiniAppConnector(null); for (const f of [...pending.values()]) f('never'); } },
    changed,
    api.commands.registerCommand(APP_PERMISSION_ANSWER_COMMAND, (id: unknown, choice: unknown) => {
      const f = pending.get(String(id));
      if (f) f(choice === 'always' ? 'always' : choice === 'once' ? 'once' : 'never');
    }),
    api.commands.registerCommand(REVOKE_APP_PERMISSION_COMMAND, async (appId: unknown, tool: unknown) => {
      const all = read();
      const a = all[String(appId)];
      if (!a) return;
      if (tool === '*') delete all[String(appId)];
      else delete a.tools[String(tool)];
      await write(all);
    }),
    settingsPanelRegistry.register({
      id: 'app-permissions',
      label: 'App Permissions',
      description: 'Which of your tools each mini-app and extension may use. Revoke to be asked again.',
      render: (container) => {
        const draw = (): void => {
          container.replaceChildren(htmlFragment(`<div class="px-app-perm">${panelHtml(read())}</div>`));
          for (const section of Array.from(container.querySelectorAll<HTMLElement>('.px-app-perm__app'))) {
            const appId = section.getAttribute('data-app') ?? '';
            const all = section.querySelector<HTMLElement>('.px-app-perm__all');
            if (all) createButton(all, { id: null, label: 'Revoke All', icon: 'shield-off', size: 'sm', kind: 'ghost', command: REVOKE_APP_PERMISSION_COMMAND, args: [appId, '*'] });
            for (const li of Array.from(section.querySelectorAll<HTMLElement>('li[data-tool]'))) {
              const slot = li.querySelector<HTMLElement>('.px-app-perm__revoke');
              if (slot) createButton(slot, { id: null, label: 'Revoke', icon: 'shield-off', size: 'sm', kind: 'ghost', command: REVOKE_APP_PERMISSION_COMMAND, args: [appId, li.getAttribute('data-tool')] });
            }
          }
        };
        draw();
        return changed.event(draw);
      },
    }),
  ];
  return out;
}
