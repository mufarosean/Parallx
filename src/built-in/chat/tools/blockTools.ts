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
} from '../../../services/chatTypes.js';
import type { IBuiltInToolDatabase, PageMutationNotifier } from '../chatTypes.js';
import {
  decodeDocContent,
  encodeDocContent,
  findBlockById,
  nodeToPlainText,
  replaceAt,
  insertAfter,
  paragraphFromText,
  generateBlockId,
} from './blockApi.js';

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
    description: 'Read a single block from a CANVAS PAGE by blockId. Returns block JSON and plaintext. Operates on the canvas page DB only.',
    parameters: {
      type: 'object',
      required: ['pageId', 'blockId'],
      properties: {
        pageId: { type: 'string' },
        blockId: { type: 'string' },
      },
    },
    requiresConfirmation: false,
    permissionLevel: 'always-allowed' as ToolPermissionLevel,
    async handler(args: Record<string, unknown>, _token: ICancellationToken): Promise<IToolResult> {
      requireDb(db);
      const pageId = String(args['pageId'] || '');
      const blockId = String(args['blockId'] || '');
      if (!pageId || !blockId) return { content: 'pageId and blockId are required', isError: true };

      const page = await loadPageDoc(db!, pageId);
      if (!page) return { content: `Page "${pageId}" not found.`, isError: true };
      if (!page.doc) return { content: `Page "${pageId}" has no decodable doc content.`, isError: true };

      const hit = findBlockById(page.doc, blockId);
      if (!hit) return { content: `Block "${blockId}" not found in page "${page.title}".`, isError: true };

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
    description: 'Replace the plain-text content of a single block inside a CANVAS PAGE. Operates on the canvas page DB. For file edits use `edit_file`.',
    parameters: {
      type: 'object',
      required: ['pageId', 'blockId', 'newContent'],
      properties: {
        pageId: { type: 'string' },
        blockId: { type: 'string' },
        newContent: { type: 'string', description: 'Replacement text.' },
        idempotencyKey: { type: 'string', description: 'Dedup key.' },
      },
    },
    requiresConfirmation: true,
    permissionLevel: 'requires-approval' as ToolPermissionLevel,
    async handler(args: Record<string, unknown>, _token: ICancellationToken): Promise<IToolResult> {
      requireDb(db);
      const pageId = String(args['pageId'] || '');
      const blockId = String(args['blockId'] || '');
      const newContent = String(args['newContent'] ?? '');
      const idempotencyKey = args['idempotencyKey'] ? String(args['idempotencyKey']) : null;
      if (!pageId || !blockId) return { content: 'pageId and blockId are required', isError: true };

      const page = await loadPageDoc(db!, pageId);
      if (!page) return { content: `Page "${pageId}" not found.`, isError: true };
      if (!page.doc) return { content: `Page "${pageId}" has no decodable doc content.`, isError: true };

      const hit = findBlockById(page.doc, blockId);
      if (!hit) return { content: `Block "${blockId}" not found in page "${page.title}".`, isError: true };

      const before = nodeToPlainText(hit.node);
      const replacement = paragraphFromText(newContent, blockId);
      const newDoc = replaceAt(page.doc, hit.path, replacement);
      await persistDoc(db!, pageId, newDoc, notifyPageMutated);

      const keyNote = idempotencyKey ? `\n\n_idempotencyKey: ${idempotencyKey}_` : '';
      return {
        content:
          `Edited block ${blockId} in **${page.title}**.\n\n` +
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
    description: 'Insert a new paragraph block into a CANVAS PAGE, immediately after anchorBlockId. Returns the new blockId. Operates on the canvas page DB.',
    parameters: {
      type: 'object',
      required: ['pageId', 'anchorBlockId', 'content'],
      properties: {
        pageId: { type: 'string' },
        anchorBlockId: { type: 'string' },
        content: { type: 'string', description: 'Block text.' },
        idempotencyKey: { type: 'string', description: 'Dedup key.' },
      },
    },
    requiresConfirmation: true,
    permissionLevel: 'requires-approval' as ToolPermissionLevel,
    async handler(args: Record<string, unknown>, _token: ICancellationToken): Promise<IToolResult> {
      requireDb(db);
      const pageId = String(args['pageId'] || '');
      const anchorId = String(args['anchorBlockId'] || '');
      const content = String(args['content'] ?? '');
      const idempotencyKey = args['idempotencyKey'] ? String(args['idempotencyKey']) : null;
      if (!pageId || !anchorId) return { content: 'pageId and anchorBlockId are required', isError: true };

      const page = await loadPageDoc(db!, pageId);
      if (!page) return { content: `Page "${pageId}" not found.`, isError: true };
      if (!page.doc) return { content: `Page "${pageId}" has no decodable doc content.`, isError: true };

      const hit = findBlockById(page.doc, anchorId);
      if (!hit) return { content: `Anchor block "${anchorId}" not found in page "${page.title}".`, isError: true };
      if (hit.path.length === 0) {
        return { content: 'Cannot insert after the document root.', isError: true };
      }

      const newBlockId = generateBlockId();
      const newNode = paragraphFromText(content, newBlockId);
      const newDoc = insertAfter(page.doc, hit.path, newNode);
      await persistDoc(db!, pageId, newDoc, notifyPageMutated);

      const keyNote = idempotencyKey ? `\n\n_idempotencyKey: ${idempotencyKey}_` : '';
      return {
        content:
          `Inserted new block after ${anchorId} in **${page.title}**.\n\n` +
          `**New blockId:** ${newBlockId}\n` +
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
    description: 'Append a cross-reference link from one CANVAS PAGE block to another. Operates on the canvas page DB.',
    parameters: {
      type: 'object',
      required: ['fromPageId', 'fromBlockId', 'toPageId', 'toBlockId'],
      properties: {
        fromPageId: { type: 'string' },
        fromBlockId: { type: 'string' },
        toPageId: { type: 'string' },
        toBlockId: { type: 'string' },
        label: { type: 'string', description: 'Link text; defaults to target page title.' },
      },
    },
    requiresConfirmation: true,
    permissionLevel: 'requires-approval' as ToolPermissionLevel,
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
