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

// ─── Page Property (value on a specific page) ────────────────────────────────

export interface IPageProperty {
  readonly id: string;
  readonly pageId: string;
  readonly key: string;
  readonly valueType: string;
  readonly value: unknown;
}

export interface IPropertyUsagePage {
  readonly pageId: string;
  readonly title: string;
}

export interface IPropertyUsage {
  readonly totalCount: number;
  readonly pages: readonly IPropertyUsagePage[];
  readonly otherPages: readonly IPropertyUsagePage[];
}

// ─── Type-Specific Configs ───────────────────────────────────────────────────

export interface ISelectOption {
  readonly value: string;
  readonly color: string;
}

export interface ISelectConfig {
  readonly options: ISelectOption[];
}

export interface INumberConfig {
  readonly format?: 'number' | 'percent' | 'currency';
  readonly min?: number;
  readonly max?: number;
}

export interface ITagsConfig {
  readonly options?: ISelectOption[];
}

// NOTE: the legacy IPropertyDataService interface (workspace-level property
// service) is retired — properties live in DATABASES (databaseDataService).
// This module keeps only the shared types the database UI consumes
// (PropertyType, IPropertyDefinition, option configs, icons).
