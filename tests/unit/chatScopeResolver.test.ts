import { describe, expect, it, vi } from 'vitest';

import {
  resolveQueryScope,
  extractEntityCandidates,
} from '../../src/built-in/chat/utilities/chatScopeResolver';

// ── extractEntityCandidates ────────────────────────────────────────────────

describe('extractEntityCandidates', () => {
  it('extracts folder reference from "in the X folder"', () => {
    const result = extractEntityCandidates('What files are in the RF Guides folder?');
    expect(result).toContain('RF Guides');
  });

  it('extracts folder reference from "X folder" without preposition', () => {
    const result = extractEntityCandidates('List the Claims folder contents');
    expect(result).toContain('Claims');
  });

  it('extracts quoted entity names', () => {
    const result = extractEntityCandidates('Summarize the "Auto Insurance Policy"');
    expect(result).toContain('Auto Insurance Policy');
  });

  it('extracts capitalized entity after action verb', () => {
    const result = extractEntityCandidates('summarize Claims Guide');
    expect(result).toContain('Claims Guide');
  });

  it('returns empty for generic questions', () => {
    const result = extractEntityCandidates('what is my deductible?');
    expect(result).toHaveLength(0);
  });

  it('deduplicates candidates', () => {
    // "in the Claims folder" matches both ENTITY_EXTRACTION_PATTERNS[0] and [1]
    const result = extractEntityCandidates('Look in the Claims folder for the Claims folder');
    const claimsCount = result.filter((c) => c.toLowerCase() === 'claims').length;
    expect(claimsCount).toBe(1);
  });

  it('filters out stopwords', () => {
    const result = extractEntityCandidates('summarize the following');
    // "following" is a stopword
    expect(result).not.toContain('following');
  });
});

// ── resolveQueryScope ──────────────────────────────────────────────────────

describe('resolveQueryScope', () => {
  const MOCK_WORKSPACE_ENTRIES = [
    { name: 'RF Guides', type: 'directory' as const },
    { name: 'Claims Guide.md', type: 'file' as const },
    { name: 'Auto Insurance Policy.md', type: 'file' as const },
    { name: 'Vehicle Info.md', type: 'file' as const },
    { name: 'docs', type: 'directory' as const },
  ];

  const mockDeps = {
    listFilesRelative: vi.fn().mockResolvedValue(MOCK_WORKSPACE_ENTRIES),
  };

  // ── Explicit mention scope ──

  it('returns explicit-mention scope for @folder mentions', async () => {
    const scope = await resolveQueryScope(
      'What files are here?',
      { folders: ['RF Guides'], files: [] },
      mockDeps,
    );

    expect(scope.level).toBe('folder');
    expect(scope.derivedFrom).toBe('explicit-mention');
    expect(scope.confidence).toBe(1.0);
    expect(scope.pathPrefixes).toEqual(['RF Guides/']);
    expect(scope.resolvedEntities).toHaveLength(1);
    expect(scope.resolvedEntities![0].kind).toBe('folder');
  });

  it('returns explicit-mention scope for @file mentions', async () => {
    const scope = await resolveQueryScope(
      'Summarize this',
      { folders: [], files: ['Claims Guide.md'] },
      mockDeps,
    );

    expect(scope.level).toBe('document');
    expect(scope.derivedFrom).toBe('explicit-mention');
    expect(scope.confidence).toBe(1.0);
    expect(scope.pathPrefixes).toEqual(['Claims Guide.md']);
  });

  // ── Inferred scope ──

  it('infers folder scope from natural language', async () => {
    const scope = await resolveQueryScope(
      'List everything in the RF Guides folder',
      { folders: [], files: [] },
      mockDeps,
    );

    expect(scope.level).toBe('folder');
    expect(scope.derivedFrom).toBe('inferred');
    expect(scope.confidence).toBeGreaterThan(0.5);
    expect(scope.resolvedEntities).toBeDefined();
    expect(scope.resolvedEntities!.some((e) => e.resolvedPath === 'RF Guides/')).toBe(true);
  });

  it('infers document scope from action verb + entity', async () => {
    const scope = await resolveQueryScope(
      'summarize Claims Guide',
      { folders: [], files: [] },
      mockDeps,
    );

    expect(scope.derivedFrom).toBe('inferred');
    expect(scope.resolvedEntities).toBeDefined();
    expect(scope.resolvedEntities!.length).toBeGreaterThan(0);
  });

  // ── Workspace fallback ──

  it('falls back to workspace scope for generic queries', async () => {
    const scope = await resolveQueryScope(
      'what is my deductible?',
      { folders: [], files: [] },
      mockDeps,
    );

    expect(scope.level).toBe('workspace');
    expect(scope.derivedFrom).toBe('contextual');
  });

  it('falls back to workspace scope when no deps available', async () => {
    const scope = await resolveQueryScope(
      'List everything in the RF Guides folder',
      { folders: [], files: [] },
      {},
    );

    expect(scope.level).toBe('workspace');
    expect(scope.derivedFrom).toBe('contextual');
  });

  // ── Edge cases ──

  it('handles listFilesRelative rejection gracefully', async () => {
    const failingDeps = {
      listFilesRelative: vi.fn().mockRejectedValue(new Error('fs error')),
    };

    const scope = await resolveQueryScope(
      'List everything in the RF Guides folder',
      { folders: [], files: [] },
      failingDeps,
    );

    expect(scope.level).toBe('workspace');
    expect(scope.derivedFrom).toBe('contextual');
  });

  it('explicit mentions take priority over inferred scope', async () => {
    const scope = await resolveQueryScope(
      'List everything in the RF Guides folder',
      { folders: ['docs'], files: [] },
      mockDeps,
    );

    // Should use the explicit mention, not the inferred "RF Guides"
    expect(scope.derivedFrom).toBe('explicit-mention');
    expect(scope.pathPrefixes).toEqual(['docs/']);
  });
});
