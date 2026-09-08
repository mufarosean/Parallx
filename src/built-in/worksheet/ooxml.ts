// ooxml.ts — Worksheets: read .xlsx/.xlsm workbooks ourselves, styles and all.
//
// Why this exists: the SheetJS community edition the import used to go
// through drops every cell style, and the practice-problem workbooks are
// almost nothing but style (the Exam 7 workbook: 2,899 cell styles, 2,144
// merges, 2,079 custom row heights, 527 hidden columns, 383 text boxes
// carrying equations, 45 pictures). A problem has to arrive in Parallx
// looking like the sheet it came from, so this reads the OOXML parts
// directly and builds a Univer workbook snapshot: cells with values,
// formulas and styles; merges; column widths and hidden columns; row
// heights; pictures as floating images; text boxes written into the cells
// they sit over.
//
// PURE: no DOM, no Univer imports beyond types, unit-tested against a
// hand-built workbook (tests/unit/worksheetOoxml.test.ts) and measured
// against the real workbook by tests/probes/problem-bank-reader-probe.mjs.
import JSZip from 'jszip';
import type { IWorkbookData, IStyleData } from '@univerjs/core';
import { ATHENA_ROWS, ATHENA_COLUMNS } from './worksheetConstants.js';

// ── Minimal XML ─────────────────────────────────────────────────────────────
// OOXML parts are machine-written and regular; a small element scanner is
// enough and keeps this file free of DOM and of a parser dependency.

export interface XNode {
  readonly name: string;
  readonly attrs: Record<string, string>;
  readonly children: XNode[];
  text: string;
}

const ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decodeEntities(s: string): string {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITY[e] ?? m;
  });
}
function localName(qname: string): string {
  const i = qname.indexOf(':');
  return i >= 0 ? qname.slice(i + 1) : qname;
}
const ATTR_RE = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/** Parse an XML document into a tree. Element names lose their namespace prefix. */
export function parseXml(xml: string): XNode {
  const root: XNode = { name: '#document', attrs: {}, children: [], text: '' };
  const stack: XNode[] = [root];
  let i = 0;
  const n = xml.length;
  while (i < n) {
    const lt = xml.indexOf('<', i);
    if (lt < 0) { appendText(stack[stack.length - 1], xml.slice(i)); break; }
    if (lt > i) appendText(stack[stack.length - 1], xml.slice(i, lt));
    if (xml.startsWith('<!--', lt)) { const e = xml.indexOf('-->', lt + 4); i = e < 0 ? n : e + 3; continue; }
    if (xml.startsWith('<![CDATA[', lt)) { const e = xml.indexOf(']]>', lt + 9); appendText(stack[stack.length - 1], xml.slice(lt + 9, e < 0 ? n : e), true); i = e < 0 ? n : e + 3; continue; }
    if (xml.startsWith('<?', lt) || xml.startsWith('<!', lt)) { const e = xml.indexOf('>', lt); i = e < 0 ? n : e + 1; continue; }
    const gt = findTagEnd(xml, lt);
    const raw = xml.slice(lt + 1, gt);
    i = gt + 1;
    if (raw[0] === '/') { if (stack.length > 1) stack.pop(); continue; }
    const selfClosing = raw.endsWith('/');
    const body = selfClosing ? raw.slice(0, -1) : raw;
    const sp = body.search(/[\s/]/);
    const name = localName(sp < 0 ? body : body.slice(0, sp));
    const attrs: Record<string, string> = {};
    if (sp >= 0) {
      ATTR_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      const rest = body.slice(sp);
      while ((m = ATTR_RE.exec(rest)) !== null) attrs[localName(m[1])] = decodeEntities(m[2] ?? m[3] ?? '');
    }
    const node: XNode = { name, attrs, children: [], text: '' };
    stack[stack.length - 1].children.push(node);
    if (!selfClosing) stack.push(node);
  }
  return root;
}
function findTagEnd(xml: string, lt: number): number {
  let q: string | null = null;
  for (let j = lt + 1; j < xml.length; j++) {
    const ch = xml[j];
    if (q) { if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") { q = ch; continue; }
    if (ch === '>') return j;
  }
  return xml.length - 1;
}
function appendText(node: XNode, s: string, raw = false): void {
  if (!s) return;
  node.text += raw ? s : decodeEntities(s);
}
function child(node: XNode | undefined, name: string): XNode | undefined {
  return node?.children.find((c) => c.name === name);
}
function children(node: XNode | undefined, name: string): XNode[] {
  return node ? node.children.filter((c) => c.name === name) : [];
}
/** All text under a node, in document order (for rich strings and text boxes). */
function deepText(node: XNode | undefined, only?: string): string {
  if (!node) return '';
  let out = '';
  const walk = (n: XNode): void => {
    if (!only || n.name === only) out += n.text;
    for (const c of n.children) walk(c);
  };
  walk(node);
  return out;
}

// ── A1 references ───────────────────────────────────────────────────────────

export function colToIndex(letters: string): number {
  let col = 0;
  for (const ch of letters) col = col * 26 + (ch.charCodeAt(0) - 64);
  return col - 1;
}
export function indexToCol(index: number): string {
  let s = '';
  let n = index + 1;
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
const REF_RE = /^([A-Z]{1,3})(\d+)$/;
export function parseRef(ref: string): { row: number; col: number } | null {
  const m = REF_RE.exec(ref);
  if (!m) return null;
  return { row: Number(m[2]) - 1, col: colToIndex(m[1]) };
}
function parseRange(ref: string): { r0: number; c0: number; r1: number; c1: number } | null {
  const [a, b] = ref.split(':');
  const p = parseRef(a);
  if (!p) return null;
  const q = b ? parseRef(b) : p;
  if (!q) return null;
  return { r0: Math.min(p.row, q.row), c0: Math.min(p.col, q.col), r1: Math.max(p.row, q.row), c1: Math.max(p.col, q.col) };
}

/**
 * Shift the relative references of a formula by (dRow, dCol): how a shared
 * formula's dependents are reconstructed from its master. String literals
 * are left alone; `$` anchors pin a row or column; names and function names
 * (letters followed by `(` or more letters) are never touched.
 */
export function shiftFormula(formula: string, dRow: number, dCol: number): string {
  if (dRow === 0 && dCol === 0) return formula;
  let out = '';
  let i = 0;
  const n = formula.length;
  while (i < n) {
    const ch = formula[i];
    if (ch === '"') { const e = formula.indexOf('"', i + 1); const j = e < 0 ? n : e + 1; out += formula.slice(i, j); i = j; continue; }
    if (ch === "'") { const e = formula.indexOf("'", i + 1); const j = e < 0 ? n : e + 1; out += formula.slice(i, j); i = j; continue; }
    const m = /^(\$?)([A-Za-z]{1,3})(\$?)(\d+)(?![\w(])/.exec(formula.slice(i));
    const prev = i > 0 ? formula[i - 1] : '';
    if (m && !/[\w.]/.test(prev)) {
      const colAbs = m[1] === '$';
      const rowAbs = m[3] === '$';
      const col = colToIndex(m[2].toUpperCase()) + (colAbs ? 0 : dCol);
      const row = Number(m[4]) - 1 + (rowAbs ? 0 : dRow);
      if (col >= 0 && row >= 0) {
        out += `${m[1]}${indexToCol(col)}${m[3]}${row + 1}`;
        i += m[0].length;
        continue;
      }
    }
    out += ch;
    i++;
  }
  return out;
}

// ── Colours ─────────────────────────────────────────────────────────────────

/** Excel's legacy indexed palette (0..63); 64/65 are the system text and window colours. */
const INDEXED = [
  '000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF',
  '000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF',
  '800000', '008000', '000080', '808000', '800080', '008080', 'C0C0C0', '808080',
  '9999FF', '993366', 'FFFFCC', 'CCFFFF', '660066', 'FF8080', '0066CC', 'CCCCFF',
  '000080', 'FF00FF', 'FFFF00', '00FFFF', '800080', '800000', '008080', '0000FF',
  '00CCFF', 'CCFFFF', 'CCFFCC', 'FFFF99', '99CCFF', 'FF99CC', 'CC99FF', 'FFCC99',
  '3366FF', '33CCCC', '99CC00', 'FFCC00', 'FF9900', 'FF6600', '666699', '969696',
  '003366', '339966', '003300', '333300', '993300', '993366', '333399', '333333',
  '000000', 'FFFFFF',
];
/** Theme colour slots in the order `theme="n"` indexes them (lt1 and dk1 swap places). */
const THEME_SLOTS = ['lt1', 'dk1', 'lt2', 'dk2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'];

function hexToRgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
}
function rgbToHex(r: number, g: number, b: number): string {
  const h = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0').toUpperCase();
  return `${h(r)}${h(g)}${h(b)}`;
}
/** Excel's tint: lighten (tint > 0) or darken (tint < 0) in HSL luminance. */
export function applyTint(hex: string, tint: number): string {
  if (!tint) return hex;
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let l = (max + min) / 2;
  let s = 0;
  let h = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  l = tint < 0 ? l * (1 + tint) : l * (1 - tint) + tint;
  const hue2rgb = (p: number, q: number, t: number): number => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  let rr: number, gg: number, bb: number;
  if (s === 0) { rr = gg = bb = l; } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    rr = hue2rgb(p, q, h + 1 / 3); gg = hue2rgb(p, q, h); bb = hue2rgb(p, q, h - 1 / 3);
  }
  return rgbToHex(rr * 255, gg * 255, bb * 255);
}

// ── Number formats ──────────────────────────────────────────────────────────

const BUILTIN_NUMFMT: Record<number, string> = {
  0: 'General', 1: '0', 2: '0.00', 3: '#,##0', 4: '#,##0.00', 9: '0%', 10: '0.00%', 11: '0.00E+00', 12: '# ?/?', 13: '# ??/??',
  14: 'm/d/yyyy', 15: 'd-mmm-yy', 16: 'd-mmm', 17: 'mmm-yy', 18: 'h:mm AM/PM', 19: 'h:mm:ss AM/PM', 20: 'h:mm', 21: 'h:mm:ss', 22: 'm/d/yyyy h:mm',
  37: '#,##0 ;(#,##0)', 38: '#,##0 ;[Red](#,##0)', 39: '#,##0.00;(#,##0.00)', 40: '#,##0.00;[Red](#,##0.00)',
  45: 'mm:ss', 46: '[h]:mm:ss', 47: 'mmss.0', 48: '##0.0E+0', 49: '@',
};

// ── Styles ──────────────────────────────────────────────────────────────────

interface StyleTables {
  readonly numFmts: Map<number, string>;
  readonly fonts: XNode[];
  readonly fills: XNode[];
  readonly borders: XNode[];
  readonly cellXfs: XNode[];
  readonly theme: string[]; // hex by THEME_SLOTS index
}

const BORDER_STYLE: Record<string, number> = {
  thin: 1, hair: 2, dotted: 3, dashed: 4, dashDot: 5, dashDotDot: 6, double: 7, medium: 8,
  mediumDashed: 9, mediumDashDot: 10, mediumDashDotDot: 11, slantDashDot: 12, thick: 13,
};
const H_ALIGN: Record<string, number> = { left: 1, center: 2, right: 3, justify: 4, centerContinuous: 2, distributed: 6 };
const V_ALIGN: Record<string, number> = { top: 1, center: 2, bottom: 3 };

function colorOf(node: XNode | undefined, tables: StyleTables): string | null {
  if (!node) return null;
  const a = node.attrs;
  if (a.auto === '1' || a.auto === 'true') return null;
  let hex: string | null = null;
  if (a.rgb) hex = a.rgb.length === 8 ? a.rgb.slice(2) : a.rgb;
  else if (a.theme !== undefined) hex = tables.theme[Number(a.theme)] ?? null;
  else if (a.indexed !== undefined) hex = INDEXED[Number(a.indexed)] ?? null;
  if (!hex) return null;
  hex = hex.toUpperCase();
  const tint = a.tint ? Number(a.tint) : 0;
  return `#${tint ? applyTint(hex, tint) : hex}`;
}

/** cellXfs entry → Univer style. Null when the xf sets nothing visible. */
function styleFromXf(xf: XNode, tables: StyleTables): IStyleData | null {
  const s: Record<string, unknown> = {};
  const font = tables.fonts[Number(xf.attrs.fontId ?? -1)];
  if (font) {
    const name = child(font, 'name')?.attrs.val;
    const size = child(font, 'sz')?.attrs.val;
    if (name) s.ff = name;
    if (size) s.fs = Number(size);
    if (child(font, 'b')) s.bl = 1;
    if (child(font, 'i')) s.it = 1;
    if (child(font, 'u')) s.ul = { s: 1 };
    if (child(font, 'strike')) s.st = { s: 1 };
    const cl = colorOf(child(font, 'color'), tables);
    if (cl) s.cl = { rgb: cl };
  }
  const fill = tables.fills[Number(xf.attrs.fillId ?? -1)];
  const pattern = child(fill, 'patternFill');
  if (pattern && pattern.attrs.patternType && pattern.attrs.patternType !== 'none') {
    const bg = colorOf(child(pattern, 'fgColor'), tables) ?? colorOf(child(pattern, 'bgColor'), tables);
    if (bg) s.bg = { rgb: bg };
  }
  const border = tables.borders[Number(xf.attrs.borderId ?? -1)];
  if (border) {
    const bd: Record<string, { s: number; cl: { rgb: string } }> = {};
    for (const [side, key] of [['top', 't'], ['bottom', 'b'], ['left', 'l'], ['right', 'r']] as const) {
      const edge = child(border, side);
      const style = edge?.attrs.style;
      if (!style || style === 'none') continue;
      bd[key] = { s: BORDER_STYLE[style] ?? 1, cl: { rgb: colorOf(child(edge, 'color'), tables) ?? '#000000' } };
    }
    if (Object.keys(bd).length) s.bd = bd;
  }
  const al = child(xf, 'alignment');
  if (al) {
    if (al.attrs.horizontal && H_ALIGN[al.attrs.horizontal]) s.ht = H_ALIGN[al.attrs.horizontal];
    if (al.attrs.vertical && V_ALIGN[al.attrs.vertical]) s.vt = V_ALIGN[al.attrs.vertical];
    if (al.attrs.wrapText === '1' || al.attrs.wrapText === 'true') s.tb = 3;
    const rot = Number(al.attrs.textRotation ?? 0);
    if (rot) s.tr = { a: rot === 255 ? 90 : rot > 90 ? 90 - rot : rot };
  }
  const numFmtId = Number(xf.attrs.numFmtId ?? 0);
  if (numFmtId) {
    const pattern2 = tables.numFmts.get(numFmtId) ?? BUILTIN_NUMFMT[numFmtId];
    if (pattern2 && pattern2 !== 'General') s.n = { pattern: pattern2 };
  }
  return Object.keys(s).length ? (s as IStyleData) : null;
}

// ── Workbook ────────────────────────────────────────────────────────────────

/** One formatted run of a rich string (a cell with mixed formatting, e.g. a subscript). */
export interface RichRun {
  readonly text: string;
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly underline?: boolean;
  /** Points. */
  readonly size?: number;
  readonly font?: string;
  /** '#RRGGBB' */
  readonly color?: string;
  readonly vertAlign?: 'superscript' | 'subscript';
}
export interface XlsxCell {
  readonly row: number;
  readonly col: number;
  /** Number, string, or boolean value; undefined for formula-only cells with no cache. */
  readonly value?: number | string | boolean;
  /** Formatted runs when the string carries its own formatting (subscripts, a bold word); absent for plain text. */
  readonly rich?: readonly RichRun[];
  /** Formula text WITHOUT the leading '='. */
  readonly formula?: string;
  /** Array-formula range (A1 range) when this cell is the master of one. */
  readonly arrayRef?: string;
  /** Style index into cellXfs; undefined when unstyled. */
  readonly styleIndex?: number;
  /** 'e' for error cells (value holds the error text). */
  readonly kind?: 'error';
}
export interface XlsxColumn { readonly min: number; readonly max: number; readonly widthPx: number; readonly hidden: boolean; readonly custom: boolean }
export interface XlsxRow { readonly index: number; readonly heightPx?: number; readonly hidden: boolean }
export interface XlsxMerge { readonly r0: number; readonly c0: number; readonly r1: number; readonly c1: number }
export interface XlsxAnchor { readonly row: number; readonly col: number; readonly rowOffsetPx: number; readonly colOffsetPx: number }
export interface XlsxImage {
  readonly from: XlsxAnchor;
  /** Absent for one-cell anchors; extPx then gives the size. */
  readonly to?: XlsxAnchor;
  readonly extPx?: { width: number; height: number };
  readonly mime: string;
  readonly base64: string;
  readonly name: string;
}
/** A paragraph of a text box: runs plus alignment. */
export interface DrawParagraph { readonly runs: readonly RichRun[]; readonly align: 'l' | 'ctr' | 'r' }
export interface XlsxTextBox {
  readonly from: XlsxAnchor;
  readonly to?: XlsxAnchor;
  readonly extPx?: { width: number; height: number };
  /** Plain text, paragraphs joined by newlines. */
  readonly text: string;
  readonly paragraphs: readonly DrawParagraph[];
  /** '#RRGGBB' background, or null for no fill. */
  readonly fill: string | null;
  /** Inner padding in px (DrawingML insets), left/top. */
  readonly insetPx: { left: number; top: number };
}
export interface XlsxSheet {
  readonly name: string;
  readonly state: 'visible' | 'hidden' | 'veryHidden';
  readonly cells: XlsxCell[];
  readonly merges: XlsxMerge[];
  readonly columns: XlsxColumn[];
  readonly rows: XlsxRow[];
  readonly defaultColumnWidthPx: number;
  readonly defaultRowHeightPx: number;
  readonly maxRow: number;
  readonly maxCol: number;
  readonly images: XlsxImage[];
  /** Pictures in formats the app cannot show (emf, wmf), counted so the loss is visible. */
  readonly imagesSkipped: number;
  readonly textBoxes: XlsxTextBox[];
  readonly sharedFormulas: number;
}
export interface XlsxWorkbook {
  readonly sheetNames: string[];
  sheetState(name: string): 'visible' | 'hidden' | 'veryHidden';
  readSheet(name: string): Promise<XlsxSheet>;
  /** Univer style for a cellXfs index (cached). */
  styleFor(styleIndex: number): IStyleData | null;
}

/** Excel column width (character units) → pixels, Excel's own rounding. */
export function columnWidthPx(chars: number): number {
  return Math.floor(((256 * chars + Math.floor(128 / 7)) / 256) * 7);
}
const EMU_PER_PX = 9525;
const pt2px = (pt: number): number => Math.round((pt * 96) / 72);

export async function openXlsx(bytes: Uint8Array | ArrayBuffer): Promise<XlsxWorkbook> {
  const zip = await JSZip.loadAsync(bytes);
  const text = async (p: string): Promise<string | null> => { const f = zip.file(p); return f ? f.async('string') : null; };
  const wbXml = await text('xl/workbook.xml');
  if (!wbXml) throw new Error('Not a workbook: xl/workbook.xml is missing');
  const wbRels = parseXml((await text('xl/_rels/workbook.xml.rels')) ?? '');
  const relTargets = new Map<string, string>();
  for (const r of children(child(wbRels, 'Relationships'), 'Relationship')) relTargets.set(r.attrs.Id, r.attrs.Target);
  const wb = parseXml(wbXml);
  const sheetsNode = child(child(wb, 'workbook'), 'sheets');
  const entries: { name: string; path: string; state: 'visible' | 'hidden' | 'veryHidden' }[] = [];
  for (const s of children(sheetsNode, 'sheet')) {
    const target = relTargets.get(s.attrs.id ?? '') ?? '';
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
    const state = s.attrs.state === 'hidden' ? 'hidden' : s.attrs.state === 'veryHidden' ? 'veryHidden' : 'visible';
    entries.push({ name: s.attrs.name, path, state });
  }

  // Theme colours first: rich-string runs and styles both name them.
  const theme: string[] = [];
  const themeXml = await text('xl/theme/theme1.xml');
  if (themeXml) {
    const scheme = child(child(child(parseXml(themeXml), 'theme'), 'themeElements'), 'clrScheme');
    for (const slot of THEME_SLOTS) {
      const node = child(scheme, slot);
      const sys = child(node, 'sysClr');
      const srgb = child(node, 'srgbClr');
      theme.push((sys?.attrs.lastClr ?? srgb?.attrs.val ?? '000000').toUpperCase());
    }
  }
  const stylesXml = await text('xl/styles.xml');
  const st = stylesXml ? child(parseXml(stylesXml), 'styleSheet') : undefined;
  const numFmts = new Map<number, string>();
  for (const f of children(child(st, 'numFmts'), 'numFmt')) numFmts.set(Number(f.attrs.numFmtId), f.attrs.formatCode);
  const tables: StyleTables = {
    numFmts,
    fonts: children(child(st, 'fonts'), 'font'),
    fills: children(child(st, 'fills'), 'fill'),
    borders: children(child(st, 'borders'), 'border'),
    cellXfs: children(child(st, 'cellXfs'), 'xf'),
    theme,
  };
  // Shared strings: plain text always, plus the runs when a string carries
  // its own formatting (a subscript year, a bold word, a maths font).
  const sharedStrings: string[] = [];
  const sharedRuns = new Map<number, RichRun[]>();
  const ssXml = await text('xl/sharedStrings.xml');
  if (ssXml) {
    for (const si of children(child(parseXml(ssXml), 'sst'), 'si')) {
      sharedStrings.push(deepText(si, 't'));
      const runs = richRunsOf(si, tables);
      if (runs) sharedRuns.set(sharedStrings.length - 1, runs);
    }
  }
  const styleCache = new Map<number, IStyleData | null>();
  const styleFor = (idx: number): IStyleData | null => {
    if (styleCache.has(idx)) return styleCache.get(idx) ?? null;
    const xf = tables.cellXfs[idx];
    const style = xf ? styleFromXf(xf, tables) : null;
    styleCache.set(idx, style);
    return style;
  };

  const readSheet = async (name: string): Promise<XlsxSheet> => {
    const entry = entries.find((e) => e.name === name);
    if (!entry) throw new Error(`No sheet named ${name}`);
    const xml = await text(entry.path);
    if (!xml) throw new Error(`Sheet part missing: ${entry.path}`);
    const ws = child(parseXml(xml), 'worksheet');
    const fmt = child(ws, 'sheetFormatPr')?.attrs ?? {};
    // defaultColWidth is a stored width (padding included); baseColWidth is a digit
    // count, and Excel's 8-digit default renders 64 px wide.
    const defaultColumnWidthPx = fmt.defaultColWidth ? columnWidthPx(Number(fmt.defaultColWidth)) : Math.round((Number(fmt.baseColWidth ?? 8) + 0.43) * 7 + 5);
    const defaultRowHeightPx = pt2px(Number(fmt.defaultRowHeight ?? 15));
    const columns: XlsxColumn[] = children(child(ws, 'cols'), 'col').map((c) => ({
      min: Number(c.attrs.min) - 1, max: Number(c.attrs.max) - 1,
      widthPx: c.attrs.width ? columnWidthPx(Number(c.attrs.width)) : defaultColumnWidthPx,
      hidden: c.attrs.hidden === '1' || c.attrs.hidden === 'true',
      custom: c.attrs.customWidth === '1' || c.attrs.customWidth === 'true',
    }));
    const rows: XlsxRow[] = [];
    const cells: XlsxCell[] = [];
    const shared = new Map<string, { row: number; col: number; formula: string }>();
    let sharedCount = 0;
    let maxRow = 0;
    let maxCol = 0;
    for (const row of children(child(ws, 'sheetData'), 'row')) {
      const rIndex = Number(row.attrs.r) - 1;
      const hidden = row.attrs.hidden === '1' || row.attrs.hidden === 'true';
      const custom = row.attrs.customHeight === '1' || row.attrs.customHeight === 'true';
      if (hidden || (custom && row.attrs.ht)) rows.push({ index: rIndex, heightPx: custom && row.attrs.ht ? pt2px(Number(row.attrs.ht)) : undefined, hidden });
      for (const c of children(row, 'c')) {
        const pos = parseRef(c.attrs.r ?? '');
        if (!pos) continue;
        const type = c.attrs.t ?? 'n';
        const vNode = child(c, 'v');
        const fNode = child(c, 'f');
        let value: number | string | boolean | undefined;
        let kind: 'error' | undefined;
        let rich: RichRun[] | undefined;
        if (type === 's') { const idx = Number(vNode?.text ?? -1); value = sharedStrings[idx] ?? ''; rich = sharedRuns.get(idx); }
        else if (type === 'inlineStr') { const is = child(c, 'is'); value = deepText(is, 't'); rich = is ? richRunsOf(is, tables) ?? undefined : undefined; }
        else if (type === 'str' || type === 'd') value = vNode?.text ?? '';
        else if (type === 'b') value = vNode?.text === '1';
        else if (type === 'e') { value = vNode?.text ?? '#VALUE!'; kind = 'error'; }
        else if (vNode && vNode.text !== '') value = Number(vNode.text);
        let formula: string | undefined;
        let arrayRef: string | undefined;
        if (fNode) {
          if (fNode.attrs.t === 'shared') {
            const si = fNode.attrs.si ?? '';
            if (fNode.text) { shared.set(si, { row: pos.row, col: pos.col, formula: fNode.text }); formula = fNode.text; }
            else {
              const master = shared.get(si);
              formula = master ? shiftFormula(master.formula, pos.row - master.row, pos.col - master.col) : undefined;
              sharedCount++;
            }
          } else {
            formula = fNode.text || undefined;
            if (fNode.attrs.t === 'array' && fNode.attrs.ref) arrayRef = fNode.attrs.ref;
          }
        }
        const styleIndex = c.attrs.s !== undefined ? Number(c.attrs.s) : undefined;
        if (value === undefined && !formula && styleIndex === undefined) continue;
        cells.push({ row: pos.row, col: pos.col, value, formula, arrayRef, styleIndex, kind, rich });
        if (pos.row > maxRow) maxRow = pos.row;
        if (pos.col > maxCol) maxCol = pos.col;
      }
    }
    const merges: XlsxMerge[] = [];
    for (const m of children(child(ws, 'mergeCells'), 'mergeCell')) { const r = parseRange(m.attrs.ref ?? ''); if (r) merges.push(r); }

    // Drawings: pictures and text boxes anchored to cells.
    const images: XlsxImage[] = [];
    const textBoxes: XlsxTextBox[] = [];
    let imagesSkipped = 0;
    const base = entry.path.slice(entry.path.lastIndexOf('/') + 1);
    const relsXml = await text(`xl/worksheets/_rels/${base}.rels`);
    const drawingNode = child(ws, 'drawing');
    if (relsXml && drawingNode) {
      const rels = new Map<string, string>();
      for (const r of children(child(parseXml(relsXml), 'Relationships'), 'Relationship')) rels.set(r.attrs.Id, r.attrs.Target);
      const target = rels.get(drawingNode.attrs.id ?? '');
      if (target) {
        const drawingPath = resolvePath('xl/worksheets/', target);
        const dXml = await text(drawingPath);
        const dRelsXml = await text(drawingPath.replace(/\/([^/]+)$/, '/_rels/$1.rels'));
        const dRels = new Map<string, string>();
        if (dRelsXml) for (const r of children(child(parseXml(dRelsXml), 'Relationships'), 'Relationship')) dRels.set(r.attrs.Id, r.attrs.Target);
        if (dXml) {
          const root = child(parseXml(dXml), 'wsDr');
          for (const anchor of root?.children ?? []) {
            if (!/Anchor$/.test(anchor.name)) continue;
            const from = anchorOf(child(anchor, 'from'));
            if (!from) continue;
            const to = anchorOf(child(anchor, 'to'));
            const ext = child(anchor, 'ext');
            const extPx = ext ? { width: Math.round(Number(ext.attrs.cx ?? 0) / EMU_PER_PX), height: Math.round(Number(ext.attrs.cy ?? 0) / EMU_PER_PX) } : undefined;
            const drawables: XNode[] = [];
            collectDrawables(anchor, drawables);
            for (const item of drawables) {
            const pic = item.name === 'pic' ? item : undefined;
            if (pic) {
              const embed = child(child(pic, 'blipFill'), 'blip')?.attrs.embed ?? '';
              const mediaTarget = dRels.get(embed);
              const mediaPath = mediaTarget ? resolvePath('xl/drawings/', mediaTarget) : '';
              const ext2 = mediaPath.slice(mediaPath.lastIndexOf('.') + 1).toLowerCase();
              const mime = ext2 === 'png' ? 'image/png' : ext2 === 'jpg' || ext2 === 'jpeg' ? 'image/jpeg' : ext2 === 'gif' ? 'image/gif' : ext2 === 'bmp' ? 'image/bmp' : ext2 === 'svg' ? 'image/svg+xml' : '';
              const file = mime ? zip.file(mediaPath) : null;
              if (!file) { imagesSkipped++; continue; }
              images.push({ from, to: to ?? undefined, extPx, mime, base64: await file.async('base64'), name: child(child(pic, 'nvPicPr'), 'cNvPr')?.attrs.name ?? 'Picture' });
              continue;
            }
            const paragraphs = textBoxParagraphs(item);
            if (paragraphs.length) {
              const spPr = child(item, 'spPr');
              const fill = spPr ? drawingFill(spPr, theme) : null;
              const bodyPr = child(child(item, 'txBody'), 'bodyPr');
              const inset = (name: string, dflt: number): number => (bodyPr?.attrs[name] !== undefined ? Math.round(Number(bodyPr.attrs[name]) / EMU_PER_PX) : dflt);
              textBoxes.push({
                from, to: to ?? undefined, extPx,
                text: paragraphs.map((p) => p.runs.map((r) => r.text).join('')).join('\n'),
                paragraphs, fill,
                insetPx: { left: inset('lIns', 10), top: inset('tIns', 5) },
              });
            }
            }
          }
        }
      }
    }
    return { name, state: entry.state, cells, merges, columns, rows, defaultColumnWidthPx, defaultRowHeightPx, maxRow, maxCol, images, imagesSkipped, textBoxes, sharedFormulas: sharedCount };
  };

  return {
    sheetNames: entries.map((e) => e.name),
    sheetState: (name) => entries.find((e) => e.name === name)?.state ?? 'visible',
    readSheet,
    styleFor,
  };
}
function resolvePath(baseDir: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = (baseDir + target).split('/');
  const out: string[] = [];
  for (const p of parts) { if (p === '..') out.pop(); else if (p !== '.' && p !== '') out.push(p); }
  return out.join('/');
}
/**
 * Pictures and shapes under an anchor. Office wraps equation text boxes in
 * AlternateContent: the Choice carries the maths as OMML, the Fallback the
 * same box with plain-text runs, which is the readable form; groups nest
 * their members.
 */
function collectDrawables(node: XNode, out: XNode[]): void {
  for (const c of node.children) {
    if (c.name === 'pic' || c.name === 'sp') out.push(c);
    else if (c.name === 'AlternateContent') {
      const picked: XNode[] = [];
      const fallback = child(c, 'Fallback');
      if (fallback) collectDrawables(fallback, picked);
      const choice = child(c, 'Choice');
      if (!picked.length && choice) collectDrawables(choice, picked);
      out.push(...picked);
    } else if (c.name === 'grpSp') collectDrawables(c, out);
  }
}
/** Runs of a shared/inline string, or null when it has no formatting of its own. */
function richRunsOf(si: XNode, tables: StyleTables): RichRun[] | null {
  const rs = children(si, 'r');
  if (rs.length === 0) return null;
  const runs: RichRun[] = [];
  let styled = false;
  for (const r of rs) {
    const t = deepText(r, 't');
    if (!t) continue;
    const pr = child(r, 'rPr');
    const run: { -readonly [K in keyof RichRun]: RichRun[K] } = { text: t };
    if (pr) {
      if (child(pr, 'b')) run.bold = true;
      if (child(pr, 'i')) run.italic = true;
      if (child(pr, 'u')) run.underline = true;
      const sz = child(pr, 'sz')?.attrs.val;
      if (sz) run.size = Number(sz);
      const font = child(pr, 'rFont')?.attrs.val;
      if (font) run.font = font;
      const cl = colorOf(child(pr, 'color'), tables);
      if (cl) run.color = cl;
      const va = child(pr, 'vertAlign')?.attrs.val;
      if (va === 'superscript' || va === 'subscript') run.vertAlign = va;
      if (run.bold || run.italic || run.underline || run.vertAlign || run.size !== undefined || run.font || run.color) styled = true;
    }
    runs.push(run);
  }
  return styled ? runs : null;
}
/** Paragraphs of a DrawingML text body as runs; OMML maths inside a paragraph reads as its text. */
function textBoxParagraphs(sp: XNode): DrawParagraph[] {
  const out: DrawParagraph[] = [];
  for (const p of children(child(sp, 'txBody'), 'p')) {
    const algn = child(p, 'pPr')?.attrs.algn;
    const runs: RichRun[] = [];
    const walk = (n: XNode): void => {
      for (const c of n.children) {
        if (c.name === 'r' || c.name === 'fld') {
          const t = deepText(c, 't');
          if (!t) continue;
          const pr = child(c, 'rPr');
          const run: { -readonly [K in keyof RichRun]: RichRun[K] } = { text: t };
          if (pr) {
            if (pr.attrs.b === '1' || pr.attrs.b === 'true') run.bold = true;
            if (pr.attrs.i === '1' || pr.attrs.i === 'true') run.italic = true;
            if (pr.attrs.u && pr.attrs.u !== 'none') run.underline = true;
            if (pr.attrs.sz) run.size = Number(pr.attrs.sz) / 100;
            const baseline = Number(pr.attrs.baseline ?? 0);
            if (baseline > 0) run.vertAlign = 'superscript';
            else if (baseline < 0) run.vertAlign = 'subscript';
            const face = child(pr, 'latin')?.attrs.typeface;
            if (face) run.font = face;
            const rgb = child(child(pr, 'solidFill'), 'srgbClr')?.attrs.val;
            if (rgb) run.color = `#${rgb.toUpperCase()}`;
          }
          runs.push(run);
        } else if (c.name === 'br') {
          runs.push({ text: '\n' });
        } else if (c.name === 'm' || c.name === 'oMathPara' || c.name === 'oMath' || c.name === 'AlternateContent' || c.name === 'Choice' || c.name === 'Fallback') {
          walk(c);
        }
      }
    };
    walk(p);
    if (runs.some((r) => r.text.trim())) out.push({ runs, align: algn === 'ctr' ? 'ctr' : algn === 'r' ? 'r' : 'l' });
  }
  return out;
}
/** Solid fill of a shape, resolved through the theme; null for no fill. */
function drawingFill(spPr: XNode, theme: readonly string[]): string | null {
  const solid = child(spPr, 'solidFill');
  if (!solid) return null;
  const srgb = child(solid, 'srgbClr')?.attrs.val;
  if (srgb) return `#${srgb.toUpperCase()}`;
  const scheme = child(solid, 'schemeClr')?.attrs.val;
  if (!scheme) return null;
  const slot = scheme === 'bg1' ? 'lt1' : scheme === 'tx1' ? 'dk1' : scheme === 'bg2' ? 'lt2' : scheme === 'tx2' ? 'dk2' : scheme;
  const idx = THEME_SLOTS.indexOf(slot);
  return idx >= 0 && theme[idx] ? `#${theme[idx]}` : null;
}
function anchorOf(node: XNode | undefined): XlsxAnchor | null {
  if (!node) return null;
  const num = (name: string): number => Number(child(node, name)?.text ?? 0);
  return { row: num('row'), col: num('col'), rowOffsetPx: Math.round(num('rowOff') / EMU_PER_PX), colOffsetPx: Math.round(num('colOff') / EMU_PER_PX) };
}

// ── Snapshot ────────────────────────────────────────────────────────────────

export interface SnapshotOptions {
  /** Cells (row, col, zero-based) to leave out, e.g. workbook machinery. */
  readonly dropCells?: ReadonlySet<string>;
  /** Columns from this index on are hidden in the snapshot (the solution, until revealed). */
  readonly hideFromColumn?: number;
  /** Last column to hide (inclusive); defaults to the sheet's used range, so columns past the solution stay usable. */
  readonly hideToColumn?: number;
  /** Snapshot ids; defaults are unique per call. */
  readonly unitId?: string;
  readonly sheetId?: string;
}
export interface SnapshotStats {
  cells: number; styledCells: number; styles: number; formulas: number; merges: number;
  hiddenColumns: number; hiddenRows: number; customRowHeights: number;
  images: number; imagesSkipped: number; textBoxes: number; textBoxesDropped: number;
}
export interface SheetSnapshot {
  readonly workbook: IWorkbookData;
  readonly stats: SnapshotStats;
}

let _snapshotCounter = 0;

/**
 * One sheet → one Univer workbook snapshot, formatting intact. Text boxes are
 * written into the cell under their top-left corner (the next empty cell to
 * the right when that one is taken); pictures become floating images.
 */
export function sheetToSnapshot(sheet: XlsxSheet, book: XlsxWorkbook, opts: SnapshotOptions = {}): SheetSnapshot {
  const unitId = opts.unitId ?? `ws-xlsx-${Date.now()}-${_snapshotCounter++}`;
  const sheetId = opts.sheetId ?? 's0';
  const styles: Record<string, IStyleData> = {};
  const styleKeys = new Map<number, string>();
  const cellData: Record<number, Record<number, Record<string, unknown>>> = {};
  const stats: SnapshotStats = { cells: 0, styledCells: 0, styles: 0, formulas: 0, merges: 0, hiddenColumns: 0, hiddenRows: 0, customRowHeights: 0, images: 0, imagesSkipped: sheet.imagesSkipped, textBoxes: 0, textBoxesDropped: 0 };
  const styleKey = (idx: number): string | null => {
    const cached = styleKeys.get(idx);
    if (cached !== undefined) return cached || null;
    const style = book.styleFor(idx);
    const key = style ? `x${idx}` : '';
    if (style) { styles[key] = style; stats.styles++; }
    styleKeys.set(idx, key);
    return key || null;
  };
  // Excel's trailing <col> span reaches column XFD; the snapshot stops a
  // little past the used range so hiding "the solution and everything
  // right of it" does not hide sixteen thousand columns.
  const usedCol = Math.max(sheet.maxCol, 0, ...sheet.merges.map((m) => m.c1));
  // Room to work past the solution: the student compares side by side in
  // the columns after it, so the grid runs well beyond the used range.
  const lastCol = usedCol + 4;
  const hideTo = opts.hideToColumn ?? usedCol;
  for (const c of sheet.cells) {
    // A dropped cell (workbook machinery such as the Self-Rating dropdown)
    // loses its content but keeps its fill, so no white hole opens.
    const dropped = opts.dropCells?.has(`${c.row}:${c.col}`) === true;
    const data: Record<string, unknown> = {};
    if (c.formula && !dropped) {
      data.f = `=${c.formula.replace(/_xl(fn|ws|pm)\./g, '')}`;
      if (c.arrayRef) data.ref = c.arrayRef;
      stats.formulas++;
    }
    if (c.value !== undefined && !dropped) {
      if (typeof c.value === 'boolean') { data.v = c.value ? 1 : 0; data.t = 3; }
      else if (typeof c.value === 'number') { data.v = c.value; data.t = 2; }
      else { data.v = c.value; data.t = 1; }
      // Mixed formatting inside one cell (a subscript year, a bold word)
      // needs the rich-text document form; the plain value stays for formulas.
      if (c.rich && typeof c.value === 'string') {
        const base = c.styleIndex !== undefined ? book.styleFor(c.styleIndex) : null;
        data.p = richDocument(`p${c.row}_${c.col}`, c.rich, base);
      }
    }
    if (c.styleIndex !== undefined) {
      const k = styleKey(c.styleIndex);
      if (k && !dropped) { data.s = k; stats.styledCells++; }
      else if (k && dropped) {
        // Fill only: the dropdown's thick border would otherwise draw an empty box.
        const bg = (styles[k] as { bg?: unknown }).bg;
        if (bg) { const fillKey = `${k}-fill`; if (!styles[fillKey]) { styles[fillKey] = { bg } as IStyleData; stats.styles++; } data.s = fillKey; stats.styledCells++; }
      }
    }
    if (Object.keys(data).length === 0) continue;
    (cellData[c.row] ??= {})[c.col] = data;
    stats.cells++;
  }
  // Text boxes → cells.
  // Text boxes stay floating: each becomes an SVG image at its own anchor,
  // its runs kept (superscripts, italics, the maths font), drawn over the
  // cells the way Excel draws it. Nothing is written into a cell.
  // Columns and rows.
  const columnData: Record<number, { w?: number; hd?: number }> = {};
  for (const col of sheet.columns) {
    for (let i = col.min; i <= Math.min(col.max, lastCol); i++) {
      const d: { w?: number; hd?: number } = {};
      if (col.custom || col.widthPx !== sheet.defaultColumnWidthPx) d.w = col.widthPx;
      if (col.hidden) { d.hd = 1; stats.hiddenColumns++; }
      if (Object.keys(d).length) columnData[i] = d;
    }
  }
  if (opts.hideFromColumn !== undefined) {
    for (let i = opts.hideFromColumn; i <= hideTo; i++) { (columnData[i] ??= {}).hd = 1; }
  }
  const rowData: Record<number, { h?: number; hd?: number }> = {};
  for (const row of sheet.rows) {
    const d: { h?: number; hd?: number } = {};
    if (row.heightPx !== undefined) { d.h = row.heightPx; stats.customRowHeights++; }
    if (row.hidden) { d.hd = 1; stats.hiddenRows++; }
    if (Object.keys(d).length) rowData[row.index] = d;
  }
  const mergeData = sheet.merges.map((m) => ({ startRow: m.r0, startColumn: m.c0, endRow: m.r1, endColumn: m.c1 }));
  stats.merges = mergeData.length;
  const rowCount = Math.max(ATHENA_ROWS, sheet.maxRow + 20, ...sheet.merges.map((m) => m.r1 + 1));
  const columnCount = Math.max(ATHENA_COLUMNS, usedCol + 27);

  // Pictures → floating images. Pixel positions come from the grid geometry.
  const widthOf = (c: number): number => (columnData[c]?.hd ? 0 : columnData[c]?.w ?? sheet.defaultColumnWidthPx);
  const heightOf = (r: number): number => (rowData[r]?.hd ? 0 : rowData[r]?.h ?? sheet.defaultRowHeightPx);
  const xOf = (a: XlsxAnchor): number => { let x = 0; for (let c = 0; c < a.col; c++) x += widthOf(c); return x + a.colOffsetPx; };
  const yOf = (a: XlsxAnchor): number => { let y = 0; for (let r = 0; r < a.row; r++) y += heightOf(r); return y + a.rowOffsetPx; };
  const drawings: Record<string, unknown> = {};
  const order: string[] = [];
  sheet.images.forEach((img, i) => {
    const left = xOf(img.from);
    const top = yOf(img.from);
    let width: number;
    let height: number;
    let to = img.to;
    if (to) { width = Math.max(1, xOf(to) - left); height = Math.max(1, yOf(to) - top); }
    else {
      width = Math.max(1, img.extPx?.width ?? 100); height = Math.max(1, img.extPx?.height ?? 100);
      to = anchorAt(left + width, top + height, widthOf, heightOf);
    }
    const drawingId = `img${i}`;
    const from = { row: img.from.row, column: img.from.col, rowOffset: img.from.rowOffsetPx, columnOffset: img.from.colOffsetPx };
    const toPos = { row: to.row, column: to.col, rowOffset: to.rowOffsetPx, columnOffset: to.colOffsetPx };
    drawings[drawingId] = {
      unitId, subUnitId: sheetId, drawingId, drawingType: 0, imageSourceType: 'BASE64',
      source: `data:${img.mime};base64,${img.base64}`,
      transform: { left, top, width, height, angle: 0, skewX: 0, skewY: 0, flipX: false, flipY: false },
      sheetTransform: { from, to: toPos },
      axisAlignSheetTransform: { from, to: toPos },
      anchorType: '1',
    };
    order.push(drawingId);
    stats.images++;
  });
  sheet.textBoxes.forEach((tb, i) => {
    const left = xOf(tb.from);
    const top = yOf(tb.from);
    let width: number;
    let height: number;
    let to = tb.to;
    if (to) { width = Math.max(8, xOf(to) - left); height = Math.max(8, yOf(to) - top); }
    else {
      width = Math.max(8, tb.extPx?.width ?? 120); height = Math.max(8, tb.extPx?.height ?? 24);
      to = anchorAt(left + width, top + height, widthOf, heightOf);
    }
    const svg = textBoxSvg(tb, width, height);
    const drawingId = `tb${i}`;
    const from = { row: tb.from.row, column: tb.from.col, rowOffset: tb.from.rowOffsetPx, columnOffset: tb.from.colOffsetPx };
    const toPos = { row: to.row, column: to.col, rowOffset: to.rowOffsetPx, columnOffset: to.colOffsetPx };
    drawings[drawingId] = {
      unitId, subUnitId: sheetId, drawingId, drawingType: 0, imageSourceType: 'BASE64',
      source: `data:image/svg+xml;base64,${toBase64Utf8(svg)}`,
      transform: { left, top, width, height, angle: 0, skewX: 0, skewY: 0, flipX: false, flipY: false },
      sheetTransform: { from, to: toPos },
      axisAlignSheetTransform: { from, to: toPos },
      anchorType: '1',
    };
    order.push(drawingId);
    stats.textBoxes++;
  });

  const workbook = {
    id: unitId,
    name: sheet.name,
    appVersion: '',
    locale: 'enUS',
    sheetOrder: [sheetId],
    styles,
    sheets: {
      [sheetId]: {
        id: sheetId,
        name: sheet.name.slice(0, 31),
        rowCount,
        columnCount,
        defaultColumnWidth: sheet.defaultColumnWidthPx,
        defaultRowHeight: sheet.defaultRowHeightPx,
        cellData,
        mergeData,
        rowData,
        columnData,
      },
    },
    ...(order.length ? { resources: [{ name: 'SHEET_DRAWING_PLUGIN', data: JSON.stringify({ [sheetId]: { data: drawings, order } }) }] } : {}),
  } as unknown as IWorkbookData;
  return { workbook, stats };
}
// ── Rich text and text boxes ────────────────────────────────────────────────

const pt2pxf = (pt: number): number => (pt * 96) / 72;

/** A Univer rich-text document for one cell: the runs over the cell's own font. */
function richDocument(id: string, runs: readonly RichRun[], base: IStyleData | null): Record<string, unknown> {
  const baseTs: Record<string, unknown> = {};
  const b = (base ?? {}) as Record<string, unknown>;
  for (const key of ['ff', 'fs', 'bl', 'it', 'ul', 'cl'] as const) if (b[key] !== undefined) baseTs[key] = b[key];
  const textRuns: { st: number; ed: number; ts: Record<string, unknown> }[] = [];
  let at = 0;
  for (const run of runs) {
    const ts: Record<string, unknown> = { ...baseTs };
    if (run.bold) ts.bl = 1;
    if (run.italic) ts.it = 1;
    if (run.underline) ts.ul = { s: 1 };
    if (run.size !== undefined) ts.fs = run.size;
    if (run.font) ts.ff = run.font;
    if (run.color) ts.cl = { rgb: run.color };
    if (run.vertAlign === 'superscript') ts.va = 3;
    else if (run.vertAlign === 'subscript') ts.va = 2;
    const len = run.text.length;
    if (len > 0) textRuns.push({ st: at, ed: at + len, ts });
    at += len;
  }
  const stream = runs.map((r) => r.text).join('');
  return {
    id,
    documentStyle: {},
    body: {
      dataStream: `${stream}\r\n`,
      textRuns,
      paragraphs: [{ startIndex: stream.length }],
    },
  };
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
/** UTF-8 safe base64 in both the renderer and Node. */
export function toBase64Utf8(s: string): string {
  const g = globalThis as { Buffer?: { from(s: string, enc: string): { toString(enc: string): string } } };
  if (g.Buffer) return g.Buffer.from(s, 'utf8').toString('base64');
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
/**
 * A text box as SVG: one <text> per line, runs as <tspan> with weight,
 * style, size, font and a baseline shift for super- and subscripts. Long
 * paragraphs wrap on an estimated glyph width; Excel's own layout is not
 * available, so the box is set generously.
 */
export function textBoxSvg(tb: XlsxTextBox, width: number, height: number): string {
  const defaultSize = 11;
  const lines: { runs: RichRun[]; align: 'l' | 'ctr' | 'r'; size: number }[] = [];
  const innerWidth = Math.max(8, width - tb.insetPx.left * 2);
  for (const p of tb.paragraphs) {
    const size = Math.max(...p.runs.map((r) => r.size ?? defaultSize), defaultSize);
    const words: RichRun[] = [];
    for (const r of p.runs) {
      const parts = r.text.split(/(\s+|\n)/);
      for (const part of parts) if (part) words.push({ ...r, text: part });
    }
    let current: RichRun[] = [];
    let used = 0;
    const flush = () => { lines.push({ runs: current, align: p.align, size }); current = []; used = 0; };
    for (const w of words) {
      if (w.text === '\n') { flush(); continue; }
      const px = w.text.length * pt2pxf(w.size ?? size) * 0.52;
      if (used + px > innerWidth && current.length > 0 && !/^\s+$/.test(w.text)) flush();
      current.push(w);
      used += px;
    }
    if (current.length) flush();
  }
  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`);
  if (tb.fill) parts.push(`<rect x="0" y="0" width="${width}" height="${height}" fill="${escapeXml(tb.fill)}"/>`);
  let y = tb.insetPx.top;
  for (const line of lines) {
    const lineHeight = pt2pxf(line.size) * 1.25;
    y += pt2pxf(line.size);
    const x = line.align === 'ctr' ? width / 2 : line.align === 'r' ? width - tb.insetPx.left : tb.insetPx.left;
    const anchor = line.align === 'ctr' ? 'middle' : line.align === 'r' ? 'end' : 'start';
    // Words that share a format become one span; the wrap split them apart.
    const merged: RichRun[] = [];
    for (const r of line.runs) {
      const last = merged[merged.length - 1];
      const same = last && last.bold === r.bold && last.italic === r.italic && last.underline === r.underline && last.size === r.size && last.font === r.font && last.color === r.color && last.vertAlign === r.vertAlign;
      if (same) merged[merged.length - 1] = { ...last, text: last.text + r.text };
      else merged.push({ ...r });
    }
    const spans = merged.map((r) => {
      const attrs: string[] = [];
      if (r.font) attrs.push(`font-family="${escapeXml(r.font)}, Calibri, sans-serif"`);
      const size = pt2pxf(r.size ?? line.size);
      if (r.vertAlign) attrs.push(`font-size="${(size * 0.7).toFixed(1)}" baseline-shift="${r.vertAlign === 'superscript' ? 'super' : 'sub'}"`);
      else if (r.size !== undefined) attrs.push(`font-size="${size.toFixed(1)}"`);
      if (r.bold) attrs.push('font-weight="bold"');
      if (r.italic) attrs.push('font-style="italic"');
      if (r.underline) attrs.push('text-decoration="underline"');
      if (r.color) attrs.push(`fill="${escapeXml(r.color)}"`);
      return `<tspan xml:space="preserve"${attrs.length ? ' ' + attrs.join(' ') : ''}>${escapeXml(r.text)}</tspan>`;
    }).join('');
    parts.push(`<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${anchor}" font-family="Calibri, 'Aptos Narrow', sans-serif" font-size="${pt2pxf(line.size).toFixed(1)}" fill="#000000">${spans}</text>`);
    y += lineHeight - pt2pxf(line.size);
  }
  parts.push('</svg>');
  return parts.join('');
}

function anchorAt(x: number, y: number, widthOf: (c: number) => number, heightOf: (r: number) => number): XlsxAnchor {
  let col = 0; let acc = 0;
  while (col < 16383 && acc + widthOf(col) <= x) { acc += widthOf(col); col++; }
  const colOffsetPx = x - acc;
  let row = 0; let accY = 0;
  while (row < 1048575 && accY + heightOf(row) <= y) { accY += heightOf(row); row++; }
  return { row, col, rowOffsetPx: y - accY, colOffsetPx };
}

/** Text of a cell in a parsed sheet ('' when absent). For markers like A1 titles and E1 ratings. */
export function cellText(sheet: XlsxSheet, row: number, col: number): string {
  const c = sheet.cells.find((x) => x.row === row && x.col === col);
  return c && c.value !== undefined ? String(c.value) : '';
}
/** First cell (row, col) whose text satisfies the test, scanning row-major. */
export function findCell(sheet: XlsxSheet, test: (text: string, row: number, col: number) => boolean): { row: number; col: number } | null {
  const sorted = [...sheet.cells].sort((a, b) => a.row - b.row || a.col - b.col);
  for (const c of sorted) {
    if (typeof c.value === 'string' && test(c.value, c.row, c.col)) return { row: c.row, col: c.col };
  }
  return null;
}
