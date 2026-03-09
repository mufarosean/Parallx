import { describe, expect, it, vi } from 'vitest';

import { computeChatWorkspaceDigest } from '../../src/built-in/chat/utilities/chatWorkspaceDigest';

describe('chat workspace digest', () => {
  it('builds a digest from pages, files, and key previews', async () => {
    const databaseService = {
      isOpen: true,
      all: vi.fn(async (sql: string) => {
        if (sql.includes('indexing_metadata')) {
          return [
            { source_id: 'page-1', summary: 'Claim workflow summary' },
            { source_id: 'Claims Guide.md', summary: 'Guide summary' },
          ];
        }
        return [{ id: 'page-1', title: 'Claims Page' }];
      }),
    };
    const fsAccessor = {
      readdir: vi.fn(async (dir: string) => dir === '.'
        ? [
          { name: 'Claims Guide.md', type: 'file' as const },
          { name: 'docs', type: 'directory' as const },
        ]
        : []),
      exists: vi.fn(async (path: string) => path === 'README.md'),
      readFile: vi.fn(async () => 'Workspace readme'),
    };

    const digest = await computeChatWorkspaceDigest({
      databaseService,
      fsAccessor,
      getContextLength: vi.fn().mockResolvedValue(8192),
    });

    expect(digest).toContain('CANVAS PAGES (1):');
    expect(digest).toContain('Claims Page — Claim workflow summary');
    expect(digest).toContain('WORKSPACE FILES:');
    expect(digest).toContain('📄 Claims Guide.md — Guide summary');
    expect(digest).toContain('KEY FILE — README.md:');
    expect(digest).toContain('Workspace readme');
  });

  it('returns undefined when no digest sources are available', async () => {
    const digest = await computeChatWorkspaceDigest({
      getContextLength: vi.fn().mockResolvedValue(0),
    });

    expect(digest).toBeUndefined();
  });
});