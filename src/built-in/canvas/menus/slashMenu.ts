// slashMenu.ts — Slash command menu controller (/ trigger)
//
// Extracted from canvasEditorProvider.ts (Phase 0).
// Handles creating the slash menu popup, filtering items by typed text,
// keyboard navigation, and executing the selected command.

import type { Editor } from '@tiptap/core';
import { $, layoutPopup } from '../../../ui/dom.js';
import { svgIcon } from './canvasMenuRegistry.js';
import type { SlashMenuItem } from './slashMenuItems.js';
import { buildSlashMenuItems } from './slashMenuItems.js';
import type { ICanvasMenu, InsertActionContext } from './canvasMenuRegistry.js';
import type { CanvasMenuRegistry } from './canvasMenuRegistry.js';
import type { IDisposable } from '../../../platform/lifecycle.js';

// ── Dependency interface ────────────────────────────────────────────────────

export interface SlashMenuHost {
  readonly editor: Editor | null;
  readonly container: HTMLElement;
  readonly editorContainer: HTMLElement | null;
  readonly dataService?: InsertActionContext['dataService'];
  readonly pageId?: string;
  readonly openEditor?: InsertActionContext['openEditor'];
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
  private _selectedIndex = 0;
  private _registration: IDisposable | null = null;
  private _slashItems: SlashMenuItem[] | null = null;

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

    // Only trigger at the start of an empty or text-only paragraph
    if (!$from.parent.isTextblock) {
      this.hide();
      return;
    }

    const text = $from.parent.textContent;

    // Look for '/' at the start of the line
    if (text.startsWith('/')) {
      this._filterText = text.slice(1).toLowerCase();
      this._show(editor);
    } else {
      this.hide();
    }
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

    // Keyboard handler for menu
    if (!this._menu.dataset.listening) {
      this._menu.dataset.listening = '1';
      editor.view.dom.addEventListener('keydown', this._handleKeydown);
    }
  }

  /** Hide the menu and reset state. */
  hide(): void {
    if (!this._menu || !this._visible) return;
    this._menu.style.display = 'none';
    this._visible = false;
    this._filterText = '';
    const editor = this._host.editor;
    if (editor) {
      editor.view.dom.removeEventListener('keydown', this._handleKeydown);
      delete this._menu.dataset.listening;
    }
  }

  private _getFilteredItems(): SlashMenuItem[] {
    const items = this._slashItems ??= buildSlashMenuItems(this._registry.getSlashMenuBlocks());

    if (!this._filterText) return items;
    const q = this._filterText.replace(/[^a-z0-9]/g, '');
    return items.filter(item => {
      const label = item.label.toLowerCase().replace(/[^a-z0-9]/g, '');
      const desc = item.description.toLowerCase().replace(/[^a-z0-9]/g, '');
      return label.includes(q) || desc.includes(q);
    });
  }

  private _renderItems(items: SlashMenuItem[], editor: Editor): void {
    if (!this._menu) return;
    this._menu.innerHTML = '';

    items.forEach((item, index) => {
      const row = $('div.canvas-slash-item');
      if (index === this._selectedIndex) {
        row.classList.add('canvas-slash-item--selected');
      }

      const iconEl = $('span.canvas-slash-icon');
      // Render SVG icon if available, otherwise use text
      const knownIcons = ['page','checklist','quote','code','divider','lightbulb','chevron-right','grid','image','bullet-list','numbered-list','math','math-block','columns','bookmark','globe','toc','video','audio','file-attachment'];
      if (knownIcons.includes(item.icon)) {
        iconEl.innerHTML = svgIcon(item.icon as any);
        const svg = iconEl.querySelector('svg');
        if (svg) { svg.setAttribute('width', '18'); svg.setAttribute('height', '18'); }
      } else {
        iconEl.textContent = item.icon;
      }
      row.appendChild(iconEl);

      const textEl = $('div.canvas-slash-text');
      const labelEl = $('div.canvas-slash-label');
      labelEl.textContent = item.label;
      const descEl = $('div.canvas-slash-desc');
      descEl.textContent = item.description;
      textEl.appendChild(labelEl);
      textEl.appendChild(descEl);
      row.appendChild(textEl);

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
  }

  private readonly _handleKeydown = (e: KeyboardEvent): void => {
    const editor = this._host.editor;
    if (!this._visible || !editor) return;

    const filtered = this._getFilteredItems();
    if (filtered.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this._selectedIndex = (this._selectedIndex + 1) % filtered.length;
      this._renderItems(filtered, editor);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this._selectedIndex = (this._selectedIndex - 1 + filtered.length) % filtered.length;
      this._renderItems(filtered, editor);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      void this._execute(filtered[this._selectedIndex], editor);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this.hide();
    }
  };

  private async _execute(item: SlashMenuItem, editor: Editor): Promise<void> {
    // Suppress onUpdate to prevent onTransaction from firing mid-execution
    this._host.suppressUpdate = true;

    try {
      const { $from } = editor.state.selection;
      if ($from.depth < 1) return;

      const blockDepth = $from.depth;
      const blockPos = $from.before(blockDepth);
      const blockNode = editor.state.doc.nodeAt(blockPos);
      if (!blockNode) return;

      await this._registry.executeBlockInsert(item.blockId, editor, {
        from: blockPos,
        to: blockPos + blockNode.nodeSize,
      }, {
        pageId: this._host.pageId,
        dataService: this._host.dataService,
        openEditor: this._host.openEditor,
      });
    } finally {
      this._host.suppressUpdate = false;
    }

    // Explicit exceptional save path: slash execution suppresses onUpdate checks.
    this._host.requestSave('slash-execute');

    this.hide();

    // Auto-open inline math editor if an inline equation was just inserted
    if (item.label === 'Inline Equation') {
      setTimeout(() => {
        const ed = this._host.editor;
        if (!ed) return;
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
