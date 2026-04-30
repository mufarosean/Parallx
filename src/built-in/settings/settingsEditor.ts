// settingsEditor.ts — M60 Phase ε §7 T4.D2 Settings editor view
//
// Modal/overlay editor for the registry. Uses src/ui/* components and
// --vscode-* tokens (no inline styles, no native form widgets per §3.3 L4).
//
// Layout:
//   ┌──────────────────────────────────────────────────┐
//   │ Settings                                    [×]  │
//   ├──────────────────────────────────────────────────┤
//   │ Search [____________]  Scope [User|Workspace|All]│
//   ├──────────────────────────────────────────────────┤
//   │ Category: Autonomy                               │
//   │   key                       [input]  ↺           │
//   │   description                                     │
//   │   ...                                             │
//   └──────────────────────────────────────────────────┘
//
// Live apply: every change calls registry.setValue immediately.
// onDidChange events from the registry update the rendered controls
// (so external mutations — e.g. autonomyFlags.setEnabled — stay in sync).

import { Disposable } from '../../platform/lifecycle.js';
import type { IDisposable } from '../../platform/lifecycle.js';
import { $, addDisposableListener } from '../../ui/dom.js';
import { Overlay } from '../../ui/overlay.js';
import { InputBox } from '../../ui/inputBox.js';
import { Toggle } from '../../ui/toggle.js';
import { Dropdown } from '../../ui/dropdown.js';
import { SegmentedControl } from '../../ui/segmentedControl.js';
import type {
  ISettingsRegistryService,
  ISettingSchema,
  SettingScope,
} from '../../services/settingsRegistryService.js';
import './settings.css';

// ─── Filter state ──────────────────────────────────────────────────────────

type ScopeFilter = 'all' | SettingScope;

// ─── SettingsEditor ────────────────────────────────────────────────────────

export class SettingsEditor extends Disposable {
  private readonly _overlay: Overlay;
  private readonly _root: HTMLElement;
  private readonly _listEl: HTMLElement;
  private _searchValue = '';
  private _scopeFilter: ScopeFilter = 'all';
  private readonly _controlDisposables: IDisposable[] = [];

  constructor(
    parent: HTMLElement,
    private readonly _registry: ISettingsRegistryService,
  ) {
    super();

    this._overlay = this._register(new Overlay(parent, {
      closeOnClickOutside: true,
      closeOnEscape: true,
      contentClass: 'settings-editor-overlay',
    }));

    this._root = $('div.settings-editor');
    this._overlay.contentElement.appendChild(this._root);

    // ── Header ───────────────────────────────────────────
    const header = $('div.settings-editor__header');
    const title = $('h2.settings-editor__title');
    title.textContent = 'Settings';
    header.appendChild(title);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'settings-editor__close';
    closeBtn.setAttribute('aria-label', 'Close settings');
    closeBtn.textContent = '×';
    this._register(addDisposableListener(closeBtn, 'click', () => this.hide()));
    header.appendChild(closeBtn);

    this._root.appendChild(header);

    // ── Filter bar ───────────────────────────────────────
    const filterBar = $('div.settings-editor__filters');

    const searchHost = $('div.settings-editor__search');
    const search = new InputBox(searchHost, {
      placeholder: 'Search settings (key, description, category)…',
      ariaLabel: 'Search settings',
    });
    this._register(search);
    this._register(search.onDidChange((value) => {
      this._searchValue = value.trim().toLowerCase();
      this._render();
    }));
    filterBar.appendChild(searchHost);

    const scopeHost = $('div.settings-editor__scope');
    const scopeControl = new SegmentedControl(scopeHost, {
      segments: [
        { value: 'all', label: 'All' },
        { value: 'user', label: 'User' },
        { value: 'workspace', label: 'Workspace' },
      ],
      selected: 'all',
      ariaLabel: 'Scope filter',
    });
    this._register(scopeControl);
    this._register(scopeControl.onDidChange((id) => {
      this._scopeFilter = id as ScopeFilter;
      this._render();
    }));
    filterBar.appendChild(scopeHost);

    this._root.appendChild(filterBar);

    // ── Settings list ────────────────────────────────────
    this._listEl = $('div.settings-editor__list');
    this._listEl.setAttribute('role', 'list');
    this._root.appendChild(this._listEl);

    // ── Live external-mutation re-render ──
    this._register(this._registry.onDidChange(() => {
      // External mutations (e.g. another extension calls setValue) — re-render
      // so input controls reflect new values. Cheap because rendering is
      // bounded by registry size (~20 schemas in M60).
      this._render();
    }));

    // Focus search on open
    queueMicrotask(() => search.inputElement.focus());

    this._render();
  }

  show(): void {
    this._overlay.show();
  }

  hide(): void {
    this._overlay.hide();
  }

  override dispose(): void {
    this._disposeControls();
    super.dispose();
  }

  // ─────────────────────────────────────────────────────────────────────────

  private _disposeControls(): void {
    for (const d of this._controlDisposables) d.dispose();
    this._controlDisposables.length = 0;
  }

  private _matches(schema: ISettingSchema): boolean {
    if (this._scopeFilter !== 'all' && schema.scope !== this._scopeFilter) return false;
    if (!this._searchValue) return true;
    const haystack = `${schema.key} ${schema.description} ${schema.category ?? ''}`.toLowerCase();
    return haystack.includes(this._searchValue);
  }

  private _render(): void {
    this._disposeControls();
    this._listEl.replaceChildren();

    const schemas = this._registry.getAllSchemas().filter((s) => this._matches(s));
    if (schemas.length === 0) {
      const empty = $('div.settings-editor__empty');
      empty.textContent = 'No settings match the current filter.';
      this._listEl.appendChild(empty);
      return;
    }

    // Group by category
    const byCategory = new Map<string, ISettingSchema[]>();
    for (const s of schemas) {
      const cat = s.category ?? 'General';
      const list = byCategory.get(cat) ?? [];
      list.push(s);
      byCategory.set(cat, list);
    }

    const categories = Array.from(byCategory.keys()).sort();
    for (const cat of categories) {
      const catEl = $('div.settings-editor__category');
      const catHeader = $('h3.settings-editor__category-title');
      catHeader.textContent = cat;
      catEl.appendChild(catHeader);

      for (const schema of byCategory.get(cat)!) {
        catEl.appendChild(this._renderRow(schema));
      }

      this._listEl.appendChild(catEl);
    }
  }

  private _renderRow(schema: ISettingSchema): HTMLElement {
    const row = $('div.settings-editor__row');
    row.setAttribute('role', 'listitem');
    row.setAttribute('data-key', schema.key);

    const head = $('div.settings-editor__row-head');
    const keyEl = $('span.settings-editor__row-key');
    keyEl.textContent = schema.key;
    head.appendChild(keyEl);

    const scopeBadge = $('span.settings-editor__row-scope');
    scopeBadge.textContent = schema.scope;
    head.appendChild(scopeBadge);

    if (schema.deprecated) {
      const dep = $('span.settings-editor__row-deprecated');
      dep.textContent = `deprecated: ${schema.deprecated}`;
      head.appendChild(dep);
    }

    row.appendChild(head);

    const desc = $('div.settings-editor__row-desc');
    desc.textContent = schema.description;
    row.appendChild(desc);

    const controlHost = $('div.settings-editor__row-control');
    this._renderControl(schema, controlHost);
    row.appendChild(controlHost);

    return row;
  }

  private _renderControl(schema: ISettingSchema, host: HTMLElement): void {
    const current = this._registry.getValue(schema.key);

    switch (schema.type) {
      case 'boolean': {
        const toggle = new Toggle(host, {
          checked: current as boolean,
          ariaLabel: schema.key,
        });
        this._controlDisposables.push(toggle);
        this._controlDisposables.push(toggle.onDidChange(async (val) => {
          try {
            await this._registry.setValue(schema.key, val);
          } catch (err) {
            console.warn(`[SettingsEditor] write failed for ${schema.key}:`, err);
            // Snap back on failure
            toggle.checked = current as boolean;
          }
        }));
        break;
      }
      case 'number': {
        const inputBox = new InputBox(host, {
          value: String(current),
          ariaLabel: schema.key,
        });
        this._controlDisposables.push(inputBox);
        const tryWrite = async (raw: string) => {
          const num = Number(raw);
          if (!Number.isFinite(num)) return;
          try {
            await this._registry.setValue(schema.key, num);
          } catch (err) {
            console.warn(`[SettingsEditor] number write rejected for ${schema.key}:`, err);
          }
        };
        this._controlDisposables.push(inputBox.onDidSubmit((v) => void tryWrite(v)));
        this._controlDisposables.push(addDisposableListener(inputBox.inputElement, 'blur', () => {
          void tryWrite(inputBox.inputElement.value);
        }));
        if (schema.min !== undefined || schema.max !== undefined) {
          const hint = $('span.settings-editor__hint');
          hint.textContent = `${schema.min ?? '−∞'} … ${schema.max ?? '∞'}`;
          host.appendChild(hint);
        }
        break;
      }
      case 'string': {
        const inputBox = new InputBox(host, {
          value: current as string,
          ariaLabel: schema.key,
        });
        this._controlDisposables.push(inputBox);
        const write = async (raw: string) => {
          try {
            await this._registry.setValue(schema.key, raw);
          } catch (err) {
            console.warn(`[SettingsEditor] string write rejected for ${schema.key}:`, err);
          }
        };
        this._controlDisposables.push(inputBox.onDidSubmit((v) => void write(v)));
        this._controlDisposables.push(addDisposableListener(inputBox.inputElement, 'blur', () => {
          void write(inputBox.inputElement.value);
        }));
        break;
      }
      case 'enum': {
        const dropdown = new Dropdown(host, {
          items: schema.enumValues!.map((v) => ({ value: v, label: v })),
          selected: current as string,
          ariaLabel: schema.key,
        });
        this._controlDisposables.push(dropdown);
        this._controlDisposables.push(dropdown.onDidChange(async (val) => {
          try {
            await this._registry.setValue(schema.key, val);
          } catch (err) {
            console.warn(`[SettingsEditor] enum write rejected for ${schema.key}:`, err);
          }
        }));
        break;
      }
      case 'object': {
        // JSON textarea (advanced settings)
        const textarea = document.createElement('textarea');
        textarea.className = 'settings-editor__json';
        textarea.spellcheck = false;
        textarea.rows = 4;
        textarea.value = JSON.stringify(current, null, 2);
        textarea.setAttribute('aria-label', schema.key);
        host.appendChild(textarea);

        const status = $('span.settings-editor__json-status');
        host.appendChild(status);

        const tryParse = async () => {
          try {
            const parsed = JSON.parse(textarea.value) as unknown;
            await this._registry.setValue(schema.key, parsed);
            status.textContent = 'Saved';
            status.classList.remove('settings-editor__json-status--error');
          } catch (err) {
            status.textContent = (err as Error).message;
            status.classList.add('settings-editor__json-status--error');
          }
        };
        this._controlDisposables.push(addDisposableListener(textarea, 'blur', () => void tryParse()));
        break;
      }
    }

    // Reset button — applies to every type.
    const resetBtn = document.createElement('button');
    resetBtn.className = 'settings-editor__reset';
    resetBtn.textContent = 'Reset';
    resetBtn.setAttribute('aria-label', `Reset ${schema.key} to default`);
    this._controlDisposables.push(addDisposableListener(resetBtn, 'click', async () => {
      try {
        await this._registry.reset(schema.key);
      } catch (err) {
        console.warn(`[SettingsEditor] reset failed for ${schema.key}:`, err);
      }
    }));
    host.appendChild(resetBtn);
  }
}
