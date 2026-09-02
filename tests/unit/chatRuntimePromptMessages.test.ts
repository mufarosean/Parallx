import { describe, expect, it } from 'vitest';

import { ChatContentPartKind } from '../../src/services/chatTypes';
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
            { kind: ChatContentPartKind.Markdown, content: 'Assistant answer' },
            { kind: ChatContentPartKind.CodeBlock, code: 'const value = 1;' },
            // Thinking is never replayed (the one flattener's contract).
            { kind: ChatContentPartKind.Thinking, content: 'private reasoning', isCollapsed: true },
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