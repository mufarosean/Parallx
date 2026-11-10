// findSurface.ts — the one Find surface (Ctrl+F), IFindService's implementation.
//
// A small floating bar over the top right of the editor in front: the field,
// the count, previous and next, the three query toggles, and a switch between
// "This Document" and whatever wider scopes tools have registered (the Search
// tool's Workspace). A scope draws its own results under the field.

import './findSurface.css';
import type { IDisposable } from '../platform/lifecycle.js';
import { ServiceCollection } from '../services/serviceCollection.js';
import { IEditorGroupService } from '../services/serviceTypes.js';
import type { IFindScope, IFindService } from '../services/findService.js';
import { domFindTarget, type FindCount, type FindOptions, type IFindTarget } from '../ui/findTargets.js';
import { addDisposableListener } from '../ui/dom.js';
import { createBlock, createIconButton, createInput, createSegmented, createSurface, type IKitInput, type IKitSegmented } from '../ui/kit.js';

const DOCUMENT = 'document';
const TYPING_PAUSE_MS = 140;

interface IFindablePane { readonly element?: HTMLElement; getFindTarget?(): IFindTarget | undefined }

export class FindSurface implements IFindService {
  private readonly _scopes: IFindScope[] = [];
  private _root: HTMLElement | undefined;
  private _field!: IKitInput;
  private _input!: HTMLInputElement;
  private _count!: HTMLElement;
  private _scopeHost!: HTMLElement;
  private _body!: HTMLElement;
  private _switch: IKitSegmented | undefined;
  private _toggles: { key: keyof FindOptions; button: HTMLButtonElement }[] = [];

  private _open = false;
  private _scopeId = DOCUMENT;
  private _options: { caseSensitive: boolean; wholeWord: boolean; useRegex: boolean } = { caseSensitive: false, wholeWord: false, useRegex: false };
  private _target: IFindTarget | undefined;
  private _targetCount: IDisposable | undefined;
  private _mounted: IDisposable | undefined;
  private _watch: IDisposable[] = [];
  private _timer: ReturnType<typeof setTimeout> | undefined;
  private _returnFocus: HTMLElement | null = null;

  constructor(private readonly _services: ServiceCollection) {}

  // ── IFindService ──

  registerScope(scope: IFindScope): IDisposable {
    this._scopes.push(scope);
    if (this._open) this._drawSwitch();
    return {
      dispose: () => {
        const i = this._scopes.indexOf(scope);
        if (i < 0) return;
        this._scopes.splice(i, 1);
        if (!this._open) return;
        if (this._scopeId === scope.id) this._setScope(DOCUMENT);
        this._drawSwitch();
      },
    };
  }

  open(scopeId?: string): void {
    this._build();
    const wasOpen = this._open;
    if (!wasOpen) {
      const active = document.activeElement;
      this._returnFocus = active instanceof HTMLElement ? active : null;
      // What is selected is what the reader most likely wants to find.
      const picked = window.getSelection()?.toString() ?? '';
      if (picked && picked.length <= 120 && !picked.includes('\n')) this._field.value = picked;
      this._open = true;
      this._root!.hidden = false;
      this._watchEditors();
    }
    this._place();
    this._retarget();
    const wanted = scopeId && this._scopes.some((s) => s.id === scopeId) ? scopeId : undefined;
    this._setScope(wanted ?? (wasOpen ? this._scopeId : DOCUMENT));
    this._drawSwitch();
    this._input.focus();
    this._input.select();
  }

  close(): void {
    if (!this._open) return;
    this._open = false;
    if (this._timer) clearTimeout(this._timer);
    this._dropTarget();
    this._mounted?.dispose();
    this._mounted = undefined;
    for (const d of this._watch.splice(0)) d.dispose();
    this._root!.hidden = true;
    if (this._returnFocus?.isConnected) this._returnFocus.focus();
    this._returnFocus = null;
  }

  step(delta: 1 | -1): void {
    if (this._open) this._step(delta);
  }

  toggleOption(option: keyof FindOptions): void {
    if (!this._open || !(option in this._options)) return;
    this._options[option] = !this._options[option];
    this._paintToggles();
    this._run();
  }

  // ── The bar ──

  private _build(): void {
    if (this._root) return;
    const root = createBlock(document.body, 'div', { className: 'find-surface', attrs: { role: 'search', 'aria-label': 'Find' } });
    root.hidden = true;
    createSurface(root, { id: 'find', owner: 'core', label: 'Find' });
    this._root = root;

    const top = createBlock(root, 'div', { className: 'find-surface-row' });
    this._field = createInput(top, { id: 'find.query', label: 'Find', placeholder: 'Find' });
    this._input = this._field.element.querySelector('input') as HTMLInputElement;
    this._count = createBlock(top, 'span', { className: 'find-surface-count', attrs: { role: 'status' } });
    createIconButton(top, { id: 'find.previous', icon: 'arrow-up', title: 'Previous Match (Shift+Enter)', size: 'sm', command: 'edit.findPrevious' });
    createIconButton(top, { id: 'find.next', icon: 'arrow-down', title: 'Next Match (Enter)', size: 'sm', command: 'edit.findNext' });
    createIconButton(top, { id: 'find.close', icon: 'x', title: 'Close (Escape)', size: 'sm', command: 'edit.findClose' });

    const second = createBlock(root, 'div', { className: 'find-surface-row find-surface-row--options' });
    this._scopeHost = createBlock(second, 'div', { className: 'find-surface-scope' });
    const toggles = createBlock(second, 'div', { className: 'find-surface-toggles' });
    const toggle = (key: keyof FindOptions, icon: string, title: string): void => {
      this._toggles.push({ key, button: createIconButton(toggles, { id: `find.${key}`, icon, title, size: 'sm', command: 'edit.findToggleOption', args: [key] }) });
    };
    toggle('caseSensitive', 'case-sensitive', 'Match Case');
    toggle('wholeWord', 'whole-word', 'Match Whole Word');
    toggle('useRegex', 'regex', 'Use Regular Expression');
    this._paintToggles();

    this._body = createBlock(root, 'div', { className: 'find-surface-body' });

    addDisposableListener(this._input, 'input', () => {
      if (this._timer) clearTimeout(this._timer);
      this._timer = setTimeout(() => this._run(), TYPING_PAUSE_MS);
    });
    addDisposableListener(root, 'keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(); }
      else if (e.key === 'Enter' && e.target === this._input) { e.preventDefault(); this._step(e.shiftKey ? -1 : 1); }
      else if (e.key === 'F3') { e.preventDefault(); this._step(e.shiftKey ? -1 : 1); }
    });
    addDisposableListener(window, 'resize', () => { if (this._open) this._place(); });
  }

  private _paintToggles(): void {
    for (const { key, button } of this._toggles) {
      button.setAttribute('aria-pressed', String(this._options[key]));
      button.classList.toggle('find-surface-toggle--on', this._options[key]);
    }
  }

  /** The switch between this document and the registered scopes; hidden when there is one choice. */
  private _drawSwitch(): void {
    this._switch?.dispose();
    this._switch = undefined;
    const items = [...(this._target ? [{ value: DOCUMENT, label: 'This Document' }] : []), ...this._scopes.map((s) => ({ value: s.id, label: s.label }))];
    if (items.length < 2) return;
    this._switch = createSegmented(this._scopeHost, { id: 'find.scope', items, value: this._scopeId, ariaLabel: 'Search in', onChange: (v) => { this._setScope(v); this._input.focus(); } });
  }

  /** Over the top right corner of the editor in front. */
  private _place(): void {
    const pane = this._pane()?.element ?? document.querySelector<HTMLElement>('[data-part-id="workbench.parts.editor"]');
    const rect = pane?.getBoundingClientRect();
    // Computed layout dimensions.
    this._root!.style.top = `${Math.round((rect?.top ?? 40) + 8)}px`;
    this._root!.style.right = `${Math.round(Math.max(8, window.innerWidth - (rect?.right ?? window.innerWidth) + 16))}px`;
  }

  // ── What is searched ──

  private _pane(): IFindablePane | undefined {
    const groups = this._services.has(IEditorGroupService) ? this._services.get(IEditorGroupService) : undefined;
    return groups?.activeGroup?.activePane as IFindablePane | undefined;
  }

  private _dropTarget(): void {
    this._targetCount?.dispose();
    this._targetCount = undefined;
    this._target?.clear();
    this._target = undefined;
  }

  /** Point at the editor now in front. */
  private _retarget(): void {
    this._dropTarget();
    const pane = this._pane();
    this._target = pane?.getFindTarget?.() ?? (pane?.element ? domFindTarget(pane.element) : undefined);
    this._targetCount = this._target?.onDidChangeCount?.((c) => { if (this._scopeId === DOCUMENT) this._showCount(c); });
  }

  private _watchEditors(): void {
    const groups = this._services.has(IEditorGroupService) ? this._services.get(IEditorGroupService) : undefined;
    if (!groups) return;
    let pane: IDisposable | undefined;
    const changed = (): void => {
      if (!this._open) return;
      this._place();
      this._retarget();
      if (this._scopeId === DOCUMENT && !this._target && this._scopes[0]) this._setScope(this._scopes[0].id);
      this._drawSwitch();
      if (this._scopeId === DOCUMENT) this._run();
    };
    const follow = (): void => {
      pane?.dispose();
      pane = groups.activeGroup?.onDidActivePaneChange(changed);
    };
    follow();
    this._watch.push(groups.onDidActiveGroupChange(() => { follow(); changed(); }), { dispose: () => pane?.dispose() });
  }

  private _setScope(id: string): void {
    const scope = this._scopes.find((s) => s.id === id);
    // No document to search: fall to the first wider scope, if a tool gave one.
    const next = scope ? id : this._target || !this._scopes[0] ? DOCUMENT : this._scopes[0].id;
    this._mounted?.dispose();
    this._mounted = undefined;
    this._scopeId = next;
    if (this._switch && this._switch.value !== next) this._switch.value = next;
    const active = this._scopes.find((s) => s.id === next);
    this._root!.classList.toggle('find-surface--wide', !!active);
    this._count.textContent = '';
    if (active) {
      this._target?.clear();
      this._mounted = active.mount(this._body, (summary) => { if (this._scopeId === active.id) this._count.textContent = summary; });
    }
    this._run();
  }

  private _run(): void {
    if (!this._open) return;
    const query = this._field.value;
    const scope = this._scopes.find((s) => s.id === this._scopeId);
    if (scope) { scope.search(query, { ...this._options }); return; }
    if (!this._target) { this._count.textContent = query ? 'Nothing to search here' : ''; return; }
    this._showCount(this._target.find(query, { ...this._options }));
  }

  private _step(delta: 1 | -1): void {
    if (this._timer) { clearTimeout(this._timer); this._timer = undefined; this._run(); }
    const scope = this._scopes.find((s) => s.id === this._scopeId);
    if (scope) { scope.step?.(delta); return; }
    if (this._target) this._showCount(this._target.step(delta));
  }

  private _showCount(count: FindCount | undefined): void {
    if (!count) return; // it comes later
    this._count.textContent = count.total ? `${count.current} of ${count.total}` : this._field.value ? 'No results' : '';
    this._root!.classList.toggle('find-surface--none', !count.total && !!this._field.value);
  }
}
