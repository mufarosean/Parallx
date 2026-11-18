// keptColumns.ts — a column a tool keeps.
//
// A tool that stores its record in a database can mark a column as its own
// (`config.computedBy` holds the tool's id): a count it works out, a date it
// stamps. Such a column is the tool's to write and nobody else's: the person
// reads it in every view but no view opens an editor on it, the chat's tools
// are refused, and the cell says which tool keeps it. Turning the tool off
// changes none of that: the column and its values stay, read-only. The
// person can still delete the column; the tool puts it back.
//
// One helper answers "may the person edit this column?" for every view, so a
// built-in computed type (a formula, a rollup, created time) and a kept
// column are the same question.

import { isComputedType, type PropertyType } from '../properties/propertyTypes.js';

interface IColumnLike {
  readonly name?: string;
  readonly type: PropertyType;
  readonly config: Readonly<Record<string, unknown>>;
  /** Set on a rollup shown as what it computes (databaseTypes.ts). */
  readonly sourceType?: PropertyType;
}

/** The id of the tool that keeps this column, or null. */
export function keptBy(prop: Pick<IColumnLike, 'config'>): string | null {
  const id = prop.config?.['computedBy'];
  return typeof id === 'string' && id ? id : null;
}

/** True when the person may type into this column's cells: it is neither computed by the app nor kept by a tool. */
export function isPersonEditable(prop: IColumnLike): boolean {
  return !isComputedType(prop.sourceType ?? prop.type) && keptBy(prop) === null;
}

/** True when `writer` (a tool id; undefined for the person and the chat) may write this column's cells. */
export function mayWrite(prop: Pick<IColumnLike, 'config'>, writer: string | undefined): boolean {
  const owner = keptBy(prop);
  return owner === null || owner === writer;
}

let keeperName: ((toolId: string) => string | undefined) | null = null;

/** How a tool id becomes the name the person knows it by (the canvas sets this from the tool registry when it starts). */
export function setKeeperNames(lookup: ((toolId: string) => string | undefined) | null): void { keeperName = lookup; }

/** "Kept by Study" for a kept column ("Kept by a tool that is off" when the app does not know the tool); null for any other. */
export function keptByLabel(prop: Pick<IColumnLike, 'config'>): string | null {
  const owner = keptBy(prop);
  if (owner === null) return null;
  let name: string | undefined;
  try { name = keeperName?.(owner); } catch { name = undefined; }
  return name ? `Kept by ${name}` : 'Kept by a tool that is off';
}

/** Why a write to a kept column was refused, naming the column and its keeper. */
export function keptRefusal(prop: Pick<IColumnLike, 'config' | 'name'>): string {
  const label = keptByLabel(prop) ?? 'Kept by a tool';
  return `"${prop.name ?? 'This column'}" is ${label.charAt(0).toLowerCase()}${label.slice(1)}: only that tool sets it.`;
}
