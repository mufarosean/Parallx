// mindmapModel.ts — the mindmap document: shape, hygiene, and geometry.
//
// docs/MINDMAP_BRIEF.md is the contract this file implements. The two rules
// that shape everything here:
//
//   • THE AI DRAFTS, THE HUMAN SHAPES. Layout belongs to the user: the only
//     function allowed to move an existing node is `autoLayout`, and it runs
//     when the USER asks (first draft, or the Auto Layout button). Everything
//     the AI adds later goes through `layoutNewNodes`, which touches new
//     nodes only.
//   • A map connects IDEAS, not files. A node's `ref` is an optional anchor
//     to real content (a page, for click-through), never the identity of the
//     node.
//
// Pure module: no DOM, no services, no canvas imports. The editor pane, the
// data service, the AI tools and the SVG renderer all consume these types —
// one document shape, four doors.

// ── Document shape ──────────────────────────────────────────────────────────

/** Named node colors. Resolved to token-backed CSS by the views (mindmap.css
 *  `.mm-node--<color>`) and by the SVG renderer — never raw hex in data. */
export const MINDMAP_COLORS = ['neutral', 'red', 'yellow', 'green', 'blue', 'accent'] as const;
export type MindmapColor = (typeof MINDMAP_COLORS)[number];

export interface MindmapNode {
  readonly id: string;
  readonly label: string;
  readonly x: number;
  readonly y: number;
  readonly color: MindmapColor;
  /** Optional anchor to workspace content (click-through in the editor). */
  readonly ref: { readonly kind: 'page'; readonly id: string } | null;
}

export interface MindmapEdge {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  /** Free-text relation label (D2: no schema — maps are for thinking). */
  readonly label: string | null;
}

export interface MindmapDoc {
  readonly version: 1;
  readonly nodes: readonly MindmapNode[];
  readonly edges: readonly MindmapEdge[];
}

/** The outline shape the AI tools speak: parent by id, positions absent.
 *  `toDocNodes`/`mergeOutline` turn it into placed document nodes. */
export interface MindmapOutlineNode {
  readonly id?: string;
  readonly label: string;
  /** Parent node: an id from this outline or an existing node id/label. */
  readonly parent?: string;
  readonly color?: string;
  readonly refPageId?: string;
}

export interface MindmapOutlineEdge {
  readonly from: string;
  readonly to: string;
  readonly label?: string;
}

// ── Construction & hygiene ──────────────────────────────────────────────────

export function newId(): string {
  return (globalThis.crypto?.randomUUID?.() ?? `mm-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
}

export function emptyMindmapDoc(rootLabel: string): MindmapDoc {
  return {
    version: 1,
    nodes: [{ id: newId(), label: rootLabel || 'Central Idea', x: 0, y: 0, color: 'accent', ref: null }],
    edges: [],
  };
}

function asColor(v: unknown): MindmapColor {
  return (MINDMAP_COLORS as readonly string[]).includes(v as string) ? (v as MindmapColor) : 'neutral';
}

/**
 * Parse a stored document, tolerantly. Malformed entries are dropped, never
 * thrown on: duplicate node ids keep the first occurrence, edges that dangle
 * (either end missing) or self-loop are removed, colors are clamped to the
 * palette. A completely unreadable payload yields an empty one-node map so
 * the editor always opens.
 */
export function parseMindmapDoc(json: string): MindmapDoc {
  let raw: unknown;
  try { raw = JSON.parse(json); } catch { return emptyMindmapDoc('Central Idea'); }
  const obj = (raw ?? {}) as { nodes?: unknown; edges?: unknown };

  const nodes: MindmapNode[] = [];
  const seen = new Set<string>();
  if (Array.isArray(obj.nodes)) {
    for (const n of obj.nodes as Record<string, unknown>[]) {
      const id = typeof n?.id === 'string' ? n.id : '';
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const refId = (n.ref as { id?: unknown } | null)?.id;
      nodes.push({
        id,
        label: typeof n.label === 'string' ? n.label : '',
        x: Number.isFinite(n.x as number) ? (n.x as number) : 0,
        y: Number.isFinite(n.y as number) ? (n.y as number) : 0,
        color: asColor(n.color),
        ref: typeof refId === 'string' && refId ? { kind: 'page', id: refId } : null,
      });
    }
  }

  const edges: MindmapEdge[] = [];
  const edgeSeen = new Set<string>();
  if (Array.isArray(obj.edges)) {
    for (const e of obj.edges as Record<string, unknown>[]) {
      const from = typeof e?.from === 'string' ? e.from : '';
      const to = typeof e?.to === 'string' ? e.to : '';
      if (!seen.has(from) || !seen.has(to) || from === to) continue;
      const key = `${from}→${to}`;
      if (edgeSeen.has(key)) continue;
      edgeSeen.add(key);
      edges.push({
        id: typeof e.id === 'string' && e.id ? e.id : newId(),
        from,
        to,
        label: typeof e.label === 'string' && e.label ? e.label : null,
      });
    }
  }

  if (nodes.length === 0) return emptyMindmapDoc('Central Idea');
  return { version: 1, nodes, edges };
}

export function serializeMindmapDoc(doc: MindmapDoc): string {
  return JSON.stringify({ version: 1, nodes: doc.nodes, edges: doc.edges });
}

// ── Structure queries ───────────────────────────────────────────────────────

/** First incoming edge's source — the node's primary parent, or null. */
export function primaryParent(doc: MindmapDoc, nodeId: string): string | null {
  const e = doc.edges.find((x) => x.to === nodeId);
  return e ? e.from : null;
}

export function childrenOf(doc: MindmapDoc, nodeId: string): string[] {
  return doc.edges.filter((e) => e.from === nodeId).map((e) => e.to);
}

/**
 * The map's root: the node with no incoming edge that reaches the most
 * descendants (falls back to the first node). Cycles are tolerated — the
 * reach walk marks visited.
 */
export function rootOf(doc: MindmapDoc): string {
  const hasIncoming = new Set(doc.edges.map((e) => e.to));
  const candidates = doc.nodes.filter((n) => !hasIncoming.has(n.id));
  const pool = candidates.length > 0 ? candidates : doc.nodes;
  let best = pool[0]?.id ?? '';
  let bestReach = -1;
  for (const c of pool) {
    let reach = 0;
    const visited = new Set<string>([c.id]);
    const queue = [c.id];
    while (queue.length) {
      for (const child of childrenOf(doc, queue.shift()!)) {
        if (visited.has(child)) continue;
        visited.add(child);
        queue.push(child);
        reach++;
      }
    }
    if (reach > bestReach) { bestReach = reach; best = c.id; }
  }
  return best;
}

// ── Geometry ────────────────────────────────────────────────────────────────
//
// Size estimation mirrors mindmap.css (`.mm-node`): 13px UI font, wrap at
// MAX_LABEL_WIDTH, 8px vertical / 12px horizontal padding, 1px border. The
// constants are deliberately conservative — layout only needs boxes that are
// AT LEAST as big as the rendered node so nothing overlaps.

const CHAR_W = 7.4;
const LINE_H = 19;
const PAD_X = 13; // 12px padding + 1px border
const PAD_Y = 9;  // 8px padding + 1px border
export const MAX_LABEL_WIDTH = 220;
const MIN_NODE_WIDTH = 56;

export function estimateNodeSize(label: string): { w: number; h: number } {
  const text = label || ' ';
  const perLine = Math.max(4, Math.floor((MAX_LABEL_WIDTH - 2 * PAD_X) / CHAR_W));
  const lines = text.split('\n').reduce((acc, l) => acc + Math.max(1, Math.ceil(l.length / perLine)), 0);
  const longest = Math.max(...text.split('\n').map((l) => Math.min(l.length, perLine)));
  const w = Math.max(MIN_NODE_WIDTH, Math.min(MAX_LABEL_WIDTH, longest * CHAR_W + 2 * PAD_X));
  return { w, h: lines * LINE_H + 2 * PAD_Y };
}

const H_GAP = 72;  // horizontal distance between depth levels' boxes
const V_GAP = 14;  // vertical gap between sibling subtrees

interface LayoutEntry { x: number; y: number }

/**
 * Two-sided tidy tree — the classic mind-map layout: root centred, its
 * branches balanced left and right by subtree weight, each side a tidy
 * left-to-right (or right-to-left) tree whose vertical extents come from the
 * subtree sizes. Deterministic for a given document. Nodes unreachable from
 * the root (free-floating clusters) are stacked below the tree, laid out the
 * same way from their own local root.
 *
 * This is the ONLY function that repositions existing nodes, and it is only
 * called on user request (first draft / Auto Layout).
 */
export function autoLayout(doc: MindmapDoc): MindmapDoc {
  if (doc.nodes.length === 0) return doc;
  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  const pos = new Map<string, LayoutEntry>();
  const placed = new Set<string>();

  // Tree children only (first-parent wins); cross-links don't drive layout.
  const treeChildren = (id: string): string[] =>
    childrenOf(doc, id).filter((c) => !placed.has(c) && primaryParent(doc, c) === id);

  const sizeOf = (id: string) => estimateNodeSize(byId.get(id)?.label ?? '');

  /** Height of a subtree's vertical footprint. */
  function subtreeHeight(id: string, visited: Set<string>): number {
    if (visited.has(id)) return 0;
    visited.add(id);
    const kids = childrenOf(doc, id).filter((c) => primaryParent(doc, c) === id && !visited.has(c));
    if (kids.length === 0) return sizeOf(id).h;
    let sum = 0;
    for (const k of kids) sum += subtreeHeight(k, visited) + V_GAP;
    return Math.max(sizeOf(id).h, sum - V_GAP);
  }

  /** Lay a subtree with its vertical centre at `cy`, growing in `dir`. */
  function layoutSubtree(id: string, edgeX: number, cy: number, dir: 1 | -1): void {
    if (placed.has(id)) return;
    placed.add(id);
    const size = sizeOf(id);
    const x = dir === 1 ? edgeX : edgeX - size.w;
    pos.set(id, { x, y: cy - size.h / 2 });

    const kids = treeChildren(id);
    if (kids.length === 0) return;
    const childEdgeX = dir === 1 ? x + size.w + H_GAP : x - H_GAP;
    const heights = kids.map((k) => subtreeHeight(k, new Set(placed)));
    const total = heights.reduce((a, b) => a + b, 0) + V_GAP * (kids.length - 1);
    let cursor = cy - total / 2;
    kids.forEach((k, i) => {
      layoutSubtree(k, childEdgeX, cursor + heights[i] / 2, dir);
      cursor += heights[i] + V_GAP;
    });
  }

  function layoutCluster(rootId: string, cy: number): number {
    const size = sizeOf(rootId);
    placed.add(rootId);
    pos.set(rootId, { x: -size.w / 2, y: cy - size.h / 2 });

    // Balance branches: alternate assignment by descending subtree height —
    // the classic greedy split keeps both sides visually even.
    const branches = treeChildren(rootId)
      .map((id) => ({ id, h: subtreeHeight(id, new Set([rootId])) }))
      .sort((a, b) => b.h - a.h);
    const right: typeof branches = [];
    const left: typeof branches = [];
    let rightH = 0;
    let leftH = 0;
    for (const b of branches) {
      if (rightH <= leftH) { right.push(b); rightH += b.h + V_GAP; }
      else { left.push(b); leftH += b.h + V_GAP; }
    }
    const laySide = (side: typeof branches, dir: 1 | -1, totalH: number) => {
      const edgeX = dir === 1 ? size.w / 2 + H_GAP : -size.w / 2 - H_GAP;
      let cursor = cy - (totalH - V_GAP) / 2;
      for (const b of side) {
        layoutSubtree(b.id, edgeX, cursor + b.h / 2, dir);
        cursor += b.h + V_GAP;
      }
    };
    laySide(right, 1, rightH);
    laySide(left, -1, leftH);
    return Math.max(size.h, rightH, leftH);
  }

  let clusterCy = 0;
  let bottom = 0;
  // Primary cluster first, then any free-floating ones below it.
  const order = [rootOf(doc), ...doc.nodes.map((n) => n.id)];
  for (const id of order) {
    if (!byId.has(id) || placed.has(id)) continue;
    // Only start clusters at local roots (no placed/unplaced parent inside).
    const parent = primaryParent(doc, id);
    if (parent && byId.has(parent) && !placed.has(parent)) continue;
    const h = layoutCluster(id, clusterCy);
    bottom = clusterCy + h / 2;
    clusterCy = bottom + 4 * V_GAP + 40;
  }
  // Anything still unplaced (cycles) drops in a row at the bottom.
  let x = 0;
  for (const n of doc.nodes) {
    if (placed.has(n.id)) continue;
    pos.set(n.id, { x, y: bottom + 60 });
    x += estimateNodeSize(n.label).w + H_GAP;
  }

  return {
    ...doc,
    nodes: doc.nodes.map((n) => {
      const p = pos.get(n.id);
      return p ? { ...n, x: p.x, y: p.y } : n;
    }),
  };
}

function rectsOverlap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
  gap: number,
): boolean {
  return a.x < b.x + b.w + gap && a.x + a.w + gap > b.x
    && a.y < b.y + b.h + gap && a.y + a.h + gap > b.y;
}

/** Nudge a desired position downward until it collides with nothing. */
function findFreeSpot(
  doc: MindmapDoc,
  desired: { x: number; y: number },
  size: { w: number; h: number },
  ignore: ReadonlySet<string>,
): { x: number; y: number } {
  const boxes = doc.nodes
    .filter((n) => !ignore.has(n.id))
    .map((n) => ({ x: n.x, y: n.y, ...estimateNodeSize(n.label) }));
  const spot = { x: desired.x, y: desired.y };
  for (let guard = 0; guard < 200; guard++) {
    const hit = boxes.find((b) => rectsOverlap({ ...spot, ...size }, b, V_GAP / 2));
    if (!hit) return spot;
    spot.y = hit.y + hit.h + V_GAP;
  }
  return spot;
}

/** Where a NEW child of `parentId` should go: to the parent's outward side
 *  (matching which half of the map it sits in), below its siblings. */
export function placeChild(doc: MindmapDoc, parentId: string): { x: number; y: number } {
  const parent = doc.nodes.find((n) => n.id === parentId);
  if (!parent) return findFreeSpot(doc, { x: 0, y: 0 }, estimateNodeSize(''), new Set());
  const psize = estimateNodeSize(parent.label);
  const root = doc.nodes.find((n) => n.id === rootOf(doc));
  const dir: 1 | -1 = root && parent.x + psize.w / 2 < root.x ? -1 : 1;
  const size = estimateNodeSize('');
  const x = dir === 1 ? parent.x + psize.w + H_GAP : parent.x - H_GAP - size.w;
  const kids = childrenOf(doc, parentId)
    .map((id) => doc.nodes.find((n) => n.id === id))
    .filter((n): n is MindmapNode => !!n);
  const y = kids.length > 0
    ? Math.max(...kids.map((k) => k.y + estimateNodeSize(k.label).h)) + V_GAP
    : parent.y;
  return findFreeSpot(doc, { x, y }, size, new Set());
}

/** Where a NEW free-floating node (double-click, no parent) goes. */
export function placeFloating(doc: MindmapDoc, near: { x: number; y: number }): { x: number; y: number } {
  return findFreeSpot(doc, near, estimateNodeSize(''), new Set());
}

/**
 * Position ONLY the listed (new) nodes, leaving every other node exactly
 * where the user put it — the AI-update path's half of "the AI drafts, the
 * human shapes". Parents first so a new chain hangs off its own placements.
 */
export function layoutNewNodes(doc: MindmapDoc, newIds: ReadonlySet<string>): MindmapDoc {
  let current = doc;
  const pending = new Set(newIds);
  let guard = pending.size + 1;
  while (pending.size > 0 && guard-- > 0) {
    for (const id of [...pending]) {
      const parent = primaryParent(current, id);
      if (parent && pending.has(parent)) continue; // wait for the parent
      const spot = parent
        ? placeChild(current, parent)
        : placeFloating(current, { x: 0, y: 0 });
      current = {
        ...current,
        nodes: current.nodes.map((n) => (n.id === id ? { ...n, x: spot.x, y: spot.y } : n)),
      };
      pending.delete(id);
    }
  }
  return current;
}

// ── Branch colors ───────────────────────────────────────────────────────────

const BRANCH_PALETTE: readonly MindmapColor[] = ['red', 'yellow', 'green', 'blue'];

/**
 * Give each of the root's branches a palette color, propagated to its
 * subtree; the root stays accent. Only nodes still 'neutral' are touched —
 * a color the user (or the AI) chose is theirs.
 */
export function assignBranchColors(doc: MindmapDoc): MindmapDoc {
  const root = rootOf(doc);
  const color = new Map<string, MindmapColor>();
  childrenOf(doc, root).forEach((branch, i) => {
    const c = BRANCH_PALETTE[i % BRANCH_PALETTE.length];
    const queue = [branch];
    const visited = new Set<string>([root]);
    while (queue.length) {
      const id = queue.shift()!;
      if (visited.has(id)) continue;
      visited.add(id);
      color.set(id, c);
      queue.push(...childrenOf(doc, id));
    }
  });
  return {
    ...doc,
    nodes: doc.nodes.map((n) => {
      if (n.id === root && n.color === 'neutral') return { ...n, color: 'accent' as MindmapColor };
      const c = color.get(n.id);
      return c && n.color === 'neutral' ? { ...n, color: c } : n;
    }),
  };
}

// ── Outline → document (the AI tools' door) ─────────────────────────────────

export interface OutlineMergeResult {
  readonly doc: MindmapDoc;
  readonly newNodeIds: readonly string[];
  readonly skipped: readonly string[];
}

/**
 * Merge an AI outline into a document. Parents resolve against outline ids
 * first, then existing node ids, then existing labels (case-insensitive,
 * first match). New nodes arrive UNPOSITIONED (0,0) — the caller runs
 * `autoLayout` (empty map) or `layoutNewNodes` (existing map) afterwards.
 * Existing nodes are NEVER modified; an outline node whose id already exists
 * is reported in `skipped`.
 */
export function mergeOutline(
  doc: MindmapDoc,
  nodes: readonly MindmapOutlineNode[],
  edges: readonly MindmapOutlineEdge[] = [],
): OutlineMergeResult {
  const existingIds = new Set(doc.nodes.map((n) => n.id));
  const byLabel = new Map<string, string>();
  for (const n of doc.nodes) {
    const key = n.label.trim().toLowerCase();
    if (key && !byLabel.has(key)) byLabel.set(key, n.id);
  }

  const outlineIdMap = new Map<string, string>(); // outline id → real id
  const newByLabel = new Map<string, string>();   // new label (lower) → real id
  const newNodes: MindmapNode[] = [];
  const skipped: string[] = [];

  for (const on of nodes) {
    if (!on || typeof on.label !== 'string' || !on.label.trim()) { skipped.push(String(on?.id ?? on?.label ?? '?')); continue; }
    const requested = typeof on.id === 'string' && on.id ? on.id : '';
    if (requested && (existingIds.has(requested) || outlineIdMap.has(requested))) { skipped.push(requested); continue; }
    const realId = requested || newId();
    if (requested) outlineIdMap.set(requested, realId);
    existingIds.add(realId);
    const label = on.label.trim();
    // Parents/edges may name a NEW node by its label (models rarely mint
    // ids) — first occurrence wins, matching the existing-label rule.
    const labelKey = label.toLowerCase();
    if (!newByLabel.has(labelKey)) newByLabel.set(labelKey, realId);
    newNodes.push({
      id: realId,
      label,
      x: 0,
      y: 0,
      color: asColor(on.color),
      ref: typeof on.refPageId === 'string' && on.refPageId ? { kind: 'page', id: on.refPageId } : null,
    });
  }

  const resolve = (key: string | undefined): string | null => {
    if (!key) return null;
    if (outlineIdMap.has(key)) return outlineIdMap.get(key)!;
    if (existingIds.has(key)) return key;
    const lower = key.trim().toLowerCase();
    return newByLabel.get(lower) ?? byLabel.get(lower) ?? null;
  };

  const newEdges: MindmapEdge[] = [];
  const edgeKeys = new Set(doc.edges.map((e) => `${e.from}→${e.to}`));
  const addEdge = (from: string | null, to: string | null, label?: string) => {
    if (!from || !to || from === to) return;
    const key = `${from}→${to}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    newEdges.push({ id: newId(), from, to, label: label?.trim() || null });
  };

  for (const on of nodes) {
    if (!on?.parent) continue;
    const childKey = typeof on.id === 'string' && on.id ? on.id : on.label;
    addEdge(resolve(on.parent), resolve(childKey) ?? null);
  }
  for (const e of edges) addEdge(resolve(e?.from), resolve(e?.to), e?.label);

  return {
    doc: { ...doc, nodes: [...doc.nodes, ...newNodes], edges: [...doc.edges, ...newEdges] },
    newNodeIds: newNodes.map((n) => n.id),
    skipped,
  };
}

/** The document as an indented text outline — what `mindmap_read` returns. */
export function docToOutlineText(doc: MindmapDoc): string {
  const root = rootOf(doc);
  const lines: string[] = [];
  const visited = new Set<string>();
  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  const walk = (id: string, depth: number) => {
    if (visited.has(id)) return;
    visited.add(id);
    const n = byId.get(id);
    if (!n) return;
    lines.push(`${'  '.repeat(depth)}- ${n.label} (id: ${n.id})`);
    for (const c of childrenOf(doc, id)) {
      if (primaryParent(doc, c) === id) walk(c, depth + 1);
    }
  };
  walk(root, 0);
  for (const n of doc.nodes) walk(n.id, 0);
  const cross = doc.edges.filter((e) => primaryParent(doc, e.to) !== e.from);
  if (cross.length > 0) {
    lines.push('', 'Cross-links:');
    for (const e of cross) {
      const f = byId.get(e.from)?.label ?? e.from;
      const t = byId.get(e.to)?.label ?? e.to;
      lines.push(`- ${f} → ${t}${e.label ? ` (${e.label})` : ''}`);
    }
  }
  return lines.join('\n');
}
