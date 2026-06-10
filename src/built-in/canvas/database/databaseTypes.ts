// databaseTypes.ts — types for the Notion-style database system.
//
// The schema has existed since migration 006 (databases, database_properties,
// database_views, database_pages) + 007 (page_property_values); this module is
// the typed surface over it. A database IS a page (databases.id = pages.id —
// DD-0): its title/icon live on the pages row, its rows are child pages
// (parent_id = database id) with membership in database_pages, and its cell
// values live in page_property_values keyed (page, property, database).

import type { PropertyType } from '../properties/propertyTypes.js';

export type DatabaseViewType = 'table' | 'board';

export interface IDatabaseInfo {
  readonly id: string;            // = page id
  readonly title: string;         // joined from pages
  readonly icon: string | null;   // joined from pages
  readonly description: string | null;
  readonly isLocked: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface IDatabaseProperty {
  readonly id: string;
  readonly databaseId: string;
  readonly name: string;
  readonly type: PropertyType;
  readonly config: Record<string, unknown>;
  readonly sortOrder: number;
}

export type FilterOp =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'is_empty'
  | 'is_not_empty'
  | 'greater_than'
  | 'less_than';

export interface IFilterRule {
  /** Property id, or the sentinel '__title' for the row's page title. */
  readonly propertyId: string;
  readonly op: FilterOp;
  readonly value?: unknown;
}

export interface IFilterConfig {
  readonly conjunction: 'and' | 'or';
  readonly rules: readonly IFilterRule[];
}

export interface ISortRule {
  /** Property id, or '__title' for the row's page title. */
  readonly propertyId: string;
  readonly dir: 'asc' | 'desc';
}

export interface IDatabaseView {
  readonly id: string;
  readonly databaseId: string;
  readonly name: string;
  readonly type: DatabaseViewType;
  /** Property id used to group (board columns); null = ungrouped. */
  readonly groupBy: string | null;
  readonly hideEmptyGroups: boolean;
  readonly filter: IFilterConfig;
  readonly sort: readonly ISortRule[];
  /** View-specific extras (column widths keyed by property id, …). */
  readonly config: Record<string, unknown>;
  readonly sortOrder: number;
}

export interface IDatabaseRow {
  readonly pageId: string;
  readonly title: string;
  readonly icon: string | null;
  readonly sortOrder: number;     // membership order within the database
  /** Cell values keyed by property id (decoded from JSON). */
  readonly values: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export const TITLE_KEY = '__title';

export const EMPTY_FILTER: IFilterConfig = { conjunction: 'and', rules: [] };
