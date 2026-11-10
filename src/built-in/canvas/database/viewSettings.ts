// viewSettings.ts — the view's settings menu (the ⋯ beside Filter and Sort)
// and the calculations menu under a column, as kit menu items.
//
// Layout and properties for every view; wrap and freeze for a table; group,
// sub-group, card size and preview for cards; the date properties for a
// calendar or timeline; type, grouping and measure for a chart; then CSV,
// rename and delete.

import type { IExtensionMenuItem } from '../../../ui/contextMenu.js';
import type { PropertyType } from '../properties/propertyTypes.js';
import type { DatabaseDataService } from './databaseDataService.js';
import type { DatabaseViewType, IDatabaseProperty, IDatabaseView, ISortRule } from './databaseTypes.js';
import { DATABASE_VIEW_TYPES, TITLE_KEY } from './databaseTypes.js';
import { orderedProperties, patchRecord, readViewConfig, type IViewConfig } from './viewConfig.js';
import { calcOptionsFor, type CalcKind } from './calculations.js';
import { databaseCsvMenuItems } from './databaseCsvActions.js';
import { dateProperties } from './calendarView.js';
import { groupableProperties, measurableProperties } from './chartData.js';

/** Each view type's name and icon, for tabs and menus. */
export const VIEW_META: Record<DatabaseViewType, { label: string; icon: string }> = {
  table: { label: 'Table', icon: 'table' },
  board: { label: 'Board', icon: 'kanban' },
  list: { label: 'List', icon: 'list' },
  gallery: { label: 'Gallery', icon: 'layout-grid' },
  calendar: { label: 'Calendar', icon: 'calendar' },
  timeline: { label: 'Timeline', icon: 'calendar-days' },
  chart: { label: 'Chart', icon: 'chart-bar' },
};

export interface IViewSettingsContext {
  readonly view: IDatabaseView;
  readonly props: readonly IDatabaseProperty[];
  readonly viewCount: number;
  readonly db: DatabaseDataService;
  readonly databaseId: string;
  updateView(patch: { type?: DatabaseViewType; groupBy?: string | null; hideEmptyGroups?: boolean; config?: Record<string, unknown> }): Promise<void>;
  patchConfig(patch: Record<string, unknown>): Promise<void>;
  renameView(): void;
  deleteView(): void;
}

function pick(label: string, icon: string, choices: readonly { id: string | null; label: string }[], current: string | null, set: (id: string | null) => void): IExtensionMenuItem {
  return { label, icon, submenu: choices.map((c) => ({ label: c.label, checked: current === c.id, onSelect: () => set(c.id) })) };
}

/** The settings a layout has: grouping, cards, dates, the chart. */
export function layoutSettingsItems(ctx: IViewSettingsContext, cfg: IViewConfig): IExtensionMenuItem[] {
  const { view, props } = ctx;
  const items: IExtensionMenuItem[] = [];
  const groupable = props.filter((p) => p.type === 'select' || p.type === 'tags' || p.type === 'status');
  if (view.type === 'board') {
    items.push(pick('Group By', 'kanban', groupable.map((p) => ({ id: p.id, label: p.name })), view.groupBy, (id) => void ctx.updateView({ groupBy: id })));
    const subs = props.filter((p) => (p.type === 'select' || p.type === 'tags' || p.type === 'status' || p.type === 'checkbox') && p.id !== view.groupBy);
    items.push(pick('Sub-group By', 'rows', [{ id: null, label: 'None' }, ...subs.map((p) => ({ id: p.id, label: p.name }))], cfg.subGroupBy, (id) => void ctx.patchConfig({ subGroupBy: id })));
    items.push({ label: 'Hide Empty Groups', icon: 'eye-off', checked: view.hideEmptyGroups, onSelect: () => void ctx.updateView({ hideEmptyGroups: !view.hideEmptyGroups }) });
  }
  if (view.type === 'board' || view.type === 'gallery' || view.type === 'list') {
    if (view.type !== 'list') {
      items.push(pick('Card Size', 'maximize', [{ id: 'small', label: 'Small' }, { id: 'medium', label: 'Medium' }, { id: 'large', label: 'Large' }], cfg.cardSize, (id) => void ctx.patchConfig({ cardSize: id })));
      const files = props.filter((p) => p.type === 'files');
      items.push(pick('Card Preview', 'image', [{ id: null, label: 'None' }, { id: 'page', label: 'Page content' }, ...files.map((p) => ({ id: p.id, label: p.name }))], cfg.preview, (id) => void ctx.patchConfig({ preview: id })));
    }
    items.push({ label: 'Show Property Names', icon: 'text', checked: cfg.showPropertyNames, onSelect: () => void ctx.patchConfig({ showPropertyNames: !cfg.showPropertyNames }) });
  }
  if (view.type === 'calendar' || view.type === 'timeline') {
    const dates = dateProperties(props).map((p) => ({ id: p.id, label: p.name }));
    items.push(pick(view.type === 'calendar' ? 'Calendar By' : 'Timeline By', 'calendar', dates, cfg.dateProperty ?? dates[0]?.id ?? null, (id) => void ctx.patchConfig({ dateProperty: id })));
    if (view.type === 'timeline') items.push(pick('End Date', 'calendar-days', [{ id: null, label: 'None (one day each)' }, ...dates], cfg.endDateProperty, (id) => void ctx.patchConfig({ endDateProperty: id })));
    if (view.type === 'calendar') items.push(pick('Week Starts On', 'calendar-days', [{ id: '0', label: 'Sunday' }, { id: '1', label: 'Monday' }], String(view.config['weekStart'] === 1 ? 1 : 0), (id) => void ctx.patchConfig({ weekStart: id === '1' ? 1 : 0 })));
  }
  if (view.type === 'chart') {
    items.push(pick('Chart Type', 'chart-bar', [{ id: 'bar', label: 'Bar' }, { id: 'line', label: 'Line' }, { id: 'donut', label: 'Donut' }], cfg.chart.kind, (id) => void ctx.patchConfig({ chart: { ...cfg.chart, kind: id } })));
    const groups = groupableProperties(props).map((p) => ({ id: p.id, label: p.name }));
    items.push(pick('Chart By', 'tag', groups, cfg.chart.groupBy ?? groups[0]?.id ?? null, (id) => void ctx.patchConfig({ chart: { ...cfg.chart, groupBy: id } })));
    const measures = measurableProperties(props);
    items.push(pick('Measure', 'sigma', [{ id: 'count', label: 'Count of rows' }, ...measures.flatMap((p) => [{ id: `sum:${p.id}`, label: `Sum of ${p.name}` }, { id: `average:${p.id}`, label: `Average of ${p.name}` }])],
      cfg.chart.aggregate === 'count' ? 'count' : `${cfg.chart.aggregate}:${cfg.chart.measure}`,
      (id) => { const [agg, prop] = (id ?? 'count').split(':'); void ctx.patchConfig({ chart: { ...cfg.chart, aggregate: agg, measure: prop ?? 'count' } }); }));
  }
  return items;
}

/** The whole view settings menu. */
export function viewSettingsItems(ctx: IViewSettingsContext): IExtensionMenuItem[] {
  const { view, props } = ctx;
  const cfg = readViewConfig(view.config);
  const visible = orderedProperties(props, cfg).filter((p) => !cfg.hidden.includes(p.id));
  const allWrapped = visible.every((p) => cfg.wrap[p.id]) && !!cfg.wrap[TITLE_KEY];
  const properties: IExtensionMenuItem[] = orderedProperties(props, cfg).map((p) => ({
    label: p.name, icon: cfg.hidden.includes(p.id) ? 'eye-off' : 'eye', checked: !cfg.hidden.includes(p.id), keepOpen: true,
    onSelect: () => void ctx.patchConfig({ hidden: cfg.hidden.includes(p.id) ? cfg.hidden.filter((h) => h !== p.id) : [...cfg.hidden, p.id] }),
  }));
  const freezeItems: IExtensionMenuItem[] = [
    { label: 'None', checked: cfg.freeze === null, onSelect: () => void ctx.patchConfig({ freeze: null }) },
    { label: 'Name', checked: cfg.freeze === TITLE_KEY, onSelect: () => void ctx.patchConfig({ freeze: TITLE_KEY }) },
    ...visible.map((p) => ({ label: p.name, checked: cfg.freeze === p.id, onSelect: () => void ctx.patchConfig({ freeze: p.id }) })),
  ];
  return [
    { label: 'Layout', icon: VIEW_META[view.type].icon, submenu: DATABASE_VIEW_TYPES.map((t) => ({ label: VIEW_META[t].label, icon: VIEW_META[t].icon, checked: view.type === t, onSelect: () => void ctx.updateView({ type: t }) })) },
    ...layoutSettingsItems(ctx, cfg),
    ...(view.type === 'chart' ? [] : [{ label: 'Properties', icon: 'sliders-horizontal', submenu: properties.length ? properties : [{ label: 'No properties yet', disabled: true }] }]),
    { separator: true },
    ...(view.type === 'table' ? [
      { label: 'Wrap All Columns', icon: 'rows', checked: allWrapped, onSelect: () => {
        const wrap: Record<string, boolean> = {};
        if (!allWrapped) { wrap[TITLE_KEY] = true; for (const p of props) wrap[p.id] = true; }
        void ctx.patchConfig({ wrap });
      } },
      { label: 'Freeze Up To', icon: 'pin', submenu: freezeItems },
    ] : []),
    ...(view.type === 'chart' ? [] : [{ label: 'Open Rows In', icon: 'panel-right', submenu: [
      { label: 'Side Peek', icon: 'panel-right', checked: cfg.openIn === 'side', onSelect: () => void ctx.patchConfig({ openIn: 'side' }) },
      { label: 'Full Page', icon: 'maximize', checked: cfg.openIn === 'full', onSelect: () => void ctx.patchConfig({ openIn: 'full' }) },
    ] }]),
    { separator: true },
    ...databaseCsvMenuItems<IExtensionMenuItem>(ctx.db, ctx.databaseId, view.id, (label, run) => ({ label, icon: label.startsWith('Export') ? 'download' : 'upload', onSelect: run })),
    { separator: true },
    { label: 'Rename View…', icon: 'pencil', onSelect: () => ctx.renameView() },
    ...(ctx.viewCount > 1 ? [{ label: 'Delete View', icon: 'trash-2', danger: true, onSelect: () => ctx.deleteView() }] : []),
  ];
}

/** The calculations a column offers, the current one checked. */
export function calcMenuItems(view: IDatabaseView, key: string, type: PropertyType | 'title', apply: (config: Record<string, unknown>) => void): IExtensionMenuItem[] {
  const current = readViewConfig(view.config).calc[key] ?? (key === TITLE_KEY ? 'count' : 'none');
  const items: IExtensionMenuItem[] = [];
  let group: string | null = null;
  for (const o of calcOptionsFor(type)) {
    if (group && o.group !== group) items.push({ separator: true });
    group = o.group;
    items.push({ label: o.label, checked: o.kind === current, onSelect: () => apply(patchRecord(view.config, 'calc', key, o.kind === 'none' ? null : (o.kind as CalcKind))) });
  }
  return items;
}

/** The items a column shares with the Name column: sort, wrap, freeze. */
export function columnItems(key: string, view: IDatabaseView, update: (patch: { sort?: readonly ISortRule[]; config?: Record<string, unknown> }) => Promise<void>): IExtensionMenuItem[] {
  const cfg = readViewConfig(view.config);
  const frozen = cfg.freeze === key;
  return [
    { label: 'Sort Ascending', icon: 'arrow-up', onSelect: () => void update({ sort: [{ propertyId: key, dir: 'asc' }] }) },
    { label: 'Sort Descending', icon: 'arrow-down', onSelect: () => void update({ sort: [{ propertyId: key, dir: 'desc' }] }) },
    { separator: true },
    { label: 'Wrap Text', icon: 'rows', checked: !!cfg.wrap[key], onSelect: () => void update({ config: patchRecord(view.config, 'wrap', key, cfg.wrap[key] ? null : true) }) },
    { label: frozen ? 'Unfreeze Columns' : 'Freeze Up to This Column', icon: 'pin', onSelect: () => void update({ config: { ...view.config, freeze: frozen ? null : key } }) },
  ];
}
