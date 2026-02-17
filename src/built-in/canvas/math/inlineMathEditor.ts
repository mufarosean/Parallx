// inlineMathEditor.ts — Click-to-edit popup for inline LaTeX equations
//
// Extracted from canvasEditorProvider.ts (Phase 0).
// Provides the floating popup that appears when a user clicks an
// inline math node — a text input, live KaTeX preview, and
// Enter/Escape/blur commit/cancel semantics.

import type { Editor } from '@tiptap/core';
import katex from 'katex';
import { $ } from '../../../ui/dom.js';

// ── Dependency interface ────────────────────────────────────────────────────

export interface InlineMathEditorHost {
  /** The current TipTap editor instance (may be null before init). */
  readonly editor: Editor | null;
  /** The root container element for the editor pane. */
  readonly container: HTMLElement;
}

// ── Controller ──────────────────────────────────────────────────────────────

export class InlineMathEditorController {
  private _popup: HTMLElement | null = null;
  private _input: HTMLInputElement | null = null;
  private _preview: HTMLElement | null = null;
  private _pos: number = -1;

  constructor(private readonly _host: InlineMathEditorHost) {}

  /** The popup element (for contains-checks in blur handlers). */
  get popup(): HTMLElement | null { return this._popup; }

  /** Build the hidden popup DOM and attach it to the container. */
  create(): void {
    this._popup = $('div.canvas-inline-math-editor');
    this._popup.style.display = 'none';

    // Input field
    this._input = $('input.canvas-inline-math-input') as HTMLInputElement;
    this._input.type = 'text';
    this._input.placeholder = 'Type LaTeX…';
    this._input.spellcheck = false;

    // Live preview
    this._preview = $('div.canvas-inline-math-preview');

    // Hint
    const hint = $('div.canvas-inline-math-hint');
    hint.textContent = 'Enter to confirm · Escape to cancel';

    this._popup.appendChild(this._input);
    this._popup.appendChild(this._preview);
    this._popup.appendChild(hint);
    this._host.container.appendChild(this._popup);

    // ── Events ──
    this._input.addEventListener('input', () => {
      if (!this._preview || !this._input) return;
      const val = this._input.value;
      if (!val) {
        this._preview.innerHTML = '<span class="canvas-inline-math-preview-empty">Preview</span>';
      } else {
        try {
          katex.render(val, this._preview, { displayMode: false, throwOnError: false });
        } catch {
          this._preview.textContent = val;
        }
      }
    });

    this._input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.commit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.hide();
        // Re-focus editor
        this._host.editor?.commands.focus();
      }
      // Stop propagation to prevent TipTap/Parallx from handling these keys
      e.stopPropagation();
    });

    this._input.addEventListener('blur', () => {
      // Commit on blur (clicking outside)
      setTimeout(() => {
        if (!this._popup?.contains(document.activeElement)) {
          this.commit();
        }
      }, 100);
    });
  }

  /** Show the popup positioned below `anchorEl`, pre-filled with `latex`. */
  show(pos: number, latex: string, anchorEl: HTMLElement): void {
    if (!this._popup || !this._input || !this._preview) return;

    this._pos = pos;
    this._input.value = latex;

    // Render preview
    if (latex) {
      try {
        katex.render(latex, this._preview, { displayMode: false, throwOnError: false });
      } catch {
        this._preview.textContent = latex;
      }
    } else {
      this._preview.innerHTML = '<span class="canvas-inline-math-preview-empty">Preview</span>';
    }

    // Position below the anchor element
    const rect = anchorEl.getBoundingClientRect();
    const containerRect = this._host.container.getBoundingClientRect();
    this._popup.style.display = 'flex';

    requestAnimationFrame(() => {
      if (!this._popup) return;
      const popupWidth = this._popup.offsetWidth;
      const left = Math.max(8, rect.left - containerRect.left + rect.width / 2 - popupWidth / 2);
      this._popup.style.left = `${left}px`;
      this._popup.style.top = `${rect.bottom - containerRect.top + 6}px`;
    });

    // Focus the input and select all
    setTimeout(() => {
      this._input?.focus();
      this._input?.select();
    }, 10);
  }

  /** Apply the current input value to the ProseMirror node and hide. */
  commit(): void {
    const editor = this._host.editor;
    if (!editor || this._pos < 0 || !this._input) return;

    const newLatex = this._input.value.trim();
    const node = editor.state.doc.nodeAt(this._pos);

    if (node && node.type.name === 'inlineMath' && newLatex !== node.attrs.latex) {
      if (newLatex) {
        editor.chain()
          .command(({ tr }) => {
            tr.setNodeAttribute(this._pos, 'latex', newLatex);
            return true;
          })
          .run();
      } else {
        // Empty latex — remove the node
        editor.chain()
          .command(({ tr }) => {
            tr.delete(this._pos, this._pos + 1);
            return true;
          })
          .run();
      }
    }

    this.hide();
  }

  /** Hide the popup without committing. */
  hide(): void {
    if (!this._popup) return;
    this._popup.style.display = 'none';
    this._pos = -1;
  }

  /** Clean up DOM. */
  dispose(): void {
    if (this._popup) {
      this._popup.remove();
      this._popup = null;
    }
    this._input = null;
    this._preview = null;
  }
}
