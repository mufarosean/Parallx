// conceptMapPrint.ts — a concept map on paper.
//
// The canvas block's editor view is a board: dots, tools, a keys hint, and
// a map drawn at real size that scrolls sideways. None of that prints. On
// paper a map is the diagram alone, on white, with the same paper cards
// and ink, scaled to fit one page so it never splits across two.
//
// Fitting is the calibration. A map keeps its own layout while its type
// still reads on paper (PRINT_LEGIBLE_SCALE: the smallest type stays near
// 7pt). Past that it prints in whichever layout fits the page largest,
// when that one is clearly larger: a top-down map with fifteen leaves is
// three times wider than a page, so it prints as the left-to-right tree
// (tall, not wide) instead of shrinking to 3pt type. Moves and resizes
// belong to the layout they were made in, so a switched layout prints
// without them.
//
// The print document carries no app stylesheet, so the map brings its
// own: conceptMap.css itself plus the paper tokens, as light mode sets
// them (connectors mixed toward ink, so they read on white).

import katex from 'katex';
import MAP_CSS from './conceptMap.css?raw';
import { setBlockPrintRenderer } from './blockPrint.js';
import {
  applyOverrides,
  layoutMindMap,
  parseMindMap,
  renderMindMapSvg,
  type MindMapDirection,
  type MindMapOverrides,
} from './conceptMap.js';

/** TeX → HTML for map labels, on screen and on paper. */
export const renderMapMath = (tex: string): string => katex.renderToString(tex, { throwOnError: false });

/** The smallest print size a map keeps its own layout at. */
export const PRINT_LEGIBLE_SCALE = 0.75;
/** How much larger another layout must print to be chosen instead. */
const SWITCH_GAIN = 1.2;
/** Page height the block's own margins take. */
const BLOCK_SLACK = 24;

/**
 * The paper tokens in light mode (px-tokens.css: the :root values with the
 * light block's overrides). A test keeps the two equal.
 */
export const MINDMAP_PRINT_TOKENS: Readonly<Record<string, string>> = {
  '--px-paper-0': '#efe7d0',
  '--px-paper-1': '#f5e27a',
  '--px-paper-2': '#bfd9f2',
  '--px-paper-3': '#f3c1cf',
  '--px-paper-4': '#c6e8cd',
  '--px-paper-ink': '#2a2620',
  '--px-paper-ink-soft': '#423d34',
  '--px-paper-shadow': '0.22',
  '--px-paper-line-base': 'var(--px-paper-ink)',
  '--px-paper-line-mix': '60%',
};

const tokenDecls = Object.entries(MINDMAP_PRINT_TOKENS).map(([k, v]) => `${k}: ${v};`).join(' ');

// Arrowheads wear their level's paper, which on white (canary, sky) all
// but vanishes: on paper they mix toward ink as the lines do.
const ARROW_CSS = `
.canvas-conceptmap-print .parallx-mindmap__arrow { fill: color-mix(in srgb, var(--px-paper-0) 55%, var(--px-paper-ink)); }
.canvas-conceptmap-print .parallx-mindmap__arrow--d1 { fill: color-mix(in srgb, var(--px-paper-1) 55%, var(--px-paper-ink)); }
.canvas-conceptmap-print .parallx-mindmap__arrow--d2 { fill: color-mix(in srgb, var(--px-paper-2) 55%, var(--px-paper-ink)); }
.canvas-conceptmap-print .parallx-mindmap__arrow--d3 { fill: color-mix(in srgb, var(--px-paper-3) 55%, var(--px-paper-ink)); }
.canvas-conceptmap-print .parallx-mindmap__arrow--d4 { fill: color-mix(in srgb, var(--px-paper-4) 55%, var(--px-paper-ink)); }`;

/** Everything a printed map needs, for a document with no app CSS. */
export const MINDMAP_PRINT_CSS = `${MAP_CSS}
.canvas-conceptmap-print {
  ${tokenDecls}
  --px-bg: #ffffff;
  max-width: 100%;
  margin: 0.7em 0;
  break-inside: avoid;
}
/* The wrapper carries the printed width; the map fills it (no scroll
   floor: paper does not scroll). */
.canvas-conceptmap-print .parallx-mindmap svg {
  width: 100%;
  height: auto;
  min-width: 0 !important;
}
/* The grain and shadow filter prints as one raster image per card (a
   big, soft PDF); on paper a card is a flat shape with a hairline edge. */
.canvas-conceptmap-print .parallx-mindmap__box {
  filter: none;
  stroke: color-mix(in srgb, var(--px-paper-ink) 30%, transparent);
  stroke-width: 0.75;
}
${ARROW_CSS}
`;

/** A map's natural size in map units (one unit is one CSS pixel); null
 *  when the outline holds no box. */
export function mindMapSize(
  src: string,
  dir: MindMapDirection,
  overrides?: MindMapOverrides,
): { width: number; height: number } | null {
  const roots = parseMindMap(src);
  if (roots.length === 0) return null;
  const base = layoutMindMap(roots, dir);
  const { width, height } = overrides ? applyOverrides(base, overrides) : base;
  return { width, height };
}

export interface PrintFitOptions {
  readonly dir: MindMapDirection;
  readonly overrides?: MindMapOverrides;
  /** The page's content box, CSS pixels. */
  readonly page: { readonly width: number; readonly height: number };
}

export interface PrintFit {
  readonly dir: MindMapDirection;
  readonly overrides?: MindMapOverrides;
  /** Drawn size over natural size, at most 1 (a map never prints larger). */
  readonly scale: number;
}

/** The layout and size a map prints at. Pure. */
export function fitMindMapForPrint(src: string, opts: PrintFitOptions): PrintFit {
  const maxW = Math.max(1, opts.page.width);
  const maxH = Math.max(1, opts.page.height - BLOCK_SLACK);
  const fit = (dir: MindMapDirection, overrides?: MindMapOverrides): number => {
    const size = mindMapSize(src, dir, overrides);
    return size ? Math.min(1, maxW / size.width, maxH / size.height) : 1;
  };
  const own: PrintFit = { dir: opts.dir, overrides: opts.overrides, scale: fit(opts.dir, opts.overrides) };
  if (own.scale >= PRINT_LEGIBLE_SCALE) return own;
  let best = own;
  for (const dir of ['right', 'down', 'radial'] as const) {
    if (dir === opts.dir) continue;
    const scale = fit(dir);
    if (scale > best.scale) best = { dir, scale };
  }
  return best.scale >= own.scale * SWITCH_GAIN ? best : own;
}

export interface PrintMindMapOptions extends PrintFitOptions {
  /** TeX → HTML (KaTeX). */
  readonly renderMath?: (tex: string) => string;
}

/** The map as it prints: the diagram alone, fitted to the page. */
export function renderMindMapForPrint(src: string, opts: PrintMindMapOptions): string {
  const fit = fitMindMapForPrint(src, opts);
  const size = mindMapSize(src, fit.dir, fit.overrides);
  const width = size ? ` style="width:${Math.round(size.width * fit.scale)}px"` : '';
  return `<div class="canvas-conceptmap-print"${width}>`
    + renderMindMapSvg(src, { dir: fit.dir, overrides: fit.overrides, renderMath: opts.renderMath })
    + '</div>';
}

/** The canvas block's print rendering: its map as it stands when printed. */
export function printAsMindMap(
  dom: HTMLElement,
  read: () => { src: string; dir: MindMapDirection; overrides: MindMapOverrides },
): void {
  setBlockPrintRenderer(dom, (page) => {
    const { src, dir, overrides } = read();
    return { html: renderMindMapForPrint(src, { dir, overrides, renderMath: renderMapMath, page }), css: MINDMAP_PRINT_CSS };
  });
}
