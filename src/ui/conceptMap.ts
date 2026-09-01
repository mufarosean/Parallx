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

/**
 * Parse the indented-list source into a forest. Pure. Depth comes from a
 * stack comparison, so 2-space, 4-space, tab, and mixed indentation all
 * produce the same tree.
 */
export function parseMindMap(src: string): MindMapNode[] {
  const roots: MindMapNode[] = [];
  const stack: { indent: number; node: MindMapNode }[] = [];
  let count = 0;

  for (const rawLine of String(src || '').split('\n')) {
    if (!rawLine.trim()) continue;
    if (count >= MAX_NODES) break;

    const indent = indentWidth(rawLine);
    const label = safeTruncate(
      rawLine
        .trim()
        .replace(/^[-*•]\s+/, '')
        .replace(/^\d+[.)]\s+/, '')
        .trim(),
      MAX_LABEL_CHARS,
    );
    if (!label) continue;

    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) stack.pop();
    while (stack.length > MAX_DEPTH - 1) stack.pop();

    const node: MindMapNode = { label, children: [] };
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
  readonly depth: number;
  readonly x: number;
  readonly y: number;          // centre-line y
  readonly width: number;
  readonly height: number;
  /** Top-level branch index (colour class), -1 for roots. */
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
    const place = (node: MindMapNode, depth: number, branch: number): number => {
      const size = sizes.get(node)!;
      const index = nodes.length;
      nodes.push({ label: node.label, depth, x: colX[depth], y: 0, width: size.width, height: size.height, branch });

      let y: number;
      if (node.children.length === 0) {
        y = nextLeafTop + size.height / 2;
        nextLeafTop += size.height + LEAF_GAP;
      } else {
        const childYs = node.children.map((child) => {
          const childBranch = depth === 0 ? branchCounter++ : branch;
          const childIndex = place(child, depth + 1, childBranch);
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
    for (const root of roots) place(root, 0, -1);

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
  const place = (node: MindMapNode, depth: number, branch: number): number => {
    const size = sizes.get(node)!;
    const index = nodes.length;
    nodes.push({ label: node.label, depth, x: 0, y: rowCenterY[depth], width: size.width, height: size.height, branch });

    let centerX: number;
    if (node.children.length === 0) {
      centerX = nextLeafX + size.width / 2;
      nextLeafX += size.width + SIB_GAP;
    } else {
      const childCenters = node.children.map((child) => {
        const childBranch = depth === 0 ? branchCounter++ : branch;
        const childIndex = place(child, depth + 1, childBranch);
        edges.push({ from: index, to: childIndex });
        return nodes[childIndex].x + nodes[childIndex].width / 2;
      });
      centerX = (childCenters[0] + childCenters[childCenters.length - 1]) / 2;
      nextLeafX = Math.max(nextLeafX, centerX + size.width / 2 + SIB_GAP);
    }

    nodes[index] = { ...nodes[index], x: centerX - size.width / 2 };
    return index;
  };
  for (const root of roots) place(root, 0, -1);

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
 * ORTHOGONAL elbow between two boxes: straight lines, square corners
 * (Mufaro's hand-drawn maps are the spec: the brain follows right
 * angles). Siblings share the same mid-line by construction, so a
 * parent's edges visually merge into ONE trunk that then branches —
 * never ten separate lines crawling into one box. The exit/entry side
 * still follows the boxes' actual relative positions after drags.
 */
export function edgePathFor(a: EdgeBox, b: EdgeBox, dir: MindMapDirection): string {
  if (dir === 'right') {
    const forward = (b.x + b.width / 2) >= (a.x + a.width / 2);
    const x1 = forward ? a.x + a.width : a.x;
    const x2 = forward ? b.x : b.x + b.width;
    const m = Math.round((x1 + x2) / 2);
    if (a.y === b.y) return `M${x1} ${a.y} H ${x2}`;
    return `M${x1} ${a.y} H ${m} V ${b.y} H ${x2}`;
  }
  const downward = b.y >= a.y;
  const y1 = downward ? a.y + a.height / 2 : a.y - a.height / 2;
  const y2 = downward ? b.y - b.height / 2 : b.y + b.height / 2;
  const xa = a.x + a.width / 2;
  const xb = b.x + b.width / 2;
  const m = Math.round((y1 + y2) / 2);
  if (xa === xb) return `M${xa} ${y1} V ${y2}`;
  return `M${xa} ${y1} V ${m} H ${xb} V ${y2}`;
}

/**
 * Insert a child under `parentLabel` in the outline (first matching
 * line), indented two deeper. Pure; returns null when the parent line
 * cannot be found. The hover "+" on the canvas block rides this.
 */
export function appendChildToOutline(src: string, parentLabel: string, childLabel: string): string | null {
  const lines = String(src || '').split('\n');
  const clean = (raw: string): string => raw
    .trim()
    .replace(/^[-*\u2022]\s+/, '')
    .replace(/^\d+[.)]\s+/, '')
    .trim();
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const label = clean(lines[i]);
    if (label === parentLabel || safeTruncate(label, MAX_LABEL_CHARS) === parentLabel) {
      const indent = lines[i].length - lines[i].trimStart().length;
      lines.splice(i + 1, 0, `${' '.repeat(indent + 2)}${childLabel}`);
      return lines.join('\n');
    }
  }
  return null;
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
  return branch < 0 ? 'parallx-mindmap__node--root' : `parallx-mindmap__node--b${branch % 6}`;
}

function edgeBranchClass(branch: number): string {
  return branch < 0 ? '' : ` parallx-mindmap__edge--b${branch % 6}`;
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
  const paths = edges.map(({ from, to }) => {
    const a = nodes[from];
    const b = nodes[to];
    const cls = `parallx-mindmap__edge${edgeBranchClass(b.branch)}`;
    const d = edgePathFor(a, b, dir);
    const markerKey = b.branch < 0 ? 'n' : `b${b.branch % 6}`;
    // Endpoint labels ride the path so the canvas block can re-route
    // edges LIVE while a box is dragged. The arrowhead shows FLOW.
    return `<path class="${cls}" marker-end="url(#mm${uid}-arrow-${markerKey})" `
      + `data-mm-from="${escapeXml(a.label)}" data-mm-to="${escapeXml(b.label)}" d="${d}" />`;
  }).join('');

  const boxes = nodes.map((n) => {
    const ow = opts.overrides?.[n.label]?.w;
    const measured = measureLabel(
      n.label,
      typeof ow === 'number' && Number.isFinite(ow) ? Math.max(24, Math.round(ow) - 24) : undefined,
    );
    const top = n.y - n.height / 2;
    const attrLabel = escapeXml(n.label);
    const cls = `parallx-mindmap__node parallx-mindmap__node--d${Math.min(n.depth, 2)} ${branchClass(n.branch)}`;
    const open = `<g class="${cls}" data-mindmap-label="${attrLabel}" role="button" tabindex="0">`
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
