// propertyBar.ts — Obsidian-style property bar for canvas pages
//
// Renders a collapsible property section below the page header and above
// the Tiptap editor. Each property is shown in a two-column row (name | value)
// with type-specific editors. Includes an "+ Add property" button at bottom.

import './propertyBar.css';

import type { IDisposable } from '../../../platform/lifecycle.js';
import type {
  IPropertyDataService,
  IPropertyDefinition,
  IPageProperty,
  IPropertyUsage,
  PropertyType,
} from './propertyTypes.js';
import { isSystemPropertyName } from './propertyTypes.js';
import { createPropertyEditor, createTypeIconElement } from './propertyEditors.js';
import { showPropertyPicker } from './propertyPicker.js';
import { getGlobalSettingsRegistry } from '../../../services/settingsRegistryService.js';
import { PageChangeKind, type ICanvasDataService } from '../canvasTypes.js';
import { createIconElement } from '../../../ui/iconRegistry.js';

const COLLAPSED_KEY = 'canvas.propertyBar.collapsed';

interface PropertyBarWindowApi {
  showInformationMessage(message: string, ...actions: { title: string }[]): Promise<{ title: string } | undefined>;
  showWarningMessage(message: string, ...actions: { title: string }[]): Promise<{ title: string } | undefined>;
  showErrorMessage(message: string, ...actions: { title: string }[]): Promise<{ title: string } | undefined>;
}

/**
 * Read the collapsed-state preference. Prefers the M60 §7 settings
 * registry (canonical store); falls back to the legacy localStorage key
 * for first paint before the registry is wired (or in headless tests).
 */
function _readCollapsed(): boolean {
  const reg = getGlobalSettingsRegistry();
  if (reg && reg.getSchema(COLLAPSED_KEY)) {
    try {
      return reg.getValue<boolean>(COLLAPSED_KEY);
    } catch {
      /* fall through */
    }
  }
  try {
    return localStorage.getItem(COLLAPSED_KEY) === 'true';
  } catch {
    return false;
  }
}

/**
 * Persist the collapsed-state preference. Writes to the registry when
 * available; mirrors to localStorage as a synchronous cache for the
 * next renderer paint.
 */
function _writeCollapsed(value: boolean): void {
  const reg = getGlobalSettingsRegistry();
  if (reg && reg.getSchema(COLLAPSED_KEY)) {
    reg.setValue(COLLAPSED_KEY, value).catch((err) => {
      console.warn('[PropertyBar] settings write failed:', err);
    });
  }
  try {
    localStorage.setItem(COLLAPSED_KEY, String(value));
  } catch {
    /* localStorage may be unavailable */
  }
}

// ─── PropertyBar ─────────────────────────────────────────────────────────────

export class PropertyBar implements IDisposable {
  private _el: HTMLElement | null = null;
  private _body: HTMLElement | null = null;
  private _disposed = false;
  private _rendering = false;
  private _renderQueued = false;
  private readonly _eventDisposables: IDisposable[] = [];

  constructor(
    _container: HTMLElement,
    private readonly _insertAfter: HTMLElement,
    private readonly _pageId: string,
    private readonly _propertyService: IPropertyDataService,
    private readonly _dataService?: ICanvasDataService,
    private readonly _window?: PropertyBarWindowApi,
  ) {}

  // ── Initialise & Render ─────────────────────────────────────────────────

  async init(): Promise<void> {
    if (this._disposed) return;

    this._el = document.createElement('div');
    this._el.className = 'canvas-property-bar';

    // Restore collapsed state (M60 §7 — registry-backed; falls back to localStorage)
    const collapsed = _readCollapsed();
    if (collapsed) this._el.classList.add('collapsed');

    // Header
    const header = document.createElement('div');
    header.className = 'canvas-property-bar__header';

    const label = document.createElement('span');
    label.textContent = 'Properties';
    header.appendChild(label);

    header.addEventListener('click', () => {
      this._el!.classList.toggle('collapsed');
      _writeCollapsed(this._el!.classList.contains('collapsed'));
    });

    this._el.appendChild(header);

    // Body (collapsible)
    this._body = document.createElement('div');
    this._body.className = 'canvas-property-bar__body';
    this._el.appendChild(this._body);

    // Insert after the page header
    this._insertAfter.after(this._el);

    // Render property rows
    await this._renderProperties();

    // Subscribe to data changes
    this._eventDisposables.push(
      this._propertyService.onDidChangePageProperty((e) => {
        if (e.pageId === this._pageId) this._renderProperties();
      }),
    );
    this._eventDisposables.push(
      this._propertyService.onDidChangeDefinition(() => {
        this._renderProperties();
      }),
    );
    if (this._dataService) {
      this._eventDisposables.push(
        this._dataService.onDidChangePage((e) => {
          if (e.pageId !== this._pageId) return;
          if (e.kind === PageChangeKind.Created || e.kind === PageChangeKind.Updated) {
            this._renderProperties();
          }
        }),
      );
    }
  }

  // ── Render all property rows ──────────────────────────────────────────

  private async _renderProperties(): Promise<void> {
    if (!this._body || this._disposed) return;

    // Guard against concurrent renders — queue at most one re-render
    if (this._rendering) {
      this._renderQueued = true;
      return;
    }
    this._rendering = true;
    this._renderQueued = false;

    this._body.innerHTML = '';

    let properties: (IPageProperty & { definition: IPropertyDefinition })[];
    let allDefinitions: IPropertyDefinition[];

    try {
      [properties, allDefinitions] = await Promise.all([
        this._propertyService.getPropertiesForPage(this._pageId),
        this._propertyService.getAllDefinitions(),
      ]);
    } catch (err) {
      console.warn('[PropertyBar] Failed to load properties:', err);
      return;
    }

    // Render each property row
    for (const prop of properties) {
      const row = this._createPropertyRow(prop, prop.definition);
      this._body.appendChild(row);
    }

    // "+ Add property" button
    const addBtn = document.createElement('button');
    addBtn.className = 'canvas-property-add';

    const addIcon = document.createElement('span');
    addIcon.className = 'canvas-property-add__icon';
    addIcon.textContent = '+';
    addBtn.appendChild(addIcon);

    const addLabel = document.createElement('span');
    addLabel.textContent = 'Add property';
    addBtn.appendChild(addLabel);
    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const existingKeys = properties.map(p => p.key);
      showPropertyPicker(
        addBtn,
        existingKeys,
        allDefinitions,
        (name) => this._addExistingProperty(name),
        (name, type) => this._createAndAddProperty(name, type),
        (name) => this._deleteDefinition(name),
      );
    });
    this._body.appendChild(addBtn);

    this._rendering = false;
    if (this._renderQueued) {
      this._renderQueued = false;
      void this._renderProperties();
    }
  }

  // ── Create a single property row ──────────────────────────────────────

  private _createPropertyRow(
    prop: IPageProperty,
    definition: IPropertyDefinition,
  ): HTMLElement {
    const row = document.createElement('div');
    row.className = 'canvas-property-row';

    // Name column
    const name = document.createElement('div');
    name.className = 'canvas-property-row__name';

    const typeIcon = createTypeIconElement(definition.type, 16);
    typeIcon.classList.add('canvas-property-row__type-icon');
    name.appendChild(typeIcon);

    const label = document.createElement('span');
    label.className = 'canvas-property-row__label';
    label.textContent = prop.key;
    name.appendChild(label);

    row.appendChild(name);

    // Value column
    const value = document.createElement('div');
    value.className = 'canvas-property-row__value';

    const editor = createPropertyEditor(definition, prop.value, (newValue) => {
      this._propertyService.setProperty(this._pageId, prop.key, newValue).catch(err => {
        console.error(`[PropertyBar] Failed to save property "${prop.key}":`, err);
      });
    });
    value.appendChild(editor);
    row.appendChild(value);

    // Delete button
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'canvas-property-row__delete';
    deleteBtn.textContent = '×';
    deleteBtn.title = `Remove ${prop.key} from this page`;
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._propertyService.removeProperty(this._pageId, prop.key).catch(err => {
        console.error(`[PropertyBar] Failed to remove property "${prop.key}":`, err);
      });
    });
    row.appendChild(deleteBtn);

    if (!isSystemPropertyName(prop.key)) {
      const deleteDefinitionBtn = document.createElement('button');
      deleteDefinitionBtn.className = 'canvas-property-row__delete-definition';
      deleteDefinitionBtn.title = `Delete property "${prop.key}" everywhere`;
      deleteDefinitionBtn.appendChild(createIconElement('trash', 14));
      deleteDefinitionBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        void this._deleteDefinition(prop.key);
      });
      row.appendChild(deleteDefinitionBtn);
    }

    return row;
  }

  // ── Add Existing Property ─────────────────────────────────────────────

  private async _deleteDefinition(name: string): Promise<void> {
    if (isSystemPropertyName(name)) return;

    try {
      const usage = await this._propertyService.getPropertyUsage(name, this._pageId);
      const confirmed = await this._confirmDeleteDefinition(name, usage);
      if (!confirmed) return;

      await this._propertyService.deleteDefinition(name);
      await this._window?.showInformationMessage(`Deleted property "${name}".`);
    } catch (err) {
      console.error(`[PropertyBar] Failed to delete property definition "${name}":`, err);
      await this._window?.showErrorMessage(`Failed to delete property "${name}".`);
    }
  }

  private async _confirmDeleteDefinition(name: string, usage: IPropertyUsage): Promise<boolean> {
    const otherCount = usage.otherPages.length;
    const otherPreview = usage.otherPages.slice(0, 3).map((page) => page.title).join(', ');
    const more = otherCount > 3 ? `, and ${otherCount - 3} more` : '';
    const message = otherCount > 0
      ? `Delete property "${name}" everywhere? It is used on ${otherCount} other page${otherCount === 1 ? '' : 's'}${otherPreview ? `: ${otherPreview}${more}` : ''}. This removes the property and all of its values from every page.`
      : `Delete property "${name}" permanently? This removes it from available properties and clears its value on this page.`;

    if (this._window) {
      const result = await this._window.showWarningMessage(
        message,
        { title: 'Delete Property' },
        { title: 'Cancel' },
      );
      return result?.title === 'Delete Property';
    }

    return globalThis.confirm?.(message) ?? false;
  }

  private async _addExistingProperty(name: string): Promise<void> {
    try {
      const def = await this._propertyService.getDefinition(name);
      if (!def) return;
      // Set default value based on type
      const defaultValue = _defaultValueForType(def.type);
      await this._propertyService.setProperty(this._pageId, name, defaultValue);
    } catch (err) {
      console.error(`[PropertyBar] Failed to add property "${name}":`, err);
    }
  }

  // ── Create & Add New Property ─────────────────────────────────────────

  private async _createAndAddProperty(name: string, type: PropertyType): Promise<void> {
    try {
      await this._propertyService.createDefinition(name, type);
      const defaultValue = _defaultValueForType(type);
      await this._propertyService.setProperty(this._pageId, name, defaultValue);
    } catch (err) {
      console.error(`[PropertyBar] Failed to create property "${name}":`, err);
    }
  }

  // ── Dispose ───────────────────────────────────────────────────────────

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;

    for (const d of this._eventDisposables) d.dispose();
    this._eventDisposables.length = 0;

    if (this._el) {
      this._el.remove();
      this._el = null;
    }
    this._body = null;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function _defaultValueForType(type: PropertyType): unknown {
  switch (type) {
    case 'text': return null;
    case 'number': return null;
    case 'checkbox': return false;
    case 'date': return null;
    case 'datetime': return null;
    case 'tags': return [];
    case 'select': return null;
    case 'url': return null;
    default: return null;
  }
}
