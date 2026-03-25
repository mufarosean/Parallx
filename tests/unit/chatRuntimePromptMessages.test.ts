import { describe, expect, it } from 'vitest';

import {
  buildRuntimePromptEnvelopeMessages,
  buildRuntimePromptSeedMessages,
} from '../../src/built-in/chat/utilities/chatRuntimePromptMessages';

describe('chat runtime prompt messages', () => {
  it('builds seed messages from system prompt and history', () => {
    const result = buildRuntimePromptSeedMessages({
      systemPrompt: 'System prompt',
      history: [{
        request: { text: 'User question' },
        response: {
          parts: [
            { content: 'Assistant answer' },
            { code: 'const value = 1;' },
          ],
        },
      } as any],
    });

    expect(result).toEqual([
      { role: 'system', content: 'System prompt' },
      { role: 'user', content: 'User question' },
      { role: 'assistant', content: 'Assistant answer\n```\nconst value = 1;\n```' },
    ]);
  });

  it('builds envelope messages and preserves only image attachments', () => {
    const result = buildRuntimePromptEnvelopeMessages({
      seedMessages: [{ role: 'system', content: 'System prompt' }],
      userContent: 'Final user content',
      attachments: [
        { kind: 'image', id: 'img-1', name: 'photo.png', fullPath: 'parallx-image://1', isImplicit: false, mimeType: 'image/png', data: 'abc' },
        { kind: 'file', id: 'file-1', name: 'Notes.md', fullPath: 'D:/AI/Parallx/Notes.md', isImplicit: false },
      ],
    });

    expect(result).toHaveLength(2);
    expect(result[1]).toEqual({
      role: 'user',
      content: 'Final user content',
      images: [{ kind: 'image', id: 'img-1', name: 'photo.png', fullPath: 'parallx-image://1', isImplicit: false, mimeType: 'image/png', data: 'abc' }],
    });
  });
});