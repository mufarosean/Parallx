// propertyTypes.ts — type definitions for the Canvas property system
//
// Defines the property type union, definition/value interfaces,
// type-specific configuration shapes, and the data service contract.

import type { Event } from '../../../platform/events.js';

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

// ─── Change Events ───────────────────────────────────────────────────────────

export interface PropertyDefinitionChangeEvent {
  readonly name: string;
  readonly kind: 'created' | 'updated' | 'deleted';
}

export interface PagePropertyChangeEvent {
  readonly pageId: string;
  readonly key: string;
  readonly kind: 'set' | 'removed';
}

// ─── Service Interface ───────────────────────────────────────────────────────

export interface IPropertyDataService {

  // ── Events ──

  readonly onDidChangeDefinition: Event<PropertyDefinitionChangeEvent>;
  readonly onDidChangePageProperty: Event<PagePropertyChangeEvent>;

  // ── Definition CRUD ──

  createDefinition(name: string, type: PropertyType, config?: Record<string, unknown>): Promise<IPropertyDefinition>;
  getDefinition(name: string): Promise<IPropertyDefinition | null>;
  getAllDefinitions(): Promise<IPropertyDefinition[]>;
  updateDefinition(name: string, updates: Partial<Pick<IPropertyDefinition, 'type' | 'config' | 'sortOrder'>>): Promise<IPropertyDefinition>;
  deleteDefinition(name: string): Promise<void>;

  // ── Page Property CRUD ──

  getPropertiesForPage(pageId: string): Promise<(IPageProperty & { definition: IPropertyDefinition })[]>;
  setProperty(pageId: string, key: string, value: unknown): Promise<IPageProperty>;
  removeProperty(pageId: string, key: string): Promise<void>;
  findPagesByProperty(propertyName: string, operator: string, value?: unknown): Promise<{ pageId: string; title: string; value: unknown }[]>;

  // ── Initialization ──

  ensureDefaultProperties(): Promise<void>;
}
