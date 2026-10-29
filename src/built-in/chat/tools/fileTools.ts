// fileTools.ts — File system tool registrations

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
import { formatBytes } from '../../../ui/format.js';
import { contributedSkillFile } from '../../../services/chatContributions.js';
import {
  blocksOf, blocksSize, blocksWithin, fileLinkUri, findPassages, isDocumentPath, loadLiveDoc, outlineOf, renderBlocks,
  relatedPassages, SOURCE_LABEL_GUIDE, START_OF_LARGE_FILE_CHARS, type LiveBlock, type LiveDoc,
} from './sourceReading.js';
import { citeSource } from '../../../services/sourceHandles.js';

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
    alwaysLoad: true,
    displaySummary: 'List files / directories on disk.',
    description:
      'Lists files and directories on disk at a workspace path. ' +
      'Use when exploring filesystem structure or confirming a file exists before reading it. ' +
      'For canvas pages (the page DB) use `canvas_find_pages`. ' +
      'For finding files by name pattern use `fs_search_files`; for content search use `fs_grep_search`.',
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
          const sizeLabel = e.type === 'file' ? ` (${formatBytes(e.size)})` : '';
          return `${typeLabel} ${e.name}${sizeLabel}`;
        });

        return { content: `Contents of "${relPath}" in workspace "${fs!.workspaceRootName}":\n\n${lines.join('\n')}` };
      } catch (err) {
        return { content: `Failed to list "${relPath}": ${err instanceof Error ? err.message : String(err)}`, isError: true };
      }
    },
  };
}

export function createReadFileTool(fs: IBuiltInToolFileSystem | undefined, retrieval?: IBuiltInToolRetrieval): IChatTool {
  return {
    name: 'fs_read_file',
    alwaysLoad: true,
    displaySummary: 'Read a workspace file on disk.',
    description:
      'Reads a workspace file on disk — text (.md, .txt, source code) or documents (PDF, DOCX, EPUB, XLSX), of any size. ' +
      'A file that fits comes back whole. A large one (a book, a long report) comes back as its start; to find something in it, ' +
      'pass `query` with what you are looking for and you get the passages that answer it, wherever they are in the file. ' +
      'Every block of text starts with a source label like [S3]: cite what a block says by writing its label after the sentence. ' +
      'Use `start_page`/`end_page` (PDF) or `start_line`/`end_line` (text) to read a known range. ' +
      'Never write a script to read a document: this tool reads every page. ' +
      'For canvas pages (page DB) use `canvas_read_page`.',
    parameters: {
      type: 'object',
      required: ['path'],
      properties: {
        path: { type: 'string', description: 'Relative file path from workspace root.' },
        query: { type: 'string', description: 'What you are looking for in the file, in plain words. For a large file, returns the passages that answer it.' },
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
      const query = typeof args['query'] === 'string' ? args['query'].trim() : '';
      const num = (k: string) => typeof args[k] === 'number' ? Math.max(1, Math.floor(args[k] as number)) : undefined;
      const startLine = num('start_line');
      const endLine = num('end_line');
      const startPage = num('start_page');
      const endPage = num('end_page');
      const sessionId = invocation?.sessionId;
      // What this result may use of the model's window, less room for the
      // header and notes; never more than a document read ever returned.
      const budget = invocation?.resultCharBudget
        ? Math.max(4_000, Math.min(MAX_DOC_TEXT_CHARS, invocation.resultCharBudget - 3_000))
        : MAX_DOC_TEXT_CHARS;

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

        let doc: LiveDoc | undefined;
        try {
          doc = await loadLiveDoc(fs!, relPath);
        } catch (err) {
          // A skill a running tool brought has no file: read it from the tool.
          const fromTool = contributedSkillFile(relPath);
          if (fromTool === undefined) throw err;
          return { content: treePrefix + `**${relPath}**\n\n${fromTool}` };
        }
        if (!doc) return { content: `Failed to read "${relPath}"`, isError: true };

        // M85 Slice C — a successful read (even a range) marks the file as
        // seen for this session, unlocking fs_edit_file on it.
        if (sessionId) markResourceSeen(sessionId, fileResourceKey(relPath));

        const dotIdx = relPath.lastIndexOf('.');
        const ext = dotIdx >= 0 ? relPath.slice(dotIdx).toLowerCase() : '';
        if (doc.kind === 'page' && doc.pages.every((p) => !p.trim())) {
          return { content: treePrefix + `**${relPath}** (.pdf file, ${doc.pages.length} page${doc.pages.length === 1 ? '' : 's'})\n\n[Document is empty or could not extract text — it may be a scan without a text layer]` };
        }
        if (doc.kind === 'text' && !doc.text.trim()) {
          return { content: treePrefix + `**${relPath}** (${ext} file)\n\n[Document is empty or could not extract text]` };
        }

        // Source code and data are read to be worked on: one block, as the
        // file has it, so an edit never straddles a block header.
        const blocks = doc.kind === 'line' && !isDocumentPath(relPath) ? wholeFileBlock(doc) : blocksOf(doc);
        const kindLabel = doc.kind === 'page' ? `.pdf file, ${doc.pages.length} pages`
          : doc.kind === 'line' ? `${doc.lines.length} lines`
          : `${ext} file`;
        // Spreadsheet text is CSV with blank rows left out: its lines are
        // not the workbook's rows, so a row number read off it is wrong.
        const sheetNote = SPREADSHEET_EXTS.has(ext)
          ? '*Rows below are not numbered as in the workbook (blank rows are left out). To cite a cell, give link_create the quoted words: it returns the sheet and cell.*\n\n'
          : '';
        const guide = isDocumentPath(relPath) ? `${SOURCE_LABEL_GUIDE}\n\n${sheetNote}` : sheetNote;
        const out = (what: string, shown: readonly LiveBlock[], note = '') =>
          ({ content: `${treePrefix}**${relPath}** (${what})\n\n${guide}\`\`\`\n${renderBlocks(sessionId, relPath, shown)}\n\`\`\`${note ? `\n\n${note}` : ''}` });

        // A range asked for by page.
        if (doc.kind === 'page' && (startPage !== undefined || endPage !== undefined)) {
          const total = doc.pages.length;
          const from = Math.min(startPage ?? 1, total);
          const to = Math.min(Math.max(from, endPage ?? total), total);
          const shown = blocksWithin(blocks.filter((b) => b.page! >= from && b.page! <= to), budget);
          const last = shown[shown.length - 1].page!;
          return out(`pages ${from} to ${last} of ${total}`, shown, last < to
            ? `*Stopped at page ${last} (length limit). To find something specific, pass \`query\`; to read on, start_page=${last + 1}.*`
            : '');
        }
        // A range asked for by line: exactly those lines, one block.
        if (doc.kind === 'line' && (startLine !== undefined || endLine !== undefined)) {
          const total = doc.lines.length;
          const s = Math.min(startLine ?? 1, total);
          const e = Math.min(Math.max(s, endLine ?? total), total);
          return out(`lines ${s}-${e} of ${total}`, [lineRangeBlock(doc, s, e)]);
        }

        // It fits: the whole file.
        if (blocksSize(blocks) <= budget) return out(kindLabel, blocks);

        // Too large to show whole. With a question: the passages that answer it.
        if (query) {
          const found = await findPassages(retrieval, relPath, blocks, query, budget);
          if (found.picked.length === 0) {
            return { content: `${treePrefix}**${relPath}** (${kindLabel})\n\nNo passage in this file matches "${query}". Try other words for it, or read a range with ${doc.kind === 'page' ? 'start_page/end_page' : 'start_line/end_line'}.` };
          }
          const shown = found.picked.map((i) => blocks[i]);
          return out(`${kindLabel}; ${shown.length} passage${shown.length === 1 ? '' : 's'} for "${query}"`, shown,
            `*These are the parts of the file that answer "${query}", in file order. For something else, call again with another \`query\`.*`);
        }

        // No question: its start, and how to find the rest.
        const shown = blocksWithin(blocks, START_OF_LARGE_FILE_CHARS);
        const outline = outlineOf(doc);
        const outlineNote = outline.length > 0 ? `\n\nHeadings in this file:\n${outline.map((h) => `- ${h}`).join('\n')}` : '';
        return out(`${kindLabel}; the start of a large file`, shown,
          `*This is only the start: the file is too large to show whole. To find something in it, call fs_read_file again with \`query\` set to what you are looking for; you get the passages that answer it, wherever they are.*${outlineNote}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: `Failed to read "${relPath}": ${msg}`, isError: true };
      }
    },
  };
}

/** A code or data file as one block. */
function wholeFileBlock(doc: Extract<LiveDoc, { kind: 'line' }>): LiveBlock[] {
  if (doc.lines.length === 0) return [];
  const blocks = blocksOf(doc);
  // A file over the budget is read in its windows; one that fits is one block.
  if (blocksSize(blocks) > MAX_DOC_TEXT_CHARS) return blocks;
  return [lineRangeBlock(doc, 1, doc.lines.length)];
}

/** Lines s..e (1-based, inclusive) of a text file as one block. */
function lineRangeBlock(doc: Extract<LiveDoc, { kind: 'line' }>, s: number, e: number): LiveBlock {
  const name = doc.path.split('/').pop() || doc.path;
  const total = doc.lines.length;
  return {
    text: doc.lines.slice(s - 1, e).join('\n'),
    location: `${doc.path} · lines ${s} to ${e} of ${total}`,
    title: s === 1 && e === total ? name : `${name}, line ${s}`,
    uri: fileLinkUri(doc.path, { line: s }),
    firstLine: s,
    lastLine: e,
  };
}

export function createSearchFilesTool(fs: IBuiltInToolFileSystem | undefined): IChatTool {
  return {
    name: 'fs_search_files',
    alwaysLoad: true,
    displaySummary: 'Find files on disk by name pattern.',
    description:
      'Finds files on disk by NAME pattern (case-insensitive substring of the filename). ' +
      'Use when locating a file by its name — e.g. "find the README", "any .csv files". ' +
      'For file CONTENT search use `fs_grep_search`. ' +
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

// ── fs_grep_search tool ──

export function createGrepSearchTool(fs: IBuiltInToolFileSystem | undefined, retrieval?: IBuiltInToolRetrieval): IChatTool {
  return {
    name: 'fs_grep_search',
    alwaysLoad: true,
    displaySummary: 'Search file contents on disk by pattern.',
    description:
      'Searches the workspace for a text or regex pattern: exact matches in files, then, for plain text, ' +
      'passages related to it by meaning from documents (PDF, Word, EPUB, notes) and canvas pages, from the knowledge index. ' +
      'Use it to find where something is said or defined, or what the documents say about a topic. ' +
      'Passages and PDF matches carry a source label like [S3]: cite what they say by writing the label after the sentence. ' +
      'To read more of a document a result came from, use `fs_read_file` with `query`. ' +
      'For filename matching use `fs_search_files`. For canvas page contents use `canvas_find_pages`.',
    parameters: {
      type: 'object',
      required: ['pattern'],
      properties: {
        pattern: { type: 'string', description: 'Search pattern: plain words or a phrase (also finds related passages), or a regex with is_regex.' },
        path: { type: 'string', description: 'Directory or file to search (default: workspace root).' },
        is_regex: { type: 'boolean', description: 'Treat pattern as regex.' },
        case_sensitive: { type: 'boolean', description: 'Case-sensitive match.' },
      },
    },
    requiresConfirmation: false,
    permissionLevel: 'always-allowed' as ToolPermissionLevel,
    category: 'file-system',
    async handler(args: Record<string, unknown>, _token: ICancellationToken, invocation?: IChatToolInvocationCallContext): Promise<IToolResult> {
      requireFs(fs);
      const sessionId = invocation?.sessionId;
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
        // Folder searches skip documents (too slow to extract line by line);
        // the index brings in what they say, placed on their live text.
        const related = isRegex ? '' : await relatedPassages(fs!, retrieval, patternStr, rootPath, sessionId);
        const relatedPart = related
          ? `Related passages (by meaning, from the knowledge index):\n\n${related}`
          : '';

        if (matches.length === 0) {
          return { content: relatedPart
            ? `No exact matches for "${patternStr}" in "${rootPath}".\n\n${relatedPart}`
            : `No matches found for "${patternStr}" in "${rootPath}".` };
        }

        const formatted = matches.map(m => {
          if (m.page !== undefined) {
            // A PDF match: the page is the address; lines inside a page are
            // an artefact of text extraction, so they are not numbered. The
            // page is labelled as a read labels it, so both cite alike.
            const label = sessionId && m.pageText !== undefined
              ? `[${labelPdfPage(sessionId, m.file, m.page, m.pageCount!, m.pageText)}] `
              : '';
            const header = `${label}${m.file} (page ${m.page} of ${m.pageCount})`;
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
          content: `Found ${matches.length} match(es) for "${patternStr}":\n\n${formatted}${truncNote}${relatedPart ? `\n\n${relatedPart}` : ''}`,
        };
      } catch (err) {
        return { content: `Grep search failed: ${err instanceof Error ? err.message : String(err)}`, isError: true };
      }
    },
  };
}

/** Label a PDF page exactly as fs_read_file labels it, so both give it one handle. */
function labelPdfPage(sessionId: string, path: string, page: number, pageCount: number, text: string): string {
  const name = path.split('/').pop() || path;
  const uri = fileLinkUri(path, { page });
  const location = `${path} · page ${page} of ${pageCount}`;
  return citeSource(sessionId, { key: `${uri}#${location}`, location, title: `${name}, page ${page}`, uri, text: text.trim(), document: true });
}

interface GrepMatch {
  file: string;
  line: number;
  context: { lineNum: number; text: string }[];
  /** PDF matches: the page (1 = first page of the file) and the page count. */
  page?: number;
  pageCount?: number;
  /** PDF matches: the page's text, for its source label. */
  pageText?: string;
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
          results[i].pageText = pages[p];
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
