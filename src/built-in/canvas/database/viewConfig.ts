// viewConfig.ts — the typed reading of a view's `config` JSON (pure).
//
// A view keeps its own look in database_views.config: which columns show
// and in what order, their widths, whether a column wraps, which columns
// are frozen, the calculation under each, and how a row opens. Everything
// here reads with a default and never throws, so a config written by an
// older version still renders.

import type { IDatabaseProperty, IDatabaseView } from './databaseTypes.js';
import { TITLE_KEY } from './databaseTypes.js';
import type { CalcKind } from './calculations.js';

export type OpenRowIn = 'side' | 'full';
export type CardSize = 'small' | 'medium' | 'large';

export interface IViewConfig {
  /** Column widths in px, keyed by property id or TITLE_KEY. */
  readonly widths: Readonly<Record<string, number>>;
  /** Property ids hidden in this view. */
  readonly hidden: readonly string[];
  /** Property ids in display order; properties missing here follow by their sort order. */
  readonly order: readonly string[];
  /** Columns whose text wraps (else clipped with an ellipsis). */
  readonly wrap: Readonly<Record<string, boolean>>;
  /** Columns are frozen up to and including this key (TITLE_KEY or a property id); null = none. */
  readonly freeze: string | null;
  /** The calculation shown under a column, keyed like widths. */
  readonly calc: Readonly<Record<string, CalcKind>>;
  /** Where a row opens from this view. */
  readonly openIn: OpenRowIn;
  readonly cardSize: CardSize;
  /** The property (a files property) whose first image previews a card; 'page' = the page's first image; null = none. */
  readonly preview: string | null;
  /** The date property a calendar or timeline places rows by. */
  readonly dateProperty: string | null;
  /** The end-date property of a timeline bar. */
  readonly endDateProperty: string | null;
  /** The second grouping of a board. */
  readonly subGroupBy: string | null;
  /** Chart settings. */
  readonly chart: { readonly kind: 'bar' | 'line' | 'donut'; readonly groupBy: string | null; readonly measure: 'count' | string; readonly aggregate: 'count' | 'sum' | 'average' };
  /** Whether a view shows a card's properties (gallery/list) by name. */
  readonly showPropertyNames: boolean;
}

const OPEN_IN: readonly OpenRowIn[] = ['side', 'full'];
const CARD_SIZES: readonly CardSize[] = ['small', 'medium', 'large'];

function record<T>(v: unknown, ok: (x: unknown) => x is T): Record<string, T> {
  const out: Record<string, T> = {};
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (ok(x)) out[k] = x;
  }
  return out;
}
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isBool = (x: unknown): x is boolean => typeof x === 'boolean';
const isStr = (x: unknown): x is string => typeof x === 'string';
const strOrNull = (x: unknown): string | null => (typeof x === 'string' && x ? x : null);

export function readViewConfig(config: Record<string, unknown> | null | undefined): IViewConfig {
  const c = config ?? {};
  const chartRaw = (c['chart'] && typeof c['chart'] === 'object' ? c['chart'] : {}) as Record<string, unknown>;
  const kind = chartRaw['kind'];
  const aggregate = chartRaw['aggregate'];
  return {
    widths: record(c['widths'], isNum),
    hidden: Array.isArray(c['hidden']) ? (c['hidden'] as unknown[]).filter(isStr) : [],
    order: Array.isArray(c['order']) ? (c['order'] as unknown[]).filter(isStr) : [],
    wrap: record(c['wrap'], isBool),
    freeze: strOrNull(c['freeze']),
    calc: record(c['calc'], isStr) as Record<string, CalcKind>,
    openIn: OPEN_IN.includes(c['openIn'] as OpenRowIn) ? (c['openIn'] as OpenRowIn) : 'side',
    cardSize: CARD_SIZES.includes(c['cardSize'] as CardSize) ? (c['cardSize'] as CardSize) : 'medium',
    preview: strOrNull(c['preview']),
    dateProperty: strOrNull(c['dateProperty']),
    endDateProperty: strOrNull(c['endDateProperty']),
    subGroupBy: strOrNull(c['subGroupBy']),
    chart: {
      kind: kind === 'line' || kind === 'donut' ? kind : 'bar',
      groupBy: strOrNull(chartRaw['groupBy']),
      measure: typeof chartRaw['measure'] === 'string' && chartRaw['measure'] ? chartRaw['measure'] : 'count',
      aggregate: aggregate === 'sum' || aggregate === 'average' ? aggregate : 'count',
    },
    showPropertyNames: c['showPropertyNames'] === true,
  };
}

/** The properties this view shows, in its order: `order` first, the rest by sort order, hidden ones left out. */
export function visibleProperties(props: readonly IDatabaseProperty[], view: Pick<IDatabaseView, 'config'>): IDatabaseProperty[] {
  const cfg = readViewConfig(view.config);
  return orderedProperties(props, cfg).filter((p) => !cfg.hidden.includes(p.id));
}

/** All properties in the view's order (hidden included), for the properties menu. */
export function orderedProperties(props: readonly IDatabaseProperty[], cfg: IViewConfig): IDatabaseProperty[] {
  const byId = new Map(props.map((p) => [p.id, p]));
  const out: IDatabaseProperty[] = [];
  for (const id of cfg.order) { const p = byId.get(id); if (p && !out.includes(p)) out.push(p); }
  for (const p of [...props].sort((a, b) => a.sortOrder - b.sortOrder)) if (!out.includes(p)) out.push(p);
  return out;
}

/** The view's `order` after moving `id` by `step` places among the visible columns (-1 left, +1 right). */
export function moveInOrder(props: readonly IDatabaseProperty[], view: Pick<IDatabaseView, 'config'>, id: string, step: number): string[] {
  const ids = orderedProperties(props, readViewConfig(view.config)).map((p) => p.id);
  const from = ids.indexOf(id);
  if (from < 0) return ids;
  const to = Math.max(0, Math.min(ids.length - 1, from + step));
  ids.splice(from, 1);
  ids.splice(to, 0, id);
  return ids;
}

/** The view's `order` with `id` placed before `beforeId` (or last when beforeId is null). */
export function placeInOrder(props: readonly IDatabaseProperty[], view: Pick<IDatabaseView, 'config'>, id: string, beforeId: string | null): string[] {
  const ids = orderedProperties(props, readViewConfig(view.config)).map((p) => p.id).filter((x) => x !== id);
  const at = beforeId === null ? ids.length : ids.indexOf(beforeId);
  ids.splice(at < 0 ? ids.length : at, 0, id);
  return ids;
}

/** Keys (TITLE_KEY first, then visible property ids) that are frozen under `freeze`. */
export function frozenKeys(visible: readonly IDatabaseProperty[], freeze: string | null): string[] {
  if (!freeze) return [];
  const keys = [TITLE_KEY, ...visible.map((p) => p.id)];
  const at = keys.indexOf(freeze);
  return at < 0 ? [] : keys.slice(0, at + 1);
}

export const DEFAULT_TITLE_WIDTH = 280;
export const DEFAULT_COLUMN_WIDTH = 160;
export const MIN_COLUMN_WIDTH = 80;

export function columnWidth(cfg: IViewConfig, key: string): number {
  return cfg.widths[key] ?? (key === TITLE_KEY ? DEFAULT_TITLE_WIDTH : DEFAULT_COLUMN_WIDTH);
}

/** A config patch that sets one key of a record-valued setting. */
export function patchRecord(config: Record<string, unknown>, setting: 'widths' | 'wrap' | 'calc', key: string, value: number | boolean | string | null): Record<string, unknown> {
  const current = (config[setting] && typeof config[setting] === 'object' ? config[setting] : {}) as Record<string, unknown>;
  const next = { ...current };
  if (value === null) delete next[key]; else next[key] = value;
  return { ...config, [setting]: next };
}
