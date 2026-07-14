// blockTools.ts — M60 Phase δ T3 block-level + property query tools
//
// Implements the 5 tools specified in M60 §6.2:
//   • pages.query_by_property  — multi-filter / sort / group property query
//   • pages.read_block         — read one block by stable id
//   • pages.edit_block         — replace block content (idempotency-keyed)
//   • pages.insert_block_after — insert a block after an anchor
//   • pages.link_block         — create a cross-block link
//
// Block IDs are persisted in the TipTap doc via `@tiptap/extension-unique-id`
// (see src/built-in/canvas/config/tiptapExtensions.ts UNIQUE_ID_BLOCK_TYPES).
// Edit / insert tools mutate the persisted page.content envelope and bump
// the `pages.revision` counter so the renderer's optimistic-concurrency
// gate (canvasDataService._knownRevisions) detects external writes.
//
// Idempotency (M60 §3.7): edit_block + insert_block_after carry an
// optional `idempotencyKey`. The handler stamps the key into the result
// for autonomy-log capture; deduplication itself is owned by the chat
// runner / autonomy event log, not the tool.

import type {
  IChatTool,
  IToolResult,
  ICancellationToken,
  ToolPermissionLevel,
  IChatToolInvocationCallContext,
} from '../../../services/chatTypes.js';
import type { IBuiltInToolDatabase, PageMutationNotifier } from '../../chat/chatTypes.js';
import { markResourceSeen, wasResourceSeen, pageResourceKey } from '../../../services/toolResourceRegistry.js';
import {
  decodeDocContent,
  encodeDocContent,
  findBlockById,
  nodeToPlainText,
  replaceWithMany,
  insertAfter,
  insertManyAfter,
  paragraphFromText,
  generateBlockId,
  type DocNode,
} from './blockApi.js';
import { markdownToTiptapJson } from '../markdownImport.js';

/** Parse markdown into canvas block nodes (each stamped with a stable id). */
function markdownToBlocks(markdown: string): DocNode[] {
  const doc = markdownToTiptapJson(markdown, { assignBlockIds: true });
  return (doc.content ?? []) as unknown as DocNode[];
}

function requireDb(db: IBuiltInToolDatabase | undefined): asserts db is IBuiltInToolDatabase {
  if (!db || !db.isOpen) throw new Error('Database is not available');
}

// ─── C3 helpers: persist a mutated doc + bump revision ──────────────────

async function loadPageDoc(
  db: IBuiltInToolDatabase,
  pageId: string,
): Promise<{ title: string; content: string; revision: number; doc: ReturnType<typeof decodeDocContent> } | null> {
  const row = await db.get<{ id: string; title: string; content: string; revision: number }>(
    'SELECT id, title, content, revision FROM pages WHERE id = ?',
    [pageId],
  );
  if (!row) return null;
  const doc = decodeDocContent(row.content);
  return { title: row.title, content: row.content, revision: row.revision ?? 1, doc };
}

async function persistDoc(
  db: IBuiltInToolDatabase,
  pageId: string,
  doc: NonNullable<ReturnType<typeof decodeDocContent>>,
  notifyPageMutated?: PageMutationNotifier,
): Promise<void> {
  const stored = encodeDocContent(doc);
  const now = new Date().toISOString();
  await db.run(
    'UPDATE pages SET content = ?, updated_at = ?, revision = revision + 1 WHERE id = ?',
    [stored, now, pageId],
  );
  // Notify the canvas data service so the sidebar refreshes and any open
  // editor reloads its content. Never block the SQL write on notifier errors.
  try { notifyPageMutated?.(pageId, 'updated'); } catch { /* swallow */ }
}

// ─── C3.a: pages.read_block ─────────────────────────────────────────────

export function createReadBlockTool(db: IBuiltInToolDatabase | undefined): IChatTool {
  return {
    name: 'canvas_read_block',
    displaySummary: 'Read a single block from a canvas page.',
    description: 'Read a single block from a CANVAS PAGE by blockId. Returns block JSON and plaintext. Operates on the canvas page DB only. Block IDs come from a prior canvas_read_page call (each block has an `id` attribute).',
    parameters: {
      type: 'object',
      required: ['pageId', 'blockId'],
      properties: {
        pageId: { type: 'string', description: 'Page UUID (not a title). Resolve titles with canvas_find_pages first.' },
        blockId: { type: 'string', description: 'Block ID as it appears in the page\'s Tiptap doc (obtained from canvas_read_page).' },
      },
    },
    requiresConfirmation: false,
    permissionLevel: 'always-allowed' as ToolPermissionLevel,
    category: 'canvas',
    async handler(args: Record<string, unknown>, _token: ICancellationToken, invocation?: IChatToolInvocationCallContext): Promise<IToolResult> {
      requireDb(db);
      const pageId = String(args['pageId'] || '');
      const blockId = String(args['blockId'] || '');
      if (!pageId || !blockId) return { content: 'pageId and blockId are required', isError: true };

      const page = await loadPageDoc(db!, pageId);
      if (!page) return { content: `Page "${pageId}" not found.`, isError: true };
      if (!page.doc) return { content: `Page "${pageId}" has no decodable doc content.`, isError: true };

      const hit = findBlockById(page.doc, blockId);
      if (!hit) return { content: `Block "${blockId}" not found in page "${page.title}".`, isError: true };

      // M85 Slice C — block ids only come from a page read, and this read
      // shows current content: mark the page seen for the mutation tools.
      if (invocation?.sessionId) {
        markResourceSeen(invocation.sessionId, pageResourceKey(pageId));
      }

      const text = nodeToPlainText(hit.node);
      const json = JSON.stringify(hit.node, null, 2);
      return {
        content:
          `**Block** ${blockId} (type: ${hit.node.type}) in **${page.title}**\n\n` +
          `**Text:**\n${text || '(empty)'}\n\n` +
          `**JSON:**\n\`\`\`json\n${json}\n\`\`\``,
      };
    },
  };
}

// ─── C3.b: pages.edit_block ─────────────────────────────────────────────

export function createEditBlockTool(
  db: IBuiltInToolDatabase | undefined,
  notifyPageMutated?: PageMutationNotifier,
): IChatTool {
  return {
    name: 'canvas_edit_block',
    displaySummary: 'Replace a block on a canvas page (approval).',
    description: 'Replace a single block inside a CANVAS PAGE. `newContent` is parsed as MARKDOWN, so the block takes the RIGHT type: `## X` → heading, `- [ ] X` → to-do, `- X` → bullet, `1. X` → numbered, `> [!note] …` → callout, `> X` → quote, fenced code → code block. It may expand into several blocks (e.g. a multi-line list); the primary block keeps its blockId. Operates on the canvas page DB — for file edits use `fs_edit_file`; for whole-page authoring use canvas_edit_page.',
    parameters: {
      type: 'object',
      required: ['pageId', 'blockId', 'newContent'],
      properties: {
        pageId: { type: 'string', description: 'Page UUID (not a title). Resolve titles with canvas_find_pages first.' },
        blockId: { type: 'string', description: 'Block ID to replace (from canvas_read_page).' },
        newContent: { type: 'string', description: 'Markdown for the replacement block(s). Parsed to the correct block type(s) — heading / list / to-do / callout / quote / code. The first block keeps the original blockId.' },
        idempotencyKey: { type: 'string', description: 'Optional dedup key so retried calls don\'t double-edit on transient failures.' },
      },
    },
    requiresConfirmation: true,
    permissionLevel: 'requires-approval' as ToolPermissionLevel,
    category: 'canvas',
    async handler(args: Record<string, unknown>, _token: ICancellationToken, invocation?: IChatToolInvocationCallContext): Promise<IToolResult> {
      requireDb(db);
      const pageId = String(args['pageId'] || '');
      const blockId = String(args['blockId'] || '');
      const newContent = String(args['newContent'] ?? '');
      const idempotencyKey = args['idempotencyKey'] ? String(args['idempotencyKey']) : null;
      if (!pageId || !blockId) return { content: 'pageId and blockId are required', isError: true };

      // M85 Slice C — read-before-edit (canvas). Block ids come from a page
      // read; a block edit without one is working from stale context.
      if (invocation?.sessionId && !wasResourceSeen(invocation.sessionId, pageResourceKey(pageId))) {
        return {
          content: `You have not read page ${pageId} this session. `
            + `Read it first with canvas_read_page (or canvas_read_block), then retry with a block id from the CURRENT content.`,
          isError: true,
        };
      }

      const page = await loadPageDoc(db!, pageId);
      if (!page) return { content: `Page "${pageId}" not found.`, isError: true };
      if (!page.doc) return { content: `Page "${pageId}" has no decodable doc content.`, isError: true };

      const hit = findBlockById(page.doc, blockId);
      if (!hit) return { content: `Block "${blockId}" not found in page "${page.title}".`, isError: true };

      const before = nodeToPlainText(hit.node);
      // Parse markdown so the block adopts the correct type(s). Keep the
      // original blockId on the first block so anchors/links to it stay stable.
      const blocks = markdownToBlocks(newContent);
      if (blocks.length > 0) {
        blocks[0]!.attrs = { ...(blocks[0]!.attrs ?? {}), id: blockId };
      }
      const newDoc = replaceWithMany(page.doc, hit.path, blocks);
      await persistDoc(db!, pageId, newDoc, notifyPageMutated);

      const expanded = blocks.length > 1 ? ` (expanded into ${blocks.length} blocks)` : '';
      const keyNote = idempotencyKey ? `\n\n_idempotencyKey: ${idempotencyKey}_` : '';
      return {
        content:
          `Edited block ${blockId} in **${page.title}**${expanded}.\n\n` +
          `**Before:** ${before || '(empty)'}\n` +
          `**After:**  ${newContent || '(empty)'}` +
          keyNote,
      };
    },
  };
}

// ─── C3.c: pages.insert_block_after ─────────────────────────────────────

export function createInsertBlockAfterTool(
  db: IBuiltInToolDatabase | undefined,
  notifyPageMutated?: PageMutationNotifier,
): IChatTool {
  return {
    name: 'canvas_insert_block_after',
    displaySummary: 'Insert a block into a canvas page (approval).',
    description: 'Insert one or more new blocks into a CANVAS PAGE, immediately after anchorBlockId. `content` is parsed as MARKDOWN, so blocks take the RIGHT type: headings, bullet/numbered lists, to-dos (`- [ ]`), callouts (`> [!note]`), quotes, fenced code. Returns the new blockId(s). Operates on the canvas page DB.',
    parameters: {
      type: 'object',
      required: ['pageId', 'anchorBlockId', 'content'],
      properties: {
        pageId: { type: 'string', description: 'Page UUID (not a title). Resolve titles with canvas_find_pages first.' },
        anchorBlockId: { type: 'string', description: 'Block ID after which the new block(s) are inserted (from canvas_read_page).' },
        content: { type: 'string', description: 'Markdown for the new block(s) — parsed to the correct block type(s): heading / list / to-do / callout / quote / code.' },
        idempotencyKey: { type: 'string', description: 'Optional dedup key so retried calls don\'t double-insert.' },
      },
    },
    requiresConfirmation: true,
    permissionLevel: 'requires-approval' as ToolPermissionLevel,
    category: 'canvas',
    async handler(args: Record<string, unknown>, _token: ICancellationToken, invocation?: IChatToolInvocationCallContext): Promise<IToolResult> {
      requireDb(db);
      const pageId = String(args['pageId'] || '');
      const anchorId = String(args['anchorBlockId'] || '');
      const content = String(args['content'] ?? '');
      const idempotencyKey = args['idempotencyKey'] ? String(args['idempotencyKey']) : null;
      if (!pageId || !anchorId) return { content: 'pageId and anchorBlockId are required', isError: true };

      // M85 Slice C — read-before-edit (canvas): anchor ids come from a page read.
      if (invocation?.sessionId && !wasResourceSeen(invocation.sessionId, pageResourceKey(pageId))) {
        return {
          content: `You have not read page ${pageId} this session. `
            + `Read it first with canvas_read_page, then retry with an anchor block id from the CURRENT content.`,
          isError: true,
        };
      }

      const page = await loadPageDoc(db!, pageId);
      if (!page) return { content: `Page "${pageId}" not found.`, isError: true };
      if (!page.doc) return { content: `Page "${pageId}" has no decodable doc content.`, isError: true };

      const hit = findBlockById(page.doc, anchorId);
      if (!hit) return { content: `Anchor block "${anchorId}" not found in page "${page.title}".`, isError: true };
      if (hit.path.length === 0) {
        return { content: 'Cannot insert after the document root.', isError: true };
      }

      // Parse markdown so inserted blocks get the correct type(s).
      const blocks = markdownToBlocks(content);
      const newDoc = insertManyAfter(page.doc, hit.path, blocks);
      await persistDoc(db!, pageId, newDoc, notifyPageMutated);

      const newBlockIds = blocks.map((b) => (b.attrs?.['id'] as string) || '').filter(Boolean);
      const keyNote = idempotencyKey ? `\n\n_idempotencyKey: ${idempotencyKey}_` : '';
      return {
        content:
          `Inserted ${blocks.length} block${blocks.length === 1 ? '' : 's'} after ${anchorId} in **${page.title}**.\n\n` +
          `**New blockId${newBlockIds.length === 1 ? '' : 's'}:** ${newBlockIds.join(', ') || '(none)'}\n` +
          `**Content:** ${content || '(empty)'}` +
          keyNote,
      };
    },
  };
}

// ─── C3.d: pages.link_block ─────────────────────────────────────────────

export function createLinkBlockTool(
  db: IBuiltInToolDatabase | undefined,
  notifyPageMutated?: PageMutationNotifier,
): IChatTool {
  return {
    name: 'canvas_link_block',
    displaySummary: 'Cross-link two canvas blocks (approval).',
    description: 'Insert a new paragraph BELOW `fromBlockId` (on the source page) that contains a clickable link pointing at `toBlockId` on the target page. Operates on the canvas page DB. Use this when the user asks "link the part about X to the page on Y" — two existing blocks on two existing pages.',
    parameters: {
      type: 'object',
      required: ['fromPageId', 'fromBlockId', 'toPageId', 'toBlockId'],
      properties: {
        fromPageId: { type: 'string', description: 'Source page UUID (where the link appears). Resolve titles with canvas_find_pages first.' },
        fromBlockId: { type: 'string', description: 'Anchor block on the source page; the link is inserted immediately after this block.' },
        toPageId: { type: 'string', description: 'Target page UUID (what the link points to).' },
        toBlockId: { type: 'string', description: 'Target block on the target page (the link\'s destination anchor).' },
        label: { type: 'string', description: 'Display text shown for the link. Defaults to the target page title when omitted.' },
      },
    },
    requiresConfirmation: true,
    permissionLevel: 'requires-approval' as ToolPermissionLevel,
    category: 'canvas',
    async handler(args: Record<string, unknown>, _token: ICancellationToken): Promise<IToolResult> {
      requireDb(db);
      const fromPageId = String(args['fromPageId'] || '');
      const fromBlockId = String(args['fromBlockId'] || '');
      const toPageId = String(args['toPageId'] || '');
      const toBlockId = String(args['toBlockId'] || '');
      const labelArg = args['label'] ? String(args['label']) : '';
      if (!fromPageId || !fromBlockId || !toPageId || !toBlockId) {
        return { content: 'fromPageId, fromBlockId, toPageId, toBlockId are all required', isError: true };
      }

      const fromPage = await loadPageDoc(db!, fromPageId);
      if (!fromPage || !fromPage.doc) {
        return { content: `Source page "${fromPageId}" not found or has no doc content.`, isError: true };
      }
      const fromHit = findBlockById(fromPage.doc, fromBlockId);
      if (!fromHit) {
        return { content: `Source block "${fromBlockId}" not found in source page.`, isError: true };
      }

      const toRow = await db!.get<{ id: string; title: string; content: string }>(
        'SELECT id, title, content FROM pages WHERE id = ?',
        [toPageId],
      );
      if (!toRow) return { content: `Target page "${toPageId}" not found.`, isError: true };
      const toDoc = decodeDocContent(toRow.content);
      if (!toDoc) return { content: `Target page "${toPageId}" has no decodable doc content.`, isError: true };
      if (!findBlockById(toDoc, toBlockId)) {
        return { content: `Target block "${toBlockId}" not found in target page.`, isError: true };
      }

      const label = labelArg || toRow.title || toBlockId;
      // Append a paragraph block carrying the link below the source block.
      // We do not modify the source block itself to keep the round-trip
      // diff localized.
      const linkBlockId = generateBlockId();
      const linkText = `→ [${label}](page://${toPageId}#${toBlockId})`;
      const linkNode = paragraphFromText(linkText, linkBlockId);
      const newDoc = insertAfter(fromPage.doc, fromHit.path, linkNode);
      await persistDoc(db!, fromPageId, newDoc, notifyPageMutated);

      return {
        content:
          `Linked block ${fromBlockId} → ${toBlockId} (page "${toRow.title}").\n\n` +
          `**Link block:** ${linkBlockId}\n` +
          `**Label:** ${label}`,
      };
    },
  };
}

// ─── Aggregate factory ──────────────────────────────────────────────────

export function createBlockTools(
  db: IBuiltInToolDatabase | undefined,
  notifyPageMutated?: PageMutationNotifier,
): IChatTool[] {
  return [
    createReadBlockTool(db),
    createEditBlockTool(db, notifyPageMutated),
    createInsertBlockAfterTool(db, notifyPageMutated),
    createLinkBlockTool(db, notifyPageMutated),
  ];
}

/** Stable list of tool names registered by createBlockTools — used by
 * tests and documentation to detect drift. */
export const BLOCK_TOOL_NAMES = [
  'canvas_read_block',
  'canvas_edit_block',
  'canvas_insert_block_after',
  'canvas_link_block',
] as const;
