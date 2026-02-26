// propertyRenderers.ts — Pure cell renderer functions for database property values
//
// Each renderer creates/fills DOM content in a container element. They are pure
// functions with no side effects — they don't modify data or fire events.
// The dispatch function `renderPropertyValue()` routes to the correct renderer
// based on property type.
//
// IPropertyValue is a discriminated union where each variant uses a type-specific
// payload property (e.g. `{ type: 'title', title: [...] }`, not a generic `value`).
//
// Dependencies: platform/ (none), ui/dom ($), databaseRegistry (type-only)

import { $, clearNode } from '../../../../ui/dom.js';
import type {
  PropertyType,
  PropertyConfig,
  IPropertyValue,
  INumberPropertyConfig,
  IStatusPropertyConfig,
  IRichTextSegment,
  IRollupResult,
  IFormulaResult,
} from '../databaseRegistry.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const EMPTY_PLACEHOLDER = 'Empty';

function renderEmpty(container: HTMLElement): void {
  const span = $('span.db-cell-empty');
  span.textContent = EMPTY_PLACEHOLDER;
  container.appendChild(span);
}

function truncateText(text: string, maxLength = 200): string {
  return text.length > maxLength ? text.slice(0, maxLength) + '…' : text;
}

/** Extract plain text from an array of IRichTextSegment. */
function richTextToPlainText(segments: readonly IRichTextSegment[]): string {
  return segments.map(s => s.content).join('');
}

// ─── Pill / Badge Rendering ──────────────────────────────────────────────────

/** Notion-style colored pill for select/status values. */
function renderPill(container: HTMLElement, label: string, color: string): void {
  const pill = $('span.db-cell-pill');
  pill.textContent = label;
  pill.dataset.color = color;
  pill.classList.add(`db-cell-pill--${color}`);
  container.appendChild(pill);
}

// ─── Individual Renderers ────────────────────────────────────────────────────

export function renderTitle(value: IPropertyValue | undefined, container: HTMLElement): void {
  if (!value || value.type !== 'title') { renderEmpty(container); return; }
  const text = richTextToPlainText(value.title);
  if (!text) { renderEmpty(container); return; }
  const span = $('span.db-cell-title');
  span.textContent = text;
  container.appendChild(span);
}

export function renderRichText(value: IPropertyValue | undefined, container: HTMLElement): void {
  if (!value || value.type !== 'rich_text') { renderEmpty(container); return; }
  const text = richTextToPlainText(value.rich_text);
  if (!text) { renderEmpty(container); return; }
  // For now, rich text is flattened to plain text. Full inline rendering is Phase 3+.
  const span = $('span.db-cell-text');
  span.textContent = truncateText(text);
  container.appendChild(span);
}

export function renderNumber(value: IPropertyValue | undefined, config: PropertyConfig, container: HTMLElement): void {
  if (!value || value.type !== 'number' || value.number == null) {
    renderEmpty(container); return;
  }
  const numConfig = config as INumberPropertyConfig | undefined;
  const num = value.number;
  let formatted: string;

  switch (numConfig?.format) {
    case 'percent':
      formatted = `${num}%`;
      break;
    case 'dollar':
      formatted = `$${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      break;
    case 'euro':
      formatted = `€${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      break;
    case 'pound':
      formatted = `£${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      break;
    case 'yen':
      formatted = `¥${num.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
      break;
    case 'yuan':
      formatted = `¥${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      break;
    case 'number_with_commas':
      formatted = num.toLocaleString('en-US');
      break;
    default:
      formatted = String(num);
  }

  const span = $('span.db-cell-number');
  span.textContent = formatted;
  container.appendChild(span);
}

export function renderSelect(value: IPropertyValue | undefined, _config: PropertyConfig, container: HTMLElement): void {
  if (!value || value.type !== 'select' || !value.select) {
    renderEmpty(container); return;
  }
  // value.select IS the ISelectOption (has .id, .name, .color)
  renderPill(container, value.select.name, value.select.color);
}

export function renderMultiSelect(value: IPropertyValue | undefined, _config: PropertyConfig, container: HTMLElement): void {
  if (!value || value.type !== 'multi_select' || value.multi_select.length === 0) {
    renderEmpty(container); return;
  }
  const wrap = $('div.db-cell-pill-container');
  for (const option of value.multi_select) {
    renderPill(wrap, option.name, option.color);
  }
  container.appendChild(wrap);
}

export function renderStatus(value: IPropertyValue | undefined, config: PropertyConfig, container: HTMLElement): void {
  if (!value || value.type !== 'status' || !value.status) {
    renderEmpty(container); return;
  }
  // value.status IS the ISelectOption
  const statusConfig = config as IStatusPropertyConfig | undefined;
  let groupColor = value.status.color;

  // Try to find the group color for the option
  if (statusConfig?.groups) {
    for (const group of statusConfig.groups) {
      if (group.optionIds.includes(value.status.id)) {
        groupColor = group.color;
        break;
      }
    }
  }
  renderPill(container, value.status.name, groupColor);
}

export function renderDate(value: IPropertyValue | undefined, container: HTMLElement): void {
  if (!value || value.type !== 'date' || !value.date) {
    renderEmpty(container); return;
  }
  const { start, end } = value.date;
  const span = $('span.db-cell-date');
  const startFormatted = _formatDate(start);
  span.textContent = end ? `${startFormatted} → ${_formatDate(end)}` : startFormatted;
  container.appendChild(span);
}

function _formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

export function renderCheckbox(value: IPropertyValue | undefined, container: HTMLElement): void {
  const checked = value?.type === 'checkbox' && value.checkbox === true;
  const checkbox = $('div.db-cell-checkbox');
  checkbox.classList.toggle('checked', checked);
  checkbox.setAttribute('role', 'checkbox');
  checkbox.setAttribute('aria-checked', String(checked));
  checkbox.textContent = checked ? '✓' : '';
  container.appendChild(checkbox);
}

export function renderUrl(value: IPropertyValue | undefined, container: HTMLElement): void {
  if (!value || value.type !== 'url' || !value.url) {
    renderEmpty(container); return;
  }
  const link = $('a.db-cell-url') as HTMLAnchorElement;
  link.href = value.url;
  link.textContent = truncateText(value.url, 50);
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  container.appendChild(link);
}

export function renderEmail(value: IPropertyValue | undefined, container: HTMLElement): void {
  if (!value || value.type !== 'email' || !value.email) {
    renderEmpty(container); return;
  }
  const link = $('a.db-cell-email') as HTMLAnchorElement;
  link.href = `mailto:${value.email}`;
  link.textContent = value.email;
  container.appendChild(link);
}

export function renderPhone(value: IPropertyValue | undefined, container: HTMLElement): void {
  if (!value || value.type !== 'phone_number' || !value.phone_number) {
    renderEmpty(container); return;
  }
  const span = $('span.db-cell-phone');
  span.textContent = value.phone_number;
  container.appendChild(span);
}

export function renderFiles(value: IPropertyValue | undefined, container: HTMLElement): void {
  if (!value || value.type !== 'files' || value.files.length === 0) {
    renderEmpty(container); return;
  }
  const wrap = $('div.db-cell-files');
  for (const file of value.files) {
    const link = $('a.db-cell-file-link') as HTMLAnchorElement;
    link.href = file.external.url;
    link.textContent = file.name || 'File';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    wrap.appendChild(link);
  }
  container.appendChild(wrap);
}

export function renderTimestamp(value: IPropertyValue | undefined, container: HTMLElement): void {
  if (!value) { renderEmpty(container); return; }

  let ts: string | null = null;
  if (value.type === 'created_time') ts = value.created_time;
  else if (value.type === 'last_edited_time') ts = value.last_edited_time;

  if (!ts) { renderEmpty(container); return; }

  const span = $('span.db-cell-timestamp');
  span.textContent = _formatRelativeTime(ts);
  span.title = new Date(ts).toLocaleString();
  container.appendChild(span);
}

function _formatRelativeTime(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHrs = Math.floor(diffMins / 60);
    if (diffHrs < 24) return `${diffHrs}h ago`;
    const diffDays = Math.floor(diffHrs / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return dateStr;
  }
}

export function renderUniqueId(value: IPropertyValue | undefined, container: HTMLElement): void {
  if (!value || value.type !== 'unique_id') { renderEmpty(container); return; }
  const span = $('span.db-cell-unique-id');
  const { prefix, number: num } = value.unique_id;
  span.textContent = prefix ? `${prefix}-${num}` : String(num);
  container.appendChild(span);
}

// ─── Relation Renderer ───────────────────────────────────────────────────────

/**
 * Render a relation property value as a list of clickable page title pills.
 *
 * The relation value stores `{ id }[]` — in a real view with data service
 * context, these are resolved to page titles by the view. Here we render using
 * pre-resolved titles passed via the `resolvedTitles` map on the container's
 * dataset, or fall back to page IDs.
 */
export function renderRelation(
  value: IPropertyValue | undefined,
  container: HTMLElement,
  resolvedTitles?: ReadonlyMap<string, string>,
): void {
  if (!value || value.type !== 'relation' || value.relation.length === 0) {
    renderEmpty(container);
    return;
  }

  const wrapper = $('span.db-cell-relation');
  for (const ref of value.relation) {
    const pill = $('span.db-cell-relation-pill');
    pill.textContent = resolvedTitles?.get(ref.id) ?? ref.id.slice(0, 8);
    pill.dataset.pageId = ref.id;
    pill.title = resolvedTitles?.get(ref.id) ?? ref.id;
    wrapper.appendChild(pill);
  }
  container.appendChild(wrapper);
}

// ─── Formula Renderer ────────────────────────────────────────────────────────

/**
 * Render a formula property value based on its computed result.
 *
 * Dispatches based on the formula result's output type (number, string, date,
 * boolean). Displays errors inline with a distinctive style.
 */
export function renderFormula(
  value: IPropertyValue | undefined,
  container: HTMLElement,
  formulaResult?: IFormulaResult,
): void {
  const result = formulaResult ?? _formulaValueToResult(value);
  if (!result) { renderEmpty(container); return; }

  if (result.error) {
    const errSpan = $('span.db-cell-formula-error');
    errSpan.textContent = `⚠ ${result.error}`;
    errSpan.title = result.error;
    container.appendChild(errSpan);
    return;
  }

  const span = $('span.db-cell-formula');

  switch (result.type) {
    case 'number':
      span.textContent = result.value != null ? _formatNumber(result.value as number) : 'Empty';
      break;
    case 'date':
      span.textContent = result.value ? String(result.value) : 'Empty';
      break;
    case 'boolean':
      span.textContent = result.value ? 'Yes' : 'No';
      break;
    case 'string':
    default:
      span.textContent = result.value != null ? truncateText(String(result.value)) : 'Empty';
  }

  container.appendChild(span);
}

/** Convert stored formula IPropertyValue to IFormulaResult. */
function _formulaValueToResult(value: IPropertyValue | undefined): IFormulaResult | null {
  if (!value || value.type !== 'formula') return null;
  const formula = value.formula as unknown as Record<string, unknown>;
  const type = (formula.type as IFormulaResult['type']) ?? 'string';
  const v = formula.string ?? formula.number ?? formula.boolean ?? formula.date ?? null;
  return { type, value: v };
}

// ─── Rollup Renderer ─────────────────────────────────────────────────────────

/**
 * Render a rollup property value based on its computed result type.
 *
 * The rollup value in storage is `{ type: 'rollup', rollup: { type, ... } }`.
 * This renderer dispatches based on the rollup's output type.
 */
export function renderRollup(
  value: IPropertyValue | undefined,
  container: HTMLElement,
  rollupResult?: IRollupResult,
): void {
  // Prefer the live-computed result if available
  const result = rollupResult ?? _rollupValueToResult(value);
  if (!result) { renderEmpty(container); return; }

  const span = $('span.db-cell-rollup');

  switch (result.type) {
    case 'number':
      span.textContent = result.value != null ? _formatNumber(result.value as number) : 'Empty';
      break;
    case 'percent':
      span.textContent = `${_formatNumber(result.value as number)}%`;
      break;
    case 'date':
      span.textContent = result.value ? String(result.value) : 'Empty';
      break;
    case 'array': {
      const arr = result.value as string[];
      span.textContent = arr.length > 0 ? arr.join(', ') : 'Empty';
      break;
    }
    case 'boolean':
      span.textContent = result.value ? 'Yes' : 'No';
      break;
    default:
      span.textContent = result.value != null ? String(result.value) : 'Empty';
  }

  container.appendChild(span);
}

/** Convert stored rollup IPropertyValue to IRollupResult. */
function _rollupValueToResult(value: IPropertyValue | undefined): IRollupResult | null {
  if (!value || value.type !== 'rollup') return null;

  const rollup = value.rollup as unknown as Record<string, unknown>;
  const type = rollup.type as IRollupResult['type'];

  switch (type) {
    case 'number':
      return { type: 'number', value: (rollup.number as number | null) };
    case 'date':
      return { type: 'date', value: (rollup.date as string | null) };
    case 'string':
      return { type: 'string', value: (rollup.string as string) };
    case 'boolean':
      return { type: 'boolean', value: (rollup.boolean as boolean) };
    case 'array':
      return { type: 'array', value: (rollup.array as string[]) ?? [] };
    case 'percent':
      return { type: 'percent', value: (rollup.number as number) };
    default:
      return null;
  }
}

/** Format a number with up to 2 decimal places. */
function _formatNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

// ─── Dispatch ────────────────────────────────────────────────────────────────

/**
 * Render a property value into a container element.
 * Routes to the correct type-specific renderer.
 */
export function renderPropertyValue(
  type: PropertyType,
  value: IPropertyValue | undefined,
  config: PropertyConfig,
  container: HTMLElement,
): void {
  clearNode(container);

  switch (type) {
    case 'title':            renderTitle(value, container); break;
    case 'rich_text':        renderRichText(value, container); break;
    case 'number':           renderNumber(value, config, container); break;
    case 'select':           renderSelect(value, config, container); break;
    case 'multi_select':     renderMultiSelect(value, config, container); break;
    case 'status':           renderStatus(value, config, container); break;
    case 'date':             renderDate(value, container); break;
    case 'checkbox':         renderCheckbox(value, container); break;
    case 'url':              renderUrl(value, container); break;
    case 'email':            renderEmail(value, container); break;
    case 'phone_number':     renderPhone(value, container); break;
    case 'files':            renderFiles(value, container); break;
    case 'created_time':     renderTimestamp(value, container); break;
    case 'last_edited_time': renderTimestamp(value, container); break;
    case 'relation':         renderRelation(value, container); break;
    case 'rollup':           renderRollup(value, container); break;
    case 'formula':          renderFormula(value, container); break;
    case 'unique_id':        renderUniqueId(value, container); break;
    default:                 renderEmpty(container);
  }
}
