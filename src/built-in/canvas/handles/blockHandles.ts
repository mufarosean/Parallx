// blockHandles.ts — Block Handles controller (+ button, drag-handle click, block action menu)
//
// Extracted from canvasEditorProvider.ts monolith.  Encapsulates:
//   • + button creation & positioning alongside the GlobalDragHandle
//   • MutationObserver that tracks drag-handle style/class changes
//   • Block resolution from handle position (DOM → ProseMirror mapping)
//   • Block Action Menu (turn-into, color, duplicate, delete)
//   • Turn-Into submenu with 12 block types
//   • Color submenu (10 text colours + 10 background colours)

import type { Editor } from '@tiptap/core';
import type { BlockSelectionController } from './blockSelection.js';
import { $ } from '../../../ui/dom.js';
import { svgIcon } from '../canvasIcons.js';

// ── Host Interface ──────────────────────────────────────────────────────────

export interface BlockHandlesHost {
  readonly editor: Editor | null;
  readonly container: HTMLElement;
  readonly editorContainer: HTMLElement | null;
  readonly dataService: { scheduleContentSave(pageId: string, json: string): void };
  readonly pageId: string;
  readonly blockSelection: BlockSelectionController;
}

// ── Controller ──────────────────────────────────────────────────────────────

export class BlockHandlesController {
  // DOM elements
  private _blockAddBtn: HTMLElement | null = null;
  private _blockActionMenu: HTMLElement | null = null;
  private _turnIntoSubmenu: HTMLElement | null = null;
  private _colorSubmenu: HTMLElement | null = null;
  private _dragHandleEl: HTMLElement | null = null;

  // Timers
  private _turnIntoHideTimer: ReturnType<typeof setTimeout> | null = null;
  private _colorHideTimer: ReturnType<typeof setTimeout> | null = null;

  // Observer
  private _handleObserver: MutationObserver | null = null;

  // Action target
  private _actionBlockPos: number = -1;
  private _actionBlockNode: any = null;

  constructor(private readonly _host: BlockHandlesHost) {}

  // ── Setup ───────────────────────────────────────────────────────────────

  setup(): void {
    const ec = this._host.editorContainer;
    const editor = this._host.editor;
    if (!ec || !editor) return;

    // Find the drag handle element created by GlobalDragHandle
    this._dragHandleEl = ec.querySelector('.drag-handle') as HTMLElement;
    if (!this._dragHandleEl) return;

    // ── Create + button ──
    this._blockAddBtn = document.createElement('div');
    this._blockAddBtn.className = 'block-add-btn hide';
    this._blockAddBtn.innerHTML = svgIcon('plus');
    const svg = this._blockAddBtn.querySelector('svg');
    if (svg) { svg.setAttribute('width', '14'); svg.setAttribute('height', '14'); }
    this._blockAddBtn.title = 'Click to add below\nAlt-click to add a block above';
    ec.appendChild(this._blockAddBtn);

    // ── Position + button alongside drag handle via MutationObserver ──
    this._handleObserver = new MutationObserver(() => {
      if (!this._dragHandleEl || !this._blockAddBtn) return;
      const isHidden = this._dragHandleEl.classList.contains('hide');
      if (isHidden) {
        this._blockAddBtn.classList.add('hide');
        return;
      }
      this._blockAddBtn.classList.remove('hide');
      this._blockAddBtn.style.top = this._dragHandleEl.style.top;
      const handleLeft = parseFloat(this._dragHandleEl.style.left);
      if (!isNaN(handleLeft)) {
        this._blockAddBtn.style.left = `${handleLeft - 22}px`;
      }
    });
    this._handleObserver.observe(this._dragHandleEl, {
      attributes: true,
      attributeFilter: ['style', 'class'],
    });

    // ── Event handlers ──
    this._blockAddBtn.addEventListener('click', this._onBlockAddClick);
    this._blockAddBtn.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
    this._dragHandleEl.addEventListener('click', this._onDragHandleClick);

    // ── Prevent drag handle from hiding when mouse moves to the + button ──
    ec.addEventListener('mouseout', this._onEditorMouseOut, true);

    // ── Create block action menu (hidden by default) ──
    this._createBlockActionMenu();

    // ── Close menu on outside clicks ──
    document.addEventListener('mousedown', this._onDocClickOutside);
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /** The block-action-menu element (for outside-click checks). */
  get menu(): HTMLElement | null { return this._blockActionMenu; }

  hide(): void {
    this._hideBlockActionMenu();
  }

  // ── Event Handlers (arrow functions to preserve `this`) ─────────────────

  /** Intercept mouseout on the editor wrapper so the drag handle library
   *  doesn't hide the handle when the mouse moves to the + button. */
  private readonly _onEditorMouseOut = (event: MouseEvent): void => {
    const related = event.relatedTarget as HTMLElement | null;
    if (
      related &&
      (related.classList.contains('block-add-btn') || related.closest('.block-add-btn'))
    ) {
      event.stopPropagation();
    }
  };

  // ── Plus Button Click ──

  private readonly _onBlockAddClick = (e: MouseEvent): void => {
    const editor = this._host.editor;
    if (!editor) return;
    const block = this._resolveBlockFromHandle();
    if (!block) return;
    const { pos, node } = block;
    const isAbove = e.altKey;
    const insertPos = isAbove ? pos : pos + node.nodeSize;
    // Insert paragraph with '/' to trigger slash menu
    editor.chain()
      .insertContentAt(insertPos, { type: 'paragraph', content: [{ type: 'text', text: '/' }] })
      .setTextSelection(insertPos + 2)
      .focus()
      .run();
  };

  // ── Drag Handle Click → Block Action Menu ──

  private readonly _onDragHandleClick = (e: MouseEvent): void => {
    const editor = this._host.editor;
    if (!editor) return;
    if (this._blockActionMenu?.style.display === 'block') {
      this._hideBlockActionMenu();
      return;
    }
    const block = this._resolveBlockFromHandle();
    if (!block) return;
    this._actionBlockPos = block.pos;
    this._actionBlockNode = block.node;

    // Select the block (Shift+Click → extend selection)
    if (e.shiftKey) {
      this._host.blockSelection.extendTo(block.pos);
    } else {
      this._host.blockSelection.select(block.pos);
    }

    this._showBlockActionMenu();
  };

  private readonly _onDocClickOutside = (e: MouseEvent): void => {
    if (!this._blockActionMenu || this._blockActionMenu.style.display !== 'block') return;
    const target = e.target as HTMLElement;
    if (this._blockActionMenu.contains(target)) return;
    if (this._turnIntoSubmenu?.contains(target)) return;
    if (this._colorSubmenu?.contains(target)) return;
    if (this._dragHandleEl?.contains(target)) return;
    this._hideBlockActionMenu();
  };

  // ── Block Resolution ────────────────────────────────────────────────────

  /** Node types whose children are "blocks" in the Page model. */
  private static readonly _PAGE_CONTAINERS = new Set([
    'column', 'callout', 'detailsContent', 'blockquote',
  ]);

  /**
   * Find the block the drag handle is currently next to.
   *
   * Uses the "Everything is a Page" structural model: every vertical
   * container of blocks (doc, column, callout, detailsContent, blockquote)
   * is a Page-container.  The handle always resolves to the **direct child**
   * of the deepest Page-container at the resolved position.
   *
   * This works at arbitrary nesting depth — callout-inside-column,
   * toggle-inside-callout, etc. — without hardcoded special cases.
   */
  private _resolveBlockFromHandle(): { pos: number; node: any } | null {
    const editor = this._host.editor;
    if (!editor || !this._dragHandleEl) return null;
    const view = editor.view;

    const handleRect = this._dragHandleEl.getBoundingClientRect();
    const handleY = handleRect.top + handleRect.height / 2;
    const scanX = handleRect.right + 50;

    // Selectors covering all block-level elements at any nesting depth,
    // plus container blocks themselves (callout, details, blockquote).
    const selectors = [
      'li', 'p', 'pre', 'blockquote',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      '[data-type=mathBlock]', '[data-type=columnList]',
      '[data-type=callout]', '[data-type=details]',
      '.canvas-callout-content > *',
      '[data-type=detailsContent] > *',
      'blockquote > *',
    ].join(', ');

    const matchedEl = document.elementsFromPoint(scanX, handleY)
      .find((el: Element) =>
        el.parentElement?.matches?.('.ProseMirror') ||
        el.matches(selectors),
      );

    if (!matchedEl) {
      return this._resolveBlockFallback(handleY);
    }

    try {
      const domPos = view.posAtDOM(matchedEl, 0);
      const $pos = view.state.doc.resolve(domPos);

      // ── Universal page-container resolution ──
      // Walk ancestors from doc (depth 0) downward. Find the deepest
      // node that is a page-container. The target block is its direct child.
      let containerDepth = 0; // doc root is always a page-container
      for (let d = 1; d <= $pos.depth; d++) {
        if (BlockHandlesController._PAGE_CONTAINERS.has($pos.node(d).type.name)) {
          containerDepth = d;
        }
      }

      const targetDepth = containerDepth + 1;
      if ($pos.depth >= targetDepth) {
        const blockPos = $pos.before(targetDepth);
        const node = view.state.doc.nodeAt(blockPos);
        return node ? { pos: blockPos, node } : null;
      }

      // $pos.depth < targetDepth means we're ON the container node itself
      // (e.g. hovering the container chrome). Resolve to whole container.
      const blockPos = $pos.depth >= 1 ? $pos.before($pos.depth) : domPos;
      const node = view.state.doc.nodeAt(blockPos);
      return node ? { pos: blockPos, node } : null;
    } catch {
      return this._resolveBlockFallback(handleY);
    }
  }

  /** Fallback resolution: walk direct children of .ProseMirror by Y position. */
  private _resolveBlockFallback(handleY: number): { pos: number; node: any } | null {
    const editor = this._host.editor;
    if (!editor) return null;
    const view = editor.view;
    const editorEl = view.dom;
    for (let i = 0; i < editorEl.children.length; i++) {
      const child = editorEl.children[i];
      const rect = child.getBoundingClientRect();
      if (handleY >= rect.top && handleY <= rect.bottom) {
        try {
          const domPos = view.posAtDOM(child, 0);
          const $pos = view.state.doc.resolve(domPos);
          const blockPos = $pos.depth >= 1 ? $pos.before(1) : domPos;
          const node = view.state.doc.nodeAt(blockPos);
          return node ? { pos: blockPos, node } : null;
        } catch { continue; }
      }
    }
    return null;
  }

  // ── Block Action Menu ───────────────────────────────────────────────────

  private _createBlockActionMenu(): void {
    this._blockActionMenu = $('div.block-action-menu');
    this._blockActionMenu.style.display = 'none';
    this._host.container.appendChild(this._blockActionMenu);
  }

  private _showBlockActionMenu(): void {
    if (!this._blockActionMenu || !this._dragHandleEl || !this._actionBlockNode) return;
    this._blockActionMenu.innerHTML = '';

    // Header — block type label
    const header = $('div.block-action-header');
    header.textContent = this._getBlockLabel(this._actionBlockNode.type.name);
    this._blockActionMenu.appendChild(header);

    // Turn into
    const turnIntoSvg = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M13 7C13 4.24 10.76 2 8 2C5.24 2 3 4.24 3 7" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><path d="M3 9C3 11.76 5.24 14 8 14C10.76 14 13 11.76 13 9" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><path d="M1 7L3 5L5 7" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M15 9L13 11L11 9" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const turnIntoItem = this._createActionItem('Turn into', turnIntoSvg, true);
    turnIntoItem.addEventListener('mouseenter', () => {
      if (this._turnIntoHideTimer) { clearTimeout(this._turnIntoHideTimer); this._turnIntoHideTimer = null; }
      this._showTurnIntoSubmenu(turnIntoItem);
    });
    turnIntoItem.addEventListener('mouseleave', (e) => {
      const related = e.relatedTarget as HTMLElement;
      if (!this._turnIntoSubmenu?.contains(related)) {
        this._turnIntoHideTimer = setTimeout(() => this._hideTurnIntoSubmenu(), 200);
      }
    });
    this._blockActionMenu.appendChild(turnIntoItem);

    // Color
    const colorSvg = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" xmlns="http://www.w3.org/2000/svg"><text x="3" y="11" font-size="11" font-weight="700" fill="currentColor" font-family="sans-serif">A</text><rect x="2" y="13" width="12" height="2" rx="0.5" fill="currentColor" opacity="0.5"/></svg>';
    const colorItem = this._createActionItem('Color', colorSvg, true);
    colorItem.addEventListener('mouseenter', () => {
      if (this._colorHideTimer) { clearTimeout(this._colorHideTimer); this._colorHideTimer = null; }
      this._showColorSubmenu(colorItem);
    });
    colorItem.addEventListener('mouseleave', (e) => {
      const related = e.relatedTarget as HTMLElement;
      if (!this._colorSubmenu?.contains(related)) {
        this._colorHideTimer = setTimeout(() => this._hideColorSubmenu(), 200);
      }
    });
    this._blockActionMenu.appendChild(colorItem);

    // Separator
    this._blockActionMenu.appendChild($('div.block-action-separator'));

    // Duplicate
    const dupItem = this._createActionItem('Duplicate', svgIcon('duplicate'), false, 'Ctrl+D');
    dupItem.addEventListener('mousedown', (e) => { e.preventDefault(); this._duplicateBlock(); });
    this._blockActionMenu.appendChild(dupItem);

    // Delete
    const delItem = this._createActionItem('Delete', svgIcon('trash'), false, 'Del');
    delItem.classList.add('block-action-item--danger');
    delItem.addEventListener('mousedown', (e) => { e.preventDefault(); this._deleteBlock(); });
    this._blockActionMenu.appendChild(delItem);

    // Position below drag handle
    const rect = this._dragHandleEl.getBoundingClientRect();
    this._blockActionMenu.style.display = 'block';
    this._blockActionMenu.style.left = `${rect.left}px`;
    this._blockActionMenu.style.top = `${rect.bottom + 4}px`;

    // Adjust if off-screen
    requestAnimationFrame(() => {
      if (!this._blockActionMenu) return;
      const mRect = this._blockActionMenu.getBoundingClientRect();
      if (mRect.right > window.innerWidth - 8) {
        this._blockActionMenu.style.left = `${window.innerWidth - mRect.width - 8}px`;
      }
      if (mRect.bottom > window.innerHeight - 8) {
        this._blockActionMenu.style.top = `${rect.top - mRect.height - 4}px`;
      }
    });
  }

  private _hideBlockActionMenu(): void {
    if (!this._blockActionMenu) return;
    this._blockActionMenu.style.display = 'none';
    this._hideTurnIntoSubmenu();
    this._hideColorSubmenu();
  }

  private _createActionItem(label: string, iconHtml: string, hasSubmenu: boolean, shortcut?: string): HTMLElement {
    const item = $('div.block-action-item');
    const iconEl = $('span.block-action-icon');
    iconEl.innerHTML = iconHtml;
    const svg = iconEl.querySelector('svg');
    if (svg && !svg.getAttribute('width')) { svg.setAttribute('width', '16'); svg.setAttribute('height', '16'); }
    item.appendChild(iconEl);
    const labelEl = $('span.block-action-label');
    labelEl.textContent = label;
    item.appendChild(labelEl);
    if (shortcut) {
      const sc = $('span.block-action-shortcut');
      sc.textContent = shortcut;
      item.appendChild(sc);
    }
    if (hasSubmenu) {
      const arrow = $('span.block-action-arrow');
      arrow.innerHTML = svgIcon('chevron-right');
      const chevSvg = arrow.querySelector('svg');
      if (chevSvg) { chevSvg.setAttribute('width', '12'); chevSvg.setAttribute('height', '12'); }
      item.appendChild(arrow);
    }
    return item;
  }

  // ── Turn Into Submenu ───────────────────────────────────────────────────

  private _showTurnIntoSubmenu(anchor: HTMLElement): void {
    this._hideColorSubmenu();
    if (!this._turnIntoSubmenu) {
      this._turnIntoSubmenu = $('div.block-action-submenu');
      this._turnIntoSubmenu.addEventListener('mouseenter', () => {
        if (this._turnIntoHideTimer) { clearTimeout(this._turnIntoHideTimer); this._turnIntoHideTimer = null; }
      });
      this._turnIntoSubmenu.addEventListener('mouseleave', (e) => {
        const related = (e as MouseEvent).relatedTarget as HTMLElement;
        if (!this._blockActionMenu?.contains(related)) {
          this._turnIntoHideTimer = setTimeout(() => this._hideTurnIntoSubmenu(), 200);
        }
      });
      this._host.container.appendChild(this._turnIntoSubmenu);
    }
    this._turnIntoSubmenu.innerHTML = '';

    const items: { label: string; icon: string; isText?: boolean; type: string; attrs?: any; shortcut?: string }[] = [
      { label: 'Text', icon: 'T', isText: true, type: 'paragraph' },
      { label: 'Heading 1', icon: 'H\u2081', isText: true, type: 'heading', attrs: { level: 1 }, shortcut: '#' },
      { label: 'Heading 2', icon: 'H\u2082', isText: true, type: 'heading', attrs: { level: 2 }, shortcut: '##' },
      { label: 'Heading 3', icon: 'H\u2083', isText: true, type: 'heading', attrs: { level: 3 }, shortcut: '###' },
      { label: 'Bulleted list', icon: 'bullet-list', type: 'bulletList' },
      { label: 'Numbered list', icon: 'numbered-list', type: 'orderedList' },
      { label: 'To-do list', icon: 'checklist', type: 'taskList' },
      { label: 'Toggle list', icon: 'chevron-right', type: 'details' },
      { label: 'Code', icon: 'code', type: 'codeBlock' },
      { label: 'Quote', icon: 'quote', type: 'blockquote' },
      { label: 'Callout', icon: 'lightbulb', type: 'callout' },
      { label: 'Block equation', icon: 'math-block', type: 'mathBlock' },
    ];

    for (const item of items) {
      const row = $('div.block-action-item');
      const iconEl = $('span.block-action-icon');
      if (item.isText) {
        iconEl.textContent = item.icon;
        iconEl.style.fontWeight = '700';
        iconEl.style.fontSize = '14px';
      } else {
        iconEl.innerHTML = svgIcon(item.icon as any);
        const isvg = iconEl.querySelector('svg');
        if (isvg) { isvg.setAttribute('width', '16'); isvg.setAttribute('height', '16'); }
      }
      row.appendChild(iconEl);
      const labelEl = $('span.block-action-label');
      labelEl.textContent = item.label;
      row.appendChild(labelEl);
      if (item.shortcut) {
        const sc = $('span.block-action-shortcut');
        sc.textContent = item.shortcut;
        row.appendChild(sc);
      }
      if (this._isCurrentBlockType(item.type, item.attrs)) {
        const check = $('span.block-action-check');
        check.textContent = '\u2713';
        row.appendChild(check);
      }
      row.addEventListener('mousedown', (e) => { e.preventDefault(); this._turnBlockInto(item.type, item.attrs); });
      this._turnIntoSubmenu!.appendChild(row);
    }

    // Position to the right of anchor
    const rect = anchor.getBoundingClientRect();
    this._turnIntoSubmenu.style.display = 'block';
    this._turnIntoSubmenu.style.left = `${rect.right + 2}px`;
    this._turnIntoSubmenu.style.top = `${rect.top}px`;
    requestAnimationFrame(() => {
      if (!this._turnIntoSubmenu) return;
      const mRect = this._turnIntoSubmenu.getBoundingClientRect();
      if (mRect.right > window.innerWidth - 8) {
        this._turnIntoSubmenu.style.left = `${rect.left - mRect.width - 2}px`;
      }
      if (mRect.bottom > window.innerHeight - 8) {
        this._turnIntoSubmenu.style.top = `${Math.max(8, window.innerHeight - mRect.height - 8)}px`;
      }
    });
  }

  private _hideTurnIntoSubmenu(): void {
    if (this._turnIntoHideTimer) { clearTimeout(this._turnIntoHideTimer); this._turnIntoHideTimer = null; }
    if (this._turnIntoSubmenu) this._turnIntoSubmenu.style.display = 'none';
  }

  // ── Color Submenu ───────────────────────────────────────────────────────

  private _showColorSubmenu(anchor: HTMLElement): void {
    this._hideTurnIntoSubmenu();
    if (!this._colorSubmenu) {
      this._colorSubmenu = $('div.block-action-submenu.block-color-submenu');
      this._colorSubmenu.addEventListener('mouseenter', () => {
        if (this._colorHideTimer) { clearTimeout(this._colorHideTimer); this._colorHideTimer = null; }
      });
      this._colorSubmenu.addEventListener('mouseleave', (e) => {
        const related = (e as MouseEvent).relatedTarget as HTMLElement;
        if (!this._blockActionMenu?.contains(related)) {
          this._colorHideTimer = setTimeout(() => this._hideColorSubmenu(), 200);
        }
      });
      this._host.container.appendChild(this._colorSubmenu);
    }
    this._colorSubmenu.innerHTML = '';

    // Text color section
    const textHeader = $('div.block-color-section-header');
    textHeader.textContent = 'Text color';
    this._colorSubmenu.appendChild(textHeader);

    const textColors = [
      { label: 'Default text', value: null, display: 'rgba(255,255,255,0.81)' },
      { label: 'Gray text', value: 'rgb(155,155,155)', display: 'rgb(155,155,155)' },
      { label: 'Brown text', value: 'rgb(186,133,83)', display: 'rgb(186,133,83)' },
      { label: 'Orange text', value: 'rgb(230,150,60)', display: 'rgb(230,150,60)' },
      { label: 'Yellow text', value: 'rgb(223,196,75)', display: 'rgb(223,196,75)' },
      { label: 'Green text', value: 'rgb(80,185,120)', display: 'rgb(80,185,120)' },
      { label: 'Blue text', value: 'rgb(70,160,230)', display: 'rgb(70,160,230)' },
      { label: 'Purple text', value: 'rgb(170,120,210)', display: 'rgb(170,120,210)' },
      { label: 'Pink text', value: 'rgb(220,120,170)', display: 'rgb(220,120,170)' },
      { label: 'Red text', value: 'rgb(220,80,80)', display: 'rgb(220,80,80)' },
    ];

    for (const color of textColors) {
      const row = $('div.block-color-item');
      const swatch = $('span.block-color-swatch');
      swatch.textContent = 'A';
      swatch.style.color = color.display;
      row.appendChild(swatch);
      const label = $('span.block-action-label');
      label.textContent = color.label;
      row.appendChild(label);
      row.addEventListener('mousedown', (e) => { e.preventDefault(); this._applyBlockTextColor(color.value); });
      this._colorSubmenu!.appendChild(row);
    }

    // Separator
    this._colorSubmenu.appendChild($('div.block-action-separator'));

    // Background color section
    const bgHeader = $('div.block-color-section-header');
    bgHeader.textContent = 'Background color';
    this._colorSubmenu.appendChild(bgHeader);

    const bgColors = [
      { label: 'Default background', value: null, display: 'transparent' },
      { label: 'Gray background', value: 'rgba(155,155,155,0.2)', display: 'rgba(155,155,155,0.35)' },
      { label: 'Brown background', value: 'rgba(186,133,83,0.2)', display: 'rgba(186,133,83,0.35)' },
      { label: 'Orange background', value: 'rgba(230,150,60,0.2)', display: 'rgba(230,150,60,0.35)' },
      { label: 'Yellow background', value: 'rgba(223,196,75,0.2)', display: 'rgba(223,196,75,0.35)' },
      { label: 'Green background', value: 'rgba(80,185,120,0.2)', display: 'rgba(80,185,120,0.35)' },
      { label: 'Blue background', value: 'rgba(70,160,230,0.2)', display: 'rgba(70,160,230,0.35)' },
      { label: 'Purple background', value: 'rgba(170,120,210,0.2)', display: 'rgba(170,120,210,0.35)' },
      { label: 'Pink background', value: 'rgba(220,120,170,0.2)', display: 'rgba(220,120,170,0.35)' },
      { label: 'Red background', value: 'rgba(220,80,80,0.2)', display: 'rgba(220,80,80,0.35)' },
    ];

    for (const color of bgColors) {
      const row = $('div.block-color-item');
      const swatch = $('span.block-color-swatch');
      if (color.value) {
        swatch.style.backgroundColor = color.display;
      } else {
        swatch.style.border = '1px solid rgba(255,255,255,0.2)';
      }
      row.appendChild(swatch);
      const label = $('span.block-action-label');
      label.textContent = color.label;
      row.appendChild(label);
      row.addEventListener('mousedown', (e) => { e.preventDefault(); this._applyBlockBgColor(color.value); });
      this._colorSubmenu!.appendChild(row);
    }

    // Position to the right of anchor
    const rect = anchor.getBoundingClientRect();
    this._colorSubmenu.style.display = 'block';
    this._colorSubmenu.style.left = `${rect.right + 2}px`;
    this._colorSubmenu.style.top = `${rect.top}px`;
    requestAnimationFrame(() => {
      if (!this._colorSubmenu) return;
      const mRect = this._colorSubmenu.getBoundingClientRect();
      if (mRect.right > window.innerWidth - 8) {
        this._colorSubmenu.style.left = `${rect.left - mRect.width - 2}px`;
      }
      if (mRect.bottom > window.innerHeight - 8) {
        this._colorSubmenu.style.top = `${Math.max(8, window.innerHeight - mRect.height - 8)}px`;
      }
    });
  }

  private _hideColorSubmenu(): void {
    if (this._colorHideTimer) { clearTimeout(this._colorHideTimer); this._colorHideTimer = null; }
    if (this._colorSubmenu) this._colorSubmenu.style.display = 'none';
  }

  // ── Block Transform Execution ──────────────────────────────────────────

  private _turnBlockInto(targetType: string, attrs?: any): void {
    const editor = this._host.editor;
    if (!editor || this._actionBlockPos < 0 || !this._actionBlockNode) return;
    const pos = this._actionBlockPos;
    const node = this._actionBlockNode;
    const srcType = node.type.name;
    this._hideBlockActionMenu();
    if (this._isCurrentBlockType(targetType, attrs)) return;

    const simpleTextBlock = ['paragraph', 'heading'].includes(srcType);
    const simpleTarget = ['paragraph', 'heading', 'bulletList', 'orderedList', 'taskList', 'blockquote', 'codeBlock'].includes(targetType);

    if (simpleTextBlock && simpleTarget) {
      try {
        editor.chain().setTextSelection(pos + 1).run();
        switch (targetType) {
          case 'paragraph': editor.chain().setParagraph().focus().run(); break;
          case 'heading': editor.chain().setHeading(attrs).focus().run(); break;
          case 'bulletList': editor.chain().toggleBulletList().focus().run(); break;
          case 'orderedList': editor.chain().toggleOrderedList().focus().run(); break;
          case 'taskList': editor.chain().toggleTaskList().focus().run(); break;
          case 'blockquote': editor.chain().toggleBlockquote().focus().run(); break;
          case 'codeBlock': editor.chain().toggleCodeBlock().focus().run(); break;
        }
      } catch {
        this._turnBlockViaReplace(editor, pos, node, targetType, attrs);
      }
    } else {
      this._turnBlockViaReplace(editor, pos, node, targetType, attrs);
    }

    const json = JSON.stringify(editor.getJSON());
    this._host.dataService.scheduleContentSave(this._host.pageId, json);
  }

  private _turnBlockViaReplace(editor: Editor, pos: number, node: any, targetType: string, attrs?: any): void {
    const content = this._extractBlockContent(node);
    const textContent = node.textContent || '';

    // ── Container source → special handling ──
    const containerTypes = new Set(['callout', 'details', 'blockquote', 'toggleHeading']);
    const isSourceContainer = containerTypes.has(node.type.name);
    const isTargetContainer = containerTypes.has(targetType);

    if (isSourceContainer) {
      const innerBlocks = this._extractContainerBlocks(node);

      if (targetType === 'paragraph') {
        // Container → Paragraph: unwrap all inner blocks into parent
        this._unwrapContainer(editor, pos, node, innerBlocks);
        return;
      }

      if (isTargetContainer) {
        // Container → Container: swap wrapper or reflow
        this._swapContainer(editor, pos, node, targetType, innerBlocks, attrs);
        return;
      }

      // Container → Leaf: lossy — extract first block's text
      const firstBlockContent = innerBlocks.length > 0 ? innerBlocks[0] : content;
      const leafContent = this._extractInlineContent(firstBlockContent);
      const newBlock = this._buildLeafBlock(targetType, leafContent, textContent, attrs);
      if (!newBlock) return;
      editor.chain().insertContentAt({ from: pos, to: pos + node.nodeSize }, newBlock).focus().run();
      return;
    }

    // ── Leaf source → Container target: wrap ──
    if (isTargetContainer) {
      const newBlock = this._buildContainerBlock(targetType, content, attrs);
      if (!newBlock) return;
      editor.chain().insertContentAt({ from: pos, to: pos + node.nodeSize }, newBlock).focus().run();
      return;
    }

    // ── Leaf → Leaf: existing behavior ──
    const newBlock = this._buildLeafBlock(targetType, content, textContent, attrs);
    if (!newBlock) return;
    editor.chain()
      .insertContentAt({ from: pos, to: pos + node.nodeSize }, newBlock)
      .focus()
      .run();
  }

  // ── Container Conversion Helpers ─────────────────────────────────────────

  /**
   * Extract all inner blocks from a container as JSON arrays.
   * Handles callout (direct children), details (summary + content children),
   * and blockquote (direct children).
   */
  private _extractContainerBlocks(node: any): any[] {
    const blocks: any[] = [];
    if (node.type.name === 'details') {
      // Toggle: summary content → first block, detailsContent children → rest
      node.forEach((child: any) => {
        if (child.type.name === 'detailsSummary') {
          const summaryContent = child.content.toJSON() || [];
          blocks.push({ type: 'paragraph', content: summaryContent });
        } else if (child.type.name === 'detailsContent') {
          child.forEach((inner: any) => blocks.push(inner.toJSON()));
        }
      });
    } else if (node.type.name === 'toggleHeading') {
      // Toggle heading: heading text → first block, detailsContent children → rest
      node.forEach((child: any) => {
        if (child.type.name === 'toggleHeadingText') {
          const textContent = child.content.toJSON() || [];
          blocks.push({ type: 'heading', attrs: { level: node.attrs.level }, content: textContent });
        } else if (child.type.name === 'detailsContent') {
          child.forEach((inner: any) => blocks.push(inner.toJSON()));
        }
      });
    } else {
      // callout, blockquote: direct children are blocks
      node.forEach((child: any) => blocks.push(child.toJSON()));
    }
    return blocks;
  }

  /**
   * Unwrap a container: replace it with its inner blocks in the parent Page.
   * Callout → inner blocks become siblings. Toggle → summary + body blocks.
   */
  private _unwrapContainer(editor: Editor, pos: number, node: any, innerBlocks: any[]): void {
    if (innerBlocks.length === 0) {
      innerBlocks = [{ type: 'paragraph' }];
    }
    editor.chain()
      .insertContentAt({ from: pos, to: pos + node.nodeSize }, innerBlocks)
      .focus()
      .run();
  }

  /**
   * Swap one container for another, preserving inner blocks.
   *
   * Conversion rules from CANVAS_STRUCTURAL_MODEL.md §5.2.1:
   *   Callout → Toggle: first inner → summary, rest → body
   *   Callout → Quote:  swap wrapper, keep blocks
   *   Toggle → Callout: wrap toggle inside callout (toggle stays intact) ...
   *     ACTUALLY per spec: summary → first block, body blocks → rest, new callout wraps all
   *   Toggle → Quote:   summary → first block, body blocks → rest, new quote wraps all
   *   Quote → Callout:  swap wrapper, keep blocks
   *   Quote → Toggle:   first inner → summary, rest → body
   */
  private _swapContainer(editor: Editor, pos: number, node: any, targetType: string, innerBlocks: any[], attrs?: any): void {
    let newBlock: any;

    if (targetType === 'details') {
      // → Toggle: first inner block → summary, rest → body
      const summaryContent = innerBlocks.length > 0
        ? (innerBlocks[0].content || [])
        : [];
      const bodyBlocks = innerBlocks.length > 1
        ? innerBlocks.slice(1)
        : [{ type: 'paragraph' }];
      newBlock = {
        type: 'details',
        content: [
          { type: 'detailsSummary', content: summaryContent },
          { type: 'detailsContent', content: bodyBlocks },
        ],
      };
    } else if (targetType === 'toggleHeading') {
      // → Toggle Heading: first inner block → heading text, rest → body
      const headingContent = innerBlocks.length > 0
        ? (innerBlocks[0].content || [])
        : [];
      const bodyBlocks = innerBlocks.length > 1
        ? innerBlocks.slice(1)
        : [{ type: 'paragraph' }];
      newBlock = {
        type: 'toggleHeading',
        attrs: { level: attrs?.level || 1 },
        content: [
          { type: 'toggleHeadingText', content: headingContent },
          { type: 'detailsContent', content: bodyBlocks },
        ],
      };
    } else if (targetType === 'callout') {
      // → Callout: wrap all inner blocks
      newBlock = {
        type: 'callout',
        attrs: { emoji: attrs?.emoji || 'lightbulb' },
        content: innerBlocks.length > 0 ? innerBlocks : [{ type: 'paragraph' }],
      };
    } else if (targetType === 'blockquote') {
      // → Quote: wrap all inner blocks
      newBlock = {
        type: 'blockquote',
        content: innerBlocks.length > 0 ? innerBlocks : [{ type: 'paragraph' }],
      };
    } else {
      return;
    }

    editor.chain()
      .insertContentAt({ from: pos, to: pos + node.nodeSize }, newBlock)
      .focus()
      .run();
  }

  /**
   * Build a container block wrapping a single leaf's content.
   * Leaf → Container: the leaf becomes the first (and only) inner block.
   */
  private _buildContainerBlock(targetType: string, inlineContent: any[], attrs?: any): any | null {
    switch (targetType) {
      case 'callout':
        return { type: 'callout', attrs: { emoji: attrs?.emoji || 'lightbulb' }, content: [{ type: 'paragraph', content: inlineContent }] };
      case 'details':
        return { type: 'details', content: [
          { type: 'detailsSummary', content: inlineContent },
          { type: 'detailsContent', content: [{ type: 'paragraph' }] },
        ]};
      case 'toggleHeading':
        return { type: 'toggleHeading', attrs: { level: attrs?.level || 1 }, content: [
          { type: 'toggleHeadingText', content: inlineContent },
          { type: 'detailsContent', content: [{ type: 'paragraph' }] },
        ]};
      case 'blockquote':
        return { type: 'blockquote', content: [{ type: 'paragraph', content: inlineContent }] };
      default:
        return null;
    }
  }

  /**
   * Build a leaf block from inline content and/or raw text.
   */
  private _buildLeafBlock(targetType: string, inlineContent: any[], textContent: string, attrs?: any): any | null {
    switch (targetType) {
      case 'paragraph':
        return { type: 'paragraph', content: inlineContent };
      case 'heading':
        return { type: 'heading', attrs, content: inlineContent };
      case 'bulletList':
        return { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: inlineContent }] }] };
      case 'orderedList':
        return { type: 'orderedList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: inlineContent }] }] };
      case 'taskList':
        return { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: inlineContent }] }] };
      case 'codeBlock':
        return { type: 'codeBlock', content: textContent ? [{ type: 'text', text: textContent }] : [] };
      case 'mathBlock':
        return { type: 'mathBlock', attrs: { latex: textContent } };
      default:
        return null;
    }
  }

  /**
   * Extract inline content from a block JSON object.
   * Handles both leaf blocks (has .content directly) and wrapped blocks.
   */
  private _extractInlineContent(blockJson: any): any[] {
    if (blockJson.content && Array.isArray(blockJson.content)) {
      // Check if content items are inline (text nodes)
      if (blockJson.content.length > 0 && blockJson.content[0].type === 'text') {
        return blockJson.content;
      }
      // Nested — try first child
      if (blockJson.content.length > 0) {
        return this._extractInlineContent(blockJson.content[0]);
      }
    }
    return [];
  }

  /** Extract inline content (text + marks) from the first textblock inside a node. */
  private _extractBlockContent(node: any): any[] {
    if (node.isTextblock) return node.content.toJSON() || [];
    let result: any[] = [];
    node.descendants((child: any) => {
      if (child.isTextblock && result.length === 0) {
        result = child.content.toJSON() || [];
        return false;
      }
      return true;
    });
    if (result.length === 0 && node.textContent) {
      result = [{ type: 'text', text: node.textContent }];
    }
    return result;
  }

  private _isCurrentBlockType(targetType: string, attrs?: any): boolean {
    if (!this._actionBlockNode) return false;
    const node = this._actionBlockNode;
    if (node.type.name !== targetType) return false;
    if (targetType === 'heading' && attrs?.level && node.attrs?.level !== attrs.level) return false;
    return true;
  }

  private _getBlockLabel(typeName: string): string {
    const labels: Record<string, string> = {
      paragraph: 'Text', heading: 'Heading', bulletList: 'Bulleted list',
      orderedList: 'Numbered list', taskList: 'To-do list', taskItem: 'To-do',
      listItem: 'List item', blockquote: 'Quote', codeBlock: 'Code',
      callout: 'Callout', details: 'Toggle list', mathBlock: 'Equation',
      columnList: 'Columns', table: 'Table', image: 'Image',
      horizontalRule: 'Divider',
    };
    return labels[typeName] || typeName;
  }

  // ── Color Application ──────────────────────────────────────────────────

  private _applyBlockTextColor(value: string | null): void {
    const editor = this._host.editor;
    if (!editor || this._actionBlockPos < 0 || !this._actionBlockNode) return;
    const pos = this._actionBlockPos;
    const node = this._actionBlockNode;
    this._hideBlockActionMenu();
    const from = pos + 1;
    const to = pos + node.nodeSize - 1;
    if (from >= to) return;
    if (value) {
      editor.chain().setTextSelection({ from, to }).setColor(value).focus().run();
    } else {
      editor.chain().setTextSelection({ from, to }).unsetColor().focus().run();
    }
    const json = JSON.stringify(editor.getJSON());
    this._host.dataService.scheduleContentSave(this._host.pageId, json);
  }

  private _applyBlockBgColor(value: string | null): void {
    const editor = this._host.editor;
    if (!editor || this._actionBlockPos < 0 || !this._actionBlockNode) return;
    const pos = this._actionBlockPos;
    const node = this._actionBlockNode;
    this._hideBlockActionMenu();
    const tr = editor.view.state.tr;
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, backgroundColor: value });
    editor.view.dispatch(tr);
    editor.commands.focus();
    const json = JSON.stringify(editor.getJSON());
    this._host.dataService.scheduleContentSave(this._host.pageId, json);
  }

  // ── Duplicate / Delete ─────────────────────────────────────────────────

  private _duplicateBlock(): void {
    const editor = this._host.editor;
    if (!editor || this._actionBlockPos < 0 || !this._actionBlockNode) return;
    const pos = this._actionBlockPos;
    const node = this._actionBlockNode;
    this._hideBlockActionMenu();
    const json = node.toJSON();
    editor.chain().insertContentAt(pos + node.nodeSize, json).focus().run();
    const docJson = JSON.stringify(editor.getJSON());
    this._host.dataService.scheduleContentSave(this._host.pageId, docJson);
  }

  private _deleteBlock(): void {
    const editor = this._host.editor;
    if (!editor || this._actionBlockPos < 0 || !this._actionBlockNode) return;
    const pos = this._actionBlockPos;
    const node = this._actionBlockNode;
    this._hideBlockActionMenu();
    editor.chain().deleteRange({ from: pos, to: pos + node.nodeSize }).focus().run();
    const json = JSON.stringify(editor.getJSON());
    this._host.dataService.scheduleContentSave(this._host.pageId, json);
  }

  // ── Dispose ─────────────────────────────────────────────────────────────

  dispose(): void {
    this._handleObserver?.disconnect();
    this._handleObserver = null;
    document.removeEventListener('mousedown', this._onDocClickOutside);
    this._host.editorContainer?.removeEventListener('mouseout', this._onEditorMouseOut, true);
    if (this._blockAddBtn) { this._blockAddBtn.remove(); this._blockAddBtn = null; }
    if (this._blockActionMenu) { this._blockActionMenu.remove(); this._blockActionMenu = null; }
    if (this._turnIntoSubmenu) { this._turnIntoSubmenu.remove(); this._turnIntoSubmenu = null; }
    if (this._colorSubmenu) { this._colorSubmenu.remove(); this._colorSubmenu = null; }
    this._dragHandleEl = null;
    this._actionBlockNode = null;
  }
}
