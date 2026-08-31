// mindmapTools.ts — the AI's doors into mindmaps (docs/MINDMAP_BRIEF.md, D3).
//
//   mindmap_create — new map from an outline (nodes with parents, cross-links)
//   mindmap_add    — extend an existing map; NEVER moves what the user placed
//   mindmap_read   — the map as an indented outline, so the model extends
//                    instead of repeating
//
// "Both doors, one implementation": the chat tools and the editor's Draft
// With AI button both end in mergeOutline/layout from mindmapModel. In the
// chat door the CALLING model authors the outline (tool args). In the editor
// door `draftMindmapOutline` below runs the LM itself and parses the same
// outline shape. Neither door owns layout — the model module does.

import type {
  IChatTool,
  IToolResult,
  ICancellationToken,
  ToolPermissionLevel,
} from '../../../services/chatTypes.js';
import type { MindmapDataService } from '../mindmap/mindmapDataService.js';
import type { SendChatRequestFn } from '../menus/canvasMenuRegistry.js';
import type { MindmapDraftRequest, MindmapDraftResult } from '../mindmap/mindmapEditorPane.js';
import {
  assignBranchColors,
  autoLayout,
  layoutNewNodes,
  mergeOutline,
  docToOutlineText,
  emptyMindmapDoc,
  MINDMAP_COLORS,
  type MindmapOutlineEdge,
  type MindmapOutlineNode,
} from '../mindmap/mindmapModel.js';

export interface IMindmapToolDeps {
  readonly mindmaps: MindmapDataService;
  /** Open the map so the user sees what the tool did. */
  readonly openMindmap: (pageId: string) => void;
}

// ── Outline argument parsing (shared by both create and add) ────────────────

const NODES_SCHEMA = {
  type: 'array',
  description:
    'The ideas. Each: {label, parent?, id?, color?, refPageId?}. `parent` is the label or id of another node '
    + '(from this list or already in the map) — set it for every node except the root so the map has structure. '
    + `color: one of ${MINDMAP_COLORS.join('|')} (omit to auto-color by branch). refPageId: UUID of a workspace page this idea is anchored to.`,
  items: {
    type: 'object',
    required: ['label'],
    properties: {
      label: { type: 'string', description: 'Short idea text (a few words, not a sentence).' },
      parent: { type: 'string', description: 'Label or id of the parent node.' },
      id: { type: 'string', description: 'Optional stable id, referenced by `parent`/`edges`.' },
      color: { type: 'string', enum: [...MINDMAP_COLORS] },
      refPageId: { type: 'string' },
    },
  },
} as const;

const EDGES_SCHEMA = {
  type: 'array',
  description:
    'Optional CROSS-LINKS beyond the parent tree (e.g. two models both belonging to a family). '
    + 'Each: {from, to, label?} using node labels or ids.',
  items: {
    type: 'object',
    required: ['from', 'to'],
    properties: {
      from: { type: 'string' },
      to: { type: 'string' },
      label: { type: 'string', description: 'Short relation text shown on the link.' },
    },
  },
} as const;

function readOutlineArgs(args: Record<string, unknown>): {
  nodes: MindmapOutlineNode[];
  edges: MindmapOutlineEdge[];
} {
  const nodes: MindmapOutlineNode[] = [];
  if (Array.isArray(args['nodes'])) {
    for (const raw of args['nodes'] as Record<string, unknown>[]) {
      if (!raw || typeof raw['label'] !== 'string') continue;
      nodes.push({
        label: raw['label'],
        id: typeof raw['id'] === 'string' ? raw['id'] : undefined,
        parent: typeof raw['parent'] === 'string' ? raw['parent'] : undefined,
        color: typeof raw['color'] === 'string' ? raw['color'] : undefined,
        refPageId: typeof raw['refPageId'] === 'string' ? raw['refPageId'] : undefined,
      });
    }
  }
  const edges: MindmapOutlineEdge[] = [];
  if (Array.isArray(args['edges'])) {
    for (const raw of args['edges'] as Record<string, unknown>[]) {
      if (!raw || typeof raw['from'] !== 'string' || typeof raw['to'] !== 'string') continue;
      edges.push({
        from: raw['from'],
        to: raw['to'],
        label: typeof raw['label'] === 'string' ? raw['label'] : undefined,
      });
    }
  }
  return { nodes, edges };
}

// ── The tools ───────────────────────────────────────────────────────────────

export function createMindmapTools(deps: IMindmapToolDeps): IChatTool[] {
  const { mindmaps, openMindmap } = deps;

  return [
    {
      name: 'mindmap_create',
      displaySummary: 'Create a mindmap of ideas.',
      description:
        'CREATE a mindmap — a visual map of IDEAS and how they relate (not a page of prose). '
        + 'Give the central idea as the first node (no parent) and every other node a `parent`. '
        + 'Use `edges` for cross-links like family membership. The map opens for the user; they can rearrange it. '
        + 'To extend an existing map use `mindmap_add`.',
      parameters: {
        type: 'object',
        required: ['title', 'nodes'],
        properties: {
          title: { type: 'string', description: 'Map title (also the page title).' },
          nodes: NODES_SCHEMA,
          edges: EDGES_SCHEMA,
          parentPageId: { type: 'string', description: 'Optional UUID of an existing page to nest the map under.' },
        },
      },
      requiresConfirmation: true,
      permissionLevel: 'requires-approval' as ToolPermissionLevel,
      category: 'canvas',
      async handler(args: Record<string, unknown>, _token: ICancellationToken): Promise<IToolResult> {
        const title = String(args['title'] ?? '').trim();
        if (!title) return { content: 'Title is required.', isError: true };
        const { nodes, edges } = readOutlineArgs(args);
        if (nodes.length === 0) return { content: 'At least one node is required.', isError: true };

        const parentPageId = typeof args['parentPageId'] === 'string' && args['parentPageId'] ? args['parentPageId'] : null;
        const page = await mindmaps.createMindmap({ title, parentId: parentPageId });

        // A fresh map has one seed root; if the outline brings its own root,
        // start from empty instead so the seed doesn't dangle beside it.
        const base = { ...emptyMindmapDoc(title), nodes: [], edges: [] };
        const merged = mergeOutline(base, nodes, edges);
        const doc = assignBranchColors(autoLayout(merged.doc));
        await mindmaps.saveDoc(page.id, doc, 'ai');
        openMindmap(page.id);
        return {
          content: `Created mindmap "${title}" (id: ${page.id}) with ${merged.newNodeIds.length} nodes`
            + (merged.skipped.length ? ` (${merged.skipped.length} skipped)` : '') + '.',
        };
      },
    },

    {
      name: 'mindmap_add',
      displaySummary: 'Add ideas to an existing mindmap.',
      description:
        'ADD nodes/cross-links to an existing mindmap. Call `mindmap_read` first so you extend rather than repeat. '
        + 'New nodes are placed automatically; nodes the user positioned are NEVER moved. '
        + '`parent` may name any existing node by its label or id.',
      parameters: {
        type: 'object',
        required: ['pageId', 'nodes'],
        properties: {
          pageId: { type: 'string', description: 'The mindmap page id (from mindmap_create or canvas_find_pages).' },
          nodes: NODES_SCHEMA,
          edges: EDGES_SCHEMA,
        },
      },
      requiresConfirmation: true,
      permissionLevel: 'requires-approval' as ToolPermissionLevel,
      category: 'canvas',
      async handler(args: Record<string, unknown>, _token: ICancellationToken): Promise<IToolResult> {
        const pageId = String(args['pageId'] ?? '').trim();
        const doc = pageId ? await mindmaps.getDoc(pageId) : null;
        if (!doc) return { content: `No mindmap found for id "${pageId}".`, isError: true };

        const { nodes, edges } = readOutlineArgs(args);
        if (nodes.length === 0 && edges.length === 0) {
          return { content: 'Nothing to add — pass nodes and/or edges.', isError: true };
        }
        const merged = mergeOutline(doc, nodes, edges);
        if (merged.newNodeIds.length === 0 && merged.doc.edges.length === doc.edges.length) {
          return { content: 'Nothing new: every node/edge already exists.', isError: true };
        }
        const next = layoutNewNodes(merged.doc, new Set(merged.newNodeIds));
        await mindmaps.saveDoc(pageId, next, 'ai');
        openMindmap(pageId);
        return {
          content: `Added ${merged.newNodeIds.length} nodes and ${merged.doc.edges.length - doc.edges.length} edges`
            + (merged.skipped.length ? ` (${merged.skipped.length} skipped)` : '') + '.',
        };
      },
    },

    {
      name: 'mindmap_read',
      displaySummary: 'Read a mindmap as an outline.',
      description:
        'READ a mindmap as an indented outline with node ids and cross-links. '
        + 'Call before `mindmap_add` so additions extend the existing structure.',
      parameters: {
        type: 'object',
        required: ['pageId'],
        properties: {
          pageId: { type: 'string', description: 'The mindmap page id.' },
        },
      },
      requiresConfirmation: false,
      permissionLevel: 'always-allowed' as ToolPermissionLevel,
      category: 'canvas',
      async handler(args: Record<string, unknown>, _token: ICancellationToken): Promise<IToolResult> {
        const pageId = String(args['pageId'] ?? '').trim();
        const doc = pageId ? await mindmaps.getDoc(pageId) : null;
        if (!doc) return { content: `No mindmap found for id "${pageId}".`, isError: true };
        return { content: docToOutlineText(doc) };
      },
    },
  ];
}

// ── The editor door (Draft With AI) ─────────────────────────────────────────

const DRAFT_SYSTEM_PROMPT =
  'You design mindmaps: short idea labels connected into a tree, plus cross-links where ideas relate across branches. '
  + 'Respond with ONLY a JSON object — no prose, no code fences: '
  + '{"nodes":[{"label":"…","parent":"…"}],"edges":[{"from":"…","to":"…","label":"…"}]} '
  + 'Rules: labels are a FEW WORDS, never sentences. Every node except one root has a "parent" naming another label. '
  + 'When extending an existing map, parent new nodes onto the EXISTING labels given, and never repeat existing labels. '
  + 'Use "edges" only for genuine cross-branch relations, with a one-or-two-word label.';

/** Pull the first JSON object out of a model response (fences tolerated). */
export function extractOutlineJson(text: string): { nodes: MindmapOutlineNode[]; edges: MindmapOutlineEdge[] } | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) {
      try {
        const parsed = JSON.parse(text.slice(start, i + 1)) as Record<string, unknown>;
        const { nodes, edges } = readOutlineArgs(parsed);
        return nodes.length > 0 ? { nodes, edges } : null;
      } catch {
        return null;
      }
    }
  }
  return null;
}

/**
 * The Draft With AI button's implementation: one LM call, strict-JSON
 * outline out, parsed into the same shape the chat tools consume. The pane
 * does the merging — this function never touches the document.
 */
export async function draftMindmapOutline(
  send: SendChatRequestFn,
  req: MindmapDraftRequest,
): Promise<MindmapDraftResult> {
  const context = req.outlineText.trim()
    ? `The map "${req.title}" currently contains:\n${req.outlineText}\n\nExtend it — do not repeat existing labels.`
    : `The map "${req.title}" is empty.`;
  const stream = send(
    [
      { role: 'system', content: DRAFT_SYSTEM_PROMPT },
      { role: 'user', content: `${context}\n\nRequest: ${req.instruction}` },
    ],
    { temperature: 0.4 },
  );
  let text = '';
  for await (const chunk of stream) {
    if (chunk.content) text += chunk.content;
  }
  const outline = extractOutlineJson(text);
  if (!outline) throw new Error('The model did not return a usable outline — try rephrasing.');
  return outline;
}
