// workflowEditorPane.ts — the workflow editor: the node canvas gets its
// tenant (docs/WORKFLOWS_BRIEF.md, "the editor opens as a pane").
//
// The WorkflowService document on ui/nodeCanvas: a palette adds typed
// nodes, connect gestures (or the inspector's Connect To) make edges, the
// inspector edits the selected node's real fields, and a run picker paints
// a recorded run's trace onto the same graph (the trace view IS the debugger).
// Every mutation writes THROUGH the service at once (no draft to lose);
// trace mode is read-only (gestures refused with a visible hint); nothing
// pops over (inspector and palette are docked).

import { appDateParts, appTimeString } from '../../services/localTime.js';
import './workflowEditor.css';
import type { IDisposable } from '../../platform/lifecycle.js';
import { $ } from '../../ui/dom.js';
import { createIconElement, getIcon } from '../../ui/iconRegistry.js';
import { createDropdownHandle, type IDropdownHandle, type IDropdownItem } from '../../ui/dropdown.js';
import { NodeCanvas } from '../../ui/nodeCanvas.js';
import type { WorkflowService } from '../../services/workflows/workflowService.js';
import {
  isTriggerNode,
  normalizeFactsInclude,
  type WorkflowClass,
  type WorkflowDoc,
  type WorkflowNode,
  type WorkflowRun,
} from '../../services/workflows/workflowTypes.js';
import { validateWorkflow } from '../../services/workflows/workflowGraph.js';
import { KIND_META, PALETTE, connectTargets, nodeSummary, oneLine, type PaletteEntry } from './workflowPalette.js';
import { createList, declareControl, sceneSlug } from '../../ui/kit.js';
import { WEEKDAY_LABELS, type AutomationScheduleSpec } from '../../openclaw/cronScheduleSpec.js';

// ── Node palette (the kind vocabulary as UI) ────────────────────────────────

export interface WorkflowEditorDeps {
  readonly service: WorkflowService;
  /** Available tool names for the tool-action picker (best effort). */
  readonly listTools?: () => readonly { name: string; description: string }[];
  /** Canvas templates for the Format picker. */
  readonly listTemplates?: () => Promise<readonly { id: string; name: string; description: string }[]>;
  /** Workspace pages for the Format picker (title + id). */
  readonly listPages?: () => Promise<readonly { id: string; title: string }[]>;
  /** Installed models for the per-workflow model picker. */
  readonly listModels?: () => Promise<readonly { id: string; displayName: string }[]>;
}

// ── The pane ────────────────────────────────────────────────────────────────

export class WorkflowEditorPane implements IDisposable {
  private readonly _root: HTMLElement;
  private readonly _nameInput: HTMLInputElement;
  private readonly _statusChip: HTMLElement;
  private readonly _hintEl: HTMLElement;
  private readonly _inspector: HTMLElement;
  private readonly _canvasHost: HTMLElement;
  private readonly _enabledBtn: HTMLButtonElement;
  private readonly _runBtn: HTMLButtonElement;
  private _classDropdown!: IDropdownHandle;
  private _runPicker!: IDropdownHandle;

  private _canvas: NodeCanvas | null = null;
  private _doc: WorkflowDoc | null = null;
  /** 'edit' or a run id whose trace is painted. */
  private _mode: string = 'edit';
  private _selectedNodeId: string | null = null;
  private _selectedEdgeId: string | null = null;
  private _selfSave = false;
  private _coachDismissed = false;
  private _hintTimer: ReturnType<typeof setTimeout> | null = null;
  private _nextNodeSeq = 1;
  private readonly _disposables: IDisposable[] = [];
  private _disposed = false;

  constructor(
    container: HTMLElement,
    private readonly _workflowId: string,
    private readonly _deps: WorkflowEditorDeps,
  ) {
    this._root = $('div.wfe');
    container.appendChild(this._root);

    // ── Header ──
    const header = $('div.wfe__header');
    const icon = $('span.wfe__icon');
    icon.innerHTML = getIcon('git-branch');
    header.appendChild(icon);

    this._nameInput = $('input.wfe__name') as HTMLInputElement;
    this._nameInput.placeholder = 'Untitled Routine';
    declareControl(this._nameInput, { id: 'workflows.editor.name', label: 'Routine name', kind: 'input', state: () => ({ kind: 'value', value: this._nameInput.value }) });
    this._nameInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' || e.key === 'Escape') this._nameInput.blur();
    });
    this._nameInput.addEventListener('blur', () => {
      const name = this._nameInput.value.trim();
      if (name && this._doc && name !== this._doc.name) this._commit({ name });
      else if (this._doc) this._nameInput.value = this._doc.name;
    });
    header.appendChild(this._nameInput);

    this._statusChip = $('span.wfe__status');
    header.appendChild(this._statusChip);

    const spacer = $('span.wfe__spacer');
    header.appendChild(spacer);

    // Class — the arbitration contract, always visible.
    const classWrap = $('div.wfe__field');
    classWrap.appendChild(this._fieldLabel('Class'));
    this._classDropdown = createDropdownHandle(classWrap, {
      items: [
        { value: 'quiet', label: 'Quiet' },
        { value: 'attention', label: 'Attention' },
        { value: 'destructive', label: 'Destructive' },
      ],
      ariaLabel: 'Routine class',
    });
    this._disposables.push(this._classDropdown.onDidChange((v) => {
      this._commit({ class: v as WorkflowClass });
    }));
    header.appendChild(classWrap); this._disposables.push(declareControl(this._classDropdown.element, { id: 'workflows.editor.class', label: 'Routine class', kind: 'select', state: () => ({ kind: 'value', value: this._classDropdown.value }) }));

    // Run picker — Editing, or a recorded run whose trace paints the graph.
    const pickerWrap = $('div.wfe__field');
    pickerWrap.appendChild(this._fieldLabel('View'));
    this._runPicker = createDropdownHandle(pickerWrap, {
      items: [{ value: 'edit', label: 'Editing' }],
      selected: 'edit',
      ariaLabel: 'View a recorded run',
    });
    this._disposables.push(this._runPicker.onDidChange((v) => {
      this._mode = v || 'edit';
      this._paintAll();
    }));
    header.appendChild(pickerWrap); this._disposables.push(declareControl(this._runPicker.element, { id: 'workflows.editor.view', label: 'View a recorded run', kind: 'select', state: () => ({ kind: 'value', value: this._runPicker.value }) }));

    this._runBtn = $('button.wfe__btn.wfe__btn--primary') as HTMLButtonElement;
    this._runBtn.textContent = 'Run Now'; this._runBtn.prepend(createIconElement('play', 14));
    declareControl(this._runBtn, { id: 'workflows.editor.runNow', label: 'Run Now' });
    this._runBtn.addEventListener('click', () => { void this._runNow(); });
    header.appendChild(this._runBtn);

    this._enabledBtn = $('button.wfe__btn') as HTMLButtonElement;
    declareControl(this._enabledBtn, { id: 'workflows.editor.enabled', label: 'Enabled', state: () => ({ kind: 'pressed', value: this._doc?.enabled === true }) });
    this._enabledBtn.addEventListener('click', () => {
      if (this._doc) this._commit({ enabled: !this._doc.enabled });
    });
    header.appendChild(this._enabledBtn);

    this._root.appendChild(header);

    this._hintEl = $('div.wfe__hint');
    this._root.appendChild(this._hintEl);

    // ── Body: palette rail · canvas · inspector ──
    const body = $('div.wfe__body');

    const palette = $('div.wfe__palette');
    const palHead = $('div.wfe__palette-head');
    palHead.textContent = 'Add';
    palette.appendChild(palHead);
    let lastFamily = '';
    for (const entry of PALETTE) {
      if (entry.family !== lastFamily) {
        lastFamily = entry.family;
        const fam = $('div.wfe__palette-family');
        fam.textContent = entry.family === 'trigger' ? 'Triggers'
          : entry.family === 'context' ? 'Context'
          : entry.family === 'control' ? 'Control' : 'Actions';
        palette.appendChild(fam);
      }
      const btn = $('button.wfe__palette-item') as HTMLButtonElement;
      declareControl(btn, { id: `workflows.editor.add.${sceneSlug(entry.kind)}`, label: `Add ${entry.label}` });
      btn.appendChild($(`span.wfe__palette-dot.is-${entry.family}`));
      const ic = $('span.wfe__palette-ic');
      ic.innerHTML = getIcon(entry.icon);
      btn.appendChild(ic);
      const label = document.createElement('span');
      label.textContent = entry.label;
      btn.appendChild(label);
      btn.addEventListener('click', () => this._addNode(entry));
      palette.appendChild(btn);
    }
    body.appendChild(palette);

    this._canvasHost = $('div.wfe__canvas');
    // Delete removes the selection; it bubbles here from the canvas and its nodes (the focus stops).
    this._canvasHost.addEventListener('keydown', (e) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const target = e.target as HTMLElement;
      if (target.closest('input, textarea, [contenteditable]')) return;
      e.preventDefault();
      this._deleteSelection();
    });
    body.appendChild(this._canvasHost);

    this._inspector = $('div.wfe__inspector');
    body.appendChild(this._inspector);

    this._root.appendChild(body);

    // External writers (the panel toggling enabled, another editor).
    this._disposables.push(this._deps.service.onDidChangeWorkflows((e) => {
      if (e.workflowId !== this._workflowId && e.kind !== 'bulk') return;
      if (this._selfSave) return;
      this._reload();
    }));

    this._reload(true);
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    if (this._hintTimer) clearTimeout(this._hintTimer);
    for (const d of this._disposables) d.dispose();
    this._canvas?.dispose();
    this._root.remove();
  }

  // ── Document flow ─────────────────────────────────────────────────────────

  private _reload(first = false): void {
    const doc = this._deps.service.getWorkflow(this._workflowId);
    if (!doc) {
      this._root.classList.add('wfe--gone');
      this._canvasHost.textContent = '';
      const gone = $('div.wfe__gone');
      gone.textContent = 'This routine no longer exists.';
      this._canvasHost.appendChild(gone);
      this._canvas?.dispose();
      this._canvas = null;
      this._doc = null;
      return;
    }
    this._doc = doc;
    // Seed the node-id counter past every existing numeric suffix.
    for (const n of doc.nodes) {
      const m = /^n(\d+)$/.exec(n.id);
      if (m) this._nextNodeSeq = Math.max(this._nextNodeSeq, parseInt(m[1], 10) + 1);
    }
    if (!this._canvas) {
      this._canvas = new NodeCanvas(this._canvasHost, {
        renderNode: (id, body) => this._renderNodeCard(id, body),
        onMoveNodes: (moves) => this._onMoveNodes(moves),
        onConnect: (from, to) => this._onConnect(from, to),
        onSelectionChange: (sel) => {
          this._selectedNodeId = sel.nodes[0] ?? null;
          this._selectedEdgeId = sel.edges[0] ?? null;
          this._paintInspector();
        },
        onNodeDoubleClick: () => {
          const labelInput = this._inspector.querySelector('input[data-wfe-label]') as HTMLInputElement | null;
          labelInput?.focus(); labelInput?.select();
        },
      });
      this._disposables.push(createList(this._canvasHost.querySelector<HTMLElement>('.px-node-canvas')!, { id: 'workflows.editor.graph', label: 'Graph', rows: () => Array.from(this._canvasHost.querySelectorAll<HTMLElement>('.px-node-canvas__node')), selected: () => this._canvas?.getSelection().nodes ?? [] }));
    }
    this._paintAll();
    if (first) {
      // The mission is the workflow's centre: open with it selected so
      // the inspector shows the prompt, not an empty state. (After
      // _paintAll — setSelection filters against the RENDERED nodes.)
      const mission = doc.nodes.find((n) => n.kind === 'action.agentTurn');
      if (mission) this._canvas.setSelection([mission.id]);
      // fitToContent needs layout — defer one frame.
      requestAnimationFrame(() => { this._canvas?.fitToContent(); });
    }
  }

  /** Write a patch through the service; surface refusals, never swallow. */
  private _commit(patch: Partial<Omit<WorkflowDoc, 'id' | 'createdAt'>>): void {
    if (!this._doc) return;
    if (this._mode !== 'edit') {
      this._showHint('Viewing a recorded run. Switch View to Editing to change the graph.');
      return;
    }
    this._selfSave = true;
    try {
      this._doc = this._deps.service.updateWorkflow(this._workflowId, patch);
    } catch (err) {
      this._showHint(err instanceof Error ? err.message : String(err));
    } finally {
      this._selfSave = false;
    }
    this._paintAll();
  }

  private _patchNode(nodeId: string, patch: Partial<WorkflowNode>): void {
    if (!this._doc) return;
    const nodes = this._doc.nodes.map((n) => (n.id === nodeId ? ({ ...n, ...patch } as WorkflowNode) : n));
    this._commit({ nodes });
  }

  // ── Graph mutations ───────────────────────────────────────────────────────

  private _addNode(entry: PaletteEntry): void {
    if (!this._doc || !this._canvas) return;
    if (this._mode !== 'edit') {
      this._showHint('Viewing a recorded run. Switch View to Editing to change the graph.');
      return;
    }
    const rect = this._canvasHost.getBoundingClientRect();
    const center = this._canvas.worldFromClient(rect.left + rect.width / 2, rect.top + rect.height / 2);
    // Stagger repeated adds so nodes never stack invisibly.
    const jitter = (this._nextNodeSeq % 5) * 24;
    const id = `n${this._nextNodeSeq++}`;
    const node = entry.make(id, Math.round(center.x - 90 + jitter), Math.round(center.y - 24 + jitter));
    this._commit({ nodes: [...this._doc.nodes, node] });
    this._canvas.setSelection([id]);
    this._selectedNodeId = id;
    this._selectedEdgeId = null;
    this._paintInspector();
  }

  private _onConnect(fromId: string, toId: string): void {
    if (!this._doc) return;
    if (this._mode !== 'edit') {
      this._showHint('Viewing a recorded run. Switch View to Editing to change the graph.');
      return;
    }
    const target = this._doc.nodes.find((n) => n.id === toId);
    if (target && isTriggerNode(target)) {
      this._showHint('Nothing can point into a trigger. Connect from the trigger instead.');
      return;
    }
    if (this._doc.edges.some((e) => e.from === fromId && e.to === toId)) return;
    this._commit({ edges: [...this._doc.edges, { from: fromId, to: toId }] });
  }

  private _onMoveNodes(moves: ReadonlyArray<{ id: string; x: number; y: number }>): void {
    if (!this._doc) return;
    if (this._mode !== 'edit') {
      this._showHint('Viewing a recorded run. Switch View to Editing to change the graph.');
      this._paintCanvas(); // snap back
      return;
    }
    const byId = new Map(moves.map((m) => [m.id, m]));
    const nodes = this._doc.nodes.map((n) => {
      const m = byId.get(n.id);
      return m ? ({ ...n, x: Math.round(m.x), y: Math.round(m.y) } as WorkflowNode) : n;
    });
    this._commit({ nodes });
  }

  private _deleteSelection(): void {
    if (!this._doc) return;
    if (this._mode !== 'edit') {
      this._showHint('Viewing a recorded run. Switch View to Editing to change the graph.');
      return;
    }
    if (this._selectedNodeId) {
      const id = this._selectedNodeId;
      this._selectedNodeId = null;
      this._commit({
        nodes: this._doc.nodes.filter((n) => n.id !== id),
        edges: this._doc.edges.filter((e) => e.from !== id && e.to !== id),
      });
    } else if (this._selectedEdgeId) {
      const idx = this._edgeIndexFromId(this._selectedEdgeId);
      this._selectedEdgeId = null;
      if (idx !== null) {
        this._commit({ edges: this._doc.edges.filter((_, i) => i !== idx) });
      }
    }
    this._paintInspector();
  }

  private _edgeId(index: number): string { return `e${index}`; }
  private _edgeIndexFromId(edgeId: string): number | null {
    const m = /^e(\d+)$/.exec(edgeId);
    return m ? parseInt(m[1], 10) : null;
  }

  // ── Running ───────────────────────────────────────────────────────────────

  private async _runNow(): Promise<void> {
    if (!this._doc) return;
    this._runBtn.disabled = true;
    try {
      const run = await this._deps.service.runNow(this._workflowId);
      // Jump straight to the trace — the run IS the result.
      this._mode = run.id;
      this._paintAll();
      this._runPicker.value = run.id;
    } catch (err) {
      this._showHint(err instanceof Error ? err.message : String(err));
    } finally {
      this._runBtn.disabled = false;
    }
  }

  // ── Painting ──────────────────────────────────────────────────────────────

  private _paintAll(): void {
    if (!this._doc) return;
    this._nameInput.value = this._doc.name;
    this._classDropdown.value = this._doc.class;
    this._enabledBtn.textContent = this._doc.enabled ? 'Disable' : 'Enable';
    this._enabledBtn.classList.toggle('wfe__btn--armed', this._doc.enabled);
    this._paintStatus();
    this._paintRunPicker();
    this._paintCanvas();
    this._paintInspector();
  }

  private _paintStatus(): void {
    if (!this._doc) return;
    const v = validateWorkflow(this._doc);
    this._statusChip.className = 'wfe__status';
    if (v.errors.length > 0) {
      this._statusChip.classList.add('is-error');
      this._statusChip.textContent = v.errors[0];
    } else if (v.isDraft) {
      this._statusChip.classList.add('is-draft');
      this._statusChip.textContent = 'Draft: add a trigger';
    } else if (v.warnings.length > 0) {
      this._statusChip.classList.add('is-warn');
      this._statusChip.textContent = v.warnings.length === 1
        ? v.warnings[0]
        : `${v.warnings.length} things to finish`;
      this._statusChip.title = v.warnings.join('\n');
    } else {
      this._statusChip.classList.add('is-ok');
      this._statusChip.textContent = this._doc.enabled ? 'Armed' : 'Ready, not enabled';
    }
  }

  private _paintRunPicker(): void {
    const runs = this._deps.service.getRuns(this._workflowId);
    const items: IDropdownItem[] = [{ value: 'edit', label: 'Editing' }];
    for (const run of [...runs].reverse().slice(0, 20)) {
      const t = appDateParts(new Date(run.startedAt));
      const hh = String(t.hour).padStart(2, '0');
      const mm = String(t.minute).padStart(2, '0');
      items.push({ value: run.id, label: `${hh}:${mm} · ${run.status}` });
    }
    // Keep the current selection when the run still exists; else fall back.
    const current = this._mode !== 'edit' && runs.some((r) => r.id === this._mode) ? this._mode : 'edit';
    if (current !== this._mode) this._mode = current;
    this._runPicker.setItems(items, current);
  }

  private _currentRun(): WorkflowRun | undefined {
    if (this._mode === 'edit') return undefined;
    return this._deps.service.getRuns(this._workflowId).find((r) => r.id === this._mode);
  }

  private _paintCanvas(): void {
    if (!this._doc || !this._canvas) return;
    this._canvas.setModel(
      this._doc.nodes.map((n) => ({ id: n.id, x: n.x ?? 0, y: n.y ?? 0 })),
      this._doc.edges.map((e, i) => ({ id: this._edgeId(i), from: e.from, to: e.to })),
    );
    const run = this._currentRun();
    this._canvasHost.classList.toggle('wfe__canvas--trace', !!run);
    // Re-render every card so trace classes apply/clear.
    for (const n of this._doc.nodes) this._canvas.refreshNode(n.id);
    this._paintCoach();
  }

  /** Three steps for a first-time builder; gone once the graph grows,
   *  a run exists, or the user dismisses it. */
  private _paintCoach(): void {
    this._canvasHost.querySelector('.wfe__coach')?.remove();
    if (!this._doc || this._coachDismissed || this._mode !== 'edit') return;
    const runs = this._deps.service.getRuns(this._workflowId);
    if (this._doc.nodes.length > 2 || runs.length > 0) return;
    const coach = $('div.wfe__coach');
    const title = $('div.wfe__coach-title');
    title.textContent = 'Build your routine';
    coach.appendChild(title);
    const steps = [
      'Add steps from the rail on the left.',
      'Hover a card and drag its dot onto another card to connect them.',
      'Click a card to set it up, then Enable when it looks right.',
    ];
    steps.forEach((text, i) => {
      const row = $('div.wfe__coach-step');
      const num = $('span.wfe__coach-num');
      num.textContent = String(i + 1);
      row.appendChild(num);
      const t = document.createElement('span');
      t.textContent = text;
      row.appendChild(t);
      coach.appendChild(row);
    });
    const dismiss = $('button.wfe__coach-dismiss') as HTMLButtonElement;
    dismiss.textContent = 'Got It';
    declareControl(dismiss, { id: 'workflows.editor.coach.dismiss', label: 'Got It' });
    dismiss.addEventListener('click', () => {
      this._coachDismissed = true;
      coach.remove();
    });
    coach.appendChild(dismiss);
    this._canvasHost.appendChild(coach);
  }

  private _renderNodeCard(id: string, body: HTMLElement): void {
    const node = this._doc?.nodes.find((n) => n.id === id);
    if (!node) return;
    const meta = KIND_META.get(node.kind);
    body.textContent = '';
    body.classList.add('wfe-card');
    const card = body.closest('.px-node-canvas__node') as HTMLElement | null;
    card?.classList.remove('is-family-trigger', 'is-family-control', 'is-family-action',
      'is-run-ok', 'is-run-error', 'is-run-gated', 'is-run-skipped');
    card?.classList.add(`is-family-${meta?.family ?? 'action'}`);

    const head = $('div.wfe-card__head');
    const ic = $('span.wfe-card__ic');
    ic.innerHTML = getIcon(meta?.icon ?? 'circle');
    head.appendChild(ic);
    const kind = $('span.wfe-card__kind');
    kind.textContent = meta?.label ?? node.kind;
    head.appendChild(kind);
    body.appendChild(head);

    const title = $('div.wfe-card__title');
    title.textContent = node.label;
    body.appendChild(title);

    const sum = $('div.wfe-card__summary');
    sum.textContent = nodeSummary(node);
    body.appendChild(sum);

    const run = this._currentRun();
    if (run) {
      const trace = run.nodes.find((t) => t.nodeId === id);
      const status = trace?.status ?? 'skipped';
      card?.classList.add(`is-run-${status === 'error' ? 'error' : status === 'gated' ? 'gated' : status === 'ok' ? 'ok' : 'skipped'}`);
      const badge = $('div.wfe-card__run');
      badge.textContent = trace
        ? `${trace.status}${trace.summary ? `: ${oneLine(trace.summary, 48)}` : ''}${trace.error ? `: ${oneLine(trace.error, 48)}` : ''}`
        : (isTriggerNode(node) && run.trigger.nodeId === id ? `fired: ${oneLine(run.trigger.summary, 48)}` : 'not reached');
      body.appendChild(badge);
    }
  }

  // ── Inspector ─────────────────────────────────────────────────────────────

  private _paintInspector(): void {
    this._inspector.textContent = '';
    if (!this._doc) return;
    const run = this._currentRun();

    if (run) {
      this._paintTraceInspector(run);
      return;
    }

    const node = this._selectedNodeId
      ? this._doc.nodes.find((n) => n.id === this._selectedNodeId)
      : undefined;

    if (!node && this._selectedEdgeId !== null) {
      const idx = this._edgeIndexFromId(this._selectedEdgeId);
      const edge = idx !== null ? this._doc.edges[idx] : undefined;
      if (edge) {
        this._inspector.appendChild(this._sectionHead('Connection'));
        const from = this._doc.nodes.find((n) => n.id === edge.from);
        const to = this._doc.nodes.find((n) => n.id === edge.to);
        const line = $('div.wfe-ins__line');
        line.textContent = `${from?.label ?? edge.from} → ${to?.label ?? edge.to}`;
        this._inspector.appendChild(line);
        const del = $('button.wfe__btn.wfe__btn--danger') as HTMLButtonElement;
        del.textContent = 'Delete Connection';
        declareControl(del, { id: 'workflows.editor.deleteSelection', label: 'Delete Connection' });
        del.addEventListener('click', () => this._deleteSelection());
        this._inspector.appendChild(del);
      }
      return;
    }

    if (!node) {
      this._paintWorkflowInspector();
      return;
    }

    const meta = KIND_META.get(node.kind);
    this._inspector.appendChild(this._sectionHead(meta?.label ?? node.kind));

    const labelInput = this._textField('Label', node.label, (v) => {
      if (v.trim()) this._patchNode(node.id, { label: v.trim() });
    });
    labelInput.dataset.wfeLabel = '1';

    switch (node.kind) {
      case 'trigger.schedule': this._scheduleFields(node.id, node.spec); break;
      case 'trigger.manual': {
        const note = $('div.wfe-ins__note');
        note.textContent = 'Runs when you press Run Now, here or on the routine’s row in Agents › Routines.';
        this._inspector.appendChild(note);
        break;
      }
      case 'trigger.event': {
        this._textField('Source', node.source ?? '', (v) => this._patchNode(node.id, { source: v.trim() || undefined }),
          'e.g. tool, editor, chat. Empty matches any');
        this._textField('Verb', node.verb ?? '', (v) => this._patchNode(node.id, { verb: v.trim() || undefined }),
          'e.g. created, saved. Empty matches any');
        this._textField('Actor', node.actor ?? '', (v) => this._patchNode(node.id, { actor: v.trim() || undefined }),
          'user, ai, system. Empty matches any');
        break;
      }
      case 'control.cooldown': {
        this._numberField('Hours', node.hours, 0, 24 * 30, (v) => this._patchNode(node.id, { hours: v }));
        this._textField('Ledger Key', node.key ?? '', (v) => this._patchNode(node.id, { key: v.trim() || undefined }),
          'routines sharing a key share the cooldown');
        break;
      }
      case 'context.facts': {
        const note = $('div.wfe-ins__note');
        note.textContent = 'Injects live app facts above the mission: connect this into an Agent Turn.';
        this._inspector.appendChild(note);
        const inc = normalizeFactsInclude(node.include);
        const all = inc.schedule === undefined && inc.activity === undefined && inc.sync === undefined && inc.pages === undefined;
        const opts: Array<{ key: 'schedule' | 'activity' | 'sync' | 'pages'; label: string }> = [
          { key: 'schedule', label: 'Schedule: today + open tasks' },
          { key: 'activity', label: 'Recent Activity' },
          { key: 'sync', label: 'Sync Health' },
          { key: 'pages', label: 'Workspace Pages' },
        ];
        for (const opt of opts) {
          const row = $('label.wfe-ins__check') as HTMLLabelElement;
          const box = document.createElement('input');
          box.type = 'checkbox';
          box.checked = all || inc[opt.key] === true;
          box.addEventListener('change', () => {
            const current = node.include ? normalizeFactsInclude(node.include) : { schedule: true, activity: true, sync: true, pages: true };
            this._patchNode(node.id, { include: { ...current, [opt.key]: box.checked } });
          });
          row.appendChild(box);
          const t = document.createElement('span');
          t.textContent = opt.label;
          row.appendChild(t);
          this._inspector.appendChild(row);
        }
        break;
      }
      case 'context.exemplar': {
        const note = $('div.wfe-ins__note');
        note.textContent = 'Injects a page or template as the FORMAT to follow. Connect it into an Agent Turn.';
        this._inspector.appendChild(note);
        this._exemplarPicker(node);
        break;
      }
      case 'action.agentTurn': {
        this._textArea('Mission', node.prompt, (v) => this._patchNode(node.id, { prompt: v }),
          'Write it in language. Name tools by their exact names when it matters; the model orchestrates.', 10);
        this._numberField('Context Messages', node.contextMessages ?? 0, 0, 10,
          (v) => this._patchNode(node.id, { contextMessages: v }), 'recent chat lines to include');
        const prev = $('button.wfe__btn') as HTMLButtonElement;
        prev.textContent = 'Preview Compiled Prompt';
        declareControl(prev, { id: 'workflows.editor.previewPrompt', label: 'Preview Compiled Prompt' });
        prev.addEventListener('click', () => { void this._showCompiledPreview(node.id); });
        this._inspector.appendChild(prev);
        break;
      }
      case 'action.command': {
        this._textField('Command Id', node.commandId, (v) => this._patchNode(node.id, { commandId: v.trim() }));
        this._textArea('Arguments (JSON Array)', JSON.stringify(node.args ?? []), (v) => {
          try {
            const parsed = JSON.parse(v || '[]');
            if (!Array.isArray(parsed)) throw new Error('not an array');
            this._patchNode(node.id, { args: parsed });
          } catch {
            this._showHint('Arguments must be a JSON array, e.g. ["pageId", 2].');
          }
        });
        break;
      }
      case 'action.tool': {
        const tools = this._deps.listTools?.() ?? [];
        if (tools.length > 0) {
          this._dropdownField('Tool', { items: tools.map((t) => ({ value: t.name, label: t.name })), selected: node.toolName || undefined, placeholder: 'Pick a tool', ariaLabel: 'Tool to run' },
            (v) => this._patchNode(node.id, { toolName: v }));
        } else {
          this._textField('Tool Name', node.toolName, (v) => this._patchNode(node.id, { toolName: v.trim() }));
        }
        this._textArea('Arguments (JSON Object)', JSON.stringify(node.args ?? {}), (v) => {
          try {
            const parsed = JSON.parse(v || '{}');
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
            this._patchNode(node.id, { args: parsed });
          } catch {
            this._showHint('Arguments must be a JSON object, e.g. {"query": "..."}.');
          }
        });
        break;
      }
      case 'action.notify': {
        this._textArea('Message', node.message, (v) => this._patchNode(node.id, { message: v }),
          '{{trigger.summary}} and {{event.*}} fill in at run time');
        break;
      }
    }

    const targets = this._doc ? connectTargets(this._doc, node.id) : []; // the keyboard's way to drag a dot onto a card
    if (targets.length > 0 && this._mode === 'edit') {
      this._dropdownField('Connect To', { items: targets, placeholder: 'Pick a node', ariaLabel: 'Connect to' }, (to) => { if (to) this._onConnect(node.id, to); });
    }
    const del = $('button.wfe__btn.wfe__btn--danger') as HTMLButtonElement;
    del.textContent = 'Delete Node';
    declareControl(del, { id: 'workflows.editor.deleteSelection', label: 'Delete Node' });
    del.addEventListener('click', () => this._deleteSelection());
    this._inspector.appendChild(del);
  }

  /** Nothing selected: workflow-level settings (the arbiter's knobs). */
  private _paintWorkflowInspector(): void {
    if (!this._doc) return;
    this._inspector.appendChild(this._sectionHead('Routine'));
    const note = $('div.wfe-ins__note');
    note.textContent = 'Select a node to edit it (Space on a focused node). Drag from a node’s dot, or use Connect To, to connect. Delete removes the selection.';
    this._inspector.appendChild(note);

    this._textArea('Description', this._doc.description ?? '', (v) => {
      this._commit({ description: v.trim() || undefined });
    });
    // Model + context window: Parallx runs local models, so which model
    // serves a workflow, and with how much context, is a per-task choice.
    const modelWrap = $('div.wfe-ins__field');
    modelWrap.appendChild(this._fieldLabel('Model'));
    const modelDd = createDropdownHandle(modelWrap, {
      items: [{ value: '', label: 'Active Model (default)' }],
      selected: this._doc.model ?? '',
      ariaLabel: 'Model for this routine',
    });
    this._inspector.appendChild(modelWrap); this._disposables.push(declareControl(modelDd.element, { id: 'workflows.editor.model', label: 'Model for this routine', kind: 'select', state: () => ({ kind: 'value', value: modelDd.value }) }));
    void (async () => {
      const items: IDropdownItem[] = [{ value: '', label: 'Active Model (default)' }];
      try {
        for (const m of (await this._deps.listModels?.()) ?? []) {
          items.push({ value: m.id, label: m.displayName || m.id });
        }
      } catch { /* picker keeps the default row */ }
      modelDd.setItems(items, this._doc?.model ?? '');
    })();
    this._disposables.push(modelDd.onDidChange((v) => {
      this._commit({ model: v || undefined });
    }));

    this._numberField('Context Window', this._doc.contextWindow ?? 0, 0, 262144,
      (v) => this._commit({ contextWindow: v > 0 ? v : undefined }),
      'tokens (num_ctx); 0 uses the model default. Bigger costs VRAM.');

    this._numberField('Priority', this._doc.priority ?? 0, -9, 9, (v) => this._commit({ priority: v }),
      'higher fires first when several come due together');
    this._mutexField();
  }

  /** Mutex group: short placeholder, the meaning lives in the hint. */
  private _mutexField(): void {
    if (!this._doc) return;
    const wrap = $('div.wfe-ins__field');
    wrap.appendChild(this._fieldLabel('Mutex Group'));
    const input = $('input.wfe-ins__input') as HTMLInputElement;
    input.value = this._doc.mutexGroup ?? '';
    input.placeholder = 'e.g. planner';
    declareControl(input, { id: 'workflows.editor.field.mutex-group', label: 'Mutex Group', kind: 'input', state: () => ({ kind: 'value', value: input.value }) });
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') input.blur();
    });
    input.addEventListener('blur', () => {
      const next = input.value.trim() || undefined;
      if (next !== this._doc?.mutexGroup) this._commit({ mutexGroup: next }); // unchanged: no save, no repaint
    });
    wrap.appendChild(input);
    const h = $('div.wfe-ins__hint');
    h.textContent = 'Routines sharing a group never run at the same time.';
    wrap.appendChild(h);
    this._inspector.appendChild(wrap);
  }

  private _paintTraceInspector(run: WorkflowRun): void {
    this._inspector.appendChild(this._sectionHead('Run'));
    const when = $('div.wfe-ins__line');
    when.textContent = `${appTimeString(new Date(run.startedAt))} · ${run.status}${run.automatic === false ? ' · run manually' : ''}`;
    this._inspector.appendChild(when);
    const trig = $('div.wfe-ins__line');
    trig.textContent = `Trigger: ${run.trigger.summary}`;
    this._inspector.appendChild(trig);
    if (run.error) {
      const err = $('div.wfe-ins__line.is-error');
      err.textContent = run.error;
      this._inspector.appendChild(err);
    }
    const node = this._selectedNodeId ? run.nodes.find((n) => n.nodeId === this._selectedNodeId) : undefined;
    if (node) {
      this._inspector.appendChild(this._sectionHead(node.label));
      const st = $('div.wfe-ins__line');
      st.textContent = `${node.status} · ${node.durationMs}ms`;
      this._inspector.appendChild(st);
      if (node.summary) {
        const sm = $('div.wfe-ins__line');
        sm.textContent = node.summary;
        this._inspector.appendChild(sm);
      }
      if (node.error) {
        const er = $('div.wfe-ins__line.is-error');
        er.textContent = node.error;
        this._inspector.appendChild(er);
      }
    }
    const back = $('button.wfe__btn') as HTMLButtonElement;
    back.textContent = 'Back To Editing';
    declareControl(back, { id: 'workflows.editor.backToEditing', label: 'Back To Editing' });
    back.addEventListener('click', () => {
      this._mode = 'edit';
      this._runPicker.value = 'edit';
      this._paintAll();
    });
    this._inspector.appendChild(back);
  }

  /** Format picker: template dropdown + page dropdown, whichever loads. */
  private _exemplarPicker(node: WorkflowNode & { kind: 'context.exemplar' }): void {
    const wrap = $('div.wfe-ins__field');
    wrap.appendChild(this._fieldLabel('Format Source'));
    const dd = createDropdownHandle(wrap, {
      items: [], placeholder: 'Loading formats\u2026', ariaLabel: 'Format source',
    });
    this._inspector.appendChild(wrap);
    void (async () => {
      const items: IDropdownItem[] = [];
      try {
        for (const t of (await this._deps.listTemplates?.()) ?? []) {
          items.push({ value: `template:${t.id}`, label: `Template \u00b7 ${t.name}` });
        }
      } catch { /* templates unavailable */ }
      try {
        for (const p of ((await this._deps.listPages?.()) ?? []).slice(0, 40)) {
          items.push({ value: `page:${p.id}`, label: `Page \u00b7 ${p.title || 'Untitled'}` });
        }
      } catch { /* pages unavailable */ }
      const current = node.ref?.id ? `${node.ref.kind}:${node.ref.id}` : undefined;
      dd.setItems(items, current);
    })();
    this._disposables.push(dd.onDidChange((v) => {
      const i = v.indexOf(':');
      if (i < 0) return;
      const kind = v.slice(0, i) as 'template' | 'page';
      const id = v.slice(i + 1);
      const items: readonly IDropdownItem[] = [];
      void items;
      this._patchNode(node.id, { ref: { kind, id, name: undefined } });
    }));
  }

  /** Show the mission's compiled prompt: what will actually be sent. */
  private async _showCompiledPreview(nodeId: string): Promise<void> {
    this._inspector.textContent = '';
    this._inspector.appendChild(this._sectionHead('Compiled Prompt'));
    const note = $('div.wfe-ins__note');
    note.textContent = 'Exactly what the agent receives when this fires (context blocks resolved live).';
    this._inspector.appendChild(note);
    const pre = $('div.wfe-ins__preview');
    pre.textContent = 'Compiling\u2026';
    this._inspector.appendChild(pre);
    const back = $('button.wfe__btn') as HTMLButtonElement;
    back.textContent = 'Back';
    declareControl(back, { id: 'workflows.editor.back', label: 'Back' });
    back.addEventListener('click', () => this._paintInspector());
    this._inspector.appendChild(back);
    try {
      pre.textContent = await this._deps.service.compileMissionPreview(this._workflowId, nodeId);
    } catch (err) {
      pre.textContent = err instanceof Error ? err.message : String(err);
    }
  }

  // ── Field helpers ─────────────────────────────────────────────────────────

  private _sectionHead(text: string): HTMLElement {
    const el = $('div.wfe-ins__head');
    el.textContent = text;
    return el;
  }

  /** A labelled dropdown field in the inspector. */
  private _dropdownField(label: string, options: Parameters<typeof createDropdownHandle>[1], onChange: (value: string) => void): void {
    const wrap = $('div.wfe-ins__field');
    wrap.appendChild(this._fieldLabel(label));
    this._disposables.push(createDropdownHandle(wrap, options).onDidChange(onChange));
    this._inspector.appendChild(wrap);
  }

  private _fieldLabel(text: string): HTMLElement {
    const el = $('label.wfe-ins__label');
    el.textContent = text;
    return el;
  }

  private _textField(label: string, value: string, commit: (v: string) => void, hint?: string): HTMLInputElement {
    const wrap = $('div.wfe-ins__field');
    wrap.appendChild(this._fieldLabel(label));
    const input = $('input.wfe-ins__input') as HTMLInputElement;
    declareControl(input, { id: `workflows.editor.field.${sceneSlug(label)}`, label, kind: 'input', hint, state: () => ({ kind: 'value', value: input.value }) });
    input.value = value;
    if (hint) input.placeholder = hint;
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') input.blur();
    });
    input.addEventListener('blur', () => { if (input.value !== value) commit(input.value); });
    wrap.appendChild(input);
    if (hint) {
      const h = $('div.wfe-ins__hint');
      h.textContent = hint;
      wrap.appendChild(h);
    }
    this._inspector.appendChild(wrap);
    return input;
  }

  private _numberField(label: string, value: number, min: number, max: number, commit: (v: number) => void, hint?: string): void {
    const wrap = $('div.wfe-ins__field');
    wrap.appendChild(this._fieldLabel(label));
    const input = $('input.wfe-ins__input') as HTMLInputElement;
    input.type = 'number';
    declareControl(input, { id: `workflows.editor.field.${sceneSlug(label)}`, label, kind: 'input', hint, state: () => ({ kind: 'number', value: Number(input.value) }) });
    input.min = String(min);
    input.max = String(max);
    input.value = String(value);
    input.addEventListener('keydown', (e) => e.stopPropagation());
    input.addEventListener('change', () => {
      const v = Math.max(min, Math.min(max, Math.round(Number(input.value) || 0)));
      input.value = String(v);
      commit(v);
    });
    wrap.appendChild(input);
    if (hint) {
      const h = $('div.wfe-ins__hint');
      h.textContent = hint;
      wrap.appendChild(h);
    }
    this._inspector.appendChild(wrap);
  }

  private _textArea(label: string, value: string, commit: (v: string) => void, hint?: string, rows = 4): void {
    const wrap = $('div.wfe-ins__field');
    wrap.appendChild(this._fieldLabel(label));
    const ta = $('textarea.wfe-ins__textarea') as HTMLTextAreaElement;
    declareControl(ta, { id: `workflows.editor.field.${sceneSlug(label)}`, label, kind: 'input', hint, state: () => ({ kind: 'value', value: ta.value }) });
    ta.value = value;
    ta.rows = rows;
    ta.addEventListener('keydown', (e) => e.stopPropagation());
    ta.addEventListener('blur', () => { if (ta.value !== value) commit(ta.value); });
    wrap.appendChild(ta);
    if (hint) {
      const h = $('div.wfe-ins__hint');
      h.textContent = hint;
      wrap.appendChild(h);
    }
    this._inspector.appendChild(wrap);
  }

  /** The schedule spec as friendly fields (the shared vocabulary). */
  private _scheduleFields(nodeId: string, spec: AutomationScheduleSpec): void {
    const wrap = $('div.wfe-ins__field');
    wrap.appendChild(this._fieldLabel('Repeats'));
    const kindDd = createDropdownHandle(wrap, {
      items: [
        { value: 'daily', label: 'Daily' },
        { value: 'weekly', label: 'Weekly' },
        { value: 'interval', label: 'Every Interval' },
        { value: 'once', label: 'Once' },
        { value: 'cron', label: 'Cron Expression' },
      ],
      selected: spec.kind,
      ariaLabel: 'Schedule kind',
    });
    this._disposables.push(kindDd.onDidChange((v) => {
      const next: AutomationScheduleSpec =
        v === 'daily' ? { kind: 'daily', time: '09:00' }
        : v === 'weekly' ? { kind: 'weekly', day: 1, time: '09:00' }
        : v === 'interval' ? { kind: 'interval', every: '1h' }
        : v === 'once' ? { kind: 'once', at: new Date(Date.now() + 3_600_000).toISOString() }
        : { kind: 'cron', expr: '0 9 * * *' };
      this._patchNode(nodeId, { spec: next });
    }));
    this._inspector.appendChild(wrap);

    switch (spec.kind) {
      case 'daily':
        this._textField('Time (HH:MM)', spec.time, (v) => this._patchNode(nodeId, { spec: { kind: 'daily', time: v.trim() } }));
        break;
      case 'weekly': {
        const dayWrap = $('div.wfe-ins__field');
        dayWrap.appendChild(this._fieldLabel('Day'));
        const dayDd = createDropdownHandle(dayWrap, {
          items: WEEKDAY_LABELS.map((label, i) => ({ value: String(i), label })),
          selected: String(spec.day),
          ariaLabel: 'Weekday',
        });
        this._disposables.push(dayDd.onDidChange((v) => {
          this._patchNode(nodeId, { spec: { kind: 'weekly', day: parseInt(v, 10), time: spec.time } });
        }));
        this._inspector.appendChild(dayWrap);
        this._textField('Time (HH:MM)', spec.time, (v) => this._patchNode(nodeId, { spec: { kind: 'weekly', day: spec.day, time: v.trim() } }));
        break;
      }
      case 'interval':
        this._textField('Every', spec.every, (v) => this._patchNode(nodeId, { spec: { kind: 'interval', every: v.trim() } }),
          'e.g. 30m, 2h, 1d');
        break;
      case 'once':
        this._textField('At (ISO Datetime)', spec.at, (v) => this._patchNode(nodeId, { spec: { kind: 'once', at: v.trim() } }));
        break;
      case 'cron':
        this._textField('Expression', spec.expr, (v) => this._patchNode(nodeId, { spec: { kind: 'cron', expr: v.trim() } }),
          'minute hour day month weekday');
        break;
    }
  }

  // ── Hint pill ─────────────────────────────────────────────────────────────

  private _showHint(text: string): void {
    this._hintEl.textContent = text;
    this._hintEl.classList.add('is-visible');
    if (this._hintTimer) clearTimeout(this._hintTimer);
    this._hintTimer = setTimeout(() => {
      this._hintTimer = null;
      this._hintEl.classList.remove('is-visible');
    }, 6000);
  }
}
