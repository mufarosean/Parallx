// @vitest-environment jsdom
//
// M93 — canvas "Export as PDF": pure pipeline tests.
//
// The export clones the live ProseMirror DOM → sanitizeContentHtml strips
// editor chrome and freezes interactive state → buildPrintHtml wraps it in a
// standalone light print document → buildPdfRenderOptions maps dialog
// settings onto Electron printToPDF options (mm → inches, % → fraction,
// page-number footer). Chromium paginates in a hidden window, so these
// builders are where "no cutoff, correct margins" is actually decided.

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PDF_SETTINGS,
  MARGIN_PRESETS,
  PAGE_SIZE_ITEMS,
  PRINT_CSS,
  buildPdfRenderOptions,
  buildPrintHtml,
  mmToInches,
  resolveMarginsMm,
  sanitizeContentHtml,
  sanitizeFilename,
  type PdfExportSettings,
} from '../../src/built-in/canvas/export/printHtml.js';

// ─── mmToInches ──────────────────────────────────────────────────────────────

describe('mmToInches', () => {
  it('converts standard values', () => {
    expect(mmToInches(25.4)).toBe(1);
    expect(mmToInches(12.7)).toBe(0.5);
    expect(mmToInches(0)).toBe(0);
  });
  it('clamps negatives and garbage to 0', () => {
    expect(mmToInches(-5)).toBe(0);
    expect(mmToInches(NaN)).toBe(0);
  });
});

// ─── Margin resolution ───────────────────────────────────────────────────────

describe('resolveMarginsMm', () => {
  it('resolves every named preset', () => {
    for (const preset of MARGIN_PRESETS) {
      if (preset.id === 'custom') continue;
      const s: PdfExportSettings = { ...DEFAULT_PDF_SETTINGS, marginPreset: preset.id };
      expect(resolveMarginsMm(s)).toEqual(preset.mm);
    }
  });
  it('uses the custom margins when preset is custom', () => {
    const s: PdfExportSettings = {
      ...DEFAULT_PDF_SETTINGS,
      marginPreset: 'custom',
      customMarginsMm: { top: 5, right: 10, bottom: 15, left: 20 },
    };
    expect(resolveMarginsMm(s)).toEqual({ top: 5, right: 10, bottom: 15, left: 20 });
  });
});

// ─── buildPdfRenderOptions ───────────────────────────────────────────────────

describe('buildPdfRenderOptions', () => {
  it('maps defaults: A4 portrait, 15mm margins in inches, scale 1', () => {
    const o = buildPdfRenderOptions(DEFAULT_PDF_SETTINGS);
    expect(o.pageSize).toBe('A4');
    expect(o.landscape).toBe(false);
    expect(o.scale).toBe(1);
    expect(o.margins.top).toBeCloseTo(0.591, 3);
    expect(o.margins.left).toBeCloseTo(0.591, 3);
    expect(o.printBackground).toBe(true);
  });

  it('page numbers force a footer band even with zero margins', () => {
    const s: PdfExportSettings = {
      ...DEFAULT_PDF_SETTINGS,
      marginPreset: 'none',
      pageNumbers: true,
    };
    const o = buildPdfRenderOptions(s);
    expect(o.displayHeaderFooter).toBe(true);
    expect(o.footerTemplate).toContain('pageNumber');
    expect(o.margins.bottom).toBeGreaterThanOrEqual(0.35);
    expect(o.margins.top).toBe(0);
  });

  it('no page numbers → empty footer, margins untouched', () => {
    const s: PdfExportSettings = { ...DEFAULT_PDF_SETTINGS, marginPreset: 'none', pageNumbers: false };
    const o = buildPdfRenderOptions(s);
    expect(o.displayHeaderFooter).toBe(false);
    expect(o.margins.bottom).toBe(0);
  });

  it('clamps scale into the printable range', () => {
    expect(buildPdfRenderOptions({ ...DEFAULT_PDF_SETTINGS, scalePercent: 10 }).scale).toBe(0.4);
    expect(buildPdfRenderOptions({ ...DEFAULT_PDF_SETTINGS, scalePercent: 500 }).scale).toBe(2);
    expect(buildPdfRenderOptions({ ...DEFAULT_PDF_SETTINGS, scalePercent: NaN }).scale).toBe(1);
  });

  it('landscape and page size pass through', () => {
    const s: PdfExportSettings = { ...DEFAULT_PDF_SETTINGS, landscape: true, pageSize: 'Letter' };
    const o = buildPdfRenderOptions(s);
    expect(o.landscape).toBe(true);
    expect(o.pageSize).toBe('Letter');
  });
});

// ─── sanitizeFilename ────────────────────────────────────────────────────────

describe('sanitizeFilename', () => {
  it('strips filesystem-hostile characters', () => {
    expect(sanitizeFilename('Exam 7: Notes / "Draft"?')).not.toMatch(/[<>:"/\\|?*]/);
  });
  it('falls back to Untitled', () => {
    expect(sanitizeFilename('')).toBe('Untitled');
    expect(sanitizeFilename('???')).toBe('Untitled');
  });
});

// ─── sanitizeContentHtml ─────────────────────────────────────────────────────

function makeRoot(html: string): HTMLElement {
  const root = document.createElement('div');
  root.className = 'ProseMirror';
  root.innerHTML = html;
  return root;
}

describe('sanitizeContentHtml', () => {
  it('does not mutate the live editor DOM', () => {
    const root = makeRoot('<p contenteditable="true">Hello</p>');
    sanitizeContentHtml(root);
    expect(root.querySelector('p')!.getAttribute('contenteditable')).toBe('true');
  });

  it('strips editor chrome, scripts and embeds', () => {
    const root = makeRoot(
      '<p>Keep me</p>'
      + '<script>alert(1)</script>'
      + '<iframe src="https://x"></iframe>'
      + '<video src="v.mp4"></video>'
      + '<div data-drag-handle>handle</div>'
      + '<div class="canvas-math-block-editor">latex src</div>'
      + '<div class="canvas-math-block-render">rendered</div>',
    );
    const out = sanitizeContentHtml(root);
    expect(out).toContain('Keep me');
    expect(out).toContain('canvas-math-block-render');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('<iframe');
    expect(out).not.toContain('<video');
    expect(out).not.toContain('data-drag-handle');
    expect(out).not.toContain('canvas-math-block-editor');
  });

  it('removes editing attributes and inline event handlers', () => {
    const root = makeRoot('<p contenteditable="true" draggable="true" spellcheck="false" onclick="x()">Text</p>');
    const out = sanitizeContentHtml(root);
    expect(out).not.toContain('contenteditable');
    expect(out).not.toContain('draggable');
    expect(out).not.toContain('onclick');
    expect(out).toContain('Text');
  });

  it('freezes live checkbox state into attributes and disables them', () => {
    const root = makeRoot(
      '<ul data-type="taskList">'
      + '<li><label><input type="checkbox"></label><div><p>open</p></div></li>'
      + '<li><label><input type="checkbox"></label><div><p>done</p></div></li>'
      + '</ul>',
    );
    // Simulate the user having ticked the second box (property, not attribute).
    const inputs = root.querySelectorAll('input');
    (inputs[1] as HTMLInputElement).checked = true;

    const out = sanitizeContentHtml(root);
    const parsed = document.createElement('div');
    parsed.innerHTML = out;
    const outInputs = parsed.querySelectorAll('input');
    expect(outInputs[0].hasAttribute('checked')).toBe(false);
    expect(outInputs[1].hasAttribute('checked')).toBe(true);
    expect(outInputs[0].hasAttribute('disabled')).toBe(true);
  });

  it('expands collapsed toggles so hidden content prints', () => {
    const root = makeRoot('<details><summary>Toggle</summary><p>Hidden body</p></details>');
    const out = sanitizeContentHtml(root);
    expect(out).toContain('open');
    expect(out).toContain('Hidden body');
  });

  it('drops transient selection classes', () => {
    const root = makeRoot('<p class="ProseMirror-selectednode">sel</p>');
    const out = sanitizeContentHtml(root);
    expect(out).not.toContain('ProseMirror-selectednode');
  });
});

// ─── buildPrintHtml ──────────────────────────────────────────────────────────

describe('buildPrintHtml', () => {
  it('produces a standalone document with title header and content', () => {
    const html = buildPrintHtml({
      title: 'Exam 7 Notes',
      contentHtml: '<p>Body</p>',
      includeTitle: true,
    });
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('class="print-title"');
    expect(html).toContain('Exam 7 Notes');
    expect(html).toContain('<p>Body</p>');
    expect(html).toContain(PRINT_CSS.slice(0, 40).trim());
  });

  it('escapes HTML in the title', () => {
    const html = buildPrintHtml({
      title: '<img src=x onerror=alert(1)>',
      contentHtml: '<p>x</p>',
      includeTitle: true,
    });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
  });

  it('omits the title block when includeTitle is false', () => {
    const html = buildPrintHtml({ title: 'T', contentHtml: '<p>x</p>', includeTitle: false });
    expect(html).not.toContain('<header class="print-title-block">');
  });

  it('links katex + highlight themes only when an app path is provided', () => {
    const without = buildPrintHtml({ title: 'T', contentHtml: '<p>x</p>', includeTitle: true });
    expect(without).not.toContain('katex.min.css');
    const withPath = buildPrintHtml({
      title: 'T',
      contentHtml: '<p>x</p>',
      includeTitle: true,
      appPath: 'D:\\AI\\Parallx',
    });
    expect(withPath).toContain('katex.min.css');
    expect(withPath).toContain('file:///D:/AI/Parallx/');
    expect(withPath).not.toContain('D%3A');
    expect(withPath).toContain('github.css');
  });

  it('applies the page font setting', () => {
    const serif = buildPrintHtml({ title: 'T', contentHtml: '<p>x</p>', includeTitle: true, fontFamily: 'serif' });
    expect(serif).toContain('Georgia');
    const mono = buildPrintHtml({ title: 'T', contentHtml: '<p>x</p>', includeTitle: true, fontFamily: 'mono' });
    expect(mono).toContain('Consolas');
  });
});

// ─── Print CSS invariants (the "no cutoff" contract) ─────────────────────────

describe('PRINT_CSS', () => {
  it('wraps long content instead of clipping', () => {
    expect(PRINT_CSS).toContain('overflow-wrap: anywhere');
    expect(PRINT_CSS).toMatch(/pre\s*\{[^}]*white-space:\s*pre-wrap/);
    expect(PRINT_CSS).toMatch(/img\s*\{[^}]*max-width:\s*100%/);
  });
  it('repeats table headers across page breaks', () => {
    expect(PRINT_CSS).toContain('table-header-group');
  });
  it('keeps atomic blocks unsplit', () => {
    expect(PRINT_CSS).toMatch(/\.canvas-callout\s*\{[^}]*break-inside:\s*avoid/);
    expect(PRINT_CSS).toMatch(/img\s*\{[^}]*break-inside:\s*avoid/);
  });
});

// ─── Catalogue sanity ────────────────────────────────────────────────────────

describe('catalogues', () => {
  it('page sizes cover the ones Electron accepts by name', () => {
    const values = PAGE_SIZE_ITEMS.map(p => p.value);
    for (const v of values) {
      expect(['A3', 'A4', 'A5', 'Legal', 'Letter', 'Tabloid']).toContain(v);
    }
  });
  it('margin presets include none → wide plus custom', () => {
    expect(MARGIN_PRESETS.map(p => p.id)).toEqual(['none', 'narrow', 'normal', 'wide', 'custom']);
  });
});
