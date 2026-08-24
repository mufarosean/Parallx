// chatMindMap.ts — small concept maps drawn inside a chat answer (M102)
//
// Not the workspace graph. That one answers "which files touch which files";
// this answers "how do these few ideas connect", is generated for ONE answer,
// and is thrown away with it. Different question, different artefact.
//
// The source syntax is an indented list, deliberately not mermaid:
//
//   ```mindmap
//   Parameter risk
//     does not diversify
//       every year shares the same estimated parameters
//     Mack's standard error
//       process + parameter
//   ```
//
// Two reasons for that choice. Local models emit indented lists reliably and
// mangle mermaid's punctuation constantly; and when a mangled line does get
// through, an outline still READS — a mermaid syntax error renders as an
// empty box. The renderer leans on the same property: anything it cannot
// lay out falls back to the outline rather than to nothing.
//
// Layout is a classic tidy tree rotated left-to-right: depth picks the
// column, leaves stack down the page, and a parent sits at the midpoint of
// its children. Everything here is pure — no DOM, no measurement — so it is
// unit-tested directly, and colours live in CSS tokens rather than in the
// emitted markup.

export interface MindMapNode {
  readonly label: string;
  readonly children: MindMapNode[];
}

/**
 * A chat mind map is a thinking aid, not a diagram tool. Past these bounds it
 * stops being readable in a message column, so the parser stops rather than
 * emitting an unusable wall — the remaining lines are dropped and the
 * fallback outline still shows everything.
 */
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
 * Parse the indented-list source into a forest. Pure.
 *
 * Depth comes from a stack comparison rather than dividing the indent by a
 * fixed step, so 2-space, 4-space, tab, and inconsistently mixed indentation
 * all produce the same tree. The only thing that matters is that a child is
 * indented further than its parent.
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
    // Past the depth cap a node joins its deepest allowed ancestor instead of
    // being dropped: losing the connection is worse than losing the nesting.
    while (stack.length > MAX_DEPTH - 1) stack.pop();

    const node: MindMapNode = { label, children: [] };
    if (stack.length === 0) roots.push(node);
    else stack[stack.length - 1].node.children.push(node);
    stack.push({ indent, node });
    count++;
  }

  return roots;
}

// ── Layout ──────────────────────────────────────────────────────────────────

export interface LaidOutNode {
  readonly label: string;
  readonly depth: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
}

export interface MindMapLayout {
  readonly nodes: readonly LaidOutNode[];
  readonly edges: readonly { readonly from: number; readonly to: number }[];
  readonly width: number;
  readonly height: number;
}

const ROW_H = 30;          // vertical pitch per leaf
const BOX_H = 22;
const COL_GAP = 34;        // horizontal gap between a parent box and its children
const PAD_X = 10;          // padding inside a node box
const CHAR_W = 6.7;        // average advance for the 12px UI font
const MARGIN = 8;

/** Estimated box width for a label. Pure. */
function boxWidth(label: string): number {
  return Math.round(label.length * CHAR_W) + PAD_X * 2;
}

/**
 * Lay the forest out left-to-right. Pure — no DOM measurement, which is what
 * lets this be tested and rendered to a string in one pass.
 *
 * Text width is ESTIMATED from character count rather than measured. A
 * proportional font makes that approximate, so boxes are sized generously
 * and the label is clipped by the parser rather than by the box: a slightly
 * wide box is invisible, a clipped word is not.
 */
export function layoutMindMap(roots: readonly MindMapNode[]): MindMapLayout {
  const nodes: LaidOutNode[] = [];
  const edges: { from: number; to: number }[] = [];

  // Column x positions: a column starts after the widest box in every column
  // before it, so no edge ever runs backwards under a node.
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

  let nextLeafY = MARGIN + BOX_H / 2;
  const place = (node: MindMapNode, depth: number): number => {
    const index = nodes.length;
    // Reserve the slot before descending so a parent's index always precedes
    // its children's — edges are emitted as index pairs and the renderer
    // draws in array order.
    nodes.push({ label: node.label, depth, x: colX[depth], y: 0, width: boxWidth(node.label) });

    let y: number;
    if (node.children.length === 0) {
      y = nextLeafY;
      nextLeafY += ROW_H;
    } else {
      const childYs = node.children.map((child) => {
        const childIndex = place(child, depth + 1);
        edges.push({ from: index, to: childIndex });
        return nodes[childIndex].y;
      });
      y = (childYs[0] + childYs[childYs.length - 1]) / 2;
    }

    nodes[index] = { ...nodes[index], y };
    return index;
  };
  for (const root of roots) place(root, 0);

  return {
    nodes,
    edges,
    width: Math.max(runningX - COL_GAP + MARGIN, MARGIN * 2),
    height: Math.max(nextLeafY - ROW_H / 2 + MARGIN, MARGIN * 2 + BOX_H),
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

/**
 * Render the map to an SVG string.
 *
 * Colour and weight come entirely from CSS classes so the diagram follows
 * the app theme in light and dark; nothing here emits a colour. Returns the
 * outline fallback when there is nothing layoutable, so a mangled block
 * degrades to something the reader can still use.
 */
export function renderMindMapSvg(src: string): string {
  const roots = parseMindMap(src);
  if (roots.length === 0) return renderMindMapFallback(src);

  const { nodes, edges, width, height } = layoutMindMap(roots);

  const paths = edges.map(({ from, to }) => {
    const a = nodes[from];
    const b = nodes[to];
    const x1 = a.x + a.width;
    const x2 = b.x;
    const mid = x1 + (x2 - x1) / 2;
    return `<path class="parallx-mindmap__edge" d="M${x1} ${a.y} C${mid} ${a.y} ${mid} ${b.y} ${x2} ${b.y}" />`;
  }).join('');

  const boxes = nodes.map((n) => {
    const y = n.y - BOX_H / 2;
    const label = escapeXml(n.label);
    return `<g class="parallx-mindmap__node parallx-mindmap__node--d${Math.min(n.depth, 2)}" `
      + `data-mindmap-label="${label}" role="button" tabindex="0">`
      + `<rect class="parallx-mindmap__box" x="${n.x}" y="${y}" width="${n.width}" height="${BOX_H}" rx="5" />`
      + `<text class="parallx-mindmap__text" x="${n.x + PAD_X}" y="${n.y}" dominant-baseline="central">${label}</text>`
      + `</g>`;
  }).join('');

  // viewBox + max-width keeps a wide map inside the message column instead of
  // widening it; the wrapper scrolls horizontally when it genuinely cannot fit.
  return `<div class="parallx-mindmap">`
    + `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" `
    + `role="img" aria-label="Concept map">${paths}${boxes}</svg>`
    + `</div>`;
}
