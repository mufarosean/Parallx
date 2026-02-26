// databaseToolbar.ts — Toolbar row for filter, sort, grouping, and property visibility
//
// Sits between the ViewTabBar and the active view in the DatabaseEditorPane.
// Provides buttons that open inline panels for each concern. Fires change
// events that the pane uses to update view config via DatabaseDataService.
//
// Dependencies: platform/ (lifecycle, events), ui/ (dom, contextMenu),
// databaseRegistry (type-only)

import { Disposable, DisposableStore } from '../../../../platform/lifecycle.js';
import { Emitter, type Event } from '../../../../platform/events.js';
import { $, addDisposableListener, clearNode } from '../../../../ui/dom.js';
import { ContextMenu, type IContextMenuItem } from '../../../../ui/contextMenu.js';
import type {
  IDatabaseProperty,
  ISortRule,
  IDatabaseView,
  ViewUpdateData,
} from '../databaseRegistry.js';
import { FilterPanel, svgIcon } from '../databaseRegistry.js';

// ─── Operator Display Labels (for sort display) ──────────────────────────────

const SORT_DIR_LABELS = { ascending: '↑ Ascending', descending: '↓ Descending' };

/** Icon IDs for toolbar buttons — resolved via svgIcon(). */
const TOOLBAR_ICON_IDS = {
  filter: 'db-filter',
  sort: 'db-sort',
  group: 'db-group',
  search: 'search',
  settings: 'db-settings',
} as const;

// ─── DatabaseToolbar ─────────────────────────────────────────────────────────

export class DatabaseToolbar extends Disposable {
  private readonly _wrapper: HTMLElement;
  private readonly _panelContainer: HTMLElement;
  private readonly _renderDisposables = this._register(new DisposableStore());

  // ── Active panel ──
  private _activePanel: 'filter' | 'sort' | 'group' | 'properties' | null = null;
  private readonly _panelDisposables = this._register(new DisposableStore());

  // ── Data ──
  private _view: IDatabaseView;
  private _properties: IDatabaseProperty[];

  // ── Events ──
  private readonly _onDidUpdateView = this._register(new Emitter<ViewUpdateData>());
  readonly onDidUpdateView: Event<ViewUpdateData> = this._onDidUpdateView.event;

  private readonly _onDidRequestNewRow = this._register(new Emitter<void>());
  readonly onDidRequestNewRow: Event<void> = this._onDidRequestNewRow.event;

  constructor(
    container: HTMLElement,
    view: IDatabaseView,
    properties: IDatabaseProperty[],
    panelContainerTarget?: HTMLElement,
  ) {
    super();
    this._view = view;
    this._properties = properties;

    this._wrapper = $('div.db-toolbar');
    container.appendChild(this._wrapper);

    this._panelContainer = $('div.db-toolbar-panel-container');
    (panelContainerTarget ?? container).appendChild(this._panelContainer);

    this._renderButtons();
  }

  // ─── Public ──────────────────────────────────────────────────────────

  setView(view: IDatabaseView): void {
    this._view = view;
    this._renderButtons();
  }

  setProperties(properties: IDatabaseProperty[]): void {
    this._properties = properties;
    this._renderButtons();
  }

  setCollapsed(collapsed: boolean): void {
    this._wrapper.classList.toggle('db-toolbar--collapsed', collapsed);
  }

  // ─── Button Strip ────────────────────────────────────────────────────

  private _renderButtons(): void {
    this._renderDisposables.clear();
    clearNode(this._wrapper);

    const createButton = (
      iconId: string,
      label: string,
      isActive: boolean,
      isOpen: boolean,
      onClick: () => void,
      count?: number,
    ): HTMLButtonElement => {
      const button = $('button.db-toolbar-btn') as HTMLButtonElement;
      button.title = count && count > 0 ? `${label} (${count})` : label;
      button.setAttribute('aria-label', button.title);

      const iconEl = $('span.db-toolbar-btn-icon');
      iconEl.innerHTML = svgIcon(iconId);
      button.appendChild(iconEl);

      const labelEl = $('span.db-toolbar-btn-label');
      labelEl.textContent = label;
      button.appendChild(labelEl);

      if (typeof count === 'number' && count > 0) {
        const badge = $('span.db-toolbar-btn-badge');
        badge.textContent = String(count);
        button.appendChild(badge);
      }

      if (isActive) button.classList.add('db-toolbar-btn--active');
      if (isOpen) button.classList.add('db-toolbar-btn--open');

      this._renderDisposables.add(addDisposableListener(button, 'click', onClick));
      return button;
    };

    // Filter button
    const filterCount = this._view.filterConfig?.rules?.length ?? 0;
    const filterBtn = createButton(TOOLBAR_ICON_IDS.filter, 'Filter', filterCount > 0, this._activePanel === 'filter', () => {
      this._togglePanel('filter');
    }, filterCount);
    this._wrapper.appendChild(filterBtn);

    // Sort button
    const sortCount = this._view.sortConfig?.length ?? 0;
    const sortBtn = createButton(TOOLBAR_ICON_IDS.sort, 'Sort', sortCount > 0, this._activePanel === 'sort', () => {
      this._togglePanel('sort');
    }, sortCount);
    this._wrapper.appendChild(sortBtn);

    // Group button
    const groupBy = this._view.groupBy;
    const groupProp = groupBy ? this._properties.find(p => p.id === groupBy) : null;
    const groupBtn = createButton(TOOLBAR_ICON_IDS.group, 'Group', !!groupProp, this._activePanel === 'group', () => {
      this._togglePanel('group');
    });
    this._wrapper.appendChild(groupBtn);

    const searchBtn = createButton(TOOLBAR_ICON_IDS.search, 'Search', false, false, () => {
      // Search UI to be wired in a future slice.
    });
    this._wrapper.appendChild(searchBtn);

    // Properties button
    const propsBtn = createButton(TOOLBAR_ICON_IDS.settings, 'Properties', false, this._activePanel === 'properties', () => {
      this._togglePanel('properties');
    });
    this._wrapper.appendChild(propsBtn);

    // Spacer to push New button to the right
    const spacer = $('div.db-toolbar-spacer');
    this._wrapper.appendChild(spacer);

    // New button — primary action
    const newBtn = $('button.db-toolbar-new-btn');
    newBtn.textContent = 'New ▾';
    this._renderDisposables.add(addDisposableListener(newBtn, 'click', () => {
      this._onDidRequestNewRow.fire();
    }));
    this._wrapper.appendChild(newBtn);
  }

  // ─── Panel Toggle ────────────────────────────────────────────────────

  private _togglePanel(panel: 'filter' | 'sort' | 'group' | 'properties'): void {
    if (this._activePanel === panel) {
      this._closePanel();
      return;
    }

    this._closePanel();
    this._activePanel = panel;
    this._renderButtons();

    switch (panel) {
      case 'filter': this._renderFilterPanel(); break;
      case 'sort': this._renderSortPanel(); break;
      case 'group': this._renderGroupPanel(); break;
      case 'properties': this._renderPropertiesPanel(); break;
    }
  }

  private _closePanel(): void {
    this._activePanel = null;
    this._panelDisposables.clear();
    clearNode(this._panelContainer);
    this._renderButtons();
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Filter Panel
  // ═══════════════════════════════════════════════════════════════════════

  private _renderFilterPanel(): void {
    const filterPanel = new FilterPanel(
      this._panelContainer,
      this._view.filterConfig,
      this._properties,
    );
    this._panelDisposables.add(filterPanel);

    filterPanel.onDidChangeFilter(newFilter => {
      this._view = { ...this._view, filterConfig: newFilter };
      this._onDidUpdateView.fire({ filterConfig: newFilter });
      this._renderButtons();
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Sort Panel
  // ═══════════════════════════════════════════════════════════════════════

  private _renderSortPanel(): void {
    const panel = $('div.db-sort-panel');

    const sorts: ISortRule[] = [...(this._view.sortConfig ?? [])];
    this._renderSortRules(panel, sorts);

    this._panelContainer.appendChild(panel);
  }

  private _renderSortRules(panel: HTMLElement, sorts: ISortRule[]): void {
    clearNode(panel);
    const renderStore = new DisposableStore();
    this._panelDisposables.add(renderStore);

    // Header
    const header = $('div.db-sort-panel-header');
    const title = $('span.db-sort-panel-title');
    title.textContent = 'Sort';
    header.appendChild(title);
    panel.appendChild(header);

    // Rules
    const rulesContainer = $('div.db-sort-rules');
    for (let i = 0; i < sorts.length; i++) {
      const rule = sorts[i];
      const ruleEl = $('div.db-sort-rule');
      ruleEl.draggable = true;
      ruleEl.dataset.sortIndex = String(i);

      // Drag handle
      const handle = $('span.db-sort-drag-handle');
      handle.textContent = '⠿';
      ruleEl.appendChild(handle);

      // Drag-to-reorder listeners
      renderStore.add(addDisposableListener(ruleEl, 'dragstart', (e: DragEvent) => {
        e.dataTransfer?.setData('text/plain', String(i));
        ruleEl.classList.add('db-sort-rule--dragging');
      }));
      renderStore.add(addDisposableListener(ruleEl, 'dragend', () => {
        ruleEl.classList.remove('db-sort-rule--dragging');
      }));
      renderStore.add(addDisposableListener(ruleEl, 'dragover', (e: DragEvent) => {
        e.preventDefault();
        ruleEl.classList.add('db-sort-rule--dragover');
      }));
      renderStore.add(addDisposableListener(ruleEl, 'dragleave', () => {
        ruleEl.classList.remove('db-sort-rule--dragover');
      }));
      renderStore.add(addDisposableListener(ruleEl, 'drop', (e: DragEvent) => {
        e.preventDefault();
        ruleEl.classList.remove('db-sort-rule--dragover');
        const fromIdx = parseInt(e.dataTransfer?.getData('text/plain') ?? '', 10);
        if (isNaN(fromIdx) || fromIdx === i) return;
        const [moved] = sorts.splice(fromIdx, 1);
        sorts.splice(i, 0, moved);
        this._emitSortChange(sorts);
        this._renderSortRules(panel, sorts);
      }));

      // Property selector
      const propBtn = $('button.db-sort-rule-prop');
      const prop = this._properties.find(p => p.id === rule.propertyId);
      propBtn.textContent = prop?.name ?? 'Property';
      renderStore.add(addDisposableListener(propBtn, 'click', (e: MouseEvent) => {
        const items: IContextMenuItem[] = this._properties.map(p => ({
          id: p.id,
          label: p.name,
          className: p.id === rule.propertyId ? 'context-menu-item--selected' : '',
        }));
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const menu = ContextMenu.show({
          items,
          anchor: new DOMRect(rect.left, rect.bottom, rect.width, 0),
          anchorPosition: 'below',
        });
        menu.onDidSelect(ev => {
          sorts[i] = { ...sorts[i], propertyId: ev.item.id };
          this._emitSortChange(sorts);
          this._renderSortRules(panel, sorts);
        });
      }));

      // Direction toggle
      const dirBtn = $('button.db-sort-rule-dir');
      dirBtn.textContent = SORT_DIR_LABELS[rule.direction];
      renderStore.add(addDisposableListener(dirBtn, 'click', () => {
        sorts[i] = {
          ...sorts[i],
          direction: sorts[i].direction === 'ascending' ? 'descending' : 'ascending',
        };
        this._emitSortChange(sorts);
        this._renderSortRules(panel, sorts);
      }));

      // Remove
      const removeBtn = $('button.db-sort-rule-remove');
      removeBtn.textContent = '×';
      renderStore.add(addDisposableListener(removeBtn, 'click', () => {
        sorts.splice(i, 1);
        this._emitSortChange(sorts);
        this._renderSortRules(panel, sorts);
      }));

      ruleEl.appendChild(propBtn);
      ruleEl.appendChild(dirBtn);
      ruleEl.appendChild(removeBtn);
      rulesContainer.appendChild(ruleEl);
    }
    panel.appendChild(rulesContainer);

    // Add sort button
    const addBtn = $('button.db-sort-add-rule');
    addBtn.textContent = '+ Add sort';
    renderStore.add(addDisposableListener(addBtn, 'click', () => {
      const firstProp = this._properties[0];
      if (!firstProp) return;
      sorts.push({ propertyId: firstProp.id, direction: 'ascending' });
      this._emitSortChange(sorts);
      this._renderSortRules(panel, sorts);
    }));
    panel.appendChild(addBtn);

    if (sorts.length === 0) {
      const empty = $('div.db-sort-empty');
      empty.textContent = 'No sort rules. Click "Add sort" to start.';
      rulesContainer.appendChild(empty);
    }
  }

  private _emitSortChange(sorts: ISortRule[]): void {
    const newSorts = [...sorts];
    this._view = { ...this._view, sortConfig: newSorts };
    this._onDidUpdateView.fire({ sortConfig: newSorts });
    this._renderButtons();
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Group Panel
  // ═══════════════════════════════════════════════════════════════════════

  private _renderGroupPanel(): void {
    const panel = $('div.db-group-panel');

    // Header
    const header = $('div.db-group-panel-header');
    const title = $('span.db-group-panel-title');
    title.textContent = 'Group';
    header.appendChild(title);
    panel.appendChild(header);

    const renderStore = new DisposableStore();
    this._panelDisposables.add(renderStore);

    // Group-by selector
    const groupBySection = $('div.db-group-section');
    const groupByLabel = $('span.db-group-section-label');
    groupByLabel.textContent = 'Group by';
    groupBySection.appendChild(groupByLabel);

    const groupByBtn = $('button.db-group-selector');
    const currentGroupProp = this._view.groupBy
      ? this._properties.find(p => p.id === this._view.groupBy)
      : null;
    groupByBtn.textContent = currentGroupProp?.name ?? 'None';
    renderStore.add(addDisposableListener(groupByBtn, 'click', (e: MouseEvent) => {
      this._showGroupByPicker(e, 'groupBy', this._view.groupBy);
    }));
    groupBySection.appendChild(groupByBtn);
    panel.appendChild(groupBySection);

    // Sub-group-by selector (only if group-by is set)
    if (this._view.groupBy) {
      const subSection = $('div.db-group-section');
      const subLabel = $('span.db-group-section-label');
      subLabel.textContent = 'Sub-group by';
      subSection.appendChild(subLabel);

      const subGroupProp = this._view.subGroupBy
        ? this._properties.find(p => p.id === this._view.subGroupBy)
        : null;
      const subBtn = $('button.db-group-selector');
      subBtn.textContent = subGroupProp?.name ?? 'None';
      renderStore.add(addDisposableListener(subBtn, 'click', (e: MouseEvent) => {
        this._showGroupByPicker(e, 'subGroupBy', this._view.subGroupBy);
      }));
      subSection.appendChild(subBtn);
      panel.appendChild(subSection);

      // Hide empty groups toggle
      const hideSection = $('div.db-group-section');
      const hideLabel = $('label.db-group-toggle');
      const hideCheckbox = $('input') as HTMLInputElement;
      hideCheckbox.type = 'checkbox';
      hideCheckbox.checked = this._view.hideEmptyGroups;
      renderStore.add(addDisposableListener(hideCheckbox, 'change', () => {
        this._view = { ...this._view, hideEmptyGroups: hideCheckbox.checked };
        this._onDidUpdateView.fire({ hideEmptyGroups: hideCheckbox.checked });
      }));
      hideLabel.appendChild(hideCheckbox);
      const hideText = document.createTextNode(' Hide empty groups');
      hideLabel.appendChild(hideText);
      hideSection.appendChild(hideLabel);
      panel.appendChild(hideSection);
    }

    this._panelContainer.appendChild(panel);
  }

  private _showGroupByPicker(e: MouseEvent, field: 'groupBy' | 'subGroupBy', currentId: string | null): void {
    const groupableTypes = new Set<string>(['select', 'multi_select', 'status', 'checkbox', 'date', 'created_time', 'last_edited_time', 'number']);
    const items: IContextMenuItem[] = [
      { id: '__none__', label: 'None', className: !currentId ? 'context-menu-item--selected' : '' },
      ...this._properties
        .filter(p => groupableTypes.has(p.type))
        .map(p => ({
          id: p.id,
          label: p.name,
          className: p.id === currentId ? 'context-menu-item--selected' : '',
        })),
    ];

    const target = e.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const menu = ContextMenu.show({
      items,
      anchor: new DOMRect(rect.left, rect.bottom, rect.width, 0),
      anchorPosition: 'below',
    });

    menu.onDidSelect(ev => {
      const newId = ev.item.id === '__none__' ? null : ev.item.id;
      let updates: ViewUpdateData = { [field]: newId };

      // Clear sub-group when removing group
      if (field === 'groupBy' && !newId) {
        updates = { ...updates, subGroupBy: null, hideEmptyGroups: false };
      }

      this._view = { ...this._view, ...updates } as IDatabaseView;
      this._onDidUpdateView.fire(updates);
      this._renderButtons();
      this._closePanel();
      this._activePanel = 'group';
      this._renderGroupPanel();
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Properties Visibility Panel
  // ═══════════════════════════════════════════════════════════════════════

  private _renderPropertiesPanel(): void {
    const panel = $('div.db-props-panel');

    // Header
    const header = $('div.db-props-panel-header');
    const title = $('span.db-props-panel-title');
    title.textContent = 'Properties';
    header.appendChild(title);
    panel.appendChild(header);

    const renderStore = new DisposableStore();
    this._panelDisposables.add(renderStore);

    // Get current visible properties
    const visibleIds = new Set(this._view.config.visibleProperties ?? this._properties.map(p => p.id));
    const orderedProps = this._getOrderedProperties(visibleIds);

    const listContainer = $('div.db-props-list');

    for (const prop of orderedProps) {
      const isTitle = prop.type === 'title';
      const isVisible = isTitle || visibleIds.has(prop.id);
      const row = $('div.db-props-row');

      // Drag handle
      const handle = $('span.db-props-drag-handle');
      handle.textContent = '⋮⋮';
      handle.draggable = !isTitle;
      row.appendChild(handle);

      // Property name
      const label = $('span.db-props-label');
      label.textContent = prop.name;
      if (isTitle) label.classList.add('db-props-label--title');
      row.appendChild(label);

      // Toggle checkbox
      const toggle = $('input.db-props-toggle') as HTMLInputElement;
      toggle.type = 'checkbox';
      toggle.checked = isVisible;
      toggle.disabled = isTitle; // Title cannot be hidden
      renderStore.add(addDisposableListener(toggle, 'change', () => {
        if (toggle.checked) {
          visibleIds.add(prop.id);
        } else {
          visibleIds.delete(prop.id);
        }
        this._emitPropertyVisibilityChange(visibleIds);
      }));
      row.appendChild(toggle);

      // Drag-and-drop for reordering
      if (!isTitle) {
        row.draggable = true;
        row.dataset.propertyId = prop.id;
        renderStore.add(addDisposableListener(row, 'dragstart', (e: DragEvent) => {
          e.dataTransfer?.setData('text/plain', prop.id);
          row.classList.add('db-props-row--dragging');
        }));
        renderStore.add(addDisposableListener(row, 'dragend', () => {
          row.classList.remove('db-props-row--dragging');
        }));
        renderStore.add(addDisposableListener(row, 'dragover', (e: DragEvent) => {
          e.preventDefault();
          row.classList.add('db-props-row--dragover');
        }));
        renderStore.add(addDisposableListener(row, 'dragleave', () => {
          row.classList.remove('db-props-row--dragover');
        }));
        renderStore.add(addDisposableListener(row, 'drop', (e: DragEvent) => {
          e.preventDefault();
          row.classList.remove('db-props-row--dragover');
          const fromId = e.dataTransfer?.getData('text/plain');
          if (fromId && fromId !== prop.id) {
            this._reorderVisibleProperty(fromId, prop.id, visibleIds);
          }
        }));
      }

      listContainer.appendChild(row);
    }

    panel.appendChild(listContainer);
    this._panelContainer.appendChild(panel);
  }

  private _getOrderedProperties(_visibleIds: Set<string>): IDatabaseProperty[] {
    // Title first, then visible in config order, then hidden
    const titleProp = this._properties.find(p => p.type === 'title');
    const visibleOrder = this._view.config.visibleProperties ?? this._properties.map(p => p.id);
    const ordered: IDatabaseProperty[] = [];
    const seen = new Set<string>();

    // Title always first
    if (titleProp) {
      ordered.push(titleProp);
      seen.add(titleProp.id);
    }

    // Visible in order
    for (const id of visibleOrder) {
      if (seen.has(id)) continue;
      const prop = this._properties.find(p => p.id === id);
      if (prop) {
        ordered.push(prop);
        seen.add(id);
      }
    }

    // Remaining (hidden)
    for (const prop of this._properties) {
      if (!seen.has(prop.id)) {
        ordered.push(prop);
      }
    }

    return ordered;
  }

  private _emitPropertyVisibilityChange(visibleIds: Set<string>): void {
    const visibleProperties = this._properties
      .filter(p => p.type === 'title' || visibleIds.has(p.id))
      .map(p => p.id);

    const newConfig = { ...this._view.config, visibleProperties };
    this._view = { ...this._view, config: newConfig };
    this._onDidUpdateView.fire({ config: newConfig });
  }

  private _reorderVisibleProperty(fromId: string, targetId: string, _visibleIds: Set<string>): void {
    const currentOrder = this._view.config.visibleProperties
      ?? this._properties.map(p => p.id);

    const order = currentOrder.filter(id => id !== fromId);
    const targetIdx = order.indexOf(targetId);
    if (targetIdx >= 0) {
      order.splice(targetIdx, 0, fromId);
    } else {
      order.push(fromId);
    }

    const newConfig = { ...this._view.config, visibleProperties: order };
    this._view = { ...this._view, config: newConfig };
    this._onDidUpdateView.fire({ config: newConfig });
    // Re-render panel to reflect new order
    this._panelDisposables.clear();
    clearNode(this._panelContainer);
    this._renderPropertiesPanel();
  }

  // ─── Dispose ─────────────────────────────────────────────────────────

  override dispose(): void {
    if (this._wrapper.parentElement) {
      this._wrapper.remove();
    }
    if (this._panelContainer.parentElement) {
      this._panelContainer.remove();
    }
    super.dispose();
  }
}
