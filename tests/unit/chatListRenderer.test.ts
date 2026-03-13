// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { ChatListRenderer } from '../../src/built-in/chat/rendering/chatListRenderer';
import { ChatContentPartKind } from '../../src/services/chatTypes';
import type { IChatRequestResponsePair } from '../../src/services/chatTypes';

function createPair(requestId: string, text: string, markdown: string): IChatRequestResponsePair {
  return {
    request: {
      text,
      requestId,
      attempt: 0,
      timestamp: Date.now(),
    },
    response: {
      parts: [{ kind: ChatContentPartKind.Markdown, content: markdown }],
      isComplete: true,
      timestamp: Date.now(),
    },
  };
}

describe('ChatListRenderer', () => {
  it('shows regenerate only on the latest completed assistant response', () => {
    const renderer = new ChatListRenderer();
    const container = document.createElement('div');
    const messages = [
      createPair('req-1', 'First question', 'First answer'),
      createPair('req-2', 'Second question', 'Second answer'),
    ];

    renderer.renderMessages(container, messages, false);

    const regenerateButtons = [...container.querySelectorAll('button[aria-label="Regenerate response"]')];
    const copyButtons = [...container.querySelectorAll('button[aria-label="Copy response"]')];

    expect(regenerateButtons).toHaveLength(1);
    expect(copyButtons).toHaveLength(2);
    expect(regenerateButtons[0].closest('.parallx-chat-message')?.textContent).toContain('Second answer');
  });

  it('refreshes the regenerate handler binding when the latest request identity changes', () => {
    const renderer = new ChatListRenderer();
    const container = document.createElement('div');
    const requests: string[] = [];
    renderer.setRegenerateHandler((request) => {
      requests.push(request.requestId);
    });

    renderer.renderMessages(container, [createPair('req-1', 'Question', 'Answer')], false);
    const initialButton = container.querySelector('button[aria-label="Regenerate response"]') as HTMLButtonElement;
    initialButton.click();

    renderer.renderMessages(container, [createPair('req-2', 'Question', 'Updated answer')], false);
    const updatedButton = container.querySelector('button[aria-label="Regenerate response"]') as HTMLButtonElement;
    updatedButton.click();

    expect(requests).toEqual(['req-1', 'req-2']);
  });
});