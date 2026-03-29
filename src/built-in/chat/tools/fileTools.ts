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
const MAX_GREP_MATCHES = 100;
const GREP_CONTEXT_LINES = 2;
/** Maximum file size (bytes) to search inside for grep_search. */
const MAX_GREP_FILE_SIZE = 512_000; // 512 KB
/** Maximum characters returned by read_file for extracted rich document text. */
const MAX_DOC_TEXT_CHARS = 50_000;
/** Rich document extensions that should use document extraction instead of raw read. */
const RICH_DOC_EXTS = new Set([
  '.pdf', '.xlsx', '.xls', '.xlsm', '.xlsb', '.ods', '.numbers',
  '.csv', '.tsv', '.docx',
]);

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
          const typeLabel = e.type === 'directory' ? '[dir]' : '[file]';
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
    description:
      'Read the content of a workspace file. Path is relative to the workspace root. ' +
      'Supports text files (up to 50 KB) and rich documents (PDF, DOCX, XLSX — text is extracted automatically). ' +
      'Use this tool whenever you need to verify or confirm the actual contents of a file. ' +
      'Optionally specify start_line and end_line to read a specific range (1-indexed). ' +
      'For large documents like books, prefer search_knowledge which searches across all indexed chunks.',
    parameters: {
      type: 'object',
      required: ['path'],
      properties: {
        path: { type: 'string', description: 'Relative file path from workspace root' },
        start_line: { type: 'number', description: 'First line to return (1-indexed, inclusive). Omit to read from start.' },
        end_line: { type: 'number', description: 'Last line to return (1-indexed, inclusive). Omit to read to end.' },
      },
    },
    requiresConfirmation: false,
    permissionLevel: 'always-allowed' as ToolPermissionLevel,
    async handler(args: Record<string, unknown>, _token: ICancellationToken): Promise<IToolResult> {
      requireFs(fs);
      const relPath = String(args['path'] || '').replace(/\\/g, '/');
      const startLine = typeof args['start_line'] === 'number' ? Math.max(1, Math.floor(args['start_line'])) : undefined;
      const endLine = typeof args['end_line'] === 'number' ? Math.max(1, Math.floor(args['end_line'])) : undefined;

      if (!relPath) {
        return { content: 'path is required', isError: true };
      }

      // Detect rich document by extension
      const dotIdx = relPath.lastIndexOf('.');
      const ext = dotIdx >= 0 ? relPath.slice(dotIdx).toLowerCase() : '';

      try {
        if (RICH_DOC_EXTS.has(ext)) {
          // Route through document extraction (PDF, DOCX, XLSX, etc.)
          const text = await fs!.readDocumentText(relPath);
          if (!text || text.trim().length === 0) {
            return { content: `**${relPath}** (${ext} file)\n\n[Document is empty or could not extract text]` };
          }
          if (text.length > MAX_DOC_TEXT_CHARS) {
            const truncated = text.slice(0, MAX_DOC_TEXT_CHARS);
            return {
              content:
                `**${relPath}** (${ext} file — showing first ${MAX_DOC_TEXT_CHARS} characters, full document is indexed)\n\n` +
                `\`\`\`\n${truncated}\n\`\`\`\n\n` +
                `*Content truncated. Use search_knowledge to search across the full document.*`,
            };
          }
          return { content: `**${relPath}** (${ext} file)\n\n\`\`\`\n${text}\n\`\`\`` };
        }

        // Regular text file
        const content = await fs!.readFile(relPath);

        // Apply line-range slicing if requested
        if (startLine !== undefined || endLine !== undefined) {
          const allLines = content.split('\n');
          const totalLines = allLines.length;
          const s = (startLine ?? 1) - 1; // convert to 0-indexed
          const e = endLine ?? totalLines;
          const sliced = allLines.slice(Math.max(0, s), Math.min(totalLines, e));
          const rangeLabel = `lines ${s + 1}-${Math.min(totalLines, e)} of ${totalLines}`;
          return { content: `**${relPath}** (${rangeLabel})\n\n\`\`\`\n${sliced.join('\n')}\n\`\`\`` };
        }

        return { content: `**${relPath}**\n\n\`\`\`\n${content}\n\`\`\`` };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // If file is too large, guide the AI to use search_knowledge
        if (msg.includes('too large')) {
          return {
            content: `File "${relPath}" is too large for direct reading. Use search_knowledge to search across its indexed content instead.`,
            isError: true,
          };
        }
        return { content: `Failed to read "${relPath}": ${msg}`, isError: true };
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

// ── grep_search tool (M41 Phase 8) ──

export function createGrepSearchTool(fs: IBuiltInToolFileSystem | undefined): IChatTool {
  return {
    name: 'grep_search',
    description:
      'Search for text content inside workspace files. Finds lines matching a pattern (plain text or regex) ' +
      'and returns matching lines with surrounding context. Use this to find specific code, strings, or patterns ' +
      'across the workspace. For filename search, use search_files instead.',
    parameters: {
      type: 'object',
      required: ['pattern'],
      properties: {
        pattern: { type: 'string', description: 'Text or regex pattern to search for (case-insensitive by default)' },
        path: { type: 'string', description: 'Relative directory or file to search within (default: workspace root ".")' },
        is_regex: { type: 'boolean', description: 'Whether the pattern is a regular expression (default: false)' },
        case_sensitive: { type: 'boolean', description: 'Whether the search is case-sensitive (default: false)' },
      },
    },
    requiresConfirmation: false,
    permissionLevel: 'always-allowed' as ToolPermissionLevel,
    async handler(args: Record<string, unknown>, _token: ICancellationToken): Promise<IToolResult> {
      requireFs(fs);
      const patternStr = String(args['pattern'] || '');
      const rootPath = String(args['path'] || '.').replace(/\\/g, '/');
      const isRegex = args['is_regex'] === true;
      const caseSensitive = args['case_sensitive'] === true;

      if (!patternStr) {
        return { content: 'pattern is required', isError: true };
      }

      // Build the matcher
      let regex: RegExp;
      try {
        const flags = caseSensitive ? 'g' : 'gi';
        regex = isRegex
          ? new RegExp(patternStr, flags)
          : new RegExp(escapeRegExp(patternStr), flags);
      } catch (err) {
        return { content: `Invalid regex pattern: ${err instanceof Error ? err.message : String(err)}`, isError: true };
      }

      try {
        const matches: GrepMatch[] = [];
        await grepRecursive(fs!, rootPath, regex, matches, 0);

        if (matches.length === 0) {
          return { content: `No matches found for "${patternStr}" in "${rootPath}".` };
        }

        const formatted = matches.map(m => {
          const header = `${m.file}:${m.line}`;
          const contextLines = m.context.map(c =>
            `${c.lineNum === m.line ? '>' : ' '} ${c.lineNum}: ${c.text}`
          ).join('\n');
          return `${header}\n${contextLines}`;
        }).join('\n\n');

        const truncNote = matches.length >= MAX_GREP_MATCHES
          ? `\n\n(Results capped at ${MAX_GREP_MATCHES} matches. Narrow your search for more specific results.)`
          : '';

        return {
          content: `Found ${matches.length} match(es) for "${patternStr}":\n\n${formatted}${truncNote}`,
        };
      } catch (err) {
        return { content: `Grep search failed: ${err instanceof Error ? err.message : String(err)}`, isError: true };
      }
    },
  };
}

interface GrepMatch {
  file: string;
  line: number;
  context: { lineNum: number; text: string }[];
}

/** Escape special regex characters in a literal string. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Binary-looking extensions to skip during grep. */
const BINARY_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.svg', '.webp',
  '.mp3', '.mp4', '.wav', '.avi', '.mov', '.mkv', '.webm',
  '.zip', '.tar', '.gz', '.bz2', '.7z', '.rar',
  '.exe', '.dll', '.so', '.dylib', '.bin', '.dat',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.sqlite', '.db', '.sqlite3',
]);

async function grepRecursive(
  fs: IBuiltInToolFileSystem,
  dirPath: string,
  regex: RegExp,
  results: GrepMatch[],
  depth: number,
): Promise<void> {
  if (depth >= MAX_SEARCH_DEPTH || results.length >= MAX_GREP_MATCHES) { return; }

  // If dirPath points to a file, search it directly
  let entries: readonly { name: string; type: 'file' | 'directory'; size: number }[];
  try {
    entries = await fs.readdir(dirPath);
  } catch {
    // dirPath might be a file — try reading it directly
    try {
      await grepFile(fs, dirPath, regex, results);
    } catch { /* skip unreadable */ }
    return;
  }

  for (const entry of entries) {
    if (results.length >= MAX_GREP_MATCHES) { break; }

    const entryPath = dirPath === '.' ? entry.name : `${dirPath}/${entry.name}`;

    if (entry.type === 'directory') {
      if (!isIgnoredDir(entry.name)) {
        await grepRecursive(fs, entryPath, regex, results, depth + 1);
      }
    } else {
      // Skip large files and binary-looking files
      if (entry.size > MAX_GREP_FILE_SIZE) { continue; }
      const dotIdx = entry.name.lastIndexOf('.');
      if (dotIdx >= 0 && BINARY_EXTS.has(entry.name.slice(dotIdx).toLowerCase())) { continue; }
      await grepFile(fs, entryPath, regex, results);
    }
  }
}

async function grepFile(
  fs: IBuiltInToolFileSystem,
  filePath: string,
  regex: RegExp,
  results: GrepMatch[],
): Promise<void> {
  let content: string;
  try {
    content = await fs.readFile(filePath);
  } catch {
    return; // Skip unreadable files
  }

  const lines = content.split('\n');
  for (let i = 0; i < lines.length && results.length < MAX_GREP_MATCHES; i++) {
    // Reset regex state for each line (global flag)
    regex.lastIndex = 0;
    if (regex.test(lines[i])) {
      const start = Math.max(0, i - GREP_CONTEXT_LINES);
      const end = Math.min(lines.length - 1, i + GREP_CONTEXT_LINES);
      const context: { lineNum: number; text: string }[] = [];
      for (let j = start; j <= end; j++) {
        context.push({ lineNum: j + 1, text: lines[j] });
      }
      results.push({ file: filePath, line: i + 1, context });
    }
  }
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
      'Semantic search across all indexed knowledge (canvas pages, workspace files, and rich documents like PDFs, DOCX, and XLSX). ' +
      'Use this when you need to find information beyond what is already provided in the context. ' +
      'This is the best tool for searching large documents — content is chunked and indexed for efficient retrieval. ' +
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
        folder_path: {
          type: 'string',
          description: 'Optional folder path to restrict search scope (e.g. "RF Guides/")',
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
      const folderPath = typeof args['folder_path'] === 'string' && args['folder_path'].trim() ? args['folder_path'].trim() : undefined;
      const pathPrefixes = folderPath ? [folderPath.endsWith('/') ? folderPath : folderPath + '/'] : undefined;

      try {
        const results = await retrieval.retrieve(query, sourceFilter, pathPrefixes);

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
