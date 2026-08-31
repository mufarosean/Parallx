// mindmapEditorPane.ts — the full-pane mindmap editor (docs/MINDMAP_BRIEF.md).
//
// The bar this pane is measured against, from the brief: "if making a
// five-node map takes longer than typing five bullets, the feature failed."
// So the whole editing loop is outliner keys on top of the shared node
// canvas: double-click to add or edit, Tab commits-and-adds a child, Enter
// commits-and-adds a sibling, drag to move, Delete to remove — and every
// gesture is exactly ONE undo entry.
//
// Division of labour:
//   ui/nodeCanvas.ts   — geometry and gesture (pan/zoom/drag/connect/select);
//   mindmapModel.ts    — the document, placement and layout rules;
//   this file          — keyboard semantics, editing, undo, save, toolbar.
//
// The AI door honours the brief's core rule: a draft merges through
// mergeOutline + layoutNewNodes, which can add but can NEVER move a node the
// user has placed. Only the user's own Auto Layout button repositions.

import './mindmap.css';
import type { IDisposable } from '../../../platform/lifecycle.js';
import { getIcon } from '../../../ui/iconRegistry.js';
import { createDropdownHandle, type IDropdownHandle } from '../../../ui/dropdown.js';
import { attachPopupDismiss } from '../../../ui/dom.js';
import { NodeCanvas, type NodeCanvasSelection } from '../../../ui/nodeCanvas.js';
import type { MindmapDataService } from './mindmapDataService.js';
import {
  assignBranchColors,
  autoLayout,
  emptyMindmapDoc,
  layoutNewNodes,
  mergeOutline,
  newId,
  parseMindmapDoc,
  placeChild,
  placeFloating,
  primaryParent,
  serializeMindmapDoc,
  docToOutlineText,
  MINDMAP_COLORS,
  type MindmapColor,
  type MindmapDoc,
  type MindmapOutlineEdge,
  type MindmapOutlineNode,
} from './mindmapModel.js';
import { renderMindmapSvg } from './mindmapSvg.js';

// ── Dependencies injected by canvas/main.ts ─────────────────────────────────

export interface MindmapDraftRequest {
  readonly pageId: string;
  readonly title: string;
  /** The current map as an outline, so the model extends rather than repeats. */
  readonly outlineText: string;
  readonly instruction: string;
}

export interface MindmapDraftResult {
  readonly nodes: readonly MindmapOutlineNode[];
  readonly edges?: readonly MindmapOutlineEdge[];
}

export interface MindmapEditorDeps {
  readonly service: MindmapDataService;
  /** Open a workspace page (a node's ref click-through). */
  readonly openPage: (pageId: string) => void;
  /** The editor door of the AI draft (D3: both doors, one implementation).
   *  Undefined until the chat tool's LM provider is available. */
  readonly draftWithAI?: (req: MindmapDraftRequest) => Promise<MindmapDraftResult>;
}

const UNDO_LIMIT = 100;
const SAVE_DEBOUNCE_MS = 600;

interface EditingState {
  readonly nodeId: string;
  /** Snapshot to restore on cancel / to push as THE undo entry on commit —
   *  a create-and-type gesture must be one undo step, not two. */
  readonly undoBase: string;
  /** True when the node was created by this gesture (cancel removes it). */
  readonly isNew: boolean;
  textarea: HTMLTextAreaElement | null;
}

export class MindmapEditorPane implements IDisposable {
  private readonly _root: HTMLElement;
  private readonly _titleInput: HTMLInputElement;
  private readonly _hintEl: HTMLElement;
  private readonly _draftBtn: HTMLButtonElement;
  private readonly _canvasHost: HTMLElement;
  private readonly _canvas: NodeCanvas;
  private _colorDropdown: IDropdownHandle | null = null;

  private _doc: MindmapDoc = emptyMindmapDoc('');
  private _loaded = false;
  private _undo: string[] = [];
  private _redo: string[] = [];

  private _editing: EditingState | null = null;
  private _edgeEditorDetach: (() => void) | null = null;

  private _dirty = false;
  private _saveTimer: ReturnType<typeof setTimeout> | null = null;
  private _selfSave = false;
  private _hintTimer: ReturnType<typeof setTimeout> | null = null;
  private _fitRaf: number | null = null;

  private readonly _disposables: IDisposable[] = [];
  private _disposed = false;

  constructor(
    container: HTMLElement,
    private readonly _pageId: string,
    private readonly _deps: MindmapEditorDeps,
  ) {
    this._root = el('div', 'mm-editor');
    this._root.tabIndex = 0;
    container.appendChild(this._root);

    // ── Header: icon · title · toolbar ──
    const header = el('div', 'mm-editor__header');
    const iconEl = el('span', 'mm-editor__icon');
    iconEl.innerHTML = getIcon('waypoints') ?? '';
    header.appendChild(iconEl);

    this._titleInput = el('input', 'mm-editor__title') as HTMLInputElement;
    this._titleInput.placeholder = 'Untitled Mindmap';
    this._titleInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); this._titleInput.blur(); }
      if (e.key === 'Escape') { e.preventDefault(); this._titleInput.blur(); }
    });
    this._titleInput.addEventListener('blur', () => { void this._commitTitle(); });
    header.appendChild(this._titleInput);

    const toolbar = el('div', 'mm-editor__toolbar');
    this._draftBtn = this._toolButton('Draft With AI', 'bolt', () => this._openDraftPopover());
    toolbar.appendChild(this._draftBtn);
    toolbar.appendChild(this._toolButton('Auto Layout', 'refresh', () => this._runAutoLayout()));
    toolbar.appendChild(this._toolButton('Fit', 'fullscreen', () => this._canvas.fitToContent()));
    toolbar.appendChild(this._toolButton('Copy As SVG', 'duplicate', () => this._copySvg()));

    const colorHost = el('div', 'mm-editor__color');
    this._colorDropdown = createDropdownHandle(colorHost, {
      placeholder: 'Color',
      ariaLabel: 'Node Color',
      items: MINDMAP_COLORS.map((c) => ({
        value: c,
        label: c === 'accent' ? 'Accent' : c.charAt(0).toUpperCase() + c.slice(1),
        swatch: SWATCH_CSS[c],
      })),
    });
    this._disposables.push(this._colorDropdown.onDidChange((value) => {
      this._applyColorToSelection(value as MindmapColor);
    }));
    toolbar.appendChild(colorHost);
    header.appendChild(toolbar);
    this._root.appendChild(header);

    // ── Hint bar: discoverability for the outliner keys (sentence-case prose) ──
    this._hintEl = el('div', 'mm-editor__hint');
    this._root.appendChild(this._hintEl);

    // ── Canvas ──
    this._canvasHost = el('div', 'mm-editor__canvas');
    this._root.appendChild(this._canvasHost);
    this._canvas = new NodeCanvas(this._canvasHost, {
      renderNode: (id, body) => this._renderNode(id, body),
      onMoveNodes: (moves) => this._onNodesMoved(moves),
      onSelectionChange: (sel) => this._onSelectionChange(sel),
      onNodeDoubleClick: (id) => this._beginEdit(id, false),
      onEdgeDoubleClick: (id) => this._beginEdgeLabelEdit(id),
      onCanvasDoubleClick: (pt) => this._addFloatingNode(pt),
      onConnect: (from, to) => this._connect(from, to),
    });

    this._root.addEventListener('keydown', this._onKeyDown);
    this._root.addEventListener('pointerdown', this._onRootPointerDown, true);

    this._disposables.push(this._deps.service.onDidChangeDoc((e) => {
      if (e.pageId !== this._pageId || this._selfSave) return;
      // Another writer (the AI tool, another window). A clean editor follows;
      // a dirty one keeps its local state — its own save is already queued.
      if (!this._dirty) void this._reload({ fit: false });
    }));

    void this._load();
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this._cancelEdit();
    this._closeEdgeEditor();
    if (this._saveTimer) { clearTimeout(this._saveTimer); this._saveTimer = null; }
    if (this._hintTimer) { clearTimeout(this._hintTimer); this._hintTimer = null; }
    if (this._fitRaf !== null) cancelAnimationFrame(this._fitRaf);
    if (this._dirty) void this._flushSave();
    for (const d of this._disposables) d.dispose();
    this._colorDropdown?.dispose();
    this._canvas.dispose();
    this._root.removeEventListener('keydown', this._onKeyDown);
    this._root.removeEventListener('pointerdown', this._onRootPointerDown, true);
    this._root.remove();
  }

  // ── Loading & saving ────────────────────────────────────────────────────

  private async _load(): Promise<void> {
    const [page, doc] = await Promise.all([
      this._deps.service.getPage(this._pageId),
      this._deps.service.getDoc(this._pageId),
    ]);
    if (this._disposed) return;
    this._titleInput.value = page?.title ?? '';
    this._doc = doc ?? emptyMindmapDoc(page?.title ?? '');
    this._loaded = true;
    this._sync();
    this._fitRaf = requestAnimationFrame(() => {
      this._fitRaf = null;
      this._canvas.fitToContent();
    });
    this._root.focus({ preventScroll: true });
  }

  private async _reload(opts: { fit: boolean }): Promise<void> {
    const doc = await this._deps.service.getDoc(this._pageId);
    if (this._disposed || !doc) return;
    this._cancelEdit();
    this._doc = doc;
    this._sync();
    if (opts.fit) this._canvas.fitToContent();
  }

  private _scheduleSave(): void {
    if (!this._loaded) return;
    this._dirty = true;
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => { void this._flushSave(); }, SAVE_DEBOUNCE_MS);
  }

  private async _flushSave(): Promise<void> {
    if (this._saveTimer) { clearTimeout(this._saveTimer); this._saveTimer = null; }
    if (!this._dirty) return;
    this._dirty = false;
    this._selfSave = true;
    try {
      await this._deps.service.saveDoc(this._pageId, this._doc, 'user');
    } catch (err) {
      this._dirty = true; // keep local truth; the next edit retries
      this._showHint('Saving failed — your changes are held in this pane. It will retry on the next edit.');
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
    catch { /* rename is cosmetic here; the sidebar path can retry */ }
  }

  // ── The single mutation pipeline ────────────────────────────────────────

  /** Apply a document change as ONE undo entry, re-render, queue a save. */
  private _apply(next: MindmapDoc, opts: { undoBase?: string } = {}): void {
    this._undo.push(opts.undoBase ?? serializeMindmapDoc(this._doc));
    if (this._undo.length > UNDO_LIMIT) this._undo.shift();
    this._redo = [];
    this._doc = next;
    this._sync();
    this._scheduleSave();
  }

  private _sync(): void {
    this._canvas.setModel(
      this._doc.nodes.map((n) => ({ id: n.id, x: n.x, y: n.y })),
      this._doc.edges.map((e) => ({ id: e.id, from: e.from, to: e.to, label: e.label })),
    );
    this._updateHint();
  }

  private _undoStep(): void {
    const prev = this._undo.pop();
    if (prev === undefined) return;
    this._cancelEdit();
    this._redo.push(serializeMindmapDoc(this._doc));
    this._doc = parseMindmapDoc(prev);
    this._sync();
    this._scheduleSave();
  }

  private _redoStep(): void {
    const next = this._redo.pop();
    if (next === undefined) return;
    this._cancelEdit();
    this._undo.push(serializeMindmapDoc(this._doc));
    this._doc = parseMindmapDoc(next);
    this._sync();
    this._scheduleSave();
  }

  // ── Node rendering (NodeCanvas delegate) ────────────────────────────────

  private _renderNode(id: string, body: HTMLElement): void {
    const node = this._doc.nodes.find((n) => n.id === id);
    if (!node) return;
    body.className = `px-node-canvas__node-body mm-node mm-node--${node.color}`;
    body.textContent = '';

    if (this._editing?.nodeId === id) {
      const ta = el('textarea', 'mm-node__edit') as HTMLTextAreaElement;
      ta.value = node.label;
      ta.rows = 1;
      ta.addEventListener('keydown', (e) => this._onEditKeyDown(e));
      ta.addEventListener('input', () => autosize(ta));
      ta.addEventListener('blur', () => {
        // Blur commits (the app-wide inline-rename standard) — unless the
        // edit was already resolved by a key.
        if (this._editing?.textarea === ta) this._commitEdit(null);
      });
      body.appendChild(ta);
      this._editing.textarea = ta;
      requestAnimationFrame(() => { autosize(ta); ta.focus(); ta.select(); });
      return;
    }

    const label = el('div', 'mm-node__label');
    label.textContent = node.label || ' ';
    body.appendChild(label);

    if (node.ref) {
      const ref = el('button', 'mm-node__ref');
      ref.dataset.ncNoDrag = '';
      ref.title = 'Open Linked Page';
      ref.innerHTML = getIcon('page') ?? '';
      ref.addEventListener('click', (e) => {
        e.stopPropagation();
        this._deps.openPage(node.ref!.id);
      });
      body.appendChild(ref);
    }
  }

  // ── Editing gestures ────────────────────────────────────────────────────

  private _beginEdit(nodeId: string, isNew: boolean, undoBase?: string): void {
    if (this._editing) this._commitEdit(null);
    this._closeEdgeEditor();
    const node = this._doc.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    this._editing = {
      nodeId,
      isNew,
      undoBase: undoBase ?? serializeMindmapDoc(this._doc),
      textarea: null,
    };
    this._canvas.setSelection([nodeId], []);
    this._canvas.refreshNode(nodeId);
  }

  /** `then` says what the resolving key wants next: a sibling, a child, or rest. */
  private _commitEdit(then: 'sibling' | 'child' | null): void {
    const editing = this._editing;
    if (!editing) return;
    const value = (editing.textarea?.value ?? '').replace(/\s+$/g, '');
    this._editing = null;

    const node = this._doc.nodes.find((n) => n.id === editing.nodeId);
    if (!node) { this._sync(); return; }

    if (!value.trim() && editing.isNew) {
      // A created-then-abandoned node vanishes without an undo entry.
      this._doc = parseMindmapDoc(editing.undoBase);
      this._sync();
      return;
    }

    const label = value.trim() || node.label;
    const changed = label !== node.label || editing.isNew;
    if (changed) {
      const next: MindmapDoc = {
        ...this._doc,
        nodes: this._doc.nodes.map((n) => (n.id === node.id ? { ...n, label } : n)),
      };
      this._apply(next, { undoBase: editing.undoBase });
    } else {
      this._canvas.refreshNode(node.id);
    }

    if (then === 'sibling') this._addSibling(node.id);
    else if (then === 'child') this._addChild(node.id);
    else this._root.focus({ preventScroll: true });
  }

  private _cancelEdit(): void {
    const editing = this._editing;
    if (!editing) return;
    this._editing = null;
    this._doc = parseMindmapDoc(editing.undoBase);
    this._sync();
    this._root.focus({ preventScroll: true });
  }

  private _onEditKeyDown(e: KeyboardEvent): void {
    e.stopPropagation();
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this._commitEdit('sibling');
    } else if (e.key === 'Tab') {
      e.preventDefault();
      this._commitEdit('child');
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this._cancelEdit();
    }
  }

  private _addChild(parentId: string): void {
    const undoBase = serializeMindmapDoc(this._doc);
    const parent = this._doc.nodes.find((n) => n.id === parentId);
    if (!parent) return;
    const spot = placeChild(this._doc, parentId);
    const id = newId();
    const color: MindmapColor = parent.color === 'accent' ? 'neutral' : parent.color;
    this._doc = {
      ...this._doc,
      nodes: [...this._doc.nodes, { id, label: '', x: spot.x, y: spot.y, color, ref: null }],
      edges: [...this._doc.edges, { id: newId(), from: parentId, to: id, label: null }],
    };
    this._sync();
    this._beginEdit(id, true, undoBase);
  }

  private _addSibling(nodeId: string): void {
    const parent = primaryParent(this._doc, nodeId);
    if (parent) {
      this._addChild(parent);
      return;
    }
    const node = this._doc.nodes.find((n) => n.id === nodeId);
    this._addFloatingNode({ x: (node?.x ?? 0), y: (node?.y ?? 0) + 64 });
  }

  private _addFloatingNode(near: { x: number; y: number }): void {
    const undoBase = serializeMindmapDoc(this._doc);
    const spot = placeFloating(this._doc, near);
    const id = newId();
    this._doc = {
      ...this._doc,
      nodes: [...this._doc.nodes, { id, label: '', x: spot.x, y: spot.y, color: 'neutral', ref: null }],
    };
    this._sync();
    this._beginEdit(id, true, undoBase);
  }

  private _deleteSelection(): void {
    const sel = this._canvas.getSelection();
    if (sel.nodes.length === 0 && sel.edges.length === 0) return;
    const nodeSet = new Set(sel.nodes);
    const edgeSet = new Set(sel.edges);
    // Never delete the last node — a map always has somewhere to stand.
    const remaining = this._doc.nodes.filter((n) => !nodeSet.has(n.id));
    if (remaining.length === 0) {
      this._showHint('The last node stays — edit it instead.');
      return;
    }
    this._apply({
      ...this._doc,
      nodes: remaining,
      edges: this._doc.edges.filter(
        (e) => !edgeSet.has(e.id) && !nodeSet.has(e.from) && !nodeSet.has(e.to),
      ),
    });
  }

  private _connect(from: string, to: string): void {
    if (from === to) return;
    if (this._doc.edges.some((e) => e.from === from && e.to === to)) return;
    const edgeId = newId();
    this._apply({
      ...this._doc,
      edges: [...this._doc.edges, { id: edgeId, from, to, label: null }],
    });
    this._canvas.setSelection([], [edgeId]);
  }

  private _onNodesMoved(moves: ReadonlyArray<{ id: string; x: number; y: number }>): void {
    const byId = new Map(moves.map((m) => [m.id, m]));
    this._apply({
      ...this._doc,
      nodes: this._doc.nodes.map((n) => {
        const m = byId.get(n.id);
        return m ? { ...n, x: m.x, y: m.y } : n;
      }),
    });
  }

  private _onSelectionChange(_sel: NodeCanvasSelection): void {
    // Clicking into the canvas ends any label edit (blur handles the textarea
    // itself; this covers selection changes made programmatically).
    if (this._editing && !_sel.nodes.includes(this._editing.nodeId)) this._commitEdit(null);
  }

  // ── Edge label editing ──────────────────────────────────────────────────

  private _beginEdgeLabelEdit(edgeId: string): void {
    this._closeEdgeEditor();
    if (this._editing) this._commitEdit(null);
    const edge = this._doc.edges.find((e) => e.id === edgeId);
    if (!edge) return;
    const from = this._doc.nodes.find((n) => n.id === edge.from);
    const to = this._doc.nodes.find((n) => n.id === edge.to);
    if (!from || !to) return;

    const mid = this._canvas.clientFromWorld((from.x + to.x) / 2, (from.y + to.y) / 2);
    const rootRect = this._root.getBoundingClientRect();
    const input = el('input', 'mm-edge-editor') as HTMLInputElement;
    input.value = edge.label ?? '';
    input.placeholder = 'Relation…';
    input.style.left = `${mid.x - rootRect.left}px`;
    input.style.top = `${mid.y - rootRect.top}px`;
    this._root.appendChild(input);

    let done = false;
    const commit = (): void => {
      if (done) return; // blur and the dismiss contract can both land here
      done = true;
      const label = input.value.trim() || null;
      this._closeEdgeEditor();
      if (label !== edge.label) {
        this._apply({
          ...this._doc,
          edges: this._doc.edges.map((e) => (e.id === edgeId ? { ...e, label } : e)),
        });
      }
      this._root.focus({ preventScroll: true });
    };
    const detachDismiss = attachPopupDismiss(input, commit, { onEscape: () => { done = true; this._closeEdgeEditor(); } });
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
    });
    input.addEventListener('blur', commit);
    this._edgeEditorDetach = () => {
      detachDismiss();
      input.removeEventListener('blur', commit);
      input.remove();
    };
    input.focus();
    input.select();
  }

  private _closeEdgeEditor(): void {
    this._edgeEditorDetach?.();
    this._edgeEditorDetach = null;
  }

  // ── Keyboard (pane root) ────────────────────────────────────────────────

  private readonly _onRootPointerDown = (e: PointerEvent | MouseEvent): void => {
    const target = e.target as HTMLElement;
    if (target.closest('input, textarea, .ui-dropdown')) return;
    this._root.focus({ preventScroll: true });
  };

  private readonly _onKeyDown = (e: KeyboardEvent): void => {
    const target = e.target as HTMLElement;
    // Fields own their keys; buttons own Enter/Space (else Enter on a focused
    // toolbar button would both click it and spawn a sibling node).
    if (target.closest('input, textarea, [contenteditable], button, .ui-dropdown')) return;

    const sel = this._canvas.getSelection();
    const single = sel.nodes.length === 1 ? sel.nodes[0] : null;
    const mod = e.ctrlKey || e.metaKey;

    const handled = ((): boolean => {
      if (mod && !e.shiftKey && e.key.toLowerCase() === 'z') { this._undoStep(); return true; }
      if ((mod && e.shiftKey && e.key.toLowerCase() === 'z') || (mod && e.key.toLowerCase() === 'y')) { this._redoStep(); return true; }
      if (mod && e.key.toLowerCase() === 'a') {
        this._canvas.setSelection(this._doc.nodes.map((n) => n.id), []);
        return true;
      }
      if (e.key === 'Tab' && single) { this._addChild(single); return true; }
      if (e.key === 'Enter' && single) { this._addSibling(single); return true; }
      if (e.key === 'F2' && single) { this._beginEdit(single, false); return true; }
      if ((e.key === 'Delete' || e.key === 'Backspace')) { this._deleteSelection(); return true; }
      if (e.key === 'Escape') {
        if (sel.nodes.length || sel.edges.length) { this._canvas.setSelection([], []); return true; }
        return false; // nothing selected — let the workbench have it
      }
      return false;
    })();

    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  // ── Toolbar actions ─────────────────────────────────────────────────────

  private _runAutoLayout(): void {
    this._cancelEdit();
    this._apply(autoLayout(this._doc));
    this._canvas.fitToContent();
  }

  private _applyColorToSelection(color: MindmapColor): void {
    const sel = this._canvas.getSelection();
    if (sel.nodes.length === 0) {
      this._showHint('Select a node first, then pick a color.');
      return;
    }
    const nodeSet = new Set(sel.nodes);
    this._apply({
      ...this._doc,
      nodes: this._doc.nodes.map((n) => (nodeSet.has(n.id) ? { ...n, color } : n)),
    });
    this._canvas.setSelection(sel.nodes, sel.edges);
  }

  private async _copySvg(): Promise<void> {
    try {
      await navigator.clipboard.writeText(renderMindmapSvg(this._doc));
      this._showHint('SVG copied to the clipboard.');
    } catch {
      this._showHint('Could not reach the clipboard.');
    }
  }

  // ── The AI door ─────────────────────────────────────────────────────────

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
    ta.placeholder = this._doc.nodes.length <= 1
      ? 'What should this map cover?'
      : 'What should be added to this map?';
    const go = el('button', 'mm-btn mm-btn--primary', 'Draft') as HTMLButtonElement;
    pop.appendChild(ta);
    pop.appendChild(go);
    this._root.appendChild(pop);

    const detach = attachPopupDismiss([pop, this._draftBtn], () => pop.remove());
    const run = async (): Promise<void> => {
      const instruction = ta.value.trim();
      if (!instruction) return;
      detach();
      pop.remove();
      await this._runDraft(instruction);
    };
    go.addEventListener('click', () => { void run(); });
    ta.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void run(); }
    });
    ta.focus();
  }

  private async _runDraft(instruction: string): Promise<void> {
    if (!this._deps.draftWithAI) return;
    this._draftBtn.disabled = true;
    this._draftBtn.classList.add('is-busy');
    this._showHint('Drafting…');
    try {
      const result = await this._deps.draftWithAI({
        pageId: this._pageId,
        title: this._titleInput.value.trim() || 'Untitled Mindmap',
        outlineText: docToOutlineText(this._doc),
        instruction,
      });
      if (this._disposed) return;
      const wasEmpty = this._doc.nodes.length <= 1 && this._doc.edges.length === 0;
      const merged = mergeOutline(this._doc, result.nodes, result.edges ?? []);
      if (merged.newNodeIds.length === 0) {
        this._showHint('The draft added nothing new.');
        return;
      }
      // The brief's core rule: a draft may add, only the user repositions —
      // except on an empty map, where the first draft earns a full layout.
      const next = wasEmpty
        ? assignBranchColors(autoLayout(merged.doc))
        : layoutNewNodes(merged.doc, new Set(merged.newNodeIds));
      this._apply(next);
      this._canvas.fitToContent();
      this._showHint(`Added ${merged.newNodeIds.length} node${merged.newNodeIds.length === 1 ? '' : 's'}.`);
    } catch (err) {
      this._showHint(err instanceof Error ? err.message : 'Drafting failed.');
    } finally {
      this._draftBtn.disabled = false;
      this._draftBtn.classList.remove('is-busy');
    }
  }

  // ── Hint bar ────────────────────────────────────────────────────────────

  private _updateHint(): void {
    if (this._hintTimer) return; // a transient message owns the bar right now
    if (this._doc.nodes.length <= 2) {
      this._hintEl.textContent =
        'Double-click to add an idea · Tab adds a child · Enter adds a sibling · drag the dot to connect';
      this._hintEl.classList.add('is-visible');
    } else {
      this._hintEl.classList.remove('is-visible');
    }
  }

  private _showHint(text: string): void {
    this._hintEl.textContent = text;
    this._hintEl.classList.add('is-visible');
    if (this._hintTimer) clearTimeout(this._hintTimer);
    this._hintTimer = setTimeout(() => {
      this._hintTimer = null;
      this._updateHint();
    }, 4000);
  }

  // ── Small builders ──────────────────────────────────────────────────────

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

function autosize(ta: HTMLTextAreaElement): void {
  ta.style.height = 'auto';
  ta.style.height = `${ta.scrollHeight}px`;
}

/** Swatch colors for the dropdown — resolved from tokens at render time. */
const SWATCH_CSS: Record<MindmapColor, string> = {
  neutral: 'var(--px-base-40)',
  red: 'rgb(var(--px-red-rgb))',
  yellow: 'rgb(var(--px-yellow-rgb))',
  green: 'rgb(var(--px-green-rgb))',
  blue: 'rgb(var(--px-blue-rgb))',
  accent: 'var(--px-accent)',
};
