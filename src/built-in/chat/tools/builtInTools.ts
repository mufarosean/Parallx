// builtInTools.ts — Built-in chat tool orchestrator (M9 Task 6.3 + M10 Task 3.3, split M13 Phase 5)
//
// Registers 23 tools with ILanguageModelToolsService by delegating to domain files:
//   pageTools.ts — search_workspace, read_page, read_page_by_title, read_current_page,
//                  list_pages, get_page_properties, create_page,
//                  list_property_definitions, set_page_property, find_pages_by_property
//   fileTools.ts — fs_list_files, fs_read_file, fs_search_files, fs_grep_search, fs_search_knowledge
//   memoryTools.ts — memory_read, memory_search
//   transcriptTools.ts — transcript_get, transcript_search
//   writeTools.ts — fs_write_file, fs_edit_file, fs_delete_file
//   terminalTools.ts — terminal_run_command
//
// Shared text helpers (extractSnippet, extractTextContent) remain here.

import type { IDisposable } from '../../../platform/lifecycle.js';
import type {
  IChatTool,
  ILanguageModelToolsService,
} from '../../../services/chatTypes.js';
import type {
  IBuiltInToolCanonicalMemorySearch,
  IBuiltInToolFileSystem,
  IBuiltInToolFileWriter,
  IBuiltInToolRetrieval,
  IBuiltInToolTranscriptSearch,
  IBuiltInToolTerminal,
  IBuiltInToolWorkspaceMemory,
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
  IBuiltInToolWorkspaceMemory,
  CurrentPageIdGetter,
  PageMutationNotifier,
} from '../chatTypes.js';

// ── Domain tool factories ──
// NOTE (M84): canvas page + block tools moved to src/built-in/canvas/ai/ and
// are now registered by the canvas tool itself (canvas owns the tools it
// exposes to the agent).
import {
  createListFilesTool,
  createReadFileTool,
  createSearchFilesTool,
  createGrepSearchTool,
  createSearchKnowledgeTool,
} from './fileTools.js';
import {
  createMemoryGetTool,
  createMemorySearchTool,
  createMemoryEditTool,
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
import { createSurfaceSendTool, createSurfaceListTool } from './surfaceTools.js';
import type { ISurfaceRouterService } from '../../../services/surfaceRouterService.js';
import type { IAutonomyLogReader } from '../../../services/autonomyLogService.js';
import { createCronTools, type ICronToolHost } from './cronTools.js';
import { createAutonomyLogTool } from './autonomyLogTool.js';
import { createActivityLogTool } from './activityLogTool.js';
import type { IActivityJournalService } from '../../../services/activityJournalService.js';
import { createSessionsSpawnTool } from './subagentTools.js';
import { bindCheckpointEnvironment } from '../../../services/fileCheckpointService.js';
import { makeWorkspaceFileRemover } from './writeTools.js';
import type { SubagentSpawner } from '../../../openclaw/openclawSubagentSpawn.js';

// ── Registration ──

/**
 * Register all built-in tools with the language model tools service.
 * Called during chat tool activation.
 *
 * @returns Array of disposables to unregister the tools.
 */
export function registerBuiltInTools(
  toolsService: ILanguageModelToolsService,
  fs: IBuiltInToolFileSystem | undefined,
  retrieval?: IBuiltInToolRetrieval,
  canonicalMemorySearch?: IBuiltInToolCanonicalMemorySearch,
  transcriptSearch?: IBuiltInToolTranscriptSearch,
  writer?: IBuiltInToolFileWriter,
  terminal?: IBuiltInToolTerminal,
  workspaceRoot?: string,
  surfaceRouter?: ISurfaceRouterService,
  cronHost?: ICronToolHost,
  subagentSpawner?: SubagentSpawner,
  autonomyLog?: IAutonomyLogReader,
  workspaceMemory?: IBuiltInToolWorkspaceMemory,
  activityJournal?: IActivityJournalService,
): IDisposable[] {
  const disposables: IDisposable[] = [];

  // HARNESS.md §2.2 — give the checkpoint store its file access so the write
  // tools can capture prior state and /rewind can restore it.
  bindCheckpointEnvironment({ fs, writer, workspaceRoot, remove: makeWorkspaceFileRemover(workspaceRoot) });

  // Canvas page/block tools are no longer registered here — the canvas tool
  // owns them (src/built-in/canvas/ai/). This module keeps the workspace-level
  // tools: files, memory, transcripts, write, terminal, RAG, surface, cron,
  // subagent, autonomy.
  const tools: IChatTool[] = [
    // ── File system tools ──
    createListFilesTool(fs),
    createReadFileTool(fs),
    createSearchFilesTool(fs),
    createGrepSearchTool(fs),
    createMemoryGetTool(fs, workspaceMemory),
    createMemorySearchTool(canonicalMemorySearch),
    createMemoryEditTool(workspaceMemory),
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
    // ── Surface routing tools (M58 W6) ──
    createSurfaceSendTool(surfaceRouter),
    createSurfaceListTool(surfaceRouter),
    // ── Cron scheduling tools (M58 W4) ──
    ...createCronTools(cronHost),
    // ── Subagent spawn tool (M58 W5) ──
    createSessionsSpawnTool(subagentSpawner),
    // ── Autonomy log read tool (M58-real post-ship UX reshape) ──
    createAutonomyLogTool(autonomyLog),
    // ── Activity journal read tool (the app's common activity language) ──
    createActivityLogTool(activityJournal),
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
