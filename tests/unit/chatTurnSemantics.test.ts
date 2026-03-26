import { describe, expect, it } from 'vitest';

import { analyzeChatTurnSemantics } from '../../src/built-in/chat/utilities/chatTurnSemantics';

describe('chat turn semantics', () => {
  it('treats durable preference prompts as explicit memory recall', () => {
    const semantics = analyzeChatTurnSemantics('What durable preference is recorded for technical answers?');
    expect(semantics.isExplicitMemoryRecall).toBe(true);
  });

  it('treats daily-memory prompts as explicit memory recall', () => {
    const semantics = analyzeChatTurnSemantics('What migration spike codename is recorded in daily memory?');
    expect(semantics.isExplicitMemoryRecall).toBe(true);
  });


});
