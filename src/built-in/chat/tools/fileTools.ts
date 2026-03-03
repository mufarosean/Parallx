// fileTools.ts — File system tool registrations (M13 Phase 5)

import type {
  IChatTool,
  IToolResult,
  ICancellationToken,
  ToolPermissionLevel,
} from '../../../services/chatTypes.js';
import type {
  IBuiltInToolFileSystem,
  IBuiltInToolRetrieval,
} from '../chatTypes.js';

// ── Constants ──

const MAX_SEARCH_RESULTS = 50;
const MAX_SEARCH_DEPTH = 5;

// ── Tool helpers ──

function requireFs(fs: IBuiltInToolFileSystem | undefined): asserts fs is IBuiltInToolFileSystem {
  if (!fs) {
    throw new Error('File system is not available — no workspace folder is open');
  }
}

// ── Tool definitions ──

export function createListFilesTool(fs: IBuiltInToolFileSystem | undefined): IChatTool {
  return {
    name: 'list_files',
    description: 'List files and directories at a workspace path. Returns name, type (file/directory), and size. Path is relative to the workspace root. IMPORTANT: This only lists names — to see file contents, you must follow up with read_file for each file you need.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative directory path (default: workspace root ".")' },
      },
    },
    requiresConfirmation: false,
    permissionLevel: 'always-allowed' as ToolPermissionLevel,
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

export function createReadFileTool(fs: IBuiltInToolFileSystem | undefined): IChatTool {
  return {
    name: 'read_file',
    description: 'Read the text content of a workspace file. Path is relative to the workspace root. Max 50 KB. Use this to actually see what\'s inside a file — always read files before summarizing or answering questions about their content.',
    parameters: {
      type: 'object',
      required: ['path'],
      properties: {
        path: { type: 'string', description: 'Relative file path from workspace root' },
      },
    },
    requiresConfirmation: false,
    permissionLevel: 'always-allowed' as ToolPermissionLevel,
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

export function createSearchFilesTool(fs: IBuiltInToolFileSystem | undefined): IChatTool {
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
    permissionLevel: 'always-allowed' as ToolPermissionLevel,
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

// ── RAG tools (M10 Phase 3 — Task 3.3) ──

export function createSearchKnowledgeTool(retrieval: IBuiltInToolRetrieval | undefined): IChatTool {
  return {
    name: 'search_knowledge',
    description:
      'Semantic search across all indexed knowledge (canvas pages and workspace files). ' +
      'Use this when you need to find information beyond what is already provided in the context. ' +
      'Returns the most relevant chunks with source attribution.',
    parameters: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string', description: 'Natural language search query' },
        source_filter: {
          type: 'string',
          description: 'Optional filter: "page_block" for canvas pages only, "file_chunk" for workspace files only',
          enum: ['page_block', 'file_chunk'],
        },
      },
    },
    requiresConfirmation: false,
    permissionLevel: 'always-allowed' as ToolPermissionLevel,
    async handler(args: Record<string, unknown>, _token: ICancellationToken): Promise<IToolResult> {
      if (!retrieval) {
        return { content: 'Knowledge search is not available — the retrieval service has not been initialized.', isError: true };
      }
      if (!retrieval.isReady()) {
        return { content: 'Knowledge search is not available yet — initial indexing is still in progress. Please try again shortly.' };
      }

      const query = String(args['query'] || '');
      if (!query.trim()) {
        return { content: 'Search query is empty.', isError: true };
      }

      const sourceFilter = typeof args['source_filter'] === 'string' ? args['source_filter'] : undefined;

      try {
        const results = await retrieval.retrieve(query, sourceFilter);

        if (results.length === 0) {
          return { content: `No relevant results found for "${query}".` };
        }

        const formatted = results.map((r, i) => {
          const sourceLabel = r.contextPrefix || r.sourceId;
          const typeLabel = r.sourceType === 'page_block' ? 'Page' : 'File';
          return `[${i + 1}] (${typeLabel}) ${sourceLabel} [score: ${r.score.toFixed(3)}]\n${r.text}`;
        }).join('\n\n---\n\n');

        return { content: `Found ${results.length} relevant results:\n\n${formatted}` };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: `Knowledge search failed: ${msg}`, isError: true };
      }
    },
  };
}
