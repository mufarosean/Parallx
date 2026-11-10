// chartView.ts — the chart view: rows grouped by a property and counted,
// summed or averaged, as a bar, line or donut chart. One SVG, the app's
// data colours (--px-viz-1 … 6), a legend with the numbers, and the same
// picture in light and dark.

import type { DisposableStore } from '../../../platform/lifecycle.js';
import { createBlock, createEmptyState } from '../../../ui/kit.js';
import { readViewConfig } from './viewConfig.js';
import { chartData, groupableProperties, type IChartData } from './chartData.js';
import type { IViewDeps, IViewState } from './viewShared.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** An SVG element: a drawing, never a control (the kit's blocks are HTML). */
function svg<K extends keyof SVGElementTagNameMap>(parent: Element, tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const e = parent.ownerDocument.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent.appendChild(e);
  return e;
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(n);
}

export function renderChartView(body: HTMLElement, state: IViewState, _deps: IViewDeps, _store: DisposableStore): void {
  const cfg = readViewConfig(state.view.config);
  if (groupableProperties(state.props).length === 0) {
    createEmptyState(body, { icon: 'chart-bar', headline: 'Nothing to chart by yet', hint: 'A chart groups rows by a select, status, multi-select, checkbox or date property. Add one from the table view.' });
    return;
  }
  const data = chartData(state.rows, state.props, cfg);
  const root = createBlock(body, 'div', { className: `canvas-db-chart canvas-db-chart--${data.kind}` });
  const title = `${data.measureLabel} by ${data.groupLabel}`;
  createBlock(root, 'div', { className: 'canvas-db-chart__title', text: title });
  const figure = createBlock(root, 'figure', { className: 'canvas-db-chart__figure', attrs: { 'aria-label': title } });
  if (data.slices.length === 0 || data.slices.every((s) => s.value === 0)) {
    createBlock(figure, 'div', { className: 'canvas-db-board-empty', text: 'No rows to chart yet' });
  } else if (data.kind === 'donut') drawDonut(figure, data);
  else drawBarsOrLine(figure, data);
  // The legend doubles as the table of numbers a screen reader gets.
  const legend = createBlock(root, 'ul', { className: 'canvas-db-chart__legend', attrs: { 'aria-label': 'Values' } });
  for (const s of data.slices) {
    const li = createBlock(legend, 'li', { className: 'canvas-db-chart__key' });
    createBlock(li, 'span', { className: `canvas-db-chart__swatch canvas-db-chart__swatch--${s.color}`, attrs: { 'aria-hidden': 'true' } });
    createBlock(li, 'span', { className: 'canvas-db-chart__keylabel', text: s.label });
    createBlock(li, 'span', { className: 'canvas-db-chart__keyvalue', text: fmt(s.value) });
  }
  createBlock(root, 'div', { className: 'canvas-db-chart__total', text: `${data.measureLabel === 'Count' ? 'Total' : data.measureLabel}: ${fmt(data.total)}` });
}

function drawBarsOrLine(figure: HTMLElement, data: IChartData): void {
  const W = 640, H = 280, padL = 44, padR = 16, padT = 16, padB = 48;
  const el = svg(figure, 'svg', { viewBox: `0 0 ${W} ${H}`, class: 'canvas-db-chart__svg', role: 'img', 'aria-label': `${data.measureLabel} by ${data.groupLabel}` });
  const max = Math.max(...data.slices.map((s) => s.value), 0) || 1;
  const nice = niceMax(max);
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const y = (v: number): number => padT + innerH - (v / nice) * innerH;
  // Grid lines and axis labels (4 steps).
  for (let i = 0; i <= 4; i++) {
    const v = (nice / 4) * i;
    svg(el, 'line', { x1: padL, x2: W - padR, y1: y(v), y2: y(v), class: 'canvas-db-chart__grid' });
    svg(el, 'text', { x: padL - 6, y: y(v) + 4, class: 'canvas-db-chart__axis', 'text-anchor': 'end' }).textContent = fmt(v);
  }
  const n = data.slices.length;
  const slot = innerW / n;
  data.slices.forEach((s, i) => {
    const cx = padL + slot * i + slot / 2;
    const label = svg(el, 'text', { x: cx, y: H - padB + 18, class: 'canvas-db-chart__axis', 'text-anchor': 'middle' });
    label.textContent = s.label.length > 14 ? `${s.label.slice(0, 13)}…` : s.label;
    if (data.kind === 'bar') {
      const bw = Math.min(56, slot * 0.6);
      const rect = svg(el, 'rect', { x: cx - bw / 2, y: y(s.value), width: bw, height: Math.max(0, padT + innerH - y(s.value)), rx: 3, class: `canvas-db-chart__bar canvas-db-chart__fill--${s.color}` });
      svg(rect, 'title').textContent = `${s.label}: ${fmt(s.value)}`;
      svg(el, 'text', { x: cx, y: y(s.value) - 6, class: 'canvas-db-chart__value', 'text-anchor': 'middle' }).textContent = fmt(s.value);
    }
  });
  if (data.kind === 'line') {
    const pts = data.slices.map((s, i) => [padL + slot * i + slot / 2, y(s.value)] as const);
    svg(el, 'path', { d: pts.map(([px, py], i) => `${i === 0 ? 'M' : 'L'}${px.toFixed(1)} ${py.toFixed(1)}`).join(' '), class: 'canvas-db-chart__line canvas-db-chart__stroke--1' });
    pts.forEach(([px, py], i) => {
      const dot = svg(el, 'circle', { cx: px, cy: py, r: 4, class: `canvas-db-chart__dot canvas-db-chart__fill--${data.slices[i]!.color}` });
      svg(dot, 'title').textContent = `${data.slices[i]!.label}: ${fmt(data.slices[i]!.value)}`;
      svg(el, 'text', { x: px, y: py - 10, class: 'canvas-db-chart__value', 'text-anchor': 'middle' }).textContent = fmt(data.slices[i]!.value);
    });
  }
}

function drawDonut(figure: HTMLElement, data: IChartData): void {
  const S = 280, cx = S / 2, cy = S / 2, r = 110, ring = 34;
  const el = svg(figure, 'svg', { viewBox: `0 0 ${S} ${S}`, class: 'canvas-db-chart__svg canvas-db-chart__svg--donut', role: 'img', 'aria-label': `${data.measureLabel} by ${data.groupLabel}` });
  const total = data.total || 1;
  let a0 = -Math.PI / 2;
  for (const s of data.slices) {
    if (s.value <= 0) continue;
    const a1 = a0 + (s.value / total) * Math.PI * 2;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p = (a: number, rad: number): string => `${(cx + rad * Math.cos(a)).toFixed(2)} ${(cy + rad * Math.sin(a)).toFixed(2)}`;
    const d = data.slices.filter((x) => x.value > 0).length === 1
      ? `M${p(a0, r)} A${r} ${r} 0 1 1 ${p(a0 + Math.PI, r)} A${r} ${r} 0 1 1 ${p(a0, r)} M${p(a0, r - ring)} A${r - ring} ${r - ring} 0 1 0 ${p(a0 + Math.PI, r - ring)} A${r - ring} ${r - ring} 0 1 0 ${p(a0, r - ring)} Z`
      : `M${p(a0, r)} A${r} ${r} 0 ${large} 1 ${p(a1, r)} L${p(a1, r - ring)} A${r - ring} ${r - ring} 0 ${large} 0 ${p(a0, r - ring)} Z`;
    const path = svg(el, 'path', { d, class: `canvas-db-chart__slice canvas-db-chart__fill--${s.color}`, 'fill-rule': 'evenodd' });
    svg(path, 'title').textContent = `${s.label}: ${fmt(s.value)} (${Math.round((s.value / total) * 100)}%)`;
    a0 = a1;
  }
  svg(el, 'text', { x: cx, y: cy - 4, class: 'canvas-db-chart__center', 'text-anchor': 'middle' }).textContent = fmt(data.total);
  svg(el, 'text', { x: cx, y: cy + 16, class: 'canvas-db-chart__axis', 'text-anchor': 'middle' }).textContent = data.measureLabel;
}

/** A round axis top at or above `max`: 1, 2, 5 × 10ⁿ. */
function niceMax(max: number): number {
  if (max <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(max)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * mag >= max) return m * mag;
  return 10 * mag;
}
