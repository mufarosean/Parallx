// pageTools.ts — Canvas page AI tools. Owned by the canvas tool: registered
// from canvas/main.ts activate() via canvasAITools.ts (M84 — moved out of the
// chat module so the extension that owns the data model also owns its tools).

import type {
  IChatTool,
  IToolResult,
  ICancellationToken,
  ToolPermissionLevel,
  IChatToolInvocationCallContext,
} from '../../../services/chatTypes.js';
import { markResourceSeen, wasResourceSeen, pageResourceKey } from '../../../services/toolResourceRegistry.js';
import type {
  IBuiltInToolDatabase,
  CurrentPageIdGetter,
  PageMutationNotifier,
} from '../../chat/chatTypes.js';
import { extractSnippet, extractTextContent } from '../../chat/tools/builtInTools.js';
import { markdownToTiptapJson } from '../markdownImport.js';
import {
  decodeCanvasContent,
  encodeCanvasContentFromDoc,
} from '../contentSchema.js';
import { filterToSubquery, type IPropertyFilter, type IPropertySort } from './blockApi.js';
import type { CanvasTemplateApi } from '../canvasTemplates.js';
import { getAllCanvasTemplates } from '../canvasTemplates.js';
import { listFonts, getFont } from '../config/fontRegistry.js';

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
      'Discovers canvas pages by full-text query, property filter, or both. No args lists recent pages. ' +
      'Use when you do NOT already know which page to read — e.g. "pages tagged X", "pages mentioning Y", ' +
      '"all status=open pages". ' +
      'If you already know the page title or UUID, call `canvas_read_page` directly — skip this tool. ' +
      'For files on disk use `fs_search_files` (name) or `fs_grep_search` (contents). ' +
      'Filter ops: equals, not_equals, contains, is_empty, is_not_empty, greater_than, less_than.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Full-text search across page title and body (case-insensitive). Omit for a recency-sorted listing.' },
        filter: {
          type: 'array',
          description: 'Property filters combined with AND. Each entry checks one page property.',
          items: {
            type: 'object',
            required: ['prop', 'op'],
            properties: {
              prop: { type: 'string', description: 'Property name (e.g. "tags", "status").' },
              op: {
                type: 'string',
                enum: ['equals', 'not_equals', 'contains', 'is_empty', 'is_not_empty', 'greater_than', 'less_than'],
                description: 'Comparison operator. `is_empty`/`is_not_empty` ignore `value`.',
              },
              value: { description: 'Right-hand side of the comparison. Type must match the property (string, number, boolean, or array). Omit for is_empty/is_not_empty.' },
            },
          },
        },
        sort: {
          type: 'object',
          description: 'Result ordering. Defaults to `updated_at desc` when omitted.',
          properties: {
            by: { type: 'string', description: 'Column or property name to sort by (e.g. "updated_at", "title", or any property name).' },
            dir: { type: 'string', enum: ['asc', 'desc'], description: 'Sort direction.' },
          },
        },
        group: { type: 'string', description: 'Property name to group results by (e.g. "status"). Results come back as a nested list per group.' },
        limit: { type: 'number', description: 'Maximum results (default 50, cap 200).' },
      },
    },
    requiresConfirmation: false,
    permissionLevel: 'always-allowed' as ToolPermissionLevel,
    category: 'canvas',
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
        else sortClause = `(SELECT ppv.value FROM page_property_values ppv JOIN database_properties dp ON dp.id = ppv.property_id AND dp.database_id = ppv.database_id WHERE ppv.page_id = p.id AND dp.name = ${escapeSqlLiteral(sort.by)} LIMIT 1) ${dir}`;
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
          `SELECT ppv.page_id as page_id, ppv.value as value FROM page_property_values ppv JOIN database_properties dp ON dp.id = ppv.property_id AND dp.database_id = ppv.database_id WHERE dp.name = ? AND ppv.page_id IN (${placeholders})`,
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
    displaySummary: 'Read a canvas page (body + metadata + properties).',
    description:
      'Reads a canvas page from the workspace page database (not a file on disk). ' +
      'Returns the page body, metadata (title, id, icon, timestamps, archived state, block count), and any custom properties. ' +
      'Each top-level block in the body is prefixed with its `[blockId]` — pass that id to `canvas_edit_block` or `canvas_read_block` to target a specific block. ' +
      '`pageId` accepts a page UUID, a case-insensitive page title, or the literal "current" for the page open in the editor. ' +
      'Use this directly when you know the page title — do NOT call `canvas_find_pages` first to resolve a known title. ' +
      'For files on disk use `fs_read_file`. ' +
      'For workspace-wide property definitions use `canvas_list_property_definitions`.',
    parameters: {
      type: 'object',
      required: ['pageId'],
      properties: {
        pageId: { type: 'string', description: 'Page UUID, page title (case-insensitive exact match, falls back to partial match), or "current" for the editor page. Pass the title directly — this tool resolves it.' },
      },
    },
    requiresConfirmation: false,
    permissionLevel: 'always-allowed' as ToolPermissionLevel,
    category: 'canvas',
    async handler(args: Record<string, unknown>, _token: ICancellationToken, invocation?: IChatToolInvocationCallContext): Promise<IToolResult> {
      requireDb(db);
      const identifier = String(args['pageId'] || '').trim();
      if (!identifier) {
        return { content: 'pageId is required', isError: true };
      }

      // Resolve the page row (full metadata, not just body).
      type PageRow = {
        id: string;
        title: string;
        content: string;
        icon: string | null;
        is_archived: number;
        created_at: string;
        updated_at: string;
      };
      const PAGE_COLS = 'id, title, content, icon, is_archived, created_at, updated_at';
      let page: PageRow | undefined | null = undefined;
      let isCurrent = false;

      // Special form: 'current' → resolve to the active editor page.
      if (identifier.toLowerCase() === 'current') {
        const currentId = getCurrentPageId?.();
        if (!currentId) {
          return { content: 'No page is currently open in the editor.', isError: true };
        }
        page = await db!.get<PageRow>(`SELECT ${PAGE_COLS} FROM pages WHERE id = ?`, [currentId]);
        if (!page) {
          return { content: `The active editor page (${currentId}) was not found in the database.`, isError: true };
        }
        isCurrent = true;
      } else {
        // Try UUID lookup first (exact match)
        page = await db!.get<PageRow>(`SELECT ${PAGE_COLS} FROM pages WHERE id = ?`, [identifier]);

        // Fallback: case-insensitive exact title match
        if (!page) {
          page = await db!.get<PageRow>(
            `SELECT ${PAGE_COLS} FROM pages WHERE is_archived = 0 AND LOWER(title) = LOWER(?)`,
            [identifier],
          );
        }

        // Fallback: partial title match (LIKE)
        if (!page) {
          page = await db!.get<PageRow>(
            `SELECT ${PAGE_COLS} FROM pages WHERE is_archived = 0 AND title LIKE ? ORDER BY updated_at DESC`,
            [`%${identifier}%`],
          );
        }
      }

      if (!page) {
        return { content: `Page "${identifier}" not found. Use canvas_find_pages to see available pages.`, isError: true };
      }

      // M85 Slice C — a successful read marks the RESOLVED page as seen for
      // this session, unlocking the canvas mutation tools on it.
      if (invocation?.sessionId) {
        markResourceSeen(invocation.sessionId, pageResourceKey(page.id));
      }

      // Folded from the former canvas_get_page tool: include block count + properties.
      const blockCount = await db!.get<{ cnt: number }>(
        'SELECT COUNT(*) as cnt FROM canvas_blocks WHERE page_id = ?',
        [page.id],
      );

      // Properties live in databases: read this page's cell values across all
      // databases it is a member of (name + type from the database schema).
      const props = await db!.all<{
        key: string;
        value_type: string;
        value: string;
        def_type: string | null;
        db_title: string | null;
      }>(
        `SELECT dp.name as key, dp.type as value_type, ppv.value as value, dp.type as def_type, pg.title as db_title
           FROM page_property_values ppv
           JOIN database_properties dp ON dp.id = ppv.property_id AND dp.database_id = ppv.database_id
           LEFT JOIN pages pg ON pg.id = ppv.database_id
          WHERE ppv.page_id = ?`,
        [page.id],
      );

      const text = extractBlocksWithIds(page.content);
      const lines: (string | null)[] = [
        `**${page.title}** (id: ${page.id})${isCurrent ? ' — currently open' : ''}`,
        page.icon ? `**Icon:** ${page.icon}` : null,
        `**Created:** ${page.created_at}`,
        `**Updated:** ${page.updated_at}`,
        page.is_archived ? '**Archived:** Yes' : null,
        `**Blocks:** ${blockCount?.cnt ?? 0}`,
      ];

      if (props.length > 0) {
        lines.push('', '**Database Properties:**');
        for (const prop of props) {
          const displayType = prop.def_type || prop.value_type;
          const formatted = formatPropertyValue(prop.value, displayType);
          lines.push(`- **${prop.key}** (${displayType}${prop.db_title ? `, in "${prop.db_title}"` : ''}): ${formatted}`);
        }
      }

      lines.push('', text || '(empty page)');
      return { content: lines.filter((l) => l !== null).join('\n') };
    },
  };
}

// M81 Phase 9 — `createGetPageTool` was folded into `createReadPageTool`. The
// merged tool returns body + metadata + custom properties in one call. For
// workspace-wide property definitions, use `canvas_list_property_definitions`.

/** Plain text of a Tiptap node (concatenated text leaves). */
function nodeTextOf(node: unknown): string {
  if (!node || typeof node !== 'object') return '';
  const n = node as { type?: string; text?: string; content?: unknown[] };
  if (n.type === 'text' && typeof n.text === 'string') return n.text;
  if (Array.isArray(n.content)) return n.content.map(nodeTextOf).join('');
  return '';
}

/**
 * Render the page body as one line per TOP-LEVEL block, each prefixed with its
 * stable `[blockId]`, so the model can target a block with `canvas_edit_block`
 * / `canvas_read_block`. Falls back to flat text when the content can't be
 * parsed as a Tiptap doc.
 */
function extractBlocksWithIds(content: string): string {
  try {
    const parsed = JSON.parse(content) as { doc?: { content?: unknown[] }; content?: unknown[] };
    const doc = (parsed.doc && typeof parsed.doc === 'object') ? parsed.doc : parsed;
    const blocks = Array.isArray(doc.content) ? doc.content : [];
    if (blocks.length === 0) return '';
    const lines: string[] = [];
    for (const b of blocks) {
      const block = b as { type?: string; attrs?: Record<string, unknown> };
      const id = block.attrs?.['id'];
      const idTag = typeof id === 'string' && id ? `[${id}] ` : '';
      const text = nodeTextOf(b).trim();
      lines.push(`${idTag}${text || `(${block.type ?? 'block'})`}`);
    }
    return lines.join('\n');
  } catch {
    return extractTextContent(content);
  }
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
    displaySummary: 'List databases and their property schemas.',
    description:
      'List every DATABASE in the workspace with its property schema (column names + types). ' +
      'Properties live in databases (Notion model) — pages get properties by being database members. ' +
      'Use the returned database id with canvas_query_database / canvas_add_database_row / canvas_set_page_property.',
    parameters: {
      type: 'object',
      properties: {},
    },
    requiresConfirmation: false,
    permissionLevel: 'always-allowed' as ToolPermissionLevel,
    category: 'canvas',
    async handler(_args: Record<string, unknown>, _token: ICancellationToken): Promise<IToolResult> {
      requireDb(db);

      const dbs = await db!.all<{ id: string; title: string }>(
        'SELECT d.id, p.title FROM databases d JOIN pages p ON p.id = d.id WHERE p.is_archived = 0 ORDER BY p.title',
      );
      if (dbs.length === 0) {
        return { content: 'No databases in the workspace. Create one with canvas_create_database.' };
      }
      const props = await db!.all<{ database_id: string; name: string; type: string }>(
        'SELECT database_id, name, type FROM database_properties ORDER BY sort_order',
      );
      const lines: string[] = [];
      for (const d of dbs) {
        const cols = props.filter((p) => p.database_id === d.id);
        lines.push(`- **${d.title}** (id: ${d.id}) — columns: Title${cols.length ? ', ' + cols.map((c) => `${c.name} (${c.type})`).join(', ') : ''}`);
      }
      return { content: `${dbs.length} database(s):\n\n${lines.join('\n')}` };
    },
  };
}

export function createSetPagePropertyTool(
  db: IBuiltInToolDatabase | undefined,
  notifyDatabaseRowsChanged?: (databaseId: string) => void,
): IChatTool {
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
        pageId: { type: 'string', description: 'Page UUID (not a title). If you only have a title, call canvas_read_page or canvas_find_pages first to resolve.' },
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
    category: 'canvas',
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

      // Properties live in DATABASES (Notion model): the page must be a member
      // of at least one database. Resolve the property by name across its
      // memberships; create the property on the first membership if missing.
      const memberships = await db!.all<{ database_id: string; title: string }>(
        `SELECT dpg.database_id, p.title FROM database_pages dpg JOIN pages p ON p.id = dpg.database_id WHERE dpg.page_id = ? ORDER BY dpg.created_at`,
        [pageId],
      );
      if (memberships.length === 0) {
        return {
          content:
            `Page "${page.title}" is not in any database — properties live in databases. ` +
            `Add it with canvas_add_page_to_database (see canvas_list_property_definitions for databases), ` +
            `or create a row with canvas_add_database_row.`,
          isError: true,
        };
      }

      let target: { database_id: string; title: string } | undefined;
      let prop = undefined as { id: string; type: string } | undefined;
      for (const m of memberships) {
        const found = await db!.get<{ id: string; type: string }>(
          'SELECT id, type FROM database_properties WHERE database_id = ? AND LOWER(name) = LOWER(?)',
          [m.database_id, propertyName],
        );
        if (found) { target = m; prop = found; break; }
      }
      if (!prop) {
        // Create the column on the first membership database.
        target = memberships[0];
        const inferredType = inferPropertyType(value);
        const propId = generateId();
        const orderRow = await db!.get<{ max_sort: number }>(
          'SELECT MAX(sort_order) as max_sort FROM database_properties WHERE database_id = ?',
          [target.database_id],
        );
        await db!.run(
          'INSERT INTO database_properties (id, database_id, name, type, config, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
          [propId, target.database_id, propertyName, inferredType, '{}', ((orderRow?.max_sort as number) ?? 0) + 1],
        );
        prop = { id: propId, type: inferredType };
      }

      const serialized = JSON.stringify(value);
      await db!.run(
        `INSERT INTO page_property_values (page_id, property_id, database_id, value, updated_at)
         VALUES (?, ?, ?, ?, datetime('now'))
         ON CONFLICT(page_id, property_id, database_id)
         DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
        [pageId, prop.id, target!.database_id, serialized],
      );
      try { notifyDatabaseRowsChanged?.(target!.database_id); } catch { /* non-fatal */ }

      return { content: `Set property '${propertyName}' = ${serialized} on page '${page.title}' (database "${target!.title}").` };
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

/**
 * canvas_list_templates — enumerate all available canvas page templates.
 *
 * Returns built-in and user templates with their id, name, description, and
 * a structural snapshot of headings. The AI uses this to decide whether a
 * template fits the user's request before calling canvas_create_page with a
 * templateId.
 */
export function createListTemplatesTool(templateApi: CanvasTemplateApi | undefined): IChatTool {
  return {
    name: 'canvas_list_templates',
    displaySummary: 'List available canvas page templates.',
    description:
      'List all available canvas page templates (built-in and user-created). ' +
      'Call this BEFORE creating a page when the user\'s request might match an existing template ' +
      '(e.g. "meeting notes", "daily journal", "project plan"). ' +
      'Each entry has an `id` to pass as `templateId` to `canvas_create_page`, a `name`, `description`, ' +
      'and a structural `snapshot` listing the template\'s key sections. ' +
      'If no template fits the request, create a blank page with `canvas_create_page` (omit `templateId`).',
    parameters: { type: 'object', properties: {} },
    requiresConfirmation: false,
    permissionLevel: 'always-allowed' as ToolPermissionLevel,
    category: 'canvas',
    async handler(_args: Record<string, unknown>, _token: ICancellationToken): Promise<IToolResult> {
      if (!templateApi) {
        return { content: 'Template API unavailable.', isError: true };
      }
      const templates = await getAllCanvasTemplates(templateApi);
      if (templates.length === 0) {
        return { content: 'No templates available.' };
      }
      const builtins = templates.filter((t) => t.source === 'builtin');
      const userTpls = templates.filter((t) => t.source === 'user');
      const lines: string[] = [];
      if (builtins.length > 0) {
        lines.push('**Built-in templates:**');
        for (const t of builtins) {
          const snap = t.snapshot ? ` | ${t.snapshot}` : '';
          lines.push(`- \`${t.id}\` — ${t.name}: ${t.description}${snap}`);
        }
      }
      if (userTpls.length > 0) {
        lines.push('**User templates:**');
        for (const t of userTpls) {
          const snap = t.snapshot ? ` | ${t.snapshot}` : '';
          lines.push(`- \`${t.id}\` — ${t.name}: ${t.description}${snap}`);
        }
      } else {
        lines.push('*No user templates saved yet.*');
      }
      return { content: lines.join('\n') };
    },
  };
}

/** Streams an already-known markdown body into the open editor block-by-block
 *  (the live-typing effect). Returns true when it streamed + committed; false →
 *  the caller must write the body to the DB itself. Implemented in main.ts. */
export type StreamPageBodyFn = (pageId: string, markdown: string, waitMs?: number) => Promise<boolean>;

/** Layout defaults applied to AI-created pages (backed by registry settings;
 *  see CANVAS_AI_PAGE_*_KEY). Both default ON in production. */
export interface NewPageLayoutDefaults {
  readonly fullWidth: boolean;
  readonly smallText: boolean;
}

/** Registry setting keys for AI-created-page layout defaults. Registered in
 *  chat/main.ts (the settings bootstrap); kept as plain literals there to avoid
 *  a chat→canvas import cycle — keep both in sync. */
export const CANVAS_AI_PAGE_FULL_WIDTH_KEY = 'canvas.aiPages.fullWidth';
export const CANVAS_AI_PAGE_SMALL_TEXT_KEY = 'canvas.aiPages.smallText';

export function createCreatePageTool(
  db: IBuiltInToolDatabase | undefined,
  notifyPageMutated?: PageMutationNotifier,
  templateApi?: CanvasTemplateApi,
  createChildPage?: (parentId: string, title: string) => Promise<string>,
  streamPageBody?: StreamPageBodyFn,
  getNewPageDefaults?: () => NewPageLayoutDefaults,
): IChatTool {
  return {
    name: 'canvas_create_page',
    displaySummary: 'Create a NEW canvas page (blank or from template).',
    description:
      'CREATE a NEW canvas page in the canvas page DB. The UUID is generated automatically — do NOT pass one. ' +
      'Use this only when the page does not yet exist. ' +
      'The result returns the new page\'s id — for ANY follow-up edits to that page (the user asks for "more", a new section, a rewrite) REUSE that id with `canvas_edit_page`. Do NOT call `canvas_create_page` again for the same page; that creates a duplicate. ' +
      'To edit an EXISTING page (you have its UUID), use `canvas_edit_page`. ' +
      'For files on disk (.md, .txt, code, etc.) use `fs_write_file` instead.\n\n' +
      'TEMPLATE GUIDANCE: Before creating a blank page, call `canvas_list_templates` to check whether an existing template matches the request. ' +
      'If a template fits (e.g. meeting notes, daily journal, project brief), pass its `id` as `templateId` to seed the page with that structure. ' +
      'After creating from a template, fill in specific data with `canvas_edit_page`. ' +
      'Omit `templateId` for a blank or markdown-seeded page.',
    parameters: {
      type: 'object',
      required: ['title'],
      properties: {
        title: { type: 'string', description: 'Page title.' },
        parentId: { type: 'string', description: 'Optional UUID of an EXISTING page to nest the new page under. Creates a proper SUB-PAGE: the parent page gets a sub-page card and the sidebar nests it. Omit for a top-level page.' },
        templateId: { type: 'string', description: 'Template id from `canvas_list_templates`. Seeds the new page with that template\'s structure. When provided, `markdown` is ignored.' },
        markdown: { type: 'string', description: 'Markdown body. Used only when `templateId` is not provided.' },
        content: { type: 'string', description: 'Deprecated: plain text body (use markdown instead).' },
        icon: { type: 'string', description: 'Icon emoji.' },
      },
    },
    requiresConfirmation: true,
    permissionLevel: 'requires-approval' as ToolPermissionLevel,
    category: 'canvas',
    async handler(args: Record<string, unknown>, _token: ICancellationToken, invocation?: IChatToolInvocationCallContext): Promise<IToolResult> {
      requireDb(db);
      const title = String(args['title'] || '').trim();
      if (!title) {
        return { content: 'Title is required', isError: true };
      }

      const id = generateId();
      // M85 Slice C — the creator authored this page's content: mark it seen
      // so follow-up edits in the same session aren't blocked. (Marked up
      // front — every success path below returns separately.)
      if (invocation?.sessionId) {
        markResourceSeen(invocation.sessionId, pageResourceKey(id));
      }
      const icon = args['icon'] ? String(args['icon']) : null;
      const templateId = args['templateId'] ? String(args['templateId']) : '';
      const now = new Date().toISOString();

      // Layout defaults for AI-created pages (registry-backed; default ON in
      // production, off when unwired e.g. in tests).
      const layout = getNewPageDefaults?.() ?? { fullWidth: false, smallText: false };
      const fullWidthCol = layout.fullWidth ? 1 : 0;
      const smallTextCol = layout.smallText ? 1 : 0;

      let doc: { type: 'doc'; content: unknown[] };
      let fromTemplate = false;

      if (templateId && templateApi) {
        // Resolve template by id and seed doc from its structure.
        const templates = await getAllCanvasTemplates(templateApi);
        const tpl = templates.find((t) => t.id === templateId);
        if (!tpl) {
          return {
            content: `Template "${templateId}" not found. Call \`canvas_list_templates\` to see available template ids.`,
            isError: true,
          };
        }
        const built = tpl.buildDoc();
        doc = (built && typeof built === 'object' && (built as any).type === 'doc' && Array.isArray((built as any).content))
          ? built as { type: 'doc'; content: unknown[] }
          : { type: 'doc', content: [{ type: 'paragraph' }] };
        fromTemplate = true;
      } else {
        // Blank or markdown-seeded page.
        const markdown = typeof args['markdown'] === 'string' ? args['markdown'] : '';
        const plainContent = typeof args['content'] === 'string' ? args['content'] : '';
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
      }

      const encoded = encodeCanvasContentFromDoc(doc as Parameters<typeof encodeCanvasContentFromDoc>[0]);

      // Sub-page path: parentId present → atomic create (page row + the
      // pageBlock card on the parent in ONE transaction, via the data
      // service), then fill in the body/icon with a follow-up update.
      const parentId = typeof args['parentId'] === 'string' ? (args['parentId'] as string).trim() : '';
      if (parentId) {
        if (!createChildPage) {
          return { content: 'Sub-page creation is unavailable (no canvas data service).', isError: true };
        }
        const parentRow = await db!.get<{ id: string }>('SELECT id FROM pages WHERE id = ?', [parentId]);
        if (!parentRow) {
          return { content: `Parent page not found: ${parentId}. Pass an existing page UUID (resolve titles via canvas_find_pages).`, isError: true };
        }
        let childId: string;
        try { childId = await createChildPage(parentId, title); }
        catch (err) { return { content: `Sub-page creation failed: ${err instanceof Error ? err.message : String(err)}`, isError: true }; }
        // Sub-pages get a data-service id, not the pre-generated one.
        if (invocation?.sessionId) {
          markResourceSeen(invocation.sessionId, pageResourceKey(childId));
        }
        await db!.run(
          'UPDATE pages SET icon = ?, content = ?, content_schema_version = ?, full_width = ?, small_text = ?, updated_at = ?, revision = revision + 1 WHERE id = ?',
          [icon, encoded.storedContent, encoded.schemaVersion, fullWidthCol, smallTextCol, now, childId],
        );
        try { notifyPageMutated?.(childId, 'updated'); } catch { /* non-fatal */ }
        const subBlockCount = doc.content.length;
        return { content: `Created sub-page "${title}" (id: ${childId}) under ${parentId} with ${subBlockCount} block${subBlockCount === 1 ? '' : 's'} — the parent page got its sub-page card.` };
      }

      // Streaming create: a plain markdown body (no template) and a stream fn →
      // insert an EMPTY page, open it, and TYPE the body in live. Falls back to
      // a normal write if the page can't be opened/streamed.
      const mdBody = typeof args['markdown'] === 'string' ? (args['markdown'] as string) : '';
      if (streamPageBody && !templateId && mdBody.trim()) {
        const emptyEnc = encodeCanvasContentFromDoc({ type: 'doc', content: [{ type: 'paragraph' }] } as Parameters<typeof encodeCanvasContentFromDoc>[0]);
        await db!.run(
          'INSERT INTO pages (id, title, icon, content, content_schema_version, is_archived, full_width, small_text, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)',
          [id, title, icon, emptyEnc.storedContent, emptyEnc.schemaVersion, fullWidthCol, smallTextCol, now, now],
        );
        try { notifyPageMutated?.(id, 'created'); } catch { /* opens the blank page + refreshes the sidebar */ }
        const streamed = await streamPageBody(id, mdBody, 2500);
        if (!streamed) {
          await db!.run(
            'UPDATE pages SET content = ?, content_schema_version = ?, updated_at = ?, revision = revision + 1 WHERE id = ?',
            [encoded.storedContent, encoded.schemaVersion, new Date().toISOString(), id],
          );
          try { notifyPageMutated?.(id, 'updated'); } catch { /* non-fatal */ }
        }
        const blocks = doc.content.length;
        return { content: `Created page "${title}" (id: ${id}) — ${streamed ? 'streamed live into the editor' : 'written'} (${blocks} block${blocks === 1 ? '' : 's'}).` };
      }

      await db!.run(
        'INSERT INTO pages (id, title, icon, content, content_schema_version, is_archived, full_width, small_text, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)',
        [id, title, icon, encoded.storedContent, encoded.schemaVersion, fullWidthCol, smallTextCol, now, now],
      );

      // Notify the canvas data service so the sidebar (and other listeners)
      // refresh promptly. Raw SQL bypasses CanvasDataService.createPage, which
      // is normally where `onDidChangePage` fires.
      try { notifyPageMutated?.(id, 'created'); } catch { /* never block the tool result on notifier errors */ }

      const blockCount = doc.content.length;
      const source = fromTemplate ? `from template "${templateId}"` : 'blank';
      return { content: `Created page "${title}" (id: ${id}) ${source} with ${blockCount} block${blockCount === 1 ? '' : 's'}.` };
    },
  };
}

/**
 * edit_page — update an existing canvas page from markdown.
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
 * (sidebar refresh), and signals `onRequestContentReload`. An open editor then
 * STREAMS the change in block-by-block (the animated reload) — unless the user
 * is editing inside the changed span, in which case it applies instantly so
 * their cursor isn't disturbed.
 */
export function createEditPageTool(
  db: IBuiltInToolDatabase | undefined,
  notifyPageMutated?: PageMutationNotifier,
  checkpointPage?: (pageId: string) => void | Promise<void>,
): IChatTool {
  return {
    name: 'canvas_edit_page',
    displaySummary: 'Edit (update) an existing canvas page from markdown.',
    description:
      'EDIT an EXISTING canvas page in the canvas page DB. Requires the page\'s UUID — this tool does NOT create new pages. ' +
      'Use `canvas_create_page` to make a new page (which auto-assigns the UUID). ' +
      'Use `canvas_read_page` or `canvas_find_pages` first if you only have a title and need the UUID. ' +
      '`mode` controls how `markdown` combines with the existing body: `replace` (default) wipes and rewrites; `append` adds after; `prepend` adds before. ' +
      'When the page is open in the editor, the change streams in live, block-by-block — you don\'t need to reopen it. ' +
      'For files on disk use `fs_write_file` or `fs_edit_file` instead.',
    parameters: {
      type: 'object',
      required: ['pageId', 'markdown'],
      properties: {
        pageId: { type: 'string', description: 'UUID of an EXISTING page (not a title). Resolve from a title via canvas_read_page or canvas_find_pages first.' },
        markdown: { type: 'string', description: 'Markdown body. Standard CommonMark — headings, lists, code blocks, links. Rendered into Tiptap blocks on save.' },
        mode: {
          type: 'string',
          enum: ['replace', 'append', 'prepend'],
          description: 'How to combine `markdown` with existing content. `replace` (default) wipes existing body; `append` adds after; `prepend` adds before.',
        },
      },
    },
    requiresConfirmation: true,
    permissionLevel: 'requires-approval' as ToolPermissionLevel,
    category: 'canvas',
    async handler(args: Record<string, unknown>, _token: ICancellationToken, invocation?: IChatToolInvocationCallContext): Promise<IToolResult> {
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

      // M85 Slice C — read-before-edit, canvas surface. Mutating a page the
      // session has never read is how content gets clobbered or duplicated
      // (replace wipes unseen work; append/prepend re-add sections that are
      // already there). Same discipline as fs_edit_file.
      if (invocation?.sessionId && !wasResourceSeen(invocation.sessionId, pageResourceKey(page.id))) {
        return {
          content: `You have not read page "${page.title}" (${page.id}) this session. `
            + `Read it first with canvas_read_page, then retry the edit against its CURRENT content.`,
          isError: true,
        };
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

      // Capture the pre-edit content as a version-history revision BEFORE we
      // overwrite it. A `replace` that wipes more than intended (the classic
      // "AI replaced a section but cleared the whole page") must always be
      // revertable — the post-write checkpoint alone can't recover the original.
      try { await checkpointPage?.(pageId); } catch { /* never block the edit on checkpoint errors */ }
      // The open editor streams this in block-by-block on reload (the animated
      // _applyExternalDoc path) — every mode (replace/append/prepend) types live.
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

      // The editor now reflects content this session authored — keep it seen.
      if (invocation?.sessionId) {
        markResourceSeen(invocation.sessionId, pageResourceKey(page.id));
      }

      const blockCount = finalDoc.content.length;
      const verb = mode === 'replace' ? 'Replaced' : mode === 'append' ? 'Appended to' : 'Prepended to';
      return {
        content: `${verb} page "${page.title}" — ${blockCount} block${blockCount === 1 ? '' : 's'}.`,
      };
    },
  };
}

/** Re-parent a page (and keep its embedded pageBlock card in sync). Implemented
 *  in main.ts over the data service's atomic `movePageWithBlocks`. */
export type MovePageFn = (
  pageId: string,
  newParentId: string | null,
  afterSiblingId?: string,
) => Promise<void>;

/**
 * move_page — re-parent an EXISTING page: nest it under another page, move it to
 * the top level, or reorder it under its parent. Unlike `canvas_create_page`
 * (which only sets a parent at creation), this moves a page that already exists.
 *
 * Goes through the atomic `movePageWithBlocks` path, so the parent's embedded
 * sub-page CARD is added/removed in the same transaction as the hierarchy change
 * — no "nested in the sidebar but no card" desync.
 */
export function createMovePageTool(
  db: IBuiltInToolDatabase | undefined,
  movePage: MovePageFn,
): IChatTool {
  return {
    name: 'canvas_move_page',
    displaySummary: 'Move a canvas page under another page (or to the top level).',
    description:
      'RE-PARENT an existing canvas page: nest it under another page (creating the parent\'s sub-page card), ' +
      'move it back to the top level, or reorder it under its current parent. ' +
      'Use this to turn an existing page into a sub-page of another — `canvas_create_page` only sets a parent for BRAND-NEW pages. ' +
      'Both ids must be page UUIDs (resolve titles via `canvas_find_pages` / `canvas_read_page` first). ' +
      'Cycle-safe: a page cannot be moved under itself or its own descendant.',
    parameters: {
      type: 'object',
      required: ['pageId'],
      properties: {
        pageId: { type: 'string', description: 'UUID of the page to move (not a title).' },
        newParentId: { type: 'string', description: 'UUID of the destination parent page. Omit or pass an empty string to move the page to the TOP LEVEL (no parent).' },
        afterSiblingId: { type: 'string', description: 'Optional UUID of a sibling under the new parent; the page is placed directly after it. Omit to append last.' },
      },
    },
    requiresConfirmation: true,
    permissionLevel: 'requires-approval' as ToolPermissionLevel,
    category: 'canvas',
    async handler(args: Record<string, unknown>, _token: ICancellationToken): Promise<IToolResult> {
      requireDb(db);
      const pageId = String(args['pageId'] || '').trim();
      if (!pageId) {
        return { content: 'pageId is required', isError: true };
      }
      const newParentRaw = typeof args['newParentId'] === 'string' ? (args['newParentId'] as string).trim() : '';
      const newParentId = newParentRaw === '' ? null : newParentRaw;
      const afterSiblingId = typeof args['afterSiblingId'] === 'string' && args['afterSiblingId'].trim()
        ? (args['afterSiblingId'] as string).trim()
        : undefined;

      const page = await db!.get<{ id: string; title: string }>('SELECT id, title FROM pages WHERE id = ?', [pageId]);
      if (!page) {
        return { content: `Page not found: ${pageId}. Pass an existing page UUID (resolve titles via canvas_find_pages).`, isError: true };
      }
      let parentTitle = 'the top level';
      if (newParentId) {
        const parent = await db!.get<{ id: string; title: string }>('SELECT id, title FROM pages WHERE id = ?', [newParentId]);
        if (!parent) {
          return { content: `Destination parent not found: ${newParentId}. Pass an existing page UUID.`, isError: true };
        }
        parentTitle = `"${parent.title}"`;
      }

      try {
        await movePage(pageId, newParentId, afterSiblingId);
      } catch (err) {
        return { content: `Move failed: ${err instanceof Error ? err.message : String(err)}`, isError: true };
      }

      return {
        content: newParentId
          ? `Moved page "${page.title}" under ${parentTitle} — the parent now shows its sub-page card.`
          : `Moved page "${page.title}" to the top level.`,
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
        pageId: { type: 'string', description: 'Page UUID (not a title). If you only have a title, call canvas_read_page or canvas_find_pages first to resolve.' },
        style: {
          type: 'object',
          description: 'Style fields to update (omit fields you do not want to change)',
          properties: {
            icon: { type: 'string', description: 'Emoji icon (empty string to clear)' },
            coverUrl: {
              type: 'string',
              description: 'Cover: http(s):// URL, data: URL, workspace-relative path (e.g. "Skills/CoverImages/foo.png"), or empty string to clear.',
            },
            fontFamily: { type: 'string', description: 'Body font id from the canvas font registry (built-ins: default, serif, mono, system, verdana, trebuchet, cambria, times, garamond, courier, casual; or a user-uploaded custom font id).' },
            fullWidth: { type: 'boolean', description: 'Use the full canvas width' },
            smallText: { type: 'boolean', description: 'Render the page in a smaller text size' },
          },
        },
      },
    },
    requiresConfirmation: true,
    permissionLevel: 'requires-approval' as ToolPermissionLevel,
    category: 'canvas',
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
        // Accept any registered font id (built-in or custom). getFont falls back
        // to the default font for unknown ids, so an id that doesn't round-trip
        // is unknown and rejected.
        if (getFont(v).id !== v) {
          const known = listFonts().map((f) => f.id).join(', ');
          return { content: `Invalid fontFamily: ${v}. Known font ids: ${known}.`, isError: true };
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
