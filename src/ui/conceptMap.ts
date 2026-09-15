// conceptMap.ts — the concept-map core: indented outline in, diagram out.
//
// Grown out of chat's M102 inline mind map (chatMindMap.ts, which now
// re-exports this) because the pattern EARNED promotion: the model writes
// outlines in its native medium, a deterministic renderer does all the
// geometry, and a mangled block degrades to the readable outline instead
// of an empty box. Canvas's conceptMap block consumes the same core, so
// chat and canvas can never drift apart.
//
// Labels are RICH: word-wrapped over multiple lines, inline markdown
// (**bold**, *italic*, `code`), and $LaTeX$ spans through an injected
// renderer (chat and canvas both pass KaTeX). Boxes size to their
// content: per-node width AND height, estimated generously — a slightly
// roomy box is invisible, a clipped word is not.
//
// Everything here is pure — no DOM, no measurement, no theme values.
// Colour comes from CSS classes (branch classes cycle the viz tokens).

import './conceptMap.css';

export interface MindMapNode {
  readonly label: string;
  /** Index of the source line this node came from: its IDENTITY.
   *  Label text is display, never identity (two boxes can share one). */
  readonly line: number;
  readonly children: MindMapNode[];
}

const MAX_NODES = 40;
const MAX_DEPTH = 5;
const MAX_LABEL_CHARS = 220;

/** Leading-whitespace width, counting a tab as two columns. */
function indentWidth(line: string): number {
  let width = 0;
  for (const ch of line) {
    if (ch === ' ') width += 1;
    else if (ch === '\t') width += 2;
    else break;
  }
  return width;
}

/**
 * Truncate a label WITHOUT ever cutting through a $…$ span — a formula
 * sliced in half degrades to raw TeX soup (found on camera, 2026-08-31).
 */
function safeTruncate(label: string, max: number): string {
  if (label.length <= max) return label;
  let cut = max;
  // If the cut lands inside an open math span, retreat to before its $.
  const before = label.slice(0, cut);
  const dollars = (before.match(/\$/g) ?? []).length;
  if (dollars % 2 === 1) cut = before.lastIndexOf('$');
  return `${label.slice(0, cut).trimEnd()}…`;
}

/** An outline line's leading indent + list marker (kept across edits). */
const LINE_PREFIX_RE = /^([ \t]*)((?:[-*•]\s+|\d+[.)]\s+)?)/;

/**
 * Outline line text → the label a box will show. THE one normalisation:
 * markers stripped, whitespace collapsed, safely truncated. Anything
 * keyed by label (layout overrides) must key this, never raw text.
 */
export function normalizeLabel(raw: string): string {
  return safeTruncate(
    String(raw ?? '').replace(LINE_PREFIX_RE, '').replace(/\s+/g, ' ').trim(),
    MAX_LABEL_CHARS,
  );
}

/**
 * Parse the indented-list source into a forest. Pure. Depth comes from a
 * stack comparison, so 2-space, 4-space, tab, and mixed indentation all
 * produce the same tree.
 */
export function parseMindMap(src: string): MindMapNode[] {
  const roots: MindMapNode[] = [];
  const stack: { indent: number; node: MindMapNode }[] = [];
  let count = 0;
  let lineNo = -1;

  for (const rawLine of String(src || '').split('\n')) {
    lineNo++;
    if (!rawLine.trim()) continue;
    if (count >= MAX_NODES) break;

    const indent = indentWidth(rawLine);
    const label = normalizeLabel(rawLine);
    if (!label) continue;

    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) stack.pop();
    while (stack.length > MAX_DEPTH - 1) stack.pop();

    const node: MindMapNode = { label, line: lineNo, children: [] };
    if (stack.length === 0) roots.push(node);
    else stack[stack.length - 1].node.children.push(node);
    stack.push({ indent, node });
    count++;
  }

  return roots;
}

/**
 * Layout direction. 'radial' grows out of a single root on both sides
 * (the default for a fresh map); 'right' is the left-to-right tree,
 * 'down' the top-down tree. A radial request over several roots, or a
 * root with fewer than two children, draws as the tree instead.
 */
export type MindMapDirection = 'right' | 'down' | 'radial';

/** The fence info string after the language: bare → radial,
 *  \`mindmap tree\` → right, \`mindmap vertical\` → down. */
export function parseMindMapInfo(info: string): { dir: MindMapDirection } {
  const words = String(info || '').toLowerCase().split(/\s+/);
  if (words.includes('vertical') || words.includes('down') || words.includes('v')) return { dir: 'down' };
  if (words.includes('tree') || words.includes('right') || words.includes('horizontal')) return { dir: 'right' };
  return { dir: 'radial' };
}

/** Any stored/received direction value → a valid one ('right' for the unknown). */
export function coerceMindMapDirection(value: unknown): MindMapDirection {
  return value === 'down' || value === 'radial' ? value : 'right';
}

// ── Rich labels: math + inline markdown, tokenised then wrapped ─────────────

export interface LabelSegment {
  readonly kind: 'text' | 'bold' | 'italic' | 'code' | 'math';
  readonly value: string;
}

/** Split a label on $…$ spans. No nesting, unmatched $ stays literal text. */
export function splitLabel(label: string): LabelSegment[] {
  const out: LabelSegment[] = [];
  const re = /\$([^$]+)\$/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(label)) !== null) {
    if (m.index > last) out.push({ kind: 'text', value: label.slice(last, m.index) });
    out.push({ kind: 'math', value: m[1] });
    last = m.index + m[0].length;
  }
  if (last < label.length) out.push({ kind: 'text', value: label.slice(last) });
  return out.length > 0 ? out : [{ kind: 'text', value: label }];
}

/** Inline markdown inside the non-math stretches: **bold**, *italic*, `code`. */
function splitInline(text: string): LabelSegment[] {
  const out: LabelSegment[] = [];
  // An underscore run is emphasis only at word boundaries: C_ik, f_k and
  // E[C_i,k+1] are subscripts, never italics (CommonMark's intraword rule).
  const re = /(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|((?<!\w)_([^_]+)_(?!\w))|(`([^`]+)`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push({ kind: 'text', value: text.slice(last, m.index) });
    if (m[2] !== undefined) out.push({ kind: 'bold', value: m[2] });
    else if (m[4] !== undefined) out.push({ kind: 'italic', value: m[4] });
    else if (m[6] !== undefined) out.push({ kind: 'italic', value: m[6] });
    else if (m[8] !== undefined) out.push({ kind: 'code', value: m[8] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ kind: 'text', value: text.slice(last) });
  return out;
}

/** Full tokenisation: math first (its content is opaque), then markdown. */
export function tokenizeLabel(label: string): LabelSegment[] {
  const out: LabelSegment[] = [];
  for (const seg of splitLabel(label)) {
    if (seg.kind === 'math') out.push(seg);
    else out.push(...splitInline(seg.value));
  }
  return out;
}

function labelIsRich(segs: readonly LabelSegment[]): boolean {
  return segs.some((s) => s.kind !== 'text');
}

// ── Geometry: three kinds of card, one per level ───────────────────────────
//
// Level 0 is the index card, level 1 the sticky note, level 2 and deeper
// the slip. Each has its own type size, padding and shape. The stylesheet
// (conceptMap.css) mirrors the type sizes for the HTML label path; the two
// tables must move together.

export interface CardMetrics {
  readonly fontSize: number;
  readonly fontWeight: number;
  readonly lineH: number;
  readonly mathLineH: number;
  readonly padX: number;
  readonly padY: number;
  readonly maxTextW: number;
  readonly minHeight: number;
  readonly radius: number;
}

const CARD_METRICS: readonly CardMetrics[] = [
  { fontSize: 16, fontWeight: 700, lineH: 21, mathLineH: 27, padX: 22, padY: 15, maxTextW: 240, minHeight: 0, radius: 3 },
  { fontSize: 13, fontWeight: 500, lineH: 18, mathLineH: 23, padX: 14, padY: 10, maxTextW: 200, minHeight: 54, radius: 2 },
  { fontSize: 12.5, fontWeight: 400, lineH: 17, mathLineH: 22, padX: 11, padY: 7, maxTextW: 190, minHeight: 0, radius: 2 },
];

/** The card metrics for a depth: 0 = index card, 1 = note, 2+ = slip. */
export function cardMetrics(depth: number): CardMetrics {
  return CARD_METRICS[Math.min(Math.max(0, depth), CARD_METRICS.length - 1)];
}

/** The colour index a depth wears (five paper tokens; deeper repeats the last). */
export function colourIndex(depth: number): number {
  return Math.min(Math.max(0, depth), 4);
}

export type CardKind = 'card' | 'note' | 'slip';
export function cardKind(depth: number): CardKind {
  return depth === 0 ? 'card' : depth === 1 ? 'note' : 'slip';
}

/**
 * THE GRID. Every card edge sits on an 18px lattice: sizes round up to
 * it, the layout places tops and lefts on it, the block snaps moves to
 * it, and the board's dots are drawn INSIDE the map on the same lattice
 * (so they scale and scroll with it and can never drift). Gaps are
 * multiples of it so columns and rows stay on it too.
 */
export const MAP_GRID = 18;
/** Card sizes are multiples of TWO cells: a connector leaves a card from
 *  its centre, and only an even size puts that centre on a dot too. */
export const MAP_CELL2 = MAP_GRID * 2;
const snapGrid = (v: number): number => Math.round(v / MAP_GRID) * MAP_GRID;
const ceilSize = (v: number): number => Math.ceil(v / MAP_CELL2) * MAP_CELL2;
const snapSize = (v: number): number => Math.max(MAP_CELL2, Math.round(v / MAP_CELL2) * MAP_CELL2);

const NOTE_FOLD = 13;      // the sticky note's folded corner
const NOTE_STRIP = 7;      // its adhesive strip along the top
const LEAF_GAP = MAP_CELL2;         // between stacked cards (right): even, so a parent centred on its children stays on the grid
const COL_GAP = MAP_GRID * 4;       // parent card to its children (right)
const LEVEL_GAP = MAP_GRID * 4;     // between depth rows (down): even, so the spine at its midpoint is on the grid
const SIB_GAP = MAP_CELL2;          // between sibling cards (down): even, same reason
const ROOT_GAP = MAP_GRID * 4;      // radial: the index card to the first notes
const MARGIN = MAP_GRID;
// Tilt is OFF: a tilted card cannot sit on the grid, and Mufaro chose
// alignment (2026-09-14). One constant each to bring the hand-placed
// look back.
const NOTE_TILT = 0;       // degrees, notes
const SLIP_TILT = 0;       // degrees, slips

// ── Text measurement: real glyph advances when a canvas exists ─────────────
//
// The app measures with the UI font it actually draws; headless (jsdom,
// tests) falls back to a per-size estimate. Widths are cached: the same
// labels are measured on every repaint.

const UI_FONT_FALLBACK = "'Inter', 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif";
const MONO_FONT = "'Cascadia Code', 'Fira Code', Consolas, ui-monospace, monospace";
let _measureCtx: CanvasRenderingContext2D | null | undefined;
let _uiFont: string | null = null;
const _widthCache = new Map<string, number>();

function measureContext(): CanvasRenderingContext2D | null {
  if (_measureCtx !== undefined) return _measureCtx;
  _measureCtx = null;
  try {
    if (typeof document !== 'undefined'
      && !(typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent))) {
      _measureCtx = document.createElement('canvas').getContext('2d');
    }
  } catch { _measureCtx = null; }
  return _measureCtx;
}

function uiFont(): string {
  if (_uiFont) return _uiFont;
  try {
    const fam = typeof getComputedStyle === 'function' && document.body
      ? getComputedStyle(document.body).fontFamily : '';
    _uiFont = fam || UI_FONT_FALLBACK;
  } catch { _uiFont = UI_FONT_FALLBACK; }
  return _uiFont;
}

/** Width of a run of text at a size and weight, in CSS px. */
export function textWidth(text: string, fontSize: number, fontWeight: number, mono = false): number {
  const key = (mono ? 'm' : 'u') + fontWeight + '|' + fontSize + '|' + text;
  const hit = _widthCache.get(key);
  if (hit !== undefined) return hit;
  const ctx = measureContext();
  let w: number;
  if (ctx) {
    ctx.font = fontWeight + ' ' + fontSize + 'px ' + (mono ? MONO_FONT : uiFont());
    w = ctx.measureText(text).width;
  } else {
    w = text.length * fontSize * (mono ? 0.6 : 0.56) * (fontWeight >= 600 ? 1.06 : 1);
  }
  if (_widthCache.size > 4000) _widthCache.clear();
  _widthCache.set(key, w);
  return w;
}

function segWidth(seg: LabelSegment, m: CardMetrics): number {
  switch (seg.kind) {
    case 'bold': return textWidth(seg.value, m.fontSize, 700);
    case 'code': return textWidth(seg.value, m.fontSize - 1, 400, true) + 6;
    case 'math': return Math.max(3, seg.value.replace(/\\[a-zA-Z]+/g, 'xx').length) * m.fontSize * 0.53 + 6;
    default: return textWidth(seg.value, m.fontSize, m.fontWeight);
  }
}

export interface MeasuredLabel {
  readonly lines: LabelSegment[][];
  readonly width: number;
  readonly height: number;
  readonly rich: boolean;
}

/**
 * Greedy word-wrap over the token stream for a card at DEPTH. Math spans
 * never break; text splits on spaces. Width is the widest resulting line
 * (capped near the level's wrap width plus padding); height is the line
 * count at each line's pitch, never under the level's minimum (a sticky
 * note is a note, not a strip).
 */
export function measureLabel(label: string, maxTextW?: number, depth = 1): MeasuredLabel {
  const m = cardMetrics(depth);
  const wrapW = maxTextW ?? m.maxTextW;
  const segs = tokenizeLabel(label);

  // Explode text-ish segments into word atoms; opaque kinds stay whole.
  const atoms: LabelSegment[] = [];
  for (const seg of segs) {
    if (seg.kind === 'math' || seg.kind === 'code') { atoms.push(seg); continue; }
    const words = seg.value.split(/(\s+)/).filter((w) => w.length > 0);
    for (const w of words) atoms.push({ kind: seg.kind, value: w });
  }

  const lines: LabelSegment[][] = [];
  let line: LabelSegment[] = [];
  let lineW = 0;
  const flush = (): void => {
    // Trim trailing/leading whitespace atoms so centring is honest.
    while (line.length && !line[0].value.trim()) line.shift();
    while (line.length && !line[line.length - 1].value.trim()) line.pop();
    if (line.length) lines.push(line);
    line = [];
    lineW = 0;
  };
  for (const atom of atoms) {
    const w = segWidth(atom, m);
    if (lineW > 0 && lineW + w > wrapW && atom.value.trim()) flush();
    line.push(atom);
    lineW += w;
  }
  flush();
  if (lines.length === 0) lines.push([{ kind: 'text', value: ' ' }]);

  const lineWidths = lines.map((l) => l.reduce((acc, seg) => acc + segWidth(seg, m), 0));
  // Sizes round UP to two cells so every edge AND every centre sits on a dot.
  const width = ceilSize(Math.round(Math.min(Math.max(...lineWidths, 24), wrapW + 12)) + m.padX * 2);
  const natural = lines.reduce(
    (acc, l) => acc + (l.some((seg) => seg.kind === 'math') ? m.mathLineH : m.lineH),
    0,
  ) + m.padY * 2;
  const height = ceilSize(Math.max(natural, m.minHeight));
  return { lines, width, height, rich: labelIsRich(segs) || lines.length > 1 };
}

// ── Layout ──────────────────────────────────────────────────────────────────

export interface LaidOutNode {
  readonly label: string;
  /** The source line this box came from: its identity for editing. */
  readonly line: number;
  readonly depth: number;
  readonly x: number;
  readonly y: number;          // centre-line y
  readonly width: number;
  readonly height: number;
  /** The colour index the card wears: its LEVEL (0 index card, 1 note,
   *  2+ slip). Lines take their card's colour; arrowheads the child's. */
  readonly branch: number;
}

export interface MindMapLayout {
  readonly nodes: readonly LaidOutNode[];
  readonly edges: readonly { readonly from: number; readonly to: number }[];
  readonly width: number;
  readonly height: number;
  readonly dir: MindMapDirection;
}

/**
 * User layout adjustments, keyed by LABEL text: position deltas from the
 * computed layout and an optional explicit width (text re-wraps to it).
 * Label keying is deliberate: rename a node in the outline and its
 * override quietly evaporates back to auto layout. Self-healing, never
 * a second source of structural truth.
 */
export type MindMapOverrides = Readonly<Record<string, {
  readonly dx?: number;
  readonly dy?: number;
  readonly w?: number;
}>>;

const MIN_OVERRIDE_W = 80;
const MAX_OVERRIDE_W = 420;

/** Apply overrides to a computed layout, then re-normalise the bounds. */
export function applyOverrides(layout: MindMapLayout, overrides: MindMapOverrides): MindMapLayout {
  const keys = Object.keys(overrides ?? {});
  if (keys.length === 0) return layout;

  const nodes = layout.nodes.map((n) => {
    const o = overrides[n.label];
    if (!o) return n;
    let { width, height } = n;
    if (typeof o.w === 'number' && Number.isFinite(o.w)) {
      const w = snapSize(Math.max(MIN_OVERRIDE_W, Math.min(MAX_OVERRIDE_W, Math.round(o.w))));
      const remeasured = measureLabel(n.label, Math.max(24, w - cardMetrics(n.depth).padX * 2), n.depth);
      width = w;
      height = remeasured.height;
    }
    return {
      ...n,
      x: n.x + (Number.isFinite(o.dx) ? o.dx! : 0),
      y: n.y + (Number.isFinite(o.dy) ? o.dy! : 0),
      width,
      height,
    };
  });

  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y - n.height / 2);
    maxX = Math.max(maxX, n.x + n.width);
    maxY = Math.max(maxY, n.y + n.height / 2);
  }
  const shiftX = MARGIN - minX;
  const shiftY = MARGIN - minY;
  return {
    ...layout,
    nodes: nodes.map((n) => ({ ...n, x: n.x + shiftX, y: n.y + shiftY })),
    width: maxX - minX + 2 * MARGIN,
    height: maxY - minY + 2 * MARGIN,
  };
}

/** Back-compat single-line width estimate (tests, external callers). */
export function boxWidth(label: string): number {
  return measureLabel(label).width;
}

interface PlacedTree {
  readonly nodes: LaidOutNode[];
  readonly edges: { from: number; to: number }[];
  /** Indices of the forest's roots, in order. */
  readonly tops: number[];
  readonly width: number;
  readonly height: number;
}

/**
 * The classic tidy tree read left-to-right, from (0, 0): depth picks the
 * column, leaves stack down, a parent centres on its children. DEPTH0 is
 * the depth the forest's roots sit at (1 for a radial side).
 */
function placeTree(
  forest: readonly MindMapNode[],
  sizes: ReadonlyMap<MindMapNode, MeasuredLabel>,
  depth0: number,
): PlacedTree {
  const nodes: LaidOutNode[] = [];
  const edges: { from: number; to: number }[] = [];
  const tops: number[] = [];
  const widestByDepth: number[] = [];
  const measure = (node: MindMapNode, depth: number): void => {
    widestByDepth[depth] = Math.max(widestByDepth[depth] ?? 0, sizes.get(node)!.width);
    for (const child of node.children) measure(child, depth + 1);
  };
  for (const root of forest) measure(root, depth0);

  const colX: number[] = [];
  let runningX = 0;
  for (let d = depth0; d < widestByDepth.length; d++) {
    colX[d] = runningX;
    runningX += (widestByDepth[d] ?? 0) + COL_GAP;
  }

  let nextLeafTop = 0;
  const place = (node: MindMapNode, depth: number): number => {
    const size = sizes.get(node)!;
    const index = nodes.length;
    nodes.push({ label: node.label, line: node.line, depth, x: colX[depth], y: 0, width: size.width, height: size.height, branch: colourIndex(depth) });

    let y: number;
    if (node.children.length === 0) {
      y = nextLeafTop + size.height / 2;
      nextLeafTop += size.height + LEAF_GAP;
    } else {
      const childYs = node.children.map((child) => {
        const childIndex = place(child, depth + 1);
        edges.push({ from: index, to: childIndex });
        return nodes[childIndex].y;
      });
      // Centred on its children, then its TOP snapped to the grid.
      y = snapGrid((childYs[0] + childYs[childYs.length - 1]) / 2 - size.height / 2) + size.height / 2;
      // A tall parent must still claim vertical room past its children.
      nextLeafTop = Math.max(nextLeafTop, y + size.height / 2 + LEAF_GAP);
    }

    nodes[index] = { ...nodes[index], y };
    return index;
  };
  for (const root of forest) tops.push(place(root, depth0));

  return {
    nodes,
    edges,
    tops,
    width: Math.max(0, runningX - COL_GAP),
    height: Math.max(0, nextLeafTop - LEAF_GAP),
  };
}

function shifted(nodes: readonly LaidOutNode[], dx: number, dy: number): LaidOutNode[] {
  return nodes.map((n) => ({ ...n, x: n.x + dx, y: n.y + dy }));
}

/**
 * Radial: the index card in the middle, its branches split left and right
 * so the two sides carry about the same number of leaves (the first
 * branches go right, reading order), each side its own tidy tree.
 */
function layoutRadial(root: MindMapNode, sizes: ReadonlyMap<MindMapNode, MeasuredLabel>): MindMapLayout {
  const leaves = (n: MindMapNode): number =>
    n.children.length === 0 ? 1 : n.children.reduce((acc, c) => acc + leaves(c), 0);
  const total = root.children.reduce((acc, k) => acc + leaves(k), 0);
  const rightKids: MindMapNode[] = [];
  const leftKids: MindMapNode[] = [];
  let acc = 0;
  for (const kid of root.children) {
    if (acc < total / 2 || rightKids.length === 0) { rightKids.push(kid); acc += leaves(kid); }
    else leftKids.push(kid);
  }

  const rootSize = sizes.get(root)!;
  const right = placeTree(rightKids, sizes, 1);
  const left = placeTree(leftKids, sizes, 1);
  const sideH = Math.max(right.height, left.height, rootSize.height);
  const rootY = snapGrid((sideH - rootSize.height) / 2) + rootSize.height / 2;
  const rootX = left.nodes.length ? left.width + ROOT_GAP : 0;
  const rightShift = snapGrid((sideH - right.height) / 2);
  const leftShift = snapGrid((sideH - left.height) / 2);

  const nodes: LaidOutNode[] = [{
    label: root.label, line: root.line, depth: 0,
    x: rootX, y: rootY, width: rootSize.width, height: rootSize.height, branch: 0,
  }];
  const edges: { from: number; to: number }[] = [];
  const addSide = (side: PlacedTree, placed: LaidOutNode[]): void => {
    const offset = nodes.length;
    nodes.push(...placed);
    for (const e of side.edges) edges.push({ from: e.from + offset, to: e.to + offset });
    for (const t of side.tops) edges.push({ from: 0, to: t + offset });
  };
  addSide(right, shifted(right.nodes, rootX + rootSize.width + ROOT_GAP, rightShift));
  // The left side is the same tree mirrored: x' = width - (x + w).
  addSide(left, left.nodes.map((n) => ({ ...n, x: left.width - (n.x + n.width), y: n.y + leftShift })));

  const width = rootX + rootSize.width + (right.nodes.length ? ROOT_GAP + right.width : 0);
  const height = Math.max(sideH, rootY + rootSize.height / 2);
  return {
    nodes: shifted(nodes, MARGIN, MARGIN),
    edges,
    width: width + MARGIN * 2,
    height: height + MARGIN * 2,
    dir: 'radial',
  };
}

/**
 * Lay the forest out. 'right' is the classic tidy tree read left-to-right
 * (depth picks the column, leaves stack down); 'down' is the same tree
 * read top-to-bottom (depth picks the row, leaves spread across);
 * 'radial' puts a single root in the middle with branches on both sides
 * (and draws as 'right' when the outline has no single branching root).
 * Pure.
 */
export function layoutMindMap(
  roots: readonly MindMapNode[],
  dir: MindMapDirection = 'right',
): MindMapLayout {
  const sizes = new Map<MindMapNode, MeasuredLabel>();
  const walkMeasure = (n: MindMapNode, depth: number): void => {
    sizes.set(n, measureLabel(n.label, undefined, depth));
    n.children.forEach((c) => walkMeasure(c, depth + 1));
  };
  roots.forEach((r) => walkMeasure(r, 0));

  if (dir === 'radial' && roots.length === 1 && roots[0].children.length >= 2) {
    return layoutRadial(roots[0], sizes);
  }

  if (dir !== 'down') {
    const tree = placeTree(roots, sizes, 0);
    return {
      nodes: shifted(tree.nodes, MARGIN, MARGIN),
      edges: tree.edges,
      width: Math.max(tree.width, 0) + MARGIN * 2,
      height: Math.max(tree.height, cardMetrics(0).lineH) + MARGIN * 2,
      dir,
    };
  }

  // dir === 'down' — rows by depth (sized to the tallest card in the row),
  // leaves spread across.
  const nodes: LaidOutNode[] = [];
  const edges: { from: number; to: number }[] = [];
  const tallestByDepth: number[] = [];
  const findRows = (n: MindMapNode, d: number): void => {
    tallestByDepth[d] = Math.max(tallestByDepth[d] ?? 0, sizes.get(n)!.height);
    for (const c of n.children) findRows(c, d + 1);
  };
  for (const root of roots) findRows(root, 0);

  const rowCenterY: number[] = [];
  let runningY = MARGIN;
  for (let d = 0; d < tallestByDepth.length; d++) {
    rowCenterY[d] = runningY + tallestByDepth[d] / 2;
    runningY += tallestByDepth[d] + LEVEL_GAP;
  }

  let nextLeafX = MARGIN;
  const place = (node: MindMapNode, depth: number): number => {
    const size = sizes.get(node)!;
    const index = nodes.length;
    nodes.push({ label: node.label, line: node.line, depth, x: 0, y: rowCenterY[depth], width: size.width, height: size.height, branch: colourIndex(depth) });

    let centerX: number;
    if (node.children.length === 0) {
      centerX = nextLeafX + size.width / 2;
      nextLeafX += size.width + SIB_GAP;
    } else {
      const childCenters = node.children.map((child) => {
        const childIndex = place(child, depth + 1);
        edges.push({ from: index, to: childIndex });
        return nodes[childIndex].x + nodes[childIndex].width / 2;
      });
      centerX = snapGrid((childCenters[0] + childCenters[childCenters.length - 1]) / 2 - size.width / 2) + size.width / 2;
      nextLeafX = Math.max(nextLeafX, centerX + size.width / 2 + SIB_GAP);
    }

    nodes[index] = { ...nodes[index], x: centerX - size.width / 2 };
    return index;
  };
  for (const root of roots) place(root, 0);

  const width = Math.max(...nodes.map((n) => n.x + n.width), MARGIN) + MARGIN;
  return {
    nodes,
    edges,
    width,
    height: runningY - LEVEL_GAP + MARGIN,
    dir,
  };
}

// ── Render ──────────────────────────────────────────────────────────────────

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** The plain-outline fallback — always valid, always readable. */
export function renderMindMapFallback(src: string): string {
  return `<pre class="parallx-mindmap-fallback">${escapeXml(String(src || '').trim())}</pre>`;
}

export interface RenderMindMapOptions {
  readonly dir?: MindMapDirection;
  /** Draw the dotted board behind the map (the canvas block; chat has none). */
  readonly board?: boolean;
  /** TeX → HTML (KaTeX). Absent: math renders as literal $…$ text. */
  readonly renderMath?: (tex: string) => string;
  /** User layout adjustments (the canvas block's moves and resizes). */
  readonly overrides?: MindMapOverrides;
}

/** A box for edge routing: left x, CENTRE y, size. */
export interface EdgeBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The FULL text of one outline line, markers and indent stripped. The
 * box editor seeds from this, never from the drawn label: a label the
 * layout truncated would otherwise commit its own truncation back into
 * the outline and delete the tail.
 */
export function outlineLineText(src: string, line: number): string | null {
  const lines = String(src || '').split('\n');
  if (line < 0 || line >= lines.length) return null;
  return lines[line].replace(LINE_PREFIX_RE, '');
}

/**
 * Rewrite ONE outline line by index, keeping its indent and list
 * marker. Line-addressed, so duplicate labels never cross-edit. Pure;
 * null when the index is out of range or the line is blank.
 */
export function replaceOutlineLine(src: string, line: number, text: string): string | null {
  const lines = String(src || '').split('\n');
  if (line < 0 || line >= lines.length || !lines[line].trim()) return null;
  const prefix = LINE_PREFIX_RE.exec(lines[line])?.[0] ?? '';
  lines[line] = `${prefix}${text}`;
  return lines.join('\n');
}

/**
 * Insert a child under the node at `line`, indented two deeper (it
 * becomes the FIRST child, at line + 1). Pure; null when the index is
 * out of range. The hover "+" and the editor's Tab ride this.
 */
export function appendChildAtLine(src: string, line: number, childLabel: string): string | null {
  const lines = String(src || '').split('\n');
  if (line < 0 || line >= lines.length || !lines[line].trim()) return null;
  const indent = lines[line].length - lines[line].trimStart().length;
  lines.splice(line + 1, 0, `${' '.repeat(indent + 2)}${childLabel}`);
  return lines.join('\n');
}

/** Last line of the subtree rooted at `line` (deeper lines following). */
function subtreeEndLine(lines: readonly string[], line: number): number {
  const indent = indentWidth(lines[line]);
  let end = line;
  for (let i = line + 1; i < lines.length; i++) {
    if (!lines[i].trim()) { end = i; continue; } // blanks ride with the block
    if (indentWidth(lines[i]) <= indent) break;
    end = i;
  }
  return end;
}

/**
 * Insert a SIBLING after the node at `line` (past its whole subtree),
 * at the same indent. Pure; null when the index is out of range. The
 * editor's Enter-chain rides this: for a fresh leaf the new line lands
 * at line + 1.
 */
export function insertSiblingAfter(src: string, line: number, label: string): string | null {
  const lines = String(src || '').split('\n');
  if (line < 0 || line >= lines.length || !lines[line].trim()) return null;
  const indent = lines[line].slice(0, lines[line].length - lines[line].trimStart().length);
  lines.splice(subtreeEndLine(lines, line) + 1, 0, `${indent}${label}`);
  return lines.join('\n');
}

/**
 * Delete the node at `line` WITH its subtree. Pure; null when the
 * index is out of range or the outline would end up empty (the map
 * must always keep at least one box — cancel instead of erasing).
 */
export function deleteOutlineSubtree(src: string, line: number): string | null {
  const lines = String(src || '').split('\n');
  if (line < 0 || line >= lines.length || !lines[line].trim()) return null;
  const end = subtreeEndLine(lines, line);
  const kept = [...lines.slice(0, line), ...lines.slice(end + 1)];
  if (!kept.some((l) => l.trim())) return null;
  return kept.join('\n');
}

/**
 * Drop override entries whose label no longer names any box in the
 * outline. The label keying is self-healing by design (a rename lets
 * the box fall back to auto layout); pruning makes the healing REAL —
 * an orphaned entry would otherwise keep Reset Layout lit forever.
 */
export function pruneOverrides(overrides: MindMapOverrides, src: string): MindMapOverrides {
  const keys = Object.keys(overrides);
  if (keys.length === 0) return overrides;
  const live = new Set<string>();
  const walk = (n: MindMapNode): void => { live.add(n.label); n.children.forEach(walk); };
  for (const root of parseMindMap(src)) walk(root);
  if (keys.every((k) => live.has(k))) return overrides;
  const kept: Record<string, MindMapOverrides[string]> = {};
  for (const k of keys) if (live.has(k)) kept[k] = overrides[k];
  return kept;
}

// ── In-place label editing (live preview) ───────────────────────────────
//
// The box editor shows the label WITH its formatting while it is being
// typed: markdown markers stay visible but dimmed, and a $…$ span
// renders through KaTeX the moment the caret leaves it (click the
// rendered formula to get the TeX back). The trick that keeps this
// simple: every SOURCE character is present in the editor DOM exactly
// once, either as literal text or as an atomic span's data-src, so
// serialisation is a plain walk and caret mapping is identity.

/** One editor token; concatenating `text` over all tokens === source. */
export interface EditorToken {
  readonly kind: 'text' | 'bold' | 'italic' | 'code' | 'math';
  /** The full source slice, markers included. */
  readonly text: string;
  /** The content without markers (=== text for plain text). */
  readonly inner: string;
}

/** Tokenise for editing: the render grammar, but markers are KEPT. */
export function editorTokens(source: string): EditorToken[] {
  const out: EditorToken[] = [];
  const pushInline = (text: string): void => {
    const re = /(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|(_([^_]+)_)|(`([^`]+)`)/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) out.push({ kind: 'text', text: text.slice(last, m.index), inner: text.slice(last, m.index) });
      if (m[2] !== undefined) out.push({ kind: 'bold', text: m[1], inner: m[2] });
      else if (m[4] !== undefined) out.push({ kind: 'italic', text: m[3], inner: m[4] });
      else if (m[6] !== undefined) out.push({ kind: 'italic', text: m[5], inner: m[6] });
      else if (m[8] !== undefined) out.push({ kind: 'code', text: m[7], inner: m[8] });
      last = m.index + m[0].length;
    }
    if (last < text.length) out.push({ kind: 'text', text: text.slice(last), inner: text.slice(last) });
  };
  const re = /\$([^$]+)\$/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    if (m.index > last) pushInline(source.slice(last, m.index));
    out.push({ kind: 'math', text: m[0], inner: m[1] });
    last = m.index + m[0].length;
  }
  if (last < source.length) pushInline(source.slice(last));
  return out;
}

/**
 * What the live preview would look like, structurally: token kinds plus
 * which math spans are showing raw. Equal signatures mean the browser's
 * own edit already renders correctly, so the editor can leave the DOM
 * (and the caret, and undo) alone. This is what keeps typing smooth.
 */
export function editorSignature(source: string, caret: { start: number; end: number } | null): string {
  const parts: string[] = [];
  let offset = 0;
  for (const tok of editorTokens(source)) {
    const start = offset;
    const end = offset + tok.text.length;
    offset = end;
    const raw = tok.kind === 'math' && caret !== null && caret.end > start && caret.start < end;
    parts.push(raw ? 'math-raw' : tok.kind);
  }
  return parts.join('|');
}

export interface EditorCaret {
  readonly start: number;
  readonly end: number;
}

/**
 * The editor's innerHTML for a source string. A math span renders
 * ATOMIC (KaTeX, contenteditable=false, its source riding data-src)
 * unless the caret sits strictly inside it, in which case the raw TeX
 * shows for editing. Marks stay literal with dimmed marker spans, so
 * plain typing never fights the caret.
 */
export function editorHtml(source: string, caret: EditorCaret | null, renderMath?: (tex: string) => string): string {
  let html = '';
  let offset = 0;
  for (const tok of editorTokens(source)) {
    const start = offset;
    const end = offset + tok.text.length;
    offset = end;
    if (tok.kind === 'math') {
      const caretInside = caret !== null && caret.end > start && caret.start < end;
      if (renderMath && !caretInside) {
        html += `<span class="parallx-mindmap__edmath" contenteditable="false" data-src="${escapeXml(tok.text)}">${renderMath(tok.inner)}</span>`;
      } else {
        html += `<span class="parallx-mindmap__edmathsrc"><span class="parallx-mindmap__edsyn">$</span>${escapeXml(tok.inner)}<span class="parallx-mindmap__edsyn">$</span></span>`;
      }
      continue;
    }
    if (tok.kind === 'text') {
      html += escapeXml(tok.text);
      continue;
    }
    const markLen = (tok.text.length - tok.inner.length) / 2;
    const openMark = tok.text.slice(0, markLen);
    const closeMark = tok.text.slice(tok.text.length - markLen);
    const tag = tok.kind === 'bold' ? 'b' : tok.kind === 'italic' ? 'i' : 'code';
    html += `<span class="parallx-mindmap__edsyn">${escapeXml(openMark)}</span>`
      + `<${tag}>${escapeXml(tok.inner)}</${tag}>`
      + `<span class="parallx-mindmap__edsyn">${escapeXml(closeMark)}</span>`;
  }
  return html;
}

/** Editor DOM → source: text nodes as-is, atomic spans via data-src. */
export function serializeEditorDom(root: Node): string {
  let out = '';
  const walk = (n: Node): void => {
    if (n.nodeType === 3) { out += n.nodeValue ?? ''; return; }
    if (n.nodeType !== 1) return;
    const el = n as Element;
    const src = el.getAttribute('data-src');
    if (src !== null) { out += src; return; }
    if (el.tagName === 'BR') { out += '\n'; return; }
    for (const c of Array.from(el.childNodes)) walk(c);
  };
  for (const c of Array.from(root.childNodes)) walk(c);
  return out;
}

/** DOM caret position → source offset (atomic spans count their data-src). */
export function caretSourceOffset(root: Node, target: Node, targetOffset: number): number {
  let count = 0;
  let done = false;
  const walk = (n: Node): void => {
    if (done) return;
    if (n === target) {
      if (n.nodeType === 3) { count += Math.min(targetOffset, (n.nodeValue ?? '').length); done = true; return; }
      const kids = Array.from(n.childNodes);
      for (let i = 0; i < Math.min(targetOffset, kids.length); i++) walk(kids[i]);
      done = true;
      return;
    }
    if (n.nodeType === 3) { count += (n.nodeValue ?? '').length; return; }
    if (n.nodeType !== 1) return;
    const el = n as Element;
    const src = el.getAttribute('data-src');
    if (src !== null) { count += src.length; return; }
    if (el.tagName === 'BR') { count += 1; return; }
    for (const c of Array.from(el.childNodes)) { walk(c); if (done) return; }
  };
  walk(root);
  return count;
}

/**
 * Source offset → DOM caret position. An offset inside an atomic span
 * lands just before or after it (the caret cannot enter rendered math;
 * clicking the formula re-renders it raw first).
 */
export function resolveSourceOffset(root: Node, offset: number): { node: Node; offset: number } {
  let remaining = Math.max(0, offset);
  let last: { node: Node; offset: number } = { node: root, offset: 0 };
  let found: { node: Node; offset: number } | null = null;
  const walk = (n: Node): void => {
    if (found) return;
    if (n.nodeType === 3) {
      const len = (n.nodeValue ?? '').length;
      if (remaining <= len) { found = { node: n, offset: remaining }; return; }
      remaining -= len;
      last = { node: n, offset: len };
      return;
    }
    if (n.nodeType !== 1) return;
    const el = n as Element;
    const src = el.getAttribute('data-src');
    const atomicLen = src !== null ? src.length : el.tagName === 'BR' ? 1 : null;
    if (atomicLen !== null) {
      if (remaining <= atomicLen) {
        const parent = n.parentNode;
        if (parent) {
          const idx = Array.prototype.indexOf.call(parent.childNodes, n);
          found = { node: parent, offset: remaining === 0 ? idx : idx + 1 };
        }
        return;
      }
      remaining -= atomicLen;
      return;
    }
    for (const c of Array.from(el.childNodes)) { walk(c); if (found) return; }
  };
  walk(root);
  return found ?? last;
}

/** A child of a hub: geometry plus its colour (for the arrowhead). */
export interface HubChild extends EdgeBox {
  /** Opaque id echoed into each arm's `to` (the renderer passes the
   *  child's source LINE, the duplicate-proof identity). */
  readonly label: string;
  readonly color: number;
}

export interface HubPaths {
  /** The parent's single exit line, to the vertex. */
  readonly stem: string;
  /** The vertical/horizontal spine along the vertex (multi-child only). */
  readonly spine: string | null;
  /** One arm per child, vertex to box edge (arrowheads live here). */
  readonly arms: readonly { readonly d: string; readonly to: string; readonly color: number }[];
}

/**
 * The hub connector: ONE line leaves the parent, reaches a vertex, a
 * spine runs along it, and one arm enters each child. Straight lines,
 * square corners (Mufaro's call, 2026-09-14: no rounded elbows).
 * Children on each side of the parent get their own hub (post-drag mixed
 * sides). 'radial' routes exactly like 'right'.
 */
export function hubPathsFor(parent: EdgeBox, children: readonly HubChild[], dir: MindMapDirection): HubPaths[] {
  if (children.length === 0) return [];
  const out: HubPaths[] = [];
  if (dir !== 'down') {
    const pc = parent.x + parent.width / 2;
    const sides: [HubChild[], HubChild[]] = [[], []];
    for (const c of children) (c.x + c.width / 2 >= pc ? sides[0] : sides[1]).push(c);
    for (let side = 0; side < 2; side++) {
      const kids = sides[side];
      if (kids.length === 0) continue;
      const forward = side === 0;
      const exitX = forward ? parent.x + parent.width : parent.x;
      const entries = kids.map((c) => (forward ? c.x : c.x + c.width));
      const nearest = forward ? Math.min(...entries) : Math.max(...entries);
      const m = Math.round((exitX + nearest) / 2);
      const ys = kids.map((c) => c.y);
      const minY = Math.min(...ys, parent.y);
      const maxY = Math.max(...ys, parent.y);
      const arms = kids.map((c) => ({
        d: 'M' + m + ' ' + c.y + ' H ' + (forward ? c.x : c.x + c.width),
        to: c.label,
        color: c.color,
      }));
      out.push({
        stem: 'M' + exitX + ' ' + parent.y + ' H ' + m,
        spine: minY !== maxY ? 'M' + m + ' ' + minY + ' V ' + maxY : null,
        arms,
      });
    }
    return out;
  }
  const pcy = parent.y;
  const sides: [HubChild[], HubChild[]] = [[], []];
  for (const c of children) (c.y >= pcy ? sides[0] : sides[1]).push(c);
  for (let side = 0; side < 2; side++) {
    const kids = sides[side];
    if (kids.length === 0) continue;
    const downward = side === 0;
    const exitY = downward ? parent.y + parent.height / 2 : parent.y - parent.height / 2;
    const px = parent.x + parent.width / 2;
    const entries = kids.map((c) => (downward ? c.y - c.height / 2 : c.y + c.height / 2));
    const nearest = downward ? Math.min(...entries) : Math.max(...entries);
    const m = Math.round((exitY + nearest) / 2);
    const xs = kids.map((c) => c.x + c.width / 2);
    const minX = Math.min(...xs, px);
    const maxX = Math.max(...xs, px);
    const arms = kids.map((c) => ({
      d: 'M' + (c.x + c.width / 2) + ' ' + m + ' V ' + (downward ? c.y - c.height / 2 : c.y + c.height / 2),
      to: c.label,
      color: c.color,
    }));
    out.push({
      stem: 'M' + px + ' ' + exitY + ' V ' + m,
      spine: minX !== maxX ? 'M' + minX + ' ' + m + ' H ' + maxX : null,
      arms,
    });
  }
  return out;
}

let _svgUid = 0;


/**
 * Per-map defs: one arrowhead marker per level (the arrow wears the CHILD
 * level's colour, from CSS) and the paper filter: fine grain multiplied
 * into the card's fill, then a soft shadow lifting it off the board. The
 * shadow's colour and opacity live in the stylesheet (flood-color).
 */
function mapDefs(uid: number): string {
  let out = '';
  for (let i = 0; i <= 4; i++) {
    out += '<marker id="mm' + uid + '-arrow-d' + i + '" viewBox="0 0 8 8" refX="7" refY="4" '
      + 'markerWidth="7" markerHeight="7" orient="auto-start-reverse">'
      + '<path class="parallx-mindmap__arrow parallx-mindmap__arrow--d' + i + '" d="M0 0 L8 4 L0 8 Z" /></marker>';
  }
  out += '<filter id="mm' + uid + '-paper" x="-8%" y="-8%" width="116%" height="124%" color-interpolation-filters="sRGB">'
    + '<feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" result="noise" />'
    + '<feColorMatrix in="noise" type="saturate" values="0" result="grey" />'
    + '<feComponentTransfer in="grey" result="grain"><feFuncA type="table" tableValues="0 0.18" /></feComponentTransfer>'
    + '<feComposite in="grain" in2="SourceGraphic" operator="in" result="clip" />'
    + '<feBlend in="SourceGraphic" in2="clip" mode="multiply" result="paper" />'
    + '<feDropShadow class="parallx-mindmap__shadow" in="paper" dx="0" dy="2" stdDeviation="2.4" />'
    + '</filter>';
  // The board's dots, one per lattice point (cell origin at -9 so the dot
  // sits ON the grid line, where card edges land).
  out += '<pattern id="mm' + uid + '-dots" x="-' + (MAP_GRID / 2) + '" y="-' + (MAP_GRID / 2) + '" width="' + MAP_GRID + '" height="' + MAP_GRID + '" patternUnits="userSpaceOnUse">'
    + '<circle class="parallx-mindmap__dot" cx="' + (MAP_GRID / 2) + '" cy="' + (MAP_GRID / 2) + '" r="1" /></pattern>';
  return '<defs>' + out + '</defs>';
}

/**
 * A card's tilt in degrees: notes and slips sit slightly askew, the
 * index card stays square. Hashed from the LABEL so a card keeps its
 * tilt across repaints and outline edits elsewhere.
 */
export function cardTilt(label: string, depth: number): number {
  const amplitude = depth === 0 ? 0 : depth === 1 ? NOTE_TILT : SLIP_TILT;
  if (amplitude === 0) return 0;
  let h = 2166136261;
  for (let i = 0; i < label.length; i++) {
    h ^= label.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const unit = ((h >>> 0) % 2000) / 1000 - 1;
  return Math.round(unit * amplitude * 100) / 100;
}

function segHtml(seg: LabelSegment, renderMath?: (tex: string) => string): string {
  switch (seg.kind) {
    case 'bold': return '<b>' + escapeXml(seg.value) + '</b>';
    case 'italic': return '<i>' + escapeXml(seg.value) + '</i>';
    case 'code': return '<code>' + escapeXml(seg.value) + '</code>';
    case 'math':
      return renderMath
        ? '<span class="parallx-mindmap__math">' + renderMath(seg.value) + '</span>'
        : escapeXml('$' + seg.value + '$');
    default: return escapeXml(seg.value);
  }
}

/**
 * Render the map to an SVG string. Colour and weight come entirely from
 * CSS classes; every card wears its LEVEL's paper. Rich labels (markdown,
 * math, wrapped lines) render as HTML in a foreignObject; short plain
 * labels keep the cheap SVG <text> path.
 *
 * Card anatomy (the block's pointer code depends on it): the box is the
 * FIRST rect, class parallx-mindmap__box; a note adds its strip rect and
 * two corner paths; the label is a text or a foreignObject. Everything
 * positioned carries x/y attributes except the corner paths, which the
 * drag moves with a translate.
 */
export function renderMindMapSvg(src: string, opts: RenderMindMapOptions = {}): string {
  const roots = parseMindMap(src);
  if (roots.length === 0) return renderMindMapFallback(src);

  const dir = opts.dir ?? 'right';
  const base = layoutMindMap(roots, dir);
  const { nodes, edges, width, height } = opts.overrides
    ? applyOverrides(base, opts.overrides)
    : base;

  const uid = ++_svgUid;
  // Hub connectors: group edges by PARENT — one exit line per card, a
  // vertex, a spine, then one arm per child. Lines take the PARENT's
  // level colour; each arm's arrowhead takes the CHILD's.
  const kidsByParent = new Map<number, number[]>();
  for (const { from, to } of edges) {
    const arr = kidsByParent.get(from) ?? [];
    arr.push(to);
    kidsByParent.set(from, arr);
  }
  // Hub paths are addressed by SOURCE LINE (data-mm-hub = the parent's
  // line, data-mm-to = the child's): line is identity, so live-drag
  // rerouting stays exact even when two cards share a label.
  const pathParts: string[] = [];
  for (const [parentIdx, childIdxs] of kidsByParent) {
    const parent = nodes[parentIdx];
    const cls = 'parallx-mindmap__edge parallx-mindmap__edge--d' + parent.branch;
    const kids: HubChild[] = childIdxs.map((i) => ({
      x: nodes[i].x, y: nodes[i].y, width: nodes[i].width, height: nodes[i].height,
      label: String(nodes[i].line), color: nodes[i].branch,
    }));
    for (const hub of hubPathsFor(parent, kids, dir)) {
      pathParts.push('<path class="' + cls + '" data-mm-hub="' + parent.line + '" d="' + hub.stem + '" />');
      if (hub.spine) {
        pathParts.push('<path class="' + cls + '" data-mm-hub="' + parent.line + '" d="' + hub.spine + '" />');
      }
      for (const arm of hub.arms) {
        pathParts.push('<path class="' + cls + '" marker-end="url(#mm' + uid + '-arrow-d' + arm.color + ')" '
          + 'data-mm-hub="' + parent.line + '" data-mm-to="' + arm.to + '" d="' + arm.d + '" />');
      }
    }
  }
  const paths = pathParts.join('');

  const boxes = nodes.map((n) => {
    const m = cardMetrics(n.depth);
    const kind = cardKind(n.depth);
    const ow = opts.overrides?.[n.label]?.w;
    const measured = measureLabel(
      n.label,
      typeof ow === 'number' && Number.isFinite(ow) ? Math.max(24, Math.round(ow) - m.padX * 2) : undefined,
      n.depth,
    );
    const top = n.y - n.height / 2;
    const right = n.x + n.width;
    const bottom = top + n.height;
    const cx = n.x + n.width / 2;
    const attrLabel = escapeXml(n.label);
    const tilt = cardTilt(n.label, n.depth);
    const cls = 'parallx-mindmap__node parallx-mindmap__node--d' + n.branch + ' parallx-mindmap__node--' + kind;
    const tiltAttrs = tilt
      ? ' data-mm-tilt="' + tilt + '" transform="rotate(' + tilt + ' ' + cx + ' ' + n.y + ')"'
      : '';
    let open = '<g class="' + cls + '" data-mindmap-label="' + attrLabel + '" data-mm-line="' + n.line + '"'
      + tiltAttrs + ' role="button" tabindex="0">'
      + '<rect class="parallx-mindmap__box" x="' + n.x + '" y="' + top + '" width="' + n.width + '" height="' + n.height
      + '" rx="' + m.radius + '" filter="url(#mm' + uid + '-paper)" />';
    if (kind === 'note') {
      const f = NOTE_FOLD;
      open += '<rect class="parallx-mindmap__strip" x="' + n.x + '" y="' + top + '" width="' + n.width + '" height="' + NOTE_STRIP + '" />'
        + '<path class="parallx-mindmap__cut" d="M' + (right - f) + ' ' + bottom + ' L' + right + ' ' + (bottom - f) + ' L' + right + ' ' + bottom + ' Z" />'
        + '<path class="parallx-mindmap__fold" d="M' + (right - f) + ' ' + bottom + ' L' + (right - f) + ' ' + (bottom - f) + ' L' + right + ' ' + (bottom - f) + ' Z" />';
    }

    const needsHtml = measured.rich && (opts.renderMath || measured.lines.length > 1
      || measured.lines.some((l) => l.some((seg) => seg.kind !== 'text' && seg.kind !== 'math')));
    if (needsHtml) {
      const linesHtml = measured.lines.map((line) => {
        const mathLine = line.some((seg) => seg.kind === 'math');
        const inner = line.map((seg) => segHtml(seg, opts.renderMath)).join('');
        return '<div class="parallx-mindmap__line' + (mathLine ? ' parallx-mindmap__line--math' : '') + '">' + inner + '</div>';
      }).join('');
      return open + '<foreignObject x="' + (n.x + m.padX) + '" y="' + (top + m.padY) + '" '
        + 'width="' + Math.max(4, n.width - m.padX * 2) + '" height="' + Math.max(4, n.height - m.padY * 2) + '">'
        + '<div class="parallx-mindmap__flabel" xmlns="http://www.w3.org/1999/xhtml">' + linesHtml + '</div>'
        + '</foreignObject></g>';
    }
    const textX = kind === 'card' ? cx : n.x + m.padX;
    const anchor = kind === 'card' ? ' text-anchor="middle"' : '';
    return open + '<text class="parallx-mindmap__text" x="' + textX + '" y="' + n.y + '"' + anchor
      + ' dominant-baseline="central">' + attrLabel + '</text></g>';
  }).join('');

  // The map scales down to fit a narrow column, never below 80%; past
  // that the host scrolls it. Width/height attributes keep the natural
  // size for hosts without the stylesheet.
  const minWidth = Math.round(width * 0.8);
  return '<div class="parallx-mindmap" data-mindmap-dir="' + dir + '">'
    + '<svg viewBox="0 0 ' + width + ' ' + height + '" width="' + width + '" height="' + height + '" '
    + 'style="min-width:' + minWidth + 'px" role="img" aria-label="Concept map">'
    + mapDefs(uid)
    // The board is a pattern reference, not a colour: the dot's colour is
    // the stylesheet's.
    + (opts.board ? '<rect class="parallx-mindmap__board" x="0" y="0" width="' + width + '" height="' + height + '" style="fill:url(#mm' + uid + '-dots)" />' : '')
    + paths + boxes + '</svg>'
    + '</div>';
}
