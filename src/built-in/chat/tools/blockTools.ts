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
import type { IBuiltInToolDatabase } from '../chatTypes.js';
import {
  decodeDocContent,
  encodeDocContent,
  findBlockById,
  nodeToPlainText,
  replaceAt,
  insertAfter,
  paragraphFromText,
  generateBlockId,
  filterToSubquery,
  type IPropertyFilter,
  type IPropertySort,
} from './blockApi.js';

function requireDb(db: IBuiltInToolDatabase | undefined): asserts db is IBuiltInToolDatabase {
  if (!db || !db.isOpen) throw new Error('Database is not available');
}

// ─── C1: pages.query_by_property ────────────────────────────────────────

export function createQueryByPropertyTool(db: IBuiltInToolDatabase | undefined): IChatTool {
  return {
    // Snake_case to match existing chat-tool registry style; M60 §6.2
    // spec literal `pages.query_by_property` is documented in
    // CANVAS_BLOCK_API.md.
    name: 'query_pages_by_property',
    description:
      'Query pages by one or more property filters (AND), with optional sort and group. ' +
      'Filter ops: equals, not_equals, contains, is_empty, is_not_empty, greater_than, less_than. ' +
      'Use this for multi-criteria queries like "pages where status=Draft AND tag=research".',
    parameters: {
      type: 'object',
      required: ['filter'],
      properties: {
        filter: {
          type: 'array',
          description: 'Array of {prop, op, value} filters; combined with AND.',
          items: {
            type: 'object',
            required: ['prop', 'op'],
            properties: {
              prop: { type: 'string' },
              op: { type: 'string' },
              value: {},
            },
          },
        },
        sort: {
          type: 'object',
          description: 'Optional sort: {by: propertyName | "title" | "updated_at", dir: "asc"|"desc"}.',
          properties: {
            by: { type: 'string' },
            dir: { type: 'string', enum: ['asc', 'desc'] },
          },
        },
        group: {
          type: 'string',
          description: 'Optional property name to group results by.',
        },
        limit: { type: 'number', description: 'Max pages (default 50, cap 200)' },
      },
    },
    requiresConfirmation: false,
    permissionLevel: 'always-allowed' as ToolPermissionLevel,
    async handler(args: Record<string, unknown>, _token: ICancellationToken): Promise<IToolResult> {
      requireDb(db);

      const rawFilter = args['filter'];
      if (!Array.isArray(rawFilter) || rawFilter.length === 0) {
        return { content: 'filter must be a non-empty array of {prop, op, value}', isError: true };
      }
      const filters: IPropertyFilter[] = [];
      for (const f of rawFilter) {
        if (!f || typeof f !== 'object') {
          return { content: 'each filter must be an object {prop, op, value}', isError: true };
        }
        const fo = f as Record<string, unknown>;
        const prop = String(fo['prop'] || '').trim();
        const op = String(fo['op'] || '').trim();
        if (!prop || !op) {
          return { content: 'each filter requires prop and op', isError: true };
        }
        filters.push({ prop, op: op as IPropertyFilter['op'], value: fo['value'] });
      }

      const sort = args['sort'] as IPropertySort | undefined;
      const group = typeof args['group'] === 'string' ? (args['group'] as string).trim() : '';
      const limit = Math.min(Math.max(Number(args['limit']) || 50, 1), 200);

      // Build INTERSECT chain: page must match every filter.
      const subqueries: string[] = [];
      const params: unknown[] = [];
      try {
        for (const f of filters) {
          const sub = filterToSubquery(f);
          subqueries.push(sub.subquery);
          params.push(...sub.params);
        }
      } catch (err) {
        return { content: (err as Error).message, isError: true };
      }
      const intersectSql = subqueries.join(' INTERSECT ');

      // Sort: by built-in column or by joined property value.
      let sortClause = 'p.updated_at DESC';
      const dir = sort?.dir === 'asc' ? 'ASC' : 'DESC';
      if (sort?.by) {
        if (sort.by === 'title') sortClause = `p.title ${dir}`;
        else if (sort.by === 'updated_at') sortClause = `p.updated_at ${dir}`;
        else if (sort.by === 'created_at') sortClause = `p.created_at ${dir}`;
        else sortClause = `(SELECT value FROM page_properties WHERE page_id = p.id AND key = ${escapeLiteral(sort.by)}) ${dir}`;
      }

      const sql =
        `SELECT p.id, p.title, p.updated_at FROM pages p ` +
        `WHERE p.is_archived = 0 AND p.id IN (${intersectSql}) ` +
        `ORDER BY ${sortClause} LIMIT ?`;
      params.push(limit);

      const rows = await db!.all<{ id: string; title: string; updated_at: string }>(sql, params);
      if (rows.length === 0) {
        return { content: `No pages matched ${filters.length} filter(s).` };
      }

      // Hydrate group property if requested.
      let groupValues: Map<string, string> | null = null;
      if (group) {
        groupValues = new Map();
        const ids = rows.map((r) => r.id);
        const placeholders = ids.map(() => '?').join(',');
        const propRows = await db!.all<{ page_id: string; value: string }>(
          `SELECT page_id, value FROM page_properties WHERE key = ? AND page_id IN (${placeholders})`,
          [group, ...ids],
        );
        for (const pr of propRows) groupValues.set(pr.page_id, pr.value);
      }

      // Format output.
      if (group && groupValues) {
        const grouped = new Map<string, typeof rows>();
        for (const r of rows) {
          const raw = groupValues.get(r.id) ?? 'null';
          let label = raw;
          try { label = String(JSON.parse(raw)); } catch { /* keep raw */ }
          if (!grouped.has(label)) grouped.set(label, []);
          grouped.get(label)!.push(r);
        }
        const sections = [...grouped.entries()].map(([label, items]) => {
          const lines = items.map((p) => `  - **${p.title}** (id: ${p.id})`).join('\n');
          return `### ${group} = ${label}\n${lines}`;
        });
        return { content: `Found ${rows.length} page(s) grouped by ${group}:\n\n${sections.join('\n\n')}` };
      }

      const lines = rows.map((p) => `- **${p.title}** (id: ${p.id}, updated: ${p.updated_at})`);
      return { content: `Found ${rows.length} page(s):\n\n${lines.join('\n')}` };
    },
  };
}

/** Escape a SQL string literal for use in an inline ORDER BY subquery.
 * Only used here because SQLite parameter binding inside a subquery's
 * WHERE clause cannot be parameterized when the subquery is part of
 * ORDER BY. The value is sanitized by quoting + doubling single quotes. */
function escapeLiteral(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
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
): Promise<void> {
  const stored = encodeDocContent(doc);
  const now = new Date().toISOString();
  await db.run(
    'UPDATE pages SET content = ?, updated_at = ?, revision = revision + 1 WHERE id = ?',
    [stored, now, pageId],
  );
}

// ─── C3.a: pages.read_block ─────────────────────────────────────────────

export function createReadBlockTool(db: IBuiltInToolDatabase | undefined): IChatTool {
  return {
    name: 'read_block',
    description:
      'Read a single block within a page by its stable blockId. ' +
      'Returns the block JSON and its plaintext rendering. ' +
      'Use list_pages → read_page to discover block IDs.',
    parameters: {
      type: 'object',
      required: ['pageId', 'blockId'],
      properties: {
        pageId: { type: 'string', description: 'The page UUID' },
        blockId: { type: 'string', description: 'The stable block id (TipTap unique-id attribute)' },
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

export function createEditBlockTool(db: IBuiltInToolDatabase | undefined): IChatTool {
  return {
    name: 'edit_block',
    description:
      'Replace the content of a block within a page by its stable blockId. ' +
      'newContent is treated as plain text and replaces the block with a paragraph node ' +
      '(preserving the original blockId). Bumps the page revision. ' +
      'Idempotency: callers may pass idempotencyKey; the autonomy log captures it for replay-safety.',
    parameters: {
      type: 'object',
      required: ['pageId', 'blockId', 'newContent'],
      properties: {
        pageId: { type: 'string' },
        blockId: { type: 'string' },
        newContent: { type: 'string', description: 'Plain text replacement for the block' },
        idempotencyKey: { type: 'string', description: 'Optional key to dedupe duplicate calls (M60 §3.7)' },
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
      await persistDoc(db!, pageId, newDoc);

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

export function createInsertBlockAfterTool(db: IBuiltInToolDatabase | undefined): IChatTool {
  return {
    name: 'insert_block_after',
    description:
      'Insert a new paragraph block immediately after the block identified by anchorBlockId. ' +
      'Returns the newly minted blockId. Bumps the page revision.',
    parameters: {
      type: 'object',
      required: ['pageId', 'anchorBlockId', 'content'],
      properties: {
        pageId: { type: 'string' },
        anchorBlockId: { type: 'string' },
        content: { type: 'string', description: 'Plain text content for the new block' },
        idempotencyKey: { type: 'string', description: 'Optional dedupe key (M60 §3.7)' },
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
      await persistDoc(db!, pageId, newDoc);

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

export function createLinkBlockTool(db: IBuiltInToolDatabase | undefined): IChatTool {
  return {
    name: 'link_block',
    description:
      'Append a markdown-style link inside the source block pointing to a target block on another (or the same) page. ' +
      'Useful for AI-driven cross-references. Bumps the source page revision.',
    parameters: {
      type: 'object',
      required: ['fromPageId', 'fromBlockId', 'toPageId', 'toBlockId'],
      properties: {
        fromPageId: { type: 'string' },
        fromBlockId: { type: 'string' },
        toPageId: { type: 'string' },
        toBlockId: { type: 'string' },
        label: { type: 'string', description: 'Optional link text; defaults to target page title.' },
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
      await persistDoc(db!, fromPageId, newDoc);

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

export function createBlockTools(db: IBuiltInToolDatabase | undefined): IChatTool[] {
  return [
    createQueryByPropertyTool(db),
    createReadBlockTool(db),
    createEditBlockTool(db),
    createInsertBlockAfterTool(db),
    createLinkBlockTool(db),
  ];
}

/** Stable list of tool names registered by createBlockTools — used by
 * tests and documentation to detect drift. */
export const BLOCK_TOOL_NAMES = [
  'query_pages_by_property',
  'read_block',
  'edit_block',
  'insert_block_after',
  'link_block',
] as const;
