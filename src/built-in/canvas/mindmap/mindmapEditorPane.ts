// mindmapEditorPane.ts — the board pane: a thin host around the whiteboard
// engine, plus the app's own doors into it.
//
// The 2026-08-31 pivot (Mufaro: "think Zoom Whiteboard, optimized for AI +
// LaTeX — the bespoke card editor thinks too small"): the surface is now
// Excalidraw, embedded the way Univer is for worksheets — a separate engine
// bundle (dist/renderer/mindmap-board.js) dynamic-imported on first open,
// with shapes, sticky-style notes, arrows, freehand, text styling, images,
// selection and undo all owned by the engine.
//
// What THIS file owns is what the engine cannot know:
//   • page identity (title rename, the mindmaps row, debounced persistence
//     with a change guard so scrolling never writes);
//   • the AI door — Draft With AI with the grounded source picker; the
//     model's outline becomes skeleton elements the engine materialises;
//   • migration — v1 card documents open as board elements, once.
//
// jsdom cannot mount the engine, so `loadBoardHost` is injectable; tests
// drive the pane against a recorder host.

import './mindmap.css';
import type { IDisposable } from '../../../platform/lifecycle.js';
import { getIcon } from '../../../ui/iconRegistry.js';
import { attachPopupDismiss } from '../../../ui/dom.js';
import type { MindmapDataService } from './mindmapDataService.js';
import type { BoardHostModule, IBoardHost, BoardEnvelope } from './boardTypes.js';
import {
  boardOutlineText,
  outlineToSkeletons,
  boardLabels,
  serializeBoardEnvelope,
  toBoardEnvelope,
} from './boardConvert.js';
import type { MindmapOutlineEdge, MindmapOutlineNode } from './mindmapModel.js';

// ── The AI draft contract (shared with ai/mindmapTools.ts) ──────────────────

export interface MindmapDraftRequest {
  readonly pageId: string;
  readonly title: string;
  /** The current board as an outline, so the model extends rather than repeats. */
  readonly outlineText: string;
  readonly instruction: string;
  /** Grounding: the document the user picked in the popover. When present,
   *  its text travels inside the prompt and the rules forbid inventing
   *  concepts that are not in it. */
  readonly sourceTitle?: string;
  readonly sourceText?: string;
}

export interface MindmapDraftResult {
  readonly nodes: readonly MindmapOutlineNode[];
  readonly edges?: readonly MindmapOutlineEdge[];
}

export interface MindmapEditorDeps {
  readonly service: MindmapDataService;
  /** Open a workspace page (reserved for element links). */
  readonly openPage?: (pageId: string) => void;
  /** The editor door of the AI draft (D3: both doors, one implementation).
   *  Undefined until the chat tool's LM provider is available. */
  readonly draftWithAI?: (req: MindmapDraftRequest) => Promise<MindmapDraftResult>;
  /** Title search over workspace pages — the popover's source picker. */
  readonly searchPages?: (query: string) => Promise<ReadonlyArray<{ id: string; title: string }>>;
  /** A page's content as plain text (markdown) for grounding. */
  readonly getPageText?: (pageId: string) => Promise<string | null>;
  /** Engine loader — defaults to the built bundle; injectable for tests. */
  readonly loadBoardHost?: () => Promise<BoardHostModule>;
}

const SAVE_DEBOUNCE_MS = 900;

// ── Engine bundle loader (the Univer discipline) ────────────────────────────

let _boardModule: Promise<BoardHostModule> | null = null;

function loadBoardModule(): Promise<BoardHostModule> {
  if (_boardModule) return _boardModule;
  const cssId = 'mindmap-board-css';
  if (!document.getElementById(cssId)) {
    const link = document.createElement('link');
    link.id = cssId;
    link.rel = 'stylesheet';
    link.href = new URL('dist/renderer/mindmap-board.css', document.baseURI).href;
    document.head.appendChild(link);
  }
  // Runtime-computed specifier so esbuild cannot inline the engine here.
  const jsUrl = new URL('dist/renderer/mindmap-board.js', document.baseURI).href;
  _boardModule = import(/* webpackIgnore: true */ jsUrl) as Promise<BoardHostModule>;
  return _boardModule;
}

// ── The pane ────────────────────────────────────────────────────────────────

export class MindmapEditorPane implements IDisposable {
  private readonly _root: HTMLElement;
  private readonly _titleInput: HTMLInputElement;
  private readonly _hintEl: HTMLElement;
  private readonly _draftBtn: HTMLButtonElement;
  private readonly _boardContainer: HTMLElement;

  private _host: IBoardHost | null = null;
  private _loaded = false;
  private _dirty = false;
  private _selfSave = false;
  private _lastSavedJson = '';
  private _saveTimer: ReturnType<typeof setTimeout> | null = null;
  private _hintTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly _disposables: IDisposable[] = [];
  private _disposed = false;

  constructor(
    container: HTMLElement,
    private readonly _pageId: string,
    private readonly _deps: MindmapEditorDeps,
  ) {
    this._root = el('div', 'mm-editor');
    container.appendChild(this._root);

    // ── Header: icon · title · the AI door ──
    const header = el('div', 'mm-editor__header');
    const iconEl = el('span', 'mm-editor__icon');
    iconEl.innerHTML = getIcon('waypoints') ?? '';
    header.appendChild(iconEl);

    this._titleInput = el('input', 'mm-editor__title') as HTMLInputElement;
    this._titleInput.placeholder = 'Untitled Board';
    this._titleInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); this._titleInput.blur(); }
    });
    this._titleInput.addEventListener('blur', () => { void this._commitTitle(); });
    header.appendChild(this._titleInput);

    const toolbar = el('div', 'mm-editor__toolbar');
    this._draftBtn = this._toolButton('Draft With AI', 'bolt', () => this._openDraftPopover());
    toolbar.appendChild(this._draftBtn);
    header.appendChild(toolbar);
    this._root.appendChild(header);

    this._hintEl = el('div', 'mm-editor__hint');
    this._root.appendChild(this._hintEl);

    this._boardContainer = el('div', 'mm-editor__canvas');
    this._root.appendChild(this._boardContainer);

    this._disposables.push(this._deps.service.onDidChangeDoc((e) => {
      if (e.pageId !== this._pageId || this._selfSave) return;
      // Another writer (the chat AI tools, another window). A clean editor
      // follows; a dirty one keeps local truth — its save is queued.
      if (!this._dirty) void this._remount();
    }));

    void this._load();
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    if (this._saveTimer) { clearTimeout(this._saveTimer); this._saveTimer = null; }
    if (this._hintTimer) { clearTimeout(this._hintTimer); this._hintTimer = null; }
    if (this._dirty) void this._flushSave();
    for (const d of this._disposables) d.dispose();
    this._host?.destroy();
    this._host = null;
    this._root.remove();
  }

  // ── Loading ─────────────────────────────────────────────────────────────

  private async _load(): Promise<void> {
    const [page, data] = await Promise.all([
      this._deps.service.getPage(this._pageId),
      this._deps.service.getData(this._pageId),
    ]);
    if (this._disposed) return;
    this._titleInput.value = page?.title ?? '';

    const envelope = toBoardEnvelope(data);
    this._lastSavedJson = data ?? '';

    let module: BoardHostModule;
    try {
      module = await (this._deps.loadBoardHost ?? loadBoardModule)();
    } catch (err) {
      this._showHint('The board engine failed to load — restart the app and try again.');
      console.error('[Mindmap] board bundle load failed:', err);
      return;
    }
    if (this._disposed) return;

    this._host = module.createBoardHost({
      container: this._boardContainer,
      initialElements: envelope.elements,
      initialFiles: envelope.files,
      pending: envelope.pending,
      theme: document.documentElement.dataset.theme === 'light' ? 'light' : 'dark',
      onChange: () => this._scheduleSave(),
    });
    this._loaded = true;

    if (envelope.elements.length === 0 && envelope.pending.length === 0) {
      this._showHint('Draw freely — or Draft With AI to map a page of your notes.');
    }
  }

  private async _remount(): Promise<void> {
    if (!this._loaded) return;
    this._host?.destroy();
    this._host = null;
    this._loaded = false;
    await this._load();
  }

  // ── Persistence — debounced, with a change guard ────────────────────────

  private _scheduleSave(): void {
    if (!this._loaded || this._disposed) return;
    this._dirty = true;
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => { void this._flushSave(); }, SAVE_DEBOUNCE_MS);
  }

  private async _flushSave(): Promise<void> {
    if (this._saveTimer) { clearTimeout(this._saveTimer); this._saveTimer = null; }
    if (!this._dirty || !this._host) return;
    const scene = this._host.getScene();
    const envelope: BoardEnvelope = {
      engine: 'excalidraw',
      version: 1,
      elements: scene.elements,
      files: scene.files,
      pending: [],
    };
    const json = serializeBoardEnvelope(envelope);
    this._dirty = false;
    // The engine reports scroll/zoom as changes too; identical content is
    // not a write.
    if (json === this._lastSavedJson) return;
    this._selfSave = true;
    try {
      await this._deps.service.saveData(this._pageId, json, 'user');
      this._lastSavedJson = json;
    } catch (err) {
      this._dirty = true; // local truth holds; the next change retries
      this._showHint('Saving failed — your board is held in this pane and will retry.');
      console.warn('[Mindmap] save failed:', err);
    } finally {
      this._selfSave = false;
    }
  }

  private async _commitTitle(): Promise<void> {
    const title = this._titleInput.value.trim();
    if (!title) {
      const page = await this._deps.service.getPage(this._pageId);
      this._titleInput.value = page?.title ?? '';
      return;
    }
    try { await this._deps.service.renameMindmap(this._pageId, title); }
    catch { /* cosmetic here; the sidebar path can retry */ }
  }

  // ── The AI door ─────────────────────────────────────────────────────────

  private _currentEnvelope(): BoardEnvelope {
    const scene = this._host?.getScene();
    return {
      engine: 'excalidraw',
      version: 1,
      elements: scene?.elements ?? [],
      files: scene?.files ?? {},
      pending: [],
    };
  }

  private _openDraftPopover(): void {
    if (!this._deps.draftWithAI) {
      this._showHint('AI drafting needs the chat tool active — or ask in chat: "map this topic".');
      return;
    }
    const existing = this._root.querySelector('.mm-draft-popover');
    if (existing) { existing.remove(); return; }

    const pop = el('div', 'mm-draft-popover');
    const ta = el('textarea', 'mm-draft-popover__input') as HTMLTextAreaElement;
    ta.rows = 3;
    ta.placeholder = 'What should be drawn onto this board?';
    pop.appendChild(ta);

    // ── Source picker: ground the draft in a document's actual content ──
    let source: { id: string; title: string } | null = null;
    const sourceRow = el('div', 'mm-draft-popover__source');
    const sourceInput = el('input', 'mm-draft-popover__source-input') as HTMLInputElement;
    sourceInput.placeholder = 'Ground in a page (search by title)…';
    const results = el('div', 'mm-draft-popover__results');
    const chip = el('div', 'mm-draft-popover__chip');
    chip.style.display = 'none';
    const setSource = (next: { id: string; title: string } | null): void => {
      source = next;
      results.textContent = '';
      chip.textContent = '';
      if (next) {
        sourceInput.style.display = 'none';
        chip.style.display = '';
        const icon = el('span', 'mm-draft-popover__chip-icon');
        icon.innerHTML = getIcon('page') ?? '';
        chip.appendChild(icon);
        chip.appendChild(el('span', undefined, next.title));
        const clear = el('button', 'mm-draft-popover__chip-clear', '×') as HTMLButtonElement;
        clear.title = 'Remove Source';
        clear.addEventListener('click', () => { setSource(null); sourceInput.focus(); });
        chip.appendChild(clear);
      } else {
        sourceInput.style.display = '';
        chip.style.display = 'none';
      }
    };
    let searchTimer: ReturnType<typeof setTimeout> | null = null;
    sourceInput.addEventListener('input', () => {
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        const q = sourceInput.value.trim();
        if (!q || !this._deps.searchPages) { results.textContent = ''; return; }
        void this._deps.searchPages(q).then((pages) => {
          results.textContent = '';
          for (const pg of pages.slice(0, 6)) {
            if (pg.id === this._pageId) continue; // a board is not its own source
            const row = el('button', 'mm-draft-popover__result', pg.title || 'Untitled') as HTMLButtonElement;
            row.addEventListener('click', () => setSource(pg));
            results.appendChild(row);
          }
        });
      }, 150);
    });
    sourceInput.addEventListener('keydown', (e) => e.stopPropagation());
    if (this._deps.searchPages && this._deps.getPageText) {
      sourceRow.appendChild(sourceInput);
      sourceRow.appendChild(chip);
      sourceRow.appendChild(results);
      pop.appendChild(sourceRow);
    }

    const go = el('button', 'mm-btn mm-btn--primary', 'Draft') as HTMLButtonElement;
    pop.appendChild(go);
    this._root.appendChild(pop);

    const detach = attachPopupDismiss([pop, this._draftBtn], () => pop.remove());
    const run = async (): Promise<void> => {
      const instruction = ta.value.trim();
      if (!instruction) return;
      const picked = source;
      detach();
      pop.remove();
      await this._runDraft(instruction, picked);
    };
    go.addEventListener('click', () => { void run(); });
    ta.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void run(); }
    });
    ta.focus();
  }

  private async _runDraft(instruction: string, source: { id: string; title: string } | null = null): Promise<void> {
    if (!this._deps.draftWithAI || !this._host) return;
    this._draftBtn.disabled = true;
    this._draftBtn.classList.add('is-busy');
    this._showHint(source ? `Reading "${source.title}" and drafting…` : 'Drafting…');
    try {
      let sourceText: string | undefined;
      if (source && this._deps.getPageText) {
        sourceText = (await this._deps.getPageText(source.id)) ?? undefined;
        if (!sourceText?.trim()) {
          this._showHint(`"${source.title}" has no readable content — drafting without it.`);
          sourceText = undefined;
        }
      }
      const envelope = this._currentEnvelope();
      const result = await this._deps.draftWithAI({
        pageId: this._pageId,
        title: this._titleInput.value.trim() || 'Untitled Board',
        outlineText: boardOutlineText(envelope),
        instruction,
        sourceTitle: source?.title,
        sourceText,
      });
      if (this._disposed) return;
      const skeletons = outlineToSkeletons(result.nodes, result.edges ?? [], boardLabels(envelope));
      if (skeletons.length === 0) {
        this._showHint('The draft added nothing new.');
        return;
      }
      this._host.addSkeletons(skeletons);
      this._showHint(`Drew ${skeletons.length} elements.`);
    } catch (err) {
      this._showHint(err instanceof Error ? err.message : 'Drafting failed.');
    } finally {
      this._draftBtn.disabled = false;
      this._draftBtn.classList.remove('is-busy');
    }
  }

  // ── Hint pill ───────────────────────────────────────────────────────────

  private _showHint(text: string): void {
    this._hintEl.textContent = text;
    this._hintEl.classList.add('is-visible');
    if (this._hintTimer) clearTimeout(this._hintTimer);
    this._hintTimer = setTimeout(() => {
      this._hintTimer = null;
      this._hintEl.classList.remove('is-visible');
    }, 5000);
  }

  private _toolButton(label: string, icon: string, onClick: () => void): HTMLButtonElement {
    const btn = el('button', 'mm-btn') as HTMLButtonElement;
    const ic = el('span', 'mm-btn__icon');
    ic.innerHTML = getIcon(icon) ?? '';
    btn.appendChild(ic);
    btn.appendChild(el('span', undefined, label));
    btn.addEventListener('click', onClick);
    return btn;
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
