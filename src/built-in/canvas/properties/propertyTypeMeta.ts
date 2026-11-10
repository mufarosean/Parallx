// propertyTypeMeta.ts — the one list of property types: label, icon, group,
// and the config a new column of that type starts with. Every picker (the
// table's + column, the page panel's Add Property, the AI's tool schema)
// reads this list, so a type added here is offered everywhere at once.

import type { PropertyType } from './propertyTypes.js';

export interface IPropertyTypeMeta {
  readonly type: PropertyType;
  readonly label: string;
  readonly icon: string;
  readonly group: 'basic' | 'advanced';
  /** One line for a picker's hint. */
  readonly hint: string;
}

export const PROPERTY_TYPE_META: readonly IPropertyTypeMeta[] = [
  { type: 'text', label: 'Text', icon: 'text', group: 'basic', hint: 'Words, a sentence, a note' },
  { type: 'number', label: 'Number', icon: 'hash', group: 'basic', hint: 'A count, an amount, a rating' },
  { type: 'select', label: 'Select', icon: 'list', group: 'basic', hint: 'One option from a list' },
  { type: 'tags', label: 'Multi-select', icon: 'tag', group: 'basic', hint: 'Any number of options' },
  { type: 'status', label: 'Status', icon: 'circle', group: 'basic', hint: 'To-do, in progress, complete' },
  { type: 'date', label: 'Date', icon: 'calendar', group: 'basic', hint: 'A day' },
  { type: 'datetime', label: 'Date & time', icon: 'clock', group: 'basic', hint: 'A day and a time' },
  { type: 'checkbox', label: 'Checkbox', icon: 'square-check', group: 'basic', hint: 'Done or not' },
  { type: 'url', label: 'URL', icon: 'link', group: 'basic', hint: 'A web address' },
  { type: 'email', label: 'Email', icon: 'mail', group: 'basic', hint: 'An email address' },
  { type: 'phone', label: 'Phone', icon: 'phone', group: 'basic', hint: 'A phone number' },
  { type: 'files', label: 'Files & media', icon: 'paperclip', group: 'basic', hint: 'Images and files kept in the workspace' },
  { type: 'relation', label: 'Relation', icon: 'arrow-right-left', group: 'advanced', hint: 'Rows of another database' },
  { type: 'rollup', label: 'Rollup', icon: 'sigma', group: 'advanced', hint: 'A summary across a relation' },
  { type: 'formula', label: 'Formula', icon: 'calculator', group: 'advanced', hint: 'Computed from the row' },
  { type: 'created_time', label: 'Created time', icon: 'calendar-clock', group: 'advanced', hint: 'When the row was made' },
  { type: 'last_edited_time', label: 'Last edited time', icon: 'history', group: 'advanced', hint: 'When the row last changed' },
  { type: 'unique_id', label: 'ID', icon: 'hash', group: 'advanced', hint: 'A number no other row has' },
];

export function propertyTypeMeta(type: PropertyType | string): IPropertyTypeMeta {
  return PROPERTY_TYPE_META.find((m) => m.type === type) ?? PROPERTY_TYPE_META[0]!;
}

export function propertyTypeLabel(type: PropertyType | string): string {
  return propertyTypeMeta(type).label;
}

/** Types a column can be, for a picker or a tool schema. */
export const ALL_PROPERTY_TYPES: readonly PropertyType[] = PROPERTY_TYPE_META.map((m) => m.type);

/** Types a user may add from a picker (the computed ones are added with their settings in their own dialogs). */
export const PICKABLE_PROPERTY_TYPES: readonly PropertyType[] = PROPERTY_TYPE_META.map((m) => m.type);

export type StatusGroup = 'todo' | 'in_progress' | 'complete';
export const STATUS_GROUPS: readonly { readonly id: StatusGroup; readonly label: string }[] = [
  { id: 'todo', label: 'To-do' },
  { id: 'in_progress', label: 'In progress' },
  { id: 'complete', label: 'Complete' },
];

export interface IStatusOption { readonly value: string; readonly color: string; readonly group: StatusGroup }

export const DEFAULT_STATUS_OPTIONS: readonly IStatusOption[] = [
  { value: 'Not started', color: 'gray', group: 'todo' },
  { value: 'In progress', color: 'blue', group: 'in_progress' },
  { value: 'Done', color: 'green', group: 'complete' },
];

/** The config a new column of `type` starts with. */
export function defaultConfigFor(type: PropertyType): Record<string, unknown> {
  switch (type) {
    case 'select': case 'tags': return { options: [] };
    case 'status': return { options: DEFAULT_STATUS_OPTIONS.map((o) => ({ ...o })) };
    case 'unique_id': return { prefix: '' };
    case 'number': return { format: 'number' };
    case 'formula': return { expression: '' };
    case 'relation': return { databaseId: '', synced: false };
    case 'rollup': return { relationId: '', propertyId: '', function: 'count' };
    default: return {};
  }
}

/** The group a status option is in ('todo' when the option is unknown or ungrouped). */
export function statusGroupOf(config: Record<string, unknown>, value: string | null | undefined): StatusGroup {
  const options = Array.isArray(config['options']) ? (config['options'] as Partial<IStatusOption>[]) : [];
  const g = options.find((o) => o.value === value)?.group;
  return g === 'in_progress' || g === 'complete' ? g : 'todo';
}
