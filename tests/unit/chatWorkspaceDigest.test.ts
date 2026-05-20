// chatWorkspaceDigest.test.ts — the function is deprecated and now
// always returns undefined regardless of inputs. The full rationale lives
// in src/built-in/chat/utilities/chatWorkspaceDigest.ts. These tests
// freeze that contract so a future contributor doesn't accidentally
// re-introduce the auto-listing in the system prompt.

import { describe, expect, it, vi } from 'vitest';

import { computeChatWorkspaceDigest } from '../../src/built-in/chat/utilities/chatWorkspaceDigest';

describe('chat workspace digest (deprecated)', () => {
  it('returns undefined even when database and fs are fully populated', async () => {
    const databaseService = {
      isOpen: true,
      all: vi.fn(async () => [{ id: 'page-1', title: 'Claims Page' }]),
    };
    const fsAccessor = {
      readdir: vi.fn(async () => [{ name: 'README.md', type: 'file' as const }]),
      exists: vi.fn(async () => true),
      readFileContent: vi.fn(async () => ({ content: 'readme content' })),
    };

    const digest = await computeChatWorkspaceDigest({
      databaseService,
      fsAccessor,
      getContextLength: vi.fn().mockResolvedValue(8192),
    });

    expect(digest).toBeUndefined();
  });

  it('returns undefined when no sources are available', async () => {
    const digest = await computeChatWorkspaceDigest({
      getContextLength: vi.fn().mockResolvedValue(0),
    });
    expect(digest).toBeUndefined();
  });

  it('does not invoke the database or filesystem (zero side effects)', async () => {
    const databaseService = {
      isOpen: true,
      all: vi.fn(async () => []),
    };
    const fsAccessor = {
      readdir: vi.fn(async () => []),
      exists: vi.fn(async () => false),
      readFileContent: vi.fn(async () => ({ content: '' })),
    };

    await computeChatWorkspaceDigest({
      databaseService,
      fsAccessor,
      getContextLength: vi.fn().mockResolvedValue(8192),
    });

    expect(databaseService.all).not.toHaveBeenCalled();
    expect(fsAccessor.readdir).not.toHaveBeenCalled();
    expect(fsAccessor.exists).not.toHaveBeenCalled();
    expect(fsAccessor.readFileContent).not.toHaveBeenCalled();
  });
});
