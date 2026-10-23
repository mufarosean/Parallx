// conceptMapPrint.test.ts — a concept map on paper (ui/conceptMapPrint).
// Pins the calibration: a map keeps its own layout while its type reads
// on paper, switches to the layout that prints clearly larger past that,
// never prints above real size, and brings the stylesheet and light-mode
// paper tokens a print document without app CSS needs.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  fitMindMapForPrint,
  mindMapSize,
  MINDMAP_PRINT_CSS,
  MINDMAP_PRINT_TOKENS,
  PRINT_LEGIBLE_SCALE,
  renderMindMapForPrint,
} from '../../src/ui/conceptMapPrint.js';

const A4 = { width: 680, height: 1009 };

const SMALL = 'Reserving\n  Chain Ladder\n    Mack\n  Cape Cod';
/** A root over branches, each with leaves: wide when drawn top-down. */
const grid = (branches: number, leaves: number) => ['Root', ...Array.from({ length: branches }, (_, i) => [
  `  Branch ${i + 1}`,
  ...Array.from({ length: leaves }, (_, j) => `    Detail ${i + 1}.${j + 1}`),
]).flat()].join('\n');

describe('fitMindMapForPrint', () => {
  it('a map that fits prints in its own layout at real size, never larger', () => {
    const fit = fitMindMapForPrint(SMALL, { dir: 'right', page: A4 });
    expect(fit).toEqual({ dir: 'right', overrides: undefined, scale: 1 });
  });

  it('a top-down map too wide for the page prints in the layout that fits it largest', () => {
    const src = grid(5, 3);
    const own = mindMapSize(src, 'down')!;
    expect(A4.width / own.width).toBeLessThan(PRINT_LEGIBLE_SCALE);
    const fit = fitMindMapForPrint(src, { dir: 'down', page: A4 });
    expect(fit.dir).not.toBe('down');
    expect(fit.scale).toBeGreaterThanOrEqual(PRINT_LEGIBLE_SCALE);
  });

  it('a switched layout drops the moves, which belong to the old one', () => {
    const fit = fitMindMapForPrint(grid(5, 3), { dir: 'down', overrides: { 'Branch 1': { dx: 36, dy: 0 } }, page: A4 });
    expect(fit.dir).not.toBe('down');
    expect(fit.overrides).toBeUndefined();
  });

  it('a legible map keeps its layout and its moves', () => {
    const overrides = { Mack: { dx: 36, dy: 18 } };
    const fit = fitMindMapForPrint(SMALL, { dir: 'down', overrides, page: A4 });
    expect(fit.dir).toBe('down');
    expect(fit.overrides).toBe(overrides);
  });

  it('keeps its layout when no other prints clearly larger', () => {
    // Thirty-two leaves: radial is the most compact; the tree and top-down
    // would print smaller still, so radial stays, small as it is.
    const page = { width: 400, height: 600 };
    const fit = fitMindMapForPrint(grid(8, 4), { dir: 'radial', page });
    expect(fit.dir).toBe('radial');
    expect(fit.scale).toBeLessThan(PRINT_LEGIBLE_SCALE);
  });

  it('always fits the whole page box, so a map never splits across pages', () => {
    for (const src of [SMALL, grid(5, 3), grid(8, 4)]) {
      for (const dir of ['right', 'down', 'radial'] as const) {
        const fit = fitMindMapForPrint(src, { dir, page: A4 });
        const size = mindMapSize(src, fit.dir, fit.overrides)!;
        expect(size.width * fit.scale).toBeLessThanOrEqual(A4.width + 0.5);
        expect(size.height * fit.scale).toBeLessThanOrEqual(A4.height + 0.5);
      }
    }
  });
});

describe('renderMindMapForPrint', () => {
  it('is the diagram alone: no board, no tools', () => {
    const html = renderMindMapForPrint(SMALL, { dir: 'right', page: A4 });
    expect(html.startsWith('<div class="canvas-conceptmap-print"')).toBe(true);
    expect(html).not.toContain('parallx-mindmap__board');
    expect(html).not.toContain('<button');
    expect(html).toContain('data-mindmap-label="Mack"');
  });

  it('the wrapper carries the fitted width; the stylesheet lifts the scroll floor', () => {
    const src = grid(5, 3);
    const fit = fitMindMapForPrint(src, { dir: 'down', page: A4 });
    const size = mindMapSize(src, fit.dir)!;
    const html = renderMindMapForPrint(src, { dir: 'down', page: A4 });
    expect(html).toContain(`<div class="canvas-conceptmap-print" style="width:${Math.round(size.width * fit.scale)}px">`);
    expect(html).toContain(`data-mindmap-dir="${fit.dir}"`);
    expect(MINDMAP_PRINT_CSS).toMatch(/\.canvas-conceptmap-print \.parallx-mindmap svg \{[^}]*min-width: 0 !important/);
  });
});

describe('MINDMAP_PRINT_CSS', () => {
  it('carries the map stylesheet itself, so type sizes never drift', () => {
    const mapCss = readFileSync(path.resolve(__dirname, '../../src/ui/conceptMap.css'), 'utf8');
    expect(MINDMAP_PRINT_CSS).toContain(mapCss.trim());
  });

  it('prints cards flat (no raster filter) on white', () => {
    expect(MINDMAP_PRINT_CSS).toMatch(/\.canvas-conceptmap-print \.parallx-mindmap__box \{[^}]*filter: none/);
    expect(MINDMAP_PRINT_CSS).toContain('--px-bg: #ffffff');
  });

  it('the paper tokens are the light-mode values in px-tokens.css', () => {
    const tokens = readFileSync(path.resolve(__dirname, '../../src/theme/px-tokens.css'), 'utf8');
    // Later declarations win: the :root values, then the light block's overrides.
    const light: Record<string, string> = {};
    for (const m of tokens.matchAll(/(--px-paper-[\w-]+):\s*([^;]+);/g)) light[m[1]] = m[2].trim();
    expect(MINDMAP_PRINT_TOKENS).toEqual(light);
  });
});
