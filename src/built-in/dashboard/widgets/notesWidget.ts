// notesWidget.ts — a freeform sticky-note widget.
//
// The user types Markdown; it renders as formatted text in view mode and flips
// to a plain textarea on click. The note body is persisted directly in
// `cached_output` via ctx.setCachedOutput — same store the image widget uses
// for its data URL — so there is no extra storage column and the note survives
// reloads. No refresh handler: the content is purely user-owned.

import type {
  WidgetContext,
  WidgetHandle,
  WidgetTypeRegistration,
} from '../dashboardTypes.js';
import { renderMarkdownToDom } from './markdownRenderer.js';

interface NotesConfig {
  /** Visual scale of the note text — small / normal / large. */
  readonly textSize: 'sm' | 'md' | 'lg';
}

const DEFAULT_CONFIG: NotesConfig = { textSize: 'md' };

// Keep the note comfortably under MAX_CACHED_OUTPUT_BYTES (256 KB). A note is
// text — this ceiling is generous and only guards against runaway paste.
const MAX_NOTE_CHARS = 100_000;

const ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9z"/><path d="M15 3v6h6"/><path d="M8 13h6"/><path d="M8 17h4"/></svg>';

function normalizeConfig(raw: unknown): NotesConfig {
  const cfg = (raw ?? {}) as Partial<NotesConfig>;
  const size = cfg.textSize;
  return { textSize: size === 'sm' || size === 'lg' ? size : 'md' };
}

export const NOTES_WIDGET: WidgetTypeRegistration<NotesConfig> = {
  typeId: 'parallx.dashboard.notes',
  displayName: 'Notes',
  description: 'A freeform sticky note. Click to edit, type Markdown, click away to save. Stays put across reloads.',
  icon: ICON_SVG,
  category: 'static',
  defaultSize: { colSpan: 4, rowSpan: 3 },
  defaultConfig: DEFAULT_CONFIG,
  configSchema: {
    fields: {
      textSize: {
        type: 'enum',
        label: 'Text size',
        options: [
          { value: 'sm', label: 'Small' },
          { value: 'md', label: 'Normal' },
          { value: 'lg', label: 'Large' },
        ],
      },
    },
  },
  defaultRefreshPolicy: { kind: 'manual' },

  createWidget(container: HTMLElement, ctx: WidgetContext<NotesConfig>): WidgetHandle {
    container.classList.add('ntw');
    let config = normalizeConfig(ctx.config);
    let text = typeof ctx.cachedOutput === 'string' ? ctx.cachedOutput : '';
    let editing = false;

    function applyTextSize(): void {
      container.classList.remove('ntw--sm', 'ntw--md', 'ntw--lg');
      container.classList.add(`ntw--${config.textSize}`);
    }

    const view = document.createElement('div');
    view.className = 'ntw__view';

    const editor = document.createElement('textarea');
    editor.className = 'ntw__editor';
    editor.spellcheck = true;
    editor.placeholder = 'Write a note… Markdown works (# heading, - bullet, **bold**).';

    container.appendChild(view);
    container.appendChild(editor);

    // ── Selection formatting bubble ──
    // Highlight text in the editor and a small Markdown toolbar floats above the
    // selection. Buttons keep focus in the editor (mousedown is prevented) so a
    // click never blurs → commits → tears the editor down.
    const bubble = document.createElement('div');
    bubble.className = 'ntw-bubble';
    bubble.style.display = 'none';

    function wrapSelection(before: string, after: string): void {
      const s = editor.selectionStart ?? 0;
      const e = editor.selectionEnd ?? 0;
      const sel = editor.value.slice(s, e);
      editor.value = editor.value.slice(0, s) + before + sel + after + editor.value.slice(e);
      editor.setSelectionRange(s + before.length, s + before.length + sel.length);
      editor.focus();
    }
    function prefixLines(prefix: string): void {
      const s = editor.selectionStart ?? 0;
      const e = editor.selectionEnd ?? 0;
      const v = editor.value;
      const lineStart = v.lastIndexOf('\n', s - 1) + 1;
      const block = v.slice(lineStart, e);
      const out = block.split('\n').map((l) => prefix + l).join('\n');
      editor.value = v.slice(0, lineStart) + out + v.slice(e);
      editor.setSelectionRange(lineStart, lineStart + out.length);
      editor.focus();
    }

    const FORMATS: ReadonlyArray<{ html: string; title: string; run: () => void }> = [
      { html: '<b>B</b>', title: 'Bold', run: () => wrapSelection('**', '**') },
      { html: '<i>I</i>', title: 'Italic', run: () => wrapSelection('*', '*') },
      { html: '<s>S</s>', title: 'Strikethrough', run: () => wrapSelection('~~', '~~') },
      { html: 'H', title: 'Heading', run: () => prefixLines('## ') },
      { html: '&bull;', title: 'Bullet list', run: () => prefixLines('- ') },
      { html: '&#10078;', title: 'Quote', run: () => prefixLines('> ') },
      { html: '&lt;&gt;', title: 'Code', run: () => wrapSelection('`', '`') },
      { html: '&#128279;', title: 'Link', run: () => wrapSelection('[', '](https://)') },
    ];
    for (const f of FORMATS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.innerHTML = f.html;
      btn.title = f.title;
      btn.addEventListener('mousedown', (e) => e.preventDefault()); // keep editor focus
      btn.addEventListener('click', (e) => { e.preventDefault(); f.run(); updateBubble(); });
      bubble.appendChild(btn);
    }
    document.body.appendChild(bubble);

    // Pixel position of the caret at `pos`, via a hidden mirror div that copies
    // the textarea's box + text metrics — textareas don't expose this directly.
    function caretPoint(pos: number): { top: number; left: number; bottom: number } {
      const cs = window.getComputedStyle(editor);
      const mirror = document.createElement('div');
      const copy = ['box-sizing', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
        'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
        'font-family', 'font-size', 'font-weight', 'font-style', 'letter-spacing', 'line-height',
        'text-transform', 'word-spacing', 'text-indent'];
      for (const p of copy) mirror.style.setProperty(p, cs.getPropertyValue(p));
      mirror.style.position = 'absolute';
      mirror.style.visibility = 'hidden';
      mirror.style.whiteSpace = 'pre-wrap';
      mirror.style.wordWrap = 'break-word';
      mirror.style.overflow = 'hidden';
      mirror.style.width = `${editor.clientWidth}px`;
      mirror.textContent = editor.value.slice(0, pos);
      const marker = document.createElement('span');
      marker.textContent = editor.value.slice(pos) || '.';
      mirror.appendChild(marker);
      document.body.appendChild(mirror);
      const r = editor.getBoundingClientRect();
      const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.55;
      const top = r.top + marker.offsetTop - editor.scrollTop;
      const left = r.left + marker.offsetLeft - editor.scrollLeft;
      document.body.removeChild(mirror);
      return { top, left, bottom: top + lh };
    }

    function hideBubble(): void { bubble.style.display = 'none'; }
    function updateBubble(): void {
      if (!editing) { hideBubble(); return; }
      const s = editor.selectionStart;
      const e = editor.selectionEnd;
      if (s == null || e == null || s === e) { hideBubble(); return; }
      const pt = caretPoint(Math.min(s, e));
      bubble.style.display = 'flex';
      bubble.style.visibility = 'hidden';
      const bw = bubble.offsetWidth || 240;
      const bh = bubble.offsetHeight || 30;
      const left = Math.max(8, Math.min(pt.left, window.innerWidth - bw - 8));
      let top = pt.top - bh - 6;
      if (top < 8) top = pt.bottom + 6; // flip below the line if no room above
      bubble.style.left = `${Math.round(left)}px`;
      bubble.style.top = `${Math.round(top)}px`;
      bubble.style.visibility = 'visible';
    }
    const onWindowChange = () => hideBubble();
    editor.addEventListener('mouseup', () => window.setTimeout(updateBubble, 0));
    editor.addEventListener('keyup', updateBubble);
    editor.addEventListener('scroll', hideBubble);
    window.addEventListener('scroll', onWindowChange, true);
    window.addEventListener('resize', onWindowChange);

    function paintView(): void {
      view.innerHTML = '';
      if (!text.trim()) {
        const empty = document.createElement('div');
        empty.className = 'ntw__empty';
        empty.innerHTML = '<strong>Empty note</strong><p>Click anywhere to start writing.</p>';
        view.appendChild(empty);
        return;
      }
      view.appendChild(renderMarkdownToDom(text));
    }

    function enterEdit(): void {
      if (editing) return;
      editing = true;
      editor.value = text;
      container.classList.add('ntw--editing');
      editor.focus();
      // Place the caret at the end so typing continues the note.
      const len = editor.value.length;
      editor.setSelectionRange(len, len);
    }

    function commit(): void {
      if (!editing) return;
      editing = false;
      hideBubble();
      container.classList.remove('ntw--editing');
      let next = editor.value;
      if (next.length > MAX_NOTE_CHARS) next = next.slice(0, MAX_NOTE_CHARS);
      if (next !== text) {
        text = next;
        ctx.setCachedOutput(text);
      }
      paintView();
    }

    view.addEventListener('click', enterEdit);
    editor.addEventListener('blur', commit);
    editor.addEventListener('keydown', (e) => {
      // Escape cancels (revert), Ctrl/Cmd+Enter commits.
      if (e.key === 'Escape') {
        e.preventDefault();
        editing = false;
        hideBubble();
        container.classList.remove('ntw--editing');
        paintView();
        view.focus();
      } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        commit();
      }
    });

    const sub = ctx.onDidChangeConfig((next) => {
      config = normalizeConfig(next);
      applyTextSize();
    });

    applyTextSize();
    paintView();

    return {
      refreshFromCache(cached: string | null) {
        // Don't clobber an in-progress edit — only re-sync the view.
        if (editing) return;
        text = typeof cached === 'string' ? cached : '';
        paintView();
      },
      dispose() {
        // Persist any pending edit if the pane is torn down mid-edit.
        if (editing) commit();
        window.removeEventListener('scroll', onWindowChange, true);
        window.removeEventListener('resize', onWindowChange);
        bubble.remove();
        sub.dispose();
      },
    };
  },
};
