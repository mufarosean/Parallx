/**
 * A tool image the turn loop sends as a user message after the tool result
 * serializes for Anthropic as one user turn: the tool_result block first, then
 * the image (docs/BROWSER_AGENT_IMPLEMENTATION_CONTRACT.md, Stage E).
 */

import { describe, it, expect } from 'vitest';
import { anthropicMessagesFromChat } from '../../src/built-in/chat/providers/anthropicProvider';
import type { IChatMessage } from '../../src/services/chatTypes';

const IMAGE = { kind: 'image' as const, id: 'browser:ws:run:c1', name: 'Page capture', fullPath: '', isImplicit: false, mimeType: 'image/jpeg', data: '/9j/AAAA' };

describe('anthropicMessagesFromChat with tool images', () => {
  it('puts the image after the tool result in the same user turn', () => {
    const chat: IChatMessage[] = [
      { role: 'user', content: 'What is on the page?' },
      { role: 'assistant', content: '', toolCalls: [{ function: { name: 'browserCapture', arguments: {} } }] as any },
      { role: 'tool', content: '{"status":"ok"}', toolName: 'browserCapture' },
      { role: 'user', content: '[The image returned by browserCapture.]', images: [IMAGE] },
    ];
    const { messages } = anthropicMessagesFromChat(chat);
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    const blocks = messages[2].content as Array<{ type: string; source?: { data: string; media_type: string } }>;
    expect(blocks[0].type).toBe('tool_result');
    const img = blocks.find((b) => b.type === 'image');
    expect(img && img.source).toEqual({ type: 'base64', media_type: 'image/jpeg', data: '/9j/AAAA' });
  });
});
