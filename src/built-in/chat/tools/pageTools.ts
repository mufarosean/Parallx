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
} from '../chatTypes.js';
import { extractSnippet, extractTextContent } from './builtInTools.js';

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

export function createSearchWorkspaceTool(db: IBuiltInToolDatabase | undefined): IChatTool {
  return {
    name: 'search_workspace',
    description: 'Search pages and blocks by text query. Returns matching page titles and content snippets.',
    parameters: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string', description: 'Search text to match against page titles and content' },
        limit: { type: 'number', description: 'Maximum number of results (default: 10)' },
      },
    },
    requiresConfirmation: false,
    permissionLevel: 'always-allowed' as ToolPermissionLevel,
    async handler(args: Record<string, unknown>, _token: ICancellationToken): Promise<IToolResult> {
      requireDb(db);
      const query = String(args['query'] || '');
      const limit = Math.min(Number(args['limit']) || 10, 50);

      if (!query.trim()) {
        return { content: 'Search query is empty', isError: true };
      }

      const pattern = `%${query}%`;
      const pages = await db!.all<{ id: string; title: string; content: string }>(
        'SELECT id, title, content FROM pages WHERE is_archived = 0 AND (title LIKE ? OR content LIKE ?) ORDER BY updated_at DESC LIMIT ?',
        [pattern, pattern, limit],
      );

      if (pages.length === 0) {
        return { content: `No pages found matching "${query}".` };
      }

      const results = pages.map((p) => {
        const snippet = extractSnippet(p.content, query, 150);
        return `- **${p.title}** (id: ${p.id})${snippet ? `\n  ${snippet}` : ''}`;
      });

      return { content: `Found ${pages.length} page(s) matching "${query}":\n\n${results.join('\n')}` };
    },
  };
}

export function createReadPageTool(db: IBuiltInToolDatabase | undefined): IChatTool {
  return {
    name: 'read_page',
    description: 'Read the full content of a page by its ID or title. Accepts a page UUID or a page title (case-insensitive match). Returns the page title and text content.',
    parameters: {
      type: 'object',
      required: ['pageId'],
      properties: {
        pageId: { type: 'string', description: 'The page UUID or page title' },
      },
    },
    requiresConfirmation: false,
    permissionLevel: 'always-allowed' as ToolPermissionLevel,
    async handler(args: Record<string, unknown>, _token: ICancellationToken): Promise<IToolResult> {
      requireDb(db);
      const identifier = String(args['pageId'] || '');
      if (!identifier) {
        return { content: 'pageId is required', isError: true };
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
        return { content: `Page "${identifier}" not found. Use list_pages to see available pages.`, isError: true };
      }

      const text = extractTextContent(page.content);
      return { content: `**${page.title}** (id: ${page.id})\n\n${text || '(empty page)'}` };
    },
  };
}

export function createReadPageByTitleTool(db: IBuiltInToolDatabase | undefined): IChatTool {
  return {
    name: 'read_page_by_title',
    description: 'Read a page by its title. Performs case-insensitive matching. If multiple pages match, returns the most recently updated one.',
    parameters: {
      type: 'object',
      required: ['title'],
      properties: {
        title: { type: 'string', description: 'The page title to search for (case-insensitive)' },
      },
    },
    requiresConfirmation: false,
    permissionLevel: 'always-allowed' as ToolPermissionLevel,
    async handler(args: Record<string, unknown>, _token: ICancellationToken): Promise<IToolResult> {
      requireDb(db);
      const title = String(args['title'] || '').trim();
      if (!title) {
        return { content: 'title is required', isError: true };
      }

      // Exact case-insensitive match first
      let page = await db!.get<{ id: string; title: string; content: string }>(
        'SELECT id, title, content FROM pages WHERE is_archived = 0 AND LOWER(title) = LOWER(?) ORDER BY updated_at DESC',
        [title],
      );

      // Fallback: partial match
      if (!page) {
        page = await db!.get<{ id: string; title: string; content: string }>(
          'SELECT id, title, content FROM pages WHERE is_archived = 0 AND title LIKE ? ORDER BY updated_at DESC',
          [`%${title}%`],
        );
      }

      if (!page) {
        return { content: `No page found matching title "${title}". Use list_pages to see available pages.`, isError: true };
      }

      const text = extractTextContent(page.content);
      return { content: `**${page.title}** (id: ${page.id})\n\n${text || '(empty page)'}` };
    },
  };
}

export function createReadCurrentPageTool(db: IBuiltInToolDatabase | undefined, getCurrentPageId: CurrentPageIdGetter): IChatTool {
  return {
    name: 'read_current_page',
    description: 'Read the content of the page the user currently has open. No parameters needed — reads whatever page is active in the editor.',
    parameters: {
      type: 'object',
      properties: {},
    },
    requiresConfirmation: false,
    permissionLevel: 'always-allowed' as ToolPermissionLevel,
    async handler(_args: Record<string, unknown>, _token: ICancellationToken): Promise<IToolResult> {
      requireDb(db);
      const pageId = getCurrentPageId();
      if (!pageId) {
        return { content: 'No page is currently open in the editor.', isError: true };
      }

      const page = await db!.get<{ id: string; title: string; content: string }>(
        'SELECT id, title, content FROM pages WHERE id = ?',
        [pageId],
      );

      if (!page) {
        return { content: `The active editor page (${pageId}) was not found in the database.`, isError: true };
      }

      const text = extractTextContent(page.content);
      return { content: `**${page.title}** (id: ${page.id}) — currently open\n\n${text || '(empty page)'}` };
    },
  };
}

export function createListPagesTool(db: IBuiltInToolDatabase | undefined): IChatTool {
  return {
    name: 'list_pages',
    description: 'List all pages in the workspace with their titles and IDs.',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Maximum number of pages to return (default: 50)' },
      },
    },
    requiresConfirmation: false,
    permissionLevel: 'always-allowed' as ToolPermissionLevel,
    async handler(args: Record<string, unknown>, _token: ICancellationToken): Promise<IToolResult> {
      requireDb(db);
      const limit = Math.min(Number(args['limit']) || 50, 200);

      const pages = await db!.all<{ id: string; title: string; icon: string | null; updated_at: string }>(
        'SELECT id, title, icon, updated_at FROM pages WHERE is_archived = 0 ORDER BY updated_at DESC LIMIT ?',
        [limit],
      );

      if (pages.length === 0) {
        return { content: 'No pages found in the workspace.' };
      }

      const lines = pages.map((p) => {
        const icon = p.icon ? `${p.icon} ` : '';
        return `- ${icon}**${p.title}** (id: ${p.id}, updated: ${p.updated_at})`;
      });

      return { content: `${pages.length} page(s) in workspace:\n\n${lines.join('\n')}` };
    },
  };
}

export function createGetPagePropertiesTool(db: IBuiltInToolDatabase | undefined): IChatTool {
  return {
    name: 'get_page_properties',
    description: 'Get metadata and custom properties of a page including title, icon, creation date, block count, and all custom property values.',
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

      const lines = [
        `**Title:** ${page.title}`,
        `**ID:** ${page.id}`,
        page.icon ? `**Icon:** ${page.icon}` : null,
        `**Created:** ${page.created_at}`,
        `**Updated:** ${page.updated_at}`,
        `**Archived:** ${page.is_archived ? 'Yes' : 'No'}`,
        `**Blocks:** ${blockCount?.cnt ?? 0}`,
      ].filter(Boolean);

      // Custom properties from page_properties table
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

      return { content: lines.join('\n') };
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

export function createFindPagesByPropertyTool(db: IBuiltInToolDatabase | undefined): IChatTool {
  return {
    name: 'find_pages_by_property',
    description: 'Find canvas pages by property value. Supports operators: equals, contains, is_empty, is_not_empty, greater_than, less_than.',
    parameters: {
      type: 'object',
      required: ['propertyName', 'operator'],
      properties: {
        propertyName: { type: 'string', description: 'The property name to filter by' },
        operator: { type: 'string', description: 'Comparison operator: equals, contains, is_empty, is_not_empty, greater_than, less_than' },
        value: { description: 'The value to compare against (not required for is_empty/is_not_empty)' },
      },
    },
    requiresConfirmation: false,
    permissionLevel: 'always-allowed' as ToolPermissionLevel,
    async handler(args: Record<string, unknown>, _token: ICancellationToken): Promise<IToolResult> {
      requireDb(db);
      const propertyName = String(args['propertyName'] || '').trim();
      const operator = String(args['operator'] || '').trim();
      const value = args['value'];

      if (!propertyName) { return { content: 'propertyName is required', isError: true }; }
      if (!operator) { return { content: 'operator is required', isError: true }; }

      const validOperators = ['equals', 'contains', 'is_empty', 'is_not_empty', 'greater_than', 'less_than'];
      if (!validOperators.includes(operator)) {
        return { content: `Invalid operator "${operator}". Valid operators: ${validOperators.join(', ')}`, isError: true };
      }

      let whereClause: string;
      const params: unknown[] = [propertyName];

      switch (operator) {
        case 'equals':
          whereClause = 'pp.value = ?';
          params.push(JSON.stringify(value));
          break;
        case 'contains':
          whereClause = 'pp.value LIKE ?';
          params.push(`%${String(value)}%`);
          break;
        case 'is_empty':
          whereClause = "pp.value IS NULL OR pp.value = 'null' OR pp.value = '\"\"'";
          break;
        case 'is_not_empty':
          whereClause = "pp.value IS NOT NULL AND pp.value != 'null' AND pp.value != '\"\"'";
          break;
        case 'greater_than':
          whereClause = "CAST(json_extract(pp.value, '$') AS REAL) > ?";
          params.push(Number(value));
          break;
        case 'less_than':
          whereClause = "CAST(json_extract(pp.value, '$') AS REAL) < ?";
          params.push(Number(value));
          break;
        default:
          return { content: `Unsupported operator: ${operator}`, isError: true };
      }

      const rows = await db!.all<{ id: string; title: string; value: string }>(
        `SELECT p.id, p.title, pp.value FROM page_properties pp JOIN pages p ON pp.page_id = p.id WHERE pp.key = ? AND (${whereClause})`,
        params,
      );

      if (rows.length === 0) {
        return { content: `No pages found where '${propertyName}' ${operator}${value !== undefined ? ' ' + JSON.stringify(value) : ''}.` };
      }

      const lines = rows.map((r) => {
        const formatted = formatPropertyValue(r.value, 'text');
        return `- **${r.title}** (id: ${r.id}) — ${propertyName}: ${formatted}`;
      });

      return { content: `Found ${rows.length} page(s):\n\n${lines.join('\n')}` };
    },
  };
}

export function createCreatePageTool(db: IBuiltInToolDatabase | undefined): IChatTool {
  return {
    name: 'create_page',
    description: 'Create a new page in the workspace with a title and optional content.',
    parameters: {
      type: 'object',
      required: ['title'],
      properties: {
        title: { type: 'string', description: 'Page title' },
        content: { type: 'string', description: 'Initial text content for the page (plain text)' },
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
      const content = args['content'] ? String(args['content']) : '';
      const now = new Date().toISOString();

      await db!.run(
        'INSERT INTO pages (id, title, icon, content, is_archived, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)',
        [id, title, icon, content, now, now],
      );

      return { content: `Created page "${title}" (id: ${id})` };
    },
  };
}
