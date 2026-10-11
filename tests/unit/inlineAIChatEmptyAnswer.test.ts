// @vitest-environment jsdom
// inlineAIChatEmptyAnswer.test.ts — the inline AI chat on a canvas selection.
//
// A reasoning model can spend its whole turn thinking and answer nothing.
// The bubble must not stay on "Thinking…", must offer no Replace or Insert
// for an empty answer, and must not keep an empty assistant turn.

import { describe, it, expect } from 'vitest';
import { InlineAIChatController } from '../../src/built-in/canvas/menus/inlineAIChat';
import type { IChatResponseChunk } from '../../src/services/chatTypes';

function controllerWith(chunks: IChatResponseChunk[]) {
  const host = { editor: null, container: document.createElement('div'), editorContainer: null };
  const registry = { register: () => ({ dispose: () => undefined }) };
  const send = async function* (): AsyncIterable<IChatResponseChunk> { for (const c of chunks) yield c; };
  const ctrl = new InlineAIChatController(host, registry as never, send);
  ctrl.create();
  return ctrl;
}

async function ask(ctrl: InlineAIChatController, text: string): Promise<HTMLElement> {
  const c = ctrl as unknown as { _inputField: HTMLTextAreaElement; _onSend(): Promise<void>; _chat: HTMLElement };
  c._inputField.value = text;
  await c._onSend();
  return c._chat;
}

describe('inline AI chat when the model answers nothing', () => {
  it('says so, offers no actions, and keeps no empty turn', async () => {
    const ctrl = controllerWith([{ thinking: 'Let me think.' } as IChatResponseChunk, { thinking: 'Still.' } as IChatResponseChunk]);
    const chat = await ask(ctrl, 'Shorten this');
    const bubbles = chat.querySelectorAll('.canvas-ai-chat-msg-content');
    const last = bubbles[bubbles.length - 1] as HTMLElement;
    expect(last.textContent).toBe('The model gave no answer. Try again.');
    expect(last.classList.contains('canvas-ai-chat-msg-content--thinking')).toBe(false);
    expect(chat.querySelector('.canvas-ai-chat-actions')).toBeNull();
    const messages = (ctrl as unknown as { _messages: { role: string }[] })._messages;
    expect(messages.some((m) => m.role === 'assistant')).toBe(false);
  });

  it('a real answer still arrives with its actions', async () => {
    const ctrl = controllerWith([{ thinking: 'Hmm.' } as IChatResponseChunk, { content: 'Shorter.' } as IChatResponseChunk]);
    const chat = await ask(ctrl, 'Shorten this');
    const bubbles = chat.querySelectorAll('.canvas-ai-chat-msg-content');
    expect((bubbles[bubbles.length - 1] as HTMLElement).textContent).toBe('Shorter.');
    expect(chat.querySelector('.canvas-ai-chat-actions')).not.toBeNull();
  });
});
