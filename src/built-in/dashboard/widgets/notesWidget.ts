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
        sub.dispose();
      },
    };
  },
};
