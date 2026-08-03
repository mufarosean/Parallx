// notebookEditorPane.ts — the notebook surface (M96)
//
// Cell list, execution, and the keyboard model. Cell editors are the SAME
// CodeEditor primitive the file editor uses, in `autoHeight` mode — which is
// why that mode and `extraKeymap` exist on it at all.
//
// Two decisions worth stating, because both are visible and both were choices:
//
// 1. No Jupyter-style modal editing (command mode vs edit mode). Modal editing
//    is muscle memory for heavy Jupyter users and a trap for everyone else —
//    typing `dd` and losing a cell because focus was one keystroke off. The
//    per-cell affordances are buttons and explicit shortcuts instead. Someone
//    who wants `Esc`+`a`+`b` should say so; guessing wrong here is worse than
//    not guessing.
//
// 2. Execution is serialised through one queue. A kernel executes one request
//    at a time regardless, so firing five cells concurrently would only mean
//    the UI's idea of order and the kernel's diverge — and "Run All" on a
//    notebook whose cells depend on each other is precisely where that
//    matters.

import './notebook.css';
import { EditorPane, type EditorPaneViewState } from '../../../editor/editorPane.js';
import type { IEditorInput } from '../../../editor/editorInput.js';
import { DisposableStore, type IDisposable } from '../../../platform/lifecycle.js';
import { rafThrottle } from '../../../platform/rafThrottle.js';
import { CodeEditor } from '../../../ui/codeEditor.js';
import { renderMarkdown } from '../../../ui/renderMarkdown.js';
import { $ } from '../../../ui/dom.js';
import { NotebookEditorInput } from './notebookEditorInput.js';
import { renderOutput, outputToText } from './outputRenderer.js';
import {
  createEmptyCell,
  clearAllOutputs,
  notebookLanguage,
  cellDurationMs,
  setCellExecutionTiming,
  formatDuration,
  CellOutputSink,
  type CellType,
  type NotebookCell,
  type NotebookDocument,
  type NotebookOutput,
} from './notebookModel.js';
import type {
  INotebookKernelService,
  IKernelStatus,
} from '../../../services/notebookKernelService.js';
import type { IPythonEnvService } from '../../../services/pythonEnvService.js';
import type { IChatMessage, IChatResponseChunk } from '../../../services/chatTypes.js';
import { stripCodeFences } from './codeFences.js';
import { buildGenerateMessages } from './generatePrompt.js';

/**
 * The slice of the chat tool's inline-AI provider that Generate needs.
 *
 * Obtained through the `chat.getInlineAIProvider` command rather than by
 * importing the chat tool, because the chat tool owns model selection and may
 * not have activated yet — the same indirection the canvas editor uses for its
 * inline AI. Resolved per invocation, so switching the active model in the chat
 * panel takes effect on the very next Generate.
 */
export interface INotebookGenerateProvider {
  sendChatRequest(
    messages: readonly IChatMessage[],
    options?: { temperature?: number; maxTokens?: number },
    signal?: AbortSignal,
  ): AsyncIterable<IChatResponseChunk>;
}

export type NotebookGenerateProviderResolver = () => Promise<INotebookGenerateProvider | undefined>;

/** Beyond this many outputs on one cell, older ones are folded away. */
const MAX_RENDERED_OUTPUTS = 50;

interface CellView {
  readonly cell: NotebookCell;
  readonly root: HTMLElement;
  readonly editor: CodeEditor;
  readonly outputHost: HTMLElement;
  readonly promptEl: HTMLElement;
  readonly markdownHost: HTMLElement;
  /**
   * The `.nb-cell__editor` WRAPPER, not the CodeEditor's own element.
   *
   * Hiding matters here and the distinction was a real bug: `.px-code-editor`
   * sets `display: flex`, which beats the browser's `[hidden] { display: none }`
   * on specificity — so setting `hidden` on the inner element did nothing and a
   * rendered markdown cell showed its source AND its preview at once. The
   * wrapper has an explicit `[hidden]` rule in notebook.css, so hiding that
   * works.
   */
  readonly editorHost: HTMLElement;
  /** The bordered input box — the Generate prompt bar mounts inside it. */
  readonly box: HTMLElement;
  /** Per-cell timing line: live while running, final duration after. */
  readonly timingEl: HTMLElement;
  /** Markdown cells render preview unless being edited. */
  editing: boolean;
  running: boolean;
  /**
   * Accumulates this cell's outputs — stream merging, deferred clear, byte cap.
   * Shared with the assistant's `notebook_run` tool so both writers produce the
   * same file for the same code.
   */
  readonly sink: CellOutputSink;
}

export class NotebookEditorPane extends EditorPane {
  static readonly PANE_ID = 'notebook-editor-pane';

  private _toolbar!: HTMLElement;
  private _statusDot!: HTMLElement;
  private _statusText!: HTMLElement;
  private _banner!: HTMLElement;
  private _cellList!: HTMLElement;
  private _interruptBtn!: HTMLButtonElement;

  private _doc: NotebookEditorInput | undefined;
  private _document: NotebookDocument | undefined;
  private _language = 'python';

  private readonly _views = new Map<string, CellView>();
  private readonly _inputListeners = new DisposableStore();
  private _selectedCellId: string | null = null;

  /** Serialises execution; see the header note. */
  private _queue: Promise<unknown> = Promise.resolve();
  private _runningAll = false;

  /**
   * Executions this pane started and has not yet seen finish.
   *
   * A pane is destroyed on an ordinary tab switch (EditorGroupView calls
   * clearInput() then disposes it), but the kernel keeps running. Without
   * this, the output listener closure keeps the whole dead pane — every
   * CellView and its detached DOM — reachable from the service's execution
   * map until the cell finishes, which for `while True:` is never. Worse, the
   * NotebookEditorInput memoises its document, so a re-opened pane shares the
   * same cell objects: late output from the orphan lands in the shared model
   * and paints into detached DOM, so the visible pane shows a finished-looking
   * cell with no output, and the mutation never marks the file dirty.
   */
  private readonly _liveExecutions = new Set<{ dispose(): void }>();

  /** Set once teardown has run, so late async work cannot touch the model. */
  private _torndown = false;

  /** Pending "interrupt didn't take" check; cancelled on teardown. */
  private _interruptTimer: number | undefined;

  /** In-flight generation, so a second Generate cancels the first. */
  private _generation: { abort: AbortController; flush: { dispose(): void } } | undefined;

  /**
   * The one open Generate prompt bar.
   *
   * Singular on purpose, and it has to be: `_generation` is a single slot, so
   * starting a second generation aborts the first. With two bars on screen that
   * left the first one stuck on "Writing…" beside a half-written cell, with no
   * indication it had been abandoned. One bar at a time is the honest shape.
   */
  private _activePrompt: { readonly cellId: string; dismiss(): void } | undefined;

  /**
   * Set while THIS pane is making a structural edit.
   *
   * The pane and the assistant now mutate the same document, and the pane
   * repaints when that document changes structurally. Without this flag it would
   * also repaint on its own edits — rebuilding every cell view out from under
   * the caret the moment you inserted a cell.
   */
  private _selfEdit = false;

  /** Mark dirty for an edit this pane made, without triggering its own rebuild. */
  private _markDirtySelf(structural = true): void {
    this._selfEdit = true;
    try { this._doc?.markDirty(structural); } finally { this._selfEdit = false; }
  }

  /**
   * Rebuild the cell list from the document.
   *
   * Called when a DIFFERENT writer changed the notebook — the assistant running
   * cells or editing one through `notebook_*`. Both now mutate this pane's own
   * document (one writer per notebook), so the data is already correct here; the
   * view is what has to catch up.
   */
  private _rebuildFromDocument(): void {
    if (this._torndown || !this._document) return;
    const selected = this._selectedCellId;
    this._disposeViews();
    for (const cell of this._document.cells) {
      this._cellList.appendChild(this._createCellView(cell).root);
    }
    // Keep the selection if that cell still exists, so an external edit does not
    // move the user somewhere else in their own notebook.
    this._selectedCellId = this._document.cells.some((c) => c.id === selected)
      ? selected
      : (this._document.cells[0]?.id ?? null);
    this._paintSelection();
  }

  constructor(
    private readonly _kernel?: INotebookKernelService,
    private readonly _resolveGenerateProvider?: NotebookGenerateProviderResolver,
    private readonly _python?: IPythonEnvService,
  ) {
    super(NotebookEditorPane.PANE_ID);
  }

  // ── Chrome ──

  protected override createPaneContent(container: HTMLElement): void {
    container.classList.add('nb-pane');

    this._toolbar = $('div');
    this._toolbar.className = 'nb-toolbar';

    // Inline 14px glyphs rather than an icon-font dependency, so the ribbon
    // themes with `currentColor` and needs no asset pipeline.
    const ICON = {
      plus: 'M8 3v10M3 8h10',
      play: 'M5 3.2v9.6c0 .4.4.6.7.4l7.3-4.8a.5.5 0 0 0 0-.8L5.7 2.8a.5.5 0 0 0-.7.4z',
      stop: 'M4.5 4.5h7v7h-7z',
      restart: 'M13 8a5 5 0 1 1-1.5-3.5M13 2v3h-3',
      clear: 'M3 4h10M6 4V3h4v1M5 4l.6 8.4A1 1 0 0 0 6.6 13h2.8a1 1 0 0 0 1-.6L11 4',
      spark: 'M8 2.5 9.3 6l3.5 1.3L9.3 8.6 8 12.1 6.7 8.6 3.2 7.3 6.7 6z',
    } as const;

    const icon = (path: string, filled = false): string =>
      `<svg class="nb-btn__icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">`
      + `<path d="${path}" ${filled ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"'}/></svg>`;

    const button = (
      label: string, title: string, onClick: () => void,
      glyph?: string, filled = false,
    ): HTMLButtonElement => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'nb-btn';
      if (glyph) btn.innerHTML = icon(glyph, filled);
      btn.appendChild(document.createTextNode(label));
      btn.title = title;
      btn.addEventListener('click', onClick);
      this._toolbar.appendChild(btn);
      return btn;
    };

    const separator = (): void => {
      const sep = $('div');
      sep.className = 'nb-toolbar__sep';
      this._toolbar.appendChild(sep);
    };

    // Grouped the way the commands actually relate: authoring, then execution,
    // then destructive.
    button('Code', 'Add a code cell at the end', () => this._appendCell('code'), ICON.plus);
    button('Markdown', 'Add a markdown cell at the end', () => this._appendCell('markdown'), ICON.plus);
    // Acts on the selected cell (Ctrl+I does the same from inside one), falling
    // back to a new cell at the end when nothing is selected.
    button('Generate', 'Write a cell with AI (Ctrl+I)', () => this._generateForSelection(), ICON.spark, true);
    separator();
    button('Run all', 'Run every cell in order', () => void this._runAll(), ICON.play, true);
    this._interruptBtn = button('Interrupt', 'Stop the running cell', () => void this._interrupt(), ICON.stop, true);
    this._interruptBtn.disabled = true;
    button('Restart', 'Restart the kernel. All variables are lost.', () => void this._restart(), ICON.restart);
    separator();
    button('Clear all outputs', 'Remove every output in this notebook', () => this._clearOutputs(), ICON.clear);

    const status = $('div');
    status.className = 'nb-status';
    this._statusDot = $('span');
    this._statusDot.className = 'nb-status__dot';
    this._statusText = $('span');
    this._statusText.className = 'nb-status__text';
    this._statusText.textContent = 'No kernel';
    status.append(this._statusDot, this._statusText);
    this._toolbar.appendChild(status);

    container.appendChild(this._toolbar);

    this._banner = $('div');
    this._banner.className = 'nb-banner';
    this._banner.hidden = true;
    container.appendChild(this._banner);

    this._cellList = $('div');
    this._cellList.className = 'nb-cells';
    // The insert-at-top zone. Every other gap belongs to the cell above it (see
    // _createGap), but the space before the first cell has no such owner, so it
    // is a permanent child of the list.
    this._cellList.appendChild(this._createGap(null));
    container.appendChild(this._cellList);
  }

  /**
   * The hover strip between two cells: `+ Code`, `+ Markdown`, `Generate`.
   *
   * This is the affordance that stops the toolbar from being the only way to add
   * a cell. Without it, inserting a cell in the middle of a notebook means
   * either finding the small `+` in the hovered cell's action bar or adding at
   * the end and moving it up — and both are worse than clicking the place you
   * want the cell to be.
   *
   * `afterCellId === null` means the zone above the first cell.
   *
   * Ownership note: a gap is a CHILD of the cell it sits below, not a sibling
   * interleaved into the list. That keeps every existing structural operation
   * (insertBefore against a cell root, `root.remove()`, move up/down) correct
   * with no changes — the gap travels with its cell automatically. Interleaving
   * would have made each of those a two-node dance and the first missed case a
   * stray strip floating in the notebook.
   */
  private _createGap(afterCellId: string | null): HTMLElement {
    const gap = $('div');
    gap.className = afterCellId === null ? 'nb-gap nb-gap--head' : 'nb-gap';

    const actions = $('div');
    actions.className = 'nb-gap__actions';

    const at = (): number => {
      if (afterCellId === null) return 0;
      const index = this._document?.cells.findIndex((c) => c.id === afterCellId) ?? -1;
      // A missing cell means the gap outlived its owner; appending beats throwing.
      return index < 0 ? (this._document?.cells.length ?? 0) : index + 1;
    };

    const add = (label: string, title: string, glyph: string, run: () => void): void => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'nb-gap__btn';
      btn.innerHTML = `<svg class="nb-gap__icon" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">`
        + `<path d="${glyph}" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
      btn.appendChild(document.createTextNode(label));
      btn.title = title;
      btn.addEventListener('click', (e) => { e.stopPropagation(); run(); });
      actions.appendChild(btn);
    };

    add('Code', 'Insert a code cell here', 'M8 3v10M3 8h10', () => {
      this._insertCellAt(at(), 'code')?.editor.focus();
    });
    add('Markdown', 'Insert a markdown cell here', 'M8 3v10M3 8h10', () => {
      this._insertCellAt(at(), 'markdown')?.editor.focus();
    });
    add('Generate', 'Write a cell with AI', 'M8 2.5 9.3 6l3.5 1.3L9.3 8.6 8 12.1 6.7 8.6 3.2 7.3 6.7 6z', () => {
      this._startGenerate(at());
    });

    gap.appendChild(actions);
    return gap;
  }

  // ── Input ──

  protected override async renderInput(input: IEditorInput): Promise<void> {
    this._inputListeners.clear();
    this._disposeViews();

    if (!(input instanceof NotebookEditorInput)) return;
    this._doc = input;

    const doc = await input.resolve();
    if (!doc) {
      this._showBanner(input.loadError ?? 'Could not open this notebook.', 'error');
      return;
    }
    this._document = doc;
    this._language = notebookLanguage(doc);

    // A notebook with no cells offers nowhere to type.
    if (doc.cells.length === 0) {
      doc.cells.push(createEmptyCell('code'));
    }

    for (const cell of doc.cells) this._cellList.appendChild(this._createCellView(cell).root);
    this._selectedCellId = doc.cells[0]?.id ?? null;

    // Repaint when a DIFFERENT writer changes this notebook — the assistant
    // running cells or editing one through the notebook_* tools. Those mutate
    // this pane's own document (one writer per notebook), so without this the
    // data was already right here and the view simply never caught up: you would
    // see nothing until you switched tabs and back.
    this._inputListeners.add(input.onDidChangeDocument(() => {
      if (this._selfEdit) return;   // our own edit; the views are already correct
      this._rebuildFromDocument();
    }));

    if (this._kernel) {
      this._inputListeners.add(this._kernel.onDidChangeStatus((s) => this._paintStatus(s)));

      this._inputListeners.add(this._kernel.onDidFail(({ message }) => {
        this._showBanner(message, 'error');
        for (const view of this._views.values()) this._setRunning(view, false);
        this._interruptBtn.disabled = true;
      }));
      void this._checkReadiness();
      void this._kernel.getStatus().then((s) => this._paintStatus(s));
    } else {
      this._showBanner('Notebooks need the desktop app.', 'info');
    }
  }

  /**
   * The whole first run, from one button: consent → create the venv → install
   * ipykernel → ready. Each phase names itself in the banner; the live pip and
   * venv output streams to the Terminal panel as it always does.
   *
   * Consent is still consent — this flips `python.enabled` exactly as the
   * Settings toggle does, from an explicit click on a button that says what it
   * sets up. What it removes is the walk: Settings, toggle, Create, back here,
   * second banner, ipykernel.
   */
  private async _setUpPython(): Promise<void> {
    if (!this._python || !this._kernel) return;
    try {
      if (!this._python.isEnabled) {
        await this._python.setEnabled(true);
      }

      this._showBanner('Creating the workspace environment… Live output is in the Terminal panel.', 'info');
      const created = await this._python.createEnv();
      if (this._torndown) return;
      if (!created.ok) {
        this._showBanner(created.error ?? 'Could not create the environment.', 'error');
        return;
      }

      this._showBanner('Installing the notebook kernel (ipykernel)…', 'info');
      const deps = await this._kernel.installKernelDependencies();
      if (this._torndown) return;
      if (!deps.ok) {
        this._showBanner(deps.error ?? 'Could not install ipykernel.', 'error');
        return;
      }

      this._hideBanner();
      void this._checkReadiness();
    } catch (err) {
      if (!this._torndown) this._showBanner((err as Error).message, 'error');
    }
  }

  private async _checkReadiness(): Promise<void> {
    if (!this._kernel) return;
    const readiness = await this._kernel.checkReadiness();
    if (readiness.ready) { this._hideBanner(); return; }

    if (readiness.reason === 'NO_ENV') {
      // One button, not a scavenger hunt. The old banner sent the user to
      // Settings, where they had to flip consent, click Create, come back, and
      // meet a SECOND banner asking for ipykernel — five surfaces for one
      // intent. Everything the trip collects is a service call, so do the whole
      // sequence here, where the intent was expressed.
      if (this._python?.isAvailable) {
        this._showBanner(
          'This workspace has no Python environment yet.',
          'info',
          { label: 'Set up Python', run: () => void this._setUpPython() },
        );
      } else {
        this._showBanner(
          'This workspace has no Python environment yet. Create one in Settings › Python to run cells.',
          'info',
        );
      }
    } else if (readiness.reason === 'MISSING_IPYKERNEL') {
      // Offer the fix inline rather than sending the user to go find it.
      this._showBanner('Running notebooks needs the ipykernel package in this workspace.', 'info', {
        label: 'Install ipykernel',
        run: async () => {
          this._showBanner('Installing ipykernel. This takes a minute…', 'info');
          const res = await this._kernel!.installKernelDependencies();
          if (res.ok) { this._hideBanner(); void this._checkReadiness(); }
          else this._showBanner(res.error ?? 'Install failed.', 'error');
        },
      });
    } else {
      this._showBanner('Could not check whether this workspace can run notebooks.', 'error');
    }
  }

  // ── Cell views ──

  private _createCellView(cell: NotebookCell): CellView {
    const root = $('div');
    root.className = `nb-cell nb-cell--${cell.cellType}`;
    root.dataset['cellId'] = cell.id;

    const gutter = $('div');
    gutter.className = 'nb-cell__gutter';

    const promptEl = $('div');
    promptEl.className = 'nb-cell__prompt';
    promptEl.textContent = cell.cellType === 'code' ? this._promptFor(cell) : '';

    const runBtn = document.createElement('button');
    runBtn.type = 'button';
    runBtn.className = 'nb-cell__run';
    runBtn.title = cell.cellType === 'code' ? 'Run this cell (Ctrl+Enter)' : 'Render this cell';
    runBtn.setAttribute('aria-label', 'Run cell');
    runBtn.innerHTML = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M4.5 3.2v9.6c0 .4.4.6.7.4l7.3-4.8a.5.5 0 0 0 0-.8L5.2 2.8a.5.5 0 0 0-.7.4z"/></svg>';
    runBtn.addEventListener('click', () => void this._runCell(cell.id));

    gutter.append(runBtn, promptEl);

    const body = $('div');
    body.className = 'nb-cell__body';

    // The cell's own bordered box: editor (or markdown preview) plus the status
    // strip. Outputs sit OUTSIDE it, as in VS Code, so the box delimits "the
    // input" and the status line unambiguously belongs to it.
    const box = $('div');
    box.className = 'nb-cell__box';

    const editorHost = $('div');
    editorHost.className = 'nb-cell__editor';
    box.appendChild(editorHost);

    const markdownHost = $('div');
    markdownHost.className = 'nb-cell__markdown';
    markdownHost.hidden = true;
    box.appendChild(markdownHost);

    // Status strip INSIDE the cell's box: timing on the left, language on the
    // right — the same place VS Code puts them. Keeping it inside the box is
    // what makes the execution count and duration read as belonging to this
    // cell; floating them between two cells (the previous layout) left it
    // genuinely ambiguous which cell they described.
    const statusEl = $('div');
    statusEl.className = 'nb-cell__status';

    const timingEl = $('div');
    timingEl.className = 'nb-cell__timing';
    timingEl.hidden = true;

    const langEl = $('div');
    langEl.className = 'nb-cell__lang';
    langEl.textContent = cell.cellType === 'code'
      ? this._language.charAt(0).toUpperCase() + this._language.slice(1)
      : cell.cellType === 'markdown' ? 'Markdown' : 'Raw';

    statusEl.append(timingEl, langEl);
    box.appendChild(statusEl);
    body.appendChild(box);

    const outputHost = $('div');
    outputHost.className = 'nb-cell__outputs';
    body.appendChild(outputHost);

    const editor = new CodeEditor(editorHost, {
      value: cell.source,
      languageId: cell.cellType === 'code' ? this._language : 'markdown',
      autoHeight: true,
      lineNumbers: false,
      foldGutter: false,
      wordWrap: cell.cellType !== 'code',
      indentSize: 4,
      placeholder: cell.cellType === 'markdown' ? 'Markdown…' : '',
      extraKeymap: [
        { key: 'Shift-Enter', run: () => { void this._runCellThenAdvance(cell.id); return true; } },
        { key: 'Mod-Enter', run: () => { void this._runCell(cell.id); return true; } },
        { key: 'Alt-Enter', run: () => { void this._runCellThenInsert(cell.id); return true; } },
        // Ctrl+I on a cell asks the model to write or rewrite THIS cell — the
        // same binding VS Code uses, and the reason the prompt bar lives in the
        // cell box rather than in a floating dialog.
        { key: 'Mod-i', run: () => {
          const target = this._views.get(cell.id);
          if (target) this._openGeneratePrompt(target);
          return true;
        } },
      ],
    });

    const view: CellView = {
      cell, root, editor, outputHost, promptEl, markdownHost, timingEl, editorHost, box,
      editing: cell.cellType !== 'markdown' || cell.source.trim() === '',
      running: false,
      sink: new CellOutputSink(cell),
    };

    editor.onDidChange((value) => {
      cell.source = value;
      // Source edits are content, not structure — no re-layout needed.
      this._doc?.markDirty(false);
    });

    root.addEventListener('focusin', () => { this._selectedCellId = cell.id; this._paintSelection(); });
    root.addEventListener('click', () => { this._selectedCellId = cell.id; this._paintSelection(); });

    // Markdown: preview when not being edited, double-click to get back in.
    markdownHost.addEventListener('dblclick', () => this._setMarkdownEditing(view, true));

    const actions = this._createCellActions(cell);
    // The insert zone for the space below this cell, carried inside it so it
    // moves, hides and dies with the cell.
    root.append(gutter, body, actions, this._createGap(cell.id));

    this._views.set(cell.id, view);
    this._renderOutputs(view);
    // Timing recorded by a previous run — here or in JupyterLab — is in the
    // cell metadata, so a reopened notebook shows it without re-running.
    this._paintTiming(view);
    if (cell.cellType === 'markdown' && !view.editing) this._setMarkdownEditing(view, false);
    return view;
  }

  private _createCellActions(cell: NotebookCell): HTMLElement {
    const bar = $('div');
    bar.className = 'nb-cell__actions';

    const action = (label: string, title: string, run: () => void) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'nb-cell__action';
      btn.textContent = label;
      btn.title = title;
      btn.addEventListener('click', (e) => { e.stopPropagation(); run(); });
      bar.appendChild(btn);
    };

    if (cell.cellType === 'code') {
      action('✦', 'Rewrite this cell with AI (Ctrl+I)', () => {
        const view = this._views.get(cell.id);
        if (view) this._openGeneratePrompt(view);
      });
    }
    action('↑', 'Move cell up', () => this._moveCell(cell.id, -1));
    action('↓', 'Move cell down', () => this._moveCell(cell.id, 1));
    action(cell.cellType === 'code' ? 'M' : 'C',
      cell.cellType === 'code' ? 'Convert to markdown' : 'Convert to code',
      () => this._convertCell(cell.id));
    action('+', 'Insert a cell below', () => this._insertCellBelow(cell.id, 'code'));
    action('✕', 'Delete this cell', () => this._deleteCell(cell.id));
    return bar;
  }

  private _promptFor(cell: NotebookCell): string {
    if (cell.cellType !== 'code') return '';
    return cell.executionCount === null ? '[ ]' : `[${cell.executionCount}]`;
  }

  private _paintSelection(): void {
    for (const [id, view] of this._views) {
      view.root.classList.toggle('nb-cell--selected', id === this._selectedCellId);
    }
  }

  private _setMarkdownEditing(view: CellView, editing: boolean): void {
    if (view.cell.cellType !== 'markdown') return;
    view.editing = editing;
    view.root.classList.toggle('nb-cell--previewing', !editing);
    view.editorHost.hidden = !editing;
    view.markdownHost.hidden = editing;
    if (!editing) {
      view.markdownHost.replaceChildren(
        view.cell.source.trim()
          ? renderMarkdown(view.cell.source)
          : this._placeholder('Empty markdown cell. Double-click to edit.'),
      );
    } else {
      view.editor.focus();
    }
  }

  private _placeholder(text: string): HTMLElement {
    const node = $('div');
    node.className = 'nb-cell__placeholder';
    node.textContent = text;
    return node;
  }

  // ── Outputs ──

  private _renderOutputs(view: CellView): void {
    view.outputHost.replaceChildren();
    const outputs = view.cell.outputs;
    if (!outputs.length) { view.outputHost.hidden = true; return; }
    view.outputHost.hidden = false;

    // A cell that printed 10,000 times should not create 10,000 DOM nodes.
    const overflow = outputs.length - MAX_RENDERED_OUTPUTS;
    if (overflow > 0) {
      const note = $('div');
      note.className = 'nb-output__truncated';
      note.textContent = `${overflow} earlier output${overflow === 1 ? '' : 's'} hidden`;
      view.outputHost.appendChild(note);
    }
    for (const output of outputs.slice(-MAX_RENDERED_OUTPUTS)) {
      view.outputHost.appendChild(renderOutput(output));
    }
  }

  /**
   * Append one output through the cell's shared sink.
   *
   * The merging, deferred-clear and byte-capping rules moved to
   * `CellOutputSink` in notebookModel.ts once a second caller appeared (the
   * assistant's `notebook_run` tool). They are the rules that make a file
   * written here look like a file written by Jupyter, so both writers have to
   * follow them — and one copy is the only way that stays true.
   */
  private _appendOutput(view: CellView, output: NotebookOutput): void {
    view.sink.append(output);
    this._scheduleRender(view);
    this._doc?.markDirty(false);
  }

  /**
   * Coalesce output repaints to one per frame.
   *
   * `_renderOutputs` replaces the whole output host and rebuilds each `<pre>`
   * from the full accumulated text. ipykernel flushes several times a second,
   * and a tight print loop turns that into a repaint of a growing multi-MB
   * block on every flush — quadratic work on the UI thread. One repaint per
   * frame is all a human can see, and rafThrottle is the app's single
   * mechanism for that.
   */
  private _scheduleRender(view: CellView): void {
    this._pendingRenders.add(view.cell.id);
    this._flushRenders();
  }

  private readonly _pendingRenders = new Set<string>();

  private readonly _flushRenders = rafThrottle(() => {
    if (this._torndown) return;
    for (const cellId of this._pendingRenders) {
      const view = this._views.get(cellId);
      if (view) this._renderOutputs(view);
    }
    this._pendingRenders.clear();
  });

  // ── Execution ──

  private _setRunning(view: CellView, running: boolean): void {
    view.running = running;
    view.root.classList.toggle('nb-cell--running', running);
    if (running) view.promptEl.textContent = '[*]';
    else view.promptEl.textContent = this._promptFor(view.cell);
  }

  /**
   * Show how long the cell last took, from its persisted metadata.
   *
   * Read back from `metadata.execution` rather than held in memory, so the
   * number survives a reload and matches what JupyterLab would show for the
   * same file.
   */
  private _paintTiming(view: CellView): void {
    if (view.cell.cellType !== 'code') { view.timingEl.hidden = true; return; }
    const ms = cellDurationMs(view.cell);
    if (ms === null) { view.timingEl.hidden = true; view.timingEl.textContent = ''; return; }
    view.timingEl.hidden = false;
    view.timingEl.classList.remove('nb-cell__timing--live');
    view.timingEl.textContent = `${formatDuration(ms)}`;
    view.timingEl.title = 'Time the kernel spent on this cell';
  }

  /**
   * Tick a live elapsed counter while a cell runs.
   *
   * A cell that shows only `[*]` gives no sense of whether it has been going
   * for two seconds or two minutes — the exact moment you want to know whether
   * to wait or interrupt. Updated once a second: this is a human-readable
   * duration, not an animation, and a rAF loop would burn a frame budget to
   * redraw the same string.
   */
  private _startTimingTicker(view: CellView, execution: { elapsedMs(): number | null }): () => void {
    view.timingEl.hidden = false;
    view.timingEl.classList.add('nb-cell__timing--live');
    const paint = (): void => {
      const ms = execution.elapsedMs();
      view.timingEl.textContent = ms === null ? 'starting…' : formatDuration(ms);
    };
    paint();
    const handle = window.setInterval(paint, 1000);
    return () => {
      window.clearInterval(handle);
      view.timingEl.classList.remove('nb-cell__timing--live');
    };
  }

  /** Queue a cell. Returns when it has finished. */
  private _runCell(cellId: string): Promise<void> {
    const run = this._queue.then(() => this._executeCell(cellId));
    // Swallow here so one failed cell cannot poison the queue for every
    // subsequent run; _executeCell already surfaces its own errors.
    this._queue = run.catch(() => undefined);
    return run.catch(() => undefined);
  }

  private async _executeCell(cellId: string): Promise<void> {
    const view = this._views.get(cellId);
    if (!view) return;

    if (view.cell.cellType === 'markdown') {
      this._setMarkdownEditing(view, false);
      return;
    }
    if (view.cell.cellType === 'raw') return;
    if (!this._kernel) { this._showBanner('Notebooks need the desktop app.', 'error'); return; }
    if (!view.cell.source.trim()) return;

    this._setRunning(view, true);
    this._interruptBtn.disabled = false;
    view.cell.outputs = [];
    this._renderOutputs(view);

    const execution = await this._kernel.execute(view.cell.source);
    if (!execution) {
      this._setRunning(view, false);
      this._interruptBtn.disabled = true;
      this._showBanner('Could not start the kernel. Check Settings › Python.', 'error');
      return;
    }

    // Re-resolve the view by id on every event rather than closing over the
    // CellView captured above. Converting or deleting a cell mid-run replaces
    // or removes its view, and a captured reference would keep writing into a
    // disposed editor's detached DOM.
    const live = (): CellView | undefined => (this._torndown ? undefined : this._views.get(cellId));

    const store = new DisposableStore();
    store.add(execution.onDidOutput((output) => {
      const target = live();
      if (target) this._appendOutput(target, output);
    }));
    store.add(execution.onDidSetExecutionCount((count) => {
      const target = live();
      // Stays [*] while running; the number lands when it finishes.
      if (target) target.cell.executionCount = count;
    }));
    store.add(execution.onDidClear(({ wait }) => {
      const target = live();
      if (!target) return;
      target.sink.clear(wait);
      // A deferred clear changes nothing on screen yet — the outputs stay until
      // the next one arrives, which is what stops a progress bar flickering to
      // empty between frames.
      if (!wait) this._renderOutputs(target);
    }));

    const stopTicker = this._startTimingTicker(view, execution);
    store.add({ dispose: stopTicker });

    this._liveExecutions.add(execution);
    let result: Awaited<typeof execution.completed> | undefined;
    try {
      result = await execution.completed;
    } finally {
      this._liveExecutions.delete(execution);
      store.dispose();
      execution.dispose();
      const target = live();
      if (target) {
        // Persist in JupyterLab's shape so the number survives a reload and is
        // visible to any other tool that opens the file.
        setCellExecutionTiming(target.cell, result?.startedAtIso ?? null, result?.endedAtIso ?? null);
        this._paintTiming(target);
      }
      if (target) this._setRunning(target, false);
      // Interrupt stays available while a Run All is still feeding cells, and
      // goes away once nothing is queued. The polarity here has to match
      // _paintStatus, which is the other writer of this flag.
      this._interruptBtn.disabled = !this._runningAll;
      this._doc?.markDirty(false);
    }
  }

  private async _runCellThenAdvance(cellId: string): Promise<void> {
    await this._runCell(cellId);
    if (!this._document) return;
    const index = this._document.cells.findIndex((c) => c.id === cellId);
    const next = this._document.cells[index + 1];
    if (next) {
      this._views.get(next.id)?.editor.focus();
      this._selectedCellId = next.id;
      this._paintSelection();
    } else {
      // Running the last cell should leave somewhere to keep going.
      this._insertCellBelow(cellId, 'code');
    }
  }

  private async _runCellThenInsert(cellId: string): Promise<void> {
    await this._runCell(cellId);
    this._insertCellBelow(cellId, 'code');
  }

  private async _runAll(): Promise<void> {
    if (!this._document || this._runningAll) return;
    this._runningAll = true;
    this._interruptBtn.disabled = false;
    try {
      // Snapshot the ids: a cell added mid-run should not join this pass.
      for (const id of this._document.cells.map((c) => c.id)) {
        // Re-checked each iteration: Restart (or a teardown) clears the flag,
        // and the loop must notice rather than keep feeding a kernel that no
        // longer has the state these cells depend on.
        if (!this._runningAll || this._torndown) break;
        const view = this._views.get(id);
        if (!view || view.cell.cellType !== 'code') continue;
        await this._runCell(id);
        // Stop on the first failure, like Jupyter's "Run All" — continuing
        // past a broken cell produces cascades of derivative errors that
        // obscure the real one.
        const last = view.cell.outputs[view.cell.outputs.length - 1];
        if (last?.outputType === 'error') break;
      }
    } finally {
      this._runningAll = false;
      this._interruptBtn.disabled = true;
    }
  }

  /**
   * Interrupt, and tell the truth if it does not work.
   *
   * A signal-mode interrupt stops a running computation immediately, but on
   * Windows it cannot wake a thread blocked in `time.sleep`, a socket read, or
   * any other blocking call — that is CPython's behaviour, and Jupyter has it
   * too. Silently leaving the cell spinning after the user pressed Interrupt
   * is the worst possible response, so if nothing has changed shortly after,
   * say so and offer the thing that does work.
   */
  private async _interrupt(): Promise<void> {
    if (!this._kernel) return;
    const runningBefore = [...this._views.values()].filter((v) => v.running).length;
    await this._kernel.interrupt();
    if (runningBefore === 0) return;

    if (this._interruptTimer !== undefined) window.clearTimeout(this._interruptTimer);
    this._interruptTimer = window.setTimeout(() => {
      this._interruptTimer = undefined;
      if (this._torndown) return;
      const stillRunning = [...this._views.values()].some((v) => v.running);
      if (!stillRunning) return;
      this._showBanner(
        'That cell is blocked in a call that cannot be interrupted (a sleep, or waiting on the network). Restarting is the only way out, and every variable is lost.',
        'info',
        { label: 'Restart kernel', run: () => void this._restart() },
      );
    }, 4000);
  }

  private async _restart(): Promise<void> {
    if (!this._kernel) return;

    // Stop Run All BEFORE restarting. The service aborts kernel-side
    // executions, but the pane's own loop would keep feeding the remaining
    // cells straight into the fresh kernel — which has none of the state they
    // depend on, so the user gets a cascade of NameErrors from a restart they
    // asked for.
    this._runningAll = false;
    this._abandonExecutions();
    this._interruptBtn.disabled = true;

    const res = await this._kernel.restart();
    if (!res.ok) {
      this._showBanner(res.error ?? 'Restart failed.', 'error');
      return;
    }
    for (const view of this._views.values()) this._setRunning(view, false);
    this._showBanner('Kernel restarted. Every variable is gone.', 'info');
  }

  // ── Structure ──

  /**
   * THE insert primitive — everything that adds a cell goes through here.
   *
   * Index-based rather than anchored to a neighbouring cell, because the gap
   * strips need to insert at position 0, which "below cell X" cannot express.
   * The DOM position is derived from the cell that ENDS UP after the new one, so
   * this is correct for the head, the tail and the middle without three cases.
   */
  private _insertCellAt(index: number, cellType: CellType): CellView | undefined {
    if (!this._document) return undefined;
    const cells = this._document.cells;
    const at = Math.max(0, Math.min(index, cells.length));

    const cell = createEmptyCell(cellType);
    cells.splice(at, 0, cell);
    const view = this._createCellView(cell);

    const followingId = cells[at + 1]?.id;
    const followingRoot = followingId ? this._views.get(followingId)?.root : undefined;
    if (followingRoot) this._cellList.insertBefore(view.root, followingRoot);
    else this._cellList.appendChild(view.root);

    this._markDirtySelf();
    this._selectedCellId = cell.id;
    this._paintSelection();
    return view;
  }

  private _appendCell(cellType: CellType): void {
    const count = this._document?.cells.length ?? 0;
    this._insertCellAt(count, cellType)?.editor.focus();
  }

  private _insertCellBelow(cellId: string, cellType: CellType): void {
    const index = this._document?.cells.findIndex((c) => c.id === cellId) ?? -1;
    if (index < 0) return;
    this._insertCellAt(index + 1, cellType)?.editor.focus();
  }

  private _deleteCell(cellId: string): void {
    if (!this._document) return;
    // Never leave the notebook with nothing to type into.
    if (this._document.cells.length <= 1) {
      const view = this._views.get(cellId);
      if (view) {
        view.cell.source = '';
        view.cell.outputs = [];
        view.cell.executionCount = null;
        view.editor.setValue('');
        // Repaint the prompt too — clearing executionCount without this leaves
        // a stale [7] beside a cell that is now empty and has never run.
        view.promptEl.textContent = this._promptFor(view.cell);
        this._renderOutputs(view);
        this._doc?.markDirty(false);
      }
      return;
    }
    const index = this._document.cells.findIndex((c) => c.id === cellId);
    if (index < 0) return;
    this._document.cells.splice(index, 1);
    const view = this._views.get(cellId);
    view?.editor.dispose();
    view?.root.remove();
    this._views.delete(cellId);
    this._markDirtySelf();
  }

  private _moveCell(cellId: string, delta: number): void {
    if (!this._document) return;
    const cells = this._document.cells;
    const index = cells.findIndex((c) => c.id === cellId);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= cells.length) return;
    const [cell] = cells.splice(index, 1);
    cells.splice(target, 0, cell);

    const view = this._views.get(cellId);
    if (!view) return;
    const anchorId = cells[target + (delta > 0 ? -1 : 1)]?.id;
    const anchor = anchorId ? this._views.get(anchorId)?.root : undefined;
    if (delta > 0 && anchor?.nextSibling) this._cellList.insertBefore(view.root, anchor.nextSibling);
    else if (delta > 0) this._cellList.appendChild(view.root);
    else if (anchor) this._cellList.insertBefore(view.root, anchor);
    this._markDirtySelf();
  }

  private _convertCell(cellId: string): void {
    if (!this._document) return;
    const view = this._views.get(cellId);
    if (!view) return;

    const cell = view.cell;
    const next: CellType = cell.cellType === 'code' ? 'markdown' : 'code';
    // Outputs belong to code; carrying them onto a markdown cell would write
    // a notebook the schema does not allow.
    const replacement = createEmptyCell(next);
    replacement.id = cell.id;
    replacement.source = cell.source;
    replacement.metadata = cell.metadata;
    replacement.unknownFields = cell.unknownFields;

    const index = this._document.cells.findIndex((c) => c.id === cellId);
    this._document.cells[index] = replacement;

    const fresh = this._createCellView(replacement);
    this._cellList.insertBefore(fresh.root, view.root);
    view.editor.dispose();
    view.root.remove();
    this._markDirtySelf();
  }

  // ── Generate ──

  /**
   * Insert a code cell at `index` and ask what to put in it.
   *
   * The cell is created FIRST, before the model is even consulted, so the prompt
   * bar appears in the place the generated code will land. Asking in a floating
   * dialog and inserting afterwards would mean the user cannot see which two
   * cells they are writing between, which is the whole reason they clicked that
   * particular gap.
   */
  private _startGenerate(index: number): void {
    const view = this._insertCellAt(index, 'code');
    if (view) this._openGeneratePrompt(view);
  }

  /** Toolbar Generate: act on the selected cell, or add one if there is none. */
  private _generateForSelection(): void {
    const selected = this._selectedCellId ? this._views.get(this._selectedCellId) : undefined;
    if (selected && selected.cell.cellType === 'code') {
      this._openGeneratePrompt(selected);
      return;
    }
    this._startGenerate(this._document?.cells.length ?? 0);
  }

  /**
   * Mount the prompt bar in a cell's box.
   *
   * Also reachable on an existing cell, where the cell's current source is sent
   * as something to rewrite rather than a blank slate — so this doubles as
   * "change this cell" without a second UI.
   */
  private _openGeneratePrompt(view: CellView): void {
    if (view.box.querySelector('.nb-generate')) {
      view.box.querySelector<HTMLInputElement>('.nb-generate__input')?.focus();
      return;
    }
    // Opening a prompt anywhere else retires the previous one — see _activePrompt.
    if (this._activePrompt && this._activePrompt.cellId !== view.cell.id) {
      this._activePrompt.dismiss();
    }

    const bar = $('div');
    bar.className = 'nb-generate';

    const spark = $('span');
    spark.className = 'nb-generate__spark';
    spark.innerHTML = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">'
      + '<path d="M8 2.5 9.3 6l3.5 1.3L9.3 8.6 8 12.1 6.7 8.6 3.2 7.3 6.7 6z" fill="currentColor"/></svg>';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'nb-generate__input';
    input.placeholder = view.cell.source.trim()
      ? 'How should this cell change?'
      : `Describe the ${this._language} you want…`;

    const status = $('span');
    status.className = 'nb-generate__status';

    const submit = document.createElement('button');
    submit.type = 'button';
    submit.className = 'nb-generate__go';
    submit.textContent = 'Generate';

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'nb-generate__close';
    close.title = 'Cancel (Esc)';
    close.textContent = '✕';

    bar.append(spark, input, status, submit, close);
    view.box.insertBefore(bar, view.box.firstChild);

    let streaming = false;

    /** Take the bar down, and the cell too if generating was the only reason it existed. */
    const dismiss = (): void => {
      this._cancelGeneration();
      this._forgetPrompt(view.cell.id);
      bar.remove();
      if (!view.cell.source.trim() && (this._document?.cells.length ?? 0) > 1) {
        this._deleteCell(view.cell.id);
      } else if (!this._torndown) {
        view.editor.focus();
      }
    };

    const go = async (): Promise<void> => {
      if (streaming) { this._cancelGeneration(); return; }
      const instruction = input.value.trim();
      if (!instruction) { input.focus(); return; }

      streaming = true;
      input.disabled = true;
      submit.textContent = 'Stop';
      status.textContent = 'Thinking…';
      status.classList.add('nb-generate__status--live');

      const outcome = await this._generateInto(view, instruction, (note) => {
        status.textContent = note;
      });

      streaming = false;
      status.classList.remove('nb-generate__status--live');
      if (outcome.ok) {
        this._forgetPrompt(view.cell.id);
        bar.remove();
        if (!this._torndown) view.editor.focus();
      } else {
        // Leave the bar up with the reason in it: the prompt is still there to
        // retry, and a failure that vanishes teaches the user nothing.
        input.disabled = false;
        submit.textContent = 'Generate';
        status.textContent = outcome.error;
        status.classList.add('nb-generate__status--error');
      }
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); void go(); }
      else if (e.key === 'Escape') { e.preventDefault(); dismiss(); }
      status.classList.remove('nb-generate__status--error');
    });
    submit.addEventListener('click', () => void go());
    close.addEventListener('click', dismiss);

    this._activePrompt = { cellId: view.cell.id, dismiss };
    input.focus();
  }

  private _forgetPrompt(cellId: string): void {
    if (this._activePrompt?.cellId === cellId) this._activePrompt = undefined;
  }

  /**
   * Stream a model reply into a cell's editor.
   *
   * Written through `setValueAsEdit` rather than `setValue` so the normal
   * change path runs: the cell's `source` tracks what is on screen and the tab
   * goes dirty. That also means an interrupted generation leaves behind exactly
   * the partial code the user watched arrive — it is theirs to keep or clear,
   * not something that silently rolls back.
   */
  private async _generateInto(
    view: CellView,
    instruction: string,
    onStatus: (note: string) => void,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    if (!this._resolveGenerateProvider) {
      return { ok: false, error: 'Generate needs the desktop app.' };
    }

    let provider: INotebookGenerateProvider | undefined;
    try {
      provider = await this._resolveGenerateProvider();
    } catch {
      provider = undefined;
    }
    if (!provider) {
      return { ok: false, error: 'No language model is available. Open the Chat panel and select one.' };
    }
    if (this._torndown) return { ok: false, error: 'Notebook closed.' };

    // Everything above this cell has already run in the kernel; that is the
    // context the model needs. See generatePrompt.ts.
    const cells = this._document?.cells ?? [];
    const index = cells.findIndex((c) => c.id === view.cell.id);
    const messages = buildGenerateMessages({
      instruction,
      preceding: index <= 0 ? [] : cells.slice(0, index),
      language: this._language,
      existing: view.cell.source,
    });

    this._cancelGeneration();
    const abort = new AbortController();
    let raw = '';
    const flush = rafThrottle(() => {
      if (this._torndown || abort.signal.aborted) return;
      // Re-derive from the whole buffer each frame: a chunk boundary can fall
      // inside a ``` marker, so only the full text is unambiguous.
      view.editor.setValueAsEdit(stripCodeFences(raw));
    });
    this._generation = { abort, flush };

    try {
      let sawText = false;
      for await (const chunk of provider.sendChatRequest(messages, { temperature: 0.2 }, abort.signal)) {
        if (abort.signal.aborted || this._torndown) break;
        if (!chunk.content) continue;
        raw += chunk.content;
        if (!sawText) { sawText = true; onStatus('Writing…'); }
        flush();
      }
      flush.flush();

      if (abort.signal.aborted) {
        return raw.trim()
          ? { ok: true }                                     // partial code kept
          : { ok: false, error: 'Cancelled.' };
      }
      if (!stripCodeFences(raw).trim()) {
        return { ok: false, error: 'The model returned nothing. Try rephrasing.' };
      }
      return { ok: true };
    } catch (err) {
      if (abort.signal.aborted) return { ok: false, error: 'Cancelled.' };
      const message = err instanceof Error ? err.message : 'Request failed.';
      return { ok: false, error: message };
    } finally {
      flush.dispose();
      if (this._generation?.abort === abort) this._generation = undefined;
    }
  }

  /**
   * Abort the in-flight stream. Deliberately does NOT retire the prompt bar:
   * `_generateInto` calls this before every run to clear the previous stream,
   * and a failed run has to leave its bar up with the reason in it.
   */
  private _cancelGeneration(): void {
    if (!this._generation) return;
    this._generation.abort.abort();
    this._generation.flush.dispose();
    this._generation = undefined;
  }

  private _clearOutputs(): void {
    if (!this._document) return;
    clearAllOutputs(this._document);
    for (const view of this._views.values()) {
      // Timing describes a run whose outputs are now gone; leaving "1.4s"
      // beside an unrun cell would be a lie.
      setCellExecutionTiming(view.cell, null, null);
      view.promptEl.textContent = this._promptFor(view.cell);
      this._renderOutputs(view);
      this._paintTiming(view);
    }
    this._doc?.markDirty(false);
  }

  // ── Banner ──

  private _showBanner(message: string, kind: 'info' | 'error', action?: { label: string; run: () => void }): void {
    this._banner.replaceChildren();
    this._banner.className = `nb-banner nb-banner--${kind}`;
    this._banner.hidden = false;
    const text = $('span');
    text.textContent = message;
    this._banner.appendChild(text);
    if (action) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'nb-btn nb-btn--primary';
      btn.textContent = action.label;
      btn.addEventListener('click', action.run);
      this._banner.appendChild(btn);
    }
  }

  private _hideBanner(): void {
    this._banner.hidden = true;
    this._banner.replaceChildren();
  }

  private _paintStatus(status: IKernelStatus): void {
    this._statusDot.className = `nb-status__dot nb-status__dot--${status.state}`;
    const label: Record<string, string> = {
      'not-started': 'No kernel',
      starting: 'Starting…',
      idle: `Ready${status.pythonVersion ? ' · Python ' + status.pythonVersion : ''}`,
      busy: 'Running…',
      dead: 'Kernel stopped',
    };
    this._statusText.textContent = label[status.state] ?? status.state;
    if (status.state !== 'busy') this._interruptBtn.disabled = !this._runningAll;
  }

  // ── Copy support ──

  /** Plain-text form of the whole notebook's outputs, for diagnostics. */
  outputsAsText(): string {
    if (!this._document) return '';
    return this._document.cells
      .flatMap((cell) => cell.outputs.map(outputToText))
      .filter(Boolean)
      .join('\n');
  }

  // ── Lifecycle ──

  private _disposeViews(): void {
    for (const view of this._views.values()) {
      view.editor.dispose();
      view.root.remove();
    }
    this._views.clear();
    // Rebuild the insert-at-top zone: it is a child of the list, so clearing
    // the list takes it with the cells.
    if (this._cellList) this._cellList.replaceChildren(this._createGap(null));
  }

  /**
   * Abandon every in-flight execution.
   *
   * Disposing an execution settles its `completed` promise as 'abort', which
   * lets the parked `_executeCell` finish and release its listeners. The
   * kernel keeps running the cell — that is deliberate and matches Jupyter,
   * where closing a tab does not kill your computation — but this pane stops
   * listening, so nothing writes into a document it no longer owns.
   */
  private _abandonExecutions(): void {
    for (const execution of this._liveExecutions) execution.dispose();
    this._liveExecutions.clear();
  }

  protected override clearPaneContent(): void {
    this._torndown = true;
    this._cancelGeneration();
    this._activePrompt = undefined;
    this._abandonExecutions();
    this._inputListeners.clear();
    this._disposeViews();
    this._document = undefined;
    this._doc = undefined;
    this._selectedCellId = null;
    this._runningAll = false;
    this._hideBanner();
  }

  override focus(): void {
    const id = this._selectedCellId ?? this._document?.cells[0]?.id;
    if (id) this._views.get(id)?.editor.focus();
  }

  protected override savePaneViewState(): EditorPaneViewState {
    return { scrollTop: this._cellList?.scrollTop ?? 0, selectedCellId: this._selectedCellId };
  }

  protected override restorePaneViewState(state: EditorPaneViewState): void {
    if (this._cellList && typeof state['scrollTop'] === 'number') {
      this._cellList.scrollTop = state['scrollTop'];
    }
    if (typeof state['selectedCellId'] === 'string') {
      this._selectedCellId = state['selectedCellId'];
      this._paintSelection();
    }
  }

  override dispose(): void {
    this._torndown = true;
    this._cancelGeneration();
    this._activePrompt = undefined;
    this._abandonExecutions();
    this._flushRenders.dispose();
    if (this._interruptTimer !== undefined) window.clearTimeout(this._interruptTimer);
    this._inputListeners.dispose();
    this._disposeViews();
    super.dispose();
  }
}

export type { IDisposable };
