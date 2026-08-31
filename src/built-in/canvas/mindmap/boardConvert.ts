// boardConvert.ts — pure translation between our vocabularies and the board.
//
// Three translations, no engine import (main bundle stays engine-free):
//
//   legacyDocToSkeletons — v1 mindmap documents (nodes/edges) become board
//     elements the first time they open under the engine. Positions, sizes
//     and colors survive; nothing the user placed moves.
//   outlineToSkeletons   — the AI outline (label/parent/edges) becomes
//     board elements, laid out by the SAME two-sided tidy tree the old
//     editor used (mindmapModel.autoLayout does the geometry).
//   boardOutlineText     — the scene read back as an indented outline for
//     mindmap_read and the Draft door's context.
//
// Envelope parsing also lives here: mindmaps.data now stores a
// BoardEnvelope; v1 documents are detected and migrated on read.

import {
  autoLayout,
  assignBranchColors,
  mergeOutline,
  childrenOf,
  primaryParent,
  rootOf,
  nodeBox,
  parseMindmapDoc,
  type MindmapColor,
  type MindmapDoc,
  type MindmapOutlineEdge,
  type MindmapOutlineNode,
} from './mindmapModel.js';
import { emptyBoardEnvelope, type BoardEnvelope, type BoardSkeleton } from './boardTypes.js';

// Excalidraw stroke/background pairs per legacy color — the engine's own
// dark-theme-friendly palette values, stored in element data (not CSS, so
// the tokens-only gate does not apply; boards must render outside the app).
const BOARD_COLORS: Record<MindmapColor, { background: string; stroke: string }> = {
  neutral: { background: 'transparent', stroke: '#ced4da' },
  red:     { background: '#5c2e2e', stroke: '#e03131' },
  yellow:  { background: '#5c4d20', stroke: '#f08c00' },
  green:   { background: '#2b4d39', stroke: '#2f9e44' },
  blue:    { background: '#2a3f5c', stroke: '#4dabf7' },
  accent:  { background: '#2a3f5c', stroke: '#748ffc' },
};

/**
 * A label that IS a formula — "$E=mc^2$" or "$$\int f$$", nothing outside
 * the delimiters. Returns the TeX source, or null for prose/mixed labels.
 */
export function extractPureMath(text: string): string | null {
  const t = text.trim();
  if (t.length < 3 || !t.startsWith('$') || !t.endsWith('$')) return null;
  let start = 1;
  let end = t.length - 1;
  if (t.startsWith('$$') && t.endsWith('$$') && t.length >= 5) { start = 2; end = t.length - 2; }
  const inner = t.slice(start, end).trim();
  if (!inner || inner.includes('$')) return null;
  return inner;
}

function nodeSkeleton(n: MindmapDoc['nodes'][number]): BoardSkeleton {
  const box = nodeBox(n);
  // A pure-formula label becomes a math skeleton: the board host renders
  // the TeX (MathJax → SVG image element) when it materialises. The
  // original label rides along so reads and dedupe still speak text.
  const latex = extractPureMath(n.label);
  if (latex) {
    return {
      type: 'math',
      id: `mm-${n.id}`,
      x: n.x,
      y: n.y,
      latex,
      label: { text: n.label.trim() },
    };
  }
  const pal = BOARD_COLORS[n.color] ?? BOARD_COLORS.neutral;
  return {
    type: 'rectangle',
    id: `mm-${n.id}`,
    x: n.x,
    y: n.y,
    width: Math.max(box.w, 120),
    height: Math.max(box.h, 44),
    backgroundColor: pal.background,
    strokeColor: pal.stroke,
    label: { text: n.label || ' ' },
  };
}

function edgeSkeleton(e: MindmapDoc['edges'][number], doc: MindmapDoc): BoardSkeleton | null {
  const from = doc.nodes.find((n) => n.id === e.from);
  const to = doc.nodes.find((n) => n.id === e.to);
  if (!from || !to) return null;
  const skeleton: BoardSkeleton = {
    type: 'arrow',
    id: `mm-e-${e.id}`,
    x: (from.x + to.x) / 2,
    y: (from.y + to.y) / 2,
    start: { id: `mm-${e.from}` },
    end: { id: `mm-${e.to}` },
  };
  return e.label ? { ...skeleton, label: { text: e.label, fontSize: 12 } } : skeleton;
}

/** A v1 mindmap document as board skeletons — the one-time migration. */
export function legacyDocToSkeletons(doc: MindmapDoc): BoardSkeleton[] {
  const out: BoardSkeleton[] = doc.nodes.map(nodeSkeleton);
  for (const e of doc.edges) {
    const s = edgeSkeleton(e, doc);
    if (s) out.push(s);
  }
  return out;
}

/**
 * An AI outline as board skeletons. Geometry comes from the proven layout:
 * build a temporary v1 document, run the two-sided tidy tree + branch
 * colors, then translate. `avoidTexts` drops nodes whose label already
 * exists on the board (case-insensitive) so mindmap_add extends instead of
 * duplicating.
 */
export function outlineToSkeletons(
  nodes: readonly MindmapOutlineNode[],
  edges: readonly MindmapOutlineEdge[] = [],
  avoidTexts: readonly string[] = [],
): BoardSkeleton[] {
  const existing = new Set(avoidTexts.map((t) => t.trim().toLowerCase()));
  const fresh = nodes.filter((n) => n?.label && !existing.has(n.label.trim().toLowerCase()));
  if (fresh.length === 0) return [];
  const base: MindmapDoc = { version: 1, nodes: [], edges: [] };
  const merged = mergeOutline(base, fresh, edges);
  const laid = assignBranchColors(autoLayout(merged.doc));
  return legacyDocToSkeletons(laid);
}

/** The scene as an indented outline (labels + arrow relations). */
export function boardOutlineText(envelope: BoardEnvelope): string {
  type El = { id?: string; type?: string; isDeleted?: boolean; text?: string; containerId?: string | null; customData?: { mmLabel?: string; mmLatex?: string } | null; startBinding?: { elementId?: string } | null; endBinding?: { elementId?: string } | null };
  const els = (envelope.elements as El[]).filter((e) => !e.isDeleted);

  // Arrow endpoints bind to the CONTAINER (a labelled rect) or, for
  // formulas, to the image element itself — one label map serves both.
  const labelByElement = new Map<string, string>();
  const freeTexts: string[] = [];
  for (const e of els) {
    if (e.type === 'text' && e.text?.trim()) {
      if (e.containerId) labelByElement.set(e.containerId, e.text.trim());
      else freeTexts.push(e.text.trim());
    } else if (e.type === 'image' && e.id && (e.customData?.mmLabel || e.customData?.mmLatex)) {
      labelByElement.set(e.id, e.customData.mmLabel ?? `$${e.customData.mmLatex}$`);
    }
  }

  const lines: string[] = [];
  const links: string[] = [];
  for (const e of els) {
    if (e.type === 'arrow') {
      const a = e.startBinding?.elementId ? labelByElement.get(e.startBinding.elementId) : undefined;
      const b = e.endBinding?.elementId ? labelByElement.get(e.endBinding.elementId) : undefined;
      if (a && b) links.push(`- ${a} → ${b}`);
      continue;
    }
    if (e.type === 'text' && e.containerId) continue; // rendered via its container
    const label = e.id ? labelByElement.get(e.id) : undefined;
    if (label) lines.push(`- ${label}`);
  }
  for (const t of freeTexts) lines.push(`- ${t}`);
  for (const p of envelope.pending) {
    const label = p.label?.text ?? (typeof p.text === 'string' ? p.text : '');
    if (label.trim()) lines.push(`- ${label.trim()} (pending)`);
  }
  if (links.length) lines.push('', 'Connections:', ...links);
  return lines.join('\n');
}

/** Every text on the board (bound labels, free text, pending skeletons) —
 *  the dedupe set that keeps mindmap_add from drawing duplicates. */
export function boardLabels(envelope: BoardEnvelope): string[] {
  type El = { type?: string; isDeleted?: boolean; text?: string; customData?: { mmLabel?: string; mmLatex?: string } | null };
  const out: string[] = [];
  for (const e of envelope.elements as El[]) {
    if (e.isDeleted) continue;
    if (e.type === 'text' && e.text?.trim()) out.push(e.text.trim());
    else if (e.type === 'image' && (e.customData?.mmLabel || e.customData?.mmLatex)) {
      out.push(e.customData.mmLabel ?? `$${e.customData.mmLatex}$`);
    }
  }
  for (const p of envelope.pending) {
    const label = p.label?.text ?? (typeof p.text === 'string' ? p.text : '');
    if (label.trim()) out.push(label.trim());
  }
  return out;
}

// ── Envelope parsing / migration ────────────────────────────────────────────

export type ParsedBoard =
  | { readonly kind: 'board'; readonly envelope: BoardEnvelope }
  | { readonly kind: 'legacy'; readonly doc: MindmapDoc };

/** Read the stored payload: an engine envelope, or a v1 doc to migrate. */
export function parseBoardData(json: string | null): ParsedBoard {
  if (json) {
    try {
      const raw = JSON.parse(json) as Record<string, unknown>;
      if (raw && raw['engine'] === 'excalidraw') {
        return {
          kind: 'board',
          envelope: {
            engine: 'excalidraw',
            version: 1,
            elements: Array.isArray(raw['elements']) ? (raw['elements'] as Record<string, unknown>[]) : [],
            files: (raw['files'] && typeof raw['files'] === 'object') ? (raw['files'] as Record<string, unknown>) : {},
            pending: Array.isArray(raw['pending']) ? (raw['pending'] as BoardSkeleton[]) : [],
          },
        };
      }
    } catch { /* fall through to the legacy parser, which never throws */ }
  }
  return { kind: 'legacy', doc: parseMindmapDoc(json ?? '') };
}

/** Any stored payload as an envelope, migrating a v1 doc into `pending`. */
export function toBoardEnvelope(json: string | null): BoardEnvelope {
  const parsed = parseBoardData(json);
  if (parsed.kind === 'board') return parsed.envelope;
  // A brand-new map's seed doc is one empty-ish root node — start blank
  // instead of materialising a lonely placeholder rectangle.
  const doc = parsed.doc;
  const isSeed = doc.nodes.length === 1 && doc.edges.length === 0;
  return {
    ...emptyBoardEnvelope(),
    pending: isSeed ? [] : legacyDocToSkeletons(doc),
  };
}

export function serializeBoardEnvelope(envelope: BoardEnvelope): string {
  return JSON.stringify(envelope);
}

// Re-exported so tool code can reason about legacy structure without
// importing the whole model surface.
export { childrenOf, primaryParent, rootOf };
