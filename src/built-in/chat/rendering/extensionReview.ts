// extensionReview.ts — the assistant writes an extension; the person decides.
//
// `extension_propose` is the assistant's tool for "build me a tool for
// this". It hands over a manifest and files; the draft is checked against
// the extension rules (tools/extensionDraft.ts). A failed check goes back
// to the assistant to fix. A draft that passes opens a review tab: what it
// adds, what it can reach (read from its code), the checks, its code on
// request, and Install, which is the only way it is ever written. An
// installed extension is turned on at once (no restart) and is turned off
// or removed in Tools like any other; its saved data stays.

import type { IDisposable } from '../../../platform/lifecycle.js';
import { ILanguageModelToolsService, type IChatTool, type IToolResult, type ILanguageModelToolsService as ToolsService } from '../../../services/chatTypes.js';
import { apiSurfaceOf, draftFailures, EXTENSION_ONLY_API, readExtensionDraft, type DraftReading, type ExtensionDraft } from '../../../tools/extensionDraft.js';
import { htmlFragment } from '../../../ui/answerForms.js';
import { escapeHtml } from '../../../ui/format.js';
import { getIcon } from '../../../ui/iconRegistry.js';
import { createButton } from '../../../ui/kit.js';
import './extensionReview.css';

export const EXTENSION_REVIEW_EDITOR = 'chat.extensionReview';
export const EXTENSION_DRAFT_COMMAND = 'chat.extensionDraft';

export interface ExtensionReviewApi {
  readonly commands: {
    registerCommand(id: string, handler: (...args: unknown[]) => unknown): IDisposable;
  };
  readonly editors: {
    registerEditorProvider(typeId: string, provider: { createEditorPane(container: HTMLElement, input?: { readonly instanceId?: string }): IDisposable }): IDisposable;
    openEditor(options: { typeId: string; title: string; icon?: string; instanceId?: string }): Promise<void>;
  };
  readonly tools?: {
    getById(id: string): unknown;
    installFromDraft(draft: ExtensionDraft): Promise<{ toolId: string } | { error: string }>;
    setEnabled(id: string, enabled: boolean): Promise<void>;
  };
  readonly services: { has(id: { readonly id: string }): boolean; get<T>(id: { readonly id: string }): T };
}

type Outcome = { kind: 'installed' | 'declined' | 'error'; text: string };
interface Draft { readonly draft: ExtensionDraft; readonly reading: DraftReading; showCode: boolean; busy: boolean; outcome?: Outcome }

const _drafts = new Map<string, Draft>();
const _panes = new Map<string, () => void>();
let _next = 0;

function reviewHtml(d: Draft): string {
  const r = d.reading;
  const rows = (items: readonly string[]): string => items.join('');
  const adds = r.adds.length
    ? rows(r.adds.map((a) => `<li class="px-xr__row"><span class="px-xr__kind">${escapeHtml(a.kind)}</span><span>${escapeHtml(a.what)}</span></li>`))
    : '<li class="px-xr__row"><span class="px-xr__kind">Nothing yet</span><span>It registers nothing the app can show</span></li>';
  const reach = rows(r.reach.map((x) => `<li class="px-xr__row"><span class="px-xr__mark ${x.allowed ? 'is-yes' : 'is-no'}" aria-hidden="true">${getIcon(x.allowed ? 'check' : 'x')}</span>`
    + `<span>${escapeHtml(x.what)}<span class="px-af-sr">${x.allowed ? ': yes' : ': no'}</span></span></li>`));
  const code = d.showCode
    ? `<div class="px-xr__code">${Object.entries({ 'parallx-manifest.json': JSON.stringify(d.draft.manifest, null, 2), ...d.draft.files })
      .map(([name, text]) => `<p class="px-xr__file">${escapeHtml(name)}</p><pre tabindex="0" aria-label="${escapeHtml(name)}"><code>${escapeHtml(text)}</code></pre>`).join('')}</div>`
    : '';
  const outcome = d.outcome ? `<p class="px-xr__outcome is-${d.outcome.kind}">${escapeHtml(d.outcome.text)}</p>` : '';
  return '<div class="px-xr"><div class="px-xr__card">'
    + `<div class="px-xr__head"><span class="px-xr__badge" aria-hidden="true">${getIcon('puzzle')}</span><div>`
    + `<h1 class="px-xr__name">${escapeHtml(r.name)}</h1><p class="px-xr__sub">A new extension, written for you by the AI${r.description ? `. ${escapeHtml(r.description)}` : ''}</p></div></div>`
    + `<h2 class="px-xr__label">What it adds</h2><ul class="px-xr__list">${adds}</ul>`
    + `<h2 class="px-xr__label">What it can reach</h2><ul class="px-xr__list">${reach}</ul>`
    + '<p class="px-xr__note">Read from its code: the checks refuse network calls, the app\'s own bridge and other tools\' commands. Like every extension, it runs inside the app.</p>'
    + `<p class="px-xr__checks"><span aria-hidden="true">${getIcon('check')}</span>Checked against the extension rules: ${r.passed} of ${r.checks.length} passed</p>`
    + `<div class="px-xr__actions" aria-live="polite">${outcome}</div>`
    + `</div>${code}</div>`;
}

function paint(host: HTMLElement, id: string): void {
  const d = _drafts.get(id);
  if (!d) { host.replaceChildren(htmlFragment('<p class="px-xr__gone">This draft is gone. Ask the assistant to propose it again.</p>')); return; }
  host.replaceChildren(htmlFragment(reviewHtml(d)));
  const actions = host.querySelector<HTMLElement>('.px-xr__actions');
  if (!actions || d.outcome?.kind === 'installed' || d.outcome?.kind === 'declined') return;
  const button = (label: string, action: string, kind: 'primary' | 'secondary' | 'ghost') =>
    createButton(actions, { id: null, label, kind, disabled: d.busy, command: EXTENSION_DRAFT_COMMAND, args: [id, action] });
  button('Not Now', 'decline', 'ghost');
  button(d.showCode ? 'Hide Code' : 'View Code…', 'code', 'secondary');
  button(d.busy ? 'Installing…' : 'Install', 'install', 'primary');
}

const TOOL_DESCRIPTION = [
  'Build an extension: a tool the person can turn on and off, for a task they asked you to make a tool of. Pass its manifest and files.',
  'The app checks the draft against the extension rules; failed checks come back to you to fix (call again). A draft that passes opens a review',
  'where the person sees what it adds and what it can reach and decides whether to install it. You never install anything yourself.',
  'Read the build-extension skill first: it has the look and copy rules and a complete working example to build from.',
  'Manifest: {"manifestVersion": 1, "id": "assistant.recipe-converter" (lowercase, one dot), "name": "Recipe Converter", "version": "0.1.0",',
  '"publisher": "assistant", "description": "...", "main": "main.js", "activationEvents": ["onStartupFinished"], "engines": {"parallx": ">=0.1.0"},',
  '"contributes": {"commands": [{"id": "assistant.recipe-converter.open", "title": "Convert A Recipe…"}]}}.',
  'main.js is an ES module: export function activate(api, context) and export function deactivate(). Push every disposable into context.subscriptions.',
  'The API, in exactly these shapes (anything else is refused):',
  'api.commands.registerCommand(\'<id>\', (...args) => result);',
  'api.editors.registerEditorProvider(\'<typeId>\', { createEditorPane(container, input) { build into container; return { dispose() {} }; } }) with',
  '"contributes": {"editors": [{"typeId": "<typeId>", "displayName": "..."}]}, opened by api.editors.openEditor({ typeId: \'<typeId>\', title: \'...\', instanceId: \'main\' });',
  'api.chat.registerTool(\'<name>\', { description: \'...\', parameters: { type: \'object\', properties: {...}, required: [...] }, requiresConfirmation: false,',
  'handler: async (args) => ({ content: \'text result\' }) });',
  'api.canvas.registerBlock({ typeId: \'<id>.<name>\', label, description, icon: \'calendar\', defaultConfig: {...}, settings: { title, fields: { key: { type: \'string\', label } } },',
  'render(body, ctx) { draw from ctx.config into body; return { update(config) {}, dispose() {} }; } });',
  'api.ui.createButton(container, { id: \'<id>.add\', label: \'Add Item\', command: \'<id>.add\' }) runs a command you registered; api.ui.createInput(container, { id, label, placeholder }) returns { element, value };',
  'api.database: await api.database.open(); then run(sql, params), get(sql, params) -> { row }, all(sql, params) -> { rows }.',
  'Colour and size text with the --px tokens (var(--px-text), var(--px-accent), var(--px-text-sm)).',
  'Refused: fetch or any network, require or import, eval, timers, window.parallxElectron, other tools\' commands, raw colours, px font sizes,',
  'uppercase labels, emoji, alert/confirm/prompt, <select>, position fixed, viewport units, z-index.',
].join(' ');

export function registerExtensionReview(api: ExtensionReviewApi): IDisposable[] {
  // The API an extension gets: this one's namespaces and functions, plus what only extensions get.
  const surface = { ...apiSurfaceOf(api), ...EXTENSION_ONLY_API };
  const out: IDisposable[] = [];
  const repaint = (id: string): void => _panes.get(id)?.();

  out.push(api.editors.registerEditorProvider(EXTENSION_REVIEW_EDITOR, {
    createEditorPane(container, input) {
      const id = input?.instanceId ?? '';
      const draw = (): void => paint(container, id);
      _panes.set(id, draw);
      draw();
      return { dispose: () => { if (_panes.get(id) === draw) _panes.delete(id); container.replaceChildren(); } };
    },
  }));

  out.push(api.commands.registerCommand(EXTENSION_DRAFT_COMMAND, async (rawId: unknown, action: unknown) => {
    const id = String(rawId ?? '');
    const d = _drafts.get(id);
    if (!d || d.busy || d.outcome?.kind === 'installed') return;
    if (action === 'code') { d.showCode = !d.showCode; repaint(id); return; }
    if (action === 'decline') { d.outcome = { kind: 'declined', text: 'Not installed. Nothing was written.' }; repaint(id); return; }
    if (action !== 'install') return;
    const toolId = d.reading.id;
    if (!api.tools) { d.outcome = { kind: 'error', text: 'Extensions cannot be installed here.' }; repaint(id); return; }
    if (api.tools.getById(toolId)) {
      d.outcome = { kind: 'error', text: `An extension named ${toolId} is already installed. Remove it in Tools first, or ask for it under a new name.` };
      repaint(id);
      return;
    }
    d.busy = true; d.outcome = undefined; repaint(id);
    const result = await api.tools.installFromDraft(d.draft).catch((err: unknown) => ({ error: err instanceof Error ? err.message : String(err) }));
    if ('error' in result) d.outcome = { kind: 'error', text: `Not installed: ${result.error}` };
    else {
      await api.tools.setEnabled(result.toolId, true).catch(() => { /* installed; it can be turned on in Tools */ });
      // Started is not the same as installed: one whose activate() throws never gets there.
      let started = false;
      for (let i = 0; i < 20 && !started; i++) {
        started = (api.tools.getById(result.toolId) as { state?: string } | undefined)?.state === 'activated';
        if (!started) await new Promise((r) => setTimeout(r, 150));
      }
      d.outcome = started
        ? { kind: 'installed', text: 'Installed and turned on, no restart needed. Turn it off or remove it in Tools, like any extension; its saved data is kept for when it is turned on again.' }
        : { kind: 'error', text: 'Installed, but it did not start (its code failed when it was turned on). Ask the assistant to fix it, or remove it in Tools.' };
    }
    d.busy = false;
    repaint(id);
  }));

  const tools = api.services.has(ILanguageModelToolsService) ? api.services.get<ToolsService>(ILanguageModelToolsService) : undefined;
  const tool: IChatTool = {
    name: 'extension_propose',
    displaySummary: 'Propose an extension for review.',
    description: TOOL_DESCRIPTION,
    parameters: {
      type: 'object',
      properties: {
        manifest: { type: 'object', description: 'The parallx-manifest.json content.' },
        files: { type: 'object', description: 'File name to text: main.js, and optionally a .css, .json or .md beside it.', additionalProperties: { type: 'string' } },
      },
      required: ['manifest', 'files'],
    },
    requiresConfirmation: false,
    permissionLevel: 'always-allowed',
    category: 'app-control',
    source: 'built-in',
    handler: async (args: Record<string, unknown>): Promise<IToolResult> => {
      // Models often send an object as JSON text; take it either way.
      const asObject = (v: unknown): Record<string, unknown> => {
        if (typeof v === 'string') { try { const o = JSON.parse(v); return o && typeof o === 'object' ? o : {}; } catch { return {}; } }
        return v && typeof v === 'object' ? v as Record<string, unknown> : {};
      };
      const draft: ExtensionDraft = { manifest: asObject(args.manifest), files: asObject(args.files) as Record<string, string> };
      const reading = readExtensionDraft(draft, surface);
      if (reading.passed < reading.checks.length) {
        return { content: `The draft did not pass these checks; fix them and call extension_propose again:\n${draftFailures(reading)}` };
      }
      const id = `draft-${++_next}`;
      _drafts.set(id, { draft, reading, showCode: false, busy: false });
      await api.editors.openEditor({ typeId: EXTENSION_REVIEW_EDITOR, title: `Review: ${reading.name}`, icon: 'puzzle', instanceId: id });
      return { content: `All ${reading.checks.length} checks passed. The review of ${reading.name} is open; nothing is installed unless the person presses Install there. Tell them in a sentence what it does and how to open it once installed.` };
    },
  };
  if (tools) out.push(tools.registerTool(tool));
  return out;
}
