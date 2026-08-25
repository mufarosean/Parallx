// settingsDrawer.ts — the per-widget SETTINGS editor, host-agnostic.
//
// Extracted from DashboardEditorPane._openSettingsDrawer so a widget
// seated in the WORKBENCH edits its config with exactly the drawer a
// dashboard card gets: fields rendered from the type's configSchema
// (string, number, boolean, enum, textarea, markdown with live preview,
// string-list), saved through whichever host owns persistence.
//
// Same deliberate runtime-only module cycle as the appearance drawer:
// createSelect comes from the editor provider, which imports this module —
// both directions execute inside functions long after module evaluation.

import type { WidgetTypeRegistration } from '../../api/bridges/dashboardBridge.js';
import { createSelect } from './dashboardEditorProvider.js';
import { attachPopupDismiss } from '../../ui/dom.js';
import { renderMarkdownToDom } from './widgets/markdownRenderer.js';

export interface SettingsDrawerHost {
  /** The widget type — display name, description, and the schema. */
  readonly typeReg: WidgetTypeRegistration<unknown>;
  /** The instance's current config. */
  readonly config: Record<string, unknown>;
  /** Persist. Throwing keeps the drawer open after showError. */
  onSave(next: Record<string, unknown>): Promise<void>;
  showError(message: string): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

export function openWidgetSettingsDrawer(host: SettingsDrawerHost): void {
  const typeReg = host.typeReg;
  const schema = typeReg.configSchema;
  if (!schema) return;

  const overlay = el('div', 'dashboard-settings-overlay');
  // The dropdowns own global listeners and a body-level list, so every
  // exit has to dispose them.
  const selects: ReturnType<typeof createSelect>[] = [];
  let detachDismiss: (() => void) | undefined;
  const closeDrawer = (): void => {
    detachDismiss?.();
    for (const s of selects) s.dispose();
    overlay.remove();
  };

  const sheet = el('aside', 'dashboard-settings');

  // Standard popup contract (Escape / outside press / window blur — the
  // drawer previously had NO Escape at all). Dropdown option lists mount
  // on document.body, outside the sheet — pressing one is not an exit.
  detachDismiss = attachPopupDismiss(sheet, closeDrawer, {
    isDismissable: (e) => !(e.target as Element | null)?.closest?.('.ui-dropdown__list'),
  });

  const head = el('div', 'dashboard-settings__head');
  const ht = el('h2', 'dashboard-settings__title');
  ht.textContent = `Configure ${typeReg.displayName}`;
  head.appendChild(ht);
  const hint = el('p', 'dashboard-settings__hint');
  hint.textContent = typeReg.description ?? 'Adjust this widget instance.';
  head.appendChild(hint);
  sheet.appendChild(head);

  const body = el('div', 'dashboard-settings__body');
  sheet.appendChild(body);

  const current = { ...host.config };
  const inputs = new Map<string, () => unknown>();

  for (const [name, field] of Object.entries(schema.fields)) {
    const block = el('div', 'dashboard-field');

    const addLabelAndHint = (): void => {
      const label = el('label', 'dashboard-field__label');
      label.textContent = field.label;
      block.appendChild(label);
      if (field.description) {
        const fieldHint = el('span', 'dashboard-field__hint');
        fieldHint.textContent = field.description;
        block.appendChild(fieldHint);
      }
    };

    if (field.type === 'boolean') {
      // Boolean fields render label inline with the checkbox.
      const row = el('div', 'dashboard-field__checkbox-row');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = Boolean(current[name] ?? field.default ?? false);
      row.appendChild(checkbox);
      const text = document.createElement('span');
      text.textContent = field.label;
      row.appendChild(text);
      block.appendChild(row);
      if (field.description) {
        const fieldHint = el('span', 'dashboard-field__hint');
        fieldHint.textContent = field.description;
        block.appendChild(fieldHint);
      }
      inputs.set(name, () => checkbox.checked);
    } else if (field.type === 'enum') {
      addLabelAndHint();
      const opts = (field.options ?? []).map(o => ({ value: o.value, label: o.label }));
      const cur = String(current[name] ?? field.default ?? opts[0]?.value ?? '');
      const sel = createSelect(opts, cur, () => {});
      selects.push(sel);
      block.appendChild(sel.el);
      inputs.set(name, () => sel.getValue());
    } else if (field.type === 'textarea') {
      addLabelAndHint();
      const ta = document.createElement('textarea');
      ta.className = 'dashboard-field__textarea';
      ta.value = String(current[name] ?? field.default ?? '');
      if (field.placeholder) ta.placeholder = field.placeholder;
      block.appendChild(ta);
      inputs.set(name, () => ta.value);
    } else if (field.type === 'markdown') {
      addLabelAndHint();
      // Live-preview markdown editor: a textarea whose formatted result
      // renders beneath it as you type, via the shared renderer.
      const wrap = document.createElement('div');
      wrap.className = 'dashboard-field__markdown';
      const ta = document.createElement('textarea');
      ta.className = 'dashboard-field__textarea dashboard-field__markdown-input';
      ta.value = String(current[name] ?? field.default ?? '');
      if (field.placeholder) ta.placeholder = field.placeholder;
      const preview = document.createElement('div');
      preview.className = 'dashboard-field__markdown-preview dashboard-md__body';
      let rafId = 0;
      const renderPreview = (): void => {
        rafId = 0;
        preview.replaceChildren(renderMarkdownToDom(ta.value));
        preview.classList.toggle('is-empty', ta.value.trim() === '');
      };
      ta.addEventListener('input', () => {
        if (!rafId) rafId = requestAnimationFrame(renderPreview);
      });
      renderPreview();
      wrap.appendChild(ta);
      wrap.appendChild(preview);
      block.appendChild(wrap);
      inputs.set(name, () => ta.value);
    } else if (field.type === 'string-list') {
      addLabelAndHint();
      const ta = document.createElement('textarea');
      ta.className = 'dashboard-field__textarea';
      const value = current[name];
      ta.value = Array.isArray(value)
        ? value.map((v: unknown) => {
            if (typeof v === 'string') return v;
            if (v && typeof v === 'object' && 'label' in v && 'url' in v) {
              const o = v as { label?: unknown; url?: unknown };
              return `${o.label ?? ''} | ${o.url ?? ''}`;
            }
            return '';
          }).join('\n')
        : String(value ?? '');
      if (field.placeholder) ta.placeholder = field.placeholder;
      block.appendChild(ta);
      inputs.set(name, () => ta.value.split('\n').map(s => s.trim()).filter(Boolean));
    } else if (field.type === 'number') {
      addLabelAndHint();
      const input = document.createElement('input');
      input.type = 'number';
      input.className = 'dashboard-field__input';
      const v = current[name];
      if (typeof v === 'number' && Number.isFinite(v)) input.value = String(v);
      else if (typeof field.default === 'number') input.value = String(field.default);
      if (field.placeholder) input.placeholder = field.placeholder;
      block.appendChild(input);
      inputs.set(name, () => {
        const n = Number(input.value);
        return Number.isFinite(n) ? n : 0;
      });
    } else {
      // 'string' default
      addLabelAndHint();
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'dashboard-field__input';
      input.value = String(current[name] ?? field.default ?? '');
      if (field.placeholder) input.placeholder = field.placeholder;
      block.appendChild(input);
      inputs.set(name, () => input.value);
    }

    body.appendChild(block);
  }

  const foot = el('div', 'dashboard-settings__foot');
  const cancel = el('button', 'dashboard-btn dashboard-btn--ghost');
  cancel.type = 'button';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', () => closeDrawer());
  foot.appendChild(cancel);
  const save = el('button', 'dashboard-btn dashboard-btn--primary');
  save.type = 'button';
  save.textContent = 'Save';
  save.addEventListener('click', async () => {
    const next: Record<string, unknown> = {};
    // Read every value BEFORE disposing anything.
    for (const [k, getter] of inputs) next[k] = getter();
    try {
      await host.onSave(next);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      host.showError(`Could not save configuration: ${msg}`);
      return;
    }
    closeDrawer();
  });
  foot.appendChild(save);
  sheet.appendChild(foot);

  overlay.appendChild(sheet);
  document.body.appendChild(overlay);
}
