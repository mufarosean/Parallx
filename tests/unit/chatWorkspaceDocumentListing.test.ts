import { describe, expect, it, vi } from 'vitest';

import { tryHandleWorkspaceDocumentListing } from '../../src/built-in/chat/utilities/chatWorkspaceDocumentListing';

describe('chat workspace document listing', () => {
  it('lists user-facing documents and skips internal artifacts', async () => {
    const response = { markdown: vi.fn() } as any;
    const handled = await tryHandleWorkspaceDocumentListing({
      text: 'What documents do I have in my workspace?',
      workspaceName: 'Demo Workspace',
      response,
      token: {
        isCancellationRequested: false,
        onCancellationRequested: vi.fn(() => ({ dispose: vi.fn() })),
      } as any,
      listFiles: vi.fn(async (relativePath: string) => {
        if (relativePath === '') {
          return [
            { name: '.parallx', type: 'directory' as const },
            { name: 'parallx', type: 'directory' as const },
            { name: 'Claims Guide.md', type: 'file' as const },
            { name: 'notes', type: 'directory' as const },
          ];
        }
        if (relativePath === 'parallx') {
          return [{ name: 'ai-config.json', type: 'file' as const }];
        }
        if (relativePath === 'notes') {
          return [{ name: 'meeting-2024-03.md', type: 'file' as const }];
        }
        return [];
      }),
    });

    expect(handled).toBe(true);
    const markdown = response.markdown.mock.calls[0][0] as string;
    expect(markdown).toContain('Claims Guide.md');
    expect(markdown).toContain('notes/meeting-2024-03.md');
    expect(markdown).not.toContain('.parallx');
    expect(markdown).not.toContain('ai-config.json');
  });
});