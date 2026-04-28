// bubbleMenu.ts — Floating formatting toolbar shown on text selection
//
// Extracted from canvasEditorProvider.ts (Phase 0).
// Provides bold, italic, underline, strike, code, link, color (text +
// background/highlight), AI-chat, and inline-equation buttons.
// Buttons wrap to rows of 5 (Notion parity). The Color button opens a
// submenu visually identical to the block-action menu's Color submenu —
// it just targets the current text selection instead of a whole block.

import type { Editor } from '@tiptap/core';
import { $, layoutPopup } from '../../../ui/dom.js';
import { svgIcon, TEXT_COLORS, BG_COLORS, recordRecentColor, getRecentColors } from './canvasMenuRegistry.js';
import type { ColorSwatch } from './canvasMenuRegistry.js';
import type { ICanvasMenu } from './canvasMenuRegistry.js';
import type { CanvasMenuRegistry } from './canvasMenuRegistry.js';
import type { IDisposable } from '../../../platform/lifecycle.js';

// ── Dependency interface ────────────────────────────────────────────────────

export interface BubbleMenuHost {
  readonly editor: Editor | null;
  readonly container: HTMLElement;
  readonly editorContainer: HTMLElement | null;
}

// ── Controller ──────────────────────────────────────────────────────────────

export class BubbleMenuController implements ICanvasMenu {
  readonly id = 'bubble-menu';
  private _menu: HTMLElement | null = null;
  private _linkInput: HTMLElement | null = null;
  private _colorSubmenu: HTMLElement | null = null;
  private _colorButton: HTMLElement | null = null;
  /**
   * Selection range captured when the Color submenu opens, so colour
   * application restores it before mutating — moving focus into the
   * submenu (or any timing race) would otherwise collapse the
   * selection and apply the colour to nothing.
   */
  private _savedRange: { from: number; to: number } | null = null;
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
    return (this._menu?.contains(target) ?? false)
        || (this._colorSubmenu?.contains(target) ?? false);
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
        label: svgIcon('color'), title: 'Color',
        command: () => this._toggleColorSubmenu(),
        // Active when the selection has either a Color mark (textStyle
        // with a color attribute) or a Highlight mark — Color's submenu
        // owns both.
        active: (e) => !!e.getAttributes('textStyle').color || e.isActive('highlight'),
      },
      {
        label: 'AI', title: 'AI',
        command: () => this._registry.toggleAIChat(),
        active: () => this._registry.isAIChatVisible(),
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
              this._registry.showInlineMathEditor(from, latex, mathEl);
            } else {
              // Fallback: find via DOM query
              const allMath = this._host.editorContainer?.querySelectorAll('.tiptap-math.latex');
              if (allMath && allMath.length > 0) {
                const lastMath = allMath[allMath.length - 1] as HTMLElement;
                const pos = editor.view.posAtDOM(lastMath, 0);
                const node = editor.state.doc.nodeAt(pos);
                if (node && node.type.name === 'inlineMath') {
                  this._registry.showInlineMathEditor(pos, node.attrs.latex || '', lastMath);
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
      if (btn.title === 'Color') this._colorButton = el;
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

  // ── Color Submenu ──────────────────────────────────────────────────────
  // Notion-style: same swatch palette as the block-action menu, but
  // operates on the inline text selection rather than a whole block.
  // Text colour → `Color` mark via setColor/unsetColor.
  // Background colour → `Highlight` mark via setHighlight/unsetHighlight.

  private _toggleColorSubmenu(): void {
    const editor = this._host.editor;
    if (!editor || !this._colorButton) return;
    if (this._colorSubmenu && this._colorSubmenu.style.display === 'block') {
      this._hideColorSubmenu();
      return;
    }
    // Capture the inline range BEFORE the submenu opens — clicks inside
    // the submenu may otherwise blur the editor and collapse selection.
    const { from, to } = editor.state.selection;
    if (from === to) return;
    this._savedRange = { from, to };
    this._showColorSubmenu(this._colorButton);
  }

  private _showColorSubmenu(anchor: HTMLElement): void {
    if (!this._colorSubmenu) {
      // Reuse the block-action menu's submenu styling for visual parity.
      this._colorSubmenu = $('div.block-action-submenu.block-color-submenu');
      document.body.appendChild(this._colorSubmenu);
    }
    this._colorSubmenu.innerHTML = '';
    const submenu = this._colorSubmenu;

    const buildRow = (color: ColorSwatch, kind: 'text' | 'bg'): void => {
      const row = $('div.block-color-item');
      const swatch = $('span.block-color-swatch');
      if (kind === 'text') {
        swatch.textContent = 'A';
        swatch.style.color = color.display;
      } else if (color.value) {
        swatch.style.backgroundColor = color.display;
      } else {
        swatch.style.border = '1px solid rgba(255,255,255,0.2)';
      }
      row.appendChild(swatch);
      const label = $('span.block-action-label');
      label.textContent = color.label;
      row.appendChild(label);
      row.addEventListener('mousedown', (e) => {
        e.preventDefault();
        if (kind === 'text') this._applyTextColor(color.value);
        else this._applyHighlight(color.value);
      });
      submenu.appendChild(row);
    };

    // Recent — combined section across both kinds.
    const recents: { kind: 'text' | 'bg'; swatch: ColorSwatch }[] = [];
    for (const s of getRecentColors('text')) recents.push({ kind: 'text', swatch: s });
    for (const s of getRecentColors('bg')) recents.push({ kind: 'bg', swatch: s });
    if (recents.length > 0) {
      const recentHeader = $('div.block-color-section-header');
      recentHeader.textContent = 'Recent';
      submenu.appendChild(recentHeader);
      for (const r of recents) buildRow(r.swatch, r.kind);
      submenu.appendChild($('div.block-action-separator'));
    }

    // Text color section
    const textHeader = $('div.block-color-section-header');
    textHeader.textContent = 'Text color';
    submenu.appendChild(textHeader);
    for (const color of TEXT_COLORS) buildRow(color, 'text');

    submenu.appendChild($('div.block-action-separator'));

    // Background color section (TipTap Highlight mark)
    const bgHeader = $('div.block-color-section-header');
    bgHeader.textContent = 'Background color';
    submenu.appendChild(bgHeader);
    for (const color of BG_COLORS) buildRow(color, 'bg');

    // Position below the Color button (bubble itself sits above the
    // selection, so opening down keeps the submenu inside the viewport).
    const rect = anchor.getBoundingClientRect();
    submenu.style.display = 'block';
    layoutPopup(submenu, rect, { position: 'below', gap: 4 });
  }

  private _hideColorSubmenu(): void {
    if (this._colorSubmenu) this._colorSubmenu.style.display = 'none';
  }

  private _applyTextColor(value: string | null): void {
    const editor = this._host.editor;
    const range = this._savedRange;
    if (!editor || !range) return;
    if (value === null) {
      editor.chain().setTextSelection(range).unsetColor().focus().run();
    } else {
      editor.chain().setTextSelection(range).setColor(value).focus().run();
    }
    recordRecentColor('text', value);
    this._hideColorSubmenu();
    setTimeout(() => this._refreshActiveStates(), 10);
  }

  private _applyHighlight(value: string | null): void {
    const editor = this._host.editor;
    const range = this._savedRange;
    if (!editor || !range) return;
    if (value === null) {
      editor.chain().setTextSelection(range).unsetHighlight().focus().run();
    } else {
      editor.chain().setTextSelection(range).setHighlight({ color: value }).focus().run();
    }
    recordRecentColor('bg', value);
    this._hideColorSubmenu();
    setTimeout(() => this._refreshActiveStates(), 10);
  }

  /** ICanvasMenu lifecycle — called on every editor selection change. */
  onSelectionUpdate(editor: Editor): void {
    if (!this._menu) return;

    if (this._registry.isInteractionLocked()) {
      this.hide();
      return;
    }

    if (this._registry.isContextMenuGestureActive()) {
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
    if (this._registry.shouldSuppressBubbleMenu($from.parent.type.name)) {
      this.hide();
      return;
    }

    // Position above selection
    const start = editor.view.coordsAtPos(from);
    const end = editor.view.coordsAtPos(to);
    const midX = (start.left + end.left) / 2;
    const topY = Math.min(start.top, end.top);

    this._menu.style.display = 'grid';
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
      // Color = either a Color mark (textStyle with a color attr) or a
      // Highlight mark on the selection.
      (e: Editor) => !!e.getAttributes('textStyle').color || e.isActive('highlight'),
      () => this._registry.isAIChatVisible(),  // AI chat toggle
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
    this._hideColorSubmenu();
    this._savedRange = null;
  }

  /** Clean up DOM. */
  dispose(): void {
    this._registration?.dispose();
    this._registration = null;
    if (this._menu) {
      this._menu.remove();
      this._menu = null;
    }
    if (this._colorSubmenu) {
      this._colorSubmenu.remove();
      this._colorSubmenu = null;
    }
    this._linkInput = null;
    this._colorButton = null;
    this._savedRange = null;
  }
}
