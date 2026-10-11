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
  | 'url';

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
