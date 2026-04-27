// chatDataService.ts — Centralised data-layer service for the chat built-in (M13 Phase 2)
//
// Every database query, filesystem operation, retrieval call, memory access,
// and workspace digest computation lives in this single, testable class.
//
// The class replaces ~30 anonymous closures previously scattered across
// chatTool.ts's activate() function.  Builder methods compose these into
// the service interfaces expected by participants, widgets, and the token bar.
//
// RULE: This file has ZERO DOM references.  All UI delegation goes through
// callback deps (getActiveWidget, etc.).

import type {
  IChatRuntimeTrace,
  IOpenclawBootstrapDebugReport,
  IOpenclawSystemPromptReport,
  IChatWidgetServices,
  ITokenStatusBarServices,
  IBuiltInToolFileSystem,
  IPageSummary,
  IBlockSummary,
  IPageStructure,
  IWorkspaceFileEntry,
} from '../chatTypes.js';

import type {
  IChatMessage,
  IChatRequestOptions,
  IChatResponseChunk,
  IToolDefinition,
  ICancellationToken,
  IToolResult,
  IContextPill,
  IChatRequestResponsePair,
} from '../../../services/chatTypes.js';
import {
  ChatContentPartKind,
  ChatMode,
  ChatRequestQueueKind,
} from '../../../services/chatTypes.js';

import type { Event } from '../../../platform/events.js';

import type { IAgentApprovalService, IAgentExecutionService, IAgentPolicyService, IAgentSessionService, IAgentTaskStore, IAgentTraceService, ICanonicalMemorySearchService, IDatabaseService, IFileService, IWorkspaceService, IEditorService, IRetrievalService, IIndexingPipelineService, IMemoryService, ITextFileModelManager, ISessionManager, IWorkspaceMemoryService } from '../../../services/serviceTypes.js';
import type { IUnifiedAIConfigService } from '../../../aiSettings/unifiedConfigTypes.js';
import type { ILanguageModelsService, IChatService, IChatModeService, ILanguageModelToolsService } from '../../../services/chatTypes.js';
import type { ILanguageModelToolsRuntimeControl } from '../../../services/languageModelToolsService.js';
import type { OllamaProvider } from '../providers/ollamaProvider.js';
import type { PromptFileService } from '../../../services/promptFileService.js';
import type { ChatWidget } from '../widgets/chatWidget.js';
import type { IWorkspaceSessionContext } from '../../../workspace/workspaceSessionContext.js';
import type { RetrievalTrace } from '../../../services/retrievalService.js';
import { detectPreferences, formatConceptContextBlock } from '../../../services/memoryService.js';
import { searchWorkspaceTranscripts } from '../../../services/transcriptSearch.js';
import type { PermissionService } from '../../../services/permissionService.js';

import { extractTextContent } from '../tools/builtInTools.js';
import { buildChatAgentTaskWidgetServices } from '../utilities/chatAgentTaskWidgetAdapter.js';
import { buildChatWidgetAttachmentServices } from '../utilities/chatWidgetAttachmentAdapter.js';
import { buildChatWidgetPickerServices } from '../utilities/chatWidgetPickerAdapter.js';
import { buildChatWidgetRequestServices } from '../utilities/chatWidgetRequestAdapter.js';
import { buildChatWidgetSessionServices } from '../utilities/chatWidgetSessionAdapter.js';

import { buildChatTokenBarServices } from '../utilities/chatTokenBarAdapter.js';
import { openChatFile, openChatMemoryViewer } from '../utilities/chatViewerOpeners.js';
import { computeChatWorkspaceDigest } from '../utilities/chatWorkspaceDigest.js';

function resolveMemoryRecallScope(query: string): {
  layer: 'all' | 'durable' | 'daily';
  date?: string;
  asksForPriorConversationRecall: boolean;
} {
  const normalizedQuery = query.toLowerCase().replace(/[’']/g, ' ');
  const asksForPriorConversationRecall = /(last|previous|prior)\s+(conversation|chat|session)|remember\s+about\s+(?:my|our)\s+(?:last|previous|prior)|recall\s+(?:my|our)\s+(?:last|previous|prior)/i.test(normalizedQuery);
  const explicitDateMatch = normalizedQuery.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  const hasDailyIndicators = /\b(daily|today|yesterday|recent|recently|earlier today|this morning|this afternoon|tonight|codename)\b/.test(normalizedQuery) || asksForPriorConversationRecall;
  const hasDurableIndicators = /\b(prefer|preference|preferences|decision|decisions|convention|conventions|rule|rules|style|tone|remember about me|durable)\b/.test(normalizedQuery);

  if (explicitDateMatch?.[1]) {
    return {
      layer: 'daily',
      date: explicitDateMatch[1],
      asksForPriorConversationRecall,
    };
  }

  if (hasDailyIndicators && hasDurableIndicators) {
    return {
      layer: 'all',
      asksForPriorConversationRecall,
    };
  }

  if (hasDailyIndicators) {
    return {
      layer: 'daily',
      asksForPriorConversationRecall,
    };
  }

  if (hasDurableIndicators) {
    return {
      layer: 'durable',
      asksForPriorConversationRecall,
    };
  }

  return {
    layer: 'all',
    asksForPriorConversationRecall,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Dependency bag passed to the ChatDataService constructor.
 * All optional services are `undefined` when the corresponding module
 * is unavailable (e.g. no workspace folder open → no fileService).
 */
export interface ChatDataServiceDeps {
  readonly databaseService: IDatabaseService | undefined;
  readonly fileService: IFileService | undefined;
  readonly workspaceService: IWorkspaceService | undefined;
  readonly editorService: IEditorService | undefined;
  readonly retrievalService: IRetrievalService | undefined;
  readonly indexingPipelineService: IIndexingPipelineService | undefined;
  readonly memoryService: IMemoryService | undefined;
  readonly workspaceMemoryService?: IWorkspaceMemoryService;
  readonly canonicalMemorySearchService?: ICanonicalMemorySearchService;
  readonly languageModelsService: ILanguageModelsService;
  readonly languageModelToolsService: ILanguageModelToolsService | undefined;
  readonly chatService: IChatService;
  readonly modeService: IChatModeService;
  readonly ollamaProvider: OllamaProvider;
  readonly promptFileService: PromptFileService;
  readonly fsAccessor: IBuiltInToolFileSystem | undefined;
  readonly textFileModelManager: ITextFileModelManager | undefined;
  readonly maxIterations: number;
  readonly networkTimeout: number;
  readonly getActiveWidget: () => ChatWidget | undefined;
  /** Callback to open a canvas page by its UUID. Provided by main.ts via api.editors. */
  readonly openPage?: (pageId: string) => Promise<void>;
  /** Workspace session context (M14). Carries sessionId, logPrefix, abort signal. */
  readonly sessionContext?: IWorkspaceSessionContext;
  /** Session manager (M14). Used for stale session detection in tool invocations. */
  readonly sessionManager?: ISessionManager;
  /** Unified AI Config service (M20). Single source of truth for all AI configuration. */
  readonly unifiedConfigService?: IUnifiedAIConfigService;
  readonly permissionService?: PermissionService;
  /** Autonomy services used for task and approval UI surfaces. */
  readonly agentSessionService?: IAgentSessionService;
  readonly agentApprovalService?: IAgentApprovalService;
  readonly agentExecutionService?: IAgentExecutionService;
  readonly agentTraceService?: IAgentTraceService;
  readonly agentPolicyService?: IAgentPolicyService;
  readonly agentTaskStore?: IAgentTaskStore;
  /** Open a file in the editor via the standard EditorsBridge resolver (same as explorer). */
  readonly openFileEditor?: (uri: string, options?: { pinned?: boolean }) => Promise<void>;
}

export interface IChatTestDebugSnapshot {
  query?: string;
  retrievedContextText?: string;
  ragSources: Array<{ uri: string; label: string; index: number }>;
  contextPills: Array<{ id: string; label: string; type: string; removable: boolean; index?: number; tokens?: number }>;
  retrievalTrace?: RetrievalTrace;
  isRAGAvailable: boolean;
  isIndexing: boolean;
  indexingProgress?: { phase: string; processed: number; total: number; currentSource?: string };
  indexStats?: { pages: number; files: number };
  requestInProgress?: boolean;
  pendingRequestCount?: number;
  assistantMessageCount?: number;
  lastAssistantResponseText?: string;
  lastAssistantResponseComplete?: boolean;
  lastAssistantPartKinds?: string[];
  lastAssistantPartSummary?: Array<{ kind: string; preview: string }>;
  responseDebug?: {
    phase: string;
    markdownLength: number;
    yielded: boolean;
    cancelled: boolean;
    retrievedContextLength: number;
    note?: string;
  };
  retrievalGate?: {
    hasActiveSlashCommand: boolean;
    isRagReady: boolean;
    needsRetrieval: boolean;
    attempted: boolean;
    returnedSources?: number;
  };
  explicitSourceDebug?: {
    attempted: boolean;
    matchedPath?: string;
    readSucceeded: boolean;
    reason?: string;
  };
  participantDebug?: {
    surface: 'workspace' | 'canvas';
    usedSharedTurnState: boolean;
    attachmentCount: number;
    fileAttachmentCount: number;
    imageAttachmentCount: number;
    queryScopeLevel?: string;
  };
  runtimeTrace?: IChatRuntimeTrace;
  bootstrapContext?: IOpenclawBootstrapDebugReport;
  systemPromptReport?: IOpenclawSystemPromptReport;
  retrievalError?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Static Helpers
// ═══════════════════════════════════════════════════════════════════════════════

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// MAX_FILE_READ_BYTES removed — readFileContent has no artificial size limit.
// Callers (tool handlers, attachment pipeline) control their own truncation.
const MAX_EXPLICIT_SOURCE_CONTEXT_CHARS = 30_000;
const MAX_EXPLICIT_SOURCE_SCAN_FILES = 2_000;
const MAX_EXPLICIT_SOURCE_SCAN_DEPTH = 6;
const EXPLICIT_SOURCE_QUERY_PATTERNS: readonly RegExp[] = [
  /\baccording to\b/i,
  /\bin (?:the )?.*\b(?:book|document|file|pdf|guide|paper)\b/i,
  /\bfrom (?:the )?.*\b(?:book|document|file|pdf|guide|paper)\b/i,
  /\bwhich (?:book|document|file|pdf|guide|paper)\b/i,
  /\bwho wrote\b/i,
  /\bauthor of\b/i,
  /\bcopy of\b/i,
  /\bversion of\b/i,
  /\bdo i have both\b/i,
  /\bname\s+three\s+books\b/i,
  /^which one\b/i,
];
const EXPLICIT_SOURCE_STOPWORDS = new Set([
  'a', 'an', 'and', 'art', 'basic', 'book', 'books', 'by', 'cite', 'course', 'document', 'documents', 'file',
  'files', 'folder', 'from', 'guide', 'have', 'idea', 'in', 'is', 'of', 'on', 'opening', 'page', 'pages', 'paper', 'pdf',
  'please', 'praise', 'source', 'sources', 'student', 'text', 'the', 'this', 'to', 'version', 'versions', 'which', 'who',
  'work', 'workspace', 'wrote', 'author', 'authors', 'both', 'copy', 'copies', 'you', 'your', 'me', 'my', 'epub', 'name',
  'three', 'language', 'culture', 'focus', 'relevance', 'notes', 'title', 'titles',
]);

type ExplicitSourceFormat = 'pdf' | 'epub';

const EXPLICIT_SOURCE_STRUCTURED_DOC_TERMS = [
  'study guide',
  'reading list',
  'workbook',
  'manual',
  'handbook',
  'outline',
  'summary',
  'summaries',
  'contents',
  'table of contents',
  'toc',
  'guide',
];

interface IExplicitSourceQueryFeatures {
  readonly queryTokens: string[];
  readonly normalizedQuery: string;
  readonly anchors: string[];
  readonly wantsStructuredDocument: boolean;
  readonly wantsOrderingStructure: boolean;
}

interface IExplicitSourceCandidateScore {
  readonly relativePath: string;
  readonly extension: string;
  readonly score: number;
  readonly matchedLabelTokens: string[];
  readonly matchedPathTokens: string[];
  readonly anchorMatches: string[];
}

function normalizeExplicitSourceText(text: string): string {
  return text
    .toLowerCase()
    .replace(/foreign\s+service\s+institute/g, 'fsi')
    .replace(/\.(pdf|docx|md|txt|epub|xlsx|xls)$/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeExplicitSourceText(text: string): string[] {
  return normalizeExplicitSourceText(text)
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !EXPLICIT_SOURCE_STOPWORDS.has(token));
}

function shouldUseExplicitSourceFallback(query: string): boolean {
  return EXPLICIT_SOURCE_QUERY_PATTERNS.some((pattern) => pattern.test(query))
    || extractRequestedExplicitFormats(query).length > 0;
}

function extractRequestedExplicitFormats(query: string): ExplicitSourceFormat[] {
  const formats: ExplicitSourceFormat[] = [];
  if (/\bpdf\b/i.test(query)) {
    formats.push('pdf');
  }
  if (/\bepub\b/i.test(query)) {
    formats.push('epub');
  }
  return formats;
}

export function extractExplicitSourceAnchors(query: string): string[] {
  const normalizedQuery = query
    .toLowerCase()
    .replace(/[’']/g, ' ')
    .replace(/[^a-z0-9\s&._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalizedQuery) {
    return [];
  }

  const anchors = new Set<string>();
  const patterns = [
    /(?:according to|in|inside|from)\s+(?:the\s+)?([a-z0-9][a-z0-9\s&._-]{2,100}?)\s+(?:table of contents|toc|contents)\b/g,
    /(?:according to|in|inside|from)\s+(?:the\s+)?([a-z0-9][a-z0-9\s&._-]{2,100}?(?:study guide|reading list|workbook|manual|handbook|outline|summary|summaries|guide|book|document|paper|pdf|file))\b/g,
  ];

  for (const pattern of patterns) {
    for (const match of normalizedQuery.matchAll(pattern)) {
      const rawAnchor = match[1]?.trim();
      if (!rawAnchor) {
        continue;
      }
      const normalizedAnchor = normalizeExplicitSourceText(rawAnchor);
      if (normalizedAnchor.length >= 6) {
        anchors.add(normalizedAnchor);
      }
    }
  }

  return [...anchors];
}

function buildExplicitSourceQueryFeatures(query: string): IExplicitSourceQueryFeatures {
  const normalizedQuery = normalizeExplicitSourceText(query);
  return {
    queryTokens: tokenizeExplicitSourceText(query),
    normalizedQuery,
    anchors: extractExplicitSourceAnchors(query),
    wantsStructuredDocument: EXPLICIT_SOURCE_STRUCTURED_DOC_TERMS.some((term) => normalizedQuery.includes(normalizeExplicitSourceText(term))),
    wantsOrderingStructure: /\b(?:table of contents|toc|contents|comes after|comes before|next|previous|following|preceding|order)\b/.test(normalizedQuery),
  };
}

function candidateHasStructuredDocumentCue(normalizedCandidate: string): boolean {
  return EXPLICIT_SOURCE_STRUCTURED_DOC_TERMS.some((term) => normalizedCandidate.includes(normalizeExplicitSourceText(term)));
}

function candidateMatchesAnchor(anchor: string, normalizedLabel: string, normalizedPath: string): boolean {
  if (normalizedLabel.includes(anchor) || normalizedPath.includes(anchor)) {
    return true;
  }

  const anchorTokens = tokenizeExplicitSourceText(anchor);
  if (anchorTokens.length === 0) {
    return false;
  }

  const candidateTokens = new Set([
    ...tokenizeExplicitSourceText(normalizedLabel),
    ...tokenizeExplicitSourceText(normalizedPath),
  ]);
  const matchedAnchorTokens = anchorTokens.filter((token) => candidateTokens.has(token));
  return matchedAnchorTokens.length >= Math.min(anchorTokens.length, 2);
}

export function scoreExplicitSourceCandidate(query: string, relativePath: string): IExplicitSourceCandidateScore {
  const features = buildExplicitSourceQueryFeatures(query);
  const label = toDisplayLabel(relativePath);
  const normalizedLabel = normalizeExplicitSourceText(label);
  const normalizedPath = normalizeExplicitSourceText(relativePath);
  const labelTokens = tokenizeExplicitSourceText(label);
  const pathTokens = tokenizeExplicitSourceText(relativePath);
  const matchedLabelTokens = labelTokens.filter((token) => features.queryTokens.includes(token));
  const matchedPathTokens = pathTokens.filter((token) => features.queryTokens.includes(token));
  const exactLabelPhraseMatch = features.normalizedQuery.includes(normalizedLabel);
  const exactPathPhraseMatch = features.normalizedQuery.includes(normalizedPath);
  const anchorMatches = features.anchors.filter((anchor) => candidateMatchesAnchor(anchor, normalizedLabel, normalizedPath));
  const structuredCue = candidateHasStructuredDocumentCue(normalizedLabel) || candidateHasStructuredDocumentCue(normalizedPath);
  let score = matchedPathTokens.length + matchedLabelTokens.length + (exactLabelPhraseMatch ? 3 : 0) + (exactPathPhraseMatch ? 2 : 0);

  if (anchorMatches.length > 0) {
    score += 6 + anchorMatches.reduce((sum, anchor) => sum + Math.min(2, tokenizeExplicitSourceText(anchor).length - 1), 0);
  }

  if (features.wantsStructuredDocument && structuredCue) {
    score += 3;
  }
  if (features.wantsOrderingStructure && structuredCue) {
    score += 3;
  }

  if (features.anchors.length > 0 && anchorMatches.length === 0 && matchedLabelTokens.length <= 1 && matchedPathTokens.length <= 1) {
    score -= 3;
  }

  const extension = relativePath.includes('.') ? relativePath.slice(relativePath.lastIndexOf('.') + 1).toLowerCase() : '';
  return {
    relativePath,
    extension,
    score,
    matchedLabelTokens,
    matchedPathTokens,
    anchorMatches,
  };
}

function isMultiFormatPresenceQuery(query: string): boolean {
  const formats = extractRequestedExplicitFormats(query);
  return formats.length >= 2 && /\b(?:both|copy|copies|version|versions|have)\b/i.test(query);
}

function isTopicTitleListQuery(query: string): boolean {
  return /\bname\s+three\s+books\b/i.test(query) && /\babout\b/i.test(query);
}

function toDisplayLabel(relativePath: string): string {
  const parts = relativePath.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || relativePath;
}

function normalizeWorkspaceRelativePath(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/');
  if (normalized === '.' || normalized === './' || normalized === '') {
    return '.';
  }
  let clean = normalized;
  if (clean.startsWith('./')) {
    clean = clean.slice(2);
  }
  if (clean.startsWith('/')) {
    clean = clean.slice(1);
  }
  // Reject path traversal — any ".." segment escapes the workspace root
  const segments = clean.split('/');
  if (segments.some(s => s === '..')) {
    return '.';
  }
  return clean;
}

/**
 * Extract the canvas page UUID from an editor input ID.
 * Handles two formats:
 *   - Prefixed: `parallx.canvas:canvas:<pageId>` → `<pageId>`
 *   - Bare UUID: `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` → as-is
 */
export function extractCanvasPageId(editorId: string | undefined): string | undefined {
  if (!editorId) { return undefined; }
  const parts = editorId.split(':');
  if (parts.length >= 3 && (parts[1] === 'canvas' || parts[1] === 'database')) {
    return parts.slice(2).join(':');
  }
  if (UUID_RE.test(editorId)) {
    return editorId;
  }
  return undefined;
}

/**
 * Extract a clean display label from a retrieval chunk's contextPrefix.
 *
 * Input formats produced by chunkingService.buildContextPrefix():
 *   - `[Source: "D:/AI/Parallx/demo-workspace/file.md" | Section: "Heading"]`
 *   - `[Source: "My Page Title" | Type: heading]`
 *   - `[Conversation Memory — Session abc12345]`
 *
 * Returns a short, human-friendly label (e.g. "file.md", "My Page Title",
 * "Session Memory").
 */
export function extractCitationLabel(chunk: { sourceType: string; sourceId: string; contextPrefix?: string }): string {
  const prefix = chunk.contextPrefix;

  // Conversation memory — always a fixed friendly label
  // sourceType is 'memory' (from MEMORY_SOURCE_TYPE in memoryService)
  if (chunk.sourceType === 'memory' || chunk.sourceType === 'conversation_memory') {
    return 'Session Memory';
  }

  // Memory contextPrefix: "[Conversation Memory — Session abc12345]"
  if (prefix && prefix.startsWith('[Conversation Memory')) {
    return 'Session Memory';
  }

  // Try to extract Source: "..." from the contextPrefix
  if (prefix) {
    const m = /Source:\s*"([^"]+)"/.exec(prefix);
    if (m) {
      const raw = m[1];
      // For file paths, extract just the filename
      if (chunk.sourceType === 'file' || chunk.sourceType === 'file_chunk' || raw.includes('/') || raw.includes('\\')) {
        const segments = raw.replace(/\\/g, '/').split('/');
        return segments[segments.length - 1] || raw;
      }
      // For pages the source is the page title — use as-is
      return raw;
    }
  }

  // Fallback: derive from sourceId
  if (chunk.sourceType === 'page' || chunk.sourceType === 'page_block') {
    return 'Page';
  }
  // sourceId for files is the file path
  const segments = chunk.sourceId.replace(/\\/g, '/').split('/');
  return segments[segments.length - 1] || 'File';
}

/**
 * Extract a plain text preview from a block's content_json column.
 * Walks Tiptap-style JSON nodes and concatenates text.
 */
export function extractBlockPreview(contentJson: string): string {
  try {
    const arr = JSON.parse(contentJson);
    if (!Array.isArray(arr)) { return ''; }
    const texts: string[] = [];
    for (const node of arr) {
      walkContentNode(node, texts);
    }
    return texts.join(' ').trim();
  } catch {
    return '';
  }
}

function formatCanonicalMemoryContext(items: Array<{ label: string; content: string }>): string | undefined {
  const cleanedItems = items
    .map((item) => ({
      label: item.label,
      content: item.content.replace(/\r\n/g, '\n').trim(),
    }))
    .filter((item) => item.content.length > 0);

  if (cleanedItems.length === 0) {
    return undefined;
  }

  const lines: string[] = ['[Conversation Memory]'];
  for (const item of cleanedItems) {
    lines.push('---');
    lines.push(item.label);
    lines.push(item.content);
  }
  return lines.join('\n');
}

function formatTranscriptRecallContext(items: Array<{ label: string; content: string }>): string | undefined {
  const cleaned = items
    .map((item) => ({
      label: item.label.trim(),
      content: item.content.trim(),
    }))
    .filter((item) => item.label && item.content);

  if (cleaned.length === 0) {
    return undefined;
  }

  return cleaned.map((item) => `${item.label}\n${item.content}`).join('\n\n');
}

function extractDailyDateLabel(path: string): string | undefined {
  const match = /\.parallx\/memory\/(\d{4}-\d{2}-\d{2})\.md$/i.exec(path);
  return match?.[1];
}

function walkContentNode(node: unknown, texts: string[]): void {
  if (!node || typeof node !== 'object') { return; }
  const n = node as Record<string, unknown>;
  if (n['type'] === 'text' && typeof n['text'] === 'string') {
    texts.push(n['text'] as string);
    return;
  }
  if (Array.isArray(n['content'])) {
    for (const child of n['content']) {
      walkContentNode(child, texts);
    }
  }
}

/**
 * Build an IBuiltInToolFileSystem from IFileService + IWorkspaceService.
 * Returns undefined only if the required services are missing.
 *
 * The accessor is LAZY — it does NOT check whether a folder is currently
 * open.  Instead, every operation dynamically reads workspaceService.folders
 * at call time.  This allows it to be created during tool activation (when
 * the workspace might be empty) and start working as soon as a folder is
 * opened later.
 */
export function buildFileSystemAccessor(
  fileService: IFileService | undefined,
  workspaceService: IWorkspaceService | undefined,
): IBuiltInToolFileSystem | undefined {
  if (!fileService || !workspaceService) { return undefined; }

  // ── Dynamic root resolution ──
  // Read workspaceService.folders on every call instead of capturing rootUri
  // once at activation time.  After a workspace switch the service's folder
  // list points to the NEW workspace, so every consumer of this accessor
  // (built-in tools, workspace digest, prompt-file reads, mention provider)
  // automatically resolves against the correct root without any explicit
  // rebuild step.

  function getRootUri(): import('../../../platform/uri.js').URI {
    const f = workspaceService!.folders;
    if (!f || f.length === 0) {
      throw new Error('No workspace root folder available');
    }
    return f[0].uri;
  }

  function getRootName(): string {
    return workspaceService!.activeWorkspace?.name
      ?? workspaceService!.folders[0]?.name
      ?? '';
  }

  function resolveUri(relativePath: string): import('../../../platform/uri.js').URI {
    const rootUri = getRootUri();
    const clean = normalizeWorkspaceRelativePath(relativePath);
    if (!clean || clean === '.') { return rootUri; }

    // Detect absolute paths — if the path starts with a drive letter (C:/) or
    // contains the workspace root path, strip the root prefix so we get a
    // genuine relative path.  Otherwise the path gets doubled:
    //   rootUri + "/AI/Parallx/demo-workspace/file.md"
    //   → D:/AI/Parallx/demo-workspace/AI/Parallx/demo-workspace/file.md
    const rootFsPath = rootUri.fsPath.replace(/\\/g, '/');
    const rootFsPathNoSlash = rootFsPath.replace(/\/$/, '');

    // Absolute path with drive letter (e.g. "D:/AI/Parallx/demo-workspace/file.md")
    if (/^[a-zA-Z]:/.test(clean)) {
      const norm = clean;
      if (norm.startsWith(rootFsPathNoSlash + '/') || norm.startsWith(rootFsPathNoSlash + '\\')) {
        const rel = norm.slice(rootFsPathNoSlash.length + 1);
        return rootUri.joinPath(rel);
      }
      // Absolute path outside workspace — use as-is via URI.file
      return { fsPath: clean, path: '/' + clean, scheme: 'file' } as any;
    }

    // Absolute-looking path without drive letter (e.g. "/AI/Parallx/demo-workspace/file.md")
    if (clean.startsWith('/')) {
      const stripped = clean.slice(1);
      // Check if it matches the root path (without drive letter)
      const rootNoDrive = rootFsPathNoSlash.replace(/^[a-zA-Z]:/, '').replace(/^\//, '');
      if (stripped.startsWith(rootNoDrive + '/')) {
        const rel = stripped.slice(rootNoDrive.length + 1);
        return rootUri.joinPath(rel);
      }
    }

    return rootUri.joinPath(clean);
  }

  return {
    get workspaceRootName() { return getRootName(); },

    async readdir(relativePath: string) {
      const uri = resolveUri(relativePath);
      const entries = await fileService.readdir(uri);
      return entries.map((e) => ({
        name: e.name,
        type: (e.type === 2 /* FileType.Directory */) ? 'directory' as const : 'file' as const,
        size: e.size,
      }));
    },

    async readFileContent(relativePath: string) {
      const uri = resolveUri(relativePath);
      const ext = relativePath.includes('.')
        ? relativePath.slice(relativePath.lastIndexOf('.')).toLowerCase()
        : '';
      const isRich = fileService.isRichDocument(ext);
      if (isRich) {
        const result = await fileService.readDocumentText(uri);
        return { content: result.text, type: 'rich-document' as const, totalChars: result.text.length };
      }
      const result = await fileService.readFile(uri);
      return { content: result.content, type: 'text' as const, totalChars: result.content.length };
    },

    async exists(relativePath: string) {
      const uri = resolveUri(relativePath);
      return fileService.exists(uri);
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// ChatDataService
// ═══════════════════════════════════════════════════════════════════════════════

export class ChatDataService {

  // ── Digest cache ──
  private _cachedDigest: string | undefined;
  private _cacheTimestamp = 0;
  private static readonly DIGEST_TTL_MS = 60_000;

  // ── Externally set state ──
  private _lastIndexStats: { pages: number; files: number } | undefined;
  private _lastTestDebugSnapshot: IChatTestDebugSnapshot = {
    ragSources: [],
    contextPills: [],
    isRAGAvailable: false,
    isIndexing: false,
  };

  constructor(private _d: ChatDataServiceDeps) {
    // M17 P1.3 Task 1.3.6: Fire-and-forget memory eviction + decay recalculation on startup
    if (this._d.memoryService) {
      this._d.memoryService.evictStaleContent().catch(() => {});
    }
  }

  /** Called by the indexing-complete listener in chatTool.ts. */
  setLastIndexStats(stats: { pages: number; files: number }): void {
    this._lastIndexStats = stats;
  }

  resetTestDebugSnapshot(): void {
    this._lastTestDebugSnapshot = {
      ragSources: [],
      contextPills: [],
      isRAGAvailable: this.isRAGAvailable(),
      isIndexing: this.isIndexing(),
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LLM Proxy Methods
  // ═══════════════════════════════════════════════════════════════════════════

  sendChatRequest(
    messages: readonly IChatMessage[],
    options?: IChatRequestOptions,
    signal?: AbortSignal,
  ): AsyncIterable<IChatResponseChunk> {
    const modelId = this._d.languageModelsService.getActiveModel() ?? '';
    return this._d.ollamaProvider.sendChatRequest(modelId, messages, options, signal);
  }

  getActiveModel(): string | undefined {
    return this._d.languageModelsService.getActiveModel();
  }

  getModelContextLength(): number {
    const modelId = this._d.languageModelsService.getActiveModel() ?? '';
    return (this._d.ollamaProvider as any).getCachedContextLength?.(modelId)
      ?? (this._d.ollamaProvider as any).getActiveModelContextLength?.()
      ?? 0;
  }

  sendSummarizationRequest(
    messages: readonly IChatMessage[],
    signal?: AbortSignal,
  ): AsyncIterable<IChatResponseChunk> {
    const modelId = this._d.languageModelsService.getActiveModel() ?? '';
    return this._d.ollamaProvider.sendChatRequest(modelId, messages, undefined, signal);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Workspace Context
  // ═══════════════════════════════════════════════════════════════════════════

  getWorkspaceName(): string {
    return this._d.workspaceService?.activeWorkspace?.name ?? 'Parallx Workspace';
  }

  async getPageCount(): Promise<number> {
    if (!this._d.databaseService?.isOpen) { return 0; }
    try {
      const row = await this._d.databaseService.get<{ cnt: number }>(
        'SELECT COUNT(*) as cnt FROM pages WHERE is_archived = 0',
      );
      return row?.cnt ?? 0;
    } catch { return 0; }
  }

  getCurrentPageTitle(): string | undefined {
    return this._d.editorService?.activeEditor?.name;
  }

  getToolDefinitions(): readonly IToolDefinition[] {
    return this._d.languageModelToolsService?.getToolDefinitions() ?? [];
  }

  getReadOnlyToolDefinitions(): readonly IToolDefinition[] {
    return this._d.languageModelToolsService?.getReadOnlyToolDefinitions() ?? [];
  }

  invokeTool(
    name: string,
    args: Record<string, unknown>,
    token: ICancellationToken,
  ): Promise<IToolResult> {
    if (!this._d.languageModelToolsService) {
      return Promise.resolve({ content: 'Tool service not available', isError: true });
    }
    return this._d.languageModelToolsService.invokeTool(name, args, token);
  }

  async invokeToolWithRuntimeControl(
    name: string,
    args: Record<string, unknown>,
    token: ICancellationToken,
    observer?: import('../chatTypes.js').IChatRuntimeToolInvocationObserver,
    sessionId?: string,
  ): Promise<IToolResult> {
    const toolsService = this._d.languageModelToolsService as (ILanguageModelToolsService & Partial<ILanguageModelToolsRuntimeControl>) | undefined;
    if (!toolsService?.invokeToolWithRuntimeControl) {
      return { content: 'Tool service not available', isError: true };
    }

    return toolsService.invokeToolWithRuntimeControl(name, args, token, observer, sessionId);
  }

  async getFileCount(): Promise<number> {
    if (!this._d.fsAccessor) { return 0; }
    try {
      const entries = await this._d.fsAccessor.readdir('.');
      return entries.length;
    } catch { return 0; }
  }

  isRAGAvailable(): boolean {
    return this._d.indexingPipelineService?.isInitialIndexComplete ?? false;
  }

  isIndexing(): boolean {
    return this._d.indexingPipelineService?.isIndexing ?? false;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Content Reading
  // ═══════════════════════════════════════════════════════════════════════════

  async readFileContent(fullPath: string): Promise<string> {
    // Canvas page attachments use parallx-page://<pageId> URIs
    if (fullPath.startsWith('parallx-page://') && this._d.databaseService?.isOpen) {
      const pageId = fullPath.slice('parallx-page://'.length);
      try {
        const row = await this._d.databaseService.get<{ title: string; content: string }>(
          'SELECT title, content FROM pages WHERE id = ?',
          [pageId],
        );
        if (!row) { return `[Error: Page not found "${pageId}"]`; }
        const text = extractTextContent(row.content);
        return text || '[Empty page]';
      } catch {
        return `[Error: Could not read page "${pageId}"]`;
      }
    }
    // Regular filesystem file
    if (!this._d.fileService) { return `[Error: File service not available]`; }
    try {
      const { URI } = await import('../../../platform/uri.js');
      const uri = URI.file(fullPath);
      const content = await this._d.fileService.readFile(uri);
      return content.content;
    } catch {
      return `[Error: Could not read file "${fullPath}"]`;
    }
  }

  async getCurrentPageContent(): Promise<{ title: string; pageId: string; textContent: string } | undefined> {
    const pageId = extractCanvasPageId(this._d.editorService?.activeEditor?.id);
    if (!pageId || !this._d.databaseService?.isOpen) { return undefined; }
    try {
      const row = await this._d.databaseService.get<{ id: string; title: string; content: string }>(
        'SELECT id, title, content FROM pages WHERE id = ?',
        [pageId],
      );
      if (!row) { return undefined; }
      const textContent = extractTextContent(row.content);
      return textContent ? { title: row.title, pageId: row.id, textContent } : undefined;
    } catch { return undefined; }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RAG Context Retrieval
  // ═══════════════════════════════════════════════════════════════════════════

  async retrieveContext(query: string, pathPrefixes?: string[]): Promise<{ text: string; sources: Array<{ uri: string; label: string; index: number }> } | undefined> {
    if (!this._d.retrievalService) {
      this._lastTestDebugSnapshot = {
        ...this._lastTestDebugSnapshot,
        query,
        ragSources: [],
        contextPills: this._lastTestDebugSnapshot.contextPills,
        isRAGAvailable: this.isRAGAvailable(),
        isIndexing: this.isIndexing(),
        retrievalError: undefined,
      };
      return undefined;
    }
    if (!this._d.indexingPipelineService?.isInitialIndexComplete) {
      this._lastTestDebugSnapshot = {
        ...this._lastTestDebugSnapshot,
        query,
        ragSources: [],
        contextPills: this._lastTestDebugSnapshot.contextPills,
        isRAGAvailable: this.isRAGAvailable(),
        isIndexing: this.isIndexing(),
        retrievalError: undefined,
      };
      return undefined;
    }

    const explicitSourceResolution = await this._getExplicitSourceContext(query);
    this._lastTestDebugSnapshot = {
      ...this._lastTestDebugSnapshot,
      explicitSourceDebug: explicitSourceResolution.debug,
    };

    if (explicitSourceResolution.result) {
      this._lastTestDebugSnapshot = {
        ...this._lastTestDebugSnapshot,
        query,
        retrievedContextText: explicitSourceResolution.result.text,
        ragSources: explicitSourceResolution.result.sources.map((source) => ({ ...source })),
        contextPills: this._lastTestDebugSnapshot.contextPills,
        retrievalTrace: undefined,
        isRAGAvailable: this.isRAGAvailable(),
        isIndexing: this.isIndexing(),
        retrievalError: undefined,
      };
      return explicitSourceResolution.result;
    }

    try {
      const chunks = await this._d.retrievalService.retrieve(query, pathPrefixes?.length ? { pathPrefixes } : undefined);
      const retrievalTrace = this._d.retrievalService.getLastTrace?.();
      if (chunks.length === 0) {
        this._lastTestDebugSnapshot = {
          ...this._lastTestDebugSnapshot,
          query,
          ragSources: [],
          contextPills: this._lastTestDebugSnapshot.contextPills,
          retrievalTrace,
          isRAGAvailable: this.isRAGAvailable(),
          isIndexing: this.isIndexing(),
          retrievalError: undefined,
        };
        return undefined;
      }
      const text = this._d.retrievalService.formatContext(chunks);
      const sources = this._buildSourceCitations(chunks);
      this._lastTestDebugSnapshot = {
        ...this._lastTestDebugSnapshot,
        query,
        retrievedContextText: text,
        ragSources: sources.map((source) => ({ ...source })),
        contextPills: this._lastTestDebugSnapshot.contextPills,
        retrievalTrace,
        isRAGAvailable: this.isRAGAvailable(),
        isIndexing: this.isIndexing(),
        retrievalError: undefined,
      };
      return { text, sources };
    } catch (error) {
      this._lastTestDebugSnapshot = {
        ...this._lastTestDebugSnapshot,
        query,
        ragSources: [],
        contextPills: this._lastTestDebugSnapshot.contextPills,
        isRAGAvailable: this.isRAGAvailable(),
        isIndexing: this.isIndexing(),
        retrievalError: error instanceof Error ? error.message : String(error),
      };
      return undefined;
    }
  }

  private async _getExplicitSourceContext(
    query: string,
  ): Promise<{
    result?: { text: string; sources: Array<{ uri: string; label: string; index: number }> };
    debug: {
      attempted: boolean;
      matchedPath?: string;
      readSucceeded: boolean;
      reason?: string;
    };
  }> {
    if (!this._d.fsAccessor || !shouldUseExplicitSourceFallback(query)) {
      return { debug: { attempted: false, readSucceeded: false, reason: 'query-not-eligible' } };
    }

    if (isTopicTitleListQuery(query)) {
      const matchedPaths = await this._findTopicTitlePaths(query, 3);
      if (matchedPaths.length > 0) {
        const sources = matchedPaths.map((relativePath, index) => ({
          uri: relativePath,
          label: toDisplayLabel(relativePath),
          index: index + 1,
        }));

        return {
          result: {
            text: [
              '[Retrieved Context]',
              ...matchedPaths.flatMap((relativePath, index) => [
                '---',
                `[${index + 1}] Source: [Source: "${relativePath}"]`,
                `Path: ${relativePath}`,
                'Title matched the topic requested by the user.',
              ]),
              '---',
            ].join('\n'),
            sources,
          },
          debug: {
            attempted: true,
            matchedPath: matchedPaths.join('; '),
            readSucceeded: true,
          },
        };
      }
    }

    if (isMultiFormatPresenceQuery(query)) {
      const matchedPaths = await this._findExplicitSourcePaths(query, extractRequestedExplicitFormats(query));
      if (matchedPaths.length === 0) {
        return { debug: { attempted: true, readSucceeded: false, reason: 'no-matching-path' } };
      }

      const sources = matchedPaths.map((relativePath, index) => ({
        uri: relativePath,
        label: toDisplayLabel(relativePath),
        index: index + 1,
      }));

      return {
        result: {
          text: [
            '[Retrieved Context]',
            ...matchedPaths.flatMap((relativePath, index) => {
              const ext = relativePath.includes('.') ? relativePath.slice(relativePath.lastIndexOf('.') + 1).toUpperCase() : 'FILE';
              return [
                '---',
                `[${index + 1}] Source: [Source: "${relativePath}"]`,
                `Path: ${relativePath}`,
                `Format: ${ext}`,
                'File is present in the workspace.',
              ];
            }),
            '---',
          ].join('\n'),
          sources,
        },
        debug: {
          attempted: true,
          matchedPath: matchedPaths.join('; '),
          readSucceeded: true,
        },
      };
    }

    const relativePath = await this._findExplicitSourcePath(query);
    if (!relativePath) {
      return { debug: { attempted: true, readSucceeded: false, reason: 'no-matching-path' } };
    }

    let content = '';
    try {
      const result = await this._d.fsAccessor.readFileContent(relativePath);
      content = result.content;
    } catch {
      return { debug: { attempted: true, matchedPath: relativePath, readSucceeded: false, reason: 'read-failed' } };
    }

    const trimmedContent = content.trim();
    if (!trimmedContent) {
      return { debug: { attempted: true, matchedPath: relativePath, readSucceeded: false, reason: 'empty-content' } };
    }

    const excerpt = trimmedContent.length > MAX_EXPLICIT_SOURCE_CONTEXT_CHARS
      ? `${trimmedContent.slice(0, MAX_EXPLICIT_SOURCE_CONTEXT_CHARS)}\n[…truncated explicit source read]`
      : trimmedContent;
    const label = toDisplayLabel(relativePath);

    return {
      result: {
        text: [
          '[Retrieved Context]',
          '---',
          `[1] Source: [Source: "${relativePath}"]`,
          `Path: ${relativePath}`,
          excerpt,
          '---',
        ].join('\n'),
        sources: [{ uri: relativePath, label, index: 1 }],
      },
      debug: {
        attempted: true,
        matchedPath: relativePath,
        readSucceeded: true,
      },
    };
  }

  private async _findExplicitSourcePath(query: string): Promise<string | undefined> {
    const matches = await this._findExplicitSourcePaths(query);
    return matches[0];
  }

  private async _findExplicitSourcePaths(
    query: string,
    requiredFormats: readonly ExplicitSourceFormat[] = [],
    maxResults: number = 1,
  ): Promise<string[]> {
    if (!this._d.fsAccessor) {
      return [];
    }

    const queryTokens = tokenizeExplicitSourceText(query);
    if (queryTokens.length < 2) {
      return [];
    }

    const filePaths: string[] = [];
    await this._collectWorkspaceFilePaths('.', 0, filePaths);

    const scored = filePaths
      .map((relativePath) => scoreExplicitSourceCandidate(query, relativePath))
      .filter((candidate) => {
        const matchedTokenCount = Math.max(candidate.matchedLabelTokens.length, candidate.matchedPathTokens.length);
        return candidate.score >= 2 && (matchedTokenCount >= 2 || candidate.anchorMatches.length > 0);
      })
      .sort((a, b) => b.score - a.score || a.relativePath.localeCompare(b.relativePath));

    if (scored.length === 0) {
      return [];
    }

    if (requiredFormats.length === 0) {
      return scored.slice(0, Math.max(1, maxResults)).map((candidate) => candidate.relativePath);
    }

    const selected: string[] = [];
    for (const format of requiredFormats) {
      const match = scored.find((candidate) => candidate.extension === format && !selected.includes(candidate.relativePath));
      if (match) {
        selected.push(match.relativePath);
      }
    }

    return selected;
  }

  private async _findTopicTitlePaths(query: string, maxResults: number): Promise<string[]> {
    if (!this._d.fsAccessor) {
      return [];
    }

    const queryTokens = tokenizeExplicitSourceText(query);
    if (queryTokens.length === 0) {
      return [];
    }

    const filePaths: string[] = [];
    await this._collectWorkspaceFilePaths('.', 0, filePaths);

    return filePaths
      .map((relativePath) => {
        const label = toDisplayLabel(relativePath);
        const labelTokens = tokenizeExplicitSourceText(label);
        const matchedTokens = labelTokens.filter((token) => queryTokens.includes(token));
        const score = matchedTokens.length;
        return { relativePath, score };
      })
      .filter((candidate) => candidate.score > 0)
      .sort((a, b) => b.score - a.score || a.relativePath.localeCompare(b.relativePath))
      .slice(0, Math.max(1, maxResults))
      .map((candidate) => candidate.relativePath);
  }

  private async _collectWorkspaceFilePaths(relativePath: string, depth: number, results: string[]): Promise<void> {
    if (!this._d.fsAccessor || depth > MAX_EXPLICIT_SOURCE_SCAN_DEPTH || results.length >= MAX_EXPLICIT_SOURCE_SCAN_FILES) {
      return;
    }

    let entries: readonly { name: string; type: 'file' | 'directory'; size: number }[] = [];
    try {
      entries = await this._d.fsAccessor.readdir(relativePath === '.' ? '' : relativePath);
    } catch {
      return;
    }

    for (const entry of entries) {
      if (results.length >= MAX_EXPLICIT_SOURCE_SCAN_FILES) {
        break;
      }

      const childPath = relativePath === '.' || relativePath === ''
        ? entry.name
        : `${relativePath}/${entry.name}`;

      if (entry.type === 'file') {
        results.push(childPath);
        continue;
      }

      if (entry.type === 'directory' && !['.git', '.parallx', 'node_modules', 'dist', 'out'].includes(entry.name)) {
        await this._collectWorkspaceFilePaths(childPath, depth + 1, results);
      }
    }
  }

  /** Build deduplicated source citations from retrieval chunks. */
  private _buildSourceCitations(chunks: readonly { sourceType: string; sourceId: string; contextPrefix?: string }[]): Array<{ uri: string; label: string; index: number }> {
    const seen = new Set<string>();
    const sources: Array<{ uri: string; label: string; index: number }> = [];
    let nextIndex = 1;
    for (const chunk of chunks) {
      const key = `${chunk.sourceType}:${chunk.sourceId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const isPage = chunk.sourceType === 'page' || chunk.sourceType === 'page_block';
      const isMemory = chunk.sourceType === 'memory' || chunk.sourceType === 'conversation_memory';
      const uri = isPage
        ? `parallx-page://${chunk.sourceId}`
        : isMemory
          ? `parallx-memory://${chunk.sourceId}`
          : chunk.sourceId;
      const label = extractCitationLabel(chunk);
      sources.push({ uri, label, index: nextIndex++ });
    }
    return sources;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Memory & Preferences
  // ═══════════════════════════════════════════════════════════════════════════

  async recallMemories(query: string, _sessionId?: string): Promise<string | undefined> {
    try {
      const recallScope = resolveMemoryRecallScope(query);
      const aggregatedItems: Array<{ label: string; content: string }> = [];

      if (this._d.canonicalMemorySearchService) {
        const memoryResults = await this._d.canonicalMemorySearchService.search(query, {
          layer: recallScope.layer,
          date: recallScope.date,
        });
        if (memoryResults.length > 0) {
          aggregatedItems.push(...memoryResults.slice(0, 3).map((result) => ({
              label: result.layer === 'durable'
                ? 'Durable memory:'
                : `Daily memory (${extractDailyDateLabel(result.sourceId) ?? result.sourceId}):`,
              content: result.text,
            })));
        }
      }

      if (this._d.fsAccessor) {
        try {
          const directItems: Array<{ label: string; content: string }> = [];

          const durablePath = this._d.workspaceMemoryService?.getDurableMemoryRelativePath() ?? '.parallx/memory/MEMORY.md';
          const shouldLoadDurable = recallScope.layer === 'durable' || recallScope.layer === 'all';
          const durableExists = shouldLoadDurable
            ? await this._d.fsAccessor.exists(durablePath).catch(() => false)
            : false;
          if (durableExists) {
            const durableResult = await this._d.fsAccessor.readFileContent(durablePath);
            const durableContent = durableResult.content;
            if (durableContent.trim() && !aggregatedItems.some((item) => item.label === 'Durable memory:')) {
              directItems.push({
                label: 'Durable memory:',
                content: durableContent,
              });
            }
          }

          const shouldLoadDaily = recallScope.layer === 'daily' || recallScope.layer === 'all';
          if (shouldLoadDaily) {
            const requestedDailyPath = recallScope.date ? `.parallx/memory/${recallScope.date}.md` : undefined;
            if (requestedDailyPath) {
              const requestedDailyExists = await this._d.fsAccessor.exists(requestedDailyPath).catch(() => false);
              if (requestedDailyExists) {
                const dailyResult = await this._d.fsAccessor.readFileContent(requestedDailyPath);
                const dailyContent = dailyResult.content;
                const dailyLabel = `Daily memory (${recallScope.date}):`;
                if (dailyContent.trim() && !aggregatedItems.some((item) => item.label === dailyLabel)) {
                  directItems.push({
                    label: dailyLabel,
                    content: dailyContent,
                  });
                }
              }
            } else {
              const memoryEntries = await this._d.fsAccessor.readdir('.parallx/memory');
              const recentDailyFiles = memoryEntries
                .filter((entry) => entry.type === 'file' && /^\d{4}-\d{2}-\d{2}\.md$/i.test(entry.name))
                .sort((a, b) => b.name.localeCompare(a.name))
                .slice(0, 3);
              for (const dailyEntry of recentDailyFiles) {
                const dailyResult = await this._d.fsAccessor.readFileContent(`.parallx/memory/${dailyEntry.name}`);
                const dailyContent = dailyResult.content;
                const dailyLabel = `Daily memory (${dailyEntry.name.replace(/\.md$/i, '')}):`;
                if (dailyContent.trim() && !aggregatedItems.some((item) => item.label === dailyLabel)) {
                  directItems.push({
                    label: dailyLabel,
                    content: dailyContent,
                  });
                }
              }
            }
          }

          aggregatedItems.push(...directItems);
          const formatted = formatCanonicalMemoryContext(aggregatedItems);
            if (formatted) {
              return formatted;
            }
        } catch {
          // best-effort fallback only
        }
      }

      if (this._d.workspaceMemoryService || !this._d.memoryService) {
        return undefined;
      }

      let memories = await this._d.memoryService.recallMemories(query);
      if (memories.length === 0 && recallScope.asksForPriorConversationRecall) {
        memories = (await this._d.memoryService.getAllMemories()).slice(0, 1);
      }
      if (memories.length > 0) {
        return this._d.memoryService.formatMemoryContext(memories);
      }

      return undefined;
    } catch { return undefined; }
  }

  async recallTranscripts(query: string): Promise<string | undefined> {
    try {
      if (this._d.unifiedConfigService?.getEffectiveConfig().memory.transcriptIndexingEnabled !== true) {
        return undefined;
      }

      if (!this._d.fsAccessor) {
        return undefined;
      }

      return formatTranscriptRecallContext(
        (await searchWorkspaceTranscripts(this._d.fsAccessor, query, { topK: 3 })).map((result) => ({
          label: `Transcript (${result.sessionId}):`,
          content: result.text,
        })),
      );
    } catch {
      return undefined;
    }
  }

  async storeSessionMemory(sessionId: string, summary: string, messageCount: number): Promise<void> {
    if (this._d.workspaceMemoryService) {
      try {
        await this._d.workspaceMemoryService.appendSessionSummary(sessionId, summary, messageCount);
        return;
      } catch {
        // best-effort canonical write-back
      }
    }
    if (!this._d.memoryService) { return; }
    try { await this._d.memoryService.storeMemory(sessionId, summary, messageCount); } catch { /* best-effort */ }
  }

  /**
   * Store learning concepts extracted from a session (M17 P1.2 Task 1.2.8).
   */
  async storeConceptsFromSession(
    concepts: Array<{ concept: string; category: string; summary: string; struggled: boolean }>,
    sessionId: string,
  ): Promise<void> {
    if (this._d.workspaceMemoryService) {
      try {
        await this._d.workspaceMemoryService.upsertConcepts(concepts.map((c) => ({
          concept: c.concept,
          category: c.category,
          summary: c.summary,
          encounterCount: 1,
          masteryLevel: c.struggled ? 0 : 0.1,
          struggleCount: c.struggled ? 1 : 0,
        })));
        return;
      } catch {
        // fall through to legacy fallback only if canonical upsert fails
      }
    }

    if (!this._d.memoryService) { return; }
    try {
      const mapped = concepts.map((c) => ({
        concept: c.concept,
        category: c.category,
        summary: c.summary,
        masteryLevel: 0,
        encounterCount: 1,
        struggleCount: c.struggled ? 1 : 0,
        firstSeen: '',
        lastSeen: '',
        lastAccessed: '',
        sourceSessions: '[]',
        decayScore: 1.0,
      }));
      await this._d.memoryService.storeConcepts(mapped, sessionId);
    } catch { /* best-effort */ }
  }

  /**
   * Recall learning concepts relevant to a query (M17 P1.2 Task 1.2.8).
   * Returns formatted context string or undefined.
   */
  async recallConcepts(query: string): Promise<string | undefined> {
    if (this._d.workspaceMemoryService) {
      try {
        const concepts = await this._d.workspaceMemoryService.searchConcepts(query);
        if (!concepts.length) { return undefined; }
        const now = new Date().toISOString();
        const formatted = formatConceptContextBlock(concepts.map((concept, index) => ({
          id: index + 1,
          concept: concept.concept,
          category: concept.category,
          summary: concept.summary,
          masteryLevel: concept.masteryLevel,
          encounterCount: concept.encounterCount,
          struggleCount: concept.struggleCount,
          firstSeen: now,
          lastSeen: now,
          lastAccessed: now,
          sourceSessions: '[]',
          decayScore: 1,
        })));
        return formatted || undefined;
      } catch {
        // fall through to legacy fallback only if canonical search fails
      }
    }

    if (!this._d.memoryService) { return undefined; }
    try {
      const concepts = await this._d.memoryService.recallConcepts(query);
      if (!concepts.length) { return undefined; }
      const formatted = this._d.memoryService.formatConceptContext(concepts);
      return formatted || undefined;
    } catch { return undefined; }
  }

  isSessionEligibleForSummary(messageCount: number): boolean {
    return this._d.memoryService?.isSessionEligibleForSummary(messageCount) ?? false;
  }

  async hasSessionMemory(sessionId: string): Promise<boolean> {
    if (this._d.workspaceMemoryService) {
      try { return await this._d.workspaceMemoryService.hasSessionSummary(sessionId); } catch { return false; }
    }
    if (!this._d.memoryService) { return false; }
    try { return await this._d.memoryService.hasMemory(sessionId); } catch { return false; }
  }

  /**
   * Get the message count stored with the last summary for a session.
   * Returns `null` if no memory exists (M17 Task 1.1.3).
   */
  async getSessionMemoryMessageCount(sessionId: string): Promise<number | null> {
    if (this._d.workspaceMemoryService) {
      try { return await this._d.workspaceMemoryService.getSessionSummaryMessageCount(sessionId); } catch { return null; }
    }
    if (!this._d.memoryService) { return null; }
    try { return await this._d.memoryService.getMemoryMessageCount(sessionId); } catch { return null; }
  }

  async extractPreferences(text: string): Promise<void> {
    if (this._d.workspaceMemoryService) {
      try {
        const extracted = detectPreferences(text);
        if (extracted.length > 0) {
          await this._d.workspaceMemoryService.upsertPreferences(extracted);
        }
        return;
      } catch {
        // fall through to legacy fallback only if canonical upsert fails
      }
    }

    if (!this._d.memoryService) { return; }
    try {
      await this._d.memoryService.extractAndStorePreferences(text);
    } catch { /* best-effort */ }
  }

  async getPreferencesForPrompt(): Promise<string | undefined> {
    try {
      if (this._d.workspaceMemoryService) {
        const promptBlock = await this._d.workspaceMemoryService.getPreferencesPromptBlock();
        return promptBlock;
      }

      if (!this._d.memoryService) { return undefined; }
      const prefs = await this._d.memoryService.getPreferences();
      if (prefs.length === 0) { return undefined; }
      return this._d.memoryService.formatPreferencesForPrompt(prefs);
    } catch { return undefined; }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Prompt File Overlay
  // ═══════════════════════════════════════════════════════════════════════════

  async getPromptOverlay(_activeFilePath?: string): Promise<string | undefined> {
    if (!this._d.promptFileService) { return undefined; }
    try {
      let activeRelPath = _activeFilePath;
      if (!activeRelPath && this._d.editorService?.activeEditor) {
        const ed = this._d.editorService.activeEditor;
        if (ed.description && !ed.id.includes('canvas:') && !ed.id.includes('database:')) {
          const rootPath = this._d.workspaceService?.folders?.[0]?.uri?.fsPath;
          if (rootPath && ed.description.startsWith(rootPath)) {
            activeRelPath = ed.description.slice(rootPath.length).replace(/^[\\/]/, '').replace(/\\/g, '/');
          }
        }
      }
      const layers = await this._d.promptFileService.loadLayers();
      const overlay = this._d.promptFileService.assemblePromptOverlay(layers, activeRelPath);
      return overlay || undefined;
    } catch { return undefined; }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // File System Operations
  // ═══════════════════════════════════════════════════════════════════════════

  async listFilesRelative(relativePath: string): Promise<{ name: string; type: 'file' | 'directory' }[]> {
    if (!this._d.fsAccessor) { return []; }
    const entries = await this._d.fsAccessor.readdir(relativePath);
    return entries.map(e => ({ name: e.name, type: e.type }));
  }

  async readFileRelative(relativePath: string): Promise<string | null> {
    if (!this._d.fsAccessor) { return null; }
    try {
      const result = await this._d.fsAccessor.readFileContent(relativePath);
      return result.content;
    } catch { return null; }
  }

  async writeFileRelative(relativePath: string, content: string): Promise<void> {
    if (!this._d.fileService || !this._d.workspaceService?.folders?.length) { return; }
    const rootUri = this._d.workspaceService.folders[0].uri;
    const clean = normalizeWorkspaceRelativePath(relativePath);
    const targetUri = rootUri.joinPath(clean);

    // Ensure parent directory exists
    const parentPath = clean.includes('/') ? clean.slice(0, clean.lastIndexOf('/')) : '';
    if (parentPath) {
      const parentUri = rootUri.joinPath(parentPath);
      try { await this._d.fileService.mkdir(parentUri); } catch { /* may already exist */ }
    }
    await this._d.fileService.writeFile(targetUri, content);
  }

  async existsRelative(relativePath: string): Promise<boolean> {
    if (!this._d.fsAccessor) { return false; }
    try { return await this._d.fsAccessor.exists(relativePath); } catch { return false; }
  }

  invalidatePromptFiles(): void {
    this._d.promptFileService?.invalidate();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UI Bridges (delegate to active widget)
  // ═══════════════════════════════════════════════════════════════════════════

  reportContextPills(pills: readonly IContextPill[]): void {
    this._lastTestDebugSnapshot = {
      ...this._lastTestDebugSnapshot,
      contextPills: pills.map((pill) => ({
        id: pill.id,
        label: pill.label,
        type: pill.type,
        removable: pill.removable,
        index: pill.index,
        tokens: pill.tokens,
      })),
    };
    const widget = this._d.getActiveWidget();
    if (widget) {
      widget.setContextPills(pills);
    }
  }

  reportRetrievalDebug(debug: {
    hasActiveSlashCommand: boolean;
    isRagReady: boolean;
    needsRetrieval: boolean;
    attempted: boolean;
    returnedSources?: number;
  }): void {
    this._lastTestDebugSnapshot = {
      ...this._lastTestDebugSnapshot,
      retrievalGate: { ...debug },
      isRAGAvailable: this.isRAGAvailable(),
      isIndexing: this.isIndexing(),
    };
  }

  reportResponseDebug(debug: {
    phase: string;
    markdownLength: number;
    yielded: boolean;
    cancelled: boolean;
    retrievedContextLength: number;
    note?: string;
  }): void {
    this._lastTestDebugSnapshot = {
      ...this._lastTestDebugSnapshot,
      responseDebug: { ...debug },
      isRAGAvailable: this.isRAGAvailable(),
      isIndexing: this.isIndexing(),
    };
  }

  reportParticipantDebug(debug: {
    surface: 'workspace' | 'canvas';
    usedSharedTurnState: boolean;
    attachmentCount: number;
    fileAttachmentCount: number;
    imageAttachmentCount: number;
    queryScopeLevel?: string;
  }): void {
    this._lastTestDebugSnapshot = {
      ...this._lastTestDebugSnapshot,
      participantDebug: { ...debug },
      isRAGAvailable: this.isRAGAvailable(),
      isIndexing: this.isIndexing(),
    };
  }

  reportRuntimeTrace(trace: IChatRuntimeTrace): void {
    const previousTrace = this._lastTestDebugSnapshot.runtimeTrace;
    this._lastTestDebugSnapshot = {
      ...this._lastTestDebugSnapshot,
      runtimeTrace: structuredClone({
        ...previousTrace,
        ...trace,
        route: trace.route ?? previousTrace?.route,
        contextPlan: trace.contextPlan ?? previousTrace?.contextPlan,
        queryScope: trace.queryScope ?? previousTrace?.queryScope,
      }),
      isRAGAvailable: this.isRAGAvailable(),
      isIndexing: this.isIndexing(),
    };
  }

  reportBootstrapDebug(debug: IOpenclawBootstrapDebugReport): void {
    this._lastTestDebugSnapshot = {
      ...this._lastTestDebugSnapshot,
      bootstrapContext: structuredClone(debug),
      isRAGAvailable: this.isRAGAvailable(),
      isIndexing: this.isIndexing(),
    };
  }

  reportSystemPromptReport(report: IOpenclawSystemPromptReport): void {
    this._lastTestDebugSnapshot = {
      ...this._lastTestDebugSnapshot,
      systemPromptReport: structuredClone(report),
      isRAGAvailable: this.isRAGAvailable(),
      isIndexing: this.isIndexing(),
    };
  }

  getLastSystemPromptReport(): IOpenclawSystemPromptReport | undefined {
    return this._lastTestDebugSnapshot.systemPromptReport
      ? structuredClone(this._lastTestDebugSnapshot.systemPromptReport)
      : undefined;
  }

  getTestDebugSnapshot(): IChatTestDebugSnapshot {
    const session = this._d.getActiveWidget()?.getSession();
    const assistantMessages = session?.messages.filter((pair) => pair.response) ?? [];
    const lastAssistantResponse = assistantMessages.length > 0
      ? assistantMessages[assistantMessages.length - 1].response
      : undefined;

    return {
      ...structuredClone(this._lastTestDebugSnapshot),
      isRAGAvailable: this.isRAGAvailable(),
      isIndexing: this.isIndexing(),
      indexingProgress: this._d.indexingPipelineService?.progress
        ? { ...this._d.indexingPipelineService.progress }
        : { phase: 'idle', processed: 0, total: 0 },
      indexStats: this._lastIndexStats,
      requestInProgress: session?.requestInProgress ?? false,
      pendingRequestCount: session?.pendingRequests.length ?? 0,
      assistantMessageCount: assistantMessages.length,
      lastAssistantResponseText: lastAssistantResponse ? this._extractAssistantResponseText(lastAssistantResponse.parts) : '',
      lastAssistantResponseComplete: lastAssistantResponse?.isComplete ?? false,
      lastAssistantPartKinds: lastAssistantResponse?.parts.map((part) => part.kind) ?? [],
      lastAssistantPartSummary: lastAssistantResponse?.parts.map((part) => ({
        kind: part.kind,
        preview: this._summarizeAssistantPart(part),
      })) ?? [],
    };
  }

  private _extractAssistantResponseText(parts: ReadonlyArray<{ kind: string; content?: string; code?: string }>): string {
    return parts
      .filter((part) => part.kind === ChatContentPartKind.Markdown && typeof part.content === 'string')
      .map((part) => part.content ?? '')
      .join('')
      .trim();
  }

  private _summarizeAssistantPart(part: { kind: string; content?: string; code?: string; message?: string }): string {
    if (typeof part.content === 'string' && part.content.trim().length > 0) {
      return part.content.trim().slice(0, 160);
    }
    if (typeof part.message === 'string' && part.message.trim().length > 0) {
      return part.message.trim().slice(0, 160);
    }
    if (typeof part.code === 'string' && part.code.trim().length > 0) {
      return part.code.trim().slice(0, 160);
    }
    return '';
  }

  getExcludedContextIds(): ReadonlySet<string> {
    return this._d.getActiveWidget()?.getExcludedContextIds() ?? new Set();
  }

  reportBudget(slots: ReadonlyArray<{ label: string; used: number; allocated: number; color: string }>): void {
    const widget = this._d.getActiveWidget();
    if (widget) {
      widget.setBudget(slots);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Terminal & Folder Operations
  // ═══════════════════════════════════════════════════════════════════════════

  async getTerminalOutput(): Promise<string | undefined> {
    const electron = (globalThis as Record<string, unknown>).parallxElectron as Record<string, unknown> | undefined;
    const terminal = electron?.terminal as { getOutput?: (lineCount?: number) => Promise<{ output: string; lineCount: number }> } | undefined;
    if (!terminal?.getOutput) { return undefined; }
    try {
      const result = await terminal.getOutput(100);
      return result.output || undefined;
    } catch { return undefined; }
  }

  async listFolderFiles(folderPath: string): Promise<Array<{ relativePath: string; content: string }>> {
    if (!this._d.fsAccessor) { return []; }
    const results: Array<{ relativePath: string; content: string }> = [];
    const MAX_FILES = 50;
    const MAX_FILE_SIZE = 10_000; // chars
    try {
      const entries = await this._d.fsAccessor.readdir(folderPath);
      for (const entry of entries) {
        if (results.length >= MAX_FILES) break;
        if (entry.type === 'file') {
          const relPath = folderPath ? `${folderPath}/${entry.name}` : entry.name;
          try {
            const result = await this._d.fsAccessor.readFileContent(relPath);
            const content = result.content;
            results.push({
              relativePath: relPath,
              content: content.length > MAX_FILE_SIZE ? content.slice(0, MAX_FILE_SIZE) + '\n… (truncated)' : content,
            });
          } catch { /* skip unreadable files */ }
        }
      }
    } catch { /* folder may not exist or be unreadable */ }
    return results;
  }

  /**
   * M38: Recursive enumeration returning structured file metadata.
   * Walks subdirectories up to `maxDepth` (default 3) and returns file
   * entries with their relative path and extension — no content reading.
   */
  async listFolderFilesStructured(
    folderPath: string,
    options?: { recursive?: boolean; maxDepth?: number },
  ): Promise<Array<{ relativePath: string; ext: string }>> {
    if (!this._d.fsAccessor) { return []; }
    const MAX_ENTRIES = 200;
    const maxDepth = options?.recursive !== false ? (options?.maxDepth ?? 3) : 0;
    const results: Array<{ relativePath: string; ext: string }> = [];

    const walk = async (dir: string, depth: number): Promise<void> => {
      if (results.length >= MAX_ENTRIES) return;
      try {
        const entries = await this._d.fsAccessor!.readdir(dir);
        for (const entry of entries) {
          if (results.length >= MAX_ENTRIES) return;
          const relPath = dir ? `${dir}/${entry.name}` : entry.name;
          if (entry.type === 'file') {
            const dotIndex = entry.name.lastIndexOf('.');
            const ext = dotIndex >= 0 ? entry.name.slice(dotIndex).toLowerCase() : '';
            results.push({ relativePath: relPath, ext });
          } else if (entry.type === 'directory' && depth < maxDepth) {
            await walk(relPath, depth + 1);
          }
        }
      } catch { /* skip unreadable directories */ }
    };

    await walk(folderPath, 0);
    return results;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // User Command FS & Session Compaction
  // ═══════════════════════════════════════════════════════════════════════════

  getUserCommandFileSystem(): { listCommandFiles(): Promise<string[]>; readCommandFile(relativePath: string): Promise<string> } | undefined {
    if (!this._d.fsAccessor) { return undefined; }
    const fsAccessor = this._d.fsAccessor;
    return {
      async listCommandFiles() {
        try {
          const entries = await fsAccessor.readdir('.parallx/commands');
          return entries
            .filter(e => e.type === 'file' && e.name.endsWith('.md'))
            .map(e => `.parallx/commands/${e.name}`);
        } catch { return []; }
      },
      async readCommandFile(relativePath: string) {
        const result = await fsAccessor.readFileContent(relativePath);
        return result.content;
      },
    };
  }

  compactSession(sessionId: string, summaryText: string): void {
    const session = this._d.chatService.getSession(sessionId);
    if (!session) return;
    const messages = session.messages as IChatRequestResponsePair[];
    messages.splice(0, messages.length, {
      request: {
        text: '[Compacted conversation history]',
        requestId: 'compacted-history',
        attempt: 0,
        timestamp: Date.now(),
      },
      response: {
        parts: [{ kind: ChatContentPartKind.Markdown, content: summaryText }],
        isComplete: true,
      },
    } as IChatRequestResponsePair);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Workspace & Canvas Participant Data
  // ═══════════════════════════════════════════════════════════════════════════

  async listPages(): Promise<readonly IPageSummary[]> {
    if (!this._d.databaseService?.isOpen) { return []; }
    try {
      return await this._d.databaseService.all<IPageSummary>(
        'SELECT id, title, icon FROM pages WHERE is_archived = 0 ORDER BY updated_at DESC LIMIT ?',
        [100],
      );
    } catch { return []; }
  }

  async searchPages(query: string): Promise<readonly IPageSummary[]> {
    if (!this._d.databaseService?.isOpen) { return []; }
    try {
      return await this._d.databaseService.all<IPageSummary>(
        'SELECT id, title, icon FROM pages WHERE is_archived = 0 AND title LIKE ? ORDER BY updated_at DESC LIMIT ?',
        [`%${query}%`, 20],
      );
    } catch { return []; }
  }

  async getPageContent(pageId: string): Promise<string | null> {
    if (!this._d.databaseService?.isOpen) { return null; }
    try {
      const row = await this._d.databaseService.get<{ content: string }>(
        'SELECT content FROM pages WHERE id = ?', [pageId],
      );
      return row?.content ?? null;
    } catch { return null; }
  }

  async getPageTitle(pageId: string): Promise<string | null> {
    if (!this._d.databaseService?.isOpen) { return null; }
    try {
      const row = await this._d.databaseService.get<{ title: string }>(
        'SELECT title FROM pages WHERE id = ?', [pageId],
      );
      return row?.title ?? null;
    } catch { return null; }
  }

  getCurrentPageId(): string | undefined {
    return extractCanvasPageId(this._d.editorService?.activeEditor?.id);
  }

  async getPageStructure(pageId: string): Promise<IPageStructure | null> {
    if (!this._d.databaseService?.isOpen) { return null; }
    try {
      const page = await this._d.databaseService.get<{ id: string; title: string; icon?: string }>(
        'SELECT id, title, icon FROM pages WHERE id = ?', [pageId],
      );
      if (!page) { return null; }

      const blocks = await this._d.databaseService.all<{
        id: string;
        block_type: string;
        parent_block_id: string | null;
        sort_order: number;
        content_json: string;
      }>(
        'SELECT id, block_type, parent_block_id, sort_order, content_json FROM canvas_blocks WHERE page_id = ? ORDER BY sort_order',
        [pageId],
      );

      const blockSummaries: IBlockSummary[] = blocks.map((b) => ({
        id: b.id,
        blockType: b.block_type,
        parentBlockId: b.parent_block_id,
        sortOrder: b.sort_order,
        textPreview: extractBlockPreview(b.content_json),
      }));

      return {
        pageId: page.id,
        title: page.title,
        icon: page.icon,
        blocks: blockSummaries,
      };
    } catch { return null; }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Widget Data Methods
  // ═══════════════════════════════════════════════════════════════════════════

  async listWorkspaceFiles(): Promise<IWorkspaceFileEntry[]> {
    const rootFolders = this._d.workspaceService?.folders ?? [];
    if (rootFolders.length === 0 || !this._d.fileService) { return []; }
    const rootUri = rootFolders[0].uri;
    const result: IWorkspaceFileEntry[] = [];

    // Recursive walk (breadth-first, up to 500 entries, max depth 6)
    const queue: { uri: import('../../../platform/uri.js').URI; rel: string }[] =
      [{ uri: rootUri, rel: '' }];
    const MAX_ENTRIES = 500;
    const MAX_DEPTH = 6;

    while (queue.length > 0 && result.length < MAX_ENTRIES) {
      const current = queue.shift()!;
      const depth = current.rel.split('/').filter(Boolean).length;
      try {
        const entries = await this._d.fileService.readdir(current.uri);
        for (const entry of entries) {
          if (result.length >= MAX_ENTRIES) { break; }
          if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'build') {
            continue;
          }
          const relPath = current.rel ? `${current.rel}/${entry.name}` : entry.name;
          const isDir = entry.type === 2; /* FileType.Directory */
          result.push({
            name: entry.name,
            fullPath: entry.uri.fsPath,
            relativePath: relPath,
            isDirectory: isDir,
          });
          if (isDir && depth < MAX_DEPTH) {
            queue.push({ uri: entry.uri, rel: relPath });
          }
        }
      } catch { /* skip unreadable dirs */ }
    }

    return result;
  }

  async searchSessions(query: string): Promise<Array<{ sessionId: string; sessionTitle: string; matchingContent: string }>> {
    if (!this._d.databaseService) { return []; }
    const { searchSessions, searchSessionsSemantic } = await import('../../../services/chatSessionPersistence.js');
    const workspaceId = this._d.workspaceService?.activeWorkspace?.id ?? '';

    // Substring search (fast, always available)
    const substringResults = await searchSessions(this._d.databaseService, query, workspaceId);

    // Semantic search via memory embeddings (when available)
    if (this._d.memoryService) {
      try {
        const memories = await this._d.memoryService.recallMemories(query, { topK: 10 });
        if (memories.length > 0) {
          const semanticResults = await searchSessionsSemantic(
            this._d.databaseService,
            memories.map(m => ({ sessionId: m.sessionId, summary: m.summary, messageCount: m.messageCount, createdAt: m.createdAt ?? '' })),
          );
          // Merge: semantic results first, then substring results not already included
          const seen = new Set(semanticResults.map(r => r.sessionId));
          const merged = [
            ...semanticResults.map(r => ({ sessionId: r.sessionId, sessionTitle: r.sessionTitle, matchingContent: r.summary })),
            ...substringResults.filter(r => !seen.has(r.sessionId)),
          ];
          return merged;
        }
      } catch {
        // Semantic search is best-effort — fall back to substring
      }
    }

    return substringResults;
  }

  async getContextLength(): Promise<number> {
    const modelId = this._d.languageModelsService.getActiveModel();
    if (modelId && this._d.ollamaProvider) {
      return this._d.ollamaProvider.getModelContextLength(modelId);
    }
    return 0;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Workspace Digest
  // ═══════════════════════════════════════════════════════════════════════════

  async getWorkspaceDigest(): Promise<string | undefined> {
    const now = Date.now();
    if (this._cachedDigest !== undefined && now - this._cacheTimestamp < ChatDataService.DIGEST_TTL_MS) {
      return this._cachedDigest;
    }

    const result = await computeChatWorkspaceDigest({
      databaseService: this._d.databaseService,
      fsAccessor: this._d.fsAccessor,
      getContextLength: () => this.getContextLength(),
    });
    this._cachedDigest = result;
    this._cacheTimestamp = now;
    return result;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Builder Methods
  // ═══════════════════════════════════════════════════════════════════════════

  buildWidgetServices(): IChatWidgetServices {
    const agentTaskServices = buildChatAgentTaskWidgetServices({
      agentSessionService: this._d.agentSessionService,
      agentApprovalService: this._d.agentApprovalService,
      agentExecutionService: this._d.agentExecutionService,
      agentTraceService: this._d.agentTraceService,
    });
    const pickerServices = buildChatWidgetPickerServices({
      getModels: () => this._d.languageModelsService.getModels(),
      getModelInfo: (modelId: string) => this._d.ollamaProvider.getModelInfo(modelId),
      getActiveModel: () => this._d.languageModelsService.getActiveModel(),
      setActiveModel: (modelId: string) => this._d.languageModelsService.setActiveModel(modelId),
      onDidChangeModels: this._d.languageModelsService.onDidChangeModels,
      getModelContextLength: (modelId: string) => this._d.ollamaProvider.getModelContextLength(modelId) ?? Promise.resolve(0),
      getMode: () => this._d.modeService.getMode(),
      setMode: (mode) => this._d.modeService.setMode(mode),
      getAvailableModes: () => this._d.modeService.getAvailableModes(),
      onDidChangeMode: this._d.modeService.onDidChangeMode,
    });
    const attachmentServices = buildChatWidgetAttachmentServices({
      getOpenEditorFiles: this._d.editorService
        ? () => this._d.editorService!.getOpenEditors().map((ed) => {
            // Canvas/database editors: description is "Tool editor: canvas" / "Tool editor: database"
            // and id is the raw page UUID
            if (ed.description === 'Tool editor: canvas' || ed.description === 'Tool editor: database') {
              return { name: ed.name, fullPath: `parallx-page://${ed.id}` };
            }
            return { name: ed.name, fullPath: ed.description || ed.name };
          })
        : undefined,
      getActiveEditorFile: this._d.editorService
        ? () => {
            const active = this._d.editorService!.activeEditor;
            if (!active) return undefined;
            if (active.typeId === 'canvas' || active.typeId === 'database') {
              return { name: active.name, fullPath: `parallx-page://${active.id}` };
            }
            return { name: active.name, fullPath: active.description || active.name };
          }
        : undefined,
      onDidChangeOpenEditors: this._d.editorService?.onDidChangeOpenEditors,
      listWorkspaceFiles: this._d.fsAccessor
        ? () => this.listWorkspaceFiles()
        : undefined,
      openFile: (this._d.editorService && this._d.fileService)
        ? (fullPath: string) => openChatFile({
            fullPath,
            workspaceFolders: this._d.workspaceService?.folders,
            openFileEditor: this._d.openFileEditor,
          })
        : undefined,
      openPage: this._d.openPage
        ? (pageId: string) => { this._d.openPage!(pageId); }
        : undefined,
      openMemory: ((this._d.workspaceMemoryService && this._d.openFileEditor) || (this._d.memoryService && this._d.editorService))
        ? (sessionId: string) => {
            void openChatMemoryViewer({
              sessionId,
              workspaceMemoryService: this._d.workspaceMemoryService,
              memoryService: this._d.memoryService,
              editorService: this._d.editorService,
              workspaceFolders: this._d.workspaceService?.folders,
              openFileEditor: this._d.openFileEditor,
            });
          }
        : undefined,
    });
    const sessionServices = buildChatWidgetSessionServices({
      getSessions: () => this._d.chatService.getSessions(),
      getSession: (id: string) => this._d.chatService.getSession(id),
      deleteSession: (id: string) => this._d.chatService.deleteSession(id),
      updateSessionModel: (id: string, modelId: string) => this._d.chatService.updateSessionModel(id, modelId),
      getSystemPrompt: async () => {
        const report = this.getLastSystemPromptReport();
        return report?.promptText ?? '(No system prompt generated yet — send a message first)';
      },
      readFileRelative: this._d.fsAccessor
        ? (relativePath: string) => this.readFileRelative(relativePath)
        : undefined,
      writeFileRelative: (this._d.fileService && this._d.workspaceService?.folders?.length)
        ? (relativePath: string, content: string) => this.writeFileRelative(relativePath, content)
        : undefined,
      searchSessions: this._d.databaseService
        ? (query: string) => this.searchSessions(query)
        : undefined,
    });
    const requestServices = buildChatWidgetRequestServices({
      sendRequest: async (sessionId, message, options) => {
        await this._d.chatService.sendRequest(sessionId, message, options);
      },
      cancelRequest: (sessionId: string) => {
        this._d.chatService.cancelRequest(sessionId);
      },
      createSession: () => this._d.chatService.createSession(),
      onDidChangeSession: this._d.chatService.onDidChangeSession as Event<string>,
      getProviderStatus: () => ({
        available: (this._d.ollamaProvider as any).getLastStatus?.()?.available ?? false,
      }),
      onDidChangeProviderStatus: (this._d.ollamaProvider as any).onDidChangeStatus as Event<void>,
      queueRequest: (sessionId: string, message: string, kind: ChatRequestQueueKind, options) =>
        this._d.chatService.queueRequest(sessionId, message, kind, options),
      removePendingRequest: (sessionId: string, requestId: string) =>
        this._d.chatService.removePendingRequest(sessionId, requestId),
      requestYield: (sessionId: string) =>
        this._d.chatService.requestYield(sessionId),
      onDidChangePendingRequests: this._d.chatService.onDidChangePendingRequests,
    });

    return {
      ...requestServices,
      ...pickerServices,
      ...attachmentServices,
      ...sessionServices,
      ...agentTaskServices,
    };
  }

  buildTokenBarServices(): ITokenStatusBarServices {
    return buildChatTokenBarServices({
      getActiveWidget: this._d.getActiveWidget,
      getContextLength: () => this.getContextLength(),
      getMode: () => this._d.modeService.getMode() as ChatMode,
      getWorkspaceName: () => this.getWorkspaceName(),
      getPageCount: () => this.getPageCount(),
      getCurrentPageTitle: () => this.getCurrentPageTitle(),
      getToolDefinitions: () => this.getToolDefinitions(),
      getFileCount: () => this.getFileCount(),
      isRAGAvailable: () => this.isRAGAvailable(),
      isIndexing: () => this.isIndexing(),
      getIndexingProgress: () => this._d.indexingPipelineService?.progress ?? { phase: 'idle' as const, processed: 0, total: 0 },
      getIndexStats: () => this._lastIndexStats,
      getLastSystemPromptReport: () => this.getLastSystemPromptReport(),
    });
  }
}
