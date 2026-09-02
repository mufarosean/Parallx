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

/** The fence info string after the language: `mindmap vertical` → down. */
export type MindMapDirection = 'right' | 'down';

export function parseMindMapInfo(info: string): { dir: MindMapDirection } {
  const words = String(info || '').toLowerCase().split(/\s+/);
  const down = words.includes('vertical') || words.includes('down') || words.includes('v');
  return { dir: down ? 'down' : 'right' };
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
  const re = /(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|(_([^_]+)_)|(`([^`]+)`)/g;
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

// ── Geometry constants ──────────────────────────────────────────────────────

const LINE_H = 16;         // text line pitch inside a box
const MATH_LINE_H = 22;    // lines carrying math need fraction headroom
const BOX_PAD_Y = 4;
const PAD_X = 10;
const CHAR_W = 6.7;        // average advance for the 12px UI font
const MAX_TEXT_W = 230;    // wrap target: content width before wrapping
const LEAF_GAP = 8;        // breathing room between stacked boxes (right)
const COL_GAP = 34;        // gap between a parent box and its children (right)
const LEVEL_GAP = 26;      // gap between depth rows (down)
const SIB_GAP = 14;        // gap between sibling boxes (down)
const MARGIN = 8;

function segEstWidth(seg: LabelSegment): number {
  switch (seg.kind) {
    case 'bold': return seg.value.length * CHAR_W * 1.06;
    case 'code': return seg.value.length * CHAR_W * 1.1 + 6;
    case 'math': return Math.max(3, seg.value.replace(/\\[a-zA-Z]+/g, 'xx').length) * CHAR_W * 0.95 + 6;
    default: return seg.value.length * CHAR_W;
  }
}

export interface MeasuredLabel {
  readonly lines: LabelSegment[][];
  readonly width: number;
  readonly height: number;
  readonly rich: boolean;
}

/**
 * Greedy word-wrap over the token stream. Math spans never break; text
 * splits on spaces. Width is the widest resulting line (capped near
 * MAX_TEXT_W plus padding), height is the line count at each line's pitch.
 */
export function measureLabel(label: string, maxTextW: number = MAX_TEXT_W): MeasuredLabel {
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
    const w = segEstWidth(atom);
    if (lineW > 0 && lineW + w > maxTextW && atom.value.trim()) flush();
    line.push(atom);
    lineW += w;
  }
  flush();
  if (lines.length === 0) lines.push([{ kind: 'text', value: ' ' }]);

  const lineWidths = lines.map((l) => l.reduce((acc, s) => acc + segEstWidth(s), 0));
  const width = Math.round(Math.min(Math.max(...lineWidths, 24), maxTextW + 12)) + PAD_X * 2;
  const height = lines.reduce(
    (acc, l) => acc + (l.some((s) => s.kind === 'math') ? MATH_LINE_H : LINE_H),
    0,
  ) + BOX_PAD_Y * 2;
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
  /** The node's own colour index (hues cycle; Mufaro's convention:
   *  every box has its own colour, lines take their box's colour). */
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
      const w = Math.max(MIN_OVERRIDE_W, Math.min(MAX_OVERRIDE_W, Math.round(o.w)));
      const remeasured = measureLabel(n.label, Math.max(24, w - 24));
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

/**
 * Lay the forest out. 'right' is the classic tidy tree read left-to-right
 * (depth picks the column, leaves stack down); 'down' is the same tree
 * read top-to-bottom (depth picks the row, leaves spread across). Pure.
 */
export function layoutMindMap(
  roots: readonly MindMapNode[],
  dir: MindMapDirection = 'right',
): MindMapLayout {
  const nodes: LaidOutNode[] = [];
  const edges: { from: number; to: number }[] = [];
  const sizes = new Map<MindMapNode, MeasuredLabel>();
  const walkMeasure = (n: MindMapNode): void => {
    sizes.set(n, measureLabel(n.label));
    n.children.forEach(walkMeasure);
  };
  roots.forEach(walkMeasure);

  let branchCounter = 0;

  if (dir === 'right') {
    const widestByDepth: number[] = [];
    const measure = (node: MindMapNode, depth: number): void => {
      widestByDepth[depth] = Math.max(widestByDepth[depth] ?? 0, sizes.get(node)!.width);
      for (const child of node.children) measure(child, depth + 1);
    };
    for (const root of roots) measure(root, 0);

    const colX: number[] = [];
    let runningX = MARGIN;
    for (let d = 0; d < widestByDepth.length; d++) {
      colX[d] = runningX;
      runningX += (widestByDepth[d] ?? 0) + COL_GAP;
    }

    let nextLeafTop = MARGIN;
    const place = (node: MindMapNode, depth: number): number => {
      const size = sizes.get(node)!;
      const index = nodes.length;
      nodes.push({ label: node.label, line: node.line, depth, x: colX[depth], y: 0, width: size.width, height: size.height, branch: branchCounter++ % 6 });

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
        y = (childYs[0] + childYs[childYs.length - 1]) / 2;
        // A tall parent must still claim vertical room past its children.
        nextLeafTop = Math.max(nextLeafTop, y + size.height / 2 + LEAF_GAP);
      }

      nodes[index] = { ...nodes[index], y };
      return index;
    };
    for (const root of roots) place(root, 0);

    return {
      nodes,
      edges,
      width: Math.max(runningX - COL_GAP + MARGIN, MARGIN * 2),
      height: Math.max(nextLeafTop - LEAF_GAP + MARGIN, MARGIN * 2 + LINE_H),
      dir,
    };
  }

  // dir === 'down' — rows by depth (sized to the tallest box in the row),
  // leaves spread across.
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
    nodes.push({ label: node.label, line: node.line, depth, x: 0, y: rowCenterY[depth], width: size.width, height: size.height, branch: branchCounter++ % 6 });

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
      centerX = (childCenters[0] + childCenters[childCenters.length - 1]) / 2;
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
 * The hub connector: ONE line leaves the parent, reaches a vertex,
 * a spine runs along it, and one arm enters each child. Children on
 * each side of the parent get their own hub (post-drag mixed sides).
 */
export function hubPathsFor(parent: EdgeBox, children: readonly HubChild[], dir: MindMapDirection): HubPaths[] {
  if (children.length === 0) return [];
  const out: HubPaths[] = [];
  if (dir === 'right') {
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
      out.push({
        stem: `M${exitX} ${parent.y} H ${m}`,
        spine: kids.length > 1 || minY !== maxY ? `M${m} ${minY} V ${maxY}` : null,
        arms: kids.map((c) => ({
          d: `M${m} ${c.y} H ${forward ? c.x : c.x + c.width}`,
          to: c.label,
          color: c.color,
        })),
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
    out.push({
      stem: `M${px} ${exitY} V ${m}`,
      spine: kids.length > 1 || minX !== maxX ? `M${minX} ${m} H ${maxX}` : null,
      arms: kids.map((c) => ({
        d: `M${c.x + c.width / 2} ${m} V ${downward ? c.y - c.height / 2 : c.y + c.height / 2}`,
        to: c.label,
        color: c.color,
      })),
    });
  }
  return out;
}

let _svgUid = 0;

function arrowDefs(uid: number): string {
  const marker = (key: string, cls: string): string =>
    `<marker id="mm${uid}-arrow-${key}" viewBox="0 0 8 8" refX="7" refY="4" `
    + `markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">`
    + `<path class="parallx-mindmap__arrow ${cls}" d="M0 0 L8 4 L0 8 Z" /></marker>`;
  let out = marker('n', '');
  for (let i = 0; i < 6; i++) out += marker(`b${i}`, `parallx-mindmap__arrow--b${i}`);
  return `<defs>${out}</defs>`;
}

function branchClass(branch: number): string {
  return `parallx-mindmap__node--b${branch % 6}`;
}

function segHtml(seg: LabelSegment, renderMath?: (tex: string) => string): string {
  switch (seg.kind) {
    case 'bold': return `<b>${escapeXml(seg.value)}</b>`;
    case 'italic': return `<i>${escapeXml(seg.value)}</i>`;
    case 'code': return `<code>${escapeXml(seg.value)}</code>`;
    case 'math':
      return renderMath
        ? `<span class="parallx-mindmap__math">${renderMath(seg.value)}</span>`
        : escapeXml(`$${seg.value}$`);
    default: return escapeXml(seg.value);
  }
}

/**
 * Render the map to an SVG string. Colour and weight come entirely from
 * CSS classes; branch hues cycle six viz tokens. Rich labels (markdown,
 * math, wrapped lines) render as HTML in a foreignObject; short plain
 * labels keep the cheap SVG <text> path.
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
  // Hub connectors: group edges by PARENT — one exit line per box, a
  // vertex, a spine, then one arm per child. Lines take the PARENT's
  // colour; each arm's arrowhead takes the CHILD's.
  const kidsByParent = new Map<number, number[]>();
  for (const { from, to } of edges) {
    const arr = kidsByParent.get(from) ?? [];
    arr.push(to);
    kidsByParent.set(from, arr);
  }
  const pathParts: string[] = [];
  for (const [parentIdx, childIdxs] of kidsByParent) {
    const parent = nodes[parentIdx];
    const cls = `parallx-mindmap__edge parallx-mindmap__edge--b${parent.branch % 6}`;
    const kids: HubChild[] = childIdxs.map((i) => ({
      x: nodes[i].x, y: nodes[i].y, width: nodes[i].width, height: nodes[i].height,
      label: nodes[i].label, color: nodes[i].branch % 6,
    }));
    for (const hub of hubPathsFor(parent, kids, dir)) {
      pathParts.push(`<path class="${cls}" data-mm-hub="${escapeXml(parent.label)}" d="${hub.stem}" />`);
      if (hub.spine) {
        pathParts.push(`<path class="${cls}" data-mm-hub="${escapeXml(parent.label)}" d="${hub.spine}" />`);
      }
      for (const arm of hub.arms) {
        pathParts.push(`<path class="${cls}" marker-end="url(#mm${uid}-arrow-b${arm.color})" `
          + `data-mm-hub="${escapeXml(parent.label)}" data-mm-to="${escapeXml(arm.to)}" d="${arm.d}" />`);
      }
    }
  }
  const paths = pathParts.join('');

  const boxes = nodes.map((n) => {
    const ow = opts.overrides?.[n.label]?.w;
    const measured = measureLabel(
      n.label,
      typeof ow === 'number' && Number.isFinite(ow) ? Math.max(24, Math.round(ow) - 24) : undefined,
    );
    const top = n.y - n.height / 2;
    const attrLabel = escapeXml(n.label);
    const cls = `parallx-mindmap__node parallx-mindmap__node--d${Math.min(n.depth, 2)} ${branchClass(n.branch)}`;
    const open = `<g class="${cls}" data-mindmap-label="${attrLabel}" data-mm-line="${n.line}" role="button" tabindex="0">`
      + `<rect class="parallx-mindmap__box" x="${n.x}" y="${top}" width="${n.width}" height="${n.height}" rx="5" />`;

    const needsHtml = measured.rich && (opts.renderMath || measured.lines.length > 1
      || measured.lines.some((l) => l.some((s) => s.kind !== 'text' && s.kind !== 'math')));
    if (needsHtml) {
      const linesHtml = measured.lines.map((line) => {
        const mathLine = line.some((s) => s.kind === 'math');
        const inner = line.map((s) => segHtml(s, opts.renderMath)).join('');
        return `<div class="parallx-mindmap__line${mathLine ? ' parallx-mindmap__line--math' : ''}">${inner}</div>`;
      }).join('');
      return `${open}<foreignObject x="${n.x + PAD_X}" y="${top + BOX_PAD_Y}" `
        + `width="${Math.max(4, n.width - PAD_X * 2)}" height="${Math.max(4, n.height - BOX_PAD_Y * 2)}">`
        + `<div class="parallx-mindmap__flabel" xmlns="http://www.w3.org/1999/xhtml">${linesHtml}</div>`
        + `</foreignObject></g>`;
    }
    return `${open}<text class="parallx-mindmap__text" x="${n.x + PAD_X}" y="${n.y}" dominant-baseline="central">${attrLabel}</text></g>`;
  }).join('');

  return `<div class="parallx-mindmap" data-mindmap-dir="${dir}">`
    + `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" `
    + `role="img" aria-label="Concept map">${arrowDefs(uid)}${paths}${boxes}</svg>`
    + `</div>`;
}
