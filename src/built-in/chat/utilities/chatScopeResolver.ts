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
  // "in RF Guides"
  /\b(?:in|inside|from|under|within)\s+(?:the\s+)?(?:['"]?)([A-Za-z0-9][A-Za-z0-9 _&-]{1,80}?)(?:['"]?)\s*(?:directory|dir)\b/i,
  // "the Claims Guide" / "the Quick Reference"
  /\bthe\s+([A-Z][A-Za-z0-9 _&-]{2,80}?)(?:\s+(?:file|document|doc|guide|paper|report|pdf|book))?\b/,
  // "summarize Claims Guide" — capitalized phrase, not preceded by common verbs that take other objects
  /\b(?:summarize|read|review|explain|describe|analyze)\s+(?:the\s+)?([A-Z][A-Za-z0-9 _&-]{2,80})\b/,
  // "compare X vs Y" — extract both
  /\bcompare\s+(?:the\s+)?([A-Z][A-Za-z0-9 _&-]{2,60})\s+(?:vs\.?|versus|and|with|to)\s+(?:the\s+)?([A-Z][A-Za-z0-9 _&-]{2,60})\b/i,
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

  // Cache root entries (called once per turn at most)
  const rootEntries = await deps.listFilesRelative('').catch(() => []);
  if (rootEntries.length === 0) { return []; }

  const resolved: IResolvedEntity[] = [];
  const resolvedPaths = new Set<string>();

  for (const candidate of candidates) {
    const match = findBestMatch(candidate, rootEntries);
    if (match && !resolvedPaths.has(match.resolvedPath)) {
      resolvedPaths.add(match.resolvedPath);
      resolved.push(match);
    }
  }

  return resolved;
}

interface IWorkspaceEntry {
  name: string;
  type: 'file' | 'directory';
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
    const score = scoreMatch(normalizedCandidate, entry.name);
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
    ? ensureTrailingSlash(bestEntry.name)
    : bestEntry.name;

  return {
    naturalName: candidate,
    resolvedPath,
    kind,
  };
}

/**
 * Score how well a candidate name matches a workspace entry name.
 *
 * Scoring:
 * - Exact normalized match: 10
 * - Candidate is prefix of entry (or vice versa): 5
 * - Token overlap: 1 per matched token (minimum 3-char tokens)
 */
function scoreMatch(normalizedCandidate: string, entryName: string): number {
  const normalizedEntry = normalizeName(entryName);

  // Exact match
  if (normalizedCandidate === normalizedEntry) { return 10; }

  // Prefix match (either direction)
  if (normalizedEntry.startsWith(normalizedCandidate) || normalizedCandidate.startsWith(normalizedEntry)) {
    return 5;
  }

  // Token overlap
  const candidateTokens = tokenize(normalizedCandidate);
  const entryTokens = new Set(tokenize(normalizedEntry));
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
