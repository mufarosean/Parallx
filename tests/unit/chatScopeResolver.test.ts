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

  it('extracts folder reference from bare "files in X" phrasing', () => {
    const result = extractEntityCandidates('Can you provide a one paragraph summary for each of the files in RF Guides?');
    expect(result).toContain('RF Guides');
  });

  it('extracts lowercase folder paths with trailing slashes', () => {
    const result = extractEntityCandidates('Summarize each file in policies/.');
    expect(result).toContain('policies/');
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
    listFilesRelative: vi.fn(async (relativePath: string) => {
      if (relativePath === '') {
        return MOCK_WORKSPACE_ENTRIES;
      }
      if (relativePath === 'docs') {
        return [
          { name: 'Nested Guides', type: 'directory' as const },
        ];
      }
      if (relativePath === 'docs/Nested Guides') {
        return [
          { name: 'Folder Notes.md', type: 'file' as const },
        ];
      }
      return [];
    }),
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

  it('infers folder scope from bare "files in X" phrasing', async () => {
    const scope = await resolveQueryScope(
      'Can you provide a one paragraph summary for each of the files in RF Guides?',
      { folders: [], files: [] },
      mockDeps,
    );

    expect(scope.level).toBe('folder');
    expect(scope.derivedFrom).toBe('inferred');
    expect(scope.pathPrefixes).toContain('RF Guides/');
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

  it('resolves lowercase file-style comparisons', async () => {
    const lowerCaseDeps = {
      listFilesRelative: vi.fn(async (relativePath: string) => {
        if (relativePath === '') {
          return [{ name: 'policies', type: 'directory' as const }];
        }
        if (relativePath === 'policies') {
          return [
            { name: 'auto-policy-2023.md', type: 'file' as const },
            { name: 'auto-policy-2024.md', type: 'file' as const },
          ];
        }
        return [];
      }),
    };

    const scope = await resolveQueryScope(
      'Compare auto-policy-2024.md and auto-policy-2023.md.',
      { folders: [], files: [] },
      lowerCaseDeps,
    );

    expect(scope.pathPrefixes).toEqual(expect.arrayContaining([
      'policies/auto-policy-2024.md',
      'policies/auto-policy-2023.md',
    ]));
  });

  it('resolves lowercase folder-style prompts with trailing slashes', async () => {
    const lowerCaseFolderDeps = {
      listFilesRelative: vi.fn(async (relativePath: string) => {
        if (relativePath === '') {
          return [{ name: 'policies', type: 'directory' as const }];
        }
        if (relativePath === 'policies') {
          return [
            { name: 'auto-policy-2023.md', type: 'file' as const },
            { name: 'auto-policy-2024.md', type: 'file' as const },
            { name: 'umbrella', type: 'directory' as const },
          ];
        }
        return [];
      }),
    };

    const scope = await resolveQueryScope(
      'Summarize each file in policies/.',
      { folders: [], files: [] },
      lowerCaseFolderDeps,
    );

    expect(scope.level).toBe('folder');
    expect(scope.pathPrefixes).toContain('policies/');
  });

  it('resolves duplicate filename comparisons to all matching files', async () => {
    const duplicateDeps = {
      listFilesRelative: vi.fn(async (relativePath: string) => {
        if (relativePath === '') {
          return [
            { name: 'claims', type: 'directory' as const },
            { name: 'notes', type: 'directory' as const },
          ];
        }
        if (relativePath === 'claims' || relativePath === 'notes') {
          return [{ name: 'how-to-file.md', type: 'file' as const }];
        }
        return [];
      }),
    };

    const scope = await resolveQueryScope(
      'Compare the two how-to-file documents.',
      { folders: [], files: [] },
      duplicateDeps,
    );

    expect(scope.pathPrefixes).toEqual(expect.arrayContaining([
      'claims/how-to-file.md',
      'notes/how-to-file.md',
    ]));
  });

  it('resolves nested folders by walking the workspace tree', async () => {
    const scope = await resolveQueryScope(
      'Summarize each file in the Nested Guides folder',
      { folders: [], files: [] },
      mockDeps,
    );

    expect(scope.level).toBe('folder');
    expect(scope.pathPrefixes).toContain('docs/Nested Guides/');
    expect(scope.derivedFrom).toBe('inferred');
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
