/**
 * M38 Scope Resolution — resolves natural-language entity references in user
 * messages to canonical workspace paths before retrieval or tool use.
 *
 * Subsumes the old `inferExhaustiveFolderPath()` regex and generalizes it
 * into full entity + scope resolution.
 */

import type { IQueryScope, IResolvedEntity } from '../chatTypes.js';

// ── Types ──────────────────────────────────────────────────────────────────

/** Minimal filesystem interface for scope resolution — only needs directory listing. */
export interface IScopeResolverDeps {
  /** List immediate children of a workspace-relative path ('' = root). */
  listFilesRelative?(relativePath: string): Promise<{ name: string; type: 'file' | 'directory' }[]>;
}

interface IWorkspaceEntry {
  readonly name: string;
  readonly relativePath: string;
  readonly type: 'file' | 'directory';
}

const MAX_SCOPE_SCAN_DEPTH = 3;
const MAX_SCOPE_SCAN_ENTRIES = 400;

/** Context extracted from @mentions that are already resolved. */
export interface IMentionScope {
  folders: string[];
  files: string[];
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Resolve the query scope from user text, @mentions, and workspace filesystem.
 *
 * Resolution priority:
 * 1. Explicit @mentions (highest confidence)
 * 2. Natural-language entity extraction + workspace fuzzy matching
 * 3. Fallback to workspace-level scope
 */
export async function resolveQueryScope(
  userText: string,
  mentions: IMentionScope,
  deps: IScopeResolverDeps,
): Promise<IQueryScope> {
  // ── 1. Explicit @mention scope ──
  if (mentions.folders.length > 0 || mentions.files.length > 0) {
    return buildMentionScope(mentions);
  }

  const duplicateFilenameCandidate = extractDuplicateFilenameCandidate(userText);
  if (duplicateFilenameCandidate && deps.listFilesRelative) {
    const workspaceEntries = await collectWorkspaceEntries(deps);
    const duplicateMatches = findDuplicateFilenameMatches(duplicateFilenameCandidate, workspaceEntries);
    if (duplicateMatches.length > 0) {
      return buildInferredScope(duplicateMatches);
    }
  }

  // ── 2. Natural-language entity extraction ──
  const candidates = extractEntityCandidates(userText);
  if (candidates.length > 0 && deps.listFilesRelative) {
    const resolved = await matchCandidatesToWorkspace(candidates, deps);
    if (resolved.length > 0) {
      return buildInferredScope(resolved);
    }
  }

  // ── 3. Fallback to workspace scope ──
  return WORKSPACE_SCOPE;
}

function extractDuplicateFilenameCandidate(text: string): string | undefined {
  const match = text.match(/\bcompare\s+(?:the\s+)?two\s+([a-z0-9][a-z0-9._-]{2,80})\s+(?:documents|docs|files)\b/i);
  return match?.[1]?.trim();
}

// ── Internal: Mention scope builder ────────────────────────────────────────

function buildMentionScope(mentions: IMentionScope): IQueryScope {
  const entities: IResolvedEntity[] = [];
  const pathPrefixes: string[] = [];

  for (const folder of mentions.folders) {
    entities.push({ naturalName: folder, resolvedPath: folder, kind: 'folder' });
    pathPrefixes.push(ensureTrailingSlash(folder));
  }
  for (const file of mentions.files) {
    entities.push({ naturalName: file, resolvedPath: file, kind: 'file' });
    pathPrefixes.push(file);
  }

  const level = mentions.files.length > 0 && mentions.folders.length === 0
    ? 'document' as const
    : 'folder' as const;

  return {
    level,
    pathPrefixes,
    derivedFrom: 'explicit-mention',
    resolvedEntities: entities,
    confidence: 1.0,
  };
}

// ── Internal: Entity candidate extraction ──────────────────────────────────

/** Patterns that indicate a named entity reference in the user message. */
const ENTITY_EXTRACTION_PATTERNS: RegExp[] = [
  // "in the RF Guides folder"
  /\b(?:in|inside|from|under|within)\s+(?:the\s+)?([A-Za-z0-9][A-Za-z0-9 _&-]{1,80}?)\s+folder\b/i,
  // "RF Guides folder"
  /\b([A-Za-z0-9][A-Za-z0-9 _&-]{1,80}?)\s+folder\b/i,
  // "files in RF Guides" / "papers in RF Guides"
  /\b(?:files?|papers?|docs?|documents?)\s+in\s+(?:the\s+)?(?:['"]?)([A-Z][A-Za-z0-9 _&-]{1,80}?)(?:['"]?)(?=[?.!,]|$)\b/i,
  // "in RF Guides"
  /\b(?:in|inside|from|under|within)\s+(?:the\s+)?(?:['"]?)([A-Za-z0-9][A-Za-z0-9 _&-]{1,80}?)(?:['"]?)\s*(?:directory|dir)\b/i,
  // "the Claims Guide" / "the Quick Reference"
  /\bthe\s+([A-Z][A-Za-z0-9 _&-]{2,80}?)(?:\s+(?:file|document|doc|guide|paper|report|pdf|book))?\b/,
  // "summarize Claims Guide" — capitalized phrase, not preceded by common verbs that take other objects
  /\b(?:summarize|read|review|explain|describe|analyze)\s+(?:the\s+)?([A-Z][A-Za-z0-9 _&-]{2,80})\b/,
  // "compare X vs Y" — extract both
  /\bcompare\s+(?:the\s+)?([A-Z][A-Za-z0-9 _&-]{2,60})\s+(?:vs\.?|versus|and|with|to)\s+(?:the\s+)?([A-Z][A-Za-z0-9 _&-]{2,60})\b/i,
  // Lowercase folder-style paths such as policies/ or claims/archive/
  /\b(?:summarize|list|show|read|review|explain|describe|analyze)\s+(?:each\s+file\s+in\s+|everything\s+in\s+|all\s+files\s+in\s+|the\s+files\s+in\s+)?([a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)+\/?|[a-z0-9][a-z0-9._-]*\/)(?=[?.!,]|$)/i,
  // Lowercase file-style targets such as auto-policy-2024.md or how-to-file
  /\b(?:summarize|read|review|explain|describe|analyze|compare)\s+(?:the\s+)?([a-z0-9][a-z0-9._/-]{2,100}(?:\.(?:md|txt|pdf|docx|xlsx))?)\b/i,
  /\bcompare\s+(?:the\s+)?([a-z0-9][a-z0-9._/-]{2,100}(?:\.(?:md|txt|pdf|docx|xlsx))?)\s+(?:vs\.?|versus|and|with|to)\s+(?:the\s+)?([a-z0-9][a-z0-9._/-]{2,100}(?:\.(?:md|txt|pdf|docx|xlsx))?)\b/i,
  // Quoted entity: "the 'RF Guides'" or 'Claims Guide'
  /['"]([A-Za-z0-9][A-Za-z0-9 _&-]{1,80}?)['"]/,
];

/**
 * Extract candidate entity names from user text.
 * Returns deduplicated candidates ordered by extraction priority.
 */
export function extractEntityCandidates(text: string): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();

  for (const pattern of ENTITY_EXTRACTION_PATTERNS) {
    const match = text.match(pattern);
    if (!match) { continue; }
    // Some patterns have multiple capture groups (e.g. compare X vs Y)
    for (let i = 1; i < match.length; i++) {
      const raw = match[i]?.trim();
      if (!raw || raw.length < 2) { continue; }
      const normalized = raw.toLowerCase();
      if (!seen.has(normalized) && !ENTITY_STOPWORDS.has(normalized)) {
        seen.add(normalized);
        candidates.push(raw);
      }
    }
  }
  return candidates;
}

/** Words that look like entity names but aren't. */
const ENTITY_STOPWORDS = new Set([
  'the', 'this', 'that', 'each', 'every', 'all', 'some',
  'file', 'files', 'folder', 'folders', 'document', 'documents',
  'workspace', 'page', 'pages', 'one', 'paragraph', 'summary',
  'following', 'above', 'below', 'here',
]);

// ── Internal: Fuzzy workspace matching ─────────────────────────────────────

/**
 * Match candidate entity names against the actual workspace filesystem.
 * Uses two-level search: root entries first, then one level deep.
 */
async function matchCandidatesToWorkspace(
  candidates: string[],
  deps: IScopeResolverDeps,
): Promise<IResolvedEntity[]> {
  if (!deps.listFilesRelative) { return []; }

  const workspaceEntries = await collectWorkspaceEntries(deps);
  if (workspaceEntries.length === 0) { return []; }

  const resolved: IResolvedEntity[] = [];
  const resolvedPaths = new Set<string>();

  for (const candidate of candidates) {
    const match = findBestMatch(candidate, workspaceEntries);
    if (match && !resolvedPaths.has(match.resolvedPath)) {
      resolvedPaths.add(match.resolvedPath);
      resolved.push(match);
    }
  }

  return resolved;
}

async function collectWorkspaceEntries(deps: IScopeResolverDeps): Promise<IWorkspaceEntry[]> {
  const results: IWorkspaceEntry[] = [];
  const visited = new Set<string>();

  const walk = async (relativePath: string, depth: number): Promise<void> => {
    if (!deps.listFilesRelative || results.length >= MAX_SCOPE_SCAN_ENTRIES) {
      return;
    }
    const key = relativePath || '.';
    if (visited.has(key)) {
      return;
    }
    visited.add(key);

    const entries = await deps.listFilesRelative(relativePath).catch(() => []);
    for (const entry of entries) {
      if (results.length >= MAX_SCOPE_SCAN_ENTRIES) {
        return;
      }

      const childPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
      results.push({
        name: entry.name,
        relativePath: childPath,
        type: entry.type,
      });

      if (entry.type === 'directory' && depth < MAX_SCOPE_SCAN_DEPTH) {
        await walk(childPath, depth + 1);
      }
    }
  };

  await walk('', 0);
  return results;
}

/**
 * Score and select the best-matching workspace entry for a candidate name.
 */
function findBestMatch(
  candidate: string,
  entries: IWorkspaceEntry[],
): IResolvedEntity | undefined {
  const normalizedCandidate = normalizeName(candidate);
  let bestScore = 0;
  let bestEntry: IWorkspaceEntry | undefined;

  for (const entry of entries) {
    const score = scoreMatch(normalizedCandidate, entry);
    if (score > bestScore) {
      bestScore = score;
      bestEntry = entry;
    }
  }

  // Require a minimum score to avoid false positives
  if (!bestEntry || bestScore < 2) {
    return undefined;
  }

  const kind = bestEntry.type === 'directory' ? 'folder' : 'file';
  const resolvedPath = kind === 'folder'
    ? ensureTrailingSlash(bestEntry.relativePath)
    : bestEntry.relativePath;

  return {
    naturalName: candidate,
    resolvedPath,
    kind,
  };
}

function findDuplicateFilenameMatches(
  candidate: string,
  entries: IWorkspaceEntry[],
): IResolvedEntity[] {
  const normalizedCandidate = normalizeName(candidate);
  const matches = entries.filter((entry) => entry.type === 'file' && normalizeName(entry.name) === normalizedCandidate);
  return matches.map((entry) => ({
    naturalName: candidate,
    resolvedPath: entry.relativePath,
    kind: 'file' as const,
  }));
}

/**
 * Score how well a candidate name matches a workspace entry name.
 *
 * Scoring:
 * - Exact normalized match: 10
 * - Candidate is prefix of entry (or vice versa): 5
 * - Token overlap: 1 per matched token (minimum 3-char tokens)
 */
function scoreMatch(normalizedCandidate: string, entry: IWorkspaceEntry): number {
  const normalizedEntryName = normalizeName(entry.name);
  const normalizedEntryPath = normalizeName(entry.relativePath);

  // Exact match
  if (normalizedCandidate === normalizedEntryName || normalizedCandidate === normalizedEntryPath) { return 10; }

  // Prefix match (either direction)
  if (
    normalizedEntryName.startsWith(normalizedCandidate)
    || normalizedCandidate.startsWith(normalizedEntryName)
    || normalizedEntryPath.startsWith(normalizedCandidate)
    || normalizedCandidate.startsWith(normalizedEntryPath)
  ) {
    return 5;
  }

  // Token overlap
  const candidateTokens = tokenize(normalizedCandidate);
  const entryTokens = new Set([
    ...tokenize(normalizedEntryName),
    ...tokenize(normalizedEntryPath),
  ]);
  const overlap = candidateTokens.filter((t) => entryTokens.has(t)).length;
  return overlap;
}

// ── Internal: Inferred scope builder ───────────────────────────────────────

function buildInferredScope(entities: IResolvedEntity[]): IQueryScope {
  const hasFolders = entities.some((e) => e.kind === 'folder');

  const pathPrefixes = entities.map((e) => e.resolvedPath);

  const level = hasFolders ? 'folder' as const : 'document' as const;

  // Confidence based on match quality: multiple entities → higher confidence
  const confidence = Math.min(0.9, 0.6 + entities.length * 0.1);

  return {
    level,
    pathPrefixes,
    derivedFrom: 'inferred',
    resolvedEntities: entities,
    confidence,
  };
}

// ── Shared utilities ───────────────────────────────────────────────────────

const WORKSPACE_SCOPE: IQueryScope = {
  level: 'workspace',
  derivedFrom: 'contextual',
  confidence: 0.3,
};

function normalizeName(text: string): string {
  return text
    .toLowerCase()
    .replace(/\.(pdf|docx|md|txt|epub|xlsx|xls)$/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(normalized: string): string[] {
  return normalized.split(/\s+/).filter((t) => t.length >= 3);
}

function ensureTrailingSlash(path: string): string {
  return path.endsWith('/') ? path : path + '/';
}
