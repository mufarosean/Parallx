// builtInTools.ts — Built-in chat tools for workspace operations (M9 Task 6.3)
//
// Registers 10 tools with ILanguageModelToolsService:
//   - search_workspace (read-only, auto-approvable)
//   - read_page (read-only, auto-approvable) — accepts UUID or title
//   - read_page_by_title (read-only, auto-approvable) — explicit title lookup
//   - read_current_page (read-only, auto-approvable) — reads the active page
//   - list_pages (read-only, auto-approvable)
//   - get_page_properties (read-only, auto-approvable)
//   - create_page (write, requires confirmation)
//   - list_files (read-only, auto-approvable)
//   - read_file (read-only, auto-approvable)
//   - search_files (read-only, auto-approvable)
//
// Database tools use IDatabaseService for SQL queries — they do NOT invoke
// canvas code directly (per Task 6.3 constraint).
// File system tools use IFileService via the IBuiltInToolFileSystem interface.

import type { IDisposable } from '../../../platform/lifecycle.js';
import type {
  IChatTool,
  IToolResult,
  ICancellationToken,
  ILanguageModelToolsService,
} from '../../../services/chatTypes.js';

// ── Database accessor interface ──

/**
 * Minimal database accessor for built-in tools.
 * Wired from IDatabaseService in chatTool.ts.
 */
export interface IBuiltInToolDatabase {
  get<T>(sql: string, params?: unknown[]): Promise<T | null | undefined>;
  all<T>(sql: string, params?: unknown[]): Promise<T[]>;
  run(sql: string, params?: unknown[]): Promise<{ changes: number }>;
  readonly isOpen: boolean;
}

// ── File system accessor interface ──

/**
 * Minimal file system accessor for built-in tools.
 * Wired from IFileService + IWorkspaceService in chatTool.ts.
 */
export interface IBuiltInToolFileSystem {
  /** Read directory entries at a relative path. Returns { name, type, size }[]. */
  readdir(relativePath: string): Promise<readonly { name: string; type: 'file' | 'directory'; size: number }[]>;
  /** Read file content at a relative path. Returns the text content. */
  readFile(relativePath: string): Promise<string>;
  /** Check if a path exists. */
  exists(relativePath: string): Promise<boolean>;
  /** The workspace root display name. */
  readonly workspaceRootName: string;
}

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

function createSearchWorkspaceTool(db: IBuiltInToolDatabase | undefined): IChatTool {
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

function createReadPageTool(db: IBuiltInToolDatabase | undefined): IChatTool {
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

function createReadPageByTitleTool(db: IBuiltInToolDatabase | undefined): IChatTool {
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

/**
 * Getter function type for the current active page ID.
 * Wired from editorService.activeEditor.id in chatTool.ts.
 */
export type CurrentPageIdGetter = () => string | undefined;

function createReadCurrentPageTool(db: IBuiltInToolDatabase | undefined, getCurrentPageId: CurrentPageIdGetter): IChatTool {
  return {
    name: 'read_current_page',
    description: 'Read the content of the page the user currently has open. No parameters needed — reads whatever page is active in the editor.',
    parameters: {
      type: 'object',
      properties: {},
    },
    requiresConfirmation: false,
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

function createListPagesTool(db: IBuiltInToolDatabase | undefined): IChatTool {
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

function createGetPagePropertiesTool(db: IBuiltInToolDatabase | undefined): IChatTool {
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

function createCreatePageTool(db: IBuiltInToolDatabase | undefined): IChatTool {
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

// ── File System Tool definitions ──

const MAX_SEARCH_RESULTS = 50;
const MAX_SEARCH_DEPTH = 5;

function requireFs(fs: IBuiltInToolFileSystem | undefined): asserts fs is IBuiltInToolFileSystem {
  if (!fs) {
    throw new Error('File system is not available — no workspace folder is open');
  }
}

function createListFilesTool(fs: IBuiltInToolFileSystem | undefined): IChatTool {
  return {
    name: 'list_files',
    description: 'List files and directories at a workspace path. Returns name, type (file/directory), and size. Path is relative to the workspace root.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative directory path (default: workspace root ".")' },
      },
    },
    requiresConfirmation: false,
    async handler(args: Record<string, unknown>, _token: ICancellationToken): Promise<IToolResult> {
      requireFs(fs);
      const relPath = String(args['path'] || '.').replace(/\\/g, '/');

      try {
        const entries = await fs!.readdir(relPath);

        if (entries.length === 0) {
          return { content: `Directory "${relPath}" is empty.` };
        }

        const lines = entries.map((e) => {
          const typeLabel = e.type === 'directory' ? '📁' : '📄';
          const sizeLabel = e.type === 'file' ? ` (${formatSize(e.size)})` : '';
          return `${typeLabel} ${e.name}${sizeLabel}`;
        });

        return { content: `Contents of "${relPath}" in workspace "${fs!.workspaceRootName}":\n\n${lines.join('\n')}` };
      } catch (err) {
        return { content: `Failed to list "${relPath}": ${err instanceof Error ? err.message : String(err)}`, isError: true };
      }
    },
  };
}

function createReadFileTool(fs: IBuiltInToolFileSystem | undefined): IChatTool {
  return {
    name: 'read_file',
    description: 'Read the text content of a workspace file. Path is relative to the workspace root. Max 50 KB.',
    parameters: {
      type: 'object',
      required: ['path'],
      properties: {
        path: { type: 'string', description: 'Relative file path from workspace root' },
      },
    },
    requiresConfirmation: false,
    async handler(args: Record<string, unknown>, _token: ICancellationToken): Promise<IToolResult> {
      requireFs(fs);
      const relPath = String(args['path'] || '').replace(/\\/g, '/');

      if (!relPath) {
        return { content: 'path is required', isError: true };
      }

      try {
        const content = await fs!.readFile(relPath);
        return { content: `**${relPath}**\n\n\`\`\`\n${content}\n\`\`\`` };
      } catch (err) {
        return { content: `Failed to read "${relPath}": ${err instanceof Error ? err.message : String(err)}`, isError: true };
      }
    },
  };
}

function createSearchFilesTool(fs: IBuiltInToolFileSystem | undefined): IChatTool {
  return {
    name: 'search_files',
    description: 'Find files in the workspace matching a name pattern (case-insensitive substring match). Returns relative paths. Max depth 5, max 50 results.',
    parameters: {
      type: 'object',
      required: ['pattern'],
      properties: {
        pattern: { type: 'string', description: 'Substring to match against file/directory names (case-insensitive)' },
        path: { type: 'string', description: 'Relative directory to search within (default: workspace root ".")' },
      },
    },
    requiresConfirmation: false,
    async handler(args: Record<string, unknown>, _token: ICancellationToken): Promise<IToolResult> {
      requireFs(fs);
      const pattern = String(args['pattern'] || '').toLowerCase();
      const rootPath = String(args['path'] || '.').replace(/\\/g, '/');

      if (!pattern) {
        return { content: 'pattern is required', isError: true };
      }

      try {
        const results: string[] = [];
        await searchRecursive(fs!, rootPath, pattern, results, 0);

        if (results.length === 0) {
          return { content: `No files found matching "${pattern}" in "${rootPath}".` };
        }

        const lines = results.map((r) => `- ${r}`);
        return {
          content: `Found ${results.length} file(s) matching "${pattern}":\n\n${lines.join('\n')}`,
        };
      } catch (err) {
        return { content: `Search failed: ${err instanceof Error ? err.message : String(err)}`, isError: true };
      }
    },
  };
}

/**
 * Recursively search directories for files matching a pattern.
 */
async function searchRecursive(
  fs: IBuiltInToolFileSystem,
  dirPath: string,
  pattern: string,
  results: string[],
  depth: number,
): Promise<void> {
  if (depth >= MAX_SEARCH_DEPTH || results.length >= MAX_SEARCH_RESULTS) { return; }

  let entries: readonly { name: string; type: 'file' | 'directory'; size: number }[];
  try {
    entries = await fs.readdir(dirPath);
  } catch {
    return; // Skip directories we can't read
  }

  for (const entry of entries) {
    if (results.length >= MAX_SEARCH_RESULTS) { break; }

    const entryPath = dirPath === '.' ? entry.name : `${dirPath}/${entry.name}`;

    if (entry.name.toLowerCase().includes(pattern)) {
      const suffix = entry.type === 'directory' ? '/' : '';
      results.push(entryPath + suffix);
    }

    if (entry.type === 'directory' && !isIgnoredDir(entry.name)) {
      await searchRecursive(fs, entryPath, pattern, results, depth + 1);
    }
  }
}

/** Skip common large/irrelevant directories during search. */
function isIgnoredDir(name: string): boolean {
  const ignored = ['node_modules', '.git', 'dist', 'out', '.next', '__pycache__', '.cache', 'coverage'];
  return ignored.includes(name);
}

/** Format byte size to human-readable string. */
function formatSize(bytes: number): string {
  if (bytes < 1024) { return `${bytes} B`; }
  if (bytes < 1024 * 1024) { return `${(bytes / 1024).toFixed(1)} KB`; }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Registration ──

/**
 * Register all built-in tools with the language model tools service.
 * Called during chat tool activation.
 *
 * @returns Array of disposables to unregister the tools.
 */
export function registerBuiltInTools(
  toolsService: ILanguageModelToolsService,
  db: IBuiltInToolDatabase | undefined,
  fs: IBuiltInToolFileSystem | undefined,
  getCurrentPageId?: CurrentPageIdGetter,
): IDisposable[] {
  const disposables: IDisposable[] = [];

  const tools: IChatTool[] = [
    // ── Canvas/Database tools ──
    createSearchWorkspaceTool(db),
    createReadPageTool(db),
    createReadPageByTitleTool(db),
    createReadCurrentPageTool(db, getCurrentPageId ?? (() => undefined)),
    createListPagesTool(db),
    createGetPagePropertiesTool(db),
    createCreatePageTool(db),
    // ── File system tools ──
    createListFilesTool(fs),
    createReadFileTool(fs),
    createSearchFilesTool(fs),
  ];

  for (const tool of tools) {
    disposables.push(toolsService.registerTool(tool));
  }

  return disposables;
}

// ── Text helpers ──

/**
 * Extract a snippet of text around a search query from content.
 * Tries to find the query in the content and returns surrounding context.
 */
function extractSnippet(content: string, query: string, maxLength: number): string {
  if (!content) { return ''; }

  // Try Tiptap JSON content first
  const text = extractTextContent(content);
  if (!text) { return ''; }

  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const idx = lowerText.indexOf(lowerQuery);

  if (idx === -1) {
    // Query not in text — return start of text
    return text.length > maxLength ? text.slice(0, maxLength) + '...' : text;
  }

  // Return text around the match
  const start = Math.max(0, idx - 40);
  const end = Math.min(text.length, idx + query.length + maxLength - 40);
  let snippet = text.slice(start, end);
  if (start > 0) { snippet = '...' + snippet; }
  if (end < text.length) { snippet = snippet + '...'; }
  return snippet;
}

/**
 * Extract plain text from page content.
 * Handles both Tiptap JSON and plain text content.
 * Exported for use by content resolution in chatTool.ts.
 */
export function extractTextContent(content: string): string {
  if (!content) { return ''; }

  // Try parsing as Tiptap JSON
  try {
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === 'object') {
      // Handle schema-envelope format: { schemaVersion, doc: { type: "doc", content: [...] } }
      const doc = (parsed as Record<string, unknown>)['doc'];
      const root = (doc && typeof doc === 'object') ? doc : parsed;
      const texts: string[] = [];
      walkNode(root, texts);
      return texts.join(' ').trim();
    }
  } catch {
    // Not JSON — treat as plain text
  }

  return content.trim();
}

function walkNode(node: unknown, texts: string[]): void {
  if (!node || typeof node !== 'object') { return; }
  const n = node as Record<string, unknown>;
  if (n['type'] === 'text' && typeof n['text'] === 'string') {
    texts.push(n['text'] as string);
    return;
  }
  if (Array.isArray(n['content'])) {
    for (const child of n['content']) {
      walkNode(child, texts);
    }
  }
}
