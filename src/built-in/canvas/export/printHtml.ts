// printHtml.ts — pure builders for the canvas "Export as PDF" pipeline (M93).
//
// The export clones the LIVE ProseMirror DOM (so everything the user sees —
// rendered KaTeX, highlighted code, task checkboxes, columns — exports with
// full fidelity), sanitizes it down to content, and wraps it in a standalone
// light-theme print document. The Electron main process loads that document
// in a hidden sandboxed window and prints it via webContents.printToPDF —
// Chromium does the pagination, so content flows across pages instead of
// being cut off.
//
// Everything here is DOM-in/string-out and unit-testable under jsdom. The
// dialog (pdfExportDialog.ts) owns all interaction.

// ─── Settings model ──────────────────────────────────────────────────────────

export interface PdfMarginsMm {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export type PdfMarginPresetId = 'none' | 'narrow' | 'normal' | 'wide' | 'custom';

export interface PdfExportSettings {
  readonly pageSize: 'A4' | 'Letter' | 'Legal' | 'A3' | 'A5' | 'Tabloid';
  readonly landscape: boolean;
  readonly marginPreset: PdfMarginPresetId;
  /** Used when marginPreset === 'custom'. Millimetres. */
  readonly customMarginsMm: PdfMarginsMm;
  /** Percent, 40–200. */
  readonly scalePercent: number;
  readonly printBackground: boolean;
  readonly pageNumbers: boolean;
  readonly includeTitle: boolean;
}

export const DEFAULT_PDF_SETTINGS: PdfExportSettings = {
  pageSize: 'A4',
  landscape: false,
  marginPreset: 'normal',
  customMarginsMm: { top: 15, right: 15, bottom: 15, left: 15 },
  scalePercent: 100,
  printBackground: true,
  pageNumbers: true,
  includeTitle: true,
};

export const PAGE_SIZE_ITEMS: readonly { value: PdfExportSettings['pageSize']; label: string }[] = [
  { value: 'A4', label: 'A4' },
  { value: 'Letter', label: 'Letter' },
  { value: 'Legal', label: 'Legal' },
  { value: 'A3', label: 'A3' },
  { value: 'A5', label: 'A5' },
  { value: 'Tabloid', label: 'Tabloid' },
];

export const MARGIN_PRESETS: readonly { id: PdfMarginPresetId; label: string; mm: PdfMarginsMm | null }[] = [
  { id: 'none', label: 'None', mm: { top: 0, right: 0, bottom: 0, left: 0 } },
  { id: 'narrow', label: 'Narrow (8 mm)', mm: { top: 8, right: 8, bottom: 8, left: 8 } },
  { id: 'normal', label: 'Normal (15 mm)', mm: { top: 15, right: 15, bottom: 15, left: 15 } },
  { id: 'wide', label: 'Wide (25 mm)', mm: { top: 25, right: 25, bottom: 25, left: 25 } },
  { id: 'custom', label: 'Custom…', mm: null },
];

const MM_PER_INCH = 25.4;

export function mmToInches(mm: number): number {
  const n = Number.isFinite(mm) ? Math.max(0, mm) : 0;
  return Math.round((n / MM_PER_INCH) * 1000) / 1000;
}

/** Resolve the effective margins (mm) for a settings object. */
export function resolveMarginsMm(settings: PdfExportSettings): PdfMarginsMm {
  if (settings.marginPreset === 'custom') return settings.customMarginsMm;
  const preset = MARGIN_PRESETS.find(p => p.id === settings.marginPreset);
  return preset?.mm ?? { top: 15, right: 15, bottom: 15, left: 15 };
}

/**
 * Map dialog settings to the Electron `printToPDF` option payload the main
 * process expects (`pdfExport:render`). Margins convert mm → inches; scale
 * converts percent → fraction; page numbers become a footer template.
 */
export function buildPdfRenderOptions(settings: PdfExportSettings): {
  pageSize: string;
  landscape: boolean;
  printBackground: boolean;
  scale: number;
  margins: { top: number; right: number; bottom: number; left: number };
  displayHeaderFooter: boolean;
  headerTemplate: string;
  footerTemplate: string;
} {
  const mm = resolveMarginsMm(settings);
  const clampedScale = Math.min(200, Math.max(40, Number.isFinite(settings.scalePercent) ? settings.scalePercent : 100));
  // Chromium draws headers/footers in the margin band; with zero margins the
  // page number would overlap content, so give the footer a minimal band.
  const bottomIn = settings.pageNumbers ? Math.max(mmToInches(mm.bottom), 0.35) : mmToInches(mm.bottom);
  return {
    pageSize: settings.pageSize,
    landscape: settings.landscape,
    printBackground: settings.printBackground,
    scale: clampedScale / 100,
    margins: {
      top: mmToInches(mm.top),
      right: mmToInches(mm.right),
      bottom: bottomIn,
      left: mmToInches(mm.left),
    },
    displayHeaderFooter: settings.pageNumbers,
    headerTemplate: '<span></span>',
    footerTemplate: settings.pageNumbers
      ? '<div style="width:100%;text-align:center;font-size:8px;color:#888;font-family:Segoe UI,sans-serif;">'
        + '<span class="pageNumber"></span> / <span class="totalPages"></span></div>'
      : '<span></span>',
  };
}

// ─── Filename ────────────────────────────────────────────────────────────────

export function sanitizeFilename(title: string): string {
  const cleaned = (title || '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').substring(0, 100).trim();
  return /^[_\s]*$/.test(cleaned) ? 'Untitled' : cleaned;
}

// ─── Content sanitization ────────────────────────────────────────────────────
//
// Input: the live `.ProseMirror` element (NOT mutated — we clone). Output:
// serialized inner HTML with editor chrome removed and interactive state
// frozen into attributes so it survives serialization.

const STRIP_SELECTORS = [
  'script',
  'style',
  'iframe',
  'video',
  'audio',
  '[data-drag-handle]',
  '.canvas-block-handle',
  '.canvas-block-menu',
  '.canvas-media-placeholder',
  '.canvas-math-block-editor',      // keep the rendered half only
  '.canvas-toc-empty',
  '.canvas-page-block-preview',     // hover preview popover
  '.canvas-dataview-empty',
  '.ProseMirror-gapcursor',
  '.ProseMirror-widget',
];

const STRIP_CLASSES = [
  'ProseMirror-selectednode',
  'ProseMirror-focused',
  'canvas-page-block--drop-target',
  'canvas-math-block--editing',
];

export function sanitizeContentHtml(sourceRoot: HTMLElement): string {
  const clone = sourceRoot.cloneNode(true) as HTMLElement;

  // 1. Freeze live form state into attributes BEFORE any removal, matching
  //    clones by index against the source (cloneNode drops property state).
  const srcInputs = sourceRoot.querySelectorAll('input[type="checkbox"]');
  const cloneInputs = clone.querySelectorAll('input[type="checkbox"]');
  cloneInputs.forEach((input, i) => {
    const src = srcInputs[i] as HTMLInputElement | undefined;
    const el = input as HTMLInputElement;
    if (src?.checked) el.setAttribute('checked', '');
    else el.removeAttribute('checked');
    el.setAttribute('disabled', '');
  });

  // 2. Expand every toggle so no content hides behind a collapsed section —
  //    "no cutoff material" includes collapsed material.
  clone.querySelectorAll('details').forEach((d) => d.setAttribute('open', ''));

  // 3. Remove editor-only / non-printable elements.
  for (const sel of STRIP_SELECTORS) {
    clone.querySelectorAll(sel).forEach((n) => n.remove());
  }

  // 4. Strip editing attributes and transient classes.
  const all = clone.querySelectorAll('*');
  all.forEach((node) => {
    const el = node as HTMLElement;
    el.removeAttribute('contenteditable');
    el.removeAttribute('draggable');
    el.removeAttribute('tabindex');
    el.removeAttribute('spellcheck');
    // Event-handler attributes never belong in an exported document.
    for (const attr of [...el.attributes]) {
      if (attr.name.startsWith('on')) el.removeAttribute(attr.name);
    }
    for (const cls of STRIP_CLASSES) el.classList.remove(cls);
    if (el.getAttribute('class') === '') el.removeAttribute('class');
  });

  return clone.innerHTML;
}

// ─── Print CSS ───────────────────────────────────────────────────────────────
//
// Standalone light theme for the exported document. Covers the canvas block
// vocabulary (headings, lists, tasks, tables, code, callouts, toggles,
// columns, math, page links, bookmarks) with print-safe fragmentation rules:
// images/callouts/math never split; tables repeat their header row; long
// words and code wrap instead of clipping.

export const PRINT_CSS = `
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #ffffff; color: #1f2328; }
  body {
    font-size: 12.5px;
    line-height: 1.6;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .print-root { max-width: 100%; }

  /* Page header */
  .print-title-block { margin: 0 0 18px; }
  .print-icon { font-size: 34px; line-height: 1.2; margin-bottom: 6px; }
  .print-icon svg { width: 34px; height: 34px; }
  .print-title {
    font-size: 26px;
    font-weight: 700;
    letter-spacing: -0.015em;
    margin: 0 0 4px;
    line-height: 1.25;
  }
  .print-rule { border: 0; border-top: 1px solid #d8dbe0; margin: 10px 0 0; }

  /* Base blocks */
  p { margin: 0 0 0.55em; overflow-wrap: anywhere; }
  h1, h2, h3, h4 { line-height: 1.3; margin: 1.1em 0 0.4em; break-after: avoid; overflow-wrap: anywhere; }
  h1 { font-size: 21px; } h2 { font-size: 17.5px; } h3 { font-size: 15px; } h4 { font-size: 13.5px; }
  a { color: #0b57d0; text-decoration: underline; }
  hr { border: 0; border-top: 1px solid #d8dbe0; margin: 14px 0; }
  strong { font-weight: 650; }
  mark { background: #fff3a3; padding: 0 2px; }
  blockquote {
    margin: 0.6em 0;
    padding: 2px 0 2px 12px;
    border-left: 3px solid #c9ccd1;
    color: #4b5158;
  }

  /* Lists */
  ul, ol { margin: 0 0 0.55em; padding-left: 1.5em; }
  li { margin: 0.15em 0; }
  li > p { margin: 0; }
  ul[data-type="taskList"] { list-style: none; padding-left: 0.2em; }
  ul[data-type="taskList"] li { display: flex; gap: 7px; align-items: baseline; }
  ul[data-type="taskList"] li > label { flex: 0 0 auto; }
  ul[data-type="taskList"] input[type="checkbox"] {
    width: 12px; height: 12px; margin: 0; accent-color: #444;
  }

  /* Code */
  code {
    font-family: Consolas, 'Cascadia Mono', 'Courier New', monospace;
    font-size: 0.92em;
    background: #f2f3f5;
    border-radius: 3px;
    padding: 0.1em 0.35em;
  }
  pre {
    background: #f6f7f9;
    border: 1px solid #e3e5e8;
    border-radius: 6px;
    padding: 10px 12px;
    margin: 0.6em 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  pre code { background: none; padding: 0; font-size: 11px; line-height: 1.5; }

  /* Tables — repeat headers across page breaks, never clip horizontally */
  table {
    border-collapse: collapse;
    width: 100%;
    margin: 0.6em 0;
    table-layout: fixed;
  }
  thead { display: table-header-group; }
  tr { break-inside: avoid; }
  th, td {
    border: 1px solid #d3d6da;
    padding: 5px 8px;
    text-align: left;
    vertical-align: top;
    overflow-wrap: anywhere;
  }
  th { background: #f2f3f5; font-weight: 600; }

  /* Media */
  img { max-width: 100%; height: auto; break-inside: avoid; border-radius: 3px; }
  .canvas-media { margin: 0.6em 0; break-inside: avoid; }

  /* Callouts */
  .canvas-callout {
    display: flex;
    gap: 10px;
    background: #f4f5f7;
    border: 1px solid #e2e4e8;
    border-radius: 6px;
    padding: 10px 12px;
    margin: 0.6em 0;
    break-inside: avoid;
  }
  .canvas-callout-emoji { flex: 0 0 auto; font-size: 16px; line-height: 1.4; }
  .canvas-callout-content { flex: 1; min-width: 0; }
  .canvas-callout-content > :last-child { margin-bottom: 0; }

  /* Toggles / details — always expanded (opened during sanitize) */
  details { margin: 0.4em 0; }
  details > summary { font-weight: 600; cursor: default; list-style: none; }
  details > summary::-webkit-details-marker { display: none; }
  .canvas-toggle-heading .toggle-heading-chevron { display: none; }

  /* Columns — preserved side-by-side */
  .canvas-column-list { display: flex; gap: 18px; margin: 0.4em 0; }
  .canvas-column { flex: 1 1 0; min-width: 0; }

  /* Math */
  .canvas-math-block { text-align: center; margin: 0.7em 0; break-inside: avoid; }
  .canvas-math-block-render { display: inline-block; }

  /* Page links (sub-page chips) */
  .canvas-page-block {
    display: flex;
    align-items: center;
    gap: 8px;
    border: 1px solid #dcdfe3;
    border-radius: 6px;
    padding: 7px 10px;
    margin: 0.45em 0;
    break-inside: avoid;
    color: #1f2328;
  }
  .canvas-page-block-icon { flex: 0 0 auto; }
  .canvas-page-block-title { font-weight: 600; }

  /* Bookmarks */
  .canvas-bookmark {
    display: block;
    border: 1px solid #dcdfe3;
    border-radius: 6px;
    padding: 9px 12px;
    margin: 0.5em 0;
    break-inside: avoid;
    text-decoration: none;
  }
  .canvas-bookmark-title { font-weight: 600; }
  .canvas-bookmark-description { color: #4b5158; font-size: 11.5px; }
  .canvas-bookmark-url { color: #7a8087; font-size: 10.5px; overflow-wrap: anywhere; }
  .canvas-bookmark-image { display: none; }

  /* Table of contents block */
  .canvas-toc { border: 1px solid #e2e4e8; border-radius: 6px; padding: 10px 14px; margin: 0.6em 0; }
  .canvas-toc-title { font-weight: 650; margin-bottom: 4px; }
  .canvas-toc-list { margin: 0; }

  /* Dataview lists */
  .canvas-dataview { border: 1px solid #e2e4e8; border-radius: 6px; padding: 8px 12px; margin: 0.6em 0; }
  .canvas-dataview-row { padding: 2px 0; }

  /* Block-background highlights keep their colour when printBackground is on */
  .canvas-block-bg { border-radius: 4px; padding: 2px 6px; }
`;

const FONT_STACKS: Record<string, string> = {
  default: `-apple-system, 'Segoe UI', system-ui, Roboto, Helvetica, Arial, sans-serif`,
  serif: `Georgia, 'Times New Roman', ui-serif, serif`,
  mono: `Consolas, 'Cascadia Mono', 'Courier New', monospace`,
};

export interface BuildPrintHtmlInput {
  readonly title: string;
  /** Pre-rendered icon HTML (emoji text or inline SVG) — optional. */
  readonly iconHtml?: string;
  /** Sanitized content HTML (from {@link sanitizeContentHtml}). */
  readonly contentHtml: string;
  /** Canvas page font setting: 'default' | 'serif' | 'mono'. */
  readonly fontFamily?: string;
  readonly includeTitle: boolean;
  /**
   * Absolute app root (parallxElectron.appPath). When present, katex + a
   * light highlight.js theme are linked from node_modules so rendered math
   * and syntax colours export faithfully. Missing files degrade gracefully
   * (unstyled math/code, never a broken export).
   */
  readonly appPath?: string;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function toFileUrl(absPath: string): string {
  let p = absPath.replace(/\\/g, '/');
  if (!p.startsWith('/')) p = '/' + p;
  return 'file://' + p.split('/').map((seg, i) => (i === 0 ? seg : encodeURIComponent(seg))).join('/');
}

export function buildPrintHtml(input: BuildPrintHtmlInput): string {
  const fontStack = FONT_STACKS[input.fontFamily ?? 'default'] ?? FONT_STACKS.default;

  const assetLinks: string[] = [];
  if (input.appPath) {
    const base = input.appPath.replace(/[\\/]+$/, '');
    assetLinks.push(
      `<link rel="stylesheet" href="${toFileUrl(`${base}/node_modules/katex/dist/katex.min.css`)}">`,
      `<link rel="stylesheet" href="${toFileUrl(`${base}/node_modules/highlight.js/styles/github.css`)}">`,
    );
  }

  const titleBlock = input.includeTitle
    ? `<header class="print-title-block">`
      + (input.iconHtml ? `<div class="print-icon">${input.iconHtml}</div>` : '')
      + `<h1 class="print-title">${escapeHtml(input.title || 'Untitled')}</h1>`
      + `<hr class="print-rule">`
      + `</header>`
    : '';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(input.title || 'Untitled')}</title>
${assetLinks.join('\n')}
<style>
body { font-family: ${fontStack}; }
${PRINT_CSS}
</style>
</head>
<body>
<div class="print-root">
${titleBlock}
<main class="print-content">${input.contentHtml}</main>
</div>
</body>
</html>`;
}
