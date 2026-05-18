// canvasTemplatePicker.ts — Modal template picker (M77 Phase 11.4)
//
// One-shot dialog shown by the `canvas.showTemplatePicker` command. The
// picker presents the curated template list from `canvasTemplates.ts`,
// lets the user choose one, then resolves with the chosen template (or
// `null` if dismissed). Picking is the user's only commitment — the
// caller is responsible for actually creating the page and seeding its
// content.

import { $ } from '../../ui/dom.js';
import type { CanvasPageTemplate } from './canvasTemplates.js';
import { getCanvasTemplates } from './canvasTemplates.js';

export interface TemplatePickerResult {
  readonly template: CanvasPageTemplate | null;
}

/**
 * Show the template picker modal. Returns a promise that resolves when
 * the user picks a template or dismisses the dialog (Esc / click backdrop
 * / Cancel button).
 */
export function showCanvasTemplatePicker(): Promise<TemplatePickerResult> {
  return new Promise((resolve) => {
    const templates = getCanvasTemplates();

    const backdrop = $('div.canvas-template-picker-backdrop');
    const modal = $('div.canvas-template-picker');
    backdrop.appendChild(modal);

    const title = $('div.canvas-template-picker-title');
    title.textContent = 'Start from a template';
    modal.appendChild(title);

    const subtitle = $('div.canvas-template-picker-subtitle');
    subtitle.textContent = 'Pick a starter shape. You can edit everything afterwards.';
    modal.appendChild(subtitle);

    const grid = $('div.canvas-template-picker-grid');
    modal.appendChild(grid);

    let resolved = false;
    const finish = (template: CanvasPageTemplate | null): void => {
      if (resolved) return;
      resolved = true;
      backdrop.remove();
      document.removeEventListener('keydown', onKeyDown, true);
      resolve({ template });
    };

    // Build cards
    for (const tpl of templates) {
      const card = $('button.canvas-template-card') as HTMLButtonElement;
      card.type = 'button';

      const iconRow = $('div.canvas-template-card-icon');
      iconRow.textContent = tpl.icon;
      card.appendChild(iconRow);

      const name = $('div.canvas-template-card-name');
      name.textContent = tpl.name;
      card.appendChild(name);

      const desc = $('div.canvas-template-card-desc');
      desc.textContent = tpl.description;
      card.appendChild(desc);

      card.addEventListener('click', (e) => {
        e.preventDefault();
        finish(tpl);
      });
      grid.appendChild(card);
    }

    // Blank-page escape hatch — same as cancel, but framed as "start
    // empty" so users who opened the picker by mistake still have a
    // sensible click.
    const footer = $('div.canvas-template-picker-footer');
    const blankBtn = $('button.canvas-template-picker-blank') as HTMLButtonElement;
    blankBtn.type = 'button';
    blankBtn.textContent = 'Start with a blank page instead';
    blankBtn.addEventListener('click', () => finish(null));
    footer.appendChild(blankBtn);

    const cancelBtn = $('button.canvas-template-picker-cancel') as HTMLButtonElement;
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => finish(null));
    footer.appendChild(cancelBtn);

    modal.appendChild(footer);

    // Dismiss on backdrop click (but not when clicking inside the modal).
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) finish(null);
    });

    // Esc to dismiss. Captured at document level so it fires regardless
    // of focus location.
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        finish(null);
      }
    };
    document.addEventListener('keydown', onKeyDown, true);

    document.body.appendChild(backdrop);

    // Focus the first card so keyboard users can pick without reaching
    // for the mouse.
    const firstCard = grid.querySelector('button.canvas-template-card') as HTMLButtonElement | null;
    firstCard?.focus();
  });
}
