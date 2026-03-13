// builtInTools.ts — Built-in chat tool orchestrator (M9 Task 6.3 + M10 Task 3.3, split M13 Phase 5)
//
// Registers 15 tools with ILanguageModelToolsService by delegating to domain files:
//   pageTools.ts — search_workspace, read_page, read_page_by_title, read_current_page,
//                  list_pages, get_page_properties, create_page
//   fileTools.ts — list_files, read_file, search_files, search_knowledge
//   memoryTools.ts — memory_get, memory_search
//   transcriptTools.ts — transcript_get, transcript_search
//   writeTools.ts — write_file, edit_file, delete_file
//   terminalTools.ts — run_command
//
// Shared text helpers (extractSnippet, extractTextContent) remain here.

import type { IDisposable } from '../../../platform/lifecycle.js';
import type {
  IChatTool,
  ILanguageModelToolsService,
} from '../../../services/chatTypes.js';
import type {
  IBuiltInToolDatabase,
  IBuiltInToolCanonicalMemorySearch,
  IBuiltInToolFileSystem,
  IBuiltInToolFileWriter,
  IBuiltInToolRetrieval,
  IBuiltInToolTranscriptSearch,
  IBuiltInToolTerminal,
  CurrentPageIdGetter,
} from '../chatTypes.js';

// Re-export for backward compatibility (M13 Phase 1)
export type {
  IBuiltInToolDatabase,
  IBuiltInToolCanonicalMemorySearch,
  IBuiltInToolFileSystem,
  IBuiltInToolFileWriter,
  IBuiltInToolRetrieval,
  IBuiltInToolTranscriptSearch,
  IBuiltInToolTerminal,
  CurrentPageIdGetter,
} from '../chatTypes.js';

// ── Domain tool factories ──
import {
  createSearchWorkspaceTool,
  createReadPageTool,
  createReadPageByTitleTool,
  createReadCurrentPageTool,
  createListPagesTool,
  createGetPagePropertiesTool,
  createCreatePageTool,
} from './pageTools.js';
import {
  createListFilesTool,
  createReadFileTool,
  createSearchFilesTool,
  createSearchKnowledgeTool,
} from './fileTools.js';
import {
  createMemoryGetTool,
  createMemorySearchTool,
} from './memoryTools.js';
import {
  createTranscriptGetTool,
  createTranscriptSearchTool,
} from './transcriptTools.js';
import {
  createWriteFileTool,
  createEditFileTool,
  createDeleteFileTool,
} from './writeTools.js';
import { createRunCommandTool } from './terminalTools.js';

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
  retrieval?: IBuiltInToolRetrieval,
  canonicalMemorySearch?: IBuiltInToolCanonicalMemorySearch,
  transcriptSearch?: IBuiltInToolTranscriptSearch,
  writer?: IBuiltInToolFileWriter,
  terminal?: IBuiltInToolTerminal,
  workspaceRoot?: string,
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
    createMemoryGetTool(fs),
    createMemorySearchTool(canonicalMemorySearch),
    createTranscriptGetTool(fs),
    createTranscriptSearchTool(transcriptSearch),
    // ── Write tools (M11 Task 2.2 + 2.3) ──
    createWriteFileTool(fs, writer),
    createEditFileTool(fs, writer),
    // ── Delete tool (M11 Task 4.4) ──
    createDeleteFileTool(fs, writer, workspaceRoot),
    // ── Terminal tool (M11 Task 4.3) ──
    createRunCommandTool(terminal, workspaceRoot),
    // ── RAG tools (M10 Phase 3) ──
    createSearchKnowledgeTool(retrieval),
  ];

  for (const tool of tools) {
    disposables.push(toolsService.registerTool(tool));
  }

  return disposables;
}

// ── Text helpers (shared by pageTools and external consumers) ──

/**
 * Extract a snippet of text around a search query from content.
 * Tries to find the query in the content and returns surrounding context.
 */
export function extractSnippet(content: string, query: string, maxLength: number): string {
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
