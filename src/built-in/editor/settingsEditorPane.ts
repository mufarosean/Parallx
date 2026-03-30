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
import type { IConfigurationPropertySchema } from '../../configuration/configurationTypes.js';
import { IConfigurationService, ICommandService } from '../../services/serviceTypes.js';
import type { ServiceCollection } from '../../services/serviceCollection.js';
import type { ConfigurationService } from '../../configuration/configurationService.js';
import { $,  hide, show } from '../../ui/dom.js';
import type { ICommandService as ICommandServiceType } from '../../services/serviceTypes.js';

// ─── Pane ────────────────────────────────────────────────────────────────────

export class SettingsEditorPane extends EditorPane {
  private _container: HTMLElement | undefined;
  private _searchInput: HTMLInputElement | undefined;
  private _body: HTMLElement | undefined;
  private _countLabel: HTMLElement | undefined;
  private _emptyMessage: HTMLElement | undefined;
  private _configService: ConfigurationService | undefined;
  private _commandService: ICommandServiceType | undefined;
  private _allSchemas: IConfigurationPropertySchema[] = [];
  private _changeListener: { dispose(): void } | undefined;

  constructor(private readonly _services: ServiceCollection) {
    super('settings-editor-pane');
  }

  // ── Build DOM ──

  protected override createPaneContent(container: HTMLElement): void {
    this._container = $('div');
    this._container.classList.add('settings-editor');

    // Header with search
    const header = $('div');
    header.classList.add('settings-editor-header');

    const title = $('h2');
    title.textContent = 'Settings';
    header.appendChild(title);

    this._searchInput = $('input');
    this._searchInput.type = 'text';
    this._searchInput.classList.add('settings-search-input');
    this._searchInput.placeholder = 'Search settings…';
    this._searchInput.addEventListener('input', () => this._renderSettings());
    header.appendChild(this._searchInput);

    this._countLabel = $('span');
    this._countLabel.classList.add('settings-result-count');
    header.appendChild(this._countLabel);

    this._container.appendChild(header);

    // Body
    this._body = $('div');
    this._body.classList.add('settings-body');

    this._emptyMessage = $('div');
    this._emptyMessage.classList.add('settings-empty-message');
    this._emptyMessage.textContent = 'No settings found.';
    hide(this._emptyMessage);
    this._body.appendChild(this._emptyMessage);

    this._container.appendChild(this._body);
    container.appendChild(this._container);
  }

  // ── Render input ──

  protected override async renderInput(_input: IEditorInput): Promise<void> {
    // Resolve services
    this._configService = this._services.has(IConfigurationService)
      ? (this._services.get(IConfigurationService) as unknown as ConfigurationService)
      : undefined;
    this._commandService = this._services.has(ICommandService)
      ? (this._services.get(ICommandService) as unknown as ICommandServiceType)
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

    // Listen for live changes
    this._changeListener?.dispose();
    this._changeListener = this._configService.onDidChangeConfiguration(() => {
      this._allSchemas = [...this._configService!.getAllSchemas()];
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

    // Always show the quick-actions section (Appearance, AI Settings, etc.)
    if (!query) {
      fragment.appendChild(this._createQuickActionsSection());
    }

    if (grouped.size === 0 && this._allSchemas.length > 0) {
      // No matches
      if (this._emptyMessage) {
        this._emptyMessage.textContent = 'No settings match your search.';
        show(this._emptyMessage, 'flex');
      }
    } else if (this._allSchemas.length === 0) {
      // No registered tool settings — quick actions section is still shown above
      if (this._emptyMessage) hide(this._emptyMessage);
    } else {
      if (this._emptyMessage) hide(this._emptyMessage);

      for (const [_sectionKey, schemas] of grouped) {
        const sectionEl = $('div');
        sectionEl.classList.add('settings-section');

        const sectionTitle = $('h3');
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

  // ── Quick Actions Section ──

  private _createQuickActionsSection(): HTMLElement {
    const section = $('div');
    section.classList.add('settings-section');

    const title = $('h3');
    title.classList.add('settings-section-title');
    title.textContent = 'Appearance';
    section.appendChild(title);

    // Theme Editor button
    const item = $('div');
    item.classList.add('settings-item');

    const keyRow = $('div');
    keyRow.classList.add('settings-item-key-row');
    const keyEl = $('span');
    keyEl.classList.add('settings-item-key');
    keyEl.textContent = 'Theme';
    keyRow.appendChild(keyEl);
    item.appendChild(keyRow);

    const desc = $('div');
    desc.classList.add('settings-item-description');
    desc.textContent = 'Customize colors, fonts, and visual appearance of Parallx.';
    item.appendChild(desc);

    const controlEl = $('div');
    controlEl.classList.add('settings-item-control');

    const btn = $('button');
    btn.classList.add('settings-quick-action-btn');
    btn.textContent = 'Open Theme Editor';
    btn.addEventListener('click', () => {
      this._commandService?.executeCommand('theme-editor.open');
    });
    controlEl.appendChild(btn);

    const hint = $('span');
    hint.classList.add('settings-item-default');
    hint.textContent = 'Ctrl+Shift+T';
    controlEl.appendChild(hint);

    item.appendChild(controlEl);
    section.appendChild(item);

    // AI Settings button
    const aiItem = $('div');
    aiItem.classList.add('settings-item');

    const aiKeyRow = $('div');
    aiKeyRow.classList.add('settings-item-key-row');
    const aiKeyEl = $('span');
    aiKeyEl.classList.add('settings-item-key');
    aiKeyEl.textContent = 'AI Configuration';
    aiKeyRow.appendChild(aiKeyEl);
    aiItem.appendChild(aiKeyRow);

    const aiDesc = $('div');
    aiDesc.classList.add('settings-item-description');
    aiDesc.textContent = 'Configure AI model, provider, and runtime settings.';
    aiItem.appendChild(aiDesc);

    const aiControlEl = $('div');
    aiControlEl.classList.add('settings-item-control');

    const aiBtn = $('button');
    aiBtn.classList.add('settings-quick-action-btn');
    aiBtn.textContent = 'Open AI Settings';
    aiBtn.addEventListener('click', () => {
      this._commandService?.executeCommand('ai-settings.open');
    });
    aiControlEl.appendChild(aiBtn);

    aiItem.appendChild(aiControlEl);
    section.appendChild(aiItem);

    return section;
  }

  // ── Create individual setting item ──

  private _createSettingItem(schema: IConfigurationPropertySchema): HTMLElement {
    const item = $('div');
    item.classList.add('settings-item');

    // Key label
    const keyRow = $('div');
    keyRow.classList.add('settings-item-key-row');

    const keyEl = $('span');
    keyEl.classList.add('settings-item-key');
    keyEl.textContent = schema.key;
    keyRow.appendChild(keyEl);

    // Modified indicator (dot) when value differs from default
    const currentValue = this._configService?._getValue(schema.key);
    const isModified = currentValue !== undefined && currentValue !== schema.defaultValue;
    if (isModified) {
      const dot = $('span');
      dot.classList.add('settings-modified-indicator');
      dot.title = 'Modified';
      keyRow.appendChild(dot);
    }

    item.appendChild(keyRow);

    // Description
    if (schema.description) {
      const descEl = $('div');
      descEl.classList.add('settings-item-description');
      descEl.textContent = schema.description;
      item.appendChild(descEl);
    }

    // Control
    const controlEl = $('div');
    controlEl.classList.add('settings-item-control');
    this._renderControl(controlEl, schema);
    item.appendChild(controlEl);

    return item;
  }

  // ── Render type-appropriate control ──

  private _renderControl(container: HTMLElement, schema: IConfigurationPropertySchema): void {
    const currentValue = this._configService?._getValue(schema.key) ?? schema.defaultValue;

    if (schema.type === 'boolean') {
      const checkbox = $('input');
      checkbox.type = 'checkbox';
      checkbox.checked = !!currentValue;
      checkbox.addEventListener('change', () => {
        this._configService?._updateValue(schema.key, checkbox.checked);
      });
      container.appendChild(checkbox);

      const label = $('span');
      label.classList.add('settings-control-label');
      label.textContent = checkbox.checked ? 'Enabled' : 'Disabled';
      checkbox.addEventListener('change', () => {
        label.textContent = checkbox.checked ? 'Enabled' : 'Disabled';
      });
      container.appendChild(label);
    } else if (schema.enum && schema.enum.length > 0) {
      const select = $('select');
      for (const opt of schema.enum) {
        const option = $('option');
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
      const input = $('input');
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
      const input = $('input');
      input.type = 'text';
      input.value = String(currentValue ?? '');
      input.addEventListener('change', () => {
        this._configService?._updateValue(schema.key, input.value);
      });
      container.appendChild(input);
    }

    // Default value hint
    if (schema.defaultValue !== undefined) {
      const defaultHint = $('span');
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
  }

  // ── Dispose ──

  override dispose(): void {
    this._changeListener?.dispose();
    super.dispose();
  }
}
