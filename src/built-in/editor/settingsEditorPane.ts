// settingsEditorPane.ts — Settings UI editor pane
//
// Shows a searchable, grouped settings editor with type-appropriate controls.
// VS Code reference: src/vs/workbench/contrib/preferences/browser/settingsEditor2.ts
//
// Reads configuration schemas from the ConfigurationService and renders
// editable controls grouped by section. Changes are persisted immediately.

import './settingsEditorPane.css';

import { EditorPane } from '../../editor/editorPane.js';
import type { IEditorInput } from '../../editor/editorInput.js';
import type { IConfigurationPropertySchema, IRegisteredConfigurationSection } from '../../configuration/configurationTypes.js';
import { IConfigurationService } from '../../services/serviceTypes.js';
import type { ServiceCollection } from '../../services/serviceCollection.js';
import type { ConfigurationService } from '../../configuration/configurationService.js';
import { hide, show } from '../../ui/dom.js';

// ─── Pane ────────────────────────────────────────────────────────────────────

export class SettingsEditorPane extends EditorPane {
  private _container: HTMLElement | undefined;
  private _searchInput: HTMLInputElement | undefined;
  private _body: HTMLElement | undefined;
  private _countLabel: HTMLElement | undefined;
  private _emptyMessage: HTMLElement | undefined;
  private _configService: ConfigurationService | undefined;
  private _allSchemas: IConfigurationPropertySchema[] = [];
  private _sections: IRegisteredConfigurationSection[] = [];
  private _changeListener: { dispose(): void } | undefined;

  constructor(private readonly _services: ServiceCollection) {
    super('settings-editor-pane');
  }

  // ── Build DOM ──

  protected override createPaneContent(container: HTMLElement): void {
    this._container = document.createElement('div');
    this._container.classList.add('settings-editor');

    // Header with search
    const header = document.createElement('div');
    header.classList.add('settings-editor-header');

    const title = document.createElement('h2');
    title.textContent = 'Settings';
    header.appendChild(title);

    this._searchInput = document.createElement('input');
    this._searchInput.type = 'text';
    this._searchInput.classList.add('settings-search-input');
    this._searchInput.placeholder = 'Search settings…';
    this._searchInput.addEventListener('input', () => this._renderSettings());
    header.appendChild(this._searchInput);

    this._countLabel = document.createElement('span');
    this._countLabel.classList.add('settings-result-count');
    header.appendChild(this._countLabel);

    this._container.appendChild(header);

    // Body
    this._body = document.createElement('div');
    this._body.classList.add('settings-body');

    this._emptyMessage = document.createElement('div');
    this._emptyMessage.classList.add('settings-empty-message');
    this._emptyMessage.textContent = 'No settings found.';
    hide(this._emptyMessage);
    this._body.appendChild(this._emptyMessage);

    this._container.appendChild(this._body);
    container.appendChild(this._container);
  }

  // ── Render input ──

  protected override async renderInput(_input: IEditorInput): Promise<void> {
    // Resolve configuration service
    this._configService = this._services.has(IConfigurationService)
      ? (this._services.get(IConfigurationService) as unknown as ConfigurationService)
      : undefined;

    if (!this._configService) {
      if (this._emptyMessage) {
        this._emptyMessage.textContent = 'Configuration service not available.';
        show(this._emptyMessage, 'flex');
      }
      return;
    }

    // Load data
    this._allSchemas = [...this._configService.getAllSchemas()];
    this._sections = [...this._configService.getAllSections()];

    // Listen for live changes
    this._changeListener?.dispose();
    this._changeListener = this._configService.onDidChangeConfiguration(() => {
      this._allSchemas = [...this._configService!.getAllSchemas()];
      this._sections = [...this._configService!.getAllSections()];
      this._renderSettings();
    });

    this._renderSettings();
  }

  // ── Render settings list ──

  private _renderSettings(): void {
    if (!this._body || !this._configService) return;

    // Clear existing content (except empty message)
    const children = Array.from(this._body.children);
    for (const child of children) {
      if (child !== this._emptyMessage) child.remove();
    }

    const query = (this._searchInput?.value ?? '').toLowerCase().trim();

    // Filter schemas
    const filtered = query
      ? this._allSchemas.filter(
          (s) =>
            s.key.toLowerCase().includes(query) ||
            s.description.toLowerCase().includes(query) ||
            s.sectionTitle.toLowerCase().includes(query),
        )
      : this._allSchemas;

    // Group by section
    const grouped = new Map<string, IConfigurationPropertySchema[]>();
    for (const schema of filtered) {
      const key = `${schema.toolId}:${schema.sectionTitle}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(schema);
    }

    // Render sections
    const fragment = document.createDocumentFragment();

    if (grouped.size === 0 && this._allSchemas.length > 0) {
      // No matches
      if (this._emptyMessage) {
        this._emptyMessage.textContent = 'No settings match your search.';
        show(this._emptyMessage, 'flex');
      }
    } else if (this._allSchemas.length === 0) {
      // No registered settings at all
      if (this._emptyMessage) {
        this._emptyMessage.textContent = 'No settings have been registered by tools yet.';
        show(this._emptyMessage, 'flex');
      }
    } else {
      if (this._emptyMessage) hide(this._emptyMessage);

      for (const [_sectionKey, schemas] of grouped) {
        const sectionEl = document.createElement('div');
        sectionEl.classList.add('settings-section');

        const sectionTitle = document.createElement('h3');
        sectionTitle.classList.add('settings-section-title');
        sectionTitle.textContent = schemas[0].sectionTitle;
        sectionEl.appendChild(sectionTitle);

        for (const schema of schemas) {
          sectionEl.appendChild(this._createSettingItem(schema));
        }

        fragment.appendChild(sectionEl);
      }
    }

    this._body.insertBefore(fragment, this._emptyMessage ?? null);

    // Update count
    if (this._countLabel) {
      this._countLabel.textContent = query
        ? `${filtered.length} of ${this._allSchemas.length}`
        : `${this._allSchemas.length} settings`;
    }
  }

  // ── Create individual setting item ──

  private _createSettingItem(schema: IConfigurationPropertySchema): HTMLElement {
    const item = document.createElement('div');
    item.classList.add('settings-item');

    // Key label
    const keyRow = document.createElement('div');
    keyRow.classList.add('settings-item-key-row');

    const keyEl = document.createElement('span');
    keyEl.classList.add('settings-item-key');
    keyEl.textContent = schema.key;
    keyRow.appendChild(keyEl);

    // Modified indicator (dot) when value differs from default
    const currentValue = this._configService?._getValue(schema.key);
    const isModified = currentValue !== undefined && currentValue !== schema.defaultValue;
    if (isModified) {
      const dot = document.createElement('span');
      dot.classList.add('settings-modified-indicator');
      dot.title = 'Modified';
      keyRow.appendChild(dot);
    }

    item.appendChild(keyRow);

    // Description
    if (schema.description) {
      const descEl = document.createElement('div');
      descEl.classList.add('settings-item-description');
      descEl.textContent = schema.description;
      item.appendChild(descEl);
    }

    // Control
    const controlEl = document.createElement('div');
    controlEl.classList.add('settings-item-control');
    this._renderControl(controlEl, schema);
    item.appendChild(controlEl);

    return item;
  }

  // ── Render type-appropriate control ──

  private _renderControl(container: HTMLElement, schema: IConfigurationPropertySchema): void {
    const currentValue = this._configService?._getValue(schema.key) ?? schema.defaultValue;

    if (schema.type === 'boolean') {
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = !!currentValue;
      checkbox.addEventListener('change', () => {
        this._configService?._updateValue(schema.key, checkbox.checked);
      });
      container.appendChild(checkbox);

      const label = document.createElement('span');
      label.classList.add('settings-control-label');
      label.textContent = checkbox.checked ? 'Enabled' : 'Disabled';
      checkbox.addEventListener('change', () => {
        label.textContent = checkbox.checked ? 'Enabled' : 'Disabled';
      });
      container.appendChild(label);
    } else if (schema.enum && schema.enum.length > 0) {
      const select = document.createElement('select');
      for (const opt of schema.enum) {
        const option = document.createElement('option');
        option.value = String(opt);
        option.textContent = String(opt);
        if (String(currentValue) === String(opt)) option.selected = true;
        select.appendChild(option);
      }
      select.addEventListener('change', () => {
        this._configService?._updateValue(schema.key, select.value);
      });
      container.appendChild(select);
    } else if (schema.type === 'number') {
      const input = document.createElement('input');
      input.type = 'number';
      input.value = String(currentValue ?? '');
      input.addEventListener('change', () => {
        const val = Number(input.value);
        if (!isNaN(val)) {
          this._configService?._updateValue(schema.key, val);
        }
      });
      container.appendChild(input);
    } else {
      // String or generic
      const input = document.createElement('input');
      input.type = 'text';
      input.value = String(currentValue ?? '');
      input.addEventListener('change', () => {
        this._configService?._updateValue(schema.key, input.value);
      });
      container.appendChild(input);
    }

    // Default value hint
    if (schema.defaultValue !== undefined) {
      const defaultHint = document.createElement('span');
      defaultHint.classList.add('settings-item-default');
      defaultHint.textContent = `Default: ${JSON.stringify(schema.defaultValue)}`;
      container.appendChild(defaultHint);
    }
  }

  // ── Focus ──

  override focus(): void {
    this._searchInput?.focus();
  }

  // ── Clear ──

  protected override clearPaneContent(): void {
    this._changeListener?.dispose();
    this._changeListener = undefined;
    if (this._body) {
      const children = Array.from(this._body.children);
      for (const child of children) {
        if (child !== this._emptyMessage) child.remove();
      }
    }
    if (this._searchInput) this._searchInput.value = '';
    this._allSchemas = [];
    this._sections = [];
  }

  // ── Dispose ──

  override dispose(): void {
    this._changeListener?.dispose();
    super.dispose();
  }
}
