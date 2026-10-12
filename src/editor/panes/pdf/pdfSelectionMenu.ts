// pdfSelectionMenu.ts — what a PDF selection offers.
//
// On release over a selection, a bubble with the highlight colours, Copy,
// Ask AI, Add to Canvas Note and ⋯; on right-click (or ⋯), the full menu,
// including the actions running tools add. The text is captured when the
// bubble or menu opens, so an action still has it after the click.

import type { IDisposable } from '../../../platform/lifecycle.js';
import { toDisposable } from '../../../platform/lifecycle.js';
import { ContextMenu } from '../../../ui/contextMenu.js';
import { setupTooltip } from '../../../ui/tooltip.js';
import { getToolSelectionActions } from '../../../services/selectionActionDispatcher.js';
import { ICON } from './pdfIcons.js';
import { pdfButton } from './pdfButtons.js';
import { HIGHLIGHT_COLORS, highlightSolid } from './pdfHighlights.js';
import type { PdfHighlightStore } from './pdfHighlightStore.js';
import type { PdfSelectionActions } from './pdfSelectionActions.js';

/** What the selection menu needs from the pane. */
export interface PdfSelectionMenuHost {
  /** Redraw the selection boxes. */
  scheduleOverlay(): void;
  /** Close the pane's open menu (this one, the overflow or the zoom menu). */
  closeMenu(): void;
  /** The pane's open menu is now this one. */
  setMenu(menu: ContextMenu): void;
  /** Open the find widget on a query. */
  find(query: string): void;
  readonly actions: PdfSelectionActions;
  readonly highlights: PdfHighlightStore;
}

export class PdfSelectionMenu {
  private _captured = '';
  private _bubble: HTMLElement | null = null;

  constructor(
    private readonly _container: HTMLElement,
    private readonly _host: PdfSelectionMenuHost,
  ) {}

  /** The selected text, as captured when the bubble or menu opened. */
  get capturedText(): string {
    return this._captured;
  }

  /** Capture text an action will act on (a key press on a selection). */
  capture(text: string): void {
    this._captured = text;
  }

  /** Follow presses, releases, right-clicks and scrolling on the viewer. Dispose to stop. */
  listen(): IDisposable {
    const controller = new AbortController();
    const signal = controller.signal;

    // On release over a selection: the bubble.
    this._container.addEventListener('mouseup', (e) => {
      // Left button only: a right-click's release would otherwise replace
      // the menu it just opened with the bubble.
      if (e.button !== 0) return;
      // Releases on the pane's own overlays (margin tabs, the review panel,
      // a menu) are not a selection.
      if ((e.target as HTMLElement | null)?.closest('.pdf-highlight-tab, .pdf-highlight-popover, .context-menu')) return;
      requestAnimationFrame(() => {
        this._host.scheduleOverlay();
        const text = window.getSelection()?.toString()?.trim() ?? '';
        if (text.length > 0) {
          this._captured = text;
          this._showBubble();
        } else {
          this._captured = '';
          this.dismiss();
        }
      });
    }, { signal });

    // A new press on the page starts a new selection: the bubble goes until
    // the button is released.
    this._container.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.dismissBubble();
    }, { signal });

    // Right-click on a selection: the full menu.
    this._container.addEventListener('contextmenu', (e) => {
      const text = window.getSelection()?.toString()?.trim() ?? '';
      if (!text) return;
      e.preventDefault();
      this._captured = text;
      this._showMenu(e.clientX, e.clientY);
    }, { signal });

    this._container.addEventListener('scroll', () => {
      this.dismiss();
      this._host.scheduleOverlay();
    }, { signal });

    return toDisposable(() => {
      controller.abort();
      this.dismissBubble();
    });
  }

  /** Close the menu and the bubble. */
  dismiss(): void {
    this._host.closeMenu();
    this.dismissBubble();
  }

  dismissBubble(): void {
    this._bubble?.remove();
    this._bubble = null;
  }

  /**
   * The bubble over a fresh selection. Shown on release, never while
   * dragging, so it never covers what is still being selected.
   */
  private _showBubble(): void {
    this.dismiss();
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    if (!rect.width && !rect.height) return;

    const bubble = document.createElement('div');
    bubble.classList.add('pdf-selection-bubble');
    bubble.setAttribute('role', 'toolbar');
    bubble.setAttribute('aria-label', 'Selection');
    // Pressing a bubble button must not collapse the selection it acts on.
    bubble.addEventListener('mousedown', (e) => e.preventDefault());

    for (const c of HIGHLIGHT_COLORS) {
      const dot = document.createElement('button');
      dot.classList.add('pdf-selection-dot');
      dot.style.backgroundColor = highlightSolid(c.rgba);
      dot.setAttribute('aria-label', `Highlight ${c.label}`);
      setupTooltip(dot, `Highlight ${c.label}`);
      dot.addEventListener('click', () => {
        this._host.highlights.createFromSelection(c.key);
        this.dismiss();
      });
      bubble.appendChild(dot);
    }
    const sep = document.createElement('span');
    sep.classList.add('pdf-selection-sep');
    bubble.appendChild(sep);

    const act = (icon: string, label: string, run: () => void): void => {
      const b = pdfButton(icon, label);
      b.addEventListener('click', () => { run(); });
      bubble.appendChild(b);
    };
    act(ICON.copy, 'Copy (Ctrl+C)', () => { this._host.actions.copy(); this.dismiss(); });
    act(ICON.sparkles, 'Ask AI About Selection', () => { this.dismiss(); this._host.actions.askAI(); });
    act(ICON.canvasNote, 'Add to Canvas Note', () => { this.dismiss(); this._host.actions.captureNote(); });
    act(ICON.more, 'More Actions', () => {
      const r = bubble.getBoundingClientRect();
      this._showMenu(r.right - 4, r.bottom + 4, true);
    });

    document.body.appendChild(bubble);
    bubble.style.visibility = 'hidden';
    const margin = 8;
    const bw = bubble.offsetWidth;
    const bh = bubble.offsetHeight;
    const viewer = this._container.getBoundingClientRect();
    const left = Math.max(margin, Math.min(rect.left, window.innerWidth - bw - margin));
    // Above the selection; below it when there is no room under the toolbar.
    let top = rect.top - bh - 8;
    if (top < viewer.top + 4) top = rect.bottom + 8;
    top = Math.max(margin, Math.min(top, window.innerHeight - bh - margin));
    bubble.style.left = `${Math.round(left)}px`;
    bubble.style.top = `${Math.round(top)}px`;
    bubble.style.visibility = '';
    this._bubble = bubble;
  }

  /**
   * The menu for a selection (right-click, or the bubble's ⋯). Highlight
   * colours sit in a submenu; `keepBubble` leaves the bubble up behind it.
   */
  private _showMenu(x: number, y: number, keepBubble = false): void {
    this._host.closeMenu();
    if (!keepBubble) this.dismissBubble();

    const hasSel = this._captured.length > 0;
    const colourDot = (rgba: string) => (el: HTMLElement) => {
      el.style.display = 'inline-flex';
      el.style.alignItems = 'center';
      el.style.width = '16px';
      const dot = document.createElement('span');
      dot.classList.add('pdf-menu-dot');
      dot.style.backgroundColor = highlightSolid(rgba);
      el.appendChild(dot);
    };

    const menu = ContextMenu.show({
      items: [
        { id: 'pdf.copy', label: 'Copy', keybinding: 'Ctrl+C', disabled: !hasSel },
        {
          id: 'pdf.highlight',
          label: 'Highlight',
          disabled: !hasSel,
          submenu: HIGHLIGHT_COLORS.map((c) => ({
            id: `pdf.highlight.${c.key}`,
            label: c.label,
            renderIcon: colourDot(c.rgba),
          })),
        },
        { id: 'pdf.findInDocument', label: 'Find in Document', disabled: !hasSel },
        { id: 'canvas.captureNote', label: 'Add to Canvas Note', disabled: !hasSel, group: 'canvas' },
        { id: 'canvas.captureImage', label: 'Capture Region to Canvas', disabled: !hasSel, group: 'canvas' },
        // Discuss the selection on the page: a highlight whose review panel
        // opens with the AI question focused.
        { id: 'ai.askInline', label: 'Ask AI About Selection', disabled: !hasSel, group: 'ai' },
        { id: 'ai.addToChat', label: 'Send to Chat', disabled: !hasSel, group: 'ai' },
        // Actions running tools added (selection-action dispatcher), e.g.
        // a study tool's "make a card"; none when no tool offers one.
        ...getToolSelectionActions().map((a) => ({ id: `sel:${a.actionId}`, label: a.label, disabled: !hasSel, group: 'ai' })),
      ],
      anchor: { x, y },
    });

    menu.onDidSelect((e) => {
      const id = e.item.id;
      const actions = this._host.actions;
      if (id === 'pdf.copy') actions.copy();
      else if (id === 'pdf.highlight') this._host.highlights.createFromSelection();
      else if (id.startsWith('pdf.highlight.')) this._host.highlights.createFromSelection(id.slice('pdf.highlight.'.length));
      else if (id === 'pdf.findInDocument') {
        const sel = this._captured.trim();
        if (sel) this._host.find(sel);
      } else if (id === 'canvas.captureNote') actions.captureNote();
      else if (id === 'canvas.captureImage') actions.captureRegion();
      else if (id === 'ai.askInline') actions.askAI();
      else if (id === 'ai.addToChat') actions.dispatch('add-to-chat');
      else if (id.startsWith('sel:')) actions.dispatch(id.slice(4));
      this.dismissBubble();
    });

    this._host.setMenu(menu);
  }
}
