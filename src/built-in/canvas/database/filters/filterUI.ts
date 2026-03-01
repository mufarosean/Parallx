// filterUI.ts — Filter builder UI for database views
//
// Provides a simple one-line filter bar and an advanced nested group builder.
// Manages its own lifecycle via Disposable. Fires onDidChangeFilter when
// the user modifies filter rules.
//
// Dependencies: platform/ (lifecycle, events), ui/ (dom, contextMenu, overlay),
// databaseRegistry (type-only), filterEngine (type-only)

import { Disposable, DisposableStore } from '../../../../platform/lifecycle.js';
import { Emitter, type Event } from '../../../../platform/events.js';
import { $, addDisposableListener, clearNode } from '../../../../ui/dom.js';
import { ContextMenu, type IContextMenuItem } from '../../../../ui/contextMenu.js';
import type {
  IDatabaseProperty,
  IFilterRule,
  IFilterGroup,
  FilterOperator,
} from '../databaseRegistry.js';
import { FILTER_OPERATORS_BY_TYPE } from '../databaseRegistry.js';

// ─── Operator Display Labels ─────────────────────────────────────────────────

const OPERATOR_LABELS: Record<string, string> = {
  equals: 'is',
  does_not_equal: 'is not',
  contains: 'contains',
  does_not_contain: 'does not contain',
  starts_with: 'starts with',
  ends_with: 'ends with',
  greater_than: '>',
  less_than: '<',
  greater_than_or_equal: '≥',
  less_than_or_equal: '≤',
  before: 'is before',
  after: 'is after',
  on_or_before: 'is on or before',
  on_or_after: 'is on or after',
  is_within: 'is within',
  is_empty: 'is empty',
  is_not_empty: 'is not empty',
};

const NO_VALUE_OPERATORS = new Set(['is_empty', 'is_not_empty']);

// ─── FilterPanel ─────────────────────────────────────────────────────────────

export class FilterPanel extends Disposable {
  private readonly _wrapper: HTMLElement;
  private readonly _rulesContainer: HTMLElement;
  private readonly _renderDisposables = this._register(new DisposableStore());

  private _filterConfig: IFilterGroup;
  private _properties: IDatabaseProperty[];

  // ── Events ──
  private readonly _onDidChangeFilter = this._register(new Emitter<IFilterGroup>());
  readonly onDidChangeFilter: Event<IFilterGroup> = this._onDidChangeFilter.event;

  private readonly _onDidRequestClose = this._register(new Emitter<void>());
  readonly onDidRequestClose: Event<void> = this._onDidRequestClose.event;

  constructor(
    container: HTMLElement,
    filterConfig: IFilterGroup,
    properties: IDatabaseProperty[],
  ) {
    super();

    this._filterConfig = _deepCopyFilter(filterConfig);
    this._properties = properties;

    this._wrapper = $('div.db-filter-panel');
    container.appendChild(this._wrapper);

    // Header
    const header = $('div.db-filter-panel-header');
    const title = $('span.db-filter-panel-title');
    title.textContent = 'Filter';
    header.appendChild(title);

    const conjToggle = $('button.db-filter-conjunction-btn');
    conjToggle.textContent = this._filterConfig.conjunction === 'and' ? 'And' : 'Or';
    this._register(addDisposableListener(conjToggle, 'click', () => {
      this._filterConfig = {
        ...this._filterConfig,
        conjunction: this._filterConfig.conjunction === 'and' ? 'or' : 'and',
      };
      conjToggle.textContent = this._filterConfig.conjunction === 'and' ? 'And' : 'Or';
      this._emitChange();
    }));
    header.appendChild(conjToggle);

    this._wrapper.appendChild(header);

    // Rules container
    this._rulesContainer = $('div.db-filter-rules');
    this._wrapper.appendChild(this._rulesContainer);

    // Add rule button
    const addBtn = $('button.db-filter-add-rule');
    addBtn.textContent = '+ Add filter rule';
    this._register(addDisposableListener(addBtn, 'click', () => {
      this._addRule();
    }));
    this._wrapper.appendChild(addBtn);

    this._render();
  }

  // ─── Public ──────────────────────────────────────────────────────────

  setFilter(filter: IFilterGroup): void {
    this._filterConfig = _deepCopyFilter(filter);
    this._render();
  }

  setProperties(properties: IDatabaseProperty[]): void {
    this._properties = properties;
    this._render();
  }

  getActiveFilterCount(): number {
    return this._filterConfig.rules.length;
  }

  // ─── Render ──────────────────────────────────────────────────────────

  private _render(): void {
    this._renderDisposables.clear();
    clearNode(this._rulesContainer);

    const rules = this._filterConfig.rules as (IFilterRule | IFilterGroup)[];
    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i];
      if (_isFilterGroup(rule)) {
        // Nested groups — simplified: show as separate lines
        continue; // Flat rules only for now; advanced nesting is Phase 3+ polish
      }
      this._renderRule(rule, i);
    }

    if (rules.length === 0) {
      const empty = $('div.db-filter-empty');
      empty.textContent = 'No filter rules. Click "Add filter rule" to start.';
      this._rulesContainer.appendChild(empty);
    }
  }

  private _renderRule(rule: IFilterRule, index: number): void {
    const ruleEl = $('div.db-filter-rule');

    // Property selector
    const propBtn = $('button.db-filter-rule-prop');
    const prop = this._properties.find(p => p.id === rule.propertyId);
    propBtn.textContent = prop?.name ?? 'Property';
    this._renderDisposables.add(addDisposableListener(propBtn, 'click', (e: MouseEvent) => {
      this._showPropertyPicker(e, index);
    }));

    // Operator selector
    const opBtn = $('button.db-filter-rule-op');
    opBtn.textContent = OPERATOR_LABELS[rule.operator] ?? rule.operator;
    this._renderDisposables.add(addDisposableListener(opBtn, 'click', (e: MouseEvent) => {
      this._showOperatorPicker(e, index);
    }));

    // Value input
    const valueEl = this._createValueInput(rule, index);

    // Remove button
    const removeBtn = $('button.db-filter-rule-remove');
    removeBtn.textContent = '×';
    removeBtn.title = 'Remove rule';
    this._renderDisposables.add(addDisposableListener(removeBtn, 'click', () => {
      this._removeRule(index);
    }));

    ruleEl.appendChild(propBtn);
    ruleEl.appendChild(opBtn);
    if (valueEl) ruleEl.appendChild(valueEl);
    ruleEl.appendChild(removeBtn);

    this._rulesContainer.appendChild(ruleEl);
  }

  private _createValueInput(rule: IFilterRule, index: number): HTMLElement | null {
    if (NO_VALUE_OPERATORS.has(rule.operator)) return null;

    const prop = this._properties.find(p => p.id === rule.propertyId);
    if (!prop) return null;

    // Select/Status/Multi-select: dropdown
    if (prop.type === 'select' || prop.type === 'status' || prop.type === 'multi_select') {
      const btn = $('button.db-filter-rule-value');
      btn.textContent = rule.value ? String(rule.value) : 'Select…';
      this._renderDisposables.add(addDisposableListener(btn, 'click', (e: MouseEvent) => {
        this._showValueOptionPicker(e, index, prop);
      }));
      return btn;
    }

    // Checkbox: toggle button
    if (prop.type === 'checkbox') {
      const btn = $('button.db-filter-rule-value');
      btn.textContent = rule.value === true || rule.value === 'true' ? '☑ True' : '☐ False';
      this._renderDisposables.add(addDisposableListener(btn, 'click', () => {
        const current = rule.value === true || rule.value === 'true';
        this._updateRuleValue(index, !current);
      }));
      return btn;
    }

    // Date: date input
    if (prop.type === 'date' || prop.type === 'created_time' || prop.type === 'last_edited_time') {
      if (rule.operator === 'is_within') {
        const btn = $('button.db-filter-rule-value');
        btn.textContent = _relativePeriodLabel(String(rule.value ?? ''));
        this._renderDisposables.add(addDisposableListener(btn, 'click', (e: MouseEvent) => {
          this._showRelativePeriodPicker(e, index);
        }));
        return btn;
      }
      const input = $('input.db-filter-rule-input.db-cell-editor-date') as HTMLInputElement;
      input.type = 'date';
      input.value = rule.value ? String(rule.value).slice(0, 10) : '';
      this._renderDisposables.add(addDisposableListener(input, 'change', () => {
        this._updateRuleValue(index, input.value);
      }));
      return input;
    }

    // Number: number input
    if (prop.type === 'number') {
      const input = $('input.db-filter-rule-input') as HTMLInputElement;
      input.type = 'number';
      input.step = 'any';
      input.value = rule.value != null ? String(rule.value) : '';
      this._renderDisposables.add(addDisposableListener(input, 'change', () => {
        const num = input.value === '' ? null : Number(input.value);
        this._updateRuleValue(index, num);
      }));
      return input;
    }

    // Default: text input
    const input = $('input.db-filter-rule-input') as HTMLInputElement;
    input.type = 'text';
    input.value = rule.value != null ? String(rule.value) : '';
    input.placeholder = 'Value…';
    this._renderDisposables.add(addDisposableListener(input, 'change', () => {
      this._updateRuleValue(index, input.value);
    }));
    this._renderDisposables.add(addDisposableListener(input, 'keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        this._updateRuleValue(index, input.value);
      }
    }));

    return input;
  }

  // ─── Pickers ─────────────────────────────────────────────────────────

  private _showPropertyPicker(e: MouseEvent, ruleIndex: number): void {
    const filterableProps = this._properties.filter(p => {
      const ops = FILTER_OPERATORS_BY_TYPE[p.type];
      return ops && ops.length > 0;
    });

    const items: IContextMenuItem[] = filterableProps.map(p => ({
      id: p.id,
      label: p.name,
    }));

    const target = e.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const menu = ContextMenu.show({
      items,
      anchor: new DOMRect(rect.left, rect.bottom, rect.width, 0),
      anchorPosition: 'below',
    });

    menu.onDidSelect(ev => {
      const prop = this._properties.find(p => p.id === ev.item.id);
      if (!prop) return;
      const validOps = FILTER_OPERATORS_BY_TYPE[prop.type] ?? [];
      const defaultOp = validOps[0] ?? 'equals';
      this._updateRule(ruleIndex, {
        propertyId: prop.id,
        operator: defaultOp,
        value: undefined,
      });
    });
  }

  private _showOperatorPicker(e: MouseEvent, ruleIndex: number): void {
    const rule = this._filterConfig.rules[ruleIndex] as IFilterRule;
    const prop = this._properties.find(p => p.id === rule.propertyId);
    if (!prop) return;

    const validOps = FILTER_OPERATORS_BY_TYPE[prop.type] ?? [];
    const items: IContextMenuItem[] = validOps.map(op => ({
      id: op,
      label: OPERATOR_LABELS[op] ?? op,
      className: op === rule.operator ? 'context-menu-item--selected' : '',
    }));

    const target = e.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const menu = ContextMenu.show({
      items,
      anchor: new DOMRect(rect.left, rect.bottom, rect.width, 0),
      anchorPosition: 'below',
    });

    menu.onDidSelect(ev => {
      this._updateRule(ruleIndex, {
        ...rule,
        operator: ev.item.id as FilterOperator,
      });
    });
  }

  private _showValueOptionPicker(e: MouseEvent, ruleIndex: number, prop: IDatabaseProperty): void {
    const config = prop.config as { options?: { id: string; name: string; color: string }[] };
    const options = config?.options ?? [];
    const items: IContextMenuItem[] = options.map(opt => ({
      id: opt.name,
      label: opt.name,
      renderIcon: (iconContainer: HTMLElement) => {
        const dot = $('span.db-option-dot');
        dot.style.setProperty('--db-dot-color', opt.color);
        iconContainer.appendChild(dot);
      },
    }));

    const target = e.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const menu = ContextMenu.show({
      items,
      anchor: new DOMRect(rect.left, rect.bottom, rect.width, 0),
      anchorPosition: 'below',
    });

    menu.onDidSelect(ev => {
      this._updateRuleValue(ruleIndex, ev.item.id);
    });
  }

  private _showRelativePeriodPicker(e: MouseEvent, ruleIndex: number): void {
    const periods = [
      { id: 'past_week', label: 'Past week' },
      { id: 'past_month', label: 'Past month' },
      { id: 'past_year', label: 'Past year' },
      { id: 'this_week', label: 'This week' },
      { id: 'next_week', label: 'Next week' },
      { id: 'next_month', label: 'Next month' },
      { id: 'next_year', label: 'Next year' },
    ];
    const target = e.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const menu = ContextMenu.show({
      items: periods,
      anchor: new DOMRect(rect.left, rect.bottom, rect.width, 0),
      anchorPosition: 'below',
    });
    menu.onDidSelect(ev => {
      this._updateRuleValue(ruleIndex, ev.item.id);
    });
  }

  // ─── Mutations ───────────────────────────────────────────────────────

  private _addRule(): void {
    const firstProp = this._properties.find(p => {
      const ops = FILTER_OPERATORS_BY_TYPE[p.type];
      return ops && ops.length > 0;
    });
    if (!firstProp) return;

    const ops = FILTER_OPERATORS_BY_TYPE[firstProp.type];
    const newRule: IFilterRule = {
      propertyId: firstProp.id,
      operator: ops[0],
      value: undefined,
    };

    this._filterConfig = {
      ...this._filterConfig,
      rules: [...this._filterConfig.rules, newRule],
    };
    this._render();
    this._emitChange();
  }

  private _removeRule(index: number): void {
    const rules = [...this._filterConfig.rules];
    rules.splice(index, 1);
    this._filterConfig = { ...this._filterConfig, rules };
    this._render();
    this._emitChange();
  }

  private _updateRule(index: number, newRule: IFilterRule): void {
    const rules = [...this._filterConfig.rules];
    rules[index] = newRule;
    this._filterConfig = { ...this._filterConfig, rules };
    this._render();
    this._emitChange();
  }

  private _updateRuleValue(index: number, value: unknown): void {
    const rules = [...this._filterConfig.rules];
    const rule = rules[index] as IFilterRule;
    rules[index] = { ...rule, value };
    this._filterConfig = { ...this._filterConfig, rules };
    this._render();
    this._emitChange();
  }

  private _emitChange(): void {
    this._onDidChangeFilter.fire(this._filterConfig);
  }

  // ─── Dispose ─────────────────────────────────────────────────────────

  override dispose(): void {
    if (this._wrapper.parentElement) {
      this._wrapper.remove();
    }
    super.dispose();
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function _isFilterGroup(rule: IFilterRule | IFilterGroup): rule is IFilterGroup {
  return 'conjunction' in rule && 'rules' in rule;
}

function _deepCopyFilter(filter: IFilterGroup): IFilterGroup {
  return JSON.parse(JSON.stringify(filter));
}

function _relativePeriodLabel(period: string): string {
  switch (period) {
    case 'past_week': return 'Past week';
    case 'past_month': return 'Past month';
    case 'past_year': return 'Past year';
    case 'this_week': return 'This week';
    case 'next_week': return 'Next week';
    case 'next_month': return 'Next month';
    case 'next_year': return 'Next year';
    default: return period || 'Select…';
  }
}
