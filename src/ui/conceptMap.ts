// conceptMap.ts — the concept-map core: indented outline in, diagram out.
//
// Grown out of chat's M102 inline mind map (chatMindMap.ts, which now
// re-exports this) because the pattern EARNED promotion: the model writes
// outlines in its native medium, a deterministic renderer does all the
// geometry, and a mangled block degrades to the readable outline instead
// of an empty box. Canvas's conceptMap block consumes the same core, so
// chat and canvas can never drift apart.
//
// Everything here is pure — no DOM, no measurement, no theme values.
// Colour comes from CSS classes (branch classes cycle a token palette);
// math rendering is INJECTED (chat and canvas both pass KaTeX) so this
// module stays dependency-free and unit-testable.

import './conceptMap.css';

export interface MindMapNode {
  readonly label: string;
  readonly children: MindMapNode[];
}

const MAX_NODES = 40;
const MAX_DEPTH = 5;
const MAX_LABEL_CHARS = 64;

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
    const label = rawLine
      .trim()
      .replace(/^[-*•]\s+/, '')
      .replace(/^\d+[.)]\s+/, '')
      .trim()
      .slice(0, MAX_LABEL_CHARS);
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

// ── Math-aware labels ───────────────────────────────────────────────────────

export interface LabelSegment {
  readonly kind: 'text' | 'math';
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

function labelHasMath(label: string): boolean {
  return splitLabel(label).some((s) => s.kind === 'math');
}

// ── Layout ──────────────────────────────────────────────────────────────────

export interface LaidOutNode {
  readonly label: string;
  readonly depth: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  /** Top-level branch index (colour class), -1 for roots. */
  readonly branch: number;
}

export interface MindMapLayout {
  readonly nodes: readonly LaidOutNode[];
  readonly edges: readonly { readonly from: number; readonly to: number }[];
  readonly width: number;
  readonly height: number;
  readonly dir: MindMapDirection;
  readonly boxH: number;
}

const ROW_H = 30;          // pitch per leaf (horizontal layout)
const BOX_H = 22;
const BOX_H_MATH = 30;     // formulas need headroom for fractions
const ROW_H_MATH = 40;
const COL_GAP = 34;        // gap between a parent box and its children (right)
const LEVEL_GAP = 26;      // gap between depth rows (down)
const SIB_GAP = 14;        // gap between sibling boxes (down)
const PAD_X = 10;
const CHAR_W = 6.7;        // average advance for the 12px UI font
const MARGIN = 8;

/** Estimated box width. Math spans estimate from stripped TeX, generously. */
export function boxWidth(label: string): number {
  let w = 0;
  for (const seg of splitLabel(label)) {
    if (seg.kind === 'text') w += seg.value.length * CHAR_W;
    else w += Math.max(3, seg.value.replace(/\\[a-zA-Z]+/g, 'xx').length) * CHAR_W * 0.95 + 6;
  }
  return Math.round(w) + PAD_X * 2;
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
  const anyMath = ((): boolean => {
    const walk = (n: MindMapNode): boolean => labelHasMath(n.label) || n.children.some(walk);
    return roots.some(walk);
  })();
  const boxH = anyMath ? BOX_H_MATH : BOX_H;
  const rowPitch = anyMath ? ROW_H_MATH : ROW_H;

  const nodes: LaidOutNode[] = [];
  const edges: { from: number; to: number }[] = [];

  /** Branch index: each top-level subtree under a root gets the next hue. */
  let branchCounter = 0;

  if (dir === 'right') {
    const widestByDepth: number[] = [];
    const measure = (node: MindMapNode, depth: number): void => {
      widestByDepth[depth] = Math.max(widestByDepth[depth] ?? 0, boxWidth(node.label));
      for (const child of node.children) measure(child, depth + 1);
    };
    for (const root of roots) measure(root, 0);

    const colX: number[] = [];
    let runningX = MARGIN;
    for (let d = 0; d < widestByDepth.length; d++) {
      colX[d] = runningX;
      runningX += (widestByDepth[d] ?? 0) + COL_GAP;
    }

    let nextLeafY = MARGIN + boxH / 2;
    const place = (node: MindMapNode, depth: number, branch: number): number => {
      const index = nodes.length;
      nodes.push({ label: node.label, depth, x: colX[depth], y: 0, width: boxWidth(node.label), branch });

      let y: number;
      if (node.children.length === 0) {
        y = nextLeafY;
        nextLeafY += rowPitch;
      } else {
        const childYs = node.children.map((child) => {
          const childBranch = depth === 0 ? branchCounter++ : branch;
          const childIndex = place(child, depth + 1, childBranch);
          edges.push({ from: index, to: childIndex });
          return nodes[childIndex].y;
        });
        y = (childYs[0] + childYs[childYs.length - 1]) / 2;
      }

      nodes[index] = { ...nodes[index], y };
      return index;
    };
    for (const root of roots) place(root, 0, -1);

    return {
      nodes,
      edges,
      width: Math.max(runningX - COL_GAP + MARGIN, MARGIN * 2),
      height: Math.max(nextLeafY - rowPitch / 2 + MARGIN, MARGIN * 2 + boxH),
      dir,
      boxH,
    };
  }

  // dir === 'down' — rows by depth, leaves spread across.
  let maxDepth = 0;
  const findDepth = (n: MindMapNode, d: number): void => {
    maxDepth = Math.max(maxDepth, d);
    for (const c of n.children) findDepth(c, d + 1);
  };
  for (const root of roots) findDepth(root, 0);

  const rowY: number[] = [];
  for (let d = 0; d <= maxDepth; d++) {
    rowY[d] = MARGIN + boxH / 2 + d * (boxH + LEVEL_GAP);
  }

  let nextLeafX = MARGIN;
  const place = (node: MindMapNode, depth: number, branch: number): number => {
    const index = nodes.length;
    const w = boxWidth(node.label);
    nodes.push({ label: node.label, depth, x: 0, y: rowY[depth], width: w, branch });

    let centerX: number;
    if (node.children.length === 0) {
      centerX = nextLeafX + w / 2;
      nextLeafX += w + SIB_GAP;
    } else {
      const childCenters = node.children.map((child) => {
        const childBranch = depth === 0 ? branchCounter++ : branch;
        const childIndex = place(child, depth + 1, childBranch);
        edges.push({ from: index, to: childIndex });
        return nodes[childIndex].x + nodes[childIndex].width / 2;
      });
      centerX = (childCenters[0] + childCenters[childCenters.length - 1]) / 2;
      // A parent wider than its children's span must still claim room.
      nextLeafX = Math.max(nextLeafX, centerX + w / 2 + SIB_GAP);
    }

    nodes[index] = { ...nodes[index], x: centerX - w / 2 };
    return index;
  };
  for (const root of roots) place(root, 0, -1);

  const width = Math.max(...nodes.map((n) => n.x + n.width), MARGIN) + MARGIN;
  return {
    nodes,
    edges,
    width,
    height: rowY[maxDepth] + boxH / 2 + MARGIN,
    dir,
    boxH,
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
}

function branchClass(branch: number): string {
  return branch < 0 ? 'parallx-mindmap__node--root' : `parallx-mindmap__node--b${branch % 6}`;
}

function edgeBranchClass(branch: number): string {
  return branch < 0 ? '' : ` parallx-mindmap__edge--b${branch % 6}`;
}

/**
 * Render the map to an SVG string. Colour and weight come entirely from
 * CSS classes; branch hues cycle six viz tokens. Labels with $…$ render
 * through the injected math renderer inside a foreignObject.
 */
export function renderMindMapSvg(src: string, opts: RenderMindMapOptions = {}): string {
  const roots = parseMindMap(src);
  if (roots.length === 0) return renderMindMapFallback(src);

  const dir = opts.dir ?? 'right';
  const { nodes, edges, width, height, boxH } = layoutMindMap(roots, dir);

  const paths = edges.map(({ from, to }) => {
    const a = nodes[from];
    const b = nodes[to];
    const cls = `parallx-mindmap__edge${edgeBranchClass(b.branch)}`;
    if (dir === 'right') {
      const x1 = a.x + a.width;
      const x2 = b.x;
      const mid = x1 + (x2 - x1) / 2;
      return `<path class="${cls}" d="M${x1} ${a.y} C${mid} ${a.y} ${mid} ${b.y} ${x2} ${b.y}" />`;
    }
    const y1 = a.y + boxH / 2;
    const y2 = b.y - boxH / 2;
    const xa = a.x + a.width / 2;
    const xb = b.x + b.width / 2;
    const mid = y1 + (y2 - y1) / 2;
    return `<path class="${cls}" d="M${xa} ${y1} C${xa} ${mid} ${xb} ${mid} ${xb} ${y2}" />`;
  }).join('');

  const boxes = nodes.map((n) => {
    const y = n.y - boxH / 2;
    const attrLabel = escapeXml(n.label);
    const cls = `parallx-mindmap__node parallx-mindmap__node--d${Math.min(n.depth, 2)} ${branchClass(n.branch)}`;
    const open = `<g class="${cls}" data-mindmap-label="${attrLabel}" role="button" tabindex="0">`
      + `<rect class="parallx-mindmap__box" x="${n.x}" y="${y}" width="${n.width}" height="${boxH}" rx="5" />`;

    const segments = splitLabel(n.label);
    const hasMath = segments.some((s) => s.kind === 'math');
    if (hasMath && opts.renderMath) {
      const inner = segments.map((s) => (
        s.kind === 'math'
          ? `<span class="parallx-mindmap__math">${opts.renderMath!(s.value)}</span>`
          : escapeXml(s.value)
      )).join('');
      return `${open}<foreignObject x="${n.x + PAD_X}" y="${y}" width="${Math.max(4, n.width - PAD_X * 2)}" height="${boxH}">`
        + `<div class="parallx-mindmap__flabel" xmlns="http://www.w3.org/1999/xhtml">${inner}</div>`
        + `</foreignObject></g>`;
    }
    return `${open}<text class="parallx-mindmap__text" x="${n.x + PAD_X}" y="${n.y}" dominant-baseline="central">${attrLabel}</text></g>`;
  }).join('');

  return `<div class="parallx-mindmap" data-mindmap-dir="${dir}">`
    + `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" `
    + `role="img" aria-label="Concept map">${paths}${boxes}</svg>`
    + `</div>`;
}
