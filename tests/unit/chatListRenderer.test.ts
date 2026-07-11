// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { ChatListRenderer } from '../../src/built-in/chat/rendering/chatListRenderer';
import { ChatContentPartKind } from '../../src/services/chatTypes';
import type {
  IChatRequestResponsePair,
  IChatContentPart,
  IChatThinkingContent,
  IChatToolInvocationContent,
} from '../../src/services/chatTypes';

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

// ── Streaming DOM stability ──────────────────────────────────────────────────
//
// During a stream, chatService mutates the SAME part objects and fires an
// update per chunk. The renderer must leave unchanged parts' DOM untouched:
// rebuilding them every tick replayed entrance animations (tool nodes blinked
// at token rate during think→tools→think turns) and reset expanded outputs.

function createStreamingPair(parts: IChatContentPart[]): IChatRequestResponsePair {
  return {
    request: { text: 'Question', requestId: 'req-s', attempt: 0, timestamp: Date.now() },
    response: { parts, isComplete: false, timestamp: Date.now() },
  };
}

function bodyParts(container: HTMLElement): HTMLElement[] {
  // Each pair renders a user body THEN an assistant body — take the last.
  const bodies = container.querySelectorAll<HTMLElement>('.parallx-chat-message-body');
  const body = bodies[bodies.length - 1];
  return [...body.querySelectorAll<HTMLElement>(
    ':scope > :not(.parallx-chat-streaming-cursor):not(.parallx-chat-typing-indicator):not(.parallx-chat-message-actions)',
  )];
}

describe('ChatListRenderer streaming DOM stability', () => {
  it('leaves settled thinking and completed tool parts untouched while trailing markdown streams', () => {
    const renderer = new ChatListRenderer();
    const container = document.createElement('div');

    const thinking: IChatThinkingContent = {
      kind: ChatContentPartKind.Thinking,
      content: 'earlier reasoning',
      isCollapsed: true,
      startTime: 1000,
      endTime: 3000,
    };
    const tool: IChatToolInvocationContent = {
      kind: ChatContentPartKind.ToolInvocation,
      toolCallId: 'call-1',
      toolName: 'read_file',
      args: { path: 'a.ts' },
      status: 'completed',
      isComplete: true,
      result: { content: 'file body', isError: false },
    };
    const markdown = { kind: ChatContentPartKind.Markdown, content: 'Hello' };
    const pair = createStreamingPair([thinking, tool, markdown as IChatContentPart]);

    renderer.renderMessages(container, [pair], true);
    const [thinkingEl1, toolEl1, mdEl1] = bodyParts(container);

    // Stream tick: only the trailing markdown grew.
    (markdown as { content: string }).content = 'Hello world';
    renderer.renderMessages(container, [pair], true);
    const [thinkingEl2, toolEl2, mdEl2] = bodyParts(container);

    expect(thinkingEl2).toBe(thinkingEl1);   // untouched → animations keep phase
    expect(toolEl2).toBe(toolEl1);           // untouched → no bloom replay
    expect(mdEl2).not.toBe(mdEl1);           // changed part re-rendered
    expect(mdEl2.textContent).toContain('Hello world');

    // A second identical tick (no changes at all) must not touch anything.
    renderer.renderMessages(container, [pair], true);
    const [thinkingEl3, toolEl3, mdEl3] = bodyParts(container);
    expect(thinkingEl3).toBe(thinkingEl2);
    expect(toolEl3).toBe(toolEl2);
    expect(mdEl3).toBe(mdEl2);
  });

  it('updates a live-streaming thinking part in place (same element, growing text)', () => {
    const renderer = new ChatListRenderer();
    const container = document.createElement('div');

    const thinking: IChatThinkingContent = {
      kind: ChatContentPartKind.Thinking,
      content: 'first ',
      isCollapsed: false,
      startTime: Date.now(),
    };
    const pair = createStreamingPair([thinking]);

    renderer.renderMessages(container, [pair], true);
    const [el1] = bodyParts(container);
    expect(el1.classList.contains('parallx-chat-thinking--streaming')).toBe(true);

    thinking.content = 'first second ';
    renderer.renderMessages(container, [pair], true);
    const [el2] = bodyParts(container);
    expect(el2).toBe(el1); // in-place update — shimmer/pulse never restart
    expect(el2.querySelector('.parallx-chat-thinking-text')?.textContent).toBe('first second ');

    // Sealing the burst (done + collapsed) also lands in place.
    thinking.endTime = Date.now();
    thinking.isCollapsed = true;
    renderer.renderMessages(container, [pair], true);
    const [el3] = bodyParts(container);
    expect(el3).toBe(el1);
    expect(el3.classList.contains('parallx-chat-thinking--collapsed')).toBe(true);
    expect(el3.classList.contains('parallx-chat-thinking--streaming')).toBe(false);
    expect(el3.querySelector('.parallx-chat-thinking-label')?.textContent).toMatch(/^Thought/);
  });

  it('re-renders a tool part when its status actually changes', () => {
    const renderer = new ChatListRenderer();
    const container = document.createElement('div');

    const tool: IChatToolInvocationContent = {
      kind: ChatContentPartKind.ToolInvocation,
      toolCallId: 'call-2',
      toolName: 'search',
      args: { query: 'x' },
      status: 'running',
    };
    const pair = createStreamingPair([tool]);

    renderer.renderMessages(container, [pair], true);
    const [el1] = bodyParts(container);
    expect(el1.classList.contains('parallx-chat-tool-node--running')).toBe(true);

    tool.status = 'completed';
    tool.isComplete = true;
    tool.result = { content: 'ok', isError: false };
    renderer.renderMessages(container, [pair], true);
    const [el2] = bodyParts(container);
    expect(el2).not.toBe(el1); // real transition → fresh render (settle animation plays)
    expect(el2.classList.contains('parallx-chat-tool-node--complete')).toBe(true);
  });
});