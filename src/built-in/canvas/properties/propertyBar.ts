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
  PropertyType,
} from './propertyTypes.js';
import { createPropertyEditor, createTypeIconElement } from './propertyEditors.js';
import { showPropertyPicker } from './propertyPicker.js';

const COLLAPSED_KEY = 'canvas.propertyBar.collapsed';

// ─── PropertyBar ─────────────────────────────────────────────────────────────

export class PropertyBar implements IDisposable {
  private _el: HTMLElement | null = null;
  private _body: HTMLElement | null = null;
  private _disposed = false;
  private readonly _eventDisposables: IDisposable[] = [];

  constructor(
    _container: HTMLElement,
    private readonly _insertAfter: HTMLElement,
    private readonly _pageId: string,
    private readonly _propertyService: IPropertyDataService,
  ) {}

  // ── Initialise & Render ─────────────────────────────────────────────────

  async init(): Promise<void> {
    if (this._disposed) return;

    this._el = document.createElement('div');
    this._el.className = 'canvas-property-bar';

    // Restore collapsed state
    const collapsed = localStorage.getItem(COLLAPSED_KEY) === 'true';
    if (collapsed) this._el.classList.add('collapsed');

    // Header
    const header = document.createElement('div');
    header.className = 'canvas-property-bar__header';

    const label = document.createElement('span');
    label.textContent = 'Properties';
    header.appendChild(label);

    header.addEventListener('click', () => {
      this._el!.classList.toggle('collapsed');
      localStorage.setItem(COLLAPSED_KEY, String(this._el!.classList.contains('collapsed')));
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
  }

  // ── Render all property rows ──────────────────────────────────────────

  private async _renderProperties(): Promise<void> {
    if (!this._body || this._disposed) return;
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
      );
    });
    this._body.appendChild(addBtn);
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
    deleteBtn.title = `Remove ${prop.key}`;
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._propertyService.removeProperty(this._pageId, prop.key).catch(err => {
        console.error(`[PropertyBar] Failed to remove property "${prop.key}":`, err);
      });
    });
    row.appendChild(deleteBtn);

    return row;
  }

  // ── Add Existing Property ─────────────────────────────────────────────

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
