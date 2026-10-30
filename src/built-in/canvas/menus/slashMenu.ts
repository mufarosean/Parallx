// slashMenu.ts — Slash command menu controller (/ trigger)
//
// Extracted from canvasEditorProvider.ts (Phase 0).
// Handles creating the slash menu popup, filtering items by typed text,
// keyboard navigation, and executing the selected command.
//
// "/" opens the menu at the start of a line or after a space mid-line
// (slashMenuQuery.ts has the rule and the ranking). Picked mid-line, an
// inline item replaces the "/query" where it stands; a block item removes
// the "/query" and goes in a new block after the line.

import type { Editor } from '@tiptap/core';
import { $, layoutPopup } from '../../../ui/dom.js';
import {
  svgIcon,
  buildSlashMenuItems,
  rankSlashItems,
  slashQueryAlive,
} from './canvasMenuRegistry.js';
import { inlineMathBeforeCaret, slashInsertRange, slashTriggerAt } from './slashMenuInsert.js';
import type {
  SlashMenuItem,
  ICanvasMenu,
  InsertActionBaseContext,
} from './canvasMenuRegistry.js';
import { createRecentList } from './canvasMenuRegistry.js';
import type { CanvasMenuRegistry } from './canvasMenuRegistry.js';
import type { IDisposable } from '../../../platform/lifecycle.js';

// ── Recently-used items ─────────────────────────────────────────────────────
// Notion-parity ergonomics: when the slash menu opens with no filter typed,
// hoist the user's most-recently inserted block types to the top so common
// gestures stay one keystroke away.  Per-device UI state on par with
// property-bar collapse and the colour palette Recent section.

const _slashRecents = createRecentList('parallx-canvas-slash-recents', 5);

/** Text-only lines inside a block, where the slash menu stays closed. */
const SLASH_FREE_TEXTBLOCKS = new Set(['detailsSummary', 'toggleHeadingText']);

// ── Dependency interface ────────────────────────────────────────────────────

export interface SlashMenuHost {
  readonly editor: Editor | null;
  readonly container: HTMLElement;
  readonly editorContainer: HTMLElement | null;
  readonly dataService?: InsertActionBaseContext['dataService'];
  readonly databaseService?: InsertActionBaseContext['databaseService'];
  readonly pageId?: string;
  readonly openEditor?: InsertActionBaseContext['openEditor'];
  requestSave(reason: string): void;
  /** Toggle the suppress-update flag to prevent re-entrant slash checks. */
  suppressUpdate: boolean;
}

// ── Controller ──────────────────────────────────────────────────────────────

export class SlashMenuController implements ICanvasMenu {
  readonly id = 'slash-menu';
  private _menu: HTMLElement | null = null;
  private _visible = false;
  private _filterText = '';
  /** Position of the "/" whose menu was closed with Esc (null: none). */
  private _dismissedSlash: number | null = null;
  private _selectedIndex = 0;
  private _registration: IDisposable | null = null;

  constructor(
    private readonly _host: SlashMenuHost,
    private readonly _registry: CanvasMenuRegistry,
  ) {}

  /** The menu element (for DOM identity checks). */
  get menu(): HTMLElement | null { return this._menu; }

  /** Whether the slash menu is currently visible. */
  get visible(): boolean { return this._visible; }

  /** DOM containment check for centralized outside-click handling. */
  containsTarget(target: Node): boolean {
    return this._menu?.contains(target) ?? false;
  }

  /** Build the hidden slash menu DOM and attach it to the container. */
  create(): void {
    this._menu = $('div.canvas-slash-menu');
    this._menu.style.display = 'none';
    document.body.appendChild(this._menu);
    this._registration = this._registry.register(this);
  }

  /** ICanvasMenu lifecycle — called on every editor transaction. */
  onTransaction(editor: Editor): void {
    if (this._registry.isInteractionLocked()) {
      this.hide();
      return;
    }

    const { state } = editor;
    if (!state.selection.empty) {
      this.hide();
      return;
    }

    const { $from } = state.selection;

    // Only trigger in a line blocks can follow — never
    // in code (a "/" there is code: "// todo" + Enter turned the code block
    // into a to-do list) or in a text-only line (a toggle's summary, a toggle
    // heading's title), where no block can go.
    const parentType = $from.parent.type;
    if (!$from.parent.isTextblock || parentType.spec.code || SLASH_FREE_TEXTBLOCKS.has(parentType.name)) {
      this.hide();
      return;
    }

    const trigger = slashTriggerAt($from);

    // A "/" whose menu was closed with Esc stays closed while it is still
    // there (the next key used to reopen it).
    if (this._dismissedSlash !== null && this._dismissedSlash !== trigger?.from) {
      this._dismissedSlash = null;
    }
    if (!trigger || this._dismissedSlash === trigger.from) {
      this.hide();
      return;
    }

    // Words that found nothing, then a space: the "/" was text.
    if (!slashQueryAlive(this._allItems(), trigger.query)) {
      this.hide();
      return;
    }
    this._filterText = trigger.query.toLowerCase();
    this._show(editor);
  }

  private _show(editor: Editor): void {
    if (!this._menu) return;

    const filtered = this._getFilteredItems();
    if (filtered.length === 0) {
      this.hide();
      return;
    }

    this._selectedIndex = 0;
    this._visible = true;
    this._registry.notifyShow(this.id);
    this._renderItems(filtered, editor);

    // Position below cursor
    const coords = editor.view.coordsAtPos(editor.state.selection.from);
    this._menu.style.display = 'block';
    layoutPopup(this._menu, { x: coords.left, y: coords.bottom }, { gap: 4 });

    // It stays on its line when the page scrolls.
    window.addEventListener('scroll', this._onScroll, true);

    // Keyboard handler for menu
    if (!this._menu.dataset.listening) {
      this._menu.dataset.listening = '1';
      editor.view.dom.addEventListener('keydown', this._handleKeydown, true);
    }
  }

  private readonly _onScroll = (e: Event): void => {
    const editor = this._host.editor;
    if (!this._visible || !this._menu || !editor) return;
    if (e.target instanceof Node && this._menu.contains(e.target)) return;
    const coords = editor.view.coordsAtPos(editor.state.selection.from);
    layoutPopup(this._menu, { x: coords.left, y: coords.bottom }, { gap: 4 });
  };

  /** Hide the menu and reset state. */
  hide(): void {
    window.removeEventListener('scroll', this._onScroll, true);
    if (!this._menu || !this._visible) return;
    this._menu.style.display = 'none';
    this._visible = false;
    this._filterText = '';
    const editor = this._host.editor;
    if (editor) {
      editor.view.dom.removeEventListener('keydown', this._handleKeydown, true);
      delete this._menu.dataset.listening;
    }
  }

  /** Not kept: tools add and remove their blocks as they are turned on and off. */
  private _allItems(): SlashMenuItem[] {
    return buildSlashMenuItems(this._registry.getSlashMenuBlocks());
  }

  private _getFilteredItems(): SlashMenuItem[] {
    const items = this._allItems();

    if (!this._filterText) {
      // No filter — hoist recents to the top while preserving full list ordering
      // for everything else.  Items not in recents keep their registry order.
      const recents = _slashRecents.read();
      if (recents.length === 0) return items;
      const byId = new Map(items.map(i => [i.blockId, i] as const));
      const hoisted: SlashMenuItem[] = [];
      const seen = new Set<string>();
      for (const id of recents) {
        const item = byId.get(id);
        if (item && !seen.has(id)) { hoisted.push({ ...item, group: 'Recent' }); seen.add(id); }
      }
      for (const item of items) {
        if (!seen.has(item.blockId)) hoisted.push(item);
      }
      return hoisted;
    }

    // Exact name or alias, then prefix, then substring, then description.
    return rankSlashItems(items, this._filterText);
  }

  private _renderItems(items: SlashMenuItem[], editor: Editor): void {
    if (!this._menu) return;
    // Rebuilding the list must not jump its scroll position.
    const scrollTop = this._menu.scrollTop;
    this._menu.innerHTML = '';

    let lastGroup: string | undefined;
    items.forEach((item, index) => {
      // Group labels while browsing; a typed filter shows plain results.
      if (!this._filterText && item.group && item.group !== lastGroup) {
        const label = $('div.canvas-slash-group');
        label.textContent = item.group;
        this._menu!.appendChild(label);
      }
      lastGroup = item.group;
      const row = $('div.canvas-slash-item');
      if (index === this._selectedIndex) {
        row.classList.add('canvas-slash-item--selected');
      }

      // House-style single-line row (matches .block-action-item): ghost
      // icon + label; the description lives in the native tooltip instead
      // of a permanent second line. The registry's iconIsText flag decides
      // text-vs-SVG (the old hardcoded whitelist rendered any unlisted
      // icon id as literal text — the "table" box).
      const iconEl = $('span.canvas-slash-icon');
      if (item.iconIsText) {
        iconEl.classList.add('canvas-slash-icon--text');
        iconEl.textContent = item.icon;
      } else {
        iconEl.innerHTML = svgIcon(item.icon as any);
        const svg = iconEl.querySelector('svg');
        if (svg) { svg.setAttribute('width', '16'); svg.setAttribute('height', '16'); }
      }
      row.appendChild(iconEl);

      const labelEl = $('span.canvas-slash-label');
      labelEl.textContent = item.label;
      row.appendChild(labelEl);
      row.title = item.description;

      row.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        void this._execute(item, editor);
      });

      row.addEventListener('mouseenter', () => {
        this._selectedIndex = index;
        // Update selection highlight without rebuilding DOM
        const rows = this._menu!.querySelectorAll('.canvas-slash-item');
        rows.forEach((r, i) => {
          r.classList.toggle('canvas-slash-item--selected', i === index);
        });
      });

      this._menu!.appendChild(row);
    });
    this._menu.scrollTop = scrollTop;
    // Keep the highlighted row in view as the arrow keys move it.
    this._menu.querySelector<HTMLElement>('.canvas-slash-item--selected')?.scrollIntoView?.({ block: 'nearest' });
  }

  private readonly _handleKeydown = (e: KeyboardEvent): void => {
    const editor = this._host.editor;
    if (!this._visible || !editor) return;

    const filtered = this._getFilteredItems();
    if (filtered.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      this._selectedIndex = (this._selectedIndex + 1) % filtered.length;
      this._renderItems(filtered, editor);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      this._selectedIndex = (this._selectedIndex - 1 + filtered.length) % filtered.length;
      this._renderItems(filtered, editor);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      void this._execute(filtered[this._selectedIndex], editor);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      this._dismissedSlash = slashTriggerAt(editor.state.selection.$from)?.from ?? null;
      this.hide();
    }
  };

  private async _execute(item: SlashMenuItem, editor: Editor): Promise<void> {
    // Track for recents-hoisting on next open. Done before insertion so a
    // failure in the insert path still records the user's intent.
    // record BEFORE we flip the suppress flag so a throw
    // here (e.g. localStorage quota) can't leave the flag stuck on, which
    // would silently swallow every subsequent user edit.
    _slashRecents.record(item.blockId);

    // Suppress onUpdate to prevent onTransaction from firing mid-execution.
    // The try/finally below guarantees the flag is restored even if the
    // insert path throws.
    this._host.suppressUpdate = true;
    let insertedMathAt = -1;
    try {
      const range = slashInsertRange(editor, item);
      if (!range) return;

      await this._registry.executeBlockInsert(item.blockId, editor, range, {
        pageId: this._host.pageId,
        dataService: this._host.dataService,
        databaseService: this._host.databaseService,
        openEditor: this._host.openEditor,
      });
      insertedMathAt = inlineMathBeforeCaret(editor);
    } finally {
      this._host.suppressUpdate = false;
    }

    // Explicit exceptional save path: slash execution suppresses onUpdate checks.
    this._host.requestSave('slash-execute');

    this.hide();

    // Auto-open inline math editor if an inline equation was just inserted
    if (item.blockId === 'inlineMath') {
      setTimeout(() => {
        const ed = this._host.editor;
        if (!ed || ed.isDestroyed) return;
        const placed = insertedMathAt >= 0 ? ed.state.doc.nodeAt(insertedMathAt) : null;
        const placedDom = placed?.type.name === 'inlineMath' ? ed.view.nodeDOM(insertedMathAt) : null;
        if (placed && placedDom instanceof HTMLElement) {
          this._registry.showInlineMathEditor(insertedMathAt, placed.attrs.latex || '', placedDom);
          return;
        }
        const allMath = this._host.editorContainer?.querySelectorAll('.tiptap-math.latex');
        if (allMath && allMath.length > 0) {
          const lastMath = allMath[allMath.length - 1] as HTMLElement;
          const pos = ed.view.posAtDOM(lastMath, 0);
          const node = ed.state.doc.nodeAt(pos);
          if (node && node.type.name === 'inlineMath') {
            this._registry.showInlineMathEditor(pos, node.attrs.latex || '', lastMath);
          }
        }
      }, 80);
    }
  }

  /** Clean up DOM. */
  dispose(): void {
    this._registration?.dispose();
    this._registration = null;
    if (this._menu) {
      this._menu.remove();
      this._menu = null;
    }
  }
}
