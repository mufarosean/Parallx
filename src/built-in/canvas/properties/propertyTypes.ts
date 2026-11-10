// propertyTypes.ts — type definitions for canvas properties.
//
// Defines the property type union, definition/value interfaces, and
// type-specific configuration shapes — shared by the DATABASE system
// (databaseDataService + database views), where properties live.

export const SYSTEM_PROPERTY_NAMES: ReadonlySet<string> = new Set(['tags', 'created', 'modified']);

export function isSystemPropertyName(name: string): boolean {
  return SYSTEM_PROPERTY_NAMES.has(name);
}

// ─── Property Types ──────────────────────────────────────────────────────────

export type PropertyType =
  | 'text'
  | 'number'
  | 'checkbox'
  | 'date'
  | 'datetime'
  | 'tags'
  | 'select'
  | 'url'
  // Round 2 (docs/DATABASES.md step 3): stored like text or a select …
  | 'status'
  | 'email'
  | 'phone'
  | 'files'
  | 'unique_id'
  // … or never stored: derived from the row when it is read (rowCompute.ts).
  | 'created_time'
  | 'last_edited_time'
  | 'formula'
  | 'relation'
  | 'rollup';

/** Types whose value is derived when read, never written to a cell. */
export const COMPUTED_PROPERTY_TYPES: ReadonlySet<PropertyType> = new Set<PropertyType>(['created_time', 'last_edited_time', 'formula', 'rollup']);

export function isComputedType(type: PropertyType): boolean {
  return COMPUTED_PROPERTY_TYPES.has(type);
}

// ─── Property Definition ─────────────────────────────────────────────────────

export interface IPropertyDefinition {
  readonly name: string;
  readonly type: PropertyType;
  readonly config: Record<string, unknown>;
  readonly sortOrder: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

// ─── Select options ──────────────────────────────────────────────────────────

export interface ISelectOption {
  readonly value: string;
  readonly color: string;
}
