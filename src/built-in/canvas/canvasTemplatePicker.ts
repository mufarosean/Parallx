// canvasTemplatePicker.ts — Modal template picker
//
// One-shot dialog shown by the `canvas.showTemplatePicker` command. The
// picker presents both built-in templates and any user-authored
// templates loaded from `<workspace>/.parallx/canvas-templates/`, lets
// the user choose one, then resolves with the chosen template (or
// `null` if dismissed). Picking is the user's only commitment — the
// caller is responsible for actually creating the page and seeding its
// content.
//
// Icons follow the Parallx system (Lucide SVG via `createIconElement`).
// Emoji icons in templates are NOT allowed — the loader replaces them
// with the `file-text` fallback. System UI never uses emoji.

import { $ } from '../../ui/dom.js';
import type { CanvasPageTemplate, CanvasTemplateApi } from './canvasTemplates.js';
import { getAllCanvasTemplates } from './canvasTemplates.js';
import { createIconElement } from './config/iconRegistry.js';

export interface TemplatePickerResult {
  readonly template: CanvasPageTemplate | null;
  /** True iff the user picked "Manage templates…" from the picker. */
  readonly openedManager?: boolean;
}

/**
 * Show the template picker modal. Returns a promise that resolves when
 * the user picks a template, dismisses the dialog (Esc / click backdrop /
 * Cancel), or clicks "Manage templates…" (the caller then opens the
 * manager pane).
 */
export async function showCanvasTemplatePicker(api: CanvasTemplateApi): Promise<TemplatePickerResult> {
  const templates = await getAllCanvasTemplates(api);

  return new Promise((resolve) => {
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
    const finish = (result: TemplatePickerResult): void => {
      if (resolved) return;
      resolved = true;
      backdrop.remove();
      document.removeEventListener('keydown', onKeyDown, true);
      resolve(result);
    };

    // ── Build cards ──
    // Built-ins render first, then a small separator, then user
    // templates. The separator is omitted when there are no user
    // templates (avoids an awkward dangling label).
    const builtins = templates.filter((t) => t.source === 'builtin');
    const userTemplates = templates.filter((t) => t.source === 'user');

    const appendCard = (tpl: CanvasPageTemplate): void => {
      const card = $('button.canvas-template-card') as HTMLButtonElement;
      card.type = 'button';

      const iconRow = $('div.canvas-template-card-icon');
      // SVG via the Parallx icon registry. `createIconElement` falls
      // back to a default for unknown ids, so a misconfigured user
      // template still renders something sane.
      iconRow.appendChild(createIconElement(tpl.icon || 'file-text', 28));
      card.appendChild(iconRow);

      const name = $('div.canvas-template-card-name');
      name.textContent = tpl.name;
      card.appendChild(name);

      if (tpl.description) {
        const desc = $('div.canvas-template-card-desc');
        desc.textContent = tpl.description;
        card.appendChild(desc);
      }

      // User templates get a small "Custom" pill so the user can
      // distinguish their own from the curated set without reading
      // the description.
      if (tpl.source === 'user') {
        const pill = $('span.canvas-template-card-pill');
        pill.textContent = 'Custom';
        card.appendChild(pill);
      }

      card.addEventListener('click', (e) => {
        e.preventDefault();
        finish({ template: tpl });
      });
      grid.appendChild(card);
    };

    for (const tpl of builtins) appendCard(tpl);

    if (userTemplates.length > 0) {
      const sep = $('div.canvas-template-picker-section-header');
      sep.textContent = 'Your templates';
      grid.appendChild(sep);
      for (const tpl of userTemplates) appendCard(tpl);
    }

    // ── Footer ──
    // Three actions: blank page (escape hatch for users who opened
    // the picker by mistake), manage templates (always visible — even
    // when no user templates yet, the affordance to create one matters),
    // and cancel.
    const footer = $('div.canvas-template-picker-footer');

    const blankBtn = $('button.canvas-template-picker-blank') as HTMLButtonElement;
    blankBtn.type = 'button';
    blankBtn.appendChild(createIconElement('file', 14));
    const blankLabel = document.createElement('span');
    blankLabel.textContent = 'Start with a blank page';
    blankBtn.appendChild(blankLabel);
    blankBtn.addEventListener('click', () => finish({ template: null }));
    footer.appendChild(blankBtn);

    const manageBtn = $('button.canvas-template-picker-manage') as HTMLButtonElement;
    manageBtn.type = 'button';
    manageBtn.appendChild(createIconElement('settings', 14));
    const manageLabel = document.createElement('span');
    manageLabel.textContent = userTemplates.length > 0 ? 'Manage templates…' : 'Create a custom template…';
    manageBtn.appendChild(manageLabel);
    manageBtn.addEventListener('click', () => finish({ template: null, openedManager: true }));
    footer.appendChild(manageBtn);

    const cancelBtn = $('button.canvas-template-picker-cancel') as HTMLButtonElement;
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => finish({ template: null }));
    footer.appendChild(cancelBtn);

    modal.appendChild(footer);

    // Dismiss on backdrop click (but not when clicking inside the modal).
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) finish({ template: null });
    });

    // Esc to dismiss. Captured at document level so it fires regardless
    // of focus location.
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        finish({ template: null });
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
