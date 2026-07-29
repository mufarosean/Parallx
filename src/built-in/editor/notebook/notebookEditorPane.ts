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
  type CellType,
  type NotebookCell,
  type NotebookDocument,
  type NotebookOutput,
} from './notebookModel.js';
import type {
  INotebookKernelService,
  IKernelStatus,
} from '../../../services/notebookKernelService.js';

/** Beyond this many outputs on one cell, older ones are folded away. */
const MAX_RENDERED_OUTPUTS = 50;

/**
 * Cap on the merged stdout/stderr text held for one cell — roughly 2 MB.
 * Bounds both the repaint cost and what gets written into the `.ipynb`; a
 * runaway loop should not produce a 200 MB notebook file.
 */
const MAX_STREAM_CHARS = 2_000_000;

interface CellView {
  readonly cell: NotebookCell;
  readonly root: HTMLElement;
  readonly editor: CodeEditor;
  readonly outputHost: HTMLElement;
  readonly promptEl: HTMLElement;
  readonly markdownHost: HTMLElement;
  /** Per-cell timing line: live while running, final duration after. */
  readonly timingEl: HTMLElement;
  /** Markdown cells render preview unless being edited. */
  editing: boolean;
  running: boolean;
  /** Set by clear_output(wait=True): drop existing outputs at the next write. */
  pendingClear: boolean;
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

  constructor(private readonly _kernel?: INotebookKernelService) {
    super(NotebookEditorPane.PANE_ID);
  }

  // ── Chrome ──

  protected override createPaneContent(container: HTMLElement): void {
    container.classList.add('nb-pane');

    this._toolbar = $('div');
    this._toolbar.className = 'nb-toolbar';

    const button = (label: string, title: string, onClick: () => void, variant?: string): HTMLButtonElement => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `nb-btn${variant ? ' nb-btn--' + variant : ''}`;
      btn.textContent = label;
      btn.title = title;
      btn.addEventListener('click', onClick);
      this._toolbar.appendChild(btn);
      return btn;
    };

    button('Run all', 'Run every cell in order', () => void this._runAll(), 'primary');
    this._interruptBtn = button('Interrupt', 'Stop the running cell', () => void this._interrupt());
    this._interruptBtn.disabled = true;
    button('Restart', 'Restart the kernel — all variables are lost', () => void this._restart());
    button('Clear outputs', 'Remove every output in this notebook', () => this._clearOutputs());
    button('+ Code', 'Add a code cell at the end', () => this._appendCell('code'));
    button('+ Markdown', 'Add a markdown cell at the end', () => this._appendCell('markdown'));

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
    container.appendChild(this._cellList);
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

  private async _checkReadiness(): Promise<void> {
    if (!this._kernel) return;
    const readiness = await this._kernel.checkReadiness();
    if (readiness.ready) { this._hideBanner(); return; }

    if (readiness.reason === 'NO_ENV') {
      this._showBanner(
        'This workspace has no Python environment yet. Create one in Settings › Python to run cells.',
        'info',
      );
    } else if (readiness.reason === 'MISSING_IPYKERNEL') {
      // Offer the fix inline rather than sending the user to go find it.
      this._showBanner('Running notebooks needs the ipykernel package in this workspace.', 'info', {
        label: 'Install ipykernel',
        run: async () => {
          this._showBanner('Installing ipykernel — this takes a minute…', 'info');
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

    const editorHost = $('div');
    editorHost.className = 'nb-cell__editor';
    body.appendChild(editorHost);

    const markdownHost = $('div');
    markdownHost.className = 'nb-cell__markdown';
    markdownHost.hidden = true;
    body.appendChild(markdownHost);

    const timingEl = $('div');
    timingEl.className = 'nb-cell__timing';
    timingEl.hidden = true;
    body.appendChild(timingEl);

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
      ],
    });

    const view: CellView = {
      cell, root, editor, outputHost, promptEl, markdownHost, timingEl,
      editing: cell.cellType !== 'markdown' || cell.source.trim() === '',
      running: false,
      pendingClear: false,
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
    root.append(gutter, body, actions);

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
    (view.editor.element as HTMLElement).hidden = !editing;
    view.markdownHost.hidden = editing;
    if (!editing) {
      view.markdownHost.replaceChildren(
        view.cell.source.trim()
          ? renderMarkdown(view.cell.source)
          : this._placeholder('Empty markdown cell — double-click to edit'),
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
   * Append one output, merging consecutive stream chunks.
   *
   * The kernel emits a `stream` message per flush, which for a loop printing a
   * line at a time is one message per line. Storing each as its own output
   * would bloat the saved `.ipynb` enormously and render as hundreds of
   * separate blocks; Jupyter merges them, and a file written here has to look
   * like a file written there.
   */
  private _appendOutput(view: CellView, output: NotebookOutput): void {
    if (view.pendingClear) {
      view.cell.outputs = [];
      view.pendingClear = false;
    }
    const last = view.cell.outputs[view.cell.outputs.length - 1];
    if (output.outputType === 'stream' && last?.outputType === 'stream' && last.name === output.name) {
      last.text += output.text;
      // Merging is what keeps the saved .ipynb sane, but it also means
      // MAX_RENDERED_OUTPUTS — a cap on output COUNT — pins at 1 and stops
      // protecting anything. Bound the bytes too, keeping the tail: when a
      // loop has printed a million lines, the end is the part you need.
      if (last.text.length > MAX_STREAM_CHARS) {
        const dropped = last.text.length - MAX_STREAM_CHARS;
        last.text = `[… ${dropped.toLocaleString()} earlier characters dropped …]\n`
          + last.text.slice(-MAX_STREAM_CHARS);
      }
    } else {
      view.cell.outputs.push(output);
    }
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
      if (wait) { target.pendingClear = true; return; }
      target.cell.outputs = [];
      this._renderOutputs(target);
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
        'That cell is blocked in a call that cannot be interrupted (a sleep, or waiting on the network). Restarting is the only way out — every variable is lost.',
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
    this._showBanner('Kernel restarted — every variable is gone.', 'info');
  }

  // ── Structure ──

  private _appendCell(cellType: CellType): void {
    if (!this._document) return;
    const cell = createEmptyCell(cellType);
    this._document.cells.push(cell);
    this._cellList.appendChild(this._createCellView(cell).root);
    this._doc?.markDirty(true);
    this._views.get(cell.id)?.editor.focus();
  }

  private _insertCellBelow(cellId: string, cellType: CellType): void {
    if (!this._document) return;
    const index = this._document.cells.findIndex((c) => c.id === cellId);
    if (index < 0) return;
    const cell = createEmptyCell(cellType);
    this._document.cells.splice(index + 1, 0, cell);
    const view = this._createCellView(cell);
    const anchor = this._views.get(cellId)?.root;
    if (anchor?.nextSibling) this._cellList.insertBefore(view.root, anchor.nextSibling);
    else this._cellList.appendChild(view.root);
    this._doc?.markDirty(true);
    this._selectedCellId = cell.id;
    this._paintSelection();
    view.editor.focus();
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
    this._doc?.markDirty(true);
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
    this._doc?.markDirty(true);
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
    this._doc?.markDirty(true);
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
    this._cellList?.replaceChildren();
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
    this._abandonExecutions();
    if (this._interruptTimer !== undefined) window.clearTimeout(this._interruptTimer);
    this._inputListeners.dispose();
    this._disposeViews();
    super.dispose();
  }
}

export type { IDisposable };
