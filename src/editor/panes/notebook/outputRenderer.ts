// outputRenderer.ts — notebook cell outputs → DOM (M96)
//
// A kernel answers with a MIME bundle and expects the front end to pick the
// richest representation it can display. That negotiation is the whole job
// here, plus one hard rule: **nothing from the kernel is ever inserted as
// markup.**
//
// That rule costs a feature. `text/html` is how pandas renders a DataFrame,
// and dropping it in favour of `text/plain` makes tables noticeably worse. But
// a notebook is a file that gets shared, and executing one is already a
// deliberate act; rendering arbitrary HTML from it into the app's own document
// would additionally hand any notebook you merely OPEN a script-execution
// surface inside the renderer process. So HTML is sanitised down to a safe
// subset — tables, spans, basic formatting — with every script, event handler,
// style attribute, and external reference removed. Tables survive; injection
// does not.

import { ansiToHtml, stripAnsi } from '../../../ui/ansiToHtml.js';
import { mimeText, type MimeBundle, type NotebookOutput } from './notebookModel.js';

// ─── MIME preference ─────────────────────────────────────────────────────────

/**
 * Richest first. `image/svg+xml` sits below raster images deliberately: SVG is
 * an active document format (it can carry script and external refs), and the
 * sanitiser required to make it safe is a different, larger problem than the
 * HTML one. A plot that offers both gets the PNG.
 */
/** Cap on text rendered into a single `<pre>`, independent of the pane's cap. */
const MAX_TEXT_RENDER_CHARS = 500_000;

const MIME_PREFERENCE: readonly string[] = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'text/html',
  'text/markdown',
  'application/json',
  'text/plain',
];

function pickMime(data: MimeBundle): string | undefined {
  // `data` comes from a file on disk. notebookModel casts it without checking
  // the shape (nbformat says it is an object; a hand-edited or corrupt file
  // says whatever it likes), and `'x' in null` throws a TypeError that would
  // escape through _renderOutputs and take the whole pane down on open —
  // turning a malformed output into an unopenable notebook.
  if (!data || typeof data !== 'object' || Array.isArray(data)) return undefined;
  for (const mime of MIME_PREFERENCE) {
    if (mime in data) return mime;
  }
  return Object.keys(data)[0];
}

// ─── HTML sanitiser ──────────────────────────────────────────────────────────

/** Elements worth keeping. Everything structural, nothing active. */
const ALLOWED_TAGS = new Set([
  'A', 'B', 'BR', 'CAPTION', 'CODE', 'COL', 'COLGROUP', 'DD', 'DIV', 'DL', 'DT',
  'EM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HR', 'I', 'LI', 'OL', 'P', 'PRE',
  'S', 'SMALL', 'SPAN', 'STRONG', 'SUB', 'SUP', 'TABLE', 'TBODY', 'TD', 'TFOOT',
  'TH', 'THEAD', 'TR', 'U', 'UL',
]);

/**
 * Attributes worth keeping. Note the absences: no `style` (CSS can exfiltrate
 * via `background:url()` and can cover the workbench), no `class` (it would
 * reach into the app's own stylesheet), no `id` (collides with the document),
 * and nothing beginning `on`.
 */
const ALLOWED_ATTRS = new Set(['colspan', 'rowspan', 'align', 'valign', 'scope', 'title', 'href']);

/**
 * Sanitise kernel-produced HTML into a fragment safe to attach.
 *
 * Parsed in an inert document (`DOMParser`), so nothing runs during parsing —
 * building a live element and assigning innerHTML would already have fetched
 * remote resources before the first node was inspected.
 */
export function sanitiseHtml(html: string): DocumentFragment {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const fragment = document.createDocumentFragment();

  const clean = (node: Node): Node | null => {
    if (node.nodeType === Node.TEXT_NODE) {
      return document.createTextNode(node.nodeValue ?? '');
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return null;

    const element = node as Element;
    if (!ALLOWED_TAGS.has(element.tagName)) {
      // Unwrap rather than drop: a <font> or <center> wrapper is noise, but
      // the table inside it is the content the user wants.
      const wrapper = document.createDocumentFragment();
      for (const child of Array.from(element.childNodes)) {
        const cleaned = clean(child);
        if (cleaned) wrapper.appendChild(cleaned);
      }
      return wrapper;
    }

    const copy = document.createElement(element.tagName.toLowerCase());
    for (const attr of Array.from(element.attributes)) {
      const name = attr.name.toLowerCase();
      if (!ALLOWED_ATTRS.has(name)) continue;
      if (name === 'href') {
        // Only external, non-active schemes. `javascript:` and `data:` are the
        // two that turn a link into code.
        const value = attr.value.trim();
        if (!/^https?:\/\//i.test(value)) continue;
        copy.setAttribute('href', value);
        copy.setAttribute('target', '_blank');
        copy.setAttribute('rel', 'noopener noreferrer');
        continue;
      }
      copy.setAttribute(name, attr.value);
    }
    for (const child of Array.from(element.childNodes)) {
      const cleaned = clean(child);
      if (cleaned) copy.appendChild(cleaned);
    }
    return copy;
  };

  for (const child of Array.from(parsed.body.childNodes)) {
    const cleaned = clean(child);
    if (cleaned) fragment.appendChild(cleaned);
  }
  return fragment;
}

// ─── Element builders ────────────────────────────────────────────────────────

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

/** Streams and plain text: monospace, ANSI-coloured, never markup. */
function renderText(text: string, className: string): HTMLElement {
  const pre = el('pre', className);
  // A defence-in-depth cap independent of the pane's own limit: this function
  // renders whatever it is handed, including text loaded straight from a
  // `.ipynb` that some other tool wrote without any cap at all. Keep the tail
  // — for a failed run the end is the part that matters.
  const bounded = text.length > MAX_TEXT_RENDER_CHARS
    ? `[… ${(text.length - MAX_TEXT_RENDER_CHARS).toLocaleString()} earlier characters not shown …]\n`
      + text.slice(-MAX_TEXT_RENDER_CHARS)
    : text;
  // ansiToHtml escapes everything it does not itself emit.
  pre.innerHTML = ansiToHtml(bounded);
  return pre;
}

function renderImage(mime: string, payload: string): HTMLElement {
  const wrap = el('div', 'nb-output__image');
  const img = el('img');
  // Base64 from the kernel. A data: URL for a raster type cannot execute; the
  // MIME is fixed from our own preference list, never taken from the notebook.
  img.src = `data:${mime};base64,${payload.replace(/\s+/g, '')}`;
  img.alt = 'Cell output image';
  img.loading = 'lazy';
  wrap.appendChild(img);
  return wrap;
}

function renderJson(value: unknown): HTMLElement {
  const pre = el('pre', 'nb-output__text');
  pre.textContent = JSON.stringify(value, null, 2);
  return pre;
}

/** Render one MIME bundle by picking the richest representation available. */
function renderBundle(data: MimeBundle): HTMLElement {
  const mime = pickMime(data);
  if (!mime || !data || typeof data !== 'object') {
    const empty = el('div', 'nb-output__empty');
    empty.textContent = '(no displayable output)';
    return empty;
  }

  if (mime.startsWith('image/') && mime !== 'image/svg+xml') {
    const payload = mimeText(data, mime);
    if (payload) return renderImage(mime, payload);
  }

  if (mime === 'text/html') {
    const html = mimeText(data, mime);
    if (html !== undefined) {
      const host = el('div', 'nb-output__html');
      host.appendChild(sanitiseHtml(html));
      return host;
    }
  }

  if (mime === 'application/json') {
    return renderJson(data[mime]);
  }

  const text = mimeText(data, mime) ?? mimeText(data, 'text/plain');
  if (text !== undefined) return renderText(text, 'nb-output__text');

  return renderJson(data[mime]);
}

// ─── Public ──────────────────────────────────────────────────────────────────

/** Render a single output into a fresh element. */
export function renderOutput(output: NotebookOutput): HTMLElement {
  switch (output.outputType) {
    case 'stream': {
      const stream = renderText(
        output.text,
        output.name === 'stderr' ? 'nb-output__text nb-output__text--stderr' : 'nb-output__text',
      );
      return stream;
    }

    case 'execute_result':
    case 'display_data':
      return renderBundle(output.data);

    case 'error': {
      const wrap = el('div', 'nb-output__error');
      const traceback = output.traceback.join('\n');
      if (traceback.trim()) {
        // The traceback already contains ename and evalue; printing a header
        // as well duplicates them.
        wrap.appendChild(renderText(traceback, 'nb-output__text'));
      } else {
        wrap.appendChild(renderText(`${output.ename}: ${output.evalue}`, 'nb-output__text'));
      }
      return wrap;
    }
  }
}

/** Plain-text form of an output, for "copy output". */
export function outputToText(output: NotebookOutput): string {
  switch (output.outputType) {
    case 'stream':
      return stripAnsi(output.text);
    case 'error':
      return stripAnsi(output.traceback.join('\n') || `${output.ename}: ${output.evalue}`);
    case 'execute_result':
    case 'display_data': {
      const text = mimeText(output.data, 'text/plain');
      if (text !== undefined) return text;
      const mime = pickMime(output.data);
      return mime ? `[${mime}]` : '';
    }
  }
}
