// A chat without its own context size runs at the workspace's default for new
// chats (Settings › Model, model.contextSize), and only without one at the
// model's own length. Opening such a chat used to clear the size to 0 (the
// model's maximum), so the default was lost on every chat switch.
import { describe, expect, it } from 'vitest';

import { chatContextSize } from '../../src/built-in/chat/utilities/chatContextDefault';

describe('the context size a chat runs at', () => {
  it('a chat without its own size runs at the workspace default for new chats', () => {
    expect(chatContextSize(0, 163_840)).toBe(163_840);
    expect(chatContextSize(undefined, 163_840)).toBe(163_840);
  });
  it("without a workspace default, the model's own length (0)", () => {
    expect(chatContextSize(0, 0)).toBe(0);
    expect(chatContextSize(undefined, undefined)).toBe(0);
  });
  it('a chat with its own size keeps it', () => {
    expect(chatContextSize(32_768, 163_840)).toBe(32_768);
  });
});
