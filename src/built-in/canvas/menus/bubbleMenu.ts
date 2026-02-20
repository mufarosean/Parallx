// bubbleMenu.ts — Floating formatting toolbar shown on text selection
//
// Extracted from canvasEditorProvider.ts (Phase 0).
// Provides bold, italic, underline, strike, code, link, highlight,
// and inline-equation buttons that appear above the current selection.

import type { Editor } from '@tiptap/core';
import { $, layoutPopup } from '../../../ui/dom.js';
import { svgIcon } from '../canvasIcons.js';
import type { InlineMathEditorController } from '../math/inlineMathEditor.js';
import { getBlockByName } from '../config/blockRegistry.js';
import type { ICanvasMenu } from './canvasMenuRegistry.js';
import type { CanvasMenuRegistry } from './canvasMenuRegistry.js';
import type { IDisposable } from '../../../platform/lifecycle.js';

// ── Dependency interface ────────────────────────────────────────────────────

export interface BubbleMenuHost {
  readonly editor: Editor | null;
  readonly container: HTMLElement;
  readonly editorContainer: HTMLElement | null;
  readonly inlineMath: InlineMathEditorController;
}

// ── Controller ──────────────────────────────────────────────────────────────

export class BubbleMenuController implements ICanvasMenu {
  readonly id = 'bubble-menu';
  private _menu: HTMLElement | null = null;
  private _linkInput: HTMLElement | null = null;
  private _registration: IDisposable | null = null;

  constructor(
    private readonly _host: BubbleMenuHost,
    private readonly _registry: CanvasMenuRegistry,
  ) {}

  /** The menu element (for contains-checks in blur handlers). */
  get menu(): HTMLElement | null { return this._menu; }

  /** Whether the bubble menu is currently visible. */
  get visible(): boolean {
    return !!this._menu && this._menu.style.display !== 'none';
  }

  /** DOM containment check for centralized outside-click handling. */
  containsTarget(target: Node): boolean {
    return this._menu?.contains(target) ?? false;
  }

  /** Build the hidden bubble menu DOM and attach it to the container. */
  create(): void {
    this._menu = $('div.canvas-bubble-menu');
    this._menu.style.display = 'none';

    // ── Formatting buttons ──
    const buttons: { label: string; title: string; command: (e: Editor) => void; active: (e: Editor) => boolean }[] = [
      {
        label: '<b>B</b>', title: 'Bold (Ctrl+B)',
        command: (e) => e.chain().focus().toggleBold().run(),
        active: (e) => e.isActive('bold'),
      },
      {
        label: '<i>I</i>', title: 'Italic (Ctrl+I)',
        command: (e) => e.chain().focus().toggleItalic().run(),
        active: (e) => e.isActive('italic'),
      },
      {
        label: '<u>U</u>', title: 'Underline (Ctrl+U)',
        command: (e) => e.chain().focus().toggleUnderline().run(),
        active: (e) => e.isActive('underline'),
      },
      {
        label: '<s>S</s>', title: 'Strikethrough',
        command: (e) => e.chain().focus().toggleStrike().run(),
        active: (e) => e.isActive('strike'),
      },
      {
        label: '<code>&lt;/&gt;</code>', title: 'Inline code',
        command: (e) => e.chain().focus().toggleCode().run(),
        active: (e) => e.isActive('code'),
      },
      {
        label: svgIcon('link'), title: 'Link',
        command: () => this._toggleLinkInput(),
        active: (e) => e.isActive('link'),
      },
      {
        label: '<span class="canvas-bubble-highlight-icon">H</span>', title: 'Highlight',
        command: (e) => e.chain().focus().toggleHighlight({ color: '#fef08a' }).run(),
        active: (e) => e.isActive('highlight'),
      },
      {
        label: svgIcon('math'), title: 'Inline equation',
        command: (e) => {
          const { from, to } = e.state.selection;
          const selectedText = e.state.doc.textBetween(from, to);
          const latex = selectedText || 'x';
          e.chain()
            .focus()
            .command(({ tr }) => {
              const mathNode = e.schema.nodes.inlineMath.create({ latex, display: 'no' });
              tr.replaceWith(from, to, mathNode);
              return true;
            })
            .run();
          // Open inline math editor for the newly created node
          this.hide();
          setTimeout(() => {
            const editor = this._host.editor;
            if (!editor) return;
            const mathEl = editor.view.nodeDOM(from) as HTMLElement | null;
            if (mathEl) {
              this._host.inlineMath.show(from, latex, mathEl);
            } else {
              // Fallback: find via DOM query
              const allMath = this._host.editorContainer?.querySelectorAll('.tiptap-math.latex');
              if (allMath && allMath.length > 0) {
                const lastMath = allMath[allMath.length - 1] as HTMLElement;
                const pos = editor.view.posAtDOM(lastMath, 0);
                const node = editor.state.doc.nodeAt(pos);
                if (node && node.type.name === 'inlineMath') {
                  this._host.inlineMath.show(pos, node.attrs.latex || '', lastMath);
                }
              }
            }
          }, 50);
        },
        active: (_e) => false,  // inline math is a node, not a mark — never "active"
      },
    ];

    for (const btn of buttons) {
      const el = $('button.canvas-bubble-btn');
      el.innerHTML = btn.label;
      el.title = btn.title;
      el.addEventListener('mousedown', (ev) => {
        ev.preventDefault();  // prevent editor blur
        const editor = this._host.editor;
        if (editor) btn.command(editor);
        // Refresh active states
        setTimeout(() => { if (this._host.editor) this._refreshActiveStates(); }, 10);
      });
      el.dataset.action = btn.title;
      this._menu.appendChild(el);
    }

    // ── Link input row (hidden by default) ──
    this._linkInput = $('div.canvas-bubble-link-input');
    this._linkInput.style.display = 'none';
    const linkField = $('input.canvas-bubble-link-field') as HTMLInputElement;
    linkField.type = 'url';
    linkField.placeholder = 'Paste link…';
    const linkApply = $('button.canvas-bubble-link-apply');
    linkApply.textContent = '✓';
    linkApply.title = 'Apply link';
    const linkRemove = $('button.canvas-bubble-link-remove');
    linkRemove.innerHTML = svgIcon('close');
    const lrSvg = linkRemove.querySelector('svg');
    if (lrSvg) { lrSvg.setAttribute('width', '12'); lrSvg.setAttribute('height', '12'); }
    linkRemove.title = 'Remove link';

    linkApply.addEventListener('mousedown', (ev) => {
      ev.preventDefault();
      const url = linkField.value.trim();
      const editor = this._host.editor;
      if (url && editor) {
        editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
      }
      this._linkInput!.style.display = 'none';
    });

    linkRemove.addEventListener('mousedown', (ev) => {
      ev.preventDefault();
      const editor = this._host.editor;
      if (editor) {
        editor.chain().focus().extendMarkRange('link').unsetLink().run();
      }
      this._linkInput!.style.display = 'none';
      linkField.value = '';
    });

    linkField.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        linkApply.click();
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        this._linkInput!.style.display = 'none';
      }
    });

    this._linkInput.appendChild(linkField);
    this._linkInput.appendChild(linkApply);
    this._linkInput.appendChild(linkRemove);
    this._menu.appendChild(this._linkInput);

    document.body.appendChild(this._menu);
    this._registration = this._registry.register(this);
  }

  private _toggleLinkInput(): void {
    const editor = this._host.editor;
    if (!this._linkInput || !editor) return;
    const visible = this._linkInput.style.display !== 'none';
    if (visible) {
      this._linkInput.style.display = 'none';
    } else {
      this._linkInput.style.display = 'flex';
      const field = this._linkInput.querySelector('input') as HTMLInputElement;
      // Pre-fill with existing link href
      const attrs = editor.getAttributes('link');
      field.value = attrs.href ?? '';
      field.focus();
      field.select();
    }
  }

  /** ICanvasMenu lifecycle — called on every editor selection change. */
  onSelectionUpdate(editor: Editor): void {
    if (!this._menu) return;

    if (this._registry.isInteractionLocked()) {
      this.hide();
      return;
    }

    const { from, to, empty } = editor.state.selection;
    if (empty || from === to) {
      this.hide();
      return;
    }

    // Don't show for blocks that suppress the bubble menu (e.g. code blocks)
    const { $from } = editor.state.selection;
    const parentDef = getBlockByName($from.parent.type.name);
    if (parentDef?.capabilities.suppressBubbleMenu) {
      this.hide();
      return;
    }

    // Position above selection
    const start = editor.view.coordsAtPos(from);
    const end = editor.view.coordsAtPos(to);
    const midX = (start.left + end.left) / 2;
    const topY = Math.min(start.top, end.top);

    this._menu.style.display = 'flex';
    this._registry.notifyShow(this.id);

    // Wait for layout to get accurate width, then position above selection
    requestAnimationFrame(() => {
      if (!this._menu) return;
      const menuWidth = this._menu.offsetWidth;
      const menuHeight = this._menu.offsetHeight;
      // Centre horizontally above the selection
      const centredX = Math.max(8, midX - menuWidth / 2);
      const aboveY = topY - menuHeight - 8;
      layoutPopup(this._menu, { x: centredX, y: aboveY });
    });

    this._refreshActiveStates();
    // Hide link input when selection changes
    if (this._linkInput) this._linkInput.style.display = 'none';
  }

  private _refreshActiveStates(): void {
    const editor = this._host.editor;
    if (!this._menu || !editor) return;
    const buttons = this._menu.querySelectorAll('.canvas-bubble-btn');
    const activeChecks = [
      (e: Editor) => e.isActive('bold'),
      (e: Editor) => e.isActive('italic'),
      (e: Editor) => e.isActive('underline'),
      (e: Editor) => e.isActive('strike'),
      (e: Editor) => e.isActive('code'),
      (e: Editor) => e.isActive('link'),
      (e: Editor) => e.isActive('highlight'),
      (_e: Editor) => false,  // inline equation — node, never "active" as toggle
    ];
    buttons.forEach((btn, i) => {
      if (i < activeChecks.length) {
        btn.classList.toggle('canvas-bubble-btn--active', activeChecks[i](editor));
      }
    });
  }

  /** Hide the menu and link input. */
  hide(): void {
    if (!this._menu) return;
    this._menu.style.display = 'none';
    if (this._linkInput) this._linkInput.style.display = 'none';
  }

  /** Clean up DOM. */
  dispose(): void {
    this._registration?.dispose();
    this._registration = null;
    if (this._menu) {
      this._menu.remove();
      this._menu = null;
    }
    this._linkInput = null;
  }
}
