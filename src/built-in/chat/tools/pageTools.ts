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
    description: 'Get metadata and database properties of a page including title, icon, creation date, and block count.',
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

      return { content: lines.join('\n') };
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
