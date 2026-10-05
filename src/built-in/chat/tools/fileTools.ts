// fileTools.ts — File system tool registrations (M13 Phase 5)

import type {
  IChatTool,
  IToolResult,
  ICancellationToken,
  ToolPermissionLevel,
  IChatToolInvocationCallContext,
} from '../../../services/chatTypes.js';
import type {
  IBuiltInToolFileSystem,
  IBuiltInToolRetrieval,
} from '../chatTypes.js';
import { markResourceSeen, fileResourceKey } from '../../../services/toolResourceRegistry.js';
import { contributedSkillFile } from '../../../services/chatContributions.js';
import { formatPagesForReading, pageLabelForPassage } from '../../../services/quoteLocator.js';

// ── Constants ──

const MAX_SEARCH_RESULTS = 50;
const MAX_SEARCH_DEPTH = 5;
const MAX_GREP_MATCHES = 100;
const GREP_CONTEXT_LINES = 2;
/** Maximum file size (bytes) to search inside for fs_grep_search. */
const MAX_GREP_FILE_SIZE = 512_000; // 512 KB
/** Maximum characters returned by fs_read_file for extracted rich document text. */
const MAX_DOC_TEXT_CHARS = 50_000;

const SPREADSHEET_EXTS = new Set(['.xlsx', '.xls', '.xlsm', '.xlsb', '.ods', '.numbers']);

/**
 * A PDF for the AI: the pages asked for (all by default), each starting with
 * its "===== Page N of M =====" line, cut at a page boundary once the text
 * passes MAX_DOC_TEXT_CHARS. Says how to read on.
 */
export function formatPdfForReading(relPath: string, pages: readonly string[], startPage?: number, endPage?: number): string {
  const total = pages.length;
  if (total === 0 || pages.every((p) => !p.trim())) {
    return `**${relPath}** (.pdf file, ${total} page${total === 1 ? '' : 's'})\n\n[Document is empty or could not extract text — it may be a scan without a text layer]`;
  }
  const from = Math.min(Math.max(1, startPage ?? 1), total);
  const wantedTo = Math.min(Math.max(from, endPage ?? total), total);
  let to = from;
  let size = 0;
  for (let p = from; p <= wantedTo; p++) {
    size += (pages[p - 1] ?? '').length + 32;
    if (p > from && size > MAX_DOC_TEXT_CHARS) break;
    to = p;
  }
  const range = from === 1 && to === total
    ? (total === 1 ? '1 page' : `all ${total} pages`)
    : `pages ${from} to ${to} of ${total}`;
  const guide =
    '*Each page starts with its "===== Page N of M =====" line, and the text under it is that page\'s text. ' +
    'N is the PDF\'s own page number (1 = first page of the file): the number the PDF viewer shows and a link\'s page takes. ' +
    'It is not the page number printed on the page. To link a passage, give link_create the quoted words; it confirms the page.*';
  const more = to < wantedTo
    ? `\n\n*Stopped at page ${to} (length limit). Read on with start_page=${to + 1}.*`
    : '';
  return `**${relPath}** (.pdf file, ${range})\n\n${guide}\n\n\`\`\`\n${formatPagesForReading(pages, from, to)}\n\`\`\`${more}`;
}

// ── Tool helpers ──

function requireFs(fs: IBuiltInToolFileSystem | undefined): asserts fs is IBuiltInToolFileSystem {
  if (!fs) {
    throw new Error('File system is not available; no workspace folder is open');
  }
}

// ── Workspace tree ──

const MAX_TREE_DEPTH = 2;
const MAX_TREE_ENTRIES = 80;

/**
 * Build a compact directory tree of the workspace for navigation context.
 * Depth-limited, skips ignored directories, caps total entries.
 */
async function buildWorkspaceTree(fs: IBuiltInToolFileSystem): Promise<string> {
  const lines: string[] = [];
  let count = 0;

  async function walk(dirPath: string, indent: string, depth: number): Promise<void> {
    if (depth > MAX_TREE_DEPTH || count >= MAX_TREE_ENTRIES) return;

    let entries: readonly { name: string; type: 'file' | 'directory'; size: number }[];
    try {
      entries = await fs.readdir(dirPath);
    } catch {
      return;
    }

    // Directories first, then files, alphabetical within each group
    const sorted = [...entries].sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    for (const entry of sorted) {
      if (count >= MAX_TREE_ENTRIES) {
        lines.push(`${indent}…`);
        break;
      }

      if (entry.type === 'directory') {
        if (isIgnoredDir(entry.name)) continue;
        lines.push(`${indent}${entry.name}/`);
        count++;
        const childPath = dirPath === '.' ? entry.name : `${dirPath}/${entry.name}`;
        await walk(childPath, indent + '  ', depth + 1);
      } else {
        lines.push(`${indent}${entry.name}`);
        count++;
      }
    }
  }

  await walk('.', '  ', 0);
  return lines.join('\n');
}

// ── Tool definitions ──

export function createListFilesTool(fs: IBuiltInToolFileSystem | undefined): IChatTool {
  return {
    name: 'fs_list_files',
    displaySummary: 'List files / directories on disk.',
    description:
      'Lists files and directories on disk at a workspace path. ' +
      'Use when exploring filesystem structure or confirming a file exists before reading it. ' +
      'For canvas pages (the page DB) use `canvas_find_pages`. ' +
      'For finding files by name pattern use `fs_search_files`; for content search use `fs_grep_search` or `fs_search_knowledge`.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative directory path (default: workspace root ".")' },
      },
    },
    requiresConfirmation: false,
    permissionLevel: 'always-allowed' as ToolPermissionLevel,
    category: 'file-system',
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
    name: 'fs_read_file',
    displaySummary: 'Read a workspace file on disk.',
    description:
      'Reads a workspace file on disk — text (.md, .txt, source code) or rich documents (PDF, DOCX, EPUB, XLSX, extracted to text). ' +
      'Use `start_line`/`end_line` to read a range of a large text file, `start_page`/`end_page` for a PDF. ' +
      'A PDF comes back page by page, each page starting with a "===== Page N of M =====" line: N is the page number to cite and link. ' +
      'Use when the user references a file by path, or when you need exact source for citation/quotation. ' +
      'For canvas pages (page DB) use `canvas_read_page`. ' +
      'For conceptual search across many files use `fs_search_knowledge`.',
    parameters: {
      type: 'object',
      required: ['path'],
      properties: {
        path: { type: 'string', description: 'Relative file path from workspace root.' },
        start_line: { type: 'number', description: 'Start line (1-indexed, inclusive).' },
        end_line: { type: 'number', description: 'End line (1-indexed, inclusive).' },
        start_page: { type: 'number', description: 'PDF only: first page to read (1 = first page of the file).' },
        end_page: { type: 'number', description: 'PDF only: last page to read (inclusive).' },
      },
    },
    requiresConfirmation: false,
    permissionLevel: 'always-allowed' as ToolPermissionLevel,
    category: 'file-system',
    async handler(args: Record<string, unknown>, _token: ICancellationToken, invocation?: IChatToolInvocationCallContext): Promise<IToolResult> {
      requireFs(fs);
      const relPath = String(args['path'] || '').replace(/\\/g, '/');
      const startLine = typeof args['start_line'] === 'number' ? Math.max(1, Math.floor(args['start_line'])) : undefined;
      const endLine = typeof args['end_line'] === 'number' ? Math.max(1, Math.floor(args['end_line'])) : undefined;
      const startPage = typeof args['start_page'] === 'number' ? Math.max(1, Math.floor(args['start_page'])) : undefined;
      const endPage = typeof args['end_page'] === 'number' ? Math.max(1, Math.floor(args['end_page'])) : undefined;

      if (!relPath) {
        return { content: 'path is required', isError: true };
      }

      try {
        // Build workspace tree so the model always has a navigation map
        let treePrefix = '';
        try {
          const tree = await buildWorkspaceTree(fs!);
          treePrefix = `**Workspace: ${fs!.workspaceRootName}**\n${tree}\n\n---\n\n`;
        } catch {
          // Tree is best-effort — don't fail file read if tree fails
        }

        // PDFs read page by page, so every passage sits under its page number.
        if (/\.pdf$/i.test(relPath) && fs!.readPdfPages) {
          const pages = await fs!.readPdfPages(relPath);
          if (pages) {
            if (invocation?.sessionId) markResourceSeen(invocation.sessionId, fileResourceKey(relPath));
            return { content: treePrefix + formatPdfForReading(relPath, pages, startPage, endPage) };
          }
        }

        let result: Awaited<ReturnType<NonNullable<typeof fs>['readFileContent']>>;
        try {
          result = await fs!.readFileContent(relPath);
        } catch (err) {
          // A skill a running tool brought has no file: read it from the tool.
          const fromTool = contributedSkillFile(relPath);
          if (fromTool === undefined) throw err;
          return { content: treePrefix + `**${relPath}**\n\n${fromTool}` };
        }

        // M85 Slice C — a successful read (even a range) marks the file as
        // seen for this session, unlocking fs_edit_file on it.
        if (invocation?.sessionId) {
          markResourceSeen(invocation.sessionId, fileResourceKey(relPath));
        }

        if (result.type === 'rich-document') {
          const dotIdx = relPath.lastIndexOf('.');
          const ext = dotIdx >= 0 ? relPath.slice(dotIdx).toLowerCase() : '';
          if (!result.content || result.content.trim().length === 0) {
            return { content: treePrefix + `**${relPath}** (${ext} file)\n\n[Document is empty or could not extract text]` };
          }
          // Spreadsheet text is CSV with blank rows left out: its lines are
          // not the workbook's rows, so a row number read off it is wrong.
          const sheetNote = SPREADSHEET_EXTS.has(ext)
            ? '*Rows below are not numbered as in the workbook (blank rows are left out). To cite a cell, give link_create the quoted words: it returns the sheet and cell.*\n\n'
            : '';
          if (result.totalChars > MAX_DOC_TEXT_CHARS) {
            const truncated = result.content.slice(0, MAX_DOC_TEXT_CHARS);
            return {
              content: treePrefix +
                `**${relPath}** (${ext} file — showing first ${MAX_DOC_TEXT_CHARS} characters, full document is indexed)\n\n` + sheetNote +
                `\`\`\`\n${truncated}\n\`\`\`\n\n` +
                `*Content truncated. Use fs_search_knowledge to search across the full document.*`,
            };
          }
          return { content: treePrefix + `**${relPath}** (${ext} file)\n\n` + sheetNote + `\`\`\`\n${result.content}\n\`\`\`` };
        }

        // Regular text file
        const allLines = result.content.split('\n');
        const totalLines = allLines.length;

        // Apply line-range slicing if requested
        if (startLine !== undefined || endLine !== undefined) {
          const s = (startLine ?? 1) - 1; // convert to 0-indexed
          const e = endLine ?? totalLines;
          const sliced = allLines.slice(Math.max(0, s), Math.min(totalLines, e));
          const rangeLabel = `lines ${s + 1}-${Math.min(totalLines, e)} of ${totalLines}`;
          return { content: treePrefix + `**${relPath}** (${rangeLabel})\n\n\`\`\`\n${sliced.join('\n')}\n\`\`\`` };
        }

        return { content: treePrefix + `**${relPath}** (${totalLines} lines)\n\n\`\`\`\n${result.content}\n\`\`\`` };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: `Failed to read "${relPath}": ${msg}`, isError: true };
      }
    },
  };
}

export function createSearchFilesTool(fs: IBuiltInToolFileSystem | undefined): IChatTool {
  return {
    name: 'fs_search_files',
    displaySummary: 'Find files on disk by name pattern.',
    description:
      'Finds files on disk by NAME pattern (case-insensitive substring of the filename). ' +
      'Use when locating a file by its name — e.g. "find the README", "any .csv files". ' +
      'For file CONTENT search use `fs_grep_search` (exact text/regex) or `fs_search_knowledge` (semantic). ' +
      'For canvas pages use `canvas_find_pages`.',
    parameters: {
      type: 'object',
      required: ['pattern'],
      properties: {
        pattern: { type: 'string', description: 'Name pattern.' },
        path: { type: 'string', description: 'Directory to search (default: workspace root).' },
      },
    },
    requiresConfirmation: false,
    permissionLevel: 'always-allowed' as ToolPermissionLevel,
    category: 'file-system',
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

// ── fs_grep_search tool (M41 Phase 8) ──

export function createGrepSearchTool(fs: IBuiltInToolFileSystem | undefined): IChatTool {
  return {
    name: 'fs_grep_search',
    displaySummary: 'Search file contents on disk by pattern.',
    description:
      'Searches file CONTENTS on disk for an EXACT text or regex pattern. ' +
      'Use when the user wants literal matches — symbol names, exact phrases, code patterns. ' +
      'Folder searches skip PDFs and other rich documents; to search inside a PDF, pass the PDF itself as path: matches then report the PDF page (the number to cite and link), not a line. ' +
      'For conceptual/semantic search ("anything about X") use `fs_search_knowledge`. ' +
      'For filename matching use `fs_search_files`. For canvas page contents use `canvas_find_pages`.',
    parameters: {
      type: 'object',
      required: ['pattern'],
      properties: {
        pattern: { type: 'string', description: 'Search pattern (plain text or regex).' },
        path: { type: 'string', description: 'Directory or file to search (default: workspace root).' },
        is_regex: { type: 'boolean', description: 'Treat pattern as regex.' },
        case_sensitive: { type: 'boolean', description: 'Case-sensitive match.' },
      },
    },
    requiresConfirmation: false,
    permissionLevel: 'always-allowed' as ToolPermissionLevel,
    category: 'file-system',
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
          if (m.page !== undefined) {
            // A PDF match: the page is the address; lines inside a page are
            // an artefact of text extraction, so they are not numbered.
            const header = `${m.file} (page ${m.page} of ${m.pageCount})`;
            const contextLines = m.context.map(c => `${c.lineNum === m.line ? '>' : ' '} ${c.text}`).join('\n');
            return `${header}\n${contextLines}`;
          }
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
  /** PDF matches: the page (1 = first page of the file) and the page count. */
  page?: number;
  pageCount?: number;
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
  // Rich documents — extracting text is too slow for line-by-line grep
  '.pdf', '.docx', '.epub', '.xlsx', '.xls', '.xlsm', '.xlsb', '.ods', '.numbers',
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
  // A PDF is searched page by page, so each match carries its page.
  if (/\.pdf$/i.test(filePath) && fs.readPdfPages) {
    let pages: readonly string[] | undefined;
    try {
      pages = await fs.readPdfPages(filePath);
    } catch {
      return; // Skip unreadable files
    }
    if (pages) {
      for (let p = 0; p < pages.length && results.length < MAX_GREP_MATCHES; p++) {
        const before = results.length;
        grepLines(filePath, pages[p].split('\n'), regex, results);
        for (let i = before; i < results.length; i++) {
          results[i].page = p + 1;
          results[i].pageCount = pages.length;
        }
      }
      return;
    }
  }

  let content: string;
  try {
    const result = await fs.readFileContent(filePath);
    content = result.content;
  } catch {
    return; // Skip unreadable files
  }

  grepLines(filePath, content.split('\n'), regex, results);
}

function grepLines(filePath: string, lines: readonly string[], regex: RegExp, results: GrepMatch[]): void {
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

/**
 * For each search result from a PDF, the page(s) its text is on, e.g.
 * "page 13 of 30" or "pages 13 to 14 of 30"; '' when it is not a PDF or the
 * page cannot be told (the chunk's text did not match the page text).
 */
async function pdfPagesForResults(
  fs: IBuiltInToolFileSystem | undefined,
  results: readonly { sourceType: string; sourceId: string; text: string }[],
): Promise<string[]> {
  const labels = results.map(() => '');
  if (!fs?.readPdfPages) return labels;
  const files = [...new Set(results.filter((r) => r.sourceType === 'file_chunk' && /\.pdf$/i.test(r.sourceId)).map((r) => r.sourceId))];
  const pagesByFile = new Map<string, readonly string[]>();
  await Promise.all(files.map(async (file) => {
    try {
      const pages = await fs.readPdfPages!(file);
      if (pages) pagesByFile.set(file, pages);
    } catch { /* no page for this file */ }
  }));
  results.forEach((r, i) => {
    const pages = r.sourceType === 'file_chunk' ? pagesByFile.get(r.sourceId) : undefined;
    if (pages) labels[i] = pageLabelForPassage(pages, r.text);
  });
  return labels;
}

export function createSearchKnowledgeTool(retrieval: IBuiltInToolRetrieval | undefined, fs?: IBuiltInToolFileSystem): IChatTool {
  return {
    name: 'fs_search_knowledge',
    displaySummary: 'Semantic search across pages AND files.',
    description:
      'Semantic (embedding) search across BOTH canvas pages and workspace files, including rich documents (PDF, DOCX, EPUB, XLSX). ' +
      'Use when the query is conceptual or open-ended — "what does X mean", "find anything about Y", "documents related to Z". ' +
      'For exact literal matches use `fs_grep_search`; for filename matches use `fs_search_files`; ' +
      'for canvas-only discovery use `canvas_find_pages`. ' +
      'Set `source_filter=page_block` for canvas-only, `file_chunk` for filesystem-only. ' +
      'A result from a PDF says which page it is on when that can be told (the number to cite and link).',
    parameters: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string', description: 'Natural language search query.' },
        source_filter: {
          type: 'string',
          description: 'page_block (canvas only) or file_chunk (files only).',
          enum: ['page_block', 'file_chunk'],
        },
        folder_path: {
          type: 'string',
          description: 'Folder path to restrict scope (e.g. "RF Guides/").',
        },
      },
    },
    requiresConfirmation: false,
    permissionLevel: 'always-allowed' as ToolPermissionLevel,
    category: 'file-system',
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

        const pagesOf = await pdfPagesForResults(fs, results);
        const formatted = results.map((r, i) => {
          const sourceLabel = r.contextPrefix || r.sourceId;
          const typeLabel = r.sourceType === 'page_block' ? 'Page' : 'File';
          const pageLabel = pagesOf[i] ? ` (${pagesOf[i]})` : '';
          return `[${i + 1}] (${typeLabel}) ${sourceLabel}${pageLabel} [score: ${r.score.toFixed(3)}]\n${r.text}`;
        }).join('\n\n---\n\n');

        return { content: `Found ${results.length} relevant results:\n\n${formatted}` };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: `Knowledge search failed: ${msg}`, isError: true };
      }
    },
  };
}
