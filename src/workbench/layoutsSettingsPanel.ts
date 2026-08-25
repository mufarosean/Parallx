// layoutsSettingsPanel.ts — the Layouts panel in the unified Settings hub.
//
// The queue's directive verbatim: "save layouts, and be able to switch
// layouts in Settings". Saving captures the live body shape under a name;
// each saved row applies, renames, or deletes. The palette carries a save
// command too, but THIS is the required home.

import type { IDisposable } from '../platform/lifecycle.js';
import { DisposableStore } from '../platform/lifecycle.js';
import type { ISettingsPanel } from '../services/settingsPanelRegistry.js';
import type { SavedLayout, SavedLayoutStore } from './savedLayouts.js';
import { InputBox } from '../ui/inputBox.js';
import './layoutsSettings.css';

/** What the panel needs from the workbench; narrow and testable. */
export interface LayoutsPanelHost {
  /** Read side: listing the saved layouts for display. */
  readonly savedLayouts: SavedLayoutStore;
  /**
   * Write side: every action routes through the command bus (Phase B —
   * journaled, origin-stamped, same path the palette takes).
   */
  executeCommandFrom(origin: 'ui', commandId: string, ...args: unknown[]): Promise<unknown>;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, className?: string, text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(label: string, variant?: 'primary' | 'danger'): HTMLButtonElement {
  const b = el('button', 'layouts-panel__btn', label);
  if (variant) b.classList.add(`layouts-panel__btn--${variant}`);
  b.type = 'button';
  return b;
}

export function createLayoutsSettingsPanel(host: LayoutsPanelHost): ISettingsPanel {
  return {
    id: 'layouts',
    label: 'Layouts',
    order: 30,
    description: 'Save the current workbench arrangement under a name and switch between saved layouts.',
    render(container: HTMLElement): IDisposable {
      const store = new DisposableStore();
      const root = el('div', 'layouts-panel');
      container.appendChild(root);

      // ── Save the current shape ──
      const saveRow = el('div', 'layouts-panel__save');
      const nameInput = store.add(new InputBox(saveRow, {
        placeholder: 'Layout Name',
        ariaLabel: 'Layout Name',
      }));
      const saveBtn = button('Save Current Layout', 'primary');
      saveRow.appendChild(saveBtn);
      root.appendChild(saveRow);

      const listHost = el('div', 'layouts-panel__list');
      root.appendChild(listHost);

      const renderList = (): void => {
        listHost.textContent = '';
        const layouts = host.savedLayouts.list();
        if (layouts.length === 0) {
          listHost.appendChild(el(
            'div', 'layouts-panel__empty',
            'No saved layouts yet. Arrange the workbench, name the shape, and save it.',
          ));
          return;
        }
        for (const layout of layouts) {
          listHost.appendChild(renderRow(layout));
        }
      };

      const renderRow = (layout: SavedLayout): HTMLElement => {
        const row = el('div', 'layouts-panel__row');
        const name = el('span', 'layouts-panel__name', layout.name);
        row.appendChild(name);

        const when = new Date(layout.savedAt);
        row.appendChild(el(
          'span', 'layouts-panel__date',
          Number.isNaN(when.getTime()) ? '' : `Saved ${when.toLocaleString()}`,
        ));

        const applyBtn = button('Apply');
        applyBtn.addEventListener('click', () => {
          void host.executeCommandFrom('ui', 'workbench.action.applyLayout', layout.id);
        });
        row.appendChild(applyBtn);

        const renameBtn = button('Rename');
        renameBtn.addEventListener('click', () => {
          // Swap the name for an input; Enter or blur commits, Escape cancels.
          const editor = new InputBox(row, { value: layout.name, ariaLabel: 'Layout Name' });
          row.replaceChild(editor.element, name);
          editor.inputElement.focus();
          editor.inputElement.select();
          let done = false;
          const finish = async (commit: boolean): Promise<void> => {
            if (done) return;
            done = true;
            if (commit) {
              await host.executeCommandFrom('ui', 'workbench.action.renameLayout', layout.id, editor.inputElement.value);
            }
            editor.dispose();
            renderList();
          };
          editor.inputElement.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') void finish(true);
            if (e.key === 'Escape') void finish(false);
          });
          editor.inputElement.addEventListener('blur', () => void finish(true));
        });
        row.appendChild(renameBtn);

        const deleteBtn = button('Delete', 'danger');
        deleteBtn.addEventListener('click', () => {
          void host.executeCommandFrom('ui', 'workbench.action.deleteLayout', layout.id).then(renderList);
        });
        row.appendChild(deleteBtn);
        return row;
      };

      const doSave = async (): Promise<void> => {
        await host.executeCommandFrom('ui', 'workbench.action.saveLayout', nameInput.inputElement.value);
        nameInput.inputElement.value = '';
        renderList();
      };
      saveBtn.addEventListener('click', () => void doSave());
      nameInput.inputElement.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') void doSave();
      });

      renderList();

      store.add({ dispose: () => root.remove() });
      return store;
    },
  };
}
