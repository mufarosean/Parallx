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
    name: 'canvas_find_pages',
    displaySummary: 'Find or list canvas pages.',
    description:
      'Find pages in the canvas page DB by text query, property filters, or both. ' +
      'No args lists recent pages. filter ops: equals, not_equals, contains, is_empty, ' +
      'is_not_empty, greater_than, less_than. NOTE: this searches CANVAS PAGES only, not ' +
      'files on disk — use `search_files` or `grep_search` to find files in the workspace ' +
      'filesystem.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search text (title and content).' },
        filter: {
          type: 'array',
          description: 'Property filters (AND).',
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
    name: 'canvas_read_page',
    displaySummary: 'Read a canvas page by id, title, or "current".',
    description:
      'Read the full content of a CANVAS PAGE (page DB, not the filesystem). `pageId` ' +
      'accepts a UUID, a page title (case-insensitive match), or the literal "current" to ' +
      'read the page the user has open in the editor. NOTE: this reads canvas pages only — ' +
      'use `read_file` for files on disk.',
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
        return { content: `Page "${identifier}" not found. Use canvas_find_pages to see available pages.`, isError: true };
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
    name: 'canvas_get_page',
    displaySummary: 'Get canvas page metadata, properties, and definitions.',
    description: 'Get a CANVAS PAGE\'s metadata, properties, and applicable property definitions. Operates on the canvas page DB; for files on disk see `read_file`.',
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
    name: 'canvas_list_property_definitions',
    displaySummary: 'List canvas property definitions.',
    description: 'List the property definitions registered for CANVAS PAGES in this workspace (page properties like tags, status, dates). Operates on the canvas page DB only.',
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
    name: 'canvas_set_page_property',
    displaySummary: 'Set a property on a canvas page.',
    description:
      'Set a property value on a CANVAS PAGE. Creates the property definition automatically if it doesn\'t exist. ' +
      'Operates on the canvas page DB only — this is NOT for editing filesystem files. ' +
      'Value shape by property kind: text → string, number → number, checkbox → boolean, ' +
      'tags / multi-select → JSON array of strings (e.g. ["Journal","Daily"]). ' +
      'For tags pass a real JSON array, NOT a stringified array like "[\\"a\\",\\"b\\"]".',
    parameters: {
      type: 'object',
      required: ['pageId', 'propertyName', 'value'],
      properties: {
        pageId: { type: 'string', description: 'The page UUID.' },
        propertyName: { type: 'string', description: 'The property name (e.g. "tags", "status", "priority").' },
        value: {
          description:
            'The property value. Pass the native JSON type matching the property kind: ' +
            'string for text, number for number, boolean for checkbox, ' +
            'array of strings for tags / multi-select (e.g. ["Journal","Daily"] — not "[\\"Journal\\",\\"Daily\\"]").',
          oneOf: [
            { type: 'string' },
            { type: 'number' },
            { type: 'boolean' },
            { type: 'array', items: { type: 'string' } },
          ],
        },
      },
    },
    requiresConfirmation: true,
    permissionLevel: 'requires-approval' as ToolPermissionLevel,
    async handler(args: Record<string, unknown>, _token: ICancellationToken): Promise<IToolResult> {
      requireDb(db);
      const pageId = String(args['pageId'] || '');
      const propertyName = String(args['propertyName'] || '').trim();
      let value = args['value'];

      if (!pageId) { return { content: 'pageId is required', isError: true }; }
      if (!propertyName) { return { content: 'propertyName is required', isError: true }; }
      if (value === undefined) { return { content: 'value is required', isError: true }; }

      // Safety net for small local models that stringify a JSON array instead of
      // passing it natively. A string that fully parses to a JSON array is never
      // a legitimate text value — recover it as the array the model meant.
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
          try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed)) { value = parsed; }
          } catch { /* keep original string */ }
        }
      }

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
    name: 'canvas_create_page',
    displaySummary: 'Create a new canvas page.',
    description: 'Create a CANVAS PAGE (in the canvas page DB). Use markdown for structured body. For files on disk (.md, .txt, code, etc.) use `write_file` instead.',
    parameters: {
      type: 'object',
      required: ['title'],
      properties: {
        title: { type: 'string', description: 'Page title.' },
        markdown: { type: 'string', description: 'Markdown body.' },
        content: { type: 'string', description: 'Deprecated: plain text body (use markdown instead).' },
        icon: { type: 'string', description: 'Icon emoji.' },
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
 * If a `notifyPageMutated` callback is wired, fires `'updated'` after the
 * write so the canvas data service re-reads the page, fires `onDidChangePage`
 * (sidebar refresh), and signals `onRequestContentReload` so any open editor
 * reloads the new content. Local unsaved edits in the open editor will be
 * blown away by the reload — acceptable trade for AI/user co-authoring.
 */
export function createComposePageTool(
  db: IBuiltInToolDatabase | undefined,
  notifyPageMutated?: PageMutationNotifier,
): IChatTool {
  return {
    name: 'canvas_compose_page',
    displaySummary: 'Write or update a canvas page from markdown.',
    description: 'Write or update a CANVAS PAGE (in the canvas page DB) from markdown. mode: replace (default), append, or prepend. For files on disk use `write_file` or `edit_file` instead.',
    parameters: {
      type: 'object',
      required: ['pageId', 'markdown'],
      properties: {
        pageId: { type: 'string', description: 'Page UUID.' },
        markdown: { type: 'string', description: 'Markdown body.' },
        mode: {
          type: 'string',
          enum: ['replace', 'append', 'prepend'],
          description: 'Combine mode (default: replace).',
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
      // M77 Phase 10.1 — bump `revision` so the canvas data service's
      // optimistic-concurrency tracking sees this external write. Without
      // the bump a user's pending auto-save (captured with the pre-AI
      // revision) would silently succeed and overwrite the AI's content.
      // With the bump it conflicts and surfaces, which is the correct
      // behaviour for co-authoring.
      await db!.run(
        'UPDATE pages SET content = ?, content_schema_version = ?, updated_at = ?, revision = revision + 1 WHERE id = ?',
        [encoded.storedContent, encoded.schemaVersion, now, pageId],
      );

      // Notify the canvas data service so the sidebar refreshes and any
      // open editor for this page reloads its content.
      try { notifyPageMutated?.(pageId, 'updated'); } catch { /* never block the tool result on notifier errors */ }

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
// ── Cover-image path resolution (for canvas_set_page_style) ──
//
// The canvas pane renders `pages.cover_url` via `background-image: url(...)`,
// which means the CSP forbids `file://` and relative paths don't resolve
// the way a model would expect. To make `coverUrl` ergonomic for both AI
// and user input, the tool accepts THREE shapes and normalises to one of
// two storable forms:
//
//   pass-through (stored verbatim):
//     - http://… / https://…           → web URL
//     - data:image/…                    → already a data URL
//     - linear-gradient(…) / radial-…   → gradient
//
//   resolved to a data: URL before storing:
//     - workspace-relative path (e.g. "Skills/CoverImages/foo.png")
//     - absolute filesystem path / `file://` URL
//
// The data-URL conversion uses the renderer-side `window.parallxElectron.fs.readFile`
// IPC. Workspace-relative paths are joined against the workspace root that
// `registerBuiltInTools` already threads through the tool factory.

const _COVER_IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif']);
const _COVER_MAX_BASE64 = Math.floor(5 * 1024 * 1024 * 1.37); // ~5 MB raw image

function _coverExtToMime(ext: string): string {
  const e = ext.toLowerCase();
  if (e === 'jpg' || e === 'jpeg') return 'image/jpeg';
  if (e === 'svg') return 'image/svg+xml';
  return `image/${e}`;
}

function _coverIsPassthrough(v: string): boolean {
  return /^(?:https?:|data:|linear-gradient|radial-gradient)/i.test(v);
}

function _coverAbsoluteCandidate(v: string): string | null {
  // file:// URL — strip prefix, decode percent-escapes.
  if (v.startsWith('file:///')) {
    try {
      let p = decodeURIComponent(v.slice(8));
      if (!/^[a-zA-Z]:/.test(p) && !p.startsWith('/')) p = '/' + p;
      return p;
    } catch {
      return null;
    }
  }
  if (v.startsWith('file://')) {
    try { return decodeURIComponent(v.slice(7)); } catch { return null; }
  }
  // Drive letter (Windows) or POSIX absolute.
  if (/^[a-zA-Z]:[\\/]/.test(v) || v.startsWith('/') || v.startsWith('\\')) {
    return v;
  }
  return null;
}

function _joinWorkspacePath(workspaceRoot: string, relative: string): string {
  const sep = workspaceRoot.includes('\\') && !workspaceRoot.includes('/') ? '\\' : '/';
  const trimmedRoot = workspaceRoot.replace(/[\\/]+$/, '');
  const cleanedRel = relative.replace(/^\.\/+/, '').replace(/^[\\/]+/, '');
  return `${trimmedRoot}${sep}${cleanedRel.replace(/\\/g, sep).replace(/\//g, sep)}`;
}

/**
 * Resolve `rawCoverUrl` into a value safe to store in `pages.cover_url`.
 * Returns either the original string (for http/data/gradient values) or
 * a `data:image/...;base64,...` URL (for local paths). Surfaces errors
 * with messages aimed at the model so it can retry with a better path.
 */
async function _resolveCoverUrlForStorage(
  rawCoverUrl: string,
  workspaceRoot: string | undefined,
): Promise<{ value: string | null; error?: string }> {
  const v = rawCoverUrl.trim();
  if (v === '') return { value: null }; // empty → clear cover

  // Pass-through forms.
  if (_coverIsPassthrough(v)) return { value: v };

  // Determine absolute path to read.
  const absoluteCandidate = _coverAbsoluteCandidate(v);
  let absolutePath: string;
  if (absoluteCandidate !== null) {
    absolutePath = absoluteCandidate;
  } else if (workspaceRoot) {
    absolutePath = _joinWorkspacePath(workspaceRoot, v);
  } else {
    return { value: null, error: `Cannot resolve "${v}" — no workspace root available. Provide an http(s):// URL, a data: URL, or open a workspace first.` };
  }

  // Validate extension before reading so an obviously-wrong path fails fast.
  const ext = absolutePath.split('.').pop()?.toLowerCase() || '';
  if (!_COVER_IMAGE_EXTS.has(ext)) {
    return { value: null, error: `"${v}" does not look like an image (need ${[..._COVER_IMAGE_EXTS].join('/')}).` };
  }

  // Read via the renderer-side electron IPC. This is the same path the
  // canvas pane's drag-drop / upload menus use; centralised in
  // src/built-in/canvas/menus/imagePathResolver.ts but re-implemented
  // here to keep the chat tool from importing across extensions.
  const electron = (globalThis as { window?: { parallxElectron?: { fs?: { readFile?: (p: string, encoding: string) => Promise<{ encoding?: string; content?: string; error?: { message?: string; code?: string } }> } } } })
    .window?.parallxElectron;
  const readFile = electron?.fs?.readFile;
  if (!readFile) {
    return { value: null, error: 'Local file reads unavailable in this build — use an http(s):// or data: URL instead.' };
  }

  try {
    const result = await readFile(absolutePath, 'base64');
    if (result?.error) {
      const msg = typeof result.error === 'string'
        ? result.error
        : (result.error?.message || result.error?.code || 'unknown error');
      return { value: null, error: `Could not read "${v}" (resolved to ${absolutePath}): ${msg}` };
    }
    if (!result?.content) {
      return { value: null, error: `"${v}" is empty or unreadable.` };
    }
    if (result.encoding !== 'base64') {
      return { value: null, error: `"${v}" did not return as a binary image.` };
    }
    if (result.content.length > _COVER_MAX_BASE64) {
      return { value: null, error: `"${v}" is too large to inline as a cover (max 5 MB).` };
    }
    return { value: `data:${_coverExtToMime(ext)};base64,${result.content}` };
  } catch (err) {
    return { value: null, error: `Cover read failed: ${(err as Error)?.message ?? 'unknown error'}` };
  }
}

export function createSetPageStyleTool(
  db: IBuiltInToolDatabase | undefined,
  notifyPageMutated?: PageMutationNotifier,
  workspaceRoot?: string,
): IChatTool {
  return {
    name: 'canvas_set_page_style',
    displaySummary: 'Update a canvas page\'s style (icon, cover, font, width).',
    description:
      'Update a CANVAS PAGE\'s display settings (icon, cover image, font family, full-width, small-text). ' +
      'Operates on the canvas page DB. Omit unchanged fields.\n\n' +
      'coverUrl accepts:\n' +
      '  • An http(s):// URL (stored as-is)\n' +
      '  • A data:image/… URL (stored as-is)\n' +
      '  • A workspace-relative path with forward slashes, no leading "./" or "..", e.g. "Skills/CoverImages/foo.png" — read off disk into a data URL\n' +
      '  • An empty string to clear the existing cover\n\n' +
      'Supported image extensions: png, jpg, jpeg, gif, webp, svg, bmp, avif. Max 5 MB.',
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
            coverUrl: {
              type: 'string',
              description: 'Cover: http(s):// URL, data: URL, workspace-relative path (e.g. "Skills/CoverImages/foo.png"), or empty string to clear.',
            },
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
        const raw = String(style['coverUrl'] ?? '');
        const resolved = await _resolveCoverUrlForStorage(raw, workspaceRoot);
        if (resolved.error) {
          return { content: resolved.error, isError: true };
        }
        sets.push('cover_url = ?');
        params.push(resolved.value);
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
      // M77 Phase 10.1 — bump `revision` so the canvas data service's
      // optimistic-concurrency tracking treats this as a real write and
      // a concurrent user save can't silently overwrite the style change.
      sets.push('revision = revision + 1');
      params.push(now);
      params.push(pageId);

      await db!.run(
        `UPDATE pages SET ${sets.join(', ')} WHERE id = ?`,
        params,
      );

      // Notify the canvas data service so the sidebar reflects icon/cover
      // changes immediately and any open editor refreshes its chrome.
      try { notifyPageMutated?.(pageId, 'updated'); } catch { /* never block the tool result on notifier errors */ }

      return { content: `Updated page "${page.title}" style: ${changed.join(', ')}.` };
    },
  };
}
