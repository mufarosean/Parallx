// pageTools.ts — Page/canvas tool registrations (M13 Phase 5)

import type {
  IChatTool,
  IToolResult,
  ICancellationToken,
  ToolPermissionLevel,
} from '../../../services/chatTypes.js';
import type {
  IBuiltInToolDatabase,
  CurrentPageIdGetter,
  PageMutationNotifier,
} from '../chatTypes.js';
import { extractSnippet, extractTextContent } from './builtInTools.js';
import { markdownToTiptapJson } from '../../canvas/markdownImport.js';
import {
  decodeCanvasContent,
  encodeCanvasContentFromDoc,
} from '../../canvas/contentSchema.js';
import { filterToSubquery, type IPropertyFilter, type IPropertySort } from './blockApi.js';

// ── Tool helpers ──

function requireDb(db: IBuiltInToolDatabase | undefined): asserts db is IBuiltInToolDatabase {
  if (!db || !db.isOpen) {
    throw new Error('Database is not available');
  }
}

function generateId(): string {
  return crypto.randomUUID();
}

// ── Tool definitions ──

/**
 * find_pages — unified page discovery (folds list_pages, search_workspace,
 * find_pages_by_property, query_pages_by_property into one tool).
 *
 * Modes (combined with AND):
 *   - No args                → list all non-archived pages by recency.
 *   - `query`                → full-text LIKE search over title + content.
 *   - `filter: [{prop,op,value}…]` → property filter chain (INTERSECT).
 *   - `sort`, `group`, `limit` apply to the result set.
 */
export function createFindPagesTool(db: IBuiltInToolDatabase | undefined): IChatTool {
  return {
    name: 'find_pages',
    displaySummary: 'Find or list workspace pages.',
    description:
      'Find pages by text query, property filters, or both. With no args, lists recent pages. ' +
      '`query` does full-text LIKE matching on title/content. ' +
      '`filter` is an array of {prop, op, value} (ops: equals, not_equals, contains, is_empty, is_not_empty, greater_than, less_than) combined with AND. ' +
      'Optional `sort: {by, dir}` (`by` may be "title", "updated_at", "created_at", or any property name) and `group: <propertyName>`.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Text to match against page titles and content.' },
        filter: {
          type: 'array',
          description: 'Property filters combined with AND.',
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
          properties: {
            by: { type: 'string' },
            dir: { type: 'string', enum: ['asc', 'desc'] },
          },
        },
        group: { type: 'string', description: 'Property name to group results by.' },
        limit: { type: 'number', description: 'Maximum results (default 50, cap 200).' },
      },
    },
    requiresConfirmation: false,
    permissionLevel: 'always-allowed' as ToolPermissionLevel,
    async handler(args: Record<string, unknown>, _token: ICancellationToken): Promise<IToolResult> {
      requireDb(db);

      const query = typeof args['query'] === 'string' ? (args['query'] as string).trim() : '';
      const rawFilter = args['filter'];
      const sort = args['sort'] as IPropertySort | undefined;
      const group = typeof args['group'] === 'string' ? (args['group'] as string).trim() : '';
      const limit = Math.min(Math.max(Number(args['limit']) || 50, 1), 200);

      // Parse filters if present.
      const filters: IPropertyFilter[] = [];
      if (Array.isArray(rawFilter)) {
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
      }

      // Build WHERE clauses + params.
      const whereParts: string[] = ['p.is_archived = 0'];
      const params: unknown[] = [];

      if (query) {
        whereParts.push('(p.title LIKE ? OR p.content LIKE ?)');
        const pattern = `%${query}%`;
        params.push(pattern, pattern);
      }

      if (filters.length > 0) {
        const subqueries: string[] = [];
        try {
          for (const f of filters) {
            const sub = filterToSubquery(f);
            subqueries.push(sub.subquery);
            params.push(...sub.params);
          }
        } catch (err) {
          return { content: (err as Error).message, isError: true };
        }
        whereParts.push(`p.id IN (${subqueries.join(' INTERSECT ')})`);
      }

      // Sort: built-in column or joined property.
      let sortClause = 'p.updated_at DESC';
      const dir = sort?.dir === 'asc' ? 'ASC' : 'DESC';
      if (sort?.by) {
        if (sort.by === 'title') sortClause = `p.title ${dir}`;
        else if (sort.by === 'updated_at') sortClause = `p.updated_at ${dir}`;
        else if (sort.by === 'created_at') sortClause = `p.created_at ${dir}`;
        else sortClause = `(SELECT value FROM page_properties WHERE page_id = p.id AND key = ${escapeSqlLiteral(sort.by)}) ${dir}`;
      }

      const sql =
        `SELECT p.id, p.title, p.icon, p.content, p.updated_at FROM pages p ` +
        `WHERE ${whereParts.join(' AND ')} ORDER BY ${sortClause} LIMIT ?`;
      params.push(limit);

      const rows = await db!.all<{ id: string; title: string; icon: string | null; content: string; updated_at: string }>(sql, params);

      if (rows.length === 0) {
        if (query && filters.length === 0) return { content: `No pages found matching "${query}".` };
        if (filters.length > 0) return { content: `No pages matched ${filters.length} filter(s)${query ? ` and query "${query}"` : ''}.` };
        return { content: 'No pages found in the workspace.' };
      }

      // Optional grouping.
      if (group) {
        const ids = rows.map((r) => r.id);
        const placeholders = ids.map(() => '?').join(',');
        const propRows = await db!.all<{ page_id: string; value: string }>(
          `SELECT page_id, value FROM page_properties WHERE key = ? AND page_id IN (${placeholders})`,
          [group, ...ids],
        );
        const groupValues = new Map<string, string>();
        for (const pr of propRows) groupValues.set(pr.page_id, pr.value);
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

      // Default rendering.
      const lines = rows.map((p) => {
        const icon = p.icon ? `${p.icon} ` : '';
        const snippet = query ? extractSnippet(p.content, query, 150) : '';
        return `- ${icon}**${p.title}** (id: ${p.id}, updated: ${p.updated_at})${snippet ? `\n  ${snippet}` : ''}`;
      });

      const header =
        query && filters.length > 0
          ? `Found ${rows.length} page(s) matching "${query}" + ${filters.length} filter(s):`
          : query
            ? `Found ${rows.length} page(s) matching "${query}":`
            : filters.length > 0
              ? `Found ${rows.length} page(s) matching ${filters.length} filter(s):`
              : `${rows.length} page(s) in workspace:`;

      return { content: `${header}\n\n${lines.join('\n')}` };
    },
  };
}

/** Escape a string literal for inline use in a SQL ORDER BY subquery. */
function escapeSqlLiteral(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

/**
 * read_page — read a page by UUID, title, or the literal 'current'.
 *
 * Folds the former read_current_page tool: pass `pageId: 'current'` to read
 * whatever page the user has open in the editor.
 */
export function createReadPageTool(
  db: IBuiltInToolDatabase | undefined,
  getCurrentPageId?: CurrentPageIdGetter,
): IChatTool {
  return {
    name: 'read_page',
    displaySummary: 'Read a page by id, title, or "current".',
    description:
      'Read the full content of a page. `pageId` accepts a UUID, a page title (case-insensitive match), or the literal "current" to read the page the user has open in the editor.',
    parameters: {
      type: 'object',
      required: ['pageId'],
      properties: {
        pageId: { type: 'string', description: 'Page UUID, page title, or "current" for the active page.' },
      },
    },
    requiresConfirmation: false,
    permissionLevel: 'always-allowed' as ToolPermissionLevel,
    async handler(args: Record<string, unknown>, _token: ICancellationToken): Promise<IToolResult> {
      requireDb(db);
      const identifier = String(args['pageId'] || '').trim();
      if (!identifier) {
        return { content: 'pageId is required', isError: true };
      }

      // Special form: 'current' → resolve to the active editor page.
      if (identifier.toLowerCase() === 'current') {
        const currentId = getCurrentPageId?.();
        if (!currentId) {
          return { content: 'No page is currently open in the editor.', isError: true };
        }
        const page = await db!.get<{ id: string; title: string; content: string }>(
          'SELECT id, title, content FROM pages WHERE id = ?',
          [currentId],
        );
        if (!page) {
          return { content: `The active editor page (${currentId}) was not found in the database.`, isError: true };
        }
        const text = extractTextContent(page.content);
        return { content: `**${page.title}** (id: ${page.id}) — currently open\n\n${text || '(empty page)'}` };
      }

      // Try UUID lookup first (exact match)
      let page = await db!.get<{ id: string; title: string; content: string }>(
        'SELECT id, title, content FROM pages WHERE id = ?',
        [identifier],
      );

      // Fallback: case-insensitive exact title match
      if (!page) {
        page = await db!.get<{ id: string; title: string; content: string }>(
          'SELECT id, title, content FROM pages WHERE is_archived = 0 AND LOWER(title) = LOWER(?)',
          [identifier],
        );
      }

      // Fallback: partial title match (LIKE)
      if (!page) {
        page = await db!.get<{ id: string; title: string; content: string }>(
          'SELECT id, title, content FROM pages WHERE is_archived = 0 AND title LIKE ? ORDER BY updated_at DESC',
          [`%${identifier}%`],
        );
      }

      if (!page) {
        return { content: `Page "${identifier}" not found. Use find_pages to see available pages.`, isError: true };
      }

      const text = extractTextContent(page.content);
      return { content: `**${page.title}** (id: ${page.id})\n\n${text || '(empty page)'}` };
    },
  };
}

/**
 * get_page — return page metadata, custom properties, and applicable
 * property definitions in one shot.
 *
 * Replaces the former get_page_properties tool and additionally surfaces
 * the workspace property definitions that the assistant can use with
 * set_page_property.
 */
export function createGetPageTool(db: IBuiltInToolDatabase | undefined): IChatTool {
  return {
    name: 'get_page',
    displaySummary: 'Get page metadata, properties, and applicable definitions.',
    description:
      'Get a page\'s metadata (title, icon, dates, block count), its custom property values, and the workspace property definitions available for the page.',
    parameters: {
      type: 'object',
      required: ['pageId'],
      properties: {
        pageId: { type: 'string', description: 'The page UUID' },
      },
    },
    requiresConfirmation: false,
    permissionLevel: 'always-allowed' as ToolPermissionLevel,
    async handler(args: Record<string, unknown>, _token: ICancellationToken): Promise<IToolResult> {
      requireDb(db);
      const pageId = String(args['pageId'] || '');
      if (!pageId) {
        return { content: 'pageId is required', isError: true };
      }

      const page = await db!.get<{
        id: string;
        title: string;
        icon: string | null;
        is_archived: number;
        created_at: string;
        updated_at: string;
      }>(
        'SELECT id, title, icon, is_archived, created_at, updated_at FROM pages WHERE id = ?',
        [pageId],
      );

      if (!page) {
        return { content: `Page "${pageId}" not found.`, isError: true };
      }

      const blockCount = await db!.get<{ cnt: number }>(
        'SELECT COUNT(*) as cnt FROM canvas_blocks WHERE page_id = ?',
        [pageId],
      );

      const lines: (string | null)[] = [
        `**Title:** ${page.title}`,
        `**ID:** ${page.id}`,
        page.icon ? `**Icon:** ${page.icon}` : null,
        `**Created:** ${page.created_at}`,
        `**Updated:** ${page.updated_at}`,
        `**Archived:** ${page.is_archived ? 'Yes' : 'No'}`,
        `**Blocks:** ${blockCount?.cnt ?? 0}`,
      ];

      // Custom properties.
      const props = await db!.all<{
        key: string;
        value_type: string;
        value: string;
        def_type: string | null;
      }>(
        'SELECT pp.key, pp.value_type, pp.value, pd.type as def_type FROM page_properties pp LEFT JOIN property_definitions pd ON pp.key = pd.name WHERE pp.page_id = ?',
        [pageId],
      );

      if (props.length > 0) {
        lines.push('', '**Custom Properties:**');
        for (const prop of props) {
          const displayType = prop.def_type || prop.value_type;
          const formatted = formatPropertyValue(prop.value, displayType);
          lines.push(`- **${prop.key}** (${displayType}): ${formatted}`);
        }
      }

      // Applicable property definitions (workspace-wide).
      const defs = await db!.all<{ name: string; type: string }>(
        'SELECT name, type FROM property_definitions ORDER BY sort_order, name',
      );
      if (defs.length > 0) {
        lines.push('', '**Applicable Property Definitions:**');
        for (const d of defs) {
          lines.push(`- **${d.name}** (${d.type})`);
        }
      }

      return { content: lines.filter((l) => l !== null).join('\n') };
    },
  };
}

/** Format a JSON-stored property value for display. */
function formatPropertyValue(raw: string, _type: string): string {
  try {
    const val = JSON.parse(raw);
    if (val === null || val === undefined) { return '(empty)'; }
    if (typeof val === 'boolean') { return val ? 'Yes' : 'No'; }
    if (Array.isArray(val)) { return val.join(', '); }
    return String(val);
  } catch {
    return raw || '(empty)';
  }
}

// ── Property tools (M55 Domain 4) ──

export function createListPropertyDefinitionsTool(db: IBuiltInToolDatabase | undefined): IChatTool {
  return {
    name: 'list_property_definitions',
    displaySummary: 'List workspace property definitions.',
    description: 'List all property definitions in the workspace. Shows available property names, types, and configuration.',
    parameters: {
      type: 'object',
      properties: {},
    },
    requiresConfirmation: false,
    permissionLevel: 'always-allowed' as ToolPermissionLevel,
    async handler(_args: Record<string, unknown>, _token: ICancellationToken): Promise<IToolResult> {
      requireDb(db);

      const defs = await db!.all<{
        name: string;
        type: string;
        config: string;
        sort_order: number;
        created_at: string;
        updated_at: string;
      }>(
        'SELECT * FROM property_definitions ORDER BY sort_order, name',
      );

      if (defs.length === 0) {
        return { content: 'No property definitions found in the workspace.' };
      }

      const lines = defs.map((d) => {
        let config = '';
        try {
          const parsed = JSON.parse(d.config);
          if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
            config = ` — config: ${d.config}`;
          }
        } catch { /* empty */ }
        return `- **${d.name}** (${d.type})${config}`;
      });

      return { content: `${defs.length} property definition(s):\n\n${lines.join('\n')}` };
    },
  };
}

export function createSetPagePropertyTool(db: IBuiltInToolDatabase | undefined): IChatTool {
  return {
    name: 'set_page_property',
    displaySummary: 'Set a property on a page.',
    description: 'Set a property value on a canvas page. Creates the property definition automatically if it doesn\'t exist.',
    parameters: {
      type: 'object',
      required: ['pageId', 'propertyName', 'value'],
      properties: {
        pageId: { type: 'string', description: 'The page UUID' },
        propertyName: { type: 'string', description: 'The property name' },
        value: { description: 'The property value (string, number, boolean, or array)' },
      },
    },
    requiresConfirmation: true,
    permissionLevel: 'requires-approval' as ToolPermissionLevel,
    async handler(args: Record<string, unknown>, _token: ICancellationToken): Promise<IToolResult> {
      requireDb(db);
      const pageId = String(args['pageId'] || '');
      const propertyName = String(args['propertyName'] || '').trim();
      const value = args['value'];

      if (!pageId) { return { content: 'pageId is required', isError: true }; }
      if (!propertyName) { return { content: 'propertyName is required', isError: true }; }
      if (value === undefined) { return { content: 'value is required', isError: true }; }

      // Check page exists
      const page = await db!.get<{ id: string; title: string }>(
        'SELECT id, title FROM pages WHERE id = ?',
        [pageId],
      );
      if (!page) {
        return { content: `Page "${pageId}" not found.`, isError: true };
      }

      // Check/create property definition
      const existingDef = await db!.get<{ name: string; type: string }>(
        'SELECT name, type FROM property_definitions WHERE name = ?',
        [propertyName],
      );

      if (!existingDef) {
        const inferredType = inferPropertyType(value);
        const now = new Date().toISOString();
        await db!.run(
          'INSERT INTO property_definitions (name, type, config, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
          [propertyName, inferredType, '{}', 0, now, now],
        );
      }

      // Determine value type
      const valueType = existingDef?.type ?? inferPropertyType(value);
      const serialized = JSON.stringify(value);
      const id = generateId();

      // UPSERT into page_properties
      await db!.run(
        'INSERT INTO page_properties (id, page_id, key, value_type, value) VALUES (?, ?, ?, ?, ?) ON CONFLICT(page_id, key) DO UPDATE SET value_type = excluded.value_type, value = excluded.value',
        [id, pageId, propertyName, valueType, serialized],
      );

      return { content: `Set property '${propertyName}' = ${serialized} on page '${page.title}'` };
    },
  };
}

/** Infer a property type from a JavaScript value. */
function inferPropertyType(value: unknown): string {
  if (typeof value === 'boolean') { return 'checkbox'; }
  if (typeof value === 'number') { return 'number'; }
  if (Array.isArray(value)) { return 'tags'; }
  return 'text';
}

export function createCreatePageTool(
  db: IBuiltInToolDatabase | undefined,
  notifyPageMutated?: PageMutationNotifier,
): IChatTool {
  return {
    name: 'create_page',
    displaySummary: 'Create a new workspace page.',
    description:
      'Create a new canvas page with a title, optional icon, and optional markdown body. The page is created with a proper canvas content envelope so it opens correctly in the editor. Use the `markdown` field for any structured body (headings, lists, code, tables, etc.). The deprecated `content` field is treated as a plain-text fallback wrapped in a single paragraph.',
    parameters: {
      type: 'object',
      required: ['title'],
      properties: {
        title: { type: 'string', description: 'Page title' },
        markdown: { type: 'string', description: 'Initial body as markdown (supports headings, lists, code, tables, math, callouts, images)' },
        content: { type: 'string', description: 'DEPRECATED: plain text used as a single paragraph if markdown is not provided' },
        icon: { type: 'string', description: 'Page icon emoji' },
      },
    },
    requiresConfirmation: true,
    permissionLevel: 'requires-approval' as ToolPermissionLevel,
    async handler(args: Record<string, unknown>, _token: ICancellationToken): Promise<IToolResult> {
      requireDb(db);
      const title = String(args['title'] || '').trim();
      if (!title) {
        return { content: 'Title is required', isError: true };
      }

      const id = generateId();
      const icon = args['icon'] ? String(args['icon']) : null;
      const markdown = typeof args['markdown'] === 'string' ? args['markdown'] : '';
      const plainContent = typeof args['content'] === 'string' ? args['content'] : '';
      const now = new Date().toISOString();

      // Build TipTap doc: markdown → JSON if provided, plain text → single paragraph,
      // otherwise empty paragraph (matches canvasDataService.createPage initial doc).
      let doc: { type: 'doc'; content: unknown[] };
      if (markdown.trim()) {
        doc = markdownToTiptapJson(markdown) as { type: 'doc'; content: unknown[] };
        if (!doc.content || doc.content.length === 0) {
          doc = { type: 'doc', content: [{ type: 'paragraph' }] };
        }
      } else if (plainContent.trim()) {
        doc = {
          type: 'doc',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: plainContent }] },
          ],
        };
      } else {
        doc = { type: 'doc', content: [{ type: 'paragraph' }] };
      }

      const encoded = encodeCanvasContentFromDoc(doc as Parameters<typeof encodeCanvasContentFromDoc>[0]);

      await db!.run(
        'INSERT INTO pages (id, title, icon, content, content_schema_version, is_archived, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)',
        [id, title, icon, encoded.storedContent, encoded.schemaVersion, now, now],
      );

      // Notify the canvas data service so the sidebar (and other listeners)
      // refresh promptly. Raw SQL bypasses CanvasDataService.createPage, which
      // is normally where `onDidChangePage` fires.
      try { notifyPageMutated?.(id, 'created'); } catch { /* never block the tool result on notifier errors */ }

      const blockCount = doc.content.length;
      return { content: `Created page "${title}" (id: ${id}) with ${blockCount} block${blockCount === 1 ? '' : 's'}.` };
    },
  };
}

/**
 * compose_page — author or update a canvas page using markdown.
 *
 * Parses the provided markdown into TipTap JSON via `markdownToTiptapJson`,
 * combines it with the page's current content per `mode`, encodes it via the
 * canvas content schema envelope, and persists it in `pages.content`.
 *
 * Modes:
 *   - `replace` (default): overwrite the body entirely
 *   - `append`: insert blocks at the end
 *   - `prepend`: insert blocks at the start
 *
 * NOTE: This writes directly via SQL, matching the existing `create_page`
 * pattern. If the target page is open in a live editor, the editor will not
 * reflect the change until reload. Reconciling that is a separate concern
 * for a later iteration.
 */
export function createComposePageTool(db: IBuiltInToolDatabase | undefined): IChatTool {
  return {
    name: 'compose_page',
    displaySummary: 'Compose a page from markdown.',
    description:
      'Author or update a canvas page from markdown. Supports headings, lists, tables, callouts, code blocks, math, images, and inline marks. Use mode "replace" to overwrite, "append" or "prepend" to add to existing content.',
    parameters: {
      type: 'object',
      required: ['pageId', 'markdown'],
      properties: {
        pageId: { type: 'string', description: 'The page UUID to update' },
        markdown: {
          type: 'string',
          description:
            'Markdown body to render into the page. Supports # headings, lists, - [ ] tasks, > [!type] callouts, ```code fences, pipe tables, $$math$$, ![images](src), and inline **bold** / *italic* / `code` / [links](url).',
        },
        mode: {
          type: 'string',
          enum: ['replace', 'append', 'prepend'],
          description: 'How to combine with existing content. Default: replace.',
        },
      },
    },
    requiresConfirmation: true,
    permissionLevel: 'requires-approval' as ToolPermissionLevel,
    async handler(args: Record<string, unknown>, _token: ICancellationToken): Promise<IToolResult> {
      requireDb(db);

      const pageId = String(args['pageId'] || '').trim();
      const markdown = args['markdown'] != null ? String(args['markdown']) : '';
      const modeRaw = String(args['mode'] || 'replace').toLowerCase();
      const mode: 'replace' | 'append' | 'prepend' =
        modeRaw === 'append' ? 'append' : modeRaw === 'prepend' ? 'prepend' : 'replace';

      if (!pageId) {
        return { content: 'pageId is required', isError: true };
      }

      const page = await db!.get<{ id: string; title: string; content: string }>(
        'SELECT id, title, content FROM pages WHERE id = ?',
        [pageId],
      );
      if (!page) {
        return { content: `Page not found: ${pageId}`, isError: true };
      }

      const incomingDoc = markdownToTiptapJson(markdown);
      const incomingBlocks = Array.isArray(incomingDoc.content) ? incomingDoc.content : [];

      let finalDoc: { type: 'doc'; content: unknown[] };
      if (mode === 'replace') {
        finalDoc = { type: 'doc', content: incomingBlocks };
      } else {
        const existing = decodeCanvasContent(page.content);
        const existingBlocks = Array.isArray(existing.doc?.content) ? existing.doc.content : [];
        const merged = mode === 'append'
          ? [...existingBlocks, ...incomingBlocks]
          : [...incomingBlocks, ...existingBlocks];
        finalDoc = { type: 'doc', content: merged };
      }

      // Doc must contain at least one block — guard against empty-markdown
      // append/prepend that would yield an empty body.
      if (finalDoc.content.length === 0) {
        finalDoc = { type: 'doc', content: [{ type: 'paragraph' }] };
      }

      const encoded = encodeCanvasContentFromDoc(finalDoc);
      const now = new Date().toISOString();
      await db!.run(
        'UPDATE pages SET content = ?, content_schema_version = ?, updated_at = ? WHERE id = ?',
        [encoded.storedContent, encoded.schemaVersion, now, pageId],
      );

      const blockCount = finalDoc.content.length;
      const verb = mode === 'replace' ? 'Replaced' : mode === 'append' ? 'Appended to' : 'Prepended to';
      return {
        content: `${verb} page "${page.title}" — ${blockCount} block${blockCount === 1 ? '' : 's'}.`,
      };
    },
  };
}

/**
 * set_page_style — update a page's display settings (icon, cover, font, width, text size).
 *
 * Only the fields provided in `style` are updated. Matches the page-settings
 * columns added in `003_page_settings.sql` (icon, cover_url, font_family,
 * full_width, small_text). Requires approval since it mutates user-visible
 * presentation.
 */
export function createSetPageStyleTool(db: IBuiltInToolDatabase | undefined): IChatTool {
  return {
    name: 'set_page_style',
    displaySummary: 'Update a page\'s style (icon, cover, font, width).',
    description:
      'Update a page\'s display settings. Provide only the fields you want to change. fontFamily must be "default" | "serif" | "mono". fullWidth and smallText are booleans. icon is an emoji string (pass empty string to clear). coverUrl is a URL string (pass empty string to clear).',
    parameters: {
      type: 'object',
      required: ['pageId', 'style'],
      properties: {
        pageId: { type: 'string', description: 'ID of the page to update' },
        style: {
          type: 'object',
          description: 'Style fields to update (omit fields you do not want to change)',
          properties: {
            icon: { type: 'string', description: 'Emoji icon (empty string to clear)' },
            coverUrl: { type: 'string', description: 'Cover image URL (empty string to clear)' },
            fontFamily: { type: 'string', enum: ['default', 'serif', 'mono'], description: 'Body font family' },
            fullWidth: { type: 'boolean', description: 'Use the full canvas width' },
            smallText: { type: 'boolean', description: 'Render the page in a smaller text size' },
          },
        },
      },
    },
    requiresConfirmation: true,
    permissionLevel: 'requires-approval' as ToolPermissionLevel,
    async handler(args: Record<string, unknown>, _token: ICancellationToken): Promise<IToolResult> {
      requireDb(db);
      const pageId = String(args['pageId'] || '').trim();
      if (!pageId) {
        return { content: 'pageId is required', isError: true };
      }
      const style = (args['style'] && typeof args['style'] === 'object') ? args['style'] as Record<string, unknown> : null;
      if (!style) {
        return { content: 'style object is required', isError: true };
      }

      const page = await db!.get<{ id: string; title: string }>(
        'SELECT id, title FROM pages WHERE id = ?',
        [pageId],
      );
      if (!page) {
        return { content: `Page not found: ${pageId}`, isError: true };
      }

      const sets: string[] = [];
      const params: unknown[] = [];
      const changed: string[] = [];

      if ('icon' in style) {
        const v = String(style['icon'] ?? '');
        sets.push('icon = ?');
        params.push(v === '' ? null : v);
        changed.push('icon');
      }
      if ('coverUrl' in style) {
        const v = String(style['coverUrl'] ?? '');
        sets.push('cover_url = ?');
        params.push(v === '' ? null : v);
        changed.push('coverUrl');
      }
      if ('fontFamily' in style) {
        const v = String(style['fontFamily']);
        if (v !== 'default' && v !== 'serif' && v !== 'mono') {
          return { content: `Invalid fontFamily: ${v}. Must be "default", "serif", or "mono".`, isError: true };
        }
        sets.push('font_family = ?');
        params.push(v);
        changed.push('fontFamily');
      }
      if ('fullWidth' in style) {
        sets.push('full_width = ?');
        params.push(style['fullWidth'] ? 1 : 0);
        changed.push('fullWidth');
      }
      if ('smallText' in style) {
        sets.push('small_text = ?');
        params.push(style['smallText'] ? 1 : 0);
        changed.push('smallText');
      }

      if (sets.length === 0) {
        return { content: 'No style fields provided. Specify at least one of: icon, coverUrl, fontFamily, fullWidth, smallText.', isError: true };
      }

      const now = new Date().toISOString();
      sets.push('updated_at = ?');
      params.push(now);
      params.push(pageId);

      await db!.run(
        `UPDATE pages SET ${sets.join(', ')} WHERE id = ?`,
        params,
      );

      return { content: `Updated page "${page.title}" style: ${changed.join(', ')}.` };
    },
  };
}
