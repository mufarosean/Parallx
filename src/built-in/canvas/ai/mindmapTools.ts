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
//
// GROUNDING IS STRUCTURAL, NOT ADVISORY (field failure, 2026-08-30: asked to
// map the user's Meyers notes, a local model never read them and produced a
// generic "canvas notes" design map). A map OF EXISTING MATERIAL must name
// its source: `sourcePageId` reuses the M85 read-before-edit registry — the
// tool REFUSES to write a grounded map for a page the session has not read,
// and the refusal tells the model exactly how to recover. The editor door
// goes further: the source document's text travels INSIDE the prompt.

import type {
  IChatTool,
  IToolResult,
  ICancellationToken,
  IChatToolInvocationCallContext,
  ToolPermissionLevel,
} from '../../../services/chatTypes.js';
import { wasResourceSeen, pageResourceKey } from '../../../services/toolResourceRegistry.js';
import type { MindmapDataService } from '../mindmap/mindmapDataService.js';
import type { SendChatRequestFn } from '../menus/canvasMenuRegistry.js';
import type { MindmapDraftRequest, MindmapDraftResult } from '../mindmap/mindmapEditorPane.js';
import {
  MINDMAP_COLORS,
  type MindmapOutlineEdge,
  type MindmapOutlineNode,
} from '../mindmap/mindmapModel.js';
import {
  boardLabels,
  boardOutlineText,
  outlineToSkeletons,
  serializeBoardEnvelope,
  toBoardEnvelope,
} from '../mindmap/boardConvert.js';
import { emptyBoardEnvelope } from '../mindmap/boardTypes.js';

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
      label: { type: 'string', description: 'Short idea text (a few words, not a sentence). Inline math renders: e.g. "CCL: $f(d)c(w,d)$".' },
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

/**
 * The grounding rail, reusing M85's read-before-edit registry: a map that
 * claims a source the session never read is exactly how the "generic design
 * map instead of my Meyers notes" failure happens. The refusal names the
 * recovery so even a small local model can follow the chain.
 */
function requireSourceRead(
  sourcePageId: string,
  invocation: IChatToolInvocationCallContext | undefined,
): IToolResult | null {
  if (!invocation?.sessionId) return null; // headless callers manage their own grounding
  if (wasResourceSeen(invocation.sessionId, pageResourceKey(sourcePageId))) return null;
  return {
    content: `You have not read page ${sourcePageId} this session. `
      + 'Call canvas_read_page with that id first, then build the map from concepts that appear in its content.',
    isError: true,
  };
}

// ── The tools ───────────────────────────────────────────────────────────────

export function createMindmapTools(deps: IMindmapToolDeps): IChatTool[] {
  const { mindmaps, openMindmap } = deps;

  return [
    {
      name: 'mindmap_create',
      displaySummary: 'Create a mindmap of ideas.',
      description:
        'CREATE a mindmap — a visual map of IDEAS and how they relate (never of files, apps, or generic categories). '
        + 'When the user asks to map THEIR notes, a paper, or any existing page: (1) find it with canvas_find_pages, '
        + '(2) READ it with canvas_read_page, (3) pass its id as `sourcePageId` and build every node label from a '
        + 'concept that actually appears in that content. The tool refuses a sourced map you have not read. '
        + 'The root node is the SUBJECT of the material (e.g. "Bayesian MCMC Reserving"), never words like "notes". '
        + 'Give the root no parent and every other node a `parent`; use `edges` for cross-links like family '
        + 'membership. To extend an existing map use `mindmap_add`.',
      parameters: {
        type: 'object',
        required: ['title', 'nodes'],
        properties: {
          title: { type: 'string', description: 'Map title (also the page title).' },
          nodes: NODES_SCHEMA,
          edges: EDGES_SCHEMA,
          sourcePageId: {
            type: 'string',
            description: 'UUID of the page this map is grounded in. REQUIRED whenever the map is about existing '
              + 'notes/material. You must have read the page this session (canvas_read_page).',
          },
          parentPageId: { type: 'string', description: 'Optional UUID of an existing page to nest the map under. Defaults to the source page.' },
        },
      },
      requiresConfirmation: true,
      permissionLevel: 'requires-approval' as ToolPermissionLevel,
      category: 'canvas',
      async handler(args: Record<string, unknown>, _token: ICancellationToken, invocation?: IChatToolInvocationCallContext): Promise<IToolResult> {
        const title = String(args['title'] ?? '').trim();
        if (!title) return { content: 'Title is required.', isError: true };
        const { nodes, edges } = readOutlineArgs(args);
        if (nodes.length === 0) return { content: 'At least one node is required.', isError: true };

        const sourcePageId = typeof args['sourcePageId'] === 'string' && args['sourcePageId'] ? args['sourcePageId'] : null;
        const unread = sourcePageId ? requireSourceRead(sourcePageId, invocation) : null;
        if (unread) return unread;

        const parentPageId = typeof args['parentPageId'] === 'string' && args['parentPageId']
          ? args['parentPageId']
          : sourcePageId; // a grounded board nests under its source by default
        const page = await mindmaps.createMindmap({ title, parentId: parentPageId });

        // Headless author: skeletons wait in `pending`; the board host
        // materialises them (with real element ids and bindings) on open.
        const envelope = {
          ...emptyBoardEnvelope(),
          pending: outlineToSkeletons(nodes, edges),
        };
        await mindmaps.saveData(page.id, serializeBoardEnvelope(envelope), 'ai');
        openMindmap(page.id);
        return {
          content: `Created board "${title}" (id: ${page.id}) with ${envelope.pending.length} elements queued to draw.`,
        };
      },
    },

    {
      name: 'mindmap_add',
      displaySummary: 'Add ideas to an existing mindmap.',
      description:
        'ADD nodes/cross-links to an existing mindmap. Call `mindmap_read` first so you extend rather than repeat. '
        + 'When the additions come from existing notes/material, read that page and pass `sourcePageId` — the same '
        + 'grounding rule as mindmap_create. New nodes are placed automatically; nodes the user positioned are '
        + 'NEVER moved. `parent` may name any existing node by its label or id.',
      parameters: {
        type: 'object',
        required: ['pageId', 'nodes'],
        properties: {
          pageId: { type: 'string', description: 'The mindmap page id (from mindmap_create or canvas_find_pages).' },
          nodes: NODES_SCHEMA,
          edges: EDGES_SCHEMA,
          sourcePageId: {
            type: 'string',
            description: 'UUID of the page the additions are grounded in (must be read this session).',
          },
        },
      },
      requiresConfirmation: true,
      permissionLevel: 'requires-approval' as ToolPermissionLevel,
      category: 'canvas',
      async handler(args: Record<string, unknown>, _token: ICancellationToken, invocation?: IChatToolInvocationCallContext): Promise<IToolResult> {
        const addSource = typeof args['sourcePageId'] === 'string' && args['sourcePageId'] ? args['sourcePageId'] : null;
        const unread = addSource ? requireSourceRead(addSource, invocation) : null;
        if (unread) return unread;

        const pageId = String(args['pageId'] ?? '').trim();
        const data = pageId ? await mindmaps.getData(pageId) : null;
        if (data === null) return { content: `No mindmap board found for id "${pageId}".`, isError: true };

        const { nodes, edges } = readOutlineArgs(args);
        if (nodes.length === 0 && edges.length === 0) {
          return { content: 'Nothing to add — pass nodes and/or edges.', isError: true };
        }
        const envelope = toBoardEnvelope(data);
        const fresh = outlineToSkeletons(nodes, edges, boardLabels(envelope));
        if (fresh.length === 0) {
          return { content: 'Nothing new: every label already exists on the board. Read it with mindmap_read.', isError: true };
        }
        const next = { ...envelope, pending: [...envelope.pending, ...fresh] };
        await mindmaps.saveData(pageId, serializeBoardEnvelope(next), 'ai');
        openMindmap(pageId);
        return { content: `Queued ${fresh.length} new elements onto the board.` };
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
        const data = pageId ? await mindmaps.getData(pageId) : null;
        if (data === null) return { content: `No mindmap board found for id "${pageId}".`, isError: true };
        const text = boardOutlineText(toBoardEnvelope(data));
        return { content: text || '(the board is empty)' };
      },
    },
  ];
}

// ── The editor door (Draft With AI) ─────────────────────────────────────────

const DRAFT_SYSTEM_PROMPT =
  'You design mindmaps: short idea labels connected into a tree, plus cross-links where ideas relate across branches. '
  + 'Respond with ONLY a JSON object — no prose, no code fences: '
  + '{"nodes":[{"label":"…","parent":"…"}],"edges":[{"from":"…","to":"…","label":"…"}]} '
  + 'Labels may carry inline $LaTeX$ for formulas. Rules: labels are a FEW WORDS, never sentences. Every node except one root has a "parent" naming another label. '
  + 'When extending an existing map, parent new nodes onto the EXISTING labels given, and never repeat existing labels. '
  + 'Use "edges" only for genuine cross-branch relations, with a one-or-two-word label. '
  + 'When SOURCE MATERIAL is provided, every label must be a concept that appears in it — no invented categories, '
  + 'no generic scaffold (never "Notes", "Ideas", "References", "To-Do"). The root is the subject of the material.';

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

/** Source excerpts are budgeted so a long paper never blows the context. */
const SOURCE_CHAR_BUDGET = 9000;

function clampSource(text: string): string {
  const t = text.trim();
  if (t.length <= SOURCE_CHAR_BUDGET) return t;
  return t.slice(0, SOURCE_CHAR_BUDGET) + '\n\u2026[truncated]';
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
  const parts: string[] = [];
  if (req.sourceText?.trim()) {
    parts.push(
      `SOURCE MATERIAL${req.sourceTitle ? ` \u2014 "${req.sourceTitle}"` : ''} (map its concepts, nothing else):\n`
      + clampSource(req.sourceText),
    );
  }
  parts.push(req.outlineText.trim()
    ? `The map "${req.title}" currently contains:\n${req.outlineText}\n\nExtend it \u2014 do not repeat existing labels.`
    : `The map "${req.title}" is empty.`);
  const context = parts.join('\n\n');
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
