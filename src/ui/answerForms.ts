// answerForms.ts — the forms an AI answer can take besides markdown.
//
// A fenced block whose language names a registered form (```chart,
// ```timeline, ```live...) draws as that form inside the answer, in the
// prose, instead of as code. Chat registers the core forms
// (ui/answerFormsCore.ts); a tool adds its own while it runs through
// `api.chat.registerAnswerForm`, and turned off, its forms go: the model
// is no longer told about them and their fences show as plain code.
//
// A form is a pure renderer: source text in, HTML out (every piece of
// the model's text escaped or rendered through the host's inline
// markdown). What a reader can do with it (type a number, step through a
// solution, Save To Page) is wired afterwards by `hydrateAnswerForms`,
// with controls made by the kit.
//
// Dependency rules: src/ui/ depends only on src/platform/.

import { createRegistry } from '../platform/registry.js';
import type { Event } from '../platform/events.js';
import type { IDisposable } from '../platform/lifecycle.js';
import { escapeHtml } from './format.js';
import { createButton } from './kit.js';
import './answerForms.css';

/** What the host hands a form when it draws one. */
export interface AnswerFormContext {
  /** Inline markdown (bold, italic, code, math, links) as safe HTML. */
  renderInline(md: string): string;
  /** TeX as HTML (KaTeX), where the host has it. */
  renderMath?(tex: string): string;
  /** False while the answer is still being written and this block is not closed yet. */
  readonly complete?: boolean;
}

/** What a form's wiring gets once its HTML is in the page. */
export interface AnswerFormHydration {
  readonly src: string;
  readonly info: string;
  /** Set where the source can be kept (a page block): a form that edits its own numbers reports the new source. */
  readonly onSourceChange?: (src: string) => void;
}

export interface AnswerForm {
  /** The fence language: lowercase letters, digits and dashes. */
  readonly name: string;
  /** Other fence languages that mean the same form. */
  readonly aliases?: readonly string[];
  /** What the model is told: when to use the form and its syntax (markdown). */
  readonly hint: string;
  /** Source in, HTML out; null when the source is not one (the fence then shows as code). */
  render(src: string, info: string, ctx: AnswerFormContext): string | null;
  /** Wire what a reader can do with the drawn form. */
  hydrate?(root: HTMLElement, hydration: AnswerFormHydration): void;
  /** The page block Save To Page makes (`api.canvas.registerBlock`), its config `{ src, info }`. None: no Save To Page. */
  readonly saveAs?: { readonly blockType: string; title?(src: string): string };
  /** 'core', or the tool that registered it. */
  readonly ownerToolId: string;
}

const _forms = createRegistry<AnswerForm>();
const _names = new Map<string, string>();

/** Fires when a form comes or goes. */
export const onDidChangeAnswerForms: Event<void> = _forms.onDidChange;

const NAME = /^[a-z][a-z0-9-]{0,30}$/;

export function registerAnswerForm(form: AnswerForm): IDisposable {
  if (!form || !NAME.test(form.name)) throw new Error(`[api.chat] Answer form name "${String(form?.name)}" must be lowercase letters, digits and dashes.`);
  if (typeof form.render !== 'function') throw new Error(`[api.chat] Answer form "${form.name}" needs render().`);
  if (typeof form.hint !== 'string' || !form.hint.trim()) throw new Error(`[api.chat] Answer form "${form.name}" needs a hint for the model.`);
  const keys = [form.name, ...(form.aliases ?? []).filter((a) => NAME.test(a))];
  for (const key of keys) {
    const owner = _forms.get(_names.get(key) ?? '');
    if (owner && owner.ownerToolId !== form.ownerToolId) throw new Error(`[api.chat] Answer form "${key}" is already registered by "${owner.ownerToolId}".`);
  }
  for (const key of keys) _names.set(key, form.name);
  const reg = _forms.register(form.name, form);
  return {
    dispose: () => {
      const wasThis = _forms.get(form.name) === form;
      reg.dispose();
      if (wasThis) for (const key of keys) if (_names.get(key) === form.name) _names.delete(key);
    },
  };
}

/** The form a fence language names, if one is registered. */
export function getAnswerForm(nameOrAlias: string): AnswerForm | undefined {
  const name = _names.get(String(nameOrAlias ?? '').trim().toLowerCase());
  return name ? _forms.get(name) : undefined;
}

/** Every registered form, core first, then in registration order. */
export function getAnswerForms(): readonly AnswerForm[] {
  return _forms.list();
}

/** Split a fence's info string into the form's name and its options. */
export function splitFenceInfo(info: string): { name: string; options: string } {
  const [name = '', ...rest] = String(info ?? '').trim().split(/\s+/);
  return { name: name.toLowerCase(), options: rest.join(' ') };
}

/**
 * A fenced block drawn as its form, wrapped in the host element the
 * wiring finds; null when no form has that name or the source is not
 * one (the caller shows the fence as code).
 */
export function renderAnswerForm(info: string, src: string, ctx: AnswerFormContext): string | null {
  const { name, options } = splitFenceInfo(info);
  const form = getAnswerForm(name);
  if (!form) return null;
  let body: string | null = null;
  try { body = form.render(src, options, ctx); } catch (err) { console.warn(`[answerForms] "${form.name}" could not draw:`, err); }
  if (body === null) return null;
  const save = form.saveAs && ctx.complete !== false && !body.includes('class="px-af-save"') ?'<div class="px-af-foot"><span class="px-af-save"></span></div>' : '';
  return `<div class="px-af-host" data-af-form="${escapeHtml(form.name)}" data-af-info="${escapeHtml(options)}" `
    + `data-af-src="${escapeHtml(encodeURIComponent(src))}">${body}${save}</div>`;
}

/** The Save To Page button runs this command (canvas): block type, config, page title. */
export const SAVE_TO_PAGE_COMMAND = 'canvas.newPageWithBlock';

/**
 * Wire every drawn form under `root` once: its own controls, and Save To
 * Page where `save` is on and the form has a block to save as.
 */
export function hydrateAnswerForms(root: HTMLElement, opts: { save?: boolean; onSourceChange?: (src: string) => void } = {}): void {
  for (const host of Array.from(root.querySelectorAll<HTMLElement>('.px-af-host:not([data-af-ready])'))) {
    host.setAttribute('data-af-ready', '');
    const form = getAnswerForm(host.getAttribute('data-af-form') ?? '');
    let src = '';
    try { src = decodeURIComponent(host.getAttribute('data-af-src') ?? ''); } catch { /* keep empty */ }
    const info = host.getAttribute('data-af-info') ?? '';
    try { form?.hydrate?.(host, { src, info, onSourceChange: opts.onSourceChange }); } catch (err) { console.warn('[answerForms] wiring failed:', err); }
    const slot = host.querySelector<HTMLElement>('.px-af-save');
    if (!slot) continue;
    if (!opts.save || !form?.saveAs) {
      (slot.closest('.px-af-foot') ?? slot).remove();
      continue;
    }
    const title = form.saveAs.title?.(src) ?? '';
    createButton(slot, {
      id: null,
      label: 'Save To Page',
      kind: 'ghost',
      size: 'sm',
      title: 'Save this to a new page, where it keeps working',
      command: SAVE_TO_PAGE_COMMAND,
      args: [form.saveAs.blockType, { src, info }, title],
    });
  }
}

/** HTML text as nodes, for a host that draws a form outside markdown (a page block). */
export function htmlFragment(html: string): DocumentFragment {
  return document.createRange().createContextualFragment(html);
}

/**
 * Inline markdown for a host without a markdown renderer: `code`, $math$
 * (through `renderMath` when given), **bold**, *italic*. Everything else
 * is escaped text.
 */
export function renderInlineBasic(md: string, renderMath?: (tex: string) => string): string {
  const parts: string[] = [];
  const re = /`([^`]+)`|\$([^$\n]+)\$/g;
  let last = 0;
  let m: RegExpExecArray | null;
  const emphasis = (text: string): string => escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
  while ((m = re.exec(md)) !== null) {
    parts.push(emphasis(md.slice(last, m.index)));
    if (m[1] !== undefined) parts.push(`<code>${escapeHtml(m[1])}</code>`);
    else parts.push(renderMath ? renderMath(m[2]) : escapeHtml(m[0]));
    last = m.index + m[0].length;
  }
  parts.push(emphasis(md.slice(last)));
  return parts.join('');
}
